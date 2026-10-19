import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  copyFileSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
  AI_LIVE_SMOKE_RUNNER_SHUTDOWN_MESSAGE,
  sendAiLiveSmokeRunnerCompletion
} from './ai-live-smoke-runner-control.mjs';
import { isolatedProcessEnvironments, validateAiLiveSmokeRunner } from './ai-live-smoke-safety.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const nginxIngress = args.includes('--nginx-ingress');
const playwrightArgs = args.filter((arg) => arg !== '--nginx-ingress');
const liveSmoke = validateAiLiveSmokeRunner(process.env, playwrightArgs);
if (nginxIngress && liveSmoke) {
  throw new Error('The isolated Nginx ingress runner cannot be combined with the live AI smoke.');
}
const fullStack = args.some((arg, index) => {
  if (arg.startsWith('--config=')) return arg.includes('playwright.full-stack.config.ts');
  return arg === '--config' && args[index + 1]?.includes('playwright.full-stack.config.ts');
});
if (nginxIngress && fullStack) {
  throw new Error('The isolated Nginx ingress runner uses the dev API stack, not full-stack mode.');
}
const runDir = mkdtempSync(join(tmpdir(), 'hogaria-e2e-'));
const playwrightCli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const readyFile = join(runDir, 'server.ready');
let ownedPorts = [];
let testProcess;
let stackProcess;
let stopStackPromise;
let ingressComposeProject;
let ingressComposeFile;
let ingressComposeEnvironment;
let ingressComposeStarted = false;
let exitCode = 1;
let preserve = !liveSmoke;
let shutdownRequested = false;
let runnerCleanupVerified = false;

function reportSmokeProgress(phase) {
  if (!liveSmoke || !process.connected) return;
  try {
    process.send({ type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE, phase }, () => {});
  } catch {
    // Progress is diagnostic only and must not affect isolation or cleanup.
  }
}

function reportLastLiveSmokeTestPhase() {
  if (!liveSmoke) return;
  try {
    const phase = readFileSync(join(runDir, 'ai-live-smoke-phase'), 'utf8').trim();
    reportSmokeProgress(`test-phase:${phase}`);
  } catch {
    // Tests that fail before their first milestone still report the runner exit status.
  }
}

async function availablePort(excluded = new Set()) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const server = createServer();
    const port = await new Promise((resolvePort, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolvePort(server.address().port));
    });
    await new Promise((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose()))
    );
    if (!excluded.has(port) && port !== 3000 && port !== 4200) return port;
  }
  throw new Error('Could not reserve a non-default ephemeral loopback port for Playwright.');
}

function waitForExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : (options.stdio ?? 'inherit'),
      windowsHide: true
    });
    let captured = '';
    if (options.capture) {
      child.stdout.setEncoding('utf8').on('data', (chunk) => (captured += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk) => (captured += chunk));
    }
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCommand(captured);
      else
        rejectCommand(
          new Error(`${command} exited with ${code ?? signal ?? 'unknown error'}.${captured}`)
        );
    });
  });
}

function dockerPath(path) {
  return resolve(path).replaceAll('\\', '/');
}

