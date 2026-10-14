import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Las caducidades (## 12ak) se prueban sobre una BD en memoria de verdad: lo que importa es
 * la interaccion entre el historial de compras, la fecha registrada, la estimacion de la IA y
 * el catalogo de bolsillo —y el orden en que se resuelven—. Sin IA ni red: `bloqueDeCaducidades`
 * y `buildShelfPrompt` son funciones puras sobre lo que haya en la despensa.
 */

import { productKeyOf } from './product-key.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let db: Sql;
let closeDatabase: () => void;
let alice: string;

function sembrarProducto(nombre: string, extra: Record<string, unknown> = {}): string {
  const id = `ing-${nombre.replace(/\W+/g, '-').toLowerCase()}`;
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit, expiration_date, estimated_shelf_days, created_at)
     VALUES (?, ?, NULL, ?, 'other', 1, 'ud', NULL, NULL, ?)`
  ).run(id, alice, nombre, extra['created_at'] ?? '2026-09-01 10:00:00');
  if (
    extra['expiration_date'] ||
    extra['estimated_shelf_days'] ||
    extra['quantity'] !== undefined
  ) {
    const sets: string[] = [];
    const valores: unknown[] = [];
    if (extra['expiration_date'] !== undefined) {
      sets.push('expiration_date = ?');
      valores.push(extra['expiration_date']);
    }
    if (extra['estimated_shelf_days'] !== undefined) {
      sets.push('estimated_shelf_days = ?');
      valores.push(extra['estimated_shelf_days']);
    }
    if (extra['quantity'] !== undefined) {
      sets.push('quantity = ?');
      valores.push(extra['quantity']);
    }
    db.prepare(`UPDATE ingredients SET ${sets.join(', ')} WHERE id = ?`).run(...valores, id);
  }
  return id;
}

function sembrarCompra(nombre: string, dia: string, cantidad = 1): void {
  db.prepare(
    `INSERT INTO price_observations (id, user_id, household_id, product_key, product_name, price_minor, quantity, observed_at)
     VALUES (?, ?, NULL, ?, ?, 100, ?, ?)`
  ).run(
    `po-${Math.random().toString(36).slice(2)}`,
    alice,
    productKeyOf(nombre),
    nombre,
    cantidad,
    `${dia} 10:00:00`
  );
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
});

afterAll(() => closeDatabase?.());

beforeEach(async () => {
  db.exec('DELETE FROM price_observations; DELETE FROM ingredients; DELETE FROM users;');
  alice = `u-cadu-${Math.random().toString(36).slice(2)}`;
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, NULL)'
  ).run(alice, `${alice}@test.local`, 'Casa', 'hash');
});

describe('ritmoDe', () => {
  it('dos compras a siete dias y de seis unidades: una unidad dura 7/6 dias', async () => {
    const { ritmoDe } = await import('./caducidades.js');
    const ritmo = ritmoDe([
      { dia: '2026-09-01', cantidad: 6 },
      { dia: '2026-09-08', cantidad: 6 }
    ]);
    expect(ritmo).not.toBeNull();
    expect(ritmo!.cadaDias).toBe(7);
    expect(ritmo!.unidadesPorCompra).toBe(6);
    expect(ritmo!.diasPorUnidad).toBeCloseTo(7 / 6, 5);
  });

  it('una sola compra no es un ritmo', async () => {
    const { ritmoDe } = await import('./caducidades.js');
    expect(ritmoDe([{ dia: '2026-09-01', cantidad: 2 }])).toBeNull();
  });

  it('compras del MISMO dia se funden antes de medir (las cuenta comprasDeLaCasa)', async () => {
    const { comprasDeLaCasa } = await import('./caducidades.js');
    sembrarProducto('Leche entera');
    sembrarCompra('Leche entera', '2026-09-01', 3);
    sembrarCompra('Leche entera', '2026-09-01', 3); // el ticket y el cierre de la misma compra
    sembrarCompra('Leche entera', '2026-09-08', 6);

    const compras = comprasDeLaCasa(db, alice).get('leche entera');
    expect(compras).toEqual([
      { dia: '2026-09-01', cantidad: 6 },
      { dia: '2026-09-08', cantidad: 6 }
    ]);
  });
});

describe('caducidadesDe', () => {
  it('la fecha registrada manda; luego la IA; luego el catalogo; y sin nada, no se sabe', async () => {
    const { caducidadesDe } = await import('./caducidades.js');
    const hoy = new Date().toISOString().slice(0, 10);
    const manana = new Date(Date.parse(`${hoy}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

    sembrarProducto('Yogur natural', { expiration_date: manana, quantity: 4 });
    sembrarProducto('Quinoa real', { estimated_shelf_days: 180, quantity: 1 });
    sembrarProducto('Pan de barra', { quantity: 2 });
    sembrarProducto('Nada de nada rarisimo', { quantity: 1 });

    const filas = caducidadesDe(db, alice);
    const porNombre = new Map(filas.map((fila) => [fila.name, fila]));

    expect(porNombre.get('Yogur natural')).toMatchObject({ shelfSource: 'fecha', daysLeft: 1 });
    expect(porNombre.get('Quinoa real')).toMatchObject({ shelfSource: 'ia', estimatedDays: 180 });
    // El pan no tiene ni fecha ni estimacion: el catalogo de bolsillo dice 4 dias desde que se compro.
    expect(porNombre.get('Pan de barra')).toMatchObject({
      shelfSource: 'catalogo',
      estimatedDays: 4
    });
    expect(porNombre.get('Nada de nada rarisimo')).toMatchObject({
      shelfSource: null,
      daysLeft: null,
      vence: null
    });
  });

  it('caducado tiene daysLeft negativo, y la lista va por urgencia', async () => {
    const { caducidadesDe } = await import('./caducidades.js');
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.parse(`${hoy}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

    const hoyIso = new Date().toISOString().slice(0, 10);
    sembrarProducto('Pescado fresco', { expiration_date: ayer, quantity: 1 });
    // La leche entra HOY en casa: le quedan sus 7 dias de catalogo, no los del alta de ayer.
    sembrarProducto('Leche entera', { quantity: 6, created_at: `${hoyIso} 10:00:00` });
    sembrarProducto('Arroz', { quantity: 2 });
    sembrarProducto('Bicho de la huerta raro', { quantity: 1 });

    const filas = caducidadesDe(db, alice);
    expect(filas[0].name).toBe('Pescado fresco');
    expect(filas[0].daysLeft).toBe(-1);
    // Lo que no sabe cuando vence cierra la lista, no la abre.
    expect(filas[filas.length - 1]).toMatchObject({
      name: 'Bicho de la huerta raro',
      daysLeft: null
    });
  });

  it('el ritmo y la duracion del stock salen del historial: 12 uds repuestas cada 7 dias de 6 en 6 duran ~14', async () => {
    const { caducidadesDe } = await import('./caducidades.js');
    sembrarProducto('Leche entera', { quantity: 12 });
    sembrarCompra('Leche entera', '2026-09-01', 6);
    sembrarCompra('Leche entera', '2026-09-08', 6);

    const fila = caducidadesDe(db, alice).find((candidata) => candidata.name === 'Leche entera');
    expect(fila).toMatchObject({
      cadaDias: 7,
      unidadesPorCompra: 6,
      duraDias: 14,
      lastBought: '2026-09-08'
    });
  });

  it('la fecha estimada nace de la ultima compra, no del alta del producto', async () => {
    const { caducidadesDe } = await import('./caducidades.js');
    sembrarProducto('Pan de barra', { quantity: 1, created_at: '2026-08-01 10:00:00' });
    sembrarCompra('Pan de barra', '2026-09-10', 1);

    const fila = caducidadesDe(db, alice).find((candidata) => candidata.name === 'Pan de barra');
    // Comprado el 10 con 4 dias de vida: vence el 14, se compre cuando se compre el alta.
    expect(fila?.vence).toBe('2026-09-14');
  });

  it('sin stock no hay fila: los basicos a cero no caducan', async () => {
    const { caducidadesDe } = await import('./caducidades.js');
    sembrarProducto('Pan de barra', { quantity: 0 });
    expect(caducidadesDe(db, alice)).toEqual([]);
  });
});

describe('bloqueDeCaducidades (el prompt del planificador)', () => {
  it('nombra lo urgente, marca lo estimado y se calla cuando no hay prisa', async () => {
    const { bloqueDeCaducidades } = await import('./caducidades.js');
    const hoy = new Date().toISOString().slice(0, 10);
    const enDos = new Date(Date.parse(`${hoy}T00:00:00Z`) + 2 * 86400000)
      .toISOString()
      .slice(0, 10);
    const enUnMes = new Date(Date.parse(`${hoy}T00:00:00Z`) + 30 * 86400000)
      .toISOString()
      .slice(0, 10);

    sembrarProducto('Pescado fresco', { expiration_date: enDos, quantity: 300, unit: 'g' });
    sembrarProducto('Pan de barra', { quantity: 1 });
    sembrarProducto('Arroz', { expiration_date: enUnMes, quantity: 2 });

    const bloque = bloqueDeCaducidades(db, alice);
    expect(bloque).toContain('priorizalos');
    expect(bloque).toContain('Pescado fresco');
    expect(bloque).toContain('caduca en 2 dia(s)');
    // El pan vence por estimacion de catalogo: el prompt lo dice, que no es lo mismo que una fecha.
    expect(bloque).toContain('Pan de barra');
    expect(bloque).toContain('fecha estimada');
    // El arroz tiene un mes: no molesta.
    expect(bloque).not.toContain('Arroz');

    db.exec('DELETE FROM ingredients;');
    expect(bloqueDeCaducidades(db, alice)).toBe('');
  });
});

describe('buildShelfPrompt y shelfAnswerSchema', () => {
  it('el prompt pide dias enteros, 1..730, JSON solo, y nombra todos los productos', async () => {
    const { buildShelfPrompt } = await import('./caducidades.js');
    const { system, user } = buildShelfPrompt([
      { name: 'Tofu fresco', unit: 'ud', category: 'other' },
      { name: 'Bicho de la huerta raro', unit: null, category: 'vegetables' }
    ]);
    expect(system).toContain('DIAS ENTEROS');
    expect(system).toContain('1 y 730');
    expect(user).toContain('Tofu fresco');
    expect(user).toContain('Bicho de la huerta raro');
    expect(user).toContain('{"products": [{"name": "", "days": 0}]}');
  });

  it('el esquema de la respuesta traga dias como numero o texto y recorta lo imposible', async () => {
    const { shelfAnswerSchema } = await import('./caducidades.js');
    const valida = shelfAnswerSchema.parse({ products: [{ name: 'Tofu', days: '5' }] });
    expect(valida.products[0].days).toBe(5);
    expect(
      shelfAnswerSchema.parse({ products: [{ name: 'Tofu '.repeat(600), days: 5 }] }).products[0]
        ?.name
    ).toBe('Tofu '.repeat(600).trim());
    expect(() => shelfAnswerSchema.parse({ products: [{ name: 'Tofu', days: 0 }] })).toThrow();
    expect(() => shelfAnswerSchema.parse({ products: [{ name: 'Tofu', days: 9000 }] })).toThrow();
  });
});
