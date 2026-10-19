import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Perfil de gustos/alergias/objetivo: se guarda dentro del JSON
 * `users.preferences` sin pisar el resto de preferencias, y alimenta los
 * prompts de la IA.
 */

// DATABASE_PATH se lee al importar la config, asi que el resto de modulos se
// importan de forma dinamica (con el path ya fijado) para usar una BD en RAM.
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;
type Taste = typeof import('./taste-profile.js');

let db: SqliteDb;
let taste: Taste;
let closeDatabase: () => void;
let userSeq = 0;

function createUser(preferences?: string): string {
  const id = `taste-u-${userSeq++}`;
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, preferences) VALUES (?, ?, ?, ?, ?)'
  ).run(id, `${id}@test`, 'Tester', 'hash', preferences ?? '{}');
  return id;
}

function readPreferencesColumn(userId: string): Record<string, any> {
  const row = db.prepare('SELECT preferences FROM users WHERE id = ?').get(userId) as {
    preferences: string;
  };
  return JSON.parse(row.preferences);
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  taste = await import('./taste-profile.js');
});

afterAll(() => closeDatabase?.());

describe('saveTasteProfile', () => {
  it('devuelve el perfil por defecto a quien no ha contestado nada', () => {
    const user = createUser();

    const response = taste.readTasteResponse(db, user);

    expect(response.taste).toEqual({
      goals: ['balanced'],
      goalNotes: '',
      allergies: [],
      likes: [],
      dislikes: [],
      notes: ''
    });
    expect(response.onboarding.status).toBe('pending');
  });

  it('fusiona sin pisar tema, idioma o nivel de detalle', () => {
    const user = createUser(
      JSON.stringify({ theme: 'dark', language: 'es', detailLevel: 'expert' })
    );

    taste.saveTasteProfile(db, user, {
      taste: {
        goal: 'weight-loss',
        goalNotes: 'Cenas ligeras',
        allergies: ['Lactosa', 'Frutos secos'],
        likes: ['Legumbres'],
        dislikes: ['Vísceras'],
        notes: 'Ceno pronto'
      },
      onboardingStatus: 'done'
    });

    const stored = readPreferencesColumn(user);
    expect(stored.theme).toBe('dark');
    expect(stored.language).toBe('es');
    expect(stored.detailLevel).toBe('expert');
    expect(stored.taste.allergies).toEqual(['Lactosa', 'Frutos secos']);
    expect(stored.onboarding.status).toBe('done');
    expect(stored.onboarding.at).toBeTruthy();
  });

  it('un parche parcial no borra lo que ya estaba dicho', () => {
    const user = createUser();
    taste.saveTasteProfile(db, user, {
      taste: { allergies: ['Gluten'], likes: ['Pollo'] }
    });

    taste.saveTasteProfile(db, user, { taste: { goal: 'muscle-gain' } });

    const response = taste.readTasteResponse(db, user);
    expect(response.taste.allergies).toEqual(['Gluten']);
    expect(response.taste.likes).toEqual(['Pollo']);
    expect(response.taste.goals).toEqual(['muscle-gain']);
  });

  it('limpia duplicados, vacíos y objetivos desconocidos', () => {
    const user = createUser();

    taste.saveTasteProfile(db, user, {
      taste: {
        goal: 'dieta-de-3-dias' as never,
        allergies: ['  Lactosa ', 'Lactosa', '', '   ', 'Huevo']
      }
    });

    const response = taste.readTasteResponse(db, user);
    expect(response.taste.allergies).toEqual(['Lactosa', 'Huevo']);
    // Un valor que no está en el enum no se guarda: vuelve al por defecto
    expect(response.taste.goals).toEqual(['balanced']);
  });

  it('lee el objetivo singular antiguo como una lista, y al guardar migra al campo plural', () => {
    const user = createUser(
      JSON.stringify({ taste: { goal: 'weight-loss', goalNotes: 'Cenas ligeras' } })
    );

    expect(taste.readTasteResponse(db, user).taste.goals).toEqual(['weight-loss']);

    taste.saveTasteProfile(db, user, { taste: { goalNotes: 'Cena antes de las ocho' } });

    const stored = readPreferencesColumn(user).taste;
    expect(stored.goals).toEqual(['weight-loss']);
    expect(stored.goal).toBeUndefined();
    expect(taste.readTasteResponse(db, user).taste.goalNotes).toBe('Cena antes de las ocho');
  });

  it('guarda y lee varios objetivos sin duplicados y conserva el texto personalizado', () => {
    const user = createUser();

    const response = taste.saveTasteProfile(db, user, {
      taste: {
        goals: ['weight-loss', 'variety', 'weight-loss'],
        goalNotes: 'Más legumbres y cenas rápidas'
      }
    });

    expect(response.taste.goals).toEqual(['weight-loss', 'variety']);
    expect(taste.readTasteResponse(db, user).taste).toMatchObject({
      goals: ['weight-loss', 'variety'],
      goalNotes: 'Más legumbres y cenas rápidas'
    });
    expect(readPreferencesColumn(user).taste).toMatchObject({
      goals: ['weight-loss', 'variety'],
      goalNotes: 'Más legumbres y cenas rápidas'
    });
    expect(readPreferencesColumn(user).taste.goal).toBeUndefined();
  });

  it('una preferencia con JSON roto no rompe la lectura', () => {
    const user = createUser('{esto no es json');

    const response = taste.readTasteResponse(db, user);

    expect(response.taste.allergies).toEqual([]);
    expect(response.onboarding.status).toBe('pending');
  });
});

