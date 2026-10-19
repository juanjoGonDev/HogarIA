import { afterEach, describe, expect, it } from 'vitest';
import {
  channelForList,
  channelsForTray,
  listenerCount,
  publish,
  resetLiveHub,
  subscribe,
  type LiveEvent
} from './live-hub.js';

/**
 * El hub es pequeño a proposito, y eso es lo que se puede probar entero: repartir,
 * dar de baja, no reventar a los demas cuando uno falla y no dejar crecer un canal
 * sin limite. Lo que NO se prueba aqui (y no hace falta) es la red: el SSE de Hono
 * ya trae su propio contrato, y la ruta se prueba por separado.
 */

const event = (over: Partial<LiveEvent> = {}): LiveEvent => ({
  type: 'items',
  listId: 'l-1',
  action: 'item.check',
  by: 'u-1',
  byName: 'Ana',
  itemName: 'Pollo',
  at: new Date(0).toISOString(),
  ...over
});

afterEach(() => resetLiveHub());

describe('canales', () => {
  it('una lista y una bandeja no comparten canal', () => {
    expect(channelForList('l-1')).toBe('lists:l-1');
    expect(channelsForTray({ userId: 'u-1', householdId: null })).toEqual(['tray:u-1']);
    expect(channelsForTray({ userId: 'u-1', householdId: 'h-1' })).toEqual(['tray:u-1', 'tray:h-1']);
  });
});

describe('reparto', () => {
  it('entrega a los oyentes del canal y a nadie mas', () => {
    const seen: LiveEvent[] = [];
    const other: LiveEvent[] = [];
    subscribe('lists:l-1', (e) => seen.push(e));
    subscribe('lists:l-2', (e) => other.push(e));

    expect(publish(['lists:l-1'], event())).toBe(1);
    expect(seen).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it('la baja es idempotente y vacia el canal', () => {
    const off = subscribe('lists:l-1', () => {});
    expect(listenerCount('lists:l-1')).toBe(1);
    off();
    off();
    expect(listenerCount('lists:l-1')).toBe(0);
    expect(listenerCount()).toBe(0);
  });

  it('un oyente que revienta no corta el reparto a los demas', () => {
    const arrived: string[] = [];
    subscribe('lists:l-1', () => {
      throw new Error('la pantalla se cerro a medias');
    });
    subscribe('lists:l-1', () => {
      arrived.push('segunda');
    });

    publish(['lists:l-1'], event());
    expect(arrived).toEqual(['segunda']);
  });

  it('un canal no crece sin limite: el oyente mas viejo cae', () => {
    // Simula el movil que se duerme en el pasillo y deja el socket abierto: sin techo
    // esto es una fuga de memoria con forma de lista de la compra.
    for (let index = 0; index < 40; index += 1) subscribe('lists:l-1', () => {});
    expect(listenerCount('lists:l-1')).toBeLessThanOrEqual(24);
  });

  it('publicar a un canal vacio no es un error', () => {
    expect(publish(['lists:no-hay-nadie'], event())).toBe(0);
  });
});
