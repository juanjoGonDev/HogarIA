import { Hono } from 'hono';
import { memoryMonitor } from '../utils/memory-monitor.js';
import os from 'os';

const healthRoutes = new Hono();

healthRoutes.get('/', (c) => {
  c.header('Cache-Control', 'no-store');
  const memUsage = process.memoryUsage();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const usagePercent = Math.round((1 - freeMem / totalMem) * 100);

  const status = usagePercent > 90 ? 'critical' : usagePercent > 80 ? 'warning' : 'ok';

  const configuredImageRef = process.env.APP_IMAGE_REF?.trim();
  const imageRef =
    configuredImageRef && /^ghcr\.io\/[a-z0-9._/-]+:[a-z0-9._-]+$/i.test(configuredImageRef)
      ? configuredImageRef
      : 'local-unpublished';

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    imageRef,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      systemFree: Math.round(freeMem / 1024 / 1024) + 'MB',
      systemTotal: Math.round(totalMem / 1024 / 1024) + 'MB',
      systemUsage: usagePercent + '%'
    },
    version: '1.0.0'
  });
});

healthRoutes.get('/detailed', (c) => {
  c.header('Cache-Control', 'no-store');
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
    }
  });
});

export { healthRoutes };
