import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AI_LIVE_SMOKE_DEADLINES } from './ai-live-smoke-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = fileURLToPath(new URL('./run-isolated-playwright.mjs', import.meta.url));
const runnerArgs = (env) =>
  env?.HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY === '1'
    ? [
        runner,
        '--config=playwright.ai-household-meal-real-smoke.config.ts',
        'tests/e2e/household-meal-planning-live-smoke.spec.ts'
      ]
    : [runner, '--config=playwright.ai-real-smoke.config.ts', 'tests/e2e/ai-real-smoke.spec.ts'];
export const AI_LIVE_SMOKE_RUNNER_WATCHDOG_MS = AI_LIVE_SMOKE_DEADLINES.watchdogMs;
export const AI_LIVE_SMOKE_RUNNER_SHUTDOWN_MESSAGE = 'ai-live-smoke-shutdown';
export const AI_LIVE_SMOKE_RUNNER_COMPLETE_MESSAGE = 'ai-live-smoke-runner-complete';
export const AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE = 'ai-live-smoke-progress';

const SAFE_ASSISTANT_API_ERROR_CODES = Object.freeze([
  'AI_CANCELLED',
  'AI_NOT_CONFIGURED',
  'AI_PROVIDER_ERROR',
  'AI_TIMEOUT',
  'ASSISTANT_BUSY',
  'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED',
  'INVALID_AI_RESULT',
  'INVALID_ASSISTANT_REQUEST',
  'unavailable'
]);
const SAFE_ASSISTANT_PAYLOAD_FIELDS = Object.freeze([
  'name',
  'quantity',
  'unit',
  'category',
  'expirationDate',
  'location',
  'notes'
]);
const SAFE_ASSISTANT_VALIDATION_CODES = Object.freeze([
  'invalid_type',
  'too_small',
  'too_big',
  'invalid_value',
  'invalid_format',
  'unrecognized_keys',
  'custom'
]);
const SAFE_ASSISTANT_PROPOSAL_CHECKS = Object.freeze([
  'success',
  'summary',
  'action-count',
  'action-kind',
  'domain',
  'selection',
  'status',
  'payload-name',
  'payload-quantity',
  'payload-unit',
  'questions'
]);

