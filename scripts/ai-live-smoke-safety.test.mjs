import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import {
  WEB_API_ORIGIN,
  createAiLiveSmokeRunnerEnvironment,
  prepareAiLiveSmokeSession,
  createAiLiveProxy,
  isSuccessfulAiLiveSmokeResult,
  isSuccessfulAiLiveHouseholdMealSmokeResult,
  isolatedProcessEnvironments,
  selectAiLiveModel,
  validateAiLiveSmokeOptIn,
  validateAiLiveHouseholdMealSmokeRequest,
  validateAiLiveSmokeRunner
} from './ai-live-smoke-safety.mjs';
import { AI_LIVE_SMOKE_DEADLINES } from './ai-live-smoke-contract.mjs';

test('requires explicit opt-in and rejects CI before any live setup', () => {
  assert.throws(() => validateAiLiveSmokeOptIn({}), /explicit opt-in/i);
  assert.throws(() => validateAiLiveSmokeOptIn({ HOGARIA_AI_REAL_SMOKE: '1', CI: 'true' }), /CI/i);
  assert.doesNotThrow(() => validateAiLiveSmokeOptIn({ HOGARIA_AI_REAL_SMOKE: '1', CI: '' }));
});

test('household meal mode is opt-in, rejects all receipt inputs and uses only its exact isolated test', () => {
  const args = [
    '--config=playwright.ai-household-meal-real-smoke.config.ts',
    'tests/e2e/household-meal-planning-live-smoke.spec.ts'
  ];
  const env = {
    HOGARIA_AI_REAL_SMOKE: '1',
    HOGARIA_AI_REAL_SMOKE_RUNNER: '1',
    HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY: '1',
    HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN: 'synthetic-local-proxy-token',
    HOGARIA_AI_REAL_SMOKE_PROXY_URL: 'http://127.0.0.1:41000/v1',
    HOGARIA_AI_REAL_SMOKE_MODEL: 'gpt-5',
    CI: ''
  };

  assert.equal(validateAiLiveHouseholdMealSmokeRequest(env), true);
  assert.equal(validateAiLiveSmokeRunner(env, args), true);
  assert.throws(
    () =>
      validateAiLiveSmokeRunner(env, [
        '--config=playwright.ai-real-smoke.config.ts',
        'tests/e2e/ai-real-smoke.spec.ts'
      ]),
    /only accepts/i
  );
  assert.throws(
    () =>
      validateAiLiveHouseholdMealSmokeRequest({
        ...env,
        HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH: 'C:/private/ticket.pdf'
      }),
    /cannot include receipt/i
  );
  assert.throws(
    () =>
      validateAiLiveHouseholdMealSmokeRequest({ ...env, HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY: '1' }),
    /cannot include receipt/i
  );
  assert.throws(
    () =>
      validateAiLiveHouseholdMealSmokeRequest({
        ...env,
        HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY: 'C:/private/tickets'
      }),
    /cannot include receipt/i
  );
  assert.throws(
    () =>
      validateAiLiveHouseholdMealSmokeRequest({
        ...env,
        HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY: 'true'
      }),
    /exact opt-in/i
  );
});

