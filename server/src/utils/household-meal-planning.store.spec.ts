import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type Store = typeof import('./household-meal-planning.store.js');

let db: Sql;
let store: Store;
let closeDatabase: () => void;

function addHousehold(id: string) {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    id,
    id,
    `INV-${id}`
  );
}

function addMember(householdId: string, userId: string, id = `membership-${userId}`) {
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, household_id, preferences)
     VALUES (?, ?, ?, 'hash', ?, ?)`
  ).run(
    userId,
    `${userId}@hogaria.test`,
    userId,
    householdId,
    JSON.stringify({
      theme: 'dark',
      taste: { goals: ['muscle-gain'], goalNotes: 'Más proteína', allergies: ['cacahuete'] }
    })
  );
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, permissions)
     VALUES (?, ?, ?, '{"settings":false}')`
  ).run(id, householdId, userId);
  return id;
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  store = await import('./household-meal-planning.store.js');
});

afterAll(() => closeDatabase?.());

beforeEach(() => {
  db.prepare('DELETE FROM household_members').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM households').run();
});

describe('household meal-planning settings storage', () => {
  it('seeds new household defaults once from the creator without changing personal preferences', () => {
    addHousehold('home');
    addMember('home', 'creator');
    const preferences = {
      theme: 'dark',
      mealPlan: { breakfast: false, dinner: true },
      mealTimes: { breakfast: '08:15', dinner: '19:45' },
      taste: {
        goals: ['muscle-gain', 'maintenance'],
        goalNotes: 'Más proteína',
        allergies: ['cacahuete'],
        likes: ['tomate'],
        dislikes: ['cilantro'],
        notes: 'No copiar estas notas'
      }
    };
    const rawPreferences = JSON.stringify(preferences);
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(rawPreferences, 'creator');

    expect(store.initializeHouseholdMealPlanningFromCreator(db, 'home', 'creator')).toBe(true);

    const stored = db
      .prepare('SELECT meal_planning_preferences FROM households WHERE id = ?')
      .get('home') as { meal_planning_preferences: string };
    expect(JSON.parse(stored.meal_planning_preferences)).toEqual({
      objective: { goals: ['muscle-gain', 'maintenance'], notes: 'Más proteína' },
      mealTypes: { breakfast: false, lunch: true, snack: true, dinner: true },
      mealTimes: { breakfast: '08:15', lunch: '14:00', snack: '17:00', dinner: '19:45' }
    });
    expect(stored.meal_planning_preferences).not.toContain('cacahuete');
    expect(stored.meal_planning_preferences).not.toContain('cilantro');
    expect(stored.meal_planning_preferences).not.toContain('No copiar estas notas');
    expect(
      (
        db.prepare('SELECT preferences FROM users WHERE id = ?').get('creator') as {
          preferences: string;
        }
      ).preferences
    ).toBe(rawPreferences);

    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({ mealPlan: { lunch: false } }),
      'creator'
    );
    expect(store.initializeHouseholdMealPlanningFromCreator(db, 'home', 'creator')).toBe(false);
    expect(
      (
        db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home') as {
          meal_planning_preferences: string;
        }
      ).meal_planning_preferences
    ).toBe(stored.meal_planning_preferences);
  });

  it('does not seed over existing household settings and reports missing rows', () => {
    addHousehold('home');
    addHousehold('configured');
    addMember('home', 'creator');
    addMember('configured', 'other');
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      '{"objective":{"goals":["variety"]}}',
      'configured'
    );

    expect(() =>
      store.initializeHouseholdMealPlanningFromCreator(db, 'missing', 'creator')
    ).toThrowError('HOUSEHOLD_NOT_FOUND');
    expect(() =>
      store.initializeHouseholdMealPlanningFromCreator(db, 'home', 'missing')
    ).toThrowError('HOUSEHOLD_CREATOR_NOT_FOUND');
    expect(store.initializeHouseholdMealPlanningFromCreator(db, 'configured', 'other')).toBe(false);
    expect(
      (
        db
          .prepare('SELECT meal_planning_preferences FROM households WHERE id = ?')
          .get('configured') as { meal_planning_preferences: string }
      ).meal_planning_preferences
    ).toBe('{"objective":{"goals":["variety"]}}');
  });

  it('defaults to household settings and hides personal restrictions from its planner context', () => {
    addHousehold('home');
    const memberId = addMember('home', 'person');

    const result = store.readHouseholdMealPlanningForMembers(db, 'home', 'person', [memberId]);

    expect(result.household).toEqual({
      objective: { goals: ['balanced'], notes: '' },
      mealTypes: { breakfast: true, lunch: true, snack: true, dinner: true },
      mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
    });
    expect(result.members[0]).toMatchObject({
      householdMemberId: memberId,
      userId: 'person',
      goalOverrideEnabled: false,
      goal: { source: 'household', goals: ['balanced'], notes: '' },
      scheduleOverrideEnabled: false,
      schedule: { source: 'household' }
    });
    expect(JSON.stringify(result)).not.toContain('cacahuete');
  });

  it('persists partial home defaults and independent member overrides without overwriting other preferences', () => {
    addHousehold('home');
    const memberId = addMember('home', 'person');
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify({ unrelated: 'keep-me' }),
      'home'
    );

    const result = store.saveHouseholdMealPlanning(db, 'home', 'person', {
      household: {
        objective: { goals: ['variety'], notes: 'Temporada' },
        mealTypes: { breakfast: false },
        mealTimes: { dinner: '21:15' }
      },
      member: {
        goalOverrideEnabled: true,
        scheduleOverrideEnabled: true,
        schedule: { mealTypes: { lunch: false }, mealTimes: { lunch: '13:30' } }
      }
    });

    expect(result.household.objective).toEqual({ goals: ['variety'], notes: 'Temporada' });
    expect(result.household.mealTypes).toEqual({
      breakfast: false,
      lunch: true,
      snack: true,
      dinner: true
    });
    expect(result.household.mealTimes.dinner).toBe('21:15');
    expect(result.member.goalOverrideEnabled).toBe(true);
    expect(result.member.scheduleOverrideEnabled).toBe(true);
    expect(result.member.personalSchedule).toEqual({
      mealTypes: { breakfast: false, lunch: false, snack: true, dinner: true },
      mealTimes: { breakfast: '09:00', lunch: '13:30', snack: '17:00', dinner: '21:15' }
    });
    expect(result.effective.objective).toEqual({
      source: 'member',
      goals: ['muscle-gain'],
      notes: 'Más proteína'
    });
    expect(result.effective.schedule.source).toBe('member');
    expect(result.effective.schedule.mealTypes.lunch).toBe(false);

    const rawHousehold = JSON.parse(
      (
        db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home') as {
          meal_planning_preferences: string;
        }
      ).meal_planning_preferences
    );
    const rawMember = JSON.parse(
      (
        db
          .prepare('SELECT meal_planning_preferences FROM household_members WHERE id = ?')
          .get(memberId) as { meal_planning_preferences: string }
      ).meal_planning_preferences
    );
    expect(rawHousehold.unrelated).toBe('keep-me');
    expect(rawMember.goalOverrideEnabled).toBe(true);
    const rawPersonal = JSON.parse(
      (
        db.prepare('SELECT preferences FROM users WHERE id = ?').get('person') as {
          preferences: string;
        }
      ).preferences
    );
    expect(rawPersonal.theme).toBe('dark');
    expect(rawPersonal.taste.allergies).toEqual(['cacahuete']);

    const again = store.readHouseholdMealPlanning(db, 'home', 'person');
    expect(again.effective.schedule.mealTimes.lunch).toBe('13:30');
  });

  it('ignores disabled personal values and falls back independently for each setting', () => {
    addHousehold('home');
    const memberId = addMember('home', 'person');
    store.saveHouseholdMealPlanning(db, 'home', 'person', {
      household: { objective: { goals: ['maintenance'] }, mealTimes: { lunch: '13:00' } },
      member: {
        goalOverrideEnabled: false,
        scheduleOverrideEnabled: false,
        schedule: { mealTimes: { lunch: '12:00' } }
      }
    });

    const result = store.readHouseholdMealPlanningForMembers(db, 'home', 'person', [memberId]);

    expect(result.members[0].goal).toMatchObject({ source: 'household', goals: ['maintenance'] });
    expect(result.members[0].schedule).toMatchObject({
      source: 'household',
      mealTimes: { lunch: '13:00' }
    });
  });

  it('requires caller membership and rejects selected inactive or foreign memberships', () => {
    addHousehold('home');
    addHousehold('elsewhere');
    const memberId = addMember('home', 'person');
    const foreignId = addMember('elsewhere', 'outsider');

    expect(() =>
      store.readHouseholdMealPlanningForMembers(db, 'home', 'outsider', [memberId])
    ).toThrowError('HOUSEHOLD_CALLER_NOT_ACTIVE');
    expect(() =>
      store.readHouseholdMealPlanningForMembers(db, 'home', 'person', [foreignId])
    ).toThrowError('HOUSEHOLD_MEMBER_NOT_FOUND');
    db.prepare('UPDATE household_members SET is_active = 0 WHERE id = ?').run(memberId);
    expect(() =>
      store.readHouseholdMealPlanningForMembers(db, 'home', 'person', [memberId])
    ).toThrowError('HOUSEHOLD_CALLER_NOT_ACTIVE');
  });

  it('returns no participants for an empty selection but still validates caller context', () => {
    addHousehold('home');
    addMember('home', 'person');

    expect(store.readHouseholdMealPlanningForMembers(db, 'home', 'person', []).members).toEqual([]);
    expect(() => store.readHouseholdMealPlanningForMembers(db, 'home', 'missing', [])).toThrowError(
      'HOUSEHOLD_CALLER_NOT_ACTIVE'
    );
  });

  it('falls back safely when persisted planner or personal preference JSON is malformed', () => {
    addHousehold('home');
    const memberId = addMember('home', 'person');
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      '{broken',
      'home'
    );
    db.prepare('UPDATE household_members SET meal_planning_preferences = ? WHERE id = ?').run(
      '[]',
      memberId
    );
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run('{broken', 'person');

    const result = store.readHouseholdMealPlanningForMembers(db, 'home', 'person', [memberId]);

    expect(result.household.objective).toEqual({ goals: ['balanced'], notes: '' });
    expect(result.members[0].goal).toMatchObject({ source: 'household', goals: ['balanced'] });
    expect(result.members[0].scheduleOverrideEnabled).toBe(false);
  });
});
