import type { getDatabase } from '../config/database.js';
import type { ResolvedMealProposalRecipe } from '../schemas/household-meal-proposal.schema.js';
import { type HouseholdRecipeCatalogAttachmentInput } from './household-meal-recipe-catalog-attachment.js';

type SqliteDb = ReturnType<typeof getDatabase>;

export interface HouseholdMealRecipeCatalogEntry extends ResolvedMealProposalRecipe {
  selectable: boolean;
}

export interface HouseholdMealRecipeCatalog {
  recipes: HouseholdMealRecipeCatalogEntry[];
  attachment: HouseholdRecipeCatalogAttachmentInput;
}

export class HouseholdMealRecipeCatalogReadError extends Error {
  constructor(readonly code: 'HOUSEHOLD_RECIPE_CATALOG_UNAVAILABLE') {
    super(code);
    this.name = 'HouseholdMealRecipeCatalogReadError';
  }
}

interface RecipeRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
}

/** Read exactly the recipe set visible to the regular recipe library; never include user_recipes notes. */
export function readHouseholdMealRecipeCatalog(
  db: SqliteDb,
  userId: string
): HouseholdMealRecipeCatalog {
  const rows = db
    .prepare(
      `SELECT id, name, description, difficulty, cuisine, meal_type, total_time, prep_time,
              cook_time, rest_time, servings, calories, ingredients, utensils, steps,
              recipe_guidance, nutrition, storage, tags
         FROM recipes
        WHERE author = 'catalog' OR author_id = ? OR is_public = 1
        ORDER BY name COLLATE NOCASE, id`
    )
    .all(userId) as RecipeRow[];

  const recipes = rows.map((row, index) => {
    const recipe = normalizeRecipeRow(row);
    const alias = `R${index + 1}`;
    return {
      alias,
      source: 'catalog' as const,
      recipeId: row.id,
      recipe,
      selectable: isSelectableRecipe(recipe)
    };
  });

  return {
    recipes,
    attachment: {
      recipes: recipes.map(({ alias, selectable, recipe }) => ({ alias, selectable, recipe }))
    }
  };
}

function parseJsonColumn(value: unknown, fallback: unknown): unknown {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new HouseholdMealRecipeCatalogReadError('HOUSEHOLD_RECIPE_CATALOG_UNAVAILABLE');
  }
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeNutrition(value: unknown): Record<string, number | null> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const calories = nullableNumber(source.calories);
  const protein = nullableNumber(source.protein);
  const carbs = nullableNumber(source.carbs);
  const fat = nullableNumber(source.fat);
  if (calories === null || protein === null || carbs === null || fat === null) return null;
  const nutrition: Record<string, number | null> = {
    calories,
    protein,
    carbs,
    fat,
    fiber: nullableNumber(source.fiber)
  };
  for (const field of ['sugar', 'sodium'] as const) {
    const metric = nullableNumber(source[field]);
    if (metric !== null) nutrition[field] = metric;
  }
  return nutrition;
}

function normalizeIngredient(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    return {
      name: value,
      quantity: null,
      unit: null,
      preparation: null,
      isOptional: false,
      substitutes: [],
      notes: null
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HouseholdMealRecipeCatalogReadError('HOUSEHOLD_RECIPE_CATALOG_UNAVAILABLE');
  }
  const source = value as Record<string, unknown>;
  if (typeof source.name !== 'string' || !source.name.trim()) {
    throw new HouseholdMealRecipeCatalogReadError('HOUSEHOLD_RECIPE_CATALOG_UNAVAILABLE');
  }
  return {
    name: source.name,
    quantity: nullableNumber(source.quantity),
    unit: nullableString(source.unit),
    preparation: nullableString(source.preparation),
    isOptional: source.isOptional === true,
    substitutes: stringArray(source.substitutes),
    notes: nullableString(source.notes)
  };
}

function normalizeStep(value: unknown, index: number): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.instruction !== 'string' || !source.instruction.trim()) return null;
  const duration = nullableNumber(source.duration);
  const timerDuration = nullableNumber(source.timerDuration);
  const rawTemperature = source.temperature;
  const temperature =
    rawTemperature && typeof rawTemperature === 'object' && !Array.isArray(rawTemperature)
      ? {
          value: nullableNumber((rawTemperature as Record<string, unknown>).value),
          unit: nullableString((rawTemperature as Record<string, unknown>).unit)
        }
      : null;
  return {
    stepNumber:
      typeof source.stepNumber === 'number' && Number.isInteger(source.stepNumber)
        ? source.stepNumber
        : index + 1,
    instruction: source.instruction,
    duration,
    tips: nullableString(source.tips),
    warning: nullableString(source.warning),
    temperature:
      temperature && temperature.value !== null && temperature.unit !== null ? temperature : null,
    timerRequired: source.timerRequired === true,
    timerDuration,
    illustration: null
  };
}

