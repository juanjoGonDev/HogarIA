import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  HouseholdPlanningAutomationMode,
  HouseholdPlanningAutomationScope
} from '../schemas/household-planning-automation.schema.js';
import {
  nextHouseholdWeeklyOccurrence,
  type HouseholdWeeklyOccurrence,
  type HouseholdWeeklySchedule
} from './household-weekly-schedule.js';

export type HouseholdPlanningAutomationRunStatus =
  'in_progress' | 'review_required' | 'completed' | 'cancelled' | 'skipped';

export type HouseholdPlanningAutomationFailureCode =
  | 'AUTOMATION_PAUSED'
  | 'CONFIG_STALE'
  | 'AUTHORIZATION_INVALID'
  | 'LEASE_EXPIRED_AMBIGUOUS'
  | 'PROVIDER_TIMEOUT_AMBIGUOUS'
  | 'PROVIDER_REJECTED'
  | 'INVALID_PROPOSAL'
  | 'PUBLISH_CONFLICT'
  | 'TARGET_WEEK_MISSED'
  | 'WORKER_FAILURE';

export interface HouseholdPlanningAutomationRunSnapshot {
  id: string;
  householdId: string;
  occurrenceKey: string;
  scheduledAt: string;
  scheduledLocalDate: string;
  timeZone: string;
  configVersion: number;
  mode: HouseholdPlanningAutomationMode;
  scopes: HouseholdPlanningAutomationScope[];
  targetWeekStart: string;
  status: HouseholdPlanningAutomationRunStatus;
  leaseExpiresAt: string | null;
  fence: number;
  failureCode: HouseholdPlanningAutomationFailureCode | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface HouseholdPlanningAutomationOccurrenceInput {
  householdId: string;
  expectedConfigVersion: number;
  mode: HouseholdPlanningAutomationMode;
  scopes: HouseholdPlanningAutomationScope[];
  schedule: HouseholdWeeklySchedule;
  occurrence: HouseholdWeeklyOccurrence;
  /** Must be the Monday strictly after `occurrence.scheduledLocalDate`. */
  targetWeekStart: string;
  now: Date;
}

export interface ClaimHouseholdPlanningAutomationOccurrenceInput extends HouseholdPlanningAutomationOccurrenceInput {
  workerId: string;
  leaseMs: number;
}

export interface HouseholdPlanningAutomationLeaseInput {
  runId: string;
  workerId: string;
  fence: number;
  now: Date;
}

export type ClaimHouseholdPlanningAutomationOccurrenceResult = {
  outcome:
    | 'claimed'
    | 'busy'
    | 'already_completed'
    | 'review_required'
    | 'cancelled'
    | 'stale_config'
    | 'authorization_invalid'
    | 'skipped'
    | 'not_due'
    | 'disabled';
  run: HouseholdPlanningAutomationRunSnapshot | null;
};

export type HouseholdPlanningAutomationRunResult = {
  outcome:
    | 'renewed'
    | 'completed'
    | 'already_completed'
    | 'review_required'
    | 'cancelled'
    | 'stale_config'
    | 'authorization_invalid'
    | 'skipped'
    | 'stale_lease'
    | 'not_found';
  run: HouseholdPlanningAutomationRunSnapshot | null;
};

export type RetryHouseholdPlanningAutomationRunResult = {
  outcome:
    | 'claimed'
    | 'busy'
    | 'already_completed'
    | 'review_required'
    | 'cancelled'
    | 'stale_config'
    | 'authorization_invalid'
    | 'not_authorized'
    | 'skipped'
    | 'not_retryable'
    | 'not_found';
  run: HouseholdPlanningAutomationRunSnapshot | null;
};

export type RecordMissedHouseholdPlanningAutomationOccurrenceResult = {
  outcome:
    | 'skipped'
    | 'already_completed'
    | 'review_required'
    | 'cancelled'
    | 'stale_config'
    | 'authorization_invalid'
    | 'not_missed'
    | 'disabled';
  run: HouseholdPlanningAutomationRunSnapshot | null;
};

type BlockedConfigurationOutcome = 'cancelled' | 'stale_config' | 'authorization_invalid';
type ConfigurationCheck = { outcome: BlockedConfigurationOutcome | 'disabled'; run: null };

export class HouseholdPlanningAutomationRunStoreError extends Error {
  constructor(
    readonly code:
      | 'AUTOMATION_RUN_INPUT_INVALID'
      | 'AUTOMATION_CONFIG_MISSING'
      | 'AUTOMATION_FAILURE_CODE_INVALID'
      | 'AUTOMATION_RUN_STATE_CORRUPT'
      | 'AUTOMATION_RUN_PUBLISH_MUST_BE_SYNCHRONOUS'
  ) {
    super(code);
    this.name = 'HouseholdPlanningAutomationRunStoreError';
  }
}

interface RunRow {
  id: string;
  household_id: string;
  occurrence_key: string;
  scheduled_at: string;
  scheduled_local_date: string;
  time_zone: string;
  config_version: number;
  mode: string;
  scopes_json: string;
  target_week_start: string;
  status: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  fence: number;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface AutomationRow {
  enabled: number;
  mode: string | null;
  scopes_json: string;
  weekday: number | null;
  local_time: string | null;
  time_zone: string | null;
  version: number;
  authorized_by: string | null;
}

const FAILURE_CODES = new Set<HouseholdPlanningAutomationFailureCode>([
  'AUTOMATION_PAUSED',
  'CONFIG_STALE',
  'AUTHORIZATION_INVALID',
  'LEASE_EXPIRED_AMBIGUOUS',
  'PROVIDER_TIMEOUT_AMBIGUOUS',
  'PROVIDER_REJECTED',
  'INVALID_PROPOSAL',
  'PUBLISH_CONFLICT',
  'TARGET_WEEK_MISSED',
  'WORKER_FAILURE'
]);

/**
 * Atomically records and claims the only row allowed for a household/occurrence pair.
 * An expired in-progress lease is never reclaimed: it becomes review-required because the
 * provider may have completed work before the process died.
 */
export function claimHouseholdPlanningAutomationOccurrence(
  db: Database.Database,
  input: ClaimHouseholdPlanningAutomationOccurrenceInput
): ClaimHouseholdPlanningAutomationOccurrenceResult {
  validateOccurrenceInput(input);
  validateWorker(input.workerId, input.leaseMs);
  const now = iso(input.now);

  return db
    .transaction((): ClaimHouseholdPlanningAutomationOccurrenceResult => {
      const existing = readRunByOccurrence(db, input.householdId, input.occurrence.occurrenceKey);
      if (existing) return handleExistingClaim(db, existing, input, now);
      if (Date.parse(input.occurrence.utcInstant) > input.now.getTime()) {
        return { outcome: 'not_due', run: null };
      }

      const blocked = checkCurrentConfiguration(db, input);
      if (blocked) {
        if (blocked.outcome === 'disabled') return blocked;
        const run = insertRun(db, input, {
          status: 'cancelled',
          failureCode:
            blocked.outcome === 'authorization_invalid'
              ? 'AUTHORIZATION_INVALID'
              : blocked.outcome === 'stale_config'
                ? 'CONFIG_STALE'
                : 'AUTOMATION_PAUSED'
        });
        return { ...blocked, run };
      }

      if (targetWeekHasStarted(input.targetWeekStart, input.schedule.timeZone, input.now)) {
        const run = insertRun(db, input, { status: 'skipped', failureCode: 'TARGET_WEEK_MISSED' });
        return { outcome: 'skipped', run };
      }

      const run = insertRun(db, input, {
        status: 'in_progress',
        leaseOwner: input.workerId,
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs).toISOString()
      });
      return { outcome: 'claimed', run };
    })
    .immediate();
}

/**
 * Reconciler helper for an occurrence discovered after its target week began. It writes a
 * terminal skipped row without acquiring a provider lease; it never retries or publishes.
 */
export function recordMissedHouseholdPlanningAutomationOccurrence(
  db: Database.Database,
  input: HouseholdPlanningAutomationOccurrenceInput
): RecordMissedHouseholdPlanningAutomationOccurrenceResult {
  validateOccurrenceInput(input);
  const now = iso(input.now);
  if (Date.parse(input.occurrence.utcInstant) > input.now.getTime()) {
    return { outcome: 'not_missed', run: null };
  }
  if (!targetWeekHasStarted(input.targetWeekStart, input.schedule.timeZone, input.now)) {
    return { outcome: 'not_missed', run: null };
  }

  return db
    .transaction((): RecordMissedHouseholdPlanningAutomationOccurrenceResult => {
      const existing = readRunByOccurrence(db, input.householdId, input.occurrence.occurrenceKey);
      if (existing) {
        if (existing.status === 'completed') return { outcome: 'already_completed', run: existing };
        if (existing.status === 'review_required') {
          return { outcome: 'skipped', run: markSkipped(db, existing, now) };
        }
        if (existing.status === 'cancelled') return { outcome: 'cancelled', run: existing };
        if (existing.status === 'skipped') return { outcome: 'skipped', run: existing };
        return { outcome: 'skipped', run: markSkipped(db, existing, now) };
      }

      const blocked = checkCurrentConfiguration(db, input);
      if (blocked) {
        if (blocked.outcome === 'disabled') return blocked;
        const run = insertRun(db, input, {
          status: 'cancelled',
          failureCode:
            blocked.outcome === 'authorization_invalid'
              ? 'AUTHORIZATION_INVALID'
              : blocked.outcome === 'stale_config'
                ? 'CONFIG_STALE'
                : 'AUTOMATION_PAUSED'
        });
        return { ...blocked, run };
      }
      const run = insertRun(db, input, { status: 'skipped', failureCode: 'TARGET_WEEK_MISSED' });
      return { outcome: 'skipped', run };
    })
    .immediate();
}

export function readHouseholdPlanningAutomationRun(
  db: Database.Database,
  householdId: string,
  occurrenceKey: string
): HouseholdPlanningAutomationRunSnapshot | null {
  return readRunByOccurrence(db, householdId, occurrenceKey);
}

/** Returns the latest occurrence snapshot for the household, suitable for a sanitized GET projection. */
export function readLatestHouseholdPlanningAutomationRun(
  db: Database.Database,
  householdId: string
): HouseholdPlanningAutomationRunSnapshot | null {
  if (typeof householdId !== 'string' || householdId.trim() === '') {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  const row = db
    .prepare(
      `SELECT * FROM household_planning_automation_runs
        WHERE household_id = ? ORDER BY scheduled_at DESC, updated_at DESC, id DESC LIMIT 1`
    )
    .get(householdId) as RunRow | undefined;
  return row ? toSnapshot(row) : null;
}

/** Extends an active lease only while its config and authorization are still valid. */
export function renewHouseholdPlanningAutomationRunLease(
  db: Database.Database,
  input: HouseholdPlanningAutomationLeaseInput & { leaseMs: number }
): HouseholdPlanningAutomationRunResult {
  validateLeaseInput(input);
  validateWorker(input.workerId, input.leaseMs);
  const now = iso(input.now);
  return db
    .transaction((): HouseholdPlanningAutomationRunResult => {
      const run = readRunById(db, input.runId);
      if (!run) return { outcome: 'not_found', run: null };
      const terminal = terminalOutcome(run);
      if (terminal) return { outcome: terminal, run };
      if (!ownsLease(db, run, input.workerId, input.fence)) return { outcome: 'stale_lease', run };
      const check = checkRunConfiguration(db, run);
      if (check) return terminalizeBlockedRun(db, run, check, now);
      if (targetWeekHasStarted(run.targetWeekStart, run.timeZone, input.now)) {
        return { outcome: 'skipped', run: markSkipped(db, run, now) };
      }
      if (isLeaseExpired(run, input.now)) {
        return { outcome: 'review_required', run: expireLeaseForReview(db, run, now) };
      }

      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      db.prepare(
        `UPDATE household_planning_automation_runs
          SET lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = 'in_progress' AND lease_owner = ? AND fence = ?`
      ).run(leaseExpiresAt, now, run.id, input.workerId, input.fence);
      return { outcome: 'renewed', run: readRunById(db, run.id) };
    })
    .immediate();
}

/**
 * Runs synchronous local publication and marks the ledger complete in the same SQLite
 * transaction. Provider calls must happen before this callback. An already-completed occurrence
 * is idempotent and does not invoke the callback again.
 */
export function completeHouseholdPlanningAutomationRun(
  db: Database.Database,
  input: HouseholdPlanningAutomationLeaseInput,
  publishAtomically: () => unknown
): HouseholdPlanningAutomationRunResult {
  validateLeaseInput(input);
  if (typeof publishAtomically !== 'function')
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  const now = iso(input.now);
  return db
    .transaction((): HouseholdPlanningAutomationRunResult => {
      const run = readRunById(db, input.runId);
      if (!run) return { outcome: 'not_found', run: null };
      const terminal = terminalOutcome(run);
      if (terminal) {
        return { outcome: terminal === 'completed' ? 'already_completed' : terminal, run };
      }
      if (!ownsLease(db, run, input.workerId, input.fence)) return { outcome: 'stale_lease', run };
      const check = checkRunConfiguration(db, run);
      if (check) return terminalizeBlockedRun(db, run, check, now);
      if (targetWeekHasStarted(run.targetWeekStart, run.timeZone, input.now)) {
        return { outcome: 'skipped', run: markSkipped(db, run, now) };
      }
      if (isLeaseExpired(run, input.now)) {
        return { outcome: 'review_required', run: expireLeaseForReview(db, run, now) };
      }

      if (Object.prototype.toString.call(publishAtomically) === '[object AsyncFunction]') {
        throw new HouseholdPlanningAutomationRunStoreError(
          'AUTOMATION_RUN_PUBLISH_MUST_BE_SYNCHRONOUS'
        );
      }
      const publishResult = publishAtomically();
      if (publishResult && typeof (publishResult as { then?: unknown }).then === 'function') {
        throw new HouseholdPlanningAutomationRunStoreError(
          'AUTOMATION_RUN_PUBLISH_MUST_BE_SYNCHRONOUS'
        );
      }
      db.prepare(
        `UPDATE household_planning_automation_runs
          SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL,
              failure_code = NULL, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'in_progress' AND lease_owner = ? AND fence = ?`
      ).run(now, now, run.id, input.workerId, input.fence);
      return { outcome: 'completed', run: readRunById(db, run.id) };
    })
    .immediate();
}

/** Fails to review using only an allowlisted code; arbitrary errors/details are never persisted. */
export function failHouseholdPlanningAutomationRun(
  db: Database.Database,
  input: HouseholdPlanningAutomationLeaseInput & {
    failureCode: HouseholdPlanningAutomationFailureCode;
  }
): HouseholdPlanningAutomationRunResult {
  validateLeaseInput(input);
  if (!FAILURE_CODES.has(input.failureCode)) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_FAILURE_CODE_INVALID');
  }
  const now = iso(input.now);
  return db
    .transaction((): HouseholdPlanningAutomationRunResult => {
      const run = readRunById(db, input.runId);
      if (!run) return { outcome: 'not_found', run: null };
      const terminal = terminalOutcome(run);
      if (terminal) return { outcome: terminal, run };
      if (!ownsLease(db, run, input.workerId, input.fence)) return { outcome: 'stale_lease', run };
      const check = checkRunConfiguration(db, run);
      if (check) return terminalizeBlockedRun(db, run, check, now);
      if (targetWeekHasStarted(run.targetWeekStart, run.timeZone, input.now)) {
        return { outcome: 'skipped', run: markSkipped(db, run, now) };
      }
      if (isLeaseExpired(run, input.now)) {
        return { outcome: 'review_required', run: expireLeaseForReview(db, run, now) };
      }
      db.prepare(
        `UPDATE household_planning_automation_runs
          SET status = 'review_required', lease_owner = NULL, lease_expires_at = NULL,
              failure_code = ?, updated_at = ?
        WHERE id = ? AND status = 'in_progress' AND lease_owner = ? AND fence = ?`
      ).run(input.failureCode, now, run.id, input.workerId, input.fence);
      return { outcome: 'review_required', run: readRunById(db, run.id) };
    })
    .immediate();
}

/**
 * Explicitly reclaims a review-required occurrence from settings. This is never called by the
 * scheduler: it reuses the unique occurrence row, increments its fencing token, and requires
 * both a currently authorized requester and a still-valid automation authorizer/configuration.
 */
export function retryHouseholdPlanningAutomationRun(
  db: Database.Database,
  input: {
    householdId: string;
    occurrenceKey: string;
    expectedConfigVersion: number;
    requestedBy: string;
    workerId: string;
    leaseMs: number;
    now: Date;
  }
): RetryHouseholdPlanningAutomationRunResult {
  validateRetryInput(input);
  validateWorker(input.workerId, input.leaseMs);
  const now = iso(input.now);

  return db
    .transaction((): RetryHouseholdPlanningAutomationRunResult => {
      if (!isAuthorizationValid(db, input.householdId, input.requestedBy)) {
        return { outcome: 'not_authorized', run: null };
      }

      const run = readRunByOccurrence(db, input.householdId, input.occurrenceKey);
      if (!run) return { outcome: 'not_found', run: null };
      if (run.status === 'completed') return { outcome: 'already_completed', run };
      if (run.status === 'cancelled') return { outcome: 'cancelled', run };
      if (run.status === 'skipped') return { outcome: 'skipped', run };
      if (run.status === 'in_progress') {
        const blocked = checkRunConfiguration(db, run);
        if (blocked) return terminalizeBlockedRun(db, run, blocked, now);
        if (targetWeekHasStarted(run.targetWeekStart, run.timeZone, input.now)) {
          return { outcome: 'skipped', run: markSkipped(db, run, now) };
        }
        return isLeaseExpired(run, input.now)
          ? { outcome: 'review_required', run: expireLeaseForReview(db, run, now) }
          : { outcome: 'busy', run };
      }
      if (run.failureCode === null) return { outcome: 'not_retryable', run };

      if (run.configVersion !== input.expectedConfigVersion) {
        return terminalizeBlockedRun(db, run, { outcome: 'stale_config' }, now);
      }
      const blocked = checkRunConfiguration(db, run);
      if (blocked) return terminalizeBlockedRun(db, run, blocked, now);
      if (targetWeekHasStarted(run.targetWeekStart, run.timeZone, input.now)) {
        return { outcome: 'skipped', run: markSkipped(db, run, now) };
      }
      if (run.fence >= Number.MAX_SAFE_INTEGER) {
        throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_STATE_CORRUPT');
      }

      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs).toISOString();
      db.prepare(
        `UPDATE household_planning_automation_runs
            SET status = 'in_progress', lease_owner = ?, lease_expires_at = ?, fence = fence + 1,
                failure_code = NULL, updated_at = ?
          WHERE id = ? AND status = 'review_required' AND fence = ?`
      ).run(input.workerId, leaseExpiresAt, now, run.id, run.fence);
      const retried = readRunById(db, run.id);
      if (!retried || retried.fence !== run.fence + 1) {
        throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_STATE_CORRUPT');
      }
      return { outcome: 'claimed', run: retried };
    })
    .immediate();
}

