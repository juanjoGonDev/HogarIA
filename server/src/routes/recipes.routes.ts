import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { assistantHouseholdContextMiddleware } from '../utils/ai-assistant-household-context.js';
import {
  ASSISTANT_ACTION_ID_HEADER,
  withAssistantActionIdempotency
} from '../utils/assistant-action-idempotency.js';
import { recipeContentBodyLimit } from '../middleware/recipe-content-body-limit.middleware.js';
import { ensureRecipeBookCatalog } from '../utils/recipe-book-seed.js';
import {
  createRecipeSchema,
  updateRecipeSchema,
  recipeFilterSchema,
  adjustServingsSchema
} from '../schemas/recipe.schema.js';
import { recipeStepPhotoProvider } from '../utils/recipe-step-photos.js';
import {
  recipeStepVideoProvider,
  type RecipeStepVideoProvider,
  type RecipeStepVideoSelection
} from '../utils/recipe-step-videos.js';
import {
  attachRecipeStepVideoAttribution,
  loadRecipeStepVideoSelection,
  MAX_RECIPE_STEP_VIDEO_SELECTIONS,
  replaceRecipeStepVideoSelections
} from '../utils/recipe-step-video-persistence.js';
import type { AppEnv } from '../types/hono-env.js';

const recipeRoutes = new Hono<AppEnv>();

recipeRoutes.use('*', authMiddleware);
recipeRoutes.use('*', assistantHouseholdContextMiddleware());

// Map from camelCase API field names to snake_case DB column names,
// plus an allow-list to prevent SQL injection via ORDER BY.
const SORT_COLUMN_MAP: Record<string, string> = {
  name: 'name',
  difficulty: 'difficulty',
  totalTime: 'total_time',
  rating: 'rating',
  createdAt: 'created_at'
};

const RECIPE_EDIT_COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  difficulty: 'difficulty',
  cuisine: 'cuisine',
  countryCode: 'country_code',
  mealType: 'meal_type',
  totalTime: 'total_time',
  prepTime: 'prep_time',
  cookTime: 'cook_time',
  restTime: 'rest_time',
  servings: 'servings',
  calories: 'calories',
  image: 'image',
  ingredients: 'ingredients',
  utensils: 'utensils',
  steps: 'steps',
  instructionsByLevel: 'steps',
  guidance: 'recipe_guidance',
  nutrition: 'nutrition',
  storage: 'storage',
  tags: 'tags',
  isPublic: 'is_public'
};

const JSON_RECIPE_FIELDS = new Set([
  'mealType',
  'ingredients',
  'utensils',
  'steps',
  'instructionsByLevel',
  'guidance',
  'nutrition',
  'storage',
  'tags'
]);

const MAX_STEP_PHOTO_SELECTIONS = 12;
const MAX_RECIPE_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_RECIPE_STEP_PHOTO_BYTES = 12 * 1024 * 1024;

