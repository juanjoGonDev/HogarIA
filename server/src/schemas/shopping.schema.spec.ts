import { describe, expect, it } from 'vitest';
import { assistantUpdateListSchema } from './shopping.schema.js';

describe('assistant shopping-list update schema', () => {
  const valid = {
    version: 3,
    changes: { store: null },
    assistantAction: {
      operation: 'update_list',
      targetId: 'list-1',
      before: { name: 'Compra semanal', store: 'Lidl' }
    }
  };

  it('allows an explicit store clear but rejects whitespace-only stores', () => {
    expect(assistantUpdateListSchema.safeParse(valid).success).toBe(true);
    expect(
      assistantUpdateListSchema.safeParse({
        ...valid,
        changes: { store: '   ' }
      }).success
    ).toBe(false);
  });

  it('requires a non-empty narrow patch and rejects fields outside its contract', () => {
    expect(assistantUpdateListSchema.safeParse({ ...valid, changes: {} }).success).toBe(false);
    expect(
      assistantUpdateListSchema.safeParse({
        ...valid,
        changes: { status: 'done' }
      }).success
    ).toBe(false);
  });
});
