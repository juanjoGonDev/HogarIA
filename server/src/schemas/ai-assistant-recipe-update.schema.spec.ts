import { describe, expect, it } from 'vitest';
import {
  assistantActionPlanCandidateSchema,
  normalizeAssistantActionPlan
} from './ai-assistant.schema.js';

const recipeUpdateAction = {
  kind: 'recipes.update_content',
  title: 'Ajustar receta',
  summary: 'Cambia la cantidad de cebolla y aclara el paso 2.',
  payload: {
    targetName: 'Lentejas de la abuela',
    changes: {
      servings: null,
      ingredients: [
        {
          operation: 'update',
          targetName: 'Cebolla',
          changes: { quantity: 75 }
        }
      ],
      instructions: [
        { level: 'basic', stepNumber: 2, instruction: 'Añade las lentejas y cuece 20 minutos.' }
      ]
    }
  },
  dependsOn: [],
  warnings: []
};

function candidate(action: unknown = recipeUpdateAction) {
  return {
    summary: 'Actualiza la receta.',
    actions: [action],
    questions: []
  };
}

describe('assistant recipe content update schema', () => {
  it('accepts a bounded ingredient and instruction patch with an exact recipe target', () => {
    expect(assistantActionPlanCandidateSchema.safeParse(candidate()).success).toBe(true);
  });

  it('accepts serving changes only when ingredient operations are absent', () => {
    const action = {
      ...recipeUpdateAction,
      payload: {
        targetName: 'Lentejas de la abuela',
        changes: { servings: 4, ingredients: [], instructions: [] }
      }
    };

    expect(assistantActionPlanCandidateSchema.safeParse(candidate(action)).success).toBe(true);
    expect(
      assistantActionPlanCandidateSchema.safeParse(
        candidate({
          ...action,
          payload: {
            ...action.payload,
            changes: {
              ...action.payload.changes,
              ingredients: recipeUpdateAction.payload.changes.ingredients
            }
          }
        })
      ).success
    ).toBe(false);
  });

  it('rejects model-owned IDs, unsupported fields, invalid quantities and empty patches', () => {
    const invalidActions: unknown[] = [
      {
        ...recipeUpdateAction,
        payload: { ...recipeUpdateAction.payload, recipeId: 'model-id' }
      },
      {
        ...recipeUpdateAction,
        payload: {
          ...recipeUpdateAction.payload,
          changes: {
            ...recipeUpdateAction.payload.changes,
            ingredients: [
              {
                operation: 'add',
                ingredient: { name: 'Sal', quantity: 1, unit: 'pinch' }
              }
            ],
            instructions: []
          }
        }
      },
      {
        ...recipeUpdateAction,
        payload: {
          ...recipeUpdateAction.payload,
          changes: {
            servings: null,
            ingredients: [{ operation: 'update', targetName: 'Cebolla', changes: {} }],
            instructions: []
          }
        }
      },
      {
        ...recipeUpdateAction,
        payload: {
          targetName: 'Lentejas de la abuela',
          changes: { servings: null, ingredients: [], instructions: [] }
        }
      }
    ];

    for (const action of invalidActions) {
      expect(assistantActionPlanCandidateSchema.safeParse(candidate(action)).success).toBe(false);
    }
  });

  it('requires and carries a server-resolved recipe target during normalization', () => {
    const parsed = assistantActionPlanCandidateSchema.safeParse(candidate());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(() => normalizeAssistantActionPlan(parsed.data)).toThrow(
      'Missing server-resolved recipe update target'
    );

    const plan = normalizeAssistantActionPlan(
      parsed.data,
      () => 'generated-id',
      new Map([
        [
          0,
          {
            kind: 'recipe' as const,
            id: 'recipe-1',
            snapshot: {
              name: 'Lentejas de la abuela',
              servings: 2,
              ingredients: [{ name: 'Cebolla', quantity: 100, unit: 'g' }],
              steps: [{ stepNumber: 1, instruction: 'Sofríe la cebolla.' }]
            }
          }
        ]
      ])
    );

    expect(plan.actions[0]).toMatchObject({
      kind: 'recipes.update_content',
      domain: 'recipes',
      actionType: 'update_content',
      selected: false,
      executionTarget: { kind: 'recipe', id: 'recipe-1' }
    });
  });
});
