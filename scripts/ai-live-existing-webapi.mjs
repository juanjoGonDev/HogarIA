import { randomUUID } from 'node:crypto';

import { AI_LIVE_SMOKE_ENV, WEB_API_ORIGIN } from './ai-live-smoke-safety.mjs';

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_JSON_RESPONSE_BYTES = 128 * 1024;
const TOKEN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_LOGGING_SAFE_SETTINGS = Object.freeze({
  captureDetails: false,
  enabled: false,
  maxBodyChars: 0,
  maxHeaderValueChars: 0,
  maxHeaders: 0
});

/** Preflight the user's existing local WebAPI and acquire only an owned smoke credential if needed. */
export async function prepareExistingAiLiveSmokeSession({
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  tokenName = `HogarIA real smoke ${randomUUID()}`
} = {}) {
  let token = readSecureBearer(env);
  let ownedTokenId;
  let tokenCreationAttempted = false;
  let cleanupPromise;

  const request = async (path, options = {}, { cleanup = false } = {}) => {
    if (!cleanup && signal?.aborted) {
      throw new Error('The existing WebAPI smoke was cancelled.');
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal && !cleanup ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fetchImpl(new URL(path, WEB_API_ORIGIN), {
        ...options,
        headers: { accept: 'application/json', ...options.headers },
        redirect: 'error',
        signal: requestSignal
      });
    } catch {
      throw new Error('The existing WebAPI request failed.');
    }
  };

  const json = async (path, options = {}, expectedStatus = 200, requestOptions) => {
    const response = await request(path, options, requestOptions);
    if (response.status !== expectedStatus) {
      await response.body?.cancel().catch(() => {});
      throw new Error('The existing WebAPI preflight returned an unexpected status.');
    }
    return readLimitedJson(response);
  };

  const findOwnedTokenId = async () => {
    if (ownedTokenId) return ownedTokenId;
    if (!tokenCreationAttempted) return undefined;
    const records = await json('/admin/api/tokens', {}, 200, { cleanup: true });
    if (!Array.isArray(records)) {
      throw new Error('The owned WebAPI smoke token could not be identified for cleanup.');
    }
    const matches = records.filter((record) => record?.name === tokenName);
    if (matches.length !== 1 || !isTokenId(matches[0]?.id)) {
      throw new Error('The owned WebAPI smoke token could not be identified for cleanup.');
    }
    ownedTokenId = matches[0].id;
    return ownedTokenId;
  };

  const cleanupOwnedToken = async () => {
    const id = await findOwnedTokenId();
    if (!id) return;
    const response = await request(
      `/admin/api/tokens/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      { cleanup: true }
    );
    if (response.status !== 204 && response.status !== 404) {
      await response.body?.cancel().catch(() => {});
      throw new Error('The owned WebAPI smoke token could not be deleted.');
    }
    await response.body?.cancel().catch(() => {});
    const records = await json('/admin/api/tokens', {}, 200, { cleanup: true });
    if (
      !Array.isArray(records) ||
      records.some((record) => record?.id === id || record?.name === tokenName)
    ) {
      throw new Error('The owned WebAPI smoke token cleanup could not be verified.');
    }
  };

  const cleanup = () => {
    if (!cleanupPromise) cleanupPromise = cleanupOwnedToken();
    return cleanupPromise;
  };

  try {
    // Run only read-only health/privacy checks before acquiring a credential or querying models.
    await verifyExistingWebApi(json, {
      allowRedactedRequestLogs: env?.[AI_LIVE_SMOKE_ENV.allowRedactedRequestLogs] === '1'
    });

    if (!token) {
      tokenCreationAttempted = true;
      const created = await json(
        '/admin/api/tokens',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: tokenName, expiresAt: null })
        },
        201
      );
      if (isTokenId(created?.record?.id)) ownedTokenId = created.record.id;
      if (
        typeof created?.token !== 'string' ||
        created.token.length < 32 ||
        !isTokenId(created?.record?.id) ||
        created.record.expiresAt !== null ||
        created.record.name !== tokenName
      ) {
        throw new Error('The existing WebAPI did not return the expected smoke token.');
      }
      token = created.token;
    }

    const catalog = await json(
      '/v1/models',
      { headers: { authorization: `Bearer ${token}` } },
      200
    );
    assertGpt5TextImageModel(catalog);

    return Object.freeze({
      origin: WEB_API_ORIGIN,
      token,
      model: 'gpt-5',
      cleanup
    });
  } catch (error) {
    if (tokenCreationAttempted) {
      try {
        await cleanup();
      } catch {
        throw new Error('Existing WebAPI setup failed; owned token cleanup could not be verified.');
      }
    }
    if (signal?.aborted) throw new Error('The existing WebAPI smoke was cancelled.');
    if (error instanceof Error && SAFE_ERRORS.has(error.message)) throw error;
    throw new Error('Existing WebAPI preflight failed.');
  }
}

async function verifyExistingWebApi(json, { allowRedactedRequestLogs = false } = {}) {
  const [ready, identity, controls, session, sessionRecording, diagnosticHtml] = await Promise.all([
    json('/health/ready'),
    json('/'),
    json('/admin/api/runtime-controls'),
    json('/admin/api/chatgpt/session'),
    json('/admin/api/settings/session-recording'),
    json('/admin/api/settings/diagnostic-html')
  ]);

  if (
    ready?.ready !== true ||
    identity?.name !== 'web-api' ||
    !Array.isArray(identity?.routes) ||
    !identity.routes.includes('/v1/models')
  ) {
    throw new Error('The existing WebAPI service identity or readiness is invalid.');
  }
  if (session?.state !== 'ready') {
    throw new Error('The configured WebAPI provider session is not ready; complete sign-in first.');
  }

  const logging = controls?.requestLogging?.settings;
  const acceptedLoggingSettings =
    sameSettings(logging, REQUEST_LOGGING_SAFE_SETTINGS) ||
    (allowRedactedRequestLogs && hasBoundedRequestLoggingSettings(controls?.requestLogging));
  if (
    !acceptedLoggingSettings ||
    sessionRecording?.enabled !== false ||
    diagnosticHtml?.enabled !== false
  ) {
    throw new Error('The existing WebAPI privacy settings are unsafe for the smoke.');
  }
}

function hasBoundedRequestLoggingSettings(requestLogging) {
  const settings = requestLogging?.settings;
  const bounds = requestLogging?.bounds;
  if (
    typeof settings !== 'object' ||
    settings === null ||
    Array.isArray(settings) ||
    typeof bounds !== 'object' ||
    bounds === null ||
    Array.isArray(bounds)
  ) {
    return false;
  }

  const expectedBooleanKeys = ['captureDetails', 'enabled'];
  const expectedLimitKeys = ['maxBodyChars', 'maxHeaderValueChars', 'maxHeaders'];
  const expectedKeys = [...expectedBooleanKeys, ...expectedLimitKeys].sort();
  if (
    Object.keys(settings).sort().join('|') !== expectedKeys.join('|') ||
    Object.keys(bounds).sort().join('|') !== expectedLimitKeys.sort().join('|') ||
    expectedBooleanKeys.some((key) => typeof settings[key] !== 'boolean')
  ) {
    return false;
  }

  return expectedLimitKeys.every((key) => {
    const value = settings[key];
    const limit = bounds[key];
    return (
      Number.isSafeInteger(value) &&
      typeof limit === 'object' &&
      limit !== null &&
      Number.isSafeInteger(limit.min) &&
      Number.isSafeInteger(limit.max) &&
      limit.min >= 0 &&
      limit.max >= limit.min &&
      value >= limit.min &&
      value <= limit.max
    );
  });
}

function sameSettings(actual, expected) {
  return (
    actual !== null &&
    typeof actual === 'object' &&
    Object.keys(expected).every((key) => actual[key] === expected[key])
  );
}

function assertGpt5TextImageModel(catalog) {
  const model = Array.isArray(catalog?.data)
    ? catalog.data.find((entry) => entry?.id === 'gpt-5')
    : undefined;
  if (
    !model ||
    model.status !== 'active' ||
    !Array.isArray(model.modalities?.input) ||
    !model.modalities.input.includes('text') ||
    !model.modalities.input.includes('image')
  ) {
    throw new Error('The existing WebAPI model gpt-5 must support active text and image input.');
  }
}

function readSecureBearer(env) {
  const value = env?.[AI_LIVE_SMOKE_ENV.providerToken];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim() !== value || value.length < 32) {
    throw new Error('The configured WebAPI smoke bearer is invalid.');
  }
  return value;
}

function isTokenId(value) {
  return typeof value === 'string' && TOKEN_ID_PATTERN.test(value);
}

async function readLimitedJson(response) {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel().catch(() => {});
    throw new Error('The existing WebAPI returned a non-JSON response.');
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_JSON_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('The existing WebAPI response exceeded the size limit.');
  }
  if (!response.body) throw new Error('The existing WebAPI response was empty.');

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_JSON_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('The existing WebAPI response exceeded the size limit.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('The existing WebAPI returned invalid JSON.');
  }
}

const SAFE_ERRORS = new Set([
  'The existing WebAPI smoke was cancelled.',
  'The existing WebAPI service identity or readiness is invalid.',
  'The configured WebAPI provider session is not ready; complete sign-in first.',
  'The existing WebAPI privacy settings are unsafe for the smoke.',
  'The existing WebAPI did not return the expected smoke token.',
  'The existing WebAPI model gpt-5 must support active text and image input.',
  'The configured WebAPI smoke bearer is invalid.',
  'The existing WebAPI returned an unexpected status.',
  'The existing WebAPI returned a non-JSON response.',
  'The existing WebAPI response exceeded the size limit.',
  'The existing WebAPI response was empty.',
  'The existing WebAPI returned invalid JSON.',
  'The owned WebAPI smoke token could not be identified for cleanup.',
  'The owned WebAPI smoke token could not be deleted.',
  'The owned WebAPI smoke token cleanup could not be verified.'
]);
