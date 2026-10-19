import { describe, expect, it } from 'vitest';
import {
  MAX_OCCURRENCES,
  dayFromISO,
  exceptionSet,
  expandOccurrences,
  isRecurrence,
  isRecurrenceSchedule,
  occursOn,
  parseExceptionDates,
  type RecurrenceRule,
  type RecurrenceSchedule
} from './calendar-recurrence.js';

// Un mes de octubre de 2026 como ventana: 31 dias, y el 1 de octubre de 2026 es jueves (UTC).
const OCTUBRE = { from: '2026-10-01', to: '2026-10-31' };

const serie = (extra: Partial<RecurrenceRule> & { date: string; recurrence: RecurrenceRule['recurrence'] }): RecurrenceRule => extra;

describe('calendario — fechas ISO', () => {
  it('lee una fecha real y rechaza la que no existe', () => {
    expect(dayFromISO('2026-10-01')).toBe(Date.UTC(2026, 9, 1));
    expect(dayFromISO('0000-02-29')).not.toBeNull(); // El calendario UTC conserva los años ISO 00–99.
    expect(dayFromISO('2026-02-30')).toBeNull(); // febrero no tiene dia 30
    expect(dayFromISO('2026-2-1')).toBeNull(); // sin relleno no es ISO
    expect(dayFromISO(null)).toBeNull();
    expect(dayFromISO(undefined)).toBeNull();
  });

  it('conoce los tres valores y solo los tres', () => {
    expect(isRecurrence('none')).toBe(true);
    expect(isRecurrence('daily')).toBe(true);
    expect(isRecurrence('weekly')).toBe(true);
    expect(isRecurrence('monthly')).toBe(false); // todavia no (12t-R: va al §13)
    expect(isRecurrence('')).toBe(false);
    expect(isRecurrence(null)).toBe(false);
  });
});

describe('calendario — expandir una serie', () => {
  it('`none` es el dia de la fila, ni uno mas', () => {
    expect(expandOccurrences(serie({ date: '2026-10-08', recurrence: 'none' }), OCTUBRE).dates).toEqual([
      '2026-10-08'
    ]);
    // Fuera de la ventana no existe para quien mira.
    expect(expandOccurrences(serie({ date: '2026-09-08', recurrence: 'none' }), OCTUBRE).dates).toEqual([]);
  });

  it('`daily` llena la ventana desde el dia de la serie, y no antes', () => {
    const desdeEl25 = expandOccurrences(serie({ date: '2026-09-25', recurrence: 'daily' }), OCTUBRE);
    expect(desdeEl25.dates[0]).toBe('2026-10-01');
    expect(desdeEl25.dates).toHaveLength(31);
    expect(desdeEl25.truncated).toBe(false);

    // Una serie que empieza dentro de la ventana no puede rellenar los dias anteriores.
    const desdeEl12 = expandOccurrences(serie({ date: '2026-10-12', recurrence: 'daily' }), OCTUBRE);
    expect(desdeEl12.dates[0]).toBe('2026-10-12');
    expect(desdeEl12.dates).toHaveLength(20);
  });

  it('`weekly` cae siempre en el mismo dia de la semana, aunque la serie empiece hace anos', () => {
    // Jueves 1 de octubre de 2026; la serie empezo un jueves de enero.
    const rule = serie({ date: '2026-01-01', recurrence: 'weekly' });
    const { dates } = expandOccurrences(rule, OCTUBRE);
    expect(dates.length).toBeGreaterThan(3);
    for (const iso of dates) {
      expect(new Date(`${iso}T00:00:00.000Z`).getUTCDay()).toBe(4); // jueves
    }
    // Salto a la primera ocurrencia de la ventana: no se recorre enero-octubre a saltos de siete dias.
    expect(dates[0]! >= '2026-10-01').toBe(true);
    expect(dates[0]! <= '2026-10-07').toBe(true);
  });

  it('las excepciones quitan el dia, no la serie («solo este dia no»)', () => {
    const rule = serie({ date: '2026-10-01', recurrence: 'daily', exceptions: ['2026-10-13', '2026-10-14'] });
    const { dates } = expandOccurrences(rule, OCTUBRE);
    expect(dates).toHaveLength(29);
    expect(dates).not.toContain('2026-10-13');
    expect(dates).not.toContain('2026-10-14');
  });

  it('una excepcion fuera de la ventana no molesta, y una serie `none` si se puede quitar', () => {
    expect(expandOccurrences(serie({ date: '2026-10-08', recurrence: 'none', exceptions: ['2026-12-25'] }), OCTUBRE).dates).toEqual([
      '2026-10-08'
    ]);
    expect(expandOccurrences(serie({ date: '2026-10-08', recurrence: 'none', exceptions: ['2026-10-08'] }), OCTUBRE).dates).toEqual([]);
  });

  it('la columna es TEXT: acepta el JSON ya parseado y el que no', () => {
    const comoTexto = serie({ date: '2026-10-01', recurrence: 'daily', exceptions: '["2026-10-02"]' });
    expect(expandOccurrences(comoTexto, { from: '2026-10-01', to: '2026-10-03' }).dates).toEqual([
      '2026-10-01',
      '2026-10-03'
    ]);
    expect([...exceptionSet({ date: '2026-10-01', recurrence: 'daily', exceptions: 'no es JSON' })]).toEqual([]);
    expect([...exceptionSet({ date: '2026-10-01', recurrence: 'daily', exceptions: ['2026-10-05', 'basura'] })]).toEqual([
      '2026-10-05'
    ]);
  });

  it('una ventana al reves o una fecha ilegible no rompen nada', () => {
    expect(expandOccurrences(serie({ date: '2026-10-01', recurrence: 'daily' }), { from: '2026-10-31', to: '2026-10-01' })).toEqual({
      dates: [],
      truncated: false
    });
    expect(expandOccurrences(serie({ date: 'no-existe', recurrence: 'daily' }), OCTUBRE).dates).toEqual([]);
  });

  it('corta por seguridad y lo dice, en vez de colgarse con una ventana de cien anos', () => {
    const lejos = expandOccurrences(serie({ date: '2026-10-01', recurrence: 'daily' }), {
      from: '2026-10-01',
      to: '2126-10-01'
    });
    expect(lejos.dates).toHaveLength(400);
    expect(lejos.truncated).toBe(true);
  });

  it('sin ventana, `none` contesta su dia y el resto se corta por el maximo', () => {
    expect(expandOccurrences(serie({ date: '2026-10-08', recurrence: 'none' })).dates).toEqual(['2026-10-08']);
    expect(expandOccurrences(serie({ date: '2026-10-08', recurrence: 'daily' }), {}, 3).dates).toEqual([
      '2026-10-08',
      '2026-10-09',
      '2026-10-10'
    ]);
  });
});

