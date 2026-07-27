/**
 * Date and time formatting for Mongolia.
 *
 * Rules that apply everywhere in this app:
 *   - Timezone  Asia/Ulaanbaatar (UTC+8, no daylight saving)
 *   - Clock     24-hour, always
 *   - Date      YYYY.MM.DD, the form used in Mongolian business documents
 *
 * The server stores UTC. These functions are the ONLY place that converts, so
 * a timezone bug can only ever exist in one file.
 */

export const UB_TIMEZONE = 'Asia/Ulaanbaatar';

/** Fixed offset in minutes. Mongolia abolished daylight saving in 2017. */
const UB_OFFSET_MINUTES = 8 * 60;

const WEEKDAYS_MN = ['Ня', 'Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя'] as const;
const WEEKDAYS_MN_LONG = [
  'Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба',
] as const;

/**
 * Shift an instant into Ulaanbaatar wall-clock time.
 * The returned Date's UTC fields hold the local values, which makes the
 * getUTC* accessors below read as Ulaanbaatar time.
 */
function toUb(value: Date | string): Date {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Date(d.getTime() + UB_OFFSET_MINUTES * 60_000);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** 2026.07.27 */
export function formatDate(value: Date | string): string {
  const d = toUb(value);
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
}

/** 14:05 — always 24-hour */
export function formatTime(value: Date | string): string {
  const d = toUb(value);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 2026.07.27 14:05 */
export function formatDateTime(value: Date | string): string {
  return `${formatDate(value)} ${formatTime(value)}`;
}

/** Пү, 2026.07.27 */
export function formatDateWithWeekday(value: Date | string): string {
  const d = toUb(value);
  return `${WEEKDAYS_MN[d.getUTCDay()]}, ${formatDate(value)}`;
}

/** Пүрэв */
export function weekdayLong(value: Date | string): string {
  return WEEKDAYS_MN_LONG[toUb(value).getUTCDay()] ?? '';
}

/** Today's date in Ulaanbaatar, as YYYY-MM-DD (the format the database uses). */
export function ubToday(now: Date = new Date()): string {
  const d = toUb(now);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** ISO week number and year in Ulaanbaatar terms. Weeks start on Monday. */
export function ubIsoWeek(now: Date = new Date()): { isoYear: number; isoWeek: number } {
  const d = toUb(now);
  // Move to the Thursday of the current week — the ISO week is the week that
  // contains that Thursday, which is what makes year boundaries come out right.
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(d.getTime());
  thursday.setUTCDate(d.getUTCDate() - dayOfWeek + 3);

  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);

  const isoWeek =
    1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));

  return { isoYear, isoWeek };
}

/** Monday of the ISO week containing `now`, as YYYY-MM-DD in Ulaanbaatar. */
export function ubWeekStart(now: Date = new Date()): string {
  const d = toUb(now);
  const dayOfWeek = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayOfWeek);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "2 цаг 15 мин" — used for visit durations. */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '—';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} цаг`;
  return `${hours} цаг ${minutes} мин`;
}

/** "320 м" / "1.4 км" — distances shown on the route screen. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  if (metres < 1000) return `${Math.round(metres)} м`;
  return `${(metres / 1000).toFixed(1)} км`;
}

/** Day codes stored in doctor_clinics.available_days, shown in Mongolian. */
const DAY_CODE_MN: Record<string, string> = {
  mon: 'Да', tue: 'Мя', wed: 'Лх', thu: 'Пү', fri: 'Ба', sat: 'Бя', sun: 'Ня',
};

export function formatDayCodes(codes: readonly string[] | null | undefined): string {
  if (!codes || codes.length === 0) return '—';
  return codes.map((c) => DAY_CODE_MN[c] ?? c).join(', ');
}
