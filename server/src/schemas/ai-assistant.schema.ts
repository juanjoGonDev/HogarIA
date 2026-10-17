import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aiRecipeOutputSchema } from './recipe-ai-output.schema.js';
import { createAiResponseFormat } from './ai-response-format.js';
import {
  householdTaskPrioritySchema,
  type HouseholdTaskOccurrence
} from './household-task.schema.js';
import {
  assistantRecipeContentUpdatePayloadSchema,
  type AssistantRecipeUpdateExecutionTarget
} from './ai-assistant-recipe-update.schema.js';

export type { AssistantRecipeUpdateExecutionTarget } from './ai-assistant-recipe-update.schema.js';

const routeHintSchema = z.enum([
  'dashboard',
  'pantry',
  'shopping',
  'calendar',
  'recipes',
  'household'
]);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, 'Expected a real ISO date');
const optionalDateReferenceSchema = z
  .preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    dateSchema.nullish()
  )
  .transform((value) => value ?? undefined);
const pantryUnitSchema = z.enum([
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
const pantryLocationSchema = z.enum(['fridge', 'freezer', 'pantry', 'counter']);
const calendarEventKindSchema = z.enum(['appointment', 'home', 'shopping', 'personal', 'other']);
const calendarEventTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .nullable();

const actionMetaSchema = {
  title: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(300),
  dependsOn: z.array(z.number().int().min(0).max(7)).max(8),
  warnings: z.array(z.string().trim().min(1).max(300)).max(4)
};

const assistantActionCandidateSchema = z.union([
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('pantry.add_ingredient'),
      payload: z
        .object({
          name: z.string().trim().min(1).max(120),
          quantity: z.number().finite().positive().max(100000),
          unit: pantryUnitSchema,
          category: z.string().trim().min(1).max(64),
          expirationDate: dateSchema.nullable(),
          location: pantryLocationSchema,
          notes: z.string().trim().max(500).nullable()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('pantry.update_ingredient'),
      payload: z
        .object({
          targetName: z.string().trim().min(1).max(3000),
          changes: z
            .object({
              name: z.string().trim().min(1).max(3000).nullable(),
              setName: z.boolean(),
              category: z.string().trim().min(1).max(64).nullable(),
              setCategory: z.boolean(),
              quantity: z.number().finite().min(0).max(100000).nullable(),
              setQuantity: z.boolean(),
              unit: pantryUnitSchema.nullable(),
              setUnit: z.boolean(),
              expirationDate: dateSchema.nullable(),
              setExpirationDate: z.boolean(),
              location: pantryLocationSchema.nullable(),
              setLocation: z.boolean(),
              notes: z.string().trim().max(500).nullable(),
              setNotes: z.boolean()
            })
            .strict()
            .superRefine((changes, context) => {
              const fields = [
                ['name', changes.name, changes.setName, false],
                ['category', changes.category, changes.setCategory, false],
                ['quantity', changes.quantity, changes.setQuantity, false],
                ['unit', changes.unit, changes.setUnit, false],
                ['expirationDate', changes.expirationDate, changes.setExpirationDate, true],
                ['location', changes.location, changes.setLocation, false],
                ['notes', changes.notes, changes.setNotes, true]
              ] as const;
              if (!fields.some(([, , selected]) => selected)) {
                context.addIssue({
                  code: 'custom',
                  message: 'At least one pantry ingredient field must change'
                });
              }
              fields.forEach(([key, value, selected, nullableWhenSelected]) => {
                if (
                  (!selected && value !== null) ||
                  (selected && !nullableWhenSelected && value === null)
                ) {
                  context.addIssue({
                    code: 'custom',
                    path: [key],
                    message: selected
                      ? 'A selected pantry field must have a value'
                      : 'An unchanged pantry field must be null'
                  });
                }
              });
            })
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('shopping.create_list'),
      payload: z
        .object({
          name: z.string().trim().min(1).max(80),
          store: z.string().trim().max(80).nullable()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('shopping.update_list'),
      payload: z
        .object({
          targetName: z.string().trim().min(1).max(80),
          changes: z
            .object({
              name: z.string().trim().min(1).max(80).nullable(),
              setName: z.boolean(),
              store: z.string().trim().min(1).max(80).nullable(),
              setStore: z.boolean()
            })
            .strict()
            .superRefine((changes, context) => {
              if (!changes.setName && !changes.setStore) {
                context.addIssue({
                  code: 'custom',
                  message: 'At least one shopping list field must change'
                });
              }
              if (changes.setName !== (changes.name !== null)) {
                context.addIssue({
                  code: 'custom',
                  path: ['name'],
                  message: 'A changed list name must be present'
                });
              }
              if (!changes.setStore && changes.store !== null) {
                context.addIssue({
                  code: 'custom',
                  path: ['store'],
                  message: 'Unchanged store value must be null'
                });
              }
            })
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('shopping.update_item'),
      payload: z
        .object({
          listName: z.string().trim().min(1).max(80),
          targetName: z.string().trim().min(1).max(200),
          matchUnit: z.boolean(),
          targetUnit: z.string().trim().min(1).max(48).nullable(),
          changes: z
            .object({
              name: z.string().trim().min(1).max(200).nullable(),
              setName: z.boolean(),
              quantity: z.number().finite().positive().max(100000).nullable(),
              setQuantity: z.boolean(),
              unit: z.string().trim().min(1).max(48).nullable(),
              setUnit: z.boolean(),
              category: z.string().trim().min(1).max(48).nullable(),
              setCategory: z.boolean()
            })
            .strict()
            .superRefine((changes, context) => {
              if (
                !changes.setName &&
                !changes.setQuantity &&
                !changes.setUnit &&
                !changes.setCategory
              ) {
                context.addIssue({
                  code: 'custom',
                  message: 'At least one shopping item field must change'
                });
              }
              const fields = [
                ['name', changes.name, changes.setName, false],
                ['quantity', changes.quantity, changes.setQuantity, false],
                ['unit', changes.unit, changes.setUnit, true],
                ['category', changes.category, changes.setCategory, true]
              ] as const;
              fields.forEach(([key, value, selected, nullableWhenSelected]) => {
                if (
                  (!selected && value !== null) ||
                  (selected && !nullableWhenSelected && value === null)
                ) {
                  context.addIssue({
                    code: 'custom',
                    path: [key],
                    message: selected
                      ? 'A selected shopping item field must have a value'
                      : 'An unchanged shopping item field must be null'
                  });
                }
              });
            })
        })
        .strict()
        .superRefine((payload, context) => {
          if (!payload.matchUnit && payload.targetUnit !== null) {
            context.addIssue({
              code: 'custom',
              path: ['targetUnit'],
              message: 'An unmatched target unit must be null'
            });
          }
        })
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('shopping.add_item'),
      payload: z
        .object({
          listName: z.string().trim().min(1).max(80),
          name: z.string().trim().min(1).max(200),
          quantity: z.number().finite().positive().max(100000).nullable(),
          unit: z.string().trim().max(48).nullable(),
          category: z.string().trim().max(48).nullable()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('household.plan_meals'),
      payload: z
        .object({
          weekStart: dateSchema.refine(
            (value) => new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1,
            'Meal plans must start on Monday'
          ),
          instructions: z.string().trim().max(1000)
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('household.create_task'),
      payload: z
        .object({
          title: z.string().trim().min(1).max(160),
          details: z.string().trim().max(500).nullable(),
          scheduledDate: dateSchema,
          priority: householdTaskPrioritySchema,
          spaceName: z.string().trim().max(120).nullable(),
          assignedMemberName: z.string().trim().max(120).nullable()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('household.update_task'),
      payload: z
        .object({
          targetTitle: z.string().trim().min(1).max(160),
          targetScheduledDate: dateSchema,
          changes: z
            .object({
              title: z.string().trim().min(1).max(160).nullable(),
              details: z.string().trim().max(500).nullable(),
              scheduledDate: dateSchema.nullable(),
              priority: householdTaskPrioritySchema.nullable(),
              spaceName: z.string().trim().max(120).nullable(),
              assignedMemberName: z.string().trim().max(120).nullable()
            })
            .strict()
            .superRefine((changes, context) => {
              if (Object.values(changes).every((value) => value === null)) {
                context.addIssue({
                  code: 'custom',
                  message: 'At least one task field must change'
                });
              }
            })
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('calendar.create_event'),
      payload: z
        .object({
          title: z.string().trim().min(1).max(120),
          kind: z.enum(['appointment', 'home', 'shopping', 'personal', 'other']),
          date: dateSchema,
          startTime: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .nullable(),
          endTime: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .nullable(),
          allDay: z.boolean(),
          sharedWithHousehold: z.boolean(),
          location: z.string().trim().max(120).nullable(),
          notes: z.string().trim().max(500).nullable()
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('calendar.update_event'),
      payload: z
        .object({
          targetTitle: z.string().trim().min(1).max(120),
          targetDate: dateSchema,
          targetStartTime: calendarEventTimeSchema,
          changes: z
            .object({
              title: z.string().trim().min(1).max(120).optional(),
              kind: calendarEventKindSchema.optional(),
              date: dateSchema.optional(),
              startTime: calendarEventTimeSchema.optional(),
              endTime: calendarEventTimeSchema.optional(),
              allDay: z.boolean().optional(),
              notes: z.string().trim().max(500).nullable().optional(),
              location: z.string().trim().max(120).nullable().optional()
            })
            .strict()
            .superRefine((changes, context) => {
              if (Object.keys(changes).length === 0) {
                context.addIssue({
                  code: 'custom',
                  message: 'At least one calendar event field must change'
                });
              }
              if (
                changes.startTime !== undefined &&
                changes.endTime !== undefined &&
                changes.startTime !== null &&
                changes.endTime !== null &&
                changes.endTime < changes.startTime
              ) {
                context.addIssue({
                  code: 'custom',
                  path: ['endTime'],
                  message: 'endTime cannot be earlier than startTime'
                });
              }
            })
        })
        .strict()
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('recipes.update_content'),
      payload: assistantRecipeContentUpdatePayloadSchema
    })
    .strict(),
  z
    .object({
      ...actionMetaSchema,
      kind: z.literal('recipes.create_draft'),
      payload: z.object({ recipe: aiRecipeOutputSchema }).strict()
    })
    .strict()
]);

export const aiAssistantProposalRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000),
    route: routeHintSchema.nullish(),
    referenceDate: optionalDateReferenceSchema
  })
  .strict();

export const assistantMealProposalRequestSchema = z
  .object({
    weekStart: z.iso.date(),
    householdMemberIds: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
    instructions: z.string().trim().max(1000)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Date(`${value.weekStart}T00:00:00.000Z`).getUTCDay() !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['weekStart'],
        message: 'The week must start on Monday.'
      });
    }
    if (new Set(value.householdMemberIds).size !== value.householdMemberIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['householdMemberIds'],
        message: 'A participant cannot be selected more than once.'
      });
    }
  });

export const assistantMealProposalRefinementInstructionSchema = z.string().trim().min(1).max(1000);

const refinementScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('action') }).strict(),
  z
    .object({
      kind: z.literal('field'),
      path: z
        .array(z.union([z.string().trim().min(1).max(80), z.number().int().min(0).max(100)]))
        .min(1)
        .max(8)
    })
    .strict()
]);

export const aiAssistantActionRefinementRequestSchema = z
  .object({
    actionId: z.string().trim().min(1).max(100),
    instruction: z.string().trim().min(1).max(1000),
    action: assistantActionCandidateSchema,
    scope: refinementScopeSchema,
    referenceDate: optionalDateReferenceSchema
  })
  .strict();

const assistantBatchRefinementTargetSchema = z
  .object({
    actionId: z.string().trim().min(1).max(100),
    action: assistantActionCandidateSchema
  })
  .strict();

const assistantBatchRefinementScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('batch') }).strict(),
  z
    .object({
      kind: z.literal('group'),
      domain: z.enum(['pantry', 'shopping', 'household', 'calendar', 'recipes'])
    })
    .strict()
]);

export const aiAssistantBatchRefinementRequestSchema = z
  .object({
    instruction: z.string().trim().min(1).max(1000),
    scope: assistantBatchRefinementScopeSchema,
    actions: z.array(assistantBatchRefinementTargetSchema).min(2).max(8),
    referenceDate: optionalDateReferenceSchema
  })
  .strict()
  .superRefine((request, context) => {
    const actionIds = request.actions.map(({ actionId }) => actionId);
    if (new Set(actionIds).size !== actionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Action IDs must be unique'
      });
    }

    if (request.scope.kind === 'group') {
      const domain = request.scope.domain;
      const matchesDomain = request.actions.every(
        ({ action }) => action.kind.split('.', 1)[0] === domain
      );
      if (!matchesDomain) {
        context.addIssue({
          code: 'custom',
          path: ['actions'],
          message: 'All group actions must match the requested domain'
        });
      }
    }
  });

