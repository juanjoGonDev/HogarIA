# Perfiles sintéticos y smoke de IA — resultados

**Ejecución inicial:** 26-11-2026 · **Actualización:** 27-11-2026 · rama `feat/calendar-recipe-cooking` · PR #72 (Draft).
**Estado:** generador, UI E2E, fallo parcial y matriz loopback de los 11 `AiJobKind` verificados. Hubo 11 respuestas reales de `gpt-5` en un WebAPI temporal aislado. En la revalidación posterior autorizada, las llamadas de receta y conexión sí llegaron al WebAPI DevBar de `localhost:3001`, pero el proveedor terminó ambas en `internal_error`; no son respuestas generadas y la matriz completa sigue pendiente.

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

## DB demo persistente y comandos

- La SQLite se conserva solo en `.tmp/ai-persona-demo/hogaria.sqlite` (ignorada por Git), con marker sin secretos `.seeded`; el reset controlado elimina DB, sidecars SQLite y marker, no otros ficheros ni procesos.
- Scripts disponibles: `pnpm demo` (seed idempotente + app loopback), `pnpm demo:seed`, `pnpm demo:db:reset` y `pnpm demo:regenerate` (reset + seed + smoke WebAPI real opt-in).
- `pnpm demo:db:reset` y `pnpm demo:seed` se ejecutaron sobre la DB demo dedicada. El seed creó por API local 10 usuarios/4 hogares; la repetición detectó el marker y no volvió a registrar. Una consulta SQLite de solo lectura confirmó `users=10`, `households=4`, marker presente.
- Revalidación read-only 2026-11-27 de `.tmp/ai-persona-demo/hogaria.sqlite` con conexión `readonly`: `users=10`, `households=4`, tamaños `[6,1,1,2]`. No se tocó la DB normal ni se mostraron emails.
- El contrato del CLI verifica que el seed usa el supervisor Playwright local con ambos flags demo y ruta exacta; y que `regenerate` ordena reset → seed → únicamente `scripts/run-ai-real-smoke.mjs`, con `HOGARIA_AI_REAL_SMOKE=1` y sin heredar claves de proveedor.
- `pnpm demo` inició API y frontend en puertos loopback efímeros, respondió health/UI y reutilizó la DB semilla. La prueba IPC del launcher, tras readiness, cerró ambos hijos con código 0, liberó el lock del API y retiró el proxy temporal; no tocó servicios DevBar. La SQLite demo y su marker se conservaron.
- En la actualización previa del 27-11 `pnpm demo:regenerate` seguía sin ejecutar: la instancia normal de DevBar mantenía `requestLogging.enabled=true` y `captureDetails=true`; por seguridad no se creó token ni se envió prompt. La ejecución real descrita más abajo usó un WebAPI temporal aislado, no ese servicio normal.

### DevBar y prueba de la demo (27-11-2026)

- En el grupo `HogarAI` se añadieron las acciones `Demo: cargar seeds` (`pnpm demo:seed`), `Demo: reset DB` (`pnpm demo:db:reset`, confirmación obligatoria) y `Demo: regenerar con IA` (`pnpm demo:regenerate`, confirmación obligatoria). La acción de seed terminó con exit code 0 y confirmó que los perfiles existentes no se duplicaron.
- Se añadió el comando largo `demo (seeds)` (`pnpm demo`) sin sustituir `start` (`pnpm dev`). El comando demo quedó iniciado por DevBar en loopback; API/proxy y frontend escucharon en los puertos efímeros 58385/58386.
- Se inició el navegador Brave local apuntando al frontend DevBar. Login HTTP 200 y datos visibles comprobados en los hogares sintéticos de 1 y 6 miembros; el perfil de cocina se renderizó como `Apenas cocino`. No se usó Chrome.
- Capturas nuevas, solo con datos sintéticos, quedaron en `.e2e-screenshots/ai-persona-seeds/devbar-{solo,family}-{desktop,mobile}.png`; `.e2e-screenshots/` está ignorado por Git. Reset y regeneración AI no se ejecutaron para validar la configuración de sus acciones.
- El primer intento de arranque informó que la DB demo estaba en uso. No se borró/resetó la DB ni se detuvieron procesos ajenos; el reintento quedó iniciado y la verificación browser posterior pasó. El comando sigue activo en DevBar.

