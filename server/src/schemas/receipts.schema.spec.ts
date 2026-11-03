import { describe, expect, it } from 'vitest';
import {
  createReceiptItemSchema,
  ticketAnswerSchema,
  updateReceiptItemSchema,
  updateReceiptSchema
} from './receipts.schema.js';

const ticketAnswer = (metadata: Record<string, unknown> = {}) => ({
  lines: [],
  store: 'Mercadona',
  currency: 'EUR',
  totalMinor: 100,
  warnings: [],
  ...metadata
});

describe('ticketAnswerSchema model output', () => {
  it('keeps a detected store/local and accepts a real YYYY-MM-DD purchase date', () => {
    const result = ticketAnswerSchema.parse(
      ticketAnswer({ store: 'Mercadona Centro', purchaseDate: '2024-02-29' })
    );

    expect(result).toHaveProperty('store', 'Mercadona Centro');
    expect(result).toHaveProperty('purchaseDate', '2024-02-29');
  });

  it('keeps an explicit null when the receipt has no readable purchase date', () => {
    const result = ticketAnswerSchema.parse(ticketAnswer({ purchaseDate: null }));

    expect(result).toHaveProperty('purchaseDate', null);
  });

  it('accepts and preserves a literal store address when readable', () => {
    const result = ticketAnswerSchema.parse(
      ticketAnswer({
        purchaseDate: null,
        storeAddress: 'Avenida de Sierra Alhamilla, 04007 Almería'
      })
    );

    expect(result.storeAddress).toBe('Avenida de Sierra Alhamilla, 04007 Almería');
    expect(updateReceiptSchema.parse({ storeAddress: 'Calle Mayor 5' })).toEqual({
      storeAddress: 'Calle Mayor 5'
    });
    expect(updateReceiptSchema.parse({ storeAddress: null })).toEqual({ storeAddress: null });
  });

  it('rejects oversized store addresses instead of retaining unbounded model output', () => {
    const result = ticketAnswerSchema.safeParse(
      ticketAnswer({ purchaseDate: null, storeAddress: 'A'.repeat(501) })
    );

    expect(result.success).toBe(false);
  });

  it('accepts February 29 in a Gregorian century divisible by 400', () => {
    const result = ticketAnswerSchema.parse(ticketAnswer({ purchaseDate: '2000-02-29' }));

    expect(result.purchaseDate).toBe('2000-02-29');
  });

  it('accepts a well-formed line in the model response', () => {
    const result = ticketAnswerSchema.parse(
      ticketAnswer({
        purchaseDate: null,
        lines: [
          {
            name: 'Leche entera',
            quantity: 1,
            category: 'dairy',
            createCategory: false,
            offer: { buy: 2, take: 1 }
          }
        ]
      })
    );

    expect(result.lines[0]).toMatchObject({
      name: 'Leche entera',
      quantity: 1,
      offer: { buy: 2, take: 1 }
    });
  });

  it.each([{}, { category: null, createCategory: null }])(
    'rejects a model line without an explicit category decision (%j)',
    (categoryFields) => {
      const result = ticketAnswerSchema.safeParse(
        ticketAnswer({
          purchaseDate: null,
          lines: [{ name: 'Leche entera', ...categoryFields }]
        })
      );

      expect(result.success).toBe(false);
    }
  );

  it('rejects a multi-buy offer that gives away nothing', () => {
    const result = ticketAnswerSchema.safeParse(
      ticketAnswer({
        purchaseDate: null,
        lines: [{ name: 'Leche entera', offer: { buy: 2, take: 2 } }]
      })
    );

    expect(result.success).toBe(false);
  });

  it('accepts amount discounts as a total for selected units and percentage discounts in basis points', () => {
    const amount = createReceiptItemSchema.parse({
      name: 'Leche entera',
      quantity: 3,
      discount: { kind: 'amount', valueMinor: 150, units: 2 }
    });
    const percent = ticketAnswerSchema.parse(
      ticketAnswer({
        purchaseDate: null,
        lines: [
          {
            name: 'Yogur',
            quantity: 2,
            category: 'dairy',
            createCategory: false,
            discount: { kind: 'percent', percentBps: 1250, units: 1 }
          }
        ]
      })
    );

    expect(amount.discount).toEqual({ kind: 'amount', valueMinor: 150, units: 2 });
    expect(percent.lines[0]?.discount).toEqual({ kind: 'percent', percentBps: 1250, units: 1 });
    expect(
      createReceiptItemSchema.safeParse({
        name: 'Leche entera',
        quantity: 1,
        discount: { kind: 'percent', percentBps: 9999 }
      }).success
    ).toBe(true);
  });

  it.each([
    { kind: 'amount', valueMinor: 0 },
    { kind: 'amount', valueMinor: -1 },
    { kind: 'percent', percentBps: 0 },
    { kind: 'percent', percentBps: 10000 },
    { kind: 'percent', percentBps: 10001 },
    { kind: 'percent', percentBps: 500, valueMinor: 100 }
  ])('rejects malformed discount payloads %j', (discount) => {
    expect(
      createReceiptItemSchema.safeParse({ name: 'Leche entera', quantity: 2, discount }).success
    ).toBe(false);
  });

  it('rejects discounts that affect more units than the receipt line contains', () => {
    expect(
      createReceiptItemSchema.safeParse({
        name: 'Leche entera',
        quantity: 1,
        discount: { kind: 'amount', valueMinor: 50, units: 2 }
      }).success
    ).toBe(false);
  });

  it('does not allow a bundle offer and a direct discount on the same line', () => {
    const result = ticketAnswerSchema.safeParse(
      ticketAnswer({
        purchaseDate: null,
        lines: [
          {
            name: 'Leche entera',
            quantity: 3,
            category: 'dairy',
            createCategory: false,
            offer: { buy: 3, take: 2 },
            discount: { kind: 'percent', percentBps: 1000 }
          }
        ]
      })
    );

    expect(result.success).toBe(false);
  });

  it('accepts null as clearing a discount in a partial line update', () => {
    expect(updateReceiptItemSchema.parse({ discount: null })).toEqual({ discount: null });
  });

  it.each([
    '2026-2-03',
    '03-02-2026',
    '2026-02-29',
    '2025-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01'
  ])('rejects malformed or impossible purchase date %s', (purchaseDate) => {
    const result = ticketAnswerSchema.safeParse(ticketAnswer({ purchaseDate }));

    expect(result.success).toBe(false);
  });

  it('does not infer a missing purchase date from the upload timestamp', () => {
    const result = ticketAnswerSchema.safeParse(
      ticketAnswer({ created_at: '2026-10-03T12:34:56.000Z' })
    );

    // The model must explicitly return a civil purchase date or null; upload metadata is not
    // part of the answer contract and must never become a fallback purchase date.
    expect(result.success).toBe(false);
  });
});
