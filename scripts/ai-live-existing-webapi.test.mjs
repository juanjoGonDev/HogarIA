import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_LIVE_SMOKE_ENV } from './ai-live-smoke-safety.mjs';
import { prepareExistingAiLiveSmokeSession } from './ai-live-existing-webapi.mjs';

const WEB_API_ORIGIN = 'http://127.0.0.1:3001';
const OWNED_TOKEN_ID = 'e047344b-7347-4de0-9747-5f1111111111';
const BEARER_SENTINEL = 'synthetic-webapi-bearer-not-for-output';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function createWebApi({
  requestLogging = {
    captureDetails: false,
    enabled: false,
    maxBodyChars: 0,
    maxHeaderValueChars: 0,
    maxHeaders: 0
  },
  sessionRecording = false,
  diagnosticHtml = false,
  sessionState = 'ready',
  models = [
    {
      id: 'gpt-5',
      status: 'active',
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] }
    }
  ]
} = {}) {
  const calls = [];
  let ownedTokenExists = true;

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? 'GET';
    const headers = new Headers(options.headers);
    calls.push({ url: url.toString(), method, headers, body: options.body });
    assert.equal(url.origin, WEB_API_ORIGIN);
    assert.equal(options.redirect, 'error');

    if (method === 'GET' && url.pathname === '/health/ready') {
      return jsonResponse({ ready: true, storage: 'ready' });
    }
    if (method === 'GET' && url.pathname === '/') {
      return jsonResponse({
        name: 'web-api',
        routes: ['/health/ready', '/v1/models', '/v1/responses', '/admin']
      });
    }
    if (method === 'GET' && url.pathname === '/admin/api/chatgpt/session') {
      return jsonResponse({ state: sessionState });
    }
    if (method === 'GET' && url.pathname === '/admin/api/runtime-controls') {
      return jsonResponse({
        requestLogging: {
          bounds: {
            maxBodyChars: { min: 0, max: 10_000_000 },
            maxHeaderValueChars: { min: 0, max: 32_768 },
            maxHeaders: { min: 0, max: 256 }
          },
          settings: requestLogging
        }
      });
    }
    if (method === 'GET' && url.pathname === '/admin/api/settings/session-recording') {
      return jsonResponse({ enabled: sessionRecording });
    }
    if (method === 'GET' && url.pathname === '/admin/api/settings/diagnostic-html') {
      return jsonResponse({ enabled: diagnosticHtml });
    }
    if (method === 'POST' && url.pathname === '/admin/api/tokens') {
      const body = JSON.parse(options.body);
      assert.equal(body.expiresAt, null);
      assert.match(body.name, /^HogarIA real smoke /);
      assert.equal(Object.hasOwn(body, 'token'), false);
      return jsonResponse(
        {
          record: {
            id: OWNED_TOKEN_ID,
            expiresAt: null,
            name: body.name
          },
          token: BEARER_SENTINEL
        },
        201
      );
    }
    if (method === 'GET' && url.pathname === '/v1/models') {
      assert.equal(headers.get('authorization'), `Bearer ${BEARER_SENTINEL}`);
      return jsonResponse({ object: 'list', data: models });
    }
    if (method === 'DELETE' && url.pathname === `/admin/api/tokens/${OWNED_TOKEN_ID}`) {
      ownedTokenExists = false;
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && url.pathname === '/admin/api/tokens') {
      return jsonResponse(
        ownedTokenExists
          ? [{ id: OWNED_TOKEN_ID, name: 'own token' }]
          : [{ id: 'preexisting-token-id', name: 'not ours' }]
      );
    }

    assert.fail(`Unexpected WebAPI request: ${method} ${url.pathname}`);
  };

  return { calls, fetchImpl };
}

test('fails before token creation or model calls when capture settings are unsafe', async () => {
  const { calls, fetchImpl } = createWebApi({
    requestLogging: {
      captureDetails: true,
      enabled: true,
      maxBodyChars: 4096,
      maxHeaderValueChars: 128,
      maxHeaders: 20
    }
  });

  await assert.rejects(
    prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl }),
    /privacy settings/
  );
  assert.equal(
    calls.some((call) => call.method === 'POST' || call.method === 'DELETE'),
    false
  );
  assert.equal(
    calls.some((call) => new URL(call.url).pathname === '/v1/models'),
    false
  );
});

