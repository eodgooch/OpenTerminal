import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "./anthropic.js";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("anthropicProvider", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports credentials based on ANTHROPIC_API_KEY", () => {
    expect(anthropicProvider.hasCredentials()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(anthropicProvider.hasCredentials()).toBe(false);
  });

  it("sends the default model, adaptive thinking, system prompt, and message list to the Messages API", async () => {
    const fetchMock = mockFetchOnce(200, {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "hello" }],
    });

    const result = await anthropicProvider.chat({
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ text: "hello", refused: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.anthropic.com");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.max_tokens).toBe(16000);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.system).toBe("be terse");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("folds context into the message list ahead of the caller's messages", async () => {
    const fetchMock = mockFetchOnce(200, {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });

    await anthropicProvider.chat({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      context: { symbol: "AAPL" },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({
      role: "user",
      content: `Current terminal context (JSON):\n${JSON.stringify({ symbol: "AAPL" })}`,
    });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("respects the LLM_MODEL override", async () => {
    process.env.LLM_MODEL = "claude-haiku-4-5";
    const fetchMock = mockFetchOnce(200, {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });

    await anthropicProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("claude-haiku-4-5");
  });

  it("returns a friendly refused response on stop_reason 'refusal' without throwing", async () => {
    mockFetchOnce(200, { stop_reason: "refusal", content: [] });

    const result = await anthropicProvider.chat({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.refused).toBe(true);
    expect(result.text).toMatch(/declined/i);
  });
});
