import type { HouseholdTaskOccurrence } from '../../shared/models/household-task.model';
import { assignHouseholdTasksFairly } from './household-task-assignment';

function occurrence(id: string, scheduledDate: string): HouseholdTaskOccurrence {
  return {
    id,
    title: `Tarea ${id}`,
    details: null,
    spaceId: null,
    scheduledDate,
    assignedMemberId: null,
    priority: 'medium',
    completed: false
  };
}

describe('assignHouseholdTasksFairly', () => {
  it('keeps an empty week empty even when no one can be assigned', () => {
    expect(assignHouseholdTasksFairly([], [])).toEqual({ ok: true, tasks: [] });
  });

  it('balances assignments and avoids giving someone tasks on consecutive days', () => {
    const tasks = [
      occurrence('mon', '2026-10-05'),
      occurrence('tue', '2026-10-06'),
      occurrence('wed', '2026-10-07'),
      occurrence('thu', '2026-10-08'),
      occurrence('fri', '2026-10-09'),
      occurrence('sat', '2026-10-10'),
      occurrence('sun', '2026-10-11')
    ];
    const result = assignHouseholdTasksFairly(tasks, ['ada', 'lin'], () => 0.42);

    expect(result.ok).toBeTrue();
    if (!result.ok) return;
    const counts = new Map<string, number>();
    for (const task of result.tasks) {
      const member = task.assignedMemberId!;
      counts.set(member, (counts.get(member) ?? 0) + 1);
    }
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(1);
    for (let index = 1; index < result.tasks.length; index += 1) {
      expect(result.tasks[index].assignedMemberId).not.toBe(
        result.tasks[index - 1].assignedMemberId
      );
    }
  });

  it('allows multiple tasks in one day and reports an impossible adjacent-day schedule', () => {
    const sameDay = [occurrence('a', '2026-10-05'), occurrence('b', '2026-10-05')];
    const possible = assignHouseholdTasksFairly(sameDay, ['ada', 'lin'], () => 0.2);
    expect(possible.ok).toBeTrue();

    const impossible = assignHouseholdTasksFairly(
      [occurrence('monday', '2026-10-05'), occurrence('tuesday', '2026-10-06')],
      ['ada'],
      () => 0.2
    );
    expect(impossible).toEqual({ ok: false, reason: 'no-valid-distribution' });
  });

  it('requires eligible members and rejects invalid or duplicate occurrences', () => {
    const one = occurrence('one', '2026-10-05');
    expect(assignHouseholdTasksFairly([one], [])).toEqual({ ok: false, reason: 'no-members' });
    expect(assignHouseholdTasksFairly([occurrence('', '2026-10-05')], ['ada'])).toEqual({
      ok: false,
      reason: 'invalid-tasks'
    });
    expect(assignHouseholdTasksFairly([one, { ...one }], ['ada', 'lin'])).toEqual({
      ok: false,
      reason: 'invalid-tasks'
    });
    expect(assignHouseholdTasksFairly([occurrence('bad-date', '2026-02-30')], ['ada'])).toEqual({
      ok: false,
      reason: 'invalid-tasks'
    });
  });

  it('is reproducible with an injected random source and returns new assignments without mutating input', () => {
    const tasks = [occurrence('a', '2026-10-05'), occurrence('b', '2026-10-06')];
    const sequence = (): (() => number) => {
      let value = 0;
      return () => (value += 0.17) % 1;
    };
    const first = assignHouseholdTasksFairly(tasks, ['ada', 'lin'], sequence());
    const second = assignHouseholdTasksFairly(tasks, ['ada', 'lin'], sequence());

    expect(first).toEqual(second);
    expect(tasks.every((task) => task.assignedMemberId === null)).toBeTrue();
  });
});
