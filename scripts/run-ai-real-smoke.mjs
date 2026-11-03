import {
  aiLiveWebApiProviderLabel,
  AI_LIVE_RECEIPT_SMOKE_REQUEST_BUDGET,
  AI_LIVE_RECEIPT_SMOKE_MAX_REQUEST_BYTES,
  AI_LIVE_RECEIPT_SMOKE_TICKET_COUNT,
  AI_LIVE_ASSISTANT_SCHEMA_NAME,
  AI_LIVE_ASSISTANT_SMOKE_COMPLETION_BUDGET,
  AI_LIVE_HOUSEHOLD_PLAN_SCHEMA_NAME,
  AI_LIVE_HOUSEHOLD_PLAN_SMOKE_COMPLETION_BUDGET,
  AI_LIVE_SMOKE_ENV,
  AI_LIVE_SMOKE_COMPLETION_BUDGET,
  AI_LIVE_RECIPE_SMOKE_COMPLETION_BUDGET,
  AI_LIVE_RECIPE_SCHEMA_NAME,
  createAiLiveSmokeRunnerEnvironment,
  createAiLiveProxy,
  isSuccessfulAiLiveSmokeResult,
  validateAiLiveReceiptSmokeRequest,
  validateAiLiveConnectionSmokeRequest,
  validateAiLiveWorkflowSmokeRequest,
  validateAiLiveHouseholdPlanSmokeRequest,
  validateAiLiveAssistantSmokeRequest,
  validateAiLiveRecipeSmokeRequest,
  validateAiLiveSmokeOptIn
} from './ai-live-smoke-safety.mjs';
import {
  AI_LIVE_RECEIPT_LONG_TICKET_ONLY_COMPLETION_BUDGET,
  AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION,
  AI_LIVE_RECEIPT_LONG_TICKET_ONLY_TICKET_COUNT,
  AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_COMPLETION_BUDGET,
  AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION,
  AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_TICKET_COUNT
} from './ai-live-receipt-inputs.mjs';
import { prepareExistingAiLiveSmokeSession } from './ai-live-existing-webapi.mjs';
import { runAiLiveSmokeRunner } from './ai-live-smoke-runner-control.mjs';
import {
  AI_LIVE_SMOKE_DEADLINES,
  AI_LIVE_WORKFLOWS_SMOKE_COMPLETION_BUDGET,
  AI_LIVE_WORKFLOWS_SMOKE_SCHEMA_NAMES,
  assertAiLiveSmokeDeadlineContract
} from './ai-live-smoke-contract.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function safeMetrics(calls) {
  const aggregate = {};
  for (const field of ['promptTokens', 'completionTokens', 'totalTokens']) {
    const values = calls.map((call) => call.usage?.[field]);
    if (values.every((value) => Number.isInteger(value) && value >= 0)) {
      aggregate[field] = values.reduce((sum, value) => sum + value, 0);
    }
  }
  const costs = calls.map((call) => call.usage?.costUsd);
  if (costs.every((value) => Number.isFinite(value) && value >= 0)) {
    aggregate.costUsd = costs.reduce((sum, value) => sum + value, 0);
  }
  return Object.keys(aggregate).length ? aggregate : undefined;
}

const defaultDependencies = {
  prepareExistingAiLiveSmokeSession,
  createAiLiveProxy,
  createAiLiveSmokeRunnerEnvironment,
  runAiLiveSmokeRunner,
  isSuccessfulAiLiveSmokeResult
};