| Verificación                                       | Resultado                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run test:config`                             | PASS · 157/157.                                                                                                                              |
| `pnpm run test:server:coverage`                    | PASS · 2.291 pass, 1 skip; coverage 89,47% statements, 81,72% branches, 95,46% functions y 92,37% lines (todos los gates por fichero pasan). |
| `pnpm run build:server` / `pnpm run typecheck:e2e` | PASS.                                                                                                                                        |
| `pnpm exec prettier --check …`                     | PASS · todos los archivos de la unidad.                                                                                                      |
| Launcher IPC controlado                            | PASS · readiness, exit code 0, lock/proxy/puertos propios retirados; DB y marker permanecen.                                                 |

### Revalidación solicitada (27-11-2026)

- DevBar ya tenía las tres acciones correctas (`demo:seed`, `demo:db:reset`, `demo:regenerate`) y el comando largo `demo (seeds)`; no dupliqué acciones. Reejecuté `Demo: cargar seeds`: exit code 0, seed idempotente, sin altas duplicadas.
- `start` (`pnpm dev`) estaba detenido; `demo (seeds)` (`pnpm demo`) seguía activo en loopback. UI y API respondieron HTTP 200; se mantuvo la DB demo dedicada.
- Prueba de inicio de sesión y vista de miembros con Brave instalado, en ejecución headless: perfiles sintéticos solo y familia devolvieron login HTTP 200 y hogares de 1 y 6 miembros; cero errores de página. Sin cambios en la DB durante la verificación.
- Capturas nuevas, PC/móvil: `.e2e-screenshots/ai-persona-seeds/demo-live-20261127-202048/{synthetic-solo,synthetic-family}-{desktop,mobile}.png` (artefactos ignorados por Git).

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
- Commit `fb7e536a` añadió la regresión de fallo parcial, cargó el bundle `profile` en `/household` y fijó el timeout de una migración de test que el pre-push había encontrado flaky. Hook completo pasó en 98,56 s; suite servidor 2.260 pass/1 skip. El CI [45922014375 (#1371)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45922014375) del HEAD `de96f7bf` pasó 11/11 jobs; el run #1362 anterior fue cancelado.

## Estado del smoke real de IA

### Resultado real aislado (27-11-2026)

- Se verificó una sesión ChatGPT autenticada en WebAPI. El fallo inicial no era de login: el chequeo del navegador automatizado en modo headless devolvía challenge. En el WebAPI aislado se cambió el runtime a headed sobre Xvfb; la sesión pasó el chequeo y las generaciones funcionaron. La app E2E se ejecutó con el binario Brave configurado; no se abrió una ventana Chrome. Son dos navegadores distintos: Brave para Playwright local y el Chromium/Patchright interno del contenedor WebAPI para ChatGPT.
- Se mantuvo el provider ChatGPT de WebAPI. HogarIA usó temporalmente provider `custom` para enrutar al proxy loopback aislado; ese proxy solo validaba/reenviaba requests al WebAPI local y medía el presupuesto. No se sustituyó el provider del WebAPI ni se usó un modelo local/API externa.
- `pnpm demo:regenerate`: PASS · reset → seed de 10 perfiles/4 hogares → matriz live acotada; 9 completions reales, HTTP 200, JSON válido, `stop`, modelo `gpt-5`. Dos smokes enfocados adicionales (conexión y receta) añadieron 2 completions: 11 en total. `pnpm demo:seed` posterior confirmó idempotencia.
- Estado antes de cleanup: DB demo con 11 usuarios/5 hogares, 12 recetas, 1 lista, 1 ticket y 21 trabajos terminados; un usuario adicional y las salidas pertenecen al smoke sintético. La ejecución había dejado activa una config HogarIA con base URL loopback efímera y marcador de prueba. Se añadió teardown autenticado por API en `tests/e2e/ai-real-smoke.spec.ts`; E2E aislado de regresión pasó 1/1. La config de la ejecución real se eliminó por API, preservando las salidas; lectura posterior confirmó `ai_configs=0` y 21 trabajos aún presentes.
- Preflight/aislamiento: la ejecución usó una SQLite de WebAPI temporal y logging, captura, grabación y HTML diagnóstico desactivados; el bearer temporal quedó eliminado (conteo final 0). Se retiraron el contenedor temporal, la copia temporal del perfil Patchright y la DB temporal tras verificar que solo el contenedor de esta tarea usaba esos volúmenes. `web-api` normal continuó arriba e intacto.
- La configuración headless se cambió solo en el WebAPI aislado (effectiveHeadless=false, display Xvfb); no se alteraron settings ni DB del WebAPI normal. El runtime headless de WebAPI no debe confundirse con que el servicio Docker estuviese apagado o que la sesión ChatGPT no estuviese autenticada.
- Checks de esta actualización: `pnpm run test:config` PASS · 157/157; `pnpm run typecheck:e2e` PASS; `pnpm exec prettier --check …` PASS; E2E de cleanup con Brave PASS · 1/1. El pre-push del commit de documentación también pasó build, typecheck, UI quality y suites client/server (1.837 client; 2.291 server, 1 skip).
- Pendiente: completar los criterios separados de fallo de respuesta/proveedor, timeout/cancelación de la matriz live y el mapeo de cada ruta/job a perfil y presupuesto. No se declara cubierto todo el producto cartesiano ni toda condición de error.

### Intento real anónimo sin sesión

- El 26-11-2026 se ejecutó una única prueba `ChatGPT guest live smoke` con prompt e imagen sintéticos, perfil nuevo y temporales aislados; no se usó la instancia DevBar ni la sesión de Brave. Preparación, imagen y servidor local pasaron (3/4 pasos); la solicitud terminó en HTTP 401 `authentication_required` al comprobar el estado del proveedor, sin respuesta del modelo. No cuenta como generación real válida.
- El intento confirma que la ruta anónima Guest no está disponible en este entorno. Un token API de WebAPI autentica la llamada a la API, pero no proporciona por sí solo autenticación del proveedor ChatGPT.
- El smoke de WebAPI borra `.tmp/opencode/attachments` relativo a `cwd`; ese directorio del checkout ya contenía artefactos previos. Por seguridad el test corrió con un `cwd` temporal nuevo, que se limpió al terminar; el directorio previo quedó intacto.

- Revalidación read-only 2026-11-26: el grupo DevBar `IA` sigue ejecutando `dev` en `127.0.0.1:3001`; `/health/ready` informa `ready` y storage listo. Los flags efectivos son `requestLogging.enabled=true`, `captureDetails=true` y `debugMode=true`; el preflight de smoke real falla antes de crear token o llamar al modelo.
- La guía de persistencia de WebAPI documenta que las sesiones operativas normales guardan el prompt completo y el resultado del proveedor en `session_events.content`. Por tanto, no basta con apagar temporalmente el logging del WebAPI normal: un smoke real requiere un WebAPI con DB temporal y estado de proveedor autorizado/aislado.
- No se modificaron los controles, la base de datos ni la sesión existente del WebAPI; no se creó token ni se usó la instancia DevBar. El intento anónimo no produjo una respuesta del modelo. Los 11 `AiJobKind` sí se ejercitan con proveedor loopback en los E2E aislados descritos arriba.
- Pendiente: disponer de un runtime de proveedor autorizado y compatible en el WebAPI aislado, luego ejecutar la matriz finita existente por flujos/job y perfiles, con presupuesto y limpieza propios. No hacer reintentos ciegos ni afirmar que el modelo real funciona hasta completar ese run.

### Verificación WebAPI aislada y token API (27-11-2026)

- Se levantó otra instancia local del WebAPI en loopback, con una SQLite temporal propia; no se usó la DB ni el proceso DevBar normal.
- Con request logging, captura de detalles, debug, grabación de sesión y HTML diagnóstico desactivados, `/health/ready` respondió listo. Se creó un bearer temporal por la API administrativa y `GET /v1/models` devolvió HTTP 200 con tres modelos (`gpt-5` activo).
- Se borró el token mediante la API y se verificó su ausencia; el servidor se detuvo, el puerto dejó de aceptar conexiones y se retiró la carpeta temporal exacta. El secreto nunca se imprimió ni persistió.
- No se envió prompt: un token bearer autentica al cliente frente al WebAPI, pero no sustituye la autenticación del proveedor ChatGPT. En otro WebAPI aislado, el chequeo de sesión falló con HTTP 503 `browser_unavailable` / `browser_launch_failed` porque la distribución Chrome configurada para Patchright no estaba disponible en el entorno aislado. No se abrió Chrome ni se utilizó el perfil Brave existente.
- Resultado: la conectividad/autenticación de la API local queda verificada; generación real pendiente. La matriz de `pnpm demo:regenerate` sigue sin ejecutarse y los checks de generación real permanecen sin marcar.

### Límite confirmado de sesión/proveedor (27-11-2026)

- Inspección read-only del WebAPI actual: el handler `/v1/chat/completions` declara `provider: "chatgpt"` y ejecuta el adaptador ChatGPT/Patchright; no se encontró otro módulo de inferencia en `src/providers`.
- `patchright.browserChannel` en el schema admite `chrome`, aunque hay un `browserExecutablePath` personalizado; la instancia probada usó el valor configurado y no encontró Chrome. La clave `agenta.apiKey` alimenta `src/shared/observability/agenta.ts` (telemetría/observabilidad), no sustituye una API key del modelo.
- Implicación de entonces (inferencia tras el intento headless fallido): la extensión Brave no autentica por sí sola el perfil del proceso WebAPI. La conclusión de que la generación real no estaba disponible quedó **superada** por el smoke autenticado y exitoso del 27-11, documentado al inicio de esta sección. No se leyó ninguna clave ni se modificó el repositorio externo/configuración del WebAPI normal.

### Revisión solicitada del tráfico a `localhost:3001` (27-11-2026)

- Llamadas de esta revalidación, todas de lectura: `GET /health/ready`, `GET /admin/api/chatgpt/session`, `GET /admin/api/runtime-controls`, `GET /admin/api/settings/session-recording` y `GET /admin/api/settings/diagnostic-html`.
- No se llamó a `POST /admin/api/tokens` ni a una ruta de generación del proveedor (`/v1/chat/completions`); por tanto, esta ejecución no debía crear una fila en `/admin/sessions`.
- La carga/verificación de seeds solo usó la API local aislada de HogarIA. Las 11 respuestas reales citadas arriba corresponden a un contenedor WebAPI temporal con DB propia, así que tampoco aparecen en la instancia de `:3001`.
- En el HEAD actual se conectaron los escenarios live a la matriz de personas (`solo-beginner`, `solo-allergy`, `family-owner`) y se ejecutó E2E loopback aislado: 2/2 tests, salida `2 passed`; `pnpm run test:config` pasó 157/157 y `pnpm typecheck:e2e` pasó. Ninguno de esos tests emitió tráfico a `:3001`.
- La instancia normal sigue lista y con sesión ChatGPT `ready`, pero mantiene `requestLogging.captureDetails=true` y `sessionRecording.enabled=true`. El preflight fail-closed impide crear token o enviar prompts mientras esa instancia no sea de prueba aislada; no se alteraron sus ajustes.

### Smoke real contra WebAPI DevBar (27-11-2026)

- Por instrucción expresa del usuario, la acción temporal de DevBar probó el API existente `http://127.0.0.1:3001`; no arrancó otra instancia. El proveedor reportado por los logs de ciclo de vida fue `chatgpt`.
- La configuración temporal mantuvo apagados request logging/captura y grabación de sesión durante las pruebas. El runner verificó la restauración (`WEBAPI_PRIVACY_RESTORED=True`); el HTML diagnóstico siguió desactivado. Los logs consultados fueron solo metadatos saneados de estado, sin inspeccionar ni registrar cuerpos de solicitudes/respuestas o credenciales.
- Receta sintética: aceptación en background HTTP 200, seguida de estado terminal `failed`, `errorCode=internal_error`; en la SQLite aislada de HogarIA el job resultó `PROVIDER`, con un intento y sin resultado. El test esperó 270 s hasta su timeout porque el job fallido esperaba la ventana de reintento manual.
- Test de conexión sintético: aceptación HTTP 200, pero el estado terminal del trabajo fue `failed`/`internal_error` en ~3,7 s. Por tanto, el HTTP 200 inicial confirma solo la aceptación en background, no éxito del modelo.
- Tras reproducir el mismo fallo del proveedor en receta y conexión, se detuvieron los intentos para evitar llamadas repetidas sin señal útil. No se probaron live planificación, tickets, compra, hogar ni asistente; la matriz real no está completa. Las capturas/apps y DB de HogarIA siguieron aisladas; el comando `demo (seeds)` permaneció bajo DevBar.

## Hallazgo UI resuelto

La tarjeta con nivel `none` mostraba literalmente `profile.cooking.none`. La clave ES/EN ya existía, pero el resolver de `/household` no cargaba el bundle lazy `profile`; se añadió a `translationBundlesResolver` y el E2E exige `Apenas cocino` antes de guardar capturas. La prueba reprodujo el defecto antes del arreglo y pasó después. Las capturas sintéticas escritorio/móvil se regeneraron e inspeccionaron.

## Límites

Se completó la matriz live acotada indicada arriba; no se recorrió el producto cartesiano de perfiles. No se declara que «todas las generaciones» ni todas las condiciones de error funcionan. La cobertura de fallo/timeout/cancelación y gates restantes siguen pendientes en `AI-SEED-PERSONAS-SMOKE-SPEC.md`.
