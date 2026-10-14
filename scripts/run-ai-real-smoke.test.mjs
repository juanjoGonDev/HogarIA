import assert from 'node:assert/strict';
import test from 'node:test';

import { runAiLiveSmoke } from './run-ai-real-smoke.mjs';
import {
  AI_LIVE_RECEIPT_SMOKE_MAX_REQUEST_BYTES,
  AI_LIVE_RECEIPT_SMOKE_TICKET_COUNT,
  AI_LIVE_SMOKE_ENV,
  isSuccessfulAiLiveSmokeResult
} from './ai-live-smoke-safety.mjs';
import { AI_LIVE_SMOKE_DEADLINES } from './ai-live-smoke-contract.mjs';

function createGuardedDependencies(calls) {
  const untouched = (name) => async () => {
    calls.push(name);
    throw new Error(`Unexpected live dependency call: ${name}`);
  };

  return {
    prepareExistingAiLiveSmokeSession: untouched('existing-session'),
    startIsolatedWebApi: untouched('webapi'),
    prepareAiLiveSmokeSession: untouched('session'),
    createAiLiveProxy: untouched('proxy'),
    createAiLiveSmokeRunnerEnvironment: untouched('runner-environment'),
    runAiLiveSmokeRunner: untouched('playwright')
  };
}

test('coordinator rejects missing opt-in before any live setup', async () => {
  const calls = [];
  await assert.rejects(
    runAiLiveSmoke({ env: {}, dependencies: createGuardedDependencies(calls) }),
    /explicit opt-in/
  );
  assert.deepEqual(calls, []);
});

test('coordinator rejects CI before any live setup', async () => {
  const calls = [];
  await assert.rejects(
    runAiLiveSmoke({
      env: { [AI_LIVE_SMOKE_ENV.optIn]: '1', CI: 'true' },
      dependencies: createGuardedDependencies(calls)
    }),
    /forbidden in CI/
  );
  assert.deepEqual(calls, []);
});

test('coordinator rejects an incomplete receipt-only request before any live setup', async () => {
  const calls = [];
  await assert.rejects(
    runAiLiveSmoke({
      env: {
        [AI_LIVE_SMOKE_ENV.optIn]: '1',
        [AI_LIVE_SMOKE_ENV.receiptsOnly]: '1',
        [AI_LIVE_SMOKE_ENV.receiptSelection]: 'unsubmitted-only'
      },
      dependencies: createGuardedDependencies(calls)
    }),
    /absolute local receipt directory/i
  );
  assert.deepEqual(calls, []);
});

test('long-ticket-only coordinator budgets and validates exactly one safe receipt', async () => {
  const proxyCalls = [
    {
      status: 200,
      stream: true,
      schemaName: 'receipt',
      requestContract: {
        strictJsonSchema: true,
        inventoryJsonAttachmentCount: 1,
        receiptAttachmentCount: 1
      }
    }
  ];
  const errors = [];
  const successes = [];
  const selection = 'long-ticket-only';
  const result = await runAiLiveSmoke({
    env: {
      [AI_LIVE_SMOKE_ENV.optIn]: '1',
      [AI_LIVE_SMOKE_ENV.receiptsOnly]: '1',
      [AI_LIVE_SMOKE_ENV.receiptSelection]: selection,
      [AI_LIVE_SMOKE_ENV.receiptDirectory]: 'C:/Users/example/tickets',
      [AI_LIVE_SMOKE_ENV.preferredJpegOrdinal]: '2'
    },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-existing-webapi-token',
        model: 'gpt-5',
        cleanup: async () => {}
      }),
      createAiLiveProxy: async (input) => {
        assert.equal(input.maxCalls, 1);
        assert.equal(input.maxRequestBytes, AI_LIVE_RECEIPT_SMOKE_MAX_REQUEST_BYTES);
        assert.equal(input.requireReceiptAttachments, true);
        return {
          clientToken: 'synthetic-proxy-token',
          baseUrl: 'http://127.0.0.1:43210/v1',
          metrics: { calls: proxyCalls },
          close: async () => {}
        };
      },
      createAiLiveSmokeRunnerEnvironment: (parentEnv) => {
        assert.equal(parentEnv[AI_LIVE_SMOKE_ENV.receiptSelection], selection);
        return { runnerOnly: true };
      },
      runAiLiveSmokeRunner: async () => ({
        code: 0,
        cancelled: false,
        timedOut: false,
        runnerCleaned: true
      }),
      isSuccessfulAiLiveSmokeResult
    },
    writeError: (message) => errors.push(message),
    writeSuccess: (message) => successes.push(message),
    writeProgress: () => {}
  });

  assert.equal(result, 0);
  assert.deepEqual(errors, []);
  assert.equal(successes.length, 1);
  assert.deepEqual(JSON.parse(successes[0]), {
    result: 'passed',
    provider: 'local WebAPI :3001',
    model: 'gpt-5',
    sourceCount: 6,
    tickets: 1,
    requests: 1,
    completions: 1,
    verifiedStrictSchemaRequests: 1,
    verifiedInventoryJsonAttachments: 1,
    verifiedReceiptAttachments: 1,
    elapsedMs: 0,
    recoveredFallbacks: 0
  });
});

