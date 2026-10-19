import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import type { AppEnv } from '../types/hono-env.js';
import {
  createReceiptItemSchema,
  updateReceiptItemSchema,
  updateReceiptSchema
} from '../schemas/receipts.schema.js';
import { storeTicket, detectarKindTicket } from '../utils/uploads.js';
import { ensureDefaultCategories as ensurePantryCategories } from '../utils/pantry-categories.js';
import { productKeyOf } from '../utils/product-key.js';
import { activeHouseholdId } from '../utils/household-context.js';
import { queueProductImageSearch } from '../utils/product-image-search.js';
import { encolarTicket, pararTrabajo, reencolar, registrarTienda } from '../utils/ticket-queue.js';

/**
 * La lectura de tickets por IA (HOGARIA-SPEC ## 12aj).
 *
 * El ciclo entero de un ticket: se sube (imagen o PDF, validado por firma), entra en la cola
 * local de IA, el modelo va devolviendo la estructura JSON directamente —SIN OCR: el parte dice
 * que lee mal la imagen y no aporta—, las lineas se ven llegar poco a poco, y nada toca el
 * inventario hasta que la persona lo CONFIRMA. La revision edita cada linea entera (categoria,
 * precio, cantidad, oferta, nota), y el confirm hace tres cosas: registra la tienda si no
 * existe, apunta los precios con su tienda y sube la compra al inventario.
 */

const receiptsRoutes = new Hono<AppEnv>();
receiptsRoutes.use('*', authMiddleware);

/** El techo de un ticket subido: diez megas, que un PDF escaneado pesa. */
const MAX_TICKET_BYTES = 10 * 1024 * 1024;

function filaDeRecibo(db: ReturnType<typeof getDatabase>, userId: string, id: string) {
  const householdId = activeHouseholdId(db, userId);
  return db
    .prepare(
      `SELECT * FROM receipts WHERE id = ?
       AND (household_id = ? OR (household_id IS NULL AND user_id = ?))`
    )
    .get(id, householdId, userId) as Record<string, unknown> | undefined;
}

function pintar(recibo: Record<string, any>, items: number) {
  return {
    id: recibo.id,
    status: recibo.status,
    store: recibo.store,
    purchaseDate: recibo.purchase_date ?? null,
    currency: recibo.currency,
    totalMinor: recibo.total_minor,
    notes: recibo.notes,
    fileUrl: recibo.file_url,
    fileKind: recibo.file_kind,
    fileName: recibo.file_name,
    error: recibo.error_code,
    warnings: JSON.parse(String(recibo.warnings ?? '[]')) as string[],
    createdAt: recibo.created_at,
    updatedAt: recibo.updated_at,
    confirmedAt: recibo.confirmed_at,
    items
  };
}

function contarItems(db: ReturnType<typeof getDatabase>, receiptId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM receipt_items WHERE receipt_id = ?').get(receiptId) as {
      n: number;
    }
  ).n;
}

