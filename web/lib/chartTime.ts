import { TickMarkType, type UTCTimestamp } from "lightweight-charts";

/**
 * lightweight-charts formats a UTCTimestamp by reading the *UTC* calendar
 * components of its Date — by design, it has no opinion on timezones (see
 * its TickMarkFormatter docs: returning `null` falls back to that default).
 * Daily+ bars are deliberately stamped at UTC midnight for their trading day
 * (see server's nasdaq provider / appendTodaysBar), so the default
 * day/month/year tick marks are already correct and must stay untouched;
 * only the intraday Time/TimeWithSeconds tick marks (1D/5D) are wrong — they
 * show the bar's UTC clock time instead of the viewer's local wall clock.
 */
export function localTickMarkFormatter(time: UTCTimestamp, tickMarkType: TickMarkType): string | null {
  if (tickMarkType !== TickMarkType.Time && tickMarkType !== TickMarkType.TimeWithSeconds) return null;
  return new Date(time * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: tickMarkType === TickMarkType.TimeWithSeconds ? "2-digit" : undefined,
    hour12: false,
  });
}

/**
 * Same local-time fix for the crosshair's time-axis label — but only ever
 * wired in for 1D/5D (see ChartWidget), whose bars are real intraday
 * timestamps, not nominal UTC-midnight day labels, so converting the date
 * portion too is safe here (unlike the tick marks above, this one isn't
 * type-gated by lightweight-charts, so it's gated by range at the call site
 * instead).
 */
export function localCrosshairTimeFormatter(time: UTCTimestamp): string {
  return new Date(time * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
