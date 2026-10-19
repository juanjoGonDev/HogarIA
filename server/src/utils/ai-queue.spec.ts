import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import {
  RECEIPT_RESPONSE_FORMAT,
  RECIPE_RESPONSE_FORMAT
} from '../schemas/ai-generated-output.schema.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type AiConfig = import('./ai-client.js').AiConfigRow;
let db: Sql;
let closeDatabase: () => void;
let config: AiConfig;
const userId = 'queue-user';

async function waitFor(predicate: () => boolean, timeoutMs = 2500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) throw new Error('Timed out waiting for queue state');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function jobRow(id: string) {
  return db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(id) as Record<string, any>;
}

function seedMovedInventoryProduct(): void {
  db.prepare(
    `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color, position)
     VALUES ('category-drinks', ?, NULL, 'drinks', 'Bebidas', '#123456', 1),
            ('category-dairy', ?, NULL, 'dairy', 'Lácteos', '#654321', 2)`
  ).run(userId, userId);
  db.prepare(
    `INSERT INTO ingredients (id, user_id, household_id, name, category, quantity, unit)
     VALUES ('catalog-milk', ?, NULL, 'Leche semidesnatada', 'drinks', 1, 'l')`
  ).run(userId);
  // A manual category move immediately before upload must be reflected in the prompt snapshot.
  db.prepare("UPDATE ingredients SET category = 'dairy' WHERE id = 'catalog-milk'").run();
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
});

afterAll(async () => {
  const { stopWorker } = await import('./ticket-queue.js');
  stopWorker();
  closeDatabase?.();
});

