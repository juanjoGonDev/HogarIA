import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * El gestor de categorias del inventario, por dentro de la ruta (HOGARIA-SPEC ## 12x).
 *
 * Lo que se juega aqui no es el CRUD, es la proteccion: una categoria con articulos encima no se borra (y el 409
 * tiene que traer los numeros para que el dialogo pueda decir por que), la reserva `other` no se puede romper, y
 * `ingredients.category` deja de ser un enum cerrado sin convertirse en un colador: lo que no esta en el catalogo
 * de la casa se rechaza con las claves validas, no se guarda a ciegas.
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
    id,
    email,
    'Cocinera',
    'hash',
    null
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
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const { pantryRoutes } = await import('./pantry.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  const { timestampMiddleware } = await import('../middleware/timestamp.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.use('/api/*', timestampMiddleware());
  app.route('/api/pantry', pantryRoutes);
});

afterAll(() => closeDatabase?.());

beforeEach(async () => {
  db.exec('DELETE FROM ingredients; DELETE FROM pantry_categories; DELETE FROM users;');
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
});

describe('GET /categories', () => {
  it('la casa arranca con el padre delante y las doce de siempre, con sus recuentos y su punto de color', async () => {
    const { status, payload } = await call('GET', '/categories');
    expect(status).toBe(200);
    // La pagina por defecto son diez filas —el gestor entra paginado, como el de la cesta— y `total` dice que
    // hay trece (once hojas, un padre y la reserva): si `total` contara lo que cabe en la pagina, el paginador
    // mentiria.
    expect(payload.data).toHaveLength(10);
    expect(payload.meta.total).toBe(13);
    const todas = await call('GET', '/categories?limit=50');
    expect(todas.payload.data).toHaveLength(13);
    expect(todas.payload.meta).toMatchObject({ total: 13, limit: 50, offset: 0 });
    const verduras = todas.payload.data.find((row: any) => row.key === 'vegetables');
    expect(verduras).toMatchObject({ name: 'Verduras', color: '#4CAF50', protected: false, parentName: 'Alimentos' });
    expect(verduras.counts).toEqual({ products: 0, children: 0, descendantProducts: 0 });
    expect(todas.payload.data.find((row: any) => row.key === 'alimentos')).toMatchObject({ name: 'Alimentos', protected: false });
    expect(todas.payload.data.find((row: any) => row.key === 'other')).toMatchObject({ protected: true, canDelete: false });
  });

  it('los recuentos se pintan con lo que hay en la despensa, y la vista «sin productos» es la que se filtra', async () => {
    await call('POST', '/categories', { name: 'Frutos secos' });
    await call('POST', '/ingredients', { name: 'Almendras', category: 'frutos secos', quantity: 2, unit: 'unit' });
    const todas = await call('GET', '/categories?limit=50');
    const secos = todas.payload.data.find((row: any) => row.key === 'frutos secos');
    expect(secos.counts.products).toBe(1);
    const vacias = await call('GET', '/categories?view=without-products&limit=50');
    expect(vacias.payload.data.map((row: any) => row.key)).not.toContain('frutos secos');
    // El total es el filtrado: un pager que dice 13 cuando muestra 11 miente.
    expect(vacias.payload.meta.total).toBe(todas.payload.meta.total - 1);
  });

  it('la busqueda vale por nombre y por clave, y la jerarquia sale con el padre al lado', async () => {
    const raiz = await call('POST', '/categories', { name: 'Alimentacion' });
    expect(raiz.status).toBe(201);
    await call('POST', '/categories', { name: 'Bebidas vegetales', parentKey: raiz.payload.data.key });
    const buscado = await call('GET', '/categories?q=vegetales');
    expect(buscado.payload.data).toHaveLength(1);
    expect(buscado.payload.data[0]).toMatchObject({ name: 'Bebidas vegetales', parentName: 'Alimentacion' });
  });
});

describe('POST /categories', () => {
  it('crea con color propio y clave derivada del nombre', async () => {
    const { status, payload } = await call('POST', '/categories', {
      name: '  Recien horneados ',
      color: '#b26a00',
      description: 'Pan y bollería del dia'
    });
    expect(status).toBe(201);
    expect(payload.data).toMatchObject({ key: 'recien horneados', name: 'Recien horneados', color: '#B26A00' });
    expect(payload.data.description).toBe('Pan y bollería del dia');
    expect(payload.data.position).toBe(13);
  });

  it('un color que no es #RRGGBB no entra, y lo dice el campo', async () => {
    const { status, payload } = await call('POST', '/categories', { name: 'Raras', color: 'salmon' });
    expect(status).toBe(400);
    expect(JSON.stringify(payload.issues ?? payload)).toContain('color');
  });

  it('el nombre repetido de la casa no crea una segunda categoria con la misma clave', async () => {
    await call('POST', '/categories', { name: 'Frutos secos' });
    const duplicada = await call('POST', '/categories', { name: ' Frutos   secos ' });
    expect(duplicada.status).toBe(409);
    expect(duplicada.payload.error).toBe('PANTRY_CATEGORY_EXISTS');
  });

  it('un padre que no existe es un 404, no una categoria huerfana colgando de la nada', async () => {
    const { status, payload } = await call('POST', '/categories', { name: 'Huerfanas', parentKey: 'nadie' });
    expect(status).toBe(404);
    expect(payload.error).toBe('PANTRY_CATEGORY_PARENT_NOT_FOUND');
  });
});

