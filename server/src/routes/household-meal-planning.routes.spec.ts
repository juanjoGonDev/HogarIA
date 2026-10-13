import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type User = { id: string; token: string };

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let jwtSecret = '';

beforeAll(async () => {
  const database = await import('../config/database.js');
  const { householdMealPlanningRoutes } = await import('./household-meal-planning.routes.js');
  const { config } = await import('../config/app.config.js');
  await database.initializeDatabase();
  closeDatabase = database.closeDatabase;
  db = database.getDatabase();
  app = new Hono();
  app.route('/api/household', householdMealPlanningRoutes);
  app.onError((error, context) => context.json({ success: false, message: error.message }, 500));
  jwtSecret = config.auth.jwtSecret;
});

afterAll(() => closeDatabase?.());

beforeEach(() => {
  db.exec('DROP TRIGGER IF EXISTS reject_meal_planning_update');
  db.prepare('DELETE FROM household_members').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM households').run();
});

function addHousehold(id = 'home') {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    id,
    id,
    `INV-${id}`
  );
}

function addUser(id: string, householdId: string | null, settings: boolean): User {
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, household_id, preferences)
     VALUES (?, ?, ?, 'hash', ?, ?)`
  ).run(
    id,
    `${id}@hogaria.test`,
    id,
    householdId,
    JSON.stringify({
      taste: { goals: ['weight-loss'], goalNotes: 'Quiero cuidarme', allergies: ['gluten'] }
    })
  );
  if (householdId) {
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      `membership-${id}`,
      householdId,
      id,
      settings ? 'admin' : 'member',
      JSON.stringify({ settings })
    );
  }
  return {
    id,
    token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
  };
}

function call(user: User, method: string, body?: unknown, householdId = 'home') {
  return app.request('/api/household/meal-planning', {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json',
      ...(householdId ? { 'x-household-id': householdId } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe('household meal-planning settings routes', () => {
  it('returns defaults and only the caller personal profile on GET', async () => {
    addHousehold();
    const member = addUser('member', 'home', false);

    const response = await call(member, 'GET');
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json.data).toMatchObject({
      household: {
        objective: { goals: ['balanced'], notes: '' },
        mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true }
      },
      member: {
        goalOverrideEnabled: false,
        scheduleOverrideEnabled: false,
        personalObjective: { goals: ['weight-loss'], notes: 'Quiero cuidarme' }
      },
      effective: { objective: { source: 'household', goals: ['balanced'], notes: '' } }
    });
    expect(JSON.stringify(json)).not.toContain('gluten');
  });

  it('lets any active member change only their own toggles and schedule', async () => {
    addHousehold();
    const member = addUser('member', 'home', false);

    const response = await call(member, 'PATCH', {
      member: {
        goalOverrideEnabled: true,
        scheduleOverrideEnabled: true,
        schedule: { mealTypes: { dinner: false }, mealTimes: { dinner: '19:45' } }
      }
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.member.goalOverrideEnabled).toBe(true);
    expect(json.data.effective.objective).toMatchObject({
      source: 'member',
      goals: ['weight-loss'],
      notes: 'Quiero cuidarme'
    });
    expect(json.data.effective.schedule).toMatchObject({
      source: 'member',
      mealTypes: { dinner: false },
      mealTimes: { dinner: '19:45' }
    });
  });

  it('requires the existing settings permission to change shared defaults', async () => {
    addHousehold();
    const admin = addUser('admin', 'home', true);
    const member = addUser('member', 'home', false);

    const denied = await call(member, 'PATCH', {
      household: { objective: { goals: ['variety'] } }
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe('HOUSEHOLD_SETTINGS_REQUIRED');
    const allowed = await call(admin, 'PATCH', {
      household: {
        objective: { goals: ['variety'], notes: 'De temporada' },
        mealTypes: { snack: false },
        mealTimes: { lunch: '13:30' }
      }
    });
    const json = await allowed.json();
    expect(allowed.status).toBe(200);
    expect(json.data.household.objective).toEqual({ goals: ['variety'], notes: 'De temporada' });
    expect(json.data.household.mealTypes.snack).toBe(false);
    expect(json.data.household.mealTimes.lunch).toBe('13:30');
  });

  it('honors the legacy admin fallback but fails closed for malformed permission JSON', async () => {
    addHousehold();
    const legacyAdmin = addUser('legacy-admin', 'home', true);
    const malformed = addUser('malformed', 'home', false);
    db.prepare('UPDATE household_members SET permissions = NULL WHERE user_id = ?').run(
      legacyAdmin.id
    );
    db.prepare("UPDATE household_members SET permissions = '{' WHERE user_id = ?").run(
      malformed.id
    );

    const allowed = await call(legacyAdmin, 'PATCH', {
      household: { objective: { goals: ['maintenance'] } }
    });
    const denied = await call(malformed, 'PATCH', {
      household: { objective: { goals: ['variety'] } }
    });

    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  it('rolls back a failed shared-default write and returns a generic save error', async () => {
    addHousehold();
    const admin = addUser('admin', 'home', true);
    db.exec(`
      CREATE TRIGGER reject_meal_planning_update
      BEFORE UPDATE OF meal_planning_preferences ON households
      BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END;
    `);

    const response = await call(admin, 'PATCH', {
      household: { objective: { goals: ['variety'] } }
    });

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('HOUSEHOLD_MEAL_PLANNING_SAVE_FAILED');
    expect(
      (
        db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home') as {
          meal_planning_preferences: string;
        }
      ).meal_planning_preferences
    ).toBe('{}');
    db.exec('DROP TRIGGER reject_meal_planning_update');
  });

  it('rejects mixed unauthorized writes atomically', async () => {
    addHousehold();
    const member = addUser('member', 'home', false);

    const response = await call(member, 'PATCH', {
      household: { objective: { goals: ['variety'] } },
      member: { goalOverrideEnabled: true }
    });

    expect(response.status).toBe(403);
    const storedMember = db
      .prepare('SELECT meal_planning_preferences FROM household_members WHERE user_id = ?')
      .get('member') as { meal_planning_preferences: string };
    expect(JSON.parse(storedMember.meal_planning_preferences)).toEqual({});
    const responseAgain = await call(member, 'GET');
    expect((await responseAgain.json()).data.household.objective.goals).toEqual(['balanced']);
  });

  it('rejects malformed patches, invalid times, missing home context, and stale home headers', async () => {
    addHousehold();
    const member = addUser('member', 'home', false);
    expect((await call(member, 'PATCH', {})).status).toBe(400);
    expect(
      (await call(member, 'PATCH', { household: { mealTimes: { dinner: '29:00' } } })).status
    ).toBe(400);
    expect((await call(member, 'GET', undefined, 'other-home')).status).toBe(409);

    const solo = addUser('solo', null, false);
    expect((await call(solo, 'GET')).status).toBe(404);
  });

  it('rejects malformed JSON and unauthenticated requests', async () => {
    addHousehold();
    const member = addUser('member', 'home', false);
    const malformed = await app.request('/api/household/meal-planning', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${member.token}`,
        'content-type': 'application/json',
        'x-household-id': 'home'
      },
      body: '{'
    });
    const unauthenticated = await app.request('/api/household/meal-planning');

    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe('INVALID_MEAL_PLANNING_SETTINGS');
    expect(unauthenticated.status).toBe(401);
  });
});
