import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  AI_LIVE_SMOKE_RUNNER_COMPLETE_MESSAGE,
  AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
  sendAiLiveSmokeRunnerCompletion,
  runAiLiveSmokeRunner
} from './ai-live-smoke-runner-control.mjs';

function createRunnerChild() {
  const child = new EventEmitter();
  child.pid = 42;
  child.connected = true;
  child.exitCode = null;
  child.signalCode = null;
  child.messages = [];
  child.killCalls = [];
  child.send = (message) => child.messages.push(message);
  child.kill = (signal) => child.killCalls.push(signal);
  return child;
}

test('household meal smoke launches only its dedicated isolated Playwright spec', async () => {
  const child = createRunnerChild();
  const running = runAiLiveSmokeRunner({
    env: { HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY: '1' },
    watchdogMs: 60_000,
    spawnImpl: (_command, args) => {
      assert.deepEqual(args.slice(1), [
        '--config=playwright.ai-household-meal-real-smoke.config.ts',
        'tests/e2e/household-meal-planning-live-smoke.spec.ts'
      ]);
      return child;
    }
  });

  child.emit('spawn');
  child.emit('message', { type: AI_LIVE_SMOKE_RUNNER_COMPLETE_MESSAGE, cleaned: true });
  child.exitCode = 0;
  child.connected = false;
  child.emit('exit', 0, null);

  assert.deepEqual(await running, {
    code: 0,
    cancelled: false,
    timedOut: false,
    runnerCleaned: true
  });
});

test('cancellation asks the owned E2E runner to shut down and waits for cleanup confirmation', async () => {
  const controller = new AbortController();
  const child = createRunnerChild();
  const progress = [];
  const running = runAiLiveSmokeRunner({
    env: { synthetic: 'env' },
    signal: controller.signal,
    onProgress: (message) => progress.push(message),
    watchdogMs: 60_000,
    spawnImpl: (_command, _args, options) => {
      assert.equal(options.stdio[3], 'ipc');
      return child;
    }
  });

  child.emit('spawn');
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(progress, ['Proceso de pruebas aislado iniciado.']);
  assert.deepEqual(child.messages, [{ type: 'ai-live-smoke-shutdown' }]);
  assert.deepEqual(child.killCalls, []);

  child.emit('message', { type: 'ai-live-smoke-runner-complete', cleaned: true });
  child.exitCode = 1;
  child.connected = false;
  child.emit('exit', 1, null);

  assert.deepEqual(await running, {
    code: 1,
    cancelled: true,
    timedOut: false,
    runnerCleaned: true
  });
});

