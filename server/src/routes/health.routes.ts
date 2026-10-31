import { Hono } from 'hono';
import { memoryMonitor } from '../utils/memory-monitor.js';
import os from 'os';

const healthRoutes = new Hono();

function imageRevision(): string {
  const revision = process.env.HOGARIA_IMAGE_REVISION?.trim();
  return revision || 'dev';
}

healthRoutes.get('/', (c) => {
  const memUsage = process.memoryUsage();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const usagePercent = Math.round((1 - freeMem / totalMem) * 100);

  const status = usagePercent > 90 ? 'critical' : usagePercent > 80 ? 'warning' : 'ok';

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      systemFree: Math.round(freeMem / 1024 / 1024) + 'MB',
      systemTotal: Math.round(totalMem / 1024 / 1024) + 'MB',
      systemUsage: usagePercent + '%'
    },
    version: '1.0.0',
    imageRevision: imageRevision()
  });
});

healthRoutes.get('/detailed', (c) => {
  const stats = memoryMonitor.getStats();
  const cpus = os.cpus();

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: stats,
    cpu: {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      loadAverage: os.loadavg()
    },
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    imageRevision: imageRevision()
  });
});

export { healthRoutes };
