import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

let app: Hono;
let db: import('better-sqlite3').Database;
let closeDatabase: () => void;

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  const routes = await import('./recipe-images.routes.js');
  app = new Hono();
  app.route('/api/recipe-images', routes.recipeImageRoutes);
});

afterAll(() => closeDatabase?.());

describe('GET /api/recipe-images/:photoId', () => {
  it('serves only a bounded raster asset by stable id without exposing attribution metadata', async () => {
    const id = 'f'.repeat(24);
    db.prepare(
      `INSERT INTO recipe_image_assets
        (id, image_data, mime_type, alt_text, author, license_name, license_url, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      'image/jpeg',
      'Tortilla española',
      'Cocinera',
      'CC BY 4.0',
      'https://creativecommons.org/licenses/by/4.0/',
      'https://commons.wikimedia.org/wiki/File:Tortilla.jpg'
    );

    const response = await app.request(`/api/recipe-images/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
  });

  it('does not serve malformed identifiers or missing assets', async () => {
    expect((await app.request('/api/recipe-images/not-an-id')).status).toBe(404);
    expect((await app.request(`/api/recipe-images/${'0'.repeat(24)}`)).status).toBe(404);
  });
});
