import { describe, expect, it } from 'vitest';
import {
  aiAssistantProposalRequestSchema,
  aiAssistantActionRefinementRequestSchema,
  aiAssistantBatchRefinementRequestSchema,
  assistantMealProposalRefinementInstructionSchema,
  assistantMealProposalRequestSchema,
  AI_ASSISTANT_RESPONSE_FORMAT,
  assistantActionPlanCandidateSchema,
  assistantActionRefinementCandidateSchema,
  assistantActionBatchRefinementCandidateSchema,
  normalizeAssistantActionPlan
} from './ai-assistant.schema.js';

const ingredientAction = {
  kind: 'pantry.add_ingredient',
  title: 'Añadir lentejas',
  summary: 'Añade un paquete de lentejas a la despensa.',
  payload: {
    name: 'Lentejas',
    quantity: 1,
    unit: 'unit',
    category: 'other',
    expirationDate: null,
    location: 'pantry',
    notes: null
  },
  dependsOn: [],
  warnings: []
};

const pantryUpdateAction = {
  kind: 'pantry.update_ingredient',
  title: 'Actualizar queso',
  summary: 'Actualiza cantidad y caducidad del queso.',
  payload: {
    targetName: 'Queso fresco',
    changes: {
      name: null,
      setName: false,
      category: null,
      setCategory: false,
      quantity: 0,
      setQuantity: true,
      unit: null,
      setUnit: false,
      expirationDate: null,
      setExpirationDate: true,
      location: null,
      setLocation: false,
      notes: 'Para la ensalada',
      setNotes: true
    }
  },
  dependsOn: [],
  warnings: []
};

