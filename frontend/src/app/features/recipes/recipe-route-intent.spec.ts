import { resolveRecipeRouteIntent } from './recipe-route-intent';

describe('resolveRecipeRouteIntent', () => {
  it('opens AI when its fragment and a recipe query are both present', () => {
    expect(resolveRecipeRouteIntent('recipe-1', 'ai')).toEqual({ type: 'ai' });
  });

  it('uses a selected recipe when the AI fragment is absent', () => {
    expect(resolveRecipeRouteIntent('recipe-1', null)).toEqual({ type: 'recipe', recipeId: 'recipe-1' });
  });

  it('does not activate route-driven dialogs without a matching URL state', () => {
    expect(resolveRecipeRouteIntent(null, null)).toEqual({ type: 'none' });
    expect(resolveRecipeRouteIntent('', null)).toEqual({ type: 'none' });
    expect(resolveRecipeRouteIntent(null, 'other')).toEqual({ type: 'none' });
  });
});
