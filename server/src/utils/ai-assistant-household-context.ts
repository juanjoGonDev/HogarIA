import type { Context, MiddlewareHandler } from 'hono';
import { getDatabase } from '../config/database.js';
import type { AppEnv } from '../types/hono-env.js';
import { readActiveHouseholdId } from './household-context.js';

export const ASSISTANT_HOUSEHOLD_HEADER = 'x-assistant-household-id';
export const ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED = 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED';

export type CurrentAssistantHouseholdSnapshot =
  { valid: false } | { valid: true; householdId?: string | null };

export function assistantHouseholdContextMatches(
  expectedHouseholdId: string,
  activeHouseholdId: string | null
): boolean {
  return expectedHouseholdId === (activeHouseholdId ?? '');
}

/** Empty header is an explicit personal-mode snapshot; absent header is a regular app request. */
export function assistantHouseholdContextMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const expected = c.req.header(ASSISTANT_HOUSEHOLD_HEADER);
    if (expected === undefined) return next();

    const activeHouseholdId = readActiveHouseholdId(getDatabase(), c.get('userId'));
    if (!assistantHouseholdContextMatches(expected, activeHouseholdId)) {
      return c.json({ success: false, code: ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED }, 409);
    }
    await next();
  };
}

/** Revalidate the middleware snapshot after asynchronous request parsing, before any write. */
export function currentAssistantHouseholdSnapshot(
  c: Context<AppEnv>
): CurrentAssistantHouseholdSnapshot {
  const expected = c.req.header(ASSISTANT_HOUSEHOLD_HEADER);
  if (expected === undefined) return { valid: true };

  const activeHouseholdId = readActiveHouseholdId(getDatabase(), c.get('userId'));
  if (!assistantHouseholdContextMatches(expected ?? '', activeHouseholdId)) return { valid: false };
  return { valid: true, householdId: expected || null };
}
