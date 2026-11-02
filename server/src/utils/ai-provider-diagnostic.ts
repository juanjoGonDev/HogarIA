const PROVIDER_ERROR_TYPES = [
  'api_error',
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'rate_limit_error',
  'server_error',
  'insufficient_quota'
] as const;
const PROVIDER_ERROR_CODES = [
  'unsupported_parameter',
  'unsupported_value',
  'invalid_value',
  'invalid_type',
  'model_not_found',
  'context_length_exceeded',
  'insufficient_quota',
  'rate_limit_exceeded',
  'invalid_api_key',
  'invalid_prompt',
  'responses_not_supported',
  'responses_endpoint_not_supported',
  'background_not_supported'
] as const;
const PROVIDER_ERROR_PARAMS = [
  'model',
  'temperature',
  'top_p',
  'max_output_tokens',
  'input',
  'input_image',
  'input_file',
  'text.format',
  'text.format.type',
  'background',
  'store',
  'reasoning.effort'
] as const;

export type SafeProviderErrorType = string;
export type SafeProviderErrorCode = string;
export type SafeProviderErrorParam = string;

export type SafeProviderErrorReason =
  | 'unsupported_parameter'
  | 'invalid_type'
  | 'invalid_value'
  | 'model_not_found'
  | 'authentication'
  | 'permission'
  | 'rate_limit'
  | 'quota'
  | 'background_not_supported'
  | 'file_input_rejected'
  | 'invalid_request'
  | 'provider_rejected';

export type SafeAiProviderRequestMetadata = Readonly<{
  model: string | null;
  background: boolean;
  outputFormat: 'json_schema' | 'json_object' | 'unknown';
  inputPartCounts: Readonly<{ text: number; image: number; file: number }>;
}>;

const providerErrorTypes = new Set<string>(PROVIDER_ERROR_TYPES);
const providerErrorCodes = new Set<string>(PROVIDER_ERROR_CODES);
const providerErrorParams = new Set<string>(PROVIDER_ERROR_PARAMS);
const PROVIDER_TOKEN = /^[a-z][a-z0-9_]{0,63}$/;
const SENSITIVE_PROVIDER_TOKEN = /(?:bearer|password|secret|token|credential)|^(?:sk|rk|pk)-/i;
const SAFE_PROVIDER_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SAFE_PROVIDER_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

export type SafeProviderErrorFields = Readonly<{
  type?: SafeProviderErrorType;
  code?: SafeProviderErrorCode;
  param?: SafeProviderErrorParam;
}>;

export function isSafeProviderModelName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    SAFE_PROVIDER_MODEL.test(value) &&
    !SENSITIVE_PROVIDER_TOKEN.test(value)
  );
}

export function isSafeProviderRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    SAFE_PROVIDER_REQUEST_ID.test(value) &&
    !SENSITIVE_PROVIDER_TOKEN.test(value)
  );
}

export function sanitizeProviderErrorFields(fields: {
  type?: unknown;
  code?: unknown;
  param?: unknown;
}): SafeProviderErrorFields {
  const param = safeProviderErrorParam(fields.param);
  return {
    ...(typeof fields.type === 'string' &&
    (providerErrorTypes.has(fields.type) || safeProviderToken(fields.type))
      ? { type: fields.type as SafeProviderErrorType }
      : {}),
    ...(typeof fields.code === 'string' &&
    (providerErrorCodes.has(fields.code) || safeProviderToken(fields.code))
      ? { code: fields.code as SafeProviderErrorCode }
      : {}),
    ...(param ? { param } : {})
  };
}

function safeProviderToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64 || !PROVIDER_TOKEN.test(value)) {
    return undefined;
  }
  if (SENSITIVE_PROVIDER_TOKEN.test(value)) return undefined;
  return value;
}

