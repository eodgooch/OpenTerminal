import { describe, expect, it } from "vitest";
import { chartFreshnessState } from "./chartFreshness";

const NOW = 1_700_000_000_000;

describe("chartFreshnessState", () => {
  it("returns null off the 1D range, regardless of market/quote state", () => {
    expect(
      chartFreshnessState({
        range: "5D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW,
        now: NOW,
      })
    ).toBeNull();
    expect(
      chartFreshnessState({
        range: "6M",
        marketOpen: false,
        quoteHasError: true,
        lastQuoteUpdatedAt: null,
        now: NOW,
      })
    ).toBeNull();
  });

  it("is 'closed' when the market is closed, even if the quote is healthy", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: false,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW,
        now: NOW,
      })
    ).toBe("closed");
  });

  it("is 'closed' (not 'stale') when the market is closed and the quote is also erroring", () => {
    // Off-hours a quote error is unsurprising — "closed" takes priority.
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: false,
        quoteHasError: true,
        lastQuoteUpdatedAt: null,
        now: NOW,
      })
    ).toBe("closed");
  });

  it("is 'live' when the market is open and the quote is fresh and error-free", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW - 500,
        now: NOW,
      })
    ).toBe("live");
  });

  it("is 'stale' when the market is open but the quote is erroring", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: true,
        lastQuoteUpdatedAt: NOW - 500,
        now: NOW,
      })
    ).toBe("stale");
  });

  it("is 'stale' when the market is open but the quote hasn't ticked in over the stale threshold", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW - 6_000,
        now: NOW,
      })
    ).toBe("stale");
  });

  it("is 'stale' when the market is open but there has never been a successful quote update", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: null,
        now: NOW,
      })
    ).toBe("stale");
  });

  it("is 'live' right at the stale threshold boundary, 'stale' just past it", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW - 5_000,
        now: NOW,
        staleAfterMs: 5_000,
      })
    ).toBe("live");
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW - 5_001,
        now: NOW,
        staleAfterMs: 5_000,
      })
    ).toBe("stale");
  });

  it("respects a custom staleAfterMs", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW - 2_000,
        now: NOW,
        staleAfterMs: 1_000,
      })
    ).toBe("stale");
  });

  it("is 'stale' when the market is open, the quote feed is healthy, but the history fetch is erroring (e.g. the intraday provider failed over to a cached/fallback series)", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW - 500,
        historyHasError: true,
        now: NOW,
      })
    ).toBe("stale");
  });

  it("is 'closed' (not 'stale') when the market is closed even if the history fetch is also erroring", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: false,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW,
        historyHasError: true,
        now: NOW,
      })
    ).toBe("closed");
  });

  it("defaults historyHasError to false when omitted, preserving prior behavior", () => {
    expect(
      chartFreshnessState({
        range: "1D",
        marketOpen: true,
        quoteHasError: false,
        lastQuoteUpdatedAt: NOW - 500,
        now: NOW,
      })
    ).toBe("live");
  });
});
