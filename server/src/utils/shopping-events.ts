/**
 * Quien ha tocado que (HOGARIA-SPEC §8f).
 *
 * Es una tabla y no una linea de log por dos razones: «quien ha anadido el pollo»
 * tiene que poder consultarse un mes despues, y el visor de logs es un volcado
 * circular pensado para diagnosticar el servidor, no para contar la vida de la
 * cesta. Ademas el nombre de usuario se **copia** en la fila: si Ana se cambia el
 * nombre manana, lo que hizo hace un mes sigue siendo de Ana, y un JOIN al reves lo
 * reescribiria.
 */

export const EVENT_ACTIONS = [
  'list.create',
  'list.update',
  'list.complete',
  'list.reopen',
  'list.delete',
  'list.discount',
  'list.discount-remove',
  'list.clear-checked',
  'list.order',
  'item.add',
  'item.merge',
  'item.update',
  'item.discount',
  'item.offer',
  'item.check',
  'item.uncheck',
  'item.remove',
  'item.restore',
  'items.bulk',
  'items.apply'
] as const;

export type EventAction = (typeof EVENT_ACTIONS)[number];

const KNOWN = new Set<string>(EVENT_ACTIONS);

type Db = import('better-sqlite3').Database;

export function userName(db: Db, userId: string): string | null {
  const row = db.prepare('SELECT name, email FROM users WHERE id = ?').get(userId) as
    | { name: string | null; email: string | null }
    | undefined;
  if (!row) return null;
  if (row.name && row.name.trim()) return row.name.trim();
  return row.email ? row.email.split('@')[0] : null;
}

/**
 * Apunta el suceso y devuelve la fila. Un `action` que no esta en la lista se ignora
 * en vez de lanzar: esto se llama desde el mismo `try` que escribe el dato, y una
 * auditoria que tira la operacion del usuario al suelo es peor que una auditoria con
 * un hueco.
 */
export function recordEvent(
  db: Db,
  input: { listId: string; userId: string | null; action: string; itemName?: string | null }
): { id: string } | null {
  if (!KNOWN.has(input.action)) return null;
  const id = `evt-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  db.prepare(
    `INSERT INTO shopping_list_events (id, list_id, user_id, user_name, action, item_name)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.listId, input.userId, input.userId ? userName(db, input.userId) : null, input.action, input.itemName ?? null);
  return { id };
}

export function readEvents(db: Db, input: { listId: string; limit: number }) {
  // El nombre que se enseña es el de HOY (`u.name`), y la instantanea de la fila
  // (`e.user_name`) queda como reserva para cuando la cuenta ya no existe: lo que importa en
  // «quien ha tocado que» es saber de quien se trata, y si Ana se renombra manana, ver «Bea» en
  // su propia linea es un error, no historia. La fila sigue guardando la instantanea: la
  // auditoria intacta en la tabla, resuelta en la pantalla. La foto, igual: es un dato de la
  // cuenta, no del suceso.
  return db
    .prepare(
      `SELECT e.id, e.list_id, e.user_id, COALESCE(u.name, e.user_name) AS user_name, e.action,
              e.item_name, e.created_at, u.avatar AS user_avatar
       FROM shopping_list_events e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.list_id = ?
       -- CURRENT_TIMESTAMP solo tiene resolucion de un segundo: dos sucesos de la
       -- misma pulsacion empatan, y desempatar por id (un nanoid) es aleatorio. El
       -- rowid de SQLite si es monotono por insercion, y es el orden real.
       ORDER BY e.created_at DESC, e.rowid DESC
       LIMIT ?`
    )
    .all(input.listId, input.limit) as any[];
}

/** Texto para la persona, no para el log. Una linea por suceso, en castellano. */
export function describeEvent(event: { action: string; item_name: string | null; user_name: string | null }): string {
  const who = event.user_name ?? 'Alguien';
  const item = event.item_name ? ` «${event.item_name}»` : '';
  switch (event.action) {
    case 'item.add':
      return `${who} ha añadido${item}`;
    case 'item.merge':
      return `${who} ha sumado unidades a${item}`;
    case 'item.update':
      return `${who} ha editado${item}`;
    case 'item.discount':
      return `${who} ha cambiado el descuento de${item}`;
    case 'item.offer':
      return `${who} ha cambiado la oferta de${item}`;
    case 'item.check':
      return `${who} ha marcado${item} como comprada`;
    case 'item.uncheck':
      return `${who} ha desmarcado${item}`;
    case 'item.remove':
      return `${who} ha quitado${item}`;
    case 'item.restore':
      return `${who} ha recuperado${item}`;
    case 'items.bulk':
      return `${who} ha pegado una lista`;
    case 'items.apply':
      return `${who} ha añadido líneas desde una foto`;
    case 'list.clear-checked':
      return `${who} ha vaciado el carro`;
    case 'list.order':
      return `${who} ha reordenado la lista`;
    case 'list.discount':
      return `${who} ha cambiado el descuento`;
    case 'list.discount-remove':
      return `${who} ha quitado el descuento`;
    case 'list.complete':
      return `${who} ha terminado la compra`;
    case 'list.reopen':
      return `${who} ha reabierto la lista`;
    case 'list.update':
      return `${who} ha cambiado la lista`;
    case 'list.create':
      return `${who} ha creado la lista`;
    case 'list.delete':
      return `${who} ha borrado la lista`;
    default:
      return `${who} ha tocado la lista`;
  }
}
