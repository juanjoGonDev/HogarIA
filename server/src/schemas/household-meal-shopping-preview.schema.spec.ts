import { describe, expect, it } from 'vitest';
import { householdMealShoppingPreviewQuerySchema } from './household-meal-shopping-preview.schema.js';

describe('household meal shopping preview query', () => {
  it('accepts a valid bounded date range', () => {
    expect(
      householdMealShoppingPreviewQuerySchema.safeParse({
        startDate: '2026-10-13',
        endDate: '2026-11-12'
      }).success
    ).toBe(true);
  });

  it('rejects malformed dates, inverted ranges, and more than 31 days', () => {
    for (const query of [
      { startDate: '2026-02-30', endDate: '2026-03-01' },
      { startDate: '2026-10-14', endDate: '2026-10-13' },
      { startDate: '2026-10-13', endDate: '2026-11-13' }
    ]) {
      expect(householdMealShoppingPreviewQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('rejects missing and unexpected query keys', () => {
    expect(householdMealShoppingPreviewQuerySchema.safeParse({}).success).toBe(false);
    expect(
      householdMealShoppingPreviewQuerySchema.safeParse({
        startDate: '2026-10-13',
        endDate: '2026-10-14',
        userId: 'private-user'
      }).success
    ).toBe(false);
  });
});
