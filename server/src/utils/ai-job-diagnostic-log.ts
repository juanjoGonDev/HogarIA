import {
  isSafeProviderRequestId,
  isSafeProviderErrorCode,
  isSafeProviderErrorParam,
  isSafeProviderErrorType,
  sanitizeAiProviderRequestMetadata,
  sanitizeProviderErrorFields,
  type SafeProviderErrorReason
} from './ai-provider-diagnostic.js';

export type AiJobDiagnosticStage =
  | 'submitting'
  | 'queued'
  | 'polling'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'fallback';

export type AiJobDiagnosticLogEntry = Readonly<{
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  attempt: number;
  stage: AiJobDiagnosticStage;
  method: 'POST' | 'GET' | null;
  provider_transport: 'responses_background' | 'chat_completions' | null;
  provider_request_id: string | null;
  provider_response_id: string | null;
  provider_http_status: number | null;
  provider_error_type: string | null;
  provider_error_code: string | null;
  provider_error_param: string | null;
  provider_error_reason: SafeProviderErrorReason | null;
  elapsed_ms: number | null;
  request_metadata: Readonly<{
    model: string | null;
    background: boolean;
    output_format: 'json_schema' | 'json_object' | 'unknown';
    input_part_counts: Readonly<{ text: number; image: number; file: number }>;
  }> | null;
}>;

export type AiProviderDiagnosticInput = Readonly<{
  providerResponseId?: unknown;
  providerTransport?: unknown;
  providerHttpStatus?: unknown;
  elapsedMs?: unknown;
  providerErrorType?: unknown;
  providerErrorCode?: unknown;
  providerErrorParam?: unknown;
  providerRequestId?: unknown;
  providerErrorReason?: unknown;
  requestMethod?: unknown;
  requestMetadata?: unknown;
  diagnosticStage?: unknown;
}>;

const DIAGNOSTIC_STAGES = new Set<AiJobDiagnosticStage>([
  'submitting',
  'queued',
  'polling',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
  'fallback'
]);
const PROVIDER_TRANSPORTS = new Set(['responses_background', 'chat_completions']);
const PROVIDER_ERROR_REASONS = new Set<SafeProviderErrorReason>([
  'unsupported_parameter',
  'invalid_type',
  'invalid_value',
  'model_not_found',
  'authentication',
  'permission',
  'rate_limit',
  'quota',
  'background_not_supported',
  'file_input_rejected',
  'invalid_request',
  'provider_rejected'
]);
const MAX_LOG_ENTRIES = 32;
const SAFE_RESPONSE_ID = /^resp_[A-Za-z0-9_-]{1,128}$/;

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function safeCount(value: unknown, max = 1000): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Math.min(Number(value), max) : 0;
}

function safeStatus(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? Number(value)
    : null;
}

function safeElapsed(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), 86_400_000)
    : null;
}

function eventFor(stage: AiJobDiagnosticStage, status: number | null): string {
  if (stage === 'submitting') return 'request_started';
  if (stage === 'queued') return 'provider_accepted';
  if (stage === 'polling')
    return status && status >= 400 ? 'provider_retrying' : 'response_polling';
  if (stage === 'completed') return 'request_completed';
  if (stage === 'failed') return status && status >= 400 ? 'provider_error' : 'request_failed';
  if (stage === 'timed_out') return 'request_timed_out';
  if (stage === 'cancelled') return 'request_cancelled';
  return 'fallback';
}

function levelFor(
  stage: AiJobDiagnosticStage,
  status: number | null
): AiJobDiagnosticLogEntry['level'] {
  if (stage === 'failed' || stage === 'timed_out') return 'error';
  if (stage === 'cancelled' || (stage === 'polling' && status !== null && status >= 400)) {
    return 'warn';
  }
  return 'info';
}

