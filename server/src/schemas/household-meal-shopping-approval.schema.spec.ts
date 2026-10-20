import { describe, expect, it } from 'vitest';
import { householdMealShoppingApprovalSchema } from './household-meal-shopping-approval.schema.js';

describe('householdMealShoppingApprovalSchema', () => {
  it('accepts complete long AI-generated ingredient names and units', () => {
    const name = `Ingrediente ${'x'.repeat(2_501)}`;
    const unit = `unidad ${'u'.repeat(2_501)}`;
    const parsed = householdMealShoppingApprovalSchema.parse({
      startDate: '2026-10-14',
      endDate: '2026-10-14',
      previewId: 'a'.repeat(64),
      items: [{ name, unit, quantity: 1 }]
    });

    expect(parsed.items).toEqual([{ name, unit, quantity: 1 }]);
  });
});
