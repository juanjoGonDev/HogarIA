# Extensión segura del asistente global

**Estado:** decisión activa; dependiente de `SPEC.md`, que sigue siendo el contrato global.
**Rama/PR:** `feat/household-floorplan` / #47; Draft obligatorio. No crear otro PR ni mergear.
**Autorización:** el usuario autorizó ampliar PR #47 el 2026-10-16.

## Decisión de integración

La capacidad inicial del asistente crea seis tipos de registro. Esta extensión incorpora edición segura y acotada de tareas domésticas (Unidad A), planificación de comidas (Unidad B), despensa/calendario (unidades verticales documentadas por separado) y, con autorización explícita del usuario, contenido de recetas (`recipes.update_content`; contrato y evidencia en `AI-ACTION-ASSISTANT-RECIPE-UPDATE-SPEC.md`). Las ediciones de compras y la prioridad de tareas siguen pendientes: no se habilita un `update_*` genérico; cada dominio debe resolver sus targets desde datos de la app, rechazar cambios concurrentes e implementar idempotencia.

### Unidad A — editar una tarea doméstica existente

- La respuesta IA puede proponer una coincidencia por título y fecha original; nunca puede elegir ni generar un ID de tarea.
- Tras recibir una candidata, el servidor consulta el hogar activo y resuelve exactamente una tarea en la semana indicada. Solo entonces adjunta a la propuesta el ID, `baseVersion` y snapshot previo obtenidos de la DB. Cero o varias coincidencias producen una pregunta de aclaración y ninguna acción ejecutable.
- El usuario revisa target, valor anterior y cambios antes de confirmar. La propuesta/refinamiento/edición/descartar siguen sin escritura persistente.
- La confirmación usa la API y permisos actuales de tareas, fusiona una sola tarea, conserva todas las demás y guarda mediante CAS de la semana. Preimagen ausente/obsoleta, cambio de versión o cambio de hogar devuelve conflicto; no se fuerza ni se reintenta sobre datos nuevos.
- El movimiento queda limitado a la misma semana; cruzar semanas requiere una escritura atómica de dos semanas y queda rechazado en esta unidad.
- El ledger de idempotencia vincula usuario, acción, hogar, semana, target, preimagen y parche. Repetir el mismo payload devuelve `idempotent: true` sin aplicar otra escritura; reusar la clave con un payload distinto falla con conflicto.
- Campos iniciales: título, detalles, fecha dentro de la semana, espacio y miembro asignado, sujetos a validación de la API. No cambiar estado de completado, borrar ni inventar campos.
- **Prioridad pendiente:** el schema/store actual de tareas no persiste `priority`. Aunque el objetivo general la menciona, no se incluye en esta unidad hasta acordar e implementar un cambio vertical al contrato, persistencia, API, UI existente y pruebas.

### Unidad B — propuesta de planificación de comidas

- Integrar como flujo especializado de planificación, no como eventos genéricos ni una acción opaca.
- Reutilizar el generador validado de propuestas de comidas con `callAssistantAITransient`; no llamar al dispatcher estándar `callAI`/`ticket-queue`, que escribe en `ai_jobs`.
- La selección de participantes debe ser explícita y visible. No seleccionar ni enviar perfiles/restricciones de miembros por una suposición silenciosa.
- Generar, revisar, refinar y descartar la propuesta sin escrituras SQLite; referencias a recetas, permisos y restricciones se revalidan al confirmar.
- El usuario puede ajustar las raciones en el borrador (1–100 por turno); la refinación conserva esos ajustes salvo petición explícita de cambiar raciones, y la confirmación persiste lo revisado.
- Confirmar comidas usa el endpoint existente de confirmación, con su idempotencia. La lista de compras es una segunda revisión/aprobación separada que usa el preview/aprobación existente; la confirmación de comidas no compra ni modifica listas automáticamente.

### Unidad B.1 — continuar a ingredientes faltantes desde el asistente

