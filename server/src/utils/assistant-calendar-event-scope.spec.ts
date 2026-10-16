import { describe, expect, it } from 'vitest';
import {
  comparableAssistantCalendarEventTitle,
  matchAssistantCalendarEvents
} from './assistant-calendar-event-scope.js';

const event = (
  id: string,
  title: string,
  date = '2026-10-20',
  startTime: string | null = '09:00'
) => ({
  id,
  title,
  date,
  startTime
});

describe('assistant-calendar-event-scope', () => {
  it('normalizes equivalent Unicode titles without changing the stored value', () => {
    expect(comparableAssistantCalendarEventTitle('  REVISIO\u0301N  ')).toBe('revisión');
    expect(comparableAssistantCalendarEventTitle('revisión')).toBe('revisión');
  });

  it('resolves only exact owned-event candidate fields and leaves ambiguity visible', () => {
    const rows = [
      event('event-1', 'Revisión del coche'),
      event('event-2', 'Revisión del coche', '2026-10-21'),
      event('event-3', 'Revisión del coche', '2026-10-20', '10:00'),
      event('event-4', 'Otro evento')
    ];

    expect(
      matchAssistantCalendarEvents(rows, {
        targetTitle: '  REVISIÓN DEL COCHE ',
        targetDate: '2026-10-20',
        targetStartTime: '09:00'
      }).map(({ id }) => id)
    ).toEqual(['event-1']);

    expect(
      matchAssistantCalendarEvents([...rows, event('event-5', 'Revisión del coche')], {
        targetTitle: 'Revisión del coche',
        targetDate: '2026-10-20',
        targetStartTime: '09:00'
      }).map(({ id }) => id)
    ).toEqual(['event-1', 'event-5']);
  });
});
