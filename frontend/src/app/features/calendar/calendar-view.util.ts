import type { CalendarView } from '../../shared/models/calendar.model';
import {
  addDays,
  addMonths,
  monthGrid,
  startOfDay,
  startOfWeek,
  toISODate,
  weekDays
} from './calendar.util';

/** All local dates represented by a calendar view; the end is inclusive. */
export function calendarViewDates(view: CalendarView, anchor: Date): Date[] {
  const day = startOfDay(anchor);
  switch (view) {
    case 'day':
      return [day];
    case 'fourDays':
      return Array.from({ length: 4 }, (_, index) => addDays(day, index));
    case 'week':
      return weekDays(day);
    case 'month':
      return monthGrid(day);
    case 'year': {
      const start = startOfDay(new Date(day.getFullYear(), 0, 1));
      const end = new Date(day.getFullYear(), 11, 31);
      return datesBetween(start, end);
    }
    case 'agenda':
      return datesBetween(day, addDays(addMonths(day, 12), -1));
  }
}

/** The inclusive local-date range requested from the calendar APIs. */
export function calendarViewRange(view: CalendarView, anchor: Date): [string, string] {
  const dates = calendarViewDates(view, anchor);
  return [toISODate(dates[0]), toISODate(dates[dates.length - 1])];
}

/** Move by the active view's natural page size, keeping the calendar date local. */
export function shiftCalendarAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  const day = startOfDay(anchor);
  switch (view) {
    case 'day':
      return addDays(day, direction);
    case 'fourDays':
      return addDays(day, direction * 4);
    case 'week':
      return addDays(day, direction * 7);
    case 'month':
    case 'agenda':
      return addMonths(day, direction);
    case 'year':
      return addMonths(day, direction * 12);
  }
}

/** One local calendar date per day; Date arithmetic handles DST without UTC drift. */
function datesBetween(start: Date, end: Date): Date[] {
  const length = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Array.from({ length }, (_, index) => addDays(start, index));
}
