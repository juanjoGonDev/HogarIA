import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createAiPersonaSeedPlan } from '../../../scripts/ai-persona-seeds.mjs';
import { getDemoSeedState } from '../config/demo-seed.js';
import { resolveDemoDatabasePath } from '../config/demo-mode.js';

import { runDemoCommand, runOwnedNodeScript } from './ai-persona-demo.js';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

afterEach(() => vi.restoreAllMocks());

describe('AI persona demo commands', () => {
  it('seeds through the owned local HogarIA E2E stack and exact persistent demo database', async () => {
    const runScript = vi.fn().mockResolvedValue(undefined);

    await runDemoCommand('seed', {
      getSeedState: () => 'empty',
      writeSeedMarker: () => {},
      runScript
    });

    const [script, args, env] = runScript.mock.calls[0];
    expect(script).toBe(resolve(REPOSITORY_ROOT, 'scripts/run-isolated-playwright.mjs'));
    expect(args).toEqual(['tests/e2e/ai-persona-seeds.spec.ts']);
    expect(env).toMatchObject({
      HOGARIA_DEMO_MODE: '1',
      HOGARIA_DEMO_RUN: '1',
      DATABASE_PATH: resolve(REPOSITORY_ROOT, '.tmp/ai-persona-demo/hogaria.sqlite'),
      HOGARIA_AI_SEED_GENERATION: '1'
    });
    expect(env.HOGARIA_AI_REAL_SMOKE).toBeUndefined();
    expect(env.HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN).toBeUndefined();
  });

  it('does not re-run the seed when its validated marker is present', async () => {
    const runScript = vi.fn().mockResolvedValue(undefined);

    await runDemoCommand('seed', { getSeedState: () => 'seeded', runScript });

    expect(runScript).not.toHaveBeenCalled();
  });

  it('supports an isolated project root when exercising the full marker-writing path', async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'hogaria-demo-command-test-'));
    const databasePath = resolveDemoDatabasePath(projectRoot);
    mkdirSync(resolve(projectRoot, '.tmp', 'ai-persona-demo'), { recursive: true });
    const database = new Database(databasePath);
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)');
    database.close();
    const runScript = vi.fn(async () => {
      const seededDatabase = new Database(databasePath);
      const insert = seededDatabase.prepare('INSERT INTO users (id, email) VALUES (?, ?)');
      for (const { email } of createAiPersonaSeedPlan('demo').users) insert.run(email, email);
      seededDatabase.close();
    });

    try {
      await runDemoCommand('seed', { projectRoot, runScript });

      expect(runScript).toHaveBeenCalledOnce();
      expect(existsSync(databasePath + '.seeded')).toBe(true);
      expect(getDemoSeedState({ projectRoot })).toBe('seeded');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('resets only the managed demo DB after a failed partial seed', async () => {
    const getSeedState = vi
      .fn()
      .mockReturnValueOnce('empty')
      .mockImplementationOnce(() => {
        throw new Error('partial seed');
      });
    const runScript = vi.fn().mockRejectedValue(new Error('owned E2E failed'));
    const resetDatabase = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runDemoCommand('seed', { getSeedState, runScript, resetDatabase })
    ).rejects.toThrow('owned E2E failed');

    expect(resetDatabase).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      '[demo] seed incompleto eliminado; puedes volver a ejecutar demo:seed.'
    );
  });

  it('resets, seeds, then calls only the real WebAPI smoke runner in explicit demo mode', async () => {
    const order: string[] = [];
    const resetDatabase = vi.fn(() => order.push('reset'));
    const seedDatabase = vi.fn(async () => void order.push('seed'));
    const runScript = vi.fn<typeof runOwnedNodeScript>(async () => {
      order.push('real-smoke');
    });

    await runDemoCommand('regenerate', { resetDatabase, seedDatabase, runScript });

    expect(order).toEqual(['reset', 'seed', 'real-smoke']);
    const [script, args, env] = runScript.mock.calls[0];
    expect(script).toBe(resolve(REPOSITORY_ROOT, 'scripts/run-ai-real-smoke.mjs'));
    expect(args).toEqual([]);
    expect(env).toMatchObject({
      HOGARIA_DEMO_MODE: '1',
      HOGARIA_DEMO_RUN: '1',
      DATABASE_PATH: resolve(REPOSITORY_ROOT, '.tmp/ai-persona-demo/hogaria.sqlite'),
      HOGARIA_AI_REAL_SMOKE: '1'
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN).toBeUndefined();
  });

  it('starts the app only through the loopback demo launcher with graceful shutdown enabled', async () => {
    const runScript = vi.fn().mockResolvedValue(undefined);
    const seedDatabase = vi.fn().mockResolvedValue(undefined);

    await runDemoCommand('app', { seedDatabase, runScript });

    expect(seedDatabase).toHaveBeenCalledOnce();
    const [script, args, env, options] = runScript.mock.calls[0];
    expect(script).toBe(resolve(REPOSITORY_ROOT, 'scripts/run-ai-persona-demo-app.mjs'));
    expect(args).toEqual([]);
    expect(env).toMatchObject({
      HOGARIA_DEMO_MODE: '1',
      HOGARIA_DEMO_RUN: '1',
      DATABASE_PATH: resolve(REPOSITORY_ROOT, '.tmp/ai-persona-demo/hogaria.sqlite')
    });
    expect(options).toEqual({ gracefulShutdown: true });
  });

  it('routes reset to only the guarded demo database reset', async () => {
    const resetDatabase = vi.fn();

    await runDemoCommand('reset', { resetDatabase });

    expect(resetDatabase).toHaveBeenCalledOnce();
  });

  it('resets only the managed artifacts when using the default reset implementation', async () => {
    const projectRoot = mkdtempSync(resolve(tmpdir(), 'hogaria-demo-reset-test-'));
    const databasePath = resolveDemoDatabasePath(projectRoot);
    mkdirSync(resolve(projectRoot, '.tmp', 'ai-persona-demo'), { recursive: true });
    for (const suffix of ['', '-wal', '-shm', '-journal', '.seeded']) {
      writeFileSync(databasePath + suffix, 'synthetic');
    }
    const unrelated = resolve(projectRoot, '.tmp', 'ai-persona-demo', 'keep.txt');
    writeFileSync(unrelated, 'keep');

    try {
      await runDemoCommand('reset', { projectRoot });

      for (const suffix of ['', '-wal', '-shm', '-journal', '.seeded']) {
        expect(existsSync(databasePath + suffix)).toBe(false);
      }
      expect(existsSync(unrelated)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects unknown commands without invoking a database operation', async () => {
    const resetDatabase = vi.fn();

    await expect(runDemoCommand('unknown', { resetDatabase })).rejects.toThrow(/Uso:/);

    expect(resetDatabase).not.toHaveBeenCalled();
  });
});

describe('owned demo subprocess', () => {
  let directory: string;

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = '';
  });

  function createChildScript(source: string): string {
    directory = mkdtempSync(resolve(tmpdir(), 'hogaria-demo-child-'));
    const script = resolve(directory, 'child.mjs');
    writeFileSync(script, source);
    return script;
  }

  it('resolves only after an owned child exits successfully', async () => {
    const script = createChildScript('process.exit(0);');

    await expect(runOwnedNodeScript(script, [], {})).resolves.toBeUndefined();
  });

  it('reports an owned child failure', async () => {
    const script = createChildScript('process.exit(17);');

    await expect(runOwnedNodeScript(script, [], {})).rejects.toThrow(/exited with 17/);
  });

  it('forwards shutdown through IPC and waits for a graceful demo child exit', async () => {
    const script = createChildScript(`
      process.on('message', (message) => {
        if (message?.type === 'shutdown') process.exit(0);
      });
      setTimeout(() => process.exit(2), 2_000);
    `);
    const priorListeners = new Set(process.listeners('SIGINT'));
    const running = runOwnedNodeScript(script, [], {}, { gracefulShutdown: true });
    const shutdownListener = process
      .listeners('SIGINT')
      .find((listener) => !priorListeners.has(listener));

    expect(shutdownListener).toBeDefined();
    Reflect.apply(shutdownListener!, process, []);
    await expect(running).resolves.toBeUndefined();
  });
});
