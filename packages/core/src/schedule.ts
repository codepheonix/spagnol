/**
 * Timezone helpers without external deps. The owner picks a local wall-clock time in an IANA zone
 * (default Europe/Rome); we store the UTC instant plus the zone id. DST is handled by Intl.
 */

function partsInZone(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") map[p.type] = Number(p.value);
  return { year: map.year!, month: map.month!, day: map.day!, hour: map.hour!, minute: map.minute!, second: map.second! };
}

/** Offset (minutes) of `timeZone` from UTC at the given instant. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Converts a local wall-clock time (YYYY-MM-DD, HH:mm) in `timeZone` to the UTC instant. */
export function localToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined || Number.isNaN(hh) || Number.isNaN(mm)) throw new Error("Invalid date/time.");
  // First guess: treat wall time as UTC, then correct by the zone offset (iterate twice for DST edges).
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  for (let i = 0; i < 2; i++) {
    const offset = zoneOffsetMinutes(guess, timeZone);
    guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0) - offset * 60_000);
  }
  return guess;
}

export function formatInZone(date: Date, timeZone: string, locale = "it-IT"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Next free slot after `from` given weekly slots (weekday 0–6, "HH:mm", tz) and already-taken instants. */
export function nextAvailableSlot(slots: Array<{ weekday: number; time: string; timezone: string }>, from: Date, taken: Set<number>, horizonDays = 60): Date | null {
  if (!slots.length) return null;
  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
    const day = new Date(from.getTime() + dayOffset * 86_400_000);
    for (const slot of slots) {
      const p = partsInZone(day, slot.timezone);
      const localDate = new Date(Date.UTC(p.year, p.month - 1, p.day));
      if (localDate.getUTCDay() !== slot.weekday) continue;
      const instant = localToUtc(`${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, slot.time, slot.timezone);
      if (instant.getTime() <= from.getTime() || taken.has(instant.getTime())) continue;
      return instant;
    }
  }
  return null;
}
