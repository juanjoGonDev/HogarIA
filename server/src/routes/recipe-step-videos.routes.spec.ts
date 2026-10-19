import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReadableStream } from 'node:stream/web';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import {
  MAX_RECIPE_STEP_VIDEO_RANGE_BYTES,
  type RecipeStepVideoProvider
} from '../utils/recipe-step-videos.js';
import { RecipeStepVideoPlaybackTickets } from '../utils/recipe-step-video-playback-tickets.js';

const USER_ID = 'recipe-video-user';
const PRIVATE_RECIPE_ID = 'private-recipe';
const OTHER_PRIVATE_RECIPE_ID = 'other-private-recipe';
const PUBLIC_RECIPE_ID = 'public-recipe';
const VIDEO_URL =
  'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Chop.webm/Chop.webm.360p.vp9.webm';
const VIDEO_ID = createHash('sha256').update(VIDEO_URL).digest('hex').slice(0, 24);

let secret: string;
let token: string;
let db: import('better-sqlite3').Database;
let closeDatabase: () => void;
let createRoutes: typeof import('./recipe-step-videos.routes.js').createRecipeStepVideoRoutes;

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  const appConfig = await import('../config/app.config.js');
  secret = appConfig.config.auth.jwtSecret;
  ({ createRecipeStepVideoRoutes: createRoutes } = await import('./recipe-step-videos.routes.js'));

  db.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)`).run(
    USER_ID,
    'recipe-video@test.local',
    'Video tester',
    'test-hash'
  );
  db.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)`).run(
    'another-user',
    'another-video@test.local',
    'Other owner',
    'test-hash'
  );
  const insertRecipe = db.prepare(
    `INSERT INTO recipes (id, name, author, author_id, is_public) VALUES (?, ?, 'user', ?, ?)`
  );
  insertRecipe.run(PRIVATE_RECIPE_ID, 'Receta privada con nombre sensible', USER_ID, 0);
  insertRecipe.run(OTHER_PRIVATE_RECIPE_ID, 'Receta ajena privada', 'another-user', 0);
  insertRecipe.run(PUBLIC_RECIPE_ID, 'Receta pública', 'another-user', 1);
  db.prepare('UPDATE recipes SET steps = ? WHERE id = ?').run(
    JSON.stringify([{ stepNumber: 1, instruction: 'Cortar.', videoId: VIDEO_ID }]),
    PRIVATE_RECIPE_ID
  );
  db.prepare(
    'INSERT INTO recipe_step_video_assets (recipe_id, video_id, title, author, license_name, license_url, source_url, thumbnail_url, media_url, mime_type, duration_seconds, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    PRIVATE_RECIPE_ID,
    VIDEO_ID,
    'Técnica de corte',
    'Autora pública',
    'CC BY 4.0',
    'https://creativecommons.org/licenses/by/4.0/',
    'https://commons.wikimedia.org/wiki/File:Chop.webm',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/chop.jpg',
    VIDEO_URL,
    'video/webm',
    18,
    680000
  );
  token = jwt.sign({ sub: USER_ID, email: 'recipe-video@test.local' }, secret);
});

afterAll(() => closeDatabase?.());

function makeApp(
  provider: RecipeStepVideoProvider,
  options: {
    now?: () => number;
    secureCookies?: boolean;
    playbackTickets?: RecipeStepVideoPlaybackTickets;
  } = {}
) {
  const app = new Hono();
  app.route(
    '/api/recipes',
    createRoutes(provider, {
      playbackTickets: new RecipeStepVideoPlaybackTickets(),
      ...options
    })
  );
  return app;
}

async function issuePlaybackCookie(
  app: Hono,
  recipeId = PRIVATE_RECIPE_ID,
  videoId = VIDEO_ID,
  authToken = token
): Promise<string> {
  const response = await app.request(`/api/recipes/${recipeId}/step-videos/${videoId}/playback`, {
    method: 'POST',
    headers: playbackHeaders(authToken),
    body: '{}'
  });
  if (response.status !== 201) throw new Error(`Playback grant failed: ${response.status}`);
  return cookiePair(response);
}

