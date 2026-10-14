import { describe, expect, it } from 'vitest';
import {
  adjustServingsSchema,
  createRecipeSchema,
  recipeFilterSchema,
  updateRecipeSchema
} from './recipe.schema.js';

const baseRecipe = {
  name: 'Crema de zanahoria',
  ingredients: [{ name: 'Zanahoria', quantity: 2, unit: 'unit' }]
};

const recipeSteps = [{ stepNumber: 1, instruction: 'Cocer la zanahoria.' }];
const instructionsByLevel = {
  basic: recipeSteps,
  intermediate: [{ stepNumber: 1, instruction: 'Cortar y cocer hasta que esté tierna.' }],
  expert: [{ stepNumber: 1, instruction: 'Cortar en dados uniformes y cocer a hervor suave.' }]
};

describe('createRecipeSchema instrucciones', () => {
  it('mantiene válidas las recetas antiguas con una sola lista de pasos', () => {
    expect(createRecipeSchema.safeParse({ ...baseRecipe, steps: recipeSteps }).success).toBe(true);
  });

  it('acepta las tres variantes con campos comunes guardados una sola vez', () => {
    expect(createRecipeSchema.safeParse({ ...baseRecipe, instructionsByLevel }).success).toBe(true);
  });

  it('exige exactamente una representación y rechaza variantes incompletas o vacías', () => {
    expect(createRecipeSchema.safeParse(baseRecipe).success).toBe(false);
    expect(
      createRecipeSchema.safeParse({ ...baseRecipe, steps: recipeSteps, instructionsByLevel })
        .success
    ).toBe(false);
    expect(
      createRecipeSchema.safeParse({
        ...baseRecipe,
        instructionsByLevel: { basic: recipeSteps, intermediate: recipeSteps }
      }).success
    ).toBe(false);
    expect(
      createRecipeSchema.safeParse({
        ...baseRecipe,
        instructionsByLevel: { ...instructionsByLevel, expert: [] }
      }).success
    ).toBe(false);
  });
});

describe('updateRecipeSchema para el editor dedicado', () => {
  it('admite actualizar parcialmente los campos editables y cualquiera de las dos formas de pasos', () => {
    expect(updateRecipeSchema.safeParse({ description: 'Descripción nueva' }).success).toBe(true);
    expect(updateRecipeSchema.safeParse({ steps: recipeSteps }).success).toBe(true);
    expect(updateRecipeSchema.safeParse({ instructionsByLevel }).success).toBe(true);
  });

  it('rechaza pasos duplicados, borrar ingredientes/pasos obligatorios y portadas sin HTTPS', () => {
    expect(updateRecipeSchema.safeParse({ steps: recipeSteps, instructionsByLevel }).success).toBe(
      false
    );
    expect(updateRecipeSchema.safeParse({ ingredients: null }).success).toBe(false);
    expect(updateRecipeSchema.safeParse({ steps: null }).success).toBe(false);
    expect(updateRecipeSchema.safeParse({ instructionsByLevel: null }).success).toBe(false);
    expect(updateRecipeSchema.safeParse({ image: 'http://images.test/cover.jpg' }).success).toBe(
      false
    );
  });

  it('admite URL HTTPS manual y referencias locales o selección Commons validada', () => {
    const photoId = 'a'.repeat(24);
    const manualUrl = 'https://images.test/manual.jpg';
    expect(updateRecipeSchema.safeParse({ image: `/api/recipe-images/${photoId}` }).success).toBe(
      true
    );
    expect(updateRecipeSchema.safeParse({ imagePhotoId: photoId }).success).toBe(true);
    expect(updateRecipeSchema.safeParse({ image: manualUrl }).success).toBe(true);
    expect(
      updateRecipeSchema.safeParse({
        steps: [{ stepNumber: 1, instruction: 'Cocer.', image: manualUrl }]
      }).success
    ).toBe(true);
    expect(
      updateRecipeSchema.safeParse({ image: 'https://user:password@images.test/photo.jpg' }).success
    ).toBe(false);
    expect(updateRecipeSchema.safeParse({ imagePhotoId: 'not-a-photo-id' }).success).toBe(false);
    expect(updateRecipeSchema.safeParse({ imagePhotoId: photoId, image: manualUrl }).success).toBe(
      false
    );
  });
});

