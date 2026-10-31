# HogarIA — prueba de IA en segundo plano, runtime y actualización web

**Estado:** implementación terminada; verificación funcional local completada, lint limitado por configuración/dependencias existentes y CI del PR pendiente.
**Base:** `origin/master` en `b4bc0c8` (rama predeterminada real: `master`).
**Rama:** `feat/runtime-operations-ui`.
**PR funcional:** [#63](https://github.com/juanjoGonDev/HogarIA/pull/63), Draft; se abrió antes de implementar. El PR #62 solo revirtió el push accidental y ya está mergeado.

## Objetivo y alcance

Atender la solicitud del producto sobre la prueba guardada del proveedor de IA, los metadatos del servidor en Logs, la frescura de la web tras una actualización y los enlaces activos al repositorio renombrado.

La fuente de verdad para la prueba guardada es `AI-PROVIDER-SETTINGS-SPEC.md`, apartado «Timeout y estado del test de conexión». Esta unidad implementa **solo** el estado duradero, deduplicación y reanudación visual del test guardado. No implementa el resto del trabajo multi-proveedor, el cambio de timeout ni el registro.

## Evidencia revalidada en `master`

- `server/src/routes/ai.routes.ts`: `POST /api/ai/test-connection` espera `pingDeConexion()` y actualiza `test_status`, `test_error` y `last_tested` solo al acabar.
- `server/src/config/database.ts`: `ai_configs` ya persiste esos tres campos; la API puede exponer estado sin incluir `api_key`.
- `frontend/src/app/features/ai-config/ai-config.component.ts`: `probandoId` vive en la instancia del componente; el botón no recupera `testing` tras navegar/recargar. La tarjeta ya presenta `testStatus` cuando el servidor lo devuelve.
- `server/src/routes/health.routes.ts`: `/health` informa `process.uptime()` y una versión literal `1.0.0`; `/health/detailed` expone la versión de Node, no la revisión de la imagen.
- `.github/workflows/publish-ghcr.yml`: la imagen ya tiene la etiqueta OCI `org.opencontainers.image.revision=${github.sha}`, pero `Dockerfile` no la inyecta al proceso.
- `frontend/src/app/features/logs/logs.component.ts` no consulta metadatos del runtime.
- `server/src/app.ts` evita caché para `index.html` y usa caché larga para chunks con hash; `nginx/nginx.conf` aplica `immutable` por siete días a todos los `.js`/`.css`. Angular registra el service worker, pero no ofrece un flujo explícito al usuario al detectar una versión nueva.
- URLs activas antiguas aparecen en `frontend/src/environments/environment.ts`, `environment.prod.ts`, los User-Agent de fotos/vídeos y el contrato `HOGARIA-SPEC.md`. Se actualizan esas referencias activas; los enlaces a PRs y ejecuciones históricas quedan intactos.

## Decisiones

- Una prueba de configuración **guardada** se reclama atómicamente por configuración, persiste `testing` antes de aceptar el trabajo y continúa independientemente de la petición HTTP o pestaña. Mientras está activa, repetir la acción devuelve/consulta el mismo estado; no lanza un segundo ping.
- Recargar o abrir Ajustes de nuevo recupera `testing` desde la API y mantiene la indicación hasta resultado terminal. Cerrar la pestaña no cancela el trabajo. Si el proceso muere, el siguiente arranque cierra como interrumpido cualquier estado activo obsoleto; nunca relanza una llamada externa implícitamente.
- El test del formulario sin guardar conserva su flujo efímero y no persiste credenciales. No guardar claves en jobs, respuestas de estado, logs, URLs, `localStorage` ni telemetría; redactar los errores.
- La revisión mostrada en Logs procede del mismo SHA inyectado en runtime que `org.opencontainers.image.revision`; local/dev muestra un valor explícito. No se inspecciona Docker ni otros contenedores.
- El shell y manifiestos/worker de Angular se revalidan; solo recursos con nombre hash conservan caché larga e inmutable. Si Angular detecta una versión nueva, muestra una acción de recarga explícita y no descarta formularios automáticamente.
- Cambiar solo enlaces activos de soporte/diagnóstico al remoto nuevo `https://github.com/juanjoGonDev/HogarIA.git`; conservar IDs/nombres heredados y evidencia histórica.

## Criterios de aceptación

### Test de IA guardado — único y en segundo plano

- [x] La API persiste el estado `testing` antes de responder; la ejecución no espera al proveedor dentro de la petición HTTP. `POST` devuelve `202` y el test guardado corre en una promesa desacoplada de la petición.
- [x] Claim atómico evita duplicados concurrentes y repetición mientras exista una ejecución activa por configuración.
- [x] Navegar, cerrar pestaña o recargar no detiene la ejecución; al volver, la tarjeta muestra que sigue probando y después presenta el estado terminal. E2E cierra la pestaña, reabre con la misma sesión y verifica una sola llamada al proveedor sintético.
- [x] Éxito, error, timeout y caída/reinicio dejan un estado terminal recuperable; no se relanza una prueba real automáticamente ni se mantiene `testing` para siempre.
- [x] El formulario sin guardar sigue sin persistir ni reintentar credenciales. Pruebas cubren deduplicación/carrera, refresh, salida del cliente, reinicio, error redactado y ausencia de secretos.

### Logs — uptime y revisión de imagen

- [x] Logs muestra uptime legible y revisión/tag SHA de la imagen del servidor, con estados de carga/error accesibles e i18n ES/EN.
- [x] `/health` y Logs comparten la misma fuente. En GHCR, la revisión de runtime coincide exactamente con `org.opencontainers.image.revision`; dev/local es explícito (`dev`). El smoke compara el SHA esperado con `/health`.
- [x] Tests de API, Dockerfile/workflow, smoke y componente verifican los metadatos sin exponer secretos.

### Frescura y actualización web

- [x] Nginx y servidor Node revalidan `index.html`, `ngsw.json` y `ngsw-worker.js`; solo assets con hash llevan `immutable`; assets sin hash no mantienen caché larga.
- [x] La app avisa cuando hay una versión nueva y recarga solo tras una acción explícita; también conserva aviso/acción si no se puede activar.
- [x] Tests verifican cabeceras de Node/Nginx y actualización del service worker. En E2E producción se inyecta evento sintético `VERSION_READY`; teclado deja enfocada la acción y la página no recarga automáticamente. Smoke Nginx con assets reales: shell/manifiestos/asset sin hash → `no-cache`; assets con hash → `immutable`.

### Enlaces y verificación final

- [x] Referencias activas en código y contrato apuntan al remoto nuevo; enlaces a PRs/ejecuciones históricas permanecen. Búsqueda final no encontró URL antigua en código activo.
- [x] TDD con DB temporal (`DATABASE_PATH=:memory:` en Vitest/E2E aislado) y proveedor sintético; suites afectadas, tipos y build pasan. Coverage cliente: 90.61/80.99/91.71/93.20 % (S/B/F/L); servidor: 89.55/81.70/95.68/92.50 %.
- [ ] Lint no ejecutable en este checkout: Angular no encuentra `@angular-eslint/builder`; lint del servidor invoca `eslint --ext` incompatible con ESLint 9 y no hay config de servidor; ejecución directa de Angular ESLint no encuentra `@angular-eslint/eslint-plugin`. No añadí dependencias ni cambié gates.
- [x] Playwright real contra frontend/backend con datos sintéticos: escritorio/móvil, refresh/cierre durante prueba, oferta de actualización, teclado/foco y breakpoints (320 px, móvil apaisado 852×393, escritorio 1024/1440). Capturas PC/móvil ignoradas por Git guardadas y revisadas en `.e2e-screenshots/ai-test-running-*`, `.e2e-screenshots/logs-runtime-*` y `.e2e-screenshots/app-update-*`.
- [x] Registrar comandos, resultados y limitaciones aquí. Mantener Draft; no mergear.

## Unidades revisables

1. Estado/deduplicación del test de IA guardado y UI reanudable.
2. Uptime/revisión GHCR y visualización en Logs.
3. Política de caché, detección de versión y actualización explícita.
4. Enlaces activos del repo renombrado y verificación transversal.

El tamaño total supera 400 líneas revisadas. El usuario eligió explícitamente mantener un único PR grande y aceptar la excepción de tamaño; añadir etiqueta `size:exception`, conservar commits atómicos por unidad y explicar el motivo en el PR. No dividir en PRs encadenados.

## Evidencia de ejecución local

- `pnpm run typecheck:e2e`: pasa.
- `pnpm run check:ui`: 268 ficheros, 21 reglas, sin incidencias.
- `pnpm run test:config`: 112/112.
- `pnpm run test:client`: 1729/1729; coverage statements/branches/functions/lines 90.61/80.99/91.71/93.20 %.
- `pnpm run test:server`: 2100 pasan, 1 omitido; entorno de pruebas fuerza `DATABASE_PATH=:memory:`.
- `pnpm run test:server:coverage`: 2100 pasan, 1 omitido; coverage statements/branches/functions/lines 89.55/81.70/95.68/92.50 %. Todos los ficheros cubiertos mantienen los mínimos por fichero existentes (≥70 %).
- `pnpm run build`: pasa; conserva avisos Angular de componentes/specs existentes y presupuestos CSS existentes.
- `pnpm run test:e2e -- tests/e2e/ai-config.spec.ts tests/e2e/logs.spec.ts --project=chromium --project=mobile-chrome`: 68/68, stack dev aislado.
- `node scripts/run-isolated-playwright.mjs tests/e2e/ai-config.spec.ts tests/e2e/logs.spec.ts --grep='one saved AI test survives closing the page|shows synthetic server uptime' --project=chromium --project=mobile-chrome`: 4/4; se repitió tras añadir anchos 320 px y landscape 852×393.
- `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts tests/e2e/full-stack/service-worker-update.spec.ts --project=chromium --project=mobile-chrome`: 2/2, build servido en modo producción y DB temporal.
- `pnpm --filter @hogaria/server exec vitest run src/app.spec.ts`: 13/13.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/services/service-worker-update.service.spec.ts --include=src/app/shared/components/app-update-notice.component.spec.ts`: 11/11.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/environments/environment.spec.ts`: 1/1; repository support URL matches in dev and production.
- `pnpm --filter @hogaria/server exec vitest run src/utils/recipe-step-photos.spec.ts src/utils/recipe-step-videos.spec.ts`: 46/46; Wikimedia User-Agent points to renamed repo.
- `docker run --rm --add-host app:127.0.0.1 --mount "type=bind,source=D:/projects/MiCocinAI/nginx/nginx.conf,target=/etc/nginx/nginx.conf,readonly" --mount "type=bind,source=D:/projects/MiCocinAI/nginx/proxy-api-common.conf,target=/etc/nginx/proxy-api-common.conf,readonly" nginx:alpine nginx -t`: syntax/test OK.
- Smoke Nginx con assets reales montados desde `frontend/dist/browser`: `HEAD` a `/index.html`, `/ngsw.json`, `/ngsw-worker.js`, `/calendar-feature.css` devolvió `200 no-cache`; `/styles-GRZCEKI2.css` y `/main-ZL5QEV7E.js` devolvieron `200 public, max-age=31536000, immutable`. Contenedor temporal detenido y puerto liberado.
- Workflow/container smoke: 12/12.
- `pnpm run lint`: no pasa por herramienta/configuración existente (detalle arriba); no es un fallo de lint de los cambios.
- CI remota pendiente para el HEAD final. No mergear; PR permanece Draft.
