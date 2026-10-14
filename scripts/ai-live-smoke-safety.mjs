import { createServer, request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION,
  AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION,
  AI_LIVE_RECEIPT_UNSUBMITTED_COMPLETION_BUDGET,
  AI_LIVE_RECEIPT_UNSUBMITTED_ONLY_SELECTION,
  AI_LIVE_RECEIPT_UNSUBMITTED_TICKET_COUNT
} from './ai-live-receipt-inputs.mjs';
import {
  AI_LIVE_SMOKE_DEADLINES,
  assertAiLiveSmokeDeadlineContract
} from './ai-live-smoke-contract.mjs';

export const AI_LIVE_SMOKE_ENV = Object.freeze({
  optIn: 'HOGARIA_AI_REAL_SMOKE',
  allowRedactedRequestLogs: 'HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS',
  runner: 'HOGARIA_AI_REAL_SMOKE_RUNNER',
  providerToken: 'HOGARIA_AI_REAL_SMOKE_PROVIDER_TOKEN',
  proxyToken: 'HOGARIA_AI_REAL_SMOKE_PROXY_TOKEN',
  proxyUrl: 'HOGARIA_AI_REAL_SMOKE_PROXY_URL',
  model: 'HOGARIA_AI_REAL_SMOKE_MODEL',
  recipeMaxTokens: 'HOGARIA_AI_REAL_SMOKE_RECIPE_MAX_TOKENS',
  configTimeoutMs: 'HOGARIA_AI_REAL_SMOKE_CONFIG_TIMEOUT_MS',
  requestTimeoutMs: 'HOGARIA_AI_REAL_SMOKE_REQUEST_TIMEOUT_MS',
  testTimeoutMs: 'HOGARIA_AI_REAL_SMOKE_TEST_TIMEOUT_MS',
  globalTimeoutMs: 'HOGARIA_AI_REAL_SMOKE_GLOBAL_TIMEOUT_MS',
  receiptPath: 'HOGARIA_AI_REAL_SMOKE_RECEIPT_PATH',
  receiptsOnly: 'HOGARIA_AI_REAL_SMOKE_RECEIPTS_ONLY',
  receiptSelection: 'HOGARIA_AI_REAL_SMOKE_RECEIPT_SELECTION',
  receiptDirectory: 'HOGARIA_AI_REAL_SMOKE_RECEIPT_DIRECTORY',
  preferredJpegOrdinal: 'HOGARIA_AI_REAL_SMOKE_PREFERRED_JPEG_ORDINAL',
  householdMealOnly: 'HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY'
});

export const AI_LIVE_SMOKE_KEY_MARKER = '__HOGARIA_AI_REAL_SMOKE_PROVIDER_KEY__';
export const WEB_API_ORIGIN = 'http://127.0.0.1:3001';
export const AI_LIVE_SMOKE_MIN_COMPLETIONS = 9;
export const AI_LIVE_SMOKE_COMPLETION_BUDGET = 10;
export const AI_LIVE_RECEIPT_SMOKE_REQUEST_BUDGET = AI_LIVE_RECEIPT_UNSUBMITTED_COMPLETION_BUDGET;
export const AI_LIVE_RECEIPT_SMOKE_TICKET_COUNT = AI_LIVE_RECEIPT_UNSUBMITTED_TICKET_COUNT;
export const AI_LIVE_RECEIPT_SMOKE_MAX_REQUEST_BYTES = 15 * 1024 * 1024;
export const AI_LIVE_HOUSEHOLD_MEAL_SMOKE_COMPLETION_BUDGET = 1;
export const AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME = 'weekly_meal_proposal';
export const AI_LIVE_HOUSEHOLD_MEAL_CONTEXT_FILENAME = 'meal-planning-context.json';
export const AI_LIVE_HOUSEHOLD_MEAL_RECIPE_CATALOG_FILENAME = 'household-recipes-catalog.json';
export const AI_LIVE_HOUSEHOLD_MEAL_PROMPT_CONTRACT = Object.freeze({
  forbiddenPromptTerms: Object.freeze([
    'HogarIA miembro QA uno',
    'HogarIA miembro QA dos',
    'HogarIA smoke hogar'
  ])
});

const RECEIPT_SMOKE_INPUT_KEYS = Object.freeze([
  AI_LIVE_SMOKE_ENV.receiptPath,
  AI_LIVE_SMOKE_ENV.receiptsOnly,
  AI_LIVE_SMOKE_ENV.receiptSelection,
  AI_LIVE_SMOKE_ENV.receiptDirectory,
  AI_LIVE_SMOKE_ENV.preferredJpegOrdinal
]);

export function validateAiLiveHouseholdMealSmokeRequest(env = process.env) {
  const requested = env[AI_LIVE_SMOKE_ENV.householdMealOnly];
  if (requested === undefined || requested === '0' || requested === '') return false;
  if (requested !== '1') {
    throw new Error('Household meal smoke requires the exact opt-in value.');
  }
  if (RECEIPT_SMOKE_INPUT_KEYS.some((key) => env[key] !== undefined)) {
    throw new Error('Household meal smoke cannot include receipt inputs.');
  }
  return true;
}

export function validateAiLiveReceiptSmokeRequest(env = process.env) {
  const requested = env[AI_LIVE_SMOKE_ENV.receiptsOnly];
  if (requested === undefined || requested === '0' || requested === '') {
    if (
      env[AI_LIVE_SMOKE_ENV.receiptDirectory] !== undefined ||
      env[AI_LIVE_SMOKE_ENV.preferredJpegOrdinal] !== undefined ||
      env[AI_LIVE_SMOKE_ENV.receiptSelection] !== undefined
    ) {
      throw new Error('Receipt-only source inputs require receipt-only mode.');
    }
    return false;
  }
  if (requested !== '1') throw new Error('Invalid receipt-only mode for the AI smoke runner.');
  if (
    ![
      AI_LIVE_RECEIPT_UNSUBMITTED_ONLY_SELECTION,
      AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION,
      AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION
    ].includes(env[AI_LIVE_SMOKE_ENV.receiptSelection])
  ) {
    throw new Error('Receipt-only mode requires a supported receipt selection.');
  }

  const directory = env[AI_LIVE_SMOKE_ENV.receiptDirectory];
  if (typeof directory !== 'string' || !isAbsoluteLocalPath(directory)) {
    throw new Error('Receipt-only mode requires an absolute local receipt directory.');
  }
  const ordinal = env[AI_LIVE_SMOKE_ENV.preferredJpegOrdinal];
  if (typeof ordinal !== 'string' || !/^[1-4]$/.test(ordinal)) {
    throw new Error('Receipt-only mode requires a preferred JPEG index from 1 to 4.');
  }
  if (env[AI_LIVE_SMOKE_ENV.receiptPath]) {
    throw new Error('Receipt-only mode cannot be combined with a single receipt path.');
  }
  return true;
}

