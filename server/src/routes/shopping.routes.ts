import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { productKeyOf } from '../utils/product-key.js';
import { queueProductImageSearch } from '../utils/product-image-search.js';
import {
  PROTECTED_PANTRY_KEY,
  ensureDefaultCategories as ensurePantryCategories
} from '../utils/pantry-categories.js';
import {
  applyLinesSchema,
  bulkItemsSchema,
  completeListSchema,
  createCategorySchema,
  discountSchema,
  photoAnalyzeSchema,
  photoLinesSchema,
  createItemSchema,
  createListSchema,
  createPriceSchema,
  createSuggestedListSchema,
  listFilterSchema,
  orderSchema,
  parseItemLine,
  priceFilterSchema,
  productIndexSchema,
  updateItemSchema,
  updateListSchema
} from '../schemas/shopping.schema.js';
import { householdMealShoppingApprovalSchema } from '../schemas/household-meal-shopping-approval.schema.js';
import {
  catalogueForPrompt,
  ensureDefaultCategories,
  listCategories,
  upsertCategory
} from '../utils/shopping-categories.js';
import { buildPhotoPrompt } from '../utils/photo-prompt.js';
import { AiCallError, callAI, extractJsonObject } from '../utils/ai-client.js';
import { SHOPPING_PHOTO_RESPONSE_FORMAT } from '../schemas/ai-generated-output.schema.js';
import { describeEvent, readEvents, recordEvent } from '../utils/shopping-events.js';
import {
  channelForList,
  channelsForTray,
  publish,
  subscribe,
  type LiveEvent
} from '../utils/live-hub.js';
import {
  applyLineDiscount,
  basketMoney,
  describeDiscount,
  describeLineDiscount,
  normalizeLineDiscount,
  type LineDiscount,
  normalizeOffer,
  offerOf,
  paidUnits,
  type Discount
} from '../utils/list-discount.js';
import { streamSSE } from 'hono/streaming';
import type { AppEnv } from '../types/hono-env.js';
import { caducidadesDe, comprasDeLaCasa, hoy } from '../utils/caducidades.js';
import {
  hasActiveHouseholdMemberships,
  readActiveHouseholdId
} from '../utils/household-context.js';
import {
  HouseholdMealShoppingApprovalError,
  approveHouseholdMealShopping
} from '../utils/household-meal-shopping-approval.store.js';
import { canViewSharedMeals } from '../utils/shared-meal-calendar.store.js';
import {
  necesidadesDelPlan,
  preciosDeLaCasa,
  sugerenciasDeCompra
} from '../utils/lista-sugerida.js';

/**
 * Lista de la compra y precios (esqueleto de P2/P3 del spec).
 *
 * Las reglas que explican el forma de esta API:
 * - El dinero viaja en centimos (`*Minor`) y las cantidades en reales; nunca se
 *   multiplica un float por un precio para dar el total, se redondea una vez al
 *   final (`roundMinor`).
 * - Las listas son del hogar si el usuario tiene uno (es lo que se comparte con
 *   quien hace la compra), y si no, de la persona.
 * - Borrar una linea es LOGICO (`deleted_at`): la UI de movil ofrece «Deshacer»
 *   durante unos segundos, y eso solo se puede prometer si el dato sigue ahi.
 * - `GET /lists/:id/estimate` calcula con el ultimo precio observado del producto
 *   (primero el del propio usuario, luego el del hogar). No hay catalogo todavia:
 *   la clave es el nombre normalizado (ver `utils/product-key.ts`), que es lo que
 *   permitira migrar a `canonical_products` sin tocar las observaciones.
 */
const shoppingRoutes = new Hono<AppEnv>();

shoppingRoutes.use('*', authMiddleware);

type Scope = { clause: string; params: string[]; householdId: string | null };

function getScope(userId: string): Scope {
  const db = getDatabase();
  const user = db
    .prepare(`SELECT u.household_id AS hid FROM users u WHERE u.id = ?`)
    .get(userId) as { hid: string | null } | undefined;

  if (user?.hid) {
    return {
      // Una fila ligada a un hogar solo se comparte dentro de ese hogar. No basta
      // con ser su creador: al cambiar de casa (o quedarse sin hogar activo) no
      // debemos filtrar datos domésticos anteriores por `user_id`.
      clause: '((user_id = ? AND household_id IS NULL) OR household_id = ?)',
      params: [userId, user.hid],
      householdId: user.hid
    };
  }
  return {
    clause: '(user_id = ? AND household_id IS NULL)',
    params: [userId],
    householdId: null
  };
}

/** Scope list reads from the already validated active membership, including legacy null pointers. */
function getActiveHouseholdScope(userId: string, householdId: string): Scope {
  return {
    clause: '((user_id = ? AND household_id IS NULL) OR household_id = ?)',
    params: [userId, householdId],
    householdId
  };
}

/** 404 con el mismo envoltorio que el resto del server. */
function notFound(c: any, what: string) {
  return c.json({ success: false, message: `${what} not found` }, 404);
}

function roundMinor(value: number): number {
  return Math.max(0, Math.round(value));
}

function readList(db: ReturnType<typeof getDatabase>, scope: Scope, listId: string) {
  return db
    .prepare(`SELECT * FROM shopping_lists WHERE id = ? AND ${scope.clause}`)
    .get(listId, ...scope.params) as any;
}

/**
 * Suceso + aviso en vivo, en la misma llamada. Van juntas SIEMPRE: un `recordEvent`
 * sin `publish` es una auditoria que nadie ve, y un `publish` sin `recordEvent` es un
 * refresco sin rastro de quien lo provoco.
 */
function announce(
  db: ReturnType<typeof getDatabase>,
  list: { id: string; household_id?: string | null } | null,
  userId: string | null,
  action: string,
  itemName: string | null = null
): void {
  if (list) recordEvent(db, { listId: list.id, userId, action, itemName });
  const byName = userId
    ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as any)?.name ?? null)
    : null;
  const event: LiveEvent = {
    type: action.startsWith('item') || action === 'list.clear-checked' ? 'items' : 'list',
    listId: list?.id ?? null,
    action,
    by: userId,
    byName,
    itemName,
    at: new Date().toISOString()
  };
  const channels = [
    ...(list ? [channelForList(list.id)] : []),
    ...channelsForTray({ userId: userId ?? '', householdId: list?.household_id ?? null })
  ];
  publish(channels, event);
}

/** Solo a la bandeja: para el borrado, donde la fila de la lista ya no va a existir. */
function announceToTray(
  db: ReturnType<typeof getDatabase>,
  scope: { userId: string; householdId: string | null },
  action: string,
  listId: string | null
): void {
  publish(channelsForTray(scope), {
    type: 'list',
    listId,
    action,
    by: scope.userId,
    byName:
      (db.prepare('SELECT name FROM users WHERE id = ?').get(scope.userId) as any)?.name ?? null,
    itemName: null,
    at: new Date().toISOString()
  });
}

/** JSON de las dianas multiples, o `null` para que el motor use solo `target`. */
function parseTargets(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const values = parsed
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0);
    return values.length ? [...new Set(values)] : null;
  } catch {
    return null;
  }
}

/** El descuento propio de una linea, en la forma que espera el motor. */
function lineDiscountOf(row: {
  disc_kind?: string | null;
  disc_value_minor?: number | null;
  disc_percent_bps?: number | null;
  disc_units?: number | null;
}): LineDiscount | null {
  if (row.disc_kind !== 'amount' && row.disc_kind !== 'percent') return null;
  return {
    kind: row.disc_kind,
    valueMinor: row.disc_value_minor ?? null,
    percentBps: row.disc_percent_bps ?? null,
    units: row.disc_units ?? null
  };
}
/**
 * La fila de descuento, en la forma que consume `utils/list-discount.ts`. `null`
 * cuando la lista no tiene ninguno: el `estimate` entonces no pinta bloque de
 * descuento, en vez de un «-0,00 €» que sugiere que algo se aplico y no.
 */
function readDiscount(db: ReturnType<typeof getDatabase>, listId: string): Discount | null {
  const row = db
    .prepare('SELECT * FROM shopping_list_discounts WHERE list_id = ?')
    .get(listId) as any;
  if (!row) return null;
  return {
    kind: row.kind,
    valueMinor: row.value_minor ?? null,
    percentBps: row.percent_bps ?? null,
    scope: row.scope,
    firstUnits: row.first_units ?? null,
    target: row.target ?? null,
    // Se lee con tolerancia: un JSON corrupto (una escritura interrumpida) no puede
    // dejar la lista sin abrir; sin dianas el descuento simplemente no se aplica.
    targets: parseTargets(row.targets),
    label: row.label ?? null
  };
}

/** Totales de cabecera: se calculan aqui y no en la UI, para que la lista y el
 *  dashboard digan lo mismo. */
