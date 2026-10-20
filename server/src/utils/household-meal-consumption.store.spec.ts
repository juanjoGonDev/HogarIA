import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;
type ConsumptionInput = Parameters<
  typeof import('./household-meal-consumption.store.js').recordSharedMealConsumption
>[2];

let db: SqliteDb;
let closeDatabase: () => void;
let persistSharedMeal: typeof import('./shared-meal-calendar.store.js').persistSharedMeal;
let record: typeof import('./household-meal-consumption.store.js').recordSharedMealConsumption;
let read: typeof import('./household-meal-consumption.store.js').readSharedMealConsumption;
let MealConsumptionError: typeof import('./household-meal-consumption.store.js').MealConsumptionError;

const householdId = 'consumption-home';
const snapshot = {
  name: 'Arroz con leche',
  description: 'Receta sintética',
  baseServings: 1,
  times: { prepTimeMinutes: 10, cookTimeMinutes: 10 },
  ingredients: [
    { name: 'Arroz', quantity: 50, unit: 'g', isOptional: false },
    { name: 'Canela', quantity: 1, unit: 'ud', isOptional: true }
  ],
  instructions: ['Cocer.']
};
let mealSequence = 0;

function member(id: string, permission: 'edit' | 'view' | 'none' = 'view') {
  const permissions =
    permission === 'none'
      ? { calendar: { view: false, edit: false } }
      : permission === 'edit'
        ? { calendar: { view: true, edit: true } }
        : { calendar: { view: true, edit: false } };
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, `${id}@hogaria.test`, id, 'synthetic', householdId);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).run(
    `membership-${id}`,
    householdId,
    id,
    id === 'alice' ? 'admin' : 'member',
    JSON.stringify(permissions)
  );
}

function addSharedMeal(mealSnapshot: unknown = snapshot) {
  mealSequence += 1;
  return persistSharedMeal(db, 'alice', {
    proposalId: `consumption-proposal-${mealSequence}`,
    date: '2026-10-14',
    mealType: 'lunch',
    customMeal: 'Arroz con leche',
    servings: 4,
    participantIds: ['alice', 'bob'],
    recipeSnapshot: mealSnapshot
  }).meal.id;
}

