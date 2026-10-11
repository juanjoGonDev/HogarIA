import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import type { HouseholdPlan } from '../schemas/household-plan.schema.js';
import type { HouseholdTaskOccurrence } from '../schemas/household-task.schema.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type User = { id: string; token: string };

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let jwtSecret = '';

function validPlan(): HouseholdPlan {
  return {
    schemaVersion: 1,
    dwellingType: 'apartment',
    dwellingTypeLabel: null,
    summary: '',
    warnings: [],
    floors: [
      {
        id: 'floor-0',
        name: 'Planta baja',
        level: 0,
        walls: [],
        openings: [],
        spaces: [
          {
            id: 'kitchen',
            kind: 'kitchen',
            label: 'Cocina',
            polygon: [
              { x: 100, y: 100 },
              { x: 900, y: 100 },
              { x: 900, y: 900 },
              { x: 100, y: 900 }
            ],
            parentSpaceId: null
          }
        ]
      }
    ]
  };
}

function task(overrides: Partial<HouseholdTaskOccurrence> = {}): HouseholdTaskOccurrence {
  return {
    id: 'task-monday',
    title: 'Limpiar la cocina',
    details: null,
    spaceId: 'kitchen',
    scheduledDate: '2026-10-05',
    assignedMemberId: null,
    completed: false,
    ...overrides
  };
}

