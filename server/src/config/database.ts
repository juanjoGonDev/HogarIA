import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from './app.config.js';
import * as schema from '../models/schema.js';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import {
  backfillHouseholdSeeds,
  backfillUserSeeds,
  asegurarPadreAlimentosTodas
} from '../utils/seed-data.js';
import { ensureRecipeBookCatalog } from '../utils/recipe-book-seed.js';
import { backfillHouseholdAiConfigs } from '../utils/household-ai-config.js';

let db: Database.Database;
let drizzleDb: ReturnType<typeof drizzle>;

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export function getDrizzle() {
  if (!drizzleDb) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return drizzleDb;
}

/**
 * Los nombres bajo los que esta BD existio en instalaciones desplegadas. Se
 * prueban en este orden: el primero es el que dejo la ultima version publicada.
 */
export const LEGACY_DB_FILENAMES = ['recipeapp.db', 'mi-cocinai.db'];

/**
 * HogarIA nace del renombre de la app y la BD se llama ahora `hogaria.sqlite`.
 * Aqui no se documenta «borra tus datos y vuelve a empezar»: se renombra el
 * fichero antes de abrirlo, asi que una Raspberry con dos anos de hogares
 * actualiza y sigue funcionando.
 *
 * Reglas duras: nunca se pisa un fichero que ya existe (si alguien creo la BD
 * nueva, se deja la nueva y no se toca nada) y se mueven juntos `-wal`/`-shm`,
 * porque un WAL huerfano corromperia el arranque. Devuelve la ruta de la que se
 * vino, o null si no habia nada que adoptar.
 */
export function adoptLegacyDatabase(target: string): string | null {
  // Una BD en RAM o una URI de better-sqlite3 no tienen directorio del que heredar.
  if (target === ':memory:' || target.startsWith('file:')) return null;
  if (existsSync(target)) return null;

  const dir = dirname(target);
  for (const legacy of LEGACY_DB_FILENAMES) {
    const source = join(dir, legacy);
    if (source === target || !existsSync(source)) continue;

    renameSync(source, target);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(source + suffix)) renameSync(source + suffix, target + suffix);
    }
    return source;
  }
  return null;
}

export async function initializeDatabase(): Promise<void> {
  // Ensure data directory exists
  const dbDir = dirname(config.database.path);
  mkdirSync(dbDir, { recursive: true });

  const adoptedFrom = adoptLegacyDatabase(config.database.path);
  if (adoptedFrom) {
    console.log(`[DB] Base de datos heredada adoptada: ${adoptedFrom} -> ${config.database.path}`);
  }

  // Create SQLite database
  db = new Database(config.database.path, {
    verbose: config.server.env === 'development' ? console.log : undefined
  });

  // Configure SQLite for low memory usage
  db.pragma('journal_mode = WAL');
  db.pragma(`cache_size = ${config.database.cacheSize}`);
  db.pragma('temp_store = MEMORY');
  db.pragma('synchronous = NORMAL');
  db.pragma('mmap_size = 67108864'); // 64MB
  db.pragma('page_size = 4096');
  db.pragma('foreign_keys = ON');

  // Initialize Drizzle ORM
  drizzleDb = drizzle(db, { schema });

  // Run migrations
  await runMigrations(db);

  console.log('Database configured with WAL mode and low memory settings');
}

