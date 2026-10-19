/**
 * In-memory ring buffer holding the last N log entries for display in the
 * in-app logs terminal. Captures both server-side output and forwarded
 * browser logs.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'log';
export type LogSource = 'server' | 'browser';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  stack?: string;
  url?: string;
  meta?: string;
}

const MAX_LOGS = 1500;
const recentLogs: LogEntry[] = [];

const listeners = new Set<(entry: LogEntry) => void>();

/**
 * Suscripcion a la cola de logs. El visor de la aplicacion vive de esto: sin un unico
 * punto de salida, cada escritor (el `console` capturado, los logs que manda el
 * navegador, un `addServerLog`) tiene que acordarse de avisar al SSE, y el que no se
 * acuerda produce una pantalla de logs que no se mueve.
 *
 * Devuelve la funcion para cancelar; el listener se llama con `try/catch` porque un
 * cliente que cierra la pestana a media escritura no puede cortar el log del servidor.
 */
export function onLogEntry(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function addLog(entry: LogEntry): void {
  recentLogs.push(entry);
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.splice(0, recentLogs.length - MAX_LOGS);
  }
  // Copia del Set: un listener que se desuscribe a si mismo (el ultimo cliente del
  // stream yéndose mientras se escribe) no tiene por que romper el bucle.
  for (const listener of [...listeners]) {
    try {
      listener(entry);
    } catch {
      /* un oyente caido no se propaga */
    }
  }
}

export function getLogs(options: {
  limit?: number;
  level?: string;
  source?: string;
  since?: string;
} = {}): LogEntry[] {
  const limit = options.limit ?? 500;
  let filtered = recentLogs.slice();

  if (options.level) {
    filtered = filtered.filter(l => l.level === options.level);
  }
  if (options.source) {
    filtered = filtered.filter(l => l.source === options.source);
  }
  if (options.since) {
    const t = Date.parse(options.since);
    if (!Number.isNaN(t)) {
      filtered = filtered.filter(l => Date.parse(l.timestamp) >= t);
    }
  }

  // Most recent first for the "tail" view
  filtered.reverse();
  return filtered.slice(0, limit);
}

export function totalLogs(): number {
  return recentLogs.length;
}

export function clearLogs(): void {
  recentLogs.length = 0;
}

// ANSI escape stripper so stored messages are clean plain text
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

function formatMessage(...args: unknown[]): string {
  return args
    .map(a => {
      if (typeof a === 'string') return stripAnsi(a);
      if (a instanceof Error) return stripAnsi(a.stack || a.message);
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    })
    .join(' ');
}

/**
 * Patch global console so that every server-side console[log|info|warn|error]
 * ends up in the ring buffer (as well as the terminal).
 */
export function installConsoleCapture(): void {
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  function wrap(level: LogLevel, fn: (...args: unknown[]) => void) {
    return (...args: unknown[]) => {
      fn(...args);
      const message = formatMessage(...args);
      // Avoid noisy empty lines
      if (!message.trim()) return;
      addLog({
        timestamp: new Date().toISOString(),
        level,
        source: 'server',
        message,
      });
    };
  }

  console.log = wrap('log', original.log);
  console.info = wrap('info', original.info);
  console.warn = wrap('warn', original.warn);
  console.error = wrap('error', original.error);
  console.debug = wrap('debug', original.debug);
}