// ── subir ──
receiptsRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();

  const cuerpo = await c.req.parseBody().catch(() => null);
  const fichero = cuerpo && 'file' in cuerpo ? (cuerpo.file as File) : null;
  if (!fichero || typeof fichero === 'string') {
    return c.json(
      { success: false, error: 'NO_FILE', message: 'Falta el fichero del ticket' },
      400
    );
  }
  const bytes = Buffer.from(await fichero.arrayBuffer());
  if (bytes.byteLength === 0)
    return c.json({ success: false, error: 'EMPTY_FILE', message: 'El fichero esta vacio' }, 400);
  if (bytes.byteLength > MAX_TICKET_BYTES) {
    return c.json({ success: false, error: 'FILE_TOO_LARGE', message: 'Maximo 10 MB' }, 413);
  }
  // La firma manda: lo que diga el Content-Type del formulario es una opinion.
  const kind = detectarKindTicket(bytes);
  if (!kind) {
    return c.json(
      { success: false, error: 'BAD_FILE_TYPE', message: 'Solo imagen (PNG, JPEG, WebP) o PDF' },
      415
    );
  }

  const url = storeTicket(userId, bytes, kind);
  const id = nanoid();
  const householdId = activeHouseholdId(db, userId);
  db.prepare(
    `INSERT INTO receipts
       (id, user_id, household_id, status, file_url, file_kind, file_name, file_bytes, ai_output_language)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    householdId,
    url,
    kind,
    (fichero.name || '').slice(0, 120),
    bytes.byteLength,
    c.get('appLanguage')
  );
  encolarTicket(db, userId, id);

  return c.json({ success: true, data: pintar(filaDeRecibo(db, userId, id)!, 0) }, 201);
});

// ── la cola, para el icono de la cabecera ──
receiptsRoutes.get('/queue', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  const trabajos = db
    .prepare(
      `SELECT j.id, j.status, j.attempts, j.max_attempts, j.error_code, j.created_at,
              r.id AS receipt_id, r.store, r.file_name, r.status AS receipt_status,
              (SELECT COUNT(*) FROM receipt_items WHERE receipt_id = r.id) AS items
       FROM ai_jobs j LEFT JOIN receipts r ON r.id = j.receipt_id
       WHERE j.user_id = ? AND j.kind = 'receipt'
       AND (r.household_id = ? OR (r.household_id IS NULL AND r.user_id = ?))
       AND j.status IN ('queued', 'running', 'failed', 'stopped')
       ORDER BY j.created_at DESC LIMIT 50`
    )
    .all(userId, householdId, userId) as any[];
  return c.json({
    success: true,
    data: {
      jobs: trabajos,
      counts: {
        queued: trabajos.filter((t) => t.status === 'queued').length,
        running: trabajos.filter((t) => t.status === 'running').length,
        failed: trabajos.filter((t) => t.status === 'failed').length
      }
    }
  });
});

receiptsRoutes.post('/queue/stop', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  const jobs = db
    .prepare(
      `SELECT j.id, j.status FROM ai_jobs j JOIN receipts r ON r.id = j.receipt_id
       WHERE j.user_id = ? AND j.kind = 'receipt'
         AND (r.household_id = ? OR (r.household_id IS NULL AND r.user_id = ?))
         AND j.status IN ('queued', 'running')`
    )
    .all(userId, householdId, userId) as { id: string; status: string }[];
  const resultado = { cancelados: 0, detenidos: 0 };
  for (const job of jobs) {
    if (!pararTrabajo(job.id)) continue;
    if (job.status === 'running') resultado.cancelados += 1;
    else resultado.detenidos += 1;
  }
  return c.json({ success: true, data: resultado });
});

// ── lista y ficha ──
receiptsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const scope = c.req.query('scope') ?? 'all';
  if (scope !== 'all' && scope !== 'active' && scope !== 'history') {
    return c.json(
      { success: false, error: 'INVALID_SCOPE', message: 'Sección de tickets no válida' },
      400
    );
  }
  const householdId = activeHouseholdId(db, userId);
  const scoped = scope !== 'all';
  const parsedLimit = Number(c.req.query('limit'));
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 50;
  const parsedOffset = Number(c.req.query('offset'));
  const offset = Number.isInteger(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;
  const statusFilter =
    scope === 'history'
      ? "AND r.status IN ('review', 'confirmed', 'failed', 'stopped')"
      : scope === 'active'
        ? "AND r.status IN ('queued', 'analyzing')"
        : '';
  const order =
    scope === 'history'
      ? `ORDER BY CASE WHEN r.purchase_date IS NULL OR TRIM(r.purchase_date) = '' THEN 1 ELSE 0 END,
                  r.purchase_date DESC, r.created_at DESC, r.id DESC`
      : 'ORDER BY r.created_at DESC, r.id DESC';
  const pageSize = scope === 'history' ? limit + 1 : 100;
  const recibos = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM receipt_items i WHERE i.receipt_id = r.id) AS items
       FROM receipts r WHERE (r.household_id = ? OR (r.household_id IS NULL AND r.user_id = ?)) ${statusFilter}
       ${order} LIMIT ? OFFSET ?`
    )
    .all(householdId, userId, pageSize, scoped ? offset : 0) as any[];
  const hasMore = scope === 'history' && recibos.length > limit;
  const pagina = scope === 'history' ? recibos.slice(0, limit) : recibos;
  return c.json({
    success: true,
    data: pagina.map((recibo) => pintar(recibo, recibo.items)),
    ...(scope === 'history' ? { pagination: { offset, limit, hasMore } } : {})
  });
});