function copyIngressBuildContext() {
  const workspace = join(runDir, 'ingress-workspace');
  mkdirSync(join(workspace, 'frontend'), { recursive: true });
  mkdirSync(join(workspace, 'server'), { recursive: true });

  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    copyFileSync(join(root, file), join(workspace, file));
  }
  copyFileSync(join(root, 'frontend', 'package.json'), join(workspace, 'frontend', 'package.json'));
  for (const file of ['package.json', 'tsconfig.json']) {
    copyFileSync(join(root, 'server', file), join(workspace, 'server', file));
  }
  cpSync(join(root, 'server', 'src'), join(workspace, 'server', 'src'), {
    recursive: true,
    errorOnExist: true
  });

  writeFileSync(
    join(workspace, 'Dockerfile'),
    `FROM node:22-alpine AS build\nWORKDIR /workspace\nRUN apk add --no-cache python3 make g++ && corepack enable && corepack prepare pnpm@10.15.0 --activate\nCOPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./\nCOPY frontend/package.json frontend/package.json\nCOPY server/package.json server/package.json\nRUN pnpm install --frozen-lockfile --filter @hogaria/server...\nCOPY server/tsconfig.json server/tsconfig.json\nCOPY server/src server/src\nRUN pnpm --filter @hogaria/server run build\n\nFROM node:22-alpine\nWORKDIR /workspace\nENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATABASE_PATH=/app/data/hogaria.sqlite\nCOPY --from=build /workspace/node_modules ./node_modules\nCOPY --from=build /workspace/server/node_modules ./server/node_modules\nCOPY --from=build /workspace/server/package.json ./server/package.json\nCOPY --from=build /workspace/server/dist ./server/dist\nCMD [\"node\", \"server/dist/index.js\"]\n`,
    { flag: 'wx' }
  );
  return workspace;
}

async function startNginxIngress(appPort) {
  ingressComposeProject = basename(runDir).toLowerCase();
  ingressComposeFile = join(runDir, 'docker-compose.ingress.yml');
  ingressComposeEnvironment = {
    ...process.env,
    JWT_SECRET: randomBytes(32).toString('base64url')
  };
  const workspace = copyIngressBuildContext();
  const yamlString = (value) => JSON.stringify(value);
  const compose = `services:
  app:
    build:
      context: ${yamlString(dockerPath(workspace))}
      dockerfile: Dockerfile
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOST: 0.0.0.0
      DATABASE_PATH: /app/data/hogaria.sqlite
      JWT_SECRET: \u0024{JWT_SECRET:?JWT_SECRET is required}
      CORS_ORIGIN: http://127.0.0.1:${appPort}
      DISABLE_RATE_LIMIT: "0"
      PANTRY_IMAGE_SEARCH_FIXTURE: "1"
    volumes:
      - type: bind
        source: ${yamlString(dockerPath(runDir))}
        target: /app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 2s
      timeout: 2s
      retries: 60
      start_period: 10s
    networks: [isolated]
  nginx:
    image: nginx:alpine
    ports:
      - "127.0.0.1:${appPort}:80"
    volumes:
      - type: bind
        source: ${yamlString(dockerPath(join(root, 'nginx', 'nginx.conf')))}
        target: /etc/nginx/nginx.conf
        read_only: true
      - type: bind
        source: ${yamlString(dockerPath(join(root, 'nginx', 'proxy-api-common.conf')))}
        target: /etc/nginx/proxy-api-common.conf
        read_only: true
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1/api/health"]
      interval: 2s
      timeout: 2s
      retries: 60
      start_period: 2s
    depends_on:
      app:
        condition: service_healthy
    networks: [isolated]
networks:
  isolated: {}
`;
  writeFileSync(ingressComposeFile, compose, { flag: 'wx' });

  const composeArgs = ['compose', '-p', ingressComposeProject, '-f', ingressComposeFile];
  const existing = await runCommand('docker', [...composeArgs, 'ps', '--all', '--quiet'], {
    env: ingressComposeEnvironment,
    capture: true
  });
  if (existing.trim()) {
    throw new Error('Refusing to reuse a Docker Compose project that already has containers.');
  }

  ingressComposeStarted = true;
  await runCommand(
    'docker',
    [
      ...composeArgs,
      'up',
      '--detach',
      '--build',
      '--wait',
      '--wait-timeout',
      '600',
      '--quiet-pull'
    ],
    { env: ingressComposeEnvironment }
  );
}

