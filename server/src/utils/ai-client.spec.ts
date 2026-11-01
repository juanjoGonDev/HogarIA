import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiCallError,
  activeAiConfig,
  callAI as queuedCallAI,
  callAIWithConfig as callAITransportRaw,
  callAIStreaming as queuedCallAIStreaming,
  callAIStreamingWithConfig as callAIStreamingTransportRaw,
  endpoint,
  extractJsonObject,
  pingDeConexionTransport
} from './ai-client.js';
import type { AiResponseFormat } from '../schemas/ai-response-format.js';
import type { AiConfigRow } from './ai-client.js';

/**
 * El unico sitio que habla con un proveedor de IA tiene que fallar con nombres y
 * apellidos: «no hay configuracion», «el proveedor ha contestado mal» y «el modelo
 * no ha contestado JSON» son tres pantallas distintas para quien esta delante.
 *
 * No se toca la red: `globalThis.fetch` se sustituye por una funcion, que es lo que
 * el server usa de todas formas (fetch nativo de Node), y asi se puede ver tambien
 * el body que sale.
 */

function dbWith(rows: Record<string, any[]>) {
  return {
    prepare: (sql: string) => ({
      get: (...params: unknown[]) => {
        const table = /FROM (\w+)/.exec(sql)?.[1] ?? '';
        const list = rows[table] ?? [];
        if (table === 'ai_configs') {
          const [userId] = params as string[];
          return list.find((row) => row.user_id === userId && row.is_active === 1);
        }
        return list[0];
      },
      all: () => [],
      run: () => ({ changes: 0 })
    })
  } as any;
}

const CONFIG = {
  id: 'ai-1',
  user_id: 'u-1',
  is_active: 1,
  name: 'Local',
  provider: 'openai',
  base_url: 'https://ai.local/v1/',
  api_key: 'clave',
  model: 'gpt-vision',
  temperature: 0.2,
  max_tokens: 900,
  top_p: null,
  frequency_penalty: null,
  presence_penalty: null,
  timeout: 1234,
  retry_attempts: 0,
  concurrency: 0
};

const REAL_SMOKE_PROVIDER_KEY_MARKER = '__HOGARIA_AI_REAL_SMOKE_PROVIDER_KEY__';
const REAL_SMOKE_PROXY_URL = 'http://127.0.0.1:3001/v1';
const REAL_SMOKE_PROXY_TOKEN = 'synthetic-real-smoke-proxy-token';
const TEST_RESPONSE_FORMAT: AiResponseFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'synthetic_test',
    strict: true,
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false
    }
  }
};

function callAITransport(active: AiConfigRow, messages: any[], signal?: AbortSignal) {
  return callAITransportRaw(active, messages, TEST_RESPONSE_FORMAT, signal);
}