function listTotals(db: ReturnType<typeof getDatabase>, listId: string) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(checked), 0) AS checked,
              COALESCE(SUM(CASE WHEN price_minor IS NOT NULL THEN CAST(ROUND(price_minor * quantity) AS INTEGER) ELSE 0 END), 0) AS priced
       FROM shopping_list_items
       WHERE list_id = ? AND deleted_at IS NULL`
    )
    .get(listId) as { total: number; checked: number; priced: number };
  return { totalItems: row.total, checkedItems: row.checked, pricedTotalMinor: row.priced };
}

// ═══════════════════════════════════════════════════════════════════
// Secciones del carrito (catalogo con color, ver §8f)
// ═══════════════════════════════════════════════════════════════════

/**
 * El catalogo del usuario, con las por defecto sembradas a la primera lectura. Se
 * siembra aqui y no en una migracion global para no escribir filas de todos los
 * usuarios al actualizar el server.
 */
shoppingRoutes.get('/categories', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);
  ensureDefaultCategories(db, userId, scope.householdId);
  return c.json({ success: true, data: listCategories(db, scope.clause, scope.params) });
});

/** Idempotente por clave: 201 si nace, 200 si ya estaba. La IA llama a esto mismo. */
shoppingRoutes.post('/categories', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);
  const body = createCategorySchema.parse(await c.req.json());

  const { category, created } = upsertCategory(db, {
    userId,
    householdId: scope.householdId,
    name: body.name,
    color: body.color ?? null,
    idFactory: () => nanoid()
  });
  return c.json({ success: true, data: category }, created ? 201 : 200);
});

// ═══════════════════════════════════════════════════════════════════
// Listas
// ═══════════════════════════════════════════════════════════════════

shoppingRoutes.get('/lists', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const filter = listFilterSchema.parse(c.req.query());

  // Con el JOIN del agregado, `user_id` a secas seria ambiguo: el ambito se escribe
  // siempre prefijado a la tabla de las listas.
  const scoped = scope.clause
    .replace(/user_id/g, 'l.user_id')
    .replace(/household_id/g, 'l.household_id');
  const conditions = [scoped];
  const params = [...scope.params];

  if (!filter.status) {
    // Por defecto no se ven las terminadas: la pantalla es para lo que queda
    // por comprar, el historial vive en su propia pestana.
    conditions.push(`l.status IN ('active', 'archived')`);
  } else if (filter.status !== 'all') {
    conditions.push('l.status = ?');
    params.push(filter.status);
  }
  // `all` no anade condicion: es el estado «sin filtro», y tratarlo como un valor de
  // la columna dejaba la pesta «Ver todas» vacia (el bug que trajo esta linea).
  // El texto busca en el nombre de la lista Y en lo que hay dentro: quien recuerda
  // «puse lo del jamon en alguna parte» no recuerda en cual.
  if (filter.q) {
    conditions.push(`(l.name LIKE ? OR EXISTS (
      SELECT 1 FROM shopping_list_items si
      WHERE si.list_id = l.id AND si.deleted_at IS NULL AND si.name LIKE ?
    ))`);
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.store) {
    conditions.push('l.store = ?');
    params.push(filter.store);
  }
  if (filter.from) {
    conditions.push('date(l.updated_at) >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    conditions.push('date(l.updated_at) <= ?');
    params.push(filter.to);
  }

  // Los totales salen de un unico agregado, no de una consulta por lista: la bandeja
  // podia tener cien filas y cien consultas, y ordenar por importe lo necesitaba en
  // el SQL de todas formas.
  const totalsJoin = `
    LEFT JOIN (
      SELECT list_id,
             COUNT(*) AS total,
             COALESCE(SUM(checked), 0) AS checked,
             COALESCE(SUM(CASE WHEN price_minor IS NOT NULL
                               THEN CAST(ROUND(price_minor * quantity) AS INTEGER)
                               ELSE 0 END), 0) AS priced
      FROM shopping_list_items
      WHERE deleted_at IS NULL
      GROUP BY list_id
    ) t ON t.list_id = l.id`;

  const having: string[] = [];
  const havingParams: unknown[] = [];
  if (filter.minTotalMinor != null) {
    having.push('COALESCE(t.priced, 0) >= ?');
    havingParams.push(filter.minTotalMinor);
  }

  // `status = 'active' DESC` solo cuando nadie pidio un orden: con `?sort=name` quien
  // abre la bandeja quiere un directorio, no que lo vivo se cuele por delante.
  const direction = filter.dir === 'asc' ? 'ASC' : 'DESC';
  const order =
    filter.sort === 'name'
      ? 'l.name COLLATE NOCASE ' + direction
      : filter.sort === 'total'
        ? 'COALESCE(t.priced, 0) ' + direction
        : filter.sort === 'lines'
          ? 'COALESCE(t.total, 0) ' + direction
          : `l.status = 'active' DESC, l.updated_at ${direction}, l.created_at DESC`;

  const where = `WHERE ${conditions.join(' AND ')}${having.length ? ' AND ' + having.join(' AND ') : ''}`;

  const lists = db
    .prepare(
      `SELECT l.*,
              COALESCE(t.total, 0) AS totalItems,
              COALESCE(t.checked, 0) AS checkedItems,
              COALESCE(t.priced, 0) AS pricedTotalMinor,
              -- De quien es la lista: en el historial (y en la pestaña de la casa) la
              -- pregunta obvia es «esta la cerro alguien o la cerré yo», y se contesta con
              -- la cara, no con un nombre que ademas habria que traducir de un id.
              (SELECT u.name FROM users u WHERE u.id = l.user_id)   AS ownerName,
              (SELECT u.avatar FROM users u WHERE u.id = l.user_id) AS ownerAvatar
       FROM shopping_lists l ${totalsJoin} ${where}
       ORDER BY ${order}, l.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, ...havingParams, filter.limit, filter.offset) as any[];

  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM shopping_lists l ${totalsJoin} ${where}`)
    .get(...params, ...havingParams) as { count: number };

  return c.json({
    success: true,
    // `meta.total` es el total FILTRADO: la paginacion necesita saber cuantas paginas
    // hay, y decir «4» cuando se ven 4 de 30 es mentir en el contador.
    data: lists,
    meta: { total: count, limit: filter.limit, offset: filter.offset }
  });
});

/** Los supermercados que hay en los datos, para el filtro. Sin catalogo aparte. */
shoppingRoutes.get('/stores', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  // Las tiendas ya no son solo el DISTINCT de las listas (## 12aj): la tabla `stores` guarda las
  // que la lectura de un ticket registro para la casa, y tambien son vocabulario a la hora de
  // elegir donde comprar. Las que ya estan en alguna lista no se duplican.
  const rows = db
    .prepare(
      `SELECT store, SUM(lists) AS lists FROM (
         SELECT store, COUNT(*) AS lists FROM shopping_lists
         WHERE ${scope.clause} AND store IS NOT NULL AND TRIM(store) <> ''
         GROUP BY store
         UNION ALL
         SELECT s.name AS store, 0 AS lists FROM stores s
         WHERE ${scope.clause} AND TRIM(s.name) <> ''
           AND NOT EXISTS (
             SELECT 1 FROM shopping_lists l
             WHERE ${scope.clause} AND l.store = s.name
           )
       ) GROUP BY store ORDER BY lists DESC, store ASC`
    )
    .all(...scope.params, ...scope.params, ...scope.params) as { store: string; lists: number }[];
  return c.json({ success: true, data: rows });
});

shoppingRoutes.post('/lists', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);
  const body = createListSchema.parse(await c.req.json());

  const id = nanoid();
  db.prepare(
    `INSERT INTO shopping_lists (id, user_id, household_id, name, store) VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, scope.householdId, body.name, body.store ?? null);

  const list = readList(db, scope, id);
  announce(db, list, userId, 'list.create', null);
  return c.json({ success: true, data: { ...list, ...listTotals(db, id) } }, 201);
});

shoppingRoutes.get('/lists/:id', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const includeDeleted = c.req.query('includeDeleted') === '1';
  const items = db
    .prepare(
      `SELECT i.*,
              -- Los nombres van en la propia lectura: la fila de la lista dice «Quique lo
              -- cambio» sin una segunda peticion por linea, y sin eso el dato de autoria
              -- seria un id que nadie sabe leer. Y con el nombre su foto (o nada, y el
              -- avatar saca la inicial): «quien» se reconoce por la cara antes que por el
              -- texto, y en una fila de 44 px el nombre apenas cabe.
              (SELECT u.name FROM users u WHERE u.id = i.added_by)   AS added_by_name,
              (SELECT u.name FROM users u WHERE u.id = i.updated_by) AS updated_by_name,
              (SELECT u.avatar FROM users u WHERE u.id = i.added_by)   AS added_by_avatar,
              (SELECT u.avatar FROM users u WHERE u.id = i.updated_by) AS updated_by_avatar
       FROM shopping_list_items i
       WHERE i.list_id = ? ${includeDeleted ? '' : 'AND i.deleted_at IS NULL'}
       ORDER BY i.position ASC, i.created_at ASC`
    )
    .all(list.id) as any[];

  const discount = readDiscount(db, list.id);
  return c.json({
    success: true,
    data: {
      ...list,
      items,
      ...listTotals(db, list.id),
      discount,
      discountDescription: describeDiscount(discount)
    }
  });
});

shoppingRoutes.patch('/lists/:id', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const body = updateListSchema.parse(await c.req.json());
  if (body.version !== list.version) {
    // El otro extremo (409 sin tocar nada) es lo que permite a la app mostrar
    // «hay una version nueva, que quieres hacer?» en vez de ganar a ciegas.
    return c.json(
      { success: false, message: 'LIST_VERSION_CONFLICT', data: { currentVersion: list.version } },
      409
    );
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    params.push(body.name);
  }
  if (body.store !== undefined) {
    sets.push('store = ?');
    params.push(body.store);
  }
  if (body.status !== undefined) {
    sets.push('status = ?');
    params.push(body.status);
    // `completed_at` solo tiene sentido con el estado que lo justifica.
    sets.push(body.status === 'done' ? 'completed_at = CURRENT_TIMESTAMP' : 'completed_at = NULL');
  }

  sets.push('version = version + 1', 'updated_at = CURRENT_TIMESTAMP', 'updated_by = ?');
  params.push(c.get('userId'));
  db.prepare(`UPDATE shopping_lists SET ${sets.join(', ')} WHERE id = ?`).run(...params, list.id);

  const updated = readList(db, scope, list.id);
  // Reabrir una lista es el mismo PATCH con otro estado, y aqui se traduce a un
  // suceso distinto: en la auditoria «la termino» y «la volvio a abrir» no se leen igual.
  announce(
    db,
    updated,
    c.get('userId'),
    updated.status === 'done' && list.status !== 'done'
      ? 'list.complete'
      : list.status === 'done' && updated.status !== 'done'
        ? 'list.reopen'
        : 'list.update',
    updated.name
  );
  return c.json({ success: true, data: { ...updated, ...listTotals(db, list.id) } });
});

