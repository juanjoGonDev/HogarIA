# Perfiles sintéticos y smoke de IA — resultados

**Ejecución:** 26-11-2026 · rama `feat/calendar-recipe-cooking` · PR #72 (Draft).
**Estado:** generador, UI E2E, fallo parcial y matriz loopback de los 11 `AiJobKind` verificados; smoke real de generación IA pendiente por el aislamiento de WebAPI.

## Matriz generada

- 10 cuentas con emails únicos bajo `hogaria.test`: 2 perfiles individuales, 2 miembros de pareja y 6 de hogar numeroso.
- 4 hogares: dos de una persona, pareja de 2 y familia de 6; todos los roles válidos (`admin`, `member`, `child`) aparecen.
- La matriz cubre los niveles de cocina, objetivos, módulos, dietas, tolerancias de picante, tamaños de ración y severidades de alergia del contrato actual.
- El API exige completar el hogar antes de leer/editar el perfil (`HOUSEHOLD_REQUIRED`, HTTP 409). Por eso «solitario» significa cuenta individual con hogar propio de un miembro, no una cuenta sin hogar.
- Registro y login reutilizan la contraseña común del helper E2E; el generador no la duplica. Tokens viven solo en la ejecución/browser aislados. Capturas usan nombres y emails sintéticos.

## Contrato de perfil persistido

- El E2E escribe y vuelve a leer cada perfil por `GET /api/auth/taste`; contrasta objetivos, alergias, gustos, aversiones, notas, nivel de cocina y módulos. La lectura de hogares comprueba miembros/roles.
- `household.schema.ts` declara dietas, picante, ración y severidad, pero su `updateMemberSchema` no está cableado a una ruta vigente. La API activa solo admite alergias por nombre y notas libres; por eso los datos sintéticos adicionales se codifican en `taste.notes`. No se presentan como campos estructurados persistidos ni se escribe SQLite directamente.

## Verificaciones ejecutadas