test('recipe-only coordinator pins a strict generated_recipe smoke to one completion', async () => {
  const calls = [];
  const successMessages = [];
  const errors = [];
  const recipeCall = {
    status: 200,
    schemaName: 'generated_recipe',
    requestContract: { strictJsonSchema: true, recipeTextUnbounded: true },
    responseFormat: {
      hasChoices: true,
      messageContentType: 'text',
      isJsonObject: true,
      finishReason: 'stop'
    },
    elapsedMs: 25,
    usage: { promptTokens: 140, completionTokens: 420, totalTokens: 560, costUsd: 0.01 }
  };
  const proxyMetrics = {
    calls: [recipeCall],
    requestAttempts: 1,
    rejectedRequests: 0,
    failed: false
  };
  const result = await runAiLiveSmoke({
    env: {
      [AI_LIVE_SMOKE_ENV.optIn]: '1',
      HOGARIA_AI_REAL_SMOKE_RECIPE_ONLY: '1'
    },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-existing-webapi-token',
        model: 'gpt-5',
        cleanup: async () => calls.push('session:cleanup')
      }),
      createAiLiveProxy: async (input) => {
        calls.push('proxy:create');
        assert.equal(input.maxCalls, 1);
        assert.equal(input.expectedSchemaName, 'generated_recipe');
        return {
          clientToken: 'synthetic-proxy-token',
          baseUrl: 'http://127.0.0.1:43210/v1',
          metrics: proxyMetrics,
          close: async () => calls.push('proxy:close')
        };
      },
      createAiLiveSmokeRunnerEnvironment: (_parentEnv, options) => {
        calls.push('runner:environment');
        assert.equal(options.recipeOnly, true);
        return { isolated: true };
      },
      runAiLiveSmokeRunner: async () => {
        calls.push('runner:start');
        return { code: 0, cancelled: false, timedOut: false, runnerCleaned: true };
      },
      isSuccessfulAiLiveSmokeResult
    },
    writeError: (message) => errors.push(message),
    writeSuccess: (message) => successMessages.push(message),
    writeProgress: () => {}
  });

  assert.equal(result, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, [
    'proxy:create',
    'runner:environment',
    'runner:start',
    'proxy:close',
    'session:cleanup'
  ]);
  assert.equal(successMessages.length, 1);
  assert.deepEqual(JSON.parse(successMessages[0]), {
    result: 'passed',
    provider: 'local WebAPI :3001',
    model: 'gpt-5',
    completions: 1,
    verifiedStrictJsonSchema: true,
    verifiedUnboundedRecipeText: true,
    verifiedValidatedJsonResponse: true,
    elapsedMs: 25,
    usage: { promptTokens: 140, completionTokens: 420, totalTokens: 560, costUsd: 0.01 }
  });
});

