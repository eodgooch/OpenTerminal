import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeProvider, LlmConfigError, MissingVisionModelError, resolveChatModel } from "./index.js";
import { anthropicProvider } from "./anthropic.js";
import { ollamaProvider, ollamaSelfHostedProvider } from "./ollama.js";
import type { ChatMessage } from "./types.js";

describe("activeProvider", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to anthropic when LLM_PROVIDER is unset", () => {
    delete process.env.LLM_PROVIDER;
    expect(activeProvider()).toBe(anthropicProvider);
  });

  it('resolves LLM_PROVIDER="ollama-cloud" to the hosted ollamaProvider', () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    expect(activeProvider()).toBe(ollamaProvider);
  });

  it('resolves LLM_PROVIDER="ollama" to the self-hosted ollamaSelfHostedProvider', () => {
    process.env.LLM_PROVIDER = "ollama";
    expect(activeProvider()).toBe(ollamaSelfHostedProvider);
  });

  it("throws LlmConfigError naming all three valid providers for an unrecognized key", () => {
    process.env.LLM_PROVIDER = "bogus";
    expect(() => activeProvider()).toThrow(LlmConfigError);
    expect(() => activeProvider()).toThrow(/"anthropic"/);
    expect(() => activeProvider()).toThrow(/"ollama-cloud"/);
    expect(() => activeProvider()).toThrow(/"ollama"/);
  });
});

describe("resolveChatModel", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.OLLAMA_VISION_MODEL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  const textOnly: ChatMessage[] = [{ role: "user", content: "hi" }];
  const withImage: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "what is this?" }, { type: "image", mimeType: "image/png", data: "aGVsbG8=" }] },
  ];

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

  it("throws MissingVisionModelError for an image-bearing turn under ollama-cloud when OLLAMA_VISION_MODEL is unset", () => {
    expect(() => resolveChatModel(ollamaProvider, withImage)).toThrow(MissingVisionModelError);
    expect(() => resolveChatModel(ollamaProvider, withImage)).toThrow(/OLLAMA_VISION_MODEL/);
  });

  it("does not require OLLAMA_VISION_MODEL for an ollama-cloud turn with no image", () => {
    expect(() => resolveChatModel(ollamaProvider, textOnly)).not.toThrow();
  });
});
