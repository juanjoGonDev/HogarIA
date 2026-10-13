import { eventTimeLabel } from './calendar.model';
import type { HouseholdEvent } from './calendar.model';

describe('eventTimeLabel', () => {
  const event = (overrides: Partial<HouseholdEvent> = {}) =>
    ({ allDay: false, startTime: '09:15', endTime: null, ...overrides }) as HouseholdEvent;

  it('hides times for all-day events and events without a start time', () => {
    expect(eventTimeLabel(event({ allDay: true }))).toBe('');
    expect(eventTimeLabel(event({ startTime: null }))).toBe('');
  });

  it('shows a start time alone or a complete time range', () => {
    expect(eventTimeLabel(event())).toBe('09:15');
    expect(eventTimeLabel(event({ endTime: '10:00' }))).toBe('09:15–10:00');
  });
});
