import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type User = { id: string; token: string };

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let alice: User;
let bob: User;

async function makeUser(name: string): Promise<User> {
  const id = `queue-${name}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    `${name}@queue.test`,
    name,
    'hash'
  );
  const { config } = await import('../config/app.config.js');
  return {
    id,
    token: jwt.sign({ sub: id, email: `${name}@queue.test` }, config.auth.jwtSecret, {
      expiresIn: '1h'
    })
  };
}

function createConfig(
  userId: string,
  id = `${userId}-config`,
  active = 1,
  householdId: string | null = null
): string {
  db.prepare(
    `INSERT INTO ai_configs (id, user_id, name, provider, base_url, api_key, model, retry_attempts,
       concurrency, is_active, household_id) VALUES (?, ?, 'Test', 'custom', 'http://provider.test/v1',
       'never-return-this-key', 'model', 1, 1, ?, ?)`
  ).run(id, userId, active, householdId);
  return id;
}

function createJob(input: {
  id: string;
  userId: string;
  configId: string;
  kind?: string;
  status?: string;
  queueOrder?: number;
  householdId?: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
}): void {
  db.prepare(
    `INSERT INTO ai_jobs
       (id, user_id, household_id, config_id, kind, status, queue_order, error_code, error_detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.userId,
    input.householdId ?? null,
    input.configId,
    input.kind ?? 'recipe',
    input.status ?? 'queued',
    input.queueOrder ?? 0,
    input.errorCode ?? null,
    input.errorDetail ?? null
  );
}

