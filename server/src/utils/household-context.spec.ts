import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;
let db: SqliteDb;
let closeDatabase: () => void;
let context: typeof import('./household-context.js');

function addMembership(
  userId: string,
  householdId: string,
  options: { active?: boolean; permissions?: string | null } = {}
) {
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
     VALUES (?, ?, ?, 'member', ?, ?)`
  ).run(
    `membership-${userId}-${householdId}`,
    householdId,
    userId,
    options.permissions ?? '{"settings":false}',
    options.active === false ? 0 : 1
  );
}

function addUser(id: string, householdId: string | null = null) {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, `${id}@hogaria.test`, id, 'synthetic', householdId);
}

describe('household context resolution', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
    context = await import('./household-context.js');
  });

  afterAll(() => closeDatabase?.());

  beforeEach(() => {
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'home-a',
      'Home A',
      'HOMEA001'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'home-b',
      'Home B',
      'HOMEB001'
    );
  });

  it('reads an active selected household and a single fallback without writing either pointer', () => {
    addUser('selected', 'home-a');
    addMembership('selected', 'home-a');
    addUser('fallback');
    addMembership('fallback', 'home-b');
    const before = (db.prepare('SELECT total_changes() AS changes').get() as { changes: number })
      .changes;

    expect(context.readActiveHouseholdId(db, 'selected')).toBe('home-a');
    expect(context.readActiveHouseholdId(db, 'fallback')).toBe('home-b');

    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get('fallback') as {
          household_id: string | null;
        }
      ).household_id
    ).toBeNull();
    expect(
      (db.prepare('SELECT total_changes() AS changes').get() as { changes: number }).changes
    ).toBe(before);
  });

  it('fails closed for an inactive selected membership, multiple choices, and no user', () => {
    addUser('inactive', 'home-a');
    addMembership('inactive', 'home-a', { active: false });
    addMembership('inactive', 'home-b');
    addUser('multiple');
    addMembership('multiple', 'home-a');
    addMembership('multiple', 'home-b');

    expect(context.readActiveHouseholdId(db, 'inactive')).toBeNull();
    expect(context.readActiveHouseholdId(db, 'multiple')).toBeNull();
    expect(context.readActiveHouseholdId(db, 'missing-user')).toBeNull();
  });

  it('preserves legacy activeHouseholdId pointer repair and reports memberships/selection counts', () => {
    addUser('fallback');
    addMembership('fallback', 'home-a');

    expect(context.activeHouseholdId(db, 'fallback')).toBe('home-a');
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get('fallback') as {
          household_id: string | null;
        }
      ).household_id
    ).toBe('home-a');
    expect(context.activeHouseholdMemberCount(db, 'fallback')).toBe(1);
    expect(context.hasActiveHouseholdMemberships(db, 'fallback')).toBe(true);
    expect(context.needsActiveHouseholdSelection(db, 'fallback')).toBe(false);

    addUser('multiple');
    addMembership('multiple', 'home-a');
    addMembership('multiple', 'home-b');
    expect(context.activeHouseholdId(db, 'multiple')).toBeNull();
    expect(context.activeHouseholdMemberCount(db, 'multiple')).toBe(0);
    expect(context.needsActiveHouseholdSelection(db, 'multiple')).toBe(true);
    expect(context.hasActiveHouseholdMemberships(db, 'unaffiliated')).toBe(false);
    expect(context.activeHouseholdMemberCount(db, 'unaffiliated')).toBe(0);
  });

  it('checks household AI settings permission and fails closed on missing or malformed access', () => {
    addUser('admin', 'home-a');
    addMembership('admin', 'home-a', { permissions: '{"settings":true}' });
    addUser('member', 'home-a');
    addMembership('member', 'home-a');
    addUser('malformed', 'home-a');
    addMembership('malformed', 'home-a', { permissions: '{bad-json' });
    addUser('no-household');

    expect(context.canManageHouseholdAiSettings(db, 'admin')).toBe(true);
    expect(context.canManageHouseholdAiSettings(db, 'member')).toBe(false);
    expect(context.canManageHouseholdAiSettings(db, 'malformed')).toBe(false);
    expect(context.canManageHouseholdAiSettings(db, 'no-household')).toBe(true);
  });
});
