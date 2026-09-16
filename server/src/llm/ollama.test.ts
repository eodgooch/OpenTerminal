import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ollamaProvider } from "./ollama.js";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ollamaProvider", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.OLLAMA_API_KEY = "test-ollama-key";
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports credentials based on OLLAMA_API_KEY", () => {
    expect(ollamaProvider.hasCredentials()).toBe(true);
    delete process.env.OLLAMA_API_KEY;
    expect(ollamaProvider.hasCredentials()).toBe(false);
  });

  it("hits the native /api/chat endpoint with the bearer token, default model, and system+message shape", async () => {
    const fetchMock = mockFetchOnce(200, { message: { role: "assistant", content: "hello" } });

    const result = await ollamaProvider.chat({
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ text: "hello", refused: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ollama.com/api/chat");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-ollama-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-oss:120b");
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ]);
    // No thinking/reasoning param is ever sent to Ollama Cloud.
    expect(body.thinking).toBeUndefined();
  });

  it("prepends the JSON context block ahead of the caller's messages", async () => {
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });

    await ollamaProvider.chat({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      context: { symbol: "AAPL" },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1]).toEqual({
      role: "user",
      content: `Current terminal context (JSON):\n${JSON.stringify({ symbol: "AAPL" })}`,
    });
    expect(body.messages[2]).toEqual({ role: "user", content: "hi" });
  });

  it("respects OLLAMA_BASE_URL and LLM_MODEL overrides", async () => {
    process.env.OLLAMA_BASE_URL = "https://custom.example.com/";
    process.env.LLM_MODEL = "some-other-model";
    const fetchMock = mockFetchOnce(200, { message: { content: "ok" } });

    await ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://custom.example.com/api/chat");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("some-other-model");
  });

  it("throws with the upstream status on a non-ok response", async () => {
    mockFetchOnce(429, "rate limited");

    await expect(
      ollamaProvider.chat({ system: "sys", messages: [{ role: "user", content: "hi" }] })
    ).rejects.toThrow(/429/);
  });
});