shoppingRoutes.delete('/lists/:id', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  // Borrado fisico: la lista es el contenedor, y su historial de precios vive
  // en price_observations, que sobrevive (ON DELETE no la toca).
  db.prepare('DELETE FROM shopping_lists WHERE id = ?').run(list.id);
  // El suceso no se guarda: la FK de la auditoria es `ON DELETE CASCADE`, y una
  // auditoria de una lista que ya no existe no tiene donde leerse. Lo que si hace
  // falta es que la bandeja de las demas personas se entere.
  announceToTray(
    db,
    { userId: c.get('userId'), householdId: list.household_id },
    'list.delete',
    list.id
  );
  return c.json({ success: true, data: { id: list.id } });
});

// ═══════════════════════════════════════════════════════════════════
// Items
// ═══════════════════════════════════════════════════════════════════

function nextPosition(db: ReturnType<typeof getDatabase>, listId: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(position), -1) AS last FROM shopping_list_items WHERE list_id = ?'
    )
    .get(listId) as { last: number };
  return row.last + 1;
}

function insertItem(
  db: ReturnType<typeof getDatabase>,
  listId: string,
  input: any,
  userId: string | null = null
) {
  const id = nanoid();
  const offer = normalizeOffer(input.offer);
  const discount = normalizeLineDiscount(input.discount);
  const key = productKeyOf(input.name);
  db.prepare(
    `INSERT INTO shopping_list_items
       (id, list_id, name, product_key, quantity, unit, category, price_minor, note, position,
        promo_buy, promo_take, added_by, updated_by,
        disc_kind, disc_value_minor, disc_percent_bps, disc_units)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    listId,
    input.name,
    key,
    input.quantity ?? 1,
    input.unit ?? null,
    input.category ?? null,
    input.priceMinor ?? input.price_minor ?? null,
    input.note ?? null,
    nextPosition(db, listId),
    offer?.buy ?? null,
    offer?.take ?? null,
    userId,
    userId,
    discount?.kind ?? null,
    discount?.valueMinor ?? null,
    discount?.percentBps ?? null,
    discount?.units ?? null
  );
  return id;
}

shoppingRoutes.post('/lists/:id/items', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const body = createItemSchema.parse(await c.req.json());
  const outcome = upsertLine(db, list, body, c.get('userId'));
  db.prepare(
    'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(list.id);
  announce(db, list, c.get('userId'), outcome.merged ? 'item.merge' : 'item.add', outcome.row.name);
  // `merged` en el cuerpo, como siempre: la UI tiene que poder distinguir «he creado
  // una fila» de «he sumado a la que habia» para no pintar dos avisos distintos.
  return c.json(
    { success: true, data: { ...outcome.row, merged: outcome.merged } },
    outcome.merged ? 200 : 201
  );
});

/**
 * «Anadir una linea» en un unico sitio: la regla de fusion (misma clave de producto y
 * misma unidad pendientes = la misma fila, se suma) la necesitan el alta normal, el
 * pegado y la aplicacion de una foto. Escrita tres veces, la proxima correccion se
 * aplicara a una y las otras dos seguiran duplicando la leche.
 */
function upsertLine(
  db: ReturnType<typeof getDatabase>,
  list: any,
  body: any,
  userId: string | null
): { row: any; merged: boolean } {
  // Misma linea pendiente (mismo producto y unidad) => se suma la cantidad.
  // Es lo que espera quien escribe «leche» dos veces: una fila, 2 unidades.
  const key = productKeyOf(body.name);
  const existing = db
    .prepare(
      `SELECT * FROM shopping_list_items
       WHERE list_id = ? AND product_key = ? AND deleted_at IS NULL AND COALESCE(unit, '') = COALESCE(?, '')`
    )
    .get(list.id, key, body.unit ?? null) as any;

  if (existing) {
    // Se suma la cantidad y, si la linea nueva traia oferta, se la lleva puesta:
    // quien escribe «6 Cervexas 3x2» sobre una fila de «3 Cervexas» habla de la misma
    // estanteria, y perder la oferta a mitad de camino pinta un precio mayor.
    const offer = normalizeOffer(body.offer);
    const incomingDiscount = normalizeLineDiscount(body.discount);
    // Como con la oferta: si la linea que llega trae descuento, se lo lleva puesta la fila
    // existente. Si no trae, no se toca — y van las cuatro columnas juntas, porque medio
    // descuento aplicado es peor que ninguno.
    const discountSet = incomingDiscount
      ? ', disc_kind = ?, disc_value_minor = ?, disc_percent_bps = ?, disc_units = ?'
      : '';
    db.prepare(
      `UPDATE shopping_list_items
         SET quantity = quantity + ?,
             promo_buy = COALESCE(?, promo_buy),
             promo_take = COALESCE(?, promo_take),
             -- El precio que traiga la linea nueva SI se aplica: fotografiar una
             -- estanteria para sacar el precio y que la fila vieja lo ignore es justo
             -- lo que la gente espera que haga la app. Borrar un precio no es esto, es
             -- un PATCH con priceMinor null.
             price_minor = COALESCE(?, price_minor),
             updated_at = CURRENT_TIMESTAMP,
             updated_by = ?${discountSet}
       WHERE id = ?`
    ).run(
      body.quantity ?? 1,
      offer?.buy ?? null,
      offer?.take ?? null,
      body.priceMinor ?? body.price_minor ?? null,
      userId,
      ...(incomingDiscount
        ? [
            incomingDiscount.kind,
            incomingDiscount.valueMinor,
            incomingDiscount.percentBps,
            incomingDiscount.units
          ]
        : []),
      existing.id
    );

    // Se relee la fila: responder con la copia leida ANTES del UPDATE devolvria la
    // cantidad vieja y la UI tendria que adivinar el resultado de su propio toque.
    return {
      row: db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(existing.id) as any,
      merged: true
    };
  }

  const id = insertItem(db, list.id, body, userId);
  return {
    row: db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(id) as any,
    merged: false
  };
}

/** Pegado de texto: una linea por producto, dedupeando contra lo que ya esta. */
shoppingRoutes.post('/lists/:id/items/bulk', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const body = bulkItemsSchema.parse(await c.req.json());
  const parsed = (
    body.items?.length
      ? body.items
      : body.lines
          .split(/\r?\n/)
          .map(parseItemLine)
          .filter((line): line is NonNullable<typeof line> => line !== null)
  ).slice(0, 200);

  const added: any[] = [];
  const merged: any[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const transaction = db.transaction(() => {
    for (const line of parsed) {
      const key = productKeyOf(line.name);
      if (!key) {
        skipped.push({ name: line.name, reason: 'EMPTY_AFTER_NORMALIZE' });
        continue;
      }
      const existing = db
        .prepare(
          `SELECT * FROM shopping_list_items
           WHERE list_id = ? AND product_key = ? AND deleted_at IS NULL AND COALESCE(unit, '') = COALESCE(?, '')`
        )
        .get(list.id, key, line.unit ?? null) as any;

      if (existing) {
        db.prepare(
          `UPDATE shopping_list_items
             SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?
           WHERE id = ?`
        ).run(line.quantity ?? 1, c.get('userId'), existing.id);
        merged.push(db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(existing.id));
        continue;
      }
      added.push(
        db
          .prepare('SELECT * FROM shopping_list_items WHERE id = ?')
          .get(insertItem(db, list.id, line, c.get('userId')))
      );
    }
    db.prepare(
      'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(list.id);
  });
  transaction();

  announce(
    db,
    list,
    c.get('userId'),
    'items.bulk',
    `${added.length + merged.length} líneas añadidas${skipped.length ? `, ${skipped.length} ignoradas` : ''}`
  );

  return c.json(
    {
      success: true,
      data: { added, merged, skipped, version: (readList(db, scope, list.id) as any).version }
    },
    added.length > 0 ? 201 : 200
  );
});

shoppingRoutes.patch('/lists/:id/items/:itemId', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const item = db
    .prepare('SELECT * FROM shopping_list_items WHERE id = ? AND list_id = ?')
    .get(c.req.param('itemId'), list.id) as any;
  if (!item) return notFound(c, 'Item');

  const body = updateItemSchema.parse(await c.req.json());
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const column of ['name', 'quantity', 'unit', 'category', 'note'] as const) {
    if ((body as any)[column] !== undefined) {
      sets.push(`${column} = ?`);
      params.push((body as any)[column]);
      if (column === 'name') {
        sets.push('product_key = ?');
        params.push(productKeyOf((body as any)[column]));
      }
    }
  }
  if (body.checked !== undefined) {
    sets.push('checked = ?');
    params.push(body.checked ? 1 : 0);
  }
  if (body.priceMinor !== undefined) {
    sets.push('price_minor = ?');
    params.push(body.priceMinor);
  }
  // Enlazar la linea con un producto conocido. `null` no es «no tocar»: es «vuelve a ser
  // la clave de tu nombre», que es lo que espera quien quita el enlace en la pantalla.
  if (body.productKey !== undefined) {
    const key = body.productKey?.trim() ?? '';
    if (key) {
      sets.push('product_key = ?');
      params.push(key.toLowerCase());
    } else {
      sets.push('product_key = ?');
      params.push(productKeyOf(body.name ?? item.name));
    }
  }
  // El descuento de la linea, con la misma regla que la oferta: `null` lo quita, `undefined`
  // no lo toca, y las cuatro columnas se escriben a la vez.
  if (body.discount !== undefined) {
    const next = normalizeLineDiscount(body.discount);
    sets.push('disc_kind = ?', 'disc_value_minor = ?', 'disc_percent_bps = ?', 'disc_units = ?');
    params.push(
      next?.kind ?? null,
      next?.valueMinor ?? null,
      next?.percentBps ?? null,
      next?.units ?? null
    );
  }
  // `offer: null` quita la oferta; `undefined` no la toca. Un `COALESCE` aqui no
  // serviria: haria «quitar» indistinguible de «no decir nada».
  if (body.offer !== undefined) {
    sets.push('promo_buy = ?');
    sets.push('promo_take = ?');
    params.push(normalizeOffer(body.offer)?.buy ?? null, normalizeOffer(body.offer)?.take ?? null);
  }

  // `updated_by` se escribe siempre, no solo cuando cambia el nombre: lo que interesa
  // en la auditoria es quien toco la linea por ultima vez.
  sets.push('updated_at = CURRENT_TIMESTAMP');
  sets.push('updated_by = ?');
  params.push(c.get('userId'));
  db.prepare(`UPDATE shopping_list_items SET ${sets.join(', ')} WHERE id = ?`).run(
    ...params,
    item.id
  );
  db.prepare(
    'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(list.id);

  const updated = db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(item.id) as any;
  // El suceso distingue marcar de editar porque la pantalla lo cuenta aparte: «Ana ha
  // marcado el pollo» y «Ana ha editado el pollo» no son la misma noticia.
  // Un toqueteo de descuento no reordena la bandeja de nadie, pero si merece su propio nombre
  // de evento: es lo que la pantalla escucha para refrescar el total de la cabecera.
  const discountOnly =
    body.checked === undefined &&
    body.discount !== undefined &&
    body.priceMinor === undefined &&
    body.productKey === undefined &&
    body.offer === undefined &&
    body.quantity === undefined &&
    body.unit === undefined &&
    body.name === undefined &&
    body.category === undefined &&
    body.note === undefined;
  announce(
    db,
    list,
    c.get('userId'),
    body.checked !== undefined
      ? updated.checked
        ? 'item.check'
        : 'item.uncheck'
      : discountOnly
        ? 'item.discount'
        : 'item.update',
    updated.name
  );
  return c.json({ success: true, data: updated });
});

/** Borrado logico: el «Deshacer» de la UI de movil tiene que poder cumplirse. */
shoppingRoutes.delete('/lists/:id/items/:itemId', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  // El nombre se lee ANTES de borrar: es lo que va a decir la auditoria, y despues
  // de marcar `deleted_at` ya no se sabe cual de las dos lineas del carrito era.
  const before = db
    .prepare(
      'SELECT name FROM shopping_list_items WHERE id = ? AND list_id = ? AND deleted_at IS NULL'
    )
    .get(c.req.param('itemId'), list.id) as { name: string } | undefined;

  const result = db
    .prepare(
      `UPDATE shopping_list_items
         SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, updated_by = ?
       WHERE id = ? AND list_id = ? AND deleted_at IS NULL`
    )
    .run(c.get('userId'), c.req.param('itemId'), list.id);

  if (result.changes === 0) return notFound(c, 'Item');
  db.prepare(
    'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(list.id);

  announce(db, list, c.get('userId'), 'item.remove', before?.name ?? null);
  return c.json({
    success: true,
    data: { id: c.req.param('itemId'), deletedAt: new Date().toISOString() }
  });
});

shoppingRoutes.post('/lists/:id/items/:itemId/restore', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const result = db
    .prepare(
      `UPDATE shopping_list_items SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND list_id = ?`
    )
    .run(c.req.param('itemId'), list.id);
  if (result.changes === 0) return notFound(c, 'Item');

  const item = db
    .prepare('SELECT * FROM shopping_list_items WHERE id = ?')
    .get(c.req.param('itemId')) as any;
  announce(db, list, c.get('userId'), 'item.restore', item.name);
  return c.json({ success: true, data: item });
});

/**
 * El descuento de la lista. Un `PUT`, no un `POST`: como mucho hay uno, y una
 * pantalla que guarda sola necesita que «guardar» y «guardar por primera vez» sean
 * la misma operacion. Borrarlo es `DELETE`, no `PUT {kind: null}` — el estado
 * «sin descuento» tiene que ser la ausencia de fila.
 */
shoppingRoutes.put('/lists/:id/discount', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const body = discountSchema.parse(await c.req.json());
  const scoped = body.scope === 'product' || body.scope === 'category';
  // Las dianas se guardan como las escribe la pantalla (nombres legibles) y deduplicadas:
  // el motor compara por clave normalizada, y lo que se ensena tiene que ser lo que alguien
  // reconozca en el pasillo. `target` se deja intacto para las filas que ya existian.
  const targets = scoped
    ? JSON.stringify([
        ...new Set((body.targets ?? []).map((value) => value.trim()).filter(Boolean))
      ])
    : null;

  db.prepare(
    `INSERT INTO shopping_list_discounts
       (list_id, kind, value_minor, percent_bps, scope, first_units, target, targets, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(list_id) DO UPDATE SET
       kind = excluded.kind,
       value_minor = excluded.value_minor,
       percent_bps = excluded.percent_bps,
       scope = excluded.scope,
       first_units = excluded.first_units,
       -- El target se PONE o se QUITA segun el alcance: dejar el antiguo al pasar de
       -- «en jamon» a «toda la cesta» haria que el descuento siguiera persiguiendo al
       -- jamon mientras la pantalla dice «toda la cesta».
       target = excluded.target,
       targets = excluded.targets,
       label = excluded.label,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    list.id,
    body.kind,
    body.kind === 'amount' ? (body.valueMinor ?? 0) : null,
    body.kind === 'percent' ? (body.percentBps ?? 0) : null,
    body.scope,
    body.scope === 'firstUnits' ? (body.firstUnits ?? null) : null,
    scoped ? body.target?.trim() || null : null,
    // `[]` serializado es una lista vacia, que el motor lee como «sin dianas»: para que
    // el estado «sin lista de dianas» sea la ausencia de dato, se guarda null.
    targets === '[]' ? null : targets,
    body.label ?? null
  );

  const discount = readDiscount(db, list.id);
  announce(db, list, c.get('userId'), 'list.discount', describeDiscount(discount));
  return c.json({ success: true, data: { ...discount, description: describeDiscount(discount) } });
});

