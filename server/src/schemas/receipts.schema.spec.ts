import { describe, expect, it } from 'vitest';
import { ticketAnswerSchema } from './receipts.schema.js';

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
