import { Hono } from 'hono';
import { config } from '../config/app.config.js';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  MAX_RECIPE_STEP_VIDEO_RANGE_BYTES,
  RECIPE_STEP_VIDEO_SCENES,
  recipeStepVideoProvider,
  parseRecipeStepVideoRange,
  type RecipeStepVideoProvider
} from '../utils/recipe-step-videos.js';
import {
  loadRecipeStepVideoSelection,
  recipeStepsContainVideoId
} from '../utils/recipe-step-video-persistence.js';
import {
  RECIPE_STEP_VIDEO_PLAYBACK_TTL_MS,
  RecipeStepVideoPlaybackTickets,
  recipeStepVideoPlaybackTickets
} from '../utils/recipe-step-video-playback-tickets.js';
import type { AppEnv } from '../types/hono-env.js';

const PLAYBACK_COOKIE_TTL_SECONDS = Math.floor(RECIPE_STEP_VIDEO_PLAYBACK_TTL_MS / 1000);
const DEV_PLAYBACK_COOKIE_NAME = 'hogaria_recipe_video';
const SECURE_PLAYBACK_COOKIE_NAME = '__Secure-hogaria_recipe_video';

export interface RecipeStepVideoRouteOptions {
  /** Clock/store injection keeps expiry and revocation tests isolated and deterministic. */
  now?: () => number;
  playbackTickets?: RecipeStepVideoPlaybackTickets;
  /** Tests may exercise production cookie flags without changing process configuration. */
  secureCookies?: boolean;
}

function isCsrfSafePlaybackRequest(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== configuredOrigin()) return false;
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') return false;
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

function configuredOrigin(): string | null {
  try {
    return new URL(config.cors.origin).origin;
  } catch {
    return null;
  }
}

function cookieName(secure: boolean): string {
  return secure ? SECURE_PLAYBACK_COOKIE_NAME : DEV_PLAYBACK_COOKIE_NAME;
}

function scopedStreamPath(recipeId: string, videoId: string): string {
  return `/api/recipes/${encodeURIComponent(recipeId)}/step-videos/${videoId}/stream`;
}

