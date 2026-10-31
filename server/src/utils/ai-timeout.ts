/** Max timeout Node timers can represent without overflowing into an immediate abort. */
export const AI_TIMEOUT_MAX_MS = 2_147_483_647;
export const AI_TIMEOUT_DEFAULT_MS = 30_000;
export const AI_JOB_LEASE_MARGIN_SECONDS = 60;

export function effectiveAiTimeoutMs(timeoutMs: number | null | undefined): number {
  if (timeoutMs === null || timeoutMs === undefined) return AI_TIMEOUT_DEFAULT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return AI_TIMEOUT_DEFAULT_MS;
  return Math.min(timeoutMs, AI_TIMEOUT_MAX_MS);
}

export function aiJobLeaseSeconds(timeoutMs: number | null | undefined, kind?: string): number {
  const attempts = kind === 'receipt' ? 2 : 1;
  return attempts * Math.ceil(effectiveAiTimeoutMs(timeoutMs) / 1000) + AI_JOB_LEASE_MARGIN_SECONDS;
}
