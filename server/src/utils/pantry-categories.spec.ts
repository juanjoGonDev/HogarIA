import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * El catalogo de categorias del inventario (HOGARIA-SPEC ## 12x).
 *
 * Lo que se prueba aqui es la parte que no puede comprobar el compilador: que una categoria nueva no pueda
 * colocarse debajo de si misma (el conteo de descendientes recorre el arbol, y un ciclo es un `while` eterno),
 * que `other` sea la reserva y no se pueda borrar, y que el color que se guarda sea siempre `#RRGGBB` en
 * mayusculas —el mismo que pinta el punto de la fila, y un `red` en la base es un punto negro en la pantalla.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let db: Sql;
let mod: typeof import('./pantry-categories.js');

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  mod = await import('./pantry-categories.js');
});

beforeEach(() => {
  db.exec(
    'DELETE FROM pantry_categories; DELETE FROM ingredients; DELETE FROM users; DELETE FROM households;'
  );
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES ('u-a', 'a@t.local', 'Ana', 'hash')"
  ).run();
});

type Crear = Parameters<typeof mod.createCategory>[1];

const crear = (input: Partial<Crear> = {}) =>
  mod.createCategory(db, {
    userId: 'u-a',
    householdId: null,
    name: 'Bebidas vegetales',
    idFactory: () => `pc-${Math.random().toString(36).slice(2, 8)}`,
    ...input
  } as Crear);

describe('normalizar lo que entra del formulario', () => {
  it('el nombre no puede venir con espacios de sobra ni con nada de eso de 200 caracteres', () => {
    expect(mod.normalizeCategoryName('  Bebidas   vegetales ')).toBe('Bebidas vegetales');
    expect(() => mod.normalizeCategoryName('   ')).toThrow(RangeError);
    expect(() => mod.normalizeCategoryName('x'.repeat(121))).toThrow(RangeError);
  });

  it('el color se guarda en mayusculas, y lo que no es #RRGGBB no entra', () => {
    expect(mod.normalizeCategoryColor('#33aaff')).toBe('#33AAFF');
    expect(() => mod.normalizeCategoryColor('red')).toThrow(RangeError);
    expect(() => mod.normalizeCategoryColor('#fff')).toThrow(RangeError);
    expect(mod.normalizeOptionalCategoryColor('')).toBeUndefined();
    expect(mod.normalizeOptionalCategoryColor(null)).toBeUndefined();
  });

  it('la clave es el dato: minusculas, sin acentos, y tal cual la guarda `ingredients.category`', () => {
    expect(mod.pantryCategoryKey('Bebidas vegetales')).toBe('bebidas vegetales');
    // Las claves de fabrica son las que ya estan escritas en las filas, no un slug nuevo. Desde la ## 12aa
    // entran trece: el padre `alimentos` abre el arbol, las once hojas de comida se quedan con su clave de
    // siempre (lo que guarda `ingredients.category` no se toca), y `other` cierra sin padre.
    expect(mod.DEFAULT_PANTRY_CATEGORIES.map((c) => c.key)).toEqual([
      'alimentos',
      'vegetables',
      'fruits',
      'meat',
      'fish',
      'dairy',
      'grains',
      'spices',
      'condiments',
      'frozen',
      'canned',
      'beverages',
      'other'
    ]);
    expect(
      mod.DEFAULT_PANTRY_CATEGORIES.filter((c) => c.parent === 'alimentos').map((c) => c.key)
    ).toHaveLength(11);
    expect(mod.PROTECTED_PANTRY_KEY).toBe('other');
  });
});

