# Asistente global de acciones con IA

**Estado:** especificación activa; implementación pendiente.
**Rama/PR:** `feat/household-floorplan` / [#47](https://github.com/juanjoGonDev/MiCocinAI/pull/47), mantener en Draft.
**Idioma de producto y reportes:** español (España); conservar el sistema i18n existente.

## Decisión de alcance

El checklist anterior de este archivo decía que la unidad de recetas no ampliaba producto. El 2026-10-16 el usuario autorizó expresamente ampliar el PR #47 para añadir el asistente global solicitado, sin abrir otro PR. Esta es una ampliación deliberada del alcance del PR, no una inferencia desde specs históricas. La restricción anterior sigue describiendo únicamente la unidad de recetas ya completada. Mantener la rama actual y el PR en Draft; no mergear ni cambiarlo a Ready.

## Evidencia actual y decisiones técnicas

- El shell autenticado compartido está en `frontend/src/app/layouts/main-layout/main-layout.component.ts`; `/auth`, invitaciones y `/onboarding` están fuera de ese shell. El FAB global se limita al shell autenticado, incluido el contexto de hogar, no a pantallas públicas/autenticación.
- No existe un asistente global ni captura de voz actual. Las rutas IA presentes son por función. Reutilizar el transporte y la configuración local existentes; el `callAI`/`ticket-queue` habitual inserta metadatos en `ai_jobs`, así que el asistente usará una ejecución efímera acotada y cancelable para cumplir literalmente cero escrituras durante propuesta/refinamiento. No añadir proveedor, cuenta, clave, modelo pesado ni dependencia.
- Generación y refinamiento devuelven propuestas tipadas y validadas; nunca escriben datos de dominio. La ejecución debe usar un registro allowlist de acciones y los servicios/endpoints de dominio existentes, que vuelven a validar autorización y reglas de negocio. Prohibidos código ejecutable del modelo y accesos directos a DB.
- Se admite `SpeechRecognition`/`webkitSpeechRecognition` solo tras feature detection. La transcripción siempre puede revisarse/editase antes de enviarse; explicar claramente que el reconocimiento del navegador puede procesarse fuera del dispositivo antes de pedir consentimiento. Nunca conservar/subir audio desde la app; fallback completo a texto.
- La carga global debe ser pequeña: FAB ligero en el shell y carga diferida de diálogo/flujo pesado. Reutilizar el modal, botones, tokens e i18n existentes. El aviso inferior de automatización de hogar ya ocupa abajo-derecha, por lo que la posición/stack del FAB se valida frente a ese aviso, teclado, drawer y safe-area.
- QA repetible usa proveedores simulados y DB temporal aislada; el smoke final debe usar app/backend reales, interacción de navegador y DB temporal aislada. El proveedor IA real/local y micrófono son opt-in condicionados por privacidad, disponibilidad y recursos. Nunca escribir en la DB normal ni imprimir secretos/datos personales.

### Riesgos de integración verificados en el código actual

- `POST /api/ai/plan-week` persiste el plan antes de responder (`server/src/routes/ai.routes.ts`, `persistWeeklyPlan`); no reutilizarlo para previsualización global.
- `POST /api/shopping/lists/:id/items` fusiona producto+unidad sumando cantidades (`server/src/routes/shopping.routes.ts`, `upsertLine`); un reintento puede duplicar cantidades sin idempotencia por acción.
- `POST /api/calendar/events` inserta el evento antes de validar/asociar invitados (`server/src/routes/calendar.routes.ts`); no ofrecer invitados en acciones iniciales hasta hacer atómica esa escritura.
- Tareas domésticas solo tienen lectura/escritura de semana completa con permiso y `baseVersion` (`server/src/routes/household-tasks.routes.ts`, `household-task.store.ts`); una acción debe releer, fusionar la semana y guardar por CAS, sin sobrescribir cambios concurrentes.
- El esquema persistido de tareas domésticas no tiene prioridad; no inventar un campo en la propuesta. Excluir prioridad hasta que contrato, persistencia y UI de tareas la soporten con pruebas; fecha sí podrá proponerse si el API la valida.
- Algunas rutas de creación generan IDs nuevos y no tienen idempotencia común. La seguridad de reintento no se puede asumir por similitud con los endpoints de aprobación del plan de comidas.

## Aceptación priorizada

### P0 — Contrato, seguridad y flujo HITL

- [x] El usuario confirma que este trabajo amplía el PR #47; queda prohibido abrir otro PR.
- [x] Actualizar el cuerpo del PR #47 con el alcance, invariantes y gates de esta spec; confirmar Draft antes de implementar.
- [ ] Definir esquemas estrictos compartidos para solicitud, plan, acción, edición y estado: ID estable generado por la app, dominio/tipo allowlist, payload editable tipado, dependencias, advertencias, selección y estado de ejecución. Rechazar campos/acciones desconocidas; no aceptar instrucciones ejecutables ni confiar IDs/authorization generados por IA.
- [ ] Añadir generación universal por lotes (intenciones múltiples y entre dominios) con fechas/cantidades naturales, ambigüedad y contexto mínimo de ruta/hogar. Prompt injection en texto/contexto recuperado se trata como dato no confiable.
- [ ] Generar y refinar propuestas sin ninguna escritura SQLite (incluidos `ai_jobs`); ejecución IA efímera con límite de concurrencia y cancelación. Refinar lote/grupo/acción/campo con alcance explícito; conservar acciones no afectadas y ediciones manuales salvo que se pidan reemplazar; soportar repetición, dependencias coherentes y descartar/deshacer cuando sea práctico.
- [ ] Crear registro extensible de acciones y mapear cada acción compatible a APIs/servicios existentes, reglas de autorización, validadores y lecturas de conflictos/duplicados. Añadir idempotencia atómica por acción donde el API no la ofrezca. No usar `/api/ai/plan-week` como preview ni ofrecer asistentes/invitados de eventos hasta proteger las escrituras parciales. No añadir operaciones destructivas al registro inicial; cualquier futura acción destructiva requiere confirmación adicional explícita.
- [x] La confirmación final ejecuta solo acciones seleccionadas y validadas. Orden topológico de dependencias; rechazos/fallos bloquean dependientes. Conservar resultados parciales, fallos por acción y reintentos seguros/idempotentes sin repetir éxitos; doble clic/cancelación no duplica escrituras.
  - Evidencia (2026-10-17): TDD del diálogo reprodujo el fallo (1/48 fallida) y pasó 48/48 tras ordenar establemente las acciones seleccionadas por dependencias. node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --workers=1 --grep 'ejecuta primero los prerrequisitos aunque el proveedor invierta el orden' tests/e2e/full-stack/ai-action-assistant.spec.ts — **2/2** con app/backend reales y SQLite temporal; lista se persistió antes del artículo aunque la respuesta IA los ordenase al revés. La suite full-stack del asistente pasó **46/46** y pnpm --filter @hogaria/web run test:coverage **1.677/1.677** (90,42/80,49/92,02/92,96 % S/B/F/L).
- [ ] La generación, refinamiento, edición, selección, expansión, rechazo y cierre sin confirmar causan cero escrituras. Cada persistencia ocurre únicamente después de aprobación explícita del usuario y validación backend de sesión, hogar/permisos, esquema, referencias y reglas de dominio.

### P1 — Cobertura de dominios y UX

- [ ] Unidad B.1: las compras derivadas quedan fuera de la confirmación inicial. No mostrar preview ni crear acciones de compra derivada antes de persistir las comidas; después, leer faltantes del inventario real y exigir una aprobación de compra separada. Regresión observada (2026-10-17): el E2E integrado actual incluye lista y artículo en la misma confirmación. Actualizar flujo y prueba conforme a `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md` antes de cerrar esta unidad.

- [ ] Registrar y verificar capacidades compatibles del producto: despensa/inventario (artículos, cantidad, categoría/unidad), compras (listas/artículos/cantidad/organización), tareas (crear/editar/fecha; prioridad solo cuando exista en el contrato), eventos/calendario (crear/editar/fecha/hora/lugar/descripción), recetas (borrador/generar/editar ingredientes e instrucciones) y planificación del hogar cuando su contrato permita propuesta y confirmación seguras. Excluir capacidades sin API de dominio reutilizable o sin autorización verificable y documentar el motivo.
- [ ] Un solo FAB accesible en rutas bajo `MainLayout`; no duplicado por página, no tapa navegación inferior/controles, teclado ni aviso flotante existente; safe-area, target táctil, nombre/tooltip y estados listo/escuchando/procesando/error. Animación reducida respeta `prefers-reduced-motion`.
- [ ] Entrada por texto y voz opcional con mismo pipeline. Estados visibles de permiso, soporte, grabación, parcial cuando exista, pausa solo si la API lo admite, parada, cancelación y fallo. No iniciar micrófono accidentalmente; detener/release reconocimiento al cancelar, navegar o cerrar.
  - Contrato incremental (2026-10-17): al detener dictado, aceptar el resultado final emitido antes de `onend`; cancelar o revocar consentimiento aborta y descarta resultados tardíos.
  - Evidencia de implementación (2026-10-17): TDD reprodujo tres fallos: se descartaba el resultado final al parar, cancelar no abortaba mientras esperaba `onend` y un `onend` obsoleto cambiaba el estado de una sesión nueva. La corrección conserva el recognizer hasta `onend`, ignora callbacks obsoletos y hace cancelación abortable; añade estado localizado de finalización. La prueba focal del diálogo pasa **43/43**; `pnpm --filter @hogaria/web run test:coverage` pasa **1.671/1.671** (**90,52/80,79/92,13/93,03 % S/B/F/L**).
  - E2E full-stack aislada con DB temporal y usuario/hogar sintéticos, `SpeechRecognition` determinista y sin petición de propuestas: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --grep 'conserva el resultado final al parar dictado' tests/e2e/full-stack/ai-action-assistant.spec.ts` — **2/2**, runner confirma cleanup. Incluye resultado final, cancelación/resultado tardío, aviso de privacidad, estado visible dentro del modal a 320×568, geometría sin overflow y cero errores de página.
  - Capturas inspeccionadas e ignoradas por Git: `.e2e-screenshots/ai-action-assistant-voice-stop-20261017/{chromium,mobile-chrome}/`. La suite usa un stub; no prueba micrófono real.
- [ ] Propuesta editable y expandible por dominio/acción/campos, selección independiente, seleccionar todo/ninguno, quitar/rechazar, refinar en ámbito y validar antes de aprobar. Aprobación por selección o todas requiere confirmación final visible; ninguna operación queda oculta.
- [ ] Modal escritorio centrado/acotado y móvil hoja/pantalla adaptable; scroll interno, acciones contextuales estables, sin overflow/jitter/obstrucción de teclado, foco atrapado/restaurado, Escape/backdrop, scroll lock, aviso accesible ante descarte destructivo y estados de progreso/éxito/error.
- [ ] Copy y errores bilingües en i18n existente; labels, nombres, live regions, navegación de teclado, foco, contraste, targets ≥44px y controles distinguibles sin depender solo del color.

### P2 — Verificación, rendimiento y entrega

- [ ] TDD: pruebas de esquema/registro/ruta y UI antes del cambio de comportamiento. Cubrir instrucción simple/múltiple/cruzada, ambigüedad, fechas/cantidades, payload inválido, prompt injection, permiso denegado, contexto de hogar cambiado, cancelar, repetición, dependencias, selección parcial, fallo parcial y reintento/doble clic. Afirmar con observación de SQLite que generación/refinamiento/rechazo no escribe ni en tablas de dominio ni en `ai_jobs`.
  - `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/services/ai-action-assistant-execution.service.spec.ts --browsers=ChromeHeadless --progress=false` — **21/21**. Nueva prueba confirma que dos aprobaciones concurrentes de la misma acción comparten Promise y emiten un solo POST; no cubre multi-pestaña ni reinicio de proceso.
- [ ] E2E Playwright real contra app y backend, DB temporal verificada y datos sintéticos introducidos mediante interacción real. Verificar persistencia tras recarga, cero escrituras en rechazo y resultado correcto por selección. Proveedor local y voz real se prueban solo si preflight de privacidad/recursos/hardware pasa; registrar limitaciones sin afirmar cobertura no recorrida.
- [ ] Verificar desktop/tablet/móvil, 320px, orientación, límites de breakpoints, safe-area, teclado virtual, scroll, diálogo expandido/colapsado, errores, teclado/foco y consola/red/logs. Guardar e inspeccionar capturas sintéticas comparables PC/tablet/móvil, ignoradas por Git; revisar geometría equivalente con tolerancia ≤1 CSS px.
- [ ] Verificar lazy loading, bundle inicial dentro de budgets vigentes, ausencia de peticiones duplicadas, cancelación y limpieza de listeners/timers/streams; medir RAM/CPU antes/durante/después y documentar navegador/capacidades no soportados.
  - Evidencia parcial (2026-10-17): TDD detectó llamadas duplicadas a `propose()` y `refineCurrentAction()` al invocarlas mientras la solicitud anterior seguía pendiente; guardas de `loading()` evitan la concurrencia en un mismo diálogo.
  - `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/shared/components/ai-action-assistant-dialog.component.spec.ts --browsers=ChromeHeadless --progress=false` — 40/40; baseline TDD falló 2/40. No cubre pestañas múltiples ni replay de red.
- [ ] Coverage del alcance ≥70 % en statements/branches/functions/lines sin rebajar gates; ejecutar suites focales, typecheck, `check:ui`, build, E2E requerido y hooks. Anotar comandos/resultados/limitaciones en esta spec.
- [ ] Commits atómicos Conventional Commit de solo archivos de esta unidad; preservar staged/unstaged/sin seguimiento previo, hooks activos, push no forzado a rama actual y árbol limpio respecto a los archivos de la unidad. Mantener PR #47 Draft; no merge/Ready.

## Secuencia de trabajo

1. Publicar esta spec y actualizar el PR Draft antes de código.
2. Cerrar primero esquema/registro/seguridad backend con pruebas de cero escrituras.
3. Integrar FAB/input/propuesta/refinamiento accesibles con pruebas de componente.
4. Añadir integración de dominios por unidades revisables, cada una con persistencia aprobada y prueba idempotente.
5. Cerrar E2E real, matriz visual, rendimiento, checklist y entrega sin tocar cambios ajenos.

## Evidencia de spec/PR previa a implementación (2026-10-16)

- PR #47 actualizado en GitHub: título `feat(household): plans, chores + global AI assistant`, alcance y nuevos riesgos visibles; estado devuelto por GitHub: abierto, Draft, sin merge. HEAD remoto `403999e` contiene los commits de spec `29aedbe` y `403999e`.
- Hooks pre-commit para ambas unidades de spec: Prettier pasa y `pnpm run check:ui` pasa (256 ficheros, 21 reglas).
- Hook pre-push: `format-check`, `check:ui`, build de producción y `typecheck:e2e` pasan. Build mantiene budgets; bundle inicial 962,15 kB con warnings existentes de presupuesto, sin bajar umbrales.
- Hook pre-push unit tests con `DATABASE_PATH=:memory:`: configuración pasa, cliente 1.598/1.598; coverage cliente 91,98 % statements, 82,79 % branches, 92,85 % functions y 94,31 % lines; servidor 1.856 pasa, 1 omitido. Sin escrituras a DB normal ni petición a proveedor IA.
- Aún no comenzó implementación del asistente; los demás checkboxes siguen pendientes.

### Hallazgos de implementación previos al código (2026-10-16)

- El dispatcher estándar `callAI` llama a `submitAiTask`, que inserta/actualiza una fila en `ai_jobs`; el asistente no lo usará en propuesta/refinamiento. Se conserva el mismo transporte (`callAIWithConfig`) y configuración activa, pero con límite efímero por proceso, cancelación por `AbortSignal` y sin persistir input, resultado ni metadatos de job.
- `household_tasks` no tiene campo `priority`; prioridad queda fuera del contrato de acciones inicial y solo se añadirá si la implementación justifica y valida una extensión vertical completa del dominio.
- Comprobación de evidencia: `server/src/utils/ai-client.ts`, `server/src/utils/ticket-queue.ts`, `server/src/config/database.ts` y `server/src/schemas/household-task.schema.ts`.

---

# Continuación: integración de UI de recetas (unidad previa)

**Rama/PR:** `feat/household-floorplan` / #47, mantener en Draft.  
**Contrato base:** `HOGARIA-SPEC.md`, `QA-RECIPE.PENCIL-REDESIGN.1`, `QA-RECIPE.CREATE-EDIT-TABS.1`, `QA-RECIPE.AI-IMPROVE.1`, `QA-RECIPE.STEP-VIDEO-SEARCH.1` y `QA-SHELL.MOBILE-SIDEBAR-ONLY.1`. Este checklist acota la validación final; no sustituye esos contratos ni amplía el producto.

## Aceptación

- [x] Revalidar en el código y pruebas actuales biblioteca, ficha/subtabs, niveles, alta/edición, propuesta IA revisable y modo cocina; corregir solo defectos demostrados de integración.
- [x] Estado de cocina pertenece al conjunto de instrucciones seleccionado: ocultar/reabrir la sesión conserva el progreso; cambiar el nivel reinicia paso, checklist y timers para no aplicarlos a instrucciones distintas.
- [x] Verificar drawer móvil con gesto desde borde izquierdo: seguimiento progresivo 1:1 al abrir/cerrar, umbrales de distancia/velocidad, gesto parcial/cancelado y swipes rápidos; sin conflicto con scroll/gestos del navegador. Backdrop, botón cerrar, Escape, foco atrapado/restaurado, scroll de fondo bloqueado y semántica accesible permanecen operativos; desktop no cambia. Reauditoría completada con cobertura de `pointercancel`, límites exactos y `prefers-reduced-motion`.
- [x] Ejecutar Playwright real sobre la app y backend con almacenamiento temporal aislado. Cubrir biblioteca→ficha→cocina y alta/edición; probar generación y guardado con modelo local real si está disponible y seguro. Pruebas repetibles de terceros siguen simuladas; no escribir en la DB normal ni registrar secretos/datos personales.
- [x] Validar escritorio, tablet y móvil (incluidos 320 px y horizontal), teclado/tacto, reduced-motion, safe-area, estados/error/vacío y ausencia de overflow; inspeccionar y guardar capturas sintéticas PC/tablet/móvil ignoradas por Git.
- [x] Ejecutar pruebas focales primero y luego gates aplicables: cobertura ≥70 % S/B/F/L en alcance, typecheck, `check:ui`, build y suites requeridas. Registrar comandos, resultados y limitaciones en el contrato activo.
- [x] Mantener `pnpm run build` bajo los budgets existentes. Si la integración eleva el bundle inicial, dividir código no crítico en chunk diferido; no rebajar budgets. Revalidar que el gesto móvil siga listo antes de interacción real.
- [x] Revalidar geometría comparable de elementos equivalentes (≤1 CSS px), diff/árbol de trabajo y Draft PR; commits atómicos en la rama actual, hooks activos, push a `origin` sin force-push. Alcance de esta unidad quedó limpio y en `origin`; se conservaron cambios staged/unstaged/sin seguimiento ajenos preexistentes.

## Restricciones

- No cambiar de rama, abrir otro PR, trabajar tareas del plano del hogar ni modificar dependencias fuera de necesidad demostrada.
- Preservar cambios existentes staged, unstaged y sin seguimiento; no incluirlos en commits salvo unidad del checklist revisada y atribuible.
- No marcar criterios completos sin evidencia reproducible. No hacer merge ni cambiar el PR a Ready.

## Resultados de validación

- `pnpm run test:client:coverage`: 1.588 tests pasan; statements 91,86 %, branches 82,66 %, functions 92,78 %, lines 94,18 %.
- Playwright aislado (`node scripts/run-isolated-playwright.mjs`, base de datos temporal): libro/ficha/edición 50 pasan; generación IA 32 pasan; cocina 7 pasan y 2 skip; acciones móviles/temporizadores 4 pasan; drawer 17 pasan y 1 skip. Proveedores externos simulados en suites repetibles. El skip de gesto táctil auténtico en Safari se debe a que Playwright no expone el API CDP de Chromium en ese proyecto.
- `pnpm run typecheck:e2e`, `pnpm run check:ui` (256 ficheros, 21 reglas), `pnpm run build`, Prettier `--check` del alcance y `git diff --check`: pasan. Push hook también pasó `format-check`, UI quality, build, typecheck E2E y suites unitarias cliente/servidor (1.588 y 1.855 pasan; 1 skip servidor).
- Capturas inspeccionadas, sintéticas e ignoradas por Git: `.e2e-screenshots/recipe-integration-release-20261016/recipe-redesign/library-chromium.png`, `recipe-redesign/library-mobile-chrome.png`, `tablet-cooking-view.png`, `mobile-chrome-cooking-view.png` y `main-layout-drawer-mobile.png`. Viewports verificados incluyen 320×568 y 568×320; suites incluyen teclado, tacto, reduced-motion y safe-area.
- Build inicial limpio (`f148fe7`): 993,09 kB. El árbol completo inicialmente superó el límite de error de 1 MB (1.005,55 kB). La carga diferida del diccionario de recetas dejó bundle inicial en 962,14 kB; build final pasa sin rebajar budgets. Permanecen warnings de umbral (500 kB inicial y 10 kB por estilo de componente); las tres hojas nuevas de recetas miden 10,80/11,63/17,16 kB, bajo el límite de error de 20 kB.
- Smoke de mejora con IA local: el preflight rechazó continuar porque la configuración existente de privacidad de WebAPI no era segura. No se creó credencial, no se llamó al modelo, no se generó/guardó receta ni se cambió configuración. Limitación documentada; ninguna petición externa fue enviada.
- Commits atómicos: `08e2499` spec/evidencia, `f79ef8f` drawer, `9486143` i18n diferida, `b79e8b7` integración de recetas. Push no forzado a `origin/feat/household-floorplan`; PR [#47](https://github.com/juanjoGonDev/MiCocinAI/pull/47) verificado abierto y Draft.
- El árbol completo sigue con cambios ajenos staged/unstaged/sin seguimiento que ya existían al iniciar esta unidad. No se limpiaron ni se incluyeron; todas las rutas de esta unidad quedaron comprometidas.

## Unidad en curso: nivel de cocina y raciones por defecto

- [x] Las instrucciones del catálogo y los prompts siguen una progresión inequívoca: `basic` corresponde a Principiante (más guiado y detallado), `intermediate` a Intermedio y `expert` a Experto (más conciso); etiquetas iguales a Configuración personal.
- [x] Al abrir una receta, el nivel seleccionado corresponde al perfil de cocina actual del usuario; una elección manual explícita por receta se conserva según el comportamiento existente.
- [x] El control de raciones de la ficha abre con los miembros activos del hogar seleccionado, no con las raciones base guardadas; solo miembros del hogar coincidente cuentan y un hogar ausente/sin miembros activos usa el fallback vigente de `HouseholdService`.
- [x] La generación conserva el valor manual del usuario; al cambiar hogar/perfil antes de editar el campo, se actualiza el default correspondiente.
- [x] Selector de dificultad mantiene geometría estable en sus estados; controles nuevos/ajustados tienen labels, teclado, foco y targets adecuados.
- [x] Pruebas focales TDD y flujo real de receta verifican etiqueta, default de perfil, cambio manual, cambio de hogar, raciones y ausencia de overflow. Capturas sintéticas desktop/tablet/móvil inspeccionadas; limitaciones de IA local quedan documentadas.

**Hallazgo y causa (2026-10-16):** el prompt de IA ya pedía basic descriptivo y expert conciso, pero las 12 recetas del catálogo contradecían ese contrato: cada variante `basic` tenía un solo paso y menos palabras que `expert` (2–3 pasos). El renderizador seleccionaba la variante correcta; el defecto estaba en el contenido editorial estático. Se ampliaron las variantes Principiante, se mantuvieron Intermedio y Experto concisos, y una prueba de contrato comprueba el orden de pasos y palabras para las 12 recetas.

**Evidencia de cierre (2026-10-16):** TDD rojo: la prueba nueva falló primero en Tortilla (`basic` 1 paso frente a `expert` 2). Después, suite server completa con cobertura: **1.856 aprobadas / 1 omitida**, **90,00 / 82,53 / 95,96 / 93,18 % S/B/F/L**. Suite cliente focal ChromeHeadless: **48/48**. Playwright real, SQLite temporal: recetas/libro/ficha/IA **58/58**; repetición de la suite completa del libro **24/24** y de la ficha tras pulir captura **2/2**. Se comprueban los tres niveles en una receta real del catálogo, default de hogar de una persona, perfil y override, y no-IA para cambios de nivel/raciones. Proveedores IA repetibles simulados; no hubo llamada real.

`pnpm run test:client:coverage`: **1.593/1.593**; **91,92 / 82,77 / 92,76 / 94,23 % S/B/F/L**. `pnpm --filter @hogaria/server run build`, `pnpm run typecheck:e2e`, `pnpm run check:ui` (**256 ficheros / 21 reglas**), build cliente, Prettier y `git diff --check` pasan. Playwright mantiene la geometría del selector de dificultad dentro de **1 CSS px** en desktop, tablet y móvil; capturas sintéticas comparables de la ficha real en `.e2e-screenshots/recipe-book-detail-check-final-20261016/recipe-book-full-detail/` y de la ficha sintética/tablet en `.e2e-screenshots/recipe-level-rations-final2-20261016/recipe-redesign/` (directorios ignorados por Git), inspeccionadas.

**Limitaciones:** `pnpm --filter @hogaria/web run lint` no puede iniciar: falta `@angular-eslint/builder:lint`. El script de lint servidor usa `eslint src --ext .ts`, opción rechazada por ESLint 9; ejecución focal también carece de `eslint.config.*`. No se instalaron dependencias ni se tocó configuración fuera de alcance. La WebAPI con sesión ChatGPT sigue descartada por preflight de privacidad; el smoke se ejecutó con Ollama local. La salida del modelo es estocástica: una generación incluyó el neologismo «rechilada» en el título; E2E valida contrato y persistencia, no calidad editorial determinista. PR #47 continúa Draft.

## Reauditoría de finalización (2026-10-16)

- El skip de gesto táctil auténtico en Playwright WebKit/Safari sigue por falta de CDP; Chromium táctil sí está disponible.
- Ollama local Qwen3:8B (5,2 GB) se cargó y se usó en la prueba aislada; ocupó 5,6 GB de GPU y el proceso propio se detuvo al terminar. No se usó WebAPI ni proveedor externo.
- [x] Test unitario de `pointercancel`: ambos lados del 50 % resuelven al estado más cercano y limpian el gesto/RAF.
- [x] Test unitario de límites de release: progreso y velocidades ±0,45 px/ms verifican inclusión/exclusión de los bordes.
- [x] Test de movimiento reducido: settle aplica transición prácticamente instantánea sin estado intermedio persistente.
- [x] E2E drawer/safe-area móvil con Chromium: gestures cancelados y flujos existentes; suite completa termina sin fallos; safe-area **8/8**.
- [x] E2E local móvil: configuración Ollama→ingredientes de despensa→generación real→revisión→guardado→recarga→ficha; respuesta IA **200**, guardado **201**, receta encontrada tras reload; viewport 393×851, 768×1024 y 1440×900.
- [x] Al sustituir el paso 3 del wizard por la propuesta generada, el scroll del cuerpo del modal vuelve al inicio y el título recibe foco para revisar el contenido; regresión E2E y captura real verificadas.

**Evidencia final (2026-10-16):** el test real falló primero con `scrollTop=42`; `RecipesComponent` ahora reinicia el cuerpo del modal tras renderizar la propuesta y enfoca el título (`tabindex=-1`). Repetición contra build de producción y SQLite temporal: **1/1**, flujo completo en **31,7 s**, `scrollTop=0`, foco en título, respuesta **200**, guardado **201**, reload/ficha correctos. `pnpm run test:client:coverage`: **1.598/1.598**, **91,99 / 82,80 / 92,85 / 94,31 % S/B/F/L**; `pnpm run build` pasa con bundle inicial **962,15 kB**, `pnpm run typecheck:e2e` y `pnpm run check:ui` pasan. Playwright generación IA existente: **16/16**; drawer + safe-area Chromium termina sin fallos, safe-area **8/8**. Capturas reales inspeccionadas desktop/tablet/móvil: `.e2e-screenshots/recipe-local-ai-smoke-20261016/`; ignoradas por Git. Test local aislado limpia DB/artefactos al pasar; Ollama propio quedó detenido.

**Comandos reproducibles:** `pnpm run test:client:coverage`; `pnpm run build`; `pnpm run typecheck:e2e`; `pnpm run check:ui`; `node scripts/run-isolated-playwright.mjs tests/e2e/main-layout-drawer.spec.ts tests/e2e/safe-area-layout.spec.ts --project=mobile-chrome`; `node scripts/run-isolated-playwright.mjs tests/e2e/recipes-ai-generation.spec.ts --project=mobile-chrome`; `$env:HOGARIA_RECIPE_LOCAL_AI_SMOKE='1'; node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts tests/e2e/full-stack/recipe-local-ai-smoke.spec.ts --project=mobile-chrome`.

**Hallazgo visual resuelto:** al sustituir wizard por preview, el modal heredaba 42 px de scroll del paso 3 y el foco quedaba en un control desmontado. El cambio mínimo reinicia el scroll tras renderizar y mueve foco al título; el test local real reproduce rojo antes del cambio y queda verde después.

## Ampliación del asistente global — unidades A/B (2026-10-16)

La autorización del usuario para ampliar PR #47 incluye la edición segura de tareas domésticas (Unidad A) y la propuesta/confirmación de comidas (Unidad B). Esta evidencia supersede la nota anterior que mantenía ambas capacidades fuera del asistente. No cierra el alcance global: edición de despensa/compras/calendario/recetas y prioridad de tareas siguen pendientes por dominio.

- TDD reprodujo y corrigió una regresión en la confirmación de comidas: las raciones revisadas se restablecían al número de participantes. El endpoint persiste ahora las raciones validadas; la prueba verifica que 3 sigue siendo 3 en la respuesta y DB.
- Servidor: suites focales de esquema/rutas/contrato **521** pasan; rutas de propuestas de comidas **36** pasan. Cliente: suites focales del asistente/comidas/ejecución **33** pasan.
- `pnpm run test:coverage`: cliente **1.630/1.630**, **90,60 / 80,38 / 92,10 / 92,99 % S/B/F/L**; servidor **1.955 aprobadas / 1 omitida**, **89,84 / 82,22 / 95,89 / 92,91 % S/B/F/L**. Los gates locales superan el 70 % en las cuatro métricas.
- `pnpm run build`, `pnpm run typecheck:e2e`, `pnpm run check:ui` (**262 ficheros/21 reglas**) y Prettier pasan. El build conserva los avisos de presupuesto/tamaño existentes; no se rebajaron umbrales. Lint sigue limitado por la configuración existente descrita arriba.
- Playwright full-stack aislado con backend/APIs reales, SQLite temporal y respuestas IA sintéticas: **10/10** en escritorio y móvil; viewports 320×568–1440×900, breakpoints, orientación, overflow/scroll, teclado/foco, reduced-motion, targets táctiles, confirmación, persistencia y ausencia de escritura previa verificados.
- Capturas sintéticas PC/móvil inspeccionadas fuera del repositorio: `C:\Users\juanj\.codex\visualizations\2026\10\16\01a144e3-1d9b-78e3-a440-0f38ab3e1e80\ai-action-assistant\chromium\meal-plan-confirm.png`, `...\chromium\meal-plan-saved.png`, `...\mobile-chrome\meal-plan-confirm.png` y `...\mobile-chrome\meal-plan-saved.png`.
- Proveedor externo y micrófono real no probados en esta unidad; respuestas IA deterministas se interceptan en E2E. El PR #47 debe seguir Draft y no mergearse.

### Aprobación parcial y dependencias del asistente global (2026-10-17)

- E2E full-stack con app/API/backend reales, SQLite temporal y propuesta IA sintética: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --grep "aprobación parcial conserva dependencia lista-artículo" --workers=1 tests/e2e/full-stack/ai-action-assistant.spec.ts` — **2/2**. Primer POST de lista devuelve 503 solo en el navegador; reintento usa backend real.
- La revisión no escribe en DB; si se selecciona artículo sin su lista, la UI bloquea continuar. Después de aprobación, la lista fallida bloquea el artículo dependiente, pero tarea independiente completa. Reintentar ejecuta lista→artículo, no repite tarea y persiste una sola lista/artículo tras recargar; evento y receta no se ejecutan.
- Se verifican PC 1440×900 y móvil 320×568. Capturas sintéticas revisadas e ignoradas por Git: `.e2e-screenshots/assistant-dependency-partial-final-20261017-r2/{chromium,mobile-chrome}/shopping-dependency-{unselected,review,confirm,partial,saved}-*.png`. Runner confirma DB/artefactos temporales limpiados. `pnpm run typecheck:e2e` y `pnpm run check:ui` pasan (**263 ficheros/21 reglas/sin incidencias**).
- Esta evidencia cierra solo la casilla vertical de selección parcial/dependencias. No cierra requisitos globales de voz, modelo local, refinamiento ni auditoría de recursos/UI.

### Aprobación selectiva con modelo local — evidencia incremental (2026-10-17)

- Revalidación de recursos antes del smoke: CPU **4–6 %**, RAM libre **7,75–7,78 GiB**, GPU al **0 %** y VRAM libre **14.371 MiB**. `qwen3:8b` ya estaba descargado; se usó únicamente Ollama local **0.30.5** en `127.0.0.1`, sin proveedor externo ni descarga de modelo.
- `$env:HOGARIA_AI_ASSISTANT_LOCAL_SMOKE='1'; node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --grep 'local Ollama writes a selected cross-domain action only after approval' tests/e2e/full-stack/ai-action-assistant-local-provider.spec.ts` — **1/1**, 12,8 s, Chromium contra app/API/backend reales y SQLite temporal sintética.
- Qwen propuso `pantry.add_ingredient` y `shopping.create_list`; ambas empezaron sin seleccionar y el snapshot completo permaneció igual tras generar. La interacción eligió solo la lista; la pantalla de confirmación excluyó despensa; después de confirmar, el endpoint devolvió **201**. Snapshot: solo cambian ledger de acciones, evento y lista; artículos, inventario y `ai_jobs` no cambian. Tras recargar, la lista sigue presente. El runner confirmó cleanup de SQLite/artefactos.
- Muestra puntual durante la corrida (no pico ni atribución exclusiva al asistente): CPU observada **1 %**, RAM libre **6,83 GiB**, GPU **0 %** con **7.217 MiB usados / 8.761 MiB libres**. Después de detener `qwen3:8b` en memoria y parar **el servidor Ollama iniciado para esta prueba**: RAM libre **7,71 GiB**, VRAM libre **14.372 MiB**, sin listener en `127.0.0.1:11434`.
- Esta ejecución supersede las notas anteriores de preflight donde la aprobación local seguía pendiente, pero cierra solo un flujo real de propuesta cruzada + aprobación selectiva de una lista. No valida refinamiento con modelo local, amplitud semántica general, micrófono físico, teclado OS ni la matriz global de rendimiento/UI; PR #47 continúa Draft.

### Refino local: contrato de salida y resumen del campo — fix verificado (2026-10-17)

- El primer E2E real falló con **502 `INVALID_AI_RESULT`**; Ollama devolvió `{"payload":{"quantity":300}}`, sin envelope ni acción completa. Se aclararon ambos prompts de refino para exigir schema/envelope y reemplazo completo. La siguiente respuesta real ya cumplió schema, pero reescribió `replacement.summary` fuera del alcance de campo; el validador la rechazó correctamente.
- Decisión: conservar validación estricta y aprobación HITL. Para refino por campo, el servidor restaura el resumen vigente de la acción antes de validar el ámbito; cualquier otra diferencia fuera del path sigue dando `502`, sin escritura. Tests cubren esa preservación, el rechazo de cambios ajenos en payload y cero escrituras. El E2E compara valores de campos del otro borrador, no `innerText` del card, que cambia al abrir el editor.
- `$env:DATABASE_PATH=':memory:'; pnpm --filter @hogaria/server exec vitest run src/routes/ai-assistant.routes.spec.ts src/schemas/ai-assistant.schema.spec.ts --reporter=dot --maxWorkers=1` — **86/86**; `pnpm run typecheck:e2e` y `pnpm --filter @hogaria/server run build` pasan.
- `$env:HOGARIA_AI_ASSISTANT_LOCAL_SMOKE='1'; node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --grep 'Ollama local refina solo cantidad' tests/e2e/full-stack/ai-action-assistant-local-refinement.spec.ts` — **1/1**, app/backend reales, cuenta/hogar sintéticos, Ollama local 0.30.5 + `qwen3:8b` y SQLite aislada. Refina 250→300 g; conserva nombre/nota editados manualmente y la acción de compra sin seleccionar; snapshot completo y `ai_jobs` quedan iguales antes/después. Runner limpió la DB/artefactos del run.
- Preflight: CPU **12 %**, RAM libre **6,75 GiB**, VRAM libre **8.753 MiB**. Después del test se descargó el modelo y se detuvo el servidor Ollama iniciado para el smoke: CPU **0 %**, RAM libre **7,74 GiB**, VRAM libre **14.376 MiB**, sin listener en `127.0.0.1:11434`.

### Voz nativa sin transcripción — manejo seguro (2026-10-17)

- Smoke autorizado con una frase sintética TTS en Windows: el navegador expuso `SpeechRecognition`, pero no llegó transcripción ni error visible durante 30 s. No se repitió la frase. No se observó POST de propuesta y la consulta read-only de la DB aislada encontró `ai_jobs=0`; el contador ad hoc de escrituras incluía requests de registro/hogar y no permite afirmar cero escrituras globales.
- TDD: test nuevo de `onend` sin texto falló antes (48 aprobados/1 fallido). El reconocimiento que termina vacío muestra el error accesible existente; resultado con transcripción mantiene estado `idle`, y cancelación sigue ignorando eventos tardíos.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/shared/components/ai-action-assistant-dialog.component.spec.ts --browsers=ChromeHeadless --progress=false` — **49/49**.
- `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --workers=1 --grep 'navegar durante dictado|cerrar aborta el dictado' tests/e2e/full-stack/ai-action-assistant.spec.ts` — **4/4**; backend/app reales, dictado stub y DB temporal; runner confirmó cleanup.
- E2E de ausencia de transcripción con snapshot SQLite antes/después y cero POST de propuesta: primero falló porque la alerta quedaba fuera del área visible en móvil (y parcialmente bajo el footer en escritorio). La alerta ahora queda junto a controles y `scrollIntoView({ block: 'nearest' })` la lleva al área de scroll.
- `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --workers=1 --grep 'sin transcripción' tests/e2e/full-stack/ai-action-assistant.spec.ts` — **2/2** con app/API reales y DB temporal; runner confirmó cleanup. Playwright comprueba el rectángulo de la alerta dentro del cuerpo del diálogo.
- Regresión combinada tras el ajuste de scroll: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --workers=1 --grep 'sin transcripción|cerrar aborta el dictado|navegar durante dictado' tests/e2e/full-stack/ai-action-assistant.spec.ts` — **6/6**; runner confirmó cleanup de DB/artifacts temporales.
- Capturas sintéticas inspeccionadas PC/móvil: `.e2e-screenshots/ai-action-assistant-no-transcript-20261017-final-v2/{chromium,mobile-chrome}/voice-no-transcript-error.png` (artefactos ignorados por Git).
- `pnpm run build` pasa sin cambiar budgets; mantiene warnings de bundle/CSS registrados arriba.
- No se validó transcripción nativa real, micrófono físico ni el resultado del teclado virtual del sistema. La aceptación de voz sigue abierta.
