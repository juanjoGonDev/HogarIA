import { z } from 'zod';
import { mealReplacementResponseSchema } from './ai.schema.js';
import { generatedRecipeCandidateSchema } from './generated-recipe.schema.js';
import { photoLinesSchema } from './shopping.schema.js';
import { ticketAnswerSchema } from './receipts.schema.js';
import { shelfAnswerSchema } from '../utils/caducidades.js';
import type { MealTypeKey } from '../utils/taste-profile.js';
import { createAiResponseFormat } from './ai-response-format.js';

const recommendationItemSchema = z
  .object({
    name: z.string(),
    reason: z.string(),
    ingredients: z.array(z.string()),
    estimatedTime: z.number()
  })
  .strict();

export function recommendationsResponseSchema(count: number) {
  return z
    .object({
      recommendations: z.array(recommendationItemSchema).length(count)
    })
    .strict();
}

const weeklyMealSchema = z
  .object({
    name: z.string(),
    ingredients: z.array(z.string()),
    time: z.number()
  })
  .strict();

/** El plan es dinámico: solo se exigen las comidas permitidas en esta petición. */
export function weeklyPlanResponseSchema(mealTypes: readonly MealTypeKey[]) {
  const meals = Object.fromEntries(mealTypes.map((type) => [type, weeklyMealSchema]));
  return z
    .object({
      days: z.array(
        z
          .object({
            date: z.string(),
            meals: z.object(meals).strict(),
            totalCalories: z.number()
          })
          .strict()
      ),
      shoppingList: z.array(z.string())
    })
    .strict();
}

export const RECIPE_RESPONSE_FORMAT = createAiResponseFormat(
  'generated_recipe',
  generatedRecipeCandidateSchema
);
export const MEAL_REPLACEMENT_RESPONSE_FORMAT = createAiResponseFormat(
  'meal_replacement',
  mealReplacementResponseSchema
);
export const RECEIPT_RESPONSE_FORMAT = createAiResponseFormat('receipt', ticketAnswerSchema);
export const SHOPPING_PHOTO_RESPONSE_FORMAT = createAiResponseFormat(
  'shopping_photo',
  photoLinesSchema
);
export const EXPIRY_ESTIMATE_RESPONSE_FORMAT = createAiResponseFormat(
  'expiry_estimate',
  shelfAnswerSchema
);

export function createRecommendationsResponseFormat(count: number) {
  return createAiResponseFormat('recommendations', recommendationsResponseSchema(count));
}

export function createWeeklyPlanResponseFormat(mealTypes: readonly MealTypeKey[]) {
  return createAiResponseFormat('weekly_plan', weeklyPlanResponseSchema(mealTypes));
}
