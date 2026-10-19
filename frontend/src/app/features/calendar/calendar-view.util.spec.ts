import {
  calendarViewDates,
  calendarViewRange,
  shiftCalendarAnchor
} from './calendar-view.util';
import { toISODate } from './calendar.util';
import type { CalendarView } from '../../shared/models/calendar.model';

describe('calendar view utilities', () => {
  const anchor = new Date(2026, 9, 4, 18, 30); // Sunday, local time

  it('returns the expected dates for day, four-day, week, month, year, and agenda views', () => {
    const expected: Record<CalendarView, [string, number]> = {
      day: ['2026-10-04', 1],
      fourDays: ['2026-10-04', 4],
      week: ['2026-09-28', 7],
      month: ['2026-09-28', 35],
      year: ['2026-01-01', 365],
      agenda: ['2026-10-04', 365]
    };

    for (const view of Object.keys(expected) as CalendarView[]) {
      const dates = calendarViewDates(view, anchor);
      expect([toISODate(dates[0]), dates.length]).toEqual(expected[view]);
    }
  });

  it('returns inclusive visible bounds and includes leap day in a leap-year view', () => {
    const leapYear = calendarViewRange('year', new Date(2024, 5, 9));
    expect(leapYear).toEqual(['2024-01-01', '2024-12-31']);
    expect(calendarViewDates('year', new Date(2024, 5, 9)).map(toISODate)).toContain('2024-02-29');
    expect(calendarViewRange('fourDays', anchor)).toEqual(['2026-10-04', '2026-10-07']);
  });

  it('moves by the visible period and clamps leap-day navigation safely', () => {
    expect(toISODate(shiftCalendarAnchor('day', anchor, 1))).toBe('2026-10-05');
    expect(toISODate(shiftCalendarAnchor('fourDays', anchor, 1))).toBe('2026-10-08');
    expect(toISODate(shiftCalendarAnchor('week', anchor, -1))).toBe('2026-09-27');
    expect(toISODate(shiftCalendarAnchor('month', anchor, 1))).toBe('2026-11-04');
    expect(toISODate(shiftCalendarAnchor('year', new Date(2024, 1, 29), 1))).toBe('2025-02-28');
    expect(toISODate(shiftCalendarAnchor('agenda', anchor, 1))).toBe('2026-11-04');
  });
});