test('preferred-jpeg-only coordinator budgets and validates exactly one safe receipt', async () => {
  const proxyCalls = [
    {
      status: 200,
      stream: true,
      schemaName: 'receipt',
      requestContract: {
        strictJsonSchema: true,
        inventoryJsonAttachmentCount: 1,
        receiptAttachmentCount: 1
      }
    }
  ];
  const errors = [];
  const successes = [];
  const selection = 'preferred-jpeg-only';
  const result = await runAiLiveSmoke({
    env: {
      [AI_LIVE_SMOKE_ENV.optIn]: '1',
      [AI_LIVE_SMOKE_ENV.receiptsOnly]: '1',
      [AI_LIVE_SMOKE_ENV.receiptSelection]: selection,
      [AI_LIVE_SMOKE_ENV.receiptDirectory]: 'C:/Users/example/tickets',
      [AI_LIVE_SMOKE_ENV.preferredJpegOrdinal]: '2'
    },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-existing-webapi-token',
        model: 'gpt-5',
        cleanup: async () => {}
      }),
      createAiLiveProxy: async (input) => {
        assert.equal(input.maxCalls, 2);
        assert.equal(input.maxRequestBytes, AI_LIVE_RECEIPT_SMOKE_MAX_REQUEST_BYTES);
        assert.equal(input.requireReceiptAttachments, true);
        return {
          clientToken: 'synthetic-proxy-token',
          baseUrl: 'http://127.0.0.1:43210/v1',
          metrics: { calls: proxyCalls },
          close: async () => {}
        };
      },
      createAiLiveSmokeRunnerEnvironment: (parentEnv) => {
        assert.equal(parentEnv[AI_LIVE_SMOKE_ENV.receiptSelection], selection);
        return { runnerOnly: true };
      },
      runAiLiveSmokeRunner: async () => ({
        code: 0,
        cancelled: false,
        timedOut: false,
        runnerCleaned: true
      }),
      isSuccessfulAiLiveSmokeResult
    },
    writeError: (message) => errors.push(message),
    writeSuccess: (message) => successes.push(message),
    writeProgress: () => {}
  });

  assert.equal(result, 0);
  assert.deepEqual(errors, []);
  assert.equal(successes.length, 1);
  assert.deepEqual(JSON.parse(successes[0]), {
    result: 'passed',
    provider: 'local WebAPI :3001',
    model: 'gpt-5',
    sourceCount: 6,
    tickets: 1,
    requests: 1,
    completions: 1,
    verifiedStrictSchemaRequests: 1,
    verifiedInventoryJsonAttachments: 1,
    verifiedReceiptAttachments: 1,
    elapsedMs: 0,
    recoveredFallbacks: 0
  });
});

test('coordinator marks a failed runner red and cleans only its existing-WebAPI resources', async () => {
  const calls = [];
  const errors = [];
  const secretSentinel = 'synthetic-webapi-token-not-for-logs';
  const result = await runAiLiveSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1' },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => {
        calls.push('existing:prepare');
        return {
          origin: 'http://127.0.0.1:3001',
          token: secretSentinel,
          model: 'gpt-5',
          cleanup: async () => calls.push('existing:cleanup')
        };
      },
      startIsolatedWebApi: async () => {
        calls.push('legacy:webapi');
        throw new Error('The live coordinator must not start WebAPI.');
      },
      prepareAiLiveSmokeSession: async () => {
        calls.push('legacy:settings');
        throw new Error('The live coordinator must not mutate WebAPI settings.');
      },
      createAiLiveProxy: async () => {
        calls.push('proxy:start');
        return {
          clientToken: 'synthetic-proxy-credential',
          baseUrl: 'http://127.0.0.1:43210/v1',
          metrics: { calls: [] },
          close: async () => calls.push('proxy:close')
        };
      },
      createAiLiveSmokeRunnerEnvironment: () => {
        calls.push('runner-environment');
        return { synthetic: 'runner-env' };
      },
      runAiLiveSmokeRunner: async () => {
        calls.push('playwright');
        return { code: 1, timedOut: false, runnerCleaned: true };
      },
      isSuccessfulAiLiveSmokeResult: () => false
    },
    writeError: (message) => errors.push(message),
    writeSuccess: () => assert.fail('A failed runner must not report success.')
  });

  assert.equal(result, 1);
  assert.deepEqual(calls, [
    'existing:prepare',
    'proxy:start',
    'runner-environment',
    'playwright',
    'proxy:close',
    'existing:cleanup'
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].includes(secretSentinel), false);
});

