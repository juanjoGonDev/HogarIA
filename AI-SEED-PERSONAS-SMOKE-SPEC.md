# Generador de perfiles sintéticos y smoke de IA

**Estado:** Draft; generador, matriz loopback, DB demo y bearer de WebAPI aislado verificados; la generación real sigue pendiente: DevBar normal no cumple privacidad y el WebAPI actual usa ChatGPT/Patchright, sin navegador disponible en la instancia aislada.
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
- El generador no depende de una sesión humana previa: crea los usuarios sintéticos y obtiene sus JWT en la ejecución aislada. La autenticación bearer de WebAPI solo autentica al cliente. La generación real actual sí usa el proveedor ChatGPT de WebAPI a través de Patchright y requiere un perfil de proveedor autenticado; no confundirlo con las cuentas HogarIA.
- Evidencia de código WebAPI (consulta read-only 2026-11-27): `src/api/opencode/controller.ts` enruta `/v1/chat/completions` al proveedor `chatgpt`; los módulos de proveedor detectados son ChatGPT/Patchright. El schema solo admite el canal `chrome`, aunque permite `browserExecutablePath` personalizado; la guía canónica documenta el build Chrome instalado. `agenta.apiKey` se usa en `src/shared/observability/agenta.ts` para observabilidad, no como credencial de inferencia.
- Los smokes E2E y reales conservan una SQLite temporal dentro del directorio exclusivo de ejecución. La única excepción son los comandos explícitos de demo, que usan solo .tmp/ai-persona-demo/hogaria.sqlite con HOGARIA_DEMO_MODE=1; pnpm dev y pnpm dev:server nunca la seleccionan ni la cargan. No usar la SQLite normal del servidor DevBar.
- Los smokes reales son opt-in, secuenciales y con presupuesto máximo de llamadas explícito por flujo. Un error detiene la matriz; no hay reintentos ciegos ni bucles sin límite. Las suites repetibles simulan al proveedor.
- Las propuestas no se aplican salvo que un escenario exija comprobar un flujo de confirmación; ese escenario usa datos y DB desechables.
- El WebAPI normal de DevBar no es una base de prueba: sus sesiones operativas persisten el prompt completo y la respuesta en `session_events.content` (contrato de `docs/session-recording.md`). El smoke real debe usar DB WebAPI aislada además de la SQLite aislada de HogarIA. El 2026-11-26 se revalidó el servicio `IA` en `127.0.0.1:3001`: readiness/storage listos, pero `requestLogging.enabled`, `captureDetails` y `debugMode` siguen activos; el preflight no debe crear token ni enviar generaciones en ese estado.
- El 2026-11-27, un WebAPI temporal de loopback con SQLite propia y logging/captura/sesiones desactivados aceptó un bearer token temporal; `GET /v1/models` devolvió HTTP 200 y tres modelos. El token se eliminó y verificó ausente; proceso y DB temporal se limpiaron. Esto valida autenticación del cliente a WebAPI, no generación IA ni autenticación del proveedor.
- En un intento aislado distinto, `POST /admin/api/chatgpt/session/check` devolvió HTTP 503 `browser_unavailable` (`browser_launch_failed`: el runtime Patchright no encontró la distribución Chrome configurada). No se envió prompt ni generación, no se abrió Chrome y no se usó ni alteró el perfil Brave existente. El WebAPI normal de DevBar quedó intacto.

## Modo demo persistente

