import { AIRecipeImprovePatch } from '../../shared/models/ai-config.model';
import type { TranslationKey, TranslationParams } from '../../core/i18n';
import { RecipeEditDraft, createRecipeEditDraft, recipeToEditDraft } from './recipe-edit.util';
import {
  classifyRecipeMediaScene,
  applyRecipeImprovement,
  recipeImprovementInput,
  recipeImprovementChanges
} from './recipe-improve.util';
import { Recipe } from '../../shared/models/recipe.model';

const recipe: Recipe = {
  id: 'recipe-improve-test',
  name: 'Sopa de prueba',
  description: 'Descripción original',
  difficulty: 'easy',
  cuisine: 'española',
  mealType: ['dinner'],
  totalTime: 30,
  prepTime: 10,
  cookTime: 20,
  servings: 4,
  calories: 250,
  image: '/api/recipe-images/aaaaaaaaaaaaaaaaaaaaaaaa',
  ingredients: [
    {
      ingredientId: 'private-ingredient-id',
      name: 'Calabaza',
      quantity: 800,
      unit: 'g',
      preparation: 'en dados',
      isOptional: false,
      substitutes: ['zanahoria'],
      notes: 'nota original'
    }
  ],
  utensils: ['Olla'],
  steps: [
    {
      stepNumber: 1,
      instruction: 'Cuece la calabaza.',
      image: '/api/recipe-images/bbbbbbbbbbbbbbbbbbbbbbbb',
      imagePhotoId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      imageAttribution: {
        altText: 'Calabaza cocida',
        author: 'Autora de prueba',
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Squash.jpg'
      },
      videoId: 'c'.repeat(24),
      video: {
        id: 'c'.repeat(24),
        title: 'Preparación de verduras',
        author: 'Autora sintética',
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Prepare.webm',
        thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Prepare.jpg',
        durationSeconds: 9,
        mimeType: 'video/webm'
      }
    }
  ],
  author: 'user',
  authorId: 'private-author-id',
  timesCooked: 0,
  tags: ['casera'],
  isFavorite: false,
  isPublic: false,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z')
};

const reviewTranslator = (key: TranslationKey, params?: TranslationParams): string => {
  const messages: Partial<Record<TranslationKey, string>> = {
    'recipes.improve.step_duration': '{n} min',
    'recipes.improve.step_temperature': '{value} °{unit}',
    'recipes.improve.step_timer': 'Temporizador · {n} min',
    'recipes.improve.step_tip': 'Consejo: {text}',
    'recipes.improve.step_warning': 'Aviso: {text}'
  };
  return (messages[key] ?? key).replace(/\{([^}]+)\}/g, (_, name: string) =>
    String(params?.[name] ?? '')
  );
};

function validStructuredDraft(): RecipeEditDraft {
  const draft = createRecipeEditDraft();
  draft.name = 'Crema de calabaza';
  draft.servings = 4;
  draft.mealType = ['dinner'];
  draft.ingredients[0] = {
    ingredientId: 'private-ingredient-id',
    name: 'Calabaza',
    quantityText: '800',
    unit: 'g',
    preparation: 'en dados',
    isOptional: false,
    substitutesText: 'zanahoria',
    notes: 'nota original'
  };
  for (const level of ['basic', 'intermediate', 'expert'] as const) {
    draft.instructionsByLevel![level][0].instruction = 'Cuece la calabaza.';
  }
  draft.instructionsByLevel!.basic[0].imageUrl = '/api/recipe-images/bbbbbbbbbbbbbbbbbbbbbbbb';
  draft.instructionsByLevel!.basic[0].imagePhotoId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  draft.instructionsByLevel!.basic[0].imageAttribution = {
    altText: 'Calabaza cocida',
    author: 'Autora de prueba',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Squash.jpg'
  };
  draft.instructionsByLevel!.basic[0].videoId = 'c'.repeat(24);
  draft.instructionsByLevel!.basic[0].video = {
    id: 'c'.repeat(24),
    title: 'Preparación de verduras',
    author: 'Autora sintética',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Prepare.webm',
    thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Prepare.jpg',
    durationSeconds: 9,
    mimeType: 'video/webm'
  };
  return draft;
}

