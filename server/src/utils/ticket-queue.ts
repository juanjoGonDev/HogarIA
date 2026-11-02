/**
 * Dispatcher único de consumo de IA (HOGARIA-SPEC §12an).
 *
 * `ai_jobs` conserva metadatos y cola; prompts, adjuntos, respuestas y claves nunca se guardan
 * allí. Los jobs genéricos dependen de una closure en RAM y pasan a `INPUT_EXPIRED` al reiniciar;
 * los tickets pueden recuperarse desde su recibo/archivo. Por ello se requiere una instancia Node
 * por base SQLite; no se comparte un dispatcher entre procesos. La concurrencia es POR CONFIGURACIÓN,
 * no por usuario: un proveedor lento no consume el cupo de otro.
 *
 * Cada ticket lee el archivo, adjunta el inventario completo y espera la respuesta del modelo
 * mediante Responses background. Al completarse, valida el objeto, registra la tienda detectada
 * si no existe y deja el ticket en `review`; no simula streaming ni guarda prompts en la cola.
 *
 * Solo la cancelación explícita aborta el trabajo servidor y solicita cancelar el response remoto.
 * Una desconexión HTTP no llega a ese controlador. Reintentar devuelve el ticket a la cola y
 * limpia las líneas parciales de intentos anteriores.
 */

import { randomUUID } from 'node:crypto';
import type { Database as SqlDb } from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { getDatabase } from '../config/database.js';
import { activeHouseholdId } from './household-context.js';
import { ensureDefaultCategories } from './pantry-categories.js';
import {
  aiConfigByIdInScope,
  aiConfigForPinnedJob,
  aiConfigScopeForUser
} from './ai-config-scope.js';
import {
  activeAiConfig,
  activeAiConfigForFunction,
  activeAiConfigForFunctionInScope,
  AiCallError,
  callAIWithConfig,
  callAIStreamingWithConfig,
  extractJsonObject,
  pingDeConexionTransport
} from './ai-client.js';
import { aiFunctionForJobKind } from './ai-function-providers.js';
import { sanitizeProviderErrorFields } from './ai-provider-diagnostic.js';
import type {
  AiConfigRow,
  AiConnectionTestDiagnostic,
  AiJobKind,
  AiMessage,
  AiMessagePart
} from './ai-client.js';
import type { AiResponseFormat } from '../schemas/ai-response-format.js';
import {
  buildInventarioJson,
  buildTicketPrompt,
  type InventarioParaPrompt
} from './ticket-prompt.js';
import { deduplicateTicketLines } from './ticket-lines-dedup.js';
import { ticketAnswerSchema } from '../schemas/receipts.schema.js';
import { RECEIPT_RESPONSE_FORMAT } from '../schemas/ai-generated-output.schema.js';
import { leerTicket } from './ticket-files.js';
import { aiJobLeaseSeconds } from './ai-timeout.js';

// The queue is local to this process/database. Jobs wake it directly; the slow
// interval is only a recovery sweep for durable rows changed outside the API.
const QUEUE_RECONCILIATION_INTERVAL_MS = 30_000;
type Trabajador = {
  temporizador: NodeJS.Timeout;
  despertador: NodeJS.Timeout | null;
  corriendo: Set<string>;
  señales: Map<string, AbortController>;
};

type AiRuntime<T = unknown> = {
  userId: string;
  householdId: string | null;
  configId: string | null;
  config: AiConfigRow | null;
  run: (config: AiConfigRow | null, signal: AbortSignal, jobId: string) => Promise<T>;
  failureCode?: (result: T) => string | null;
  payloadBytes: number;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  settled: boolean;
  removeExternalAbort?: () => void;
  retryWindowTimer?: NodeJS.Timeout;
  retryError?: unknown;
  retryFallback?: unknown;
  retryFallbackSet?: boolean;
};

export type AiJobHandle<T> = { id: string; result: Promise<T> };

type SubmitAiTask<T> = {
  db: SqlDb;
  userId: string;
  /** Optional stable id shared with a domain row created before the worker can claim the job. */
  id?: string;
  /** Explicit scope for durable work such as receipts; otherwise captured at admission. */
  householdId?: string | null;
  config: AiConfigRow | null;
  /** Null for an unsaved connection check: metadata is queued, credentials remain volatile. */
  configId?: string | null;
  kind: string;
  run: (config: AiConfigRow | null, signal: AbortSignal, jobId: string) => Promise<T>;
  failureCode?: (result: T) => string | null;
  payloadBytes?: number;
  externalSignal?: AbortSignal;
};

let trabajador: Trabajador | null = null;
const trabajosEnMemoria = new Map<string, AiRuntime<any>>();
const BYTES_MAXIMOS_POR_USUARIO = 32 * 1024 * 1024;
const TRABAJOS_MAXIMOS_POR_USUARIO = 100;
const VENTANA_REINTENTO_MANUAL_MS = 5 * 60 * 1000;

/** Coalesces local queue changes without polling SQLite on every short interval. */
function despertarWorker(): void {
  const estado = trabajador;
  if (!estado || estado.despertador) return;
  estado.despertador = setTimeout(() => {
    if (trabajador !== estado) return;
    estado.despertador = null;
    paso();
  }, 0);
  estado.despertador.unref?.();
}

function resolver<T>(runtime: AiRuntime<T>, value: T): void {
  if (runtime.settled) return;
  clearTimeout(runtime.retryWindowTimer);
  runtime.removeExternalAbort?.();
  runtime.settled = true;
  runtime.resolve(value);
}

function rechazar(runtime: AiRuntime, error: unknown): void {
  if (runtime.settled) return;
  clearTimeout(runtime.retryWindowTimer);
  runtime.removeExternalAbort?.();
  runtime.settled = true;
  runtime.reject(error);
}

function liberarRuntime(jobId: string, borrar: boolean): void {
  const runtime = trabajosEnMemoria.get(jobId);
  if (!runtime || !borrar) return;
  runtime.removeExternalAbort?.();
  trabajosEnMemoria.delete(jobId);
}

function maxIntentos(config: AiConfigRow | null, kind?: string): number {
  if (kind === 'connection_test') return 1;
  const retries = Number(config?.retry_attempts ?? 3);
  return (Number.isInteger(retries) && retries >= 0 ? Math.min(retries, 5) : 3) + 1;
}

function siguienteOrden(db: SqlDb, configId: string | null): number {
  const fila = db
    .prepare(
      `SELECT COALESCE(MAX(queue_order), -1) AS maximo FROM ai_jobs
        WHERE config_id IS ? AND status = 'queued'`
    )
    .get(configId) as { maximo: number };
  return fila.maximo + 1;
}

/**
 * Encola metadatos durables y mantiene la operación sensible solo en RAM. Ningún prompt,
 * imagen, resultado o API key se serializa en ai_jobs; los genéricos pierden su input al reiniciar.
 */
