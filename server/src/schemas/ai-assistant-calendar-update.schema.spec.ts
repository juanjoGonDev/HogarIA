import { describe, expect, it } from 'vitest';
import { assistantUpdateCalendarEventSchema } from './ai-assistant-calendar-update.schema.js';

const request = {
  changes: { startTime: null, notes: null },
  assistantAction: {
    operation: 'update_event',
    targetId: 'event-1',
    householdId: null,
    before: {
      householdId: null,
      title: 'Revisión del coche',
      kind: 'appointment',
      date: '2026-10-20',
      startTime: '09:00',
      endTime: '10:00',
      allDay: false,
      color: null,
      notes: 'Taller habitual',
      location: 'Calle Mayor',
      recurrence: 'none',
      recurrenceRule: null,
      exceptions: '[]',
      source: 'user',
      updatedAt: '2026-10-16 09:00:00'
    }
  }
};

describe('assistantUpdateCalendarEventSchema', () => {
  it('accepts allowlisted updates and explicit clear values with a server snapshot', () => {
    expect(assistantUpdateCalendarEventSchema.safeParse(request).success).toBe(true);
  });

  it('rejects missing changes, invalid values, model IDs and unsupported fields', () => {
    const invalid = [
      { ...request, changes: {} },
      { ...request, changes: { id: 'model-id' } },
      { ...request, changes: { kind: 'meal' } },
      { ...request, changes: { date: '2026-02-30' } },
      { ...request, changes: { startTime: '25:00' } },
      { ...request, changes: { recurrence: 'weekly' } },
      {
        ...request,
        assistantAction: { ...request.assistantAction, operation: 'delete' }
      },
      {
        ...request,
        assistantAction: {
          ...request.assistantAction,
          before: { ...request.assistantAction.before, ownerId: 'model-user' }
        }
      }
    ];

    for (const value of invalid) {
      expect(
        assistantUpdateCalendarEventSchema.safeParse(value).success,
        JSON.stringify(value)
      ).toBe(false);
    }
  });

  it('checks paired time ranges and all-day conflicts while allowing clears', () => {
    expect(
      assistantUpdateCalendarEventSchema.safeParse({ ...request, changes: { date: '2026-10-21' } })
        .success
    ).toBe(true);
    expect(
      assistantUpdateCalendarEventSchema.safeParse({
        ...request,
        changes: { startTime: '10:00', endTime: '09:00' }
      }).success
    ).toBe(false);
    expect(
      assistantUpdateCalendarEventSchema.safeParse({
        ...request,
        changes: { allDay: true, startTime: '09:00' }
      }).success
    ).toBe(false);
    expect(
      assistantUpdateCalendarEventSchema.safeParse({
        ...request,
        changes: { allDay: true, startTime: null, endTime: null }
      }).success
    ).toBe(true);
  });
});
