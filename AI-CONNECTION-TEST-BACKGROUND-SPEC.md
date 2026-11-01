# Prueba de conexión IA en background

**Estado:** implementación verificada localmente; PR #64 sigue Draft a la espera de CI.
**Base:** `origin/master` (`c260b21786e2385a857400c3bbc5cdc3d646bc5f`), rama `fix/webapi-background-connection-test`.
**Alcance:** prueba de conexión de proveedor y diagnóstico copiable de trabajos IA en la cola. No modificar el repositorio WebAPI ni el resto de transportes de generación.

## Fuente vigente y hallazgos

- `AI-PROVIDER-SETTINGS-SPEC.md` y el código confirman que la prueba guardada devuelve `202`, persiste `testing` y continúa desacoplada de la pestaña. Cerrar/recargar la web no cancela esa tarea.
- `server/src/utils/ai-client.ts` envía la prueba a `/v1/chat/completions` de forma síncrona con el timeout de proveedor; el default es 30 s (`server/src/utils/ai-timeout.ts`).
- `server/src/utils/ticket-queue.ts` vuelve a ejecutar fallos hasta `retry_attempts + 1` veces. Las capturas muestran 4/4 intentos y cinco sesiones WebAPI de ~29,8–30 s; el log de WebAPI registra `request_cancelled`, HTTP 499 y cierre del cliente mientras esperaba respuesta. El corte de HogarIA a 30 s es la causa más probable, no una certeza absoluta: un proxy con el mismo límite también podría cortar la conexión.
- `INPUT_EXPIRED` ocurre después: el job genérico conserva su closure solo en RAM, así que no puede reintentarse tras su ventana o reinicio.
- El contrato WebAPI local admite `POST /v1/responses` con `background: true`, devuelve `id`/`status` y permite consultar `GET /v1/responses/:id`; el proceso sigue ejecutándose al desconectar el POST. Su cancelación explícita usa `POST /v1/responses/:id/cancel`.
- La Responses API usa `input` y `text.format` para JSON Schema; no es un flag intercambiable con `/chat/completions`. La mayoría de proveedores personalizados puede no implementarla.

## Decisiones

1. Una acción de probar conexión equivale a **un solo intento de proveedor**, sin reintentos automáticos. Un fallo puede volver a probarse con una nueva acción desde el proveedor.
2. Para probar, HogarIA negocia Responses en background primero; solo usa Chat Completions si recibe un rechazo explícito que demuestra que Responses/background no está soportado (p. ej. ruta 404/405/501 o error de validación inequívoco). No hace fallback tras timeout, desconexión, 5xx ni respuesta ambigua: podría duplicar una ejecución aceptada. Enviar `Idempotency-Key: hogaria-connection-test-<jobId>`; cada nueva acción tiene un `jobId` distinto.
3. Tras aceptar el background, consultar estados `queued`/`in_progress` con backoff hasta un estado terminal. El límite total de la prueba será `max(timeout configurado, 120 s)`; 120 s es una ventana mínima, no un cap de producto, alineada con el timeout de ejecución registrado por WebAPI. El lease de cola debe cubrir esa ventana más el margen actual. Cada petición HTTP individual conserva timeout técnico acotado.
4. Si la persona cancela explícitamente el job y ya hay `response_id`, intentar cancelarlo en el proveedor. Cerrar/recargar el navegador no dispara cancelación: el estado guardado sigue consultándose.
5. Diagnóstico copiable por job visible en la cola, con ID local, tipo, estado, intentos, timestamps/código seguro y, cuando exista, protocolo, HTTP status y `response_id` del proveedor. Nunca copiar ni persistir API keys, URLs, prompts, adjuntos, respuestas ni cuerpos de error del proveedor. El ID del proveedor sirve para correlacionar el incidente en WebAPI.
6. El test no guardado conserva la privacidad actual: no se persisten sus credenciales ni payload. Se reutiliza el protocolo nuevo; no se añade un segundo mecanismo de almacenamiento para el formulario.

## Criterios de aceptación

### Transporte y ejecución única

- [x] Una prueba inicia un solo intento de proveedor, incluso con `retry_attempts > 0`; ningún reintento automático genera ejecuciones/costes repetidos. Cubierto con tests de cola y rutas.
- [x] El POST Responses usa `background: true`, JSON Schema estricto en `text.format`, autorización actual y un identificador de idempotencia seguro para correlación; el cuerpo no incluye parámetros nulos ni configuración irrelevante. Cubierto con HTTP mocks locales.
- [x] La respuesta inicial terminal se procesa sin polling; estados `queued`/`in_progress` se consultan hasta `completed` y se valida el texto de salida con el mismo `testAnswerSchema`; `failed`, `incomplete`, `cancelled`, malformado y deadline producen resultado fallido seguro. Cubierto con tests de transporte.
- [x] Extraer salida de `output[].content[]` (`type: output_text`); nunca asumir `choices` o `output_text` de raíz en Responses.
- [x] Proveedor Chat Completions-only cae al endpoint actual solo ante rechazo inequívoco de soporte; errores ambiguos, autenticación, rate limit y 5xx no reenvían generación.
- [x] Timeout total mínimo 120 s y lease cubren prueba lenta; timeout configurado superior sigue respetándose sin máximo de producto (el único límite es el máximo técnico del timer de Node).
- [x] Cierre/recarga de navegador no cancela ni duplica la prueba guardada; la UI observa estado persistido. Cancelación explícita cancela también el Responses aceptado, si el proveedor admite cancelación. Cubierto con tests unitarios; E2E confirma cierre/recarga y una única llamada.
- [x] Probar formulario sin guardar no persiste clave ni payload sensible; éxito/error y ausencia de configuración guardada están cubiertos por tests de ruta. La prueba usa el transporte background, pero mantiene la respuesta síncrona al formulario.

