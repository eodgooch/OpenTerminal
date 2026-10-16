import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { marketRouter, missingTodaysBar, marketLikelyOpenedToday, appendTodaysBar } from "./market.js";
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

function rssXml(items: Array<{ title: string; link: string; pubDate?: string }>): string {
  const itemsXml = items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link>${
          i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : ""
        }</item>`
    )
    .join("");
  return `<?xml version="1.0"?><rss><channel>${itemsXml}</channel></rss>`;
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

// Nasdaq chart data dated to a past day, plus working quote endpoints
// (info/summary) so appendTodaysBar can patch in a "today" bar from them.
function mockStaleNasdaqWithQuote(lastBarIso: string, price: number) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("api.nasdaq.com/api/autocomplete")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    }
    if (url.includes("api.nasdaq.com/api/quote") && url.includes("/info")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            primaryData: { lastSalePrice: `$${price}`, netChange: "0.00", percentageChange: "0.00%", volume: "1,000" },
            keyStats: { dayrange: { value: `${price - 1} - ${price + 1}` }, fiftyTwoWeekHighLow: { value: "1 - 2" } },
            companyName: "Test Co",
            exchange: "NASDAQ",
            marketStatus: "Open",
          },
        }),
      });
    }
    if (url.includes("api.nasdaq.com/api/quote") && url.includes("/summary")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { summaryData: {} } }) });
    }
    if (url.includes("api.nasdaq.com")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            chart: [
              {
                x: new Date(lastBarIso).getTime(),
                z: { open: "1", high: "2", low: "0.5", close: "1.5", volume: "100" },
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

describe("missingTodaysBar / marketLikelyOpenedToday", () => {
  const candleOn = (iso: string) => [
    { time: Math.floor(new Date(iso).getTime() / 1000), open: 1, high: 1, low: 1, close: 1, volume: 0 },
  ];

  it("is not stale before the market has opened today, even with yesterday's bar", () => {
    const now = new Date("2026-10-16T13:00:00Z"); // 09:00 ET, Friday
    expect(missingTodaysBar(candleOn("2026-10-15T00:00:00Z"), now)).toBe(false);
  });

  it("flags a stale last bar once the market has opened today", () => {
    const now = new Date("2026-10-16T15:00:00Z"); // 11:00 ET, Friday
    expect(missingTodaysBar(candleOn("2026-10-15T00:00:00Z"), now)).toBe(true);
  });

  it("is not stale once the last bar is dated today", () => {
    const now = new Date("2026-10-16T15:00:00Z");
    expect(missingTodaysBar(candleOn("2026-10-16T00:00:00Z"), now)).toBe(false);
  });

  it("treats an empty candle list as stale once the market has opened", () => {
    const now = new Date("2026-10-16T15:00:00Z");
    expect(missingTodaysBar([], now)).toBe(true);
  });

  it("never flags staleness on a weekend", () => {
    const now = new Date("2026-10-17T15:00:00Z"); // Saturday
    expect(marketLikelyOpenedToday(now)).toBe(false);
    expect(missingTodaysBar(candleOn("2026-10-09T00:00:00Z"), now)).toBe(false);
  });
});

describe("appendTodaysBar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches in a synthetic today bar from Nasdaq's quote when the chart is a session stale", async () => {
    mockStaleNasdaqWithQuote("2026-10-15T00:00:00Z", 150);
    const now = new Date("2026-10-16T15:00:00Z"); // Friday, market open
    const stale = [{ time: Math.floor(new Date("2026-10-15T00:00:00Z").getTime() / 1000), open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }];

    const patched = await appendTodaysBar("TODAYBAR", stale, now);

    expect(patched).toHaveLength(2);
    expect(patched[1]).toMatchObject({ close: 150 });
    expect(patched[1].time).toBeGreaterThan(patched[0].time);
  });

  it("leaves the candles untouched when the last bar is already today's", async () => {
    const now = new Date("2026-10-16T15:00:00Z");
    const fresh = [{ time: Math.floor(new Date("2026-10-16T00:00:00Z").getTime() / 1000), open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }];

    const patched = await appendTodaysBar("FRESHBAR", fresh, now);

    expect(patched).toBe(fresh);
  });
});

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

describe("GET /news", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("only invokes symbol-scope sources for a symbol-scoped request", async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calledUrls.push(String(url));
        if (String(url).includes("company_tickers.json")) {
          // secedgar.ts's ticker->CIK map is cached for the process lifetime once fetched
          // successfully, so whichever test populates it first fixes every symbol later
          // tests in this file can resolve — include ZZZZ3 here for the 502 test below.
          return {
            ok: true,
            json: async () => ({
              0: { cik_str: 320193, ticker: "ZZZZ1", title: "ZZZZ1" },
              1: { cik_str: 3, ticker: "ZZZZ3", title: "ZZZZ3" },
            }),
          };
        }
        if (String(url).includes("browse-edgar")) {
          return {
            ok: true,
            text: async () =>
              `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>8-K filing</title><link href="https://www.sec.gov/Archives/edgar/data/320193/x-index.htm" rel="alternate" type="text/html" /><updated>2026-10-16T16:29:07-04:00</updated></entry></feed>`,
          };
        }
        return {
          ok: true,
          text: async () => rssXml([{ title: `Headline for ${url}`, link: "https://example.com/a" }]),
        };
      })
    );

    const handler = getHandler("/news");
    const req = { query: { symbol: "ZZZZ1" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(calledUrls).toHaveLength(5);
    expect(calledUrls.some((u) => u.includes("feeds.finance.yahoo.com") && u.includes("ZZZZ1"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("news.google.com") && u.includes("ZZZZ1"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("nasdaq.com") && u.includes("ZZZZ1"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("company_tickers.json"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("browse-edgar") && u.includes("CIK=0000320193"))).toBe(true);
    expect(calledUrls.some((u) => u.toLowerCase().includes("federal"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("federalreserve.gov"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("feeds.content.dowjones.io"))).toBe(false);
    expect(calledUrls.some((u) => u.includes("cnbc.com"))).toBe(false);
    expect(res.json).toHaveBeenCalled();
  });

  it("only invokes global-scope sources for a non-symbol request", async () => {
    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calledUrls.push(String(url));
        return {
          ok: true,
          text: async () => rssXml([{ title: `Headline for ${url}`, link: "https://example.com/a" }]),
        };
      })
    );

    const handler = getHandler("/news");
    const req = { query: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(calledUrls).toHaveLength(5);
    expect(calledUrls.every((u) => !u.includes("feeds.finance.yahoo.com"))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("nasdaq.com"))).toBe(true);
    expect(calledUrls.some((u) => u.toLowerCase().includes("stock"))).toBe(true);
    expect(calledUrls.some((u) => u.toLowerCase().includes("federal"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("federalreserve.gov"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("feeds.content.dowjones.io"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("cnbc.com"))).toBe(true);
    expect(res.json).toHaveBeenCalled();
  });

  it("dedupes merged results across sources and caps at 40", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve({
          ok: true,
          text: async () =>
            rssXml(
              Array.from({ length: 45 }, (_, i) => ({
                title: "Duplicate headline",
                link: `https://example.com/${i}`,
                pubDate: new Date(2024, 0, 1 + i).toUTCString(),
              }))
            ),
        })
      )
    );

    const handler = getHandler("/news");
    const req = { query: { symbol: "ZZZZ2" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload).toHaveLength(1);
    expect(payload.length).toBeLessThanOrEqual(40);
  });

  it("fails with 502 when every source rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, text: async () => "" }))
    );

    // ZZZZ3 is resolvable (see the ticker map seeded in the first test above), so the
    // SEC EDGAR source actually attempts its filing-feed fetch and fails too, instead
    // of short-circuiting on an unresolvable ticker to an empty, "successful" result —
    // and it's a symbol no earlier test used, so there's no stale cached response to
    // fall back to when every source rejects.
    const handler = getHandler("/news");
    const req = { query: { symbol: "ZZZZ3" } } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(res.status).toHaveBeenCalledWith(502);
  });
});

describe("GET /recap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches news via the NEWS_SOURCES registry's global scope, not a hardcoded two-call list", async () => {
    // "recap:full" and "news:recap" are fixed, symbol-less cache keys, so bypass the
    // real module-level cache (as the GET /history/:symbol cache-TTL tests above do
    // with cachedSpy) to keep this test isolated from the real one.
    vi.spyOn(cacheModule, "cached").mockImplementation((_key, _ttl, fn) => fn());

    const calledUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calledUrls.push(String(url));
        return {
          ok: true,
          json: async () => ({ data: [] }),
          text: async () => rssXml([{ title: `Headline for ${url}`, link: "https://example.com/a" }]),
        };
      })
    );

    const handler = getHandler("/recap");
    const req = { query: {} } as unknown as Request;
    const res = fakeRes();

    await handler(req, res, () => {});

    expect(calledUrls.filter((u) => u.includes("news.google.com"))).toHaveLength(2);
    expect(calledUrls.some((u) => u.includes("federalreserve.gov"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("feeds.content.dowjones.io"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("cnbc.com"))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("feeds.finance.yahoo.com"))).toBe(true);
    expect(calledUrls.every((u) => !u.includes("nasdaq.com/feed/rssoutbound"))).toBe(true);
  });
});