function callAIStreamingTransport(
  active: AiConfigRow,
  messages: any[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
  requestOptions?: { jobId?: string; reasoning_effort?: 'none' }
) {
  return callAIStreamingTransportRaw(
    active,
    messages,
    onDelta,
    TEST_RESPONSE_FORMAT,
    signal,
    requestOptions
  );
}

function responsesResult(
  id: string,
  status: string,
  text?: string,
  extra: Record<string, unknown> = {}
) {
  return new Response(
    JSON.stringify({
      id,
      status,
      output:
        text === undefined ? [] : [{ type: 'message', content: [{ type: 'output_text', text }] }],
      ...extra
    }),
    { status: status === 'queued' ? 202 : 200, headers: { 'content-type': 'application/json' } }
  );
}

function enableRealSmoke(proxyUrl = REAL_SMOKE_PROXY_URL, proxyToken = REAL_SMOKE_PROXY_TOKEN) {
  vi.stubEnv('HOGARIA_AI_REAL_SMOKE', '1');
  vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROXY_URL', proxyUrl);
  vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN', proxyToken);
}

beforeEach(() => {
  // Aisla las pruebas de cualquier configuración local de smoke sin inspeccionar sus valores.
  vi.stubEnv('E2E_EXTERNAL_STACK', '');
  vi.stubEnv('HOGARIA_AI_REAL_SMOKE', '');
  vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROXY_URL', '');
  vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN', '');
  vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('activeAiConfig', () => {
  it('solo vale la fila activa de la propia cuenta', () => {
    const db = dbWith({ ai_configs: [CONFIG, { ...CONFIG, id: 'ai-2', is_active: 0 }] });
    expect(activeAiConfig(db, 'u-1')?.id).toBe('ai-1');
    expect(activeAiConfig(db, 'otro')).toBeUndefined();
  });
});

describe('callAI', () => {
  it('envía inputs completos a Responses background, espera el resultado y vincula idempotencia al job', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responsesResult('resp_ai_1234567', 'queued'))
      .mockResolvedValueOnce(responsesResult('resp_ai_1234567', 'completed', '{"answer":"ok"}'));
    vi.stubGlobal('fetch', fetchMock);
    const diagnostics: Array<Record<string, unknown>> = [];
    const messages = [
      { role: 'system' as const, content: 'Sigue instrucciones.' },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Analiza esto' },
          {
            type: 'file' as const,
            file: { filename: 'inventario.json', file_data: 'data:application/json;base64,e30=' }
          },
          {
            type: 'image_url' as const,
            image_url: { url: 'data:image/png;base64,aW1n', detail: 'high' as const }
          }
        ]
      }
    ];

    const content = await callAITransportRaw(
      { ...CONFIG, frequency_penalty: 0.4, presence_penalty: 0.3 },
      messages,
      TEST_RESPONSE_FORMAT,
      undefined,
      {
        jobId: 'job-ai-123',
        reasoning_effort: 'none',
        onDiagnostic: (diagnostic) => diagnostics.push({ ...diagnostic })
      }
    );

    expect(content).toBe('{"answer":"ok"}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/responses');
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe(
      '/v1/responses/resp_ai_1234567'
    );
    const create = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(create.body));
    expect(body).toEqual({
      model: 'gpt-vision',
      background: true,
      store: true,
      input: [
        { role: 'system', content: 'Sigue instrucciones.' },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Analiza esto' },
            {
              type: 'input_file',
              filename: 'inventario.json',
              file_data: 'data:application/json;base64,e30='
            },
            { type: 'input_image', image_url: 'data:image/png;base64,aW1n', detail: 'high' }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'synthetic_test',
          strict: true,
          schema: TEST_RESPONSE_FORMAT.json_schema.schema
        }
      },
      max_output_tokens: 900,
      temperature: 0.2,
      reasoning: { effort: 'none' }
    });
    expect(body).not.toHaveProperty('frequency_penalty');
    expect(body).not.toHaveProperty('presence_penalty');
    expect((create.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^hogaria-ai-job-ai-123-/
    );
    expect(diagnostics.at(-1)).toMatchObject({
      providerResponseId: 'resp_ai_1234567',
      providerTransport: 'responses_background',
      diagnosticStage: 'completed'
    });
  });

  it('admite JSON object y no vuelve a Chat Completions si Responses no está disponible', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAITransportRaw(CONFIG, [{ role: 'user', content: 'JSON' }], {
      type: 'json_object'
    }).catch((reason) => reason);

    expect(error).toMatchObject({ code: 'PROVIDER', detail: 'BACKGROUND_UNSUPPORTED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/responses');
  });

  it('entrega el texto final una sola vez al callback legacy de streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(responsesResult('resp_stream_123', 'in_progress'))
        .mockResolvedValueOnce(responsesResult('resp_stream_123', 'completed', 'respuesta final'))
    );
    const deltas: string[] = [];

    const result = await callAIStreamingTransport(
      CONFIG,
      [{ role: 'user', content: 'hola' }],
      (delta) => deltas.push(delta),
      new AbortController().signal,
      { jobId: 'job-stream' }
    );

    expect(result).toBe('respuesta final');
    expect(deltas).toEqual(['respuesta final']);
  });

  it('rechaza salidas Responses incompletas por límite y refusal sin exponer su texto', async () => {
    vi.stubGlobal('fetch', async () =>
      responsesResult('resp_incomplete_1', 'incomplete', '{"answer":"ok"}', {
        incomplete_details: { reason: 'max_output_tokens' }
      })
    );
    await expect(callAITransport(CONFIG, [])).rejects.toMatchObject({
      code: 'BAD_JSON',
      detail: 'TRUNCATED'
    });

    vi.stubGlobal('fetch', async () =>
      responsesResult('resp_refusal_1', 'completed', undefined, {
        output: [
          {
            type: 'message',
            content: [{ type: 'refusal', refusal: 'private provider refusal' }]
          }
        ]
      })
    );
    const refusal = await callAITransport(CONFIG, []).catch((reason) => reason);
    expect(refusal).toMatchObject({ code: 'BAD_JSON', detail: 'REFUSED' });
    expect(refusal.message).not.toContain('private provider refusal');
  });

  it('rechaza el marcador genérico antes de fetch si el smoke no está habilitado', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAITransport(
      {
        ...CONFIG,
        base_url: REAL_SMOKE_PROXY_URL,
        api_key: REAL_SMOKE_PROVIDER_KEY_MARKER
      },
      []
    ).catch((reason) => reason);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('PROVIDER');
    expect(error.message).toBe('AI provider configuration is not available');
    expect(error.message).not.toContain(REAL_SMOKE_PROVIDER_KEY_MARKER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requiere el valor exacto 1 en el opt-in y no una verdad aproximada', async () => {
    vi.stubEnv('HOGARIA_AI_REAL_SMOKE', 'true');
    vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROXY_URL', REAL_SMOKE_PROXY_URL);
    vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN', REAL_SMOKE_PROXY_TOKEN);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAITransport(
      {
        ...CONFIG,
        base_url: REAL_SMOKE_PROXY_URL,
        api_key: REAL_SMOKE_PROVIDER_KEY_MARKER
      },
      []
    ).catch((reason) => reason);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.message).toBe('AI provider configuration is not available');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza el marcador antes de fetch si la URL no coincide exactamente', async () => {
    enableRealSmoke(`${REAL_SMOKE_PROXY_URL}/`, REAL_SMOKE_PROXY_TOKEN);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAITransport(
      {
        ...CONFIG,
        base_url: REAL_SMOKE_PROXY_URL,
        api_key: REAL_SMOKE_PROVIDER_KEY_MARKER
      },
      []
    ).catch((reason) => reason);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.message).toBe('AI provider configuration is not available');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza un proxy coincidente que no es loopback antes de fetch', async () => {
    const nonLoopback = 'https://provider.example.invalid/v1';
    enableRealSmoke(nonLoopback, REAL_SMOKE_PROXY_TOKEN);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAITransport(
      { ...CONFIG, base_url: nonLoopback, api_key: REAL_SMOKE_PROVIDER_KEY_MARKER },
      []
    ).catch((reason) => reason);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.message).toBe('AI provider configuration is not available');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechaza el marcador si falta la credencial local del proxy, antes de fetch', async () => {
    enableRealSmoke(REAL_SMOKE_PROXY_URL, '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await callAITransport(
      {
        ...CONFIG,
        base_url: REAL_SMOKE_PROXY_URL,
        api_key: REAL_SMOKE_PROVIDER_KEY_MARKER
      },
      []
    ).catch((reason) => reason);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.message).toBe('AI provider configuration is not available');
    expect(JSON.stringify(error)).not.toContain(REAL_SMOKE_PROVIDER_KEY_MARKER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resuelve el marcador solo con opt-in, proxy loopback exacto y token, y redacta el eco', async () => {
    enableRealSmoke();
    const webApiBearer = 'webapi-bearer-must-stay-out-of-the-e2e-server';
    vi.stubEnv('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN', webApiBearer);
    let authorization: string | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      authorization = (init.headers as Record<string, string>).Authorization;
      return responsesResult(
        'resp_smoke_test',
        'completed',
        `El proxy repitió ${REAL_SMOKE_PROXY_TOKEN}`
      );
    });

    const content = await callAITransport(
      {
        ...CONFIG,
        base_url: REAL_SMOKE_PROXY_URL,
        api_key: REAL_SMOKE_PROVIDER_KEY_MARKER
      },
      []
    );

    expect(authorization).toBe(`Bearer ${REAL_SMOKE_PROXY_TOKEN}`);
    expect(authorization).not.toContain(webApiBearer);
    expect(content).not.toContain(REAL_SMOKE_PROXY_TOKEN);
    expect(content).toContain('[redactado]');
  });

  it('manda la config de la UI en el body, con la barra final normalizada', async () => {
    const seen: { url: string; init: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      seen.push({ url, init });
      return responsesResult('resp_config_body', 'completed', '{"ok":true}');
    });

    const out = await callAITransport(CONFIG, [{ role: 'user', content: 'hola' }]);

    expect(out).toBe('{"ok":true}');
    // `base_url` acabado en `/` no debe producir `//responses`.
    expect(seen[0].url).toBe('https://ai.local/v1/responses');
    const body = JSON.parse(seen[0].init.body);
    expect(body).toMatchObject({
      model: 'gpt-vision',
      temperature: 0.2,
      background: true,
      store: true,
      max_output_tokens: 900,
      input: [{ role: 'user', content: 'hola' }],
      text: {
        format: {
          type: 'json_schema',
          name: 'synthetic_test',
          strict: true,
          schema: TEST_RESPONSE_FORMAT.json_schema.schema
        }
      }
    });
    expect(seen[0].init.headers.Authorization).toBe('Bearer clave');
  });

  it('sin configuracion activa NO es un error del proveedor', async () => {
    await expect(
      queuedCallAI('u-x', [], dbWith({ ai_configs: [] }), TEST_RESPONSE_FORMAT)
    ).rejects.toMatchObject({ code: 'NO_CONFIG' });
  });

  it('un 500 conserva el estado HTTP pero no expone el cuerpo arbitrario del proveedor', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('upstream exploded ' + 'x'.repeat(600), {
          status: 502,
          statusText: 'Bad Gateway'
        })
    );
    const error = await callAITransport(CONFIG, []).catch((e) => e);
    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('PROVIDER');
    expect(error.message).toContain('HTTP 502');
    expect(error.message).not.toContain('upstream exploded');
    expect(error.detail).toBe('HTTP 502');
  });

  it('no devuelve una credencial si el proveedor la repite en su respuesta HTTP', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal(
      'fetch',
      async () => new Response(`Authorization rejected: Bearer ${secret}`, { status: 401 })
    );
    const error = await callAITransport({ ...CONFIG, api_key: secret }, []).catch((e) => e);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.message).not.toContain(secret);
    expect(error.detail).not.toContain(secret);
    expect(error.detail).toBe('HTTP 401');
  });

  it('no expone la credencial si el error de transporte la incluye', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal('fetch', async () => {
      throw new Error(`request failed for ${secret}`);
    });
    const error = await callAITransport({ ...CONFIG, api_key: secret }, []).catch((e) => e);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.message).not.toContain(secret);
    expect(error.detail).not.toContain(secret);
  });

  it('una respuesta sin choices se dice como respuesta mala sin volcar payload del proveedor', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal('fetch', async () =>
      responsesResult('resp_no_text', 'completed', undefined, { api_key: secret })
    );
    const error = await callAITransport({ ...CONFIG, api_key: secret }, []).catch(
      (reason) => reason
    );
    expect(error).toBeInstanceOf(AiCallError);
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(secret);
    expect(error).toMatchObject({
      code: 'BAD_JSON'
    });
  });

  it('un cuerpo 200 que no sea JSON genera un error fijo, no el excerpt de parseo', async () => {
    const secret = 'synthetic-malformed-body-sentinel';
    vi.stubGlobal('fetch', async () => new Response(`Invalid API key: ${secret}`, { status: 200 }));
    const error = await callAITransport({ ...CONFIG, api_key: secret }, []).catch(
      (reason) => reason
    );

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('BAD_JSON');
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(secret);
    expect(error.message).toBe('Invalid AI response format');
  });

  it('redacta la clave incluso cuando el modelo la devuelve dentro de JSON valido', async () => {
    const secret = 'synthetic-valid-output-sentinel';
    vi.stubGlobal('fetch', async () =>
      responsesResult(
        'resp_secret_output',
        'completed',
        JSON.stringify({ name: `Recipe ${secret}` })
      )
    );

    const content = await callAITransport({ ...CONFIG, api_key: secret }, []);

    expect(content).not.toContain(secret);
    expect(content).toContain('[redactado]');
  });

  it('un fetch que revienta (DNS, timeout) es PROVIDER o TIMEOUT, y no se traga el motivo', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    await expect(callAITransport(CONFIG, [])).rejects.toMatchObject({
      code: 'TIMEOUT'
    });
  });
});