test('household meal smoke succeeds only for one validated strict-schema provider completion', () => {
  const runnerExit = { code: 0, timedOut: false, cancelled: false, runnerCleaned: true };
  const call = {
    status: 200,
    schemaName: 'weekly_meal_proposal',
    requestContract: {
      strictJsonSchema: true,
      noFileOrImageAttachments: true,
      requiredPromptTermsPresent: true,
      forbiddenPromptTermsAbsent: true
    },
    responseFormat: {
      hasChoices: true,
      messageContentType: 'text',
      isJsonObject: true,
      finishReason: 'stop'
    }
  };
  const proxyMetrics = { requestAttempts: 1, rejectedRequests: 0, failed: false };
  const input = { runnerExit, cleanupFailed: false, calls: [call], proxyMetrics };

  assert.equal(isSuccessfulAiLiveHouseholdMealSmokeResult(input), true);
  assert.equal(isSuccessfulAiLiveHouseholdMealSmokeResult({ ...input, calls: [] }), false);
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({ ...input, calls: [call, call] }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({
      ...input,
      calls: [{ ...call, schemaName: 'receipt' }]
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({
      ...input,
      proxyMetrics: { ...proxyMetrics, requestAttempts: 2, rejectedRequests: 1, failed: true }
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({ ...input, cleanupFailed: true }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({
      ...input,
      calls: [
        {
          ...call,
          requestContract: { strictJsonSchema: true, noFileOrImageAttachments: true }
        }
      ]
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({
      ...input,
      calls: [{ ...call, responseFormat: { ...call.responseFormat, isJsonObject: false } }]
    }),
    false
  );
});

test('dedicated runner accepts only the opt-in isolated config/spec and can route its bearer server-only', () => {
  const args = ['--config=playwright.ai-real-smoke.config.ts', 'tests/e2e/ai-real-smoke.spec.ts'];
  const env = {
    HOGARIA_AI_REAL_SMOKE: '1',
    HOGARIA_AI_REAL_SMOKE_RUNNER: '1',
    HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN: 'synthetic-local-proxy-token',
    HOGARIA_AI_REAL_SMOKE_PROXY_URL: 'http://127.0.0.1:41000/v1',
    HOGARIA_AI_REAL_SMOKE_MODEL: 'gpt-5',
    CI: ''
  };
  assert.equal(validateAiLiveSmokeRunner(env, args), true);
  assert.throws(() => validateAiLiveSmokeRunner({ ...env, CI: 'true' }, args), /CI/i);
  assert.throws(
    () =>
      validateAiLiveSmokeRunner(
        { ...env, HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN: 'webapi-bearer-secret' },
        args
      ),
    /WebAPI bearer.*coordinator/i
  );
  assert.throws(
    () => validateAiLiveSmokeRunner({ ...env, HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN: '' }, args),
    /proxy credential/i
  );
  assert.throws(() => validateAiLiveSmokeRunner(env, [...args, '--grep=unsafe']), /only accepts/i);
  assert.throws(
    () =>
      validateAiLiveSmokeRunner({ HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN: 'synthetic-token' }, []),
    /dedicated AI smoke runner/i
  );
  assert.equal(validateAiLiveSmokeRunner({}, ['tests/e2e/ai-real-smoke.spec.ts']), false);
});

test('receipt-only runner requires a private source directory and selected JPEG ordinal', () => {
  const args = ['--config=playwright.ai-real-smoke.config.ts', 'tests/e2e/ai-real-smoke.spec.ts'];
  const env = {
    HOGARIA_AI_REAL_SMOKE: '1',
    HOGARIA_AI_REAL_SMOKE_RUNNER: '1',
    HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN: 'synthetic-local-proxy-token',
    HOGARIA_AI_REAL_SMOKE_PROXY_URL: 'http://127.0.0.1:41000/v1',
    HOGARIA_AI_REAL_SMOKE_MODEL: 'gpt-5',
    HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY: '1',
    HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: 'unsubmitted-only',
    HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY: 'C:/Users/example/tickets',
    HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL: '2',
    CI: ''
  };

  assert.equal(validateAiLiveSmokeRunner(env, args), true);
  assert.equal(
    validateAiLiveSmokeRunner(
      { ...env, HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: 'long-ticket-only' },
      args
    ),
    true
  );
  assert.equal(
    validateAiLiveSmokeRunner(
      { ...env, HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: 'preferred-jpeg-only' },
      args
    ),
    true
  );
  assert.throws(
    () =>
      validateAiLiveSmokeRunner(
        { ...env, HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: undefined },
        args
      ),
    /supported receipt selection/i
  );
  assert.throws(
    () =>
      validateAiLiveSmokeRunner({ ...env, HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: 'all' }, args),
    /supported receipt selection/i
  );
  assert.throws(
    () =>
      validateAiLiveSmokeRunner(
        { ...env, HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL: '5' },
        args
      ),
    /JPEG.*index/i
  );
  assert.throws(
    () =>
      validateAiLiveSmokeRunner(
        { ...env, HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY: undefined },
        args
      ),
    /receipt directory/i
  );
  assert.throws(
    () => validateAiLiveSmokeRunner({ ...env, HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY: 'true' }, args),
    /receipt-only mode/i
  );
  assert.throws(
    () =>
      validateAiLiveSmokeRunner({ ...env, HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY: undefined }, args),
    /source inputs require receipt-only mode/i
  );
});

test('keeps enabled redacted WebAPI logs unchanged around token/model setup', async () => {
  const originalSettings = {
    captureDetails: false,
    enabled: true,
    maxBodyChars: 0,
    maxHeaderValueChars: 0,
    maxHeaders: 0
  };
  const requests = [];
  let currentLogging = { ...originalSettings };
  let sessionRecording = false;
  let diagnosticHtml = false;
  let tokenCreatedWithSafeLogs = false;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = options.method ?? 'GET';
    requests.push({ path, method, options });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (method === 'PATCH') {
      const value = JSON.parse(options.body);
      if (path === '/admin/api/runtime-controls/request-logging') {
        currentLogging = value;
        return Response.json({ settings: currentLogging });
      }
      if (path === '/admin/api/settings/session-recording') {
        sessionRecording = value.enabled;
        return Response.json({ enabled: sessionRecording });
      }
      if (path === '/admin/api/settings/diagnostic-html') {
        diagnosticHtml = value.enabled;
        return Response.json({ enabled: diagnosticHtml });
      }
    }
    if (method === 'POST' && path === '/admin/api/tokens') {
      tokenCreatedWithSafeLogs =
        currentLogging.enabled === true &&
        currentLogging.captureDetails === false &&
        currentLogging.maxBodyChars === 0 &&
        currentLogging.maxHeaderValueChars === 0 &&
        currentLogging.maxHeaders === 0 &&
        sessionRecording === false &&
        diagnosticHtml === false;
    }
    if (path === '/admin/api/runtime-controls') {
      return Response.json({ requestLogging: { settings: currentLogging } });
    }
    if (path === '/admin/api/settings/session-recording') {
      return Response.json({ enabled: sessionRecording });
    }
    if (path === '/admin/api/settings/diagnostic-html') {
      return Response.json({ enabled: diagnosticHtml });
    }
    const values = {
      '/': { name: 'web-api' },
      '/health/ready': { ok: true },
      '/admin/api/chatgpt/session': { state: 'ready' },
      '/admin/api/tokens': {
        record: { id: 'synthetic-token-id' },
        token: 'synthetic-live-token-secret'
      },
      '/v1/models': {
        data: [{ id: 'gpt-5', status: 'active', modalities: { input: ['text', 'image'] } }]
      }
    };
    const payload = values[path];
    return payload
      ? Response.json(payload, {
          status: method === 'POST' && path === '/admin/api/tokens' ? 201 : 200
        })
      : new Response(null, { status: 404 });
  };

  const session = await prepareAiLiveSmokeSession({
    origin: WEB_API_ORIGIN,
    fetchImpl,
    now: () => 1000
  });
  assert.equal(tokenCreatedWithSafeLogs, true);
  assert.equal(session.model, 'gpt-5');
  assert.equal(session.token, 'synthetic-live-token-secret');
  const modelRequest = requests.find(({ path }) => path === '/v1/models');
  assert.equal(modelRequest.options.headers.authorization, 'Bearer synthetic-live-token-secret');
  assert.equal(
    requests
      .find(({ method, path }) => method === 'POST' && path === '/admin/api/tokens')
      .options.body.includes('secret'),
    false
  );
  const createTokenRequest = requests.find(
    ({ method, path }) => method === 'POST' && path === '/admin/api/tokens'
  );
  assert.equal(JSON.parse(createTokenRequest.options.body).expiresAt, 1000 + 30 * 60 * 1000);

  await session.cleanup();
  assert.equal(
    requests.some(({ method }) => method === 'PATCH'),
    false
  );
  assert.equal(
    requests.some(
      ({ method, path }) => method === 'DELETE' && path === '/admin/api/tokens/synthetic-token-id'
    ),
    true
  );
});

test('preserves redacted request logs and rejects unsafe capture settings without mutation', async () => {
  const createFakeApi = ({ captureDetails = false, sessionRecording = false } = {}) => {
    const requests = [];
    let logging = {
      captureDetails,
      enabled: true,
      maxBodyChars: 0,
      maxHeaderValueChars: 0,
      maxHeaders: 0
    };
    let recording = sessionRecording;
    let tokenCreated = false;
    const fetchImpl = async (url, options = {}) => {
      const path = new URL(url).pathname;
      const method = options.method ?? 'GET';
      requests.push({ path, method, body: options.body });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'PATCH') {
        if (path === '/admin/api/runtime-controls/request-logging') {
          logging = JSON.parse(options.body);
          return Response.json({ settings: logging });
        }
        if (path === '/admin/api/settings/session-recording') {
          recording = JSON.parse(options.body).enabled;
          return Response.json({ enabled: recording });
        }
      }
      if (method === 'POST' && path === '/admin/api/tokens') {
        tokenCreated = true;
        return Response.json(
          { record: { id: 'synthetic-token-id' }, token: 'synthetic-live-token-secret' },
          { status: 201 }
        );
      }
      if (path === '/admin/api/runtime-controls') {
        return Response.json({ requestLogging: { settings: logging } });
      }
      if (path === '/admin/api/settings/session-recording') {
        return Response.json({ enabled: recording });
      }
      if (path === '/admin/api/settings/diagnostic-html') return Response.json({ enabled: false });
      const values = {
        '/': { name: 'web-api' },
        '/health/ready': { ready: true },
        '/admin/api/chatgpt/session': { state: 'ready' },
        '/v1/models': {
          data: [{ id: 'gpt-5', status: 'active', modalities: { input: ['text', 'image'] } }]
        }
      };
      return values[path] ? Response.json(values[path]) : new Response(null, { status: 404 });
    };
    return { fetchImpl, requests, tokenCreated: () => tokenCreated };
  };

  const safeApi = createFakeApi();
  const session = await prepareAiLiveSmokeSession({
    origin: WEB_API_ORIGIN,
    fetchImpl: safeApi.fetchImpl
  });
  assert.equal(safeApi.tokenCreated(), true);
  await session.cleanup();
  assert.equal(
    safeApi.requests.some(({ method }) => method === 'PATCH'),
    false
  );
  assert.equal(
    safeApi.requests.some(
      ({ method, path }) => method === 'DELETE' && path === '/admin/api/tokens/synthetic-token-id'
    ),
    true
  );

  for (const unsafeApi of [
    createFakeApi({ captureDetails: true }),
    createFakeApi({ sessionRecording: true })
  ]) {
    await assert.rejects(
      prepareAiLiveSmokeSession({ origin: WEB_API_ORIGIN, fetchImpl: unsafeApi.fetchImpl }),
      /capture|privacy|redacted/i
    );
    assert.equal(unsafeApi.tokenCreated(), false);
    assert.equal(
      unsafeApi.requests.some(({ method }) => method === 'PATCH'),
      false
    );
  }
});

test('rejects any WebAPI origin outside the supervised loopback without making a request', async () => {
  let requested = false;
  const fetchImpl = async () => {
    requested = true;
    return Response.json({});
  };
  await assert.rejects(
    prepareAiLiveSmokeSession({ origin: 'http://localhost:3001', fetchImpl }),
    /allowlist/i
  );
  await assert.rejects(prepareAiLiveSmokeSession({ fetchImpl }), /attested local WebAPI/i);
  assert.equal(requested, false);
});

test('aborts session setup and rolls back its token and privacy settings after cancellation', async () => {
  const controller = new AbortController();
  const originalLogging = {
    captureDetails: false,
    enabled: true,
    maxBodyChars: 0,
    maxHeaderValueChars: 0,
    maxHeaders: 0
  };
  let logging = { ...originalLogging };
  let sessionRecording = false;
  let diagnosticHtml = false;
  let tokenCreated = false;
  let tokenDeleted = false;
  let tokenName = '';
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method ?? 'GET';
    requests.push({ path, method, body: options.body, signal: options.signal });
    if (method === 'DELETE' && path === '/admin/api/tokens/synthetic-token-id') {
      tokenDeleted = true;
      return new Response(null, { status: 204 });
    }
    if (method === 'PATCH') {
      const value = JSON.parse(options.body);
      if (path === '/admin/api/runtime-controls/request-logging') {
        logging = value;
        return Response.json({ settings: logging });
      }
      if (path === '/admin/api/settings/session-recording') {
        sessionRecording = value.enabled;
        return Response.json({ enabled: sessionRecording });
      }
      if (path === '/admin/api/settings/diagnostic-html') {
        diagnosticHtml = value.enabled;
        return Response.json({ enabled: diagnosticHtml });
      }
    }
    if (method === 'POST' && path === '/admin/api/tokens') {
      tokenCreated = true;
      tokenName = JSON.parse(options.body).name;
      controller.abort();
      return Response.json(
        { record: { id: 'synthetic-token-id' }, token: 'synthetic-live-token-secret' },
        { status: 201 }
      );
    }
    if (path === '/admin/api/tokens' && method === 'GET') {
      return Response.json([{ id: 'synthetic-token-id', name: tokenName }]);
    }
    if (path === '/admin/api/runtime-controls') {
      return Response.json({ requestLogging: { settings: logging } });
    }
    if (path === '/admin/api/settings/session-recording') {
      return Response.json({ enabled: sessionRecording });
    }
    if (path === '/admin/api/settings/diagnostic-html') {
      return Response.json({ enabled: diagnosticHtml });
    }
    const payloads = {
      '/': { name: 'web-api' },
      '/health/ready': { ok: true },
      '/admin/api/chatgpt/session': { state: 'ready' },
      '/v1/models': {
        data: [{ id: 'gpt-5', status: 'active', modalities: { input: ['text', 'image'] } }]
      }
    };
    return payloads[path] ? Response.json(payloads[path]) : new Response(null, { status: 404 });
  };

  let session;
  try {
    await assert.rejects(
      (async () => {
        session = await prepareAiLiveSmokeSession({
          origin: WEB_API_ORIGIN,
          fetchImpl,
          signal: controller.signal,
          now: () => 1000
        });
      })(),
      /cancel/i
    );
    assert.equal(tokenCreated, true);
    assert.equal(tokenDeleted, true);
    assert.deepEqual(logging, originalLogging);
    assert.equal(sessionRecording, false);
    assert.equal(diagnosticHtml, false);
    assert.equal(
      requests.filter(({ method, path }) => method === 'PATCH' && path.includes('request-logging'))
        .length,
      0
    );
    assert.equal(
      requests
        .filter(({ method, body }) => {
          if (method === 'DELETE') return true;
          if (method !== 'PATCH') return false;
          const payload = JSON.parse(body);
          return payload.enabled === true || payload.captureDetails === true;
        })
        .every(({ signal }) => signal?.aborted !== true),
      true
    );
  } finally {
    if (session) await session.cleanup();
  }
});

test('rolls back the token and every privacy setting when the model catalog is unusable', async () => {
  const originalSettings = {
    captureDetails: false,
    enabled: true,
    maxBodyChars: 0,
    maxHeaderValueChars: 0,
    maxHeaders: 0
  };
  const requests = [];
  let currentLogging = { ...originalSettings };
  let sessionRecording = false;
  let diagnosticHtml = false;
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method ?? 'GET';
    requests.push({ path, method, body: options.body });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (method === 'PATCH') {
      const value = JSON.parse(options.body);
      if (path === '/admin/api/runtime-controls/request-logging') {
        currentLogging = value;
        return Response.json({ settings: currentLogging });
      }
      if (path === '/admin/api/settings/session-recording') {
        sessionRecording = value.enabled;
        return Response.json({ enabled: sessionRecording });
      }
      if (path === '/admin/api/settings/diagnostic-html') {
        diagnosticHtml = value.enabled;
        return Response.json({ enabled: diagnosticHtml });
      }
    }
    if (path === '/admin/api/runtime-controls') {
      return Response.json({ requestLogging: { settings: currentLogging } });
    }
    if (path === '/admin/api/settings/session-recording')
      return Response.json({ enabled: sessionRecording });
    if (path === '/admin/api/settings/diagnostic-html')
      return Response.json({ enabled: diagnosticHtml });
    const values = {
      '/': [200, { name: 'web-api' }],
      '/health/ready': [200, {}],
      '/admin/api/chatgpt/session': [200, { state: 'ready' }],
      '/admin/api/tokens': [
        201,
        { record: { id: 'rollback-token-id' }, token: 'synthetic-token-long' }
      ],
      '/v1/models': [200, { data: [] }]
    };
    const [status, body] = values[path] ?? [404, {}];
    return Response.json(body, { status });
  };

  await assert.rejects(
    prepareAiLiveSmokeSession({ origin: WEB_API_ORIGIN, fetchImpl, now: () => 1000 }),
    /could not be completed safely/i
  );
  assert.equal(sessionRecording, false);
  assert.equal(diagnosticHtml, false);
  assert.equal(
    requests.some(({ method }) => method === 'PATCH'),
    false
  );
  assert.equal(
    requests.some(
      ({ method, path }) => method === 'DELETE' && path === '/admin/api/tokens/rollback-token-id'
    ),
    true
  );
});

test('selects only an active image-capable model returned by the local model catalog', () => {
  const models = [
    { id: 'fake/gpt-test', status: 'active', modalities: { input: ['text', 'image'] } },
    { id: 'gpt-5', status: 'active', modalities: { input: ['text', 'image'] } },
    { id: 'image-only', status: 'active', modalities: { input: ['image'] } },
    { id: 'text-only', status: 'active', modalities: { input: ['text'] } },
    { id: 'disabled-vision', status: 'disabled', modalities: { input: ['image'] } }
  ];

  assert.equal(selectAiLiveModel(models), 'gpt-5');
  assert.equal(selectAiLiveModel(models, 'gpt-5'), 'gpt-5');
  assert.throws(() => selectAiLiveModel(models, 'not-listed'), /not available/i);
  assert.throws(() => selectAiLiveModel(models, 'image-only'), /text and image/i);
  assert.throws(() => selectAiLiveModel(models, 'text-only'), /text and image/i);
});

test('keeps the WebAPI bearer out of browser and Playwright environments', () => {
  const source = {
    HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN: 'sentinel-private-token',
    HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN: 'sentinel-local-proxy-token',
    HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH: 'C:/Downloads/private-ticket.jpeg',
    HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY: 'C:/Downloads/private-tickets',
    HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL: '2',
    HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY: '1',
    HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: 'unsubmitted-only',
    HOGARIA_AI_REAL_SMOKE: '1',
    E2E_BASE_URL: 'http://127.0.0.1:45678'
  };
  const separated = isolatedProcessEnvironments(source);

  assert.equal('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN' in separated.server, false);
  assert.equal(separated.server.HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN, 'sentinel-local-proxy-token');
  assert.equal('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN' in separated.browser, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN' in separated.browser, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN' in separated.playwright, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN' in separated.playwright, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH' in separated.server, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH' in separated.browser, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY' in separated.server, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL' in separated.server, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY' in separated.server, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY' in separated.browser, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL' in separated.browser, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY' in separated.browser, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION' in separated.server, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION' in separated.browser, false);
  assert.equal(
    separated.playwright.HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH,
    'C:/Downloads/private-ticket.jpeg'
  );
  assert.equal(
    separated.playwright.HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY,
    'C:/Downloads/private-tickets'
  );
  assert.equal(separated.playwright.HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL, '2');
  assert.equal(separated.playwright.HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY, '1');
  assert.equal(separated.playwright.HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION, 'unsubmitted-only');
  assert.equal(separated.browser.E2E_BASE_URL, source.E2E_BASE_URL);
});

test('builds a minimal live-runner environment without inherited provider credentials or hooks', () => {
  const env = createAiLiveSmokeRunnerEnvironment(
    {
      PATH: 'C:/Windows/System32',
      SystemRoot: 'C:/Windows',
      TEMP: 'C:/Temp',
      PLAYWRIGHT_BROWSERS_PATH: 'C:/pw-browsers',
      E2E_CHROME_BIN: 'C:/Chrome/chrome.exe',
      HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY: 'C:/Downloads/private-tickets',
      HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL: '2',
      HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY: '1',
      HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: 'unsubmitted-only',
      HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS: '1',
      CI: 'true',
      OPENAI_API_KEY: 'sentinel-openai-secret',
      HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN: 'sentinel-webapi-bearer',
      NODE_OPTIONS: '--require=untrusted-hook'
    },
    {
      proxyToken: 'synthetic-local-proxy-token',
      proxyUrl: 'http://127.0.0.1:41000/v1',
      model: 'gpt-5',
      deadlines: AI_LIVE_SMOKE_DEADLINES
    }
  );

  assert.equal(env.PATH, 'C:/Windows/System32');
  assert.equal(env.CI, '');
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, 'C:/pw-browsers');
  assert.equal(env.E2E_CHROME_BIN, 'C:/Chrome/chrome.exe');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY, 'C:/Downloads/private-tickets');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL, '2');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY, '1');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION, 'unsubmitted-only');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN, 'synthetic-local-proxy-token');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_RECIPE_MAX_TOKENS, '4096');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_CONFIG_TIMEOUT_MS, '240000');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_REQUEST_TIMEOUT_MS, '270000');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_TEST_TIMEOUT_MS, '1200000');
  assert.equal(env.HOGARIA_AI_REAL_SMOKE_GLOBAL_TIMEOUT_MS, '1260000');
  assert.equal('OPENAI_API_KEY' in env, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN' in env, false);
  assert.equal('HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS' in env, false);
  assert.equal('NODE_OPTIONS' in env, false);
  assert.equal(
    validateAiLiveSmokeRunner(env, [
      '--config=playwright.ai-real-smoke.config.ts',
      'tests/e2e/ai-real-smoke.spec.ts'
    ]),
    true
  );
});

