import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { activeAiConfigForScope } from './ai-client.js';
import { activeHouseholdId } from './household-context.js';
import { submitAiTask, cancelarTrabajo } from './ticket-queue.js';
import {
  recipeStepPhotoProvider,
  type RecipeStepPhoto,
  type RecipeStepPhotoProvider
} from './recipe-step-photos.js';

type SqlDb = Database.Database;

const TEST_IMAGE_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAFAAAAA8CAIAAAB+RarbAAABfElEQVR4nO3aTW7CMBAFYO6UBRKrSixQlSP0Du0FWHIjjoNyiKLu6SKSNbKxY/C8ySR50lvxI82nRyDY3j3ut01lN/sEBBNMMMEEE0zwZmIB/rycQl59luAlgAsqYy3ByHx8H0JSsNkYc4Lt67UDD30nwUPfDX0nweMjawCPkggsqUEbslRwxKgHQ9kocArIgX+/9mNszPrgaOjgkeC/n2OanNw1+Kl29EyCJRtn1gSnWimpBAc2yAwBy2LfA6dVuwPnun1czzI11FzPjsCVWg9mZXD0SW4HR2YX4MKlqwVWNCuDo1lVwLolt4ILv0MgcKNZDZxq27+lESXDwVohmGCCgeCnN8/q4GCeH7y5hgkmmODFg6FmR/fSNiU7+rc0uZSlovUFRpfsbsUDeiU7XdMCmf2uWkZmlYvZ+7r05M5DS7dOweW9pfeK1dWa7h5WUhe2e5hjS3ku6VsQg9mdAEj95ReAprI741Ef6Dx2p3hmp5qC/YTgtYfgtecfDUQWo6W+HLIAAAAASUVORK5CYII=',
    'base64'
  )
);
const TEST_PHOTOS: RecipeStepPhoto[] = Array.from({ length: 10 }, (_, index) => ({
  id: (index + 1).toString(16).padStart(24, '0'),
  altText: `Fotografía sintética de alimento ${index + 1}`,
  author: 'HogarIA test fixture',
  licenseName: 'CC0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  sourceUrl: `https://commons.wikimedia.org/wiki/File:Synthetic_food_${index + 1}.png`
}));

/** Repeatable fixture provider: test suites never contact Wikimedia or any external host. */
const testProductImageProvider: RecipeStepPhotoProvider = {
  search: async () => null,
  searchByQuery: async (_query, signal) => {
    if (signal?.aborted) throw Object.assign(new Error('Search cancelled'), { name: 'AbortError' });
    return TEST_PHOTOS;
  },
  getPhoto: (id) => TEST_PHOTOS.find((photo) => photo.id === id) ?? null,
  getImage: async (id) =>
    TEST_PHOTOS.some((photo) => photo.id === id)
      ? { bytes: TEST_IMAGE_BYTES, mimeType: 'image/png' }
      : null
};

export const productImagePhotoProvider =
  process.env.NODE_ENV === 'test' || process.env.PANTRY_IMAGE_SEARCH_FIXTURE === '1'
    ? testProductImageProvider
    : recipeStepPhotoProvider;

export interface ProductImageCandidate extends RecipeStepPhoto {
  previewUrl: string;
}

export interface ProductImageSearchView {
  status: 'idle' | 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  jobId: string | null;
  candidates: ProductImageCandidate[];
  errorCode: string | null;
}

interface IngredientRow {
  id: string;
  name: string;
  user_id: string;
  household_id: string | null;
  image: string | null;
}

interface StoredSearch {
  ingredient_id: string;
  user_id: string;
  household_id: string | null;
  job_id: string;
  candidates_json: string;
  status: ProductImageSearchView['status'];
  error_code: string | null;
  queue_status: string | null;
  queue_error: string | null;
}

function parseCandidates(value: string): ProductImageCandidate[] {
  try {
    const result: unknown = JSON.parse(value);
    return Array.isArray(result) ? (result.slice(0, 10) as ProductImageCandidate[]) : [];
  } catch {
    return [];
  }
}

function safeState(row: StoredSearch): ProductImageSearchView['status'] {
  if (row.queue_status === 'queued') return 'queued';
  if (row.queue_status === 'running') return 'running';
  if (row.queue_status === 'done') return 'complete';
  if (row.queue_status === 'failed') return 'failed';
  if (row.queue_status === 'stopped') return 'cancelled';
  return row.status;
}

