import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const ASSISTANT_ACTION_ID_HEADER = 'x-assistant-action-id';

const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AssistantActionResponse {
  body: unknown;
  status: ContentfulStatusCode;
  /** False only when the domain operation definitively made no write (for example a CAS conflict). */
  record?: boolean;
}

export type AssistantActionIdempotencyResult =
  | (AssistantActionResponse & { replayed: boolean })
  | { error: 'invalid_action_id' | 'action_id_conflict' };

interface ActionResultRow {
  request_hash: string;
  response_status: ContentfulStatusCode;
  succeeded: number;
}

/**
 * Executes the domain write and records its idempotency key in the same immediate SQLite
 * transaction. No action ID keeps the existing endpoint behavior. A replay never reruns the
 * callback, and reusing an ID for different validated input fails closed.
 */
export function withAssistantActionIdempotency(
  db: Database.Database,
  userId: string,
  actionId: string | undefined,
  request: unknown,
  operation: () => AssistantActionResponse
): AssistantActionIdempotencyResult {
  if (actionId === undefined) return { ...operation(), replayed: false };
  if (!isAssistantActionId(actionId)) return { error: 'invalid_action_id' };

  const requestHash = createHash('sha256').update(stableJson(request)).digest('hex');
  const execute = db.transaction((): AssistantActionIdempotencyResult => {
    const existing = db
      .prepare(
        `SELECT request_hash, response_status, succeeded
           FROM assistant_action_results WHERE user_id = ? AND action_id = ?`
      )
      .get(userId, actionId) as ActionResultRow | undefined;

    if (existing) {
      if (existing.request_hash !== requestHash) return { error: 'action_id_conflict' };
      return {
        status: existing.response_status,
        body: existing.succeeded
          ? { success: true, idempotent: true }
          : { success: false, code: 'ASSISTANT_ACTION_PREVIOUSLY_REJECTED', idempotent: true },
        replayed: true
      };
    }

    const response = operation();
    if (response.record !== false) {
      const succeeded =
        response.body !== null &&
        typeof response.body === 'object' &&
        'success' in response.body &&
        response.body.success === true;
      db.prepare(
        `INSERT INTO assistant_action_results
          (user_id, action_id, request_hash, response_status, succeeded)
         VALUES (?, ?, ?, ?, ?)`
      ).run(userId, actionId, requestHash, response.status, succeeded ? 1 : 0);
    }
    return { ...response, replayed: false };
  });

  return execute.immediate();
}

export function isAssistantActionId(value: string): boolean {
  return ACTION_ID_PATTERN.test(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;

  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`);
  return `{${entries.join(',')}}`;
}