export type AssistantActionRefinementScope = z.infer<typeof refinementScopeSchema>;
export type AssistantBatchRefinementScope = z.infer<typeof assistantBatchRefinementScopeSchema>;

export const assistantActionPlanCandidateSchema = z
  .object({
    summary: z.string().trim().min(1).max(300),
    actions: z.array(assistantActionCandidateSchema).max(8),
    questions: z.array(z.string().trim().min(1).max(300)).max(8)
  })
  .strict();

export const AI_ASSISTANT_RESPONSE_FORMAT = createAiResponseFormat(
  'ai_action_plan',
  assistantActionPlanCandidateSchema
);

export const assistantActionRefinementCandidateSchema = z
  .object({
    summary: z.string().trim().min(1).max(300),
    replacement: assistantActionCandidateSchema.nullable(),
    questions: z.array(z.string().trim().min(1).max(300)).max(8)
  })
  .strict();

export const assistantActionBatchRefinementCandidateSchema = z
  .object({
    summary: z.string().trim().min(1).max(300),
    replacements: z.array(assistantActionCandidateSchema).max(8),
    questions: z.array(z.string().trim().min(1).max(300)).max(8)
  })
  .strict();

export const AI_ASSISTANT_BATCH_REFINEMENT_RESPONSE_FORMAT = createAiResponseFormat(
  'ai_action_batch_refinement',
  assistantActionBatchRefinementCandidateSchema
);

