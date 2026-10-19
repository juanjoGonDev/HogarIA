import { describe, expect, it, vi } from 'vitest';
import { readHouseholdMealShoppingPreviewForProposedMeals } from './household-meal-shopping-preview.store.js';

const range = { startDate: '2026-10-19', endDate: '2026-10-25' };

function previewDatabase(options: {
  sharedPantry: boolean;
  ingredients?: Array<{ id: string; name: string; quantity: number; unit: string }>;
}) {
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('SELECT shared_pantry')) {
      return { get: vi.fn(() => ({ shared_pantry: options.sharedPantry ? 1 : 0 })) };
    }
    if (sql.includes('FROM ingredients')) {
      return { all: vi.fn(() => options.ingredients ?? []) };
    }
    throw new Error(`Unexpected read query: ${sql}`);
  });
  return { db: { prepare } as never, prepare };
}

describe('read-only shopping preview from an unconfirmed meal proposal', () => {
  it('scales and aggregates scheduled ingredients, then subtracts shared stock once', () => {
    const { db, prepare } = previewDatabase({
      sharedPantry: true,
      ingredients: [{ id: 'stock-1', name: 'VERDURAS', quantity: 25, unit: 'g' }]
    });

    const preview = readHouseholdMealShoppingPreviewForProposedMeals(
      db,
      'home-1',
      range,
      [
        {
          date: '2026-10-20',
          servings: 2,
          recipeSnapshot: {
            baseServings: 1,
            ingredients: [
              { name: 'Verduras', quantity: 20, unit: 'g' },
              { name: 'Aceite', quantity: 5, unit: 'ml', isOptional: true }
            ]
          }
        },
        {
          date: '2026-10-21',
          servings: 1,
          recipeSnapshot: {
            baseServings: 1,
            ingredients: [{ name: ' verduras ', quantity: 20, unit: 'g' }]
          }
        },
        {
          date: '2026-10-22',
          servings: 4,
          recipeSnapshot: null
        },
        {
          date: '2026-10-26',
          servings: 2,
          recipeSnapshot: {
            baseServings: 1,
            ingredients: [{ name: 'Fuera de rango', quantity: 100, unit: 'g' }]
          }
        }
      ],
      '2026-10-19'
    );

    expect(preview).toMatchObject({
      startDate: range.startDate,
      endDate: range.endDate,
      sharedPantry: true,
      plannedMealCount: 3,
      warnings: [{ code: 'RECIPE_SNAPSHOT_UNAVAILABLE', date: '2026-10-22' }]
    });
    expect(preview.requiredIngredients).toEqual([
      expect.objectContaining({
        name: 'Verduras',
        unit: 'g',
        quantity: 60,
        stockQuantity: 25,
        missingQuantity: 35,
        status: 'matched'
      })
    ]);
    expect(preview.optionalIngredients).toEqual([
      expect.objectContaining({
        name: 'Aceite',
        quantity: 10,
        missingQuantity: 10,
        status: 'not_found'
      })
    ]);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(
      prepare.mock.calls.every(([sql]) => sql.trimStart().toUpperCase().startsWith('SELECT'))
    ).toBe(true);
  });

  it('does not claim shortages when household pantry is private or matching is unsafe', () => {
    const privatePantry = previewDatabase({ sharedPantry: false });
    const privatePreview = readHouseholdMealShoppingPreviewForProposedMeals(
      privatePantry.db,
      'home-1',
      range,
      [
        {
          date: '2026-10-20',
          servings: 2,
          recipeSnapshot: {
            baseServings: 1,
            ingredients: [{ name: 'Leche', quantity: 100, unit: 'ml' }]
          }
        }
      ],
      '2026-10-19'
    );
    expect(privatePreview.requiredIngredients[0]).toMatchObject({
      status: 'pantry_not_shared',
      missingQuantity: null,
      stockQuantity: null
    });

    const ambiguous = previewDatabase({
      sharedPantry: true,
      ingredients: [
        { id: 'milk-1', name: 'leche', quantity: 2, unit: 'l' },
        { id: 'milk-2', name: 'LECHE', quantity: 1, unit: 'l' },
        { id: 'flour-1', name: 'Harina', quantity: 20, unit: 'kg' }
      ]
    });
    const ambiguousPreview = readHouseholdMealShoppingPreviewForProposedMeals(
      ambiguous.db,
      'home-1',
      range,
      [
        {
          date: '2026-10-20',
          servings: 1,
          recipeSnapshot: {
            baseServings: 1,
            ingredients: [
              { name: 'Leche', quantity: 1, unit: 'l' },
              { name: 'Harina', quantity: 200, unit: 'g' },
              { name: 'Canela', quantity: 1, unit: 'g', isOptional: true }
            ]
          }
        }
      ],
      '2026-10-19'
    );
    expect(ambiguousPreview.requiredIngredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Leche', status: 'ambiguous', missingQuantity: null }),
        expect.objectContaining({ name: 'Harina', status: 'unit_mismatch', missingQuantity: null })
      ])
    );
    expect(ambiguousPreview.optionalIngredients[0]).toMatchObject({
      name: 'Canela',
      status: 'not_found',
      missingQuantity: 1
    });
  });

  it('ignores out-of-range, past, and non-positive meal proposals', () => {
    const { db } = previewDatabase({ sharedPantry: true });
    const preview = readHouseholdMealShoppingPreviewForProposedMeals(
      db,
      'home-1',
      range,
      [
        {
          date: '2026-10-18',
          servings: 1,
          recipeSnapshot: { baseServings: 1, ingredients: [{ name: 'A', quantity: 1, unit: 'g' }] }
        },
        {
          date: '2026-10-22',
          servings: 0,
          recipeSnapshot: { baseServings: 1, ingredients: [{ name: 'B', quantity: 1, unit: 'g' }] }
        },
        {
          date: '2026-10-26',
          servings: 1,
          recipeSnapshot: { baseServings: 1, ingredients: [{ name: 'C', quantity: 1, unit: 'g' }] }
        }
      ],
      '2026-10-19'
    );

    expect(preview.plannedMealCount).toBe(0);
    expect(preview.requiredIngredients).toEqual([]);
    expect(preview.warnings).toEqual([]);
  });
});
