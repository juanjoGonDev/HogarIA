import { Hono } from 'hono';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { selectProductImageSchema, uploadProductImageSchema } from '../schemas/pantry.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import { activeHouseholdId, needsActiveHouseholdSelection } from '../utils/household-context.js';
import {
  cancelProductImageSearch,
  persistedProductImageCandidate,
  photoCandidateFor,
  queueProductImageSearch,
  readProductImageSearch
} from '../utils/product-image-search.js';
import {
  type RecipeStepPhotoProvider
} from '../utils/recipe-step-photos.js';
import { productImagePhotoProvider } from '../utils/product-image-search.js';
import { deleteUpload, storeImage, uploadsRoot } from '../utils/uploads.js';

type SqlDb = ReturnType<typeof getDatabase>;
type Permission = 'view' | 'edit';
type Ingredient = { id: string; user_id: string; household_id: string | null; name: string; image: string | null };

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function permissionAllowed(db: SqlDb, userId: string, householdId: string | null, permission: Permission): boolean {
  if (!householdId) return true;
  const member = db.prepare(
    `SELECT permissions FROM household_members
      WHERE household_id = ? AND user_id = ? AND is_active = 1`
  ).get(householdId, userId) as { permissions: string | null } | undefined;
  if (!member?.permissions) return false;
  try {
    const parsed = JSON.parse(member.permissions) as { pantry?: { view?: unknown; edit?: unknown } };
    return parsed.pantry?.[permission] === true;
  } catch {
    return false;
  }
}

function findIngredient(db: SqlDb, userId: string, ingredientId: string, householdId: string | null): Ingredient | null {
  if (!householdId) {
    return (db.prepare(
      `SELECT id, user_id, household_id, name, image FROM ingredients
        WHERE id = ? AND user_id = ? AND household_id IS NULL`
    ).get(ingredientId, userId) as Ingredient | undefined) ?? null;
  }
  const shared = db.prepare('SELECT shared_pantry FROM households WHERE id = ?').get(householdId) as
    | { shared_pantry: number }
    | undefined;
  const row = shared?.shared_pantry
    ? db.prepare(
        `SELECT id, user_id, household_id, name, image FROM ingredients
          WHERE id = ? AND (household_id = ? OR (household_id IS NULL AND user_id = ?))`
      ).get(ingredientId, householdId, userId)
    : db.prepare(
        `SELECT id, user_id, household_id, name, image FROM ingredients
          WHERE id = ? AND ((household_id = ? AND user_id = ?) OR (household_id IS NULL AND user_id = ?))`
      ).get(ingredientId, householdId, userId, userId);
  return (row as Ingredient | undefined) ?? null;
}

function updateImage(db: SqlDb, ingredient: Ingredient, image: string, userId: string): void {
  if (ingredient.household_id) {
    db.prepare(
      `UPDATE ingredients SET image = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id = ?`
    ).run(image, ingredient.id, ingredient.household_id);
  } else {
    db.prepare(
      `UPDATE ingredients SET image = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND household_id IS NULL AND user_id = ?`
    ).run(image, ingredient.id, userId);
  }
}

