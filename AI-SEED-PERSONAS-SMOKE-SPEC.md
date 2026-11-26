# Generador de perfiles sintéticos y smoke de IA

**Estado:** Draft; generador, matriz loopback, fallo parcial y UI de perfiles verificados; generación real WebAPI pendiente.
**Rama/PR:** `feat/calendar-recipe-cooking` / #72 Draft. Sin merge ni publicación de datos.

## Objetivo

Crear un generador reutilizable de cuentas de prueba para usuarios solos y hogares con varios miembros, y una matriz finita que ejercite las entradas de generación de IA con perfiles sintéticos. Todas las cuentas creadas por el generador comparten la contraseña de prueba centralizada en el helper E2E existente; el generador no la duplica ni la incluye en capturas o informes.

## Fuente vigente revisada

- `server/src/schemas/auth.schema.ts` y `server/src/routes/auth.routes.ts`: el alta acepta nivel de cocina; `PATCH /api/auth/taste` permite generar perfil culinario, objetivos, alergias, gustos, módulos y horarios.
- `server/src/schemas/household.schema.ts`: declara enums de roles, nivel, dieta, tolerancia al picante, ración y gravedad de alergia. Discrepancia verificada: `updateMemberSchema` no está conectado a una ruta; la API vigente de perfil es `PATCH /api/auth/taste`, con alergias como nombres simples y notas libres.
- `server/src/utils/taste-profile.ts`: niveles `none | beginner | intermediate | expert`, objetivos `balanced | weight-loss | weight-gain | muscle-gain | maintenance | variety | custom`, módulos `meals | pantry | shopping | receipts | home`.
- `server/src/utils/ai-client.ts` y `server/src/utils/ai-function-providers.ts`: jobs actuales `receipt | recipe | multiple_recipes | recommendations | weekly_plan | shopping_photo | expiry_estimate | household_plan | assistant | product_image_search | connection_test`; asignaciones de proveedor para recetas, planificación, despensa/compra y hogar.
- `server/src/routes/ai.routes.ts`, `ai-assistant.routes.ts`, `household-meal-proposals.routes.ts`, `household-plan.routes.ts`, `shopping.routes.ts` y `receipts.routes.ts`: rutas síncronas y trabajos de fondo que generan o interpretan contenido mediante IA.
- `AI-ACTION-ASSISTANT-WEBAPI-SMOKE-SPEC.md` y `tests/e2e/ai-real-smoke.spec.ts`: existe un smoke real aislado para asistente, planificación, recetas, flujos de compra/ticket y cola; no existe un generador común de perfiles.

## Decisiones y límites

- Cubrir los valores válidos del contrato con una matriz pareada, no el producto cartesiano de todas las opciones: dos cuentas solas (cada una en un hogar de un miembro, porque el API vigente exige seleccionar/crear hogar), pareja de 2 miembros y hogar numeroso; variedad de niveles, objetivos, módulos, alergias, dietas y permisos.
- Crear correos sintéticos bajo `hogaria.test`, con identificador único de ejecución. No incorporar datos de personas reales.
- Crear cuentas mediante el helper de registro E2E existente, que aplica una contraseña común de prueba sin duplicarla en el generador. Mantener JWT y token WebAPI solo en memoria; no guardar credenciales, prompts ni respuestas en fixtures, logs, capturas o reportes.
- Mantener los valores `dietType`, tolerancia, ración y severidad solo como contexto sintético dentro de `taste.notes`, porque el API activo no persiste esos campos tipados. Verificar su lectura de vuelta; no escribirlos directamente a SQLite ni presentarlos como propiedades estructuradas del perfil.
- El smoke no depende de una sesión real ni de Brave. Los JWT de las cuentas sintéticas y el token temporal de WebAPI viven solo en memoria. Reutilizar el harness que crea y elimina el token propio; no revocar tokens ajenos.
- Toda escritura del smoke debe pasar por una SQLite temporal cuya ruta efectiva `DATABASE_PATH` esté contenida en el directorio exclusivo de esa ejecución. El generador debe rechazar orígenes no loopback y bases no aisladas en modo de prueba. No usar la SQLite del servidor DevBar en ejecución.
- Los smokes reales son opt-in, secuenciales y con presupuesto máximo de llamadas explícito por flujo. Un error detiene la matriz; no hay reintentos ciegos ni bucles sin límite. Las suites repetibles simulan al proveedor.
- Las propuestas no se aplican salvo que un escenario exija comprobar un flujo de confirmación; ese escenario usa datos y DB desechables.
- El WebAPI normal de DevBar no es una base de prueba: sus sesiones operativas persisten el prompt completo y la respuesta en `session_events.content` (contrato de `docs/session-recording.md`). El smoke real debe usar DB WebAPI aislada además de la SQLite aislada de HogarIA. El 2026-11-26 se revalidó el servicio `IA` en `127.0.0.1:3001`: readiness/storage listos, pero `requestLogging.enabled`, `captureDetails` y `debugMode` siguen activos; el preflight no debe crear token ni enviar generaciones en ese estado.

