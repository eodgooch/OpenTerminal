import { afterEach, describe, expect, it, vi } from "vitest";
import { secEdgarFilings } from "./news.js";

// The CIK map is cached by a fixed key in `cache.ts`, so whichever test runs first
// locks it in for the rest of this file — every symbol used below must be listed here.
const ALL_TEST_TICKERS: Record<string, number> = {
  SECT1: 320193,
  SECT2: 111111,
  SECT3: 222222,
  SECT4: 333333,
};

function tickerMapResponse() {
  return {
    ok: true,
    json: async () =>
      Object.fromEntries(
        Object.entries(ALL_TEST_TICKERS).map(([ticker, cik], i) => [
          String(i),
          { cik_str: cik, ticker, title: ticker },
        ])
      ),
  };
}

function atomFeed(entries: Array<{ title: string; link: string; updated: string }>): string {
  const entriesXml = entries
    .map(
      (e) =>
        `<entry><title>${e.title}</title><link href="${e.link}" rel="alternate" type="text/html" /><updated>${e.updated}</updated></entry>`
    )
    .join("");
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entriesXml}</feed>`;
}

describe("secEdgarFilings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a known symbol's CIK and maps atom entries to NewsItem", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      if (String(url).includes("browse-edgar")) {
        expect(String(url)).toContain("CIK=0000320193");
        return {
          ok: true,
          text: async () =>
            atomFeed([
              {
                title: "10-Q - Quarterly report",
                link: "https://www.sec.gov/Archives/edgar/data/320193/example-index.htm",
                updated: "2026-10-16T16:29:07-04:00",
              },
            ]),
        };
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const items = await secEdgarFilings("SECT1");

    expect(items).toEqual([
      {
        title: "10-Q - Quarterly report",
        link: "https://www.sec.gov/Archives/edgar/data/320193/example-index.htm",
        publisher: "SEC EDGAR",
        publishedAt: new Date("2026-10-16T16:29:07-04:00").toISOString(),
        symbol: "SECT1",
      },
    ]);
  });

  it("returns an empty array for an unresolvable ticker without fetching the filing feed", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const items = await secEdgarFilings("NOPE_NO_MATCH");

    expect(items).toEqual([]);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("browse-edgar"))).toBe(false);
  });

  it("throws when the filing feed fetch is not ok, so the caller can drop this source", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      return { ok: false, status: 503 };
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(secEdgarFilings("SECT2")).rejects.toThrow();
  });

  it("fetches the ticker map once and reuses it across symbols", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("company_tickers.json")) {
        return tickerMapResponse();
      }
      return { ok: true, text: async () => atomFeed([]) };
    });
    vi.stubGlobal("fetch", fetchMock);

    await secEdgarFilings("SECT3");
    const tickerCallsAfterFirst = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("company_tickers.json")
    ).length;
    await secEdgarFilings("SECT4");
    const tickerCallsAfterSecond = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("company_tickers.json")
    ).length;

    expect(tickerCallsAfterFirst).toBe(tickerCallsAfterSecond);
  });
});
