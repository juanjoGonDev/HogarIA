import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { Hono } from 'hono';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.DISABLE_RATE_LIMIT = '1';

type Sql = import('better-sqlite3').Database;
type App = Awaited<ReturnType<typeof import('../app.js').createApp>>;
type User = { id: string; token: string };

const { startAutomationRetry } = vi.hoisted(() => ({ startAutomationRetry: vi.fn() }));
vi.mock('../utils/household-planning-automation.worker.js', () => ({
  startHouseholdPlanningAutomationRetry: startAutomationRetry
}));

let app: App;
let routeOnlyApp: Hono;
let db: Sql;
let closeDatabase: () => void;
let jwtSecret = '';

function makeHousehold(id: string) {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    id,
    id,
    `INVITE-${id}`
  );
}

function makeUser(
  id: string,
  householdId: string,
  permissions: { settings?: boolean; calendar?: { edit?: boolean } } = {}
): User {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, `${id}@hogaria.test`, id, 'synthetic-hash', householdId);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'member', ?)`
  ).run(`${id}-membership`, householdId, id, JSON.stringify(permissions));
  return {
    id,
    token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
  };
}

function makeUserWithoutHousehold(id: string): User {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, NULL)'
  ).run(id, `${id}@hogaria.test`, id, 'synthetic-hash');
  return {
    id,
    token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
  };
}
function request(
  user: User,
  method: string,
  body?: unknown,
  householdId = 'home-a',
  path = '/api/household/planning-automation'
) {
  return app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json',
      'x-household-id': householdId
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const scheduledConfig = {
  mode: 'generate',
  scopes: ['meals', 'tasks'],
  weekday: 1,
  localTime: '09:30',
  timeZone: 'Europe/Madrid'
};

describe('household planning automation routes', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { config } = await import('../config/app.config.js');
    const { createApp } = await import('../app.js');
    const { householdPlanningAutomationRoutes } =
      await import('./household-planning-automation.routes.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
    app = createApp({ rateLimit: null, staticDir: null });
    routeOnlyApp = new Hono();
    routeOnlyApp.route('/api/household', householdPlanningAutomationRoutes);
    jwtSecret = config.auth.jwtSecret;
  });

  afterAll(async () => {
    const { stopWorker } = await import('../utils/ticket-queue.js');
    stopWorker();
    closeDatabase();
  });

  beforeEach(() => {
    startAutomationRetry.mockReset();
    db.prepare('DELETE FROM household_planning_automation_runs').run();
    db.prepare('DELETE FROM household_planning_automations').run();
    db.prepare('DELETE FROM household_task_weeks').run();
    db.prepare('DELETE FROM household_plans').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
  });

  it('is mounted on the main app and GET exposes an off-by-default, read-only value', async () => {
    makeHousehold('home-a');
    const member = makeUser('reader', 'home-a');
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(member.id);

    const response = await request(member, 'GET');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        enabled: false,
        mode: null,
        scopes: [],
        weekday: null,
        localTime: null,
        timeZone: null,
        version: 0,
        nextRunAt: null,
        nextRun: null,
        lastRun: null
      }
    });
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM household_planning_automations').get() as {
          count: number;
        }
      ).count
    ).toBe(0);
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBeNull();
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM household_task_weeks').get() as { count: number })
        .count
    ).toBe(0);
  });

  it('requires an active household and the matching household header', async () => {
    makeHousehold('home-a');
    const member = makeUser('reader', 'home-a');

    const mismatch = await request(member, 'GET', undefined, 'home-b');
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_CONTEXT_CHANGED'
    });

    const noHousehold = makeUserWithoutHousehold('unaffiliated');
    const missing = await routeOnlyApp.request('/api/household/planning-automation', {
      headers: {
        authorization: `Bearer ${noHousehold.token}`,
        'x-household-id': 'home-a'
      }
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_REQUIRED'
    });
  });

  it('rejects malformed, unknown, and unauthenticated writes without persistence', async () => {
    makeHousehold('home-a');
    const manager = makeUser('manager', 'home-a', { settings: true });

    const malformed = await app.request('/api/household/planning-automation', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${manager.token}`,
        'content-type': 'application/json',
        'x-household-id': 'home-a'
      },
      body: '{'
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      success: false,
      code: 'INVALID_HOUSEHOLD_PLANNING_AUTOMATION'
    });

    const extra = await request(manager, 'PATCH', {
      expectedVersion: 0,
      enabled: false,
      extra: true
    });
    expect(extra.status).toBe(400);

    const unauthenticated = await app.request('/api/household/planning-automation', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-household-id': 'home-a' },
      body: JSON.stringify({ expectedVersion: 0, enabled: false })
    });
    expect(unauthenticated.status).toBe(401);
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM household_planning_automations').get() as {
          count: number;
        }
      ).count
    ).toBe(0);
  });

  it('requires settings for edits and settings plus calendar.edit for activation', async () => {
    makeHousehold('home-a');
    const noSettings = makeUser('reader', 'home-a', { calendar: { edit: true } });
    const noCalendarEdit = makeUser('settings-only', 'home-a', { settings: true });

    const deniedEdit = await request(noSettings, 'PATCH', {
      expectedVersion: 0,
      ...scheduledConfig
    });
    expect(deniedEdit.status).toBe(403);
    expect(await deniedEdit.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SETTINGS_REQUIRED'
    });

    const deniedActivation = await request(noCalendarEdit, 'PATCH', {
      expectedVersion: 0,
      enabled: true,
      ...scheduledConfig
    });
    expect(deniedActivation.status).toBe(403);
    expect(await deniedActivation.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED'
    });
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM household_planning_automations').get() as {
          count: number;
        }
      ).count
    ).toBe(0);
  });

  it('requires an explicit complete schedule before enabling and returns CAS conflicts', async () => {
    makeHousehold('home-a');
    const manager = makeUser('manager', 'home-a', { settings: true, calendar: { edit: true } });

    const incomplete = await request(manager, 'PATCH', { expectedVersion: 0, enabled: true });
    expect(incomplete.status).toBe(422);
    expect(await incomplete.json()).toMatchObject({
      success: false,
      code: 'AUTOMATION_SCHEDULE_REQUIRED'
    });

    const enabled = await request(manager, 'PATCH', {
      expectedVersion: 0,
      enabled: true,
      ...scheduledConfig
    });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({
      success: true,
      data: {
        enabled: true,
        version: 1,
        mode: 'generate',
        scopes: ['meals', 'tasks'],
        nextRunAt: expect.any(String),
        nextRun: { timeZone: 'Europe/Madrid', occurrenceKey: expect.any(String) }
      }
    });

    const stale = await request(manager, 'PATCH', {
      expectedVersion: 0,
      mode: 'repeat'
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_PLANNING_AUTOMATION_VERSION_CONFLICT',
      data: { version: 1, mode: 'generate', enabled: true }
    });
  });

  it('allows a settings-only member to pause without clearing schedule or writing plans', async () => {
    makeHousehold('home-a');
    const editor = makeUser('editor', 'home-a', { settings: true, calendar: { edit: true } });
    const settingsOnly = makeUser('settings-reader', 'home-a', { settings: true });

    const enabled = await request(editor, 'PATCH', {
      expectedVersion: 0,
      enabled: true,
      ...scheduledConfig
    });
    expect(enabled.status).toBe(200);

    const paused = await request(settingsOnly, 'PATCH', { expectedVersion: 1, enabled: false });
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({
      success: true,
      data: {
        enabled: false,
        version: 2,
        mode: 'generate',
        scopes: ['meals', 'tasks'],
        weekday: 1,
        localTime: '09:30',
        timeZone: 'Europe/Madrid',
        nextRunAt: null,
        nextRun: null
      }
    });
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM household_plans').get() as { count: number }).count
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM household_task_weeks').get() as { count: number })
        .count
    ).toBe(0);
  });

  it('projects only a sanitized latest run to the settings GET response', async () => {
    makeHousehold('home-a');
    const manager = makeUser('manager', 'home-a', { settings: true, calendar: { edit: true } });
    const enabled = await request(manager, 'PATCH', {
      expectedVersion: 0,
      enabled: true,
      ...scheduledConfig
    });
    expect(enabled.status).toBe(200);

    const { nextHouseholdWeeklyOccurrence } = await import('../utils/household-weekly-schedule.js');
    const { claimHouseholdPlanningAutomationOccurrence, failHouseholdPlanningAutomationRun } =
      await import('../utils/household-planning-automation-runs.store.js');
    const schedule = {
      weekday: scheduledConfig.weekday as 1,
      localTime: scheduledConfig.localTime,
      timeZone: scheduledConfig.timeZone
    };
    const occurrence = nextHouseholdWeeklyOccurrence(
      schedule,
      new Date('2026-10-11T10:00:00.000Z')
    );
    const claimed = claimHouseholdPlanningAutomationOccurrence(db, {
      householdId: 'home-a',
      expectedConfigVersion: 1,
      mode: 'generate',
      scopes: ['meals', 'tasks'],
      schedule,
      occurrence,
      targetWeekStart: '2026-10-19',
      workerId: 'route-test-worker',
      leaseMs: 30_000,
      now: new Date(occurrence.utcInstant)
    });
    expect(claimed.outcome).toBe('claimed');
    if (!claimed.run) throw new Error('The synthetic occurrence was not claimed.');
    db.prepare('UPDATE household_planning_automation_runs SET updated_at = ? WHERE id = ?').run(
      '2026-10-12 07:30:00',
      claimed.run.id
    );

    const inProgress = await request(manager, 'GET');
    expect(inProgress.status).toBe(200);
    const inProgressBody = (await inProgress.json()) as { data: { lastRun: unknown } };
    expect(inProgressBody.data.lastRun).toEqual({
      occurrenceKey: occurrence.occurrenceKey,
      targetWeekStart: '2026-10-19',
      status: 'in_progress',
      failureCode: null,
      updatedAt: '2026-10-12T07:30:00.000Z'
    });

    failHouseholdPlanningAutomationRun(db, {
      runId: claimed.run.id,
      workerId: 'route-test-worker',
      fence: claimed.run.fence,
      now: new Date(Date.parse(occurrence.utcInstant) + 1_000),
      failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS'
    });

    const response = await request(manager, 'GET');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      data: expect.objectContaining({
        lastRun: {
          occurrenceKey: occurrence.occurrenceKey,
          targetWeekStart: '2026-10-19',
          status: 'review_required',
          failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
          updatedAt: new Date(Date.parse(occurrence.utcInstant) + 1_000).toISOString()
        }
      })
    });
    const { lastRun } = (body as { data: { lastRun: unknown } }).data;
    expect(lastRun).toEqual({
      occurrenceKey: occurrence.occurrenceKey,
      targetWeekStart: '2026-10-19',
      status: 'review_required',
      failureCode: 'PROVIDER_TIMEOUT_AMBIGUOUS',
      updatedAt: new Date(Date.parse(occurrence.utcInstant) + 1_000).toISOString()
    });
  });

  it('claims only an explicit retry and returns the sanitized in-progress run without awaiting it', async () => {
    makeHousehold('home-a');
    const manager = makeUser('manager', 'home-a', { settings: true, calendar: { edit: true } });
    const completion = new Promise(() => undefined);
    const run = {
      id: 'private-run-id',
      householdId: 'private-household-id',
      occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30',
      scheduledAt: '2026-10-12T07:30:00.000Z',
      scheduledLocalDate: '2026-10-12',
      timeZone: 'Europe/Madrid',
      configVersion: 4,
      mode: 'generate',
      scopes: ['meals', 'tasks'],
      targetWeekStart: '2026-10-19',
      status: 'in_progress',
      leaseExpiresAt: '2026-10-12T07:35:00.000Z',
      fence: 8,
      failureCode: null,
      createdAt: '2026-10-12T07:30:00.000Z',
      updatedAt: '2026-10-12T07:30:00.000Z',
      completedAt: null
    };
    startAutomationRetry.mockReturnValue({ outcome: 'claimed', run, completion });

    const response = await request(
      manager,
      'POST',
      {
        expectedVersion: 4,
        occurrenceKey: run.occurrenceKey
      },
      'home-a',
      '/api/household/planning-automation/retry'
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: {
        lastRun: {
          occurrenceKey: run.occurrenceKey,
          targetWeekStart: '2026-10-19',
          status: 'in_progress',
          failureCode: null,
          updatedAt: '2026-10-12T07:30:00.000Z'
        }
      }
    });
    expect(startAutomationRetry).toHaveBeenCalledTimes(1);
    expect(startAutomationRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'home-a',
        occurrenceKey: run.occurrenceKey,
        requestedBy: manager.id,
        expectedVersion: 4
      })
    );
  });

  it('rejects an invalid retry body, household context, or caller permissions before claiming', async () => {
    makeHousehold('home-a');
    const noPermissions = makeUser('reader', 'home-a');
    const noCalendarEdit = makeUser('settings-only', 'home-a', { settings: true });
    const manager = makeUser('manager', 'home-a', { settings: true, calendar: { edit: true } });

    const malformed = await request(
      manager,
      'POST',
      { expectedVersion: 0 },
      'home-a',
      '/api/household/planning-automation/retry'
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      success: false,
      code: 'INVALID_HOUSEHOLD_PLANNING_AUTOMATION_RETRY'
    });

    const malformedJson = await app.request('/api/household/planning-automation/retry', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${manager.token}`,
        'content-type': 'application/json',
        'x-household-id': 'home-a'
      },
      body: '{'
    });
    expect(malformedJson.status).toBe(400);
    expect(await malformedJson.json()).toMatchObject({
      success: false,
      code: 'INVALID_HOUSEHOLD_PLANNING_AUTOMATION_RETRY'
    });

    const denied = await request(
      noPermissions,
      'POST',
      {
        expectedVersion: 4,
        occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30'
      },
      'home-a',
      '/api/household/planning-automation/retry'
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ success: false });

    const deniedCalendarEdit = await request(
      noCalendarEdit,
      'POST',
      {
        expectedVersion: 4,
        occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30'
      },
      'home-a',
      '/api/household/planning-automation/retry'
    );
    expect(deniedCalendarEdit.status).toBe(403);

    const wrongContext = await request(
      manager,
      'POST',
      {
        expectedVersion: 4,
        occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30'
      },
      'home-b',
      '/api/household/planning-automation/retry'
    );
    expect(wrongContext.status).toBe(409);
    expect(startAutomationRetry).not.toHaveBeenCalled();
  });

  it.each([
    ['not_authorized', 403, 'HOUSEHOLD_PLANNING_AUTOMATION_RETRY_FORBIDDEN'],
    ['authorization_invalid', 403, 'HOUSEHOLD_PLANNING_AUTOMATION_RETRY_FORBIDDEN'],
    ['not_found', 404, 'HOUSEHOLD_PLANNING_AUTOMATION_RUN_NOT_FOUND'],
    ['stale_config', 409, 'HOUSEHOLD_PLANNING_AUTOMATION_RETRY_STALE'],
    ['busy', 409, 'HOUSEHOLD_PLANNING_AUTOMATION_RUN_BUSY'],
    ['already_completed', 409, 'HOUSEHOLD_PLANNING_AUTOMATION_RUN_NOT_RETRYABLE'],
    ['not_retryable', 409, 'HOUSEHOLD_PLANNING_AUTOMATION_RUN_NOT_RETRYABLE'],
    ['review_required', 409, 'HOUSEHOLD_PLANNING_AUTOMATION_RUN_RETRY_REQUIRED'],
    ['cancelled', 409, 'HOUSEHOLD_PLANNING_AUTOMATION_RUN_TERMINAL'],
    ['skipped', 409, 'HOUSEHOLD_PLANNING_AUTOMATION_RUN_TERMINAL']
  ])('maps retry outcome %s to a safe HTTP response', async (outcome, status, code) => {
    makeHousehold('home-a');
    const manager = makeUser('manager', 'home-a', { settings: true, calendar: { edit: true } });
    startAutomationRetry.mockReturnValue({ outcome, run: null });

    const response = await request(
      manager,
      'POST',
      {
        expectedVersion: 4,
        occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30'
      },
      'home-a',
      '/api/household/planning-automation/retry'
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, code });
  });
});
