import type Database from 'better-sqlite3';
import type { AiConfigRow } from './ai-client.js';
import type { AiConfigScope } from './ai-config-scope.js';

type SqlDb = Database.Database;

export const AI_FUNCTION_KEYS = [
  'assistant',
  'recipes',
  'planning',
  'shopping_pantry',
  'household_automation'
] as const;

export type AiFunctionKey = (typeof AI_FUNCTION_KEYS)[number];

const JOB_FUNCTION: Readonly<Record<string, AiFunctionKey>> = {
  assistant: 'assistant',
  recipe: 'recipes',
  multiple_recipes: 'recipes',
  recommendations: 'recipes',
  weekly_plan: 'planning',
  household_plan: 'planning',
  receipt: 'shopping_pantry',
  shopping_photo: 'shopping_pantry',
  expiry_estimate: 'shopping_pantry',
  product_image_search: 'shopping_pantry'
};

export function isAiFunctionKey(value: string): value is AiFunctionKey {
  return (AI_FUNCTION_KEYS as readonly string[]).includes(value);
}

export function aiFunctionForJobKind(kind: string): AiFunctionKey | null {
  return JOB_FUNCTION[kind] ?? null;
}

function scopeValue(scope: AiConfigScope): string {
  return scope.householdId ?? scope.userId;
}

/** Fixed SQL fragments; scope values always remain bound parameters. */
function scopeWhere(scope: AiConfigScope, alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return scope.householdId
    ? `${prefix}household_id = ?`
    : `${prefix}household_id IS NULL AND ${prefix}user_id = ?`;
}

function configForScope(
  db: SqlDb,
  configId: string,
  scope: AiConfigScope,
  activeOnly = true
): AiConfigRow | undefined {
  const activeClause = activeOnly ? ' AND is_active = 1' : '';
  return db
    .prepare(`SELECT * FROM ai_configs WHERE id = ? AND ${scopeWhere(scope)}${activeClause}`)
    .get(configId, scopeValue(scope)) as AiConfigRow | undefined;
}

export function oldestActiveAiConfigId(
  db: SqlDb,
  scope: AiConfigScope,
  excludeConfigId?: string
): string | null {
  const exclude = excludeConfigId ? ' AND id != ?' : '';
  const statement = db.prepare(
    `SELECT id FROM ai_configs WHERE ${scopeWhere(scope)} AND is_active = 1${exclude}
     ORDER BY created_at ASC, id ASC LIMIT 1`
  );
  const row = (
    excludeConfigId
      ? statement.get(scopeValue(scope), excludeConfigId)
      : statement.get(scopeValue(scope))
  ) as { id: string } | undefined;
  return row?.id ?? null;
}

export function resolveAiFunctionProvider(
  db: SqlDb,
  userId: string,
  householdId: string | null,
  functionKey: AiFunctionKey
): AiConfigRow | undefined {
  const scope = { userId, householdId };
  const where = scopeWhere(scope);
  const row = db
    .prepare(
      `SELECT config_id FROM ai_function_providers
        WHERE function_key = ? AND ${where}`
    )
    .get(functionKey, scopeValue(scope)) as { config_id: string | null } | undefined;

  // A missing assignment is only expected on a partially upgraded database. Use the same
  // deterministic migration default without writing during a read; an explicit NULL means none.
  if (!row) {
    const defaultConfigId = oldestActiveAiConfigId(db, scope);
    return defaultConfigId ? configForScope(db, defaultConfigId, scope) : undefined;
  }
  if (!row.config_id) return undefined;
  return configForScope(db, row.config_id, scope);
}

export function initializeAiFunctionProviders(
  db: SqlDb,
  scope: AiConfigScope,
  defaultConfigId = oldestActiveAiConfigId(db, scope)
): number {
  const statement = db.prepare(
    `INSERT OR IGNORE INTO ai_function_providers (user_id, household_id, function_key, config_id)
     VALUES (?, ?, ?, ?)`
  );
  let inserted = 0;
  for (const functionKey of AI_FUNCTION_KEYS) {
    inserted += statement.run(
      scope.householdId ? null : scope.userId,
      scope.householdId,
      functionKey,
      defaultConfigId
    ).changes;
  }
  return inserted;
}

