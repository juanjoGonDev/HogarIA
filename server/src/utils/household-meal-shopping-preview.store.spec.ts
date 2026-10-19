import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;
let db: SqliteDb;
let closeDatabase: () => void;
let readPreview: typeof import('./household-meal-shopping-preview.store.js').readHouseholdMealShoppingPreview;

const householdId = 'shopping-preview-home';
const firstSnapshot = {
  name: 'Arroz de prueba',
  baseServings: 1,
  ingredients: [
    { name: '  ＲＩＣＥ　INTEGRAL ', quantity: 50, unit: 'g' },
    { name: 'Sal', quantity: 1, unit: 'tsp', isOptional: false },
    { name: 'Harina', quantity: 20, unit: 'g' },
    { name: 'Leche', quantity: 100, unit: 'l' },
    { name: 'Orégano', quantity: 0.5, unit: 'g', isOptional: true }
  ]
};

function addMeal(options: {
  id: string;
  date: string;
  servings?: number;
  snapshot?: unknown;
  sourceProposalId?: string | null;
  household?: string;
}) {
  const calendarId = `calendar-${options.id}`;
  const owningHouse = options.household ?? householdId;
  db.prepare(
    `INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
     VALUES (?, ?, 'owner', ?, ?, '{}')`
  ).run(calendarId, owningHouse, options.date, options.date);
  db.prepare(
    `INSERT INTO meals
      (id, calendar_id, date, meal_type, custom_meal, servings, source_proposal_id, proposal_id, recipe_snapshot)
     VALUES (?, ?, ?, 'lunch', 'Plato privado de prueba', ?, ?, 'proposal', ?)`
  ).run(
    options.id,
    calendarId,
    options.date,
    options.servings ?? 1,
    options.sourceProposalId === undefined ? `proposal:${options.id}` : options.sourceProposalId,
    options.snapshot === undefined
      ? JSON.stringify(firstSnapshot)
      : options.snapshot === null
        ? null
        : JSON.stringify(options.snapshot)
  );
}

