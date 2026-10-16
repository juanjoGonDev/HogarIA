# Prioridad de tareas en el asistente global

Añadir prioridad real a las tareas del hogar y al registro del asistente. El objetivo global del usuario incluye crear y editar tareas con prioridad; no basta con dejarla fuera porque el contrato anterior aún no la persistía.

## Decisión

- Prioridades válidas: `low`, `medium`, `high`; etiquetas traducidas en i18n existente.
- Tareas antiguas o clientes que omitan el campo se leen como `medium`. El siguiente guardado lo normaliza dentro del JSON ya persistido; no hace falta migración SQL.
- Una prioridad no solicitada explícitamente por el usuario se propone como `medium`. La propuesta sigue siendo editable y no escribe hasta confirmar.
- La prioridad se muestra y edita en Planificación > Tareas y en la revisión del asistente. No cambia el orden actual de tareas ni añade operaciones destructivas.
- Se conserva el guardado semanal con autorización, `baseVersion`, preimagen/CAS e idempotencia por acción.

## Evidencia de partida

- `household_task_weeks.tasks_json` guarda ocurrencias completas; el contrato vive en `server/src/schemas/household-task.schema.ts` y la lectura/escritura en `server/src/utils/household-task.store.ts`.
- El endpoint `PUT /api/household/tasks` valida toda la semana y aplica la preimagen de `household.update_task` antes de persistir.
- El asistente ya admite `household.create_task` y `household.update_task`, pero sus payloads no incluyen prioridad y el editor doméstico tampoco la ofrece.

## Aceptación

### Contrato y persistencia

- [ ] El modelo compartido y el esquema Zod admiten únicamente `low | medium | high`.
- [ ] Datos guardados sin prioridad se leen como `medium`, sin perder ninguna otra propiedad ni invalidar la semana.
- [ ] La API acepta omisión compatible como `medium` y rechaza prioridades desconocidas; guardar persiste la prioridad normalizada.
- [ ] El CAS de actualización compara también prioridad; contexto obsoleto, otro cambio concurrente o replay con cuerpo distinto no sobrescriben datos.
- [ ] Crear/editar manualmente, asignación justa, cambio de semana y recarga conservan prioridad.

### Asistente HITL

- [ ] `household.create_task` propone prioridad explícita; si la instrucción no indica una, propone `medium`.
- [ ] `household.update_task` puede cambiar prioridad y mantiene el resto del payload estricto; el refinamiento solo modifica la prioridad cuando el scope lo permite.
- [ ] La UI permite revisar/editar la prioridad antes de aprobar; selección, edición, refinamiento, rechazo y cierre no escriben en SQLite ni `ai_jobs`.
- [ ] Solo la confirmación explícita escribe, mediante la API existente; autorización de hogar, preimagen/CAS e idempotencia siguen vigentes.
- [ ] Rechazo, aprobación parcial, doble clic, repetición, prioridad inválida y cambio concurrente tienen pruebas de regresión.

### UX y verificación

- [ ] Labels y opciones de prioridad están en ES/EN; controles usan labels accesibles, teclado y patrones visuales existentes.
- [ ] Playwright real contra app/API y SQLite temporal cubre crear, editar, recargar, rechazo sin escritura, confirmar y replay en desktop y móvil.
- [ ] Capturas sintéticas desktop/móvil se inspeccionan y guardan fuera de Git; el cambio no introduce overflow ni rompe geometría compartida.
- [ ] Coverage de archivos del alcance ≥70 % en statements, branches, functions y lines; suites completas, `check:ui`, typecheck, build y hooks registrados.
- [ ] Commit atómico y push no forzado a `feat/household-floorplan`; PR #47 permanece Draft.

## Fuera de alcance

- Cambiar el algoritmo de reparto, ordenar tareas por prioridad, añadir niveles nuevos o crear/borrar tareas mediante operaciones destructivas.
- Nueva tabla o columna SQL: la prioridad forma parte del JSON versionado existente.
- Llamadas a proveedor real para validar esta extensión; la suite repetible usa proveedor sintético. La prueba real local/micrófono global sigue separada y optativa según privacidad y recursos.

## Secuencia

1. Publicar esta decisión/checklist en PR #47 antes de cambiar comportamiento.
2. Añadir el campo compatible al contrato y persistencia; escribir pruebas antes del cambio.
3. Integrar creación/edición y UI manual; probar semana y recarga.
4. Integrar payloads, refinamiento y ejecución del asistente; probar cero escrituras antes de aprobación.
5. Ejecutar E2E, cobertura y gates; marcar casillas solo con resultado reproducible.
