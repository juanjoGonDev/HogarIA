# CI para PR y entrega GHCR

**Estado:** activo; publicar primero este contrato en el PR #47 antes de cambiar workflows o empaquetado.
**Rama:** `feat/household-floorplan`; trabajar en la rama existente. No abrir otro PR ni cambiar de rama.
**Idioma:** español (España).

## Objetivo y autorización

El usuario autorizó el 2026-10-19 que cada PR ejecute CI y construya/pruebe la imagen de contenedor, que la imagen se publique en GHCR al integrar en la rama principal y que se fusione el PR #47 existente cuando las comprobaciones sean satisfactorias. No se autoriza crear otra PR.

La rama principal verificada del repositorio es `master`. El PR #47 estaba abierto y Draft contra `arena/01a0a6c2-micocinai`; el 2026-10-19 se retargeteó el PR existente a `master`, sin crear rama ni PR. En ese momento, la comparación pasó de 473 archivos (133.178 altas / 6.461 bajas) a 995 (323.183 / 7.430), por 976 commits existentes desde `master` hasta `arena` más 418 commits del PR. El diff ampliado se revisó en rutas, alcance y patrones de credenciales antes del cambio; no ocultar ni descartar ese alcance.

## Evidencia de partida

- `.github/workflows/ci.yml` filtra `pull_request.branches` a `master` y `main`; por eso el PR que apunta a `arena/...` no recibe esos checks. No incluye `edited`, evento necesario para revalidar un cambio de base.
- La raíz declara `pnpm@10.15.0`, `pnpm-lock.yaml` y dos paquetes workspace (`frontend`, `server`); el Dockerfile actual usa `npm ci` con `package*.json` y no hay lockfiles npm.
- La imagen ejecuta el servidor Node y SQLite (`better-sqlite3`), sirve `frontend/dist`, y define `/health` como healthcheck.
- El repositorio es público y su imagen debe incluir `linux/amd64` y `linux/arm64`; validar ambas arquitecturas antes de publicar.

## Decisiones de seguridad y entrega

- Para cada PR, incluidos forks y cualquier rama base, ejecutar los checks existentes y compilar la imagen sin publicar a ningún registry. Build y smoke no reciben permisos de escritura de packages, credenciales de WebAPI/proveedor IA ni tokens privados.
- La exportación de cache BuildKit es best-effort: los builds no fallan si un evento de bajo privilegio no puede guardar cache. No ampliar permisos de cache para forks.
- El smoke del contenedor usa solo datos sintéticos/DB efímera; comprueba arranque, health/API HTTP y contenido estático servido por la imagen. No llama proveedores externos.
- La publicación se limita a un `push` en `master`, con permisos mínimos (`contents: read`, `packages: write` solo en el job publicador), y crea tags inmutables por SHA más `latest`. El nombre GHCR se normaliza a minúsculas.
- Tras publicar, consultar el manifest y hacer pull/arranque/health smoke de la imagen GHCR real. Comprobar ambas plataformas declaradas; no afirmar una verificación que no se ejecutó.
- Mantener el PR Draft hasta que los gates y el diff hacia `master` se hayan validado. Luego convertir en ready y usar squash, el único método habilitado por el repositorio. No mergear con checks pendientes/rojos.

## Checklist de aceptación

