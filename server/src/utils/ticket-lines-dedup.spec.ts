import { describe, expect, it } from 'vitest';
import { deduplicateTicketLines } from './ticket-lines-dedup.js';

describe('deduplicateTicketLines', () => {
  it('quita una línea repetida con variación de mayúsculas/acentos y conserva el dato más completo', () => {
    const unique = deduplicateTicketLines(
      [
        {
          name: 'Yogur natural',
          quantity: 2,
          unit: 'ud',
          priceMinor: 240,
          confidence: 0.4,
          category: 'other',
          note: ''
        },
        {
          name: 'YÓGUR natural',
          quantity: 2,
          unit: 'unidades',
          priceMinor: 240,
          confidence: 0.9,
          category: 'dairy',
          note: 'matched across pages'
        }
      ],
      240
    );

    expect(unique).toHaveLength(1);
    expect(unique[0]).toMatchObject({
      name: 'YÓGUR natural',
      priceMinor: 240,
      confidence: 0.9,
      category: 'dairy'
    });
  });

  it('conserva líneas reales del mismo producto con distinta cantidad, precio u oferta', () => {
    const lines = [
      { name: 'Leche entera', quantity: 1, unit: 'l', priceMinor: 110 },
      { name: 'Leche entera', quantity: 2, unit: 'l', priceMinor: 220 },
      { name: 'Leche entera', quantity: 1, unit: 'l', priceMinor: 125 },
      {
        name: 'Leche entera',
        quantity: 1,
        unit: 'l',
        priceMinor: 110,
        offer: { buy: 3, take: 2 }
      }
    ];

    expect(deduplicateTicketLines(lines, 565)).toEqual(lines);
  });

  it('preserves distinct identical printed purchases when the ticket total confirms both', () => {
    const lines = [
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'AGUA mineral', quantity: 1, unit: 'ud', priceMinor: 100 }
    ];

    expect(deduplicateTicketLines(lines, 200)).toEqual(lines);
  });

  it('collapses overlapping views only when the deduplicated prices match the ticket total', () => {
    const lines = [
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100, confidence: 0.7 },
      { name: 'AGUA mineral', quantity: 1, unit: 'ud', priceMinor: 100, confidence: 0.9 }
    ];

    expect(deduplicateTicketLines(lines, 100)).toHaveLength(1);
  });

  it('resolves mixed overlap groups without collapsing a separate identical purchase', () => {
    const lines = [
      { name: 'Tomate', quantity: 1, unit: 'ud', priceMinor: 500 },
      { name: 'Pan', quantity: 1, unit: 'ud', priceMinor: 150 },
      { name: 'Tomate', quantity: 1, unit: 'ud', priceMinor: 500 },
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 }
    ];

    const reconciled = deduplicateTicketLines(lines, 850);
    expect(reconciled.map(({ name, priceMinor }) => [name, priceMinor])).toEqual([
      ['Tomate', 500],
      ['Pan', 150],
      ['Agua mineral', 100],
      ['Agua mineral', 100]
    ]);
  });

  it('keeps every line when the ticket total cannot disambiguate equal-price duplicate groups', () => {
    const lines = [
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'Leche', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'Leche', quantity: 1, unit: 'ud', priceMinor: 100 }
    ];

    expect(deduplicateTicketLines(lines, 300)).toEqual(lines);
  });

  it('can retain the total-supported number of rows in a partially overlapping group', () => {
    const lines = [
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 }
    ];

    expect(deduplicateTicketLines(lines, 200)).toEqual(lines.slice(0, 2));
  });

  it('preserves rows rather than expanding an oversized reconciliation search', () => {
    const groups = Array.from({ length: 13 }, (_, index) => ({
      name: `Producto ${index}`,
      quantity: 1,
      unit: 'ud',
      priceMinor: 2 ** index
    }));
    const lines = groups.flatMap((line) => [line, { ...line }]);

    expect(
      deduplicateTicketLines(
        lines,
        groups.reduce((total, line) => total + line.priceMinor, 0)
      )
    ).toEqual(lines);
  });

  it('preserves rows when the total or any line price is unknown or does not reconcile', () => {
    const lines = [
      { name: 'Agua mineral', quantity: 1, unit: 'ud', priceMinor: 100 },
      { name: 'AGUA mineral', quantity: 1, unit: 'ud', priceMinor: 100 }
    ];

    expect(deduplicateTicketLines(lines, null)).toEqual(lines);
    expect(deduplicateTicketLines(lines, 250)).toEqual(lines);
    expect(deduplicateTicketLines([lines[0]!, { ...lines[1]!, priceMinor: null }], 100)).toEqual([
      lines[0],
      { ...lines[1]!, priceMinor: null }
    ]);
  });

  it('mantiene la primera posición cuando una repetición aporta un campo que faltaba', () => {
    const unique = deduplicateTicketLines(
      [
        { name: 'Pan integral', quantity: 1, unit: 'ud', priceMinor: 150 },
        { name: 'Pan integral', quantity: 1, unit: 'ud', priceMinor: 150, note: 'Sin etiqueta' },
        { name: 'Manzana', quantity: 1, unit: 'kg', priceMinor: 299 }
      ],
      449
    );

    expect(unique.map(({ name }) => name)).toEqual(['Pan integral', 'Manzana']);
    expect(unique[0]).toMatchObject({ priceMinor: 150, note: 'Sin etiqueta' });
  });
});
