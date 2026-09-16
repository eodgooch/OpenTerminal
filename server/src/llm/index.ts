import { anthropicProvider } from "./anthropic.js";
import { ollamaProvider } from "./ollama.js";
import type { LlmProvider } from "./types.js";

export * from "./types.js";

const PROVIDERS: Record<string, LlmProvider> = {
  anthropic: anthropicProvider,
  "ollama-cloud": ollamaProvider,
};

/** An unrecognized LLM_PROVIDER value — same error class as missing credentials (503). */
export class LlmConfigError extends Error {}

/** Resolves LLM_PROVIDER (default "anthropic") to its provider, or throws LlmConfigError. */
export function activeProvider(): LlmProvider {
  const key = process.env.LLM_PROVIDER || "anthropic";
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new LlmConfigError(
      `Unrecognized LLM_PROVIDER "${key}". Expected "anthropic" or "ollama-cloud".`
    );
  }
  return provider;
}

/** Whether the active provider is configured and ready to serve requests — used by /api/status. */
export function isAiAvailable(): boolean {
  try {
    return activeProvider().hasCredentials();
  } catch {
    return false;
  }
}