export function readProductImageSearch(
  db: SqlDb,
  ingredientId: string,
  userId: string,
  householdId: string | null
): ProductImageSearchView {
  const row = db
    .prepare(
      `SELECT s.ingredient_id, s.user_id, s.household_id, s.job_id, s.candidates_json,
              s.status, s.error_code, j.status AS queue_status, j.error_code AS queue_error
         FROM product_image_searches s
         LEFT JOIN ai_jobs j ON j.id = s.job_id
        WHERE s.ingredient_id = ? AND s.household_id IS ?
          AND (s.household_id IS NOT NULL OR s.user_id = ?)`
    )
    .get(ingredientId, householdId, userId) as StoredSearch | undefined;
  if (!row) return { status: 'idle', jobId: null, candidates: [], errorCode: null };

  const status = safeState(row);
  const errorCode =
    status === 'failed' ? (row.queue_error ?? row.error_code ?? 'SEARCH_FAILED') : null;
  if (status !== row.status || errorCode !== row.error_code) {
    db.prepare(
      `UPDATE product_image_searches SET status = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE ingredient_id = ? AND job_id = ?`
    ).run(status, errorCode, ingredientId, row.job_id);
  }
  return {
    status,
    jobId: row.job_id,
    candidates: parseCandidates(row.candidates_json),
    errorCode
  };
}

/**
 * Add/retry a Commons lookup through the shared AI dispatcher. A household's configured
 * concurrency therefore also bounds background photo discovery; with no provider configured,
 * the dispatcher serializes provider-independent work at one job at a time.
 */
export function queueProductImageSearch(
  db: SqlDb,
  userId: string,
  ingredientId: string,
  options: {
    force?: boolean;
    provider?: RecipeStepPhotoProvider;
    /** Use the action's validated scope without repairing the user's selected-household pointer. */
    householdId?: string | null;
  } = {}
): ProductImageSearchView {
  const provider = options.provider ?? productImagePhotoProvider;
  const selectedHome =
    options.householdId === undefined ? activeHouseholdId(db, userId) : options.householdId;
  const ingredient = (
    selectedHome
      ? db
          .prepare(
            `SELECT id, name, user_id, household_id, image FROM ingredients
          WHERE id = ? AND (household_id = ? OR (household_id IS NULL AND user_id = ?))`
          )
          .get(ingredientId, selectedHome, userId)
      : db
          .prepare(
            `SELECT id, name, user_id, household_id, image FROM ingredients
          WHERE id = ? AND household_id IS NULL AND user_id = ?`
          )
          .get(ingredientId, userId)
  ) as IngredientRow | undefined;
  if (!ingredient) throw new Error('PRODUCT_NOT_FOUND');

  const existing = readProductImageSearch(db, ingredientId, userId, ingredient.household_id);
  if (existing.status === 'queued' || existing.status === 'running') return existing;
  if (!options.force && existing.status !== 'idle') return existing;
  if (ingredient.image && !options.force) return existing;

  const jobId = nanoid();
  const providerHouseholdId =
    options.householdId === undefined
      ? (activeHouseholdId(db, userId) ?? ingredient.household_id)
      : options.householdId;
  const config = activeAiConfigForScope(db, userId, providerHouseholdId);
  db.prepare(
    `INSERT INTO product_image_searches
      (ingredient_id, user_id, household_id, job_id, candidates_json, status, error_code, updated_at)
     VALUES (?, ?, ?, ?, '[]', 'queued', NULL, CURRENT_TIMESTAMP)
     ON CONFLICT(ingredient_id) DO UPDATE SET
       user_id = excluded.user_id, household_id = excluded.household_id, job_id = excluded.job_id,
       candidates_json = '[]', status = 'queued', error_code = NULL, updated_at = CURRENT_TIMESTAMP`
  ).run(ingredient.id, userId, ingredient.household_id, jobId);

  try {
    const task = submitAiTask({
      db,
      id: jobId,
      userId,
      householdId: providerHouseholdId,
      config: config ?? null,
      kind: 'product_image_search',
      payloadBytes: Buffer.byteLength(ingredient.name, 'utf8'),
      run: async (_fixedConfig, signal) => {
        db.prepare(
          `UPDATE product_image_searches SET status = 'running', updated_at = CURRENT_TIMESTAMP
            WHERE ingredient_id = ? AND job_id = ?`
        ).run(ingredient.id, jobId);
        try {
          const name = ingredient.name
            .replace(/[\u0000-\u001f\u007f]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 65);
          const photos = await provider.searchByQuery(`${name} food product`, signal);
          if (signal.aborted)
            throw Object.assign(new Error('Search cancelled'), { name: 'AbortError' });
          const candidates: ProductImageCandidate[] = photos.slice(0, 10).map((photo) => ({
            ...photo,
            previewUrl: photo.thumbnailUrl || `/api/product-image-previews/${photo.id}`
          }));
          db.prepare(
            `UPDATE product_image_searches SET candidates_json = ?, status = 'complete', error_code = NULL,
                    updated_at = CURRENT_TIMESTAMP
              WHERE ingredient_id = ? AND job_id = ?`
          ).run(JSON.stringify(candidates), ingredient.id, jobId);
          return candidates.length;
        } catch (error) {
          const attempts = db
            .prepare('SELECT attempts, max_attempts FROM ai_jobs WHERE id = ?')
            .get(jobId) as { attempts: number; max_attempts: number } | undefined;
          const cancelled = signal.aborted || (error as Error)?.name === 'AbortError';
          const finalFailure =
            !cancelled && (!attempts || attempts.attempts >= attempts.max_attempts);
          if (cancelled || finalFailure) {
            db.prepare(
              `UPDATE product_image_searches SET status = ?, error_code = ?, updated_at = CURRENT_TIMESTAMP
                WHERE ingredient_id = ? AND job_id = ?`
            ).run(
              cancelled ? 'cancelled' : 'failed',
              cancelled ? 'CANCELLED' : 'SEARCH_UNAVAILABLE',
              ingredient.id,
              jobId
            );
          } else {
            db.prepare(
              `UPDATE product_image_searches SET status = 'queued', updated_at = CURRENT_TIMESTAMP
                WHERE ingredient_id = ? AND job_id = ?`
            ).run(ingredient.id, jobId);
          }
          throw error;
        }
      }
    });
    void task.result.catch(() => undefined);
  } catch (error) {
    db.prepare(
      `UPDATE product_image_searches SET status = 'failed', error_code = ?, updated_at = CURRENT_TIMESTAMP
        WHERE ingredient_id = ? AND job_id = ?`
    ).run(
      (error as { detail?: string })?.detail === 'QUEUE_CAPACITY'
        ? 'QUEUE_CAPACITY'
        : 'QUEUE_FAILED',
      ingredient.id,
      jobId
    );
  }

  return readProductImageSearch(db, ingredientId, userId, ingredient.household_id);
}

