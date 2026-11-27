import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAiPersonaSeedPlan } from '../../../scripts/ai-persona-seeds.mjs';
import {
  DEMO_DATABASE_PATH,
  acquireDemoDatabaseLock,
  assertDemoDatabaseSelection,
  isDemoShutdownMessage,
  resetDemoDatabase,
  resolveDemoDatabasePath
} from './demo-mode.js';
import {
  DEMO_SEED_MARKER_CONTENT,
  DEMO_SEED_RUN_ID,
  getDemoSeedState,
  writeDemoSeedMarker
} from './demo-seed.js';

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

  it('accepts only an explicit IPC shutdown message', () => {
    expect(isDemoShutdownMessage({ type: 'shutdown' })).toBe(true);
    for (const message of [undefined, null, 'shutdown', [], {}, { type: 'stop' }]) {
      expect(isDemoShutdownMessage(message)).toBe(false);
    }
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

describe('demo seed lifecycle', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'hogaria-demo-seed-test-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function createDatabase(personaCount: number, extraUsers = 0): string {
    const databasePath = resolveDemoDatabasePath(projectRoot);
    mkdirSync(dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE)');
    const expectedEmails = createAiPersonaSeedPlan(DEMO_SEED_RUN_ID).users.map(
      ({ email }) => email
    );
    const insert = database.prepare('INSERT INTO users (id, email) VALUES (?, ?)');
    for (const email of expectedEmails.slice(0, personaCount)) insert.run(email, email);
    for (let index = 0; index < extraUsers; index += 1) {
      insert.run(`other-${index}`, `other-${index}@hogaria.test`);
    }
    database.close();
    return databasePath;
  }

  it('treats a missing or freshly initialized empty demo database as ready to seed', () => {
    expect(getDemoSeedState({ projectRoot })).toBe('empty');
    createDatabase(0);
    expect(getDemoSeedState({ projectRoot })).toBe('empty');
  });

  it('fails closed on partial profiles or a completed matrix without its marker', () => {
    createDatabase(1);
    expect(() => getDemoSeedState({ projectRoot })).toThrow(/partial|reset/i);

    rmSync(resolveDemoDatabasePath(projectRoot));
    createDatabase(10);
    expect(() => getDemoSeedState({ projectRoot })).toThrow(/partial|reset/i);
  });

  it('writes a non-secret marker only after all expected accounts exist and is idempotent to read', () => {
    createDatabase(9);
    expect(() => writeDemoSeedMarker({ projectRoot })).toThrow(/10 synthetic|complete/i);
    expect(existsSync(resolveDemoDatabasePath(projectRoot) + '.seeded')).toBe(false);

    rmSync(resolveDemoDatabasePath(projectRoot));
    createDatabase(10, 1);
    writeDemoSeedMarker({ projectRoot });

    const marker = readFileSync(resolveDemoDatabasePath(projectRoot) + '.seeded', 'utf8');
    expect(marker).toBe(DEMO_SEED_MARKER_CONTENT);
    expect(marker).not.toMatch(/password|token|prompt|response/i);
    expect(getDemoSeedState({ projectRoot })).toBe('seeded');
  });

  it('rejects a marker whose format or matching synthetic accounts changed', () => {
    createDatabase(10);
    writeFileSync(resolveDemoDatabasePath(projectRoot) + '.seeded', '{"version":99}\n');
    expect(() => getDemoSeedState({ projectRoot })).toThrow(/marker|seed/i);

    rmSync(resolveDemoDatabasePath(projectRoot) + '.seeded');
    rmSync(resolveDemoDatabasePath(projectRoot));
    createDatabase(9);
    writeFileSync(resolveDemoDatabasePath(projectRoot) + '.seeded', DEMO_SEED_MARKER_CONTENT);
    expect(() => getDemoSeedState({ projectRoot })).toThrow(/marker|seed/i);
  });
});
