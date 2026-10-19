import { recipeCategoryEmoji } from './recipe-category-emoji';

describe('recipeCategoryEmoji', () => {
  it('keeps the approved food symbols for ingredient categories', () => {
    expect(recipeCategoryEmoji('dairy')).toBe('🧀');
    expect(recipeCategoryEmoji('meat')).toBe('🥩');
    expect(recipeCategoryEmoji('fish')).toBe('🐟');
    expect(recipeCategoryEmoji('vegetables')).toBe('🥬');
    expect(recipeCategoryEmoji('fruits')).toBe('🍎');
    expect(recipeCategoryEmoji('grains')).toBe('🌾');
    expect(recipeCategoryEmoji('spices')).toBe('🧂');
    expect(recipeCategoryEmoji('frozen')).toBe('❄️');
  });

  it('does not add a decorative emoji for an unknown category', () => {
    expect(recipeCategoryEmoji('unknown')).toBe('');
  });
});