test('meal-only runner environment drops receipt inputs and keeps mode only in Playwright', () => {
  const env = createAiLiveSmokeRunnerEnvironment(
    {
      PATH: 'C:/Windows/System32',
      HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH: 'C:/private/ticket.pdf',
      HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY: '1',
      HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION: 'unsubmitted-only',
      HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY: 'C:/private/tickets',
      HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL: '2'
    },
    {
      proxyToken: 'synthetic-local-proxy-token',
      proxyUrl: 'http://127.0.0.1:41000/v1',
      model: 'gpt-5',
      householdMealOnly: true
    }
  );
  const isolated = isolatedProcessEnvironments(env);

  assert.equal(env.HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY, '1');
  for (const key of [
    'HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH',
    'HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY',
    'HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION',
    'HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY',
    'HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL'
  ]) {
    assert.equal(Object.hasOwn(env, key), false);
    assert.equal(Object.hasOwn(isolated.server, key), false);
    assert.equal(Object.hasOwn(isolated.browser, key), false);
    assert.equal(Object.hasOwn(isolated.playwright, key), false);
  }
  assert.equal(Object.hasOwn(isolated.server, 'HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY'), false);
  assert.equal(Object.hasOwn(isolated.browser, 'HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY'), false);
  assert.equal(isolated.playwright.HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY, '1');
});

