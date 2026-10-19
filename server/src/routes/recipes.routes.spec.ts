import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { ReadableStream } from 'node:stream/web';
import { recipeStepVideoProvider } from '../utils/recipe-step-videos.js';
import { MAX_RECIPE_CONTENT_REQUEST_BYTES } from '../middleware/recipe-content-body-limit.middleware.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let userId: string;
let token: string;
let otherUserId: string;
let otherToken: string;
let ensureRecipeBookCatalog: (database: Sql) => number;

async function callAs(
  requestToken: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
) {
  const response = await app.request(`/api/recipes${path}`, {
    method,
    headers: {
      authorization: `Bearer ${requestToken}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const responseBody = await response.text();
  let payload: any;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new Error(`Non-JSON recipe response (${response.status}): ${responseBody}`);
  }
  return { status: response.status, payload };
}

const call = (
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
) => callAs(token, method, path, body, extraHeaders);

const instructionsByLevel = {
  basic: [{ stepNumber: 1, instruction: 'Cocer.', timerRequired: false }],
  intermediate: [
    { stepNumber: 1, instruction: 'Cortar y cocer hasta que esté tierna.', timerRequired: false }
  ],
  expert: [
    { stepNumber: 1, instruction: 'Cortar en dados y cocer a hervor suave.', timerRequired: false }
  ]
};

const recipeGuidance = {
  appliances: ['Cocina de gas'],
  parallelTasks: ['Mientras hierve el agua, cortar las verduras.'],
  tipsAndVariations: ['Añadir perejil fresco al final.']
};

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const config = await import('../config/app.config.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  const { recipeStepVideoRoutes } = await import('./recipe-step-videos.routes.js');
  ({ ensureRecipeBookCatalog } = await import('../utils/recipe-book-seed.js'));
  const { recipeRoutes } = await import('./recipes.routes.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.route('/api/recipes', recipeStepVideoRoutes);
  app.route('/api/recipes', recipeRoutes);
  userId = 'recipe-levels-user';
  token = jwt.sign(
    { sub: userId, email: 'recipe-levels@test.local' },
    config.config.auth.jwtSecret
  );
  otherUserId = 'recipe-book-other-user';
  otherToken = jwt.sign(
    { sub: otherUserId, email: 'recipe-book-other@test.local' },
    config.config.auth.jwtSecret
  );
});

beforeEach(() => {
  db.prepare('DELETE FROM user_recipes WHERE user_id IN (?, ?)').run(userId, otherUserId);
  db.prepare('DELETE FROM recipes WHERE author_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userId, otherUserId);
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)'
  );
  insertUser.run(userId, 'recipe-levels@test.local', 'Recipe test', 'synthetic-hash');
  insertUser.run(
    otherUserId,
    'recipe-book-other@test.local',
    'Other recipe user',
    'synthetic-hash'
  );
  ensureRecipeBookCatalog(db);
});

afterAll(() => closeDatabase?.());

describe('POST /api/recipes recipe instruction storage', () => {
  it('bounds total JSON bytes on recipe creation and editing', async () => {
    const longBody = 'x'.repeat(MAX_RECIPE_CONTENT_REQUEST_BYTES + 1);
    const [created, edited] = await Promise.all([
      call('POST', '', { name: longBody }),
      call('PATCH', '/missing-recipe', { description: longBody })
    ]);

    expect([created.status, edited.status]).toEqual([413, 413]);
    expect(created.payload.code).toBe('RECIPE_CONTENT_BODY_TOO_LARGE');
    expect(edited.payload.code).toBe('RECIPE_CONTENT_BODY_TOO_LARGE');
  });

  it('persists and reloads recipe content longer than the former character caps', async () => {
    const longText = 'x'.repeat(2_501);
    const created = await call('POST', '', {
      name: longText,
      description: longText,
      cuisine: longText,
      ingredients: [
        {
          name: longText,
          quantity: 1,
          unit: 'g',
          preparation: longText,
          substitutes: [longText],
          notes: longText
        }
      ],
      steps: [{ stepNumber: 1, instruction: longText, tips: longText, warning: longText }],
      guidance: {
        appliances: [longText],
        parallelTasks: [longText],
        tipsAndVariations: [longText],
        batchCookingWarning: longText
      },
      storage: {
        method: longText,
        duration: longText,
        reheatingInstructions: longText,
        container: longText,
        freezingPossible: true,
        freezingDuration: longText
      },
      tags: [longText]
    });
    const recipeId = created.payload.data.id as string;
    const loaded = await call('GET', `/${recipeId}`);

    expect(created.status).toBe(201);
    expect(loaded.status).toBe(200);
    expect(loaded.payload.data).toMatchObject({
      name: longText,
      description: longText,
      cuisine: longText,
      ingredients: [
        {
          name: longText,
          preparation: longText,
          substitutes: [longText],
          notes: longText
        }
      ],
      steps: [{ instruction: longText, tips: longText, warning: longText }],
      guidance: { batchCookingWarning: longText },
      storage: { method: longText, reheatingInstructions: longText },
      tags: [longText]
    });
  });

  it('searches without a draft recipe id, persists only a validated video id and plays after cache loss', async () => {
    const mediaUrl =
      'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Chop.webm/Chop.webm.360p.vp9.webm';
    const videoId = createHash('sha256').update(mediaUrl).digest('hex').slice(0, 24);
    const video = {
      id: videoId,
      title: 'Corte de verduras',
      author: 'Autora Commons',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Chop.webm',
      thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/chop.jpg',
      durationSeconds: 20,
      sizeBytes: 680000,
      mimeType: 'video/webm' as const,
      mediaUrl
    };
    const searchSpy = vi.spyOn(recipeStepVideoProvider, 'search').mockResolvedValue([video]);
    const candidateSpy = vi
      .spyOn(recipeStepVideoProvider, 'getSelectedVideo')
      .mockReturnValue(video);
    const search = await app.request('/api/recipes/step-videos/search?scene=cut', {
      headers: { authorization: `Bearer ${token}` }
    });
    const searchData = (await search.json()) as { data: Array<Record<string, unknown>> };
    const created = await call('POST', '', {
      name: 'Receta con clip persistente',
      ingredients: [{ name: 'Zanahoria', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Cortar la zanahoria.', videoId }]
    });

    expect(search.status).toBe(200);
    expect(searchData.data[0]).toMatchObject({ id: videoId, author: video.author });
    expect(searchData.data[0]).not.toHaveProperty('streamUrl');
    expect(created.status).toBe(201);
    const recipeId = created.payload.data.id as string;
    const storedSteps = db.prepare('SELECT steps FROM recipes WHERE id = ?').get(recipeId) as {
      steps: string;
    };
    expect(storedSteps.steps).toContain(videoId);
    expect(storedSteps.steps).not.toContain('upload.wikimedia.org');
    expect(storedSteps.steps).not.toContain('commons.wikimedia.org');
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM recipe_step_video_assets WHERE recipe_id = ?')
        .get(recipeId)
    ).toMatchObject({ count: 1 });

    // Simulate an API process restart: its candidate cache is empty, while SQLite still owns the selection.
    candidateSpy.mockReturnValue(null);
    const loaded = await call('GET', `/${recipeId}`);
    expect(loaded.status).toBe(200);
    expect(loaded.payload.data.steps[0]).toMatchObject({
      videoId,
      videoAttribution: {
        title: video.title,
        author: video.author,
        licenseName: video.licenseName,
        sourceUrl: video.sourceUrl,
        thumbnailUrl: video.thumbnailUrl
      }
    });
    const editedAfterReload = await call('PATCH', `/${recipeId}`, {
      steps: [{ stepNumber: 1, instruction: 'Cortar con cuidado.', videoId }]
    });
    expect(editedAfterReload.status).toBe(200);
    expect(editedAfterReload.payload.data.steps[0]).toMatchObject({
      instruction: 'Cortar con cuidado.',
      videoId,
      videoAttribution: { author: video.author }
    });

    const playbackBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      }
    });
    const playbackSpy = vi.spyOn(recipeStepVideoProvider, 'openStoredStream').mockResolvedValue({
      body: playbackBody,
      mimeType: 'video/webm',
      contentRange: 'bytes 0-2/680000',
      contentLength: 3
    });
    const playbackGrant = await app.request(
      `/api/recipes/${recipeId}/step-videos/${videoId}/playback`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          origin: 'http://localhost:4200',
          'sec-fetch-site': 'same-site',
          'content-type': 'application/json'
        },
        body: '{}'
      }
    );
    const playbackCookie = playbackGrant.headers.get('set-cookie')?.split(';', 1)[0];
    expect(playbackGrant.status).toBe(201);
    expect(playbackCookie).toBeTruthy();
    const playback = await app.request(`/api/recipes/${recipeId}/step-videos/${videoId}/stream`, {
      headers: { cookie: playbackCookie!, Range: 'bytes=0-2' }
    });

    expect(playback.status).toBe(206);
    expect(playbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: videoId, mediaUrl }),
      { start: 0, end: 2 },
      expect.any(AbortSignal)
    );
    expect(Array.from(new Uint8Array(await playback.arrayBuffer()))).toEqual([1, 2, 3]);
    const removed = await call('PATCH', `/${recipeId}`, {
      steps: [{ stepNumber: 1, instruction: 'Cortar sin vídeo.' }]
    });
    expect(removed.status).toBe(200);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM recipe_step_video_assets WHERE recipe_id = ?')
        .get(recipeId)
    ).toMatchObject({ count: 0 });
    const stalePlayback = await app.request(
      `/api/recipes/${recipeId}/step-videos/${videoId}/stream`,
      {
        headers: { cookie: playbackCookie!, Range: 'bytes=0-2' }
      }
    );
    expect(stalePlayback.status).toBe(404);
    searchSpy.mockRestore();
    candidateSpy.mockRestore();
    playbackSpy.mockRestore();
  });

  it('rejects expired or invented video ids before creating a recipe', async () => {
    const videoId = 'e'.repeat(24);
    const candidateSpy = vi
      .spyOn(recipeStepVideoProvider, 'getSelectedVideo')
      .mockReturnValue(null);
    const before = (
      db
        .prepare('SELECT COUNT(*) AS count FROM recipes WHERE name = ?')
        .get('Receta con clip inválido') as { count: number }
    ).count;
    const result = await call('POST', '', {
      name: 'Receta con clip inválido',
      ingredients: [{ name: 'Zanahoria', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Cortar.', videoId }]
    });
    const after = (
      db
        .prepare('SELECT COUNT(*) AS count FROM recipes WHERE name = ?')
        .get('Receta con clip inválido') as { count: number }
    ).count;

    expect(result.status).toBe(400);
    expect(result.payload.message).toContain('video');
    expect(after).toBe(before);
    candidateSpy.mockRestore();
  });

  it('persists the allowed recipe origin without changing personal ownership', async () => {
    const manual = await call('POST', '', {
      name: 'Origen QA manual',
      ingredients: [{ name: 'Ingrediente', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const generated = await call('POST', '', {
      name: 'Origen QA IA',
      author: 'ai',
      ingredients: [{ name: 'Ingrediente', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const catalog = await call('POST', '', {
      name: 'Origen QA editorial no permitido',
      author: 'catalog',
      ingredients: [{ name: 'Ingrediente', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });

    expect(manual.status).toBe(201);
    expect(manual.payload.data).toMatchObject({ author: 'user', authorId: userId });
    expect(generated.status).toBe(201);
    expect(generated.payload.data).toMatchObject({ author: 'ai', authorId: userId });
    expect(catalog.status).toBe(400);

    const favorite = await call('POST', `/${generated.payload.data.id}/favorite`);
    const aiFavorites = await call('GET', '?author=ai&isFavorite=true&pageSize=100');
    const otherAiFavorites = await callAs(
      otherToken,
      'GET',
      '?author=ai&isFavorite=true&pageSize=100'
    );
    const edited = await call('PATCH', `/${generated.payload.data.id}`, {
      name: 'Origen QA IA editable',
      author: 'catalog'
    });
    const otherRecipe = await callAs(otherToken, 'GET', `/${generated.payload.data.id}`);

    expect(favorite.payload.data.isFavorite).toBe(true);
    expect(aiFavorites.payload.data.recipes.map((recipe: any) => recipe.id)).toContain(
      generated.payload.data.id
    );
    expect(otherAiFavorites.payload.data.recipes.map((recipe: any) => recipe.id)).not.toContain(
      generated.payload.data.id
    );
    expect(edited.status).toBe(200);
    expect(edited.payload.data).toMatchObject({
      name: 'Origen QA IA editable',
      author: 'ai',
      authorId: userId,
      isFavorite: true
    });
    expect(otherRecipe.status).toBe(404);

    const persisted = db
      .prepare('SELECT author, author_id FROM recipes WHERE id = ?')
      .get(generated.payload.data.id) as { author: string; author_id: string };
    expect(persisted).toEqual({ author: 'ai', author_id: userId });
  });

  it('stores one canonical map and returns it after reloading the recipe', async () => {
    const created = await call('POST', '', {
      name: 'Crema sintética',
      description: 'Fixture.',
      cuisine: 'cocina de prueba',
      countryCode: 'mx',
      ingredients: [{ name: 'Zanahoria', quantity: 2, unit: 'unit' }],
      instructionsByLevel
    });

    expect(created.status).toBe(201);
    expect(created.payload.data.instructionsByLevel).toEqual(instructionsByLevel);
    expect(created.payload.data.countryCode).toBe('MX');
    expect(created.payload.data.cuisine).toBe('cocina de prueba');
    expect(created.payload.data).not.toHaveProperty('steps');
    expect(created.payload.data.ingredients).toHaveLength(1);
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE author_id = ?').get(userId) as {
          count: number;
        }
      ).count
    ).toBe(1);

    const persisted = db
      .prepare('SELECT steps FROM recipes WHERE id = ?')
      .get(created.payload.data.id) as {
      steps: string;
    };
    expect(JSON.parse(persisted.steps)).toEqual(instructionsByLevel);

    const reloaded = await call('GET', `/${created.payload.data.id}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.payload.data.instructionsByLevel).toEqual(instructionsByLevel);
    expect(reloaded.payload.data).not.toHaveProperty('steps');
  });

  it('persists the full cooking guidance without duplicating ingredients or instructions', async () => {
    const created = await call('POST', '', {
      name: 'Receta detallada sintética',
      description: 'Ficha completa de prueba.',
      servings: 2,
      ingredients: [{ name: 'Tomate', quantity: 2, unit: 'unit', preparation: 'lavados' }],
      utensils: ['cuchillo'],
      guidance: recipeGuidance,
      instructionsByLevel
    });

    expect(created.status).toBe(201);
    expect(created.payload.data.guidance).toEqual(recipeGuidance);
    expect(created.payload.data.ingredients).toHaveLength(1);
    expect(created.payload.data.instructionsByLevel).toEqual(instructionsByLevel);

    const persisted = db
      .prepare('SELECT recipe_guidance FROM recipes WHERE id = ?')
      .get(created.payload.data.id) as { recipe_guidance: string };
    expect(JSON.parse(persisted.recipe_guidance)).toEqual(recipeGuidance);

    const reloaded = await call('GET', `/${created.payload.data.id}`);
    expect(reloaded.payload.data.guidance).toEqual(recipeGuidance);
    expect(reloaded.payload.data.ingredients).toHaveLength(1);
    expect(reloaded.payload.data.instructionsByLevel).toEqual(instructionsByLevel);
  });

  it('keeps legacy saved recipes with a flat steps array readable', async () => {
    const legacySteps = [
      { stepNumber: 1, instruction: 'Preparación anterior.', timerRequired: false }
    ];
    const created = await call('POST', '', {
      name: 'Receta antigua',
      ingredients: [{ name: 'Zanahoria', quantity: 2, unit: 'unit' }],
      steps: legacySteps
    });

    expect(created.status).toBe(201);
    expect(created.payload.data.steps).toEqual(legacySteps);
    expect(created.payload.data).not.toHaveProperty('instructionsByLevel');
    const reloaded = await call('GET', `/${created.payload.data.id}`);
    expect(reloaded.payload.data.steps).toEqual(legacySteps);
  });

  it('does not accept both representations or a partial level map', async () => {
    const both = await call('POST', '', {
      name: 'Duplicada',
      ingredients: [{ name: 'Zanahoria', quantity: 2, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Cocer.' }],
      instructionsByLevel
    });
    const partial = await call('POST', '', {
      name: 'Incompleta',
      ingredients: [{ name: 'Zanahoria', quantity: 2, unit: 'unit' }],
      instructionsByLevel: { basic: instructionsByLevel.basic }
    });

    expect(both.status).toBe(400);
    expect(partial.status).toBe(400);
    expect(
      (
        db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE author_id = ?').get(userId) as {
          count: number;
        }
      ).count
    ).toBe(0);
  });
});