async function stopNginxIngress() {
  if (!ingressComposeStarted || !ingressComposeProject || !ingressComposeFile) return true;
  try {
    await runCommand(
      'docker',
      [
        'compose',
        '-p',
        ingressComposeProject,
        '-f',
        ingressComposeFile,
        'down',
        '--volumes',
        '--remove-orphans',
        '--rmi',
        'local'
      ],
      { env: ingressComposeEnvironment }
    );
    ingressComposeStarted = false;
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExitOrTimeout(exitPromise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      exitPromise.then(() => true),
      new Promise((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function isPortClosed(port) {
  const server = createServer();
  try {
    await new Promise((resolvePort, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolvePort);
    });
    await new Promise((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose()))
    );
    return true;
  } catch {
    server.close();
    return false;
  }
}

async function waitForOwnedPortsToClose(ports) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await Promise.all(ports.map(isPortClosed))).every(Boolean)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

async function waitForReady(baseUrl, apiPort) {
  let processError;
  if (!nginxIngress) {
    stackProcess.once('error', (error) => {
      processError = error;
    });
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (shutdownRequested) throw new Error('The isolated E2E run was cancelled during startup.');
    if (processError) throw processError;
    if (!nginxIngress && (stackProcess.exitCode !== null || stackProcess.signalCode !== null)) {
      throw new Error(
        `The isolated app process stopped during startup (code=${stackProcess.exitCode}, signal=${stackProcess.signalCode}).`
      );
    }
    if (nginxIngress || existsSync(readyFile)) {
      if (!nginxIngress) {
        const [pid, port] = readFileSync(readyFile, 'utf8').trim().split(':').map(Number);
        if (!Number.isInteger(pid) || pid <= 0 || port !== apiPort) {
          throw new Error('The app wrote an invalid isolated-server readiness marker.');
        }
      }
      try {
        const response = await fetch(`${baseUrl}/api/health`, {
          signal: AbortSignal.timeout(1_000)
        });
        if (response.status === 200) return;
      } catch {
        // The dev frontend may still be compiling; poll without contacting shared ports.
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('The isolated UI/API did not become ready within 120 seconds.');
}

function writeWorkflowOutputs(paths) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `e2e_run_dir=${paths.runDir}\ne2e_results_file=${paths.resultsFile}\ne2e_report_dir=${paths.reportDir}\ne2e_output_dir=${paths.outputDir}\n`,
    'utf8'
  );
}

function startStack(fullStack, env, quiet = false) {
  if (fullStack) {
    const serverEntry = join(root, 'server', 'dist', 'index.js');
    if (!existsSync(serverEntry)) {
      throw new Error('Full-stack E2E requires a completed server/frontend build before launch.');
    }
    return spawn(process.execPath, [serverEntry], {
      cwd: root,
      env: {
        ...env,
        PORT: env.E2E_API_PORT,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        CORS_ORIGIN: env.E2E_BASE_URL,
        DISABLE_RATE_LIMIT: '0'
      },
      stdio: quiet ? 'ignore' : 'inherit',
      windowsHide: true
    });
  }
  return spawn(process.execPath, [join(root, 'scripts', 'e2e-dev-stack.mjs')], {
    cwd: root,
    env: { ...env, DISABLE_RATE_LIMIT: env.E2E_RATE_LIMIT === 'on' ? '0' : '1' },
    stdio: quiet ? ['ignore', 'ignore', 'ignore', 'ipc'] : ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true
  });
}

function stopStack() {
  if (!stopStackPromise) {
    stopStackPromise = (async () => {
      if (nginxIngress) return stopNginxIngress();
      const ingressStopped = await stopNginxIngress();
      if (!stackProcess || stackProcess.exitCode !== null || stackProcess.signalCode !== null)
        return ingressStopped;
      const exited = waitForExit(stackProcess);
      if (!fullStack && stackProcess.connected) {
        stackProcess.send({ type: 'shutdown' }, (error) => {
          if (error && stackProcess.exitCode === null && stackProcess.signalCode === null) {
            stackProcess.kill('SIGTERM');
          }
        });
      } else {
        stackProcess.kill('SIGTERM');
      }

      const graceful = await waitForProcessExitOrTimeout(exited, 15_000);
      if (graceful) return ingressStopped;

      if (stackProcess.exitCode === null && stackProcess.signalCode === null) {
        stackProcess.kill('SIGKILL');
      }
      return ingressStopped && (await waitForProcessExitOrTimeout(exited, 5_000));
    })();
  }
  return stopStackPromise;
}

function requestShutdown(signal = 'SIGINT') {
  if (shutdownRequested) return;
  shutdownRequested = true;
  if (testProcess && testProcess.exitCode === null && testProcess.signalCode === null) {
    testProcess.kill(signal);
  }
  void stopStack();
}

async function main() {
  if (shutdownRequested) throw new Error('The isolated E2E run was cancelled before startup.');
  if (!existsSync(playwrightCli)) {
    throw new Error('Playwright CLI is missing; install the repository dependencies first.');
  }

  const appPort = await availablePort();
  if (shutdownRequested) throw new Error('The isolated E2E run was cancelled before startup.');
  const apiPort = nginxIngress || fullStack ? appPort : await availablePort(new Set([appPort]));
  if (shutdownRequested) throw new Error('The isolated E2E run was cancelled before startup.');
  ownedPorts = nginxIngress || fullStack ? [appPort] : [appPort, apiPort];
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const paths = {
    runDir,
    databasePath: join(runDir, 'hogaria.sqlite'),
    resultsFile: join(runDir, 'results.json'),
    reportDir: join(runDir, 'playwright-report'),
    outputDir: join(runDir, 'artifacts')
  };
  const env = {
    ...process.env,
    E2E_RUN_DIR: runDir,
    E2E_STACK: nginxIngress ? 'ingress' : fullStack ? 'full-stack' : 'dev',
    E2E_EXTERNAL_STACK: '1',
    E2E_RATE_LIMIT: process.env.E2E_RATE_LIMIT ?? (fullStack || nginxIngress ? 'on' : 'off'),
    E2E_BASE_URL: baseUrl,
    E2E_FRONTEND_PORT: String(appPort),
    E2E_API_PORT: String(nginxIngress ? appPort : apiPort),
    E2E_API_URL: nginxIngress ? baseUrl : `http://127.0.0.1:${apiPort}`,
    E2E_SEED: `qa-${basename(runDir)}`,
    E2E_READY_FILE: readyFile,
    E2E_RESULTS_FILE: paths.resultsFile,
    E2E_REPORT_DIR: paths.reportDir,
    E2E_OUTPUT_DIR: paths.outputDir,
    DATABASE_PATH: paths.databasePath,
    PANTRY_IMAGE_SEARCH_FIXTURE: '1',
    E2E_NGINX_INGRESS: nginxIngress ? '1' : '0',
    ...(nginxIngress ? { JWT_SECRET: randomBytes(32).toString('base64url') } : {})
  };
  const processEnvs = liveSmoke
    ? isolatedProcessEnvironments(env)
    : { server: env, browser: env, playwright: env };
  if (nginxIngress) {
    processEnvs.browser = { ...env };
    processEnvs.playwright = { ...env };
    delete processEnvs.browser.JWT_SECRET;
    delete processEnvs.playwright.JWT_SECRET;
  }
  if (!liveSmoke) writeWorkflowOutputs(paths);

  if (shutdownRequested) throw new Error('The isolated E2E run was cancelled before startup.');
  reportSmokeProgress('isolated-stack-starting');
  if (nginxIngress) await startNginxIngress(appPort);
  else stackProcess = startStack(fullStack, processEnvs.server, liveSmoke);
  await waitForReady(baseUrl, apiPort);
  if (nginxIngress) {
    writeFileSync(join(runDir, 'ingress.ready'), `${baseUrl}\n`, { flag: 'wx' });
  }
  if (shutdownRequested) throw new Error('The isolated E2E run was cancelled before Playwright.');
  reportSmokeProgress('isolated-stack-ready');

  const playwrightCommandArgs = ['test', ...playwrightArgs];
  if (!liveSmoke) {
    console.log(
      `[hogaria] isolated Playwright (${env.E2E_STACK}) at ${baseUrl}; SQLite and artifacts are under OS temp.`
    );
  }
  reportSmokeProgress('playwright-starting');
  testProcess = spawn(process.execPath, [playwrightCli, ...playwrightCommandArgs], {
    cwd: root,
    env: processEnvs.playwright,
    stdio: liveSmoke ? 'ignore' : 'inherit',
    windowsHide: true
  });
  exitCode = await new Promise((resolveExit, reject) => {
    testProcess.once('error', reject);
    testProcess.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  reportLastLiveSmokeTestPhase();
  reportSmokeProgress(exitCode === 0 ? 'playwright-passed' : 'playwright-failed');

  if (!(await stopStack())) {
    throw new Error('The isolated app process did not stop; preserving its temporary data.');
  }
  const portsClosed = await waitForOwnedPortsToClose(ownedPorts);
  if (!portsClosed) {
    throw new Error(
      'An isolated app port is still listening; preserving its temp data and not attempting to stop an unknown process.'
    );
  }
  preserve = liveSmoke ? false : exitCode !== 0 || process.env.CI === 'true';
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => requestShutdown(signal));
}
process.on('message', (message) => {
  if (liveSmoke && message?.type === AI_LIVE_SMOKE_RUNNER_SHUTDOWN_MESSAGE) {
    requestShutdown('SIGINT');
  }
});

function sendSmokeRunnerCompletion(cleaned) {
  if (!liveSmoke || !process.connected) return;
  sendAiLiveSmokeRunnerCompletion({ cleaned });
}

try {
  reportSmokeProgress('run-dir-created');
  await main();
} catch (error) {
  if (liveSmoke) {
    reportSmokeProgress('runner-error');
    console.error('[hogaria] isolated AI smoke runner failed.');
  } else console.error(error instanceof Error ? error.message : String(error));
  preserve = !liveSmoke;
  exitCode = 1;
} finally {
  if (testProcess && testProcess.exitCode === null && testProcess.signalCode === null) {
    testProcess.kill('SIGINT');
    let stopped = await waitForProcessExitOrTimeout(waitForExit(testProcess), 15_000);
    if (!stopped && testProcess.exitCode === null && testProcess.signalCode === null) {
      testProcess.kill('SIGTERM');
      stopped = await waitForProcessExitOrTimeout(waitForExit(testProcess), 10_000);
    }
    if (!stopped) {
      preserve = true;
      exitCode = 1;
    }
  }
  if (!(await stopStack())) {
    preserve = true;
    exitCode = 1;
  }
  if (ownedPorts.length > 0 && !(await waitForOwnedPortsToClose(ownedPorts))) {
    preserve = true;
    exitCode = 1;
    if (!liveSmoke) {
      console.error(
        'An isolated app port is still listening; preserving its temp data and not attempting to stop an unknown process.'
      );
    }
  }

  const tempRoot = resolve(tmpdir());
  const target = resolve(runDir);
  const pathFromTemp = relative(tempRoot, target);
  const isOwned =
    basename(target).startsWith('hogaria-e2e-') &&
    pathFromTemp !== '' &&
    pathFromTemp !== '..' &&
    !pathFromTemp.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromTemp);
  if (!isOwned || lstatSync(runDir).isSymbolicLink()) {
    console.error(
      liveSmoke
        ? '[hogaria] refusing unsafe AI smoke cleanup.'
        : 'Refusing to clean an unowned or redirected E2E temp directory.'
    );
    exitCode = 1;
  } else if (preserve) {
    if (!liveSmoke) {
      console.log(`[hogaria] isolated artifacts preserved for inspection: ${runDir}`);
    }
  } else {
    try {
      rmSync(runDir, { recursive: true, force: false });
      runnerCleanupVerified = true;
      if (!liveSmoke) {
        console.log(
          '[hogaria] isolated database and artifacts cleaned after the owned app process stopped.'
        );
      }
    } catch {
      exitCode = 1;
      console.error(
        liveSmoke
          ? '[hogaria] isolated AI smoke data cleanup failed.'
          : 'The isolated E2E temp directory could not be cleaned.'
      );
    }
  }
  sendSmokeRunnerCompletion(runnerCleanupVerified);
}

process.exitCode = exitCode;