/** Cancels leases captured under earlier config versions; completion is independently fenced too. */
export function cancelStaleHouseholdPlanningAutomationRuns(
  db: Database.Database,
  householdId: string,
  currentConfigVersion: number,
  now: Date
): number {
  if (!householdId || !Number.isSafeInteger(currentConfigVersion) || currentConfigVersion < 0) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  const updatedAt = iso(now);
  return db
    .prepare(
      `UPDATE household_planning_automation_runs
          SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
              failure_code = 'CONFIG_STALE', updated_at = ?
        WHERE household_id = ? AND status = 'in_progress' AND config_version <> ?`
    )
    .run(updatedAt, householdId, currentConfigVersion).changes;
}

function handleExistingClaim(
  db: Database.Database,
  run: HouseholdPlanningAutomationRunSnapshot,
  input: ClaimHouseholdPlanningAutomationOccurrenceInput,
  now: string
): ClaimHouseholdPlanningAutomationOccurrenceResult {
  if (run.status === 'completed') return { outcome: 'already_completed', run };
  if (run.status === 'cancelled') {
    return {
      outcome: run.failureCode === 'AUTHORIZATION_INVALID' ? 'authorization_invalid' : 'cancelled',
      run
    };
  }
  if (run.status === 'skipped') return { outcome: 'skipped', run };
  const blocked = checkRunConfiguration(db, run);
  if (blocked) {
    const terminal = terminalizeBlockedRun(db, run, blocked, now);
    return { outcome: terminal.outcome, run: terminal.run };
  }
  if (targetWeekHasStarted(run.targetWeekStart, run.timeZone, input.now)) {
    return { outcome: 'skipped', run: markSkipped(db, run, now) };
  }
  if (run.status === 'review_required') return { outcome: 'review_required', run };
  if (isLeaseExpired(run, input.now)) {
    return { outcome: 'review_required', run: expireLeaseForReview(db, run, now) };
  }
  return { outcome: 'busy', run };
}