- [x] Publicar este contrato (`6c313df`) y enlazarlo en el cuerpo del PR #47 Draft antes de implementar.
- [x] Hacer que `pull_request` ejecute CI para cualquier base y ante `opened`, `reopened`, `synchronize`, `ready_for_review` y `edited`; se verificó el evento `edited` al retargetear a `master` y el run 807 completó verde.
- [x] Añadir una prueba determinista del contrato del workflow: triggers sin filtro de base, build de PR sin push/credenciales, publisher solo en `master`, y permisos GHCR mínimos. `pnpm run test:config`: 104/104.
- [x] Reemplazar `npm ci` por una instalación/build reproducible con workspace y lockfile pnpm; incluir `.dockerignore` y dependencias de compilación necesarias sin cargarlas a producción. Docker build `linux/amd64` y `linux/arm64` pasaron localmente.
- [x] Para cada PR, compilar y ejecutar smoke de la imagen en `linux/amd64` y `linux/arm64`; usar runtime efímero y validar health, API y app estática. Run #807 pasó ambas arquitecturas en el PR #47.
- [ ] En push a `master`, publicar multi-arquitectura a `ghcr.io/<owner>/<repo>` con tags SHA y `latest`, y ejecutar smoke contra el digest publicado.
- [x] Pasan `make ci-yaml`, `make ci-ui`, `make ci-e2e-types`, `pnpm run test:config` (104/104), `actionlint` y `git diff --check`.
- [x] Docker build y runtime smoke local en `linux/amd64` y `linux/arm64`: `/health`, `/api/health`, HTML, ruta protegida del asistente (401 sin token) y `HEALTHCHECK=healthy`.
- [x] Pre-push completo verde en `5ba77b4`: formato, UI, build, E2E typecheck, configuración, cliente y servidor.
- [x] El run real de CI del PR termina verde en la base `master`: run #807, 11/11 jobs verdes, incluidas 4 shards E2E y full-stack.
- [x] Revisar el diff ampliado y retargetear el PR existente a `master`; conservar explícito el alcance adicional en el cuerpo del PR.
- [ ] Fusionar el PR #47 existente a `master` solo después de los checks verdes; verificar SHA de merge, manifest/plataformas/tag GHCR y arranque de la imagen publicada.
- [ ] Registrar resultados finales, limitaciones, commits y estado del working tree; preservar Draft si cualquier aceptación queda pendiente.

## Fuera de alcance

No habilitar IA real ni enviar prompts desde CI. No crear cuentas/secretos de proveedores. No tocar bases de datos habituales, cambiar dependencias de la app, crear una PR/branch, forzar pushes ni modificar gates funcionales ajenos.

## Evidencia local — 2026-10-19

- `node scripts/check-workflows.mjs` valida los 6 workflows; `actionlint` valida `.github/workflows/ci.yml` y `.github/workflows/publish-ghcr.yml` sin incidencias.
- `pnpm run test:config`: 104/104. Incluye 12 pruebas de smoke/plataformas/contrato de entrega.
- `make ci-yaml`, `make ci-ui` (266 ficheros, 21 reglas) y `make ci-e2e-types` pasan. El commit `05c8dd3` sustituyó targets no invocables con dos puntos (`ci:yaml`, `ci:ui`, `ci:e2e-types`) por targets con guion.
- `docker build --platform linux/amd64 --tag hogaria-ci:pr47-final-amd64 .` y equivalente `linux/arm64` completan; ambas imágenes ejecutan el smoke anterior y llegan a `HEALTHCHECK=healthy`. DB está en tmpfs y JWT es aleatorio; ambos contenedores se eliminaron.
- Pre-push completo en `5ba77b4`: `node scripts/check-push-format.mjs` (3 rutas), `pnpm run check:ui` (266/21), `pnpm run build` (éxito, advertencias existentes), `pnpm run typecheck:e2e`, y `pnpm run test` (config 104/104, cliente 1709/1709 con 90,62/80,96/91,73/93,18 % S/B/F/L; servidor 2082 pasados, 1 omitido). Duración del hook: 102 s.
- Retarget y revisión del diff a `master` completados. Run #807 (`5ba77b4`) terminó verde con 11/11 jobs: instalación, amd64/arm64 build+smoke, typecheck, server coverage, producción, 4 shards E2E y full-stack. Falta publicar/pullar GHCR y validar el artefacto publicado. `ing.json` es una respuesta de datos seed genéricos (20/69 ingredientes; un ID opaco de usuario/hogar, sin notas, imágenes, email ni credenciales) y no tiene referencias en el código. No se ha llamado a WebAPI ni a un proveedor IA en CI/local smoke.
