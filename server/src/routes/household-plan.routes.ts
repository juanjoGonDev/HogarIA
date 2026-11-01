import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getDatabase } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  householdPlanProposalRequestSchema,
  householdPlanWriteSchema
} from '../schemas/household-plan.schema.js';
import { householdPlanAssignmentWriteSchema } from '../schemas/household-plan-assignment.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import { activeHouseholdId, needsActiveHouseholdSelection } from '../utils/household-context.js';
import { readHouseholdPlan, saveHouseholdPlan } from '../utils/household-plan.store.js';
import {
  HouseholdPlanAssignmentError,
  readHouseholdPlanAssignments,
  saveHouseholdPlanAssignment
} from '../utils/household-plan-assignment.store.js';
import { findOrphanedHouseholdTaskIds } from '../utils/household-task.store.js';
import { AiCallError, callAI } from '../utils/ai-client.js';
import { resolveAiOutputLanguage } from '../utils/ai-output-language.js';
import {
  generateHouseholdPlanProposal,
  HouseholdPlanAttachmentError,
  MAX_HOUSEHOLD_PLAN_ATTACHMENT_BYTES,
  readHouseholdPlanAttachment,
  type HouseholdPlanAttachment
} from '../utils/household-plan-ai.js';

export const householdPlanRoutes = new Hono<AppEnv>();
householdPlanRoutes.use('*', authMiddleware);

householdPlanRoutes.get('/plan', (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) {
    if (needsActiveHouseholdSelection(db, userId)) {
      return c.json(
        {
          success: false,
          code: 'HOUSEHOLD_SELECTION_REQUIRED',
          message: 'Selecciona el hogar antes de consultar su plano.'
        },
        409
      );
    }
    return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 404);
  }
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  try {
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: readHouseholdPlan(db, householdId) });
  } catch {
    return c.json({ success: false, code: 'HOUSEHOLD_PLAN_UNAVAILABLE' }, 500);
  }
});