- Tras confirmar una propuesta de comidas desde el asistente, ofrecer una acción explícita para abrir una revisión de compra del mismo periodo. No pedir al modelo que estime existencias ni que fabrique ingredientes faltantes.
- Cargar el preview de forma read-only desde el backend usando el rango semanal confirmado, snapshots de receta persistidos, inventario compartido vigente y el servicio existente. Si no se confirmó el plan, no se ofrece el preview derivado.
- Solo son seleccionables para añadir las filas con `status = not_found` o `status = matched` y `missingQuantity > 0`. En ambos casos el usuario puede excluirlas y ajustar la cantidad. Ingredientes opcionales empiezan excluidos. Ambiguos, unidad incompatible, inventario no compartido o snapshot ausente muestran su limitación y nunca se presentan como faltantes verificables.
- Aprobar la compra es un segundo acto humano: solo un botón separado y accesible envía las filas seleccionadas al endpoint existente. No se crea/actualiza una lista al confirmar las comidas, al abrir el preview, al editar cantidades o al descartar.
- La aprobación vuelve a resolver hogar, preview, existencias y lista dentro de la transacción existente; solo acepta claves del preview que sigan siendo faltantes y rechaza claves ambiguas/no compartidas/no disponibles. Preview obsoleto requiere volver a cargar y revisar. Conservar CAS/idempotencia de lista y el límite del source `meal_plan`.
- Fallo de compra no revierte comidas ya confirmadas ni informa éxito de compra; presenta el fallo por separado y permite recargar/revisar. Fallo/rechazo de comidas nunca expone ingredientes como ya planificados.
- Esta continuación la deriva el producto tras persistir comidas; no es una nueva acción del allowlist ni acepta datos de stock, cantidades faltantes o `previewId` provistos por el modelo.

### Otras ediciones de registros

- Los endpoints genéricos de despensa, compras, calendario y recetas tienen distintos riesgos; la extensión no los usa como autorización para el asistente. Despensa, calendario y contenido de recetas usan operaciones de asistente específicas con resolución, preimagen, permisos y protección contra reintentos, documentadas en sus specs verticales. Compras aún necesita CAS atómico/idempotencia antes de habilitar sus ediciones.
- Mantener compras fuera del registro ejecutable hasta implementar y probar CAS/preimagen, ledger idempotente, autorización, datos obsoletos, reintento y ausencia de escrituras parciales. El objetivo global sigue abierto; esta decisión no lo marca como completado.

## Checklist de aceptación

- [x] TDD: esquema estricto para `household.update_task`; ID interno y target/snapshot añadidos solo por servidor.
- [x] Candidata sin coincidencia o ambigua se convierte en aclaración; propuesta y refinamiento no cambian DB ni `ai_jobs`.
- [x] Confirmación de tarea conserva otras tareas, verifica preimagen/version/hogar/permisos, rechaza traslado fuera de semana y ejecuta CAS.
- [x] Reintento exacto de edición produce una persistencia; misma clave con parche distinto, dato obsoleto o target ajeno falla sin mutar.
- [x] E2E Playwright con servidor/API reales y SQLite temporal: preview, refinar, editar localmente y descartar no escriben; aprobación modifica solo el target y persiste al recargar; conflictos/reintentos son seguros.
- [x] Unidad de comidas usa proveedor transitorio; participantes se eligen expresamente; preview/refinamiento/descarte tienen cero escrituras; confirmar comidas y aprobar compras son pasos separados.
- [x] Desde el asistente, después de confirmar comidas, abrir preview de compra solo lectura del mismo rango; seleccionar/excluir/ajustar solo faltantes verificables; ambiguos, sin stock compartido o snapshots no disponibles no se pueden añadir.
- [x] TDD del endpoint de aprobación: solicitudes manipuladas para claves no faltantes/no verificables se rechazan sin modificar listas; faltantes válidos siguen admitiendo selección parcial, cantidad revisada, stale-preview y replay idempotente.
- [x] E2E aislado con APIs reales: propuesta/confirmación de comidas, preview sin escritura, ausencia de lista antes de aprobación, deselección sin escrituras de compra y aprobación explícita que persiste solo las filas faltantes elegidas; una falla transitoria conserva el plan y se reporta aparte.
- [x] Despensa/calendario usan unidades verticales seguras; recetas tienen contrato vertical seguro separado; compras y prioridad permanecen pendientes.
- [x] Desktop/móvil, accesibilidad, cobertura mínima de repo, build/typecheck/check:ui, capturas sintéticas y limitaciones quedan documentados en `SPEC.md` antes de cerrar las unidades A/B; la auditoría visual global del shell y las funciones de edición pendientes siguen abiertas en `SPEC.md`.