describe('PATCH /api/recipes/:id/assistant-update', () => {
  it('applies a reviewed content patch once and returns the stored recipe on exact replay', async () => {
    const created = await call('POST', '', {
      name: 'Lentejas de prueba',
      servings: 2,
      ingredients: [
        { name: 'Cebolla', quantity: 100, unit: 'g' },
        { name: 'Lentejas', quantity: 200, unit: 'g' }
      ],
      steps: [
        { stepNumber: 1, instruction: 'Corta la cebolla.', tips: 'Usa un cuchillo afilado.' },
        { stepNumber: 2, instruction: 'Cuece las lentejas.', duration: 30 }
      ]
    });
    const recipe = created.payload.data as Record<string, any>;
    const targetId = String(recipe.id);
    const before = {
      name: recipe.name,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      steps: recipe.steps
    };
    const request = {
      changes: {
        servings: null,
        ingredients: [{ operation: 'update', targetName: 'Cebolla', changes: { quantity: 75 } }],
        instructions: [{ level: 'legacy', stepNumber: 2, instruction: 'Cocina a fuego lento.' }]
      },
      assistantAction: { operation: 'update_recipe_content', targetId, before }
    };
    const headers = { 'x-assistant-action-id': '8c4508e8-0a26-42f2-936a-7ccf2204d9e2' };

    const first = await call('PATCH', `/${targetId}/assistant-update`, request, headers);
    expect(first.status).toBe(200);
    expect(first.payload).toMatchObject({
      success: true,
      data: {
        steps: [
          { instruction: 'Corta la cebolla.', tips: 'Usa un cuchillo afilado.' },
          { instruction: 'Cocina a fuego lento.', duration: 30 }
        ]
      }
    });
    expect(first.payload.data.ingredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 75 }),
        expect.objectContaining({ name: 'Lentejas', quantity: 200 })
      ])
    );

    const replay = await call('PATCH', `/${targetId}/assistant-update`, request, headers);
    expect(replay.status).toBe(200);
    expect(replay.payload).toMatchObject({ success: true, idempotent: true });
    expect((await call('GET', `/${targetId}`)).payload.data.ingredients[0].quantity).toBe(75);

    const conflictingReplay = await call(
      'PATCH',
      `/${targetId}/assistant-update`,
      {
        ...request,
        changes: {
          ...request.changes,
          ingredients: [{ operation: 'update', targetName: 'Cebolla', changes: { quantity: 80 } }]
        }
      },
      headers
    );
    expect(conflictingReplay.status).toBe(409);
    expect(conflictingReplay.payload.code).toBe('ASSISTANT_ACTION_ID_CONFLICT');
    expect((await call('GET', `/${targetId}`)).payload.data.ingredients[0].quantity).toBe(75);
  });

  it('scales stored ingredient quantities for serving changes and rejects stale preimages', async () => {
    const created = await call('POST', '', {
      name: 'Arroz de prueba',
      servings: 2,
      ingredients: [
        { name: 'Arroz', quantity: 80, unit: 'g' },
        { name: 'Agua', quantity: 160, unit: 'ml' }
      ],
      steps: [{ stepNumber: 1, instruction: 'Cuece el arroz.' }]
    });
    const recipe = created.payload.data as Record<string, any>;
    const targetId = String(recipe.id);
    const before = {
      name: recipe.name,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      steps: recipe.steps
    };
    const request = {
      changes: { servings: 4, ingredients: [], instructions: [] },
      assistantAction: { operation: 'update_recipe_content', targetId, before }
    };
    const headers = { 'x-assistant-action-id': 'eb314cc9-91a4-409a-a62c-037ae8886cf3' };

    const response = await call('PATCH', `/${targetId}/assistant-update`, request, headers);
    expect(response.status).toBe(200);
    expect(response.payload.data).toMatchObject({
      servings: 4,
      ingredients: [
        { name: 'Arroz', quantity: 160 },
        { name: 'Agua', quantity: 320 }
      ]
    });

    const stale = await call('PATCH', `/${targetId}/assistant-update`, request, {
      'x-assistant-action-id': '1ce571f4-6de2-4658-a9f4-ad0cd87601ab'
    });
    expect(stale.status).toBe(409);
    expect(stale.payload.code).toBe('ASSISTANT_RECIPE_STALE');
    expect((await call('GET', `/${targetId}`)).payload.data.servings).toBe(4);
  });

  it('adds and removes ingredients while editing a nested instruction without losing metadata', async () => {
    const created = await call('POST', '', {
      name: 'Guiso por niveles',
      servings: 2,
      ingredients: [
        { name: 'Cebolla', quantity: 100, unit: 'g' },
        { name: 'Lentejas', quantity: 200, unit: 'g' }
      ],
      instructionsByLevel: {
        basic: [{ stepNumber: 1, instruction: 'Sofríe.', duration: 5, timerRequired: false }],
        intermediate: [{ stepNumber: 1, instruction: 'Añade lentejas.', timerRequired: false }],
        expert: [{ stepNumber: 1, instruction: 'Ajusta el fuego.', timerRequired: false }]
      }
    });
    const recipe = created.payload.data as Record<string, any>;
    const targetId = String(recipe.id);
    const before = {
      name: recipe.name,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      steps: recipe.steps ?? recipe.instructionsByLevel
    };
    const response = await call(
      'PATCH',
      `/${targetId}/assistant-update`,
      {
        changes: {
          servings: null,
          ingredients: [
            { operation: 'remove', targetName: 'Cebolla' },
            {
              operation: 'add',
              ingredient: {
                name: 'Ajo',
                quantity: 2,
                unit: 'piece',
                preparation: null,
                isOptional: false,
                substitutes: [],
                notes: null
              }
            }
          ],
          instructions: [{ level: 'basic', stepNumber: 1, instruction: 'Dora el ajo.' }]
        },
        assistantAction: { operation: 'update_recipe_content', targetId, before }
      },
      { 'x-assistant-action-id': 'd7f66d02-4695-4ae0-946c-3ee153b8f7c4' }
    );

    expect(response.status, JSON.stringify(response.payload)).toBe(200);
    const stored = db
      .prepare('SELECT ingredients, steps FROM recipes WHERE id = ?')
      .get(targetId) as {
      ingredients: string;
      steps: string;
    };
    expect(JSON.parse(stored.ingredients)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Lentejas', quantity: 200 }),
        expect.objectContaining({ name: 'Ajo', quantity: 2 })
      ])
    );
    expect(JSON.parse(stored.ingredients)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Cebolla' })])
    );
    expect(JSON.parse(stored.steps).basic[0]).toMatchObject({
      instruction: 'Dora el ajo.',
      duration: 5,
      timerRequired: false
    });
  });

  it('rejects missing action keys, another owner, stale references and last-ingredient removal without mutation', async () => {
    const created = await call('POST', '', {
      name: 'Receta propia protegida',
      servings: 1,
      ingredients: [{ name: 'Ajo', quantity: 1, unit: 'piece' }],
      steps: [{ stepNumber: 1, instruction: 'Pela el ajo.' }]
    });
    const recipe = created.payload.data as Record<string, any>;
    const targetId = String(recipe.id);
    const before = {
      name: recipe.name,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      steps: recipe.steps
    };
    const body = {
      changes: { servings: null, ingredients: [], instructions: [] },
      assistantAction: { operation: 'update_recipe_content', targetId, before }
    };
    expect((await call('PATCH', `/${targetId}/assistant-update`, body)).status).toBe(400);
    expect(
      (
        await call('PATCH', `/${targetId}/assistant-update`, body, {
          'x-assistant-action-id': 'not-a-uuid'
        })
      ).status
    ).toBe(400);

    const foreign = await callAs(
      otherToken,
      'PATCH',
      `/${targetId}/assistant-update`,
      {
        ...body,
        changes: {
          servings: null,
          ingredients: [{ operation: 'remove', targetName: 'Ajo' }],
          instructions: []
        }
      },
      { 'x-assistant-action-id': 'dd5d3eb1-c9d0-4161-95aa-767090a1f0d2' }
    );
    expect(foreign.status).toBe(403);

    const lastIngredient = await call(
      'PATCH',
      `/${targetId}/assistant-update`,
      {
        ...body,
        changes: {
          servings: null,
          ingredients: [{ operation: 'remove', targetName: 'Ajo' }],
          instructions: []
        }
      },
      { 'x-assistant-action-id': '5ca04bd3-a51b-4be8-a27a-ade8b7e79cf8' }
    );
    expect(lastIngredient.status, JSON.stringify(lastIngredient.payload)).toBe(409);
    expect(lastIngredient.payload.code).toBe('ASSISTANT_RECIPE_LAST_INGREDIENT');
    const unchanged = db
      .prepare('SELECT ingredients, steps FROM recipes WHERE id = ?')
      .get(targetId) as {
      ingredients: string;
      steps: string;
    };
    expect(JSON.parse(unchanged.ingredients)).toEqual(before.ingredients);
    expect(JSON.parse(unchanged.steps)).toEqual(before.steps);
  });

  it('rejects a missing second ingredient target without partially applying a valid first change', async () => {
    const created = await call('POST', '', {
      name: 'Receta parche atómico',
      ingredients: [{ name: 'Cebolla', quantity: 100, unit: 'g' }],
      steps: [{ stepNumber: 1, instruction: 'Corta la cebolla.' }]
    });
    const recipe = created.payload.data as Record<string, any>;
    const targetId = String(recipe.id);
    const before = {
      name: recipe.name,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      steps: recipe.steps
    };
    const response = await call(
      'PATCH',
      `/${targetId}/assistant-update`,
      {
        changes: {
          servings: null,
          ingredients: [
            { operation: 'update', targetName: 'Cebolla', changes: { quantity: 75 } },
            { operation: 'update', targetName: 'Ingrediente ausente', changes: { quantity: 2 } }
          ],
          instructions: []
        },
        assistantAction: { operation: 'update_recipe_content', targetId, before }
      },
      { 'x-assistant-action-id': '49f72b92-9ee4-4856-9d16-6461e0498d39' }
    );

    expect(response.status).toBe(409);
    expect(response.payload.code).toBe('ASSISTANT_RECIPE_INGREDIENT_NOT_FOUND');
    expect((await call('GET', `/${targetId}`)).payload.data.ingredients[0].quantity).toBe(100);
  });
});

