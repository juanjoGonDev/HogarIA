import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateIsolatedEnvironment } from './support/e2e-isolation.mjs';

const ownedDirectories: string[] = [];

function makeRunDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'hogaria-e2e-'));
  ownedDirectories.push(directory);
  return directory;
}

function environment(overrides: Record<string, string> = {}) {
  const runDir = makeRunDir();
  return {
    E2E_RUN_DIR: runDir,
    E2E_EXTERNAL_STACK: '1',
    E2E_STACK: 'dev',
    E2E_BASE_URL: 'http://127.0.0.1:62123',
    E2E_FRONTEND_PORT: '62123',
    E2E_API_PORT: '62124',
    E2E_SEED: 'qa-synthetic-run',
    DATABASE_PATH: join(runDir, 'hogaria.sqlite'),
    ...overrides
  };
}

afterEach(() => {
  for (const directory of ownedDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('validateIsolatedEnvironment', () => {
  it('accepts a dev run with separate loopback app, API and temporary database paths', () => {
    const result = validateIsolatedEnvironment(environment());

    expect(result).toEqual({
      runDir: expect.stringMatching(/^.*hogaria-e2e-/),
      databasePath: expect.stringMatching(/^.*hogaria-e2e-.*hogaria\.sqlite$/),
      stack: 'dev',
      baseUrl: 'http://127.0.0.1:62123',
      frontendPort: 62123,
      apiPort: 62124,
      seed: 'qa-synthetic-run'
    });
  });

  it('accepts a full-stack run when its single port serves both UI and API', () => {
    const env = environment({
      E2E_STACK: 'full-stack',
      E2E_API_PORT: '62123',
      E2E_FRONTEND_PORT: '62123'
    });

    expect(validateIsolatedEnvironment(env).stack).toBe('full-stack');
  });

  it('accepts an isolated Nginx ingress after the runner records its public origin', () => {
    const env = environment({
      E2E_STACK: 'ingress',
      E2E_API_PORT: '62123',
      E2E_FRONTEND_PORT: '62123'
    });
    writeFileSync(env.DATABASE_PATH, 'created by the isolated ingress backend');
    writeFileSync(join(env.E2E_RUN_DIR, 'ingress.ready'), `${env.E2E_BASE_URL}\n`);

    const result = validateIsolatedEnvironment(env);

    expect(result).toMatchObject({ stack: 'ingress', apiPort: 62123, frontendPort: 62123 });
  });

  it('rejects an ingress readiness marker for a different public origin', () => {
    const env = environment({
      E2E_STACK: 'ingress',
      E2E_API_PORT: '62123',
      E2E_FRONTEND_PORT: '62123'
    });
    writeFileSync(join(env.E2E_RUN_DIR, 'ingress.ready'), 'http://127.0.0.1:62124\n');

    expect(() => validateIsolatedEnvironment(env)).toThrow(/Nginx ingress/);
  });

  it('rejects a database that predates the isolated server ready marker', () => {
    const env = environment();
    writeFileSync(env.DATABASE_PATH, 'pre-existing');

    expect(() => validateIsolatedEnvironment(env)).toThrow(/ready marker/);
  });

  it('allows worker config reloads after this run has bound the isolated API port', () => {
    const env = environment();
    writeFileSync(env.DATABASE_PATH, 'created by isolated API');
    writeFileSync(join(env.E2E_RUN_DIR, 'server.ready'), `1234:${env.E2E_API_PORT}\n`);

    expect(validateIsolatedEnvironment(env).databasePath).toBe(env.DATABASE_PATH);
  });

  it('rejects a startup marker for a different API port', () => {
    const env = environment();
    writeFileSync(env.DATABASE_PATH, 'pre-existing');
    writeFileSync(join(env.E2E_RUN_DIR, 'server.ready'), '1234:62125\n');

    expect(() => validateIsolatedEnvironment(env)).toThrow(/ready marker/);
  });

  it.each([
    ['missing isolated stack supervisor flag', { E2E_EXTERNAL_STACK: '' }],
    ['missing run directory', { E2E_RUN_DIR: '' }],
    ['run directory outside system temp', { E2E_RUN_DIR: 'C:\\outside\\hogaria-e2e-owned' }],
    [
      'database outside owned run directory',
      { DATABASE_PATH: 'D:\\projects\\MiCocinAI\\data\\hogaria.sqlite' }
    ],
    ['default frontend port', { E2E_BASE_URL: 'http://127.0.0.1:4200', E2E_FRONTEND_PORT: '4200' }],
    ['default API port', { E2E_API_PORT: '3000' }],
    ['non-loopback app origin', { E2E_BASE_URL: 'http://192.168.1.223:62123' }],
    ['unknown stack mode', { E2E_STACK: 'development' }],
    ['invalid API port', { E2E_API_PORT: '70000' }],
    ['dev ports must be distinct', { E2E_FRONTEND_PORT: '62124' }],
    ['full-stack ports must match', { E2E_STACK: 'full-stack', E2E_FRONTEND_PORT: '62123' }],
    ['empty seed', { E2E_SEED: '' }]
  ])('rejects %s before starting a server or browser', (_label, overrides) => {
    expect(() => validateIsolatedEnvironment(environment(overrides))).toThrow();
  });
});
