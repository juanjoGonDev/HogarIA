# Edición segura de inventario por el asistente

Esta unidad permite editar un ingrediente de inventario existente desde el asistente, sin ampliar la API con escrituras optimistas ni exponer un target elegido por el modelo. Solo se modifica tras revisión y confirmación explícita.

**Estado:** unidad implementada y verificada; la aceptación global del asistente sigue pendiente. **Rama/PR:** `feat/household-floorplan` / #47; mantener Draft. **Contrato padre:** `SPEC.md` y `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md`. **Anterior:** `AI-ACTION-ASSISTANT-SHOPPING-UPDATE-SPEC.md`.

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

- [x] TDD: esquema estricto acepta solo selector `targetName` y cambios permitidos; rechaza campos extra, cambios vacíos, cantidades/unidades/fechas/texto inválidos y acciones desconocidas.
- [x] El servidor resuelve nombre exacto normalizado solo entre filas que el usuario actual puede editar; no encuentra/ambigua/perdió permiso produce aclaración/error sin `executionTarget`.
- [x] `executionTarget` contiene ID y snapshot autoritativos del servidor; modelo/refinamiento no pueden introducir, cambiar ni reemplazar el target. El snapshot se limita a los campos necesarios para revisión y CAS.
- [x] Endpoint asistido exige ID/contexto explícito, revalida sesión/hogar/propiedad después de leer el body, rechaza snapshot obsoleto con 409 y deja inventario/ledger intactos.
- [x] Un update correcto modifica únicamente campos seleccionados del target; conserva columnas no editadas, rechaza cambio de nombre duplicado dentro del alcance editable y no afecta filas de otros usuarios.
- [x] Replay exacto no vuelve a incrementar `updated_at` ni aplica otra escritura; mismo ID con distinto scope/target/parche devuelve conflicto.
- [x] UI edita los campos permitidos, presenta valores previos/nuevos, no persiste antes de confirmar y conserva selección/ediciones de otras acciones. Rechazar deja cero escrituras.
- [x] Pruebas focales servidor/cliente cubren schema, resolución, ambigüedad, autorización, cambio de hogar, CAS tras body read, replay/conflicto de ID, fallo y edición manual.
- [x] E2E aislado usa backend real y DB temporal: propuesta/rechazo no cambia ingrediente ni ledger; confirmar actualiza solo el target y persiste tras recarga; replay/conflicto no duplica ni pisa.
- [x] Ejecutar coverage aplicable (≥70 % S/B/F/L), `check:ui`, typecheck E2E, build, formato y hooks. Capturas sintéticas comparables PC/móvil fuera de Git; registrar comandos/resultados/limitaciones antes de marcar.

## Evidencia del contrato actual

- `server/src/routes/pantry.routes.ts`: `GET /ingredients` puede mostrar filas personales y del hogar seleccionado, pero `PATCH /ingredients/:id` solo permite modificar `user_id = usuario actual` y `household_id = hogar actual o NULL`.
- El `PATCH` actual valida schema y dueño, pero no comprueba preimagen/versión ni usa el ledger asistido; no es suficiente para aprobar una propuesta que puede quedar abierta mientras cambia el dato.
- `ingredients.updated_at` tiene precisión de segundos. Esta unidad no lo usa como único CAS: compara en la transacción todos los campos editables del snapshot; `updated_at` es una comprobación adicional, no la versión autoritativa.
- `withAssistantActionIdempotency` ya vincula ID/payload, ejecuta la escritura y registra respuesta en una transacción SQLite inmediata; debe usarse con `record: false` cuando no se escribió.
- SQLite puede entregar `updated_at` como `YYYY-MM-DD HH:mm:ss`, mientras el contrato HTTP lo serializa como ISO UTC. Ambos valores se comparan como el mismo instante; el CAS SQL conserva el valor nativo.

## Verificación (2026-10-16)