shoppingRoutes.delete('/lists/:id/discount', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  db.prepare('DELETE FROM shopping_list_discounts WHERE list_id = ?').run(list.id);
  announce(db, list, c.get('userId'), 'list.discount-remove', null);
  return c.json({ success: true, data: { removed: true } });
});

/** Lo comprado se va de la lista (y su precio queda anotado, ver `complete`). */
shoppingRoutes.post('/lists/:id/clear-checked', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const removed = db
    .prepare(
      'UPDATE shopping_list_items SET deleted_at = CURRENT_TIMESTAMP WHERE list_id = ? AND checked = 1 AND deleted_at IS NULL'
    )
    .run(list.id);
  db.prepare(
    'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(list.id);

  announce(db, list, c.get('userId'), 'list.clear-checked', `${removed.changes} lineas`);
  return c.json({ success: true, data: { removed: removed.changes } });
});

/** Orden explicito (arrastrar para reordenar). Se manda el orden completo. */
shoppingRoutes.put('/lists/:id/order', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const body = orderSchema.parse(await c.req.json());
  if (body.version !== list.version) {
    return c.json(
      { success: false, message: 'LIST_VERSION_CONFLICT', data: { currentVersion: list.version } },
      409
    );
  }

  const pending = new Set(
    (
      db
        .prepare('SELECT id FROM shopping_list_items WHERE list_id = ? AND deleted_at IS NULL')
        .all(list.id) as any[]
    ).map((row) => row.id)
  );
  const unknown = body.itemIds.filter((id) => !pending.has(id));
  if (unknown.length > 0) {
    return c.json({ success: false, message: 'ITEMS_NOT_IN_LIST', data: { unknown } }, 400);
  }

  const update = db.prepare(
    'UPDATE shopping_list_items SET position = ? WHERE id = ? AND list_id = ?'
  );
  db.transaction(() => {
    body.itemIds.forEach((id, index) => update.run(index, id, list.id));
    db.prepare(
      'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(list.id);
  })();

  return c.json({ success: true, data: { ordered: body.itemIds.length } });
});

/**
 * Estimacion. Unidades, que es donde se equivocan las apps de dinero:
 *   - `shopping_list_items.price_minor` es PRECIO POR UNIDAD (lo que la gente
 *     recuerda: «la leche a 0,85»).
 *   - `price_observations.price_minor` es lo PAGADO por `quantity` unidades (lo
 *     que dice un ticket). De ahi que al estimar se divida y al aprender se
 *     multiplique, y que las dos tablas no puedan usarse indistintamente.
 * Se devuelve el porque de cada linea para que la UI pueda decir «sin precio»
 * sin adivinar.
 */