function safeRequestId(value: unknown): string | null {
  return isSafeProviderRequestId(value) ? value : null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createAiJobDiagnosticLogEntry(
  input: AiProviderDiagnosticInput,
  attempt: number,
  timestamp = new Date().toISOString()
): AiJobDiagnosticLogEntry {
  const stage = DIAGNOSTIC_STAGES.has(input.diagnosticStage as AiJobDiagnosticStage)
    ? (input.diagnosticStage as AiJobDiagnosticStage)
    : 'failed';
  const status = safeStatus(input.providerHttpStatus);
  const rawReason = input.providerErrorReason;
  const reason = PROVIDER_ERROR_REASONS.has(rawReason as SafeProviderErrorReason)
    ? (rawReason as SafeProviderErrorReason)
    : null;
  const transport = PROVIDER_TRANSPORTS.has(String(input.providerTransport))
    ? (input.providerTransport as 'responses_background' | 'chat_completions')
    : null;
  const requestMetadata = sanitizeAiProviderRequestMetadata(input.requestMetadata);
  const providerErrors = sanitizeProviderErrorFields({
    type: input.providerErrorType,
    code: input.providerErrorCode,
    param: input.providerErrorParam
  });
  return {
    timestamp: validTimestamp(timestamp) ? timestamp : new Date().toISOString(),
    level: levelFor(stage, status),
    event: eventFor(stage, status),
    attempt: safeCount(attempt),
    stage,
    method:
      input.requestMethod === 'POST' || input.requestMethod === 'GET' ? input.requestMethod : null,
    provider_transport: transport,
    provider_request_id:
      status !== null && status >= 400 ? safeRequestId(input.providerRequestId) : null,
    provider_response_id:
      typeof input.providerResponseId === 'string' &&
      SAFE_RESPONSE_ID.test(input.providerResponseId)
        ? input.providerResponseId
        : null,
    provider_http_status: status,
    provider_error_type: isSafeProviderErrorType(providerErrors.type)
      ? String(providerErrors.type)
      : null,
    provider_error_code: isSafeProviderErrorCode(providerErrors.code)
      ? String(providerErrors.code)
      : null,
    provider_error_param: isSafeProviderErrorParam(providerErrors.param)
      ? String(providerErrors.param)
      : null,
    provider_error_reason: reason,
    elapsed_ms: safeElapsed(input.elapsedMs),
    request_metadata: requestMetadata
      ? {
          model: requestMetadata.model,
          background: requestMetadata.background,
          output_format: requestMetadata.outputFormat,
          input_part_counts: requestMetadata.inputPartCounts
        }
      : null
  };
}

function sanitizeStoredEntry(value: unknown): AiJobDiagnosticLogEntry | null {
  const raw = objectRecord(value);
  if (!raw) return null;
  const metadata = objectRecord(raw.request_metadata);
  const counts = objectRecord(metadata?.input_part_counts);
  const adapted: AiProviderDiagnosticInput = {
    diagnosticStage: raw.stage,
    requestMethod: raw.method,
    providerTransport: raw.provider_transport,
    providerRequestId: raw.provider_request_id,
    providerResponseId: raw.provider_response_id,
    providerHttpStatus: raw.provider_http_status,
    providerErrorType: raw.provider_error_type,
    providerErrorCode: raw.provider_error_code,
    providerErrorParam: raw.provider_error_param,
    providerErrorReason: raw.provider_error_reason,
    elapsedMs: raw.elapsed_ms,
    requestMetadata: metadata
      ? {
          model: metadata.model,
          background: metadata.background,
          outputFormat: metadata.output_format,
          inputPartCounts: counts
        }
      : null
  };
  const entry = createAiJobDiagnosticLogEntry(
    adapted,
    safeCount(raw.attempt),
    raw.timestamp as string
  );
  return entry;
}

function sameEvent(left: AiJobDiagnosticLogEntry, right: AiJobDiagnosticLogEntry): boolean {
  return (
    left.attempt === right.attempt &&
    left.stage === right.stage &&
    left.method === right.method &&
    left.provider_http_status === right.provider_http_status &&
    left.provider_error_type === right.provider_error_type &&
    left.provider_error_code === right.provider_error_code &&
    left.provider_error_param === right.provider_error_param &&
    left.provider_error_reason === right.provider_error_reason &&
    left.provider_response_id === right.provider_response_id
  );
}

export function parseAiJobDiagnosticLog(value: unknown): AiJobDiagnosticLogEntry[] {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .slice(-MAX_LOG_ENTRIES)
    .map(sanitizeStoredEntry)
    .filter((entry): entry is AiJobDiagnosticLogEntry => entry !== null);
}

export function appendAiJobDiagnosticLog(
  current: unknown,
  next: unknown
): AiJobDiagnosticLogEntry[] {
  const history = parseAiJobDiagnosticLog(current);
  const entry = sanitizeStoredEntry(next);
  if (!entry || (history.length > 0 && sameEvent(history.at(-1)!, entry))) return history;
  return [...history, entry].slice(-MAX_LOG_ENTRIES);
}
