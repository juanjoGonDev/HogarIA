# HogarIA: test de conexión, diagnóstico y actualización de la web

**Estado:** Draft — implementación y gates locales verificados; CI remoto del HEAD final pendiente.
**Rama/PR:** `feat/ai-provider-settings` / Draft PR #56. No mergear.
**Base:** `origin/master` integrado en `6280148`.

## Objetivo

Completar el flujo de prueba de conexión de IA independiente del navegador, mostrar estado del proceso e imagen en Logs, y evitar servir una versión web desactualizada tras una publicación. Actualizar los enlaces de soporte activos tras el renombre del repositorio.

## Decisiones y evidencia inicial

- El test guardado ya reclama `test_status='testing'` de forma atómica y usa la cola de IA sin propagar `Request.signal`; cerrar la pestaña no cancela el trabajo del servidor. La UI carga y consulta ese estado. Falta un E2E que cierre la pestaña que inició el test y confirme resultado y ausencia de duplicado.
- `/api/health` ya devuelve `uptime`, pero la vista Logs no lo consulta ni lo muestra. El tag de imagen no está disponible en runtime; el workflow publica el manifiesto con SHA y `latest`.
- El service worker también cacheaba `/api/health` durante 1 h; se debe excluir ese endpoint para que uptime y referencia de imagen no queden obsoletos.
- El servidor entrega `index.html` con `Cache-Control: no-cache` y chunks hasheados como `immutable`, pero falta revalidación de `ngsw.json` y gestión explícita de `VERSION_READY`/recarga.
- El remote ya apunta a `https://github.com/juanjoGonDev/HogarIA.git`; los enlaces de soporte activos y algunos `User-Agent` aún apuntan a `MiCocinAI`. Los enlaces de ejecuciones históricas no se reescriben.

## Checklist de aceptación

- [x] Probar una configuración guardada crea un único trabajo persistente; el estado «En curso» se ve tras cerrar la pestaña iniciadora y abrir otra, el proceso concluye y no se reenvía/duplica el test. Playwright confirma un `POST` y una solicitud al proveedor sintético.
- [x] Los logs muestran tiempo de actividad del proceso actualizado y tag exacto de la imagen GHCR; builds locales indican claramente que el tag no corresponde a una publicación.
- [x] `index.html`, `manifest.json` y el manifiesto/workers del service worker se revalidan; al detectar una versión nueva, Angular activa la versión y recarga. Los chunks con hash siguen siendo `immutable`; `/api/health` queda fuera del caché de datos del service worker.
- [x] Actualizar a `https://github.com/juanjoGonDev/HogarIA` los enlaces activos del producto, configuración y agentes HTTP; conservar URLs históricas de runs/PRs.
- [x] Añadir pruebas unitarias/integración y Playwright con datos sintéticos para los casos anteriores; comprobar escritorio y móvil y guardar capturas ignoradas por Git.
- [ ] Verificar cobertura, build, typecheck, suite full-stack aislada y **CI remota en el HEAD final**. Mantener el PR Draft. Los gates locales pasan; solo falta CI remoto final.

## Evidencia local reproducible

- `pnpm run test:coverage`: frontend **1,760/1,760**, coverage **90.54/80.95/91.86/93.14 %** (statements/branches/functions/lines); servidor **2,125 tests + 1 skip**, coverage **89.70/81.82/95.56/92.66 %**.
- `pnpm run test:config`: **111/111**; `pnpm run check:ui`: **270 archivos, 21 reglas, sin incidencias**; `pnpm run typecheck:e2e`: pasa; `pnpm run build`: pasa con warnings Angular/SCSS existentes.
- Server focal (static cache, health, URL de fotos/vídeos): `pnpm --filter @hogaria/server exec vitest run src/app.spec.ts src/routes/health.routes.spec.ts src/utils/recipe-step-photos.spec.ts src/utils/recipe-step-videos.spec.ts` — **61/61**.
- Frontend focal (logs, i18n, actualización, enlaces): `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/services/log.service.spec.ts --include=src/app/features/logs/logs.component.spec.ts --include=src/app/core/i18n/dict/logs.spec.ts --include=src/app/core/services/app-update.service.spec.ts --include=src/environments/environment.spec.ts --browsers=ChromeHeadless` — **28/28**.
- Logs real app/API, tag sintético y escritorio/móvil: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/logs.spec.ts --grep 'shows server uptime'` — **2/2**. Capturas revisadas: `.e2e-screenshots/logs-runtime/chromium-runtime-info.png` y `mobile-chrome-runtime-info.png` (ignoradas por Git).
- App servida full-stack aislada, cierre de pestaña del test de IA, rate limit por proyecto y headers no-cache: `CI=true node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome tests/e2e/full-stack/rate-limit.spec.ts tests/e2e/full-stack/ai-provider-settings.spec.ts tests/e2e/full-stack/served-app.spec.ts` — **22 passed, 2 skips esperados**. SQLite y artefactos quedan en temp y se limpian.
- Nginx conserva X-Frame-Options/X-Content-Type-Options y sus ubicaciones no-cache se validan por contrato de configuración; no se ejecutó un contenedor Nginx real.

## Seguridad y aislamiento

- No guardar ni incluir API keys en jobs/logs/capturas. Para E2E, usar solo el proveedor HTTP sintético existente y SQLite temporal aislada.
- No borrar/cambiar datos, migrar servicios remotos, publicar imágenes ni desplegar como parte de esta tarea.