export function submitAiTask<T>(input: SubmitAiTask<T>): AiJobHandle<T> {
  const db = input.db;
  const householdId =
    input.householdId === undefined ? activeHouseholdId(db, input.userId) : input.householdId;
  const payloadBytes = Math.max(0, Math.trunc(input.payloadBytes ?? 0));
  const vivos = [...trabajosEnMemoria.values()].filter((job) => job.userId === input.userId);
  const bytesVivos = vivos.reduce((total, job) => total + job.payloadBytes, 0);
  if (
    vivos.length >= TRABAJOS_MAXIMOS_POR_USUARIO ||
    bytesVivos + payloadBytes > BYTES_MAXIMOS_POR_USUARIO
  ) {
    throw new AiCallError(
      'PROVIDER',
      'La cola de IA está llena; inténtalo de nuevo más tarde',
      'QUEUE_CAPACITY'
    );
  }

  ensureWorker();
  const id = input.id ?? nanoid();
  const configId = input.configId === undefined ? (input.config?.id ?? null) : input.configId;
  const resolveRef: { current: (value: T) => void } = { current: () => undefined };
  const rejectRef: { current: (reason: unknown) => void } = { current: () => undefined };
  const result = new Promise<T>((resolve, reject) => {
    resolveRef.current = resolve;
    rejectRef.current = reject;
  });
  const runtime: AiRuntime<T> = {
    userId: input.userId,
    householdId,
    configId,
    config: input.config ? { ...input.config } : null,
    run: input.run,
    failureCode: input.failureCode,
    payloadBytes,
    resolve: resolveRef.current,
    reject: rejectRef.current,
    settled: false
  };
  db.prepare(
    `INSERT INTO ai_jobs (id, user_id, household_id, config_id, kind, status, max_attempts, queue_order)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`
  ).run(
    id,
    input.userId,
    householdId,
    configId,
    input.kind.slice(0, 64),
    maxIntentos(input.config, input.kind),
    siguienteOrden(db, configId)
  );
  trabajosEnMemoria.set(id, runtime);
  if (input.externalSignal) {
    const cancelar = () => void cancelarTrabajo(db, input.userId, configId ?? '', id);
    if (input.externalSignal.aborted) cancelar();
    else {
      input.externalSignal.addEventListener('abort', cancelar, { once: true });
      runtime.removeExternalAbort = () =>
        input.externalSignal?.removeEventListener('abort', cancelar);
    }
  }
  despertarWorker();
  return { id, result };
}

/** Cola pública para todos los callers de IA: captura una vez el proveedor/configuración activa. */
export function dispatchAI(
  userId: string,
  messages: AiMessage[],
  db: SqlDb,
  responseFormat: AiResponseFormat,
  kind: AiJobKind = 'recipe',
  _externalSignal?: AbortSignal,
  householdId?: string | null
): Promise<string> {
  // Callers with a captured household scope must never resolve configuration from a later
  // `users.household_id` selection; otherwise a switch while building the prompt can cross homes.
  const functionKey = aiFunctionForJobKind(kind);
  const config = functionKey
    ? householdId === undefined
      ? activeAiConfigForFunction(db, userId, functionKey)
      : activeAiConfigForFunctionInScope(db, userId, householdId, functionKey)
    : undefined;
  if (!config)
    return Promise.reject(new AiCallError('NO_CONFIG', 'No active AI configuration found'));
  const payloadBytes = Buffer.byteLength(
    JSON.stringify({ messages, response_format: responseFormat }),
    'utf8'
  );
  return submitAiTask({
    db,
    userId,
    householdId,
    config,
    kind,
    payloadBytes,
    run: (_fixedConfig, signal, jobId) =>
      callAIWithConfig(config, messages, responseFormat, signal, {
        jobId,
        onDiagnostic: (diagnostic) => persistAiProviderDiagnostic(db, jobId, diagnostic)
      })
  }).result;
}

export function dispatchAIStreaming(
  userId: string,
  messages: AiMessage[],
  db: SqlDb,
  onDelta: (text: string) => void,
  responseFormat: AiResponseFormat,
  _externalSignal: AbortSignal
): Promise<string> {
  const config = activeAiConfigForFunction(db, userId, 'shopping_pantry');
  if (!config)
    return Promise.reject(new AiCallError('NO_CONFIG', 'No active AI configuration found'));
  return submitAiTask({
    db,
    userId,
    config,
    kind: 'receipt',
    payloadBytes: Buffer.byteLength(
      JSON.stringify({ messages, response_format: responseFormat }),
      'utf8'
    ),
    run: (_fixedConfig, signal, jobId) =>
      callAIStreamingWithConfig(config, messages, onDelta, responseFormat, signal, {
        jobId,
        onDiagnostic: (diagnostic) => persistAiProviderDiagnostic(db, jobId, diagnostic)
      })
  }).result;
}

export function dispatchPingDeConexion(
  probe: { base_url: string; api_key: string; model: string; timeout?: number | null },
  context: { db: SqlDb; userId: string; config: AiConfigRow; configId: string | null }
): Promise<
  { ok: true; latency: number; message: string } | { ok: false; latency: number; error: string }
> {
  const jobId = nanoid();
  return submitAiTask({
    db: context.db,
    id: jobId,
    userId: context.userId,
    config: context.config,
    configId: context.configId,
    kind: 'connection_test',
    run: (_fixedConfig, signal) =>
      pingDeConexionTransport({
        ...probe,
        jobId,
        signal,
        onDiagnostic: (diagnostic) => persistAiProviderDiagnostic(context.db, jobId, diagnostic)
      }),
    failureCode: (result) => (result.ok ? null : 'PROVIDER')
  }).result;
}

export function persistAiProviderDiagnostic(
  db: SqlDb,
  jobId: string,
  diagnostic: AiConnectionTestDiagnostic
): void {
  const responseId =
    diagnostic.providerResponseId &&
    /^resp_[A-Za-z0-9_-]{1,128}$/.test(diagnostic.providerResponseId)
      ? diagnostic.providerResponseId
      : null;
  const transport =
    diagnostic.providerTransport === 'responses_background' ||
    diagnostic.providerTransport === 'chat_completions'
      ? diagnostic.providerTransport
      : null;
  const status =
    Number.isInteger(diagnostic.providerHttpStatus) &&
    Number(diagnostic.providerHttpStatus) >= 100 &&
    Number(diagnostic.providerHttpStatus) <= 599
      ? diagnostic.providerHttpStatus
      : null;
  const elapsedMs = Number.isSafeInteger(diagnostic.elapsedMs)
    ? Math.max(0, diagnostic.elapsedMs)
    : 0;
  const stage = new Set([
    'submitting',
    'queued',
    'polling',
    'completed',
    'failed',
    'timed_out',
    'cancelled',
    'fallback'
  ]).has(diagnostic.diagnosticStage)
    ? diagnostic.diagnosticStage
    : 'failed';
  const providerError = sanitizeProviderErrorFields({
    type: diagnostic.providerErrorType,
    code: diagnostic.providerErrorCode,
    param: diagnostic.providerErrorParam
  });
  db.prepare(
    `UPDATE ai_jobs SET provider_response_id = ?, provider_transport = ?, provider_http_status = ?,
       provider_error_type = ?, provider_error_code = ?, provider_error_param = ?,
       elapsed_ms = ?, diagnostic_stage = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'running'`
  ).run(
    responseId,
    transport,
    status,
    providerError.type ?? null,
    providerError.code ?? null,
    providerError.param ?? null,
    elapsedMs,
    stage,
    jobId
  );
}

/** Tickets keep their durable file/receipt reference while sharing the same provider scheduler. */
export function encolarTicket(db: SqlDb, userId: string, receiptId: string): string {
  const receipt = db
    .prepare('SELECT household_id FROM receipts WHERE id = ? AND user_id = ?')
    .get(receiptId, userId) as { household_id: string | null } | undefined;
  if (!receipt) throw new AiCallError('PROVIDER', 'Receipt not found', 'RECEIPT_NOT_FOUND');
  const householdId = receipt.household_id;
  const config =
    activeAiConfigForFunctionInScope(db, userId, householdId, 'shopping_pantry') ?? null;
  const id = nanoid();
  const configId = config?.id ?? null;
  db.prepare(
    `INSERT INTO ai_jobs
      (id, user_id, household_id, config_id, kind, receipt_id, status, max_attempts, queue_order)
     VALUES (?, ?, ?, ?, 'receipt', ?, 'queued', ?, ?)`
  ).run(
    id,
    userId,
    householdId,
    configId,
    receiptId,
    maxIntentos(config),
    siguienteOrden(db, configId)
  );
  ensureWorker();
  despertarWorker();
  return id;
}

