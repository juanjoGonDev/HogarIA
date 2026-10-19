import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * La despensa y los dias de caducidad (HOGARIA-SPEC §12h).
 *
 * `expiration_date` guarda un dia (`2026-12-31`), y los filtros lo comparaban con
 * `datetime('now')`: en orden lexicografico «2026-12-31» es MENOR que «2026-12-31 10:50:08»,
 * asi que lo que caduca HOY contaba como caducado desde la primera hora del dia y desaparecia
 * del «caduca en 3 dias». Se prueba aqui porque el frontend ya no puede taparlo: la cuenta la
 * hace el SQL.
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
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email, 'Cocinero', 'hash', null);
  const config = await import('../config/app.config.js');
  return {
    id,
    token: jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' })
  };
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return await app.request(`/api/pantry${path}`, {
    method,
    headers: {
      authorization: `Bearer ${alice.token}`,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const json = async (response: Response): Promise<any> => (await response.json()) as any;
const data = async (response: Response): Promise<any> => (await json(response)).data;

/** La coleccion sale bajo `ingredients`; se acepta tambien `items` para no partirse una
 *  segunda vez si la ruta decide llamarla como el resto. */
const namesOf = (payload: any): string[] =>
  (payload?.ingredients ?? payload?.items ?? []).map((entry: any) => entry.name);

/** Fecha civil relativa al reloj UTC que usa SQLite para filtrar caducidades. */
function dayFromNow(days: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function addIngredient(name: string, expirationDate: string | null) {
  const response = await call('POST', '/ingredients', {
    name,
    category: 'dairy',
    quantity: 1,
    unit: 'unit',
    location: 'fridge',
    ...(expirationDate ? { expirationDate } : {})
  });
  expect(response.status).toBe(201);
  return await data(response);
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
  db.exec('DELETE FROM ingredients;');
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
});

describe('dias de caducidad', () => {
  it('lo que caduca hoy no esta caducado y si entra en «próximos 3 días»', async () => {
    await addIngredient('Yogur natural', dayFromNow(0));

    const expired = await data(await call('GET', '/ingredients?expired=true'));
    expect(namesOf(expired)).toEqual([]);

    const soon = await data(await call('GET', '/ingredients?expiringSoon=true'));
    const names = namesOf(soon);
    expect(names).toContain('Yogur natural');

    const stats = await data(await call('GET', '/ingredients/stats'));
    expect(stats.expired).toBe(0);
    expect(stats.expiringSoon).toBe(1);
  });

  it('lo que caduco ayer si esta caducado, y no en los proximos tres dias', async () => {
    await addIngredient('Leche del lunes', dayFromNow(-1));

    const expired = await data(await call('GET', '/ingredients?expired=true'));
    expect(namesOf(expired)).toContain('Leche del lunes');

    const stats = await data(await call('GET', '/ingredients/stats'));
    expect(stats.expired).toBe(1);
    expect(stats.expiringSoon).toBe(0);
  });

  it('lo que caduca en cuatro dias no entra en ningun aviso', async () => {
    await addIngredient('Aceitunas', dayFromNow(4));
    const stats = await data(await call('GET', '/ingredients/stats'));
    expect(stats.expiringSoon).toBe(0);
    expect(stats.expired).toBe(0);
  });

  it('el dia se guarda y se devuelve como dia: ni hora ni zona', async () => {
    const today = dayFromNow(2);
    const created = await addIngredient('Queso curado', today);
    // Una `Z` aqui convertida en instante moveria la caducidad media jornada, y «mañana»
    // pasaria a ser «hoy» en media Europa.
    expect(created.expirationDate ?? created.expiration_date).toBe(today);
  });

  it('un ingrediente con lo minimo que pide la pantalla se guarda, y lo opcional no existe', async () => {
    // La pantalla marca como obligatorio Nombre y Cantidad; caducidad, notas, foto y codigo de
    // barras se pueden dejar sin tocar. Es la misma queja del usuario, en otra pantalla: aqui el
    // riesgo no era un 400 (eso lo cubre el contrato de schemas) sino un 500, porque el INSERT liga
    // cada campo a mano y un `undefined` en better-sqlite3 no se convierte en NULL: revienta.
    const response = await call('POST', '/ingredients', {
      name: 'Pimentón de la Vera',
      quantity: 1,
      category: 'other',
      unit: 'unit'
    });
    expect(response.status).toBe(201);
    const saved = await data(response);
    const column = (row: any, camel: string, snake: string) => row[camel] ?? row[snake] ?? null;
    expect(column(saved, 'expirationDate', 'expiration_date')).toBeNull();
    expect(saved.notes ?? null).toBeNull();

    // Escribir la caducidad y luego vaciarla: `null` borra, `undefined` no toca.
    const withDate = await data(
      await call('PATCH', `/ingredients/${saved.id}`, { expirationDate: dayFromNow(3) })
    );
    expect(column(withDate, 'expirationDate', 'expiration_date')).toBe(dayFromNow(3));
    const cleared = await data(
      await call('PATCH', `/ingredients/${saved.id}`, { expirationDate: null })
    );
    expect(column(cleared, 'expirationDate', 'expiration_date')).toBeNull();
    // Y una clave ausente en el mismo PATCH no se lleva por delante las notas escritas antes.
    const noted = await data(
      await call('PATCH', `/ingredients/${saved.id}`, { notes: 'para el gazpacho' })
    );
    expect(noted.notes).toBe('para el gazpacho');
    const untouched = await data(await call('PATCH', `/ingredients/${saved.id}`, { quantity: 2 }));
    expect(untouched.notes).toBe('para el gazpacho');
  });

  it('inicia la búsqueda de imagen en background sin retrasar el alta del inventario', async () => {
    const creado = await call('POST', '/ingredients', {
      name: 'Producto sintético para imagen',
      category: 'other',
      quantity: 1,
      unit: 'unit'
    });
    expect(creado.status).toBe(201);
    const ingredient = await data(creado);
    const queued = db
      .prepare('SELECT job_id, status FROM product_image_searches WHERE ingredient_id = ?')
      .get(ingredient.id) as { job_id: string; status: string } | undefined;
    expect(queued?.job_id).toBeTruthy();
    expect(['queued', 'running', 'complete']).toContain(queued?.status);

    const startedAt = Date.now();
    let status = queued?.status;
    while (status !== 'complete' && Date.now() - startedAt < 2500) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = (
        db
          .prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?')
          .get(ingredient.id) as { status: string } | undefined
      )?.status;
    }
    expect(status).toBe('complete');
    const candidates = db
      .prepare('SELECT candidates_json FROM product_image_searches WHERE ingredient_id = ?')
      .get(ingredient.id) as { candidates_json: string } | undefined;
    expect(JSON.parse(candidates?.candidates_json ?? '[]')).toHaveLength(10);
  });
});

describe('el stepper de la fila puede bajar a 0 (## 12aa)', () => {
  it('quantity 0 se guarda, la casilla vacia cae a 0 y la fila no se borra', async () => {
    // El visor promete que bajar a 0 devuelve el articulo a «lo que la casa conoce» sin borrarlo. El alta
    // exige >= 1 (la cantidad vacia no es un ingrediente, es una sugerencia), pero el stepper necesita
    // escribir el 0 por el PATCH de toda la vida, que era `formPartial(create)` y se comia el `.positive()`
    // del alta: la fila se quedaba en 1 sin decir nada (el 400 no tenia ni destinatario en el cliente).
    const saved = await data(
      await call('POST', '/ingredients', {
        name: 'Tomate sin botes',
        quantity: 1,
        category: 'other',
        unit: 'g'
      })
    );
    const cero = await data(await call('PATCH', `/ingredients/${saved.id}`, { quantity: 0 }));
    expect(cero.quantity).toBe(0);
    // `null` —la casilla vaciada a mano— cae a 0: «sin existencias» es lo mismo que 0 aqui, y la columna
    // es NOT NULL, asi que el hueco tiene que elegir un lado. Elige el 0, no el 500.
    const vacio = await data(
      await call('PATCH', `/ingredients/${saved.id}`, {
        quantity: null,
        notes: 'el ultimo bote, al armario'
      })
    );
    expect(vacio.quantity).toBe(0);
    expect(vacio.notes).toBe('el ultimo bote, al armario');
    // Y la fila sigue viva: el 0 la mueve de seccion, no de tabla.
    const lista = await data(await call('GET', '/ingredients'));
    expect(namesOf(lista)).toContain('Tomate sin botes');
  });
});

describe('utensilios', () => {
  it('crea, filtra, actualiza y borra utensilios de la casa', async () => {
    const ollaResponse = await call('POST', '/utensils', {
      name: 'Olla sintética',
      category: 'cookware',
      available: false,
      notes: 'Fixture de prueba'
    });
    expect(ollaResponse.status).toBe(201);
    const olla = await data(ollaResponse);
    expect(olla.name).toBe('Olla sintética');
    expect(olla.available).toBe(0);

    const cuchilloResponse = await call('POST', '/utensils', {
      name: 'Cuchillo sintético',
      category: 'tools'
    });
    expect(cuchilloResponse.status).toBe(201);
    const cuchillo = await data(cuchilloResponse);
    expect(cuchillo.available).toBe(1);

    const all = await data(await call('GET', '/utensils'));
    expect(all.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([olla.id, cuchillo.id])
    );
    expect(
      (await data(await call('GET', '/utensils?search=Olla'))).map(
        (item: { id: string }) => item.id
      )
    ).toEqual([olla.id]);
    expect(
      (await data(await call('GET', '/utensils?category=cookware'))).map(
        (item: { id: string }) => item.id
      )
    ).toEqual([olla.id]);
    expect(
      (await data(await call('GET', '/utensils?available=false'))).map(
        (item: { id: string }) => item.id
      )
    ).toEqual([olla.id]);
    expect(
      (await data(await call('GET', '/utensils?available=true'))).map(
        (item: { id: string }) => item.id
      )
    ).toEqual([cuchillo.id]);

    const updatedResponse = await call('PATCH', `/utensils/${olla.id}`, {
      name: 'Olla sintética nueva',
      category: 'bakeware',
      available: true,
      notes: 'Actualizada'
    });
    expect(updatedResponse.status).toBe(200);
    expect(await data(updatedResponse)).toMatchObject({
      name: 'Olla sintética nueva',
      category: 'bakeware',
      available: 1,
      notes: 'Actualizada'
    });
    expect(
      (
        await data(await call('GET', '/utensils?search=nueva&category=bakeware&available=true'))
      ).map((item: { id: string }) => item.id)
    ).toEqual([olla.id]);

    const deleted = await call('DELETE', `/utensils/${olla.id}`);
    expect(deleted.status).toBe(200);
    expect(
      (await data(await call('GET', '/utensils?search=nueva'))).map(
        (item: { id: string }) => item.id
      )
    ).toEqual([]);
    expect((await call('DELETE', `/utensils/${olla.id}`)).status).toBe(404);
  });
});

describe('lectura, borrado y filtros del inventario', () => {
  it('lee y borra una ficha propia, y devuelve 404 al volver a leerla', async () => {
    const ingredient = await addIngredient('Producto sintético de lectura', null);

    const detail = await call('GET', `/ingredients/${ingredient.id}`);
    expect(detail.status).toBe(200);
    expect(await data(detail)).toMatchObject({
      id: ingredient.id,
      name: 'Producto sintético de lectura'
    });

    const deleted = await call('DELETE', `/ingredients/${ingredient.id}`);
    expect(deleted.status).toBe(200);
    expect((await json(deleted)).success).toBe(true);
    const missing = await call('GET', `/ingredients/${ingredient.id}`);
    expect(missing.status).toBe(404);
  });

  it('combina búsqueda, categoría, ubicación y paginación permitidas por el contrato', async () => {
    // El alta de ruta siembra las categorías iniciales; las otras filas son fixtures mínimos y
    // evitan arrancar trabajos auxiliares de imagen para cada resultado del filtro.
    await addIngredient('Avena desayuno', null);
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, location)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
    ).run('filter-counter', alice.id, 'Avena tostada', 'dairy', 1, 'unit', 'counter');
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, location)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
    ).run('filter-pantry', alice.id, 'Arroz integral', 'other', 1, 'kg', 'pantry');

    const filtered = await data(
      await call(
        'GET',
        '/ingredients?search=Avena&category=dairy&location=counter&page=1&pageSize=1'
      )
    );
    expect(namesOf(filtered)).toEqual(['Avena tostada']);
    expect(filtered).toMatchObject({ total: 1, page: 1, pageSize: 1, totalPages: 1 });

    const secondPage = await data(await call('GET', '/ingredients?page=2&pageSize=1'));
    expect(secondPage).toMatchObject({ total: 3, page: 2, pageSize: 1, totalPages: 3 });
    expect(namesOf(secondPage)).toHaveLength(1);

    const location = await data(await call('GET', '/ingredients?location=pantry'));
    expect(namesOf(location)).toEqual(['Arroz integral']);
  });
});