describe('extractJsonObject', () => {
  it('lee el objeto tal cual', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('sobrevive al ```json que tantos modelos escriben', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recorta la prosa de alrededor', () => {
    expect(extractJsonObject('Claro, aqui tienes:\n{"a":1}\n¿Te ayudo con algo más?')).toEqual({
      a: 1
    });
  });

  it('si no hay objeto, el error no conserva el texto arbitrario del modelo', () => {
    const error = (() => {
      try {
        extractJsonObject('no veo ninguna lista en la imagen');
        return null;
      } catch (e) {
        return e as AiCallError;
      }
    })();
    expect(error?.code).toBe('BAD_JSON');
    expect(error?.detail).toBeUndefined();
  });

  it('un objeto roto no se disfraza de vacio', () => {
    // Sin llave de cierre no hay ni donde mirar: BAD_JSON por ausencia de objeto...
    expect(() => extractJsonObject('{"a":')).toThrowError(/Invalid AI response format/);
    // ...y con ella pero mal formado tambien. No se copia contenido arbitrario del
    // proveedor en el detalle que luego puede persistirse o mostrarse en la UI.
    const error = (() => {
      try {
        // La llave de mas es lo que deja el greedy `\{...\}` con un JSON ya
        // inservible: el objeto «existe», pero no se puede leer.
        extractJsonObject('{"a": 1, "b": 2}}');
        return null;
      } catch (e) {
        return e as AiCallError;
      }
    })();
    expect(error?.code).toBe('BAD_JSON');
    expect(error?.detail).toBeUndefined();
    expect(error?.message).toContain('Invalid AI response format');
  });
});

