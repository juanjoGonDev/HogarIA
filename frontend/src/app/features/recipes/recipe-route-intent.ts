export type RecipeRouteIntent =
  | { type: 'ai' }
  | { type: 'recipe'; recipeId: string }
  | { type: 'none' };

/** AI links use the fragment; a selected recipe deep link uses its query parameter. */
export function resolveRecipeRouteIntent(recipeId: string | null, fragment: string | null): RecipeRouteIntent {
  if (fragment === 'ai') return { type: 'ai' };
  if (recipeId) return { type: 'recipe', recipeId };
  return { type: 'none' };
}
