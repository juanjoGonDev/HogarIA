import type Database from 'better-sqlite3';
import { householdPlanSchema } from '../schemas/household-plan.schema.js';
import { householdTaskOccurrencesSchema } from '../schemas/household-task.schema.js';
import { canViewSharedCalendar } from './shared-meal-calendar.store.js';

export interface CalendarHouseholdTask {
  id: string;
  title: string;
  date: string;
  /** Weekly task occurrences currently have no time field; never infer one. */
  time: null;
  zoneName: string | null;
  assignedMemberId: string | null;
  assignedMemberName: string | null;
  completed: boolean;
}

interface TaskWeekRow {
  week_start: string;
  tasks_json: string;
}

/**
 * Read-only projection of the household checklist into the existing calendar range.
 * All supporting data is batch-read: one range query, one current-plan query and one membership
 * query regardless of how many task cards are shown in a month.
 */
export function listHouseholdTasksForCalendarViewer(
  db: Database.Database,
  userId: string,
  householdId: string | null,
  from: string,
  to: string
): CalendarHouseholdTask[] {
  if (!canViewSharedCalendar(db, householdId, userId)) return [];

  const rows = db
    .prepare(
      `SELECT week_start, tasks_json
       FROM household_task_weeks
       WHERE household_id = ?
         AND week_start <= ?
         AND date(week_start, '+6 days') >= ?
       ORDER BY week_start ASC`
    )
    .all(householdId, to, from) as TaskWeekRow[];
  if (!rows.length) return [];

  const tasks = rows.flatMap((row) => parseTaskWeek(row.tasks_json));
  const inRange = tasks.filter((task) => task.scheduledDate >= from && task.scheduledDate <= to);
  if (!inRange.length) return [];

  const zoneNames = readZoneNames(db, householdId);
  const memberNames = readActiveMemberNames(db, householdId);

  return inRange
    .map((task) => {
      const activeAssignee = task.assignedMemberId
        ? memberNames.get(task.assignedMemberId)
        : undefined;
      return {
        id: task.id,
        title: task.title,
        date: task.scheduledDate,
        time: null,
        zoneName: task.spaceId ? (zoneNames.get(task.spaceId) ?? null) : null,
        assignedMemberId: activeAssignee ? task.assignedMemberId : null,
        assignedMemberName: activeAssignee ?? null,
        completed: task.completed
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

function parseTaskWeek(raw: string) {
  try {
    const parsed = householdTaskOccurrencesSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function readZoneNames(db: Database.Database, householdId: string): Map<string, string> {
  const row = db
    .prepare('SELECT plan_json FROM household_plans WHERE household_id = ?')
    .get(householdId) as { plan_json: string } | undefined;
  if (!row) return new Map();

  try {
    const parsed = householdPlanSchema.safeParse(JSON.parse(row.plan_json) as unknown);
    if (!parsed.success) return new Map();
    return new Map(
      parsed.data.floors.flatMap((floor) => floor.spaces.map((space) => [space.id, space.label]))
    );
  } catch {
    return new Map();
  }
}

function readActiveMemberNames(db: Database.Database, householdId: string): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT hm.user_id AS id, u.name
       FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = ? AND hm.is_active = 1`
    )
    .all(householdId) as Array<{ id: string; name: string }>;
  return new Map(rows.map(({ id, name }) => [id, name]));
}