export const AI_ASSISTANT_REFINEMENT_RESPONSE_FORMAT = createAiResponseFormat(
  'ai_action_refinement',
  assistantActionRefinementCandidateSchema
);

export type AssistantActionPlanCandidate = z.infer<typeof assistantActionPlanCandidateSchema>;
export type AssistantActionCandidate = AssistantActionPlanCandidate['actions'][number];
export type AssistantActionDomain = 'pantry' | 'shopping' | 'household' | 'calendar' | 'recipes';

export type AssistantAction = AssistantActionCandidate & {
  id: string;
  domain: AssistantActionDomain;
  actionType: string;
  selected: boolean;
  status: 'pending';
  executionTarget?:
    | AssistantTaskUpdateExecutionTarget
    | AssistantShoppingListUpdateExecutionTarget
    | AssistantShoppingItemUpdateExecutionTarget
    | AssistantPantryIngredientUpdateExecutionTarget
    | AssistantCalendarEventUpdateExecutionTarget
    | AssistantRecipeUpdateExecutionTarget;
};

export interface AssistantPantryIngredientUpdateExecutionTarget {
  kind: 'pantry-ingredient';
  id: string;
  snapshot: {
    name: string;
    category: string;
    quantity: number;
    unit: string;
    expirationDate: string | null;
    location: string | null;
    notes: string | null;
    updatedAt: string | null;
  };
}