test('accepts only a fully successful run with nine or ten live completions', () => {
  const calls = (count) => Array.from({ length: count }, () => ({ status: 200 }));
  const runnerExit = { code: 0, timedOut: false, cancelled: false, runnerCleaned: true };

  assert.equal(
    isSuccessfulAiLiveSmokeResult({ runnerExit, cleanupFailed: false, calls: calls(9) }),
    true
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({ runnerExit, cleanupFailed: false, calls: calls(10) }),
    true
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({ runnerExit, cleanupFailed: false, calls: calls(8) }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({ runnerExit, cleanupFailed: false, calls: calls(11) }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: [...calls(9), { status: 500 }]
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit: { code: 1 },
      cleanupFailed: false,
      calls: calls(9)
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit: { ...runnerExit, cancelled: true },
      cleanupFailed: false,
      calls: calls(9)
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit: { code: 0, timedOut: false },
      cleanupFailed: false,
      calls: calls(9)
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({ runnerExit, cleanupFailed: true, calls: calls(9) }),
    false
  );
});

const VALID_RECEIPT_REQUEST_CONTRACT = {
  strictJsonSchema: true,
  inventoryJsonAttachmentCount: 1,
  receiptAttachmentCount: 1
};

test('accepts exactly two receipt jobs with at most one immediate stream fallback each', () => {
  const runnerExit = { code: 0, timedOut: false, cancelled: false, runnerCleaned: true };
  const receipts = Array.from({ length: 2 }, () => ({
    status: 200,
    stream: true,
    schemaName: 'receipt',
    requestContract: VALID_RECEIPT_REQUEST_CONTRACT
  }));
  const withFallback = [
    ...receipts.slice(0, 1),
    {
      status: 400,
      stream: true,
      schemaName: 'receipt',
      requestContract: VALID_RECEIPT_REQUEST_CONTRACT
    },
    {
      status: 200,
      stream: false,
      schemaName: 'receipt',
      requestContract: VALID_RECEIPT_REQUEST_CONTRACT
    }
  ];
  const withFallbackForEach = [
    {
      status: 400,
      stream: true,
      schemaName: 'receipt',
      requestContract: VALID_RECEIPT_REQUEST_CONTRACT
    },
    {
      status: 200,
      stream: false,
      schemaName: 'receipt',
      requestContract: VALID_RECEIPT_REQUEST_CONTRACT
    },
    {
      status: 400,
      stream: true,
      schemaName: 'receipt',
      requestContract: VALID_RECEIPT_REQUEST_CONTRACT
    },
    {
      status: 200,
      stream: false,
      schemaName: 'receipt',
      requestContract: VALID_RECEIPT_REQUEST_CONTRACT
    }
  ];

  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: receipts,
      receiptsOnly: true
    }),
    true
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: withFallback,
      receiptsOnly: true
    }),
    true
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: withFallbackForEach,
      receiptsOnly: true
    }),
    true
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: receipts.slice(0, 1),
      receiptsOnly: true
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: [
        {
          status: 500,
          stream: true,
          schemaName: 'receipt',
          requestContract: VALID_RECEIPT_REQUEST_CONTRACT
        },
        ...receipts
      ],
      receiptsOnly: true
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: [
        ...receipts,
        {
          status: 200,
          schemaName: 'recipe',
          requestContract: VALID_RECEIPT_REQUEST_CONTRACT
        }
      ],
      receiptsOnly: true
    }),
    false
  );
});

