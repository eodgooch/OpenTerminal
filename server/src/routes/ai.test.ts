import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { aiRouter } from "./ai.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(path: string) {
  const layer = (aiRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("POST /api/ai/chat", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_API_KEY;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects a missing messages array with 400, before touching any provider", async () => {
    const handler = getHandler("/chat");
    const req = { body: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "messages array required" });
  });

  it("rejects an empty messages array with 400", async () => {
    const handler = getHandler("/chat");
    const req = { body: { messages: [] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("defaults to anthropic when LLM_PROVIDER is unset, and 503s naming ANTHROPIC_API_KEY when it's missing", async () => {
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("503s naming OLLAMA_API_KEY when LLM_PROVIDER=ollama-cloud and the key is missing", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/OLLAMA_API_KEY/);
  });

  it("503s on an unrecognized LLM_PROVIDER value rather than silently falling back", async () => {
    process.env.LLM_PROVIDER = "bogus-provider";
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/bogus-provider/);
  });

  it("returns 200 with { text } for the anthropic provider on success", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "text", text: "hi there" }] })
    );
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith({ text: "hi there" });
  });

  it("returns 200 with { text } for the ollama-cloud provider on success", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    process.env.OLLAMA_API_KEY = "test-key";
    vi.stubGlobal("fetch", fakeFetch(200, { message: { content: "hi there" } }));
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith({ text: "hi there" });
  });

  it("returns 503 naming the credential when a present-but-invalid key is rejected upstream", async () => {
    process.env.ANTHROPIC_API_KEY = "invalid-key";
    vi.stubGlobal(
      "fetch",
      fakeFetch(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })
    );
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(503);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("returns 502 with the upstream message when the active provider's request fails", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    process.env.OLLAMA_API_KEY = "test-key";
    vi.stubGlobal("fetch", fakeFetch(500, "boom"));
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/500/);
  });

  it("returns 502, not a false-positive 503, when an upstream error's text mentions 'unauthorized' but the status isn't 401/403", async () => {
    process.env.LLM_PROVIDER = "ollama-cloud";
    process.env.OLLAMA_API_KEY = "test-key";
    vi.stubGlobal("fetch", fakeFetch(400, "model access unauthorized for this region"));
    const handler = getHandler("/chat");
    const req = { body: { messages: [{ role: "user", content: "hi" }] } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
    expect((res.json as any).mock.calls[0][0].error).toMatch(/unauthorized for this region/);
  });
});
