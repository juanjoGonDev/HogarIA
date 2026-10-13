import { describe, expect, it } from 'vitest';
import {
  HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT,
  householdTaskProposalObjectSchema
} from './household-task-proposal.schema.js';

describe('household task AI response contract', () => {
  it('uses strict JSON Schema with every output field required', () => {
    const schema = HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT.json_schema.schema as {
      type?: unknown;
      required?: unknown;
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
    };

    expect(HOUSEHOLD_TASK_PROPOSAL_RESPONSE_FORMAT).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'household_task_proposal', strict: true }
    });
    expect(schema).toMatchObject({
      type: 'object',
      required: ['tasks'],
      additionalProperties: false
    });
    expect(schema.properties?.tasks).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'scheduledDate', 'spaceId'],
        additionalProperties: false
      }
    });
  });

  it('accepts whole-household tasks and rejects missing or additional fields', () => {
    expect(
      householdTaskProposalObjectSchema.safeParse({
        tasks: [{ title: 'Sacar reciclaje', scheduledDate: '2026-10-12', spaceId: null }]
      }).success
    ).toBe(true);
    expect(
      householdTaskProposalObjectSchema.safeParse({
        tasks: [{ title: 'Sacar reciclaje', scheduledDate: '2026-10-12' }]
      }).success
    ).toBe(false);
    expect(
      householdTaskProposalObjectSchema.safeParse({
        tasks: [
          {
            title: 'Sacar reciclaje',
            scheduledDate: '2026-10-12',
            spaceId: null,
            assignedMemberId: 'member-private'
          }
        ]
      }).success
    ).toBe(false);
    expect(
      householdTaskProposalObjectSchema.safeParse({
        tasks: [],
        members: ['private profile']
      }).success
    ).toBe(false);
  });

  it('caps list and field sizes while leaving calendar and zone checks to semantic validation', () => {
    expect(
      householdTaskProposalObjectSchema.safeParse({
        tasks: Array.from({ length: 201 }, (_, index) => ({
          title: `Task ${index}`,
          scheduledDate: '2026-10-12',
          spaceId: null
        }))
      }).success
    ).toBe(false);
    expect(
      householdTaskProposalObjectSchema.safeParse({
        tasks: [{ title: ' '.repeat(121), scheduledDate: '2026-10-12', spaceId: null }]
      }).success
    ).toBe(false);
    expect(
      householdTaskProposalObjectSchema.safeParse({
        tasks: [{ title: 'Task', scheduledDate: '2026-99-99', spaceId: null }]
      }).success
    ).toBe(true);
  });
});
