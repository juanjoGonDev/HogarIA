import { nanoid } from 'nanoid';
import type Database from 'better-sqlite3';

type SqlDb = Database.Database;

/** Copy, never move, the selected personal provider into an independent household row. */
export function copyActivePersonalAiConfigToHousehold(
  db: SqlDb,
  householdId: string,
  sourceUserId: string
): string | null {
  const existing = db
    .prepare('SELECT id FROM ai_configs WHERE household_id = ? LIMIT 1')
    .get(householdId) as { id: string } | undefined;
  if (existing) return null;

  const source = db
    .prepare(
      `SELECT id, user_id, name, provider, base_url, api_key, model, temperature, max_tokens,
              top_p, frequency_penalty, presence_penalty, timeout, retry_attempts, concurrency,
              created_at
         FROM ai_configs
        WHERE user_id = ? AND household_id IS NULL AND is_active = 1
        ORDER BY updated_at DESC, id ASC
        LIMIT 1`
    )
    .get(sourceUserId) as
    | {
        user_id: string;
        name: string;
        provider: string | null;
        base_url: string;
        api_key: string;
        model: string;
        temperature: number | null;
        max_tokens: number | null;
        top_p: number | null;
        frequency_penalty: number | null;
        presence_penalty: number | null;
        timeout: number | null;
        retry_attempts: number | null;
        concurrency: number | null;
        created_at: string | null;
      }
    | undefined;
  if (!source) return null;

  const copyId = nanoid();
  db.prepare(
    `INSERT INTO ai_configs (
      id, user_id, household_id, name, provider, base_url, api_key, model, temperature, max_tokens,
      top_p, frequency_penalty, presence_penalty, timeout, retry_attempts, concurrency, is_active,
      last_tested, test_status, test_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?, CURRENT_TIMESTAMP)`
  ).run(
    copyId,
    source.user_id,
    householdId,
    source.name,
    source.provider,
    source.base_url,
    source.api_key,
    source.model,
    source.temperature,
    source.max_tokens,
    source.top_p,
    source.frequency_penalty,
    source.presence_penalty,
    source.timeout,
    source.retry_attempts,
    source.concurrency,
    source.created_at
  );
  return copyId;
}

/** Idempotently initialize legacy homes from the oldest active admin's active personal config. */
export function backfillHouseholdAiConfigs(db: SqlDb): number {
  const households = db
    .prepare('SELECT id FROM households ORDER BY id')
    .all() as Array<{ id: string }>;
  let copied = 0;
  const findAdmin = db.prepare(
    `SELECT hm.user_id
       FROM household_members hm
      WHERE hm.household_id = ? AND hm.role = 'admin' AND hm.is_active = 1
      ORDER BY hm.joined_at ASC, hm.user_id ASC
      LIMIT 1`
  );

  for (const { id } of households) {
    const admin = findAdmin.get(id) as { user_id: string } | undefined;
    if (!admin) continue;
    if (copyActivePersonalAiConfigToHousehold(db, id, admin.user_id)) copied += 1;
  }
  return copied;
}
