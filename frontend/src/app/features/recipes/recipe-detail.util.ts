import type { RecipeDetailLevel } from '../../shared/models/recipe-instructions';
import type { TranslationKey } from '../../core/i18n';
import { COOKING_LEVEL_LABEL_KEYS } from '../../shared/models/home-profile';
import type { CookingLevel } from '../../shared/models/home-profile';

export type RecipeDetailPreferences = Readonly<Record<string, RecipeDetailLevel>>;

const DETAIL_LEVEL_COOKING_LEVEL: Record<RecipeDetailLevel, CookingLevel> = {
  basic: 'beginner',
  intermediate: 'intermediate',
  expert: 'expert'
};

/** Reuse the personal-profile labels so the recipe selector names the same skill levels. */
export function recipeDetailLevelLabelKey(level: RecipeDetailLevel): TranslationKey {
  return COOKING_LEVEL_LABEL_KEYS[DETAIL_LEVEL_COOKING_LEVEL[level]];
}

/** Keep recipe generation aligned with the cook's profile: unknown/none means beginner detail. */
export function detailLevelForCookingLevel(level: unknown): RecipeDetailLevel {
  if (level === 'expert') return 'expert';
  if (level === 'intermediate') return 'intermediate';
  return 'basic';
}

/** Scale a stored base quantity for display without mutating the recipe. */
export function scaleRecipeQuantity(
  quantity: number,
  baseServings: number,
  selectedServings: number
): number {
  if (
    !Number.isFinite(quantity) ||
    !Number.isFinite(baseServings) ||
    baseServings <= 0 ||
    !Number.isFinite(selectedServings) ||
    selectedServings <= 0
  ) {
    return quantity;
  }

  return Math.round(((quantity * selectedServings) / baseServings) * 100) / 100;
}

/** Return a recipe's in-session level, defaulting to the current form selection. */
export function recipeDetailLevelFor(
  preferences: RecipeDetailPreferences,
  recipeId: string,
  fallback: RecipeDetailLevel
): RecipeDetailLevel {
  return preferences[recipeId] ?? fallback;
}

/** Remember the presentation choice immutably, keyed per recipe. */
export function rememberRecipeDetailLevel(
  preferences: RecipeDetailPreferences,
  recipeId: string,
  level: RecipeDetailLevel
): RecipeDetailPreferences {
  return { ...preferences, [recipeId]: level };
}
