import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { AI_LIVE_SMOKE_ENV } from './ai-live-smoke-safety.mjs';

import { validateIsolatedEnvironment } from '../server/tests/support/e2e-isolation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const isolation = validateIsolatedEnvironment(process.env);
if (isolation.stack !== 'dev')
  throw new Error('The dev-stack launcher only accepts E2E_STACK=dev.');

const proxyPath = join(isolation.runDir, 'proxy.conf.json');
const proxyConfig = {
  '/api': { target: `http://127.0.0.1:${isolation.apiPort}`, secure: false, changeOrigin: true },
  '/health': { target: `http://127.0.0.1:${isolation.apiPort}`, secure: false, changeOrigin: true }
};
writeFileSync(proxyPath, `${JSON.stringify(proxyConfig, null, 2)}\n`, { flag: 'wx' });

const sharedEnv = {
  ...process.env,
  DATABASE_PATH: isolation.databasePath,
  E2E_RUN_DIR: isolation.runDir,
  E2E_SEED: isolation.seed,
  E2E_STACK: 'dev',
  E2E_BASE_URL: isolation.baseUrl,
  DISABLE_RATE_LIMIT: process.env.E2E_RATE_LIMIT === 'on' ? '0' : '1'
};
const serverEnv = { ...sharedEnv };
const clientEnv = { ...sharedEnv };
delete clientEnv[AI_LIVE_SMOKE_ENV.providerToken];
delete clientEnv[AI_LIVE_SMOKE_ENV.proxyToken];
const serverDir = join(root, 'server');
const clientDir = join(root, 'frontend');
const children = [];
const readyFile = join(isolation.runDir, 'server.ready');

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill('SIGTERM');
  });
}

let stopping;
let wasSignaled = false;
function stopAll() {
  if (!stopping) stopping = Promise.all(children.map(stopChild));
  return stopping;
}

async function waitForApiReady(child) {
  let startError;
  child.once('error', (error) => {
    startError = error;
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (startError) throw startError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `The isolated API stopped before binding its port (code=${child.exitCode}, signal=${child.signalCode}).`
      );
    }
    if (existsSync(readyFile)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('The isolated API did not bind its port before the startup deadline.');
}

async function startStack() {
  const server = spawn(
    process.execPath,
    [join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'],
    {
      cwd: serverDir,
      env: {
        ...serverEnv,
        PORT: String(isolation.apiPort),
        HOST: '127.0.0.1',
        CORS_ORIGIN: isolation.baseUrl,
        E2E_READY_FILE: readyFile
      },
      stdio: 'inherit',
      windowsHide: true
    }
  );
  children.push(server);
  await waitForApiReady(server);

  const client = spawn(
    process.execPath,
    [
      join(clientDir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      String(isolation.frontendPort),
      '--proxy-config',
      proxyPath
    ],
    { cwd: clientDir, env: clientEnv, stdio: 'inherit', windowsHide: true }
  );
  children.push(client);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    wasSignaled = true;
    void stopAll().then(() => {
      process.exitCode = 0;
      if (process.connected) process.disconnect();
    });
  });
}
process.on('message', (message) => {
  if (message?.type !== 'shutdown') return;
  wasSignaled = true;
  void stopAll().then(() => {
    process.exitCode = 0;
    if (process.connected) process.disconnect();
  });
});

await startStack().catch(async (error) => {
  if (wasSignaled) return;
  console.error('[e2e-dev-stack] Could not start isolated servers:', error);
  await stopAll();
  process.exitCode = 1;
});
if (process.exitCode === 1) process.exit(1);

const unexpectedExit = await Promise.race(
  children.map(
    (child) =>
      new Promise((resolveExit, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolveExit({ code, signal }));
      })
  )
).catch(async (error) => {
  console.error('[e2e-dev-stack] Failed to start an isolated app process:', error);
  await stopAll();
  return { code: 1, signal: null };
});

if (!stopping) {
  console.error(
    `[e2e-dev-stack] An isolated app process stopped unexpectedly (code=${unexpectedExit.code}, signal=${unexpectedExit.signal}).`
  );
  await stopAll();
  process.exitCode = unexpectedExit.code ?? 1;
}
if (process.connected) process.disconnect();
