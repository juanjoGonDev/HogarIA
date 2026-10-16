/**
 * El unico sitio del server que habla con un proveedor de IA (HOGARIA-SPEC §8f).
 *
 * Estaba dentro de `ai.routes.ts`, que es lo que pasa cuando una funcion se escribe
 * para una pantalla y luego la quiere una segunda: la copia se separa en el
 * tratamiento del error, y el segundo sitio es el que se entera tarde. De ahi que
 * aqui se devuelvan codigos, no frases: quien llama decide si el problema es suyo
 * (no hay configuracion), del proveedor (cayo, tardo) o del modelo (no contesto
 * JSON), y son tres avisos muy distintos para quien esta delante de la pantalla.
 */

import { z } from 'zod';
import { isIP } from 'node:net';
import {
  activeHouseholdId,
  hasActiveHouseholdMemberships,
  readActiveHouseholdId
} from './household-context.js';
import type { AiCallResponseFormat, AiResponseFormat } from '../schemas/ai-response-format.js';

export type AiMessagePart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | AiMessagePart[];
};
export type AiJobKind =
  | 'receipt'
  | 'recipe'
  | 'multiple_recipes'
  | 'recommendations'
  | 'weekly_plan'
  | 'shopping_photo'
  | 'expiry_estimate'
  | 'household_plan'
  | 'connection_test';

export interface AiConfigRow {
  id: string;
  user_id?: string;
  household_id?: string | null;
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number | null;
  max_tokens: number | null;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  timeout: number | null;
  retry_attempts?: number | null;
  /** Máximo de trabajos IA en vuelo para esta configuración; 0 = ilimitado. */
  concurrency: number | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const REAL_SMOKE_PROVIDER_KEY_MARKER = '__HOGARIA_AI_REAL_SMOKE_PROVIDER_KEY__';
const REAL_SMOKE_ENABLED_ENV = 'HOGARIA_AI_REAL_SMOKE';
const REAL_SMOKE_PROXY_URL_ENV = 'HOGARIA_AI_REAL_SMOKE_PROXY_URL';
const REAL_SMOKE_PROXY_TOKEN_ENV = 'HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN';
const CONFIGURATION_UNAVAILABLE = 'AI provider configuration is not available';

/** Se tipa con el tipo real y no con un estructural: el `prepare` de better-sqlite3
 *  tiene firmas que un `get(...p: unknown[])` suelto no satisfacen. */
type SqlDb = import('better-sqlite3').Database;

export type AiErrorCode = 'NO_CONFIG' | 'PROVIDER' | 'BAD_JSON' | 'TIMEOUT';

export class AiCallError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = 'AiCallError';
  }
}

/** La fila activa de `ai_config`: se lee siempre desde la BD, no se guarda en memoria. */
export function activeAiConfig(db: SqlDb, userId: string) {
  const householdId = activeHouseholdId(db, userId);
  if (!householdId && hasActiveHouseholdMemberships(db, userId)) return undefined;
  return activeAiConfigForScope(db, userId, householdId);
}

/** Resolve provider config without repairing household selection during read-only assistant requests. */
export function readOnlyActiveAiConfig(db: SqlDb, userId: string) {
  const householdId = readActiveHouseholdId(db, userId);
  if (!householdId && hasActiveHouseholdMemberships(db, userId)) return undefined;
  return activeAiConfigForScope(db, userId, householdId);
}

export function activeAiConfigForScope(db: SqlDb, userId: string, householdId: string | null) {
  if (householdId) {
    return db
      .prepare(
        'SELECT * FROM ai_configs WHERE household_id = ? AND is_active = 1 ORDER BY updated_at DESC, id ASC LIMIT 1'
      )
      .get(householdId) as AiConfigRow | undefined;
  }
  return db
    .prepare(
      'SELECT * FROM ai_configs WHERE user_id = ? AND household_id IS NULL AND is_active = 1 ORDER BY updated_at DESC, id ASC LIMIT 1'
    )
    .get(userId) as AiConfigRow | undefined;
}

