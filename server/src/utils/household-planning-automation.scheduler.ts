import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { HouseholdPlanningAutomationWorkerDependencies } from './household-planning-automation.worker.js';
import { runHouseholdPlanningAutomationOccurrence } from './household-planning-automation.worker.js';
import { readHouseholdPlanningAutomation } from './household-planning-automation.store.js';
import {
  nextHouseholdWeeklyOccurrence,
  type HouseholdWeeklyOccurrence,
  type HouseholdWeeklySchedule
} from './household-weekly-schedule.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const RUNNER_FAILURE = 'WORKER_FAILURE';

export interface HouseholdPlanningAutomationPollReport {
  checkedHouseholds: number;
  dueOccurrences: number;
  attempted: number;
  failed: number;
}

export interface HouseholdPlanningAutomationSchedulerOptions {
  workerId?: string;
  intervalMs?: number;
  clock?: () => Date;
  runOccurrence?: typeof runHouseholdPlanningAutomationOccurrence;
  workerDependencies?: HouseholdPlanningAutomationWorkerDependencies;
  onError?: (code: typeof RUNNER_FAILURE) => void;
}

export interface HouseholdPlanningAutomationScheduler {
  pollOnce: () => Promise<HouseholdPlanningAutomationPollReport>;
  stop: () => Promise<void>;
}

/** Selects the latest due occurrence after the schedule was saved, never a stale activation backlog. */
export function latestDueHouseholdPlanningOccurrence(
  schedule: HouseholdWeeklySchedule,
  now: Date,
  lastConfigurationChange: Date
): HouseholdWeeklyOccurrence | null {
  if (
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime()) ||
    !(lastConfigurationChange instanceof Date) ||
    !Number.isFinite(lastConfigurationChange.getTime())
  ) {
    throw new RangeError('now must be a valid Date');
  }
  const nextOccurrence = nextHouseholdWeeklyOccurrence(schedule, now);
  const latestPastOccurrence = nextHouseholdWeeklyOccurrence(
    schedule,
    new Date(Date.parse(nextOccurrence.utcInstant) - 8 * DAY_MS)
  );
  const scheduledAt = Date.parse(latestPastOccurrence.utcInstant);
  return scheduledAt <= now.getTime() && scheduledAt > lastConfigurationChange.getTime()
    ? latestPastOccurrence
    : null;
}

/** Poll one due occurrence per household. The durable occurrence key arbitrates other processes. */
export async function pollHouseholdPlanningAutomations(
  db: Database.Database,
  now: Date,
  options: Pick<
    HouseholdPlanningAutomationSchedulerOptions,
    'workerId' | 'runOccurrence' | 'workerDependencies' | 'onError'
  > = {}
): Promise<HouseholdPlanningAutomationPollReport> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new RangeError('now must be a valid Date');
  }
  const rows = db.transaction(() => {
    const configured = db
      .prepare(
        `SELECT household_id, updated_at, version FROM household_planning_automations
            WHERE enabled = 1 ORDER BY household_id`
      )
      .all() as Array<{ household_id: string; updated_at: string; version: number }>;
    return configured.map((row) => ({
      ...row,
      state: readHouseholdPlanningAutomation(db, row.household_id, now)
    }));
  })();
  const report: HouseholdPlanningAutomationPollReport = {
    checkedHouseholds: rows.length,
    dueOccurrences: 0,
    attempted: 0,
    failed: 0
  };
  const workerId = options.workerId ?? randomUUID();
  const runOccurrence = options.runOccurrence ?? runHouseholdPlanningAutomationOccurrence;

  for (const { household_id: householdId, updated_at: updatedAt, version, state } of rows) {
    if (options.workerDependencies?.signal?.aborted) break;
    try {
      if (!state.enabled || state.weekday === null || state.localTime === null || !state.timeZone) {
        continue;
      }
      const occurrence = latestDueHouseholdPlanningOccurrence(
        {
          weekday: state.weekday as HouseholdWeeklySchedule['weekday'],
          localTime: state.localTime,
          timeZone: state.timeZone
        },
        now,
        parseSqliteUtcTimestamp(updatedAt)
      );
      if (!occurrence) continue;

      report.dueOccurrences += 1;
      await runOccurrence(
        { db, householdId, workerId, occurrence, expectedConfigVersion: version, now },
        options.workerDependencies
      );
      report.attempted += 1;
    } catch {
      report.failed += 1;
      report.attempted += 1;
      try {
        options.onError?.(RUNNER_FAILURE);
      } catch {
        // Diagnostics must not prevent polling another household.
      }
    }
  }

  return report;
}

/** Starts an immediate poll and a single non-overlapping timer; stop aborts active provider work. */
export function startHouseholdPlanningAutomationScheduler(
  db: Database.Database,
  options: HouseholdPlanningAutomationSchedulerOptions = {}
): HouseholdPlanningAutomationScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new RangeError('intervalMs must be an integer of at least 1000 ms');
  }

  const workerId = options.workerId ?? randomUUID();
  const controller = new AbortController();
  let stopped = false;
  let activePoll: Promise<HouseholdPlanningAutomationPollReport> | null = null;

  const pollOnce = (): Promise<HouseholdPlanningAutomationPollReport> => {
    if (stopped) return Promise.resolve(emptyReport());
    if (activePoll) return activePoll;
    const now = options.clock?.() ?? new Date();
    const polling = pollHouseholdPlanningAutomations(db, now, {
      workerId,
      runOccurrence: options.runOccurrence,
      workerDependencies: {
        ...options.workerDependencies,
        signal: controller.signal
      },
      onError: options.onError ?? logSafeFailure
    }).catch(() => {
      try {
        (options.onError ?? logSafeFailure)(RUNNER_FAILURE);
      } catch {
        // Diagnostics are best-effort and cannot break the scheduler loop.
      }
      return { ...emptyReport(), failed: 1 };
    });
    activePoll = polling.finally(() => {
      activePoll = null;
    });
    return activePoll;
  };

  const timer = setInterval(() => {
    void pollOnce();
  }, intervalMs);
  timer.unref?.();
  void pollOnce();

  return {
    pollOnce,
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        controller.abort();
      }
      await activePoll;
    }
  };
}

function emptyReport(): HouseholdPlanningAutomationPollReport {
  return { checkedHouseholds: 0, dueOccurrences: 0, attempted: 0, failed: 0 };
}

function logSafeFailure(code: typeof RUNNER_FAILURE): void {
  console.error(`[PlanningAutomation] Scheduled processing failed (${code}).`);
}

function parseSqliteUtcTimestamp(value: string): Date {
  const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) throw new RangeError('Invalid configuration timestamp');
  return parsed;
}
