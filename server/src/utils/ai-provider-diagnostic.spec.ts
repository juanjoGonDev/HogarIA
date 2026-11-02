import { describe, expect, it } from 'vitest';
import {
  isPermanentProviderClientError,
  isSafeProviderModelName,
  isSafeProviderRequestId,
  isSafeProviderErrorCode,
  isSafeProviderErrorParam,
  isSafeProviderErrorType,
  sanitizeProviderErrorFields
} from './ai-provider-diagnostic.js';

describe('provider diagnostics allowlist', () => {
  it('keeps supported error fields and normalizes indexed attachment paths', () => {
    expect(
      sanitizeProviderErrorFields({
        type: 'invalid_request_error',
        code: 'unsupported_parameter',
        param: 'temperature'
      })
    ).toEqual({
      type: 'invalid_request_error',
      code: 'unsupported_parameter',
      param: 'temperature'
    });
    expect(
      sanitizeProviderErrorFields({
        param: 'input[1234].content[42].file_data'
      })
    ).toEqual({ param: 'input_file' });
    expect(
      sanitizeProviderErrorFields({
        param: 'input[0].content[0].image_url.url'
      })
    ).toEqual({ param: 'input_image' });
  });

  it('drops non-string, overlong, and malformed values but keeps safe provider-specific codes', () => {
    expect(
      sanitizeProviderErrorFields({
        type: 'private_message',
        code: 'unknown_provider_code',
        param: 'Authorization: secret'
      })
    ).toEqual({ type: 'private_message', code: 'unknown_provider_code' });
    expect(sanitizeProviderErrorFields({ type: 42, code: null, param: 7 })).toEqual({});
    expect(sanitizeProviderErrorFields({ param: 'x'.repeat(161) })).toEqual({});
    expect(sanitizeProviderErrorFields({ param: 'input[12345].content[42].file_data' })).toEqual(
      {}
    );
    expect(
      sanitizeProviderErrorFields({ param: 'input[0].content[0].image_url?token=secret' })
    ).toEqual({});
  });

  it('validates safe fields without accepting arbitrary strings', () => {
    expect(isSafeProviderErrorType('api_error')).toBe(true);
    expect(isSafeProviderErrorType('private_message')).toBe(true);
    expect(isSafeProviderErrorType(undefined)).toBe(false);
    expect(isSafeProviderErrorCode('unsupported_parameter')).toBe(true);
    expect(isSafeProviderErrorCode('private_message')).toBe(true);
    expect(isSafeProviderErrorCode(null)).toBe(false);
    expect(isSafeProviderErrorParam('input_file')).toBe(true);
    expect(isSafeProviderErrorParam('private_message')).toBe(false);
    expect(isSafeProviderErrorParam(3)).toBe(false);
  });

  it('never persists credential-shaped model names or provider request IDs', () => {
    expect(isSafeProviderModelName('gpt-5')).toBe(true);
    expect(isSafeProviderModelName('org/custom-model')).toBe(true);
    expect(isSafeProviderModelName('sk-test-key-sentinel')).toBe(false);
    expect(isSafeProviderModelName('custom-token-model')).toBe(false);
    expect(isSafeProviderRequestId('req_synthetic123')).toBe(true);
    expect(isSafeProviderRequestId('sk-test-key-sentinel')).toBe(false);
    expect(isSafeProviderRequestId('req_credential_sentinel')).toBe(false);
  });

  it('retries transient HTTP statuses but stops on permanent 4xx responses', () => {
    for (const status of [408, 409, 425, 429]) {
      expect(isPermanentProviderClientError(status)).toBe(false);
    }
    expect(isPermanentProviderClientError(undefined)).toBe(false);
    expect(isPermanentProviderClientError(399)).toBe(false);
    expect(isPermanentProviderClientError(400)).toBe(true);
    expect(isPermanentProviderClientError(499)).toBe(true);
    expect(isPermanentProviderClientError(500)).toBe(false);
  });
});
