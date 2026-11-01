import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAssistantAITransient } from './ai-assistant-runtime.js';
import type { AiConfigRow } from './ai-client.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
let db: Sql;
let closeDatabase: () => void;

const responseFormat = {
  type: 'json_schema' as const,
  json_schema: { name: 'test', strict: true as const, schema: { type: 'object' } }
};

function response(content: string, id = 'resp_assistant'): Response {
  return new Response(
    JSON.stringify({
      id,
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }]
    }),
    { status: 200 }
  );
}

function insertConfig(
  userId: string,
  id = `${userId}-assistant-config`,
  overrides: Partial<AiConfigRow> = {}
): AiConfigRow {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      userId,
      `${userId}@assistant.test`,
      userId,
      'hash'
    );
  }
  db.prepare(
    `INSERT INTO ai_configs
      (id, user_id, name, provider, base_url, api_key, model, temperature, max_tokens, top_p,
       frequency_penalty, presence_penalty, timeout, retry_attempts, concurrency, is_active)
     VALUES (?, ?, 'Local test', 'custom', ?, 'test-key', 'test-model', NULL, 500, NULL,
       NULL, NULL, 1000, 1, 1, 1)`
  ).run(id, userId, overrides.base_url ?? 'http://localhost:1234/v1');
  return db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(id) as AiConfigRow;
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
});

beforeEach(async () => {
  const { stopWorker } = await import('./ticket-queue.js');
  stopWorker();
  db.exec(
    'DELETE FROM household_members; DELETE FROM ai_jobs; DELETE FROM ai_configs; DELETE FROM users; DELETE FROM households;'
  );
});

afterEach(async () => {
  const { stopWorker } = await import('./ticket-queue.js');
  stopWorker();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  const { stopWorker } = await import('./ticket-queue.js');
  stopWorker();
  closeDatabase?.();
});

