import { describe, expect, it } from 'vitest';
import {
  EXPIRY_ESTIMATE_RESPONSE_FORMAT,
  MEAL_REPLACEMENT_RESPONSE_FORMAT,
  RECEIPT_RESPONSE_FORMAT,
  RECIPE_RESPONSE_FORMAT,
  SHOPPING_PHOTO_RESPONSE_FORMAT,
  createRecommendationsResponseFormat,
  createWeeklyPlanResponseFormat
} from './ai-generated-output.schema.js';
import { createAiResponseFormat } from './ai-response-format.js';
import { z } from 'zod';
import { HOUSEHOLD_PLAN_RESPONSE_FORMAT } from './household-plan.schema.js';
import { HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT } from './household-task-proposal.schema.js';

function findObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(findObjects);
  if (!value || typeof value !== 'object') return [];
  const current = value as Record<string, unknown>;
  const nested = Object.entries(current).flatMap(([key, child]) => {
    if (key === 'properties' || key === '$defs') {
      return Object.values((child ?? {}) as Record<string, unknown>).flatMap(findObjects);
    }
    return ['items', 'anyOf', 'oneOf', 'allOf'].includes(key) ? findObjects(child) : [];
  });
  return [current, ...nested];
}

const TASK_FORMATS = [
  RECIPE_RESPONSE_FORMAT,
  MEAL_REPLACEMENT_RESPONSE_FORMAT,
  RECEIPT_RESPONSE_FORMAT,
  SHOPPING_PHOTO_RESPONSE_FORMAT,
  EXPIRY_ESTIMATE_RESPONSE_FORMAT,
  createRecommendationsResponseFormat(3),
  createWeeklyPlanResponseFormat(['breakfast', 'dinner']),
  HOUSEHOLD_PLAN_RESPONSE_FORMAT,
  HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT
];

describe('createAiResponseFormat', () => {
  it.each(TASK_FORMATS)(
    '$json_schema.name genera un contrato estricto y sin defaults',
    (format) => {
      expect(format.type).toBe('json_schema');
      expect(format.json_schema.strict).toBe(true);
      for (const node of findObjects(format.json_schema.schema)) {
        expect(node.default).toBeUndefined();
        if (node.type === 'object' || node.properties) {
          const properties = node.properties as Record<string, unknown>;
          expect(node.additionalProperties).toBe(false);
          expect(node.required).toEqual(Object.keys(properties));
        }
      }
    }
  );

  it('hace requeridos los campos con default de Zod sin enviar la palabra default', () => {
    const format = createAiResponseFormat(
      'defaulted_answer',
      z.object({ count: z.number().default(1) })
    );
    expect(format.json_schema.schema).toMatchObject({
      type: 'object',
      required: ['count'],
      properties: { count: { type: 'number' } },
      additionalProperties: false
    });
    expect(JSON.stringify(format)).not.toContain('"default"');
  });

  it('requires a non-empty category decision for every receipt line', () => {
    const schema = RECEIPT_RESPONSE_FORMAT.json_schema.schema as {
      properties: {
        lines: {
          items: {
            properties: {
              category: Record<string, unknown>;
              createCategory: Record<string, unknown>;
            };
          };
        };
      };
    };

    expect(schema.properties.lines.items.properties.category).toMatchObject({
      type: 'string',
      minLength: 1
    });
    expect(schema.properties.lines.items.properties.createCategory).toMatchObject({
      type: 'boolean'
    });
  });

  it('crea los esquemas de recomendaciones y plan semanal con el tamaño/comidas de la petición', () => {
    const recommendations = createRecommendationsResponseFormat(4);
    expect(recommendations.json_schema.schema).toMatchObject({
      properties: {
        recommendations: { minItems: 4, maxItems: 4 }
      }
    });

    const weekly = createWeeklyPlanResponseFormat(['dinner']);
    expect(weekly.json_schema.schema).toMatchObject({
      properties: {
        days: {
          items: {
            properties: {
              meals: { properties: { dinner: expect.any(Object) } }
            }
          }
        }
      }
    });
    const meals = (weekly.json_schema.schema.properties as any).days.items.properties.meals;
    expect(Object.keys(meals.properties)).toEqual(['dinner']);
  });

  it('requiere nombres de formato válidos y esquemas raíz de objeto', () => {
    expect(() => createAiResponseFormat('name with spaces', z.object({ ok: z.boolean() }))).toThrow(
      /schema name/i
    );
    expect(() => createAiResponseFormat('array', z.array(z.string()))).toThrow(
      /root must be an object/i
    );
  });
});
