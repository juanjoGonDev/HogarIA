import { z } from 'zod';

export const MAX_HOUSEHOLD_MEAL_SHOPPING_PREVIEW_DAYS = 31;

export const householdMealShoppingPreviewQuerySchema = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date()
  })
  .strict()
  .superRefine(({ startDate, endDate }, context) => {
    if (startDate > endDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'endDate no puede ser anterior a startDate'
      });
      return;
    }

    const start = Date.parse(`${startDate}T00:00:00.000Z`);
    const end = Date.parse(`${endDate}T00:00:00.000Z`);
    const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
    if (inclusiveDays > MAX_HOUSEHOLD_MEAL_SHOPPING_PREVIEW_DAYS) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: `El rango no puede superar ${MAX_HOUSEHOLD_MEAL_SHOPPING_PREVIEW_DAYS} días`
      });
    }
  });

export type HouseholdMealShoppingPreviewQuery = z.infer<
  typeof householdMealShoppingPreviewQuerySchema
>;