test('watchdog requests the same cleanup path instead of force-killing the runner', async () => {
  const child = createRunnerChild();
  const progress = [];
  const running = runAiLiveSmokeRunner({
    env: {},
    onProgress: (message) => progress.push(message),
    watchdogMs: 5,
    spawnImpl: () => child
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(progress, ['Se alcanzó el límite de espera; solicitando cierre ordenado.']);
  assert.deepEqual(child.messages, [{ type: 'ai-live-smoke-shutdown' }]);
  assert.deepEqual(child.killCalls, []);

  child.emit('message', { type: 'ai-live-smoke-runner-complete', cleaned: false });
  child.exitCode = 1;
  child.connected = false;
  child.emit('exit', 1, null);

  assert.deepEqual(await running, {
    code: 1,
    cancelled: false,
    timedOut: true,
    runnerCleaned: false
  });
});

test('runner exposes only allowlisted progress labels from its child', async () => {
  const child = createRunnerChild();
  const progress = [];
  const running = runAiLiveSmokeRunner({
    env: {},
    onProgress: (message) => progress.push(message),
    watchdogMs: 60_000,
    spawnImpl: () => child
  });

  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'isolated-stack-ready',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:shopping-photo-analyzed',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:expiry-ingredient-created',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:multiple-recipes-response-server-error',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:expiry-estimate-response-200',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:expiry-existing-ingredients-isolated',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:recipe-response-ok',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:recipe-content-validated',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:recipe-only-request-start',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:assistant-proposal-response-validated',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:assistant-proposal-error-AI_PROVIDER_ERROR',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:assistant-proposal-invalid-category-invalid_type',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:assistant-proposal-invalid-action-count',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:assistant-proposal-error-secret-value',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:assistant-proposals-read-only-validated',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:recipe-error-invalid-json',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:recipe-error-unusable-draft',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:recipe-error-incomplete-draft',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:recipe-error-unclassified',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:synthetic-receipt-status-queued',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:synthetic-receipt-status-review',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:synthetic-receipt-review-store-and-date-match',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:synthetic-receipt-review-store-match-date-mismatch',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:synthetic-receipt-review-store-mismatch-date-match',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:synthetic-receipt-review-store-and-date-mismatch',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:real-receipts-inputs-validated',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:real-receipt-ticket-verified',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'test-phase:real-receipts-all-verified',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', {
    type: AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE,
    phase: 'unrecognized-phase',
    secret: 'must-not-be-forwarded'
  });
  child.emit('message', { type: 'unrelated-message', phase: 'runner-error' });
  child.emit('message', { type: 'ai-live-smoke-runner-complete', cleaned: true });
  child.exitCode = 0;
  child.connected = false;
  child.emit('exit', 0, null);

  assert.deepEqual(progress, [
    'Aplicación aislada lista; iniciando Chrome.',
    'Último hito E2E: análisis de estantería validado.',
    'Último hito E2E: ingrediente de caducidad sintético creado.',
    'Último hito E2E: la API respondió error de servidor a recetas múltiples.',
    'Último hito E2E: la API respondió a la estimación de caducidad.',
    'Último hito E2E: otros ingredientes sintéticos excluidos de la estimación.',
    'Último hito E2E: la API devolvió una receta.',
    'Último hito E2E: contenido de la receta validado.',
    'Último hito E2E: iniciando la receta sintética real.',
    'Último hito E2E: propuesta estructurada y revisable validada.',
    'Último hito E2E: propuesta falló con código API AI_PROVIDER_ERROR.',
    'Último hito E2E: el campo category del payload no pasó la validación (invalid_type).',
    'Último hito E2E: la comprobación segura action-count de la propuesta no pasó.',
    'Último hito E2E: las diez propuestas no escribieron datos.',
    'Último hito E2E: la respuesta del proveedor no fue JSON utilizable.',
    'Último hito E2E: el borrador generado no contenía una receta utilizable.',
    'Último hito E2E: la receta generada no cumplió el esquema completo.',
    'Último hito E2E: la API devolvió un error de receta no clasificado.',
    'Último hito E2E: el ticket sintético sigue en cola.',
    'Último hito E2E: el ticket sintético llegó a revisión.',
    'Último hito E2E: el ticket sintético coincide en tienda y fecha.',
    'Último hito E2E: el ticket sintético no coincide en la fecha extraída.',
    'Último hito E2E: el ticket sintético no coincide en la tienda extraída.',
    'Último hito E2E: el ticket sintético no coincide en tienda ni fecha.',
    'Último hito E2E: fuentes validadas y selección de tickets preparada en memoria.',
    'Último hito E2E: ticket procesado, revisado y guardado en historial.',
    'Último hito E2E: los tickets seleccionados y su revisión quedaron verificados.'
  ]);
  assert.deepEqual(await running, {
    code: 0,
    cancelled: false,
    timedOut: false,
    runnerCleaned: true
  });
});

test('reports a sanitized startup failure when the isolated runner cannot spawn', async () => {
  const child = createRunnerChild();
  const progress = [];
  const running = runAiLiveSmokeRunner({
    env: {},
    onProgress: (message) => progress.push(message),
    watchdogMs: 60_000,
    spawnImpl: () => child
  });

  child.emit('error', new Error('EPERM: secret details must not be logged'));

  assert.deepEqual(progress, ['No se pudo iniciar el proceso aislado de pruebas.']);
  assert.deepEqual(await running, {
    code: 1,
    cancelled: false,
    timedOut: false,
    runnerCleaned: false
  });
});

test('completion notification disconnects the IPC channel after delivery', () => {
  let completion;
  let disconnected = false;
  const processLike = {
    connected: true,
    send: (message, callback) => {
      assert.deepEqual(message, {
        type: AI_LIVE_SMOKE_RUNNER_COMPLETE_MESSAGE,
        cleaned: true
      });
      completion = callback;
    },
    disconnect: () => {
      disconnected = true;
      processLike.connected = false;
    }
  };

  assert.equal(sendAiLiveSmokeRunnerCompletion({ processLike, cleaned: true }), true);
  assert.equal(disconnected, false);
  completion();
  assert.equal(disconnected, true);
  assert.equal(sendAiLiveSmokeRunnerCompletion({ processLike, cleaned: true }), false);
});

test('an already cancelled run does not start the E2E process', async () => {
  const controller = new AbortController();
  controller.abort();
  let spawnCalled = false;

  const result = await runAiLiveSmokeRunner({
    env: {},
    signal: controller.signal,
    spawnImpl: () => {
      spawnCalled = true;
      throw new Error('must not spawn');
    }
  });

  assert.equal(spawnCalled, false);
  assert.deepEqual(result, {
    code: 1,
    cancelled: true,
    timedOut: false,
    runnerCleaned: false
  });
});
