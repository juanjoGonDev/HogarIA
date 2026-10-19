import { describe, expect, it } from 'vitest';
import {
  householdTaskOccurrencesSchema,
  householdTaskWeekQuerySchema,
  householdTaskWeekWriteSchema
} from './household-task.schema.js';

const task = {
  id: 'clean-kitchen-monday',
  title: 'Limpiar la cocina',
  details: null,
  spaceId: 'kitchen',
  scheduledDate: '2026-10-05',
  assignedMemberId: 'member-a',
  priority: 'medium',
  completed: false
};

describe('household task week contracts', () => {
  it('accepts Monday-started weeks with occurrences inside their date range', () => {
    expect(householdTaskWeekQuerySchema.parse({ weekStart: '2026-10-05' })).toEqual({
      weekStart: '2026-10-05'
    });
    expect(
      householdTaskWeekWriteSchema.parse({ baseVersion: 0, weekStart: '2026-10-05', tasks: [task] })
    ).toMatchObject({ weekStart: '2026-10-05', tasks: [task] });
  });

  it('rejects malformed dates, non-Monday starts, and tasks outside the selected week', () => {
    expect(householdTaskWeekQuerySchema.safeParse({ weekStart: '2026-10-06' }).success).toBe(false);
    expect(householdTaskWeekQuerySchema.safeParse({ weekStart: '2026-02-30' }).success).toBe(false);
    expect(
      householdTaskWeekWriteSchema.safeParse({
        baseVersion: 0,
        weekStart: '2026-10-05',
        tasks: [{ ...task, scheduledDate: '2026-10-12' }]
      }).success
    ).toBe(false);
  });

  it('rejects repeated occurrence ids, blank titles, and oversized weekly lists', () => {
    expect(householdTaskOccurrencesSchema.safeParse([task, { ...task }]).success).toBe(false);
    expect(householdTaskOccurrencesSchema.safeParse([{ ...task, title: '  ' }]).success).toBe(
      false
    );
    expect(
      householdTaskOccurrencesSchema.safeParse(
        Array.from({ length: 201 }, (_, index) => ({ ...task, id: `task-${index}` }))
      ).success
    ).toBe(false);
  });

  it('normalizes legacy omissions to medium and rejects unknown priorities', () => {
    const { priority: _priority, ...legacyTask } = task;

    expect(householdTaskOccurrencesSchema.parse([legacyTask])[0]).toMatchObject({
      ...legacyTask,
      priority: 'medium'
    });
    expect(
      householdTaskOccurrencesSchema.safeParse([{ ...task, priority: 'urgent' }]).success
    ).toBe(false);
  });
});
