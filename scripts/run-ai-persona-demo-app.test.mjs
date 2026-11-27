import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertDemoAppEnvironment,
  buildDemoChildEnvironment,
  stopOwnedProcess
} from './run-ai-persona-demo-app.mjs';

const DEMO_DATABASE_PATH = resolve(process.cwd(), '.tmp', 'ai-persona-demo', 'hogaria.sqlite');

test('requires the explicit demo mode and exact dedicated database path', () => {
  assert.deepEqual(
    assertDemoAppEnvironment({
      HOGARIA_DEMO_MODE: '1',
      HOGARIA_DEMO_RUN: '1',
      DATABASE_PATH: DEMO_DATABASE_PATH
    }),
    { databasePath: DEMO_DATABASE_PATH }
  );

  for (const env of [
    { HOGARIA_DEMO_MODE: '1', DATABASE_PATH: DEMO_DATABASE_PATH },
    {
      HOGARIA_DEMO_MODE: '1',
      HOGARIA_DEMO_RUN: '1',
      DATABASE_PATH: resolve(process.cwd(), 'data', 'hogaria.sqlite')
    },
    {
      HOGARIA_DEMO_MODE: '0',
      HOGARIA_DEMO_RUN: '0',
      DATABASE_PATH: DEMO_DATABASE_PATH
    }
  ]) {
    assert.throws(() => assertDemoAppEnvironment(env), /demo|DATABASE_PATH/i);
  }
});

test('passes only loopback demo settings and never inherits provider credentials', () => {
  const childEnv = buildDemoChildEnvironment(
    {
      PATH: 'C:/Windows/System32',
      SystemRoot: 'C:/Windows',
      OPENAI_API_KEY: 'must-not-leak',
      DATABASE_PATH: 'C:/data/normal.sqlite'
    },
    {
      databasePath: DEMO_DATABASE_PATH,
      apiPort: 32123,
      frontendPort: 43123,
      jwtSecret: 'ephemeral-demo-secret'
    }
  );

  assert.equal(childEnv.PATH, 'C:/Windows/System32');
  assert.equal(childEnv.DATABASE_PATH, DEMO_DATABASE_PATH);
  assert.equal(childEnv.HOGARIA_DEMO_MODE, '1');
  assert.equal(childEnv.HOST, '127.0.0.1');
  assert.equal(childEnv.NG_CLI_ANALYTICS, 'false');
  assert.equal(childEnv.PORT, '32123');
  assert.equal(childEnv.CORS_ORIGIN, 'http://127.0.0.1:43123');
  assert.equal(childEnv.JWT_SECRET, 'ephemeral-demo-secret');
  assert.equal('OPENAI_API_KEY' in childEnv, false);
});

test('exposes separate demo, seed, reset and real-regeneration package commands', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const { scripts } = packageJson;

  assert.match(scripts.demo, /ai-persona-demo\.ts app/);
  assert.match(scripts['demo:seed'], /ai-persona-demo\.ts seed/);
  assert.match(scripts['demo:db:reset'], /ai-persona-demo\.ts reset/);
  assert.match(scripts['demo:regenerate'], /ai-persona-demo\.ts regenerate/);
  assert.match(scripts['test:config'], /run-ai-persona-demo-app\.test\.mjs/);
  assert.match(scripts.dev, /pnpm --filter @hogaria\/server run dev/);
});

test('asks the demo API child to shut down over IPC before using a hard kill', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  const messages = [];
  const killSignals = [];
  child.send = (message, callback) => {
    messages.push(message);
    setImmediate(() => {
      child.exitCode = 0;
      child.connected = false;
      child.emit('exit', 0, null);
      callback?.(null);
    });
  };
  child.kill = (signal) => killSignals.push(signal);

  await stopOwnedProcess(child, { shutdownMessage: { type: 'shutdown' } });

  assert.deepEqual(messages, [{ type: 'shutdown' }]);
  assert.deepEqual(killSignals, []);
});

test('falls back to a signal if the demo API child rejects IPC shutdown', async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  const killSignals = [];
  child.send = (_message, callback) => callback?.(new Error('closed IPC'));
  child.kill = (signal) => {
    killSignals.push(signal);
    setImmediate(() => {
      child.signalCode = signal;
      child.connected = false;
      child.emit('exit', null, signal);
    });
  };

  await stopOwnedProcess(child, { shutdownMessage: { type: 'shutdown' } });

  assert.deepEqual(killSignals, ['SIGTERM']);
});
