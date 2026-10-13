import type Database from 'better-sqlite3';
import {
  householdPlanningAutomationResponseSchema,
  householdPlanningAutomationStateSchema,
  type HouseholdPlanningAutomationMode,
  type HouseholdPlanningAutomationPatch,
  type HouseholdPlanningAutomationResponse,
  type HouseholdPlanningAutomationScope
} from '../schemas/household-planning-automation.schema.js';
import { activeHouseholdId } from './household-context.js';
import { nextHouseholdWeeklyOccurrence, type ISOWeekday } from './household-weekly-schedule.js';

export class HouseholdPlanningAutomationStoreError extends Error {
  constructor(
    readonly code:
      | 'HOUSEHOLD_CONTEXT_CHANGED'
      | 'HOUSEHOLD_SETTINGS_REQUIRED'
      | 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED'
      | 'AUTOMATION_SCHEDULE_REQUIRED'
      | 'AUTOMATION_STATE_CORRUPT'
  ) {
    super(code);
    this.name = 'HouseholdPlanningAutomationStoreError';
  }
}

interface AutomationRow {
  enabled: number;
  mode: string | null;
  scopes_json: string;
  weekday: number | null;
  local_time: string | null;
  time_zone: string | null;
  version: number;
}

export type SaveHouseholdPlanningAutomationResult =
  | { status: 'saved'; snapshot: HouseholdPlanningAutomationResponse }
  | { status: 'conflict'; snapshot: HouseholdPlanningAutomationResponse };

const DEFAULT_STATE = {
  enabled: false,
  mode: null,
  scopes: [],
  weekday: null,
  localTime: null,
  timeZone: null,
  version: 0
} as const;

export function readHouseholdPlanningAutomation(
  db: Database.Database,
  householdId: string,
  now: Date
): HouseholdPlanningAutomationResponse {
  const row = db
    .prepare(
      `SELECT enabled, mode, scopes_json, weekday, local_time, time_zone, version
         FROM household_planning_automations WHERE household_id = ?`
    )
    .get(householdId) as AutomationRow | undefined;
  if (!row) return toResponse(DEFAULT_STATE, now);

  let decodedScopes: unknown;
  try {
    decodedScopes = JSON.parse(row.scopes_json);
  } catch {
    throw new HouseholdPlanningAutomationStoreError('AUTOMATION_STATE_CORRUPT');
  }
  const parsed = householdPlanningAutomationStateSchema.safeParse({
    enabled: row.enabled === 1,
    mode: row.mode,
    scopes: decodedScopes,
    weekday: row.weekday,
    localTime: row.local_time,
    timeZone: row.time_zone,
    version: row.version
  });
  if (!parsed.success) throw new HouseholdPlanningAutomationStoreError('AUTOMATION_STATE_CORRUPT');
  return toResponse(parsed.data, now);
}

