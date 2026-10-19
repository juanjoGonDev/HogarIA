import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { existsSync } from 'node:fs';
import type { RecipeStepPhotoProvider } from '../utils/recipe-step-photos.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type Photo = import('../utils/recipe-step-photos.js').RecipeStepPhoto;

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let token = '';
let photos: Photo[];
let imageProvider: RecipeStepPhotoProvider;
let searches = 0;

const userId = 'image-editor';
const homeId = 'image-home';
const configId = 'image-home-config';

async function waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('Timed out waiting for image search');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function request(method: string, path: string, body?: unknown) {
  return app.request(`/api/pantry${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function addIngredient(id: string, household = homeId, owner = userId): void {
  db.prepare(
    `INSERT INTO ingredients
      (id, user_id, household_id, name, category, quantity, unit, image)
     VALUES (?, ?, ?, ?, 'other', 1, 'unit', NULL)`
  ).run(id, owner, household, `Producto ${id}`);
}

function addMember(permissions = { pantry: { view: true, edit: true } }): void {
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
     VALUES ('image-membership', ?, ?, 'member', ?, 1)`
  ).run(homeId, userId, JSON.stringify(permissions));
}

async function json(response: Response): Promise<any> {
  return response.json();
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const config = await import('../config/app.config.js');
  token = jwt.sign({ sub: userId, email: 'image@test.local' }, config.config.auth.jwtSecret, {
    expiresIn: '1h'
  });

  photos = Array.from({ length: 10 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(24, '0'),
    altText: `Fotografía de alimento ${index + 1}`,
    author: `Autor ${index + 1}`,
    licenseName: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    sourceUrl: `https://commons.wikimedia.org/wiki/File:Food_${index + 1}.jpg`,
    thumbnailUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/${index + 1}/Food_${index + 1}.jpg`
  }));
  imageProvider = {
    search: vi.fn(),
    searchByQuery: vi.fn(async () => {
      searches += 1;
      return photos;
    }),
    getPhoto: vi.fn((id: string) => photos.find((photo) => photo.id === id) ?? null),
    getImage: vi.fn(async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg' as const
    })),
    getImageFromUrl: vi.fn(async () => ({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg' as const
    }))
  };

  const { createPantryProductImageRoutes, createProductImagePreviewRoutes } = await import('./pantry-product-images.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.route('/api/pantry', createPantryProductImageRoutes(imageProvider));
  app.route('/api/product-image-candidates', createProductImagePreviewRoutes(imageProvider));
});

afterAll(async () => {
  const { stopWorker } = await import('../utils/ticket-queue.js');
  stopWorker();
  closeDatabase?.();
});

beforeEach(async () => {
  const { stopWorker } = await import('../utils/ticket-queue.js');
  stopWorker();
  for (const statement of [
    'DELETE FROM product_image_searches',
    'DELETE FROM ai_jobs',
    'DELETE FROM recipe_image_assets',
    'DELETE FROM ingredients',
    'DELETE FROM ai_configs',
    'DELETE FROM household_members',
    'UPDATE users SET household_id = NULL',
    'DELETE FROM households',
    'DELETE FROM users'
  ]) {
    try {
      db.exec(statement);
    } catch (error) {
      throw new Error(`${statement}: ${(error as Error).message}`);
    }
  }
  searches = 0;
  vi.mocked(imageProvider.searchByQuery).mockClear();
  vi.mocked(imageProvider.searchByQuery).mockImplementation(async () => {
    searches += 1;
    return photos;
  });
  vi.mocked(imageProvider.getPhoto).mockImplementation((id) => photos.find((photo) => photo.id === id) ?? null);
  vi.mocked(imageProvider.getImage).mockClear();
  vi.mocked(imageProvider.getImage).mockResolvedValue({
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    mimeType: 'image/jpeg'
  });
  vi.mocked(imageProvider.getImageFromUrl!).mockClear();
  vi.mocked(imageProvider.getImageFromUrl!).mockResolvedValue({
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    mimeType: 'image/jpeg'
  });
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    homeId,
    'Image home',
    'image-invite'
  );
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'image@test.local', 'Image editor', 'hash', homeId);
  addMember();
  db.prepare(
    `INSERT INTO ai_configs
      (id, user_id, household_id, name, provider, base_url, api_key, model, retry_attempts, concurrency, is_active)
     VALUES (?, ?, ?, 'Household provider', 'custom', 'http://provider.test/v1', 'synthetic-key', 'test-model', 0, 1, 1)`
  ).run(configId, userId, homeId);
});

describe('pantry product image queue', () => {
  it('runs the search asynchronously in the household provider queue and returns at most ten licensed candidates', async () => {
    addIngredient('ingredient-a');

    const queued = await request('POST', '/ingredients/ingredient-a/image-search/retry');
    expect(queued.status).toBe(202);
    const queuedBody = await json(queued);
    expect(queuedBody.data.status).toBe('queued');
    expect(queuedBody.data.jobId).toEqual(expect.any(String));
    expect(searches).toBe(0);

    await waitFor(() => {
      const row = db.prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?').get('ingredient-a') as
        | { status: string }
        | undefined;
      return row?.status === 'complete';
    });

    expect(db.prepare('SELECT household_id, config_id, kind FROM ai_jobs WHERE id = ?').get(queuedBody.data.jobId)).toEqual({
      household_id: homeId,
      config_id: configId,
      kind: 'product_image_search'
    });
    const response = await json(await request('GET', '/ingredients/ingredient-a/image-search'));
    expect(response.data.status).toBe('complete');
    expect(response.data.candidates).toHaveLength(10);
    expect(response.data.candidates[0]).toMatchObject({
      id: photos[0].id,
      author: photos[0].author,
      licenseName: photos[0].licenseName,
      previewUrl: photos[0].thumbnailUrl
    });
  });

  it('keeps search previews selectable after the in-memory provider cache expires', async () => {
    addIngredient('ingredient-a');
    await request('POST', '/ingredients/ingredient-a/image-search/retry');
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?').get('ingredient-a') as
        | { status: string }
        | undefined;
      return row?.status === 'complete';
    });

    vi.mocked(imageProvider.getPhoto).mockReturnValue(null);
    vi.mocked(imageProvider.getImage).mockRejectedValue(new Error('provider cache expired'));
    const result = await request('POST', '/ingredients/ingredient-a/image-search/select', {
      photoId: photos[0].id
    });

    expect(result.status).toBe(200);
    expect(imageProvider.getImageFromUrl).toHaveBeenCalledWith(photos[0].thumbnailUrl);
  });

  it('does not expose another household product and requires the current pantry edit permission to enqueue', async () => {
    addIngredient('ingredient-a');
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'other-home',
      'Other home',
      'other-invite'
    );
    addIngredient('ingredient-other', 'other-home', userId);

    expect((await request('GET', '/ingredients/ingredient-other/image-search')).status).toBe(404);

    db.prepare('UPDATE household_members SET permissions = ? WHERE household_id = ? AND user_id = ?').run(
      JSON.stringify({ pantry: { view: true, edit: false } }),
      homeId,
      userId
    );
    expect((await request('POST', '/ingredients/ingredient-a/image-search/retry')).status).toBe(403);
    expect(searches).toBe(0);
  });

  it('fails closed for missing products, missing active-house selection, and view-only members', async () => {
    addIngredient('ingredient-a');
    expect((await request('GET', '/ingredients/missing/image-search')).status).toBe(404);
    expect((await request('POST', '/ingredients/missing/image-search/retry')).status).toBe(404);

    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'other-home',
      'Other home',
      'other-invite'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
       VALUES ('second-membership', 'other-home', ?, 'member', ?, 1)`
    ).run(userId, JSON.stringify({ pantry: { view: true, edit: true } }));
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(userId);
    expect((await request('GET', '/ingredients/ingredient-a/image-search')).status).toBe(409);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(homeId, userId);

    db.prepare('UPDATE household_members SET permissions = ? WHERE household_id = ? AND user_id = ?').run(
      JSON.stringify({ pantry: { view: false, edit: false } }),
      homeId,
      userId
    );
    expect((await request('GET', '/ingredients/ingredient-a/image-search')).status).toBe(403);
    expect((await request('POST', '/ingredients/ingredient-a/image-search/retry')).status).toBe(403);
    expect((await request('POST', '/ingredients/ingredient-a/image-search/cancel')).status).toBe(403);
    expect((await request('POST', '/ingredients/ingredient-a/image-search/select', { photoId: photos[0].id })).status).toBe(403);
    expect((await request('POST', '/ingredients/ingredient-a/image', { dataUrl: 'invalid' })).status).toBe(403);
    expect(searches).toBe(0);
  });

  it('rejects invalid and stale candidate selections and reports unavailable media', async () => {
    addIngredient('ingredient-a');
    expect((await request('POST', '/ingredients/ingredient-a/image-search/select', { photoId: 'bad-id' })).status).toBe(400);
    expect((await request('POST', '/ingredients/ingredient-a/image-search/select', { photoId: photos[0].id })).status).toBe(409);

    await request('POST', '/ingredients/ingredient-a/image-search/retry');
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?').get('ingredient-a') as
        | { status: string }
        | undefined;
      return row?.status === 'complete';
    });
    vi.mocked(imageProvider.getImage).mockResolvedValue(null);
    vi.mocked(imageProvider.getImageFromUrl!).mockResolvedValue(null);
    const unavailable = await request('POST', '/ingredients/ingredient-a/image-search/select', { photoId: photos[0].id });
    expect(unavailable.status).toBe(502);
    expect((await request('POST', '/ingredients/ingredient-a/image-search/retry')).status).toBe(409);
    expect((await request('POST', '/ingredients/ingredient-a/image-search/cancel')).status).toBe(409);
  });

  it('serves persisted candidate previews after a provider cache expires and bounds failures', async () => {
    addIngredient('preview-product');
    await request('POST', '/ingredients/preview-product/image-search/retry');
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?').get('preview-product') as
        | { status: string }
        | undefined;
      return row?.status === 'complete';
    });
    const candidateUrl = `/api/product-image-candidates/${photos[0].id}`;
    const ok = await app.request(candidateUrl);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));

    expect((await app.request('/api/product-image-candidates/not-an-id')).status).toBe(404);
    expect((await app.request(`/api/product-image-candidates/${'f'.repeat(24)}`)).status).toBe(404);
    vi.mocked(imageProvider.getPhoto).mockReturnValue(null);
    expect((await app.request(candidateUrl)).status).toBe(200);
    vi.mocked(imageProvider.getImage).mockResolvedValue(null);
    vi.mocked(imageProvider.getImageFromUrl!).mockResolvedValue(null);
    expect((await app.request(candidateUrl)).status).toBe(404);

    // Simulates a process restart: metadata remains in SQLite but the provider's RAM cache is empty.
    vi.mocked(imageProvider.getImage).mockRejectedValue(new Error('temporary photo failure'));
    vi.mocked(imageProvider.getImageFromUrl!).mockResolvedValue({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg'
    });
    const restored = await app.request(candidateUrl);
    expect(restored.status).toBe(200);
    expect(imageProvider.getImageFromUrl).toHaveBeenCalledWith(photos[0].thumbnailUrl);
  });

  it('normalizes persisted provider queue states, malformed candidate data, and fixture-provider contracts', async () => {
    const {
      productImagePhotoProvider,
      readProductImageSearch,
      queueProductImageSearch,
      cancelProductImageSearch,
      photoCandidateFor
    } = await import('../utils/product-image-search.js');
    expect(await productImagePhotoProvider.search('prepare')).toBeNull();
    const fixturePhotos = await productImagePhotoProvider.searchByQuery('tomate');
    expect(fixturePhotos).toHaveLength(10);
    expect(productImagePhotoProvider.getPhoto(fixturePhotos[0].id)).toEqual(fixturePhotos[0]);
    expect(productImagePhotoProvider.getPhoto('missing')).toBeNull();
    expect(await productImagePhotoProvider.getImage(fixturePhotos[0].id)).toMatchObject({ mimeType: 'image/png' });
    expect(await productImagePhotoProvider.getImage('missing')).toBeNull();
    const aborted = new AbortController();
    aborted.abort();
    await expect(productImagePhotoProvider.searchByQuery('tomate', aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });

    const states = [
      { queue: 'queued', expected: 'queued', error: null },
      { queue: 'running', expected: 'running', error: null },
      { queue: 'done', expected: 'complete', error: null },
      { queue: 'failed', expected: 'failed', error: 'QUEUE_ERROR' },
      { queue: 'stopped', expected: 'cancelled', error: null },
      { queue: null, expected: 'complete', error: null }
    ] as const;
    for (const [index, state] of states.entries()) {
      const ingredientId = `state-ingredient-${index}`;
      const jobId = `state-job-${index}`;
      addIngredient(ingredientId);
      if (state.queue) {
        db.prepare('INSERT INTO ai_jobs (id, user_id, household_id, kind, status, error_code) VALUES (?, ?, ?, ?, ?, ?)')
          .run(jobId, userId, homeId, 'product_image_search', state.queue, state.error);
      }
      const candidatesJson = index === 0
        ? JSON.stringify(fixturePhotos.concat(fixturePhotos))
        : index === 1
          ? '{bad-json'
          : index === 2
            ? '{"not":"an array"}'
            : '[]';
      db.prepare(
        `INSERT INTO product_image_searches
          (ingredient_id, user_id, household_id, job_id, candidates_json, status, error_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(ingredientId, userId, homeId, jobId, candidatesJson, state.expected, index === 3 ? 'STORED_ERROR' : null);

      const view = readProductImageSearch(db, ingredientId, userId, homeId);
      expect(view.status).toBe(state.expected);
      if (state.expected === 'failed') expect(view.errorCode).toBe('QUEUE_ERROR');
      if (index === 0) expect(view.candidates).toHaveLength(10);
      if (index === 1 || index === 2) expect(view.candidates).toEqual([]);
      expect(readProductImageSearch(db, `missing-${index}`, userId, homeId)).toEqual({
        status: 'idle', jobId: null, candidates: [], errorCode: null
      });
    }

    const failedIngredient = 'state-ingredient-3';
    db.prepare('UPDATE ai_jobs SET error_code = NULL WHERE id = ?').run('state-job-3');
    db.prepare('UPDATE product_image_searches SET error_code = NULL WHERE ingredient_id = ?').run(failedIngredient);
    expect(readProductImageSearch(db, failedIngredient, userId, homeId).errorCode).toBe('SEARCH_FAILED');
    expect(photoCandidateFor(db, failedIngredient, userId, homeId, fixturePhotos[0].id)).toBeNull();
    expect(photoCandidateFor(db, 'state-ingredient-0', userId, homeId, fixturePhotos[0].id)).toEqual(fixturePhotos[0]);
    expect(photoCandidateFor(db, 'missing-ingredient', userId, homeId, fixturePhotos[0].id)).toBeNull();
    expect(cancelProductImageSearch(db, 'missing-ingredient', userId, homeId)).toBe(false);

    addIngredient('already-imaged');
    db.prepare('UPDATE ingredients SET image = ? WHERE id = ?').run('/existing.jpg', 'already-imaged');
    expect(queueProductImageSearch(db, userId, 'already-imaged')).toMatchObject({ status: 'idle' });
    expect(() => queueProductImageSearch(db, userId, 'missing-product')).toThrow('PRODUCT_NOT_FOUND');

    addIngredient('default-provider-search');
    expect(queueProductImageSearch(db, userId, 'default-provider-search', { force: true }).status).toBe('queued');
    await waitFor(() => readProductImageSearch(db, 'default-provider-search', userId, homeId).status === 'complete');
    expect(readProductImageSearch(db, 'default-provider-search', userId, homeId).candidates[0].previewUrl)
      .toMatch(/^\/api\/product-image-previews\//);

    addIngredient('failed-provider-search');
    const failed = queueProductImageSearch(db, userId, 'failed-provider-search', {
      force: true,
      provider: {
        search: vi.fn(async () => null),
        searchByQuery: vi.fn(async () => { throw new Error('offline'); }),
        getPhoto: vi.fn(() => null),
        getImage: vi.fn(async () => null)
      }
    });
    expect(failed.status).toBe('queued');
    await waitFor(() => readProductImageSearch(db, 'failed-provider-search', userId, homeId).status === 'failed');
    expect(readProductImageSearch(db, 'failed-provider-search', userId, homeId).errorCode).toMatch(/SEARCH|PROVIDER/);
  });

  it('copies a selected licensed candidate to stable local storage and updates only the active-home ingredient', async () => {
    addIngredient('ingredient-a');
    const queued = await json(await request('POST', '/ingredients/ingredient-a/image-search/retry'));
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?').get('ingredient-a') as
        | { status: string }
        | undefined;
      return row?.status === 'complete';
    });

    const selected = await request('POST', `/ingredients/ingredient-a/image-search/select`, {
      photoId: photos[0].id
    });
    expect(selected.status).toBe(200);
    const result = await json(selected);
    expect(result.data.image).toMatch(/^\/api\/recipe-images\/[a-f0-9]{24}$/);
    expect(db.prepare('SELECT image FROM ingredients WHERE id = ?').get('ingredient-a')).toEqual({
      image: result.data.image
    });
    const asset = db
      .prepare('SELECT author, license_name, source_url FROM recipe_image_assets WHERE id = ?')
      .get(result.data.image.split('/').at(-1));
    expect(asset).toMatchObject({ author: photos[0].author, license_name: photos[0].licenseName });
    expect(searches).toBe(1);
    expect(queued.data.status).toBe('queued');
  });

  it('deduplicates retries while a search runs and cancels the provider request', async () => {
    addIngredient('ingredient-a');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(imageProvider.searchByQuery).mockImplementation(async (_query, signal) => {
      searches += 1;
      await blocked;
      if (signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      return photos;
    });

    const first = await json(await request('POST', '/ingredients/ingredient-a/image-search/retry'));
    const duplicate = await json(await request('POST', '/ingredients/ingredient-a/image-search/retry'));
    expect(duplicate.data.jobId).toBe(first.data.jobId);
    await waitFor(() => searches === 1);
    expect((await request('POST', '/ingredients/ingredient-a/image-search/cancel')).status).toBe(200);
    release();
    await waitFor(() => {
      const status = db.prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?').get('ingredient-a') as
        | { status: string }
        | undefined;
      return status?.status === 'cancelled';
    });
    expect(db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get(first.data.jobId)).toEqual({ status: 'stopped' });
  });

  it('serializes background searches to the configured household provider concurrency', async () => {
    addIngredient('ingredient-a');
    addIngredient('ingredient-b');
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let maximum = 0;
    vi.mocked(imageProvider.searchByQuery).mockImplementation(async () => {
      searches += 1;
      inFlight += 1;
      maximum = Math.max(maximum, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight -= 1;
      return photos;
    });

    const first = await json(await request('POST', '/ingredients/ingredient-a/image-search/retry'));
    const second = await json(await request('POST', '/ingredients/ingredient-b/image-search/retry'));
    await waitFor(() => releases.length === 1);
    expect(maximum).toBe(1);
    expect(db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get(second.data.jobId)).toEqual({ status: 'queued' });
    releases.shift()?.();
    await waitFor(() => releases.length === 1);
    expect(maximum).toBe(1);
    releases.shift()?.();
    await waitFor(() => {
      const done = db.prepare("SELECT COUNT(*) AS n FROM product_image_searches WHERE status = 'complete'").get() as { n: number };
      return done.n === 2;
    });
    expect(first.data.jobId).not.toBe(second.data.jobId);
  });

  it('accepts bounded JPEG/PNG/WebP uploads with matching file signatures only', async () => {
    addIngredient('ingredient-a');
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S40AAAAASUVORK5CYII=';
    const accepted = await request('POST', '/ingredients/ingredient-a/image', { dataUrl: png });
    expect(accepted.status).toBe(200);
    const saved = await json(accepted);
    expect(saved.data.image).toMatch(/^\/api\/uploads\/product-images\//);
    expect(db.prepare('SELECT image FROM ingredients WHERE id = ?').get('ingredient-a')).toEqual({ image: saved.data.image });

    expect((await request('POST', '/ingredients/ingredient-a/image', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400);
    expect((await request('POST', '/ingredients/ingredient-a/image', { dataUrl: 'data:image/png;base64,/9j/2Q==' })).status).toBe(400);
    expect((await request('POST', '/ingredients/ingredient-a/image', { dataUrl: `data:image/png;base64,${'A'.repeat(2_900_001)}` })).status).toBe(400);

    const { deleteUpload, resolveUploadUrl, uploadsRoot } = await import('../utils/uploads.js');
    const uploadedPath = resolveUploadUrl(saved.data.image, uploadsRoot());
    expect(uploadedPath).toBeTruthy();
    expect(existsSync(uploadedPath!)).toBe(true);

    await request('POST', '/ingredients/ingredient-a/image-search/retry');
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM product_image_searches WHERE ingredient_id = ?').get('ingredient-a') as
        | { status: string }
        | undefined;
      return row?.status === 'complete';
    });
    const selected = await request('POST', '/ingredients/ingredient-a/image-search/select', {
      photoId: photos[0].id
    });
    expect(selected.status).toBe(200);
    expect(existsSync(uploadedPath!)).toBe(false);
    expect(deleteUpload(saved.data.image, uploadsRoot())).toBe(false);
  });
});
