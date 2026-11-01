# Peticiones IA en background y contexto completo de tickets

**Estado:** contrato activo; implementación pendiente.  
**Base:** `origin/master` (`a9c0ef83ca6ea3a689f0a5e2983d5bf1adcce90d`).  
**Rama:** `fix/ai-requests-background`.  
**Entrega:** un único PR Draft, sin límite de tamaño, según petición explícita.

## Fuente vigente y hallazgos

- `AI-CONNECTION-TEST-BACKGROUND-SPEC.md` define el patrón ya existente: crear una Responses API con `background: true`, guardar metadatos del job, consultar su estado y cancelar solo por acción explícita. La implementación actual conserva un fallback síncrono de conexión; este contrato nuevo lo elimina para todas las llamadas a modelos.
- `server/src/utils/ai-client.ts` concentra las llamadas de modelo, pero `callAIWithConfig` y `callAIStreamingWithConfig` todavía usan Chat Completions síncrono. El asistente (`ai-assistant-runtime.ts`) elude la cola; el worker de automatización llama directamente al transporte.
- `ai_jobs` conserva estado y alcance. Las entradas y closures genéricas residen en RAM; algunos callers pasan `c.req.raw.signal`, por lo que cerrar la página puede cancelar el job. El endpoint actual de cola es por proveedor y requiere permiso de gestión; no hay estado global recuperable para cada persona al volver a abrir la web.
- Los handlers HTTP conservan su contrato de respuesta actual. El trabajo del modelo se ejecuta en el servidor aunque el cliente deje de esperar. La nueva vista global muestra los jobs aún activos del usuario autenticado. No almacena ni expone prompts, archivos, resultados del proveedor, URLs ni claves.
- `ticket-queue.ts:inventarioDeLaCasa` adjunta `inventario.json`, pero limita categorías a 300 y productos a 2.000. El alcance actual de filas —hogar seleccionado y filas personales de quien lanza el ticket— se conserva. `ticket-prompt.ts` establece excluir existencias, precios, códigos, ubicación, notas e historial; las categorías sí deben conservar su relación padre.

## Decisiones

1. Todas las peticiones a un modelo, incluidos tickets, asistente, automatización y prueba de conexión, usan **Responses API en background** (`background: true`, `store: true`) y polling server-side del mismo `response_id`. No se inicia una llamada síncrona alternativa. Si el proveedor no soporta Responses background, HogarIA falla con un error seguro y accionable; no duplica ni degrada silenciosamente la petición a Chat Completions.
2. Toda llamada funcional queda bajo el ciclo de vida de un job HogarIA. Una desconexión HTTP, recarga o cierre de pestaña no cancela el job. La cancelación existente sigue siendo explícita y server-side. Las rutas pueden conservar el await y respuesta actual mientras la pestaña siga conectada.
3. Una API autenticada devuelve únicamente jobs `queued`/`running` del usuario actual y su scope permitido, sin exigir permiso de administrador del proveedor. El shell muestra y actualiza el estado al entrar/reabrir la web; los jobs de otros usuarios/hogares nunca se filtran. Al terminar, el job deja de figurar como activo; este cambio no añade una bandeja de salida ni reproduce respuestas perdidas por el navegador.
4. Los jobs no se reejecutan automáticamente tras reiniciar el proceso: los genéricos no guardan payloads y reejecutarlos podría duplicar costes o efectos. La recuperación existente marca los inputs irrecuperables de forma segura; las operaciones de dominio ya persistidas (como tickets) conservan su recuperación.
5. La conversión de mensajes multimodales, formatos JSON Schema, errores/refusals, deadlines, idempotencia, polling y cancelación se cubre con fixtures HTTP locales. Streaming del proveedor no forma parte del transporte background: el ticket actual mantiene su estado y líneas guardadas, y al recibir la respuesta final procesa/valida el resultado completo sin perder aislamiento ni introducir una segunda petición.
6. Para tickets se adjunta el inventario completo disponible en el scope vigente: todas las categorías y todos los productos/catálogo, sin los límites 300/2.000, incluyendo `parent_key` de categoría. No se amplía la información personal incluida ni se truncan registros silenciosamente; si el límite técnico existente de admisión impide aceptar un payload excesivo, el error debe ser claro.

## Mapa de implementación requerido