test('accepts one successful long-ticket receipt request without requiring an ambiguous JPEG retry', () => {
  const runnerExit = { code: 0, timedOut: false, cancelled: false, runnerCleaned: true };
  const call = {
    status: 200,
    stream: true,
    schemaName: 'receipt',
    requestContract: VALID_RECEIPT_REQUEST_CONTRACT
  };

  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: [call],
      receiptsOnly: true,
      expectedReceiptTicketCount: 1
    }),
    true
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: [{ ...call, status: 504 }],
      receiptsOnly: true,
      expectedReceiptTicketCount: 1
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: [call, call],
      receiptsOnly: true,
      expectedReceiptTicketCount: 1
    }),
    false
  );
});

test('accepts only the failed streaming receipt attempt when its strict non-stream fallback succeeds', () => {
  const runnerExit = { code: 0, timedOut: false, cancelled: false, runnerCleaned: true };
  const calls = Array.from({ length: 8 }, () => ({ status: 200 }));
  calls.splice(
    7,
    0,
    { status: 400, stream: true, schemaName: 'receipt' },
    { status: 200, stream: false, schemaName: 'receipt' }
  );

  assert.equal(isSuccessfulAiLiveSmokeResult({ runnerExit, cleanupFailed: false, calls }), true);
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: calls.map((call) =>
        call.status === 400 ? { ...call, schemaName: 'shopping_photo' } : call
      )
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: calls.map((call) => (call.status === 400 ? { ...call, status: 500 } : call))
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveSmokeResult({
      runnerExit,
      cleanupFailed: false,
      calls: calls.map((call, index) =>
        call.schemaName === 'receipt' && call.status === 200 && index > 7
          ? { ...call, schemaName: 'recipe' }
          : call
      )
    }),
    false
  );
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function postJson(url, bearer, payload) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          connection: 'close'
        },
        agent: false
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    request.once('error', reject);
    request.end(JSON.stringify(payload));
  });
}

const SYNTHETIC_STRICT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'synthetic_answer',
    strict: true,
    schema: {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false
    }
  }
};

const SYNTHETIC_MEAL_RESPONSE_FORMAT = {
  ...SYNTHETIC_STRICT_RESPONSE_FORMAT,
  json_schema: {
    ...SYNTHETIC_STRICT_RESPONSE_FORMAT.json_schema,
    name: 'weekly_meal_proposal'
  }
};

