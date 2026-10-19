import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * El catalogo pre-registrado del super (HOGARIA-SPEC ## 12aa), desde fuera.
 *
 * Lo que se prueba aqui no es la busqueda en memoria de `supermarket-catalog` (eso tiene su propio test con las
 * invariantes del dato), sino lo que solo se puede probar con una casa detras: que la marca `inHousehold` habla
 * el mismo idioma de claves que el gestor, que anadir crea la hoja que falta Y SU PADRE DELANTE, que un producto
 * con stock no se pisa, y que un lote con un id inventado no escribe a medias.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let alice: { id: string; token: string };

async function makeUser(email: string) {
  const id = `u-${email.split('@')[0]}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)').run(
    id, email, 'Compradora', 'hash', null
  );
  const config = await import('../config/app.config.js');
  return { id, token: jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' }) };
}

async function call(method: string, path: string, body?: unknown) {
  const response = await app.request(`/api/pantry${path}`, {
    method,
    headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

beforeAll(async () => {
  const { pantryRoutes } = await import('./pantry.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.route('/api/pantry', pantryRoutes);
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  alice = await makeUser(`catalogo-${Math.random().toString(36).slice(2, 8)}@test.local`);
});

afterAll(() => closeDatabase());

beforeEach(() => {
  db.exec('DELETE FROM ingredients; DELETE FROM pantry_categories;');
});

describe('GET /catalog/categories', () => {
  it('trae el arbol plano: seis padres, treinta y dos hojas, cada uno con su cuenta', async () => {
    const { status, payload } = await call('GET', '/catalog/categories');
    expect(status).toBe(200);
    expect(payload.data).toHaveLength(38);
    const leche = payload.data.find((cat: any) => cat.key === 'dairy');
    expect(leche).toMatchObject({ name: 'Lácteos', parent: 'alimentos' });
    expect(leche.productCount).toBeGreaterThanOrEqual(8);
    const alimentos = payload.data.find((cat: any) => cat.key === 'alimentos');
    expect(alimentos.parent).toBeNull();
    expect(alimentos.productCount).toBe(
      payload.data
        .filter((cat: any) => cat.parent === 'alimentos')
        .reduce((total: number, hoja: any) => total + hoja.productCount, 0)
    );
  });
});

describe('GET /catalog/products', () => {
  it('busca sin acentos y pagina con meta', async () => {
    const { status, payload } = await call('GET', '/catalog/products?q=limon&limit=5&offset=0');
    expect(status).toBe(200);
    expect(payload.data.length).toBeGreaterThan(0);
    expect(payload.meta.total).toBeGreaterThanOrEqual(payload.data.length);
    const segunda = await call('GET', `/catalog/products?q=limon&limit=5&offset=${payload.meta.total}`);
    expect(segunda.payload.data).toHaveLength(0); // fuera de la ultima pagina no hay nada, y el 200 manda
  });

  it('filtrar por padre incluye el subarbol', async () => {
    const soloHojas = await call('GET', '/catalog/products?category=bebe&limit=100');
    const todas = await call('GET', '/catalog/products?category=alimentos&limit=100');
    expect(todas.payload.meta.total).toBeGreaterThan(soloHojas.payload.meta.total);
    expect(todas.payload.data.every((p: any) => p.category !== 'bebe')).toBe(true);
  });

  it('marca con `inHousehold` lo que la casa ya tiene, por clave y no por parecidos', async () => {
    db.prepare("INSERT INTO ingredients (id, user_id, name, category, quantity, unit) VALUES ('i-1', ?, 'Leche entera', 'dairy', 2, 'l')").run(alice.id);
    const { payload } = await call('GET', '/catalog/products?q=Leche&limit=40');
    const leche = payload.data.find((p: any) => p.name === 'Leche entera');
    expect(leche.inHousehold).toBe(true);
    // «Leche semidesnatada» NO es «Leche entera»: el LIKE las mezclaria, la clave no.
    const otra = payload.data.find((p: any) => p.name === 'Leche semidesnatada');
    expect(otra?.inHousehold).toBe(false);
  });

  it('una pagina pedida por encima del limite no existe: 422/400 con el campo, no un catalogo truncado', async () => {
    const { status } = await call('GET', '/catalog/products?limit=500');
    expect(status).toBe(400);
  });
});

describe('POST /catalog/add', () => {
  it('anade una fila de inventario con su unidad y su categoria de fabrica', async () => {
    const { status, payload } = await call('POST', '/catalog/add', { ids: ['dairy:0'] }); // Leche entera
    expect(status).toBe(200);
    expect(payload.data).toMatchObject({ added: 1, skipped: 0, categoriesCreated: 0 });
    const fila = db.prepare("SELECT * FROM ingredients WHERE user_id = 'u-alice' OR user_id = ?").get(alice.id) as any;
    expect(fila).toMatchObject({ name: 'Leche entera', category: 'dairy', quantity: 1, unit: 'l', location: 'pantry' });
      expect(db.prepare('SELECT kind FROM ai_jobs WHERE id = (SELECT job_id FROM product_image_searches WHERE ingredient_id = ?)').get(fila.id))
        .toEqual({ kind: 'product_image_search' });
  });

  it('una hoja nueva se crea en la casa con su padre DELANTE: la relacion pedida es producto-categoria-categoria-padre', async () => {
    // Casa con el catalogo viejo (sin `alimentos`): se siembran las doce planas a mano.
    db.prepare(
      "INSERT INTO pantry_categories (id, user_id, household_id, key, name, color) VALUES ('pc-x', ?, NULL, 'other', 'Otros', '#8A8F98')",
    ).run(alice.id);
    const { payload } = await call('POST', '/catalog/add', { ids: ['colada:0'] }); // Detergente liquido
    expect(payload.data.added).toBe(1);
    expect(payload.data.categoriesCreated).toBe(2); // la hoja `colada` y su padre `limpieza`
    const colada = db.prepare("SELECT parent_key FROM pantry_categories WHERE user_id = ? AND key = 'colada'").get(alice.id) as any;
    expect(colada.parent_key).toBe('limpieza');
    const fila = db.prepare("SELECT category FROM ingredients WHERE user_id = ? AND name = 'Detergente líquido de lavadora'").get(alice.id) as any;
    expect(fila.category).toBe('colada');
  });

  it('lo que la casa conocia sin tenerlo sube a 1 en vez de duplicar la ficha', async () => {
    db.prepare("INSERT INTO ingredients (id, user_id, name, category, quantity, unit) VALUES ('i-ficha', ?, 'Leche entera', 'dairy', 0, 'l')").run(alice.id);
    const { payload } = await call('POST', '/catalog/add', { ids: ['dairy:0'] });
    expect(payload.data).toMatchObject({ added: 1, skipped: 0 });
    const cantidades = db.prepare("SELECT quantity FROM ingredients WHERE user_id = ? AND name = 'Leche entera'").all(alice.id) as { quantity: number }[];
    expect(cantidades).toHaveLength(1);
    expect(cantidades[0].quantity).toBe(1);
      expect(db.prepare('SELECT job_id FROM product_image_searches WHERE ingredient_id = ?').get('i-ficha'))
        .toEqual({ job_id: expect.any(String) });
  });

  it('lo que ya tiene unidades NO se toca: el catalogo no repone stock a nadie', async () => {
    db.prepare("INSERT INTO ingredients (id, user_id, name, category, quantity, unit) VALUES ('i-stock', ?, 'Leche entera', 'dairy', 3, 'l')").run(alice.id);
    const { payload } = await call('POST', '/catalog/add', { ids: ['dairy:0'] });
    expect(payload.data).toMatchObject({ added: 0, skipped: 1 });
    const fila = db.prepare("SELECT quantity FROM ingredients WHERE id = 'i-stock'").get() as any;
    expect(fila.quantity).toBe(3);
  });

  it('un id inventado se rechaza ANTES de escribir: un lote a medias no existe', async () => {
    const { status, payload } = await call('POST', '/catalog/add', { ids: ['dairy:0', 'dairy:9999'] });
    expect(status).toBe(400);
    expect(payload.error).toBe('PANTRY_CATALOG_ID_UNKNOWN');
    expect(payload.details.unknownIds).toEqual(['dairy:9999']);
    const contadas = db.prepare('SELECT COUNT(*) AS c FROM ingredients WHERE user_id = ?').get(alice.id) as { c: number };
    expect(contadas.c).toBe(0);
  });

  it('el lote vacio y el de mil no entran (mismo contrato que el borrado por lotes)', async () => {
    expect((await call('POST', '/catalog/add', { ids: [] })).status).toBe(400);
    const muchos = Array.from({ length: 101 }, (_, i) => `dairy:${i}`);
    expect((await call('POST', '/catalog/add', { ids: muchos })).status).toBe(400);
  });

  it('repetir el mismo id en el lote no duplica ni cuenta doble', async () => {
    const { payload } = await call('POST', '/catalog/add', { ids: ['dairy:0', 'dairy:0'] });
    expect(payload.data).toMatchObject({ added: 1, skipped: 0 });
  });
});
