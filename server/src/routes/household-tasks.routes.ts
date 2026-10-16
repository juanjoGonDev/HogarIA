import { isDeepStrictEqual } from 'node:util';
import { Hono, type Context } from 'hono';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  householdTaskWeekQuerySchema,
  householdTaskWeekWriteSchema,
  type HouseholdTaskOccurrence
} from '../schemas/household-task.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import {
  activeHouseholdId,
  needsActiveHouseholdSelection,
  readActiveHouseholdId
} from '../utils/household-context.js';
import {
  ASSISTANT_ACTION_ID_HEADER,
  isAssistantActionId,
  withAssistantActionIdempotency
} from '../utils/assistant-action-idempotency.js';
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
  if (readActiveHouseholdId(db, userId) !== householdId) return householdContextChanged(c);

  const actionId = c.req.header(ASSISTANT_ACTION_ID_HEADER);
  let assistantTask: (typeof parsed.data.tasks)[number] | undefined;
  if (actionId !== undefined) {
    if (!isAssistantActionId(actionId)) {
      return c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400);
    }
    if (!parsed.data.assistantAction) {
      const matches = parsed.data.tasks.filter((task) => task.id === `assistant-${actionId}`);
      if (matches.length !== 1) {
        return c.json({ success: false, code: 'ASSISTANT_ACTION_ID_MISMATCH' }, 400);
      }
      assistantTask = matches[0];
    }
  } else if (parsed.data.assistantAction) {
    return c.json({ success: false, code: 'ASSISTANT_ACTION_ID_REQUIRED' }, 400);
  }

  const result = withAssistantActionIdempotency(
    db,
    userId,
    actionId,
    {
      operation: parsed.data.assistantAction?.operation ?? 'household.create_task',
      householdId,
      weekStart: parsed.data.weekStart,
      baseVersion: parsed.data.baseVersion,
      task: assistantTask ?? parsed.data.tasks,
      ...(parsed.data.assistantAction
        ? {
            targetId: parsed.data.assistantAction.targetId,
            before: parsed.data.assistantAction.before,
            tasks: parsed.data.tasks
          }
        : {})
    },
    () => {
      if (readActiveHouseholdId(db, userId) !== householdId) {
        return {
          body: { success: false, code: 'HOUSEHOLD_CONTEXT_CHANGED' },
          status: 409,
          record: false
        };
      }
      try {
        if (parsed.data.assistantAction) {
          const current = readHouseholdTaskWeek(db, householdId, parsed.data.weekStart);
          const { before, targetId } = parsed.data.assistantAction;
          const targetIndex = current.tasks.findIndex((task) => task.id === targetId);
          if (
            current.version !== parsed.data.baseVersion ||
            targetIndex === -1 ||
            !isDeepStrictEqual(current.tasks[targetIndex], before)
          ) {
            return {
              body: {
                success: false,
                code: 'TASK_TARGET_CHANGED',
                message:
                  'La tarea cambió desde la propuesta. Recarga y revisa una nueva propuesta.',
                data: current
              },
              status: 409,
              record: false
            };
          }
          const after = parsed.data.tasks[targetIndex];
          if (
            parsed.data.tasks.length !== current.tasks.length ||
            !after ||
            !isSafeAssistantTaskUpdate(before, after) ||
            current.tasks.some(
              (task, index) =>
                index !== targetIndex && !isDeepStrictEqual(task, parsed.data.tasks[index])
            )
          ) {
            return {
              body: { success: false, code: 'ASSISTANT_TASK_UPDATE_INVALID' },
              status: 400,
              record: false
            };
          }
        }
        const saved = saveHouseholdTaskWeek(db, householdId, userId, parsed.data);
        if (saved.status === 'conflict') {
          return {
            body: {
              success: false,
              code: 'TASK_WEEK_VERSION_CONFLICT',
              message:
                'La semana cambió en otra pestaña. Recarga la versión actual antes de guardar.',
              data: saved.snapshot
            },
            status: 409,
            record: false
          };
        }
        return { body: { success: true, data: saved.snapshot }, status: 200 };
      } catch (error) {
        if (error instanceof HouseholdTaskStoreError) {
          return { body: { success: false, code: error.code }, status: 422, record: false };
        }
        return {
          body: { success: false, code: 'HOUSEHOLD_TASK_WEEK_SAVE_FAILED' },
          status: 500,
          record: false
        };
      }
    }
  );
  if ('error' in result) {
    return result.error === 'invalid_action_id'
      ? c.json({ success: false, code: 'ASSISTANT_ACTION_ID_INVALID' }, 400)
      : c.json({ success: false, code: 'ASSISTANT_ACTION_ID_CONFLICT' }, 409);
  }
  c.header('Cache-Control', 'no-store');
  return c.json(result.body, result.status);
});

function isSafeAssistantTaskUpdate(
  before: HouseholdTaskOccurrence,
  after: HouseholdTaskOccurrence
): boolean {
  if (before.id !== after.id || before.completed !== after.completed) return false;
  const allowed = new Set(['title', 'details', 'scheduledDate', 'spaceId', 'assignedMemberId']);
  const keys = Object.keys(before) as Array<keyof typeof before>;
  if (keys.some((key) => !allowed.has(key) && !isDeepStrictEqual(before[key], after[key])))
    return false;
  return keys.some((key) => !isDeepStrictEqual(before[key], after[key]));
}

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