function addHouseholdMember(user: User, householdId: string, settings: boolean): void {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    householdId,
    householdId,
    `${householdId}-invite`
  );
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'member', ?)`
  ).run(`membership-${householdId}`, householdId, user.id, JSON.stringify({ settings }));
  db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, user.id);
}

async function call(user: User, method: string, path: string, body?: unknown) {
  const response = await app.request(`/api/ai${path}`, {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, payload: (await response.json()) as any };
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  const { aiQueueRoutes } = await import('./ai-queue.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.route('/api/ai', aiQueueRoutes);
});

afterAll(async () => {
  const { stopWorker } = await import('../utils/ticket-queue.js');
  stopWorker();
  closeDatabase?.();
});

beforeEach(async () => {
  const { stopWorker } = await import('../utils/ticket-queue.js');
  stopWorker();
  db.exec(
    'DELETE FROM household_members; DELETE FROM ai_jobs; DELETE FROM ai_configs; UPDATE users SET household_id = NULL; DELETE FROM households; DELETE FROM users;'
  );
  alice = await makeUser('alice');
  bob = await makeUser('bob');
});

describe('AI queue API', () => {
  it('denies every queue route to a home member without settings permission', async () => {
    const householdId = 'queue-home-no-settings';
    addHouseholdMember(alice, householdId, false);
    const configId = createConfig(alice.id, 'home-queue-config', 1, householdId);
    createJob({
      id: 'protected-queued',
      userId: alice.id,
      householdId,
      configId,
      queueOrder: 3
    });
    createJob({
      id: 'protected-failed',
      userId: alice.id,
      householdId,
      configId,
      status: 'failed'
    });

    const responses = await Promise.all([
      call(alice, 'GET', `/configs/${configId}/queue`),
      call(alice, 'PATCH', `/configs/${configId}/queue/order`, { jobIds: ['protected-queued'] }),
      call(alice, 'POST', `/configs/${configId}/queue/protected-queued/cancel`, {}),
      call(alice, 'POST', `/configs/${configId}/queue/protected-failed/retry`, {})
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    for (const response of responses) {
      expect(response.payload).toMatchObject({
        success: false,
        code: 'HOUSEHOLD_SETTINGS_REQUIRED'
      });
    }
    expect(db.prepare('SELECT id, status, queue_order FROM ai_jobs ORDER BY id').all()).toEqual([
      { id: 'protected-failed', status: 'failed', queue_order: 0 },
      { id: 'protected-queued', status: 'queued', queue_order: 3 }
    ]);
  });

  it('requires an active home before exposing personal configs or queues to a multi-home member', async () => {
    const personalConfig = createConfig(alice.id);
    for (const [id, inviteCode] of [
      ['queue-home-a', 'queue-invite-a'],
      ['queue-home-b', 'queue-invite-b']
    ]) {
      db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
        id,
        id,
        inviteCode
      );
      db.prepare(
        `INSERT INTO household_members (id, household_id, user_id, role, permissions)
         VALUES (?, ?, ?, 'admin', '{"settings":true}')`
      ).run(`membership-${id}`, id, alice.id);
    }

    const configs = await call(alice, 'GET', `/configs/${personalConfig}/queue`);
    const retry = await call(alice, 'POST', `/configs/${personalConfig}/queue/job/cancel`);

    expect(configs.status).toBe(409);
    expect(configs.payload).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SELECTION_REQUIRED'
    });
    expect(retry.status).toBe(409);
    expect(retry.payload.code).toBe('HOUSEHOLD_SELECTION_REQUIRED');
  });

  it('isolates configs by owner and returns only safe queue metadata', async () => {
    const configId = createConfig(alice.id);
    createJob({
      id: 'queued-a',
      userId: alice.id,
      configId,
      errorCode: 'PROVIDER',
      errorDetail: 'provider body with household prompt must not escape'
    });
    const foreignConfig = createConfig(bob.id);
    createJob({ id: 'foreign', userId: bob.id, configId: foreignConfig });

    const own = await call(alice, 'GET', `/configs/${configId}/queue`);
    expect(own.status).toBe(200);
    expect(own.payload.data).toMatchObject({
      configId,
      jobs: [{ id: 'queued-a', retryable: false }]
    });
    const serialized = JSON.stringify(own.payload);
    expect(serialized).not.toContain('never-return-this-key');
    expect(serialized).not.toContain('provider body');
    expect(own.payload.data.jobs[0]).not.toHaveProperty('errorDetail');

    expect((await call(alice, 'GET', `/configs/${foreignConfig}/queue`)).status).toBe(404);
    expect((await call(bob, 'GET', `/configs/${configId}/queue`)).status).toBe(404);
  });

  it('reorders only the exact current queued set and leaves running jobs unmoved', async () => {
    const configId = createConfig(alice.id);
    createJob({ id: 'first', userId: alice.id, configId, queueOrder: 0 });
    createJob({ id: 'second', userId: alice.id, configId, queueOrder: 1 });
    createJob({ id: 'running', userId: alice.id, configId, status: 'running', queueOrder: 0 });

    const moved = await call(alice, 'PATCH', `/configs/${configId}/queue/order`, {
      jobIds: ['second', 'first']
    });
    expect(moved.status).toBe(200);
    expect(
      db
        .prepare('SELECT id, queue_order FROM ai_jobs WHERE status = ? ORDER BY queue_order')
        .all('queued')
    ).toEqual([
      { id: 'second', queue_order: 0 },
      { id: 'first', queue_order: 1 }
    ]);
    expect(
      (await call(alice, 'PATCH', `/configs/${configId}/queue/order`, { jobIds: ['second'] }))
        .status
    ).toBe(409);
    expect(
      (
        await call(alice, 'PATCH', `/configs/${configId}/queue/order`, {
          jobIds: ['second', 'second']
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(alice, 'PATCH', `/configs/${configId}/queue/order`, {
          jobIds: ['second', 'foreign']
        })
      ).status
    ).toBe(409);
  });

  it('cancels queued/running jobs, retries failed receipts, and rejects expired generic input', async () => {
    const configId = createConfig(alice.id);
    createJob({ id: 'queued', userId: alice.id, configId });
    createJob({ id: 'active', userId: alice.id, configId, status: 'running' });
    createJob({
      id: 'failed-ticket',
      userId: alice.id,
      configId,
      kind: 'receipt',
      status: 'failed'
    });
    createJob({
      id: 'expired-generic',
      userId: alice.id,
      configId,
      status: 'failed',
      errorCode: 'INPUT_EXPIRED'
    });

    for (const id of ['queued', 'active']) {
      expect((await call(alice, 'POST', `/configs/${configId}/queue/${id}/cancel`)).status).toBe(
        200
      );
      expect(
        db.prepare('SELECT status, claim_generation FROM ai_jobs WHERE id = ?').get(id) as any
      ).toMatchObject({ status: 'stopped', claim_generation: 1 });
    }

    const retry = await call(alice, 'POST', `/configs/${configId}/queue/failed-ticket/retry`);
    expect(retry.status).toBe(200);
    expect(
      db
        .prepare('SELECT status, attempts, max_attempts FROM ai_jobs WHERE id = ?')
        .get('failed-ticket')
    ).toMatchObject({ status: 'queued', attempts: 0, max_attempts: 2 });
    expect(
      (await call(alice, 'POST', `/configs/${configId}/queue/expired-generic/retry`)).payload.error
    ).toBe('INPUT_EXPIRED');
  });

  it('rejects malformed order bodies and does not cancel jobs owned by another user', async () => {
    const ownConfig = createConfig(alice.id);
    const otherConfig = createConfig(bob.id);
    createJob({ id: 'bob-job', userId: bob.id, configId: otherConfig });
    expect(
      (await call(alice, 'PATCH', `/configs/${ownConfig}/queue/order`, { jobIds: [''] })).status
    ).toBe(400);
    expect((await call(alice, 'POST', `/configs/${ownConfig}/queue/bob-job/cancel`)).status).toBe(
      404
    );
    expect(
      (db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get('bob-job') as any).status
    ).toBe('queued');
  });

  it('does not advertise or accept manager retry for an inactive provider', async () => {
    const configId = createConfig(alice.id, `${alice.id}-inactive`, 0);
    createJob({
      id: 'inactive-ticket',
      userId: alice.id,
      configId,
      kind: 'receipt',
      status: 'failed'
    });

    const list = await call(alice, 'GET', `/configs/${configId}/queue`);
    expect(list.payload.data.jobs[0].retryable).toBe(false);
    const retry = await call(alice, 'POST', `/configs/${configId}/queue/inactive-ticket/retry`);
    expect(retry.status).toBe(409);
    expect(retry.payload.error).toBe('CONFIG_UNAVAILABLE');
    expect(
      (db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get('inactive-ticket') as any).status
    ).toBe('failed');
  });

  it('returns stable 404/409 responses for disappearing configs and ineligible jobs', async () => {
    const configId = createConfig(alice.id);
    createJob({ id: 'already-queued', userId: alice.id, configId });
    createJob({ id: 'already-done', userId: alice.id, configId, status: 'done' });

    expect(
      (await call(alice, 'PATCH', '/configs/missing/queue/order', { jobIds: [] })).status
    ).toBe(404);
    expect((await call(alice, 'POST', '/configs/missing/queue/job/cancel')).status).toBe(404);
    expect((await call(alice, 'POST', '/configs/missing/queue/job/retry')).status).toBe(404);
    expect((await call(alice, 'POST', `/configs/${configId}/queue/missing/retry`)).status).toBe(
      404
    );
    expect(
      (await call(alice, 'POST', `/configs/${configId}/queue/already-queued/retry`)).status
    ).toBe(409);
    expect(
      (await call(alice, 'POST', `/configs/${configId}/queue/already-done/cancel`)).status
    ).toBe(409);
    expect(
      (await call(alice, 'PATCH', `/configs/${configId}/queue/order`, 'not an order')).status
    ).toBe(400);
  });

  it('does not retry terminal tickets after a provider limit is changed to unlimited', async () => {
    const configId = createConfig(alice.id);
    createJob({
      id: 'failed-ticket',
      userId: alice.id,
      configId,
      kind: 'receipt',
      status: 'failed'
    });
    db.prepare('UPDATE ai_configs SET concurrency = 0 WHERE id = ?').run(configId);

    const list = await call(alice, 'GET', `/configs/${configId}/queue`);
    expect(list.payload.data.jobs[0].retryable).toBe(false);
    const retry = await call(alice, 'POST', `/configs/${configId}/queue/failed-ticket/retry`);
    expect(retry.status).toBe(409);
    expect(retry.payload.error).toBe('CONFIG_UNAVAILABLE');
  });
});
