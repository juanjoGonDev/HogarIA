import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../types/hono-env.js';
import {
  MAX_RECIPE_CONTENT_REQUEST_BYTES,
  recipeContentBodyLimit
} from './recipe-content-body-limit.middleware.js';

describe('recipeContentBodyLimit', () => {
  it('allows recipe text below the total request byte limit', async () => {
    const app = new Hono<AppEnv>();
    app.post('/', recipeContentBodyLimit(), (c) => c.json({ success: true }));

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(2_501) })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('rejects an oversized body with a stable 413 before running the handler', async () => {
    const app = new Hono<AppEnv>();
    const handler = vi.fn();
    app.post('/', recipeContentBodyLimit(), (c) => {
      handler();
      return c.json({ success: true });
    });

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(MAX_RECIPE_CONTENT_REQUEST_BYTES + 1) })
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      success: false,
      code: 'RECIPE_CONTENT_BODY_TOO_LARGE'
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