receiptsRoutes.get('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  const lineas = db
    .prepare('SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY position, created_at')
    .all(String(recibo.id)) as any[];
  const trabajo = db
    .prepare(
      `SELECT id, status, attempts, max_attempts, error_code, error_detail FROM ai_jobs WHERE receipt_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(String(recibo.id)) as any | undefined;
  return c.json({
    success: true,
    data: {
      ...pintar(recibo, lineas.length),
      lines: lineas.map((linea) => ({
        id: linea.id,
        name: linea.name,
        quantity: linea.quantity,
        unit: linea.unit,
        category: linea.category,
        priceMinor: linea.price_minor,
        offer:
          linea.offer_buy && linea.offer_take
            ? { buy: linea.offer_buy, take: linea.offer_take }
            : null,
        note: linea.note,
        confidence: linea.confidence
      })),
      job: trabajo ?? null
    }
  });
});

// ── encabezado corregible ──
receiptsRoutes.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  // `formPartial` pierde el tipado fino a proposito (form.ts): el repo lo consume con casts tras
  // el parse, y aqui igual —la validez la garantizo el esquema, no el tipo.
  const input = updateReceiptSchema.parse(await c.req.json().catch(() => ({}))) as {
    store?: string | null;
    purchaseDate?: string | null;
    notes?: string | null;
  };
  if (recibo.status === 'confirmed' && input.notes !== undefined) {
    return c.json(
      { success: false, error: 'RECEIPT_CONFIRMED', message: 'Un ticket confirmado no se retoca' },
      409
    );
  }
  const sets: string[] = [];
  const valores: unknown[] = [];
  if (input.store !== undefined) {
    sets.push('store = ?', 'store_manual = 1');
    valores.push(input.store?.trim() || null);
  }
  if (input.purchaseDate !== undefined) {
    sets.push('purchase_date = ?', 'purchase_date_manual = 1');
    valores.push(input.purchaseDate);
  }
  if (input.notes !== undefined) {
    sets.push('notes = ?');
    valores.push(input.notes?.trim() || null);
  }
  if (sets.length > 0) {
    db.prepare(
      `UPDATE receipts SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...valores, recibo.id);
  }
  return c.json({
    success: true,
    data: pintar(filaDeRecibo(db, userId, String(recibo.id))!, contarItems(db, String(recibo.id)))
  });
});

// ── las lineas, una a una ──
function permisoDeRevision(estado: unknown): boolean {
  return estado === 'review' || estado === 'failed' || estado === 'stopped';
}

receiptsRoutes.post('/:id/items', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  if (!permisoDeRevision(recibo.status)) {
    return c.json(
      { success: false, error: 'RECEIPT_NOT_EDITABLE', message: 'Este ticket no esta en revision' },
      409
    );
  }
  const input = createReceiptItemSchema.parse(await c.req.json()) as {
    name: string;
    quantity: number;
    unit?: string | null;
    category?: string | null;
    priceMinor?: number | null;
    offer?: { buy: number; take: number } | null;
    note?: string | null;
  };
  const id = nanoid();
  const posicion = contarItems(db, String(recibo.id));
  db.prepare(
    `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit, category, price_minor, offer_buy, offer_take, note, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    recibo.id,
    input.name,
    input.quantity,
    input.unit ?? null,
    input.category ?? 'other',
    input.priceMinor ?? null,
    input.offer?.buy ?? null,
    input.offer?.take ?? null,
    input.note ?? null,
    posicion
  );
  return c.json({ success: true, data: { id } }, 201);
});

receiptsRoutes.patch('/:id/items/:itemId', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  if (!permisoDeRevision(recibo.status)) {
    return c.json(
      { success: false, error: 'RECEIPT_NOT_EDITABLE', message: 'Este ticket no esta en revision' },
      409
    );
  }
  const linea = db
    .prepare('SELECT * FROM receipt_items WHERE id = ? AND receipt_id = ?')
    .get(c.req.param('itemId'), recibo.id) as { id: string } | undefined;
  if (!linea)
    return c.json({ success: false, error: 'ITEM_NOT_FOUND', message: 'Linea no encontrada' }, 404);
  const input = updateReceiptItemSchema.parse(await c.req.json()) as Partial<{
    name: string;
    quantity: number;
    unit: string | null;
    category: string | null;
    priceMinor: number | null;
    offer: { buy: number; take: number } | null;
    note: string | null;
  }>;

  const sets: string[] = [];
  const valores: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    valores.push(input.name);
  }
  if (input.quantity !== undefined) {
    sets.push('quantity = ?');
    valores.push(input.quantity);
  }
  if (input.unit !== undefined) {
    sets.push('unit = ?');
    valores.push(input.unit || null);
  }
  if (input.category !== undefined) {
    sets.push('category = ?');
    valores.push(input.category || 'other');
  }
  if (input.priceMinor !== undefined) {
    sets.push('price_minor = ?');
    valores.push(input.priceMinor);
  }
  if (input.offer !== undefined) {
    sets.push('offer_buy = ?');
    sets.push('offer_take = ?');
    valores.push(input.offer?.buy ?? null, input.offer?.take ?? null);
  }
  if (input.note !== undefined) {
    sets.push('note = ?');
    valores.push(input.note || null);
  }
  if (sets.length > 0) {
    db.prepare(
      `UPDATE receipt_items SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...valores, linea.id);
  }
  return c.json({ success: true, data: { id: linea.id } });
});