function addIngredient(
  id: string,
  name: string,
  unit: string,
  quantity: number,
  ownerHouse: string | null = householdId
) {
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
     VALUES (?, 'owner', ?, ?, 'other', ?, ?)`
  ).run(id, ownerHouse, name, quantity, unit);
}

function addConsumption(mealId: string, status: 'realized' | 'not_realized') {
  db.prepare(
    `INSERT INTO meal_consumptions (meal_id, household_id, status, servings, version)
     VALUES (?, ?, ?, ?, 1)`
  ).run(mealId, householdId, status, status === 'realized' ? 1 : 0);
}

describe('read-only household meal shopping preview', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
    const store = await import('./household-meal-shopping-preview.store.js');
    readPreview = store.readHouseholdMealShoppingPreview;
  });

  afterAll(() => closeDatabase?.());

  beforeEach(() => {
    db.prepare('DELETE FROM meals').run();
    db.prepare('DELETE FROM weekly_calendars').run();
    db.prepare('DELETE FROM ingredients').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    db.prepare(
      'INSERT INTO households (id, name, invite_code, shared_pantry) VALUES (?, ?, ?, 1)'
    ).run(householdId, 'Synthetic home', 'SHOPTEST1');
    db.prepare(
      'INSERT INTO households (id, name, invite_code, shared_pantry) VALUES (?, ?, ?, 1)'
    ).run('another-home', 'Another synthetic home', 'SHOPTEST2');
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
    ).run('owner', 'owner@hogaria.test', 'Synthetic owner', 'hash', householdId);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES ('membership-owner', ?, 'owner', 'admin', '{"calendar":{"view":true}}')`
    ).run(householdId);
  });

  it('scales and consolidates exact household needs, classifies stock safely, and ignores private/past/personal rows', () => {
    addMeal({ id: 'meal-double', date: '2026-10-14', servings: 2 });
    addMeal({
      id: 'meal-single',
      date: '2026-10-15',
      servings: 1,
      snapshot: {
        ...firstSnapshot,
        ingredients: [
          { name: 'rice integral', quantity: 25, unit: 'g' },
          { name: 'ORÉGANO', quantity: 0.25, unit: 'g', isOptional: true }
        ]
      }
    });
    addMeal({ id: 'meal-past', date: '2026-10-12', servings: 50 });
    addMeal({ id: 'meal-personal', date: '2026-10-14', sourceProposalId: null, servings: 50 });
    addMeal({ id: 'meal-other-home', date: '2026-10-14', household: 'another-home', servings: 50 });
    addMeal({ id: 'meal-missing-snapshot', date: '2026-10-16', snapshot: null });
    addMeal({ id: 'meal-corrupt-snapshot', date: '2026-10-17' });
    db.prepare(
      "UPDATE meals SET recipe_snapshot = '{bad-json' WHERE id = 'meal-corrupt-snapshot'"
    ).run();
    addMeal({
      id: 'meal-invalid-snapshot',
      date: '2026-10-18',
      snapshot: {
        baseServings: 1,
        ingredients: [{ name: 'Exceso', quantity: 1_000_001, unit: 'g' }]
      }
    });
    addIngredient('rice-stock', 'rice integral', 'g', 20);
    addIngredient('private-rice', 'rice integral', 'g', 1000, null);
    addIngredient('flour-stock-a', 'harina', 'g', 100);
    addIngredient('flour-stock-b', 'HARINA', 'g', 200);
    addIngredient('milk-other-unit', 'leche', 'ml', 1000);
    addIngredient('oregano-stock', 'orégano', 'g', 10);

    const preview = readPreview(
      db,
      householdId,
      { startDate: '2026-10-14', endDate: '2026-10-20' },
      '2026-10-13'
    );

    expect(preview).toMatchObject({
      startDate: '2026-10-14',
      endDate: '2026-10-20',
      sharedPantry: true,
      plannedMealCount: 5,
      warnings: [
        { code: 'RECIPE_SNAPSHOT_UNAVAILABLE', date: '2026-10-16' },
        { code: 'RECIPE_SNAPSHOT_UNAVAILABLE', date: '2026-10-17' },
        { code: 'RECIPE_SNAPSHOT_UNAVAILABLE', date: '2026-10-18' }
      ]
    });
    expect(preview.requiredIngredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ＲＩＣＥ　INTEGRAL',
          unit: 'g',
          quantity: 125,
          stockQuantity: 20,
          missingQuantity: 105,
          status: 'matched'
        }),
        expect.objectContaining({
          name: 'Sal',
          quantity: 2,
          stockQuantity: 0,
          missingQuantity: 2,
          status: 'not_found'
        }),
        expect.objectContaining({ name: 'Harina', status: 'ambiguous', stockQuantity: null }),
        expect.objectContaining({ name: 'Leche', status: 'unit_mismatch', stockQuantity: null })
      ])
    );
    expect(preview.optionalIngredients).toEqual([
      expect.objectContaining({
        name: 'Orégano',
        unit: 'g',
        quantity: 1.25,
        stockQuantity: 10,
        missingQuantity: 0,
        status: 'matched'
      })
    ]);
    expect(JSON.stringify(preview)).not.toContain('Synthetic owner');
    expect(JSON.stringify(preview)).not.toContain('Plato privado');
  });

  it('keeps unit strings exact when consolidating needs and matching shared stock', () => {
    addMeal({
      id: 'meal-exact-units',
      date: '2026-10-14',
      snapshot: {
        ...firstSnapshot,
        ingredients: [
          { name: 'Rice', quantity: 20, unit: 'g' },
          { name: ' ＲＩＣＥ ', quantity: 10, unit: 'G' }
        ]
      }
    });
    addIngredient('rice-stock', 'rice', 'g', 15);

    const preview = readPreview(
      db,
      householdId,
      { startDate: '2026-10-14', endDate: '2026-10-14' },
      '2026-10-13'
    );

    expect(preview.requiredIngredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Rice',
          unit: 'g',
          quantity: 20,
          stockQuantity: 15,
          missingQuantity: 5,
          status: 'matched'
        }),
        expect.objectContaining({
          name: 'ＲＩＣＥ',
          unit: 'G',
          quantity: 10,
          stockQuantity: null,
          missingQuantity: null,
          status: 'unit_mismatch'
        })
      ])
    );
  });

  it('includes only future meals still pending consumption and purchase', () => {
    addMeal({ id: 'meal-today-realized', date: '2026-10-13' });
    addConsumption('meal-today-realized', 'realized');
    addMeal({ id: 'meal-today-not-realized', date: '2026-10-13' });
    addConsumption('meal-today-not-realized', 'not_realized');
    addMeal({ id: 'meal-today-pending', date: '2026-10-13' });
    addMeal({ id: 'meal-future-realized', date: '2026-10-14' });
    addConsumption('meal-future-realized', 'realized');
    addMeal({ id: 'meal-future-not-realized', date: '2026-10-14' });
    addConsumption('meal-future-not-realized', 'not_realized');
    addMeal({ id: 'meal-future-pending', date: '2026-10-14' });

    const preview = readPreview(
      db,
      householdId,
      { startDate: '2026-10-13', endDate: '2026-10-14' },
      '2026-10-13'
    );

    expect(preview.plannedMealCount).toBe(2);
    expect(preview.requiredIngredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ＲＩＣＥ　INTEGRAL', quantity: 100 })
      ])
    );
  });

  it('allocates shared stock to required needs before optional needs', () => {
    addMeal({
      id: 'meal-required-and-optional-oil',
      date: '2026-10-14',
      snapshot: {
        ...firstSnapshot,
        ingredients: [
          { name: 'Aceite', quantity: 80, unit: 'ml' },
          { name: ' ACEITE ', quantity: 30, unit: 'ml', isOptional: true }
        ]
      }
    });
    addIngredient('oil-stock', 'aceite', 'ml', 100);

    const preview = readPreview(
      db,
      householdId,
      { startDate: '2026-10-14', endDate: '2026-10-14' },
      '2026-10-13'
    );

    expect(preview.requiredIngredients).toEqual([
      expect.objectContaining({
        name: 'Aceite',
        unit: 'ml',
        quantity: 80,
        stockQuantity: 100,
        missingQuantity: 0,
        status: 'matched'
      })
    ]);
    expect(preview.optionalIngredients).toEqual([
      expect.objectContaining({
        name: 'ACEITE',
        unit: 'ml',
        quantity: 30,
        stockQuantity: 20,
        missingQuantity: 10,
        status: 'matched'
      })
    ]);
  });

  it('does not use or reveal any stock when the household pantry is not shared', () => {
    db.prepare('UPDATE households SET shared_pantry = 0 WHERE id = ?').run(householdId);
    addMeal({ id: 'meal-no-pantry', date: '2026-10-14', servings: 2 });
    addIngredient('rice-stock', 'rice integral', 'g', 500);

    const preview = readPreview(
      db,
      householdId,
      { startDate: '2026-10-14', endDate: '2026-10-14' },
      '2026-10-13'
    );

    expect(preview.sharedPantry).toBe(false);
    expect(preview.requiredIngredients[0]).toMatchObject({
      name: 'ＲＩＣＥ　INTEGRAL',
      quantity: 100,
      stockQuantity: null,
      missingQuantity: null,
      status: 'pantry_not_shared'
    });
  });

  it('performs no writes while calculating the preview', () => {
    addMeal({ id: 'meal-read-only', date: '2026-10-14' });
    const before = (db.prepare('SELECT total_changes() AS changes').get() as { changes: number })
      .changes;

    readPreview(db, householdId, { startDate: '2026-10-14', endDate: '2026-10-14' }, '2026-10-13');

    const after = (db.prepare('SELECT total_changes() AS changes').get() as { changes: number })
      .changes;
    expect(after).toBe(before);
  });

  it('returns an empty preview when no confirmed future meal exists and fails for a missing home', () => {
    const empty = readPreview(
      db,
      householdId,
      { startDate: '2026-10-14', endDate: '2026-10-20' },
      '2026-10-13'
    );

    expect(empty).toMatchObject({
      plannedMealCount: 0,
      requiredIngredients: [],
      optionalIngredients: []
    });
    expect(() =>
      readPreview(
        db,
        'missing-home',
        { startDate: '2026-10-14', endDate: '2026-10-20' },
        '2026-10-13'
      )
    ).toThrow('HOUSEHOLD_NOT_FOUND');
  });
});
