# Peticiones IA en background y contexto completo de tickets

**Estado:** implementación y verificación local completadas; CI final pendiente.
**Base actual del PR:** `origin/master` (`94ac5581a5d4e6b276b077bb141ba73f35860582`).
**Base de creación de la rama:** `94ac5581a5d4e6b276b077bb141ba73f35860582` (`origin/master`).
**Rama:** `fix/ai-requests-background`.
**Entrega:** un único PR, sin límite de tamaño. El estado de revisión lo conserva el propietario; ahora está Ready for review.

## Línea base verificada antes de implementar

- `AI-CONNECTION-TEST-BACKGROUND-SPEC.md` ya definía el patrón para pruebas de conexión: crear Responses con `background: true`, guardar metadatos del job, consultar estado y cancelar solo por acción explícita. Antes de este cambio, el resto de llamadas usaba Chat Completions síncrono o conectaba la cancelación al ciclo HTTP.
- `server/src/utils/ai-client.ts` centralizaba llamadas de modelo, pero `callAIWithConfig` y `callAIStreamingWithConfig` usaban Chat Completions síncrono. El asistente eludía la cola y el worker de automatización llamaba directamente al transporte.
- `ai_jobs` conservaba estado y alcance, mientras que no había un estado global recuperable para cada persona al reabrir la web. La cola visible estaba limitada a proveedor y permiso de gestión.
- `ticket-queue.ts:inventarioDeLaCasa` adjuntaba `inventario.json`, pero limitaba categorías a 300 y productos a 2.000. Se conserva el scope de hogar seleccionado más filas personales del usuario ejecutor. `ticket-prompt.ts` excluye existencias, precios, códigos, ubicación, notas e historial; las categorías deben conservar la relación padre.

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

- [x] Cada egress de modelo usa Responses background; búsqueda de imágenes que no llama a un modelo queda fuera. Revisado con búsqueda en `server/src` y tests locales.
- [x] El transporte mapea mensajes de texto, imágenes y archivos; response formats y parámetros compatibles. Estados terminales, errores, refusal y timeout cubiertos por fixtures HTTP locales.
- [x] Se rechaza explícitamente un proveedor sin Responses background; no hay fallback a `/chat/completions` ni segunda ejecución al recargar. Idempotencia evita duplicar un create aceptado.
- [x] IDs de idempotencia identifican cada job local; timeout mínimo 120 s sin máximo de producto y lease con margen; el cap restante es límite técnico de Node.
- [x] `AbortSignal` HTTP no cancela jobs ordinarios. Las cancelaciones explícitas mantienen la cancelación de HogarIA y del proveedor cuando existe `response_id`.
- [x] Tickets, asistentes y automatizaciones usan el mismo transporte; pruebas server verifican salida y efectos de dominio.
- [x] Suite server: 123 archivos aprobados, 1 omitido; 2.141 aprobados y 1 omitido; coverage server 89,42/81,66/95,58/92,33 %.

### Descubrimiento al reabrir

- [x] Endpoint autenticado devuelve solo jobs activos propios con DTO allowlist; incluye automatizaciones activas autorizadas y permite el scope personal/no seleccionado. Tests cubren aislamiento y no-cache.
- [x] El shell consulta el endpoint al cargar y actualiza cada 2 s mientras haya trabajo; E2E confirma reapertura y estado activo hasta terminal.
- [x] Etiquetas ES/EN accesibles y visualización en PC/móvil; no expone IDs ni metadatos sensibles. E2E mide touch target >=44 px, ausencia de overflow móvil y geometría equivalente con tolerancia <=1 px.
- [x] Playwright aislado con Responses sintético confirma cerrar pestaña sin abort/cancel/duplicado, reabrir y ver el job activo. Capturas sintéticas bajo `.e2e-screenshots/ai-background-request/`.

### Inventario de tickets

- [x] El JSON adjunto incluye más de 2.000 productos y más de 300 categorías, incluidos los últimos registros, sin `LIMIT` de producto.
- [x] Cada categoría conserva su padre; productos/categorías siguen limitados al hogar activo y datos personales del usuario ejecutor.
- [x] No se adjuntan existencias, precios, barcode/códigos, ubicaciones, notas ni historial. La petición de ticket incluye realmente el archivo generado, validado con un test del worker.