receiptsRoutes.delete('/:id/items/:itemId', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  if (!permisoDeRevision(recibo.status)) {
    return c.json(
      { success: false, error: 'RECEIPT_NOT_EDITABLE', message: 'Este ticket no esta en revision' },
      409
    );
  }
  db.prepare('DELETE FROM receipt_items WHERE id = ? AND receipt_id = ?').run(
    c.req.param('itemId'),
    recibo.id
  );
  return c.json({ success: true, data: { ok: true } });
});

// ── confirmar: tienda + precios + inventario ──
receiptsRoutes.post('/:id/confirm', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  if (!permisoDeRevision(recibo.status)) {
    return c.json(
      {
        success: false,
        error: 'RECEIPT_NOT_CONFIRMABLE',
        message: 'Este ticket no esta listo para confirmar'
      },
      409
    );
  }
  const lineas = db
    .prepare('SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY position, created_at')
    .all(String(recibo.id)) as any[];
  if (lineas.length === 0) {
    return c.json(
      { success: false, error: 'NO_LINES', message: 'No hay lineas que confirmar' },
      409
    );
  }

  const tienda = String(recibo.store ?? '').trim() || null;
  const householdId = typeof recibo.household_id === 'string' ? recibo.household_id : null;
  if (tienda) registrarTienda(db, userId, tienda, householdId);
  let precios = 0;
  let pantryMoved = 0;
  let pantryMerged = 0;
  let categoriasValidas = new Set<string>();
  const productosParaBuscarImagen = new Set<string>();

  db.transaction(() => {
    ensurePantryCategories(db, userId, householdId);
    // El catalogo de la casa, ya con las categorias por defecto creadas: la categoria de la
    // linea solo se respeta si existe de verdad (## 12aj: 'category' es clave de pantry).
    categoriasValidas = new Set(
      (
        db
          .prepare(
            `SELECT key FROM pantry_categories
             WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)`
          )
          .all(householdId, userId) as { key: string }[]
      ).map((fila) => fila.key)
    );
    const apuntaPrecio = db.prepare(
      `INSERT INTO price_observations
         (id, user_id, household_id, product_key, product_name, store_name, price_minor, quantity, source, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'receipt', CURRENT_TIMESTAMP)`
    );
    const buscaFicha = db.prepare(
      `SELECT id, name, quantity FROM ingredients
       WHERE (household_id = ? OR (household_id IS NULL AND user_id = ?))
         AND lower(trim(name)) = lower(trim(?))`
    );
    const sumaStock = db.prepare(
      'UPDATE ingredients SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    const reponeStock = db.prepare(
      'UPDATE ingredients SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    const meteFicha = db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, expiration_date, location, image, barcode, notes, aliases)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'pantry', NULL, NULL, NULL, '[]')`
    );

    for (const linea of lineas) {
      const cantidad = Number(linea.quantity) > 0 ? Number(linea.quantity) : 1;
      if (linea.price_minor !== null && linea.price_minor !== undefined) {
        apuntaPrecio.run(
          nanoid(),
          userId,
          householdId,
          productKeyOf(linea.name),
          linea.name,
          tienda,
          Math.trunc(Number(linea.price_minor)),
          cantidad
        );
        precios += 1;
      }

      // ——— al inventario, con la categoria revisada: la regla de duplicados es la del vuelco de
      // la compra (## 12ag): misma ficha con stock SUMA; ficha a cero REPONE; sin ficha CREA —
      // pero aqui la categoria la decide la revision, no la reserva.
      const candidatos = buscaFicha.all(householdId, userId, linea.name) as {
        id: string;
        name: string;
        quantity: number;
      }[];
      const clave = productKeyOf(linea.name);
      const ficha = candidatos.find((fila) => productKeyOf(fila.name) === clave) ?? null;
      if (ficha) {
        if (Number(ficha.quantity) > 0) {
          sumaStock.run(cantidad, ficha.id);
          pantryMerged += 1;
        } else {
          reponeStock.run(cantidad, ficha.id);
          pantryMoved += 1;
        }
        productosParaBuscarImagen.add(ficha.id);
        continue;
      }
      const categoria = categoriasValidas.has(String(linea.category))
        ? String(linea.category)
        : 'other';
      const ingredientId = nanoid();
      meteFicha.run(
        ingredientId,
        userId,
        householdId,
        linea.name,
        categoria,
        cantidad,
        linea.unit ?? 'unit'
      );
      productosParaBuscarImagen.add(ingredientId);
      pantryMoved += 1;
    }

    db.prepare(
      `UPDATE receipts SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(recibo.id);
  })();

  for (const ingredientId of productosParaBuscarImagen) {
    try {
      queueProductImageSearch(db, userId, ingredientId);
    } catch {
      // La búsqueda de imagen no invalida la confirmación del ticket.
    }
  }

  return c.json({
    success: true,
    data: { pricesRecorded: precios, pantryMoved, pantryMerged, store: tienda }
  });
});

// ── parar y reintentar ──
receiptsRoutes.post('/:id/stop', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  const trabajo = db
    .prepare(
      `SELECT id FROM ai_jobs WHERE receipt_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`
    )
    .get(String(recibo.id)) as { id: string } | undefined;
  if (!trabajo) return c.json({ success: true, data: { stopped: 0 } });
  const cancelado = pararTrabajo(trabajo.id);
  if (!cancelado) {
    // estaba en cola sin correr: se marca parado a mano
    db.prepare(
      `UPDATE ai_jobs SET status = 'stopped', claim_generation = claim_generation + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(trabajo.id);
    db.prepare(
      `UPDATE receipts SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(recibo.id);
  }
  return c.json({ success: true, data: { stopped: 1 } });
});

receiptsRoutes.post('/:id/retry', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  if (recibo.status === 'queued' || recibo.status === 'analyzing') {
    return c.json({ success: true, data: { requeued: false, reason: 'already-running' } });
  }
  const trabajo = db
    .prepare('SELECT id FROM ai_jobs WHERE receipt_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(String(recibo.id)) as { id: string } | undefined;
  if (!trabajo)
    return c.json(
      { success: false, error: 'JOB_NOT_FOUND', message: 'No hay trabajo que reintentar' },
      404
    );
  const reencolado = reencolar(trabajo.id);
  return c.json({ success: true, data: { requeued: reencolado } });
});

receiptsRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const recibo = filaDeRecibo(db, userId, c.req.param('id'));
  if (!recibo)
    return c.json(
      { success: false, error: 'RECEIPT_NOT_FOUND', message: 'Ticket no encontrado' },
      404
    );
  // Si su trabajo esta corriendo, se cancela antes: un fetch abortado es la unica forma
  // educada de borrar un ticket que la cola esta leyendo.
  const trabajo = db
    .prepare(
      `SELECT id, status FROM ai_jobs WHERE receipt_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1`
    )
    .get(String(recibo.id)) as { id: string; status: string } | undefined;
  if (trabajo) pararTrabajo(trabajo.id);
  // Los CASCADE de SQLite solo corren con `PRAGMA foreign_keys = ON`, que esta base no promete:
  // las hijas se borran a mano y en ese orden, que es el que las deja sin huerfanas.
  db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').run(recibo.id);
  db.prepare('DELETE FROM ai_jobs WHERE receipt_id = ?').run(recibo.id);
  db.prepare('DELETE FROM receipts WHERE id = ?').run(recibo.id);
  return c.json({ success: true, data: { ok: true } });
});

export { receiptsRoutes };
