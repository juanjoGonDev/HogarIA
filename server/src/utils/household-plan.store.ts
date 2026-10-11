import type Database from 'better-sqlite3';
import { householdPlanSchema, type HouseholdPlan } from '../schemas/household-plan.schema.js';

export interface VersionedHouseholdPlan {
  version: number;
  plan: HouseholdPlan | null;
}

export type SaveHouseholdPlanResult =
  | { status: 'saved'; snapshot: VersionedHouseholdPlan }
  | { status: 'conflict'; snapshot: VersionedHouseholdPlan };

interface StoredPlanRow {
  version: number;
  plan_json: string;
}

export function readHouseholdPlan(
  db: Database.Database,
  householdId: string
): VersionedHouseholdPlan {
  const row = db
    .prepare('SELECT version, plan_json FROM household_plans WHERE household_id = ?')
    .get(householdId) as StoredPlanRow | undefined;
  if (!row) return { version: 0, plan: null };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(row.plan_json);
  } catch {
    throw new Error('Stored household plan is invalid.');
  }
  const parsedPlan = householdPlanSchema.safeParse(parsedJson);
  if (!parsedPlan.success) throw new Error('Stored household plan is invalid.');
  return { version: row.version, plan: parsedPlan.data };
}

export function saveHouseholdPlan(
  db: Database.Database,
  householdId: string,
  userId: string,
  baseVersion: number,
  plan: HouseholdPlan
): SaveHouseholdPlanResult {
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
    throw new Error('Plan base version is invalid.');
  }
  const parsedPlan = householdPlanSchema.safeParse(plan);
  if (!parsedPlan.success) throw new Error('Household plan failed semantic validation.');
  const encodedPlan = JSON.stringify(parsedPlan.data);

  return db.transaction((): SaveHouseholdPlanResult => {
    const current = readHouseholdPlan(db, householdId);
    if (current.version !== baseVersion) return { status: 'conflict', snapshot: current };

    const nextVersion = current.version + 1;
    if (current.version === 0) {
      db.prepare(
        `INSERT INTO household_plans (household_id, version, plan_json, updated_by)
         VALUES (?, ?, ?, ?)`
      ).run(householdId, nextVersion, encodedPlan, userId);
    } else {
      const update = db
        .prepare(
          `UPDATE household_plans
              SET version = ?, plan_json = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND version = ?`
        )
        .run(nextVersion, encodedPlan, userId, householdId, baseVersion);
      if (update.changes !== 1) {
        return { status: 'conflict', snapshot: readHouseholdPlan(db, householdId) };
      }
    }

    db.prepare(
      `INSERT INTO household_plan_revisions (household_id, version, plan_json, created_by)
       VALUES (?, ?, ?, ?)`
    ).run(householdId, nextVersion, encodedPlan, userId);

    return {
      status: 'saved',
      snapshot: { version: nextVersion, plan: parsedPlan.data }
    };
  })();
}
