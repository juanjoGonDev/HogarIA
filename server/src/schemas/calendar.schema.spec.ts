import { describe, expect, it } from 'vitest';
import { updateCalendarSchema } from './calendar.schema.js';

describe('calendar AI goal text', () => {
  it('accepts long custom instructions without clipping or rejecting them', () => {
    const instructions = 'Objetivo de planificación. '.repeat(120).trim();
    const parsed = updateCalendarSchema.parse({
      goals: { types: ['custom'], customInstructions: instructions }
    });
    expect(parsed).toMatchObject({ goals: { customInstructions: instructions } });
  });

  it('accepts long custom goals and meal labels', () => {
    const longText = 'Objetivo culinario detallado. '.repeat(100).trim();
    const parsed = updateCalendarSchema.parse({
      goals: {
        customGoals: [{ name: longText, target: 1, unit: longText }]
      }
    });
    expect(parsed).toMatchObject({
      goals: { customGoals: [{ name: longText, target: 1, unit: longText }] }
    });
  });
});
