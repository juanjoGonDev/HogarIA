import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AI_LIVE_CONNECTION_SMOKE_GREP,
  AI_LIVE_HOUSEHOLD_PLAN_SMOKE_GREP,
  AI_LIVE_WORKFLOWS_SMOKE_GREP,
  AI_LIVE_ASSISTANT_ACTION_KINDS,
  AI_LIVE_SMOKE_DEADLINES
} from './ai-live-smoke-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = fileURLToPath(new URL('./run-isolated-playwright.mjs', import.meta.url));
const runnerArgs = (env) => {
  if (env?.HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_MEAL_ONLY === '1') {
    return [
      runner,
      '--config=playwright.ai-household-meal-real-smoke.config.ts',
      'tests/e2e/household-meal-planning-live-smoke.spec.ts'
    ];
  }
  return [
    runner,
    '--config=playwright.ai-real-smoke.config.ts',
    'tests/e2e/ai-real-smoke.spec.ts',
    ...(env?.HOGARIA_AI_REAL_SMOKE_CONNECTION_ONLY === '1'
      ? [`--grep=${AI_LIVE_CONNECTION_SMOKE_GREP}`]
      : env?.HOGARIA_AI_REAL_SMOKE_WORKFLOWS_ONLY === '1'
        ? [`--grep=${AI_LIVE_WORKFLOWS_SMOKE_GREP}`]
        : env?.HOGARIA_AI_REAL_SMOKE_HOUSEHOLD_PLAN_ONLY === '1'
          ? [`--grep=${AI_LIVE_HOUSEHOLD_PLAN_SMOKE_GREP}`]
        : [])
  ];
};
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
const SAFE_ASSISTANT_ACTION_STATE_FIELDS = Object.freeze([
  'domain',
  'selection',
  'status',
  'dependencies',
  'payload'
]);
const SAFE_ASSISTANT_SEMANTIC_CHECKS = Object.freeze([
  'pantry-name',
  'pantry-quantity',
  'pantry-unit',
  'pantry-category',
  'task-date',
  'event-date',
  'event-time',
  'shopping-dependency',
  'recipe-name',
  'recipe-ingredients',
  'meal-week'
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
  'test-phase:proposal-request-start': 'Último hito E2E: enviando propuesta semanal al servidor.',
  'test-phase:proposal-response-error':
    'Último hito E2E: el servidor rechazó la propuesta semanal antes de validarla.',
  'test-phase:calendar-still-empty': 'Último hito E2E: propuesta sin escritura en calendario.',
  'test-phase:config-start': 'Último hito E2E: guardando configuración IA de prueba.',
  'test-phase:configured': 'Último hito E2E: configuración IA de prueba guardada.',
  'test-phase:connection-only-start': 'Hito E2E: comienza el caso de conexión real aislado.',
  'test-phase:connection-only-registered': 'Hito E2E: usuario sintético conectado en el navegador.',
  'test-phase:connection-only-configured': 'Hito E2E: configuración aislada guardada.',
  'test-phase:connection-only-accepted': 'Hito E2E: WebApi aceptó la prueba de conexión en background.',
  'test-phase:connection-only-restored-after-tab-close': 'Hito E2E: se recuperó la prueba tras cerrar y reabrir la pestaña.',
  'test-phase:connection-only-terminal': 'Hito E2E: se leyó el estado final persistido de la conexión.',
  'test-phase:connection-only-success': 'Hito E2E: el estado final de conexión es correcto.',
  'test-phase:connection-only-latency': 'Hito E2E: la latencia del test quedó guardada.',
  'test-phase:connection-only-badge': 'Hito E2E: la UI muestra la conexión OK tras reabrir la pestaña.',
  'test-phase:connection-only-queue': 'Hito E2E: se recuperó la cola de conexión del usuario aislado.',
  'test-phase:connection-only-single-job': 'Hito E2E: existe un único job y un solo intento.',
  'test-phase:connection-only-restored-success': 'Hito E2E: prueba completada tras reabrir la pestaña.',
  'test-phase:household-plan-only-register-start': 'Hito E2E: iniciando la cuenta sintética para propuesta de plano.',
  'test-phase:household-plan-only-baseline-ready': 'Hito E2E: plano sintético vacío confirmado como baseline.',
  'test-phase:household-plan-only-proposal-validated': 'Hito E2E: propuesta real de plano validada por HogarIA.',
  'test-phase:household-plan-only-not-committed': 'Hito E2E: plano confirmado intacto; propuesta no guardada.',
  'test-phase:workflow-only-register-start': 'Hito E2E: iniciando cuenta sintética para workflows IA.',
  'test-phase:workflow-only-registered': 'Hito E2E: cuenta sintética lista.',
  'test-phase:workflow-only-improve-start': 'Hito E2E: enviando mejora de receta al proveedor real.',
  'test-phase:workflow-only-improve-completed': 'Hito E2E: mejora real validada sin persistir cambios.',
  'test-phase:workflow-only-meal-seeded': 'Hito E2E: comida sintética preparada para reemplazo.',
  'test-phase:workflow-only-replace-start': 'Hito E2E: enviando reemplazo de comida al proveedor real.',
  'test-phase:workflow-only-replace-completed': 'Hito E2E: alternativa real validada sin persistirla.',
  'test-phase:workflow-only-image-search-start': 'Hito E2E: iniciando búsqueda real en Commons.',
  'test-phase:workflow-only-image-search-queued': 'Hito E2E: job real de búsqueda en Commons en cola.',
  'test-phase:workflow-only-image-search-completed': 'Hito E2E: Commons devolvió candidatos con licencia.',
  'test-phase:workflow-only-all-completed': 'Hito E2E: mejora, reemplazo y búsqueda real completados.',
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
  'test-phase:assistant-only-household-ready':
    'Último hito E2E: hogar sintético preparado para la matriz.',
  'test-phase:assistant-only-pantry-seeded':
    'Último hito E2E: target sintético de despensa preparado.',
  'test-phase:assistant-only-shopping-list-seeded':
    'Último hito E2E: target sintético de lista preparado.',
  'test-phase:assistant-only-shopping-item-seeded':
    'Último hito E2E: target sintético de compra preparado.',
  'test-phase:assistant-only-task-seeded': 'Último hito E2E: target sintético de tarea preparado.',
  'test-phase:assistant-only-calendar-seeded':
    'Último hito E2E: target sintético de calendario preparado.',
  'test-phase:assistant-only-recipe-seeded':
    'Último hito E2E: target sintético de receta preparado.',
  'test-phase:assistant-only-snapshot-start':
    'Último hito E2E: registrando snapshot de lectura inicial.',
  'test-phase:assistant-only-snapshot-captured':
    'Último hito E2E: snapshot de lectura inicial registrado.',
  'test-phase:assistant-only-baseline-ready':
    'Último hito E2E: snapshot SQLite inicial registrado.',
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
  'test-phase:assistant-proposal-action-kinds-match':
    'Último hito E2E: los tipos de acción coinciden con el escenario.',
  'test-phase:assistant-proposal-action-kinds-mismatch':
    'Último hito E2E: los tipos de acción no coinciden con el escenario.',
  'test-phase:assistant-proposal-action-state-valid':
    'Último hito E2E: las acciones siguen pendientes y sin seleccionar.',
  'test-phase:assistant-proposal-action-state-invalid':
    'Último hito E2E: una acción no quedó pendiente y sin seleccionar.',
  ...Object.fromEntries(
    SAFE_ASSISTANT_SEMANTIC_CHECKS.map((check) => [
      `test-phase:assistant-proposal-semantic-invalid-${check}`,
      `Último hito E2E: falló la comprobación semántica sintética ${check}.`
    ])
  ),
  'test-phase:assistant-proposal-clarification-valid':
    'Último hito E2E: la petición ambigua quedó sin acciones y con pregunta.',
  'test-phase:assistant-proposal-clarification-invalid':
    'Último hito E2E: la petición ambigua no pidió aclaración segura.',
  'test-phase:assistant-proposal-semantics-valid':
    'Último hito E2E: se validaron fecha, cantidad y campos de acción.',
  'test-phase:assistant-proposal-snapshot-unchanged':
    'Último hito E2E: la propuesta no alteró ninguna tabla SQLite.',
  'test-phase:assistant-proposal-snapshot-changed':
    'Último hito E2E: la propuesta alteró una tabla SQLite.',
  'test-phase:assistant-proposals-read-only-validated':
    'Último hito E2E: la matriz de propuestas no escribió datos.',
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

function safeRunnerProgressMessage(phase) {
  if (typeof phase !== 'string') return undefined;
  const changedTablesPrefix = 'test-phase:assistant-proposal-snapshot-changed:';
  if (phase.startsWith(changedTablesPrefix)) {
    const tables = phase.slice(changedTablesPrefix.length).split('|');
    if (
      tables.length > 0 &&
      tables.length <= 32 &&
      tables.every((table) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(table))
    ) {
      return `Último hito E2E: propuesta cambió tablas SQLite temporales: ${tables.join(', ')}.`;
    }
    return 'Último hito E2E: la propuesta alteró una tabla SQLite.';
  }
  const staticMessage = SAFE_RUNNER_PROGRESS[phase];
  if (staticMessage) return staticMessage;

  const connectionDiagnosticPrefix = 'test-phase:connection-only-diagnostic:';
  if (phase.startsWith(connectionDiagnosticPrefix)) {
    const encoded = phase.slice(connectionDiagnosticPrefix.length);
    if (encoded.length > 4096) return undefined;
    let diagnostic;
    try {
      diagnostic = JSON.parse(decodeURIComponent(encoded));
    } catch {
      return undefined;
    }
    if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
      return undefined;
    }
    const safeEnum = (value, allowed) =>
      typeof value === 'string' && allowed.includes(value) ? value : undefined;
    const safeNumber = (value, min, max) =>
      Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
    const parts = [];
    const testStatus = safeEnum(diagnostic.testStatus, [
      'testing',
      'success',
      'failed',
      'interrupted',
      'unknown'
    ]);
    const testError = safeEnum(diagnostic.testError, [
      'PROVIDER',
      'TIMEOUT',
      'CANCELLED',
      'WORKER_EXCEPTION',
      'WORKER_STALLED',
      'unknown'
    ]);
    const providerError = [
      safeEnum(diagnostic.type, [
        'api_error',
        'invalid_request_error',
        'authentication_error',
        'permission_error',
        'rate_limit_error',
        'server_error',
        'insufficient_quota'
      ]),
      safeEnum(diagnostic.code, [
        'unsupported_parameter',
        'unsupported_value',
        'invalid_value',
        'invalid_type',
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
      ])
    ].filter(Boolean);
    parts.push(`estado=${testStatus ?? 'unknown'}`);
    if (testError && testError !== 'unknown') parts.push(`error=${testError}`);
    const status = safeNumber(diagnostic.status, 100, 599);
    if (status !== undefined) parts.push(`HTTP ${status}`);
    if (diagnostic.transport === 'responses_background') parts.push(diagnostic.transport);
    if (providerError.length) parts.push(providerError.join('/'));
    const param = safeEnum(diagnostic.param, [
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
    if (param) parts.push(`param=${param}`);
    const stage = safeEnum(diagnostic.stage, [
      'submitting',
      'queued',
      'polling',
      'completed',
      'failed',
      'timed_out',
      'cancelled'
    ]);
    if (stage) parts.push(`fase=${stage}`);
    const elapsedMs = safeNumber(diagnostic.elapsedMs, 0, 86_400_000);
    if (elapsedMs !== undefined) parts.push(`${elapsedMs} ms`);
    const attempts = safeNumber(diagnostic.attempts, 0, 4);
    if (attempts !== undefined) parts.push(`intentos=${attempts}`);
    if (typeof diagnostic.responseId === 'string' && /^resp_[A-Za-z0-9_-]{1,128}$/.test(diagnostic.responseId)) {
      parts.push(`id=${diagnostic.responseId}`);
    }
    return `Diagnóstico seguro de conexión: ${parts.join('; ')}.`;
  }

  const prefix = 'test-phase:assistant-proposal-action-kinds-mismatch-';
  if (phase.startsWith(prefix)) {
    let summary = phase.slice(prefix.length);
    let scenarioOrdinal;
    if (summary.startsWith('scenario-')) {
      const scenarioMatch = /^scenario-(\d{1,2})-(.+)$/.exec(summary);
      if (!scenarioMatch) return undefined;
      scenarioOrdinal = Number(scenarioMatch[1]);
      if (!Number.isSafeInteger(scenarioOrdinal) || scenarioOrdinal < 1 || scenarioOrdinal > 10) {
        return undefined;
      }
      summary = scenarioMatch[2];
    }
    const scenario = scenarioOrdinal ? ` en el escenario ${scenarioOrdinal}` : '';
    if (summary === 'none') {
      return scenarioOrdinal
        ? `Último hito E2E: WebAPI no devolvió acciones${scenario}.`
        : 'Último hito E2E: WebAPI no devolvió acciones para el escenario.';
    }
    if (summary === 'none-with-questions') {
      return scenarioOrdinal
        ? `Último hito E2E: WebAPI pidió aclaración${scenario} y no propuso acciones.`
        : 'Último hito E2E: WebAPI pidió aclaración y no propuso acciones para el escenario.';
    }
    if (summary === 'unrecognized') {
      return scenarioOrdinal
        ? `Último hito E2E: WebAPI devolvió un tipo de acción no reconocido${scenario}.`
        : 'Último hito E2E: WebAPI devolvió un tipo de acción no reconocido.';
    }
    if (summary === 'too-many') {
      return scenarioOrdinal
        ? `Último hito E2E: WebAPI devolvió más acciones que tipos allowlist${scenario}.`
        : 'Último hito E2E: WebAPI devolvió más acciones que tipos allowlist.';
    }

    const kinds = summary.split('|');
    if (
      kinds.length > AI_LIVE_ASSISTANT_ACTION_KINDS.length ||
      kinds.some((kind) => !AI_LIVE_ASSISTANT_ACTION_KINDS.includes(kind))
    ) {
      return undefined;
    }
    return scenarioOrdinal
      ? `Último hito E2E: tipos allowlist devueltos por WebAPI${scenario} no coinciden: ${kinds.join(', ')}.`
      : `Último hito E2E: tipos allowlist devueltos por WebAPI no coinciden: ${kinds.join(', ')}.`;
  }

  const statePrefix = 'test-phase:assistant-proposal-action-state-invalid:';
  if (!phase.startsWith(statePrefix)) return undefined;
  const [kind, fieldsText, ...extra] = phase.slice(statePrefix.length).split(':');
  const fields = fieldsText?.split('|') ?? [];
  if (
    extra.length > 0 ||
    (!AI_LIVE_ASSISTANT_ACTION_KINDS.includes(kind) && kind !== 'unrecognized') ||
    fields.length === 0 ||
    fields.length > SAFE_ASSISTANT_ACTION_STATE_FIELDS.length ||
    fields.some((field) => !SAFE_ASSISTANT_ACTION_STATE_FIELDS.includes(field))
  ) {
    return undefined;
  }
  if (kind === 'unrecognized') {
    return `Último hito E2E: estado no válido en acción con tipo no reconocido (${fields.join(', ')}).`;
  }
  return `Último hito E2E: estado de ${kind} no válido: ${fields.join(', ')}.`;
}

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
        const safeMessage = safeRunnerProgressMessage(message.phase);
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
