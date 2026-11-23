import { afterEach, describe, expect, it, vi } from "vitest";

// FETCH_TIMEOUT_MS is read once at module load, so the env var must be set
// before the module is imported.
process.env.PROVIDER_FETCH_TIMEOUT_MS = "50";

const { earningsSurprise } = await import("./nasdaq.js");

/** A fetch mock that never resolves on its own — only rejects once the caller's AbortSignal fires. */
function mockHangingFetch() {
  const fetchMock = vi.fn((_url: string, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = opts?.signal;
      if (!signal) return; // no signal means it would hang forever — the bug this guards against
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("nasdaq provider fetch timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects quickly when the upstream fetch hangs, instead of hanging forever", async () => {
    mockHangingFetch();
    const start = Date.now();
    await expect(earningsSurprise("AAPL")).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("carries an AbortSignal on the outbound fetch, alongside the existing headers", async () => {
    const fetchMock = mockHangingFetch();
    await expect(earningsSurprise("AAPL")).rejects.toThrow();
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect((opts.headers as Record<string, string>)["User-Agent"]).toBeTruthy();
  });
});

describe("nasdaq provider User-Agent rotation", () => {
  const ORIGINAL_UA_ENV = process.env.NASDAQ_USER_AGENT;

  /** Mocks fetch to return a scripted sequence of statuses, recording every call's headers. */
  function mockFetchStatuses(statuses: number[]) {
    const calls: RequestInit[] = [];
    let i = 0;
    const fetchMock = vi.fn((_url: string, opts?: RequestInit) => {
      calls.push(opts!);
      const status = statuses[Math.min(i, statuses.length - 1)];
      i++;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ data: { earningsSurpriseTable: { rows: [] } } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, calls };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_UA_ENV === undefined) delete process.env.NASDAQ_USER_AGENT;
    else process.env.NASDAQ_USER_AGENT = ORIGINAL_UA_ENV;
    vi.resetModules();
  });

  it("rotates to a different User-Agent after a 403 and retries the request", async () => {
    delete process.env.NASDAQ_USER_AGENT;
    vi.resetModules();
    const { earningsSurprise: fresh } = await import("./nasdaq.js");
    const { fetchMock, calls } = mockFetchStatuses([403, 200]);

    await expect(fresh("AAPL")).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ua0 = (calls[0].headers as Record<string, string>)["User-Agent"];
    const ua1 = (calls[1].headers as Record<string, string>)["User-Agent"];
    expect(ua0).toBeTruthy();
    expect(ua1).toBeTruthy();
    expect(ua1).not.toBe(ua0);
  });

  it("exhausts the UA pool on persistent 403s, then lets the error fail through unchanged", async () => {
    delete process.env.NASDAQ_USER_AGENT;
    vi.resetModules();
    const { earningsSurprise: fresh } = await import("./nasdaq.js");
    const { fetchMock, calls } = mockFetchStatuses([403]);

    await expect(fresh("AAPL")).rejects.toThrow(/nasdaq 403/);

    // Bounded by the pool size — it must stop retrying once every pool entry
    // has been tried, rather than looping forever on a persistent 403.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    const uasTried = new Set(calls.map((c) => (c.headers as Record<string, string>)["User-Agent"]));
    expect(uasTried.size).toBe(fetchMock.mock.calls.length);
  });

  it("does not rotate on non-403 errors", async () => {
    delete process.env.NASDAQ_USER_AGENT;
    vi.resetModules();
    const { earningsSurprise: fresh } = await import("./nasdaq.js");
    const { fetchMock } = mockFetchStatuses([500]);

    await expect(fresh("AAPL")).rejects.toThrow(/nasdaq 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("pins the User-Agent from NASDAQ_USER_AGENT and never rotates, even on a 403", async () => {
    process.env.NASDAQ_USER_AGENT = "Pinned/1.0 Test-UA";
    vi.resetModules();
    const { earningsSurprise: fresh } = await import("./nasdaq.js");
    const { fetchMock, calls } = mockFetchStatuses([403]);

    await expect(fresh("AAPL")).rejects.toThrow(/nasdaq 403/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((calls[0].headers as Record<string, string>)["User-Agent"]).toBe("Pinned/1.0 Test-UA");
  });

  it("rotates only once for a burst of concurrent 403s against the same UA, not once per in-flight request", async () => {
    delete process.env.NASDAQ_USER_AGENT;
    vi.resetModules();
    const { earningsSurprise: fresh } = await import("./nasdaq.js");

    // Every in-flight request starts with the same (not-yet-rotated) UA, so a
    // real block event looks like several concurrent 403s for that one UA.
    // Without a guard against double-rotating on the same block, each of
    // those concurrent 403s would independently advance the pool index, and
    // with enough concurrent requests the pool index would run past its end
    // — causing later requests to throw immediately even though most pool
    // entries were never genuinely tried one at a time.
    let blockedUA: string | null = null;
    const fetchMock = vi.fn((_url: string, opts?: RequestInit) => {
      const ua = (opts!.headers as Record<string, string>)["User-Agent"];
      if (blockedUA === null) blockedUA = ua;
      const blocked = ua === blockedUA;
      return Promise.resolve({
        ok: !blocked,
        status: blocked ? 403 : 200,
        json: async () => ({ data: { earningsSurpriseTable: { rows: [] } } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // 6 concurrent requests is more than enough to exhaust a 5-entry pool
    // one rotation at a time if rotation isn't deduplicated across them.
    const symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"];
    const results = await Promise.allSettled(symbols.map((s) => fresh(s)));

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