export function endpoint(baseUrl: string): string {
  // Una barra de mas en el `base_url` escrito a mano en Ajustes es lo normal; normalizar aqui
  // evita que cada llamante tenga que acordarse. Y el camino: el convenio OpenAI-compatible
  // (OpenAI, Ollama, LM Studio, vLLM, la webapi de la casa…) sirve en `/v1/chat/completions`,
  // asi que una base SIN camino (⌜http://host:8000⌋) se completa con el `/v1`; si la base ya
  // trae su version (⌜…/v1⌋) se respeta; y quien escriba la URL completa tambien. Antes una
  // base sin `/v1` producia un 404 silencioso y la IA «no se activaba nunca» siendo la
  // configuracion correcta.
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v\d+[a-z]*$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/**
 * El bearer de WebAPI permanece en el coordinador del smoke. El server E2E solo recibe
 * una credencial efímera del proxy local; el marcador nunca se persiste como secreto.
 */
function resolveProviderApiKey(baseUrl: string, apiKey: string): string {
  assertE2EProviderTarget(baseUrl);
  if (apiKey !== REAL_SMOKE_PROVIDER_KEY_MARKER) return apiKey;

  const proxyUrl = process.env[REAL_SMOKE_PROXY_URL_ENV];
  const proxyToken = process.env[REAL_SMOKE_PROXY_TOKEN_ENV];
  if (
    process.env[REAL_SMOKE_ENABLED_ENV] !== '1' ||
    !proxyUrl ||
    baseUrl !== proxyUrl ||
    !esUrlLoopback(proxyUrl) ||
    !proxyToken?.trim() ||
    proxyToken === REAL_SMOKE_PROVIDER_KEY_MARKER
  ) {
    throw new AiCallError('PROVIDER', CONFIGURATION_UNAVAILABLE, 'CONFIGURATION_ERROR');
  }

  return proxyToken;
}

function assertE2EProviderTarget(baseUrl: string): void {
  if (process.env.E2E_EXTERNAL_STACK !== '1') return;

  const proxyUrl = process.env[REAL_SMOKE_PROXY_URL_ENV];
  if (process.env[REAL_SMOKE_ENABLED_ENV] === '1') {
    if (!proxyUrl || baseUrl !== proxyUrl || !esUrlLoopback(proxyUrl)) {
      throw new AiCallError('PROVIDER', CONFIGURATION_UNAVAILABLE, 'CONFIGURATION_ERROR');
    }
    return;
  }

  if (!esUrlLoopback(baseUrl)) {
    throw new AiCallError('PROVIDER', CONFIGURATION_UNAVAILABLE, 'CONFIGURATION_ERROR');
  }
}

function esUrlLoopback(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return false;
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname === '::1') return true;
    return isIP(hostname) === 4 && Number(hostname.split('.')[0]) === 127;
  } catch {
    return false;
  }
}

/**
 * El cuerpo de la llamada se construye UNA vez: solo viaja lo que la casa configuro de verdad.
 * Mandar `temperature: null` (o cualquier parametro que el modelo no admite) es la forma mas
 * rapida de que un proveedor estricto conteste 400 a una configuracion perfecta.
 */
function chatBody(active: AiConfigRow, extra: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { model: active.model, ...extra };
  for (const [campo, valor] of Object.entries({
    temperature: active.temperature,
    max_tokens: active.max_tokens,
    top_p: active.top_p,
    frequency_penalty: active.frequency_penalty,
    presence_penalty: active.presence_penalty
  })) {
    if (valor !== null && valor !== undefined) body[campo] = valor;
  }
  return body;
}

/**
 * Llamada a `/chat/completions` con lo que el usuario configuro en la UI (nada de
 * variables de entorno). Devuelve el texto del primer choice.
 */
export async function callAI(
  userId: string,
  messages: AiMessage[],
  db: SqlDb,
  responseFormat: AiResponseFormat,
  kind: AiJobKind = 'recipe',
  externalSignal?: AbortSignal,
  householdId?: string | null
): Promise<string> {
  const { dispatchAI } = await import('./ticket-queue.js');
  return dispatchAI(userId, messages, db, responseFormat, kind, externalSignal, householdId);
}

