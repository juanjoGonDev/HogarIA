import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

const recipeUnitSchema = z.enum([
  'g',
  'kg',
  'ml',
  'l',
  'cup',
  'tbsp',
  'tsp',
  'unit',
  'bunch',
  'slice',
  'piece'
]);

const recipeNameSchema = z.string().trim().min(1).max(200);

const recipeIngredientAddSchema = z
  .object({
    operation: z.literal('add'),
    ingredient: z
      .object({
        name: z.string().trim().min(1).max(160),
        quantity: z.number().finite().positive().max(100000),
        unit: recipeUnitSchema,
        preparation: z.string().trim().max(500).nullable(),
        isOptional: z.boolean(),
        substitutes: z.array(z.string().trim().min(1).max(160)).max(12),
        notes: z.string().trim().max(500).nullable()
      })
      .strict()
  })
  .strict();

const recipeIngredientUpdateSchema = z
  .object({
    operation: z.literal('update'),
    targetName: recipeNameSchema,
    changes: z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        quantity: z.number().finite().positive().max(100000).optional(),
        unit: recipeUnitSchema.optional(),
        preparation: z.string().trim().max(500).nullable().optional(),
        isOptional: z.boolean().optional(),
        substitutes: z.array(z.string().trim().min(1).max(160)).max(12).optional(),
        notes: z.string().trim().max(500).nullable().optional()
      })
      .strict()
      .superRefine((changes, context) => {
        if (Object.keys(changes).length === 0) {
          context.addIssue({ code: 'custom', message: 'An ingredient update cannot be empty' });
        }
      })
  })
  .strict();

const recipeIngredientRemoveSchema = z
  .object({ operation: z.literal('remove'), targetName: recipeNameSchema })
  .strict();

const recipeIngredientChangeSchema = z.union([
  recipeIngredientAddSchema,
  recipeIngredientUpdateSchema,
  recipeIngredientRemoveSchema
]);

const recipeInstructionChangeSchema = z
  .object({
    level: z.enum(['legacy', 'basic', 'intermediate', 'expert']),
    stepNumber: z.number().int().positive().max(100),
    instruction: z.string().trim().min(1).max(4000)
  })
  .strict();

export const assistantRecipeContentChangesSchema = z
  .object({
    servings: z.number().int().positive().max(100).nullable(),
    ingredients: z.array(recipeIngredientChangeSchema).max(30),
    instructions: z.array(recipeInstructionChangeSchema).max(60)
  })
  .strict()
  .superRefine((changes, context) => {
    if (
      changes.servings === null &&
      changes.ingredients.length === 0 &&
      changes.instructions.length === 0
    ) {
      context.addIssue({ code: 'custom', message: 'A recipe content patch cannot be empty' });
    }
    if (changes.servings !== null && changes.ingredients.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['ingredients'],
        message: 'Serving changes scale ingredients and cannot include manual ingredient changes'
      });
    }

    const ingredientTargets = changes.ingredients.map((change) =>
      comparableRecipeName(change.operation === 'add' ? change.ingredient.name : change.targetName)
    );
    if (new Set(ingredientTargets).size !== ingredientTargets.length) {
      context.addIssue({
        code: 'custom',
        path: ['ingredients'],
        message: 'An ingredient can only be changed once per recipe action'
      });
    }

    const instructionTargets = changes.instructions.map(
      ({ level, stepNumber }) => `${level}:${stepNumber}`
    );
    if (new Set(instructionTargets).size !== instructionTargets.length) {
      context.addIssue({
        code: 'custom',
        path: ['instructions'],
        message: 'An instruction step can only be changed once per recipe action'
      });
    }
  });

export const assistantRecipeContentUpdatePayloadSchema = z
  .object({
    targetName: recipeNameSchema,
    changes: assistantRecipeContentChangesSchema
  })
  .strict();

const storedIngredientSchema = z
  .object({
    ingredientId: z.string().nullable().optional(),
    name: z.string().trim().min(1),
    quantity: z.number().finite().positive(),
    unit: recipeUnitSchema,
    preparation: z.string().nullable().optional(),
    isOptional: z.boolean().optional(),
    substitutes: z.array(z.string()).optional(),
    notes: z.string().nullable().optional()
  })
  .passthrough();

const storedStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    instruction: z.string().min(1)
  })
  .passthrough();

const storedInstructionLevelsSchema = z
  .object({
    basic: z.array(storedStepSchema).min(1),
    intermediate: z.array(storedStepSchema).min(1),
    expert: z.array(storedStepSchema).min(1)
  })
  .strict();

