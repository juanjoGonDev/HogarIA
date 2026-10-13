import type Database from 'better-sqlite3';
import {
  emptyTasteProfile,
  tasteGoalEnum,
  toMealPlan,
  toMealTimes,
  toTasteProfile,
  type MealPlan,
  type MealTimes,
  type TasteGoal
} from './taste-profile.js';
import type { HouseholdMealPlanningPatch } from '../schemas/household-meal-planning.schema.js';

export interface MealPlanningObjective {
  goals: TasteGoal[];
  notes: string;
}

export interface MealPlanningSchedule {
  mealTypes: MealPlan;
  mealTimes: MealTimes;
}

export interface HouseholdMealPlanningDefaults extends MealPlanningSchedule {
  objective: MealPlanningObjective;
}

export interface ResolvedMemberMealPlanning {
  householdMemberId: string;
  userId: string;
  goalOverrideEnabled: boolean;
  goal: MealPlanningObjective & { source: 'household' | 'member' };
  scheduleOverrideEnabled: boolean;
  schedule: MealPlanningSchedule & { source: 'household' | 'member' };
}

export interface HouseholdMealPlanningContext {
  household: HouseholdMealPlanningDefaults;
  members: ResolvedMemberMealPlanning[];
}

export interface HouseholdMealPlanningView {
  household: HouseholdMealPlanningDefaults;
  member: {
    goalOverrideEnabled: boolean;
    scheduleOverrideEnabled: boolean;
    personalObjective: MealPlanningObjective;
    personalSchedule: MealPlanningSchedule;
  };
  effective: {
    objective: ResolvedMemberMealPlanning['goal'];
    schedule: ResolvedMemberMealPlanning['schedule'];
  };
}

export type HouseholdMealPlanningErrorCode =
  | 'HOUSEHOLD_NOT_FOUND'
  | 'HOUSEHOLD_CALLER_NOT_ACTIVE'
  | 'HOUSEHOLD_MEMBER_NOT_FOUND'
  | 'HOUSEHOLD_CREATOR_NOT_FOUND';

export class HouseholdMealPlanningError extends Error {
  constructor(readonly code: HouseholdMealPlanningErrorCode) {
    super(code);
    this.name = 'HouseholdMealPlanningError';
  }
}

interface HouseholdRow {
  meal_planning_preferences: string | null;
}

interface MemberRow {
  id: string;
  user_id: string;
  preferences: string | null;
  meal_planning_preferences: string | null;
}

const DEFAULT_OBJECTIVE: MealPlanningObjective = {
  goals: [...emptyTasteProfile().goals],
  notes: ''
};

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeObjective(value: unknown): MealPlanningObjective {
  const raw = parseJsonRecord(value);
  const rawGoals = Array.isArray(raw.goals) ? raw.goals : DEFAULT_OBJECTIVE.goals;
  const goals: TasteGoal[] = [];
  for (const goal of rawGoals) {
    const parsed = tasteGoalEnum.safeParse(goal);
    if (parsed.success && !goals.includes(parsed.data)) goals.push(parsed.data);
  }
  return {
    goals: goals.length ? goals : [...DEFAULT_OBJECTIVE.goals],
    notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 500) : ''
  };
}

function normalizeHouseholdPreferences(value: unknown): HouseholdMealPlanningDefaults {
  const raw = parseJsonRecord(value);
  return {
    objective: normalizeObjective(raw.objective),
    mealTypes: toMealPlan(raw.mealTypes),
    mealTimes: toMealTimes(raw.mealTimes)
  };
}

function normalizeMemberPreferences(value: unknown, household: HouseholdMealPlanningDefaults) {
  const raw = parseJsonRecord(value);
  const rawSchedule = parseJsonRecord(raw.schedule);
  const personalSchedule: MealPlanningSchedule = {
    mealTypes: toMealPlan({ ...household.mealTypes, ...parseJsonRecord(rawSchedule.mealTypes) }),
    mealTimes: toMealTimes({ ...household.mealTimes, ...parseJsonRecord(rawSchedule.mealTimes) })
  };
  return {
    goalOverrideEnabled: raw.goalOverrideEnabled === true,
    scheduleOverrideEnabled: raw.scheduleOverrideEnabled === true,
    personalSchedule
  };
}

function selectHousehold(db: Database.Database, householdId: string): HouseholdRow | undefined {
  return db
    .prepare('SELECT meal_planning_preferences FROM households WHERE id = ?')
    .get(householdId) as HouseholdRow | undefined;
}

