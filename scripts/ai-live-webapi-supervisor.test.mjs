import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertSmokeRunDirectoryOwned,
  assertTcpPortAvailable,
  buildIsolatedWebApiEnvironment,
  cleanupSmokeRunDirectory,
  createWebApiAttestation,
  parseNetstatListenerPids,
  startIsolatedWebApi,
  validateLiveCompletionCount,
  validateWebApiAttestation
} from './ai-live-webapi-supervisor.mjs';

function makeRunDir() {
  return mkdtempSync(join(tmpdir(), 'hogaria-ai-real-smoke-test-'));
}

function expectedRuntime(runDir, { effectiveProfileDirectory } = {}) {
  const env = buildIsolatedWebApiEnvironment({
    runDir,
    webApiRoot: 'D:/projects/webApi',
    profileDirectory: 'D:/projects/webApi/.data/patchright-profile',
    nonce: 'synthetic-run-nonce-001'
  });
  return {
    env,
    actual: createWebApiAttestation({
      config: {
        host: env.HOST,
        port: Number(env.PORT),
        agenta: { enabled: false, captureContent: false, apiKey: '' },
        logs: { directory: env.LOG_DIR }
      },
      persistence: {
        databasePath: env.DATABASE_PATH,
        backupDirectory: env.DATABASE_BACKUP_DIR,
        sessionArtifactDirectory: env.SESSION_ARTIFACT_DIR,
        importLegacyChatMetadata: false
      },
      env,
      cwd: runDir,
      pid: 71234,
      effectiveProfileDirectory: effectiveProfileDirectory ?? env.PATCHRIGHT_USER_DATA_DIR
    })
  };
}

