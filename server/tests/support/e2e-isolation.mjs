import { relative, resolve, sep, basename, join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

const RESERVED_PORTS = new Set([3000, 4200]);

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent !== '' &&
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function parsePort(value, name) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be an explicit TCP port.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be between 1024 and 65535.`);
  }
  return port;
}

export function validateIsolatedEnvironment(env = process.env, systemTempRoot = tmpdir()) {
  if (env.E2E_EXTERNAL_STACK !== '1') {
    throw new Error('Playwright must run through the isolated stack supervisor.');
  }
  const stack = env.E2E_STACK;
  if (stack !== 'dev' && stack !== 'full-stack' && stack !== 'ingress') {
    throw new Error(
      'E2E_STACK must be dev, full-stack or ingress; run Playwright through the isolated runner.'
    );
  }

  if (!env.E2E_RUN_DIR)
    throw new Error('E2E_RUN_DIR is required; refusing to use a shared test database.');
  const runDir = resolve(env.E2E_RUN_DIR);
  const tempRoot = resolve(systemTempRoot);
  if (!isWithin(tempRoot, runDir) || !basename(runDir).startsWith('hogaria-e2e-')) {
    throw new Error(
      'E2E_RUN_DIR must be an owned hogaria-e2e-* directory under the OS temp directory.'
    );
  }

  const databasePath = resolve(env.DATABASE_PATH ?? '');
  const expectedDatabasePath = join(runDir, 'hogaria.sqlite');
  if (databasePath !== expectedDatabasePath || !isWithin(runDir, databasePath)) {
    throw new Error('DATABASE_PATH must be exactly the isolated SQLite file inside E2E_RUN_DIR.');
  }
  const seed = env.E2E_SEED?.trim();
  if (!seed) throw new Error('E2E_SEED must be a unique synthetic fixture seed.');

  let base;
  try {
    base = new URL(env.E2E_BASE_URL ?? '');
  } catch {
    throw new Error('E2E_BASE_URL must be a valid loopback URL.');
  }
  if (
    base.protocol !== 'http:' ||
    base.hostname !== '127.0.0.1' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('E2E_BASE_URL must be a plain http://127.0.0.1:<port> origin.');
  }
  const basePort = parsePort(base.port, 'E2E_BASE_URL port');
  if (RESERVED_PORTS.has(basePort)) {
    throw new Error('E2E_BASE_URL must not use the app’s shared development port.');
  }

  const apiPort = parsePort(env.E2E_API_PORT, 'E2E_API_PORT');
  if (stack !== 'ingress' && RESERVED_PORTS.has(apiPort)) {
    throw new Error('E2E_API_PORT must not use the app’s shared development port.');
  }

  if (existsSync(databasePath) && stack !== 'ingress') {
    const readyFile = join(runDir, 'server.ready');
    const ready = existsSync(readyFile) ? readFileSync(readyFile, 'utf8').trim().split(':') : [];
    const readyPid = Number(ready[0]);
    const readyPort = Number(ready[1]);
    if (!Number.isInteger(readyPid) || readyPid <= 0 || readyPort !== apiPort) {
      throw new Error(
        'The isolated database already exists without a ready marker from this run; refusing to reuse it.'
      );
    }
  }

  let frontendPort = basePort;
  if (stack === 'dev') {
    frontendPort = parsePort(env.E2E_FRONTEND_PORT, 'E2E_FRONTEND_PORT');
    if (frontendPort !== basePort || frontendPort === apiPort) {
      throw new Error(
        'The dev UI origin must match E2E_FRONTEND_PORT and use a distinct API port.'
      );
    }
  } else if (stack === 'full-stack') {
    if (
      parsePort(env.E2E_FRONTEND_PORT, 'E2E_FRONTEND_PORT') !== basePort ||
      apiPort !== basePort
    ) {
      throw new Error('The full-stack UI and API must share the configured isolated port.');
    }
  } else {
    const ingressReadyFile = join(runDir, 'ingress.ready');
    const ingressOrigin = existsSync(ingressReadyFile)
      ? readFileSync(ingressReadyFile, 'utf8').trim()
      : '';
    if (
      parsePort(env.E2E_FRONTEND_PORT, 'E2E_FRONTEND_PORT') !== basePort ||
      apiPort !== basePort ||
      ingressOrigin !== base.origin
    ) {
      throw new Error('The isolated Nginx ingress must be ready on the configured UI/API origin.');
    }
    frontendPort = basePort;
  }

  return { runDir, databasePath, stack, baseUrl: base.origin, frontendPort, apiPort, seed };
}