async function runMigrations(db: Database.Database): Promise<void> {
  // Create tables
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar TEXT,
      household_id TEXT,
      cooking_level TEXT DEFAULT 'beginner',
      preferences TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id)
    );

    -- Households table
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      shared_pantry INTEGER DEFAULT 1,
      share_recipes INTEGER DEFAULT 1,
      share_calendar INTEGER DEFAULT 1,
      meal_planning_preferences TEXT NOT NULL DEFAULT '{}',
      ai_owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Household members table
    CREATE TABLE IF NOT EXISTS household_members (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      permissions TEXT DEFAULT '{}',
      meal_planning_preferences TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(household_id, user_id)
    );

    -- A single current plan per household plus an immutable snapshot for each applied version.
    CREATE TABLE IF NOT EXISTS household_plans (
      household_id TEXT PRIMARY KEY NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      plan_json TEXT NOT NULL,
      updated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS household_plan_revisions (
      household_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      plan_json TEXT NOT NULL,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (household_id, version),
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS household_plan_assignments (
      household_id TEXT PRIMARY KEY NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      assignments_json TEXT NOT NULL,
      updated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS household_task_weeks (
      household_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      tasks_json TEXT NOT NULL,
      updated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (household_id, week_start),
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Ingredients (pantry) table
    CREATE TABLE IF NOT EXISTS ingredients (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      expiration_date DATETIME,
      location TEXT DEFAULT 'pantry',
      image TEXT,
      barcode TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (household_id) REFERENCES households(id)
    );

    -- Utensils table
    CREATE TABLE IF NOT EXISTS utensils (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      available INTEGER DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (household_id) REFERENCES households(id)
    );

    -- Recipes table
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      difficulty TEXT DEFAULT 'medium',
      cuisine TEXT,
      meal_type TEXT DEFAULT '[]',
      total_time INTEGER,
      prep_time INTEGER,
      cook_time INTEGER,
      rest_time INTEGER,
      servings INTEGER DEFAULT 2,
      calories REAL,
      image TEXT,
      ingredients TEXT DEFAULT '[]',
      utensils TEXT DEFAULT '[]',
      steps TEXT DEFAULT '[]',
      recipe_guidance TEXT,
      nutrition TEXT,
      storage TEXT,
      author TEXT DEFAULT 'user',
      author_id TEXT,
      rating REAL,
      times_cooked INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      is_favorite INTEGER DEFAULT 0,
      is_public INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    -- Copias locales de fotos públicas seleccionadas desde Commons. Solo se insertan después de
    -- validar autoría/licencia, tipo raster y tamaño en el proveedor; el id es la huella estable.
    CREATE TABLE IF NOT EXISTS recipe_image_assets (
      id TEXT PRIMARY KEY CHECK (length(id) = 24),
      image_data BLOB NOT NULL CHECK (length(image_data) BETWEEN 1 AND 4194304),
      mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
      alt_text TEXT NOT NULL,
      author TEXT NOT NULL,
      license_name TEXT NOT NULL,
      license_url TEXT NOT NULL,
      source_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User recipes (favorites, history)
    CREATE TABLE IF NOT EXISTS user_recipes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
      is_favorite INTEGER DEFAULT 0,
      times_cooked INTEGER DEFAULT 0,
      last_cooked_at DATETIME,
      rating INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id),
      UNIQUE(user_id, recipe_id)
    );

    -- Weekly calendar table
    CREATE TABLE IF NOT EXISTS weekly_calendars (
      id TEXT PRIMARY KEY,
      /* El calendario es de la persona; el hogar se apunta cuando lo hay. No
         puede ser NOT NULL con FK a households: quien se registra sin crear un
         hogar no podría tener ni una sola comida guardada. */
      household_id TEXT,
      user_id TEXT NOT NULL,
      week_start DATE NOT NULL,
      week_end DATE NOT NULL,
      goals TEXT DEFAULT '{}',
      generated_by TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Meals table
    CREATE TABLE IF NOT EXISTS meals (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (calendar_id) REFERENCES weekly_calendars(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    -- Una fila de comida compartida sigue viviendo en meals; esta relacion guarda solo quienes
    -- participan, sin copiar comidas ni exponer los otros calendarios de cada persona.
    CREATE TABLE IF NOT EXISTS meal_participants (
      meal_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (meal_id, user_id),
      FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- One current consumption state per explicitly shared meal; corrections reconcile against
    -- the net deductions below instead of applying the same stock change again on retries.
    CREATE TABLE IF NOT EXISTS meal_consumptions (
      meal_id TEXT PRIMARY KEY NOT NULL,
      household_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('realized', 'not_realized')),
      servings INTEGER NOT NULL CHECK (
        (status = 'realized' AND servings > 0 AND servings <= 100) OR
        (status = 'not_realized' AND servings = 0)
      ),
      version INTEGER NOT NULL CHECK (version >= 1),
      recorded_by TEXT,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      recipe_snapshot_hash TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
    );

    -- Current net stock deduction per immutable recipe-snapshot line; deleted catalog products
    -- leave their historical name/unit and net quantity behind for safe correction warnings.
    CREATE TABLE IF NOT EXISTS meal_consumption_deductions (
      meal_id TEXT NOT NULL,
      line_index INTEGER NOT NULL CHECK (line_index >= 0),
      ingredient_id TEXT,
      ingredient_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      target_quantity REAL NOT NULL CHECK (target_quantity >= 0),
      deducted_quantity REAL NOT NULL CHECK (deducted_quantity >= 0),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (meal_id, line_index),
      FOREIGN KEY (meal_id) REFERENCES meal_consumptions(meal_id) ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE SET NULL
    );

    -- Immutable signed movements provide an audit trail and a uniqueness guard per event-version-line.
    CREATE TABLE IF NOT EXISTS meal_inventory_movements (
      id TEXT PRIMARY KEY,
      meal_id TEXT NOT NULL,
      consumption_version INTEGER NOT NULL CHECK (consumption_version >= 1),
      line_index INTEGER NOT NULL CHECK (line_index >= 0),
      ingredient_id TEXT,
      ingredient_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      delta_quantity REAL NOT NULL CHECK (delta_quantity <> 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meal_id) REFERENCES meals(id) ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_inventory_movement_once
      ON meal_inventory_movements(meal_id, consumption_version, line_index);
    CREATE INDEX IF NOT EXISTS idx_meal_inventory_movements_ingredient
      ON meal_inventory_movements(ingredient_id, created_at);

    -- AI configurations table
    CREATE TABLE IF NOT EXISTS ai_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      name TEXT NOT NULL,
      provider TEXT DEFAULT 'custom',
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER DEFAULT 2000,
      top_p REAL,
      frequency_penalty REAL,
      presence_penalty REAL,
      timeout INTEGER DEFAULT 30000,
      retry_attempts INTEGER DEFAULT 3,
      is_active INTEGER DEFAULT 1,
      last_tested DATETIME,
      test_status TEXT,
      test_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
    );

    -- Create indexes for better performance
    CREATE INDEX IF NOT EXISTS idx_ingredients_user_id ON ingredients(user_id);
    CREATE INDEX IF NOT EXISTS idx_ingredients_household_id ON ingredients(household_id);
    CREATE INDEX IF NOT EXISTS idx_ingredients_expiration ON ingredients(expiration_date);
    CREATE INDEX IF NOT EXISTS idx_recipes_author_id ON recipes(author_id);
    CREATE INDEX IF NOT EXISTS idx_recipes_difficulty ON recipes(difficulty);
    CREATE INDEX IF NOT EXISTS idx_meals_calendar_id ON meals(calendar_id);
    CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);
    CREATE INDEX IF NOT EXISTS idx_user_recipes_user_id ON user_recipes(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_configs_user_id ON ai_configs(user_id);

    -- ═══ Lista de la compra y precios (esqueleto de P2/P3, spec §9) ═══
    -- Dinero en centimos enteros con CHECK >= 0 y cantidades reales > 0: las dos
    -- restricciones que evitan las cestas imposibles. product_key es el nombre
    -- normalizado (ver utils/product-key.ts): cuando llegue el catalogo canónico
    -- se migra a product_aliases sin tocar ninguna observacion.
    -- (Ojo: dentro de este template literal no se pueden usar backticks.)
    CREATE TABLE IF NOT EXISTS shopping_lists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      name TEXT NOT NULL,
      store TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived', 'done')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS shopping_list_items (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      name TEXT NOT NULL,
      product_key TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit TEXT,
      category TEXT,
      -- precio POR UNIDAD en centimos; null = todavia sin dato
      price_minor INTEGER CHECK (price_minor IS NULL OR price_minor >= 0),
      note TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
      -- borrado logico: el «Deshacer» del movil necesita que la fila siga ahi
      deleted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE
    );

    -- Approval idempotency records survive checked-list mutations so an exact retry cannot
    -- recreate a purchased meal-plan item after its original request has already committed.
    CREATE TABLE IF NOT EXISTS household_meal_shopping_approvals (
      household_id TEXT NOT NULL,
      preview_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      list_id TEXT,
      version INTEGER,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (household_id, preview_id, request_hash),
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
      FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE SET NULL
    );

    -- Lo pagado por quantity unidades (un ticket dice eso, no el precio unitario)
    CREATE TABLE IF NOT EXISTS price_observations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      product_key TEXT NOT NULL,
      product_name TEXT NOT NULL,
      store_name TEXT,
      price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
      quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'receipt', 'estimate')),
      observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shopping_lists_user ON shopping_lists(user_id);
    CREATE INDEX IF NOT EXISTS idx_shopping_lists_household ON shopping_lists(household_id);
    CREATE INDEX IF NOT EXISTS idx_shopping_lists_status ON shopping_lists(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_list_items_list ON shopping_list_items(list_id, position);
    CREATE INDEX IF NOT EXISTS idx_list_items_key ON shopping_list_items(product_key);
    CREATE INDEX IF NOT EXISTS idx_price_obs_key ON price_observations(product_key, observed_at);
    CREATE INDEX IF NOT EXISTS idx_price_obs_user ON price_observations(user_id);
    CREATE INDEX IF NOT EXISTS idx_price_obs_household ON price_observations(household_id);
    -- El calendario de la casa, no solo el de las comidas (HOGARIA-SPEC 8f). Las
    -- comidas NO se copian aqui: se proyectan desde la tabla meals al leer, para que el
    -- plan generado siga siendo el dueno de lo que se come y no existan dos verdades.
    -- OJO: sin backticks en este literal (comentan el SQL, y un backtick lo cierra).
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      household_id TEXT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other'
        CHECK (kind IN ('meal', 'shopping', 'home', 'appointment', 'personal', 'other')),
      date DATE NOT NULL,
      start_time TEXT,
      end_time TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      notes TEXT,
      location TEXT,
      -- Cada cuanto se repite la suelta y que dias concretos se quitaron (HOGARIA-SPEC 12t-R). Las
      -- ocurrencias NO se guardan: se materializan al leer, igual que las comidas se proyectan desde
      -- la tabla meals —una fila por dia repetido serian dos verdades sobre el mismo lunes.
      recurrence TEXT NOT NULL DEFAULT 'none'
        CHECK (recurrence IN ('none', 'daily', 'weekly')),
      -- Las reglas avanzadas se guardan como JSON opcional en la misma fila de la serie.
      recurrence_rule TEXT,
      exceptions TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'user',
      source_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date, kind);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_household ON calendar_events(household_id, date);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id, date);
    -- Quien mas esta en la suelta (HOGARIA-SPEC 12o). El autor NO se guarda aqui: es el autor, y
    -- mezclar los dos papeles haria que «salirme del evento» pudiera borrarlo.
    CREATE TABLE IF NOT EXISTS calendar_event_attendees (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (event_id, user_id),
      FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    -- «Mis eventos, incluidos los que me invitaron» se resuelve con este indice: sin el, la
    -- subconsulta de visibilidad seria un escaneo de toda la tabla en cada carga del calendario.
    CREATE INDEX IF NOT EXISTS idx_calendar_attendees_user ON calendar_event_attendees(user_id, event_id);


    -- Secciones de la lista. Son dato y no constante del frontend porque el que tiene
    -- que clasificar una foto es el modelo, y el modelo no puede leer una pantalla
    -- (HOGARIA-SPEC 8f). El color viaja con la fila: se elige, no lo pinta la hoja
    -- de estilos, y «Frutas y verduras» en verde se reconoce en el pasillo sin leer.
    CREATE TABLE IF NOT EXISTS shopping_categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8A8F98',
      position INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL
    );
    -- El catalogo de categorias del inventario (HOGARIA-SPEC ## 12x). key es lo que guardan
    -- ingredients.category y el prompt de la IA; name es solo la etiqueta, y por eso renombrar no reescribe
    -- ninguna fila. parent_key sostiene el arbol (techo de 4 niveles, ver utils/pantry-categories.ts) y
    -- 'other' es la reserva protegida: lo que no encaja cae ahi.
    -- (Sin backticks en este comentario: vive dentro de un template literal de SQL, y el aviso esta escrito
    --  mas abajo con motivo. Romperian el string, no el estilo.)
    CREATE TABLE IF NOT EXISTS pantry_categories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8A8F98',
      description TEXT,
      parent_key TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pantry_categories_user ON pantry_categories(user_id, position);
    CREATE INDEX IF NOT EXISTS idx_pantry_categories_household ON pantry_categories(household_id, position);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pantry_categories_key ON pantry_categories(user_id, key);

    -- La oferta (3x2, 2x1) es de la LINEA porque cambia cuantas unidades se pagan.
    -- Un promo_take >= promo_buy no tiene sentido (pagarias todo), y se ignora en
    -- lugar de guardarse: es un dato de origen, no una decision del usuario.
    -- OJO: dentro de este template literal no pueden aparecer backticks — rompen el
    -- string de SQL (lección ya anotada arriba, y vuelta a caer).
    CREATE INDEX IF NOT EXISTS idx_shopping_categories_user ON shopping_categories(user_id, position);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shopping_categories_key ON shopping_categories(user_id, key);

    -- El descuento es de la LISTA porque cambia cuanto se paga del subtotal, y solo
    -- puede haber uno por lista: dos cupones apilados es una conversacion con la
    -- caja, no un dato que la app pueda resolver por su cuenta.
    -- Auditoria de la cesta: quien ha anadido o tocado que. El nombre va COPIADO en
    -- la fila (no es un JOIN), porque «de quien fue» no cambia si esa persona se
    -- renombra manana.
    CREATE TABLE IF NOT EXISTS shopping_list_events (
      id TEXT PRIMARY KEY,
      list_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      action TEXT NOT NULL,
      item_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_shopping_events_list ON shopping_list_events(list_id, created_at);

    -- ═══ Lectura de tickets por IA (HOGARIA-SPEC ## 12aj) ═══
    -- El ticket sube como imagen o PDF, la IA devuelve la estructura JSON directamente (sin OCR:
    -- el parte dice que lee mal la imagen y no aporta) y cada fila queda escrita AQUI, lista para
    -- que la persona la revise antes de tocar el inventario. 'status' es el pipeline:
    -- queued (en la cola) -> analyzing (el modelo esta leyendo) -> review (a revisar) ->
    -- confirmed (ya esta en el inventario) | failed | stopped.
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'analyzing', 'review', 'confirmed', 'failed', 'stopped')),
      store TEXT,
      store_manual INTEGER NOT NULL DEFAULT 0,
      ai_output_language TEXT NOT NULL DEFAULT 'es' CHECK (ai_output_language IN ('es', 'en')),
      purchase_date TEXT,
      purchase_date_manual INTEGER NOT NULL DEFAULT 0,
      currency TEXT,
      total_minor INTEGER,
      notes TEXT,
      file_url TEXT NOT NULL,
      file_kind TEXT NOT NULL CHECK (file_kind IN ('png', 'jpeg', 'webp', 'pdf')),
      file_name TEXT,
      file_bytes INTEGER,
      error_code TEXT,
      error_detail TEXT,
      warnings TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      confirmed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id, created_at);

    -- Una linea del ticket: todo editable durante la revision (nombre, cantidad, unidad,
    -- categoria de la despensa, precio, oferta, nota). 'category' es una clave del catalogo de
    -- la casa —lo que el «inventario.json» del prompt ensena al modelo— y no la seccion del carrito.
    CREATE TABLE IF NOT EXISTS receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
      unit TEXT,
      category TEXT NOT NULL DEFAULT 'other',
      price_minor INTEGER CHECK (price_minor IS NULL OR price_minor >= 0),
      offer_buy INTEGER,
      offer_take INTEGER,
      note TEXT,
      confidence REAL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id, position);

    -- La cola de trabajo de IA (P4 del programa, sin OCR): durable, con intentos y lease, para
    -- que un reinicio del server no se pierda un ticket a medias (el barrido de arranque devuelve
    -- a la cola lo que quedo 'running'). Un trabajo por ticket.
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      kind TEXT NOT NULL DEFAULT 'receipt',
      receipt_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'stopped')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      lease_until DATETIME,
      error_code TEXT,
      error_detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      finished_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL,
      FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_user ON ai_jobs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_pick ON ai_jobs(status, created_at);

    -- Búsquedas asíncronas de fotos para productos del inventario. Los resultados son metadatos
    -- públicos con licencia; las imágenes completas solo se copian localmente cuando alguien elige una.
    CREATE TABLE IF NOT EXISTS product_image_searches (
      ingredient_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      job_id TEXT NOT NULL,
      candidates_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
      error_code TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_image_searches_scope
      ON product_image_searches(user_id, household_id, status);

    -- Las tiendas que la casa conoce: se registran al detectarse en un ticket (o al usarse en
    -- una lista), y son el vocabulario que el «inventario.json» ensena al modelo para que sepa
    -- donde compro. Antes las tiendas solo existian como DISTINCT sobre las listas: detectar una
    -- tienda nueva no podia registrarla porque no habia donde.
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      household_id TEXT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_stores_scope ON stores(user_id, household_id, name);


    CREATE TABLE IF NOT EXISTS shopping_list_discounts (
      list_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('amount', 'percent')),
      value_minor INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
      percent_bps INTEGER CHECK (percent_bps IS NULL OR (percent_bps >= 0 AND percent_bps <= 10000)),
      scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'firstUnits', 'product', 'category')),
      first_units REAL CHECK (first_units IS NULL OR first_units > 0),
      -- Que linea entra con scope 'product' (clave de producto) o 'category' (seccion).
      target TEXT,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE
    );
  `);

  // Auto-migrations: add columns that may be missing in older databases
  const addColumnIfMissing = (table: string, column: string, definition: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] Added ${table}.${column}`);
    }
  };
  addColumnIfMissing(
    'household_members',
    'is_active',
    'INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))'
  );
  // Shared planner defaults and per-membership overrides are JSON blobs. Adding nullable-safe
  // defaults is idempotent and leaves every existing household/member preference untouched.
  addColumnIfMissing('households', 'meal_planning_preferences', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(
    'household_members',
    'meal_planning_preferences',
    "TEXT NOT NULL DEFAULT '{}'"
  );
  addColumnIfMissing('recipes', 'country_code', 'TEXT');
  addColumnIfMissing('recipes', 'catalog_key', 'TEXT');
  addColumnIfMissing('recipes', 'source_attribution', 'TEXT');
  addColumnIfMissing('recipes', 'recipe_guidance', 'TEXT');
  addColumnIfMissing('recipes', 'image_attribution', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_catalog_key
      ON recipes(catalog_key) WHERE catalog_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_recipes_country_code ON recipes(country_code);
  `);
  // El CHECK de `scope` vive dentro de la tabla: una base creada antes de los descuentos
  // por producto rechazaria 'product' con un error de constraint, y ese fallo no se ve
  // hasta que alguien intenta guardarlo. Se reconstruye la tabla si el CHECK es viejo.
  const discountTable = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shopping_list_discounts'`
    )
    .get() as { sql: string | null } | undefined;
  if (discountTable?.sql && !discountTable.sql.includes("'product'")) {
    db.exec(`
      CREATE TABLE shopping_list_discounts_new (
        list_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('amount', 'percent')),
        value_minor INTEGER CHECK (value_minor IS NULL OR value_minor >= 0),
        percent_bps INTEGER CHECK (percent_bps IS NULL OR (percent_bps >= 0 AND percent_bps <= 10000)),
        scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'firstUnits', 'product', 'category')),
        first_units REAL CHECK (first_units IS NULL OR first_units > 0),
        target TEXT,
        label TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE
      );
      INSERT INTO shopping_list_discounts_new
        (list_id, kind, value_minor, percent_bps, scope, first_units, label, created_at, updated_at)
      SELECT list_id, kind, value_minor, percent_bps, scope, first_units, label, created_at, updated_at
      FROM shopping_list_discounts;
      DROP TABLE shopping_list_discounts;
      ALTER TABLE shopping_list_discounts_new RENAME TO shopping_list_discounts;
    `);
  }

  addColumnIfMissing('households', 'share_recipes', 'INTEGER DEFAULT 1');
  addColumnIfMissing('households', 'share_calendar', 'INTEGER DEFAULT 1');
  addColumnIfMissing(
    'households',
    'ai_owner_user_id',
    'TEXT REFERENCES users(id) ON DELETE SET NULL'
  );
  // Los hogares anteriores no persistían al creador. Backfill idempotente: solo hogares aún sin
  // propietario reciben el admin más antiguo; miembros y admins más recientes nunca desplazan
  // una asignación ya guardada. El desempate por user_id hace estable el resultado.
  db.prepare(
    `
    UPDATE households
       SET ai_owner_user_id = (
         SELECT hm.user_id
           FROM household_members hm
          WHERE hm.household_id = households.id AND hm.role = 'admin'
          ORDER BY hm.joined_at ASC, hm.user_id ASC
          LIMIT 1
       )
     WHERE ai_owner_user_id IS NULL
  `
  ).run();
  addColumnIfMissing('receipts', 'store_manual', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(
    'receipts',
    'ai_output_language',
    "TEXT NOT NULL DEFAULT 'es' CHECK (ai_output_language IN ('es', 'en'))"
  );
  addColumnIfMissing('receipts', 'purchase_date', 'TEXT');
  addColumnIfMissing('receipts', 'purchase_date_manual', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('household_members', 'permissions', "TEXT DEFAULT '{}'");
  // Recurrencia de las sueltas (HOGARIA-SPEC 12t-R). En una base con filas no se puede anadir el CHECK
  // —ALTER TABLE no puede restringir lo que ya existe—, asi que en las viejas la cadencia la sujeta
  // el schema de entrada, y la expansion ignora un valor desconocido en vez de romper la lectura.
  addColumnIfMissing('calendar_events', 'recurrence', "TEXT NOT NULL DEFAULT 'none'");
  addColumnIfMissing('calendar_events', 'recurrence_rule', 'TEXT');
  addColumnIfMissing('calendar_events', 'exceptions', "TEXT NOT NULL DEFAULT '[]'");
  // `source_proposal_id` identifica el evento confirmado por el planner: los retries de una misma
  // confirmacion recuperan la fila y nunca crean una copia. Las comidas historicas quedan NULL.
  addColumnIfMissing('meals', 'source_proposal_id', 'TEXT');
  // `proposal_id` identifica el lote confirmado; al reintentar se compara el set completo de
  // eventIds. El snapshot conserva solo la receta pública necesaria para representar el evento.
  addColumnIfMissing('meals', 'proposal_id', 'TEXT');
  addColumnIfMissing('meals', 'recipe_snapshot', 'TEXT');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_meals_source_proposal
      ON meals(source_proposal_id) WHERE source_proposal_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_meals_proposal_group
      ON meals(proposal_id) WHERE proposal_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_meal_participants_user
      ON meal_participants(user_id, meal_id);
  `);
  // Las dianas del descuento: `target` se queda para las filas ya escritas (una sola
  // diana) y `targets` es el JSON con las demas. Reconstruir la tabla para migrar el
  // formato antiguo habria sido una forma cara de perder datos si algo iba mal.
  addColumnIfMissing('shopping_list_discounts', 'targets', 'TEXT');
  // Los alias del producto principal (## 12x): como la casa llama a la cosa. Solo sirven para buscar y para
  // pintar la ficha, nunca para comparar —lo que iguala dos productos sigue siendo `productKeyOf(name)`—, y por
  // eso es una lista en JSON y no una tabla: ninguna consulta necesita una alias suelta. (Mismo acuerdo que
  // `model_params` en `household_ai_config`.)
  addColumnIfMissing('ingredients', 'aliases', "TEXT NOT NULL DEFAULT '[]'");
  // La vida util estimada por la IA (## 12ak), en dias enteros, para productos SIN fecha
  // registrada: lo que la IA dijo para ESTE producto concreto. El catalogo de bolsillo de
  // `caducidades.ts` no se guarda —se consulta—, y la fecha registrada siempre manda.
  addColumnIfMissing('ingredients', 'estimated_shelf_days', 'INTEGER');
  addColumnIfMissing('shopping_list_items', 'promo_buy', 'INTEGER');
  addColumnIfMissing('shopping_list_items', 'promo_take', 'INTEGER');
  // La concurrencia máxima de IA es por configuración (por proveedor): default 0 = ilimitada, y se
  // toca desde el apartado de IA (## 12aj).
  addColumnIfMissing('ai_configs', 'concurrency', 'INTEGER NOT NULL DEFAULT 0');
  // The household is the configuration owner; user_id remains its creator/source for provenance.
  // These additive columns also make the backfill work on older installations with smaller tables.
  addColumnIfMissing(
    'ai_configs',
    'household_id',
    'TEXT REFERENCES households(id) ON DELETE CASCADE'
  );
  addColumnIfMissing('ai_configs', 'provider', "TEXT DEFAULT 'custom'");
  addColumnIfMissing('ai_configs', 'temperature', 'REAL DEFAULT 0.7');
  addColumnIfMissing('ai_configs', 'max_tokens', 'INTEGER DEFAULT 2000');
  addColumnIfMissing('ai_configs', 'top_p', 'REAL');
  addColumnIfMissing('ai_configs', 'frequency_penalty', 'REAL');
  addColumnIfMissing('ai_configs', 'presence_penalty', 'REAL');
  addColumnIfMissing('ai_configs', 'timeout', 'INTEGER DEFAULT 30000');
  addColumnIfMissing('ai_configs', 'retry_attempts', 'INTEGER DEFAULT 3');
  addColumnIfMissing('ai_configs', 'last_tested', 'DATETIME');
  addColumnIfMissing('ai_configs', 'test_status', 'TEXT');
  addColumnIfMissing('ai_configs', 'test_error', 'TEXT');
  addColumnIfMissing('ai_configs', 'created_at', 'DATETIME');
  addColumnIfMissing('ai_configs', 'updated_at', 'DATETIME');
  db.exec(
    'UPDATE ai_configs SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)'
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_configs_household_id ON ai_configs(household_id)');
  addColumnIfMissing('ai_jobs', 'config_id', 'TEXT');
  addColumnIfMissing(
    'ai_jobs',
    'household_id',
    'TEXT REFERENCES households(id) ON DELETE SET NULL'
  );
  addColumnIfMissing('ai_jobs', 'receipt_id', 'TEXT');
  addColumnIfMissing('ai_jobs', 'queue_order', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('ai_jobs', 'claim_generation', 'INTEGER NOT NULL DEFAULT 0');
  // Existing durable receipt jobs get their original home from the receipt itself. Generic jobs
  // remain unscoped because their input only lives in RAM; never infer a home from current selection.
  db.prepare(
    `UPDATE ai_jobs
        SET household_id = (SELECT household_id FROM receipts WHERE receipts.id = ai_jobs.receipt_id)
      WHERE kind = 'receipt' AND receipt_id IS NOT NULL AND household_id IS NULL`
  ).run();
  backfillHouseholdAiConfigs(db);
  // Los trabajos de tickets antiguos no tenían identidad de proveedor. Se fija el config del
  // recibo/hogar original (o personal si no hay casa); no se vuelve a resolver por selección actual.
  db.prepare(
    `
    UPDATE ai_jobs
       SET config_id = (
         SELECT id FROM ai_configs
          WHERE ai_configs.is_active = 1
            AND ((ai_jobs.household_id IS NOT NULL AND ai_configs.household_id = ai_jobs.household_id)
              OR (ai_jobs.household_id IS NULL AND ai_configs.household_id IS NULL
                  AND ai_configs.user_id = ai_jobs.user_id))
          ORDER BY ai_configs.updated_at DESC, ai_configs.id ASC LIMIT 1
       )
     WHERE ai_jobs.kind = 'receipt' AND ai_jobs.config_id IS NULL
       AND ai_jobs.status IN ('queued', 'running')
  `
  ).run();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_provider_queue
      ON ai_jobs(config_id, status, queue_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_provider
      ON ai_jobs(user_id, config_id, status);
  `);
  addColumnIfMissing('shopping_list_items', 'added_by', 'TEXT');
  addColumnIfMissing('shopping_list_items', 'updated_by', 'TEXT');
  addColumnIfMissing('shopping_lists', 'updated_by', 'TEXT');
  // El descuento propio de la linea (§12h). Cuatro columnas y no un JSON: `estimate` las
  // suma todas en una pasada y un JSON tendria que parsearse por fila para calcular dinero.
  addColumnIfMissing('shopping_list_items', 'disc_kind', 'TEXT');
  addColumnIfMissing('shopping_list_items', 'disc_value_minor', 'INTEGER');
  addColumnIfMissing('shopping_list_items', 'disc_percent_bps', 'INTEGER');
  addColumnIfMissing('shopping_list_items', 'disc_units', 'REAL');

  // ## 12al: quien escribio cada lista y cada linea. La lista sugerida se reconoce por
  // source='sugerida' (para poder actualizarla sin tocar las manuales), y sus lineas llevan
  // la misma marca para que actualizarlas no borre lo que la casa anadio a mano.
  addColumnIfMissing('shopping_lists', 'source', "TEXT NOT NULL DEFAULT 'manual'");
  addColumnIfMissing('shopping_list_items', 'source', "TEXT NOT NULL DEFAULT 'manual'");

  // weekly_calendars.household_id nacio NOT NULL con FK a households, y las rutas
  // metían '' para las cuentas sin hogar: la FK lo rechaza (foreign_keys = ON),
  // así que la primera comida de la semana devolvía 500. Se reconstruye la tabla
  // para admitir NULL, que es lo que significa «calendario personal».
  const householdColumn = (
    db.prepare('PRAGMA table_info(weekly_calendars)').all() as { name: string; notnull: number }[]
  ).find((column) => column.name === 'household_id');
  if (householdColumn?.notnull) {
    // PRAGMA foreign_keys no se puede tocar dentro de una transaccion.
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE weekly_calendars_personal (
            id TEXT PRIMARY KEY,
            household_id TEXT,
            user_id TEXT NOT NULL,
            week_start DATE NOT NULL,
            week_end DATE NOT NULL,
            goals TEXT DEFAULT '{}',
            generated_by TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (household_id) REFERENCES households(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
          );

          INSERT INTO weekly_calendars_personal
            SELECT id, NULLIF(household_id, ''), user_id, week_start, week_end, goals,
                   generated_by, created_at, updated_at
            FROM weekly_calendars;

          DROP TABLE weekly_calendars;
          ALTER TABLE weekly_calendars_personal RENAME TO weekly_calendars;
        `);
      })();
      console.log('[DB] weekly_calendars.household_id admite NULL (calendarios personales)');
    } catch (error) {
      console.error('[DB] No se pudo relajar weekly_calendars.household_id:', error);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  // Backfill: los hogares creados antes del catalogo no tienen ni
  // ingredientes sugeridos ni utensilios que marcar.
  backfillHouseholdSeeds(db);

  // ... y las cuentas SIN hogar tampoco: para ellas el catalogo es personal
  // (household_id NULL), que es lo que se siembra al registrarse.
  backfillUserSeeds(db);

  // Y el padre de fabrica de la ## 12aa: las casas anteriores nacen con las doce categorias planas, y `alimentos`
  // es lo que les falta para que el visor y el catalogo hablen el mismo idioma.
  asegurarPadreAlimentosTodas(db);

  // Refresca contenido editorial del catálogo sin pisar datos ni interacciones personales.
  if (config.server.env !== 'test') ensureRecipeBookCatalog(db);

  console.log('Database tables and indexes created');
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('Database connection closed');
  }
}
