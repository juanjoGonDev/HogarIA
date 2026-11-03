# Recetas completas desde el calendario y modo cocina

**Estado:** contrato propuesto; PR Draft antes de implementar.
**Base:** `origin/master` (`a0a9f09137d8c5f20e13884cc80dce03d9844449`).
**Rama:** `feat/calendar-recipe-cooking`.

## Evidencia vigente

- El archivo aportado por el usuario coincide con `POST /api/ai/plan-week`: cada comida solo contiene `name`, `ingredients: string[]` y `time`.
- `server/src/utils/weekly-plan.ts:persistWeeklyPlan` convierte esos datos en `custom_meal` y `notes`, escribe `recipe_id = NULL` y no crea instrucciones de cocina.
- Las tarjetas de calendario abren `openEditModal`; solo una comida con `recipeId` puede abrir una receta.
- El modo cocina existente vive en Recetas y requiere una receta persistida con pasos.
- Contrato canónico existente: `server/src/schemas/recipe-ai-output.schema.ts`, ya reutilizado por el planificador de comidas del hogar. No se crea un segundo contrato de receta.

## Decisiones

1. El plan semanal del calendario genera recetas completas con `aiRecipeOutputSchema` para cada turno solicitado. La respuesta debe incluir ingredientes estructurados, utensilios, tiempos, conservación y pasos completos para `basic`, `intermediate` y `expert`; nunca se acepta como receta un título con una lista de ingredientes.
2. Validar toda la respuesta y las restricciones estrictas antes de escribir. Persistir receta privada del autor y evento con `recipe_id`; conservar reglas actuales de huecos ocupados, rango de fechas, raciones, horas y tipos permitidos. Una salida incompleta, inválida o truncada no deja recetas/eventos parciales.
3. Para comidas con receta enlazada, activar modo cocina desde el calendario con una acción explícita. Mantener edición disponible por separado. Comidas personalizadas antiguas sin `recipe_id` no se convierten ni reciben pasos inventados; siguen siendo editables.
4. La ruta profunda de receta acepta `mode=cooking`; si receta o pasos no están disponibles, abre detalle normal y no simula una sesión de cocina.
5. Mantener llamada IA en servidor mediante el transporte existente y no mover generación al navegador.

## Criterios de aceptación

### Plan semanal

- [ ] TDD: la forma antigua `{name, ingredients: string[], time}` ya no pasa como salida de `weekly_plan`; receta completa canónica sí.
- [ ] Plan persistido crea receta AI privada, enlaza `recipe_id`, deja `custom_meal` vacío y guarda todos los campos canónicos.
- [ ] Repite una semana con huecos existentes sin crear recetas huérfanas ni reemplazar comidas existentes.
- [ ] Fecha/turno inválido, receta incompleta, salida truncada, ingrediente incompatible o error de persistencia no deja escrituras parciales.
- [ ] Restricciones de alergias/intolerancias se revalidan sobre ingredientes y sustitutos; nunca se confía solo en el prompt.

### Calendario y modo cocina

- [ ] Abrir comida con receta enlazada desde calendario lleva a esa receta en modo cocina; la receta equivocada no puede abrirse por estado obsoleto.
- [ ] Edición de fecha/hora/raciones sigue disponible mediante acción separada.
- [ ] Comida legacy/personalizada sin receta sigue abriendo edición y no muestra un CTA de cocina falso.
- [ ] `?recipe=<id>&mode=cooking` entra en modo cocina solo después de cargar pasos; cerrar o salir restablece detalle/listado y URL coherentes.
- [ ] Teclado/foco, nombre accesible y móvil/escritorio verificados con Playwright.

### Entrega

- [ ] Cobertura de alcance ≥70 % en sentencias, ramas, funciones y líneas; suites focales, typecheck y build pasan.
- [ ] Playwright real PC/móvil usa servidor y DB temporales; guardar capturas sintéticas comparables.
- [ ] CI verde; PR sigue Draft durante cambios y solo pasa a Ready tras completar la lista.

## Evidencia de implementación

Pendiente. Registrar cada regresión roja/verde, comandos, capturas y limitaciones.
