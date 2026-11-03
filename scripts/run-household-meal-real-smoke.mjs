import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { prepareExistingAiLiveSmokeSession } from './ai-live-existing-webapi.mjs';
import { runAiLiveSmokeRunner } from './ai-live-smoke-runner-control.mjs';
import {
  aiLiveWebApiProviderLabel,
  AI_LIVE_HOUSEHOLD_MEAL_SMOKE_COMPLETION_BUDGET,
  AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME,
  AI_LIVE_HOUSEHOLD_MEAL_PROMPT_CONTRACT,
  AI_LIVE_SMOKE_ENV,
  createAiLiveProxy,
  createAiLiveSmokeRunnerEnvironment,
  isSuccessfulAiLiveHouseholdMealSmokeResult,
  validateAiLiveHouseholdMealSmokeRequest,
  validateAiLiveSmokeOptIn
} from './ai-live-smoke-safety.mjs';
import {
  AI_LIVE_SMOKE_DEADLINES,
  assertAiLiveSmokeDeadlineContract
} from './ai-live-smoke-contract.mjs';

const defaultDependencies = {
  prepareExistingAiLiveSmokeSession,
  createAiLiveProxy,
  createAiLiveSmokeRunnerEnvironment,
  runAiLiveSmokeRunner,
  isSuccessfulAiLiveHouseholdMealSmokeResult
};

function safeUsage(calls) {
  const call = calls[0]?.usage;
  if (!call) return undefined;
  const usage = {};
  for (const field of ['promptTokens', 'completionTokens', 'totalTokens', 'costUsd']) {
    if (Number.isSafeInteger(call[field]) && call[field] >= 0) usage[field] = call[field];
    else if (field === 'costUsd' && Number.isFinite(call[field]) && call[field] >= 0) {
      usage[field] = call[field];
    }
  }
  return Object.keys(usage).length ? usage : undefined;
}

function expectedMealOnlyEnvironment(env) {
  const existing = env[AI_LIVE_SMOKE_ENV.householdMealOnly];
  if (existing !== undefined && existing !== '1') {
    throw new Error('Household meal smoke requires the exact opt-in value.');
  }
  return { ...env, [AI_LIVE_SMOKE_ENV.householdMealOnly]: '1' };
}

