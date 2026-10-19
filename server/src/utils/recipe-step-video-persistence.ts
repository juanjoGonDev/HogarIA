import type { Database as SqlDatabase } from 'better-sqlite3';
import {
  isValidRecipeStepVideoSelection,
  type RecipeStepVideoSelection
} from './recipe-step-videos.js';

export const MAX_RECIPE_STEP_VIDEO_SELECTIONS = 12;

export type RecipeStepVideoAttribution = Pick<
  RecipeStepVideoSelection,
  | 'title'
  | 'author'
  | 'licenseName'
  | 'licenseUrl'
  | 'sourceUrl'
  | 'thumbnailUrl'
  | 'durationSeconds'
  | 'mimeType'
>;

function mapRow(row: Record<string, unknown> | undefined): RecipeStepVideoSelection | null {
  if (!row) return null;
  if (
    typeof row.video_id !== 'string' ||
    !/^[a-f0-9]{24}$/.test(row.video_id) ||
    typeof row.media_url !== 'string' ||
    (row.mime_type !== 'video/mp4' && row.mime_type !== 'video/webm') ||
    typeof row.size_bytes !== 'number' ||
    typeof row.duration_seconds !== 'number'
  ) {
    return null;
  }
  const selection: RecipeStepVideoSelection = {
    id: row.video_id,
    mediaUrl: row.media_url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationSeconds: row.duration_seconds,
    title: String(row.title ?? ''),
    author: String(row.author ?? ''),
    licenseName: String(row.license_name ?? ''),
    licenseUrl: String(row.license_url ?? ''),
    sourceUrl: String(row.source_url ?? ''),
    thumbnailUrl: String(row.thumbnail_url ?? '')
  };
  return isValidRecipeStepVideoSelection(selection) ? selection : null;
}

export function loadRecipeStepVideoSelection(
  db: SqlDatabase,
  recipeId: string,
  videoId: string
): RecipeStepVideoSelection | null {
  if (!/^[a-f0-9]{24}$/.test(videoId)) return null;
  const row = db
    .prepare('SELECT * FROM recipe_step_video_assets WHERE recipe_id = ? AND video_id = ?')
    .get(recipeId, videoId) as Record<string, unknown> | undefined;
  return mapRow(row);
}

export function replaceRecipeStepVideoSelections(
  db: SqlDatabase,
  recipeId: string,
  selections: RecipeStepVideoSelection[]
): void {
  const unique = new Map(selections.map((selection) => [selection.id, selection]));
  if (unique.size > MAX_RECIPE_STEP_VIDEO_SELECTIONS) {
    throw new Error('Recipe has too many selected videos');
  }
  if ([...unique.values()].some((selection) => !isValidRecipeStepVideoSelection(selection))) {
    throw new Error('Invalid validated video selection');
  }

  db.prepare('DELETE FROM recipe_step_video_assets WHERE recipe_id = ?').run(recipeId);
  const insert = db.prepare(
    `INSERT INTO recipe_step_video_assets
      (recipe_id, video_id, title, author, license_name, license_url, source_url,
       thumbnail_url, media_url, mime_type, duration_seconds, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const selection of unique.values()) {
    insert.run(
      recipeId,
      selection.id,
      selection.title,
      selection.author,
      selection.licenseName,
      selection.licenseUrl,
      selection.sourceUrl,
      selection.thumbnailUrl,
      selection.mediaUrl,
      selection.mimeType,
      selection.durationSeconds,
      selection.sizeBytes
    );
  }
}

export function recipeStepsContainVideoId(storedSteps: unknown, videoId: string): boolean {
  let parsed = storedSteps;
  if (typeof storedSteps === 'string') {
    try {
      parsed = JSON.parse(storedSteps) as unknown;
    } catch {
      return false;
    }
  }
  const groups: unknown[][] = Array.isArray(parsed)
    ? [parsed]
    : parsed && typeof parsed === 'object'
      ? Object.values(parsed).filter(Array.isArray)
      : [];
  return groups.some((steps) =>
    steps.some(
      (step) =>
        step !== null &&
        typeof step === 'object' &&
        !Array.isArray(step) &&
        (step as Record<string, unknown>).videoId === videoId
    )
  );
}

export function attachRecipeStepVideoAttribution(
  db: SqlDatabase,
  recipeId: string,
  storedSteps: unknown
): unknown {
  const groups: unknown[][] = Array.isArray(storedSteps)
    ? [storedSteps]
    : storedSteps && typeof storedSteps === 'object'
      ? Object.values(storedSteps).filter(Array.isArray)
      : [];
  const ids = [
    ...new Set(
      groups.flatMap((steps) =>
        steps.flatMap((step) => {
          if (!step || typeof step !== 'object' || Array.isArray(step)) return [];
          const id = (step as Record<string, unknown>).videoId;
          return typeof id === 'string' && /^[a-f0-9]{24}$/.test(id) ? [id] : [];
        })
      )
    )
  ].slice(0, MAX_RECIPE_STEP_VIDEO_SELECTIONS);
  const attributions = new Map<string, RecipeStepVideoAttribution>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT *
           FROM recipe_step_video_assets
          WHERE recipe_id = ? AND video_id IN (${placeholders})`
      )
      .all(recipeId, ...ids) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const mapped = mapRow(row);
      if (!mapped) continue;
      attributions.set(mapped.id, {
        title: mapped.title,
        author: mapped.author,
        licenseName: mapped.licenseName,
        licenseUrl: mapped.licenseUrl,
        sourceUrl: mapped.sourceUrl,
        thumbnailUrl: mapped.thumbnailUrl,
        durationSeconds: mapped.durationSeconds,
        mimeType: mapped.mimeType
      });
    }
  }

  const decorate = (steps: unknown[]): unknown[] =>
    steps.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const { videoAttribution: _untrustedAttribution, ...step } = value as Record<string, unknown>;
      const id = typeof step.videoId === 'string' ? step.videoId : '';
      const attribution = attributions.get(id);
      return attribution ? { ...step, videoAttribution: attribution } : step;
    });

  if (Array.isArray(storedSteps)) return decorate(storedSteps);
  if (!storedSteps || typeof storedSteps !== 'object') return storedSteps;
  return Object.fromEntries(
    Object.entries(storedSteps).map(([level, steps]) => [
      level,
      Array.isArray(steps) ? decorate(steps) : steps
    ])
  );
}
