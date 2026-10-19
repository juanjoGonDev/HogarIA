import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { Hono } from 'hono';
import type { HouseholdWeeklyOccurrence } from './household-weekly-schedule.js';
import type {
  HouseholdPlanningAutomationProvider,
  RunHouseholdPlanningAutomationOccurrenceInput
} from './household-planning-automation.worker.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type Run =
  (typeof import('./household-planning-automation.worker.js'))['runHouseholdPlanningAutomationOccurrence'];

let db: Sql;
let closeDatabase: () => void;
let scheduler: typeof import('./household-planning-automation.scheduler.js');
let saveAutomation: (typeof import('./household-planning-automation.store.js'))['saveHouseholdPlanningAutomation'];
let api: Hono;
let jwtSecret = '';

const schedule = {
  weekday: 1 as const,
  localTime: '09:30',
  timeZone: 'Europe/Madrid'
};

function makeHousehold(id: string) {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    id,
    id,
    `INVITE-${id}`
  );
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(`${id}-owner`, `${id}@hogaria.test`, id, 'synthetic-hash', id);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'member', ?)`
  ).run(
    `${id}-membership`,
    id,
    `${id}-owner`,
    JSON.stringify({ settings: true, calendar: { edit: true } })
  );
}

function enableAutomation(id: string) {
  const configured = saveAutomation(
    db,
    id,
    `${id}-owner`,
    { expectedVersion: 0, mode: 'generate', scopes: ['tasks'], ...schedule },
    new Date('2026-10-11T10:00:00.000Z')
  );
  if (configured.status !== 'saved') throw new Error('Synthetic automation config conflicted.');
  const enabled = saveAutomation(
    db,
    id,
    `${id}-owner`,
    { expectedVersion: 1, enabled: true },
    new Date('2026-10-11T10:00:00.000Z')
  );
  if (enabled.status !== 'saved') throw new Error('Synthetic automation activation conflicted.');
  db.prepare('UPDATE household_planning_automations SET updated_at = ? WHERE household_id = ?').run(
    '2026-10-11 10:00:00',
    id
  );
}

describe('household planning automation scheduler', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    scheduler = await import('./household-planning-automation.scheduler.js');
    const automationStore = await import('./household-planning-automation.store.js');
    const { config } = await import('../config/app.config.js');
    const { householdPlanningAutomationRoutes } =
      await import('../routes/household-planning-automation.routes.js');
    saveAutomation = automationStore.saveHouseholdPlanningAutomation;
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
    api = new Hono();
    api.route('/api/household', householdPlanningAutomationRoutes);
    jwtSecret = config.auth.jwtSecret;
  });

  afterAll(() => {
    closeDatabase();
    vi.useRealTimers();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM household_planning_automation_runs').run();
    db.prepare('DELETE FROM household_planning_automations').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    vi.useRealTimers();
  });

  it('runs only the most recent occurrence whose local scheduled time has passed', async () => {
    makeHousehold('home-a');
    enableAutomation('home-a');
    const started: RunHouseholdPlanningAutomationOccurrenceInput[] = [];
    const runOccurrence = vi.fn<Run>(async (input) => {
      started.push(input);
      return { outcome: 'review_required', run: null };
    });

    const report = await scheduler.pollHouseholdPlanningAutomations(
      db,
      new Date('2026-10-12T07:31:00.000Z'),
      { workerId: 'scheduler-test', runOccurrence }
    );

    expect(report).toEqual({ checkedHouseholds: 1, dueOccurrences: 1, attempted: 1, failed: 0 });
    expect(runOccurrence).toHaveBeenCalledTimes(1);
    expect(started[0]).toMatchObject({
      householdId: 'home-a',
      workerId: 'scheduler-test',
      expectedConfigVersion: 2,
      occurrence: {
        scheduledLocalDate: '2026-10-12',
        timeZone: 'Europe/Madrid',
        utcInstant: '2026-10-12T07:30:00.000Z'
      }
    });
  });

  it('polls through the real worker once, records completion, and publishes without duplicates', async () => {
    makeHousehold('home-a');
    enableAutomation('home-a');
    const provider = vi.fn<HouseholdPlanningAutomationProvider>(
      async (_messages, responseFormat) => {
        if (responseFormat.json_schema.name !== 'household_task_proposal') {
          throw new Error('Unexpected synthetic response format.');
        }
        return JSON.stringify({
          tasks: [{ title: 'Limpiar la encimera', scheduledDate: '2026-10-19', spaceId: null }]
        });
      }
    );
    const now = new Date('2026-10-12T07:31:00.000Z');
    const options = {
      workerId: 'scheduler-integration-test',
      workerDependencies: { provider, random: () => 0.5 }
    };

    const firstPoll = await scheduler.pollHouseholdPlanningAutomations(db, now, options);
    const secondPoll = await scheduler.pollHouseholdPlanningAutomations(db, now, options);

    expect(firstPoll).toEqual({ checkedHouseholds: 1, dueOccurrences: 1, attempted: 1, failed: 0 });
    expect(secondPoll).toEqual({
      checkedHouseholds: 1,
      dueOccurrences: 1,
      attempted: 1,
      failed: 0
    });
    expect(provider).toHaveBeenCalledTimes(1);
    const recordedRun = db
      .prepare(
        `SELECT status, target_week_start AS targetWeekStart, completed_at AS completedAt
           FROM household_planning_automation_runs WHERE household_id = ?`
      )
      .get('home-a');
    expect(recordedRun).toMatchObject({
      status: 'completed',
      targetWeekStart: '2026-10-19',
      completedAt: expect.any(String)
    });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM household_planning_automation_runs WHERE household_id = ?'
        )
        .get('home-a')
    ).toEqual({ count: 1 });

    const publishedWeek = db
      .prepare(
        `SELECT version, tasks_json AS tasksJson FROM household_task_weeks
          WHERE household_id = ? AND week_start = ?`
      )
      .get('home-a', '2026-10-19') as { version: number; tasksJson: string } | undefined;
    expect(publishedWeek).toBeDefined();
    expect(publishedWeek?.version).toBe(1);
    expect(JSON.parse(publishedWeek?.tasksJson ?? '[]')).toMatchObject([
      { title: 'Limpiar la encimera', scheduledDate: '2026-10-19' }
    ]);
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM household_task_weeks WHERE household_id = ? AND week_start = ?'
        )
        .get('home-a', '2026-10-19')
    ).toEqual({ count: 1 });
  });

  it('runs an HTTP-saved schedule through the due poller, worker, and one publication', async () => {
    makeHousehold('home-route');
    const ownerId = 'home-route-owner';
    const token = jwt.sign({ sub: ownerId, email: 'home-route@hogaria.test' }, jwtSecret, {
      expiresIn: '1h'
    });

    const saved = await api.request('/api/household/planning-automation', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-household-id': 'home-route'
      },
      body: JSON.stringify({
        expectedVersion: 0,
        enabled: true,
        mode: 'generate',
        scopes: ['tasks'],
        weekday: 1,
        localTime: '09:30',
        timeZone: 'Europe/Madrid'
      })
    });
    expect(saved.status).toBe(200);
    const savedPayload = (await saved.json()) as {
      data: {
        nextRun: { localDate: string; localTime: string; timeZone: string; utcInstant: string };
      };
    };
    expect(savedPayload).toMatchObject({
      success: true,
      data: {
        enabled: true,
        version: 1,
        nextRun: {
          localTime: '09:30',
          timeZone: 'Europe/Madrid'
        }
      }
    });

    const scheduledAt = Date.parse(savedPayload.data.nextRun.utcInstant);
    expect(scheduledAt).toBeGreaterThan(Date.now());
    const now = new Date(scheduledAt + 60_000);
    const targetWeek = new Date(`${savedPayload.data.nextRun.localDate}T00:00:00.000Z`);
    targetWeek.setUTCDate(targetWeek.getUTCDate() + 7);
    const targetWeekStart = targetWeek.toISOString().slice(0, 10);
    const provider = vi.fn<HouseholdPlanningAutomationProvider>(
      async (_messages, responseFormat) => {
        expect(responseFormat.json_schema.name).toBe('household_task_proposal');
        return JSON.stringify({
          tasks: [{ title: 'Limpiar la encimera', scheduledDate: targetWeekStart, spaceId: null }]
        });
      }
    );
    const options = {
      workerId: 'http-config-scheduler-integration',
      workerDependencies: { provider, random: () => 0.5 }
    };
    const firstPoll = await scheduler.pollHouseholdPlanningAutomations(db, now, options);
    const secondPoll = await scheduler.pollHouseholdPlanningAutomations(db, now, options);

    expect(firstPoll).toEqual({ checkedHouseholds: 1, dueOccurrences: 1, attempted: 1, failed: 0 });
    expect(secondPoll).toEqual({
      checkedHouseholds: 1,
      dueOccurrences: 1,
      attempted: 1,
      failed: 0
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      db
        .prepare(
          `SELECT status, target_week_start AS targetWeekStart
             FROM household_planning_automation_runs WHERE household_id = ?`
        )
        .get('home-route')
    ).toMatchObject({ status: 'completed', targetWeekStart });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM household_task_weeks
            WHERE household_id = ? AND week_start = ?`
        )
        .get('home-route', targetWeekStart)
    ).toEqual({ count: 1 });
  });

  it('does not execute before the configured wall-clock time or for paused homes', async () => {
    makeHousehold('home-a');
    enableAutomation('home-a');
    makeHousehold('home-b');
    const runOccurrence = vi.fn<Run>(async () => ({ outcome: 'completed', run: null }));

    const report = await scheduler.pollHouseholdPlanningAutomations(
      db,
      new Date('2026-10-12T07:29:00.000Z'),
      { workerId: 'scheduler-test', runOccurrence }
    );

    expect(report).toEqual({ checkedHouseholds: 1, dueOccurrences: 0, attempted: 0, failed: 0 });
    expect(runOccurrence).not.toHaveBeenCalled();
  });

  it('polls after startup, serializes ticks, and waits for an in-flight run on shutdown', async () => {
    makeHousehold('home-a');
    enableAutomation('home-a');
    vi.useFakeTimers();
    let finishFirstRun: ((result: Awaited<ReturnType<Run>>) => void) | undefined;
    const firstRun = new Promise<Awaited<ReturnType<Run>>>((resolve) => {
      finishFirstRun = resolve;
    });
    const runSignals: AbortSignal[] = [];
    let runCount = 0;
    const runOccurrence = vi.fn<Run>((_input, dependencies) => {
      runCount += 1;
      if (dependencies?.signal) runSignals.push(dependencies.signal);
      return runCount === 1 ? firstRun : Promise.resolve({ outcome: 'completed', run: null });
    });
    const onPoll = vi.fn(() => {
      if (onPoll.mock.calls.length === 1) throw new Error('Synthetic diagnostic failure.');
    });
    const started = scheduler.startHouseholdPlanningAutomationScheduler(db, {
      workerId: 'scheduler-test',
      intervalMs: 30_000,
      clock: () => new Date('2026-10-12T07:31:00.000Z'),
      runOccurrence,
      onPoll
    });

    const inFlightPoll = started.pollOnce();
    expect(runOccurrence).toHaveBeenCalledTimes(1);
    expect(onPoll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runOccurrence).toHaveBeenCalledTimes(1);
    expect(onPoll).toHaveBeenCalledTimes(1);

    finishFirstRun?.({ outcome: 'completed', run: null });
    await inFlightPoll;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(runOccurrence).toHaveBeenCalledTimes(2);
    expect(onPoll).toHaveBeenCalledTimes(2);

    const stopping = started.stop();
    expect(runSignals[0]?.aborted).toBe(true);
    await stopping;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runOccurrence).toHaveBeenCalledTimes(2);
    expect(onPoll).toHaveBeenCalledTimes(2);
  });
});

describe('latest due household planning occurrence', () => {
  it('ignores occurrences before config was saved and selects only the latest due week', async () => {
    const { latestDueHouseholdPlanningOccurrence } =
      await import('./household-planning-automation.scheduler.js');
    expect(
      latestDueHouseholdPlanningOccurrence(
        schedule,
        new Date('2026-10-12T07:29:00.000Z'),
        new Date('2026-10-11T10:00:00.000Z')
      )
    ).toBeNull();
    const due = latestDueHouseholdPlanningOccurrence(
      schedule,
      new Date('2026-10-12T07:31:00.000Z'),
      new Date('2026-10-11T10:00:00.000Z')
    ) as HouseholdWeeklyOccurrence;
    expect(due.scheduledLocalDate).toBe('2026-10-12');
    expect(due.utcInstant).toBe('2026-10-12T07:30:00.000Z');
    const resumedAfterMissedWeek = latestDueHouseholdPlanningOccurrence(
      schedule,
      new Date('2026-10-19T08:00:00.000Z'),
      new Date('2026-10-11T10:00:00.000Z')
    );
    expect(resumedAfterMissedWeek?.scheduledLocalDate).toBe('2026-10-19');
  });
});
