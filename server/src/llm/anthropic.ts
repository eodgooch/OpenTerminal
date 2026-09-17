import Anthropic from "@anthropic-ai/sdk";
import type { LlmChatRequest, LlmChatResponse, LlmProvider } from "./types.js";
import { withContext } from "./types.js";

const DEFAULT_MODEL = "claude-opus-4-8";

export const anthropicProvider: LlmProvider = {
  name: "anthropic",

  hasCredentials(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },

  missingCredentialHint(): string {
    return "set ANTHROPIC_API_KEY on the server.";
  },

  async chat({ system, messages, context }: LlmChatRequest): Promise<LlmChatResponse> {
    // A fresh client per call (rather than a module-level singleton) so it always
    // picks up the current ANTHROPIC_API_KEY / global fetch — important for tests.
    const client = new Anthropic();
    const response = await client.messages.create({
      model: process.env.LLM_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: withContext(messages, context),
    });
    if (response.stop_reason === "refusal") {
      return { text: "The assistant declined to answer this request.", refused: true };
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => ("text" in b ? b.text : ""))
      .join("");
    return { text, refused: false };
  },

  isAuthError(err: unknown): boolean {
    return err instanceof Anthropic.APIError && (err.status === 401 || err.status === 403);
  },
};
