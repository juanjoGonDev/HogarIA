import { describe, expect, it } from 'vitest';
import { assistantUpdateItemSchema, assistantUpdateListSchema } from './shopping.schema.js';

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

describe('assistant shopping-item update schema', () => {
  const valid = {
    version: 3,
    changes: { quantity: 2, unit: null, category: 'Bebidas' },
    assistantAction: {
      operation: 'update_item',
      targetId: 'item-1',
      listId: 'list-1',
      before: {
        listName: 'Compra semanal',
        name: 'Leche',
        productKey: 'leche',
        quantity: 1,
        unit: 'l',
        category: 'Lácteos',
        checked: false,
        deletedAt: null,
        updatedAt: '2026-10-17 12:00:00'
      }
    }
  };

  it('allows clearing unit/category while requiring an absolute positive quantity', () => {
    expect(assistantUpdateItemSchema.safeParse(valid).success).toBe(true);
    expect(
      assistantUpdateItemSchema.safeParse({ ...valid, changes: { quantity: 0 } }).success
    ).toBe(false);
    expect(
      assistantUpdateItemSchema.safeParse({ ...valid, changes: { quantity: 10001 } }).success
    ).toBe(false);
  });

  it('normalizes visually empty optional unit/category fields to a clear', () => {
    const parsed = assistantUpdateItemSchema.safeParse({
      ...valid,
      changes: { unit: '   ', category: '' }
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.changes).toEqual({ unit: null, category: null });
  });

  it('rejects empty patches and any state, price, discount, or identifier outside its contract', () => {
    expect(assistantUpdateItemSchema.safeParse({ ...valid, changes: {} }).success).toBe(false);
    for (const changes of [
      { checked: true },
      { priceMinor: 100 },
      { discount: null },
      { deletedAt: null },
      { id: 'model-id' }
    ]) {
      expect(assistantUpdateItemSchema.safeParse({ ...valid, changes }).success).toBe(false);
    }
    expect(
      assistantUpdateItemSchema.safeParse({
        ...valid,
        assistantAction: {
          ...valid.assistantAction,
          before: { ...valid.assistantAction.before, checked: true }
        }
      }).success
    ).toBe(false);
  });
});
