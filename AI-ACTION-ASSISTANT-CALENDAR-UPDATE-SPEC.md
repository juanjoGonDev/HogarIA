# Actualización segura de eventos desde el asistente global

**Estado:** spec publicada en el Draft PR #47; implementación y verificación funcional completadas, pendiente registrar el resultado de los hooks de commit/push.
**Rama/PR:** `feat/household-floorplan` / #47. Mantener Draft; no mergear.
**Alcance:** actualizar un evento propio existente con revisión y aprobación explícita. No añadir invitados, editar eventos ajenos, cambiar recurrencia ni borrar eventos.

## Evidencia y decisión

- `calendar_events` almacena propietario, hogar, título, tipo, fecha, horas, descripción (`notes`), ubicación, recurrencia y `updated_at`; no tiene versión monotónica.
- `PATCH /api/calendar/events/:id` permite editar solo al propietario, pero no protege contra cambios obsoletos ni hace idempotente la acción. Además, actualiza campos antes de validar la lista de invitados; no es una ruta segura para el asistente tal cual.
- La nueva operación de dominio debe releer hogar/propietario al confirmar, comparar `updated_at` y snapshot completo dentro de una transacción, validar el resultado y guardar únicamente los campos editables. No incluir invitados ni recurrencia en esta unidad.
- El modelo solo propone título/fecha/hora original para resolver el target y el parche deseado; nunca IDs, hogar, permisos, preimagen, versión o SQL. El servidor adjunta el target y snapshot solo tras una coincidencia única.
- La propuesta/refinamiento y la edición local del borrador deben seguir siendo de solo lectura; proveedor IA determinista solo en la suite repetible. El E2E debe usar app/API reales y SQLite temporal.

## Criterios de aceptación

- [x] TDD: schema estricto para `calendar.update_event`; rechazar IDs/propiedades desconocidas y limitar campos del parche a título, tipo, fecha, inicio/fin, descripción y ubicación.
- [x] El servidor resuelve por usuario autenticado y hogar seleccionado exactamente un evento propio según título, fecha y hora original; sin o con varias coincidencias devuelve aclaración no ejecutable y no revela IDs.
- [x] Propuesta/refinamiento/edición local/rechazo/cierre no escribe tablas de dominio, ledger ni `ai_jobs`; cambiar el hogar durante el flujo invalida la aprobación.
- [x] La interfaz muestra target, valores anteriores y cambios; permite editar/quitar el parche y ejecutar solo tras confirmación visible.
- [x] La ruta de dominio revalida propietario/hogar, compara preimagen completa y `updated_at` en transacción, valida la fila resultante y rechaza valores obsoletos con 409 sin escritura parcial.
- [x] Repetir la misma acción/payload devuelve el resultado idempotente sin una segunda escritura; reusar la clave con target, snapshot o parche distinto devuelve conflicto.
- [x] No se ofrecen eventos compartidos/ajenos, asistentes/invitados, recurrencia ni acciones destructivas; el usuario conserva control de cada acción.
- [x] E2E aislado con Playwright, backend/API reales, SQLite temporal y fixture IA determinista cubre sin coincidencia/ambigüedad, rechazo sin escrituras, confirmación y persistencia tras recarga, replay, target obsoleto y conflicto de hogar.
- [ ] Desktop y móvil tienen capturas sintéticas inspeccionadas; controles, foco, teclado, scroll, tamaños táctiles y errores se verifican. Coverage gates, typecheck, `check:ui`, build y suites focales pasan; falta registrar hooks de commit/push.

## Verificación

- `pnpm --filter @hogaria/server run test:coverage`: 119 ficheros, 2013 pruebas pasan y 1 omitida; coverage 89,72 % statements, 82,01 % branches, 95,81 % functions y 92,70 % lines. Todos los gates superan 70 %.
- `$env:KARMA_COVERAGE_DIR="$env:TEMP/hogaria-calendar-client-coverage-run5-20261016"; pnpm --filter @hogaria/web run test:coverage`: 1646/1646; coverage 90,63 % statements, 80,68 % branches, 92,21 % functions y 93,03 % lines. Reporte en temporal, sin sobrescribir `frontend/coverage`.
- `pnpm run typecheck:e2e`: pasa. `pnpm run check:ui`: 262 ficheros, 21 reglas, sin incidencias. `pnpm run build`: pasa con warnings ya existentes de budgets del bundle inicial y CSS; no se modificaron umbrales.
- E2E: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome tests/e2e/full-stack/ai-action-assistant.spec.ts --grep 'lote revisable|resuelve y edita un evento propio|evento obsoleto no pisa|cambio del hogar invalida'` — 8/8 en Chromium escritorio y Chrome móvil; servidor/API reales, SQLite aislado y proveedor determinista. Incluye matriz de viewports/breakpoints, foco, teclado, escape, scroll, rechazo/cierre sin escrituras, confirmación, recarga, replay, stale y cambio de hogar.
- E2E adicional tras instrumentar labels y targets del editor: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=mobile-chrome tests/e2e/full-stack/ai-action-assistant.spec.ts --grep 'resuelve y edita un evento propio'` — 1/1. Fecha/notas tienen nombre accesible; controles visibles del editor miden ≥44×44 px.
- Capturas sintéticas inspeccionadas: `D:\projects\MiCocinAI\.e2e-screenshots\assistant-calendar-update-20261016-final\chromium\calendar-update-review.png`, `...\chromium\calendar-update-confirm.png`, `...\chromium\calendar-update-saved.png`, y equivalentes `mobile-chrome\calendar-update-review-fields-mobile.png`, `...\calendar-update-confirm.png`, `...\calendar-update-saved.png`. El directorio está ignorado por Git; fixtures sin PII/secrets.
- Limitaciones: IA determinista simulada; no smoke de Ollama/proveedor real ni micrófono, y no se cierra aquí la auditoría visual global del shell. Esos puntos siguen abiertos en la aceptación global, no se simulan ni se declaran cubiertos por esta unidad.
