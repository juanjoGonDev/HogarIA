import assert from 'node:assert/strict';
import test from 'node:test';

import { runHouseholdMealRealSmoke } from './run-household-meal-real-smoke.mjs';
import {
  AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME,
  AI_LIVE_HOUSEHOLD_MEAL_PROMPT_CONTRACT,
  AI_LIVE_SMOKE_ENV,
  isSuccessfulAiLiveHouseholdMealSmokeResult
} from './ai-live-smoke-safety.mjs';

function guardedDependencies(calls) {
  const unexpected = (name) => async () => {
    calls.push(name);
    throw new Error(`Unexpected dependency: ${name}`);
  };
  return {
    isSuccessfulAiLiveHouseholdMealSmokeResult,
    prepareExistingAiLiveSmokeSession: unexpected('session'),
    createAiLiveProxy: unexpected('proxy'),
    createAiLiveSmokeRunnerEnvironment: unexpected('runner-environment'),
    runAiLiveSmokeRunner: unexpected('playwright')
  };
}

function successfulCall() {
  return {
    status: 200,
    schemaName: AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME,
    elapsedMs: 12,
    requestContract: {
      strictJsonSchema: true,
      contextJsonAttachmentCount: 1,
      contextJsonAttachmentValid: true,
      recipeCatalogJsonAttachmentCount: 1,
      recipeCatalogJsonAttachmentValid: true,
      recipeCatalogAliasesValid: true,
      mealRecipeAliasSchemaValid: true,
      memberProfilesValid: true,
      planningInputsValid: true,
      previousPlanValid: true,
      nonEmptyEventsSchemaValid: true,
      forbiddenIdentityTermsAbsent: true,
      forbiddenPromptTermsAbsent: true
    },
    responseFormat: {
      hasChoices: true,
      messageContentType: 'text',
      isJsonObject: true,
      recipeReferencesValid: true,
      finishReason: 'stop'
    },
    usage: { promptTokens: 40, completionTokens: 80, totalTokens: 120 }
  };
}

test('meal-only coordinator requires explicit opt-in and rejects CI before local setup', async () => {
  const calls = [];
  const dependencies = guardedDependencies(calls);
  await assert.rejects(runHouseholdMealRealSmoke({ env: {}, dependencies }), /explicit opt-in/i);
  await assert.rejects(
    runHouseholdMealRealSmoke({
      env: { [AI_LIVE_SMOKE_ENV.optIn]: '1', CI: 'true' },
      dependencies
    }),
    /CI/i
  );
  assert.deepEqual(calls, []);
});

test('meal-only coordinator refuses any ticket path before WebAPI setup', async () => {
  const calls = [];
  await assert.rejects(
    runHouseholdMealRealSmoke({
      env: {
        [AI_LIVE_SMOKE_ENV.optIn]: '1',
        [AI_LIVE_SMOKE_ENV.receiptPath]: 'C:/private/ticket.pdf'
      },
      dependencies: guardedDependencies(calls)
    }),
    /cannot include receipt/i
  );
  assert.deepEqual(calls, []);
});

test('meal-only coordinator spends one strict-schema call, cleans up and reports only safe metrics', async () => {
  const calls = [];
  const successes = [];
  const errors = [];
  const progress = [];
  const proxyMetrics = {
    calls: [successfulCall()],
    requestAttempts: 1,
    rejectedRequests: 0,
    failed: false
  };
  const dependencies = {
    prepareExistingAiLiveSmokeSession: async () => {
      calls.push('session');
      return {
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-existing-webapi-token',
        model: 'gpt-5',
        cleanup: async () => calls.push('session-cleanup')
      };
    },
    createAiLiveProxy: async (input) => {
      calls.push('proxy');
      assert.equal(input.maxCalls, 1);
      assert.equal(input.expectedSchemaName, AI_LIVE_HOUSEHOLD_MEAL_SCHEMA_NAME);
      assert.equal(
        JSON.stringify({ forbiddenPromptTerms: input.forbiddenPromptTerms }),
        JSON.stringify(AI_LIVE_HOUSEHOLD_MEAL_PROMPT_CONTRACT)
      );
      assert.equal(input.requireReceiptAttachments, undefined);
      return {
        clientToken: 'synthetic-local-proxy-token',
        baseUrl: 'http://127.0.0.1:43210/v1',
        metrics: proxyMetrics,
        close: async () => calls.push('proxy-close')
      };
    },
    createAiLiveSmokeRunnerEnvironment: (env, options) => {
      calls.push('runner-environment');
      assert.equal(options.householdMealOnly, true);
      assert.equal(env[AI_LIVE_SMOKE_ENV.receiptPath], undefined);
      return { [AI_LIVE_SMOKE_ENV.householdMealOnly]: '1' };
    },
    runAiLiveSmokeRunner: async () => {
      calls.push('playwright');
      return { code: 0, cancelled: false, timedOut: false, runnerCleaned: true };
    },
    isSuccessfulAiLiveHouseholdMealSmokeResult
  };

  const result = await runHouseholdMealRealSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1', CI: '' },
    dependencies,
    writeError: (message) => errors.push(message),
    writeProgress: (message) => progress.push(message),
    writeSuccess: (message) => successes.push(message)
  });

  assert.equal(result, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(calls, [
    'session',
    'proxy',
    'runner-environment',
    'playwright',
    'proxy-close',
    'session-cleanup'
  ]);
  assert.equal(progress.length > 0, true);
  assert.equal(successes.length, 1);
  const summary = JSON.parse(successes[0]);
  assert.deepEqual(summary, {
    result: 'passed',
    provider: 'local WebAPI :3001',
    model: 'gpt-5',
    scenario: 'household-meal-proposal',
    completions: 1,
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
    elapsedMs: [12],
    usage: { promptTokens: 40, completionTokens: 80, totalTokens: 120 }
  });
  assert.equal(successes[0].includes('synthetic meal prompt'), false);
});

