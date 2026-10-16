# Edición segura de listas de compra por el asistente

Esta unidad amplía el asistente global con una edición acotada de listas existentes. Solo permite renombrar una lista activa o cambiar su tienda; resolver el target, detectar cambios concurrentes e impedir duplicados son condiciones obligatorias antes de habilitar la aprobación.

**Estado:** contrato activo; implementación pendiente. **Rama/PR:** `feat/household-floorplan` / #47; mantener Draft. **Alcance:** ampliación del PR #47 aprobada por el usuario el 2026-10-16. **Contrato padre:** `SPEC.md` y `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md`.

## Decisiones

| Tema        | Decisión                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acción      | Añadir `shopping.update_list` al registro tipado del asistente.                                                                                                                                                                                                     |
| Campos      | Cambiar solo `name` y/o `store`; no permitir lista vacía ni campos desconocidos. `store: null` puede borrar la tienda.                                                                                                                                              |
| Target      | El modelo entrega nombre actual como selector no confiable. El servidor resuelve exactamente una lista activa dentro del hogar seleccionado (o el ámbito personal explícito) y añade ID, versión y snapshot. Nunca se aceptan IDs/versiones/preimágenes del modelo. |
| Ambigüedad  | Cero o varias coincidencias: no crear acción ejecutable; pedir que el usuario precise la lista.                                                                                                                                                                     |
| Exclusiones | No editar artículos, cantidades, estado, orden ni borrar listas. Calendario, despensa, recetas y prioridad de tareas siguen bajo sus contratos pendientes.                                                                                                          |
| Escritura   | Revalidar identidad/ámbito tras leer el body; CAS atómico por versión y preimagen; acción y ledger de idempotencia en la misma transacción.                                                                                                                         |
| Interfaz    | Mostrar la lista seleccionada y los valores actuales; permitir revisar/editar los cambios; nada escribe antes de aprobar explícitamente esa acción.                                                                                                                 |

## Aceptación

- [ ] TDD: schema estricto acepta solo `targetName` y cambios de `name`/`store`; rechaza campos extra, ambos cambios ausentes y valores fuera de límites.
- [ ] Propuesta resuelve el nombre exacto dentro del ámbito personal/hogar vigente; lista ausente, archivada/terminada o ambigua genera pregunta y no acción ejecutable.
- [ ] Target resuelto contiene ID, versión y snapshot autoritativos del servidor; el refinamiento conserva ese mismo target y no puede cambiarlo ni inyectar otro.
- [ ] Aprobar usa autorización/ámbito actual y un CAS atómico que condiciona versión y preimagen; conflicto, cambio de hogar, pérdida de acceso o target obsoleto deja lista, eventos y ledger intactos.
- [ ] Replay con la misma clave y payload no vuelve a incrementar versión ni duplica eventos; misma clave con payload distinto devuelve conflicto.
- [ ] UI muestra target y edición de nombre/tienda, permite rechazar sin escrituras y solo persiste los cambios seleccionados tras confirmación explícita.
- [ ] Pruebas focales servidor/cliente cubren límites, errores, casos ambiguos, CAS concurrente/retrasado, cambio de ámbito, autorización, retry y edición manual.
- [ ] Playwright full-stack usa backend real y DB aislada: cero escrituras antes de aprobar o al rechazar; aprobación cambia solo la lista elegida y sobrevive a recarga; conflicto concurrente no pisa datos. Validar escritorio y móvil y guardar capturas sintéticas fuera de Git.
- [ ] Ejecutar cobertura en alcance (mínimo 70 % statements/branches/functions/lines), `check:ui`, typecheck E2E, build y gates de push; registrar comandos, resultados y limitaciones antes de marcar casillas.

## Evidencia inicial y riesgos

- El `PATCH /api/shopping/lists/:id` actual compara `version` antes de esperar el body y actualiza solo por ID; por eso no sirve aún para la acción del asistente.
- `shopping_lists.version` avanza también al modificar artículos. La versión puede proteger la lista completa, siempre que el nuevo CAS se ejecute en la misma transacción que el update y el ledger.
- El helper `withAssistantActionIdempotency` ya ejecuta la escritura y guarda el resultado en una transacción SQLite inmediata; un conflicto CAS debe responder con `record: false`.
- Referencias vigentes: `server/src/routes/shopping.routes.ts`, `server/src/schemas/shopping.schema.ts`, `server/src/utils/assistant-action-idempotency.ts`, `server/src/routes/ai-assistant.routes.ts`, `frontend/src/app/shared/models/ai-action-assistant.model.ts` y `frontend/src/app/core/services/ai-action-assistant-execution.service.ts`.

## Fuera de esta unidad

No habilitar edición de artículos ni cambios de estado; esos flujos tienen efectos y reglas separados. Tampoco marcar como completada la aceptación global de voz, proveedor local real, matriz completa de dominios, memoria/RAM o auditoría visual global.