test('creates a minimal WebAPI environment with isolated persistence and tracing disabled', () => {
  const runDir = makeRunDir();
  try {
    const env = buildIsolatedWebApiEnvironment({
      runDir,
      webApiRoot: 'D:/projects/webApi',
      profileDirectory: 'D:/projects/webApi/.data/patchright-profile',
      nonce: 'synthetic-nonce-001',
      parentEnv: {
        PATH: 'C:/Windows/System32',
        SystemRoot: 'C:/Windows',
        TEMP: 'C:/Temp',
        HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN: 'secret-sentinel',
        AGENTA_ENABLED: 'true',
        AGENTA_API_KEY: 'secret-agenta-sentinel',
        DATABASE_PATH: 'D:/projects/webApi/.data/webapi.sqlite',
        NODE_OPTIONS: '--require=secret-hook'
      }
    });

    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.PORT, '3001');
    assert.equal(env.AGENTA_ENABLED, 'false');
    assert.equal(env.AGENTA_CAPTURE_CONTENT, 'false');
    assert.equal(env.AGENTA_API_KEY, '');
    assert.equal(env.DATABASE_IMPORT_LEGACY_CHAT_METADATA, 'false');
    assert.equal(
      env.PATCHRIGHT_USER_DATA_DIR,
      resolve('D:/projects/webApi/.data/patchright-profile')
    );
    assert.equal('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN' in env, false);
    assert.equal('NODE_OPTIONS' in env, false);
    assert.notEqual(env.DATABASE_PATH, 'D:/projects/webApi/.data/webapi.sqlite');
    for (const field of [
      'DATABASE_PATH',
      'DATABASE_BACKUP_DIR',
      'SESSION_ARTIFACT_DIR',
      'LOG_DIR',
      'HOGARIA_AI_REAL_SMOKE_WEBAPI_ATTESTATION_FILE'
    ]) {
      assert.equal(resolve(env[field]).startsWith(`${resolve(runDir)}\\`), true, field);
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('rejects unowned run directories and refuses cleanup until the owned process and port are gone', () => {
  const runDir = makeRunDir();
  try {
    assert.doesNotThrow(() => assertSmokeRunDirectoryOwned(runDir));
    assert.throws(() => assertSmokeRunDirectoryOwned(join(tmpdir(), '..', 'outside')));
    assert.throws(
      () => cleanupSmokeRunDirectory(runDir, { processExited: false, portClosed: true }),
      /process.*stopped/i
    );
    assert.throws(
      () => cleanupSmokeRunDirectory(runDir, { processExited: true, portClosed: false }),
      /port.*closed/i
    );
    assert.equal(cleanupSmokeRunDirectory(runDir, { processExited: true, portClosed: true }), true);
  } finally {
    if (existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
  }
});

test('attests effective WebAPI flags, run paths, nonce, process identity and listener ownership', () => {
  const runDir = makeRunDir();
  try {
    const { env, actual } = expectedRuntime(runDir);
    assert.doesNotThrow(() =>
      validateWebApiAttestation(actual, {
        expectedEnv: env,
        childPid: actual.pid,
        listenerPid: actual.pid,
        runDir
      })
    );
    assert.throws(
      () =>
        validateWebApiAttestation(
          { ...actual, agentaEnabled: true },
          {
            expectedEnv: env,
            childPid: actual.pid,
            listenerPid: actual.pid,
            runDir
          }
        ),
      /Agenta/i
    );
    assert.throws(
      () =>
        validateWebApiAttestation(
          { ...actual, databasePath: 'D:/projects/webApi/.data/webapi.sqlite' },
          {
            expectedEnv: env,
            childPid: actual.pid,
            listenerPid: actual.pid,
            runDir
          }
        ),
      /temporary run directory/i
    );
    assert.throws(
      () =>
        validateWebApiAttestation(actual, {
          expectedEnv: env,
          childPid: actual.pid,
          listenerPid: actual.pid + 1,
          runDir
        }),
      /owned by.*process/i
    );
    const mismatchedProfile = expectedRuntime(runDir, {
      effectiveProfileDirectory: 'D:/projects/webApi/.data/another-profile'
    });
    assert.equal(mismatchedProfile.actual.profileDirectoryMatches, false);
    assert.throws(
      () =>
        validateWebApiAttestation(mismatchedProfile.actual, {
          expectedEnv: mismatchedProfile.env,
          childPid: mismatchedProfile.actual.pid,
          listenerPid: mismatchedProfile.actual.pid,
          runDir
        }),
      /profile-or-import/i
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('parses only exact loopback TCP listeners from Windows netstat output', () => {
  const output = [
    '  TCP    127.0.0.1:3001       0.0.0.0:0              LISTENING       42',
    '  TCP    127.0.0.1:13001      0.0.0.0:0              LISTENING       43',
    '  TCP    0.0.0.0:3001         0.0.0.0:0              LISTENING       44',
    '  TCP    127.0.0.1:3001       127.0.0.1:50000        ESTABLISHED     45'
  ].join('\n');
  assert.deepEqual(parseNetstatListenerPids(output, 3001), [42]);
  assert.deepEqual(parseNetstatListenerPids(output, 3001, '0.0.0.0'), [44]);
});

test('allows only the expected nine or ten successful live completions', () => {
  assert.doesNotThrow(() => validateLiveCompletionCount(9));
  assert.doesNotThrow(() => validateLiveCompletionCount(10));
  for (const count of [0, 8, 11, Number.NaN]) {
    assert.throws(() => validateLiveCompletionCount(count), /completion count/i);
  }
});

test('vetoes an already occupied TCP port without sending any HTTP request', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await new Promise((resolveListen) => server.once('listening', resolveListen));
  const port = server.address().port;
  try {
    await assert.rejects(assertTcpPortAvailable(port), /already occupied/i);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

test('starts, attests and cleans up only its owned temporary WebAPI child', async () => {
  const fakeApiRoot = mkdtempSync(join(tmpdir(), 'fake-hogaria-webapi-'));
  const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  for (const relativePath of ['node_modules/tsx/dist/loader.mjs', 'tsconfig.json', 'src/main.ts']) {
    const filePath = join(fakeApiRoot, relativePath);
    mkdirSync(resolve(filePath, '..'), { recursive: true });
    writeFileSync(filePath, '', { flag: 'wx' });
  }

  let child;
  let runDir;
  let killCount = 0;
  const pid = 71235;
  try {
    const webApi = await startIsolatedWebApi({
      appRoot,
      webApiRoot: fakeApiRoot,
      profileDirectory: fakeApiRoot,
      assertPortAvailable: async (port) => assert.equal(port, 3001),
      isPortClosed: async (port) => port === 3001,
      spawnImpl: (executable, args, options) => {
        assert.equal(executable, process.execPath);
        assert.equal(args.includes(join(appRoot, 'scripts', 'ai-live-webapi-bootstrap.mjs')), true);
        assert.equal(options.shell, false);
        assert.equal(options.cwd.startsWith(`${resolve(tmpdir())}\\`), true);
        assert.equal(options.env.AGENTA_ENABLED, 'false');
        assert.equal('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN' in options.env, false);
        runDir = options.cwd;
        child = new EventEmitter();
        Object.assign(child, { pid, exitCode: null, signalCode: null });
        child.kill = (signal) => {
          killCount += 1;
          setTimeout(() => {
            child.signalCode = signal;
            child.emit('exit', null, signal);
          }, 5);
          return true;
        };

        const env = options.env;
        const attestation = createWebApiAttestation({
          config: {
            host: env.HOST,
            port: Number(env.PORT),
            agenta: { enabled: false, captureContent: false, apiKey: '' },
            logs: { directory: env.LOG_DIR }
          },
          persistence: {
            databasePath: env.DATABASE_PATH,
            backupDirectory: env.DATABASE_BACKUP_DIR,
            sessionArtifactDirectory: env.SESSION_ARTIFACT_DIR,
            importLegacyChatMetadata: false
          },
          env,
          effectiveProfileDirectory: env.PATCHRIGHT_USER_DATA_DIR,
          cwd: options.cwd,
          pid
        });
        writeFileSync(
          env.HOGARIA_AI_REAL_SMOKE_WEBAPI_ATTESTATION_FILE,
          JSON.stringify(attestation),
          {
            flag: 'wx'
          }
        );
        return child;
      },
      listenerPids: () => [pid],
      fetchImpl: async (url) =>
        Response.json(new URL(url).pathname === '/' ? { name: 'web-api' } : { ok: true }),
      timeoutMs: 1_000
    });

    assert.equal(webApi.origin, 'http://127.0.0.1:3001');
    assert.equal(existsSync(runDir), true);
    assert.equal(await webApi.cleanup(), true);
    assert.equal(await webApi.cleanup(), true);
    assert.equal(killCount, 1);
    assert.equal(existsSync(runDir), false);
  } finally {
    if (runDir && existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
    rmSync(fakeApiRoot, { recursive: true, force: true });
  }
});

test('removes the owned run directory when startup configuration fails before spawn', async () => {
  let spawnCalled = false;
  let cleanupCalled = false;
  await assert.rejects(
    startIsolatedWebApi({
      port: 3002,
      assertPortAvailable: async () => undefined,
      isPortClosed: async () => true,
      spawnImpl: () => {
        spawnCalled = true;
        throw new Error('must not spawn');
      },
      cleanupRunDirectory: (runDir, options) => {
        cleanupCalled = true;
        return cleanupSmokeRunDirectory(runDir, options);
      }
    }),
    /startup or safety attestation/i
  );
  assert.equal(spawnCalled, false);
  assert.equal(cleanupCalled, true);
});

test('cancellation during WebAPI readiness stops the owned process before deleting its temp directory', async () => {
  const fakeApiRoot = mkdtempSync(join(tmpdir(), 'fake-hogaria-webapi-cancel-'));
  const appRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  for (const relativePath of ['node_modules/tsx/dist/loader.mjs', 'tsconfig.json', 'src/main.ts']) {
    const filePath = join(fakeApiRoot, relativePath);
    mkdirSync(resolve(filePath, '..'), { recursive: true });
    writeFileSync(filePath, '', { flag: 'wx' });
  }

  const controller = new AbortController();
  const pid = 71236;
  let child;
  let runDir;
  let killCount = 0;
  let api;
  try {
    await assert.rejects(
      (async () => {
        api = await startIsolatedWebApi({
          appRoot,
          webApiRoot: fakeApiRoot,
          profileDirectory: fakeApiRoot,
          signal: controller.signal,
          assertPortAvailable: async (port) => assert.equal(port, 3001),
          isPortClosed: async (port) => port === 3001,
          spawnImpl: (_executable, _args, options) => {
            runDir = options.cwd;
            child = new EventEmitter();
            Object.assign(child, { pid, exitCode: null, signalCode: null });
            child.kill = (signal) => {
              killCount += 1;
              setTimeout(() => {
                child.signalCode = signal;
                child.emit('exit', null, signal);
              }, 1);
              return true;
            };
            const env = options.env;
            const attestation = createWebApiAttestation({
              config: {
                host: env.HOST,
                port: Number(env.PORT),
                agenta: { enabled: false, captureContent: false, apiKey: '' },
                logs: { directory: env.LOG_DIR }
              },
              persistence: {
                databasePath: env.DATABASE_PATH,
                backupDirectory: env.DATABASE_BACKUP_DIR,
                sessionArtifactDirectory: env.SESSION_ARTIFACT_DIR,
                importLegacyChatMetadata: false
              },
              env,
              effectiveProfileDirectory: env.PATCHRIGHT_USER_DATA_DIR,
              cwd: options.cwd,
              pid
            });
            writeFileSync(
              env.HOGARIA_AI_REAL_SMOKE_WEBAPI_ATTESTATION_FILE,
              JSON.stringify(attestation),
              { flag: 'wx' }
            );
            return child;
          },
          listenerPids: () => [pid],
          fetchImpl: async (url) => {
            const path = new URL(url).pathname;
            if (path === '/health/ready') controller.abort();
            return Response.json(path === '/' ? { name: 'web-api' } : { ok: true });
          },
          timeoutMs: 1_000
        });
      })(),
      /cancel/i
    );

    assert.equal(killCount, 1);
    assert.equal(existsSync(runDir), false);
  } finally {
    if (api) await api.cleanup();
    if (runDir && existsSync(runDir)) rmSync(runDir, { recursive: true, force: true });
    rmSync(fakeApiRoot, { recursive: true, force: true });
  }
});
