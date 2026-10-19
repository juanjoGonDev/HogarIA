import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { findEmojiViolations } from './check-ui-emoji.mjs';

const semanticSources = [
  [
    'frontend/src/app/shared/models/taste-profile.ts',
    `
export const COMMON_ALLERGENS = [{ value: 'Lactosa', icon: '🥛' }];
export const COMMON_LIKES = [{ value: 'Pollo', icon: '🍗' }, { value: 'Cocina española', icon: '🇪🇸' }];
export const COMMON_DISLIKES = [{ value: 'Aceitunas', icon: '🫒' }];
`
  ],
  [
    'frontend/src/app/shared/components/ai-participants.component.ts',
    `const PREFERENCE_PRESETS = { allergies: [{ value: 'egg', emoji: '🥚', labelKey: 'egg' }] };`
  ],
  [
    'frontend/src/app/features/recipes/recipe-category-emoji.ts',
    "const FOOD_CATEGORY_EMOJI: Record<string, string> = { vegetables: '🥬', frozen: '❄️' };"
  ],
  [
    'frontend/src/app/core/i18n/dict/pantry.ts',
    "export const pantryEs = { 'pantry.ingredientes': '🥬 Ingredientes' };\nexport const pantryEn = { 'pantry.ingredientes': '🥬 Ingredients' };"
  ],
  [
    'frontend/src/app/core/i18n/dict/onboarding.ts',
    `
export const onboardingEs = { 'onboarding.me_gusta': 'Me gusta 👍', 'onboarding.mejor_no': 'Mejor no 👎' };
export const onboardingEn = { 'onboarding.me_gusta': 'I like it 👍', 'onboarding.mejor_no': 'Better not 👎' };
`
  ]
];

test('allows only approved allergy, taste, recipe-preference, and category icons', () => {
  for (const [file, source] of semanticSources) {
    assert.deepEqual(findEmojiViolations(file, source), [], file);
  }
});

test('recognizes the currently approved source records without widening the file scope', () => {
  const files = [
    'frontend/src/app/shared/models/taste-profile.ts',
    'frontend/src/app/shared/components/ai-participants.component.ts',
    'frontend/src/app/features/recipes/recipe-category-emoji.ts',
    'frontend/src/app/core/i18n/dict/pantry.ts',
    'frontend/src/app/core/i18n/dict/onboarding.ts'
  ];
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    assert.deepEqual(findEmojiViolations(file, source), [], file);
  }
});

test('detects generic emoji and decorative emoji adjacent to approved content', () => {
  const source = `${semanticSources[0][1].replace("icon: '🍗'", "icon: '🍗', label: '✨', details: { icon: '🧨' }")}\n// 💡 comment\nconst tooltip = '🎉';\n/* icon: '🪄' */`;
  assert.deepEqual(
    findEmojiViolations('frontend/src/app/shared/models/taste-profile.ts', source).map(
      (violation) => violation.emoji
    ),
    ['✨', '🧨', '💡', '🎉', '🪄']
  );
});

test('allows only emoji values in recipe preference presets', () => {
  const source = `const PREFERENCE_PRESETS = { allergies: [{ value: 'egg', emoji: '🥚', labelKey: 'egg' }] };\nconst other = '🎉';`;
  assert.deepEqual(
    findEmojiViolations(
      'frontend/src/app/shared/components/ai-participants.component.ts',
      source
    ).map((violation) => violation.emoji),
    ['🎉']
  );
});

test('does not allow altered or newly introduced dictionary values', () => {
  const onboarding = `export const onboardingEs = { 'onboarding.me_gusta': 'Me gusta 👍 y 🎉' };`;
  const pantry = `export const pantryEs = { 'pantry.nevera': '🧊 Nevera' };`;
  const pantryString = `const helpText = "'pantry.ingredientes': '🥬 Ingredients'";`;
  const newCategory = `export const FOOD_CATEGORY_EMOJI = { novelty: '🎉' };`;
  assert.deepEqual(
    [
      ...findEmojiViolations('frontend/src/app/core/i18n/dict/onboarding.ts', onboarding),
      ...findEmojiViolations('frontend/src/app/core/i18n/dict/pantry.ts', pantry),
      ...findEmojiViolations('frontend/src/app/core/i18n/dict/pantry.ts', pantryString),
      ...findEmojiViolations(
        'frontend/src/app/features/recipes/recipe-category-emoji.ts',
        newCategory
      )
    ].map((violation) => violation.emoji),
    ['👍', '🎉', '🧊', '🥬', '🎉']
  );
});

test('rejects a renamed or incomplete semantic data block rather than widening its scope', () => {
  const renamed = "export const COMMON_ALLERGEN_LABELS = [{ icon: '🍳' }];";
  const incomplete = "export const COMMON_ALLERGENS: ChipOption[] = [{ icon: '🍳'";
  for (const source of [renamed, incomplete]) {
    assert.deepEqual(
      findEmojiViolations('frontend/src/app/shared/models/taste-profile.ts', source).map(
        (violation) => violation.emoji
      ),
      ['🍳']
    );
  }
});

test('reports emoji line and offset for a file without semantic exceptions', () => {
  const source = 'const title = "Title";\nconst action = "🚀 Launch";';
  assert.deepEqual(findEmojiViolations('frontend/src/app/features/example.ts', source), [
    { emoji: '🚀', index: 39 }
  ]);
});
