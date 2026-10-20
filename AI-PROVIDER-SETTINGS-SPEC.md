# Hogar: proveedores de IA y registro

**Estado:** Draft — implementación, gates locales y comparación geométrica verificados; CI remoto pendiente.
**Base revalidada:** `origin/master` en `536c2e0ea509d05e3f2131f7e6272cc138539fdf` (commit documental de esta spec, publicado por separado y conservado por decisión del usuario).

## Objetivo y decisiones

- La configuración de proveedores vive en **Hogar → Ajustes** y conserva el aislamiento por hogar y el permiso `settings`.
- Se permiten varios proveedores activos. La configuración asigna cada función de IA a un proveedor activo; con un proveedor se muestra su nombre sin selector y con varios se ofrece un selector por función.
- Las asignaciones se guardan por scope en `ai_function_providers` (una fila por función; no guarda credenciales) y se inicializan con el proveedor activo más antiguo del mismo scope. Los cambios son atómicos; `ai_jobs.config_id` conserva la selección al admitir el trabajo.
- Las funciones visibles son: **Asistente**, **Recetas y recomendaciones**, **Planificación**, **Compra y despensa** y **Automatización del hogar**. Todos los `AiJobKind` y caminos directos del servidor se asignan exactamente a una función; `connection_test` siempre usa la configuración probada. `product_image_search` consulta Commons y no llama al modelo, pero conserva su afinidad de scheduler en Compra y despensa.
- Al crear la primera configuración activa, todas las funciones usan esa configuración. Si se desactiva o elimina un proveedor en uso, se advierte antes de confirmar y las funciones afectadas pasan al proveedor activo más antiguo (`created_at ASC, id ASC`). Si no queda ninguno, quedan sin proveedor y la IA informa cómo configurarlo.
- La cola conserva el hogar y el proveedor fijados al admitir un trabajo. Cambiar una asignación nunca redirige trabajos ya admitidos ni permite fallback entre hogares.
- El límite de timeout actual de 240 s se eleva a **600 s** para probar proveedores lentos. UI, API y transporte comparten ese límite; la concesión del worker debe superarlo con margen. El campo puede omitirse para usar el default actual de 30 s; no se introduce un mínimo de producto adicional, aunque un valor explícito debe ser un entero positivo.
- Un test de conexión persistido muestra estado `testing` antes de iniciar la petición, impide duplicados y permite reanudar la consulta de estado tras recargar. El estado/resultado puede persistirse; claves y credenciales efímeras nunca se escriben en tablas de jobs, estado de test, logs ni navegador persistente.
- El registro pide repetir la contraseña y valida igualdad en cliente. Solo se envía la contraseña original al servidor.
- La entrega será **un único PR**, por decisión explícita del usuario aunque el diff supere 400 líneas; documentar esa excepción con la etiqueta `size:exception` y mantener el PR en Draft durante el trabajo.

## Fuente de verdad y discrepancias

- `HOGARIA-SPEC.md` §12am y §12an documentan la antigua configuración mono-activa. Esta spec supersede **solo** la regla de exclusividad; endpoint OpenAI-compatible, redacción de claves, dispatcher único, límites de cola y jobs fijados siguen vigentes.
- `HOGARIA-SPEC.md` §12ap y `QA-HOUSEHOLD.AI.HOME-CONFIG-AND-PINNED-JOBS.1` mantienen el scope, ACL y pinning por hogar.
- `SPEC.md` del asistente global no gestiona credenciales ni proveedores; esta spec cubre la configuración que consume.
- El log adjunto `Texto pegado.txt` solo registra health/readiness/receipts con 200 y no contiene solicitudes al conector ni timeouts. No basta para atribuir la causa exacta del fallo; validar el comportamiento con el harness aislado y guardar el límite como incertidumbre si persiste.
- En la base de esta rama, `createAiConfigSchema` limitaba timeout a 240000 ms, `testConnectionSchema` no compartía ese tope y `ticket-queue.ts` usaba una concesión fija de 300 s. La primera unidad elevó el límite compartido de API a 600000 ms, la concesión a 660 s, el estado guardado a `testing` antes de la llamada, bloqueo atómico de duplicados y recuperación a fallo seguro al reiniciar. Está validado con Vitest y Playwright contra la app/API aislada usando un servidor HTTP sintético local.
- El contrato anterior imponía un solo proveedor activo. Esta unidad lo sustituye por `ai_function_providers`; desactivar/eliminar conserva el comportamiento seguro existente de cancelar jobs del proveedor, pero solo las funciones asignadas hacen fallback al proveedor activo más antiguo. Cambiar asignación no altera jobs admitidos.
- El pre-push detectó dos pruebas del asistente con semana fija `2026-10-19` y reloj real; se reprodujeron en `2026-10-20`, cuando la lógica excluye el lunes pasado. Ambas fijan el reloj en el test, sin cambiar comportamiento de producto. Verificado: spec frontend, 55/55; test server focal, 1/1.