function decodeProductImage(value: string): { mime: 'image/jpeg' | 'image/png' | 'image/webp'; buffer: Buffer } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase() as 'image/jpeg' | 'image/png' | 'image/webp';
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) return null;
  const validSignature =
    (mime === 'image/jpeg' && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (mime === 'image/png' && buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (mime === 'image/webp' && buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
  return validSignature ? { mime, buffer } : null;
}

function removePreviousProductUpload(image: string | null, ingredientId: string): void {
  if (!image?.startsWith('/api/uploads/product-images/')) return;
  const fileName = image.slice(image.lastIndexOf('/') + 1);
  const prefix = ingredientId.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.{2,}/g, '-').slice(0, 48);
  if (fileName.startsWith(`${prefix}-`)) deleteUpload(image, uploadsRoot());
}

export function createPantryProductImageRoutes(
  provider: RecipeStepPhotoProvider = productImagePhotoProvider
): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('*', authMiddleware);
  routes.use('*', async (c, next) => {
    const db = getDatabase();
    if (needsActiveHouseholdSelection(db, c.get('userId'))) {
      return c.json({ success: false, code: 'HOUSEHOLD_SELECTION_REQUIRED' }, 409);
    }
    return next();
  });

  routes.get('/ingredients/:id/image-search', (c) => {
    const db = getDatabase();
    const userId = c.get('userId');
    const householdId = activeHouseholdId(db, userId);
    if (!permissionAllowed(db, userId, householdId, 'view')) {
      return c.json({ success: false, code: 'PANTRY_VIEW_FORBIDDEN' }, 403);
    }
    const ingredient = findIngredient(db, userId, c.req.param('id'), householdId);
    if (!ingredient) return c.json({ success: false, code: 'PRODUCT_NOT_FOUND' }, 404);
    return c.json({
      success: true,
      data: readProductImageSearch(db, ingredient.id, userId, ingredient.household_id)
    });
  });

  routes.post('/ingredients/:id/image-search/retry', (c) => {
    const db = getDatabase();
    const userId = c.get('userId');
    const householdId = activeHouseholdId(db, userId);
    if (!permissionAllowed(db, userId, householdId, 'edit')) {
      return c.json({ success: false, code: 'PANTRY_EDIT_FORBIDDEN' }, 403);
    }
    const ingredient = findIngredient(db, userId, c.req.param('id'), householdId);
    if (!ingredient) return c.json({ success: false, code: 'PRODUCT_NOT_FOUND' }, 404);
    const current = readProductImageSearch(db, ingredient.id, userId, ingredient.household_id);
    if (current.status === 'queued' || current.status === 'running') {
      return c.json({ success: true, data: current }, 202);
    }
    if (current.status === 'complete' && current.candidates.length > 0) {
      return c.json({ success: false, code: 'IMAGE_SEARCH_ALREADY_COMPLETE', data: current }, 409);
    }
    const data = queueProductImageSearch(db, userId, ingredient.id, { force: true, provider });
    return c.json({ success: true, data }, 202);
  });

  routes.post('/ingredients/:id/image-search/cancel', (c) => {
    const db = getDatabase();
    const userId = c.get('userId');
    const householdId = activeHouseholdId(db, userId);
    if (!permissionAllowed(db, userId, householdId, 'edit')) {
      return c.json({ success: false, code: 'PANTRY_EDIT_FORBIDDEN' }, 403);
    }
    const ingredient = findIngredient(db, userId, c.req.param('id'), householdId);
    if (!ingredient) return c.json({ success: false, code: 'PRODUCT_NOT_FOUND' }, 404);
    const cancelled = cancelProductImageSearch(db, ingredient.id, userId, ingredient.household_id);
    if (!cancelled) return c.json({ success: false, code: 'IMAGE_SEARCH_NOT_CANCELLABLE' }, 409);
    return c.json({ success: true, data: readProductImageSearch(db, ingredient.id, userId, ingredient.household_id) });
  });

  routes.post('/ingredients/:id/image-search/select', async (c) => {
    const db = getDatabase();
    const userId = c.get('userId');
    const householdId = activeHouseholdId(db, userId);
    if (!permissionAllowed(db, userId, householdId, 'edit')) {
      return c.json({ success: false, code: 'PANTRY_EDIT_FORBIDDEN' }, 403);
    }
    const ingredient = findIngredient(db, userId, c.req.param('id'), householdId);
    if (!ingredient) return c.json({ success: false, code: 'PRODUCT_NOT_FOUND' }, 404);
    const body = selectProductImageSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, code: 'INVALID_IMAGE_SELECTION' }, 400);
    const candidate = photoCandidateFor(db, ingredient.id, userId, ingredient.household_id, body.data.photoId);
    const photo = candidate && (provider.getPhoto(candidate.id) ?? candidate);
    if (!candidate || !photo) return c.json({ success: false, code: 'IMAGE_CANDIDATE_EXPIRED' }, 409);
    try {
      let image = await provider.getImage(candidate.id).catch(() => null);
      if (!image && candidate.thumbnailUrl && provider.getImageFromUrl) {
        image = await provider.getImageFromUrl(candidate.thumbnailUrl);
      }
      if (!image || image.bytes.byteLength < 1 || image.bytes.byteLength > 4 * 1024 * 1024) {
        return c.json({ success: false, code: 'IMAGE_UNAVAILABLE' }, 502);
      }
      db.prepare(
        `INSERT OR IGNORE INTO recipe_image_assets
          (id, image_data, mime_type, alt_text, author, license_name, license_url, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        candidate.id,
        Buffer.from(image.bytes),
        image.mimeType,
        candidate.altText,
        candidate.author,
        candidate.licenseName,
        candidate.licenseUrl,
        candidate.sourceUrl
      );
      const imageUrl = `/api/recipe-images/${candidate.id}`;
      updateImage(db, ingredient, imageUrl, userId);
      removePreviousProductUpload(ingredient.image, ingredient.id);
      return c.json({ success: true, data: { image: imageUrl, attribution: candidate } });
    } catch {
      return c.json({ success: false, code: 'IMAGE_UNAVAILABLE' }, 502);
    }
  });

  routes.post('/ingredients/:id/image', async (c) => {
    const db = getDatabase();
    const userId = c.get('userId');
    const householdId = activeHouseholdId(db, userId);
    if (!permissionAllowed(db, userId, householdId, 'edit')) {
      return c.json({ success: false, code: 'PANTRY_EDIT_FORBIDDEN' }, 403);
    }
    const ingredient = findIngredient(db, userId, c.req.param('id'), householdId);
    if (!ingredient) return c.json({ success: false, code: 'PRODUCT_NOT_FOUND' }, 404);
    const body = uploadProductImageSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ success: false, code: 'INVALID_PRODUCT_IMAGE' }, 400);
    const parsed = decodeProductImage(body.data.dataUrl);
    if (!parsed) return c.json({ success: false, code: 'INVALID_PRODUCT_IMAGE' }, 400);
    let imageUrl: string | null = null;
    try {
      imageUrl = storeImage('product-images', ingredient.id, parsed, uploadsRoot());
      updateImage(db, ingredient, imageUrl, userId);
      removePreviousProductUpload(ingredient.image, ingredient.id);
      return c.json({ success: true, data: { image: imageUrl } });
    } catch {
      if (imageUrl) deleteUpload(imageUrl, uploadsRoot());
      return c.json({ success: false, code: 'IMAGE_UPLOAD_FAILED' }, 500);
    }
  });

  return routes;
}

/** Same-origin raster preview for the already validated public product candidates. */
export function createProductImagePreviewRoutes(
  provider: RecipeStepPhotoProvider = productImagePhotoProvider
): Hono {
  const routes = new Hono();
  routes.get('/:photoId', async (c) => {
    const photoId = c.req.param('photoId');
    const candidate = persistedProductImageCandidate(getDatabase(), photoId);
    if (!candidate) {
      return c.json({ success: false, code: 'IMAGE_NOT_FOUND' }, 404);
    }
    try {
      let image = await provider.getImage(photoId).catch(() => null);
      if (!image && candidate.thumbnailUrl && provider.getImageFromUrl) {
        image = await provider.getImageFromUrl(candidate.thumbnailUrl);
      }
      if (!image || image.bytes.byteLength < 1 || image.bytes.byteLength > 4 * 1024 * 1024) {
        return c.json({ success: false, code: 'IMAGE_NOT_FOUND' }, 404);
      }
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
      return c.json({ success: false, code: 'IMAGE_UNAVAILABLE' }, 502);
    }
  });
  return routes;
}
