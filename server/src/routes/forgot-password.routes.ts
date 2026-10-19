import { Hono } from 'hono';
import { forgotPasswordSchema } from '../schemas/auth.schema.js';
import type { AppEnv } from '../types/hono-env.js';

export const forgotPasswordRoutes = new Hono<AppEnv>();

forgotPasswordRoutes.post('/forgot-password', async (c) => {
  forgotPasswordSchema.parse(await c.req.json());

  // No reset delivery exists yet, so avoid even querying account existence here.
  return c.json({
    success: true,
    message: 'Password recovery is not currently available'
  });
});
