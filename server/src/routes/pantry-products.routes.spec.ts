import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * El gestor de productos principales (HOGARIA-SPEC ## 12x).
 *
 * En HogarIA un producto principal es una fila de la despensa con `quantity = 0`: lo que la casa conoce y ahora
 * mismo no tiene. No hay tabla nueva porque no hay dato nuevo —lo que faltaba era gestionarlo—, y esto prueba las
 * cuatro cosas que se rompen cuando una pantalla se monta sobre una fila y se olvida de que la fila es un dato:
 * que el alta sea idempotente por clave de producto, que los alias sirvan para buscar y no para llamar a otra
 * cosa, que borrar un producto no borra la historia de la cesta, y que un articulo con stock no se borre «por
 * accidente» desde el gestor.
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
    id, email, 'Cocinera', 'hash', null
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

/** Una linea de cesta con el aspecto que le da la propia ruta al anadirla (clave incluida). */
async function anadirLineaDeCesta(nombre: string, quantity = 1) {
  const { shoppingRoutes } = await import('./shopping.routes.js');
  const local = new Hono();
  const { errorHandler } = await import('../middleware/error.middleware.js');
  local.onError(errorHandler as never);
  local.route('/api/shopping', shoppingRoutes);
  const lista = await local.request('/api/shopping/lists', {
    method: 'POST',
    headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Cesta ${Math.random().toString(36).slice(2, 6)}` })
  });
  const listId = ((await lista.json()) as any).data.id;
  return local.request(`/api/shopping/lists/${listId}/items`, {
    method: 'POST',
    headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: nombre, quantity })
  });
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const { pantryRoutes } = await import('./pantry.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  const app2 = new Hono();
  app2.onError(errorHandler as never);
  app2.route('/api/pantry', pantryRoutes);
  app = app2;
});

afterAll(() => closeDatabase?.());

beforeEach(async () => {
  db.exec('DELETE FROM ingredients; DELETE FROM pantry_categories; DELETE FROM users;');
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
});

describe('GET /products', () => {
  it('la pestana de principales son las filas sin stock, y `todos` son todas', async () => {
    await call('POST', '/products', { name: 'Levadura', category: 'spices' });
    await call('POST', '/products', { name: 'Leche', category: 'dairy', quantity: 2, unit: 'l' });
    const principales = await call('GET', '/products?filter=staples');
    expect(principales.payload.data.map((row: any) => row.name)).toEqual(['Levadura']);
    expect(principales.payload.meta).toMatchObject({ total: 1, limit: 10, offset: 0 });
    const todas = await call('GET', '/products?filter=all');
    expect(todas.payload.meta.total).toBe(2);
    expect(todas.payload.data.find((row: any) => row.name === 'Leche')).toMatchObject({ quantity: 2, inPantry: true });
    expect(todas.payload.data.find((row: any) => row.name === 'Levadura')).toMatchObject({ inPantry: false });
  });

  it('el filtro de caducidad mira el dia, no el instante', async () => {
    const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    await call('POST', '/products', { name: 'Yogur', category: 'dairy', quantity: 4, unit: 'unit', expirationDate: manana });
    await call('POST', '/products', { name: 'Arroz', category: 'grains', quantity: 1, unit: 'kg' });
    const caducas = await call('GET', '/products?filter=expiring');
    expect(caducas.payload.data.map((row: any) => row.name)).toEqual(['Yogur']);
  });

  it('se busca por nombre, por alias y por lo que dice la nota', async () => {
    await call('POST', '/products', { name: 'Leche semidesnatada', category: 'dairy', aliases: ['leche del dia', 'semi'] });
    await call('POST', '/products', { name: 'Queso curado', category: 'dairy', notes: 'El de la plaza, solo los sabados' });
    expect((await call('GET', '/products?q=semi')).payload.data.map((r: any) => r.name)).toEqual([
      'Leche semidesnatada'
    ]);
    expect((await call('GET', '/products?q=sabados')).payload.data.map((r: any) => r.name)).toEqual([
      'Queso curado'
    ]);
    expect((await call('GET', '/products?q=nadie')).payload.data).toEqual([]);
  });

  it('los alias salen como lista, no como el JSON con el que se guardan', async () => {
    const creada = await call('POST', '/products', { name: 'Tomate de colgar', category: 'vegetables', aliases: ['de rama', 'perita'] });
    expect(creada.payload.data.aliases).toEqual(['de rama', 'perita']);
  });
  it('la pagina dice cuantas hay, y el orden por nombre es por etiqueta traducible, no por clave', async () => {
    for (let i = 0; i < 12; i++) await call('POST', '/products', { name: `Producto ${String(i).padStart(2, '0')}`, category: 'other' });
    const primera = await call('GET', '/products?filter=staples&sort=name&limit=5');
    expect(primera.payload.data).toHaveLength(5);
    expect(primera.payload.meta.total).toBe(12);
    expect(primera.payload.data[0].name).toBe('Producto 00');
    expect(primera.payload.hasMore).toBe(true);
  });
});

describe('GET /products/:id (## 12ai)', () => {
  it('la ficha de un articulo llega entera, con la huella de su clave: cesta y precios', async () => {
    const creada = await call('POST', '/products', {
      name: 'Leche entera',
      category: 'dairy',
      quantity: 4,
      unit: 'unit',
      location: 'fridge',
      barcode: '8480000123456',
      aliases: ['la de siempre'],
      notes: 'Entera, no semi'
    });
    expect(creada.status).toBe(201);
    await anadirLineaDeCesta('Leche entera');
    const ficha = await call('GET', `/products/${creada.payload.data.id}`);
    expect(ficha.status).toBe(200);
    expect(ficha.payload.data).toMatchObject({
      id: creada.payload.data.id,
      name: 'Leche entera',
      category: 'dairy',
      quantity: 4,
      unit: 'unit',
      inPantry: true,
      location: 'fridge',
      barcode: '8480000123456',
      aliases: ['la de siempre'],
      notes: 'Entera, no semi'
    });
    // La huella cuenta por clave de producto: una linea en la cesta y (de momento) ningun precio.
    expect(ficha.payload.data.impact).toMatchObject({ listLines: 1, priceObservations: 0 });
  });

  it('lo que no existe (o no es de esta casa) es un 404 con su codigo, no un 500', async () => {
    const ausente = await call('GET', '/products/no-existe');
    expect(ausente.status).toBe(404);
    expect(ausente.payload.error).toBe('PANTRY_PRODUCT_NOT_FOUND');
  });
});

describe('POST /products', () => {
  it('registrar lo que la casa ya conoce no duplica la ficha: idempotente por clave de producto', async () => {
    const primera = await call('POST', '/products', { name: 'Levadura', category: 'spices', unit: 'unit' });
    expect(primera.status).toBe(201);
    const repetida = await call('POST', '/products', { name: '  levadura ', category: 'spices' });
    expect(repetida.status).toBe(200);
    expect(repetida.payload.data.created).toBe(false);
    expect(repetida.payload.data.id).toBe(primera.payload.data.id);
    expect(repetida.payload.data.name).toBe('Levadura'); // el nombre ya guardado gana: es el que pinta la pantalla
  });

  it('un producto nuevo sin categoria cae en la reserva, y con una del catalogo se le pone', async () => {
    await call('POST', '/categories', { name: 'Frutos secos' });
    const conCategoria = await call('POST', '/products', { name: 'Almendras', category: 'frutos secos' });
    expect(conCategoria.payload.data).toMatchObject({ category: 'frutos secos', categoryKey: 'frutos secos' });
    const sinCategoria = await call('POST', '/products', { name: 'Pilas AA' });
    expect(sinCategoria.payload.data.category).toBe('other');
  });

  it('un alias que es el nombre de otro producto no se acepta: dos fichas para la misma cosa es el bug de siempre', async () => {
    await call('POST', '/products', { name: 'Leche', category: 'dairy' });
    const liosa = await call('POST', '/products', { name: 'Bebida lactea', category: 'dairy', aliases: ['Leche'] });
    expect(liosa.status).toBe(409);
    expect(liosa.payload.error).toBe('PANTRY_PRODUCT_ALIAS_CLASH');
    expect(JSON.stringify(liosa.payload.details)).toContain('Leche');
  });
});

describe('PATCH y borrado', () => {
  async function crearProducto(name: string, extra: Record<string, unknown> = {}) {
    const creada = await call('POST', '/products', { name, category: 'other', ...extra });
    return creada.payload.data;
  }

  it('quitar la nota o los alias escribe null, no los omite', async () => {
    const producto = await crearProducto('Merluza', { notes: 'Al peso', aliases: ['pescada'] });
    const vaciada = await call('PATCH', `/products/${producto.id}`, { notes: null, aliases: null });
    expect(vaciada.status).toBe(200);
    expect(vaciada.payload.data.notes).toBeNull();
    expect(vaciada.payload.data.aliases).toEqual([]);
  });

  it('la ficha edita tambien la ubicacion y el codigo de barras, y null los devuelve a su sitio (## 12ai)', async () => {
    const producto = await crearProducto('Yogur griego', { category: 'dairy', location: 'fridge', barcode: '8480000999999' });
    const cambiada = await call('PATCH', `/products/${producto.id}`, { location: 'counter', barcode: '1234' });
    expect(cambiada.status).toBe(200);
    expect(cambiada.payload.data).toMatchObject({ location: 'counter', barcode: '1234' });
    // La ubicacion no tiene «ninguna»: null vuelve a la despensa. El codigo si se quita de verdad.
    const relajada = await call('PATCH', `/products/${producto.id}`, { location: null, barcode: null });
    expect(relajada.status).toBe(200);
    expect(relajada.payload.data).toMatchObject({ location: 'pantry', barcode: null });
  });

  it('renombrar no reescribe la historia: las lineas de cesta guardan la clave con la que se escribieron', async () => {
    await crearProducto('Leche semidesnatada', { category: 'dairy' });
    const linea = await anadirLineaDeCesta('Leche semidesnatada');
    expect(linea.status).toBeLessThan(300);
    const productos = await call('GET', '/products?q=Leche');
    const id = productos.payload.data[0].id;
    const claveAntes = db
      .prepare("SELECT product_key FROM shopping_list_items WHERE name = 'Leche semidesnatada'")
      .get() as { product_key: string };
    await call('PATCH', `/products/${id}`, { name: 'Leche del dia' });
    const claveDespues = db
      .prepare("SELECT product_key FROM shopping_list_items WHERE name = 'Leche semidesnatada'")
      .get() as { product_key: string };
    expect(claveDespues.product_key).toBe(claveAntes.product_key);
  });

  it('el impacto dice cuantas lineas y cuantas observaciones de precio habra detras, y eso no se borra', async () => {
    const producto = await crearProducto('Cerveza', { category: 'beverages' });
    await anadirLineaDeCesta('Cerveza');
    const impacto = await call('GET', `/products/${producto.id}/delete-impact`);
    expect(impacto.payload.data).toMatchObject({ quantity: 0, listLines: 1, canDelete: true });
    expect(impacto.payload.data.priceObservations).toBeGreaterThanOrEqual(0);
    expect((await call('DELETE', `/products/${producto.id}`)).status).toBe(204);
    // La linea de la cesta sigue ahi: lo que se borro es la ficha, no lo que paso.
    expect((await anadirLineaDeCesta('Cerveza')).status).toBeLessThan(300);
  });

  it('con stock dentro no se borra desde el gestor: primero se quita de la despensa', async () => {
    const producto = await crearProducto('Pan de molde', { category: 'grains', quantity: 1, unit: 'piece' });
    const impacto = await call('GET', `/products/${producto.id}/delete-impact`);
    expect(impacto.payload.data).toMatchObject({ quantity: 1, canDelete: false });
    const borrado = await call('DELETE', `/products/${producto.id}`);
    expect(borrado.status).toBe(409);
    expect(borrado.payload.error).toBe('PANTRY_PRODUCT_IN_PANTRY');
    expect(borrado.payload.details).toMatchObject({ quantity: 1 });
  });

  it('en lote: todo o nada, con la lista de lo que estorba, y novecientos ids no', async () => {
    const a = await crearProducto('Ajo');
    const b = await crearProducto('Gambas', { quantity: 3, unit: 'unit' });
    const impacto = await call('POST', '/products/bulk-delete-impact', { ids: [a.id, b.id] });
    expect(impacto.payload.data).toMatchObject({ requestedCount: 2, canDelete: false });
    expect(impacto.payload.data.deletableIds).toEqual([a.id]);
    expect(impacto.payload.data.blocked[0].id).toBe(b.id);
    const borrado = await call('POST', '/products/bulk-delete', { ids: [a.id, b.id] });
    expect(borrado.status).toBe(409);
    expect(borrado.payload.error).toBe('PANTRY_PRODUCT_BULK_DELETE_BLOCKED');
    // ...y mientras el lote no pase, no se borra ni el que si podia (todo o nada, dentro de una transaccion).
    expect((await call('GET', '/products?q=Ajo')).payload.data).toHaveLength(1);
    const solo = await call('POST', '/products/bulk-delete', { ids: [a.id] });
    expect(solo.status).toBe(200);
    expect(solo.payload.data).toMatchObject({ deleted: 1 });
    expect((await call('GET', '/products?q=Ajo')).payload.data).toHaveLength(0);
    const enorme = await call('POST', '/products/bulk-delete', { ids: Array.from({ length: 101 }, (_, i) => `x-${i}`) });
    expect(enorme.status).toBe(400);
  });
});
