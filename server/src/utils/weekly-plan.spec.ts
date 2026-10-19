import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `persistWeeklyPlan` es lo que convierte la respuesta de la IA en filas del
 * calendario. Estos tests cubren las tres reglas que importan:
 * rellena huecos, respeta lo que ya estaba puesto, y no escribe fuera de la
 * semana pedida por mucho que se despiste el modelo.
 */

// DATABASE_PATH se lee al importar la config, asi que el resto de modulos se
// importan de forma dinamica (con el path ya fijado) para usar una BD en RAM.
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;

let db: SqliteDb;
let closeDatabase: () => void;
let persistWeeklyPlan: typeof import('./weekly-plan.js').persistWeeklyPlan;

function createUser(email: string): string {
  const id = `u-${email.split('@')[0]}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    'Tester',
    'hash'
  );
  return id;
}

const mealsOf = (userId: string) =>
  db
    .prepare(
      `SELECT m.date, m.meal_type, m.custom_meal, m.notes, m.completed, m.servings
       FROM meals m
       JOIN weekly_calendars c ON c.id = m.calendar_id
       WHERE c.user_id = ?
       ORDER BY m.date, m.meal_type`
    )
    .all(userId) as Array<{
    date: string;
    meal_type: string;
    custom_meal: string;
    notes: string | null;
    completed: number;
    servings: number;
  }>;

const calendarsOf = (userId: string) =>
  db
    .prepare('SELECT id, week_start, week_end, goals FROM weekly_calendars WHERE user_id = ?')
    .all(userId) as Array<{
    id: string;
    week_start: string;
    week_end: string;
    goals: string;
  }>;

/** Plan minimo: lunes y martes con desayuno/almuerzo/cena. */
const plan = (monday = '2026-09-14') => ({
  days: [
    {
      date: monday,
      meals: {
        breakfast: { name: 'Tostada con tomate', ingredients: ['pan', 'tomate'], time: 10 },
        lunch: { name: 'Lentejas', ingredients: ['lentejas', 'zanahoria'], time: 40 },
        dinner: { name: 'Merluza al horno', ingredients: ['merluza'], time: 25 }
      },
      totalCalories: 1500
    },
    {
      date: addISO(monday, 1),
      meals: {
        breakfast: 'Yogur con avena',
        lunch: { name: '', ingredients: [], time: 0 },
        dinner: { name: 'Crema de calabacín', ingredients: ['calabacín', 'patata'], time: 30 }
      },
      totalCalories: 1200
    }
  ],
  shoppingList: ['pan', 'tomate']
});

function addISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  persistWeeklyPlan = (await import('./weekly-plan.js')).persistWeeklyPlan;
});

afterAll(() => closeDatabase?.());

describe('persistWeeklyPlan', () => {
  it('crea el calendario de la semana y guarda las comidas del plan', () => {
    const user = createUser('plan@test');
    const result = persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      goals: { type: 'variety', caloriesTarget: 1900 },
      plan: plan()
    });

    // 5 comidas validas: la del almuerzo del martes no tiene nombre y se descarta
    expect(result.created).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.weekStart).toBe('2026-09-14');

    const calendars = calendarsOf(user);
    expect(calendars).toHaveLength(1);
    expect(calendars[0].week_start).toBe('2026-09-14');
    expect(calendars[0].week_end).toBe('2026-09-20');
    expect(JSON.parse(calendars[0].goals)).toMatchObject({ type: 'variety', dailyCalories: 1900 });

    const meals = mealsOf(user);
    expect(meals.map((meal) => `${meal.date}/${meal.meal_type}`)).toEqual([
      '2026-09-14/breakfast',
      '2026-09-14/dinner',
      '2026-09-14/lunch',
      '2026-09-15/breakfast',
      '2026-09-15/dinner'
    ]);
    // La IA no devuelve ids de receta: el plato se guarda escrito a mano, con
    // los ingredientes como nota para que se puedan revisar luego.
    expect(meals[0].custom_meal).toBe('Tostada con tomate');
    expect(meals[0].notes).toBe('Ingredientes: pan, tomate');
    // Un string suelto en lugar de objeto tambien vale
    expect(meals[3].custom_meal).toBe('Yogur con avena');
    expect(meals.every((meal) => meal.completed === 0)).toBe(true);
  });

  it('guarda las raciones del hogar para cada plato generado', () => {
    const user = createUser('plan-servings@test');
    persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-14',
      mealTypes: ['lunch'],
      servings: 3,
      plan: plan()
    });

    expect(mealsOf(user)).toHaveLength(1);
    expect(mealsOf(user)[0].servings).toBe(3);
  });

  it('no pisa lo que ya hay: rellena huecos y cuenta los omitidos', () => {
    const user = createUser('huecos@test');
    persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan()
    });

    // El usuario cambia su almuerzo del lunes por lo suyo
    db.prepare('UPDATE meals SET custom_meal = ? WHERE meal_type = ? AND date = ?').run(
      'Sopa de pescado',
      'lunch',
      '2026-09-14'
    );

    const again = persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan()
    });

    expect(again.created).toBe(0);
    expect(again.skipped).toBe(5);
    const lunch = mealsOf(user).find(
      (meal) => meal.meal_type === 'lunch' && meal.date === '2026-09-14'
    );
    expect(lunch?.custom_meal).toBe('Sopa de pescado');
    // Una sola pasada = un solo calendario, no uno por generacion
    expect(calendarsOf(user)).toHaveLength(1);
    expect(mealsOf(user)).toHaveLength(5);
  });

  it('descarta fechas fuera de la semana pedida y formatos raros', () => {
    const user = createUser('fuera@test');
    const result = persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: {
        days: [
          { date: '2026-09-13', meals: { lunch: { name: 'Antes de la semana' } } },
          { date: '2026-09-21', meals: { lunch: { name: 'Despues de la semana' } } },
          { date: 'no-existe', meals: { lunch: { name: 'Fecha inválida' } } },
          { date: '2026-09-16', meals: { lunch: { name: 'Correcto' } } }
        ]
      }
    });

    expect(result.created).toBe(1);
    expect(mealsOf(user).map((meal) => meal.custom_meal)).toEqual(['Correcto']);
  });

  it('no revienta con respuestas vacias o malformadas', () => {
    const user = createUser('vacio@test');
    for (const bad of [null, undefined, {}, { days: [] }, { days: 'no es array' }, []]) {
      expect(() =>
        persistWeeklyPlan(db, {
          userId: user,
          startDate: '2026-09-14',
          endDate: '2026-09-20',
          plan: bad
        })
      ).not.toThrow();
    }
    // No se crea un calendario vacio por el camino
    expect(calendarsOf(user)).toHaveLength(0);
  });

  it('ancla la semana en lunes aunque la pida empezando en otro dia', () => {
    const user = createUser('martes@test');
    // Miercoles de la misma semana => el plan va al calendario del lunes
    const result = persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-16',
      endDate: '2026-09-22',
      plan: { days: [{ date: '2026-09-16', meals: { dinner: { name: 'Tortilla' } } }] }
    });

    expect(result.weekStart).toBe('2026-09-14');
    expect(calendarsOf(user)[0].week_start).toBe('2026-09-14');
  });

  it('persiste objetivos plurales y texto libre junto a las metas nutricionales', () => {
    const user = createUser('multiple-goals@test');

    persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      goals: {
        types: ['weight-loss', 'variety'],
        customInstructions: 'Prioriza legumbres',
        caloriesTarget: 1850,
        restrictions: ['sin fritos']
      },
      plan: { days: [{ date: '2026-09-14', meals: { lunch: { name: 'Lentejas' } } }] }
    });

    const stored = JSON.parse(calendarsOf(user)[0].goals);
    expect(stored).toMatchObject({
      type: 'weight-loss',
      types: ['weight-loss', 'variety'],
      customInstructions: 'Prioriza legumbres',
      dailyCalories: 1850,
      restrictions: ['sin fritos']
    });
  });
});

/** Igual que `mealsOf`, pero con la hora: sirve para hablar del reloj sin romper las otras aserciones. */
const mealsWithTime = (userId: string) =>
  db
    .prepare(
      `SELECT m.date, m.meal_type, m.time
       FROM meals m
       JOIN weekly_calendars c ON c.id = m.calendar_id
       WHERE c.user_id = ?
       ORDER BY m.date, m.meal_type`
    )
    .all(userId) as Array<{ date: string; meal_type: string; time: string | null }>;

describe('persistWeeklyPlan y las comidas elegidas', () => {
  it('solo escribe las comidas que se pidieron', () => {
    const user = createUser('selection@test');

    const result = persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan(),
      mealTypes: ['lunch', 'dinner']
    });

    expect(result.created).toBe(3); // lunes: almuerzo y cena; martes: solo cena
    const types = new Set(mealsWithTime(user).map((meal) => meal.meal_type));
    expect(types).toEqual(new Set(['lunch', 'dinner']));
  });

  it('repetir un tipo o meter basura no duplica ni rompe', () => {
    const user = createUser('dedupe@test');

    const result = persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan(),
      mealTypes: ['dinner', 'dinner', 'postre']
    });

    expect(result.created).toBe(2);
    expect(new Set(mealsWithTime(user).map((meal) => meal.meal_type))).toEqual(new Set(['dinner']));
  });

  it('pedir todas (o ninguna) escribe las cuatro', () => {
    const empty = createUser('none@test');
    const all = createUser('all@test');

    const none = persistWeeklyPlan(db, {
      userId: empty,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan(),
      mealTypes: []
    });
    const every = persistWeeklyPlan(db, {
      userId: all,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan(),
      mealTypes: ['breakfast', 'lunch', 'snack', 'dinner']
    });

    // Lunes: desayuno, almuerzo y cena. Martes: desayuno y cena (el almuerzo viene sin nombre).
    // Y «todas» no puede inventar la merienda que la IA no ha escrito: 5 en los dos casos.
    expect(none.created).toBe(5);
    expect(every.created).toBe(5);
  });

  it('anota la hora de la casa en cada comida', () => {
    const user = createUser('hours@test');

    persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan(),
      mealTimes: { breakfast: '08:15', lunch: '14:45', snack: '17:00', dinner: '21:30' }
    });

    const rows = mealsWithTime(user);
    const timeOf = (type: string) => rows.find((row) => row.meal_type === type)?.time;
    expect(timeOf('breakfast')).toBe('08:15');
    expect(timeOf('lunch')).toBe('14:45');
    expect(timeOf('dinner')).toBe('21:30');
  });

  it('si la casa no tiene horas, el plan no inventa ninguna', () => {
    const user = createUser('nohours@test');

    persistWeeklyPlan(db, {
      userId: user,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      plan: plan()
    });

    expect(mealsWithTime(user).every((row) => row.time === null)).toBe(true);
  });
});

describe('resolveMealTypes', () => {
  it('sin selección están las cuatro, en orden del día', async () => {
    const { resolveMealTypes } = await import('./weekly-plan.js');

    expect(resolveMealTypes(undefined)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(resolveMealTypes([])).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(resolveMealTypes(['dinner', 'breakfast'])).toEqual(['breakfast', 'dinner']);
    expect(resolveMealTypes(['cena', 'lunch', 'lunch'])).toEqual(['lunch']);
  });

  it('una seleccion sin ninguna comida valida es el dia completo, no un plan vacio', async () => {
    // Un cliente viejo, un id renombrado o un json escrito a mano: «no entiendo nada» no puede
    // significar «no le pidas nada a la IA y no guardes nada», que es como se lee un array vacio aqui.
    const { resolveMealTypes } = await import('./weekly-plan.js');

    expect(resolveMealTypes(['cena', 'postre'])).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
  });
});