test('fails before token creation when the WebAPI ChatGPT session needs login', async () => {
  const { calls, fetchImpl } = createWebApi({ sessionState: 'needs_login' });

  await assert.rejects(
    prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl }),
    /provider session is not ready/
  );

  const paths = calls.map((call) => new URL(call.url).pathname);
  assert.equal(paths.includes('/admin/api/chatgpt/session'), true);
  assert.equal(
    calls.some((call) => call.method === 'POST'),
    false
  );
  assert.equal(paths.includes('/v1/models'), false);
});

test('allows sanitized local request logging only with the explicit diagnostic opt-in', async () => {
  const { calls, fetchImpl } = createWebApi({
    requestLogging: {
      captureDetails: true,
      enabled: true,
      maxBodyChars: 4096,
      maxHeaderValueChars: 128,
      maxHeaders: 20
    }
  });

  const session = await prepareExistingAiLiveSmokeSession({
    env: { HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS: '1' },
    fetchImpl
  });

  assert.equal(session.model, 'gpt-5');
  await session.cleanup();
  assert.equal(calls.filter((call) => new URL(call.url).pathname === '/v1/models').length, 1);
  assert.equal(
    calls.some((call) => call.method === 'PATCH'),
    false
  );
});

test('does not let the diagnostic opt-in enable session or HTML recording', async () => {
  for (const settings of [{ sessionRecording: true }, { diagnosticHtml: true }]) {
    const { calls, fetchImpl } = createWebApi(settings);
    await assert.rejects(
      prepareExistingAiLiveSmokeSession({
        env: { HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS: '1' },
        fetchImpl
      }),
      /privacy settings are unsafe/
    );
    assert.equal(
      calls.some((call) => call.method === 'POST' || call.method === 'DELETE'),
      false
    );
    assert.equal(
      calls.some((call) => new URL(call.url).pathname === '/v1/models'),
      false
    );
  }
});

test('requires the exact diagnostic opt-in value and valid bounded logging settings', async () => {
  const invalidConfigs = [
    { optIn: 'true', settings: { enabled: true, captureDetails: true } },
    {
      optIn: '1',
      settings: {
        captureDetails: true,
        enabled: true,
        maxBodyChars: -1,
        maxHeaderValueChars: 128,
        maxHeaders: 20
      }
    },
    {
      optIn: '1',
      settings: {
        captureDetails: true,
        enabled: true,
        maxBodyChars: 4096,
        maxHeaderValueChars: 128,
        maxHeaders: 'unlimited'
      }
    }
  ];

  for (const { optIn, settings } of invalidConfigs) {
    const { calls, fetchImpl } = createWebApi({ requestLogging: settings });
    await assert.rejects(
      prepareExistingAiLiveSmokeSession({
        env: { HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS: optIn },
        fetchImpl
      }),
      /privacy settings are unsafe/
    );
    assert.equal(
      calls.some((call) => call.method === 'POST' || call.method === 'DELETE'),
      false
    );
    assert.equal(
      calls.some((call) => new URL(call.url).pathname === '/v1/models'),
      false
    );
  }
});

test('rejects an invalid bearer without making any WebAPI request', async () => {
  let requests = 0;
  await assert.rejects(
    prepareExistingAiLiveSmokeSession({
      env: { [AI_LIVE_SMOKE_ENV.providerToken]: ' invalid synthetic bearer ' },
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({});
      }
    }),
    /configured WebAPI smoke bearer is invalid/
  );
  assert.equal(requests, 0);
});

test('rejects a different service identity before any token or model request', async () => {
  const { calls, fetchImpl: baseFetch } = createWebApi();
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === '/')
      return jsonResponse({ name: 'other-service', routes: ['/v1/models'] });
    return baseFetch(input, options);
  };

  await assert.rejects(
    prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl }),
    /service identity or readiness/
  );
  assert.equal(
    calls.some((call) => call.method === 'POST' || call.method === 'DELETE'),
    false
  );
  assert.equal(
    calls.some((call) => new URL(call.url).pathname === '/v1/models'),
    false
  );
});

