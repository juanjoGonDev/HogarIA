import { Recipe } from '../../shared/models/recipe.model';
import { buildRecipeEditPayload, recipeToEditDraft } from './recipe-edit.util';

const detailedRecipe: Recipe = {
  id: 'recipe-1',
  name: 'Sopa de prueba',
  description: 'Descripción original',
  difficulty: 'medium',
  cuisine: 'española',
  countryCode: 'ES',
  mealType: ['lunch'],
  totalTime: 40,
  prepTime: 10,
  cookTime: 25,
  restTime: 5,
  servings: 2,
  calories: 420,
  image: 'https://images.example.test/sopa.jpg',
  ingredients: [
    {
      name: 'Calabaza',
      quantity: 300,
      unit: 'g',
      preparation: 'pelada',
      isOptional: false,
      substitutes: ['boniato'],
      notes: 'en dados'
    }
  ],
  utensils: ['Olla'],
  guidance: {
    appliances: ['Cocina de gas'],
    parallelTasks: ['Tuesta el pan mientras hierve.'],
    tipsAndVariations: ['Añade nuez moscada.'],
    batchCookingWarning: 'Dora la calabaza en tandas para evitar que se cueza al vapor.'
  },
  instructionsByLevel: {
    basic: [{ stepNumber: 1, instruction: 'Cuece la calabaza.' }],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Corta la calabaza en cubos y cuece hasta que esté blanda.',
        duration: 20,
        temperature: { value: 100, unit: 'C' },
        timerRequired: true,
        timerDuration: 20,
        tips: 'No dejes que se agarre.',
        warning: 'Cuidado al verter líquido caliente.'
      }
    ],
    expert: [{ stepNumber: 1, instruction: 'Cuece a hervor suave.' }]
  },
  nutrition: { calories: 420, protein: 8, carbs: 55, fat: 16, fiber: 7, sugar: 6, sodium: 300 },
  storage: {
    method: 'Refrigerar',
    container: 'Recipiente hermético',
    duration: '3 días',
    reheatingInstructions: 'Calentar suavemente',
    freezingPossible: true,
    freezingDuration: '2 meses'
  },
  author: 'user',
  authorId: 'user-1',
  timesCooked: 2,
  tags: ['invierno', 'sopa'],
  isFavorite: true,
  isPublic: false,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z')
};