function checkCurrentConfiguration(
  db: Database.Database,
  input: HouseholdPlanningAutomationOccurrenceInput
): ConfigurationCheck | null {
  const row = db
    .prepare(
      `SELECT enabled, mode, scopes_json, weekday, local_time, time_zone, version, authorized_by
         FROM household_planning_automations WHERE household_id = ?`
    )
    .get(input.householdId) as AutomationRow | undefined;
  if (!row) return { outcome: 'disabled', run: null };
  if (row.version !== input.expectedConfigVersion) return { outcome: 'stale_config', run: null };
  if (row.enabled !== 1) return { outcome: 'cancelled', run: null };

  const scopes = parseScopes(row.scopes_json);
  if (
    row.mode !== input.mode ||
    scopes.length !== input.scopes.length ||
    !scopes.every((scope, index) => scope === input.scopes[index]) ||
    row.weekday !== input.schedule.weekday ||
    row.local_time !== input.schedule.localTime ||
    row.time_zone !== input.schedule.timeZone
  ) {
    return { outcome: 'stale_config', run: null };
  }
  if (!isAuthorizationValid(db, input.householdId, row.authorized_by)) {
    pauseForInvalidAuthorization(db, input.householdId, row.version);
    return { outcome: 'authorization_invalid', run: null };
  }
  return null;
}