/** Transporte de una configuración ya fijada por el dispatcher. */
export async function callAIWithConfig(
  active: AiConfigRow,
  messages: AiMessage[],
  responseFormat: AiCallResponseFormat,
  signal?: AbortSignal
): Promise<string> {
  const apiKey = resolveProviderApiKey(active.base_url, active.api_key);
  let response: Response;
  try {
    response = await fetch(endpoint(active.base_url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(chatBody(active, { messages, response_format: responseFormat })),
      signal: señalConTimeout(signal, active.timeout ?? DEFAULT_TIMEOUT_MS)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (signal?.aborted) {
      throw new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED');
    }
    const timedOut = /timeout|abort/i.test(message);
    const detail = timedOut ? 'TIMEOUT' : 'CONNECTION_FAILED';
    throw new AiCallError(
      timedOut ? 'TIMEOUT' : 'PROVIDER',
      timedOut ? 'AI provider request timed out' : 'AI provider connection failed',
      detail
    );
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const detail = `HTTP ${response.status}`;
    throw new AiCallError('PROVIDER', `AI API error: ${detail}`, detail);
  }

  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw new AiCallError('BAD_JSON', 'Invalid AI response format');
  }
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (choice?.finish_reason === 'length') {
    throw new AiCallError('BAD_JSON', 'AI response was truncated', 'TRUNCATED');
  }
  if (
    choice?.finish_reason === 'content_filter' ||
    (typeof message?.refusal === 'string' && message.refusal.trim())
  ) {
    throw new AiCallError('BAD_JSON', 'AI provider refused the response', 'REFUSED');
  }
  const content = message?.content;
  if (typeof content !== 'string') {
    throw new AiCallError('BAD_JSON', 'Invalid AI response format');
  }
  return redactarSecreto(content, apiKey);
}

/**
 * La llamada en STREAMING (## 12aj): misma configuracion, misma forma de error, pero entrega el
 * texto a medida que el modelo lo escribe. Es lo que hace que las lineas del ticket se vayan
 * viendo «poco a poco»: quien llama recibe cada trozo y decide que hacer con el.
 *
 * Si el proveedor no soporta `stream` (responde un JSON normal, o un 4xx), se lanza el mismo
 * `AiCallError` de siempre: la cola decide si reintentar sin streaming —el error antes del
 * primer trozo significa «aqui no hay stream», y caer a `callAI` es un detalle de transporte,
 * no un cambio de reglas.
 */
export async function callAIStreaming(
  userId: string,
  messages: AiMessage[],
  db: SqlDb,
  onDelta: (texto: string) => void,
  responseFormat: AiResponseFormat,
  senal: AbortSignal
): Promise<string> {
  const { dispatchAIStreaming } = await import('./ticket-queue.js');
  return dispatchAIStreaming(userId, messages, db, onDelta, responseFormat, senal);
}

/** Transporte en streaming de una configuración ya fijada por el dispatcher. */
export async function callAIStreamingWithConfig(
  active: AiConfigRow,
  messages: AiMessage[],
  onDelta: (texto: string) => void,
  responseFormat: AiResponseFormat,
  senal: AbortSignal
): Promise<string> {
  const apiKey = resolveProviderApiKey(active.base_url, active.api_key);
  const signal = señalConTimeout(senal, active.timeout ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint(active.base_url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(
        chatBody(active, { messages, response_format: responseFormat, stream: true })
      ),
      signal
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = /timeout|abort/i.test(message);
    const detail = timedOut ? 'TIMEOUT' : 'CONNECTION_FAILED';
    throw new AiCallError(
      timedOut ? 'TIMEOUT' : 'PROVIDER',
      timedOut ? 'AI provider stream timed out' : 'AI provider stream connection failed',
      detail
    );
  }

  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    const detail = response.ok ? 'EMPTY_STREAM' : `HTTP ${response.status}`;
    throw new AiCallError('PROVIDER', `AI API error: ${detail}`, detail);
  }

  const decoder = new TextDecoder();
  let entero = '';
  let porProcesar = '';
  let pendienteDeRedaccion = '';
  try {
    for await (const trozo of response.body) {
      if (signal.aborted) throw new AiCallError('PROVIDER', 'Cancelado', 'CANCELLED');
      porProcesar += decoder.decode(trozo, { stream: true });
      // El SSE llega en lineas «data: {...}» separadas por saltos; una linea «data: [DONE]» cierra.
      const lineas = porProcesar.split('\n');
      porProcesar = lineas.pop() ?? '';
      for (const linea of lineas) {
        const recorte = linea.trim();
        if (!recorte.startsWith('data:')) continue;
        const dato = recorte.slice(5).trim();
        if (!dato || dato === '[DONE]') continue;
        try {
          const delta = (JSON.parse(dato) as any)?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            entero += delta;
            pendienteDeRedaccion += delta;
            const seguroHasta = prefijoSeguroHasta(pendienteDeRedaccion, apiKey);
            if (seguroHasta > 0) {
              onDelta(redactarSecreto(pendienteDeRedaccion.slice(0, seguroHasta), apiKey));
              pendienteDeRedaccion = pendienteDeRedaccion.slice(seguroHasta);
            }
          }
        } catch {
          // Un trozo que no es JSON: los proveedores mandan comentarios y keep-alives; a otra cosa.
        }
      }
    }
  } catch (error) {
    if (error instanceof AiCallError) throw error;
    if (senal.aborted) throw new AiCallError('PROVIDER', 'Cancelado', 'CANCELLED');
    if (signal.aborted) throw new AiCallError('TIMEOUT', 'AI provider stream timed out', 'TIMEOUT');
    throw new AiCallError('PROVIDER', 'AI provider stream connection failed', 'CONNECTION_FAILED');
  }
  if (!entero) {
    throw new AiCallError('BAD_JSON', 'El stream no trajo nada de texto', '');
  }
  if (pendienteDeRedaccion) onDelta(redactarSecreto(pendienteDeRedaccion, apiKey));
  return redactarSecreto(entero, apiKey);
}

