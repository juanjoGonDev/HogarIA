import { describe, expect, it } from 'vitest';
import {
  createMealProposalResponseFormat,
  MEAL_PROPOSAL_LIMITS,
  mealProposalSchema,
  type MealProposal
} from './household-meal-proposal.schema.js';

function makeScheduledEvent(overrides: Partial<MealProposal['events'][number]> = {}) {
  return {
    date: '2026-10-13',
    mealType: 'dinner' as const,
    time: '20:30',
    recipe: {
      name: 'Lentejas con verduras',
      description: 'Guiso sencillo de lentejas y verduras.',
      baseServings: 1 as const,
      prepTimeMinutes: 15,
      cookTimeMinutes: 35,
      ingredients: [
        {
          name: 'lentejas',
          quantity: 80,
          unit: 'g' as const,
          preparation: null,
          isOptional: false,
          notes: null
        }
      ],
      instructions: ['Lavar las lentejas.', 'Cocerlas con las verduras hasta que estén tiernas.']
    },
    participantAliases: ['P1'],
    servings: 1,
    objectiveSummary: 'Una comida equilibrada con legumbres y verduras.',
    status: 'scheduled' as const,
    reason: null,
    ...overrides
  };
}

function makeUnresolvedEvent(overrides: Record<string, unknown> = {}) {
  return {
    ...makeScheduledEvent(),
    time: null,
    recipe: null,
    servings: 0,
    status: 'unresolved' as const,
    reason: 'No se ha encontrado una opción segura para este grupo.',
    ...overrides
  };
}

function getObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(getObjects);
  if (!value || typeof value !== 'object') return [];
  const node = value as Record<string, unknown>;
  const children: unknown[] = [];
  if (node.properties && typeof node.properties === 'object') {
    children.push(...Object.values(node.properties as Record<string, unknown>));
  }
  if (node.items) children.push(node.items);
  if (node.anyOf) children.push(node.anyOf);
  return [node, ...children.flatMap(getObjects)];
}

