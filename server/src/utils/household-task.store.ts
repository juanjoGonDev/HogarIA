import type Database from 'better-sqlite3';
import type { HouseholdPlan } from '../schemas/household-plan.schema.js';
import { householdPlanSchema } from '../schemas/household-plan.schema.js';
import {
  householdTaskOccurrencesSchema,
  type HouseholdTaskOccurrence,
  type HouseholdTaskWeekWrite
} from '../schemas/household-task.schema.js';

export interface VersionedHouseholdTaskWeek {
  weekStart: string;
  version: number;
  tasks: HouseholdTaskOccurrence[];
}

export type SaveHouseholdTaskWeekResult =
  | { status: 'saved'; snapshot: VersionedHouseholdTaskWeek }
  | { status: 'conflict'; snapshot: VersionedHouseholdTaskWeek };

export class HouseholdTaskStoreError extends Error {
  constructor(readonly code: 'TASK_SPACE_NOT_FOUND' | 'TASK_MEMBER_NOT_ACTIVE') {
    super(code);
    this.name = 'HouseholdTaskStoreError';
  }
}

interface TaskWeekRow {
  version: number;
  tasks_json: string;
}

interface PlanRow {
  plan_json: string;
}

export function readHouseholdTaskWeek(
  db: Database.Database,
  householdId: string,
  weekStart: string
): VersionedHouseholdTaskWeek {
  const row = db
    .prepare(
      'SELECT version, tasks_json FROM household_task_weeks WHERE household_id = ? AND week_start = ?'
    )
    .get(householdId, weekStart) as TaskWeekRow | undefined;
  if (!row) return { weekStart, version: 0, tasks: [] };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(row.tasks_json);
  } catch {
    throw new Error('Stored household task week is invalid.');
  }
  const parsedTasks = householdTaskOccurrencesSchema.safeParse(parsedJson);
  if (!parsedTasks.success) throw new Error('Stored household task week is invalid.');
  return { weekStart, version: row.version, tasks: parsedTasks.data };
}

export function saveHouseholdTaskWeek(
  db: Database.Database,
  householdId: string,
  userId: string,
  input: HouseholdTaskWeekWrite
): SaveHouseholdTaskWeekResult {
  const encodedTasks = JSON.stringify(input.tasks);

  return db.transaction((): SaveHouseholdTaskWeekResult => {
    const current = readHouseholdTaskWeek(db, householdId, input.weekStart);
    if (current.version !== input.baseVersion) return { status: 'conflict', snapshot: current };

    validateTaskReferences(db, householdId, input.tasks, current.tasks);
    const nextVersion = current.version + 1;
    if (current.version === 0) {
      db.prepare(
        `INSERT INTO household_task_weeks
          (household_id, week_start, version, tasks_json, updated_by)
         VALUES (?, ?, ?, ?, ?)`
      ).run(householdId, input.weekStart, nextVersion, encodedTasks, userId);
    } else {
      const result = db
        .prepare(
          `UPDATE household_task_weeks
              SET version = ?, tasks_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND week_start = ? AND version = ?`
        )
        .run(nextVersion, encodedTasks, userId, householdId, input.weekStart, input.baseVersion);
      if (result.changes !== 1) {
        return {
          status: 'conflict',
          snapshot: readHouseholdTaskWeek(db, householdId, input.weekStart)
        };
      }
    }
    return {
      status: 'saved',
      snapshot: { weekStart: input.weekStart, version: nextVersion, tasks: input.tasks }
    };
  })();
}

export function findOrphanedHouseholdTaskIds(
  db: Database.Database,
  householdId: string,
  currentPlan: HouseholdPlan | null,
  nextPlan: HouseholdPlan
): string[] {
  const currentSpaceIds = new Set(
    currentPlan?.floors.flatMap((floor) => floor.spaces.map((space) => space.id)) ?? []
  );
  const nextSpaceIds = new Set(
    nextPlan.floors.flatMap((floor) => floor.spaces.map((space) => space.id))
  );
  const removedSpaceIds = new Set([...currentSpaceIds].filter((id) => !nextSpaceIds.has(id)));
  if (!removedSpaceIds.size) return [];

  const rows = db
    .prepare('SELECT tasks_json FROM household_task_weeks WHERE household_id = ?')
    .all(householdId) as Array<{ tasks_json: string }>;
  const orphanIds = new Set<string>();
  for (const row of rows) {
    const tasks = parseStoredTasks(row.tasks_json);
    for (const task of tasks) {
      if (task.spaceId && removedSpaceIds.has(task.spaceId)) orphanIds.add(task.id);
    }
  }
  return [...orphanIds].sort();
}

export function detachHouseholdTasksFromRemovedSpaces(
  db: Database.Database,
  householdId: string,
  userId: string,
  taskIds: readonly string[]
): void {
  if (!taskIds.length) return;
  const affected = new Set(taskIds);
  const rows = db
    .prepare('SELECT week_start, tasks_json FROM household_task_weeks WHERE household_id = ?')
    .all(householdId) as Array<{ week_start: string; tasks_json: string }>;
  const update = db.prepare(
    `UPDATE household_task_weeks
        SET tasks_json = ?, version = version + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ? AND week_start = ?`
  );
  for (const row of rows) {
    const tasks = parseStoredTasks(row.tasks_json);
    let changed = false;
    const detached = tasks.map((task) => {
      if (!affected.has(task.id) || task.spaceId === null) return task;
      changed = true;
      return { ...task, spaceId: null };
    });
    if (changed) update.run(JSON.stringify(detached), userId, householdId, row.week_start);
  }
}

function validateTaskReferences(
  db: Database.Database,
  householdId: string,
  tasks: readonly HouseholdTaskOccurrence[],
  previousTasks: readonly HouseholdTaskOccurrence[]
): void {
  const row = db
    .prepare('SELECT plan_json FROM household_plans WHERE household_id = ?')
    .get(householdId) as PlanRow | undefined;
  const spaceIds = new Set<string>();
  if (row) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(row.plan_json);
    } catch {
      throw new Error('Stored household plan is invalid.');
    }
    const parsed = householdPlanSchema.safeParse(decoded);
    if (!parsed.success) throw new Error('Stored household plan is invalid.');
    parsed.data.floors.forEach((floor) => floor.spaces.forEach((space) => spaceIds.add(space.id)));
  }

  const activeMembers = new Set(
    (
      db
        .prepare('SELECT user_id FROM household_members WHERE household_id = ? AND is_active = 1')
        .all(householdId) as Array<{ user_id: string }>
    ).map((member) => member.user_id)
  );
  const previouslyAssigned = new Map(
    previousTasks.map((task) => [task.id, task.assignedMemberId] as const)
  );
  for (const task of tasks) {
    if (task.spaceId && !spaceIds.has(task.spaceId)) {
      throw new HouseholdTaskStoreError('TASK_SPACE_NOT_FOUND');
    }
    if (
      task.assignedMemberId &&
      !activeMembers.has(task.assignedMemberId) &&
      previouslyAssigned.get(task.id) !== task.assignedMemberId
    ) {
      throw new HouseholdTaskStoreError('TASK_MEMBER_NOT_ACTIVE');
    }
  }
}

function parseStoredTasks(value: string): HouseholdTaskOccurrence[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error('Stored household task week is invalid.');
  }
  const parsed = householdTaskOccurrencesSchema.safeParse(decoded);
  if (!parsed.success) throw new Error('Stored household task week is invalid.');
  return parsed.data;
}