export function cancelProductImageSearch(
  db: SqlDb,
  ingredientId: string,
  userId: string,
  householdId: string | null
): boolean {
  const row = db
    .prepare(
      `SELECT job_id FROM product_image_searches
        WHERE ingredient_id = ? AND household_id IS ?
          AND (household_id IS NOT NULL OR user_id = ?)`
    )
    .get(ingredientId, householdId, userId) as { job_id: string } | undefined;
  if (!row) return false;
  const job = db
    .prepare('SELECT user_id, config_id, status FROM ai_jobs WHERE id = ?')
    .get(row.job_id) as { user_id: string; config_id: string | null; status: string } | undefined;
  if (!job || !['queued', 'running'].includes(job.status)) return false;
  const cancelled = cancelarTrabajo(db, job.user_id, job.config_id ?? '', row.job_id);
  if (!cancelled) return false;
  db.prepare(
    `UPDATE product_image_searches SET status = 'cancelled', error_code = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
      WHERE ingredient_id = ? AND job_id = ?`
  ).run(ingredientId, row.job_id);
  return true;
}

export function photoCandidateFor(
  db: SqlDb,
  ingredientId: string,
  userId: string,
  householdId: string | null,
  photoId: string
): RecipeStepPhoto | null {
  const row = db
    .prepare(
      `SELECT candidates_json FROM product_image_searches
        WHERE ingredient_id = ? AND household_id IS ?
          AND (household_id IS NOT NULL OR user_id = ?)`
    )
    .get(ingredientId, householdId, userId) as { candidates_json: string } | undefined;
  if (!row) return null;
  return parseCandidates(row.candidates_json).find((candidate) => candidate.id === photoId) ?? null;
}

/**
 * A preview URL is intentionally public because it is used by ordinary <img> requests, but it
 * must still refer to a candidate that this app actually persisted. The metadata contains only
 * public Commons attribution and a provider-validated thumbnail URL, never household/product data.
 */
export function persistedProductImageCandidate(db: SqlDb, photoId: string): RecipeStepPhoto | null {
  if (!/^[a-f0-9]{24}$/.test(photoId)) return null;
  const rows = db
    .prepare(
      `SELECT candidates_json FROM product_image_searches
        WHERE status = 'complete' AND candidates_json LIKE ?`
    )
    .all(`%${photoId}%`) as Array<{ candidates_json: string }>;
  for (const row of rows) {
    const candidate = parseCandidates(row.candidates_json).find((photo) => photo.id === photoId);
    if (candidate) return candidate;
  }
  return null;
}
