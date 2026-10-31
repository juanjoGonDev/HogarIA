import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STATIC_HEADER_CASES, verifyStaticHeaders } from './nginx-static-headers-smoke.mjs';

function completeResponse(path) {
  const cacheControl = STATIC_HEADER_CASES.find((entry) => entry.path === path)?.cacheControl;
  return new Response('', {
    status: 200,
    headers: {
      'cache-control': cacheControl,
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff'
    }
  });
}

test('verifies cache and security headers for shell, manifests, and hashed bundles', async () => {
  const requests = [];
  const checked = await verifyStaticHeaders('http://127.0.0.1:8080', async (url, init) => {
    requests.push({ path: new URL(url).pathname, method: init?.method });
    return completeResponse(new URL(url).pathname);
  });

  assert.deepEqual(checked, STATIC_HEADER_CASES.map(({ path }) => path));
  assert.deepEqual(
    requests,
    STATIC_HEADER_CASES.map(({ path }) => ({ path, method: 'HEAD' }))
  );
});

test('rejects a static response that drops security headers', async () => {
  await assert.rejects(
    verifyStaticHeaders(
      'http://127.0.0.1:8080',
      async () =>
        new Response('', {
          status: 200,
          headers: { 'cache-control': 'no-cache, no-store, must-revalidate' }
        })
    ),
    /expected x-frame-options: SAMEORIGIN, received missing/
  );
});

test('rejects a static response with the wrong cache policy or status', async () => {
  await assert.rejects(
    verifyStaticHeaders('http://127.0.0.1:8080', async () =>
      new Response('', {
        status: 200,
        headers: {
          'cache-control': 'public, max-age=31536000, immutable',
          'x-frame-options': 'SAMEORIGIN',
          'x-content-type-options': 'nosniff'
        }
      })
    ),
    /expected cache-control: no-cache, no-store, must-revalidate/
  );

  await assert.rejects(
    verifyStaticHeaders('http://127.0.0.1:8080', async () => new Response('', { status: 404 })),
    /expected HTTP 200, received 404/
  );
});

test('rejects non-HTTP or credential-bearing smoke URLs', async () => {
  await assert.rejects(verifyStaticHeaders('file:///tmp/nginx'), /HTTP\(S\)/);
  await assert.rejects(
    verifyStaticHeaders('http://user:secret@127.0.0.1:8080'),
    /must not contain credentials/
  );
});
