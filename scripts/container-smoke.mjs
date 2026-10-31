const DEFAULT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;

function baseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Container smoke requires a valid HTTP or HTTPS URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Container smoke requires an HTTP or HTTPS URL');
  }
  if (url.username || url.password) {
    throw new Error('Container smoke base URL must not contain credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Container smoke base URL must be an origin without path, query, or fragment');
  }

  return url.origin;
}

async function request(fetcher, origin, pathname, init = {}) {
  return fetcher(`${origin}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

async function assertHealthResponse(response, pathname, expectedImageRef) {
  if (!response.ok) throw new Error(`GET ${pathname} returned HTTP ${response.status}`);

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`GET ${pathname} did not return JSON`);
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !['ok', 'warning', 'critical'].includes(body.status) ||
    !Number.isFinite(body.uptime) ||
    typeof body.version !== 'string' ||
    typeof body.imageRef !== 'string' ||
    body.imageRef.trim().length === 0
  ) {
    throw new Error(`GET ${pathname} returned an invalid health payload`);
  }
  if (expectedImageRef && body.imageRef !== expectedImageRef) {
    throw new Error(`GET ${pathname} image reference does not match the expected image ref`);
  }
}

async function waitForHealth(
  origin,
  { fetcher, timeoutMs, pollIntervalMs, sleep, expectedImageRef }
) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response';

  while (true) {
    try {
      const response = await request(fetcher, origin, '/health', {
        headers: { accept: 'application/json' }
      });
      if (response.ok) {
        await assertHealthResponse(response, '/health', expectedImageRef);
        return;
      }
      lastFailure = `HTTP ${response.status}`;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'request failed';
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Container /health did not become ready within ${timeoutMs} ms (${lastFailure})`
      );
    }
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

export async function verifyContainerSmoke(
  baseUrl,
  {
    fetcher = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = 500,
    expectedImageRef,
    sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))
  } = {}
) {
  const origin = baseOrigin(baseUrl);
  if (typeof fetcher !== 'function') throw new Error('Container smoke requires fetch support');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new Error('pollIntervalMs must be non-negative');
  }
  const expectedRef = expectedImageRef?.trim();
  if (expectedImageRef !== undefined && !expectedRef) {
    throw new Error('expectedImageRef must not be blank');
  }

  await waitForHealth(origin, {
    fetcher,
    timeoutMs,
    pollIntervalMs,
    sleep,
    expectedImageRef: expectedRef
  });
  const checked = ['/health'];

  const apiHealth = await request(fetcher, origin, '/api/health', {
    headers: { accept: 'application/json' }
  });
  await assertHealthResponse(apiHealth, '/api/health', expectedRef);
  checked.push('/api/health');

  const frontend = await request(fetcher, origin, '/', { headers: { accept: 'text/html' } });
  if (!frontend.ok) throw new Error(`GET / returned HTTP ${frontend.status}`);
  if (!frontend.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new Error('GET / did not serve HTML');
  }
  const html = await frontend.text();
  if (!/<html\b/i.test(html)) throw new Error('GET / returned an invalid HTML document');
  checked.push('/');

  const assistant = await request(fetcher, origin, '/api/ai/assistant/proposals', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: '{}'
  });
  if (assistant.status !== 401) {
    throw new Error(
      `POST /api/ai/assistant/proposals expected auth gate HTTP 401, received ${assistant.status}`
    );
  }
  checked.push('/api/ai/assistant/proposals');

  return { checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('Usage: node scripts/container-smoke.mjs http://127.0.0.1:3000');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyContainerSmoke(baseUrl, {
      expectedImageRef: process.env.EXPECTED_IMAGE_REF
      });
      console.log(`Container smoke passed: ${result.checked.join(', ')}`);
    } catch (error) {
      console.error(
        `Container smoke failed: ${error instanceof Error ? error.message : 'unknown error'}`
      );
      process.exitCode = 1;
    }
  }
}
import { pathToFileURL } from 'node:url';