/**
 * El modelo escribe a veces ```json ... ``` o añade una frase antes del objeto.
 * Se saca el objeto y se parsea; los errores nunca incluyen el texto generado por
 * el proveedor, porque puede terminar persistido o visible en diagnósticos.
 */
export function extractJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new AiCallError('BAD_JSON', 'Invalid AI response format');
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new AiCallError('BAD_JSON', 'Invalid AI response format');
  }
}

// ── La prueba de conexión (HOGARIA-SPEC ## 8f, revisada a peticion del usuario) ──────────

/** El JSON que se le PIDE al modelo: dado, pequenyo y sin ambiguedad. Un «Hello» probaba que
 *  el proveedor contestaba cualquier cosa; esto prueba lo que la app necesita de verdad —que
 *  respete un formato— porque TODAS las funciones de IA de la casa parsean JSON. */
export const TEST_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'message'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    message: { type: 'string' }
  }
} as const;

export const testAnswerSchema = z.object({
  status: z.literal('ok'),
  message: z.string().min(1)
});

/**
 * La prueba: una llamada real con `response_format` de esquema estricto (el mismo contrato que
 * usa el resto de la app) y validacion de que la contestacion ES el JSON pedido. Devuelve el
 * veredicto con su latencia; quien llama decide si lo guarda en `ai_configs` (prueba de una
 * config guardada) o solo lo ensena (prueba desde el formulario, sin tocar nada).
 */
export async function pingDeConexion(
  config: {
    base_url: string;
    api_key: string;
    model: string;
    timeout?: number | null;
  },
  context: { db: SqlDb; userId: string; config: AiConfigRow; configId: string | null }
): Promise<
  { ok: true; latency: number; message: string } | { ok: false; latency: number; error: string }
> {
  const { dispatchPingDeConexion } = await import('./ticket-queue.js');
  return dispatchPingDeConexion(config, context);
}

/** Raw provider connection probe. Production callers must use pingDeConexion (queued wrapper). */
export async function pingDeConexionTransport(config: {
  base_url: string;
  api_key: string;
  model: string;
  timeout?: number | null;
  signal?: AbortSignal;
}): Promise<
  { ok: true; latency: number; message: string } | { ok: false; latency: number; error: string }