### Diagnóstico seguro

- [x] DTO de cola expone únicamente metadatos allowlisted del job y proveedor necesarios para soporte; IDs tienen formato/longitud acotados.
- [x] Cada job visible puede copiar un diagnóstico solo de ese job; incluye correlación WebAPI cuando exista y nunca contiene URL, credencial, prompt, archivo, salida o cuerpo externo.
- [x] Copia con `navigator.clipboard` maneja permiso/fallo con confirmación accesible; botones tienen nombre accesible, teclado y target táctil.
- [x] Pruebas verifican redacción/ausencia de secretos y que el contenido de un job no se mezcla con otros; i18n ES/EN.

### Evidencia y entrega

- [x] TDD: regresión que muestra el límite/reintentos, estados Responses terminales y compatibilidad/fallback con mocks HTTP locales; no llamar WebAPI/LAN ni proveedor real.
- [x] Rutas/API y migración probadas en SQLite temporal; no tocar DB o proceso habitual.
- [x] Playwright real app/API aislada: PC y móvil, clipboard aislado, cerrar/recargar vista durante test sin cancelarlo, teclado, accesibilidad y breakpoints aplicables; capturas sintéticas bajo `.e2e-screenshots/ai-connection-test/`.
- [x] Coverage >=70 % en todas las métricas: servidor 89,44/81,70/95,40/92,44 % (statements/branches/functions/lines); cliente 90,54/80,98/91,84/93,15 %. Playwright mide target táctil >=44 px y altura entre controles equivalentes con tolerancia <=1 CSS px.
- [x] Registrar comandos/resultados y limitaciones; evidencia detallada abajo.
- [x] PR #64 permanece Draft; no se modificó el estado de otros PRs ni se mergeó.

## Evidencia local

- `pnpm --filter @hogaria/server exec vitest run src/utils/ai-client.spec.ts src/utils/ai-queue.spec.ts src/utils/ai-timeout.spec.ts src/routes/ai.routes.spec.ts src/routes/ai-queue.routes.spec.ts src/config/database.spec.ts`: 6 archivos, 214 tests aprobados.
- `pnpm --filter @hogaria/server run test:coverage`: 123 archivos aprobados, 2.144 tests aprobados y 1 omitido; cobertura 89,44/81,70/95,40/92,44 %.
- Un primer hook `pre-push` local tuvo timeouts transitorios en dos pruebas de SQLite no relacionadas; la repetición `DATABASE_PATH=:memory: pnpm run test:server` pasó: 123 archivos, 2.144 aprobados y 1 omitido.
- `pnpm run test:client`: 1.778 tests aprobados; cobertura 90,54/80,98/91,84/93,15 %.
- `pnpm --filter @hogaria/server run build`, `pnpm run typecheck:e2e`, `pnpm run check:ui` (271 archivos/21 reglas) y `pnpm run test:config` (118 tests) aprobados.
- `pnpm run test:e2e -- --project=chromium --project=mobile-chrome --grep "one saved AI test|copia solo el diagnóstico"`: 4 E2E aprobados sobre app/API aislada; sin proveedor real. Incluye cierre/reapertura, una sola llamada, polling y copia acotada al job.
- El primer CI detectó una fixture full-stack que aún simulaba solo Chat Completions; se actualizó al contrato Responses background y `pnpm run test:e2e:full-stack -- --project=chromium --project=mobile-chrome --grep "keeps a saved connection test running"` pasó 2/2 en el build de producción.
- La suite local completa `ai-config.spec.ts` mostró 54/56 aprobados; los dos fallos eran el mismo selector estricto al conservar dos toasts de validación idénticos. Se cambió a verificar ambos; el caso pasó en Chromium y móvil (2/2).
- Playwright guardó capturas desktop/móvil de prueba en curso y cola bajo `.e2e-screenshots/ai-connection-test/`.
- Limitación local: `pnpm run lint` no puede ejecutar `ng lint`, porque el builder `@angular-eslint/builder:lint` no está declarado/instalado en el workspace. `check:ui`, TypeScript, tests y build sí pasan; no se añadió una dependencia ajena al alcance.
- CI run `41323420464` detectó un E2E de calendario preexistente que esperaba `date=2026-11-01` justo el 1 de noviembre, aunque la ruta omite intencionadamente el parámetro cuando la fecha seleccionada es hoy. Se ajustó solo esa expectativa; el test aislado pasa 1/1 y CI post-corrección queda pendiente. `calendar-google-like-ui.spec.ts` está fuera de la implementación AI.

## Desviación / pendiente

Esta spec no modifica WebAPI. El soporte de Responses/background se consume como capacidad del proveedor y se degrada de forma conservadora cuando el endpoint no existe. Si el contrato local de WebAPI difiere de las pruebas sintéticas, registrar la discrepancia aquí antes de cambiar alcance.