beforeEach(async () => {
  const { stopWorker } = await import('./ticket-queue.js');
  stopWorker();
  db.exec(
    'DELETE FROM household_members; DELETE FROM ai_jobs; DELETE FROM ai_configs; DELETE FROM ingredients; DELETE FROM pantry_categories; UPDATE users SET household_id = NULL; DELETE FROM households; DELETE FROM users;'
  );
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    userId,
    'queue@test.local',
    'Queue tester',
    'hash'
  );
  db.prepare(
    `INSERT INTO ai_configs
      (id, user_id, name, provider, base_url, api_key, model, retry_attempts, concurrency, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    'config-a',
    userId,
    'Provider A',
    'custom',
    'http://provider.test/v1',
    'secret-key',
    'model-a',
    1,
    1
  );
  config = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get('config-a') as AiConfig;
  vi.stubGlobal('fetch', vi.fn());
});

describe('AI provider queue dispatcher', () => {
  it('does not poll the idle database more than once in a short interval', async () => {
    const { ensureWorker, stopWorker } = await import('./ticket-queue.js');
    const prepare = vi.spyOn(db, 'prepare');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    try {
      ensureWorker();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
      await new Promise((resolve) => setTimeout(resolve, 250));

      const idlePolls = prepare.mock.calls.filter(([sql]) =>
        String(sql).includes("SELECT DISTINCT config_id FROM ai_jobs WHERE status = 'queued'")
      );
      expect(idlePolls).toHaveLength(1);
    } finally {
      prepare.mockRestore();
      setIntervalSpy.mockRestore();
      stopWorker();
    }
  });

  it('clears the startup wake and reconciliation timer when stopping', async () => {
    const { ensureWorker, stopWorker } = await import('./ticket-queue.js');
    const prepare = vi.spyOn(db, 'prepare');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    try {
      ensureWorker();
      stopWorker();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const idlePolls = prepare.mock.calls.filter(([sql]) =>
        String(sql).includes("SELECT DISTINCT config_id FROM ai_jobs WHERE status = 'queued'")
      );
      expect(idlePolls).toHaveLength(0);
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    } finally {
      prepare.mockRestore();
      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      stopWorker();
    }
  });

  it('seeds default pantry categories before snapshotting a new receipt inventory', async () => {
    const { inventarioDeLaCasa } = await import('./ticket-queue.js');
    const { DEFAULT_PANTRY_CATEGORIES } = await import('./pantry-categories.js');

    expect(db.prepare('SELECT COUNT(*) AS count FROM pantry_categories').get()).toEqual({
      count: 0
    });

    const snapshot = inventarioDeLaCasa(db, userId, null);

    expect(snapshot.categorias).toEqual(
      DEFAULT_PANTRY_CATEGORIES.map(({ key, name }) => ({ clave: key, nombre: name }))
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM pantry_categories').get()).toEqual({
      count: DEFAULT_PANTRY_CATEGORIES.length
    });
  });

  it('preserves a nonempty custom category catalog when snapshotting receipt inventory', async () => {
    const { inventarioDeLaCasa } = await import('./ticket-queue.js');
    db.prepare(
      `INSERT INTO pantry_categories (id, user_id, household_id, key, name, color, position)
       VALUES ('category-custom', ?, NULL, 'custom', 'Mi categoría', '#123456', 0)`
    ).run(userId);

    expect(inventarioDeLaCasa(db, userId, null).categorias).toEqual([
      { clave: 'custom', nombre: 'Mi categoría' }
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM pantry_categories').get()).toEqual({
      count: 1
    });
  });

  it('keeps a household job pinned to its home when another member changes homes before claim', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    const configOwnerId = 'household-config-owner';
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      configOwnerId,
      'owner@test.local',
      'Config owner',
      'hash'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'home-a',
      'Home A',
      'invite-a'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'home-b',
      'Home B',
      'invite-b'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}'), (?, ?, ?, 'admin', '{}'), (?, ?, ?, 'member', '{}')`
    ).run(
      'membership-actor-a',
      'home-a',
      userId,
      'membership-owner-a',
      'home-a',
      configOwnerId,
      'membership-actor-b',
      'home-b',
      userId
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-a', userId);
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, household_id, name, provider, base_url, api_key, model, concurrency, is_active)
       VALUES ('home-a-config', ?, 'home-a', 'Home A', 'custom', 'http://provider.test/v1',
         'synthetic-key', 'model-a', 1, 1)`
    ).run(configOwnerId);
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, household_id, name, provider, base_url, api_key, model, concurrency, is_active)
       VALUES ('home-b-config', ?, 'home-b', 'Home B', 'custom', 'http://provider.test/v1',
         'synthetic-key-b', 'model-b', 1, 1)`
    ).run(configOwnerId);
    const sharedConfig = db
      .prepare('SELECT * FROM ai_configs WHERE id = ?')
      .get('home-a-config') as AiConfig;
    const started = deferred<string>();
    const release = deferred<string>();

    const job = submitAiTask({
      db,
      userId,
      config: sharedConfig,
      kind: 'recipe.generate',
      run: async (fixedConfig) => {
        started.resolve(fixedConfig?.id ?? 'missing-config');
        return release.promise;
      }
    });
    const settledResult = job.result.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    expect(jobRow(job.id)).toMatchObject({
      user_id: userId,
      household_id: 'home-a',
      config_id: 'home-a-config'
    });
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-b', userId);

    await expect(started.promise).resolves.toBe('home-a-config');
    const { queueForConfig } = await import('./ticket-queue.js');
    expect(queueForConfig(db, userId, 'home-a-config').some((entry) => entry.id === job.id)).toBe(
      false
    );
    expect(queueForConfig(db, userId, 'home-b-config').some((entry) => entry.id === job.id)).toBe(
      false
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-a', userId);
    expect(queueForConfig(db, userId, 'home-a-config').some((entry) => entry.id === job.id)).toBe(
      true
    );
    release.resolve('home-a-config');
    await expect(settledResult).resolves.toEqual({ value: 'home-a-config' });
    expect(jobRow(job.id)).toMatchObject({ household_id: 'home-a', status: 'done' });
  });

  it('resolves AI config from the prompt household instead of a changed active selection', async () => {
    const { dispatchAI } = await import('./ticket-queue.js');
    const configOwnerId = 'scoped-config-owner';
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      configOwnerId,
      'scoped-owner@test.local',
      'Scoped config owner',
      'hash'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?), (?, ?, ?)').run(
      'scope-home-a',
      'Scope A',
      'scope-a',
      'scope-home-b',
      'Scope B',
      'scope-b'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, 'scope-home-a', ?, 'member', '{}'), (?, 'scope-home-a', ?, 'admin', '{}'),
              (?, 'scope-home-b', ?, 'member', '{}')`
    ).run('scope-a-actor', userId, 'scope-a-owner', configOwnerId, 'scope-b-actor', userId);
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('scope-home-b', userId);
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, household_id, name, provider, base_url, api_key, model, concurrency, is_active)
       VALUES ('scope-a-config', ?, 'scope-home-a', 'Scope A', 'custom', 'http://provider.test/v1',
         'scope-a-secret', 'model-a', 1, 1),
              ('scope-b-config', ?, 'scope-home-b', 'Scope B', 'custom', 'http://provider.test/v1',
         'scope-b-secret', 'model-b', 1, 1)`
    ).run(configOwnerId, configOwnerId);

    const provider = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(request.model).toBe('model-a');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer scope-a-secret' });
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', provider);

    const result = await dispatchAI(
      userId,
      [{ role: 'user', content: 'synthetic' }],
      db,
      RECIPE_RESPONSE_FORMAT,
      'household_plan',
      undefined,
      'scope-home-a'
    );

    expect(result).toBe('{}');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT household_id, config_id, status FROM ai_jobs').get()).toMatchObject({
      household_id: 'scope-home-a',
      config_id: 'scope-a-config',
      status: 'done'
    });
  });

  it('pins a receipt job and its provider from the receipt home, not the current selection', async () => {
    const { encolarTicket, stopWorker } = await import('./ticket-queue.js');
    const configOwnerId = 'receipt-config-owner';
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      configOwnerId,
      'receipt-owner@test.local',
      'Receipt config owner',
      'hash'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'receipt-home-a',
      'Receipt home A',
      'receipt-invite-a'
    );
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'receipt-home-b',
      'Receipt home B',
      'receipt-invite-b'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}'), (?, ?, ?, 'admin', '{}'), (?, ?, ?, 'member', '{}')`
    ).run(
      'receipt-actor-a',
      'receipt-home-a',
      userId,
      'receipt-owner-a',
      'receipt-home-a',
      configOwnerId,
      'receipt-actor-b',
      'receipt-home-b',
      userId
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('receipt-home-b', userId);
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, household_id, name, provider, base_url, api_key, model, concurrency, is_active)
       VALUES ('receipt-home-a-config', ?, 'receipt-home-a', 'Receipt Home A', 'custom',
         'http://provider.test/v1', 'synthetic-receipt-key', 'model-a', 1, 1)`
    ).run(configOwnerId);
    db.prepare(
      `INSERT INTO receipts (id, user_id, household_id, status, file_url, file_kind)
       VALUES ('receipt-home-a-ticket', ?, 'receipt-home-a', 'queued', '/synthetic/ticket.png', 'png')`
    ).run(userId);

    try {
      const jobId = encolarTicket(db, userId, 'receipt-home-a-ticket');
      expect(jobRow(jobId)).toMatchObject({
        user_id: userId,
        household_id: 'receipt-home-a',
        config_id: 'receipt-home-a-config',
        receipt_id: 'receipt-home-a-ticket'
      });
    } finally {
      stopWorker();
    }
  });

  it('pins each call to the selected configuration and never persists prompt or API key in ai_jobs', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    const prompt = 'private allergy and household details';
    const job = submitAiTask({
      db,
      userId,
      config,
      kind: 'recipe.generate',
      run: async (fixedConfig) => `${fixedConfig?.id}:${prompt}`
    });

    expect(jobRow(job.id)).toMatchObject({
      config_id: 'config-a',
      kind: 'recipe.generate',
      status: 'queued'
    });
    const columns = db.prepare('PRAGMA table_info(ai_jobs)').all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain('payload');
    expect(JSON.stringify(jobRow(job.id))).not.toContain(prompt);
    expect(JSON.stringify(jobRow(job.id))).not.toContain('secret-key');
    await expect(job.result).resolves.toBe('config-a:private allergy and household details');
  });

  it('enforces per-config maximum concurrency while another config proceeds independently', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    const firstStarted = deferred();
    const releaseFirst = deferred();
    const secondStarted = deferred();
    const thirdStarted = deferred();
    const first = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.first',
      run: async () => {
        firstStarted.resolve();
        await releaseFirst.promise;
        return 'first';
      }
    });
    const second = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.second',
      run: async () => {
        secondStarted.resolve();
        return 'second';
      }
    });
    const third = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.third',
      run: async () => {
        thirdStarted.resolve();
        return 'third';
      }
    });
    const otherConfig = {
      ...config,
      id: 'config-b',
      concurrency: 1
    };
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, name, provider, base_url, api_key, model, retry_attempts, concurrency, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      'config-b',
      userId,
      'Provider B',
      'custom',
      'http://provider-b.test/v1',
      'other-secret',
      'model-b',
      0,
      1
    );
    const independent = submitAiTask({
      db,
      userId,
      config: otherConfig,
      kind: 'test.independent',
      run: async () => 'independent'
    });

    await Promise.all([firstStarted.promise, independent.result]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(jobRow(second.id).status).toBe('queued');
    expect(jobRow(third.id).status).toBe('queued');
    expect(jobRow(independent.id).config_id).toBe('config-b');

    releaseFirst.resolve();
    await Promise.all([
      first.result,
      secondStarted.promise,
      second.result,
      thirdStarted.promise,
      third.result
    ]);
    expect(jobRow(first.id).status).toBe('done');
    expect(jobRow(second.id).status).toBe('done');
    expect(jobRow(third.id).status).toBe('done');
  });

  it('lowering a provider cap stops new claims but does not abort its running jobs', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    db.prepare('UPDATE ai_configs SET concurrency = 2 WHERE id = ?').run('config-a');
    const release = [deferred(), deferred()];
    const started = [deferred(), deferred()];
    const jobs = started.map((signal, index) =>
      submitAiTask({
        db,
        userId,
        config,
        kind: `test.cap.${index}`,
        run: async () => {
          signal.resolve();
          await release[index].promise;
          return index;
        }
      })
    );
    const thirdStarted = deferred();
    const third = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.cap.queued',
      run: async () => {
        thirdStarted.resolve();
        return 3;
      }
    });

    await Promise.all(started.map((signal) => signal.promise));
    db.prepare('UPDATE ai_configs SET concurrency = 1 WHERE id = ?').run('config-a');
    expect(jobs.every((job) => jobRow(job.id).status === 'running')).toBe(true);
    expect(jobRow(third.id).status).toBe('queued');

    release[0].resolve();
    await jobs[0].result;
    await new Promise((resolve) => setTimeout(resolve, 130));
    expect(jobRow(jobs[1].id).status).toBe('running');
    expect(jobRow(third.id).status).toBe('queued');

    release[1].resolve();
    await Promise.all([jobs[1].result, thirdStarted.promise, third.result]);
    expect(jobRow(third.id).status).toBe('done');
  });

  it('does not claim a generic job whose payload closure belongs to another process', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    db.prepare('UPDATE ai_configs SET concurrency = 2 WHERE id = ?').run('config-a');
    const started = deferred();
    const release = deferred();
    const local = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.local-owner',
      run: async () => {
        started.resolve();
        await release.promise;
        return 'done';
      }
    });
    await started.promise;
    db.prepare(
      `INSERT INTO ai_jobs (id, user_id, config_id, kind, status, max_attempts)
       VALUES ('foreign-owner', ?, 'config-a', 'recipe', 'queued', 2)`
    ).run(userId);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(jobRow('foreign-owner').status).toBe('queued');
    expect(jobRow(local.id).status).toBe('running');

    release.resolve();
    await local.result;
  });

  it('treats a concurrency value of zero as unlimited, but still dispatches through the queue', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    db.prepare('UPDATE ai_configs SET concurrency = 0 WHERE id = ?').run('config-a');
    const release = deferred();
    const started = [deferred(), deferred(), deferred()];
    const unlimited = { ...config, concurrency: 0 };
    const jobs = started.map((signal, index) =>
      submitAiTask({
        db,
        userId,
        config: unlimited,
        kind: `test.unlimited.${index}`,
        run: async () => {
          signal.resolve();
          await release.promise;
          return index;
        }
      })
    );

    await Promise.all(started.map((signal) => signal.promise));
    expect(jobs.every((job) => jobRow(job.id).status === 'running')).toBe(true);
    release.resolve();
    await Promise.all(jobs.map((job) => job.result));
  });

  it('reports concurrency safely for defaults, caps and missing active configs', async () => {
    const { concurrenciaDe } = await import('./ticket-queue.js');
    expect(concurrenciaDe(db, userId)).toBe(1);

    db.prepare('UPDATE ai_configs SET concurrency = 0 WHERE id = ?').run('config-a');
    expect(concurrenciaDe(db, userId)).toBe(Number.POSITIVE_INFINITY);

    db.prepare('UPDATE ai_configs SET concurrency = 12 WHERE id = ?').run('config-a');
    expect(concurrenciaDe(db, userId)).toBe(8);

    db.prepare('UPDATE ai_configs SET is_active = 0 WHERE id = ?').run('config-a');
    expect(concurrenciaDe(db, userId)).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects excessive resident payloads and enforces the per-user job cap', async () => {
    const { submitAiTask, cancelarTrabajo } = await import('./ticket-queue.js');
    const task = {
      db,
      userId,
      config,
      kind: 'test.capacity',
      run: async (_fixed: AiConfig | null, signal: AbortSignal) =>
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        })
    };

    let payloadError: unknown;
    try {
      submitAiTask({ ...task, payloadBytes: 32 * 1024 * 1024 + 1 });
    } catch (error) {
      payloadError = error;
    }
    expect(payloadError).toMatchObject({ detail: 'QUEUE_CAPACITY' });

    const jobs = Array.from({ length: 100 }, () => submitAiTask(task));
    const results = jobs.map((job) => job.result.catch(() => undefined));
    let countError: unknown;
    try {
      submitAiTask(task);
    } catch (error) {
      countError = error;
    }
    expect(countError).toMatchObject({ detail: 'QUEUE_CAPACITY' });
    for (const job of jobs) cancelarTrabajo(db, userId, 'config-a', job.id);
    await Promise.all(results);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_jobs').get()).toMatchObject({ n: 100 });
  });

  it('routes JSON requests, streaming and connection probes through the provider dispatcher', async () => {
    const { dispatchAI, dispatchAIStreaming, dispatchPingDeConexion } =
      await import('./ticket-queue.js');
    const fakeFetch = vi.mocked(fetch);
    const json = (content: string) =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    fakeFetch.mockResolvedValueOnce(json('recipe result'));
    await expect(
      dispatchAI(
        userId,
        [{ role: 'user', content: 'synthetic recipe prompt' }],
        db,
        RECIPE_RESPONSE_FORMAT,
        'recipe'
      )
    ).resolves.toBe('recipe result');
    expect(JSON.parse(String(fakeFetch.mock.calls[0][1]?.body)).response_format).toEqual(
      RECIPE_RESPONSE_FORMAT
    );
    expect(
      db.prepare('SELECT kind, status FROM ai_jobs ORDER BY created_at DESC LIMIT 1').get()
    ).toMatchObject({ kind: 'recipe', status: 'done' });

    const encoder = new TextEncoder();
    fakeFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"chunk"}}]}\n\n')
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    );
    const deltas: string[] = [];
    await expect(
      dispatchAIStreaming(
        userId,
        [{ role: 'user', content: 'synthetic receipt prompt' }],
        db,
        (chunk) => deltas.push(chunk),
        RECEIPT_RESPONSE_FORMAT,
        new AbortController().signal
      )
    ).resolves.toBe('chunk');
    expect(deltas).toEqual(['chunk']);

    fakeFetch.mockResolvedValueOnce(json('{"status":"ok","message":"synthetic ok"}'));
    await expect(
      dispatchPingDeConexion(
        { base_url: config.base_url, api_key: config.api_key, model: config.model },
        { db, userId, config, configId: config.id }
      )
    ).resolves.toMatchObject({ ok: true, message: 'synthetic ok' });
    expect(
      db.prepare('SELECT kind, status FROM ai_jobs WHERE kind = ?').get('connection_test')
    ).toMatchObject({ kind: 'connection_test', status: 'done' });
  });

  it('rejects normal and streaming AI calls when the user has no active provider', async () => {
    const { dispatchAI, dispatchAIStreaming } = await import('./ticket-queue.js');
    db.prepare('UPDATE ai_configs SET is_active = 0 WHERE id = ?').run(config.id);
    const messages = [{ role: 'user' as const, content: 'synthetic request' }];

    await expect(dispatchAI(userId, messages, db, RECIPE_RESPONSE_FORMAT)).rejects.toMatchObject({
      code: 'NO_CONFIG'
    });
    await expect(
      dispatchAIStreaming(
        userId,
        messages,
        db,
        () => undefined,
        RECEIPT_RESPONSE_FORMAT,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'NO_CONFIG' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_jobs').get()).toMatchObject({ n: 0 });
  });

  it('stops orphaned provider jobs and settles any local request closure', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    const orphan = submitAiTask({
      db,
      userId,
      config,
      configId: 'deleted-provider',
      kind: 'test.orphaned',
      run: async () => 'must not run'
    });
    const rejected = expect(orphan.result).rejects.toThrow();
    db.prepare(
      `INSERT INTO ai_jobs (id, user_id, config_id, kind, status, max_attempts)
       VALUES ('orphan-without-runtime', ?, 'deleted-provider', 'recipe', 'queued', 1)`
    ).run(userId);

    await waitFor(
      () =>
        jobRow(orphan.id).status === 'stopped' &&
        jobRow('orphan-without-runtime').status === 'stopped'
    );
    await rejected;
    expect(jobRow(orphan.id)).toMatchObject({
      status: 'stopped',
      error_code: 'CONFIG_UNAVAILABLE'
    });
    expect(jobRow('orphan-without-runtime')).toMatchObject({
      status: 'stopped',
      error_code: 'CONFIG_UNAVAILABLE'
    });
  });

  it('processes a synthetic ticket through the pinned provider stream and final schema', async () => {
    const originalDatabasePath = process.env.DATABASE_PATH;
    const isolatedDirectory = mkdtempSync(join(tmpdir(), 'hogaria-ai-queue-ticket-'));
    const { encolarTicket, stopWorker } = await import('./ticket-queue.js');
    try {
      process.env.DATABASE_PATH = join(isolatedDirectory, 'database.sqlite');
      const { storeTicket, uploadsRoot } = await import('./uploads.js');
      const pdf = Buffer.from('%PDF-1.7 synthetic queue ticket');
      const fileUrl = storeTicket('synthetic-queue-ticket', pdf, 'pdf', uploadsRoot());
      const receiptId = 'synthetic-queue-receipt';
      const finalAnswer = {
        lines: [
          {
            name: 'Tomate',
            quantity: 2,
            unit: 'kg',
            category: 'vegetables',
            createCategory: false,
            priceMinor: 500,
            offer: { buy: 2, take: 1 },
            confidence: 0.9,
            note: 'synthetic line'
          },
          {
            name: 'Tomáte',
            quantity: 2,
            unit: 'kg',
            category: 'vegetables',
            createCategory: false,
            priceMinor: 500,
            offer: { buy: 2, take: 1 },
            confidence: 0.7,
            note: ''
          },
          {
            name: 'Pan ' + 'artesano '.repeat(300),
            quantity: 1,
            unit: 'unidad/'.repeat(320),
            category: 'other',
            createCategory: false,
            priceMinor: 150,
            note: 'Detalle '.repeat(400)
          },
          { name: 'Agua mineral', category: 'beverages', createCategory: false, priceMinor: 100 },
          { name: 'AGUA mineral', category: 'beverages', createCategory: false, priceMinor: 100 }
        ],
        store: 'Mercado sintético',
        purchaseDate: '2024-02-29',
        currency: 'EUR',
        totalMinor: 850,
        warnings: []
      };
      const encoder = new TextEncoder();
      const frames = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(finalAnswer) } }] })}\n\n`,
        'data: [DONE]\n\n'
      ].join('');
      seedMovedInventoryProduct();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(frames));
              controller.close();
            }
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      );
      db.prepare(
        `INSERT INTO receipts (id, user_id, status, file_url, file_kind, ai_output_language)
         VALUES (?, ?, 'queued', ?, 'pdf', 'en')`
      ).run(receiptId, userId, fileUrl);

      const jobId = encolarTicket(db, userId, receiptId);
      await waitFor(() => jobRow(jobId).status === 'done');
      const providerRequest = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
      const providerMessages = providerRequest.messages as {
        role: string;
        content:
          | string
          | Array<{
              type?: string;
              text?: string;
              file?: { filename?: string; file_data?: string };
            }>;
      }[];
      expect(providerRequest.response_format).toEqual(RECEIPT_RESPONSE_FORMAT);
      expect(providerMessages[0]?.content).toContain('English (United Kingdom)');
      expect(providerMessages[0]?.content).toContain('warnings');
      const ticketContent = providerMessages.find(({ role }) => role === 'user')?.content;
      expect(Array.isArray(ticketContent)).toBe(true);
      const ticketTextParts = Array.isArray(ticketContent)
        ? ticketContent.filter(({ type }) => type === 'text')
        : [];
      expect(ticketTextParts).toHaveLength(1);
      expect(ticketTextParts[0]?.text).toContain('inventario.json');
      expect(ticketTextParts[0]?.text).toContain('adjunto');
      const ticketParts = Array.isArray(ticketContent) ? ticketContent : [];
      const inventoryFilePart = ticketParts.find(
        ({ type, file }) => type === 'file' && file?.filename === 'inventario.json'
      );
      expect(inventoryFilePart?.file?.file_data?.startsWith('data:application/json;base64,')).toBe(
        true
      );
      const inventoryBase64 = inventoryFilePart?.file?.file_data?.replace(
        'data:application/json;base64,',
        ''
      );
      expect(inventoryBase64).toBeTruthy();
      const inventorySnapshot = JSON.parse(
        Buffer.from(inventoryBase64!, 'base64').toString('utf8')
      ) as {
        categorias: { clave: string; nombre: string }[];
        productos: { categoria: string; nombre: string; unidad: string }[];
      };
      expect(inventorySnapshot.categorias).toContainEqual({ clave: 'dairy', nombre: 'Lácteos' });
      expect(inventorySnapshot.productos).toContainEqual({
        categoria: 'dairy',
        nombre: 'Leche semidesnatada',
        unidad: 'l'
      });
      const ticketPdfPart = ticketParts.find(
        ({ type, file }) => type === 'file' && file?.filename === 'ticket.pdf'
      );
      expect(ticketPdfPart?.file?.file_data?.startsWith('data:application/pdf;base64,')).toBe(true);
      expect(ticketParts.filter(({ type }) => type === 'file')).toHaveLength(2);
      expect(ticketParts.some(({ type }) => type === 'image_url')).toBe(false);
      expect(jobRow(jobId)).toMatchObject({
        kind: 'receipt',
        status: 'done',
        config_id: config.id
      });
      expect(
        db
          .prepare(
            'SELECT status, store, purchase_date, currency, total_minor FROM receipts WHERE id = ?'
          )
          .get(receiptId)
      ).toMatchObject({
        status: 'review',
        store: 'Mercado sintético',
        purchase_date: '2024-02-29',
        currency: 'EUR',
        total_minor: 850
      });
      const savedTicketLines = db
        .prepare(
          'SELECT name, quantity, price_minor FROM receipt_items WHERE receipt_id = ? ORDER BY position'
        )
        .all(receiptId) as { name: string; quantity: number; price_minor: number }[];
      expect(savedTicketLines).toEqual([
        expect.objectContaining({ name: 'Tomate', quantity: 2, price_minor: 500 }),
        expect.objectContaining({
          name: 'Pan ' + 'artesano '.repeat(300).trim(),
          quantity: 1,
          price_minor: 150
        }),
        expect.objectContaining({ name: 'Agua mineral', quantity: 1, price_minor: 100 }),
        expect.objectContaining({ name: 'AGUA mineral', quantity: 1, price_minor: 100 })
      ]);
      expect(
        db
          .prepare('SELECT unit, note FROM receipt_items WHERE receipt_id = ? AND name = ?')
          .get(receiptId, 'Pan ' + 'artesano '.repeat(300).trim())
      ).toEqual({ unit: 'unidad/'.repeat(320), note: 'Detalle '.repeat(400).trim() });
      expect(db.prepare('SELECT name FROM stores WHERE user_id = ?').get(userId)).toMatchObject({
        name: 'Mercado sintético'
      });

      const manualReceiptId = 'synthetic-manual-receipt';
      db.prepare(
        `INSERT INTO receipts
          (id, user_id, status, file_url, file_kind, store, store_manual,
           purchase_date, purchase_date_manual)
         VALUES (?, ?, 'queued', ?, 'png', 'Tienda manual', 1, NULL, 1)`
      ).run(manualReceiptId, userId, fileUrl);
      const manualAnswer = {
        lines: [],
        store: 'Tienda inventada por IA',
        purchaseDate: '2020-12-01',
        currency: 'EUR',
        totalMinor: 0,
        warnings: []
      };
      const manualFrames = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(manualAnswer) } }] })}\n\n`,
        'data: [DONE]\n\n'
      ].join('');
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(manualFrames));
              controller.close();
            }
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      );
      const manualJobId = encolarTicket(db, userId, manualReceiptId);
      await waitFor(() => jobRow(manualJobId).status === 'done');
      expect(
        db.prepare('SELECT store, purchase_date FROM receipts WHERE id = ?').get(manualReceiptId)
      ).toEqual({ store: 'Tienda manual', purchase_date: null });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM stores WHERE name = ?').get('Tienda inventada por IA')
      ).toEqual({ n: 0 });
    } finally {
      stopWorker();
      process.env.DATABASE_PATH = originalDatabasePath ?? ':memory:';
      rmSync(isolatedDirectory, { recursive: true, force: true });
    }
  });

  it('includes the fresh household inventory as JSON beside JPEG input', async () => {
    const originalDatabasePath = process.env.DATABASE_PATH;
    const isolatedDirectory = mkdtempSync(join(tmpdir(), 'hogaria-ai-queue-jpeg-inventory-'));
    const { encolarTicket, stopWorker } = await import('./ticket-queue.js');
    try {
      process.env.DATABASE_PATH = join(isolatedDirectory, 'database.sqlite');
      seedMovedInventoryProduct();
      const { storeTicket, uploadsRoot } = await import('./uploads.js');
      const fileUrl = storeTicket(
        'synthetic-jpeg-inventory-ticket',
        Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        'jpeg',
        uploadsRoot()
      );
      const receiptId = 'synthetic-jpeg-inventory-receipt';
      const answer = {
        lines: [],
        store: null,
        purchaseDate: null,
        currency: 'EUR',
        totalMinor: null,
        warnings: []
      };
      const encoder = new TextEncoder();
      const frames = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(answer) } }] })}\n\n`,
        'data: [DONE]\n\n'
      ].join('');
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(frames));
              controller.close();
            }
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      );
      db.prepare(
        `INSERT INTO receipts (id, user_id, status, file_url, file_kind)
         VALUES (?, ?, 'queued', ?, 'jpeg')`
      ).run(receiptId, userId, fileUrl);

      const jobId = encolarTicket(db, userId, receiptId);
      await waitFor(() => jobRow(jobId).status === 'done');
      const request = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
      expect(request.response_format).toEqual(RECEIPT_RESPONSE_FORMAT);
      const userMessage = request.messages.find(({ role }: { role: string }) => role === 'user');
      const parts = userMessage.content as Array<{
        type?: string;
        text?: string;
        file?: { filename?: string; file_data?: string };
        image_url?: { url?: string };
      }>;
      const textParts = parts.filter(({ type }) => type === 'text');
      expect(textParts).toHaveLength(1);
      expect(textParts[0]?.text).toContain('inventario.json');
      expect(textParts[0]?.text).toContain('adjunto');
      const inventoryFilePart = parts.find(
        ({ type, file }) => type === 'file' && file?.filename === 'inventario.json'
      );
      expect(inventoryFilePart?.file?.file_data?.startsWith('data:application/json;base64,')).toBe(
        true
      );
      const inventoryBase64 = inventoryFilePart?.file?.file_data?.replace(
        'data:application/json;base64,',
        ''
      );
      expect(inventoryBase64).toBeTruthy();
      const inventory = JSON.parse(Buffer.from(inventoryBase64!, 'base64').toString('utf8')) as {
        productos: { categoria: string; nombre: string; unidad: string }[];
      };
      expect(inventory.productos).toContainEqual({
        categoria: 'dairy',
        nombre: 'Leche semidesnatada',
        unidad: 'l'
      });
      expect(parts.filter(({ type }) => type === 'file')).toHaveLength(1);
      expect(
        parts
          .find(({ type }) => type === 'image_url')
          ?.image_url?.url?.startsWith('data:image/jpeg;base64,')
      ).toBe(true);
    } finally {
      stopWorker();
      process.env.DATABASE_PATH = originalDatabasePath ?? ':memory:';
      rmSync(isolatedDirectory, { recursive: true, force: true });
    }
  });

  it('preserves metadata edited during analysis while filling untouched metadata from the provider', async () => {
    const originalDatabasePath = process.env.DATABASE_PATH;
    const isolatedDirectory = mkdtempSync(join(tmpdir(), 'hogaria-ai-queue-active-metadata-'));
    const providerStarted = deferred();
    const releaseProvider = deferred();
    const { encolarTicket, stopWorker } = await import('./ticket-queue.js');
    try {
      process.env.DATABASE_PATH = join(isolatedDirectory, 'database.sqlite');
      const { parseImageDataUrl, storeImage, uploadsRoot } = await import('./uploads.js');
      const image = parseImageDataUrl('data:image/png;base64,iVBORw0KGgo=');
      expect(image).not.toBeNull();
      const fileUrl = storeImage('receipts', 'synthetic-active-metadata', image!, uploadsRoot());
      const receiptId = 'synthetic-active-metadata';
      const finalAnswer = {
        lines: [],
        store: 'Tienda detectada por IA',
        purchaseDate: '2024-02-29',
        currency: 'EUR',
        totalMinor: 0,
        warnings: []
      };
      const frames = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(finalAnswer) } }] })}\n\n`,
        'data: [DONE]\n\n'
      ].join('');
      const encoder = new TextEncoder();
      // The first streaming and non-streaming request both fail so the queue really retries.
      vi.mocked(fetch).mockRejectedValueOnce(new Error('synthetic transient stream failure'));
      vi.mocked(fetch).mockRejectedValueOnce(new Error('synthetic transient fallback failure'));
      vi.mocked(fetch).mockImplementationOnce(async () => {
        providerStarted.resolve();
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              await releaseProvider.promise;
              controller.enqueue(encoder.encode(frames));
              controller.close();
            }
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        );
      });
      db.prepare(
        `INSERT INTO receipts (id, user_id, status, file_url, file_kind)
         VALUES (?, ?, 'queued', ?, 'png')`
      ).run(receiptId, userId, fileUrl);

      const jobId = encolarTicket(db, userId, receiptId);
      await providerStarted.promise;
      expect(jobRow(jobId)).toMatchObject({ status: 'running', attempts: 2 });
      expect(db.prepare('SELECT status FROM receipts WHERE id = ?').get(receiptId)).toEqual({
        status: 'analyzing'
      });

      // Equivalent to the authorized metadata PATCH while the provider stream is still pending.
      db.prepare('UPDATE receipts SET store = ?, store_manual = 1 WHERE id = ?').run(
        'Tienda corregida durante análisis',
        receiptId
      );
      releaseProvider.resolve();
      await waitFor(() => jobRow(jobId).status === 'done');

      const requestBodies = vi
        .mocked(fetch)
        .mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
      expect(requestBodies.slice(0, 3).map(({ response_format }) => response_format)).toEqual([
        RECEIPT_RESPONSE_FORMAT,
        RECEIPT_RESPONSE_FORMAT,
        RECEIPT_RESPONSE_FORMAT
      ]);
      expect(requestBodies.slice(0, 3).map(({ stream }) => stream)).toEqual([
        true,
        undefined,
        true
      ]);

      expect(
        db.prepare('SELECT status, store, purchase_date FROM receipts WHERE id = ?').get(receiptId)
      ).toEqual({
        status: 'review',
        store: 'Tienda corregida durante análisis',
        purchase_date: '2024-02-29'
      });
      expect(db.prepare('SELECT name FROM stores WHERE user_id = ?').get(userId)).toEqual({
        name: 'Tienda corregida durante análisis'
      });
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM stores WHERE name = ?').get('Tienda detectada por IA')
      ).toEqual({ n: 0 });
    } finally {
      releaseProvider.resolve();
      stopWorker();
      process.env.DATABASE_PATH = originalDatabasePath ?? ':memory:';
      rmSync(isolatedDirectory, { recursive: true, force: true });
    }
  });

  it('keeps a failed connection check available for a manual retry after automatic attempts', async () => {
    const { dispatchPingDeConexion, queueForConfig, reintentarTrabajo } =
      await import('./ticket-queue.js');
    const fakeFetch = vi.mocked(fetch);
    fakeFetch.mockResolvedValueOnce(new Response('synthetic unavailable', { status: 503 }));
    fakeFetch.mockResolvedValueOnce(new Response('synthetic unavailable', { status: 503 }));
    fakeFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"status":"ok","message":"recovered"}' } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = dispatchPingDeConexion(
      { base_url: config.base_url, api_key: config.api_key, model: config.model },
      { db, userId, config, configId: config.id }
    );
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM ai_jobs WHERE kind = ?').get('connection_test') as
        { status: string } | undefined;
      return row?.status === 'failed';
    });

    const failedId = String(
      (db.prepare('SELECT id FROM ai_jobs WHERE kind = ?').get('connection_test') as { id: string })
        .id
    );
    expect(
      queueForConfig(db, userId, config.id).find((job) => job.id === failedId)?.retryable
    ).toBe(true);
    expect(reintentarTrabajo(db, userId, config.id, failedId)).toBe('queued');
    await expect(result).resolves.toMatchObject({ ok: true, message: 'recovered' });
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(jobRow(failedId)).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('settles a failed connection check with its last verdict when its manager closes', async () => {
    const { dispatchPingDeConexion, cerrarVentanasReintentoConfiguracion } =
      await import('./ticket-queue.js');
    const noRetryConfig = { ...config, retry_attempts: 0 };
    vi.mocked(fetch).mockResolvedValue(new Response('synthetic unavailable', { status: 503 }));
    const result = dispatchPingDeConexion(
      {
        base_url: noRetryConfig.base_url,
        api_key: noRetryConfig.api_key,
        model: noRetryConfig.model
      },
      { db, userId, config: noRetryConfig, configId: noRetryConfig.id }
    );
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM ai_jobs WHERE kind = ?').get('connection_test') as
        { status: string } | undefined;
      return row?.status === 'failed';
    });

    cerrarVentanasReintentoConfiguracion(db, userId, config.id, 'CONFIG_DISABLED');
    await expect(result).resolves.toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('cancels only the jobs belonging to the deactivated provider', async () => {
    const { submitAiTask, cancelarColaDeConfiguracion, stopWorker } =
      await import('./ticket-queue.js');
    const started = deferred();
    const running = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.deactivate.running',
      run: async (_fixed, signal) => {
        started.resolve();
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      }
    });
    const queued = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.deactivate.queued',
      run: async () => 'not run'
    });
    await started.promise;

    expect(cancelarColaDeConfiguracion(db, userId, config.id)).toEqual({
      cancelados: 1,
      detenidos: 1
    });
    stopWorker();
    await expect(running.result).rejects.toThrow();
    await expect(queued.result).rejects.toThrow();
    expect(jobRow(running.id).status).toBe('stopped');
    expect(jobRow(queued.id).status).toBe('stopped');
  });

  it('cancels an already-aborted request before its provider closure can run', async () => {
    const { submitAiTask } = await import('./ticket-queue.js');
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async (_fixed: AiConfig | null, _signal: AbortSignal) => 'should not run');

    const job = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.pre-abort',
      run,
      externalSignal: controller.signal
    });

    await expect(job.result).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(jobRow(job.id)).toMatchObject({ status: 'stopped', error_code: 'CANCELLED' });
  });

  it('keeps legacy receipt retries and individual stop backed by the shared job state', async () => {
    const { pararTrabajo, reencolar, stopWorker, submitAiTask } = await import('./ticket-queue.js');
    db.prepare(
      `INSERT INTO receipts (id, user_id, status, file_url, file_kind, error_code, ai_output_language)
       VALUES ('legacy-retry', ?, 'failed', '/uploads/legacy.png', 'png', 'PROVIDER', 'en')`
    ).run(userId);
    db.prepare(
      `INSERT INTO ai_jobs (id, user_id, config_id, kind, receipt_id, status, attempts, max_attempts, error_code)
       VALUES ('legacy-retry-job', ?, ?, 'receipt', 'legacy-retry', 'failed', 2, 2, 'PROVIDER')`
    ).run(userId, config.id);

    expect(reencolar('legacy-retry-job')).toBe(true);
    expect(
      db.prepare('SELECT ai_output_language FROM receipts WHERE id = ?').get('legacy-retry')
    ).toEqual({ ai_output_language: 'en' });
    stopWorker();
    expect(jobRow('legacy-retry-job')).toMatchObject({
      status: 'queued',
      attempts: 0,
      max_attempts: 2
    });
    expect(
      db.prepare('SELECT status, error_code FROM receipts WHERE id = ?').get('legacy-retry')
    ).toMatchObject({ status: 'queued', error_code: null });
    expect(pararTrabajo('legacy-retry-job')).toBe(true);
    expect(pararTrabajo('missing-job')).toBe(false);
    expect(jobRow('legacy-retry-job')).toMatchObject({
      status: 'stopped',
      error_code: 'CANCELLED'
    });

    const started = deferred();
    const volatile = submitAiTask({
      db,
      userId,
      config: null,
      configId: null,
      kind: 'test.legacy-stop',
      run: async (_fixed, signal) => {
        started.resolve();
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      }
    });
    await started.promise;
    expect(pararTrabajo(volatile.id)).toBe(true);
    stopWorker();
    await expect(volatile.result).rejects.toThrow();
    expect(jobRow(volatile.id)).toMatchObject({ status: 'stopped', error_code: 'CANCELLED' });
  });

  it('stops and counts running/queued jobs across provider-bound and volatile queues', async () => {
    const { submitAiTask, pararTodo } = await import('./ticket-queue.js');
    const started = deferred();
    const volatile = submitAiTask({
      db,
      userId,
      config: null,
      configId: null,
      kind: 'test.stop-all.running',
      run: async (_fixed, signal) => {
        started.resolve();
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
      }
    });
    await started.promise;
    db.prepare(
      `INSERT INTO ai_jobs (id, user_id, config_id, kind, status, max_attempts)
       VALUES ('volatile-queued', ?, NULL, 'recipe', 'queued', 1),
         ('provider-running', ?, 'config-a', 'recipe', 'running', 1),
         ('provider-queued', ?, 'config-a', 'recipe', 'queued', 1)`
    ).run(userId, userId, userId);

    expect(pararTodo(userId)).toEqual({ cancelados: 2, detenidos: 2 });
    await expect(volatile.result).rejects.toThrow();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE status = 'stopped'").get()
    ).toMatchObject({ n: 4 });
    expect(pararTodo(userId)).toEqual({ cancelados: 0, detenidos: 0 });
  });

  it('applies retryAttempts as retries after the first attempt and supports a new manual retry cycle', async () => {
    const { submitAiTask, reintentarTrabajo } = await import('./ticket-queue.js');
    let calls = 0;
    const job = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.retry',
      run: async () => {
        calls += 1;
        if (calls <= 2) throw Object.assign(new Error('provider error'), { code: 'PROVIDER' });
        return 'recovered';
      }
    });
    await waitFor(() => jobRow(job.id).status === 'failed');
    expect(calls).toBe(2);
    expect(jobRow(job.id)).toMatchObject({ status: 'failed', attempts: 2, max_attempts: 2 });
    const { queueForConfig } = await import('./ticket-queue.js');
    expect(
      queueForConfig(db, userId, 'config-a').find((entry) => entry.id === job.id)?.retryable
    ).toBe(true);

    await reintentarTrabajo(db, userId, 'config-a', job.id);
    // The retry keeps the original in-memory operation and starts a fresh attempt budget.
    await expect(job.result).resolves.toBe('recovered');
    expect(calls).toBe(3);
    expect(jobRow(job.id).attempts).toBe(1);
  });

  it('cancels a running provider fetch using the job AbortSignal', async () => {
    const { submitAiTask, cancelarTrabajo } = await import('./ticket-queue.js');
    const started = deferred<AbortSignal>();
    const job = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.cancel',
      run: async (_fixedConfig, signal) => {
        started.resolve(signal);
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
    });
    const signal = await started.promise;
    await cancelarTrabajo(db, userId, 'config-a', job.id);

    expect(signal.aborted).toBe(true);
    await expect(job.result).rejects.toThrow();
    expect(jobRow(job.id).status).toBe('stopped');
  });

  it('marks queued generic jobs from a prior process as expired without restoring their payload', async () => {
    const { barrerArranque, queueForConfig, reintentarTrabajo } = await import('./ticket-queue.js');
    db.prepare(
      `INSERT INTO ai_jobs (id, user_id, config_id, kind, status, max_attempts)
       VALUES ('old-generic', ?, 'config-a', 'recipe', 'queued', 2)`
    ).run(userId);

    expect(barrerArranque(db)).toBe(1);
    expect(jobRow('old-generic')).toMatchObject({ status: 'failed', error_code: 'INPUT_EXPIRED' });
    expect(
      queueForConfig(db, userId, 'config-a').find((job) => job.id === 'old-generic')?.retryable
    ).toBe(false);
    expect(reintentarTrabajo(db, userId, 'config-a', 'old-generic')).toBe('input-expired');
  });

  it('requeues a running receipt after a single-process restart even when its lease is still future', async () => {
    const { barrerArranque } = await import('./ticket-queue.js');
    db.prepare(
      `INSERT INTO receipts (id, user_id, status, file_url, file_kind, ai_output_language)
       VALUES ('receipt-restart', ?, 'analyzing', '/uploads/receipt-restart.png', 'png', 'en')`
    ).run(userId);
    db.prepare(
      `INSERT INTO ai_jobs (id, user_id, config_id, kind, receipt_id, status, lease_until, claim_generation)
       VALUES ('receipt-job-restart', ?, 'config-a', 'receipt', 'receipt-restart', 'running',
         datetime('now', '+1 hour'), 4)`
    ).run(userId);

    expect(barrerArranque(db)).toBe(1);
    expect(jobRow('receipt-job-restart')).toMatchObject({ status: 'queued', claim_generation: 5 });
    expect(
      db
        .prepare('SELECT status, ai_output_language FROM receipts WHERE id = ?')
        .get('receipt-restart')
    ).toMatchObject({ status: 'queued', ai_output_language: 'en' });
  });

  it('ignores a late provider result after cancel and a new claim of the same job id', async () => {
    const { submitAiTask, cancelarTrabajo } = await import('./ticket-queue.js');
    const finishOldProviderCall = deferred<string>();
    const job = submitAiTask({
      db,
      userId,
      config,
      kind: 'test.stale-result',
      run: async () => finishOldProviderCall.promise
    });
    await waitFor(() => jobRow(job.id).status === 'running');
    const oldClaim = jobRow(job.id).claim_generation;
    expect(typeof oldClaim).toBe('number');

    await cancelarTrabajo(db, userId, 'config-a', job.id);
    await expect(job.result).rejects.toThrow();
    expect(jobRow(job.id).claim_generation).toBeGreaterThan(oldClaim);

    // Simulate a ticket requeue/new claim before a provider that ignored abort resolves.
    db.prepare(
      `UPDATE ai_jobs SET status = 'running', claim_generation = ?, attempts = attempts + 1
       WHERE id = ? AND status = 'stopped'`
    ).run(jobRow(job.id).claim_generation + 1, job.id);
    finishOldProviderCall.resolve('stale result');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(jobRow(job.id).status).toBe('running');
    expect(jobRow(job.id).claim_generation).toBeGreaterThan(oldClaim);
  });
});
