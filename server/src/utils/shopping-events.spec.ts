import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * La auditoria se prueba sobre la BD real (misma razon que las rutas: lo que importa
 * es que la fila exista despues del UPDATE, y un mock no lo cuenta).
 */
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
let db: Sql;
let closeDatabase: () => void;

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    'u-events',
    'eventos@test.local',
    'Ana',
    'hash'
  );
  db.prepare(
    `INSERT INTO shopping_lists (id, user_id, name) VALUES ('l-events', 'u-events', 'Compra')`
  ).run();
});

afterAll(() => closeDatabase?.());

describe('recordEvent / readEvents', () => {
  it('guarda quien fue y que linea era', async () => {
    const { recordEvent, readEvents } = await import('./shopping-events.js');
    const inserted = recordEvent(db, {
      listId: 'l-events',
      userId: 'u-events',
      action: 'item.add',
      itemName: 'Pollo'
    });
    expect(inserted).not.toBeNull();

    const events = readEvents(db, { listId: 'l-events', limit: 10 });
    expect(events[0]).toMatchObject({
      action: 'item.add',
      item_name: 'Pollo',
      user_name: 'Ana',
      user_id: 'u-events'
    });
  });

  it('un action que no existe no escribe nada y no lanza', async () => {
    const { recordEvent, readEvents } = await import('./shopping-events.js');
    const before = readEvents(db, { listId: 'l-events', limit: 50 }).length;
    expect(recordEvent(db, { listId: 'l-events', userId: 'u-events', action: 'item.teletransport' })).toBeNull();
    expect(readEvents(db, { listId: 'l-events', limit: 50 })).toHaveLength(before);
  });

  it('el limite manda, y lo mas reciente sale primero', async () => {
    const { recordEvent, readEvents } = await import('./shopping-events.js');
    recordEvent(db, { listId: 'l-events', userId: 'u-events', action: 'item.check', itemName: 'Leche' });
    const rows = readEvents(db, { listId: 'l-events', limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('item.check');
  });

  it('sin usuario conocido el nombre es null, no «undefined» en la pantalla', async () => {
    const { recordEvent, readEvents } = await import('./shopping-events.js');
    recordEvent(db, { listId: 'l-events', userId: null, action: 'list.update', itemName: null });
    const rows = readEvents(db, { listId: 'l-events', limit: 1 });
    expect(rows[0].user_name).toBeNull();
  });
});

describe('describeEvent', () => {
  /**
   * Son textos de pantalla: si se reescriben aqui, la coherencia de las 17 frases
   * (y que ninguna se olvide) se comprueba en un sitio y no a mano en la UI.
   */
  const CASES: [string, string][] = [
    ['item.add', 'Ana ha añadido «Pollo»'],
    ['item.merge', 'Ana ha sumado unidades a «Pollo»'],
    ['item.update', 'Ana ha editado «Pollo»'],
    ['item.check', 'Ana ha marcado «Pollo» como comprada'],
    ['item.uncheck', 'Ana ha desmarcado «Pollo»'],
    ['item.remove', 'Ana ha quitado «Pollo»'],
    ['item.restore', 'Ana ha recuperado «Pollo»'],
    ['items.bulk', 'Ana ha pegado una lista'],
    ['list.clear-checked', 'Ana ha vaciado el carro'],
    ['list.order', 'Ana ha reordenado la lista'],
    ['list.discount', 'Ana ha cambiado el descuento'],
    ['list.discount-remove', 'Ana ha quitado el descuento'],
    ['list.complete', 'Ana ha terminado la compra'],
    ['list.reopen', 'Ana ha reabierto la lista'],
    ['list.update', 'Ana ha cambiado la lista'],
    ['list.create', 'Ana ha creado la lista'],
    ['list.delete', 'Ana ha borrado la lista']
  ];

  it('cada accion tiene su frase', async () => {
    const { describeEvent } = await import('./shopping-events.js');
    for (const [action, expected] of CASES) {
      expect(describeEvent({ action, item_name: 'Pollo', user_name: 'Ana' })).toBe(expected);
    }
  });

  it('una accion nueva no pinta el identificador interno', async () => {
    const { describeEvent } = await import('./shopping-events.js');
    expect(describeEvent({ action: 'item.teletransport', item_name: null, user_name: 'Ana' })).toBe(
      'Ana ha tocado la lista'
    );
    // ...y sin nombre tampoco pinta un hueco.
    expect(describeEvent({ action: 'item.add', item_name: null, user_name: null })).toBe('Alguien ha añadido');
  });
});
