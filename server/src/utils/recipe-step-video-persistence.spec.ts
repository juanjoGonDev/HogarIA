import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachRecipeStepVideoAttribution,
  loadRecipeStepVideoSelection,
  recipeStepsContainVideoId,
  replaceRecipeStepVideoSelections
} from './recipe-step-video-persistence.js';
import type { RecipeStepVideoSelection } from './recipe-step-videos.js';

const VIDEO_URL = 'https://upload.wikimedia.org/wikipedia/commons/transcoded/chop.webm';
const VIDEO_ID = createHash('sha256').update(VIDEO_URL).digest('hex').slice(0, 24);

function makeSelection(mediaUrl = VIDEO_URL): RecipeStepVideoSelection {
  return {
    id: createHash('sha256').update(mediaUrl).digest('hex').slice(0, 24),
    title: 'Cortar verduras',
    author: 'Autora Commons',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Chop.webm',
    thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/chop.jpg',
    mediaUrl,
    durationSeconds: 18,
    sizeBytes: 700000,
    mimeType: 'video/webm'
  };
}

describe('recipe step video persistence', () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function setup(): Database.Database {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE recipes (id TEXT PRIMARY KEY, steps TEXT NOT NULL);
      CREATE TABLE recipe_step_video_assets (
        recipe_id TEXT NOT NULL,
        video_id TEXT NOT NULL CHECK(length(video_id) = 24),
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        license_name TEXT NOT NULL,
        license_url TEXT NOT NULL,
        source_url TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL,
        media_url TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        PRIMARY KEY(recipe_id, video_id),
        FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      );
      INSERT INTO recipes (id, steps) VALUES ('recipe', '[]');
    `);
    return db;
  }

  it('persists validated server metadata and returns attribution without media URL', () => {
    const database = setup();
    replaceRecipeStepVideoSelections(database, 'recipe', [makeSelection()]);

    expect(loadRecipeStepVideoSelection(database, 'recipe', VIDEO_ID)).toMatchObject({
      id: VIDEO_ID,
      mediaUrl: makeSelection().mediaUrl,
      mimeType: 'video/webm'
    });
    const decorated = attachRecipeStepVideoAttribution(database, 'recipe', [
      {
        stepNumber: 1,
        instruction: 'Cortar.',
        videoId: VIDEO_ID,
        videoAttribution: { author: 'Fake' }
      }
    ]) as Array<Record<string, unknown>>;
    expect(decorated[0]?.videoAttribution).toMatchObject({
      author: 'Autora Commons',
      licenseName: 'CC BY 4.0',
      sourceUrl: makeSelection().sourceUrl
    });
    expect(JSON.stringify(decorated)).not.toContain(makeSelection().mediaUrl);
    expect(JSON.stringify(decorated)).not.toContain('Fake');
  });

  it('replaces deleted selections and cascades assets when the recipe is deleted', () => {
    const database = setup();
    const other = makeSelection(
      'https://upload.wikimedia.org/wikipedia/commons/transcoded/other.webm'
    );
    replaceRecipeStepVideoSelections(database, 'recipe', [makeSelection(), other]);
    replaceRecipeStepVideoSelections(database, 'recipe', [other]);

    expect(loadRecipeStepVideoSelection(database, 'recipe', VIDEO_ID)).toBeNull();
    expect(loadRecipeStepVideoSelection(database, 'recipe', other.id)).not.toBeNull();
    database.prepare('DELETE FROM recipes WHERE id = ?').run('recipe');
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM recipe_step_video_assets').get()
    ).toMatchObject({ count: 0 });
  });

  it('rejects unvalidated URLs and over-limit selections without deleting existing rows', () => {
    const database = setup();
    replaceRecipeStepVideoSelections(database, 'recipe', [makeSelection()]);
    const unsafe = makeSelection('https://attacker.test/video.webm');
    const excessive = Array.from({ length: 13 }, (_, index) =>
      makeSelection(`https://upload.wikimedia.org/wikipedia/commons/transcoded/${index}.webm`)
    );

    expect(() => replaceRecipeStepVideoSelections(database, 'recipe', [unsafe])).toThrow();
    expect(() => replaceRecipeStepVideoSelections(database, 'recipe', excessive)).toThrow();
    expect(loadRecipeStepVideoSelection(database, 'recipe', VIDEO_ID)).not.toBeNull();
  });

  it('reloads the selected stream source from a closed and reopened SQLite file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'hogaria-recipe-video-'));
    const filePath = join(directory, 'recipes.sqlite');
    let fileDb: Database.Database | undefined;
    try {
      fileDb = new Database(filePath);
      fileDb.pragma('foreign_keys = ON');
      fileDb.exec(`
        CREATE TABLE recipes (id TEXT PRIMARY KEY, steps TEXT NOT NULL);
        CREATE TABLE recipe_step_video_assets (
          recipe_id TEXT NOT NULL,
          video_id TEXT NOT NULL CHECK(length(video_id) = 24),
          title TEXT NOT NULL,
          author TEXT NOT NULL,
          license_name TEXT NOT NULL,
          license_url TEXT NOT NULL,
          source_url TEXT NOT NULL,
          thumbnail_url TEXT NOT NULL,
          media_url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL,
          size_bytes INTEGER NOT NULL,
          PRIMARY KEY(recipe_id, video_id),
          FOREIGN KEY(recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );
        INSERT INTO recipes (id, steps) VALUES ('recipe', '[]');
      `);
      replaceRecipeStepVideoSelections(fileDb, 'recipe', [makeSelection()]);
      fileDb.close();

      fileDb = new Database(filePath);
      expect(loadRecipeStepVideoSelection(fileDb, 'recipe', VIDEO_ID)).toMatchObject({
        id: VIDEO_ID,
        mediaUrl: makeSelection().mediaUrl,
        author: 'Autora Commons'
      });
    } finally {
      if (fileDb?.open) fileDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed records and enforces references against stored recipe steps', () => {
    const database = setup();
    replaceRecipeStepVideoSelections(database, 'recipe', [makeSelection()]);
    const invalid = database.prepare(
      `INSERT INTO recipe_step_video_assets
       (recipe_id, video_id, title, author, license_name, license_url, source_url,
        thumbnail_url, media_url, mime_type, duration_seconds, size_bytes)
       VALUES ('recipe', 'bad-id', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'video/webm', 1, 1)`
    );

    expect(() => invalid.run()).toThrow();
    expect(recipeStepsContainVideoId(JSON.stringify([{ videoId: VIDEO_ID }]), VIDEO_ID)).toBe(true);
    expect(recipeStepsContainVideoId({ basic: [{ videoId: VIDEO_ID }] }, VIDEO_ID)).toBe(true);
    expect(recipeStepsContainVideoId('{bad json', VIDEO_ID)).toBe(false);
    expect(recipeStepsContainVideoId([{ videoId: 'b'.repeat(24) }], VIDEO_ID)).toBe(false);
    expect(loadRecipeStepVideoSelection(database, 'recipe', 'not-an-id')).toBeNull();
    database
      .prepare('UPDATE recipe_step_video_assets SET media_url = ? WHERE video_id = ?')
      .run('https://127.0.0.1/private.mp4', VIDEO_ID);
    expect(loadRecipeStepVideoSelection(database, 'recipe', VIDEO_ID)).toBeNull();
  });
});
