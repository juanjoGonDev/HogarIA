# CI para PR y entrega GHCR

**Estado:** remediación correctiva GHCR en curso; PR #57 se fusionó en `master` el 2026-10-20 y falló el paso de verificación del manifest (run `39440320698`).
**Rama:** PR correctiva Draft nueva contra `master`; preservar sin cambios la rama/worktree local existente.
**Idioma:** español (España).

## Objetivo y autorización

El usuario autorizó el 2026-10-19 que cada PR ejecute CI y construya/pruebe la imagen de contenedor, que la imagen se publique en GHCR al integrar en la rama principal y que se fusione el PR #47 existente cuando las comprobaciones sean satisfactorias. Tras fallar la publicación GHCR del merge, el usuario autorizó explícitamente abrir una PR correctiva. No hay autorización de merge para esta PR correctiva.

La rama principal verificada del repositorio es `master`. El PR #47 estaba abierto y Draft contra `arena/01a0a6c2-micocinai`; el 2026-10-19 se retargeteó el PR existente a `master`, sin crear rama ni PR. En ese momento, la comparación pasó de 473 archivos (133.178 altas / 6.461 bajas) a 995 (323.183 / 7.430), por 976 commits existentes desde `master` hasta `arena` más 418 commits del PR. El diff ampliado se revisó en rutas, alcance y patrones de credenciales antes del cambio; no ocultar ni descartar ese alcance.

## Evidencia de partida

- `.github/workflows/ci.yml` filtra `pull_request.branches` a `master` y `main`; por eso el PR que apunta a `arena/...` no recibe esos checks. No incluye `edited`, evento necesario para revalidar un cambio de base.
- La raíz declara `pnpm@10.15.0`, `pnpm-lock.yaml` y dos paquetes workspace (`frontend`, `server`); el Dockerfile actual usa `npm ci` con `package*.json` y no hay lockfiles npm.
- La imagen ejecuta el servidor Node y SQLite (`better-sqlite3`), sirve `frontend/dist`, y define `/health` como healthcheck.
- El repositorio es público y su imagen debe incluir `linux/amd64` y `linux/arm64`; validar ambas arquitecturas antes de publicar.

## Hallazgo posterior a la integración — 2026-10-19

- El PR #47 se fusionó por squash en `master` como `184784b170698f06e047bd8ff985c6f562b69700`. CI de `push` terminó verde: run `39249240520`, 11/11 jobs, incluidos los smokes de imagen amd64 y arm64.
- El publicador GHCR (`39249240518`) expiró y fue cancelado al límite de 50 minutos. El log reproducible muestra `qemu: uncaught target signal 4 (Illegal instruction)` en `linux/arm64 runtime-deps`, durante `pnpm install ... better-sqlite3`; la imagen/tag SHA no llegó a publicarse. Los builds separados amd64/arm64 del CI sí pasan.
- Remediación elegida: construir/publicar cada arquitectura en su runner nativo (`ubuntu-24.04` y `ubuntu-24.04-arm`), sin QEMU; después ensamblar el índice OCI SHA/`latest`, comprobar plataformas/digest y hacer pull + smoke de cada miembro en su runner nativo. Así se elimina la emulación arm64 donde se observó el `SIGILL`. El workflow usa `COMMIT_SHA` en vez de redefinir el entorno reservado `GITHUB_SHA`.

## Hallazgo tras integrar PR #57 — 2026-10-20

