import type Database from 'better-sqlite3';
import { activeHouseholdId, hasActiveHouseholdMemberships } from './household-context.js';

type SqlDb = Database.Database;

export interface AiConfigScope {
  userId: string;
  householdId: string | null;
}

export function aiConfigScopeForUser(db: SqlDb, userId: string): AiConfigScope {
  return { userId, householdId: activeHouseholdId(db, userId) };
}

/** Fixed SQL structure; the optional alias is supplied only by server code, never by a request. */
export function aiConfigScopeWhere(scope: AiConfigScope, alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return scope.householdId
    ? `${prefix}household_id = ?`
    : `${prefix}household_id IS NULL AND ${prefix}user_id = ?`;
}

export function aiConfigScopeValue(scope: AiConfigScope): string {
  return scope.householdId ?? scope.userId;
}

export function aiConfigByIdInScope(
  db: SqlDb,
  configId: string,
  scope: AiConfigScope
): Record<string, unknown> | undefined {
  if (!scope.householdId && hasActiveHouseholdMemberships(db, scope.userId)) return undefined;
  return db
    .prepare(`SELECT * FROM ai_configs WHERE id = ? AND ${aiConfigScopeWhere(scope)}`)
    .get(configId, aiConfigScopeValue(scope)) as Record<string, unknown> | undefined;
}

/** Resolve a provider using the job's pinned scope, not the actor's subsequently selected home. */
export function aiConfigForPinnedJob(
  db: SqlDb,
  configId: string,
  actorUserId: string,
  householdId: string | null
): Record<string, unknown> | undefined {
  const scope = { userId: actorUserId, householdId };
  return aiConfigByIdInScope(db, configId, scope);
}