type StoredRecipePhoto = {
  id: string;
  image: { bytes: Uint8Array; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' };
  attribution: {
    altText: string;
    author: string;
    licenseName: string;
    licenseUrl: string;
    sourceUrl: string;
  };
};

type PhotoResolutionError = 'expired' | 'unavailable' | 'limit';

type VideoResolutionError = 'expired' | 'limit';

async function resolveStepPhotoSelections(
  instructionData: unknown
): Promise<{ data: unknown; assets: StoredRecipePhoto[] } | { error: PhotoResolutionError }> {
  const assets = new Map<string, StoredRecipePhoto>();
  let totalBytes = 0;

  const resolveSteps = async (steps: unknown[]): Promise<unknown[] | PhotoResolutionError> => {
    const resolved: unknown[] = [];
    for (const value of steps) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        resolved.push(value);
        continue;
      }
      const step = value as Record<string, unknown>;
      const photoId = typeof step.imagePhotoId === 'string' ? step.imagePhotoId : '';
      if (!photoId) {
        resolved.push(step);
        continue;
      }

      let asset = assets.get(photoId);
      if (!asset) {
        if (assets.size >= MAX_STEP_PHOTO_SELECTIONS) return 'limit';
        const photo = recipeStepPhotoProvider.getPhoto(photoId);
        if (!photo) return 'expired';
        let image: Awaited<ReturnType<typeof recipeStepPhotoProvider.getImage>>;
        try {
          image = await recipeStepPhotoProvider.getImage(photoId);
        } catch {
          return 'unavailable';
        }
        if (
          !image ||
          image.bytes.byteLength === 0 ||
          image.bytes.byteLength > MAX_RECIPE_PHOTO_BYTES ||
          !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)
        ) {
          return 'unavailable';
        }
        totalBytes += image.bytes.byteLength;
        if (totalBytes > MAX_RECIPE_STEP_PHOTO_BYTES) return 'limit';
        asset = {
          id: photoId,
          image,
          attribution: {
            altText: photo.altText,
            author: photo.author,
            licenseName: photo.licenseName,
            licenseUrl: photo.licenseUrl,
            sourceUrl: photo.sourceUrl
          }
        };
        assets.set(photoId, asset);
      }

      const { imagePhotoId: _candidateId, image: _temporaryImage, ...stepData } = step;
      resolved.push({ ...stepData, image: `/api/recipe-images/${photoId}` });
    }
    return resolved;
  };

  if (Array.isArray(instructionData)) {
    const data = await resolveSteps(instructionData);
    return typeof data === 'string' ? { error: data } : { data, assets: [...assets.values()] };
  }
  if (!instructionData || typeof instructionData !== 'object') {
    return { data: instructionData, assets: [] };
  }

  const data: Record<string, unknown> = {};
  for (const [level, levelSteps] of Object.entries(instructionData)) {
    if (!Array.isArray(levelSteps)) {
      data[level] = levelSteps;
      continue;
    }
    const resolved = await resolveSteps(levelSteps);
    if (typeof resolved === 'string') return { error: resolved };
    data[level] = resolved;
  }
  return { data, assets: [...assets.values()] };
}

function resolveStepVideoSelections(
  instructionData: unknown,
  db: ReturnType<typeof getDatabase>,
  provider: RecipeStepVideoProvider,
  existingRecipeId?: string
): { data: unknown; assets: RecipeStepVideoSelection[] } | { error: VideoResolutionError } {
  const assets = new Map<string, RecipeStepVideoSelection>();

  const resolveSteps = (steps: unknown[]): unknown[] | VideoResolutionError => {
    const resolved: unknown[] = [];
    for (const value of steps) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        resolved.push(value);
        continue;
      }
      const step = value as Record<string, unknown>;
      const videoId = typeof step.videoId === 'string' ? step.videoId : '';
      if (!videoId) {
        const { videoAttribution: _untrustedAttribution, ...safeStep } = step;
        resolved.push(safeStep);
        continue;
      }

      let selection = assets.get(videoId);
      if (!selection) {
        if (assets.size >= MAX_RECIPE_STEP_VIDEO_SELECTIONS) return 'limit';
        selection =
          provider.getSelectedVideo(videoId) ??
          (existingRecipeId
            ? (loadRecipeStepVideoSelection(db, existingRecipeId, videoId) ?? undefined)
            : undefined);
        if (!selection || selection.id !== videoId) return 'expired';
        assets.set(videoId, selection);
      }

      const { videoAttribution: _untrustedAttribution, ...safeStep } = step;
      resolved.push({ ...safeStep, videoId });
    }
    return resolved;
  };

  if (Array.isArray(instructionData)) {
    const data = resolveSteps(instructionData);
    return typeof data === 'string' ? { error: data } : { data, assets: [...assets.values()] };
  }
  if (!instructionData || typeof instructionData !== 'object') {
    return { data: instructionData, assets: [] };
  }

  const data: Record<string, unknown> = {};
  for (const [level, levelSteps] of Object.entries(instructionData)) {
    if (!Array.isArray(levelSteps)) {
      data[level] = levelSteps;
      continue;
    }
    const resolved = resolveSteps(levelSteps);
    if (typeof resolved === 'string') return { error: resolved };
    data[level] = resolved;
  }
  return { data, assets: [...assets.values()] };
}

