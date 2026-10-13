import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadableStream } from 'node:stream/web';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createMealProposalResponseFormat } from '../schemas/household-meal-proposal.schema.js';

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

function validProposal(aliases: string[] = ['P1', 'P2']) {
  return {
    events: Array.from({ length: 7 }, (_, index) => ({
      date: addDays(WEEK_START, index),
      mealType: 'lunch',
      time: '13:00',
      recipe: {
        name: 'Arroz con verduras',
        description: 'Plato de prueba',
        baseServings: 1,
        prepTimeMinutes: 10,
        cookTimeMinutes: 25,
        ingredients: [
          {
            name: 'arroz',
            quantity: 80,
            unit: 'g',
            preparation: null,
            isOptional: false,
            notes: null
          }
        ],
        instructions: ['Cocina el arroz.']
      },
      participantAliases: aliases,
      servings: aliases.length,
      objectiveSummary: 'Comida equilibrada para el grupo.',
      status: 'scheduled',
      reason: null
    }))
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
    expect(providerBody.messages[1].content).toContain('calabacín');
    expect(serializedProviderRequest).not.toContain(planner.membershipId);
    expect(serializedProviderRequest).not.toContain(second.membershipId);
    expect(serializedProviderRequest).not.toContain(excluded.membershipId);
    expect(serializedProviderRequest).not.toContain('Private name');
    expect(serializedProviderRequest).not.toContain('planner@hogaria.test');
    expect(serializedProviderRequest).not.toContain('DO_NOT_SEND_PRIVATE');
    expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual(mealsBefore);
    expect(db.prepare('SELECT COUNT(*) AS count FROM calendar_events').get()).toEqual({ count: 0 });
  });

  it('omits the shared goal when everyone selected has a personal override', async () => {
    addHousehold('home');
    const planner = addUser('planner', 'home');
    const second = addUser('second', 'home', { calendar: { edit: false, view: true } });
    setGoalOverride(planner);
    setGoalOverride(second);
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
    expect(response.status).toBe(200);
    const prompt = String(providerBody.messages[1].content);

    expect(prompt).not.toContain(promptMarker);
    expect(prompt.match(/"objectiveSource":"member"/g)).toHaveLength(2);
  });

  it('uses only the pantry and recipes accessible to the household planner', async () => {
    addHousehold('home', true);
    const planner = addUser('planner', 'home');
    const second = addUser('second', 'home', { calendar: { edit: false, view: true } });
    addAiConfig(planner.id, 'home');
    addIngredient('shared-home', second.id, 'SHARED_HOME_ITEM', 'home');
    addIngredient('planner-private', planner.id, 'PLANNER_PRIVATE_ITEM');
    addIngredient('second-private', second.id, 'SECOND_PRIVATE_ITEM');
    addIngredient('zero-stock', planner.id, 'EMPTY_ITEM', null, 0);
    addRecipe('planner-recipe', planner.id, 'PLANNER_RECIPE', ['arroz']);
    addRecipe('public-recipe', second.id, 'PUBLIC_RECIPE', ['tomate'], true);
    addRecipe('private-recipe', second.id, 'SECOND_PRIVATE_RECIPE', ['leche']);
    addRecipe('broken-recipe', planner.id, 'BROKEN_INGREDIENTS_RECIPE', { invalid: true });

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
    const prompt = String(providerBody.messages[1].content);

    expect(response.status).toBe(200);
    expect(prompt).toContain('SHARED_HOME_ITEM');
    expect(prompt).toContain('PLANNER_PRIVATE_ITEM');
    expect(prompt).not.toContain('SECOND_PRIVATE_ITEM');
    expect(prompt).not.toContain('EMPTY_ITEM');
    expect(prompt).toContain('PLANNER_RECIPE');
    expect(prompt).toContain('PUBLIC_RECIPE');
    expect(prompt).not.toContain('SECOND_PRIVATE_RECIPE');
    expect(prompt).not.toContain('BROKEN_INGREDIENTS_RECIPE');
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
      recipe: null,
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
    expect(await read(response)).toMatchObject({ code: 'MEAL_PROPOSAL_SLOT_COVERAGE_INVALID' });
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
      events: preview.data.events.map((event: Record<string, any>) => ({
        ...event,
        // These echoed IDs are deliberately tampered with; the route must derive them from aliases.
        participantIds: ['not-a-household-member']
      }))
    };

    const first = await callConfirm(planner, confirmation);
    const firstJson = await read(first);
    expect(first.status).toBe(200);
    expect(firstJson).toMatchObject({ success: true, data: { idempotent: false } });
    expect(firstJson.data.events).toHaveLength(7);
    expect(firstJson.data.events[0].participantIds).toEqual([planner.id, second.id]);
    expect(firstJson.data.events[0].recipeSnapshot).toMatchObject({
      name: 'Arroz con verduras',
      baseServings: 1,
      times: { prepTimeMinutes: 10, cookTimeMinutes: 25, totalTimeMinutes: 35 },
      ingredients: [{ name: 'arroz', quantity: 80, unit: 'g' }]
    });
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
      events: preview.data.events
    };
    const first = await callConfirm(planner, confirmation);
    expect(first.status).toBe(200);

    const changed = {
      ...confirmation,
      events: confirmation.events.map((event: Record<string, any>, index: number) =>
        index === 0
          ? { ...event, recipe: { ...event.recipe, description: 'Cambio posterior' } }
          : event
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
      events: preview.data.events.map((event: Record<string, any>) => ({
        ...event,
        recipe: { ...event.recipe, instructions: ['Añade una salsa con trazas de gluten.'] }
      }))
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
});
