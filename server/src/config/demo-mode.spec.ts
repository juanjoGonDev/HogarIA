import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEMO_DATABASE_PATH,
  acquireDemoDatabaseLock,
  assertDemoDatabaseSelection,
  resetDemoDatabase,
  resolveDemoDatabasePath
} from './demo-mode.js';

describe('demo database selection', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'hogaria-demo-test-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('allows the canonical database only with the explicit demo mode', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: '1',
        databasePath: DEMO_DATABASE_PATH
      })
    ).not.toThrow();
  });

  it('rejects enabling demo mode with the normal database', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: '1',
        databasePath: './data/hogaria.sqlite'
      })
    ).toThrow(/demo database path/i);
  });

  it('rejects the demo database from normal server mode', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: undefined,
        databasePath: DEMO_DATABASE_PATH
      })
    ).toThrow(/requires HOGARIA_DEMO_MODE=1/i);
  });

  it('keeps the normal database valid when demo mode is off', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: undefined,
        databasePath: './data/hogaria.sqlite'
      })
    ).not.toThrow();
  });

  it('resolves the database under the requested project root', () => {
    expect(resolveDemoDatabasePath(projectRoot)).toBe(
      join(projectRoot, '.tmp', 'ai-persona-demo', 'hogaria.sqlite')
    );
  });

  it('resets only the managed database, SQLite sidecars, and seed marker', () => {
    const databasePath = resolveDemoDatabasePath(projectRoot);
    mkdirSync(join(projectRoot, '.tmp', 'ai-persona-demo'), { recursive: true });
    for (const suffix of ['', '-wal', '-shm', '-journal', '.seeded']) {
      writeFileSync(databasePath + suffix, 'synthetic');
    }
    const unrelated = join(projectRoot, '.tmp', 'ai-persona-demo', 'keep.txt');
    writeFileSync(unrelated, 'keep');

    resetDemoDatabase({ projectRoot });

    for (const suffix of ['', '-wal', '-shm', '-journal', '.seeded']) {
      expect(existsSync(databasePath + suffix)).toBe(false);
    }
    expect(existsSync(unrelated)).toBe(true);
  });

  it('refuses to reset while another demo stack owns the database lock', () => {
    const databasePath = resolveDemoDatabasePath(projectRoot);
    mkdirSync(join(projectRoot, '.tmp', 'ai-persona-demo'), { recursive: true });
    writeFileSync(databasePath, 'do not delete');
    const release = acquireDemoDatabaseLock({ projectRoot });

    expect(() => resetDemoDatabase({ projectRoot })).toThrow(/already in use/i);
    expect(existsSync(databasePath)).toBe(true);
    release();
  });

  it('rejects ambiguous demo-mode values', () => {
    expect(() =>
      assertDemoDatabaseSelection({
        mode: 'true',
        databasePath: './data/hogaria.sqlite'
      })
    ).toThrow(/HOGARIA_DEMO_MODE/i);
  });
});