describe('el arbol', () => {
  it('una categoria no puede ser su propio padre', () => {
    const padre = crear({ name: 'Bebidas', key: 'bebidas' });
    expect(() =>
      mod.updateCategory(db, {
        userId: 'u-a',
        householdId: null,
        id: padre.id,
        patch: { parentKey: padre.key }
      })
    ).toThrow(RangeError);
  });

  it('ni el nieto puede adoptar al abuelo para cerrar un ciclo', () => {
    const abuelo = crear({ name: 'Alimentacion', key: 'alimentacion' });
    const padre = crear({ name: 'Bebidas', key: 'bebidas', parentKey: abuelo.key });
    const hijo = crear({ name: 'Vegetales', key: 'vegetales', parentKey: padre.key });
    expect(() =>
      mod.updateCategory(db, {
        userId: 'u-a',
        householdId: null,
        id: abuelo.id,
        patch: { parentKey: hijo.key }
      })
    ).toThrow(RangeError);
  });

  it('y la profundidad tiene un techo que se dice con nombre', () => {
    let parentKey: string | undefined;
    for (let nivel = 0; nivel < mod.MAX_PANTRY_DEPTH; nivel++) {
      const creada = crear({ name: `Nivel ${nivel}`, key: `nivel-${nivel}`, parentKey });
      parentKey = creada.key;
    }
    expect(() => crear({ name: 'Demasiado abajo', key: 'demasiado', parentKey })).toThrow(
      /profundidad/i
    );
  });

  it('los recuentos suman a los descendientes, que es lo que hace falta para saber si se puede borrar', () => {
    const raiz = crear({ name: 'Alimentacion', key: 'alimentacion' });
    const hija = crear({ name: 'Bebidas', key: 'bebidas', parentKey: raiz.key });
    crear({ name: 'De avena', key: 'de avena', parentKey: hija.key });
    for (const [category, quantity] of [
      ['alimentacion', 3],
      ['bebidas', 1],
      ['de avena', 2]
    ] as const) {
      db.prepare(
        "INSERT INTO ingredients (id, user_id, name, category, quantity, unit) VALUES (?, 'u-a', ?, ?, 1, 'unit')"
      ).run(`ing-${category}`, category, category);
      void quantity;
    }
    const filas = mod.listCategories(db, { userId: 'u-a', householdId: null });
    const de = (key: string) => filas.find((f) => f.key === key)!;
    expect(de('alimentacion').counts).toEqual({ products: 1, children: 1, descendantProducts: 3 });
    expect(de('de avena').counts).toEqual({ products: 1, children: 0, descendantProducts: 1 });
    expect(de('alimentacion').canDelete).toBe(false);
    expect(de('de avena').canDelete).toBe(false);
  });
});

