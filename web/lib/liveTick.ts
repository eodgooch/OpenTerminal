import type { Candle } from "./api";

/**
 * The ranges with a real "currently forming" intraday bucket — live ticking
 * (this module) and the freshness indicator (chartFreshness.ts) both gate on
 * this set. Mirrors the server's `INTRADAY_RANGES` in
 * server/src/routes/market.ts (also {"1D","5D"}, there for Yahoo-vs-Nasdaq
 * provider ordering) so client and server agree on which ranges are
 * "intraday" — 5D's bars are 15-minute buckets, same forming-candle shape as
 * 1D's 5-minute ones, just coarser.
 */
export const LIVE_TICK_RANGES = new Set(["1D", "5D"]);

/**
 * Merges a live price tick into a candle: moves the close to the new price
 * and extends the high/low if the tick exceeds them. `open`, `time`, and
 * `volume` are left untouched — this never changes which bucket the candle
 * belongs to, only its shape. Does not mutate the input.
 */
export function applyLiveTick(candle: Candle, price: number): Candle {
  return {
    ...candle,
    close: price,
    high: Math.max(candle.high, price),
    low: Math.min(candle.low, price),
  };
}

/**
 * Decides whether a live price tick should be merged into the chart's last
 * candle at all. Live-ticking only makes sense on the intraday ranges (the
 * only ones with a real "currently forming" bucket), and only when there's a
 * baseline candle and a usable price to merge in.
 */
export function shouldApplyLiveTick(params: {
  range: string;
  lastCandle: Candle | null | undefined;
  price: number | null | undefined;
}): boolean {
  const { range, lastCandle, price } = params;
  if (!LIVE_TICK_RANGES.has(range)) return false;
  if (!lastCandle) return false;
  if (price === null || price === undefined) return false;
  if (!isFinite(price) || price <= 0) return false;
  return true;
}
