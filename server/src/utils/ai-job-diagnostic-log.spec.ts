import { describe, expect, it } from 'vitest';
import {
  appendAiJobDiagnosticLog,
  createAiJobDiagnosticLogEntry,
  parseAiJobDiagnosticLog
} from './ai-job-diagnostic-log.js';

const diagnostic = {
  providerResponseId: null,
  providerTransport: 'responses_background',
  providerHttpStatus: 400,
  elapsedMs: 167,
  providerRequestId: 'req_synthetic123',
  providerErrorType: 'invalid_request_error',
  providerErrorCode: 'invalid_image_format',
  providerErrorParam: 'input[0].content[1].image_url.url',
  providerErrorReason: 'invalid_value',
  requestMethod: 'POST',
  requestMetadata: {
    model: 'gpt-vision',
    background: true,
    outputFormat: 'json_schema',
    inputPartCounts: { text: 1, image: 1, file: 1 }
  },
  diagnosticStage: 'failed'
} as const;

describe('AI job diagnostic log', () => {
  it('creates a timestamped safe event with normalized provider fields and request metadata', () => {
    expect(createAiJobDiagnosticLogEntry(diagnostic, 1, '2026-11-02T12:16:47.167Z')).toEqual({
      timestamp: '2026-11-02T12:16:47.167Z',
      level: 'error',
      event: 'provider_error',
      attempt: 1,
      stage: 'failed',
      method: 'POST',
      provider_transport: 'responses_background',
      provider_request_id: 'req_synthetic123',
      provider_response_id: null,
      provider_http_status: 400,
      provider_error_type: 'invalid_request_error',
      provider_error_code: 'invalid_image_format',
      provider_error_param: 'input_image',
      provider_error_reason: 'invalid_value',
      elapsed_ms: 167,
      request_metadata: {
        model: 'gpt-vision',
        background: true,
        output_format: 'json_schema',
        input_part_counts: { text: 1, image: 1, file: 1 }
      }
    });
  });

  it('drops malformed identifiers, unsafe metadata, invalid timestamps and unsupported fields', () => {
    const entry = createAiJobDiagnosticLogEntry(
      {
        ...diagnostic,
        providerRequestId: 'Authorization: secret-value',
        providerErrorType: 'invalid_request_error private-body',
        providerErrorCode: 'private text sentinel',
        providerErrorParam: 'input[0].content[0].image_url?token=private',
        providerErrorReason: 'private receipt content',
        requestMetadata: {
          model: 'private model name',
          background: true,
          outputFormat: 'private_format',
          inputPartCounts: { text: 10001, image: 1, file: -1 }
        }
      } as unknown as typeof diagnostic,
      0,
      'not-a-timestamp'
    );

    expect(entry.timestamp).not.toBe('not-a-timestamp');
    expect(entry.attempt).toBe(0);
    expect(entry.provider_request_id).toBeNull();
    expect(entry.provider_error_type).toBeNull();
    expect(entry.provider_error_code).toBeNull();
    expect(entry.provider_error_param).toBeNull();
    expect(entry.provider_error_reason).toBeNull();
    expect(entry.request_metadata).toEqual({
      model: null,
      background: true,
      output_format: 'unknown',
      input_part_counts: { text: 100, image: 1, file: 0 }
    });
    expect(JSON.stringify(entry)).not.toContain('private');
    expect(JSON.stringify(entry)).not.toContain('secret-value');
  });

  it('drops API-key-shaped provider identifiers before storage', () => {
    const entry = createAiJobDiagnosticLogEntry(
      {
        ...diagnostic,
        providerRequestId: 'sk-test-key-sentinel',
        requestMetadata: {
          ...diagnostic.requestMetadata,
          model: 'sk-test-key-sentinel'
        }
      },
      1,
      '2026-11-02T12:16:47.167Z'
    );

    expect(entry.provider_request_id).toBeNull();
    expect(entry.request_metadata?.model).toBeNull();
    expect(JSON.stringify(entry)).not.toContain('sk-test-key-sentinel');
  });

  it('deduplicates repeated polling events and keeps at most 32 chronological entries', () => {
    const polling = createAiJobDiagnosticLogEntry(
      {
        ...diagnostic,
        diagnosticStage: 'polling',
        providerHttpStatus: 200,
        providerErrorCode: undefined
      },
      1,
      '2026-11-02T12:16:47.100Z'
    );
    const repeatedPolling = createAiJobDiagnosticLogEntry(
      {
        ...diagnostic,
        diagnosticStage: 'polling',
        providerHttpStatus: 200,
        providerErrorCode: undefined
      },
      1,
      '2026-11-02T12:16:48.100Z'
    );
    const once = appendAiJobDiagnosticLog([], polling);
    expect(appendAiJobDiagnosticLog(once, repeatedPolling)).toEqual(once);

    let history = once;
    for (let attempt = 2; attempt <= 40; attempt += 1) {
      history = appendAiJobDiagnosticLog(
        history,
        createAiJobDiagnosticLogEntry(
          diagnostic,
          attempt,
          `2026-11-02T12:16:${String(attempt).padStart(2, '0')}.000Z`
        )
      );
    }

    expect(history).toHaveLength(32);
    expect(history[0].attempt).toBe(9);
    expect(history.at(-1)?.attempt).toBe(40);
  });

  it('parses persisted logs defensively and returns empty history for invalid storage', () => {
    const entry = createAiJobDiagnosticLogEntry(diagnostic, 1, '2026-11-02T12:16:47.167Z');
    expect(parseAiJobDiagnosticLog(JSON.stringify([entry]))).toEqual([entry]);
    expect(parseAiJobDiagnosticLog('not-json')).toEqual([]);
    expect(parseAiJobDiagnosticLog(JSON.stringify({ entry }))).toEqual([]);
  });
});
