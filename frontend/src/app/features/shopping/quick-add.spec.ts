import { parseQuickAddLine } from './quick-add';

describe('shopping quick-add parser', () => {
  it('keeps a short first word when it is a product name, not a unit', () => {
    expect(parseQuickAddLine('1 Pan de cristal')).toEqual({
      name: 'Pan de cristal',
      quantity: 1,
      unit: null
    });
    expect(parseQuickAddLine('2 Leche semidesnatada')).toEqual({
      name: 'Leche semidesnatada',
      quantity: 2,
      unit: null
    });
  });

  it('parses quantity and recognized units with or without a space', () => {
    expect(parseQuickAddLine('1kg Tomates')).toEqual({ name: 'Tomates', quantity: 1, unit: 'kg' });
    expect(parseQuickAddLine('1 kg Tomates')).toEqual({ name: 'Tomates', quantity: 1, unit: 'kg' });
    expect(parseQuickAddLine('1,5 kg Tomates')).toEqual({
      name: 'Tomates',
      quantity: 1.5,
      unit: 'kg'
    });
  });

  it('does not consume a recognized unit when no product name follows', () => {
    expect(parseQuickAddLine('1kg')).toEqual({ name: '1kg', quantity: 1, unit: null });
    expect(parseQuickAddLine('1 kg')).toEqual({ name: '1 kg', quantity: 1, unit: null });
  });

  it('recognizes aliases and multiword units without treating the product as a unit', () => {
    expect(parseQuickAddLine('2 cucharadas azúcar')).toEqual({
      name: 'azúcar',
      quantity: 2,
      unit: 'cucharada'
    });
    expect(parseQuickAddLine('1 250 g harina')).toEqual({
      name: 'harina',
      quantity: 1,
      unit: '250 g'
    });
  });

  it('keeps plain names and removes only a leading list marker', () => {
    expect(parseQuickAddLine(' Pan de cristal ')).toEqual({
      name: 'Pan de cristal',
      quantity: 1,
      unit: null
    });
    expect(parseQuickAddLine('- 2 Leche')).toEqual({ name: 'Leche', quantity: 2, unit: null });
    expect(parseQuickAddLine('*2 Leche')).toEqual({ name: 'Leche', quantity: 2, unit: null });
  });
});
