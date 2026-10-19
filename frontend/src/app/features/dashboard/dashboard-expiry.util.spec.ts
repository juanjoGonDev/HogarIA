import { expiringWithinDays, isExpiryHorizonDays } from './dashboard-expiry.util';
import type { CaducidadRow } from '../../shared/models/caducidades.model';

function row(name: string, daysLeft: number | null): CaducidadRow {
  return {
    id: name,
    name,
    category: 'other',
    quantity: 1,
    unit: 'unit',
    expirationDate: null,
    estimatedDays: null,
    shelfSource: daysLeft === null ? null : 'fecha',
    vence: null,
    daysLeft,
    cadaDias: null,
    unidadesPorCompra: null,
    duraDias: null,
    lastBought: null
  };
}

describe('Dashboard expiry helpers', () => {
  it('accepts only whole-day horizons from 1 through 30', () => {
    expect(isExpiryHorizonDays(1)).toBeTrue();
    expect(isExpiryHorizonDays(30)).toBeTrue();
    expect(isExpiryHorizonDays(0)).toBeFalse();
    expect(isExpiryHorizonDays(31)).toBeFalse();
    expect(isExpiryHorizonDays(3.5)).toBeFalse();
    expect(isExpiryHorizonDays('3')).toBeFalse();
  });

  it('includes expired, today, and the inclusive horizon while excluding unknown and later dates', () => {
    const rows = [
      row('Dentro del horizonte', 3),
      row('Un día después', 4),
      row('Sin fecha', null),
      row('Hoy', 0),
      row('Caducado', -2)
    ];

    expect(expiringWithinDays(rows, 3).map((entry) => entry.name)).toEqual([
      'Caducado',
      'Hoy',
      'Dentro del horizonte'
    ]);
  });

  it('orders by urgency then name and limits the preview to five entries', () => {
    const rows = [
      row('Z', 2),
      row('A', 2),
      row('Caducado', -1),
      row('Hoy', 0),
      row('Tres', 3),
      row('Uno', 1),
      row('Fuera', 31)
    ];

    expect(expiringWithinDays(rows, 30).map((entry) => entry.name)).toEqual([
      'Caducado',
      'Hoy',
      'Uno',
      'A',
      'Z'
    ]);
  });

  it('returns an empty preview for invalid horizon or limit values', () => {
    const rows = [row('Hoy', 0)];
    expect(expiringWithinDays(rows, 0)).toEqual([]);
    expect(expiringWithinDays(rows, 3, 0)).toEqual([]);
    expect(expiringWithinDays(rows, 3, Number.NaN)).toEqual([]);
  });
});