describe('createRecipeSchema guía completa', () => {
  it('devuelve dos raciones por defecto y conserva orientación estructurada', () => {
    const guidance = {
      appliances: ['Cocina de gas'],
      parallelTasks: ['Lavar y cortar mientras hierve el agua.'],
      tipsAndVariations: ['Terminar con perejil fresco.']
    };
    const result = createRecipeSchema.safeParse({
      ...baseRecipe,
      steps: recipeSteps,
      guidance
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.servings).toBe(2);
      expect(result.data.guidance).toEqual(guidance);
    }
  });

  it('permite el tamaño real de un hogar sin truncar raciones por el antiguo límite de veinte', () => {
    expect(
      createRecipeSchema.safeParse({ ...baseRecipe, servings: 25, steps: recipeSteps }).success
    ).toBe(true);
    expect(adjustServingsSchema.safeParse({ servings: 25 }).success).toBe(true);
    expect(adjustServingsSchema.safeParse({ servings: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(
      false
    );
  });

  it('valida una selección temporal de foto para un paso y no admite dos fuentes a la vez', () => {
    const imagePhotoId = 'b'.repeat(24);
    const step = { stepNumber: 1, instruction: 'Corta la cebolla.' };
    const selected = updateRecipeSchema.safeParse({
      instructionsByLevel: {
        basic: [{ ...step, imagePhotoId }],
        intermediate: [step],
        expert: [step]
      }
    });

    expect(selected.success).toBe(true);
    expect(
      updateRecipeSchema.safeParse({
        instructionsByLevel: {
          basic: [{ ...step, imagePhotoId, image: 'https://images.test/onion.jpg' }],
          intermediate: [step],
          expert: [step]
        }
      }).success
    ).toBe(false);
    expect(
      updateRecipeSchema.safeParse({
        instructionsByLevel: {
          basic: [{ ...step, image: `/api/recipe-images/${imagePhotoId}` }],
          intermediate: [step],
          expert: [step]
        }
      }).success
    ).toBe(true);
  });

  it('persists only a selected Commons video id, not client-provided video URLs or attribution', () => {
    const videoId = 'c'.repeat(24);
    const result = createRecipeSchema.safeParse({
      ...baseRecipe,
      steps: [
        {
          stepNumber: 1,
          instruction: 'Cortar la verdura.',
          videoId,
          videoAttribution: { author: 'No confiable' },
          videoUrl: 'https://attacker.test/video.mp4'
        }
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps?.[0]).toMatchObject({ videoId });
      expect(result.data.steps?.[0]).not.toHaveProperty('videoAttribution');
      expect(result.data.steps?.[0]).not.toHaveProperty('videoUrl');
    }
    expect(
      createRecipeSchema.safeParse({
        ...baseRecipe,
        steps: [{ stepNumber: 1, instruction: 'Cortar.', videoId: 'https://attacker.test/v.mp4' }]
      }).success
    ).toBe(false);
  });
});

describe('país de origen y filtros del libro', () => {
  it('admite país ISO-3166 alpha-2 sin inferirlo de cuisine', () => {
    const result = createRecipeSchema.safeParse({
      ...baseRecipe,
      cuisine: 'regional',
      countryCode: 'sv',
      steps: recipeSteps
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countryCode).toBe('SV');
  });

  it('rechaza códigos de país que no son alpha-2 y permite recetas sin país conocido', () => {
    expect(
      createRecipeSchema.safeParse({ ...baseRecipe, countryCode: 'ESP', steps: recipeSteps })
        .success
    ).toBe(false);
    expect(createRecipeSchema.safeParse({ ...baseRecipe, steps: recipeSteps }).success).toBe(true);
  });

  it('permite tiempo de cocción cero para recetas que no requieren calor', () => {
    expect(
      createRecipeSchema.safeParse({
        ...baseRecipe,
        cookTime: 0,
        steps: recipeSteps
      }).success
    ).toBe(true);
  });

  it('permite combinar tipos de comida y país, y valida cada tipo', () => {
    expect(
      recipeFilterSchema.safeParse({ countryCode: 'es', mealTypes: ['breakfast', 'dinner'] })
        .success
    ).toBe(true);
    expect(
      recipeFilterSchema.safeParse({ countryCode: 'E', mealTypes: ['breakfast', 'brunch'] }).success
    ).toBe(false);
    expect(recipeFilterSchema.safeParse({ mealTypes: ['second-breakfast'] }).success).toBe(false);
  });
});