describe('perfil del hogar (nivel y módulos)', () => {
  function readCookingLevelColumn(userId: string): string | null {
    const row = db.prepare('SELECT cooking_level FROM users WHERE id = ?').get(userId) as {
      cooking_level: string | null;
    };
    return row.cooking_level;
  }

  it('quien no ha contestado nada está en beginner y sin módulos', () => {
    const user = createUser();

    expect(taste.readTasteResponse(db, user).profile).toEqual({
      cookingLevel: 'beginner',
      modules: []
    });
  });

  it('el nivel va a su columna y los módulos al JSON, sin tocar el resto', () => {
    const user = createUser(JSON.stringify({ theme: 'dark', language: 'en' }));

    taste.saveTasteProfile(db, user, {
      cookingLevel: 'none',
      modules: ['meals', 'shopping', 'receipts']
    });

    expect(readCookingLevelColumn(user)).toBe('none');
    const stored = readPreferencesColumn(user);
    expect(stored.theme).toBe('dark');
    expect(stored.language).toBe('en');
    expect(stored.profile.modules).toEqual(['meals', 'shopping', 'receipts']);

    const response = taste.readTasteResponse(db, user);
    expect(response.profile.cookingLevel).toBe('none');
    expect(response.profile.modules).toEqual(['meals', 'shopping', 'receipts']);
  });

  it('cambiar el nivel no borra los módulos y viceversa', () => {
    const user = createUser();
    taste.saveTasteProfile(db, user, { modules: ['pantry'] });
    taste.saveTasteProfile(db, user, { cookingLevel: 'expert' });
    taste.saveTasteProfile(db, user, { taste: { notes: 'Cocino los domingos' } });

    const response = taste.readTasteResponse(db, user);
    expect(response.profile.modules).toEqual(['pantry']);
    expect(response.profile.cookingLevel).toBe('expert');
    expect(response.taste.notes).toBe('Cocino los domingos');
  });

  it('al leer se descartan módulos inventados y duplicados', () => {
    const user = createUser();

    taste.saveTasteProfile(db, user, {
      modules: ['meals', 'meals', 'invento-del-cliente'] as never
    });

    expect(taste.readTasteResponse(db, user).profile.modules).toEqual(['meals']);
  });

  it('un nivel ilegible en la base de datos no rompe la lectura', () => {
    const user = createUser();
    db.prepare('UPDATE users SET cooking_level = ? WHERE id = ?').run('chefa', user);

    expect(taste.readTasteResponse(db, user).profile.cookingLevel).toBe('beginner');
    expect(taste.readCookingLevel(db, user)).toBe('beginner');
  });

  it('el nivel decide cuánto explica la IA cuando la UI no pide nada', () => {
    expect(taste.detailLevelForCookingLevel('none')).toBe('basic');
    expect(taste.detailLevelForCookingLevel('beginner')).toBe('basic');
    expect(taste.detailLevelForCookingLevel('intermediate')).toBe('intermediate');
    expect(taste.detailLevelForCookingLevel('expert')).toBe('expert');
    expect(taste.detailLevelForCookingLevel(undefined)).toBe('basic');
  });
});