function checkRunConfiguration(
  db: Database.Database,
  run: HouseholdPlanningAutomationRunSnapshot
): { outcome: 'cancelled' | 'stale_config' | 'authorization_invalid' } | null {
  const row = db
    .prepare(
      `SELECT enabled, mode, scopes_json, version, authorized_by
         FROM household_planning_automations WHERE household_id = ?`
    )
    .get(run.householdId) as
    | Pick<AutomationRow, 'enabled' | 'mode' | 'scopes_json' | 'version' | 'authorized_by'>
    | undefined;
  if (!row || row.version !== run.configVersion || row.mode !== run.mode) {
    return { outcome: 'stale_config' };
  }
  const scopes = parseScopes(row.scopes_json);
  if (
    scopes.length !== run.scopes.length ||
    !scopes.every((scope, index) => scope === run.scopes[index])
  ) {
    return { outcome: 'stale_config' };
  }
  if (row.enabled !== 1) return { outcome: 'cancelled' };
  if (!isAuthorizationValid(db, run.householdId, row.authorized_by)) {
    pauseForInvalidAuthorization(db, run.householdId, row.version);
    return { outcome: 'authorization_invalid' };
  }
  return null;
}

function terminalizeBlockedRun(
  db: Database.Database,
  run: HouseholdPlanningAutomationRunSnapshot,
  blocked: { outcome: BlockedConfigurationOutcome },
  now: string
): { outcome: BlockedConfigurationOutcome; run: HouseholdPlanningAutomationRunSnapshot | null } {
  const failureCode: HouseholdPlanningAutomationFailureCode =
    blocked.outcome === 'authorization_invalid'
      ? 'AUTHORIZATION_INVALID'
      : blocked.outcome === 'stale_config'
        ? 'CONFIG_STALE'
        : 'AUTOMATION_PAUSED';
  db.prepare(
    `UPDATE household_planning_automation_runs
        SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
            failure_code = ?, updated_at = ?
      WHERE id = ? AND status IN ('in_progress', 'review_required')`
  ).run(failureCode, now, run.id);
  return { outcome: blocked.outcome, run: readRunById(db, run.id) };
}

