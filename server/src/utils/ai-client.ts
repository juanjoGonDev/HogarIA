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
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import {
  activeHouseholdId,
  hasActiveHouseholdMemberships,
  readActiveHouseholdId
} from './household-context.js';
import { resolveAiFunctionProvider, type AiFunctionKey } from './ai-function-providers.js';
import { aiOperationTimeoutMs, effectiveAiTimeoutMs } from './ai-timeout.js';
import {
  isPermanentProviderClientError,
  sanitizeProviderErrorFields,
  type SafeProviderErrorCode,
  type SafeProviderErrorParam,
  type SafeProviderErrorType
} from './ai-provider-diagnostic.js';
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
  | 'assistant'
  | 'product_image_search'
  | 'connection_test';

export type AiProviderRequestOptions = {
  reasoning_effort?: 'none';
  /** Stable queue ID used to deduplicate a provider POST across server-side retries. */
  jobId?: string;
  /** Sanitized lifecycle metadata; callback failures never affect the provider request. */
  onDiagnostic?: (diagnostic: AiConnectionTestDiagnostic) => void;
};

function safeProviderError(payload: any) {
  const error = payload?.error ?? payload;
  return sanitizeProviderErrorFields({
    type: error?.type,
    code: error?.code,
    param: error?.param
  });
}

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
    readonly detail?: string,
    readonly providerHttpStatus?: number,
    readonly providerErrorType?: SafeProviderErrorType,
    readonly providerErrorCode?: SafeProviderErrorCode,
    readonly providerErrorParam?: SafeProviderErrorParam
  ) {
    super(message);
    this.name = 'AiCallError';
  }

  get retryable(): boolean {
    if (this.code === 'TIMEOUT') return true;
    if (this.code !== 'PROVIDER') return false;
    if (
      ['BACKGROUND_UNSUPPORTED', 'FILE_MISSING', 'RECEIPT_NOT_FOUND', 'INPUT_EXPIRED'].includes(
        this.detail ?? ''
      )
    ) {
      return false;
    }
    return !isPermanentProviderClientError(this.providerHttpStatus);
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

/** Resolve one function's provider using the user's currently selected household, read-only. */
export function readOnlyAiConfigForFunction(db: SqlDb, userId: string, functionKey: AiFunctionKey) {
  const householdId = readActiveHouseholdId(db, userId);
  if (!householdId && hasActiveHouseholdMemberships(db, userId)) return undefined;
  return resolveAiFunctionProvider(db, userId, householdId, functionKey);
}

/** Resolve one function for an already captured scope; never infer another household. */
export function aiConfigForFunctionInScope(
  db: SqlDb,
  userId: string,
  householdId: string | null,
  functionKey: AiFunctionKey
) {
  return resolveAiFunctionProvider(db, userId, householdId, functionKey);
}

/** Resolve a function using the currently active scope, without personal-config fallback. */
export function activeAiConfigForFunction(db: SqlDb, userId: string, functionKey: AiFunctionKey) {
  const householdId = activeHouseholdId(db, userId);
  if (!householdId && hasActiveHouseholdMemberships(db, userId)) return undefined;
  return resolveAiFunctionProvider(db, userId, householdId, functionKey);
}

export function activeAiConfigForFunctionInScope(
  db: SqlDb,
  userId: string,
  householdId: string | null,
  functionKey: AiFunctionKey
) {
  return resolveAiFunctionProvider(db, userId, householdId, functionKey);
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
  // All model traffic uses the server-side Responses background contract. Normalize the
  // provider base once so bare hosts, versioned URLs, and legacy endpoint URLs converge.
  const base = String(baseUrl).trim().replace(/\/+$/, '');
  if (/\/responses$/i.test(base)) return base;
  const root = base.replace(/\/chat\/completions$/i, '');
  if (/\/v\d+[a-z]*$/i.test(root)) return `${root}/responses`;
  return `${root}/v1/responses`;
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

/** Dispatch a user-configured provider through the server-side AI queue. */
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

/** Convert Chat Completions-shaped internal messages to Responses input items. */
function responsesInput(messages: AiMessage[]): Record<string, unknown>[] {
  return messages.map(({ role, content }) => ({
    role,
    content:
      typeof content === 'string'
        ? content
        : content.map((part) => {
            if (part.type === 'text') return { type: 'input_text', text: part.text };
            if (part.type === 'file') {
              return {
                type: 'input_file',
                filename: part.file.filename,
                file_data: part.file.file_data
              };
            }
            return {
              type: 'input_image',
              image_url: part.image_url.url,
              ...(part.image_url.detail ? { detail: part.image_url.detail } : {})
            };
          })
  }));
}

function responsesFormat(responseFormat: AiCallResponseFormat): Record<string, unknown> {
  if (responseFormat.type === 'json_object') return { type: 'json_object' };
  return {
    type: 'json_schema',
    name: responseFormat.json_schema.name,
    strict: responseFormat.json_schema.strict,
    schema: responseFormat.json_schema.schema
  };
}

function responsesBody(
  active: Pick<AiConfigRow, 'model' | 'temperature' | 'top_p' | 'max_tokens'>,
  messages: AiMessage[],
  responseFormat: AiCallResponseFormat,
  requestOptions?: AiProviderRequestOptions
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: active.model,
    background: true,
    store: true,
    input: responsesInput(messages),
    text: { format: responsesFormat(responseFormat) }
  };
  if (active.max_tokens !== null && active.max_tokens !== undefined) {
    body.max_output_tokens = active.max_tokens;
  }
  const gpt5ReasoningDefault = /(?:^|[^a-z\d])gpt-5(?:$|[.-])/i.test(active.model.trim());
  const samplingControlsSupported =
    !gpt5ReasoningDefault || requestOptions?.reasoning_effort === 'none';
  if (
    samplingControlsSupported &&
    active.temperature !== null &&
    active.temperature !== undefined
  ) {
    body.temperature = active.temperature;
  }
  if (samplingControlsSupported && active.top_p !== null && active.top_p !== undefined) {
    body.top_p = active.top_p;
  }
  if (requestOptions?.reasoning_effort) {
    body.reasoning = { effort: requestOptions.reasoning_effort };
  }
  return body;
}

export type AiConnectionTestDiagnostic = Readonly<{
  providerResponseId: string | null;
  providerTransport: 'responses_background';
  providerHttpStatus: number | null;
  elapsedMs: number;
  providerErrorType?: SafeProviderErrorType;
  providerErrorCode?: SafeProviderErrorCode;
  providerErrorParam?: SafeProviderErrorParam;
  diagnosticStage:
    'submitting' | 'queued' | 'polling' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
}>;

type BackgroundRequest = {
  baseUrl: string;
  apiKey: string;
  body: Record<string, unknown>;
  jobId?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  requestTimeoutMs: number;
  onDiagnostic?: (diagnostic: AiConnectionTestDiagnostic) => void;
};

type BackgroundResult = { payload: any; responseId: string; elapsedMs: number };

const RESPONSES_POLL_INITIAL_MS = 500;
const RESPONSES_POLL_MAX_MS = 2_000;
const RESPONSES_CANCEL_TIMEOUT_MS = 5_000;
const SAFE_RESPONSES_ID = /^resp_[A-Za-z0-9_-]{1,128}$/;

function notifyConnectionTestDiagnostic(
  callback: ((diagnostic: AiConnectionTestDiagnostic) => void) | undefined,
  diagnostic: AiConnectionTestDiagnostic
): void {
  try {
    callback?.(diagnostic);
  } catch {
    // Sanitized progress is best-effort and must not affect provider execution.
  }
}

function providerIdempotencyKey(jobId: string | undefined, body: Record<string, unknown>): string {
  const identity = (jobId ?? randomUUID()).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 24);
  return `hogaria-ai-${identity}-${digest}`;
}