householdPlanRoutes.post(
  '/plan/proposal',
  bodyLimit({
    maxSize: MAX_HOUSEHOLD_PLAN_ATTACHMENT_BYTES + 128 * 1024,
    onError: (c) => c.json({ success: false, code: 'ATTACHMENT_TOO_LARGE' }, 413)
  }),
  async (c) => {
    const userId = c.get('userId');
    const db = getDatabase();
    const householdId = activeHouseholdId(db, userId);
    if (!householdId) {
      if (needsActiveHouseholdSelection(db, userId)) {
        return c.json(
          {
            success: false,
            code: 'HOUSEHOLD_SELECTION_REQUIRED',
            message: 'Selecciona el hogar antes de modificar su plano.'
          },
          409
        );
      }
      return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 404);
    }
    if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);
    if (!canEditHouseholdPlan(db, householdId, userId)) {
      return c.json(
        {
          success: false,
          code: 'HOUSEHOLD_SETTINGS_REQUIRED',
          message: 'No tienes permiso para editar el plano.'
        },
        403
      );
    }

    let body: unknown;
    let attachment: HouseholdPlanAttachment | null = null;
    const contentType = c.req.header('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('multipart/form-data')) {
      try {
        const form = await c.req.formData();
        const promptValue = form.get('prompt');
        const baseVersionValue = form.get('baseVersion');
        const draftPlanValue = form.get('draftPlan');
        const imageValues = form.getAll('image');
        if (
          (promptValue !== null && typeof promptValue !== 'string') ||
          (draftPlanValue !== null && typeof draftPlanValue !== 'string') ||
          imageValues.length > 1 ||
          (imageValues.length === 1 && typeof imageValues[0] === 'string')
        ) {
          return c.json({ success: false, code: 'INVALID_PLAN_REQUEST' }, 400);
        }
        let draftPlan: unknown;
        if (typeof draftPlanValue === 'string' && draftPlanValue.trim()) {
          try {
            draftPlan = JSON.parse(draftPlanValue);
          } catch {
            return c.json({ success: false, code: 'INVALID_PLAN_REQUEST' }, 400);
          }
        }
        body = {
          prompt: typeof promptValue === 'string' ? promptValue : undefined,
          draftPlan,
          baseVersion:
            typeof baseVersionValue === 'string' && baseVersionValue.trim()
              ? Number(baseVersionValue)
              : undefined
        };
        const candidate = imageValues[0];
        if (candidate !== undefined) {
          if (!(candidate instanceof File)) {
            return c.json({ success: false, code: 'INVALID_PLAN_REQUEST' }, 400);
          }
          attachment = await readHouseholdPlanAttachment(candidate);
        }
      } catch (error) {
        if (error instanceof HouseholdPlanAttachmentError) {
          return c.json(
            { success: false, code: error.code },
            error.code === 'ATTACHMENT_TOO_LARGE' ? 413 : 400
          );
        }
        return c.json({ success: false, code: 'INVALID_PLAN_REQUEST' }, 400);
      }
    } else if (contentType.includes('application/json')) {
      try {
        body = await c.req.json();
      } catch {
        return c.json({ success: false, code: 'INVALID_PLAN_REQUEST' }, 400);
      }
    } else {
      return c.json({ success: false, code: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
    }

    const input = householdPlanProposalRequestSchema.safeParse(body);
    if (!input.success) {
      return c.json(
        {
          success: false,
          code: 'INVALID_PLAN_REQUEST',
          errors: input.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
        },
        400
      );
    }
    const prompt = input.data.prompt ?? '';
    if (!prompt && !attachment) {
      return c.json({ success: false, code: 'PLAN_REQUEST_REQUIRED' }, 400);
    }

    let snapshot;
    try {
      snapshot = readHouseholdPlan(db, householdId);
    } catch {
      return c.json({ success: false, code: 'HOUSEHOLD_PLAN_UNAVAILABLE' }, 500);
    }
    if (snapshot.version !== input.data.baseVersion) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          success: false,
          code: 'PLAN_VERSION_CONFLICT',
          message: 'El plano cambió. Actualízalo antes de pedir una nueva propuesta.',
          data: snapshot
        },
        409
      );
    }

    try {
      const result = await generateHouseholdPlanProposal(
        {
          userId,
          db,
          language: resolveAiOutputLanguage(
            c.get('appLanguage'),
            null,
            c.req.header('accept-language')
          ),
          prompt,
          currentPlan: snapshot.plan,
          draftPlan: input.data.draftPlan,
          attachment
        },
        callAI
      );
      c.header('Cache-Control', 'no-store');
      return c.json({
        success: true,
        data: {
          baseVersion: snapshot.version,
          current: snapshot.plan,
          draft: input.data.draftPlan ?? snapshot.plan,
          proposal: result.plan,
          diff: result.diff,
          orphanedTaskIds: findOrphanedHouseholdTaskIds(db, householdId, snapshot.plan, result.plan)
        }
      });
    } catch (error) {
      if (error instanceof AiCallError) {
        if (error.code === 'NO_CONFIG') {
          return c.json(
            {
              success: false,
              code: 'AI_CONFIGURATION_REQUIRED',
              message: 'Configura la IA del hogar primero.'
            },
            503
          );
        }
        if (error.detail === 'CANCELLED') {
          return c.json({ success: false, code: 'AI_REQUEST_CANCELLED' }, 409);
        }
        if (error.code === 'TIMEOUT') {
          return c.json(
            {
              success: false,
              code: 'AI_PROVIDER_TIMEOUT',
              message: 'La IA tardó demasiado. Puedes intentarlo de nuevo.'
            },
            504
          );
        }
        if (error.code === 'BAD_JSON') {
          return c.json(
            {
              success: false,
              code: 'AI_PROPOSAL_INVALID',
              message: 'La propuesta no cumple el formato del plano; no se ha guardado.'
            },
            422
          );
        }
      }
      return c.json(
        {
          success: false,
          code: 'AI_PROVIDER_UNAVAILABLE',
          message: 'No se pudo generar la propuesta con la IA configurada.'
        },
        502
      );
    }
  }
);

