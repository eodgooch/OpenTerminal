import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { marketRouter } from "./market.js";
import * as cacheModule from "../cache.js";

function fakeRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function getHandler(path: string) {
  const layer = (marketRouter as any).stack.find((l: any) => l.route?.path === path);
  if (!layer) throw new Error(`no route registered for ${path}`);
  return layer.route.stack[0].handle as (req: Request, res: Response, next: () => void) => unknown;
}

function mockHistoryFetch() {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("api.nasdaq.com/api/autocomplete")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    }
    if (url.includes("api.nasdaq.com")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            chart: [
              { x: Date.now(), z: { open: "1", high: "2", low: "0.5", close: "1.5", volume: "100" } },
            ],
          },
        }),
      });
    }
    if (url.includes("query1.finance.yahoo.com/v8/finance/chart")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                timestamp: [Math.floor(Date.now() / 1000)],
                indicators: { quote: [{ open: [10], high: [11], low: [9], close: [10.5], volume: [200] }] },
              },
            ],
          },
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GET /history/:symbol", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers Yahoo (intraday-capable) over Nasdaq for the 1D range", async () => {
    const fetchMock = mockHistoryFetch();
    const handler = getHandler("/history/:symbol");
    const req = { params: { symbol: "INTRADAYONE" }, query: { range: "1D" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({ close: 10.5, volume: 200 }),
    ]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("api.nasdaq.com"))).toBe(false);
  });

  it("prefers Yahoo (intraday-capable) over Nasdaq for the 5D range", async () => {
    const fetchMock = mockHistoryFetch();
    const handler = getHandler("/history/:symbol");
    const req = { params: { symbol: "INTRADAYFIVE" }, query: { range: "5D" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({ close: 10.5, volume: 200 }),
    ]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("api.nasdaq.com"))).toBe(false);
  });

  it("falls back to Nasdaq's daily-only data when Yahoo fails outright for an intraday range", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("query1.finance.yahoo.com")) return Promise.resolve({ ok: false, status: 503 });
      if (url.includes("api.nasdaq.com/api/autocomplete")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }
      if (url.includes("api.nasdaq.com")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: { chart: [{ x: Date.now(), z: { open: "1", high: "2", low: "0.5", close: "1.5", volume: "100" } }] },
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = getHandler("/history/:symbol");
    const req = { params: { symbol: "INTRADAYFALLBACK" }, query: { range: "1D" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ close: 1.5, volume: 100 })]);
  });

  it("keeps Nasdaq first for daily/weekly/monthly ranges (e.g. 6M), unaffected by the intraday fix", async () => {
    const fetchMock = mockHistoryFetch();
    const handler = getHandler("/history/:symbol");
    const req = { params: { symbol: "DAILYRANGE" }, query: { range: "6M" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.json).toHaveBeenCalledWith([expect.objectContaining({ close: 1.5, volume: 100 })]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("query1.finance.yahoo.com"))).toBe(false);
  });
});

describe("GET /history/:symbol cache TTL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses a tighter cache TTL for an intraday range (1D) than for a non-intraday range (6M)", async () => {
    mockHistoryFetch();
    const cachedSpy = vi.spyOn(cacheModule, "cached");
    const handler = getHandler("/history/:symbol");

    await handler(
      { params: { symbol: "TTLINTRADAY" }, query: { range: "1D" } } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await handler(
      { params: { symbol: "TTLDAILY" }, query: { range: "6M" } } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const intradayTtl = cachedSpy.mock.calls.find((c) => String(c[0]).includes("TTLINTRADAY"))?.[1];
    const dailyTtl = cachedSpy.mock.calls.find((c) => String(c[0]).includes("TTLDAILY"))?.[1];

    expect(intradayTtl).toBeDefined();
    expect(dailyTtl).toBeDefined();
    expect(intradayTtl as number).toBeLessThan(dailyTtl as number);
    // Daily/weekly/monthly TTL is unchanged from its pre-#9 value.
    expect(dailyTtl).toBe(20_000);
  });

  it("applies the same tightened TTL to 5D as to 1D (both are INTRADAY_RANGES)", async () => {
    mockHistoryFetch();
    const cachedSpy = vi.spyOn(cacheModule, "cached");
    const handler = getHandler("/history/:symbol");

    await handler(
      { params: { symbol: "TTL1D" }, query: { range: "1D" } } as unknown as Request,
      fakeRes(),
      () => {}
    );
    await handler(
      { params: { symbol: "TTL5D" }, query: { range: "5D" } } as unknown as Request,
      fakeRes(),
      () => {}
    );

    const ttl1d = cachedSpy.mock.calls.find((c) => String(c[0]).includes("TTL1D"))?.[1];
    const ttl5d = cachedSpy.mock.calls.find((c) => String(c[0]).includes("TTL5D"))?.[1];

    expect(ttl1d).toBe(ttl5d);
  });
});

describe("GET /crypto/orderbook/:symbol", () => {
  it("rejects a symbol outside the supported crypto whitelist with 400, before touching the network", async () => {
    const handler = getHandler("/crypto/orderbook/:symbol");
    const req = { params: { symbol: "AAA&limit=5000" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "unsupported crypto symbol" });
  });

  it("accepts a whitelisted symbol (case-insensitive) and proceeds past validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bids: [], asks: [] }) })
    );
    try {
      const handler = getHandler("/crypto/orderbook/:symbol");
      const req = { params: { symbol: "btc" } } as unknown as Request;
      const res = fakeRes();

      await handler(req, res, () => {});

      expect(res.status).not.toHaveBeenCalledWith(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
