# Propuesta de faltantes de compra desde comidas — Asistente global

**Estado:** contrato activo; implementación pendiente. Mantener PR #47 en Draft.
**Alcance:** componer la propuesta efímera de comidas con una vista previa exacta de faltantes de despensa y acciones de compra revisables.
**Idioma:** interfaz ES/EN mediante i18n existente; esta spec en español.

## Decisión

El asistente no debe pedir al modelo que adivine qué ingredientes faltan. Tras generar o refinar el borrador real de comidas, el servidor compara sus recetas y raciones con la despensa doméstica compartida y devuelve una vista previa de solo lectura. Solo la persona usuaria elige y revisa qué artículos propone añadir y a qué lista. Las propuestas de compra quedan sin seleccionar y dependen de confirmar primero el plan de comidas.

No se reutiliza el endpoint de vista previa de comidas persistidas: la propuesta del asistente aún no está guardada y no debe escribirse para poder calcular la compra.

## Invariantes de seguridad y datos

- Generar, refinar, consultar faltantes, editar, seleccionar, rechazar o cerrar el borrador no escribe SQLite, incluidas tablas de dominio y `ai_jobs`.
- El endpoint de preview valida el esquema de propuesta, la sesión y el hogar activo; comprueba permiso de lectura de comidas compartidas y revalida el hogar tras leer el cuerpo. No acepta IDs de despensa ni permisos del modelo.
- El cálculo agrega ingredientes requeridos por nombre normalizado y unidad exacta, escala por raciones y consume stock compartido una sola vez entre comidas. Unidades distintas, nombres ambiguos, comidas sin receta y despensa no compartida se muestran como advertencias; no se presentan como faltantes confirmados ni generan acciones de compra.
- Solo ingredientes requeridos con faltante cuantificable pueden generar acciones `shopping.add_item`. Opcionales no se añaden automáticamente.
- Las acciones derivadas reciben IDs internos, estado `pending`, selección inicial `false`, destino de lista explícito y dependencia de `household.plan_meals`. Crear una lista, si hace falta, también es una acción explícita y las adiciones dependen de ella.
- La confirmación final sigue el dispatcher y APIs de dominio existentes, su autorización y el ledger idempotente. Rechazo/edición/descarte no escribe; los reintentos no vuelven a sumar cantidades.
- Si cambia la propuesta, se recalcula el preview. Se preservan ediciones manuales ajenas al cambio; una discrepancia en el artículo recalculado exige revisión visible, nunca reemplazo silencioso.

## Criterios de aceptación

- [ ] Añadir endpoint efímero, autenticado, limitado y validado para calcular faltantes desde la propuesta actual sin persistirla.
- [ ] Reutilizar/extraer el cálculo de compra para recetas guardadas y propuestas; probar escala de raciones, agregación, stock compartido, cantidades parciales, opcionales, nombres/unidades ambiguos y pantry no compartido.
- [ ] Mostrar faltantes y advertencias en la revisión de comidas. Permitir editar selección, cantidades y lista destino; todas las acciones derivadas quedan deseleccionadas por defecto y ligadas por dependencia al plan.
- [ ] Al refinar/cambiar una receta o porciones, refrescar el preview y reconciliar cambios sin perder silenciosamente ediciones manuales.
- [ ] TDD: pruebas de schema, permisos, hogar cambiado, fechas/raciones inválidas, cero escrituras SQLite/`ai_jobs`, errores y cancelación de solicitudes.
- [ ] Playwright aislado con usuario, hogar, recetas, despensa y lista sintéticos: preview no escribe; se proponen solo faltantes; selección parcial confirma solo lo elegido; rechazo deja cero escrituras; dependencias y replay impiden duplicados; recarga muestra persistencia.
- [ ] Validar PC/móvil, teclado y foco, mensajes ES/EN, errores, overflow y capturas sintéticas ignoradas por Git.
- [ ] Ejecutar coverage aplicable (≥70 % S/B/F/L), typecheck, `check:ui`, build y hooks. Registrar resultados sin afirmar pruebas de modelo/micrófono real que no se ejecuten.

## Límites explícitos

- Sin compras automáticas, checkout, sustituciones de unidad ni inferencia de equivalencias entre ingredientes.
- Sin promover cantidades ambiguas o con unidad incompatible a artículos de compra; pedir revisión manual.
- El smoke local y el micrófono real siguen sujetos a sus preflight de privacidad, consentimiento y recursos de `SPEC.md`.
