import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getDatabase } from '../config/database.js';
import type { AppEnv } from '../types/hono-env.js';
import {
  cancelarTrabajo,
  queueForConfig,
  reordenarCola,
  reintentarTrabajo
} from '../utils/ticket-queue.js';
import { aiConfigByIdInScope, aiConfigScopeForUser } from '../utils/ai-config-scope.js';
import {
  canManageHouseholdAiSettings,
  needsActiveHouseholdSelection
} from '../utils/household-context.js';

const aiQueueRoutes = new Hono<AppEnv>();
aiQueueRoutes.use('*', authMiddleware);
aiQueueRoutes.use('*', async (c, next) => {
  if (needsActiveHouseholdSelection(getDatabase(), c.get('userId'))) {
    return c.json(
      {
        success: false,
        code: 'HOUSEHOLD_SELECTION_REQUIRED',
        message: 'Selecciona primero el hogar para consultar su cola de IA.'
      },
      409
    );
  }
  if (!canManageHouseholdAiSettings(getDatabase(), c.get('userId'))) {
    return c.json(
      {
        success: false,
        code: 'HOUSEHOLD_SETTINGS_REQUIRED',
        message: 'Se necesita permiso de configuración en el hogar activo.'
      },
      403
    );
  }
  return next();
});

const orderSchema = z.object({
  jobIds: z.array(z.string().min(1).max(64)).max(5000)
});

function ownsConfig(userId: string, configId: string): boolean {
  const db = getDatabase();
  return Boolean(aiConfigByIdInScope(db, configId, aiConfigScopeForUser(db, userId)));
}

function ownsJob(userId: string, configId: string, jobId: string): boolean {
  const db = getDatabase();
  const scope = aiConfigScopeForUser(db, userId);
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM ai_jobs WHERE id = ? AND user_id = ? AND household_id IS ? AND config_id = ?'
      )
      .get(jobId, userId, scope.householdId, configId)
  );
}

aiQueueRoutes.get('/configs/:id/queue', (c) => {
  const userId = c.get('userId');
  const configId = c.req.param('id');
  if (!ownsConfig(userId, configId)) {
    return c.json({ success: false, error: 'CONFIG_NOT_FOUND' }, 404);
  }
  return c.json({
    success: true,
    data: { configId, jobs: queueForConfig(getDatabase(), userId, configId) }
  });
});

aiQueueRoutes.patch('/configs/:id/queue/order', async (c) => {
  const userId = c.get('userId');
  const configId = c.req.param('id');
  if (!ownsConfig(userId, configId)) {
    return c.json({ success: false, error: 'CONFIG_NOT_FOUND' }, 404);
  }
  const parsed = orderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: 'INVALID_QUEUE_ORDER' }, 400);
  const changed = reordenarCola(getDatabase(), userId, configId, parsed.data.jobIds);
  if (!changed) return c.json({ success: false, error: 'QUEUE_CHANGED' }, 409);
  return c.json({ success: true, data: { reordered: true } });
});

aiQueueRoutes.post('/configs/:id/queue/:jobId/cancel', (c) => {
  const userId = c.get('userId');
  const configId = c.req.param('id');
  const jobId = c.req.param('jobId');
  if (!ownsConfig(userId, configId)) {
    return c.json({ success: false, error: 'CONFIG_NOT_FOUND' }, 404);
  }
  if (!ownsJob(userId, configId, jobId)) {
    return c.json({ success: false, error: 'JOB_NOT_FOUND' }, 404);
  }
  const cancelled = cancelarTrabajo(getDatabase(), userId, configId, jobId);
  if (!cancelled) return c.json({ success: false, error: 'JOB_NOT_CANCELLABLE' }, 409);
  return c.json({ success: true, data: { cancelled: true } });
});

aiQueueRoutes.post('/configs/:id/queue/:jobId/retry', (c) => {
  const userId = c.get('userId');
  const configId = c.req.param('id');
  const jobId = c.req.param('jobId');
  if (!ownsConfig(userId, configId)) {
    return c.json({ success: false, error: 'CONFIG_NOT_FOUND' }, 404);
  }
  const result = reintentarTrabajo(getDatabase(), userId, configId, jobId);
  if (result === 'queued') return c.json({ success: true, data: { retried: true } });
  if (result === 'input-expired') {
    return c.json({ success: false, error: 'INPUT_EXPIRED' }, 409);
  }
  if (result === 'config-unavailable') {
    return c.json({ success: false, error: 'CONFIG_UNAVAILABLE' }, 409);
  }
  if (result === 'not-failed') {
    return c.json({ success: false, error: 'JOB_NOT_RETRYABLE' }, 409);
  }
  return c.json({ success: false, error: 'JOB_NOT_FOUND' }, 404);
});

export { aiQueueRoutes };
