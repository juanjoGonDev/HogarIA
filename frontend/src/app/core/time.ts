/**
 * Tiempos: una sola forma de leer los que manda el server y de enseñarlos.
 *
 * El servidor guarda UTC y entrega ISO con `Z`. El sitio donde se rompio la hora siempre fue
 * el mismo: cada pantalla hacia su `new Date(valor)` y su `getHours()`. Con la zona en la
 * cadena eso ya funciona, pero solo si nadie vuelve a inventarse un parseo — asi que la
 * deteccion, el parseo y el formato viven aqui.
 *
 * Dos reglas que no se pueden mezclar:
 *  - Un INSTANTE (`2026-05-04T08:12:30Z`) se muestra en la zona del dispositivo.
 *  - Un DIA de calendario (`2026-05-04`) es un dia, no un instante: nunca se le añade una hora
 *    UTC, porque eso desplaza el dia medio dia y pinta «caducado» el yogur que caduca manana.
 */

const NAIVE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Cadena de tipo `Date` de ISO, con o sin fraccion, y sin zona. */
export type TimeInput = string | number | Date | null | undefined;

/**
 * El idioma con el que se escriben las fechas y las horas, y no es el del navegador: es el de la app.
 * Vive aqui, junto a los formateadores, y quien lo cambia es `I18nService` al resolver el idioma —la
 * direccion de la dependencia importa: `time.ts` es puro y lo llaman cuatro plantillas, y un servicio no
 * puede estar detras de una funcion de formato.
 *
 * Sin esto, pasar la app a ingles dejaba «4 de mayo de 2026» y «lun» en castellano: el diccionario no
 * puede traducir lo que no pasa por el diccionario, y una fecha no es una clave.
 */
let formatoLocale = 'es-ES';

export function setDateLocale(tag: string | null | undefined): void {
  formatoLocale = tag || 'es-ES';
}

/** Lo que esperan `Intl`: `es-ES` o `en-GB`. Se lee en cada formato, no se cachea por llamada. */
export function dateLocale(): string {
  return formatoLocale;
}

let zone: string | null = null;

/**
 * La zona detectada del navegador. No hay ajuste en Preferencias a proposito: lo que alguien
 * quiere es ver la hora de su reloj, y un menu para decir donde esta su casa es una forma de
 * equivocarse. Se cachea porque `Intl` se llama una vez por fila de cada lista.
 */
export function clientTimeZone(): string {
  if (zone) return zone;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    zone = 'UTC';
  }
  return zone;
}

/** Solo para pruebas: el cache no debe sobrevivir a un cambio de zona en el proceso. */
export function resetClientTimeZone(): void {
  zone = null;
}

/** `Europe/Madrid` -> `Madrid`; el nombre tecnico completo no lo lee nadie. */
export function timeZoneLabel(): string {
  const parts = clientTimeZone().split('/');
  return (parts[parts.length - 1] ?? '').replace(/_/g, ' ');
}

/**
 * Un instante a partir de lo que manda la API. Si llega sin zona se asume UTC —que es lo que
 * escribe SQLite— y no la hora local, que es justo el bug que esto cierra.
 */
export function parseInstant(value: TimeInput): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value);
  const text = String(value).trim();
  if (NAIVE_TIMESTAMP.test(text)) return new Date(`${text.replace(' ', 'T')}Z`);
  const day = DAY_ONLY.exec(text);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Un dia de calendario como fecha local. `null` si no hay nada que pintar. */
export function parseDay(value: TimeInput): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === 'number') return parseDay(new Date(value));
  const text = String(value).trim();
  const day = DAY_ONLY.exec(text);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const instant = parseInstant(text);
  if (!instant) return null;
  return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

/**
 * Los formateadores se construyen perezosamente y por zona, no al cargar el modulo: la zona se
 * puede enterar despues de importar (y en las pruebas cambia entre casos), y dejarlos arriba
 * del todo anclaria la primera hora del dia a la zona que hubiera al arrancar la pestana.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function clock(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, cached);
  }
  return cached;
}

/**
 * `20:12`, en la zona del dispositivo. La zona se puede pasar a mano: no hay ajuste en la app
 * (nadie tiene que decir donde vive), pero si hay que poder escribir una prueba que no dependa
 * del navegador que la ejecuta.
 */
export function formatTime(value: TimeInput, timeZone?: string): string {
  const date = parseInstant(value);
  return date
    ? clock(dateLocale(), {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: timeZone ?? clientTimeZone()
      }).format(date)
    : '';
}

/** `4 may, 20:12` — lo que necesita una fila de lista o un suceso de auditoria. */
export function formatDateTime(value: TimeInput, timeZone?: string): string {
  const date = parseInstant(value);
  return date
    ? clock(dateLocale(), {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: timeZone ?? clientTimeZone()
      }).format(date)
    : '';
}

/** `4 de mayo de 2026`. Un dia, sin hora: es lo que se lee en una caducidad. */
export function formatDay(value: TimeInput, timeZone?: string): string {
  // Un dia suelto se lee como dia; con un `Date` o un instante hay que mirar la zona.
  const text = typeof value === 'string' ? value : null;
  const date = text && DAY_ONLY.test(text) ? parseDay(text) : parseInstant(value);
  return date
    ? clock(dateLocale(), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: timeZone ?? clientTimeZone()
      }).format(date)
    : '';
}

