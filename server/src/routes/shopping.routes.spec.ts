import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { ReadableStream } from 'node:stream/web';
import { zoneStampValue } from '../middleware/timestamp.middleware.js';

/**
 * Lista de la compra y precios, sobre una BD en memoria real (nada de mocks de
 * SQL): lo que se quiere probar aqui es la interaccion entre el CAS de la lista,
 * el dedupeo por clave normalizada, el borrado logico que sostiene el «Deshacer»
 * y las unidades del dinero. Un mock no se entera de ninguna de esas cuatro.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let app: Hono;
let db: Sql;
let closeDatabase: () => void;

/** Usuario nuevo + token firmado, que es lo que hace `authMiddleware`. */
async function makeUser(email: string, householdId: string | null = null) {
  const id = `u-${email.split('@')[0]}`;
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email, 'Comprador', 'hash', householdId);
  if (householdId && db.prepare('SELECT 1 FROM households WHERE id = ?').get(householdId)) {
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run(`member-${id}`, householdId, id);
  }
  const config = await import('../config/app.config.js');
  const token = jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' });
  return { id, token };
}

type User = { id: string; token: string };

function call(
  user: User,
  method: string,
  path: string,
  body?: unknown,
  language = 'es',
  extraHeaders: Record<string, string> = {}
) {
  return app.request(`/api/shopping${path}`, {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json',
      'x-app-language': language,
      ...extraHeaders
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

/** `Response.json()` es `unknown` en TS; aqui se ancha a `any` una vez y se
 *  leen campos de payloads que la propia prueba construye. */
const json = async (response: Response): Promise<any> => await response.json();
const data = async (response: Response): Promise<any> => (await json(response)).data;

let alice: User;
let bob: User;

beforeEach(async () => {
  db.exec(
    'DELETE FROM shopping_list_events; DELETE FROM shopping_list_discounts; DELETE FROM shopping_list_items; DELETE FROM price_observations; DELETE FROM shopping_lists; DELETE FROM shopping_categories;'
  );
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
  bob = await makeUser(`bob-${Math.random().toString(36).slice(2)}@test.local`);
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
  // La cadena de pruebas es la de `app.ts`: sin este middleware, las pruebas podrian seguir
  // asumiendo que un timestamp sin zona es un contrato valido, y no lo es.
  app.use('/api/*', timestampMiddleware());
  app.route('/api/shopping', shoppingRoutes);
});

afterAll(() => closeDatabase?.());

async function createList(user: User, name = 'Compra semana') {
  const response = await call(user, 'POST', '/lists', { name });
  return await data(response);
}

describe('/lists', () => {
  it('crea y lee una lista con su version inicial y sus totales a cero', async () => {
    const list = await createList(alice);

    expect(list.name).toBe('Compra semana');
    expect(list.version).toBe(1);
    expect(list.status).toBe('active');
    expect(list.totalItems).toBe(0);

    const fetched = await data(await call(alice, 'GET', `/lists/${list.id}`));
    expect(fetched.items).toEqual([]);
  });

  it('requiere autenticacion', async () => {
    const response = await app.request('/api/shopping/lists');
    expect(response.status).toBe(401);
  });

  it('no muestra a nadie la lista de otro usuario', async () => {
    const list = await createList(alice);

    expect((await call(bob, 'GET', `/lists/${list.id}`)).status).toBe(404);
    expect((await call(bob, 'DELETE', `/lists/${list.id}`)).status).toBe(404);
    const visible = await data(await call(bob, 'GET', '/lists'));
    expect(visible).toEqual([]);
  });

  it('al cambiar de hogar no filtra listas domésticas previas por ser su creador', async () => {
    const firstHouseholdId = `h-shopping-first-${Math.random().toString(36).slice(2)}`;
    const secondHouseholdId = `h-shopping-second-${Math.random().toString(36).slice(2)}`;
    const insertHousehold = db.prepare(
      'INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)'
    );
    insertHousehold.run(firstHouseholdId, 'Casa compra uno', `${firstHouseholdId}-code`);
    insertHousehold.run(secondHouseholdId, 'Casa compra dos', `${secondHouseholdId}-code`);

    alice = await makeUser(
      `alice-context-${Math.random().toString(36).slice(2)}@test.local`,
      firstHouseholdId
    );
    const firstHouseList = await createList(alice, 'Lista privada de casa uno');

    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run(`member-${alice.id}-${secondHouseholdId}`, secondHouseholdId, alice.id);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(secondHouseholdId, alice.id);
    const secondHouseList = await createList(alice, 'Lista compartida de casa dos');

    const visibleAfterSwitch = await data(await call(alice, 'GET', '/lists'));
    expect(visibleAfterSwitch.map((list: any) => list.name)).toEqual([
      'Lista compartida de casa dos'
    ]);
    expect((await call(alice, 'GET', `/lists/${firstHouseList.id}`)).status).toBe(404);
    expect((await call(alice, 'GET', `/lists/${secondHouseList.id}`)).status).toBe(200);

    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(alice.id);
    const unselectedLists = await call(alice, 'GET', '/lists');
    expect(unselectedLists.status).toBe(409);
    expect(await json(unselectedLists)).toMatchObject({ code: 'HOUSEHOLD_SELECTION_REQUIRED' });
    expect((await call(alice, 'GET', `/lists/${secondHouseList.id}`)).status).toBe(409);
  });

  it('filtra por estado y por busqueda, y paginacion acotada', async () => {
    await createList(alice, 'Fruta');
    await createList(alice, 'Limpieza');
    const done = await createList(alice, 'Vacaciones');
    await call(alice, 'PATCH', `/lists/${done.id}`, { status: 'done', version: done.version });

    // `updated_at` es CURRENT_TIMESTAMP (segundos): dos listas creadas en la misma
    // segunda empatan, y el empate se rompe por id (nanoid aleatorio), que no
    // significa nada. Se fija el tiempo a mano para probar la regla real:
    // actualizadas hace mas poco primero, y las `done` fuera de la vista comun.
    db.prepare(`UPDATE shopping_lists SET updated_at = '2026-01-01' WHERE name = 'Fruta'`).run();
    db.prepare(`UPDATE shopping_lists SET updated_at = '2026-01-02' WHERE name = 'Limpieza'`).run();

    const active = await data(await call(alice, 'GET', '/lists'));
    expect(active.map((l: any) => l.name)).toEqual(['Limpieza', 'Fruta']);

    const buscada = await data(await call(alice, 'GET', '/lists?q=frut'));
    expect(buscada).toHaveLength(1);

    const terminadas = await data(await call(alice, 'GET', '/lists?status=done'));
    expect(terminadas.map((l: any) => l.name)).toEqual(['Vacaciones']);

    // `limit` fuera de rango se acota, no se propaga a SQL.
    const limited = await call(alice, 'GET', '/lists?limit=99999&offset=-4');
    expect(limited.ok).toBe(true);
    expect((await json(limited)).meta.limit).toBeLessThanOrEqual(200);
  });

  it('toca el nombre con CAS y rechaza la version rancia', async () => {
    const list = await createList(alice);

    const ok = await data(
      await call(alice, 'PATCH', `/lists/${list.id}`, { name: 'Compra + pan', version: 1 })
    );
    expect(ok.version).toBe(2);

    // Un body solo se lee una vez: releerlo daria 'Body has already been read'.
    const stale = await json(
      await call(alice, 'PATCH', `/lists/${list.id}`, { name: 'Choque', version: 1 })
    );
    expect(stale.message).toBe('LIST_VERSION_CONFLICT');
    expect(stale.data.currentVersion).toBe(2);
  });

  it('edita una lista revisada con CAS e idempotencia en un endpoint exclusivo del asistente', async () => {
    const list = await data(
      await call(alice, 'POST', '/lists', { name: 'Compra semanal', store: 'Lidl' })
    );
    const actionId = '123e4567-e89b-42d3-a456-426614174000';
    const headers = {
      'x-assistant-action-id': actionId,
      'x-assistant-household-id': ''
    };
    const body = {
      version: list.version,
      changes: { name: 'Compra del sábado', store: null },
      assistantAction: {
        operation: 'update_list',
        targetId: list.id,
        before: { name: list.name, store: list.store }
      }
    };
    const eventCount = () =>
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM shopping_list_events WHERE list_id = ?')
          .get(list.id) as { count: number }
      ).count;

    const eventsBefore = eventCount();
    const first = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      body,
      'es',
      headers
    );
    expect(first.status).toBe(200);
    expect(await data(first)).toMatchObject({
      name: 'Compra del sábado',
      store: null,
      version: list.version + 1
    });
    expect(eventCount()).toBe(eventsBefore + 1);

    const replay = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      body,
      'es',
      headers
    );
    expect(replay.status).toBe(200);
    expect(await json(replay)).toMatchObject({ success: true, idempotent: true });
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).version).toBe(
      list.version + 1
    );
    expect(eventCount()).toBe(eventsBefore + 1);

    const changedReplay = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      { ...body, changes: { name: 'Otro nombre' } },
      'es',
      headers
    );
    expect(changedReplay.status).toBe(409);
    expect(await json(changedReplay)).toMatchObject({ code: 'ASSISTANT_ACTION_ID_CONFLICT' });
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).name).toBe(
      'Compra del sábado'
    );
    expect(eventCount()).toBe(eventsBefore + 1);
  });

  it('rechaza targets obsoletos, no activos o ajenos sin ledger ni efectos laterales', async () => {
    const list = await createList(alice, 'Lista segura');
    const staleBody = {
      version: list.version,
      changes: { name: 'Nombre obsoleto' },
      assistantAction: {
        operation: 'update_list',
        targetId: list.id,
        before: { name: list.name, store: list.store }
      }
    };
    const header = (id: string, household = '') => ({
      'x-assistant-action-id': id,
      'x-assistant-household-id': household
    });
    db.prepare('UPDATE shopping_lists SET version = version + 1, store = ? WHERE id = ?').run(
      'Competidor',
      list.id
    );
    const eventsBefore = (
      db
        .prepare('SELECT COUNT(*) AS count FROM shopping_list_events WHERE list_id = ?')
        .get(list.id) as {
        count: number;
      }
    ).count;

    const stale = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      staleBody,
      'es',
      header('223e4567-e89b-42d3-a456-426614174000')
    );
    expect(stale.status).toBe(409);
    expect(
      db.prepare('SELECT name, store, version FROM shopping_lists WHERE id = ?').get(list.id)
    ).toEqual({
      name: 'Lista segura',
      store: 'Competidor',
      version: list.version + 1
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM assistant_action_results WHERE action_id = ?')
        .get('223e4567-e89b-42d3-a456-426614174000')
    ).toEqual({ count: 0 });
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM shopping_list_events WHERE list_id = ?')
          .get(list.id) as {
          count: number;
        }
      ).count
    ).toBe(eventsBefore);

    const missingActionId = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      staleBody,
      'es',
      { 'x-assistant-household-id': '' }
    );
    expect(missingActionId.status).toBe(400);

    const extraField = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      {
        ...staleBody,
        changes: { status: 'done' }
      },
      'es',
      header('323e4567-e89b-42d3-a456-426614174000')
    );
    expect(extraField.status).toBe(400);

    expect(
      (
        await call(
          bob,
          'PATCH',
          `/lists/${list.id}/assistant-update`,
          staleBody,
          'es',
          header('423e4567-e89b-42d3-a456-426614174000')
        )
      ).status
    ).toBe(404);
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).name).toBe('Lista segura');
  });

  it('no convierte una tienda vacía en texto vacío: exige null para borrarla', async () => {
    const list = await createList(alice, 'Lista sin tienda');
    const response = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      {
        version: list.version,
        changes: { store: '   ' },
        assistantAction: {
          operation: 'update_list',
          targetId: list.id,
          before: { name: list.name, store: null }
        }
      },
      'es',
      {
        'x-assistant-action-id': '523e4567-e89b-42d3-a456-426614174000',
        'x-assistant-household-id': ''
      }
    );

    expect(response.status).toBe(400);
    expect(await data(await call(alice, 'GET', `/lists/${list.id}`))).toMatchObject({
      store: null,
      version: list.version
    });
  });

  it('no permite editar una lista personal con el ámbito de un hogar seleccionado', async () => {
    const list = await createList(alice, 'Lista personal');
    const householdId = `assistant-scope-${Math.random().toString(36).slice(2)}`;
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      householdId,
      'Casa del asistente',
      `${householdId}-code`
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run(`member-${householdId}`, householdId, alice.id);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, alice.id);
    const response = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/assistant-update`,
      {
        version: list.version,
        changes: { name: 'No debe cambiar' },
        assistantAction: {
          operation: 'update_list',
          targetId: list.id,
          before: { name: list.name, store: list.store }
        }
      },
      'es',
      {
        'x-assistant-action-id': '623e4567-e89b-42d3-a456-426614174000',
        'x-assistant-household-id': householdId
      }
    );

    expect(response.status).toBe(404);
    expect(await data(await call(alice, 'GET', `/lists/${list.id}`))).toMatchObject({
      name: list.name,
      version: list.version
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM assistant_action_results WHERE action_id = ?')
        .get('623e4567-e89b-42d3-a456-426614174000')
    ).toEqual({ count: 0 });
  });

  it('revalida el hogar después de leer el body y deja lista, eventos y ledger intactos', async () => {
    const householdId = `assistant-before-${Math.random().toString(36).slice(2)}`;
    const changedHouseholdId = `assistant-after-${Math.random().toString(36).slice(2)}`;
    const insertHousehold = db.prepare(
      'INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)'
    );
    insertHousehold.run(householdId, 'Casa inicial', `${householdId}-code`);
    insertHousehold.run(changedHouseholdId, 'Casa nueva', `${changedHouseholdId}-code`);
    const insertMember = db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    );
    insertMember.run(`member-${householdId}`, householdId, alice.id);
    insertMember.run(`member-${changedHouseholdId}`, changedHouseholdId, alice.id);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, alice.id);
    const list = await createList(alice, 'Lista de casa');
    const actionId = '723e4567-e89b-42d3-a456-426614174000';
    const body = {
      version: list.version,
      changes: { name: 'No debe persistir' },
      assistantAction: {
        operation: 'update_list',
        targetId: list.id,
        before: { name: list.name, store: list.store }
      }
    };
    const eventsBefore = (
      db
        .prepare('SELECT COUNT(*) AS count FROM shopping_list_events WHERE list_id = ?')
        .get(list.id) as {
        count: number;
      }
    ).count;
    let notifyBodyStarted!: () => void;
    let releaseBody!: () => void;
    let hasStarted = false;
    const bodyStarted = new Promise<void>((resolve) => (notifyBodyStarted = resolve));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!hasStarted) {
          hasStarted = true;
          notifyBodyStarted();
        }
        return new Promise<void>((resolve) => {
          releaseBody = () => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
            controller.close();
            resolve();
          };
        });
      }
    });
    const pending = app.fetch(
      new Request(`http://localhost/api/shopping/lists/${list.id}/assistant-update`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${alice.token}`,
          'content-type': 'application/json',
          'x-assistant-action-id': actionId,
          'x-assistant-household-id': householdId
        },
        body: stream,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' })
    );
    await bodyStarted;
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(changedHouseholdId, alice.id);
    releaseBody();
    const response = await pending;

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ code: 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED' });
    expect(
      db.prepare('SELECT name, version FROM shopping_lists WHERE id = ?').get(list.id)
    ).toEqual({
      name: list.name,
      version: list.version
    });
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM shopping_list_events WHERE list_id = ?')
          .get(list.id) as {
          count: number;
        }
      ).count
    ).toBe(eventsBefore);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM assistant_action_results WHERE action_id = ?')
        .get(actionId)
    ).toEqual({ count: 0 });
  });

  it('sin campos que cambiar no escribe nada', async () => {
    const list = await createList(alice);
    const response = await call(alice, 'PATCH', `/lists/${list.id}`, { version: 1 });
    expect(response.status).toBe(400);
  });

  it('borrar la lista se lleva los items y deja los precios aprendidos', async () => {
    const list = await createList(alice);
    const milk = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', priceMinor: 85 })
    );
    // Solo lo COMPRADO aprende precio: una linea pendiente no es un dato de mercado.
    await call(alice, 'PATCH', `/lists/${list.id}/items/${milk.id}`, { checked: true });
    const completed = await call(alice, 'POST', `/lists/${list.id}/complete`);
    expect((await json(completed)).data.pricesRecorded).toBe(1);

    expect((await call(alice, 'DELETE', `/lists/${list.id}`)).ok).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS c FROM shopping_list_items').get()).toEqual({ c: 0 });
    // El precio es conocimiento del hogar: sobrevive a la lista que lo vio nacer.
    expect(db.prepare('SELECT COUNT(*) AS c FROM price_observations').get()).toEqual({ c: 1 });
  });
});

