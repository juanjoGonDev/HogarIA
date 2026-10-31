# HogarIA — prueba de IA en segundo plano, runtime y actualización web

**Estado:** código #63 reconciliado con #56; gates locales verdes; CI remoto final pendiente. PR #63 sigue Ready por decisión del usuario.
**Base vigente:** `origin/master` en `b2e3de8` (squash de #56; rama predeterminada: `master`).
**Rama:** `feat/runtime-operations-ui`.
**PR funcional:** [#63](https://github.com/juanjoGonDev/HogarIA/pull/63), Ready por decisión del usuario. El usuario autorizó integrar/mergear #56 y después #63; conservar Ready y no mergear hasta que la rama esté reconciliada y CI esté verde. #56 ya está mergeado.

## Objetivo y alcance

Atender la solicitud del producto sobre la prueba guardada del proveedor de IA, los metadatos del servidor en Logs, la frescura de la web tras una actualización y los enlaces activos al repositorio renombrado.

La fuente de verdad para la prueba guardada es `AI-PROVIDER-SETTINGS-SPEC.md`, apartado «Timeout y estado del test de conexión». #56 ya integró en `master` los proveedores/asignaciones, claves opcionales al editar, mensajes de validación, timeout de producto sin máximo y metadatos Logs/GHCR/caché/enlace. #63 conserva su alcance de prueba guardada duradera y actualización web explícita; no debe revertir ni duplicar el trabajo ya integrado.

## Evidencia revalidada en `master`

- En `master` post-#56, `server/src/routes/ai.routes.ts` conserva el routing multi-proveedor, pero el test guardado aún espera `pingDeConexion()` dentro de la petición y solo persiste el resultado final.
- `ai_configs` en `master` ya contiene `test_status`, `test_error`, `last_tested` y los campos de configuración de #56; `test_started_at` y `test_latency_ms` pertenecen al cambio aún pendiente de #63.
- `frontend/src/app/features/ai-config/ai-config.component.ts` conserva `probandoId` en la instancia; el polling no sobrevive a recarga/navegación. Adaptar la UI sin perder las mejoras #56 de proveedor/token opcional ni las asignaciones por función.
- `server/src/routes/health.routes.ts` en `master` ya devuelve `uptime` e `imageRef` desde `APP_IMAGE_REF`, con `Cache-Control: no-store`; Logs de #56 muestra ambos. Mantener `imageRef` como contrato canónico.
- La imagen GHCR de #56 ya inyecta `APP_IMAGE_REF` y la metadata OCI `org.opencontainers.image.revision`.
- #56 ya incorpora `AppUpdateService`, que activa y recarga automáticamente en `VERSION_READY`; #63 propone una UX de aviso y actualización explícita. Consolidar en un solo flujo explícito para no descartar formularios y retirar el auto-reload duplicado.
- Node/Nginx de #56 revalidan shell, manifiestos y service worker; solo recursos con hash son inmutables. Mantener esos encabezados `no-store`/`no-cache` y adaptar el smoke HTTP de #63 al contrato existente.
- Las referencias activas del repo en `master` ya usan HogarIA. Conservar intactos los enlaces históricos y evitar duplicar cambios de #56.

## Decisiones

- Una prueba de configuración **guardada** se reclama atómicamente por configuración, persiste `testing` antes de aceptar el trabajo y continúa independientemente de la petición HTTP o pestaña. Mientras está activa, repetir la acción devuelve/consulta el mismo estado; no lanza un segundo ping.
- Recargar o abrir Ajustes de nuevo recupera `testing` desde la API y mantiene la indicación hasta resultado terminal. Cerrar la pestaña no cancela el trabajo. Si el proceso muere, el siguiente arranque cierra como interrumpido cualquier estado activo obsoleto; nunca relanza una llamada externa implícitamente.
- `interrupted` también es terminal en la UI: muestra etiqueta traducida, cierra el spinner/polling y presenta resultado de recuperación; no deja una tarjeta «Probando» para siempre.
- El test del formulario sin guardar conserva su flujo efímero y no persiste credenciales. No guardar claves en jobs, respuestas de estado, logs, URLs, `localStorage` ni telemetría; redactar los errores.
- La revisión mostrada en Logs procede del mismo SHA inyectado en runtime que `org.opencontainers.image.revision`; local/dev muestra un valor explícito. No se inspecciona Docker ni otros contenedores.
- El shell y manifiestos/worker de Angular se revalidan; solo recursos con nombre hash conservan caché larga e inmutable. Si Angular detecta una versión nueva, muestra una acción de recarga explícita y no descarta formularios automáticamente.
- Las reglas de caché por `location` en Nginx deben conservar `X-Frame-Options` y `X-Content-Type-Options` que antes se declaraban en `server`; añadir `Cache-Control` puede impedir que se hereden.
- Cambiar solo enlaces activos de soporte/diagnóstico al remoto nuevo `https://github.com/juanjoGonDev/HogarIA.git`; conservar IDs/nombres heredados y evidencia histórica.

### Integración con #56 (nueva base)

- [ ] Integrar `origin/master` (`b2e3de8`) mediante merge commit regular; no rebase/force-push. Resolver conflictos sin perder proveedores/asignaciones, token opcional, validación de mensajes, timeout ilimitado de producto, `imageRef`, Logs, headers no-cache ni cambios de soporte ya mergeados.
- [x] Mantener exactamente un flujo de actualización web: aviso accesible y acción explícita; no recargar automáticamente con formularios sin guardar. Preservar `/health` y `APP_IMAGE_REF` como contrato de runtime. Polling cada 5 min; E2E de actualización incluido en gate full-stack.
- [x] Portar/ajustar el test guardado desacoplado a la API multi-proveedor de #56: respuesta `202`, claim único por config/hogar, consulta de estado autorizada, prueba efímera sin persistir secretos, timeout/reintentos coherentes y recuperación segura tras reinicio. La UI presenta `interrupted` como estado terminal.
- [x] Revisar migraciones/DB de `test_started_at` y `test_latency_ms`, `Dockerfile`, workflow, `app.ts`, logs y smoke HTTP real de Nginx con los contratos ya presentes en `master`.
- [ ] Completar verificación remota sobre el merge commit final; el CI del HEAD anterior dejó de ser evidencia suficiente tras mergear #56.

## Criterios de aceptación

> Las casillas de la ejecución anterior documentan resultados del HEAD pre-#56. La sección «Revisión integrada» registra la evidencia local posterior a #56; queda pendiente solo el merge commit/push y su CI remoto final.

### Test de IA guardado — único y en segundo plano

- [x] La API persiste el estado `testing` antes de responder; la ejecución no espera al proveedor dentro de la petición HTTP. `POST` devuelve `202` y el test guardado corre en una promesa desacoplada de la petición.
- [x] Claim atómico evita duplicados concurrentes y repetición mientras exista una ejecución activa por configuración.
- [x] Navegar, cerrar pestaña o recargar no detiene la ejecución; al volver, la tarjeta muestra que sigue probando y después presenta el estado terminal. E2E cierra la pestaña, reabre con la misma sesión y verifica una sola llamada al proveedor sintético.
- [x] Éxito, error, timeout y caída/reinicio dejan un estado terminal recuperable; la UI traduce `interrupted`, libera spinner/polling y no relanza una prueba real automáticamente.
- [x] El formulario sin guardar sigue sin persistir ni reintentar credenciales. Pruebas cubren deduplicación/carrera, refresh, salida del cliente, reinicio, error redactado y ausencia de secretos.

### Logs — uptime y revisión de imagen

- [x] Logs muestra uptime legible y revisión/tag SHA de la imagen del servidor, con estados de carga/error accesibles e i18n ES/EN.
- [x] `/health` y Logs comparten la misma fuente. En GHCR, la revisión de runtime coincide exactamente con `org.opencontainers.image.revision`; dev/local es explícito (`dev`). El smoke compara el SHA esperado con `/health`.
- [x] Tests de API, Dockerfile/workflow, smoke y componente verifican los metadatos sin exponer secretos.

### Frescura y actualización web

- [x] Nginx y servidor Node revalidan `index.html`, `ngsw.json` y `ngsw-worker.js`; solo assets con hash llevan `immutable`; assets sin hash no mantienen caché larga.
- [x] Las ubicaciones Nginx que agregan `Cache-Control` conservan también `X-Frame-Options` y `X-Content-Type-Options`; regresión de config y smoke HTTP real comprueban shell, manifiestos y bundle (5/5 respuestas).
- [x] La app avisa cuando hay una versión nueva y recarga solo tras una acción explícita; también conserva aviso/acción si no se puede activar.
- [x] Tests verifican cabeceras de Node/Nginx y actualización del service worker. En E2E producción se inyecta evento sintético `VERSION_READY`; teclado deja enfocada la acción y la página no recarga automáticamente. Smoke Nginx con assets reales: shell/manifiestos/asset sin hash → `no-cache`; assets con hash → `immutable`.

### Enlaces y verificación final

- [x] Referencias activas en código y contrato apuntan al remoto nuevo; enlaces a PRs/ejecuciones históricas permanecen. Búsqueda final no encontró URL antigua en código activo.
- [x] TDD con DB temporal (`DATABASE_PATH=:memory:` en Vitest/E2E aislado) y proveedor sintético; suites afectadas, tipos y build pasan. Coverage cliente: 90.61/80.99/91.71/93.20 % (S/B/F/L); servidor: 89.55/81.70/95.68/92.50 %.
- [x] Limitación de lint confirmada: `pnpm run lint` falla porque no está instalado `@angular-eslint/builder`. No añadí dependencias; `check:ui` sí pasa. El workflow CI no ejecuta este lint.
- [x] Playwright real contra frontend/backend con datos sintéticos: escritorio/móvil, refresh/cierre durante prueba, oferta de actualización, teclado/foco y breakpoints (320 px, móvil apaisado 852×393, escritorio 1024/1440). Capturas PC/móvil ignoradas por Git guardadas y revisadas en `.e2e-screenshots/ai-test-running-*`, `.e2e-screenshots/logs-runtime-*` y `.e2e-screenshots/app-update-*`.
- [ ] Registrar resultado del CI remoto final y merge. Conservar Ready tal como pidió el usuario; mergear #63 solo tras review final y CI verde (autorización explícita concedida).

## Unidades revisables

1. Estado/deduplicación del test de IA guardado y UI reanudable.
2. Uptime/revisión GHCR y visualización en Logs.
3. Política de caché, detección de versión y actualización explícita.
4. Enlaces activos del repo renombrado y verificación transversal.

El tamaño total supera 400 líneas revisadas. El usuario eligió explícitamente mantener un único PR grande y aceptar la excepción de tamaño; añadir etiqueta `size:exception`, conservar commits atómicos por unidad y explicar el motivo en el PR. No dividir en PRs encadenados.

## Evidencia de ejecución local

- `pnpm run typecheck:e2e`: pasa.
- `pnpm run check:ui`: 268 ficheros, 21 reglas, sin incidencias.
- `pnpm run test:config`: 116/116, incluye los contratos del verificador HTTP Nginx y el job CI.
- `pnpm run test:client`: 1729/1729; coverage statements/branches/functions/lines 90.61/80.99/91.71/93.20 %.
- `pnpm run test:server`: 2100 pasan, 1 omitido; entorno de pruebas fuerza `DATABASE_PATH=:memory:`.
- `pnpm run test:server:coverage`: 2100 pasan, 1 omitido; coverage statements/branches/functions/lines 89.55/81.70/95.68/92.50 %. Todos los ficheros cubiertos mantienen los mínimos por fichero existentes (≥70 %).
- `pnpm run build`: pasa; conserva avisos Angular de componentes/specs existentes y presupuestos CSS existentes.
- `pnpm run test:e2e -- tests/e2e/ai-config.spec.ts tests/e2e/logs.spec.ts --project=chromium --project=mobile-chrome`: 68/68, stack dev aislado.
- `node scripts/run-isolated-playwright.mjs tests/e2e/ai-config.spec.ts tests/e2e/logs.spec.ts --grep='one saved AI test survives closing the page|shows synthetic server uptime' --project=chromium --project=mobile-chrome`: 4/4; se repitió tras añadir anchos 320 px y landscape 852×393.
- `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts tests/e2e/full-stack/service-worker-update.spec.ts --project=chromium --project=mobile-chrome`: 2/2, build servido en modo producción y DB temporal.
- `node scripts/run-isolated-playwright.mjs tests/e2e/ai-provider-queue.spec.ts --project=chromium`: 3/3; los E2E de cola usan ahora generación de receta (la prueba de conexión guardada responde `202` y se deduplica, no representa un job de la cola genérica). El caso de reintento comprueba la segunda ejecución y la cancela de forma aislada.
- `pnpm --filter @hogaria/server exec vitest run src/app.spec.ts`: 13/13.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/services/service-worker-update.service.spec.ts --include=src/app/shared/components/app-update-notice.component.spec.ts`: 11/11.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/environments/environment.spec.ts`: 1/1; repository support URL matches in dev and production.
- `pnpm --filter @hogaria/server exec vitest run src/utils/recipe-step-photos.spec.ts src/utils/recipe-step-videos.spec.ts`: 46/46; Wikimedia User-Agent points to renamed repo.
- `docker run --rm --add-host app:127.0.0.1 --mount "type=bind,source=D:/projects/MiCocinAI/nginx/nginx.conf,target=/etc/nginx/nginx.conf,readonly" --mount "type=bind,source=D:/projects/MiCocinAI/nginx/proxy-api-common.conf,target=/etc/nginx/proxy-api-common.conf,readonly" nginx:alpine nginx -t`: syntax/test OK.
- Smoke Nginx con assets reales montados desde `frontend/dist/browser`: `HEAD` a `/index.html`, `/ngsw.json`, `/ngsw-worker.js`, `/calendar-feature.css` devolvió `200 no-cache`; `/styles-GRZCEKI2.css` y `/main-ZL5QEV7E.js` devolvieron `200 public, max-age=31536000, immutable`. Contenedor temporal detenido y puerto liberado.
- `node scripts/nginx-static-headers-smoke.mjs`: 5/5 respuestas HTTP reales desde `nginx:alpine` con fixtures sintéticos; verificó `Cache-Control`, `X-Frame-Options` y `X-Content-Type-Options` en shell/manifiestos/bundle. Contenedor/fixtures temporales eliminados. El test de config falló antes del arreglo y pasó después. (La revisión integrada amplió el smoke a 6 respuestas.)
- Workflow/container smoke: 12/12.
- `pnpm run lint`: no pasa por herramienta/configuración existente (detalle arriba); no es un fallo de lint de los cambios.
- El run remoto `41218712834` del HEAD `77f3728` falló solo en shard 1 porque `ai-provider-queue.spec.ts` trataba el test de conexión guardada como un job genérico. Tras corregir el E2E, `41220436428` del código en `c95e0a6` pasó build, tipos, tests de servidor, E2E, smoke amd64/arm64 y CodeQL. Ese CI es histórico y no sustituye el CI nuevo tras integrar #56.

### Revisión integrada tras #56 (antes del merge commit)

- `pnpm run check:ui`: **271 ficheros, 21 reglas**; pasó con la etiqueta traducida `interrupted` ya conectada a la UI.
- `pnpm run typecheck:e2e`: pasó.
- `pnpm run test:config`: **118/118**.
- `pnpm run test:client:coverage`: **1774/1774**; coverage S/B/F/L **90.54/80.98/91.83/93.13 %**.
- `DATABASE_PATH=:memory: pnpm run test:server:coverage`: **2130 pasan, 1 omitido**; coverage S/B/F/L **89.69/81.90/95.56/92.66 %**.
- `pnpm run build`: pasa; conserva warnings Angular/SCSS preexistentes.
- Unit tests focales: servidor rutas/health/static/timeout/schema **117/117**; servicio/componente IA + service worker/update notice **50/50**.
- Playwright aislado: full-stack AI provider **6/6**; prueba guardada tras cerrar/reabrir **2/2** (desktop/móvil); Logs uptime/imageRef **2/2**; aviso service worker **2/2**; cola de receta **3/3**; geometría/settings IA hogar **8/8**.
- `node scripts/nginx-static-headers-smoke.mjs`: **6/6 respuestas** desde Nginx real; caché y cabeceras de seguridad verificadas.
- Capturas sintéticas PC/móvil revisadas en `.e2e-screenshots/merge-review/` (ignorado por Git); usan datos sintéticos, DB efímera y proveedor HTTP local.
- CI remoto final pendiente del merge commit/push. No se ejecutó ningún proveedor externo. El test de geometría corregido solo exige overlay realmente oculto: el elemento existe intencionadamente en DOM en móvil para permitir cerrar el drawer.