const SAFE_RUNNER_PROGRESS = Object.freeze({
  'run-dir-created': 'Entorno aislado temporal preparado.',
  'isolated-stack-starting': 'Iniciando la aplicación aislada.',
  'isolated-stack-ready': 'Aplicación aislada lista; iniciando Chrome.',
  'playwright-starting': 'Chrome está recorriendo los escenarios.',
  'playwright-passed': 'Los escenarios de Chrome terminaron; cerrando el entorno aislado.',
  'playwright-failed': 'Los escenarios de Chrome fallaron; cerrando el entorno aislado.',
  'test-phase:register-start': 'Último hito E2E: comenzando el registro sintético.',
  'test-phase:registered': 'Último hito E2E: registro sintético completado.',
  'test-phase:household-start': 'Último hito E2E: creando los dos perfiles sintéticos.',
  'test-phase:household-ready': 'Último hito E2E: hogar sintético con dos miembros preparado.',
  'test-phase:profiles-ready': 'Último hito E2E: preferencias blandas sintéticas configuradas.',
  'test-phase:calendar-empty': 'Último hito E2E: calendario aislado vacío antes de proponer.',
  'test-phase:proposal-returned': 'Último hito E2E: la API validó una propuesta semanal.',
  'test-phase:calendar-still-empty': 'Último hito E2E: propuesta sin escritura en calendario.',
  'test-phase:config-start': 'Último hito E2E: guardando configuración IA de prueba.',
  'test-phase:configured': 'Último hito E2E: configuración IA de prueba guardada.',
  'test-phase:ingredients-created': 'Último hito E2E: ingredientes sintéticos preparados.',
  'test-phase:ingredients-api-verified':
    'Último hito E2E: API devuelve todos los ingredientes sintéticos.',
  'test-phase:recipe-page-loaded': 'Último hito E2E: vista de recetas cargada.',
  'test-phase:generate-modal-open': 'Último hito E2E: modal de generación abierto.',
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `test-phase:ingredient-${index + 1}-visible`,
      `Último hito E2E: ingrediente ${index + 1}/11 visible en el modal.`
    ])
  ),
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `test-phase:ingredient-${index + 1}-matches-none`,
      `Último hito E2E: el ingrediente ${index + 1}/11 no tiene coincidencia en el modal.`
    ])
  ),
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `test-phase:ingredient-${index + 1}-matches-single`,
      `Último hito E2E: el ingrediente ${index + 1}/11 tiene una coincidencia en el modal.`
    ])
  ),
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `test-phase:ingredient-${index + 1}-matches-multiple`,
      `Último hito E2E: el ingrediente ${index + 1}/11 tiene coincidencias duplicadas en el modal.`
    ])
  ),
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `test-phase:ingredient-${index + 1}-selected`,
      `Último hito E2E: ingredientes ${index + 1}/11 seleccionados.`
    ])
  ),
  'test-phase:ingredients-selected': 'Último hito E2E: selección de ingredientes validada.',
  'test-phase:participants-step-loaded': 'Último hito E2E: preferencias de comensales cargadas.',
  'test-phase:recipe-options-set': 'Último hito E2E: opciones de receta configuradas.',
  'test-phase:recipe-request-start': 'Último hito E2E: iniciando receta compleja.',
  'test-phase:recipe-response-ok': 'Último hito E2E: la API devolvió una receta.',
  'test-phase:recipe-response-server-error':
    'Último hito E2E: la API respondió error de servidor a la receta.',
  'test-phase:recipe-response-other-error':
    'Último hito E2E: respuesta no válida de generación de receta.',
  'test-phase:recipe-generated': 'Último hito E2E: receta compleja validada.',
  'test-phase:recipe-content-validated': 'Último hito E2E: contenido de la receta validado.',
  'test-phase:recipe-error-invalid-json':
    'Último hito E2E: la respuesta del proveedor no fue JSON utilizable.',
  'test-phase:recipe-error-unusable-draft':
    'Último hito E2E: el borrador generado no contenía una receta utilizable.',
  'test-phase:recipe-error-incomplete-draft':
    'Último hito E2E: la receta generada no cumplió el esquema completo.',
  'test-phase:recipe-error-unclassified':
    'Último hito E2E: la API devolvió un error de receta no clasificado.',
  'test-phase:recipe-only-register-start': 'Último hito E2E: iniciando registro de prueba.',
  'test-phase:recipe-only-registered': 'Último hito E2E: registro de prueba completado.',
  'test-phase:recipe-only-request-start': 'Último hito E2E: iniciando la receta sintética real.',
  'test-phase:recipe-only-response-ok': 'Último hito E2E: la API respondió a la receta sintética.',
  'test-phase:recipe-only-response-server-error':
    'Último hito E2E: la API devolvió un error al generar la receta sintética.',
  'test-phase:recipe-only-response-other-error':
    'Último hito E2E: respuesta no válida al generar la receta sintética.',
  'test-phase:recipe-only-response-validated':
    'Último hito E2E: la receta sintética quedó validada.',
  'test-phase:assistant-only-register-start':
    'Último hito E2E: iniciando la cuenta sintética del asistente.',
  'test-phase:assistant-only-configured':
    'Último hito E2E: proveedor temporal preparado para el asistente.',
  'test-phase:assistant-proposal-request-start':
    'Último hito E2E: iniciando propuesta transitoria del asistente.',
  'test-phase:assistant-proposal-response-ok':
    'Último hito E2E: WebAPI respondió a la propuesta del asistente.',
  'test-phase:assistant-proposal-response-server-error':
    'Último hito E2E: WebAPI devolvió error de servidor a la propuesta del asistente.',
  'test-phase:assistant-proposal-response-other-error':
    'Último hito E2E: respuesta no válida a la propuesta del asistente.',
  'test-phase:assistant-proposal-response-validated':
    'Último hito E2E: propuesta estructurada y revisable validada.',
  ...Object.fromEntries(
    SAFE_ASSISTANT_API_ERROR_CODES.map((code) => [
      `test-phase:assistant-proposal-error-${code}`,
      `Último hito E2E: propuesta falló con código API ${code}.`
    ])
  ),
  ...Object.fromEntries(
    SAFE_ASSISTANT_PAYLOAD_FIELDS.flatMap((field) =>
      SAFE_ASSISTANT_VALIDATION_CODES.map((code) => [
        `test-phase:assistant-proposal-invalid-${field}-${code}`,
        `Último hito E2E: el campo ${field} del payload no pasó la validación (${code}).`
      ])
    )
  ),
  ...Object.fromEntries(
    SAFE_ASSISTANT_PROPOSAL_CHECKS.map((check) => [
      `test-phase:assistant-proposal-invalid-${check}`,
      `Último hito E2E: la comprobación segura ${check} de la propuesta no pasó.`
    ])
  ),
  'test-phase:assistant-proposals-read-only-validated':
    'Último hito E2E: las diez propuestas no escribieron datos.',
  'test-phase:connection-tested': 'Último hito E2E: conexión IA comprobada.',
  'test-phase:multiple-recipes-request-start': 'Último hito E2E: generando recetas múltiples.',
  'test-phase:multiple-recipes-response-ok': 'Último hito E2E: API devolvió recetas múltiples.',
  'test-phase:multiple-recipes-response-server-error':
    'Último hito E2E: la API respondió error de servidor a recetas múltiples.',
  'test-phase:multiple-recipes-response-other-error':
    'Último hito E2E: respuesta no válida de generación múltiple.',
  'test-phase:multiple-recipes-count-validated':
    'Último hito E2E: cantidad y nombres de recetas múltiples validados.',
  'test-phase:multiple-recipes-content-validated':
    'Último hito E2E: contenido estructurado de recetas múltiples validado.',
  'test-phase:multiple-recipes-validated': 'Último hito E2E: recetas múltiples validadas.',
  'test-phase:recommendations-request-start': 'Último hito E2E: generando recomendaciones.',
  'test-phase:recommendations-validated': 'Último hito E2E: recomendaciones validadas.',
  'test-phase:weekly-plan-request-start': 'Último hito E2E: generando planificación semanal.',
  'test-phase:weekly-plan-persisted': 'Último hito E2E: planificación semanal guardada y leída.',
  'test-phase:expiry-estimate-persisted': 'Último hito E2E: estimación de caducidad comprobada.',
  'test-phase:expiry-ingredient-created':
    'Último hito E2E: ingrediente de caducidad sintético creado.',
  'test-phase:expiry-estimate-request-start':
    'Último hito E2E: empezando la estimación de caducidad.',
  'test-phase:expiry-existing-ingredients-isolated':
    'Último hito E2E: otros ingredientes sintéticos excluidos de la estimación.',
  'test-phase:expiry-estimate-response-200':
    'Último hito E2E: la API respondió a la estimación de caducidad.',
  'test-phase:expiry-estimate-response-server-error':
    'Último hito E2E: la estimación de caducidad devolvió error de servidor.',
  'test-phase:expiry-estimate-response-other-error':
    'Último hito E2E: respuesta no válida de estimación de caducidad.',
  'test-phase:expiry-estimate-json-parsed':
    'Último hito E2E: respuesta de caducidad legible como JSON.',
  'test-phase:expiry-estimate-summary-validated':
    'Último hito E2E: recuento de caducidad validado.',
  'test-phase:expiry-estimate-response-valid':
    'Último hito E2E: respuesta de estimación de caducidad validada.',
  'test-phase:shopping-photo-request-start': 'Último hito E2E: analizando estantería sintética.',
  'test-phase:shopping-photo-analyzed': 'Último hito E2E: análisis de estantería validado.',
  'test-phase:shopping-photo-confirmed': 'Último hito E2E: línea corregida guardada en la compra.',
  'test-phase:synthetic-receipt-uploaded': 'Último hito E2E: ticket sintético cargado.',
  'test-phase:synthetic-receipt-status-queued':
    'Último hito E2E: el ticket sintético sigue en cola.',
  'test-phase:synthetic-receipt-status-analyzing':
    'Último hito E2E: el ticket sintético está en análisis.',
  'test-phase:synthetic-receipt-status-review':
    'Último hito E2E: el ticket sintético llegó a revisión.',
  'test-phase:synthetic-receipt-review-store-and-date-match':
    'Último hito E2E: el ticket sintético coincide en tienda y fecha.',
  'test-phase:synthetic-receipt-review-store-match-date-mismatch':
    'Último hito E2E: el ticket sintético no coincide en la fecha extraída.',
  'test-phase:synthetic-receipt-review-store-mismatch-date-match':
    'Último hito E2E: el ticket sintético no coincide en la tienda extraída.',
  'test-phase:synthetic-receipt-review-store-and-date-mismatch':
    'Último hito E2E: el ticket sintético no coincide en tienda ni fecha.',
  'test-phase:synthetic-receipt-status-failed':
    'Último hito E2E: falló el análisis del ticket sintético.',
  'test-phase:synthetic-receipt-status-stopped':
    'Último hito E2E: se detuvo el análisis del ticket sintético.',
  'test-phase:synthetic-receipt-extracted':
    'Último hito E2E: datos del ticket sintético detectados.',
  'test-phase:synthetic-receipt-edited':
    'Último hito E2E: comercio y fecha editados y persistidos.',
  'test-phase:synthetic-receipt-history-verified':
    'Último hito E2E: historial del ticket verificado.',
  'test-phase:real-receipt-extracted':
    'Último hito E2E: ticket real sintético de prueba procesado.',
  'test-phase:real-receipts-inputs-validated':
    'Último hito E2E: fuentes validadas y selección de tickets preparada en memoria.',
  'test-phase:real-receipts-started': 'Último hito E2E: comenzó el smoke privado de tickets.',
  'test-phase:real-receipt-ticket-verified':
    'Último hito E2E: ticket procesado, revisado y guardado en historial.',
  'test-phase:real-receipts-all-verified':
    'Último hito E2E: los tickets seleccionados y su revisión quedaron verificados.',
  'runner-error': 'Falló una fase del entorno E2E; se está limpiando.'
});