test('meal proxy forwards one text-only completion with its required schema and rejects duplicates', async () => {
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    upstreamRequests.push(Buffer.concat(chunks).toString('utf8'));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: '{"events":[]}' }, finish_reason: 'stop' }]
      })
    );
  });
  const upstreamPort = await listen(upstream);
  const proxy = await createAiLiveProxy({
    token: 'synthetic-provider-token',
    model: 'gpt-5',
    targetOrigin: `http://127.0.0.1:${upstreamPort}`,
    maxCalls: 1,
    expectedSchemaName: 'weekly_meal_proposal',
    requiredPromptTerms: ['shared soft-preference profile'],
    forbiddenPromptTerms: ['Synthetic Household Member']
  });
  const request = () =>
    postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'gpt-5',
      messages: [
        { role: 'user', content: 'synthetic meal prompt: shared soft-preference profile' }
      ],
      response_format: SYNTHETIC_MEAL_RESPONSE_FORMAT
    });

  try {
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(proxy.metrics.calls.length, 1);
    assert.deepEqual(proxy.metrics.calls[0].requestContract, {
      strictJsonSchema: true,
      noFileOrImageAttachments: true,
      requiredPromptTermsPresent: true,
      forbiddenPromptTermsAbsent: true
    });
    assert.equal(proxy.metrics.calls[0].schemaName, 'weekly_meal_proposal');
    assert.equal(JSON.stringify(proxy.metrics).includes('synthetic meal prompt'), false);

    assert.equal((await request()).status, 429);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(proxy.metrics.calls.length, 1);
    assert.deepEqual(
      {
        requestAttempts: proxy.metrics.requestAttempts,
        rejectedRequests: proxy.metrics.rejectedRequests,
        failed: proxy.metrics.failed
      },
      { requestAttempts: 2, rejectedRequests: 1, failed: true }
    );
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('meal proxy rejects missing profile inputs and identity disclosure before provider forwarding', async () => {
  let upstreamCalls = 0;
  const upstream = createServer((_request, response) => {
    upstreamCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"choices":[]}');
  });
  const upstreamPort = await listen(upstream);
  const attempt = async (content) => {
    const proxy = await createAiLiveProxy({
      token: 'synthetic-provider-token',
      model: 'gpt-5',
      targetOrigin: `http://127.0.0.1:${upstreamPort}`,
      maxCalls: 1,
      expectedSchemaName: 'weekly_meal_proposal',
      requiredPromptTerms: ['"likes":["lentils"]', '"dislikes":["chicken"]'],
      forbiddenPromptTerms: ['Synthetic Household Member']
    });
    try {
      const response = await postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
        model: 'gpt-5',
        messages: [{ role: 'user', content }],
        response_format: SYNTHETIC_MEAL_RESPONSE_FORMAT
      });
      assert.equal(response.status, 400);
      assert.equal(proxy.metrics.rejectedRequests, 1);
      assert.equal(proxy.metrics.failed, true);
      assert.equal(JSON.stringify(proxy.metrics).includes('Synthetic Household Member'), false);
      assert.equal(JSON.stringify(proxy.metrics).includes('lentils'), false);
    } finally {
      await proxy.close();
    }
  };

  try {
    await attempt('A synthetic household member likes lentils.');
    await attempt('"likes":["lentils"] "dislikes":["chicken"] Synthetic Household Member');
    assert.equal(upstreamCalls, 0);
  } finally {
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('meal proxy rejects wrong schema and attachment content before forwarding', async () => {
  let upstreamCalls = 0;
  const upstream = createServer((_request, response) => {
    upstreamCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"choices":[]}');
  });
  const upstreamPort = await listen(upstream);
  const proxy = await createAiLiveProxy({
    token: 'synthetic-provider-token',
    model: 'gpt-5',
    targetOrigin: `http://127.0.0.1:${upstreamPort}`,
    maxCalls: 1,
    expectedSchemaName: 'weekly_meal_proposal'
  });

  try {
    const wrongSchema = await postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'synthetic' }],
      response_format: SYNTHETIC_STRICT_RESPONSE_FORMAT
    });
    assert.equal(wrongSchema.status, 400);
    assert.equal(upstreamCalls, 0);

    const imagePrompt = await postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'gpt-5',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }]
        }
      ],
      response_format: SYNTHETIC_MEAL_RESPONSE_FORMAT
    });
    assert.equal(imagePrompt.status, 409);
    assert.equal(upstreamCalls, 0);
    assert.equal(proxy.metrics.calls.length, 0);
    assert.equal(proxy.metrics.rejectedRequests, 2);
    assert.equal(proxy.metrics.failed, true);
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('proxy authenticates its isolated app credential, forwards the WebAPI bearer, redacts it and enforces a budget', async () => {
  const bearer = 'synthetic-webapi-bearer-secret';
  const started = [];
  const completed = [];
  let localProxyCredential = '';
  const upstreamRequests = [];
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    upstreamRequests.push({
      authorization: request.headers.authorization,
      path: request.url,
      body: Buffer.concat(chunks).toString('utf8')
    });
    const safeContent =
      upstreamRequests.length === 1 ? `safe ${bearer} ${localProxyCredential}` : '{"status":"ok"}';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: safeContent }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 }
      })
    );
  });
  const upstreamPort = await listen(upstream);
  const proxy = await createAiLiveProxy({
    token: bearer,
    model: 'gpt-5',
    targetOrigin: `http://127.0.0.1:${upstreamPort}`,
    maxCalls: 2,
    onRequest: (event) => started.push(event),
    onCompletion: (event) => completed.push(event)
  });
  localProxyCredential = proxy.clientToken;

  try {
    const actualBearer = await postJson(`${proxy.baseUrl}/chat/completions`, bearer, {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'synthetic' }]
    });
    assert.equal(actualBearer.status, 401);
    assert.equal(upstreamRequests.length, 0);

    const promptSentinel = 'private smoke prompt sentinel';
    const request = (stream = false) =>
      postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
        model: 'gpt-5',
        messages: [{ role: 'user', content: promptSentinel }],
        stream,
        response_format: SYNTHETIC_STRICT_RESPONSE_FORMAT
      });

    const first = await request(true);
    assert.equal(first.status, 200);
    assert.equal(first.text.includes(bearer), false);
    assert.equal(first.text.includes(proxy.clientToken), false);
    assert.deepEqual(proxy.metrics.calls[0].usage, {
      promptTokens: 7,
      completionTokens: 5,
      totalTokens: 12
    });
    assert.deepEqual(proxy.metrics.calls[0].responseFormat, {
      hasChoices: true,
      messageContentType: 'text',
      contentChars: `safe ${bearer} ${localProxyCredential}`.length,
      isJsonObject: false,
      finishReason: 'stop'
    });
    assert.equal(JSON.stringify(proxy.metrics.calls[0].responseFormat).includes(bearer), false);
    assert.deepEqual(
      { stream: proxy.metrics.calls[0].stream, schemaName: proxy.metrics.calls[0].schemaName },
      { stream: true, schemaName: 'synthetic_answer' }
    );
    assert.equal(JSON.stringify(proxy.metrics.calls[0]).includes(promptSentinel), false);
    assert.deepEqual(started, [{ ordinal: 1 }]);
    assert.equal(completed.length, 1);
    assert.deepEqual(
      { ordinal: completed[0].ordinal, status: completed[0].status },
      { ordinal: 1, status: 200 }
    );
    assert.deepEqual(completed[0].responseFormat, proxy.metrics.calls[0].responseFormat);
    assert.equal(Number.isFinite(completed[0].elapsedMs), true);

    assert.equal((await request()).status, 200);
    assert.equal(proxy.metrics.calls[1].responseFormat.isJsonObject, true);
    const overBudget = await request();
    assert.equal(overBudget.status, 429);
    assert.equal(upstreamRequests.length, 2);
    assert.equal(upstreamRequests[0].authorization, `Bearer ${bearer}`);
    assert.equal(upstreamRequests[0].path, '/v1/chat/completions');
    assert.equal(proxy.metrics.calls.length, 2);
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('live proxy rejects JSON requests without strict response_format before spending its completion budget', async () => {
  let upstreamCalls = 0;
  const upstream = createServer((_request, response) => {
    upstreamCalls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  });
  const upstreamPort = await listen(upstream);
  const proxy = await createAiLiveProxy({
    token: 'synthetic-provider-token',
    model: 'gpt-5',
    targetOrigin: `http://127.0.0.1:${upstreamPort}`,
    maxCalls: 1
  });
  const request = (response_format) =>
    postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'synthetic JSON request' }],
      ...(response_format === undefined ? {} : { response_format })
    });

  try {
    const missing = await request();
    assert.equal(missing.status, 400);
    assert.equal(upstreamCalls, 0);

    const loose = await request({ type: 'json_object' });
    assert.equal(loose.status, 400);
    assert.equal(upstreamCalls, 0);

    const nonStrictSchema = await request({
      type: 'json_schema',
      json_schema: {
        name: 'synthetic_answer',
        strict: false,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false
        }
      }
    });
    assert.equal(nonStrictSchema.status, 400);
    assert.equal(upstreamCalls, 0);

    const incompleteStrictSchema = await request({
      type: 'json_schema',
      json_schema: {
        name: 'synthetic_answer',
        strict: true,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: [],
          additionalProperties: false
        }
      }
    });
    assert.equal(incompleteStrictSchema.status, 400);
    assert.equal(upstreamCalls, 0);

    const nestedLooseSchema = await request({
      type: 'json_schema',
      json_schema: {
        name: 'synthetic_answer',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            nested: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok']
            }
          },
          required: ['nested'],
          additionalProperties: false
        }
      }
    });
    assert.equal(nestedLooseSchema.status, 400);
    assert.equal(upstreamCalls, 0);

    const strict = await request({
      type: 'json_schema',
      json_schema: {
        name: 'synthetic_answer',
        strict: true,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false
        }
      }
    });
    assert.equal(strict.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.equal(proxy.metrics.calls.length, 1);
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('receipt proxy requires and verifies exactly one ticket plus current inventory JSON', async () => {
  const receiptFormat = {
    ...SYNTHETIC_STRICT_RESPONSE_FORMAT,
    json_schema: { ...SYNTHETIC_STRICT_RESPONSE_FORMAT.json_schema, name: 'receipt' }
  };
  const makeProxy = async () => {
    const upstreamRequests = [];
    const upstream = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      upstreamRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines: [] }) } }] })
      );
    });
    const upstreamPort = await listen(upstream);
    const proxy = await createAiLiveProxy({
      token: 'synthetic-provider-token',
      model: 'gpt-5',
      targetOrigin: `http://127.0.0.1:${upstreamPort}`,
      maxCalls: 4,
      requireReceiptAttachments: true
    });
    return {
      proxy,
      upstreamRequests,
      close: async () => {
        await proxy.close();
        await new Promise((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve()))
        );
      }
    };
  };
  const inventoryData = Buffer.from('{"categorias":[],"productos":[]}', 'utf8').toString('base64');
  const inventory = {
    type: 'file',
    file: {
      filename: 'inventario.json',
      file_data: `data:application/json;base64,${inventoryData}`
    }
  };
  const jpeg = {
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,MQ==' }
  };
  const pdf = {
    type: 'file',
    file: { filename: 'ticket.pdf', file_data: 'data:application/pdf;base64,MQ==' }
  };
  const request = (proxy, parts) =>
    postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'gpt-5',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }, ...parts] }],
      stream: true,
      response_format: receiptFormat
    });

  const valid = await makeProxy();
  try {
    assert.equal((await request(valid.proxy, [inventory, jpeg])).status, 200);
    assert.equal((await request(valid.proxy, [inventory, pdf])).status, 200);
    assert.equal(valid.upstreamRequests.length, 2);
    assert.deepEqual(
      valid.upstreamRequests.map((payload) => payload.response_format),
      [receiptFormat, receiptFormat]
    );
    assert.deepEqual(
      valid.upstreamRequests.map((payload) =>
        payload.messages[0].content
          .filter((part) => part.type === 'file' || part.type === 'image_url')
          .map((part) => (part.type === 'file' ? part.file.filename : 'jpeg-ticket'))
      ),
      [
        ['inventario.json', 'jpeg-ticket'],
        ['inventario.json', 'ticket.pdf']
      ]
    );
    assert.deepEqual(
      valid.proxy.metrics.calls.map(({ requestContract, schemaName }) => ({
        requestContract,
        schemaName
      })),
      [
        {
          requestContract: {
            strictJsonSchema: true,
            inventoryJsonAttachmentCount: 1,
            receiptAttachmentCount: 1
          },
          schemaName: 'receipt'
        },
        {
          requestContract: {
            strictJsonSchema: true,
            inventoryJsonAttachmentCount: 1,
            receiptAttachmentCount: 1
          },
          schemaName: 'receipt'
        }
      ]
    );
    assert.equal(JSON.stringify(valid.proxy.metrics).includes('inventario.json'), false);
    assert.equal(JSON.stringify(valid.proxy.metrics).includes(inventoryData), false);
    assert.equal((await request(valid.proxy, [jpeg])).status, 400);
    assert.equal(valid.upstreamRequests.length, 2);
    assert.equal(valid.proxy.metrics.calls.length, 2);
  } finally {
    await valid.close();
  }
});