function serializePlaybackCookie(
  name: string,
  value: string,
  path: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function playbackCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function createRecipeStepVideoRoutes(
  provider: RecipeStepVideoProvider = recipeStepVideoProvider,
  options: RecipeStepVideoRouteOptions = {}
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const tickets = options.playbackTickets ?? recipeStepVideoPlaybackTickets;
  const now = options.now ?? Date.now;
  const secureCookies = options.secureCookies ?? config.server.env === 'production';
  const name = cookieName(secureCookies);

  routes.get('/step-videos/search', authMiddleware, async (c) => {
    const searchParams = new URL(c.req.url).searchParams;
    const scene = searchParams.get('scene');
    if (
      searchParams.size !== 1 ||
      searchParams.getAll('scene').length !== 1 ||
      !scene ||
      !(RECIPE_STEP_VIDEO_SCENES as readonly string[]).includes(scene)
    ) {
      return c.json({ success: false, message: 'Invalid video scene' }, 400);
    }

    try {
      const videos = await provider.search(
        scene as (typeof RECIPE_STEP_VIDEO_SCENES)[number],
        c.req.raw.signal
      );
      return c.json({
        success: true,
        data: videos.slice(0, 5).map((video) => ({
          id: video.id,
          title: video.title,
          author: video.author,
          licenseName: video.licenseName,
          licenseUrl: video.licenseUrl,
          sourceUrl: video.sourceUrl,
          thumbnailUrl: video.thumbnailUrl,
          durationSeconds: video.durationSeconds,
          mimeType: video.mimeType
        }))
      });
    } catch {
      return c.json({ success: false, message: 'Video search unavailable' }, 502);
    }
  });

  // Native media elements cannot attach the app's Bearer header. This authenticated,
  // Origin-checked exchange creates a narrowly-scoped HttpOnly capability instead.
  routes.post('/:recipeId/step-videos/:videoId/playback', authMiddleware, async (c) => {
    const recipeId = c.req.param('recipeId') ?? '';
    const videoId = c.req.param('videoId') ?? '';
    if (
      new URL(c.req.url).searchParams.size > 0 ||
      !isCsrfSafePlaybackRequest(c.req.raw) ||
      !/^[a-f0-9]{24}$/.test(videoId)
    ) {
      return c.json({ success: false, message: 'Invalid playback request' }, 403);
    }

    const userId = c.get('userId');
    const selection = findReadableSelectedVideo(recipeId, videoId, userId);
    if (!selection) return c.json({ success: false, message: 'Video not found' }, 404);

    const token = tickets.issue({ userId, recipeId, videoId }, now());
    if (!token) {
      return c.json({ success: false, message: 'Too many active video playbacks' }, 429);
    }

    c.header(
      'Set-Cookie',
      serializePlaybackCookie(
        name,
        token,
        scopedStreamPath(recipeId, videoId),
        PLAYBACK_COOKIE_TTL_SECONDS,
        secureCookies
      )
    );
    c.header('Cache-Control', 'private, no-store');
    return c.json({ success: true, expiresInSeconds: PLAYBACK_COOKIE_TTL_SECONDS }, 201);
  });

  routes.get('/:recipeId/step-videos/:videoId/stream', async (c) => {
    const recipeId = c.req.param('recipeId') ?? '';
    const videoId = c.req.param('videoId') ?? '';
    const streamPath = scopedStreamPath(recipeId, videoId);
    const token = playbackCookieValue(c.req.raw, name);
    if (new URL(c.req.url).searchParams.size > 0) {
      c.header('Cache-Control', 'private, no-store');
      return c.json({ success: false, message: 'Invalid video request' }, 400);
    }
    if (!/^[a-f0-9]{24}$/.test(videoId) || !token) {
      return unauthorizedPlayback(c, name, streamPath, secureCookies);
    }

    // Look up the bound user first; recipe visibility and selected-video membership
    // are then revalidated on every range request so later revocation takes effect.
    const ticket = tickets.lookup(token, recipeId, videoId, now());
    if (!ticket) return unauthorizedPlayback(c, name, streamPath, secureCookies);

    const selection = findReadableSelectedVideo(recipeId, videoId, ticket.userId);
    if (!selection) {
      tickets.revoke(token);
      return notFoundPlayback(c, name, streamPath, secureCookies);
    }

    const range = parseRecipeStepVideoRange(c.req.header('Range') ?? null, selection.sizeBytes);
    if (!range || range.end - range.start + 1 > MAX_RECIPE_STEP_VIDEO_RANGE_BYTES) {
      return new Response(null, {
        status: 416,
        headers: {
          'accept-ranges': 'bytes',
          'content-range': `bytes */${selection.sizeBytes}`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff'
        }
      });
    }

    const authorized = tickets.consume(
      token,
      { userId: ticket.userId, recipeId, videoId },
      range.end - range.start + 1,
      now()
    );
    if (!authorized) {
      return tooManyPlaybackRequests(c, name, streamPath, secureCookies);
    }

    try {
      const stream = await provider.openStoredStream(selection, range, c.req.raw.signal);
      if (!stream) return notFoundPlayback(c, name, streamPath, secureCookies);
      return new Response(stream.body, {
        status: 206,
        headers: {
          'accept-ranges': 'bytes',
          'cache-control': 'private, no-store',
          'content-disposition': 'inline',
          'content-length': String(stream.contentLength),
          'content-range': stream.contentRange,
          'content-type': stream.mimeType,
          'cross-origin-resource-policy': 'same-site',
          'x-accel-buffering': 'no',
          'x-content-type-options': 'nosniff'
        }
      });
    } catch {
      return c.json({ success: false, message: 'Video unavailable' }, 502);
    }
  });

  return routes;
}

function findReadableSelectedVideo(recipeId: string, videoId: string, userId: string) {
  if (!userId || !/^[a-f0-9]{24}$/.test(videoId)) return null;
  const db = getDatabase();
  const recipe = db
    .prepare(
      `SELECT steps FROM recipes
        WHERE id = ? AND (author = 'catalog' OR author_id = ? OR is_public = 1)`
    )
    .get(recipeId, userId) as { steps: string } | undefined;
  if (!recipe || !recipeStepsContainVideoId(recipe.steps, videoId)) return null;
  return loadRecipeStepVideoSelection(db, recipeId, videoId);
}

function unauthorizedPlayback(
  c: import('hono').Context<AppEnv>,
  name: string,
  path: string,
  secure: boolean
) {
  c.header('Set-Cookie', serializePlaybackCookie(name, '', path, 0, secure));
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: false, message: 'Playback authorization required' }, 401);
}

function notFoundPlayback(
  c: import('hono').Context<AppEnv>,
  name: string,
  path: string,
  secure: boolean
) {
  c.header('Set-Cookie', serializePlaybackCookie(name, '', path, 0, secure));
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: false, message: 'Video not found' }, 404);
}

function tooManyPlaybackRequests(
  c: import('hono').Context<AppEnv>,
  name: string,
  path: string,
  secure: boolean
) {
  c.header('Set-Cookie', serializePlaybackCookie(name, '', path, 0, secure));
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: false, message: 'Playback authorization expired' }, 429);
}

export const recipeStepVideoRoutes = createRecipeStepVideoRoutes();
