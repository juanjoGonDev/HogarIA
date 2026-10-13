import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;
type User = { id: string; token: string };
type ApiResponse = { success: boolean; code?: string; data?: any };

let app: Hono;
let db: SqliteDb;
let closeDatabase: () => void;
let jwtSecret = '';

const householdId = 'consumption-route-home';
const recipeSnapshot = {
  name: 'Tortilla',
  description: 'Receta sintética',
  baseServings: 1,
  times: { prepTimeMinutes: 5, cookTimeMinutes: 10 },
  ingredients: [{ name: 'Patata', quantity: 100, unit: 'g', isOptional: false }],
  instructions: ['Cocinar.']
};

function addUser(
  id: string,
  permissions: { calendar: { view: boolean; edit: boolean } },
  active = true
): User {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, `${id}@hogaria.test`, id, 'synthetic', householdId);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
     VALUES (?, ?, ?, 'member', ?, ?)`
  ).run(`membership-${id}`, householdId, id, JSON.stringify(permissions), active ? 1 : 0);
  return {
    id,
    token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
  };
}

function addMeal(participantIds = ['alice', 'bob']) {
  db.prepare(
    `INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
     VALUES ('calendar-meals', ?, 'alice', '2026-10-12', '2026-10-18', '{}')`
  ).run(householdId);
  db.prepare(
    `INSERT INTO meals
      (id, calendar_id, date, meal_type, custom_meal, servings, source_proposal_id, proposal_id, recipe_snapshot)
     VALUES ('meal-1', 'calendar-meals', '2026-10-14', 'lunch', 'Tortilla', 4, 'proposal:event-1', 'proposal', ?)`
  ).run(JSON.stringify(recipeSnapshot));
  const addParticipant = db.prepare(
    'INSERT INTO meal_participants (meal_id, user_id) VALUES (?, ?)'
  );
  for (const participantId of participantIds) addParticipant.run('meal-1', participantId);
  return 'meal-1';
}

function addIngredient(id = 'potatoes', quantity = 1000, ownerId = 'alice') {
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
     VALUES (?, ?, ?, 'patata', 'other', ?, 'g')`
  ).run(id, ownerId, householdId, quantity);
}