## Checklist de aceptación

### Proveedores, asignaciones y hogar

- [x] Migrar sin perder filas existentes de proveedores, secretos, jobs, hogares ni preferencias. Inicializar cada función con el proveedor activo más antiguo (`created_at ASC, id ASC`) del mismo scope; no cruzar hogares ni recurrir a filas personales. Migración aditiva en `database.ts`; backfill idempotente probado por scope, con proveedores activos/inactivos y hogar personal/compartido.
- [x] Crear y mantener varios proveedores activos; asignar una función a un proveedor válido de su scope; desactivar el proveedor asignado reubica esa función al activo más antiguo o la deja sin proveedor; `api_key` no sale en respuestas. Cubierto por pruebas de ruta y Playwright.
- [x] Routear `recipe`/`multiple_recipes` y `recommendations` a **Recetas y recomendaciones**; `weekly_plan`/`household_plan` a **Planificación**; `receipt`, `shopping_photo`, `expiry_estimate` y búsqueda de imagen de producto a **Compra y despensa**; automation worker a **Automatización del hogar**; runtime global a **Asistente**. Revisados dispatcher, streaming, llamadas directas y afinidad de jobs. `connection_test` usa explícitamente el proveedor probado.
- [x] Al desactivar o eliminar un proveedor asignado, mostrar una advertencia accesible que identifica los usos afectados y confirma la sustitución por el proveedor activo más antiguo; si no queda proveedor, quedan sin asignación y se muestra la vía de configuración.
- [x] Probar selección, fallback y aislamiento entre dos hogares, permisos `settings` y jobs admitidos antes del cambio. Las rutas de configuración requieren permiso de escritura; la IA puede usar la config de hogar sin conceder ese permiso. No hay fallback personal ni entre hogares.
- [x] Reutilizar el gestor en Hogar → Ajustes y redirigir enlaces guardados a la ubicación nueva sin cambiar la ACL del servidor.
- [x] Con un proveedor activo, mostrarlo fijo; con varios, mostrar selectores por función solo con opciones activas. Con cero activos, no mostrar selector falso.
- [x] Ocultar el acceso global a IA cuando no haya proveedor activo. Los puntos de generación cubiertos muestran un modal accesible con enlace directo a Hogar → Ajustes; las pruebas verifican que no se dispara la petición. El backend conserva sus guards.
- [x] El estado de disponibilidad, sin credenciales, se puede leer antes de crear un hogar tras autenticar y responde 200 con estado no configurado; no debe provocar 409 de setup ni solicitudes de generación. Probado por el middleware de setup sobre `createApp`.

### Timeout y estado del test de conexión

