export interface HouseholdTaskAssignmentCandidate {
  id: string;
  scheduledDate: string;
}

export type HouseholdTaskAssignmentFailure =
  'no-members' | 'invalid-tasks' | 'too-many-tasks' | 'no-valid-distribution' | 'search-limit';

export type HouseholdTaskAssignmentResult<TTask extends HouseholdTaskAssignmentCandidate> =
  | { ok: true; tasks: Array<TTask & { assignedMemberId: string | null }> }
  | { ok: false; reason: HouseholdTaskAssignmentFailure };

const MAX_TASKS_PER_WEEK = 200;
const MAX_SEARCH_NODES = 200_000;

/**
 * Assigns proposed task occurrences locally, with balanced member counts and no assignment on
 * consecutive dates. It does not silently relax either constraint when no valid solution exists.
 */
export function assignHouseholdTasksFairly<TTask extends HouseholdTaskAssignmentCandidate>(
  tasks: readonly TTask[],
  eligibleMemberIds: readonly string[],
  random: () => number = Math.random
): HouseholdTaskAssignmentResult<TTask> {
  if (tasks.length === 0) return { ok: true, tasks: [] };
  if (tasks.length > MAX_TASKS_PER_WEEK) return { ok: false, reason: 'too-many-tasks' };

  const members = [...new Set(eligibleMemberIds.filter((id) => id.trim()))];
  if (members.length === 0) return { ok: false, reason: 'no-members' };

  const groups = new Map<number, TTask[]>();
  const ids = new Set<string>();
  for (const task of tasks) {
    if (
      !task ||
      typeof task.id !== 'string' ||
      !task.id.trim() ||
      ids.has(task.id) ||
      typeof task.scheduledDate !== 'string'
    ) {
      return { ok: false, reason: 'invalid-tasks' };
    }
    const dateOrdinal = dateToOrdinal(task.scheduledDate);
    if (dateOrdinal === null) return { ok: false, reason: 'invalid-tasks' };

    ids.add(task.id);
    const group = groups.get(dateOrdinal) ?? [];
    group.push(task);
    groups.set(dateOrdinal, group);
  }

  const orderedDays = [...groups.keys()].sort((left, right) => left - right);
  const dayTasks = orderedDays.map((day) => groups.get(day)!);
  const minimum = Math.floor(tasks.length / members.length);
  const maximum = Math.ceil(tasks.length / members.length);
  const counts = new Map(members.map((id) => [id, 0]));
  const assignment = new Map<string, string>();
  let explored = 0;
  let searchLimitReached = false;

  const searchDay = (dayIndex: number, previousDayMembers: ReadonlySet<string>): boolean => {
    if (searchLimitReached) return false;
    if (++explored > MAX_SEARCH_NODES) {
      searchLimitReached = true;
      return false;
    }
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
      if (searchLimitReached) return false;
      if (++explored > MAX_SEARCH_NODES) {
        searchLimitReached = true;
        return false;
      }
      if (taskIndex >= tasksForDay.length) return searchDay(dayIndex + 1, assignedToday);

      const remaining = tasks.length - assignment.size - 1;
      const candidates = members
        .map((id, index) => ({ id, index, load: counts.get(id)!, tie: randomScore(random) }))
        .filter(({ id, load }) => !forbidden.has(id) && load < maximum)
        .sort(
          (left, right) =>
            left.load - right.load || left.tie - right.tie || left.index - right.index
        );

      for (const { id } of candidates) {
        counts.set(id, counts.get(id)! + 1);
        assignment.set(tasksForDay[taskIndex].id, id);
        assignedToday.add(id);

        const underMinimum = [...counts.values()].filter((count) => count < minimum).length;
        if (underMinimum <= remaining && assignOccurrence(taskIndex + 1)) return true;

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

  if (!searchDay(0, new Set())) {
    return {
      ok: false,
      reason: searchLimitReached ? 'search-limit' : 'no-valid-distribution'
    };
  }

  return {
    ok: true,
    tasks: tasks.map((task) => ({ ...task, assignedMemberId: assignment.get(task.id) ?? null }))
  };
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