describe('recipe-improve.util', () => {
  it('maps preparation text to generic media scenes without returning its text', () => {
    expect(classifyRecipeMediaScene('Lava las patatas y córtalas en láminas.')).toBe('cut');
    expect(classifyRecipeMediaScene('Enjuaga las verduras.')).toBe('wash');
    expect(classifyRecipeMediaScene('Mezcla y bate hasta integrar.')).toBe('mix');
    expect(classifyRecipeMediaScene('Cuece a fuego lento y deja reposar.')).toBe('rest');
    expect(classifyRecipeMediaScene('Hornea durante veinte minutos.')).toBe('bake');
    expect(classifyRecipeMediaScene('Sirve templado.')).toBe('serve');
    expect(classifyRecipeMediaScene('Añade una pizca de sal.')).toBe('prepare');
  });

  it('projects a private-media-free canonical recipe using one-serving quantities', () => {
    const draft = validStructuredDraft();
    const projection = recipeImprovementInput(draft);

    expect(projection).not.toBeNull();
    if (!projection) return;
    expect(projection?.baseServings).toBe(1);
    expect(projection?.servings).toBe(4);
    expect(projection.ingredients?.[0].quantity).toBe(200);
    expect(projection?.instructionsByLevel?.basic[0].instruction).toBe('Cuece la calabaza.');
    expect(JSON.stringify(projection)).not.toContain('private-ingredient-id');
    expect(JSON.stringify(projection)).not.toContain('private-author-id');
    expect(JSON.stringify(projection)).not.toContain('commons.wikimedia.org');
    expect(
      Object.prototype.hasOwnProperty.call(projection?.instructionsByLevel?.basic[0], 'image')
    ).toBeFalse();
    expect(
      Object.prototype.hasOwnProperty.call(
        projection?.instructionsByLevel?.basic[0],
        'imagePhotoId'
      )
    ).toBeFalse();
  });

  it('does not send an incomplete draft to the improvement endpoint', () => {
    const draft = createRecipeEditDraft();
    expect(recipeImprovementInput(draft)).toBeNull();

    draft.name = 'Crema';
    draft.ingredients[0].name = 'Calabaza';
    draft.instructionsByLevel!.basic[0].instruction = 'Cocina';
    expect(recipeImprovementInput(draft)).toBeNull();
  });

  it('projects flat legacy steps and optional guidance, nutrition and storage to the canonical request', () => {
    const draft = validStructuredDraft();
    draft.steps = [draft.instructionsByLevel!.basic[0]];
    draft.instructionsByLevel = undefined;
    draft.utensilsText = 'Olla\nCuchara';
    draft.appliancesText = 'Fogón';
    draft.parallelTasksText = 'Lava la tabla';
    draft.tipsAndVariationsText = 'Añade perejil, al final';
    draft.batchCookingWarningText = 'No llenes la olla';
    draft.nutritionEnabled = true;
    draft.nutrition = {
      calories: '250',
      protein: '8',
      carbs: '22',
      fat: '9',
      fiber: '3',
      sugar: '',
      sodium: ''
    };
    draft.storageEnabled = true;
    draft.storage = {
      method: 'Refrigerar',
      container: 'Tarro',
      duration: '2 días',
      reheatingInstructions: 'Calentar lentamente',
      freezingPossible: true,
      freezingDuration: '1 mes'
    };

    const projection = recipeImprovementInput(draft);

    expect(projection?.steps?.[0].instruction).toBe('Cuece la calabaza.');
    expect(projection?.instructionsByLevel).toBeUndefined();
    expect(projection?.utensils).toEqual(['Olla', 'Cuchara']);
    expect(projection?.guidance).toEqual({
      appliances: ['Fogón'],
      parallelTasks: ['Lava la tabla'],
      tipsAndVariations: ['Añade perejil', 'al final'],
      batchCookingWarning: 'No llenes la olla'
    });
    expect(projection?.nutrition).toEqual({
      calories: 250,
      protein: 8,
      carbs: 22,
      fat: 9,
      fiber: 3
    });
    expect(projection?.storage).toEqual({
      method: 'Refrigerar',
      duration: '2 días',
      reheatingInstructions: 'Calentar lentamente',
      container: 'Tarro',
      freezingPossible: true,
      freezingDuration: '1 mes'
    });
  });

  it('applies only the selected ingredient scope and preserves recipe base servings and media', () => {
    const draft = validStructuredDraft();
    const patch: AIRecipeImprovePatch = {
      name: 'Nombre que no se debe aplicar',
      totalTime: 99,
      ingredients: [
        {
          name: 'Calabaza',
          quantity: 225,
          unit: 'g',
          preparation: 'pelada',
          isOptional: false,
          substitutes: ['boniato'],
          notes: null
        }
      ]
    };

    applyRecipeImprovement(draft, patch, ['ingredients']);

    expect(draft.servings).toBe(4);
    expect(draft.ingredients[0].quantityText).toBe('900');
    expect(draft.ingredients[0].preparation).toBe('pelada');
    expect(draft.ingredients[0].substitutesText).toBe('boniato');
    expect(draft.name).toBe('Crema de calabaza');
    expect(draft.totalTime).toBe('');
    expect(draft.instructionsByLevel!.basic[0].imagePhotoId).toBe('bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(draft.instructionsByLevel!.basic[0].imageAttribution?.author).toBe('Autora de prueba');
  });

  it('applies selected detail scopes and clears optional sections without touching other fields', () => {
    const draft = validStructuredDraft();
    const originalIngredient = structuredClone(draft.ingredients[0]);
    const originalStep = structuredClone(draft.instructionsByLevel!.basic[0]);
    const patch: AIRecipeImprovePatch = {
      description: 'Una versión más cremosa',
      cuisine: 'Mediterránea',
      tags: [],
      totalTime: 50,
      prepTime: 10,
      cookTime: 35,
      restTime: null,
      utensils: ['Sartén'],
      guidance: {
        appliances: [],
        parallelTasks: [],
        tipsAndVariations: [],
        batchCookingWarning: null
      },
      calories: null,
      nutrition: null,
      storage: null
    };

    applyRecipeImprovement(draft, patch, ['details', 'timing', 'guidance', 'nutrition', 'storage']);

    expect(draft.description).toBe('Una versión más cremosa');
    expect(draft.cuisine).toBe('Mediterránea');
    expect(draft.tagsText).toBe('');
    expect(draft.totalTime).toBe(50);
    expect(draft.prepTime).toBe(10);
    expect(draft.cookTime).toBe(35);
    expect(draft.restTime).toBe('');
    expect(draft.utensilsText).toBe('Sartén');
    expect(draft.appliancesText).toBe('');
    expect(draft.parallelTasksText).toBe('');
    expect(draft.tipsAndVariationsText).toBe('');
    expect(draft.batchCookingWarningText).toBe('');
    expect(draft.nutritionEnabled).toBeFalse();
    expect(draft.storageEnabled).toBeFalse();
    expect(draft.ingredients[0]).toEqual(originalIngredient);
    expect(draft.instructionsByLevel!.basic[0]).toEqual(originalStep);
  });

  it('keeps legacy steps unless preparation is explicitly selected, then preserves attached media', () => {
    const legacy = recipeToEditDraft(recipe);
    const detailsPatch: AIRecipeImprovePatch = { name: 'Sopa mejorada' };
    applyRecipeImprovement(legacy, detailsPatch, ['details']);
    expect(legacy.steps?.length).toBe(1);
    expect(legacy.instructionsByLevel).toBeUndefined();

    const preparationPatch: AIRecipeImprovePatch = {
      instructionsByLevel: {
        basic: [
          {
            stepNumber: 1,
            instruction: 'Cuece la calabaza con agua.',
            duration: 15,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ],
        intermediate: [
          {
            stepNumber: 1,
            instruction: 'Cuece la calabaza hasta que se ablande.',
            duration: 15,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ],
        expert: [
          {
            stepNumber: 1,
            instruction: 'Cuece a fuego medio hasta que esté tierna.',
            duration: 15,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ]
      }
    };
    applyRecipeImprovement(legacy, preparationPatch, ['preparation']);

    expect(legacy.steps).toBeUndefined();
    expect(legacy.instructionsByLevel?.basic[0].instruction).toBe('Cuece la calabaza con agua.');
    expect(legacy.instructionsByLevel?.basic[0].imageUrl).toBe(
      '/api/recipe-images/bbbbbbbbbbbbbbbbbbbbbbbb'
    );
    expect(legacy.instructionsByLevel?.basic[0].imageAttribution?.licenseName).toBe('CC BY 4.0');
    expect(legacy.instructionsByLevel?.basic[0].videoId).toBe('c'.repeat(24));
    expect(legacy.instructionsByLevel?.basic[0].video?.licenseName).toBe('CC BY 4.0');
  });

  it('shows step tips, warnings, time, temperature and timer in the AI review', () => {
    const draft = validStructuredDraft();
    const patch: AIRecipeImprovePatch = {
      instructionsByLevel: {
        basic: [
          {
            stepNumber: 1,
            instruction: 'Dora la calabaza.',
            duration: 12,
            temperature: { value: 180, unit: 'C' },
            timerRequired: true,
            timerDuration: 8,
            tips: 'No llenes la olla.',
            warning: 'El aceite salpica.',
            illustration: null
          }
        ],
        intermediate: [],
        expert: []
      }
    };

    const change = recipeImprovementChanges(draft, patch, ['preparation'], reviewTranslator).find(
      (item) => item.label === 'recipes.improve.field.basic'
    );

    expect(change?.before).toContain('Cuece la calabaza.');
    expect(change?.after).toContain('Dora la calabaza.');
    expect(change?.after).toContain('12 min');
    expect(change?.after).toContain('180 °C');
    expect(change?.after).toContain('8 min');
    expect(change?.after).toContain('No llenes la olla.');
    expect(change?.after).toContain('El aceite salpica.');
  });

  it('previews changed fields from every explicitly selected improvement scope', () => {
    const draft = validStructuredDraft();
    draft.nutritionEnabled = true;
    draft.nutrition = {
      calories: '200',
      protein: '5',
      carbs: '20',
      fat: '8',
      fiber: '2',
      sugar: '3',
      sodium: '100'
    };
    draft.storageEnabled = true;
    draft.storage = {
      method: 'Refrigerar',
      container: 'Recipiente hermético',
      duration: '2 días',
      reheatingInstructions: 'Calentar a fuego lento',
      freezingPossible: true,
      freezingDuration: '1 mes'
    };
    const patch: AIRecipeImprovePatch = {
      name: 'Sopa mejorada',
      description: 'Más cremosa',
      difficulty: 'medium',
      cuisine: 'Mediterránea',
      tags: ['invierno'],
      ingredients: [
        {
          name: 'Calabaza',
          quantity: 210,
          unit: 'g',
          preparation: 'asada',
          isOptional: true,
          substitutes: ['boniato'],
          notes: 'en dados grandes'
        }
      ],
      totalTime: 40,
      prepTime: 12,
      cookTime: 20,
      restTime: 8,
      utensils: ['Cuchillo'],
      guidance: {
        appliances: ['Horno'],
        parallelTasks: ['Precalienta mientras cortas.'],
        tipsAndVariations: ['Añade pimienta al final.'],
        batchCookingWarning: 'No llenes la bandeja.'
      },
      calories: 260,
      nutrition: { calories: 260, protein: 7, carbs: 24, fat: 10, fiber: 4 },
      storage: {
        method: 'Refrigerar',
        container: 'Tarro de cristal',
        duration: '3 días',
        reheatingInstructions: 'Remover al calentar',
        freezingPossible: false,
        freezingDuration: null
      }
    };

    const changes = recipeImprovementChanges(
      draft,
      patch,
      ['details', 'ingredients', 'timing', 'guidance', 'nutrition', 'storage'],
      reviewTranslator
    );
    const afterValues = changes.map((change) => change.after).join('\n');

    expect(changes.length).toBeGreaterThan(10);
    expect(afterValues).toContain('Sopa mejorada');
    expect(afterValues).toContain('840 g · Calabaza');
    expect(afterValues).toContain('40');
    expect(afterValues).toContain('Cuchillo');
    expect(afterValues).toContain('Horno');
    expect(afterValues).toContain('Añade pimienta al final.');
    expect(afterValues).toContain('260');
    expect(afterValues).toContain('Tarro de cristal');
    expect(afterValues).toContain('3 días');
    expect(afterValues).toContain('Remover al calentar');
  });
});
