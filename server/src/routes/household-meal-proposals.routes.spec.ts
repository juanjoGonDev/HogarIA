import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadableStream } from 'node:stream/web';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createMealProposalResponseFormat } from '../schemas/household-meal-proposal.schema.js';
import { HOUSEHOLD_MEAL_PLANNING_CONTEXT_FILENAME } from '../utils/household-meal-planning-context-attachment.js';
import { HOUSEHOLD_RECIPE_CATALOG_FILENAME } from '../utils/household-meal-recipe-catalog-attachment.js';
import type { HouseholdMealProposalProvider } from './household-meal-proposals.routes.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type User = { id: string; token: string; membershipId: string };
type ApiResponse = { success: boolean; code?: string; data?: any };

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let jwtSecret = '';

const WEEK_START = '2026-10-12';

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function generatedRecipe(name = 'Arroz con verduras') {
  const step = (instruction: string) => ({
    stepNumber: 1,
    instruction,
    duration: null,
    temperature: null,
    timerRequired: false,
    timerDuration: null,
    tips: null,
    warning: null,
    illustration: null
  });
  return {
    name,
    description: 'Plato de prueba',
    difficulty: 'easy',
    cuisine: 'española',
    totalTime: 35,
    prepTime: 10,
    cookTime: 25,
    restTime: null,
    baseServings: 1,
    calories: 350,
    ingredients: [
      {
        name: 'arroz',
        quantity: 80,
        unit: 'g',
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    utensils: ['olla'],
    guidance: {
      appliances: [],
      parallelTasks: [],
      tipsAndVariations: [],
      batchCookingWarning: null
    },
    instructionsByLevel: {
      basic: [step('Cocina el arroz.')],
      intermediate: [step('Sofríe las verduras y cocina el arroz.')],
      expert: [step('Controla el punto del arroz antes de servir.')]
    },
    nutrition: { calories: 350, protein: 8, carbs: 65, fat: 7, fiber: 3 },
    storage: {
      method: 'Refrigerar',
      duration: '3 días',
      reheatingInstructions: 'Calentar completamente.',
      container: 'Recipiente cerrado',
      freezingPossible: true,
      freezingDuration: '2 meses'
    },
    tags: ['almuerzo']
  };
}

function validProposal(aliases: string[] = ['P1', 'P2']) {
  return {
    newRecipes: [{ alias: 'N1', recipe: generatedRecipe() }],
    events: Array.from({ length: 7 }, (_, index) => ({
      date: addDays(WEEK_START, index),
      mealType: 'lunch',
      time: '13:00',
      recipeAlias: 'N1',
      participantAliases: aliases,
      servings: aliases.length,
      objectiveSummary: 'Comida equilibrada para el grupo.',
      status: 'scheduled',
      reason: null
    }))
  };
}

function individuallyAssignedProposal() {
  const one = generatedRecipe('Plato de P1');
  const two = generatedRecipe('Plato de P2');
  return {
    newRecipes: [
      { alias: 'N1', recipe: one },
      { alias: 'N2', recipe: two }
    ],
    events: validProposal().events.flatMap((event) =>
      (['P1', 'P2'] as const).map((alias) => ({
        ...event,
        recipeAlias: alias === 'P1' ? 'N1' : 'N2',
        participantAliases: [alias],
        servings: 1,
        objectiveSummary:
          alias === 'P1'
            ? 'Plato compatible con el objetivo weight-loss.'
            : 'Plato compatible con el objetivo muscle-gain.'
      }))
    )
  };
}

describe('household meal proposal preview route', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { householdMealProposalRoutes } = await import('./household-meal-proposals.routes.js');
    const { config } = await import('../config/app.config.js');
    await database.initializeDatabase();
    closeDatabase = database.closeDatabase;
    db = database.getDatabase();
    app = new Hono();
    app.route('/api/household', householdMealProposalRoutes);
    app.onError((error, context) => context.json({ success: false, message: error.message }, 500));
    jwtSecret = config.auth.jwtSecret;
  });

  afterAll(async () => {
    const { stopWorker } = await import('../utils/ticket-queue.js');
    stopWorker();
    closeDatabase();
  });

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    db.prepare('DELETE FROM ai_jobs').run();
    db.prepare('DELETE FROM ai_configs').run();
    db.prepare('DELETE FROM meal_participants').run();
    db.prepare('DELETE FROM meals').run();
    db.prepare('DELETE FROM weekly_calendars').run();
    db.prepare('DELETE FROM ingredients').run();
    db.prepare('DELETE FROM utensils').run();
    db.prepare('DELETE FROM recipes').run();
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
  });

  function addHousehold(id: string, sharedPantry = true) {
    db.prepare(
      `INSERT INTO households (id, name, invite_code, shared_pantry, meal_planning_preferences)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      id,
      id,
      `INVITE-${id}`,
      sharedPantry ? 1 : 0,
      JSON.stringify({
        objective: { goals: ['balanced'], notes: '' },
        mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
        mealTimes: { breakfast: '08:00', lunch: '13:00', snack: '17:00', dinner: '20:00' }
      })
    );
  }

  function addUser(
    id: string,
    householdId: string,
    permissions: unknown = { calendar: { view: true, edit: true } },
    taste: Record<string, unknown> = {
      goals: ['balanced'],
      goalNotes: '',
      allergies: [],
      likes: [],
      dislikes: []
    }
  ): User {
    const membershipId = `membership-${id}`;
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, household_id, preferences)
       VALUES (?, ?, ?, 'synthetic-hash', ?, ?)`
    ).run(id, `${id}@hogaria.test`, `Private name ${id}`, householdId, JSON.stringify({ taste }));
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      membershipId,
      householdId,
      id,
      id === 'planner' ? 'admin' : 'member',
      JSON.stringify(permissions)
    );
    return {
      id,
      membershipId,
      token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
    };
  }

  function addAiConfig(userId: string, householdId: string) {
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, household_id, name, provider, base_url, api_key, model,
         timeout, retry_attempts, concurrency, is_active)
       VALUES (?, ?, ?, 'Synthetic planner', 'custom', 'https://provider.invalid/v1',
         'synthetic-secret', 'test-model', 2000, 0, 0, 1)`
    ).run(`ai-${householdId}`, userId, householdId);
  }

  function setGoalOverride(user: User) {
    db.prepare('UPDATE household_members SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify({ goalOverrideEnabled: true }),
      user.membershipId
    );
  }

  function addIngredient(
    id: string,
    ownerId: string,
    name: string,
    householdId: string | null = null,
    quantity = 1
  ) {
    db.prepare(
      `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
       VALUES (?, ?, ?, ?, 'other', ?, 'ud')`
    ).run(id, ownerId, householdId, name, quantity);
  }

  function addUtensil(
    id: string,
    ownerId: string,
    name: string,
    category: string,
    householdId: string | null = null,
    available = true
  ) {
    db.prepare(
      `INSERT INTO utensils (id, user_id, household_id, name, category, available)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, ownerId, householdId, name, category, available ? 1 : 0);
  }

  function addRecipe(
    id: string,
    authorId: string,
    name: string,
    ingredients: unknown,
    isPublic = false
  ) {
    db.prepare(
      `INSERT INTO recipes (id, author_id, name, description, ingredients, is_public)
       VALUES (?, ?, ?, 'synthetic recipe', ?, ?)`
    ).run(id, authorId, name, JSON.stringify(ingredients), isPublic ? 1 : 0);
  }

  function addCanonicalRecipe(id: string, authorId: string, recipe = generatedRecipe()) {
    db.prepare(
      `INSERT INTO recipes
        (id, author_id, name, description, difficulty, cuisine, meal_type, total_time, prep_time,
         cook_time, rest_time, servings, calories, ingredients, utensils, steps, recipe_guidance,
         nutrition, storage, tags, is_public)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
      id,
      authorId,
      recipe.name,
      recipe.description,
      recipe.difficulty,
      recipe.cuisine,
      recipe.totalTime,
      recipe.prepTime,
      recipe.cookTime,
      recipe.restTime,
      recipe.baseServings,
      recipe.calories,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.utensils),
      JSON.stringify(recipe.instructionsByLevel),
      JSON.stringify(recipe.guidance),
      JSON.stringify(recipe.nutrition),
      JSON.stringify(recipe.storage),
      JSON.stringify(recipe.tags)
    );
  }

  function call(user: User, body: unknown, householdId = 'home') {
    return app.request('/api/household/meal-planning/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        'x-household-id': householdId
      },
      body: JSON.stringify(body)
    });
  }

  function callRaw(user: User, body: string) {
    return app.request('/api/household/meal-planning/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        'x-household-id': 'home'
      },
      body
    });
  }

  function callConfirm(user: User, body: unknown, householdId = 'home') {
    return app.request('/api/household/meal-planning/confirm', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        'x-household-id': householdId
      },
      body: JSON.stringify(body)
    });
  }

  function callConfirmRaw(user: User, body: string, householdId = 'home') {
    return app.request('/api/household/meal-planning/confirm', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        'x-household-id': householdId
      },
      body
    });
  }

  async function read(response: Response): Promise<ApiResponse> {
    return (await response.json()) as ApiResponse;
  }

  function readProviderFile(providerBody: any, filename: string): Record<string, any> {
    const content = providerBody.messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    const fileParts = content.filter((part: any) => part.type === 'file');
    expect(fileParts).toHaveLength(2);
    expect(fileParts.map((part: any) => part.file.filename)).toEqual([
      HOUSEHOLD_MEAL_PLANNING_CONTEXT_FILENAME,
      HOUSEHOLD_RECIPE_CATALOG_FILENAME
    ]);
    expect(
      fileParts.every((part: any) =>
        part.file.file_data.startsWith('data:application/json;base64,')
      )
    ).toBe(true);
    const filePart = fileParts.find((part: any) => part.file.filename === filename);
    expect(filePart).toBeDefined();
    const base64 = filePart.file.file_data.slice('data:application/json;base64,'.length);
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as Record<string, any>;
  }

  function readProviderMealContext(providerBody: any): Record<string, any> {
    return readProviderFile(providerBody, HOUSEHOLD_MEAL_PLANNING_CONTEXT_FILENAME);
  }

  function readProviderRecipeCatalog(providerBody: any): Record<string, any> {
    return readProviderFile(providerBody, HOUSEHOLD_RECIPE_CATALOG_FILENAME);
  }

  function readProviderPrompt(providerBody: any): string {
    return providerBody.messages[1].content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('\n');
  }

  it('returns a private, validated preview with strict JSON schema and no calendar writes', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const second = addUser(
      'second',
      'home',
      { calendar: { edit: false, view: true } },
      {
        goals: ['balanced'],
        goalNotes: '',
        allergies: [],
        likes: ['calabacín'],
        dislikes: []
      }
    );
    const excluded = addUser(
      'excluded',
      'home',
      { calendar: { edit: false } },
      {
        goals: ['balanced'],
        goalNotes: 'DO_NOT_SEND_PRIVATE_NOTE',
        allergies: ['tree-nut'],
        likes: ['DO_NOT_SEND_PRIVATE_LIKE'],
        dislikes: []
      }
    );
    addAiConfig(planner.id, 'home');

    let providerBody: any;
    const provider = vi.fn(async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
          ]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', provider);

    const mealsBefore = db.prepare('SELECT COUNT(*) AS count FROM meals').get();
    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, second.membershipId]
    });
    const json = await read(response);
    const serializedProviderRequest = JSON.stringify(providerBody);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(json).toMatchObject({
      success: true,
      data: {
        weekStart: WEEK_START,
        participants: [
          { alias: 'P1', householdMemberId: planner.membershipId },
          { alias: 'P2', householdMemberId: second.membershipId }
        ]
      }
    });
    expect(json.data.events[0]).toMatchObject({
      date: WEEK_START,
      participantIds: [planner.id, second.id],
      servings: 2
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(providerBody.response_format).toEqual(createMealProposalResponseFormat());
    expect(JSON.stringify(readProviderMealContext(providerBody))).toContain('calabacín');
    expect(serializedProviderRequest).not.toContain(planner.membershipId);
    expect(serializedProviderRequest).not.toContain(second.membershipId);
    expect(serializedProviderRequest).not.toContain(excluded.membershipId);
    expect(serializedProviderRequest).not.toContain('Private name');
    expect(serializedProviderRequest).not.toContain('planner@hogaria.test');
    expect(serializedProviderRequest).not.toContain('DO_NOT_SEND_PRIVATE');
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual(mealsBefore);
    expect(db.prepare('SELECT COUNT(*) AS count FROM calendar_events').get()).toEqual({ count: 0 });
  });

  it('blocks an enabled personal goal override without an explicit valid goal before AI access', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home', undefined, {});
    setGoalOverride(planner);
    addAiConfig(planner.id, 'home');
    const provider = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', provider);
    const before = {
      meals: db.prepare('SELECT COUNT(*) AS count FROM meals').get(),
      calendars: db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get(),
      aiJobs: db.prepare('SELECT COUNT(*) AS count FROM ai_jobs').get(),
      householdPreferences: db
        .prepare('SELECT meal_planning_preferences FROM households WHERE id = ?')
        .get('home'),
      memberPreferences: db
        .prepare('SELECT meal_planning_preferences FROM household_members WHERE id = ?')
        .get(planner.membershipId)
    };

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(provider).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(await read(response)).toMatchObject({
      success: false,
      code: 'MEAL_PLAN_OVERRIDE_INCOMPLETE',
      missingFields: ['objective']
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual(before.meals);
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get()).toEqual(
      before.calendars
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM ai_jobs').get()).toEqual(before.aiJobs);
    expect(
      db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home')
    ).toEqual(before.householdPreferences);
    expect(
      db
        .prepare('SELECT meal_planning_preferences FROM household_members WHERE id = ?')
        .get(planner.membershipId)
    ).toEqual(before.memberPreferences);
  });

  it('blocks an enabled personal schedule override without an explicit valid schedule before AI access', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    db.prepare('UPDATE household_members SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify({ scheduleOverrideEnabled: true }),
      planner.membershipId
    );
    addAiConfig(planner.id, 'home');
    const provider = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', provider);
    const before = {
      meals: db.prepare('SELECT COUNT(*) AS count FROM meals').get(),
      calendars: db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get(),
      aiJobs: db.prepare('SELECT COUNT(*) AS count FROM ai_jobs').get(),
      householdPreferences: db
        .prepare('SELECT meal_planning_preferences FROM households WHERE id = ?')
        .get('home'),
      memberPreferences: db
        .prepare('SELECT meal_planning_preferences FROM household_members WHERE id = ?')
        .get(planner.membershipId)
    };

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(provider).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(await read(response)).toMatchObject({
      success: false,
      code: 'MEAL_PLAN_OVERRIDE_INCOMPLETE',
      missingFields: ['schedule']
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual(before.meals);
    expect(db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars').get()).toEqual(
      before.calendars
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM ai_jobs').get()).toEqual(before.aiJobs);
    expect(
      db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home')
    ).toEqual(before.householdPreferences);
    expect(
      db
        .prepare('SELECT meal_planning_preferences FROM household_members WHERE id = ?')
        .get(planner.membershipId)
    ).toEqual(before.memberPreferences);
  });

  it('omits the household goal and keeps conflicting personal objectives assigned separately', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home', undefined, {
      goals: ['weight-loss'],
      goalNotes: 'PERSONAL_WEIGHT_GOAL_992',
      allergies: [],
      likes: ['PREFER_LEGUMES_992'],
      dislikes: []
    });
    const second = addUser(
      'second',
      'home',
      { calendar: { edit: false, view: true } },
      {
        goals: ['muscle-gain'],
        goalNotes: 'PERSONAL_MUSCLE_GOAL_992',
        allergies: [],
        likes: [],
        dislikes: ['AVOID_LEGUMES_992']
      }
    );
    setGoalOverride(planner);
    setGoalOverride(second);
    addAiConfig(planner.id, 'home');

    let providerBody: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(individuallyAssignedProposal()) }
            }
          ]
        }),
        { status: 200 }
      );
    });
    const promptMarker = 'HOUSEHOLD_GOAL_ONLY_FOR_NON_OVERRIDES_992';
    const prefs = JSON.parse(
      (
        db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home') as {
          meal_planning_preferences: string;
        }
      ).meal_planning_preferences
    );
    prefs.objective.notes = promptMarker;
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify(prefs),
      'home'
    );

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, second.membershipId]
    });
    const json = await read(response);
    const prompt = readProviderPrompt(providerBody);
    const context = readProviderMealContext(providerBody);

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.events).toHaveLength(14);
    expect(json.data.events[0]).toMatchObject({
      participantIds: [planner.id],
      servings: 1,
      objectiveSummary: 'Plato compatible con el objetivo weight-loss.'
    });
    expect(json.data.events[1]).toMatchObject({
      participantIds: [second.id],
      servings: 1,
      objectiveSummary: 'Plato compatible con el objetivo muscle-gain.'
    });
    expect(providerBody.response_format).toEqual(createMealProposalResponseFormat());
    expect(prompt).toContain('Busca primero un plato compartido');
    expect(prompt).not.toContain(promptMarker);
    expect(context.household.objective).toBeNull();
    expect(context.participants).toHaveLength(2);
    expect(context.participants.map((member: any) => member.effectiveObjective.source)).toEqual([
      'member',
      'member'
    ]);
    expect(JSON.stringify(context)).toContain('PERSONAL_WEIGHT_GOAL_992');
    expect(JSON.stringify(context)).toContain('PERSONAL_MUSCLE_GOAL_992');
    expect(JSON.stringify(context)).toContain('PREFER_LEGUMES_992');
    expect(JSON.stringify(context)).toContain('AVOID_LEGUMES_992');
    expect(JSON.stringify(json)).not.toContain('HOUSEHOLD_GOAL_ONLY_FOR_NON_OVERRIDES_992');
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('sends the personal override and inherited household goal for their respective members', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home', undefined, {
      goals: ['weight-loss'],
      goalNotes: 'PERSONAL_OVERRIDE_GOAL_621',
      allergies: [],
      likes: ['PREFER_LEGUMES_621'],
      dislikes: []
    });
    const inheriting = addUser('inheriting', 'home', undefined, {
      goals: ['muscle-gain'],
      goalNotes: 'IGNORED_INHERITED_PERSONAL_GOAL_621',
      allergies: [],
      likes: ['PREFER_TOMATOES_621'],
      dislikes: []
    });
    const excluded = addUser('excluded', 'home', undefined, {
      goals: ['weight-gain'],
      goalNotes: 'EXCLUDED_MEMBER_GOAL_621',
      allergies: [],
      likes: [],
      dislikes: []
    });
    setGoalOverride(planner);
    const householdPreferences = JSON.parse(
      (
        db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home') as {
          meal_planning_preferences: string;
        }
      ).meal_planning_preferences
    );
    householdPreferences.objective = {
      goals: ['variety'],
      notes: 'SHARED_HOUSEHOLD_GOAL_621'
    };
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify(householdPreferences),
      'home'
    );
    addAiConfig(planner.id, 'home');

    let providerBody: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
          ]
        }),
        { status: 200 }
      );
    });

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, inheriting.membershipId]
    });
    const json = await read(response);
    const prompt = readProviderPrompt(providerBody);
    const context = readProviderMealContext(providerBody);
    const serializedProviderRequest = JSON.stringify(providerBody);

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.events[0]).toMatchObject({
      participantIds: [planner.id, inheriting.id],
      servings: 2
    });
    expect(prompt).toContain('Busca primero un plato compartido');
    expect(prompt).toContain(
      'una diferencia de gustos entre personas no significa por sí sola que sean incompatibles'
    );
    expect(prompt).toContain('Un disgusto no equivale a alergia/intolerancia');
    expect(context.participants).toMatchObject([
      {
        alias: 'P1',
        effectiveObjective: {
          source: 'member',
          goals: ['weight-loss'],
          notes: 'PERSONAL_OVERRIDE_GOAL_621'
        },
        preferences: { likes: ['PREFER_LEGUMES_621'] }
      },
      {
        alias: 'P2',
        effectiveObjective: {
          source: 'household',
          goals: ['variety'],
          notes: 'SHARED_HOUSEHOLD_GOAL_621'
        },
        preferences: { likes: ['PREFER_TOMATOES_621'] }
      }
    ]);
    expect(prompt).not.toContain('IGNORED_INHERITED_PERSONAL_GOAL_621');
    expect(serializedProviderRequest).not.toContain('EXCLUDED_MEMBER_GOAL_621');
    expect(serializedProviderRequest).not.toContain('Private name excluded');
    expect(serializedProviderRequest).not.toContain(excluded.membershipId);
  });

  it('uses a selected member schedule override, inherits household schedule for another selected member, and excludes unselected members', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const inheriting = addUser('inheriting', 'home');
    const excluded = addUser('excluded', 'home', undefined, {
      goals: ['balanced'],
      goalNotes: 'EXCLUDED_MEMBER_GOAL_833',
      allergies: [],
      likes: ['EXCLUDED_MEMBER_LIKE_833'],
      dislikes: []
    });
    const householdPreferences = JSON.parse(
      (
        db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home') as {
          meal_planning_preferences: string;
        }
      ).meal_planning_preferences
    );
    householdPreferences.mealTypes = {
      breakfast: false,
      lunch: true,
      snack: false,
      dinner: false
    };
    householdPreferences.mealTimes.lunch = '13:00';
    householdPreferences.objective.notes = 'SHARED_HOUSEHOLD_GOAL_833';
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify(householdPreferences),
      'home'
    );
    db.prepare('UPDATE household_members SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify({
        scheduleOverrideEnabled: true,
        schedule: {
          mealTypes: { breakfast: false, lunch: false, snack: false, dinner: true },
          mealTimes: { breakfast: '08:00', lunch: '13:00', snack: '17:00', dinner: '19:30' }
        }
      }),
      planner.membershipId
    );
    addAiConfig(planner.id, 'home');

    let providerBody: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      const dinnerEvents = validProposal(['P1']).events.map((event) => ({
        ...event,
        mealType: 'dinner',
        time: '19:30'
      }));
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  newRecipes: validProposal().newRecipes,
                  events: [...dinnerEvents, ...validProposal(['P2']).events]
                })
              }
            }
          ]
        }),
        { status: 200 }
      );
    });

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, inheriting.membershipId]
    });
    const json = await read(response);
    const serializedProviderRequest = JSON.stringify(providerBody);
    const context = readProviderMealContext(providerBody);

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(context.participants).toMatchObject([
      {
        alias: 'P1',
        effectiveSchedule: {
          source: 'member',
          mealTypes: { breakfast: false, lunch: false, snack: false, dinner: true },
          mealTimes: { dinner: '19:30' }
        }
      },
      {
        alias: 'P2',
        effectiveSchedule: {
          source: 'household',
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { lunch: '13:00' }
        }
      }
    ]);
    expect(serializedProviderRequest).not.toContain('EXCLUDED_MEMBER_GOAL_833');
    expect(serializedProviderRequest).not.toContain('EXCLUDED_MEMBER_LIKE_833');
    expect(serializedProviderRequest).not.toContain('Private name excluded');
    expect(serializedProviderRequest).not.toContain(excluded.id);
    expect(serializedProviderRequest).not.toContain(excluded.membershipId);
    expect(context.household.objective.notes).toBe('SHARED_HOUSEHOLD_GOAL_833');
  });

  it('uses only the pantry and recipes accessible to the household planner', async () => {
    addHousehold('home', true);
    const planner = addUser('planner', 'home');
    const second = addUser('second', 'home', { calendar: { edit: false, view: true } });
    addAiConfig(planner.id, 'home');
    const longPantryName = `SHARED_HOME_ITEM ${'x'.repeat(2_501)}`;
    const longUtensilName = `UTENSIL ${'y'.repeat(2_501)}`;
    addIngredient('shared-home', second.id, longPantryName, 'home');
    addUtensil('long-utensil', planner.id, longUtensilName, 'cookware', 'home');
    addIngredient('planner-private', planner.id, 'PLANNER_PRIVATE_ITEM');
    addIngredient('second-private', second.id, 'SECOND_PRIVATE_ITEM');
    addIngredient('zero-stock', planner.id, 'EMPTY_ITEM', null, 0);
    addRecipe('planner-recipe', planner.id, 'PLANNER_RECIPE', ['arroz']);
    addRecipe('public-recipe', second.id, 'PUBLIC_RECIPE', ['tomate'], true);
    addRecipe('private-recipe', second.id, 'SECOND_PRIVATE_RECIPE', ['leche']);
    addRecipe('broken-recipe', planner.id, 'BROKEN_INGREDIENTS_RECIPE', { invalid: true });
    db.prepare('UPDATE recipes SET nutrition = ? WHERE id = ?').run(
      JSON.stringify({
        calories: 123,
        protein: 4,
        carbs: 20,
        fat: 2,
        fiber: null,
        sugar: 6,
        sodium: 32,
        authorEmail: 'private-author@example.invalid',
        privateNote: 'PRIVATE_NUTRITION_NOTE_883'
      }),
      'planner-recipe'
    );
    db.prepare('UPDATE recipes SET storage = ? WHERE id = ?').run(
      JSON.stringify({
        method: 'Refrigerar',
        duration: '2 días',
        reheating: 'Calentar completamente.',
        container: 'Recipiente cerrado',
        freezingPossible: false,
        freezingDuration: null
      }),
      'planner-recipe'
    );

    let providerBody: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
          ]
        }),
        { status: 200 }
      );
    });

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, second.membershipId]
    });
    const context = readProviderMealContext(providerBody);
    const catalog = readProviderRecipeCatalog(providerBody);

    expect(response.status).toBe(200);
    expect(context.pantry.map((item: any) => item.name)).toEqual(
      expect.arrayContaining([longPantryName, 'PLANNER_PRIVATE_ITEM'])
    );
    expect(context.utensils.map((item: any) => item.name)).toContain(longUtensilName);
    expect(context.pantry.map((item: any) => item.name)).not.toEqual(
      expect.arrayContaining(['SECOND_PRIVATE_ITEM', 'EMPTY_ITEM'])
    );
    expect(catalog.recipes.map((entry: any) => entry.recipe.name)).toEqual(
      expect.arrayContaining(['PLANNER_RECIPE', 'PUBLIC_RECIPE', 'BROKEN_INGREDIENTS_RECIPE'])
    );
    expect(catalog.recipes.map((entry: any) => entry.recipe.name)).not.toContain(
      'SECOND_PRIVATE_RECIPE'
    );
    expect(
      catalog.recipes.find((entry: any) => entry.recipe.name === 'BROKEN_INGREDIENTS_RECIPE')
    ).toMatchObject({ selectable: false });
    expect(
      catalog.recipes.find((entry: any) => entry.recipe.name === 'PLANNER_RECIPE')?.recipe.storage
    ).toMatchObject({ reheatingInstructions: 'Calentar completamente.' });
    expect(
      catalog.recipes.find((entry: any) => entry.recipe.name === 'PLANNER_RECIPE')?.recipe.nutrition
    ).toEqual({
      calories: 123,
      protein: 4,
      carbs: 20,
      fat: 2,
      fiber: null,
      sugar: 6,
      sodium: 32
    });
    expect(JSON.stringify(catalog)).not.toContain('planner-recipe');
    expect(JSON.stringify(catalog)).not.toContain('private-author@example.invalid');
    expect(JSON.stringify(catalog)).not.toContain('PRIVATE_NUTRITION_NOTE_883');
  });

  it('links an accessible catalog recipe by its real ID instead of cloning it on confirmation', async () => {
    addHousehold('home', true);
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    const catalogRecipe = generatedRecipe('Receta ya guardada');
    addCanonicalRecipe('owned-recipe', planner.id, catalogRecipe);
    let providerBody: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      const output = {
        newRecipes: [],
        events: validProposal(['P1']).events.map((event) => ({ ...event, recipeAlias: 'R1' }))
      };
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }]
        }),
        { status: 200 }
      );
    });

    const previewResponse = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });
    const preview = await read(previewResponse);
    expect(previewResponse.status, JSON.stringify(preview)).toBe(200);
    expect(preview.data.recipes).toEqual([
      expect.objectContaining({ alias: 'R1', source: 'catalog', recipeId: 'owned-recipe' })
    ]);
    const attachedCatalog = readProviderRecipeCatalog(providerBody);
    expect(attachedCatalog.recipes).toHaveLength(1);
    expect(attachedCatalog.recipes[0]).toMatchObject({
      alias: 'R1',
      selectable: true,
      recipe: { name: 'Receta ya guardada' }
    });
    expect(JSON.stringify(attachedCatalog)).not.toContain('owned-recipe');

    const confirmation = await callConfirm(planner, {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId],
      recipes: preview.data.recipes,
      events: preview.data.events
    });

    expect(confirmation.status).toBe(200);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM recipes WHERE name = ?')
          .get('Receta ya guardada') as { count: number }
      ).count
    ).toBe(1);
    expect(
      (
        db
          .prepare('SELECT DISTINCT recipe_id FROM meals WHERE proposal_id = ?')
          .get(preview.data.proposalId) as { recipe_id: string }
      ).recipe_id
    ).toBe('owned-recipe');
  });

  it('rejects confirmation if a selected catalog recipe changed after preview', async () => {
    addHousehold('home', true);
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    addCanonicalRecipe('owned-recipe', planner.id, generatedRecipe('Receta revisada'));
    vi.stubGlobal('fetch', async () => {
      const output = {
        newRecipes: [],
        events: validProposal(['P1']).events.map((event) => ({ ...event, recipeAlias: 'R1' }))
      };
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }]
        }),
        { status: 200 }
      );
    });

    const previewResponse = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });
    const preview = await read(previewResponse);
    expect(previewResponse.status, JSON.stringify(preview)).toBe(200);
    db.prepare('UPDATE recipes SET description = ? WHERE id = ?').run(
      'Contenido cambiado tras revisar la propuesta.',
      'owned-recipe'
    );

    const confirmation = await callConfirm(planner, {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId],
      recipes: preview.data.recipes,
      events: preview.data.events
    });

    expect(confirmation.status).toBe(409);
    expect(await read(confirmation)).toMatchObject({
      success: false,
      code: 'MEAL_PROPOSAL_RECIPE_CHANGED'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rejects an oversized complete recipe catalog before calling the provider or writing meals', async () => {
    addHousehold('home', true);
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    addRecipe('oversized-recipe', planner.id, 'RECETA_EXTENSA', ['arroz']);
    db.prepare('UPDATE recipes SET description = ? WHERE id = ?').run(
      'x'.repeat(2 * 1024 * 1024),
      'oversized-recipe'
    );
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(response.status).toBe(413);
    expect(await read(response)).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_RECIPE_CATALOG_TOO_LARGE'
    });
    expect(provider).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('bounds attached collection sizes while preserving full context strings', async () => {
    addHousehold('home', true);
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    const profile = JSON.parse(
      (
        db.prepare('SELECT preferences FROM users WHERE id = ?').get(planner.id) as {
          preferences: string;
        }
      ).preferences
    );
    profile.taste.likes = Array.from({ length: 65 }, (_, index) => `LIKE_${index}`);
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify(profile),
      planner.id
    );

    for (let index = 0; index < 101; index += 1) {
      addIngredient(`ingredient-${index}`, planner.id, `PANTRY_${index}_${'x'.repeat(130)}`);
      addUtensil(
        `utensil-${index}`,
        planner.id,
        `UTENSIL_${index}_${'y'.repeat(130)}`,
        'z'.repeat(80)
      );
    }
    db.prepare('UPDATE ingredients SET expiration_date = ? WHERE id = ?').run(
      `2026-10-14${' '.repeat(1_000_000)}`,
      'ingredient-0'
    );
    addRecipe('long-recipe', planner.id, 'A'.repeat(250), [
      ...Array.from({ length: 40 }, (_, index) => ({
        name: `INGREDIENT_${index}_${'z'.repeat(130)}`,
        quantity: 1,
        unit: 'g'
      })),
      { name: 'invalid quantity', quantity: -1, unit: 'g' }
    ]);
    for (let index = 0; index < 30; index += 1) {
      addRecipe(`recipe-${index}`, planner.id, `RECIPE_${index}`, ['arroz']);
    }

    let providerBody: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: JSON.stringify(validProposal(['P1'])) } }
          ]
        }),
        { status: 200 }
      );
    });

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });
    const context = readProviderMealContext(providerBody);
    const catalog = readProviderRecipeCatalog(providerBody);

    expect(response.status).toBe(200);
    expect(context.participants[0].preferences.likes).toHaveLength(60);
    expect(context.pantry).toHaveLength(100);
    expect(context.pantry.every((item: any) => item.name.length > 120)).toBe(true);
    expect(context.pantry.every((item: any) => item.unit.length > 0)).toBe(true);
    expect(
      context.pantry.find((item: any) => item.name.startsWith('PANTRY_0'))?.expirationDate
    ).toBeNull();
    expect(JSON.stringify(context)).not.toContain(' '.repeat(1_000));
    expect(context.utensils).toHaveLength(100);
    expect(context.utensils.every((item: any) => item.name.length > 120)).toBe(true);
    expect(context.utensils.every((item: any) => item.category.length > 60)).toBe(true);
    expect(catalog.recipes).toHaveLength(31);
    const catalogRecipe = catalog.recipes.find((entry: any) => entry.recipe.name.startsWith('A'));
    expect(catalogRecipe.recipe.name).toHaveLength(250);
    expect(catalogRecipe.recipe.ingredients).toHaveLength(41);
    expect(catalogRecipe.selectable).toBe(false);
  });

  it('attaches a bounded JSON snapshot of effective household context without private identities', async () => {
    addHousehold('home', true);
    const planner = addUser(
      'planner',
      'home',
      { calendar: { edit: true, view: true } },
      {
        goals: ['balanced'],
        goalNotes: '',
        allergies: ['cacahuete'],
        likes: ['P1_LIKE'],
        dislikes: ['P1_DISLIKE']
      }
    );
    const second = addUser(
      'second',
      'home',
      { calendar: { edit: false, view: true } },
      {
        goals: ['variety'],
        goalNotes: 'P2_PERSONAL_OBJECTIVE',
        allergies: [],
        likes: ['P2_LIKE'],
        dislikes: ['P2_DISLIKE']
      }
    );
    const excluded = addUser('excluded', 'home', undefined, {
      goals: ['weight-gain'],
      goalNotes: 'EXCLUDED_OBJECTIVE_SECRET',
      allergies: ['EXCLUDED_ALLERGY_SECRET'],
      likes: ['EXCLUDED_LIKE_SECRET'],
      dislikes: []
    });
    addAiConfig(planner.id, 'home');

    const householdPreferences = JSON.parse(
      (
        db.prepare('SELECT meal_planning_preferences FROM households WHERE id = ?').get('home') as {
          meal_planning_preferences: string;
        }
      ).meal_planning_preferences
    );
    householdPreferences.objective = { goals: ['balanced'], notes: 'HOME_OBJECTIVE_CONTEXT' };
    householdPreferences.mealTypes = {
      breakfast: false,
      lunch: true,
      snack: false,
      dinner: false
    };
    householdPreferences.mealTimes.lunch = '13:00';
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify(householdPreferences),
      'home'
    );
    db.prepare('UPDATE household_members SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify({
        goalOverrideEnabled: true,
        scheduleOverrideEnabled: true,
        schedule: {
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { breakfast: '08:00', lunch: '13:00', snack: '17:00', dinner: '20:00' }
        }
      }),
      second.membershipId
    );

    addIngredient('shared-item', second.id, 'SHARED_PANTRY_CONTEXT', 'home', 400);
    addIngredient('private-item', planner.id, 'PLANNER_PRIVATE_PANTRY', null, 2);
    addIngredient('other-private-item', second.id, 'SECOND_PRIVATE_PANTRY');
    addIngredient('empty-item', planner.id, 'ZERO_STOCK_CONTEXT', null, 0);
    addUtensil('shared-utensil', second.id, 'SHARED_POT_CONTEXT', 'cooking', 'home');
    addUtensil('private-utensil', planner.id, 'PLANNER_PRIVATE_POT', 'cooking');
    addUtensil('other-private-utensil', second.id, 'SECOND_PRIVATE_POT', 'cooking');
    addUtensil('unavailable-utensil', second.id, 'UNAVAILABLE_POT', 'cooking', 'home', false);
    addRecipe('planner-recipe', planner.id, 'PLANNER_RECIPE_CONTEXT', [
      { name: 'rice', quantity: 80, unit: 'g' }
    ]);
    addRecipe(
      'public-recipe',
      second.id,
      'PUBLIC_RECIPE_CONTEXT',
      [{ name: 'tomato', quantity: 1, unit: 'piece' }],
      true
    );
    addRecipe('private-recipe', second.id, 'SECOND_PRIVATE_RECIPE', ['leche']);

    const previousWeekStart = addDays(WEEK_START, -7);
    const previousWeekEnd = addDays(previousWeekStart, 6);
    db.prepare(
      `INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end)
       VALUES (?, ?, ?, ?, ?)`
    ).run('previous-calendar', 'home', planner.id, previousWeekStart, previousWeekEnd);
    db.prepare(
      `INSERT INTO meals
        (id, calendar_id, date, meal_type, custom_meal, time, servings,
         source_proposal_id, proposal_id, recipe_snapshot)
       VALUES (?, ?, ?, 'lunch', ?, '13:00', ?, ?, ?, ?)`
    ).run(
      'previous-meal',
      'previous-calendar',
      addDays(previousWeekStart, 2),
      'SMOKE_PREVIOUS_MEAL',
      2,
      'previous-proposal:previous-meal',
      'previous-proposal',
      JSON.stringify({
        name: 'SMOKE_PREVIOUS_MEAL',
        description: 'Una receta anterior.',
        baseServings: 1,
        times: { prepTimeMinutes: 10, cookTimeMinutes: 20 },
        ingredients: [{ name: 'garbanzos', quantity: 80, unit: 'g' }],
        instructions: ['Cocer.']
      })
    );
    db.prepare('INSERT INTO meal_participants (meal_id, user_id) VALUES (?, ?)').run(
      'previous-meal',
      planner.id
    );
    db.prepare('INSERT INTO meal_participants (meal_id, user_id) VALUES (?, ?)').run(
      'previous-meal',
      excluded.id
    );
    db.prepare(
      `INSERT INTO meals
        (id, calendar_id, date, meal_type, custom_meal, time, servings,
         source_proposal_id, proposal_id, recipe_snapshot)
       VALUES (?, ?, ?, 'dinner', ?, '20:00', 1, ?, ?, ?)`
    ).run(
      'excluded-previous-meal',
      'previous-calendar',
      addDays(previousWeekStart, 2),
      'EXCLUDED_PREVIOUS_MEAL_SECRET',
      'previous-proposal:excluded-meal',
      'previous-proposal',
      JSON.stringify({ name: 'EXCLUDED_PREVIOUS_MEAL_SECRET', ingredients: [] })
    );
    db.prepare('INSERT INTO meal_participants (meal_id, user_id) VALUES (?, ?)').run(
      'excluded-previous-meal',
      excluded.id
    );

    let providerBody: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
          ]
        }),
        { status: 200 }
      );
    });

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, second.membershipId]
    });
    const json = await read(response);
    expect(providerBody, JSON.stringify(json)).toBeDefined();
    const context = readProviderMealContext(providerBody);
    const catalog = readProviderRecipeCatalog(providerBody);
    const serializedContext = JSON.stringify(context);
    const serializedCatalog = JSON.stringify(catalog);
    const textParts = providerBody.messages[1].content.filter((part: any) => part.type === 'text');

    expect(response.status).toBe(200);
    expect(providerBody.response_format).toEqual(createMealProposalResponseFormat());
    expect(providerBody.response_format.json_schema.schema.properties.events.minItems).toBe(1);
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toContain('meal-planning-context.json');
    expect(context).toMatchObject({
      version: 2,
      targetWeek: { startDate: WEEK_START, endDate: addDays(WEEK_START, 6) },
      household: {
        objective: { goals: ['balanced'], notes: 'HOME_OBJECTIVE_CONTEXT' },
        schedule: {
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { breakfast: '08:00', lunch: '13:00', snack: '17:00', dinner: '20:00' }
        }
      },
      participants: [
        {
          alias: 'P1',
          preferences: {
            strictAllergies: ['cacahuete'],
            likes: ['P1_LIKE'],
            dislikes: ['P1_DISLIKE']
          },
          effectiveObjective: { source: 'household', goals: ['balanced'] },
          effectiveSchedule: { source: 'household' }
        },
        {
          alias: 'P2',
          preferences: { likes: ['P2_LIKE'], dislikes: ['P2_DISLIKE'] },
          effectiveObjective: {
            source: 'member',
            goals: ['variety'],
            notes: 'P2_PERSONAL_OBJECTIVE'
          },
          effectiveSchedule: { source: 'member' }
        }
      ],
      previousConfirmedPlan: expect.objectContaining({
        weekStart: previousWeekStart,
        weekEnd: previousWeekEnd
      })
    });
    expect(context.participants).toHaveLength(2);
    expect(context.requiredTurns).toHaveLength(7);
    expect(context.requiredTurns).toContainEqual({
      date: WEEK_START,
      mealType: 'lunch',
      time: '13:00',
      eligibleParticipants: ['P1', 'P2']
    });
    expect(context.pantry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'SHARED_PANTRY_CONTEXT', quantity: 400 }),
        expect.objectContaining({ name: 'PLANNER_PRIVATE_PANTRY', quantity: 2 })
      ])
    );
    expect(context.utensils).toEqual(
      expect.arrayContaining([
        { name: 'SHARED_POT_CONTEXT', category: 'cooking' },
        { name: 'PLANNER_PRIVATE_POT', category: 'cooking' }
      ])
    );
    expect(catalog.recipes.map((entry: any) => entry.recipe.name)).toEqual(
      expect.arrayContaining(['PLANNER_RECIPE_CONTEXT', 'PUBLIC_RECIPE_CONTEXT'])
    );
    expect(context.previousConfirmedPlan.events).toContainEqual(
      expect.objectContaining({
        date: addDays(previousWeekStart, 2),
        mealType: 'lunch',
        time: '13:00',
        servings: 2,
        participants: ['P1'],
        recipeName: 'SMOKE_PREVIOUS_MEAL'
      })
    );
    expect(serializedContext).not.toContain('EXCLUDED_PREVIOUS_MEAL_SECRET');
    expect(context.pantry.map((item: any) => item.name)).not.toEqual(
      expect.arrayContaining(['SECOND_PRIVATE_PANTRY', 'ZERO_STOCK_CONTEXT'])
    );
    expect(context.utensils.map((item: any) => item.name)).not.toEqual(
      expect.arrayContaining(['SECOND_PRIVATE_POT', 'UNAVAILABLE_POT'])
    );
    expect(catalog.recipes.map((item: any) => item.recipe.name)).not.toContain(
      'SECOND_PRIVATE_RECIPE'
    );
    for (const privateIdentity of [
      planner.id,
      planner.membershipId,
      second.id,
      second.membershipId,
      excluded.id,
      excluded.membershipId,
      'Private name',
      '@hogaria.test',
      'EXCLUDED_OBJECTIVE_SECRET',
      'EXCLUDED_ALLERGY_SECRET',
      'EXCLUDED_LIKE_SECRET'
    ]) {
      expect(serializedContext).not.toContain(privateIdentity);
      expect(serializedCatalog).not.toContain(privateIdentity);
    }
    expect(json.success).toBe(true);
  });

  it('rejects stale household context and missing edit permission before provider access', async () => {
    addHousehold('home');
    addHousehold('other');
    const planner = addUser('planner', 'home');
    const reader = addUser('reader', 'home', { calendar: { edit: false } });
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const stale = await call(
      planner,
      {
        weekStart: WEEK_START,
        householdMemberIds: [planner.membershipId]
      },
      'other'
    );
    const denied = await call(reader, {
      weekStart: WEEK_START,
      householdMemberIds: [reader.membershipId]
    });

    expect(stale.status).toBe(409);
    expect(await read(stale)).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    expect(denied.status).toBe(403);
    expect(await read(denied)).toMatchObject({ code: 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('drops a proposal if the active household changes while the provider is running', async () => {
    addHousehold('home');
    addHousehold('other');
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    const provider = vi.fn(async () => {
      db.prepare(
        'INSERT INTO household_members (id, household_id, user_id, role, permissions) VALUES (?, ?, ?, ?, ?)'
      ).run(
        'membership-planner-other',
        'other',
        planner.id,
        'admin',
        JSON.stringify({ calendar: { edit: true, view: true } })
      );
      db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('other', planner.id);
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
          ]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', provider);

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(409);
    expect(await read(response)).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rechecks household context after parsing a delayed preview body', async () => {
    addHousehold('home');
    addHousehold('other-home');
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    let releaseBody!: () => void;
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const bodyText = JSON.stringify({
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        markBodyStarted();
        return new Promise<void>((resolve) => {
          releaseBody = () => {
            controller.enqueue(new TextEncoder().encode(bodyText));
            controller.close();
            resolve();
          };
        });
      }
    });
    const pendingResponse = app.request(
      '/api/household/meal-planning/proposal',
      new Request('http://localhost/api/household/meal-planning/proposal', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${planner.token}`,
          'content-type': 'application/json',
          'x-household-id': 'home'
        },
        body,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' })
    );
    await bodyStarted;

    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', ?)`
    ).run(
      'membership-planner-other-home',
      'other-home',
      planner.id,
      JSON.stringify({ calendar: { edit: true, view: true } })
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('other-home', planner.id);
    releaseBody();

    const response = await pendingResponse;
    expect(response.status).toBe(409);
    expect(await read(response)).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not send or confirm profiles without calendar.view access', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home', { calendar: { edit: true, view: true } });
    const member = addUser(
      'member',
      'home',
      { calendar: { edit: false, view: false } },
      {
        goals: ['balanced'],
        goalNotes: '',
        allergies: ['cacahuete'],
        likes: [],
        dislikes: []
      }
    );
    addAiConfig(planner.id, 'home');
    const provider = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', provider);

    const deniedPreview = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, member.membershipId]
    });
    expect(deniedPreview.status).toBe(403);
    expect(await read(deniedPreview)).toMatchObject({ code: 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED' });
    expect(provider).not.toHaveBeenCalled();

    db.prepare('UPDATE household_members SET permissions = ? WHERE id = ?').run(
      JSON.stringify({ calendar: { edit: false, view: true } }),
      member.membershipId
    );
    const previewResponse = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, member.membershipId]
    });
    const previewBody = await read(previewResponse);
    expect({ status: previewResponse.status, body: previewBody }).toMatchObject({
      status: 200,
      body: { success: true }
    });
    const preview = previewBody;
    expect(provider).toHaveBeenCalledTimes(1);

    db.prepare('UPDATE household_members SET permissions = ? WHERE id = ?').run(
      JSON.stringify({ calendar: { edit: false, view: false } }),
      member.membershipId
    );
    const confirmation = await callConfirm(planner, {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, member.membershipId],
      recipes: preview.data.recipes,
      events: preview.data.events
    });

    expect(confirmation.status).toBe(403);
    expect(await read(confirmation)).toMatchObject({ code: 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('fails closed when the caller membership is inactive or permissions are malformed', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    db.prepare('UPDATE household_members SET permissions = ? WHERE id = ?').run(
      '{broken',
      planner.membershipId
    );
    const malformedPermissions = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });
    db.prepare('UPDATE household_members SET permissions = NULL WHERE id = ?').run(
      planner.membershipId
    );
    db.prepare('UPDATE household_members SET role = ?, is_active = 1 WHERE id = ?').run(
      'member',
      planner.membershipId
    );
    const nonAdminDefaultPermissions = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });
    db.prepare('UPDATE household_members SET role = ?, is_active = 0 WHERE id = ?').run(
      'admin',
      planner.membershipId
    );
    const inactive = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(malformedPermissions.status).toBe(403);
    expect(nonAdminDefaultPermissions.status).toBe(403);
    expect(inactive.status).toBe(404);
    expect(await read(inactive)).toMatchObject({ code: 'HOUSEHOLD_REQUIRED' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and invalid week requests before provider access', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const malformed = await callRaw(planner, '{not-json');
    const invalid = await call(planner, {
      weekStart: '2026-10-13',
      householdMemberIds: [planner.membershipId]
    });

    expect(malformed.status).toBe(400);
    expect(await read(malformed)).toMatchObject({ code: 'INVALID_MEAL_PROPOSAL_REQUEST' });
    expect(invalid.status).toBe(400);
    expect(await read(invalid)).toMatchObject({ code: 'INVALID_MEAL_PROPOSAL_REQUEST' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns a clear setup error when the household has no active AI provider', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(response.status).toBe(409);
    expect(await read(response)).toMatchObject({ code: 'AI_PROVIDER_NOT_CONFIGURED' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rejects empty selected schedules before any provider request', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    db.prepare('UPDATE households SET meal_planning_preferences = ? WHERE id = ?').run(
      JSON.stringify({
        objective: { goals: ['balanced'], notes: '' },
        mealTypes: { breakfast: false, lunch: false, snack: false, dinner: false },
        mealTimes: { breakfast: '08:00', lunch: '13:00', snack: '17:00', dinner: '20:00' }
      }),
      'home'
    );
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(response.status).toBe(409);
    expect(await read(response)).toMatchObject({ code: 'MEAL_PLAN_NO_SELECTED_TURNS' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('rejects member IDs outside the active household without contacting the provider', async () => {
    addHousehold('home');
    addHousehold('other');
    const planner = addUser('planner', 'home');
    const outsider = addUser('outsider', 'other');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, outsider.membershipId]
    });

    expect(response.status).toBe(404);
    expect(await read(response)).toMatchObject({ code: 'HOUSEHOLD_MEMBER_NOT_FOUND' });
    expect(provider).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('keeps unsupported strict restrictions out of the prompt and returns review-only slots', async () => {
    addHousehold('home');
    const planner = addUser(
      'planner',
      'home',
      { calendar: { edit: true, view: true } },
      {
        goals: ['balanced'],
        goalNotes: '',
        allergies: ['rare-allergen-code-91'],
        likes: [],
        dislikes: []
      }
    );
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });
    const json = await read(response);

    expect(response.status).toBe(200);
    expect(provider).not.toHaveBeenCalled();
    expect(json.data.events).toHaveLength(7);
    expect(json.data.events[0]).toMatchObject({
      status: 'unresolved',
      recipeAlias: null,
      servings: 0,
      participantIds: [planner.id]
    });
    expect(JSON.stringify(json)).not.toContain('rare-allergen-code-91');
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('fails closed on incomplete model coverage without persisting a partial week', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    const provider = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify({ events: [] }) } }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', provider);

    const response = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(response.status).toBe(502);
    expect(await read(response)).toMatchObject({ code: 'MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM calendar_events').get()).toEqual({ count: 0 });
  });

  it('persists only explicit participants and is idempotent on a repeated confirmation', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home', { calendar: { edit: true, view: true } });
    const second = addUser('second', 'home', { calendar: { edit: false, view: true } });
    addAiConfig(planner.id, 'home');
    const provider = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', provider);

    const previewResponse = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, second.membershipId]
    });
    const preview = await read(previewResponse);
    expect(previewResponse.status).toBe(200);
    const confirmation = {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, second.membershipId],
      recipes: preview.data.recipes,
      events: preview.data.events.map((event: Record<string, any>) => ({
        ...event,
        // These echoed IDs are deliberately tampered with; the route must derive them from aliases.
        participantIds: ['not-a-household-member']
      }))
    };

    const first = await callConfirm(planner, confirmation);
    const firstJson = await read(first);
    expect(first.status, JSON.stringify(firstJson)).toBe(200);
    expect(firstJson).toMatchObject({ success: true, data: { idempotent: false } });
    expect(firstJson.data.events).toHaveLength(7);
    expect(firstJson.data.events[0].participantIds).toEqual([planner.id, second.id]);
    expect(firstJson.data.events[0].recipeSnapshot).toMatchObject({
      name: 'Arroz con verduras',
      baseServings: 1,
      ingredients: [{ name: 'arroz', quantity: 80, unit: 'g' }]
    });
    const savedRecipeId = (
      db
        .prepare('SELECT recipe_id FROM meals WHERE proposal_id = ? LIMIT 1')
        .get(confirmation.proposalId) as { recipe_id: string }
    ).recipe_id;
    expect(
      db.prepare('SELECT author, author_id, is_public FROM recipes WHERE id = ?').get(savedRecipeId)
    ).toEqual({
      author: 'ai',
      author_id: planner.id,
      is_public: 0
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE name = ?').get('Arroz con verduras')
    ).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 7 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meal_participants').get()).toEqual({
      count: 14
    });

    const retry = await callConfirm(planner, confirmation);
    expect(retry.status).toBe(200);
    expect(await read(retry)).toMatchObject({ success: true, data: { idempotent: true } });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 7 });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('checks household context and calendar permission before confirming', async () => {
    addHousehold('home');
    addHousehold('other');
    const planner = addUser('planner', 'home');
    const reader = addUser('reader', 'home', { calendar: { edit: false, view: true } });

    const stale = await callConfirm(planner, {}, 'other');
    const denied = await callConfirm(reader, {});

    expect(stale.status).toBe(409);
    expect(await read(stale)).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    expect(denied.status).toBe(403);
    expect(await read(denied)).toMatchObject({ code: 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED' });
  });

  it('requires an active household and selected members for confirmation', async () => {
    addHousehold('home');
    addHousehold('other');
    const inactive = addUser('inactive', 'home');
    const planner = addUser('planner', 'home');
    const outsider = addUser('outsider', 'other');
    db.prepare('UPDATE household_members SET is_active = 0 WHERE id = ?').run(
      inactive.membershipId
    );

    const noHousehold = await callConfirm(inactive, {});
    const foreignMember = await callConfirm(planner, {
      proposalId: 'proposal-foreign',
      weekStart: WEEK_START,
      householdMemberIds: [outsider.membershipId],
      recipes: [
        {
          alias: 'N1',
          source: 'new',
          recipeId: null,
          recipe: generatedRecipe()
        }
      ],
      events: [{ ...validProposal(['P1']).events[0], id: 'event-1' }]
    });

    expect(noHousehold.status).toBe(404);
    expect(await read(noHousehold)).toMatchObject({ code: 'HOUSEHOLD_REQUIRED' });
    expect(foreignMember.status).toBe(404);
    expect(await read(foreignMember)).toMatchObject({ code: 'HOUSEHOLD_MEMBER_NOT_FOUND' });
  });

  it('rejects malformed and invalid confirmation bodies without writes', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const malformed = await callConfirmRaw(planner, '{not-json');
    const invalid = await callConfirm(planner, {});

    expect(malformed.status).toBe(400);
    expect(await read(malformed)).toMatchObject({ code: 'INVALID_MEAL_PROPOSAL_CONFIRMATION' });
    expect(invalid.status).toBe(400);
    expect(await read(invalid)).toMatchObject({ code: 'INVALID_MEAL_PROPOSAL_CONFIRMATION' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rejects an oversized confirmation body before parsing it', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const oversized = `{"padding":"${'x'.repeat(8 * 1024 * 1024)}"}`;

    const response = await callConfirmRaw(planner, oversized);

    expect(response.status).toBe(413);
    expect(await read(response)).toMatchObject({
      code: 'MEAL_PROPOSAL_CONFIRMATION_TOO_LARGE'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rejects duplicate member assignments in a confirmation before persistence', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(validProposal(['P1'])) } }
            ]
          }),
          { status: 200 }
        )
    );
    const preview = await read(
      await call(planner, {
        weekStart: WEEK_START,
        householdMemberIds: [planner.membershipId]
      })
    );
    const event = preview.data.events[0];
    const duplicate = {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId],
      recipes: preview.data.recipes,
      events: [event, { ...event, id: 'second-event' }]
    };

    const response = await callConfirm(planner, duplicate);

    expect(response.status).toBe(400);
    expect(await read(response)).toMatchObject({ code: 'INVALID_MEAL_PROPOSAL_CONFIRMATION' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('rejects a changed retry instead of silently modifying confirmed calendar events', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home', { calendar: { edit: true, view: true } });
    addAiConfig(planner.id, 'home');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(validProposal(['P1'])) } }
            ]
          }),
          { status: 200 }
        )
    );
    const preview = await read(
      await call(planner, {
        weekStart: WEEK_START,
        householdMemberIds: [planner.membershipId]
      })
    );
    const confirmation = {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId],
      recipes: preview.data.recipes,
      events: preview.data.events
    };
    const first = await callConfirm(planner, confirmation);
    expect(first.status).toBe(200);

    const changed = {
      ...confirmation,
      recipes: confirmation.recipes.map((recipe: Record<string, any>, index: number) =>
        index === 0
          ? { ...recipe, recipe: { ...recipe.recipe, description: 'Cambio posterior' } }
          : recipe
      )
    };
    const retry = await callConfirm(planner, changed);

    expect(retry.status).toBe(409);
    expect(await read(retry)).toMatchObject({ code: 'PROPOSAL_CONFLICT' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 7 });
  });

  it('rechecks strict restrictions at confirmation and persists only the safe assignee', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home', { calendar: { edit: true, view: true } });
    const restricted = addUser(
      'restricted',
      'home',
      { calendar: { edit: false, view: true } },
      {
        goals: ['balanced'],
        goalNotes: '',
        allergies: ['gluten'],
        likes: [],
        dislikes: []
      }
    );
    addAiConfig(planner.id, 'home');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'stop', message: { content: JSON.stringify(validProposal()) } }
            ]
          }),
          { status: 200 }
        )
    );

    const preview = await read(
      await call(planner, {
        weekStart: WEEK_START,
        householdMemberIds: [planner.membershipId, restricted.membershipId]
      })
    );
    const confirmation = {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId, restricted.membershipId],
      recipes: preview.data.recipes.map((recipe: Record<string, any>) => ({
        ...recipe,
        recipe: {
          ...recipe.recipe,
          instructionsByLevel: {
            ...recipe.recipe.instructionsByLevel,
            expert: recipe.recipe.instructionsByLevel.expert.map(
              (step: Record<string, unknown>) => ({
                ...step,
                instruction: 'Añade una salsa con trazas de gluten.'
              })
            )
          }
        }
      })),
      events: preview.data.events
    };

    const response = await callConfirm(planner, confirmation);
    const json = await read(response);

    expect(response.status).toBe(200);
    expect(json.data.events).toHaveLength(7);
    expect(
      json.data.events.every(
        (event: Record<string, any>) =>
          event.participantIds.length === 1 && event.participantIds[0] === planner.id
      )
    ).toBe(true);
    expect(json.data.unresolvedEvents).toHaveLength(7);
    expect(JSON.stringify(json.data.unresolvedEvents)).not.toContain('gluten');
    expect(JSON.stringify(json.data.unresolvedEvents)).not.toContain('trazas');
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 7 });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meal_participants WHERE user_id = ?')
        .get(restricted.id)
    ).toEqual({ count: 0 });
  });

  it('does not persist review-only events when no safe meal can be confirmed', async () => {
    addHousehold('home');
    const planner = addUser(
      'planner',
      'home',
      { calendar: { edit: true, view: true } },
      {
        goals: ['balanced'],
        goalNotes: '',
        allergies: ['rare-allergen-code-91'],
        likes: [],
        dislikes: []
      }
    );

    const preview = await read(
      await call(planner, {
        weekStart: WEEK_START,
        householdMemberIds: [planner.membershipId]
      })
    );
    const confirmation = {
      proposalId: preview.data.proposalId,
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId],
      recipes: preview.data.recipes,
      events: preview.data.events
    };
    const response = await callConfirm(planner, confirmation);

    expect(response.status).toBe(409);
    expect(await read(response)).toMatchObject({ code: 'MEAL_PLAN_NO_SAFE_MEALS' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('maps invalid model JSON to a safe stable error without a partial write', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    addAiConfig(planner.id, 'home');

    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: 'not-json' } }]
          }),
          { status: 200 }
        )
    );
    const invalidJson = await call(planner, {
      weekStart: WEEK_START,
      householdMemberIds: [planner.membershipId]
    });

    expect(invalidJson.status).toBe(502);
    expect(await read(invalidJson)).toMatchObject({ code: 'AI_PROVIDER_ERROR' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM calendar_events').get()).toEqual({ count: 0 });
  });

  it('maps AI timeout and missing configuration to distinct safe statuses', async () => {
    const { AiCallError } = await import('../utils/ai-client.js');
    const { mapHouseholdMealProposalAiError } =
      await import('./household-meal-proposals.routes.js');

    expect(mapHouseholdMealProposalAiError(new AiCallError('TIMEOUT', 'synthetic'))).toEqual({
      status: 504,
      code: 'AI_PROVIDER_TIMEOUT'
    });
    expect(mapHouseholdMealProposalAiError(new AiCallError('NO_CONFIG', 'synthetic'))).toEqual({
      status: 409,
      code: 'AI_PROVIDER_NOT_CONFIGURED'
    });
    expect(mapHouseholdMealProposalAiError(new AiCallError('PROVIDER', 'synthetic'))).toEqual({
      status: 502,
      code: 'AI_PROVIDER_ERROR'
    });
  });

  it('builds an automation proposal through one strict provider call without sending member names', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const companion = addUser('companion', 'home');
    const provider = vi.fn<HouseholdMealProposalProvider>(async (messages, responseFormat) => {
      expect(responseFormat).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
      expect(JSON.stringify(messages)).not.toContain('Private name');
      return JSON.stringify(validProposal(['P1', 'P2']));
    });
    const { generateAutomatedHouseholdMealProposal } =
      await import('./household-meal-proposals.routes.js');

    const result = await generateAutomatedHouseholdMealProposal(
      {
        db,
        householdId: 'home',
        actorUserId: planner.id,
        householdMemberIds: [planner.membershipId, companion.membershipId],
        weekStart: WEEK_START,
        language: 'es'
      },
      provider
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.events).toHaveLength(7);
    expect(result.participants.map(({ userId }) => userId)).toEqual([planner.id, companion.id]);
    expect(result.events[0]?.participantAliases).toEqual(['P1', 'P2']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
  });

  it('does not retry an ambiguous provider timeout in the automation generator', async () => {
    const { AiCallError } = await import('../utils/ai-client.js');
    const { generateAutomatedHouseholdMealProposal } =
      await import('./household-meal-proposals.routes.js');
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const timeout = new AiCallError('TIMEOUT', 'synthetic timeout');
    const provider = vi.fn(async () => Promise.reject(timeout));

    await expect(
      generateAutomatedHouseholdMealProposal(
        {
          db,
          householdId: 'home',
          actorUserId: planner.id,
          householdMemberIds: [planner.membershipId],
          weekStart: WEEK_START,
          language: 'es'
        },
        provider
      )
    ).rejects.toBe(timeout);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
