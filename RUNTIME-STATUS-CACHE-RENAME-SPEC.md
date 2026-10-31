# HogarIA — prueba de IA en segundo plano, runtime y actualización web

**Estado:** contrato activo; implementación pendiente.
**Base:** `origin/master` en `b4bc0c8` (rama predeterminada real: `master`).
**Rama:** `feat/runtime-operations-ui`.
**PR funcional:** Draft; abrir antes de implementar. El PR #62 solo revirtió el push accidental y ya está mergeado.

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
- URLs activas antiguas aparecen en `frontend/src/environments/environment.ts`, `environment.prod.ts` y los User-Agent de fotos/vídeos (`server/src/utils/recipe-step-photos.ts`, `recipe-step-videos.ts`). `HOGARIA-SPEC.md` contiene referencias históricas/de migración que no se reescriben sin necesidad.

## Decisiones

- Una prueba de configuración **guardada** se reclama atómicamente por configuración, persiste `testing` antes de aceptar el trabajo y continúa independientemente de la petición HTTP o pestaña. Mientras está activa, repetir la acción devuelve/consulta el mismo estado; no lanza un segundo ping.
- Recargar o abrir Ajustes de nuevo recupera `testing` desde la API y mantiene la indicación hasta resultado terminal. Cerrar la pestaña no cancela el trabajo. Si el proceso muere, el siguiente arranque cierra como interrumpido cualquier estado activo obsoleto; nunca relanza una llamada externa implícitamente.
- El test del formulario sin guardar conserva su flujo efímero y no persiste credenciales. No guardar claves en jobs, respuestas de estado, logs, URLs, `localStorage` ni telemetría; redactar los errores.
- La revisión mostrada en Logs procede del mismo SHA inyectado en runtime que `org.opencontainers.image.revision`; local/dev muestra un valor explícito. No se inspecciona Docker ni otros contenedores.
- El shell y manifiestos/worker de Angular se revalidan; solo recursos con nombre hash conservan caché larga e inmutable. Si Angular detecta una versión nueva, muestra una acción de recarga explícita y no descarta formularios automáticamente.
- Cambiar solo enlaces activos de soporte/diagnóstico al remoto nuevo `https://github.com/juanjoGonDev/HogarIA.git`; conservar IDs/nombres heredados y evidencia histórica.

## Criterios de aceptación

### Test de IA guardado — único y en segundo plano

- [ ] La API persiste el estado `testing` antes de responder; la ejecución no espera al proveedor dentro de la petición HTTP.
- [ ] Claim atómico evita duplicados concurrentes y repetición mientras exista una ejecución activa por configuración.
- [ ] Navegar, cerrar pestaña o recargar no detiene la ejecución; al volver, la tarjeta muestra que sigue probando y después presenta el estado terminal.
- [ ] Éxito, error, timeout y caída/reinicio dejan un estado terminal recuperable; no se relanza una prueba real automáticamente ni se mantiene `testing` para siempre.
- [ ] El formulario sin guardar sigue sin persistir ni reintentar credenciales. Pruebas cubren deduplicación/carrera, refresh, salida del cliente, reinicio, error redactado y ausencia de secretos.

### Logs — uptime y revisión de imagen

- [ ] Logs muestra uptime legible y revisión/tag de la imagen del servidor, con estados de carga/error accesibles e i18n ES/EN.
- [ ] `/health` y Logs comparten la misma fuente. En GHCR, la revisión de runtime coincide exactamente con `org.opencontainers.image.revision`; dev/local es explícito.
- [ ] Tests de API, build de contenedor y componente verifican los metadatos sin exponer secretos.

### Frescura y actualización web

- [ ] Nginx y servidor Node revalidan `index.html`, `ngsw.json` y `ngsw-worker.js`; solo assets con hash llevan `immutable`; assets sin hash no mantienen caché larga.
- [ ] La app avisa cuando hay una versión nueva y recarga solo tras una acción explícita; probar también el caso sin actualización.
- [ ] Tests verifican cabeceras reales/contrato de Nginx y actualización del service worker.

### Enlaces y verificación final

- [ ] Referencias activas apuntan al remoto nuevo; referencias de compatibilidad/migración e históricas permanecen.
- [ ] TDD con DB aislada/temporal y proveedores externos simulados; ejecutar pruebas focales, suites afectadas, lint, tipos y build. Alcance nuevo/modificado ≥70 % en statements, branches, functions y lines sin rebajar gates superiores.
- [ ] Playwright real contra frontend/backend con datos sintéticos: escritorio y móvil, refresh durante prueba, cierre/navegación, oferta de actualización, teclado/foco y breakpoints. Guardar capturas PC/móvil ignoradas por Git y revisar geometría afectada (≤1 CSS px).
- [ ] Registrar comandos, resultados y limitaciones aquí. Marcar `[x]` solo con evidencia reproducible. Mantener Draft y no mergear.

## Unidades revisables

1. Estado/deduplicación del test de IA guardado y UI reanudable.
2. Uptime/revisión GHCR y visualización en Logs.
3. Política de caché, detección de versión y actualización explícita.
4. Enlaces activos del repo renombrado y verificación transversal.

El tamaño total puede superar 400 líneas revisadas; tras estimar cada unidad, dividir en PRs encadenados si supera ese umbral, manteniendo pruebas con el comportamiento que validan.
