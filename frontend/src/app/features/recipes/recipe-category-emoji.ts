const FOOD_CATEGORY_EMOJI: Readonly<Record<string, string>> = {
  dairy: '🧀',
  meat: '🥩',
  fish: '🐟',
  vegetables: '🥬',
  fruits: '🍎',
  grains: '🌾',
  spices: '🧂',
  frozen: '❄️'
};

/** Food-category symbols carry ingredient meaning; unknown categories stay undecorated. */
export function recipeCategoryEmoji(category: string): string {
  return FOOD_CATEGORY_EMOJI[category] ?? '';
}
