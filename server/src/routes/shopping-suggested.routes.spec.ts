import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * Las rutas de la lista sugerida (## 12al) sobre una BD en memoria real: lo que se prueba es
 * la ESCRITURA, no el calculo (eso vive en `lista-sugerida.spec.ts`). Tres promesas:
 *
 *   - El POST vacio crea la lista (el boton no lleva formulario) y sus lineas llevan
 *     source='sugerida' con la mejor tienda en la nota y el precio por unidad.
 *   - El segundo POST no duplica: actualiza la MISMA lista, se queda lo comprado y lo escrito
 *     a mano, y se sustituyen solo las sugeridas pendientes.
 *   - El GET ensena la previsualizacion sin escribir nada, y dice si ya hay lista abierta.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let app: Hono;
let db: Sql;
let closeDatabase: () => void;

async function makeUser(email: string) {
  const id = `u-${email.split('@')[0]}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    'Comprador',
    'hash'
  );
  const config = await import('../config/app.config.js');
  const token = jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' });
  return { id, token };
}

type User = { id: string; token: string };

function call(user: User, method: string, path: string, body?: unknown) {
  return app.request(`/api/shopping${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const json = async (response: Response): Promise<any> => await response.json();
const data = async (response: Response): Promise<any> => (await json(response)).data;

function dia(desplazado: number): string {
  return new Date(Date.now() + desplazado * 86400000).toISOString().slice(0, 10);
}

/** Un articulo de despensa: la cantidad y la fecha registrada son las que decide cada caso. */
function sembrarDespensa(
  user: User,
  name: string,
  quantity: number,
  expiration: string | null = null
): void {
  db.prepare(
    `INSERT INTO ingredients (id, user_id, name, category, quantity, unit, location, expiration_date)
     VALUES (?, ?, ?, 'other', ?, 'ud', 'pantry', ?)`
  ).run(`ing-${name}`, user.id, name, quantity, expiration);
}

/** Una observacion de precio con su DIA: el ritmo necesita dias distintos y el API siempre
 *  escribe «ahora», asi que aqui se escribe directo. */
function sembrarPrecio(
  user: User,
  clave: string,
  tienda: string,
  priceMinor: number,
  quantity: number,
  cuando: string
): void {
  db.prepare(
    `INSERT INTO price_observations (id, user_id, product_key, product_name, store_name, price_minor, quantity, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`obs-${clave}-${tienda}-${cuando}`, user.id, clave, clave, tienda, priceMinor, quantity, `${cuando} 10:00:00`);
}

let alice: User;

beforeEach(async () => {
  db.exec(
    `DELETE FROM meals; DELETE FROM weekly_calendars; DELETE FROM recipes; DELETE FROM ingredients;
     DELETE FROM price_observations; DELETE FROM shopping_list_events; DELETE FROM shopping_list_discounts;
     DELETE FROM shopping_list_items; DELETE FROM shopping_lists;`
  );
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
});

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const { shoppingRoutes } = await import('./shopping.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  const { timestampMiddleware } = await import('../middleware/timestamp.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.use('/api/*', timestampMiddleware());
  app.route('/api/shopping', shoppingRoutes);
});

afterAll(() => closeDatabase?.());

describe('GET /suggested', () => {
  it('sin datos no sugiere nada y no hay lista: la pantalla lo dice, no lo inventa', async () => {
    const cuerpo = await data(await call(alice, 'GET', '/suggested'));
    expect(cuerpo.sugerencias).toEqual([]);
    expect(cuerpo.lista).toBeNull();
  });

  it('la previsualizacion trae las sugerencias con su mejor tienda y no escribe nada', async () => {
    sembrarDespensa(alice, 'Leche entera', 1);
    sembrarPrecio(alice, 'leche entera', 'Mercadona', 720, 6, dia(-14));
    sembrarPrecio(alice, 'leche entera', 'Mercadona', 720, 6, dia(-7));

    const cuerpo = await data(await call(alice, 'GET', '/suggested'));
    // Cada 7 dias, de 6: con 1 en nevera faltan 5 → el pack las sube a 6, a 120/u.
    expect(cuerpo.sugerencias).toHaveLength(1);
    expect(cuerpo.sugerencias[0]).toMatchObject({
      name: 'Leche entera',
      quantity: 6,
      motivo: 'se_acaba',
      mejorTienda: 'Mercadona',
      precioUnitarioMinor: 120
    });
    // No ha nacido ninguna lista: la previsualizacion no escribe.
    expect(cuerpo.lista).toBeNull();
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n
    ).toBe(0);
  });
});

describe('POST /suggested', () => {
  it('el POST vacio crea la lista con sus lineas sugeridas, la tienda en la nota y el precio por unidad', async () => {
    sembrarDespensa(alice, 'Pan de barra', 0);
    sembrarPrecio(alice, 'pan barra', 'Lidl', 180, 2, dia(-1));

    const respuesta = await call(alice, 'POST', '/suggested', {});
    expect(respuesta.status).toBe(201);
    const cuerpo = await data(respuesta);
    expect(cuerpo.creada).toBe(true);
    expect(cuerpo.name).toBe('Lista sugerida');
    expect(cuerpo.totalItems).toBe(1);

    const fila = db
      .prepare(`SELECT * FROM shopping_list_items WHERE list_id = ?`)
      .get(cuerpo.id) as any;
    // Sin ritmo (una sola compra) la cantidad es la de la ultima compra: 2.
    expect(fila).toMatchObject({
      name: 'Pan de barra',
      quantity: 2,
      source: 'sugerida',
      price_minor: 90,
      note: 'Mejor en Lidl'
    });
    // Y la lista se reconoce: es la sugerida de la casa.
    expect(
      db.prepare(`SELECT source FROM shopping_lists WHERE id = ?`).get(cuerpo.id)
    ).toMatchObject({ source: 'sugerida' });
  });

  it('actualizar no duplica la lista: lo comprado y lo manual se quedan, lo pendiente se sustituye', async () => {
    sembrarDespensa(alice, 'Pan de barra', 0);
    sembrarPrecio(alice, 'pan barra', 'Lidl', 180, 2, dia(-1));
    // La leche, agotada y con ritmo (cada 7 dias, de 6): las dos entran en la lista.
    sembrarDespensa(alice, 'Leche entera', 0);
    sembrarPrecio(alice, 'leche entera', 'Mercadona', 720, 6, dia(-14));
    sembrarPrecio(alice, 'leche entera', 'Mercadona', 720, 6, dia(-7));

    const primera = await data(await call(alice, 'POST', '/suggested', {}));
    expect(primera.creada).toBe(true);
    expect(primera.totalItems).toBe(2);

    // La casa hace su vida: compra el pan (checked) y anade a mano el detergente.
    db.prepare(
      `UPDATE shopping_list_items SET checked = 1 WHERE list_id = ? AND product_key = 'pan barra'`
    ).run(primera.id);
    db.prepare(
      `INSERT INTO shopping_list_items (id, list_id, name, product_key, quantity, unit, position, source)
       VALUES ('manual-1', ?, 'Detergente', 'detergente', 1, 'ud', 99, 'manual')`
    ).run(primera.id);

    const segunda = await data(await call(alice, 'POST', '/suggested', {}));
    expect(segunda.creada).toBe(false);
    expect(segunda.id).toBe(primera.id);
    // Sigue habiendo UNA lista sugerida, no dos.
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM shopping_lists WHERE source = 'sugerida'`).get() as { n: number }).n
    ).toBe(1);

    const filas = db
      .prepare(`SELECT * FROM shopping_list_items WHERE list_id = ? AND deleted_at IS NULL ORDER BY position`)
      .all(primera.id) as any[];
    // El pan comprado sigue (checked), el detergente manual sigue, y la leche se re-sugiere.
    const pan = filas.find((f) => f.product_key === 'pan barra');
    const detergente = filas.find((f) => f.product_key === 'detergente');
    const leche = filas.find((f) => f.product_key === 'leche entera');
    expect(pan?.checked).toBe(1);
    expect(detergente?.source).toBe('manual');
    expect(leche?.source).toBe('sugerida');
    // La version sube: el CAS de la lista tiene que enterarse.
    expect(segunda.version).toBeGreaterThan(primera.version);
  });

  it('lo que caduca y las recetas del plan entran en la lista con su motivo', async () => {
    sembrarDespensa(alice, 'Pescado fresco', 2, dia(-1));
    // Una receta para manana que pide 400 g de tomate, y no hay tomate en casa.
    db.prepare(
      `INSERT INTO recipes (id, author_id, name, servings, ingredients) VALUES ('r-1', ?, 'Pasta al pomodoro', 4, ?)`
    ).run(alice.id, JSON.stringify([{ name: 'Tomate', quantity: 400, unit: 'g' }]));
    db.prepare(
      `INSERT INTO weekly_calendars (id, user_id, week_start, week_end) VALUES ('wc-1', ?, ?, ?)`
    ).run(alice.id, dia(-3), dia(3));
    db.prepare(
      `INSERT INTO meals (id, calendar_id, date, meal_type, recipe_id, servings)
       VALUES ('m-1', 'wc-1', ?, 'dinner', 'r-1', 4)`
    ).run(dia(1));

    const cuerpo = await data(await call(alice, 'POST', '/suggested', {}));
    const nombres = (
      db
        .prepare(`SELECT name FROM shopping_list_items WHERE list_id = ?`)
        .all(cuerpo.id) as { name: string }[]
    ).map((f) => f.name);
    expect(nombres).toContain('Pescado fresco');
    expect(nombres).toContain('Tomate');
  });

  it('sin sugerencias no nace una lista vacia', async () => {
    sembrarDespensa(alice, 'Arroz', 10); // sobra: nada que sugerir
    const cuerpo = await data(await call(alice, 'POST', '/suggested', {}));
    expect(cuerpo.lista ?? cuerpo.id ?? null).toBeNull();
    expect(cuerpo.sugeridos).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM shopping_lists').get() as { n: number }).n
    ).toBe(0);
  });
});