describe('sembrar y borrar', () => {
  it('resuelve categorias del hogar activo sin mezclar categorias de otra casa del mismo usuario', () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'old-home',
      'Casa anterior',
      'invite-old-home-categories'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'active-home',
      'Casa activa',
      'invite-active-home-categories'
    );
    db.prepare(
      "INSERT INTO users (id, email, name, password_hash) VALUES ('u-b', 'b@t.local', 'Beto', 'hash')"
    ).run();
    db.prepare(
      `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color)
       VALUES ('old-category', 'u-a', 'old-home', 'old-only', 'Solo casa anterior', '#112233')`
    ).run();
    db.prepare(
      `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color)
       VALUES ('active-category', 'u-b', 'active-home', 'active-only', 'Casa activa', '#223344')`
    ).run();
    db.prepare(
      `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color)
       VALUES ('personal-category', 'u-a', NULL, 'personal-only', 'Personal', '#334455')`
    ).run();

    const activeKeys = mod
      .listCategories(db, { userId: 'u-a', householdId: 'active-home' })
      .map((category) => category.key);
    const personalKeys = mod
      .listCategories(db, { userId: 'u-a', householdId: null })
      .map((category) => category.key);

    expect(activeKeys).toContain('active-only');
    expect(activeKeys).not.toContain('old-only');
    expect(personalKeys).toEqual(['personal-only']);
  });

  it('la casa arranca con el padre delante y las doce de siempre detras, y dos veces seguidas no son veintiseis', () => {
    mod.ensureDefaultCategories(db, 'u-a', null);
    mod.ensureDefaultCategories(db, 'u-a', null);
    const filas = db
      .prepare(
        "SELECT key, parent_key FROM pantry_categories WHERE user_id = 'u-a' ORDER BY position"
      )
      .all() as {
      key: string;
      parent_key: string | null;
    }[];
    expect(filas).toHaveLength(13);
    expect(filas[0].key).toBe('alimentos');
    expect(filas[0].parent_key).toBeNull();
    expect(filas[1].key).toBe('vegetables');
    expect(filas[1].parent_key).toBe('alimentos');
    expect(filas[12].key).toBe('other');
    expect(filas[12].parent_key).toBeNull(); // la reserva no cuelga de nadie: es donde cae lo que no encaja
  });

  it('el nombre sembrado es la etiqueta en castellano que ya pinta la pantalla, palabra por palabra', () => {
    mod.ensureDefaultCategories(db, 'u-a', null);
    const nombres = (
      db
        .prepare("SELECT name FROM pantry_categories WHERE user_id = 'u-a' ORDER BY position")
        .all() as {
        name: string;
      }[]
    ).map((f) => f.name);
    expect(nombres).toEqual([
      'Alimentos',
      'Verduras',
      'Frutas',
      'Carnes',
      'Pescados',
      'Lácteos',
      'Cereales',
      'Especias',
      'Condimentos',
      'Congelados',
      'Enlatados',
      'Bebidas',
      'Otros'
    ]);
  });

  describe('el padre de fabrica sobre casas que ya existian (## 12aa)', () => {
    const sembrarDocePlanas = () => {
      // Casa anterior a esta tanda: las doce de siempre, todas en fila, sin padre.
      const planas = [
        ['vegetables', 'Verduras', '#4CAF50'],
        ['fruits', 'Frutas', '#E05A5A'],
        ['meat', 'Carnes', '#A6343E'],
        ['fish', 'Pescados', '#4FA3D1'],
        ['dairy', 'Lácteos', '#E6C34A'],
        ['grains', 'Cereales', '#B26A00'],
        ['spices', 'Especias', '#8E5AC8'],
        ['condiments', 'Condimentos', '#C99A2E'],
        ['frozen', 'Congelados', '#6C8AE4'],
        ['canned', 'Enlatados', '#2FA79B'],
        ['beverages', 'Bebidas', '#5C6BC0'],
        ['other', 'Otros', '#8A8F98']
      ] as const;
      planas.forEach(([key, name, color], index) =>
        db
          .prepare(
            'INSERT INTO pantry_categories (id, user_id, household_id, key, name, color, position) VALUES (?, ?, NULL, ?, ?, ?, ?)'
          )
          .run(`old-${index}`, 'u-a', key, name, color, index)
      );
    };

    it('crea `alimentos` y sube debajo las once hojas intactas; la reserva se queda suelta', () => {
      sembrarDocePlanas();
      const reparentadas = mod.asegurarPadreAlimentos(db, 'u-a', null);
      expect(reparentadas).toBe(11);
      const filas = db
        .prepare("SELECT key, parent_key FROM pantry_categories WHERE user_id = 'u-a'")
        .all() as {
        key: string;
        parent_key: string | null;
      }[];
      expect(filas.find((f) => f.key === 'alimentos')?.parent_key).toBeNull();
      expect(filas.find((f) => f.key === 'vegetables')?.parent_key).toBe('alimentos');
      expect(filas.find((f) => f.key === 'other')?.parent_key).toBeNull();
      // Idempotente: una segunda pasada no duplica el padre ni reescribe nada.
      expect(mod.asegurarPadreAlimentos(db, 'u-a', null)).toBe(0);
      expect(
        (
          db
            .prepare(
              "SELECT COUNT(*) AS c FROM pantry_categories WHERE user_id = 'u-a' AND key = 'alimentos'"
            )
            .get() as { c: number }
        ).c
      ).toBe(1);
    });

    it('no toca una casa que ya movio o renombro algo: esa casa ya decidio sobre su arbol', () => {
      sembrarDocePlanas();
      db.prepare(
        "UPDATE pantry_categories SET name = 'Para picar' WHERE user_id = 'u-a' AND key = 'fruits'"
      ).run();
      const reparentadas = mod.asegurarPadreAlimentos(db, 'u-a', null);
      expect(reparentadas).toBe(10); // 'Frutas' renombrada se queda donde su casa la dejo
      expect(
        db
          .prepare(
            "SELECT parent_key FROM pantry_categories WHERE user_id = 'u-a' AND key = 'fruits'"
          )
          .get()
      ).toMatchObject({ parent_key: null });
    });

    it('una casa con su propio `alimentos` no ve nacer otro', () => {
      db.prepare(
        "INSERT INTO pantry_categories (id, user_id, household_id, key, name, color) VALUES ('x', 'u-a', NULL, 'alimentos', 'Para comer', '#123456')"
      ).run();
      expect(mod.asegurarPadreAlimentos(db, 'u-a', null)).toBe(0);
      expect(
        db
          .prepare("SELECT name FROM pantry_categories WHERE user_id = 'u-a' AND key = 'alimentos'")
          .get()
      ).toMatchObject({ name: 'Para comer' });
    });

    it('backfills parent IDs independently across legacy scopes of the same user', async () => {
      db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
        'legacy-category-house-a',
        'Hogar heredado A',
        'LEGACY01'
      );
      db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
        'legacy-category-house-b',
        'Hogar heredado B',
        'LEGACY02'
      );
      const defaults = mod.DEFAULT_PANTRY_CATEGORIES.filter(
        (category) => category.key !== 'alimentos'
      );
      for (const [householdId, prefix] of [
        ['legacy-category-house-a', 'household-a-legacy'],
        ['legacy-category-house-b', 'household-b-legacy']
      ] as const) {
        defaults.forEach((category, index) =>
          db
            .prepare(
              `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color, position)
             VALUES (?, 'u-a', ?, ?, ?, ?, ?)`
            )
            .run(
              `${prefix}-${index}`,
              householdId,
              category.key,
              category.name,
              category.color,
              index
            )
        );
      }
      const { asegurarPadreAlimentosTodas } = await import('./seed-data.js');

      expect(() => asegurarPadreAlimentosTodas(db)).not.toThrow();
      expect(() => asegurarPadreAlimentosTodas(db)).not.toThrow();
      const roots = db
        .prepare(
          "SELECT household_id FROM pantry_categories WHERE user_id = 'u-a' AND key = 'alimentos'"
        )
        .all() as { household_id: string | null }[];
      expect(roots).toHaveLength(2);
      expect(new Set(roots.map((row) => row.household_id))).toEqual(
        new Set(['legacy-category-house-a', 'legacy-category-house-b'])
      );
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM pantry_categories WHERE user_id = 'u-a'").get()
      ).toEqual({ count: 26 });
    });
  });

  describe('el subarbol para el filtro', () => {
    it('preguntar por el padre devuelve padre e hijas; por una hoja, solo la hoja', () => {
      mod.ensureDefaultCategories(db, 'u-a', null);
      const scope = { userId: 'u-a', householdId: null };
      expect(mod.clavesDeSubarbol(db, scope, 'alimentos')).toEqual(
        expect.arrayContaining(['alimentos', 'vegetables', 'beverages'])
      );
      expect(mod.clavesDeSubarbol(db, scope, 'alimentos')).toHaveLength(12);
      expect(mod.clavesDeSubarbol(db, scope, 'vegetables')).toEqual(['vegetables']);
      // Una clave que la casa no tiene no es un error: es un filtro vacio, que es la verdad.
      expect(mod.clavesDeSubarbol(db, scope, 'no-existe')).toEqual(['no-existe']);
    });
  });

  it('la reserva no se borra ni vacia; y con articulos encima tampoco', () => {
    mod.ensureDefaultCategories(db, 'u-a', null);
    const otras = mod.findCategoryByKey(db, { userId: 'u-a', householdId: null }, 'other')!;
    expect(mod.deleteImpact(db, { userId: 'u-a', householdId: null }, otras.id)).toMatchObject({
      protected: true,
      canDelete: false
    });

    const nueva = crear({ name: 'Frutos secos', key: 'frutos secos' });
    db.prepare(
      "INSERT INTO ingredients (id, user_id, name, category, quantity, unit) VALUES ('i-1', 'u-a', 'Almendras', 'frutos secos', 1, 'unit')"
    ).run();
    expect(mod.deleteImpact(db, { userId: 'u-a', householdId: null }, nueva.id).canDelete).toBe(
      false
    );

    db.prepare("DELETE FROM ingredients WHERE id = 'i-1'").run();
    expect(mod.deleteImpact(db, { userId: 'u-a', householdId: null }, nueva.id)).toMatchObject({
      products: 0,
      canDelete: true
    });
    mod.removeCategory(db, { userId: 'u-a', householdId: null }, nueva.id);
    expect(
      mod.findCategoryByKey(db, { userId: 'u-a', householdId: null }, 'frutos secos')
    ).toBeUndefined();

    expect(() => mod.removeCategory(db, { userId: 'u-a', householdId: null }, otras.id)).toThrow(
      /protected|reserva/i
    );
  });

  it('sin color en el formulario sale uno del abanico, siempre el mismo para la misma clave', () => {
    expect(mod.colorForNewCategory('frutos secos')).toBe(mod.colorForNewCategory('frutos secos'));
    expect(mod.colorForNewCategory('otra')).not.toBe(mod.colorForNewCategory('frutos secos'));
    const creada = crear({ name: 'Sin color', color: null });
    expect(creada.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(crear({ name: 'Con color', color: '#112233' }).color).toBe('#112233');
    expect(crear({ name: 'Con margen', color: '  #112234  ' }).color).toBe('#112234');
  });
});
