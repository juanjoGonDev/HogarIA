import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type User = { id: string; email: string; token: string };

let app: Hono;
let db: Sql;
let closeDatabase: () => void;

describe('household create and join transactions', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { householdRoutes } = await import('./household.routes.js');
    const { householdMealPlanningRoutes } = await import('./household-meal-planning.routes.js');
    const { authMiddleware } = await import('../middleware/auth.middleware.js');
    const { config } = await import('../config/app.config.js');
    await database.initializeDatabase();
    closeDatabase = database.closeDatabase;
    db = database.getDatabase();
    app = new Hono();
    app.route('/api/household', householdRoutes);
    app.route('/api/household', householdMealPlanningRoutes);
    app.get('/api/protected-household-test', authMiddleware, (context) =>
      context.json({ success: true })
    );
    app.onError((error, context) => {
      return context.json({ success: false, message: error.message }, 500);
    });
    testJwtSecret = config.auth.jwtSecret;
  });

  afterAll(() => closeDatabase());

  beforeEach(() => {
    // users.household_id is a foreign key too; detach the selection before
    // clearing household rows so repeated tests obey the same delete rules.
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM ai_jobs').run();
    db.prepare('DELETE FROM ai_configs').run();
    for (const table of [
      'pantry_categories',
      'ingredients',
      'utensils',
      'household_members',
      'users',
      'households'
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.exec('DROP TRIGGER IF EXISTS fail_household_seed');
  });

  let testJwtSecret = '';

  async function makeUser(id: string, householdId: string | null): Promise<User> {
    const email = `${id}@hogaria.test`;
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
    ).run(id, email, id, 'not-a-real-password-hash', householdId);
    return {
      id,
      email,
      token: jwt.sign({ sub: id, email }, testJwtSecret, { expiresIn: '1h' })
    };
  }

  function call(user: User, method: string, path: string, body?: unknown) {
    return app.request(`/api/household${path}`, {
      method,
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  function failDuringHouseholdSeed() {
    db.exec(`
      CREATE TRIGGER fail_household_seed
      BEFORE INSERT ON pantry_categories
      WHEN NEW.key = 'vegetables'
        AND (NEW.household_id = 'target-house' OR NEW.user_id = 'create-owner')
      BEGIN
        SELECT RAISE(ABORT, 'forced household seed failure');
      END;
    `);
  }

  function addPersonalRows(userId: string) {
    db.prepare(
      'INSERT INTO ingredients (id, user_id, name, category, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('personal-ingredient', userId, 'Avena personalizada', 'grains', 2, 'kg');
    db.prepare(
      'INSERT INTO utensils (id, user_id, name, category, available) VALUES (?, ?, ?, ?, ?)'
    ).run('personal-utensil', userId, 'Cuchillo heredado', 'tools', 1);
  }

  function addDuplicateHouseholdRows(userId: string) {
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('target-ingredient', userId, 'target-house', 'Avena personalizada', 'grains', 7, 'kg');
    db.prepare(
      `INSERT INTO utensils (id, user_id, household_id, name, category, available)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('target-utensil', userId, 'target-house', 'Cuchillo heredado', 'tools', 0);
  }

  async function createJoinFixture() {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'old-house',
      'Hogar anterior',
      'OLDHOUSE'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'target-house',
      'Hogar destino',
      'TARGET01'
    );
    const member = await makeUser('joining-member', 'old-house');
    const oldAdmin = await makeUser('old-admin', 'old-house');
    const admin = await makeUser('target-admin', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('old-membership', 'old-house', member.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('old-admin-membership', 'old-house', oldAdmin.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('target-membership', 'target-house', admin.id);
    addPersonalRows(member.id);
    return { member, oldAdmin, admin };
  }

  it('lee el estado sin hogar, la invitación pública y la vista autenticada', async () => {
    const guest = await makeUser('household-guest', null);
    const empty = await call(guest, 'GET', '');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ success: true, data: null });

    const { admin } = await createJoinFixture();
    const child = await makeUser('read-child', 'target-house');
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run('/uploads/admin.png', admin.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'child', NULL)`
    ).run('target-child-membership', 'target-house', child.id);

    const missingInvite = await app.request('/api/household/invite/UNKNOWN');
    const publicInvite = await app.request('/api/household/invite/TARGET01');
    const memberInvite = await call(admin, 'GET', '/invite/TARGET01');
    const currentHousehold = await call(admin, 'GET', '');

    expect(missingInvite.status).toBe(404);
    expect(publicInvite.status).toBe(200);
    expect(await publicInvite.json()).toMatchObject({
      success: true,
      data: {
        householdId: 'target-house',
        householdName: 'Hogar destino',
        memberCount: 2,
        alreadyMember: false
      }
    });
    expect(await memberInvite.json()).toMatchObject({
      success: true,
      data: { memberCount: 2, alreadyMember: true }
    });
    const current = (await currentHousehold.json()) as {
      success: boolean;
      data: {
        id: string;
        members: Array<{ userId: string; avatar?: string; permissions: { settings: boolean } }>;
      };
    };
    expect(currentHousehold.status).toBe(200);
    expect(current.data.id).toBe('target-house');
    expect(current.data.members.find((entry) => entry.userId === admin.id)?.avatar).toBe(
      '/uploads/admin.png'
    );
    expect(
      current.data.members.find((entry) => entry.userId === child.id)?.permissions.settings
    ).toBe(false);
  });

  it('lista hogares propios y solo permite seleccionar una membresía existente', async () => {
    const { member } = await createJoinFixture();
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('member-target-membership', 'target-house', member.id);

    const memberships = await call(member, 'GET', '/memberships');
    expect(memberships.status).toBe(200);
    expect(await memberships.json()).toMatchObject({
      success: true,
      data: {
        activeHouseholdId: 'old-house',
        memberships: [
          { id: 'old-house', name: 'Hogar anterior', role: 'member', active: true },
          { id: 'target-house', name: 'Hogar destino', role: 'member', active: false }
        ]
      }
    });

    const switched = await call(member, 'POST', '/active', { householdId: 'target-house' });
    expect(switched.status).toBe(200);
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as any).household_id
    ).toBe('target-house');
    expect((await call(member, 'GET', '')).status).toBe(200);

    const rejected = await call(member, 'POST', '/active', { householdId: 'unknown-house' });
    expect(rejected.status).toBe(404);
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as any).household_id
    ).toBe('target-house');

    const invalid = await call(member, 'POST', '/active', { householdId: '  ' });
    expect(invalid.status).toBe(400);
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as any).household_id
    ).toBe('target-house');
  });

  it('repara una selección obsoleta solo si queda una membresía y no filtra con varias', async () => {
    await createJoinFixture();
    const stale = await makeUser('stale-selection', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('stale-old-membership', 'old-house', stale.id);

    const repaired = await call(stale, 'GET', '/memberships');
    expect(repaired.status).toBe(200);
    expect(await repaired.json()).toMatchObject({
      success: true,
      data: { activeHouseholdId: 'old-house', memberships: [{ id: 'old-house', active: true }] }
    });
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(stale.id) as any).household_id
    ).toBe('old-house');

    const unselected = await makeUser('multiple-without-selection', null);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('multi-old-membership', 'old-house', unselected.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('multi-target-membership', 'target-house', unselected.id);

    const noImplicitChoice = await call(unselected, 'GET', '');
    expect(noImplicitChoice.status).toBe(200);
    expect(await noImplicitChoice.json()).toMatchObject({ success: true, data: null });
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(unselected.id) as any)
        .household_id
    ).toBeNull();
  });

  it('rolls back household creation when seeding fails after personal rows are adopted', async () => {
    const owner = await makeUser('create-owner', null);
    addPersonalRows(owner.id);
    failDuringHouseholdSeed();

    const response = await call(owner, 'POST', '', { name: 'Nuevo hogar' });

    expect(response.status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) AS count FROM households').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_members').get()).toEqual({
      count: 0
    });
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(owner.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBeNull();
    expect(
      (
        db
          .prepare('SELECT household_id FROM ingredients WHERE id = ?')
          .get('personal-ingredient') as {
          household_id: string | null;
        }
      ).household_id
    ).toBeNull();
    expect(
      (
        db.prepare('SELECT household_id FROM utensils WHERE id = ?').get('personal-utensil') as {
          household_id: string | null;
        }
      ).household_id
    ).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM pantry_categories').get()).toEqual({
      count: 0
    });
  });

  it('creates another household when the same user has category keys in an older household', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'previous-house',
      'Hogar anterior',
      'PREVIOUS1'
    );
    const owner = await makeUser('returning-owner', 'previous-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES ('previous-owner-membership', 'previous-house', ?, 'admin', '{}')`
    ).run(owner.id);
    db.prepare(
      `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color, position)
       VALUES ('previous-vegetables', ?, 'previous-house', 'vegetables', 'Mi huerto', '#123456', 1)`
    ).run(owner.id);

    const response = await call(owner, 'POST', '', { name: 'Hogar nuevo' });
    const result = (await response.json()) as { success: boolean; data?: { id: string } };

    expect(response.status).toBe(201);
    expect(result.success).toBe(true);
    expect(result.data?.id).toBeTruthy();
    expect(
      db
        .prepare('SELECT name FROM pantry_categories WHERE id = ? AND household_id = ?')
        .get('previous-vegetables', 'previous-house')
    ).toEqual({ name: 'Mi huerto' });
    expect(
      db
        .prepare(
          `SELECT name FROM pantry_categories
           WHERE user_id = ? AND household_id = ? AND key = 'vegetables'`
        )
        .get(owner.id, result.data?.id)
    ).toEqual({ name: 'Verduras' });
  });

  it('joins another household without colliding with category keys in the current home', async () => {
    const { member } = await createJoinFixture();
    db.prepare(
      `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color, position)
       VALUES ('current-vegetables', ?, 'old-house', 'vegetables', 'Mi huerto', '#123456', 1)`
    ).run(member.id);

    const response = await call(member, 'POST', '/join', { inviteCode: 'TARGET01' });

    expect(response.status).toBe(200);
    expect(
      db
        .prepare('SELECT name FROM pantry_categories WHERE id = ? AND household_id = ?')
        .get('current-vegetables', 'old-house')
    ).toEqual({ name: 'Mi huerto' });
    expect(
      db
        .prepare(
          `SELECT name FROM pantry_categories
           WHERE user_id = ? AND household_id = 'target-house' AND key = 'vegetables'`
        )
        .get(member.id)
    ).toEqual({ name: 'Verduras' });
  });

  it.each([
    { label: 'el endpoint con código en el body', path: '/join', useBody: true },
    { label: 'el endpoint con código en la ruta', path: '/join/TARGET01', useBody: false }
  ])(
    'conserva el hogar anterior si falla la siembra al unirse por $label',
    async ({ path, useBody }) => {
      const { member, admin } = await createJoinFixture();
      addDuplicateHouseholdRows(admin.id);
      failDuringHouseholdSeed();

      const response = await call(
        member,
        'POST',
        path,
        useBody ? { inviteCode: 'TARGET01' } : undefined
      );

      expect(response.status).toBe(500);
      expect(
        (
          db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as {
            household_id: string | null;
          }
        ).household_id
      ).toBe('old-house');
      expect(
        db
          .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
          .get('old-house', member.id)
      ).toEqual({ id: 'old-membership' });
      expect(
        db
          .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
          .get('target-house', member.id)
      ).toBeUndefined();
      expect(
        (
          db
            .prepare('SELECT household_id FROM ingredients WHERE id = ?')
            .get('personal-ingredient') as {
            household_id: string | null;
          }
        ).household_id
      ).toBeNull();
      expect(
        (
          db.prepare('SELECT household_id FROM utensils WHERE id = ?').get('personal-utensil') as {
            household_id: string | null;
          }
        ).household_id
      ).toBeNull();
      expect(
        db.prepare('SELECT quantity FROM ingredients WHERE id = ?').get('target-ingredient')
      ).toEqual({ quantity: 7 });
      expect(
        db.prepare('SELECT available FROM utensils WHERE id = ?').get('target-utensil')
      ).toEqual({ available: 0 });
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM pantry_categories WHERE household_id = ?')
          .get('target-house')
      ).toEqual({ count: 0 });
    }
  );

  it('crea el hogar y adopta los datos personales cuando toda la secuencia termina', async () => {
    const owner = await makeUser('create-owner', null);
    addPersonalRows(owner.id);
    db.prepare(
      `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, is_active)
       VALUES ('personal-active', ?, 'Personal local', 'custom', 'http://127.0.0.1/v1', 'synthetic-key', 'gpt-test', 1),
              ('personal-alt', ?, 'Personal alt', 'custom', 'http://127.0.0.2/v1', 'other-synthetic-key', 'other-test', 0)`
    ).run(owner.id, owner.id);

    const response = await call(owner, 'POST', '', { name: 'Nuevo hogar' });
    const result = (await response.json()) as {
      success: boolean;
      data: { id: string };
    };

    expect(response.status).toBe(201);
    expect(result.success).toBe(true);
    expect(result.data.id).toBeTruthy();
    const copiedConfig = db
      .prepare(
        'SELECT id, user_id, household_id, name, base_url, api_key, model, is_active FROM ai_configs WHERE household_id = ?'
      )
      .get(result.data.id);
    expect(copiedConfig).toMatchObject({
      user_id: owner.id,
      household_id: result.data.id,
      name: 'Personal local',
      base_url: 'http://127.0.0.1/v1',
      api_key: 'synthetic-key',
      model: 'gpt-test',
      is_active: 1
    });
    expect((copiedConfig as { id: string }).id).not.toBe('personal-active');
    expect(
      db
        .prepare(
          'SELECT id, household_id FROM ai_configs WHERE user_id = ? AND household_id IS NULL ORDER BY id'
        )
        .all(owner.id)
    ).toEqual([
      { id: 'personal-active', household_id: null },
      { id: 'personal-alt', household_id: null }
    ]);
    expect(
      db
        .prepare(
          `SELECT h.ai_owner_user_id, hm.role
             FROM households h
             JOIN household_members hm ON hm.household_id = h.id AND hm.user_id = ?
            WHERE h.id = ?`
        )
        .get(owner.id, result.data.id)
    ).toEqual({ ai_owner_user_id: null, role: 'admin' });
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(owner.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBe(result.data.id);
    expect(
      (
        db
          .prepare('SELECT household_id FROM ingredients WHERE id = ?')
          .get('personal-ingredient') as {
          household_id: string | null;
        }
      ).household_id
    ).toBe(result.data.id);
    expect(
      (
        db.prepare('SELECT household_id FROM utensils WHERE id = ?').get('personal-utensil') as {
          household_id: string | null;
        }
      ).household_id
    ).toBe(result.data.id);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM pantry_categories WHERE household_id = ?')
        .get(result.data.id)
    ).toEqual({ count: 13 });
  });

  it('inicializa la planificación compartida desde el creador sin copiar ni borrar su perfil', async () => {
    const owner = await makeUser('planning-owner', null);
    const personalPreferences = {
      taste: {
        goals: ['muscle-gain', 'variety'],
        goalNotes: 'Más energía para entrenar',
        allergies: ['frutos secos'],
        likes: ['lentejas'],
        dislikes: ['coliflor'],
        notes: 'Prefiero cenas ligeras'
      },
      mealPlan: { breakfast: false, lunch: true, snack: false, dinner: true },
      mealTimes: { breakfast: '08:10', lunch: '13:15', snack: '17:45', dinner: '21:00' },
      onboarding: { status: 'done' }
    };
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify(personalPreferences),
      owner.id
    );

    const response = await call(owner, 'POST', '', { name: 'Hogar con planificación' });
    const body = (await response.json()) as { data: { id: string } };
    const storedHome = db
      .prepare('SELECT meal_planning_preferences FROM households WHERE id = ?')
      .get(body.data.id) as { meal_planning_preferences: string };
    const storedProfile = db
      .prepare('SELECT preferences FROM users WHERE id = ?')
      .get(owner.id) as {
      preferences: string;
    };
    const settings = await app.request('/api/household/meal-planning', {
      headers: {
        authorization: `Bearer ${owner.token}`,
        'x-household-id': body.data.id
      }
    });
    const settingsBody = (await settings.json()) as { data: any };

    expect(response.status).toBe(201);
    expect(settings.status).toBe(200);
    expect(JSON.parse(storedHome.meal_planning_preferences)).toEqual({
      objective: { goals: ['muscle-gain', 'variety'], notes: 'Más energía para entrenar' },
      mealTypes: { breakfast: false, lunch: true, snack: false, dinner: true },
      mealTimes: { breakfast: '08:10', lunch: '13:15', snack: '17:45', dinner: '21:00' }
    });
    expect(JSON.parse(storedProfile.preferences)).toEqual(personalPreferences);
    expect(settingsBody.data.member).toMatchObject({
      goalOverrideEnabled: false,
      scheduleOverrideEnabled: false,
      personalObjective: { goals: ['muscle-gain', 'variety'], notes: 'Más energía para entrenar' }
    });
    expect(JSON.stringify(settingsBody)).not.toContain('frutos secos');
  });

  it('permite crear otro hogar sin eliminar la membresía anterior ni adoptar datos de esa casa', async () => {
    const { member } = await createJoinFixture();

    const response = await call(member, 'POST', '', { name: 'Segundo hogar' });
    const body = (await response.json()) as { data: { id: string } };

    expect(response.status).toBe(201);
    expect(db.prepare('SELECT COUNT(*) AS count FROM households').get()).toEqual({ count: 3 });
    expect(
      db
        .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
        .get('old-house', member.id)
    ).toBeTruthy();
    expect(
      db
        .prepare('SELECT role FROM household_members WHERE household_id = ? AND user_id = ?')
        .get(body.data.id, member.id)
    ).toEqual({ role: 'admin' });
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as any).household_id
    ).toBe(body.data.id);
    expect(
      (
        db
          .prepare('SELECT household_id FROM ingredients WHERE id = ?')
          .get('personal-ingredient') as any
      ).household_id
    ).toBeNull();
  });

  it.each([
    { label: 'el endpoint con código en el body', path: '/join', useBody: true },
    { label: 'el endpoint con código en la ruta', path: '/join/TARGET01', useBody: false }
  ])(
    'añade una segunda membresía sin mover datos de la casa anterior por $label',
    async ({ path, useBody }) => {
      const { member } = await createJoinFixture();

      const response = await call(
        member,
        'POST',
        path,
        useBody ? { inviteCode: 'TARGET01' } : undefined
      );

      expect(response.status).toBe(200);
      expect(
        (
          db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as {
            household_id: string | null;
          }
        ).household_id
      ).toBe('target-house');
      expect(
        db
          .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
          .get('old-house', member.id)
      ).toEqual({ id: 'old-membership' });
      expect(
        db
          .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
          .get('target-house', member.id)
      ).toBeTruthy();
      expect(
        (
          db
            .prepare('SELECT household_id FROM ingredients WHERE id = ?')
            .get('personal-ingredient') as {
            household_id: string | null;
          }
        ).household_id
      ).toBeNull();
      expect(
        (
          db.prepare('SELECT household_id FROM utensils WHERE id = ?').get('personal-utensil') as {
            household_id: string | null;
          }
        ).household_id
      ).toBeNull();
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM pantry_categories WHERE household_id = ?')
          .get('target-house')
      ).toEqual({ count: 13 });
    }
  );

  it('une a una cuenta sin hogar y adopta sus filas personales al primer hogar', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'target-house',
      'Hogar destino',
      'TARGET01'
    );
    const existingDefaults = {
      objective: { goals: ['variety'], notes: 'Ya configurado' },
      mealTypes: { breakfast: true, lunch: false, snack: true, dinner: false },
      mealTimes: { breakfast: '09:00', lunch: '14:00', snack: '17:00', dinner: '20:30' }
    };
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify(existingDefaults),
      'target-house'
    );
    const member = await makeUser('personal-member', null);
    const admin = await makeUser('target-admin', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('target-membership', 'target-house', admin.id);
    addPersonalRows(member.id);

    const response = await call(member, 'POST', '/join', { inviteCode: 'TARGET01' });

    expect(response.status).toBe(200);
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBe('target-house');
    expect(
      db
        .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
        .get('target-house', member.id)
    ).toBeTruthy();
    expect(
      JSON.parse(
        (
          db
            .prepare('SELECT meal_planning_preferences FROM households WHERE id = ?')
            .get('target-house') as { meal_planning_preferences: string }
        ).meal_planning_preferences
      )
    ).toEqual(existingDefaults);
    expect(
      (
        db
          .prepare('SELECT household_id FROM ingredients WHERE id = ?')
          .get('personal-ingredient') as {
          household_id: string | null;
        }
      ).household_id
    ).toBe('target-house');
  });

  it('preserva los resultados de código inválido y membresía duplicada sin escrituras', async () => {
    const { member, admin } = await createJoinFixture();

    expect((await call(member, 'POST', '/join/NO-SUCH-CODE')).status).toBe(404);
    expect((await call(admin, 'POST', '/join', { inviteCode: 'TARGET01' })).status).toBe(409);
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBe('old-house');
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = ?')
        .get('target-house')
    ).toEqual({ count: 1 });
  });

  it('un administrador no puede cambiar el rol de un miembro de otro hogar', async () => {
    const { member, admin } = await createJoinFixture();

    const response = await call(admin, 'PATCH', '', {
      name: 'Cambio que no debe aplicarse',
      memberId: 'old-membership',
      memberRole: 'child'
    });

    expect(response.status).toBe(404);
    expect(
      db.prepare('SELECT role FROM household_members WHERE id = ?').get('old-membership')
    ).toEqual({ role: 'member' });
    expect(db.prepare('SELECT name FROM households WHERE id = ?').get('target-house')).toEqual({
      name: 'Hogar destino'
    });
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBe('old-house');
  });

  it('permite al administrador cambiar un rol local y lo rechaza a un miembro', async () => {
    const { member, admin } = await createJoinFixture();
    const localMember = await makeUser('local-member', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('target-local-membership', 'target-house', localMember.id);

    const changed = await call(admin, 'PATCH', '', {
      memberId: 'target-local-membership',
      memberRole: 'child'
    });
    const denied = await call(member, 'PATCH', '', {
      memberId: 'old-membership',
      memberRole: 'child'
    });

    expect(changed.status).toBe(200);
    expect(
      db.prepare('SELECT role FROM household_members WHERE id = ?').get('target-local-membership')
    ).toEqual({ role: 'child' });
    expect(denied.status).toBe(403);
    expect(
      db.prepare('SELECT role FROM household_members WHERE id = ?').get('old-membership')
    ).toEqual({ role: 'member' });

    const customPermissions = { pantry: { view: true, edit: false } };
    const permissionUpdate = await call(admin, 'PATCH', '', {
      memberId: 'target-local-membership',
      memberPermissions: customPermissions
    });
    expect(permissionUpdate.status).toBe(200);
    expect(
      db
        .prepare('SELECT permissions FROM household_members WHERE id = ?')
        .get('target-local-membership')
    ).toEqual({ permissions: JSON.stringify(customPermissions) });
  });

  it('conserva permisos personalizados al guardar rol y matriz en el mismo cambio', async () => {
    const { admin } = await createJoinFixture();
    const localMember = await makeUser('member-with-custom-access', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('custom-access-membership', 'target-house', localMember.id);
    const customPermissions = {
      pantry: { view: true, edit: false, manage: false },
      recipes: { view: true, create: false, edit: false, delete: false, generateAI: false },
      calendar: { view: true, edit: false },
      members: { invite: false, kick: false, manageRoles: false },
      settings: false
    };

    const response = await call(admin, 'PATCH', '', {
      memberId: 'custom-access-membership',
      memberRole: 'child',
      memberPermissions: customPermissions
    });

    expect(response.status).toBe(200);
    expect(
      db
        .prepare('SELECT role, permissions FROM household_members WHERE id = ?')
        .get('custom-access-membership')
    ).toEqual({ role: 'child', permissions: JSON.stringify(customPermissions) });
  });

  it('allows authorized admins to deactivate and reactivate a membership without deleting it', async () => {
    const { admin } = await createJoinFixture();
    const member = await makeUser('target-toggle-member', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('target-toggle-membership', 'target-house', member.id);
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'other-active-house',
      'Otro hogar activo',
      'OTHER001'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('other-active-membership', 'other-active-house', member.id);

    const initial = await call(admin, 'GET', '');
    const initialBody = (await initial.json()) as any;
    expect(
      initialBody.data.members.find((item: any) => item.id === 'target-toggle-membership')
    ).toMatchObject({ isActive: true });

    const disabled = await call(admin, 'PATCH', '', {
      memberId: 'target-toggle-membership',
      memberActive: false
    });
    const disabledBody = (await disabled.json()) as any;
    expect(disabled.status).toBe(200);
    expect(
      disabledBody.data.members.find((item: any) => item.id === 'target-toggle-membership')
    ).toMatchObject({ isActive: false });
    expect(
      db.prepare('SELECT id FROM household_members WHERE id = ?').get('target-toggle-membership')
    ).toEqual({ id: 'target-toggle-membership' });
    const remainingMemberships = await call(member, 'GET', '/memberships');
    expect(await remainingMemberships.json()).toMatchObject({
      data: {
        activeHouseholdId: null,
        memberships: [{ id: 'other-active-house', active: false }]
      }
    });
    expect(
      (
        await app.request('/api/protected-household-test', {
          headers: { authorization: `Bearer ${member.token}` }
        })
      ).status
    ).toBe(409);
    expect(
      (await call(member, 'POST', '/active', { householdId: 'other-active-house' })).status
    ).toBe(200);
    expect(
      (
        await app.request('/api/protected-household-test', {
          headers: { authorization: `Bearer ${member.token}` }
        })
      ).status
    ).toBe(200);

    const reenabled = await call(admin, 'PATCH', '', {
      memberId: 'target-toggle-membership',
      memberActive: true
    });
    const reenabledBody = (await reenabled.json()) as any;
    expect(reenabled.status).toBe(200);
    expect(
      reenabledBody.data.members.find((item: any) => item.id === 'target-toggle-membership')
    ).toMatchObject({ isActive: true });
  });

  it('requires members.kick even for an admin when that permission is explicitly disabled', async () => {
    const { admin } = await createJoinFixture();
    const target = await makeUser('target-no-kick-member', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('target-no-kick-membership', 'target-house', target.id);
    db.prepare(
      'UPDATE household_members SET permissions = ? WHERE household_id = ? AND user_id = ?'
    ).run(JSON.stringify({ members: { kick: false } }), 'target-house', admin.id);

    const denied = await call(admin, 'PATCH', '', {
      memberId: 'target-no-kick-membership',
      memberActive: false
    });
    const bundledDenied = await call(admin, 'PATCH', '', {
      memberId: 'target-no-kick-membership',
      memberActive: false,
      name: 'Nombre que no se debe guardar'
    });

    expect(denied.status).toBe(403);
    expect(bundledDenied.status).toBe(403);
    expect(
      db
        .prepare('SELECT is_active FROM household_members WHERE id = ?')
        .get('target-no-kick-membership')
    ).toEqual({ is_active: 1 });
  });

  it('protects the last active admin from a member with kick permission', async () => {
    await createJoinFixture();
    const manager = await makeUser('target-kick-manager', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', ?)`
    ).run(
      'target-kick-manager-membership',
      'target-house',
      manager.id,
      JSON.stringify({ members: { kick: true } })
    );

    const lastAdmin = await call(manager, 'PATCH', '', {
      memberId: 'target-membership',
      memberActive: false
    });
    expect(lastAdmin.status).toBe(409);
    expect(
      db.prepare('SELECT is_active FROM household_members WHERE id = ?').get('target-membership')
    ).toEqual({ is_active: 1 });
  });

  it('does not let an admin deactivate their own membership when another admin exists', async () => {
    const { admin } = await createJoinFixture();
    const otherAdmin = await makeUser('target-second-admin', 'target-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('target-second-admin-membership', 'target-house', otherAdmin.id);

    const self = await call(admin, 'PATCH', '', {
      memberId: 'target-membership',
      memberActive: false
    });
    expect(self.status).toBe(409);
    expect(
      db.prepare('SELECT is_active FROM household_members WHERE id = ?').get('target-membership')
    ).toEqual({ is_active: 1 });
  });

  it('persiste los tres ajustes compartidos del admin y responde al PATCH vacío', async () => {
    const { admin } = await createJoinFixture();

    const updated = await call(admin, 'PATCH', '', {
      name: 'Hogar actualizado',
      sharedPantry: false,
      shareRecipes: false,
      shareCalendar: false
    });
    const body = (await updated.json()) as any;

    expect(updated.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 'target-house',
      name: 'Hogar actualizado',
      sharedPantry: false,
      shareRecipes: false,
      shareCalendar: false
    });
    expect(
      db
        .prepare(
          'SELECT name, shared_pantry, share_recipes, share_calendar FROM households WHERE id = ?'
        )
        .get('target-house')
    ).toEqual({
      name: 'Hogar actualizado',
      shared_pantry: 0,
      share_recipes: 0,
      share_calendar: 0
    });
    expect((await call(admin, 'PATCH', '', {})).status).toBe(200);
  });

  it('mantiene la respuesta de router para cuentas sin hogar en pruebas aisladas', async () => {
    const personalUser = await makeUser('personal-user', null);
    for (const response of [
      await call(personalUser, 'PATCH', '', { name: 'No disponible' }),
      await call(personalUser, 'POST', '/regenerate-invite', {}),
      await call(personalUser, 'DELETE', '/leave')
    ]) {
      expect(response.status).toBe(404);
    }

    const { admin } = await createJoinFixture();
    const regenerated = await call(admin, 'POST', '/regenerate-invite', {});
    const body = (await regenerated.json()) as { success: boolean; data: { inviteCode: string } };

    expect(regenerated.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.inviteCode).toHaveLength(8);
    expect(body.data.inviteCode).not.toBe('TARGET01');
    expect((await app.request('/api/household/invite/TARGET01')).status).toBe(404);
    expect((await app.request(`/api/household/invite/${body.data.inviteCode}`)).status).toBe(200);
  });

  it('permite que un miembro salga sin borrar el hogar de los demás', async () => {
    const { member, oldAdmin } = await createJoinFixture();

    const response = await call(member, 'DELETE', '/leave');

    expect(response.status).toBe(200);
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBeNull();
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM households WHERE id = ?').get('old-house')
    ).toEqual({
      count: 1
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM household_members WHERE household_id = ?')
        .get('old-house')
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
        .get('old-house', oldAdmin.id)
    ).toEqual({ id: 'old-admin-membership' });
  });

  it('al salir con varias casas restantes deja la selección vacía hasta que el usuario elija', async () => {
    const { member } = await createJoinFixture();
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'third-house',
      'Tercer hogar',
      'THIRD001'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('member-target-membership', 'target-house', member.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('member-third-membership', 'third-house', member.id);

    const response = await call(member, 'DELETE', '/leave');

    expect(response.status).toBe(200);
    expect(
      db
        .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
        .get('old-house', member.id)
    ).toBeUndefined();
    expect(
      db
        .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
        .get('target-house', member.id)
    ).toEqual({ id: 'member-target-membership' });
    expect(
      db
        .prepare('SELECT id FROM household_members WHERE household_id = ? AND user_id = ?')
        .get('third-house', member.id)
    ).toEqual({ id: 'member-third-membership' });
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as any).household_id
    ).toBeNull();

    const memberships = await call(member, 'GET', '/memberships');
    expect(await memberships.json()).toMatchObject({
      success: true,
      data: {
        activeHouseholdId: null,
        memberships: [
          { id: 'target-house', active: false },
          { id: 'third-house', active: false }
        ]
      }
    });
    expect(await (await call(member, 'GET', '')).json()).toMatchObject({
      success: true,
      data: null
    });

    const selected = await call(member, 'POST', '/active', { householdId: 'target-house' });
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({
      success: true,
      data: { activeHouseholdId: 'target-house' }
    });
    const selectedMemberships = (await (await call(member, 'GET', '/memberships')).json()) as {
      data: { activeHouseholdId: string; memberships: Array<{ id: string; active: boolean }> };
    };
    expect(selectedMemberships.data.activeHouseholdId).toBe('target-house');
    expect(selectedMemberships.data.memberships.map(({ id, active }) => ({ id, active }))).toEqual([
      { id: 'target-house', active: true },
      { id: 'third-house', active: false }
    ]);
  });

  it('al salir y quedar una sola casa permite autoseleccionarla', async () => {
    const { member } = await createJoinFixture();
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('member-target-membership', 'target-house', member.id);

    expect((await call(member, 'DELETE', '/leave')).status).toBe(200);
    expect(
      (db.prepare('SELECT household_id FROM users WHERE id = ?').get(member.id) as any).household_id
    ).toBeNull();

    expect(await (await call(member, 'GET', '/memberships')).json()).toMatchObject({
      data: {
        activeHouseholdId: 'target-house',
        memberships: [{ id: 'target-house', active: true }]
      }
    });
  });

  it('al salir el único admin elimina el hogar y solo su inventario compartido', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'only-house',
      'Hogar único',
      'ONLYONE1'
    );
    const owner = await makeUser('only-owner', 'only-house');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('only-admin-membership', 'only-house', owner.id);
    db.prepare(
      'INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('shared-ingredient', owner.id, 'only-house', 'Patatas', 'vegetables', 4, 'kg');
    db.prepare(
      'INSERT INTO ingredients (id, user_id, name, category, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('personal-ingredient', owner.id, 'Avena', 'grains', 2, 'kg');
    db.prepare(
      'INSERT INTO utensils (id, user_id, household_id, name, category, available) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('shared-utensil', owner.id, 'only-house', 'Olla', 'cookware', 1);

    const response = await call(owner, 'DELETE', '/leave');

    expect(response.status).toBe(200);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM households WHERE id = ?').get('only-house')
    ).toEqual({
      count: 0
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM ingredients WHERE id = ?').get('shared-ingredient')
    ).toEqual({
      count: 0
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM utensils WHERE id = ?').get('shared-utensil')
    ).toEqual({
      count: 0
    });
    expect(
      db.prepare('SELECT household_id FROM ingredients WHERE id = ?').get('personal-ingredient')
    ).toEqual({
      household_id: null
    });
    expect(
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(owner.id) as {
          household_id: string | null;
        }
      ).household_id
    ).toBeNull();
  });
});