shoppingRoutes.get('/lists/:id/estimate', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const items = db
    .prepare(
      'SELECT * FROM shopping_list_items WHERE list_id = ? AND deleted_at IS NULL ORDER BY position ASC, created_at ASC'
    )
    .all(list.id) as any[];

  const observationSql = `SELECT price_minor, quantity, store_name, observed_at FROM price_observations
     WHERE product_key = ? AND (user_id = ? OR (household_id IS NOT NULL AND household_id = ?))`;
  // Primero el precio DE LA TIENDA de la lista, y solo si alli no hay dato, el ultimo de
  // cualquier otra. «El ultimo precio» a secas era un bug con muy buena pinta: ponía la
  // leche de Mercadona al precio de Lidl, y con dos tiendas en la casa el numero de la
  // pantalla ya no significaba nada.
  const observationAny = db.prepare(
    `${observationSql} ORDER BY observed_at DESC, rowid DESC LIMIT 1`
  );
  const observationAtStore = db.prepare(
    `${observationSql} AND store_name = ? ORDER BY observed_at DESC, rowid DESC LIMIT 1`
  );
  const listStore = String(list.store ?? '').trim();

  let totalMinor = 0;
  const priced: {
    item: any;
    unitMinor: number | null;
    source: 'manual' | 'observed' | 'unpriced';
    store: string | null;
    observedAt: string | null;
    otherStore?: boolean;
  }[] = [];

  for (const item of items) {
    if (item.price_minor != null) {
      priced.push({
        item,
        unitMinor: item.price_minor,
        source: 'manual',
        store: null,
        observedAt: null
      });
      continue;
    }
    // La clave de la linea manda: es el enlace a «el producto que la casa ya conoce», que
    // existe porque el carrito dice «Leche semi» y el ticket decia «Leche semidesnatada».
    const key = String(item.product_key || productKeyOf(item.name));
    const found = (
      listStore
        ? (observationAtStore.get(key, c.get('userId'), list.household_id, listStore) ??
          (() => {
            const fallback = observationAny.get(key, c.get('userId'), list.household_id) as
              | {
                  price_minor: number;
                  quantity: number;
                  store_name: string | null;
                  observed_at: string;
                }
              | undefined;
            return fallback ? { ...fallback, __otherStore: true } : undefined;
          })())
        : observationAny.get(key, c.get('userId'), list.household_id)
    ) as
      | {
          price_minor: number;
          quantity: number;
          store_name: string | null;
          observed_at: string;
          __otherStore?: boolean;
        }
      | undefined;
    if (!found) {
      priced.push({ item, unitMinor: null, source: 'unpriced', store: null, observedAt: null });
      continue;
    }
    // La observacion guarda lo pagado por N unidades; la unidad sale de ahi, no de un
    // precio que nadie anoto. Se redondea una vez, aqui.
    priced.push({
      item,
      unitMinor: roundMinor(found.price_minor / (found.quantity || 1)),
      source: 'observed',
      store: found.store_name,
      observedAt: found.observed_at,
      otherStore: Boolean(found.__otherStore)
    });
  }
  void totalMinor;

  const discount = readDiscount(db, list.id);
  const money = basketMoney({
    lines: priced.map((entry) => ({
      itemId: entry.item.id,
      quantity: entry.item.quantity ?? 1,
      unitMinor: entry.unitMinor,
      offer: offerOf(entry.item),
      productKey: entry.item.product_key ?? null,
      category: entry.item.category ?? null,
      discount: lineDiscountOf(entry.item)
    })),
    discount
  });
  const byId = new Map(money.lines.map((line) => [line.itemId, line]));

  const lines = priced.map((entry) => {
    const line = byId.get(entry.item.id);
    const offer = offerOf(entry.item);
    const base: any = {
      itemId: entry.item.id,
      name: entry.item.name,
      units: entry.item.quantity ?? 1,
      paidUnits: line?.paidUnits ?? entry.item.quantity ?? 1,
      ...(offer ? { offer } : {})
    };
    if (entry.source === 'unpriced')
      return { ...base, source: 'unpriced' as const, lineTotalMinor: null };
    return {
      ...base,
      source: entry.source,
      unitMinor: entry.unitMinor,
      // `lineTotalMinor` sigue siendo lo que cuesta la linea (despues de su oferta y
      // antes del descuento de la lista): es el numero que alguien contrasta con el
      // ticket. El descuento de la lista se ve aparte, porque no es de esta linea.
      lineTotalMinor: line?.grossMinor ?? 0,
      netMinor: line?.netMinor ?? 0,
      offerSavingsMinor: line?.offerSavingsMinor ?? 0,
      // Cuanto baja el descuento propio de la linea y con que frase se lo cuenta: la pantalla
      // no vuelve a calcular nada, y «-15 %» a secas no aclara si era sobre dos unidades.
      lineDiscountMinor: line?.lineDiscountMinor ?? 0,
      ...(line?.lineDiscount && line.lineDiscount.minor > 0
        ? {
            lineDiscountReason: line.lineDiscount.reason,
            lineDiscountDescription: describeLineDiscount(lineDiscountOf(entry.item))
          }
        : {}),
      ...(entry.store ? { store: entry.store, observedAt: entry.observedAt } : {}),
      // La pantalla lo necesita para poder decir «ojo, ese precio es de Lidl»: un numero
      // sin procedencia se discute, uno con procedencia se acepta o se corrige.
      ...(entry.otherStore ? { otherStore: true } : {})
    };
  });

  return c.json({
    success: true,
    data: {
      listId: list.id,
      currency: 'EUR',
      totalMinor: money.totalMinor,
      subtotalMinor: money.subtotalMinor,
      offerSavingsMinor: money.offerSavingsMinor,
      discountMinor: money.discountMinor,
      lineDiscountMinor: money.lineDiscountMinor,
      discount: discount
        ? { ...discount, description: describeDiscount(discount), ...money.discount }
        : null,
      pricedLines: lines.filter((line) => line.lineTotalMinor !== null).length,
      unpriced: lines.filter((line) => line.source === 'unpriced').map((line) => line.name),
      lines
    }
  });
});

/**
 * Cerrar la compra: archivar y aprender los precios de lo que se pago.
 *
 * Dos reglas que no estaban y que son las que hacen que la funcion valga algo:
 * - **Solo se cierra lo que se puede anotar.** Toda linea comprada necesita un precio.
 *   Cerrar la lista con huecos era la forma mas eficiente de envenenar el historico: la
 *   proxima cesta estimaria «sin dato» justo en los productos que alguien ya habia pagado.
 *   El 409 nombra las lineas que faltan, y la pantalla las abre en una hoja donde se
 *   escriben ahi mismo, en el mismo sitio donde se ha pagado.
 * - **Un precio es de una tienda.** Se anota con el establecimiento y con el nombre que
 *   alli usaban («Barra de pan cristal» no es «Pan», y los dos son el mismo producto).
 *   Sin tienda, el numero no tiene a donde volver.
 */