function call(
  user: User,
  method: string,
  mealId = 'meal-1',
  body?: unknown,
  selectedHouse = householdId
) {
  return app.request(`/api/household/meal-planning/meals/${mealId}/consumption`, {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json',
      'x-household-id': selectedHouse
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function callRaw(user: User, method: string, body: string, selectedHouse = householdId) {
  return app.request('/api/household/meal-planning/meals/meal-1/consumption', {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json',
      'x-household-id': selectedHouse
    },
    body
  });
}

async function read(response: Response): Promise<ApiResponse> {
  return (await response.json()) as ApiResponse;
}

describe('household meal consumption route', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { householdMealConsumptionRoutes } =
      await import('./household-meal-consumption.routes.js');
    const { config } = await import('../config/app.config.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
    jwtSecret = config.auth.jwtSecret;
    app = new Hono();
    app.route('/api/household', householdMealConsumptionRoutes);
    app.onError((error, context) => context.json({ success: false, message: error.message }, 500));
  });

  afterAll(() => closeDatabase?.());

  beforeEach(() => {
    db.exec('DROP TRIGGER IF EXISTS fail_route_movement');
    db.prepare('DELETE FROM meal_inventory_movements').run();
    db.prepare('DELETE FROM meal_consumption_deductions').run();
    db.prepare('DELETE FROM meal_consumptions').run();
    db.prepare('DELETE FROM meal_participants').run();
    db.prepare('DELETE FROM meals').run();
    db.prepare('DELETE FROM weekly_calendars').run();
    db.prepare('DELETE FROM ingredients').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    db.prepare(
      'INSERT INTO households (id, name, invite_code, shared_pantry) VALUES (?, ?, ?, 1)'
    ).run(householdId, 'Casa consumo', 'CONSUMER01');
    addUser('alice', { calendar: { view: true, edit: true } });
    addUser('bob', { calendar: { view: true, edit: false } });
    addUser('private-view', { calendar: { view: false, edit: false } });
    addUser('outsider', { calendar: { view: true, edit: false } });
    addMeal(['alice', 'bob', 'private-view']);
    addIngredient();
  });

  it('lets a read-only explicit participant mark and correct consumption, with safe retry and atomic stock', async () => {
    const bob = {
      id: 'bob',
      token: jwt.sign({ sub: 'bob', email: 'bob@hogaria.test' }, jwtSecret)
    };
    const initial = await read(await call(bob, 'GET'));
    expect(initial).toMatchObject({
      success: true,
      data: { status: 'unrecorded', servings: null, version: 0, warnings: [] }
    });

    const first = await read(
      await call(bob, 'PUT', 'meal-1', {
        status: 'realized',
        servings: 2,
        expectedVersion: 0
      })
    );
    const retry = await read(
      await call(bob, 'PUT', 'meal-1', {
        status: 'realized',
        servings: 2,
        expectedVersion: 0
      })
    );
    expect(first).toMatchObject({
      success: true,
      data: { status: 'realized', servings: 2, version: 1 }
    });
    expect(retry).toMatchObject({
      success: true,
      data: { status: 'realized', servings: 2, version: 1, idempotent: true }
    });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'potatoes'").get()).toEqual({
      quantity: 800
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements').get()).toEqual({
      count: 1
    });

    const correction = await read(
      await call(bob, 'PUT', 'meal-1', {
        status: 'not_realized',
        servings: 0,
        expectedVersion: 1
      })
    );
    expect(correction).toMatchObject({
      success: true,
      data: { status: 'not_realized', servings: 0, version: 2 }
    });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'potatoes'").get()).toEqual({
      quantity: 1000
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements').get()).toEqual({
      count: 2
    });
  });

  it('rejects callers without active explicit event access and rejects stale household context', async () => {
    const outsider = { id: 'outsider', token: jwt.sign({ sub: 'outsider' }, jwtSecret) };
    const privateView = { id: 'private-view', token: jwt.sign({ sub: 'private-view' }, jwtSecret) };
    const noParticipant = await call(outsider, 'PUT', 'meal-1', {
      status: 'realized',
      servings: 1,
      expectedVersion: 0
    });
    expect(noParticipant.status).toBe(403);
    expect(await read(noParticipant)).toMatchObject({
      code: 'HOUSEHOLD_MEAL_PARTICIPANT_REQUIRED'
    });

    const noPermission = await call(privateView, 'PUT', 'meal-1', {
      status: 'realized',
      servings: 1,
      expectedVersion: 0
    });
    expect(noPermission.status).toBe(403);
    expect(await read(noPermission)).toMatchObject({ code: 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED' });

    const stale = await call(
      { id: 'bob', token: jwt.sign({ sub: 'bob' }, jwtSecret) },
      'PUT',
      'meal-1',
      { status: 'realized', servings: 1, expectedVersion: 0 },
      'other-home'
    );
    expect(stale.status).toBe(409);
    expect(await read(stale)).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_consumptions').get()).toEqual({
      count: 0
    });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'potatoes'").get()).toEqual({
      quantity: 1000
    });
  });

  it('rejects malformed state, out-of-range servings and stale corrections without writes', async () => {
    const bob = { id: 'bob', token: jwt.sign({ sub: 'bob' }, jwtSecret) };
    for (const body of [
      { status: 'realized', servings: 0, expectedVersion: 0 },
      { status: 'not_realized', servings: 1, expectedVersion: 0 },
      { status: 'realized', servings: 101, expectedVersion: 0 },
      { status: 'realized', servings: 2, expectedVersion: 0, userId: 'alice' }
    ]) {
      expect((await call(bob, 'PUT', 'meal-1', body)).status).toBe(400);
    }
    await call(bob, 'PUT', 'meal-1', { status: 'realized', servings: 2, expectedVersion: 0 });
    const stale = await call(bob, 'PUT', 'meal-1', {
      status: 'realized',
      servings: 3,
      expectedVersion: 0
    });
    expect(stale.status).toBe(409);
    expect(await read(stale)).toMatchObject({ code: 'MEAL_CONSUMPTION_VERSION_CONFLICT' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements').get()).toEqual({
      count: 1
    });
  });

  it('does not leak whether a meal exists in another household', async () => {
    const bob = { id: 'bob', token: jwt.sign({ sub: 'bob' }, jwtSecret) };
    const missing = await call(bob, 'GET', 'not-a-shared-meal');
    expect(missing.status).toBe(404);
    expect(await read(missing)).toMatchObject({ code: 'HOUSEHOLD_MEAL_NOT_FOUND' });
    const invalidPath = await call(bob, 'GET', 'm'.repeat(121));
    expect(invalidPath.status).toBe(400);
    expect(await read(invalidPath)).toMatchObject({ code: 'INVALID_MEAL_CONSUMPTION' });
  });

  it('rejects oversized bodies before parsing and rolls back provider-free writes on ledger failure', async () => {
    const bob = { id: 'bob', token: jwt.sign({ sub: 'bob' }, jwtSecret) };
    const tooLarge = await callRaw(bob, 'PUT', ' '.repeat(8 * 1024 + 1));
    expect(tooLarge.status).toBe(413);
    expect(await read(tooLarge)).toMatchObject({ code: 'MEAL_CONSUMPTION_BODY_TOO_LARGE' });

    db.exec(`CREATE TRIGGER fail_route_movement BEFORE INSERT ON meal_inventory_movements
      BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END`);
    const failed = await call(bob, 'PUT', 'meal-1', {
      status: 'realized',
      servings: 1,
      expectedVersion: 0
    });
    expect(failed.status).toBe(500);
    expect(await read(failed)).toMatchObject({ code: 'MEAL_CONSUMPTION_SAVE_FAILED' });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'potatoes'").get()).toEqual({
      quantity: 1000
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_consumptions').get()).toEqual({
      count: 0
    });
  });

  it('handles missing household context and rejects a correction when the recipe snapshot is no longer safe', async () => {
    const alice = { id: 'alice', token: jwt.sign({ sub: 'alice' }, jwtSecret) };
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run('alice');
    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run('alice');
    const noHousehold = await call(alice, 'GET');
    expect(noHousehold.status).toBe(404);
    expect(await read(noHousehold)).toMatchObject({ code: 'HOUSEHOLD_REQUIRED' });

    db.prepare('UPDATE household_members SET is_active = 1 WHERE user_id = ?').run('alice');
    db.prepare(
      'INSERT INTO households (id, name, invite_code, shared_pantry) VALUES (?, ?, ?, 1)'
    ).run('another-home', 'Otra casa', 'CONSUMER02');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
       VALUES ('alice-second-home', 'another-home', 'alice', 'member', ?, 1)`
    ).run(JSON.stringify({ calendar: { view: true, edit: true } }));
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run('alice');
    const selectionRequired = await call(alice, 'GET');
    expect(selectionRequired.status).toBe(409);
    expect(await read(selectionRequired)).toMatchObject({ code: 'HOUSEHOLD_SELECTION_REQUIRED' });

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, 'alice');
    const first = await call(alice, 'PUT', 'meal-1', {
      status: 'realized',
      servings: 2,
      expectedVersion: 0
    });
    expect(first.status, JSON.stringify(await read(first.clone()))).toBe(200);
    db.prepare("UPDATE meals SET recipe_snapshot = '{bad-json' WHERE id = 'meal-1'").run();
    const uncorrectable = await call(alice, 'PUT', 'meal-1', {
      status: 'realized',
      servings: 3,
      expectedVersion: 1
    });
    expect(uncorrectable.status).toBe(409);
    expect(await read(uncorrectable)).toMatchObject({ code: 'RECIPE_SNAPSHOT_UNAVAILABLE' });
  });
});
