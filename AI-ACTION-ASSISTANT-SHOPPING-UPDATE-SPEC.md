# Edición segura de listas de compra por el asistente

Esta unidad amplía el asistente global con una edición acotada de listas existentes. Solo permite renombrar una lista activa o cambiar su tienda; resolver el target, detectar cambios concurrentes e impedir duplicados son condiciones obligatorias antes de habilitar la aprobación.

**Estado:** implementación y verificación local completadas; pendiente commit selectivo y push con hooks. **Rama/PR:** `feat/household-floorplan` / #47; mantener Draft. **Alcance:** ampliación del PR #47 aprobada por el usuario el 2026-10-16. **Contrato padre:** `SPEC.md` y `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md`.

## Decisiones

| Tema        | Decisión                                                                                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Acción      | Añadir `shopping.update_list` al registro tipado del asistente.                                                                                                                                                                                                                                                                                  |
| Campos      | Cambiar solo `name` y/o `store`; no permitir lista vacía ni campos desconocidos. `store: null` puede borrar la tienda.                                                                                                                                                                                                                           |
| Target      | El modelo entrega nombre actual como selector no confiable. El servidor resuelve exactamente una lista activa dentro del hogar seleccionado (o el ámbito personal explícito) y añade ID, versión y snapshot. Los ámbitos son disjuntos: el hogar no incluye fallback a listas personales. Nunca se aceptan IDs/versiones/preimágenes del modelo. |
| Ambigüedad  | Cero o varias coincidencias: no crear acción ejecutable; pedir que el usuario precise la lista.                                                                                                                                                                                                                                                  |
| Exclusiones | No editar artículos, cantidades, estado, orden ni borrar listas. Calendario, despensa, recetas y prioridad de tareas siguen bajo sus contratos pendientes.                                                                                                                                                                                       |
| Escritura   | Revalidar identidad/ámbito tras leer el body; CAS atómico por versión y preimagen; acción y ledger de idempotencia en la misma transacción.                                                                                                                                                                                                      |
| Interfaz    | Mostrar la lista seleccionada y los valores actuales; permitir revisar/editar los cambios; nada escribe antes de aprobar explícitamente esa acción.                                                                                                                                                                                              |

## Aceptación

- [x] TDD: schema estricto acepta solo `targetName` y cambios de `name`/`store`; rechaza campos extra, ambos cambios ausentes y valores fuera de límites. Evidencia: `shopping.schema.spec.ts`, `ai-assistant.schema.spec.ts` y pruebas de rutas.
- [x] Propuesta resuelve el nombre exacto dentro del ámbito personal/hogar vigente; lista ausente, archivada/terminada o ambigua genera pregunta y no acción ejecutable. Los ámbitos personal y hogar no se mezclan.
- [x] Target resuelto contiene ID, versión y snapshot autoritativos del servidor; el refinamiento conserva ese mismo target y no puede cambiarlo ni inyectar otro.
- [x] Aprobar usa autorización/ámbito actual y un CAS atómico que condiciona versión y preimagen; conflicto, cambio de hogar durante la lectura del body o target obsoleto deja lista, eventos y ledger intactos.
- [x] Replay con la misma clave y payload no vuelve a incrementar versión ni duplica eventos; misma clave con payload distinto devuelve conflicto.
- [x] UI muestra target y edición de nombre/tienda, permite rechazar sin escrituras y solo persiste los cambios seleccionados tras confirmación explícita.
- [x] Pruebas focales servidor/cliente cubren límites, errores, casos ambiguos, CAS concurrente/retrasado, cambio de ámbito, autorización, retry y edición manual.
- [x] Playwright full-stack usa backend real y DB aislada: cero escrituras antes de aprobar o al rechazar; aprobación cambia solo la lista elegida y sobrevive a recarga; conflicto concurrente no pisa datos. Validado escritorio y móvil; capturas sintéticas fuera de Git.
- [x] Cobertura en alcance supera 70 % en statements/branches/functions/lines; `check:ui`, typecheck E2E, build y formato pasan. Ver evidencia abajo.
- [ ] Crear commit selectivo, ejecutar hooks de push y publicar en la rama existente; mantener PR #47 en Draft.

## Evidencia reproducible

| Comando / prueba                                                                                                                                                                                | Resultado                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @hogaria/server exec vitest run src/schemas/shopping.schema.spec.ts src/routes/ai-assistant.routes.spec.ts src/routes/shopping.routes.spec.ts src/schemas/form-contract.spec.ts` | 4 archivos; 615 pruebas pasan.                                                                                                                                                           |
| `pnpm run test:server:coverage`                                                                                                                                                                 | 115 archivos pasan, 1 omitido; 1972 pasan, 1 omitido. Statements 89.78 %, branches 82.17 %, functions 95.91 %, lines 92.82 %. DB de test `:memory:`.                                     |
| Pruebas focales cliente                                                                                                                                                                         | 29/29 pasan; `pnpm run test:client:coverage`: 1632/1632; statements 90.60 %, branches 80.37 %, functions 92.11 %, lines 93.00 %.                                                         |
| `pnpm run check:ui`                                                                                                                                                                             | 262 archivos, 21 reglas, sin incidencias.                                                                                                                                                |
| `pnpm run typecheck:e2e`                                                                                                                                                                        | Pasa.                                                                                                                                                                                    |
| `pnpm exec prettier --check` sobre archivos de esta unidad                                                                                                                                      | Pasa.                                                                                                                                                                                    |
| `pnpm run build`                                                                                                                                                                                | Pasa (server + Angular production); quedan avisos preexistentes de budget/estilos/imports, sin errores.                                                                                  |
| Playwright aislado, proyectos `chromium` y `mobile-chrome`, pruebas de rechazo/confirmación y conflicto obsoleto                                                                                | 4/4 pasan; backend real, proveedor IA interceptado con respuesta sintética, DB/artefactos temporales limpiados al cerrar. La matriz visual/teclado previa pasó 2/2 para ambos proyectos. |
| Capturas E2E sintéticas                                                                                                                                                                         | `C:\Users\juanj\.codex\visualizations\2026\10\16\01a144e3-1d9b-78e3-a440-0f38ab3e1e80\ai-action-assistant-shopping\` (escritorio y móvil, fuera de Git).                                 |

Limitación: no se ejecuta proveedor IA real; la respuesta de propuesta se simula en E2E. El push/hook del commit de esta unidad sigue pendiente.

## Evidencia inicial y riesgos

- El `PATCH /api/shopping/lists/:id` actual compara `version` antes de esperar el body y actualiza solo por ID; por eso no sirve aún para la acción del asistente.
- `shopping_lists.version` avanza también al modificar artículos. La versión puede proteger la lista completa, siempre que el nuevo CAS se ejecute en la misma transacción que el update y el ledger.
- El helper `withAssistantActionIdempotency` ya ejecuta la escritura y guarda el resultado en una transacción SQLite inmediata; un conflicto CAS debe responder con `record: false`.
- Referencias vigentes: `server/src/routes/shopping.routes.ts`, `server/src/schemas/shopping.schema.ts`, `server/src/utils/assistant-action-idempotency.ts`, `server/src/routes/ai-assistant.routes.ts`, `frontend/src/app/shared/models/ai-action-assistant.model.ts` y `frontend/src/app/core/services/ai-action-assistant-execution.service.ts`.

## Fuera de esta unidad

No habilitar edición de artículos ni cambios de estado; esos flujos tienen efectos y reglas separados. Tampoco marcar como completada la aceptación global de voz, proveedor local real, matriz completa de dominios, memoria/RAM o auditoría visual global.