type SmokeTransportConfig = Omit<typeof CONFIG, 'base_url' | 'api_key'> & {
  base_url: string;
  api_key: string;
};

const externalStackTransports: Array<{
  name: string;
  call: (config: SmokeTransportConfig) => Promise<unknown>;
  providerResponse: () => Response;
  connectionProbe?: true;
}> = [
  {
    name: 'completion',
    call: (config) => callAITransport(config, []),
    providerResponse: () => responsesResult('resp_e2e_completion', 'completed', 'respuesta')
  },
  {
    name: 'stream',
    call: (config) =>
      callAIStreamingTransport(config, [], () => undefined, new AbortController().signal),
    providerResponse: () => responsesResult('resp_e2e_stream', 'completed', 'respuesta')
  },
  {
    name: 'connection test',
    call: (config) => pingDeConexionTransport(config),
    providerResponse: () =>
      responsesResult('resp_e2e_probe', 'completed', '{"status":"ok","message":"conectado"}'),
    connectionProbe: true
  }
];

describe('guard E2E_EXTERNAL_STACK', () => {
  for (const transport of externalStackTransports) {
    it(`${transport.name}: bloquea destinos no-loopback antes de fetch sin live smoke`, async () => {
      vi.stubEnv('E2E_EXTERNAL_STACK', '1');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await transport
        .call({
          ...CONFIG,
          base_url: 'https://provider.example.invalid/v1',
          api_key: 'synthetic-e2e-config-key'
        })
        .catch((reason) => reason);

      if (transport.connectionProbe) {
        expect(result).toMatchObject({
          ok: false,
          error: 'No se pudo conectar con el proveedor'
        });
      } else {
        expect(result).toBeInstanceOf(AiCallError);
        expect((result as AiCallError).message).toBe('AI provider configuration is not available');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it(`${transport.name}: en live solo permite el proxy loopback exacto autorizado`, async () => {
      vi.stubEnv('E2E_EXTERNAL_STACK', '1');
      enableRealSmoke();
      let authorization: string | undefined;
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        authorization = (init.headers as Record<string, string>).Authorization;
        return transport.providerResponse();
      });

      const result = await transport.call({
        ...CONFIG,
        base_url: REAL_SMOKE_PROXY_URL,
        api_key: REAL_SMOKE_PROVIDER_KEY_MARKER
      });

      expect(authorization).toBe(`Bearer ${REAL_SMOKE_PROXY_TOKEN}`);
      if (transport.connectionProbe) {
        expect(result).toMatchObject({ ok: true });
      } else {
        expect(result).toBe('respuesta');
      }
    });

    it(`${transport.name}: live rechaza antes de fetch una URL distinta del proxy`, async () => {
      vi.stubEnv('E2E_EXTERNAL_STACK', '1');
      enableRealSmoke();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await transport
        .call({
          ...CONFIG,
          base_url: `${REAL_SMOKE_PROXY_URL}/`,
          api_key: 'synthetic-e2e-config-key'
        })
        .catch((reason) => reason);

      if (transport.connectionProbe) {
        expect(result).toMatchObject({
          ok: false,
          error: 'No se pudo conectar con el proveedor'
        });
      } else {
        expect(result).toBeInstanceOf(AiCallError);
        expect((result as AiCallError).message).toBe('AI provider configuration is not available');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});

describe('callAIStreaming', () => {
  it('usa Responses background y entrega el texto final una sola vez al callback legacy', async () => {
    const deltas: string[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responsesResult('resp_ticket_1', 'queued'))
      .mockResolvedValueOnce(
        responsesResult('resp_ticket_1', 'completed', '{"lines":[{"name":"Leche"}]}')
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAIStreamingTransport(
      CONFIG,
      [{ role: 'user', content: 'lee' }],
      (delta) => deltas.push(delta),
      new AbortController().signal,
      { jobId: 'ticket-job' }
    );

    expect(result).toBe('{"lines":[{"name":"Leche"}]}');
    expect(deltas).toEqual([result]);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/responses');
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      background: true,
      store: true
    });
  });

  it('sin configuración activa devuelve NO_CONFIG', async () => {
    await expect(
      queuedCallAIStreaming(
        'u-x',
        [],
        dbWith({ ai_configs: [] }),
        () => undefined,
        TEST_RESPONSE_FORMAT,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'NO_CONFIG' });
  });

  it('redacta la credencial del resultado antes de emitir el callback final', async () => {
    enableRealSmoke();
    const deltas: string[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer ' + REAL_SMOKE_PROXY_TOKEN
      );
      return responsesResult(
        'resp_secret_stream',
        'completed',
        JSON.stringify({ message: REAL_SMOKE_PROXY_TOKEN })
      );
    });

    const result = await callAIStreamingTransport(
      { ...CONFIG, base_url: REAL_SMOKE_PROXY_URL, api_key: REAL_SMOKE_PROVIDER_KEY_MARKER },
      [],
      (delta) => deltas.push(delta),
      new AbortController().signal
    );

    expect(result).not.toContain(REAL_SMOKE_PROXY_TOKEN);
    expect(deltas).toEqual([result]);
    expect(result).toContain('[redactado]');
  });

  it('un error HTTP mantiene el status y no expone el cuerpo del proveedor', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal(
      'fetch',
      async () => new Response('upstream rejected ' + secret, { status: 500 })
    );
    const error = await callAIStreamingTransport(
      { ...CONFIG, api_key: secret },
      [],
      () => undefined,
      new AbortController().signal
    ).catch((reason) => reason);
    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('PROVIDER');
    expect(error.detail).toBe('HTTP 500');
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(secret);
  });

  it('una cancelación explícita cancela el Responses remoto', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(String(init?.method ?? 'GET') + ' ' + url);
      if (url.endsWith('/cancel')) return responsesResult('resp_cancel_1', 'cancelled');
      if (String(init?.method) === 'POST') {
        return responsesResult('resp_cancel_1', 'in_progress');
      }
      controller.abort();
      throw new Error('aborted');
    });

    const error = await callAIStreamingTransport(CONFIG, [], () => undefined, controller.signal, {
      jobId: 'cancel-job'
    }).catch((reason) => reason);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('PROVIDER');
    expect(error.detail).toBe('CANCELLED');
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('/responses/resp_cancel_1/cancel');
  });

  it('un fetch que revienta con timeout es TIMEOUT', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    await expect(
      callAIStreamingTransport(CONFIG, [], () => undefined, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

// ── El endpoint tolerante y la prueba de conexion (revision a peticion del usuario) ──────

describe('endpoint', () => {
  it('la base sin camino se completa con el /v1 del convenio OpenAI-compatible', () => {
    expect(endpoint('http://localhost:8000')).toBe('http://localhost:8000/v1/responses');
  });

  it('la base que ya trae su version se respeta, barra final incluida', () => {
    expect(endpoint('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/responses');
    expect(endpoint('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/responses');
    expect(endpoint('http://x/api/v2')).toBe('http://x/api/v2/responses');
  });

  it('convierte una URL antigua completa a la ruta Responses del mismo proxy', () => {
    expect(endpoint('https://x/proxy/chat/completions')).toBe('https://x/proxy/v1/responses');
  });
});

describe('callAI: el cuerpo lleva solo lo configurado', () => {
  it('incluye el response_format JSON Schema estricto solicitado por la tarea', async () => {
    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: 'synthetic_answer',
        strict: true as const,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['answer'],
          properties: { answer: { type: 'string' } }
        }
      }
    };
    let body: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return responsesResult('resp_schema', 'completed', '{"answer":"ok"}');
    });

    await callAITransportRaw(CONFIG, [{ role: 'user', content: 'JSON' }], responseFormat);

    expect(body.text.format).toEqual({
      type: 'json_schema',
      name: responseFormat.json_schema.name,
      strict: true,
      schema: responseFormat.json_schema.schema
    });
    expect(body.background).toBe(true);
  });

  it('rechaza una respuesta truncada aunque el contenido parezca JSON completo', async () => {
    vi.stubGlobal('fetch', async () =>
      responsesResult('resp_truncated', 'incomplete', '{"answer":"ok"}', {
        incomplete_details: { reason: 'max_output_tokens' }
      })
    );
    const error = await callAITransport(CONFIG, []).catch((reason) => reason);
    expect(error).toMatchObject({ code: 'BAD_JSON', detail: 'TRUNCATED' });
  });

  it('rechaza respuestas marcadas como refusal o content-filter sin exponerlas', async () => {
    for (const output of [
      [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal text' }] }],
      [{ type: 'message', content: [{ type: 'refusal', refusal: 'filtered private text' }] }]
    ]) {
      vi.stubGlobal('fetch', async () =>
        responsesResult('resp_refusal', 'completed', undefined, { output })
      );
      const error = await callAITransport(CONFIG, []).catch((reason) => reason);
      expect(error).toMatchObject({ code: 'BAD_JSON', detail: 'REFUSED' });
      expect(error.message).not.toContain('private refusal text');
    }
  });

  it('clasifica la cancelación del cliente separada del timeout del proveedor', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    });

    const error = await callAITransport(CONFIG, [], controller.signal).catch((reason) => reason);
    expect(error).toMatchObject({ code: 'PROVIDER', detail: 'CANCELLED' });
  });

  it('los parametros en null no viajan: un proveedor estricto no recibe basura', async () => {
    let cuerpo: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      cuerpo = JSON.parse(String(init.body));
      return responsesResult('resp_null_settings', 'completed', 'ok');
    });
    await callAITransport(
      {
        ...CONFIG,
        temperature: null,
        max_tokens: null,
        top_p: null,
        frequency_penalty: null,
        presence_penalty: null
      },
      [{ role: 'user', content: 'hola' }]
    );
    vi.unstubAllGlobals();
    expect(cuerpo).toEqual({
      model: CONFIG.model,
      background: true,
      store: true,
      input: [{ role: 'user', content: 'hola' }],
      text: {
        format: {
          type: 'json_schema',
          name: 'synthetic_test',
          strict: true,
          schema: TEST_RESPONSE_FORMAT.json_schema.schema
        }
      }
    });
  });

  it('los parametros con valor si viajan', async () => {
    let cuerpo: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      cuerpo = JSON.parse(String(init.body));
      return responsesResult('resp_configured_settings', 'completed', 'ok');
    });
    await callAITransport({ ...CONFIG, temperature: 0.2, max_tokens: 500 }, [
      { role: 'user', content: 'hola' }
    ]);
    vi.unstubAllGlobals();
    expect(cuerpo.temperature).toBe(0.2);
    expect(cuerpo.max_output_tokens).toBe(500);
  });
});