export function saveHouseholdPlanningAutomation(
  db: Database.Database,
  householdId: string,
  userId: string,
  patch: HouseholdPlanningAutomationPatch,
  now: Date
): SaveHouseholdPlanningAutomationResult {
  return db.transaction((): SaveHouseholdPlanningAutomationResult => {
    if (activeHouseholdId(db, userId) !== householdId) {
      throw new HouseholdPlanningAutomationStoreError('HOUSEHOLD_CONTEXT_CHANGED');
    }
    if (!hasPermission(db, householdId, userId, 'settings')) {
      throw new HouseholdPlanningAutomationStoreError('HOUSEHOLD_SETTINGS_REQUIRED');
    }

    const current = readHouseholdPlanningAutomation(db, householdId, now);
    if (current.version !== patch.expectedVersion) return { status: 'conflict', snapshot: current };

    const nextState = mergeState(current, patch);
    const parsedState = householdPlanningAutomationStateSchema.safeParse(nextState);
    if (!parsedState.success) {
      if (nextState.enabled) {
        throw new HouseholdPlanningAutomationStoreError('AUTOMATION_SCHEDULE_REQUIRED');
      }
      throw new HouseholdPlanningAutomationStoreError('AUTOMATION_STATE_CORRUPT');
    }
    if (parsedState.data.enabled && !hasPermission(db, householdId, userId, 'calendar.edit')) {
      throw new HouseholdPlanningAutomationStoreError('HOUSEHOLD_CALENDAR_EDIT_REQUIRED');
    }

    if (sameConfiguration(current, parsedState.data)) {
      return { status: 'saved', snapshot: current };
    }

    const nextVersion = current.version + 1;
    const authorizedBy = parsedState.data.enabled ? userId : null;
    if (current.version === 0) {
      db.prepare(
        `INSERT INTO household_planning_automations
          (household_id, enabled, mode, scopes_json, weekday, local_time, time_zone, version, authorized_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        householdId,
        Number(parsedState.data.enabled),
        parsedState.data.mode,
        JSON.stringify(parsedState.data.scopes),
        parsedState.data.weekday,
        parsedState.data.localTime,
        parsedState.data.timeZone,
        nextVersion,
        authorizedBy
      );
    } else {
      const updated = db
        .prepare(
          `UPDATE household_planning_automations
              SET enabled = ?, mode = ?, scopes_json = ?, weekday = ?, local_time = ?, time_zone = ?,
                  version = ?, authorized_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE household_id = ? AND version = ?`
        )
        .run(
          Number(parsedState.data.enabled),
          parsedState.data.mode,
          JSON.stringify(parsedState.data.scopes),
          parsedState.data.weekday,
          parsedState.data.localTime,
          parsedState.data.timeZone,
          nextVersion,
          authorizedBy,
          householdId,
          current.version
        );
      if (updated.changes !== 1) {
        return {
          status: 'conflict',
          snapshot: readHouseholdPlanningAutomation(db, householdId, now)
        };
      }
    }

    const snapshot = readHouseholdPlanningAutomation(db, householdId, now);
    return { status: 'saved', snapshot };
  })();
}

function mergeState(
  current: HouseholdPlanningAutomationResponse,
  patch: HouseholdPlanningAutomationPatch
) {
  return {
    enabled: patch.enabled ?? current.enabled,
    mode: patch.mode === undefined ? current.mode : patch.mode,
    scopes: patch.scopes === undefined ? current.scopes : patch.scopes,
    weekday: patch.weekday === undefined ? current.weekday : patch.weekday,
    localTime: patch.localTime === undefined ? current.localTime : patch.localTime,
    timeZone: patch.timeZone === undefined ? current.timeZone : patch.timeZone,
    version: current.version + 1
  };
}

function sameConfiguration(
  current: HouseholdPlanningAutomationResponse,
  next: {
    enabled: boolean;
    mode: HouseholdPlanningAutomationMode | null;
    scopes: HouseholdPlanningAutomationScope[];
    weekday: number | null;
    localTime: string | null;
    timeZone: string | null;
  }
): boolean {
  return (
    current.enabled === next.enabled &&
    current.mode === next.mode &&
    current.weekday === next.weekday &&
    current.localTime === next.localTime &&
    current.timeZone === next.timeZone &&
    current.scopes.length === next.scopes.length &&
    current.scopes.every((scope, index) => scope === next.scopes[index])
  );
}

function toResponse(
  state: {
    enabled: boolean;
    mode: HouseholdPlanningAutomationMode | null;
    scopes: readonly HouseholdPlanningAutomationScope[];
    weekday: number | null;
    localTime: string | null;
    timeZone: string | null;
    version: number;
  },
  now: Date
): HouseholdPlanningAutomationResponse {
  const nextRun =
    state.enabled && state.weekday !== null && state.localTime !== null && state.timeZone !== null
      ? nextHouseholdWeeklyOccurrence(
          {
            weekday: state.weekday as ISOWeekday,
            localTime: state.localTime,
            timeZone: state.timeZone
          },
          now
        )
      : null;
  const parsed = householdPlanningAutomationResponseSchema.safeParse({
    ...state,
    scopes: [...state.scopes],
    nextRunAt: nextRun?.utcInstant ?? null,
    nextRun
  });
  if (!parsed.success) throw new HouseholdPlanningAutomationStoreError('AUTOMATION_STATE_CORRUPT');
  return parsed.data;
}

function hasPermission(
  db: Database.Database,
  householdId: string,
  userId: string,
  permission: 'settings' | 'calendar.edit'
): boolean {
  const membership = db
    .prepare(
      `SELECT role, permissions FROM household_members
        WHERE household_id = ? AND user_id = ? AND is_active = 1`
    )
    .get(householdId, userId) as { role: string; permissions: string | null } | undefined;
  if (!membership) return false;
  if (membership.permissions === null) return membership.role === 'admin';

  try {
    const permissions: unknown = JSON.parse(membership.permissions);
    if (!permissions || typeof permissions !== 'object') return false;
    if (permission === 'settings') {
      return 'settings' in permissions && permissions.settings === true;
    }
    if (
      !('calendar' in permissions) ||
      !permissions.calendar ||
      typeof permissions.calendar !== 'object'
    ) {
      return false;
    }
    return 'edit' in permissions.calendar && permissions.calendar.edit === true;
  } catch {
    return false;
  }
}
