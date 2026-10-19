import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withAssistantActionIdempotency } from './assistant-action-idempotency.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let db: Sql;
let closeDatabase: () => void;
const userId = 'assistant-idempotency-user';
const actionId = '123e4567-e89b-42d3-a456-426614174000';

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
});

afterAll(() => closeDatabase?.());

beforeEach(() => {
  db.exec('DELETE FROM assistant_action_results; DELETE FROM ingredients; DELETE FROM users;');
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    userId,
    'assistant-idempotency@test.local',
    'Prueba',
    'hash'
  );
});

function insertIngredient(id: string): void {
  db.prepare(
    `INSERT INTO ingredients (id, user_id, name, category, quantity, unit)
     VALUES (?, ?, ?, 'other', 1, 'unit')`
  ).run(id, userId, `Ingrediente ${id}`);
}

const success = (id: string) => ({ body: { success: true, data: { id } }, status: 201 as const });

describe('assistant domain-write idempotency', () => {
  it('records the domain write and key atomically; exact replay never calls the writer again', () => {
    let writes = 0;
    const first = withAssistantActionIdempotency(
      db,
      userId,
      actionId,
      { input: { name: 'Leche', quantity: 2 }, operation: 'pantry.add_ingredient' },
      () => {
        writes += 1;
        insertIngredient('ingredient-once');
        return success('ingredient-once');
      }
    );
    const replay = withAssistantActionIdempotency(
      db,
      userId,
      actionId,
      { operation: 'pantry.add_ingredient', input: { quantity: 2, name: 'Leche' } },
      () => {
        writes += 1;
        insertIngredient('ingredient-duplicate');
        return success('ingredient-duplicate');
      }
    );

    expect(first).toMatchObject({ status: 201, replayed: false });
    expect(replay).toEqual({
      status: 201,
      body: { success: true, idempotent: true },
      replayed: true
    });
    expect(writes).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM ingredients').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM assistant_action_results').get()).toEqual({
      count: 1
    });
  });

  it('rejects reuse of an action ID with a different request without running the writer', () => {
    withAssistantActionIdempotency(db, userId, actionId, { title: 'Compra' }, () => {
      insertIngredient('ingredient-once');
      return success('ingredient-once');
    });

    let writes = 0;
    const conflict = withAssistantActionIdempotency(
      db,
      userId,
      actionId,
      { title: 'Compra para mañana' },
      () => {
        writes += 1;
        return success('ingredient-duplicate');
      }
    );

    expect(conflict).toEqual({ error: 'action_id_conflict' });
    expect(writes).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM ingredients').get()).toEqual({ count: 1 });
  });

  it('rolls back both key and partial domain writes if the writer throws', () => {
    expect(() =>
      withAssistantActionIdempotency(db, userId, actionId, { name: 'Leche' }, () => {
        insertIngredient('ingredient-rolled-back');
        throw new Error('database write failed');
      })
    ).toThrow('database write failed');
    expect(db.prepare('SELECT COUNT(*) AS count FROM ingredients').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM assistant_action_results').get()).toEqual({
      count: 0
    });

    const retry = withAssistantActionIdempotency(db, userId, actionId, { name: 'Leche' }, () => {
      insertIngredient('ingredient-retry');
      return success('ingredient-retry');
    });
    expect(retry).toMatchObject({ replayed: false, status: 201 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM ingredients').get()).toEqual({ count: 1 });
  });

  it('rejects malformed keys and preserves normal endpoint behavior when key is absent', () => {
    let writes = 0;
    const invalid = withAssistantActionIdempotency(db, userId, 'not-a-uuid', {}, () => {
      writes += 1;
      return success('invalid');
    });
    const ordinary = withAssistantActionIdempotency(db, userId, undefined, {}, () => {
      writes += 1;
      return success('ordinary');
    });

    expect(invalid).toEqual({ error: 'invalid_action_id' });
    expect(ordinary).toMatchObject({ replayed: false, status: 201 });
    expect(writes).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM assistant_action_results').get()).toEqual({
      count: 0
    });
  });
});