/** Arranca la cola si no estaba arrancada (idempotente) y devuelve su estado. */
export function ensureWorker(): Trabajador {
  if (trabajador) return trabajador;
  barrerArranque();
  const estado: Trabajador = {
    temporizador: setInterval(paso, QUEUE_RECONCILIATION_INTERVAL_MS),
    despertador: null,
    corriendo: new Set(),
    señales: new Map()
  };
  estado.temporizador.unref?.();
  trabajador = estado;
  // Recover durable receipt jobs on startup without waiting for the safety sweep.
  despertarWorker();
  return estado;
}

/** Stop the local worker (test/process teardown); active requests are aborted, never detached. */
export function stopWorker(): void {
  if (!trabajador) return;
  const estado = trabajador;
  clearInterval(estado.temporizador);
  if (estado.despertador) clearTimeout(estado.despertador);
  for (const controller of estado.señales.values()) controller.abort();
  for (const runtime of trabajosEnMemoria.values()) {
    rechazar(runtime, new AiCallError('PROVIDER', 'Queue worker stopped', 'CANCELLED'));
    clearTimeout(runtime.retryWindowTimer);
  }
  trabajador = null;
  trabajosEnMemoria.clear();
}

/** Reconciles restart-safe receipts; generic payloads cannot be restored from metadata alone. */
export function barrerArranque(db: SqlDb = getDatabase()): number {
  const info = db
    .prepare(
      `UPDATE ai_jobs SET status = 'queued', claim_generation = claim_generation + 1, updated_at = CURRENT_TIMESTAMP
       WHERE kind = 'receipt' AND status = 'running'`
    )
    .run();
  const genericos = db
    .prepare(
      `SELECT id FROM ai_jobs WHERE kind != 'receipt' AND status IN ('queued', 'running', 'failed')`
    )
    .all() as { id: string }[];
  let inputsPerdidos = 0;
  for (const { id } of genericos) {
    if (trabajosEnMemoria.has(id)) continue;
    const fallo = db
      .prepare(
        `UPDATE ai_jobs SET status = 'failed', error_code = 'INPUT_EXPIRED', error_detail = NULL,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status IN ('queued', 'running', 'failed')`
      )
      .run(id);
    inputsPerdidos += fallo.changes;
  }
  // A saved provider test is not resumable: its request closure and response are volatile. Release
  // its durable lock on restart so the UI cannot remain stuck at `testing` forever.
  const pruebasInterrumpidas = db
    .prepare(
      `UPDATE ai_configs SET test_status = 'failed',
         test_error = 'La prueba se interrumpió al reiniciar el servidor.',
         last_tested = CURRENT_TIMESTAMP
       WHERE test_status = 'testing'`
    )
    .run();
  if (info.changes > 0) {
    db.prepare(
      `UPDATE receipts SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE status = 'analyzing'`
    ).run();
  }
  return info.changes + inputsPerdidos + pruebasInterrumpidas.changes;
}

/** Máximo de trabajos IA en vuelo; `0` significa que no hay un límite configurado. */
export function concurrenciaDe(db: SqlDb, userId: string): number {
  const activa = activeAiConfig(db, userId);
  const tope = Number(activa?.concurrency ?? 0);
  if (tope === 0) return Number.POSITIVE_INFINITY;
  return Number.isInteger(tope) && tope > 0 ? Math.min(tope, 8) : 0;
}

/** Un paso del bucle: lanza trabajos hasta llenar la concurrencia de cada configuracion. */
function paso(): void {
  const estado = trabajador;
  if (!estado) return;
  let db: SqlDb;
  try {
    db = getDatabase();
    if (!db.open) return;
  } catch {
    return;
  }
  const grupos = db
    .prepare(`SELECT DISTINCT config_id FROM ai_jobs WHERE status = 'queued' ORDER BY config_id`)
    .all() as { config_id: string | null }[];
  for (const { config_id: configId } of grupos) {
    const config = configId
      ? (db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(configId) as
          AiConfigRow | undefined)
      : undefined;
    if (configId && !config) {
      const orphaned = db
        .prepare("SELECT id FROM ai_jobs WHERE config_id = ? AND status = 'queued'")
        .all(configId) as { id: string }[];
      db.prepare(
        `UPDATE ai_jobs SET status = 'stopped', error_code = 'CONFIG_UNAVAILABLE',
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE config_id = ? AND status = 'queued'`
      ).run(configId);
      db.prepare(
        `UPDATE receipts SET status = 'stopped', error_code = 'CONFIG_UNAVAILABLE',
           updated_at = CURRENT_TIMESTAMP
         WHERE id IN (SELECT receipt_id FROM ai_jobs WHERE config_id = ? AND status = 'stopped')
           AND status = 'queued'`
      ).run(configId);
      for (const { id } of orphaned) {
        const runtime = trabajosEnMemoria.get(id);
        if (!runtime) continue;
        rechazar(
          runtime,
          new AiCallError(
            'PROVIDER',
            'AI provider configuration is unavailable',
            'CONFIG_UNAVAILABLE'
          )
        );
        liberarRuntime(id, true);
      }
      continue;
    }

    const maximo = config ? limiteDe(config.concurrency) : configId ? 0 : 1;
    const enMarcha = (
      db
        .prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE config_id IS ? AND status = 'running'")
        .get(configId) as { n: number }
    ).n;
    const disponibles = maximo === Number.POSITIVE_INFINITY ? 100 : Math.max(0, maximo - enMarcha);
    if (disponibles === 0) continue;
    const enCola = db
      .prepare(
        `SELECT id, user_id, kind, receipt_id FROM ai_jobs WHERE status = 'queued' AND config_id IS ?
         ORDER BY queue_order, created_at, id LIMIT ?`
      )
      .all(configId, Math.min(100, disponibles)) as {
      id: string;
      user_id: string;
      kind: string;
      receipt_id: string | null;
    }[];
    for (const trabajo of enCola) {
      const durableReceipt = trabajo.kind === 'receipt' && Boolean(trabajo.receipt_id);
      // Generic payload closures exist only in this process. A different worker sharing SQLite
      // must never claim them and turn a live caller's job into INPUT_EXPIRED.
      if (!durableReceipt && !trabajosEnMemoria.has(trabajo.id)) continue;
      const runtime = trabajosEnMemoria.get(trabajo.id);
      const timeoutMs = runtime ? runtime.config?.timeout : config?.timeout;
      const claimGeneration = reclamarTrabajo(
        db,
        trabajo.id,
        aiJobLeaseSeconds(timeoutMs, trabajo.kind)
      );
      if (!claimGeneration) {
        const persisted = db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get(trabajo.id) as
          { status: string } | undefined;
        const runtime = trabajosEnMemoria.get(trabajo.id);
        if (persisted?.status === 'stopped' && runtime) {
          rechazar(
            runtime,
            new AiCallError(
              'PROVIDER',
              'AI provider configuration is unavailable',
              'CONFIG_DISABLED'
            )
          );
          liberarRuntime(trabajo.id, true);
        }
        continue;
      }
      lanzar(trabajo.id, trabajo.user_id, claimGeneration);
    }
  }
}

function limiteDe(value: unknown): number {
  const tope = Number(value ?? 0);
  if (tope === 0) return Number.POSITIVE_INFINITY;
  return Number.isInteger(tope) && tope > 0 ? Math.min(tope, 8) : 0;
}

