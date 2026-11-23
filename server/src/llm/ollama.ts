import type { ChatMessage, LlmChatRequest, LlmChatResponse, LlmProvider, ToolDef } from "./types.js";
import { LlmConfigError, withContext } from "./types.js";

const DEFAULT_MODEL = "gpt-oss:120b";
const DEFAULT_BASE_URL = "https://ollama.com";
const REQUEST_TIMEOUT_MS = 120_000;

// Neutral ChatMessage -> Ollama's native /api/chat shape: a single `content` string
// plus a sibling `images` array of bare base64 strings (no data: URI prefix, no
// per-image mimeType -- Ollama's native API doesn't take one). Plain-string content
// (the common case) passes through unchanged; array content's text parts join into
// `content` and its image parts' data become `images`.
function toOllamaMessage(message: ChatMessage): { role: string; content: string; images?: string[] } {
  if (typeof message.content === "string") return { role: message.role, content: message.content };
  // llm/imageHistoryCap.ts's capLiveImages resolves every `image-ref` into either a
  // rehydrated `image` or a text placeholder before any message list reaches a
  // provider -- an `image-ref` surviving to here would otherwise be silently dropped by
  // the `.filter` calls below (neither predicate matches it), so fail loudly instead;
  // see the matching check in anthropic.ts.
  const unresolved = message.content.find((p) => p.type === "image-ref");
  if (unresolved && unresolved.type === "image-ref") {
    throw new Error(`Unresolved image-ref part (id=${unresolved.id}) reached the ollama-cloud provider.`);
  }
  const text = message.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");
  const images = message.content
    .filter((p): p is { type: "image"; mimeType: string; data: string } => p.type === "image")
    .map((p) => p.data);
  return { role: message.role, content: text, ...(images.length > 0 ? { images } : {}) };
}

class OllamaHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "OllamaHttpError";
  }
}

/** Neutral tool def -> Ollama's native `/api/chat` tool format (OpenAI-function-style). */
function toOllamaTool(tool: ToolDef) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

// Ollama's native API returns `message.tool_calls[].function.arguments` — observed live
// against Ollama Cloud as an already-parsed object, but handled defensively as a JSON
// string too since OpenAI-function-style APIs commonly encode it that way.
function parseToolCallArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Distinguishes the two Ollama-backed providers that share the implementation below:
 * `ollama-cloud` (Ollama's hosted service, api-key auth, defaults to api.ollama.com when
 * OLLAMA_BASE_URL is unset) and `ollama` (a self-hosted server, no auth, no default --
 * see #77/ADR-0001). Everything else -- request shape, tool-call translation, response
 * parsing, isAuthError -- is identical between the two.
 */
interface OllamaProviderConfig {
  name: string;
  /** Whether this provider sends an `Authorization: Bearer` header and gates readiness
   * on OLLAMA_API_KEY. False for self-hosted `ollama`, which has no key at all. */
  useAuth: boolean;
}

/** Resolves the base URL for one Ollama-backed provider's request, per `config.useAuth`:
 * `ollama-cloud` falls back to the hosted default when OLLAMA_BASE_URL is unset, but a
 * self-hosted deployment pointing nowhere is a config error, not a reasonable default --
 * so `ollama` throws LlmConfigError instead of silently defaulting toward ollama.com. */
function resolveBaseUrl(config: OllamaProviderConfig): string {
  if (config.useAuth) return process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  const baseUrl = process.env.OLLAMA_BASE_URL;
  if (!baseUrl) {
    throw new LlmConfigError(
      `OLLAMA_BASE_URL is required when LLM_PROVIDER="${config.name}" (self-hosted Ollama has no hosted default). ` +
        'Set it to your Ollama server\'s URL, e.g. "http://localhost:11434".'
    );
  }
  return baseUrl;
}

// Hits Ollama's native /api/chat endpoint rather than its Anthropic-compatible
// shim — see docs/adr/0001-ollama-cloud-uses-native-api-not-anthropic-shim.md.
// No `thinking`/reasoning param is sent: no extended-thinking parity with the
// anthropic provider for now. Shared by both ollama-cloud and ollama (self-hosted);
// see OllamaProviderConfig above for what differs between them.
function createOllamaProvider(config: OllamaProviderConfig): LlmProvider {
  return {
    name: config.name,

    hasCredentials(): boolean {
      return config.useAuth ? Boolean(process.env.OLLAMA_API_KEY) : Boolean(process.env.OLLAMA_BASE_URL);
    },

    missingCredentialHint(): string {
      return config.useAuth ? "set OLLAMA_API_KEY on the server." : "set OLLAMA_BASE_URL on the server.";
    },

    async chat({ system, messages, context, tools, model }: LlmChatRequest): Promise<LlmChatResponse> {
      const baseUrl = resolveBaseUrl(config);
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.useAuth ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model: model || process.env.LLM_MODEL || DEFAULT_MODEL,
          messages: [{ role: "system", content: system }, ...withContext(messages, context).map(toOllamaMessage)],
          stream: false,
          ...(tools && tools.length > 0 ? { tools: tools.map(toOllamaTool) } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new OllamaHttpError(res.status, `${config.name} ${res.status}${detail ? `: ${detail}` : ""}`);
      }
      const data = await res.json();
      const rawToolCalls = data?.message?.tool_calls;
      const toolCalls =
        Array.isArray(rawToolCalls) && rawToolCalls.length > 0
          ? rawToolCalls.map((c: any, i: number) => ({
              id: String(c.id ?? `${c.function?.name ?? "tool"}-${i}`),
              name: c.function?.name ?? "",
              arguments: parseToolCallArguments(c.function?.arguments),
            }))
          : undefined;
      // Ollama's native /api/chat response carries token counts as top-level
      // `prompt_eval_count` (input) / `eval_count` (output) fields, not nested
      // under `message` -- see ollama.test.ts for the ground-truth response
      // shape this is checked against. Guarded the same defensive way as
      // parseToolCallArguments above: omit `usage` entirely rather than throw
      // if either field is missing/non-numeric.
      const usage =
        typeof data?.prompt_eval_count === "number" && typeof data?.eval_count === "number"
          ? { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count }
          : undefined;
      return { text: data?.message?.content ?? "", refused: false, toolCalls, usage };
    },

    isAuthError(err: unknown): boolean {
      return err instanceof OllamaHttpError && (err.status === 401 || err.status === 403);
    },
  };
}

/** Ollama's hosted service (ollama.com) -- api-key auth, defaults OLLAMA_BASE_URL
 * toward the hosted endpoint when unset. */
export const ollamaProvider: LlmProvider = createOllamaProvider({ name: "ollama-cloud", useAuth: true });

/** A self-hosted Ollama server -- no auth header ever sent, and OLLAMA_BASE_URL is
 * required (no silent fallback to the hosted default). See #77/ADR-0001. */
export const ollamaSelfHostedProvider: LlmProvider = createOllamaProvider({ name: "ollama", useAuth: false });