function validResponsesId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 133 && SAFE_RESPONSES_ID.test(value);
}

function extractResponsesText(payload: any): string | undefined {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  if (!Array.isArray(payload?.output)) return undefined;
  const chunks: string[] = [];
  for (const item of payload.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }
  return chunks.length ? chunks.join('') : undefined;
}

async function responsePayload(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responsesBackgroundUnsupported(status: number, payload: any): boolean {
  if ([404, 405, 501].includes(status)) return true;
  if (status !== 400) return false;
  const code = String(payload?.error?.code ?? payload?.code ?? '').toLowerCase();
  const parameter = String(payload?.error?.param ?? payload?.param ?? '').toLowerCase();
  return (
    [
      'responses_not_supported',
      'responses_endpoint_not_supported',
      'background_not_supported'
    ].includes(code) ||
    (code === 'unsupported_parameter' &&
      ['background', 'store', 'text.format', 'text.format.type'].includes(parameter))
  );
}

async function cancelResponsesBackground(url: string, responseId: string, apiKey: string) {
  try {
    await fetch(`${url}/${encodeURIComponent(responseId)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(RESPONSES_CANCEL_TIMEOUT_MS)
    });
  } catch {
    // Best-effort remote cancellation must not replace the original result.
  }
}

async function awaitBackgroundResponse(input: BackgroundRequest): Promise<BackgroundResult> {
  const startTime = Date.now();
  const url = endpoint(input.baseUrl);
  const deadline = startTime + input.timeoutMs;
  const idempotencyKey = providerIdempotencyKey(input.jobId, input.body);
  let responseId: string | null = null;
  let status: number | null = null;
  let providerError: ReturnType<typeof safeProviderError> = {};
  const report = (diagnosticStage: AiConnectionTestDiagnostic['diagnosticStage']) =>
    notifyConnectionTestDiagnostic(input.onDiagnostic, {
      providerResponseId: responseId,
      providerTransport: 'responses_background',
      providerHttpStatus: status,
      elapsedMs: Math.max(0, Date.now() - startTime),
      ...(providerError.type ? { providerErrorType: providerError.type } : {}),
      ...(providerError.code ? { providerErrorCode: providerError.code } : {}),
      ...(providerError.param ? { providerErrorParam: providerError.param } : {}),
      diagnosticStage
    });
  const fail = async (
    error: AiCallError,
    stage: AiConnectionTestDiagnostic['diagnosticStage'] = error.code === 'TIMEOUT'
      ? 'timed_out'
      : error.detail === 'CANCELLED'
        ? 'cancelled'
        : 'failed'
  ): Promise<never> => {
    if (responseId && (error.code === 'TIMEOUT' || error.detail === 'CANCELLED')) {
      await cancelResponsesBackground(url, responseId, input.apiKey);
    }
    report(stage);
    throw error;
  };
  const requestSignal = () =>
    señalConTimeout(
      input.signal,
      Math.max(1, Math.min(input.requestTimeoutMs, deadline - Date.now()))
    );
  const parseCreate = async (response: Response): Promise<any> => {
    status = response.status;
    if (!response.ok) {
      const providerPayload = await responsePayload(response);
      providerError = safeProviderError(providerPayload);
      await response.body?.cancel().catch(() => undefined);
      if (responsesBackgroundUnsupported(response.status, providerPayload)) {
        throw new AiCallError(
          'PROVIDER',
          'AI provider does not support Responses background requests',
          'BACKGROUND_UNSUPPORTED',
          response.status,
          providerError.type,
          providerError.code,
          providerError.param
        );
      }
      const detail = `HTTP ${response.status}`;
      throw new AiCallError(
        'PROVIDER',
        `AI API error: ${detail}`,
        detail,
        response.status,
        providerError.type,
        providerError.code,
        providerError.param
      );
    }
    const payload = await responsePayload(response);
    if (!payload) throw new AiCallError('BAD_JSON', 'Invalid AI response format');
    if (!validResponsesId(payload.id)) {
      throw new AiCallError('BAD_JSON', 'Invalid AI response format', 'INVALID_RESPONSE_ID');
    }
    responseId = payload.id;
    return payload;
  };

  if (input.signal?.aborted) {
    throw new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED');
  }
  report('submitting');
  let created: Response;
  try {
    created = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(input.body),
      signal: requestSignal()
    });
  } catch (error) {
    if (input.signal?.aborted)
      return fail(new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED'));
    const timeout =
      Date.now() >= deadline ||
      /timeout|abort/i.test(error instanceof Error ? error.message : String(error));
    return fail(
      new AiCallError(
        timeout ? 'TIMEOUT' : 'PROVIDER',
        timeout ? 'AI provider request timed out' : 'AI provider connection failed',
        timeout ? 'TIMEOUT' : 'CONNECTION_FAILED'
      )
    );
  }

  let payload: any;
  try {
    payload = await parseCreate(created);
  } catch (error) {
    return fail(
      error instanceof AiCallError
        ? error
        : new AiCallError('BAD_JSON', 'Invalid AI response format')
    );
  }
  const terminal = (candidate: any): BackgroundResult | null => {
    const currentStatus = String(candidate?.status ?? '');
    if (currentStatus === 'completed') {
      const refusal = Array.isArray(candidate?.output)
        ? candidate.output.some(
            (item: any) =>
              Array.isArray(item?.content) &&
              item.content.some((part: any) => part?.type === 'refusal')
          )
        : false;
      if (refusal) throw new AiCallError('BAD_JSON', 'AI provider refused the response', 'REFUSED');
      const text = extractResponsesText(candidate);
      if (typeof text !== 'string') throw new AiCallError('BAD_JSON', 'Invalid AI response format');
      report('completed');
      return { payload: candidate, responseId: responseId!, elapsedMs: Date.now() - startTime };
    }
    if (currentStatus === 'incomplete') {
      const truncated = candidate?.incomplete_details?.reason === 'max_output_tokens';
      throw new AiCallError(
        'BAD_JSON',
        truncated ? 'AI response was truncated' : 'AI provider did not complete the response',
        truncated ? 'TRUNCATED' : 'INCOMPLETE'
      );
    }
    if (['failed', 'cancelled'].includes(currentStatus)) {
      throw new AiCallError(
        'PROVIDER',
        currentStatus === 'cancelled'
          ? 'AI provider cancelled the response'
          : 'AI provider request failed',
        currentStatus === 'cancelled' ? 'PROVIDER_CANCELLED' : 'PROVIDER_FAILED'
      );
    }
    return null;
  };

  try {
    const completed = terminal(payload);
    if (completed) return completed;
  } catch (error) {
    return fail(
      error instanceof AiCallError
        ? error
        : new AiCallError('BAD_JSON', 'Invalid AI response format')
    );
  }
  let state = String(payload?.status ?? '');
  if (state !== 'queued' && state !== 'in_progress') {
    return fail(
      new AiCallError('BAD_JSON', 'Invalid AI response format', 'INVALID_RESPONSE_STATUS')
    );
  }
  report(state === 'queued' ? 'queued' : 'polling');
  let delayMs = RESPONSES_POLL_INITIAL_MS;

  while (Date.now() < deadline) {
    if (input.signal?.aborted) {
      return fail(new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED'));
    }
    try {
      await esperarConCancelacion(
        Math.min(delayMs, Math.max(0, deadline - Date.now())),
        input.signal
      );
    } catch {
      if (input.signal?.aborted) {
        return fail(new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED'));
      }
      return fail(new AiCallError('TIMEOUT', 'AI provider request timed out', 'TIMEOUT'));
    }
    if (Date.now() >= deadline) {
      return fail(new AiCallError('TIMEOUT', 'AI provider request timed out', 'TIMEOUT'));
    }

    let current: Response;
    try {
      current = await fetch(`${url}/${encodeURIComponent(responseId!)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: requestSignal()
      });
    } catch (error) {
      if (input.signal?.aborted) {
        return fail(new AiCallError('PROVIDER', 'AI request was cancelled', 'CANCELLED'));
      }
      if (Date.now() >= deadline) {
        return fail(new AiCallError('TIMEOUT', 'AI provider request timed out', 'TIMEOUT'));
      }
      report('polling');
      delayMs = Math.min(delayMs * 2, RESPONSES_POLL_MAX_MS);
      continue;
    }
    status = current.status;
    if (!current.ok) {
      const providerPayload = await responsePayload(current);
      providerError = safeProviderError(providerPayload);
      await current.body?.cancel().catch(() => undefined);
      if ([408, 409, 425, 429].includes(current.status) || current.status >= 500) {
        report('polling');
        delayMs = Math.min(delayMs * 2, RESPONSES_POLL_MAX_MS);
        continue;
      }
      const detail = `HTTP ${current.status}`;
      return fail(
        new AiCallError(
          'PROVIDER',
          `AI API error: ${detail}`,
          detail,
          current.status,
          providerError.type,
          providerError.code,
          providerError.param
        )
      );
    }
    const currentPayload = await responsePayload(current);
    if (!currentPayload || currentPayload.id !== responseId) {
      return fail(
        new AiCallError('BAD_JSON', 'Invalid AI response format', 'RESPONSE_ID_MISMATCH')
      );
    }
    try {
      const completed = terminal(currentPayload);
      if (completed) return completed;
    } catch (error) {
      return fail(
        error instanceof AiCallError
          ? error
          : new AiCallError('BAD_JSON', 'Invalid AI response format')
      );
    }
    state = String(currentPayload?.status ?? '');
    if (state !== 'queued' && state !== 'in_progress') {
      return fail(
        new AiCallError('BAD_JSON', 'Invalid AI response format', 'INVALID_RESPONSE_STATUS')
      );
    }
    report(state === 'queued' ? 'queued' : 'polling');
    delayMs = Math.min(delayMs * 2, RESPONSES_POLL_MAX_MS);
  }
  return fail(new AiCallError('TIMEOUT', 'AI provider request timed out', 'TIMEOUT'));
}