export const assistantRecipeContentSnapshotSchema = z
  .object({
    name: z.string().trim().min(1),
    servings: z.number().int().positive().max(100),
    ingredients: z.array(storedIngredientSchema).min(1).max(100),
    steps: z.union([z.array(storedStepSchema).min(1), storedInstructionLevelsSchema])
  })
  .strict();

export const assistantRecipeContentUpdateRequestSchema = z
  .object({
    changes: assistantRecipeContentChangesSchema,
    assistantAction: z
      .object({
        operation: z.literal('update_recipe_content'),
        targetId: z.string().trim().min(1).max(128),
        before: assistantRecipeContentSnapshotSchema
      })
      .strict()
  })
  .strict();

export type AssistantRecipeContentChanges = z.infer<typeof assistantRecipeContentChangesSchema>;
export type AssistantRecipeContentSnapshot = z.infer<typeof assistantRecipeContentSnapshotSchema>;

export interface AssistantRecipeUpdateExecutionTarget {
  kind: 'recipe';
  id: string;
  snapshot: AssistantRecipeContentSnapshot;
}

export function comparableRecipeName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function applyAssistantRecipeContentChanges(
  snapshotInput: unknown,
  changesInput: unknown
): AssistantRecipeContentSnapshot {
  const snapshot = assistantRecipeContentSnapshotSchema.parse(snapshotInput);
  const changes = assistantRecipeContentChangesSchema.parse(changesInput);
  const next = JSON.parse(JSON.stringify(snapshot)) as AssistantRecipeContentSnapshot;

  if (changes.servings !== null) {
    const scale = changes.servings / snapshot.servings;
    next.ingredients = snapshot.ingredients.map((ingredient) => {
      const quantity = Number((ingredient.quantity * scale).toFixed(3));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('ASSISTANT_RECIPE_SCALED_QUANTITY_INVALID');
      }
      return { ...ingredient, quantity };
    });
    next.servings = changes.servings;
  } else {
    for (const change of changes.ingredients) {
      if (change.operation === 'add') {
        const name = comparableRecipeName(change.ingredient.name);
        if (next.ingredients.some((ingredient) => comparableRecipeName(ingredient.name) === name)) {
          throw new Error('ASSISTANT_RECIPE_INGREDIENT_ALREADY_EXISTS');
        }
        if (next.ingredients.length >= 100) throw new Error('ASSISTANT_RECIPE_INGREDIENT_LIMIT');
        next.ingredients.push({ ingredientId: null, ...change.ingredient });
        continue;
      }

      const targetName = comparableRecipeName(change.targetName);
      const matches = next.ingredients
        .map((ingredient, index) => ({ ingredient, index }))
        .filter(({ ingredient }) => comparableRecipeName(ingredient.name) === targetName);
      if (matches.length !== 1) {
        throw new Error(
          matches.length === 0
            ? 'ASSISTANT_RECIPE_INGREDIENT_NOT_FOUND'
            : 'ASSISTANT_RECIPE_INGREDIENT_AMBIGUOUS'
        );
      }

      const [{ index }] = matches;
      if (change.operation === 'remove') {
        if (next.ingredients.length <= 1) throw new Error('ASSISTANT_RECIPE_LAST_INGREDIENT');
        next.ingredients.splice(index, 1);
        continue;
      }

      const updated = { ...next.ingredients[index], ...change.changes };
      if (
        next.ingredients.some(
          (ingredient, otherIndex) =>
            otherIndex !== index &&
            comparableRecipeName(ingredient.name) === comparableRecipeName(updated.name)
        )
      ) {
        throw new Error('ASSISTANT_RECIPE_INGREDIENT_ALREADY_EXISTS');
      }
      next.ingredients[index] = updated;
    }
  }

  for (const change of changes.instructions) {
    const steps = Array.isArray(next.steps)
      ? change.level === 'legacy'
        ? next.steps
        : undefined
      : change.level === 'legacy'
        ? undefined
        : next.steps[change.level];
    if (!steps) throw new Error('ASSISTANT_RECIPE_INSTRUCTION_LEVEL_NOT_FOUND');
    const matches = steps.filter((step) => step.stepNumber === change.stepNumber);
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? 'ASSISTANT_RECIPE_INSTRUCTION_STEP_NOT_FOUND'
          : 'ASSISTANT_RECIPE_INSTRUCTION_STEP_AMBIGUOUS'
      );
    }
    matches[0]!.instruction = change.instruction;
  }

  if (isDeepStrictEqual(snapshot, next)) throw new Error('ASSISTANT_RECIPE_NO_CHANGE');
  return next;
}