function esperarReintentoManual(
  db: SqlDb,
  jobId: string,
  runtime: AiRuntime,
  error: unknown,
  fallback?: unknown
): boolean {
  const config = runtime.configId
    ? (aiConfigForPinnedJob(db, runtime.configId, runtime.userId, runtime.householdId) as
        { concurrency: number | null } | undefined)
    : undefined;
  if (!config || limiteDe(config.concurrency) === Number.POSITIVE_INFINITY) return false;
  clearTimeout(runtime.retryWindowTimer);
  runtime.retryError = error;
  runtime.retryFallback = fallback;
  runtime.retryFallbackSet = fallback !== undefined;
  runtime.retryWindowTimer = setTimeout(() => {
    db.prepare(
      `UPDATE ai_jobs SET error_code = 'INPUT_EXPIRED', error_detail = NULL,
         updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'failed'`
    ).run(jobId);
    if (runtime.retryFallbackSet) resolver(runtime, runtime.retryFallback);
    else rechazar(runtime, runtime.retryError);
    trabajosEnMemoria.delete(jobId);
  }, VENTANA_REINTENTO_MANUAL_MS);
  runtime.retryWindowTimer.unref?.();
  return true;
}

/** Atomically enforces the provider cap inside this process's shared dispatcher. */
function reclamarTrabajo(db: SqlDb, jobId: string, leaseSeconds: number): number | null {
  return db
    .transaction(() => {
      const fila = db
        .prepare(
          "SELECT id, config_id, user_id, household_id, kind, claim_generation FROM ai_jobs WHERE id = ? AND status = 'queued'"
        )
        .get(jobId) as
        | {
            id: string;
            config_id: string | null;
            user_id: string;
            household_id: string | null;
            kind: string;
            claim_generation: number;
          }
        | undefined;
      if (!fila) return null;
      if (fila.config_id) {
        const config = aiConfigForPinnedJob(db, fila.config_id, fila.user_id, fila.household_id) as
          { concurrency: number | null; is_active: number } | undefined;
        if (!config) {
          db.prepare(
            `UPDATE ai_jobs SET status = 'stopped', error_code = 'CONFIG_UNAVAILABLE',
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'queued'`
          ).run(jobId);
          return null;
        }
        if (config.is_active !== 1 && fila.kind !== 'connection_test') {
          db.prepare(
            `UPDATE ai_jobs SET status = 'stopped', error_code = 'CONFIG_DISABLED',
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'queued'`
          ).run(jobId);
          return null;
        }
        const cap = limiteDe(config.concurrency);
        const activos = (
          db
            .prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE config_id = ? AND status = 'running'")
            .get(fila.config_id) as { n: number }
        ).n;
        if (cap !== Number.POSITIVE_INFINITY && activos >= cap) return null;
      }
      const claimGeneration = Number(fila.claim_generation ?? 0) + 1;
      const changed = db
        .prepare(
          `UPDATE ai_jobs SET status = 'running', attempts = attempts + 1, claim_generation = ?,
           provider_response_id = NULL, provider_transport = NULL, provider_http_status = NULL,
           provider_error_type = NULL, provider_error_code = NULL, provider_error_param = NULL,
           elapsed_ms = NULL, diagnostic_stage = NULL,
           started_at = CURRENT_TIMESTAMP, lease_until = datetime('now', ?),
           updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'queued'`
        )
        .run(claimGeneration, `+${leaseSeconds} seconds`, jobId).changes;
      return changed === 1 ? claimGeneration : null;
    })
    .immediate();
}

function lanzar(jobId: string, userId: string, claimGeneration: number): void {
  const estado = ensureWorker();
  estado.corriendo.add(jobId);
  const señal = new AbortController();
  estado.señales.set(jobId, señal);
  void correr(jobId, userId, señal, claimGeneration).finally(() => {
    estado.corriendo.delete(jobId);
    estado.señales.delete(jobId);
    if (trabajador === estado) despertarWorker();
  });
}

