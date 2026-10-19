import { describe, expect, it } from 'vitest';
import { assignHouseholdTasksFairly } from './household-task-assignment.js';

interface TaskInput {
  id: string;
  title: string;
  scheduledDate: string;
  assignedMemberId: string | null;
  completed: boolean;
}

function task(id: string, scheduledDate: string): TaskInput {
  return { id, title: `Task ${id}`, scheduledDate, assignedMemberId: null, completed: false };
}

function constantRandom(value = 0.5): () => number {
  return () => value;
}

describe('assignHouseholdTasksFairly', () => {
  it('keeps empty input empty even without eligible members', () => {
    expect(assignHouseholdTasksFairly([], [])).toEqual({ ok: true, tasks: [] });
  });

  it('balances a seven-day week and never assigns the same person on consecutive dates', () => {
    const input = [
      task('mon', '2026-10-05'),
      task('tue', '2026-10-06'),
      task('wed', '2026-10-07'),
      task('thu', '2026-10-08'),
      task('fri', '2026-10-09'),
      task('sat', '2026-10-10'),
      task('sun', '2026-10-11')
    ];

    const result = assignHouseholdTasksFairly(input, ['ada', 'lin'], constantRandom(0.42));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const counts = new Map<string, number>();
    for (const item of result.tasks) {
      const member = item.assignedMemberId!;
      counts.set(member, (counts.get(member) ?? 0) + 1);
    }
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
    for (let index = 1; index < result.tasks.length; index += 1) {
      expect(result.tasks[index].assignedMemberId).not.toBe(
        result.tasks[index - 1].assignedMemberId
      );
    }
  });

  it('preserves input order and permits multiple occurrences on a day', () => {
    const input = [
      task('late', '2026-10-06'),
      task('first', '2026-10-05'),
      task('same-day', '2026-10-05')
    ];
    const result = assignHouseholdTasksFairly(input, ['ada', 'lin'], constantRandom(0.2));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks.map(({ id }) => id)).toEqual(['late', 'first', 'same-day']);
    expect(
      result.tasks.every(({ assignedMemberId }) => ['ada', 'lin'].includes(assignedMemberId!))
    ).toBe(true);
    const dayOne = result.tasks.filter(({ scheduledDate }) => scheduledDate === '2026-10-05');
    expect(dayOne).toHaveLength(2);
    expect(dayOne[0].assignedMemberId).toBe(dayOne[1].assignedMemberId);
    expect(
      result.tasks.find(({ scheduledDate }) => scheduledDate === '2026-10-06')?.assignedMemberId
    ).not.toBe(dayOne[0].assignedMemberId);
  });

  it('allows one member when occurrences are on non-consecutive dates', () => {
    const result = assignHouseholdTasksFairly(
      [task('monday', '2026-10-05'), task('wednesday', '2026-10-07')],
      ['ada'],
      constantRandom()
    );

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.tasks.map(({ assignedMemberId }) => assignedMemberId)).toEqual(['ada', 'ada']);
  });

  it('avoids previous-week assignees at the boundary while keeping a balanced solution', () => {
    const input = [task('tuesday', '2026-10-13'), task('monday', '2026-10-12')];
    const previousDayAssignment = {
      scheduledDate: '2026-10-11',
      assignedMemberIds: ['ada']
    };

    const result = assignHouseholdTasksFairly(
      input,
      ['ada', 'lin'],
      constantRandom(),
      previousDayAssignment
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks.map(({ id }) => id)).toEqual(['tuesday', 'monday']);
    expect(result.tasks.find(({ id }) => id === 'monday')?.assignedMemberId).toBe('lin');
    expect(result.tasks.find(({ id }) => id === 'tuesday')?.assignedMemberId).toBe('ada');
    expect(result.tasks.map(({ assignedMemberId }) => assignedMemberId).sort()).toEqual([
      'ada',
      'lin'
    ]);
  });

  it('fails clearly when a boundary assignment makes every valid distribution impossible', () => {
    expect(
      assignHouseholdTasksFairly([task('monday', '2026-10-12')], ['ada'], constantRandom(), {
        scheduledDate: '2026-10-11',
        assignedMemberIds: ['ada']
      })
    ).toEqual({ ok: false, reason: 'no-valid-distribution' });
  });

  it('does not apply a previous assignment across a date gap or for inactive member IDs', () => {
    const acrossGap = assignHouseholdTasksFairly(
      [task('monday', '2026-10-12')],
      ['ada'],
      constantRandom(),
      { scheduledDate: '2026-10-10', assignedMemberIds: ['ada'] }
    );
    const inactive = assignHouseholdTasksFairly(
      [task('monday', '2026-10-12')],
      ['ada'],
      constantRandom(),
      { scheduledDate: '2026-10-11', assignedMemberIds: ['inactive-member', '', 'inactive-member'] }
    );

    expect(acrossGap.ok).toBe(true);
    expect(inactive.ok).toBe(true);
    if (acrossGap.ok) expect(acrossGap.tasks[0].assignedMemberId).toBe('ada');
    if (inactive.ok) expect(inactive.tasks[0].assignedMemberId).toBe('ada');
  });

  it('rejects malformed previous-day dates and leaves previous assignments untouched', () => {
    const tasks = [task('monday', '2026-10-12')];
    const invalid = assignHouseholdTasksFairly(tasks, ['ada'], constantRandom(), {
      scheduledDate: '2026-02-30',
      assignedMemberIds: ['ada']
    });
    const previousDayAssignment = {
      scheduledDate: '2026-10-11',
      assignedMemberIds: ['ada']
    };
    const before = structuredClone(previousDayAssignment);

    const result = assignHouseholdTasksFairly(
      [task('monday', '2026-10-12'), task('tuesday', '2026-10-13')],
      ['ada', 'lin'],
      constantRandom(),
      previousDayAssignment
    );

    expect(invalid).toEqual({ ok: false, reason: 'invalid-previous-day' });
    expect(previousDayAssignment).toEqual(before);
    expect(tasks[0].assignedMemberId).toBeNull();
    expect(result.ok).toBe(true);
  });

  it('deduplicates eligible member IDs and ignores blank IDs like the client utility', () => {
    const result = assignHouseholdTasksFairly(
      [task('only', '2026-10-05')],
      ['ada', '', '  ', 'ada'],
      constantRandom()
    );

    expect(result).toEqual({
      ok: true,
      tasks: [{ ...task('only', '2026-10-05'), assignedMemberId: 'ada' }]
    });
  });

  it('reports no members when non-empty tasks have no eligible IDs', () => {
    expect(assignHouseholdTasksFairly([task('one', '2026-10-05')], [])).toEqual({
      ok: false,
      reason: 'no-members'
    });
  });

  it('rejects blank and duplicate task IDs and invalid calendar dates', () => {
    expect(assignHouseholdTasksFairly([task(' ', '2026-10-05')], ['ada'])).toEqual({
      ok: false,
      reason: 'invalid-tasks'
    });
    const duplicate = task('same', '2026-10-05');
    expect(assignHouseholdTasksFairly([duplicate, { ...duplicate }], ['ada', 'lin'])).toEqual({
      ok: false,
      reason: 'invalid-tasks'
    });
    expect(assignHouseholdTasksFairly([task('bad-date', '2026-02-30')], ['ada'])).toEqual({
      ok: false,
      reason: 'invalid-tasks'
    });
    expect(assignHouseholdTasksFairly([task('bad-format', '2026-2-03')], ['ada'])).toEqual({
      ok: false,
      reason: 'invalid-tasks'
    });
  });

  it('rejects more than the server weekly task limit', () => {
    const input = Array.from({ length: 201 }, (_, index) => task(`task-${index}`, '2026-10-05'));
    expect(assignHouseholdTasksFairly(input, ['ada'])).toEqual({
      ok: false,
      reason: 'too-many-tasks'
    });
  });

  it('reports bounded-search exhaustion separately from a proven impossible distribution', () => {
    const input = [
      ...Array.from({ length: 100 }, (_, index) => task(`day-one-${index}`, '2026-10-05')),
      ...Array.from({ length: 100 }, (_, index) => task(`day-two-${index}`, '2026-10-06'))
    ];

    expect(assignHouseholdTasksFairly(input, ['ada', 'lin', 'sam'], constantRandom())).toEqual({
      ok: false,
      reason: 'search-limit'
    });
  });

  it('returns an explicit failure instead of relaxing adjacency or balance', () => {
    const impossible = [
      task('a1', '2026-10-05'),
      task('a2', '2026-10-05'),
      task('b1', '2026-10-06'),
      task('b2', '2026-10-06'),
      task('c1', '2026-10-07'),
      task('c2', '2026-10-07')
    ];
    expect(assignHouseholdTasksFairly(impossible, ['ada', 'lin'], constantRandom(0.5))).toEqual({
      ok: false,
      reason: 'no-valid-distribution'
    });
    expect(
      assignHouseholdTasksFairly(
        [task('mon', '2026-10-05'), task('tue', '2026-10-06')],
        ['ada'],
        constantRandom()
      )
    ).toEqual({ ok: false, reason: 'no-valid-distribution' });
  });

  it('is deterministic with an injected RNG and does not mutate inputs or nested task values', () => {
    const input = [
      { ...task('a', '2026-10-05'), details: { note: 'unchanged' } },
      { ...task('b', '2026-10-06'), details: { note: 'unchanged' } }
    ];
    const sequence = (): (() => number) => {
      let value = 0;
      return () => (value += 0.17) % 1;
    };
    const before = structuredClone(input);

    const first = assignHouseholdTasksFairly(input, ['ada', 'lin'], sequence());
    const second = assignHouseholdTasksFairly(input, ['ada', 'lin'], sequence());

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    if (first.ok) {
      expect(first.tasks[0]).not.toBe(input[0]);
      expect(first.tasks[0].details).toBe(input[0].details);
    }
  });

  it('treats non-finite and out-of-range RNG values safely', () => {
    const input = [task('a', '2026-10-05'), task('b', '2026-10-06')];
    const result = assignHouseholdTasksFairly(input, ['ada', 'lin'], () => Number.NaN);
    expect(result.ok).toBe(true);
    expect(assignHouseholdTasksFairly(input, ['ada', 'lin'], () => 99)).toEqual(
      assignHouseholdTasksFairly(input, ['ada', 'lin'], () => 1)
    );
  });
});
