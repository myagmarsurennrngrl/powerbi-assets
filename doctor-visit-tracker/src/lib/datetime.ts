/**
 * Dates and times, always in Asia/Ulaanbaatar, always on a 24-hour clock.
 *
 * Why this file exists: "today" is a business concept, not a UTC concept. A
 * visit at 08:00 on Monday in Ulaanbaatar is 00:00 UTC on Monday — but a visit
 * at 01:00 Tuesday local time is 17:00 Monday UTC. Deciding "which day is this
 * visit on" with the device's default locale, or with UTC, produces wrong
 * plans and wrong KPI periods. Every date question goes through here.
 *
 * The database mirrors this with public.fn_local_date().
 */

export const TIMEZONE = 'Asia/Ulaanbaatar';

/** Parts of a timestamp as they are in Ulaanbaatar, regardless of device locale. */
function ulaanbaatarParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 1 = Monday ... 7 = Sunday (ISO)
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const isoWeekday: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" in some engines; normalise it to 0.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: isoWeekday[parts.weekday ?? 'Mon'] ?? 1,
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** ISO date string (YYYY-MM-DD) for the Ulaanbaatar calendar day. */
export function toLocalDateString(date: Date = new Date()): string {
  const p = ulaanbaatarParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Today's date in Ulaanbaatar, as YYYY-MM-DD. */
export function todayLocal(): string {
  return toLocalDateString(new Date());
}

/** Mongolian numeric date: 2026.07.27 */
export function formatDateMn(date: Date | string): string {
  const d = typeof date === 'string' ? parseDateOnly(date) : date;
  const p = ulaanbaatarParts(d);
  return `${p.year}.${pad(p.month)}.${pad(p.day)}`;
}

/** Mongolian long date: 2026 оны 7-р сарын 27, Даваа */
export function formatDateLongMn(date: Date | string): string {
  const d = typeof date === 'string' ? parseDateOnly(date) : date;
  const p = ulaanbaatarParts(d);
  const weekdays = ['Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням'];
  return `${p.year} оны ${p.month}-р сарын ${p.day}, ${weekdays[p.weekday - 1]}`;
}

/** 24-hour time: 14:05 */
export function formatTimeMn(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const p = ulaanbaatarParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Date and 24-hour time: 2026.07.27 14:05 */
export function formatDateTimeMn(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return `${formatDateMn(d)} ${formatTimeMn(d)}`;
}

/** Duration as цаг:минут, e.g. 1 ц 25 мин / 25 мин */
export function formatDurationMn(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин`;
  return `${hours} ц ${minutes} мин`;
}

/**
 * Parse a plain YYYY-MM-DD (a `date` column) without letting the device
 * timezone shift it. `new Date('2026-07-27')` is parsed as UTC midnight, which
 * in a negative-offset timezone renders as the 26th. Building it at local noon
 * avoids that class of off-by-one-day bug entirely.
 */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12, 0, 0);
}

/** ISO week number and ISO week-numbering year for an Ulaanbaatar date. */
export function isoWeek(date: Date | string = new Date()): { year: number; week: number } {
  const p = typeof date === 'string'
    ? ulaanbaatarParts(parseDateOnly(date))
    : ulaanbaatarParts(date);

  // Work in UTC on a date built from the LOCAL calendar parts, so the
  // arithmetic cannot be shifted by the device's own offset.
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNumber = p.weekday; // 1..7, Monday first

  // ISO: the week containing the Thursday of the current week defines the year.
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const isoYear = target.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstThursdayDay);

  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year: isoYear, week };
}

/** Monday of the ISO week containing the given date, as YYYY-MM-DD. */
export function startOfIsoWeek(date: Date | string = new Date()): string {
  const p = typeof date === 'string'
    ? ulaanbaatarParts(parseDateOnly(date))
    : ulaanbaatarParts(date);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day));
  monday.setUTCDate(monday.getUTCDate() - (p.weekday - 1));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** Add whole days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const result = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  result.setUTCDate(result.getUTCDate() + days);
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

/** Current ISO weekday in Ulaanbaatar (1 = Monday ... 7 = Sunday). */
export function currentWeekday(): number {
  return ulaanbaatarParts(new Date()).weekday;
}