const SAFE_PROVIDER_ERROR_TYPES = new Set([
  'api_error',
  'invalid_request_error',
  'authentication_error',
  'permission_error',
  'rate_limit_error',
  'server_error',
  'insufficient_quota'
]);
const SAFE_PROVIDER_ERROR_CODES = new Set([
  'unsupported_parameter',
  'unsupported_value',
  'invalid_value',
  'invalid_type',
  'invalid_json_schema',
  'json_schema_validation_error',
  'model_not_found',
  'context_length_exceeded',
  'insufficient_quota',
  'rate_limit_exceeded',
  'invalid_api_key',
  'invalid_prompt',
  'responses_not_supported',
  'responses_endpoint_not_supported',
  'background_not_supported',
  'responses_input_unsupported',
  'bad_request',
  'idempotency_conflict',
  'idempotency_key_invalid',
  'internal_error',
  'payload_too_large',
  'response_cancelled',
  'response_not_cancellable',
  'response_not_found',
  'response_store_unavailable',
  'responses_attachment_reference_unsupported',
  'responses_text_format_required',
  'responses_background_required',
  'responses_field_unsupported',
  'responses_runtime_unavailable',
  'responses_storage_unavailable',
  'responses_tool_choice_unsupported',
  'responses_tools_unsupported',
  'responses_store_required',
  'responses_streaming_unsupported',
  'responses_unexpected_tool_output'
]);
const SAFE_PROVIDER_ERROR_PARAMS = new Set([
  'model',
  'temperature',
  'top_p',
  'max_output_tokens',
  'input',
  'input_image',
  'input_file',
  'text.format',
  'text.format.type',
  'background',
  'store',
  'reasoning.effort'
]);
const SAFE_PROVIDER_ERROR_ENVELOPES = Object.freeze({
  contentTypes: new Set(['json', 'text', 'other', 'missing']),
  bodyFormats: new Set(['json', 'invalid-json', 'opaque', 'empty', 'oversized', 'read-failed']),
  shapes: new Set(['object', 'string', 'missing', 'scalar', 'unknown']),
  fields: new Set(['type', 'code', 'param', 'message', 'error', 'success', 'status'])
});

function safeProviderErrorSummary(providerError) {
  if (!providerError || typeof providerError !== 'object') return '';
  const fields = [
    SAFE_PROVIDER_ERROR_TYPES.has(providerError.type) ? providerError.type : null,
    SAFE_PROVIDER_ERROR_CODES.has(providerError.code) ? providerError.code : null,
    SAFE_PROVIDER_ERROR_PARAMS.has(providerError.param) ? `param=${providerError.param}` : null
  ].filter(Boolean);
  return fields.join('/');
}

function safeProviderErrorEnvelopeSummary(envelope) {
  if (!envelope || typeof envelope !== 'object') return '';
  const contentType = SAFE_PROVIDER_ERROR_ENVELOPES.contentTypes.has(envelope.contentType)
    ? envelope.contentType
    : 'unknown';
  const bodyFormat = SAFE_PROVIDER_ERROR_ENVELOPES.bodyFormats.has(envelope.bodyFormat)
    ? envelope.bodyFormat
    : 'unknown';
  const shape = SAFE_PROVIDER_ERROR_ENVELOPES.shapes.has(envelope.errorShape)
    ? envelope.errorShape
    : 'unknown';
  const knownFields = Array.isArray(envelope.knownFields)
    ? [...new Set(envelope.knownFields.filter((field) => SAFE_PROVIDER_ERROR_ENVELOPES.fields.has(field)))].sort()
    : [];
  return `upstream=${contentType}/${bodyFormat}/${shape}${knownFields.length ? `[${knownFields.join(',')}]` : ''}`;
}

