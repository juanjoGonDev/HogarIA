import { randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_DATABASE_PATH = resolve(REPOSITORY_ROOT, '.tmp', 'ai-persona-demo', 'hogaria.sqlite');

function pathsEqual(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function assertDemoAppEnvironment(env = process.env, projectRoot = REPOSITORY_ROOT) {
  const expectedDatabasePath = resolve(projectRoot, '.tmp', 'ai-persona-demo', 'hogaria.sqlite');
  if (
    env.HOGARIA_DEMO_MODE !== '1' ||
    env.HOGARIA_DEMO_RUN !== '1' ||
    !env.DATABASE_PATH ||
    !pathsEqual(env.DATABASE_PATH, expectedDatabasePath)
  ) {
    throw new Error(
      'Demo app requires HOGARIA_DEMO_MODE=1, HOGARIA_DEMO_RUN=1 and the exact managed DATABASE_PATH.'
    );
  }
  return { databasePath: expectedDatabasePath };
}

function copyEnvironmentValue(target, source, key) {
  if (typeof source[key] === 'string') target[key] = source[key];
}

export function buildDemoChildEnvironment(
  parentEnvironment,
  { databasePath, apiPort, frontendPort, jwtSecret }
) {
  const environment = {};
  for (const key of [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'ComSpec',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOME',
    'APPDATA',
    'LOCALAPPDATA'
  ]) {
    copyEnvironmentValue(environment, parentEnvironment, key);
  }
  return {
    ...environment,
    NODE_ENV: 'development',
    NG_CLI_ANALYTICS: 'false',
    HOGARIA_DEMO_MODE: '1',
    DATABASE_PATH: databasePath,
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    CORS_ORIGIN: `http://127.0.0.1:${frontendPort}`,
    JWT_SECRET: jwtSecret
  };
}

async function availableLoopbackPort(excluded = new Set()) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const server = createServer();
    const port = await new Promise((resolvePort, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolvePort(server.address().port));
    });
    await new Promise((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose()))
    );
    if (!excluded.has(port) && ![3000, 3001, 4200].includes(port)) return port;
  }
  throw new Error('Could not select a free demo loopback port.');
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
    child.once('error', (error) => resolveExit({ error }));
  });
}

async function waitForExitWithin(exited, timeoutMs) {
  let timer;
  const result = await Promise.race([
    exited.then(() => true),
    new Promise((resolveExit) => {
      timer = setTimeout(() => resolveExit(false), timeoutMs);
    })
  ]);
  clearTimeout(timer);
  return result;
}

async function waitForHttp(url, child, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Demo ${label} process stopped before readiness (code=${child.exitCode ?? 'none'}, signal=${child.signalCode ?? 'none'}).`
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
      await response.body?.cancel().catch(() => {});
    } catch {
      // Retry only the short readiness probe while this launcher-owned service starts.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Demo ${label} did not become ready within 60 seconds.`);
}

export async function stopOwnedProcess(child, { shutdownMessage } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child);
  if (shutdownMessage && child.connected) {
    try {
      child.send(shutdownMessage, (error) => {
        if (error && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      });
      const gracefulShutdown = await waitForExitWithin(exited, 10_000);
      if (gracefulShutdown || child.exitCode !== null || child.signalCode !== null) return;
    } catch {
      // Fall back to a process signal if the IPC channel is already unavailable.
    }
  }
  child.kill('SIGTERM');
  const graceful = await waitForExitWithin(exited, 10_000);
  if (graceful || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGKILL');
  await waitForExitWithin(exited, 2_000);
}

function removeOwnedProxyConfig(path) {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new Error('Refusing to remove a redirected demo proxy configuration.');
    }
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function runDemoApp() {
  const { databasePath } = assertDemoAppEnvironment();
  const directory = dirname(databasePath);
  mkdirSync(directory, { recursive: true });
  if (!pathsEqual(realpathSync(directory), directory)) {
    throw new Error('The demo database directory cannot be redirected.');
  }

  const apiPort = await availableLoopbackPort();
  const frontendPort = await availableLoopbackPort(new Set([apiPort]));
  const proxyPath = `${databasePath}.proxy-${process.pid}-${randomUUID()}.json`;
  const proxy = {
    '/api': { target: `http://127.0.0.1:${apiPort}`, secure: false, changeOrigin: true },
    '/health': { target: `http://127.0.0.1:${apiPort}`, secure: false, changeOrigin: true }
  };
  const descriptor = openSync(proxyPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify(proxy));
  } finally {
    closeSync(descriptor);
  }

  const childEnvironment = buildDemoChildEnvironment(process.env, {
    databasePath,
    apiPort,
    frontendPort,
    jwtSecret: randomBytes(32).toString('base64url')
  });
  let server;
  let frontend;
  let stopRequested = false;
  let stopping;
  const stopChildren = () => {
    if (!stopping) {
      stopping = Promise.all([
        stopOwnedProcess(frontend),
        stopOwnedProcess(server, { shutdownMessage: { type: 'shutdown' } })
      ]);
    }
    return stopping;
  };
  const handleSignal = () => {
    stopRequested = true;
    void stopChildren();
  };
  const handleShutdownMessage = (message) => {
    if (message?.type === 'shutdown') handleSignal();
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
  process.on('message', handleShutdownMessage);

  try {
    server = spawn(
      process.execPath,
      [resolve(REPOSITORY_ROOT, 'server/node_modules/tsx/dist/cli.mjs'), 'src/index.ts'],
      {
        cwd: resolve(REPOSITORY_ROOT, 'server'),
        env: childEnvironment,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
        detached: process.platform === 'win32'
      }
    );
    await waitForHttp(`http://127.0.0.1:${apiPort}/health`, server, 'API');

    frontend = spawn(
      process.execPath,
      [
        resolve(REPOSITORY_ROOT, 'frontend/node_modules/@angular/cli/bin/ng.js'),
        'serve',
        '--host',
        '127.0.0.1',
        '--port',
        String(frontendPort),
        '--proxy-config',
        proxyPath
      ],
      {
        cwd: resolve(REPOSITORY_ROOT, 'frontend'),
        env: childEnvironment,
        stdio: 'inherit',
        windowsHide: true
      }
    );
    await waitForHttp(`http://127.0.0.1:${frontendPort}/`, frontend, 'frontend');
    console.log(`[demo] app disponible en http://127.0.0.1:${frontendPort}/ (Ctrl+C para cerrar).`);

    const exited = await Promise.race([
      waitForExit(server).then((result) => ({ label: 'API', result })),
      waitForExit(frontend).then((result) => ({ label: 'frontend', result }))
    ]);
    if (!stopRequested) {
      throw new Error(
        `Demo ${exited.label} stopped unexpectedly (${exited.result.code ?? exited.result.signal ?? 'process error'}).`
      );
    }
  } finally {
    process.removeListener('SIGINT', handleSignal);
    process.removeListener('SIGTERM', handleSignal);
    process.removeListener('message', handleShutdownMessage);
    await stopChildren();
    removeOwnedProxyConfig(proxyPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDemoApp().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Demo app failed.');
    process.exitCode = 1;
  });
}
