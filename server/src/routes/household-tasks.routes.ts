import { Hono, type Context } from 'hono';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  householdTaskWeekQuerySchema,
  householdTaskWeekWriteSchema
} from '../schemas/household-task.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import { activeHouseholdId, needsActiveHouseholdSelection } from '../utils/household-context.js';
import {
  HouseholdTaskStoreError,
  readHouseholdTaskWeek,
  saveHouseholdTaskWeek
} from '../utils/household-task.store.js';

export const householdTasksRoutes = new Hono<AppEnv>();
householdTasksRoutes.use('*', authMiddleware);

householdTasksRoutes.get('/tasks', (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return noHouseholdResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);
  const parsedQuery = householdTaskWeekQuerySchema.safeParse({
    weekStart: c.req.query('weekStart')
  });
  if (!parsedQuery.success) {
    return c.json({ success: false, code: 'INVALID_TASK_WEEK' }, 400);
  }

  try {
    c.header('Cache-Control', 'no-store');
    return c.json({
      success: true,
      data: readHouseholdTaskWeek(db, householdId, parsedQuery.data.weekStart)
    });
  } catch {
    return c.json({ success: false, code: 'HOUSEHOLD_TASK_WEEK_UNAVAILABLE' }, 500);
  }
});

householdTasksRoutes.put('/tasks', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return noHouseholdResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);
  if (!canEditHouseholdTasks(db, householdId, userId)) {
    return c.json({ success: false, code: 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, code: 'INVALID_TASK_WEEK' }, 400);
  }
  const parsed = householdTaskWeekWriteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        code: 'INVALID_TASK_WEEK',
        errors: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      },
      400
    );
  }

  try {
    const result = saveHouseholdTaskWeek(db, householdId, userId, parsed.data);
    if (result.status === 'conflict') {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          success: false,
          code: 'TASK_WEEK_VERSION_CONFLICT',
          message: 'La semana cambió en otra pestaña. Recarga la versión actual antes de guardar.',
          data: result.snapshot
        },
        409
      );
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: result.snapshot });
  } catch (error) {
    if (error instanceof HouseholdTaskStoreError) {
      return c.json({ success: false, code: error.code }, 422);
    }
    return c.json({ success: false, code: 'HOUSEHOLD_TASK_WEEK_SAVE_FAILED' }, 500);
  }
});

function canEditHouseholdTasks(
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
    if (!permissions || typeof permissions !== 'object') return false;
    const calendar = (permissions as Record<string, unknown>).calendar;
    return Boolean(
      calendar &&
      typeof calendar === 'object' &&
      (calendar as Record<string, unknown>).edit === true
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
