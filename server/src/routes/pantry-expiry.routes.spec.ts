import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * Las rutas de caducidades (## 12ak), sobre BD en memoria y sin proveedor: lo que se prueba es
 * que la lista sale ordenada y con sus fuentes, que el catalogo de bolsillo estima sin gastar
 * IA, que la IA solo se llama para lo que el catalogo no sabe (y que su respuesta se guarda en
 * el sitio justo), y que sin configuracion el error es el de siempre —NO_CONFIG, 409—.
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
  db.prepare('INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, NULL)').run(
    id, email, 'Cocinera', 'hash'
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

function sembrar(nombre: string, extra: Record<string, unknown> = {}): string {
  const id = `ing-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, expiration_date, estimated_shelf_days, created_at)
     VALUES (?, ?, NULL, ?, 'other', ?, 'ud', NULL, NULL, '2026-09-01 10:00:00')`
  ).run(id, alice.id, nombre, extra['quantity'] ?? 1);
  if (extra['expiration_date'] !== undefined) {
    db.prepare('UPDATE ingredients SET expiration_date = ? WHERE id = ?').run(extra['expiration_date'], id);
  }
  return id;
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const { pantryRoutes } = await import('./pantry.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.route('/api/pantry', pantryRoutes);
});

afterAll(() => closeDatabase?.());

beforeEach(async () => {
  db.exec('DELETE FROM ingredients; DELETE FROM ai_configs; DELETE FROM users;');
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
});

describe('GET /expiry', () => {
  it('la lista sale por urgencia, con su fuente y su fecha estimada', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.parse(`${hoy}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    // El pan se dio de alta el 1 de septiembre: con 4 dias de catalogo lleva semanas «caducado»,
    // y eso es justo lo que la lista tiene que ensenar arriba —la urgencia es de dias, no de nombres—.
    sembrar('Pescado fresco', { expiration_date: ayer });
    sembrar('Pan de barra');
    sembrar('Arroz');

    const respuesta = await call('GET', '/expiry');
    expect(respuesta.status).toBe(200);
    const filas = respuesta.payload.data;
    expect(filas.map((fila: any) => fila.name)).toEqual(['Pan de barra', 'Pescado fresco', 'Arroz']);
    expect(filas[0]).toMatchObject({ shelfSource: 'catalogo', estimatedDays: 4 });
    expect(filas[0].daysLeft).toBeLessThan(-15);
    expect(filas[1]).toMatchObject({ shelfSource: 'fecha', daysLeft: -1 });
    expect(filas[2].daysLeft).not.toBeNull();
  });
});

describe('POST /expiry/estimate', () => {
  it('sin configuracion de IA es 409 NO_CONFIG, y el catalogo ya cubrio al pan', async () => {
    sembrar('Pan de barra');
    sembrar('Bicho de la huerta raro');

    const respuesta = await call('POST', '/expiry/estimate');
    expect(respuesta.status).toBe(409);
    expect(respuesta.payload.error).toBe('NO_CONFIG');
    // El catalogo no se guarda, se consulta: el pan sale estimado igualmente.
    const filas = (await call('GET', '/expiry')).payload.data;
    const pan = filas.find((fila: any) => fila.name === 'Pan de barra');
    expect(pan.shelfSource).toBe('catalogo');
  });

  it('la IA estima lo que el catalogo no sabe, y se guarda en SU producto', async () => {
    sembrar('Pan de barra');
    const quinoa = sembrar('Quinoa real');

    const cuerpo = JSON.stringify({ products: [{ name: 'Quinoa Real', days: '180' }] });
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ choices: [{ message: { content: cuerpo } }] }), { status: 200 })
    );
    db.prepare(
      `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, is_active)
       VALUES ('ai-1', ?, 'Local', 'custom', 'http://localhost:9/v1', 'k', 'm', 1)`
    ).run(alice.id);

    const respuesta = await call('POST', '/expiry/estimate');
    vi.unstubAllGlobals();
    expect(respuesta.status).toBe(200);
    expect(respuesta.payload.data).toMatchObject({ catalogo: 1, ia: 1, sinEstimar: 0 });

    const guardado = db.prepare('SELECT estimated_shelf_days FROM ingredients WHERE id = ?').get(quinoa) as any;
    expect(guardado.estimated_shelf_days).toBe(180);

    const filas = (await call('GET', '/expiry')).payload.data;
    const quinoaFila = filas.find((fila: any) => fila.name === 'Quinoa real');
    expect(quinoaFila).toMatchObject({ shelfSource: 'ia', estimatedDays: 180 });
  });

  it('un modelo que contesta JSON invalido es 422, no un 500 sin nombre', async () => {
    sembrar('Quinoa real');
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ choices: [{ message: { content: 'no soy json' } }] }), { status: 200 })
    );
    db.prepare(
      `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, is_active)
       VALUES ('ai-1', ?, 'Local', 'custom', 'http://localhost:9/v1', 'k', 'm', 1)`
    ).run(alice.id);

    const respuesta = await call('POST', '/expiry/estimate');
    vi.unstubAllGlobals();
    expect(respuesta.status).toBe(422);
    expect(respuesta.payload.error).toBe('BAD_JSON');
  });

  it('sin candidatos no se llama a nadie', async () => {
    const respuesta = await call('POST', '/expiry/estimate');
    expect(respuesta.status).toBe(200);
    expect(respuesta.payload.data).toMatchObject({ catalogo: 0, ia: 0, sinFecha: 0 });
  });
});
