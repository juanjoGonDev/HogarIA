# Extensión segura del asistente global

**Estado:** decisión activa; dependiente de `SPEC.md`, que sigue siendo el contrato global.
**Rama/PR:** `feat/household-floorplan` / #47; Draft obligatorio. No crear otro PR ni mergear.
**Autorización:** el usuario autorizó ampliar PR #47 el 2026-10-16.

## Decisión de integración

La capacidad inicial del asistente solo crea seis tipos de registros. El objetivo global incluye editar registros existentes y planificar comidas; ambos siguen pendientes. La auditoría de APIs existentes muestra que no es seguro habilitar un `update_*` genérico: los targets deben venir de datos leídos por la app, cambios concurrentes deben rechazarse y cada reintento debe ser idempotente.

### Unidad A — editar una tarea doméstica existente

- La respuesta IA puede proponer una coincidencia por título y fecha original; nunca puede elegir ni generar un ID de tarea.
- Tras recibir una candidata, el servidor consulta el hogar activo y resuelve exactamente una tarea en la semana indicada. Solo entonces adjunta a la propuesta el ID, `baseVersion` y snapshot previo obtenidos de la DB. Cero o varias coincidencias producen una pregunta de aclaración y ninguna acción ejecutable.
- El usuario revisa target, valor anterior y cambios antes de confirmar. La propuesta/refinamiento/edición/descartar siguen sin escritura persistente.
- La confirmación usa la API y permisos actuales de tareas, fusiona una sola tarea, conserva todas las demás y guarda mediante CAS de la semana. Preimagen ausente/obsoleta, cambio de versión o cambio de hogar devuelve conflicto; no se fuerza ni se reintenta sobre datos nuevos.
- El movimiento queda limitado a la misma semana; cruzar semanas requiere una escritura atómica de dos semanas y queda rechazado en esta unidad.
- El ledger de idempotencia vincula usuario, acción, hogar, semana, target, preimagen y parche. Repetir el mismo payload devuelve el resultado original; reusar la clave con un payload distinto falla con conflicto.
- Campos iniciales: título, detalles, fecha dentro de la semana, espacio y miembro asignado, sujetos a validación de la API. No cambiar estado de completado, borrar ni inventar campos.
- **Prioridad pendiente:** el schema/store actual de tareas no persiste `priority`. Aunque el objetivo general la menciona, no se incluye en esta unidad hasta acordar e implementar un cambio vertical al contrato, persistencia, API, UI existente y pruebas.

### Unidad B — propuesta de planificación de comidas

- Integrar como flujo especializado de planificación, no como eventos genéricos ni una acción opaca.
- Reutilizar el generador validado de propuestas de comidas con `callAssistantAITransient`; no llamar al dispatcher estándar `callAI`/`ticket-queue`, que escribe en `ai_jobs`.
- La selección de participantes debe ser explícita y visible. No seleccionar ni enviar perfiles/restricciones de miembros por una suposición silenciosa.
- Generar, revisar, refinar y descartar la propuesta sin escrituras SQLite; referencias a recetas, permisos y restricciones se revalidan al confirmar.
- Confirmar comidas usa el endpoint existente de confirmación, con su idempotencia. La lista de compras es una segunda revisión/aprobación separada que usa el preview/aprobación existente; la confirmación de comidas no compra ni modifica listas automáticamente.

### Otras ediciones de registros

- La auditoría de despensa, compras, calendario y recetas encontró endpoints de edición, pero aún requieren garantías por dominio. Despensa limita la edición a registros propios; compras necesita CAS atómico y evitar eventos duplicados; calendario puede mutar antes de rechazar asistentes; recetas carece de preimagen/versión para escrituras obsoletas.
- Mantener estas ediciones fuera del registro ejecutable hasta implementar y probar CAS/preimagen, ledger idempotente, autorización, datos obsoletos, reintento y ausencia de escrituras parciales. El objetivo amplio sigue abierto; esta decisión no las marca como completadas.

## Checklist de aceptación

- [ ] TDD: esquema estricto para `household.update_task`; ID interno y target/snapshot añadidos solo por servidor.
- [ ] Candidata sin coincidencia o ambigua se convierte en aclaración; propuesta y refinamiento no cambian DB ni `ai_jobs`.
- [ ] Confirmación de tarea conserva otras tareas, verifica preimagen/version/hogar/permisos, rechaza traslado fuera de semana y ejecuta CAS.
- [ ] Reintento exacto de edición produce una persistencia; misma clave con parche distinto, dato obsoleto o target ajeno falla sin mutar.
- [ ] E2E Playwright con servidor/API reales y SQLite temporal: preview, refinar, editar localmente y descartar no escriben; aprobación modifica solo el target y persiste al recargar; conflictos/reintentos son seguros.
- [ ] Unidad de comidas usa proveedor transitorio; participantes se eligen expresamente; preview/refinamiento/descarte tienen cero escrituras; confirmar comidas y aprobar compras son pasos separados.
- [ ] Actualizaciones restantes de despensa/compras/calendario/recetas y prioridad de tareas permanecen explícitamente pendientes hasta cumplir sus condiciones de seguridad.
- [ ] Desktop/móvil, accesibilidad, cobertura mínima de repo, build/typecheck/check:ui, capturas sintéticas y limitaciones quedan documentados en `SPEC.md` antes de cerrar.

## Evidencia de la auditoría (2026-10-16)

- `household_tasks` ya tiene semana versionada, CAS por `baseVersion`, validación de referencias y permisos `calendar.edit`; es la ruta de edición más preparada.
- El PATCH de lista de compras lee versión antes de esperar el body y actualiza sin condición de versión. PATCH de ítem incrementa versión y emite evento, por lo que un replay no idempotente duplica efectos.
- El PATCH de evento actualiza el evento antes de validar asistentes. La edición de receta es solo para recetas propias, pero no aplica una precondición de versión/preimagen.
- La generación existente de comidas puede recibir un proveedor inyectable y no guarda comidas; la ruta pública habitual usa `callAI` y persiste `ai_jobs`. La confirmación de comidas es transaccional/idempotente y la aprobación de compra es un paso aparte.
