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

- [x] El modelo compartido y el esquema Zod admiten únicamente `low | medium | high`.
- [x] Datos guardados sin prioridad se leen como `medium`, sin perder ninguna otra propiedad ni invalidar la semana.
- [x] La API acepta omisión compatible como `medium` y rechaza prioridades desconocidas; guardar persiste la prioridad normalizada.
- [x] La publicación automática de tareas del plan incluye el campo requerido y usa `medium` si el origen no especifica prioridad, sin modificar prioridades explícitas.
- [x] El CAS de actualización compara también prioridad; contexto obsoleto, otro cambio concurrente o replay con cuerpo distinto no sobrescriben datos.
- [x] Crear/editar manualmente, asignación justa, cambio de semana y recarga conservan prioridad.

### Asistente HITL

- [x] `household.create_task` propone prioridad explícita; si la instrucción no indica una, propone `medium`.
- [x] `household.update_task` puede cambiar prioridad y mantiene el resto del payload estricto; el refinamiento solo modifica la prioridad cuando el scope lo permite.
- [x] La UI permite revisar/editar la prioridad antes de aprobar; selección, edición, refinamiento, rechazo y cierre no escriben en SQLite ni `ai_jobs`.
- [x] Solo la confirmación explícita escribe, mediante la API existente; autorización de hogar, preimagen/CAS e idempotencia siguen vigentes.
- [x] Rechazo, aprobación parcial, doble clic, repetición, prioridad inválida y cambio concurrente tienen pruebas de regresión.

### UX y verificación

- [x] Labels y opciones de prioridad están en ES/EN; controles usan labels accesibles, teclado y patrones visuales existentes.
- [x] En móvil, al expandir los detalles de una tarea, tarjeta y fila crecen en el flujo; el pie sticky de guardado no tapa sus controles.
- [x] Playwright real contra app/API y SQLite temporal cubre crear, editar, recargar, rechazo sin escritura, confirmar y replay en desktop y móvil.
- [x] Capturas sintéticas desktop/móvil se inspeccionan y guardan fuera de Git; el cambio no introduce overflow ni rompe geometría compartida.
- [x] Coverage de archivos del alcance ≥70 % en statements, branches, functions y lines; suites completas, `check:ui`, typecheck, build y hooks registrados.
- [x] Commit atómico y push no forzado a `feat/household-floorplan`; PR #47 permanece Draft.

## Resultados de validación (2026-10-17)

- `pnpm run test:client`: 1.659 pruebas correctas; cobertura global S/B/F/L 90,57/81,10/92,05/93,05 %.
- `pnpm run test:server:coverage`: 120 archivos aprobados, 1 omitido; 2.043 pruebas correctas y 1 omitida. Cobertura del alcance ≥70 % en las cuatro métricas (por ejemplo, `household-tasks.component.ts`: 92,37/82,31/91,67/95,07 %; `ai-action-assistant-dialog.component.ts`: 78,58/72,05/85,45/82,30 %; rutas/esquemas/store de servidor: ≥70 %).
- `pnpm run check:ui`: 262 ficheros, 21 reglas, sin incidencias. `pnpm run typecheck:e2e` y Prettier de los archivos del alcance: correctos. `pnpm run build`: correcto, sin tocar budgets; conserva avisos de tamaño de bundle y Angular existentes.
- Playwright aislado con SQLite temporal: el flujo de tarea del asistente (edición de prioridad, descarte, confirmación, replay, recarga y rechazo de la acción sin escritura) y el lote con creación de tarea por defecto `medium` pasan en proyectos `chromium` y `mobile-chrome`. También pasa el flujo manual de tareas en ambos proyectos, con alta/baja/media, guardado y recarga.
- Capturas sintéticas inspeccionadas y excluidas de Git: `.e2e-screenshots/household-plan-tasks/chromium/task-priority-controls-desktop.png` y `.e2e-screenshots/household-plan-tasks/mobile-chrome/task-priority-controls-mobile.png`.
- `server/src/routes/ai-assistant.routes.spec.ts`: prueba focal de refinamiento permite cambiar prioridad solo con scope `changes.priority`, rechaza el cambio fuera de scope y compara el snapshot SQLite para confirmar cero escrituras.
- Revalidación (2026-10-18): los tests del worker de publicación verifican prioridades `high`, `low` y el default `medium`; suite del worker y contratos **528/528** y `pnpm --filter @hogaria/server exec tsc --noEmit` pasan con `DATABASE_PATH=:memory:`. La suite server completa pasa **2.101**, 1 omitida.

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
