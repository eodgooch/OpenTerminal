import type { Candle } from "./api";

/**
 * The only range with a real "currently forming" intraday bucket — live
 * ticking (this module) and the freshness indicator (chartFreshness.ts) both
 * gate on it. Kept as one shared symbol so client and server don't drift:
 * the server's equivalent concept is `INTRADAY_RANGES` in
 * server/src/routes/market.ts (currently {"1D","5D"} — wider, since it also
 * covers Yahoo-vs-Nasdaq provider ordering, not just live-ticking).
 */
export const LIVE_TICK_RANGE = "1D";

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
 * candle at all. Live-ticking only makes sense on the 1D range (the only
 * range with a real "currently forming" intraday bucket), and only when
 * there's a baseline candle and a usable price to merge in.
 */
export function shouldApplyLiveTick(params: {
  range: string;
  lastCandle: Candle | null | undefined;
  price: number | null | undefined;
}): boolean {
  const { range, lastCandle, price } = params;
  if (range !== LIVE_TICK_RANGE) return false;
  if (!lastCandle) return false;
  if (price === null || price === undefined) return false;
  if (!isFinite(price) || price <= 0) return false;
  return true;
}