describe('ai assistant proposal schemas', () => {
  it('accepts only a strict pantry update patch, including explicit zero and clear values', () => {
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Actualiza un ingrediente.',
        actions: [pantryUpdateAction],
        questions: []
      }).success
    ).toBe(true);

    const invalidActions = [
      { ...pantryUpdateAction, payload: { ...pantryUpdateAction.payload, id: 'model-id' } },
      {
        ...pantryUpdateAction,
        payload: {
          ...pantryUpdateAction.payload,
          changes: { ...pantryUpdateAction.payload.changes, notes: 'sin cambiar', setNotes: false }
        }
      },
      {
        ...pantryUpdateAction,
        payload: {
          ...pantryUpdateAction.payload,
          changes: {
            ...pantryUpdateAction.payload.changes,
            quantity: null,
            setQuantity: true
          }
        }
      },
      {
        ...pantryUpdateAction,
        payload: {
          ...pantryUpdateAction.payload,
          changes: {
            ...pantryUpdateAction.payload.changes,
            expirationDate: '2026-02-30'
          }
        }
      },
      {
        ...pantryUpdateAction,
        payload: {
          ...pantryUpdateAction.payload,
          changes: { ...pantryUpdateAction.payload.changes, unit: 'box', setUnit: true }
        }
      },
      {
        ...pantryUpdateAction,
        payload: {
          ...pantryUpdateAction.payload,
          changes: { ...pantryUpdateAction.payload.changes, quantity: -1 }
        }
      },
      {
        ...pantryUpdateAction,
        payload: {
          ...pantryUpdateAction.payload,
          changes: {
            ...pantryUpdateAction.payload.changes,
            notes: 'nota',
            targetId: 'untrusted'
          }
        }
      }
    ];

    for (const action of invalidActions) {
      expect(
        assistantActionPlanCandidateSchema.safeParse({
          summary: 'Actualiza un ingrediente.',
          actions: [action],
          questions: []
        }).success
      ).toBe(false);
    }
  });
  it('requires an explicit unique member selection and a Monday meal-plan week', () => {
    const valid = {
      weekStart: '2026-10-12',
      householdMemberIds: ['member-1'],
      instructions: 'Solo cenas.'
    };
    expect(assistantMealProposalRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      assistantMealProposalRequestSchema.safeParse({ ...valid, weekStart: '2026-10-13' }).success
    ).toBe(false);
    expect(
      assistantMealProposalRequestSchema.safeParse({
        ...valid,
        householdMemberIds: ['member-1', 'member-1']
      }).success
    ).toBe(false);
    expect(
      assistantMealProposalRequestSchema.safeParse({ ...valid, householdMemberIds: [] }).success
    ).toBe(false);
    expect(
      assistantMealProposalRequestSchema.safeParse({ ...valid, memberIds: ['client-owned'] })
        .success
    ).toBe(false);
    expect(assistantMealProposalRefinementInstructionSchema.safeParse('   ').success).toBe(false);
    expect(
      assistantMealProposalRefinementInstructionSchema.safeParse('x'.repeat(1001)).success
    ).toBe(false);
  });

  it('builds a strict structured-output schema without oneOf', () => {
    const schema = JSON.stringify(AI_ASSISTANT_RESPONSE_FORMAT.json_schema.schema);
    expect(AI_ASSISTANT_RESPONSE_FORMAT.json_schema.strict).toBe(true);
    expect(schema).not.toContain('"oneOf"');
    expect(schema).toContain('"anyOf"');
  });

  it('accepts a bounded non-empty prompt and an allowlisted route hint only', () => {
    expect(
      aiAssistantProposalRequestSchema.safeParse({ prompt: 'Añade lentejas', route: 'pantry' })
        .success
    ).toBe(true);
    expect(aiAssistantProposalRequestSchema.safeParse({ prompt: '   ' }).success).toBe(false);
    expect(
      aiAssistantProposalRequestSchema.safeParse({ prompt: 'Añade lentejas', route: '/admin' })
        .success
    ).toBe(false);
    expect(
      aiAssistantProposalRequestSchema.safeParse({ prompt: 'Añade lentejas', userId: 'u1' }).success
    ).toBe(false);
    expect(aiAssistantProposalRequestSchema.safeParse({ prompt: 'x'.repeat(2001) }).success).toBe(
      false
    );
  });

  it('accepts only a scoped action refinement with a valid action and stable UI ID', () => {
    const actionScope = aiAssistantActionRefinementRequestSchema.safeParse({
      actionId: 'ui-action-1',
      instruction: 'Cambia a 500 gramos',
      action: ingredientAction,
      scope: { kind: 'action' }
    });
    expect(actionScope.success).toBe(true);
    expect(
      aiAssistantActionRefinementRequestSchema.safeParse({
        actionId: 'ui-action-1',
        instruction: 'Cambia a 500 gramos',
        action: ingredientAction
      }).success
    ).toBe(false);
    expect(
      aiAssistantActionRefinementRequestSchema.safeParse({
        actionId: 'ui-action-1',
        instruction: 'Cambia la cantidad',
        action: ingredientAction,
        scope: { kind: 'field', path: ['quantity'] }
      }).success
    ).toBe(true);
    expect(
      aiAssistantActionRefinementRequestSchema.safeParse({
        actionId: 'ui-action-1',
        instruction: 'Cambia la cantidad',
        action: ingredientAction,
        scope: { kind: 'field', path: [] }
      }).success
    ).toBe(false);
    expect(
      aiAssistantActionRefinementRequestSchema.safeParse({
        actionId: 'ui-action-1',
        instruction: 'Cambia a 500 gramos',
        action: ingredientAction,
        userId: 'victim'
      }).success
    ).toBe(false);
    expect(
      aiAssistantActionRefinementRequestSchema.safeParse({
        actionId: '',
        instruction: 'Cambia a 500 gramos',
        action: ingredientAction
      }).success
    ).toBe(false);
  });

  it('accepts only explicit batch or single-domain group refinement scopes', () => {
    const listAction = {
      kind: 'shopping.create_list',
      title: 'Crear compra',
      summary: 'Crea una lista.',
      payload: { name: 'Compra semanal', store: null },
      dependsOn: [],
      warnings: []
    };
    const targets = [
      { actionId: 'pantry-1', action: ingredientAction },
      { actionId: 'shopping-1', action: listAction }
    ];

    expect(
      aiAssistantBatchRefinementRequestSchema.safeParse({
        instruction: 'Haz el plan más fácil de preparar.',
        scope: { kind: 'batch' },
        actions: targets
      }).success
    ).toBe(true);
    expect(
      aiAssistantBatchRefinementRequestSchema.safeParse({
        instruction: 'Ajusta las compras.',
        scope: { kind: 'group', domain: 'shopping' },
        actions: [targets[1], { actionId: 'shopping-2', action: listAction }]
      }).success
    ).toBe(true);
    expect(
      aiAssistantBatchRefinementRequestSchema.safeParse({
        instruction: 'Ajusta el grupo.',
        scope: { kind: 'group', domain: 'shopping' },
        actions: targets
      }).success
    ).toBe(false);
    expect(
      aiAssistantBatchRefinementRequestSchema.safeParse({
        instruction: 'Ajusta el lote.',
        scope: { kind: 'batch' },
        actions: [targets[0], { ...targets[1], actionId: targets[0].actionId }]
      }).success
    ).toBe(false);
    expect(
      aiAssistantBatchRefinementRequestSchema.safeParse({
        instruction: 'Ajusta el lote.',
        scope: { kind: 'action' },
        actions: targets
      }).success
    ).toBe(false);
  });

  it('accepts only strict allowlisted action payloads and rejects model-owned IDs', () => {
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Añadir un alimento a la despensa.',
        actions: [ingredientAction],
        questions: []
      }).success
    ).toBe(true);

    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Acción alterada.',
        actions: [{ ...ingredientAction, id: 'model-id' }],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Acción desconocida.',
        actions: [{ ...ingredientAction, kind: 'shell.run' }],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Payload alterado.',
        actions: [
          {
            ...ingredientAction,
            payload: { ...ingredientAction.payload, userId: 'victim' }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
  });

  it('accepts typed actions across compatible domains and rejects invalid dates', () => {
    const validActions = [
      {
        ...ingredientAction,
        payload: { ...ingredientAction.payload, expirationDate: '2026-10-20' }
      },
      {
        kind: 'shopping.create_list',
        title: 'Crear compra',
        summary: 'Crea una lista.',
        payload: { name: 'Compra semanal', store: null },
        dependsOn: [],
        warnings: []
      },
      {
        kind: 'shopping.add_item',
        title: 'Añadir lentejas',
        summary: 'Añade un producto.',
        payload: {
          listName: 'Compra semanal',
          name: 'Lentejas',
          quantity: 1,
          unit: 'unit',
          category: null
        },
        dependsOn: [1],
        warnings: []
      },
      {
        kind: 'household.create_task',
        title: 'Preparar cena',
        summary: 'Prepara la cena.',
        payload: {
          title: 'Preparar cena',
          details: null,
          scheduledDate: '2026-10-20',
          spaceName: null,
          assignedMemberName: null
        },
        dependsOn: [],
        warnings: []
      },
      {
        kind: 'calendar.create_event',
        title: 'Cena',
        summary: 'Añade un evento privado.',
        payload: {
          title: 'Cena',
          kind: 'personal',
          date: '2026-10-20',
          startTime: '21:00',
          endTime: null,
          allDay: false,
          sharedWithHousehold: false,
          location: null,
          notes: null
        },
        dependsOn: [],
        warnings: []
      },
      {
        kind: 'recipes.create_draft',
        title: 'Crear receta',
        summary: 'Crea un borrador privado.',
        payload: { recipe: validRecipe() },
        dependsOn: [],
        warnings: []
      }
    ];

    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Plan entre dominios.',
        actions: validActions,
        questions: []
      }).success
    ).toBe(true);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Fecha inválida.',
        actions: [
          {
            ...validActions[3],
            payload: { ...(validActions[3] as any).payload, scheduledDate: 'próximo viernes' }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
  });

  it('accepts a meal-plan intent without model-controlled participant or record IDs', () => {
    const action = {
      kind: 'household.plan_meals',
      title: 'Proponer comidas',
      summary: 'Prepara una propuesta para la semana indicada.',
      payload: { weekStart: '2026-10-19', instructions: 'Incluye cenas sencillas.' },
      dependsOn: [],
      warnings: []
    };
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Propuesta semanal.',
        actions: [action],
        questions: []
      }).success
    ).toBe(true);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Propuesta semanal.',
        actions: [{ ...action, payload: { ...action.payload, householdMemberIds: ['member-1'] } }],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Propuesta semanal.',
        actions: [{ ...action, payload: { ...action.payload, weekStart: '2026-10-20' } }],
        questions: []
      }).success
    ).toBe(false);
  });

  it('accepts only explicit task update targets and non-empty editable fields', () => {
    const updateTask = {
      kind: 'household.update_task',
      title: 'Mover reciclaje',
      summary: 'Cambia la fecha de la tarea existente.',
      payload: {
        targetTitle: 'Bajar reciclaje',
        targetScheduledDate: '2026-10-19',
        changes: {
          title: null,
          details: null,
          scheduledDate: '2026-10-20',
          spaceName: null,
          assignedMemberName: null
        }
      },
      dependsOn: [],
      warnings: []
    };

    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Cambio de tarea.',
        actions: [updateTask],
        questions: []
      }).success
    ).toBe(true);

    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'El modelo no elige IDs.',
        actions: [
          {
            ...updateTask,
            payload: { ...updateTask.payload, taskId: 'model-owned-id' }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'No hay cambios.',
        actions: [
          {
            ...updateTask,
            payload: {
              ...updateTask.payload,
              changes: {
                title: null,
                details: null,
                scheduledDate: null,
                spaceName: null,
                assignedMemberName: null
              }
            }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'No se inventa prioridad.',
        actions: [
          {
            ...updateTask,
            payload: {
              ...updateTask.payload,
              changes: { ...updateTask.payload.changes, priority: 'high' }
            }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
  });

  it('accepts only server-resolvable shopping list selectors and editable changes', () => {
    const updateList = {
      kind: 'shopping.update_list',
      title: 'Cambiar lista de compra',
      summary: 'Renombra la lista activa y asigna otra tienda.',
      payload: {
        targetName: 'Compra semanal',
        changes: {
          name: 'Compra del sábado',
          setName: true,
          store: 'Mercadona',
          setStore: true
        }
      },
      dependsOn: [],
      warnings: []
    };

    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Lista revisada.',
        actions: [updateList],
        questions: []
      }).success
    ).toBe(true);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Solo tienda.',
        actions: [
          {
            ...updateList,
            payload: {
              ...updateList.payload,
              changes: { name: null, setName: false, store: null, setStore: true }
            }
          }
        ],
        questions: []
      }).success
    ).toBe(true);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Sin cambios.',
        actions: [
          {
            ...updateList,
            payload: {
              ...updateList.payload,
              changes: { name: null, setName: false, store: null, setStore: false }
            }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'El modelo no elige registros.',
        actions: [
          {
            ...updateList,
            payload: { ...updateList.payload, listId: 'model-owned-id' }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'No se cambia el estado.',
        actions: [
          {
            ...updateList,
            payload: {
              ...updateList.payload,
              changes: { ...updateList.payload.changes, status: 'done' }
            }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
    expect(
      assistantActionPlanCandidateSchema.safeParse({
        summary: 'Nombre limitado.',
        actions: [
          {
            ...updateList,
            payload: {
              ...updateList.payload,
              changes: { name: 'x'.repeat(81), setName: true, store: null, setStore: false }
            }
          }
        ],
        questions: []
      }).success
    ).toBe(false);
  });

  it('accepts scoped replacement or a question-only refinement result', () => {
    expect(
      assistantActionRefinementCandidateSchema.safeParse({
        summary: 'He cambiado la cantidad.',
        replacement: ingredientAction,
        questions: []
      }).success
    ).toBe(true);
    expect(
      assistantActionRefinementCandidateSchema.safeParse({
        summary: 'Necesito una precisión.',
        replacement: null,
        questions: ['¿Qué cantidad prefieres?']
      }).success
    ).toBe(true);
    expect(
      assistantActionRefinementCandidateSchema.safeParse({
        summary: 'Resultado inválido.',
        replacement: { ...ingredientAction, kind: 'system.execute' },
        questions: []
      }).success
    ).toBe(false);
  });

  it('accepts ordered batch replacements or clarification-only output', () => {
    expect(
      assistantActionBatchRefinementCandidateSchema.safeParse({
        summary: 'Lote revisado.',
        replacements: [ingredientAction, ingredientAction],
        questions: []
      }).success
    ).toBe(true);
    expect(
      assistantActionBatchRefinementCandidateSchema.safeParse({
        summary: 'Hace falta aclarar una cantidad.',
        replacements: [],
        questions: ['¿Qué cantidad prefieres?']
      }).success
    ).toBe(true);
  });

  it('assigns stable app-owned IDs and maps only earlier dependencies', () => {
    const candidate = assistantActionPlanCandidateSchema.parse({
      summary: 'Crea lista y añade lentejas.',
      actions: [
        {
          kind: 'shopping.create_list',
          title: 'Crear lista',
          summary: 'Crea una lista de la compra.',
          payload: { name: 'Compra semanal', store: null },
          dependsOn: [],
          warnings: []
        },
        {
          kind: 'shopping.add_item',
          title: 'Añadir lentejas',
          summary: 'Añade lentejas a la lista creada.',
          payload: {
            listName: 'Compra semanal',
            name: 'Lentejas',
            quantity: 1,
            unit: 'unit',
            category: null
          },
          dependsOn: [0],
          warnings: []
        }
      ],
      questions: []
    });

    const plan = normalizeAssistantActionPlan(candidate);
    expect(plan.id).toBeTruthy();
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0].id).not.toBe(plan.actions[1].id);
    expect(plan.actions[0].dependsOn).toEqual([]);
    expect(plan.actions[1].dependsOn).toEqual([plan.actions[0].id]);
    expect(plan.actions.every((action) => !action.selected && action.status === 'pending')).toBe(
      true
    );
  });

  it('requires the server-resolved pantry target to normalize an existing-ingredient action', () => {
    const candidate = assistantActionPlanCandidateSchema.parse({
      summary: 'Actualiza el queso.',
      actions: [pantryUpdateAction],
      questions: []
    });
    expect(() => normalizeAssistantActionPlan(candidate)).toThrow(
      /server-resolved pantry ingredient/i
    );

    const target = {
      kind: 'pantry-ingredient' as const,
      id: 'ingredient-1',
      snapshot: {
        name: 'Queso fresco',
        category: 'dairy',
        quantity: 1,
        unit: 'unit',
        expirationDate: null,
        location: 'fridge',
        notes: null,
        updatedAt: '2026-10-16 00:00:00'
      }
    };
    const plan = normalizeAssistantActionPlan(
      candidate,
      (() => {
        let id = 0;
        return () => `app-id-${++id}`;
      })(),
      new Map([[0, target]])
    );
    expect(plan.actions[0].executionTarget).toEqual(target);
  });

  it('rejects forward and duplicate dependency indexes during normalization', () => {
    const forward = assistantActionPlanCandidateSchema.parse({
      summary: 'Plan inválido.',
      actions: [
        {
          kind: 'shopping.create_list',
          title: 'Crear lista',
          summary: 'Crea una lista.',
          payload: { name: 'Compra semanal', store: null },
          dependsOn: [1],
          warnings: []
        },
        {
          kind: 'shopping.add_item',
          title: 'Añadir lentejas',
          summary: 'Añade lentejas.',
          payload: {
            listName: 'Compra semanal',
            name: 'Lentejas',
            quantity: 1,
            unit: 'unit',
            category: null
          },
          dependsOn: [],
          warnings: []
        }
      ],
      questions: []
    });

    expect(() => normalizeAssistantActionPlan(forward)).toThrow(/dependenc/i);

    const duplicate = assistantActionPlanCandidateSchema.parse({
      summary: 'Dependencia duplicada.',
      actions: [
        {
          kind: 'shopping.create_list',
          title: 'Crear lista',
          summary: 'Crea una lista.',
          payload: { name: 'Compra semanal', store: null },
          dependsOn: [],
          warnings: []
        },
        {
          kind: 'shopping.add_item',
          title: 'Añadir lentejas',
          summary: 'Añade lentejas.',
          payload: {
            listName: 'Compra semanal',
            name: 'Lentejas',
            quantity: 1,
            unit: 'unit',
            category: null
          },
          dependsOn: [0, 0],
          warnings: []
        }
      ],
      questions: []
    });
    expect(() => normalizeAssistantActionPlan(duplicate)).toThrow(/duplicate dependency/i);
  });
});

function validRecipe() {
  const step = {
    stepNumber: 1,
    instruction: 'Cocer las lentejas.',
    duration: null,
    temperature: null,
    timerRequired: false,
    timerDuration: null,
    tips: null,
    warning: null,
    illustration: null
  };
  return {
    name: 'Lentejas sencillas',
    description: 'Plato sencillo.',
    difficulty: 'easy',
    cuisine: 'española',
    totalTime: 30,
    prepTime: 10,
    cookTime: 20,
    restTime: null,
    baseServings: 1,
    calories: null,
    ingredients: [
      {
        name: 'lentejas',
        quantity: 80,
        unit: 'g',
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    utensils: ['olla'],
    guidance: {
      appliances: [],
      parallelTasks: [],
      tipsAndVariations: [],
      batchCookingWarning: null
    },
    instructionsByLevel: { basic: [step], intermediate: [step], expert: [step] },
    nutrition: null,
    storage: null,
    tags: []
  };
}
