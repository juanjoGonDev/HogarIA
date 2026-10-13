import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
const now = new Date('2026-10-11T10:00:00.000Z');

let db: Sql;
let closeDatabase: () => void;
let store: typeof import('./household-planning-automation.store.js');

function makeHousehold(id: string) {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    id,
    id,
    `INVITE-${id}`
  );
}

function makeMember(
  id: string,
  householdId: string,
  permissions: { settings?: boolean; calendar?: { edit?: boolean } }
) {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, `${id}@hogaria.test`, id, 'synthetic-hash', householdId);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'member', ?)`
  ).run(`${id}-membership`, householdId, id, JSON.stringify(permissions));
}

const completeConfiguration = {
  mode: 'generate' as const,
  scopes: ['meals', 'tasks'] as ('meals' | 'tasks')[],
  weekday: 1 as const,
  localTime: '09:30',
  timeZone: 'Europe/Madrid'
};

describe('household planning automation store', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    store = await import('./household-planning-automation.store.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
  });

  afterAll(() => closeDatabase());

  beforeEach(() => {
    db.prepare('DELETE FROM household_planning_automations').run();
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
  });

  it('reads an off-by-default value without creating a database row', () => {
    makeHousehold('home-a');

    expect(store.readHouseholdPlanningAutomation(db, 'home-a', now)).toEqual({
      enabled: false,
      mode: null,
      scopes: [],
      weekday: null,
      localTime: null,
      timeZone: null,
      version: 0,
      nextRunAt: null,
      nextRun: null
    });
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM household_planning_automations').get() as {
          count: number;
        }
      ).count
    ).toBe(0);
  });

  it('persists a disabled configuration, then activates it with a deterministic future run', () => {
    makeHousehold('home-a');
    makeMember('owner', 'home-a', { settings: true, calendar: { edit: true } });
    const configured = store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: 0, ...completeConfiguration },
      now
    );
    expect(configured.status).toBe('saved');
    expect(configured.snapshot).toMatchObject({
      enabled: false,
      version: 1,
      mode: 'generate',
      scopes: ['meals', 'tasks'],
      weekday: 1,
      localTime: '09:30',
      timeZone: 'Europe/Madrid',
      nextRunAt: null
    });

    const enabled = store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: 1, enabled: true },
      now
    );
    expect(enabled.status).toBe('saved');
    expect(enabled.snapshot).toMatchObject({
      enabled: true,
      version: 2,
      nextRunAt: '2026-10-12T07:30:00.000Z',
      nextRun: {
        scheduledLocalDate: '2026-10-12',
        localDate: '2026-10-12',
        localTime: '09:30',
        timeZone: 'Europe/Madrid',
        occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30'
      }
    });
    expect(store.readHouseholdPlanningAutomation(db, 'home-a', now)).toEqual(enabled.snapshot);
  });

  it('preserves all saved fields when pausing and returns no next occurrence', () => {
    makeHousehold('home-a');
    makeMember('owner', 'home-a', { settings: true, calendar: { edit: true } });
    store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: 0, ...completeConfiguration },
      now
    );
    store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: 1, enabled: true },
      now
    );

    const paused = store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: 2, enabled: false },
      now
    );

    expect(paused.status).toBe('saved');
    expect(paused.snapshot).toMatchObject({
      enabled: false,
      version: 3,
      mode: 'generate',
      scopes: ['meals', 'tasks'],
      weekday: 1,
      localTime: '09:30',
      timeZone: 'Europe/Madrid',
      nextRunAt: null,
      nextRun: null
    });
  });

  it('returns the current snapshot on stale version without applying any field', () => {
    makeHousehold('home-a');
    makeMember('owner', 'home-a', { settings: true, calendar: { edit: true } });
    const initial = store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: 0, ...completeConfiguration },
      now
    );

    const conflict = store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'owner',
      { expectedVersion: 0, mode: 'repeat' },
      now
    );

    expect(conflict).toEqual({ status: 'conflict', snapshot: initial.snapshot });
  });

  it('rejects enabling an incomplete schedule, missing settings, or missing calendar edit', () => {
    makeHousehold('home-a');
    makeMember('settings-only', 'home-a', { settings: true });
    makeMember('calendar-only', 'home-a', { calendar: { edit: true } });

    expect(() =>
      store.saveHouseholdPlanningAutomation(
        db,
        'home-a',
        'settings-only',
        { expectedVersion: 0, enabled: true },
        now
      )
    ).toThrowError(expect.objectContaining({ code: 'AUTOMATION_SCHEDULE_REQUIRED' }));
    expect(() =>
      store.saveHouseholdPlanningAutomation(
        db,
        'home-a',
        'calendar-only',
        { expectedVersion: 0, ...completeConfiguration },
        now
      )
    ).toThrowError(expect.objectContaining({ code: 'HOUSEHOLD_SETTINGS_REQUIRED' }));

    store.saveHouseholdPlanningAutomation(
      db,
      'home-a',
      'settings-only',
      { expectedVersion: 0, ...completeConfiguration },
      now
    );
    expect(() =>
      store.saveHouseholdPlanningAutomation(
        db,
        'home-a',
        'settings-only',
        { expectedVersion: 1, enabled: true },
        now
      )
    ).toThrowError(expect.objectContaining({ code: 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED' }));
  });

  it('revalidates the active household and active membership inside the write path', () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    makeMember('owner', 'home-a', { settings: true, calendar: { edit: true } });

    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES ('owner-home-b', 'home-b', 'owner', 'member', '{"settings":true}')`
    ).run();
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-b', 'owner');
    expect(() =>
      store.saveHouseholdPlanningAutomation(
        db,
        'home-a',
        'owner',
        { expectedVersion: 0, ...completeConfiguration },
        now
      )
    ).toThrowError(expect.objectContaining({ code: 'HOUSEHOLD_CONTEXT_CHANGED' }));

    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run('owner');
    expect(() =>
      store.saveHouseholdPlanningAutomation(
        db,
        'home-b',
        'owner',
        { expectedVersion: 0, ...completeConfiguration },
        now
      )
    ).toThrowError(expect.objectContaining({ code: 'HOUSEHOLD_CONTEXT_CHANGED' }));
  });
});