export interface AssistantTaskUpdateExecutionTarget {
  kind: 'household-task';
  id: string;
  weekStart: string;
  version: number;
  snapshot: HouseholdTaskOccurrence;
}

export interface AssistantShoppingListUpdateExecutionTarget {
  kind: 'shopping-list';
  id: string;
  version: number;
  snapshot: { name: string; store: string | null };
}

export interface AssistantShoppingItemUpdateExecutionTarget {
  kind: 'shopping-item';
  id: string;
  listId: string;
  version: number;
  snapshot: {
    listName: string;
    name: string;
    productKey: string;
    quantity: number;
    unit: string | null;
    category: string | null;
    checked: boolean;
    deletedAt: string | null;
    updatedAt: string | null;
  };
}

export interface AssistantCalendarEventUpdateExecutionTarget {
  kind: 'calendar-event';
  id: string;
  householdId: string | null;
  updatedAt: string | null;
  snapshot: {
    title: string;
    kind: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    allDay: boolean;
    color: string | null;
    notes: string | null;
    location: string | null;
    recurrence: string;
    recurrenceRule: string | null;
    exceptions: string;
    source: string;
  };
}

export interface AssistantActionPlan {
  id: string;
  summary: string;
  actions: Array<Omit<AssistantAction, 'dependsOn'> & { dependsOn: string[] }>;
  questions: string[];
}

