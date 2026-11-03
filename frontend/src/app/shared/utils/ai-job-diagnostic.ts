import type {
  AiJobDiagnosticTraceEvent,
  AiJobDiagnosticTraceStage
} from '../models/ai-queue.model';

const MAX_TRACE_EVENTS = 32;
const SAFE_TRACE_STAGES = new Set([
  'worker_claimed',
  'worker_started',
  'runtime_started',
  'runtime_finished',
  'runtime_failed',
  'worker_exception',
  'worker_stalled',
  'worker_runtime_missing',
  'worker_scope_mismatch',
  'provider_submitting',
  'provider_queued',
  'provider_polling',
  'provider_completed',
  'provider_failed',
  'provider_timed_out',
  'provider_cancelled'
]);
const SAFE_TRACE_CODES = new Set([
  'WORKER_EXCEPTION',
  'WORKER_STALLED',
  'INPUT_EXPIRED',
  'JOB_SCOPE_MISMATCH',
  'CONFIG_UNAVAILABLE',
  'CONFIG_DISABLED',
  'CONNECTION_FAILED',
  'CANCELLED',
  'TIMEOUT',
  'BAD_JSON',
  'NO_CONFIG',
  'PROVIDER',
  'FILE_MISSING',
  'RECEIPT_NOT_FOUND',
  'invalid_api_key',
  'unsupported_parameter',
  'unsupported_value',
  'invalid_prompt',
  'invalid_value',
  'invalid_type',
  'model_not_found',
  'context_length_exceeded',
  'insufficient_quota',
  'rate_limit_exceeded',
  'internal_error',
  'payload_too_large',
  'responses_not_supported',
  'responses_tool_choice_unsupported',
  'responses_endpoint_not_supported',
  'background_not_supported',
  'responses_input_unsupported',
  'bad_request',
  'idempotency_conflict',
  'idempotency_key_invalid',
  'response_cancelled',
  'response_not_cancellable',
  'response_not_found',
  'response_store_unavailable',
  'responses_attachment_reference_unsupported',
  'responses_text_format_required',
  'responses_background_required',
  'responses_field_unsupported',
  'responses_runtime_unavailable',
  'responses_storage_unavailable',
  'responses_tools_unsupported',
  'responses_store_required',
  'responses_streaming_unsupported',
  'responses_unexpected_tool_output'
]);
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SAFE_RESPONSE_ID = /^resp_[A-Za-z0-9_-]{1,128}$/;

/** Redacts every field that is not part of the explicit per-job diagnostic contract. */
export function safeAiJobDiagnosticTrace(value: unknown): AiJobDiagnosticTraceEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const safe: AiJobDiagnosticTraceEvent[] = [];
  for (const candidate of value.slice(-MAX_TRACE_EVENTS)) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const event = candidate as Record<string, unknown>;
    const at = safeTimestamp(event['at']);
    const attempt = safePositiveInteger(event['attempt'], 1000);
    const claimGeneration = safePositiveInteger(event['claimGeneration'], 1_000_000_000);
    const stage = event['stage'];
    if (
      !at ||
      attempt === null ||
      claimGeneration === null ||
      typeof stage !== 'string' ||
      !SAFE_TRACE_STAGES.has(stage)
    ) {
      continue;
    }

    const sanitized: AiJobDiagnosticTraceEvent = {
      at,
      attempt,
      claimGeneration,
      stage: stage as AiJobDiagnosticTraceStage
    };
    if (typeof event['code'] === 'string' && SAFE_TRACE_CODES.has(event['code'])) {
      sanitized.code = event['code'];
    }
    if (safeHttpStatus(event['httpStatus']) !== null) {
      sanitized.httpStatus = safeHttpStatus(event['httpStatus'])!;
    }
    if (typeof event['responseId'] === 'string' && SAFE_RESPONSE_ID.test(event['responseId'])) {
      sanitized.responseId = event['responseId'];
    }
    const elapsedMs = safeNonNegativeInteger(event['elapsedMs']);
    if (elapsedMs !== null) sanitized.elapsedMs = elapsedMs;
    safe.push(sanitized);
  }

  return safe.length ? safe : undefined;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !SAFE_TIMESTAMP.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const normalized = new Date(milliseconds).toISOString();
  const expected = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => `.${fraction.padEnd(3, '0')}Z`)
    : value.replace(/Z$/, '.000Z');
  return normalized === expected ? normalized : null;
}

function safePositiveInteger(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
    ? value
    : null;
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeHttpStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}
