# Edición segura de inventario por el asistente

Esta unidad permite editar un ingrediente de inventario existente desde el asistente, sin ampliar la API con escrituras optimistas ni exponer un target elegido por el modelo. Solo se modifica tras revisión y confirmación explícita.

**Estado:** contrato activo; implementación pendiente. **Rama/PR:** `feat/household-floorplan` / #47; mantener Draft. **Contrato padre:** `SPEC.md` y `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md`. **Anterior:** `AI-ACTION-ASSISTANT-SHOPPING-UPDATE-SPEC.md`.

## Decisiones

| Tema       | Decisión                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Acción     | Añadir `pantry.update_ingredient` al registro tipado y cerrado del asistente.                                                                                                                                                                                                                                                              |
| Campos     | Cambiar solo nombre, categoría, cantidad, unidad, caducidad, ubicación y notas. Sin imagen, código de barras, borrado ni campos desconocidos. `quantity: 0`, `expirationDate: null` y `notes: null` son cambios explícitos válidos.                                                                                                        |
| Target     | El modelo propone un nombre actual no confiable; el servidor resuelve exactamente una fila dentro del ámbito editable que ya autoriza `PATCH /api/pantry/ingredients/:id`: filas del usuario actual en el hogar seleccionado o personales. Nunca modificar filas creadas por otro miembro aunque sean visibles en una despensa compartida. |
| Ambigüedad | Ninguna coincidencia, varias filas con el mismo nombre normalizado o falta de permiso: generar aclaración/error sin acción ejecutable y sin escritura. No seleccionar por fecha/ID.                                                                                                                                                        |
| Revisión   | La propuesta muestra el ingrediente resuelto y snapshot previo/nuevo; se pueden editar campos permitidos. Propuesta, refinamiento, edición local, selección, expansión y rechazo no escriben.                                                                                                                                              |
| Escritura  | Endpoint asistido dedicado exige ID de acción y snapshot explícito del hogar. Después de leer el body revalida hogar, dueño y preimagen; CAS transaccional sobre todos los campos editables previos. Conflicto no registra ledger.                                                                                                         |
| Reintento  | Escritura y ledger de idempotencia en la misma transacción inmediata. Replay del mismo ID/payload no repite cambios; ID repetido con payload distinto devuelve conflicto.                                                                                                                                                                  |

## Aceptación

- [ ] TDD: esquema estricto acepta solo selector `targetName` y cambios permitidos; rechaza campos extra, cambios vacíos, cantidades/unidades/fechas/texto inválidos y acciones desconocidas.
- [ ] El servidor resuelve nombre exacto normalizado solo entre filas que el usuario actual puede editar; no encuentra/ambigua/perdió permiso produce aclaración/error sin `executionTarget`.
- [ ] `executionTarget` contiene ID y snapshot autoritativos del servidor; modelo/refinamiento no pueden introducir, cambiar ni reemplazar el target. El snapshot se limita a los campos necesarios para revisión y CAS.
- [ ] Endpoint asistido exige ID/contexto explícito, revalida sesión/hogar/propiedad después de leer el body, rechaza snapshot obsoleto con 409 y deja inventario/ledger intactos.
- [ ] Un update correcto modifica únicamente campos seleccionados del target; conserva columnas no editadas, rechaza cambio de nombre duplicado dentro del alcance editable y no afecta filas de otros usuarios.
- [ ] Replay exacto no vuelve a incrementar `updated_at` ni aplica otra escritura; mismo ID con distinto scope/target/parche devuelve conflicto.
- [ ] UI edita los campos permitidos, presenta valores previos/nuevos, no persiste antes de confirmar y conserva selección/ediciones de otras acciones. Rechazar deja cero escrituras.
- [ ] Pruebas focales servidor/cliente cubren schema, resolución, ambigüedad, autorización, cambio de hogar, CAS tras body read, replay/conflicto de ID, fallo y edición manual.
- [ ] E2E aislado usa backend real y DB temporal: propuesta/rechazo no cambia ingrediente ni ledger; confirmar actualiza solo el target y persiste tras recarga; replay/conflicto no duplica ni pisa.
- [ ] Ejecutar coverage aplicable (≥70 % S/B/F/L), `check:ui`, typecheck E2E, build, formato y hooks. Capturas sintéticas comparables PC/móvil fuera de Git; registrar comandos/resultados/limitaciones antes de marcar.

## Evidencia del contrato actual

- `server/src/routes/pantry.routes.ts`: `GET /ingredients` puede mostrar filas personales y del hogar seleccionado, pero `PATCH /ingredients/:id` solo permite modificar `user_id = usuario actual` y `household_id = hogar actual o NULL`.
- El `PATCH` actual valida schema y dueño, pero no comprueba preimagen/versión ni usa el ledger asistido; no es suficiente para aprobar una propuesta que puede quedar abierta mientras cambia el dato.
- `ingredients.updated_at` tiene precisión de segundos. Esta unidad no lo usa como único CAS: compara en la transacción todos los campos editables del snapshot; `updated_at` es una comprobación adicional, no la versión autoritativa.
- `withAssistantActionIdempotency` ya vincula ID/payload, ejecuta la escritura y registra respuesta en una transacción SQLite inmediata; debe usarse con `record: false` cuando no se escribió.

## Fuera de esta unidad

No editar ni borrar ingredientes de otro miembro, no mutar cantidades para duplicar/combinar filas, no registrar cambios de prioridad ni cambiar utensilios/productos de catálogo. No cierra la aceptación global: calendario, edición de recetas, otras operaciones de compra, voz/micrófono real y auditoría completa de rendimiento siguen sus propios criterios.

## Entrega

- Publicar esta spec y actualizar la descripción del PR #47 Draft antes del código.
- Implementar una unidad vertical con pruebas y commits selectivos; no tocar ni incluir cambios staged/unstaged ajenos.
- No marcar el PR Ready ni mergear.