shoppingRoutes.post('/lists/:id/complete', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const raw = await c.req.json().catch(() => ({}));
  const body = completeListSchema.parse(raw ?? {});

  const userId = c.get('userId');
  const items = db
    .prepare('SELECT * FROM shopping_list_items WHERE list_id = ? AND deleted_at IS NULL')
    .all(list.id) as any[];
  const byId = new Map(items.map((item) => [item.id, item]));
  const listStore = String(list.store ?? '').trim();
  const bodyStore = String(body.store ?? '').trim();

  // Un id que no es de esta lista no se ignora «porque no toca»: es otra persona
  // escribiendo en la lista de al lado, y eso se dice (mismo codigo que el reorden).
  const requested = body.prices ?? [];
  const unknown = [...new Set(requested.map((entry) => entry.itemId))].filter(
    (id) => !byId.has(id)
  );
  if (unknown.length) {
    return c.json({ success: false, message: 'ITEMS_NOT_IN_LIST', data: { unknown } }, 400);
  }

  type Typed = {
    item: any;
    unitMinor: number;
    unitsPaid: number;
    paidMinor: number;
    store: string;
    productName: string;
  };
  const typed: Typed[] = [];
  for (const entry of requested) {
    const item = byId.get(entry.itemId);
    if (!item) continue;
    const carried = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
    const unitsPaid = entry.quantity ?? (paidUnits(carried, offerOf(item)) || carried);
    // El ticket dice lo pagado; la linea guarda precio por unidad. Se convierte una vez,
    // aqui, y el redondeo se queda en la linea: la observacion conserva el total exacto.
    const unitMinor =
      entry.totalPaidMinor != null
        ? roundMinor(entry.totalPaidMinor / unitsPaid)
        : roundMinor(entry.priceMinor ?? 0);
    const paidMinor =
      entry.totalPaidMinor != null ? entry.totalPaidMinor : roundMinor(unitMinor * unitsPaid);
    const store = String(entry.store ?? '').trim() || listStore || bodyStore;
    const productName = String(entry.productName ?? '').trim() || item.name;
    typed.push({ item, unitMinor, unitsPaid, paidMinor, store, productName });
  }

  // Lo que se aprende es de las lineas COMPRADAS; una linea anotada pero no llevada no es
  // un dato de mercado, es una intencion.
  const bought = items.filter((item) => item.checked === 1);
  const unitOf = new Map(
    typed.filter((entry) => entry.item.checked === 1).map((entry) => [entry.item.id, entry])
  );

  const missing = bought
    .filter((item) => item.price_minor == null && !unitOf.has(item.id))
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit ?? null
    }));
  if (missing.length) {
    return c.json(
      {
        success: false,
        message: 'PRICES_MISSING',
        data: {
          missing,
          missingCount: missing.length,
          boughtCount: bought.length,
          hint: 'Escribe cuanto has pagado por cada linea antes de dar la compra por terminada.'
        }
      },
      409
    );
  }

  // Solo hace falta saber donde se ha comprado si hay algo nuevo que anotar: cerrar una
  // lista cuyos precios ya estaban escritos no puede exigir una tienda que nadie cambio.
  const needsStore = typed.some((entry) => entry.item.checked === 1);
  if (needsStore && !listStore && !bodyStore && typed.some((entry) => !entry.store)) {
    return c.json(
      {
        success: false,
        message: 'STORE_REQUIRED',
        data: {
          hint: 'El precio se guarda por establecimiento: di en cual has comprado (cabecera de la lista) para poder usarlo la proxima vez.'
        }
      },
      409
    );
  }

  const insertObservation = db.prepare(
    `INSERT INTO price_observations
       (id, user_id, household_id, product_key, product_name, store_name, price_minor, quantity, source, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', CURRENT_TIMESTAMP)`
  );
  const updatePrice = db.prepare(
    'UPDATE shopping_list_items SET price_minor = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?'
  );

  let recorded = 0;
  let paidMinor = 0;
  // Lo que el cierre volco en la despensa: fichas nuevas o repuestas (moved) y sumas sobre fichas con
  // stock (merged). Lo lee la respuesta y lo pinta el recibo del toast.
  let pantryMoved = 0;
  let pantryMerged = 0;
  const productosParaBuscarImagen = new Set<string>();
  db.transaction(() => {
    // Lo escrito en esta llamada acaba primero en la linea: si el cierre se rechaza por
    // cualquier otra comprobacion no habremos llegado aqui, y si se acepta, la lista
    // cerrada y el historico tienen que decir lo mismo.
    // Lo tecleado en el cierre ES lo que se pago en caja, descuento incluido: por eso aqui el
    // descuento de la linea NO se vuelve a restar. Solo se resta en las lineas que se estiman
    // con el precio del estante, que es el unico caso en que el numero no sale del ticket.
    for (const entry of typed) {
      updatePrice.run(entry.unitMinor, userId, entry.item.id);
      if (entry.item.checked !== 1) continue;
      // La clave es la de la linea (que puede estar enlazada a otro producto), no la del
      // nombre: si no, «Barra de pan cristal» aprenderia un producto nuevo cada vez.
      insertObservation.run(
        nanoid(),
        userId,
        list.household_id,
        String(entry.item.product_key || productKeyOf(entry.item.name)),
        entry.productName,
        entry.store || null,
        entry.paidMinor,
        entry.unitsPaid
      );
      recorded += 1;
      paidMinor += entry.paidMinor;
    }
    for (const item of bought) {
      if (unitOf.has(item.id) || item.price_minor == null) continue;
      // Precio que ya estaba en la linea: se aprende igual, con la tienda de la lista.
      const unitsPaid = paidUnits(item.quantity ?? 1, offerOf(item)) || item.quantity || 1;
      const shelfMinor = roundMinor(item.price_minor * unitsPaid);
      // Y aqui se separan los dos numeros, que no son el mismo: en el historico va el precio
      // DEL ESTANTE (manana el estante seguira costando lo mismo), y en lo pagado va el
      // descuento de la linea, que es lo que salio de la cartera. Aprender el precio rebajado
      // haria que la proxima semana la app estime 0,75 € un producto de 1,00 €.
      const lineOff =
        applyLineDiscount(unitsPaid, item.price_minor, lineDiscountOf(item))?.minor ?? 0;
      insertObservation.run(
        nanoid(),
        userId,
        list.household_id,
        String(item.product_key || productKeyOf(item.name)),
        item.name,
        listStore || null,
        shelfMinor,
        unitsPaid
      );
      recorded += 1;
      paidMinor += Math.max(0, shelfMinor - lineOff);
    }
    db.prepare(
      `UPDATE shopping_lists SET status = 'done', completed_at = CURRENT_TIMESTAMP,
         store = COALESCE(?, store), version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(bodyStore || null, list.id);

    // ——— El carro pasa a la nevera (## 12ag) ———.
    // Lo comprado en caja no puede evaporarse de la app al archivar la lista: cada linea COMPRADA aterriza
    // en la despensa. La regla de duplicados es la del propio inventario —misma `productKeyOf`, la misma
    // consulta que `buscarPorClave` del gestor—: si la casa ya tiene la ficha con stock, la compra le SUMA
    // unidades (dos cartones comprados sobre un cartón en casa = dos, no dos fichas); si la ficha existe a
    // cero —conocida pero agotada—, se repone; si no existe, se crea bajo «Otros». Lo pendiente se queda
    // fuera a proposito: la despensa no registra intenciones, registra lo que hay.
    const casa = { userId, householdId: getScope(userId).householdId ?? null };
    ensurePantryCategories(db, casa.userId, casa.householdId);
    // `ingredients.category` es NOT NULL y «other» es la reserva que el ensure de arriba garantiza: la linea
    // de la compra no trae categoria de despensa que ofrecer —su `category` es la SECCION del carrito, otro
    // eje—, asi que cae en la reserva igual que un producto del catalogo sin hoja reconocida.
    const categoria = PROTECTED_PANTRY_KEY;
    const buscaFicha = db.prepare(
      `SELECT id, name, quantity FROM ingredients
       WHERE (user_id = ? OR household_id = ?) AND lower(trim(name)) = lower(trim(?))`
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
    for (const item of bought) {
      const qty =
        Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
          ? Number(item.quantity)
          : 1;
      const candidatos = buscaFicha.all(casa.userId, casa.householdId, item.name) as {
        id: string;
        name: string;
        quantity: number;
      }[];
      const clave = productKeyOf(item.name);
      const ficha = candidatos.find((fila) => productKeyOf(fila.name) === clave) ?? null;
      if (ficha) {
        if (Number(ficha.quantity) > 0) {
          sumaStock.run(qty, ficha.id);
          pantryMerged += 1;
        } else {
          reponeStock.run(qty, ficha.id);
          pantryMoved += 1;
        }
        productosParaBuscarImagen.add(ficha.id);
        continue;
      }
      const ingredientId = nanoid();
      meteFicha.run(
        ingredientId,
        userId,
        casa.householdId,
        item.name,
        categoria,
        qty,
        item.unit ?? 'unit'
      );
      productosParaBuscarImagen.add(ingredientId);
      pantryMoved += 1;
    }
  })();

  for (const ingredientId of productosParaBuscarImagen) {
    try {
      queueProductImageSearch(db, userId, ingredientId);
    } catch {
      // La búsqueda de imagen es auxiliar; la compra ya quedó registrada.
    }
  }

  announce(db, list, userId, 'list.complete', `${recorded} precios`);
  return c.json({
    success: true,
    data: {
      pricesRecorded: recorded,
      items: bought.length,
      paidMinor,
      store: listStore || bodyStore || null,
      pantryMoved,
      pantryMerged
    }
  });
});

/**
 * Un codigo de error del cliente de IA no es un 500: son cuatro situaciones
 * distintas, y quien esta delante de la pantalla tiene que poder hacer algo con cada
 * una (configurar la IA, reintentar, acortar la foto, o aceptar que el modelo no ha
 * entendido nada y escribir la linea a mano).
 */
function aiError(c: any, error: unknown, muestraSegura?: string) {
  const code = error instanceof AiCallError ? error.code : 'PROVIDER';
  const detail =
    error instanceof AiCallError ? (error.detail ?? null) : 'AI provider request failed';
  if (code === 'NO_CONFIG') {
    return c.json(
      { success: false, message: 'AI_NOT_CONFIGURED', data: { redirect: '/ai-config' } },
      409
    );
  }
  if (code === 'BAD_JSON') {
    return c.json(
      {
        success: false,
        message: 'AI_ANSWER_NOT_UNDERSTOOD',
        data: { sample: muestraSegura ?? detail }
      },
      422
    );
  }
  return c.json(
    {
      success: false,
      message: code === 'TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
      data: { detail }
    },
    502
  );
}

/**
 * Leer una foto y proponer lineas. Escribe CERO: devuelve lo que el modelo ha
 * entendido, validado con `photoLinesSchema`, para que la persona lo revise. Es la
 * razon de ser de dos llamadas en vez de una — un modelo que se inventa una marca no
 * tiene que poder reescribir la cesta de la casa.
 */
shoppingRoutes.post('/lists/:id/photo/analyze', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const parsed = photoAnalyzeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: 'INVALID_PHOTO',
        data: { issues: parsed.error.issues.slice(0, 4) }
      },
      400
    );
  }
  // Seis megas de base64 son unos cuatro de imagen: por encima, la foto tarda, la
  // conexion del movil se cae y nadie sabe si la app ha hecho algo.
  if (parsed.data.image.length > 6_000_000) {
    return c.json({ success: false, message: 'IMAGE_TOO_LARGE' }, 413);
  }

  ensureDefaultCategories(db, userId, scope.householdId);
  const categories = listCategories(db, scope.clause, scope.params);
  const { system, user } = buildPhotoPrompt({
    categoriesJson: catalogueForPrompt(categories),
    mode: parsed.data.mode,
    note: parsed.data.note ?? null,
    language: c.get('appLanguage')
  });

  let answer: string;
  try {
    answer = await callAI(
      userId,
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: parsed.data.image, detail: 'high' } }
          ]
        }
      ],
      db,
      SHOPPING_PHOTO_RESPONSE_FORMAT,
      'shopping_photo'
    );
  } catch (error) {
    return aiError(c, error);
  }

  let raw: unknown;
  try {
    raw = extractJsonObject(answer);
  } catch (error) {
    // `callAI` devuelve la respuesta tras sanear la credencial configurada.
    return aiError(c, error, answer.slice(0, 200));
  }

  const validated = photoLinesSchema.safeParse(raw);
  if (!validated.success) {
    // 422, no 400: la foto estaba bien; lo que no cuadra es la respuesta del modelo.
    // El `sample` va para el visor de logs, que es donde esto se diagnostica.
    return c.json(
      {
        success: false,
        message: 'AI_ANSWER_NOT_UNDERSTOOD',
        data: { issues: validated.error.issues.slice(0, 5), sample: String(answer).slice(0, 200) }
      },
      422
    );
  }

  return c.json({
    success: true,
    data: {
      listId: list.id,
      mode: parsed.data.mode,
      currency: validated.data.currency ?? 'EUR',
      warnings: validated.data.warnings ?? [],
      lines: validated.data.lines.map((line) => ({ ...line, offer: normalizeOffer(line.offer) })),
      // El catalogo va en la respuesta: la hoja de repaso pinta los colores, y no
      // tiene por que pedirlo otra vez para saber que «Frutas y verduras» es verde.
      categories: categories.map(({ name, color }) => ({ name, color }))
    }
  });
});

/**
 * Lo que la persona confirmo, escrito de verdad. Reutiliza la regla de fusion del
 * alta normal (misma clave y misma unidad = la misma fila), que es lo que hace que una
 * foto de la estanteria no duplique la leche que ya estaba pendiente.
 */
shoppingRoutes.post('/lists/:id/items/apply', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const body = applyLinesSchema.parse(await c.req.json());
  const added: any[] = [];
  const merged: any[] = [];
  const createdCategories: string[] = [];

  db.transaction(() => {
    for (const line of body.lines) {
      if (line.category && line.createCategory) {
        const result = upsertCategory(db, {
          userId,
          householdId: scope.householdId,
          name: line.category,
          color: null,
          idFactory: () => nanoid()
        });
        if (result.created) createdCategories.push(result.category.name);
      }

      const outcome = upsertLine(db, list, line, userId);
      (outcome.merged ? merged : added).push(outcome.row);
    }
    db.prepare(
      'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP, updated_by = ? WHERE id = ?'
    ).run(userId, list.id);
  })();

  announce(
    db,
    list,
    userId,
    'items.apply',
    `${added.length + merged.length} lineas${createdCategories.length ? `, ${createdCategories.length} secciones nuevas` : ''}`
  );

  return c.json({
    success: true,
    data: {
      added,
      merged,
      createdCategories,
      version: (readList(db, scope, list.id) as any).version
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Precios
// ═══════════════════════════════════════════════════════════════════

shoppingRoutes.get('/prices', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const filter = priceFilterSchema.parse(c.req.query());

  // `price_observations` usa `household_id`/`user_id` (no `household_id`NULL-safe
  // como los items), asi que la clausula de alcance se reescribe con prefijo.
  const conditions = [scope.clause.replace(/(user_id|household_id)/g, 'p.$1')];
  const params: unknown[] = [...scope.params];
  if (filter.q) {
    conditions.push('(p.product_name LIKE ? OR p.store_name LIKE ?)');
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.store) {
    conditions.push('p.store_name = ?');
    params.push(filter.store);
  }
  if (filter.productKey) {
    conditions.push('p.product_key = ?');
    params.push(filter.productKey.toLowerCase());
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(o.id) AS observations
       FROM price_observations p
       LEFT JOIN price_observations o ON o.product_key = p.product_key AND o.observed_at >= datetime(p.observed_at, '-180 days')
       ${where}
       GROUP BY p.id
       ORDER BY p.observed_at DESC, p.rowid DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, filter.limit, filter.offset) as any[];

  return c.json({
    success: true,
    data: rows,
    meta: { limit: filter.limit, offset: filter.offset }
  });
});

/**
 * Los productos que la casa ya conoce, agrupados por clave. Dos cosas se resuelven aqui:
 * enlazar una linea con el producto que ya tiene historial («Leche semi» = «Leche
 * semidesnatada»), y ver cuanto cuesta lo mismo en cada tienda. Se agrupa en JS y no con
 * `GROUP_CONCAT` porque lo que se quiere devolver es la lista de variantes por tienda, con
 * su precio por unidad, y un `GROUP_CONCAT` obligaria a la UI a volver a parsear un string.
 */
shoppingRoutes.get('/prices/products', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const filter = productIndexSchema.parse(c.req.query());

  const conditions = [scope.clause.replace(/(user_id|household_id)/g, 'p.$1')];
  const params: unknown[] = [...scope.params];
  if (filter.q) {
    conditions.push('(p.product_key LIKE ? OR p.product_name LIKE ? OR p.store_name LIKE ?)');
    params.push(`%${filter.q.toLowerCase()}%`, `%${filter.q}%`, `%${filter.q}%`);
  }

  const rows = db
    .prepare(
      `SELECT p.product_key, p.product_name, p.store_name, p.price_minor, p.quantity, p.observed_at
       FROM price_observations p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.observed_at DESC
       LIMIT ?`
    )
    .all(...params, filter.limit) as any[];

  const byKey = new Map<
    string,
    {
      productKey: string;
      name: string;
      lastObservedAt: string;
      observations: number;
      variants: any[];
    }
  >();
  for (const row of rows) {
    const unitMinor = roundMinor(Number(row.price_minor) / (Number(row.quantity) || 1));
    const entry = byKey.get(row.product_key) ?? {
      productKey: row.product_key,
      name: row.product_name,
      lastObservedAt: row.observed_at,
      observations: 0,
      variants: [] as {
        store: string | null;
        productName: string;
        unitMinor: number;
        observedAt: string;
      }[]
    };
    entry.observations += 1;
    // Una variante por tienda: la ultima vez que se comprando alli es el dato que interesa
    // («aqui cuesta 0,85»), y las anteriores se quedan en /prices para quien las quiera.
    const storeName = String(row.store_name ?? '').trim();
    const seen = entry.variants.find((variant) => variant.store === storeName);
    if (!seen) {
      entry.variants.push({
        store: storeName || null,
        productName: row.product_name,
        unitMinor,
        observedAt: row.observed_at
      });
    }
    byKey.set(row.product_key, entry);
  }

  const data = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return c.json({ success: true, data, meta: { limit: filter.limit } });
});

shoppingRoutes.post('/prices', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);
  const body = createPriceSchema.parse(await c.req.json());

  const id = nanoid();
  db.prepare(
    `INSERT INTO price_observations
       (id, user_id, household_id, product_key, product_name, store_name, price_minor, quantity, source, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', CURRENT_TIMESTAMP)`
  ).run(
    id,
    userId,
    scope.householdId,
    productKeyOf(body.productName),
    body.productName,
    body.store ?? null,
    body.priceMinor,
    body.quantity ?? 1
  );

  return c.json(
    { success: true, data: db.prepare('SELECT * FROM price_observations WHERE id = ?').get(id) },
    201
  );
});

shoppingRoutes.delete('/prices/:id', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  // Se comparte la lectura (el hogar ve los precios de todos) pero no la
  // propiedad: un borrado es destructivo y no hay «Deshacer» para una
  // observacion. Dejar que cualquier miembro borre la fila de otra persona es
  // una forma facil de perder el historial de precios por un desliz.
  const result = db
    .prepare('DELETE FROM price_observations WHERE id = ? AND user_id = ?')
    .run(c.req.param('id'), userId);
  if (result.changes === 0) return notFound(c, 'Price');
  return c.json({ success: true, data: { id: c.req.param('id') } });
});

