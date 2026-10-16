/**
 * NYSE market-open check, extracted from TopBar so the chart's freshness
 * indicator (see chartFreshness.ts) can share the exact same notion of
 * "open" the top bar already shows. `now` is parameterized so this stays a
 * pure function, testable without mocking the system clock.
 *
 * Naive about holidays/DST edge cases, same as the original — not addressed
 * here, out of scope.
 */
export function nyseMarketStatus(now: Date = new Date()): { label: string; open: boolean } {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 09:30–16:00
  return { label: open ? "NYSE OPEN" : "NYSE CLOSED", open };
}
