import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AI_LIVE_WEBAPI_RUN_PREFIX = 'hogaria-ai-real-smoke-';
export const AI_LIVE_WEBAPI_HOST = '127.0.0.1';
export const AI_LIVE_WEBAPI_PORT = 3001;
export const AI_LIVE_WEBAPI_ORIGIN = `http://${AI_LIVE_WEBAPI_HOST}:${AI_LIVE_WEBAPI_PORT}`;
export const AI_LIVE_SMOKE_MIN_COMPLETIONS = 9;
export const AI_LIVE_SMOKE_MAX_COMPLETIONS = 10;

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP_PATH = join(APP_ROOT, 'scripts', 'ai-live-webapi-bootstrap.mjs');

function isWithin(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function pathsEqual(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function createSmokeRunDirectory({ tempDirectory = tmpdir(), mkdtemp = mkdtempSync } = {}) {
  const runDir = mkdtemp(join(resolve(tempDirectory), AI_LIVE_WEBAPI_RUN_PREFIX));
  assertSmokeRunDirectoryOwned(runDir, { tempDirectory });
  return resolve(runDir);
}

export function assertSmokeRunDirectoryOwned(runDir, { tempDirectory = tmpdir() } = {}) {
  const resolved = resolve(runDir);
  const tempRoot = resolve(tempDirectory);
  if (
    basename(resolved).startsWith(AI_LIVE_WEBAPI_RUN_PREFIX) !== true ||
    resolve(dirname(resolved)) !== tempRoot
  ) {
    throw new Error('AI smoke run directory is outside its owned temporary root.');
  }
  let stats;
  try {
    stats = lstatSync(resolved);
  } catch {
    throw new Error('AI smoke run directory is missing.');
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('AI smoke run directory is redirected or not a directory.');
  }
  return resolved;
}

export function cleanupSmokeRunDirectory(
  runDir,
  { processExited, portClosed, tempDirectory = tmpdir(), remove = rmSync } = {}
) {
  const owned = assertSmokeRunDirectoryOwned(runDir, { tempDirectory });
  if (processExited !== true) {
    throw new Error('AI smoke cleanup requires the owned WebAPI process to be stopped.');
  }
  if (portClosed !== true) {
    throw new Error('AI smoke cleanup requires the WebAPI port to be closed.');
  }
  remove(owned, { recursive: true, force: false });
  return true;
}

function buildMinimalParentEnvironment(parentEnv) {
  const allowed = [
    'PATH',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'ComSpec',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'HOME'
  ];
  return Object.fromEntries(
    allowed.filter((key) => typeof parentEnv[key] === 'string').map((key) => [key, parentEnv[key]])
  );
}

export function buildIsolatedWebApiEnvironment({
  runDir,
  webApiRoot,
  profileDirectory,
  nonce,
  parentEnv = process.env,
  port = AI_LIVE_WEBAPI_PORT
}) {
  const ownedRunDir = assertSmokeRunDirectoryOwned(runDir);
  const apiRoot = resolve(webApiRoot);
  const profile = resolve(profileDirectory);
  if (typeof nonce !== 'string' || !/^[a-zA-Z0-9-]{16,}$/u.test(nonce)) {
    throw new Error('AI smoke WebAPI attestation nonce is invalid.');
  }
  if (port !== AI_LIVE_WEBAPI_PORT) {
    throw new Error('AI smoke WebAPI must use its explicitly allowlisted loopback port.');
  }

  return {
    ...buildMinimalParentEnvironment(parentEnv),
    AGENTA_API_KEY: '',
    AGENTA_CAPTURE_CONTENT: 'false',
    AGENTA_ENABLED: 'false',
    DATABASE_BACKUP_DIR: join(ownedRunDir, 'backups'),
    DATABASE_IMPORT_LEGACY_CHAT_METADATA: 'false',
    DATABASE_PATH: join(ownedRunDir, 'webapi.sqlite'),
    HOST: AI_LIVE_WEBAPI_HOST,
    LOG_DIR: join(ownedRunDir, 'logs'),
    NODE_ENV: 'development',
    PATCHRIGHT_USER_DATA_DIR: profile,
    PORT: String(port),
    SESSION_ARTIFACT_DIR: join(ownedRunDir, 'session-artifacts'),
    TSX_TSCONFIG_PATH: join(apiRoot, 'tsconfig.json'),
    HOGARIA_AI_REAL_SMOKE_WEBAPI_ATTESTATION_FILE: join(ownedRunDir, 'webapi.attestation.json'),
    HOGARIA_AI_REAL_SMOKE_WEBAPI_NONCE: nonce,
    HOGARIA_AI_REAL_SMOKE_PROFILE_DIRECTORY: profile,
    HOGARIA_AI_REAL_SMOKE_WEBAPI_ROOT: apiRoot,
    HOGARIA_AI_REAL_SMOKE_WEBAPI_RUN_DIR: ownedRunDir
  };
}

export function createWebApiAttestation({
  config,
  persistence,
  effectiveProfileDirectory,
  env = process.env,
  cwd = process.cwd(),
  pid = process.pid
}) {
  const resolvedCwd = resolve(cwd);
  return {
    pid,
    nonce: env.HOGARIA_AI_REAL_SMOKE_WEBAPI_NONCE,
    webApiRoot: resolve(env.HOGARIA_AI_REAL_SMOKE_WEBAPI_ROOT ?? ''),
    cwd: resolvedCwd,
    host: config.host,
    port: config.port,
    agentaEnabled: config.agenta.enabled,
    agentaCaptureContent: config.agenta.captureContent,
    agentaApiKeyPresent: Boolean(config.agenta.apiKey),
    profileDirectoryMatches:
      typeof effectiveProfileDirectory === 'string' &&
      pathsEqual(effectiveProfileDirectory, env.HOGARIA_AI_REAL_SMOKE_PROFILE_DIRECTORY ?? ''),
    databasePath: resolve(resolvedCwd, persistence.databasePath),
    backupDirectory: resolve(resolvedCwd, persistence.backupDirectory),
    sessionArtifactDirectory: resolve(resolvedCwd, persistence.sessionArtifactDirectory),
    logDirectory: resolve(resolvedCwd, config.logs.directory),
    importLegacyChatMetadata: persistence.importLegacyChatMetadata
  };
}

function assertSafeAttestedPaths(attestation, runDir) {
  for (const field of [
    'databasePath',
    'backupDirectory',
    'sessionArtifactDirectory',
    'logDirectory'
  ]) {
    if (!isWithin(runDir, attestation[field])) {
      throw new Error('WebAPI persistence is not contained in the temporary run directory.');
    }
  }
}

export function validateWebApiAttestation(
  attestation,
  { expectedEnv, childPid, listenerPid, runDir }
) {
  const ownedRunDir = assertSmokeRunDirectoryOwned(runDir);
  const expectedRoot = resolve(expectedEnv.HOGARIA_AI_REAL_SMOKE_WEBAPI_ROOT);
  const failures = [];
  if (!attestation || typeof attestation !== 'object') {
    throw new Error('WebAPI process attestation is missing.');
  }
  if (
    !Number.isInteger(childPid) ||
    attestation.pid !== childPid ||
    (listenerPid !== undefined && listenerPid !== childPid)
  ) {
    throw new Error('WebAPI loopback listener is not owned by the smoke process.');
  }
  if (attestation.nonce !== expectedEnv.HOGARIA_AI_REAL_SMOKE_WEBAPI_NONCE) {
    failures.push('nonce');
  }
  if (
    !pathsEqual(
      expectedEnv.HOGARIA_AI_REAL_SMOKE_WEBAPI_ATTESTATION_FILE,
      join(ownedRunDir, 'webapi.attestation.json')
    )
  ) {
    failures.push('attestation-path');
  }
  if (
    !pathsEqual(attestation.webApiRoot, expectedRoot) ||
    !pathsEqual(attestation.cwd, ownedRunDir)
  ) {
    failures.push('root');
  }
  if (attestation.host !== AI_LIVE_WEBAPI_HOST || attestation.port !== AI_LIVE_WEBAPI_PORT) {
    failures.push('origin');
  }
  if (
    attestation.agentaEnabled ||
    attestation.agentaCaptureContent ||
    attestation.agentaApiKeyPresent
  ) {
    throw new Error('WebAPI Agenta tracing/content capture must be disabled before startup.');
  }
  if (
    attestation.importLegacyChatMetadata !== false ||
    attestation.profileDirectoryMatches !== true
  ) {
    failures.push('profile-or-import');
  }
  const expectedPaths = {
    databasePath: expectedEnv.DATABASE_PATH,
    backupDirectory: expectedEnv.DATABASE_BACKUP_DIR,
    sessionArtifactDirectory: expectedEnv.SESSION_ARTIFACT_DIR,
    logDirectory: expectedEnv.LOG_DIR
  };
  for (const [field, expectedPath] of Object.entries(expectedPaths)) {
    if (!pathsEqual(attestation[field], expectedPath)) failures.push(field);
  }
  assertSafeAttestedPaths(attestation, ownedRunDir);
  if (failures.length) {
    throw new Error(
      `WebAPI effective configuration did not match its isolated attestation (${failures.join(', ')}).`
    );
  }
  return true;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseNetstatListenerPids(output, port, address = AI_LIVE_WEBAPI_HOST) {
  const linePattern = new RegExp(
    `^\\s*TCP\\s+${escapeRegExp(address)}:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`,
    'i'
  );
  const matches = [];
  for (const line of String(output).split(/\r?\n/u)) {
    const match = line.match(linePattern);
    if (match) matches.push(Number(match[1]));
  }
  return [...new Set(matches)];
}

export async function assertTcpPortAvailable(
  port,
  { host = AI_LIVE_WEBAPI_HOST, createServerImpl = createServer } = {}
) {
  const server = createServerImpl();
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, host, resolveListen);
    });
  } catch {
    throw new Error('The allowlisted WebAPI loopback port is already occupied.');
  }
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  );
}

