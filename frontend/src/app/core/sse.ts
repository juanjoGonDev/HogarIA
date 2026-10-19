/**
 * Cliente SSE con reintentos, para las dos pantallas que oyen al servidor: el visor de
 * logs y la lista de la compra en vivo.
 *
 * El `EventSource` del navegador reconecta SOLO, para siempre y a un ritmo fijo. Eso
 * parece tolerancia a los fallos, y en realidad es un martillo: si la URL no funciona
 * (el proxy del dev server corta el `text/event-stream`, el token de la query ha
 * caducado, el contenedor esta reiniciando), cada pestana abierta empieza a pedir la
 * reconexion cada segundo. Multiplicado por tres pestañas y por el resto de la app, eso
 * es el «Demasiadas solicitudes» que bloqueaba hasta el visor de logs —es decir, la
 * unica pantalla con la que se podia descubrir lo que pasaba.
 *
 * Aqui la reconexión es nuestra: crece (1 s, 2, 5, 10, 30) hasta rendirse y decirlo. Un
 * estado visible en la pantalla vale mas que veinte intentes por minuto. Y con la pestana
 * oculta no se reintenta: nadie mira los logs de una ventana que no esta.
 */

export type StreamStatus = 'connecting' | 'live' | 'retrying' | 'closed';

export type StreamOptions = {
  /** Nombres de evento adicionales al `message` por defecto (SSE usa `change`, `ready`…). */
  events?: string[];
  onMessage: (data: string, name: string) => void;
  onStatus?: (status: StreamStatus, detail: { attempt: number; retryInMs: number | null }) => void;
  /** Maximo de reintentos antes de declararse `closed`. Con 10 se cubren ~3 minutos. */
  maxRetries?: number;
  /** Inyectable para el test; en la app es el `EventSource` global. */
  sourceFactory?: (url: string) => EventSourceLike;
};

export type EventSourceLike = {
  onopen: ((this: unknown, ev: unknown) => void) | null;
  onerror: ((this: unknown, ev: unknown) => void) | null;
  onmessage: ((this: unknown, ev: { data: string }) => void) | null;
  addEventListener?: (type: string, listener: (ev: { data: string }) => void) => void;
  close: () => void;
};

export type StreamHandle = {
  close: () => void;
  status: () => StreamStatus;
};

const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];

/** Cuanto se espera tras el enesimo fallo. Se pasa de la tabla y se queda en el maximo. */
export function nextDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  return BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
}

export function openResilientStream(url: string, options: StreamOptions): StreamHandle {
  const maxRetries = options.maxRetries ?? 10;
  const factory = options.sourceFactory ?? ((target: string) => new EventSource(target) as unknown as EventSourceLike);
  const names = options.events ?? [];

  let status: StreamStatus = 'connecting';
  let attempt = 0;
  let source: EventSourceLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closedByUs = false;
  let retryInMs: number | null = null;

  const report = (): void => options.onStatus?.(status, { attempt, retryInMs });

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    retryInMs = null;
  };

  const attach = (target: EventSourceLike): void => {
    target.onopen = () => {
      // Reconectado: la cuenta atras empieza de cero, que es la diferencia entre
      // «el server tardo 40 s en volver» y «el server no vuelve».
      attempt = 0;
      clearTimer();
      status = 'live';
      report();
    };
    target.onerror = () => {
      if (closedByUs) return;
      // El navegador seguiria reintentando a su aire: se corta la conexion YA y se
      // decide cuando volver.
      target.close();
      source = null;
      attempt += 1;
      if (attempt > maxRetries) {
        status = 'closed';
        retryInMs = null;
        report();
        return;
      }
      retryInMs = nextDelay(attempt);
      status = 'retrying';
      report();
      timer = setTimeout(connect, retryInMs);
    };
    target.onmessage = (event) => options.onMessage(event.data, 'message');
    for (const name of names) {
      target.addEventListener?.(name, (event) => options.onMessage(event.data, name));
    }
  };

  function connect(): void {
    if (closedByUs) return;
    clearTimer();
    if (status !== 'live') status = 'connecting';
    report();
    source = factory(url);
    attach(source);
  }

  const onVisibility = (): void => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      // Oculta: se suelta la conexion y se deja de gastar. Al volver, un unico intento
      // inmediato —no una tanda, que es lo que produce cuando tres pestañas despiertan.
      clearTimer();
      source?.close();
      source = null;
      return;
    }
    if (status === 'live') return;
    attempt = 0;
    connect();
  };

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  connect();

  return {
    status: () => status,
    close: () => {
      closedByUs = true;
      clearTimer();
      source?.close();
      source = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      status = 'closed';
      report();
    }
  };
}
