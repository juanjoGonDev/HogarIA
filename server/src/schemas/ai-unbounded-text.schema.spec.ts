import { describe, expect, it } from 'vitest';
import {
  EXPIRY_ESTIMATE_RESPONSE_FORMAT,
  MEAL_REPLACEMENT_RESPONSE_FORMAT,
  RECIPE_RESPONSE_FORMAT,
  RECEIPT_RESPONSE_FORMAT,
  SHOPPING_PHOTO_RESPONSE_FORMAT
} from './ai-generated-output.schema.js';
import { createMealProposalResponseFormat } from './household-meal-proposal.schema.js';
import { createReceiptItemSchema, ticketAnswerSchema } from './receipts.schema.js';
import {
  HOUSEHOLD_PLAN_RESPONSE_FORMAT,
  householdPlanProposalRequestSchema,
  householdPlanSchema
} from './household-plan.schema.js';
import {
  HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT,
  householdTaskProposalObjectSchema
} from './household-task-proposal.schema.js';
import { householdTaskWeekWriteSchema, HOUSEHOLD_TASK_LIMITS } from './household-task.schema.js';
import { applyLinesSchema, photoAnalyzeSchema, photoLinesSchema } from './shopping.schema.js';
import { shelfAnswerSchema } from '../utils/caducidades.js';

const longText = 'A'.repeat(2_501);

function atPath(schema: any, path: string[]): any[] {
  let nodes = [schema];
  for (const part of path) {
    nodes = nodes.flatMap((node) => {
      if (part === 'items') {
        if (node.items) return [node.items];
        return node.anyOf?.flatMap((child: any) => (child.items ? [child.items] : [])) ?? [];
      }
      if (node.properties?.[part]) return [node.properties[part]];
      return (
        node.anyOf?.flatMap((child: any) =>
          child.properties?.[part] ? [child.properties[part]] : []
        ) ?? []
      );
    });
  }
  return nodes;
}

describe('AI-generated natural text has no arbitrary character caps', () => {
  it('omits maxLength from generated human-readable response fields', () => {
    for (const format of [
      RECIPE_RESPONSE_FORMAT,
      MEAL_REPLACEMENT_RESPONSE_FORMAT,
      createMealProposalResponseFormat()
    ]) {
      expect(JSON.stringify(format.json_schema.schema), format.json_schema.name).not.toContain(
        '"maxLength"'
      );
    }

    const uncappedFields: Array<[unknown, string[]]> = [
      [RECEIPT_RESPONSE_FORMAT.json_schema.schema, ['store']],
      [RECEIPT_RESPONSE_FORMAT.json_schema.schema, ['warnings', 'items']],
      [RECEIPT_RESPONSE_FORMAT.json_schema.schema, ['lines', 'items', 'name']],
      [RECEIPT_RESPONSE_FORMAT.json_schema.schema, ['lines', 'items', 'unit']],
      [RECEIPT_RESPONSE_FORMAT.json_schema.schema, ['lines', 'items', 'note']],
      [SHOPPING_PHOTO_RESPONSE_FORMAT.json_schema.schema, ['warnings', 'items']],
      [SHOPPING_PHOTO_RESPONSE_FORMAT.json_schema.schema, ['lines', 'items', 'name']],
      [SHOPPING_PHOTO_RESPONSE_FORMAT.json_schema.schema, ['lines', 'items', 'unit']],
      [SHOPPING_PHOTO_RESPONSE_FORMAT.json_schema.schema, ['lines', 'items', 'note']],
      [EXPIRY_ESTIMATE_RESPONSE_FORMAT.json_schema.schema, ['products', 'items', 'name']],
      [HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema.schema, ['dwellingTypeLabel']],
      [HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema.schema, ['summary']],
      [HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema.schema, ['warnings', 'items']],
      [HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema.schema, ['floors', 'items', 'name']],
      [
        HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema.schema,
        ['floors', 'items', 'spaces', 'items', 'label']
      ],
      [HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT.json_schema.schema, ['tasks', 'items', 'title']]
    ];

    for (const [schema, path] of uncappedFields) {
      const fields = atPath(schema, path);
      expect(fields.length, path.join('.')).toBeGreaterThan(0);
      for (const field of fields) {
        expect(JSON.stringify(field), path.join('.')).not.toContain('"maxLength"');
      }
    }
  });

  it('validates long text through ticket and shopping-photo outputs and confirmation schemas', () => {
    expect(
      photoAnalyzeSchema.parse({
        image: `data:image/jpeg;base64,${'A'.repeat(64)}`,
        note: longText
      }).note
    ).toBe(longText);

    const ticket = ticketAnswerSchema.parse({
      lines: [
        { name: longText, unit: longText, note: longText, category: 'dairy', createCategory: false }
      ],
      store: longText,
      purchaseDate: null,
      currency: 'EUR',
      totalMinor: 100,
      warnings: [longText]
    });
    expect(ticket.lines[0]?.name).toBe(longText);
    expect(ticket.store).toBe(longText);
    expect(ticket.warnings?.[0]).toBe(longText);
    expect(
      createReceiptItemSchema.parse({ name: longText, unit: longText, note: longText }).name
    ).toBe(longText);

    const photoLines = photoLinesSchema.parse({
      lines: [{ name: longText, unit: longText, note: longText, category: 'dairy' }],
      warnings: [longText]
    });
    expect(photoLines.lines[0]?.name).toBe(longText);
    expect(
      applyLinesSchema.parse({ lines: [{ name: longText, unit: longText, note: longText }] })
        .lines[0]?.name
    ).toBe(longText);
  });

  it('validates long text in floorplan and household-task AI outputs and persistence', () => {
    expect(
      householdPlanProposalRequestSchema.parse({ baseVersion: 0, prompt: longText }).prompt
    ).toBe(longText);

    const plan = {
      schemaVersion: 1 as const,
      dwellingType: 'other' as const,
      dwellingTypeLabel: longText,
      summary: longText,
      warnings: [longText],
      floors: [
        {
          id: 'floor-1',
          name: longText,
          level: 0,
          walls: [],
          openings: [],
          spaces: [
            {
              id: 'space-1',
              kind: 'custom' as const,
              label: longText,
              polygon: [
                { x: 100, y: 100 },
                { x: 800, y: 100 },
                { x: 800, y: 800 }
              ],
              parentSpaceId: null
            }
          ]
        }
      ]
    };
    expect(householdPlanSchema.parse(plan).summary).toBe(longText);

    const title = longText;
    expect(
      householdTaskProposalObjectSchema.parse({
        tasks: [{ title, scheduledDate: '2026-10-12', spaceId: null }]
      }).tasks[0]?.title
    ).toBe(title);
    expect(HOUSEHOLD_TASK_LIMITS.maxTasksPerWeek).toBe(200);
    expect(
      householdTaskWeekWriteSchema.parse({
        baseVersion: 0,
        weekStart: '2026-10-12',
        tasks: [
          {
            id: 'task-long-title',
            title,
            details: null,
            spaceId: null,
            scheduledDate: '2026-10-12',
            assignedMemberId: null,
            completed: false
          }
        ]
      }).tasks[0]?.title
    ).toBe(title);
  });

  it('preserves long inventory names in expiry estimates', () => {
    expect(
      shelfAnswerSchema.parse({ products: [{ name: longText, days: 30 }] }).products[0]?.name
    ).toBe(longText);
  });
});
