import {
  clientTimeZone,
  dateLocale,
  daysUntil,
  formatDateTime,
  formatDateTimeWithYear,
  formatDay,
  formatShortDay,
  relativeTimeParts,
  formatTime,
  formatTimePrecise,
  parseDay,
  parseInstant,
  resetClientTimeZone,
  setDateLocale,
  toDayKey,
  timeZoneLabel
} from './time';

/**
 * El parseo y el formato de las horas de toda la app. Se prueban con la zona cambiada a mano
 * porque el fallo que cierran solo aparece con una zona: el server manda `2026-05-04
 * 08:12:30` (UTC, sin decirlo) y el navegador lo leia como hora local, asi que el log decia
 * que la compra fue a las 08:12 cuando en Madrid fueron las 10:12.
 */

/**
 * Las pruebas de zona pasan la zona a mano en vez de tocar `process.env.TZ`: el visor de logs
 * y la caducidad se comprueban en el navegador (Karma), y ahi la zona del proceso no existe.
 */
const MADRID = 'Europe/Madrid';
const TOKYO = 'Asia/Tokyo';

describe('core/time — leer lo que manda la API', () => {
  beforeEach(() => setDateLocale('es-ES'));

  it('un timestamp sin zona es UTC, no la hora del movil', () => {
    const parsed = parseInstant('2026-05-04 08:12:30');
    expect(parsed?.getTime()).toBe(Date.UTC(2026, 4, 4, 8, 12, 30));
    // Y la forma ya normalizada tiene que dar el MISMO instante: si no, la migracion del
    // server habria movido las horas de todo el mundo.
    expect(parseInstant('2026-05-04T08:12:30Z')?.getTime()).toBe(parsed?.getTime());
  });

  it('acepta instantes tipados y rechaza fechas inválidas sin perder el día local', () => {
    const instant = new Date('2026-05-04T08:12:30.000Z');
    expect(parseInstant(instant)).toBe(instant);
    expect(parseInstant(new Date(Number.NaN))).toBeNull();
    expect(parseInstant(0)?.getTime()).toBe(0);
    expect(parseInstant('2026-05-04')?.getTime()).toBe(new Date(2026, 4, 4).getTime());
    expect(parseInstant('fecha rota')).toBeNull();

    expect(parseDay(new Date(2026, 4, 4, 23, 59))).toEqual(new Date(2026, 4, 4));
    expect(parseDay(new Date(Number.NaN))).toBeNull();
    expect(parseDay(new Date(2026, 4, 4).getTime())).toEqual(new Date(2026, 4, 4));
    expect(parseDay('2026-05-04T23:30:00Z')).not.toBeNull();
    expect(parseDay('fecha rota')).toBeNull();
  });

  it('con `Z` o sin ella, la hora se ve en la zona de quien mira', () => {
    expect(formatTime('2026-05-04T08:12:30Z', MADRID)).toBe('10:12');
    expect(formatTime('2026-05-04T08:12:30', MADRID)).toBe('10:12');
    expect(formatTime('2026-05-04T08:12:30Z', 'UTC')).toBe('08:12');
    expect(formatTime('2026-05-04T08:12:30Z', TOKYO)).toBe('17:12');
    // Y por defecto, la detectada: si algun dia se pudiese elegir zona en la app, este seria
    // el unico sitio que habria que tocar.
    expect(formatTime('2026-05-04T08:12:30Z')).toBe(
      formatTime('2026-05-04T08:12:30Z', clientTimeZone())
    );
  });

  it('la fecha lleva la hora detras, y el dia rueda con la zona', () => {
    // Las 22:05 UTC del 4 de mayo son las 00:05 del 5 en Madrid: la hora y el dia tienen que
    // cambiar juntos, porque una lista «de ayer» que hoy ya es de otro dia lo es.
    expect(formatDateTime('2026-05-04T22:05:00Z', MADRID)).toContain('00:05');
    expect(formatDateTime('2026-05-04T22:05:00Z', MADRID)).toContain('5 may');
    expect(formatDateTime('2026-05-04T22:05:00Z', 'UTC')).toContain('22:05');
    expect(formatDateTime('2026-05-04T22:05:00Z', 'UTC')).toContain('4 may');
  });

  it('un dia suelto no es un instante y no se le toca el dia', () => {
    // Es la prueba del yogur: si a `2026-05-04` se le anade una medianoche UTC, en Tokio pasa
    // a ser el dia 5 y la app caduca algo que caduca al dia siguiente.
    expect(toDayKey('2026-05-04', TOKYO)).toBe('2026-05-04');
    expect(toDayKey('2026-05-04', 'UTC')).toBe('2026-05-04');
    expect(parseDay('2026-05-04')?.getDate()).toBe(4);
    expect(parseDay('2026-05-04')?.getHours()).toBe(0);
    expect(formatDay('2026-05-04', TOKYO)).toContain('4 de mayo');
  });

  it('formatea fechas civiles cortas en el idioma de la app sin desplazarlas', () => {
    const previousLocale = dateLocale();
    try {
      setDateLocale('es-ES');
      expect(formatShortDay('2024-03-01')).toBe('1/3/24');
      expect(formatDateTime('2024-03-01T12:00:00Z', 'Pacific/Kiritimati')).toBe('2 mar, 02:00');

      setDateLocale('en-GB');
      expect(formatShortDay('2024-03-01')).toBe('01/03/2024');
      expect(formatDateTime('2024-03-01T12:00:00Z', 'Pacific/Kiritimati')).toBe('2 Mar, 02:00');
      expect(formatShortDay(null)).toBe('');
      expect(formatShortDay('not-a-day')).toBe('');
      expect(formatShortDay('2024-02-30')).toBe('');
    } finally {
      setDateLocale(previousLocale);
    }
  });

  it('usa español por defecto y deja vacíos los valores que no son fechas', () => {
    const previousLocale = dateLocale();
    try {
      setDateLocale(null);
      expect(dateLocale()).toBe('es-ES');
      expect(formatShortDay(0)).toBe('');
      expect(formatTime(null)).toBe('');
      expect(formatDateTime('fecha rota')).toBe('');
      expect(formatDay('')).toBe('');
      expect(formatDateTimeWithYear(null)).toBe('');
      expect(toDayKey('fecha rota')).toBe('');
      expect(daysUntil('fecha rota')).toBeNull();
      expect(formatTimePrecise(null)).toBe('');
    } finally {
      setDateLocale(previousLocale);
    }
  });

  it('un instante SI pertenece al dia de quien lo mira', () => {
    // Las 00:30 del dia 5 en Madrid: en UTC todavia es dia 4.
    expect(toDayKey('2026-05-04T22:30:00Z', MADRID)).toBe('2026-05-05');
    expect(toDayKey('2026-05-04T22:30:00Z', 'UTC')).toBe('2026-05-04');
    expect(formatDay('2026-05-04T22:30:00Z', TOKYO)).toContain('5 de mayo');
  });

  it('mantiene el día local si el motor rechaza el identificador de zona', () => {
    expect(toDayKey('2026-05-04T08:12:30Z', 'Zona/Invalida')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('el visor de logs ve los milisegundos en la hora local', () => {
    expect(formatTimePrecise('2026-05-04T08:12:30.412Z', MADRID)).toBe('10:12:30.412');
    // Un texto que no es una fecha se devuelve tal cual: un log raro no se pierde por
    // intentarlo formatear.
    expect(formatTimePrecise('sin marca temporal')).toBe('sin marca temporal');
  });

  it('los dias hasta la caducidad se cuentan en dias naturales', () => {
    // Las 23:00 del propio dia de caducidad siguen siendo «hoy», no «caducado»: es el fallo
    // que tenia la cuenta de milisegundos.
    const now = new Date(2026, 4, 4, 23, 0, 0);
    expect(daysUntil('2026-05-04', now)).toBe(0);
    expect(daysUntil('2026-05-03', now)).toBe(-1);
    expect(daysUntil('2026-05-07', now)).toBe(3);
    expect(daysUntil(null, now)).toBeNull();
  });

  it('el tiempo relativo dice lo que espera una persona, y en futuro si toca', () => {
    const now = new Date(2026, 4, 4, 12, 0, 0);
    // Aqui se prueba el reparto en partes; la frase («hace 5 min» / «5 min ago») la compone el idioma, en
    // `I18nService.relativeTime`, y se ve en los e2e de la lista de la compra.
    expect(relativeTimeParts(new Date(now.getTime() - 30_000).toISOString(), now)).toEqual({
      kind: 'now'
    });
    expect(relativeTimeParts(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toEqual({
      kind: 'ago',
      amount: 5,
      unit: 'min'
    });
    expect(relativeTimeParts(new Date(now.getTime() - 95 * 60_000).toISOString(), now)).toEqual({
      kind: 'ago',
      amount: 2,
      unit: 'h'
    });
    expect(relativeTimeParts(new Date(now.getTime() - 3 * 86_400_000).toISOString(), now)).toEqual({
      kind: 'ago',
      amount: 3,
      unit: 'd'
    });
    // A la una de la madrugada de manana: «en 22 h», no «hace 0 min».
    expect(relativeTimeParts(new Date(now.getTime() + 22 * 3_600_000).toISOString(), now)).toEqual({
      kind: 'in',
      amount: 22,
      unit: 'h'
    });
    const lejano = relativeTimeParts('2026-03-01T12:00:00Z', now);
    expect(lejano.kind).toBe('date');
    if (lejano.kind === 'date') expect(lejano.day.toLowerCase()).toContain('mar');
    expect(relativeTimeParts('', now)).toEqual({ kind: 'none' });
    expect(relativeTimeParts(null, now)).toEqual({ kind: 'none' });
  });

  it('clasifica futuros cortos y muestra el año cuando una fecha queda lejos', () => {
    const now = new Date(2026, 4, 4, 12, 0, 0);
    expect(relativeTimeParts(new Date(now.getTime() + 5 * 60_000), now)).toEqual({
      kind: 'in',
      amount: 5,
      unit: 'min'
    });
    expect(relativeTimeParts(new Date(now.getTime() + 3 * 86_400_000), now)).toEqual({
      kind: 'in',
      amount: 3,
      unit: 'd'
    });
    const distant = relativeTimeParts('2025-03-01T12:00:00Z', now);
    expect(distant.kind).toBe('date');
    if (distant.kind === 'date') expect(distant.year).toBe('25');
  });

  it('la zona se detecta: un nombre IANA, y en el encabezado se dice en cristiano', () => {
    // Un nombre IANA o `UTC` en un proceso sin zona: lo que no vale es el vacio, que es lo que
    // sale cuando alguien intenta adivinar la zona en vez de preguntarsela a `Intl`.
    expect(clientTimeZone().length).toBeGreaterThan(1);
    // `timeZoneLabel` recorta el prefijo: lo que interesa es la ciudad, no el continente.
    const tail = clientTimeZone().split('/').pop() ?? '';
    expect(timeZoneLabel()).toBe(tail.replace(/_/g, ' '));
    resetClientTimeZone();
  });
});
