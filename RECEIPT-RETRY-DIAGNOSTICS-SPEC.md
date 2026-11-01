# Diagnóstico de reintentos de lectura de tickets

## Objetivo

Explicar por qué falla un intento de lectura de ticket y permitir copiar únicamente el diagnóstico de ese trabajo, sin incluir datos del ticket, contenido del proveedor ni secretos.

## Evidencia vigente

- El `POST /api/receipts/:id/retry` devuelve `200` al volver a encolar el trabajo; no confirma que el siguiente intento haya terminado correctamente (`server/src/routes/receipts.routes.ts`).
- El worker ejecuta la lectura de forma persistente en segundo plano y conserva por trabajo etapa, transporte, HTTP status, duración e ID de respuesta validados (`server/src/utils/ticket-queue.ts`).
- Si el fichero ya no existe, el worker hoy lo clasifica como `PROVIDER` con detalle interno `FILE_MISSING`; ese fallo se reintenta automáticamente hasta agotar intentos (`server/src/utils/ticket-queue.ts`).
- El GET de la ficha devuelve actualmente `error_detail` arbitrario y no devuelve metadatos de diagnóstico del proveedor; la UI ignora ese detalle y solo traduce el código general de error (`server/src/routes/receipts.routes.ts`, `receipt-detail.component.ts`).
- El log aportado confirma que el reintento se aceptó (`POST .../retry → 200`) y luego solo muestra consultas de estado. No contiene el error del worker/proveedor ni permite determinar la causa concreta.
- La cola de configuración ya ofrece un patrón de copia por trabajo, con campos allowlisted, validación y feedback accesible (`ai-provider-queue.component.ts`).

## Decisiones

- Mantener el trabajo independiente de la pestaña y el sondeo persistente ya implementados; el botón de reintento informa de que se ha encolado, no de éxito del proveedor.
- Si `AiCallError.detail === 'FILE_MISSING'`, persistir el código de dominio `FILE_MISSING` (hoy se persiste `PROVIDER`) y no consumir reintentos automáticos para ese fallo permanente.
- Exponer a la ficha solo metadatos de diagnóstico allowlisted. No devolver/copiar `error_detail` crudo, URL del proveedor, credenciales, prompt, fichero/adjunto, respuesta ni contenido del ticket.
- Presentar explicación localizada para ausencia del fichero, timeout y estados HTTP de autenticación, cuota o servidor; para causas no identificables, conservar un texto genérico y mostrar el diagnóstico seguro.
- Copiar el diagnóstico de un solo trabajo, incluyendo identificador, estado/intentos/código y metadatos seguros disponibles. Limpiar metadatos del intento previo al reclamar un nuevo intento.

## Criterios de aceptación

- [ ] El worker registra `FILE_MISSING` sin reintentar automáticamente; el ticket explica que hay que volver a subir el fichero.
- [ ] Un nuevo intento empieza sin metadatos de diagnóstico del intento anterior, también si falla antes de contactar al proveedor.
- [ ] El GET de detalle devuelve un DTO de trabajo con campos allowlisted y elimina del contrato público el detalle arbitrario de error.
- [ ] El DTO mantiene el aislamiento por usuario/hogar y nunca expone diagnóstico de otro ticket.
- [ ] La ficha explica fallos conocidos a partir de códigos/metadatos seguros y ofrece copiar solo el trabajo de ese ticket, con feedback accesible y español/inglés.
- [ ] Las pruebas demuestran exclusión de secretos, URL, prompt, contenido/respuesta y detalles arbitrarios; cubren HTTP 401/429/5xx, ausencia de fichero, limpieza al reintentar y clipboard no disponible/rechazado.
- [ ] Playwright sintético valida la acción en escritorio y móvil; se guardan capturas comparables sin datos personales.
- [ ] No se llama un proveedor real ni se escribe en la base de datos/servidor de uso normal.

## Plan de verificación

- API/worker: `pnpm --filter @hogaria/server exec vitest run src/routes/receipts.routes.spec.ts --maxWorkers=1` y `pnpm --filter @hogaria/server exec vitest run src/utils/ai-queue.spec.ts --maxWorkers=1`.
- UI: prueba unitaria de `receipt-detail.component.spec.ts`, lint/typecheck/build de frontend.
- Integración UI: Playwright con servidor y datos sintéticos aislados, escritorio y móvil; no ejecutar el smoke real de IA.
- Registrar los comandos y resultados reales antes de marcar criterios como completados.

## Fuera de alcance

- Cambiar el transporte/background de solicitudes de IA, modificar otros flujos de IA o recuperar logs históricos que no se correlacionaron con este trabajo.
- Inferir una causa concreta del job aportado: el log compartido no incluye evidencia suficiente.
