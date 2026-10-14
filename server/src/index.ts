import { serve } from '@hono/node-server';
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import { config } from './config/app.config.js';
import { getDatabase, initializeDatabase } from './config/database.js';
import { memoryMonitor } from './utils/memory-monitor.js';
import { installConsoleCapture } from './utils/log-store.js';
import { uploadsRoot } from './utils/uploads.js';
import { ensureWorker } from './utils/ticket-queue.js';
import { startHouseholdPlanningAutomationScheduler } from './utils/household-planning-automation.scheduler.js';
import { isolatedHouseholdPlanningSchedulerOptions } from './utils/household-planning-automation.scheduler.runtime.js';
import { createApp, rateLimitFromEnv, resolveStaticDir } from './app.js';

// Install console capture BEFORE anything else so that startup messages
// (including DB init errors) make it into the in-app log viewer.
installConsoleCapture();

const staticDir = resolveStaticDir();
const app = createApp({ rateLimit: rateLimitFromEnv(), staticDir });
let stopPlanningAutomation: (() => Promise<void>) | null = null;
let shutdown: Promise<void> | null = null;

// ═══════════════════════════════════════════════════════════════════
// Server Startup
// ═══════════════════════════════════════════════════════════════════

async function startServer() {
  try {
    await initializeDatabase();
    console.log('[SERVER] ✓ Database initialized');

    const planningAutomation = startHouseholdPlanningAutomationScheduler(
      getDatabase(),
      isolatedHouseholdPlanningSchedulerOptions(process.env)
    );
    stopPlanningAutomation = planningAutomation.stop;
    console.log('[SERVER] ✓ Household planning automation scheduler started');

    ensureWorker();
    console.log('[SERVER] ✓ AI queue started');

    memoryMonitor.start();
    console.log('[SERVER] ✓ Memory monitor started');
    // Donde viven las fotos subidas, en absoluto y una sola vez. Sin esta linea, un 404 de un
    // `img` obliga a adivinar con que `cwd` se arranco el proceso —y ahi se va la tarde.
    console.log(`[SERVER] ✓ Uploads en ${uploadsRoot()}`);

    const port = config.server.port;
    serve(
      {
        fetch: app.fetch,
        port,
        hostname: config.server.host
      },
      (info) => {
        if (process.env.E2E_READY_FILE) {
          writeFileSync(process.env.E2E_READY_FILE, `${process.pid}:${info.port}\n`, {
            flag: 'wx'
          });
        }
        const shown = staticDir ? relative(process.cwd(), staticDir) : null;
        console.log(`
[SERVER] ══════════════════════════════════════════════════════════
[SERVER]   HogarIA Server
[SERVER]   Status:  Running
[SERVER]   Port:    ${info.port}
[SERVER]   Env:     ${config.server.env}
[SERVER]   Web:     ${shown ?? 'API solo (sin estaticos)'}
[SERVER]   PID:     ${process.pid}
[SERVER] ══════════════════════════════════════════════════════════
        `);
      }
    );
  } catch (error) {
    await stopPlanningAutomation?.();
    memoryMonitor.stop();
    console.error('[SERVER] Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown: stop the poller first so in-flight provider work is aborted
// and the scheduler cannot begin another occurrence while the process exits.
function shutdownServer(signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
  if (shutdown) return shutdown;
  console.log(`[SERVER] ${signal} received. Shutting down gracefully...`);
  shutdown = (async () => {
    await stopPlanningAutomation?.();
    memoryMonitor.stop();
    process.exit(0);
  })();
  return shutdown;
}

process.on('SIGTERM', () => void shutdownServer('SIGTERM'));
process.on('SIGINT', () => void shutdownServer('SIGINT'));

startServer();

export default app;
