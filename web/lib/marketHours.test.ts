import { describe, expect, it } from "vitest";
import { nyseMarketStatus } from "./marketHours";

describe("nyseMarketStatus", () => {
  it("is open on a weekday during market hours (Wed 2024-01-10 10:00 NY)", () => {
    // 15:00 UTC = 10:00 ET (EST, UTC-5) in January.
    const now = new Date("2024-01-10T15:00:00Z");
    expect(nyseMarketStatus(now)).toEqual({ label: "NYSE OPEN", open: true });
  });

  it("is closed on a weekday before market open (Wed 2024-01-10 09:00 NY)", () => {
    // 14:00 UTC = 09:00 ET.
    const now = new Date("2024-01-10T14:00:00Z");
    expect(nyseMarketStatus(now)).toEqual({ label: "NYSE CLOSED", open: false });
  });

  it("is closed on a weekday after market close (Wed 2024-01-10 17:00 NY)", () => {
    // 22:00 UTC = 17:00 ET.
    const now = new Date("2024-01-10T22:00:00Z");
    expect(nyseMarketStatus(now)).toEqual({ label: "NYSE CLOSED", open: false });
  });

  it("is closed on a weekend day even during would-be market hours (Sat 2024-01-13 10:00 NY)", () => {
    // 15:00 UTC = 10:00 ET.
    const now = new Date("2024-01-13T15:00:00Z");
    expect(nyseMarketStatus(now)).toEqual({ label: "NYSE CLOSED", open: false });
  });

  it("is open right at the open boundary (09:30 NY)", () => {
    // 14:30 UTC = 09:30 ET.
    const now = new Date("2024-01-10T14:30:00Z");
    expect(nyseMarketStatus(now)).toEqual({ label: "NYSE OPEN", open: true });
  });

  it("is closed right at the close boundary (16:00 NY)", () => {
    // 21:00 UTC = 16:00 ET.
    const now = new Date("2024-01-10T21:00:00Z");
    expect(nyseMarketStatus(now)).toEqual({ label: "NYSE CLOSED", open: false });
  });

  it("defaults `now` to the current time when omitted", () => {
    const result = nyseMarketStatus();
    expect(typeof result.open).toBe("boolean");
    expect(["NYSE OPEN", "NYSE CLOSED"]).toContain(result.label);
  });
});
