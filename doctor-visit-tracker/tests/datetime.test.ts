/**
 * Mongolian date and time formatting.
 *
 * Every calculation in the app depends on these being right: an off-by-one in
 * the timezone would put a visit on the wrong day and silently corrupt the KPI.
 * The tests are written from UTC instants so they pass on any machine,
 * whatever its own timezone is set to.
 */
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDateWithWeekday,
  formatDayCodes,
  formatDistance,
  formatDuration,
  formatTime,
  ubIsoWeek,
  ubToday,
  ubWeekStart,
  weekdayLong,
} from '@/i18n/datetime';

describe('formatting in Asia/Ulaanbaatar (UTC+8)', () => {
  it('shows the date in YYYY.MM.DD', () => {
    expect(formatDate('2026-07-27T02:00:00Z')).toBe('2026.07.27');
  });

  it('adds 8 hours when converting from UTC', () => {
    expect(formatTime('2026-07-27T02:00:00Z')).toBe('10:00');
    expect(formatTime('2026-07-27T06:05:00Z')).toBe('14:05');
  });

  it('always uses the 24-hour clock', () => {
    expect(formatTime('2026-07-27T13:30:00Z')).toBe('21:30');
    expect(formatTime('2026-07-27T15:45:00Z')).toBe('23:45');
  });

  /**
   * 22:30 UTC is already the next morning in Ulaanbaatar. Getting this wrong
   * would file an evening visit under the wrong business day.
   */
  it('rolls over to the next day late in the UTC evening', () => {
    expect(formatDateTime('2026-07-27T22:30:00Z')).toBe('2026.07.28 06:30');
    expect(ubToday(new Date('2026-07-27T22:30:00Z'))).toBe('2026-07-28');
  });

  it('does not roll over just before 16:00 UTC', () => {
    expect(ubToday(new Date('2026-07-27T15:59:00Z'))).toBe('2026-07-27');
    expect(ubToday(new Date('2026-07-27T16:00:00Z'))).toBe('2026-07-28');
  });

  it('names the weekday in Mongolian', () => {
    // 2026-07-27 is a Monday.
    expect(formatDateWithWeekday('2026-07-27T02:00:00Z')).toBe('Да, 2026.07.27');
    expect(weekdayLong('2026-07-27T02:00:00Z')).toBe('Даваа');
    expect(weekdayLong('2026-07-31T02:00:00Z')).toBe('Баасан');
    expect(weekdayLong('2026-08-02T02:00:00Z')).toBe('Ням');
  });
});

describe('ISO weeks', () => {
  it('numbers an ordinary week', () => {
    expect(ubIsoWeek(new Date('2026-07-27T02:00:00Z'))).toEqual({ isoYear: 2026, isoWeek: 31 });
  });

  it('starts the week on Monday', () => {
    // Sunday 2026-08-02 still belongs to week 31.
    expect(ubIsoWeek(new Date('2026-08-02T02:00:00Z'))).toEqual({ isoYear: 2026, isoWeek: 31 });
    // Monday 2026-08-03 begins week 32.
    expect(ubIsoWeek(new Date('2026-08-03T02:00:00Z'))).toEqual({ isoYear: 2026, isoWeek: 32 });
  });

  it('handles the year boundary the ISO way', () => {
    // 1 January 2027 is a Friday, so it belongs to week 53 of 2026.
    expect(ubIsoWeek(new Date('2027-01-01T02:00:00Z'))).toEqual({ isoYear: 2026, isoWeek: 53 });
    // 4 January 2027 is the Monday that starts week 1 of 2027.
    expect(ubIsoWeek(new Date('2027-01-04T02:00:00Z'))).toEqual({ isoYear: 2027, isoWeek: 1 });
  });

  it('returns the Monday of the week', () => {
    expect(ubWeekStart(new Date('2026-07-29T02:00:00Z'))).toBe('2026-07-27');
    expect(ubWeekStart(new Date('2026-08-02T02:00:00Z'))).toBe('2026-07-27');
    expect(ubWeekStart(new Date('2026-08-03T02:00:00Z'))).toBe('2026-08-03');
  });

  it('uses Ulaanbaatar days, not UTC days, at the week boundary', () => {
    // Sunday 22:00 UTC is already Monday 06:00 in Ulaanbaatar — a new week.
    expect(ubWeekStart(new Date('2026-08-02T22:00:00Z'))).toBe('2026-08-03');
  });
});

describe('durations and distances', () => {
  it('formats durations in Mongolian', () => {
    expect(formatDuration(0)).toBe('0 мин');
    expect(formatDuration(45)).toBe('45 мин');
    expect(formatDuration(60)).toBe('1 цаг');
    expect(formatDuration(135)).toBe('2 цаг 15 мин');
  });

  it('returns a dash rather than nonsense for bad input', () => {
    expect(formatDuration(-5)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('switches from metres to kilometres at 1000 m', () => {
    expect(formatDistance(0)).toBe('0 м');
    expect(formatDistance(320.4)).toBe('320 м');
    expect(formatDistance(999)).toBe('999 м');
    expect(formatDistance(1000)).toBe('1.0 км');
    expect(formatDistance(1420)).toBe('1.4 км');
  });

  it('returns a dash for bad distances', () => {
    expect(formatDistance(-1)).toBe('—');
    expect(formatDistance(Number.NaN)).toBe('—');
  });
});

describe('formatDayCodes', () => {
  it('shows the stored English codes in Mongolian', () => {
    expect(formatDayCodes(['mon', 'wed', 'fri'])).toBe('Да, Лх, Ба');
    expect(formatDayCodes(['sat'])).toBe('Бя');
  });

  it('handles missing data', () => {
    expect(formatDayCodes([])).toBe('—');
    expect(formatDayCodes(null)).toBe('—');
    expect(formatDayCodes(undefined)).toBe('—');
  });
});