describe('callAssistantAITransient', () => {
  it('passes the server JSON Schema to loopback Ollama without duplicating it in the prompt', async () => {
    let requestBody: Record<string, any> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return response('{"ok":true}');
      })
    );

    await expect(
      callAssistantAITransient({
        userId: 'u-ollama',
        config: insertConfig('u-ollama', 'ollama-config', {
          base_url: 'http://127.0.0.1:11434/v1'
        }),
        messages: [
          { role: 'system', content: 'System contract.' },
          { role: 'user', content: 'Synthetic prompt.' }
        ],
        responseFormat
      })
    ).resolves.toBe('{"ok":true}');

    expect(requestBody).toMatchObject({ background: true, store: true });
    expect(requestBody?.text?.format).toEqual({
      type: 'json_schema',
      name: 'test',
      strict: true,
      schema: { type: 'object' }
    });
    expect(requestBody?.input).toEqual([
      { role: 'system', content: 'System contract.' },
      { role: 'user', content: 'Synthetic prompt.' }
    ]);
  });

  it('simplifies Ollama constraints without dropping action payload structure', async () => {
    let requestBody: Record<string, any> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return response('{"ok":true}');
      })
    );
    const actionPlanFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'ai_action_plan',
        strict: true as const,
        schema: {
          type: 'object',
          properties: {
            actions: {
              type: 'array',
              items: {
                anyOf: [
                  {
                    type: 'object',
                    properties: {
                      kind: { type: 'string', const: 'pantry.add_ingredient' },
                      payload: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', minLength: 1 },
                          quantity: { type: 'number' },
                          unit: { type: 'string', enum: ['g', 'kg'] },
                          expirationDate: {
                            anyOf: [
                              { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
                              { type: 'null' }
                            ]
                          }
                        },
                        required: ['name', 'quantity', 'unit', 'expirationDate'],
                        additionalProperties: false
                      }
                    },
                    required: ['kind', 'payload'],
                    additionalProperties: false
                  },
                  {
                    type: 'object',
                    properties: {
                      kind: { type: 'string', const: 'shopping.create_list' },
                      payload: { type: 'object', properties: { name: { type: 'string' } } }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    };

    await callAssistantAITransient({
      userId: 'u-ollama-plan',
      config: insertConfig('u-ollama-plan', 'ollama-plan-config', {
        base_url: 'http://127.0.0.1:11434/v1'
      }),
      messages: [
        { role: 'system', content: 'System contract.' },
        { role: 'user', content: 'Synthetic prompt.' }
      ],
      responseFormat: actionPlanFormat
    });

    expect(requestBody?.reasoning).toEqual({ effort: 'none' });
    const actionUnion = requestBody?.text.format.schema.properties.actions.items.anyOf;
    expect(actionUnion).toHaveLength(2);
    expect(actionUnion[0].properties.kind).toEqual({
      type: 'string',
      const: 'pantry.add_ingredient'
    });
    expect(actionUnion[0].properties.payload.properties).toMatchObject({
      name: { type: 'string' },
      unit: { type: 'string', enum: ['g', 'kg'] },
      expirationDate: { anyOf: [{ type: 'string' }, { type: 'null' }] }
    });
    expect(actionUnion[0].properties.payload.properties.name).not.toHaveProperty('minLength');
    expect(actionUnion[0].properties.payload.properties.expirationDate.anyOf[0]).not.toHaveProperty(
      'pattern'
    );
    expect(requestBody?.input).toEqual([
      { role: 'system', content: 'System contract.' },
      { role: 'user', content: 'Synthetic prompt.' }
    ]);
  });

  it('keeps strict provider response formats for non-loopback custom endpoints', async () => {
    let requestBody: Record<string, any> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return response('{"ok":true}');
      })
    );

    await callAssistantAITransient({
      userId: 'u-custom',
      config: insertConfig('u-custom'),
      messages: [{ role: 'system', content: 'System contract.' }],
      responseFormat
    });

    expect(requestBody?.text.format).toEqual({
      type: 'json_schema',
      name: 'test',
      strict: true,
      schema: { type: 'object' }
    });
    expect(requestBody?.input).toEqual([{ role: 'system', content: 'System contract.' }]);
    expect(requestBody?.reasoning).toBeUndefined();
  });

  it('gates one request per user/provider and releases the gate after completion', async () => {
    let enterFetch!: () => void;
    let releaseFetch!: () => void;
    const fetchEntered = new Promise<void>((resolve) => (enterFetch = resolve));
    const fetchGate = new Promise<void>((resolve) => (releaseFetch = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        enterFetch();
        await fetchGate;
        return response('{"ok":true}');
      })
    );

    const config = insertConfig('u1');
    const otherConfig = insertConfig('u1', 'other-config');
    const first = callAssistantAITransient({
      userId: 'u1',
      config,
      messages: [{ role: 'user', content: 'one' }],
      responseFormat
    });
    await fetchEntered;

    await expect(
      callAssistantAITransient({
        userId: 'u1',
        config: otherConfig,
        messages: [{ role: 'user', content: 'two' }],
        responseFormat
      })
    ).rejects.toMatchObject({ detail: 'ASSISTANT_BUSY' });
    await expect(
      callAssistantAITransient({
        userId: 'u2',
        config,
        messages: [{ role: 'user', content: 'three' }],
        responseFormat
      })
    ).rejects.toMatchObject({ detail: 'ASSISTANT_BUSY' });

    releaseFetch();
    await expect(first).resolves.toBe('{"ok":true}');
    await expect(
      callAssistantAITransient({
        userId: 'u1',
        config,
        messages: [{ role: 'user', content: 'retry' }],
        responseFormat
      })
    ).resolves.toBe('{"ok":true}');
  });

  it('runs the provider with an independent server-owned signal', async () => {
    let enterFetch!: () => void;
    let releaseFetch!: () => void;
    let transportSignal: AbortSignal | undefined;
    const fetchEntered = new Promise<void>((resolve) => (enterFetch = resolve));
    const fetchGate = new Promise<void>((resolve) => (releaseFetch = resolve));
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      transportSignal = init?.signal ?? undefined;
      enterFetch();
      await fetchGate;
      return response('{"ok":true}');
    });
    vi.stubGlobal('fetch', fetch);
    const pending = callAssistantAITransient({
      userId: 'u-aborted',
      config: insertConfig('u-aborted'),
      messages: [{ role: 'user', content: 'still running' }],
      responseFormat
    });
    await fetchEntered;
    expect(transportSignal?.aborted).toBe(false);
    releaseFetch();
    await expect(pending).resolves.toBe('{"ok":true}');
  });
});