describe('horarios de las comidas', () => {
  it('quien no ha dicho nada come a las horas de la casa', () => {
    const user = createUser();

    expect(taste.readMealTimes(db, user)).toEqual({
      breakfast: '09:00',
      lunch: '14:00',
      snack: '17:00',
      dinner: '20:30'
    });
    expect(taste.readTasteResponse(db, user).mealTimes).toEqual(taste.MEAL_TIME_DEFAULTS);
  });

  it('guardar solo la cena deja las otras tres intactas', () => {
    const user = createUser();

    const response = taste.saveTasteProfile(db, user, { mealTimes: { dinner: '22:15' } });

    expect(response.mealTimes).toEqual({ ...taste.MEAL_TIME_DEFAULTS, dinner: '22:15' });
    // Y de verdad persistida: otra lectura, otra vez la misma hora.
    expect(taste.readMealTimes(db, user).dinner).toBe('22:15');
    expect(readPreferencesColumn(user).mealTimes).toEqual({ dinner: '22:15' });
  });

  it('vaciar una casilla quita el horario, no escribe una hora en blanco', () => {
    const user = createUser();
    taste.saveTasteProfile(db, user, { mealTimes: { breakfast: '07:30', lunch: '13:00' } });

    // El formulario manda '' al vaciar: debe significar «vuelve al defecto».
    const response = taste.saveTasteProfile(db, user, { mealTimes: { breakfast: '' } });

    expect(response.mealTimes.breakfast).toBe(taste.MEAL_TIME_DEFAULTS.breakfast);
    expect(response.mealTimes.lunch).toBe('13:00');
    expect(readPreferencesColumn(user).mealTimes).toEqual({ lunch: '13:00' });
  });

  it('no guarda «no tengo hora de cenar» como una fila suelta', () => {
    const user = createUser();

    // Mandar las cuatro null (borrón y cuenta nueva) deja el perfil sin horarios: las horas
    // «en blanco» en la API son las de defecto, y el json no acumula claves null.
    const response = taste.saveTasteProfile(db, user, {
      mealTimes: { breakfast: null, lunch: null, snack: null, dinner: null }
    });

    expect(response.mealTimes).toEqual(taste.MEAL_TIME_DEFAULTS);
    expect(readPreferencesColumn(user).mealTimes).toEqual({});
  });

  it('un horario imposible en el JSON no rompe la lectura', () => {
    const user = createUser(JSON.stringify({ mealTimes: { lunch: 'a comer', dinner: '25:70' } }));

    expect(taste.readMealTimes(db, user)).toEqual({
      ...taste.MEAL_TIME_DEFAULTS,
      lunch: taste.MEAL_TIME_DEFAULTS.lunch
    });
  });

  it('sin decir nada, la IA planifica las cuatro comidas', () => {
    const user = createUser();

    expect(taste.readTasteResponse(db, user).mealPlan).toEqual(taste.MEAL_PLAN_DEFAULTS);
    expect(taste.plannedMealTypes(taste.MEAL_PLAN_DEFAULTS)).toEqual([
      'breakfast',
      'lunch',
      'snack',
      'dinner'
    ]);
  });

  it('bloquear la merienda deja las otras tres como estaban', () => {
    const user = createUser();

    const response = taste.saveTasteProfile(db, user, { mealPlan: { snack: false } });

    expect(response.mealPlan).toEqual({ breakfast: true, lunch: true, snack: false, dinner: true });
    expect(taste.plannedMealTypes(taste.readMealPlan(db, user))).toEqual([
      'breakfast',
      'lunch',
      'dinner'
    ]);
    // Persistido de verdad, y sin que el bloqueo se cuele en las horas (son dos claves del mismo JSON).
    expect(readPreferencesColumn(user).mealPlan).toEqual({ snack: false });
    expect(readPreferencesColumn(user).mealTimes).toBeUndefined();
  });

  it('volver a desbloquear es escribir true, y null deja el permiso en su defecto', () => {
    const user = createUser();
    taste.saveTasteProfile(db, user, { mealPlan: { snack: false, dinner: false } });

    const response = taste.saveTasteProfile(db, user, { mealPlan: { snack: null } });

    expect(response.mealPlan).toEqual({ breakfast: true, lunch: true, snack: true, dinner: false });
    expect(readPreferencesColumn(user).mealPlan).toEqual({ dinner: false });
  });

  it('`mealPlan: null` quita el permiso entero, que es volver a dejarlo todo en manos de la IA', () => {
    // El tri-estado prometido: clave ausente no se toca, booleano escribe, `null` BORRA. Sin esto, quien
    // llama por API con `mealPlan: null` se queda con los bloqueos anteriores para siempre.
    const user = createUser();
    taste.saveTasteProfile(db, user, { mealPlan: { snack: false, dinner: false } });

    const response = taste.saveTasteProfile(db, user, { mealPlan: null });

    expect(response.mealPlan).toEqual(taste.MEAL_PLAN_DEFAULTS);
    expect(readPreferencesColumn(user).mealPlan).toBeUndefined();
  });

  it('lo mismo con las horas: `mealTimes: null` limpia la clave, no borra el desayuno a medias', () => {
    const user = createUser();
    taste.saveTasteProfile(db, user, { mealTimes: { lunch: '13:15' } });

    const response = taste.saveTasteProfile(db, user, { mealTimes: null });

    expect(response.mealTimes).toEqual(taste.MEAL_TIME_DEFAULTS);
    expect(readPreferencesColumn(user).mealTimes).toBeUndefined();
  });

  it('un permiso imposible en el JSON no rompe la lectura', () => {
    const user = createUser(
      JSON.stringify({ mealPlan: { lunch: 'a comer', dinner: 0, snack: false } })
    );

    expect(taste.readMealPlan(db, user)).toEqual({
      breakfast: true,
      lunch: true,
      snack: false,
      dinner: true
    });
  });

  it('el prompt lleva las cuatro horas de la casa', () => {
    const lines = taste.mealTimesPromptLines({
      breakfast: '08:00',
      lunch: '14:30',
      snack: '17:00',
      dinner: '21:45'
    });

    expect(lines).toContain('desayuno a las 08:00');
    expect(lines).toContain('cena a las 21:45');
    expect(lines).toContain('almuerzo a las 14:30');
    expect(lines).toContain('merienda a las 17:00');
  });
});

