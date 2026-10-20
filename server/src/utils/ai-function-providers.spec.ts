import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AI_FUNCTION_KEYS,
  aiFunctionForJobKind,
  backfillAiFunctionProviders,
  resolveAiFunctionProvider
} from './ai-function-providers.js';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function createDb() {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'custom',
      base_url TEXT NOT NULL DEFAULT 'https://provider.invalid/v1',
      api_key TEXT NOT NULL DEFAULT 'synthetic',
      model TEXT NOT NULL DEFAULT 'fixture',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE ai_function_providers (
      user_id TEXT,
      household_id TEXT,
      function_key TEXT NOT NULL,
      config_id TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK ((user_id IS NULL) != (household_id IS NULL)),
      FOREIGN KEY (config_id) REFERENCES ai_configs(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX idx_ai_function_providers_user
      ON ai_function_providers(user_id, function_key) WHERE household_id IS NULL;
    CREATE UNIQUE INDEX idx_ai_function_providers_household
      ON ai_function_providers(household_id, function_key) WHERE household_id IS NOT NULL;
  `);
  return db;
}

function insertConfig(
  database: Database.Database,
  id: string,
  userId: string,
  householdId: string | null,
  createdAt: string,
  active = true
) {
  database
    .prepare(
      'INSERT INTO ai_configs (id, user_id, household_id, name, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, userId, householdId, id, createdAt, active ? 1 : 0);
}

describe('AI function provider assignment backfill', () => {
  it('assigns the oldest active provider per scope and function without crossing households', () => {
    const database = createDb();
    insertConfig(database, 'personal-old', 'user-a', null, '2026-01-01 00:00:00');
    insertConfig(database, 'personal-new', 'user-a', null, '2026-02-01 00:00:00');
    insertConfig(database, 'home-a-old', 'user-a', 'home-a', '2026-01-01 00:00:00');
    insertConfig(database, 'home-a-inactive', 'user-a', 'home-a', '2025-01-01 00:00:00', false);
    insertConfig(database, 'home-a-new', 'user-b', 'home-a', '2026-02-01 00:00:00');
    insertConfig(database, 'home-b-only', 'user-a', 'home-b', '2026-01-01 00:00:00');

    expect(backfillAiFunctionProviders(database)).toBe(AI_FUNCTION_KEYS.length * 3);
    expect(
      database
        .prepare(
          `SELECT function_key, config_id FROM ai_function_providers
            WHERE household_id = 'home-a' ORDER BY function_key`
        )
        .all()
    ).toEqual(
      AI_FUNCTION_KEYS.map((functionKey) => ({
        function_key: functionKey,
        config_id: 'home-a-old'
      })).sort((left, right) => left.function_key.localeCompare(right.function_key))
    );
    expect(resolveAiFunctionProvider(database, 'user-a', 'home-b', 'planning')?.id).toBe(
      'home-b-only'
    );
    expect(resolveAiFunctionProvider(database, 'user-b', null, 'planning')).toBeUndefined();
  });

  it('is idempotent and preserves an existing intentional selection', () => {
    const database = createDb();
    insertConfig(database, 'first', 'user-a', 'home-a', '2026-01-01 00:00:00');
    insertConfig(database, 'second', 'user-b', 'home-a', '2026-02-01 00:00:00');
    database
      .prepare(
        `INSERT INTO ai_function_providers (user_id, household_id, function_key, config_id)
         VALUES (NULL, 'home-a', 'planning', 'second')`
      )
      .run();

    expect(backfillAiFunctionProviders(database)).toBe(AI_FUNCTION_KEYS.length - 1);
    expect(backfillAiFunctionProviders(database)).toBe(0);
    expect(resolveAiFunctionProvider(database, 'user-a', 'home-a', 'planning')?.id).toBe('second');
  });

  it('maps server job kinds to exactly one AI function', () => {
    expect(aiFunctionForJobKind('recipe')).toBe('recipes');
    expect(aiFunctionForJobKind('multiple_recipes')).toBe('recipes');
    expect(aiFunctionForJobKind('recommendations')).toBe('recipes');
    expect(aiFunctionForJobKind('weekly_plan')).toBe('planning');
    expect(aiFunctionForJobKind('household_plan')).toBe('planning');
    expect(aiFunctionForJobKind('receipt')).toBe('shopping_pantry');
    expect(aiFunctionForJobKind('shopping_photo')).toBe('shopping_pantry');
    expect(aiFunctionForJobKind('expiry_estimate')).toBe('shopping_pantry');
    expect(aiFunctionForJobKind('product_image_search')).toBe('shopping_pantry');
    expect(aiFunctionForJobKind('connection_test')).toBeNull();
    expect(aiFunctionForJobKind('unknown')).toBeNull();
  });
});
