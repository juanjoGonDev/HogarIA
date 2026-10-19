import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { householdMealConsumptionSchema } from '../schemas/household-meal-consumption.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import { activeHouseholdId, needsActiveHouseholdSelection } from '../utils/household-context.js';
import {
  MealConsumptionError,
  readSharedMealConsumption,
  recordSharedMealConsumption
} from '../utils/household-meal-consumption.store.js';

export const householdMealConsumptionRoutes = new Hono<AppEnv>();
householdMealConsumptionRoutes.use('*', authMiddleware);

const MAX_CONSUMPTION_BODY_BYTES = 8 * 1024;

householdMealConsumptionRoutes.get('/meal-planning/meals/:mealId/consumption', (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return noHouseholdResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  try {
    const result = readSharedMealConsumption(db, userId, c.req.param('mealId'), householdId);
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: result });
  } catch (error) {
    return respondToConsumptionError(c, error);
  }
});

householdMealConsumptionRoutes.put(
  '/meal-planning/meals/:mealId/consumption',
  bodyLimit({
    maxSize: MAX_CONSUMPTION_BODY_BYTES,
    onError: (c) => c.json({ success: false, code: 'MEAL_CONSUMPTION_BODY_TOO_LARGE' }, 413)
  }),
  async (c) => {
    const db = getDatabase();
    const userId = c.get('userId');
    const householdId = activeHouseholdId(db, userId);
    if (!householdId) return noHouseholdResponse(c, db, userId);
    if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, code: 'INVALID_MEAL_CONSUMPTION' }, 400);
    }
    const parsed = householdMealConsumptionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, code: 'INVALID_MEAL_CONSUMPTION' }, 400);
    }
    if (c.req.header('x-household-id') !== activeHouseholdId(db, userId)) {
      return householdContextChanged(c);
    }

    try {
      const result = recordSharedMealConsumption(db, userId, {
        mealId: c.req.param('mealId'),
        expectedHouseholdId: householdId,
        ...parsed.data
      });
      c.header('Cache-Control', 'no-store');
      return c.json({ success: true, data: result });
    } catch (error) {
      return respondToConsumptionError(c, error);
    }
  }
);

function respondToConsumptionError(c: Context<AppEnv>, error: unknown) {
  if (error instanceof MealConsumptionError) {
    switch (error.code) {
      case 'INVALID_INPUT':
        return c.json({ success: false, code: 'INVALID_MEAL_CONSUMPTION' }, 400);
      case 'CALENDAR_VIEW_REQUIRED':
        return c.json({ success: false, code: 'HOUSEHOLD_CALENDAR_VIEW_REQUIRED' }, 403);
      case 'PARTICIPANT_REQUIRED':
      case 'FORBIDDEN':
        return c.json({ success: false, code: 'HOUSEHOLD_MEAL_PARTICIPANT_REQUIRED' }, 403);
      case 'NOT_FOUND':
        return c.json({ success: false, code: 'HOUSEHOLD_MEAL_NOT_FOUND' }, 404);
      case 'HOUSEHOLD_CONTEXT_CHANGED':
        return householdContextChanged(c);
      case 'VERSION_CONFLICT':
        return c.json({ success: false, code: 'MEAL_CONSUMPTION_VERSION_CONFLICT' }, 409);
      case 'INVENTORY_UNIT_CHANGED':
        return c.json({ success: false, code: 'MEAL_CONSUMPTION_INVENTORY_UNIT_CHANGED' }, 409);
      case 'RECIPE_SNAPSHOT_UNAVAILABLE':
        return c.json({ success: false, code: 'RECIPE_SNAPSHOT_UNAVAILABLE' }, 409);
    }
  }
  return c.json({ success: false, code: 'MEAL_CONSUMPTION_SAVE_FAILED' }, 500);
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

function householdContextChanged(c: Context<AppEnv>) {
  return c.json({ success: false, code: 'HOUSEHOLD_CONTEXT_CHANGED' }, 409);
}