> {
  const startTime = Date.now();
  try {
    const apiKey = resolveProviderApiKey(config.base_url, config.api_key);
    const response = await fetch(endpoint(config.base_url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      // El cuerpo es el minimo del contrato del proveedor: modelo, mensajes y el formato. Nada
      // de `max_tokens` ni `temperature`, que los modelos de razonamiento rechazan y no aportan
      // nada a una prueba de un segundo.
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content:
              'Prueba de conexión. Devuelve exactamente este JSON y nada más: {"status":"ok","message":"conexión establecida"}'
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'connection_test',
            strict: true,
            schema: TEST_ANSWER_SCHEMA
          }
        }
      }),
      signal: señalConTimeout(config.signal, config.timeout ?? DEFAULT_TIMEOUT_MS)
    });

    const latency = Date.now() - startTime;

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, latency, error: `HTTP ${response.status}` };
    }

    const payload = (await response.json().catch(() => null)) as any;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return {
        ok: false,
        latency,
        error: 'La respuesta del proveedor no tiene la forma esperada (choices[0].message.content)'
      };
    }
    type Veredicto = ReturnType<typeof testAnswerSchema.safeParse>;
    let contestacion: Veredicto;
    try {
      contestacion = testAnswerSchema.safeParse(extractJsonObject(content));
    } catch {
      return {
        ok: false,
        latency,
        error: 'El modelo no devolvió el JSON pedido (respuesta no válida)'
      };
    }
    if (!contestacion.success) {
      return {
        ok: false,
        latency,
        error: 'El modelo no devolvió el JSON pedido (respuesta no válida)'
      };
    }
    return {
      ok: true,
      latency,
      message: redactarSecreto(contestacion.data.message, apiKey)
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const mensaje = error instanceof Error ? error.message : String(error);
    const timedOut = /timeout|abort/i.test(mensaje);
    return {
      ok: false,
      latency,
      error: timedOut ? 'Tiempo de espera agotado' : 'No se pudo conectar con el proveedor'
    };
  }
}

function variantesDeSecreto(secreto: string): string[] {
  if (!secreto) return [];
  return [
    ...new Set([secreto, encodeURIComponent(secreto), JSON.stringify(secreto).slice(1, -1)])
  ].filter(Boolean);
}

/** Devuelve cuánto texto puede emitirse sin partir una clave o un prefijo suyo. */
function prefijoSeguroHasta(texto: string, secreto: string): number {
  const variantes = variantesDeSecreto(secreto);
  if (!variantes.length) return texto.length;

  const mayor = Math.max(...variantes.map((variante) => variante.length));
  let limite = texto.length - mayor + 1;
  if (limite <= 0) return 0;

  // No cortar una clave completa por la mitad, aunque haya empezado antes del margen.
  while (limite > 0) {
    let claveCruzada = false;
    for (const variante of variantes) {
      const inicioMinimo = Math.max(0, limite - variante.length + 1);
      let inicio = texto.indexOf(variante, inicioMinimo);
      while (inicio >= 0 && inicio < limite) {
        if (inicio + variante.length > limite) {
          limite = inicio;
          claveCruzada = true;
          break;
        }
        inicio = texto.indexOf(variante, inicio + 1);
      }
      if (claveCruzada) break;
    }
    if (claveCruzada) continue;

    // Tampoco emitir el sufijo que podria ser el inicio de una clave aun incompleta.
    const maxOverlap = Math.min(limite, mayor - 1);
    let overlap = 0;
    for (let longitud = maxOverlap; longitud > 0; longitud -= 1) {
      const sufijo = texto.slice(limite - longitud, limite);
      if (variantes.some((variante) => variante.startsWith(sufijo))) {
        overlap = longitud;
        break;
      }
    }
    if (!overlap) return limite;
    // El nuevo limite puede cortar otra clave repetida; vuelve a comprobar ambos casos.
    limite -= overlap;
  }
  return 0;
}

function redactarSecreto(texto: string, secreto: string): string {
  return variantesDeSecreto(secreto).reduce((resultado, variante) => {
    if (variante.length >= 8) return resultado.replaceAll(variante, '[redactado]');
    const escapada = variante.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return resultado.replace(
      new RegExp(`(?<![A-Za-z0-9_])${escapada}(?![A-Za-z0-9_])`, 'g'),
      '[redactado]'
    );
  }, texto);
}

function señalConTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