test('session preflight failure never starts the proxy or isolated application', async () => {
  const calls = [];
  const errors = [];
  const result = await runHouseholdMealRealSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1', CI: '' },
    dependencies: {
      ...guardedDependencies(calls),
      prepareExistingAiLiveSmokeSession: async () => {
        calls.push('session');
        throw new Error(
          'The configured WebAPI provider session is not ready; complete sign-in first.'
        );
      }
    },
    writeError: (message) => errors.push(message),
    writeProgress: () => {},
    writeSuccess: () => assert.fail('A failed preflight cannot pass the smoke.')
  });

  assert.equal(result, 1);
  assert.deepEqual(calls, ['session']);
  assert.match(errors.join('\n'), /WebAPI.*inicies sesión/i);
});

test('reports isolated runner progress and confirms a pre-request failure made no provider call', async () => {
  const progress = [];
  const errors = [];
  const result = await runHouseholdMealRealSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1', CI: '' },
    dependencies: {
      isSuccessfulAiLiveHouseholdMealSmokeResult,
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-existing-webapi-token',
        model: 'gpt-5',
        cleanup: async () => {}
      }),
      createAiLiveProxy: async () => ({
        clientToken: 'synthetic-local-proxy-token',
        baseUrl: 'http://127.0.0.1:43210/v1',
        metrics: { calls: [], requestAttempts: 0, rejectedRequests: 0, failed: false },
        close: async () => {}
      }),
      createAiLiveSmokeRunnerEnvironment: () => ({}),
      runAiLiveSmokeRunner: async ({ onProgress }) => {
        onProgress('Último hito E2E: preferencias blandas sintéticas configuradas.');
        onProgress('Los escenarios de Chrome fallaron; cerrando el entorno aislado.');
        return { code: 1, cancelled: false, timedOut: false, runnerCleaned: true };
      }
    },
    writeProgress: (message) => progress.push(message),
    writeError: (message) => errors.push(message),
    writeSuccess: () => assert.fail('A failed isolated run cannot pass the smoke.')
  });

  assert.equal(result, 1);
  assert.ok(progress.includes('Último hito E2E: preferencias blandas sintéticas configuradas.'));
  assert.ok(progress.includes('Los escenarios de Chrome fallaron; cerrando el entorno aislado.'));
  assert.match(errors.join('\n'), /E2E aislada falló antes de contactar al proveedor/i);
});

test('distinguishes a local proxy contract rejection from a provider completion', async () => {
  const errors = [];
  const result = await runHouseholdMealRealSmoke({
    env: { [AI_LIVE_SMOKE_ENV.optIn]: '1', CI: '' },
    dependencies: {
      isSuccessfulAiLiveHouseholdMealSmokeResult,
      prepareExistingAiLiveSmokeSession: async () => ({
        origin: 'http://127.0.0.1:3001',
        token: 'synthetic-existing-webapi-token',
        model: 'gpt-5',
        cleanup: async () => {}
      }),
      createAiLiveProxy: async () => ({
        clientToken: 'synthetic-local-proxy-token',
        baseUrl: 'http://127.0.0.1:43210/v1',
        metrics: { calls: [], requestAttempts: 1, rejectedRequests: 1, failed: true },
        close: async () => {}
      }),
      createAiLiveSmokeRunnerEnvironment: () => ({}),
      runAiLiveSmokeRunner: async () => ({
        code: 1,
        cancelled: false,
        timedOut: false,
        runnerCleaned: true
      })
    },
    writeError: (message) => errors.push(message),
    writeProgress: () => {},
    writeSuccess: () => assert.fail('A rejected proxy request cannot pass the smoke.')
  });

  assert.equal(result, 1);
  assert.match(errors.join('\n'), /rechazó la petición antes de contactar WebAPI/i);
  assert.match(errors.join('\n'), /ninguna completion/i);
  assert.equal(errors.join('\n').includes('synthetic-local-proxy-token'), false);
});

test('a completion that may have succeeded is never accepted after runner or cleanup failure', async () => {
  const call = successfulCall();
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({
      runnerExit: { code: 1, cancelled: false, timedOut: false, runnerCleaned: true },
      cleanupFailed: false,
      calls: [call],
      proxyMetrics: { requestAttempts: 1, rejectedRequests: 0, failed: false }
    }),
    false
  );
  assert.equal(
    isSuccessfulAiLiveHouseholdMealSmokeResult({
      runnerExit: { code: 0, cancelled: false, timedOut: false, runnerCleaned: true },
      cleanupFailed: true,
      calls: [call],
      proxyMetrics: { requestAttempts: 1, rejectedRequests: 0, failed: false }
    }),
    false
  );
});