householdPlanRoutes.put('/plan', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) {
    if (needsActiveHouseholdSelection(db, userId)) {
      return c.json(
        {
          success: false,
          code: 'HOUSEHOLD_SELECTION_REQUIRED',
          message: 'Selecciona el hogar antes de guardar su plano.'
        },
        409
      );
    }
    return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 404);
  }
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);

  if (!canEditHouseholdPlan(db, householdId, userId)) {
    return c.json(
      {
        success: false,
        code: 'HOUSEHOLD_SETTINGS_REQUIRED',
        message: 'No tienes permiso para editar el plano.'
      },
      403
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, code: 'INVALID_PLAN_REQUEST' }, 400);
  }

  const input = householdPlanWriteSchema.safeParse(body);
  if (!input.success) {
    return c.json(
      {
        success: false,
        code: 'INVALID_HOUSEHOLD_PLAN',
        errors: input.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      },
      400
    );
  }

  try {
    const result = saveHouseholdPlan(
      db,
      householdId,
      userId,
      input.data.baseVersion,
      input.data.plan,
      input.data.confirmOrphanedTaskIds
    );
    if (result.status === 'tasks-require-confirmation') {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          success: false,
          code: 'PLAN_TASKS_REQUIRE_CONFIRMATION',
          message: 'El cambio de plano dejaría tareas sin zona. Confirma para desvincularlas.',
          data: { snapshot: result.snapshot, orphanedTaskIds: result.orphanedTaskIds }
        },
        409
      );
    }
    if (result.status === 'conflict') {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          success: false,
          code: 'PLAN_VERSION_CONFLICT',
          message: 'El plano cambió en otra pestaña. Recarga la versión actual antes de guardar.',
          data: result.snapshot
        },
        409
      );
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: result.snapshot });
  } catch {
    return c.json({ success: false, code: 'HOUSEHOLD_PLAN_SAVE_FAILED' }, 500);
  }
});

householdPlanRoutes.get('/plan/assignments', (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) {
    if (needsActiveHouseholdSelection(db, userId)) return householdSelectionRequired(c);
    return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 404);
  }
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);
  try {
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: readHouseholdPlanAssignments(db, householdId) });
  } catch {
    return c.json({ success: false, code: 'HOUSEHOLD_PLAN_ASSIGNMENTS_UNAVAILABLE' }, 500);
  }
});

householdPlanRoutes.put('/plan/assignments', async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) {
    if (needsActiveHouseholdSelection(db, userId)) return householdSelectionRequired(c);
    return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 404);
  }
  if (c.req.header('x-household-id') !== householdId) return householdContextChanged(c);
  if (!canEditHouseholdPlan(db, householdId, userId)) {
    return c.json({ success: false, code: 'HOUSEHOLD_SETTINGS_REQUIRED' }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, code: 'INVALID_PLAN_ASSIGNMENT' }, 400);
  }
  const input = householdPlanAssignmentWriteSchema.safeParse(body);
  if (!input.success) {
    return c.json(
      {
        success: false,
        code: 'INVALID_PLAN_ASSIGNMENT',
        errors: input.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))
      },
      400
    );
  }

  try {
    const result = saveHouseholdPlanAssignment(db, householdId, userId, input.data);
    if (result.status === 'plan-conflict') {
      c.header('Cache-Control', 'no-store');
      return c.json({ success: false, code: 'PLAN_VERSION_CONFLICT', data: result }, 409);
    }
    if (result.status === 'conflict') {
      c.header('Cache-Control', 'no-store');
      return c.json(
        { success: false, code: 'PLAN_ASSIGNMENTS_VERSION_CONFLICT', data: result.snapshot },
        409
      );
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: result.snapshot });
  } catch (error) {
    if (error instanceof HouseholdPlanAssignmentError) {
      const status = error.code === 'PLAN_ASSIGNMENT_SPACE_NOT_FOUND' ? 404 : 422;
      return c.json({ success: false, code: error.code }, status);
    }
    return c.json({ success: false, code: 'HOUSEHOLD_PLAN_ASSIGNMENT_SAVE_FAILED' }, 500);
  }
});

function canEditHouseholdPlan(
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

function householdSelectionRequired(c: Context<AppEnv>) {
  return c.json(
    {
      success: false,
      code: 'HOUSEHOLD_SELECTION_REQUIRED',
      message: 'Selecciona el hogar antes de consultar sus asignaciones de zonas.'
    },
    409
  );
}
