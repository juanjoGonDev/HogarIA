import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppEnv } from '../types/hono-env.js';
import { addLog, getLogs, totalLogs, clearLogs, onLogEntry, LogEntry } from '../utils/log-store.js';

const logRoutes = new Hono<AppEnv>();

// Clients subscribed to live logs via SSE
const sseClients = new Set<(entry: LogEntry) => void>();

// La cola de logs es la que avisa: ASI lo que se escribe por `console`, lo que manda el
// navegador y lo que anade el servidor llegan todos al stream. Antes el aviso vivia en un
// `record()` local, y todo lo que no pasaba por el (practicamente todo el servidor) se
// quedaba fuera de la pantalla: el visor parecia muerto y habia que recargar.
onLogEntry((entry) => {
  for (const send of sseClients) {
    try {
      send(entry);
    } catch {
      /* el cliente se fue a media escritura: el resto sigue */
    }
  }
});

// GET /api/logs/stream - Server-Sent Events stream of live logs
//
// `streamSSE`, no `stream()`: el segundo devuelve `text/plain` y `EventSource` aborta la conexion con
// ese MIME en la nariz (el visor se quedaba en «Reintentando» para siempre). `streamSSE` pone
// `text/event-stream` y las cabeceras de no-cache por si solas. En desarrollo nadie lo vio porque la
// suite de desarrollo no mira esta pantalla: es exactamente lo que caza el job full-stack.
logRoutes.get('/stream', (c) => {
  // nginx (el contenedor) rebotaria el stream sin esto; el resto de cabeceras las pone `streamSSE`.
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    let finished = false;
    const send = (entry: LogEntry) => {
      if (finished) return;
      void stream.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    sseClients.add(send);

    // Connected event
    void stream.write(`: connected\n`);
    void stream.write(`data: ${JSON.stringify({ type: 'connected', total: totalLogs() })}\n\n`);

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (finished) return;
      void stream.write(`: ping\n`);
    }, 15000);

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearInterval(heartbeat);
        sseClients.delete(send);
        resolve();
      };

      c.req.raw.signal.addEventListener('abort', cleanup);

      // Safety: if the stream's close fires, clean up
      stream.onAbort?.(cleanup);
    });
  });
});

// POST /api/logs - Receive browser console logs
logRoutes.post('/', async (c) => {
  try {
    const body = await c.req.json();

    const entry: LogEntry = {
      timestamp: body.timestamp || new Date().toISOString(),
      level: body.level || 'error',
      source: 'browser',
      message: body.message || '',
      stack: body.stack,
      url: body.url
    };

    addLog(entry);

    return c.json({ success: true });
  } catch {
    return c.json({ success: false }, 400);
  }
});

// GET /api/logs - Get recent logs (supports ?limit, ?level, ?source, ?since)
logRoutes.get('/', (c) => {
  const limit = Number(c.req.query('limit')) || 500;
  const level = c.req.query('level');
  const source = c.req.query('source');
  const since = c.req.query('since');

  const logs = getLogs({ limit, level, source, since });

  return c.json({
    success: true,
    data: {
      logs,
      total: totalLogs()
    }
  });
});

// DELETE /api/logs - Clear logs
logRoutes.delete('/', (c) => {
  clearLogs();
  return c.json({ success: true, message: 'Logs cleared' });
});

// Public helper for server code to add entries that are also broadcast.
export function addServerLog(level: string, message: string, stack?: string): void {
  addLog({
    timestamp: new Date().toISOString(),
    level: (level as LogEntry['level']) || 'info',
    source: 'server',
    message,
    stack
  });
}

export { logRoutes };