function authHeaders(authToken = token) {
  return { authorization: `Bearer ${authToken}` };
}

function playbackHeaders(authToken = token, origin = 'http://localhost:4200') {
  return {
    ...authHeaders(authToken),
    origin,
    'sec-fetch-site': origin === 'http://localhost:4200' ? 'same-site' : 'cross-site',
    'content-type': 'application/json'
  };
}

function cookiePair(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('Expected playback cookie');
  return setCookie.split(';', 1)[0]!;
}

function streamingProvider() {
  return {
    search: vi.fn(),
    getVideo: vi.fn(),
    getSelectedVideo: vi.fn(),
    openStream: vi.fn(),
    openStoredStream: vi.fn().mockImplementation(async (_selection, range) => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.close();
        }
      }),
      mimeType: 'video/webm' as const,
      contentRange: `bytes ${range.start}-${range.end}/680000`,
      contentLength: range.end - range.start + 1
    }))
  } satisfies RecipeStepVideoProvider;
}

function testVideo() {
  return {
    id: VIDEO_ID,
    title: 'Técnica de corte',
    author: 'Autora pública',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Chop.webm',
    thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/chop.jpg',
    durationSeconds: 18,
    sizeBytes: 680000,
    mimeType: 'video/webm' as const
  };
}

describe('recipe step video routes', () => {
  it('requires auth and searches generic scenes without requiring a saved recipe id', async () => {
    const provider: RecipeStepVideoProvider = {
      search: vi.fn().mockResolvedValue([testVideo()]),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn()
    };
    const app = makeApp(provider);

    expect((await app.request('/api/recipes/step-videos/search?scene=cut')).status).toBe(401);
    expect(
      (
        await app.request('/api/recipes/step-videos/search?scene=private-title', {
          headers: authHeaders()
        })
      ).status
    ).toBe(400);
    expect(
      (
        await app.request('/api/recipes/step-videos/search?scene=cut&query=private-title', {
          headers: authHeaders()
        })
      ).status
    ).toBe(400);
    expect(
      (await app.request('/api/recipes/step-videos/search?scene=cut', { headers: authHeaders() }))
        .status
    ).toBe(200);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith('cut', expect.any(AbortSignal));
  });

  it('returns only candidate metadata; playback URLs are not persisted in search responses', async () => {
    const candidate = testVideo();
    const provider: RecipeStepVideoProvider = {
      search: vi.fn().mockResolvedValue([candidate]),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn()
    };
    const app = makeApp(provider);

    const response = await app.request('/api/recipes/step-videos/search?scene=cut', {
      headers: authHeaders()
    });
    const { sizeBytes: _sizeBytes, ...publicCandidate } = candidate;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: [publicCandidate]
    });
    expect(provider.search).toHaveBeenCalledWith('cut', expect.any(AbortSignal));
    expect(JSON.stringify({ ...publicCandidate })).not.toContain(VIDEO_URL);
  });

  it('normalizes search provider failures without leaking upstream details', async () => {
    const provider: RecipeStepVideoProvider = {
      search: vi.fn().mockRejectedValue(new Error('private upstream payload')),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn()
    };
    const app = makeApp(provider);

    const response = await app.request('/api/recipes/step-videos/search?scene=serve', {
      headers: authHeaders()
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, message: 'Video search unavailable' });
  });

  it.each([undefined, 'items=0-2', 'bytes=0-2,4-6', 'bytes=-0'])(
    'rejects missing or malformed Range header (%s)',
    async (range) => {
      const provider: RecipeStepVideoProvider = {
        search: vi.fn(),
        getVideo: vi.fn(),
        getSelectedVideo: vi.fn(),
        openStream: vi.fn(),
        openStoredStream: vi.fn()
      };
      const app = makeApp(provider);

      const response = await app.request(
        `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`,
        { headers: { cookie: await issuePlaybackCookie(app), ...(range ? { Range: range } : {}) } }
      );

      expect(response.status).toBe(416);
      expect(provider.openStoredStream).not.toHaveBeenCalled();
    }
  );

  it('returns 404 for inaccessible recipe or unselected clip without opening upstream', async () => {
    const provider: RecipeStepVideoProvider = {
      search: vi.fn(),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn()
    };
    const app = makeApp(provider);
    const cookie = await issuePlaybackCookie(app);
    const hiddenRecipe = await app.request(
      `/api/recipes/${OTHER_PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`,
      { headers: { cookie, Range: 'bytes=0-3' } }
    );
    const unselectedVideoId = 'f'.repeat(24);
    const unknownVideo = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${unselectedVideoId}/stream`,
      { headers: { cookie, Range: 'bytes=0-3' } }
    );

    expect(hiddenRecipe.status).toBe(401);
    expect(unknownVideo.status).toBe(401);
    expect(provider.openStoredStream).not.toHaveBeenCalled();
  });

  it('rechecks access on every range and revokes the ticket when recipe access is withdrawn', async () => {
    const provider = streamingProvider();
    const tickets = new RecipeStepVideoPlaybackTickets();
    const app = new Hono();
    app.route('/api/recipes', createRoutes(provider, { playbackTickets: tickets }));
    const cookie = await issuePlaybackCookie(app);

    db.prepare('UPDATE recipes SET author_id = ?, is_public = 0 WHERE id = ?').run(
      'another-user',
      PRIVATE_RECIPE_ID
    );
    const response = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`,
      { headers: { cookie, range: 'bytes=0-3' } }
    );
    db.prepare('UPDATE recipes SET author_id = ?, is_public = 0 WHERE id = ?').run(
      USER_ID,
      PRIVATE_RECIPE_ID
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(tickets.size).toBe(0);
    expect(provider.openStoredStream).not.toHaveBeenCalled();
  });

  it('does not accept an anonymous stream or a query-string playback capability', async () => {
    const provider = streamingProvider();
    const app = makeApp(provider);
    const streamUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`;
    const anonymous = await app.request(streamUrl, { headers: { range: 'bytes=0-3' } });
    const cookie = await issuePlaybackCookie(app);
    const capability = cookie.slice(cookie.indexOf('=') + 1);
    const queryCapability = await app.request(`${streamUrl}?access_token=${capability}`, {
      headers: { range: 'bytes=0-3' }
    });

    expect(anonymous.status).toBe(401);
    expect(queryCapability.status).toBe(400);
    expect(provider.openStoredStream).not.toHaveBeenCalled();
  });

  it('streams an authenticated 206 range with safe headers and clamps oversized ranges', async () => {
    const candidate = testVideo();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        controller.close();
      }
    });
    const provider: RecipeStepVideoProvider = {
      search: vi.fn(),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn().mockResolvedValue({
        body: stream,
        mimeType: 'video/webm',
        contentRange: 'bytes 0-3/680000',
        contentLength: 4
      })
    };
    const app = makeApp(provider);
    const cookie = await issuePlaybackCookie(app);

    const response = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`,
      { headers: { cookie, Range: `bytes=0-${MAX_RECIPE_STEP_VIDEO_RANGE_BYTES + 99}` } }
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/webm');
    expect(response.headers.get('content-range')).toBe('bytes 0-3/680000');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(provider.openStoredStream).toHaveBeenCalledWith(
      expect.objectContaining({ id: VIDEO_ID, mediaUrl: VIDEO_URL }),
      { start: 0, end: Math.min(candidate.sizeBytes - 1, MAX_RECIPE_STEP_VIDEO_RANGE_BYTES - 1) },
      expect.any(AbortSignal)
    );
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  it('returns byte-range unsatisfied metadata for out-of-file ranges', async () => {
    const provider: RecipeStepVideoProvider = {
      search: vi.fn(),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn()
    };
    const app = makeApp(provider);
    const cookie = await issuePlaybackCookie(app);

    const response = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`,
      { headers: { cookie, Range: 'bytes=680000-' } }
    );

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */680000');
    expect(provider.openStoredStream).not.toHaveBeenCalled();
  });

  it('normalizes upstream stream failures and never sends client-provided URLs', async () => {
    const provider: RecipeStepVideoProvider = {
      search: vi.fn(),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn().mockRejectedValue(new Error('internal URL or upstream details'))
    };
    const app = makeApp(provider);
    const cookie = await issuePlaybackCookie(app);

    const response = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream?url=https://127.0.0.1`,
      { headers: { cookie, Range: 'bytes=0-3' } }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, message: 'Invalid video request' });
    expect(provider.openStoredStream).not.toHaveBeenCalled();
  });

  it('normalizes upstream stream failures without exposing provider details', async () => {
    const provider: RecipeStepVideoProvider = {
      search: vi.fn(),
      getVideo: vi.fn(),
      getSelectedVideo: vi.fn(),
      openStream: vi.fn(),
      openStoredStream: vi.fn().mockRejectedValue(new Error('internal upstream response body'))
    };
    const app = makeApp(provider);
    const cookie = await issuePlaybackCookie(app);

    const response = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`,
      { headers: { cookie, Range: 'bytes=0-3' } }
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ success: false, message: 'Video unavailable' });
  });

  it('issues a short-lived, path-scoped HttpOnly cookie and streams native Range requests without a bearer header', async () => {
    const provider = streamingProvider();
    const app = makeApp(provider);
    const playbackUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/playback`;
    const streamUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`;
    const grant = await app.request(playbackUrl, {
      method: 'POST',
      headers: playbackHeaders(),
      body: '{}'
    });
    const setCookie = grant.headers.get('set-cookie') ?? '';
    const grantBody = await grant.json();

    expect(grant.status).toBe(201);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain(`Path=${streamUrl}`);
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(setCookie).not.toContain('; Secure');
    expect(JSON.stringify(grantBody)).not.toMatch(/[A-Za-z0-9_-]{40,}/);

    const stream = await app.request(streamUrl, {
      headers: { cookie: cookiePair(grant), range: 'bytes=0-3' }
    });
    expect(stream.status).toBe(206);
    expect(stream.headers.get('content-range')).toBe('bytes 0-3/680000');
    expect(provider.openStoredStream).toHaveBeenCalledTimes(1);
  });

  it('rejects playback-cookie issuance from missing or cross-site origins', async () => {
    const app = makeApp(streamingProvider());
    const playbackUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/playback`;

    const missingOrigin = await app.request(playbackUrl, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: '{}'
    });
    const crossOrigin = await app.request(playbackUrl, {
      method: 'POST',
      headers: playbackHeaders(token, 'https://attacker.example'),
      body: '{}'
    });
    const crossSiteFetch = await app.request(playbackUrl, {
      method: 'POST',
      headers: { ...playbackHeaders(), 'sec-fetch-site': 'cross-site' },
      body: '{}'
    });
    const formLikeContentType = await app.request(playbackUrl, {
      method: 'POST',
      headers: { ...playbackHeaders(), 'content-type': 'text/plain' },
      body: '{}'
    });

    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.headers.get('set-cookie')).toBeNull();
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get('set-cookie')).toBeNull();
    expect(crossSiteFetch.status).toBe(403);
    expect(formLikeContentType.status).toBe(403);
  });

  it('requires a bearer-authenticated user and sets Secure in production mode', async () => {
    const app = makeApp(streamingProvider(), { secureCookies: true });
    const playbackUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/playback`;
    const anonymous = await app.request(playbackUrl, {
      method: 'POST',
      headers: {
        origin: 'http://localhost:4200',
        'sec-fetch-site': 'same-site',
        'content-type': 'application/json'
      },
      body: '{}'
    });
    const grant = await app.request(playbackUrl, {
      method: 'POST',
      headers: playbackHeaders(),
      body: '{}'
    });

    expect(anonymous.status).toBe(401);
    expect(grant.status).toBe(201);
    expect(grant.headers.get('set-cookie')).toContain('; Secure');
  });

  it('expires playback capabilities and refuses replay after reissuing the same scoped capability', async () => {
    let now = 10_000;
    const provider = streamingProvider();
    const app = new Hono();
    app.route(
      '/api/recipes',
      createRoutes(provider, {
        now: () => now,
        playbackTickets: new RecipeStepVideoPlaybackTickets()
      })
    );
    const playbackUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/playback`;
    const streamUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`;
    const issue = () =>
      app.request(playbackUrl, {
        method: 'POST',
        headers: playbackHeaders(),
        body: '{}'
      });

    const firstGrant = await issue();
    const firstCookie = cookiePair(firstGrant);
    const secondGrant = await issue();
    const secondCookie = cookiePair(secondGrant);
    expect(firstCookie).not.toBe(secondCookie);

    const revoked = await app.request(streamUrl, {
      headers: { cookie: firstCookie, range: 'bytes=0-3' }
    });
    expect(revoked.status).toBe(401);

    now += 181_000;
    const expired = await app.request(streamUrl, {
      headers: { cookie: secondCookie, range: 'bytes=0-3' }
    });
    expect(expired.status).toBe(401);
    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(provider.openStoredStream).not.toHaveBeenCalled();
  });

  it('fails closed when the bounded global capability store is full', async () => {
    const app = new Hono();
    app.route(
      '/api/recipes',
      createRoutes(streamingProvider(), {
        playbackTickets: new RecipeStepVideoPlaybackTickets({ maxActive: 0 })
      })
    );
    const response = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/playback`,
      { method: 'POST', headers: playbackHeaders(), body: '{}' }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('revokes an overused playback cookie before opening another upstream range', async () => {
    const provider = streamingProvider();
    const app = new Hono();
    app.route(
      '/api/recipes',
      createRoutes(provider, {
        playbackTickets: new RecipeStepVideoPlaybackTickets({ maxRangeRequests: 1 })
      })
    );
    const cookie = await issuePlaybackCookie(app);
    const streamUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/stream`;
    const first = await app.request(streamUrl, {
      headers: { cookie, range: 'bytes=0-3' }
    });
    const abuse = await app.request(streamUrl, {
      headers: { cookie, range: 'bytes=4-7' }
    });

    expect(first.status).toBe(206);
    expect(abuse.status).toBe(429);
    expect(abuse.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(provider.openStoredStream).toHaveBeenCalledTimes(1);
  });

  it('isolates playback capability to its issuing user, recipe, and video', async () => {
    const provider = streamingProvider();
    const app = makeApp(provider);
    const playbackUrl = `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${VIDEO_ID}/playback`;
    const otherVideoId = '9'.repeat(24);
    const otherUserToken = jwt.sign(
      { sub: 'another-user', email: 'another-video@test.local' },
      secret
    );
    const deniedGrant = await app.request(playbackUrl, {
      method: 'POST',
      headers: playbackHeaders(otherUserToken),
      body: '{}'
    });
    const grant = await app.request(playbackUrl, {
      method: 'POST',
      headers: playbackHeaders(),
      body: '{}'
    });
    const crossVideo = await app.request(
      `/api/recipes/${PRIVATE_RECIPE_ID}/step-videos/${otherVideoId}/stream`,
      { headers: { cookie: cookiePair(grant), range: 'bytes=0-3' } }
    );

    expect(deniedGrant.status).toBe(404);
    expect(deniedGrant.headers.get('set-cookie')).toBeNull();
    expect(crossVideo.status).toBe(401);
    expect(provider.openStoredStream).not.toHaveBeenCalled();
  });
});