/** Send cleanup confirmation and close the dedicated IPC channel so the child can exit. */
export function sendAiLiveSmokeRunnerCompletion({ processLike = process, cleaned } = {}) {
  if (!processLike.connected) return false;
  try {
    processLike.send(
      { type: AI_LIVE_SMOKE_RUNNER_COMPLETE_MESSAGE, cleaned: cleaned === true },
      () => {
        try {
          processLike.disconnect();
        } catch {
          // The parent may already have closed the channel.
        }
      }
    );
    return true;
  } catch {
    try {
      processLike.disconnect();
    } catch {
      // There is no recoverable channel after send failure.
    }
    return false;
  }
}

/** Stop the dedicated child through its cleanup protocol; never kill its process tree here. */
export function runAiLiveSmokeRunner({
  env,
  signal,
  onProgress,
  watchdogMs = AI_LIVE_SMOKE_RUNNER_WATCHDOG_MS,
  spawnImpl = spawn
} = {}) {
  if (signal?.aborted) {
    return Promise.resolve({ code: 1, cancelled: true, timedOut: false, runnerCleaned: false });
  }

  return new Promise((resolveExit) => {
    let child;
    let watchdog;
    let shutdownRequested = false;
    let shutdownSent = false;
    let timedOut = false;
    let cancelled = false;
    let runnerCleaned = false;
    let settled = false;
    const report = (message) => {
      try {
        onProgress?.(message);
      } catch {
        // Progress reporting must not interfere with cleanup or the test result.
      }
    };

    const requestShutdown = () => {
      shutdownRequested = true;
      if (!child?.connected || shutdownSent) return;
      shutdownSent = true;
      try {
        child.send({ type: AI_LIVE_SMOKE_RUNNER_SHUTDOWN_MESSAGE });
      } catch {
        // Keep waiting for the runner's exit and cleanup result; do not force-kill it.
      }
    };
    const onAbort = () => {
      cancelled = true;
      requestShutdown();
    };
    const onSpawn = () => {
      report('Proceso de pruebas aislado iniciado.');
      if (shutdownRequested) requestShutdown();
    };
    const onSpawnError = () => {
      report('No se pudo iniciar el proceso aislado de pruebas.');
      finish(1);
    };
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      signal?.removeEventListener('abort', onAbort);
      child?.removeListener('spawn', onSpawn);
      resolveExit({ code, cancelled, timedOut, runnerCleaned });
    };

    try {
      child = spawnImpl(process.execPath, runnerArgs(env), {
        cwd: root,
        env,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true
      });
    } catch {
      report('No se pudo iniciar el proceso aislado de pruebas.');
      finish(1);
      return;
    }

    child.once('spawn', onSpawn);
    child.on('message', (message) => {
      if (
        message?.type === AI_LIVE_SMOKE_RUNNER_COMPLETE_MESSAGE &&
        typeof message.cleaned === 'boolean'
      ) {
        runnerCleaned = message.cleaned;
      }
      if (message?.type === AI_LIVE_SMOKE_RUNNER_PROGRESS_MESSAGE) {
        const safeMessage = SAFE_RUNNER_PROGRESS[message.phase];
        if (safeMessage) report(safeMessage);
      }
    });
    child.once('error', onSpawnError);
    child.once('exit', (code, childSignal) => finish(code ?? (childSignal ? 1 : 0)));

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    watchdog = setTimeout(() => {
      timedOut = true;
      report('Se alcanzó el límite de espera; solicitando cierre ordenado.');
      requestShutdown();
    }, watchdogMs);
    watchdog.unref();
  });
}