/** Idempotently fills each existing provider scope with its oldest active provider. */
export function backfillAiFunctionProviders(db: SqlDb): number {
  const scopes = db
    .prepare(
      `SELECT DISTINCT user_id, household_id FROM ai_configs
       ORDER BY household_id, user_id`
    )
    .all() as Array<{ user_id: string; household_id: string | null }>;

  let inserted = 0;
  for (const row of scopes) {
    const scope = { userId: row.user_id, householdId: row.household_id };
    inserted += initializeAiFunctionProviders(db, scope);
  }
  return inserted;
}

export function assignAiFunctionProvider(
  db: SqlDb,
  scope: AiConfigScope,
  functionKey: AiFunctionKey,
  configId: string | null
): void {
  db.prepare(
    `INSERT INTO ai_function_providers (user_id, household_id, function_key, config_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET config_id = excluded.config_id, updated_at = CURRENT_TIMESTAMP`
  ).run(scope.householdId ? null : scope.userId, scope.householdId, functionKey, configId);
}

/** Reassigns only functions pinned to this config, keeping explicit independent selections. */
export function reassignAiFunctionProvidersForConfig(
  db: SqlDb,
  scope: AiConfigScope,
  configId: string,
  fallbackConfigId = oldestActiveAiConfigId(db, scope)
): AiFunctionKey[] {
  const where = scopeWhere(scope);
  const affected = db
    .prepare(
      `SELECT function_key FROM ai_function_providers
        WHERE config_id = ? AND ${where}`
    )
    .all(configId, scopeValue(scope)) as Array<{ function_key: string }>;
  const update = db.prepare(
    `UPDATE ai_function_providers SET config_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE function_key = ? AND config_id = ? AND ${where}`
  );
  for (const { function_key: functionKey } of affected) {
    if (isAiFunctionKey(functionKey)) {
      update.run(fallbackConfigId, functionKey, configId, scopeValue(scope));
    }
  }
  return affected.map(({ function_key }) => function_key).filter(isAiFunctionKey);
}

export function fillUnassignedAiFunctions(
  db: SqlDb,
  scope: AiConfigScope,
  configId: string
): number {
  return db
    .prepare(
      `UPDATE ai_function_providers SET config_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE config_id IS NULL AND ${scopeWhere(scope)}`
    )
    .run(configId, scopeValue(scope)).changes;
}

export function aiFunctionProviderAssignments(
  db: SqlDb,
  scope: AiConfigScope
): Array<{ functionKey: AiFunctionKey; configId: string | null; providerName: string | null }> {
  const rows = db
    .prepare(
      `SELECT assignments.function_key, assignments.config_id, configs.name AS provider_name
         FROM ai_function_providers assignments
         LEFT JOIN ai_configs configs ON configs.id = assignments.config_id
          AND configs.is_active = 1 AND ${scopeWhere(scope, 'configs')}
        WHERE ${scopeWhere(scope, 'assignments')}
        ORDER BY assignments.function_key`
    )
    .all(scopeValue(scope), scopeValue(scope)) as Array<{
    function_key: string;
    config_id: string | null;
    provider_name: string | null;
  }>;
  const byFunction = new Map(
    rows
      .filter((row): row is typeof row & { function_key: AiFunctionKey } =>
        isAiFunctionKey(row.function_key)
      )
      .map((row) => [row.function_key, row] as const)
  );
  return AI_FUNCTION_KEYS.map((functionKey) => {
    const row = byFunction.get(functionKey);
    return {
      functionKey,
      configId: row?.provider_name ? row.config_id : null,
      providerName: row?.provider_name ?? null
    };
  });
}
