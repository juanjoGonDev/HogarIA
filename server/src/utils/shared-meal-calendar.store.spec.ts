import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type SqliteDb = import('better-sqlite3').Database;

let db: SqliteDb;
let getDrizzle: typeof import('../config/database.js').getDrizzle;
let closeDatabase: () => void;
let persistSharedMeal: typeof import('./shared-meal-calendar.store.js').persistSharedMeal;
let persistSharedMeals: typeof import('./shared-meal-calendar.store.js').persistSharedMeals;
let SharedMealPersistenceError: typeof import('./shared-meal-calendar.store.js').SharedMealPersistenceError;

const householdId = 'shared-meal-home';
const input = {
  proposalId: 'proposal-shared-lunch-1',
  date: '2026-10-14',
  mealType: 'lunch' as const,
  customMeal: 'Guiso común',
  time: '13:30',
  servings: 5,
  participantIds: ['alice', 'bob']
};

const recipeSnapshot = {
  name: 'Arroz de prueba',
  description: 'Receta pública para el evento',
  baseServings: 1 as const,
  times: { prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 },
  ingredients: [{ name: 'arroz', quantity: 100, unit: 'g', notes: 'normal' }],
  instructions: ['Lavar el arroz', 'Cocerlo'],
  privatePrompt: 'no persistir este dato',
  personalGoal: 'no persistir este dato'
};

const generatedRecipe = {
  name: 'Crema de calabaza',
  description: 'Crema suave de calabaza con aceite de oliva.',
  difficulty: 'easy' as const,
  cuisine: 'española',
  totalTime: 35,
  prepTime: 10,
  cookTime: 25,
  restTime: null,
  baseServings: 1 as const,
  calories: 180,
  ingredients: [
    {
      name: 'calabaza',
      quantity: 300,
      unit: 'g',
      preparation: 'pelada y troceada',
      isOptional: false,
      substitutes: ['boniato'],
      notes: null
    }
  ],
  utensils: ['olla', 'batidora'],
  guidance: {
    appliances: ['vitrocerámica'],
    parallelTasks: ['Prepara el caldo mientras cuece la calabaza.'],
    tipsAndVariations: ['Añade pimienta al servir.'],
    batchCookingWarning: null
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Cuece la calabaza hasta que esté tierna.',
        duration: 20,
        tips: null,
        warning: null,
        illustration: null,
        temperature: null,
        timerRequired: false,
        timerDuration: null
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Cuece la calabaza en caldo y tritura.',
        duration: 25,
        tips: 'Tritura fuera del fuego.',
        warning: null,
        illustration: null,
        temperature: null,
        timerRequired: false,
        timerDuration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Cuece a fuego suave, emulsiona y ajusta la textura.',
        duration: 25,
        tips: null,
        warning: 'No llenes la batidora caliente por encima de la mitad.',
        illustration: null,
        temperature: { value: 80, unit: 'C' as const },
        timerRequired: true,
        timerDuration: 5
      }
    ]
  },
  nutrition: { calories: 180, protein: 4, carbs: 22, fat: 8, fiber: 5 },
  storage: {
    method: 'Refrigerar en recipiente cerrado.',
    duration: '3 días',
    reheatingInstructions: 'Calentar a fuego suave.',
    container: 'Recipiente hermético',
    freezingPossible: true,
    freezingDuration: '2 meses'
  },
  tags: ['vegetariana', 'sin gluten']
};

const generatedRecipeSnapshot = { ...generatedRecipe };

const recipeToCreate = {
  alias: 'N1',
  recipeId: 'recipe-planning-test-generated-1',
  recipe: generatedRecipe
};

function makeMember(
  userId: string,
  permissions: { calendar?: { view?: boolean; edit?: boolean } } = {
    calendar: { view: true, edit: true }
  },
  memberHouseholdId = householdId,
  isActive = 1
) {
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, `${userId}@hogaria.test`, userId, 'hash', memberHouseholdId);
  db.prepare(
    'INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    `member-${userId}`,
    memberHouseholdId,
    userId,
    'member',
    JSON.stringify(permissions),
    isActive
  );
}

