import type { Candle } from "./api";

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
  if (range !== "1D") return false;
  if (!lastCandle) return false;
  if (price === null || price === undefined) return false;
  if (!isFinite(price) || price <= 0) return false;
  return true;
}