## Checklist de aceptación

- [x] Matriz sintética cubre enums declarados de nivel/objetivo/módulo/rol/dieta/alergia; datos activos de perfil (`goals`, alergias, gustos, aversiones, notas, nivel, módulos) se leen de vuelta del API. Dieta/picante/ración/severidad permanecen solo en notas por la discrepancia de rutas documentada. Dos hogares de un miembro y hogares multi-miembro. Evidencia: pruebas unitarias y E2E (10 usuarios, 4 hogares; API read-back).
- [x] Alta y re-login reutilizan el helper de contraseña común; correos sintéticos únicos y sin contraseña/token en plan, reportes o capturas. Evidencia: helper E2E y test de unicidad.
- [x] Generación determinista por semilla, correos distintos entre ejecuciones; rechaza semilla vacía/inválida. Evidencia: test unitario.
- [x] Guardas de opt-in, loopback y ruta exacta de SQLite aislada. Evidencia: test unitario.
- [x] Pruebas unitarias/integración cubren generación, repetición, aislamiento, miembros, fallo parcial y limpieza sin tocar datos/procesos preexistentes. La inyección `after-first-account` confirma exactamente un registro antes de abortar; el runner cierra el proceso/puerto propio y elimina la SQLite temporal.
- [x] Los E2E con proveedor loopback cubren los 11 `AiJobKind` vigentes entre las rutas de recetas, planificación, compra/ticket, hogar y asistente; se ejecutan con cuentas del generador y DB temporal, sin red externa. Evidencia: dos pruebas Playwright pasaron en una ejecución aislada; perfiles solo y familia; salida `2 passed`, sin directorio temporal residual.
- [ ] La matriz real WebAPI cubre las rutas de generación síncronas y los jobs AI activos; cada ruta queda mapeada a su perfil y presupuesto explícito.
- [ ] Una respuesta fallida, inválida, timeout, cancelación o límite de presupuesto detiene el run y ejecuta cleanup; los snapshots verifican escrituras esperadas y ausencia de efectos laterales.
- [x] UI E2E sobre app/SQLite aisladas; perfil individual (hogar de 1) y familia de 6, escritorio y móvil. Capturas sintéticas locales ignoradas por Git: `.e2e-screenshots/ai-persona-seeds/{solo,family}-{desktop,mobile}.png`.
- [x] Documento de resultados registra matriz, comandos, resultados y limitaciones sin credenciales ni prompts/respuestas: `AI-SEED-PERSONAS-SMOKE-RESULTS.md`.
- [x] Gate de referencia: run [45878848795 (#1352)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45878848795), 11/11 jobs verdes en `3c5432e4`.
- [x] Corrección del fallo de foco del run #1354: CI [45890876833 (#1359)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45890876833) pasó 11/11 jobs en `764067a9`.
- [x] Estado/spec actualizado en `eab195fa`: CI [45893533271 (#1361)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45893533271) pasó 11/11 jobs; el PR #72 permanece Draft por las generaciones reales y la auditoría de errores del proveedor.
- [ ] Regresión de fallo parcial/i18n y timeout de test en `fb7e536a`: pre-push completo pasó; CI [45896836456 (#1362)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45896836456) está en cola.

## Estado de verificación

E2E aislado de perfiles pasó en Chromium y ahora comprueba que `profile.cooking.none` se traduzca; los proyectos móviles se omiten para no duplicar escrituras, pero se capturan PC/móvil. El fallo parcial inyectado tras el primer registro aborta y limpia el entorno temporal. La cobertura loopback de los 11 `AiJobKind` sigue pasando. No se ejecutaron generaciones reales: el almacenamiento operativo normal de WebAPI conserva prompts y respuestas. Hace falta un WebAPI de prueba con DB aislada y estado de proveedor autorizado. Ver `AI-SEED-PERSONAS-SMOKE-RESULTS.md`.
