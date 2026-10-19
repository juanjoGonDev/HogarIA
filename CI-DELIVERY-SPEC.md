# CI para PR y entrega GHCR

**Estado:** activo; publicar primero este contrato en el PR #47 antes de cambiar workflows o empaquetado.
**Rama:** `feat/household-floorplan`; trabajar en la rama existente. No abrir otro PR ni cambiar de rama.
**Idioma:** español (España).

## Objetivo y autorización

El usuario autorizó el 2026-10-19 que cada PR ejecute CI y construya/pruebe la imagen de contenedor, que la imagen se publique en GHCR al integrar en la rama principal y que se fusione el PR #47 existente cuando las comprobaciones sean satisfactorias. No se autoriza crear otra PR.

La rama principal verificada del repositorio es `master`. El PR #47 está actualmente abierto y Draft, pero apunta a `arena/01a0a6c2-micocinai`. La comparación local muestra que retargetearlo a `master` incluiría 987 archivos, aproximadamente 322.448 líneas añadidas y 7.397 eliminadas, frente a 463 archivos contra su base actual. La revisión del diff ampliado y de su intención es una condición previa al retarget y merge; no ocultar ni descartar ese alcance.

## Evidencia de partida

- `.github/workflows/ci.yml` filtra `pull_request.branches` a `master` y `main`; por eso el PR que apunta a `arena/...` no recibe esos checks. No incluye `edited`, evento necesario para revalidar un cambio de base.
- La raíz declara `pnpm@10.15.0`, `pnpm-lock.yaml` y dos paquetes workspace (`frontend`, `server`); el Dockerfile actual usa `npm ci` con `package*.json` y no hay lockfiles npm.
- La imagen ejecuta el servidor Node y SQLite (`better-sqlite3`), sirve `frontend/dist`, y define `/health` como healthcheck.
- El repositorio es público y su imagen debe incluir `linux/amd64` y `linux/arm64`; validar ambas arquitecturas antes de publicar.

## Decisiones de seguridad y entrega

- Para cada PR, incluidos forks y cualquier rama base, ejecutar los checks existentes y compilar la imagen sin publicar a ningún registry. Build y smoke no reciben permisos de escritura de packages, credenciales de WebAPI/proveedor IA ni tokens privados.
- El smoke del contenedor usa solo datos sintéticos/DB efímera; comprueba arranque, health/API HTTP y contenido estático servido por la imagen. No llama proveedores externos.
- La publicación se limita a un `push` en `master`, con permisos mínimos (`contents: read`, `packages: write` solo en el job publicador), y crea tags inmutables por SHA más `latest`. El nombre GHCR se normaliza a minúsculas.
- Tras publicar, consultar el manifest y hacer pull/arranque/health smoke de la imagen GHCR real. Comprobar ambas plataformas declaradas; no afirmar una verificación que no se ejecutó.
- Mantener el PR Draft hasta que los gates y el diff hacia `master` se hayan validado. Luego convertir en ready y usar squash, el único método habilitado por el repositorio. No mergear con checks pendientes/rojos.

## Checklist de aceptación

- [x] Publicar este contrato (`6c313df`) y enlazarlo en el cuerpo del PR #47 Draft antes de implementar.
- [ ] Hacer que `pull_request` ejecute CI para cualquier base y ante `opened`, `reopened`, `synchronize`, `ready_for_review` y `edited`.
- [x] Añadir una prueba determinista del contrato del workflow: triggers sin filtro de base, build de PR sin push/credenciales, publisher solo en `master`, y permisos GHCR mínimos. `pnpm run test:config`: 104/104.
- [x] Reemplazar `npm ci` por una instalación/build reproducible con workspace y lockfile pnpm; incluir `.dockerignore` y dependencias de compilación necesarias sin cargarlas a producción. Docker build `linux/amd64` y `linux/arm64` pasaron localmente.
- [ ] Para cada PR, compilar y ejecutar smoke de la imagen en `linux/amd64` y `linux/arm64`; usar runtime efímero y validar health, API y app estática.
- [ ] En push a `master`, publicar multi-arquitectura a `ghcr.io/<owner>/<repo>` con tags SHA y `latest`, y ejecutar smoke contra el digest publicado.
- [x] Pasan `make ci-yaml`, `make ci-ui`, `make ci-e2e-types`, `pnpm run test:config` (104/104), `actionlint` y `git diff --check`.
- [x] Docker build y runtime smoke local en `linux/amd64` y `linux/arm64`: `/health`, `/api/health`, HTML, ruta protegida del asistente (401 sin token) y `HEALTHCHECK=healthy`.
- [ ] Pre-push completo y run real del PR completan verdes.
- [ ] Revisar el diff completo del PR #47 contra `master`; retargetear el PR existente (sin crear uno nuevo) y obtener un run verde sobre esa base.
- [ ] Fusionar el PR #47 existente a `master` solo después de los checks verdes; verificar SHA de merge, manifest/plataformas/tag GHCR y arranque de la imagen publicada.
- [ ] Registrar comandos, resultados, limitaciones, commits y estado del working tree; preservar Draft si cualquier aceptación queda pendiente.

## Fuera de alcance

No habilitar IA real ni enviar prompts desde CI. No crear cuentas/secretos de proveedores. No tocar bases de datos habituales, cambiar dependencias de la app, crear una PR/branch, forzar pushes ni modificar gates funcionales ajenos.

## Evidencia local — 2026-10-19

- `node scripts/check-workflows.mjs` valida los 6 workflows; `actionlint` valida `.github/workflows/ci.yml` y `.github/workflows/publish-ghcr.yml` sin incidencias.
- `pnpm run test:config`: 104/104. Incluye 12 pruebas de smoke/plataformas/contrato de entrega.
- `make ci-yaml`, `make ci-ui` (266 ficheros, 21 reglas) y `make ci-e2e-types` pasan. Se sustituyeron nombres inválidos de targets con dos puntos (`ci:yaml`, `ci:ui`, `ci:e2e-types`) por targets invocables con guion; `make ci:yaml` fallaba en GNU Make de Windows.
- `docker build --platform linux/amd64 --tag hogaria-ci:pr47-final-amd64 .` y equivalente `linux/arm64` completan; ambas imágenes ejecutan el smoke anterior y llegan a `HEALTHCHECK=healthy`. DB está en tmpfs y JWT es aleatorio; ambos contenedores se eliminaron.
- Quedan por ejecutar el pre-push completo, el run real de CI sobre PR #47, revisar el diff completo con base `master`, publicar/pullar GHCR, y validar el artefacto publicado. No se ha llamado a WebAPI ni a un proveedor IA en CI/local smoke.