async function requestResponsesText(input: {
  active: AiConfigRow;
  messages: AiMessage[];
  responseFormat: AiCallResponseFormat;
  signal?: AbortSignal;
  requestOptions?: AiProviderRequestOptions;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = resolveProviderApiKey(input.active.base_url, input.active.api_key);
  const body = responsesBody(
    input.active,
    input.messages,
    input.responseFormat,
    input.requestOptions
  );
  const response = await awaitBackgroundResponse({
    baseUrl: input.active.base_url,
    apiKey,
    body,
    jobId: input.requestOptions?.jobId,
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? aiOperationTimeoutMs(input.active.timeout),
    requestTimeoutMs: effectiveAiTimeoutMs(input.active.timeout),
    onDiagnostic: input.requestOptions?.onDiagnostic
  });
  const text = extractResponsesText(response.payload);
  if (typeof text !== 'string') throw new AiCallError('BAD_JSON', 'Invalid AI response format');
  return redactarSecreto(text, apiKey);
}

/** Every model call is accepted and polled by the server through Responses background. */
export async function callAIWithConfig(
  active: AiConfigRow,
  messages: AiMessage[],
  responseFormat: AiCallResponseFormat,
  signal?: AbortSignal,
  requestOptions?: AiProviderRequestOptions
): Promise<string> {
  return requestResponsesText({ active, messages, responseFormat, signal, requestOptions });
}

/** Public queued wrapper retained for routes which use the generic AI dispatcher. */
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

/** Legacy streaming consumers receive one sanitized final chunk after background completion. */
export async function callAIStreamingWithConfig(
  active: AiConfigRow,
  messages: AiMessage[],
  onDelta: (texto: string) => void,
  responseFormat: AiResponseFormat,
  senal: AbortSignal,
  requestOptions?: AiProviderRequestOptions
): Promise<string> {
  const text = await requestResponsesText({
    active,
    messages,
    responseFormat,
    signal: senal,
    requestOptions
  });
  onDelta(text);
  return text;
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

function connectionTestVerdictFromContent(
  content: unknown,
  apiKey: string,
  latency: number,
  expectedShape: string
): { ok: true; latency: number; message: string } | { ok: false; latency: number; error: string } {
  if (typeof content !== 'string') {
    return {
      ok: false,
      latency,
      error: `La respuesta del proveedor no tiene la forma esperada (${expectedShape})`
    };
  }
  try {
    const result = testAnswerSchema.safeParse(extractJsonObject(content));
    if (!result.success) {
      return {
        ok: false,
        latency,
        error: 'El modelo no devolvió el JSON pedido (respuesta no válida)'
      };
    }
    return {
      ok: true,
      latency,
      message: redactarSecreto(result.data.message, apiKey)
    };
  } catch {
    return {
      ok: false,
      latency,
      error: 'El modelo no devolvió el JSON pedido (respuesta no válida)'
    };
  }
}

function esperarConCancelacion(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancelar);
      resolve();
    }, ms);
    const cancelar = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelar);
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    };
    signal?.addEventListener('abort', cancelar, { once: true });
  });
}

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

