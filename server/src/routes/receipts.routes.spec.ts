import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deleteUpload, resolveUploadUrl, uploadsRoot } from '../utils/uploads.js';

/**
 * La lectura de tickets por IA (HOGARIA-SPEC ## 12aj), sin montar un proveedor: lo que se
 * prueba es el ciclo que la IA no puede romper —subir valida la FIRMA del fichero, la cola
 * falla con su codigo cuando no hay configuracion, parar y reintentar dejan el ticket donde
 * toca, la revision edita las lineas, y confirmar registra la tienda, apunta precios y sube
 * la compra al inventario CON la categoria revisada—.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let alice: { id: string; token: string };

async function makeUser(email: string, householdId: string | null = null) {
  const id = `u-${email.split('@')[0]}`;
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email, 'Cocinera', 'hash', householdId);
  if (householdId && db.prepare('SELECT 1 FROM households WHERE id = ?').get(householdId)) {
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run(`member-${id}`, householdId, id);
  }
  const config = await import('../config/app.config.js');
  return {
    id,
    token: jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' })
  };
}

async function call(method: string, path: string, body?: unknown, token = alice.token) {
  const response = await app.request(`/api/receipts${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
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

/** Un PNG de mentira: la firma de 8 bytes es lo que la ruta valida. */
const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_TICKET_BYTES = 10 * 1024 * 1024;

function archivosDeTickets(): string[] {
  const dir = join(uploadsRoot(':memory:'), 'receipts');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

async function subirTicket(
  nombre = 'ticket.png',
  bytes: Buffer = PNG_FIRMA,
  tipo = 'image/png',
  language = 'es'
) {
  const formulario = new FormData();
  formulario.append('file', new File([new Uint8Array(bytes)], nombre, { type: tipo }));
  const response = await app.request('/api/receipts', {
    method: 'POST',
    headers: { authorization: `Bearer ${alice.token}`, 'x-app-language': language },
    body: formulario
  });
  return { status: response.status, payload: (await response.json()) as any };
}

/** Espera a que el trabajador de la cola mueva el ticket de `queued` a otra cosa. */
async function esperarEstado(id: string, estado: string, ms = 8000): Promise<any> {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    const ficha = await call('GET', `/${id}`);
    if (ficha.payload?.data?.status === estado) return ficha.payload.data;
    await new Promise((resolver) => setTimeout(resolver, 150));
  }
  throw new Error(`El ticket nunca llego a ${estado}`);
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const { receiptsRoutes } = await import('./receipts.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.route('/api/receipts', receiptsRoutes);
});

afterAll(() => closeDatabase?.());
afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  db.exec(
    'DELETE FROM receipt_items; DELETE FROM ai_jobs; DELETE FROM receipts; DELETE FROM stores; DELETE FROM price_observations; DELETE FROM ingredients; DELETE FROM pantry_categories; DELETE FROM ai_configs; DELETE FROM household_members; DELETE FROM users;'
  );
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
});

