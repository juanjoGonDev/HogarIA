# Recuperación de trabajos IA bloqueados

**Estado:** PR #70 Ready (mantener este estado por instrucción explícita del usuario); esta investigación adicional sigue en curso y cada nuevo commit debe pasar CI.
**Base:** origin/master (b7a754e8bbcc9524d5d2d08d0197101abc46e635).
**Rama:** fix/ai-queue-stale-job-recovery.
**Alcance:** evitar que excepciones inesperadas o leases vencidas dejen jobs IA en running, bloqueen concurrencia o dejen el test de proveedor en testing. No cambiar protocolos ni degradar Responses background.

## Evidencia vigente

- server/src/utils/ticket-queue.ts:lanzar invoca correr(...).finally(...) sin capturar rechazos.
- correr consulta DB y metadata antes del try; la preparación del recibo y el preflight genérico también tienen operaciones previas al try.
- El bucle periódico reconcilia jobs encolados pero no recupera running con lease_until vencida.
- El job diagnosticado se quedó running, sin eventos de proveedor y sin petición /v1/* en WebApi. La causa inicial exacta ya no se puede reconstruir: el rechazo original no se persistía.
- Evidencia más reciente aportada por el usuario: un intento termina con `providerTransport=responses_background`, HTTP 400 y 167 ms. Es una respuesta rápida del servicio, no un corte a los 30 s; el cuerpo del proveedor no se copia por privacidad.
- El transporte background reporta el error HTTP sanitizado y el catch de `pingDeConexionTransport` vuelve a escribir un diagnóstico parcial con `providerResponseId=null` y sin `providerErrorType/code/param`; `persistAiProviderDiagnostic` reemplaza los campos y borra el detalle ya recogido.
- La prueba de conexión guardada responde 202 y su resultado se lee por polling. El test real existente aún espera 200 y resultado inmediato, así que no valida el contrato actual.
- El smoke Chromium local también falló con HTTP 400 antes de egress: el proxy aislado validaba `input` solo como array y rechazaba el `input` string válido de la prueba de conexión. Corregido: el proxy acepta ambas formas y reenvía el cuerpo original.
- `improve-recipe` y `replace-meal` usan `callAI` (job del servidor y Responses background); la búsqueda de imágenes usa la cola durable y Wikimedia Commons, sin llamada de modelo. El smoke live anterior no tenía cobertura explícita de esos tres workflows.
- Una conexión real posterior (Chromium + WebApi local, `gpt-5`) fue aceptada en background, pero falló tras 163.6 s: WebApi registró `validated_output_timeout`/504 e `incomplete`; HIA recibió una respuesta de creación HTTP 200, que no equivale a respuesta del modelo completada. La sesión `resp_6c4dbc29011d42ccad68ee4727283582` contiene un `POST /backend-api/f/conversation` HTTP 200, 16 bloques de stream, 0 solicitudes terminales y `progress:0`; luego `network_loading_failed`/`ERR_ABORTED`, un refresh y solo frames WebSocket, sin `/conversation` ni `/conversation/resume`. El watchdog terminó con 120 s sin actividad útil. Tres sesiones reales vecinas con `gpt-5` sí completaron en 3.5–15 s, lo que descarta un fallo global del modelo/credencial, pero no garantiza estabilidad.
- Smoke aislado reciente: la prueba de conexión real completó una petición Responses background y volvió `success`; el flujo real de planificación de comidas no llegó a WebApi: el proxy de seguridad del smoke rechazó el contexto sintético antes de egress con `meal_context_contract`/HTTP 400. La fila `ai_jobs` terminó `failed` en 23 ms, pero el POST del navegador quedó esperando porque la cola conserva su promesa durante la ventana de reintento manual aunque el error ya sea terminal.
- La clasificación actual de `AiCallError` marca HTTP 400 y respuestas malformadas como no reintentables, pero `correrTrabajoGenerico` aún las retiene en la ventana manual de cinco minutos. Esto impide que la ruta HTTP responda con el error terminal y deja la interfaz de la acción girando; el estado de cola puede mostrar `failed` en paralelo.
- La evidencia de la sesión activa WebApi apunta a recuperación incompleta en `src/providers/chatgpt/cdp-stream-observer.ts` y `src/providers/chatgpt/flows/stream-reply-flow.ts`: `ERR_ABORTED` se trata como cancelación esperada aunque ocurra antes de que la recuperación esté activa; tras refresh no hubo nueva solicitud que completara el turno ya enviado. El timeout se emitió correctamente; no es un timeout del navegador HogarIA ni un 400 de payload.
- Auditoría del contrato local WebApi encontró incompatibilidades adicionales en HogarIA: `input[]` solo admite rol `user`; los mensajes necesitan `content[]` con `input_text`; `input_image.detail` no está permitido; `instructions` tiene máximo 4.000 caracteres. La ruta `/api/ai/assistant/proposals` compone aproximadamente 4.395 caracteres estáticos/contextuales y puede fallar antes de ejecutar. También se propaga `role: assistant`, incompatible con el endpoint, aunque las llamadas actuales inspeccionadas no lo generan.
- Revisión completa de `AiJobKind` (11 tipos) encontró que los smokes live cubren el plan semanal de comidas (`weekly_plan`/`household_meal_proposal`), pero no la herramienta distinta de plano del hogar (`household_plan`, `POST /api/household/plan/proposal`). Se añade un modo live dedicado de una sola respuesta con Chromium, WebApi/modelo real y DB temporal; valida la propuesta sin guardar el plano confirmado.
- Contrato vigente AI-REQUESTS-BACKGROUND-SPEC.md: toda llamada de modelo queda bajo job background; recarga/desconexión no cancela; no reejecutar trabajos con resultado ambiguo, para evitar duplicar coste o efectos.

## Decisiones

1. Capturar toda excepción que escape del worker; persistir fallo terminal usando compare-and-set por job id + running + claim_generation. No incluir mensajes/cuerpos/URLs/credenciales en DB o logs.
2. Clasificar los escapes como WORKER_EXCEPTION, con etapa segura y diagnóstico accionable; limpiar lease. Asentar la promesa en memoria una sola vez.
3. Barrer periódicamente leases vencidas o ausentes. Marcarlas failed con WORKER_STALLED; nunca reencolar automáticamente, pues no se sabe si proveedor ya aceptó la ejecución. Abortarla si sigue viva y liberar estado dependiente (receipt/config).
4. Mantener fencing por claim_generation: callbacks tardíos no pueden modificar un job cancelado, recuperado o reclamado de nuevo.
5. Validar en Playwright contra HogarIA aislada en DB temporal y WebApi local real. Sin mocks en esta prueba opt-in; sin escribir en DB habitual. El caso mínimo real reproduce el test de conexión. Luego recorrer matriz de herramientas AI que la instalación admita, de forma secuencial, con inputs sintéticos y sin aplicar acciones no confirmadas. La búsqueda de imágenes que no usa un modelo se registra como integración real separada.
6. Un diagnóstico posterior nunca puede borrar campos seguros ya obtenidos para el mismo intento; la cola expone códigos allowlist (no el texto/body del proveedor) para distinguir incompatibilidad de errores de red.
7. Ajustar el serializador de HogarIA al contrato verificado de WebApi: `input[]` solo con `user`, contenido siempre como array de tipos aceptados, sin `detail` no soportado y `instructions` <=4.000. Una entrada incompatible debe fallar localmente con diagnóstico seguro, no producir un 400 opaco.
8. El smoke conexión no considera el HTTP 200 de aceptación como éxito: exige estado terminal persistido. Un fallo del WebApi durante el stream se registra como limitación externa separada y no se oculta con reintentos ambiguos.
9. Al agotarse el presupuesto de intentos, los errores HTTP 4xx permanentes del proveedor deben rechazar la espera de la ruta inmediatamente y liberar el runtime; fallos transitorios y `BAD_JSON` conservan la ventana de reintento manual existente. Así, ningún rechazo permanente deja una solicitud HTTP colgada.
10. El proxy del smoke no guarda cuerpos ni prompts. Su rechazo de contrato debe indicar una causa allowlisted suficientemente específica para distinguir una fixture de test inválida de un rechazo de WebApi; corregir el fixture/constructor con evidencia, sin desactivar las validaciones de privacidad ni schema.
11. Para probar una compilación de WebApi parcheada sin interrumpir el servicio local habitual, el harness admite `HOGARIA_AI_REAL_SMOKE_WEB_API_ORIGIN` solo como `http://127.0.0.1:<puerto>`; por defecto conserva `http://127.0.0.1:3001`. El destino se valida antes de obtener un token y nunca se hereda al servidor HogarIA ni al navegador de Playwright.

## Criterios de aceptación

### Cola y recuperación

- [x] Una excepción de preflight antes de provider termina job y promesa; lease queda limpia; no hace request externo duplicado.
- [x] Un HTTP 400 de creación o polling preserva tipo/código/parámetro allowlist, status, etapa y response ID cuando exista; no filtra mensaje/body del proveedor.
- [x] Excepción inesperada en jobs genéricos y receipts termina fila mediante CAS, actualiza estado dependiente y no filtra datos sensibles.
- [x] El barrido detecta leases vencidas y ausentes, libera concurrencia y actualiza receipt/config asociada; no toca jobs con lease futura.
- [x] Una recuperación no reintenta automáticamente ni pisa estados/cambios de una generación más nueva; aborto/resolución repetidos son idempotentes.
- [x] Un HTTP 4xx permanente del proveedor no mantiene abierto el POST hasta vencer la ventana manual; HTTP queda resuelto con error seguro y el job no figura como reintentable. Fallos transitorios y `BAD_JSON` conservan la semántica manual existente.
- [x] Tests cubren estado terminal previo, claim_generation nuevo, cancelación/resultado tardío, disponibilidad de provider y ausencia de llamadas duplicadas.
- [x] Contrato WebApi: serializador no envía roles `system`/`assistant` en `input`, no emite campos de imagen rechazados y nunca supera 4.000 caracteres en `instructions`; tests TDD demuestran compatibilidad antes de usar el proveedor real.

### Navegador + proveedor real, aislados

- [x] Ejecutar Playwright real contra stack local aislado, sin mock de provider, con WebApi y sesión/modelo reales. Un POST de test de conexión devuelve 202; al cerrar/recargar la vista, la cola y configuración siguen mostrando el mismo job activo hasta terminal.
- [x] El smoke real puede apuntar a un puerto loopback alternativo para WebApi parcheada; el default permanece `:3001`, y destinos no loopback, URL con credenciales o path/query se rechazan antes de tocar tokens.
- [x] Confirmar una sola ejecución de connection test, diagnóstico final legible, concurrencia liberada y ningún job colgado.
- [x] Ejecutar secuencialmente la matriz live de workflows habilitados (recetas, múltiples recetas, mejora, reemplazo, recomendaciones, planificación, estimación de caducidad, foto de compra, lectura de ticket sintético, plan de hogar, asistente y búsqueda real de imágenes). Cada resultado debe ser terminal/usable; se documentan rutas que requieren fixture o no son llamadas LLM.
- [x] Ejecutar un caso live dedicado `household_plan` con propuesta temporal validada y una sola llamada Responses background; no confirmar ni persistir el plano sugerido.
- [x] Añadir smoke aislado explícito para mejora, reemplazo y Commons real; exigir 2 completions Responses background con schemas esperados, imagen Commons terminal con candidatos y cero mutaciones no confirmadas.
- [x] El smoke real de planificación usa un contexto válido según el constructor real y alcanza el WebApi/modelo; no vale la respuesta 400 generada localmente por el proxy del harness.
- [x] Un rechazo local de preferencias de comidas identifica solo campo/causa allowlist (shape, alergias estrictas, gustos, desagrados), sin registrar valores del perfil.
- [x] El proxy valida los dos perfiles sintéticos como conjunto; los alias `P1`/`P2` no se ligan a una identidad ni a un orden SQL sin contrato.
- [x] La matriz real de acciones relativas calcula `referenceDate` y las fechas esperadas desde el día local del navegador, igual que el cliente; no conserva fechas históricas fijas que falseen la validación live.
- [x] Si una propuesta real no coincide, el último hito del smoke informa el ordinal y el tipo allowlist discrepante, nunca texto/payload del proveedor.
- [x] Las llamadas live usan solamente DB temporal/usuario/hogar semilla; presupuesto acotado, proveedor y servicios preexistentes no reiniciados. Token desde env/almacén, jamás persistido o mostrado.
- [x] Guardar evidencia sintética desktop/móvil solo si se cambia UI; no guardar screenshots/logs/traces con datos personales o secretos.

### Entrega

- [x] Regresión TDD falla antes y pasa después.
- [x] Suite focal server, cobertura >=70 % en métricas aplicables, suite requerida, build y typecheck pasan.
- [x] PR único desde origin/master; cambios de código CI verdes; PR se mantuvo Draft durante la implementación y no se mergeó.

## Evidencia de implementación

- TDD smoke conexión: `node --test --experimental-test-isolation=none --test-name-pattern='background Responses proxy validates' scripts/ai-live-smoke-safety.test.mjs` primero falló en el nuevo caso string (`400` del proxy), tras aceptar el string no vacío pasó. El proxy valida el formato, pero reenvía el cuerpo original sin alterarlo.
- Suite del arnés: `node --test --experimental-test-isolation=none scripts/ai-live-smoke-safety.test.mjs scripts/ai-live-smoke-runner-control.test.mjs` pasó 48/48 antes de añadir el caso string; se repetirá al cerrar cambios.
- Evidencia de smoke connection-only anterior: una corrida real respondió HTTP 200 en 18.131 ms y verificó el badge `OK`; esta evidencia queda supersedida como garantía de estabilidad por la corrida posterior que alcanzó timeout de modelo. No declarar conexión arreglada con el solo 202/200 de aceptación.
- Corrida real actual connection-only (Chromium, WebApi local `127.0.0.1:3001`, sesión/modelo reales `gpt-5`, SQLite temporal y token efímero, sin mock): resultado fallido terminal. El dashboard WebApi correlacionó el response ID con `validated_output_timeout`, 504, 120 s de inactividad, 0 eventos terminales. Evidencia recuperada mediante navegador real, con logs/modelo/códigos allowlist; sin leer ni registrar tokens ni el contenido del modelo.
- Verificación real posterior (Chromium, WebApi local, modelo `gpt-5`, sin mocks): `connection-only` sí pasó en 15.917 ms, cerrando y reabriendo la pestaña; un job, un intento, `responses_background`, HTTP 200 y badge `OK`. El modo nuevo `household_plan` pasó en 17.967 ms con schema estricto, un job y propuesta no confirmada; la lectura posterior siguió `{version:0, plan:null}`.
- El smoke live de mejora/reemplazo + Commons llegó al provider para dos requests. La mejora terminó 200; el reemplazo fue rechazado por la API al no completar WebApi la segunda respuesta. Sesión WebApi correlacionada: aceptación `/backend-api/f/conversation` HTTP 200, salida incompleta, `validated_output_timeout`/504 tras ~129 s de inactividad, `validationStatus=incomplete`, 0 requests terminales; el stream terminó en `network_loading_failed`/`stream_aborted_for_reload`, sin llamada `/conversation/resume`. Es un fallo real interno de WebApi, no timeout HTTP de 30 s ni un rechazo del contrato local de HogarIA. No se reintentó para evitar coste/duplicación; el smoke sigue fallando hasta resolver la recuperación/stream de WebApi.
- Primer intento del nuevo smoke `household_plan` tuvo 0 llamadas porque el `--grep` no coincidía con el nombre del test; corregido el título del test y repetido con una llamada real exitosa. Ninguna llamada de proveedor se contó como éxito por aceptación HTTP solamente.
- No se cambia el comportamiento de la imagen Commons para otros tests: su fixture se quita solo en el nuevo smoke opt-in live y la búsqueda quedará separada del presupuesto de completions de WebApi.
- Hallazgo al reanudar la matriz real: el test de asistente enviaba `referenceDate: 2026-10-17`, pero mantenía una aserción hardcodeada para `2026-10-18`; debe usar fecha local del navegador (como `toDayKey`) y verificar mañana derivado, evitando depender del calendario de octubre.
- Corrida actual assistant-only en Chromium + WebApi/modelo reales: 8 completions Responses background devolvieron HTTP 200; una acción no coincidió y el test paró antes de completar 10 escenarios. El hito sanitizado omitió ordinal, así que se añade identificación segura del caso antes de repetir llamadas.
- Corrida actual household-meal: WebApi recibió 0 solicitudes; proxy local rechazó el contexto sintético antes de egress con `meal_context_member_preferences`. No hubo completion ni coste; falta distinguir qué campo de preferencia discrepa sin exponer el valor.
- Fuente de orden: `GET /api/household` consulta miembros sin `ORDER BY`; el smoke pedía tofu a índice 0 y pollo a índice 1, pero el servidor asigna alias desde el orden recibido. Por tanto, el fixture de preferencias de planificación debe validar el par de perfiles, no asumir qué alias ocupa cada miembro.

## Cierre de verificación (2026-11-03)

- La prueba real más reciente del test de conexión pasó con Chromium, SQLite temporal, WebApi local `127.0.0.1:3001` y `gpt-5`, sin mocks: POST `202` con estado `testing`; se cerró la pestaña, se reabrió y el polling encontró el mismo job terminal `done`, un intento, `responses_background`, HTTP `200`, latencia 15.965 s y badge `OK`.
- Se guardaron capturas sintéticas de escritorio y móvil en `.e2e-screenshots/ai-connection-47216-1793677006792/`; contienen solo el usuario/configuración sintéticos de la corrida aislada.
- Matriz de navegador real sin mocks: default 9/9 completions; `WORKFLOWS_ONLY` 2/2 completions para mejora/reemplazo y búsqueda de imágenes Commons terminal; `HOUSEHOLD_PLAN_ONLY` 1/1 sin persistir; `HOUSEHOLD_MEAL` 1/1 con contexto válido; `ASSISTANT_ONLY` 10/10 completions que ejercitaron los 13 tipos de herramienta de propuesta. Las propuestas del asistente se validaron sin aplicar acciones no confirmadas; el snapshot de la DB temporal permaneció intacto. La foto de ticket fue validada en una corrida aislada, sin guardar imagen ni texto personal en Git/logs.
- `pnpm test`: config 146/146; frontend 1.801/1.801, cobertura 90,56 % statements / 80,99 % branches / 91,88 % funcs / 93,17 % lines; server 2.185 pass, 1 skipped. `pnpm --filter @hogaria/server run test:coverage`: 89,53 % / 81,93 % / 95,64 % / 92,41 % (statements / branches / funcs / lines). `pnpm build` y `pnpm typecheck:e2e` pasan.
- `pnpm lint` no se puede ejecutar en este checkout: Angular CLI falla porque no está instalado/declarado `@angular-eslint/builder`; `check:ui` sí pasa (276 ficheros, 21 reglas). No se alteraron dependencias ajenas a esta corrección. El workflow de CI actual no incluye `pnpm lint`; sus gates relevantes se validarán tras publicar este commit.
- La recuperación de stream de la PR WebApi #176 no se ha probado con un proveedor real usando la imagen de esa rama: el contenedor aislado de esa PR chocó con el reto de autenticación del proveedor. La prueba HIA usa el servicio WebApi local preexistente sin reiniciarlo. Mantener #176 en Draft hasta cerrar esa limitación y los gates.
- Revisión independiente encontró que el resumen de los smokes fijaba el puerto `:3001` aunque el destino loopback alternativo estuviera configurado. Se corrigió usando el origen validado; TDD falló antes y ahora pasa para los coordinadores IA y `household-meal` (puertos sintéticos `3456`/`3457`).

## Corrección de CI (2026-11-03)

- El CI inicial `41574088977` tuvo un único fallo ajeno a la cola IA: `calendar-google-like-ui.spec.ts` asumía que `date=2026-11-03` se conservaría en URL. Ese día coincidía con “hoy” en el runner; el calendario omite correctamente `date` para la fecha actual. El resto de E2E shards, tests server, typecheck, build y smoke de contenedores pasaron.
- La regresión del test se reprodujo con el runner aislado local: se esperaba `2026-11-03`, pero el estado canónico era `date=null`. El test ahora elige el 3 de octubre del año anterior desde la fecha local del navegador y mantiene las aserciones de URL, vista, cabecera e historial atrás/adelante.
- Verificación posterior en Chromium con SQLite temporal: el test focal pasó 1/1; `pnpm typecheck:e2e` pasó. En ese momento, el CI completo de la nueva revisión seguía pendiente y el PR se mantuvo Draft.
- CI run `1089` pasó todos los jobs en el commit `6238499660a3fa99996aa706d64065ba2d694cae`, incluidos los cuatro shards E2E, full-stack E2E, Type Check, Server Tests, Production Build y ambos container smokes. El ajuste documentado aquí se publica como cambio solo de spec y su nuevo head también se validará antes de marcar el PR Ready.

## Investigación adicional: test de conexión atascado (2026-11-03)

- Reproducción en HogarIA real desde Chromium: el job `h2CZbMkrbSu1MQpdjva32` fue aceptado como `connection_test`, reclamado una vez (`claim_generation=1`) y terminó `failed / WORKER_STALLED` tras expirar el lease; `provider_transport`, `provider_http_status`, `provider_response_id` y `elapsed_ms` quedaron vacíos.
- Consulta correlacionada de WebApi: entre 09:34 y 09:41 UTC no hubo `ai_executions` ni eventos `/v1/responses` para ese intento. La sesión `resp_f3cccf7cbac04aca996357a1a7367a00` es una prueba anterior (03:36 UTC), no debe usarse como evidencia del job anterior.
- Evidencia disponible no localiza aún la fase del bloqueo. El callback de diagnóstico de `ai-client.ts` captura errores sin señalarlos y `persistAiProviderDiagnostic` no verifica si el `UPDATE` afectó la fila. Además, el job conserva solo el último diagnóstico del proveedor, no una traza de etapas del worker; tras reiniciar/expirar, el motivo queda opaco.
- La prueba fue hecha contra el servicio local ya existente; no se modificó ni reinició. Los próximos smokes deben usar DB temporal y limpiar su propio stack.

### Decisiones adicionales

12. Persistir una traza breve y ordenada por job/claim generation para milestones del worker y transporte. Solo códigos/etapas allowlist; nunca prompt, cuerpo, archivo, URL sensible, credencial ni mensaje bruto del error. Rechazar escrituras tardías de generaciones anteriores.
13. Un callback de diagnóstico que no actualice el job debe dejar una señal segura y medible, sin interrumpir la llamada al proveedor.
14. La acción «Copiar diagnóstico» debe incluir la traza segura del job que el usuario seleccionó, como eventos con timestamp/etapa/resultado y no una volcada global de logs.

### Criterios añadidos — diagnóstico de conexión

- [x] Un job guarda eventos `claimed`, `runtime_started`, `provider_submitting`, respuesta/progreso y estado terminal con fencing por job/claim; la consulta por usuario/config nunca mezcla jobs.
- [x] `WORKER_STALLED` conserva la última etapa alcanzada; el copy diagnostic explica si el worker no llegó a ejecutar el runtime o se detuvo antes/después del envío, sin inferir etapas ausentes.
- [x] Fallo o `UPDATE.changes=0` al escribir diagnóstico queda observable con código seguro; no se filtra texto/cuerpo del proveedor ni se oculta silenciosamente.
- [x] Tests verifican orden, redacción, límite de eventos, aislamiento entre jobs y fencing de callbacks tardíos; prueban fallos pre-provider sin llamada duplicada.
- [ ] Chromium contra stack aislado, SQLite temporal y WebApi/modelo real repite una conexión guardada: `202`, job único, trace visible tras cerrar/reabrir, respuesta terminal real y concurrencia liberada.

## Reintento adicional del usuario (2026-11-03)

- La consulta readonly de `server/data/hogaria.sqlite` confirma que los tres últimos `connection_test` conocidos (07:37, 08:58 y 09:34 UTC) acabaron `failed / WORKER_STALLED`; el más reciente sigue siendo `h2CZbMkrbSu1MQpdjva32`, no hay job posterior en esa DB.
- `mCanvB_wONiILOEQdMz19` tuvo `attempts=1/1`, timeout de config 300.000 ms, y pasó de `created_at=08:58:33` a `finished_at=09:04:36` (363 s); el lease efectivo es timeout + 60 s. `diagnostic_log=[]` y transporte/status/response ID nulos. Esto prueba expiración del lease, pero **no** que WebApi recibiera (ni que no recibiera) la petición; la causa del hang sigue sin determinar.
- El JS compilado local contiene el callback previo al `fetch`; en el código fuente, su `catch {}` vacío podía ocultar errores de persistencia. No es evidencia suficiente para atribuir el fallo a WebApi o a la clave.
- Se añadieron hitos trazados también al worker de tickets, códigos seguros de preflight, coalescencia de polls repetidos y anclas `worker_claimed`/`worker_started`/`runtime_started`/`provider_submitting` dentro del límite de 32 eventos. El detalle de ticket restringe jobs por tipo, dueño y hogar del recibo.
- Una revisión independiente detectó y se corrigió el reordenamiento de eventos al conservar anclas de una generación nueva; una regresión comprueba el orden entre dos `claim_generation`. El frontend también conserva `responses_tool_choice_unsupported` al copiar.
- La instrumentación aún no está en el servicio que produjo esos tres registros: para obtener la causa del próximo intento hay que ejecutar esta revisión del servidor y repetir una vez; no se hizo una petición real en esta sesión porque no hay configuración de smoke real declarada.

### Evidencia de esta revisión

- [x] La traza de connection test y ticket persiste fases con fencing por `claim_generation`; el caso de lease vencido retiene `runtime_started` y `worker_stalled`.
- [x] Error de escritura de diagnóstico y callback fallido dejan señales allowlist; SQL `changes=0` queda como `STALE_CLAIM`, sin mensaje privado.
- [x] Tests focales: 78/78; suite server: 2.188 passed, 1 skipped; coverage server: 89,48 % statements / 81,85 % branches / 95,67 % functions / 92,36 % lines; `tsc --noEmit` pasa.
- [x] Suite frontend: 1.805/1.805; coverage frontend: 90,58 % statements / 81,08 % branches / 91,89 % functions / 93,19 % lines; build Angular pasa.
- [x] UI sintética aislada en Chromium verificada a 1440×900 y 390×844: copiar diagnóstico anuncia éxito; no se leyó el clipboard. Capturas en `.playwright-mcp/page-2026-11-03T10-32-59-531Z.png` y `.playwright-mcp/page-2026-11-03T10-33-24-549Z.png`.
- [ ] Smoke nuevo con proveedor/WebApi real usando esta revisión: pendiente; la prueba sintética no demuestra conectividad real y no cuenta como éxito del proveedor.
