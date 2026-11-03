# Recuperación de trabajos IA bloqueados

**Estado:** Draft PR; diagnóstico e implementación en curso.
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

- [ ] Una excepción de preflight antes de provider termina job y promesa; lease queda limpia; no hace request externo duplicado.
- [ ] Un HTTP 400 de creación o polling preserva tipo/código/parámetro allowlist, status, etapa y response ID cuando exista; no filtra mensaje/body del proveedor.
- [ ] Excepción inesperada en jobs genéricos y receipts termina fila mediante CAS, actualiza estado dependiente y no filtra datos sensibles.
- [ ] El barrido detecta leases vencidas y ausentes, libera concurrencia y actualiza receipt/config asociada; no toca jobs con lease futura.
- [ ] Una recuperación no reintenta automáticamente ni pisa estados/cambios de una generación más nueva; aborto/resolución repetidos son idempotentes.
- [ ] Un HTTP 4xx permanente del proveedor no mantiene abierto el POST hasta vencer la ventana manual; HTTP queda resuelto con error seguro y el job no figura como reintentable. Fallos transitorios y `BAD_JSON` conservan la semántica manual existente.
- [ ] Tests cubren estado terminal previo, claim_generation nuevo, cancelación/resultado tardío, disponibilidad de provider y ausencia de llamadas duplicadas.
- [ ] Contrato WebApi: serializador no envía roles `system`/`assistant` en `input`, no emite campos de imagen rechazados y nunca supera 4.000 caracteres en `instructions`; tests TDD demuestran compatibilidad antes de usar el proveedor real.

### Navegador + proveedor real, aislados

- [ ] Ejecutar Playwright real contra stack local aislado, sin mock de provider, con WebApi y sesión/modelo reales. Un POST de test de conexión devuelve 202; al cerrar/recargar la vista, la cola y configuración siguen mostrando el mismo job activo hasta terminal.
- [ ] El smoke real puede apuntar a un puerto loopback alternativo para WebApi parcheada; el default permanece `:3001`, y destinos no loopback, URL con credenciales o path/query se rechazan antes de tocar tokens.
- [ ] Confirmar una sola ejecución de connection test, diagnóstico final legible, concurrencia liberada y ningún job colgado.
- [ ] Ejecutar secuencialmente la matriz live de workflows habilitados (recetas, múltiples recetas, mejora, reemplazo, recomendaciones, planificación, estimación de caducidad, foto de compra, lectura de ticket sintético, plan de hogar, asistente y búsqueda real de imágenes). Cada resultado debe ser terminal/usable; se documentan rutas que requieren fixture o no son llamadas LLM.
- [ ] Ejecutar un caso live dedicado `household_plan` con propuesta temporal validada y una sola llamada Responses background; no confirmar ni persistir el plano sugerido.
- [ ] Añadir smoke aislado explícito para mejora, reemplazo y Commons real; exigir 2 completions Responses background con schemas esperados, imagen Commons terminal con candidatos y cero mutaciones no confirmadas.
- [ ] El smoke real de planificación usa un contexto válido según el constructor real y alcanza el WebApi/modelo; no vale la respuesta 400 generada localmente por el proxy del harness.
- [ ] Las llamadas live usan solamente DB temporal/usuario/hogar semilla; presupuesto acotado, proveedor y servicios preexistentes no reiniciados. Token desde env/almacén, jamás persistido o mostrado.
- [ ] Guardar evidencia sintética desktop/móvil solo si se cambia UI; no guardar screenshots/logs/traces con datos personales o secretos.

### Entrega

- [ ] Regresión TDD falla antes y pasa después.
- [ ] Suite focal server, cobertura >=70 % en métricas aplicables, suite requerida, build y typecheck pasan.
- [ ] PR único desde origin/master, CI verde y Ready for review solo tras completar criterios; no merge.

## Evidencia de implementación

- TDD smoke conexión: `node --test --experimental-test-isolation=none --test-name-pattern='background Responses proxy validates' scripts/ai-live-smoke-safety.test.mjs` primero falló en el nuevo caso string (`400` del proxy), tras aceptar el string no vacío pasó. El proxy valida el formato, pero reenvía el cuerpo original sin alterarlo.
- Suite del arnés: `node --test --experimental-test-isolation=none scripts/ai-live-smoke-safety.test.mjs scripts/ai-live-smoke-runner-control.test.mjs` pasó 48/48 antes de añadir el caso string; se repetirá al cerrar cambios.
- Evidencia de smoke connection-only anterior: una corrida real respondió HTTP 200 en 18.131 ms y verificó el badge `OK`; esta evidencia queda supersedida como garantía de estabilidad por la corrida posterior que alcanzó timeout de modelo. No declarar conexión arreglada con el solo 202/200 de aceptación.
- Corrida real actual connection-only (Chromium, WebApi local `127.0.0.1:3001`, sesión/modelo reales `gpt-5`, SQLite temporal y token efímero, sin mock): resultado fallido terminal. El dashboard WebApi correlacionó el response ID con `validated_output_timeout`, 504, 120 s de inactividad, 0 eventos terminales. Evidencia recuperada mediante navegador real, con logs/modelo/códigos allowlist; sin leer ni registrar tokens ni el contenido del modelo.
- Verificación real posterior (Chromium, WebApi local, modelo `gpt-5`, sin mocks): `connection-only` sí pasó en 15.917 ms, cerrando y reabriendo la pestaña; un job, un intento, `responses_background`, HTTP 200 y badge `OK`. El modo nuevo `household_plan` pasó en 17.967 ms con schema estricto, un job y propuesta no confirmada; la lectura posterior siguió `{version:0, plan:null}`.
- El smoke live de mejora/reemplazo + Commons llegó al provider para dos requests. La mejora terminó 200; el reemplazo fue rechazado por la API al no completar WebApi la segunda respuesta. Sesión WebApi correlacionada: aceptación `/backend-api/f/conversation` HTTP 200, salida incompleta, `validated_output_timeout`/504 tras ~129 s de inactividad, `validationStatus=incomplete`, 0 requests terminales; el stream terminó en `network_loading_failed`/`stream_aborted_for_reload`, sin llamada `/conversation/resume`. Es un fallo real interno de WebApi, no timeout HTTP de 30 s ni un rechazo del contrato local de HogarIA. No se reintentó para evitar coste/duplicación; el smoke sigue fallando hasta resolver la recuperación/stream de WebApi.
- Primer intento del nuevo smoke `household_plan` tuvo 0 llamadas porque el `--grep` no coincidía con el nombre del test; corregido el título del test y repetido con una llamada real exitosa. Ninguna llamada de proveedor se contó como éxito por aceptación HTTP solamente.
- No se cambia el comportamiento de la imagen Commons para otros tests: su fixture se quita solo en el nuevo smoke opt-in live y la búsqueda quedará separada del presupuesto de completions de WebApi.
