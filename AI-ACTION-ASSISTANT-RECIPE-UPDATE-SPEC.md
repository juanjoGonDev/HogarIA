# Edición segura de recetas desde el asistente

**Estado:** contrato vertical activo, previo a implementación; subordinado a `SPEC.md` y a `AI-ACTION-ASSISTANT-EXTENSION-SPEC.md`.
**Rama/PR:** `feat/household-floorplan` / #47; mantener Draft.
**Fecha:** 2026-10-16.

## Decisión

Añadir `recipes.update_content` para editar ingredientes, texto de instrucciones y raciones base de una receta propia. La propuesta, refinamiento, edición local y descarte son de solo lectura; se persiste únicamente tras confirmar explícitamente esa acción. No se amplía el PATCH genérico ni se habilitan publicación, borrado, favoritos, fotos/vídeos u otros metadatos.

## Resolución y seguridad

- La IA propone el nombre actual de la receta y el cambio solicitado, nunca un ID. El servidor resuelve una coincidencia exacta normalizada entre recetas editables del usuario autenticado (`author_id` propio y no `catalog`). Una coincidencia inexistente o ambigua genera una pregunta, no una acción ejecutable. Recetas públicas de otros usuarios y de catálogo no son destinos editables.
- Resuelto el destino, una segunda llamada efímera y acotada puede recibir solo el contenido necesario de esa receta para formular un parche tipado. No recibe IDs; no usa `callAI`/`ticket-queue` ni persiste en `ai_jobs`. Error, cancelación o respuesta inválida dejan el borrador sin acción ejecutable.
- La propuesta incluye target y preimagen obtenidos por el servidor. El usuario ve los valores actuales y el cambio, puede editarlos o quitar la acción, y confirma por acción. Refinar conserva target/preimagen y cambios manuales ajenos al ámbito solicitado.
- El parche solo admite: añadir/actualizar/quitar ingredientes por nombre exacto; reemplazar texto de instrucciones por nivel y número de paso; o cambiar raciones base (1–100). Cambiar raciones escala linealmente las cantidades existentes en backend, redondea a 3 decimales y presenta todas las cantidades resultantes antes de confirmar; no se combina con operaciones manuales de ingredientes en la misma acción. Campos de ingrediente permitidos: nombre, cantidad, unidad, preparación, opcional, sustitutos y notas. Los pasos conservan duración, temperatura, temporizadores, consejos y medios existentes. No se aceptan IDs de ingrediente, receta ni instrucciones ejecutables del modelo. Un ingrediente/paso objetivo duplicado o inexistente requiere aclaración; la receta no puede quedar sin ingredientes ni pasos.
- La confirmación usa un endpoint dedicado de asistente, valida de nuevo autenticación, autoría, esquema, target y preimagen dentro de una transacción; actualiza solo campos permitidos y rechaza contenido obsoleto con conflicto sin escritura parcial. No depender solo de `updated_at`, que tiene granularidad insuficiente. La clave de acción se liga a usuario, operación, destino, preimagen y parche: mismo reintento es idempotente; misma clave con otro payload da conflicto.
- No alterar el endpoint PATCH usado por el editor normal ni introducir acceso directo desde frontend a DB.

## Evidencia de partida

- `server/src/routes/recipes.routes.ts`: el PATCH existente valida campos y propiedad, pero no compara preimagen/versión ni usa el ledger de idempotencia; la edición de contenido corresponde solo a recetas propias no editoriales.
- `server/src/schemas/recipe.schema.ts`: ingredientes y pasos tienen validadores reutilizables; recetas guardan pasos planos o tres niveles de instrucciones.
- `server/src/utils/assistant-action-idempotency.ts` y las rutas de despensa/calendario: patrón existente de endpoint específico, preimagen, transacción y clave idempotente.
- `frontend/src/app/core/services/recipe.service.ts`: el editor usa PATCH genérico; esta unidad no debe cambiar su contrato.
- `SPEC.md`: la cobertura de recetas requiere borrador/generación y edición de ingredientes/instrucciones; las ediciones de recetas siguen pendientes del gate de seguridad.

## Checklist de aceptación

- [ ] Esquema estricto del candidato y parche; rechaza campos desconocidos, IDs, cantidades/unidades inválidas, cambios vacíos y objetivos duplicados; cambio de raciones escala las cantidades una sola vez.
- [ ] Target solo de receta propia exacta; cero/múltiples coincidencias, catálogo, receta ajena, inyección de IDs y contenido corrupto no crean una acción ejecutable.
- [ ] Generación/refinamiento usan transporte efímero/cancelable; propuesta, edición, rechazo, cierre y fallo no cambian recetas ni `ai_jobs`.
- [ ] UI revisa valores anterior/nuevo; cambios locales se preservan al refinar fuera de su alcance; solo la acción seleccionada y confirmada se envía.
- [ ] Endpoint dedicado vuelve a validar propiedad y preimagen; CAS obsoleto, mismo ID con otro payload, datos inválidos y referencias ambiguas dan error sin escritura parcial; replay exacto no duplica.
- [ ] TDD de alta/edición/eliminación de ingrediente, reemplazo de instrucción en receta plana y por nivel, cambio de raciones/cantidades, límite de último ingrediente/paso, error/cancelación, no coincidencia/ambigüedad, permisos, doble submit y fallo/reintento parcial.
- [ ] Playwright full-stack contra app/API reales y SQLite temporal: preview/review/refinar/editar/rechazar/cerrar con cero escrituras; confirmar solo selección, recargar y verificar persistencia; replay y conflicto obsoleto seguros.
- [ ] Verificar escritorio y móvil, teclado/foco/lectores, overflow y targets; guardar e inspeccionar capturas sintéticas comparables. Ejecutar cobertura requerida, `check:ui`, typecheck, build y hooks; registrar comandos, resultados y límites antes de marcar casillas.

## Fuera de alcance

Cambiar nombre/propietario/publicación, favoritos, borrar, recalcular nutrición, editar medios, modificar listas de compra desde recetas o añadir capacidades que el contrato vigente no soporte. Proveedores reales, micrófono y auditoría global del shell siguen sujetos a los gates de `SPEC.md`.

## Evidencia de implementación

Pendiente: actualizar PR #47 con este ajuste al contrato antes de implementar. Completar cada casilla solo con evidencia reproducible; el objetivo global permanece abierto.