| Comando                                                                                                                                                                                                                                                               | Resultado                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --test scripts/ai-persona-seeds.test.mjs`                                                                                                                                                                                                                       | PASS · 4/4; determinismo, valores de esquema, rechazo de IDs inseguros y guardas de aislamiento.                                                                                                   |
| `pnpm run test:config`                                                                                                                                                                                                                                                | PASS · 150/150; incluye gates de smoke, privacidad, cancelación y configuración del runner.                                                                                                        |
| `pnpm run typecheck:e2e`                                                                                                                                                                                                                                              | PASS.                                                                                                                                                                                              |
| `pnpm exec prettier --check tests/e2e/ai-real-smoke.spec.ts AI-SEED-PERSONAS-SMOKE-SPEC.md AI-SEED-PERSONAS-SMOKE-RESULTS.md`                                                                                                                                         | PASS · los tres archivos de esta unidad.                                                                                                                                                           |
| `$env:HOGARIA_AI_SEED_GENERATION='1'; node scripts/run-isolated-playwright.mjs --grep 'genera perfiles sintéticos solos y de hogar con la matriz completa'`                                                                                                           | PASS · Chromium; dos proyectos móviles se omiten intencionadamente para evitar duplicar escrituras en la misma DB por ejecución. La app y SQLite fueron aisladas en `hogaria-e2e-*` bajo `%TEMP%`. |
| `$env:HOGARIA_AI_SEED_GENERATION='1'; $env:HOGARIA_AI_SEED_CLEANUP_ON_FAILURE='1'; $env:HOGARIA_AI_SEED_GENERATION_INJECT_FAILURE='after-seed'; node scripts/run-isolated-playwright.mjs --grep 'genera perfiles sintéticos solos y de hogar con la matriz completa'` | PASS · fallo inyectado tras crear 10 usuarios/4 hogares; proceso y puerto propios cerrados, SQLite temporal eliminada; no quedó nuevo directorio `hogaria-e2e-*`.                                  |
| `$env:HOGARIA_AI_SEED_GENERATION='1'; $env:HOGARIA_AI_SEED_CLEANUP_ON_FAILURE='1'; node scripts/run-isolated-playwright.mjs --config=playwright.ai-real-smoke.config.ts --grep 'cubre.*seed'`                                                                         | PASS · 2/2 Playwright; 11 tipos `AiJobKind` probados con cuentas sintéticas, proveedor HTTP loopback y fixture local de fotos; SQLite/app/puertos aislados, sin directorio temporal residual.      |

### Cobertura loopback

- Una cuenta sintética de hogar solo con módulos `shopping` ejercita `connection_test`, `recipe`, `multiple_recipes` (dos respuestas), `recommendations`, `weekly_plan`, `expiry_estimate` y `shopping_photo`.
- Una segunda matriz usa una familia y sus miembros, más la cuenta sola con alergias, para `household_plan`, `assistant`, `receipt` y `product_image_search`. El ticket queda en revisión; el plano y la propuesta de asistente no se aplican.
- El primer test consume ocho respuestas de proveedor para siete tipos; el segundo consume tres. `product_image_search` usa la fixture licenciada local y no sale a Internet.
- Cada test usa un ID de semilla distinto dentro de la misma DB temporal. Se crean 20 cuentas sintéticas y 8 hogares entre ambos tests; el runner elimina la DB, servidor y puertos temporales al terminar.
- Hallazgo del harness, no de producto: crear un ingrediente ya encola su búsqueda de imagen; llamar a `/image-search/retry` tras completar devuelve correctamente `409 IMAGE_SEARCH_ALREADY_COMPLETE`. La prueba observa la búsqueda automática y comprueba tipos únicos, sin exigir un recuento fijo de trabajos auxiliares.

### Fallo parcial y cleanup

- Antes de inyectar el fallo en el generador de perfiles, el test reprodujo que `after-first-account` no abortaba: la aserción de registro único observó 10 altas. Después, la inyección se movió al bucle de registro, inmediatamente tras la primera cuenta.
- Con `HOGARIA_AI_SEED_GENERATION_INJECT_FAILURE=after-first-account`, el E2E aborta intencionadamente tras exactamente un `POST /api/auth/register`; el run termina con error esperado. El supervisor confirma que cerró sus procesos/puertos y eliminó la SQLite/artifacts temporales. Sin directorio `hogaria-e2e-*` residual.

### Regresión i18n y capturas

- La prueba falló primero porque la tarjeta mostraba la clave `profile.cooking.none`; la traducción ya existía, pero `/household` no cargaba el bundle lazy `profile`. Se añadió ese bundle al resolver de la ruta y el E2E ahora exige `Apenas cocino` antes de capturar.
- Post-fix: `node scripts/run-isolated-playwright.mjs --grep 'genera perfiles sintéticos solos y de hogar con la matriz completa'` con opt-in y cleanup — 1 passed, 2 skipped; runner eliminó el entorno temporal. Se regeneraron y revisaron las cuatro capturas PC/móvil; ya no hay clave cruda.

## Capturas sintéticas

Generadas tras esperar contenido visible y comprobar el recuento de miembros; `.e2e-screenshots/` está ignorado por Git.

- Escritorio, cuenta individual: `.e2e-screenshots/ai-persona-seeds/solo-desktop.png`
- Móvil, cuenta individual: `.e2e-screenshots/ai-persona-seeds/solo-mobile.png`
- Escritorio, familia de seis: `.e2e-screenshots/ai-persona-seeds/family-desktop.png`
- Móvil, familia de seis: `.e2e-screenshots/ai-persona-seeds/family-mobile.png`

## Corrección del CI de lockfile

- Los runs `45875190646` y `45875336322` fallaron antes de las pruebas porque siete pins de `server/package.json` no coincidían con `pnpm-lock.yaml`; no era un fallo de las generaciones loopback.
- `3c5432e4` alineó el manifiesto de server y las resoluciones del lockfile sin desactivar `--frozen-lockfile`. La reproducción falló antes del arreglo; instalación frozen aislada pasó después con pnpm 10.15.0 y 1043 paquetes.
- CI run [45878848795 (#1352)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45878848795) pasó 11/11 jobs, incluidos instalación, smokes de contenedor `amd64` y `arm64`, cuatro shards E2E, build, typecheck y pruebas de servidor.
- Tras corregir la secuenciación de foco que falló en #1354, CI run [45890876833 (#1359)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45890876833) pasó 11/11 jobs en `764067a9`, incluidos los cuatro shards E2E.
- CI run [45893533271 (#1361)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45893533271) pasó 11/11 jobs en `eab195fa`; el run anterior #1360 fue cancelado.

## Estado del smoke real de IA

- Revalidación read-only 2026-11-26: el grupo DevBar `IA` sigue ejecutando `dev` en `127.0.0.1:3001`; `/health/ready` informa `ready` y storage listo. Los flags efectivos son `requestLogging.enabled=true`, `captureDetails=true` y `debugMode=true`; el preflight de smoke real falla antes de crear token o llamar al modelo.
- La guía de persistencia de WebAPI documenta que las sesiones operativas normales guardan el prompt completo y el resultado del proveedor en `session_events.content`. Por tanto, no basta con apagar temporalmente el logging del WebAPI normal: un smoke real requiere un WebAPI con DB temporal y estado de proveedor autorizado/aislado.
- No se modificaron los controles, la base de datos ni la sesión existente del WebAPI; no se creó token y no se hizo ninguna llamada real. Los 11 `AiJobKind` sí se ejercitan con proveedor loopback en los E2E aislados descritos arriba.
- Pendiente: establecer el WebAPI de prueba aislado, luego ejecutar la matriz finita existente por flujos/job y perfiles, con presupuesto y limpieza propios. No hacer reintentos ciegos ni afirmar que el modelo real funciona hasta completar ese run.

## Hallazgo UI resuelto

La tarjeta con nivel `none` mostraba literalmente `profile.cooking.none`. La clave ES/EN ya existía, pero el resolver de `/household` no cargaba el bundle lazy `profile`; se añadió a `translationBundlesResolver` y el E2E exige `Apenas cocino` antes de guardar capturas. La prueba reprodujo el defecto antes del arreglo y pasó después. Las capturas sintéticas escritorio/móvil se regeneraron e inspeccionaron.

## Límites

No se ejecutó una generación real de IA, ni se recorrió el producto cartesiano de perfiles. No se declara que «todas las generaciones funcionan». La matriz viva, la cobertura de fallo/timeout/cancelación y gates CI restantes siguen pendientes en `AI-SEED-PERSONAS-SMOKE-SPEC.md`.
