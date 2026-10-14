import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types/hono-env.js';

/** Text fields have no character cap; a byte cap still bounds request buffering. */
export const MAX_RECIPE_CONTENT_REQUEST_BYTES = 8 * 1024 * 1024;

export function recipeContentBodyLimit(): MiddlewareHandler<AppEnv> {
  return bodyLimit({
    maxSize: MAX_RECIPE_CONTENT_REQUEST_BYTES,
    onError: (c) => c.json({ success: false, code: 'RECIPE_CONTENT_BODY_TOO_LARGE' }, 413)
  });
}
