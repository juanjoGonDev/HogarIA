import { ReadableStream } from 'node:stream/web';
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
  signal: AbortSignal
) {
  return callAIStreamingTransportRaw(active, messages, onDelta, TEST_RESPONSE_FORMAT, signal);
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
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: `El proxy repitió ${REAL_SMOKE_PROXY_TOKEN}` } }]
        }),
        { status: 200 }
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
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const out = await callAITransport(CONFIG, [{ role: 'user', content: 'hola' }]);

    expect(out).toBe('{"ok":true}');
    // `base_url` acabado en `/` no debe producir `//chat/completions`
    expect(seen[0].url).toBe('https://ai.local/v1/chat/completions');
    const body = JSON.parse(seen[0].init.body);
    expect(body).toMatchObject({
      model: 'gpt-vision',
      temperature: 0.2,
      max_tokens: 900,
      response_format: TEST_RESPONSE_FORMAT
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
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ api_key: secret, choices: [] }), { status: 200 })
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
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ name: `Recipe ${secret}` }) } }]
          }),
          { status: 200 }
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

/** Un cuerpo SSE de mentira: lo que devuelve un proveedor en modo stream. */
// El tsconfig del server no declara los globals de web streams: la clase se importa de
// node:stream/web, que es de donde sale el objeto de todas formas.
function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller: { enqueue: (trozo: Uint8Array) => void; close: () => void }) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    }
  });
}

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
    providerResponse: () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'respuesta' } }] }), {
        status: 200
      })
  },
  {
    name: 'stream',
    call: (config) =>
      callAIStreamingTransport(config, [], () => undefined, new AbortController().signal),
    providerResponse: () =>
      new Response(
        sse([
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'respuesta' } }] })}\n`,
          'data: [DONE]\n'
        ]),
        { status: 200 }
      )
  },
  {
    name: 'connection test',
    call: (config) => pingDeConexionTransport(config),
    providerResponse: () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"status":"ok","message":"conectado"}' } }]
        }),
        { status: 200 }
      ),
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
  it('va entregando cada delta y devuelve el texto entero, con [DONE] y ruido de por medio', async () => {
    const deltas: string[] = [];
    const seen: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return new Response(
        sse([
          'data: ' + JSON.stringify({ choices: [{ delta: { content: '{\"lines\":[' } }] }) + '\n',
          ': keep-alive\n\n',
          'data: no soy json\n',
          'data: ' +
            JSON.stringify({ choices: [{ delta: { content: '{\"name\":\"Leche\"}' } }] }) +
            '\n',
          'data: [DONE]\n'
        ]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      );
    });

    const texto = await callAIStreamingTransport(
      CONFIG,
      [{ role: 'user', content: 'lee' }],
      (delta) => deltas.push(delta),
      new AbortController().signal
    );

    expect(texto).toBe('{"lines":[{"name":"Leche"}');
    expect(deltas.join('')).toBe(texto);
    // El stream va de verdad en el body, y la senal de abort viaja con el fetch.
    expect(seen[0].body.stream).toBe(true);
    expect(seen[0].body.response_format).toEqual(TEST_RESPONSE_FORMAT);
  });

  it('sin configuracion activa, NO_CONFIG (la cola lo traduce por «configura la IA»)', async () => {
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

  it('usa el token resuelto en Authorization y lo redacta aunque cruce deltas', async () => {
    enableRealSmoke();
    const deltas: string[] = [];
    let authorization: string | undefined;
    const providerDeltas = [
      `inicio ${REAL_SMOKE_PROXY_TOKEN.slice(0, 12)}`,
      `${REAL_SMOKE_PROXY_TOKEN.slice(12)} final`
    ];
    const chunks = [
      ...providerDeltas.map(
        (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`
      ),
      'data: [DONE]\n'
    ];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      authorization = (init.headers as Record<string, string>).Authorization;
      return new Response(sse(chunks), { status: 200 });
    });

    const content = await callAIStreamingTransport(
      {
        ...CONFIG,
        base_url: REAL_SMOKE_PROXY_URL,
        api_key: REAL_SMOKE_PROVIDER_KEY_MARKER
      },
      [],
      (delta) => deltas.push(delta),
      new AbortController().signal
    );

    expect(authorization).toBe(`Bearer ${REAL_SMOKE_PROXY_TOKEN}`);
    expect(content).not.toContain(REAL_SMOKE_PROXY_TOKEN);
    expect(deltas.join('')).not.toContain(REAL_SMOKE_PROXY_TOKEN);
    expect(content).toContain('[redactado]');
    expect(deltas.join('')).toBe(content);
  });

  it('un 4xx/5xx del proveedor es PROVIDER y conserva solo el status', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal(
      'fetch',
      async () => new Response(`upstream rejected ${secret}`, { status: 500 })
    );
    const error = await callAIStreamingTransport(
      { ...CONFIG, api_key: secret },
      [],
      () => undefined,
      new AbortController().signal
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('PROVIDER');
    expect(error.detail).toBe('HTTP 500');
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(secret);
  });

  it('un stream que no trajo nada de texto es BAD_JSON, no un exito silencioso', async () => {
    vi.stubGlobal('fetch', async () => new Response(sse(['data: [DONE]\n']), { status: 200 }));
    await expect(
      callAIStreamingTransport(CONFIG, [], () => undefined, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'BAD_JSON' });
  });

  it('la senal abortada a mitad de stream corta la lectura con PROVIDER/Cancelado', async () => {
    const control = new AbortController();
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          sse([
            'data: ' + JSON.stringify({ choices: [{ delta: { content: 'primer trozo' } }] }) + '\n',
            'data: ' + JSON.stringify({ choices: [{ delta: { content: ' segundo' } }] }) + '\n'
          ]),
          { status: 200 }
        )
    );
    const error = await callAIStreamingTransport(
      CONFIG,
      [],
      () => control.abort(),
      control.signal
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('PROVIDER');
    expect(error.detail).toBe('CANCELLED');
  });

  it('redacta una clave repartida entre deltas antes de entregarla al llamante', async () => {
    const secret = 'synthetic-stream-secret-sentinel';
    const deltas: string[] = [];
    const answer = `{"name":"${secret}"}`;
    const chunks = answer.split(secret).flatMap((chunk, index, all) => {
      const parts = [`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n`];
      if (index < all.length - 1) {
        parts.push(`data: ${JSON.stringify({ choices: [{ delta: { content: secret } }] })}\n`);
      }
      return parts;
    });
    vi.stubGlobal('fetch', async () => new Response(sse(chunks), { status: 200 }));

    const content = await callAIStreamingTransport(
      { ...CONFIG, api_key: secret },
      [],
      (delta) => deltas.push(delta),
      new AbortController().signal
    );

    expect(content).not.toContain(secret);
    expect(deltas.join('')).not.toContain(secret);
    expect(content).toContain('[redactado]');
  });

  it('no filtra una clave periodica al mover el limite seguro de un delta', async () => {
    const secret = 'ababababab';
    const deltas: string[] = [];
    const content = `${secret}zzzzzzzzz`;
    const event = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
    vi.stubGlobal('fetch', async () => new Response(sse([event]), { status: 200 }));

    await callAIStreamingTransport(
      { ...CONFIG, api_key: secret },
      [],
      (delta) => deltas.push(delta),
      new AbortController().signal
    );

    expect(deltas.join('')).not.toContain(secret);
  });

  it('normaliza un error del lector del stream sin persistir el mensaje del transporte', async () => {
    const secret = 'synthetic-stream-reader-secret-sentinel';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(`connection reset after ${secret}`));
      }
    });
    vi.stubGlobal('fetch', async () => new Response(stream, { status: 200 }));
    const error = await callAIStreamingTransport(
      { ...CONFIG, api_key: secret },
      [],
      () => undefined,
      new AbortController().signal
    ).catch((reason) => reason);

    expect(error).toBeInstanceOf(AiCallError);
    expect(error.code).toBe('PROVIDER');
    expect(JSON.stringify({ message: error.message, detail: error.detail })).not.toContain(secret);
    expect(error.message).toBe('AI provider stream connection failed');
  });

  it('un fetch que revienta con abort/timeout es TIMEOUT', async () => {
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
    expect(endpoint('http://localhost:8000')).toBe('http://localhost:8000/v1/chat/completions');
  });

  it('la base que ya trae su version se respeta, barra final incluida', () => {
    expect(endpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
    expect(endpoint('http://localhost:11434/v1/')).toBe(
      'http://localhost:11434/v1/chat/completions'
    );
    expect(endpoint('http://x/api/v2')).toBe('http://x/api/v2/chat/completions');
  });

  it('la URL completa hasta chat/completions se usa tal cual', () => {
    expect(endpoint('https://x/proxy/chat/completions')).toBe('https://x/proxy/chat/completions');
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
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"answer":"ok"}' } }] }),
        {
          status: 200
        }
      );
    });

    await callAITransportRaw(CONFIG, [{ role: 'user', content: 'JSON' }], responseFormat);

    expect(body.response_format).toEqual(responseFormat);
  });

  it('rechaza una respuesta truncada aunque el contenido parezca JSON completo', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'length', message: { content: '{"answer":"ok"}' } }]
          }),
          { status: 200 }
        )
    );
    const error = await callAITransport(CONFIG, []).catch((reason) => reason);
    expect(error).toMatchObject({ code: 'BAD_JSON', detail: 'TRUNCATED' });
  });

  it('rechaza respuestas marcadas como refusal o content-filter sin exponerlas', async () => {
    for (const choice of [
      { finish_reason: 'stop', message: { refusal: 'private refusal text', content: null } },
      { finish_reason: 'content_filter', message: { content: null } }
    ]) {
      vi.stubGlobal(
        'fetch',
        async () => new Response(JSON.stringify({ choices: [choice] }), { status: 200 })
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
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200
      });
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
      messages: [{ role: 'user', content: 'hola' }],
      response_format: TEST_RESPONSE_FORMAT
    });
  });

  it('los parametros con valor si viajan', async () => {
    let cuerpo: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      cuerpo = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200
      });
    });
    await callAITransport({ ...CONFIG, temperature: 0.2, max_tokens: 500 }, [
      { role: 'user', content: 'hola' }
    ]);
    vi.unstubAllGlobals();
    expect(cuerpo.temperature).toBe(0.2);
    expect(cuerpo.max_tokens).toBe(500);
  });
});

