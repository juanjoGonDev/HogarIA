import { config } from '../config/app.config.js';
import os from 'os';

interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  systemFree: number;
  systemTotal: number;
  systemUsagePercent: number;
  timestamp: string;
}

class MemoryMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private lastStats: MemoryStats | null = null;

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      this.check();
    }, config.memory.checkInterval);

    // Initial check
    this.check();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Reset de las stats para que el monitor (singleton compartido entre tests)
    // vuelva a su estado inicial y `getStats()` devuelva null tras pararlo.
    this.lastStats = null;
  }

  check(): MemoryStats {
    const memUsage = process.memoryUsage();
    const systemFree = os.freemem();
    const systemTotal = os.totalmem();
    const systemUsagePercent = 1 - (systemFree / systemTotal);

    const stats: MemoryStats = {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      systemFree: Math.round(systemFree / 1024 / 1024),
      systemTotal: Math.round(systemTotal / 1024 / 1024),
      systemUsagePercent: Math.round(systemUsagePercent * 100),
      timestamp: new Date().toISOString()
    };

    this.lastStats = stats;

    // Check thresholds
    if (systemUsagePercent >= config.memory.criticalThreshold) {
      console.error(`[MemoryMonitor] CRITICAL: System memory usage at ${stats.systemUsagePercent}%`);
      console.error(`[MemoryMonitor] Free: ${stats.systemFree}MB / ${stats.systemTotal}MB`);
      this.forceGarbageCollection();
    } else if (systemUsagePercent >= config.memory.warningThreshold) {
      console.warn(`[MemoryMonitor] WARNING: System memory usage at ${stats.systemUsagePercent}%`);
      console.warn(`[MemoryMonitor] Free: ${stats.systemFree}MB / ${stats.systemTotal}MB`);
    }

    // Log heap usage if high
    if (stats.heapUsed > config.memory.maxHeapSize * 0.9) {
      console.warn(`[MemoryMonitor] Heap usage high: ${stats.heapUsed}MB / ${stats.heapTotal}MB`);
      this.forceGarbageCollection();
    }

    return stats;
  }

  getStats(): MemoryStats | null {
    return this.lastStats;
  }

  private forceGarbageCollection(): void {
    if (global.gc) {
      global.gc();
      console.log('[MemoryMonitor] Garbage collection forced');
    }
  }
}

export const memoryMonitor = new MemoryMonitor();