describe('PATCH y DELETE /categories/:id', () => {
  async function crearConArticulo() {
    const creada = await call('POST', '/categories', { name: 'Frutos secos' });
    const id = creada.payload.data.id;
    await call('POST', '/ingredients', { name: 'Almendras', category: 'frutos secos', quantity: 1, unit: 'unit' });
    return id;
  }

  it('renombrar no cambia la clave: la clave es lo que guardan las filas', async () => {
    const creada = await call('POST', '/categories', { name: 'Frutos secos' });
    const { status, payload } = await call('PATCH', `/categories/${creada.payload.data.id}`, { name: 'Frutos secos y más' });
    expect(status).toBe(200);
    expect(payload.data).toMatchObject({ name: 'Frutos secos y más', key: 'frutos secos' });
  });

  it('quitar el padre se manda como null, y no se omite', async () => {
    const raiz = await call('POST', '/categories', { name: 'Alimentacion' });
    const hija = await call('POST', '/categories', { name: 'Bebidas', parentKey: raiz.payload.data.key });
    expect(hija.payload.data.parentKey).toBe('alimentacion');
    const soltada = await call('PATCH', `/categories/${hija.payload.data.id}`, { parentKey: null });
    expect(soltada.payload.data.parentKey).toBeNull();
  });

  it('la reserva no se renombra ni se recoloca; el color y la nota, si', async () => {
    const otras = (await call('GET', '/categories?limit=50')).payload.data.find((row: any) => row.key === 'other');
    const renombrada = await call('PATCH', `/categories/${otras.id}`, { name: 'Cajon de sastre' });
    expect(renombrada.status).toBe(409);
    expect(renombrada.payload.error).toBe('PANTRY_CATEGORY_PROTECTED');
    const coloreada = await call('PATCH', `/categories/${otras.id}`, { color: '#112233', description: 'Lo que no encaja' });
    expect(coloreada.status).toBe(200);
    expect(coloreada.payload.data).toMatchObject({ color: '#112233', name: 'Otros' });
  });

  it('mientras queden articulos, no se borra: el 409 trae los numeros para el dialogo', async () => {
    const id = await crearConArticulo();
    const impacto = await call('GET', `/categories/${id}/delete-impact`);
    expect(impacto.payload.data).toMatchObject({ products: 1, children: 0, canDelete: false, protected: false });
    const borrado = await call('DELETE', `/categories/${id}`);
    expect(borrado.status).toBe(409);
    expect(borrado.payload.error).toBe('PANTRY_CATEGORY_IN_USE');
    expect(borrado.payload.details).toMatchObject({ products: 1 });
  });

  it('con subcategorias tampoco, y vacia se borra y deja de salir del listado', async () => {
    const raiz = await call('POST', '/categories', { name: 'Alimentacion' });
    await call('POST', '/categories', { name: 'Bebidas', parentKey: raiz.payload.data.key });
    expect((await call('DELETE', `/categories/${raiz.payload.data.id}`)).status).toBe(409);
    await call(
      'DELETE',
      `/categories/${(await call('GET', '/categories?limit=50')).payload.data.find((r: any) => r.key === 'bebidas').id}`
    );
    expect((await call('DELETE', `/categories/${raiz.payload.data.id}`)).status).toBe(204);
    const tras = await call('GET', '/categories?limit=50');
    expect(tras.payload.data.map((row: any) => row.key)).not.toContain('alimentacion');
  });

  it('no se puede tocar la categoria de otra casa', async () => {
    const creada = await call('POST', '/categories', { name: 'Frutos secos' });
    // Otra casa, otro usuario, sin compartir despensa: la categoria de Alice no existe para Bob, y eso es lo
    // que tiene que responder el servidor —404, no 403, para no confirmar que la fila existe en algun sitio—.
    const bob = await makeUser('bob@test.local');
    const ajena = await app.request(`/api/pantry/categories/${creada.payload.data.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${bob.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mia' })
    });
    expect(ajena.status).toBe(404);
    expect(((await ajena.json()) as any).error).toBe('PANTRY_CATEGORY_NOT_FOUND');
  });
});


describe('la categoria del articulo, que es para lo que existe el catalogo', () => {
  it('una clave del catalogo de la casa entra, y una que no existe se rechaza con las validas', async () => {
    await call('POST', '/categories', { name: 'Frutos secos' });
    const buena = await call('POST', '/ingredients', { name: 'Almendras', category: 'frutos secos', quantity: 1, unit: 'unit' });
    expect(buena.status).toBe(201);
    const mala = await call('POST', '/ingredients', { name: 'Nueces', category: 'frutas del bosque', quantity: 1, unit: 'unit' });
    expect(mala.status).toBe(400);
    expect(mala.payload.error).toBe('PANTRY_CATEGORY_UNKNOWN');
    expect(JSON.stringify(mala.payload.details)).toContain('frutos secos');
  });

  it('el articulo que llega sin categoria cae en la reserva, que es para lo que esta ahi', async () => {
    const sinCategoria = await app.request('/api/pantry/ingredients', {
      method: 'POST',
      headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Tornillos', quantity: 1, unit: 'unit' })
    });
    expect(sinCategoria.status).toBe(201);
    expect(((await sinCategoria.json()) as any).data.category).toBe('other');
  });
});
