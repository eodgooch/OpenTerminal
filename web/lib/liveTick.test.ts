import { describe, expect, it } from "vitest";
import { applyLiveTick, shouldApplyLiveTick } from "./liveTick";
import type { Candle } from "./api";

const baseCandle: Candle = { time: 1_700_000_000, open: 100, high: 102, low: 99, close: 101, volume: 1000 };

describe("applyLiveTick", () => {
  it("moves the close to the new price", () => {
    const next = applyLiveTick(baseCandle, 101.5);
    expect(next.close).toBe(101.5);
  });

  it("extends the high when the tick exceeds it", () => {
    const next = applyLiveTick(baseCandle, 103);
    expect(next.high).toBe(103);
    expect(next.low).toBe(99);
  });

  it("extends the low when the tick is below it", () => {
    const next = applyLiveTick(baseCandle, 98);
    expect(next.low).toBe(98);
    expect(next.high).toBe(102);
  });

  it("leaves high/low untouched when the tick is within range", () => {
    const next = applyLiveTick(baseCandle, 100.5);
    expect(next.high).toBe(102);
    expect(next.low).toBe(99);
  });

  it("leaves open, time, and volume unchanged", () => {
    const next = applyLiveTick(baseCandle, 105);
    expect(next.open).toBe(baseCandle.open);
    expect(next.time).toBe(baseCandle.time);
    expect(next.volume).toBe(baseCandle.volume);
  });

  it("does not mutate the input candle", () => {
    const original = { ...baseCandle };
    applyLiveTick(baseCandle, 999);
    expect(baseCandle).toEqual(original);
  });
});

describe("shouldApplyLiveTick", () => {
  it("is true for a normal 1D tick with a baseline candle and a valid price", () => {
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: baseCandle, price: 101.5 })).toBe(true);
  });

  it("is true for a normal 5D tick too (also intraday)", () => {
    expect(shouldApplyLiveTick({ range: "5D", lastCandle: baseCandle, price: 101.5 })).toBe(true);
  });

  it("is false outside the intraday ranges", () => {
    expect(shouldApplyLiveTick({ range: "6M", lastCandle: baseCandle, price: 101.5 })).toBe(false);
    expect(shouldApplyLiveTick({ range: "1M", lastCandle: baseCandle, price: 101.5 })).toBe(false);
  });

  it("is false without a baseline candle", () => {
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: null, price: 101.5 })).toBe(false);
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: undefined, price: 101.5 })).toBe(false);
  });

  it("is false for a null or undefined price", () => {
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: baseCandle, price: null })).toBe(false);
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: baseCandle, price: undefined })).toBe(false);
  });

  it("is false for a non-finite or non-positive price", () => {
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: baseCandle, price: NaN })).toBe(false);
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: baseCandle, price: Infinity })).toBe(false);
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: baseCandle, price: 0 })).toBe(false);
    expect(shouldApplyLiveTick({ range: "1D", lastCandle: baseCandle, price: -5 })).toBe(false);
  });
});