describe('/lists/:id/items', () => {
  it('añade una linea con su clave normalizada y al final del orden', async () => {
    const list = await createList(alice);

    const first = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Tomate', quantity: 2 })
    );
    const second = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche' })
    );

    expect(first.product_key).toBe('tomate');
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(first.merged).toBe(false);
  });

  it('actualiza un artículo revisado con CAS e idempotencia sin volver a sumar la cantidad', async () => {
    const list = await createList(alice, 'Compra semanal');
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Leche',
        quantity: 1,
        unit: 'l',
        category: 'Lácteos'
      })
    );
    const stored = db
      .prepare(
        `SELECT name, product_key AS productKey, quantity, unit, category,
                checked, deleted_at AS deletedAt, updated_at AS updatedAt
           FROM shopping_list_items WHERE id = ?`
      )
      .get(item.id) as {
      name: string;
      productKey: string;
      quantity: number;
      unit: string | null;
      category: string | null;
      checked: number;
      deletedAt: string | null;
      updatedAt: string | null;
    };
    const before = {
      listName: list.name,
      ...stored,
      checked: Boolean(stored.checked),
      updatedAt: zoneStampValue(stored.updatedAt, 'updatedAt') as string | null
    };
    const actionId = '723e4567-e89b-42d3-a456-426614174000';
    const headers = {
      'x-assistant-action-id': actionId,
      'x-assistant-household-id': ''
    };
    const body = {
      version: list.version + 1,
      changes: { quantity: 2, unit: null, category: 'Bebidas' },
      assistantAction: {
        operation: 'update_item',
        targetId: item.id,
        listId: list.id,
        before
      }
    };
    const eventCount = () =>
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM shopping_list_events WHERE list_id = ?')
          .get(list.id) as { count: number }
      ).count;
    const eventsBefore = eventCount();

    const first = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/items/${item.id}/assistant-update`,
      body,
      'es',
      headers
    );

    expect(first.status).toBe(200);
    expect(await data(first)).toMatchObject({
      name: 'Leche',
      quantity: 2,
      unit: null,
      category: 'Bebidas'
    });
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).version).toBe(
      list.version + 2
    );
    expect(eventCount()).toBe(eventsBefore + 1);

    const replay = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/items/${item.id}/assistant-update`,
      body,
      'es',
      headers
    );
    expect(replay.status).toBe(200);
    expect(await json(replay)).toMatchObject({ success: true, idempotent: true });
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).version).toBe(
      list.version + 2
    );
    expect(eventCount()).toBe(eventsBefore + 1);

    const changedReplay = await call(
      alice,
      'PATCH',
      `/lists/${list.id}/items/${item.id}/assistant-update`,
      { ...body, changes: { quantity: 3 } },
      'es',
      headers
    );
    expect(changedReplay.status).toBe(409);
    expect(await json(changedReplay)).toMatchObject({ code: 'ASSISTANT_ACTION_ID_CONFLICT' });
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).items[0]).toMatchObject({
      quantity: 2,
      unit: null,
      category: 'Bebidas'
    });
    expect(eventCount()).toBe(eventsBefore + 1);
  });

  it('rechaza preimagen obsoleta y artículos marcados o borrados sin mutarlos', async () => {
    const list = await createList(alice, 'Compra con cambios concurrentes');
    for (const state of ['stale', 'checked', 'deleted'] as const) {
      const item = await data(
        await call(alice, 'POST', `/lists/${list.id}/items`, {
          name: `Artículo ${state}`,
          quantity: 1
        })
      );
      const stored = db
        .prepare(
          `SELECT name, product_key AS productKey, quantity, unit, category,
                  checked, deleted_at AS deletedAt, updated_at AS updatedAt
             FROM shopping_list_items WHERE id = ?`
        )
        .get(item.id) as {
        name: string;
        productKey: string;
        quantity: number;
        unit: string | null;
        category: string | null;
        checked: number;
        deletedAt: string | null;
        updatedAt: string | null;
      };
      const before = {
        listName: list.name,
        ...stored,
        checked: Boolean(stored.checked)
      };
      const currentList = await data(await call(alice, 'GET', `/lists/${list.id}`));
      const body = {
        version: currentList.version,
        changes: { quantity: 8 },
        assistantAction: {
          operation: 'update_item',
          targetId: item.id,
          listId: list.id,
          before
        }
      };
      const actionId = {
        stale: '823e4567-e89b-42d3-a456-426614174001',
        checked: '823e4567-e89b-42d3-a456-426614174002',
        deleted: '823e4567-e89b-42d3-a456-426614174003'
      }[state];
      const headers = {
        'x-assistant-action-id': actionId,
        'x-assistant-household-id': ''
      };

      if (state === 'stale') {
        db.prepare('UPDATE shopping_list_items SET quantity = 3 WHERE id = ?').run(item.id);
        db.prepare('UPDATE shopping_lists SET version = version + 1 WHERE id = ?').run(list.id);
      } else if (state === 'checked') {
        db.prepare('UPDATE shopping_list_items SET checked = 1 WHERE id = ?').run(item.id);
      } else {
        db.prepare(
          'UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(item.id);
      }

      const response = await call(
        alice,
        'PATCH',
        `/lists/${list.id}/items/${item.id}/assistant-update`,
        body,
        'es',
        headers
      );
      expect(response.status).toBe(409);
      if (state === 'stale') {
        expect(await json(response)).toMatchObject({ message: 'LIST_VERSION_CONFLICT' });
        expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: item.id, quantity: 3 })])
        );
      } else {
        expect(await json(response)).toMatchObject({ code: 'SHOPPING_ITEM_NOT_EDITABLE' });
        const current = db
          .prepare(
            `SELECT quantity, checked, deleted_at AS deletedAt
               FROM shopping_list_items WHERE id = ?`
          )
          .get(item.id) as { quantity: number; checked: number; deletedAt: string | null };
        expect(current.quantity).toBe(1);
        expect(Boolean(current.checked)).toBe(state === 'checked');
        expect(current.deletedAt === null).toBe(state !== 'deleted');
      }
    }
  });

  it('revierte artículo, versión, aviso e idempotencia si falla el aviso de dominio', async () => {
    const list = await createList(alice, 'Compra transaccional');
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Café', quantity: 1 })
    );
    const currentList = await data(await call(alice, 'GET', `/lists/${list.id}`));
    const stored = db
      .prepare(
        `SELECT name, product_key AS productKey, quantity, unit, category,
                checked, deleted_at AS deletedAt, updated_at AS updatedAt
           FROM shopping_list_items WHERE id = ?`
      )
      .get(item.id) as {
      name: string;
      productKey: string;
      quantity: number;
      unit: string | null;
      category: string | null;
      checked: number;
      deletedAt: string | null;
      updatedAt: string | null;
    };
    const body = {
      version: currentList.version,
      changes: { quantity: 3 },
      assistantAction: {
        operation: 'update_item',
        targetId: item.id,
        listId: list.id,
        before: { listName: list.name, ...stored, checked: Boolean(stored.checked) }
      }
    };
    const actionId = '923e4567-e89b-42d3-a456-426614174000';
    db.exec(`CREATE TRIGGER reject_shopping_item_update_event
      BEFORE INSERT ON shopping_list_events
      WHEN NEW.list_id = '${list.id}' AND NEW.action = 'item.update'
      BEGIN SELECT RAISE(ABORT, 'synthetic event failure'); END;`);

    try {
      const failed = await call(
        alice,
        'PATCH',
        `/lists/${list.id}/items/${item.id}/assistant-update`,
        body,
        'es',
        {
          'x-assistant-action-id': actionId,
          'x-assistant-household-id': ''
        }
      );
      expect(failed.status).toBe(500);
      expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).version).toBe(
        currentList.version
      );
      expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).items[0]).toMatchObject({
        id: item.id,
        quantity: 1
      });
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM assistant_action_results WHERE action_id = ?')
          .get(actionId)
      ).toEqual({ count: 0 });
    } finally {
      db.exec('DROP TRIGGER IF EXISTS reject_shopping_item_update_event');
    }
  });

  it('repetir producto suma la cantidad en vez de duplicar la fila', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', quantity: 1 });

    const again = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'LECHE ', quantity: 2 })
    );
    expect(again.merged).toBe(true);
    expect(again.quantity).toBe(3);

    const items = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items;
    expect(items).toHaveLength(1);
  });

  it('la unidad distingue la linea (1L y 500ml no son el mismo precio)', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', unit: '1L' });
    const other = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', unit: '500ml' })
    );

    expect(other.merged).toBe(false);
  });

  it('rechaza cantidades imposibles', async () => {
    const list = await createList(alice);

    for (const quantity of [0, -1, 'NaN', 99999]) {
      const response = await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Leche',
        quantity
      });
      expect([400, 500]).toContain(response.status);
    }
  });

  it('pega texto con cantidades y dedupea contra lo que ya esta', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', quantity: 1 });

    const result = await data(
      await call(alice, 'POST', `/lists/${list.id}/items/bulk`, {
        lines: '- 2 Leche\n1kg Tomates de colgar\n\n  \n3 huevos\n'
      })
    );

    expect(result.added.map((i: any) => i.name)).toEqual(['Tomates de colgar', 'huevos']);
    expect(result.added.map((i: any) => [i.quantity, i.unit])).toEqual([
      [1, 'kg'],
      [3, null]
    ]);
    expect(result.added).toHaveLength(2);
    expect(result.merged).toHaveLength(1);
    expect(result.skipped).toEqual([]);

    const items = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items;
    const leche = items.find((i: any) => i.product_key === 'leche');
    expect(leche.quantity).toBe(3);
  });

  it('marcar y desmarcar acepta las formas que manda la UI', async () => {
    const list = await createList(alice);
    const item = await data(await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Pan' }));

    for (const value of [true, 'true', '1', 'on', 1]) {
      const checked = await data(
        await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { checked: value })
      );
      expect(checked.checked).toBe(1);
    }
    for (const value of [false, 'false', '0', 'off', 0]) {
      const unchecked = await data(
        await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { checked: value })
      );
      expect(unchecked.checked).toBe(0);
    }

    // El 1/0 entero es la forma que la UI reenvia (leyo la columna asi); un 2 no es
    // un «true» generico, es un dato malo, y tiene que decirlo.
    const nonsense = await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, {
      checked: 2
    });
    expect(nonsense.status).toBe(400);
  });

  it('borrar es logico y se puede deshacer', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Aceitunas' })
    );

    const removed = await call(alice, 'DELETE', `/lists/${list.id}/items/${item.id}`);
    expect(removed.ok).toBe(true);

    const visible = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items;
    expect(visible).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS c FROM shopping_list_items').get()).toEqual({ c: 1 });

    const restored = await data(
      await call(alice, 'POST', `/lists/${list.id}/items/${item.id}/restore`)
    );
    expect(restored.deleted_at).toBeNull();

    // Borrar dos veces no es un 500 ni un éxito: es que ya no está.
    await call(alice, 'DELETE', `/lists/${list.id}/items/${item.id}`);
    expect((await call(alice, 'DELETE', `/lists/${list.id}/items/${item.id}`)).status).toBe(404);
  });

  it('quitar lo comprado deja lo pendiente', async () => {
    const list = await createList(alice);
    const a = await data(await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Pan' }));
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche' });
    await call(alice, 'PATCH', `/lists/${list.id}/items/${a.id}`, { checked: true });

    const result = await data(await call(alice, 'POST', `/lists/${list.id}/clear-checked`));
    expect(result.removed).toBe(1);

    const items = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items;
    expect(items.map((i: any) => i.name)).toEqual(['Leche']);
  });

  it('reordena con el orden completo y avisa de lo que no es de la lista', async () => {
    const list = await createList(alice);
    const one = await data(await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Uno' }));
    const two = await data(await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Dos' }));
    const fresh = await data(await call(alice, 'GET', `/lists/${list.id}`));

    const reordered = await call(alice, 'PUT', `/lists/${list.id}/order`, {
      itemIds: [two.id, one.id],
      version: fresh.version
    });
    expect(reordered.ok).toBe(true);
    const items = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items;
    expect(items.map((i: any) => i.position)).toEqual([0, 1]);
    expect(items[0].name).toBe('Dos');

    const stranger = await call(bob, 'PUT', `/lists/${list.id}/order`, {
      itemIds: [one.id],
      version: fresh.version
    });
    expect(stranger.status).toBe(404);

    const mixed = await call(alice, 'PUT', `/lists/${list.id}/order`, {
      itemIds: [one.id, 'no-existe'],
      version: (await data(await call(alice, 'GET', `/lists/${list.id}`))).version
    });
    expect(mixed.status).toBe(400);
    expect((await json(mixed)).data.unknown).toEqual(['no-existe']);
  });
});

describe('precios y estimacion', () => {
  it('estima con el precio manual por unidad por la cantidad', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      quantity: 2,
      priceMinor: 85
    });
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Aceite',
      quantity: 1,
      priceMinor: 650
    });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.totalMinor).toBe(85 * 2 + 650);
    expect(estimate.pricedLines).toBe(2);
    expect(estimate.unpriced).toEqual([]);
  });

  it('dos precios del MISMO segundo: el DESC es determinista, el recien insertado sale primero', async () => {
    // El sello del API es CURRENT_TIMESTAMP (segundos): dos observaciones seguidas EMPATAN
    // casi siempre, y sin desempate el orden de un empate lo decide el plan de consulta de
    // SQLite — el «ultimo precio» de la ficha era una loteria que el CI perdio una vez.
    // Aqui se siembra con el mismo sello a proposito: el que se inserto despues tiene que
    // llegar primero, siempre.
    const mismoInstante = '2026-09-25 19:27:41';
    const siembra = db.prepare(
      `INSERT INTO price_observations
         (id, user_id, household_id, product_key, product_name, store_name, price_minor, quantity, observed_at)
       VALUES (?, ?, NULL, 'leche-entera', 'Leche entera', 'Mercadona', ?, 1, ?)`
    );
    siembra.run('precio-viejo', alice.id, 175, mismoInstante);
    siembra.run('precio-nuevo', alice.id, 180, mismoInstante);

    const filas = await data(await call(alice, 'GET', '/prices?productKey=leche-entera'));
    expect(filas.map((fila: any) => fila.price_minor)).toEqual([180, 175]);
  });

  it('usa el ultimo precio observado cuando la linea no lo lleva', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/prices`, {
      productName: 'Leche semi',
      priceMinor: 170,
      quantity: 2
    });
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'LECHE SEMI', quantity: 3 });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0]).toMatchObject({
      source: 'observed',
      unitMinor: 85,
      lineTotalMinor: 255
    });
    expect(estimate.totalMinor).toBe(255);
  });

  it('dice sin precio en vez de inventar un cero', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Producto misterioso' });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.totalMinor).toBe(0);
    expect(estimate.unpriced).toEqual(['Producto misterioso']);
    expect(estimate.lines[0].lineTotalMinor).toBeNull();
  });

  it('completar la compra aprende los precios (pagado = unidad * cantidad)', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Café',
        quantity: 3,
        priceMinor: 210
      })
    );
    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { checked: true });

    const result = await data(await call(alice, 'POST', `/lists/${list.id}/complete`));
    expect(result).toMatchObject({ pricesRecorded: 1, items: 1 });

    const observation = db.prepare('SELECT * FROM price_observations').get() as any;
    expect(observation.price_minor).toBe(630);
    expect(observation.quantity).toBe(3);
    expect(observation.product_key).toBe('cafe');

    const closed = await data(await call(alice, 'GET', `/lists/${list.id}`));
    expect(closed.status).toBe('done');
    expect(closed.completed_at).toBeTruthy();
  });

  it('el precio es del hogar: se comparte y se puede borrar solo el propio', async () => {
    const householdId = 'h-shopping-test';
    db.prepare('DELETE FROM household_members WHERE household_id = ?').run(householdId);
    db.prepare('DELETE FROM households WHERE id = ?').run(householdId);
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      householdId,
      'Hogar shared',
      `code-${householdId}`
    );
    alice = await makeUser(
      `alice-h-${Math.random().toString(36).slice(2)}@test.local`,
      householdId
    );
    bob = await makeUser(`bob-h-${Math.random().toString(36).slice(2)}@test.local`, householdId);

    const list = await createList(alice, 'Compra compartida');
    expect((await call(bob, 'GET', `/lists/${list.id}`)).ok).toBe(true);

    await call(alice, 'POST', `/prices`, { productName: 'Galletas', priceMinor: 120 });
    const bobSeesIt = await data(await call(bob, 'GET', '/prices'));
    expect(bobSeesIt.map((o: any) => o.product_name)).toContain('Galletas');

    // Bob no puede borrar lo que observo Alice: la propiedad sigue siendo de quien
    // lo metio aunque el dato se comparta.
    const id = bobSeesIt[0].id;
    expect((await call(bob, 'DELETE', `/prices/${id}`)).status).toBe(404);
    expect((await call(alice, 'DELETE', `/prices/${id}`)).ok).toBe(true);
  });

  it('un precio imposible no entra', async () => {
    const response = await call(alice, 'POST', `/prices`, { productName: 'Leche', priceMinor: -5 });
    expect([400, 500]).toContain(response.status);
    const empty = await call(alice, 'POST', `/prices`, { productName: '', priceMinor: 100 });
    expect([400, 500]).toContain(empty.status);
  });
});

describe('categorias: el inventario de secciones (§8f)', () => {
  it('la primera lectura siembra las por defecto y la segunda no duplica', async () => {
    const first = await data(await call(alice, 'GET', '/categories'));
    expect(first.map((c: any) => c.name)).toContain('Frutas y verduras');
    expect(first.at(-1).name).toBe('Otros');
    expect(first.every((c: any) => /^#[0-9a-f]{6}$/i.test(c.color))).toBe(true);

    const again = await data(await call(alice, 'GET', '/categories'));
    expect(again.length).toBe(first.length);
  });

  it('crear una seccion que ya existe por clave no la duplica', async () => {
    await call(alice, 'GET', '/categories'); // sin catalogo todavia no hay nada que reutilizar
    // El nombre esta escrito de otra forma a proposito: lo que compara es la clave.
    const created = await call(alice, 'POST', '/categories', {
      name: '  frutas   Y VERDURAS ',
      color: '#112233'
    });
    expect(created.status).toBe(200);
    const rows = await data(await call(alice, 'GET', '/categories'));
    expect(rows.filter((c: any) => c.key === 'frutas y verduras')).toHaveLength(1);
    // El color del que ya estaba manda: reutilizar no es re-pintar la seccion de otra persona.
    expect(rows.find((c: any) => c.key === 'frutas y verduras').color).not.toBe('#112233');
  });

  it('una seccion nueva nace con color valido y detras de las demas', async () => {
    const response = await call(alice, 'POST', '/categories', { name: 'Comida para el bebé' });
    expect(response.status).toBe(201);
    const created = await data(response);
    expect(created.key).toBe('comida para el bebe');
    expect(/^#[0-9a-f]{6}$/i.test(created.color)).toBe(true);

    const rows = await data(await call(alice, 'GET', '/categories'));
    expect(rows.at(-1).id).toBe(created.id);
  });

  it('un color que no es hexadecimal no entra', async () => {
    const response = await call(alice, 'POST', '/categories', {
      name: 'Verde que te quiero',
      color: 'rojo'
    });
    expect(response.status).toBe(400);
  });

  it('el catalogo es de quien lo creo: otra cuenta no lo ve ni lo pisa', async () => {
    await call(alice, 'POST', '/categories', { name: 'Seccion de Alice' });
    const bobSees = await data(await call(bob, 'GET', '/categories'));
    expect(bobSees.some((c: any) => c.name === 'Seccion de Alice')).toBe(false);

    // Y bob, que no la tiene, si puede crear la suya con el mismo nombre.
    const bobCreates = await call(bob, 'POST', '/categories', { name: 'Seccion de Alice' });
    expect(bobCreates.status).toBe(201);
  });
});

describe('descuentos y ofertas (§8f)', () => {
  it('la oferta de una linea cambia lo que se paga, no lo que cuesta la unidad', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Cerveza',
        quantity: 6,
        priceMinor: 100,
        offer: { buy: 3, take: 2 }
      })
    );
    expect(item.promo_buy).toBe(3);
    expect(item.promo_take).toBe(2);

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0]).toMatchObject({
      paidUnits: 4,
      lineTotalMinor: 400,
      offerSavingsMinor: 200
    });
    expect(estimate.subtotalMinor).toBe(400);
    expect(estimate.totalMinor).toBe(400);
  });

  it('una oferta que no ahorra no se guarda como oferta', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Agua',
        quantity: 4,
        offer: { buy: 4, take: 4 }
      })
    );
    expect(item.promo_buy).toBeNull();
    expect(item.promo_take).toBeNull();
  });

  it('quitar la oferta es un null explicito, no «no hablar de ella»', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Yogur',
        quantity: 6,
        priceMinor: 90,
        offer: { buy: 3, take: 2 }
      })
    );
    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { offer: null });

    const after = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items[0];
    expect(after.promo_buy).toBeNull();

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0].paidUnits).toBe(6);
    expect(estimate.subtotalMinor).toBe(540);
  });

  it('el descuento de la lista baja el total y se puede quitar', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Pan',
      quantity: 2,
      priceMinor: 250
    });

    const created = await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'percent',
      percentBps: 2000
    });
    expect(created.status).toBe(200);

    const withDiscount = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(withDiscount.discountMinor).toBe(100);
    expect(withDiscount.totalMinor).toBe(400);
    expect(withDiscount.discount.description).toBe('20 %');

    // El detalle de la lista lo dice tambien, que es donde se pinta el chip.
    const detail = await data(await call(alice, 'GET', `/lists/${list.id}`));
    expect(detail.discountDescription).toBe('20 %');

    await call(alice, 'DELETE', `/lists/${list.id}/discount`);
    const cleared = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(cleared.discount).toBeNull();
    expect(cleared.totalMinor).toBe(500);
  });

  it('un descuento mal formado no entra', async () => {
    const list = await createList(alice);
    expect(
      (
        await call(alice, 'PUT', `/lists/${list.id}/discount`, {
          kind: 'percent',
          percentBps: 20_000
        })
      ).status
    ).toBe(400);
    expect(
      (await call(alice, 'PUT', `/lists/${list.id}/discount`, { kind: 'amount' })).status
    ).toBe(400);
    expect(
      (
        await call(alice, 'PUT', `/lists/${list.id}/discount`, {
          kind: 'amount',
          valueMinor: 100,
          scope: 'firstUnits'
        })
      ).status
    ).toBe(400);
  });

  it('al cerrar la compra se anota lo pagado, no lo llevado', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Zumo',
        quantity: 6,
        priceMinor: 150,
        offer: { buy: 3, take: 2 }
      })
    );
    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { checked: true });
    await call(alice, 'POST', `/lists/${list.id}/complete`);

    // 6 llevadas, 4 pagadas: 600 centimos. Si se anotara «600 por 6», la próxima
    // estimacion diria 100/ud cuando la botella cuesta 150.
    const prices = await data(await call(alice, 'GET', '/prices?q=zumo'));
    expect(prices[0]).toMatchObject({ price_minor: 600, quantity: 4 });
  });
});

describe('bandeja: filtros, orden y paginacion (§8f)', () => {
  async function listWithItem(
    name: string,
    opts: { store?: string; price?: number; quantity?: number } = {}
  ) {
    const list = await data(
      await call(alice, 'POST', '/lists', { name, store: opts.store ?? null })
    );
    if (opts.price != null) {
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: `Linea de ${name}`,
        quantity: opts.quantity ?? 1,
        priceMinor: opts.price
      });
    }
    return list;
  }

  it('filtra por supermercado y por importe minimo', async () => {
    await listWithItem('Mercadona cara', { store: 'Mercadona', price: 4000 });
    await listWithItem('Mercadona barata', { store: 'Mercadona', price: 500 });
    await listWithItem('Lidl', { store: 'Lidl', price: 9000 });

    const lasDeMercadona = await data(await call(alice, 'GET', '/lists?store=Mercadona'));
    expect(lasDeMercadona.map((l: any) => l.name).sort()).toEqual([
      'Mercadona barata',
      'Mercadona cara'
    ]);

    // El importe no pregunta por la tienda: Lidl (90 €) tambien pasa de 30 €.
    const caras = await data(await call(alice, 'GET', '/lists?minTotalMinor=3000'));
    expect(caras.map((l: any) => l.name).sort()).toEqual(['Lidl', 'Mercadona cara']);

    const combo = await data(await call(alice, 'GET', '/lists?store=Mercadona&minTotalMinor=600'));
    expect(combo.map((l: any) => l.name)).toEqual(['Mercadona cara']);
  });

  it('el texto encuentra la lista por lo que hay dentro, no solo por su nombre', async () => {
    await listWithItem('Compra del martes', { price: 100 });
    await listWithItem('Otra lista', { price: 100 });

    const found = await data(await call(alice, 'GET', '/lists?q=Compra del'));
    expect(found).toHaveLength(1);

    const byItem = await data(await call(alice, 'GET', '/lists?q=Otra'));
    expect(byItem.map((l: any) => l.name)).toEqual(['Otra lista']);

    // «Linea de Compra del martes» es el nombre del item: buscar por el item tambien vale.
    const byLine = await data(await call(alice, 'GET', '/lists?q=Linea'));
    expect(byLine.length).toBe(2);
  });

  it('filtra por fechas sobre lo que se toco, no sobre lo que se fundo', async () => {
    // Las fechas se fijan a mano: lo que se prueba es el filtro, y «hoy» cambia de
    // sitio cada vez que corre el reloj de la CI.
    const old = await listWithItem('Vieja');
    const fresh = await listWithItem('Reciente');
    db.prepare(`UPDATE shopping_lists SET updated_at = '2025-01-05 10:00:00' WHERE id = ?`).run(
      old.id
    );
    db.prepare(`UPDATE shopping_lists SET updated_at = '2025-03-10 09:00:00' WHERE id = ?`).run(
      fresh.id
    );

    const marzo = await data(await call(alice, 'GET', '/lists?from=2025-03-01&to=2025-03-31'));
    expect(marzo.map((l: any) => l.name)).toEqual(['Reciente']);

    const enero = await data(await call(alice, 'GET', '/lists?to=2025-01-31'));
    expect(enero.map((l: any) => l.name)).toEqual(['Vieja']);

    const desde = await data(await call(alice, 'GET', '/lists?from=2025-02-01'));
    expect(desde.map((l: any) => l.name)).toEqual(['Reciente']);
  });

  it('una fecha con otra forma no entra (es un filtro, no un texto libre)', async () => {
    const response = await call(alice, 'GET', '/lists?from=05/03/2025');
    expect(response.status).toBe(400);
  });

  it('ordena por importe y por nombre, y la direccion se invierte', async () => {
    await listWithItem('Barata', { price: 100 });
    await listWithItem('Cara', { price: 9000 });
    await listWithItem('Media', { price: 900 });

    const byTotal = await data(await call(alice, 'GET', '/lists?sort=total&dir=desc'));
    expect(byTotal.map((l: any) => l.name)).toEqual(['Cara', 'Media', 'Barata']);

    const byTotalAsc = await data(await call(alice, 'GET', '/lists?sort=total&dir=asc'));
    expect(byTotalAsc.map((l: any) => l.name)).toEqual(['Barata', 'Media', 'Cara']);

    const byName = await data(await call(alice, 'GET', '/lists?sort=name&dir=asc'));
    expect(byName.map((l: any) => l.name)).toEqual(['Barata', 'Cara', 'Media']);
  });

  it('la paginacion dice el total filtrado, no lo que cabe en la pagina', async () => {
    for (const index of [1, 2, 3, 4]) await listWithItem(`Lista ${index}`);

    const page = await json(await call(alice, 'GET', '/lists?limit=2&offset=0'));
    expect(page.data).toHaveLength(2);
    expect(page.meta).toEqual({ total: 4, limit: 2, offset: 0 });

    const second = await json(await call(alice, 'GET', '/lists?limit=2&offset=2'));
    expect(second.data).toHaveLength(2);
    expect(second.meta.total).toBe(4);

    const filtered = await json(await call(alice, 'GET', '/lists?q=Lista 3&limit=2'));
    expect(filtered.meta.total).toBe(1);
  });

  it('GET /stores devuelve los supermercados con cuantas listas tienen', async () => {
    await listWithItem('Una', { store: 'Ahorramas' });
    await listWithItem('Dos', { store: 'Ahorramas' });
    await listWithItem('Tres', { store: 'Lidl' });
    await listWithItem('Sin tienda');

    const stores = await data(await call(alice, 'GET', '/stores'));
    expect(stores).toEqual([
      { store: 'Ahorramas', lists: 2 },
      { store: 'Lidl', lists: 1 }
    ]);
  });
});

describe('auditoria y en-vivo (§8f)', () => {
  it('anadir, marcar y quitar dejan rastro de quien fue y en que orden', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Pollo' })
    );
    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { checked: true });
    await call(alice, 'DELETE', `/lists/${list.id}/items/${item.id}`);

    const events = await data(await call(alice, 'GET', `/lists/${list.id}/events`));
    // `list.create` tambien esta, al final: la auditoria cuenta todo, incluida la
    // propia creacion de la lista (de donde si no va a salir la primera fila).
    expect(events.map((e: any) => e.action)).toEqual([
      'item.remove',
      'item.check',
      'item.add',
      'list.create'
    ]);
    expect(events[0].user_name).toBe('Comprador');
    expect(events[0].item_name).toBe('Pollo');
    // La frase ya viene hecha: la pantalla no concatena textos, que es como se
    // escriben las incoherencias.
    expect(events[0].description).toContain('ha quitado «Pollo»');
  });

  it('quien se renombra se renombra tambien en su historial, y la instantanea sigue en la tabla', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Pollo' });
    expect((await data(await call(alice, 'GET', `/lists/${list.id}/events`)))[0].user_name).toBe(
      'Comprador'
    );

    // La fila NO se reescribe: `user_name` es la instantanea de cuando paso y ahi se queda. Lo que
    // lee la pantalla es el nombre de hoy (con aquella como reserva si la cuenta desaparece), porque
    // en «quien ha tocado que» lo que importa es saber de quien se trata.
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run('Compradora Nueva', alice.id);

    const events = await data(await call(alice, 'GET', `/lists/${list.id}/events`));
    expect(events[0].user_name).toBe('Compradora Nueva');
    expect(events[0].description).toContain('Compradora Nueva ha añadido «Pollo»');
    expect(
      db.prepare('SELECT user_name FROM shopping_list_events WHERE list_id = ?').get(list.id)
    ).toEqual({
      user_name: 'Comprador'
    });
  });

  it('el descuento y el vaciado del carro tambien se cuentan', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Pan',
      quantity: 2,
      priceMinor: 100
    });
    await call(
      alice,
      'PATCH',
      `/lists/${list.id}/items/${(await data(await call(alice, 'GET', `/lists/${list.id}`))).items[0].id}`,
      {
        checked: true
      }
    );
    await call(alice, 'POST', `/lists/${list.id}/clear-checked`);
    await call(alice, 'PUT', `/lists/${list.id}/discount`, { kind: 'percent', percentBps: 500 });

    const actions = (await data(await call(alice, 'GET', `/lists/${list.id}/events`))).map(
      (e: any) => e.action
    );
    expect(actions).toEqual([
      'list.discount',
      'list.clear-checked',
      'item.check',
      'item.add',
      'list.create'
    ]);
  });

  it('la auditoria de otra persona del hogar no se lee desde fuera', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Secreto' });
    expect((await call(bob, 'GET', `/lists/${list.id}/events`)).status).toBe(404);
  });

  it('el limite recorta la auditoria', async () => {
    const list = await createList(alice);
    for (const name of ['A', 'B', 'C'])
      await call(alice, 'POST', `/lists/${list.id}/items`, { name });
    const two = await data(await call(alice, 'GET', `/lists/${list.id}/events?limit=2`));
    expect(two).toHaveLength(2);
    expect(two.map((e: any) => e.item_name)).toEqual(['C', 'B']);
  });

  it('el stream avisa de lo que pase mientras la pantalla esta abierta', async () => {
    const hub = await import('../utils/live-hub.js');
    const list = await createList(alice);

    const response = await app.request(`/api/shopping/stream/lists/${list.id}`, {
      headers: { authorization: `Bearer ${alice.token}` }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const seen: string[] = [];
    const collect = async (max: number, until: string) => {
      for (let index = 0; index < max; index += 1) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise((resolve) => setTimeout(() => resolve(null), 1500))
        ]);
        if (!chunk || (chunk as any).done) return;
        seen.push(decoder.decode((chunk as any).value));
        if (seen.join('').includes(until)) return;
      }
    };

    await collect(1, 'event: ready');
    expect(seen.join('')).toContain('event: ready');

    hub.publish([hub.channelForList(list.id)], {
      type: 'items',
      listId: list.id,
      action: 'item.check',
      by: alice.id,
      byName: 'Comprador',
      itemName: 'Pollo',
      at: new Date().toISOString()
    });
    await collect(3, 'event: change');
    const text = seen.join('');
    expect(text).toContain('event: change');
    expect(text).toContain('item.check');

    await reader.cancel();
  }, 15_000);

  it('un cambio real en la lista le llega al stream de otra pantalla', async () => {
    const list = await createList(alice);
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche' })
    );
    const bobWatch = await app.request(`/api/shopping/stream/lists/${list.id}`, {
      headers: { authorization: `Bearer ${bob.token}` }
    });
    // Bob no es del hogar de Alice: el stream no le abre la lista a nadie.
    expect(bobWatch.status).toBe(404);

    const aliceWatch = await app.request(
      `/api/shopping/stream/lists/${list.id}?access_token=${alice.token}`
    );
    expect(aliceWatch.status).toBe(200);
    await aliceWatch.body!.cancel();
    void item;
  }, 15_000);

  it('el token por URL solo vale en el stream, y solo con GET', async () => {
    expect((await app.request(`/api/shopping/lists?access_token=${alice.token}`)).status).toBe(401);
    expect((await app.request(`/api/shopping/lists?access_token=no-pega`)).status).toBe(401);
    expect(
      (
        await app.request(`/api/shopping/lists`, {
          headers: { authorization: `Bearer ${alice.token}` }
        })
      ).status
    ).toBe(200);
  });
});

describe('entrada por foto (§8f)', () => {
  const IMAGE = 'data:image/jpeg;base64,' + '/9j/'.repeat(40);

  function giveAi(user: User, id = `ai-${Math.random().toString(36).slice(2)}`) {
    db.prepare(
      `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, is_active, timeout)
       VALUES (?, ?, 'Local', 'openai', 'http://ai.test/v1', 'clave', 'vision-mini', 1, 4000)`
    ).run(id, user.id);
    return id;
  }

  function answersWith(content: string) {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    db.prepare('DELETE FROM ai_configs').run();
  });

  it('analiza una foto y no escribe nada en la lista', async () => {
    giveAi(alice);
    answersWith(
      JSON.stringify({
        lines: [
          {
            name: 'Leche semidesnatada',
            quantity: 2,
            unit: 'botella',
            category: 'Lacteos',
            priceMinor: 95,
            confidence: 0.9
          },
          {
            name: 'Pan de pueblo',
            quantity: 1,
            unit: 'ud',
            category: 'Panaderia',
            priceMinor: null,
            confidence: 0.6
          }
        ],
        warnings: ['El precio del pan no se ve']
      })
    );
    const list = await createList(alice);

    const result = await data(
      await call(alice, 'POST', `/lists/${list.id}/photo/analyze`, { image: IMAGE, mode: 'shelf' })
    );
    expect(result.lines).toHaveLength(2);
    expect(result.warnings).toEqual(['El precio del pan no se ve']);
    expect(result.lines[0]).toMatchObject({
      name: 'Leche semidesnatada',
      priceMinor: 95,
      category: 'Lacteos'
    });
    // El catalogo va dentro de la respuesta: la hoja de repaso pinta colores sin
    // volver a pedirlo.
    expect(result.categories.map((c: any) => c.name)).toContain('Lacteos');

    // Y la lista sigue vacia: analizar no es anadir.
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).items).toEqual([]);
  });

  it('el prompt lleva el catalogo y la forma esperada', async () => {
    giveAi(alice);
    let sent = '';
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      sent = JSON.stringify(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"lines":[]}' } }] }), {
        status: 200
      });
    });
    const list = await createList(alice);
    await call(
      alice,
      'POST',
      `/lists/${list.id}/photo/analyze`,
      {
        image: IMAGE,
        mode: 'ticket',
        note: 'es del chino'
      },
      'en'
    );

    expect(sent).toContain('Frutas y verduras');
    expect(sent).toContain('priceMinor');
    expect(sent).toContain('image_url');
    expect(sent).toContain('es del chino');
    expect(sent).toContain('English (United Kingdom)');
    expect(sent).toContain('warnings');
    // El modo cambia la instruccion: un ticket y una estanteria no se leen igual.
    expect(sent).toContain('TICKET');
  });

  it('aplica lo confirmado: fusiona lo que estaba y crea la seccion nueva', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', unit: 'l', quantity: 1 });

    const applied = await data(
      await call(alice, 'POST', `/lists/${list.id}/items/apply`, {
        lines: [
          { name: 'Leche', unit: 'l', quantity: 2, priceMinor: 120 },
          {
            name: 'Tofu',
            quantity: 1,
            unit: 'ud',
            category: 'Refrigerados',
            createCategory: true,
            priceMinor: 210
          }
        ]
      })
    );

    expect(applied.merged).toHaveLength(1);
    expect(applied.merged[0]).toMatchObject({ name: 'Leche', quantity: 3, price_minor: 120 });
    expect(applied.added).toHaveLength(1);
    expect(applied.createdCategories).toEqual(['Refrigerados']);

    // Y la auditoria cuenta de donde salio la linea: una foto no es lo mismo que un dedo.
    const events = await data(await call(alice, 'GET', `/lists/${list.id}/events`));
    expect(events[0].action).toBe('items.apply');
    expect(events[0].description).toContain('foto');
  });

  it('valida, devuelve y persiste texto de foto mayor a 2.500 caracteres sin recortarlo', async () => {
    giveAi(alice);
    const name = `Producto ${'artesano '.repeat(300).trim()}`;
    const unit = `envase/${'unidad/'.repeat(360)}`;
    const note = `Detalle ${'conservación '.repeat(240).trim()}`;
    answersWith(
      JSON.stringify({
        lines: [
          {
            name,
            quantity: 1,
            unit,
            category: 'other',
            createCategory: false,
            priceMinor: 125,
            note
          }
        ],
        warnings: [note]
      })
    );
    const list = await createList(alice);

    const analyzed = await data(
      await call(alice, 'POST', `/lists/${list.id}/photo/analyze`, { image: IMAGE, mode: 'shelf' })
    );
    expect(analyzed.lines[0]).toMatchObject({ name, unit, note });
    expect(analyzed.warnings).toEqual([note]);

    const applied = await data(
      await call(alice, 'POST', `/lists/${list.id}/items/apply`, { lines: analyzed.lines })
    );
    expect(applied.added[0]).toMatchObject({ name, unit, note });
    const reloaded = await data(await call(alice, 'GET', `/lists/${list.id}`));
    expect(reloaded.items[0]).toMatchObject({ name, unit, note });
  });

  it('un descuento por producto solo baja ese producto', async () => {
    const list = await createList(alice);
    const jamon = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Jamon Serrano',
        quantity: 1,
        unit: 'kg',
        priceMinor: 4000
      })
    );
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      quantity: 2,
      unit: 'L',
      priceMinor: 100,
      category: 'Lacteos'
    });

    const saved = await data(
      await call(alice, 'PUT', `/lists/${list.id}/discount`, {
        kind: 'amount',
        valueMinor: 500,
        scope: 'product',
        target: 'Jamon Serrano'
      })
    );
    expect(saved.target).toBe('Jamon Serrano');
    expect(saved.description).toContain('en Jamon Serrano');

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.subtotalMinor).toBe(4200);
    expect(estimate.discountMinor).toBe(500);
    expect(estimate.totalMinor).toBe(3700);
    const byId = Object.fromEntries(estimate.lines.map((l: any) => [l.name, l]));
    // `lineTotalMinor` es lo que dice el ticket (despues de la oferta, antes del descuento
    // de la lista); `netMinor` es lo que se paga de esa linea, y ahi si esta el reparto.
    expect(byId['Jamon Serrano'].lineTotalMinor).toBe(4000);
    expect(byId['Jamon Serrano'].netMinor).toBe(3500);
    expect(byId['Leche'].netMinor).toBe(200);
    expect(jamon.name).toBe('Jamon Serrano');
  });

  it('un descuento por seccion entra en todo el pasillo', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Manzanas',
      quantity: 1,
      priceMinor: 300,
      category: 'Frutas y verduras'
    });
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Puerros',
      quantity: 1,
      priceMinor: 200,
      category: 'Frutas y verduras'
    });
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      quantity: 1,
      priceMinor: 1000,
      category: 'Lacteos'
    });

    await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'percent',
      percentBps: 1000,
      scope: 'category',
      target: 'frutas y verduras'
    });
    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    // 10 % de 500 ct = 50 ct, y el reparto solo salpica a las dos lineas de fruta.
    expect(estimate.discountMinor).toBe(50);
    expect(estimate.totalMinor).toBe(1450);
  });

  it('prometer un descuento sin decir a que es un 400, no un 0 magico', async () => {
    const list = await createList(alice);
    const response = await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'amount',
      valueMinor: 500,
      scope: 'product'
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('DiscountTargetRequired');
  });

  it('cambiar de «en jamon» a «toda la cesta» olvida el jamon', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Jamon Serrano',
      quantity: 1,
      priceMinor: 4000
    });
    await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'amount',
      valueMinor: 500,
      scope: 'product',
      target: 'Jamon Serrano'
    });
    const after = await data(
      await call(alice, 'PUT', `/lists/${list.id}/discount`, {
        kind: 'amount',
        valueMinor: 500,
        scope: 'all'
      })
    );
    expect(after.target).toBeNull();
    expect(after.scope).toBe('all');
  });

  it('sin linea que encaje, el estimate lo dice en vez de fingir un descuento', async () => {
    const list = await createList(alice);
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      quantity: 1,
      priceMinor: 1000
    });
    await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'amount',
      valueMinor: 500,
      scope: 'product',
      target: 'Jamon'
    });
    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.discountMinor).toBe(0);
    expect(estimate.discount.reason).toBe('noMatchingLine');
  });

  it('la pestaña «todas» mezcla activas y terminadas (y vacía ninguna)', async () => {
    const alice = await makeUser('all-tab@hogaria.test');
    const first = await data(await call(alice, 'POST', '/lists', { name: 'Activa aqui' }));
    const second = await data(await call(alice, 'POST', '/lists', { name: 'Terminada alla' }));
    await call(alice, 'POST', `/lists/${second.id}/complete`, { version: second.version });

    const activeOnly = await json(await call(alice, 'GET', '/lists?status=active'));
    expect(activeOnly.data.map((l: any) => l.name)).toEqual(['Activa aqui']);
    expect(activeOnly.meta.total).toBe(1);

    const everything = await json(await call(alice, 'GET', '/lists?status=all'));
    expect(everything.data.map((l: any) => l.name).sort()).toEqual([
      'Activa aqui',
      'Terminada alla'
    ]);
    // El total del meta usa los MISMOS filtros: si contara sin filtrar, la paginacion
    // ensenaria «1-2 de 57» en una pantalla con dos filas.
    expect(everything.meta.total).toBe(2);
    expect(first.status).toBe('active');
  });

  it('sin IA configurada dice donde se configura, en vez de un 500', async () => {
    const list = await createList(alice);
    const response = await call(alice, 'POST', `/lists/${list.id}/photo/analyze`, { image: IMAGE });
    expect(response.status).toBe(409);
    const body = (await response.json()) as any;
    expect(body.message).toBe('AI_NOT_CONFIGURED');
    // Con destino, que es lo que convierte un error en un boton.
    expect(body.data.redirect).toBe('/ai-config');
  });

  it('una respuesta que no es JSON se reporta como 422 con la muestra', async () => {
    giveAi(alice);
    answersWith('No veo ningun producto en la imagen, lo siento.');
    const list = await createList(alice);

    const response = await call(alice, 'POST', `/lists/${list.id}/photo/analyze`, { image: IMAGE });
    expect(response.status).toBe(422);
    const body = (await response.json()) as any;
    expect(body.message).toBe('AI_ANSWER_NOT_UNDERSTOOD');
    expect(body.data.sample).toContain('No veo ningun producto');
  });

  it('un JSON valido pero con lineas inventadas tampoco se cuela', async () => {
    giveAi(alice);
    answersWith(JSON.stringify({ lines: [{ name: '', quantity: 1 }] }));
    const list = await createList(alice);
    expect(
      (await call(alice, 'POST', `/lists/${list.id}/photo/analyze`, { image: IMAGE })).status
    ).toBe(422);
  });

  it('una foto que no es imagen no entra, y una enorme tampoco', async () => {
    giveAi(alice);
    const list = await createList(alice);
    const notAnImage = await call(alice, 'POST', `/lists/${list.id}/photo/analyze`, {
      image: 'data:text/plain;base64,AAA='
    });
    expect(notAnImage.status).toBe(400);
    expect(((await notAnImage.json()) as any).message).toBe('INVALID_PHOTO');

    const huge = await call(alice, 'POST', `/lists/${list.id}/photo/analyze`, {
      image: `data:image/jpeg;base64,${'A'.repeat(6_000_001)}`
    });
    // 413 y no 400: la foto es valida, lo que pasa de tamaño. La diferencia importa
    // porque el aviso en la pantalla es «hazla mas pequena», no «eso no es una foto».
    expect(huge.status).toBe(413);
    expect(((await huge.json()) as any).message).toBe('IMAGE_TOO_LARGE');
  });

  it('aplicar sin lineas no crea nada ni sube la version', async () => {
    const list = await createList(alice);
    const before = list.version;
    const response = await call(alice, 'POST', `/lists/${list.id}/items/apply`, { lines: [] });
    expect(response.status).toBe(400);
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).version).toBe(before);
  });
});

describe('descuento sobre varios productos (§12g)', () => {
  /** Cesta con tres lineas con precio: solo dos entran en la promocion del cartel. */
  async function basket() {
    const list = await createList(alice, 'Compra con oferta');
    const jamon = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Jamon Serrano',
        quantity: 1,
        priceMinor: 1200
      })
    );
    const queso = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Queso Curado',
        quantity: 1,
        priceMinor: 600
      })
    );
    const leche = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Leche',
        quantity: 1,
        priceMinor: 100
      })
    );
    return { list, jamon, queso, leche };
  }

  it('acepta varias dianas y las devuelve en la frase del descuento', async () => {
    const { list } = await basket();
    const saved = await data(
      await call(alice, 'PUT', `/lists/${list.id}/discount`, {
        kind: 'amount',
        valueMinor: 250,
        scope: 'product',
        targets: ['Jamon Serrano', 'Queso Curado']
      })
    );
    expect(saved.targets).toEqual(['Jamon Serrano', 'Queso Curado']);
    expect(saved.description).toContain('Jamon Serrano');

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.discountMinor).toBe(250);
    // 1900 - 250: la leche (que no esta en la promocion) no se entera.
    expect(estimate.totalMinor).toBe(1900 - 250);
    expect(estimate.lines.find((l: any) => l.name === 'Leche').netMinor).toBe(100);

    const detail = await data(await call(alice, 'GET', `/lists/${list.id}`));
    expect(detail.discountDescription).toContain('Queso Curado');
  });

  it('el porcentaje se calcula sobre lo que elegiste, no sobre el carro entero', async () => {
    const { list } = await basket();
    await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'percent',
      percentBps: 1000,
      scope: 'product',
      targets: ['Jamon Serrano']
    });
    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.discountMinor).toBe(120);
  });

  it('un alcance que promete producto sin ninguna diana no se guarda', async () => {
    const { list } = await basket();
    const empty = await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'amount',
      valueMinor: 250,
      scope: 'product',
      targets: []
    });
    expect(empty.status).toBe(400);
    // El codigo va en `details[].message` (el envoltorio de zod), no en `message`: es el
    // contrato de todas las validaciones del server, y una hoja nueva no lo cambia.
    expect(JSON.stringify(await json(empty))).toContain('DiscountTargetRequired');
    const nothing = await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'amount',
      valueMinor: 250,
      scope: 'category'
    });
    expect(nothing.status).toBe(400);
  });

  it('guardar otra vez sobre las mismas dianas no duplica ni deja las anteriores', async () => {
    const { list } = await basket();
    await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'amount',
      valueMinor: 250,
      scope: 'product',
      targets: ['Jamon Serrano', 'Queso Curado']
    });
    const saved = await data(
      await call(alice, 'PUT', `/lists/${list.id}/discount`, {
        kind: 'amount',
        valueMinor: 250,
        scope: 'product',
        targets: ['Leche']
      })
    );
    expect(saved.targets).toEqual(['Leche']);
    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    // 250 sobre una linea de 100 se recorta a 100: no devuelve dinero, y lo dice.
    expect(estimate.discount?.reason).toBe('clampedToZero');
    expect(estimate.discountMinor).toBe(100);
  });

  it('la forma antigua (una sola diana) sigue leyendose', async () => {
    const { list } = await basket();
    await call(alice, 'PUT', `/lists/${list.id}/discount`, {
      kind: 'amount',
      valueMinor: 200,
      scope: 'product',
      target: 'jamon serrano'
    });
    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.discountMinor).toBe(200);
    const stored = db
      .prepare('SELECT targets FROM shopping_list_discounts WHERE list_id = ?')
      .get(list.id) as any;
    expect(stored.targets).toBeNull();
  });
});

describe('cerrar una compra deja el precio por establecimiento (§12g)', () => {
  async function bought(store: string | null = 'Mercadona') {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra dia', store }));
    const milk = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Leche',
        quantity: 3,
        unit: 'ud'
      })
    );
    const bread = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Pan', quantity: 1, unit: 'ud' })
    );
    await call(alice, 'PATCH', `/lists/${list.id}/items/${milk.id}`, { checked: true });
    await call(alice, 'PATCH', `/lists/${list.id}/items/${bread.id}`, { checked: true });
    return { list, milk, bread };
  }

  it('no cierra lo que no puede aprender: exige el precio de cada linea comprada', async () => {
    const { list, milk } = await bought();
    await call(alice, 'PATCH', `/lists/${list.id}/items/${milk.id}`, { priceMinor: 85 });

    const refused = await call(alice, 'POST', `/lists/${list.id}/complete`);
    expect(refused.status).toBe(409);
    const body = await json(refused);
    expect(body.message).toBe('PRICES_MISSING');
    expect(body.data.missing).toEqual([
      { itemId: expect.any(String), name: 'Pan', quantity: 1, unit: 'ud' }
    ]);
    // Y no lo hace a medias: la lista sigue viva y el precio aportado no se anota como
    // observacion, porque un cierre rechazado no deja huella en el historico de precios.
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).status).toBe('active');
    expect(db.prepare('SELECT COUNT(*) AS c FROM price_observations').get()).toEqual({ c: 0 });
  });

  it('con los precios del cuerpo, cierra, los anota en la linea y aprende el de la tienda', async () => {
    const { list, milk, bread } = await bought();
    const closed = await data(
      await call(alice, 'POST', `/lists/${list.id}/complete`, {
        prices: [
          { itemId: milk.id, priceMinor: 95 },
          {
            itemId: bread.id,
            totalPaidMinor: 240,
            quantity: 2,
            productName: 'Barra de pan cristal'
          }
        ]
      })
    );
    expect(closed.pricesRecorded).toBe(2);

    const stored = db
      .prepare('SELECT * FROM price_observations ORDER BY product_key')
      .all() as any[];
    // El ticket dice «2,40 € por 2 barras»: eso es lo que se guarda, y el precio por
    // unidad (120) se deriva, no se anota a mano dos veces.
    expect(
      stored.map((row) => [row.product_key, row.price_minor, row.quantity, row.store_name])
    ).toEqual([
      ['leche', 285, 3, 'Mercadona'],
      ['pan', 240, 2, 'Mercadona']
    ]);
    expect(stored.find((row) => row.product_key === 'pan')!.product_name).toBe(
      'Barra de pan cristal'
    );

    const items = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items as any[];
    expect(items.find((item) => item.name === 'Leche').price_minor).toBe(95);
    expect(items.find((item) => item.name === 'Pan').price_minor).toBe(120);
  });

  it('un precio nuevo sin establecimiento no es un precio: pregunta antes de cerrar', async () => {
    const { list, milk, bread } = await bought(null);
    const refused = await call(alice, 'POST', `/lists/${list.id}/complete`, {
      prices: [
        { itemId: milk.id, priceMinor: 95 },
        { itemId: bread.id, priceMinor: 120 }
      ]
    });
    expect(refused.status).toBe(409);
    const body = await json(refused);
    expect(body.message).toBe('STORE_REQUIRED');
    expect(body.data.hint).toContain('establecimiento');
    // Con la tienda en la propia llamada, si se puede: es el «estoy en Lidl» que llega
    // cuando la lista se abrio sin pensar donde se iba a comprar.
    const ok = await call(alice, 'POST', `/lists/${list.id}/complete`, {
      store: 'Lidl',
      prices: [
        { itemId: milk.id, priceMinor: 95 },
        { itemId: bread.id, priceMinor: 120 }
      ]
    });
    expect(ok.ok).toBe(true);
    expect(db.prepare('SELECT DISTINCT store_name FROM price_observations').get()).toEqual({
      store_name: 'Lidl'
    });
  });

  it('lo que no se compro no se exige: cerrar con la mitad del carro vacio es legitimo', async () => {
    const list = await data(
      await call(alice, 'POST', '/lists', { name: 'Media cesta', store: 'Aldi' })
    );
    const boughtItem = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Cafe',
        quantity: 1,
        priceMinor: 450
      })
    );
    await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Aceite', quantity: 1 })
    );
    await call(alice, 'PATCH', `/lists/${list.id}/items/${boughtItem.id}`, { checked: true });

    const closed = await call(alice, 'POST', `/lists/${list.id}/complete`);
    expect(closed.ok).toBe(true);
    expect((await json(closed)).data.pricesRecorded).toBe(1);
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).status).toBe('done');
  });

  it('rechaza una linea que no esta en la lista, en vez de anotar el precio en otra parte', async () => {
    const { list, milk } = await bought();
    const response = await call(alice, 'POST', `/lists/${list.id}/complete`, {
      prices: [
        { itemId: milk.id, priceMinor: 95 },
        { itemId: 'no-existe', priceMinor: 100 }
      ]
    });
    expect(response.status).toBe(400);
    expect((await json(response)).data.unknown).toEqual(['no-existe']);
  });

  it('una linea sin cantidad pagada razonable no puede multiplicar el precio por cero', async () => {
    const list = await data(
      await call(alice, 'POST', '/lists', { name: 'Peso', store: 'Carniceria' })
    );
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Filete',
        quantity: 0.75,
        unit: 'kg'
      })
    );
    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { checked: true });

    await call(alice, 'POST', `/lists/${list.id}/complete`, {
      prices: [{ itemId: item.id, totalPaidMinor: 890 }]
    });
    const row = db.prepare('SELECT price_minor, quantity FROM price_observations').get() as any;
    // 8,90 € por 0,75 kg: la observacion guarda lo pagado y cuanto llevabas, y la linea
    // acaba con el precio por kilo (1187) que es lo que se recuerda en la proxima lista.
    expect(row).toEqual({ price_minor: 890, quantity: 0.75 });
    expect((await data(await call(alice, 'GET', `/lists/${list.id}`))).items[0].price_minor).toBe(
      1187
    );
  });

  it('al cerrar, lo comprado pasa al inventario: fusiona, repone o crea segun la ficha de la casa (## 12ag)', async () => {
    db.prepare('DELETE FROM ingredients').run();
    const list = await data(
      await call(alice, 'POST', '/lists', { name: 'Feria', store: 'Familia' })
    );

    // Tres estados de la casa frente a tres lineas compradas: existe con stock (se SUMA, no se duplica),
    // existe agotada (se REPONE hasta lo comprado) y no existe (se CREA la ficha). Y una cuarta linea,
    // pendiente: lo no comprado no baja a la nevera, que la despensa registra lo que hay, no lo que falta.
    db.prepare(
      `INSERT INTO ingredients (id, user_id, name, category, quantity, unit, location)
       VALUES ('ing-leche', ?, 'leche semidesnatada', 'other', 0.5, 'l', 'pantry'),
              ('ing-agua', ?, 'Mineral', 'other', 0, 'ud', 'pantry')`
    ).run(alice.id, alice.id);

    const leche = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Leche semidesnatada',
        quantity: 2,
        unit: 'l',
        priceMinor: 190
      })
    );
    const agua = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Mineral',
        quantity: 3,
        unit: 'ud',
        priceMinor: 150
      })
    );
    const pan = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Pan de pueblo',
        quantity: 1,
        unit: 'ud',
        priceMinor: 240
      })
    );
    await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Aceitunas', quantity: 1 })
    );
    for (const item of [leche, agua, pan]) {
      await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { checked: true });
    }

    const closed = await data(await call(alice, 'POST', `/lists/${list.id}/complete`));
    expect({ moved: closed.pantryMoved, merged: closed.pantryMerged }).toEqual({
      moved: 2,
      merged: 1
    });

    const filas = db
      .prepare('SELECT name, quantity, unit, location, category FROM ingredients ORDER BY name')
      .all() as any[];
    expect(filas).toEqual([
      { name: 'Mineral', quantity: 3, unit: 'ud', location: 'pantry', category: 'other' },
      { name: 'Pan de pueblo', quantity: 1, unit: 'ud', location: 'pantry', category: 'other' },
      // La clave es la que compara, no el nombre: «Leche semidesnatada» es la ficha «leche semidesnatada»
      // que ya estaba en casa, y entra en ella, no al lado.
      {
        name: 'leche semidesnatada',
        quantity: 2.5,
        unit: 'l',
        location: 'pantry',
        category: 'other'
      }
    ]);
    expect(filas.some((fila) => fila.name === 'Aceitunas')).toBe(false);

    const photoJobs = db
      .prepare(
        `SELECT i.name, s.status, j.kind FROM product_image_searches s
         JOIN ingredients i ON i.id = s.ingredient_id
         JOIN ai_jobs j ON j.id = s.job_id
        ORDER BY i.name`
      )
      .all() as { name: string; status: string; kind: string }[];
    expect(photoJobs.map((job) => job.name)).toEqual([
      'Mineral',
      'Pan de pueblo',
      'leche semidesnatada'
    ]);
    expect(photoJobs.every((job) => ['queued', 'running', 'complete'].includes(job.status))).toBe(
      true
    );
    expect(photoJobs.every((job) => job.kind === 'product_image_search')).toBe(true);
  });
});

describe('el precio de la tienda, no el ultimo precio (§12g)', () => {
  async function observe(productName: string, store: string, priceMinor: number, quantity = 1) {
    await call(alice, 'POST', '/prices', { productName, store, priceMinor, quantity });
  }

  it('con la lista en Mercadona, el desglose ignora lo que cuesta en Lidl', async () => {
    await observe('Leche', 'Lidl', 100);
    await observe('Leche', 'Mercadona', 85);
    // El orden importa: se escribe primero el de Lidl para que «ultimo precio» no coincida
    // con «precio de esta tienda» y la eleccion quede probada de verdad.
    const list = await data(
      await call(alice, 'POST', '/lists', { name: 'Mercadona', store: 'Mercadona' })
    );
    await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', quantity: 2 })
    );

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0]).toMatchObject({
      unitMinor: 85,
      lineTotalMinor: 170,
      store: 'Mercadona'
    });
    expect(estimate.lines[0].otherStore).toBeFalsy();
  });

  it('si esa tienda no tiene dato, usa el de otra y lo dice', async () => {
    await observe('Leche', 'Lidl', 100);
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Aldi', store: 'Aldi' }));
    await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche', quantity: 1 })
    );

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0]).toMatchObject({ unitMinor: 100, store: 'Lidl', otherStore: true });
  });

  it('una linea enlazada a otro producto hereda su precio aunque el nombre sea otro', async () => {
    await observe('Leche semidesnatada', 'Mercadona', 170);
    const list = await data(
      await call(alice, 'POST', '/lists', { name: 'Mercadona', store: 'Mercadona' })
    );
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Leche semi', quantity: 1 })
    );

    // Sin enlazar: «leche semi» no es «leche semidesnatada», y no hay precio.
    const before = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(before.lines[0].source).toBe('unpriced');

    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, {
      productKey: 'leche semidesnatada'
    });
    const after = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(after.lines[0]).toMatchObject({ source: 'observed', unitMinor: 170 });

    // Quitar el enlace devuelve la linea a su propio nombre: borrar tambien es editable.
    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { productKey: null });
    const unlinked = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(unlinked.lines[0].source).toBe('unpriced');
  });

  it('los precios se pueden filtrar por tienda y agrupar por producto', async () => {
    await observe('Leche', 'Lidl', 100);
    await observe('Leche', 'Mercadona', 85);

    const lidl = await data(await call(alice, 'GET', '/prices?store=Lidl'));
    expect(lidl).toHaveLength(1);
    expect(lidl[0].store_name).toBe('Lidl');

    const products = await data(await call(alice, 'GET', '/prices/products?q=lech'));
    expect(products).toHaveLength(1);
    expect(products[0].productKey).toBe('leche');
    expect(products[0].variants.map((v: any) => v.store)).toEqual(
      expect.arrayContaining(['Lidl', 'Mercadona'])
    );
  });
});

describe('descuento propio de una linea (§12h)', () => {
  it('se guarda en la fila y se lee tal cual', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Leche semidesnatada',
        unit: 'L',
        quantity: 3,
        priceMinor: 95,
        discount: { kind: 'percent', percentBps: 1500, units: 2 }
      })
    );
    expect(item.disc_kind).toBe('percent');
    expect(item.disc_percent_bps).toBe(1500);
    expect(item.disc_units).toBe(2);
    expect(item.disc_value_minor).toBeNull();

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0].lineDiscountMinor).toBe(29); // 15 % de dos unidades de 0,95
    expect(estimate.lines[0].lineDiscountDescription).toBe('15 % en 2 unidades');
    expect(estimate.lineDiscountMinor).toBe(29);
  });

  it('un importe directo baja esa linea y solo esa', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Jamon cocido',
      quantity: 2,
      priceMinor: 250,
      discount: { kind: 'amount', valueMinor: 300 }
    });
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Pan',
      quantity: 3,
      priceMinor: 100
    });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    const [jamon, pan] = estimate.lines;
    expect(jamon.lineTotalMinor).toBe(500);
    expect(jamon.lineDiscountMinor).toBe(300);
    expect(jamon.netMinor).toBe(200);
    expect(pan.lineDiscountMinor).toBe(0);
    expect(pan.netMinor).toBe(300);
    expect(estimate.lineDiscountMinor).toBe(300);
    expect(estimate.totalMinor).toBe(500);
  });

  it('el -2 € no puede bajar una linea de 0,95: se recorta y lo dice', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      priceMinor: 95,
      discount: { kind: 'amount', valueMinor: 200 }
    });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0].lineDiscountMinor).toBe(95);
    expect(estimate.lines[0].netMinor).toBe(0);
    expect(estimate.lines[0].lineDiscountReason).toBe('clamped');
  });

  it('primero la oferta y despues el descuento propio, que es el orden de una caja', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Cervezas',
      quantity: 6,
      priceMinor: 100,
      offer: { buy: 3, take: 2 },
      discount: { kind: 'percent', percentBps: 1000 }
    });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    const line = estimate.lines[0];
    expect(line.paidUnits).toBe(4);
    expect(line.lineTotalMinor).toBe(400);
    // El 10 % va sobre lo que se paga (400), no sobre lo que se lleva (600).
    expect(line.lineDiscountMinor).toBe(40);
    expect(line.netMinor).toBe(360);
  });

  it('«a 2 unidades» con una sola en la cesta se avisa, no se inventa', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Aceite',
      quantity: 1,
      priceMinor: 100,
      discount: { kind: 'percent', percentBps: 5000, units: 2 }
    });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lines[0].lineDiscountMinor).toBe(50);
    expect(estimate.lines[0].lineDiscountReason).toBe('fewerUnits');
  });

  it('quitarlo es un null explicito, no «no hablar de ello»', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    const item = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Tomate',
        priceMinor: 200,
        discount: { kind: 'amount', valueMinor: 100 }
      })
    );
    expect(
      (await data(await call(alice, 'GET', `/lists/${list.id}/estimate`))).lineDiscountMinor
    ).toBe(100);

    await call(alice, 'PATCH', `/lists/${list.id}/items/${item.id}`, { discount: null });
    const cleaned = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items[0];
    expect(cleaned.disc_kind).toBeNull();
    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    expect(estimate.lineDiscountMinor).toBe(0);
    expect(estimate.lines[0].lineDiscountDescription).toBeUndefined();
  });

  it('un descuento sin valor no entra, y tampoco uno con un porcentaje imposible', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    const sinValor = await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      discount: { kind: 'percent' }
    });
    expect(sinValor.status).toBe(400);

    const fueraDeRango = await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      discount: { kind: 'percent', percentBps: 15_000 }
    });
    expect(fueraDeRango.status).toBe(400);
    const lineas = await data(await call(alice, 'GET', `/lists/${list.id}`));
    expect(lineas.items).toHaveLength(0);
  });

  it('al fusionar dos lineas del mismo producto, el descuento que llega manda', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    const primera = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Huevas',
        quantity: 1,
        priceMinor: 300
      })
    );
    expect(primera.merged).toBe(false);
    const segunda = await data(
      await call(alice, 'POST', `/lists/${list.id}/items`, {
        name: 'Huevas',
        quantity: 2,
        priceMinor: 300,
        discount: { kind: 'percent', percentBps: 2000 }
      })
    );
    expect(segunda.merged).toBe(true);
    expect(segunda.quantity).toBe(3);
    expect(segunda.disc_percent_bps).toBe(2000);
    // Y borrarlo en una fila no deja el hueco a medias: la fila sigue teniendo su precio.
    const limpiada = await data(
      await call(alice, 'PATCH', `/lists/${list.id}/items/${primera.id}`, { discount: null })
    );
    expect(limpiada.disc_percent_bps).toBeNull();
    expect(limpiada.price_minor).toBe(300);
  });

  it('la lista sigue cuadradando: subtotal menos el cupon igual a total', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      quantity: 2,
      priceMinor: 100,
      discount: { kind: 'amount', valueMinor: 50 }
    });
    await call(alice, 'POST', `/lists/${list.id}/items`, { name: 'Pan', priceMinor: 240 });
    await call(alice, 'PUT', `/lists/${list.id}/discount`, { kind: 'percent', percentBps: 1000 });

    const estimate = await data(await call(alice, 'GET', `/lists/${list.id}/estimate`));
    // 200 - 50 + 240 = 390 de subtotal (ya con el descuento de linea dentro), y el 10 % de la
    // lista se calcula sobre lo que de verdad se paga en caja.
    expect(estimate.lineDiscountMinor).toBe(50);
    expect(estimate.subtotalMinor).toBe(390);
    expect(estimate.discountMinor).toBe(39);
    expect(estimate.totalMinor).toBe(351);
    expect(estimate.subtotalMinor - estimate.discountMinor).toBe(estimate.totalMinor);
  });
});

describe('zonas horarias en la salida (§12h)', () => {
  it('ninguna marca temporal sale sin zona: si no, el navegador la lee como hora local', async () => {
    const list = await data(await call(alice, 'POST', '/lists', { name: 'Compra' }));
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      quantity: 1,
      priceMinor: 95
    });
    expect(list.created_at).toMatch(/Z$/);

    const fetched = await data(await call(alice, 'GET', `/lists/${list.id}`));
    expect(fetched.created_at).toMatch(/Z$/);
    expect(fetched.items[0].created_at).toMatch(/Z$/);
    // Y la fecha suelta, cuando la hay, sigue siendo fecha: un dia de calendario no es un
    // instante y anadirle una hora lo desplazaria medio dia.
    for (const [key, value] of Object.entries(fetched.items[0] as Record<string, unknown>)) {
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        expect(key).not.toMatch(/(?:at|time|timestamp)$/i);
      }
    }
  });
});

describe('cerrar la compra con descuento de linea (§12h)', () => {
  it('lo pagado baja, pero el precio aprendido es el del estante', async () => {
    const list = await data(
      await call(alice, 'POST', '/lists', { name: 'Compra', store: 'Mercadona' })
    );
    await call(alice, 'POST', `/lists/${list.id}/items`, {
      name: 'Leche',
      quantity: 2,
      priceMinor: 100,
      discount: { kind: 'amount', valueMinor: 50 }
    });
    const items = (await data(await call(alice, 'GET', `/lists/${list.id}`))).items;
    await call(alice, 'PATCH', `/lists/${list.id}/items/${items[0].id}`, { checked: true });

    const receipt = await data(await call(alice, 'POST', `/lists/${list.id}/complete`, {}));
    // 2 unidades de 1,00 menos los 0,50 del cartel: de cartera salieron 1,50.
    expect(receipt.paidMinor).toBe(150);

    // Y lo que la casa aprende es el precio de la estanteria, no el de hoy rebajado: si
    // aprendiera 0,75, la proxima semana la estimacion mentiria.
    const known = await data(await call(alice, 'GET', '/prices/products'));
    const leche = known.find((entry: any) => entry.productKey === 'leche');
    expect(leche).toBeTruthy();
    expect(leche.variants[0].store).toBe('Mercadona');
    expect(leche.variants[0].unitMinor).toBe(100);
  });
});

describe('quien escribio la linea, con cara (§12i)', () => {
  it('la lectura lleva la foto de quien anadio y de quien toco', async () => {
    // Hace falta un hogar comun: si no, Luis no ve la lista de Ana y su PATCH acabaria en
    // un 404 silencioso que la prueba no llegaria a notar.
    const hh = 'h-cara-' + Math.random().toString(36).slice(2);
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      hh,
      'Hogar caras',
      `code-${hh}`
    );
    const ana = await makeUser(`cara-ana-${hh}@hogaria.test`, hh);
    const luis = await makeUser(`cara-luis-${hh}@hogaria.test`, hh);
    db.prepare(`UPDATE users SET name = 'Ana', avatar = '/uploads/ana.png' WHERE id = ?`).run(
      ana.id
    );
    db.prepare(`UPDATE users SET name = 'Luis' WHERE id = ?`).run(luis.id); // sin foto, a proposito

    const list = (await data(await call(ana, 'POST', '/lists', { name: 'Mercado' }))) as any;
    const item = (await data(
      await call(ana, 'POST', `/lists/${list.id}/items`, { name: 'Pan' })
    )) as any;
    expect(item.added_by_avatar).toBeUndefined(); // el alta no presenta a nadie: quien llama ya se sabe

    await call(luis, 'PATCH', `/lists/${list.id}/items/${item.id}`, { quantity: 3 });

    const row = ((await data(await call(ana, 'GET', `/lists/${list.id}`))) as any).items[0];
    expect(row.added_by_name).toBe('Ana');
    expect(row.added_by_avatar).toBe('/uploads/ana.png');
    // Y sin foto no se inventa nada: el frontend pinta la inicial con ese `null`.
    expect(row.updated_by_name).toBe('Luis');
    expect(row.updated_by_avatar).toBeNull();
  });

  it('la bandeja dice de quien es cada lista', async () => {
    const hh = 'h-caras-' + Math.random().toString(36).slice(2);
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      hh,
      'Hogar bandeja',
      `code-${hh}`
    );
    const ana = await makeUser(`bandeja-ana-${hh}@hogaria.test`, hh);
    db.prepare(`UPDATE users SET name = 'Ana', avatar = '/uploads/ana.png' WHERE id = ?`).run(
      ana.id
    );
    const list = (await data(await call(ana, 'POST', '/lists', { name: 'Farmacia' }))) as any;

    const rows = (await data(await call(ana, 'GET', '/lists?status=all'))) as any[];
    const mine = rows.find((row) => row.id === list.id);
    expect(mine.ownerName).toBe('Ana');
    expect(mine.ownerAvatar).toBe('/uploads/ana.png');
  });

  it('la auditoria trae la foto actual, y el nombre congelado', async () => {
    const ana = await makeUser('cara-audit-ana@hogaria.test');
    const list = (await data(
      await call(ana, 'POST', '/lists', { name: 'Auditoria con cara' })
    )) as any;
    db.prepare(`UPDATE users SET name = 'Ana', avatar = '/uploads/ana-vieja.png' WHERE id = ?`).run(
      ana.id
    );
    await call(ana, 'POST', `/lists/${list.id}/items`, { name: 'Leche' });
    // Ana cambia de foto despues del suceso: la auditoria no reescribe quien fue (el nombre
    // instantaneo sigue siendo «Ana»), pero si muestra la persona de hoy.
    db.prepare(`UPDATE users SET avatar = '/uploads/ana-nueva.png' WHERE id = ?`).run(ana.id);

    const events = (await data(await call(ana, 'GET', `/lists/${list.id}/events`))) as any[];
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].user_name).toBe('Ana');
    expect(events[0].user_avatar).toBe('/uploads/ana-nueva.png');
  });
});

describe('lo opcional de verdad (HOGARIA-SPEC 12o)', () => {
  it('un producto con solo el nombre entra en la lista y lo demas queda vacio', async () => {
    // «Con precio, tienda, nota, categoria y oferta» es lo que la pantalla pregunta, nada de eso es
    // obligatorio. Se prueba a nivel de ruta porque entre el schema y la fila hay un INSERT que liga
    // campo por campo: ahi un ausente se convierte en un 500, no en un NULL.
    const user = await makeUser(`minimo-${Math.random().toString(36).slice(2, 8)}@hogaria.test`);
    const list = await data(await call(user, 'POST', '/lists', { name: 'Compra minima' }));

    const created = await call(user, 'POST', `/lists/${list.id}/items`, { name: 'Pan de pueblo' });
    expect(created.status).to.be.oneOf([200, 201]);
    const item = await data(created);
    expect(item.name).toBe('Pan de pueblo');
    expect(item.note ?? null).toBeNull();
    expect(item.price_minor ?? item.priceMinor ?? null).toBeNull();

    // Vaciar lo que si se habia escrito: `null` quita, y el resto de la fila se queda.
    const priced = await data(
      await call(user, 'PATCH', `/lists/${list.id}/items/${item.id}`, {
        note: 'de la hornilla',
        priceMinor: 120
      })
    );
    expect(priced.note ?? null).toBe('de la hornilla');
    const cleared = await data(
      await call(user, 'PATCH', `/lists/${list.id}/items/${item.id}`, {
        note: null,
        priceMinor: null
      })
    );
    expect(cleared.note ?? null).toBeNull();
    expect(cleared.price_minor ?? cleared.priceMinor ?? null).toBeNull();
  });
});