function storeRecipePhotoAsset(db: ReturnType<typeof getDatabase>, asset: StoredRecipePhoto): void {
  db.prepare(
    `INSERT OR IGNORE INTO recipe_image_assets
      (id, image_data, mime_type, alt_text, author, license_name, license_url, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    asset.id,
    Buffer.from(asset.image.bytes),
    asset.image.mimeType,
    asset.attribution.altText,
    asset.attribution.author,
    asset.attribution.licenseName,
    asset.attribution.licenseUrl,
    asset.attribution.sourceUrl
  );
}

function attachStepPhotoAttribution(storedSteps: unknown): unknown {
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
          const image = (step as Record<string, unknown>).image;
          const match =
            typeof image === 'string' ? /^\/api\/recipe-images\/([a-f0-9]{24})$/.exec(image) : null;
          return match ? [match[1]] : [];
        })
      )
    )
  ];
  const attributions = new Map<string, Record<string, string>>();
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = getDatabase()
      .prepare(
        `SELECT id, alt_text, author, license_name, license_url, source_url
           FROM recipe_image_assets WHERE id IN (${placeholders})`
      )
      .all(...ids) as Array<Record<string, string>>;
    for (const row of rows) {
      attributions.set(row.id, {
        altText: row.alt_text,
        author: row.author,
        licenseName: row.license_name,
        licenseUrl: row.license_url,
        sourceUrl: row.source_url
      });
    }
  }

  const decorate = (steps: unknown[]): unknown[] =>
    steps.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const { imageAttribution: _untrustedAttribution, ...step } = value as Record<string, unknown>;
      const image = step.image;
      const match =
        typeof image === 'string' ? /^\/api\/recipe-images\/([a-f0-9]{24})$/.exec(image) : null;
      const attribution = match ? attributions.get(match[1]) : undefined;
      return attribution ? { ...step, imageAttribution: attribution } : step;
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

// Helper to convert snake_case DB row to camelCase API object
function mapRecipe(r: Record<string, unknown>) {
  const recipeId = String(r.id ?? '');
  const storedSteps = attachRecipeStepVideoAttribution(
    getDatabase(),
    recipeId,
    attachStepPhotoAttribution(JSON.parse((r.steps as string) || '[]'))
  );
  const instructionData = Array.isArray(storedSteps)
    ? { steps: storedSteps }
    : { instructionsByLevel: storedSteps };

  return {
    id: r.id,
    name: r.name,
    description: r.description,
    difficulty: r.difficulty,
    cuisine: r.cuisine,
    countryCode: r.country_code ?? null,
    catalogKey: r.catalog_key ?? null,
    sourceAttribution: r.source_attribution ? JSON.parse(r.source_attribution as string) : null,
    imageAttribution: r.image_attribution ? JSON.parse(r.image_attribution as string) : null,
    mealType: JSON.parse((r.meal_type as string) || '[]'),
    totalTime: r.total_time,
    prepTime: r.prep_time,
    cookTime: r.cook_time,
    restTime: r.rest_time,
    servings: r.servings,
    calories: r.calories,
    image: r.image,
    ingredients: JSON.parse((r.ingredients as string) || '[]'),
    utensils: JSON.parse((r.utensils as string) || '[]'),
    guidance: r.recipe_guidance ? JSON.parse(r.recipe_guidance as string) : null,
    ...instructionData,
    tags: JSON.parse((r.tags as string) || '[]'),
    nutrition: r.nutrition ? JSON.parse(r.nutrition as string) : null,
    storage: r.storage ? JSON.parse(r.storage as string) : null,
    author: r.author,
    authorId: r.author_id,
    rating: r.rating,
    timesCooked: r.user_times_cooked ?? r.times_cooked,
    isFavorite: r.user_is_favorite === undefined ? !!r.is_favorite : !!r.user_is_favorite,
    notes: r.user_notes ?? null,
    isPublic: !!r.is_public,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/**
 * Coerce query-string values (always strings) to the types Zod expects.
 */
function coerceQuery(q: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...q };
  const intKeys = ['maxTime', 'page', 'pageSize'];
  for (const k of intKeys) {
    if (out[k] !== undefined && out[k] !== '') {
      const n = Number(out[k]);
      out[k] = Number.isFinite(n) ? n : undefined;
    } else {
      delete out[k];
    }
  }
  if (out.isFavorite !== undefined) {
    out.isFavorite = out.isFavorite === 'true' || out.isFavorite === '1';
  }
  if (out.catalogOnly !== undefined) {
    out.catalogOnly = out.catalogOnly === 'true' || out.catalogOnly === '1';
  }
  for (const key of ['mealTypes', 'tags']) {
    const value = out[key];
    if (typeof value === 'string') {
      const list = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (list.length) out[key] = list;
      else delete out[key];
    } else if (Array.isArray(value)) {
      const list = value
        .flatMap((item) => String(item).split(','))
        .map((item) => item.trim())
        .filter(Boolean);
      if (list.length) out[key] = list;
      else delete out[key];
    }
  }
  if (out.mealType !== undefined && out.mealType !== '') {
    const requested = Array.isArray(out.mealTypes) ? out.mealTypes : [];
    out.mealTypes = [...new Set([...requested, out.mealType])];
  }
  return out;
}

const USER_RECIPE_STATE_SQL = `
  COALESCE(
    (SELECT ur.is_favorite FROM user_recipes ur WHERE ur.user_id = ? AND ur.recipe_id = r.id),
    CASE WHEN r.author_id = ? THEN r.is_favorite ELSE 0 END
  ) AS user_is_favorite,
  COALESCE(
    (SELECT ur.times_cooked FROM user_recipes ur WHERE ur.user_id = ? AND ur.recipe_id = r.id),
    CASE WHEN r.author_id = ? THEN r.times_cooked ELSE 0 END
  ) AS user_times_cooked,
  (SELECT ur.notes FROM user_recipes ur WHERE ur.user_id = ? AND ur.recipe_id = r.id) AS user_notes
`;

function getReadableRecipe(db: ReturnType<typeof getDatabase>, id: string, userId: string) {
  return db
    .prepare(
      `
      SELECT r.*, ${USER_RECIPE_STATE_SQL}
      FROM recipes r
      WHERE r.id = ? AND (r.author = 'catalog' OR r.author_id = ? OR r.is_public = 1)
    `
    )
    .get(userId, userId, userId, userId, userId, id, userId) as Record<string, unknown> | undefined;
}

function isOwnedEditableRecipe(recipe: Record<string, unknown>, userId: string): boolean {
  return recipe.author !== 'catalog' && recipe.author_id === userId;
}

function upsertUserRecipeState(
  db: ReturnType<typeof getDatabase>,
  userId: string,
  recipeId: string,
  updates: { isFavorite?: boolean; cooked?: boolean }
): void {
  const existing = db
    .prepare(
      'SELECT id, is_favorite, times_cooked FROM user_recipes WHERE user_id = ? AND recipe_id = ?'
    )
    .get(userId, recipeId) as { id: string; is_favorite: number; times_cooked: number } | undefined;
  if (!existing) {
    db.prepare(
      `
      INSERT INTO user_recipes (id, user_id, recipe_id, is_favorite, times_cooked, last_cooked_at)
      VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END)
    `
    ).run(
      nanoid(),
      userId,
      recipeId,
      updates.isFavorite ? 1 : 0,
      updates.cooked ? 1 : 0,
      updates.cooked ? 1 : 0
    );
    return;
  }

  const assignments: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [];
  if (updates.isFavorite !== undefined) {
    assignments.push('is_favorite = ?');
    values.push(updates.isFavorite ? 1 : 0);
  }
  if (updates.cooked) {
    assignments.push('times_cooked = times_cooked + 1', 'last_cooked_at = CURRENT_TIMESTAMP');
  }
  values.push(existing.id);
  db.prepare(`UPDATE user_recipes SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
}