### Verificación y entrega

- [x] Regresiones reproducidas primero (inventario truncado, gate de estado, respuesta malformada sin persistencia parcial y timeout de container smoke); suite server/client/config, build y coverage cumplen los gates locales. Coverage client 90,57/80,99/91,89/93,18 %.
- [ ] CI final verde. No se llama a WebAPI ni a proveedor real; el smoke AI real opt-in no se ejecutó.
- [x] Un único PR #65 a `master`, rama derivada de `origin/master`, exactamente una etiqueta `type:feature`; el propietario lo dejó Ready for review y no se ha cambiado ese estado. No se ha mergeado.

## Evidencia y decisiones pendientes

- Rama creada desde `origin/master`; este contrato se publica antes de implementar, conforme al flujo SDD del repositorio.
- Unidad de inventario: `pnpm --filter @hogaria/server exec vitest run src/utils/ai-queue.spec.ts src/utils/ticket-prompt.spec.ts -t "includes every scoped product and category|processes a synthetic ticket|snapshotting|buildTicketPrompt"` pasó (11 tests). Incluye el fixture del job real con 2.001 productos/301 categorías adjuntos, clave padre y scope; el test nuevo falló primero por el `LIMIT 300` y pasó al retirar límites y serializar padres.
- `pnpm run test`: config 119/119, client 1.794/1.794 y server 123 archivos aprobados, 1 omitido; 2.141 tests aprobados y 1 omitido. `pnpm run test:server:coverage`: 89,42/81,66/95,58/92,33 %. Coverage client: 90,57/80,99/91,89/93,18 %.
- `pnpm run test:config`: 119 aprobados. `pnpm run build`: servidor y frontend producción pasan. `pnpm run typecheck:e2e`: pasa. `pnpm run check:ui`: 276 ficheros/21 reglas sin incidencias.
- E2E focales con fixtures Responses: recetas 4, tickets/metadata 4 y cola de tickets 2 aprobados. Full-stack aislado `ai-background-request`: 2 aprobados, Chromium PC y Pixel 5 móvil; repetición local Chromium aprobada. `receipt-queue-actions`: 2 aprobados tras procesar tickets solo desde la respuesta completa validada. `ai-real-smoke` opt-in no ejecutado.
- CI previo a la implementación falló solo en `Container image smoke (arm64)`: el script salía con código 13 si un `fetch` no se resolvía y el timeout usaba un temporizador unref'ed. Se añadió timeout explícito con timer referenciado y regresión; `node --test scripts/container-smoke.test.mjs` pasó 9/9 y `pnpm run test:config` 119/119. CI final pendiente.
- `pnpm run lint:server` no ejecuta: el script existente usa `eslint src --ext .ts`, opción incompatible con ESLint 9.17; `eslint src` desde raíz tampoco encuentra config. `pnpm run check:ui` sí pasó; no se añadió dependencia ni se reconfiguró lint fuera de alcance.
- La ejecución de CI 1038 encontró dos regresiones E2E de convivencia con el indicador: un `role=status` vacío duplicaba estados accesibles y el anillo infinito impedía la espera de animaciones finitas. Corregido con role condicional y exclusión de animaciones infinitas en `waitForStableView`; `ai-active-jobs-indicator` 4/4, `dashboard-ai-queue` 2/2, búsqueda de fotos en editor 1/1 y filtros/borrado de logs 1/1 pasan localmente. La última prueba pausa su stream tras cargar filas sintéticas para aislar la selección frente a logs de otros workers.
- No se cambia WebAPI. Su soporte de Responses/background se trata como capacidad del proveedor y se comprueba sin fallback síncrono.
- La limitación intencionada es no recuperar una respuesta terminada mientras la persona estaba fuera; la exigencia explícita cubre que el trabajo no se interrumpa y que su estado activo reaparezca al reabrir. Persistir prompts/resultados está fuera de alcance por privacidad y porque las rutas transforman y validan resultados de distinta forma.
