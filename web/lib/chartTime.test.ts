import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TickMarkType, type UTCTimestamp } from "lightweight-charts";
import { localCrosshairTimeFormatter, localTickMarkFormatter } from "./chartTime";

// 2026-10-16T13:30:00Z — Yahoo's actual 1D/5D bar convention: a real intraday
// moment (9:30am US/Eastern, market open), not a nominal UTC-midnight label.
const MARKET_OPEN_UTC = 1792157400 as UTCTimestamp;

describe("localTickMarkFormatter / localCrosshairTimeFormatter (America/New_York)", () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = "America/New_York";
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("formats a Time tick mark in local wall-clock time, not UTC", () => {
    expect(localTickMarkFormatter(MARKET_OPEN_UTC, TickMarkType.Time)).toBe("09:30");
  });

  it("formats a TimeWithSeconds tick mark with seconds included", () => {
    expect(localTickMarkFormatter(MARKET_OPEN_UTC, TickMarkType.TimeWithSeconds)).toBe("09:30:00");
  });

  it("falls back to the default formatter (null) for day/month/year tick marks", () => {
    expect(localTickMarkFormatter(MARKET_OPEN_UTC, TickMarkType.DayOfMonth)).toBeNull();
    expect(localTickMarkFormatter(MARKET_OPEN_UTC, TickMarkType.Month)).toBeNull();
    expect(localTickMarkFormatter(MARKET_OPEN_UTC, TickMarkType.Year)).toBeNull();
  });

  it("formats the crosshair label with the local date and time", () => {
    expect(localCrosshairTimeFormatter(MARKET_OPEN_UTC)).toBe("Oct 16, 09:30");
  });
});