function insertRun(
  db: Database.Database,
  input: HouseholdPlanningAutomationOccurrenceInput,
  details:
    | { status: 'in_progress'; leaseOwner: string; leaseExpiresAt: string }
    | {
        status: Exclude<HouseholdPlanningAutomationRunStatus, 'in_progress'>;
        failureCode: HouseholdPlanningAutomationFailureCode;
      }
): HouseholdPlanningAutomationRunSnapshot {
  const id = randomUUID();
  const leaseOwner = details.status === 'in_progress' ? details.leaseOwner : null;
  const leaseExpiresAt = details.status === 'in_progress' ? details.leaseExpiresAt : null;
  const failureCode = details.status === 'in_progress' ? null : details.failureCode;
  db.prepare(
    `INSERT INTO household_planning_automation_runs
      (id, household_id, occurrence_key, scheduled_at, scheduled_local_date, time_zone,
       config_version, mode, scopes_json, target_week_start, status, lease_owner,
       lease_expires_at, fence, failure_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id,
    input.householdId,
    input.occurrence.occurrenceKey,
    input.occurrence.utcInstant,
    input.occurrence.scheduledLocalDate,
    input.schedule.timeZone,
    input.expectedConfigVersion,
    input.mode,
    JSON.stringify(input.scopes),
    input.targetWeekStart,
    details.status,
    leaseOwner,
    leaseExpiresAt,
    failureCode
  );
  const run = readRunById(db, id);
  if (!run) throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_STATE_CORRUPT');
  return run;
}

function readRunByOccurrence(
  db: Database.Database,
  householdId: string,
  occurrenceKey: string
): HouseholdPlanningAutomationRunSnapshot | null {
  const row = db
    .prepare(
      'SELECT * FROM household_planning_automation_runs WHERE household_id = ? AND occurrence_key = ?'
    )
    .get(householdId, occurrenceKey) as RunRow | undefined;
  return row ? toSnapshot(row) : null;
}

function readRunById(
  db: Database.Database,
  runId: string
): HouseholdPlanningAutomationRunSnapshot | null {
  const row = db
    .prepare('SELECT * FROM household_planning_automation_runs WHERE id = ?')
    .get(runId) as RunRow | undefined;
  return row ? toSnapshot(row) : null;
}

function toSnapshot(row: RunRow): HouseholdPlanningAutomationRunSnapshot {
  const scopes = parseScopes(row.scopes_json);
  if (
    !['in_progress', 'review_required', 'completed', 'cancelled', 'skipped'].includes(row.status) ||
    (row.mode !== 'generate' && row.mode !== 'repeat') ||
    (row.failure_code !== null &&
      !FAILURE_CODES.has(row.failure_code as HouseholdPlanningAutomationFailureCode))
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_STATE_CORRUPT');
  }
  if (
    (row.status === 'in_progress') !==
    (row.lease_owner !== null && row.lease_expires_at !== null)
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_STATE_CORRUPT');
  }
  return {
    id: row.id,
    householdId: row.household_id,
    occurrenceKey: row.occurrence_key,
    scheduledAt: row.scheduled_at,
    scheduledLocalDate: row.scheduled_local_date,
    timeZone: row.time_zone,
    configVersion: row.config_version,
    mode: row.mode,
    scopes,
    targetWeekStart: row.target_week_start,
    status: row.status as HouseholdPlanningAutomationRunStatus,
    leaseExpiresAt: row.lease_expires_at,
    fence: row.fence,
    failureCode: row.failure_code as HouseholdPlanningAutomationFailureCode | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

function parseScopes(json: string): HouseholdPlanningAutomationScope[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_STATE_CORRUPT');
  }
  if (
    !Array.isArray(decoded) ||
    decoded.length < 1 ||
    decoded.length > 2 ||
    decoded.some((scope) => scope !== 'meals' && scope !== 'tasks') ||
    new Set(decoded).size !== decoded.length
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_STATE_CORRUPT');
  }
  return decoded as HouseholdPlanningAutomationScope[];
}

function validateOccurrenceInput(input: HouseholdPlanningAutomationOccurrenceInput): void {
  if (
    !input ||
    typeof input.householdId !== 'string' ||
    input.householdId.trim() === '' ||
    !Number.isSafeInteger(input.expectedConfigVersion) ||
    input.expectedConfigVersion < 1 ||
    (input.mode !== 'generate' && input.mode !== 'repeat') ||
    !Array.isArray(input.scopes) ||
    input.scopes.length < 1 ||
    input.scopes.length > 2 ||
    input.scopes.some((scope) => scope !== 'tasks' && scope !== 'meals') ||
    new Set(input.scopes).size !== input.scopes.length ||
    !input.occurrence ||
    !input.schedule
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  iso(input.now);
  let expected: HouseholdWeeklyOccurrence;
  try {
    expected = nextHouseholdWeeklyOccurrence(
      input.schedule,
      new Date(Date.parse(input.occurrence.utcInstant) - 1)
    );
  } catch {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  if (
    expected.occurrenceKey !== input.occurrence.occurrenceKey ||
    expected.utcInstant !== input.occurrence.utcInstant ||
    expected.scheduledLocalDate !== input.occurrence.scheduledLocalDate ||
    expected.localDate !== input.occurrence.localDate ||
    expected.localTime !== input.occurrence.localTime ||
    expected.timeZone !== input.occurrence.timeZone ||
    input.schedule.timeZone !== input.occurrence.timeZone ||
    input.targetWeekStart !== nextMondayAfter(input.occurrence.scheduledLocalDate)
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
}

function validateWorker(workerId: string, leaseMs: number): void {
  if (
    typeof workerId !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,100}$/.test(workerId) ||
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 1_000 ||
    leaseMs > 3_600_000
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
}

function validateLeaseInput(input: HouseholdPlanningAutomationLeaseInput): void {
  if (
    !input ||
    typeof input.runId !== 'string' ||
    input.runId.trim() === '' ||
    typeof input.workerId !== 'string' ||
    !Number.isSafeInteger(input.fence) ||
    input.fence < 1
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  iso(input.now);
}

function validateRetryInput(input: {
  householdId: string;
  occurrenceKey: string;
  expectedConfigVersion: number;
  requestedBy: string;
  workerId: string;
  leaseMs: number;
  now: Date;
}): void {
  if (
    !input ||
    typeof input.householdId !== 'string' ||
    input.householdId.trim() === '' ||
    typeof input.occurrenceKey !== 'string' ||
    input.occurrenceKey.trim() === '' ||
    !Number.isSafeInteger(input.expectedConfigVersion) ||
    input.expectedConfigVersion < 1 ||
    typeof input.requestedBy !== 'string' ||
    input.requestedBy.trim() === ''
  ) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  iso(input.now);
}

function nextMondayAfter(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year!, month! - 1, day!);
  if (date.toISOString().slice(0, 10) !== isoDate) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (8 - weekday));
  return date.toISOString().slice(0, 10);
}

function targetWeekHasStarted(targetWeekStart: string, timeZone: string, now: Date): boolean {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== 'literal') parts[part.type] = part.value;
      return parts;
    }, {});
  const currentDate = `${localDate.year}-${localDate.month}-${localDate.day}`;
  return currentDate >= targetWeekStart;
}

function ownsLease(
  db: Database.Database,
  run: HouseholdPlanningAutomationRunSnapshot,
  workerId: string,
  fence: number
): boolean {
  if (run.status !== 'in_progress' || run.fence !== fence) return false;
  const lease = db
    .prepare('SELECT lease_owner FROM household_planning_automation_runs WHERE id = ?')
    .get(run.id) as { lease_owner: string | null } | undefined;
  return lease?.lease_owner === workerId;
}

function isLeaseExpired(run: HouseholdPlanningAutomationRunSnapshot, now: Date): boolean {
  return (
    run.status === 'in_progress' &&
    run.leaseExpiresAt !== null &&
    Date.parse(run.leaseExpiresAt) <= now.getTime()
  );
}

function expireLeaseForReview(
  db: Database.Database,
  run: HouseholdPlanningAutomationRunSnapshot,
  now: string
): HouseholdPlanningAutomationRunSnapshot {
  db.prepare(
    `UPDATE household_planning_automation_runs
        SET status = 'review_required', lease_owner = NULL, lease_expires_at = NULL,
            failure_code = 'LEASE_EXPIRED_AMBIGUOUS', updated_at = ?
      WHERE id = ? AND status = 'in_progress' AND lease_expires_at <= ?`
  ).run(now, run.id, now);
  return readRunById(db, run.id) ?? run;
}

function markSkipped(
  db: Database.Database,
  run: HouseholdPlanningAutomationRunSnapshot,
  now: string
): HouseholdPlanningAutomationRunSnapshot {
  db.prepare(
    `UPDATE household_planning_automation_runs
        SET status = 'skipped', lease_owner = NULL, lease_expires_at = NULL,
            failure_code = 'TARGET_WEEK_MISSED', updated_at = ?
      WHERE id = ? AND status IN ('in_progress', 'review_required')`
  ).run(now, run.id);
  return readRunById(db, run.id) ?? run;
}

function terminalOutcome(
  run: HouseholdPlanningAutomationRunSnapshot
): HouseholdPlanningAutomationRunResult['outcome'] | null {
  if (run.status === 'completed') return 'already_completed';
  if (run.status === 'review_required') return 'review_required';
  if (run.status === 'cancelled') return 'cancelled';
  if (run.status === 'skipped') return 'skipped';
  return null;
}

function isAuthorizationValid(
  db: Database.Database,
  householdId: string,
  authorizedBy: string | null
): boolean {
  if (!authorizedBy) return false;
  const member = db
    .prepare(
      `SELECT role, permissions FROM household_members
        WHERE household_id = ? AND user_id = ? AND is_active = 1`
    )
    .get(householdId, authorizedBy) as { role: string; permissions: string | null } | undefined;
  if (!member) return false;
  if (member.permissions === null) return member.role === 'admin';
  try {
    const permissions: unknown = JSON.parse(member.permissions);
    if (!permissions || typeof permissions !== 'object') return false;
    const value = permissions as Record<string, unknown>;
    const calendar = value.calendar;
    return (
      value.settings === true &&
      typeof calendar === 'object' &&
      calendar !== null &&
      'edit' in calendar &&
      (calendar as { edit?: unknown }).edit === true
    );
  } catch {
    return false;
  }
}

function pauseForInvalidAuthorization(
  db: Database.Database,
  householdId: string,
  version: number
): void {
  db.prepare(
    `UPDATE household_planning_automations
        SET enabled = 0, authorized_by = NULL, version = version + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ? AND version = ? AND enabled = 1`
  ).run(householdId, version);
}

function iso(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new HouseholdPlanningAutomationRunStoreError('AUTOMATION_RUN_INPUT_INVALID');
  }
  return date.toISOString();
}
