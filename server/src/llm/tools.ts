// The AI assistant's first real tool: symbol/global news search. Reuses the exact
// provider/dedupe pattern GET /api/market/news already uses (see routes/market.ts)
// rather than inventing a second way to fan out across NEWS_SOURCES.
import { NEWS_SOURCES, dedupe, type NewsItem } from "../providers/news.js";
import type { ToolDef } from "./types.js";

/** Caps how many headlines are folded back into the model's context per call — enough signal, not a wall of text. */
const MAX_RESULTS = 10;

export const NEWS_SEARCH_TOOL: ToolDef = {
  name: "search_news",
  description:
    "Search financial news headlines. Pass a stock ticker symbol to search company-scoped news (press releases, SEC filings, symbol-tagged coverage); omit it to search global market/macro news (Fed, top market stories).",
  parameters: {
    type: "object",
    properties: {
      symbol: {
        type: "string",
        description: "Stock ticker symbol to scope the search to, e.g. AAPL. Omit for global market news.",
      },
    },
    required: [],
  },
};

export type NewsSearchResult = { ok: true; items: NewsItem[] } | { ok: false; error: string };

/** Executes the search_news tool call: fan out over same-scope NEWS_SOURCES, dedupe, cap. */
export async function runNewsSearchTool(args: Record<string, unknown>): Promise<NewsSearchResult> {
  const symbol = typeof args.symbol === "string" && args.symbol.trim() ? args.symbol.trim().toUpperCase() : null;
  const scope = symbol ? "symbol" : "global";
  const sources = NEWS_SOURCES.filter((s) => s.scope === scope);
  const lists = await Promise.allSettled(sources.map((s) => (s.scope === "symbol" ? s.fetch(symbol as string) : s.fetch())));
  const ok = lists.filter((r): r is PromiseFulfilledResult<NewsItem[]> => r.status === "fulfilled").map((r) => r.value);
  if (ok.length === 0) return { ok: false, error: "all news sources failed" };
  return { ok: true, items: dedupe(ok).slice(0, MAX_RESULTS) };
}