export async function runHouseholdMealRealSmoke({
  env = process.env,
  signal,
  dependencies = defaultDependencies,
  writeError = (message) => console.error(message),
  writeProgress = (message) => console.log(message),
  writeSuccess = (message) => console.log(message)
} = {}) {
  validateAiLiveSmokeOptIn(env);
  validateAiLiveHouseholdMealSmokeRequest(expectedMealOnlyEnvironment(env));
  assertAiLiveSmokeDeadlineContract();
  signal?.throwIfAborted();

  let session;
  let proxy;
  let runnerExit = { code: 1, timedOut: false, cancelled: false, runnerCleaned: false };
  let cleanupFailed = false;
  let safeFailure = 'El smoke aislado de comidas no terminó correctamente.';

  try {
    writeProgress('Comprobando sesión, privacidad y modelo de WebAPI antes del smoke.');
    session = await dependencies.prepareExistingAiLiveSmokeSession({ env, signal });
    signal?.throwIfAborted();
    writeProgress('WebAPI validada; se permite una única propuesta de comidas.');
    proxy = await dependencies.createAiLiveProxy({
      token: session.token,
      model: session.model,
      targetOrigin: session.origin,
      maxCalls: AI_LIVE_HOUSEHOLD_MEAL_SMOKE_COMPLETION_BUDGET,
      expectedSchemaName: AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME,
      ...AI_LIVE_HOUSEHOLD_MEAL_PROMPT_CONTRACT,
      timeoutMs: AI_LIVE_SMOKE_DEADLINES.proxyMs,
      onRequest: () => writeProgress('Se envió la única propuesta de comidas al proveedor.'),
      onCompletion: ({ status, responseFormat }) => {
        const validJson = responseFormat?.isJsonObject === true;
        writeProgress(
          `El proveedor respondió a la propuesta (HTTP ${Number.isInteger(status) ? status : 'desconocido'}; JSON ${validJson ? 'válido' : 'no válido'}).`
        );
      }
    });

    const runnerEnv = dependencies.createAiLiveSmokeRunnerEnvironment(env, {
      proxyToken: proxy.clientToken,
      proxyUrl: proxy.baseUrl,
      model: session.model,
      deadlines: AI_LIVE_SMOKE_DEADLINES,
      householdMealOnly: true
    });
    writeProgress('Iniciando la E2E aislada, sin datos de tickets ni confirmación de calendario.');
    runnerExit = await dependencies.runAiLiveSmokeRunner({
      env: runnerEnv,
      signal,
      onProgress: writeProgress
    });
  } catch (error) {
    runnerExit = {
      code: 1,
      cancelled: signal?.aborted === true,
      timedOut: false,
      runnerCleaned: false
    };
    if (
      error instanceof Error &&
      error.message ===
        'The configured WebAPI provider session is not ready; complete sign-in first.'
    ) {
      safeFailure = 'WebAPI necesita que inicies sesión antes de enviar la propuesta de comidas.';
    }
    writeProgress('La preparación o E2E no terminó; cerrando recursos temporales propios.');
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
  const successful = dependencies.isSuccessfulAiLiveHouseholdMealSmokeResult({
    runnerExit,
    cleanupFailed,
    calls,
    proxyMetrics: proxy?.metrics
  });
  if (!successful) {
    if (cleanupFailed)
      safeFailure = 'No se pudo verificar la limpieza de los recursos propios del smoke.';
    else if (proxy?.metrics.rejectedRequests > 0 && calls.length === 0) {
      const safeRejectionCodes = new Set([
        'background_contract',
        'meal_context_contract',
        'meal_context_attachments',
        'meal_context_shape',
        'meal_context_member_shape',
        'meal_context_member_aliases',
        'meal_context_member_preferences_shape',
        'meal_context_member_strict_allergies',
        'meal_context_member_likes',
        'meal_context_member_dislikes',
        'meal_context_member_objectives',
        'meal_context_member_schedules',
        'meal_context_planning_inputs',
        'meal_context_previous_plan',
        'meal_context_identity_guard',
        'prompt_contract',
        'schema_contract'
      ]);
      const rejectionCodes = Array.isArray(proxy.metrics.rejectionCodes)
        ? [...new Set(proxy.metrics.rejectionCodes.filter((code) => safeRejectionCodes.has(code)))]
        : [];
      const reason = rejectionCodes.length > 0 ? `; causa=${rejectionCodes.join(',')}` : '';
      safeFailure = `El proxy local rechazó la petición antes de contactar WebAPI (${proxy.metrics.rejectedRequests} rechazo(s)${reason}); no se registró ninguna completion.`;
    } else if (calls.length || proxy?.metrics.requestAttempts) {
      const statuses = calls
        .map((call) => (Number.isInteger(call.status) ? call.status : 'sin estado'))
        .join(',');
      safeFailure = `Smoke no validado tras ${calls.length} completion(s) y ${proxy.metrics.requestAttempts} intento(s) (rechazos locales: ${proxy.metrics.rejectedRequests ?? 0}; HTTP: ${statuses || 'sin respuesta'}); no se reintentará automáticamente para evitar un coste duplicado.`;
    } else if (proxy?.metrics.requestAttempts === 0) {
      safeFailure =
        'La E2E aislada falló antes de contactar al proveedor; no se hizo ninguna llamada al modelo.';
    }
    writeError(safeFailure);
    return 1;
  }

  const usage = safeUsage(calls);
  const provider = aiLiveWebApiProviderLabel(session.origin);
  writeSuccess(
    JSON.stringify({
      result: 'passed',
      provider,
      model: session.model,
      scenario: 'household-meal-proposal',
      completions: AI_LIVE_HOUSEHOLD_MEAL_SMOKE_COMPLETION_BUDGET,
      verifiedStrictSchema: true,
      verifiedNonEmptyEventsSchema: true,
      verifiedMealContextJson: true,
      verifiedRecipeCatalogJson: true,
      verifiedRecipeAliases: true,
      verifiedMemberProfiles: true,
      verifiedSchedulesAndTurns: true,
      verifiedPantryAndUtensils: true,
      verifiedPreviousPlan: true,
      verifiedSyntheticNamesExcluded: true,
      elapsedMs: calls.map((call) => call.elapsedMs),
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
    if (process.argv.length > 2)
      throw new Error('This dedicated smoke command does not accept arguments.');
    process.exitCode = await runHouseholdMealRealSmoke({
      env: process.env,
      signal: cancellation.signal
    });
  } catch (error) {
    const message =
      error instanceof Error && /explicit opt-in|CI|receipt|opt-in value/i.test(error.message)
        ? error.message
        : 'Smoke real de comidas no ejecutado o fallido.';
    console.error(message);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
