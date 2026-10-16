# Continuación: integración de UI de recetas

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
