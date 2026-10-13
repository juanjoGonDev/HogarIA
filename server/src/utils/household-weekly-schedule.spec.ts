import { describe, expect, it } from 'vitest';
import {
  nextHouseholdWeeklyOccurrence,
  type HouseholdWeeklySchedule
} from './household-weekly-schedule.js';

const schedule = (overrides: Partial<HouseholdWeeklySchedule> = {}): HouseholdWeeklySchedule => ({
  weekday: 1,
  localTime: '09:15',
  timeZone: 'Europe/Madrid',
  ...overrides
});

describe('household weekly schedule', () => {
  it('uses the explicit IANA zone to calculate the next local weekday and UTC instant', () => {
    expect(nextHouseholdWeeklyOccurrence(schedule(), new Date('2026-04-05T10:00:00.000Z'))).toEqual(
      {
        scheduledLocalDate: '2026-04-06',
        localDate: '2026-04-06',
        localTime: '09:15',
        timeZone: 'Europe/Madrid',
        utcInstant: '2026-04-06T07:15:00.000Z',
        occurrenceKey: 'household-weekly:Europe/Madrid:2026-04-06:1:09:15'
      }
    );
  });

  it('returns the current week before the boundary, but strictly advances at and after it', () => {
    const monday = schedule({ timeZone: 'UTC' });

    expect(
      nextHouseholdWeeklyOccurrence(monday, new Date('2026-10-12T09:14:59.999Z')).utcInstant
    ).toBe('2026-10-12T09:15:00.000Z');
    expect(
      nextHouseholdWeeklyOccurrence(monday, new Date('2026-10-12T09:15:00.000Z')).utcInstant
    ).toBe('2026-10-19T09:15:00.000Z');
    expect(
      nextHouseholdWeeklyOccurrence(monday, new Date('2026-10-12T09:15:00.001Z')).utcInstant
    ).toBe('2026-10-19T09:15:00.000Z');
  });

  it('rolls a Friday occurrence across the year boundary', () => {
    expect(
      nextHouseholdWeeklyOccurrence(
        schedule({ weekday: 5, localTime: '08:00', timeZone: 'UTC' }),
        new Date('2026-12-31T23:59:59.999Z')
      )
    ).toMatchObject({
      scheduledLocalDate: '2027-01-01',
      localDate: '2027-01-01',
      utcInstant: '2027-01-01T08:00:00.000Z'
    });
  });

  it('moves a nonexistent Europe/Madrid spring time to the first valid local minute after it', () => {
    expect(
      nextHouseholdWeeklyOccurrence(
        schedule({ weekday: 7, localTime: '02:30' }),
        new Date('2026-03-28T12:00:00.000Z')
      )
    ).toMatchObject({
      scheduledLocalDate: '2026-03-29',
      localDate: '2026-03-29',
      localTime: '03:00',
      utcInstant: '2026-03-29T01:00:00.000Z'
    });
  });

  it('chooses only the first occurrence of a repeated Europe/Madrid fall time', () => {
    const sundayAt0230 = schedule({ weekday: 7, localTime: '02:30' });

    expect(
      nextHouseholdWeeklyOccurrence(sundayAt0230, new Date('2026-10-24T12:00:00.000Z'))
    ).toMatchObject({
      scheduledLocalDate: '2026-10-25',
      localDate: '2026-10-25',
      localTime: '02:30',
      utcInstant: '2026-10-25T00:30:00.000Z'
    });
    // At 00:45Z local time has folded back to 02:45. Do not execute a second time at 01:30Z.
    expect(
      nextHouseholdWeeklyOccurrence(sundayAt0230, new Date('2026-10-25T00:45:00.000Z'))
    ).toMatchObject({
      scheduledLocalDate: '2026-11-01',
      localDate: '2026-11-01',
      localTime: '02:30',
      utcInstant: '2026-11-01T01:30:00.000Z'
    });
  });

  it('returns a deterministic occurrence key for retries before the same occurrence', () => {
    const monday = schedule({ timeZone: 'UTC' });
    const earlier = nextHouseholdWeeklyOccurrence(monday, new Date('2026-10-11T10:00:00.000Z'));
    const retry = nextHouseholdWeeklyOccurrence(monday, new Date('2026-10-12T09:14:59.999Z'));

    expect(retry.occurrenceKey).toBe(earlier.occurrenceKey);
    expect(
      nextHouseholdWeeklyOccurrence(monday, new Date('2026-10-12T09:15:00.000Z')).occurrenceKey
    ).not.toBe(earlier.occurrenceKey);
  });

  it.each([
    [{ weekday: 0, localTime: '09:15', timeZone: 'UTC' }, new Date('2026-10-11T10:00:00.000Z')],
    [{ weekday: 8, localTime: '09:15', timeZone: 'UTC' }, new Date('2026-10-11T10:00:00.000Z')],
    [{ weekday: 1.5, localTime: '09:15', timeZone: 'UTC' }, new Date('2026-10-11T10:00:00.000Z')],
    [{ weekday: 1, localTime: '9:15', timeZone: 'UTC' }, new Date('2026-10-11T10:00:00.000Z')],
    [{ weekday: 1, localTime: '24:00', timeZone: 'UTC' }, new Date('2026-10-11T10:00:00.000Z')],
    [{ weekday: 1, localTime: '09:60', timeZone: 'UTC' }, new Date('2026-10-11T10:00:00.000Z')],
    [
      { weekday: 1, localTime: '09:15', timeZone: 'Not/AZone' },
      new Date('2026-10-11T10:00:00.000Z')
    ],
    [{ weekday: 1, localTime: '09:15', timeZone: '' }, new Date('2026-10-11T10:00:00.000Z')],
    [{ weekday: 1, localTime: '09:15' }, new Date('2026-10-11T10:00:00.000Z')],
    [{ weekday: 1, localTime: '09:15', timeZone: 'UTC' }, new Date(Number.NaN)]
  ] as const)('rejects invalid or missing scheduling input: %o', (invalid, now) => {
    expect(() => nextHouseholdWeeklyOccurrence(invalid as HouseholdWeeklySchedule, now)).toThrow();
  });
});