- Servidor focal: `pnpm --filter @hogaria/server exec vitest run src/routes/ai-assistant.routes.spec.ts src/routes/ai-assistant-domain-idempotency.routes.spec.ts src/routes/pantry.routes.spec.ts src/schemas/ai-assistant.schema.spec.ts src/schemas/ai-assistant-pantry-update.schema.spec.ts src/utils/assistant-pantry-ingredient-scope.spec.ts` — 6 archivos, 91 pruebas aprobadas. `form-contract.spec.ts` — 479 aprobadas.
- Cliente focal: `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/services/ai-action-assistant-execution.service.spec.ts --include=src/app/shared/components/ai-action-assistant-dialog.component.spec.ts --browsers=ChromeHeadless` — 31 aprobadas.
- Coverage: `pnpm run test:coverage` — cliente 1,635 aprobadas; servidor 117 archivos aprobados, 1 omitido, 1,992 pruebas aprobadas y 1 omitida. Cliente S/B/F/L: 90.56/80.14/92.19/92.99 %. Servidor: 89.75/82.04/95.89/92.74 %. Schema de escritura: 100 %; utilidades de ámbito/nombre/fecha: 100/90/100/100 % S/B/F/L.
- `pnpm run check:ui` — 262 archivos, 21 reglas, sin incidencias. `pnpm run typecheck:e2e` — aprobado. `pnpm exec prettier --check` sobre los archivos de esta unidad — aprobado.
- `pnpm run build` — aprobado; conserva warnings Angular y presupuesto inicial de bundle existentes (996.84 kB; warning, sin cambio de umbrales).
- E2E aislado: `$env:E2E_SCREENSHOT_DIR='.e2e-screenshots/assistant-pantry-update-20261016'; node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --grep 'edita un ingrediente propio|preimagen obsoleta del inventario'` — 4/4 aprobadas con servidor/API y SQLite temporal reales; confirma rechazo sin escritura, confirmación selectiva, persistencia tras recarga, replay idempotente y conflicto CAS sin sobrescritura.
- En E2E, respuesta de propuesta AI usa fixture determinista; endpoint de escritura y DB son reales. No se ejecutaron proveedor AI local, micrófono/transcripción real ni métricas de RAM; esos criterios siguen pendientes en la spec global. El smoke global del proveedor es opt-in.
- Capturas sintéticas fuera de Git: `.e2e-screenshots/assistant-pantry-update-20261016/{chromium,mobile-chrome}/pantry-update-{review,confirm,saved}.png`.

### Etiqueta de categoría — regresión de legibilidad (2026-10-17)

- TDD reprodujo que el resumen mostraba la clave interna (`dairy`/`other`) aunque el selector de edición ya usaba etiquetas localizadas. `pantryCategoryName` ahora resuelve contra el catálogo del hogar y reutiliza `pantryCategoryLabel`; la revisión y la confirmación muestran la etiqueta (“Lácteos”, “Otros”), con fallback para categorías personalizadas/desconocidas y guion si no hay categoría.
- `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/shared/components/ai-action-assistant-dialog.component.spec.ts --browsers=ChromeHeadless --progress=false` — **40/40**. El test verifica resumen de revisión/confirmación, fallback vacío y categoría personalizada. La primera ejecución falló antes del fix con `category: dairy` en vez de `Lácteos`.
- Con build de producción actualizado: `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium --project=mobile-chrome --grep 'asistente global: edita un ingrediente propio solo tras confirmar y protege el replay' tests/e2e/full-stack/ai-action-assistant.spec.ts` — **2/2**; confirma etiquetas localizadas en revisión y confirmación en PC/móvil, además de la escritura solo tras confirmación y DB temporal aislada.
- `pnpm run build`, `pnpm run typecheck:e2e`, `pnpm run check:ui` (263 ficheros / 21 reglas), Prettier y `git diff --check` pasan. El runner full-stack sirve el artefacto existente `frontend/dist`; reconstruirlo antes de probar cambios de UI. Persisten warnings de bundle/estilos existentes, sin modificar budgets.
- Capturas sintéticas inspeccionadas e ignoradas por Git: `.e2e-screenshots/ai-action-assistant-category-label-20261017-rerun/{chromium,mobile-chrome}/pantry-update-{review,confirm,saved}.png`.

## Fuera de esta unidad

No editar ni borrar ingredientes de otro miembro, no mutar cantidades para duplicar/combinar filas, no registrar cambios de prioridad ni cambiar utensilios/productos de catálogo. No cierra la aceptación global: calendario, edición de recetas, otras operaciones de compra, voz/micrófono real y auditoría completa de rendimiento siguen sus propios criterios.

## Entrega

- Publicar esta spec y actualizar la descripción del PR #47 Draft antes del código.
- Implementar una unidad vertical con pruebas y commits selectivos; no tocar ni incluir cambios staged/unstaged ajenos.
- No marcar el PR Ready ni mergear.