describe('pingDeConexion', () => {
  const respuesta = (content: unknown, status = 200) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

  it('pide el JSON dado con response_format de esquema estricto, y lo valida', async () => {
    let cuerpo: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      cuerpo = JSON.parse(String(init.body));
      return respuesta('{"status":"ok","message":"conexión establecida"}');
    });
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x:8000',
      api_key: 'k',
      model: 'gpt-5'
    });
    vi.unstubAllGlobals();
    expect(veredicto.ok).toBe(true);
    // El contrato del proveedor, como el ejemplo del usuario: json_schema estricto.
    expect(cuerpo.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'connection_test', strict: true, schema: expect.any(Object) }
    });
    // Y nada de max_tokens ni temperature en una prueba de un segundo.
    expect(cuerpo.max_tokens).toBeUndefined();
    expect(cuerpo.temperature).toBeUndefined();
  });

  it('usa el token resuelto y lo redacta en el mensaje de conexión', async () => {
    enableRealSmoke();
    let authorization: string | undefined;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      authorization = (init.headers as Record<string, string>).Authorization;
      return respuesta(JSON.stringify({ status: 'ok', message: `eco ${REAL_SMOKE_PROXY_TOKEN}` }));
    });

    const veredicto = await pingDeConexionTransport({
      base_url: REAL_SMOKE_PROXY_URL,
      api_key: REAL_SMOKE_PROVIDER_KEY_MARKER,
      model: 'm'
    });

    expect(authorization).toBe(`Bearer ${REAL_SMOKE_PROXY_TOKEN}`);
    expect(veredicto.ok).toBe(true);
    if (veredicto.ok) {
      expect(veredicto.message).not.toContain(REAL_SMOKE_PROXY_TOKEN);
      expect(veredicto.message).toContain('[redactado]');
    }
  });

  it('un marcador sin opt-in falla genérico sin iniciar fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const veredicto = await pingDeConexionTransport({
      base_url: REAL_SMOKE_PROXY_URL,
      api_key: REAL_SMOKE_PROVIDER_KEY_MARKER,
      model: 'm'
    });

    expect(veredicto).toMatchObject({
      ok: false,
      error: 'No se pudo conectar con el proveedor'
    });
    expect(JSON.stringify(veredicto)).not.toContain(REAL_SMOKE_PROVIDER_KEY_MARKER);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un 200 con cuerpo que no es JSON (el proxy con su pagina HTML) es veredicto de error, no un vuelco', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<html>Bad Gateway</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
    );
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'k',
      model: 'm'
    });
    vi.unstubAllGlobals();
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.error).toContain('no tiene la forma esperada');
  });

  it('si ni el cuerpo del error se puede leer, el veredicto sigue siendo un error con nombre', async () => {
    const cuerpoRoto = new ReadableStream({
      start(control) {
        control.error(new Error('stream roto'));
      }
    });
    vi.stubGlobal('fetch', async () => new Response(cuerpoRoto, { status: 502 }));
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'k',
      model: 'm'
    });
    vi.unstubAllGlobals();
    expect(veredicto.ok).toBe(false);
    // Sin cuerpo no hay texto del proveedor: queda el HTTP, que es lo unico cierto.
    if (!veredicto.ok) expect(veredicto.error).toContain('HTTP 502');
  });

  it('un «Hello» ambiguo no vale y la respuesta del modelo no aparece en el error', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal('fetch', async () =>
      respuesta(`Hello! Bearer ${secret} is not the requested JSON`)
    );
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: secret,
      model: 'm'
    });
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) {
      expect(veredicto.error).toContain('no devolvió el JSON pedido');
      expect(veredicto.error).not.toContain(secret);
      expect(veredicto.error).not.toContain('Hello!');
    }
  });

  it('un 400 del proveedor se cuenta con su texto', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('{"error":"max_tokens is not supported"}', { status: 400 })
    );
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'k',
      model: 'm'
    });
    vi.unstubAllGlobals();
    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) {
      expect(veredicto.error).toBe('HTTP 400');
      expect(veredicto.error).not.toContain('max_tokens is not supported');
    }
  });

  it('no devuelve la credencial aunque el proveedor la repita en el cuerpo 401', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal('fetch', async () => new Response(`Invalid API key: ${secret}`, { status: 401 }));
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: secret,
      model: 'm'
    });

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) {
      expect(veredicto.error).not.toContain(secret);
      expect(veredicto.error).toBe('HTTP 401');
    }
  });

  it('no devuelve una credencial si el modelo la repite en el mensaje de éxito', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal('fetch', async () =>
      respuesta(JSON.stringify({ status: 'ok', message: `Bearer ${secret}` }))
    );
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: secret,
      model: 'm'
    });

    expect(veredicto.ok).toBe(true);
    if (veredicto.ok) expect(veredicto.message).not.toContain(secret);
  });

  it('redacta una clave corta si el modelo la devuelve como mensaje de éxito', async () => {
    const secret = 'sk-x';
    vi.stubGlobal('fetch', async () =>
      respuesta(JSON.stringify({ status: 'ok', message: `La clave usada fue ${secret}` }))
    );
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: secret,
      model: 'm'
    });

    expect(veredicto.ok).toBe(true);
    if (veredicto.ok) {
      expect(veredicto.message).not.toContain(secret);
      expect(veredicto.message).toContain('[redactado]');
    }
  });

  it('la red caida es un veredicto, no una excepcion', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('fetch failed');
    });
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: 'k',
      model: 'm'
    });
    vi.unstubAllGlobals();
    expect(veredicto.ok).toBe(false);
  });

  it('no devuelve la credencial si el error de red la incluye', async () => {
    const secret = 'synthetic-provider-secret-sentinel';
    vi.stubGlobal('fetch', async () => {
      throw new Error(`socket failure ${secret}`);
    });
    const veredicto = await pingDeConexionTransport({
      base_url: 'http://x/v1',
      api_key: secret,
      model: 'm'
    });

    expect(veredicto.ok).toBe(false);
    if (!veredicto.ok) expect(veredicto.error).not.toContain(secret);
  });
});
