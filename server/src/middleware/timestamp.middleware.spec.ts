import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { timestampMiddleware, zoneStampValue } from './timestamp.middleware.js';

/**
 * El server guarda UTC (SQLite `CURRENT_TIMESTAMP` no dice zona) y el navegador la lee como
 * hora local: sin una `Z` al final, «las 20:00» de Granada se ven como «las 20:00» de quien
 * mire, que no es la hora a la que pasó nada. Se arregla en la SALIDA y no en la base de
 * datos porque lo que está mal es el sobre, no la carta.
 */
describe('zoneStampValue', () => {
  it('convierte en instante UTC el timestamp ingenuo de una clave de tiempo', () => {
    expect(zoneStampValue({ created_at: '2026-05-04 08:12:30' })).toEqual({ created_at: '2026-05-04T08:12:30Z' });
    expect(zoneStampValue({ expiresAt: '2026-05-04T08:12:30.250' })).toEqual({ expiresAt: '2026-05-04T08:12:30.250Z' });
  });

  it('no toca lo que ya lleva zona', () => {
    const input = { updated_at: '2026-05-04T08:12:30.000Z', other: '2026-05-04 08:12:30+02:00' };
    expect(zoneStampValue(input)).toEqual(input);
  });

  it('deja intacta la fecha suelta: un dia de calendario no es un instante', () => {
    // Y a proposito: anadirle la hora 00:00 UTC a `expiry_date` desplazaría el dia de la
    // caducidad media jornada y volveria a pintar «caducado» el yogur de manana.
    expect(zoneStampValue({ date: '2026-05-04', expiryDate: '2026-05-04' })).toEqual({
      date: '2026-05-04',
      expiryDate: '2026-05-04'
    });
  });

  it('no reescribe cadenas que no cuelgan de una clave de tiempo', () => {
    // Una nota puede decir «llamar el 2026-05-04 08:12:30» sin que eso sea una marca temporal.
    expect(zoneStampValue({ note: '2026-05-04 08:12:30' })).toEqual({ note: '2026-05-04 08:12:30' });
  });

  it('bucea en arrays y objetos anidados', () => {
    expect(zoneStampValue({ data: [{ items: [{ checked_at: '2026-05-04 08:12:30' }] }, { seenAt: null }] })).toEqual({
      data: [{ items: [{ checked_at: '2026-05-04T08:12:30Z' }] }, { seenAt: null }]
    });
  });

  it('un valor que no parece timestamp sale igual que entró', () => {
    const input = { name: 'Leche', quantity: 3, checked: 0, deleted_at: null, ratio: 1.5 };
    expect(zoneStampValue(input)).toEqual(input);
  });
});

describe('timestampMiddleware', () => {
  const app = new Hono();
  app.use('/api/*', timestampMiddleware());
  app.get('/api/thing', (c) =>
    c.json({
      success: true,
      data: { created_at: '2026-05-04 08:12:30', note: '2026-05-04 08:12:30', date: '2026-05-04' }
    })
  );
  app.get('/api/text', (c) => c.text('2026-05-04 08:12:30'));
  app.get('/api/stream', (c) => {
    c.header('Content-Type', 'text/event-stream');
    return c.body('data: {"at":"2026-05-04 08:12:30"}\n\n');
  });

  it('reescribe la respuesta JSON de la API', async () => {
    const body = (await app.request('/api/thing')).json() as Promise<any>;
    expect(await body).toEqual({
      success: true,
      data: { created_at: '2026-05-04T08:12:30Z', note: '2026-05-04 08:12:30', date: '2026-05-04' }
    });
  });

  it('no toca texto plano ni el stream de eventos', async () => {
    expect(await (await app.request('/api/text')).text()).toBe('2026-05-04 08:12:30');
    const stream = await app.request('/api/stream');
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(await stream.text()).toContain('"2026-05-04 08:12:30"');
  });

  it('respeta el estado y las cabeceras originales', async () => {
    const missing = await app.request('/api/nope');
    expect(missing.status).toBe(404);
  });
});