## Evidencia de la unidad B.1 (2026-10-17)

- El endpoint vuelve a filtrar filas del preview en el momento de aprobar: solo admite `not_found` o `matched` con `missingQuantity > 0`. Prueba TDD en `server/src/routes/shopping-meal-plan-approval.routes.spec.ts`: antes del fix, arroz ya cubierto se aceptaba (201); después, arroz cubierto, harina ambigua y despensa no compartida devuelven 400 `MEAL_SHOPPING_ITEM_NOT_IN_PREVIEW` y dejan cero listas/ledger. Suite focal: 8/8.
- El diálogo deriva el preview tras confirmar comidas usando el rango persistido y servicio existente; cantidades editables, opcionales excluidos inicialmente, filas no verificables deshabilitadas y compra solo con un segundo botón. Suite Angular focal: 38/38; cubre ausencia de llamadas antes de confirmar comidas o aprobar explícitamente, payload revisado y selección opcional.
- Gate completo de coverage: cliente 1.665/1.665, 90,51 / 80,77 / 92,10 / 93,04 % S/B/F/L; servidor 2.064 pasan, 1 omitida, 89,66 / 81,86 / 95,82 / 92,60 % S/B/F/L. Supera 70 % en los cuatro gates.
- E2E con API/backend de producción y SQLite temporal; solo la respuesta de IA se determina para reproducibilidad. Chromium y mobile Chrome: 2/2. Confirma 7 comidas persistidas, ningún listado al cargar el preview ni al excluir el faltante; inyecta un 503 en la aprobación para comprobar error separado, cero lista y plan intacto; recarga el preview y luego recorre aprobación real, persiste solo `verduras 1800 g` y vuelve a consultar la lista tras recargar la página. Comprueba además 320×568 y 568×320, viewport de checkbox/cantidad, overflow horizontal y pie de aprobación.
- Capturas sintéticas ignoradas por Git (PC y móvil): `.e2e-screenshots/ai-action-assistant-meal-shopping-20261017/{chromium,mobile-chrome}/meal-shopping-review.png`, `meal-shopping-error.png` y `meal-shopping-approved.png`; se inspeccionaron revisión y éxito.
- `pnpm run typecheck:e2e`, `pnpm run check:ui` (263 ficheros/21 reglas), `pnpm run build`, Prettier y `git diff --check` pasan. El build conserva 974,45 kB raw inicial y carga el asistente en un chunk lazy de 151,78 kB raw. Además de warnings de budgets previos en otras familias, el CSS encapsulado del diálogo llega a 11,70 kB, 1,70 kB sobre el aviso local de 10 kB; queda registrado como optimización pendiente junto a la auditoría global de rendimiento. No se rebajaron budgets.
- La respuesta 503 del E2E es fault injection solo para verificar recuperación; la ruta de éxito y las escrituras siguen en el servidor real aislado. No se hizo smoke de micrófono ni de proveedor IA real en esta unidad.

## Evidencia de la unidad A (2026-10-16)

