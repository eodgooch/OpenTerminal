import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveChatModel } from "./index.js";
import { anthropicProvider } from "./anthropic.js";
import { ollamaProvider } from "./ollama.js";
import type { ChatMessage, LlmProvider } from "./types.js";

describe("resolveChatModel", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.OLLAMA_VISION_MODEL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const textOnly: ChatMessage[] = [{ role: "user", content: "hi" }];
  const withImage: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }] },
  ];

  // Stands in for #77's self-hosted "ollama" provider (not yet merged on this branch):
  // resolveChatModel must key off "not anthropic", not the literal string "ollama-cloud",
  // so any future Ollama-family provider is covered automatically.
  const fakeSelfHostedOllama: LlmProvider = { ...ollamaProvider, name: "ollama" };

  it("returns undefined for a text-only turn regardless of provider", () => {
    expect(resolveChatModel(anthropicProvider, textOnly)).toBeUndefined();
    expect(resolveChatModel(ollamaProvider, textOnly)).toBeUndefined();
  });

  it("returns undefined for an image-bearing turn under anthropic (Claude is natively multimodal)", () => {
    expect(resolveChatModel(anthropicProvider, withImage)).toBeUndefined();
  });

  it("returns OLLAMA_VISION_MODEL for an image-bearing turn under ollama-cloud when it's set", () => {
    process.env.OLLAMA_VISION_MODEL = "llama3.2-vision";
    expect(resolveChatModel(ollamaProvider, withImage)).toBe("llama3.2-vision");
  });

  it("falls back to LLM_MODEL for an image-bearing turn under ollama-cloud when OLLAMA_VISION_MODEL is unset", () => {
    process.env.LLM_MODEL = "qwen2.5vl";
    expect(resolveChatModel(ollamaProvider, withImage)).toBe("qwen2.5vl");
  });

  it("prefers OLLAMA_VISION_MODEL over LLM_MODEL when both are set for an image-bearing turn", () => {
    process.env.OLLAMA_VISION_MODEL = "llama3.2-vision";
    process.env.LLM_MODEL = "qwen2.5vl";
    expect(resolveChatModel(ollamaProvider, withImage)).toBe("llama3.2-vision");
  });

  it("returns undefined for an image-bearing turn when neither OLLAMA_VISION_MODEL nor LLM_MODEL is set", () => {
    expect(resolveChatModel(ollamaProvider, withImage)).toBeUndefined();
  });

  it("does not require OLLAMA_VISION_MODEL for an ollama-cloud turn with no image", () => {
    expect(() => resolveChatModel(ollamaProvider, textOnly)).not.toThrow();
  });

  it("applies the same LLM_MODEL fallback to any non-anthropic provider, not just ollama-cloud by name", () => {
    process.env.LLM_MODEL = "qwen2.5vl";
    expect(resolveChatModel(fakeSelfHostedOllama, withImage)).toBe("qwen2.5vl");
  });
});
