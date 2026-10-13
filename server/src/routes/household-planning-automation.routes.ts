import { Hono, type Context } from 'hono';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  householdPlanningAutomationPatchSchema,
  householdPlanningAutomationRunSummarySchema
} from '../schemas/household-planning-automation.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import {
  activeHouseholdId,
  hasActiveHouseholdMemberships,
  readActiveHouseholdId
} from '../utils/household-context.js';
import {
  HouseholdPlanningAutomationStoreError,
  readHouseholdPlanningAutomation,
  saveHouseholdPlanningAutomation
} from '../utils/household-planning-automation.store.js';
import { readLatestHouseholdPlanningAutomationRun } from '../utils/household-planning-automation-runs.store.js';

export const householdPlanningAutomationRoutes = new Hono<AppEnv>();
householdPlanningAutomationRoutes.use('*', authMiddleware);

householdPlanningAutomationRoutes.get('/planning-automation', (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const householdId = readActiveHouseholdId(db, userId);
  if (!householdId) return noHouseholdResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  try {
    const automation = readHouseholdPlanningAutomation(db, householdId, new Date());
    const latestRun = readLatestHouseholdPlanningAutomationRun(db, householdId);
    const parsedRun = latestRun
      ? householdPlanningAutomationRunSummarySchema.safeParse({
          occurrenceKey: latestRun.occurrenceKey,
          targetWeekStart: latestRun.targetWeekStart,
          status: latestRun.status,
          failureCode: latestRun.failureCode,
          updatedAt: normalizeLedgerTimestamp(latestRun.updatedAt)
        })
      : null;
    if (parsedRun && !parsedRun.success) {
      return c.json({ success: false, code: 'HOUSEHOLD_PLANNING_AUTOMATION_UNAVAILABLE' }, 500);
    }
    const data = { ...automation, lastRun: parsedRun?.data ?? null };
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data });
  } catch (error) {
    if (error instanceof HouseholdPlanningAutomationStoreError) {
      return c.json({ success: false, code: error.code }, 500);
    }
    return c.json({ success: false, code: 'HOUSEHOLD_PLANNING_AUTOMATION_UNAVAILABLE' }, 500);
  }
});

householdPlanningAutomationRoutes.patch('/planning-automation', async (c) => {
  const db = getDatabase();
  const userId = c.get('userId');
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return noHouseholdResponse(c, db, userId);
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, code: 'INVALID_HOUSEHOLD_PLANNING_AUTOMATION' }, 400);
  }
  const parsed = householdPlanningAutomationPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        code: 'INVALID_HOUSEHOLD_PLANNING_AUTOMATION',
        errors: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      },
      400
    );
  }

  if (
    activeHouseholdId(db, userId) !== householdId ||
    c.req.header('x-household-id') !== householdId
  ) {
    return householdContextChanged(c);
  }

  try {
    const result = saveHouseholdPlanningAutomation(
      db,
      householdId,
      userId,
      parsed.data,
      new Date()
    );
    c.header('Cache-Control', 'no-store');
    if (result.status === 'conflict') {
      return c.json(
        {
          success: false,
          code: 'HOUSEHOLD_PLANNING_AUTOMATION_VERSION_CONFLICT',
          message:
            'La configuración cambió en otra pestaña. Recarga la versión actual antes de guardar.',
          data: result.snapshot
        },
        409
      );
    }
    return c.json({ success: true, data: result.snapshot });
  } catch (error) {
    if (error instanceof HouseholdPlanningAutomationStoreError) {
      if (
        error.code === 'HOUSEHOLD_SETTINGS_REQUIRED' ||
        error.code === 'HOUSEHOLD_CALENDAR_EDIT_REQUIRED'
      ) {
        return c.json({ success: false, code: error.code }, 403);
      }
      if (error.code === 'HOUSEHOLD_CONTEXT_CHANGED') {
        return householdContextChanged(c);
      }
      if (error.code === 'AUTOMATION_SCHEDULE_REQUIRED') {
        return c.json({ success: false, code: error.code }, 422);
      }
      return c.json({ success: false, code: error.code }, 500);
    }
    return c.json({ success: false, code: 'HOUSEHOLD_PLANNING_AUTOMATION_SAVE_FAILED' }, 500);
  }
});

function noHouseholdResponse(
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

function normalizeLedgerTimestamp(value: string): string {
  const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const instant = new Date(timestamp);
  return Number.isNaN(instant.getTime()) ? value : instant.toISOString();
}
