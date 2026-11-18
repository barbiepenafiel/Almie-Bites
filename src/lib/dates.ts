/**
 * Date helpers pinned to Philippine time (Asia/Manila, UTC+8, no DST).
 * Calendar dates are passed around as "YYYY-MM-DD" strings.
 */
export const TIME_ZONE = "Asia/Manila";
const OFFSET = "+08:00";

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Manila calendar date of an instant. */
export function toManilaDate(value: Date | string = new Date()): string {
  return ymdFormatter.format(typeof value === "string" ? new Date(value) : value);
}

export function todayManila(): string {
  return toManilaDate(new Date());
}

/** Parse a YYYY-MM-DD as a UTC-midnight Date (for pure calendar arithmetic). */
function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isValidYmd(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parseYmd(v).getTime());
}

export function addDays(ymd: string, days: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtYmd(d);
}

/** Monday-based week start. */
export function startOfWeek(ymd: string): string {
  const dow = (parseYmd(ymd).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(ymd, -dow);
}

export function startOfMonth(ymd: string): string {
  return ymd.slice(0, 8) + "01";
}

export function endOfMonth(ymd: string): string {
  const d = parseYmd(startOfMonth(ymd));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fmtYmd(d);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((parseYmd(end).getTime() - parseYmd(start).getTime()) / 86_400_000);
}

/** ISO instant for 00:00 Manila on the given date. */
export function manilaStartISO(ymd: string): string {
  return new Date(`${ymd}T00:00:00${OFFSET}`).toISOString();
}

/** ISO instant for 00:00 Manila on the day AFTER the given date (exclusive end). */
export function manilaEndExclusiveISO(ymd: string): string {
  return manilaStartISO(addDays(ymd, 1));
}

/** Value for <input type="datetime-local"> in Manila time. */
export function toManilaDateTimeLocal(value: Date | string = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Convert a datetime-local value (interpreted as Manila time) to ISO. */
export function manilaDateTimeLocalToISO(local: string): string {
  return new Date(`${local}:00${OFFSET}`).toISOString();
}

export function formatDate(
  ymd: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", ...opts }).format(parseYmd(ymd));
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function formatLongToday() {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export type RangePreset = "today" | "yesterday" | "week" | "last7" | "month" | "last30" | "custom";

export interface DateRange {
  start: string;
  end: string;
  preset: RangePreset;
}

export function rangeForPreset(preset: RangePreset, today = todayManila()): DateRange {
  switch (preset) {
    case "today":
      return { start: today, end: today, preset };
    case "yesterday": {
      const y = addDays(today, -1);
      return { start: y, end: y, preset };
    }
    case "week":
      return { start: startOfWeek(today), end: today, preset };
    case "last7":
      return { start: addDays(today, -6), end: today, preset };
    case "month":
      return { start: startOfMonth(today), end: today, preset };
    case "last30":
      return { start: addDays(today, -29), end: today, preset };
    default:
      return { start: today, end: today, preset: "custom" };
  }
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  last7: "Last 7 days",
  month: "This month",
  last30: "Last 30 days",
  custom: "Custom range",
};

export function describeRange(r: { start: string; end: string }) {
  if (r.start === r.end)
    return formatDate(r.start, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return `${formatDate(r.start, { month: "short", day: "numeric" })} – ${formatDate(r.end)}`;
}
