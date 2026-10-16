# Continuación: integración de UI de recetas

**Rama/PR:** `feat/household-floorplan` / #47, mantener en Draft.  
**Contrato base:** `HOGARIA-SPEC.md`, `QA-RECIPE.PENCIL-REDESIGN.1`, `QA-RECIPE.CREATE-EDIT-TABS.1`, `QA-RECIPE.AI-IMPROVE.1`, `QA-RECIPE.STEP-VIDEO-SEARCH.1` y `QA-SHELL.MOBILE-SIDEBAR-ONLY.1`. Este checklist acota la validación final; no sustituye esos contratos ni amplía el producto.

## Aceptación

- [x] Revalidar en el código y pruebas actuales biblioteca, ficha/subtabs, niveles, alta/edición, propuesta IA revisable y modo cocina; corregir solo defectos demostrados de integración.
- [x] Estado de cocina pertenece al conjunto de instrucciones seleccionado: ocultar/reabrir la sesión conserva el progreso; cambiar el nivel reinicia paso, checklist y timers para no aplicarlos a instrucciones distintas.
- [x] Verificar drawer móvil con gesto desde borde izquierdo: seguimiento progresivo 1:1 al abrir/cerrar, umbrales de distancia/velocidad, gesto parcial/cancelado y swipes rápidos; sin conflicto con scroll/gestos del navegador. Backdrop, botón cerrar, Escape, foco atrapado/restaurado, scroll de fondo bloqueado y semántica accesible permanecen operativos; desktop no cambia.
- [x] Ejecutar Playwright real sobre la app y backend con almacenamiento temporal aislado. Cubrir biblioteca→ficha→cocina y alta/edición; probar mejora con proveedor local real si está disponible y seguro. Pruebas repetibles de terceros siguen simuladas; no escribir en la DB normal ni registrar secretos/datos personales.
- [x] Validar escritorio, tablet y móvil (incluidos 320 px y horizontal), teclado/tacto, reduced-motion, safe-area, estados/error/vacío y ausencia de overflow; inspeccionar y guardar capturas sintéticas PC/tablet/móvil ignoradas por Git.
- [x] Ejecutar pruebas focales primero y luego gates aplicables: cobertura ≥70 % S/B/F/L en alcance, typecheck, `check:ui`, build y suites requeridas. Registrar comandos, resultados y limitaciones en el contrato activo.
- [x] Mantener `pnpm run build` bajo los budgets existentes. Si la integración eleva el bundle inicial, dividir código no crítico en chunk diferido; no rebajar budgets. Revalidar que el gesto móvil siga listo antes de interacción real.
- [ ] Revalidar geometría comparable de elementos equivalentes (≤1 CSS px), diff/árbol de trabajo y Draft PR; commits atómicos en la rama actual, hooks activos, push a `origin` sin force-push.

## Restricciones

- No cambiar de rama, abrir otro PR, trabajar tareas del plano del hogar ni modificar dependencias fuera de necesidad demostrada.
- Preservar cambios existentes staged, unstaged y sin seguimiento; no incluirlos en commits salvo unidad del checklist revisada y atribuible.
- No marcar criterios completos sin evidencia reproducible. No hacer merge ni cambiar el PR a Ready.

## Resultados de validación

- `pnpm run test:client:coverage`: 1.588 tests pasan; statements 91,87 %, branches 82,67 %, functions 92,78 %, lines 94,18 %.
- Playwright aislado (`node scripts/run-isolated-playwright.mjs`, base de datos temporal): libro/ficha/edición 50 pasan; generación IA 32 pasan; cocina 7 pasan y 2 skip; drawer 17 pasan y 1 skip. Proveedores externos simulados en suites repetibles.
- `pnpm run typecheck:e2e`, `pnpm run check:ui` (256 ficheros, 21 reglas), `pnpm run build`, Prettier `--check` del alcance y `git diff --check`: pasan.
- Capturas inspeccionadas, sintéticas e ignoradas por Git: `.e2e-screenshots/recipe-integration-release-20261016/recipe-redesign/library-chromium.png`, `recipe-redesign/library-mobile-chrome.png`, `tablet-cooking-view.png`, `mobile-chrome-cooking-view.png` y `main-layout-drawer-mobile.png`. Viewports verificados incluyen 320×568 y 568×320; suites incluyen teclado, tacto, reduced-motion y safe-area.
- Build inicial limpio (`f148fe7`): 993,09 kB. El árbol completo inicialmente superó el límite de error de 1 MB (1.005,55 kB). La carga diferida del diccionario de recetas dejó bundle inicial en 962,14 kB; build final pasa sin rebajar budgets. Persiste warning informativo del umbral de 500 kB.
- Smoke de mejora con IA local: el preflight rechazó continuar porque la configuración existente de privacidad de WebAPI no era segura. No se creó credencial, no se llamó al modelo, no se generó/guardó receta ni se cambió configuración. Limitación documentada; ninguna petición externa fue enviada.
