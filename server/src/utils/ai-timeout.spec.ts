import { describe, expect, it } from 'vitest';
import {
  AI_JOB_LEASE_MARGIN_SECONDS,
  AI_TIMEOUT_DEFAULT_MS,
  AI_TIMEOUT_MAX_MS,
  aiJobLeaseSeconds,
  connectionTestTimeoutMs,
  effectiveAiTimeoutMs
} from './ai-timeout.js';

describe('AI timeout runtime limits', () => {
  it('uses the default for missing or invalid stored values', () => {
    expect(effectiveAiTimeoutMs(null)).toBe(AI_TIMEOUT_DEFAULT_MS);
    expect(effectiveAiTimeoutMs(undefined)).toBe(AI_TIMEOUT_DEFAULT_MS);
    expect(effectiveAiTimeoutMs(0)).toBe(AI_TIMEOUT_DEFAULT_MS);
    expect(effectiveAiTimeoutMs(-1)).toBe(AI_TIMEOUT_DEFAULT_MS);
    expect(effectiveAiTimeoutMs(1.5)).toBe(AI_TIMEOUT_DEFAULT_MS);
    expect(effectiveAiTimeoutMs(Number.MAX_SAFE_INTEGER + 1)).toBe(AI_TIMEOUT_DEFAULT_MS);
  });

  it('clamps legacy/corrupt values to the maximum Node timer range', () => {
    expect(AI_TIMEOUT_MAX_MS).toBe(2_147_483_647);
    expect(effectiveAiTimeoutMs(AI_TIMEOUT_MAX_MS)).toBe(AI_TIMEOUT_MAX_MS);
    expect(effectiveAiTimeoutMs(AI_TIMEOUT_MAX_MS + 1)).toBe(AI_TIMEOUT_MAX_MS);
  });

  it('gives each job a lease for its timeout plus the fixed safety margin', () => {
    expect(AI_JOB_LEASE_MARGIN_SECONDS).toBe(60);
    expect(aiJobLeaseSeconds(900_123)).toBe(961);
    expect(aiJobLeaseSeconds(null)).toBe(90);
    expect(aiJobLeaseSeconds(AI_TIMEOUT_MAX_MS)).toBe(
      Math.ceil(AI_TIMEOUT_MAX_MS / 1000) + AI_JOB_LEASE_MARGIN_SECONDS
    );
  });

  it('reserves a second timeout window for receipt streaming fallback', () => {
    expect(aiJobLeaseSeconds(900_123, 'receipt')).toBe(2 * Math.ceil(900_123 / 1000) + 60);
    expect(aiJobLeaseSeconds(900_123, 'recipe')).toBe(Math.ceil(900_123 / 1000) + 60);
  });

  it('gives connection tests at least two minutes without imposing a product maximum', () => {
    expect(connectionTestTimeoutMs(null)).toBe(120_000);
    expect(connectionTestTimeoutMs(30_000)).toBe(120_000);
    expect(connectionTestTimeoutMs(120_000)).toBe(120_000);
    expect(connectionTestTimeoutMs(300_000)).toBe(300_000);
    expect(connectionTestTimeoutMs(AI_TIMEOUT_MAX_MS)).toBe(AI_TIMEOUT_MAX_MS);
    expect(aiJobLeaseSeconds(30_000, 'connection_test')).toBe(180);
  });
});