function isEmptyJsonObject(value: string | null): boolean {
  if (value === null) return true;
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 0
    );
  } catch {
    return false;
  }
}

/**
 * Seeds shared defaults from the creator's legacy preferences once, when a newly created home's
 * settings are still empty. Call from the create-home transaction; joining an existing home must
 * never call this. Personal restrictions, likes, dislikes and culinary notes stay in the user profile.
 */
export function initializeHouseholdMealPlanningFromCreator(
  db: Database.Database,
  householdId: string,
  creatorUserId: string
): boolean {
  const tx = db.transaction(() => {
    const household = selectHousehold(db, householdId);
    if (!household) throw new HouseholdMealPlanningError('HOUSEHOLD_NOT_FOUND');
    if (!isEmptyJsonObject(household.meal_planning_preferences)) return false;

    const creator = db.prepare('SELECT preferences FROM users WHERE id = ?').get(creatorUserId) as
      { preferences: string | null } | undefined;
    if (!creator) throw new HouseholdMealPlanningError('HOUSEHOLD_CREATOR_NOT_FOUND');

    const source = parseJsonRecord(creator.preferences);
    const taste = toTasteProfile(source.taste);
    const defaults: HouseholdMealPlanningDefaults = {
      objective: normalizeObjective({ goals: taste.goals, notes: taste.goalNotes }),
      mealTypes: toMealPlan(source.mealPlan),
      mealTimes: toMealTimes(source.mealTimes)
    };
    const result = db
      .prepare(
        `UPDATE households
            SET meal_planning_preferences = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND meal_planning_preferences IS ?`
      )
      .run(JSON.stringify(defaults), householdId, household.meal_planning_preferences);
    return result.changes === 1;
  });
  return tx();
}

function readHouseholdDefaults(
  db: Database.Database,
  householdId: string
): HouseholdMealPlanningDefaults {
  const row = selectHousehold(db, householdId);
  if (!row) throw new HouseholdMealPlanningError('HOUSEHOLD_NOT_FOUND');
  return normalizeHouseholdPreferences(row.meal_planning_preferences);
}

/**
 * Reads effective meal-planning inputs for selected membership rows without returning allergies or
 * other taste fields. The caller and every selected row must be active members of the same home.
 */