// ═══════════════════════════════════════════════════════════════════
// Auditoria y en-vivo (§8f)
// ═══════════════════════════════════════════════════════════════════

shoppingRoutes.get('/lists/:id/events', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('id'));
  if (!list) return notFound(c, 'List');

  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  const rows = readEvents(db, { listId: list.id, limit });
  return c.json({
    success: true,
    data: rows.map((row) => ({ ...row, description: describeEvent(row) }))
  });
});

const HEARTBEAT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // El reloj no puede mantener vivo el proceso: en un Raspberry Pi el server se
    // para y se queda esperando a un timer de un navegador ya cerrado.
    (timer as any).unref?.();
  });
}

/**
 * Un solo mecanismo para los dos canales. Se escribe aqui y no en el frontend porque
 * el unico que sabe si una conexion sigue viva es el server: el navegador puede estar
 * en el pasillo, con la pantalla apagada y el socket ya roto.
 *
 * El cliente recibe `change` y VUELVE A LEER; nunca pinta lo que trae el evento. El
 * payload es una pista de refresco, no la verdad — si se perdiera un evento, la
 * pantalla se corrige con el siguiente toque en vez de quedarse con un dato inventado.
 */
async function pumpStream(stream: any, channels: string[], listId: string | null): Promise<void> {
  const queue: LiveEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;

  const offs = channels.map((channel) =>
    subscribe(channel, (event) => {
      if (listId && event.listId && event.listId !== listId) return;
      queue.push(event);
      wake?.();
    })
  );
  stream.onAbort(() => {
    closed = true;
    wake?.();
  });

  try {
    await stream.writeSSE({
      event: 'ready',
      data: JSON.stringify({ at: new Date().toISOString(), channels })
    });
    while (!closed) {
      const event = queue.shift();
      if (event) {
        await stream.writeSSE({ event: 'change', data: JSON.stringify(event) });
        continue;
      }
      await Promise.race([
        new Promise<void>((resolve) => {
          wake = () => {
            wake = null;
            resolve();
          };
        }),
        sleep(HEARTBEAT_MS)
      ]);
      if (closed) break;
      // Corazon: un proxy del enjambre corta una conexion silenciosa, y el usuario
      // no tiene forma de saber que su lista dejo de estar en vivo.
      await stream.writeSSE({ event: 'ping', data: '{}' });
    }
  } catch {
    // El otro extremo cerro la pestana a medias: no hay nada que reportar.
  } finally {
    offs.forEach((off) => off());
  }
}

