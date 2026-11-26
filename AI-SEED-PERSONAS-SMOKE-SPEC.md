# Generador de perfiles sintéticos y smoke de IA

**Estado:** Draft; criterios pendientes de implementación y ejecución.
**Rama/PR:** `feat/calendar-recipe-cooking` / #72 Draft. Sin merge ni publicación de datos.

## Objetivo

Crear un generador reutilizable de cuentas de prueba para usuarios solos y hogares con varios miembros, y una matriz finita que ejercite las entradas de generación de IA con perfiles sintéticos. Todas las cuentas creadas por el generador comparten la contraseña de prueba centralizada en el helper E2E existente; el generador no la duplica ni la incluye en capturas o informes.

## Fuente vigente revisada

- `server/src/schemas/auth.schema.ts` y `server/src/routes/auth.routes.ts`: el alta acepta nivel de cocina; `PATCH /api/auth/taste` permite generar perfil culinario, objetivos, alergias, gustos, módulos y horarios.
- `server/src/schemas/household.schema.ts`: enum de roles, nivel, dieta, tolerancia al picante, ración y gravedad de alergia.
- `server/src/utils/taste-profile.ts`: niveles `none | beginner | intermediate | expert`, objetivos `balanced | weight-loss | weight-gain | muscle-gain | maintenance | variety | custom`, módulos `meals | pantry | shopping | receipts | home`.
- `server/src/utils/ai-client.ts` y `server/src/utils/ai-function-providers.ts`: jobs actuales `receipt | recipe | multiple_recipes | recommendations | weekly_plan | shopping_photo | expiry_estimate | household_plan | assistant | product_image_search | connection_test`; asignaciones de proveedor para recetas, planificación, despensa/compra y hogar.
- `server/src/routes/ai.routes.ts`, `ai-assistant.routes.ts`, `household-meal-proposals.routes.ts`, `household-plan.routes.ts`, `shopping.routes.ts` y `receipts.routes.ts`: rutas síncronas y trabajos de fondo que generan o interpretan contenido mediante IA.
- `AI-ACTION-ASSISTANT-WEBAPI-SMOKE-SPEC.md` y `tests/e2e/ai-real-smoke.spec.ts`: existe un smoke real aislado para asistente, planificación, recetas, flujos de compra/ticket y cola; no existe un generador común de perfiles.

## Decisiones y límites

- Cubrir los valores válidos del contrato con una matriz pareada, no el producto cartesiano de todas las opciones: cuentas solas, hogar de 2 miembros y hogar numeroso; variedad de niveles, objetivos, módulos, alergias, dietas y permisos.
- Crear correos sintéticos bajo `hogaria.test`, con identificador único de ejecución. No incorporar datos de personas reales.
- Crear cuentas mediante el helper de registro E2E existente, que aplica una contraseña común de prueba sin duplicarla en el generador. Mantener JWT y token WebAPI solo en memoria; no guardar credenciales, prompts ni respuestas en fixtures, logs, capturas o reportes.
- El smoke no depende de una sesión real ni de Brave. Los JWT de las cuentas sintéticas y el token temporal de WebAPI viven solo en memoria. Reutilizar el harness que crea y elimina el token propio; no revocar tokens ajenos.
- Toda escritura del smoke debe pasar por una SQLite temporal cuya ruta efectiva `DATABASE_PATH` esté contenida en el directorio exclusivo de esa ejecución. El generador debe rechazar orígenes no loopback y bases no aisladas en modo de prueba. No usar la SQLite del servidor DevBar en ejecución.
- Los smokes reales son opt-in, secuenciales y con presupuesto máximo de llamadas explícito por flujo. Un error detiene la matriz; no hay reintentos ciegos ni bucles sin límite. Las suites repetibles simulan al proveedor.
- Las propuestas no se aplican salvo que un escenario exija comprobar un flujo de confirmación; ese escenario usa datos y DB desechables.

## Checklist de aceptación

- [ ] El generador comparte un catálogo tipado de perfiles y hogares; valores de nivel/objetivo/módulo/rol/dieta/alergia cubiertos, con hogares solo y multi-miembro.
- [ ] Todas las cuentas de una ejecución usan el helper de contraseña común y correos sintéticos únicos; no se expone la contraseña ni se guardan tokens.
- [ ] Generación de perfiles repetible con la misma semilla, sin colisiones entre ejecuciones; rechaza semilla vacía o inválida.
- [ ] Guardas impiden writes si falta el opt-in, el servidor no es loopback o `DATABASE_PATH` no es la SQLite temporal de la ejecución.
- [ ] Pruebas unitarias/integración cubren generación, repetición, aislamiento, miembros, fallo parcial y limpieza sin tocar datos/procesos preexistentes.
- [ ] La matriz real cubre las rutas de generación síncronas y los jobs AI activos (incluidos los flujos de compra/ticket, hogar, recetas, plan semanal y asistente); cada ruta queda mapeada a su perfil y presupuesto.
- [ ] Una respuesta fallida, inválida, timeout, cancelación o límite de presupuesto detiene el run y ejecuta cleanup; los snapshots verifican escrituras esperadas y ausencia de efectos laterales.
- [ ] La verificación UI usa Playwright contra app/servidor aislados; cubre un perfil solo y uno con hogar, escritorio y móvil, y guarda capturas sintéticas ignoradas por Git.
- [ ] El documento de resultados registra perfiles/flows probados, comandos, respuestas agregadas, coverage y limitaciones, sin credenciales ni contenido del proveedor.
- [ ] Se cumplen los gates CI/coverage vigentes; el Draft PR enlaza esta spec y sigue Draft hasta cerrar toda casilla con evidencia reproducible.

## Estado de verificación

Pendiente. La inspección inicial confirma que el servidor DevBar `HogarAI` está levantado con health `error`, y que el grupo `IA` no anuncia su servicio `dev` en ejecución. No se harán pruebas con esos servicios ni con su DB hasta verificar aislamiento/health y resolverlo dentro del harness temporal.
