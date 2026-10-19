import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * El catalogo de partida (utensilios que marcar + ingredientes de sugerencia)
 * tiene dos ambitos: el hogar y, para quien no tiene uno, la propia cuenta.
 * Estos tests cubren que nunca se duplique al pasar de uno a otro.
 */

// DATABASE_PATH se lee al importar la config, asi que el resto de modulos se
// importan de forma dinamica (con el path ya fijado) para usar una BD en RAM.
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;
type Seeds = typeof import('./seed-data.js');

let db: SqliteDb;
let seeds: Seeds;
let closeDatabase: () => void;

const count = (sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...(params as never[])) as { c: number }).c;

function createUser(email: string): string {
  const id = `u-${email.split('@')[0]}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    'Tester',
    'hash'
  );
  return id;
}

/** Replica lo que hace POST /api/household (miembro admin + users.household_id). */
function createHousehold(slug: string, ownerId: string): string {
  const id = `h-${slug}`;
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    id,
    `Hogar ${slug}`,
    `code-${slug}`
  );
  db.prepare(
    'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
  ).run(`m-${slug}`, id, ownerId, 'admin');
  db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(id, ownerId);
  return id;
}

function joinHousehold(slug: string, householdId: string, userId: string): void {
  db.prepare(
    'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
  ).run(`m-${slug}`, householdId, userId, 'member');
  db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, userId);
}

const personalUtensils = (userId: string) =>
  count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ? AND household_id IS NULL', userId);

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  seeds = await import('./seed-data.js');
});

afterAll(() => closeDatabase?.());

describe('seedDefaultsForUser (cuentas sin hogar)', () => {
  it('siembra el catálogo personal de utensilios y sugerencias', () => {
    const user = createUser('solo@test');
    seeds.seedDefaultsForUser(db, user);

    const utensils = count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ?', user);
    const ingredients = count('SELECT COUNT(*) as c FROM ingredients WHERE user_id = ?', user);

    // El catalogo completo (~54 utensilios y ~68 sugerencias), todo sin marcar
    expect(utensils).toBeGreaterThan(50);
    expect(ingredients).toBeGreaterThan(50);
    expect(
      count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ? AND available = 1', user)
    ).toBe(0);
    // Cantidad 0: son sugerencias, no inventario
    expect(
      count('SELECT COUNT(*) as c FROM ingredients WHERE user_id = ? AND quantity > 0', user)
    ).toBe(0);
    // Y personal: household_id NULL
    expect(personalUtensils(user)).toBe(utensils);
  });

  it('es idempotente (no duplica al relanzarse en cada arranque)', () => {
    const user = createUser('reload@test');
    seeds.seedDefaultsForUser(db, user);
    const before = count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ?', user);

    seeds.seedDefaultsForUser(db, user);
    seeds.backfillUserSeeds(db);

    expect(count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ?', user)).toBe(before);
  });

  it('no siembra en paralelo a un hogar: con hogar el catálogo es del hogar', () => {
    const user = createUser('conhogar@test');
    const household = createHousehold('hogar-conhogar', user);
    seeds.seedDefaultsForHousehold(db, household, user);

    seeds.seedDefaultsForUser(db, user);

    expect(personalUtensils(user)).toBe(0);
    expect(
      count('SELECT COUNT(*) as c FROM utensils WHERE household_id = ?', household)
    ).toBeGreaterThan(50);
  });
});

describe('backfills de arranque (idempotencia sobre datos heredados)', () => {
  it('siembra a los usuarios sin hogar y lo loguea solo si hay algo que sembrar', () => {
    const userId = createUser('backfill-user@test.local');
    expect(count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ?', userId)).toBe(0);

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });

    seeds.backfillUserSeeds(db);
    const seeded = count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ?', userId);
    expect(seeded).toBeGreaterThan(0);
    expect(logs.join('\n')).toContain('Seed backfill usuarios sin hogar');

    // Segunda pasada: no duplica y ya no hay nada que contar (no loguea).
    logs.length = 0;
    seeds.backfillUserSeeds(db);
    expect(count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ?', userId)).toBe(seeded);
    expect(logs).toEqual([]);

    spy.mockRestore();
  });

  it('un hogar sin miembros no se siembra (nadie de quien heredar el catalogo)', () => {
    const orphanId = 'h-sin-miembros';
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      orphanId,
      'Hogar huerfano',
      'code-orphan'
    );

    expect(() => seeds.backfillHouseholdSeeds(db)).not.toThrow();
    expect(count('SELECT COUNT(*) as c FROM utensils WHERE household_id = ?', orphanId)).toBe(0);
  });

  it('siembra al owner de un hogar vacío y no toca a quien ya tiene catalogo', () => {
    const owner = createUser('backfill-owner@test.local');
    const householdId = createHousehold('backfill-hogar', owner);
    const seededUtensils = count(
      'SELECT COUNT(*) as c FROM utensils WHERE household_id = ?',
      householdId
    );
    expect(seededUtensils).toBe(0);

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logs.push(String(msg));
    });

    seeds.backfillHouseholdSeeds(db);

    expect(count('SELECT COUNT(*) as c FROM utensils WHERE household_id = ?', householdId)).toBeGreaterThan(0);
    expect(logs.join('\n')).toContain('Seed backfill hogar');

    // Idempotente: la segunda pasada no anade ni una fila.
    const before = count('SELECT COUNT(*) as c FROM utensils WHERE household_id = ?', householdId);
    seeds.backfillHouseholdSeeds(db);
    expect(count('SELECT COUNT(*) as c FROM utensils WHERE household_id = ?', householdId)).toBe(before);

    spy.mockRestore();
  });
});

describe('adoptPersonalRowsIntoHousehold (de personal a compartido)', () => {
  it('mueve el catálogo al crear el hogar: ni un duplicado y las marcas se conservan', () => {
    const user = createUser('muda@test');
    seeds.seedDefaultsForUser(db, user);

    const marked = db
      .prepare('SELECT name FROM utensils WHERE user_id = ? ORDER BY name LIMIT 1')
      .get(user) as { name: string };
    db.prepare('UPDATE utensils SET available = 1 WHERE user_id = ? AND name = ?').run(
      user,
      marked.name
    );
    db.prepare(
      'UPDATE ingredients SET quantity = 500 WHERE user_id = ? AND rowid = (SELECT MIN(rowid) FROM ingredients WHERE user_id = ?)'
    ).run(user, user);

    const utensilsBefore = count('SELECT COUNT(*) as c FROM utensils WHERE user_id = ?', user);
    const household = createHousehold('hogar-muda', user);

    seeds.adoptPersonalRowsIntoHousehold(db, household, user);
    seeds.seedDefaultsForHousehold(db, household, user);

    expect(count('SELECT COUNT(*) as c FROM utensils WHERE household_id = ?', household)).toBe(
      utensilsBefore
    );
    expect(personalUtensils(user)).toBe(0);
    expect(
      count(
        'SELECT COUNT(*) as c FROM utensils WHERE household_id = ? AND available = 1',
        household
      )
    ).toBe(1);
    expect(
      count(
        'SELECT COUNT(*) as c FROM ingredients WHERE household_id = ? AND quantity > 0',
        household
      )
    ).toBe(1);
  });

  it('al unirse a un hogar con catálogo no se duplica y el stock personal se suma', () => {
    const owner = createUser('owner@test');
    const ownerHousehold = createHousehold('hogar-owner', owner);
    seeds.seedDefaultsForUser(db, owner);
    seeds.adoptPersonalRowsIntoHousehold(db, ownerHousehold, owner);
    seeds.seedDefaultsForHousehold(db, ownerHousehold, owner);

    const guest = createUser('guest@test');
    seeds.seedDefaultsForUser(db, guest);

    // El invitado ya había marcado algo y tiene un utensilio propio y stock
    const shared = db
      .prepare('SELECT name, category FROM utensils WHERE user_id = ? ORDER BY name LIMIT 1')
      .get(guest) as { name: string; category: string };
    db.prepare('UPDATE utensils SET available = 1 WHERE user_id = ? AND name = ?').run(
      guest,
      shared.name
    );
    db.prepare(
      `
      INSERT INTO utensils (id, user_id, name, category, available)
      VALUES ('u-guest-sousvide', ?, 'Sous vide del invitado', 'tools', 1)
    `
    ).run(guest);
    db.prepare('UPDATE ingredients SET quantity = 250 WHERE user_id = ? AND name = ?').run(
      guest,
      'Patatas'
    );

    const householdUtensils = count(
      'SELECT COUNT(*) as c FROM utensils WHERE household_id = ?',
      ownerHousehold
    );

    joinHousehold('hogar-owner-guest', ownerHousehold, guest);
    seeds.adoptPersonalRowsIntoHousehold(db, ownerHousehold, guest);
    seeds.seedDefaultsForHousehold(db, ownerHousehold, guest);

    // El catalogo del hogar no se duplica: solo entra su utensilio personalizado
    expect(count('SELECT COUNT(*) as c FROM utensils WHERE household_id = ?', ownerHousehold)).toBe(
      householdUtensils + 1
    );
    expect(personalUtensils(guest)).toBe(0);

    // Su utensilio personalizado se reubica en el hogar en vez de perderse
    const relocated = db
      .prepare('SELECT household_id FROM utensils WHERE id = ?')
      .get('u-guest-sousvide') as { household_id: string };
    expect(relocated.household_id).toBe(ownerHousehold);

    // Su marca pasa al utensilio compartido del hogar
    expect(
      count(
        'SELECT COUNT(*) as c FROM utensils WHERE household_id = ? AND name = ? AND available = 1',
        ownerHousehold,
        shared.name
      )
    ).toBe(1);

    // Y su stock, sumado a la fila compartida (no le sustituye la fila del hogar)
    const patatas = db
      .prepare(
        'SELECT COUNT(*) as n, COALESCE(SUM(quantity), 0) as q FROM ingredients WHERE household_id = ? AND name = ?'
      )
      .get(ownerHousehold, 'Patatas') as { n: number; q: number };
    expect(patatas.n).toBe(1);
    expect(patatas.q).toBe(250);
  });
});
