import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

/**
 * La BD cambio de nombre con la marca (recipeapp.db -> hogaria.sqlite) y la
 * adopcion del fichero heredado es lo unico que separa un despliegue que
 * sobrevive al de uno que empieza de cero. Son pruebas de sistema de ficheros
 * sobre un tmpdir, no de negocio: lo que se exige es que nunca se pierda ni se
 * pise un byte.
 */

type DbModule = typeof import('./database.js');

let dir: string;
let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hogaria-db-'));
  saved = { ...process.env };
});

afterEach(() => {
  vi.resetModules();
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

/** El modulo de config lee DATABASE_PATH al importarse: hay que aislarlo. */
async function dbModuleWith(databasePath: string): Promise<DbModule> {
  vi.resetModules();
  process.env.DATABASE_PATH = databasePath;
  process.env.NODE_ENV = 'test';
  return import('./database.js');
}

const target = () => join(dir, 'hogaria.sqlite');

describe('adoptLegacyDatabase', () => {
  it('no hace nada donde no hay nada que adoptar', async () => {
    const { adoptLegacyDatabase } = await dbModuleWith(':memory:');

    expect(adoptLegacyDatabase(target())).toBeNull();
    expect(existsSync(target())).toBe(false);
  });

  it('adopta la recipeapp.db y se lleva el WAL y el SHM consigo', async () => {
    const legacy = join(dir, 'recipeapp.db');
    const handle = new Database(legacy);
    handle.pragma('journal_mode = WAL');
    handle.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('sigue aqui')");
    handle.close();
    writeFileSync(`${legacy}-wal`, 'wal-sucio');
    writeFileSync(`${legacy}-shm`, 'shm-sucio');

    const { adoptLegacyDatabase } = await dbModuleWith(':memory:');

    expect(adoptLegacyDatabase(target())).toBe(legacy);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(`${legacy}-wal`)).toBe(false);
    expect(existsSync(`${legacy}-shm`)).toBe(false);
    expect(readFileSync(`${target()}-wal`, 'utf8')).toBe('wal-sucio');
    expect(readFileSync(`${target()}-shm`, 'utf8')).toBe('shm-sucio');

    const opened = new Database(target());
    expect(opened.prepare('SELECT v FROM t').get()).toEqual({ v: 'sigue aqui' });
    opened.close();
  });

  it('prefiere la recipeapp.db cuando las dos heredadas estan ahi', async () => {
    writeFileSync(join(dir, 'recipeapp.db'), 'esta-gano');
    writeFileSync(join(dir, 'mi-cocinai.db'), 'esta-perdio');

    const { adoptLegacyDatabase } = await dbModuleWith(':memory:');

    expect(adoptLegacyDatabase(target())).toBe(join(dir, 'recipeapp.db'));
    expect(readFileSync(target(), 'utf8')).toBe('esta-gano');
    // La otra no se toca: no es nuestra, y borrar datos ajenos no es parte de un renombre.
    expect(readFileSync(join(dir, 'mi-cocinai.db'), 'utf8')).toBe('esta-perdio');
  });

  it('nunca pisa una base de datos que ya existe', async () => {
    writeFileSync(target(), 'nueva');
    writeFileSync(join(dir, 'recipeapp.db'), 'vieja');

    const { adoptLegacyDatabase } = await dbModuleWith(':memory:');

    expect(adoptLegacyDatabase(target())).toBeNull();
    expect(readFileSync(target(), 'utf8')).toBe('nueva');
    expect(readFileSync(join(dir, 'recipeapp.db'), 'utf8')).toBe('vieja');
  });

  it('una BD en memoria o una URI no tienen de que heredar', async () => {
    const { adoptLegacyDatabase } = await dbModuleWith(':memory:');

    writeFileSync(join(dir, 'recipeapp.db'), 'vieja');
    expect(adoptLegacyDatabase(':memory:')).toBeNull();
    expect(adoptLegacyDatabase('file:./data/hogaria.sqlite?mode=memory')).toBeNull();
    expect(readFileSync(join(dir, 'recipeapp.db'), 'utf8')).toBe('vieja');
  });
});

describe('initializeDatabase con fichero heredado', () => {
  it('añade claves idempotentes a meals legacy conservando la comida y crea las asignaciones aditivas', async () => {
    const databaseFile = target();
    const previous = new Database(databaseFile);
    previous.exec(`
      CREATE TABLE meals (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL,
        date DATE NOT NULL,
        meal_type TEXT NOT NULL,
        recipe_id TEXT,
        custom_meal TEXT,
        time TEXT,
        servings INTEGER DEFAULT 1,
        notes TEXT,
        completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO meals (id, calendar_id, date, meal_type, custom_meal, servings, notes)
      VALUES ('legacy-meal', 'legacy-calendar', '2026-10-14', 'dinner', 'Comida heredada', 3, 'nota antigua');
    `);
    previous.close();

    const mod = await dbModuleWith(databaseFile);
    let restarted: DbModule | undefined;
    try {
      await mod.initializeDatabase();
      const db = mod.getDatabase();
      expect(
        db
          .prepare(
            'SELECT id, custom_meal, servings, notes, source_proposal_id, proposal_id, recipe_snapshot FROM meals WHERE id = ?'
          )
          .get('legacy-meal')
      ).toEqual({
        id: 'legacy-meal',
        custom_meal: 'Comida heredada',
        servings: 3,
        notes: 'nota antigua',
        source_proposal_id: null,
        proposal_id: null,
        recipe_snapshot: null
      });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meal_participants'"
          )
          .get()
      ).toEqual({ name: 'meal_participants' });
      const mealIndexes = db.prepare("PRAGMA index_list('meals')").all() as Array<{
        name: string;
        unique: number;
      }>;
      expect(mealIndexes.find(({ name }) => name === 'idx_meals_source_proposal')?.unique).toBe(1);
      expect(mealIndexes.find(({ name }) => name === 'idx_meals_proposal_group')?.unique).toBe(0);

      mod.closeDatabase();
      restarted = await dbModuleWith(databaseFile);
      await restarted.initializeDatabase();
      expect(
        restarted
          .getDatabase()
          .prepare(
            'SELECT id, source_proposal_id, proposal_id, recipe_snapshot FROM meals WHERE id = ?'
          )
          .get('legacy-meal')
      ).toEqual({
        id: 'legacy-meal',
        source_proposal_id: null,
        proposal_id: null,
        recipe_snapshot: null
      });
    } finally {
      restarted?.closeDatabase();
      mod.closeDatabase();
    }
  });

  it('añade metadatos del libro a recetas legacy sin alterar su contenido', async () => {
    const databaseFile = target();
    const previous = new Database(databaseFile);
    previous.exec(`
      CREATE TABLE recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        difficulty TEXT DEFAULT 'medium',
        cuisine TEXT,
        author_id TEXT,
        is_public INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO recipes (id, name, cuisine, author_id)
      VALUES ('legacy-recipe', 'Receta heredada', 'regional', 'old-owner');
    `);
    previous.close();

    const mod = await dbModuleWith(databaseFile);
    try {
      await mod.initializeDatabase();
      const recipe = mod
        .getDatabase()
        .prepare(
          'SELECT id, name, cuisine, country_code, catalog_key, source_attribution, recipe_guidance, image_attribution FROM recipes WHERE id = ?'
        )
        .get('legacy-recipe');
      const columns = mod.getDatabase().prepare('PRAGMA table_info(recipes)').all() as {
        name: string;
      }[];

      expect(recipe).toEqual({
        id: 'legacy-recipe',
        name: 'Receta heredada',
        cuisine: 'regional',
        country_code: null,
        catalog_key: null,
        source_attribution: null,
        recipe_guidance: null,
        image_attribution: null
      });
      expect(columns.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'country_code',
          'catalog_key',
          'source_attribution',
          'recipe_guidance',
          'image_attribution'
        ])
      );
      expect(
        mod
          .getDatabase()
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recipe_image_assets'"
          )
          .get()
      ).toEqual({ name: 'recipe_image_assets' });
    } finally {
      mod.closeDatabase();
    }
    // La inicializacion ejecuta muchas migraciones historicas y puede superar el
    // timeout por defecto mientras corre el resto de la suite en paralelo.
  }, 30_000);

  it('anade purchase_date a recibos antiguos sin inventar una fecha de compra', async () => {
    const databaseFile = target();
    const previous = new Database(databaseFile);
    previous.exec(`
      CREATE TABLE receipts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        store TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO receipts (id, user_id, store, created_at)
      VALUES ('old-receipt', 'synthetic-user', 'Tienda antigua', '2024-02-29 12:30:00');
    `);
    previous.close();

    const mod = await dbModuleWith(databaseFile);
    try {
      await mod.initializeDatabase();

      const receipt = mod
        .getDatabase()
        .prepare(
          'SELECT id, store, created_at, purchase_date, store_manual, purchase_date_manual, ai_output_language FROM receipts WHERE id = ?'
        )
        .get('old-receipt');
      expect(receipt).toEqual({
        id: 'old-receipt',
        store: 'Tienda antigua',
        created_at: '2024-02-29 12:30:00',
        purchase_date: null,
        store_manual: 0,
        purchase_date_manual: 0,
        ai_output_language: 'es'
      });
    } finally {
      mod.closeDatabase();
    }
  });

  it('renombra antes de abrir y migra la adoptada, sin perder filas', async () => {
    const legacy = join(dir, 'recipeapp.db');
    const handle = new Database(legacy);
    handle.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('de la version anterior')");
    handle.close();

    const mod = await dbModuleWith(target());
    await mod.initializeDatabase();

    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(target())).toBe(true);

    const db = mod.getDatabase();
    expect(db.prepare('SELECT v FROM t').get()).toEqual({ v: 'de la version anterior' });
    // Las tablas de la app se crean encima de la heredada (CREATE TABLE IF NOT EXISTS).
    expect(db.prepare('SELECT COUNT(*) as c FROM users').get()).toEqual({ c: 0 });

    mod.closeDatabase();
  });

  it('deja de llamarse recipeapp y se cierra sin dejar el handle abierto', async () => {
    const mod = await dbModuleWith(target());
    await mod.initializeDatabase();

    expect(existsSync(target())).toBe(true);
    expect(existsSync(join(dir, 'recipeapp.db'))).toBe(false);

    mod.closeDatabase();
    expect(() => mod.getDatabase().prepare('SELECT 1').get()).toThrow();
  });

  it('elige al admin elegible más antiguo en hogares legacy de forma estable e idempotente', async () => {
    const databaseFile = target();
    const previous = new Database(databaseFile);
    previous.exec(`
      CREATE TABLE households (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        invite_code TEXT UNIQUE NOT NULL,
        shared_pantry INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        avatar TEXT,
        household_id TEXT,
        cooking_level TEXT DEFAULT 'beginner',
        preferences TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE household_members (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(household_id, user_id)
      );
      CREATE TABLE ai_configs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        provider TEXT,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        model TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE ai_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'receipt',
        status TEXT NOT NULL DEFAULT 'queued',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO households (id, name, invite_code) VALUES
        ('legacy-house', 'Hogar antiguo', 'LEGACY01'),
        ('copy-house', 'Segunda casa del admin', 'COPY0001'),
        ('empty-admin-house', 'Sin administrador', 'NOADMIN1');
      INSERT INTO users (id, email, name, password_hash, household_id) VALUES
        ('member-first', 'member-first@test.invalid', 'Member', '', 'legacy-house'),
        ('admin-z', 'admin-z@test.invalid', 'Admin Z', '', 'legacy-house'),
        ('admin-a', 'admin-a@test.invalid', 'Admin A', '', 'legacy-house'),
        ('admin-newer', 'admin-newer@test.invalid', 'Admin newer', '', 'legacy-house'),
        ('only-member', 'only-member@test.invalid', 'Only member', '', 'empty-admin-house');
      UPDATE users SET preferences = '{"mealTimes":{"dinner":"19:00"},"mealPlan":{"dinner":false}}'
        WHERE id = 'member-first';
      INSERT INTO household_members (id, household_id, user_id, role, joined_at) VALUES
        ('member-row', 'legacy-house', 'member-first', 'member', '2019-01-01 00:00:00'),
        ('admin-z-row', 'legacy-house', 'admin-z', 'admin', '2020-01-01 00:00:00'),
        ('admin-a-row', 'legacy-house', 'admin-a', 'admin', '2020-01-01 00:00:00'),
        ('admin-newer-row', 'legacy-house', 'admin-newer', 'admin', '2021-01-01 00:00:00'),
        ('admin-a-copy-row', 'copy-house', 'admin-a', 'admin', '2022-01-01 00:00:00'),
        ('only-member-row', 'empty-admin-house', 'only-member', 'member', '2018-01-01 00:00:00');
      INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, is_active)
        VALUES ('historic-config', 'admin-a', 'Existing config', 'custom', 'http://127.0.0.1', 'synthetic-key', 'test-model', 1),
               ('historic-alt', 'admin-a', 'Personal alternative', 'custom', 'http://127.0.0.2', 'other-key', 'other-model', 0);
      INSERT INTO ai_jobs (id, user_id, kind, status, created_at)
        VALUES ('historic-job', 'member-first', 'custom', 'done', '2020-02-03 04:05:06');
    `);
    previous.close();

    const mod = await dbModuleWith(databaseFile);
    let restarted: DbModule | undefined;
    try {
      await mod.initializeDatabase();
      const db = mod.getDatabase();
      expect(
        db.prepare('SELECT ai_owner_user_id FROM households WHERE id = ?').get('legacy-house')
      ).toEqual({ ai_owner_user_id: 'admin-a' });
      expect(
        db.prepare('SELECT ai_owner_user_id FROM households WHERE id = ?').get('empty-admin-house')
      ).toEqual({ ai_owner_user_id: null });
      expect(
        db
          .prepare('SELECT MIN(is_active) AS min, MAX(is_active) AS max FROM household_members')
          .get()
      ).toEqual({ min: 1, max: 1 });
      expect(
        db
          .prepare(
            `SELECT h.meal_planning_preferences AS household_preferences,
                    hm.meal_planning_preferences AS member_preferences
               FROM households h
               JOIN household_members hm ON hm.household_id = h.id
              WHERE h.id = 'legacy-house' AND hm.user_id = 'member-first'`
          )
          .get()
      ).toEqual({ household_preferences: '{}', member_preferences: '{}' });
      db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
        '{"objective":{"goals":["variety"]}}',
        'legacy-house'
      );
      db.prepare(
        'UPDATE household_members SET meal_planning_preferences = ? WHERE user_id = ?'
      ).run('{"goalOverrideEnabled":true}', 'member-first');

      const configsBeforeRestart = db
        .prepare(
          'SELECT id, user_id, household_id, name, api_key, model, is_active FROM ai_configs ORDER BY id'
        )
        .all();
      const jobsBeforeRestart = db
        .prepare('SELECT id, user_id, kind, status, created_at FROM ai_jobs ORDER BY id')
        .all();
      expect(
        (configsBeforeRestart as Array<Record<string, unknown>>).filter(
          (row) => row.household_id === null
        )
      ).toEqual([
        {
          id: 'historic-alt',
          user_id: 'admin-a',
          household_id: null,
          name: 'Personal alternative',
          api_key: 'other-key',
          model: 'other-model',
          is_active: 0
        },
        {
          id: 'historic-config',
          user_id: 'admin-a',
          household_id: null,
          name: 'Existing config',
          api_key: 'synthetic-key',
          model: 'test-model',
          is_active: 1
        }
      ]);
      const homeCopies = (configsBeforeRestart as Array<Record<string, unknown>>).filter(
        (row) => row.household_id !== null
      );
      expect(homeCopies).toHaveLength(2);
      expect(new Set(homeCopies.map((row) => row.id)).size).toBe(2);
      expect(homeCopies.map((row) => row.household_id).sort()).toEqual([
        'copy-house',
        'legacy-house'
      ]);
      for (const copy of homeCopies) {
        expect(copy).toMatchObject({
          user_id: 'admin-a',
          name: 'Existing config',
          api_key: 'synthetic-key',
          model: 'test-model',
          is_active: 1
        });
        expect(copy.id).not.toBe('historic-config');
      }
      expect(
        db
          .prepare('SELECT COUNT(*) AS n FROM ai_configs WHERE household_id = ?')
          .get('empty-admin-house')
      ).toEqual({ n: 0 });
      expect(jobsBeforeRestart).toEqual([
        {
          id: 'historic-job',
          user_id: 'member-first',
          kind: 'custom',
          status: 'done',
          created_at: '2020-02-03 04:05:06'
        }
      ]);

      mod.closeDatabase();
      restarted = await dbModuleWith(databaseFile);
      await restarted.initializeDatabase();
      const restartedDb = restarted.getDatabase();
      expect(
        restartedDb.prepare('SELECT id, ai_owner_user_id FROM households ORDER BY id').all()
      ).toEqual([
        { id: 'copy-house', ai_owner_user_id: 'admin-a' },
        { id: 'empty-admin-house', ai_owner_user_id: null },
        { id: 'legacy-house', ai_owner_user_id: 'admin-a' }
      ]);
      expect(
        restartedDb
          .prepare(
            `SELECT h.meal_planning_preferences AS household_preferences,
                    hm.meal_planning_preferences AS member_preferences
               FROM households h
               JOIN household_members hm ON hm.household_id = h.id
              WHERE h.id = 'legacy-house' AND hm.user_id = 'member-first'`
          )
          .get()
      ).toEqual({
        household_preferences: '{"objective":{"goals":["variety"]}}',
        member_preferences: '{"goalOverrideEnabled":true}'
      });
      expect(
        restartedDb.prepare('SELECT preferences FROM users WHERE id = ?').get('member-first')
      ).toEqual({
        preferences: '{"mealTimes":{"dinner":"19:00"},"mealPlan":{"dinner":false}}'
      });
      expect(
        restartedDb
          .prepare('SELECT MIN(is_active) AS min, MAX(is_active) AS max FROM household_members')
          .get()
      ).toEqual({ min: 1, max: 1 });
      expect(
        restartedDb
          .prepare(
            'SELECT id, user_id, household_id, name, api_key, model, is_active FROM ai_configs ORDER BY id'
          )
          .all()
      ).toEqual(configsBeforeRestart);
      expect(
        restartedDb
          .prepare('SELECT id, user_id, kind, status, created_at FROM ai_jobs ORDER BY id')
          .all()
      ).toEqual(jobsBeforeRestart);
    } finally {
      restarted?.closeDatabase();
      mod.closeDatabase();
    }
  });

  it('añade recurrence_rule a una tabla legacy conservando la fila, recurrencia y excepciones', async () => {
    const databaseFile = target();
    const previous = new Database(databaseFile);
    previous.exec(`
      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY,
        household_id TEXT,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other',
        date DATE NOT NULL,
        start_time TEXT,
        end_time TEXT,
        all_day INTEGER NOT NULL DEFAULT 0,
        color TEXT,
        notes TEXT,
        location TEXT,
        recurrence TEXT NOT NULL DEFAULT 'none',
        exceptions TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'user',
        source_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO calendar_events (id, user_id, title, kind, date, recurrence, exceptions)
      VALUES ('legacy-series', 'synthetic-user', 'Legacy event', 'home', '2026-03-05', 'weekly', '["2026-03-12"]');
    `);
    previous.close();

    const mod = await dbModuleWith(databaseFile);
    let restarted: DbModule | undefined;
    try {
      await mod.initializeDatabase();
      const db = mod.getDatabase();
      const columns = db.prepare('PRAGMA table_info(calendar_events)').all() as { name: string }[];
      expect(columns.some((column) => column.name === 'recurrence_rule')).toBe(true);
      expect(
        db
          .prepare(
            'SELECT id, recurrence, recurrence_rule, exceptions FROM calendar_events WHERE id = ?'
          )
          .get('legacy-series')
      ).toEqual({
        id: 'legacy-series',
        recurrence: 'weekly',
        recurrence_rule: null,
        exceptions: '["2026-03-12"]'
      });

      mod.closeDatabase();
      restarted = await dbModuleWith(databaseFile);
      await restarted.initializeDatabase();
      expect(
        restarted
          .getDatabase()
          .prepare(
            'SELECT id, recurrence, recurrence_rule, exceptions FROM calendar_events WHERE id = ?'
          )
          .get('legacy-series')
      ).toEqual({
        id: 'legacy-series',
        recurrence: 'weekly',
        recurrence_rule: null,
        exceptions: '["2026-03-12"]'
      });
    } finally {
      restarted?.closeDatabase();
      mod.closeDatabase();
    }
  });
});
