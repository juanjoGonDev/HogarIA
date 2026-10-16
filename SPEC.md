# Continuación: integración de UI de recetas

**Rama/PR:** `feat/household-floorplan` / #47, mantener en Draft.  
**Contrato base:** `HOGARIA-SPEC.md`, `QA-RECIPE.PENCIL-REDESIGN.1`, `QA-RECIPE.CREATE-EDIT-TABS.1`, `QA-RECIPE.AI-IMPROVE.1`, `QA-RECIPE.STEP-VIDEO-SEARCH.1` y `QA-SHELL.MOBILE-SIDEBAR-ONLY.1`. Este checklist acota la validación final; no sustituye esos contratos ni amplía el producto.

## Aceptación

- [ ] Revalidar en el código y pruebas actuales biblioteca, ficha/subtabs, niveles, alta/edición, propuesta IA revisable y modo cocina; corregir solo defectos demostrados de integración.
- [ ] Verificar drawer móvil con gesto desde borde izquierdo: seguimiento progresivo 1:1 al abrir/cerrar, umbrales de distancia/velocidad, gesto parcial/cancelado y swipes rápidos; sin conflicto con scroll/gestos del navegador. Backdrop, botón cerrar, Escape, foco atrapado/restaurado, scroll de fondo bloqueado y semántica accesible permanecen operativos; desktop no cambia.
- [ ] Ejecutar Playwright real sobre la app y backend con almacenamiento temporal aislado. Cubrir biblioteca→ficha→cocina y alta/edición; probar mejora con proveedor local real si está disponible y seguro. Pruebas repetibles de terceros siguen simuladas; no escribir en la DB normal ni registrar secretos/datos personales.
- [ ] Validar escritorio, tablet y móvil (incluidos 320 px y horizontal), teclado/tacto, reduced-motion, safe-area, estados/error/vacío y ausencia de overflow; inspeccionar y guardar capturas sintéticas PC/tablet/móvil ignoradas por Git.
- [ ] Ejecutar pruebas focales primero y luego gates aplicables: cobertura ≥70 % S/B/F/L en alcance, typecheck, `check:ui`, build y suites requeridas. Registrar comandos, resultados y limitaciones en el contrato activo.
- [ ] Revalidar geometría comparable de elementos equivalentes (≤1 CSS px), diff/árbol de trabajo y Draft PR; commits atómicos en la rama actual, hooks activos, push a `origin` sin force-push.

## Restricciones

- No cambiar de rama, abrir otro PR, trabajar tareas del plano del hogar ni modificar dependencias fuera de necesidad demostrada.
- Preservar cambios existentes staged, unstaged y sin seguimiento; no incluirlos en commits salvo unidad del checklist revisada y atribuible.
- No marcar criterios completos sin evidencia reproducible. No hacer merge ni cambiar el PR a Ready.