- [x] UI, esquemas de alta/edición/test y transporte aceptan hasta 600000 ms, con validación compartida, límites explícitos y default de 30000 ms al omitirlo; no hay mínimo artificial.
- [x] La concesión de jobs es 660 s: timeout máximo más margen documentado de 60 s. Las pruebas verifican la configuración y el pinning que evita re-ejecutar una llamada admitida.
- [x] Persistir `testing` de config guardada antes de lanzar el test. Una petición concurrente o posterior a recarga no inicia otra ejecución; la UI recupera/polleará el estado y libera el control al terminar.
- [x] Cubrir éxito, respuesta fallida/error de proveedor, abort/timeout del dispatcher, recarga, concurrencia, caída/reinicio y recuperación de `testing` obsoleto. Los datos sensibles no se devuelven ni escriben en jobs; el lock recupera estado terminal.
- [x] Mantener la prueba de formulario sin guardar y probar validación/resultado/error. No se almacena su payload ni API key en storage persistente; recargar cierra el formulario y no reenvía la ejecución.

### Registro

- [x] Añadir campo accesible e internacionalizado para repetir contraseña; detectar vacío y discrepancia antes de solicitar registro.
- [x] Probar igualdad, error corregible y reintento; el POST conserva exactamente `{name,email,password}` y nunca incluye el campo repetido.

### Verificación y entrega

- [x] TDD con pruebas focales para contratos, límites, carreras, cancelación, recarga, persistencia, permisos y ausencia de proveedor. La suite usa SQLite temporal y HTTP sintético local; no escribe en la BD habitual ni llama proveedores externos.
- [x] Playwright app/API real con datos sintéticos: escritorio y móvil, selector/fallback, recarga de test sin duplicado, estado sin proveedor, registro, teclado y breakpoints 320–1440 px. Capturas comparables guardadas e inspeccionadas bajo `.e2e-screenshots/` (ignorado por Git).
- [x] i18n ES/EN, nombres accesibles y navegación/teclado cubiertos por pruebas y build. Coverage completa: frontend >70 % en statements, ramas, funciones y líneas; servidor >70 % en las cuatro métricas.
- [x] Comparar geometría calculada entre `/ai-config` y Hogar → Ajustes con tolerancia máxima de 1 CSS px en Chromium de escritorio y móvil: el botón de alta iguala ancho/alto y los 5 selectores igualan altura. La captura específica del panel quedó guardada e inspeccionada.
- [x] CI de PR conserva los cuatro shards E2E amplios y smoke de imagen `amd64`/`arm64`; el job full-stack de 30 min se limita a flujos críticos de build servido, proveedor por función, registro, rate limit y logs/SSE. No duplica las 178 pruebas full-stack dentro de ese job. El resultado remoto del commit final sigue pendiente.
- [x] Mantener esta checklist ligada a evidencia reproducible. Rama y PR permanecen Draft; no mergear.

### Evidencia reproducible