describe('meal proposal schema', () => {
  it('uses a WebAPI-supported date pattern in the strict provider schema', () => {
    const responseFormat = createMealProposalResponseFormat();
    const schema = responseFormat.json_schema.schema as {
      properties: {
        events: {
          items: { properties: { date: Record<string, unknown> } };
        };
      };
    };
    const dateSchema = schema.properties.events.items.properties.date;

    expect(dateSchema.type).toBe('string');
    expect(dateSchema.pattern).toContain('-02-29');
    expect(dateSchema.format).toBeUndefined();
    expect(JSON.stringify(responseFormat.json_schema.schema)).not.toContain('"format"');
  });

  it('accepts scheduled and unresolved events with explicit nullable values', () => {
    const parsed = mealProposalSchema.parse({
      events: [makeScheduledEvent(), makeUnresolvedEvent({ date: '2026-10-14', mealType: 'lunch' })]
    });

    expect(parsed.events[0]).toMatchObject({ status: 'scheduled', servings: 1, reason: null });
    expect(parsed.events[1]).toMatchObject({
      status: 'unresolved',
      time: null,
      recipe: null,
      servings: 0
    });
  });

  it('requires a real ISO calendar date, meal type, and a valid 24-hour HH:mm time or null', () => {
    const validEvent = makeScheduledEvent();
    expect(
      mealProposalSchema.safeParse({ events: [{ ...validEvent, date: '2026-02-29' }] }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [{ ...validEvent, date: '2024-02-29' }] }).success
    ).toBe(true);
    expect(
      mealProposalSchema.safeParse({ events: [{ ...validEvent, date: '2026-10-13T00:00:00Z' }] })
        .success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [{ ...validEvent, mealType: 'brunch' }] }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [{ ...validEvent, time: '24:00' }] }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [{ ...validEvent, time: '9:00' }] }).success
    ).toBe(false);
    expect(mealProposalSchema.safeParse({ events: [{ ...validEvent, time: null }] }).success).toBe(
      true
    );
  });

  it('keeps recipe quantities based on exactly one serving and enforces payload limits', () => {
    const valid = makeScheduledEvent();
    const maxIngredients = Array.from(
      { length: MEAL_PROPOSAL_LIMITS.maxIngredientsPerRecipe },
      (_, index) => ({
        name: `ingrediente ${index + 1}`,
        quantity: 1,
        unit: 'g' as const,
        preparation: null,
        isOptional: false,
        notes: null
      })
    );
    expect(
      mealProposalSchema.safeParse({
        events: [
          {
            ...valid,
            participantAliases: Array.from(
              { length: MEAL_PROPOSAL_LIMITS.maxParticipantAliases },
              (_, index) => `P${index + 1}`
            ),
            servings: MEAL_PROPOSAL_LIMITS.maxServings,
            recipe: { ...valid.recipe, ingredients: maxIngredients }
          }
        ]
      }).success
    ).toBe(true);
    expect(
      mealProposalSchema.safeParse({
        events: [
          {
            ...valid,
            recipe: { ...valid.recipe, baseServings: 2 }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        events: [
          {
            ...valid,
            participantAliases: Array.from(
              { length: MEAL_PROPOSAL_LIMITS.maxParticipantAliases + 1 },
              (_, index) => `P${index + 1}`
            ),
            servings: 101
          }
        ]
      }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        events: [
          {
            ...valid,
            recipe: {
              ...valid.recipe,
              ingredients: [...maxIngredients, maxIngredients[0]]
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        events: Array.from({ length: MEAL_PROPOSAL_LIMITS.maxEvents + 1 }, (_, index) => ({
          ...valid,
          date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
          participantAliases: ['P1']
        }))
      }).success
    ).toBe(false);

    const eventsAtLimit = Array.from({ length: MEAL_PROPOSAL_LIMITS.maxEvents }, (_, index) => ({
      ...valid,
      date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
      participantAliases: ['P1']
    }));
    expect(mealProposalSchema.safeParse({ events: eventsAtLimit }).success).toBe(true);
  });

  it('rejects duplicate aliases within an event and duplicate participants across events in one turn', () => {
    const repeatedParticipant = makeScheduledEvent({ participantAliases: ['P1', 'P1'] });
    expect(mealProposalSchema.safeParse({ events: [repeatedParticipant] }).success).toBe(false);

    const sameTurn = [
      makeScheduledEvent({ participantAliases: ['P1'] }),
      makeScheduledEvent({ participantAliases: ['P1', 'P2'] })
    ];
    expect(mealProposalSchema.safeParse({ events: sameTurn }).success).toBe(false);

    const separateGroups = [
      makeScheduledEvent({ participantAliases: ['P1'] }),
      makeScheduledEvent({ participantAliases: ['P2'] })
    ];
    expect(mealProposalSchema.safeParse({ events: separateGroups }).success).toBe(true);
  });

  it('accepts only opaque P-number participant aliases', () => {
    for (const invalidAlias of ['user_123', 'P0', 'P01', 'P101']) {
      expect(
        mealProposalSchema.safeParse({
          events: [makeScheduledEvent({ participantAliases: [invalidAlias] })]
        }).success
      ).toBe(false);
    }
    expect(
      mealProposalSchema.safeParse({
        events: [makeScheduledEvent({ participantAliases: ['P42'] })]
      }).success
    ).toBe(true);
    expect(
      mealProposalSchema.safeParse({
        events: [makeScheduledEvent({ participantAliases: ['P100'] })]
      }).success
    ).toBe(true);
    expect(
      mealProposalSchema.safeParse({
        events: [{ ...makeScheduledEvent(), participantId: 'real-member-id' }]
      }).success
    ).toBe(false);
  });

  it('requires scheduled events to have a recipe and unresolved events to have a clear reason', () => {
    expect(
      mealProposalSchema.safeParse({ events: [makeScheduledEvent({ recipe: null })] }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [makeScheduledEvent({ servings: 0 })] }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [makeScheduledEvent({ reason: 'unexpected' })] })
        .success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [makeUnresolvedEvent({ reason: null })] }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({ events: [makeUnresolvedEvent({ servings: 1 })] }).success
    ).toBe(false);
    expect(
      mealProposalSchema.safeParse({
        events: [makeUnresolvedEvent({ recipe: makeScheduledEvent().recipe })]
      }).success
    ).toBe(false);
  });

  it('builds a normalized OpenAI strict JSON Schema with all object keys required and closed', () => {
    const format = createMealProposalResponseFormat();
    expect(format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'weekly_meal_proposal', strict: true }
    });
    const nodes = getObjects(format.json_schema.schema);
    expect(nodes.length).toBeGreaterThan(5);
    for (const node of nodes) {
      if (node.type === 'object' || node.properties) {
        const properties = node.properties as Record<string, unknown>;
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(properties));
      }
    }

    const root = format.json_schema.schema as { properties: Record<string, unknown> };
    expect(root.properties.events).toMatchObject({
      type: 'array',
      maxItems: MEAL_PROPOSAL_LIMITS.maxEvents
    });
    const eventProperties = (
      root.properties.events as { items: { properties: Record<string, unknown> } }
    ).items.properties;
    const dateSchema = eventProperties.date as Record<string, unknown>;
    expect(dateSchema).toMatchObject({
      type: 'string',
      pattern: expect.stringContaining('-02-29')
    });
    expect(dateSchema.format).toBeUndefined();
    expect(isNullable(eventProperties.time)).toBe(true);
    expect(isNullable(eventProperties.recipe)).toBe(true);
    expect(isNullable(eventProperties.reason)).toBe(true);
  });
});

function isNullable(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isNullable);
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  if (node.type === 'null' || (Array.isArray(node.type) && node.type.includes('null'))) return true;
  return Array.isArray(node.anyOf) && node.anyOf.some(isNullable);
}
