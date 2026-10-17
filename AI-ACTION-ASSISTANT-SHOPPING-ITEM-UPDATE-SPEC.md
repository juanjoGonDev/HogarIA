# Edición segura de artículos de compra desde el asistente global

**Estado:** contrato vertical activo; implementación pendiente.
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

- [ ] Esquema estricto de candidato, request de edición y target resuelto; rechazo de campos extra, cantidades no positivas/no finitas y parches vacíos o sin cambio.
- [ ] Resolución de lista y artículo exactos en ámbito explícito; falta/ambigüedad, lista cerrada, artículo marcado/borrado o target duplicado se convierte en aclaración/fallo sin escritura.
- [ ] Endpoint de actualización con permiso, contexto de hogar, preimagen/CAS, ledger idempotente y fallo atómico; no altera campos fuera del allowlist.
- [ ] Refinamiento/edición conservan target y cambios ajenos; cantidad siempre usa semántica set (no sumar).
- [ ] TDD de propuesta/rechazo/edición sin escritura, aprobación explícita, selección parcial, conflicto concurrente, reintento exacto, reutilización de ID con payload distinto y cambio de hogar.
- [ ] E2E Playwright con app/API reales y SQLite temporal: crear lista/artículo por interacción, revisar, descartar con cero escrituras, confirmar, recargar y replay; incluir escritorio y móvil.
- [ ] `SPEC.md` y cuerpo de PR #47 enlazan este contrato; suite focal, cobertura del alcance ≥70 % S/B/F/L, typecheck, `check:ui`, build, formato, hooks y PR Draft comprobados antes de cerrar.

## Evidencia de código que motiva la unidad

- `server/src/routes/shopping.routes.ts`: `POST /lists/:id/items` fusiona producto/unidad sumando cantidades, y `PATCH /lists/:id/items/:itemId` permite campos fuera del alcance del asistente sin CAS/ledger. No reutilizar esas rutas tal cual para actualizar una propuesta revisable.
- `server/src/routes/shopping.routes.ts`: `PATCH /lists/:id/assistant-update` ya ofrece el patrón vertical estrecho para actualizar listas con snapshot, versión, contexto explícito e idempotencia.
- `server/src/schemas/ai-assistant.schema.ts`, `frontend/src/app/shared/models/ai-action-assistant.model.ts` y `frontend/src/app/core/services/ai-action-assistant-execution.service.ts` son los registros tipados actuales; la lista de compra se muestra/editable en `ai-action-assistant-dialog.component.ts`.