describe('calendario — parseExceptionDates', () => {
  it('deja solo las fechas validas, en el orden de llegada y sin repetirlas', () => {
    expect(parseExceptionDates(['2026-10-05', '2026-10-02'])).toEqual(['2026-10-05', '2026-10-02']);
    expect(parseExceptionDates('["2026-10-05","2026-10-05",5,null,"basura"]')).toEqual(['2026-10-05']);
    expect(parseExceptionDates(null)).toEqual([]);
    expect(parseExceptionDates(undefined)).toEqual([]);
    expect(parseExceptionDates('{"no":"es una lista"}')).toEqual([]);
  });
});

describe('calendario — occursOn', () => {
  it('responde por un dia concreto, que es lo que pregunta el «quitar solo este dia»', () => {
    const rule = serie({ date: '2026-10-01', recurrence: 'weekly', exceptions: ['2026-10-15'] });
    expect(occursOn(rule, '2026-10-08')).toBe(true);
    expect(occursOn(rule, '2026-10-15')).toBe(false);
    expect(occursOn(rule, '2026-10-16')).toBe(false);
    expect(occursOn(serie({ date: '2026-10-08', recurrence: 'none' }), '2026-10-08')).toBe(true);
  });
});

const personalizada = (extra: Partial<RecurrenceRule> & { date: string; schedule: RecurrenceSchedule }): RecurrenceRule => ({
  recurrence: 'none',
  ...extra
});

