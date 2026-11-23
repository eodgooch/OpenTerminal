import { anthropicProvider } from "./anthropic.js";
import { ollamaProvider, ollamaSelfHostedProvider } from "./ollama.js";
import type { ChatMessage, LlmProvider } from "./types.js";
import { LlmConfigError, messageHasImage } from "./types.js";

export * from "./types.js";

const PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  "ollama-cloud": ollamaProvider,
  ollama: ollamaSelfHostedProvider,
};

/** Resolves LLM_PROVIDER (default "anthropic") to its provider, or throws LlmConfigError. */
export function activeProvider(): LlmProvider {
  const key = process.env.LLM_PROVIDER || "anthropic";
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new LlmConfigError(
      `Unrecognized LLM_PROVIDER "${key}". Expected "anthropic", "ollama-cloud", or "ollama".`
    );
  }
  return provider;
}

/**
 * Picks the model override for one chat turn, if any (see LlmChatRequest.model).
 * `anthropic`'s Claude models are natively multimodal, so an image-bearing turn there
 * just uses the regular model (undefined -- no override). Every other (Ollama-family --
 * currently `ollama-cloud`, see #77 for an upcoming self-hosted `ollama` provider)
 * provider's regular `LLM_MODEL` may be a text-only model, so an image-bearing turn
 * there prefers a vision-capable model named via `OLLAMA_VISION_MODEL`, falling back to
 * `LLM_MODEL` when that's unset (many Ollama models already handle both text and
 * vision) -- see ollama.ts's own `model || process.env.LLM_MODEL || DEFAULT_MODEL`
 * chain, which this mirrors. Checked by name (`!== "anthropic"`) rather than an
 * allowlist of Ollama-family names, so a future provider in that family is covered
 * with zero changes here.
 */
export function resolveChatModel(provider: LlmProvider, messages: ChatMessage[]): string | undefined {
  if (provider.name === "anthropic") return undefined;
  if (!messages.some(messageHasImage)) return undefined;
  return process.env.OLLAMA_VISION_MODEL || process.env.LLM_MODEL;
}

/** Whether the active provider is configured and ready to serve requests — used by /api/status. */
export function isAiAvailable(): boolean {
  try {
    return activeProvider().hasCredentials();
  } catch {
    return false;
  }
}