/**
 * Una fecha civil corta (`YYYY-MM-DD`), sin convertirla en instante ni desplazarla de día por zona.
 * La subida de un ticket sí usa `formatDateTime`; la fecha impresa del recibo no tiene hora.
 */
export function formatShortDay(value: TimeInput): string {
  if (typeof value !== 'string') return '';
  const match = DAY_ONLY.exec(value.trim());
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return '';

  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }

  return clock(dateLocale(), { dateStyle: 'short', timeZone: 'UTC' }).format(date);
}

/**
 * `20:12:30.412` para el visor de logs, donde los milisegundos son la diferencia entre dos
 * lineas que parecen el mismo instante.
 */
export function formatTimePrecise(value: TimeInput, timeZone?: string): string {
  const date = parseInstant(value);
  if (!date) return value ? String(value) : '';
  const clock2 = clock(dateLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: timeZone ?? clientTimeZone()
  });
  // Los milisegundos van a mano: no todos los motores de `Intl` aceptan
  // `fractionalSecondDigits`, y perderlos pintaria dos lineas del log con la misma hora
  // exactamente igual. No dependen de la zona, son el resto del instante.
  return `${clock2.format(date)}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * El dia en la clave que entienden el `<input type="date">` y la API: `YYYY-MM-DD`. Un dia
 * suelto se devuelve tal cual; un instante se convierte al dia que ES en la zona dada, que es
 * lo que `toISOString()` hacia mal.
 */
export function toDayKey(value: TimeInput, timeZone?: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (DAY_ONLY.test(text)) return text;
  const date = parseInstant(value);
  if (!date) return '';
  return joinDay(dayParts(date, timeZone ?? clientTimeZone()));
}

function dayParts(date: Date, timeZone: string): { year: string; month: string; day: string } {
  try {
    const parts = clock('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const result = { year: get('year'), month: get('month'), day: get('day') };
    if (result.year && result.month && result.day) return result;
  } catch {
    // Zona desconocida (un navegador recortado): se usa la local, que es lo que quiere la pantalla.
  }
  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0')
  };
}

function joinDay(parts: { year: string; month: string; day: string }): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Dias naturales hasta una fecha (negativo = pasado). Se cuentan dias de calendario, no
 * milisegundos: a las 23:00 del dia de la caducidad quedan «0 dias», no «-0,04».
 */
export function daysUntil(value: TimeInput, now: Date = new Date()): number | null {
  const target = parseDay(value);
  if (!target) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * De una marca de tiempo a «lo cerca que está», sin palabras. `core/time.ts` es un modulo puro: no ve el
 * idioma, y no debe empezar a verlo. Aqui se decide el numero y la unidad; la frase la compone
 * `I18nService.relativeTime`, que es donde vive el idioma. Hace falta la frase entera y no un prefijo: en
 * ingles el numero va delante («3 d ago»), y pegar «hace » delante de una cifra es el error clasico.
 */
export type RelativeTimeParts =
  | { kind: 'none' }
  | { kind: 'now' }
  | { kind: 'ago' | 'in'; amount: number; unit: 'min' | 'h' | 'd' }
  | { kind: 'date'; day: string; year: string | null };

export function relativeTimeParts(value: TimeInput, now: Date = new Date()): RelativeTimeParts {
  const date = parseInstant(value);
  if (!date) return { kind: 'none' };
  const signed = now.getTime() - date.getTime();
  // Un minuto redondeado a 1 no es «ahora»: en una fila de lista, «hace 1 min» y «ahora» son
  // la diferencia entre mirar el movil o no.
  if (Math.abs(signed) < 60_000) return { kind: 'now' };
  const amount = Math.round(Math.abs(signed) / 60_000);
  if (amount < 60) return { kind: signed < 0 ? 'in' : 'ago', amount, unit: 'min' };
  if (amount < 60 * 24)
    return { kind: signed < 0 ? 'in' : 'ago', amount: Math.round(amount / 60), unit: 'h' };
  if (amount < 60 * 24 * 7)
    return { kind: signed < 0 ? 'in' : 'ago', amount: Math.floor(amount / (60 * 24)), unit: 'd' };
  const day = clock(dateLocale(), {
    day: 'numeric',
    month: 'short',
    timeZone: clientTimeZone()
  }).format(date);
  const year =
    date.getFullYear() === now.getFullYear() ? null : String(date.getFullYear()).slice(2);
  return { kind: 'date', day, year };
}

/** La fecha con la hora detras, para cuando «ayer» ya no aclara nada. */
export function formatDateTimeWithYear(
  value: TimeInput,
  now: Date = new Date(),
  timeZone?: string
): string {
  const date = parseInstant(value);
  if (!date) return '';
  const day = formatDay(date, timeZone);
  const withClock = `${day}, ${formatTime(date, timeZone)}`;
  return date.getFullYear() === now.getFullYear()
    ? withClock
    : `${withClock}, ${date.getFullYear()}`;
}
