import { afterEach, describe, expect, it, vi } from 'vitest';
import { callAssistantAITransient } from './ai-assistant-runtime.js';
import type { AiConfigRow } from './ai-client.js';

const config: AiConfigRow = {
  id: 'assistant-config',
  name: 'Local test',
  provider: 'custom',
  base_url: 'http://localhost:1234/v1',
  api_key: 'test-key',
  model: 'test-model',
  temperature: null,
  max_tokens: 500,
  top_p: null,
  frequency_penalty: null,
  presence_penalty: null,
  timeout: 1_000,
  concurrency: 1
};

const responseFormat = {
  type: 'json_schema' as const,
  json_schema: { name: 'test', strict: true as const, schema: { type: 'object' } }
};

function response(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

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
        config: { ...config, base_url: 'http://127.0.0.1:11434/v1' },
        messages: [
          { role: 'system', content: 'System contract.' },
          { role: 'user', content: 'Synthetic prompt.' }
        ],
        responseFormat
      })
    ).resolves.toBe('{"ok":true}');

    expect(requestBody?.response_format).toEqual(responseFormat);
    expect(requestBody?.messages).toEqual([
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
      config: { ...config, base_url: 'http://127.0.0.1:11434/v1' },
      messages: [
        { role: 'system', content: 'System contract.' },
        { role: 'user', content: 'Synthetic prompt.' }
      ],
      responseFormat: actionPlanFormat
    });

    expect(requestBody?.reasoning_effort).toBe('none');
    const actionUnion =
      requestBody?.response_format.json_schema.schema.properties.actions.items.anyOf;
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
    expect(requestBody?.messages).toEqual([
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
      config,
      messages: [{ role: 'system', content: 'System contract.' }],
      responseFormat
    });

    expect(requestBody?.response_format).toEqual(responseFormat);
    expect(requestBody?.messages).toEqual([{ role: 'system', content: 'System contract.' }]);
    expect(requestBody?.reasoning_effort).toBeUndefined();
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
        config: { ...config, id: 'other-config' },
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

  it('rejects an already-aborted request before network access', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();

    await expect(
      callAssistantAITransient({
        userId: 'u-aborted',
        config,
        messages: [{ role: 'user', content: 'cancelled' }],
        responseFormat,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ detail: 'CANCELLED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
