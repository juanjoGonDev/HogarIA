import { safeAiJobDiagnosticTrace } from './ai-job-diagnostic';

describe('safeAiJobDiagnosticTrace', () => {
  it('copies only per-job allowlisted fields and validates optional provider metadata', () => {
    const trace = safeAiJobDiagnosticTrace([
      {
        at: '2026-11-03T09:34:13.100Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'runtime_started',
        apiKey: 'secret-sentinel',
        message: 'private prompt sentinel'
      },
      {
        at: '2026-11-03T09:34:14.000Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'provider_polling',
        code: 'invalid_api_key',
        httpStatus: 202,
        responseId: 'resp_safe123',
        elapsedMs: 1000,
        providerUrl: 'https://private.invalid/v1'
      },
      {
        at: '2026-11-03T09:34:14.500Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'provider_failed',
        code: 'responses_tool_choice_unsupported',
        httpStatus: 400
      },
      {
        at: '2026-11-03T09:34:15.000Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'worker_stalled',
        code: 'WORKER_STALLED',
        httpStatus: 700,
        responseId: 'https://private.invalid/v1',
        elapsedMs: -1
      },
      {
        at: '2026-11-03T09:34:15.500Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'runtime_failed',
        code: 'FILE_MISSING'
      },
      {
        at: '2026-11-03T09:34:16.000Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'unknown_private_stage',
        code: 'secret-sentinel'
      }
    ]);

    expect(trace).toEqual([
      {
        at: '2026-11-03T09:34:13.100Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'runtime_started'
      },
      {
        at: '2026-11-03T09:34:14.000Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'provider_polling',
        code: 'invalid_api_key',
        httpStatus: 202,
        responseId: 'resp_safe123',
        elapsedMs: 1000
      },
      {
        at: '2026-11-03T09:34:14.500Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'provider_failed',
        code: 'responses_tool_choice_unsupported',
        httpStatus: 400
      },
      {
        at: '2026-11-03T09:34:15.000Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'worker_stalled',
        code: 'WORKER_STALLED'
      },
      {
        at: '2026-11-03T09:34:15.500Z',
        attempt: 1,
        claimGeneration: 2,
        stage: 'runtime_failed',
        code: 'FILE_MISSING'
      }
    ]);
    expect(JSON.stringify(trace)).not.toContain('secret-sentinel');
    expect(JSON.stringify(trace)).not.toContain('private.invalid');
  });

  it('rejects malformed required fields and returns no empty trace', () => {
    expect(safeAiJobDiagnosticTrace(null)).toBeUndefined();
    expect(
      safeAiJobDiagnosticTrace([
        { at: '2026-11-03 09:34:13', attempt: 0, claimGeneration: 1, stage: 'worker_stalled' },
        { at: '2026-02-30T09:34:13Z', attempt: 1, claimGeneration: 1, stage: 'worker_stalled' },
        { at: 'not-a-date', attempt: 1, claimGeneration: 1, stage: 'worker_stalled' },
        { at: '2026-11-03T09:34:13Z', attempt: 1, claimGeneration: 1, stage: 'private-stage' }
      ])
    ).toBeUndefined();
  });

  it('copies only the newest bounded set of events', () => {
    const events = Array.from({ length: 40 }, (_, index) => ({
      at: `2026-11-03T09:34:${String(index).padStart(2, '0')}.000Z`,
      attempt: 1,
      claimGeneration: 1,
      stage: 'worker_started'
    }));

    const trace = safeAiJobDiagnosticTrace(events);
    expect(trace).toHaveSize(32);
    expect(trace?.[0].at).toBe('2026-11-03T09:34:08.000Z');
    expect(trace?.[31].at).toBe('2026-11-03T09:34:39.000Z');
  });
});
