# Edición segura de artículos de compra desde el asistente global

**Estado:** implementación parcial; el flujo seguro de esta acción ya está implementado y probado. Cierre bloqueado por el budget de build, que también falla en `HEAD` limpio (641 B sobre el límite); el PR sigue Draft.
**Contrato padre:** `SPEC.md`; amplía las acciones del dominio `shopping` sin cambiar el comportamiento de la UI normal.
**Rama/PR:** `feat/household-floorplan` / #47; mantener Draft, sin abrir otro PR ni mergear.

## Alcance

Añadir `shopping.update_item` para editar un artículo activo y sin marcar de una lista activa seleccionada explícitamente. Los campos permitidos son nombre, cantidad absoluta, unidad y categoría. No se admite marcar/comprar, borrar/restaurar, cambiar precio/descuento, reordenar ni mover el artículo entre listas. El valor de cantidad representa el total final, nunca un incremento; así un retry no suma unidades.

La acción existente `shopping.update_list` no sustituye esta capacidad: una cambia nombre/tienda de la lista y la nueva acción cambia una línea concreta. Esta unidad no amplía el contrato de `shopping.add_item` ni ejecuta automáticamente otros cambios del plan.

## Contrato y seguridad

- El modelo solo propone nombre exacto de lista, nombre actual del artículo, unidad actual si hace falta desambiguar y el parche tipado solicitado; nunca IDs, `userId`, `householdId`, versiones ni preimágenes.
- El servidor requiere contexto explícito personal o de hogar, busca una única lista activa dentro de ese ámbito y luego una única línea activa/no marcada con coincidencia exacta normalizada de nombre y unidad. Cero o múltiples coincidencias producen una pregunta de aclaración; no se adjunta target ejecutable.
- El servidor resuelve ID, versión actual de la lista y snapshot completo del artículo. La vista previa/refinamiento/edición/rechazo no escribe en SQLite, incluido `ai_jobs`.
- La propuesta y revisión muestran la lista, artículo y valores anterior/nuevo. La edición manual mantiene el mismo target y el mismo alcance; el refinement puede alterar solo los campos solicitados de esa acción.
- Para persistir se usa un endpoint específico de asistente, la autorización vigente del endpoint de compras, preimagen completa y CAS de la versión de lista. Los cambios a artículo/lista, aviso de dominio y ledger idempotente deben quedar en la misma transacción; un conflicto concurrente no se reintenta ni sobrescribe.
- Repetir el mismo ID/solicitud devuelve replay sin una segunda mutación; reutilizar el ID para otro payload falla cerrado. La pertenencia al hogar activo se comprueba al recibir y dentro de la transacción.
- Rechazar, quitar, cerrar o dejar sin seleccionar nunca ejecuta el PATCH. La ejecución solo se produce tras confirmación final explícita y aplica únicamente la acción seleccionada y validada.

## Aceptación

- [x] Esquema estricto de candidato y request de edición; rechaza campos extra, cantidades inválidas y parches vacíos, y convierte unidad/categoría vacías en borrado explícito.
- [x] Resolución de lista/artículo exactos en ámbito explícito; falta de contexto/lista/artículo, lista cerrada o ambigua, artículo marcado/borrado, unidad ambigua y target duplicado terminan en aclaración sin target ejecutable ni escritura.
- [x] Endpoint de actualización con autorización/contexto, preimagen/CAS, ledger idempotente, allowlist y rollback atómico probado.
- [x] Refinamiento conserva lista/artículo/unidad de coincidencia; edición manual mantiene target, parches permitidos y cantidad absoluta.
- [x] TDD de propuesta sin escritura, descarte, edición manual, confirmación, conflicto/preimagen stale, replay exacto y reutilización del ID con otro payload.
- [x] E2E Playwright contra frontend/API reales y SQLite temporal: crear lista/artículo por interacción, revisar, descartar con cero PATCH, editar, confirmar, recargar y replay; Chromium escritorio y Chromium móvil.
- [ ] Verificar selección parcial/dependencias con una propuesta multiacción.
- [ ] `SPEC.md` y cuerpo de PR #47 enlazan este contrato; cobertura del alcance ≥70 % S/B/F/L, typecheck, `check:ui`, build, formato/hooks y PR Draft comprobados antes de cerrar.

## Hallazgo y evidencia reproducible

- El middleware de timestamps entrega `updatedAt` como ISO-8601 (`2026-10-17T01:15:18Z`), mientras SQLite conserva UTC sin zona (`2026-10-17 01:15:18`). Comparar esas cadenas literalmente hacía que toda aprobación chocara con `SHOPPING_ITEM_PREIMAGE_CONFLICT` aunque el artículo no hubiera cambiado. El backend ahora compara valores normalizados y conserva el timestamp crudo leído para el predicado SQL CAS.
- La prueba de ruta reprodujo el 409 antes del fix y pasa después; suite focal actual: `shopping.routes.spec.ts`, `ai-assistant.routes.spec.ts`, `ai-assistant.schema.spec.ts`, `shopping.schema.spec.ts` y `form-contract.spec.ts`.
- E2E aislado repetido tras las normalizaciones de timestamps y campos vacíos: 2/2 proyectos (Chromium escritorio y mobile-chrome), app/API reales, SQLite temporal y proveedor sintético; capturas sintéticas ignoradas por Git en `.e2e-screenshots/ai-shopping-item-update/`.
- Cobertura completa medida: servidor 89.66 % statements / 81.86 % branches / 95.82 % functions / 92.60 % lines; cliente 90.57 % / 80.96 % / 92.06 % / 93.08 %, respectivamente. Suites focales, `typecheck:e2e`, `tsc --noEmit` del servidor y `check:ui` pasan. Los 8 tests de ambos scripts de formato/hook pasan.
- Build de producción sigue bloqueado: un worktree temporal de `HEAD` limpio también excede el budget inicial por 641 B. No se rebajó el límite; falta resolverlo antes de cerrar/pushear.

## Evidencia de código que motiva la unidad

- `server/src/routes/shopping.routes.ts`: `POST /lists/:id/items` fusiona producto/unidad sumando cantidades, y `PATCH /lists/:id/items/:itemId` permite campos fuera del alcance del asistente sin CAS/ledger. No reutilizar esas rutas tal cual para actualizar una propuesta revisable.
- `server/src/routes/shopping.routes.ts`: `PATCH /lists/:id/assistant-update` ya ofrece el patrón vertical estrecho para actualizar listas con snapshot, versión, contexto explícito e idempotencia.
- `server/src/schemas/ai-assistant.schema.ts`, `frontend/src/app/shared/models/ai-action-assistant.model.ts` y `frontend/src/app/core/services/ai-action-assistant-execution.service.ts` son los registros tipados actuales; la lista de compra se muestra/editable en `ai-action-assistant-dialog.component.ts`.