function addIngredient(id: string, name: string, unit: string, quantity: number) {
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
     VALUES (?, 'alice', ?, ?, 'other', ?, ?)`
  ).run(id, householdId, name, quantity, unit);
}

function request(mealId: string, values: Partial<ConsumptionInput> = {}): ConsumptionInput {
  return {
    mealId,
    expectedHouseholdId: householdId,
    status: 'realized',
    servings: 2,
    expectedVersion: 0,
    ...values
  } as ConsumptionInput;
}

describe('shared meal consumption persistence', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
    const calendar = await import('./shared-meal-calendar.store.js');
    persistSharedMeal = calendar.persistSharedMeal;
    const consumption = await import('./household-meal-consumption.store.js');
    record = consumption.recordSharedMealConsumption;
    read = consumption.readSharedMealConsumption;
    MealConsumptionError = consumption.MealConsumptionError;
  });

  afterAll(() => closeDatabase?.());

  beforeEach(() => {
    mealSequence = 0;
    db.exec('DROP TRIGGER IF EXISTS fail_consumption_movement');
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
    ).run(householdId, 'Casa sintética', 'CONSUME01');
    member('alice', 'edit');
    member('bob', 'view');
    member('private-view', 'none');
    member('carol', 'view');
  });

  it('reads full-length generated ingredient names and units without losing the recipe snapshot', () => {
    const name = `Ingrediente ${'x'.repeat(2_501)}`;
    const unit = `unidad ${'u'.repeat(2_501)}`;
    const mealId = addSharedMeal({
      ...snapshot,
      ingredients: [{ name, quantity: 1, unit, isOptional: false }]
    });

    const result = record(db, 'alice', request(mealId));

    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'RECIPE_SNAPSHOT_UNAVAILABLE' })
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'INGREDIENT_UNMATCHED', ingredientName: name, unit })
    );
  });

  it('deducts actual servings once, returns the persisted result on retry, and does not use planned servings', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 500);

    const first = record(db, 'bob', request(mealId));
    const retry = record(db, 'bob', request(mealId));

    expect(first).toMatchObject({ status: 'realized', servings: 2, version: 1, idempotent: false });
    expect(first.warnings).toEqual([]);
    expect(retry).toMatchObject({ ...first, idempotent: true });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 400
    });
    expect(
      db
        .prepare('SELECT delta_quantity FROM meal_inventory_movements WHERE meal_id = ?')
        .all(mealId)
    ).toEqual([{ delta_quantity: -100 }]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements').get()).toEqual({
      count: 1
    });
    expect(read(db, 'bob', mealId, householdId)).toMatchObject({
      version: 1,
      status: 'realized',
      servings: 2
    });
  });

  it('corrects servings by applying only the difference, and restores deductions when marked not realized', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 500);
    const first = record(db, 'alice', request(mealId));

    const corrected = record(
      db,
      'bob',
      request(mealId, { servings: 3, expectedVersion: first.version })
    );
    const skipped = record(
      db,
      'bob',
      request(mealId, {
        status: 'not_realized',
        servings: 0,
        expectedVersion: corrected.version
      })
    );

    expect(corrected).toMatchObject({ status: 'realized', servings: 3, version: 2 });
    expect(skipped).toMatchObject({ status: 'not_realized', servings: 0, version: 3 });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 500
    });
    expect(
      db
        .prepare(
          'SELECT consumption_version, delta_quantity FROM meal_inventory_movements WHERE meal_id = ? ORDER BY consumption_version'
        )
        .all(mealId)
    ).toEqual([
      { consumption_version: 1, delta_quantity: -100 },
      { consumption_version: 2, delta_quantity: -50 },
      { consumption_version: 3, delta_quantity: 150 }
    ]);
  });

  it('rejects stale corrections but treats a retry of the current value as idempotent', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 500);
    const first = record(db, 'alice', request(mealId));

    expect(record(db, 'alice', request(mealId))).toMatchObject({ idempotent: true, version: 1 });
    expect(() => record(db, 'alice', request(mealId, { servings: 3, expectedVersion: 0 }))).toThrow(
      MealConsumptionError
    );
    expect(record(db, 'alice', request(mealId, { servings: 2, expectedVersion: 0 }))).toMatchObject(
      {
        idempotent: true,
        version: first.version
      }
    );
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 400
    });
  });

  it('never drives stock below zero and reports the unavailable amount', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 25);

    const result = record(db, 'alice', request(mealId));

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
        ingredientName: 'Arroz',
        requestedQuantity: 100,
        deductedQuantity: 25,
        unit: 'g'
      })
    );
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 0
    });
    expect(
      db
        .prepare('SELECT delta_quantity FROM meal_inventory_movements WHERE meal_id = ?')
        .all(mealId)
    ).toEqual([{ delta_quantity: -25 }]);
  });

  it('handles repeated recipe lines against fresh stock reads without overdrawing the same product', () => {
    const mealId = addSharedMeal({
      ...snapshot,
      ingredients: [
        { name: 'Arroz', quantity: 50, unit: 'g', isOptional: false },
        { name: ' arroz ', quantity: 50, unit: 'g', isOptional: false }
      ]
    });
    addIngredient('rice', 'ARROZ', 'g', 150);

    const result = record(db, 'alice', request(mealId));

    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'INSUFFICIENT_STOCK',
        ingredientName: 'arroz',
        requestedQuantity: 100,
        deductedQuantity: 50
      })
    );
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 0
    });
    expect(
      db
        .prepare(
          'SELECT line_index, delta_quantity FROM meal_inventory_movements WHERE meal_id = ? ORDER BY line_index'
        )
        .all(mealId)
    ).toEqual([
      { line_index: 0, delta_quantity: -100 },
      { line_index: 1, delta_quantity: -50 }
    ]);
  });

  it('does not guess when no exact household product match or multiple exact matches exist', () => {
    const missingMealId = addSharedMeal();
    addIngredient('rice-kg', 'arroz', 'kg', 500);
    const missing = record(db, 'alice', request(missingMealId));
    expect(missing.warnings).toContainEqual(
      expect.objectContaining({ code: 'INGREDIENT_UNMATCHED', ingredientName: 'Arroz' })
    );

    db.prepare('DELETE FROM meal_consumptions').run();
    db.prepare('DELETE FROM meal_consumption_deductions').run();
    db.prepare('DELETE FROM meal_inventory_movements').run();
    db.prepare('DELETE FROM ingredients').run();
    addIngredient('rice-1', 'arroz', 'g', 500);
    addIngredient('rice-2', 'ARROZ', 'g', 500);
    const ambiguousMealId = missingMealId;
    const ambiguous = record(db, 'bob', request(ambiguousMealId));

    expect(ambiguous.warnings).toContainEqual(
      expect.objectContaining({ code: 'INGREDIENT_AMBIGUOUS', ingredientName: 'Arroz' })
    );
    expect(db.prepare('SELECT quantity FROM ingredients ORDER BY id').all()).toEqual([
      { quantity: 500 },
      { quantity: 500 }
    ]);
  });

  it('warns and leaves inventory untouched when the shared pantry is disabled', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 500);
    db.prepare('UPDATE households SET shared_pantry = 0 WHERE id = ?').run(householdId);

    const result = record(db, 'alice', request(mealId));

    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'HOUSEHOLD_PANTRY_NOT_SHARED' })
    );
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 500
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements').get()).toEqual({
      count: 0
    });
  });

  it('requires an explicit active participant with calendar.view and binds writes to the captured home', () => {
    const mealId = addSharedMeal();
    try {
      record(db, 'carol', request(mealId));
      throw new Error('Expected non-participant denial');
    } catch (error) {
      expect(error).toMatchObject({ code: 'PARTICIPANT_REQUIRED' });
    }
    db.prepare('INSERT INTO meal_participants (meal_id, user_id) VALUES (?, ?)').run(
      mealId,
      'private-view'
    );
    try {
      record(db, 'private-view', request(mealId));
      throw new Error('Expected calendar.view permission denial');
    } catch (error) {
      expect(error).toMatchObject({ code: 'CALENDAR_VIEW_REQUIRED' });
    }
    try {
      record(db, 'bob', request(mealId, { expectedHouseholdId: 'other-home' }));
      throw new Error('Expected stale household context denial');
    } catch (error) {
      expect(error).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_consumptions').get()).toEqual({
      count: 0
    });
  });

  it('rolls back stock, movement, and state together if the ledger write fails', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 500);
    db.exec(`CREATE TRIGGER fail_consumption_movement BEFORE INSERT ON meal_inventory_movements
      BEGIN SELECT RAISE(ABORT, 'synthetic ledger failure'); END`);

    expect(() => record(db, 'alice', request(mealId))).toThrow();
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 500
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements').get()).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_consumptions').get()).toEqual({
      count: 0
    });
  });

  it('reports missing or corrupt recipe snapshots and does not invent ingredient deductions', () => {
    const mealId = addSharedMeal(null);
    addIngredient('rice', 'arroz', 'g', 500);

    const result = record(db, 'alice', request(mealId));

    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'RECIPE_SNAPSHOT_UNAVAILABLE' })
    );
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 500
    });

    db.prepare('UPDATE meals SET recipe_snapshot = ? WHERE id = ?').run('{not-json', mealId);
    const corrected = record(
      db,
      'alice',
      request(mealId, { servings: 3, expectedVersion: result.version })
    );
    expect(corrected.warnings).toContainEqual(
      expect.objectContaining({ code: 'RECIPE_SNAPSHOT_UNAVAILABLE' })
    );
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 500
    });
  });

  it('rejects a realized correction if the snapshot changed but still safely reverses consumption', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 1000);
    const first = record(db, 'alice', request(mealId, { servings: 2 }));

    db.prepare('UPDATE meals SET recipe_snapshot = ? WHERE id = ?').run(
      JSON.stringify({
        ...snapshot,
        ingredients: [{ name: 'Arroz', quantity: 200, unit: 'g', isOptional: false }]
      }),
      mealId
    );

    expect(() =>
      record(db, 'alice', request(mealId, { servings: 3, expectedVersion: first.version }))
    ).toThrow(MealConsumptionError);
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 900
    });
    expect(
      db
        .prepare('SELECT status, servings, version FROM meal_consumptions WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({
      status: 'realized',
      servings: 2,
      version: 1
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements').get()).toEqual({
      count: 1
    });

    const reversed = record(
      db,
      'alice',
      request(mealId, { status: 'not_realized', servings: 0, expectedVersion: first.version })
    );
    expect(reversed).toMatchObject({ status: 'not_realized', servings: 0, version: 2 });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 1000
    });
  });

  it('rejects a serving correction or reversal when a previously deducted ingredient unit changed', () => {
    const mealId = addSharedMeal();
    const ingredientId = 'rice-unit-changed';
    addIngredient(ingredientId, 'arroz', 'g', 500);
    const first = record(db, 'alice', request(mealId, { servings: 2 }));
    expect(
      db
        .prepare(
          'SELECT ingredient_id, deducted_quantity FROM meal_consumption_deductions WHERE meal_id = ?'
        )
        .get(mealId)
    ).toEqual({ ingredient_id: ingredientId, deducted_quantity: 100 });
    db.prepare('UPDATE ingredients SET unit = ? WHERE id = ?').run('kg', ingredientId);
    expect(db.prepare('SELECT unit FROM ingredients WHERE id = ?').get(ingredientId)).toEqual({
      unit: 'kg'
    });

    for (const correction of [
      { status: 'realized' as const, servings: 1 as const },
      { status: 'not_realized' as const, servings: 0 as const }
    ]) {
      expect(() =>
        record(db, 'alice', request(mealId, { ...correction, expectedVersion: first.version }))
      ).toThrow(expect.objectContaining({ code: 'INVENTORY_UNIT_CHANGED' }));
    }
    expect(db.prepare('SELECT quantity FROM ingredients WHERE id = ?').get(ingredientId)).toEqual({
      quantity: 400
    });
    expect(
      db
        .prepare('SELECT status, servings, version FROM meal_consumptions WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({
      status: 'realized',
      servings: 2,
      version: 1
    });
    expect(
      db
        .prepare(
          'SELECT target_quantity, deducted_quantity FROM meal_consumption_deductions WHERE meal_id = ?'
        )
        .get(mealId)
    ).toEqual({
      target_quantity: 100,
      deducted_quantity: 100
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({
      count: 1
    });
  });

  it('does not deduct after shared pantry is disabled but restores prior deductions safely', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 500);
    const first = record(db, 'alice', request(mealId, { servings: 2 }));
    db.prepare('UPDATE households SET shared_pantry = 0 WHERE id = ?').run(householdId);

    const corrected = record(
      db,
      'alice',
      request(mealId, { servings: 3, expectedVersion: first.version })
    );
    expect(corrected).toMatchObject({ status: 'realized', servings: 3, version: 2 });
    expect(corrected.warnings).toContainEqual(
      expect.objectContaining({ code: 'HOUSEHOLD_PANTRY_NOT_SHARED', ingredientName: 'Arroz' })
    );
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 400
    });
    expect(
      db
        .prepare(
          'SELECT target_quantity, deducted_quantity FROM meal_consumption_deductions WHERE meal_id = ?'
        )
        .get(mealId)
    ).toEqual({ target_quantity: 150, deducted_quantity: 100 });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({ count: 1 });

    const reversed = record(
      db,
      'alice',
      request(mealId, { status: 'not_realized', servings: 0, expectedVersion: corrected.version })
    );
    expect(reversed).toMatchObject({ status: 'not_realized', servings: 0, version: 3 });
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 500
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({ count: 2 });
  });

  it('rejects a same-deduction correction after a partial stock deduction if the unit changed', () => {
    const mealId = addSharedMeal({
      ...snapshot,
      ingredients: [{ name: 'Arroz', quantity: 25, unit: 'g', isOptional: false }]
    });
    addIngredient('rice', 'arroz', 'g', 25);
    const first = record(db, 'alice', request(mealId, { servings: 2 }));
    expect(first.warnings).toContainEqual(expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }));
    expect(
      db
        .prepare(
          'SELECT target_quantity, deducted_quantity FROM meal_consumption_deductions WHERE meal_id = ?'
        )
        .get(mealId)
    ).toEqual({
      target_quantity: 50,
      deducted_quantity: 25
    });
    db.prepare("UPDATE ingredients SET unit = 'kg' WHERE id = 'rice'").run();

    expect(() =>
      record(db, 'alice', request(mealId, { servings: 1, expectedVersion: first.version }))
    ).toThrow(expect.objectContaining({ code: 'INVENTORY_UNIT_CHANGED' }));
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 0
    });
    expect(
      db
        .prepare('SELECT status, servings, version FROM meal_consumptions WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({
      status: 'realized',
      servings: 2,
      version: 1
    });
    expect(
      db
        .prepare(
          'SELECT target_quantity, deducted_quantity FROM meal_consumption_deductions WHERE meal_id = ?'
        )
        .get(mealId)
    ).toEqual({
      target_quantity: 50,
      deducted_quantity: 25
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({
      count: 1
    });
  });

  it('guards unit before restoring a prior deduction for a removed snapshot line', () => {
    const mealId = addSharedMeal();
    addIngredient('rice', 'arroz', 'g', 500);
    const first = record(db, 'alice', request(mealId, { servings: 2 }));
    db.prepare('UPDATE meal_consumptions SET recipe_snapshot_hash = NULL WHERE meal_id = ?').run(
      mealId
    );
    db.prepare('UPDATE meals SET recipe_snapshot = ? WHERE id = ?').run(
      JSON.stringify({ ...snapshot, ingredients: [] }),
      mealId
    );
    db.prepare("UPDATE ingredients SET unit = 'kg' WHERE id = 'rice'").run();

    expect(() =>
      record(
        db,
        'alice',
        request(mealId, { status: 'not_realized', servings: 0, expectedVersion: first.version })
      )
    ).toThrow(expect.objectContaining({ code: 'INVENTORY_UNIT_CHANGED' }));
    expect(db.prepare("SELECT quantity FROM ingredients WHERE id = 'rice'").get()).toEqual({
      quantity: 400
    });
    expect(
      db
        .prepare('SELECT status, servings, version FROM meal_consumptions WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({
      status: 'realized',
      servings: 2,
      version: 1
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meal_inventory_movements WHERE meal_id = ?')
        .get(mealId)
    ).toEqual({
      count: 1
    });
  });
});