- Funciones/proveedores y todos los contratos servidor: `pnpm run test:server:coverage` — 119 ficheros pasaron, 2,100 tests pasaron, 1 skip; coverage 89.66 % statements, 81.80 % ramas, 95.60 % funciones, 92.62 % líneas. Incluye backfill idempotente, mapping, multi-activos, selección/fallback, permisos/scope, redacción, routing, lease y pinning.
- Registro: `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/auth/register/*.spec.ts --browsers=ChromeHeadless` — 15/15. Cubre label visible, requerido, discrepancia, corrección y llamada a `AuthService.register` solo con `{name,email,password}`.
- Frontend completo: `pnpm run test:client:coverage` — 1,740/1,740 tests; coverage 90.64 % statements, 81.04 % ramas, 91.76 % funciones, 93.20 % líneas.
- E2E local aislado: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts tests/e2e/full-stack/ai-provider-settings.spec.ts` — 6/6 en Chromium escritorio y móvil; usa endpoint HTTP local sintético, persiste estado `testing` entre reload y comprueba que solo se hace un POST.
- Disponibilidad durante alta: `pnpm --filter @hogaria/server exec vitest run src/middleware/household-required.middleware.spec.ts` — 5/5; `GET /api/ai/availability` devuelve estado 200 sin hogar mientras se mantienen los guards de datos.
- Full-stack servido: `pnpm run test:e2e:full-stack` — 40 pasaron, 2 skips esperados; build de producción y proceso aislado con SQLite temporal.
- Regresiones de CI: `node scripts/run-isolated-playwright.mjs --project=chromium tests/e2e/household-action-ack.spec.ts tests/e2e/auth-onboarding-icons.spec.ts tests/e2e/settings-tabs-geometry.spec.ts tests/e2e/receipt-drag-drop.spec.ts tests/e2e/calendar-number-locale.spec.ts tests/e2e/calendar-all-day-gutter.spec.ts tests/e2e/calendar-mobile-header-layout.spec.ts tests/e2e/calendar-early-hours.spec.ts tests/e2e/calendar-range-order.spec.ts tests/e2e/calendar-replan.spec.ts tests/e2e/pantry-caducidades.spec.ts` — 25/25 tras ajustar el gate de disponibilidad y sus fixtures.
- Flujos de recibos: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/receipt-queue-actions.spec.ts tests/e2e/receipt-queue-panel-layout.spec.ts tests/e2e/receipts.spec.ts` — 38/38; cobertura sintética de bloqueo sin proveedor, colas y procesamiento local.
- Generación/recetas: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/recipe-book-filter-modal.spec.ts tests/e2e/recipe-book.spec.ts tests/e2e/recipe-full-detail.spec.ts tests/e2e/recipe-edit.spec.ts tests/e2e/recipe-cooking-checklist.spec.ts tests/e2e/calendar-replan.spec.ts --grep 'combina los seis filtros|una receta del libro abre el detalle completo|la ficha completa presenta detalle|la vista dedicada edita todos los campos|revisa una mejora canónica|modo cocina escala comensales|Replanificación parcial'` — 18/18 en PC y móvil.
- Validación de utilidades: `pnpm run typecheck:e2e` y test middleware — pasan; `pnpm run test:config` — 104/104; `pnpm run check:ui` — 269 ficheros, 21 reglas, sin incidencias.
- E2E registro actualizado: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/auth.spec.ts --grep 'should show login form|should show the register form without the profile questions'` — 4/4; registro/login muestran confirmación solo donde corresponde.
- E2E límite de contraseña: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/auth-password-byte-limit.spec.ts --grep 'registro rechaza 73 bytes'` — 2/2; password y confirmación coinciden antes de enviar.
- E2E enfocado (empty state + fallback multi-provider): `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/ai-config.spec.ts --grep 'keeps the unconfigured state focused|permite varios proveedores activos'` — 4/4; Chromium escritorio y móvil.
- E2E de permisos y geometría: `node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/ai-household-settings-permission.spec.ts` — 2/2; comprueba dimensiones equivalentes y guarda las capturas del estado vacío PC/móvil.
- Registro: en el E2E enfocado anterior al último cambio solo visual, `... tests/e2e/auth-flow.spec.ts --grep 'register redirects'` pasó en Chromium escritorio y móvil. El registro también queda cubierto por las 1,740 pruebas frontend.
- Build, checks: `pnpm run build` y `pnpm run typecheck:e2e` pasan; `pnpm run test:config` 104/104; `pnpm run check:ui` pasa (269 ficheros, 21 reglas). `pnpm run lint:server` y `pnpm run lint:client` no están operativos en este checkout: el primero usa `--ext` incompatible con ESLint 9 y el segundo no tiene instalado `@angular-eslint/builder`; ninguno se ejecuta en el workflow CI actual.
- No hay proveedor externo configurado: ningún smoke WebAPI real se ejecutó. Toda llamada de IA de pruebas apunta a fixtures o al servidor HTTP sintético local.

## Unidades de entrega

1. Registro: repetir contraseña, validación local, traducciones y pruebas.
2. Timeout/test: límite seguro, estado persistente, deduplicación y recuperación.
3. Multi-proveedor: migración, asignaciones, routing y guards.
4. Hogar/UI: mover gestor, selectores, avisos, flujo sin configuración y E2E.

Cada unidad incluye pruebas y evidencia en el Draft PR #56. La comparación geométrica numérica está completada; registrar aquí el resultado CI del último commit y conservar el PR en Draft, sin mergear.
