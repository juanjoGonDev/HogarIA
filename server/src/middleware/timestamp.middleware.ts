import type { MiddlewareHandler } from 'hono';

/**
 * Normaliza las marcas temporales a la salida de la API.
 *
 * SQLite guarda `CURRENT_TIMESTAMP` en UTC sin decirlo (`2026-05-04 08:12:30`). Entregada
 * asi, `new Date(...)` en el navegador la interpreta como hora LOCAL del dispositivo, y en
 * Espana eso es una diferencia de una o dos horas: el log decia que Ana compro a las 20:12
 * cuando fue a las 21:12. La solucion es de una letra —anadir la `Z`— pero tiene que ocurrir
 * en UN sitio, y ese sitio es el borde de la API: el almacenamiento ya esta bien (UTC) y las
 * pantallas no tienen que saber en que zona escribe el server.
 */

/** `2026-05-04 08:12:30`, con o sin fraccion, separador espacio o `T`, y sin zona. */
const NAIVE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;

/**
 * Solo las claves que hablan de un instante. El filtro importa: una nota escrita a mano
 * («avisar el 2026-05-04 08:12:30») tiene el mismo aspecto que un timestamp y no es uno, y
 * reescribirla corromperia lo que el usuario tecleó.
 */
function isTimeKey(key: string): boolean {
  return /(?:^|_)(?:created|updated|deleted|observed|completed|expires|seen|taken|saved|at|time|timestamp)(?:_|$)$/i.test(
    key
  ) || /^(?:[a-z]+)?(?:At|Time|Timestamp)$/.test(key);
}

export function zoneStampValue(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    if (!key || !isTimeKey(key)) return value;
    const match = NAIVE_TIMESTAMP.exec(value);
    if (!match) return value;
    const [, year, month, day, hour, minute, second, fraction] = match;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ?? ''}Z`;
  }
  if (Array.isArray(value)) return value.map((entry) => zoneStampValue(entry, key));
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = zoneStampValue(child, childKey);
    }
    return out;
  }
  return value;
}

/**
 * Las respuestas van por texto, no por objeto: reconstruir el `Response` con el objeto ya
 * normalizado seria reescribir el JSON que `prettyJSON` formateó, y salir del paso tocando
 * solo lo que hace falta es mas pequeno que reserializar una respuesta de medio megabyte.
 */
export function timestampMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const response = c.res;
    const contentType = response.headers.get('content-type') ?? '';
    // El stream de eventos (SSE) y los ficheros subidos no son JSON: no se tocan.
    if (!contentType.includes('application/json')) return;
    const text = await response.text();
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    // Se conserva el formato que traia la respuesta: con `prettyJSON` activado, reescribir
    // compacto quitaria los saltos de linea de todo lo que lleve un timestamp.
    const stamped = JSON.stringify(zoneStampValue(parsed), null, text.includes('\n"') ? 2 : undefined);
    // El cuerpo ya esta leido, asi que HAY que devolver una respuesta nueva aunque el texto
    // no cambie: reutilizar la vieja deja el body consumido y quien llama ve
    // «Body is unusable». Y el Content-Length se recalcula, porque la cabecera vieja mentiria
    // sobre el cuerpo nuevo.
    c.res = new Response(stamped, { status: response.status, statusText: response.statusText, headers: response.headers });
    c.res.headers.set('Content-Length', String(Buffer.byteLength(stamped)));
  };
}
