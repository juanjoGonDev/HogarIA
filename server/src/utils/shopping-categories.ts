/**
 * Catalogo de secciones de la lista de la compra (HOGARIA-SPEC §8f).
 *
 * antes de ser tabla, la lista de categorias vivia en el frontend como
 * `LIST_CATEGORIES`. Para que una foto la clasifique hace falta pasarselas al
 * modelo, y ahi se ve el problema: el prompt no puede depender de que la pantalla
 * este abierta. La lista pasa a ser dato, con color, y el frontend conserva su
 * constante como lo que es — el fallback cuando no hay red.
 *
 * El color es parte del dato y no de la hoja de estilos porque el usuario (o la IA
 * al crear una seccion nueva) lo elige: «Frutas y verduras» en verde se reconoce en
 * la foto del pasillo sin leer.
 */

export type CategorySeed = { name: string; color: string };

export const DEFAULT_CATEGORIES: readonly CategorySeed[] = [
  { name: 'Frutas y verduras', color: '#4CAF50' },
  { name: 'Panaderia', color: '#B26A00' },
  { name: 'Carne y pescado', color: '#E05A5A' },
  { name: 'Lacteos', color: '#4FA3D1' },
  { name: 'Congelados', color: '#6C8AE4' },
  { name: 'Despensa', color: '#C99A2E' },
  { name: 'Bebidas', color: '#8E5AC8' },
  { name: 'Limpieza e higiene', color: '#2FA79B' },
  { name: 'Otros', color: '#8A8F98' }
];

export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERN.test(value);
}

/**
 * Clave de comparacion: minusculas, sin acentos, espacios colapsados y puntuacion
 * de sobra fuera. A proposito no es `productKeyOf`: esa ademas abrevia unidades, y
 * una seccion llamada «Pack de 6» no es un producto — normalizarla como tal haria
 * que dos secciones distintas chocaran por un motivo que nadie entiende.
 */
export function categoryKey(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Color determinista para una seccion nueva: se elige del mismo abanico siempre. */
export function colorForNewCategory(seed: string): string {
  const PALETTE = ['#4CAF50', '#B26A00', '#E05A5A', '#4FA3D1', '#6C8AE4', '#C99A2E', '#8E5AC8', '#2FA79B'];
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.codePointAt(0)!) % 9973;
  return PALETTE[hash % PALETTE.length];
}

type Db = import('better-sqlite3').Database;

/**
 * Si el usuario no tiene ninguna seccion, se le siembran las por defecto. Se hace
 * aqui y no en la migracion global: una migracion que escribe filas por cada
 * usuario del sistema es una fuente de datos duplicados cuando alguien cambia de
 * cuenta, y ademas el alta de un usuario nuevo tendria que engancharse a otro sitio.
 */
export function ensureDefaultCategories(db: Db, userId: string, householdId: string | null): void {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM shopping_categories WHERE user_id = ?').get(userId) as {
    count: number;
  };
  if (count > 0) return;
  DEFAULT_CATEGORIES.forEach((seed, index) => {
    db.prepare(
      `INSERT INTO shopping_categories (id, user_id, household_id, key, name, color, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(`cat-${userId}-${index}`, userId, householdId, categoryKey(seed.name), seed.name, seed.color, index);
  });
}

export function listCategories(db: Db, clause: string, params: unknown[]) {
  return db
    .prepare(`SELECT * FROM shopping_categories WHERE ${clause} ORDER BY position ASC, name ASC`)
    .all(...params) as any[];
}

/**
 * Busca por clave dentro del ambito del usuario. No se apoya en una FK: la columna
 * `category` de la linea sigue siendo texto, y asi una fila antigua con una seccion
 * que alguien borro del catalogo no deja de pintarse (cae en «Otros»).
 */
export function findCategory(db: Db, clause: string, params: unknown[], key: string) {
  return db
    .prepare(`SELECT * FROM shopping_categories WHERE ${clause} AND key = ?`)
    .get(...params, key) as any;
}

export type UpsertResult = { category: any; created: boolean };

/** Crear o reutilizar: idempotente por clave, que es lo que necesita la IA al proponer una. */
export function upsertCategory(
  db: Db,
  input: { userId: string; householdId: string | null; name: string; color?: string | null; idFactory: () => string }
): UpsertResult {
  const scopeClause = input.householdId ? '(user_id = ? OR household_id = ?)' : 'user_id = ?';
  const scopeParams: unknown[] = input.householdId ? [input.userId, input.householdId] : [input.userId];

  const key = categoryKey(input.name);
  const existing = findCategory(db, scopeClause, scopeParams, key);
  if (existing) return { category: existing, created: false };

  const color = isColor(input.color) ? input.color : colorForNewCategory(key);
  const { max } = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM shopping_categories WHERE user_id = ?')
    .get(input.userId) as { max: number };
  const id = input.idFactory();
  db.prepare(
    `INSERT INTO shopping_categories (id, user_id, household_id, key, name, color, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.userId, input.householdId, key, input.name.trim(), color, max + 1);

  return {
    category: db.prepare('SELECT * FROM shopping_categories WHERE id = ?').get(id),
    created: true
  };
}

/**
 * El JSON que se le pasa al modelo. Deliberadamente corto: `name` y `color`, que es
 * lo que hace falta para elegir; anadir descripciones larga el prompt y no mejora
 * la clasificacion de un brick de leche.
 */
export function catalogueForPrompt(categories: { name: string; color: string }[]): string {
  return JSON.stringify(categories.map(({ name, color }) => ({ name, color })));
}