describe('calendario — reglas de repetición estructuradas', () => {
  it('valida frecuencia, intervalo, días ISO y fin inclusivo', () => {
    expect(isRecurrenceSchedule({ frequency: 'daily', interval: 1, end: { type: 'never' } })).toBe(true);
    expect(isRecurrenceSchedule({ frequency: 'weekly', interval: 99, weekdays: [1, 3, 7], end: { type: 'count', count: 999 } })).toBe(true);
    expect(isRecurrenceSchedule({ frequency: 'yearly', interval: 1, end: { type: 'date', date: '2028-02-29' } })).toBe(true);
    expect(isRecurrenceSchedule({ frequency: 'daily', interval: 0, end: { type: 'never' } })).toBe(false);
    expect(isRecurrenceSchedule({ frequency: 'monthly', interval: 100, end: { type: 'never' } })).toBe(false);
    expect(isRecurrenceSchedule({ frequency: 'weekly', interval: 1, weekdays: [0, 8], end: { type: 'never' } })).toBe(false);
    expect(isRecurrenceSchedule({ frequency: 'weekly', interval: 1, weekdays: [], end: { type: 'never' } })).toBe(false);
    expect(isRecurrenceSchedule({ frequency: 'daily', interval: 1, weekdays: [1], end: { type: 'never' } })).toBe(false);
    expect(isRecurrenceSchedule({ frequency: 'daily', interval: 1, end: { type: 'count', count: 1000 } })).toBe(false);
    expect(isRecurrenceSchedule({ frequency: 'daily', interval: 1, end: { type: 'date', date: '2026-02-30' } })).toBe(false);
    expect(isRecurrenceSchedule(null)).toBe(false);
  });

  it('repite cada N días y aplica el fin por cuenta incluyendo la primera ocurrencia', () => {
    const rule = personalizada({
      date: '2026-10-01',
      schedule: { frequency: 'daily', interval: 2, end: { type: 'count', count: 4 } }
    });
    expect(expandOccurrences(rule, { from: '2026-10-03', to: '2026-10-20' }).dates).toEqual([
      '2026-10-03',
      '2026-10-05',
      '2026-10-07'
    ]);
    expect(expandOccurrences({
      ...rule,
      schedule: { frequency: 'daily', interval: 2, end: { type: 'count', count: 1 } }
    }).dates).toEqual([
      '2026-10-01'
    ]);
  });

  it('repite en días ISO elegidos en semanas alternas y mantiene el ancla como límite inferior', () => {
    const rule = personalizada({
      date: '2026-10-01', // jueves: no está seleccionado
      schedule: { frequency: 'weekly', interval: 2, weekdays: [1, 3, 5], end: { type: 'never' } }
    });
    expect(expandOccurrences(rule, { from: '2026-10-01', to: '2026-10-31' }).dates).toEqual([
      '2026-10-02',
      '2026-10-12',
      '2026-10-14',
      '2026-10-16',
      '2026-10-26',
      '2026-10-28',
      '2026-10-30'
    ]);
    expect(expandOccurrences({
      ...rule,
      schedule: { frequency: 'weekly', interval: 1, end: { type: 'never' } }
    }, { from: '2026-10-01', to: '2026-10-08' }).dates).toEqual(['2026-10-01', '2026-10-08']);
    expect(expandOccurrences({
      ...rule,
      schedule: { frequency: 'weekly', interval: 1, weekdays: [7], end: { type: 'never' } }
    }, { from: '2026-10-01', to: '2026-10-11' }).dates).toEqual(['2026-10-04', '2026-10-11']);
  });

  it('incluye la fecha límite y combina una cuenta con varios días semanales', () => {
    const rule = personalizada({
      date: '2026-10-05',
      exceptions: ['2026-10-07'],
      schedule: { frequency: 'weekly', interval: 1, weekdays: [1, 3], end: { type: 'count', count: 4 } }
    });
    expect(expandOccurrences(rule, { from: '2026-10-01', to: '2026-10-20' }).dates).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-14'
    ]);
    expect(expandOccurrences({
      ...rule,
      exceptions: [],
      schedule: { frequency: 'daily', interval: 2, end: { type: 'date', date: '2026-10-05' } }
    }).dates).toEqual(['2026-10-05']);
    expect(expandOccurrences({
      ...rule,
      date: '2026-10-01',
      exceptions: [],
      schedule: { frequency: 'daily', interval: 2, end: { type: 'date', date: '2026-10-05' } }
    }).dates).toEqual(['2026-10-01', '2026-10-03', '2026-10-05']);
  });

  it('repite mensualmente el día inicial cuando existe, omite meses sin ese día y respeta intervalos', () => {
    const monthly31 = personalizada({
      date: '2026-01-31',
      schedule: { frequency: 'monthly', interval: 1, end: { type: 'date', date: '2026-05-31' } }
    });
    expect(expandOccurrences(monthly31, { from: '2026-01-01', to: '2026-12-31' }).dates).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31'
    ]);
    const everyOtherMonth = {
      ...monthly31,
      schedule: { frequency: 'monthly' as const, interval: 2, end: { type: 'never' as const } }
    };
    expect(expandOccurrences(everyOtherMonth, { from: '2026-01-01', to: '2026-07-31' }).dates).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31'
    ]);
  });

  it('repite anualmente en una fecha bisiesta solo en años que la contienen', () => {
    const leapDay = personalizada({
      date: '2024-02-29',
      schedule: { frequency: 'yearly', interval: 1, end: { type: 'count', count: 3 } }
    });
    expect(expandOccurrences(leapDay, { from: '2024-01-01', to: '2032-12-31' }).dates).toEqual([
      '2024-02-29',
      '2028-02-29',
      '2032-02-29'
    ]);
  });

  it('calcula días civiles sin depender del salto horario de primavera', () => {
    const daily = personalizada({
      date: '2026-03-28',
      schedule: { frequency: 'daily', interval: 1, end: { type: 'date', date: '2026-03-31' } }
    });
    expect(expandOccurrences(daily, { from: '2026-03-28', to: '2026-03-31' }).dates).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31'
    ]);
  });

  it('mantiene excepciones, fechas inválidas y el límite de expansión', () => {
    const daily = personalizada({
      date: '2026-10-01',
      exceptions: '["2026-10-02"]',
      schedule: { frequency: 'daily', interval: 1, end: { type: 'never' } }
    });
    expect(expandOccurrences(daily, { from: '2026-10-01', to: '2026-10-03' }).dates).toEqual([
      '2026-10-01',
      '2026-10-03'
    ]);
    expect(expandOccurrences({ ...daily, date: '2026-02-30' }).dates).toEqual([]);
    const bounded = expandOccurrences(daily, { from: '2026-10-01' });
    expect(bounded.dates).toHaveLength(MAX_OCCURRENCES - 1); // La excepción consume límite aunque no se muestre.
    expect(bounded.truncated).toBe(true);
    expect(expandOccurrences({ ...daily, exceptions: [] }, {}, MAX_OCCURRENCES + 1).dates).toHaveLength(MAX_OCCURRENCES);
  });
});