describe('pingDeConexion', () => {
  const respuestaResponses = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });

  it('crea una operación Responses background idempotente y hace polling hasta completarla', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respuestaResponses({ id: 'resp_1234567', status: 'queued', output: [] }, 202)
      )
      .mockResolvedValueOnce(
        respuestaResponses({ id: 'resp_1234567', status: 'in_progress', output: [] })
      )
      .mockResolvedValueOnce(
        respuestaResponses({
          id: 'resp_1234567',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: '{"status":"ok","message":"conexión establecida"}'
                }
              ]
            }
          ]
        })
      );
    vi.stubGlobal('fetch', fetchMock);
    const diagnostics: Array<Record<string, unknown>> = [];

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x:8000',
      api_key: 'synthetic-key',
      model: 'gpt-5',
      jobId: 'job-123',
      onDiagnostic: (diagnostic) => diagnostics.push({ ...diagnostic })
    });

    expect(verdict).toMatchObject({ ok: true, message: 'conexión establecida' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/responses');
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe('/v1/responses/resp_1234567');
    expect(new URL(String(fetchMock.mock.calls[2][0])).pathname).toBe('/v1/responses/resp_1234567');
    const create = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = create.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer synthetic-key');
    expect(headers['Idempotency-Key']).toMatch(/^hogaria-ai-job-123-/);
    expect(JSON.parse(String(create.body))).toMatchObject({
      model: 'gpt-5',
      background: true,
      store: true,
      input: expect.stringContaining('Prueba de conexión'),
      text: {
        format: {
          type: 'json_schema',
          name: 'connection_test',
          strict: true,
          schema: expect.any(Object)
        }
      }
    });
    expect(diagnostics.some((item) => item.providerResponseId === 'resp_1234567')).toBe(true);
    expect(diagnostics.at(-1)).toMatchObject({
      providerTransport: 'responses_background',
      diagnosticStage: 'completed'
    });
  });

  it('no cae a Chat Completions ante un Responses no disponible', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'synthetic-key',
      model: 'm',
      jobId: 'unsupported-job'
    });

    expect(verdict).toMatchObject({
      ok: false,
      error: 'El proveedor no admite solicitudes Responses en segundo plano'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/responses');
  });

  it('devuelve un error explícito si el proveedor declara incompatible background', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        respuestaResponses({ error: { code: 'unsupported_parameter', param: 'background' } }, 400)
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAITransport(CONFIG, []).catch((reason) => reason);

    expect(result).toMatchObject({
      code: 'PROVIDER',
      detail: 'BACKGROUND_UNSUPPORTED',
      message: 'AI provider does not support Responses background requests'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'incomplete', 'cancelled'] as const)(
    'trata el estado terminal Responses %s como error seguro',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(
        respuestaResponses(
          {
            id: 'resp_1234567',
            status,
            error: { message: 'synthetic provider body secret sentinel' }
          },
          200
        )
      );
      vi.stubGlobal('fetch', fetchMock);

      const verdict = await pingDeConexionTransport({
        base_url: 'http://x/v1',
        api_key: 'synthetic-key',
        model: 'm',
        jobId: 'terminal-' + status
      });

      expect(verdict.ok).toBe(false);
      expect(verdict).not.toHaveProperty('message');
      if (!verdict.ok) {
        expect(verdict.error).not.toContain('synthetic provider body secret sentinel');
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('rechaza una respuesta completed sin texto con un error de forma seguro', async () => {
    vi.stubGlobal('fetch', async () =>
      respuestaResponses({ id: 'resp_1234567', status: 'completed', output: [] })
    );

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'synthetic-key',
      model: 'm',
      jobId: 'malformed-response'
    });

    expect(verdict).toMatchObject({
      ok: false,
      error: 'La respuesta del proveedor no tiene la forma esperada (Responses output)'
    });
  });

  it('un callback de streaming heredado recibe solo el texto final una vez', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respuestaResponses({ id: 'resp_1234567', status: 'in_progress', output: [] }, 202)
      )
      .mockResolvedValueOnce(
        respuestaResponses({
          id: 'resp_1234567',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: '{"status":"ok","message":"conexión establecida"}' }
              ]
            }
          ]
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'synthetic-key',
      model: 'm',
      // Omitir jobId también debe seguir el mismo flujo background.
      onDiagnostic: () => undefined
    });

    expect(verdict.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/responses');
  });

  it('resuelve el token local y lo redacta del mensaje de éxito', async () => {
    enableRealSmoke();
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer ' + REAL_SMOKE_PROXY_TOKEN
      );
      return responsesResult(
        'resp_probe_secret',
        'completed',
        JSON.stringify({ status: 'ok', message: 'eco ' + REAL_SMOKE_PROXY_TOKEN })
      );
    });

    const verdict = await pingDeConexionTransport({
      base_url: REAL_SMOKE_PROXY_URL,
      api_key: REAL_SMOKE_PROVIDER_KEY_MARKER,
      model: 'm'
    });

    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.message).not.toContain(REAL_SMOKE_PROXY_TOKEN);
      expect(verdict.message).toContain('[redactado]');
    }
  });

  it('un marcador sin opt-in falla sin iniciar fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const verdict = await pingDeConexionTransport({
      base_url: REAL_SMOKE_PROXY_URL,
      api_key: REAL_SMOKE_PROVIDER_KEY_MARKER,
      model: 'm'
    });

    expect(verdict).toMatchObject({
      ok: false,
      error: 'No se pudo conectar con el proveedor'
    });
    expect(JSON.stringify(verdict)).not.toContain(REAL_SMOKE_PROVIDER_KEY_MARKER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un cuerpo HTML no se copia al error seguro de conexión', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<html>Bad Gateway</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
    );

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'k',
      model: 'm'
    });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain('no tiene la forma esperada');
  });

  it('un HTTP error conserva el status y nunca revela el cuerpo del proveedor', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal('fetch', async () => new Response('Invalid API key: ' + secret, { status: 401 }));

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: secret,
      model: 'm'
    });

    expect(verdict).toMatchObject({ ok: false, error: 'HTTP 401' });
    expect(JSON.stringify(verdict)).not.toContain(secret);
  });

  it('la red caída es un error seguro, no una excepción', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('fetch failed');
    });

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'k',
      model: 'm'
    });

    expect(verdict.ok).toBe(false);
  });

  it('cancela en el proveedor cuando la señal explícita del job se aborta durante polling', async () => {
    const controller = new AbortController();
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET');
      calls.push({ url, method });
      if (url.endsWith('/responses/resp_1234567/cancel')) {
        return respuestaResponses({ id: 'resp_1234567', status: 'cancelled' });
      }
      if (method === 'POST') {
        return respuestaResponses({ id: 'resp_1234567', status: 'in_progress', output: [] }, 202);
      }
      controller.abort();
      throw new Error('aborted');
    });
    vi.stubGlobal('fetch', fetchMock);

    const verdict = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'synthetic-key',
      model: 'm',
      jobId: 'cancelled-job',
      signal: controller.signal
    });

    expect(verdict).toMatchObject({ ok: false, error: 'Prueba cancelada' });
    expect(calls.map((call) => call.method)).toEqual(['POST', 'GET', 'POST']);
    expect(calls[2].url).toContain('/responses/resp_1234567/cancel');
  });
});
