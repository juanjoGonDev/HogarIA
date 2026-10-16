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
  it('uses Ollama JSON mode with the exact server schema only for loopback Ollama', async () => {
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

    expect(requestBody?.response_format).toEqual({ type: 'json_object' });
    expect(requestBody?.messages[0].content).toContain(
      JSON.stringify(responseFormat.json_schema.schema)
    );
    expect(requestBody?.messages[1].content).toBe('Synthetic prompt.');
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