async function isTcpPortClosed(port) {
  try {
    await assertTcpPortAvailable(port);
    return true;
  } catch {
    return false;
  }
}

function getListenerPids(port, host = AI_LIVE_WEBAPI_HOST) {
  if (process.platform !== 'win32') {
    throw new Error('This manual AI smoke cannot attest TCP listener ownership on this platform.');
  }
  let output;
  try {
    output = execFileSync('netstat.exe', ['-ano', '-p', 'TCP'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    });
  } catch {
    throw new Error('Could not verify ownership of the WebAPI loopback listener.');
  }
  return parseNetstatListenerPids(output, port, host);
}

function readAttestation(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('WebAPI process attestation is invalid.');
  }
}

async function waitForWebApiReady({
  child,
  env,
  runDir,
  signal,
  timeoutMs = 60_000,
  fetchImpl = fetch,
  listenerPids = getListenerPids
}) {
  const attestationPath = env.HOGARIA_AI_REAL_SMOKE_WEBAPI_ATTESTATION_FILE;
  const deadline = Date.now() + timeoutMs;
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (spawnError || child.exitCode !== null || child.signalCode !== null) {
      throw new Error('The isolated WebAPI process did not remain running.');
    }
    if (!existsSync(attestationPath)) {
      await waitForStartupPoll(signal);
      continue;
    }

    const attestation = readAttestation(attestationPath);
    const owners = listenerPids(AI_LIVE_WEBAPI_PORT);
    if (owners.length > 0 && (owners.length !== 1 || owners[0] !== child.pid)) {
      throw new Error('The WebAPI loopback port is owned by an unexpected process.');
    }
    if (owners.length !== 1) {
      await waitForStartupPoll(signal);
      continue;
    }
    validateWebApiAttestation(attestation, {
      expectedEnv: env,
      childPid: child.pid,
      listenerPid: owners[0],
      runDir
    });

    try {
      const ready = await fetchImpl(`${AI_LIVE_WEBAPI_ORIGIN}/health/ready`, {
        redirect: 'error',
        signal: AbortSignal.timeout(1_000)
      });
      signal?.throwIfAborted();
      if (ready.status !== 200) {
        await waitForStartupPoll(signal);
        continue;
      }
      const identity = await fetchImpl(`${AI_LIVE_WEBAPI_ORIGIN}/`, {
        redirect: 'error',
        signal: AbortSignal.timeout(1_000)
      });
      signal?.throwIfAborted();
      const service = await identity.json();
      if (identity.status !== 200 || service?.name !== 'web-api') {
        throw new Error('The owned process did not attest the expected WebAPI identity.');
      }
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('expected WebAPI identity')) throw error;
      signal?.throwIfAborted();
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
  }
  throw new Error('The isolated WebAPI did not pass its ready/ownership checks in time.');
}