async function correr(
  jobId: string,
  userId: string,
  señal: AbortController,
  claimGeneration: number
): Promise<void> {
  const db = getDatabase();
  const metadata = db
    .prepare(
      'SELECT kind, config_id, household_id, receipt_id, status, claim_generation FROM ai_jobs WHERE id = ?'
    )
    .get(jobId) as
    | {
        kind: string;
        config_id: string | null;
        household_id: string | null;
        receipt_id: string | null;
        status: string;
        claim_generation: number;
      }
    | undefined;
  if (metadata?.status !== 'running' || metadata.claim_generation !== claimGeneration) return;
  if (metadata.kind !== 'receipt' || !metadata.receipt_id) {
    await correrTrabajoGenerico(
      db,
      jobId,
      metadata.config_id,
      metadata.household_id,
      metadata.kind,
      señal.signal,
      claimGeneration
    );
    return;
  }

  const recibo = db
    .prepare(
      `SELECT r.* FROM receipts r JOIN ai_jobs j ON j.receipt_id = r.id
       WHERE j.id = ? AND r.household_id IS j.household_id`
    )
    .get(jobId) as
    | {
        id: string;
        household_id: string | null;
        file_url: string;
        file_kind: 'png' | 'jpeg' | 'webp' | 'pdf';
        ai_output_language: 'es' | 'en';
        status: string;
      }
    | undefined;
  if (!recibo) {
    db.prepare(
      `UPDATE ai_jobs SET status = 'failed', error_code = 'RECEIPT_NOT_FOUND',
         finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running' AND claim_generation = ?`
    ).run(jobId, claimGeneration);
    return;
  }
  const iniciado = db.transaction(() => {
    const vigente = db
      .prepare(`SELECT 1 FROM ai_jobs WHERE id = ? AND status = 'running' AND claim_generation = ?`)
      .get(jobId, claimGeneration);
    if (!vigente) return false;
    db.prepare(
      `UPDATE receipts SET status = 'analyzing', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(recibo.id);
    // Una lectura que empieza, empieza limpia: las lineas de un intento anterior no se mezclan.
    db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').run(recibo.id);
    return true;
  })();
  if (!iniciado) return;

  try {
    const configuracion = metadata.config_id
      ? (aiConfigForPinnedJob(db, metadata.config_id, userId, metadata.household_id) as
          AiConfigRow | undefined)
      : undefined;
    if (!configuracion)
      throw new AiCallError('NO_CONFIG', 'No AI configuration was pinned to this job');

    const fichero = leerTicket(recibo.file_url);
    if (!fichero)
      throw new AiCallError(
        'PROVIDER',
        'El fichero del ticket ya no esta en el servidor',
        'FILE_MISSING'
      );

    const inventarioJson = buildInventarioJson(inventarioDeLaCasa(db, userId, recibo.household_id));
    const { system, user } = buildTicketPrompt({
      esPdf: recibo.file_kind === 'pdf',
      language: recibo.ai_output_language === 'en' ? 'en' : 'es'
    });
    const ticketPart: AiMessagePart =
      recibo.file_kind === 'pdf'
        ? {
            type: 'file',
            file: {
              filename: 'ticket.pdf',
              file_data: `data:application/pdf;base64,${fichero.toString('base64')}`
            }
          }
        : {
            type: 'image_url',
            image_url: {
              url: `data:image/${recibo.file_kind === 'jpeg' ? 'jpeg' : recibo.file_kind};base64,${fichero.toString('base64')}`,
              detail: 'high'
            }
          };
    const inventarioPart: AiMessagePart = {
      type: 'file',
      file: {
        filename: 'inventario.json',
        file_data: `data:application/json;base64,${Buffer.from(inventarioJson, 'utf8').toString('base64')}`
      }
    };
    const contenido: AiMessagePart[] = [{ type: 'text', text: user }, ticketPart, inventarioPart];

    const mensajes: AiMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: contenido }
    ];
    const respuesta = await callAIWithConfig(
      configuracion,
      mensajes,
      RECEIPT_RESPONSE_FORMAT,
      señal.signal,
      {
        jobId,
        onDiagnostic: (diagnostic) => persistAiProviderDiagnostic(db, jobId, diagnostic)
      }
    );

    const validado = ticketAnswerSchema.safeParse(extractJsonObject(respuesta));
    if (!validado.success) {
      throw new AiCallError(
        'BAD_JSON',
        'La respuesta del modelo no cuadra con lo que se le pidio',
        JSON.stringify(validado.error.issues.slice(0, 4))
      );
    }

    // Solo se persiste el objeto completo después de validar el esquema y el job vigente.
    db.transaction(() => {
      const sigueActivo = db
        .prepare(
          "SELECT 1 AS activo FROM ai_jobs WHERE id = ? AND status = 'running' AND claim_generation = ?"
        )
        .get(jobId, claimGeneration);
      if (!sigueActivo) return;
      db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').run(recibo.id);
      let posicion = 0;
      for (const linea of deduplicateTicketLines(validado.data.lines, validado.data.totalMinor)) {
        insertarLinea(db, recibo.id, linea as unknown as Record<string, unknown>, posicion);
        posicion += 1;
      }

      const tienda = validado.data.store?.trim() || null;
      db.prepare(
        `UPDATE receipts SET status = 'review',
           store = CASE WHEN store_manual = 1 THEN store ELSE ? END,
           purchase_date = CASE WHEN purchase_date_manual = 1 THEN purchase_date ELSE ? END,
           currency = ?, total_minor = ?,
           warnings = ?, error_code = NULL, error_detail = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'analyzing'`
      ).run(
        tienda,
        validado.data.purchaseDate,
        validado.data.currency ?? 'EUR',
        validado.data.totalMinor ?? null,
        JSON.stringify(validado.data.warnings ?? []),
        recibo.id
      );
      const tiendaFinal = db.prepare('SELECT store FROM receipts WHERE id = ?').get(recibo.id) as
        { store: string | null } | undefined;
      if (tiendaFinal?.store) registrarTienda(db, userId, tiendaFinal.store, recibo.household_id);
      db.prepare(
        `UPDATE ai_jobs SET status = 'done', finished_at = CURRENT_TIMESTAMP, lease_until = NULL
         WHERE id = ? AND status = 'running' AND claim_generation = ?`
      ).run(jobId, claimGeneration);
    })();
  } catch (error) {
    const cancelado = señal.signal.aborted;
    const ficheroAusente = error instanceof AiCallError && error.detail === 'FILE_MISSING';
    const codigo = cancelado
      ? 'CANCELLED'
      : ficheroAusente
        ? 'FILE_MISSING'
        : error instanceof AiCallError
          ? error.code
          : 'PROVIDER';
    const detalle = cancelado
      ? 'Parado por la persona'
      : String((error as Error)?.message ?? error).slice(0, 300);
    const fila = db
      .prepare(
        "SELECT attempts, max_attempts, receipt_id, config_id FROM ai_jobs WHERE id = ? AND status = 'running' AND claim_generation = ?"
      )
      .get(jobId, claimGeneration) as
      | {
          attempts: number;
          max_attempts: number;
          receipt_id: string | null;
          config_id: string | null;
        }
      | undefined;
    const reintentosQuedan =
      !!fila &&
      !cancelado &&
      fila.attempts < fila.max_attempts &&
      codigo !== 'BAD_JSON' &&
      codigo !== 'NO_CONFIG' &&
      codigo !== 'FILE_MISSING' &&
      !(error instanceof AiCallError && !error.retryable);
    const actualizado = db
      .prepare(
        `UPDATE ai_jobs SET status = ?, error_code = ?, error_detail = ?, updated_at = CURRENT_TIMESTAMP,
         finished_at = ${reintentosQuedan ? 'NULL' : 'CURRENT_TIMESTAMP'}, lease_until = NULL,
         queue_order = CASE WHEN ? = 'queued' THEN ? ELSE queue_order END
       WHERE id = ? AND status = 'running' AND claim_generation = ?`
      )
      .run(
        reintentosQuedan ? 'queued' : 'failed',
        codigo,
        detalle,
        reintentosQuedan ? 'queued' : 'failed',
        siguienteOrden(db, fila?.config_id ?? null),
        jobId,
        claimGeneration
      );
    if (actualizado.changes > 0 && fila?.receipt_id) {
      db.prepare(
        `UPDATE receipts SET status = ?, error_code = ?, error_detail = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(
        reintentosQuedan ? 'queued' : cancelado ? 'stopped' : 'failed',
        codigo,
        detalle,
        fila.receipt_id
      );
    }
  }
}

async function correrTrabajoGenerico(
  db: SqlDb,
  jobId: string,
  configId: string | null,
  householdId: string | null,
  kind: string,
  signal: AbortSignal,
  claimGeneration: number
): Promise<void> {
  const runtime = trabajosEnMemoria.get(jobId);
  if (!runtime) {
    db.prepare(
      `UPDATE ai_jobs SET status = 'failed', error_code = 'INPUT_EXPIRED', error_detail = NULL,
         finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running' AND claim_generation = ?`
    ).run(jobId, claimGeneration);
    return;
  }
  if (runtime.configId !== configId || runtime.householdId !== householdId) {
    db.prepare(
      `UPDATE ai_jobs SET status = 'failed', error_code = 'JOB_SCOPE_MISMATCH', error_detail = NULL,
         finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running' AND claim_generation = ?`
    ).run(jobId, claimGeneration);
    rechazar(runtime, new AiCallError('PROVIDER', 'AI job scope changed', 'JOB_SCOPE_MISMATCH'));
    liberarRuntime(jobId, true);
    return;
  }
  const row = db
    .prepare('SELECT attempts, max_attempts, status, claim_generation FROM ai_jobs WHERE id = ?')
    .get(jobId) as
    | { attempts: number; max_attempts: number; status: string; claim_generation: number }
    | undefined;
  if (!row || row.status !== 'running' || row.claim_generation !== claimGeneration) return;

  try {
    const result = await runtime.run(runtime.config, signal, jobId);
    const vigente = db
      .prepare('SELECT status, claim_generation FROM ai_jobs WHERE id = ?')
      .get(jobId) as { status: string; claim_generation: number } | undefined;
    if (vigente?.claim_generation !== claimGeneration) return;
    if (signal.aborted || vigente?.status !== 'running') {
      rechazar(runtime, new AiCallError('PROVIDER', 'AI job cancelled', 'CANCELLED'));
      liberarRuntime(jobId, true);
      return;
    }

    const errorCode = runtime.failureCode?.(result) ?? null;
    if (errorCode && row.attempts < row.max_attempts) {
      db.prepare(
        `UPDATE ai_jobs SET status = 'queued', error_code = NULL, error_detail = NULL,
           queue_order = ?, lease_until = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'running' AND claim_generation = ?`
      ).run(siguienteOrden(db, configId), jobId, claimGeneration);
      return;
    }

    const status = errorCode ? 'failed' : 'done';
    const finalizado = db
      .prepare(
        `UPDATE ai_jobs SET status = ?, error_code = ?, error_detail = NULL,
         finished_at = CURRENT_TIMESTAMP, lease_until = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running' AND claim_generation = ?`
      )
      .run(status, errorCode, jobId, claimGeneration);
    if (!finalizado.changes) return;
    if (!errorCode) {
      resolver(runtime, result);
      liberarRuntime(jobId, true);
    } else if (
      kind === 'connection_test' ||
      !esperarReintentoManual(db, jobId, runtime, null, result)
    ) {
      resolver(runtime, result);
      liberarRuntime(jobId, true);
    }
  } catch (error) {
    const vigente = db
      .prepare('SELECT status, claim_generation FROM ai_jobs WHERE id = ?')
      .get(jobId) as { status: string; claim_generation: number } | undefined;
    if (vigente?.claim_generation !== claimGeneration) return;
    if (signal.aborted || vigente?.status !== 'running') {
      rechazar(runtime, error);
      liberarRuntime(jobId, true);
      return;
    }

    const errorCode = error instanceof AiCallError ? error.code : 'PROVIDER';
    const reintentable =
      errorCode !== 'NO_CONFIG' &&
      errorCode !== 'BAD_JSON' &&
      !(error instanceof AiCallError && !error.retryable) &&
      !(error instanceof AiCallError && error.detail === 'BACKGROUND_UNSUPPORTED');
    if (kind !== 'connection_test' && reintentable && row.attempts < row.max_attempts) {
      db.prepare(
        `UPDATE ai_jobs SET status = 'queued', error_code = NULL, error_detail = NULL,
           queue_order = ?, lease_until = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'running' AND claim_generation = ?`
      ).run(siguienteOrden(db, configId), jobId, claimGeneration);
      return;
    }
    db.prepare(
      `UPDATE ai_jobs SET status = 'failed', error_code = ?, error_detail = NULL,
         finished_at = CURRENT_TIMESTAMP, lease_until = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'running' AND claim_generation = ?`
    ).run(errorCode, jobId, claimGeneration);
    if (kind === 'connection_test' || !esperarReintentoManual(db, jobId, runtime, error)) {
      rechazar(runtime, error);
      liberarRuntime(jobId, true);
    }
  }
}

function insertarLinea(
  db: SqlDb,
  receiptId: string,
  linea: Record<string, unknown>,
  posicion: number
): void {
  const nombre = String(linea.name ?? '').trim();
  if (!nombre) return;
  const cantidad = Number(linea.quantity);
  const precio =
    linea.priceMinor === null || linea.priceMinor === undefined ? null : Number(linea.priceMinor);
  const oferta = (linea.offer ?? null) as { buy?: number; take?: number } | null;
  db.prepare(
    `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit, category, price_minor, offer_buy, offer_take, note, confidence, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nanoid(),
    receiptId,
    nombre,
    Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1,
    linea.unit ? String(linea.unit) : null,
    linea.category ? String(linea.category).trim().slice(0, 64) || 'other' : 'other',
    Number.isFinite(precio as number) && (precio as number) >= 0
      ? Math.trunc(precio as number)
      : null,
    oferta?.buy ?? null,
    oferta?.take ?? null,
    linea.note ? String(linea.note) : null,
    Number.isFinite(Number(linea.confidence)) ? Number(linea.confidence) : null,
    posicion
  );
}

/** El «inventario.json» de la casa: tiendas, categorias de la despensa y sus productos. */
export function inventarioDeLaCasa(
  db: SqlDb,
  userId: string,
  householdId = activeHouseholdId(db, userId)
): InventarioParaPrompt {
  ensureDefaultCategories(db, userId, householdId);

  const tiendas = (
    db
      .prepare(
        `SELECT DISTINCT name FROM stores
           WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)
         UNION SELECT DISTINCT store AS name FROM shopping_lists
           WHERE (household_id = ? OR (household_id IS NULL AND user_id = ?))
             AND store IS NOT NULL AND TRIM(store) <> ''
         ORDER BY name LIMIT 200`
      )
      .all(householdId, userId, householdId, userId) as { name: string }[]
  ).map((fila) => fila.name);

  const categorias = (
    db
      .prepare(
        `SELECT key, name, parent_key FROM pantry_categories
         WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)
         ORDER BY position`
      )
      .all(householdId, userId) as { key: string; name: string; parent_key: string | null }[]
  ).map((fila) => ({ clave: fila.key, nombre: fila.name, padre: fila.parent_key }));

  const productos = (
    db
      .prepare(
        `SELECT name, category, unit FROM ingredients
         WHERE household_id = ? OR (household_id IS NULL AND user_id = ?)
         ORDER BY name`
      )
      .all(householdId, userId) as { name: string; category: string; unit: string }[]
  ).map((fila) => ({ categoria: fila.category, nombre: fila.name, unidad: fila.unit }));

  return { tiendas, categorias, productos };
}

/** Registrar una tienda que no existe: la deteccion de un ticket la deja escrita. */
export function registrarTienda(
  db: SqlDb,
  userId: string,
  nombre: string,
  householdId = activeHouseholdId(db, userId)
): void {
  const limpia = nombre.trim();
  if (!limpia) return;
  const ya = db
    .prepare(
      `SELECT id FROM stores WHERE name = ?
       AND (household_id = ? OR (household_id IS NULL AND user_id = ?))`
    )
    .get(limpia, householdId, userId);
  if (ya) return;
  db.prepare('INSERT INTO stores (id, user_id, household_id, name) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    userId,
    householdId,
    limpia
  );
}

export type AiQueueJobDto = {
  id: string;
  configId: string;
  kind: string;
  status: 'queued' | 'running' | 'failed';
  attempts: number;
  maxAttempts: number;
  error: string | null;
  retryable: boolean;
  createdAt: string;
  queueOrder: number;
  providerResponseId: string | null;
  providerTransport: 'responses_background' | 'chat_completions' | null;
  providerHttpStatus: number | null;
  elapsedMs: number | null;
  diagnosticStage: AiConnectionTestDiagnostic['diagnosticStage'] | null;
};

export type AiActiveJobDto = {
  id: string;
  kind: string;
  status: 'queued' | 'running';
  createdAt: string;
  startedAt: string | null;
};

/** User-scoped activity indicator DTO; intentionally omits provider and payload diagnostics. */
export function activeAiJobsForUser(db: SqlDb, userId: string): AiActiveJobDto[] {
  const rows = db
    .prepare(
      `SELECT id, kind, status, created_at, started_at FROM ai_jobs
       WHERE user_id = ? AND status IN ('queued', 'running')
       ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, created_at, id`
    )
    .all(userId) as Array<{
    id: string;
    kind: string;
    status: 'queued' | 'running';
    created_at: string;
    started_at: string | null;
  }>;

  const jobs = rows.map(({ id, kind, status, created_at, started_at }) => ({
    id,
    kind,
    status,
    createdAt: created_at,
    startedAt: started_at
  }));

  // Planning automation has its own durable ledger instead of `ai_jobs`. Include only active
  // runs in households where the caller is still an active member; this keeps retry/scheduled
  // work visible after closing the initiating tab without exposing another household's state.
  const automationRuns = db
    .prepare(
      `SELECT runs.id, runs.created_at FROM household_planning_automation_runs runs
       JOIN household_members members ON members.household_id = runs.household_id
       WHERE members.user_id = ? AND members.is_active = 1 AND runs.status = 'in_progress'
       ORDER BY runs.created_at, runs.id`
    )
    .all(userId) as Array<{ id: string; created_at: string }>;
  jobs.push(
    ...automationRuns.map(({ id, created_at }) => ({
      id: `planning-automation:${id}`,
      kind: 'household_automation',
      status: 'running' as const,
      createdAt: created_at,
      startedAt: created_at
    }))
  );
  return jobs.sort(
    (left, right) =>
      Number(right.status === 'running') - Number(left.status === 'running') ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );
}

/** DTO whitelist: no key, prompts, attachments, result, or provider error body. */
export function queueForConfig(db: SqlDb, userId: string, configId: string): AiQueueJobDto[] {
  const scope = aiConfigScopeForUser(db, userId);
  const config = aiConfigByIdInScope(db, configId, scope) as
    { is_active: number; concurrency: number | null } | undefined;
  if (!config) return [];
  const managerEnabled =
    config?.is_active === 1 &&
    limiteDe(config.concurrency) !== Number.POSITIVE_INFINITY &&
    Number(config.concurrency ?? 0) > 0;
  return (
    db
      .prepare(
        `SELECT id, config_id, kind, status, attempts, max_attempts, error_code, created_at, queue_order,
           provider_response_id, provider_transport, provider_http_status, elapsed_ms, diagnostic_stage
         FROM ai_jobs WHERE user_id = ? AND household_id IS ? AND config_id = ?
           AND dismissed_at IS NULL
           AND status IN ('queued', 'running', 'failed')
         ORDER BY CASE status WHEN 'queued' THEN 0 WHEN 'running' THEN 1 ELSE 2 END,
           queue_order, created_at, id`
      )
      .all(userId, scope.householdId, configId) as Array<Record<string, unknown>>
  ).map((row) => {
    const jobId = String(row.id);
    const kind = String(row.kind);
    const status = row.status as AiQueueJobDto['status'];
    const runtime = trabajosEnMemoria.get(jobId);
    return {
      id: jobId,
      configId: String(row.config_id),
      kind,
      status,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      error: (row.error_code as string | null) ?? null,
      retryable:
        status === 'failed' &&
        kind !== 'connection_test' &&
        managerEnabled &&
        (kind === 'receipt' || Boolean(runtime?.retryWindowTimer)),
      createdAt: String(row.created_at),
      queueOrder: Number(row.queue_order),
      providerResponseId:
        kind === 'connection_test' &&
        typeof row.provider_response_id === 'string' &&
        /^resp_[A-Za-z0-9_-]{1,128}$/.test(row.provider_response_id)
          ? row.provider_response_id
          : null,
      providerTransport:
        kind === 'connection_test' &&
        (row.provider_transport === 'responses_background' ||
          row.provider_transport === 'chat_completions')
          ? row.provider_transport
          : null,
      providerHttpStatus:
        kind === 'connection_test' &&
        Number.isInteger(row.provider_http_status) &&
        Number(row.provider_http_status) >= 100 &&
        Number(row.provider_http_status) <= 599
          ? Number(row.provider_http_status)
          : null,
      elapsedMs:
        kind === 'connection_test' &&
        Number.isSafeInteger(row.elapsed_ms) &&
        Number(row.elapsed_ms) >= 0
          ? Number(row.elapsed_ms)
          : null,
      diagnosticStage:
        kind === 'connection_test' &&
        [
          'submitting',
          'queued',
          'polling',
          'completed',
          'failed',
          'timed_out',
          'cancelled',
          'fallback'
        ].includes(String(row.diagnostic_stage))
          ? (row.diagnostic_stage as AiConnectionTestDiagnostic['diagnosticStage'])
          : null
    };
  });
}

/** Requires the complete current waiting set, preventing partial/cross-provider reorder races. */
export function reordenarCola(
  db: SqlDb,
  userId: string,
  configId: string,
  jobIds: string[]
): boolean {
  const scope = aiConfigScopeForUser(db, userId);
  return db
    .transaction(() => {
      const queued = db
        .prepare(
          `SELECT id FROM ai_jobs WHERE user_id = ? AND household_id IS ?
           AND config_id = ? AND status = 'queued'
         ORDER BY queue_order, created_at, id`
        )
        .all(userId, scope.householdId, configId) as { id: string }[];
      if (new Set(jobIds).size !== jobIds.length || jobIds.length !== queued.length) return false;
      const expected = new Set(queued.map(({ id }) => id));
      if (jobIds.some((id) => !expected.has(id))) return false;
      const update = db.prepare(
        `UPDATE ai_jobs SET queue_order = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND household_id IS ? AND config_id = ? AND status = 'queued'`
      );
      jobIds.forEach((id, index) => update.run(index, id, userId, scope.householdId, configId));
      return true;
    })
    .immediate();
}

/** Atomically stop a queued/running job, abort its real provider fetch, and fence late writes. */
export function cancelarTrabajo(
  db: SqlDb,
  userId: string,
  configId: string,
  jobId: string
): boolean {
  const pinnedConfigId = configId || null;
  const row = db
    .transaction(() => {
      const job = db
        .prepare(
          `SELECT receipt_id, status FROM ai_jobs WHERE id = ? AND user_id = ? AND config_id IS ?
           AND status IN ('queued', 'running')`
        )
        .get(jobId, userId, pinnedConfigId) as
        { receipt_id: string | null; status: string } | undefined;
      if (!job) return null;
      const changed = db
        .prepare(
          `UPDATE ai_jobs SET status = 'stopped', claim_generation = claim_generation + 1, error_code = 'CANCELLED', error_detail = NULL,
           finished_at = CURRENT_TIMESTAMP, lease_until = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND config_id IS ? AND status IN ('queued', 'running')`
        )
        .run(jobId, userId, pinnedConfigId).changes;
      if (!changed) return null;
      if (job.receipt_id) {
        db.prepare(
          `UPDATE receipts SET status = 'stopped', error_code = 'CANCELLED', error_detail = NULL,
           updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('queued', 'analyzing')`
        ).run(job.receipt_id);
      }
      return job;
    })
    .immediate();
  if (!row) return false;

  trabajador?.señales.get(jobId)?.abort();
  const runtime = trabajosEnMemoria.get(jobId);
  if (runtime) {
    rechazar(runtime, new AiCallError('PROVIDER', 'AI job cancelled', 'CANCELLED'));
    liberarRuntime(jobId, true);
  }
  return true;
}

/** Deactivation/deletion cancels only jobs for that owned provider; other config queues continue. */
export function cancelarColaDeConfiguracion(
  db: SqlDb,
  userId: string,
  configId: string
): { cancelados: number; detenidos: number } {
  const ids = db
    .prepare(
      `SELECT id, status FROM ai_jobs WHERE user_id = ? AND config_id = ?
         AND status IN ('queued', 'running')`
    )
    .all(userId, configId) as { id: string; status: string }[];
  let cancelados = 0;
  let detenidos = 0;
  for (const job of ids) {
    if (cancelarTrabajo(db, userId, configId, job.id)) {
      if (job.status === 'running') cancelados += 1;
      else detenidos += 1;
    }
  }
  cerrarVentanasReintentoConfiguracion(db, userId, configId, 'CONFIG_DISABLED');
  return { cancelados, detenidos };
}

/** Resolve stale synchronous callers when a provider becomes unavailable or its manager is hidden. */
export function cerrarVentanasReintentoConfiguracion(
  db: SqlDb,
  userId: string,
  configId: string,
  code = 'CONFIG_DISABLED'
): void {
  const failed = db
    .prepare(`SELECT id FROM ai_jobs WHERE user_id = ? AND config_id = ? AND status = 'failed'`)
    .all(userId, configId) as { id: string }[];
  for (const { id } of failed) {
    const runtime = trabajosEnMemoria.get(id);
    if (!runtime?.retryWindowTimer) continue;
    if (runtime.retryFallbackSet) resolver(runtime, runtime.retryFallback);
    else rechazar(runtime, new AiCallError('PROVIDER', 'AI provider configuration changed', code));
    liberarRuntime(id, true);
  }
}

export type RetryAiJobResult =
  'queued' | 'not-found' | 'not-failed' | 'input-expired' | 'config-unavailable';

/** Manual retry always starts a fresh attempts budget; generic inputs must still be in RAM. */
export function reintentarTrabajo(
  db: SqlDb,
  userId: string,
  configId: string,
  jobId: string
): RetryAiJobResult {
  const scope = aiConfigScopeForUser(db, userId);
  if (!aiConfigByIdInScope(db, configId, scope)) return 'not-found';
  const row = db
    .prepare(
      `SELECT kind, receipt_id, household_id, status FROM ai_jobs
       WHERE id = ? AND user_id = ? AND household_id IS ? AND config_id = ?`
    )
    .get(jobId, userId, scope.householdId, configId) as
    | {
        kind: string;
        receipt_id: string | null;
        household_id: string | null;
        status: string;
      }
    | undefined;
  if (!row) return 'not-found';
  if (row.status !== 'failed') return 'not-failed';
  const runtime = trabajosEnMemoria.get(jobId);
  if (row.kind !== 'receipt' && (!runtime || !runtime.retryWindowTimer)) return 'input-expired';
  const config = aiConfigByIdInScope(db, configId, scope) as
    { retry_attempts: number | null; concurrency: number | null; is_active: number } | undefined;
  if (!config || config.is_active !== 1 || Number(config.concurrency ?? 0) <= 0)
    return 'config-unavailable';
  const info = db
    .transaction(() => {
      const changed = db
        .prepare(
          `UPDATE ai_jobs SET status = 'queued', attempts = 0, max_attempts = ?, error_code = NULL,
           error_detail = NULL, provider_response_id = NULL, provider_transport = NULL,
           provider_http_status = NULL, provider_error_type = NULL, provider_error_code = NULL,
           provider_error_param = NULL, elapsed_ms = NULL, diagnostic_stage = NULL,
           dismissed_at = NULL,
           finished_at = NULL, lease_until = NULL, queue_order = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND household_id IS ? AND config_id = ? AND status = 'failed'`
        )
        .run(
          maxIntentos({ retry_attempts: config.retry_attempts } as AiConfigRow, row.kind),
          siguienteOrden(db, configId),
          jobId,
          userId,
          scope.householdId,
          configId
        );
      if (!changed.changes) return false;
      if (row.receipt_id) {
        db.prepare(
          `UPDATE receipts SET status = 'queued', error_code = NULL, error_detail = NULL,
           updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'failed'`
        ).run(row.receipt_id);
      }
      return true;
    })
    .immediate();
  if (!info) return 'not-failed';
  if (runtime) {
    clearTimeout(runtime.retryWindowTimer);
    runtime.retryWindowTimer = undefined;
    runtime.retryError = undefined;
    runtime.retryFallback = undefined;
    runtime.retryFallbackSet = false;
  }
  ensureWorker();
  despertarWorker();
  return 'queued';
}

/** Legacy ticket route permits retrying stopped/review tickets; it also resets the retry budget. */
export function reencolar(jobId: string): boolean {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT user_id, household_id, config_id, status, kind, receipt_id FROM ai_jobs WHERE id = ?'
    )
    .get(jobId) as
    | {
        user_id: string;
        household_id: string | null;
        config_id: string | null;
        status: string;
        kind: string;
        receipt_id: string | null;
      }
    | undefined;
  if (!row || !['failed', 'stopped', 'done'].includes(row.status)) return false;
  if (activeHouseholdId(db, row.user_id) !== row.household_id) return false;
  if (row.kind !== 'receipt' && !trabajosEnMemoria.has(jobId)) return false;
  const config = row.config_id
    ? (aiConfigForPinnedJob(db, row.config_id, row.user_id, row.household_id) as
        { retry_attempts: number | null } | undefined)
    : undefined;
  const changed = db
    .prepare(
      `UPDATE ai_jobs SET status = 'queued', attempts = 0, max_attempts = ?, error_code = NULL,
         error_detail = NULL, provider_response_id = NULL, provider_transport = NULL,
         provider_http_status = NULL, provider_error_type = NULL, provider_error_code = NULL,
         provider_error_param = NULL, elapsed_ms = NULL, diagnostic_stage = NULL,
         dismissed_at = NULL,
         finished_at = NULL, queue_order = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status IN ('failed', 'stopped', 'done')`
    )
    .run(
      config ? maxIntentos({ retry_attempts: config.retry_attempts } as AiConfigRow, row.kind) : 1,
      siguienteOrden(db, row.config_id),
      jobId
    ).changes;
  if (!changed) return false;
  if (row.receipt_id) {
    db.prepare(
      `UPDATE receipts SET status = 'queued', error_code = NULL, error_detail = NULL,
         updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('failed', 'stopped', 'review', 'confirmed')`
    ).run(row.receipt_id);
  }
  ensureWorker();
  despertarWorker();
  return true;
}

/** Legacy ticket-stop compatibility, now backed by persisted cancellation and fetch abort. */
export function pararTrabajo(jobId: string): boolean {
  const db = getDatabase();
  const row = db
    .prepare('SELECT user_id, household_id, config_id FROM ai_jobs WHERE id = ?')
    .get(jobId) as
    { user_id: string; household_id: string | null; config_id: string | null } | undefined;
  if (!row) return false;
  if (activeHouseholdId(db, row.user_id) !== row.household_id) return false;
  if (!row.config_id) {
    const changed = db
      .prepare(
        `UPDATE ai_jobs SET status = 'stopped', claim_generation = claim_generation + 1, error_code = 'CANCELLED',
         finished_at = CURRENT_TIMESTAMP, lease_until = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')`
      )
      .run(jobId, row.user_id).changes;
    if (!changed) return false;
    trabajador?.señales.get(jobId)?.abort();
    const runtime = trabajosEnMemoria.get(jobId);
    if (runtime) {
      rechazar(runtime, new AiCallError('PROVIDER', 'AI job cancelled', 'CANCELLED'));
      liberarRuntime(jobId, true);
    }
    return true;
  }
  return cancelarTrabajo(db, row.user_id, row.config_id, jobId);
}

