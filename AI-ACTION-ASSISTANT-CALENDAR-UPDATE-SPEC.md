# Actualización segura de eventos desde el asistente global

**Estado:** contrato activo de esta unidad; implementación pendiente hasta publicar esta spec en el Draft PR #47.
**Rama/PR:** `feat/household-floorplan` / #47. Mantener Draft; no mergear.
**Alcance:** actualizar un evento propio existente con revisión y aprobación explícita. No añadir invitados, editar eventos ajenos, cambiar recurrencia ni borrar eventos.

## Evidencia y decisión

- `calendar_events` almacena propietario, hogar, título, tipo, fecha, horas, descripción (`notes`), ubicación, recurrencia y `updated_at`; no tiene versión monotónica.
- `PATCH /api/calendar/events/:id` permite editar solo al propietario, pero no protege contra cambios obsoletos ni hace idempotente la acción. Además, actualiza campos antes de validar la lista de invitados; no es una ruta segura para el asistente tal cual.
- La nueva operación de dominio debe releer hogar/propietario al confirmar, comparar `updated_at` y snapshot completo dentro de una transacción, validar el resultado y guardar únicamente los campos editables. No incluir invitados ni recurrencia en esta unidad.
- El modelo solo propone título/fecha/hora original para resolver el target y el parche deseado; nunca IDs, hogar, permisos, preimagen, versión o SQL. El servidor adjunta el target y snapshot solo tras una coincidencia única.
- La propuesta/refinamiento y la edición local del borrador deben seguir siendo de solo lectura; proveedor IA determinista solo en la suite repetible. El E2E debe usar app/API reales y SQLite temporal.

## Criterios de aceptación

- [ ] TDD: schema estricto para `calendar.update_event`; rechazar IDs/propiedades desconocidas y limitar campos del parche a título, tipo, fecha, inicio/fin, descripción y ubicación.
- [ ] El servidor resuelve por usuario autenticado y hogar seleccionado exactamente un evento propio según título, fecha y hora original; sin o con varias coincidencias devuelve aclaración no ejecutable y no revela IDs.
- [ ] Propuesta/refinamiento/edición local/rechazo/cierre no escribe tablas de dominio, ledger ni `ai_jobs`; cambiar el hogar durante el flujo invalida la aprobación.
- [ ] La interfaz muestra target, valores anteriores y cambios; permite editar/quitar el parche y ejecutar solo tras confirmación visible.
- [ ] La ruta de dominio revalida propietario/hogar, compara preimagen completa y `updated_at` en transacción, valida la fila resultante y rechaza valores obsoletos con 409 sin escritura parcial.
- [ ] Repetir la misma acción/payload devuelve el resultado idempotente sin una segunda escritura; reusar la clave con target, snapshot o parche distinto devuelve conflicto.
- [ ] No se ofrecen eventos compartidos/ajenos, asistentes/invitados, recurrencia ni acciones destructivas; el usuario conserva control de cada acción.
- [ ] E2E aislado con Playwright, backend/API reales, SQLite temporal y fixture IA determinista cubre sin coincidencia/ambigüedad, rechazo sin escrituras, confirmación y persistencia tras recarga, replay, target obsoleto y conflicto de hogar.
- [ ] Desktop y móvil tienen capturas sintéticas inspeccionadas; controles, foco, teclado, scroll, tamaños táctiles y errores se verifican. Ejecutar coverage gates, typecheck, `check:ui`, build, suites focales y hooks; registrar comandos/resultados/limitaciones antes de marcar `[x]`.

## Verificación

Se añadirá tras la implementación con comandos reproducibles, resultados y limitaciones reales. El smoke de proveedor local/micrófono y RAM/CPU pertenece a la aceptación global, no se simula ni se declara cubierto por esta unidad.