describe('persistSharedMeal', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    getDrizzle = database.getDrizzle;
    closeDatabase = database.closeDatabase;
    const store = await import('./shared-meal-calendar.store.js');
    persistSharedMeal = store.persistSharedMeal;
    persistSharedMeals = store.persistSharedMeals;
    SharedMealPersistenceError = store.SharedMealPersistenceError;
  });

  afterAll(() => closeDatabase?.());

  beforeEach(() => {
    db.prepare('DELETE FROM meal_participants').run();
    db.prepare('DELETE FROM meals').run();
    db.prepare(
      "DELETE FROM recipes WHERE id LIKE 'recipe-planning-test-%' OR id = 'existing-planning-test-recipe'"
    ).run();
    db.prepare('DELETE FROM weekly_calendars').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    db.prepare(
      'INSERT INTO households (id, name, invite_code, share_calendar) VALUES (?, ?, ?, 0)'
    ).run(householdId, 'Casa de prueba', 'SHARE001');
    makeMember('alice');
    makeMember('bob');
    makeMember('carol');
  });

  it('persists complete long text in a legacy recipe snapshot', () => {
    const longText = 'Preparación culinaria detallada. '.repeat(100).trim();
    const longSnapshot = {
      ...recipeSnapshot,
      name: longText,
      description: longText,
      ingredients: [
        {
          name: longText,
          quantity: 1,
          unit: longText,
          preparation: longText,
          notes: longText,
          substitutes: [longText]
        }
      ],
      instructions: [longText]
    };

    const result = persistSharedMeal(db, 'alice', { ...input, recipeSnapshot: longSnapshot });

    const persisted = JSON.parse(result.meal.recipe_snapshot!);
    expect(persisted).toMatchObject({
      name: longText,
      description: longText,
      ingredients: [
        expect.objectContaining({
          name: longText,
          unit: longText,
          preparation: longText,
          notes: longText,
          substitutes: [longText]
        })
      ],
      instructions: [longText]
    });
    expect(persisted).not.toHaveProperty('privatePrompt');
  });

  it('confirma una comida compartida una vez y reintentos del mismo proposalId no duplican evento ni participantes', () => {
    const first = persistSharedMeal(db, 'alice', input);
    const retry = persistSharedMeal(db, 'alice', input);

    expect(first.meal.id).toBe(retry.meal.id);
    expect(first.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meals WHERE source_proposal_id = ?')
        .get(`${input.proposalId}:single`)
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare('SELECT user_id FROM meal_participants WHERE meal_id = ? ORDER BY user_id')
        .all(first.meal.id)
    ).toEqual([{ user_id: 'alice' }, { user_id: 'bob' }]);
    expect(first.meal.servings).toBe(5);
    expect(first.meal.notes).toBeNull();
  });

  it('no escribe si el hogar activo ya no coincide con el contexto capturado por la ruta', () => {
    const otherHouseholdId = 'other-meal-home';
    db.prepare(
      'INSERT INTO households (id, name, invite_code, share_calendar) VALUES (?, ?, ?, 0)'
    ).run(otherHouseholdId, 'Otra casa', 'OTHER001');
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(otherHouseholdId, 'alice');
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    ).run(
      'member-alice-other',
      otherHouseholdId,
      'alice',
      'member',
      JSON.stringify({ calendar: { view: true, edit: true } })
    );

    let failure: unknown;
    try {
      persistSharedMeals(db, 'alice', {
        proposalId: 'stale-household-proposal',
        expectedHouseholdId: householdId,
        events: [
          {
            eventId: 'event-lunch',
            date: '2026-10-14',
            mealType: 'lunch',
            customMeal: 'Guiso',
            servings: 1,
            participantIds: ['alice']
          }
        ]
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SharedMealPersistenceError);
    expect(failure).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get()).toEqual({
      count: 0
    });
  });

  it('expone los participantes asociados desde el modelo Drizzle sin duplicar la comida', async () => {
    persistSharedMeal(db, 'alice', input);
    const rows = (await (getDrizzle() as any).query.meals.findMany({
      with: { participants: true }
    })) as Array<{ participants: Array<{ userId: string }> }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].participants.map(({ userId }) => userId).sort()).toEqual(['alice', 'bob']);
  });

  it('declara en el modelo las columnas de idempotencia/snapshot y la clave compuesta de participantes', async () => {
    const schema = await import('../models/schema.js');
    const { getTableConfig } = await import('drizzle-orm/sqlite-core');
    const mealConfig = getTableConfig(schema.meals);
    const participantConfig = getTableConfig(schema.mealParticipants);

    expect(mealConfig.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['source_proposal_id', 'proposal_id', 'recipe_snapshot'])
    );
    expect(participantConfig.primaryKeys).toHaveLength(1);
    expect(participantConfig.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['meal_id', 'user_id'])
    );
    // Exercise Drizzle's lazy FK callbacks in this model file as part of the focused schema gate.
    for (const table of [
      schema.householdPlans,
      schema.householdPlanRevisions,
      schema.householdPlanAssignments,
      schema.householdTaskWeeks,
      schema.mealParticipants,
      schema.aiConfigs
    ]) {
      const config = getTableConfig(table);
      for (const foreignKey of config.foreignKeys) foreignKey.reference();
    }
  });

  it('no reutiliza una proposalId con contenido o participantes distintos y conserva el primer guardado', () => {
    const first = persistSharedMeal(db, 'alice', input);

    expect(() =>
      persistSharedMeal(db, 'alice', { ...input, servings: 6, participantIds: ['alice', 'carol'] })
    ).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT servings FROM meals WHERE id = ?').get(first.meal.id)).toEqual({
      servings: 5
    });
    expect(
      db
        .prepare('SELECT user_id FROM meal_participants WHERE meal_id = ? ORDER BY user_id')
        .all(first.meal.id)
    ).toEqual([{ user_id: 'alice' }, { user_id: 'bob' }]);
  });

  it('guarda solo el snapshot whitelisted, devuelve el objeto y considera el snapshot en la idempotencia', () => {
    const recipeCountBefore = (
      db.prepare('SELECT COUNT(*) AS count FROM recipes').get() as { count: number }
    ).count;
    const first = persistSharedMeal(db, 'alice', { ...input, recipeSnapshot });
    const stored = db
      .prepare('SELECT recipe_snapshot FROM meals WHERE id = ?')
      .get(first.meal.id) as {
      recipe_snapshot: string;
    };
    const safeSnapshot = {
      name: 'Arroz de prueba',
      description: 'Receta pública para el evento',
      baseServings: 1,
      times: { prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 },
      ingredients: [{ name: 'arroz', quantity: 100, unit: 'g', notes: 'normal' }],
      instructions: ['Lavar el arroz', 'Cocerlo']
    };
    expect(JSON.parse(stored.recipe_snapshot)).toEqual(safeSnapshot);
    expect(first.meal.recipe_snapshot).toEqual(JSON.stringify(safeSnapshot));
    expect(first.meal.recipe_id).toBeNull();
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM recipes').get() as { count: number }).count
    ).toBe(recipeCountBefore);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE name = ?').get('Arroz de prueba')
    ).toEqual({ count: 0 });
    expect(persistSharedMeal(db, 'alice', { ...input, recipeSnapshot }).idempotent).toBe(true);
    expect(() =>
      persistSharedMeal(db, 'alice', {
        ...input,
        recipeSnapshot: { ...recipeSnapshot, instructions: ['contenido distinto'] }
      })
    ).toThrowError(SharedMealPersistenceError);
  });

  it('confirma de forma atómica un lote con keys proposalId:eventId y rechaza el mismo lote si cambia', () => {
    const proposal = {
      proposalId: 'week-2026-10-12',
      events: [
        {
          eventId: 'event-lunch',
          date: '2026-10-14',
          mealType: 'lunch' as const,
          customMeal: 'Arroz',
          servings: 2,
          participantIds: ['alice', 'bob'],
          recipeSnapshot
        },
        {
          eventId: 'event-dinner',
          date: '2026-10-14',
          mealType: 'dinner' as const,
          customMeal: 'Sopa',
          servings: 1,
          participantIds: ['alice'],
          recipeSnapshot: null
        }
      ]
    };
    const first = persistSharedMeals(db, 'alice', proposal);
    const retry = persistSharedMeals(db, 'alice', proposal);

    expect(first.meals.map(({ source_proposal_id }) => source_proposal_id)).toEqual([
      'week-2026-10-12:event-lunch',
      'week-2026-10-12:event-dinner'
    ]);
    expect(retry.meals.map(({ id }) => id)).toEqual(first.meals.map(({ id }) => id));
    expect(first.idempotent).toBe(false);
    expect(retry.idempotent).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 2 });

    expect(() =>
      persistSharedMeals(db, 'alice', {
        ...proposal,
        events: [proposal.events[0]]
      })
    ).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 2 });
  });

  it('revierte un lote entero si un evento choca con otra propuesta para mismo participante/fecha/turno', () => {
    persistSharedMeals(db, 'alice', {
      proposalId: 'week-first',
      events: [
        {
          eventId: 'shared-lunch',
          date: '2026-10-14',
          mealType: 'lunch',
          customMeal: 'Guiso',
          servings: 2,
          participantIds: ['alice', 'bob']
        }
      ]
    });

    let conflict: unknown;
    try {
      persistSharedMeals(db, 'alice', {
        proposalId: 'week-second',
        events: [
          {
            eventId: 'non-conflicting-breakfast',
            date: '2026-10-14',
            mealType: 'breakfast',
            customMeal: 'Pan',
            servings: 1,
            participantIds: ['alice']
          },
          {
            eventId: 'conflicting-lunch',
            date: '2026-10-14',
            mealType: 'lunch',
            customMeal: 'Ensalada',
            servings: 1,
            participantIds: ['bob']
          }
        ]
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(SharedMealPersistenceError);
    expect(conflict).toMatchObject({ code: 'SLOT_CONFLICT' });

    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 1 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM meals WHERE meal_type = 'breakfast'").get()
    ).toEqual({
      count: 0
    });
  });

  it('rechaza colisiones de turno dentro del mismo lote, pero permite grupos disjuntos', () => {
    expect(() =>
      persistSharedMeals(db, 'alice', {
        proposalId: 'week-overlap',
        events: [
          {
            eventId: 'one',
            date: '2026-10-14',
            mealType: 'dinner',
            customMeal: 'Opción uno',
            servings: 1,
            participantIds: ['alice']
          },
          {
            eventId: 'two',
            date: '2026-10-14',
            mealType: 'dinner',
            customMeal: 'Opción dos',
            servings: 1,
            participantIds: ['alice', 'bob']
          }
        ]
      })
    ).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });

    const disjoint = persistSharedMeals(db, 'alice', {
      proposalId: 'week-disjoint',
      events: [
        {
          eventId: 'one',
          date: '2026-10-14',
          mealType: 'dinner',
          customMeal: 'Opción Alice',
          servings: 1,
          participantIds: ['alice']
        },
        {
          eventId: 'two',
          date: '2026-10-14',
          mealType: 'dinner',
          customMeal: 'Opción Bob',
          servings: 1,
          participantIds: ['bob']
        }
      ]
    });
    expect(disjoint.meals).toHaveLength(2);
  });

  it('admite lotes superiores a cien eventos sin volver cuadrática la validación de turnos', () => {
    const events = Array.from({ length: 101 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 9, 12 + index)).toISOString().slice(0, 10);
      return {
        eventId: `event-${index}`,
        date,
        mealType: 'lunch' as const,
        customMeal: `Comida ${index}`,
        servings: 1,
        participantIds: ['alice']
      };
    });

    const result = persistSharedMeals(db, 'alice', {
      proposalId: 'large-weekly-proposal',
      events
    });

    expect(result.meals).toHaveLength(101);
    expect(result.idempotent).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 101 });
  });

  it('exige calendar.edit al confirmante y calendar.view a cada participante antes de escribir', () => {
    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      JSON.stringify({ calendar: { view: true, edit: false } }),
      'alice'
    );
    expect(() => persistSharedMeal(db, 'alice', input)).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });

    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      JSON.stringify({ calendar: { view: false, edit: true } }),
      'bob'
    );
    expect(() => persistSharedMeal(db, 'alice', input)).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rechaza participantes inactivos o de otro hogar sin guardar parcialmente', () => {
    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run('bob');
    expect(() => persistSharedMeal(db, 'alice', input)).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });

    db.prepare('UPDATE household_members SET is_active = 1 WHERE user_id = ?').run('bob');
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'other-home',
      'Otra casa',
      'OTHER001'
    );
    makeMember('outsider', { calendar: { view: true, edit: true } }, 'other-home');
    expect(() =>
      persistSharedMeal(db, 'alice', { ...input, participantIds: ['alice', 'outsider'] })
    ).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rechaza datos de comida inválidos sin crear calendario ni comida', () => {
    expect(() => persistSharedMeal(db, 'alice', { ...input, date: '2026-02-30' })).toThrowError(
      SharedMealPersistenceError
    );
    expect(() => persistSharedMeal(db, 'alice', { ...input, servings: 0 })).toThrowError(
      SharedMealPersistenceError
    );
    expect(() => persistSharedMeal(db, 'alice', { ...input, time: '25:00' })).toThrowError(
      SharedMealPersistenceError
    );
    expect(() =>
      persistSharedMeal(db, 'alice', { ...input, participantIds: ['alice', 'alice'] })
    ).toThrowError(SharedMealPersistenceError);
    expect(() =>
      persistSharedMeal(db, 'alice', { ...input, recipeId: 42 as unknown as string })
    ).toThrowError(SharedMealPersistenceError);
    expect(() =>
      persistSharedMeal(db, 'alice', {
        ...input,
        recipeSnapshot: { ...recipeSnapshot, baseServings: 2 }
      })
    ).toThrowError(SharedMealPersistenceError);
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get()).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('guarda las recetas nuevas como privadas, conserva todos sus niveles y enlaza la comida', () => {
    const result = persistSharedMeals(db, 'alice', {
      proposalId: 'proposal-generated-recipe',
      recipesToCreate: [recipeToCreate],
      events: [
        {
          eventId: 'crema-lunch',
          date: '2026-10-14',
          mealType: 'lunch',
          recipeId: recipeToCreate.recipeId,
          customMeal: generatedRecipe.name,
          servings: 2,
          participantIds: ['alice', 'bob'],
          recipeSnapshot: generatedRecipeSnapshot
        }
      ]
    });

    const saved = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeToCreate.recipeId) as
      Record<string, unknown> | undefined;
    expect(saved).toMatchObject({
      id: recipeToCreate.recipeId,
      name: generatedRecipe.name,
      difficulty: 'easy',
      cuisine: 'española',
      total_time: 35,
      prep_time: 10,
      cook_time: 25,
      rest_time: null,
      servings: 1,
      calories: 180,
      author: 'ai',
      author_id: 'alice',
      is_public: 0
    });
    expect(JSON.parse(saved!.ingredients as string)).toEqual(generatedRecipe.ingredients);
    expect(JSON.parse(saved!.utensils as string)).toEqual(generatedRecipe.utensils);
    expect(JSON.parse(saved!.steps as string)).toEqual(generatedRecipe.instructionsByLevel);
    expect(JSON.parse(saved!.recipe_guidance as string)).toEqual(generatedRecipe.guidance);
    expect(JSON.parse(saved!.nutrition as string)).toEqual(generatedRecipe.nutrition);
    expect(JSON.parse(saved!.storage as string)).toEqual({
      method: 'Refrigerar en recipiente cerrado.',
      duration: '3 días',
      reheatingInstructions: 'Calentar a fuego suave.',
      container: 'Recipiente hermético',
      freezingPossible: true,
      freezingDuration: '2 meses'
    });
    expect(JSON.parse(saved!.tags as string)).toEqual(generatedRecipe.tags);
    expect(saved!.meal_type).toBe('[]');
    expect(saved!.image).toBeNull();
    expect(result.meals[0].recipe_id).toBe(recipeToCreate.recipeId);
    expect(JSON.parse(result.meals[0].recipe_snapshot!)).toEqual(generatedRecipeSnapshot);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meal_participants WHERE meal_id = ?')
        .get(result.meals[0].id)
    ).toEqual({ count: 2 });
    expect(result.idempotent).toBe(false);
  });

  it('reintenta la misma propuesta sin duplicar recetas y rechaza contenido o propietario alterado', () => {
    const proposal = {
      proposalId: 'proposal-generated-recipe-retry',
      recipesToCreate: [recipeToCreate],
      events: [
        {
          eventId: 'crema-lunch',
          date: '2026-10-14',
          mealType: 'lunch' as const,
          recipeId: recipeToCreate.recipeId,
          customMeal: generatedRecipe.name,
          servings: 2,
          participantIds: ['alice', 'bob'],
          recipeSnapshot: generatedRecipeSnapshot
        }
      ]
    };
    const first = persistSharedMeals(db, 'alice', proposal);
    const retry = persistSharedMeals(db, 'alice', proposal);

    expect(retry.idempotent).toBe(true);
    expect(retry.meals[0].id).toBe(first.meals[0].id);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE id = ?').get(recipeToCreate.recipeId)
    ).toEqual({
      count: 1
    });
    expect(() =>
      persistSharedMeals(db, 'alice', {
        ...proposal,
        recipesToCreate: [
          { ...recipeToCreate, recipe: { ...generatedRecipe, description: 'Contenido cambiado.' } }
        ]
      })
    ).toThrowError(SharedMealPersistenceError);

    db.prepare('UPDATE recipes SET author_id = ? WHERE id = ?').run('bob', recipeToCreate.recipeId);
    expect(() => persistSharedMeals(db, 'alice', proposal)).toThrowError(
      SharedMealPersistenceError
    );
  });

  it('revierte receta, calendario, comida y participantes si falla la escritura de la comida', () => {
    db.exec(`
      CREATE TEMP TRIGGER fail_shared_meal_insert
      BEFORE INSERT ON meals
      WHEN NEW.custom_meal = 'FALLA DE PRUEBA'
      BEGIN SELECT RAISE(ABORT, 'synthetic meal insert failure'); END;
    `);

    try {
      expect(() =>
        persistSharedMeals(db, 'alice', {
          proposalId: 'proposal-atomic-generated-recipe',
          recipesToCreate: [recipeToCreate],
          events: [
            {
              eventId: 'fail-lunch',
              date: '2026-10-14',
              mealType: 'lunch',
              recipeId: recipeToCreate.recipeId,
              customMeal: 'FALLA DE PRUEBA',
              servings: 2,
              participantIds: ['alice'],
              recipeSnapshot: generatedRecipeSnapshot
            }
          ]
        })
      ).toThrow(/synthetic meal insert failure/);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS fail_shared_meal_insert');
    }

    expect(
      db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE id = ?').get(recipeToCreate.recipeId)
    ).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_participants').get()).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get()).toEqual({
      count: 0
    });
  });

  it('rechaza candidatas inválidas o snapshots inconsistentes antes de cualquier escritura', () => {
    const event = {
      eventId: 'invalid-lunch',
      date: '2026-10-14',
      mealType: 'lunch' as const,
      recipeId: recipeToCreate.recipeId,
      customMeal: generatedRecipe.name,
      servings: 1,
      participantIds: ['alice'],
      recipeSnapshot: generatedRecipeSnapshot
    };
    expect(() =>
      persistSharedMeals(db, 'alice', {
        proposalId: 'proposal-invalid-generated-recipe',
        recipesToCreate: [
          { ...recipeToCreate, recipe: { ...generatedRecipe, instructionsByLevel: { basic: [] } } }
        ],
        events: [event]
      })
    ).toThrowError(SharedMealPersistenceError);
    expect(() =>
      persistSharedMeals(db, 'alice', {
        proposalId: 'proposal-inconsistent-generated-recipe',
        recipesToCreate: [recipeToCreate],
        events: [{ ...event, recipeSnapshot: { ...generatedRecipeSnapshot, name: 'Otra receta' } }]
      })
    ).toThrowError(SharedMealPersistenceError);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE id = ?').get(recipeToCreate.recipeId)
    ).toEqual({
      count: 0
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get()).toEqual({
      count: 0
    });
  });

  it('enlaza una receta existente sin duplicarla', () => {
    db.prepare(
      'INSERT INTO recipes (id, name, author, is_public, ingredients) VALUES (?, ?, ?, ?, ?)'
    ).run('existing-planning-test-recipe', 'Sopa existente', 'catalog', 1, '[]');
    const before = (db.prepare('SELECT COUNT(*) AS count FROM recipes').get() as { count: number })
      .count;

    const result = persistSharedMeals(db, 'alice', {
      proposalId: 'proposal-existing-recipe',
      events: [
        {
          eventId: 'existing-lunch',
          date: '2026-10-14',
          mealType: 'lunch',
          recipeId: 'existing-planning-test-recipe',
          servings: 2,
          participantIds: ['alice'],
          recipeSnapshot
        }
      ]
    });

    expect(result.meals[0].recipe_id).toBe('existing-planning-test-recipe');
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM recipes').get() as { count: number }).count
    ).toBe(before);
  });
});
