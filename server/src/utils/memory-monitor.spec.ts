import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { memoryMonitor } from './memory-monitor';

describe('MemoryMonitor', () => {
  beforeEach(() => {
    memoryMonitor.stop();
  });

  afterEach(() => {
    memoryMonitor.stop();
  });

  it('should be created', () => {
    expect(memoryMonitor).toBeTruthy();
  });

  describe('check', () => {
    it('should return memory stats', () => {
      const stats = memoryMonitor.check();

      expect(stats).toHaveProperty('heapUsed');
      expect(stats).toHaveProperty('heapTotal');
      expect(stats).toHaveProperty('rss');
      expect(stats).toHaveProperty('systemFree');
      expect(stats).toHaveProperty('systemTotal');
      expect(stats).toHaveProperty('systemUsagePercent');
      expect(stats).toHaveProperty('timestamp');
    });

    it('should return numeric values', () => {
      const stats = memoryMonitor.check();

      expect(typeof stats.heapUsed).toBe('number');
      expect(typeof stats.heapTotal).toBe('number');
      expect(typeof stats.rss).toBe('number');
      expect(typeof stats.systemFree).toBe('number');
      expect(typeof stats.systemTotal).toBe('number');
      expect(typeof stats.systemUsagePercent).toBe('number');
    });

    it('should store last stats', () => {
      memoryMonitor.check();

      const stats = memoryMonitor.getStats();
      expect(stats).toBeTruthy();
    });
  });

  describe('getStats', () => {
    it('should return null before first check', () => {
      const stats = memoryMonitor.getStats();
      expect(stats).toBeNull();
    });

    it('should return stats after check', () => {
      memoryMonitor.check();

      const stats = memoryMonitor.getStats();
      expect(stats).toBeTruthy();
      expect(stats?.heapUsed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('start/stop', () => {
    it('should start monitoring', () => {
      memoryMonitor.start();

      // Should have interval running
      expect(memoryMonitor['intervalId']).toBeTruthy();
    });

    it('should stop monitoring', () => {
      memoryMonitor.start();
      memoryMonitor.stop();

      expect(memoryMonitor['intervalId']).toBeNull();
    });

    it('should not start multiple times', () => {
      memoryMonitor.start();
      const firstId = memoryMonitor['intervalId'];

      memoryMonitor.start();
      const secondId = memoryMonitor['intervalId'];

      expect(firstId).toBe(secondId);
    });
  });

  /**
   * Los umbrales se leen al importar la config, asi que cada caso fija el env y
   * resuelve un modulo aislado (vi.resetModules) en vez de reutilizar el
   * singleton de arriba: es la unica forma de forzar las ramas de aviso.
   */
  describe('umbrales', () => {
    const saved = { ...process.env };

    async function monitorWith(overrides: Record<string, string>) {
      vi.resetModules();
      Object.assign(process.env, { MEMORY_CHECK_INTERVAL: '100000', ...overrides });
      const mod = await import('./memory-monitor.js');
      return mod.memoryMonitor;
    }

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      process.env = { ...saved };
      vi.resetModules();
    });

    it('grita por consola y fuerza el GC cuando se cruza el umbral critico', async () => {
      const monitor = await monitorWith({
        MEMORY_WARNING_THRESHOLD: '0.85',
        MEMORY_CRITICAL_THRESHOLD: '0',
        MAX_HEAP_SIZE: '999999'
      });
      const gc = vi.fn();
      vi.stubGlobal('gc', gc);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logs = vi.spyOn(console, 'log').mockImplementation(() => {});

      const stats = monitor.check();

      expect(stats).toBeTruthy();
      expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).toContain('CRITICAL');
      // Sin --expose-gc no hay global.gc; aqui si, asi que tiene que haberse invocado.
      expect(gc).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Garbage collection');
    });

    it('avisa (warn) entre el umbral de aviso y el critico, sin forzar el GC', async () => {
      const monitor = await monitorWith({
        MEMORY_WARNING_THRESHOLD: '0',
        MEMORY_CRITICAL_THRESHOLD: '1',
        MAX_HEAP_SIZE: '999999'
      });
      const gc = vi.fn();
      vi.stubGlobal('gc', gc);
      const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

      monitor.check();

      expect(warns.mock.calls.map((c) => String(c[0])).join('\n')).toContain('WARNING');
      expect(errors).not.toHaveBeenCalled();
      expect(gc).not.toHaveBeenCalled();
    });

    it('avisa del heap alto y arranca un unico intervalo', async () => {
      vi.useFakeTimers();
      const monitor = await monitorWith({
        MEMORY_WARNING_THRESHOLD: '1',
        MEMORY_CRITICAL_THRESHOLD: '1',
        MAX_HEAP_SIZE: '1'
      });
      const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      monitor.start();
      monitor.start(); // idempotente: no encadena un segundo intervalo

      expect(warns.mock.calls.map((c) => String(c[0])).join('\n')).toContain('Heap usage high');

      vi.advanceTimersByTime(100000);
      expect(monitor.getStats()).toBeTruthy();
      monitor.stop();
      expect(monitor.getStats()).toBeNull();
    });
  });
});
