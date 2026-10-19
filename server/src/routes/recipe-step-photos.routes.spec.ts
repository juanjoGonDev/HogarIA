import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import type { RecipeStepPhotoProvider } from '../utils/recipe-step-photos.js';

let secret: string;
let userToken: string;
let createRoutes: typeof import('./recipe-step-photos.routes.js').createRecipeStepPhotoRoutes;
let createPreviewRoutes: typeof import('./recipe-step-photos.routes.js').createRecipePhotoPreviewRoutes;
let closeDatabase: () => void;

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  closeDatabase = database.closeDatabase;
  const appConfig = await import('../config/app.config.js');
  secret = appConfig.config.auth.jwtSecret;
  ({
    createRecipeStepPhotoRoutes: createRoutes,
    createRecipePhotoPreviewRoutes: createPreviewRoutes
  } = await import('./recipe-step-photos.routes.js'));
  userToken = jwt.sign({ sub: 'step-photo-user', email: 'step-photo@test.local' }, secret);
});

afterAll(() => closeDatabase?.());

function makeApp(provider: RecipeStepPhotoProvider) {
  const app = new Hono();
  app.route('/api/recipes/step-photos', createRoutes(provider));
  return app;
}

function requestHeaders(token?: string) {
  return token ? { authorization: `Bearer ${token}` } : undefined;
}

describe('GET /api/recipes/step-photos', () => {
  it('requires auth and accepts only the fixed scene parameter', async () => {
    const provider = { search: vi.fn(), getImage: vi.fn() } as unknown as RecipeStepPhotoProvider;
    const app = makeApp(provider);

    expect((await app.request('/api/recipes/step-photos?scene=cut')).status).toBe(401);
    expect(
      (
        await app.request('/api/recipes/step-photos?scene=banana', {
          headers: requestHeaders(userToken)
        })
      ).status
    ).toBe(400);
    expect(
      (
        await app.request('/api/recipes/step-photos?scene=cut&query=private-recipe', {
          headers: requestHeaders(userToken)
        })
      ).status
    ).toBe(400);
    expect(provider.search).not.toHaveBeenCalled();
  });

  it('serves only a validated photo preview through a same-origin public image response', async () => {
    const id = 'd'.repeat(24);
    const provider: RecipeStepPhotoProvider = {
      search: vi.fn(),
      searchByQuery: vi.fn(),
      getPhoto: vi.fn((photoId: string) => photoId === id
        ? { id, altText: 'Plato', author: 'A', licenseName: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Test.jpg' }
        : null),
      getImage: vi.fn().mockResolvedValue({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: 'image/jpeg' })
    };
    const app = new Hono();
    app.route('/api/recipe-photo-previews', createPreviewRoutes(provider));

    const preview = await app.request(`/api/recipe-photo-previews/${id}`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('image/jpeg');
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Array.from(new Uint8Array(await preview.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff]);
    expect(provider.getImage).toHaveBeenCalledWith(id);
    expect((await app.request(`/api/recipe-photo-previews/${'e'.repeat(24)}`)).status).toBe(404);
  });

  it('requires auth and accepts only a short explicit cover-photo query', async () => {
    const candidate = {
      id: 'c'.repeat(24),
      altText: 'Tortilla española',
      author: 'María',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tortilla.jpg'
    };
    const searchByQuery = vi.fn().mockResolvedValue([candidate]);
    const provider = {
      search: vi.fn(),
      searchByQuery,
      getPhoto: vi.fn(),
      getImage: vi.fn()
    } as unknown as RecipeStepPhotoProvider;
    const app = makeApp(provider);

    expect((await app.request('/api/recipes/step-photos/search?q=tortilla')).status).toBe(401);
    expect(
      (
        await app.request('/api/recipes/step-photos/search?q=t', {
          headers: requestHeaders(userToken)
        })
      ).status
    ).toBe(400);
    expect(
      (
        await app.request(`/api/recipes/step-photos/search?q=${'x'.repeat(81)}`, {
          headers: requestHeaders(userToken)
        })
      ).status
    ).toBe(400);
    expect(
      (
        await app.request('/api/recipes/step-photos/search?q=tortilla&scene=cut', {
          headers: requestHeaders(userToken)
        })
      ).status
    ).toBe(400);
    expect(searchByQuery).not.toHaveBeenCalled();

    const valid = await app.request('/api/recipes/step-photos/search?q=tortilla%20espa%C3%B1ola', {
      headers: requestHeaders(userToken)
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({
      success: true,
      data: [{ ...candidate, previewUrl: `/api/recipe-photo-previews/${candidate.id}` }]
    });
    expect(searchByQuery).toHaveBeenCalledWith('tortilla española', expect.any(AbortSignal));
  });

  it('returns photo metadata without an external image URL and proxies bounded photo bytes', async () => {
    const photo = {
      id: 'a'.repeat(24),
      altText: 'Vegetables on a board',
      author: 'Ana',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg'
    };
    const provider: RecipeStepPhotoProvider = {
      search: vi.fn().mockResolvedValue(photo),
      searchByQuery: vi.fn().mockResolvedValue([]),
      getPhoto: vi.fn().mockReturnValue(photo),
      getImage: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' })
    };
    const app = makeApp(provider);

    const metadata = await app.request('/api/recipes/step-photos?scene=cut', {
      headers: requestHeaders(userToken)
    });
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toEqual({ success: true, data: photo });

    const image = await app.request(`/api/recipes/step-photos/${photo.id}/image`, {
      headers: requestHeaders(userToken)
    });
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(provider.getImage).toHaveBeenCalledWith(photo.id);
  });

  it('normalizes missing images and upstream errors without leaking provider detail', async () => {
    const provider: RecipeStepPhotoProvider = {
      search: vi.fn().mockRejectedValue(new Error('private upstream details')),
      searchByQuery: vi.fn().mockRejectedValue(new Error('private upstream details')),
      getPhoto: vi.fn().mockReturnValue(null),
      getImage: vi.fn().mockResolvedValue(null)
    };
    const app = makeApp(provider);

    const failed = await app.request('/api/recipes/step-photos?scene=cook', {
      headers: requestHeaders(userToken)
    });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ success: false, message: 'Photo search unavailable' });

    const missing = await app.request(`/api/recipes/step-photos/${'b'.repeat(24)}/image`, {
      headers: requestHeaders(userToken)
    });
    expect(missing.status).toBe(404);
  });
});