function isAbsoluteLocalPath(value) {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

export function validateAiLiveSmokeOptIn(env = process.env) {
  if (env[AI_LIVE_SMOKE_ENV.optIn] !== '1') {
    throw new Error('The real AI smoke requires explicit opt-in.');
  }
  if (isContinuousIntegration(env.CI)) {
    throw new Error('The real AI smoke is forbidden in CI.');
  }
}

export function validateAiLiveSmokeRunner(env, args) {
  if (env[AI_LIVE_SMOKE_ENV.runner] !== '1') {
    if (env[AI_LIVE_SMOKE_ENV.providerToken]) {
      throw new Error('A provider credential can only be used by the dedicated AI smoke runner.');
    }
    return false;
  }
  validateAiLiveSmokeOptIn(env);
  const householdMealOnly = validateAiLiveHouseholdMealSmokeRequest(env);
  validateAiLiveReceiptSmokeRequest(env);
  if (env[AI_LIVE_SMOKE_ENV.providerToken]) {
    throw new Error('The WebAPI bearer must remain in the smoke coordinator process memory.');
  }
  const proxyToken = env[AI_LIVE_SMOKE_ENV.proxyToken];
  if (typeof proxyToken !== 'string' || proxyToken.length < 16) {
    throw new Error('The dedicated AI smoke runner has no isolated local proxy credential.');
  }
  const proxy = env[AI_LIVE_SMOKE_ENV.proxyUrl];
  let parsedProxy;
  try {
    parsedProxy = new URL(proxy);
  } catch {
    throw new Error('The dedicated AI smoke runner has no local proxy URL.');
  }
  if (
    parsedProxy.protocol !== 'http:' ||
    parsedProxy.hostname !== '127.0.0.1' ||
    !parsedProxy.port ||
    parsedProxy.pathname !== '/v1' ||
    parsedProxy.search ||
    parsedProxy.hash ||
    parsedProxy.username ||
    parsedProxy.password
  ) {
    throw new Error('The dedicated AI smoke runner proxy is outside the loopback allowlist.');
  }
  if (typeof env[AI_LIVE_SMOKE_ENV.model] !== 'string' || !env[AI_LIVE_SMOKE_ENV.model]) {
    throw new Error('The dedicated AI smoke runner has no selected model.');
  }
  const expectedArgs = householdMealOnly
    ? [
        '--config=playwright.ai-household-meal-real-smoke.config.ts',
        'tests/e2e/household-meal-planning-live-smoke.spec.ts'
      ]
    : ['--config=playwright.ai-real-smoke.config.ts', 'tests/e2e/ai-real-smoke.spec.ts'];
  if (args.length !== expectedArgs.length || expectedArgs.some((arg) => !args.includes(arg))) {
    throw new Error('The dedicated AI smoke runner only accepts its isolated config and test.');
  }
  return true;
}

function isContinuousIntegration(value) {
  if (typeof value !== 'string') return Boolean(value);
  return value !== '' && !/^(?:0|false|no)$/i.test(value.trim());
}

function strictJsonSchemaNode(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.type === 'object' || value.properties) {
    if (
      value.type !== 'object' ||
      !value.properties ||
      typeof value.properties !== 'object' ||
      Array.isArray(value.properties) ||
      value.additionalProperties !== false
    ) {
      return false;
    }
    const keys = Object.keys(value.properties);
    if (
      !Array.isArray(value.required) ||
      keys.length !== value.required.length ||
      keys.some((key) => !value.required.includes(key))
    ) {
      return false;
    }
    if (!keys.every((key) => strictJsonSchemaNode(value.properties[key]))) return false;
  }
  if (value.items && !strictJsonSchemaNode(value.items)) return false;
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (value[key] && (!Array.isArray(value[key]) || !value[key].every(strictJsonSchemaNode))) {
      return false;
    }
  }
  if (value.$defs && (!value.$defs || !Object.values(value.$defs).every(strictJsonSchemaNode))) {
    return false;
  }
  return true;
}

function validStrictResponseFormat(value) {
  const format = value?.json_schema;
  return (
    value?.type === 'json_schema' &&
    format &&
    typeof format === 'object' &&
    format.strict === true &&
    typeof format.name === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(format.name) &&
    strictJsonSchemaNode(format.schema) &&
    format.schema.type === 'object'
  );
}

function validMealRecipeAliasSchema(schema) {
  const properties = schema?.properties;
  const newRecipes = properties?.newRecipes;
  const newRecipeItem = newRecipes?.items;
  const events = properties?.events;
  const eventItem = events?.items;
  return (
    schema?.type === 'object' &&
    Array.isArray(schema.required) &&
    schema.required.includes('newRecipes') &&
    schema.required.includes('events') &&
    newRecipes?.type === 'array' &&
    newRecipeItem?.type === 'object' &&
    isRecord(newRecipeItem.properties) &&
    Object.hasOwn(newRecipeItem.properties, 'alias') &&
    Object.hasOwn(newRecipeItem.properties, 'recipe') &&
    events?.type === 'array' &&
    Number.isInteger(events.minItems) &&
    events.minItems >= 1 &&
    eventItem?.type === 'object' &&
    isRecord(eventItem.properties) &&
    Object.hasOwn(eventItem.properties, 'status') &&
    Object.hasOwn(eventItem.properties, 'recipeAlias') &&
    Array.isArray(eventItem.required) &&
    eventItem.required.includes('status') &&
    eventItem.required.includes('recipeAlias')
  );
}

function validBase64DataUri(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return false;
  const encoded = value.slice(prefix.length);
  return encoded.length > 0 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
}

function validInventoryJsonDataUri(value) {
  const prefix = 'data:application/json;base64,';
  if (!validBase64DataUri(value, prefix)) return false;
  try {
    const snapshot = JSON.parse(Buffer.from(value.slice(prefix.length), 'base64').toString('utf8'));
    return (
      snapshot !== null &&
      typeof snapshot === 'object' &&
      Array.isArray(snapshot.categorias) &&
      Array.isArray(snapshot.productos)
    );
  } catch {
    return false;
  }
}

function hasExactReceiptAttachments(messages) {
  const userMessages = messages.filter((message) => message?.role === 'user');
  if (userMessages.length !== 1 || !Array.isArray(userMessages[0]?.content)) return false;
  const parts = userMessages[0].content;
  const attachments = parts.filter((part) => part?.type === 'file' || part?.type === 'image_url');
  if (attachments.length !== 2) return false;

  const inventoryFiles = attachments.filter(
    (part) =>
      part.type === 'file' &&
      part.file?.filename === 'inventario.json' &&
      validInventoryJsonDataUri(part.file?.file_data)
  );
  const receiptFiles = attachments.filter(
    (part) =>
      (part.type === 'file' &&
        part.file?.filename === 'ticket.pdf' &&
        validBase64DataUri(part.file?.file_data, 'data:application/pdf;base64,')) ||
      (part.type === 'image_url' &&
        validBase64DataUri(part.image_url?.url, 'data:image/jpeg;base64,'))
  );
  return inventoryFiles.length === 1 && receiptFiles.length === 1;
}

export function selectAiLiveModel(models, requestedModel) {
  if (!Array.isArray(models)) throw new Error('The local model catalog is unavailable.');
  const activeImageModels = models.filter(
    (model) =>
      model &&
      typeof model.id === 'string' &&
      model.status === 'active' &&
      !model.id.startsWith('fake/') &&
      Array.isArray(model.modalities?.input) &&
      model.modalities.input.includes('text') &&
      model.modalities.input.includes('image')
  );
  const selected = requestedModel
    ? activeImageModels.find((model) => model.id === requestedModel)
    : (activeImageModels.find((model) => model.id === 'gpt-5') ?? activeImageModels[0]);
  if (!selected) {
    throw new Error(
      requestedModel
        ? 'The selected live AI model is not available for text and image input.'
        : 'The local model catalog has no active model with text and image input.'
    );
  }
  return selected.id;
}

function validRequestLoggingSettings(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.captureDetails === 'boolean' &&
    typeof value.enabled === 'boolean' &&
    Number.isInteger(value.maxBodyChars) &&
    Number.isInteger(value.maxHeaderValueChars) &&
    Number.isInteger(value.maxHeaders)
  );
}

function safeRequestLoggingSettings(value) {
  return (
    validRequestLoggingSettings(value) &&
    value.captureDetails === false &&
    value.maxBodyChars === 0 &&
    value.maxHeaderValueChars === 0 &&
    value.maxHeaders === 0
  );
}

/** Provisions a short-lived token only when existing WebAPI logs are safely redacted. */
function validateIsolatedWebApiOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('AI smoke setup requires its attested local WebAPI origin.');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '3001' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('AI smoke setup origin is outside the isolated WebAPI allowlist.');
  }
  return parsed.origin;
}

