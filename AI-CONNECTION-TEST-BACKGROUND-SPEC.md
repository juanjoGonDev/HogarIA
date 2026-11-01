# Prueba de conexión IA en background

**Estado:** spec previa a implementación; no marcar criterios hasta tener prueba reproducible.
**Base:** `origin/master` (`cebcd0f9651a670193373cd00542dc24baf460e0`), rama `fix/webapi-background-connection-test`.
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
2. Para probar, HogarIA negocia Responses en background primero; solo usa Chat Completions si recibe un rechazo explícito que demuestra que Responses/background no está soportado (p. ej. ruta 404/405/501 o error de validación inequívoco). No hace fallback tras timeout, desconexión, 5xx ni respuesta ambigua: podría duplicar una ejecución aceptada.
3. Tras aceptar el background, consultar estados `queued`/`in_progress` con backoff hasta un estado terminal. El límite total de la prueba será `max(timeout configurado, 120 s)`; 120 s es una ventana mínima, no un cap de producto, alineada con el timeout de ejecución registrado por WebAPI. El lease de cola debe cubrir esa ventana más el margen actual. Cada petición HTTP individual conserva timeout técnico acotado.
4. Si la persona cancela explícitamente el job y ya hay `response_id`, intentar cancelarlo en el proveedor. Cerrar/recargar el navegador no dispara cancelación: el estado guardado sigue consultándose.
5. Diagnóstico copiable por job visible en la cola, con ID local, tipo, estado, intentos, timestamps/código seguro y, cuando exista, protocolo, HTTP status y `response_id` del proveedor. Nunca copiar ni persistir API keys, URLs, prompts, adjuntos, respuestas ni cuerpos de error del proveedor. El ID del proveedor sirve para correlacionar el incidente en WebAPI.
6. El test no guardado conserva la privacidad actual: no se persisten sus credenciales ni payload. Se reutiliza el protocolo nuevo; no se añade un segundo mecanismo de almacenamiento para el formulario.

## Criterios de aceptación

### Transporte y ejecución única

- [ ] Una prueba inicia un solo intento de proveedor, incluso con `retry_attempts > 0`; ningún reintento automático genera ejecuciones/costes repetidos.
- [ ] El POST Responses usa `background: true`, JSON Schema estricto en `text.format`, autorización actual y un identificador de idempotencia seguro para correlación; el cuerpo no incluye parámetros nulos ni configuración irrelevante.
- [ ] Respuesta `queued`/`in_progress` se consulta hasta `completed` y valida texto de salida con el mismo `testAnswerSchema`; `failed`, `incomplete`, `cancelled`, malformado y deadline producen resultado fallido seguro.
- [ ] Extraer salida de `output[].content[]` (`type: output_text`); nunca asumir `choices` o `output_text` de raíz en Responses.
- [ ] Proveedor Chat Completions-only cae al endpoint actual solo ante rechazo inequívoco de soporte; errores ambiguos, autenticación, rate limit y 5xx no reenvían generación.
- [ ] Timeout total mínimo 120 s y lease cubren prueba lenta; timeout configurado superior sigue respetándose sin máximo de producto.
- [ ] Cierre/recarga de navegador no cancela ni duplica la prueba guardada; la UI observa estado persistido. Cancelación explícita cancela también el Responses aceptado, si el proveedor admite cancelación.
- [ ] Probar formulario sin guardar no persiste clave, job reanudable, respuesta ni prompt; queda cubierto en caso de éxito, error, cancelación, repetición y timeout.

### Diagnóstico seguro

- [ ] DTO de cola expone únicamente metadatos allowlisted del job y proveedor necesarios para soporte; IDs tienen formato/longitud acotados.
- [ ] Cada job visible puede copiar un diagnóstico solo de ese job; incluye correlación WebAPI cuando exista y nunca contiene URL, credencial, prompt, archivo, salida o cuerpo externo.
- [ ] Copia con `navigator.clipboard` maneja permiso/fallo con confirmación accesible; botones tienen nombre accesible, teclado y target táctil.
- [ ] Pruebas verifican redacción/ausencia de secretos y que el contenido de un job no se mezcla con otros; i18n ES/EN.

### Evidencia y entrega

- [ ] TDD: regresión que muestra el límite/reintentos, estados Responses terminales y compatibilidad/fallback con mocks HTTP locales; no llamar WebAPI/LAN ni proveedor real.
- [ ] Rutas/API y migración probadas en SQLite temporal; no tocar DB o proceso habitual.
- [ ] Playwright real app/API aislada: PC y móvil, copia clipboard aislada, cerrar/recargar vista durante test sin cancelarlo, cancelar explícitamente, teclado, accesibilidad y breakpoints aplicables; capturas sintéticas bajo artefactos ignorados.
- [ ] Coverage del alcance >=70 % statements/branches/functions/lines, sin rebajar gates; geometría del control equivalente revisada (tolerancia 1 CSS px).
- [ ] Registrar comandos/resultados y limitaciones. Actualizar esta checklist solo con evidencia ejecutada.
- [ ] PR permanece Draft durante implementación; no cambiar estado de otros PRs ni mergear sin permiso.

## Desviación / pendiente

Esta spec no modifica WebAPI. El soporte de Responses/background se consume como capacidad del proveedor y se degrada de forma conservadora cuando el endpoint no existe. Si el contrato local de WebAPI difiere de las pruebas sintéticas, registrar la discrepancia aquí antes de cambiar alcance.