function waitForStartupPoll(signal, delayMs = 150) {
  signal?.throwIfAborted();
  return new Promise((resolvePoll, rejectPoll) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolvePoll();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      rejectPoll(new Error('The isolated WebAPI startup was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForChildExit(child, timeoutMs) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return true;
  let timeout;
  const exit = new Promise((resolveExit) => child.once('exit', () => resolveExit(true)));
  const ended = await Promise.race([
    exit,
    new Promise((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
    })
  ]);
  if (timeout) clearTimeout(timeout);
  return ended;
}

async function stopOwnedChild(child, timeoutMs = 15_000) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return true;
  try {
    child.kill('SIGTERM');
  } catch {
    return false;
  }
  return waitForChildExit(child, timeoutMs);
}

export async function startIsolatedWebApi({
  appRoot = APP_ROOT,
  webApiRoot = resolve(appRoot, '..', 'webApi'),
  profileDirectory,
  port = AI_LIVE_WEBAPI_PORT,
  assertPortAvailable = assertTcpPortAvailable,
  isPortClosed = (targetPort) => isTcpPortClosed(targetPort),
  cleanupRunDirectory = cleanupSmokeRunDirectory,
  spawnImpl = spawn,
  listenerPids = getListenerPids,
  fetchImpl = fetch,
  timeoutMs = 60_000,
  signal
} = {}) {
  signal?.throwIfAborted();
  await assertPortAvailable(port);
  signal?.throwIfAborted();
  const runDir = createSmokeRunDirectory();
  let child;
  try {
    signal?.throwIfAborted();
    const apiRoot = resolve(webApiRoot);
    const profile =
      profileDirectory ??
      process.env.PATCHRIGHT_USER_DATA_DIR ??
      join(apiRoot, '.data', 'patchright-profile');
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const env = buildIsolatedWebApiEnvironment({
      runDir,
      webApiRoot: apiRoot,
      profileDirectory: profile,
      nonce,
      port
    });
    env.HOGARIA_AI_REAL_SMOKE_PROFILE_DIRECTORY = env.PATCHRIGHT_USER_DATA_DIR;

    const loaderPath = join(apiRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs');
    const tsconfigPath = join(apiRoot, 'tsconfig.json');
    const bootstrapPath = join(resolve(appRoot), 'scripts', 'ai-live-webapi-bootstrap.mjs');
    const mainPath = join(apiRoot, 'src', 'main.ts');
    if (![loaderPath, tsconfigPath, bootstrapPath, mainPath].every(existsSync)) {
      throw new Error('The isolated WebAPI runtime files are unavailable.');
    }

    child = spawnImpl(
      process.execPath,
      ['--import', pathToFileURL(loaderPath).href, bootstrapPath],
      {
        cwd: runDir,
        env,
        shell: false,
        stdio: 'ignore',
        windowsHide: true
      }
    );
    await waitForWebApiReady({ child, env, runDir, signal, timeoutMs, fetchImpl, listenerPids });
    signal?.throwIfAborted();
  } catch {
    const processExited = await stopOwnedChild(child);
    let portClosed = false;
    try {
      portClosed = await isPortClosed(port);
    } catch {
      portClosed = false;
    }
    let temporaryDataRemoved = false;
    if (processExited && portClosed) {
      try {
        cleanupRunDirectory(runDir, { processExited, portClosed });
        temporaryDataRemoved = true;
      } catch {
        // Keep the original safe startup failure; the temporary directory is preserved.
      }
    }
    throw new Error(
      processExited && portClosed && temporaryDataRemoved
        ? signal?.aborted
          ? 'The isolated WebAPI startup was cancelled and safely rolled back.'
          : 'The isolated WebAPI failed its startup or safety attestation.'
        : 'The isolated WebAPI did not stop cleanly; temporary data was preserved.'
    );
  }

  let cleanupPromise;
  return {
    origin: AI_LIVE_WEBAPI_ORIGIN,
    runDir,
    cleanup() {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        const processExited = await stopOwnedChild(child);
        const portClosed = await isPortClosed(port);
        if (!processExited || !portClosed) {
          throw new Error(
            'The isolated WebAPI did not stop cleanly; temporary data was preserved.'
          );
        }
        cleanupRunDirectory(runDir, { processExited, portClosed });
        return true;
      })();
      return cleanupPromise;
    }
  };
}

export function validateLiveCompletionCount(count) {
  if (
    !Number.isInteger(count) ||
    count < AI_LIVE_SMOKE_MIN_COMPLETIONS ||
    count > AI_LIVE_SMOKE_MAX_COMPLETIONS
  ) {
    throw new Error('The live AI smoke completion count is outside its 9–10 completion contract.');
  }
  return true;
}