- `ai-client.ts`: un único transporte Responses que serializa la entrada Chat Completions existente, registra el `response_id`/diagnóstico allowlisted en el job y hace polling/cancelación. Las funciones que hoy envían SSE pasan a obtener el texto final del mismo transporte; no emiten deltas inventados.
- `ticket-queue.ts`: eliminar la dependencia de `externalSignal` de los handlers HTTP para trabajo de IA funcional; mantener los endpoints explícitos de cancelar/reintentar. El asistente se admite en la cola común; la automatización conserva su worker durable, usando el transporte background y su propia cancelación explícita.
- `ai-queue.routes.ts` + `ai_jobs`: endpoint read-only de jobs activos del usuario autenticado sin permiso de administración del proveedor. No añadir columnas para prompts, secretos o respuestas. La vista administrativa por configuración conserva su permiso.
- `main-layout.component.ts` + servicio/modelo frontend: indicador global de actividad IA, visible tanto con hogar activo como en scope personal; carga al montar y polling mientras exista actividad. No sustituir ni duplicar el indicador de recibos.
- `inventarioDeLaCasa` + fixtures de `ai-queue.spec.ts`: quitar los dos `LIMIT`, añadir `parent_key` y probar el contenido real del adjunto que recibe el job de ticket.

## Criterios de aceptación

### Transporte y jobs del servidor

- [ ] Cada egress de modelo usa Responses background; búsqueda de imágenes que no llama a un modelo queda fuera.
- [ ] El transporte mapea mensajes de texto, imágenes y archivos; response formats y parámetros compatibles. Respuestas `queued`/`in_progress` se consultan hasta terminal; `failed`, `incomplete`, `cancelled`, refusals, JSON inválido y timeout producen errores seguros.
- [ ] Se rechaza explícitamente un proveedor sin Responses background; nunca hay fallback a `/chat/completions`, retry que duplique un create ya aceptado ni segunda ejecución por una recarga.
- [ ] IDs de idempotencia identifican cada job local; límites por petición y lease cubren su timeout efectivo sin un límite de producto nuevo.
- [ ] `AbortSignal` de la petición HTTP no cancela jobs ordinarios. Cancelar desde las acciones existentes aborta la operación HogarIA y, con `response_id`, intenta cancelar el job del proveedor.
- [ ] Tickets, asistentes y automatizaciones usan el mismo transporte; formatos de salida y side-effects de dominio se conservan.
- [ ] Tests cubren mapeos multimodales, estados terminales, rechazo de capability, cancelación explícita, desconexión de cliente, concurrencia/deduplicación y recuperación segura al reiniciar, sin proveedor ni WebAPI real.

### Descubrimiento al reabrir

- [ ] Endpoint autenticado devuelve solo jobs activos propios con DTO allowlist; prueba aislamiento entre usuarios y permisos.
- [ ] El shell consulta el endpoint al cargar y actualiza mientras la sesión está abierta; tras refresh, los jobs aún activos reaparecen hasta terminal.
- [ ] Estados, títulos/localización, accesibilidad y diseño funcionan con teclado y en PC/móvil; no se muestran IDs o datos sensibles innecesarios.
- [ ] Playwright real con API/app aisladas prueba cerrar/recargar mientras un fixture del proveedor sigue pendiente, verificar continuidad y ver el job activo al reabrir; capturas sintéticas de PC/móvil.

### Inventario de tickets

- [x] El JSON adjunto incluye más de 2.000 productos y más de 300 categorías, incluidos los últimos registros, sin `LIMIT` de producto.
- [x] Cada categoría conserva su padre; productos/categorías siguen limitados al hogar activo y datos personales del usuario ejecutor.
- [x] No se adjuntan existencias, precios, barcode/códigos, ubicaciones, notas ni historial. La petición de ticket incluye realmente el archivo generado, validado con un test del worker.

### Verificación y entrega

- [ ] TDD por unidad; cada test, comando, resultado y limitación se registra aquí. Coverage del alcance ≥70 % en statements, branches, functions y lines, sin rebajar gates superiores.
- [ ] Suite server/client/config, build y gates CI relevantes verdes; E2E aislado en escritorio/móvil y evidencia geométrica/capturas sintéticas donde aplique. No se llama al proveedor habitual.
- [ ] Un único PR a `master`, rama basada en `origin/master`, con exactamente una etiqueta `type:*`; no mergear ni cambiar Draft/Ready sin indicación del usuario.

## Evidencia y decisiones pendientes

- Rama creada desde `origin/master`; este contrato se publica antes de implementar, conforme al flujo SDD del repositorio.
- Unidad de inventario: `pnpm --filter @hogaria/server exec vitest run src/utils/ai-queue.spec.ts src/utils/ticket-prompt.spec.ts -t "includes every scoped product and category|processes a synthetic ticket|snapshotting|buildTicketPrompt"` pasó (11 tests). Incluye el fixture del job real con 2.001 productos/301 categorías adjuntos, clave padre y scope; el test nuevo falló primero por el `LIMIT 300` y pasó al retirar límites y serializar padres.
- No se cambia WebAPI. Su soporte de Responses/background se trata como capacidad del proveedor y se comprueba sin fallback síncrono.
- La limitación intencionada es no recuperar una respuesta terminada mientras la persona estaba fuera; la exigencia explícita cubre que el trabajo no se interrumpa y que su estado activo reaparezca al reabrir. Persistir prompts/resultados está fuera de alcance por privacidad y porque las rutas transforman y validan resultados de distinta forma.
