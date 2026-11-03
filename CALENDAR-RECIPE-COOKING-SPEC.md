# Recetas completas desde el calendario y modo cocina

**Estado:** decisión revisada; plan ligero y generación bajo demanda por plato.
**Base:** `origin/master` (`a0a9f09137d8c5f20e13884cc80dce03d9844449`).
**Rama:** `feat/calendar-recipe-cooking`.

## Evidencia vigente

- El archivo aportado por el usuario coincide con `POST /api/ai/plan-week`: cada comida solo contiene `name`, `ingredients: string[]` y `time`.
- `server/src/utils/weekly-plan.ts:persistWeeklyPlan` convierte esos datos en `custom_meal` y `notes`, escribe `recipe_id = NULL` y no crea instrucciones de cocina.
- Una semana puede incluir hasta 7 días × 4 comidas. El proveedor recibe un máximo configurado de 4.096 tokens de salida; pedir recetas completas de todas las comidas en una sola respuesta puede truncar o fallar.
- Las tarjetas de calendario abren `openEditModal`; solo una comida con `recipeId` puede abrir una receta.
- El modo cocina existente vive en Recetas y requiere una receta persistida con pasos.
- Contrato canónico existente: `server/src/schemas/recipe-ai-output.schema.ts`, ya reutilizado por el planificador de comidas del hogar. No se crea un segundo contrato de receta.

## Decisiones

1. El plan semanal conserva respuesta ligera (nombre, ingredientes y tiempo), apropiada para una semana completa. No pide 28 recetas detalladas en un solo response.
2. Al elegir «cocinar» una comida de calendario sin `recipeId`, el servidor genera solo esa receta completa con `aiRecipeOutputSchema`, usando título, notas/ingredientes y contexto de comida. El clic es consentimiento explícito para completar esa receta con IA; no hay migración automática.
3. Validar salida canónica y restricciones estrictas antes de escribir. Persistir receta privada del autor y enlazar `recipe_id` en una transacción; salida parcial/inválida, conflicto o error no deja receta huérfana ni altera la comida.
4. Para comidas con receta enlazada, abrir directamente modo cocina. Mantener edición de fecha/hora/raciones disponible con acción separada. Comidas compartidas conservan su flujo de consumo.
5. La ruta profunda acepta `?recipe=<id>&mode=cooking`; si receta/pasos no están disponibles, abre detalle normal sin sesión falsa.
6. Generación permanece en servidor mediante la cola/provider existente; nunca enviar credenciales ni generar desde navegador.

## Criterios de aceptación

### Plan semanal

- [ ] TDD: `plan-week` mantiene contrato ligero; endpoint de cocinar valida receta completa canónica y rechaza salida parcial.
- [ ] Generar receta de una sola comida enlaza receta privada AI al mismo evento y guarda campos canónicos.
- [ ] Solicitudes repetidas/concurrentes reutilizan receta existente o enlazan una sola; slots ocupados no crean recetas huérfanas.
- [ ] Ingrediente incompatible, salida truncada, falta de pasos o fallo DB no deja escrituras parciales.
- [ ] Restricciones de alergias/intolerancias se revalidan sobre ingredientes y sustitutos; nunca se confía solo en el prompt.
- [ ] Plan semanal completo sigue cabiendo en presupuesto configurado y mantiene reglas de huecos/fechas/raciones/horarios.

### Calendario y modo cocina

- [ ] Abrir comida con receta enlazada desde calendario lleva a esa receta en modo cocina; la receta equivocada no puede abrirse por estado obsoleto.
- [ ] Abrir comida sin receta solicita únicamente esa receta, informa progreso/error y abre modo cocina al completarse.
- [ ] Edición de fecha/hora/raciones sigue disponible mediante acción separada.
- [ ] Una comida antigua/personalizada no se altera hasta que usuario solicita cocinar; si generación falla, sigue editable.
- [ ] `?recipe=<id>&mode=cooking` entra en modo cocina solo después de cargar pasos; cerrar o salir restablece detalle/listado y URL coherentes.
- [ ] Teclado/foco, nombre accesible y móvil/escritorio verificados con Playwright.

### Entrega

- [ ] Cobertura de alcance ≥70 % en sentencias, ramas, funciones y líneas; suites focales, typecheck y build pasan.
- [ ] Playwright real PC/móvil usa servidor y DB temporales; guardar capturas sintéticas comparables.
- [ ] CI verde; PR sigue Draft durante cambios y solo pasa a Ready tras completar la lista.

## Evidencia de implementación

Hallazgo: generar todas las recetas canónicas de una semana en una respuesta supera con facilidad el límite de salida configurado; el flujo usa resumen semanal y completa una receta al solicitar cocinar.

Pendiente. Registrar cada regresión roja/verde, comandos, capturas y limitaciones.