test('live coordinator uses the existing WebAPI and never starts the legacy supervisor', async () => {
  const calls = [];
  const secretSentinel = 'synthetic-existing-webapi-bearer';
  const successMessages = [];
  const errors = [];
  const completionCalls = Array.from({ length: 9 }, () => ({
    status: 200,
    elapsedMs: 10,
    usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5, costUsd: 0.01 }
  }));
  const progressMessages = [];

  const result = await runAiLiveSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1' },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => {
        calls.push('existing:prepare');
        return {
          origin: 'http://127.0.0.1:3001',
          token: secretSentinel,
          model: 'gpt-5',
          cleanup: async () => calls.push('existing:cleanup')
        };
      },
      startIsolatedWebApi: async () => {
        calls.push('legacy:start');
        throw new Error('The live coordinator must not start WebAPI.');
      },
      prepareAiLiveSmokeSession: async () => {
        calls.push('legacy:prepare');
        throw new Error('The live coordinator must not mutate WebAPI settings.');
      },
      createAiLiveProxy: async ({
        token,
        model,
        targetOrigin,
        maxCalls,
        timeoutMs,
        onRequest,
        onCompletion
      }) => {
        calls.push('proxy:create');
        assert.equal(token, secretSentinel);
        assert.equal(model, 'gpt-5');
        assert.equal(targetOrigin, 'http://127.0.0.1:3001');
        assert.equal(maxCalls, 10);
        assert.equal(timeoutMs, AI_LIVE_SMOKE_DEADLINES.proxyMs);
        onRequest({ ordinal: 1 });
        onCompletion({
          ordinal: 1,
          status: 200,
          elapsedMs: 10,
          responseFormat: {
            messageContentType: 'text',
            isJsonObject: false,
            finishReason: 'stop',
            secret: secretSentinel
          }
        });
        return {
          clientToken: 'synthetic-proxy-credential',
          baseUrl: 'http://127.0.0.1:43210/v1',
          metrics: { calls: completionCalls },
          close: async () => calls.push('proxy:close')
        };
      },
      createAiLiveSmokeRunnerEnvironment: (_parentEnv, { proxyToken, model, deadlines }) => {
        calls.push('runner:environment');
        assert.equal(proxyToken, 'synthetic-proxy-credential');
        assert.equal(model, 'gpt-5');
        assert.strictEqual(deadlines, AI_LIVE_SMOKE_DEADLINES);
        const runnerEnv = { runnerOnly: 'synthetic' };
        assert.equal(Object.values(runnerEnv).includes(secretSentinel), false);
        return runnerEnv;
      },
      runAiLiveSmokeRunner: async ({ env }) => {
        calls.push('runner:start');
        assert.deepEqual(env, { runnerOnly: 'synthetic' });
        return { code: 0, cancelled: false, timedOut: false, runnerCleaned: true };
      },
      isSuccessfulAiLiveSmokeResult: ({ runnerExit, cleanupFailed, calls: actualCalls }) =>
        runnerExit.code === 0 &&
        runnerExit.runnerCleaned === true &&
        cleanupFailed === false &&
        actualCalls.length === 9 &&
        actualCalls.every((call) => call.status === 200)
    },
    writeError: (message) => errors.push(message),
    writeProgress: (message) => progressMessages.push(message),
    writeSuccess: (message) => successMessages.push(message)
  });

  assert.equal(result, 0);
  assert.deepEqual(calls, [
    'existing:prepare',
    'proxy:create',
    'runner:environment',
    'runner:start',
    'proxy:close',
    'existing:cleanup'
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(progressMessages, [
    'Validando el servicio IA local y sus controles de privacidad.',
    'Servicio IA local validado; preparando la prueba aislada.',
    'Solicitud IA 1/10 enviada al servicio local.',
    'Respuesta IA 1/10 completada (HTTP 200; texto no JSON; cierre stop).',
    'Iniciando los escenarios contra la aplicación aislada.',
    'Escenarios aislados terminados; verificando limpieza.'
  ]);
  assert.equal(successMessages.length, 1);
  assert.equal(successMessages[0].includes(secretSentinel), false);
  assert.match(successMessages[0], /"model":"gpt-5"/);
  assert.match(
    successMessages[0],
    /"usage":\{"promptTokens":27,"completionTokens":18,"totalTokens":45,"costUsd":0\.09\}/
  );
});