- El push de merge `a260abde75f7c09acd690f2b9511bb2256db078d` construyó y publicó correctamente ambos manifests nativos; `imagetools create` terminó con éxito y publicó el índice `sha256:ac7e1c9f032cbb42ef74591757f5dab60e588064df964618e2d27b1d150d0ad9` para tags SHA y `latest`.
- Run `39440320698`, job `118689249438`, falló inmediatamente después con exit 255 en la captura `docker buildx imagetools inspect ... | awk ... { print $2; exit }`, mientras `set -o pipefail` estaba activo. La inspección local del tag confirma que el índice OCI sí contiene digest y plataformas amd64/arm64. El patrón de salida temprana de `awk` puede cerrar el pipe antes de que Buildx termine; la corrección debe consumir y parsear la salida estructurada completa para evitar SIGPIPE y validar el digest explícitamente.
- El usuario autorizó corregir, hacer push y fusionar esta remediación solo tras CI verde. No omitir reglas de branch protection ni usar bypass; si un gate requerido no está disponible, dejar el PR sin fusionar e informar el bloqueo.

### Checklist de esta remediación

- [ ] Abrir PR correctiva Draft contra `master` con esta spec antes de implementar.
- [ ] Añadir pruebas deterministas para extraer un digest OCI válido y rechazar JSON/digest inválido.
- [ ] Cambiar la extracción y comparación de digests del workflow a JSON estructurado consumido por completo; quitar el pipe `awk` con salida temprana.
- [ ] Verificar pruebas del helper, contrato del workflow, validación YAML/actionlint y gates locales requeridos.
- [ ] CI de la PR pasa; publicar la PR como ready y fusionarla por squash sin bypass.
- [ ] Observar el run post-merge de publicación GHCR: tags SHA/`latest` con digest común, plataformas amd64/arm64 y smokes nativos verdes.
- [ ] Dejar limpios los cambios locales propios y retirar solo el worktree temporal de esta remediación.

## Remediación correctiva autorizada

- El usuario autorizó una PR correctiva, no un push directo a `master`. Crear la PR en Draft con esta spec antes de publicar la implementación; usar base `master` y una rama dedicada sin cambiar la rama/worktree activa.
- Mantener la PR en Draft y no fusionarla sin autorización explícita posterior. La autorización de merge anterior correspondía al PR #47, ya integrado.
- PR correctiva #55 está en Draft contra `master`; implementación publicada como `2908b1a`. CI de implementación pasó 11/11 en el run #838 (`b0631f8`); publicación GHCR real sigue pendiente.
- Incidencia de entrega: el commit spec-only `ca93ca1` llegó a `master` porque la rama nueva heredó `origin/master` como upstream y el push sin refspec explícito resolvió ese destino. Ese commit modifica solo este archivo; el fix de workflow/código no se incluyó. No se reescribirá historia; el código restante se publicará únicamente en la PR correctiva.
- Criterios de aceptación de esta corrección:
  - [ ] La compilación de cada arquitectura publicada corre en runner nativo, sin QEMU.
  - [ ] El manifest OCI SHA y `latest` incluyen `linux/amd64` y `linux/arm64`, comparten digest verificado y pasan la comprobación de plataformas.
  - [ ] Se ejecuta smoke de pull, arranque y health/API en cada runner nativo contra la imagen publicada.
  - [x] Las pruebas deterministas cubren runners, montaje/verificación del manifest, tags y smokes; no se publica desde pull requests. `node --test scripts/ci-delivery-workflows.test.mjs` (4/4) y `pnpm run test:config` (104/104).
  - [x] CI de la PR correctiva pasa todos los jobs requeridos: run #838, 11/11 jobs; smokes arm64/amd64 y los cuatro shards E2E pasaron.
  - [ ] Image publish en `master` se verifica tras integrar la PR correctiva.

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
- [ ] Publicar cada plataforma en un runner nativo, ensamblar los tags GHCR SHA y `latest`, comprobar el índice OCI y ejecutar smoke contra la imagen publicada en ambas arquitecturas nativas.
- [x] Pasan `make ci-yaml`, `make ci-ui`, `make ci-e2e-types`, `pnpm run test:config` (104/104), `actionlint` y `git diff --check`.
- [x] Docker build y runtime smoke local en `linux/amd64` y `linux/arm64`: `/health`, `/api/health`, HTML, ruta protegida del asistente (401 sin token) y `HEALTHCHECK=healthy`.
- [x] Pre-push completo verde en `5ba77b4`: formato, UI, build, E2E typecheck, configuración, cliente y servidor.
- [x] El run real de CI del PR termina verde en la base `master`: run #807, 11/11 jobs verdes, incluidas 4 shards E2E y full-stack.
- [x] Revisar el diff ampliado y retargetear el PR existente a `master`; conservar explícito el alcance adicional en el cuerpo del PR.
- [x] Fusionar el PR #47 existente a `master` tras CI verde: merge `184784b170698f06e047bd8ff985c6f562b69700`; CI de push `39249240520`, 11/11 jobs.
- [ ] Verificar en vivo el manifest, tags, digest y arranque de la imagen GHCR publicada; el primer intento falló antes de publicar.
- [ ] Registrar resultados finales, limitaciones, commits y estado del working tree.

