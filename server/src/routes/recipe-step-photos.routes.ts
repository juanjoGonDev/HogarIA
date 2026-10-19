import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  RECIPE_STEP_PHOTO_SCENES,
  recipeStepPhotoProvider,
  type RecipeStepPhotoProvider
} from '../utils/recipe-step-photos.js';
import type { AppEnv } from '../types/hono-env.js';

export function createRecipeStepPhotoRoutes(
  provider: RecipeStepPhotoProvider = recipeStepPhotoProvider
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', authMiddleware);

  routes.get('/', async (c) => {
    const query = c.req.query();
    const keys = Object.keys(query);
    const scene = query.scene;
    if (
      keys.length !== 1 ||
      keys[0] !== 'scene' ||
      !scene ||
      !(RECIPE_STEP_PHOTO_SCENES as readonly string[]).includes(scene)
    ) {
      return c.json({ success: false, message: 'Invalid photo scene' }, 400);
    }

    try {
      const photo = await provider.search(scene as (typeof RECIPE_STEP_PHOTO_SCENES)[number]);
      return c.json({ success: true, data: photo });
    } catch {
      return c.json({ success: false, message: 'Photo search unavailable' }, 502);
    }
  });

  routes.get('/search', async (c) => {
    const query = c.req.query();
    const keys = Object.keys(query);
    const rawSearch = query.q;
    const normalized = rawSearch?.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (
      keys.length !== 1 ||
      keys[0] !== 'q' ||
      !normalized ||
      normalized.length < 2 ||
      normalized.length > 80
    ) {
      return c.json({ success: false, message: 'Invalid photo search query' }, 400);
    }

    try {
      const photos = await provider.searchByQuery(normalized, c.req.raw.signal);
      return c.json({
        success: true,
        data: photos.slice(0, 10).map((photo) => ({
          ...photo,
          previewUrl: `/api/recipe-photo-previews/${photo.id}`
        }))
      });
    } catch {
      return c.json({ success: false, message: 'Photo search unavailable' }, 502);
    }
  });

  routes.get('/:photoId/image', async (c) => {
    const photoId = c.req.param('photoId');
    if (!/^[a-f0-9]{24}$/.test(photoId)) {
      return c.json({ success: false, message: 'Photo not found' }, 404);
    }

    try {
      const image = await provider.getImage(photoId);
      if (!image) return c.json({ success: false, message: 'Photo not found' }, 404);
      return new Response(image.bytes, {
        status: 200,
        headers: {
          'content-type': image.mimeType,
          'content-length': String(image.bytes.byteLength),
          'cache-control': 'private, max-age=3600',
          'x-content-type-options': 'nosniff',
          'cross-origin-resource-policy': 'same-origin'
        }
      });
    } catch {
      return c.json({ success: false, message: 'Photo unavailable' }, 502);
    }
  });

  return routes;
}

export const recipeStepPhotoRoutes = createRecipeStepPhotoRoutes();

/**
 * Public image-only proxy for already validated Wikimedia results. The identifiers are random
 * hashes of public Wikimedia thumbnails; this endpoint reveals no recipe, account, or attribution
 * metadata, and every image is bounded and raster-validated by the provider.
 */
export function createRecipePhotoPreviewRoutes(
  provider: RecipeStepPhotoProvider = recipeStepPhotoProvider
): Hono {
  const routes = new Hono();
  routes.get('/:photoId', async (c) => {
    const photoId = c.req.param('photoId');
    if (!/^[a-f0-9]{24}$/.test(photoId) || !provider.getPhoto(photoId)) {
      return c.json({ success: false, message: 'Photo not found' }, 404);
    }

    try {
      const image = await provider.getImage(photoId);
      if (!image) return c.json({ success: false, message: 'Photo not found' }, 404);
      return new Response(image.bytes, {
        status: 200,
        headers: {
          'content-type': image.mimeType,
          'content-length': String(image.bytes.byteLength),
          'cache-control': 'public, max-age=300',
          'x-content-type-options': 'nosniff',
          'cross-origin-resource-policy': 'same-origin'
        }
      });
    } catch {
      return c.json({ success: false, message: 'Photo unavailable' }, 502);
    }
  });
  return routes;
}

export const recipePhotoPreviewRoutes = createRecipePhotoPreviewRoutes();
