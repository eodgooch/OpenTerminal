import type { LlmChatRequest, LlmChatResponse, LlmProvider } from "./types.js";
import { withContext } from "./types.js";

const DEFAULT_MODEL = "gpt-oss:120b";
const DEFAULT_BASE_URL = "https://ollama.com";
const REQUEST_TIMEOUT_MS = 120_000;

class OllamaHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "OllamaHttpError";
  }
}

// Hits Ollama's native /api/chat endpoint rather than its Anthropic-compatible
// shim — see docs/adr/0001-ollama-cloud-uses-native-api-not-anthropic-shim.md.
// No `thinking`/reasoning param is sent: no extended-thinking parity with the
// anthropic provider for now.
export const ollamaProvider: LlmProvider = {
  name: "ollama-cloud",

  hasCredentials(): boolean {
    return Boolean(process.env.OLLAMA_API_KEY);
  },

  missingCredentialHint(): string {
    return "set OLLAMA_API_KEY on the server.";
  },

  async chat({ system, messages, context }: LlmChatRequest): Promise<LlmChatResponse> {
    const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || DEFAULT_MODEL,
        messages: [{ role: "system", content: system }, ...withContext(messages, context)],
        stream: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new OllamaHttpError(res.status, `ollama-cloud ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await res.json();
    return { text: data?.message?.content ?? "", refused: false };
  },

  isAuthError(err: unknown): boolean {
    return err instanceof OllamaHttpError && (err.status === 401 || err.status === 403);
  },
};