// GET /api/recipes
recipeRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const rawQuery = c.req.query();
  const filter = recipeFilterSchema.parse(coerceQuery(rawQuery));

  const db = getDatabase();
  // La vista del libro también funciona en bases aisladas/previews cuyo arranque use NODE_ENV=test.
  ensureRecipeBookCatalog(db);
  const conditions: string[] = ["(r.author = 'catalog' OR r.author_id = ? OR r.is_public = 1)"];
  const params: any[] = [userId];

  if (filter.catalogOnly) {
    conditions.push("r.author = 'catalog'");
  }

  if (filter.search) {
    conditions.push(
      '(r.name LIKE ? OR r.description LIKE ? OR r.ingredients LIKE ? OR r.tags LIKE ?)'
    );
    const searchTerm = `%${filter.search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  if (filter.difficulty) {
    conditions.push('r.difficulty = ?');
    params.push(filter.difficulty);
  }

  if (filter.mealTypes?.length) {
    conditions.push(`(${filter.mealTypes.map(() => 'r.meal_type LIKE ?').join(' OR ')})`);
    params.push(...filter.mealTypes.map((type) => `%"${type}"%`));
  }

  if (filter.maxTime) {
    conditions.push('r.total_time <= ?');
    params.push(filter.maxTime);
  }

  if (filter.cuisine) {
    conditions.push('r.cuisine = ?');
    params.push(filter.cuisine);
  }

  if (filter.countryCode) {
    conditions.push('r.country_code = ?');
    params.push(filter.countryCode);
  }

  for (const tag of filter.tags ?? []) {
    conditions.push('r.tags LIKE ?');
    params.push(`%"${tag}"%`);
  }

  if (filter.author) {
    conditions.push('r.author = ?');
    params.push(filter.author);
  }

  if (filter.isFavorite) {
    conditions.push(`(
      EXISTS (SELECT 1 FROM user_recipes ur WHERE ur.user_id = ? AND ur.recipe_id = r.id AND ur.is_favorite = 1)
      OR (r.author_id = ? AND r.is_favorite = 1)
    )`);
    params.push(userId, userId);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const offset = (filter.page - 1) * filter.pageSize;

  // Whitelist ORDER BY columns via our map
  const sortColumn = `r.${SORT_COLUMN_MAP[filter.sortBy] || 'created_at'}`;
  const sortOrder = filter.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countResult = db
    .prepare(`SELECT COUNT(*) as total FROM recipes r ${whereClause}`)
    .get(...params) as Record<string, unknown>;

  const recipes = db
    .prepare(
      `SELECT r.*, ${USER_RECIPE_STATE_SQL} FROM recipes r ${whereClause} ORDER BY ${sortColumn} ${sortOrder} LIMIT ? OFFSET ?`
    )
    .all(userId, userId, userId, userId, userId, ...params, filter.pageSize, offset) as Record<
    string,
    unknown
  >[];

  return c.json({
    success: true,
    data: {
      recipes: recipes.map(mapRecipe),
      total: countResult.total,
      page: filter.page,
      pageSize: filter.pageSize
    }
  });
});

// GET /api/recipes/:id
recipeRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const db = getDatabase();
  const recipe = getReadableRecipe(db, id, userId);

  if (!recipe) {
    return c.json({ success: false, message: 'Recipe not found' }, 404);
  }

  return c.json({
    success: true,
    data: mapRecipe(recipe)
  });
});

// POST /api/recipes
recipeRoutes.post('/', recipeContentBodyLimit(), async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const input = createRecipeSchema.parse(body);

  const db = getDatabase();
  const resolvedPhotos = await resolveStepPhotoSelections(input.instructionsByLevel ?? input.steps);
  if ('error' in resolvedPhotos) {
    const status = resolvedPhotos.error === 'unavailable' ? 502 : 400;
    return c.json(
      {
        success: false,
        message:
          resolvedPhotos.error === 'expired'
            ? 'A selected photo expired; search again'
            : resolvedPhotos.error === 'limit'
              ? 'The recipe has too many or too-large selected photos'
              : 'A selected photo is unavailable; search again'
      },
      status
    );
  }
  const resolvedVideos = resolveStepVideoSelections(
    resolvedPhotos.data,
    db,
    recipeStepVideoProvider
  );
  if ('error' in resolvedVideos) {
    return c.json(
      {
        success: false,
        message:
          resolvedVideos.error === 'limit'
            ? 'The recipe has too many selected videos'
            : 'A selected video expired; search again'
      },
      400
    );
  }

  const result = withAssistantActionIdempotency(
    db,
    userId,
    c.req.header(ASSISTANT_ACTION_ID_HEADER),
    { operation: 'recipes.create_draft', input },
    () => {
      const id = nanoid();
      db.transaction(() => {
        db.prepare(
          `
    INSERT INTO recipes (id, name, description, difficulty, cuisine, country_code, meal_type, total_time, prep_time, cook_time, rest_time, servings, calories, image, ingredients, utensils, steps, recipe_guidance, nutrition, storage, author, author_id, tags, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
        ).run(
          id,
          input.name,
          input.description,
          input.difficulty,
          input.cuisine,
          input.countryCode,
          JSON.stringify(input.mealType),
          input.totalTime,
          input.prepTime,
          input.cookTime,
          input.restTime,
          input.servings,
          input.calories,
          input.image,
          JSON.stringify(input.ingredients),
          JSON.stringify(input.utensils),
          JSON.stringify(resolvedVideos.data),
          input.guidance ? JSON.stringify(input.guidance) : null,
          input.nutrition ? JSON.stringify(input.nutrition) : null,
          input.storage ? JSON.stringify(input.storage) : null,
          input.author,
          userId,
          JSON.stringify(input.tags),
          input.isPublic ? 1 : 0
        );
        for (const asset of resolvedPhotos.assets) storeRecipePhotoAsset(db, asset);
        replaceRecipeStepVideoSelections(db, id, resolvedVideos.assets);
      })();

      const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
      return {
        body: { success: true, data: mapRecipe(recipe as Record<string, unknown>) },
        status: 201
      };
    }
  );
  if ('error' in result) {
    return result.error === 'invalid_action_id'
      ? c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400)
      : c.json({ success: false, code: 'ASSISTANT_ACTION_ID_CONFLICT' }, 409);
  }
  return c.json(result.body, result.status);
});

