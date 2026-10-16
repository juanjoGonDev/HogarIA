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