function normalizeStepList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step, index) => {
    const normalized = normalizeStep(step, index);
    return normalized ? [normalized] : [];
  });
}

function normalizeSteps(value: unknown): {
  steps: Record<string, unknown>[] | null;
  instructionsByLevel: Record<string, Record<string, unknown>[]> | null;
} {
  if (Array.isArray(value)) return { steps: normalizeStepList(value), instructionsByLevel: null };
  if (!value || typeof value !== 'object') return { steps: [], instructionsByLevel: null };
  const source = value as Record<string, unknown>;
  const levels = ['basic', 'intermediate', 'expert'] as const;
  const normalized = Object.fromEntries(
    levels.map((level) => [level, normalizeStepList(source[level])])
  );
  return {
    steps: null,
    instructionsByLevel: normalized
  };
}

function normalizeRecipeRow(row: RecipeRow): Record<string, unknown> {
  const ingredientsValue = parseJsonColumn(row.ingredients, []);
  const utensilsValue = parseJsonColumn(row.utensils, []);
  const stepsValue = parseJsonColumn(row.steps, []);
  const mealTypeValue = parseJsonColumn(row.meal_type, []);
  const tagsValue = parseJsonColumn(row.tags, []);
  const guidanceValue = parseJsonColumn(row.recipe_guidance, null);
  const nutritionValue = parseJsonColumn(row.nutrition, null);
  const storageValue = parseJsonColumn(row.storage, null);
  const steps = normalizeSteps(stepsValue);
  const ingredients = Array.isArray(ingredientsValue)
    ? ingredientsValue.map(normalizeIngredient)
    : [];
  const guidance =
    guidanceValue && typeof guidanceValue === 'object' && !Array.isArray(guidanceValue)
      ? (guidanceValue as Record<string, unknown>)
      : null;
  const rawStorage =
    storageValue && typeof storageValue === 'object' && !Array.isArray(storageValue)
      ? (storageValue as Record<string, unknown>)
      : null;

  return {
    name: row.name,
    description: row.description ?? '',
    difficulty: nullableString(row.difficulty) ?? 'medium',
    cuisine: nullableString(row.cuisine),
    mealType: stringArray(mealTypeValue),
    totalTime: nullableNumber(row.total_time),
    prepTime: nullableNumber(row.prep_time),
    cookTime: nullableNumber(row.cook_time),
    restTime: nullableNumber(row.rest_time),
    baseServings: nullableNumber(row.servings),
    calories: nullableNumber(row.calories),
    ingredients,
    utensils: stringArray(utensilsValue),
    guidance: guidance
      ? {
          appliances: stringArray(guidance.appliances),
          parallelTasks: stringArray(guidance.parallelTasks),
          tipsAndVariations: stringArray(guidance.tipsAndVariations),
          batchCookingWarning: nullableString(guidance.batchCookingWarning)
        }
      : null,
    ...steps,
    nutrition: normalizeNutrition(nutritionValue),
    storage: rawStorage
      ? {
          method: nullableString(rawStorage.method),
          duration: nullableString(rawStorage.duration),
          reheatingInstructions:
            nullableString(rawStorage.reheatingInstructions) ??
            nullableString(rawStorage.reheating),
          container: nullableString(rawStorage.container),
          freezingPossible: rawStorage.freezingPossible === true,
          freezingDuration: nullableString(rawStorage.freezingDuration)
        }
      : null,
    tags: stringArray(tagsValue)
  };
}

function isSelectableRecipe(recipe: Record<string, unknown>): boolean {
  const ingredients = recipe.ingredients;
  const hasIngredients =
    Array.isArray(ingredients) &&
    ingredients.length > 0 &&
    ingredients.every(
      (ingredient) =>
        ingredient &&
        typeof ingredient === 'object' &&
        typeof (ingredient as Record<string, unknown>).quantity === 'number' &&
        Number.isFinite((ingredient as Record<string, unknown>).quantity) &&
        ((ingredient as Record<string, unknown>).quantity as number) > 0 &&
        typeof (ingredient as Record<string, unknown>).unit === 'string' &&
        Boolean((ingredient as Record<string, unknown>).unit)
    );
  const hasSteps =
    (Array.isArray(recipe.steps) && recipe.steps.length > 0) ||
    (recipe.instructionsByLevel &&
      typeof recipe.instructionsByLevel === 'object' &&
      ['basic', 'intermediate', 'expert'].every((level) => {
        const steps = (recipe.instructionsByLevel as Record<string, unknown>)[level];
        return Array.isArray(steps) && steps.length > 0;
      }));
  return (
    typeof recipe.baseServings === 'number' &&
    recipe.baseServings > 0 &&
    hasIngredients &&
    Boolean(hasSteps)
  );
}