/** Raw provider connection probe; all probes use Responses background even without a queue ID. */
export async function pingDeConexionTransport(config: {
  base_url: string;
  api_key: string;
  model: string;
  timeout?: number | null;
  signal?: AbortSignal;
  jobId?: string;
  onDiagnostic?: (diagnostic: AiConnectionTestDiagnostic) => void;
}): Promise<
  { ok: true; latency: number; message: string } | { ok: false; latency: number; error: string }
> {
  const startTime = Date.now();
  let apiKey: string;
  try {
    apiKey = resolveProviderApiKey(config.base_url, config.api_key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifyConnectionTestDiagnostic(config.onDiagnostic, {
      providerResponseId: null,
      providerTransport: 'responses_background',
      providerHttpStatus: null,
      elapsedMs: Date.now() - startTime,
      diagnosticStage: 'failed'
    });
    return {
      ok: false,
      latency: Date.now() - startTime,
      error: /timeout|abort/i.test(message)
        ? 'Tiempo de espera agotado'
        : 'No se pudo conectar con el proveedor'
    };
  }

  const body = {
    model: config.model,
    background: true,
    store: true,
    input:
      'Prueba de conexión. Devuelve exactamente este JSON y nada más: {"status":"ok","message":"conexión establecida"}',
    text: {
      format: {
        type: 'json_schema',
        name: 'connection_test',
        strict: true,
        schema: TEST_ANSWER_SCHEMA
      }
    }
  };
  try {
    const response = await awaitBackgroundResponse({
      baseUrl: config.base_url,
      apiKey,
      body,
      jobId: config.jobId,
      signal: config.signal,
      timeoutMs: aiOperationTimeoutMs(config.timeout),
      requestTimeoutMs: effectiveAiTimeoutMs(config.timeout),
      onDiagnostic: config.onDiagnostic
    });
    const result = connectionTestVerdictFromContent(
      extractResponsesText(response.payload),
      apiKey,
      response.elapsedMs,
      'output[].content[].text'
    );
    if (!result.ok) {
      notifyConnectionTestDiagnostic(config.onDiagnostic, {
        providerResponseId: response.responseId,
        providerTransport: 'responses_background',
        providerHttpStatus: null,
        elapsedMs: Date.now() - startTime,
        diagnosticStage: 'failed'
      });
    }
    return result;
  } catch (error) {
    const aiError =
      error instanceof AiCallError
        ? error
        : new AiCallError('PROVIDER', 'AI provider connection failed', 'CONNECTION_FAILED');
    const diagnosticStage: AiConnectionTestDiagnostic['diagnosticStage'] =
      aiError.code === 'TIMEOUT'
        ? 'timed_out'
        : aiError.detail === 'CANCELLED'
          ? 'cancelled'
          : 'failed';
    const httpStatus = /^HTTP \d+$/.test(aiError.detail ?? '')
      ? Number(aiError.detail?.slice(5))
      : null;
    notifyConnectionTestDiagnostic(config.onDiagnostic, {
      providerResponseId: null,
      providerTransport: 'responses_background',
      providerHttpStatus: httpStatus,
      elapsedMs: Date.now() - startTime,
      diagnosticStage
    });
    return {
      ok: false,
      latency: Date.now() - startTime,
      error:
        aiError.detail === 'CANCELLED'
          ? 'Prueba cancelada'
          : aiError.detail === 'BACKGROUND_UNSUPPORTED'
            ? 'El proveedor no admite solicitudes Responses en segundo plano'
            : aiError.code === 'TIMEOUT'
              ? 'Tiempo de espera agotado'
              : httpStatus
                ? `HTTP ${httpStatus}`
                : aiError.code === 'BAD_JSON'
                  ? 'La respuesta del proveedor no tiene la forma esperada (Responses output)'
                  : 'No se pudo conectar con el proveedor'
    };
  }
}

function variantesDeSecreto(secreto: string): string[] {
  if (!secreto) return [];
  return [
    ...new Set([secreto, encodeURIComponent(secreto), JSON.stringify(secreto).slice(1, -1)])
  ].filter(Boolean);
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