export function normalizeAssistantActionPlan(
  candidate: AssistantActionPlanCandidate,
  createId: () => string = randomUUID,
  executionTargets: ReadonlyMap<
    number,
    | AssistantTaskUpdateExecutionTarget
    | AssistantShoppingListUpdateExecutionTarget
    | AssistantShoppingItemUpdateExecutionTarget
    | AssistantPantryIngredientUpdateExecutionTarget
    | AssistantCalendarEventUpdateExecutionTarget
    | AssistantRecipeUpdateExecutionTarget
  > = new Map()
): AssistantActionPlan {
  const ids = candidate.actions.map(() => createId());
  const actions = candidate.actions.map((action, index) => {
    if (new Set(action.dependsOn).size !== action.dependsOn.length) {
      throw new Error('Invalid dependency indexes: duplicate dependency');
    }
    if (action.dependsOn.some((dependencyIndex) => dependencyIndex >= index)) {
      throw new Error('Invalid dependency indexes: dependencies must refer to earlier actions');
    }
    const executionTarget = executionTargets.get(index);
    if (action.kind === 'household.update_task' && executionTarget?.kind !== 'household-task') {
      throw new Error('Missing server-resolved task update target');
    }
    if (action.kind === 'shopping.update_list' && executionTarget?.kind !== 'shopping-list') {
      throw new Error('Missing server-resolved shopping list update target');
    }
    if (action.kind === 'shopping.update_item' && executionTarget?.kind !== 'shopping-item') {
      throw new Error('Missing server-resolved shopping item update target');
    }
    if (
      action.kind === 'pantry.update_ingredient' &&
      executionTarget?.kind !== 'pantry-ingredient'
    ) {
      throw new Error('Missing server-resolved pantry ingredient update target');
    }
    if (action.kind === 'calendar.update_event' && executionTarget?.kind !== 'calendar-event') {
      throw new Error('Missing server-resolved calendar event update target');
    }
    if (action.kind === 'recipes.update_content' && executionTarget?.kind !== 'recipe') {
      throw new Error('Missing server-resolved recipe update target');
    }
    const [domain, actionType] = action.kind.split('.', 2);
    return {
      ...action,
      ...(executionTarget ? { executionTarget } : {}),
      id: ids[index],
      domain: domain as AssistantActionDomain,
      actionType,
      dependsOn: action.dependsOn.map((dependencyIndex) => ids[dependencyIndex]),
      selected: false,
      status: 'pending' as const
    };
  });

  return { id: createId(), summary: candidate.summary, actions, questions: candidate.questions };
}