- `pnpm --filter @hogaria/server exec vitest run src/schemas/ai-assistant.schema.spec.ts src/routes/ai-assistant.routes.spec.ts src/routes/household-tasks.routes.spec.ts`: 3 ficheros, 51 pruebas pasan. Incluye esquema/target, aclaración, permisos, CAS, preimagen obsoleta/ajena, reintento idéntico y conflicto al reutilizar clave.
- `pnpm --filter @hogaria/web exec ng test --no-watch --browsers=ChromeHeadless --include=src/app/core/services/ai-action-assistant.service.spec.ts --include=src/app/core/services/ai-action-assistant-execution.service.spec.ts --include=src/app/shared/components/ai-action-assistant-dialog.component.spec.ts`: 27 pruebas focales pasan; al limitar `--include`, Angular informa coverage `Unknown%`. El gate de coverage completo, registrado arriba, sí se ejecutó y pasa.
- `pnpm run test:client:coverage`: 1.625 pruebas pasan; coverage **90,77 / 80,59 / 92,06 / 93,15 % S/B/F/L**. `pnpm --filter @hogaria/server run test:coverage`: 1.942 pasan, 1 skip; coverage **89,98 / 82,44 / 95,96 / 93,06 % S/B/F/L**. Todos los gates superan el 70 %.
- `pnpm run typecheck:e2e`, `pnpm run check:ui` (262 ficheros/21 reglas) y `pnpm run build`: pasan. Build genera el diálogo lazy de 74,00 kB raw; bundle inicial 992,48 kB raw y mantiene warnings/budgets existentes, sin cambiar umbrales.
- `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --grep "actualiza solo la tarea resuelta"`: 2/2 E2E pasan con API/backend reales, SQLite temporal y registros sintéticos. La propuesta/refinamiento IA se sustituyen por respuestas deterministas; aprobación/replay/conflicto recorren API real y la recarga confirma persistencia.
- Capturas sintéticas PC y móvil: `task-update-review.png` y `task-update-confirm.png`, generadas para Chromium escritorio y móvil. No se hizo preflight real del proveedor local ni del micrófono en esta unidad.
- El primer `pnpm run test:coverage` encontró que el contrato de formularios admite `assistantAction=null`; se resolvió haciendo el campo nuevo nullable/optional. Verificación focal de contrato y tareas: 515 pruebas pasan. El cliente y servidor de cobertura se repitieron y pasan.
- Siguiente: registrar matriz global de UI/rendimiento en `SPEC.md` y abordar Unidad B (comidas); mantener otras ediciones y prioridad pendientes.

## Evidencia de la auditoría (2026-10-16)

- `household_tasks` ya tiene semana versionada, CAS por `baseVersion`, validación de referencias y permisos `calendar.edit`; es la ruta de edición más preparada.
- El PATCH de lista de compras lee versión antes de esperar el body y actualiza sin condición de versión. PATCH de ítem incrementa versión y emite evento, por lo que un replay no idempotente duplica efectos.
- El PATCH de evento actualiza el evento antes de validar asistentes. La edición de receta es solo para recetas propias, pero no aplica una precondición de versión/preimagen.
- La generación existente de comidas puede recibir un proveedor inyectable y no guarda comidas; la ruta pública habitual usa `callAI` y persiste `ai_jobs`. La confirmación de comidas es transaccional/idempotente y la aprobación de compra es un paso aparte.

## Evidencia de la unidad B (2026-10-16)