describe('tastePromptLines', () => {
  it('no escribe nada para un perfil vacío', () => {
    const empty = taste.emptyTasteProfile();

    expect(taste.hasTasteProfile(empty)).toBe(false);
    expect(taste.tastePromptLines(empty)).toBe('');
  });

  it('prioriza las alergias y arrastra el objetivo y las notas', () => {
    const lines = taste
      .tastePromptLines({
        goals: ['weight-loss'],
        goalNotes: 'sin fritos',
        allergies: ['Lactosa'],
        likes: ['Verduras'],
        dislikes: ['Marisco'],
        notes: 'Ceno a las 21:00'
      })
      .split('\n');

    expect(lines[0]).toContain('Alergias e intolerancias');
    expect(lines[0]).toContain('Lactosa');
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('Verduras')]));
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('Marisco')]));
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('Perder peso')]));
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('sin fritos')]));
    expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('Ceno a las 21:00')]));
  });

  it('con objetivo personalizado usa el texto libre como objetivo', () => {
    const block = taste.tastePromptLines({
      ...taste.emptyTasteProfile(),
      goals: ['custom'],
      goalNotes: 'Sin carne los lunes y cenas de una olla'
    });

    expect(block).toContain('Objetivo del comensal: Sin carne los lunes');
    expect(block).not.toContain('Personalizada');
  });

  it('redacta a la IA varios objetivos guardados y sus instrucciones una sola vez', () => {
    const block = taste.tastePromptLines({
      ...taste.emptyTasteProfile(),
      goals: ['weight-loss', 'muscle-gain', 'custom'],
      goalNotes: 'Evitar fritos, priorizar legumbres'
    });

    expect(block).toContain('Objetivos del comensal: Perder peso, Ganar músculo');
    expect(block).toContain('Evitar fritos, priorizar legumbres');
    expect(block).not.toContain('Personalizada');
  });
});
