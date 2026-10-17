import type Database from 'better-sqlite3';

/** The existing PATCH endpoint only lets a user edit their own personal/current-home rows. */
export function assistantPantryIngredientScope(
  userId: string,
  householdId: string | null
): { clause: string; params: string[]; householdId: string | null } {
  if (householdId) {
    return {
      clause: 'user_id = ? AND (household_id = ? OR household_id IS NULL)',
      params: [userId, householdId],
      householdId
    };
  }
  return {
    clause: 'user_id = ? AND household_id IS NULL',
    params: [userId],
    householdId: null
  };
}

export interface AssistantPantryIngredientIdentity {
  name: string;
  unit: string | null;
  location: string | null;
  expirationDate?: string | null;
}

/** Pantry visibility for duplicate checks mirrors GET/POST pantry scope, including shared homes. */
export function assistantPantryIngredientVisibilityScope(
  db: Database.Database,
  userId: string,
  householdId: string | null
): { clause: string; params: string[] } {
  if (!householdId) {
    return { clause: 'household_id IS NULL AND user_id = ?', params: [userId] };
  }

  const household = db
    .prepare('SELECT shared_pantry FROM households WHERE id = ?')
    .get(householdId) as { shared_pantry: number | null } | undefined;
  if (household?.shared_pantry === 1) {
    return {
      clause: '(household_id = ? OR (household_id IS NULL AND user_id = ?))',
      params: [householdId, userId]
    };
  }

  return {
    clause: '((household_id = ? AND user_id = ?) OR (household_id IS NULL AND user_id = ?))',
    params: [householdId, userId, userId]
  };
}

/** Read only fields needed for duplicate detection; never select or expose ingredient IDs. */
export function readAssistantVisiblePantryIngredientIdentities(
  db: Database.Database,
  userId: string,
  householdId: string | null
): AssistantPantryIngredientIdentity[] {
  const scope = assistantPantryIngredientVisibilityScope(db, userId, householdId);
  return db
    .prepare(
      `SELECT name, unit, location, expiration_date AS expirationDate
         FROM ingredients WHERE ${scope.clause}`
    )
    .all(...scope.params) as AssistantPantryIngredientIdentity[];
}

export function assistantPantryIngredientIdentitiesMatch(
  left: AssistantPantryIngredientIdentity,
  right: AssistantPantryIngredientIdentity
): boolean {
  return (
    comparablePantryIngredientName(left.name) === comparablePantryIngredientName(right.name) &&
    comparableNullablePantryIngredientValue(left.unit) ===
      comparableNullablePantryIngredientValue(right.unit) &&
    comparableNullablePantryIngredientValue(left.location) ===
      comparableNullablePantryIngredientValue(right.location) &&
    (left.expirationDate ?? null) === (right.expirationDate ?? null)
  );
}

function comparableNullablePantryIngredientValue(value: string | null): string | null {
  return value === null ? null : comparablePantryIngredientName(value);
}

export function comparablePantryIngredientName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function comparablePantryIngredientUpdatedAt(value: string | Date | null): string | null {
  if (value === null) return null;
  const raw = value instanceof Date ? value.toISOString() : value.trim();
  const timestamp = raw.replace(' ', 'T');
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}