- La DB demo es un artefacto local ignorado por Git en .tmp/ai-persona-demo/hogaria.sqlite; nunca es una copia ni una ruta alternativa de data/hogaria.sqlite, server/data/ o la DB del WebAPI.
- pnpm demo inicia la app con HOGARIA_DEMO_MODE=1 y DATABASE_PATH fijado a esa ruta exacta; los comandos normales (pnpm dev, pnpm dev:server) mantienen su DB habitual. El arranque normal no carga fixtures ni cambia de modo por detectar el archivo.
- pnpm demo:seed crea las personas y hogares mediante peticiones HTTP a la API local de HogarIA, solo cuando el launcher del comando inició la API con modo demo y DB dedicada; no escribe directamente en la DB ni usa la base normal.
- pnpm demo:db:reset restablece únicamente esa DB y sus sidecars SQLite; rechaza rutas distintas, la DB abierta/en uso y la DB normal o del WebAPI. No detiene procesos ajenos.
- pnpm demo:regenerate es el flujo reproducible: restablece la DB demo propia, vuelve a sembrar los perfiles y recorre la matriz de generaciones con peticiones HTTP reales al WebAPI local. No acepta sustitutos loopback simulados, proveedores externos ni fallback silencioso; el destino debe ser el WebAPI local aislado, no el WebAPI normal de DevBar. El run tiene presupuesto/timeout finitos, aborta ante error y conserva solo estado sintético validado.
- Antes de cualquier generación real, el preflight verifica origen loopback, identidad/readiness/autenticación del WebAPI y controles de privacidad; no cambia sus ajustes, toca su DB normal ni crea/borra credenciales ajenas. Si falta aislamiento o autorización, falla antes de transmitir prompts.
- Los unit/integration tests pueden simular proveedor, pero deben probar que los comandos demo rechazan simulaciones y que las generaciones demo llegan al WebAPI local real. Los artefactos de demo se quedan fuera de Git; no registrar secretos, prompts ni respuestas.

## Checklist de aceptación