function safeProviderErrorParam(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 160) return undefined;
  if (providerErrorParams.has(value)) return value as SafeProviderErrorParam;

  // Normalize provider paths with concrete array indexes; arbitrary provider text is discarded.
  if (/^input\[\d{1,4}\]\.content\[\d{1,4}\]\.(?:file_data|file_id|filename)$/.test(value)) {
    return 'input_file';
  }
  if (/^input\[\d{1,4}\]\.content\[\d{1,4}\]\.image_url(?:\.url)?$/.test(value)) {
    return 'input_image';
  }
  // Provider-specific schema paths remain useful when expressed only as safe identifiers.
  if (
    /^[a-z][a-z0-9_]{0,63}(?:\.[a-z][a-z0-9_]{0,63}|\[\d{1,4}\]){1,8}$/.test(value) &&
    !SENSITIVE_PROVIDER_TOKEN.test(value)
  ) {
    return value;
  }
  return undefined;
}

export function isSafeProviderErrorType(value: unknown): value is string {
  return typeof value === 'string' && (providerErrorTypes.has(value) || !!safeProviderToken(value));
}

export function isSafeProviderErrorCode(value: unknown): value is string {
  return typeof value === 'string' && (providerErrorCodes.has(value) || !!safeProviderToken(value));
}

export function isSafeProviderErrorParam(value: unknown): value is string {
  return !!safeProviderErrorParam(value);
}

export function safeProviderErrorReason(input: {
  type?: unknown;
  code?: unknown;
  param?: unknown;
  message?: unknown;
}): SafeProviderErrorReason {
  const code = safeProviderToken(input.code);
  const type = safeProviderToken(input.type);
  const reasonByCode: Record<string, SafeProviderErrorReason> = {
    unsupported_parameter: 'unsupported_parameter',
    unsupported_value: 'invalid_value',
    invalid_value: 'invalid_value',
    invalid_type: 'invalid_type',
    model_not_found: 'model_not_found',
    invalid_api_key: 'authentication',
    insufficient_quota: 'quota',
    rate_limit_exceeded: 'rate_limit',
    responses_not_supported: 'background_not_supported',
    responses_endpoint_not_supported: 'background_not_supported',
    background_not_supported: 'background_not_supported'
  };
  if (code && reasonByCode[code]) return reasonByCode[code];
  if (type === 'authentication_error') return 'authentication';
  if (type === 'permission_error') return 'permission';
  if (type === 'rate_limit_error') return 'rate_limit';
  if (type === 'insufficient_quota') return 'quota';
  if (type === 'invalid_request_error') {
    // Only classify a few fixed wording patterns; never persist/copy provider text.
    const message = typeof input.message === 'string' ? input.message.slice(0, 500) : '';
    if (/^\s*(?:unsupported|unknown) parameter\b/i.test(message)) {
      return 'unsupported_parameter';
    }
    if (/^\s*(?:invalid|incorrect) type\b/i.test(message)) return 'invalid_type';
    if (/^\s*(?:invalid|incorrect) value\b/i.test(message)) return 'invalid_value';
    if (
      /\b(?:image|file|attachment)\b/i.test(message) &&
      /\b(?:invalid|unsupported|reject)/i.test(message)
    ) {
      return 'file_input_rejected';
    }
    return 'invalid_request';
  }
  return 'provider_rejected';
}

export function sanitizeAiProviderRequestMetadata(
  value: unknown
): SafeAiProviderRequestMetadata | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const counts =
    typeof metadata.inputPartCounts === 'object' &&
    metadata.inputPartCounts !== null &&
    !Array.isArray(metadata.inputPartCounts)
      ? (metadata.inputPartCounts as Record<string, unknown>)
      : {};
  const count = (item: unknown) =>
    Number.isSafeInteger(item) && Number(item) >= 0 ? Math.min(Number(item), 100) : 0;
  const model = metadata.model;
  return {
    model: isSafeProviderModelName(model) ? model : null,
    background: metadata.background === true,
    outputFormat:
      metadata.outputFormat === 'json_schema' || metadata.outputFormat === 'json_object'
        ? metadata.outputFormat
        : 'unknown',
    inputPartCounts: {
      text: count(counts.text),
      image: count(counts.image),
      file: count(counts.file)
    }
  };
}

export function isPermanentProviderClientError(status: number | undefined): boolean {
  return (
    status !== undefined && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)
  );
}