/** El detalle de una lista en vivo. */
shoppingRoutes.get('/stream/lists/:listId', async (c) => {
  const db = getDatabase();
  const scope = getScope(c.get('userId'));
  const list = readList(db, scope, c.req.param('listId'));
  if (!list) return notFound(c, 'List');

  return streamSSE(c, async (stream) => {
    await pumpStream(stream, [channelForList(list.id)], list.id);
  });
});

/** La bandeja: listas que nacen, se terminan o se borran en otra pantalla del hogar. */
shoppingRoutes.get('/stream/tray', async (c) => {
  const userId = c.get('userId');
  const scope = getScope(userId);
  return streamSSE(c, async (stream) => {
    await pumpStream(stream, channelsForTray({ userId, householdId: scope.householdId }), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// La lista sugerida por la actividad de la casa (HOGARIA-SPEC ## 12al) — SIN IA
//
// Todo lo que decide esta en `utils/lista-sugerida.ts`; aqui solo la lectura de la base de
// datos y la escritura de la lista. Dos decisiones de esta pantalla no son negociables:
//
//   - La lista sugerida es UNA y se reconoce (`source='sugerida'`, `status='active'`): si ya
//     hay una abierta, el boton dice «Actualizar» y no nace una segunda lista cada semana.
//   - Actualizar no toca lo que la casa ya decidio: lo marcado (comprado) y lo escrito a
//     mano se queda; solo se sustituyen las lineas sugeridas pendientes por las de ahora.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** El calculo, compartido por el GET (previsualizar) y el POST (escribir). */
function cuerpoDeSugerencia(db: ReturnType<typeof getDatabase>, userId: string) {
  const caducidades = caducidadesDe(db, userId);
  // La despensa a cero tambien cuenta: aqui es justo lo que falta.
  const casa = db.prepare('SELECT household_id AS hid FROM users WHERE id = ?').get(userId) as
    { hid: string | null } | undefined;
  const sinStock = db
    .prepare(
      `SELECT name, category, unit FROM ingredients
       WHERE (user_id = ? OR (household_id IS NOT NULL AND household_id = ?)) AND quantity <= 0
       ORDER BY name ASC`
    )
    .all(userId, casa?.hid ?? null) as { name: string; category: string; unit: string | null }[];
  return sugerenciasDeCompra({
    caducidades,
    sinStock,
    compras: comprasDeLaCasa(db, userId),
    precios: preciosDeLaCasa(db, userId),
    plan: necesidadesDelPlan(db, userId, hoy())
  });
}

/** La lista sugerida abierta de la casa, si la hay. Solo una: actualizar no es duplicar. */
function listaSugeridaActiva(db: ReturnType<typeof getDatabase>, scope: Scope) {
  return db
    .prepare(
      `SELECT * FROM shopping_lists WHERE source = 'sugerida' AND status = 'active' AND ${scope.clause}`
    )
    .get(...scope.params) as any;
}

shoppingRoutes.get('/suggested', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);
  const lista = listaSugeridaActiva(db, scope);
  const itemsPendientes = lista
    ? (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM shopping_list_items
           WHERE list_id = ? AND deleted_at IS NULL AND checked = 0`
          )
          .get(lista.id) as { n: number }
      ).n
    : 0;
  return c.json({
    success: true,
    data: {
      sugerencias: cuerpoDeSugerencia(db, userId),
      lista: lista
        ? { id: lista.id, name: lista.name, version: lista.version, itemsPendientes }
        : null
    }
  });
});

shoppingRoutes.post('/suggested', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const scope = getScope(userId);

  // El cuerpo es todo opcional: la lista se calcula en el server y lo unico que trae es el
  // nombre traducido. Un POST vacio (el boton, tal cual) tambien es valido.
  const body = createSuggestedListSchema.parse(await c.req.json().catch(() => ({})));
  const sugerencias = cuerpoDeSugerencia(db, userId);

  // Nada que sugerir y sin lista abierta: no se crea una lista vacia. (Si ya hay lista, si se
  // actualiza: retirar lo sugerido pendiente tambien es mantenerla al dia.)
  if (sugerencias.length === 0) {
    const abierta = listaSugeridaActiva(db, scope);
    if (!abierta) {
      return c.json({ success: true, data: { lista: null, sugeridos: 0 } });
    }
  }

  let lista = listaSugeridaActiva(db, scope);
  const creada = !lista;
  if (creada) {
    const id = nanoid();
    db.prepare(
      `INSERT INTO shopping_lists (id, user_id, household_id, name, source) VALUES (?, ?, ?, ?, 'sugerida')`
    ).run(id, userId, scope.householdId, body.name ?? 'Lista sugerida');
    lista = readList(db, scope, id);
  } else {
    // Solo se retiran las sugeridas PENDIENTES: lo comprado y lo anadido a mano es de la casa.
    db.prepare(
      `UPDATE shopping_list_items
         SET deleted_at = CURRENT_TIMESTAMP, updated_by = ?
       WHERE list_id = ? AND source = 'sugerida' AND checked = 0 AND deleted_at IS NULL`
    ).run(userId, lista.id);
  }

  const insertar = db.prepare(
    `INSERT INTO shopping_list_items
       (id, list_id, name, product_key, quantity, unit, category, price_minor, note, position, source, added_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sugerida', ?)`
  );
  sugerencias.forEach((fila, indice) => {
    insertar.run(
      nanoid(),
      lista.id,
      fila.name,
      productKeyOf(fila.name),
      fila.quantity,
      fila.unit,
      fila.category,
      fila.precioUnitarioMinor,
      fila.mejorTienda ? `Mejor en ${fila.mejorTienda}` : null,
      indice,
      userId
    );
  });
  db.prepare(
    'UPDATE shopping_lists SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(lista.id);
  announce(db, lista, userId, creada ? 'list.create' : 'list.update', null);

  return c.json(
    {
      success: true,
      data: {
        ...readList(db, scope, lista.id),
        ...listTotals(db, lista.id),
        creada,
        sugeridos: sugerencias.length
      }
    },
    creada ? 201 : 200
  );
});

/** Explicit, household-scoped approval of the current read-only meal shopping preview. */
shoppingRoutes.post('/meal-plan/approve', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const householdId = readActiveHouseholdId(db, userId);
  if (!householdId) {
    return c.json(
      {
        success: false,
        code: hasActiveHouseholdMemberships(db, userId)
          ? 'HOUSEHOLD_SELECTION_REQUIRED'
          : 'HOUSEHOLD_REQUIRED'
      },
      hasActiveHouseholdMemberships(db, userId) ? 409 : 404
    );
  }
  if (c.req.header('x-household-id') !== householdId) {
    return c.json({ success: false, code: 'HOUSEHOLD_CONTEXT_CHANGED' }, 409);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, code: 'INVALID_MEAL_SHOPPING_APPROVAL' }, 400);
  }
  const parsed = householdMealShoppingApprovalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, code: 'INVALID_MEAL_SHOPPING_APPROVAL' }, 400);
  }

  // Body parsing yields to the event loop; never apply the approval to a newly selected home.
  if (readActiveHouseholdId(db, userId) !== householdId) {
    return c.json({ success: false, code: 'HOUSEHOLD_CONTEXT_CHANGED' }, 409);
  }
  if (!canViewSharedMeals(db, householdId, userId)) {
    return c.json({ success: false, code: 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED' }, 403);
  }
  // `householdId` came from readActiveHouseholdId + permission checks above. Do not re-resolve it
  // from users.household_id: a legacy member with one active membership can have a null pointer.
  const scope = getActiveHouseholdScope(userId, householdId);

  try {
    const result = approveHouseholdMealShopping(db, {
      householdId,
      userId,
      input: parsed.data
    });
    if (result.changed && result.listId) {
      const list = readList(db, scope, result.listId);
      if (list) {
        try {
          // `announce` records and publishes only after the purchase list transaction commits.
          announce(db, list, userId, result.created ? 'list.create' : 'list.update');
        } catch (error) {
          console.error(
            '[Shopping] meal-plan approval committed but list notification failed',
            error
          );
        }
      }
    }
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        success: true,
        data: {
          listId: result.listId,
          version: result.version,
          created: result.created,
          idempotent: !result.changed,
          added: result.added,
          updated: result.updated,
          removed: result.removed
        }
      },
      result.created ? 201 : 200
    );
  } catch (error) {
    if (error instanceof HouseholdMealShoppingApprovalError) {
      const status = error.code === 'MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW' ? 400 : 409;
      return c.json({ success: false, code: error.code }, status);
    }
    console.error('[Shopping] meal-plan approval failed');
    return c.json({ success: false, code: 'MEAL_SHOPPING_APPROVAL_FAILED' }, 500);
  }
});

export { shoppingRoutes };