export async function prepareAiLiveSmokeSession({
  origin,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  signal
} = {}) {
  const apiOrigin = validateIsolatedWebApiOrigin(origin);
  let tokenId;
  let tokenName;
  let tokenCreateStarted = false;
  let privacyPreflightFailed = false;
  let cleanupPromise;
  let cleanupStarted = false;

  const request = async (path, options = {}) => {
    if (!cleanupStarted) signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(8_000);
    const requestSignal = signal && !cleanupStarted ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetchImpl(`${apiOrigin}${path}`, {
      ...options,
      redirect: 'error',
      signal: requestSignal
    });
    if (!cleanupStarted) signal?.throwIfAborted();
    return response;
  };

  const readJson = async (path, options, expectedStatus = 200) => {
    let response;
    try {
      response = await request(path, options);
    } catch {
      throw new Error('Local WebAPI is unavailable for the AI smoke.');
    }
    if (response.status !== expectedStatus) {
      throw new Error('Local WebAPI rejected an AI smoke setup request.');
    }
    try {
      return await response.json();
    } catch {
      throw new Error('Local WebAPI returned an invalid AI smoke setup response.');
    }
  };

  const readBooleanPreference = async (path) => {
    const payload = await readJson(path);
    if (typeof payload?.enabled !== 'boolean') {
      throw new Error('WebAPI privacy settings could not be verified.');
    }
    return payload.enabled;
  };

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupStarted = true;
    cleanupPromise = (async () => {
      let tokenRemoved = true;
      if (tokenId) {
        try {
          const response = await request(`/admin/api/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'DELETE'
          });
          tokenRemoved = response.status === 204 || response.status === 404;
        } catch {
          tokenRemoved = false;
        }
      } else if (tokenCreateStarted && tokenName) {
        try {
          const response = await request('/admin/api/tokens');
          if (response.status !== 200) throw new Error('token-list-failed');
          const records = await response.json();
          const candidates = Array.isArray(records)
            ? records.filter(
                (record) => record?.name === tokenName && typeof record.id === 'string'
              )
            : [];
          for (const candidate of candidates) {
            const removed = await request(`/admin/api/tokens/${encodeURIComponent(candidate.id)}`, {
              method: 'DELETE'
            });
            if (removed.status !== 204 && removed.status !== 404) tokenRemoved = false;
          }
        } catch {
          tokenRemoved = false;
        }
      }
      if (!tokenRemoved) {
        throw new Error('WebAPI AI smoke cleanup failed; the temporary token needs attention.');
      }
    })();
    return cleanupPromise;
  };

  try {
    const service = await readJson('/');
    if (service?.name !== 'web-api') {
      throw new Error('Local WebAPI identity did not match the smoke allowlist.');
    }

    let healthResponse;
    try {
      healthResponse = await request('/health/ready');
    } catch {
      throw new Error('Local WebAPI is unavailable for the AI smoke.');
    }
    if (healthResponse.status !== 200) {
      throw new Error('Local WebAPI is not ready for the AI smoke.');
    }

    const session = await readJson('/admin/api/chatgpt/session');
    if (session?.state !== 'ready') {
      throw new Error('The configured local provider session is not ready.');
    }

    const runtime = await readJson('/admin/api/runtime-controls');
    if (!safeRequestLoggingSettings(runtime?.requestLogging?.settings)) {
      privacyPreflightFailed = true;
      throw new Error('WebAPI request/session content capture is enabled or not safely redacted.');
    }
    const sessionRecording = await readBooleanPreference('/admin/api/settings/session-recording');
    const diagnosticHtml = await readBooleanPreference('/admin/api/settings/diagnostic-html');
    if (sessionRecording || diagnosticHtml) {
      privacyPreflightFailed = true;
      throw new Error('WebAPI request/session content capture remains enabled.');
    }
    const verifiedRuntime = await readJson('/admin/api/runtime-controls');
    if (
      !safeRequestLoggingSettings(verifiedRuntime?.requestLogging?.settings) ||
      (await readBooleanPreference('/admin/api/settings/session-recording')) ||
      (await readBooleanPreference('/admin/api/settings/diagnostic-html'))
    ) {
      privacyPreflightFailed = true;
      throw new Error('WebAPI request/session content capture remains enabled.');
    }

    const expiresAt = now() + 30 * 60 * 1000;
    tokenName = `MiCocinAI isolated real smoke ${randomUUID()}`;
    tokenCreateStarted = true;
    const tokenPayload = await readJson(
      '/admin/api/tokens',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: tokenName, expiresAt })
      },
      201
    );
    tokenId = tokenPayload?.record?.id;
    const token = tokenPayload?.token;
    if (typeof tokenId !== 'string' || tokenId.length < 1) {
      throw new Error('WebAPI did not return a temporary smoke token record.');
    }
    if (typeof token !== 'string' || token.length < 16) {
      throw new Error('WebAPI did not return a valid temporary smoke token.');
    }

    const modelCatalog = await readJson('/v1/models', {
      headers: { authorization: `Bearer ${token}` }
    });
    const model = selectAiLiveModel(modelCatalog?.data ?? modelCatalog);
    return { token, tokenId, model, cleanup };
  } catch {
    try {
      await cleanup();
    } catch {
      throw new Error('AI smoke setup failed and WebAPI rollback needs attention.');
    }
    if (signal?.aborted) {
      throw new Error('AI smoke setup was cancelled and its temporary token was removed.');
    }
    if (privacyPreflightFailed) {
      throw new Error('AI smoke setup refused because WebAPI request/session capture is unsafe.');
    }
    throw new Error('AI smoke setup could not be completed safely.');
  }
}

export function isolatedProcessEnvironments(env) {
  const server = { ...env };
  const browser = { ...env };
  const playwright = { ...env };
  delete server[AI_LIVE_SMOKE_ENV.providerToken];
  delete browser[AI_LIVE_SMOKE_ENV.providerToken];
  delete playwright[AI_LIVE_SMOKE_ENV.providerToken];
  delete server[AI_LIVE_SMOKE_ENV.householdMealOnly];
  delete browser[AI_LIVE_SMOKE_ENV.householdMealOnly];
  delete server[AI_LIVE_SMOKE_ENV.receiptPath];
  delete browser[AI_LIVE_SMOKE_ENV.receiptPath];
  for (const key of [
    AI_LIVE_SMOKE_ENV.receiptsOnly,
    AI_LIVE_SMOKE_ENV.receiptSelection,
    AI_LIVE_SMOKE_ENV.receiptDirectory,
    AI_LIVE_SMOKE_ENV.preferredJpegOrdinal
  ]) {
    delete server[key];
    delete browser[key];
  }
  delete browser[AI_LIVE_SMOKE_ENV.proxyToken];
  delete playwright[AI_LIVE_SMOKE_ENV.proxyToken];
  return { server, browser, playwright };
}

export function createAiLiveSmokeRunnerEnvironment(
  parentEnv,
  { proxyToken, proxyUrl, model, deadlines = AI_LIVE_SMOKE_DEADLINES, householdMealOnly = false }
) {
  assertAiLiveSmokeDeadlineContract(deadlines);
  const allowedInherited = [
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
    'HOME',
    'PLAYWRIGHT_BROWSERS_PATH',
    'E2E_CHROME_BIN',
    AI_LIVE_SMOKE_ENV.receiptPath,
    AI_LIVE_SMOKE_ENV.receiptsOnly,
    AI_LIVE_SMOKE_ENV.receiptSelection,
    AI_LIVE_SMOKE_ENV.receiptDirectory,
    AI_LIVE_SMOKE_ENV.preferredJpegOrdinal
  ];
  const receiptInputs = new Set(RECEIPT_SMOKE_INPUT_KEYS);
  const env = Object.fromEntries(
    allowedInherited
      .filter((key) => !householdMealOnly || !receiptInputs.has(key))
      .filter((key) => typeof parentEnv[key] === 'string')
      .map((key) => [key, parentEnv[key]])
  );
  return {
    ...env,
    CI: '',
    [AI_LIVE_SMOKE_ENV.optIn]: '1',
    [AI_LIVE_SMOKE_ENV.runner]: '1',
    [AI_LIVE_SMOKE_ENV.proxyToken]: proxyToken,
    [AI_LIVE_SMOKE_ENV.proxyUrl]: proxyUrl,
    [AI_LIVE_SMOKE_ENV.model]: model,
    [AI_LIVE_SMOKE_ENV.recipeMaxTokens]: String(deadlines.recipeMaxTokens),
    [AI_LIVE_SMOKE_ENV.configTimeoutMs]: String(deadlines.configMs),
    [AI_LIVE_SMOKE_ENV.requestTimeoutMs]: String(deadlines.requestMs),
    [AI_LIVE_SMOKE_ENV.testTimeoutMs]: String(deadlines.testMs),
    [AI_LIVE_SMOKE_ENV.globalTimeoutMs]: String(deadlines.globalMs),
    ...(householdMealOnly ? { [AI_LIVE_SMOKE_ENV.householdMealOnly]: '1' } : {}),
    E2E_RATE_LIMIT: 'off'
  };
}

export function isSuccessfulAiLiveSmokeResult({
  runnerExit,
  cleanupFailed,
  calls,
  receiptsOnly = false,
  expectedReceiptTicketCount = AI_LIVE_RECEIPT_SMOKE_TICKET_COUNT
}) {
  if (receiptsOnly) {
    const validReceiptRun = isSuccessfulReceiptOnlyRun(calls, expectedReceiptTicketCount);
    return (
      runnerExit?.code === 0 &&
      runnerExit.cancelled !== true &&
      runnerExit.timedOut !== true &&
      runnerExit.runnerCleaned === true &&
      cleanupFailed !== true &&
      validReceiptRun
    );
  }

  const unsuccessfulIndexes = Array.isArray(calls)
    ? calls.reduce((indexes, call, index) => {
        if (!Number.isInteger(call?.status) || call.status < 200 || call.status >= 300) {
          indexes.push(index);
        }
        return indexes;
      }, [])
    : [];
  const failedReceiptStreamIndex = unsuccessfulIndexes[0];
  const failedReceiptStream = calls?.[failedReceiptStreamIndex];
  const receiptFallback = calls?.[failedReceiptStreamIndex + 1];
  const onlySuccessfulReceiptFallbackFailed =
    unsuccessfulIndexes.length === 1 &&
    failedReceiptStream?.status === 400 &&
    failedReceiptStream?.stream === true &&
    failedReceiptStream?.schemaName === 'receipt' &&
    receiptFallback?.status >= 200 &&
    receiptFallback?.status < 300 &&
    receiptFallback?.stream === false &&
    receiptFallback?.schemaName === 'receipt';

  return (
    runnerExit?.code === 0 &&
    runnerExit.cancelled !== true &&
    runnerExit.timedOut !== true &&
    runnerExit.runnerCleaned === true &&
    cleanupFailed !== true &&
    Array.isArray(calls) &&
    calls.length >= AI_LIVE_SMOKE_MIN_COMPLETIONS &&
    calls.length <= AI_LIVE_SMOKE_COMPLETION_BUDGET &&
    (unsuccessfulIndexes.length === 0 || onlySuccessfulReceiptFallbackFailed)
  );
}

export function isSuccessfulAiLiveHouseholdMealSmokeResult({
  runnerExit,
  cleanupFailed,
  calls,
  proxyMetrics
}) {
  const call = Array.isArray(calls) && calls.length === 1 ? calls[0] : undefined;
  return (
    runnerExit?.code === 0 &&
    runnerExit.cancelled !== true &&
    runnerExit.timedOut !== true &&
    runnerExit.runnerCleaned === true &&
    cleanupFailed !== true &&
    call?.status >= 200 &&
    call?.status < 300 &&
    call?.schemaName === AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME &&
    call?.requestContract?.strictJsonSchema === true &&
    call.requestContract.nonEmptyEventsSchemaValid === true &&
    call.requestContract.contextJsonAttachmentCount === 1 &&
    call.requestContract.contextJsonAttachmentValid === true &&
    call.requestContract.recipeCatalogJsonAttachmentCount === 1 &&
    call.requestContract.recipeCatalogJsonAttachmentValid === true &&
    call.requestContract.recipeCatalogAliasesValid === true &&
    call.requestContract.mealRecipeAliasSchemaValid === true &&
    call.requestContract.memberProfilesValid === true &&
    call.requestContract.planningInputsValid === true &&
    call.requestContract.previousPlanValid === true &&
    call.requestContract.forbiddenIdentityTermsAbsent === true &&
    call.requestContract.forbiddenPromptTermsAbsent === true &&
    call?.responseFormat?.hasChoices === true &&
    call.responseFormat.messageContentType === 'text' &&
    call.responseFormat.isJsonObject === true &&
    call.responseFormat.recipeReferencesValid === true &&
    call.responseFormat.finishReason === 'stop' &&
    proxyMetrics?.requestAttempts === 1 &&
    proxyMetrics.rejectedRequests === 0 &&
    proxyMetrics.failed !== true
  );
}

function isSuccessfulReceiptOnlyRun(calls, expectedReceiptTicketCount) {
  if (
    !Array.isArray(calls) ||
    !Number.isSafeInteger(expectedReceiptTicketCount) ||
    expectedReceiptTicketCount < 1 ||
    calls.length < expectedReceiptTicketCount ||
    calls.length > expectedReceiptTicketCount * 2
  ) {
    return false;
  }

  let index = 0;
  let completedTickets = 0;
  while (index < calls.length) {
    const call = calls[index];
    if (call?.schemaName !== 'receipt' || !validReceiptRequestContract(call)) return false;
    if (call.status >= 200 && call.status < 300) {
      if (call.stream !== true) return false;
      completedTickets += 1;
      index += 1;
      continue;
    }

    const fallback = calls[index + 1];
    if (
      call.status !== 400 ||
      call.stream !== true ||
      fallback?.schemaName !== 'receipt' ||
      !validReceiptRequestContract(fallback) ||
      fallback.status < 200 ||
      fallback.status >= 300 ||
      fallback.stream !== false
    ) {
      return false;
    }
    completedTickets += 1;
    index += 2;
  }
  return completedTickets === expectedReceiptTicketCount;
}

function validReceiptRequestContract(call) {
  return (
    call?.requestContract?.strictJsonSchema === true &&
    call.requestContract.inventoryJsonAttachmentCount === 1 &&
    call.requestContract.receiptAttachmentCount === 1
  );
}

function validateLoopbackOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('AI smoke proxy target must be an explicit local HTTP origin.');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('AI smoke proxy target is outside the loopback allowlist.');
  }
  return parsed;
}

function safeUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const candidates = {
    promptTokens: usage.prompt_tokens ?? usage.input_tokens,
    completionTokens: usage.completion_tokens ?? usage.output_tokens,
    totalTokens: usage.total_tokens
  };
  const parsed = Object.fromEntries(
    Object.entries(candidates).filter(
      ([, value]) => Number.isFinite(value) && Number.isInteger(value) && value >= 0
    )
  );
  const cost = usage.cost_usd ?? usage.cost;
  if (Number.isFinite(cost) && cost >= 0) parsed.costUsd = cost;
  return Object.keys(parsed).length ? parsed : null;
}

function responseUsage(contentType, body) {
  const text = body.toString('utf8');
  if (!contentType.includes('text/event-stream')) {
    try {
      return safeUsage(JSON.parse(text));
    } catch {
      return null;
    }
  }
  let usage = null;
  for (const line of text.split(/\r?\n/u)) {
    const data = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
    if (!data || data === '[DONE]') continue;
    try {
      usage = safeUsage(JSON.parse(data)) ?? usage;
    } catch {
      // Keep-alive/comment/event data isn't a completion metric.
    }
  }
  return usage;
}

/** Inspect in memory; expose only shape/reference booleans, never proposal content. */
function validMealRecipeReferences(proposal, catalogRecipeAliases) {
  if (
    !isRecord(proposal) ||
    !Array.isArray(proposal.newRecipes) ||
    !Array.isArray(proposal.events) ||
    proposal.events.length < 1
  ) {
    return false;
  }
  const newRecipeAliases = new Set();
  for (const definition of proposal.newRecipes) {
    if (
      !isRecord(definition) ||
      typeof definition.alias !== 'string' ||
      !/^N[1-9]\d{0,3}$/.test(definition.alias) ||
      !isRecord(definition.recipe) ||
      typeof definition.recipe.name !== 'string' ||
      !definition.recipe.name.trim() ||
      newRecipeAliases.has(definition.alias)
    ) {
      return false;
    }
    newRecipeAliases.add(definition.alias);
  }
  const referencedNewRecipes = new Set();
  for (const event of proposal.events) {
    if (!isRecord(event)) return false;
    if (event.status === 'unresolved') {
      if (event.recipeAlias !== null) return false;
      continue;
    }
    if (
      event.status !== 'scheduled' ||
      typeof event.recipeAlias !== 'string' ||
      (!catalogRecipeAliases.has(event.recipeAlias) && !newRecipeAliases.has(event.recipeAlias))
    ) {
      return false;
    }
    if (newRecipeAliases.has(event.recipeAlias)) referencedNewRecipes.add(event.recipeAlias);
  }
  return [...newRecipeAliases].every((alias) => referencedNewRecipes.has(alias));
}

function responseFormatSummary(contentType, body, options = {}) {
  if (contentType.includes('text/event-stream')) {
    const summary = {
      hasChoices: false,
      messageContentType: 'stream',
      contentChars: null,
      isJsonObject: false,
      finishReason: 'missing'
    };
    if (options.expectedSchemaName === AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME) {
      summary.recipeReferencesValid = false;
    }
    return summary;
  }
  if (!contentType.includes('application/json')) return null;

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }

  const hasChoices = Array.isArray(payload?.choices);
  const choice = hasChoices ? payload.choices[0] : undefined;
  const content = choice?.message?.content;
  let isJsonObject = false;
  let parsedContent;
  if (typeof content === 'string') {
    try {
      parsedContent = JSON.parse(content);
      isJsonObject = isRecord(parsedContent);
    } catch {
      // The response content itself is deliberately never retained in diagnostics.
    }
  }
  const finishReason = choice?.finish_reason;
  const allowedFinishReasons = new Set([
    'stop',
    'length',
    'tool_calls',
    'function_call',
    'content_filter'
  ]);

  const summary = {
    hasChoices,
    messageContentType:
      typeof content === 'string'
        ? 'text'
        : Array.isArray(content)
          ? 'parts'
          : content == null
            ? 'missing'
            : 'other',
    contentChars: typeof content === 'string' ? content.length : null,
    isJsonObject,
    finishReason:
      typeof finishReason === 'string' && allowedFinishReasons.has(finishReason)
        ? finishReason
        : finishReason == null
          ? 'missing'
          : 'other'
  };
  if (options.expectedSchemaName === AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME) {
    summary.recipeReferencesValid =
      isJsonObject &&
      options.catalogRecipeAliases instanceof Set &&
      validMealRecipeReferences(parsedContent, options.catalogRecipeAliases);
  }
  return summary;
}

function redactBearerFromResponse(body, token) {
  let text = body.toString('utf8');
  const variants = new Set([token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)]);
  for (const variant of variants) {
    if (variant.length >= 8) {
      text = text.replaceAll(variant, '[redacted]');
    } else {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(
        new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'gu'),
        '[redacted]'
      );
    }
  }
  return Buffer.from(text, 'utf8');
}

function sendJson(response, status, message) {
  const body = Buffer.from(JSON.stringify({ error: message }), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': body.length,
    'cache-control': 'no-store'
  });
  response.end(body);
}

function collectRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (tooLarge) reject(new Error('request-too-large'));
      else resolve(Buffer.concat(chunks, bytes));
    });
    request.once('error', reject);
    request.once('aborted', () => reject(new Error('request-aborted')));
  });
}

function rejectLiveProxyRequest(response, state, status, message) {
  if (state.expectedSchemaName || state.requireReceiptAttachments) state.failed = true;
  if (state.expectedSchemaName) {
    state.metrics.failed = true;
    state.metrics.rejectedRequests += 1;
  }
  sendJson(response, status, message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return (
    isRecord(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function hasAllowedKeys(value, required, optional = []) {
  return (
    isRecord(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dateDifferenceInDays(from, to) {
  return (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;
}

function collectTextMessages(messages) {
  return messages
    .flatMap((message) => {
      if (typeof message?.content === 'string') return [message.content];
      if (!Array.isArray(message?.content)) return [];
      return message.content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text);
    })
    .join('\n')
    .toLowerCase();
}

function promptTermContract(messages, state) {
  const prompt = collectTextMessages(messages);
  const requiredPromptTermsPresent =
    state.requiredPromptTerms === undefined ||
    state.requiredPromptTerms.every((term) => prompt.includes(term));
  const forbiddenPromptTermsAbsent =
    state.forbiddenPromptTerms === undefined ||
    state.forbiddenPromptTerms.every((term) => !prompt.includes(term));
  return { requiredPromptTermsPresent, forbiddenPromptTermsAbsent };
}

function containsPrivateIdentityKey(value) {
  if (Array.isArray(value)) return value.some(containsPrivateIdentityKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    return (
      normalized.endsWith('id') ||
      [
        'email',
        'author',
        'authorname',
        'owner',
        'ownername',
        'realname',
        'householdname',
        'membername',
        'participantname',
        'username',
        'displayname'
      ].includes(normalized) ||
      containsPrivateIdentityKey(child)
    );
  });
}

function parseMealJsonAttachment(part, filename) {
  if (
    part?.type !== 'file' ||
    !hasExactKeys(part, ['type', 'file']) ||
    !hasExactKeys(part.file, ['filename', 'file_data']) ||
    part.file.filename !== filename ||
    !validBase64DataUri(part.file.file_data, 'data:application/json;base64,')
  ) {
    return undefined;
  }
  const encoded = part.file.file_data.slice('data:application/json;base64,'.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    return isRecord(value) ? { value, text } : undefined;
  } catch {
    return undefined;
  }
}

function validSelectableCatalogRecipe(recipe) {
  const steps = recipe.steps;
  if (Array.isArray(steps) && steps.length > 0) return true;
  const levels = recipe.instructionsByLevel;
  return (
    isRecord(levels) &&
    ['basic', 'intermediate', 'expert'].every(
      (level) => Array.isArray(levels[level]) && levels[level].length > 0
    )
  );
}

function validCatalogRecipeStep(step) {
  return (
    hasExactKeys(step, [
      'stepNumber',
      'instruction',
      'duration',
      'tips',
      'warning',
      'temperature',
      'timerRequired',
      'timerDuration',
      'illustration'
    ]) &&
    Number.isInteger(step.stepNumber) &&
    step.stepNumber > 0 &&
    typeof step.instruction === 'string' &&
    step.instruction.trim() !== '' &&
    (step.duration === null || Number.isFinite(step.duration)) &&
    (step.tips === null || typeof step.tips === 'string') &&
    (step.warning === null || typeof step.warning === 'string') &&
    (step.temperature === null || isRecord(step.temperature)) &&
    typeof step.timerRequired === 'boolean' &&
    (step.timerDuration === null || Number.isFinite(step.timerDuration)) &&
    step.illustration === null
  );
}

function validCatalogRecipe(recipe) {
  return (
    hasExactKeys(recipe, [
      'name',
      'description',
      'difficulty',
      'cuisine',
      'mealType',
      'totalTime',
      'prepTime',
      'cookTime',
      'restTime',
      'baseServings',
      'calories',
      'ingredients',
      'utensils',
      'guidance',
      'steps',
      'instructionsByLevel',
      'nutrition',
      'storage',
      'tags'
    ]) &&
    typeof recipe.name === 'string' &&
    recipe.name.trim() !== '' &&
    typeof recipe.description === 'string' &&
    (recipe.cuisine === null || typeof recipe.cuisine === 'string') &&
    Array.isArray(recipe.mealType) &&
    recipe.mealType.every((value) => typeof value === 'string') &&
    [recipe.totalTime, recipe.prepTime, recipe.cookTime, recipe.restTime].every(
      (value) => value === null || (Number.isFinite(value) && value >= 0)
    ) &&
    (recipe.baseServings === null ||
      (Number.isFinite(recipe.baseServings) && recipe.baseServings > 0)) &&
    (recipe.calories === null || (Number.isFinite(recipe.calories) && recipe.calories >= 0)) &&
    Array.isArray(recipe.ingredients) &&
    recipe.ingredients.every(
      (ingredient) =>
        hasExactKeys(ingredient, [
          'name',
          'quantity',
          'unit',
          'preparation',
          'isOptional',
          'substitutes',
          'notes'
        ]) &&
        typeof ingredient.name === 'string' &&
        (ingredient.quantity === null ||
          (Number.isFinite(ingredient.quantity) && ingredient.quantity > 0)) &&
        (ingredient.unit === null || typeof ingredient.unit === 'string') &&
        (ingredient.preparation === null || typeof ingredient.preparation === 'string') &&
        typeof ingredient.isOptional === 'boolean' &&
        Array.isArray(ingredient.substitutes) &&
        ingredient.substitutes.every((value) => typeof value === 'string') &&
        (ingredient.notes === null || typeof ingredient.notes === 'string')
    ) &&
    Array.isArray(recipe.utensils) &&
    recipe.utensils.every((value) => typeof value === 'string') &&
    (recipe.guidance === null || isRecord(recipe.guidance)) &&
    (recipe.steps === null ||
      (Array.isArray(recipe.steps) && recipe.steps.every(validCatalogRecipeStep))) &&
    (recipe.instructionsByLevel === null ||
      (hasExactKeys(recipe.instructionsByLevel, ['basic', 'intermediate', 'expert']) &&
        ['basic', 'intermediate', 'expert'].every(
          (level) =>
            Array.isArray(recipe.instructionsByLevel[level]) &&
            recipe.instructionsByLevel[level].every(validCatalogRecipeStep)
        ))) &&
    (recipe.nutrition === null || isRecord(recipe.nutrition)) &&
    (recipe.storage === null || isRecord(recipe.storage)) &&
    Array.isArray(recipe.tags) &&
    recipe.tags.every((value) => typeof value === 'string')
  );
}

function validMealRecipeCatalog(catalog) {
  if (
    !hasExactKeys(catalog, ['version', 'recipes']) ||
    catalog.version !== 1 ||
    !Array.isArray(catalog.recipes) ||
    catalog.recipes.length === 0
  ) {
    return undefined;
  }
  const selectableAliases = new Set();
  const aliases = new Set();
  for (const entry of catalog.recipes) {
    if (
      !hasExactKeys(entry, ['alias', 'selectable', 'recipe']) ||
      typeof entry.alias !== 'string' ||
      !/^R[1-9]\d{0,3}$/.test(entry.alias) ||
      aliases.has(entry.alias) ||
      typeof entry.selectable !== 'boolean' ||
      !isRecord(entry.recipe) ||
      !validCatalogRecipe(entry.recipe) ||
      containsPrivateIdentityKey(entry.recipe)
    ) {
      return undefined;
    }
    aliases.add(entry.alias);
    if (
      entry.selectable &&
      Number.isFinite(entry.recipe.baseServings) &&
      entry.recipe.baseServings > 0 &&
      entry.recipe.ingredients.length > 0 &&
      entry.recipe.ingredients.every(
        (ingredient) =>
          isRecord(ingredient) &&
          typeof ingredient.name === 'string' &&
          Number.isFinite(ingredient.quantity) &&
          ingredient.quantity > 0 &&
          typeof ingredient.unit === 'string' &&
          ingredient.unit.trim() !== ''
      ) &&
      validSelectableCatalogRecipe(entry.recipe)
    ) {
      selectableAliases.add(entry.alias);
    } else if (entry.selectable) {
      return undefined;
    }
  }
  return selectableAliases.size > 0 ? selectableAliases : undefined;
}

function validMealContextAttachment(messages) {
  const userMessages = messages.filter((message) => message?.role === 'user');
  if (userMessages.length !== 1 || !Array.isArray(userMessages[0]?.content)) return undefined;
  if (
    messages.some(
      (message) => typeof message?.content !== 'string' && !Array.isArray(message?.content)
    )
  ) {
    return undefined;
  }
  const allParts = messages.flatMap((message) =>
    Array.isArray(message?.content) ? message.content : []
  );
  const nonUserParts = messages
    .filter((message) => message?.role !== 'user' && Array.isArray(message?.content))
    .flatMap((message) => message.content);
  const attachments = allParts.filter(
    (part) => part?.type === 'file' || part?.type === 'image_url'
  );
  const parts = userMessages[0].content;
  if (
    attachments.length !== 2 ||
    attachments.some((part) => part?.type !== 'file' || !parts.includes(part)) ||
    nonUserParts.some((part) => part?.type !== 'text') ||
    parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').length === 0 ||
    parts.some((part) => part?.type !== 'text' && part?.type !== 'file')
  ) {
    return undefined;
  }
  const contextAttachment = attachments.find(
    (part) => part.file?.filename === AI_LIVE_HOUSEHOLD_MEAL_CONTEXT_FILENAME
  );
  const catalogAttachment = attachments.find(
    (part) => part.file?.filename === AI_LIVE_HOUSEHOLD_MEAL_RECIPE_CATALOG_FILENAME
  );
  if (!contextAttachment || !catalogAttachment) return undefined;
  const contextData = parseMealJsonAttachment(
    contextAttachment,
    AI_LIVE_HOUSEHOLD_MEAL_CONTEXT_FILENAME
  );
  const catalogData = parseMealJsonAttachment(
    catalogAttachment,
    AI_LIVE_HOUSEHOLD_MEAL_RECIPE_CATALOG_FILENAME
  );
  const selectableRecipeAliases = catalogData
    ? validMealRecipeCatalog(catalogData.value)
    : undefined;
  if (!contextData || !catalogData || !selectableRecipeAliases) return undefined;
  return {
    context: contextData.value,
    text: contextData.text,
    catalog: catalogData.value,
    catalogText: catalogData.text,
    selectableRecipeAliases
  };
}

function validEffectiveMemberProfiles(context) {
  if (
    !Array.isArray(context.participants) ||
    context.participants.length !== 2 ||
    !hasExactKeys(context.household, ['objective', 'schedule'])
  ) {
    return false;
  }
  const byAlias = new Map(context.participants.map((member) => [member?.alias, member]));
  if (byAlias.size !== 2 || !byAlias.has('P1') || !byAlias.has('P2')) return false;
  const expected = {
    P1: { likes: ['tofu'], dislikes: ['pollo'] },
    P2: { likes: ['pollo'], dislikes: ['tofu'] }
  };
  return ['P1', 'P2'].every((alias) => {
    const member = byAlias.get(alias);
    const preference = expected[alias];
    return (
      hasExactKeys(member, ['alias', 'preferences', 'effectiveObjective', 'effectiveSchedule']) &&
      hasExactKeys(member.preferences, ['strictAllergies', 'likes', 'dislikes']) &&
      Array.isArray(member.preferences.strictAllergies) &&
      member.preferences.strictAllergies.length === 0 &&
      JSON.stringify(member.preferences.likes) === JSON.stringify(preference.likes) &&
      JSON.stringify(member.preferences.dislikes) === JSON.stringify(preference.dislikes) &&
      hasExactKeys(member.effectiveObjective, ['source', 'goals', 'notes']) &&
      member.effectiveObjective.source === 'household' &&
      Array.isArray(member.effectiveObjective.goals) &&
      member.effectiveObjective.goals.includes('balanced') &&
      typeof member.effectiveObjective.notes === 'string' &&
      hasExactKeys(member.effectiveSchedule, ['source', 'mealTypes', 'mealTimes']) &&
      member.effectiveSchedule.source === 'household' &&
      isRecord(member.effectiveSchedule.mealTypes) &&
      member.effectiveSchedule.mealTypes.lunch === true &&
      isRecord(member.effectiveSchedule.mealTimes) &&
      typeof member.effectiveSchedule.mealTimes.lunch === 'string'
    );
  });
}

function validRequiredMealTurns(context) {
  const { startDate, endDate } = context.targetWeek ?? {};
  if (
    !isRecord(context.targetWeek) ||
    !hasExactKeys(context.targetWeek, ['startDate', 'endDate']) ||
    !isIsoDate(startDate) ||
    !isIsoDate(endDate) ||
    dateDifferenceInDays(startDate, endDate) !== 6 ||
    !Array.isArray(context.requiredTurns) ||
    context.requiredTurns.length !== 7
  ) {
    return false;
  }
  const expectedDates = new Set(
    Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${startDate}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    })
  );
  return (
    context.requiredTurns.every(
      (turn) =>
        hasExactKeys(turn, ['date', 'mealType', 'time', 'eligibleParticipants']) &&
        expectedDates.has(turn.date) &&
        turn.mealType === 'lunch' &&
        turn.time === '13:00' &&
        JSON.stringify(turn.eligibleParticipants) === JSON.stringify(['P1', 'P2'])
    ) && new Set(context.requiredTurns.map((turn) => turn.date)).size === 7
  );
}

function validPantryItem(item) {
  return (
    hasExactKeys(item, ['name', 'quantity', 'unit', 'expirationDate']) &&
    typeof item.name === 'string' &&
    Number.isFinite(item.quantity) &&
    item.quantity > 0 &&
    typeof item.unit === 'string' &&
    (item.expirationDate === null || isIsoDate(item.expirationDate))
  );
}

function validUtensil(item) {
  return (
    hasExactKeys(item, ['name', 'category']) &&
    typeof item.name === 'string' &&
    (item.category === null || typeof item.category === 'string')
  );
}

function validPreviousPlan(context) {
  const previous = context.previousConfirmedPlan;
  return (
    isRecord(context.targetWeek) &&
    isRecord(previous) &&
    hasExactKeys(previous, ['weekStart', 'weekEnd', 'events']) &&
    isIsoDate(previous.weekStart) &&
    isIsoDate(previous.weekEnd) &&
    dateDifferenceInDays(previous.weekStart, previous.weekEnd) === 6 &&
    previous.weekEnd < context.targetWeek.startDate &&
    Array.isArray(previous.events) &&
    previous.events.every(
      (event) =>
        hasExactKeys(event, [
          'date',
          'mealType',
          'time',
          'servings',
          'participants',
          'recipeName'
        ]) &&
        isIsoDate(event.date) &&
        typeof event.mealType === 'string' &&
        typeof event.time === 'string' &&
        Number.isFinite(event.servings) &&
        Array.isArray(event.participants) &&
        event.participants.every((alias) => alias === 'P1' || alias === 'P2') &&
        (event.recipeName === null || typeof event.recipeName === 'string')
    ) &&
    previous.events.some(
      (event) =>
        isRecord(event) &&
        event.recipeName === 'SMOKE_RECIPE_TEST' &&
        Array.isArray(event.participants) &&
        event.participants.includes('P1') &&
        event.participants.includes('P2')
    )
  );
}

function mealContextContract(messages, state) {
  const attachment = validMealContextAttachment(messages);
  if (!attachment) return undefined;
  const { context, text, catalog, catalogText, selectableRecipeAliases } = attachment;
  const topLevelValid =
    hasExactKeys(context, [
      'version',
      'targetWeek',
      'household',
      'participants',
      'requiredTurns',
      'pantry',
      'utensils',
      'previousConfirmedPlan'
    ]) &&
    context.version === 2 &&
    isRecord(context.household) &&
    (context.household.objective === null ||
      hasExactKeys(context.household.objective, ['goals', 'notes'])) &&
    (context.household.schedule === null ||
      hasExactKeys(context.household.schedule, ['mealTypes', 'mealTimes']));
  const memberProfilesValid = topLevelValid && validEffectiveMemberProfiles(context);
  const turnsValid = topLevelValid && validRequiredMealTurns(context);
  const planningInputsValid =
    topLevelValid &&
    turnsValid &&
    Array.isArray(context.pantry) &&
    context.pantry.every(validPantryItem) &&
    context.pantry.some((item) => item.name === 'SMOKE_PANTRY_RICE') &&
    Array.isArray(context.utensils) &&
    context.utensils.every(validUtensil) &&
    context.utensils.some((item) => item.name === 'SMOKE_UTENSIL_POT');
  const previousPlanValid = topLevelValid && validPreviousPlan(context);
  const forbiddenTerms = (state.forbiddenPromptTerms ?? []).map((term) => term.toLowerCase());
  const fullText = `${text}\n${catalogText}\n${collectTextMessages(messages)}`.toLowerCase();
  const forbiddenIdentityTermsAbsent =
    !containsPrivateIdentityKey(context) &&
    !containsPrivateIdentityKey(catalog) &&
    forbiddenTerms.every((term) => !fullText.includes(term));
  if (
    !topLevelValid ||
    !memberProfilesValid ||
    !planningInputsValid ||
    !previousPlanValid ||
    !forbiddenIdentityTermsAbsent
  ) {
    return undefined;
  }
  return {
    contextJsonAttachmentCount: 1,
    contextJsonAttachmentValid: true,
    recipeCatalogJsonAttachmentCount: 1,
    recipeCatalogJsonAttachmentValid: true,
    recipeCatalogAliasesValid: true,
    memberProfilesValid,
    planningInputsValid,
    previousPlanValid,
    forbiddenIdentityTermsAbsent,
    selectableRecipeAliases
  };
}

function validatePromptTermList(value, name) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 16 ||
    value.some((term) => typeof term !== 'string' || term.trim().length === 0 || term.length > 256)
  ) {
    throw new Error(`Live AI smoke ${name} are invalid.`);
  }
  return value.map((term) => term.toLowerCase());
}

async function handleProxyRequest(request, response, state) {
  state.metrics.requestAttempts += 1;
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (request.method !== 'POST' || path !== '/v1/chat/completions' || request.url !== path) {
    rejectLiveProxyRequest(response, state, 404, 'Live AI smoke route not found.');
    return;
  }
  if (request.headers.authorization !== `Bearer ${state.clientToken}`) {
    rejectLiveProxyRequest(response, state, 401, 'Live AI smoke authorization rejected.');
    return;
  }
  if (state.expectedSchemaName && state.failed) {
    rejectLiveProxyRequest(response, state, 409, 'Live AI smoke stopped after a rejected request.');
    return;
  }
  if (state.requireReceiptAttachments && state.failed) {
    sendJson(response, 409, 'Live receipt smoke stopped after an earlier request failure.');
    return;
  }
  if (state.requireReceiptAttachments && state.upstreamRequests.size > 0) {
    state.failed = true;
    sendJson(response, 409, 'Live receipt smoke allows only one provider request at a time.');
    return;
  }
  if (!String(request.headers['content-type'] ?? '').includes('application/json')) {
    rejectLiveProxyRequest(response, state, 415, 'Live AI smoke accepts JSON requests only.');
    return;
  }

  let body;
  try {
    body = await collectRequestBody(request, state.maxRequestBytes);
  } catch (error) {
    if (!response.destroyed && !response.headersSent) {
      rejectLiveProxyRequest(
        response,
        state,
        error instanceof Error && error.message === 'request-too-large' ? 413 : 400,
        'Live AI smoke request rejected.'
      );
    }
    return;
  }
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    rejectLiveProxyRequest(response, state, 400, 'Live AI smoke request is malformed.');
    return;
  }
  if (
    payload?.model !== state.model ||
    !Array.isArray(payload.messages) ||
    payload.messages.length === 0
  ) {
    rejectLiveProxyRequest(
      response,
      state,
      400,
      'Live AI smoke request is outside its model/fixture contract.'
    );
    return;
  }
  if (!validStrictResponseFormat(payload.response_format)) {
    rejectLiveProxyRequest(
      response,
      state,
      400,
      'Live AI smoke requires a strict JSON Schema response format.'
    );
    return;
  }
  const requestStream = payload.stream === true;
  const requestSchemaName = payload.response_format.json_schema.name;
  if (
    state.requireReceiptAttachments &&
    (requestSchemaName !== 'receipt' || !hasExactReceiptAttachments(payload.messages))
  ) {
    rejectLiveProxyRequest(
      response,
      state,
      400,
      'Live receipt smoke requires one ticket and the inventory JSON file.'
    );
    return;
  }
  const eventsSchema = payload.response_format.json_schema.schema?.properties?.events;
  const nonEmptyEventsSchemaValid =
    requestSchemaName !== AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME ||
    (eventsSchema?.type === 'array' &&
      Number.isInteger(eventsSchema.minItems) &&
      eventsSchema.minItems >= 1);
  const mealRecipeAliasSchemaValid =
    requestSchemaName !== AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME ||
    validMealRecipeAliasSchema(payload.response_format.json_schema.schema);
  const contextContract =
    state.expectedSchemaName === AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME
      ? mealContextContract(payload.messages, state)
      : undefined;
  if (
    state.expectedSchemaName &&
    (requestSchemaName !== state.expectedSchemaName ||
      !nonEmptyEventsSchemaValid ||
      !mealRecipeAliasSchemaValid ||
      !contextContract)
  ) {
    rejectLiveProxyRequest(
      response,
      state,
      400,
      'Live meal smoke requires its expected schema and verified JSON context attachment.'
    );
    return;
  }
  const promptContract =
    state.requiredPromptTerms || state.forbiddenPromptTerms
      ? promptTermContract(payload.messages, state)
      : { requiredPromptTermsPresent: true, forbiddenPromptTermsAbsent: true };
  if (!promptContract.requiredPromptTermsPresent || !promptContract.forbiddenPromptTermsAbsent) {
    rejectLiveProxyRequest(
      response,
      state,
      400,
      'Live household meal prompt is outside its synthetic profile contract.'
    );
    return;
  }
  const selectableRecipeAliases = contextContract?.selectableRecipeAliases;
  const safeContextContract = contextContract
    ? Object.fromEntries(
        Object.entries(contextContract).filter(([key]) => key !== 'selectableRecipeAliases')
      )
    : undefined;
  const verifiedContextContract = contextContract
    ? { ...safeContextContract, nonEmptyEventsSchemaValid, mealRecipeAliasSchemaValid }
    : undefined;
  const expectedStreaming = !state.fallbackPending;
  if (state.requireReceiptAttachments && requestStream !== expectedStreaming) {
    rejectLiveProxyRequest(
      response,
      state,
      409,
      state.fallbackPending
        ? 'Live receipt fallback must be non-streaming after HTTP 400.'
        : 'Live receipt requests must stream before an HTTP 400 fallback.'
    );
    return;
  }
  if (state.acceptedCalls >= state.maxCalls) {
    rejectLiveProxyRequest(response, state, 429, 'Live AI smoke completion budget exhausted.');
    return;
  }
  state.acceptedCalls += 1;
  notifySafeProgress(state.onRequest, { ordinal: state.acceptedCalls });

  const startedAt = Date.now();
  let settled = false;
  let upstream;
  const completeMetrics = (status, usage = null, responseFormat = null) => {
    if (settled) return;
    settled = true;
    if (upstream) state.upstreamRequests.delete(upstream);
    const ordinal = state.metrics.calls.length + 1;
    const elapsedMs = Date.now() - startedAt;
    if (state.requireReceiptAttachments) {
      if (status >= 200 && status < 300) state.fallbackPending = false;
      else if (status === 400 && requestStream) state.fallbackPending = true;
      else state.failed = true;
    }
    if (state.expectedSchemaName && (status < 200 || status >= 300)) {
      state.failed = true;
      state.metrics.failed = true;
    }
    state.metrics.calls.push({
      model: state.model,
      status,
      stream: requestStream,
      schemaName: requestSchemaName,
      requestContract: {
        strictJsonSchema: true,
        ...(state.requireReceiptAttachments
          ? { inventoryJsonAttachmentCount: 1, receiptAttachmentCount: 1 }
          : {}),
        ...(verifiedContextContract ?? {}),
        ...(state.requiredPromptTerms
          ? { requiredPromptTermsPresent: promptContract.requiredPromptTermsPresent }
          : {}),
        ...(state.forbiddenPromptTerms
          ? { forbiddenPromptTermsAbsent: promptContract.forbiddenPromptTermsAbsent }
          : {})
      },
      elapsedMs,
      usage,
      responseFormat
    });
    notifySafeProgress(state.onCompletion, { ordinal, status, elapsedMs, responseFormat });
  };
  const upstreamPath = '/v1/chat/completions';
  upstream = httpRequest(
    {
      hostname: state.target.hostname,
      port: Number(state.target.port),
      method: 'POST',
      path: upstreamPath,
      headers: {
        accept: String(request.headers.accept ?? 'application/json, text/event-stream'),
        authorization: `Bearer ${state.token}`,
        'content-type': 'application/json',
        'content-length': body.length,
        connection: 'close'
      },
      agent: false,
      timeout: state.timeoutMs
    },
    async (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502;
      const contentType = String(upstreamResponse.headers['content-type'] ?? '').toLowerCase();
      if (status < 200 || status >= 300) {
        upstreamResponse.resume();
        completeMetrics(status);
        sendJson(
          response,
          status >= 300 && status < 400 ? 502 : status,
          'Local AI provider returned a non-success status.'
        );
        return;
      }
      if (!contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
        upstreamResponse.resume();
        completeMetrics(502);
        sendJson(response, 502, 'Local AI provider returned an unsupported response type.');
        return;
      }

      const chunks = [];
      let byteLength = 0;
      try {
        for await (const chunk of upstreamResponse) {
          byteLength += chunk.length;
          if (byteLength > state.maxResponseBytes) throw new Error('response-too-large');
          chunks.push(chunk);
        }
      } catch {
        completeMetrics(502);
        sendJson(response, 502, 'Local AI provider response exceeded the smoke limit.');
        return;
      }
      const rawBody = Buffer.concat(chunks, byteLength);
      const usage = responseUsage(contentType, rawBody);
      const responseFormat = responseFormatSummary(contentType, rawBody, {
        expectedSchemaName: requestSchemaName,
        catalogRecipeAliases: selectableRecipeAliases
      });
      if (
        state.expectedSchemaName === AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME &&
        responseFormat?.recipeReferencesValid !== true
      ) {
        state.failed = true;
        state.metrics.failed = true;
      }
      const safeProviderBody = redactBearerFromResponse(rawBody, state.token);
      const safeBody = redactBearerFromResponse(safeProviderBody, state.clientToken);
      completeMetrics(status, usage, responseFormat);
      response.writeHead(status, {
        'content-type': contentType,
        'content-length': safeBody.length,
        'cache-control': 'no-store'
      });
      response.end(safeBody);
    }
  );
  state.upstreamRequests.add(upstream);
  request.once('aborted', () => upstream.destroy(new Error('client-aborted')));
  response.once('close', () => {
    if (!response.writableEnded) upstream.destroy(new Error('client-response-closed'));
  });
  upstream.once('timeout', () => upstream.destroy(new Error('upstream-timeout')));
  upstream.once('error', () => {
    completeMetrics(502);
    if (!response.destroyed && !response.headersSent) {
      sendJson(response, 502, 'Local AI provider is unavailable.');
    }
  });
  upstream.end(body);
}

export async function createAiLiveProxy({
  token,
  clientToken = randomUUID(),
  model,
  targetOrigin = WEB_API_ORIGIN,
  maxCalls = AI_LIVE_SMOKE_COMPLETION_BUDGET,
  timeoutMs = 120_000,
  maxRequestBytes = 6 * 1024 * 1024,
  maxResponseBytes = 4 * 1024 * 1024,
  requireReceiptAttachments = false,
  expectedSchemaName,
  requiredPromptTerms,
  forbiddenPromptTerms,
  onRequest,
  onCompletion
}) {
  if (typeof token !== 'string' || token.length < 16) {
    throw new Error('Live AI smoke bearer is missing or malformed.');
  }
  if (typeof clientToken !== 'string' || clientToken.length < 16 || clientToken === token) {
    throw new Error('Live AI smoke local proxy credential is missing or malformed.');
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('Live AI smoke model is missing.');
  }
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > AI_LIVE_SMOKE_COMPLETION_BUDGET) {
    throw new Error('Live AI smoke completion budget exceeds its hard cap.');
  }
  if (
    expectedSchemaName !== undefined &&
    (typeof expectedSchemaName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(expectedSchemaName))
  ) {
    throw new Error('Live AI smoke expected schema name is invalid.');
  }
  if (expectedSchemaName && requireReceiptAttachments) {
    throw new Error('Live AI smoke cannot combine a meal schema with receipt-only mode.');
  }
  if (
    (requiredPromptTerms !== undefined || forbiddenPromptTerms !== undefined) &&
    !expectedSchemaName
  ) {
    throw new Error('Live AI smoke prompt markers require an expected JSON Schema.');
  }
  const validatedRequiredPromptTerms = validatePromptTermList(
    requiredPromptTerms,
    'required prompt markers'
  );
  const validatedForbiddenPromptTerms = validatePromptTermList(
    forbiddenPromptTerms,
    'forbidden prompt markers'
  );
  const target = validateLoopbackOrigin(targetOrigin);
  const state = {
    token,
    clientToken,
    model,
    target,
    maxCalls,
    acceptedCalls: 0,
    failed: false,
    fallbackPending: false,
    timeoutMs,
    maxRequestBytes,
    maxResponseBytes,
    requireReceiptAttachments,
    expectedSchemaName,
    requiredPromptTerms: validatedRequiredPromptTerms,
    forbiddenPromptTerms: validatedForbiddenPromptTerms,
    onRequest,
    onCompletion,
    upstreamRequests: new Set(),
    metrics: { calls: [], requestAttempts: 0, rejectedRequests: 0, failed: false }
  };
  let closePromise;
  const server = createServer((request, response) => {
    void handleProxyRequest(request, response, state).catch(() => {
      if (!response.destroyed && !response.headersSent) {
        sendJson(response, 502, 'Live AI smoke proxy failed.');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Live AI smoke proxy could not bind a loopback port.');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    port: address.port,
    clientToken,
    metrics: state.metrics,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const upstream of state.upstreamRequests) {
          upstream.destroy(new Error('proxy-closed'));
        }
        server.closeAllConnections();
      });
      return closePromise;
    }
  };
}

function notifySafeProgress(callback, event) {
  if (typeof callback !== 'function') return;
  try {
    callback(Object.freeze(event));
  } catch {
    // Progress output is diagnostic only and cannot change proxy behavior.
  }
}
