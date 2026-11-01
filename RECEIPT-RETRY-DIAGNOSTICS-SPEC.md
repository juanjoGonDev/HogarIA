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
- Afirmar el código/param exacto del último `HTTP 400`: el diagnóstico recibido no incluye el cuerpo ni el campo `param` del proveedor.

## Seguimiento: HTTP 400 y quitar de la cola

### Evidencia vigente

- El último intento terminó en `responses_background`, HTTP `400`, en `123 ms`; el servidor aún conserva solo el status y descarta el código/parámetro del error remoto.
- Antes de llamar al proveedor, el worker lee el fichero local y, si falta, termina como `FILE_MISSING`. Si existe, incluye la imagen como `input_image` o el PDF como `input_file` y adjunta `inventario.json` en la petición (`server/src/utils/ticket-queue.ts`). Por tanto, el dato aportado no apunta a que falte el fichero local; el proveedor todavía puede rechazar el formato o algún parámetro.
- La captura previa de configuración mostraba modelo `gpt-5` y temperatura `0.7`; el contrato añade `temperature` configurada al request aunque el modelo use reasoning por defecto. La guía oficial de GPT-5 indica retirar `temperature` y `top_p` cuando reasoning effort no es `none`: [GPT-5 API guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5). La guía de archivos confirma que Responses admite `file_data` y `.json`: [File inputs](https://developers.openai.com/api/docs/guides/file-inputs).
- La incompatibilidad de parámetros es hipótesis fuerte, no causa confirmada del intento ya terminado: falta el `code`/`param` que devolvió el proveedor.
- La implementación conserva `type`/`code`/`param` allowlisted también en errores HTTP de polling; normaliza los paths `input[n].content[n].file_data`/`image_url` a `input_file`/`input_image`, sin guardar texto remoto.
- Un 4xx permanente falla al primer intento; 408/409/425/429 y 5xx siguen siendo reintentables. El worker adjunta el fichero original y `inventario.json`.

### Decisiones

- Para los modelos GPT-5 con reasoning por defecto, omitir `temperature` y `top_p` del payload (salvo que el request solicite explícitamente `reasoning.effort: 'none'`). Mantener el request en background y preservar imagen/PDF, inventario y salida estructurada.
- Persistir y copiar solo `error.type`, `error.code` y `error.param` si pasan allowlist estricta. Nunca guardar ni devolver el mensaje/cuerpo remoto, porque puede repetir prompts, adjuntos, URLs o datos sensibles.
- Quitar una lectura de la cola debe ocultar solo su entrada terminal `failed`/`stopped`; conservar el ticket, trabajo y diagnóstico en su ficha. No reutilizar `DELETE /receipts/:id`, que borra el ticket.
- Rechazar quitar trabajos `queued`/`running`; al reintentar, limpiar la marca de ocultación para que vuelva a la cola.

### Criterios de aceptación

- [x] Los requests GPT-5 no envían `temperature`/`top_p` por defecto; tests verifican que sí adjuntan el ticket y el inventario y que los demás modelos conservan controles compatibles.
- [x] Para HTTP 400 de POST y polling se guardan/copían solo `type`/`code`/`param` validados; jamás mensaje/body remoto. Paths de adjunto se normalizan y la ficha explica rechazo de archivo y `unsupported_parameter` para `temperature`/`top_p`.
- [x] El botón accesible «Quitar de la cola» oculta trabajos `failed`/`stopped` y mantiene intactos ticket, líneas, ficha y diagnóstico.
- [x] El backend protege el scope usuario/hogar (incluido mismo usuario con otro hogar activo), devuelve 409 para trabajos activos, y reintentar restaura el trabajo en la cola.
- [x] Pruebas API/UI cubren migración desde BD existente, repetición, carrera con reintento, aislamiento, y no borrado del ticket; E2E sintético valida escritorio y móvil.
- [x] Coverage de todos los ficheros ejecutables afectados ≥70 % en statements/branches/functions/lines; server incluye test propio para el sanitizador de diagnósticos.
- [x] Build de producción, `check:ui`, `typecheck:e2e` y pruebas de configuración completados.
- [x] E2E sintético tras el último ajuste de foco en Chromium escritorio y Chrome móvil; capturas revisadas.
- [x] CI del commit funcional `61db37c` en PR #67: todos los jobs pasaron; el test de retry se hizo determinista después del primer CI.
- [ ] Lint local: scripts actuales no ejecutables en este checkout (`ng lint` requiere `@angular-eslint/builder`, no declarado/instalado; ESLint server rechaza `--ext` y no encuentra config flat). No se cambió tooling fuera del alcance.

### Plan de verificación

- [x] Unit/API con 400 sintético `unsupported_parameter` para `temperature`, 400 en polling y paths de adjuntos; ningún proveedor real.
- [x] Rutas/worker/SQLite temporal: dismiss terminal, 409 activo, 404 fuera de scope, ticket/job conservados y retry vuelve a mostrarlo.
- [x] `pnpm --filter @hogaria/server run test:coverage`: 2173 pasaron, 1 omitido; total 89.51/81.90/95.66/92.41 % (statements/branches/functions/lines). Nuevos `ai-provider-diagnostic.ts`: 100 % en las cuatro métricas.
- [x] `pnpm run test:client:coverage`: 1801/1801; global 90.58/81.03/91.88/93.19 %. Ficheros UI afectados: servicio 100/71.43/100/100 %, ficha 100/88.27/100/100 %, cola 92.31/76.92/95/92.31 %, modelo 100/80/100/100 %.
- [x] UI dirigida: 55/55; su comando con coverage específico devuelve código 1 solo porque el runner evalúa el gate global de 80 % usando únicamente tres specs. La suite completa de coverage pasa.
- [x] `pnpm run check:ui`, `pnpm run typecheck:e2e`, `pnpm run test:config` y `pnpm run build`.
- [x] `pnpm run test:e2e:full-stack -- --grep "quita un fallo de la cola sin borrar el ticket" --project=chromium --project=mobile-chrome`: 2/2; stack de producción con SQLite aislada y proveedor sintético.
- [x] GitHub CI del commit funcional `61db37c`: server tests, typecheck, build, smokes de imagen amd64/arm64, 4 shards E2E y full-stack E2E pasaron. El run previo falló solo por una aserción de estado `queued` transitorio; `test(queue): make provider retry test deterministic` lo corrigió.
- [x] `git diff --check`; ningún proveedor real ni datos de producción.
