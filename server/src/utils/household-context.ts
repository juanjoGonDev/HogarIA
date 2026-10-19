import type { getDatabase } from '../config/database.js';

type Database = ReturnType<typeof getDatabase>;

/** Resolve only an active membership; a stale inactive selection never falls through to another home. */
export function activeHouseholdId(db: Database, userId: string): string | null {
  const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(userId) as
    { household_id: string | null } | undefined;
  if (user?.household_id) {
    const membership = db
      .prepare('SELECT is_active FROM household_members WHERE household_id = ? AND user_id = ?')
      .get(user.household_id, userId) as { is_active: number } | undefined;
    if (membership) return membership.is_active === 1 ? user.household_id : null;
  }

  const memberships = db
    .prepare(
      `SELECT household_id FROM household_members
        WHERE user_id = ? AND is_active = 1 ORDER BY joined_at, household_id`
    )
    .all(userId) as Array<{ household_id: string }>;
  if (memberships.length !== 1) return null;

  db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(
    memberships[0].household_id,
    userId
  );
  return memberships[0].household_id;
}

/** Resolve the same household context without repairing `users.household_id` during a read. */
export function readActiveHouseholdId(db: Database, userId: string): string | null {
  const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(userId) as
    { household_id: string | null } | undefined;
  if (user?.household_id) {
    const membership = db
      .prepare('SELECT is_active FROM household_members WHERE household_id = ? AND user_id = ?')
      .get(user.household_id, userId) as { is_active: number } | undefined;
    if (membership) return membership.is_active === 1 ? user.household_id : null;
  }

  const memberships = db
    .prepare(
      `SELECT household_id FROM household_members
        WHERE user_id = ? AND is_active = 1 ORDER BY joined_at, household_id`
    )
    .all(userId) as Array<{ household_id: string }>;
  return memberships.length === 1 ? memberships[0].household_id : null;
}

export function activeHouseholdMemberCount(db: Database, userId: string): number {
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return 0;
  const result = db
    .prepare(
      'SELECT COUNT(*) AS count FROM household_members WHERE household_id = ? AND is_active = 1'
    )
    .get(householdId) as { count: number };
  return result.count;
}

/** A null active pointer with remaining memberships means "selection required", not personal scope. */
export function hasActiveHouseholdMemberships(db: Database, userId: string): boolean {
  const result = db
    .prepare('SELECT 1 FROM household_members WHERE user_id = ? AND is_active = 1 LIMIT 1')
    .get(userId);
  return Boolean(result);
}

export function needsActiveHouseholdSelection(db: Database, userId: string): boolean {
  return !activeHouseholdId(db, userId) && hasActiveHouseholdMemberships(db, userId);
}

/** Only members with the existing household `settings` permission can manage AI providers. */
export function canManageHouseholdAiSettings(db: Database, userId: string): boolean {
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) return !hasActiveHouseholdMemberships(db, userId);

  const row = db
    .prepare(
      `SELECT permissions FROM household_members
        WHERE household_id = ? AND user_id = ? AND is_active = 1`
    )
    .get(householdId, userId) as { permissions: string | null } | undefined;
  if (!row?.permissions) return false;

  try {
    const permissions = JSON.parse(row.permissions) as Record<string, unknown>;
    return permissions.settings === true;
  } catch {
    return false;
  }
}