/** Stop every queued/running job belonging to a user, including generic model requests. */
export function pararTodo(userId: string): { cancelados: number; detenidos: number } {
  const db = getDatabase();
  const householdId = activeHouseholdId(db, userId);
  const jobs = db
    .prepare(
      `SELECT id, config_id, household_id, status FROM ai_jobs WHERE user_id = ?
         AND (household_id IS ? OR household_id IS NULL)
         AND status IN ('queued', 'running')`
    )
    .all(userId, householdId) as {
    id: string;
    config_id: string | null;
    household_id: string | null;
    status: string;
  }[];
  let cancelados = 0;
  let detenidos = 0;
  for (const job of jobs) {
    if (!job.config_id) {
      const changed = db
        .prepare(
          `UPDATE ai_jobs SET status = 'stopped', claim_generation = claim_generation + 1, error_code = 'CANCELLED',
             finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ? AND status IN ('queued', 'running')`
        )
        .run(job.id, userId).changes;
      if (changed) {
        trabajador?.señales.get(job.id)?.abort();
        const runtime = trabajosEnMemoria.get(job.id);
        if (runtime) {
          rechazar(runtime, new AiCallError('PROVIDER', 'AI job cancelled', 'CANCELLED'));
          liberarRuntime(job.id, true);
        }
      }
      if (changed) job.status === 'running' ? (cancelados += 1) : (detenidos += 1);
      continue;
    }
    if (cancelarTrabajo(db, userId, job.config_id, job.id)) {
      job.status === 'running' ? (cancelados += 1) : (detenidos += 1);
    }
  }
  return { cancelados, detenidos };
}
