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
  const { shoppingRoutes } = await import('./shopping.routes.js');
  const { householdMealPlanningRoutes } = await import('./household-meal-planning.routes.js');
  const { config } = await import('../config/app.config.js');
  expect(config.database.path).toBe(':memory:');
  await database.initializeDatabase();
  closeDatabase = database.closeDatabase;
  db = database.getDatabase();
  app = new Hono();
  app.route('/api/shopping', shoppingRoutes);
  app.route('/api/household', householdMealPlanningRoutes);
  app.onError((error, context) => context.json({ success: false, message: error.message }, 500));
  jwtSecret = config.auth.jwtSecret;
});

afterAll(() => closeDatabase?.());

beforeEach(() => {
  db.exec(
    `DROP TRIGGER IF EXISTS reject_meal_plan_shopping_item;
     DELETE FROM shopping_list_events;
     DELETE FROM shopping_list_discounts;
     DELETE FROM shopping_list_items;
     DELETE FROM shopping_lists;
     DELETE FROM meals;
     DELETE FROM weekly_calendars;
     DELETE FROM meal_consumptions;
     DELETE FROM ingredients;
     DELETE FROM household_members;
     DELETE FROM users;
     DELETE FROM households;`
  );
  db.prepare(
    `INSERT INTO households (id, name, invite_code, shared_pantry)
     VALUES ('home', 'Synthetic home', 'SHOPTEST1', 1)`
  ).run();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, household_id)
     VALUES ('owner', 'owner@hogaria.test', 'owner', 'hash', 'home')`
  ).run();
});

function addUser(id = 'member', canView = true): User {
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, household_id)
     VALUES (?, ?, ?, 'hash', 'home')`
  ).run(id, `${id}@hogaria.test`, id);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, 'home', ?, 'member', ?)`
  ).run(`membership-${id}`, id, JSON.stringify({ calendar: { view: canView, edit: false } }));
  return {
    id,
    token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
  };
}

function addMeal(
  date: string,
  snapshot = {
    baseServings: 1,
    ingredients: [
      { name: 'Arroz', quantity: 100, unit: 'g' },
      { name: 'Aceite', quantity: 10, unit: 'ml', isOptional: true }
    ]
  }
) {
  db.prepare(
    `INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
     VALUES ('calendar', 'home', 'owner', ?, ?, '{}')`
  ).run(date, date);
  db.prepare(
    `INSERT INTO meals
       (id, calendar_id, date, meal_type, custom_meal, servings, source_proposal_id, proposal_id, recipe_snapshot)
     VALUES ('meal', 'calendar', ?, 'lunch', 'Arroz', 2, 'proposal:meal', 'proposal', ?)`
  ).run(date, JSON.stringify(snapshot));
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
     VALUES ('rice-stock', 'owner', 'home', 'Arroz', 'other', 50, 'g')`
  ).run();
}

function preview(user: User, startDate: string, endDate = startDate, householdId = 'home') {
  const query = new URLSearchParams({ startDate, endDate });
  return app.request(`/api/household/meal-planning/shopping-preview?${query}`, {
    headers: { authorization: `Bearer ${user.token}`, 'x-household-id': householdId }
  });
}

function approve(user: User, body: unknown, householdId = 'home') {
  return app.request('/api/shopping/meal-plan/approve', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json',
      'x-household-id': householdId
    },
    body: JSON.stringify(body)
  });
}

function dateFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('household meal shopping approval', () => {
  it('creates one shared Compra list only on explicit approval and identical retries are idempotent', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow);

    const beforePreview = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const previewResponse = await preview(member, tomorrow);
    const previewBody = await json<{ data: { previewId: string; optionalIngredients: unknown[] } }>(
      previewResponse
    );
    expect(previewResponse.status).toBe(200);
    expect(previewBody.data.previewId).toMatch(/^[a-f0-9]{64}$/);
    expect(previewBody.data.optionalIngredients).toHaveLength(1);
    expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(
      beforePreview
    );
    expect((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n).toBe(
      0
    );

    const body = {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: previewBody.data.previewId,
      items: [
        { name: 'Arroz', unit: 'g', quantity: 125 },
        { name: 'Aceite', unit: 'ml', quantity: 8 }
      ]
    };
    const response = await approve(member, body);
    const result = await json<{
      success: boolean;
      data: { listId: string; created: boolean; idempotent: boolean; version: number };
    }>(response);

    expect(response.status).toBe(201);
    expect(result).toMatchObject({
      success: true,
      data: { created: true, idempotent: false }
    });
    const list = db
      .prepare('SELECT * FROM shopping_lists WHERE id = ?')
      .get(result.data.listId) as Record<string, unknown>;
    expect(list).toMatchObject({ household_id: 'home', source: 'meal_plan', status: 'active' });
    const rows = db
      .prepare(
        'SELECT name, quantity, unit, source, checked FROM shopping_list_items WHERE list_id = ? ORDER BY name'
      )
      .all(result.data.listId);
    expect(rows).toEqual([
      expect.objectContaining({
        name: 'Aceite',
        quantity: 8,
        unit: 'ml',
        source: 'meal_plan',
        checked: 0
      }),
      expect.objectContaining({
        name: 'Arroz',
        quantity: 125,
        unit: 'g',
        source: 'meal_plan',
        checked: 0
      })
    ]);
    expect(
      (
        db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice-stock'").get() as {
          quantity: number;
        }
      ).quantity
    ).toBe(50);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM shopping_list_events').get() as { n: number }).n
    ).toBe(1);

    const repeated = await approve(member, body);
    const repeatedResult = await json<{
      data: { listId: string; created: boolean; idempotent: boolean; version: number };
    }>(repeated);
    expect(repeated.status).toBe(200);
    expect(repeatedResult.data).toMatchObject({
      listId: result.data.listId,
      created: false,
      idempotent: true,
      version: result.data.version
    });
    expect(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM shopping_list_items WHERE list_id = ? AND deleted_at IS NULL'
          )
          .get(result.data.listId) as { n: number }
      ).n
    ).toBe(2);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM shopping_list_events').get() as { n: number }).n
    ).toBe(1);
  });

  it('does not recreate a bought meal-plan line when the same approval is replayed', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow);
    const loaded = await json<{ data: { previewId: string } }>(await preview(member, tomorrow));
    const body = {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: loaded.data.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 75 }]
    };

    const first = await approve(member, body);
    const firstResult = await json<{ data: { listId: string } }>(first);
    expect(first.status).toBe(201);
    const item = db
      .prepare("SELECT id FROM shopping_list_items WHERE list_id = ? AND source = 'meal_plan'")
      .get(firstResult.data.listId) as { id: string };
    db.prepare('UPDATE shopping_list_items SET checked = 1 WHERE id = ?').run(item.id);

    const replay = await approve(member, body);
    const replayResult = await json<{ data: { idempotent: boolean } }>(replay);
    expect(replay.status).toBe(200);
    expect(replayResult.data.idempotent).toBe(true);
    expect(
      db
        .prepare(
          "SELECT id, checked FROM shopping_list_items WHERE list_id = ? AND source = 'meal_plan'"
        )
        .all(firstResult.data.listId)
    ).toEqual([{ id: item.id, checked: 1 }]);
  });

  it('recalculates the preview, rejects stale/unknown/duplicate items, and leaves Compra untouched', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow);
    const loaded = await json<{ data: { previewId: string } }>(await preview(member, tomorrow));
    const original = {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: loaded.data.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 150 }]
    };

    db.prepare("UPDATE ingredients SET quantity = 51 WHERE id = 'rice-stock'").run();
    const stale = await approve(member, original);
    expect(stale.status).toBe(409);
    expect((await json<{ code: string }>(stale)).code).toBe('MEAL_SHOPPING_PREVIEW_STALE');

    const refreshed = await json<{ data: { previewId: string } }>(await preview(member, tomorrow));
    const current = { ...original, previewId: refreshed.data.previewId };
    for (const items of [
      [{ name: 'Harina', unit: 'g', quantity: 1 }],
      [
        { name: 'Arroz', unit: 'g', quantity: 1 },
        { name: 'arroz', unit: 'g', quantity: 2 }
      ],
      [
        { name: 'Aceite', unit: 'ml', quantity: 1 },
        { name: 'Aceite', unit: 'ml', quantity: 2 }
      ]
    ]) {
      const invalid = await approve(member, { ...current, items });
      expect(invalid.status).toBe(400);
    }
    expect((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n).toBe(
      0
    );
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM shopping_list_items').get() as { n: number }).n
    ).toBe(0);
  });

  it('rejects fully stocked, ambiguous, and non-shared inventory rows without creating a list', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow, {
      baseServings: 1,
      ingredients: [
        { name: 'Arroz', quantity: 100, unit: 'g' },
        { name: 'Harina', quantity: 10, unit: 'g' }
      ]
    });
    db.prepare("UPDATE ingredients SET quantity = 500 WHERE id = 'rice-stock'").run();
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
       VALUES ('flour-stock-1', 'owner', 'home', 'Harina', 'other', 1, 'g'),
              ('flour-stock-2', 'owner', 'home', 'harina', 'other', 1, 'g')`
    ).run();

    const loaded = await json<{
      data: {
        previewId: string;
        requiredIngredients: Array<{
          name: string;
          status: string;
          missingQuantity: number | null;
        }>;
      };
    }>(await preview(member, tomorrow));
    expect(loaded.data.requiredIngredients).toEqual([
      expect.objectContaining({ name: 'Arroz', status: 'matched', missingQuantity: 0 }),
      expect.objectContaining({ name: 'Harina', status: 'ambiguous', missingQuantity: null })
    ]);

    for (const name of ['Arroz', 'Harina']) {
      const rejected = await approve(member, {
        startDate: tomorrow,
        endDate: tomorrow,
        previewId: loaded.data.previewId,
        items: [{ name, unit: 'g', quantity: 1 }]
      });
      expect(rejected.status).toBe(400);
      expect((await json<{ code: string }>(rejected)).code).toBe(
        'MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW'
      );
    }

    db.prepare("UPDATE households SET shared_pantry = 0 WHERE id = 'home'").run();
    const privatePantryPreview = await json<{ data: { previewId: string } }>(
      await preview(member, tomorrow)
    );
    const nonShared = await approve(member, {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: privatePantryPreview.data.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 1 }]
    });
    expect(nonShared.status).toBe(400);
    expect((await json<{ code: string }>(nonShared)).code).toBe(
      'MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW'
    );
    expect((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n).toBe(
      0
    );
    expect(
      (
        db.prepare('SELECT COUNT(*) AS n FROM household_meal_shopping_approvals').get() as {
          n: number;
        }
      ).n
    ).toBe(0);
  });

  it('preserves bought, manual, and other-source rows while reconciling only pending meal-plan rows', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow);
    db.prepare(
      `INSERT INTO shopping_lists (id, user_id, household_id, name, source)
       VALUES ('existing', ?, 'home', 'Plan de comidas', 'meal_plan')`
    ).run(member.id);
    const insert = db.prepare(
      `INSERT INTO shopping_list_items
       (id, list_id, name, product_key, quantity, unit, note, position, checked, source, added_by)
       VALUES (?, 'existing', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      'pending-rice',
      'Arroz',
      'arroz',
      50,
      'g',
      'conservar nota',
      1,
      0,
      'meal_plan',
      member.id
    );
    insert.run(
      'bought',
      'Aceite comprado',
      'aceite comprado',
      2,
      'ml',
      'ticket',
      2,
      1,
      'meal_plan',
      member.id
    );
    insert.run('manual', 'Café', 'cafe', 3, 'pack', 'nota manual', 3, 0, 'manual', member.id);
    insert.run(
      'other-source',
      'Jabón',
      'jabon',
      1,
      'ud',
      'otra fuente',
      4,
      0,
      'sugerida',
      member.id
    );
    insert.run('stale-plan', 'Pan', 'pan', 1, 'ud', null, 5, 0, 'meal_plan', member.id);
    const preserved = db
      .prepare(
        "SELECT * FROM shopping_list_items WHERE id IN ('bought','manual','other-source') ORDER BY id"
      )
      .all();

    const currentPreview = await json<{ data: { previewId: string } }>(
      await preview(member, tomorrow)
    );
    const response = await approve(member, {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: currentPreview.data.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 75 }]
    });
    expect(response.status).toBe(200);
    expect(
      db
        .prepare(
          "SELECT * FROM shopping_list_items WHERE id IN ('bought','manual','other-source') ORDER BY id"
        )
        .all()
    ).toEqual(preserved);
    expect(
      db.prepare("SELECT quantity, note FROM shopping_list_items WHERE id = 'pending-rice'").get()
    ).toEqual({ quantity: 75, note: 'conservar nota' });
    expect(
      db.prepare("SELECT deleted_at FROM shopping_list_items WHERE id = 'stale-plan'").get()
    ).toMatchObject({ deleted_at: expect.any(String) });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM shopping_list_items WHERE list_id = 'existing' AND source = 'meal_plan' AND checked = 0 AND deleted_at IS NULL"
        )
        .get()
    ).toEqual({ n: 1 });
  });

  it('requires the selected active household and calendar.view', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow);
    const loaded = await json<{ data: { previewId: string } }>(await preview(member, tomorrow));
    const body = {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: loaded.data.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 50 }]
    };
    expect((await approve(member, body, 'another-home')).status).toBe(409);
    const noView = addUser('no-view', false);
    expect((await approve(noView, body)).status).toBe(403);
    expect((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n).toBe(
      0
    );
  });

  it('uses the validated active household when the user household pointer is unset', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow);
    const loaded = await json<{ data: { previewId: string } }>(await preview(member, tomorrow));
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(member.id);

    const response = await approve(member, {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: loaded.data.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 50 }]
    });

    expect(response.status).toBe(201);
    expect((await json<{ success: boolean }>(response)).success).toBe(true);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM shopping_lists WHERE household_id = 'home'").get()
    ).toEqual({ n: 1 });
  });

  it('rolls back the list and its lines if inserting an approved ingredient fails', async () => {
    const member = addUser();
    const tomorrow = dateFromNow(1);
    addMeal(tomorrow);
    const loaded = await json<{ data: { previewId: string } }>(await preview(member, tomorrow));
    db.exec(
      `CREATE TRIGGER reject_meal_plan_shopping_item BEFORE INSERT ON shopping_list_items
       BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`
    );

    const response = await approve(member, {
      startDate: tomorrow,
      endDate: tomorrow,
      previewId: loaded.data.previewId,
      items: [{ name: 'Arroz', unit: 'g', quantity: 50 }]
    });
    expect(response.status).toBe(500);
    expect((db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n).toBe(
      0
    );
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM shopping_list_items').get() as { n: number }).n
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM shopping_list_events').get() as { n: number }).n
    ).toBe(0);
  });
});