test('receipt proxy rejects invalid inventory JSON and extra binary attachments before forwarding', async () => {
  const receiptFormat = {
    ...SYNTHETIC_STRICT_RESPONSE_FORMAT,
    json_schema: { ...SYNTHETIC_STRICT_RESPONSE_FORMAT.json_schema, name: 'receipt' }
  };
  const validInventory = {
    type: 'file',
    file: {
      filename: 'inventario.json',
      file_data: `data:application/json;base64,${Buffer.from(
        '{"categorias":[],"productos":[]}',
        'utf8'
      ).toString('base64')}`
    }
  };
  const invalidInventory = {
    type: 'file',
    file: { filename: 'inventario.json', file_data: 'data:application/json;base64,eA==' }
  };
  const jpeg = {
    type: 'image_url',
    image_url: { url: 'data:image/jpeg;base64,MQ==' }
  };
  const pdf = {
    type: 'file',
    file: { filename: 'ticket.pdf', file_data: 'data:application/pdf;base64,MQ==' }
  };
  for (const attachments of [
    [invalidInventory, jpeg],
    [validInventory, jpeg, pdf]
  ]) {
    let upstreamCalls = 0;
    const upstream = createServer((_request, response) => {
      upstreamCalls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '{"lines":[]}' } }] }));
    });
    const upstreamPort = await listen(upstream);
    const proxy = await createAiLiveProxy({
      token: 'synthetic-provider-token',
      model: 'gpt-5',
      targetOrigin: `http://127.0.0.1:${upstreamPort}`,
      requireReceiptAttachments: true
    });

    try {
      const result = await postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
        model: 'gpt-5',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'synthetic' }, ...attachments] }
        ],
        stream: true,
        response_format: receiptFormat
      });
      assert.equal(result.status, 400);
      assert.equal(upstreamCalls, 0);
      assert.equal(proxy.metrics.calls.length, 0);
    } finally {
      await proxy.close();
      await new Promise((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
});

test('receipt proxy allows only the HTTP 400 non-stream fallback and stops after other failures', async (t) => {
  const receiptFormat = {
    ...SYNTHETIC_STRICT_RESPONSE_FORMAT,
    json_schema: { ...SYNTHETIC_STRICT_RESPONSE_FORMAT.json_schema, name: 'receipt' }
  };
  const inventoryData = Buffer.from('{"categorias":[],"productos":[]}', 'utf8').toString('base64');
  const parts = [
    {
      type: 'file',
      file: {
        filename: 'inventario.json',
        file_data: `data:application/json;base64,${inventoryData}`
      }
    },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,MQ==' } }
  ];
  const body = (stream) => ({
    model: 'gpt-5',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }, ...parts] }],
    stream,
    response_format: receiptFormat
  });
  const makeProxy = async (statuses) => {
    const upstreamRequests = [];
    const upstream = createServer(async (request, response) => {
      for await (const _chunk of request) {
        // Drain the request without retaining the private attachment body.
      }
      const status = statuses.shift() ?? 500;
      upstreamRequests.push(status);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          status >= 200 && status < 300
            ? { choices: [{ message: { content: '{"lines":[]}' } }] }
            : { error: { message: 'synthetic provider error' } }
        )
      );
    });
    const upstreamPort = await listen(upstream);
    const proxy = await createAiLiveProxy({
      token: 'synthetic-provider-token',
      model: 'gpt-5',
      targetOrigin: `http://127.0.0.1:${upstreamPort}`,
      maxCalls: 4,
      requireReceiptAttachments: true
    });
    return {
      proxy,
      upstreamRequests,
      close: async () => {
        await proxy.close();
        await new Promise((resolve, reject) =>
          upstream.close((error) => (error ? reject(error) : resolve()))
        );
      }
    };
  };

  const allowedFallback = await makeProxy([400, 200]);
  try {
    assert.equal(
      (
        await postJson(
          `${allowedFallback.proxy.baseUrl}/chat/completions`,
          allowedFallback.proxy.clientToken,
          body(true)
        )
      ).status,
      400
    );
    assert.equal(
      (
        await postJson(
          `${allowedFallback.proxy.baseUrl}/chat/completions`,
          allowedFallback.proxy.clientToken,
          body(false)
        )
      ).status,
      200
    );
    assert.deepEqual(allowedFallback.upstreamRequests, [400, 200]);
  } finally {
    await allowedFallback.close();
  }

  const replayAfter400 = await makeProxy([400, 200]);
  try {
    await postJson(
      `${replayAfter400.proxy.baseUrl}/chat/completions`,
      replayAfter400.proxy.clientToken,
      body(true)
    );
    assert.equal(
      (
        await postJson(
          `${replayAfter400.proxy.baseUrl}/chat/completions`,
          replayAfter400.proxy.clientToken,
          body(true)
        )
      ).status,
      409
    );
    assert.deepEqual(replayAfter400.upstreamRequests, [400]);
  } finally {
    await replayAfter400.close();
  }

  const stoppedAfterFailure = await makeProxy([500, 200]);
  try {
    assert.equal(
      (
        await postJson(
          `${stoppedAfterFailure.proxy.baseUrl}/chat/completions`,
          stoppedAfterFailure.proxy.clientToken,
          body(true)
        )
      ).status,
      500
    );
    assert.equal(
      (
        await postJson(
          `${stoppedAfterFailure.proxy.baseUrl}/chat/completions`,
          stoppedAfterFailure.proxy.clientToken,
          body(true)
        )
      ).status,
      409
    );
    assert.deepEqual(stoppedAfterFailure.upstreamRequests, [500]);
  } finally {
    await stoppedAfterFailure.close();
  }
});

