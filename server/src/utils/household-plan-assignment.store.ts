import type Database from 'better-sqlite3';
import type { HouseholdPlan } from '../schemas/household-plan.schema.js';
import { householdPlanSchema } from '../schemas/household-plan.schema.js';
import {
  householdPlanAssignmentsSchema,
  type HouseholdPlanAssignmentWrite,
  type HouseholdPlanAssignments
} from '../schemas/household-plan-assignment.schema.js';

export interface VersionedHouseholdPlanAssignments {
  planVersion: number;
  version: number;
  assignments: HouseholdPlanAssignments;
}

export type SaveHouseholdPlanAssignmentResult =
  | { status: 'saved'; snapshot: VersionedHouseholdPlanAssignments }
  | { status: 'conflict'; snapshot: VersionedHouseholdPlanAssignments }
  | { status: 'plan-conflict'; planVersion: number };

export class HouseholdPlanAssignmentError extends Error {
  constructor(
    readonly code: 'PLAN_ASSIGNMENT_SPACE_NOT_FOUND' | 'PLAN_ASSIGNMENT_MEMBER_NOT_ACTIVE'
  ) {
    super(code);
    this.name = 'HouseholdPlanAssignmentError';
  }
}

interface AssignmentRow {
  version: number;
  assignments_json: string;
}

interface PlanRow {
  version: number;
  plan_json: string;
}

export function readHouseholdPlanAssignments(
  db: Database.Database,
  householdId: string
): VersionedHouseholdPlanAssignments {
  const plan = readPlanRow(db, householdId);
  const assignmentsRow = db
    .prepare(
      'SELECT version, assignments_json FROM household_plan_assignments WHERE household_id = ?'
    )
    .get(householdId) as AssignmentRow | undefined;
  return {
    planVersion: plan?.version ?? 0,
    version: assignmentsRow?.version ?? 0,
    assignments: assignmentsRow ? parseAssignments(assignmentsRow.assignments_json) : {}
  };
}

export function saveHouseholdPlanAssignment(
  db: Database.Database,
  householdId: string,
  userId: string,
  input: HouseholdPlanAssignmentWrite
): SaveHouseholdPlanAssignmentResult {
  return db.transaction((): SaveHouseholdPlanAssignmentResult => {
    const planRow = readPlanRow(db, householdId);
    if (!planRow || planRow.version !== input.basePlanVersion) {
      return { status: 'plan-conflict', planVersion: planRow?.version ?? 0 };
    }
    const plan = parsePlan(planRow.plan_json);
    if (!plan.floors.some((floor) => floor.spaces.some((space) => space.id === input.spaceId))) {
      throw new HouseholdPlanAssignmentError('PLAN_ASSIGNMENT_SPACE_NOT_FOUND');
    }
    assertActiveMembers(db, householdId, input.memberIds);

    const current = readHouseholdPlanAssignments(db, householdId);
    if (current.version !== input.baseVersion) return { status: 'conflict', snapshot: current };
    const assignments = { ...current.assignments };
    if (input.memberIds.length) assignments[input.spaceId] = input.memberIds;
    else delete assignments[input.spaceId];

    const nextVersion = current.version + 1;
    const encoded = JSON.stringify(assignments);
    if (current.version === 0) {
      db.prepare(
        `INSERT INTO household_plan_assignments
          (household_id, version, assignments_json, updated_by)
         VALUES (?, ?, ?, ?)`
      ).run(householdId, nextVersion, encoded, userId);
    } else {
      const result = db
        .prepare(
          `UPDATE household_plan_assignments
              SET version = ?, assignments_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND version = ?`
        )
        .run(nextVersion, encoded, userId, householdId, input.baseVersion);
      if (result.changes !== 1) {
        return { status: 'conflict', snapshot: readHouseholdPlanAssignments(db, householdId) };
      }
    }

    return {
      status: 'saved',
      snapshot: { planVersion: planRow.version, version: nextVersion, assignments }
    };
  })();
}

/** Called inside the plan transaction; removes assignment entries for deleted spaces. */
export function removeAssignmentsForMissingSpaces(
  db: Database.Database,
  householdId: string,
  plan: HouseholdPlan,
  userId: string
): void {
  const row = db
    .prepare(
      'SELECT version, assignments_json FROM household_plan_assignments WHERE household_id = ?'
    )
    .get(householdId) as AssignmentRow | undefined;
  if (!row) return;

  const assignments = parseAssignments(row.assignments_json);
  const currentSpaceIds = new Set(
    plan.floors.flatMap((floor) => floor.spaces.map((space) => space.id))
  );
  const retained = Object.fromEntries(
    Object.entries(assignments).filter(([spaceId]) => currentSpaceIds.has(spaceId))
  );
  if (Object.keys(retained).length === Object.keys(assignments).length) return;

  db.prepare(
    `UPDATE household_plan_assignments
        SET version = ?, assignments_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ? AND version = ?`
  ).run(row.version + 1, JSON.stringify(retained), userId, householdId, row.version);
}

function readPlanRow(db: Database.Database, householdId: string): PlanRow | undefined {
  return db
    .prepare('SELECT version, plan_json FROM household_plans WHERE household_id = ?')
    .get(householdId) as PlanRow | undefined;
}

function parsePlan(value: string): HouseholdPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Stored household plan is invalid.');
  }
  const result = householdPlanSchema.safeParse(parsed);
  if (!result.success) throw new Error('Stored household plan is invalid.');
  return result.data;
}

function parseAssignments(value: string): HouseholdPlanAssignments {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Stored household plan assignments are invalid.');
  }
  const result = householdPlanAssignmentsSchema.safeParse(parsed);
  if (!result.success) throw new Error('Stored household plan assignments are invalid.');
  return result.data;
}

function assertActiveMembers(
  db: Database.Database,
  householdId: string,
  memberIds: string[]
): void {
  if (!memberIds.length) return;
  const placeholders = memberIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT user_id FROM household_members
        WHERE household_id = ? AND is_active = 1 AND user_id IN (${placeholders})`
    )
    .all(householdId, ...memberIds) as Array<{ user_id: string }>;
  if (rows.length !== memberIds.length) {
    throw new HouseholdPlanAssignmentError('PLAN_ASSIGNMENT_MEMBER_NOT_ACTIVE');
  }
}
