import { setDateLocale } from '../../core/time';
import {
  addDays,
  addMonths,
  daysInMonth,
  diffInDays,
  formatNumber,
  isSameDay,
  isSameMonth,
  labels,
  monthGrid,
  parseISODate,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toISODate,
  weekDays
} from './calendar.util';

describe('calendar utilities', () => {
  beforeEach(() => setDateLocale('es-ES'));
  afterEach(() => setDateLocale('es-ES'));

  it('formats numbers using the locale active after the utility module was imported', () => {
    expect(formatNumber(1450)).toBe('1.450');

    setDateLocale('en-GB');

    expect(formatNumber(1450)).toBe('1,450');

    setDateLocale('es-ES');

    expect(formatNumber(1450)).toBe('1.450');
  });

  it('preserves local ISO days and rejects malformed or impossible dates', () => {
    const local = new Date(2026, 1, 3, 23, 59, 59);
    expect(toISODate(local)).toBe('2026-02-03');
    expect(parseISODate('2024-02-29')).toEqual(new Date(2024, 1, 29));
    expect(parseISODate('2023-02-29')).toBeNull();
    expect(parseISODate('2026-02-31')).toBeNull();
    expect(parseISODate('2026-2-03')).toBeNull();
    expect(parseISODate('')).toBeNull();
    expect(parseISODate(null)).toBeNull();
    expect(parseISODate(undefined)).toBeNull();
  });

  it('normalizes local days and crosses month, leap-day and DST calendar boundaries', () => {
    const lateDay = new Date(2026, 2, 28, 23, 30);
    expect(toISODate(startOfDay(lateDay))).toBe('2026-03-28');
    expect(startOfDay(lateDay).getHours()).toBe(0);
    expect(toISODate(addDays(lateDay, 2))).toBe('2026-03-30');
    expect(toISODate(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31');
    expect(diffInDays(new Date(2026, 2, 30), new Date(2026, 2, 29))).toBe(1);
    expect(diffInDays(new Date(2026, 2, 29), new Date(2026, 2, 30))).toBe(-1);
    expect(diffInDays(new Date(2026, 2, 29, 22), new Date(2026, 2, 29, 1))).toBe(0);
  });

  it('adds months without overflowing month ends and counts leap years', () => {
    expect(toISODate(addMonths(new Date(2025, 0, 31), 1))).toBe('2025-02-28');
    expect(toISODate(addMonths(new Date(2024, 0, 31), 1))).toBe('2024-02-29');
    expect(toISODate(addMonths(new Date(2026, 0, 31), -1))).toBe('2025-12-31');
    expect(daysInMonth(new Date(2024, 1, 1))).toBe(29);
    expect(daysInMonth(new Date(2023, 1, 1))).toBe(28);
    expect(daysInMonth(new Date(2026, 0, 1))).toBe(31);
  });

  it('starts weeks on Monday and returns full Monday-to-Sunday weeks', () => {
    const monday = startOfWeek(new Date(2026, 8, 20));
    expect(toISODate(monday)).toBe('2026-09-14');
    expect(toISODate(startOfWeek(new Date(2026, 8, 14)))).toBe('2026-09-14');
    expect(weekDays(new Date(2026, 8, 20)).map(toISODate)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20'
    ]);
    expect(toISODate(startOfMonth(new Date(2026, 8, 20)))).toBe('2026-09-01');
  });

  it('compares local days and months without depending on time of day', () => {
    expect(isSameDay(new Date(2026, 8, 16, 1), new Date(2026, 8, 16, 22))).toBeTrue();
    expect(isSameDay(new Date(2026, 8, 16), new Date(2026, 8, 17))).toBeFalse();
    expect(isSameMonth(new Date(2026, 8, 1), new Date(2026, 8, 30))).toBeTrue();
    expect(isSameMonth(new Date(2026, 8, 30), new Date(2026, 9, 1))).toBeFalse();
  });

  it('builds complete month grids with four, five or six Monday-first rows', () => {
    const fixtures = [
      { anchor: new Date(2021, 1, 1), rows: 4 },
      { anchor: new Date(2026, 8, 1), rows: 5 },
      { anchor: new Date(2020, 7, 1), rows: 6 }
    ];

    for (const { anchor, rows } of fixtures) {
      const grid = monthGrid(anchor);
      expect(grid.length).toBe(rows * 7);
      expect(grid[0].getDay()).toBe(1);
      expect(grid[grid.length - 1].getDay()).toBe(0);
      expect(grid.some((day) => isSameMonth(day, anchor) && day.getDate() === daysInMonth(anchor)))
        .withContext(`month grid should contain the last date of ${toISODate(anchor)}`)
        .toBeTrue();
    }
  });

  it('formats calendar labels for the active Spanish and English locale', () => {
    const day = new Date(2026, 8, 16);
    const week = { start: new Date(2026, 8, 14), end: new Date(2026, 8, 20) };
    const monthBoundary = { start: new Date(2026, 7, 31), end: new Date(2026, 8, 6) };

    expect(labels.month(day)).toContain('septiembre');
    expect(labels.dayOfWeekShort(day)).toBe('MIÉ');
    expect(labels.longDay(day)).toContain('miércoles');
    expect(labels.dayOfMonth(day)).toBe('16');
    expect(labels.fullDate(day)).toContain('septiembre');
    expect(labels.weekRange(week.start, week.end)).toContain('septiembre');
    expect(labels.weekRange(monthBoundary.start, monthBoundary.end)).toContain('ago');
    expect(labels.weekRange(monthBoundary.start, monthBoundary.end)).toContain('sept');

    setDateLocale('en-GB');

    expect(labels.month(day)).toContain('September');
    expect(labels.dayOfWeekShort(day)).toBe('WED');
    expect(labels.longDay(day)).toContain('Wednesday');
    expect(labels.dayOfMonth(day)).toBe('16');
    expect(labels.fullDate(day)).toContain('September');
    expect(labels.weekRange(week.start, week.end)).toContain('September');
    expect(labels.weekRange(monthBoundary.start, monthBoundary.end)).toContain('Aug');
    expect(labels.weekRange(monthBoundary.start, monthBoundary.end)).toContain('Sept');
  });

  it('rounds positive and negative quantities and keeps zero stable', () => {
    expect(formatNumber(1.4)).toBe('1');
    expect(formatNumber(1.5)).toBe('2');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-1.6)).toBe('-2');
    expect(formatNumber(-1.4)).toBe('-1');
  });
});