test('receipt-only coordinator caps four requests and emits aggregate-only evidence', async () => {
  const calls = [];
  const successMessages = [];
  const errors = [];
  const progressMessages = [];
  const sourceDirectory = 'C:/Users/private/tickets';
  const usage = { promptTokens: 3, completionTokens: 2, totalTokens: 5, costUsd: 0.01 };
  const requestContract = {
    strictJsonSchema: true,
    inventoryJsonAttachmentCount: 1,
    receiptAttachmentCount: 1
  };
  const receiptCalls = [
    {
      status: 200,
      stream: true,
      schemaName: 'receipt',
      requestContract,
      elapsedMs: 20,
      usage
    },
    {
      status: 400,
      stream: true,
      schemaName: 'receipt',
      requestContract,
      elapsedMs: 30,
      usage
    },
    {
      status: 200,
      stream: false,
      schemaName: 'receipt',
      requestContract,
      elapsedMs: 40,
      usage
    }
  ];

  const result = await runAiLiveSmoke({
    env: {
      [AI_LIVE_SMOKE_ENV.optIn]: '1',
      [AI_LIVE_SMOKE_ENV.receiptsOnly]: '1',
      [AI_LIVE_SMOKE_ENV.receiptSelection]: 'unsubmitted-only',
      [AI_LIVE_SMOKE_ENV.receiptDirectory]: sourceDirectory,
      [AI_LIVE_SMOKE_ENV.preferredJpegOrdinal]: '2'
    },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-existing-webapi-token',
        model: 'gpt-5',
        cleanup: async () => calls.push('session:cleanup')
      }),
      createAiLiveProxy: async ({
        maxCalls,
        maxRequestBytes,
        requireReceiptAttachments,
        onRequest,
        onCompletion
      }) => {
        calls.push('proxy:create');
        assert.equal(maxCalls, 4);
        assert.equal(maxRequestBytes, AI_LIVE_RECEIPT_SMOKE_MAX_REQUEST_BYTES);
        assert.equal(requireReceiptAttachments, true);
        onRequest({ ordinal: 1 });
        onCompletion({ ordinal: 1, status: 200, elapsedMs: 20, responseFormat: {} });
        return {
          clientToken: 'synthetic-proxy-token',
          baseUrl: 'http://127.0.0.1:43210/v1',
          metrics: { calls: receiptCalls },
          close: async () => calls.push('proxy:close')
        };
      },
      createAiLiveSmokeRunnerEnvironment: (parentEnv) => {
        calls.push('runner:environment');
        assert.equal(parentEnv[AI_LIVE_SMOKE_ENV.receiptDirectory], sourceDirectory);
        assert.equal(parentEnv[AI_LIVE_SMOKE_ENV.receiptSelection], 'unsubmitted-only');
        return { runnerOnly: true };
      },
      runAiLiveSmokeRunner: async () => {
        calls.push('runner:start');
        return { code: 0, cancelled: false, timedOut: false, runnerCleaned: true };
      },
      isSuccessfulAiLiveSmokeResult: ({ receiptsOnly, calls: actualCalls }) =>
        receiptsOnly === true && actualCalls.length === receiptCalls.length
    },
    writeError: (message) => errors.push(message),
    writeProgress: (message) => progressMessages.push(message),
    writeSuccess: (message) => successMessages.push(message)
  });

  assert.equal(result, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, [
    'proxy:create',
    'runner:environment',
    'runner:start',
    'proxy:close',
    'session:cleanup'
  ]);
  assert.equal(successMessages.length, 1);
  const summary = JSON.parse(successMessages[0]);
  assert.deepEqual(summary, {
    result: 'passed',
    provider: 'local WebAPI :3001',
    model: 'gpt-5',
    sourceCount: 6,
    tickets: AI_LIVE_RECEIPT_SMOKE_TICKET_COUNT,
    requests: 3,
    completions: 2,
    verifiedStrictSchemaRequests: 3,
    verifiedInventoryJsonAttachments: 3,
    verifiedReceiptAttachments: 3,
    elapsedMs: 90,
    recoveredFallbacks: 1,
    usage: { promptTokens: 9, completionTokens: 6, totalTokens: 15, costUsd: 0.03 }
  });
  assert.equal(successMessages[0].includes(sourceDirectory), false);
  assert.equal(progressMessages.includes('Solicitud IA 1/4 enviada al servicio local.'), true);
});

