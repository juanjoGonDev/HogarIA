import { describe, expect, it } from 'vitest';
import {
  householdPlanningAutomationPatchSchema,
  householdPlanningAutomationRetrySchema,
  householdPlanningAutomationStateSchema
} from './household-planning-automation.schema.js';

const paused = {
  enabled: false,
  mode: null,
  scopes: [],
  weekday: null,
  localTime: null,
  timeZone: null,
  version: 0
};

const active = {
  enabled: true,
  mode: 'generate',
  scopes: ['meals', 'tasks'],
  weekday: 1,
  localTime: '09:30',
  timeZone: 'Europe/Madrid',
  version: 1
};

describe('household planning automation schemas', () => {
  it('accepts only a versioned occurrence retry request', () => {
    expect(
      householdPlanningAutomationRetrySchema.parse({
        expectedVersion: 3,
        occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30'
      })
    ).toEqual({
      expectedVersion: 3,
      occurrenceKey: 'household-weekly:Europe/Madrid:2026-10-12:1:09:30'
    });
  });

  it.each([
    {},
    { expectedVersion: -1, occurrenceKey: 'x' },
    { expectedVersion: 1.5, occurrenceKey: 'x' },
    { expectedVersion: 0, occurrenceKey: '' },
    { expectedVersion: 0, occurrenceKey: 'x'.repeat(201) },
    { expectedVersion: 0, occurrenceKey: 'x', extra: true }
  ])('rejects invalid retry request: %o', (input) => {
    expect(householdPlanningAutomationRetrySchema.safeParse(input).success).toBe(false);
  });

  it('accepts the default paused state without inventing a schedule', () => {
    expect(householdPlanningAutomationStateSchema.parse(paused)).toEqual(paused);
  });

  it('accepts an explicitly configured enabled state', () => {
    expect(householdPlanningAutomationStateSchema.parse(active)).toEqual(active);
  });

  it.each([
    { ...paused, extra: true },
    { ...active, unexpected: 'field' },
    { ...active, weekday: 0 },
    { ...active, weekday: 8 },
    { ...active, weekday: 1.5 },
    { ...active, localTime: '9:30' },
    { ...active, localTime: '24:00' },
    { ...active, localTime: '12:60' },
    { ...active, timeZone: '+01:00' },
    { ...active, timeZone: 'Not/AZone' },
    { ...active, scopes: ['meals', 'meals'] },
    { ...active, scopes: [] },
    { ...active, mode: null },
    { ...active, weekday: null },
    { ...active, localTime: null },
    { ...active, timeZone: null }
  ])('rejects invalid stored/request state: %o', (input) => {
    expect(householdPlanningAutomationStateSchema.safeParse(input).success).toBe(false);
  });

  it('accepts strict partial patches with an expected version', () => {
    expect(
      householdPlanningAutomationPatchSchema.parse({
        expectedVersion: 4,
        enabled: false
      })
    ).toEqual({ expectedVersion: 4, enabled: false });
    expect(
      householdPlanningAutomationPatchSchema.parse({
        expectedVersion: 0,
        mode: 'repeat',
        scopes: ['tasks'],
        weekday: 7,
        localTime: '00:05',
        timeZone: 'UTC'
      })
    ).toMatchObject({ expectedVersion: 0, mode: 'repeat', scopes: ['tasks'] });
  });

  it.each([
    {},
    { expectedVersion: -1, enabled: false },
    { expectedVersion: 1.1, enabled: false },
    { expectedVersion: 0 },
    { expectedVersion: 0, unknown: true },
    { expectedVersion: 0, mode: 'magic' },
    { expectedVersion: 0, scopes: ['tasks', 'tasks'] },
    { expectedVersion: 0, weekday: 0 },
    { expectedVersion: 0, localTime: '9:00' },
    { expectedVersion: 0, timeZone: 'local' }
  ])('rejects invalid strict patch: %o', (input) => {
    expect(householdPlanningAutomationPatchSchema.safeParse(input).success).toBe(false);
  });
});
