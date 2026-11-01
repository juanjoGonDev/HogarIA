/** Max timeout Node timers can represent without overflowing into an immediate abort. */
export const AI_TIMEOUT_MAX_MS = 2_147_483_647;
export const AI_TIMEOUT_DEFAULT_MS = 30_000;
export const AI_CONNECTION_TEST_MIN_TIMEOUT_MS = 120_000;
export const AI_JOB_LEASE_MARGIN_SECONDS = 60;

export function effectiveAiTimeoutMs(timeoutMs: number | null | undefined): number {
  if (timeoutMs === null || timeoutMs === undefined) return AI_TIMEOUT_DEFAULT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return AI_TIMEOUT_DEFAULT_MS;
  return Math.min(timeoutMs, AI_TIMEOUT_MAX_MS);
}

/** Every provider operation gets time to finish after the background POST is accepted. */
export function aiOperationTimeoutMs(timeoutMs: number | null | undefined): number {
  return Math.max(effectiveAiTimeoutMs(timeoutMs), AI_CONNECTION_TEST_MIN_TIMEOUT_MS);
}

/** Kept as a compatibility alias for the connection-test callsite. */
export const connectionTestTimeoutMs = aiOperationTimeoutMs;

export function aiJobLeaseSeconds(timeoutMs: number | null | undefined, kind?: string): number {
  void kind;
  return Math.ceil(aiOperationTimeoutMs(timeoutMs) / 1000) + AI_JOB_LEASE_MARGIN_SECONDS;
}
