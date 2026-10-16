import { describe, expect, it } from 'vitest';
import { assistantUpdateIngredientSchema } from './ai-assistant-pantry-update.schema.js';

const request = {
  changes: { quantity: 0, expirationDate: null, notes: null },
  assistantAction: {
    operation: 'update_ingredient',
    targetId: 'ingredient-1',
    before: {
      name: 'Yogur natural',
      category: 'dairy',
      quantity: 2,
      unit: 'unit',
      expirationDate: '2026-10-20',
      location: 'fridge',
      notes: 'Desayuno',
      updatedAt: '2026-10-16 10:00:00'
    }
  }
};

describe('assistantUpdateIngredientSchema', () => {
  it('accepts a bounded subset with explicit zero and clear values', () => {
    expect(assistantUpdateIngredientSchema.safeParse(request).success).toBe(true);
  });

  it('rejects empty, unknown, malformed and out-of-domain updates', () => {
    const invalid = [
      { ...request, changes: {} },
      { ...request, changes: { ...request.changes, image: 'https://example.test/image.png' } },
      { ...request, changes: { quantity: -1 } },
      { ...request, changes: { quantity: 100001 } },
      { ...request, changes: { unit: 'box' } },
      { ...request, changes: { expirationDate: '2026-02-30' } },
      { ...request, assistantAction: { ...request.assistantAction, targetID: 'other' } },
      { ...request, assistantAction: { ...request.assistantAction, operation: 'delete' } }
    ];

    for (const value of invalid) {
      expect(assistantUpdateIngredientSchema.safeParse(value).success).toBe(false);
    }
  });
});
