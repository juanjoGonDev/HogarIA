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

export type SafeProviderErrorType = (typeof PROVIDER_ERROR_TYPES)[number];
export type SafeProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];
export type SafeProviderErrorParam = (typeof PROVIDER_ERROR_PARAMS)[number];

const providerErrorTypes = new Set<string>(PROVIDER_ERROR_TYPES);
const providerErrorCodes = new Set<string>(PROVIDER_ERROR_CODES);
const providerErrorParams = new Set<string>(PROVIDER_ERROR_PARAMS);

export type SafeProviderErrorFields = Readonly<{
  type?: SafeProviderErrorType;
  code?: SafeProviderErrorCode;
  param?: SafeProviderErrorParam;
}>;

export function sanitizeProviderErrorFields(fields: {
  type?: unknown;
  code?: unknown;
  param?: unknown;
}): SafeProviderErrorFields {
  const param = safeProviderErrorParam(fields.param);
  return {
    ...(typeof fields.type === 'string' && providerErrorTypes.has(fields.type)
      ? { type: fields.type as SafeProviderErrorType }
      : {}),
    ...(typeof fields.code === 'string' && providerErrorCodes.has(fields.code)
      ? { code: fields.code as SafeProviderErrorCode }
      : {}),
    ...(param ? { param } : {})
  };
}

function safeProviderErrorParam(value: unknown): SafeProviderErrorParam | undefined {
  if (typeof value !== 'string' || value.length > 160) return undefined;
  if (providerErrorParams.has(value)) return value as SafeProviderErrorParam;

  // Normalize provider paths with concrete array indexes; arbitrary provider text is discarded.
  if (/^input\[\d{1,4}\]\.content\[\d{1,4}\]\.(?:file_data|file_id|filename)$/.test(value)) {
    return 'input_file';
  }
  if (/^input\[\d{1,4}\]\.content\[\d{1,4}\]\.image_url(?:\.url)?$/.test(value)) {
    return 'input_image';
  }
  return undefined;
}

export function isSafeProviderErrorType(value: unknown): value is SafeProviderErrorType {
  return typeof value === 'string' && providerErrorTypes.has(value);
}

export function isSafeProviderErrorCode(value: unknown): value is SafeProviderErrorCode {
  return typeof value === 'string' && providerErrorCodes.has(value);
}

export function isSafeProviderErrorParam(value: unknown): value is SafeProviderErrorParam {
  return typeof value === 'string' && providerErrorParams.has(value);
}

export function isPermanentProviderClientError(status: number | undefined): boolean {
  return (
    status !== undefined && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)
  );
}
