import { Hono, type Context } from 'hono';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { householdMealShoppingPreviewQuerySchema } from '../schemas/household-meal-shopping-preview.schema.js';
import { householdMealPlanningPatchSchema } from '../schemas/household-meal-planning.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import {
  activeHouseholdId,
  hasActiveHouseholdMemberships,
  needsActiveHouseholdSelection,
  readActiveHouseholdId
} from '../utils/household-context.js';
import { canViewSharedMeals } from '../utils/shared-meal-calendar.store.js';
import {
  HouseholdMealPlanningError,
  readHouseholdMealPlanning,
  saveHouseholdMealPlanning
} from '../utils/household-meal-planning.store.js';
import {
  HouseholdMealShoppingPreviewError,
  readHouseholdMealShoppingPreview
} from '../utils/household-meal-shopping-preview.store.js';

export const householdMealPlanningRoutes = new Hono<AppEnv>();
householdMealPlanningRoutes.use('*', authMiddleware);

householdMealPlanningRoutes.get('/meal-planning', (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return noHouseholdResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  try {
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: readHouseholdMealPlanning(db, householdId, userId) });
  } catch (error) {
    if (error instanceof HouseholdMealPlanningError) {
      return c.json({ success: false, code: error.code }, 404);
    }
    return c.json({ success: false, code: 'HOUSEHOLD_MEAL_PLANNING_UNAVAILABLE' }, 500);
  }
});

householdMealPlanningRoutes.get('/meal-planning/shopping-preview', (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const householdId = readActiveHouseholdId(db, userId);
  if (!householdId) return noHouseholdReadOnlyResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  const today = new Date().toISOString().slice(0, 10);
  const parsed = householdMealShoppingPreviewQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams.entries())
  );
  if (!parsed.success || parsed.data.startDate < today) {
    return c.json({ success: false, code: 'INVALID_MEAL_SHOPPING_PREVIEW_RANGE' }, 400);
  }
  if (!canViewSharedMeals(db, householdId, userId)) {
    return c.json({ success: false, code: 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED' }, 403);
  }

  try {
    const preview = readHouseholdMealShoppingPreview(db, householdId, parsed.data, today);
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: preview });
  } catch (error) {
    if (error instanceof HouseholdMealShoppingPreviewError) {
      return c.json({ success: false, code: 'HOUSEHOLD_MEAL_SHOPPING_PREVIEW_NOT_FOUND' }, 404);
    }
    return c.json({ success: false, code: 'HOUSEHOLD_MEAL_SHOPPING_PREVIEW_UNAVAILABLE' }, 500);
  }
});

householdMealPlanningRoutes.patch('/meal-planning', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return noHouseholdResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, code: 'INVALID_MEAL_PLANNING_SETTINGS' }, 400);
  }
  const parsed = householdMealPlanningPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        code: 'INVALID_MEAL_PLANNING_SETTINGS',
        errors: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      },
      400
    );
  }

  // Check the entire patch before writing either scope. A member without settings permission can
  // still update their own overrides, but a mixed request containing home defaults is all-or-none.
  if (parsed.data.household && !canEditHouseholdSettings(db, householdId, userId)) {
    return c.json({ success: false, code: 'HOUSEHOLD_SETTINGS_REQUIRED' }, 403);
  }

  try {
    const result = saveHouseholdMealPlanning(db, householdId, userId, parsed.data);
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof HouseholdMealPlanningError) {
      const status = error.code === 'HOUSEHOLD_MEMBER_NOT_FOUND' ? 404 : 409;
      return c.json({ success: false, code: error.code }, status);
    }
    return c.json({ success: false, code: 'HOUSEHOLD_MEAL_PLANNING_SAVE_FAILED' }, 500);
  }
});

function canEditHouseholdSettings(
  db: ReturnType<typeof getDatabase>,
  householdId: string,
  userId: string
): boolean {
  const membership = db
    .prepare(
      `SELECT role, permissions FROM household_members
        WHERE household_id = ? AND user_id = ? AND is_active = 1`
    )
    .get(householdId, userId) as { role: string; permissions: string | null } | undefined;
  if (!membership) return false;
  if (membership.permissions === null) return membership.role === 'admin';
  try {
    const permissions: unknown = JSON.parse(membership.permissions);
    return Boolean(
      permissions &&
      typeof permissions === 'object' &&
      'settings' in permissions &&
      permissions.settings === true
    );
  } catch {
    return false;
  }
}

function noHouseholdResponse(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDatabase>,
  userId: string
) {
  if (needsActiveHouseholdSelection(db, userId)) {
    return c.json({ success: false, code: 'HOUSEHOLD_SELECTION_REQUIRED' }, 409);
  }
  return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 404);
}

function noHouseholdReadOnlyResponse(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDatabase>,
  userId: string
) {
  if (hasActiveHouseholdMemberships(db, userId)) {
    return c.json({ success: false, code: 'HOUSEHOLD_SELECTION_REQUIRED' }, 409);
  }
  return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 404);
}

function householdContextChanged(c: Context<AppEnv>) {
  return c.json(
    {
      success: false,
      code: 'HOUSEHOLD_CONTEXT_CHANGED',
      message: 'El hogar activo cambió. Vuelve a cargarlo antes de continuar.'
    },
    409
  );
}