describe('household task week routes', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { householdTasksRoutes } = await import('./household-tasks.routes.js');
    const { config } = await import('../config/app.config.js');
    await database.initializeDatabase();
    closeDatabase = database.closeDatabase;
    db = database.getDatabase();
    app = new Hono();
    app.route('/api/household', householdTasksRoutes);
    app.onError((error, context) => context.json({ success: false, message: error.message }, 500));
    jwtSecret = config.auth.jwtSecret;
  });

  afterAll(async () => {
    const { stopWorker } = await import('../utils/ticket-queue.js');
    stopWorker();
    closeDatabase();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM household_task_weeks').run();
    db.prepare('DELETE FROM household_plans').run();
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
  });

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
    permissions: { calendar?: { edit?: boolean }; settings?: boolean } = {}
  ): User {
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
    ).run(id, `${id}@hogaria.test`, id, 'not-a-real-password-hash', householdId);
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
    ).run(id, `${id}@hogaria.test`, id, 'not-a-real-password-hash');
    return {
      id,
      token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
    };
  }

  function currentHouseholdId(user: User): string | undefined {
    return (
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(user.id) as
          { household_id: string | null } | undefined
      )?.household_id ?? undefined
    );
  }

  function call(
    user: User,
    method: string,
    body?: unknown,
    weekStart = '2026-10-05',
    requestedHouseholdId = currentHouseholdId(user)
  ) {
    return app.request(`/api/household/tasks?weekStart=${weekStart}`, {
      method,
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        ...(requestedHouseholdId ? { 'x-household-id': requestedHouseholdId } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  function saveBody(tasks: HouseholdTaskOccurrence[], baseVersion = 0) {
    return { baseVersion, weekStart: '2026-10-05', tasks };
  }

  function savePlan(householdId: string) {
    db.prepare(
      'INSERT INTO household_plans (household_id, version, plan_json) VALUES (?, 1, ?)'
    ).run(householdId, JSON.stringify(validPlan()));
  }

  it('allows active members to read an empty week without edit permission', async () => {
    makeHousehold('home-a');
    const reader = makeUser('reader-a', 'home-a', { settings: false });

    const response = await call(reader, 'GET');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { weekStart: '2026-10-05', version: 0, tasks: [] }
    });
  });

  it('distinguishes users who need to choose a home from users without a home', async () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    const member = makeUser('multi-home', 'home-a');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES ('multi-home-b', 'home-b', ?, 'member', '{}')`
    ).run(member.id);
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(member.id);

    const selection = await call(member, 'GET');
    expect(selection.status).toBe(409);
    expect(await selection.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SELECTION_REQUIRED'
    });

    const noHome = makeUserWithoutHousehold('no-home');
    const missing = await call(noHome, 'GET');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ success: false, code: 'HOUSEHOLD_REQUIRED' });
  });

  it('requires calendar.edit permission to save a task week', async () => {
    makeHousehold('home-a');
    const reader = makeUser('reader-a', 'home-a');

    const response = await call(reader, 'PUT', saveBody([task()]));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED'
    });
  });

  it('accepts legacy admin membership and rejects malformed permission data or request bodies', async () => {
    makeHousehold('home-a');
    const admin = makeUser('admin-a', 'home-a');
    db.prepare(
      "UPDATE household_members SET role = 'admin', permissions = NULL WHERE user_id = ?"
    ).run(admin.id);
    expect((await call(admin, 'PUT', saveBody([]))).status).toBe(200);

    const editor = makeUser('editor-a', 'home-a', { calendar: { edit: true } });
    db.prepare("UPDATE household_members SET permissions = '{' WHERE user_id = ?").run(editor.id);
    expect((await call(editor, 'PUT', saveBody([]))).status).toBe(403);
    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      JSON.stringify({ calendar: { edit: true } }),
      editor.id
    );

    const invalidShape = await call(editor, 'PUT', {});
    expect(invalidShape.status).toBe(400);
    expect(await invalidShape.json()).toMatchObject({ success: false, code: 'INVALID_TASK_WEEK' });

    const malformedJson = await app.request('/api/household/tasks?weekStart=2026-10-05', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${editor.token}`,
        'content-type': 'application/json',
        'x-household-id': 'home-a'
      },
      body: '{'
    });
    expect(malformedJson.status).toBe(400);
    expect(await malformedJson.json()).toMatchObject({ success: false, code: 'INVALID_TASK_WEEK' });
  });

  it('saves a household-scoped schedule with valid zones and active members using CAS', async () => {
    makeHousehold('home-a');
    const editor = makeUser('editor-a', 'home-a', { calendar: { edit: true } });
    const teammate = makeUser('member-a', 'home-a');
    savePlan('home-a');

    const first = await call(
      editor,
      'PUT',
      saveBody([task({ assignedMemberId: teammate.id, completed: true })])
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      success: true,
      data: {
        weekStart: '2026-10-05',
        version: 1,
        tasks: [
          { id: 'task-monday', spaceId: 'kitchen', assignedMemberId: teammate.id, completed: true }
        ]
      }
    });

    const stale = await call(editor, 'PUT', saveBody([task()], 0));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      success: false,
      code: 'TASK_WEEK_VERSION_CONFLICT',
      data: { version: 1, tasks: [{ assignedMemberId: teammate.id }] }
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_task_weeks').get()).toEqual({
      count: 1
    });
  });

  it('returns a recoverable server error when stored task or plan JSON is corrupt', async () => {
    makeHousehold('home-a');
    const editor = makeUser('editor-a', 'home-a', { calendar: { edit: true } });
    savePlan('home-a');
    db.prepare(
      `INSERT INTO household_task_weeks (household_id, week_start, version, tasks_json, updated_by)
       VALUES ('home-a', '2026-10-05', 1, '{', ?)`
    ).run(editor.id);

    const unreadable = await call(editor, 'GET');
    expect(unreadable.status).toBe(500);
    expect(await unreadable.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_TASK_WEEK_UNAVAILABLE'
    });

    db.prepare("UPDATE household_plans SET plan_json = '{' WHERE household_id = 'home-a'").run();
    const unsavable = await call(editor, 'PUT', saveBody([task({ spaceId: null })]));
    expect(unsavable.status).toBe(500);
    expect(await unsavable.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_TASK_WEEK_SAVE_FAILED'
    });
  });

  it('rejects a foreign space, inactive member, non-Monday week, and invalid week date', async () => {
    makeHousehold('home-a');
    const editor = makeUser('editor-a', 'home-a', { calendar: { edit: true } });
    const inactive = makeUser('inactive-a', 'home-a');
    savePlan('home-a');
    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run(inactive.id);

    expect((await call(editor, 'PUT', saveBody([task({ spaceId: 'foreign-space' })]))).status).toBe(
      422
    );
    expect(
      (await call(editor, 'PUT', saveBody([task({ assignedMemberId: inactive.id })]), '2026-10-05'))
        .status
    ).toBe(422);
    expect((await call(editor, 'GET', undefined, '2026-10-06')).status).toBe(400);
    expect((await call(editor, 'GET', undefined, '2026-02-30')).status).toBe(400);
  });

  it('does not expose a task week to another active household', async () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    const member = makeUser('multi-home', 'home-a', { calendar: { edit: true } });
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', ?)`
    ).run('multi-home-b', 'home-b', member.id, JSON.stringify({ calendar: { edit: true } }));
    savePlan('home-a');
    await call(member, 'PUT', saveBody([task()]));

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-b', member.id);
    const response = await call(member, 'GET');

    expect(await response.json()).toMatchObject({ success: true, data: { version: 0, tasks: [] } });
  });

  it('rejects a week read or write captured for a home that is no longer active', async () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    const member = makeUser('switching-member', 'home-a', { calendar: { edit: true } });
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES ('switching-member-b', 'home-b', ?, 'member', ?)`
    ).run(member.id, JSON.stringify({ calendar: { edit: true } }));
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-b', member.id);

    const staleRead = await call(member, 'GET', undefined, '2026-10-05', 'home-a');
    expect(staleRead.status).toBe(409);
    expect(await staleRead.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_CONTEXT_CHANGED'
    });

    const staleWrite = await call(
      member,
      'PUT',
      saveBody([task({ spaceId: null })]),
      '2026-10-05',
      'home-a'
    );
    expect(staleWrite.status).toBe(409);
    expect(await staleWrite.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_CONTEXT_CHANGED'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_task_weeks').get()).toEqual({
      count: 0
    });
  });
});
