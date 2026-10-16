export type FreshnessState = "live" | "closed" | "stale";

/**
 * Decides what freshness indicator (if any) the chart should show.
 *
 * Only meaningful on the 1D range — that's the only range with a currently
 * forming intraday candle that live-ticking applies to (see liveTick.ts) —
 * so every other range returns `null` (no indicator at all).
 *
 * Precedence, in order:
 *  1. Not 1D -> null (nothing to show).
 *  2. Market closed -> "closed". This takes priority even over an erroring
 *     quote feed: off-hours a quote poll failing (or just not being fresh)
 *     is expected and benign, not something to flag as "stale".
 *  3. Market open but the quote feed is erroring, or hasn't produced a
 *     successful update recently (within `staleAfterMs` of `now`) -> "stale".
 *     This is what catches a dead/rate-limited provider serving cached or
 *     fallback data without misleadingly showing "LIVE".
 *  4. Otherwise -> "live".
 *
 * Pure function of its inputs (including `now`) so it's directly testable
 * without faking timers or the system clock.
 */
export function chartFreshnessState(params: {
  range: string;
  marketOpen: boolean;
  quoteHasError: boolean;
  lastQuoteUpdatedAt: number | null;
  now: number;
  staleAfterMs?: number;
}): FreshnessState | null {
  const { range, marketOpen, quoteHasError, lastQuoteUpdatedAt, now, staleAfterMs = 5_000 } = params;

  if (range !== "1D") return null;
  if (!marketOpen) return "closed";

  if (quoteHasError) return "stale";
  if (lastQuoteUpdatedAt === null) return "stale";
  if (now - lastQuoteUpdatedAt > staleAfterMs) return "stale";

  return "live";
}