test('fails closed for enabled session recording or diagnostic HTML capture', async () => {
  for (const settings of [{ sessionRecording: true }, { diagnosticHtml: true }]) {
    const { calls, fetchImpl } = createWebApi(settings);
    await assert.rejects(
      prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl }),
      /privacy settings are unsafe/
    );
    assert.equal(
      calls.some((call) => call.method === 'POST' || call.method === 'DELETE'),
      false
    );
    assert.equal(
      calls.some((call) => new URL(call.url).pathname === '/v1/models'),
      false
    );
  }
});

test('cancellation before preflight does not touch the local service', async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  await assert.rejects(
    prepareExistingAiLiveSmokeSession({
      env: {},
      signal: controller.signal,
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({});
      }
    }),
    /smoke was cancelled/
  );
  assert.equal(requests, 0);
});

test('cancellation after owned token creation cleans it before model catalog access', async () => {
  const controller = new AbortController();
  const { calls, fetchImpl: baseFetch } = createWebApi();
  const fetchImpl = async (input, options = {}) => {
    const response = await baseFetch(input, options);
    if ((options.method ?? 'GET') === 'POST' && new URL(input).pathname === '/admin/api/tokens') {
      controller.abort();
    }
    return response;
  };

  await assert.rejects(
    prepareExistingAiLiveSmokeSession({ env: {}, signal: controller.signal, fetchImpl }),
    /smoke was cancelled/
  );

  const pathFor = (call) => new URL(call.url).pathname;
  const tokenCreateIndex = calls.findIndex(
    (call) => call.method === 'POST' && pathFor(call) === '/admin/api/tokens'
  );
  const tokenDeleteIndex = calls.findIndex(
    (call) => call.method === 'DELETE' && pathFor(call) === `/admin/api/tokens/${OWNED_TOKEN_ID}`
  );
  const tokenVerificationIndex = calls.findIndex(
    (call, index) =>
      index > tokenDeleteIndex && call.method === 'GET' && pathFor(call) === '/admin/api/tokens'
  );

  assert.notEqual(tokenCreateIndex, -1);
  assert.ok(tokenDeleteIndex > tokenCreateIndex);
  assert.ok(tokenVerificationIndex > tokenDeleteIndex);
  assert.equal(calls.filter((call) => pathFor(call) === '/v1/models').length, 0);
  assert.equal(
    calls.some((call) => call.method === 'PATCH'),
    false
  );
});

test('uses a securely supplied bearer only for strict gpt-5 model validation', async () => {
  const { calls, fetchImpl } = createWebApi();
  const session = await prepareExistingAiLiveSmokeSession({
    env: { [AI_LIVE_SMOKE_ENV.providerToken]: BEARER_SENTINEL },
    fetchImpl
  });

  assert.equal(session.origin, WEB_API_ORIGIN);
  assert.equal(session.model, 'gpt-5');
  assert.equal(session.token, BEARER_SENTINEL);
  await session.cleanup();

  assert.equal(
    calls.some((call) => call.method === 'POST' || call.method === 'DELETE'),
    false
  );
  assert.equal(calls.filter((call) => new URL(call.url).pathname === '/v1/models').length, 1);
  assert.equal(
    calls.some((call) => call.headers.get('authorization') === `Bearer ${BEARER_SENTINEL}`),
    true
  );
});

test('creates and deletes only its own never-expiring token when no secure bearer exists', async () => {
  const { calls, fetchImpl } = createWebApi();
  const session = await prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl });
  assert.equal(session.token, BEARER_SENTINEL);
  assert.equal(session.model, 'gpt-5');

  await session.cleanup();
  await session.cleanup();

  assert.equal(
    calls.filter(
      (call) => call.method === 'POST' && new URL(call.url).pathname === '/admin/api/tokens'
    ).length,
    1
  );
  assert.deepEqual(
    calls.filter((call) => call.method === 'DELETE').map((call) => new URL(call.url).pathname),
    [`/admin/api/tokens/${OWNED_TOKEN_ID}`]
  );
  assert.equal(
    calls.filter(
      (call) => call.method === 'GET' && new URL(call.url).pathname === '/admin/api/tokens'
    ).length,
    1
  );
  assert.equal(
    calls.some((call) => call.method === 'PATCH'),
    false
  );
});

