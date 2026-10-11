import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { householdPlanRevisions, householdPlans } from './schema.js';

describe('household plan Drizzle schema', () => {
  it('declares household/user foreign keys on the current plan and revision history', () => {
    const plan = getTableConfig(householdPlans);
    const revisions = getTableConfig(householdPlanRevisions);

    expect(plan.name).toBe('household_plans');
    expect(plan.foreignKeys).toHaveLength(2);
    expect(
      plan.foreignKeys.map((foreignKey) => foreignKey.reference().foreignColumns[0].name)
    ).toEqual(['id', 'id']);
    expect(revisions.name).toBe('household_plan_revisions');
    expect(revisions.foreignKeys).toHaveLength(2);
    expect(
      revisions.foreignKeys.map((foreignKey) => foreignKey.reference().foreignColumns[0].name)
    ).toEqual(['id', 'id']);
    expect(revisions.primaryKeys).toHaveLength(1);
  });
});
