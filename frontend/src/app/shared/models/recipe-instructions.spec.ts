import { recipeInstructionsForLevel } from './recipe-instructions';

describe('recipeInstructionsForLevel', () => {
  const instructionsByLevel = {
    basic: [{ stepNumber: 1, instruction: 'Cocer.' }],
    intermediate: [{ stepNumber: 1, instruction: 'Cortar y cocer.' }],
    expert: [{ stepNumber: 1, instruction: 'Cortar en dados y cocer a hervor suave.' }]
  };

  it('returns only the requested detail variant', () => {
    expect(recipeInstructionsForLevel({ instructionsByLevel }, 'expert')).toEqual(
      instructionsByLevel.expert
    );
  });

  it('keeps legacy recipes readable and returns no fabricated variants', () => {
    const legacySteps = [{ stepNumber: 1, instruction: 'Receta anterior.' }];
    expect(recipeInstructionsForLevel({ steps: legacySteps }, 'basic')).toBe(legacySteps);
  });

  it('returns an empty list for absent data instead of throwing', () => {
    expect(recipeInstructionsForLevel({}, 'intermediate')).toEqual([]);
  });
});
