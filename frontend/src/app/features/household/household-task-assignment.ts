import type { HouseholdTaskOccurrence } from '../../shared/models/household-task.model';

export type HouseholdTaskAssignmentFailure =
  'no-members' | 'invalid-tasks' | 'no-valid-distribution';

export type HouseholdTaskAssignmentResult =
  | { ok: true; tasks: HouseholdTaskOccurrence[] }
  | { ok: false; reason: HouseholdTaskAssignmentFailure };

const MAX_SEARCH_NODES = 200_000;

/** Randomly assigns the week's occurrences while keeping the load balanced and avoiding adjacent days. */
export function assignHouseholdTasksFairly(
  tasks: readonly HouseholdTaskOccurrence[],
  eligibleMemberIds: readonly string[],
  random: () => number = Math.random
): HouseholdTaskAssignmentResult {
  const members = [...new Set(eligibleMemberIds.filter((id) => id.trim()))];
  if (!tasks.length) return { ok: true, tasks: [] };
  if (!members.length) return { ok: false, reason: 'no-members' };

  const groups = new Map<number, HouseholdTaskOccurrence[]>();
  const ids = new Set<string>();
  for (const task of tasks) {
    const dateOrdinal = dateToOrdinal(task.scheduledDate);
    if (!task.id.trim() || ids.has(task.id) || dateOrdinal === null) {
      return { ok: false, reason: 'invalid-tasks' };
    }
    ids.add(task.id);
    const group = groups.get(dateOrdinal) ?? [];
    group.push(task);
    groups.set(dateOrdinal, group);
  }

  const orderedDays = [...groups.keys()].sort((a, b) => a - b);
  const dayTasks = orderedDays.map((day) => groups.get(day)!);
  const total = tasks.length;
  const minimum = Math.floor(total / members.length);
  const maximum = Math.ceil(total / members.length);
  const counts = new Map(members.map((id) => [id, 0]));
  const assignment = new Map<string, string>();
  let explored = 0;

  const searchDay = (dayIndex: number, previousDayMembers: ReadonlySet<string>): boolean => {
    if (++explored > MAX_SEARCH_NODES) return false;
    if (dayIndex >= orderedDays.length) {
      const loads = [...counts.values()];
      return Math.min(...loads) >= minimum && Math.max(...loads) - Math.min(...loads) <= 1;
    }

    const currentDay = orderedDays[dayIndex];
    const forbidden =
      dayIndex > 0 && orderedDays[dayIndex - 1] === currentDay - 1
        ? previousDayMembers
        : new Set<string>();
    const assignedToday = new Set<string>();
    const tasksForDay = dayTasks[dayIndex];

    const assignOccurrence = (taskIndex: number): boolean => {
      if (++explored > MAX_SEARCH_NODES) return false;
      if (taskIndex >= tasksForDay.length) return searchDay(dayIndex + 1, assignedToday);

      const remaining = total - countAssigned(assignment) - 1;
      const candidates = members
        .map((id, index) => ({ id, index, load: counts.get(id)!, tie: randomScore(random) }))
        .filter(({ id, load }) => !forbidden.has(id) && load < maximum)
        .sort((a, b) => a.load - b.load || a.tie - b.tie || a.index - b.index);

      for (const { id } of candidates) {
        counts.set(id, counts.get(id)! + 1);
        assignment.set(tasksForDay[taskIndex].id, id);
        assignedToday.add(id);

        const underMinimum = [...counts.values()].filter((count) => count < minimum).length;
        const possible = underMinimum <= remaining;
        if (possible && assignOccurrence(taskIndex + 1)) return true;

        if (!tasksForDay.slice(0, taskIndex).some((task) => assignment.get(task.id) === id)) {
          assignedToday.delete(id);
        }
        assignment.delete(tasksForDay[taskIndex].id);
        counts.set(id, counts.get(id)! - 1);
      }
      return false;
    };

    return assignOccurrence(0);
  };

  if (!searchDay(0, new Set())) return { ok: false, reason: 'no-valid-distribution' };
  return {
    ok: true,
    tasks: tasks.map((task) => ({ ...task, assignedMemberId: assignment.get(task.id) ?? null }))
  };
}

function countAssigned(assignments: ReadonlyMap<string, string>): number {
  return assignments.size;
}

function dateToOrdinal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    return null;
  }
  return Math.floor(timestamp / 86_400_000);
}

function randomScore(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}
