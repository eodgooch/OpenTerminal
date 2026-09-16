/** A single turn in a chat conversation, in the shape both LLM Providers accept. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Neutral chat request shared by every LLM Provider. */
export interface LlmChatRequest {
  system: string;
  messages: ChatMessage[];
  context?: unknown;
}

/** Neutral chat response shared by every LLM Provider. */
export interface LlmChatResponse {
  text: string;
  refused: boolean;
}

/**
 * A named backend for AI chat completion (see CONTEXT.md's "LLM Provider").
 * Deliberately distinct from `server/src/providers/` (market-data providers) —
 * an unrelated concept in an unrelated domain.
 */
export interface LlmProvider {
  readonly name: string;
  hasCredentials(): boolean;
  /** Human-readable hint naming the missing env var, for the 503 error body. */
  missingCredentialHint(): string;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

/** Folds optional terminal context into the message list, ahead of the user's own messages. */
export function withContext(messages: ChatMessage[], context: unknown): ChatMessage[] {
  if (!context) return messages;
  return [
    { role: "user", content: `Current terminal context (JSON):\n${JSON.stringify(context)}` },
    ...messages,
  ];
}