export function readHouseholdMealPlanningForMembers(
  db: Database.Database,
  householdId: string,
  callerUserId: string,
  selectedHouseholdMemberIds: readonly string[]
): HouseholdMealPlanningContext {
  const household = readHouseholdDefaults(db, householdId);
  const caller = db
    .prepare(
      `SELECT 1 FROM household_members
        WHERE household_id = ? AND user_id = ? AND is_active = 1`
    )
    .get(householdId, callerUserId);
  if (!caller) throw new HouseholdMealPlanningError('HOUSEHOLD_CALLER_NOT_ACTIVE');

  const selectedIds = [...new Set(selectedHouseholdMemberIds)];
  if (selectedIds.length === 0) return { household, members: [] };

  const placeholders = selectedIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT hm.id, hm.user_id, hm.meal_planning_preferences, u.preferences
         FROM household_members hm
         JOIN users u ON u.id = hm.user_id
        WHERE hm.household_id = ? AND hm.is_active = 1 AND hm.id IN (${placeholders})`
    )
    .all(householdId, ...selectedIds) as MemberRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== selectedIds.length) {
    throw new HouseholdMealPlanningError('HOUSEHOLD_MEMBER_NOT_FOUND');
  }

  return {
    household,
    members: selectedIds.map((membershipId) => {
      const row = byId.get(membershipId)!;
      const preferences = normalizeMemberPreferences(row.meal_planning_preferences, household);
      const personalTaste = toTasteProfile(parseJsonRecord(row.preferences).taste);
      const goalOverrideEnabled = preferences.goalOverrideEnabled;
      const scheduleOverrideEnabled = preferences.scheduleOverrideEnabled;
      return {
        householdMemberId: row.id,
        userId: row.user_id,
        goalOverrideEnabled,
        goal: {
          source: goalOverrideEnabled ? 'member' : 'household',
          goals: goalOverrideEnabled ? personalTaste.goals : household.objective.goals,
          notes: goalOverrideEnabled ? personalTaste.goalNotes : household.objective.notes
        },
        scheduleOverrideEnabled,
        schedule: scheduleOverrideEnabled
          ? { ...preferences.personalSchedule, source: 'member' as const }
          : {
              mealTypes: household.mealTypes,
              mealTimes: household.mealTimes,
              source: 'household' as const
            }
      };
    })
  };
}

export function readHouseholdMealPlanning(
  db: Database.Database,
  householdId: string,
  userId: string
): HouseholdMealPlanningView {
  const member = db
    .prepare(
      `SELECT hm.id FROM household_members hm
        WHERE hm.household_id = ? AND hm.user_id = ? AND hm.is_active = 1`
    )
    .get(householdId, userId) as { id: string } | undefined;
  if (!member) throw new HouseholdMealPlanningError('HOUSEHOLD_CALLER_NOT_ACTIVE');

  const context = readHouseholdMealPlanningForMembers(db, householdId, userId, [member.id]);
  const effective = context.members[0];
  const rawMember = db
    .prepare('SELECT meal_planning_preferences FROM household_members WHERE id = ?')
    .get(member.id) as { meal_planning_preferences: string | null };
  const memberPreferences = normalizeMemberPreferences(
    rawMember.meal_planning_preferences,
    context.household
  );
  const personalTasteRow = db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId) as
    { preferences: string | null } | undefined;
  const personalTaste = toTasteProfile(parseJsonRecord(personalTasteRow?.preferences).taste);

  return {
    household: context.household,
    member: {
      goalOverrideEnabled: effective.goalOverrideEnabled,
      scheduleOverrideEnabled: effective.scheduleOverrideEnabled,
      personalObjective: { goals: personalTaste.goals, notes: personalTaste.goalNotes },
      personalSchedule: memberPreferences.personalSchedule
    },
    effective: { objective: effective.goal, schedule: effective.schedule }
  };
}

/** Writes only supplied fields; the route must perform all permission checks before calling. */
export function saveHouseholdMealPlanning(
  db: Database.Database,
  householdId: string,
  userId: string,
  patch: HouseholdMealPlanningPatch
): HouseholdMealPlanningView {
  const tx = db.transaction(() => {
    const householdRow = selectHousehold(db, householdId);
    if (!householdRow) throw new HouseholdMealPlanningError('HOUSEHOLD_NOT_FOUND');
    const memberRow = db
      .prepare(
        `SELECT id, meal_planning_preferences FROM household_members
          WHERE household_id = ? AND user_id = ? AND is_active = 1`
      )
      .get(householdId, userId) as
      { id: string; meal_planning_preferences: string | null } | undefined;
    if (!memberRow) throw new HouseholdMealPlanningError('HOUSEHOLD_CALLER_NOT_ACTIVE');

    if (patch.household) {
      const saved = parseJsonRecord(householdRow.meal_planning_preferences);
      const objective = parseJsonRecord(saved.objective);
      if (patch.household.objective) {
        saved.objective = { ...objective, ...patch.household.objective };
      }
      if (patch.household.mealTypes) {
        saved.mealTypes = { ...parseJsonRecord(saved.mealTypes), ...patch.household.mealTypes };
      }
      if (patch.household.mealTimes) {
        saved.mealTimes = { ...parseJsonRecord(saved.mealTimes), ...patch.household.mealTimes };
      }
      db.prepare(
        `UPDATE households SET meal_planning_preferences = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(JSON.stringify(saved), householdId);
    }

    if (patch.member) {
      const saved = parseJsonRecord(memberRow.meal_planning_preferences);
      if (patch.member.goalOverrideEnabled !== undefined) {
        saved.goalOverrideEnabled = patch.member.goalOverrideEnabled;
      }
      if (patch.member.scheduleOverrideEnabled !== undefined) {
        saved.scheduleOverrideEnabled = patch.member.scheduleOverrideEnabled;
      }
      if (patch.member.schedule) {
        const schedule = parseJsonRecord(saved.schedule);
        if (patch.member.schedule.mealTypes) {
          schedule.mealTypes = {
            ...parseJsonRecord(schedule.mealTypes),
            ...patch.member.schedule.mealTypes
          };
        }
        if (patch.member.schedule.mealTimes) {
          schedule.mealTimes = {
            ...parseJsonRecord(schedule.mealTimes),
            ...patch.member.schedule.mealTimes
          };
        }
        saved.schedule = schedule;
      }
      db.prepare('UPDATE household_members SET meal_planning_preferences = ? WHERE id = ?').run(
        JSON.stringify(saved),
        memberRow.id
      );
    }
  });
  tx();
  return readHouseholdMealPlanning(db, householdId, userId);
}