- El esquema estricto de `household.plan_meals` acepta solo semana e instrucciones; el cliente elige participantes con `calendar.view` de forma visible y parte sin nadie seleccionado. Las rutas de propuesta/refinamiento usan `callAssistantAITransient`, revalidan permisos y usan `Cache-Control: no-store`; ni las tablas de dominio ni `ai_jobs` cambian antes de confirmar.
- El E2E verifica generar, refinar, ajustar raciones, descartar y volver a generar sin escrituras; la confirmación usa la API real, persiste solo las comidas aprobadas, mantiene la lista de compras intacta y el replay es idempotente. La captura sintética confirma en el preview que las 3 raciones editadas se conservan tras refinamiento y en DB.
- Regresión TDD de la confirmación compartida: el test falló primero porque normalizar participantes sobrescribía las raciones revisadas (3 volvía a 2); ahora se persisten las raciones del payload validado y el test focal de las 36 rutas pasa.
- `pnpm --filter @hogaria/server exec vitest run src/routes/ai-assistant.routes.spec.ts src/schemas/ai-assistant.schema.spec.ts src/schemas/form-contract.spec.ts`: 521 pruebas pasan. `pnpm --filter @hogaria/server exec vitest run src/routes/household-meal-proposals.routes.spec.ts`: 36 pasan. Pruebas focales Angular del asistente/comidas/ejecución: 33 pasan.
- `pnpm run test:coverage`: cliente **1.630/1.630**, **90,60 / 80,38 / 92,10 / 92,99 % S/B/F/L**; servidor **1.955 aprobadas / 1 omitida**, **89,84 / 82,22 / 95,89 / 92,91 % S/B/F/L**; todos los umbrales son ≥70 %.
- `pnpm run build`, `pnpm run typecheck:e2e`, `pnpm run check:ui` (**262 ficheros/21 reglas**) y Prettier pasan. Build mantiene warnings de estilos y del bundle inicial (**995,25 kB raw**, sobre el aviso de 500 kB pero bajo el error existente de 1 MB); no se rebajaron budgets.
- Playwright full-stack contra build de producción, backend/API reales y SQLite temporal, con solo las respuestas IA deterministas interceptadas: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome tests/e2e/full-stack/ai-action-assistant.spec.ts` — **10/10**. La primera prueba verifica 1440×900, 1024×768/1023×768, 767×768, 640×800/639×800, 480×800, 393×851, 320×568 y 568×320, scroll/overflow, diálogo, foco, teclado, reduced-motion, target táctil y persistencia selectiva.
- Capturas sintéticas inspeccionadas PC/móvil: `C:\Users\juanj\.codex\visualizations\2026\10\16\01a144e3-1d9b-78e3-a440-0f38ab3e1e80\ai-action-assistant\chromium\meal-plan-confirm.png`, `...\chromium\meal-plan-saved.png`, `...\mobile-chrome\meal-plan-confirm.png` y `...\mobile-chrome\meal-plan-saved.png`. Los artefactos están fuera del repositorio.
- Limitaciones: los proveedores externos se simularon en las suites; no se ejecutó un smoke real de Ollama ni micrófono. Las ediciones de compras y prioridad siguen fuera del registro hasta garantías verticales por dominio; la auditoría visual global continúa abierta. El Draft PR #47 no se mergea ni cambia a Ready.

## Evidencia de la extensión de recetas (2026-10-17)

- El usuario autorizó ampliar PR #47. `recipes.update_content` queda limitado a ingredientes, pasos y raciones base, con revisión humana y PATCH específico protegido por preimagen/CAS e idempotencia; no se abre edición genérica, publicación ni borrado. Ver contrato detallado y pendientes de gate en `AI-ACTION-ASSISTANT-RECIPE-UPDATE-SPEC.md`.
- Las suites de cobertura completa más recientes pasan: cliente 1.653 pruebas, 90,36/80,17/91,96/92,83 % S/B/F/L; servidor 2.040 pruebas y 1 omitida, 89,68/81,83/95,79/92,63 % S/B/F/L. `pnpm run build`, `pnpm run typecheck:e2e` y `pnpm run check:ui` también pasan.
- Limitación del entorno: Angular lint no encuentra `@angular-eslint/builder:lint`; lint de servidor invoca `eslint --ext` incompatible con ESLint 9.17. No se cambió configuración ni dependencia para ocultarlo. Los proveedores reales no se probaron; compras, prioridad y auditoría global siguen pendientes. PR #47 permanece Draft y sin merge.