test('proxy rejects host/path redirects and mismatched models without following or logging them', async () => {
  let upstreamCalls = 0;
  const upstream = createServer((_request, response) => {
    upstreamCalls += 1;
    response.writeHead(302, { location: 'https://example.invalid/secret-destination' }).end();
  });
  const upstreamPort = await listen(upstream);
  const token = 'synthetic-token-long';
  const proxy = await createAiLiveProxy({
    token,
    model: 'gpt-5',
    targetOrigin: `http://127.0.0.1:${upstreamPort}`,
    maxCalls: 2
  });

  try {
    const wrongModel = await postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'another-model',
      messages: []
    });
    assert.equal(wrongModel.status, 400);
    assert.equal(upstreamCalls, 0);

    const redirected = await postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'synthetic' }],
      response_format: SYNTHETIC_STRICT_RESPONSE_FORMAT
    });
    assert.equal(redirected.status, 502);
    assert.equal(redirected.text.includes('example.invalid'), false);
    assert.equal(upstreamCalls, 1);
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('proxy budgets concurrent attempts atomically and drains oversized requests safely', async () => {
  let upstreamCalls = 0;
  const upstream = createServer(async (_request, response) => {
    upstreamCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
  const upstreamPort = await listen(upstream);
  const token = 'synthetic-provider-token';
  const proxy = await createAiLiveProxy({
    token,
    model: 'gpt-5',
    targetOrigin: `http://127.0.0.1:${upstreamPort}`,
    maxCalls: 2,
    maxRequestBytes: 512
  });

  try {
    const concurrent = await Promise.all(
      Array.from({ length: 3 }, () =>
        postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
          model: 'gpt-5',
          messages: [{ role: 'user', content: 'synthetic' }],
          response_format: SYNTHETIC_STRICT_RESPONSE_FORMAT
        })
      )
    );
    assert.deepEqual(concurrent.map(({ status }) => status).sort(), [200, 200, 429]);
    assert.equal(upstreamCalls, 2);

    const oversized = await postJson(`${proxy.baseUrl}/chat/completions`, proxy.clientToken, {
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'x'.repeat(1024) }]
    });
    assert.equal(oversized.status, 413);
    assert.equal(upstreamCalls, 2);
  } finally {
    await proxy.close();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('closing the proxy aborts in-flight upstream work', async () => {
  let releaseUpstreamRequest;
  const upstreamSeen = new Promise((resolve) => {
    releaseUpstreamRequest = resolve;
  });
  const upstream = createServer((request, _response) => releaseUpstreamRequest(request));
  const upstreamPort = await listen(upstream);
  const token = 'synthetic-provider-token';
  const proxy = await createAiLiveProxy({
    token,
    model: 'gpt-5',
    targetOrigin: `http://127.0.0.1:${upstreamPort}`
  });
  const target = new URL(`${proxy.baseUrl}/chat/completions`);
  const client = httpRequest(
    {
      hostname: target.hostname,
      port: Number(target.port),
      path: target.pathname,
      method: 'POST',
      headers: {
        authorization: `Bearer ${proxy.clientToken}`,
        'content-type': 'application/json',
        connection: 'close'
      },
      agent: false
    },
    () => undefined
  );
  client.on('error', () => undefined);
  client.end(
    JSON.stringify({
      model: 'gpt-5',
      messages: [{ role: 'user', content: 'synthetic' }],
      response_format: SYNTHETIC_STRICT_RESPONSE_FORMAT
    })
  );

  try {
    const upstreamRequest = await upstreamSeen;
    await proxy.close();
    const didAbort = await Promise.race([
      once(upstreamRequest, 'aborted').then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 500))
    ]);
    assert.equal(didAbort, true);
  } finally {
    client.destroy();
    await proxy.close().catch(() => undefined);
    upstream.closeAllConnections();
    await new Promise((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
