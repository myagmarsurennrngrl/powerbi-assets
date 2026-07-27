/**
 * Timezone correctness.
 *
 * These tests deliberately run assertions about Asia/Ulaanbaatar (UTC+8) while
 * the test process may be in any timezone. That is the point: the helpers must
 * not depend on where the phone or the server happens to be.
 */
import { describe, expect, it } from 'vitest';
import {
  addDays,
  currentWeekday,
  formatDateLongMn,
  formatDateMn,
  formatDateTimeMn,
  formatDurationMn,
  formatTimeMn,
  isoWeek,
  parseDateOnly,
  startOfIsoWeek,
  toLocalDateString,
} from '../../src/lib/datetime';

describe('Ulaanbaatar calendar day', () => {
  it('uses the local day, not the UTC day', () => {
    // 2026-07-27T17:30:00Z is 2026-07-28 01:30 in Ulaanbaatar (UTC+8).
    // A UTC-based implementation would wrongly answer the 27th.
    const instant = new Date('2026-07-27T17:30:00Z');
    expect(toLocalDateString(instant)).toBe('2026-07-28');
  });

  it('handles the start of the local day correctly', () => {
    // 2026-07-27T16:00:00Z is exactly 2026-07-28 00:00 local.
    expect(toLocalDateString(new Date('2026-07-27T16:00:00Z'))).toBe('2026-07-28');
    // One second earlier is still the 27th locally.
    expect(toLocalDateString(new Date('2026-07-27T15:59:59Z'))).toBe('2026-07-27');
  });

  it('renders a morning visit on the correct day', () => {
    // 08:00 Ulaanbaatar = 00:00 UTC the same day.
    const morning = new Date('2026-07-27T00:00:00Z');
    expect(toLocalDateString(morning)).toBe('2026-07-27');
    expect(formatTimeMn(morning)).toBe('08:00');
  });
});

describe('Mongolian formatting', () => {
  it('formats a numeric date', () => {
    expect(formatDateMn('2026-07-27')).toBe('2026.07.27');
    expect(formatDateMn('2026-01-05')).toBe('2026.01.05');
  });

  it('formats a long date with the weekday', () => {
    // 2026-07-27 is a Monday.
    expect(formatDateLongMn('2026-07-27')).toBe('2026 оны 7-р сарын 27, Даваа');
  });

  it('uses a 24-hour clock, never am/pm', () => {
    expect(formatTimeMn(new Date('2026-07-27T06:05:00Z'))).toBe('14:05');
    expect(formatTimeMn(new Date('2026-07-27T11:00:00Z'))).toBe('19:00');
    // Local midnight must be 00:00, not 24:00.
    expect(formatTimeMn(new Date('2026-07-27T16:00:00Z'))).toBe('00:00');
  });

  it('formats date and time together', () => {
    expect(formatDateTimeMn(new Date('2026-07-27T06:05:00Z'))).toBe('2026.07.27 14:05');
  });

  it('formats durations in Mongolian', () => {
    expect(formatDurationMn(0)).toBe('0 мин');
    expect(formatDurationMn(90)).toBe('2 мин');
    expect(formatDurationMn(25 * 60)).toBe('25 мин');
    expect(formatDurationMn(85 * 60)).toBe('1 ц 25 мин');
    expect(formatDurationMn(null)).toBe('—');
    expect(formatDurationMn(-5)).toBe('—');
  });
});

describe('date-only parsing', () => {
  it('does not shift the day in a negative-offset timezone', () => {
    // The classic bug: new Date('2026-07-27') is UTC midnight, which renders
    // as the 26th anywhere west of Greenwich.
    const parsed = parseDateOnly('2026-07-27');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(6); // July
    expect(parsed.getDate()).toBe(27);
  });
});

describe('ISO weeks', () => {
  it('computes the week of a mid-year Monday', () => {
    expect(isoWeek('2026-07-27')).toEqual({ year: 2026, week: 31 });
  });

  it('handles the new-year boundary the ISO way', () => {
    // 2026-01-01 is a Thursday, so it belongs to week 1 of 2026.
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
    // 2025-12-29 is a Monday belonging to ISO week 1 of 2026.
    expect(isoWeek('2025-12-29')).toEqual({ year: 2026, week: 1 });
  });

  it('finds the Monday that starts a week', () => {
    expect(startOfIsoWeek('2026-07-27')).toBe('2026-07-27'); // already Monday
    expect(startOfIsoWeek('2026-07-30')).toBe('2026-07-27'); // Thursday
    expect(startOfIsoWeek('2026-08-02')).toBe('2026-07-27'); // Sunday
    expect(startOfIsoWeek('2026-08-03')).toBe('2026-08-03'); // next Monday
  });
});

describe('date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-07-27', 6)).toBe('2026-08-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });
});

describe('current weekday', () => {
  it('returns an ISO weekday between 1 and 7', () => {
    const day = currentWeekday();
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(7);
  });
});
