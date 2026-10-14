import { createHash } from 'node:crypto';

export function createHouseholdMealRecipeId(proposalId: string, alias: string): string {
  return `ai_${createHash('sha256').update(`${proposalId}\u0000${alias}`).digest('hex').slice(0, 32)}`;
}

/** Create the per-person recipe projection stored with a household calendar event. */
export function createHouseholdMealRecipeSnapshot(
  rawRecipe: Record<string, unknown>
): Record<string, unknown> {
  const baseServings =
    typeof rawRecipe.baseServings === 'number' &&
    Number.isFinite(rawRecipe.baseServings) &&
    rawRecipe.baseServings > 0
      ? rawRecipe.baseServings
      : 1;
  const ingredients = Array.isArray(rawRecipe.ingredients)
    ? rawRecipe.ingredients.flatMap((rawIngredient) => {
        if (!rawIngredient || typeof rawIngredient !== 'object' || Array.isArray(rawIngredient)) {
          return [];
        }
        const ingredient = rawIngredient as Record<string, unknown>;
        if (
          typeof ingredient.name !== 'string' ||
          typeof ingredient.quantity !== 'number' ||
          !Number.isFinite(ingredient.quantity) ||
          typeof ingredient.unit !== 'string'
        ) {
          return [];
        }
        return [
          {
            name: ingredient.name,
            quantity: roundQuantity(ingredient.quantity / baseServings),
            unit: ingredient.unit,
            preparation: nullableString(ingredient.preparation),
            isOptional: ingredient.isOptional === true,
            substitutes: stringArray(ingredient.substitutes),
            notes: nullableString(ingredient.notes)
          }
        ];
      })
    : [];
  const legacySteps = normalizeStepList(rawRecipe.steps);
  const rawLevels = rawRecipe.instructionsByLevel;
  const levels =
    rawLevels && typeof rawLevels === 'object' && !Array.isArray(rawLevels)
      ? (rawLevels as Record<string, unknown>)
      : null;
  const instructionsByLevel = {
    basic: normalizeStepList(levels?.basic).length ? normalizeStepList(levels?.basic) : legacySteps,
    intermediate: normalizeStepList(levels?.intermediate).length
      ? normalizeStepList(levels?.intermediate)
      : legacySteps,
    expert: normalizeStepList(levels?.expert).length
      ? normalizeStepList(levels?.expert)
      : legacySteps
  };

  return {
    name: nullableString(rawRecipe.name) ?? 'Receta',
    description: nullableString(rawRecipe.description) ?? '',
    difficulty: nullableString(rawRecipe.difficulty) ?? 'medium',
    cuisine: nullableString(rawRecipe.cuisine),
    totalTime: finiteNumber(rawRecipe.totalTime),
    prepTime: finiteNumber(rawRecipe.prepTime),
    cookTime: finiteNumber(rawRecipe.cookTime),
    restTime: finiteNumber(rawRecipe.restTime),
    baseServings: 1,
    calories: finiteNumber(rawRecipe.calories),
    ingredients,
    utensils: stringArray(rawRecipe.utensils),
    guidance: normalizeGuidance(rawRecipe.guidance),
    instructionsByLevel,
    nutrition: normalizeNutrition(rawRecipe.nutrition),
    storage: normalizeStorage(rawRecipe.storage),
    tags: stringArray(rawRecipe.tags)
  };
}

function roundQuantity(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeNutrition(value: unknown): Record<string, unknown> | null {
  const nutrition = normalizeObject(value);
  if (!nutrition) return null;
  const calories = finiteNumber(nutrition.calories);
  const protein = finiteNumber(nutrition.protein);
  const carbs = finiteNumber(nutrition.carbs);
  const fat = finiteNumber(nutrition.fat);
  if (
    calories === null ||
    protein === null ||
    carbs === null ||
    fat === null ||
    [calories, protein, carbs, fat].some((metric) => metric < 0)
  ) {
    return null;
  }
  const fiber = finiteNumber(nutrition.fiber);
  return {
    calories,
    protein,
    carbs,
    fat,
    fiber: fiber !== null && fiber >= 0 ? fiber : null
  };
}

function normalizeStorage(value: unknown): Record<string, unknown> | null {
  const storage = normalizeObject(value);
  if (!storage) return null;
  return {
    method: nullableString(storage.method) ?? '',
    duration: nullableString(storage.duration) ?? '',
    reheatingInstructions:
      nullableString(storage.reheatingInstructions) ?? nullableString(storage.reheating),
    container: nullableString(storage.container),
    freezingPossible: storage.freezingPossible === true,
    freezingDuration: nullableString(storage.freezingDuration)
  };
}

function normalizeGuidance(value: unknown): Record<string, unknown> | null {
  const guidance = normalizeObject(value);
  if (!guidance) return null;
  return {
    appliances: stringArray(guidance.appliances),
    parallelTasks: stringArray(guidance.parallelTasks),
    tipsAndVariations: stringArray(guidance.tipsAndVariations),
    batchCookingWarning: nullableString(guidance.batchCookingWarning)
  };
}

function normalizeStepList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawStep, index) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return [];
    const step = rawStep as Record<string, unknown>;
    if (typeof step.instruction !== 'string' || !step.instruction.trim()) return [];
    return [
      {
        stepNumber:
          typeof step.stepNumber === 'number' && Number.isInteger(step.stepNumber)
            ? step.stepNumber
            : index + 1,
        instruction: step.instruction,
        duration: finiteNumber(step.duration),
        temperature: normalizeObject(step.temperature),
        timerRequired: step.timerRequired === true,
        timerDuration: finiteNumber(step.timerDuration),
        tips: nullableString(step.tips),
        warning: nullableString(step.warning),
        illustration: null
      }
    ];
  });
}