export async function runAiLiveSmoke({
  env = process.env,
  signal,
  dependencies = defaultDependencies,
  writeError = (message) => console.error(message),
  writeProgress = (message) => console.log(message),
  writeSuccess = (message) => console.log(message)
} = {}) {
  validateAiLiveSmokeOptIn(env);
  const receiptsOnly = validateAiLiveReceiptSmokeRequest(env);
  const recipeOnly = validateAiLiveRecipeSmokeRequest(env);
  const assistantOnly = validateAiLiveAssistantSmokeRequest(env);
  const connectionOnly = validateAiLiveConnectionSmokeRequest(env);
  const workflowsOnly = validateAiLiveWorkflowSmokeRequest(env);
  const householdPlanOnly = validateAiLiveHouseholdPlanSmokeRequest(env);
  const longTicketOnly =
    env[AI_LIVE_SMOKE_ENV.receiptSelection] === AI_LIVE_RECEIPT_LONG_TICKET_ONLY_SELECTION;
  const preferredJpegOnly =
    env[AI_LIVE_SMOKE_ENV.receiptSelection] === AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_SELECTION;
  const expectedReceiptTicketCount = receiptsOnly
    ? longTicketOnly
      ? AI_LIVE_RECEIPT_LONG_TICKET_ONLY_TICKET_COUNT
      : preferredJpegOnly
        ? AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_TICKET_COUNT
        : AI_LIVE_RECEIPT_SMOKE_TICKET_COUNT
    : undefined;
  let requestBudget = AI_LIVE_SMOKE_COMPLETION_BUDGET;
  if (connectionOnly) requestBudget = 1;
  else if (householdPlanOnly) requestBudget = AI_LIVE_HOUSEHOLD_PLAN_SMOKE_COMPLETION_BUDGET;
  else if (workflowsOnly) requestBudget = AI_LIVE_WORKFLOWS_SMOKE_COMPLETION_BUDGET;
  else if (assistantOnly) requestBudget = AI_LIVE_ASSISTANT_SMOKE_COMPLETION_BUDGET;
  else if (receiptsOnly) {
    requestBudget = longTicketOnly
      ? AI_LIVE_RECEIPT_LONG_TICKET_ONLY_COMPLETION_BUDGET
      : preferredJpegOnly
        ? AI_LIVE_RECEIPT_PREFERRED_JPEG_ONLY_COMPLETION_BUDGET
        : AI_LIVE_RECEIPT_SMOKE_REQUEST_BUDGET;
  } else if (recipeOnly) requestBudget = AI_LIVE_RECIPE_SMOKE_COMPLETION_BUDGET;
  assertAiLiveSmokeDeadlineContract();
  signal?.throwIfAborted();

  let session;
  let proxy;
  let runnerExit = { code: 1, timedOut: false };
  let cleanupFailed = false;
  try {
    writeProgress('Validando el servicio IA local y sus controles de privacidad.');
    session = await dependencies.prepareExistingAiLiveSmokeSession({ env, signal });
    signal?.throwIfAborted();
    writeProgress('Servicio IA local validado; preparando la prueba aislada.');
    proxy = await dependencies.createAiLiveProxy({
      token: session.token,
      model: session.model,
      targetOrigin: session.origin,
      maxCalls: requestBudget,
      requireReceiptAttachments: receiptsOnly,
      ...(recipeOnly ? { expectedSchemaName: AI_LIVE_RECIPE_SCHEMA_NAME } : {}),
      ...(assistantOnly ? { expectedSchemaName: AI_LIVE_ASSISTANT_SCHEMA_NAME } : {}),
      ...(householdPlanOnly ? { expectedSchemaName: AI_LIVE_HOUSEHOLD_PLAN_SCHEMA_NAME } : {}),
      ...(receiptsOnly ? { maxRequestBytes: AI_LIVE_RECEIPT_SMOKE_MAX_REQUEST_BYTES } : {}),
      timeoutMs: AI_LIVE_SMOKE_DEADLINES.proxyMs,
      onRequest: ({ ordinal }) => {
        if (Number.isInteger(ordinal) && ordinal > 0 && ordinal <= requestBudget) {
          writeProgress(`Solicitud IA ${ordinal}/${requestBudget} enviada al servicio local.`);
        }
      },
      onCompletion: ({ ordinal, status, responseFormat, providerError, providerErrorEnvelope }) => {
        if (
          Number.isInteger(ordinal) &&
          ordinal > 0 &&
          ordinal <= requestBudget &&
          Number.isInteger(status)
        ) {
          const responseShape =
            responseFormat?.messageContentType === 'text'
              ? responseFormat.isJsonObject === true
                ? 'texto JSON'
                : 'texto no JSON'
              : responseFormat?.messageContentType === 'stream'
                ? 'stream'
                : responseFormat?.messageContentType === 'parts'
                  ? 'partes estructuradas'
                  : 'formato no disponible';
          const safeFinishReasons = new Set([
            'stop',
            'length',
            'tool_calls',
            'function_call',
            'content_filter'
          ]);
          const finishReason = safeFinishReasons.has(responseFormat?.finishReason)
            ? responseFormat.finishReason
            : 'no disponible';
          const providerErrorDetails = safeProviderErrorSummary(providerError);
          const errorEnvelopeDetails = safeProviderErrorEnvelopeSummary(providerErrorEnvelope);
          const diagnosticDetails = [providerErrorDetails, errorEnvelopeDetails]
            .filter(Boolean)
            .join('; ');
          writeProgress(
            `Respuesta IA ${ordinal}/${requestBudget} completada (HTTP ${status}; ${diagnosticDetails ? `${diagnosticDetails}; ` : ''}${responseShape}; cierre ${finishReason}).`
          );
        }
      }
    });

    const runnerEnv = dependencies.createAiLiveSmokeRunnerEnvironment(env, {
      proxyToken: proxy.clientToken,
      proxyUrl: proxy.baseUrl,
      model: session.model,
      deadlines: AI_LIVE_SMOKE_DEADLINES,
      recipeOnly,
      assistantOnly,
      connectionOnly,
      workflowsOnly,
      householdPlanOnly
    });
    writeProgress('Iniciando los escenarios contra la aplicación aislada.');
    runnerExit = await dependencies.runAiLiveSmokeRunner({
      env: runnerEnv,
      signal,
      onProgress: writeProgress
    });
    writeProgress('Escenarios aislados terminados; verificando limpieza.');
  } catch {
    runnerExit = { code: 1, cancelled: signal?.aborted === true, timedOut: false };
    writeProgress('La preparación o ejecución no terminó correctamente; limpiando recursos.');
  } finally {
    if (proxy) {
      try {
        await proxy.close();
      } catch {
        cleanupFailed = true;
      }
    }
    if (session) {
      try {
        await session.cleanup();
      } catch {
        cleanupFailed = true;
      }
    }
  }

  const calls = proxy?.metrics.calls ?? [];
  const liveSuccess = dependencies.isSuccessfulAiLiveSmokeResult({
    runnerExit,
    cleanupFailed,
    calls,
    receiptsOnly,
    expectedReceiptTicketCount,
    recipeOnly,
    assistantOnly,
    connectionOnly,
    workflowsOnly,
    householdPlanOnly,
    proxyMetrics: proxy?.metrics
  });
  if (!liveSuccess) {
    writeError(
      cleanupFailed
        ? 'Smoke real fallido: no se pudo confirmar la limpieza del token propio.'
        : runnerExit.cancelled
          ? 'Smoke real cancelado; se intentó cerrar el runner y limpiar los recursos propios.'
          : runnerExit.timedOut
            ? 'Smoke real fallido: se agotó el límite de tiempo; se intentó cerrar y limpiar.'
          : `Smoke real fallido: resultado del runner=${runnerExit.code}, peticiones=${calls.length}/${requestBudget} (mínimo permitido ${assistantOnly ? AI_LIVE_ASSISTANT_SMOKE_COMPLETION_BUDGET : workflowsOnly ? AI_LIVE_WORKFLOWS_SMOKE_COMPLETION_BUDGET : recipeOnly || connectionOnly || householdPlanOnly ? 1 : (expectedReceiptTicketCount ?? 9)}).`
    );
    return 1;
  }

  const usage = safeMetrics(calls);
  const provider = aiLiveWebApiProviderLabel(session.origin);
  if (connectionOnly) {
    const call = calls[0];
    writeSuccess(
      JSON.stringify({
        result: 'passed',
        provider,
        model: session.model,
        connectionTests: 1,
        transport: call.providerTransport,
        httpStatus: call.status,
        elapsedMs: call.elapsedMs,
        ...(usage ? { usage } : {})
      })
    );
    return 0;
  }
  if (householdPlanOnly) {
    writeSuccess(
      JSON.stringify({
        result: 'passed',
        provider,
        model: session.model,
        completions: calls.length,
        verifiedHouseholdPlanStrictSchema: true,
        verifiedNoConfirmedPlanMutation: true,
        elapsedMs: calls[0].elapsedMs,
        ...(usage ? { usage } : {})
      })
    );
    return 0;
  }
  if (workflowsOnly) {
    const schemas = calls.map((call) => call.schemaName);
    writeSuccess(
      JSON.stringify({
        result: 'passed',
        provider,
        model: session.model,
        completions: calls.length,
        verifiedBackgroundRecipeImprovement: schemas.includes(AI_LIVE_WORKFLOWS_SMOKE_SCHEMA_NAMES[0]),
        verifiedBackgroundMealReplacement: schemas.includes(AI_LIVE_WORKFLOWS_SMOKE_SCHEMA_NAMES[1]),
        verifiedRealCommonsImageSearch: true,
        elapsedMs: calls.reduce((sum, call) => sum + (call.elapsedMs ?? 0), 0),
        ...(usage ? { usage } : {})
      })
    );
    return 0;
  }
  if (recipeOnly) {
    const call = calls[0];
    writeSuccess(
      JSON.stringify({
        result: 'passed',
        provider,
        model: session.model,
        completions: 1,
        verifiedStrictJsonSchema: true,
        verifiedUnboundedRecipeText: true,
        verifiedValidatedJsonResponse: true,
        elapsedMs: call.elapsedMs,
        ...(usage ? { usage } : {})
      })
    );
    return 0;
  }
  if (assistantOnly) {
    writeSuccess(
      JSON.stringify({
        result: 'passed',
        provider,
        model: session.model,
        proposals: calls.length,
        verifiedStrictJsonSchemaRequests: calls.filter(
          (call) => call.requestContract?.strictJsonSchema === true
        ).length,
        verifiedAssistantActionPlanResponses: calls.filter(
          (call) =>
            call.schemaName === AI_LIVE_ASSISTANT_SCHEMA_NAME &&
            call.responseFormat?.isJsonObject === true &&
            call.responseFormat.finishReason === 'stop'
        ).length,
        elapsedMs: calls.reduce((sum, call) => sum + (call.elapsedMs ?? 0), 0),
        ...(usage ? { usage } : {})
      })
    );
    return 0;
  }
  if (receiptsOnly) {
    writeSuccess(
      JSON.stringify({
        result: 'passed',
        provider,
        model: session.model,
        sourceCount: 6,
        tickets: expectedReceiptTicketCount,
        requests: calls.length,
        completions: calls.filter((call) => call.status >= 200 && call.status < 300).length,
        verifiedStrictSchemaRequests: calls.filter(
          (call) => call.requestContract?.strictJsonSchema === true
        ).length,
        verifiedInventoryJsonAttachments: calls.filter(
          (call) => call.requestContract?.inventoryJsonAttachmentCount === 1
        ).length,
        verifiedReceiptAttachments: calls.filter(
          (call) => call.requestContract?.receiptAttachmentCount === 1
        ).length,
        elapsedMs: calls.reduce((sum, call) => sum + (call.elapsedMs ?? 0), 0),
        recoveredFallbacks: calls.filter(
          (call, index) =>
            call.status === 400 &&
            call.stream === true &&
            call.schemaName === 'receipt' &&
            calls[index + 1]?.status >= 200 &&
            calls[index + 1]?.status < 300
        ).length,
        ...(usage ? { usage } : {})
      })
    );
    return 0;
  }

  const failedReceiptStreamIndex = calls.findIndex(
    (call) => call.status === 400 && call.stream === true && call.schemaName === 'receipt'
  );
  const receiptFallback =
    failedReceiptStreamIndex >= 0
      ? {
          schema: 'receipt',
          streamingStatus: calls[failedReceiptStreamIndex].status,
          nonStreamingStatus: calls[failedReceiptStreamIndex + 1]?.status ?? null
        }
      : undefined;
  writeSuccess(
    JSON.stringify({
      result: 'passed',
      provider,
      model: session.model,
      completions: calls.length,
      elapsedMs: calls.map((call) => call.elapsedMs),
      ...(receiptFallback ? { recoveredFallback: receiptFallback } : {}),
      ...(usage ? { usage } : {})
    })
  );
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    process.exitCode = await runAiLiveSmoke({ env: process.env, signal: cancellation.signal });
  } catch {
    console.error('Smoke real no ejecutado o fallido.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