describe('POST / (subir)', () => {
  it('fija el idioma activo como metadato del ticket antes de encolarlo', async () => {
    const subida = await subirTicket('ticket.png', PNG_FIRMA, 'image/png', 'en');
    const recibo = db
      .prepare('SELECT ai_output_language FROM receipts WHERE id = ?')
      .get(subida.payload.data.id) as { ai_output_language: string };

    expect(subida.status).toBe(201);
    expect(recibo.ai_output_language).toBe('en');
  });

  it('un PNG valido entra en la cola con su trabajo, y la cola sin configuracion falla con NO_CONFIG', async () => {
    const subida = await subirTicket();
    expect(subida.status).toBe(201);
    expect(subida.payload.data.status).toBe('queued');
    expect(subida.payload.data.fileKind).toBe('png');
    expect(subida.payload.data.purchaseDate).toBeNull();
    expect(subida.payload.data.createdAt).toBeTruthy();

    const trabajo = db
      .prepare('SELECT * FROM ai_jobs WHERE receipt_id = ?')
      .get(subida.payload.data.id) as any;
    expect(trabajo.status).toBe('queued');

    // Sin configuracion de IA la lectura no puede ni empezar: el codigo de error es el que
    // la pantalla traduce por «configura la IA».
    const ficha = await esperarEstado(subida.payload.data.id, 'failed');
    expect(ficha.error).toBe('NO_CONFIG');
    expect(ficha.job.status).toBe('failed');
  });

  it('no persiste ni expone una clave que el proveedor repita al fallar', async () => {
    const secret = 'synthetic-receipt-provider-secret';
    const configId = 'receipt-redaction-config';
    const filesBefore = archivosDeTickets();
    vi.stubGlobal(
      'fetch',
      async () => new Response(`Provider rejected Bearer ${secret}`, { status: 401 })
    );
    db.prepare(
      `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, retry_attempts, concurrency, is_active)
       VALUES (?, ?, 'Synthetic provider', 'custom', 'https://receipt-redaction.invalid/v1', ?, 'synthetic-model', 0, 0, 1)`
    ).run(configId, alice.id, secret);

    try {
      const uploaded = await subirTicket();
      expect(uploaded.status).toBe(201);

      const detail = await esperarEstado(uploaded.payload.data.id, 'failed');
      const job = db
        .prepare('SELECT error_code, error_detail FROM ai_jobs WHERE receipt_id = ?')
        .get(uploaded.payload.data.id) as { error_code: string; error_detail: string };

      expect(job.error_code).toBe('PROVIDER');
      expect(job.error_detail).toBe('AI API error: HTTP 401');
      expect(JSON.stringify(detail.job)).not.toContain(secret);
      expect(JSON.stringify(detail)).not.toContain(secret);
    } finally {
      const root = uploadsRoot(':memory:');
      for (const file of archivosDeTickets()) {
        if (!filesBefore.includes(file)) deleteUpload(`/api/uploads/receipts/${file}`, root);
      }
    }
  });

  it('no persiste excerpts del parseador si el proveedor devuelve un body 200 que no es JSON', async () => {
    const secret = 'synthetic-malformed-receipt-secret';
    const configId = 'receipt-malformed-redaction-config';
    const filesBefore = archivosDeTickets();
    vi.stubGlobal('fetch', async () => new Response(`Invalid API key: ${secret}`, { status: 200 }));
    db.prepare(
      `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, retry_attempts, concurrency, is_active)
       VALUES (?, ?, 'Synthetic provider', 'custom', 'https://receipt-redaction.invalid/v1', ?, 'synthetic-model', 0, 0, 1)`
    ).run(configId, alice.id, secret);

    try {
      const uploaded = await subirTicket();
      expect(uploaded.status).toBe(201);

      const detail = await esperarEstado(uploaded.payload.data.id, 'failed');
      const job = db
        .prepare('SELECT error_code, error_detail FROM ai_jobs WHERE receipt_id = ?')
        .get(uploaded.payload.data.id) as { error_code: string; error_detail: string };

      expect(job.error_code).toBe('BAD_JSON');
      expect(job.error_detail).toBe('Invalid AI response format');
      expect(JSON.stringify(detail)).not.toContain(secret);
    } finally {
      const root = uploadsRoot(':memory:');
      for (const file of archivosDeTickets()) {
        if (!filesBefore.includes(file)) deleteUpload(`/api/uploads/receipts/${file}`, root);
      }
    }
  });

  it('la firma manda: un exe con nombre de png no pasa, y un PDF si', async () => {
    const malo = await subirTicket('ticket.png', Buffer.from('MZ\x90\x00 virus'), 'image/png');
    expect(malo.status).toBe(415);
    expect(malo.payload.error).toBe('BAD_FILE_TYPE');

    const pdf = await subirTicket('ticket.pdf', Buffer.from('%PDF-1.7 fingido'), 'application/pdf');
    expect(pdf.status).toBe(201);
    expect(pdf.payload.data.fileKind).toBe('pdf');
  });

  it('sin fichero no hay ticket', async () => {
    const response = await app.request('/api/receipts', {
      method: 'POST',
      headers: { authorization: `Bearer ${alice.token}` },
      body: new FormData()
    });
    expect(response.status).toBe(400);
  });

  it('rechaza un fichero vacío sin guardar ticket ni archivo', async () => {
    const archivosAntes = archivosDeTickets();
    const vacio = await subirTicket('vacio.png', Buffer.alloc(0));

    expect(vacio.status).toBe(400);
    expect(vacio.payload.error).toBe('EMPTY_FILE');
    expect(db.prepare('SELECT COUNT(*) AS n FROM receipts').get()).toEqual({ n: 0 });
    expect(archivosDeTickets()).toEqual(archivosAntes);
  });

  it('acepta exactamente 10 MiB por firma y la cola falla limpiamente sin proveedor', async () => {
    const archivosAntes = archivosDeTickets();
    const bytes = Buffer.alloc(MAX_TICKET_BYTES);
    PNG_FIRMA.copy(bytes);
    let fileUrl: string | undefined;

    try {
      // El MIME no es la fuente de verdad: los primeros bytes sí son una firma PNG.
      const subida = await subirTicket('limite.png', bytes, 'application/octet-stream');
      if (subida.status === 201) fileUrl = subida.payload.data.fileUrl;

      expect(subida.status).toBe(201);
      expect(subida.payload.data.fileKind).toBe('png');
      expect(fileUrl).toMatch(/^\/api\/uploads\/receipts\//);

      const ficha = await esperarEstado(subida.payload.data.id, 'failed');
      expect(ficha.error).toBe('NO_CONFIG');

      const ruta = resolveUploadUrl(fileUrl!, uploadsRoot(':memory:'));
      expect(ruta).not.toBeNull();
      expect(statSync(ruta!).size).toBe(MAX_TICKET_BYTES);
    } finally {
      const root = uploadsRoot(':memory:');
      for (const file of archivosDeTickets()) {
        if (!archivosAntes.includes(file)) deleteUpload(`/api/uploads/receipts/${file}`, root);
      }
    }

    expect(archivosDeTickets()).toEqual(archivosAntes);
  });

  it('rechaza 10 MiB + 1 con FILE_TOO_LARGE antes de persistir nada', async () => {
    const archivosAntes = archivosDeTickets();
    const bytes = Buffer.alloc(MAX_TICKET_BYTES + 1);
    PNG_FIRMA.copy(bytes);
    const subida = await subirTicket('demasiado-grande.png', bytes);

    expect(subida.status).toBe(413);
    expect(subida.payload.error).toBe('FILE_TOO_LARGE');
    expect(db.prepare('SELECT COUNT(*) AS n FROM receipts').get()).toEqual({ n: 0 });
    expect(archivosDeTickets()).toEqual(archivosAntes);
  });
});

describe('la cola', () => {
  it('GET /queue cuenta lo que hay, y stop-all deja los tickets en stopped', async () => {
    await subirTicket();
    const b = await subirTicket();
    const cola = await call('GET', '/queue');
    expect(cola.payload.data.jobs).toHaveLength(2);

    const parada = await call('POST', '/queue/stop');
    expect(parada.payload.data.detenidos + parada.payload.data.cancelados).toBeGreaterThanOrEqual(
      1
    );

    const fichaB = await call('GET', `/${b.payload.data.id}`);
    expect(['stopped', 'failed', 'queued']).toContain(fichaB.payload.data.status);
    // El trabajo parado en cola no corre mas.
    const trabajos = db.prepare('SELECT status FROM ai_jobs').all() as { status: string }[];
    for (const trabajo of trabajos) expect(trabajo.status).not.toBe('running');
  });

  it('retry devuelve el trabajo a la cola desde failed', async () => {
    const subida = await subirTicket();
    await esperarEstado(subida.payload.data.id, 'failed');
    const reintento = await call('POST', `/${subida.payload.data.id}/retry`);
    expect(reintento.payload.data.requeued).toBe(true);
    const trabajo = db
      .prepare('SELECT status FROM ai_jobs WHERE receipt_id = ?')
      .get(subida.payload.data.id) as any;
    expect(trabajo.status).toBe('queued');
    // Y volvera a fallar (sigue sin haber configuracion): el ciclo se puede repetir.
    await esperarEstado(subida.payload.data.id, 'failed');
  });

  it('la concurrencia por configuración: default ilimitado, y respeta el valor guardado', async () => {
    const { concurrenciaDe } = await import('../utils/ticket-queue.js');
    expect(concurrenciaDe(db, alice.id)).toBe(Number.POSITIVE_INFINITY);

    const id = 'cfg-conc';
    db.prepare(
      `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, concurrency, is_active)
       VALUES (?, ?, 'prueba', 'custom', 'http://localhost:9/v1', 'k', 'm', 3, 1)`
    ).run(id, alice.id);
    expect(concurrenciaDe(db, alice.id)).toBe(3);
  });
});

describe('historial completo', () => {
  it('no filtra ni abre los tickets del hogar anterior tras cambiar el hogar activo', async () => {
    const oldHousehold = 'house-receipts-old-home';
    const activeHousehold = 'house-receipts-active-home';
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      oldHousehold,
      'Casa anterior',
      'invite-receipts-old-home'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      activeHousehold,
      'Casa activa',
      'invite-receipts-active-home'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('old-home-alice', oldHousehold, alice.id);
    const oldReceiptId = 'receipt-from-old-home';
    db.prepare(
      `INSERT INTO receipts (id, user_id, household_id, status, file_url, file_kind, file_name)
       VALUES (?, ?, ?, 'review', '/api/uploads/receipts/synthetic.png', 'png', 'synthetic.png')`
    ).run(oldReceiptId, alice.id, oldHousehold);
    db.prepare(
      `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit, category, price_minor)
       VALUES ('old-home-item', ?, 'Leche', 2, 'l', 'dairy', 250)`
    ).run(oldReceiptId);
    db.prepare(
      `INSERT INTO ai_jobs (id, user_id, kind, receipt_id, status)
       VALUES ('old-home-job', ?, 'receipt', ?, 'running')`
    ).run(alice.id, oldReceiptId);

    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('active-home-alice', activeHousehold, alice.id);
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
       VALUES ('active-home-milk', ?, ?, 'Leche', 'dairy', 10, 'l')`
    ).run(alice.id, activeHousehold);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(activeHousehold, alice.id);

    const list = await call('GET', '?scope=history');
    const detail = await call('GET', `/${oldReceiptId}`);
    const update = await call('PATCH', `/${oldReceiptId}`, { store: 'Otra tienda' });
    const confirm = await call('POST', `/${oldReceiptId}/confirm`);
    const remove = await call('DELETE', `/${oldReceiptId}`);
    const queue = await call('GET', '/queue');
    const stopQueue = await call('POST', '/queue/stop');

    expect(list.status).toBe(200);
    expect(list.payload.data.map((receipt: any) => receipt.id)).not.toContain(oldReceiptId);
    expect(detail.status).toBe(404);
    expect(detail.payload.error).toBe('RECEIPT_NOT_FOUND');
    expect(update.status).toBe(404);
    expect(confirm.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(queue.payload.data.jobs.map((job: any) => job.receipt_id)).not.toContain(oldReceiptId);
    expect(stopQueue.payload.data).toEqual({ cancelados: 0, detenidos: 0 });
    expect(db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get('old-home-job')).toEqual({
      status: 'running'
    });
    expect(db.prepare('SELECT status FROM receipts WHERE id = ?').get(oldReceiptId)).toEqual({
      status: 'review'
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ingredients').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM price_observations').get()).toEqual({ n: 0 });
    expect(
      db.prepare('SELECT quantity FROM ingredients WHERE id = ?').get('active-home-milk')
    ).toEqual({
      quantity: 10
    });

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(oldHousehold, alice.id);
    expect((await call('GET', `/${oldReceiptId}`)).status).toBe(200);
    expect((await call('POST', `/${oldReceiptId}/confirm`)).status).toBe(200);
    expect(
      db.prepare('SELECT quantity FROM ingredients WHERE id = ?').get('active-home-milk')
    ).toEqual({
      quantity: 10
    });
    expect(
      db
        .prepare(
          'SELECT household_id, quantity FROM ingredients WHERE name = ? AND household_id = ?'
        )
        .get('Leche', oldHousehold)
    ).toEqual({ household_id: oldHousehold, quantity: 2 });
    expect(
      db.prepare('SELECT household_id FROM price_observations WHERE source = ?').get('receipt')
    ).toEqual({
      household_id: oldHousehold
    });
  });

  it('pagina más de cien recibos terminados, ordena por compra y excluye trabajos en curso', async () => {
    const insert = db.prepare(
      `INSERT INTO receipts (id, user_id, status, store, purchase_date, file_url, file_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'png', ?)`
    );
    for (let index = 0; index < 105; index += 1) {
      const purchaseDate =
        index === 0 ? null : new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
      const uploadedAt = new Date(Date.UTC(2024, 0, index + 1)).toISOString();
      insert.run(
        `history-${index.toString().padStart(3, '0')}`,
        alice.id,
        index % 2 === 0 ? 'review' : 'confirmed',
        `Tienda ${index}`,
        purchaseDate,
        `/api/uploads/receipts/history-${index}.png`,
        uploadedAt
      );
    }
    for (const status of ['queued', 'analyzing']) {
      insert.run(
        `active-${status}`,
        alice.id,
        status,
        'En curso',
        null,
        `/api/uploads/receipts/active-${status}.png`,
        '2025-01-01T00:00:00.000Z'
      );
    }

    const firstPage = await call('GET', '?scope=history&limit=50&offset=0');
    expect(firstPage.status).toBe(200);
    expect(firstPage.payload.data).toHaveLength(50);
    expect(firstPage.payload.pagination).toMatchObject({ offset: 0, limit: 50, hasMore: true });
    expect(firstPage.payload.data[0].purchaseDate).toBe('2024-04-14');
    expect(
      firstPage.payload.data.every(
        (receipt: any) => !['queued', 'analyzing'].includes(receipt.status)
      )
    ).toBe(true);

    const all = [...firstPage.payload.data];
    for (let offset = 50; ; offset += 50) {
      const page = await call('GET', `?scope=history&limit=50&offset=${offset}`);
      all.push(...page.payload.data);
      if (!page.payload.pagination.hasMore) break;
    }

    expect(all).toHaveLength(105);
    expect(new Set(all.map((receipt: any) => receipt.id)).size).toBe(105);
    expect(all.at(-1)).toMatchObject({ id: 'history-000', purchaseDate: null });
  });
});

describe('la revision y el confirm', () => {
  async function ticketEnRevision() {
    const subida = await subirTicket();
    const id = subida.payload.data.id;
    // Sin IA: el ticket falla, y la persona lo rescata a mano (que es la otra mitad del flujo).
    await esperarEstado(id, 'failed');
    await call('PATCH', `/${id}`, { store: 'Mercadona' });
    await call('POST', `/${id}/items`, {
      name: 'Leche entera',
      quantity: 2,
      unit: 'ud',
      category: 'dairy',
      priceMinor: 390
    });
    // 'bakery' NO es una clave del catalogo de despensa (es 'grains'): una categoria que no
    // existe no puede colarse en el inventario, cae a la reserva.
    await call('POST', `/${id}/items`, {
      name: 'Pan de pueblo',
      quantity: 1,
      unit: 'ud',
      category: 'bakery',
      priceMinor: 140
    });
    return id;
  }

  it('permite guardar tienda y fecha en cola o análisis sin cambiar el estado', async () => {
    for (const status of ['queued', 'analyzing'] as const) {
      const id = `editable-${status}`;
      db.prepare(
        `INSERT INTO receipts (id, user_id, status, file_url, file_kind)
         VALUES (?, ?, ?, '/uploads/synthetic-active.png', 'png')`
      ).run(id, alice.id, status);

      const updated = await call('PATCH', `/${id}`, {
        store: `  Tienda ${status}  `,
        purchaseDate: '2024-02-29'
      });

      expect(updated.status).toBe(200);
      expect(updated.payload.data).toMatchObject({
        id,
        status,
        store: `Tienda ${status}`,
        purchaseDate: '2024-02-29'
      });
      expect(
        db.prepare('SELECT store_manual, purchase_date_manual FROM receipts WHERE id = ?').get(id)
      ).toEqual({ store_manual: 1, purchase_date_manual: 1 });
    }
  });

  it('las lineas se editan una a una: categoria, precio, oferta y cantidad', async () => {
    const id = await ticketEnRevision();
    const ficha = await call('GET', `/${id}`);
    const primera = ficha.payload.data.lines[0];

    const editada = await call('PATCH', `/${id}/items/${primera.id}`, {
      category: 'other',
      priceMinor: 350,
      offer: { buy: 3, take: 2 }
    });
    expect(editada.status).toBe(200);

    const despues = await call('GET', `/${id}`);
    expect(despues.payload.data.lines[0].category).toBe('other');
    expect(despues.payload.data.lines[0].priceMinor).toBe(350);
    expect(despues.payload.data.lines[0].offer).toEqual({ buy: 3, take: 2 });
    expect(despues.payload.data.lines[0].quantity).toBe(2);
  });

  it('actualiza todos los campos opcionales de una linea, permite limpiarlos y acepta PATCH vacio', async () => {
    const id = await ticketEnRevision();
    const ficha = await call('GET', `/${id}`);
    const primera = ficha.payload.data.lines[0];

    const establecida = await call('PATCH', `/${id}/items/${primera.id}`, {
      name: 'Leche nueva',
      quantity: 3,
      unit: 'L',
      category: 'dairy',
      priceMinor: 599,
      offer: { buy: 3, take: 2 },
      note: 'revisado'
    });
    expect(establecida.status).toBe(200);

    const limpiada = await call('PATCH', `/${id}/items/${primera.id}`, {
      name: 'Leche nueva',
      quantity: 3,
      unit: null,
      category: null,
      priceMinor: null,
      offer: null,
      note: null
    });
    expect(limpiada.status).toBe(200);

    const vacia = await call('PATCH', `/${id}/items/${primera.id}`, {});
    expect(vacia.status).toBe(200);

    const despues = await call('GET', `/${id}`);
    expect(despues.payload.data.lines[0]).toMatchObject({
      id: primera.id,
      name: 'Leche nueva',
      quantity: 3,
      unit: null,
      category: 'other',
      priceMinor: null,
      offer: null,
      note: null
    });
  });

  it('confirmar registra la tienda, apunta el precio y sube la compra al inventario con SU categoria', async () => {
    const id = await ticketEnRevision();
    const confirmado = await call('POST', `/${id}/confirm`);
    expect(confirmado.status).toBe(200);
    expect(confirmado.payload.data).toMatchObject({ pricesRecorded: 2, store: 'Mercadona' });
    expect(confirmado.payload.data.pantryMoved + confirmado.payload.data.pantryMerged).toBe(2);

    // La tienda detectada queda registrada para la casa.
    const tienda = db.prepare('SELECT name FROM stores').all() as { name: string }[];
    expect(tienda.map((fila) => fila.name)).toContain('Mercadona');

    // El precio con su tienda y su cantidad: lo que la ficha del articulo pinta despues.
    const precio = db
      .prepare('SELECT * FROM price_observations WHERE product_name = ?')
      .get('Leche entera') as any;
    expect(precio).toMatchObject({
      store_name: 'Mercadona',
      price_minor: 390,
      quantity: 2,
      source: 'receipt'
    });

    // Y la ficha del inventario nace en la categoria revisada, no en la reserva.
    const leche = db.prepare('SELECT * FROM ingredients WHERE name = ?').get('Leche entera') as any;
    expect(leche).toMatchObject({ category: 'dairy', quantity: 2, unit: 'ud' });
    const pan = db.prepare('SELECT * FROM ingredients WHERE name = ?').get('Pan de pueblo') as any;
    expect(pan.category).toBe('other');

    const photoJobs = db
      .prepare(
        `SELECT i.name, s.status, j.kind FROM product_image_searches s
         JOIN ingredients i ON i.id = s.ingredient_id
         JOIN ai_jobs j ON j.id = s.job_id
        ORDER BY i.name`
      )
      .all() as { name: string; status: string; kind: string }[];
    expect(photoJobs.map((job) => job.name)).toEqual(['Leche entera', 'Pan de pueblo']);
    expect(photoJobs.every((job) => ['queued', 'running', 'complete'].includes(job.status))).toBe(
      true
    );
    expect(photoJobs.every((job) => job.kind === 'product_image_search')).toBe(true);

    // Confirmado no se puede confirmar otra vez; sus metadatos pueden corregirse sin repetir efectos.
    expect((await call('POST', `/${id}/confirm`)).status).toBe(409);
    expect((await call('PATCH', `/${id}`, { store: 'Lidl' })).status).toBe(200);
  });

  it('reanuda la búsqueda asíncrona para una ficha ya conocida sin imagen', async () => {
    db.prepare(
      `INSERT INTO ingredients (id, user_id, name, category, quantity, unit, location, image)
       VALUES ('legacy-bread', ?, 'Pan de pueblo', 'other', 0, 'ud', 'pantry', NULL)`
    ).run(alice.id);
    const id = await ticketEnRevision();

    expect((await call('POST', `/${id}/confirm`)).status).toBe(200);

    const photoJobs = db
      .prepare(
        `SELECT i.name, s.status, j.kind FROM product_image_searches s
         JOIN ingredients i ON i.id = s.ingredient_id
         JOIN ai_jobs j ON j.id = s.job_id
        ORDER BY i.name`
      )
      .all() as { name: string; status: string; kind: string }[];
    expect(photoJobs.map((job) => job.name)).toEqual(['Leche entera', 'Pan de pueblo']);
    expect(photoJobs.every((job) => ['queued', 'running', 'complete'].includes(job.status))).toBe(
      true
    );
    expect(photoJobs.every((job) => job.kind === 'product_image_search')).toBe(true);
  });

  it('corrige tienda y fecha tras confirmar sin duplicar stock ni observaciones', async () => {
    const id = await ticketEnRevision();
    await call('PATCH', `/${id}`, { store: 'Mercadona Centro', purchaseDate: '2024-02-29' });
    const confirmado = await call('POST', `/${id}/confirm`);
    expect(confirmado.status).toBe(200);

    const stockAntes = db.prepare('SELECT name, quantity FROM ingredients ORDER BY name').all();
    const preciosAntes = db.prepare('SELECT COUNT(*) AS n FROM price_observations').get();
    const correccion = await call('PATCH', `/${id}`, {
      store: 'Tienda corregida',
      purchaseDate: '2025-03-01'
    });

    expect(correccion.status).toBe(200);
    expect(correccion.payload.data).toMatchObject({
      status: 'confirmed',
      store: 'Tienda corregida',
      purchaseDate: '2025-03-01'
    });
    const reabierto = await call('GET', `/${id}`);
    expect(reabierto.payload.data).toMatchObject({
      store: 'Tienda corregida',
      purchaseDate: '2025-03-01'
    });
    expect(
      db.prepare('SELECT store_manual, purchase_date_manual FROM receipts WHERE id = ?').get(id)
    ).toEqual({ store_manual: 1, purchase_date_manual: 1 });
    expect(db.prepare('SELECT name, quantity FROM ingredients ORDER BY name').all()).toEqual(
      stockAntes
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM price_observations').get()).toEqual(preciosAntes);
  });

  it('rechaza una fecha civil imposible y deja la ficha intacta', async () => {
    const id = await ticketEnRevision();
    await call('PATCH', `/${id}`, { store: 'Mercadona', purchaseDate: '2026-02-29' });

    const before = await call('GET', `/${id}`);
    const invalid = await call('PATCH', `/${id}`, { purchaseDate: '2026-02-29' });
    const after = await call('GET', `/${id}`);

    expect(invalid.status).toBe(400);
    expect(after.payload.data.purchaseDate).toBe(before.payload.data.purchaseDate ?? null);
    expect(after.payload.data.store).toBe(before.payload.data.store);
  });

  it('mantiene los metadatos aislados del ticket de otra persona', async () => {
    const id = await ticketEnRevision();
    const other = await makeUser(`other-${Math.random().toString(36).slice(2)}@test.local`);

    const result = await call(
      'PATCH',
      `/${id}`,
      { store: 'Intrusa', purchaseDate: '2024-02-29' },
      other.token
    );

    expect(result.status).toBe(404);
    expect((await call('GET', `/${id}`)).payload.data.store).toBe('Mercadona');
    const otherHistory = await call('GET', '?scope=history', undefined, other.token);
    expect(otherHistory.payload.data.map((receipt: any) => receipt.id)).not.toContain(id);
  });

  it('permite a otra persona del mismo hogar corregir los metadatos compartidos', async () => {
    const householdId = 'house-receipts-metadata';
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      householdId,
      'Casa sintética',
      'invite-receipts-metadata'
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, alice.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run(`member-${alice.id}`, householdId, alice.id);
    const id = await ticketEnRevision();
    const member = await makeUser(
      `member-${Math.random().toString(36).slice(2)}@test.local`,
      householdId
    );

    const updated = await call(
      'PATCH',
      `/${id}`,
      { store: 'Tienda del hogar', purchaseDate: '2024-02-29' },
      member.token
    );

    expect(updated.status).toBe(200);
    expect(updated.payload.data).toMatchObject({
      store: 'Tienda del hogar',
      purchaseDate: '2024-02-29'
    });
    const sharedHistory = await call('GET', '?scope=history', undefined, member.token);
    expect(sharedHistory.payload.data.map((receipt: any) => receipt.id)).toContain(id);
  });

  it('confirmar de nuevo con stock existente SUMA unidades en vez de duplicar la ficha', async () => {
    const id = await ticketEnRevision();
    await call('POST', `/${id}/confirm`);
    const leche = db
      .prepare('SELECT quantity FROM ingredients WHERE name = ?')
      .get('Leche entera') as any;
    expect(leche.quantity).toBe(2);

    // Otro ticket con la misma compra: la ficha ya existe, se suman las unidades.
    const otro = await ticketEnRevision();
    await call('POST', `/${otro}/confirm`);
    const despues = db
      .prepare('SELECT quantity FROM ingredients WHERE name = ?')
      .get('Leche entera') as any;
    expect(despues.quantity).toBe(4);
  });

  it('un ticket sin lineas no se confirma', async () => {
    const subida = await subirTicket();
    await esperarEstado(subida.payload.data.id, 'failed');
    const confirmado = await call('POST', `/${subida.payload.data.id}/confirm`);
    expect(confirmado.status).toBe(409);
    expect(confirmado.payload.error).toBe('NO_LINES');
  });

  it('borrar un ticket se lleva sus lineas y su trabajo', async () => {
    const id = await ticketEnRevision();
    const borrado = await call('DELETE', `/${id}`);
    expect(borrado.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM receipts').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM receipt_items').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_jobs').get()).toMatchObject({ n: 0 });
  });
});
