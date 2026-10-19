import { Hono } from 'hono';
import { getDatabase } from '../config/database.js';

/** Public read-only delivery of raster copies sourced from Wikimedia Commons. */
export const recipeImageRoutes = new Hono();

recipeImageRoutes.get('/:photoId', (c) => {
  const photoId = c.req.param('photoId');
  if (!/^[a-f0-9]{24}$/.test(photoId)) {
    return c.json({ success: false, message: 'Photo not found' }, 404);
  }

  const asset = getDatabase()
    .prepare('SELECT image_data, mime_type FROM recipe_image_assets WHERE id = ?')
    .get(photoId) as { image_data: Buffer; mime_type: string } | undefined;
  if (
    !asset ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime_type) ||
    asset.image_data.byteLength === 0 ||
    asset.image_data.byteLength > 4 * 1024 * 1024
  ) {
    return c.json({ success: false, message: 'Photo not found' }, 404);
  }

  return new Response(new Uint8Array(asset.image_data), {
    status: 200,
    headers: {
      'content-type': asset.mime_type,
      'content-length': String(asset.image_data.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin'
    }
  });
});
