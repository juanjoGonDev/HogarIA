# Diagnóstico de reintentos de lectura de tickets

## Objetivo

Explicar por qué falla un intento de lectura de ticket y permitir copiar únicamente el diagnóstico de ese trabajo, sin incluir datos del ticket, contenido del proveedor ni secretos.

## Evidencia vigente

- El `POST /api/receipts/:id/retry` devuelve `200` al volver a encolar el trabajo; no confirma que el siguiente intento haya terminado correctamente (`server/src/routes/receipts.routes.ts`).
- El worker ejecuta la lectura de forma persistente en segundo plano y guarda por intento etapa, transporte, HTTP status, duración e ID de respuesta validados (`server/src/utils/ticket-queue.ts`).
- Si falta el fichero, el worker persiste `FILE_MISSING`, no gasta los reintentos automáticos del proveedor y limpia los diagnósticos anteriores antes de reclamar un nuevo intento (`server/src/utils/ticket-queue.ts`).
- El GET de la ficha devuelve un DTO allowlisted del trabajo; no expone `error_detail` ni contenido arbitrario (`server/src/routes/receipts.routes.ts`).
- El log aportado confirma que el reintento se aceptó (`POST .../retry → 200`) y luego solo muestra consultas de estado. No contiene el error del worker/proveedor ni permite determinar la causa concreta.
- La ficha explica fallos conocidos y copia el diagnóstico de un único trabajo sin prompt, adjunto, URL, cuerpo de respuesta ni secretos (`frontend/src/app/features/receipts/receipt-detail.component.ts`).
- Playwright detectó errores intermitentes de carga/CORS en Safari/WebKit a través del servidor Angular de desarrollo. Por ello, esta prueba se ejecuta en el stack de producción aislado (build servido por Node con SQLite temporal); la prueba sintética pasó en escritorio Chrome, Chrome móvil y WebKit móvil.

## Decisiones

- Mantener el trabajo independiente de la pestaña y el sondeo persistente ya implementados; el botón de reintento informa de que se ha encolado, no de éxito del proveedor.
- Si `AiCallError.detail === 'FILE_MISSING'`, persistir el código de dominio `FILE_MISSING` y no consumir reintentos automáticos para ese fallo permanente.
- Exponer a la ficha solo metadatos de diagnóstico allowlisted. No devolver/copiar `error_detail` crudo, URL del proveedor, credenciales, prompt, fichero/adjunto, respuesta ni contenido del ticket.
- Presentar explicación localizada para ausencia del fichero, timeout y estados HTTP de autenticación, cuota o servidor; para causas no identificables, conservar un texto genérico y mostrar el diagnóstico seguro.
- Copiar el diagnóstico de un solo trabajo, incluyendo identificador, estado/intentos/código y metadatos seguros disponibles. Limpiar metadatos del intento previo al reclamar un nuevo intento.
- Ejecutar `receipt-queue-actions.spec.ts` contra el stack de producción aislado, no contra el proxy de desarrollo: allí se reprodujeron errores intermitentes CORS/carga de recursos en WebKit y el stack de producción pasó en escritorio y móvil.

## Criterios de aceptación

- [x] El worker registra `FILE_MISSING` sin reintentar automáticamente; el ticket explica que hay que volver a subir el fichero.
- [x] Un nuevo intento empieza sin metadatos de diagnóstico del intento anterior, también si falla antes de contactar al proveedor.
- [x] El GET de detalle devuelve un DTO de trabajo con campos allowlisted y elimina del contrato público el detalle arbitrario de error.
- [x] El DTO mantiene el aislamiento por usuario/hogar y nunca expone diagnóstico de otro ticket.
- [x] La ficha explica fallos conocidos a partir de códigos/metadatos seguros y ofrece copiar solo el trabajo de ese ticket, con feedback accesible y español/inglés.
- [x] Las pruebas demuestran exclusión de secretos, URL, prompt, contenido/respuesta y detalles arbitrarios; cubren HTTP 401/429/5xx, ausencia de fichero, limpieza al reintentar y clipboard no disponible/rechazado.
- [x] Playwright sintético valida la acción en escritorio y móvil; se guardan capturas comparables sin datos personales.
- [x] No se llama un proveedor real ni se escribe en la base de datos/servidor de uso normal.

## Plan de verificación

- API/worker dirigido: `pnpm --filter @hogaria/server exec vitest run src/routes/receipts.routes.spec.ts src/utils/ai-queue.spec.ts --maxWorkers=1 --reporter=dot` — 64/64.
- UI dirigida: `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/receipts/receipt-detail.component.spec.ts --include=src/app/shared/components/receipts/receipt-queue.component.spec.ts --include=src/app/core/services/clipboard.service.spec.ts` — 46/46.
- Suite local: `pnpm run test` — config 120/120; frontend 1798/1798 (statements 90.59 %, ramas 81.03 %, funciones 91.90 %, líneas 93.20 %); server 2143/2143.
- Coverage server/CI: `pnpm --filter @hogaria/server run test:coverage` — 2143/2143 y gates por fichero ≥70 %; `ticket-queue.ts` 86.69/80.89/94.28/91.68 %; `receipts.routes.ts` 85.19/78.05/85.71/87.31 % (statements/branches/functions/lines).
- UI y tipos: `pnpm run check:ui` sin incidencias; `pnpm run typecheck:e2e` sin errores; `pnpm run build` correcto (con warnings Angular preexistentes de presupuesto/plantillas).
- Integración UI: `pnpm run test:e2e:full-stack -- --grep 'acciones reales del gestor de cola de tickets' --project=chromium --project=mobile-chrome` — 6/6; Node sirve build de producción, con SQLite aislada y proveedor sintético.
- Capturas sintéticas revisadas: `.e2e-screenshots/receipt-queue-actions-qa/receipt-diagnostic-chromium.png` y `receipt-diagnostic-mobile-chrome.png`; prueba adicional de la misma suite en WebKit móvil pasó, pero no se habilita WebKit en CI (allí solo se instala Chromium).
- `git diff --check` sin errores. No se ejecutó smoke de IA real ni se usaron datos de producción.

## Fuera de alcance

- Cambiar el transporte/background de solicitudes de IA, modificar otros flujos de IA o recuperar logs históricos que no se correlacionaron con este trabajo.
- Inferir una causa concreta del job aportado: el log compartido no incluye evidencia suficiente.