// PATCH /api/recipes/:id
recipeRoutes.patch('/:id', recipeContentBodyLimit(), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json();
  const input = updateRecipeSchema.parse(body);

  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  if (!existing) {
    return c.json({ success: false, message: 'Recipe not found' }, 404);
  }

  if (existing.author !== 'catalog' && existing.author_id !== userId && existing.is_public !== 1) {
    return c.json({ success: false, message: 'Recipe not found' }, 404);
  }
  const hasContentChanges =
    typeof input.imagePhotoId === 'string' ||
    Object.keys(RECIPE_EDIT_COLUMNS).some(
      (key) => (input as Record<string, unknown>)[key] !== undefined
    );
  if (hasContentChanges && !isOwnedEditableRecipe(existing, userId)) {
    return c.json({ success: false, message: 'Recipe is read-only' }, 403);
  }

  let resolvedInstructionData: unknown;
  let stepPhotoAssets: StoredRecipePhoto[] = [];
  let stepVideoAssets: RecipeStepVideoSelection[] | undefined;
  if (input.steps !== undefined || input.instructionsByLevel !== undefined) {
    const resolved = await resolveStepPhotoSelections(input.instructionsByLevel ?? input.steps);
    if ('error' in resolved) {
      const status = resolved.error === 'unavailable' ? 502 : 400;
      return c.json(
        {
          success: false,
          message:
            resolved.error === 'expired'
              ? 'A selected photo expired; search again'
              : resolved.error === 'limit'
                ? 'The recipe has too many or too-large selected photos'
                : 'A selected photo is unavailable; search again'
        },
        status
      );
    }
    const resolvedVideos = resolveStepVideoSelections(
      resolved.data,
      db,
      recipeStepVideoProvider,
      id
    );
    if ('error' in resolvedVideos) {
      return c.json(
        {
          success: false,
          message:
            resolvedVideos.error === 'limit'
              ? 'The recipe has too many selected videos'
              : 'A selected video expired; search again'
        },
        400
      );
    }
    resolvedInstructionData = resolvedVideos.data;
    stepVideoAssets = resolvedVideos.assets;
    stepPhotoAssets = resolved.assets;
  }

  let selectedPhoto:
    | {
        id: string;
        image: { bytes: Uint8Array; mimeType: string };
        attribution: Record<string, string>;
      }
    | undefined;
  const imagePhotoId = typeof input.imagePhotoId === 'string' ? input.imagePhotoId : undefined;
  if (imagePhotoId) {
    const photo = recipeStepPhotoProvider.getPhoto(imagePhotoId);
    if (!photo) {
      return c.json({ success: false, message: 'Photo selection expired; search again' }, 400);
    }
    try {
      const image = await recipeStepPhotoProvider.getImage(imagePhotoId);
      if (!image || image.bytes.byteLength > 4 * 1024 * 1024) {
        return c.json({ success: false, message: 'Photo selection expired; search again' }, 400);
      }
      selectedPhoto = {
        id: imagePhotoId,
        image,
        attribution: {
          altText: photo.altText,
          author: photo.author,
          licenseName: photo.licenseName,
          licenseUrl: photo.licenseUrl,
          sourceUrl: photo.sourceUrl
        }
      };
    } catch {
      return c.json({ success: false, message: 'Photo is unavailable; search again' }, 502);
    }
  }

  const updates: string[] = [];
  const values: any[] = [];
  for (const [key, column] of Object.entries(RECIPE_EDIT_COLUMNS)) {
    const value =
      key === 'steps' || key === 'instructionsByLevel'
        ? (resolvedInstructionData ?? (input as Record<string, unknown>)[key])
        : (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    updates.push(`${column} = ?`);
    if (JSON_RECIPE_FIELDS.has(key)) values.push(value === null ? null : JSON.stringify(value));
    else if (key === 'isPublic') values.push(value ? 1 : 0);
    else values.push(value);
  }

  if (selectedPhoto) {
    updates.push('image = ?', 'image_attribution = ?');
    values.push(
      `/api/recipe-images/${selectedPhoto.id}`,
      JSON.stringify(selectedPhoto.attribution)
    );
  } else if (input.image !== undefined && input.image !== existing.image) {
    updates.push('image_attribution = ?');
    values.push(null);
  }

  db.transaction(() => {
    if (typeof input.isFavorite === 'boolean') {
      upsertUserRecipeState(db, userId, id, { isFavorite: input.isFavorite });
    }

    if (updates.length > 0) {
      if (selectedPhoto) {
        storeRecipePhotoAsset(db, selectedPhoto as StoredRecipePhoto);
      }
      for (const asset of stepPhotoAssets) storeRecipePhotoAsset(db, asset);
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.prepare(`UPDATE recipes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }
    if (stepVideoAssets !== undefined) {
      replaceRecipeStepVideoSelections(db, id, stepVideoAssets);
    }
  })();

  const recipe = getReadableRecipe(db, id, userId);
  return c.json({ success: true, data: mapRecipe(recipe as Record<string, unknown>) });
});

// DELETE /api/recipes/:id
recipeRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const db = getDatabase();

  const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  if (
    !existing ||
    (existing.author !== 'catalog' && existing.author_id !== userId && existing.is_public !== 1)
  ) {
    return c.json({ success: false, message: 'Recipe not found' }, 404);
  }
  if (!isOwnedEditableRecipe(existing, userId)) {
    return c.json({ success: false, message: 'Recipe is read-only' }, 403);
  }

  const deleted = db.transaction(() => {
    const otherUsersHaveState = db
      .prepare('SELECT 1 FROM user_recipes WHERE recipe_id = ? AND user_id <> ? LIMIT 1')
      .get(id, userId);
    if (otherUsersHaveState) return false;
    db.prepare('DELETE FROM user_recipes WHERE recipe_id = ? AND user_id = ?').run(id, userId);
    return (
      db
        .prepare('DELETE FROM recipes WHERE id = ? AND author_id = ? AND author <> ?')
        .run(id, userId, 'catalog').changes === 1
    );
  })();
  if (!deleted) {
    return c.json({ success: false, message: 'Recipe is still used by another person' }, 409);
  }

  return c.json({ success: true, message: 'Recipe deleted' });
});

// POST /api/recipes/:id/favorite
recipeRoutes.post('/:id/favorite', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const db = getDatabase();

  const recipe = getReadableRecipe(db, id, userId);
  if (!recipe) {
    return c.json({ success: false, message: 'Recipe not found' }, 404);
  }

  const current = db
    .prepare('SELECT is_favorite FROM user_recipes WHERE user_id = ? AND recipe_id = ?')
    .get(userId, id) as { is_favorite: number } | undefined;
  const legacyOwnFavorite = recipe.author_id === userId ? Number(recipe.is_favorite) === 1 : false;
  const nextFavorite = current ? current.is_favorite !== 1 : !legacyOwnFavorite;
  upsertUserRecipeState(db, userId, id, { isFavorite: nextFavorite });

  return c.json({
    success: true,
    data: { isFavorite: nextFavorite }
  });
});

// POST /api/recipes/:id/cook
recipeRoutes.post('/:id/cook', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const db = getDatabase();

  const recipe = getReadableRecipe(db, id, userId);
  if (!recipe) {
    return c.json({ success: false, message: 'Recipe not found' }, 404);
  }

  upsertUserRecipeState(db, userId, id, { cooked: true });

  return c.json({ success: true, message: 'Recipe cooked recorded' });
});

// POST /api/recipes/:id/adjust-servings
recipeRoutes.post('/:id/adjust-servings', async (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId');
  const body = await c.req.json();
  const input = adjustServingsSchema.parse(body);

  const db = getDatabase();
  const recipe = getReadableRecipe(db, id, userId) as any;

  if (!recipe) {
    return c.json({ success: false, message: 'Recipe not found' }, 404);
  }

  const ingredients = JSON.parse(recipe.ingredients || '[]');
  const ratio = input.servings / recipe.servings;

  const adjustedIngredients = ingredients.map((ing: any) => ({
    ...ing,
    quantity: Math.round(ing.quantity * ratio * 100) / 100
  }));

  return c.json({
    success: true,
    data: {
      servings: input.servings,
      ingredients: adjustedIngredients
    }
  });
});

export { recipeRoutes };