describe('GET /api/recipes filters for the recipe book', () => {
  it('filters fast, favorite and AI recipes by real persisted membership', async () => {
    const fast = await call('POST', '', {
      name: 'QA filtros rápidos manual',
      totalTime: 15,
      ingredients: [{ name: 'Ingrediente QA filtro', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const slow = await call('POST', '', {
      name: 'QA filtros lentos manual',
      totalTime: 60,
      ingredients: [{ name: 'Ingrediente QA filtro', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const generated = await call('POST', '', {
      name: 'QA filtros rápidos IA',
      author: 'ai',
      totalTime: 30,
      ingredients: [{ name: 'Ingrediente QA filtro', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    await call('POST', `/${fast.payload.data.id}/favorite`);

    const query = 'search=QA%20filtros';
    const all = await call('GET', `?${query}&pageSize=100`);
    const favorites = await call('GET', `?${query}&isFavorite=true&pageSize=100`);
    const quick = await call('GET', `?${query}&maxTime=30&pageSize=100`);
    const ai = await call('GET', `?${query}&author=ai&pageSize=100`);

    const ids = (result: typeof all) => result.payload.data.recipes.map((recipe: any) => recipe.id);
    expect(ids(all)).toEqual(
      expect.arrayContaining([
        fast.payload.data.id,
        slow.payload.data.id,
        generated.payload.data.id
      ])
    );
    expect(ids(favorites)).toEqual([fast.payload.data.id]);
    expect(ids(quick)).toEqual(
      expect.arrayContaining([fast.payload.data.id, generated.payload.data.id])
    );
    expect(ids(quick)).not.toContain(slow.payload.data.id);
    expect(ids(ai)).toEqual([generated.payload.data.id]);
    expect(generated.payload.data.authorId).toBe(userId);
  });

  it('filters by explicit country and any selected meal type, and searches ingredients', async () => {
    const result = await call(
      'GET',
      '?countryCode=ES&mealTypes=breakfast,dinner&search=patata&page=1&pageSize=100'
    );

    expect(result.status).toBe(200);
    expect(
      result.payload.data.recipes.some(
        (recipe: any) => recipe.id === 'recipe-catalog-es-tortilla-patatas'
      )
    ).toBe(true);
    expect(result.payload.data.recipes.every((recipe: any) => recipe.countryCode === 'ES')).toBe(
      true
    );
  });

  it('combines country, meal type and cuisine without conflating cuisine with country', async () => {
    const result = await call(
      'GET',
      '?countryCode=SV&mealTypes=breakfast,dinner&cuisine=salvadore%C3%B1a&pageSize=100'
    );

    expect(result.status).toBe(200);
    expect(result.payload.data.recipes.length).toBeGreaterThanOrEqual(1);
    expect(result.payload.data.recipes.every((recipe: any) => recipe.countryCode === 'SV')).toBe(
      true
    );
  });

  it('scopes the book to editorial catalog rows without leaking personal recipes into it', async () => {
    const created = await call('POST', '', {
      name: 'Receta privada fuera del libro',
      ingredients: [{ name: 'Ingrediente sintético', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const result = await call('GET', '?catalogOnly=true&pageSize=100');

    expect(result.status).toBe(200);
    expect(result.payload.data.recipes.length).toBeGreaterThanOrEqual(12);
    expect(result.payload.data.recipes.every((recipe: any) => recipe.author === 'catalog')).toBe(
      true
    );
    expect(
      result.payload.data.recipes.some((recipe: any) => recipe.id === created.payload.data.id)
    ).toBe(false);
  });
});

describe('catálogo editorial y datos personales', () => {
  it('recupera el catálogo si falta en una base aislada al consultar el libro', async () => {
    db.prepare(
      "DELETE FROM user_recipes WHERE recipe_id IN (SELECT id FROM recipes WHERE author = 'catalog')"
    ).run();
    db.prepare("DELETE FROM recipes WHERE author = 'catalog'").run();

    const result = await call('GET', '?pageSize=100');

    expect(result.status).toBe(200);
    expect(
      result.payload.data.recipes.filter((recipe: any) => recipe.author === 'catalog')
    ).toHaveLength(12);
    expect(ensureRecipeBookCatalog(db)).toBe(0);
  });

  it('expone seis o más recetas por país con atribución y sin URL de imagen inventada', async () => {
    const result = await call('GET', '?pageSize=100');
    const recipes = result.payload.data.recipes;
    const countFor = (countryCode: string) =>
      recipes.filter((recipe: any) => recipe.countryCode === countryCode);

    expect(result.status).toBe(200);
    expect(countFor('ES').length).toBeGreaterThanOrEqual(6);
    expect(countFor('SV').length).toBeGreaterThanOrEqual(6);
    for (const recipe of [...countFor('ES'), ...countFor('SV')]) {
      expect(recipe.author).toBe('catalog');
      expect(recipe.catalogKey).toBeTruthy();
      expect(recipe.sourceAttribution).toMatchObject({
        publisher: expect.any(String),
        url: expect.stringMatching(/^https:\/\//)
      });
      expect(recipe.image).toBeNull();
      expect(recipe.instructionsByLevel).toEqual(
        expect.objectContaining({
          basic: expect.any(Array),
          intermediate: expect.any(Array),
          expert: expect.any(Array)
        })
      );
    }
  });

  it('oculta recetas privadas de otros usuarios y mantiene favoritos personales por usuario', async () => {
    const created = await call('POST', '', {
      name: 'Receta privada de prueba',
      ingredients: [{ name: 'Ingrediente sintético', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const id = created.payload.data.id;

    expect((await callAs(otherToken, 'GET', `/${id}`)).status).toBe(404);
    const otherList = await callAs(otherToken, 'GET', '?pageSize=100');
    expect(otherList.payload.data.recipes.some((recipe: any) => recipe.id === id)).toBe(false);

    const favoritePath = '/recipe-catalog-es-tortilla-patatas/favorite';
    expect((await call('POST', favoritePath)).payload.data.isFavorite).toBe(true);
    const ownerFavorites = await call('GET', '?isFavorite=true&pageSize=100');
    const otherFavorites = await callAs(otherToken, 'GET', '?isFavorite=true&pageSize=100');
    expect(ownerFavorites.payload.data.recipes.map((recipe: any) => recipe.id)).toContain(
      'recipe-catalog-es-tortilla-patatas'
    );
    expect(otherFavorites.payload.data.recipes.map((recipe: any) => recipe.id)).not.toContain(
      'recipe-catalog-es-tortilla-patatas'
    );

    const globalFavorite = db
      .prepare('SELECT is_favorite FROM recipes WHERE id = ?')
      .get('recipe-catalog-es-tortilla-patatas') as { is_favorite: number };
    expect(globalFavorite.is_favorite).toBe(0);
  });

  it('impide editar o borrar una receta editorial aunque sí permite marcarla favorita', async () => {
    const before = db
      .prepare('SELECT name FROM recipes WHERE id = ?')
      .get('recipe-catalog-es-tortilla-patatas') as { name: string };

    expect(
      (await call('PATCH', '/recipe-catalog-es-tortilla-patatas', { name: 'Título sustituido' }))
        .status
    ).toBe(403);
    expect((await call('DELETE', '/recipe-catalog-es-tortilla-patatas')).status).toBe(403);
    expect(
      (
        db
          .prepare('SELECT name FROM recipes WHERE id = ?')
          .get('recipe-catalog-es-tortilla-patatas') as { name: string }
      ).name
    ).toBe(before.name);
    expect((await call('POST', '/recipe-catalog-es-tortilla-patatas/favorite')).status).toBe(200);
  });

  it('mantiene edición, favoritos, historial y borrado dentro de la receta propia', async () => {
    const created = await call('POST', '', {
      name: 'Prueba privada',
      countryCode: 'es',
      servings: 4,
      ingredients: [{ name: 'Ingrediente sintético', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const id = created.payload.data.id;

    expect(
      (
        await call('PATCH', `/${id}`, {
          name: 'Prueba actualizada',
          countryCode: 'sv',
          isFavorite: true
        })
      ).status
    ).toBe(200);
    expect((await call('GET', `/${id}`)).payload.data).toMatchObject({
      name: 'Prueba actualizada',
      countryCode: 'SV',
      isFavorite: true,
      timesCooked: 0
    });
    expect((await callAs(otherToken, 'POST', `/${id}/cook`)).status).toBe(404);
    expect(
      (await callAs(otherToken, 'POST', `/${id}/adjust-servings`, { servings: 2 })).status
    ).toBe(404);

    const adjusted = await call('POST', `/${id}/adjust-servings`, { servings: 2 });
    expect(adjusted.payload.data.ingredients[0].quantity).toBe(0.5);
    expect((await call('POST', `/${id}/cook`)).status).toBe(200);
    expect((await call('POST', `/${id}/cook`)).status).toBe(200);
    expect((await call('GET', `/${id}`)).payload.data.timesCooked).toBe(2);
    expect(
      (
        db.prepare('SELECT times_cooked FROM recipes WHERE id = ?').get(id) as {
          times_cooked: number;
        }
      ).times_cooked
    ).toBe(0);
    expect((await callAs(otherToken, 'DELETE', `/${id}`)).status).toBe(404);
    expect((await call('DELETE', `/${id}`)).status).toBe(200);
    expect((await call('GET', `/${id}`)).status).toBe(404);
  });

  it('valida y almacena una foto buscada localmente con su atribución al guardar la receta', async () => {
    const photoId = 'b'.repeat(24);
    const photo = {
      id: photoId,
      altText: 'Tortilla de patatas cortada',
      author: 'María',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tortilla.jpg'
    };
    const photoProvider = await import('../utils/recipe-step-photos.js');
    const getPhoto = vi
      .spyOn(photoProvider.recipeStepPhotoProvider, 'getPhoto')
      .mockReturnValue(photo);
    const getImage = vi.spyOn(photoProvider.recipeStepPhotoProvider, 'getImage').mockResolvedValue({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg'
    });
    try {
      const created = await call('POST', '', {
        name: 'Tortilla de prueba',
        ingredients: [{ name: 'Patata', quantity: 200, unit: 'g' }],
        instructionsByLevel
      });
      const id = created.payload.data.id;

      const updated = await call('PATCH', `/${id}`, { imagePhotoId: photoId });

      expect(updated.status).toBe(200);
      expect(updated.payload.data).toMatchObject({
        image: `/api/recipe-images/${photoId}`,
        imageAttribution: {
          altText: photo.altText,
          author: photo.author,
          licenseName: photo.licenseName,
          licenseUrl: photo.licenseUrl,
          sourceUrl: photo.sourceUrl
        }
      });
      expect(
        db
          .prepare('SELECT image_data, mime_type, author FROM recipe_image_assets WHERE id = ?')
          .get(photoId)
      ).toMatchObject({
        image_data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        mime_type: 'image/jpeg',
        author: 'María'
      });
      expect(getPhoto).toHaveBeenCalledWith(photoId);
      expect(getImage).toHaveBeenCalledWith(photoId);
    } finally {
      getPhoto.mockRestore();
      getImage.mockRestore();
    }
  });

  it('guarda una foto seleccionada de un paso como asset local con atribución verificada', async () => {
    const photoId = 'c'.repeat(24);
    const photo = {
      id: photoId,
      altText: 'Cebolla picada en una tabla',
      author: 'María',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cebolla.jpg'
    };
    const provider = await import('../utils/recipe-step-photos.js');
    const getPhoto = vi.spyOn(provider.recipeStepPhotoProvider, 'getPhoto').mockReturnValue(photo);
    const getImage = vi.spyOn(provider.recipeStepPhotoProvider, 'getImage').mockResolvedValue({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg'
    });
    try {
      const created = await call('POST', '', {
        name: 'Tortilla para editar',
        ingredients: [{ name: 'Cebolla', quantity: 1, unit: 'unit' }],
        instructionsByLevel
      });
      const id = created.payload.data.id;
      const selected = {
        ...instructionsByLevel,
        basic: [{ ...instructionsByLevel.basic[0], imagePhotoId: photoId }]
      };

      const updated = await call('PATCH', `/${id}`, { instructionsByLevel: selected });

      expect(updated.status).toBe(200);
      expect(updated.payload.data.instructionsByLevel.basic[0]).toMatchObject({
        image: `/api/recipe-images/${photoId}`,
        imageAttribution: {
          altText: photo.altText,
          author: photo.author,
          licenseName: photo.licenseName,
          licenseUrl: photo.licenseUrl,
          sourceUrl: photo.sourceUrl
        }
      });
      expect(updated.payload.data.instructionsByLevel.basic[0]).not.toHaveProperty('imagePhotoId');
      expect(
        db
          .prepare('SELECT image_data, mime_type, author FROM recipe_image_assets WHERE id = ?')
          .get(photoId)
      ).toMatchObject({
        image_data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        mime_type: 'image/jpeg',
        author: 'María'
      });
      expect(getPhoto).toHaveBeenCalledWith(photoId);
      expect(getImage).toHaveBeenCalledWith(photoId);
    } finally {
      getPhoto.mockRestore();
      getImage.mockRestore();
    }
  });

  it('rechaza una foto de paso caducada sin aplicar ni persistir el resto de la edición', async () => {
    const photoId = 'd'.repeat(24);
    const provider = await import('../utils/recipe-step-photos.js');
    const getPhoto = vi.spyOn(provider.recipeStepPhotoProvider, 'getPhoto').mockReturnValue(null);
    const getImage = vi.spyOn(provider.recipeStepPhotoProvider, 'getImage');
    try {
      const created = await call('POST', '', {
        name: 'Receta sin modificar',
        ingredients: [{ name: 'Cebolla', quantity: 1, unit: 'unit' }],
        instructionsByLevel
      });
      const id = created.payload.data.id;
      const update = await call('PATCH', `/${id}`, {
        name: 'No debe guardarse',
        instructionsByLevel: {
          ...instructionsByLevel,
          basic: [{ ...instructionsByLevel.basic[0], imagePhotoId: photoId }]
        }
      });

      expect(update.status).toBe(400);
      expect(update.payload.message).toContain('expired');
      const unchanged = await call('GET', `/${id}`);
      expect(unchanged.payload.data.name).toBe('Receta sin modificar');
      expect(unchanged.payload.data.instructionsByLevel.basic[0]).not.toHaveProperty('image');
      expect(
        db.prepare('SELECT 1 FROM recipe_image_assets WHERE id = ?').get(photoId)
      ).toBeUndefined();
      expect(getPhoto).toHaveBeenCalledWith(photoId);
      expect(getImage).not.toHaveBeenCalled();
    } finally {
      getPhoto.mockRestore();
      getImage.mockRestore();
    }
  });

  it('actualiza toda una receta propia sin perder niveles, estado del usuario ni crear duplicados', async () => {
    const original = await call('POST', '', {
      name: 'Tortitas de prueba',
      description: 'Descripción antigua',
      difficulty: 'easy',
      cuisine: 'española',
      countryCode: 'ES',
      mealType: ['snack'],
      totalTime: 20,
      prepTime: 5,
      cookTime: 15,
      restTime: 0,
      servings: 2,
      calories: 300,
      image: 'https://images.example.test/cover-old.jpg',
      ingredients: [{ name: 'Harina', quantity: 100, unit: 'g' }],
      utensils: ['Bol'],
      guidance: recipeGuidance,
      instructionsByLevel,
      nutrition: { calories: 300, protein: 10, carbs: 40, fat: 10 },
      storage: { method: 'Refrigerar', duration: '2 días', freezingPossible: false },
      tags: ['merienda']
    });
    const id = original.payload.data.id;
    await call('POST', `/${id}/favorite`);
    await call('POST', `/${id}/cook`);

    const replacementInstructions = {
      basic: [{ stepNumber: 1, instruction: 'Mezcla y cocina.' }],
      intermediate: [
        { stepNumber: 1, instruction: 'Bate la mezcla y cocina hasta dorar.' },
        { stepNumber: 2, instruction: 'Sirve templado.' }
      ],
      expert: [{ stepNumber: 1, instruction: 'Controla el calor para dorar uniformemente.' }]
    };
    const updated = await call('PATCH', `/${id}`, {
      name: 'Tortitas doradas',
      description: 'Descripción corregida',
      difficulty: 'medium',
      cuisine: 'salvadoreña',
      countryCode: 'SV',
      mealType: ['breakfast', 'snack'],
      totalTime: 35,
      prepTime: 10,
      cookTime: 20,
      restTime: 5,
      servings: 4,
      calories: 420,
      image: 'https://images.example.test/cover-new.jpg',
      ingredients: [
        {
          name: 'Maíz tierno',
          quantity: 350,
          unit: 'g',
          preparation: 'desgranado',
          isOptional: false,
          substitutes: ['maíz congelado'],
          notes: 'bien escurrido'
        },
        { name: 'Sal', quantity: 2, unit: 'g', isOptional: true, substitutes: [] }
      ],
      utensils: ['Comal', 'Bol'],
      guidance: {
        appliances: ['Cocina de gas'],
        parallelTasks: ['Precalienta el comal mientras mezclas.'],
        tipsAndVariations: ['Sirve con queso fresco.']
      },
      instructionsByLevel: replacementInstructions,
      nutrition: {
        calories: 420,
        protein: 12,
        carbs: 62,
        fat: 14,
        fiber: 6,
        sugar: 4,
        sodium: 190
      },
      storage: {
        method: 'Refrigerar una vez frías',
        container: 'Recipiente hermético',
        duration: '3 días',
        reheatingInstructions: 'Calentar en comal',
        freezingPossible: true,
        freezingDuration: '1 mes'
      },
      tags: ['desayuno', 'maíz'],
      isPublic: false
    });

    expect(updated.status).toBe(200);
    expect(updated.payload.data).toMatchObject({
      name: 'Tortitas doradas',
      description: 'Descripción corregida',
      difficulty: 'medium',
      cuisine: 'salvadoreña',
      countryCode: 'SV',
      mealType: ['breakfast', 'snack'],
      totalTime: 35,
      prepTime: 10,
      cookTime: 20,
      restTime: 5,
      servings: 4,
      calories: 420,
      image: 'https://images.example.test/cover-new.jpg',
      ingredients: [
        {
          name: 'Maíz tierno',
          quantity: 350,
          unit: 'g',
          preparation: 'desgranado',
          isOptional: false,
          substitutes: ['maíz congelado'],
          notes: 'bien escurrido'
        },
        { name: 'Sal', quantity: 2, unit: 'g', isOptional: true, substitutes: [] }
      ],
      utensils: ['Comal', 'Bol'],
      guidance: {
        appliances: ['Cocina de gas'],
        parallelTasks: ['Precalienta el comal mientras mezclas.'],
        tipsAndVariations: ['Sirve con queso fresco.']
      },
      instructionsByLevel: replacementInstructions,
      nutrition: {
        calories: 420,
        protein: 12,
        carbs: 62,
        fat: 14,
        fiber: 6,
        sugar: 4,
        sodium: 190
      },
      storage: {
        method: 'Refrigerar una vez frías',
        container: 'Recipiente hermético',
        duration: '3 días',
        reheatingInstructions: 'Calentar en comal',
        freezingPossible: true,
        freezingDuration: '1 mes'
      },
      tags: ['desayuno', 'maíz'],
      isPublic: false,
      isFavorite: true,
      timesCooked: 1
    });
    expect(updated.payload.data).not.toHaveProperty('steps');
    expect(
      (
        db.prepare('SELECT COUNT(*) AS total FROM recipes WHERE author_id = ?').get(userId) as {
          total: number;
        }
      ).total
    ).toBe(1);
  });

  it('rechaza mezclar pasos heredados y niveles detallados al editar', async () => {
    const created = await call('POST', '', {
      name: 'Receta de niveles',
      ingredients: [{ name: 'Ingrediente', quantity: 1, unit: 'unit' }],
      instructionsByLevel
    });
    const id = created.payload.data.id;
    const before = await call('GET', `/${id}`);

    const response = await call('PATCH', `/${id}`, {
      name: 'No debe guardarse',
      steps: [{ stepNumber: 1, instruction: 'Paso único.' }],
      instructionsByLevel
    });

    expect(response.status).toBe(400);
    expect((await call('GET', `/${id}`)).payload.data).toMatchObject({
      name: before.payload.data.name,
      instructionsByLevel: before.payload.data.instructionsByLevel
    });
  });

  it('deja una receta pública visible, pero impide que alguien distinto al autor la modifique o borre', async () => {
    const created = await call('POST', '', {
      name: 'Prueba pública',
      isPublic: true,
      ingredients: [{ name: 'Ingrediente sintético', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Preparar.' }]
    });
    const id = created.payload.data.id;

    expect((await callAs(otherToken, 'GET', `/${id}`)).status).toBe(200);
    expect((await callAs(otherToken, 'PATCH', `/${id}`, { name: 'Cambio ajeno' })).status).toBe(
      403
    );
    expect(
      (
        await callAs(otherToken, 'PATCH', `/${id}`, {
          ingredients: [{ name: 'Ingrediente ajeno', quantity: 1, unit: 'unit' }]
        })
      ).status
    ).toBe(403);
    expect((await callAs(otherToken, 'DELETE', `/${id}`)).status).toBe(403);
    expect((await callAs(otherToken, 'POST', `/${id}/favorite`)).payload.data.isFavorite).toBe(
      true
    );
    expect((await call('DELETE', `/${id}`)).status).toBe(409);
    expect((await call('GET', `/${id}`)).status).toBe(200);
  });
});