test('coordinator fails without creating proxy or runner when existing-WebAPI preflight fails', async () => {
  const calls = [];
  const errors = [];
  const result = await runAiLiveSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1' },
    dependencies: {
      ...createGuardedDependencies(calls),
      prepareExistingAiLiveSmokeSession: async () => {
        calls.push('existing:prepare');
        throw new Error('synthetic preflight failure');
      },
      isSuccessfulAiLiveSmokeResult: () => false
    },
    writeError: (message) => errors.push(message),
    writeSuccess: () => assert.fail('Failed preflight must not report success.')
  });

  assert.equal(result, 1);
  assert.deepEqual(calls, ['existing:prepare']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /peticiones=0\/10/);
});

test('coordinator reports cleanup failures and does not hide them as success', async () => {
  const calls = [];
  const errors = [];
  const secretSentinel = 'synthetic-cleanup-bearer';
  const result = await runAiLiveSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1' },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: secretSentinel,
        model: 'gpt-5',
        cleanup: async () => {
          calls.push('token:cleanup');
          throw new Error(secretSentinel);
        }
      }),
      createAiLiveProxy: async () => ({
        clientToken: 'synthetic-proxy-token',
        baseUrl: 'http://127.0.0.1:43210/v1',
        metrics: { calls: [] },
        close: async () => {
          calls.push('proxy:close');
          throw new Error('synthetic close failure');
        }
      }),
      createAiLiveSmokeRunnerEnvironment: () => ({ runnerOnly: true }),
      runAiLiveSmokeRunner: async () => ({ code: 0, timedOut: false, runnerCleaned: true }),
      isSuccessfulAiLiveSmokeResult: ({ cleanupFailed }) => !cleanupFailed
    },
    writeError: (message) => errors.push(message),
    writeSuccess: () => assert.fail('Cleanup failure must not report success.')
  });

  assert.equal(result, 1);
  assert.deepEqual(calls, ['proxy:close', 'token:cleanup']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /limpieza del token propio/);
  assert.equal(errors[0].includes(secretSentinel), false);
});

test('coordinator labels cancellation and still cleans proxy before the owned token', async () => {
  const calls = [];
  const errors = [];
  const controller = new AbortController();
  const result = await runAiLiveSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1' },
    signal: controller.signal,
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-bearer',
        model: 'gpt-5',
        cleanup: async () => calls.push('token:cleanup')
      }),
      createAiLiveProxy: async () => ({
        clientToken: 'synthetic-proxy-token',
        baseUrl: 'http://127.0.0.1:43210/v1',
        metrics: { calls: [] },
        close: async () => calls.push('proxy:close')
      }),
      createAiLiveSmokeRunnerEnvironment: () => ({ runnerOnly: true }),
      runAiLiveSmokeRunner: async () => {
        calls.push('runner');
        controller.abort();
        throw new Error('synthetic cancellation');
      },
      isSuccessfulAiLiveSmokeResult: () => false
    },
    writeError: (message) => errors.push(message),
    writeSuccess: () => assert.fail('A cancelled run must not report success.')
  });

  assert.equal(result, 1);
  assert.deepEqual(calls, ['runner', 'proxy:close', 'token:cleanup']);
  assert.match(errors[0], /Smoke real cancelado/);
});

test('coordinator labels a timed-out live runner separately', async () => {
  const errors = [];
  const result = await runAiLiveSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1' },
    dependencies: {
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-bearer',
        model: 'gpt-5',
        cleanup: async () => undefined
      }),
      createAiLiveProxy: async () => ({
        clientToken: 'synthetic-proxy-token',
        baseUrl: 'http://127.0.0.1:43210/v1',
        metrics: { calls: [] },
        close: async () => undefined
      }),
      createAiLiveSmokeRunnerEnvironment: () => ({ runnerOnly: true }),
      runAiLiveSmokeRunner: async () => ({ code: 1, timedOut: true }),
      isSuccessfulAiLiveSmokeResult: () => false
    },
    writeError: (message) => errors.push(message),
    writeSuccess: () => assert.fail('A timed-out run must not report success.')
  });

  assert.equal(result, 1);
  assert.match(errors[0], /agotó el límite de tiempo/);
});