- [x] Matriz sintética cubre enums declarados de nivel/objetivo/módulo/rol/dieta/alergia; datos activos de perfil (`goals`, alergias, gustos, aversiones, notas, nivel, módulos) se leen de vuelta del API. Dieta/picante/ración/severidad permanecen solo en notas por la discrepancia de rutas documentada. Dos hogares de un miembro y hogares multi-miembro. Evidencia: pruebas unitarias y E2E (10 usuarios, 4 hogares; API read-back).
- [x] Alta y re-login reutilizan el helper de contraseña común; correos sintéticos únicos y sin contraseña/token en plan, reportes o capturas. Evidencia: helper E2E y test de unicidad.
- [x] Generación determinista por semilla, correos distintos entre ejecuciones; rechaza semilla vacía/inválida. Evidencia: test unitario.
- [x] Guardas de opt-in, loopback y ruta exacta de SQLite aislada. Evidencia: test unitario.
- [x] Pruebas unitarias/integración cubren generación, repetición, aislamiento, miembros, fallo parcial y limpieza sin tocar datos/procesos preexistentes. La inyección `after-first-account` confirma exactamente un registro antes de abortar; el runner cierra el proceso/puerto propio y elimina la SQLite temporal.
- [x] Los E2E con proveedor loopback cubren los 11 `AiJobKind` vigentes entre las rutas de recetas, planificación, compra/ticket, hogar y asistente; se ejecutan con cuentas del generador y DB temporal, sin red externa. Evidencia: dos pruebas Playwright pasaron en una ejecución aislada; perfiles solo y familia; salida `2 passed`, sin directorio temporal residual.
- [x] La DB demo se resuelve a una ruta única ignorada por Git; pnpm dev nunca la adopta y solo los comandos demo fijan el modo/ruta dedicados. Evidencia: `app.config.ts` rechaza el modo/ruta cruzados; el launcher fija la ruta y `pnpm dev` conserva su script normal.
- [x] pnpm demo:seed solo crea datos sintéticos por API en modo demo; la repetición se comporta de forma idempotente y un error parcial deja un resultado recuperable. Evidencia: 10 usuarios/4 hogares leídos de SQLite, segunda llamada sin cambios y regresión de cleanup parcial.
- [x] pnpm demo:db:reset solo elimina/restablece el fichero DB demo y sidecars propios, y falla cerrada ante ruta alterada, proceso en uso o destino igual a DB normal/WebAPI. Evidencia: tests de ruta exacta, lock en uso y sidecars; comando real ejecutado sobre la DB demo.
- [ ] pnpm demo:regenerate hace reset + seed + matriz AI acotada; cada generación usa el WebAPI local real, sin loopback/provider fake ni fallback externo; readiness/auth/privacy inválidos fallan antes de enviar prompts; error, timeout o cancelación detienen el run y limpian solo procesos/credenciales propios.
- [ ] La matriz real WebAPI cubre las rutas de generación síncronas y los jobs AI activos; cada ruta queda mapeada a su perfil, DB demo y presupuesto explícito.
- [ ] Una respuesta fallida, inválida, timeout, cancelación o límite de presupuesto detiene el run y ejecuta cleanup; los snapshots verifican escrituras esperadas y ausencia de efectos laterales.
- [ ] Tests de contrato demuestran que los comandos demo fijan el DB path y modo correctos, hacen peticiones HTTP de generación al WebAPI local, y nunca persisten prompts/respuestas/credenciales en logs, fixtures o artefactos.
- [x] UI E2E sobre app/SQLite aisladas; perfil individual (hogar de 1) y familia de 6, escritorio y móvil. Capturas sintéticas locales ignoradas por Git: `.e2e-screenshots/ai-persona-seeds/{solo,family}-{desktop,mobile}.png`.
- [x] Documento de resultados registra matriz, comandos, resultados y limitaciones sin credenciales ni prompts/respuestas: `AI-SEED-PERSONAS-SMOKE-RESULTS.md`.
- [x] Gate de referencia: run [45878848795 (#1352)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45878848795), 11/11 jobs verdes en `3c5432e4`.
- [x] Corrección del fallo de foco del run #1354: CI [45890876833 (#1359)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45890876833) pasó 11/11 jobs en `764067a9`.
- [x] Estado/spec actualizado en `eab195fa`: CI [45893533271 (#1361)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45893533271) pasó 11/11 jobs; el PR #72 permanece Draft por las generaciones reales y la auditoría de errores del proveedor.
- [x] Regresión de fallo parcial/i18n y timeout de test en `fb7e536a`: pre-push completo pasó; el CI [45915858398 (#1369)](https://github.com/juanjoGonDev/HogarIA/actions/runs/45915858398) del HEAD `f2d71cce` pasó 11/11 jobs; el run #1362 anterior fue cancelado.

## Scripts de demo implementados

- pnpm demo: asegura la semilla y levanta frontend/API solo en loopback, en modo demo y con la DB persistente dedicada.
- pnpm demo:seed: carga solo la matriz sintética por API en esa app/DB.
- pnpm demo:db:reset: restablece solo la SQLite demo dedicada, sin iniciar ni parar otros procesos.
- pnpm demo:regenerate: flujo completo de reset, seed y smoke real contra WebAPI local; falla por preflight si identidad, autorización o privacidad no cumplen.

## Estado de verificación

E2E aislado de perfiles pasó en Chromium y ahora comprueba que `profile.cooking.none` se traduzca; los proyectos móviles se omiten para no duplicar escrituras, pero se capturan PC/móvil. El fallo parcial inyectado tras el primer registro aborta y limpia el entorno temporal. La cobertura loopback de los 11 `AiJobKind` sigue pasando. La DB demo persistente, `demo`, `demo:seed`, `demo:db:reset` y `demo:regenerate` están implementados; la semilla persistente y la app local se iniciaron y verificaron. El preflight read-only revalidado en `127.0.0.1:3001` encuentra request logging y captura de detalles activos, así que la generación real aborta sin crear token ni enviar prompt. No usar el WebAPI DevBar normal para escrituras; la matriz viva sigue pendiente hasta tener WebAPI aislado y autorizado. Ver `AI-SEED-PERSONAS-SMOKE-RESULTS.md`.
