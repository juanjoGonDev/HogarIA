import { z } from 'zod';
import type { HouseholdMealShoppingPreviewQuery } from '../schemas/household-meal-shopping-preview.schema.js';
import { normalizeIngredientMatchKey } from './ingredient-match.js';

type SqliteDb = import('better-sqlite3').Database;

const recipeSnapshotSchema = z.object({
  baseServings: z.literal(1),
  ingredients: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        quantity: z.number().finite().positive().max(1_000_000),
        unit: z.string().trim().min(1).max(40),
        isOptional: z.boolean().optional()
      })
    )
    .min(1)
    .max(100)
});

type IngredientNeed = {
  name: string;
  unit: string;
  quantity: number;
};

type SnapshotMeal = {
  date: string;
  servings: number;
  recipe_snapshot: string | null;
};

type HouseholdIngredient = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
};

export type ShoppingPreviewIngredient = IngredientNeed & {
  stockQuantity: number | null;
  missingQuantity: number | null;
  status: 'matched' | 'not_found' | 'ambiguous' | 'unit_mismatch' | 'pantry_not_shared';
};

export type HouseholdMealShoppingPreview = {
  startDate: string;
  endDate: string;
  sharedPantry: boolean;
  plannedMealCount: number;
  requiredIngredients: ShoppingPreviewIngredient[];
  optionalIngredients: ShoppingPreviewIngredient[];
  warnings: Array<{ code: 'RECIPE_SNAPSHOT_UNAVAILABLE'; date: string }>;
};

export class HouseholdMealShoppingPreviewError extends Error {
  constructor(readonly code: 'HOUSEHOLD_NOT_FOUND') {
    super(code);
    this.name = 'HouseholdMealShoppingPreviewError';
  }
}

/** Calculate future shared meals from persisted recipe snapshots; this function never writes. */
export function readHouseholdMealShoppingPreview(
  db: SqliteDb,
  householdId: string,
  range: HouseholdMealShoppingPreviewQuery,
  today = new Date().toISOString().slice(0, 10)
): HouseholdMealShoppingPreview {
  const household = db
    .prepare('SELECT shared_pantry FROM households WHERE id = ?')
    .get(householdId) as { shared_pantry: number | null } | undefined;
  if (!household) throw new HouseholdMealShoppingPreviewError('HOUSEHOLD_NOT_FOUND');

  const sharedPantry = household.shared_pantry === 1;
  const meals = db
    .prepare(
      `SELECT m.date, m.servings, m.recipe_snapshot
       FROM meals m
       JOIN weekly_calendars wc ON wc.id = m.calendar_id
       LEFT JOIN meal_consumptions mc ON mc.meal_id = m.id
       WHERE wc.household_id = ?
         AND m.source_proposal_id IS NOT NULL
         AND m.date BETWEEN ? AND ?
         AND m.date >= ?
         AND mc.meal_id IS NULL
         AND m.servings > 0
       ORDER BY m.date, m.id`
    )
    .all(householdId, range.startDate, range.endDate, today) as SnapshotMeal[];

  const required = new Map<string, IngredientNeed>();
  const optional = new Map<string, IngredientNeed>();
  const warnings: HouseholdMealShoppingPreview['warnings'] = [];
  for (const meal of meals) {
    const snapshot = parseRecipeSnapshot(meal.recipe_snapshot);
    if (!snapshot) {
      warnings.push({ code: 'RECIPE_SNAPSHOT_UNAVAILABLE', date: meal.date });
      continue;
    }
    for (const ingredient of snapshot.ingredients) {
      addNeed(ingredient.isOptional ? optional : required, ingredient, meal.servings);
    }
  }

  const ingredients = sharedPantry ? readHouseholdIngredients(db, householdId) : [];
  const remainingStock = new Map<string, number>();
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    sharedPantry,
    plannedMealCount: meals.length,
    requiredIngredients: [...required.values()].map((need) =>
      applyHouseholdStock(need, ingredients, remainingStock, sharedPantry)
    ),
    optionalIngredients: [...optional.values()].map((need) =>
      applyHouseholdStock(need, ingredients, remainingStock, sharedPantry)
    ),
    warnings
  };
}

function parseRecipeSnapshot(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = recipeSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function addNeed(
  collection: Map<string, IngredientNeed>,
  ingredient: { name: string; unit: string; quantity: number },
  servings: number
): void {
  const key = JSON.stringify([normalizeIngredientMatchKey(ingredient.name), ingredient.unit]);
  const current = collection.get(key);
  if (current) {
    current.quantity = roundQuantity(current.quantity + ingredient.quantity * servings);
  } else {
    collection.set(key, {
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: roundQuantity(ingredient.quantity * servings)
    });
  }
}

function readHouseholdIngredients(db: SqliteDb, householdId: string): HouseholdIngredient[] {
  return db
    .prepare(
      `SELECT id, name, quantity, unit FROM ingredients
       WHERE household_id = ? ORDER BY id`
    )
    .all(householdId) as HouseholdIngredient[];
}

function applyHouseholdStock(
  need: IngredientNeed,
  ingredients: HouseholdIngredient[],
  remainingStock: Map<string, number>,
  sharedPantry: boolean
): ShoppingPreviewIngredient {
  if (!sharedPantry) {
    return {
      ...need,
      stockQuantity: null,
      missingQuantity: null,
      status: 'pantry_not_shared'
    };
  }

  const normalizedName = normalizeIngredientMatchKey(need.name);
  const named = ingredients.filter(
    (ingredient) => normalizeIngredientMatchKey(ingredient.name) === normalizedName
  );
  const exactUnit = named.filter((ingredient) => ingredient.unit === need.unit);
  if (exactUnit.length > 1) {
    return { ...need, stockQuantity: null, missingQuantity: null, status: 'ambiguous' };
  }
  if (exactUnit.length === 0) {
    if (named.length) {
      return { ...need, stockQuantity: null, missingQuantity: null, status: 'unit_mismatch' };
    }
    return {
      ...need,
      stockQuantity: 0,
      missingQuantity: need.quantity,
      status: 'not_found'
    };
  }

  const available = Number.isFinite(exactUnit[0].quantity) ? Math.max(0, exactUnit[0].quantity) : 0;
  const stockKey = JSON.stringify([normalizedName, need.unit]);
  const remaining = remainingStock.get(stockKey) ?? available;
  remainingStock.set(stockKey, roundQuantity(Math.max(0, remaining - need.quantity)));
  return {
    ...need,
    stockQuantity: roundQuantity(remaining),
    missingQuantity: roundQuantity(Math.max(0, need.quantity - remaining)),
    status: 'matched'
  };
}

function roundQuantity(quantity: number): number {
  return Number(quantity.toFixed(6));
}