describe('recipe edit payload', () => {
  it('round-trips complete recipe detail without duplicating common fields across levels', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    const { payload, errors } = buildRecipeEditPayload(draft);

    expect(errors).toEqual([]);
    expect(payload).toEqual(
      jasmine.objectContaining({
        name: 'Sopa de prueba',
        description: 'Descripción original',
        difficulty: 'medium',
        cuisine: 'española',
        countryCode: 'ES',
        mealType: ['lunch'],
        totalTime: 40,
        prepTime: 10,
        cookTime: 25,
        restTime: 5,
        servings: 2,
        calories: 420,
        image: 'https://images.example.test/sopa.jpg',
        ingredients: detailedRecipe.ingredients,
        utensils: ['Olla'],
        guidance: detailedRecipe.guidance,
        nutrition: detailedRecipe.nutrition,
        storage: detailedRecipe.storage,
        tags: ['invierno', 'sopa']
      })
    );
    expect(payload?.instructionsByLevel?.basic[0].instruction).toBe('Cuece la calabaza.');
    expect(payload?.instructionsByLevel?.intermediate[0]).toEqual(
      jasmine.objectContaining({ duration: 20, timerDuration: 20 })
    );
    expect(payload?.instructionsByLevel?.expert.length).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(payload, 'steps')).toBeFalse();
  });

  it('preserves and explicitly clears a batch-cooking warning in the edit payload', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    expect(draft.batchCookingWarningText).toBe(
      'Dora la calabaza en tandas para evitar que se cueza al vapor.'
    );
    draft.batchCookingWarningText = '  Cocina las verduras por tandas.  ';

    const { payload, errors } = buildRecipeEditPayload(draft);

    expect(errors).toEqual([]);
    expect(payload?.guidance?.batchCookingWarning).toBe('Cocina las verduras por tandas.');

    draft.batchCookingWarningText = '';
    const cleared = buildRecipeEditPayload(draft);
    expect(cleared.payload?.guidance?.batchCookingWarning).toBeNull();
  });

  it('conserves legacy single-level steps and supports editing nested ingredients and arrays', () => {
    const legacy = recipeToEditDraft({
      ...detailedRecipe,
      instructionsByLevel: undefined,
      steps: [{ stepNumber: 1, instruction: 'Cuece la calabaza.', duration: 20 }]
    });
    legacy.ingredients[0].quantityText = '450';
    legacy.ingredients[0].substitutesText = 'boniato, zanahoria';
    legacy.utensilsText = 'Olla\nBatidora';
    legacy.tagsText = 'otoño, sopa';
    legacy.steps![0].instruction = 'Cuece la calabaza hasta que esté tierna.';

    const { payload, errors } = buildRecipeEditPayload(legacy);

    expect(errors).toEqual([]);
    expect(payload?.ingredients?.[0]).toEqual(
      jasmine.objectContaining({ quantity: 450, substitutes: ['boniato', 'zanahoria'] })
    );
    expect(payload?.utensils).toEqual(['Olla', 'Batidora']);
    expect(payload?.tags).toEqual(['otoño', 'sopa']);
    expect(payload?.steps?.[0]).toEqual(
      jasmine.objectContaining({
        stepNumber: 1,
        instruction: 'Cuece la calabaza hasta que esté tierna.',
        duration: 20
      })
    );
    expect(Object.prototype.hasOwnProperty.call(payload, 'instructionsByLevel')).toBeFalse();
  });

  it('reports invalid required values and does not emit a partial update payload', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    draft.name = '   ';
    draft.servings = '0';
    draft.ingredients[0].quantityText = '';
    draft.instructionsByLevel!.intermediate[0].instruction = '';

    const result = buildRecipeEditPayload(draft);

    expect(result.payload).toBeNull();
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps optional details explicitly clearable and validates image URLs as HTTPS', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    draft.image = '';
    draft.nutritionEnabled = false;
    draft.storageEnabled = false;
    draft.appliancesText = '';
    draft.parallelTasksText = '';
    draft.tipsAndVariationsText = '';
    draft.batchCookingWarningText = '';

    const cleared = buildRecipeEditPayload(draft);
    expect(cleared.errors).toEqual([]);
    expect(cleared.payload).toEqual(
      jasmine.objectContaining({ image: null, nutrition: null, storage: null, guidance: null })
    );

    draft.image = 'http://images.example.test/unsafe.jpg';
    expect(buildRecipeEditPayload(draft).errors).toContain('image_https');
  });

  it('uses one editable calories value for both the recipe summary and nutrition details', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    draft.nutrition.calories = '465';

    const result = buildRecipeEditPayload(draft);

    expect(result.errors).toEqual([]);
    expect(result.payload?.calories).toBe(465);
    expect(result.payload?.nutrition?.calories).toBe(465);
  });

  it('accepts numeric values emitted by number inputs before building the payload', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    draft.servings = 4;
    draft.nutrition.protein = 21;

    const result = buildRecipeEditPayload(draft);

    expect(result.errors).toEqual([]);
    expect(result.payload?.servings).toBe(4);
    expect(result.payload?.nutrition?.protein).toBe(21);
  });

  it('keeps persisted same-origin photo references and attribution when editing other fields', () => {
    const id = 'd'.repeat(24);
    const attributed = {
      ...detailedRecipe,
      image: `/api/recipe-images/${id}`,
      imageAttribution: {
        altText: 'Tortilla española recién hecha',
        author: 'María',
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tortilla.jpg'
      }
    };
    const draft = recipeToEditDraft(attributed);
    const result = buildRecipeEditPayload(draft);

    expect(draft.imageAttribution).toEqual(attributed.imageAttribution);
    expect(result.errors).toEqual([]);
    expect(result.payload?.image).toBe(`/api/recipe-images/${id}`);
  });

  it('sends a selected search result id, not the temporary preview URL, and allows household-sized servings', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    draft.imagePhotoId = 'e'.repeat(24);
    draft.image = '/api/recipe-photo-previews/eeeeeeeeeeeeeeeeeeeeeeee';
    draft.servings = 24;

    const result = buildRecipeEditPayload(draft);

    expect(result.errors).toEqual([]);
    expect(result.payload?.imagePhotoId).toBe('e'.repeat(24));
    expect(Object.prototype.hasOwnProperty.call(result.payload, 'image')).toBeFalse();
    expect(result.payload?.servings).toBe(24);
  });

  it('sends a selected step-photo id instead of its temporary preview URL', () => {
    const draft = recipeToEditDraft(detailedRecipe);
    const step = draft.instructionsByLevel!.basic[0] as unknown as {
      stepNumber: number;
      instruction: string;
      imageUrl: string;
      imagePhotoId: string;
    };
    step.imagePhotoId = 'f'.repeat(24);
    step.imageUrl = `/api/recipe-photo-previews/${step.imagePhotoId}`;

    const result = buildRecipeEditPayload(draft);

    expect(result.errors).toEqual([]);
    expect(result.payload?.instructionsByLevel?.basic[0]).toEqual(
      jasmine.objectContaining({ imagePhotoId: 'f'.repeat(24) })
    );
    expect(
      Object.prototype.hasOwnProperty.call(result.payload?.instructionsByLevel?.basic[0], 'image')
    ).toBeFalse();
  });

  it('preserves a previously stored same-origin step photo when editing other fields', () => {
    const photoId = 'c'.repeat(24);
    const recipeWithStepPhoto = {
      ...detailedRecipe,
      instructionsByLevel: {
        ...detailedRecipe.instructionsByLevel!,
        basic: [
          {
            ...detailedRecipe.instructionsByLevel!.basic[0],
            image: `/api/recipe-images/${photoId}`,
            imageAttribution: {
              altText: 'Patatas cortadas',
              author: 'María',
              licenseName: 'CC BY 4.0',
              licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
              sourceUrl: 'https://commons.wikimedia.org/wiki/File:Patatas.jpg'
            }
          }
        ]
      }
    };
    const draft = recipeToEditDraft(recipeWithStepPhoto);

    const result = buildRecipeEditPayload(draft);

    expect(result.errors).toEqual([]);
    expect(result.payload?.instructionsByLevel?.basic[0].image).toBe(
      `/api/recipe-images/${photoId}`
    );
  });
});