## Fuera de alcance

No habilitar IA real ni enviar prompts desde CI. No crear cuentas/secretos de proveedores. No tocar bases de datos habituales, cambiar dependencias de la app, hacer push directo a `master`, omitir branch protection, forzar pushes ni modificar gates funcionales ajenos.

## Evidencia local — 2026-10-19

- `node scripts/check-workflows.mjs` valida los 6 workflows; `actionlint` valida `.github/workflows/ci.yml` y `.github/workflows/publish-ghcr.yml` sin incidencias.
- `pnpm run test:config`: 104/104. Incluye 12 pruebas de smoke/plataformas/contrato de entrega.
- PR #55: `node --test scripts/ci-delivery-workflows.test.mjs` (4/4), `pnpm run test:config` (104/104), `node scripts/check-workflows.mjs` (6 workflows), `actionlint` para CI/publicación y `git diff --check` pasan. Hook pre-push completo para `2908b1a` pasó: formato, UI, build, E2E typecheck y suites. CI remoto #838 pasó 11/11 jobs; publicación nativa y smoke contra GHCR siguen pendientes de integración en `master`.
- Remediación del publicador validada localmente: `node --test scripts/ci-delivery-workflows.test.mjs` (4/4), `pnpm run test:config` (104/104), `node scripts/check-workflows.mjs` (6 workflows) y `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml .github/workflows/publish-ghcr.yml` pasan. El nuevo flujo aún requiere verificación real de GHCR tras push.
- `make ci-yaml`, `make ci-ui` (266 ficheros, 21 reglas) y `make ci-e2e-types` pasan. El commit `05c8dd3` sustituyó targets no invocables con dos puntos (`ci:yaml`, `ci:ui`, `ci:e2e-types`) por targets con guion.
- `docker build --platform linux/amd64 --tag hogaria-ci:pr47-final-amd64 .` y equivalente `linux/arm64` completan; ambas imágenes ejecutan el smoke anterior y llegan a `HEALTHCHECK=healthy`. DB está en tmpfs y JWT es aleatorio; ambos contenedores se eliminaron.
- Pre-push completo en `5ba77b4`: `node scripts/check-push-format.mjs` (3 rutas), `pnpm run check:ui` (266/21), `pnpm run build` (éxito, advertencias existentes), `pnpm run typecheck:e2e`, y `pnpm run test` (config 104/104, cliente 1709/1709 con 90,62/80,96/91,73/93,18 % S/B/F/L; servidor 2082 pasados, 1 omitido). Duración del hook: 102 s.
- Retarget y revisión del diff a `master` completados. Run #807 (`5ba77b4`) terminó verde con 11/11 jobs: instalación, amd64/arm64 build+smoke, typecheck, server coverage, producción, 4 shards E2E y full-stack. Falta publicar/pullar GHCR y validar el artefacto publicado. `ing.json` es una respuesta de datos seed genéricos (20/69 ingredientes; un ID opaco de usuario/hogar, sin notas, imágenes, email ni credenciales) y no tiene referencias en el código. No se ha llamado a WebAPI ni a un proveedor IA en CI/local smoke.