describe('aislamiento por hogar activo', () => {
  it('lista solo inventario personal y del hogar seleccionado; bloquea leer y modificar la casa anterior', async () => {
    const oldHouse = `old-${Math.random().toString(36).slice(2)}`;
    const activeHouse = `active-${Math.random().toString(36).slice(2)}`;
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      oldHouse,
      'Casa anterior sintética',
      `${oldHouse}-invite`
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      activeHouse,
      'Casa activa sintética',
      `${activeHouse}-invite`
    );
    const aliceOldMembership = `alice-old-${oldHouse}`;
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run(aliceOldMembership, oldHouse, alice.id);
    const bob = await makeUser(`bob-${Math.random().toString(36).slice(2)}@test.local`);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run(`bob-active-${activeHouse}`, activeHouse, bob.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run(`alice-active-${activeHouse}`, activeHouse, alice.id);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(activeHouse, alice.id);
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
       VALUES ('old-house-product', ?, ?, 'Producto anterior', 'other', 1, 'unit')`
    ).run(alice.id, oldHouse);
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
       VALUES ('active-house-product', ?, ?, 'Producto compartido actual', 'other', 2, 'unit')`
    ).run(bob.id, activeHouse);
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
       VALUES ('personal-product', ?, NULL, 'Producto personal', 'other', 3, 'unit')`
    ).run(alice.id);
    for (const [suffix, owner, householdId] of [
      ['active', bob.id, activeHouse],
      ['old', alice.id, oldHouse],
      ['personal', alice.id, null]
    ] as const) {
      db.prepare(
        'INSERT INTO shopping_lists (id, user_id, household_id, name) VALUES (?, ?, ?, ?)'
      ).run(`impact-list-${suffix}`, owner, householdId, `Lista ${suffix}`);
      db.prepare(
        `INSERT INTO shopping_list_items (id, list_id, name, product_key, quantity)
         VALUES (?, ?, ?, ?, 1)`
      ).run(
        `impact-line-${suffix}`,
        `impact-list-${suffix}`,
        'Producto compartido actual',
        'producto compartido actual'
      );
      db.prepare(
        `INSERT INTO price_observations
           (id, user_id, household_id, product_key, product_name, price_minor, quantity)
         VALUES (?, ?, ?, ?, ?, 100, 1)`
      ).run(
        `impact-price-${suffix}`,
        owner,
        householdId,
        'producto compartido actual',
        'Producto compartido actual'
      );
    }
    db.prepare(
      `INSERT INTO utensils (id, user_id, household_id, name, category)
       VALUES ('old-house-utensil', ?, ?, 'Utensilio anterior', 'cookware')`
    ).run(alice.id, oldHouse);

    const list = await data(await call('GET', '/ingredients'));
    const stats = await data(await call('GET', '/ingredients/stats'));
    const expiry = await data(await call('GET', '/expiry'));
    const utensils = await data(await call('GET', '/utensils'));
    const oldDetail = await call('GET', '/ingredients/old-house-product');
    const oldUpdate = await call('PATCH', '/ingredients/old-house-product', { quantity: 8 });
    const oldUtensilDelete = await call('DELETE', '/utensils/old-house-utensil');

    expect(namesOf(list).sort()).toEqual(
      ['Producto compartido actual', 'Producto personal'].sort()
    );
    expect(stats.total).toBe(2);
    expect(expiry.map((item: { id: string }) => item.id).sort()).toEqual(
      ['active-house-product', 'personal-product'].sort()
    );
    expect(utensils.map((item: { id: string }) => item.id)).not.toContain('old-house-utensil');
    const impact = await data(await call('GET', '/products/active-house-product/delete-impact'));
    const products = await data(await call('GET', '/products?limit=100'));
    expect(impact.listLines).toBe(2);
    expect(impact.priceObservations).toBe(2);
    const activeProduct = products.find(
      (item: { id: string }) => item.id === 'active-house-product'
    );
    expect(activeProduct.impact).toEqual({ listLines: 2, priceObservations: 2 });
    expect(oldDetail.status).toBe(404);
    expect(oldUpdate.status).toBe(404);
    expect(oldUtensilDelete.status).toBe(404);
    expect(
      db.prepare('SELECT quantity FROM ingredients WHERE id = ?').get('old-house-product')
    ).toEqual({ quantity: 1 });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM utensils WHERE id = ?').get('old-house-utensil')
    ).toEqual({
      n: 1
    });

    db.prepare('UPDATE households SET shared_pantry = 0 WHERE id = ?').run(activeHouse);
    const privateList = await data(await call('GET', '/ingredients'));
    const privateStats = await data(await call('GET', '/ingredients/stats'));
    expect(namesOf(privateList)).toEqual(['Producto personal']);
    expect(privateStats.total).toBe(1);

    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(alice.id);
    const unselectedRead = await call('GET', '/ingredients');
    const unselectedWrite = await call('POST', '/ingredients', {
      name: 'Producto sin hogar activo',
      category: 'other',
      quantity: 1,
      unit: 'unit'
    });
    expect(unselectedRead.status).toBe(409);
    expect(unselectedWrite.status).toBe(409);
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM ingredients WHERE name = ?')
        .get('Producto sin hogar activo')
    ).toEqual({ n: 0 });

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(activeHouse, alice.id);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(oldHouse, alice.id);
    const returned = await data(await call('GET', '/ingredients'));
    expect(namesOf(returned).sort()).toEqual(['Producto anterior', 'Producto personal'].sort());
  });
});

describe('gestor del catálogo de categorías', () => {
  it('crea, filtra, actualiza y elimina categorías con los bloqueos del catálogo', async () => {
    const initial = await data(await call('GET', '/categories?limit=100'));
    const root = initial.find((category: { key: string }) => category.key === 'alimentos');
    const fallback = initial.find((category: { key: string }) => category.key === 'other');
    expect(root).toBeDefined();
    expect(fallback).toBeDefined();

    const createResponse = await call('POST', '/categories', {
      name: 'Granos de prueba',
      parentKey: root.key,
      color: '#123456',
      description: 'Categoría sintética'
    });
    expect(createResponse.status).toBe(201);
    const created = await data(createResponse);
    expect(created).toMatchObject({
      key: 'granos de prueba',
      parentKey: 'alimentos',
      color: '#123456'
    });

    expect((await call('POST', '/categories', { name: 'Granos de prueba' })).status).toBe(409);
    expect(
      (await call('POST', '/categories', { name: 'Sin padre', parentKey: 'missing-parent' })).status
    ).toBe(404);
    const withChildren = await data(await call('GET', '/categories?view=with-children&limit=100'));
    expect(withChildren.map((category: { key: string }) => category.key)).toContain('alimentos');
    const search = await data(await call('GET', '/categories?q=granos&limit=100'));
    expect(search.map((category: { key: string }) => category.key)).toEqual(['granos de prueba']);
    const page = await json(await call('GET', '/categories?limit=2&offset=1'));
    expect(page.meta).toMatchObject({ limit: 2, offset: 1 });
    expect(page.hasMore).toBe(true);

    const updated = await data(
      await call('PATCH', `/categories/${created.id}`, { color: '#654321', description: null })
    );
    expect(updated).toMatchObject({ key: 'granos de prueba', color: '#654321', description: null });
    expect(
      (await call('PATCH', `/categories/${created.id}`, { parentKey: 'missing-parent' })).status
    ).toBe(404);
    expect(
      (await call('PATCH', `/categories/${fallback.id}`, { name: 'Reserva rota' })).status
    ).toBe(409);
    expect((await call('DELETE', `/categories/${fallback.id}`)).status).toBe(409);
    expect((await call('GET', '/categories/not-a-real-id/delete-impact')).status).toBe(404);

    const impact = await data(await call('GET', `/categories/${created.id}/delete-impact`));
    expect(impact).toMatchObject({ canDelete: true, products: 0, children: 0 });
    expect((await call('DELETE', `/categories/${created.id}`)).status).toBe(204);
    expect((await call('DELETE', `/categories/${created.id}`)).status).toBe(404);
  });

  it('bloquea renombrar categorías repetidas y borrar una categoría usada', async () => {
    const initial = await data(await call('GET', '/categories?limit=100'));
    const dairy = initial.find((category: { key: string }) => category.key === 'dairy');
    const vegetables = initial.find((category: { key: string }) => category.key === 'vegetables');
    const collision = await call('PATCH', `/categories/${dairy.id}`, { name: 'vegetables' });
    expect(collision.status).toBe(409);

    const ingredient = await addIngredient('Yogur bajo categoría', null);
    const impact = await data(await call('GET', `/categories/${dairy.id}/delete-impact`));
    expect(impact).toMatchObject({ canDelete: false, products: 1 });
    const deleted = await call('DELETE', `/categories/${dairy.id}`);
    expect(deleted.status).toBe(409);
    expect((await json(deleted)).error).toBe('PANTRY_CATEGORY_IN_USE');
    expect(
      (await call('PATCH', `/categories/${vegetables.id}`, { name: 'Verduras renombradas' })).status
    ).toBe(200);
    expect(ingredient.id).toBeTruthy();
  });
});

describe('gestor de productos principales', () => {
  it('crea e idempotentemente encuentra productos, los filtra, edita y borra con impacto', async () => {
    const firstResponse = await call('POST', '/products', {
      name: 'Arroz jazmín sintético',
      category: 'grains',
      quantity: 0,
      unit: 'kg',
      aliases: [
        'arroz aromático',
        ' arroz aromático ',
        'ARROZ JAZMÍN SINTÉTICO',
        'arroz aromático'
      ],
      notes: 'Marca ficticia'
    });
    expect(firstResponse.status).toBe(201);
    const first = await data(firstResponse);
    expect(first).toMatchObject({ created: true, categoryName: 'Cereales', inPantry: false });
    expect(first.aliases).toEqual(['arroz aromático']);

    const duplicate = await call('POST', '/products', {
      name: ' arroz jazmín sintético ',
      category: 'grains'
    });
    expect(duplicate.status).toBe(200);
    expect((await data(duplicate)).created).toBe(false);
    const conflict = await call('POST', '/products', {
      name: 'Producto distinto',
      category: 'other',
      aliases: ['Arroz jazmín sintético']
    });
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).error).toBe('PANTRY_PRODUCT_ALIAS_CLASH');
    expect(
      (await call('POST', '/products', { name: 'Categoría inválida', category: 'unknown' })).status
    ).toBe(400);

    const inStockResponse = await call('POST', '/products', {
      name: 'Queso de prueba',
      category: 'dairy',
      quantity: 2,
      expirationDate: dayFromNow(1),
      barcode: '111222333',
      location: 'fridge'
    });
    const inStock = await data(inStockResponse);
    expect(inStockResponse.status).toBe(201);
    expect(
      (await data(await call('GET', '/products?filter=staples'))).map(
        (item: { id: string }) => item.id
      )
    ).toContain(first.id);
    expect(
      (await data(await call('GET', '/products?filter=in-pantry'))).map(
        (item: { id: string }) => item.id
      )
    ).toContain(inStock.id);
    expect(
      (await data(await call('GET', '/products?filter=expiring'))).map(
        (item: { id: string }) => item.id
      )
    ).toContain(inStock.id);
    expect(
      (await data(await call('GET', '/products?q=aromático&category=alimentos'))).map(
        (item: { id: string }) => item.id
      )
    ).toContain(first.id);
    const page = await json(await call('GET', '/products?limit=1&offset=1&sort=recent'));
    expect(page.meta).toMatchObject({ total: 2, limit: 1, offset: 1 });

    const detail = await data(await call('GET', `/products/${inStock.id}`));
    expect(detail).toMatchObject({
      id: inStock.id,
      impact: { listLines: 0, priceObservations: 0 }
    });
    expect((await call('GET', '/products/missing-product')).status).toBe(404);
    const impact = await data(await call('GET', `/products/${inStock.id}/delete-impact`));
    expect(impact).toMatchObject({ quantity: 2, canDelete: false });
    expect((await call('DELETE', `/products/${inStock.id}`)).status).toBe(409);

    const updated = await data(
      await call('PATCH', `/products/${inStock.id}`, {
        name: 'Queso corregido',
        category: 'dairy',
        notes: null,
        aliases: null,
        expirationDate: null,
        location: 'pantry',
        barcode: ''
      })
    );
    expect(updated).toMatchObject({
      name: 'Queso corregido',
      notes: null,
      aliases: [],
      expirationDate: null,
      location: 'pantry',
      barcode: null
    });
    expect((await call('PATCH', `/products/${inStock.id}`, {})).status).toBe(400);
    expect((await call('PATCH', '/products/missing-product', { notes: 'x' })).status).toBe(404);

    db.prepare('UPDATE ingredients SET quantity = 0 WHERE id = ?').run(first.id);
    const deleted = await call('DELETE', `/products/${first.id}`);
    expect(deleted.status).toBe(204);
    expect((await call('GET', `/products/${first.id}`)).status).toBe(404);
  });

  it('revisa lotes de borrado de forma atómica y omite ids ajenos', async () => {
    const deletable = await data(
      await call('POST', '/products', { name: 'Producto libre', category: 'other' })
    );
    const stocked = await data(
      await call('POST', '/products', {
        name: 'Producto con stock',
        category: 'other',
        quantity: 3
      })
    );
    const impact = await data(
      await call('POST', '/products/bulk-delete-impact', {
        ids: [deletable.id, stocked.id, 'id-ajeno']
      })
    );
    expect(impact).toMatchObject({
      requestedCount: 3,
      deletableIds: [deletable.id],
      canDelete: false
    });
    expect(impact.blocked).toHaveLength(1);

    const blocked = await call('POST', '/products/bulk-delete', {
      ids: [deletable.id, stocked.id]
    });
    expect(blocked.status).toBe(409);
    expect((await call('GET', `/products/${deletable.id}`)).status).toBe(200);

    db.prepare('UPDATE ingredients SET quantity = 0 WHERE id = ?').run(stocked.id);
    const completed = await data(
      await call('POST', '/products/bulk-delete', { ids: [deletable.id, stocked.id, 'id-ajeno'] })
    );
    expect(completed.deleted).toBe(2);
    expect(
      (await call('POST', '/products/bulk-delete-impact', { ids: [deletable.id] }).then(data))
        .canDelete
    ).toBe(false);
  });
});

describe('catálogo de productos pre-registrado', () => {
  it('busca el catálogo y añade lotes sin duplicar ni reponer existencias', async () => {
    const categories = await data(await call('GET', '/catalog/categories'));
    expect(categories.length).toBeGreaterThan(10);
    const foods = categories.find((category: { key: string }) => category.key === 'alimentos');
    expect(foods?.productCount).toBeGreaterThan(0);

    const initialResponse = await call(
      'GET',
      '/catalog/products?q=tomate&category=vegetables&limit=10'
    );
    const initialEnvelope = await json(initialResponse);
    expect(initialEnvelope.meta.total).toBeGreaterThan(0);
    expect(initialEnvelope.data[0].category).toBe('vegetables');
    const item = initialEnvelope.data[0];
    const emptyEnvelope = await json(
      await call('GET', '/catalog/products?q=sin-resultados-xyz&limit=2&offset=0')
    );
    expect(emptyEnvelope.meta.total).toBe(0);
    expect(emptyEnvelope.data).toEqual([]);
    expect((await call('POST', '/catalog/add', { ids: ['unknown-id'] })).status).toBe(400);
    expect((await data(await call('GET', '/ingredients'))).total).toBe(0);

    const first = await data(await call('POST', '/catalog/add', { ids: [item.id, item.id] }));
    expect(first).toMatchObject({ added: 1, skipped: 0 });
    const added = await data(await call('GET', '/ingredients?search=tomate'));
    expect(added.total).toBe(1);
    const ingredient = added.ingredients[0];
    const skipped = await data(await call('POST', '/catalog/add', { ids: [item.id] }));
    expect(skipped).toMatchObject({ added: 0, skipped: 1 });

    db.prepare('UPDATE ingredients SET quantity = 0 WHERE id = ?').run(ingredient.id);
    const restored = await data(await call('POST', '/catalog/add', { ids: [item.id] }));
    expect(restored).toMatchObject({ added: 1, skipped: 0 });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM ingredients WHERE id = ?').get(ingredient.id)
    ).toEqual({ count: 1 });
    expect(db.prepare('SELECT quantity FROM ingredients WHERE id = ?').get(ingredient.id)).toEqual({
      quantity: 1
    });
  });
});

describe('estimación de caducidades', () => {
  it('resuelve catálogo de bolsillo sin proveedor y deja vacío si no hay candidatos', async () => {
    expect(await data(await call('POST', '/expiry/estimate'))).toEqual({
      catalogo: 0,
      ia: 0,
      sinEstimar: 0,
      sinFecha: 0
    });
    await addIngredient('Pan de barra', null);
    const response = await data(await call('POST', '/expiry/estimate'));
    expect(response).toEqual({ catalogo: 1, ia: 0, sinEstimar: 0, sinFecha: 1 });
  });

  it('sin configuración devuelve conflicto explícito para productos fuera del catálogo', async () => {
    const ingredient = await addIngredient('Ingrediente sin vida útil conocida', null);
    const response = await call('POST', '/expiry/estimate');
    expect(response.status).toBe(409);
    expect((await json(response)).error).toBe('NO_CONFIG');
    expect(
      db.prepare('SELECT estimated_shelf_days FROM ingredients WHERE id = ?').get(ingredient.id)
    ).toEqual({
      estimated_shelf_days: null
    });
  });
});
