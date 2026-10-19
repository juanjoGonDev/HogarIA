import type { Page, Request } from '@playwright/test';

/**
 * Vigilante de peticiones para el job de stack completo.
 *
 * Nace de dos fallos que ninguna prueba veia:
 *
 *  1. Un `computed` que se alimentaba de los datos que el propio efecto de carga
 *     escribia: cada respuesta provocaba la siguiente peticion, y el servidor cortaba
 *     con 429. En la pantalla, «tarda en cargar»; en los logs, nada.
 *  2. El `EventSource` del visor de logs reintentando una vez por segundo para siempre
 *     cuando el stream no cuaja. Sumado a (1), el cupo compartido por IP dejaba a toda
 *     la casa sin poder navegar —incluido el visor con el que se podia averiguar por
 *     que.
 *
 * Los dos tienen la misma firma medible desde fuera: la MISMA URL repetida muchas veces
 * en poco tiempo. Por eso eso es lo que se corta aqui, y no un numero global de
 * peticiones, que varia segun lo que haga cada test.
 */

export type RequestEntry = {
  url: string;
  method: string;
  at: number;
  status?: number;
};

export type Burst = {
  url: string;
  count: number;
  firstAt: number;
  lastAt: number;
};

export type WatchOptions = {
  /** Ventana en la que se cuentan repeticiones de la misma URL. */
  windowMs?: number;
  /** Repeticiones de una misma URL dentro de la ventana antes de considerar bucle. */
  maxPerUrl?: number;
  /** Rutas excluidas de la medición, además de los assets estáticos predeterminados. */
  ignore?: RegExp;
};

const DEFAULTS = {
  windowMs: 1500,
  maxPerUrl: 3,
  ignore: /\.(js|css|svg|png|woff2?|ico|json)(\?|$)/
};
const SENSITIVE_QUERY_SUFFIX =
  /(?:token|key|secret|password|credentials?|authorization|signature|jwt)$/;

/** Keep failure diagnostics useful without printing tokens or credential-bearing URLs. */
export function redactRequestUrl(rawUrl: string): string {
  try {
    const prefix = rawUrl.match(/^[A-Z]+\s+/i)?.[0] ?? '';
    const url = new URL(rawUrl.slice(prefix.length));
    url.username = '';
    url.password = '';
    for (const key of url.searchParams.keys()) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (SENSITIVE_QUERY_SUFFIX.test(normalized)) url.searchParams.set(key, 'REDACTED');
    }
    return `${prefix}${url.toString()}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Agrupa por URL y marca los tramos con demasiadas repeticiones seguidas.
 *
 * Se compara por URL completa (con query), porque `?from=2026-09-01&to=2026-09-30` y
 * `?from=2026-10-01...` son dos rangos distintos y no un bucle: el bucle es pedir el
 * MISMO rango otra vez.
 */
export function findBursts(entries: RequestEntry[], options: WatchOptions = {}): Burst[] {
  const { windowMs, maxPerUrl } = { ...DEFAULTS, ...options };
  const byUrl = new Map<string, number[]>();
  for (const entry of entries) {
    const list = byUrl.get(entry.url) ?? [];
    list.push(entry.at);
    byUrl.set(entry.url, list);
  }

  const bursts: Burst[] = [];
  for (const [url, times] of byUrl) {
    times.sort((a, b) => a - b);
    let start = 0;
    for (let end = 0; end < times.length; end += 1) {
      while (times[end] - times[start] > windowMs) start += 1;
      if (end - start + 1 > maxPerUrl) {
        bursts.push({ url, count: end - start + 1, firstAt: times[start], lastAt: times[end] });
        break; // Con un tramo detectado basta: el detalle se ve en el log del test.
      }
    }
  }
  return bursts;
}

export type RequestWatch = {
  entries: () => RequestEntry[];
  throttled: () => RequestEntry[];
  bursts: (options?: WatchOptions) => Burst[];
  reset: () => void;
  /** El mensaje de error, ya formado, para poder afirmarlo con contexto util. */
  describeProblems: (options?: WatchOptions) => string;
};

/**
 * Engancha la pagina y devuelve el estado. Se empieza a contar desde cero en cada test,
 * y el `status` se rellena al terminar la respuesta para poder afirmar el 429.
 */
export function watchRequests(page: Page, options: WatchOptions = {}): RequestWatch {
  const { ignore } = { ...DEFAULTS, ...options };
  const entries: RequestEntry[] = [];
  const pending = new Map<string, RequestEntry>();

  const keyOf = (request: Request) =>
    `${request.method()} ${request.url()} ${request.frame().url()}`;

  page.on('request', (request) => {
    if (ignore.test(request.url())) return;
    const entry: RequestEntry = {
      url: `${request.method()} ${redactRequestUrl(request.url())}`,
      method: request.method(),
      at: Date.now()
    };
    entries.push(entry);
    pending.set(keyOf(request), entry);
  });

  page.on('requestfinished', async (request) => {
    const entry = pending.get(keyOf(request));
    if (!entry) return;
    pending.delete(keyOf(request));
    try {
      entry.status = (await request.response())?.status();
    } catch {
      /* la respuesta ya no esta: se queda sin status y no pasa nada */
    }
  });

  return {
    entries: () => entries.slice(),
    throttled: () => entries.filter((entry) => entry.status === 429),
    bursts: (more) => findBursts(entries, { ...options, ...more }),
    reset: () => {
      entries.length = 0;
    },
    describeProblems: (more) => {
      const problems = [
        ...findBursts(entries, { ...options, ...more }).map(
          (burst) =>
            `${burst.count}x ${redactRequestUrl(burst.url)} en ${burst.lastAt - burst.firstAt} ms`
        ),
        ...entries
          .filter((entry) => entry.status === 429)
          .map((entry) => `429 ${redactRequestUrl(entry.url)}`)
      ];
      return problems.length > 0 ? problems.join('\n') : 'sin rachas ni 429';
    }
  };
}
