import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyContainerSmoke } from './container-smoke.mjs';

const health = (imageRef = 'ghcr.io/juanjoGonDev/hogaria:0123456789abcdef0123456789abcdef01234567') =>
  new Response(JSON.stringify({ status: 'ok', uptime: 1, version: '1.0.0', imageRef }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

function healthyFetcher(onRequest = () => {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    onRequest(url, init);

    if (url.pathname === '/health' || url.pathname === '/api/health') return health();
    if (url.pathname === '/') {
      return new Response('<!doctype html><html><app-root></app-root></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
    if (url.pathname === '/api/ai/assistant/proposals' && init.method === 'POST') {
      return new Response(JSON.stringify({ message: 'Authorization header required' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('not found', { status: 404 });
  };
}

test('checks health, static frontend, and mounted assistant API without credentials', async () => {
  const requests = [];

  const result = await verifyContainerSmoke('http://127.0.0.1:3000', {
    fetcher: healthyFetcher((url, init) => requests.push({ path: url.pathname, init })),
    timeoutMs: 50,
    pollIntervalMs: 0
  });

  assert.deepEqual(result.checked, ['/health', '/api/health', '/', '/api/ai/assistant/proposals']);
  assert.deepEqual(
    requests.map(({ path }) => path),
    result.checked
  );
  assert.equal(requests[3].init.method, 'POST');
  assert.equal(requests[3].init.headers?.authorization, undefined);
  assert.equal(requests[3].init.body, '{}');
});

test('waits for the container health endpoint before checking the rest', async () => {
  let healthCalls = 0;
  const fetcher = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/health' && healthCalls++ === 0) return new Response('', { status: 503 });
    return healthyFetcher()(input, init);
  };

  const result = await verifyContainerSmoke('http://127.0.0.1:3000/', {
    fetcher,
    timeoutMs: 50,
    pollIntervalMs: 0,
    sleep: async () => {}
  });

  assert.equal(healthCalls, 2);
  assert.deepEqual(result.checked[0], '/health');
});

test('fails when the server never becomes healthy', async () => {
  await assert.rejects(
    verifyContainerSmoke('http://127.0.0.1:3000', {
      fetcher: async () => new Response('', { status: 503 }),
      timeoutMs: 2,
      pollIntervalMs: 0,
      sleep: async () => {}
    })
    //health did not become ready/
  );
});

test('keeps the process alive and retries when a health fetch never settles', async () => {
  let healthCalls = 0;
  await assert.rejects(
    verifyContainerSmoke('http://127.0.0.1:3000', {
      fetcher: async (input) => {
        if (new URL(input).pathname === '/health') {
          healthCalls += 1;
          return new Promise(() => {});
        }
        return health();
      },
      timeoutMs: 25,
      requestTimeoutMs: 5,
      pollIntervalMs: 0,
      sleep: async () => {}
    }),
    /did not become ready.*timed out/
  );
  assert.ok(healthCalls > 0);
});

test('fails closed when health does not include the image reference', async () => {
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/health' || url.pathname === '/api/health') return health('');
    return healthyFetcher()(input, init);
  };

  await assert.rejects(
    verifyContainerSmoke('http://127.0.0.1:3000', {
      fetcher,
      timeoutMs: 50,
      pollIntervalMs: 0
    }),
    /did not become ready.*invalid health payload/
  );
});

test('rejects an image ref that differs from the expected published ref', async () => {
  await assert.rejects(
    verifyContainerSmoke('http://127.0.0.1:3000', {
      fetcher: healthyFetcher(),
      timeoutMs: 50,
      pollIntervalMs: 0,
      expectedImageRef: 'ghcr.io/juanjoGonDev/hogaria:deadbeef'
    }),
    /did not become ready.*does not match the expected image ref/
  );
});

test('rejects a blank expected image reference', async () => {
  await assert.rejects(
    verifyContainerSmoke('http://127.0.0.1:3000', {
      fetcher: healthyFetcher(),
      expectedImageRef: '   '
    }),
    /expectedImageRef must not be blank/
  );
});

test('fails if the static app is missing or the assistant API is not mounted', async () => {
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/') return new Response('missing', { status: 404 });
    return healthyFetcher()(input, init);
  };

  await assert.rejects(
    verifyContainerSmoke('http://127.0.0.1:3000', {
      fetcher,
      timeoutMs: 50,
      pollIntervalMs: 0
    }),
    /GET \/ returned HTTP 404/
  );

  const missingAssistant = healthyFetcher();
  await assert.rejects(
    verifyContainerSmoke('http://127.0.0.1:3000', {
      fetcher: async (input, init = {}) => {
        const url = new URL(input);
        if (url.pathname === '/api/ai/assistant/proposals')
          return new Response('', { status: 404 });
        return missingAssistant(input, init);
      },
      timeoutMs: 50,
      pollIntervalMs: 0
    }),
    /POST \/api\/ai\/assistant\/proposals expected auth gate HTTP 401, received 404/
  );
});

test('rejects malformed or credential-bearing base URLs', async () => {
  await assert.rejects(verifyContainerSmoke('file:///tmp/container'), /HTTP or HTTPS URL/);
  await assert.rejects(
    verifyContainerSmoke('http://user:secret@127.0.0.1:3000'),
    /must not contain credentials/
  );
});