test('fails closed when token creation was attempted but ownership cannot be established', async () => {
  const { calls, fetchImpl: baseFetch } = createWebApi();
  const tokenName = 'HogarIA real smoke uncertain creation';
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? 'GET';
    if (method === 'POST' && url.pathname === '/admin/api/tokens') {
      calls.push({ url: url.toString(), method, headers: new Headers(options.headers) });
      return jsonResponse(
        {
          record: { id: 'invalid-token-id', name: tokenName, expiresAt: null },
          token: 'too-short'
        },
        201
      );
    }
    if (method === 'GET' && url.pathname === '/admin/api/tokens') {
      calls.push({ url: url.toString(), method, headers: new Headers(options.headers) });
      return jsonResponse([{ id: 'preexisting-token-id', name: 'unrelated token' }]);
    }
    return baseFetch(input, options);
  };

  await assert.rejects(
    prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl, tokenName }),
    /owned token cleanup could not be verified/
  );
  assert.equal(
    calls.some((call) => new URL(call.url).pathname === '/v1/models'),
    false
  );
  assert.equal(
    calls.some((call) => call.method === 'DELETE'),
    false
  );
  assert.equal(
    calls.filter((call) => new URL(call.url).pathname === '/admin/api/tokens').length,
    2
  );
});

test('rejects an unauthorized catalog request without provisioning another credential', async () => {
  const { calls, fetchImpl: baseFetch } = createWebApi();
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === '/v1/models') {
      calls.push({ url: url.toString(), method: 'GET', headers: new Headers(options.headers) });
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
    return baseFetch(input, options);
  };

  await assert.rejects(
    prepareExistingAiLiveSmokeSession({
      env: { [AI_LIVE_SMOKE_ENV.providerToken]: BEARER_SENTINEL },
      fetchImpl
    }),
    /preflight failed/
  );
  assert.equal(
    calls.filter((call) => call.method === 'POST' || call.method === 'DELETE').length,
    0
  );
  assert.equal(
    calls.some((call) => call.headers.get('authorization') === `Bearer ${BEARER_SENTINEL}`),
    true
  );
});

test('rejects malformed, non-JSON, empty, or oversized preflight responses without writes', async () => {
  const invalidResponses = [
    new Response('<html/>', { headers: { 'content-type': 'text/html' } }),
    new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': String(128 * 1024 + 1) }
    }),
    new Response(null, { headers: { 'content-type': 'application/json' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(128 * 1024 + 1));
          controller.close();
        }
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  ];

  for (const response of invalidResponses) {
    const { calls, fetchImpl: baseFetch } = createWebApi();
    const fetchImpl = async (input, options = {}) => {
      if (new URL(input).pathname === '/health/ready') return response;
      return baseFetch(input, options);
    };
    await assert.rejects(prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl }));
    assert.equal(
      calls.some((call) => call.method === 'POST' || call.method === 'DELETE'),
      false
    );
    assert.equal(
      calls.some((call) => new URL(call.url).pathname === '/v1/models'),
      false
    );
  }
});

test('rejects missing or incompatible gpt-5 without falling back to a different model', async () => {
  const { calls, fetchImpl } = createWebApi({
    models: [
      {
        id: 'gpt-5-mini',
        status: 'active',
        modalities: { input: ['text', 'image'], output: ['text'] }
      },
      {
        id: 'gpt-5',
        status: 'active',
        modalities: { input: ['text'], output: ['text'] }
      }
    ]
  });

  await assert.rejects(
    prepareExistingAiLiveSmokeSession({ env: {}, fetchImpl }),
    /gpt-5.*text and image/
  );
  assert.equal(
    calls.some((call) => call.method === 'PATCH'),
    false
  );
  assert.deepEqual(
    calls.filter((call) => call.method === 'DELETE').map((call) => new URL(call.url).pathname),
    [`/admin/api/tokens/${OWNED_TOKEN_ID}`]
  );
  assert.equal(
    calls.some((call) => call.headers.get('authorization') === `Bearer ${BEARER_SENTINEL}`),
    true
  );
});
