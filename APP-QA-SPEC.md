# Spec: auditoría funcional y responsive de HogarIA

- **Estado (2026-10-10):** el barrido funcional global y la matriz visual/responsive siguen abiertos; PR #41 está Ready for review, abierto y sin merge. QA-RECIPES.AI-FLOW.1 ya tiene validación funcional local; QA-RECIPES.COOK-ACTION.1 se cerró localmente con E2E Chromium/Pixel 5, mientras la ruta general `/recipes` sigue abierta por otras acciones/filtros; el gate global frontend continúa verde. QA-REC.INGRESS.1 ya se reprodujo y corrigió con Nginx real aislado; QA-PANTRY.ITEM.ROUTE.1 cerró la ficha/edición, QA-PANTRY.ROOT-ROUTE.1 la vista general, QA-PANTRY.MANAGERS.ROUTES.1 categorías/productos y QA-PANTRY.CATALOG.ROUTE.1 el catálogo. `/ai-config` pasó su suite completa en Chromium/Pixel 5 (**52/52**) y concurrencia/proveedor **6/6**; la ruta `/shopping` ya pasó el barrido integrado en Chromium/Pixel 5, incluidas las subunidades de typeahead/pegado, traslado a despensa, selección múltiple y reapertura con estado conservado; las unidades de bandeja, filtro de tienda, sugerencias, renombrado, unidades recientes, descuento por primeras unidades y feedback 503 quedaron verificadas. En tickets, `QA-RECEIPTS.LINE-UNIT-OFFER.1` está cerrada y la ruta amplia `/receipts/:id` sigue abierta. La validación pendiente de Safari/iOS nativo corresponde a la hoja de ofertas de QA-04c.1: WebKit de Playwright en Windows ya pasó la interacción táctil, pero no proporciona safe-area nativa ni teclado software iOS. La suite frontend local pasa **1308/1308** con cobertura **93.08/84.43/92.08/94.40 % S/B/F/L**. QA-04c sigue abierto por otros déficits. El workflow CI comprueba el cableado Karma, pero no ejecuta esa suite, por lo que se conserva la verificación local. El arreglo E2E de screenshots se publicó en `dcb2b26` (CI `38001425709` verde); la evidencia actualizada en `4cfa900` también pasó CI (`38002513901`). Siguen abiertas la auditoría de safe-area nativa no nula, la matriz visual completa y QA-AI.REAL-INTEGRATIONS.1. La recuperación por correo no está implementada: su UI comunica esa limitación sin prometer envío.
- **IA / tickets reales (evidencia previa 2026-10-09; supersedida por la nota vigente):** `GET /health/ready` responde 200 (`ready=true`, `storage=ready`). El checkout comprobado de `D:\projects\webApi` está limpio en `7c1e52e9` e incluye la corrección `e679f44d`; PID 43088 arrancó después de ese commit, aunque WebAPI no publica el SHA realmente cargado por el proceso. La lectura de `GET /admin/api/logs?lines=2000` devolvió 681 líneas: 27 `attachment_upload_failed` (último 2026-10-09 03:16:09; dos adjuntos, HTTP 504 tras timeout de 45 s, cleanup `page_closed` satisfactorio) y cero `prompt_submitted`, `response_completed` o `cleanup_failed`. La prueba sintética de WebAPI pasó 18/18, pero no comprueba entrega real al proveedor. El último upload live posterior al fix sigue fallando; no se reenvían tickets y la validación real continúa bloqueada antes de cualquier respuesta del modelo.
- **IA / tickets reales (2026-10-10, verificación vigente 11:22–11:35 CEST):** en el único reintento autorizado del grupo largo, el runner aislado envió las tres fotos acordadas como ticket temporal junto con `inventario.json`, sin abrir los PDF ni la JPEG preferida y sin persistir en el inventario real. Los logs seguros de WebAPI prueban dos ficheros recibidos, listos, visibles y enviados al modelo (`inlineContextCount=0`, `sentToModelAttachmentCount=2`). La respuesta falló: streaming HTTP 400 y un único fallback HTTP 502; no hubo JSON validable y el grupo no se reenvía porque la petición pudo completarse. Por separado, una E2E live sintética con ticket+inventario y `response_format` JSON Schema estricto pasó 1/1 y devolvió ambos marcadores exactos, probando entrega/lectura del par, no extracción real ni deduplicación. Token/temporales propios limpiados; los tres tokens smoke anteriores activos se preservan por decisión del usuario. Detalle y limitaciones: `QA-AI.REAL-INTEGRATIONS.ATTACHMENT-PAIR.1`.
- **WebAPI post-merge (2026-10-10):** PR #163/#164 merged; `master` local y `origin/master` coinciden en `f47f4b8`, y el listener está ready. La pareja de adjuntos sintéticos pasa con respuesta estricta validada; la extracción real de tickets y la deduplicación multipágina siguen pendientes. No se repiten tickets previos sin nueva autorización porque pudieron completarse.
- **Verificación focal:** QA-LOGS.SSE-RECONNECT.1 cubre la recuperación real del stream en Chromium escritorio y Pixel 5; QA-04c.ERROR-INTERCEPTOR.1 cubre todos los resultados del interceptor. La suite frontend local más reciente pasó 1308/1308 con cobertura 93.08/84.43/92.08/94.40 % S/B/F/L; `receipt-detail.component.ts` llega a 100/89.16/100/100. CI comprueba el cableado Karma y los E2E, pero no ejecuta esa suite completa. La casilla general `/logs` sigue abierta por el resto de acciones y brechas de contrato.
- **Actualizado:** 2026-10-10
- **IA / tickets reales (2026-10-09, histórico; supersedido):** se preservó el proceso WebAPI entonces activo y, tras autorización, se completó una sola vez el smoke del grupo largo. El contrato incluía JSON Schema estricto y dos adjuntos, pero la telemetría anterior no permitía distinguir un `fileCount=1` por operación de un lote incompleto. Ese grupo no se repite y la limitación de inventario quedó pendiente.
- **IA / tickets reales (2026-10-10, evidencia histórica; supersedida):** tras el reinicio anunciado por el usuario, el listener WebAPI `127.0.0.1:3001` quedó listo en PID 56924, iniciado a las 00:54:11 CEST, con el checkout `D:\projects\webApi` en `a1c64d4e`. El smoke autorizado de la JPEG preferida (ordinal 4) terminó una vez en almacenamiento temporal: 2 peticiones de contrato estricto, 1 completion HTTP 200 tras un fallback HTTP 400, respuesta JSON válida y revisión/edición/historial E2E. Los logs de las 00:56:07–00:56:29 prueban `receivedFileCount=2`, `normalizedAttachmentCount=2` e `includedInProviderRequestAttachmentCount=2` en la entrada/preparación y dos previews; pero `Attachments are ready` registra `readyAttachmentCount=1` y `Prompt submitted`, `sentToModelAttachmentCount=1`. El código WebAPI confirma por qué: `writeAttachmentBuffer` antepone UUID al nombre, el detector de `buildOpenCodeMessageAttachments` solo fuerza `inventario.json` sin prefijo o con prefijo numérico, y `prepareOpenCodeAttachments` inlinea los JSON pequeños. Así, la evidencia indica que el inventario se incluyó como texto y no como segundo archivo; no inspeccionamos el prompt ni podemos validar que las categorías respetaran ese contenido. No se repite la JPEG ni el grupo largo ya procesado, no se escribe en el inventario real y la validación real de IA sigue abierta.
- **Revalidación WebAPI (2026-10-10, smoke sintético previo; supersedido):** `/health/ready` devuelve HTTP 200 (`ready=true`, `storage=ready`); el listener sigue en PID 56924, iniciado a las 00:54:11 CEST, y no publica el SHA cargado. El checkout inspeccionable `D:\projects\webApi` está en `feat/session-attachment-previews` / `a1c64d4e`; PR #163 (`b55f958`) contiene un helper que elimina prefijos numéricos y UUID de `inventario.json`, mientras el helper del checkout solo admite el prefijo numérico. Tras verificar privacidad con el opt-in de logging local acotado, se hizo **una única** llamada a `/v1/chat/completions` con un PDF y `inventario.json` completamente sintéticos, `response_format` JSON Schema estricto y sin streaming. Respondió HTTP 200; el resultado cumplió el esquema y la categoría sintética esperada; el token temporal propio se limpió. Los logs agregados de 10:53:31 muestran 2 recibidos, normalizados e incluidos; a las 10:53:50 solo 1 listo y a las 10:53:51 solo 1 enviado (`statusCode=200`). La respuesta pudo completarse y no se repite; no se tocaron tickets, base de datos ni inventario real. La entrega de ambos como archivos independientes sigue sin acreditarse.

**Contrato de producto:** [`HOGARIA-SPEC.md`](./HOGARIA-SPEC.md)

Esta spec convierte la petición de revisar toda la app en una lista verificable. No presupone que las pantallas funcionan porque exista un test: cada casilla se marca después de probar el comportamiento en el navegador y guardar evidencia reproducible.

## Alcance y fuente de verdad

- Se revisan las rutas y pantallas que existen hoy, sus formularios, botones, estados vacíos/de error, navegación, persistencia y diseño responsive.
- Para lo que existe hoy mandan `frontend/src/app/app.routes.ts`, las rutas/componentes de cada feature y el comportamiento observado. `HOGARIA-SPEC.md` define las decisiones de producto activas; documentos históricos no sustituyen al código actual.
- No se añaden funcionalidades nuevas solo porque aparezcan en una spec antigua. Si código, texto de interfaz y contrato activo discrepan, primero se anota y decide la conducta esperada.
- Cada casilla cerrada debe enlazar a un test o anotar comando, navegador, datos y resultado. Una lista de tests enumerada no equivale a una lista ejecutada.

## Unidad QA-UI.1 · panel de cola de tickets y glifos de Hogar (resuelta)

**Fuente revalidada antes de implementar:** `ReceiptQueueComponent` se monta en la cabecera móvil y dentro de `.sidebar__header` en escritorio. Su `.rq__panel` es `position:absolute; right:0`, de modo que el panel de 380 px se ancla hacia dentro del lateral de 280 px y el contenido se recorta; `tests/e2e/receipts.spec.ts` solo afirma visibilidad/contenido, no límites geométricos. `HOGARIA-SPEC.md` §7 y `scripts/check-ui.mjs` regla `sin-emoji` respaldan usar el sistema SVG ya existente (`IconComponent`); el diccionario/pantalla de Hogar y los slots decorativos de Dashboard aún usan emojis. Se conservan explícitamente los emojis de contenido de alergias, gustos y catálogo de ingredientes que el usuario indicó que prefiere. Esta unidad cubre la cola y la iconografía decorativa de Hogar y Dashboard, no da por migrada la deuda de emoji de las demás pantallas.

- [x] Añadir primero una regresión Playwright que abra la cola vacía y mida el panel real en Chromium escritorio y Pixel 5; reproducir que el panel queda recortado/pegado al lateral antes del arreglo.
- [x] Posicionar el panel de la cola junto al disparador sin clipping del lateral ni del viewport; verificar límites, scroll si la lista crece y cierre con Escape en escritorio y móvil.
- [x] Añadir primero la regresión Playwright visual de Hogar: el baseline debe mostrar el `app-icon` ausente en el estado vacío y el emoji dentro del nombre accesible de «Copiar enlace».
- [x] Añadir primero la regresión Playwright de Dashboard: el baseline renderiza cero `app-icon` en los cuatro resúmenes, las tres acciones y los estados vacíos.
- [x] Retirar los emojis de presentación de Hogar (título, estado sin hogar, compartir, copiar, regenerar, salir) y los emojis de los resúmenes, CTA y vacíos decorativos de Dashboard; usar `app-icon` SVG existente, mantener textos ES/EN limpios y preservar la felicitación textual sin iconografía añadida.
- [x] Verificar con E2E que las acciones de invitación siguen siendo accesibles/funcionales y que las etiquetas no incorporan emoji; preservar intactos los emojis semánticos de alergias, gustos e ingredientes.
- [x] En móvil, mantener el enlace de invitación y sus acciones de copiar/regenerar dentro de la tarjeta a 393 y 320 px, sin clipping ni overflow horizontal.
- [x] Guardar e inspeccionar capturas sintéticas de PC y móvil; ejecutar pruebas focales, typecheck, `check-ui` y build con evidencia reproducible, sin rebajar gates.

**Evidencia visual inicial:** la captura facilitada por el usuario muestra el panel de cola recortado dentro del lateral y pictogramas de familia/copia en Hogar; la reproducción de Playwright se registra a continuación.

**TDD rojo (2026-09-30, sin cambios de producción):** `receipt-queue-panel-layout.spec.ts` con el runner aislado `%TEMP%\hogaria-e2e-runner-audit.mjs`, `E2E_SCOPE=all`, `E2E_RATE_LIMIT=on`, DB/puerto/semilla únicos; el runner detuvo el servidor y conservó los artefactos de los casos rojos. Chromium escritorio falla el límite izquierdo (panel `x=-117`, viewport 1280); Pixel 5 falla igual (`x=-71`, viewport 393). En la primera iteración móvil el locator `:visible` resolvió también el disparador de la sidebar trasladada fuera de pantalla; el test se corrigió para elegir `.header`/`.sidebar` por breakpoint y luego reprodujo el defecto geométrico real.

`household-icon-consistency.spec.ts` reprodujo rojo en Chromium con `E2E_SCOPE=all`, `E2E_PROJECT=chromium`, rate limit activo y el mismo runner aislado: **3 fallos esperados**. El estado vacío no contiene `app-icon`; la vista de hogar muestra «👨‍👩‍👧‍👦 Hogar» y falla al buscar «Copiar enlace» exactamente (el emoji del diccionario integra el nombre accesible). Dashboard devuelve cero `app-icon` donde el test espera 4 resúmenes, 3 acciones, el icono de miembros y los vacíos. Cada ejecución usa su propia DB temporal y el runner conserva screenshots/logs de fallo.

**Regresión móvil adicional (TDD rojo → verde, 2026-09-30):** la captura sintética de hogar a 393 px mostró el URL de invitación sobrepasando la tarjeta y las acciones fuera de pantalla. El test geométrico real de Pixel 5 midió el borde del enlace en x=488 px mientras la tarjeta terminaba en x=377 px; el check del documento no lo detectaba porque la vista limita el ancho exterior. Tras registrar el rojo, la tarjeta refluye en móvil y el enlace/acciones quedan dentro a 393×851 y 320×568; ambos tamaños pasan la aserción de geometría.

**Evidencia verde QA-UI.1 (2026-09-30):** `computeReceiptQueuePanelPosition` + `IconComponent` en Karma: 11/11; coverage focal Statements 100 %, Branches 80 %, Functions 100 %, Lines 100 % (gate existente del 80 % intacto). `tsc -p tsconfig.e2e.json --noEmit` pasa usando el compilador local y `npm run build:prod` compila. Playwright aislado con rate limit activo, SQLite/puerto/semilla temporales: `receipt-queue-panel-layout.spec.ts` + `household-icon-consistency.spec.ts`, Chromium 5/5 y Pixel 5 5/5; `household.spec.ts` + `receipts.spec.ts`, Chromium 7/7 y Pixel 5 7/7. La cola se mide fuera del lateral, sobrevive a resize/rotación 568×320, permite scroll real con diez tickets sintéticos en 320×568 y cierra con Escape. Copiar verifica el clipboard real y Regenerar cambia el enlace; el texto de accesibilidad no incluye glifos. Capturas inspeccionadas en `.e2e-screenshots/qa-ui-1-desktop/` y `.e2e-screenshots/qa-ui-1-mobile/` (incluye 320×568 y 568×320).

`node scripts/check-ui.mjs` en el checkout Windows terminó inicialmente con 13 incidencias `texto-en-un-catalogo` en `frontend/src/app/core/i18n/labels.ts:345-358`; la revalidación de QA-05 determinó que son falsos positivos de exclusión por separadores de ruta, no traducciones ausentes. QA-05.PATH.1 corrigió este falso positivo con regresión. El checker no reporta emoji en los ficheros Hogar/Dashboard migrados. El ESLint directo no tiene configuración en la raíz y `ng lint` está bloqueado porque falta `@angular-eslint/builder:lint`; no se alteró configuración ni dependencias para ocultarlo. `git diff --check` pasa. Build de producción aprobado con los warnings existentes de budgets e imports opcionales/no usados; no se modificaron gates.

**Revalidación de los dos hallazgos de las capturas (2026-09-30):** las imágenes aportadas muestran el estado anterior a `4a751bb`. Sobre el build de producción actual, Playwright aislado volvió a verificar cola de tickets + iconografía de Hogar/Dashboard: Chromium 5/5 y Pixel 5 5/5, con DB/puerto/semilla temporales, rate limit activo y cleanup. Hogar mantiene nombre limpio, iconos SVG, copiar/regenerar funcionales y emojis semánticos de Preferencias intactos; el panel de tickets queda visible fuera del lateral y dentro del viewport. Capturas PC/móvil inspeccionadas: `.e2e-screenshots/qa-ui-confirm/current-desktop/receipt-queue-panel.png`, `.e2e-screenshots/qa-ui-confirm/current-mobile/receipt-queue-panel-320x568.png`, `.e2e-screenshots/qa-ui-confirm/current-desktop/household-members.png` y `.e2e-screenshots/qa-ui-confirm/current-mobile/household-members-es-320x568.png`. La búsqueda del código actual encontró otros pictogramas decorativos fuera de esta unidad; se inventarían por separado en QA-UI.3.

**Revalidación final de las capturas del usuario (2026-09-30, build actual):** después de QA-UI.3c y el build production se repitieron `receipt-queue-panel-layout.spec.ts` + `household-icon-consistency.spec.ts` con DB/puerto/semilla temporales y rate limit activo. Chromium **5/5** y Pixel 5 **5/5**; panel fuera del lateral y viewport, estado vacío, hogar, acciones de copiar/regenerar y etiquetas limpias pasan. El runner limpió ambos entornos. Capturas sintéticas actuales e inspeccionadas: `.e2e-screenshots/qa-ui-confirm/current-final-desktop/` y `current-final-mobile/`. No se abrió ni escribió en la sesión autenticada de `localhost:4200`.

## Unidad QA-UI.1b · panel de tickets separado del lateral (reabierta y revalidada)

**Motivo de reapertura:** el usuario ha vuelto a señalar que el panel del icono de tickets se ve «metido en el lateral». La captura adjunta refleja el recorte del estado previo a `4a751bb`; no se tratará como evidencia del build actual. La revalidación del código sí encontró un defecto geométrico más pequeño que sobrevivió a QA-UI.1: `computeReceiptQueuePanelPosition()` posiciona el borde izquierdo con `anchor.left`, y `receipt-queue-panel-layout.spec.ts` solo exige que el borde derecho exceda el lateral. En escritorio el disparador está aproximadamente en `x=224`, el panel tiene 380 px y el lateral 280 px: el panel aún invade 56 px del lateral aunque ya no se recorte.

**Conducta esperada:** al abrir desde el lateral de escritorio, el panel queda completamente fuera de este con un pequeño espacio visual, sin perder límites de viewport. En móvil, el disparador de la cabecera mantiene el panel íntegro dentro del viewport; revisar además la instancia del menú móvil, dado que `.sidebar` se transforma y puede cambiar el bloque contenedor de `position: fixed`. Si esa instancia duplica una acción ya disponible en la cabecera o no puede funcionar sin solapamiento, resolverlo de acuerdo con la fuente de verdad actual antes de implementar.

- [x] Añadir primero una regresión geométrica que exija `panel.left >= sidebar.right + gap` al usar el disparador lateral a 1024 y 1440 px; reproducir el solapamiento actual en Playwright real, sin `force`.
- [x] Probar el disparador visible de cabecera en 393×851, 320×568 y 568×320; comprobar posición, cierre con Escape y scroll real sin salir del viewport. Abrir también el menú móvil y medir qué instancia de cola es alcanzable, sus límites y su bloque de posicionamiento.
- [x] Corregir la colocación mínima para que el panel no se solape con el lateral en escritorio; resolver explícitamente la instancia del menú móvil sin ocultar o duplicar una acción necesaria.
- [x] Añadir/ajustar pruebas unitarias de los límites y casos de viewport estrecho; coverage focal ≥70 % en statements, branches, functions y lines. Ejecutar Playwright real en Chromium escritorio y Pixel 5 sobre fixture aislada.
- [x] Guardar e inspeccionar capturas sintéticas PC y móvil; registrar build/typecheck y errores de consola. No usar escritura contra el servidor/base normal de `localhost:4200`.

**TDD rojo (2026-09-30):** se fortaleció `receipt-queue-panel-layout.spec.ts` y la prueba aislada real de Chromium falló contra la posición actual: en 1440 px el panel comenzaba en `x=219`, el lateral terminaba en `x=280` (solapamiento de 61 px). La E2E anterior pasaba porque solo exigía que el borde derecho del panel sobrepasara el lateral. Karma también reprodujo el límite ausente: el helper devolvía `left=224` donde se requiere `left>=288`.

**Corrección y evidencia verde:** el helper recibe el borde derecho del lateral y coloca el panel `8px` después cuando hay ancho suficiente; en viewports estrechos vuelve a priorizar caber íntegro en pantalla. No se cambia la colocación del icono de cabecera. La instancia accesible desde el cajón móvil también se abrió y midió; a 320 px el panel queda dentro de viewport y se cierra con Escape, solapando el cajón como overlay porque no existe espacio horizontal para abrirlo a su derecha.

`receipt-queue-position.spec.ts`: Karma **6/6**, coverage focal del helper **100/100/100/100 %** (statements/branches/functions/lines). `tsc -p tsconfig.e2e.json --noEmit`, `git diff --check`, Prettier focal y build Angular production pasan; el build mantiene warnings preexistentes de presupuesto/imports sin usar. Playwright real con `E2E_SCOPE=all`, rate limit activo, runner efímero y `DATABASE_PATH` verificado bajo `%TEMP%`: `receipt-queue-panel-layout.spec.ts`, Chromium escritorio **2/2** y Pixel 5 **2/2**. Desktop comprueba 1024/1440 px; Pixel 5 comprueba 393×851, 320×568, 568×320, 10 tickets sintéticos con scroll y el cajón móvil. E2E vigila page errors, consola del origen de la app y fallos de red propios: **0**; el entorno puede bloquear Google Fonts de terceros (limitación ya anotada en baseline). El preflight común todavía sondea `/main.js`, `/polyfills.js`, `/styles.css` y recibe 404; el bundle hashed de la app carga y las pruebas pasan. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-ui-1b/final-desktop/receipt-queue-panel.png`, `.e2e-screenshots/qa-ui-1b/final-mobile/receipt-queue-panel-320x568.png` y `receipt-queue-panel-drawer.png`. No se usó `localhost:4200` con autenticación o escrituras. Rollback: revertir la unidad atómica que contiene el helper/consumidor, sus pruebas y esta sección de spec.

**Revalidación tras el reporte visual (2026-10-01):** la reproducción contra el source actual no vuelve a quedar dentro del lateral. Con `scripts/run-isolated-playwright.mjs`, `E2E_RATE_LIMIT=on`, `E2E_CHROME_BIN` apuntando al Chrome local y SQLite/puertos/semilla temporales, `receipt-queue-panel-layout.spec.ts` + `household-icon-consistency.spec.ts` pasan **5/5 Chromium** y **5/5 Pixel 5**. Se comprueba el panel íntegro fuera del lateral en escritorio, límites/overlay/cierre con Escape a 393×851, 320×568 y 568×320, scroll con 10 tickets, y los iconos SVG/textos de Hogar, copiar, regenerar y compartir; clipboard/regeneración usan únicamente el hogar sintético. Capturas actuales inspeccionadas: `.e2e-screenshots/qa-ui-current-recheck/chromium/receipt-queue-panel.png`, `.e2e-screenshots/qa-ui-current-recheck/mobile-chrome/receipt-queue-panel-320x568.png` y `household-members-es-393x851.png`. La caché del Chromium empaquetado por Playwright no está instalada en este equipo; usar el Chrome ya instalado permitió completar la prueba real. No se accedió ni escribió en la base normal de `localhost:4200`.

**Revalidación de la nueva captura (2026-10-01):** repetí ambas specs contra source actual en el runner aislado, con SQLite/puertos/semillas temporales y rate limit activo: **5/5 Chromium y 5/5 Pixel 5**. La cola medida comienza fuera del lateral de 280 px y permanece dentro del viewport; el título de Hogar y los nombres accesibles de «Copiar enlace», «Copiar» y «Compartir en el hogar» coinciden exactamente con texto limpio, con `app-icon` SVG separado. Se inspeccionaron capturas sintéticas nuevas en `.e2e-screenshots/qa-ui-report-recheck/chromium/` y `mobile-chrome/`. `localhost:4200` rechazó la conexión en esta sesión; por ello queda sin verificar qué bundle estaba mostrando el navegador de la captura aportada. No se cambió código de producción: en la rama/source actual el defecto reportado no se reproduce.

**Regresión de Escape en WebKit (2026-10-10):** el panel se cierra desde `document:keydown.escape` incluso si el menú lateral ya marcó el mismo Escape como atendido; solo restaura foco cuando la cola era dueña de la tecla. Dos pruebas Karma cubren cierre/foco y cierre anidado sin robar foco. El primer E2E Safari completó las aserciones de comportamiento, pero el monitor genérico confundió lecturas GET canceladas (`Load request cancelled`) con errores; ahora solo ignora esos códigos de cancelación en GET y sigue fallando ante errores de consola/JS, otras solicitudes fallidas y peticiones no GET. Resultado: Karma focal **11/11**; `pnpm run test:client:coverage` **1289/1289**, cobertura **92.22/83.57/90.98/93.64 % S/B/F/L**; Playwright aislado `receipt-queue-panel-layout.spec.ts`, mobile-safari **2/2**, Chromium + Pixel 5 **4/4**. Los runners verificaron limpieza de DB y artefactos temporales; no se escribió en el backend normal. La geometría visual no cambió; se conservan las capturas PC/móvil inspeccionadas arriba.

## Unidad QA-UI.2 · geometría de tarjeta de miembro en móvil (resuelta)

**Aclaración de entorno en la revalidación posterior:** la nota anterior registró que `localhost:4200` rechazó una conexión; al continuar la sesión, el GET respondió y Playwright llegó a `/auth/login`. No se autenticó ni se escribió en ese servidor/base normales. Las pruebas de comportamientos autenticados y de escritura citadas en este spec se hicieron solo en el stack aislado con datos sintéticos.

**Fuente revalidada antes de esta unidad:** `HouseholdComponent` dibuja `.member-card` como fila flex y `.member-card__meta` como otra fila sin reflujo específico móvil. La captura sintética `household-members.png` de QA-UI.1 parece mostrar las insignias de rol/nivel cerca o más allá del borde derecho de la tarjeta; la imagen por sí sola no confirma un defecto. Medir geometría con el navegador antes de cambiar estilos.

- [x] Escribir primero una regresión Playwright que mida los límites reales de `.member-card`, nombre/email y `.member-card__meta` en Pixel 5 a 393×851 y 320×568; registrar el baseline y confirmar si existe desbordamiento horizontal/clipping.
- [x] Usar datos sintéticos de nombre/email y etiquetas largas en español e inglés; exigir que las insignias permanezcan dentro de la tarjeta y que no haya overflow horizontal del documento.
- [x] Solo si el rojo reproduce el problema, aplicar el reflujo mínimo con TDD; mantener legibles los datos, estados accesibles y áreas táctiles.
- [x] Verificar la regresión en Chromium escritorio y Pixel 5, capturar/inspeccionar PC y móvil y registrar comandos/resultados sin tocar servidor ni base normales.

**TDD rojo (2026-09-30, sin cambios de producción):** runner aislado `E2E_SCOPE=all`, `E2E_PROJECT=mobile-chrome`, `E2E_FILES=household-icon-consistency.spec.ts`, `E2E_RATE_LIMIT=on`: Pixel 5 pasa a 393×851 y falla a 320×568. Con el fixture inicial, `.member-card__meta` llegó a x=371 px mientras `.member-card` terminaba en x=304 px; endurecí después el escenario con un nombre sintético largo y el borde de las insignias aún llegó a x=360 px (56 px fuera). El documento no se ensancha, por lo que el desborde local quedaba oculto/clipeado. En la ejecución reforzada, el resto del test de esta pantalla y Dashboard pasa (2 passed, 1 failed); cada corrida usa servidor, SQLite y semilla temporales únicas.

**Evidencia verde QA-UI.2 (2026-09-30):** `HouseholdComponent` refluye la fila de miembro a una rejilla de dos columnas en móvil; la columna de texto tiene ancho mínimo cero y nombre/correo pueden partirse, mientras las insignias ocupan una segunda fila. La regresión mide documento, columna, correo y tarjeta a 393×851 y 320×568 con nombre sintético largo en español e inglés. Tras `npm run build:prod` (el runner aislado sirve el bundle estático existente y no recompila Angular), `tsc -p tsconfig.e2e.json --noEmit` pasa; Playwright aislado con `E2E_RATE_LIMIT=on`, SQLite/puerto/semilla temporales: `household-icon-consistency.spec.ts`, Pixel 5 **3/3** y Chromium escritorio **3/3**. Capturas inspeccionadas: `.e2e-screenshots/qa-ui-2-desktop/household-members.png` y `.e2e-screenshots/qa-ui-2-mobile/household-members-{es,en}-{320x568,393x851}.png`. No se usaron el server ni la base de datos normales.

## Unidad QA-UI.3 · coherencia de iconos fuera del contenido semántico (resuelta)

**Fuente revalidada antes de implementar:** el sistema SVG local es `IconComponent` + `IconName`, declarado por `frontend/src/app/shared/components/ui/icon/icon-paths.ts`. El generador es `frontend/scripts/icons.mjs` (no `scripts/icons.mjs`) y espera `frontend/node_modules/@material-icons/svg/svg`; esa fuente no está instalada en este entorno, así que no regenerar ni añadir dependencias sin encontrar una fuente local verificable. Preferir nombres SVG ya registrados; si no hay equivalente adecuado, quitar el ornamento y dejar texto limpio antes que inventar un icono.

El barrido actual encontró pictogramas decorativos en controles compartidos, Auth/Onboarding/Invitación, Configuración IA, Configuración, Recetas e Inventario. Clasificación explícita: se preservan los emojis de contenido de `COMMON_ALLERGENS`, `COMMON_LIKES` y `COMMON_DISLIKES` en `shared/models/taste-profile.ts`, que el usuario aprobó para alergias/gustos, y los emojis de las categorías alimentarias `ingredientCategoriesNoAll` de `features/pantry/pantry.component.ts` (verduras, fruta, carne, pescado, lácteos, etc.), que el usuario indicó que le gustan en Ingredientes; se verificará que sigan visibles en filtros/filas. También se preservan los marcadores 👍/👎 con semántica de las elecciones «Me gusta/Mejor no» del onboarding; se migran los iconos de objetivos que comparten ese archivo. El 📋 de «Todas las categorías» no identifica comida: puede pasar a SVG/texto limpio. Se limpia el 👍 decorativo de copy de invitación. No cambiar emojis escritos por usuarios ni texto dinámico de recetas/consejos/advertencias: solo sustituir prefijos decorativos controlados por la plantilla.

**Decisión de diseño:** una acción, navegación, categoría, estado, métrica, título o estado vacío usa `app-icon` decorativo y texto accesible independiente; si falta icono local, se conserva el significado mediante texto, no emoji. Los nombres accesibles no deben incluir glifos ornamentales.

### QA-UI.3a · controles compartidos

- [x] Añadir primero unit tests para chip-select, toggle de contraseña, toast y `DifficultyPipe`: emoji de catálogo de Preferencias sigue visible pero se marca decorativo; opción personalizada usa SVG; mostrar/ocultar contraseña funciona en ciclos repetidos por click y teclado con nombre ES/EN, icono que refleja la acción, no revela controles deshabilitados y vuelve a ocultar si se deshabilita cuando ya estaba visible; cada tipo de toast anuncia su texto mediante una región viva y usa icono SVG distinguible; la pipe no añade emoji.
- [x] Corregir el botón de contraseña que desaparece tras mostrarla; usar los `IconName` disponibles y labels localizados, conservar el contrato externo del input y deshabilitar/resetear el toggle y su campo cuando se deshabilite. Dar a success/error/warning/info semántica viva adecuada, conservar cierre accesible y diferenciar error de warning con un símbolo inequívoco del registro local, sin añadir dependencia ni emoji.
- [x] Validar cobertura focal ≥70 % en statements/branches/functions/lines, typecheck y build; Playwright de Auth en Chromium y Pixel 5 confirma visibilidad repetible/teclado, estado visual correcto y nombres limpios.

**Hallazgos de revisión y resolución:** `disabled` podía cambiar de `false` a `true` después de revelar la contraseña y ahora resetea la visibilidad tanto por `@Input` como por ControlValueAccessor; `notifications` era una campana genérica y se sustituyó por el `sync_problem` local, que representa un problema con exclamación. La segunda revisión read-only confirmó ambos arreglos y no encontró nuevos P1/P2/P3.

**Evidencia QA-UI.3a (2026-09-30):** TDD rojo inicial: Karma focal 56 tests, 52 pasan y 4 regresiones fallan. La revisión detectó después el caso visible→disabled y que una campana no denota precaución; su follow-up rojo fue 45 tests, 43 pasan y 2 regresiones fallan. Verde: `node ./node_modules/@angular/cli/bin/ng.js test --no-watch --browsers=ChromeHeadlessNoSandbox --include=src/app/shared/components/ui/input/input.component.spec.ts --include=src/app/shared/components/ui/chip-select/chip-select.component.spec.ts --include=src/app/shared/components/ui/toast/toast.component.spec.ts --include=src/app/shared/pipes/difficulty.pipe.spec.ts --code-coverage` pasa **56/56**. Cobertura focal S/B/F/L: `input.component.ts` 98.38/100/88.23/98.18 %, `chip-select.component.ts` 97.77/92.85/100/100 %, `toast.component.ts` y `difficulty.pipe.ts` 100/100/100/100 %. `tsc -p tsconfig.e2e.json --noEmit` y build de producción pasan; build conserva avisos preexistentes de budgets/imports no usados. `node scripts/check-ui.mjs` devuelve 13 incidencias conocidas únicamente en `core/i18n/labels.ts:345-358`; no señala los ficheros migrados. Playwright real con `$env:E2E_SCOPE='all'`, `$env:E2E_RATE_LIMIT='on'`, `$env:E2E_FILES='tests/e2e/password-visibility.spec.ts'`, `$env:E2E_PROJECT={chromium|mobile-chrome}` y runner `%TEMP%\hogaria-e2e-runner-audit.mjs` usa server/puerto/semilla/SQLite temporales y no envía el formulario: Chromium **1/1**, Pixel 5 **1/1**. Verifica 320×568, 393×851, 568×320 y 1440×900, teclado Enter/Space, ciclos de visibilidad, ocultamiento al deshabilitar, nombre ES/EN, icono/diagonal CSS visible, target ≥44 px, bounds y errores de primera parte. El preflight común sondea `/main.js`, `/polyfills.js`, `/styles.css` y devuelve 404; el bundle hashed carga y el E2E pasa. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-ui-3a/password-toggle-desktop.png` y `password-toggle-mobile.png` (ignoradas por Git; formulario sin datos personales). Rollback: revertir el commit atómico de QA-UI.3a elimina la migración de controles compartidos, sus tests, traducciones localizadas, limpieza de allowlist y evidencia asociada sin tocar unidades ajenas.

### QA-UI.3b · Auth, onboarding e invitación

- [x] Añadir regresiones antes de cambiar logo/objetivos; SVG casa decorativo sin contaminar títulos, retirar 👍 de copy de invitación y usar SVG para iconos de objetivo, sin cambiar semántica 👍/👎 de opciones de gusto.
- [x] Probar rutas públicas/invitación válida e inválida, pasos de onboarding y guardado/salto/retroceso en ES/EN; los emojis de alergias/gustos siguen visibles. Medir 320/393 px, viewport corto y horizontal, controles/foco/teclado.
- [x] Ejecutar Playwright real en escritorio y Pixel 5, capturar e inspeccionar PC+móvil y revisar errores de consola.
- [x] Hallazgo E2E: en móvil el navegador rechaza `ViewTransition.ready` (`InvalidStateError`) al redimensionar o fallar el prepaint; capturar ese rechazo y llamar `skipTransition()` para que la capa visual no siga interceptando controles. No ocultar errores de navegación.
- [x] Hallazgo Pixel 5: las pestañas de Preferencias desbordan el viewport (`scrollWidth=792` frente a `clientWidth=393`) y empujan a la derecha el contenido y los controles; mantener el documento dentro del ancho móvil y comprobar que se pueden pulsar pestañas/objetivos en 320/393 px y horizontal.
- [x] Hallazgo Pixel 5: el grid de horarios y el pie flex de acciones vuelven a desbordar el documento en Preferencias y hacen fallar los toques; apilar/ajustar filas y pie al ancho móvil, y validar input, «Por defecto», checkbox y guardado con la barra inferior presente.

**Evidencia QA-UI.3b (2026-09-30):** rojo E2E reprodujo pictogramas decorativos en Auth/Onboarding/Invitación, el rechazo de `ViewTransition.ready` y el overflow de Preferencias a 393/320 px y viewport horizontal. Verde: `auth-onboarding-icons.spec.ts`, Playwright real aislado en Chromium **3/3** y Pixel 5 **3/3**; `onboarding.spec.ts`, Chromium **6/6** y Pixel 5 **6/6**. Las corridas usan puerto/SQLite/semilla únicos, rate limit activo y cleanup; validan login/register/forgot-password e invitaciones válida/inválida, idioma ES/EN, SVGs y nombres accesibles, comida 🍗/🌾/🫀 conservada, seis pasos, preferencias, horarios, teclado y persistencia. Pixel 5 cubre 393×851, 320×568 y 568×320 sin overflow; navega pestañas, edita/restaura una hora, guarda y recarga preferencias.

`view-transition-utils.spec.ts` + `taste-profile.spec.ts`: Karma **6/6**, cobertura focal S/B/F/L **100/100/100/100 %** (gate global 80 % intacto). Build production, `tsc -p tsconfig.e2e.json --noEmit`, Prettier focal y `git diff --check` pasan. Capturas sintéticas revisadas: `.e2e-screenshots/qa-ui-3b/final-desktop-verified/{auth-login-chromium.png,onboarding-goals-1440x900.png,preferences-meals-1440x900.png}` y `.e2e-screenshots/qa-ui-3b/final-mobile-verified/{auth-login-mobile-chrome.png,onboarding-goals-320x568.png,onboarding-goals-393x851.png,onboarding-goals-568x320.png,preferences-meals-320x568.png,preferences-meals-393x851.png,preferences-meals-568x320.png}`. Se quitaron cuatro excepciones `sin-emoji` obsoletas del guardián y sus fixtures de test ya no se consideran interfaz; `check-ui` aún reporta solo las 13 deudas conocidas `texto-en-un-catalogo` en `core/i18n/labels.ts:345-358`. Rollback: revertir el commit atómico de QA-UI.3b restaura la navegación visual/íconos y el layout mobile, más sus pruebas y evidencia.

### QA-UI.3c · Configuración IA y Configuración

**Fuente revalidada y baseline (2026-09-30, antes de tocar producción):** `/ai-config` y `/settings` son rutas lazy-loaded. `AiConfigComponent` dibuja `🤖` en vacío y resultado de prueba (`✅`/`❌`); `ai_config.ts` añade emojis a título, botones y copy. `settings.ts` añade banderas a idioma, y emojis a título, tema y módulos. Los breakpoints vigentes en el código son `ai-config` 480/600/768 px y Settings 480 px. `AiService` guarda, edita, elimina y prueba mediante `/api/ai/*`; `ModulesService` aplica de forma optimista y revierte cambios al fallar el guardado.

Baseline aislada con `%TEMP%\hogaria-e2e-runner-audit.mjs`, `E2E_SCOPE=all`, `E2E_RATE_LIMIT=on`, puerto/SQLite/semilla únicos: `settings-modules.spec.ts` + `settings-theme-i18n.spec.ts`, Chromium **12/12**, Pixel 5 **12/12**. `ai-config.spec.ts`, Chromium **8/9**: el test «probar desde el formulario» esperaba éxito pero recibió error. El runner registró `POST /api/ai/test-connection 200` desde el backend durante el caso, señal de que el `page.route()` fixture no interceptó la petición en el build de producción (que registra el service worker); revalidar/bloquear service workers en ese spec y afirmar que la respuesta simulada se usó antes de interpretar el resultado como fallo del producto. Los otros ocho casos IA pasan. `ModulesService` ya tiene cobertura unitaria focal de rollback/reintento, pero Settings no tiene pruebas de componente. Aún no hay regresión Playwright para los glifos de estas pantallas ni comprobación de bounds/capturas responsive.

**Hallazgos read-only revalidados en fuente para ampliar criterios:** `AiService` emite `null`/`false` ante error HTTP y los `next` de `AiConfigComponent` lo confunden con éxito; `loadConfigs()` traga el error y la plantilla representa el `[]` como pantalla vacía; `testConfig()` no actualiza la insignia persistida; el modal de resultado usa `[attr.title]` aunque `ModalComponent` recibe `[title]`; proveedor/temperatura no tienen labels asociadas; el helper de URL solo está en español. Tema/idioma solo exponen clase visual activa, el reset de módulos no se deshabilita al guardar y el aviso de error no es live region. En móvil `.form-actions` no permite wrap. El interceptor común ofrece `SILENT_TOAST` para peticiones con error mostrado por pantalla propia; verificar que IA no muestre un aviso genérico duplicado junto a su error contextual.

**TDD rojo adicional (2026-09-30):** al comprobar el requisito de teclado/foco en el diálogo de IA, el nuevo caso Playwright pasa **17/18** y falla porque el `role="dialog"` no declara `aria-modal`; la prueba unitaria de `ModalComponent` pasa **16/18**, reproduciendo además que el foco no entra en el diálogo y que `Tab`/`Shift+Tab` escapan de sus límites. La prueba se escribió antes de corregir el componente compartido.

**TDD rojo de foco de módulos (2026-09-30):** la suite Settings pasa **16/17** en Chromium; al alternar una sección con `Space`, `ModulesService` activa `isSaving` y la plantilla pone el botón nativo en `disabled`, lo que hace que Chromium saque el foco del control antes de completar el guardado. Mantener semántica `aria-disabled` durante la escritura y bloquear activaciones repetidas sin perder el foco; las secciones imposibles de apagar pueden seguir realmente deshabilitadas.

- [x] Añadir primero regresiones para vacío/resultado/acciones de IA y títulos/opciones de Configuración en ES/EN; migrar robots, estados, acciones, título, módulos/tema a iconos SVG y eliminar banderas de las etiquetas de idioma.
- [x] Verificar formulario IA inválido, creación/edición (sin exponer ni reemplazar la clave al dejarla vacía), activar/desactivar en exclusiva, probar desde formulario y tarjeta (éxito/error/insignia actualizada), eliminar con confirmación, cancelar y fallos de red sin falsos éxitos ni toasts duplicados; el modal de resultado tiene título accesible y campos proveedor/temperatura etiquetas asociadas.
- [x] Diferenciar carga de configuraciones vacía/cargando/fallida; al fallar no mostrar «Sin configuraciones» como si el backend confirmara vacío y ofrecer reintento accesible. Si se solapan recargas iniciales, manuales o posteriores a una mutación, solo la petición más reciente puede actualizar datos/error/loading; una respuesta antigua no debe ocultar cambios guardados ni restaurar una configuración eliminada.
- [x] Verificar persistencia y semántica accesible de idioma/tema/módulos; el botón restablecer no compite con un guardado en curso y los errores se anuncian. El cambio async de un módulo conserva foco mientras su interruptor anuncia que no se puede activar de nuevo. El diálogo de IA declara `aria-modal` solo en el diálogo superior, deja el inferior `inert` y oculto para tecnologías de asistencia, mueve el foco dentro, confina `Tab`/`Shift+Tab` y restaura el foco al disparador al cerrar; con el resultado de prueba apilado sobre el formulario, Escape cierra solo el superior y conserva datos/foco del formulario. Mantener los demás controles operables con teclado/foco y objetivos táctiles adecuados.
- [x] En móvil, verificar objetivos ≥44×44 px también para cerrar modales y las acciones de las tarjetas de configuración; no limitar la comprobación a los botones del formulario.
- [x] Medir bordes 320/393, 480/481, 600/601, 768/769 y orientación horizontal; formulario/modal, sus acciones y documento permanecen dentro del viewport y se pueden recorrer con teclado.
- [x] Ejecutar Playwright real en Chromium y Pixel 5, capturar e inspeccionar PC+móvil; cobertura focal ≥70 % en las métricas aplicables.

**Corrección y evidencia verde (2026-09-30):** se corrigió la pérdida de foco en `Space`: el switch usa `aria-disabled` durante la escritura y bloquea activaciones repetidas; el único módulo imposible de apagar sigue con `disabled` nativo. TDD rojo previo Settings 16/17; E2E verifica PATCH demorado, una sola escritura, foco estable, reactivación, rollback y reintento. `AiService` ahora asigna generación a cada GET y solo permite que la lectura más reciente cambie datos/error/loading; las mutaciones confirmadas invalidan lecturas en vuelo antes de editar/agregar/eliminar localmente. El E2E reproduce con éxito la carrera actualización→GET viejo y GET retenido→DELETE→respuesta vieja; los tests unitarios cubren respuestas y errores obsoletos. `ModalComponent` procesa Escape solo en el overlay superior y restaura el foco dentro del diálogo aún abierto; el E2E apilado confirma que el resultado se cierra, el formulario conserva el valor y el foco regresa al botón que queda habilitado. Se estabilizó asimismo el idioma de tests: el `finally` restablece español y detecta cambios para vaciar el efecto del locale global antes de salir.

**Hallazgos read-only resueltos (2026-09-30):** una tecla Escape cerraba los dos modales apilados; un GET viejo podía pisar una edición, cerrar prematuramente el estado de carga, marcar error aunque el GET reciente siguiera activo, o restaurar una configuración que un DELETE exitoso ya eliminó. Se añadieron primero regresiones unitarias y E2E, se observaron rojas con los estados originales y luego se corrigió la ownership de cargas y el apilado/foco de diálogos.

**Hallazgo cruzado adicional antes de cerrar (2026-09-30):** la secuenciación de lecturas por sí sola no protege una eliminación exitosa: un GET iniciado antes del DELETE aún puede resolverse después y volver a insertar localmente la configuración eliminada. Añadir regresiones unitarias y E2E de esa intercalación y hacer que una mutación confirmada invalide la lectura pendiente antes de marcar esta unidad completa.

**Revisión del arreglo antes del commit:** invalidar lecturas al borrar debe detener `loading`, pero no ocultar un error de lectura ya observado si DELETE no recarga la lista completa. Mantener el aviso contextual hasta una nueva lectura; verificarlo en `AiService` antes de cerrar.

**Revalidación final de accesibilidad (2026-09-30):** el markup compartido fija `aria-modal="true"` a toda instancia abierta; el flujo E2E apila el diálogo «Resultado del Test» sobre el formulario, así que ambos quedan anunciados como modales. Además, `.modal__close` mide 32×32 px y los cuatro botones `size="sm"` de las tarjetas IA no usan `[touchTarget]`; la aserción móvil existente solo mide `.form-actions`. La spec y checklist se reabren para cubrir jerarquía modal y tamaño real de estos objetivos táctiles.

**TDD rojo de accesibilidad apilada y objetivos táctiles (2026-09-30, sin corrección de producción):** `modal.component.spec.ts` falla 1/19: los dos diálogos anuncian `aria-modal="true"` y el inferior no es `inert`/`aria-hidden`. La suite Playwright real `ai-config.spec.ts` falla 3/23 en Chromium aislado: cierre de modal **32×32**, acción de tarjeta **26 px** de alto y ambos diálogos con `aria-modal=true`; los otros 20 casos pasan. El runner conserva solamente artefactos/DB sintéticos en su directorio temporal exclusivo.

**Corrección verde de accesibilidad (2026-09-30):** `ModalComponent` asigna atributos modales solo al diálogo superior y deja el inferior `inert` + `aria-hidden`; al cerrar el superior restaura semántica y foco del que queda y limita el trap de Tab al superior. El cierre y las cuatro acciones pequeñas de tarjetas IA se elevan a objetivos de 44×44 px. `modal.component.spec.ts`: **19/19**; `ai-config.spec.ts`: **23/23 Chromium y 23/23 Pixel 5**, incluido el stack, Escape, 320 px y medición de los controles reales.

TDD rojo de ese borde: Karma focal `ai.service.spec.ts` **10/11**; el GET 503 dejó `configsError=true`, pero DELETE exitoso lo borró aunque no se ejecutó una lectura nueva.

Playwright confirma la misma conducta antes del cambio: `ai-config.spec.ts`, Chromium **22/23**; después de borrar una tarjeta en caché desaparece el aviso de fallo 503 anterior. Se añadió el E2E para conservar el error hasta una recarga nueva.

**TDD rojo de los dos bordes (2026-09-30, pre-corrección):** Karma focal `ai.service.spec.ts` + `modal.component.spec.ts`: **27 tests, 25 pasan y 2 fallan**. En cargas simultáneas, una respuesta antigua reemplaza la lista nueva y apaga `loading` mientras la última petición sigue pendiente. Con dos diálogos apilados, una sola tecla Escape cierra ambos y deja el foco en `<body>` en vez de conservar el formulario. Playwright real en servidor/puerto/SQLite temporales también reprodujo ambas regresiones: `ai-config.spec.ts`, Chromium **19/21**, falló la recarga vieja que restaura el nombre anterior tras una edición y Escape que cierra el formulario junto con el resultado; sin llamadas a proveedor externo ni uso de `localhost:4200`.

**TDD rojo del borde de borrado (2026-09-30, pre-corrección):** la prueba unitaria focal de `AiService` ejecuta **9/10**, reproduciendo que un GET anterior devuelve la configuración ya eliminada después del DELETE confirmado y la vuelve a insertar en la señal local.

Playwright de regresión ejecutado antes del cambio con la UI y backend temporales: `ai-config.spec.ts`, Chromium **21/22**; el escenario probar-configuración → mantener GET pendiente → borrar → liberar GET falla porque la tarjeta eliminada reaparece. El caso usa una respuesta sintética de conexión y no llama a proveedores externos.

**Aislamiento de la suite revalidado:** la corrida completa posterior expuso que el `finally` de la prueba del idioma en `input.component.spec.ts` fijaba `'es'` pero no ejecutaba el efecto Angular antes del siguiente caso; `shopping.model.spec.ts` podía observar `en-GB` (572/573). Se fuerza `fixture.detectChanges()` tras restaurar el idioma para que el locale global vuelva a español antes de salir del test.

Evidencia reproducible: build production completado; `tsc -p tsconfig.e2e.json --noEmit` y Prettier focal pasan. La suite Karma completa ejecuta **574/574** pruebas; coverage focal S/B/F/L: `ai.service.ts` **98,63/100/97,22/98,50 %**, `ai-config.component.ts` **93,61/87,80/91,66/94,38 %**, `settings.component.ts` **100/100/100/100 %**, `modal.component.ts` **92,30/83,01/100/93,25 %** (todas >70 %). Cobertura agregada **65,18/56,25/57,18/66,76 %** queda por debajo del gate de frontend declarado en **80 %**; no se rebajó. El comando devuelve 0 con la suite verde, por lo que no se presenta ese resultado como evidencia de que el gate global se cumpla.

Playwright real mediante `%TEMP%\hogaria-e2e-runner-audit.mjs`, `E2E_RATE_LIMIT=on`, servidor/puerto/SQLite/semilla desechables: IA **23/23 Chromium y 23/23 Pixel 5**; Configuración (módulos + tema/idioma) **17/17 en ambos proyectos**; fallo real de guardado/rollback/reintento **1/1 en cada proyecto**. Se probaron cambios ES/EN, teclado y foco, formularios/modal, límites responsive 320/393, 480/481, 600/601 y 767/768/769, horizontal 844×390, scroll real en modal y objetivos táctiles ≥44 px. Los tests interceptan proveedores externos; no se usó el token temporal ni se escribió en `localhost:4200` o el servicio LAN. Capturas sintéticas PC/móvil inspeccionadas en `.e2e-screenshots/qa-ui-3c/final-verified/` (`ai-config-empty-{desktop,mobile}.png`, `ai-config-form-{desktop,mobile}.png`, `ai-config-form-actions-mobile.png`, `settings-{desktop,mobile}.png`).

**Limitaciones no ocultadas:** la cobertura agregada final (**65,18 % statements, 56,25 % branches, 57,18 % functions, 66,76 % lines**) queda por debajo del gate global declarado de 80 %; no se rebajó. Karma devuelve 0 con las 574 pruebas verdes, así que ese resultado no demuestra que se satisfaga el gate global. `node scripts/check-ui.mjs` sigue reportando únicamente 13 deudas conocidas `texto-en-un-catalogo` en `core/i18n/labels.ts:345-358` (no emojis de esta unidad). `ng lint` no puede arrancar en este entorno porque falta `@angular-eslint/builder`; no se añadió dependencia ni se cambió configuración. El build pasa con warnings previos de presupuesto/imports. Rollback: revertir el commit atómico de QA-UI.3c restaura Settings/IA y sus pruebas/evidencia; no requiere migración de datos.

### QA-UI.3d · Inventario y Recetas

**Fuente revalidada (2026-09-30, antes de editar):** el inventario ya importa `IconComponent`; sus dos vacíos aún pintan 📦/🍳 directamente. `ingredientCategoriesNoAll`, `ingredientCategories` y `utensilCategoryOptions` conservan campos `icon` emoji que no están enlazados desde la plantilla actual; el filtro/categoría se muestra mediante el picker local y etiquetas coloreadas. En Recetas, `recipes.ts` prefija títulos, CTAs y métricas con glifos; la plantilla añade emoji a filtros, favorito, imagen vacía, porciones y a consejos/advertencias; los últimos son prefijos literales de plantilla y el texto de consejo/advertencia es dinámico. `getCategoryIcon()` también da emojis alimentarios reales a ingredientes en el formulario IA; se preservan esas categorías semánticas aprobadas y no se cambian valores de contenido de receta.

**TDD rojo (2026-09-30, sin cambio de producción):** la nueva unidad `PantryComponent` obtuvo 3/4; la regresión falla porque quedan `icon` decorativos en los arrays de categoría. El E2E aislado (`E2E_SCOPE=all`, rate limit activo, Chromium, usuario/hogar/SQLite/puerto temporales) llega al estado real «Tu inventario está vacío» y falla al exigir su `app-icon` SVG (0 presentes). La primera iteración de la aserción falló por usar un texto de vacío inventado («No hay ingredientes»); se corrigió contra `dict/pantry.ts` antes de contarla como rojo.

- [x] Añadir primero regresiones para vacíos/categorías/favorito/porciones/filtros/tips/advertencias; migrar solo glifos decorativos. Preservar y probar los emojis semánticos de alergias/gustos y de las categorías alimentarias mostradas en Ingredientes. Remover metadatos de emoji no usados; mantener el selector nativo entendible sin emoji y no alterar contenido de receta escrito/generado.
- [x] Verificar acciones de Inventario y Recetas con fixtures sintéticas en ES/EN, incluidos estados vacíos y cargados, 320/393 px, breakpoints del código y orientación horizontal; no debe haber glifos en iconos/nombres accesibles.
- [x] Ejecutar Playwright real en Chromium y Pixel 5, revisar errores de consola, capturar e inspeccionar PC+móvil y validar cobertura focal ≥70 % en las métricas aplicables.

**TDD rojo → verde y evidencia final (2026-09-30):** Karma primero falló solo la regresión de metadatos emoji (3/4 pasaban); E2E primero midió 0 SVG en el vacío real de Inventario. Verde unitario: Pantry + `recipe-category-emoji`, **6/6**; la lógica nueva `recipeCategoryEmoji` queda en **100 % S/B/F/L**. El E2E aislado `recipe-pantry-iconography.spec.ts` terminó **1/1 Chromium** y **1/1 Pixel 5**, con hogar/usuario/ingrediente/receta sintéticos, SQLite/puerto únicos, rate limit activo y limpieza. Comprueba favorito y su estado ARIA, 44×44 px, porciones, filtros, títulos/acciones ES y EN, tips/advertencias dinámicos intactos, símbolos alimentarios y selector de utensilios, cero excepción JS y bounds/overflow a 320×568, 393×851, 479/480/481, 600/601, 767/768/769, 568×320, 844×390 y 1440×900. Capturas sintéticas inspeccionadas en `.e2e-screenshots/qa-ui-3d/chromium/` y `mobile-chrome/` (modal IA, selector de utensilio y CTA inferior móvil). `npm run build:prod` desde `frontend/`, `npm run typecheck:e2e` y `git diff --check` pasan. El gate agregado del componente Pantry en Karma no representa cobertura de plantilla; no se altera ni se afirma cerrado el gate global frontend de 80 %. `check-ui` queda para QA-UI.3e: detecta los emojis alimentarios semánticos aprobados del nuevo mapper y conserva 13 avisos de catálogo preexistentes.

### QA-UI.3e · guardia estática y cierre

**Fuente revalidada (2026-09-30, antes de editar):** `check-ui.mjs` permite emojis por archivo completo mediante `LEGACY['sin-emoji']`; `--sin-deuda` encuentra pictogramas de ubicación/sugerencias/utensilios en `dict/pantry.ts`, un `getLocationIcon()` sin llamadas en `PantryComponent`, un cierre `✕` en el modal y glifos de estrella en `RatingComponent`. El mismo barrido confirma contenido semántico en `COMMON_ALLERGENS`, `COMMON_LIKES`, `COMMON_DISLIKES`, el mapa `FOOD_CATEGORY_EMOJI`, `pantry.ingredientes` y los dos pares de gusto/no-gusto de onboarding. En Hogar, la fuente actual ya usa `app-icon` para el título (`group`) y copiar (`content_copy`), con regresión Playwright existente `household-icon-consistency.spec.ts`; no duplicar ese arreglo.

**Decisión:** sustituir residuos decorativos por iconos locales o texto limpio y retirar el método de ubicación muerto. El detector deberá eximir únicamente valores de `icon` dentro de los tres arrays de preferencias, las claves alimentarias conocidas de `FOOD_CATEGORY_EMOJI`, el rótulo literal aprobado `pantry.ingredientes` y los valores exactos `me_gusta`/`mejor_no` ES/EN. Comentarios, otras propiedades, claves nuevas, texto libre y pictogramas añadidos junto a los datos semánticos siguen siendo incidencias; no se admiten excepciones por fichero. `check-ui` todavía registra 13 incidencias independientes `texto-en-un-catalogo` de `labels.ts` (QA-05), que no se ocultarán ni se rebajará la regla.

- [x] Escribir primero pruebas `node:test` de la guardia: contenido semántico permitido por entidad, emoji genérico detectado, emoji decorativo en comentario/propiedad junto al contenido permitido, y nuevo/alterado valor no aprobado rechazado. TDD rojo: al integrar el detector sin excepciones encontró las fuentes decorativas y los datos semánticos; las pruebas iniciales reprobaron ante emojis aprobados, y quedaron verdes solo con reglas acotadas.
- [x] Limpiar ubicaciones, pestaña/sugerencias y CTA de utensilios; eliminar el método muerto; migrar cierre del modal y estrellas a SVG local. Retirar `LEGACY['sin-emoji']` completa sin tocar las excepciones semánticas aprobadas. TDD rojo observado: las regresiones Angular fallaban para modal/rating (3 fallos) y el Playwright aislado para el título de utensilios (sin SVG); tras el cambio pasan.
- [x] Ejecutar build, typecheck, unit tests focales, `check-ui`, Playwright real de Hogar, Inventario y Recetas en Chromium y Pixel 5; revisar/capturar PC+móvil, registrar cobertura y las 13 incidencias independientes sin rebajar gates.

**Evidencia (2026-09-30):** `node --experimental-test-coverage --test scripts/check-ui-emoji.test.mjs` **6/6**; la guardia tiene **98.74 %** de líneas, **97.22 %** de ramas y **100 %** de funciones (Node no reporta statements por separado). Karma modal/rating/icon + Pantry/categorías **34/34**; una corrida con coverage de modal/rating/icon reportó agregado **56.20/30.10/50.00/60.45 %** por dependencias instrumentadas, por debajo del gate frontend existente **80 %** (no se modifica y continúa abierto en QA-04c). `ng build --configuration production` y `tsc -p tsconfig.e2e.json --noEmit` pasan con advertencias/build-budget ya existentes.

Playwright real con `hogaria-e2e-runner-audit.mjs`, servidor/puerto/SQLite/semilla temporales y rate limit activo: `recipe-pantry-iconography.spec.ts` **1/1 Chromium + 1/1 Pixel 5** (incluye 320/393 px, bordes de breakpoints y horizontal); `household-icon-consistency.spec.ts` **3/3 Chromium + 3/3 Pixel 5** (título Hogar SVG, copia real a clipboard, regeneración, nombre largo y límites móviles); repetición combinada tras el último formato: **4/4 Chromium + 4/4 Pixel 5**. Sin excepciones JavaScript. Las capturas sintéticas se inspeccionaron: `.e2e-screenshots/qa-ui-3e/household-chromium/household-members.png`, `.e2e-screenshots/qa-ui-3e/household-mobile/household-members-es-393x851.png`, más Inventario/Recetas en `.e2e-screenshots/qa-ui-3d/{chromium,mobile-chrome}/`.

`node scripts/check-ui.mjs` ahora no informa **ningún `sin-emoji`**; termina con **13 incidencias preexistentes `texto-en-un-catalogo`** en `frontend/src/app/core/i18n/labels.ts`, intactas y listadas para QA-05. Esto no se presenta como comando verde ni como cierre del gate global.

**Revalidación del reporte visual (2026-10-01):** la auditoría de los templates/diccionarios actuales no encuentra emojis decorativos restantes: Hogar usa SVG para título, estado vacío, compartir, copiar, regenerar y salir. Se conservan expresamente los emojis de alergias/gustos, los de ingredientes/categorías alimentarias y los marcadores semánticos «Me gusta/Mejor no». La ejecución fresca de las E2E de panel/Hogar descrita arriba vuelve a comprobar iconos y nombres accesibles. La guardia estática sigue sin incidencias `sin-emoji`; sus únicas 13 salidas son las de i18n ya registradas, fuera de esta unidad. Sin cambios de producción ni excepciones nuevas.

## Unidad QA-DASH.1 · comidas pendientes de hoy en el Dashboard (resuelta)

**Fuentes revalidadas antes de implementar:** el contrato activo `HOGARIA-SPEC.md` §2 define Today con comidas debidas y §12al pide la siguiente comida planificada. `DashboardComponent.upcomingMeals` empezaba como `[]` y no se actualizaba; `loadDashboardData()` llamaba a `CalendarService.loadCalendar()` sin conectar la respuesta con «Comidas de hoy». `CalendarService.loadRange(start, end)` y `CalendarMeal` ya normalizan la carga.

**Decisión de comportamiento:** el bloque mostrará las comidas no completadas de la fecha local de hoy, ordenadas por hora; no debe mostrar como «pendiente» una comida completada ni una comida de otro día. Un error de carga no se presentará como «no hay comidas».

- [x] Escribir primero la regresión Playwright con comidas sintéticas de hoy/ayer/mañana, pendiente y completada; el baseline previo carecía de render de comidas y estados de carga/error. Al inicio `page.route()` no interceptaba por el service worker Angular; bloquear workers hizo determinista el test. El caso devuelve 503 en la primera carga y comprueba que no aparezca el vacío; todas las fixtures se crean y cada borrado se intenta en `finally` contra SQLite aislada. El test vigila `/api/ai/*` y confirma cero llamadas.
- [x] Conectar el Dashboard a `CalendarService.loadRange()` para la fecha local, sin duplicar cliente HTTP; ordenar pendientes por hora, localizar tipo, mostrar título/hora, mantener carga/error/reintento separados y enseñar el vacío solo después de una carga correcta.
- [x] Añadir pruebas unitarias focales para orden estable, fecha local, fecha/completado y etiquetas ES/EN. `dashboard-meals.util.ts` alcanza 100 % statements/branches/functions/lines; el agregado de la ejecución enfocada (incluye dependencias) queda en 65.71/40.54/55.55/67.74 %, por debajo del gate global, que continúa abierto en QA-04c. El alcance de cobertura del helper está al 100 %; no se presenta el agregado ni el gate global como cerrados.
- [x] Verificar CTA «Ver todo» a `/calendar`, recarga, primer error 503 (sin estado vacío), error tras datos, reintento y vacío después de limpiar; probar el nombre accesible, foco y Enter de «Reintentar». Probar cruce local/UTC fijando Playwright en `Europe/Madrid` a 2026-09-30 22:30Z (fecha local 1 oct, UTC 30 sep). Playwright aislado: Chromium 1/1 y Pixel 5 1/1. Pixel 5 cubre 320×568, 393×851, 479/480/481, 767/768/769 y 844×390; Chromium escritorio cubre 1440×900 y 1023/1024. Sin overflow/solapamiento del bloque ni errores JS.
- [x] `node ./node_modules/@angular/cli/bin/ng.js test --no-watch --browsers=ChromeHeadlessNoSandbox --include=src/app/features/dashboard/dashboard-meals.util.spec.ts --code-coverage` (frontend): 3/3; `node ./node_modules/@angular/cli/bin/ng.js build --configuration production`: éxito con warnings preexistentes; `node ./node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`: éxito. Playwright: `$env:E2E_SCOPE='all'; $env:E2E_RATE_LIMIT='on'; $env:E2E_FILES='dashboard-today-meals.spec.ts'; $env:E2E_PROJECT='chromium'` y después `mobile-chrome`; `node (Join-Path $env:TEMP 'hogaria-e2e-runner-audit.mjs') (Get-Location).Path`: 1/1 en cada proyecto, cada uno con servidor, puerto, semilla y SQLite únicos temporales. Capturas sintéticas EN inspeccionadas: `.e2e-screenshots/qa-dashboard-1/desktop/dashboard-today-meals-1440x900.png` y `.e2e-screenshots/qa-dashboard-1/mobile/dashboard-today-meals-393x851.png`.

**Evidencia de regresión ampliada:** la suite Dashboard existente pasó 7/7 en Chromium; Pixel 5 pasó 6/7. El único fallo fue al hacer click en «+ Agregar» de `/pantry`: controles del encabezado/cabecera de cola interceptan el click (45 s). No lo causa el cambio aislado de Dashboard; queda desglosado en QA-PANTRY.1, sin ocultarlo como suite completamente verde.

**TDD rojo observado antes del cambio:** contra el bundle anterior, `dashboard-today-meals.spec.ts` falló porque el Dashboard no renderizaba comidas ni estados de carga/error. En la primera versión del test, el mock 503 no alcanzó la petición porque el service worker registrado la interceptaba; lo registré y corregí el setup con `serviceWorkers: 'block'` antes de usar el test como señal verde. Rollback de esta unidad: revertir conjuntamente `dashboard.component.ts`, `dashboard-meals.util.ts`, su spec unitario, `dashboard-today-meals.spec.ts` y esta sección QA-DASH.1.

**Discrepancias de producto abiertas (no se cierran en esta unidad):** `HOGARIA-SPEC.md` §2/§12al también pide vencimientos, lista abierta/presupuesto semanal y cola IA en Today; `DashboardComponent` actual no renderiza esos bloques. Mantener abierta la checklist general `/dashboard` y decidir cada superficie en su propia unidad, sin atribuirlas a esta corrección de comidas.

## Unidad QA-CALENDAR.RANGE-STALE.1 · respuestas obsoletas del rango visible (resuelta localmente)

**Fuente de verdad revalidada (2026-10-01):** `HOGARIA-SPEC.md` §8f define calendario por día/semana/mes; `CalendarComponent.visibleRange` deriva el rango de lo que la persona mira y el efecto pide ese rango a `CalendarService.loadRange()` y `loadHouseholdEvents()`. Ambos loaders evitan peticiones duplicadas de la misma clave, pero sus respuestas escriben señales sin comprobar si otra petición más reciente ya tomó su lugar. Una respuesta vieja puede reemplazar comidas/objetivos/rango o eventos, cambiar `loading/error` del rango actual, y borrar la clave deduplicada para permitir una petición repetida.

**Decisión (inferencia de la fuente vigente, no un cambio de contrato API):** mientras cambian vista/fecha, solo la solicitud más reciente de cada loader puede mutar sus datos, error, loading o deduplicación. En `loadRange`, un error actual conserva comidas/objetivos previos y permite reintentar; en eventos se conserva la recuperación existente (`eventsError` y clave reintentable). Respuestas anteriores no modifican datos ni estado, incluso tras dos `force` concurrentes de la misma clave. Mantener llamadas GET reales en la E2E; aislar su respuesta temporalmente para ordenar la carrera.

- [x] Añadir primero pruebas unitarias de `loadRange()` y `loadHouseholdEvents()` para éxito viejo tras éxito nuevo, fallo viejo mientras la petición actual sigue cargando y dos `force` concurrentes para la misma clave; cubrir además que el error actual de comidas conserva datos previos y permite reintento. Confirmar rojo antes del cambio de producción.
- [x] Añadir primero una E2E real que persista dos comidas sintéticas en fechas distintas, demore una respuesta GET real del rango anterior, navegue a otro rango y libere la respuesta vieja al final; demostrar que la comida del rango visible no desaparece ni se cambia. No usar la base habitual ni el proveedor IA.
- [x] Aplicar el guardado mínimo de actualidad a todos los efectos de cada respuesta (datos, loading, error y clave deduplicada), conservando la política actual de mantener datos previos ante error recuperable.
- [x] Ejecutar Karma focal con cobertura ≥70 % en statements, ramas, funciones y líneas para el guardado reutilizable de actualidad; las pruebas de servicio cubren su integración en ambos loaders. No rebajar el gate global frontend del 80 %. Ejecutar Playwright real con servidor/SQLite/puertos/semilla temporales en Chromium y Pixel 5; revisar teclado, navegación de periodo y sin errores de consola.
- [x] Guardar e inspeccionar capturas sintéticas PC y móvil del calendario; dejar comando, resultado, cobertura, limitaciones y rollback exactos en esta sección.

**TDD rojo (2026-10-01):** antes del cambio, las pruebas nuevas de `CalendarService` reprobaron los escenarios de respuestas tardías en ambos loaders (6 fallos y 1 caso sin relación pasó); la E2E con GET real retrasado también falló en Chromium y Pixel 5 al dejar que la respuesta del rango anterior sobreescribiera el rango visible. La fixture registra dos comidas mediante API contra SQLite temporal; no llama al proveedor IA ni toca la base normal.

**Verde y cobertura de la unidad:** la suite focal de Karma (`latest-request.spec.ts` + `calendar.service.spec.ts`) pasa **9/9**. El perfil instrumentado cubre las **4/4 sentencias, 3/3 funciones y 4/4 líneas** de `LatestRequest` (100 %; no contiene bifurcaciones) y las **14/14 líneas ejecutables y 5/5 resultados de rama modificados** del servicio. Se añadieron también error actual de eventos y reintento de la misma ventana. `tsc -p tsconfig.e2e.json --noEmit` pasa. No se rebajó el gate Karma local de 80 %: la corrida completa ejecuta **604/604** pruebas, pero el agregado existente queda en **57,87 % statements / 49,07 % ramas / 46,29 % funciones / 59,54 % líneas**, por lo que el gate global falla y permanece abierto en QA-04c; el workflow de CI no ejecuta Karma frontend ni publica su cobertura (solo server coverage y Playwright Chromium).

**Playwright y capturas (2026-10-01):** comando ejecutado: `$env:E2E_RATE_LIMIT='on'; $env:E2E_CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'; $env:E2E_SCREENSHOT_DIR='.e2e-screenshots/qa-calendar-final2-20261001'; node scripts/run-isolated-playwright.mjs --project=chromium --project=mobile-chrome tests/e2e/calendar-range-order.spec.ts tests/e2e/calendar-mobile-header-layout.spec.ts tests/e2e/calendar-all-day-gutter.spec.ts`. El runner crea servidor/API/SQLite/puertos/semillas aislados; las tres specs pasan **6/6**, Chromium escritorio **3/3** y Pixel 5 **3/3**. La respuesta GET del rango anterior se libera al final sin reemplazar la comida del rango visible; cabecera verifica teclado/Enter, cambio de fecha, modales/Escape y 320×568, 393×851, 568×320, 767×1024, 768×1024 y 1440×900; no hay overflow ni errores de página/consola. Capturas PC/móvil inspeccionadas: `.e2e-screenshots/qa-calendar-final2-20261001/{chromium-calendar-range-latest,mobile-chrome-calendar-range-latest}.png`. Rollback: revertir el commit atómico de esta unidad (servicio, `LatestRequest`, pruebas y esta sección).

## Unidad QA-CALENDAR.MOBILE-HEADER.1 · reflujo de cabecera móvil (resuelta localmente)

**Fuente de verdad revalidada (2026-10-01):** `CalendarComponent` envuelve la cabecera `.cal-top` en una superficie `.calendar__panel` con `overflow: hidden`. La cabecera permite envolver sus hijos, pero `.cal-top__right` y sus controles siguen en una fila flex de ancho intrínseco. En un Chromium Pixel 5 real de 393 px CSS, después de navegar y añadir una comida sintética, el documento no tiene overflow (`innerWidth=393`, `documentElement.scrollWidth=393`, `scrollX=0`), pero el panel sí: `clientWidth=359`, `scrollWidth=455`, `scrollLeft=96`; el título queda en `x=-63` y el botón Día en `x=-60`, ambos fuera del panel (`x=16..377`). `.cal-top__right` ocupa 423 px para unos 327 px disponibles. `calendar-timeline.component.ts` no añade overflow horizontal. La captura `.e2e-screenshots/qa-calendar-range-stale-20261001/mobile-chrome-calendar-range-latest.png` muestra controles y contenido recortados.

**Conducta esperada (inferencia de accesibilidad/responsive, no cambio del contrato de calendario):** en móvil, título, navegación de periodo, selector Día/Semana/Mes y acciones disponibles deben reflowear dentro del panel; ninguna acción puede depender de desplazamiento horizontal oculto. La página y la cabecera no deben adquirir overflow horizontal en 320 px, 393 px, horizontal 568 px ni en el borde de 768 px. La E2E confirmó que la fila intrínseca de `.cal-top__right` provoca el scroll interno oculto al reordenar la vista; se resuelve permitiendo envolver el grupo y darle el ancho de la fila en el breakpoint móvil.

- [x] Añadir primero una E2E real que mida límites y scroll de `.cal-top`/sus controles al cargar, cambiar de vista y fecha, usar las acciones de cabecera y después de enfocar/navegar con teclado. Cubrir 320×568, 393×851, 568×320, 767×1024, 768×1024 y 1440×900; confirmar rojo antes del cambio CSS.
- [x] Reflowear la cabecera para que título, navegación, selector y acciones disponibles sean visibles y operables sin clipping ni scroll horizontal oculto en todos esos tamaños, sin alterar el layout de escritorio.
- [x] Verificar navegación de teclado/foco, selector de fecha, controles táctiles y los anchos 320/393/568/767/768/1440 tras cada interacción; registrar por separado cualquier estado que cambie el rango de forma intencional.
- [x] Ejecutar Playwright real contra servidor y SQLite temporales en Chromium de escritorio y Pixel 5; comprobar cero errores de página/consola y ausencia de overflow de documento/panel. No usar la DB habitual ni el proveedor IA.
- [x] Guardar e inspeccionar capturas sintéticas PC y móvil después de la corrección; anotar TDD rojo/verde, comandos, limitaciones y rollback exactos sin rebajar el gate frontend del 80 %.

**TDD rojo → verde (2026-10-01):** antes del CSS, `calendar-mobile-header-layout.spec.ts` fallaba en Chromium y Pixel 5. En Pixel 5 a 393 px el panel medía 359 px de ancho útil con 455 px de contenido; el grupo de acciones ocupaba 423 px, y el título/selector se salían por la izquierda aunque el documento aparentase no tener overflow. En el CSS móvil `.cal-top__right` ahora puede envolver y ocupar una fila completa con `min-width: 0`.

**Verificación real:** la E2E combinada pasa **6/6** (header **2/2**); el test recorre los seis anchos/orientaciones indicados, Día/Semana/Mes, fecha y comida sintética, Tab + Enter sobre navegación de periodo, foco, los modales de objetivo/evento con Escape y geometría tras cada estado. Cero errores de página/consola; `tsc -p tsconfig.e2e.json --noEmit` y Prettier focal pasan. Capturas PC/móvil inspeccionadas en `.e2e-screenshots/qa-calendar-final2-20261001/{chromium-calendar-header-desktop,mobile-chrome-calendar-header-mobile}.png`. Rollback: revertir el commit atómico con CSS, E2E y esta sección. La corrida full Karma conserva el gate 80 % y su agregado actual no lo alcanza (detalle en QA-CALENDAR.RANGE-STALE.1).

## Unidad QA-CALENDAR.ALL-DAY-GUTTER.1 · etiqueta «Todo el día» cortada (resuelta localmente)

**Fuente de verdad revalidada (2026-10-01):** `CalendarTimelineComponent.columns()` fijaba la primera columna de hora en 46 px para «22:00». La banda de eventos de día completo reutiliza el mismo ancho para `.tl__gutter--band`, que añade padding horizontal y pinta «Todo el día» sin ajustar el track a su texto. La E2E midió el nodo: 48 px de texto frente al track de 46 px; empezaba 6 px fuera de la celda. Las capturas sintéticas previas `.e2e-screenshots/qa-calendar-mobile-header-20261001-green2/` también mostraban el clipping; no era overflow global.

**Conducta esperada (inferencia de legibilidad/alineación del calendario):** la etiqueta de la banda «Todo el día» debe leerse completa en escritorio y móvil, sin invadir el borde del panel ni desplazar sus columnas. El track de gutter compartido por cabecera, banda y horas debe medir una sola vez el ancho necesario; no se debe resolver ocultando o truncando el texto.

- [x] Añadir primero una E2E real que compare los límites renderizados de la etiqueta y su track en 320×568, 393×851, 568×320, 768×1024 y 1440×900; confirmar rojo antes de tocar el CSS del timeline.
- [x] Ajustar la fuente compartida del ancho de la primera columna para contener la etiqueta completa con su padding y mantener alineadas la cabecera, banda de todo el día y escala horaria.
- [x] Verificar de nuevo la legibilidad en las vistas día/semana y que ninguna acción, columna o contenido se recorte ni cree overflow horizontal del documento/panel.
- [x] Ejecutar Playwright real aislado en Chromium y Pixel 5; guardar/inspeccionar capturas sintéticas PC/móvil y registrar coverage/gates, comandos, limitaciones y rollback sin rebajar el umbral global frontend.

**TDD rojo → verde (2026-10-01):** la primera E2E midió texto/celda en ambas sesiones de navegador y reprobaron Chromium y Pixel 5: la etiqueta ocupaba 48 px dentro de un track compartido de 46 px, empezaba 6 px fuera de la celda y la primera parte quedaba cortada; no era overflow del documento. `columns()` usa ahora un gutter común de 60 px, único para cabecera, banda de día completo y horas.

**Verificación real:** en la corrida aislada final la spec pasa **2/2** (Chromium y Pixel 5) en vistas Día y Semana a 320×568, 393×851, 568×320, 768×1024 y 1440×900. El texto cabe en su celda, los tres tracks continúan alineados, no hay overflow de panel/documento ni errores JavaScript. Capturas PC/móvil inspeccionadas: `.e2e-screenshots/qa-calendar-final2-20261001/{chromium-calendar-all-day-gutter,mobile-chrome-calendar-all-day-gutter}.png`. Rollback: revertir el commit atómico con ancho, regresión y esta sección. El gate global frontend de coverage 80 % permanece sin cumplir; no se modificó.

## Unidad QA-E2E.1 · aislamiento local de Playwright (resuelta)

**Fuente revalidada (2026-09-30, antes de implementar):** `playwright.config.ts` fija `baseURL`/`webServer.url` en `localhost:4200`, arranca `npm run dev`, puede reutilizar un servidor existente fuera de CI y no fija `DATABASE_PATH`; ese script levanta el proxy Angular hacia el backend habitual en `localhost:3000`, cuyo `app.config.ts` cae a `./data/hogaria.sqlite`. `playwright.full-stack.config.ts` también puede reutilizar un servidor y la única línea `DATABASE_PATH` de `webServer.env` está comentada. `tests/e2e/pwa-assets.spec.ts` fija `BASE = 'http://localhost:4200'` en lugar de respetar `E2E_BASE_URL`, por lo que ignora cualquier origen temporal provisto por el runner. El runner local bajo `%TEMP%` inspeccionado para esta auditoría sí genera puerto, SQLite, uploads/artefactos y semilla únicos, inyecta `DATABASE_PATH`, comprueba que la DB aislada se creó y limpia únicamente su propio directorio después de parar el servidor.

**Conducta esperada:** ninguna suite local de escritura debe adjuntarse a un dev server/Base de uso normal ni persistir su DB en el repositorio. Cada ejecución usa un origen/puertos y `DATABASE_PATH` exclusivos bajo el directorio temporal del sistema; todas las specs derivan sus peticiones del `E2E_BASE_URL` del runner. El cierre limpia solo recursos propios y conserva evidencia aislada de una corrida roja; la limitación de peticiones se deja explícita por tipo de suite.

**Fuente actual revalidada (2026-10-01):** ambos configs llaman a `validateIsolatedEnvironment` al cargarse y rechazan una invocación directa antes de lanzar navegador/servidor. `scripts/run-isolated-playwright.mjs` crea el directorio `hogaria-e2e-*` en `%TEMP%`, reserva puertos loopback no compartidos, genera semilla y SQLite sintéticas, arranca/paraliza únicamente sus procesos, confirma que los puertos propios cerraron y elimina el directorio solo tras una corrida verde. Los configs ya no administran `webServer`; `pwa-assets.spec.ts` usa `E2E_BASE_URL` y verifica que coincida con el origen del proyecto.

- [x] Añadir primero una regresión que demuestre que `pwa-assets.spec.ts` respeta `E2E_BASE_URL`; confirmar rojo en el runner aislado antes de cualquier petición del spec. La protección y evidencia están abajo.
- [x] Añadir regresiones para impedir que los configs resuelvan la SQLite por defecto o reutilicen servicios locales existentes; confirmar rechazo sin escribir en el servidor habitual.
- [x] Corregir los configs de desarrollo/full-stack y las URLs de las specs para que el servidor y el navegador compartan `E2E_BASE_URL`, puertos/DB temporales únicos y cleanup seguro; no ocultar ni limpiar archivos ajenos.
- [x] Ejecutar un smoke real de assets PWA y una interacción autenticada con escritura en Chromium + Pixel 5, verificar la ruta efectiva de `DATABASE_PATH`, cero peticiones a los puertos habituales y limpieza/retención esperadas.
- [x] Añadir tests unitarios de la selección/aislamiento de paths y comprobar cobertura focal ≥70 % en statements, ramas, funciones y líneas; build/typecheck y captura de consola/red.

**TDD rojo (2026-09-30):** la nueva aserción ejecutada desde el runner aislado recibió `E2E_BASE_URL=http://127.0.0.1:62230`, pero encontró `BASE=http://localhost:4200`; el `beforeAll` falló antes de pedir manifiesto/assets (un caso fallido, cinco omitidos). Un intento anterior sin esta aserción había dado 6/6, pero la fuente fija al puerto habitual hacía que esos resultados no probaran el servidor temporal; solo había peticiones GET de assets, no escrituras. `Test-NetConnection` confirmó que 4200 y 3000 respondían; no se detuvieron ni modificaron esos procesos.

**Corrección/evidencia de origen (2026-09-30):** `BASE` ahora prioriza `process.env.E2E_BASE_URL`. Con runner efímero que impone SQLite/puerto/semilla únicos y rate limit activo, `pwa-assets.spec.ts` pasa **6/6 Chromium** y **6/6 Pixel 5**; el hook compara el origen efectivo con el configurado y no realiza requests si no coinciden. Ambos runners confirmaron creación de `DATABASE_PATH` temporal y limpiaron su directorio al cerrar correctamente. En ese corte quedaban pendientes los configs root y full-stack; su aislamiento se completó y verificó al día siguiente, según la evidencia verde QA-E2E.1.

**Evidencia verde QA-E2E.1 (2026-10-01):** `server/tests/e2e-isolation.spec.ts` pasa **17/17** con umbrales focales explícitos; `e2e-isolation.mjs` alcanza **96.22 % statements, 95.65 % branches, 100 % functions y 96.15 % lines**. Los configs root y full-stack rechazan `playwright ... --list` sin el supervisor (`E2E_EXTERNAL_STACK`) antes de arrancar procesos; las regresiones cubren DB fuera del directorio propio, DB preexistente sin marcador del servidor de esta corrida, puerto habitual, origen LAN, puertos inválidos y puertos duplicados.

La suite PWA volvió a pasar **6/6 Chromium y 6/6 Pixel 5**; el alta autenticada de hogar pasó **1/1 en ambos proyectos** y verificó URL completa, copia/compartición y permisos con fixture sintética. La regresión visual combinada `receipt-queue-panel-layout.spec.ts` + `household-icon-consistency.spec.ts` pasó **5/5 Chromium y 5/5 Pixel 5** con limitador activo; el test de la cola registra `pageerror`, errores de consola del origen de la app y `requestfailed`, todos vacíos. El smoke full-stack servido pasó **4** y omitió **1** comprobación porque esta shell no enlaza manifiesto. Puertos usados en dev fueron efímeros `127.0.0.1`; cada runner confirmó cierre y eliminó su propia SQLite/artefactos; no se usaron los puertos compartidos 4200/3000 ni el proveedor externo.

**Comandos y rollback:** `node node_modules/vitest/vitest.mjs run tests/e2e-isolation.spec.ts --coverage --coverage.include=tests/support/e2e-isolation.mjs --coverage.thresholds.perFile=true --coverage.thresholds.statements=70 --coverage.thresholds.branches=70 --coverage.thresholds.functions=70 --coverage.thresholds.lines=70` (**17/17**); `node scripts/run-isolated-playwright.mjs --project=chromium tests/e2e/receipt-queue-panel-layout.spec.ts tests/e2e/household-icon-consistency.spec.ts` (**5/5**) y el mismo comando con `--project=mobile-chrome` (**5/5**); `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium tests/e2e/full-stack/served-app.spec.ts` (**4 pass, 1 skip**). Pasan `node node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`, `node node_modules/typescript/bin/tsc -p server/tsconfig.json --noEmit`, `node node_modules/typescript/bin/tsc -p server/tsconfig.json`, `node --check` sobre los dos scripts/helper, Prettier y `git diff --check`. Para revertir esta unidad sin afectar cambios previos de interfaz, restaurar `package.json`, `.github/workflows/ci.yml`, ambos configs Playwright, los dos supervisores, `server/src/index.ts`, `server/vitest.config.ts`, el helper/declaración/test nuevos, `tests/e2e/pwa-assets.spec.ts` y esta sección de spec; conservar `.e2e-screenshots/` (artefactos ignorados).

Capturas sintéticas inspeccionadas: PC ticket `.e2e-screenshots/qa-verify-20261001/recheck-desktop/receipt-queue-panel.png`; móvil 320×568 ticket `.e2e-screenshots/qa-verify-20261001/mobile/receipt-queue-panel-320x568.png` y Hogar `.e2e-screenshots/qa-verify-20261001/mobile/household-members-es-320x568.png`. Los artefactos de UI permanecen ignorados por Git.

## Unidad QA-BASE.1 · baseline de rutas autenticadas y públicas (resuelta)

**Fuente revalidada (2026-10-01):** `frontend/src/app/app.routes.ts` declara auth público (`/auth/login`, `/auth/register`, `/auth/forgot-password`), invitación, onboarding protegido y layout autenticado para dashboard, pantry, recipes, shopping, receipts, calendar, household, ai-config, logs, account, preferences y settings. Las rutas hijas/dinámicas se declaran en `features/*/*.routes.ts`; pantry añade caducidades, detalle/edición de ingrediente, categorías, productos y catálogo; shopping y receipts tienen detalle `:id`. `tests/e2e/helpers/auth.ts` registra usuarios sintéticos por semilla, puede crear hogar y saltar onboarding; el runner aislado QA-E2E.1 proporciona origen/SQLite temporales. Las specs presentes y enumeradas no equivalen por sí solas a una pantalla recorrida. La discrepancia de conteo del onboarding queda resuelta por precedencia temporal: §12C añade horarios y §12E confirma seis pasos; la interacción de utensilios contra la paridad de §8c se audita en QA-ONBOARDING.PANTRY-LINK.1. HOGARIA-SPEC §12aj decide ticket sin OCR (la IA devuelve JSON), en contraste con menciones OCR del overview/historial; prevalece la decisión específica y más reciente de §12aj.

**Conducta esperada:** levantar inventario desde rutas actuales; recorrer con navegador real las superficies públicas y las protegidas con un usuario sintético, registrar por ruta el resultado, `pageerror`, consola, solicitudes fallidas/HTTP del origen de la app y overflow respecto al viewport. Separar los bloqueos ambientales conocidos (p. ej., fonts externas sin red) de defectos de la app. Este baseline no afirma que todas las acciones/formularios estén probados: su cobertura funcional detallada permanece en la checklist por pantalla.

- [x] Crear el manifiesto reproducible de rutas públicas, onboarding, layout principal y rutas hijas/dinámicas desde la fuente actual; incluir acceso sin sesión a privada y al menos una ruta inválida de invitación.
- [x] Recorrer rutas de referencia en Chromium escritorio y Pixel 5 real emulado, con DB/semilla efímeras y captura de consola/red/errores de navegación; anotar y clasificar cada respuesta no-2xx antes de marcar verde.
- [x] Medir ausencia/presencia de overflow en 320×568, 393×851, 768×1024, 1024×768 y 1440×900 para las superficies baseline; guardar viewport y medidas por ruta, sin convertir ausencias de datos válidas en fallos.
- [x] Capturar e inspeccionar baseline sintético autenticado PC 1440×900 y móvil 320×568; guardar los artefactos ignorados por Git y verificar que no contienen PII, tokens ni secretos.
- [x] Typecheck y Playwright real pasan con un flujo autenticado que escribe solo en SQLite temporal; registrar fallos previos/ambientales por separado y mantener abiertas las suites de acciones detalladas.

**Primera pasada roja pre-fix (2026-10-01, QA-BASE sin cerrar):** `tests/e2e/route-baseline.spec.ts` recorrió 28 rutas en 5 viewports en Chromium escritorio y Pixel 5 (140 mediciones por proyecto), con usuario sintético y runner/SQLite aislados. En ambas ejecuciones hubo 0 `pageerror`, 0 componentes ausentes y 0 errores de navegación; el navegador generó 40/42 mensajes genéricos de recurso 404, mayormente duplicados de IDs inválidos intencionados que todavía no están clasificados. Se confirmó además un 404 **no esperado** en `/shopping`: `GET /api/shopping/stream/lists`. La vista llamaba `openStream('lists')`; el servicio añade `/stream/${path}` y el backend solo registra `/stream/tray` para la bandeja y `/stream/lists/:listId` para una lista concreta. Este hallazgo motivó QA-SHOP-LIVE.1, resuelta abajo; QA-BASE debe repetirse con el endpoint corregido.

La misma pasada midió en `/account` `documentElement.scrollWidth=383` para un viewport de 320 px (63 px de desbordamiento) en ambos proyectos. Se aislará el nodo/causa en la captura y pasa a QA-ACCOUNT-RESP.1. En Pixel 5 hubo una solicitud dev-only `GET /@ng/component` fallida con `ERR_NO_BUFFER_SPACE`, que requiere repetición en un stack de producción antes de clasificarla; 142 fallos a `fonts.googleapis.com` son limitación de red externa y no errores del origen de la app. El primer harness confundía los 404 genéricos del navegador con errores de consola, usaba la ruta activa al completar requests asíncronas y guardaba URLs completas (incluida la query SSE); antes de cerrar el baseline se corregirá la clasificación/atribución y se eliminarán query/hash/userinfo de toda evidencia.

**Evidencia verde QA-BASE.1 (2026-10-01):** después de corregir Compra y Cuenta, `tests/e2e/route-baseline.spec.ts` recorrió 28 rutas públicas/autenticadas, la redirección privada sin sesión y cinco viewports (320×568, 393×851, 768×1024, 1024×768, 1440×900): **140 mediciones por ejecución**. El runner creó proceso, puerto, semilla y SQLite efímeros; los casos de registro escriben únicamente en esa DB. Playwright aislado con rate limit desactivado solo en estos runs de baseline: **1/1 Chromium y 1/1 Pixel 5**; una repetición final con capturas volvió a dar **1/1 en ambos proyectos**. En los recorridos finales: `pageerror=0`, errores reales de consola del origen `0`, requests fallidos del origen `0`, errores de navegación `0`, componentes ausentes `0`, respuestas HTTP no-2xx inesperadas `0` y overflow `0`. Se observaron siete combinaciones distintas de pantalla+método+ruta+status para 404 sintéticos: seis rutas/métodos de fixture en la allowlist y el endpoint de producto inválido, que aparece tanto en detalle como en edición. Se registran todos los estados HTTP no-2xx; solo se acepta 304 para GET/HEAD de una ruta de asset estático reconocida por extensión o módulo del runtime Vite (`/@vite/`, `/@fs/`, `/@id/`), nunca para `/api`. No hubo redirects inesperados. `fonts.googleapis.com/css2` falla 142 veces por ejecución con `ERR_NETWORK_ACCESS_DENIED` (limitación externa del entorno). `GET /@ng/component` falló una vez con `ERR_NO_BUFFER_SPACE` en la primera pasada móvil y no reapareció en las dos siguientes; no se ejecutó una repetición en stack production, así que queda sin clasificación definitiva y no como fallo de código confirmado. Una repetición intermedia tuvo también un timeout aislado al visitar Hogar a 768×1024; no reapareció en las dos ejecuciones finales. En la captura de 320 px, algunas etiquetas de la navegación inferior se truncan con puntos suspensivos aunque no haya overflow; la línea base lo registra como observación pendiente, no como criterio aprobado de legibilidad.

El harness usa el `Referer` same-origin para asociar el request a la ruta origen (y recurre a la ruta de navegación declarada si falta), separa mensajes genéricos «Failed to load resource» de errores JS reales y prueba la redacción de URLs/credenciales/query/hash, rutas absolutas Vite `/@fs/`, bearer/provider tokens, refresh/client secrets, API keys y emails antes de agregar evidencia; los reportes no incluyen ruta de DB, semilla ni query SSE. `node node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit` y Prettier focal pasan. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-baseline-20261001/final-desktop/dashboard-chromium-1440x900.png` y `final-mobile/dashboard-mobile-chrome-320x568.png` (ignoradas por Git, sin datos personales). El barrido de viewport completo, formularios y acciones detalladas continúa en la matriz global; QA-BASE no demuestra esas interacciones.

### QA-SHOP-LIVE.1 · evento SSE de la bandeja de listas (resuelta)

**Fuente revalidada (2026-10-01):** `ShoppingListsComponent` se suscribe a `openStream('lists')`; `ShoppingService.openStream()` concatena `/api/shopping/stream/${path}` y el servidor ofrece `/api/shopping/stream/tray` para la bandeja y `/api/shopping/stream/lists/:listId` para un detalle. La pasada real de rutas autenticadas recibió 404 al pedir `/api/shopping/stream/lists`; el callback de refresco de cambios remotos no puede recibir `ready`/`change` desde esa URL.

- [x] Añadir primero pruebas unitarias de ruta de bandeja/detalle; el componente también demuestra que destruye la suscripción. El E2E recoge solo `pathname` y nunca inspecciona ni registra la query SSE.
- [x] Añadir regresión Playwright con usuario/lista sintéticos en SQLite temporal: abrir `/shopping`, recibir `ready` desde `/stream/tray`, confirmar status/content-type correcto y payload, validar `/stream/lists/:id` en el detalle y no observar reintentos tras navegación.
- [x] Corregir solo el destino de la bandeja, preservando el endpoint concreto del detalle; tipar los dos destinos válidos en `ShoppingService` para impedir que vuelva a compilar `/stream/lists` sin `:id`.
- [x] Coverage del helper nuevo 100/100/100/100 % (statements/branches/functions/lines), mantener los gates y ejecutar Karma, Playwright Chromium + Pixel 5, typecheck/build.

**TDD/evidencia verde (2026-10-01):** antes del arreglo, la prueba unitaria del componente falló porque llamaba `openStream('lists')` en vez de `'tray'`. Se extrajo `shoppingStreamPath()` como única fuente tipada del contrato: `null → tray`, ID concreto → `lists/:id`; ambos casos pasan Karma **2/2** con cobertura focal **100/100/100/100 %**. La unidad de constructor verifica que la bandeja abre `'tray'` y cierra la suscripción al destruirse (**1/1**). `tests/e2e/full-stack/request-budget.spec.ts` con producción, rate limit activo, navegador real, usuario/lista sintéticos y SQLite/puerto efímeros verifica evento `ready`, status **200**, `text/event-stream`, carga útil, stream de detalle y ausencia de reintentos: **2/2 Chromium** y **2/2 Pixel 5**. `tsc -p tsconfig.e2e.json --noEmit` y build production pasan; build conserva warnings previos de presupuesto/imports sin uso. Sin captura visual nueva porque no cambia el diseño ni hay datos personales.

### QA-SHOP-MOBILE.CTA.1 · selectores de acciones adaptados al viewport (resuelta)

**Fuente revalidada (2026-10-01):** `shopping-lists.component.ts` ofrece `data-test="new-list"` para escritorio y `data-test="new-list-text"` para ≤600 px; `MainLayoutComponent` usa bottom-nav por debajo de 1024 px. Las pruebas de compra deben elegir el control visible y navegar por el enlace visible, sin `force` ni enlaces del sidebar fuera del viewport.

- [x] Ejecutar y clasificar la baseline aislada de `shopping-lists`, `shopping-round6` y `shopping-round10`: **45 passed, 4 skipped, 19 failed**; los 19 rojos eran solo Pixel 5 y todos apuntaban a CTA/sidebar de escritorio ocultos.
- [x] Centralizar creación/navegación en `tests/e2e/helpers/shopping-ui.ts`, seleccionando solo controles visibles y el bottom-nav bajo 1024 px. TDD mostró después otro enlace directo de sidebar en `full-stack/shopping-money.spec.ts`; se corrigió al usar el mismo helper.
- [x] Reejecutar Chromium + Pixel 5: suites core **64 passed, 4 skipped**; `account`, `round12`, `shopping-ai-recovery` y `shopping-sugerencias` en Pixel 5 **12 passed**; Playwright full-stack producción `shopping-money.spec.ts` **6 passed** y `request-budget.spec.ts` **4 passed**. SQLite/puertos de los runs aislados bajo `%TEMP%` y temporales eliminados.
- [x] Revisar capturas sintéticas existentes de Compra desktop/móvil (`.e2e-screenshots/shopping-final-desktop/shopping-tray-1440x900.png`, `.e2e-screenshots/shopping-final-mobile-verified/shopping-tray-393x851.png` y `shopping-tray-320x568.png`). Typecheck E2E y `git diff --check` pasan; `check-ui` no detecta cambios de UI. Rollback: revertir el helper y las sustituciones de selectores/navegación en las suites listadas.

**Límite de la evidencia:** se validan las suites que consumen los selectores corregidos; no se declara completa la auditoría de `/shopping` ni la de todas las rutas.

### QA-ACCOUNT.E2E-TARGETS.1 · interacciones de Cuenta dirigidas a controles visibles (resuelta)

**Fuente revalidada (2026-10-01):** antes de 1024 px la entrada a `/account` visible es `.header__profile`; `.sidebar__account-main` queda fuera del viewport. El test de historial debe abrir primero `data-test="list-row"`, las indicaciones de avatar dependen de `matchMedia('(hover: hover)')`, y `app-button` aplica `disabled` al `<button>` nativo, no al host Angular.

- [x] Capturar baseline aislada en Pixel 5 para `account`, `round12`, `shopping-ai-recovery` y `shopping-sugerencias`: **8 passed, 4 failed**; los cuatro rojos eran targets/expectativas E2E de Cuenta desactualizados.
- [x] Corregir el acceso a Cuenta y la navegación lista→detalle, ajustar hover/tacto y consultar enabled/disabled del botón accesible real; sustituir el PNG 1×1 por fixture sintética 256×192 para demostrar zoom.
- [x] Validar `account.spec.ts` en Chromium + Pixel 5 (**10 passed**) y la ejecución conjunta de Cuenta + `round12`, `shopping-ai-recovery` y `shopping-sugerencias` en Pixel 5 (**12 passed**); no se usa `force`.
- [x] Typecheck E2E (`node ./node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`), `git diff --check` y capturas sintéticas desktop/móvil inspeccionadas en `.e2e-screenshots/qa-account-tabs-20261001/` y `.e2e-screenshots/qa-account-password-20261001/`.

**Hallazgo durante TDD (2026-10-01):** tras corregir targets aparecieron tres problemas independientes: discrepancia de copy «Información», fixture avatar sin resolución útil y pérdida del motivo de contraseña; no se rebajaron expectativas y cada causa quedó separada en las unidades siguientes.

### QA-ACCOUNT.TABS.1 · etiqueta de pestaña Información (resuelta)

**Fuente revalidada (2026-10-01):** el contrato vigente de Cuenta en `HOGARIA-SPEC.md` §12l nombra la tercera pestaña **Información**; la clave ES omitía la tilde.

- [x] Reproducir la discrepancia en Playwright aislado de `/account`, sin escribir contra la base normal.
- [x] Corregir a «Información» sin alterar la clave ni la traducción EN; comprobar navegación, query `tab` y persistencia tras recarga en Chromium + Pixel 5. Capturas PC/móvil muestran la etiqueta completa.

### QA-ACCOUNT.PASSWORD.ERROR.1 · error de contraseña actual visible y específico (resuelta)

**Fuente revalidada (2026-10-01):** el contrato de `HOGARIA-SPEC.md` §12l cubre reglas y edición de contraseña; el servidor devuelve HTTP 400 con `Current password is incorrect`. El interceptor compartido envuelve la respuesta en `{ status, message, original }`, pero Cuenta consultaba el cuerpo equivocado. La captura reveló además que el toast global repetía el error técnico en inglés aunque la pantalla ya tenía un alert propio.

- [x] Reproducir ambos defectos: unidad del helper roja antes de implementarlo; E2E muestra mensaje genérico/alert y toast crudo duplicado. Una prueba de contexto del servicio también falla antes del arreglo (`SILENT_TOAST=false`).
- [x] Añadir tests unitarios para `original.error.message`, `HttpErrorResponse` directa y fallback; coverage focal del helper **100/100/100/100 %**. `AuthService` queda en **96/100 statements, 18/22 branches (81,81 %), 34/37 functions (91,89 %), 93/95 lines (97,89 %)**; no se rebajan los thresholds globales.
- [x] Mapear contraseña actual incorrecta a copy localizado, limpiar el error previo al reintentar y marcar solo el cambio de contraseña `SILENT_TOAST`; error accesible inline, sin toast duplicado. Tests cubren actual errónea/correcta, reglas, loading, Cancelar, vaciado de campos y que el error no cambia la credencial.
- [x] Comprobar el route test del servidor (`auth.routes.spec.ts`, SQLite `:memory:`) **13/13**; el E2E real Chromium + Pixel 5 verifica HTTP 400/mensaje, no persistencia; cambio exitoso HTTP 200, credencial anterior 401/nueva 200 y no toast raw. Suite Cuenta PC+Pixel **10 passed**; repetición del flujo de contraseña con capturas **2 passed**.
- [x] Typecheck E2E, `check-ui` (**182 ficheros, 20 reglas**), Prettier y `git diff --check` pasan. Capturas sintéticas de estado de error revisadas: `.e2e-screenshots/qa-account-password-20261001/account-password-error-chromium.png` y `account-password-error-mobile-chrome.png`.

**Límite de cobertura global:** el gate existente de Karma es 80 %; una pasada focal de `auth.service.spec.ts` ejecutó **26/26** pero el total instrumentado no vinculado al scope dio **43,09/12,44/36/46,33 %** (statements/branches/functions/lines), por lo que ese gate global sigue abierto y no se ha rebajado. La cobertura por archivo de `AuthService` y del helper nuevo supera el mínimo del scope.

**Rollback:** revertir conjuntamente `account-password-error.ts/spec`, el mapeo de `AccountComponent`, el `SILENT_TOAST` limitado a `AuthService.changePassword`, sus tests, el escenario E2E y las expectativas de `auth.routes.spec.ts`; no es necesario revertir el interceptor compartido.

### QA-ACCOUNT-RESP.1 · desbordamiento de Cuenta a 320 px (resuelta)

**Fuente revalidada (2026-10-01):** `/account` monta `AccountComponent`; `.account__tabs` era `display:flex` sin wrapping, y la hoja ya tiene breakpoint a 560 px. El baseline real midió 63 px de overflow de documento en 320×568; el nodo era el tercer `button.tab` (132 px, x=251…383), que desplaza el ancho de documento a 383 px. Capturas sintéticas anteriores a la corrección: `.e2e-screenshots/qa-account-responsive-20261001/baseline-desktop/account-1440x900.png` y `baseline-mobile/account-320x568.png`.

- [x] Añadir regresión Playwright que mide `scrollWidth` y rectángulos reales, identifica el último tab y reproduce el rojo en Chromium/Pixel 5 a 320×568.
- [x] Comprobar las pestañas `account`, `security` e `info`, nombre de 100 caracteres sin guardar, activación por Enter/foco y scrollWidth en 320×568, 393×851, 559/560/561 px y orientaciones 568×320/844×390.
- [x] Aplicar `flex-wrap: wrap` solo dentro del breakpoint móvil existente (≤560 px); las pestañas quedan dentro del viewport y la fila de 1440 px no cambia.
- [x] Verificar los E2E reales con Chromium y Pixel 5 (**1/1 cada uno**), typecheck/build y capturas sintéticas desktop/móvil inspeccionadas. Es una corrección CSS pura, sin nuevas sentencias/ramas/funciones TypeScript; coverage de lógica nueva no aplica y no se alteraron los gates.

**TDD rojo (2026-10-01):** E2E aislado en producción mostró `document.scrollWidth=383` en viewport320 y registró `button.tab` a x=251…383; la captura móvil deja «Información» recortada. El mismo nodo/overflow se reprodujo en Chromium de escritorio y Pixel 5. No se escribieron datos fuera de la SQLite sintética.

**Evidencia verde:** `account-responsive.spec.ts` recorre 21 combinaciones de viewport/estado por proyecto; ambas ejecuciones dan **1/1** y cero errores `pageerror`. Playwright full-stack con `E2E_RATE_LIMIT=on`, SQLite y puerto efímeros; build production y `tsc -p tsconfig.e2e.json --noEmit` pasan. Capturas finales inspeccionadas: `.e2e-screenshots/qa-account-responsive-20261001/final-desktop/account-1440x900.png` y `final-mobile/account-320x568.png`; el tab se mueve a una segunda fila en 320 px y no se corta. No hubo cambios de HTML/comportamiento ni datos personales.

### QA-ACCOUNT.DRAFT.1 · conservar una edición de nombre durante PATCH (resuelta)

**Fuente revalidada (2026-10-01):** `/account` deja habilitado el campo `account-name` mientras `PATCH /api/auth/profile` está pendiente. `saveName()` captura el valor recortado al enviar; al recibir la respuesta siempre pone `nameTouched=false`. El `effect` de `AccountComponent` observa `currentUserSignal` y, al no haber ya un campo marcado como tocado, sincroniza el nombre enviado en `nameDraft`. La prueba actual de `tests/e2e/account.spec.ts` cubre renombrar sin latencia, no editar de nuevo durante el vuelo. `HOGARIA-SPEC.md` §7 requiere que la pantalla refleje el usuario de sesión y el formulario da al usuario un campo editable; la expectativa de esta unidad es no descartar una edición posterior que aún no se guardó.

**Conducta esperada:** el PATCH guarda el snapshot que se envió, pero cualquier texto que se escriba después permanece como borrador y se puede guardar o cancelar después. La respuesta actualiza el nombre de sesión/menú con el valor confirmado por el servidor. Un fallo conserva el último borrador y permite reintentar; una respuesta sin ediciones concurrentes sigue sincronizando el valor canónico del servidor.

- [x] Añadir primero una regresión Playwright determinista: retener la respuesta del PATCH mediante promesas/señales, editar el campo mientras vuela y comprobar que el borrador posterior sobrevive. Sin `waitForTimeout` ni datos compartidos; usar el runner SQLite aislado.
- [x] Probar éxito concurrente, error y reintento, guardar posterior, cancelar y respuesta normal sin edición con espacios externos; comprobar que el PATCH lleva el nombre recortado, el campo sincroniza el valor confirmado, y estado del botón/toast, nombre del menú y texto accesible del error.
- [x] Añadir regresión unitaria para la decisión de conservar/sincronizar el borrador, con ≥70 % de coverage en statements, branches, functions y lines del alcance sin reducir gates globales.
- [x] Ejecutar Playwright real Chromium escritorio + Pixel 5 a 1440×900, 393×851, 320×568 y paisaje 568×320; comprobar foco/teclado, errores de página y overflow; guardar e inspeccionar capturas PC/móvil con fixtures sintéticas.
- [x] Registrar red/green TDD, comandos/resultados, typecheck/build, gates de cobertura, capturas ignoradas por Git y rollback.

**TDD rojo (2026-10-01):** `tests/e2e/account-name-draft.spec.ts` retuvo el PATCH tras recibir la respuesta real del servidor y editó el campo antes de liberarla. Chromium falló como se esperaba: valor esperado `Bea`, valor recibido `Ana Belen`. El arnés confirmó que la solicitud ya se había aplicado a la SQLite temporal; el fallo estaba en la sincronización del borrador del cliente, no en el servidor.

**Implementación:** la decisión de mantener sincronizado el campo ahora usa la misma comparación normalizada que `nameDirty()`: si el borrador actual aún difiere del usuario actualizado por la respuesta, permanece tocado y no se pisa; si coincide, se permite resincronizar el valor canónico. El error local del nombre ahora queda enlazado mediante `aria-describedby` y se anuncia como `role="alert"`; el formulario conserva el borrador y permite reintentar.

**Evidencia verde inicial y revalidación (2026-10-01):** Comando E2E desde la raíz: `$env:E2E_RATE_LIMIT='off'; $env:E2E_CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/account-name-draft.spec.ts` → primero **10/10** (**5 Chromium + 5 Pixel 5**), ahora **12/12** (**6 Chromium + 6 Pixel 5**), con runner/puerto/SQLite/semilla temporales. Además del éxito concurrente, error HTTP 500, retry 200, cancelar, teclado y errores JS **0**, la nueva prueba introduce `' Ana Belen '` y comprueba el body real del PATCH (`Ana Belen`), respuesta 200, menú y campo sincronizados a `Ana Belen`, botón deshabilitado y cancelación oculta. Los cuatro viewports de carrera no desbordan: 1440×900, 393×851, 320×568 y 568×320. Comando unitario desde `frontend`: `node ../node_modules/@angular/cli/bin/ng.js test --no-watch --code-coverage --include=src/app/features/account/account-name-draft.spec.ts --browsers=ChromeHeadless` → **3/3**; `account-name-draft.ts` **100 % statements/branches/functions/lines** (branches 0/0). `node ./node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`, Prettier focal y `git diff --check` pasan; build de producción de la unidad inicial pasó con warnings existentes de budgets. No se redujo el gate global frontend de 80 %.

**Capturas sintéticas inspeccionadas:** `.e2e-screenshots/qa-account-name-draft/chromium/name-draft-1440x900.png`, `.e2e-screenshots/qa-account-name-draft/mobile-chrome/name-draft-320x568.png` y `name-draft-568x320.png` (ignoradas por Git). Rollback de esta revalidación: revertir su commit elimina solo la regresión E2E de normalización y sus correcciones de descripción/evidencia; el fix de concurrencia permanece. Rollback de la implementación inicial: revertir la unidad atómica de Cuenta restaura `account.component.ts` y elimina `account-name-draft.ts`, sus pruebas y esta sección E2E/spec, sin tocar unidades ajenas.

### QA-ACCOUNT.AVATAR-RETRY.1 · error de subida visible y reintentable (resuelta)

**Fuente revalidada (2026-10-08):** `AccountComponent.onPhotoPicked()` valida tipo y 4 MiB antes de entrar al recorte; `onCropped()` conserva el editor al fallar y prepara `photoError()` para que se pueda reintentar. El template solo mostraba ese error en la vista de selección; por ello, un HTTP 500 dejaba el modal en el recorte, sin aviso inline accesible aunque el borrador de imagen siguiera disponible.

**Conducta esperada:** formatos no admitidos y archivos vacíos/demasiado grandes se rechazan localmente; si falla la subida, el aviso accesible aparece en el paso de recorte, se conserva el encuadre y el usuario puede reintentar o cancelar. Un segundo envío exitoso persiste y permite quitar el avatar.

- [x] Añadir primero E2E de error + retry: el baseline Chromium y Pixel 5 falla en el aviso ausente tras HTTP 500; usar runner aislado, sin tocar servidor/datos normales ni invocar IA/proveedores.
- [x] Anunciar los errores de avatar mediante `role="alert"` tanto en selección como en recorte, manteniendo el fichero/encuadre y los controles existentes.
- [x] Probar SVG y JPEG >4 MiB sin abrir recorte ni enviar POST; PNG sintético aceptado; primera subida HTTP 500 con alerta visible y recorte conservado; retry HTTP 200, persistencia tras recarga y quitar foto.
- [x] Medir alerta/modal en 320×568, 393×851, 559/560/561×568, 568×320 y 1023/1024/1025×768 en Chromium + Pixel 5: alerta desplazable dentro del modal, `scrollWidth` sin desbordar y `pageerror` vacío. Capturar e inspeccionar baseline y error PC/móvil.
- [x] Revalidar nombre concurrente, límites bcrypt, pestañas/URL, contraseña/cancelación, logout e información en E2E real; comprobar typecheck, `check-ui`, Prettier, Karma focal y build de producción. Sin ramas/funciones nuevas de TypeScript; el cambio de producción solo muestra el estado del template.

**TDD rojo y corrección:** la primera ejecución aislada mostró el error reproducible en Chromium y Pixel 5: falta `[data-test="account-photo-error"]` después del 500 (2/2 rojos), aunque `photoError()` ya estaba guardado. El cambio mínimo pinta esa señal en la rama de recorte y hace que el error de selección también sea un alert.

**Evidencia verde (2026-10-08):** `account.spec.ts`, `account-name-draft.spec.ts` y `auth-password-byte-limit.spec.ts`, runner aislado con `E2E_RATE_LIMIT=on`, SQLite/puertos/semillas temporales y cleanup: **30/30** en Chromium + Pixel 5; tras añadir la matriz del estado de error, la prueba focal final da **2/2** con nueve tamaños/orientaciones por proyecto, sin overflow ni `pageerror`. `tests/e2e/full-stack/account-responsive.spec.ts` contra build de producción y limitador activo: **2/2**, 21 combinaciones de viewport/estado por proyecto; Karma `avatar-image.spec.ts`: **4/4**. `typecheck:e2e`, `check-ui` (**208 ficheros/21 reglas**), Prettier focal, `git diff --check` y build pasan. No se bajó el gate frontend global existente.

**Capturas sintéticas comparables, inspeccionadas e ignoradas por Git:** baseline Cuenta `.e2e-screenshots/qa-account-route-c50c625a24df4348b1ee0ff9582ea832/final-desktop/account-1440x900.png` y `final-mobile/account-320x568.png`; estado del editor/error `.e2e-screenshots/qa-account-avatar-matrix-7e5e21610c614ca18b8c9b3f224dce94/account-avatar-{editor,upload-error}-{chromium,mobile-chrome}.png`. Se verificó `.gitignore`. Rollback: revertir el commit atómico de QA-ACCOUNT.AVATAR-RETRY.1 elimina el alert en recorte, la regresión E2E y el ajuste para dirigir capturas a carpeta de ejecución; no revierte avatar/crop ni cambios previos de Cuenta.

## Unidad QA-PANTRY.1 · alta manual accesible en móvil (resuelta)

**Fuente revalidada antes de implementar:** el comentario y `(onClick)="openAddModal()"` de `PantryComponent` definen «+ Agregar» como la acción que abre el modal de alta de la pestaña activa. `.pantry__header` distribuye título y `.pantry__header-acciones` con `flex`, pero la fila de acciones no declara `flex-wrap` ni un reflujo móvil; hay breakpoints cercanos en 480, 600, 768 y 1023 px que deben volver a comprobarse antes de tocar estilos. En Playwright Pixel 5, la prueba existente de Dashboard expiró al pulsar «+ Agregar»; el registro muestra interceptación alternada por `pantry-anadir-catalogo` y el botón de la cola de tickets en `header`. La captura sintética del fallo muestra la fila superior cortada/desplazada. Esto acredita un fallo de interacción real, pero todavía hay que medir límites y solapamientos en viewport, no inferir su geometría solo por la captura.

**Conducta esperada:** los tres controles de acción del encabezado permanecen visibles, no se superponen y son activables por toque/teclado; «+ Agregar» abre el alta de la pestaña activa. A 320 px debe ser posible operar sin overflow horizontal ni un control vecino capturando el puntero.

- [x] Crear pruebas unitarias de los dos destinos del CTA (ingredientes/utensilios) y Playwright de regresión que mida rectángulo/área, overflow del documento y elemento que recibe el puntero; reproducir la obstrucción sin `force`, con fixtures sintéticas y DB aislada.
- [x] Medir Chromium escritorio y Pixel 5 en 320×568, 393×851, 479/480/481, 599/600/601, 767/768/769, 1022/1023/1024 y orientación horizontal 568×320/844×390. Confirmar acciones dentro del viewport, hit testing real y objetivos ≥44×44 px.
- [x] Refluir solo el encabezado a ≤600 px y permitir que la fila de acciones envuelva; añadir el objetivo táctil opcional de 44 px a `app-button`. Verificar modal correcto por pestaña, activación Enter, destinos de caducidades/catálogo y ausencia de clicks interceptados.
- [x] Ejecutar prueba unitaria focal, E2E real Chromium/Pixel 5, build/typecheck y cobertura de las unidades de lógica tocadas ≥70 % en las cuatro métricas; conservar gates superiores existentes. Capturar e inspeccionar PC 1440×900 y móvil 393×851/320×568.
- [x] Repetir la suite Dashboard en ambos proyectos: 7/7 Chromium y 7/7 Pixel 5. No atribuir los demás hallazgos globales a esta unidad.

**TDD rojo (2026-09-30, sin cambio de producción):** Pixel 5 reveló ancho de documento 517 px a viewport 320 px y botones de 32 px de alto; `+ Agregar` falló un click real de 5 s porque el catálogo/cola recibían el puntero. El baseline de `pantry-header-actions.spec.ts` conserva capturas en `.e2e-screenshots/qa-pantry-1/baseline-mobile/`.

**Evidencia verde (2026-09-30):** Karma enfocado Button + Pantry 18/18; coverage HTML de `ButtonComponent` 100/100/100/100 (statements/branches/functions/lines). `PantryComponent.openAddModal()` cubre ambos destinos y las dos salidas de `prefill` (todos sus statements/branches/functions/lines ejecutados); el agregado de Karma de toda la app no representa el alcance y el gate global continúa abierto en QA-04c. Build Angular producción pasó con warnings de presupuesto/imports anotados; `tsc -p tsconfig.e2e.json --noEmit`, Prettier de los tests y `git diff --check` pasan.

Playwright real con `E2E_SCOPE=all`, rate limit activo, servidor de producción efímero, puerto/SQLite/semilla únicos y cleanup: `pantry-header-actions.spec.ts` Chromium 2/2 y Pixel 5 2/2. Pixel 5 recorrió 320×568, 393×851, límites 479/480/481, 599/600/601, 767/768/769, 1022/1023/1024, 568×320 y 844×390; Chromium recorrió 1440×900 y 1022/1023/1024. Sin overflow, solapamiento, acción fuera de viewport ni interceptación; errores JS = 0. Suite Dashboard combinada (`dashboard.spec.ts`, `dashboard-recipe-links.spec.ts`, `dashboard-today-meals.spec.ts`) 7/7 en Chromium y 7/7 en Pixel 5. Capturas inspeccionadas: `.e2e-screenshots/qa-pantry-1/final-desktop/pantry-header-1440x900.png`, `.e2e-screenshots/qa-pantry-1/final-mobile/pantry-header-{393x851,320x568}.png`.

## Unidad QA-PANTRY.2 · distinguir error de carga de despensa vacía (resuelta)

**Fuente revalidada (2026-10-01):** el contrato activo `HOGARIA-SPEC.md` §12ak describe `/pantry/caducidades` como resumen, gráfica y tabla ordenable; el botón vuelve a `/pantry`. No define filtros ni enlace a una ficha de producto, así que se excluyen de esta unidad. En `PantryService.loadCaducidades()`, cualquier error del `GET /api/pantry/expiry` se convierte hoy en `[]`; `CaducidadesComponent` usa `filas().length === 0` para pintar el estado válido «sin caducidades». Por tanto un 503/red caída se presenta como inventario vacío. La E2E existente cubre datos poblados y el error de estimación IA, no el error de carga, el vacío del GET ni el reintento.

**Conducta esperada:** mantener diferenciados loading, éxito vacío y error de transporte/servidor. El error debe mostrar un mensaje accesible y una acción de reintento; no anunciar «sin caducidades». Un reintento exitoso debe limpiar el error y renderizar la respuesta real; uno que falle debe terminar loading y permitir reintentar. La lectura no escribe datos ni llama al proveedor IA.

- [x] Escribir primero pruebas unitarias para GET 200 vacío, error 503, reintento 503→200, limpieza de estado y loading terminado en éxito/error.
- [x] Escribir primero la E2E que intercepta únicamente `/api/pantry/expiry`: 503 no muestra el vacío; botón de reintento operable por teclado vuelve a solicitarlo; 200 sintético pinta la tabla. Añadir el caso 200 con `data: []` que sí pinta el vacío.
- [x] Aplicar el estado mínimo en service/componente, mensaje ES/EN y supresión de toast genérico duplicado si la pantalla muestra su propio error; revisar nombres accesibles y no permitir envíos duplicados durante loading.
- [x] Ejecutar cobertura focal (statements/branches/functions/lines ≥80 % para la lógica tocada, sin rebajar gates), typecheck/build y Playwright real aislado en Chromium y Pixel 5; comprobar 320×568, 393×851 y escritorio, teclado, overflow y capturas PC/móvil.

**Discrepancia deliberadamente acotada:** el checklist anterior mencionaba filtros y volver «a la ficha»; no se implementarán por inferencia. Reabrirlo solo si el contrato de producto activo se modifica explícitamente.

**TDD y evidencia verde (2026-10-01):** primero quedó reproducido en Playwright que un GET `/api/pantry/expiry` 503 mostraba «La despensa está vacía»; la nueva prueba del service también se añadió antes del cambio. `PantryService` ahora mantiene separado error/loading/datos previos, valida que `data` sea un array, suprime el toast genérico duplicado y deja reintentar; la pantalla presenta un `role="alert"` con acción ES/EN de 44×44 px, sustituida por loading mientras solicita. Los errores repetidos terminan loading y permiten nuevo reintento. La lectura sigue sin escribir datos ni llamar al proveedor IA.

`pantry.service.spec.ts`: Karma focal **5/5**; coverage de `loadCaducidades()` **100 % statements / 100 % branches / 100 % functions / 100 % lines**. El reporte agregado de esa selección pequeña queda por debajo del gate global existente de **80 %** (19.16 / 0.68 / 3.42 / 21.53 %); Karma por ello devuelve fallo en el gate global, no en los cinco tests ni en el método medido. No se rebajó el gate: resolver el agregado global sigue en QA-04c. Playwright real aislado (`E2E_RATE_LIMIT=on`, SQLite/puerto/semilla temporales, Google Chrome del sistema): `pantry-caducidades.spec.ts` Chromium **4/4**, Pixel 5 **4/4**. Se validaron 503/error sin falso vacío ni toast duplicado, reintento con Enter y respuesta 200, loading y cantidad exacta de peticiones, 200 vacío legítimo, texto inglés, orden/precio, viewport escritorio 1440×900 y móvil 320×740/393×851 sin overflow y botón táctil dentro del viewport. Fixtures interceptan únicamente el endpoint de caducidades; no se usó el proveedor ni la base normal de `localhost:4200`.

Typecheck `tsc -p tsconfig.e2e.json --noEmit`, build production a `%TEMP%`, Prettier focal y `git diff --check`: pasan. El build conserva avisos previos de bundle (697.57 KB frente al presupuesto de aviso de 500 KB), estilos e imports; no se alteraron budgets. Capturas sintéticas PC/móvil inspeccionadas: `.e2e-screenshots/qa-pantry-2/current/desktop/expiry-load-error-chromium-1440x900.png`, `.e2e-screenshots/qa-pantry-2/current/mobile/expiry-load-error-mobile-chrome-320x740.png` y `.../expiry-load-error-mobile-chrome-393x851.png`. Rollback: revertir el commit atómico de QA-PANTRY.2.

### QA-PANTRY.EXPIRY.ROUTE.1 · cerrar ordenamientos y retorno de caducidades (resuelta localmente)

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §12ak.E exige ordenar la tabla por urgencia/caducidad, producto y duración del stock; la pantalla también ofrece un enlace localizado «Volver al inventario». `CaducidadesComponent` implementa los tres comparadores y la ruta del enlace, pero `pantry-caducidades.spec.ts` solo había demostrado el orden inicial por urgencia y toggle de nombre; ningún E2E ejercitaba duración ni el retorno. El estado vacío y el 503 con retry ya se cubren en QA-PANTRY.2 y no se duplican aquí.

**Alcance:** cerrar la evidencia E2E de `/pantry/caducidades` sin cambiar producción ni inventar filtros/ficha de producto.

- [x] Añadir una E2E con filas sintéticas que compruebe el orden inicial y los botones accesibles de caducidad, nombre y duración; probar el retorno por el enlace a `/pantry`.
- [x] Ejecutar la ruta en Chromium escritorio y Pixel 5 móvil, comprobar los rectángulos sin overflow y guardar/revisar capturas sintéticas.
- [x] Repetir typecheck E2E, Prettier, build y `git diff --check`; marcar la fila `/pantry/caducidades` del barrido global solo tras evidencia final.

**Baseline (2026-10-08):** antes de ampliar las aserciones, el `pantry-caducidades.spec.ts` existente pasó **8/8** en Chromium y Pixel 5 con el runner aislado; el faltante es solo cobertura de orden por duración y navegación de retorno, no un fallo de producción reproducido.

**Evidencia final QA-PANTRY.EXPIRY.ROUTE.1 (2026-10-08):** `pantry-caducidades.spec.ts` pasa **10/10** en Chromium y Pixel 5 con rate limit activo y runner de SQLite/puerto/semilla temporal; el fixture poblado existente verifica caducado, próximo, catálogo y sin datos de vida; también se cubren lista vacía, 503/reintento de QA-PANTRY.2, orden por urgencia y por cada columna con nombres accesibles, activación de caducidad con Enter y vuelta a `/pantry`. La nueva respuesta de ordenamiento es sintética y solo intercepta `GET /api/pantry/expiry`; los demás casos usan los datos propios del runner. A 1440×900 y 393×851 se comprobó `scrollWidth ≤ viewport`, no hubo `pageerror`, y se inspeccionaron las capturas ignoradas por Git `.e2e-screenshots/qa-pantry-expiry-route-20261008-verified/chromium/expiry-route-1440x900.png` y `.../mobile-chrome/expiry-route-393x851.png`. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 ficheros/21 reglas/sin incidencias), Prettier focal, `pnpm run build:client` y `git diff --check`; el build mantiene los avisos preexistentes de budgets e imports no usados. Coverage focal N/A: no cambió lógica de producción. Rollback: quitar el test añadido en `tests/e2e/pantry-caducidades.spec.ts`, esta unidad y la casilla `/pantry/caducidades` del barrido, sin revertir QA-PANTRY.2 ni producto.

### QA-PANTRY.ITEM.ROUTE.1 · ficha del producto y edición (resuelta localmente)

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §12ai.A–E define la ficha de detalle con atributos, aliases e impacto; la pestaña de precios con historial, gráfico y baja confirmada; y una ruta de edición propia que guarda nombre/categoría/unidad/ubicación/caducidad/código/nota/aliases sin tocar stock. El 404 de API tiene `PANTRY_PRODUCT_NOT_FOUND`, y el PATCH usa `PANTRY_PRODUCT_ALIAS_CLASH` para explicar colisiones. `PantryItemComponent`, `PantryItemEditComponent` y `PantryService` implementan los flujos, pero el E2E existente no cubría 404, las dos decisiones al salir sin guardar ni aliases, y la actualización de todos los campos editables.

- [x] Verificar atributos del detalle —incluidos ubicación, caducidad, código de barras y alias— y error 404 con vuelta al inventario; persistencia de los cambios editables sin alterar el stock.
- [x] Ejercitar navegación de la pestaña por URL, precios por tienda/gráfico, historial completo y eliminación de observación tras confirmación.
- [x] Comprobar la edición dedicada en escritorio/móvil: campos editables, guardado con retorno, cancelación que conserva cambios al rechazar y los descarta al confirmar, 404 y choque de alias localizado.
- [x] Revalidar errores de runtime/overflow, controles y límites responsive, capturas comparables y coverage del servicio por encima de 70 % en las cuatro métricas.
- [x] Ejecutar suite frontend completa, `typecheck:e2e`, `check:ui`, build de cliente, Prettier y `git diff --check`.

**TDD y hallazgo:** el E2E previo usaba el host Angular `[data-test="editar-guardar"]` como objetivo de toque; en móvil el centro del host no era el botón nativo y por eso no generaba el submit ni un `PATCH`. El test ahora pulsa el botón accesible real y también comprueba guardado con Enter. Al provocar una colisión real, el server devolvió 409/`PANTRY_PRODUCT_ALIAS_CLASH`, pero `PantryService.request` interpretaba la envoltura del interceptor `{ status, message, original }` como error de red; la pantalla mostraba «Error de red». Se añadió una regresión roja y la normalización mediante `originalHttpError`, que conserva status, código, mensaje y `details`; la edición presenta el texto localizado «Ese alias ya es el nombre de otro producto de esta casa».

**Evidencia (2026-10-08):** `tests/e2e/pantry-item.spec.ts` pasa **12/12** (6 casos × Chromium y Pixel 5), con servidor/SQLite/puertos/usuarios aislados, rate limit activo y datos sintéticos; no se llamó a IA. Comprueba páginaerror=0; 404 en detalle/edición; atributos/alias; precios por tienda, SVG, historial y confirmación; todos los campos editables y persistencia; ambos resultados de la confirmación al cancelar; error 409; desbordamiento y límites 641/640, 320×568 y 568×320. Capturas PC 1440×900 y móvil 393×851 inspeccionadas, sintéticas e ignoradas por Git: `.e2e-screenshots/qa-pantry-item-route-20261008/{chromium,mobile-chrome}/{detalle,edicion}-{1440x900,393x851}.png` (cada proyecto conserva su tamaño correspondiente). `pantry.service.spec.ts` pasó **35/35**; `PantryService` mide **100/84.82/100/100 % S/B/F/L**. `pnpm run test:client` completo pasó **1199/1199**, con coverage global **90.32/81.45/88.95/91.75 % S/B/F/L**, sin tocar gates. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 ficheros/21 reglas), `pnpm run build:client` y `git diff --check`; el build conserva warnings previos de imports no usados y budgets.

**Rollback:** revertir juntos `frontend/src/app/core/services/pantry.service.ts`, su spec, `tests/e2e/pantry-item.spec.ts`, esta unidad y la fila `/pantry/inventario/:id`; no revertir las demás unidades del inventario ni el gate frontend.

### QA-PANTRY.MANAGERS.PARENT-LINK.1 · enlace directo para crear subcategorías (resuelta localmente)

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §12x promete que `/pantry/categories/new?parent=category_food` es un enlace compartible y que la elección sobrevive a F5. La pantalla actual lee `view` y `q` de la URL, pero `ngOnInit()` no consume `parent`; `abrirNueva()` tampoco escribe ese parámetro. La categoría raíz disponible en las semillas actuales es `alimentos` («Alimentos»), no `category_food`; la prueba usará esa clave vigente y no alterará la semilla ni la forma pública de la ruta.

**Conducta esperada:** abrir `/pantry/categories/new?parent=alimentos` selecciona «Alimentos» como padre; recargar mantiene el padre seleccionado porque el enlace conserva el contexto, y guardar crea la categoría con `parentKey: alimentos`. Un parámetro desconocido o no elegible no debe crear una relación inválida ni impedir el alta normal. En móvil, el formulario no rebasa los límites y el CTA se puede llevar mediante scroll a una posición completamente visible, por encima de la navegación fija.

- [x] Añadir primero un E2E aislado que reproduzca el enlace directo, selección del padre, F5 y persistencia al guardar en Chromium y Pixel 5; obtener baseline rojo antes de tocar producción.
- [x] Implementar el mínimo manejo del query param `parent`, validar la clave contra el catálogo cargado y conservar el límite existente de cuatro niveles.
- [x] Capturar e inspeccionar formulario PC/móvil con fixture sintético; comprobar bounds, ausencia de overflow y cero errores de página.
- [x] Ejecutar E2E focal, `typecheck:e2e`, `check:ui`, formato y diff checks; ejecutar coverage solo si se añade lógica con cobertura unitaria necesaria.

**TDD rojo → verde (2026-10-08):** el E2E añadido antes de producción falló en Chromium y Pixel 5 tal como se esperaba: `/new?parent=alimentos` mostraba «Sin padre: queda arriba del todo». La pantalla no leía `parent` y el formulario nacía sin categoría seleccionada. Se valida la consulta contra el catálogo completo cargado, se preselecciona únicamente una clave existente cuya colocación no exceda cuatro niveles y el picker comparte ese catálogo al mostrar opciones. Una clave histórica/desconocida (`category_food`) y una categoría ya a profundidad máxima se ignoran; ambas permiten continuar el alta sin padre. La clave real de la semilla actual es `alimentos`; no se cambia el contrato almacenado ni el comportamiento de categorías antiguas.

**Evidencia final (2026-10-08):** `tests/e2e/pantry-category-parent-link.spec.ts` pasa **2/2** en Chromium escritorio y Pixel 5; crea una cadena de prueba de cuatro niveles usando el formulario real, confirma la preselección, persiste el padre tras recargar, guarda la nueva subcategoría y comprueba la consulta desconocida/profundidad máxima con alta raíz normal. El E2E amplio `pantry-managers.spec.ts` también pasó **25/25** y omitió solo el menú de columna que no existe en el reflujo móvil. Se verifican cero `pageerror`, documento sin overflow y ficha dentro de los límites en 1440×900, 393×851, 320×568 y 568×320; con scroll el CTA queda completamente por encima de la navegación fija. Capturas sintéticas inspeccionadas e ignoradas por Git: `.e2e-screenshots/qa-pantry-category-parent-link-1-final/chromium/alta-subcategoria-1440x900.png` y `.../mobile-chrome/alta-subcategoria-{393x851,320x568,568x320,cta-393x851}.png`.

`pantry-gestor.util.spec.ts` ejecutó **31/31**; el archivo focal `pantry-gestor.util.ts` mide **98.03/87.03/100/100 % S/B/F/L**, sobre el mínimo de 70 %. La orden de Karma focal termina con exit 1 porque el reporte agregado de esa selección estrecha incluye dependencias parcialmente ejecutadas (**42.72/29.14/36.84/45.08 %**, menor que el gate global `80/80/80/80`); no se rebajó el gate y el resultado se distingue del coverage por archivo. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 ficheros/21 reglas**), `pnpm run build:client` (mantiene avisos previos de imports/budget), Prettier y `git diff --check`.

**Rollback previsto:** revertir el commit atómico de esta unidad (`tests/e2e/pantry-category-parent-link.spec.ts`, `pantry-categories.component.ts`, `pantry-gestor.util.ts`, su spec y esta evidencia) sin revertir el resto de `QA-PANTRY.ITEM.ROUTE.1` ni el contrato histórico.

### QA-PANTRY.MANAGERS.ACTION-GEOMETRY.1 · altura común de botones de acción (resuelta localmente)

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §P7 mantiene abierta la auditoría de accesibilidad de 44 px; `frontend/src/styles.scss` define `--button-control-height: 44px` y `app-button` usa ese token con `box-sizing: border-box`. Los formularios de categorías y productos principales duplican `.boton` y el área reservada para ella (`.ficha__acciones`) usa padding vertical de 8 px más altura de línea, sin fijar la altura estándar. El E2E de la unidad anterior midió uno de esos botones en 39 CSS px en Pixel 5. Esta unidad se acota a los botones de acción de ambos editores (`.boton`), incluido «Añadir alias»; no cierra la matriz global de objetivos táctiles de §P7 ni cambia tamaños de otras familias.

**Conducta esperada:** los botones textuales equivalentes de alta categoría, alta/edición de producto y añadir alias usan el alto común de 44 px y el padding/tipografía ya definidos por tokens, tanto en escritorio como en móvil. Tras desplazar el formulario, el CTA no queda tapado por la navegación inferior y el documento no tiene overflow horizontal.

- [x] Añadir E2E real de categoría/producto que mida primero los `.boton` del DOM en escritorio y Pixel 5; registrar baseline rojo y verificar también el flujo de teclado disponible. Antes del CSS, Chromium y Pixel 5 reprodujeron **39 px** donde se esperaban **44 px**; el selector de color y «Añadir alias» responden a Enter.
- [x] Aplicar el token compartido `--button-control-height` a las dos implementaciones duplicadas, sin añadir una medida responsiva local divergente; alinear padding, tipografía y radio de borde con los tokens/estilo común.
- [x] Medir alto, padding, tipografía y geometría de borde en 1440×900, 393×851, 320×568 y 568×320 con Chromium, Pixel 5 y emulación iPhone 13. Sin overflow horizontal ni errores de página, ficha dentro del viewport y CTA visible sobre la navegación al desplazar. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-pantry-manager-action-geometry-1-final-v4/chromium/{categoria,producto}-1440x900.png` y `.../mobile-chrome|mobile-safari/{categoria,producto}-{393x851,cta-393x851}.png`; las dimensiones móviles 320×568 y 568×320 también se capturan en ambos proyectos.
- [x] `pnpm run test:e2e -- tests/e2e/pantry-manager-action-geometry.spec.ts`: **6/6** (Chromium, Pixel 5, iPhone 13); `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 ficheros/21 reglas), Prettier focal, `git diff --check` y `pnpm run build:client` pasan. Build avisa de budgets/imports no usados (incluido el CSS del gestor de productos, 10.13 kB frente a 10 kB); no se alteraron budgets. CSS/E2E no añade lógica de negocio, coverage focal N/A.

**Rollback previsto:** revertir juntos los estilos `.boton` de `pantry-categories.component.ts` y `pantry-products.component.ts`, la nueva spec Playwright y esta unidad, dejando intactos el enlace padre y demás unidades Pantry.

### QA-PANTRY.MANAGERS.SINGLE-RECORD.1 · editar y borrar una categoría y un producto

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §12x define los gestores con lista, ficha y editor; toda eliminación pasa por confirmación. `pantry-managers.spec.ts` cubre alta de categoría/producto, padre, aliases, protección de filas reservadas/en uso y borrado por lote, pero no el guardado y persistencia de una edición ordinaria ni la cancelación/confirmación del borrado individual. Las rutas actuales implementan esos caminos: `PantryCategoriesComponent.guardar()` envía el diff de categoría, `borrar()` consulta impacto y pide confirmación; `PantryProductsComponent.guardar()` guarda nombre/categoría/unidad/notas/aliases y `borrar()` también exige confirmación. No se infiere un defecto de producción: falta evidencia E2E de estos flujos.

**Contrato:** cambiar desde las acciones de fila la categoría y el producto creados por la prueba, guardar y comprobar los valores tras recargar. Para cada registro, cancelar el diálogo de borrado no envía `DELETE` y conserva la fila; aceptar lo envía una sola vez y la fila sigue ausente después de F5. El producto se crea sin stock y la categoría no tiene productos ni subcategorías. Solo se mutan fixtures de hogar/SQLite temporales; no se usan registros sembrados para borrar ni se llama a IA/WebAPI externo.

- [x] Añadir E2E antes de cualquier cambio productivo: crear registros propios por la UI, editarlos desde la tabla, validar el PATCH y la persistencia al recargar. No se necesitó cambio productivo.
- [x] Probar cancelación y confirmación de borrado individual en ambas fichas/listas: cero DELETE y fila conservada al cancelar; exactamente un DELETE y ausencia persistida al confirmar. No tocar categorías reservadas, categorías en uso ni productos con stock.
- [x] Ejecutar Chromium y Pixel 5 con rate limit activo; comprobar nombres accesibles, cero errores de página, uso real del formulario móvil a 320×568 y apertura/captura a 393×851; capturar e inspeccionar las fichas sintéticas en 1440×900 y 393×851. Confirmar cleanup del runner aislado.
- [x] Ejecutar E2E focal, `typecheck:e2e`, Prettier, `check:ui`, build y `git diff --check`. Coverage S/B/F/L: N/A; esta unidad solo añade E2E.

  **Evidencia (2026-10-08):** `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --workers=1 --project=chromium --project=mobile-chrome tests/e2e/full-stack/pantry-manager-record-crud.spec.ts --reporter=line` con `E2E_RATE_LIMIT=on`: **4/4**. Crea y edita datos propios, confirma PATCH y persistencia tras F5; cancela borrado sin DELETE y confirma un único DELETE por entidad, con ausencia tras recarga. Chromium captura a 1440×900; Pixel 5 abre el editor a 393×851, realiza el flujo a 320×568 sin overflow horizontal y ambos proyectos reportan cero errores de página. Runner confirma base temporal y cleanup. Capturas sintéticas de los paneles (shell fijo excluido para evitar solapamiento artificial al recortar el panel), inspeccionadas e ignoradas por Git: `.e2e-screenshots/qa-pantry-manager-record-crud-final/{chromium,mobile-chrome}/{category-edit,product-edit}-*.png`. También pasan `pnpm run typecheck:e2e`, Prettier focal, `pnpm run check:ui` (**210 ficheros/21 reglas**), `pnpm run build` (servidor/cliente; éxito con warnings existentes de bundle, CSS y template) y `git diff --check`. Cobertura N/A al no tocar lógica productiva.

**Rollback:** retirar solo la nueva E2E y esta subunidad; preservar los gestores, contratos de API y demás pruebas existentes.

### QA-PANTRY.MANAGERS.COLOR-PICKER.1 · selector de color nativo accesible

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §12x almacena colores de categoría como `#RRGGBB`, pero no prescribe escribirlos a mano. `PantryCategoriesComponent` ofrece ocho muestras circulares y además un `app-input type="text"` con ayuda hexadecimal; `guardar()` replica la expresión regular del formato antes de enviar al API. El servidor ya valida y normaliza el color. No existe un selector nativo en la aplicación.

**Contrato:** conservar las muestras rápidas y sustituir el campo de texto/regex por un `input type="color"` accesible, con un área visual clicable y cómoda en escritorio y móvil, previsualización del color actual y valor hexadecimal solo de lectura. El control nativo abre el picker del navegador/sistema en cada plataforma; no se añade una dependencia ni se construye un selector de color duplicado. El color vacío conserva el significado existente (sin valor guardado) hasta que la persona elija uno; la previsualización usa el fallback visual de categoría. La UI no acepta ni necesita texto hexadecimal libre y no duplica validación del servidor. Muestras y picker deben tener foco visible, nombre accesible y objetivos táctiles de al menos 44×44 CSS px.

- [x] Añadir primero E2E aislado que pruebe tipo/nombre accesible, ausencia del textbox hex, selección personalizada distinta a las ocho muestras, guardado y persistencia tras F5; registrar el baseline rojo antes de cambiar producción. Conservar prueba de las muestras rápidas y de teclado.
- [x] Reemplazar el campo textual por un picker nativo presentado como control compacto: preview + acción + hexadecimal de lectura. Eliminar regex y ayuda de entrada manual en frontend, normalizar el valor del picker sin cambios falsos por mayúsculas/minúsculas y mantener intacto el contrato/validación API.
- [x] Verificar los proyectos soportados por `playwright.full-stack.config.ts` (Chromium escritorio y Pixel 5/Chrome móvil) en 1440×900, 393×851, mínimo 320×568, orientación 568×320 y límites CSS afectados (720, 768 y 1024 px); comprobar etiqueta/teclado/foco, objetivos táctiles, scroll y ausencia de overflow/pageerror. Safari móvil no forma parte del harness full-stack actual y no se afirmará validado. Capturar e inspeccionar PC y móvil con fixture sintética.
- [x] Ejecutar Playwright full-stack con almacenamiento temporal, typecheck E2E, suite unitaria focal y coverage focal (≥70 % S/B/F/L de cualquier lógica añadida), `check:ui`, formato, build y `git diff --check`; no tocar la base normal ni cambiar dependencias.

**TDD rojo → verde y evidencia (2026-10-08):** el E2E nuevo falló antes del cambio de producción en Chromium y Pixel 5 porque el control seguía siendo `type="text"`; tras el cambio `tests/e2e/full-stack/pantry-category-color-picker.spec.ts` pasa **2/2** en la app compilada servida por el proceso full-stack. Con usuario/hogar y SQLite temporales, confirma el `input[type=color]` con nombre accesible, ausencia de `input[type=text]` hexadecimal, ocho muestras con `aria-pressed` y hit area 44×44, Enter/foco visible por Tab, clic de ratón/tap móvil que enfoca el control, color personalizado `#12a4bc`→POST `#12A4BC`, persistencia visual tras recargar, valor por defecto `#8A8F98` y `color:null` al guardar sin elegir color. El navegador reconoce el control como textbox en su árbol de roles implícito; por eso la aserción específica excluye el campo `input[type=text]` en vez de afirmar que no exista ningún rol textbox.

La matriz en ambos proyectos comprobó 320×568, 393×851, 568×320, 719/720/721, 767/768/769, 1023/1024/1025 y 1440×900: sin overflow horizontal, el área del picker nunca baja de 44 px y no aparecen errores de página. `pantry-manager-action-geometry.spec.ts` verificó CTA/scroll sobre la navegación fija en Chromium, Pixel 5 e iPhone 13 (**6/6**); esto no prueba el popup nativo en Safari. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-pantry-color-picker-20261008/chromium/category-color-picker-1440x900.png` y `.e2e-screenshots/qa-pantry-color-picker-20261008/mobile-chrome/category-color-picker-393x851.png`. La selección del E2E cambia el valor DOM del control nativo; Playwright/headless no automatiza ni inspecciona la ventana emergente del sistema. Safari no pertenece al harness full-stack y no se afirma validado para el picker.

`pnpm run test:client`: **1211/1211**, cobertura total **90.42/81.60/89.16/91.84 % S/B/F/L**. Cobertura de `pantry-gestor.util.ts`: **98.07/87.93/100/100 % S/B/F/L**, sobre el mínimo de 70 %. Pasan `pnpm run test:config` (**10/10**), `pnpm run check:ui` (**210 archivos/21 reglas**), `pnpm run typecheck:e2e`, build de producción y `git diff --check`; el CSS del gestor de categorías quedó dentro del presupuesto de 10 kB sin reducirlo. Build mantiene avisos previos del bundle inicial y CSS de otros componentes.

La regresión full-stack preexistente `pantry-manager-record-crud.spec.ts` se ejecutaba más rápido que la navegación asíncrona del query `q` y recargaba antes de que la URL guardara el filtro; el producto/tema de color no era la causa. Se añadió `waitForSearchQuery()` para sincronizar ambas pruebas (categorías y productos) con el estado de URL que los gestores ya declaran. Después, el CRUD completo pasa **4/4** en Chromium y Pixel 5. `pnpm run lint:client` no puede ejecutarse en este checkout: Angular referencia `@angular-eslint/builder:lint`, pero ese paquete no está instalado/declarado; no se añadieron dependencias por este cambio.

**Rollback:** revertir en un único commit el picker/estilos de `pantry-categories.component.ts`, la clave i18n en `dict/pantry.ts`, `normalizarColorSeleccionado()` y su prueba, la nueva regresión E2E, la sincronización de consulta de `pantry-manager-record-crud.spec.ts` y este bloque; no revertir el formato de datos de categoría ni las unidades previas del gestor.

### QA-PANTRY.MANAGERS.ALIAS-CLASH.1 · error de alias duplicado en el alta principal

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §12x usa aliases como claves de búsqueda del producto, no como una ficha nueva. `normalizarAlias()` impide vacío, repetición dentro de la ficha o alias igual al nombre del mismo producto; no conoce el resto del catálogo. `POST /api/pantry/products` ya devuelve 409 `PANTRY_PRODUCT_ALIAS_CLASH` si un alias nuevo coincide con el nombre de otra ficha; `PantryProductsComponent.frase()` traduce ese código a un mensaje localizado. `pantry-item.spec.ts` ya cubre el mismo error en la edición dedicada del inventario, pero no el formulario de alta `/pantry/products/new`, donde una respuesta fallida debe conservar la ficha que la persona estaba registrando.

**Contrato:** crear por UI un producto sintético propio y, desde un segundo alta, proponer su nombre como alias. El servidor rechaza el conflicto con 409; la ficha de alta no navega ni se guarda, expone el error accesible esperado y conserva nombre y alias para corregirlos. La primera ficha no cambia. Usar Chromium y Pixel 5 sobre la SQLite temporal del runner, con rate limit activo; sin IA/WebAPI, catálogo global ni datos reales.

- [x] Añadir E2E primero contra `/pantry/products/new`; verificar POST 409, `role=alert`, ruta/borrador conservados y que el producto existente sigue siendo el único resultado tras F5. Registrar rojo baseline si la UI pierde mensaje o borrador.
- [x] Ejecutar en Chromium y Pixel 5, typecheck E2E, Prettier, `check:ui`, build y `git diff --check`; confirmar aislamiento/cleanup. No hay cambio productivo previsto, coverage N/A y capturas comparables N/A salvo que se corrija presentación.
- [x] Actualizar evidencia y rollback, commit atómico con todos los hooks y push a la rama del PR; verificar los jobs del SHA sin mergear.

**TDD y evidencia (2026-10-08):** el alta de producto ya mapea el 409 a un error accesible y conserva el formulario. El primer intento E2E local falló solo por un selector ambiguo (`getByRole('alert')` encontraba tanto el error de ficha como el toast); el selector se limitó a `data-test="gestor-productos-error"` y se comprobó además `role="alert"`. No se necesitó cambio productivo. `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --grep "el alta nueva conserva borrador" --project=chromium --project=mobile-chrome`: **2/2 pasaron** con POST inicial 201, conflicto 409, mensaje/ruta/borrador conservados, y tras F5 una sola ficha original (mismo id y sin alias) y ninguna ficha borrador. `pnpm run typecheck:e2e` pasó. El runner informa SQLite temporal y limpieza al cerrar; screenshots y coverage N/A al no cambiar UI ni lógica productiva.

**Rollback:** retirar el E2E y esta subunidad; no tocar la normalización/API de aliases ni la edición de producto ya cubierta.

**Entrega (2026-10-08):** commit atómico `945b98b` (`test(qa): verify alias clash keeps draft`), rama del PR actualizada y hooks locales completos; CI GitHub del SHA `945b98beff2ffc580ff8267078df6eb0e6d216d2` completado con éxito en el run `37833579136` (todos los jobs verdes). Sin merge.

### QA-PANTRY.PRODUCT.DEEP-LINK.1 · ficha directa de productos más allá de la primera página

**Fuente revalidada (2026-10-08):** el contrato activo `HOGARIA-SPEC.md` §12x dice que la ficha del producto vive en su URL para sobrevivir a F5, y el API ya expone `GET /api/pantry/products/:id`. `PantryService.getProduct(id)` consume esa ruta y su caso 200/404/503 está probado. Sin embargo, `PantryProductsComponent.buscarPorId()` ignora ese contrato y obtiene una sola página de `listProducts({ filter: 'all', limit: 100 })`; si la ficha no está entre las primeras 100, trata un id válido como inexistente y vuelve a la lista. El gestor sí pagina toda la colección hasta el límite establecido de 2.000.

**Conducta esperada:** cualquier ficha válida del hogar abre directamente su editor desde `/pantry/products/:id`, incluso cuando queda fuera de la primera página. Un id ausente conserva la salida segura a la lista. Usar solo el hogar/SQLite aislados de la prueba; no llamar a IA ni crear datos en el servidor normal.

- [x] Añadir primero una regresión Playwright que aumente la colección sintética hasta más de 100 productos, obtenga por API un id de la página siguiente y navegue directamente a esa URL; reproducir que la implementación actual vuelve a la lista.
- [x] Cambiar la resolución de la ficha para reutilizar `PantryService.getProduct(id)`; conservar el redireccionamiento a la lista al recibir `null`/404.
- [x] Verificar el deep link en Chromium escritorio y Pixel 5, junto con el caso de id inexistente, sin errores de página ni escrituras fuera del fixture propio.
- [x] Guardar/inspeccionar una captura sintética de la ficha en PC y móvil; ejecutar E2E aislado, regresión unitaria de `getProduct`, typecheck, formato, `check:ui`, build y coverage del alcance sin bajar gates.

**TDD rojo → verde (2026-10-08):** `pantry-product-deep-link.spec.ts` registra un hogar/SQLite aislado, crea 40 productos sintéticos por API y elige uno real del catálogo con offset ≥100. Antes del cambio, Chromium reproduce el fallo: la URL válida se resuelve como lista y no aparece el campo de nombre para `ZZ QA Deep Link Product 032`. `PantryProductsComponent.buscarPorId()` ahora consulta el endpoint de detalle ya existente a través de `PantryService.getProduct()`; si devuelve `null`, conserva la vuelta a la lista.

**Evidencia final (2026-10-08):** el Playwright aislado, con limitador activo y Chrome local, pasa **2/2** en Chromium escritorio (1440×900) y Pixel 5 (393×851): abre y muestra el producto de la segunda página, un id inexistente vuelve a `/pantry/products`, la CTA queda visible dentro del viewport y por encima de la navegación fija móvil, y no hay errores de página. El runner confirmó SQLite/puertos/semilla temporales y limpieza al acabar. Capturas sintéticas inspeccionadas e ignoradas por Git: `.e2e-screenshots/qa-pantry-product-deep-link-1/{chromium,mobile-chrome}/ficha-producto-cta.png`.

`ng test` focal `pantry.service.spec.ts`: **35/35**; cobertura de `getProduct` en el último `lcov.info`: **100/100/100/100 % S/B/F/L**. `pnpm run test:client`: **1206/1206**, cobertura global **90.37/81.51/89.07/91.79 % S/B/F/L**, por encima del gate 80. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 ficheros/21 reglas**), `pnpm run build:client`, Prettier focal y `git diff --check`. Build mantiene warnings previos de imports, bundle y CSS; no se cambiaron budgets.

**Rollback previsto:** revertir juntos el cambio en `pantry-products.component.ts`, `tests/e2e/pantry-product-deep-link.spec.ts` y este subapartado; preservar el endpoint y cobertura ya existentes de `PantryService.getProduct`.

### QA-PANTRY.INVENTORY.LOAD-ERROR.1 · error y reintento de la carga inicial

**Fuente revalidada (2026-10-08):** la casilla activa de `/pantry` exige distinguir carga, vacío y error. `PantryService.cargarInventarioCompleto()` limpia `isLoading` en `finally`, pero vuelve a propagar el 503. `PantryComponent.ngOnInit()` lanza `void this.recargarInventario()` y el método privado solo tiene `.then()` de éxito; no guarda error ni presenta un reintento. Por eso el primer fallo no tiene estado local recuperable y puede generar una promesa rechazada sin manejar.

**Conducta esperada:** un error de lectura muestra una alerta localizada y acción de reintento; no debe disfrazarse de despensa vacía ni de lista de sugerencias. Los fallos repetidos terminan el estado de carga y dejan reintentar; al recuperarse, el error desaparece y vuelve el contenido real. Sin escrituras de negocio ni proveedor IA.

- [x] Añadir primero E2E aislado que fuerce 503 en la lectura inicial y compruebe el estado accesible distinto de vacío, bajo el hogar/DB propios del runner. El test red contra el baseline falló porque no aparecía `[data-test=pantry-inventory-error]`; el código anterior propagaba el rechazo sin estado de error/reintento. Se cambió este criterio para registrar la ausencia observada, sin afirmar que el primer test midió un `unhandledrejection`.
- [x] Capturar el fallo en el flujo de carga de la pantalla, limpiar el estado de error al reintentar y volver al contenido solo cuando la carga termina bien. Tras dos 503, el tercer GET 200 elimina la alerta y recupera sugerencias.
- [x] Verificar dos fallos consecutivos y un tercer intento correcto en Chromium escritorio y Pixel 5; el loading termina, la CTA sigue accesible, la lista no se presenta como vacía y no quedan errores de página ni `unhandledrejection`. Playwright: **2/2**. En móvil se comprueban también 320×568, 719×851, 720×851 y 851×393; sin overflow, botón ≥44 px, no solapado con navegación, y activación con Enter.
- [x] Añadir prueba unitaria de fallo y éxito de `recargarInventario()`. El `lcov.info` generado el 2026-10-08 da **6/6 statements y líneas, 4/4 funciones (100 % S/F/L)**; no hay ramas decisorias en ese método (B: N/A), y ambos resultados asíncronos quedan cubiertos. Capturas sintéticas de error/recuperación, guardadas e inspeccionadas: `.e2e-screenshots/qa-pantry-inventory-load-error-1/{chromium,mobile-chrome}/{error-retry,recovered-inventory}.png` (ignoradas por Git). Validación: `pnpm run test:client` **1208/1208**, global **90.37/81.51/89.08/91.80 % S/B/F/L**; `pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 ficheros/21 reglas**), `pnpm run build:client`, Prettier y `git diff --check` pasan. El build conserva warnings de presupuestos/imports existentes; el CSS de `PantryComponent` queda en 11.73 KB frente al presupuesto de 10 KB (warning, build exitoso). El E2E usa el runner aislado y limpió su SQLite/artefactos y proceso de app.

**Rollback previsto:** revertir el estado/reintento de carga en `pantry.component.ts`, sus pruebas unitarias y E2E, las claves de traducción y este subapartado; mantener intacto el contrato de carga y paginación de `PantryService`.

### QA-PANTRY.ROOT-CRUD.1 · editar y borrar una fila desde la tabla

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §12ab conserva las acciones individuales de editar/borrar del visor. `PantryComponent` conecta los botones de la fila a `editIngredient()`, `saveIngredient()` y `deleteIngredient()`. `tests/e2e/pantry.spec.ts` cubre alta, búsqueda, filtros, ordenación, lote, stepper, sugerencias y paginación; `pantry-touch-targets.spec.ts` abre el editor y lo cancela, y abre el diálogo de borrado para cancelarlo, pero no guarda una edición ni confirma un borrado individual. Además, la etiqueta visible «Unidad» del `<select name="unit">` no tiene `for` ni envuelve el control, por lo que el selector no tiene nombre accesible verificable.

**Contrato:** desde una fila real de `/pantry`, editar mantiene el nombre y guarda cantidad/unidad; tras recargar siguen mostrándose los valores persistidos. La unidad del editor tiene nombre accesible localizado. Borrar individualmente exige confirmación: Escape conserva la fila; confirmar la quita de la despensa y sigue ausente después de recargar. Solo se usan filas sintéticas de SQLite aislada; sin IA/WebAPI ni cambios de catálogo ajenos.

- [x] Añadir primero una regresión Playwright roja: el editor de una fila no expone la unidad con el nombre accesible «Unidad»; después probar el guardado de cantidad/unidad y el borrado individual cancelar/confirmar desde la tabla. Baseline: Chromium y Pixel 5 no encontraron el `combobox` accesible.
- [x] Asociar correctamente label y `<select>` de unidad sin cambiar su geometría ni el resto del contrato visual del formulario.
- [x] Comprobar cantidad/unidad por UI, fila y recarga; verificar que Escape no envía DELETE y confirmar elimina únicamente la fila sintética, también tras recargar.
- [x] Ejecutar en Chromium escritorio y Pixel 5 con runner/SQLite/semilla/puertos aislados, typecheck, prueba unitaria focal, `check:ui`, formato, build y suites/gates vigentes; mantener ≥70 % S/B/F/L por archivo instrumentable. Guardar e inspeccionar capturas sintéticas PC/móvil y confirmar cleanup.

**Evidencia (2026-10-08):** TDD rojo: el test falló en ambos proyectos al no encontrar el `combobox` con nombre «Unidad». `pantry.component.ts` ahora asocia `for="pantry-ingredient-unit"` con el `id` del selector. Karma focal `pantry.component.spec.ts`: **14/14**; `editIngredient()` queda en **100/100/100/100 % S/B/F/L** dentro del alcance (3/3 sentencias y líneas, 2/2 ramas y 1/1 función, incluido el fallback de notas). El run focal con `--code-coverage` devuelve exit 1 por el gate global de 80 % aplicado al subconjunto (**16.69/4.47/7.38/18.64 %**); sin coverage, las 14 pruebas terminan con exit 0. No se relajó el gate. La suite completa actual `pnpm run test:client` pasa **1209/1209**, **90.41/81.58/89.12/91.84 % S/B/F/L**.

La E2E aislada `pnpm run test:e2e -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/pantry-root-crud.spec.ts --reporter=line` pasó **2/2**. Comprueba PATCH, persistencia tras reload, Escape sin DELETE, un único DELETE al confirmar, ausencia tras reload y cero `pageerror`; prueba escritorio 1023/1024/1440 px y Pixel 5 a 320×568, 393×851, 568×320, 719×851, 720×851 y 851×393 sin overflow. Runner confirmó cleanup de la app aislada y SQLite. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-pantry-root-crud-1-final/{chromium,mobile-chrome}/edit-dialog.png`, ignoradas por Git. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 ficheros/21 reglas**), `pnpm run build:client`, Prettier y `git diff --check`. Build exitoso con warnings existentes de bundle, presupuestos e imports; no cambia geometría.

La casilla agregada `/pantry` sigue abierta: falta validar la vista vacía real sin catálogo y cerrar su matriz general; este lote solo completa edición/borrado individual.

**Rollback previsto:** revertir la asociación de etiqueta, la E2E y esta subunidad; sin cambios de esquema ni APIs.

### QA-PANTRY.ROOT.EMPTY-STATE.1 · inventario realmente vacío y CTA de alta

**Fuente revalidada (2026-10-08):** el checklist activo `/pantry` exige separar vacío, sin resultados y error. `PantryComponent` solo pinta `.empty-state` cuando la lectura fue correcta, no hay cantidad positiva y `suggestions()` también está vacía; la CTA abre el modal de alta manual. En cambio, el registro estándar siembra actualmente 68 productos personales a cero, y `pantry.spec.ts` comprueba que haya cero filas de inventario pero nunca que aparezca este estado ni que la CTA funcione. La diferencia es importante: una casa con productos conocidos a cero debe ofrecer sugerencias, no decir que el inventario está realmente vacío. No se detecta un defecto de producción; esta unidad cierra el hueco de cobertura.

**Contrato:** con respuesta válida y colección de productos personales vacía, mostrar «Tu inventario está vacío», su ayuda y «Agregar primer ingrediente»; ocultar sugerencias y tabla, sin convertirlo en error ni en estado «sin resultados». La CTA abre el formulario manual. Cerrar el formulario sin guardar no crea filas. Usar solamente el usuario semilla y SQLite temporal propios del runner, eliminando sus filas iniciales a cero mediante el endpoint de lote; no tocar la base normal, catálogos globales ni proveedor de IA.

- [x] Añadir E2E primero con usuario aislado sin hogar: leer únicamente sus filas semilla (todas a cero), vaciarlas con el endpoint autenticado de lote y recargar para preparar la colección realmente vacía; no usar la base normal ni modificar datos globales.
- [x] Verificar estado vacío/localizado, ausencia de sugerencias/tabla/error, apertura de la CTA al modal manual y cancelación sin POST ni persistencia.
- [x] Ejecutar Chromium escritorio y Pixel 5 con rate limit activo; probar el ancho mínimo, `B−1/B/B+1` de breakpoints de la pantalla y orientación horizontal, sin overflow ni CTA tapada. Guardar e inspeccionar capturas sintéticas 1440×900 y 393×851 en carpeta única ignorada por Git; confirmar cleanup del runner.
- [x] Ejecutar typecheck E2E, Prettier, `check:ui`, build y diff-check. Coverage S/B/F/L: N/A porque el comportamiento productivo no cambia; mantener abierta la auditoría total de `/pantry`.

**Evidencia local (2026-10-08):** `E2E_RATE_LIMIT=on node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --workers=1 --project=chromium --project=mobile-chrome tests/e2e/full-stack/pantry-empty-state.spec.ts --reporter=line`: **2/2**; se registra automáticamente el teardown de servidor y DB aislados. La matriz mide 320 px, `479/480/481`, `599/600/601`, `719/720/721`, `1022/1023/1024`, 568×320, 844×390 y escritorio 1440×900; la cancelación no emite POST ni persiste filas. `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 archivos/21 reglas/0 incidencias), `pnpm run build`, Prettier focal y `git diff --check` pasan. Capturas sintéticas inspeccionadas: [.e2e-screenshots/qa-pantry-empty-state-attempt4/chromium/pantry-empty-1440x900.png](.e2e-screenshots/qa-pantry-empty-state-attempt4/chromium/pantry-empty-1440x900.png) y [.e2e-screenshots/qa-pantry-empty-state-attempt4/mobile-chrome/pantry-empty-393x851.png](.e2e-screenshots/qa-pantry-empty-state-attempt4/mobile-chrome/pantry-empty-393x851.png); ambas permanecen ignoradas por Git. Coverage S/B/F/L: N/A por ser cobertura E2E de conducta existente sin cambio productivo.

**Rollback:** retirar solo la E2E y esta subunidad; no revertir el endpoint de lote, los datos seed ni el estado vacío ya existente.

## Unidad QA-PANTRY.TOUCH.1 · objetivos táctiles de acciones por ingrediente (resuelta localmente)

**Fuente revalidada (2026-10-01):** `PantryComponent` renderizaba controles `.stock-btn` de 28×28 px y acciones `.action-btn` de 40×40 px. `DataTableComponent` usa tarjetas hasta 719 px y vuelve a tabla con scroll horizontal desde 720 px; por tanto, un teléfono girado (Pixel 5 ~851×393 CSS px) ya no estaba cubierto por `max-width:719px`. `pantry.spec.ts` ya comprobaba la actualización hasta cero, pero no rectángulos táctiles, acciones por toque ni el destino de foco al desaparecer la fila. La revisión también descubrió que una respuesta lenta podía devolver el foco al stepper inicial después de que la persona lo hubiera movido a Editar.

**Conducta esperada:** en tarjetas móviles y en dispositivos de entrada táctil —también al girar el móvil cuando la tabla reaparece— cada acción por ingrediente tiene un objetivo visible y activable de al menos 44×44 px, nombre accesible correcto y foco visible. El foco del stepper permanece en el mismo control tras actualizar y renderizar una cantidad nueva; si la persona mueve el foco mientras el PATCH/recarga está pendiente, la respuesta no lo secuestra. Si el producto sale de la tabla al llegar a cero, el foco pasa a otra acción de cantidad completamente visible o, si no hay ninguna, al botón de añadir ingrediente (desplazando este a la vista si hace falta). Llegar a cero no borra el artículo conocido. El ajuste no crea overflow horizontal ni solapa controles a 320 px; un escritorio sin entrada táctil conserva su densidad.

- [x] Añadir primero una regresión Playwright con ingrediente sintético y SQLite aislada; medir los cuatro controles reales con `getBoundingClientRect()` en Pixel 5 a 320×568, 393×851, 568×320, 719×900, 720×900 y 851×393, y en escritorio 1440×900. El baseline reprodujo controles de 28×28/40×40, incluidos 720 px y landscape táctil; validar también el scroll horizontal de la tabla.
- [x] Comprobar nombres accesibles ES exactos, foco visible y activación por toque/teclado; retener/reubicar el foco después del PATCH/recarga, preservar una acción distinta si la persona cambia el foco mientras el backend real responde, y al llegar a cero enfocar otra acción visible o Añadir ingrediente. Editar abre y Escape cierra; borrar abre la confirmación y Escape cancela; documento sin overflow horizontal.
- [x] Aplicar el CSS mínimo a pantallas estrechas y cualquier viewport con `pointer: coarse`, sin cambiar los datos ni iconos; Chromium sin entrada táctil conserva la densidad a 720 px y escritorio.
- [x] Añadir tests unitarios para clamp a cero, incremento, restauración a la misma acción, fallback por fila eliminada, filtro de candidatos visibles, foco cambiado y desmontaje del componente con petición pendiente; verificar que el listener se limpia y que una respuesta tardía no enfoca una pantalla nueva. El gate global no se rebajó.
- [x] Ejecutar E2E real Chromium/Pixel 5, typecheck, build y formato; guardar e inspeccionar capturas sintéticas PC 1440×900, móvil 320×568/393×851 y landscape táctil 851×393. Todo el runner usó base/puerto/SQLite/datos aislados, no el servidor ni la DB normal de `localhost:4200`.

**Rollback previsto:** revertir el commit atómico de QA-PANTRY.TOUCH.1, que agrupa este bloque, `frontend/src/app/features/pantry/pantry.component.ts`, `frontend/src/app/features/pantry/pantry.component.spec.ts` y `tests/e2e/pantry-touch-targets.spec.ts`; no revertir las unidades Pantry cerradas previamente ni `tests/e2e/pantry.spec.ts`.

**TDD rojo y verde (2026-10-01):** baseline inicial antes de CSS/lógica: `E2E_RATE_LIMIT=on node scripts/run-isolated-playwright.mjs --project=mobile-chrome tests/e2e/pantry-touch-targets.spec.ts` produjo **2 fallos esperados**: controles de 28×28/40×40 y foco perdido después del PATCH. La revalidación ampliada volvió a fallar en landscape táctil (720×900 y 851×393 aún medían 28×28/40×40) y al retirar la fila a cero. Antes del arreglo final, Playwright con `route.fetch()` contra el backend real y 400 ms de retardo reprodujo el robo de foco después de Tab; el Karma focal reprodujo **2 fallos** (fallback elegía un stepper fuera de pantalla y el refresh recuperaba el stepper anterior, no la acción editada). La revisión final detectó que un listener pendiente sobrevivía al desmontaje y que el E2E podía terminar antes de la recarga: una nueva prueba con fixture reprodujo foco obsoleto tras destruir el componente; el E2E ahora espera la respuesta GET real de inventario y dos frames antes de verificar. Capturas baseline: `.e2e-screenshots/qa-pantry-touch/baseline-v2/mobile-chrome/`.

**Evidencia verde:** con `E2E_RATE_LIMIT=off` y `E2E_CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe`, `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/pantry-touch-targets.spec.ts`: **7 passed, 1 skipped** (el caso de toque se salta antes de crear datos en Chromium); Pixel 5 validó 44×44 en portrait, landscape, límites 719/720 y tap de las cuatro acciones. El E2E de respuesta lenta espera ahora el GET de inventario real antes de comprobar el foco. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/pantry.spec.ts --grep='el stepper de la fila mueve la cantidad de uno en uno y a cero no borra la ficha'`: **2/2** en ejecución aislada anterior. Karma focal con cobertura: **11/11**; LCOV del bloque de foco/stock (líneas instrumentadas 1953–2078): **55/55 líneas, 35/43 arcos de rama (81,4 %) y 14/14 funciones**. Suite Karma completa: **611/611 tests pasan**, pero el gate global configurado al 80 % no se satisface: statements **58,69 %**, branches **49,85 %**, functions **47,43 %**, lines **60,46 %**; QA-04c permanece abierta. `pnpm run typecheck:e2e`, `pnpm exec prettier --check tests/e2e/pantry-touch-targets.spec.ts frontend/src/app/features/pantry/pantry.component.spec.ts frontend/src/app/features/pantry/pantry.component.ts APP-QA-SPEC.md`, `git diff --check` y build production a `%TEMP%` pasaron para el estado actual. El build aún informa budgets: chunk inicial 698,18 KB/500 KB y CSS Pantry 11,50 KB/10 KB. `pnpm run lint:client` no pudo ejecutarse: el repo no tiene instalado `@angular-eslint/builder:lint` (no se añadió dependencia). Para Playwright se usó Chrome del sistema porque falta el Chromium empaquetado en el caché local.

**Revalidación de la sincronización de foco (2026-10-08):** una ejecución combinada con limitador activo obtuvo 19 pasados, 2 fallidos y 1 omitido; los dos fallos fueron el test de teclado de esta unidad en Chromium y Pixel 5. El test comprobaba el foco inmediatamente después del texto optimista `3 g`, antes de que terminase el GET de recarga que repone el foco. No era una regresión de producción: la misma aserción pasa al sincronizarla con el GET real y dos frames de render. `tests/e2e/pantry-touch-targets.spec.ts` comparte ahora ese helper con el caso de respuesta lenta y espera el refresh antes de verificar incremento/decremento. Reejecutado el archivo completo con `E2E_RATE_LIMIT=on`: **7 pasados, 1 omitido** (solo activación táctil en Chromium). `pnpm run test:client`: **1201/1201**, gate global **90,32/81,46/88,96/91,75 % S/B/F/L**; `pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 archivos, 21 reglas, 0 incidencias**), Prettier focal y `git diff --check` pasan. El build actual de producción pasa; conserva avisos preexistentes de bundle inicial (857,30/500 kB) y presupuestos de CSS.

**Capturas inspeccionadas (fixtures sintéticos, artefactos ignorados):** [PC 1440×900](.e2e-screenshots/qa-pantry-touch/final-r5/chromium/pantry-row-actions-1440x900.png), [Pixel 5 portrait 320×568](.e2e-screenshots/qa-pantry-touch/final-r5/mobile-chrome/pantry-row-actions-320x568.png), [Pixel 5 portrait 393×851](.e2e-screenshots/qa-pantry-touch/final-r5/mobile-chrome/pantry-row-actions-393x851.png) y [Pixel 5 landscape 851×393](.e2e-screenshots/qa-pantry-touch/final-r5/mobile-chrome/pantry-row-actions-851x393.png). No se usaron datos personales ni el proveedor LAN.

## Hallazgo QA-REC.INGRESS.1 · límite de subida distinto en Nginx (resuelto, runtime aislado)

**Estado vigente (2026-10-08):** `/api/receipts` tiene una excepción Nginx de 11 MiB para que el archivo permitido de 10 MiB llegue a la API; el límite global de 512 KiB sigue protegiendo las demás rutas. El runtime se verificó en el harness aislado y la evidencia final queda debajo. Los párrafos de 2026-10-01/02 conservan los baselines previos a disponer de Docker, no el estado actual.

**Baseline de fuente (2026-10-01):** `HOGARIA-SPEC.md` §12aj fija el techo en 10 MB y enumera PNG/JPEG/WebP/PDF; formulario y `POST /api/receipts` aceptan hasta 10 MiB. Nginx declaraba `client_max_body_size 512k` global, lo que predecía un 413 antes de la API. Esa hipótesis estática motivó la prueba runtime; la decisión actual se registra debajo.

**Comprobación de entorno histórica (2026-10-01):** `Get-Command docker`, `docker-compose` y `nginx` no encontraba ejecutables; `wsl --list --verbose` devolvía `Wsl/EnumerateDistros/Service/E_ACCESSDENIED`. No se levantó ningún servicio ni se tocó `./data`. El Compose de producción no era seguro para QA aislado: fijaba nombres/contenedores y puertos y montaba `./data` persistente. Ese bloqueo dejó de aplicar cuando Docker estuvo disponible el 2026-10-08.

**Baseline técnico anterior al arreglo (2026-10-02):** se inspeccionaron `nginx/nginx.conf`, `docker-compose.yml` y la ruta; el proxy aún tenía 512 KiB globales y la API tenía límite de 10 MiB. El archivo de backend se amplió después en QA-REC.UPLOAD-BOUNDARY.1 y el proxy se probó, corrigió y verificó en runtime más abajo.

**Bloqueo de entorno histórico (2026-10-02):** el chequeo read-only no encontró Docker, Nginx, Podman ni nerdctl; WSL seguía devolviendo `Wsl/EnumerateDistros/Service/E_ACCESSDENIED`. No había procesos ni listeners en 80/443. La discrepancia estática quedó pendiente hasta que se ejecutó el harness real el 2026-10-08.

### QA-REC.UPLOAD-BOUNDARY.1 · límites de subida en el backend

- [x] Añadir regresiones a `POST /api/receipts`: 0 bytes → 400 `EMPTY_FILE`; PNG sintética con firma de exactamente 10 MiB → 201 y flujo sin proveedor → `NO_CONFIG`; 10 MiB + 1 byte → 413 `FILE_TOO_LARGE`, sin guardar ticket ni archivo.
- [x] Ejecutar el test con SQLite en memoria y proveedor no configurado; limpiar el archivo sintético en `finally`. Mantener la firma como autoridad: el caso exacto de 10 MiB usa `application/octet-stream` y aun así se clasifica PNG por sus bytes iniciales.
- [x] Ejecutar cobertura de servidor sin bajar el umbral, typecheck/build y comprobar `git diff --check`; actualizar esta checklist solo con resultados ejecutados.

**Evidencia de límites backend (2026-10-02):** baseline del archivo, antes de agregar los tres bordes: Vitest **11/11**. Después: `npm run test --prefix server -- src/routes/receipts.routes.spec.ts` **14/14**; la ejecución de 10 MiB se procesa hasta `NO_CONFIG`, y `finally` borra el archivo temporal. El caso +1 devuelve 413 `FILE_TOO_LARGE` y no crea fila ni archivo; 0 bytes devuelve 400 `EMPTY_FILE` sin persistencia. `npm run build --prefix server` y `git diff --check` pasan. El test de archivo completo no pasa `prettier --check` ya en `HEAD`; se evitó reformatear cientos de líneas fuera del cambio.

**Primer intento de gate global (2026-10-02; antecedente superado):** `npm run test:coverage --prefix server -- --reporter=dot` terminó entonces con **917/922**. Dos assertions de `pantry-catalog-i18n.spec.ts` buscaban plantillas/imports históricos y tres casos de `uploads.spec.ts` asumían semántica POSIX no efectiva en Windows. La revalidación de gates que sigue pasó **922/922** y supersede ese resultado. En ese checkout tampoco había Docker/Nginx, así que el ingress seguía pendiente hasta la prueba aislada de 2026-10-08.

**Revalidación de gates (2026-10-02):** con `DATABASE_PATH=:memory:` y `NODE_ENV=test`, `npm run test:coverage --prefix server -- --reporter=dot --coverage.reportsDirectory=<directorio único en %TEMP%>` pasa **45 archivos / 922 pruebas** y supera el umbral por archivo configurado de 70 %; agregado S/B/F/L **93,93/85,55/95,19/96,61 %**. La salida anterior de 917/922 queda como antecedente ya no reproducido. `npx tsc --project server/tsconfig.json --noEmit`, `npm run build --prefix server -- --outDir <directorio único en %TEMP%>` y `git diff --check` terminan con código **0**. El build y los informes se escribieron fuera del worktree; no se bajaron umbrales.

**Revalidación de runtime y decisión (2026-10-08):** Docker Desktop/Compose ya está disponible y `nginx:alpine` permite montar la configuración versionada sin tocar los contenedores ni puertos de HogarIA/WebAPI. `better-sqlite3@13.0.3` declara `engines.node >=22`; el intento de cargar SQLite con Node 20 terminó con código 139, mientras que el backend aislado en Node 22 compila y arranca. Alinear los tres stages Docker y los `engines` del workspace/servidor a Node 22 coincide con CI y con la dependencia actual. El runner de ingreso copia solo manifests, `server/src` y `tsconfig` a un contexto temporal allowlisted; no monta `server/data`, `.env`, `node_modules` ni datos locales. SQLite/uploads viven en el directorio temporal del run; Nginx monta el `nginx.conf` versionado en solo lectura y publica únicamente en loopback.

- [x] Preparar una prueba real por el ingress Nginx efectivo con backend/SQLite aislados: PNG sintética válida de 513 KiB decodificada por Chromium, llega al backend y, sin proveedor configurado, termina en `NO_CONFIG`; sin `page.route`.
- [x] Añadir pruebas del backend para firma/tamaño en 0 bytes, 10 MiB exactos y 10 MiB + 1 byte; validar 413 con `FILE_TOO_LARGE` solo al superar el límite. (QA-REC.UPLOAD-BOUNDARY.1; 14/14 del archivo dirigido.)
- [x] Corregir el límite del proxy para incluir multipart overhead sin cambiar el global; verificar con Chromium y Pixel 5 en Nginx real aislado. El límite de 512 KiB sigue devolviendo 413 en `/api/auth/refresh` para un cuerpo de 513 KiB.

**Evidencia de ingress (2026-10-08):** TDD reprodujo inicialmente 413 en `/api/receipts` al cruzar el límite global de 512 KiB. Se añadió un `location = /api/receipts` con `client_max_body_size 11m` y directivas de proxy comunes compartidas por include; el límite `http` de 512 KiB queda intacto. `pnpm run test:e2e:nginx -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/receipt-ingress.spec.ts` pasó **2/2**: Chromium y Pixel 5 enviaron una PNG 1×1 válida de exactamente 513 KiB por el Nginx del repo, recibió 201, y SQLite aislado confirmó `file_bytes=525312` y trabajo `NO_CONFIG`; la petición sobredimensionada a la ruta ajena fue 413. Se usaron usuario/archivo sintéticos, sin proveedor ni `page.route`; Compose limpió contenedores, imagen, red y datos tras el éxito. `pnpm run typecheck:e2e`, `pnpm --dir server exec vitest run tests/e2e-isolation.spec.ts` (**19/19**) y `git diff --check` pasan. El Dockerfile del stack de prueba compiló el backend con Node 22; no se inició el Compose persistente ni se accedió a DB de uso normal.

### QA-REC.INGRESS.UPLOAD-BOUNDARY.1 · demostrar el límite de archivo real a través de Nginx

**Contrato revalidado:** `HOGARIA-SPEC.md` §12aj y `server/src/routes/receipts.routes.ts` fijan un máximo de `10 * 1024 * 1024` bytes para el archivo. Nginx permite hasta 11 MiB al multipart de `/api/receipts`; la API, no el proxy, debe aceptar exactamente 10 MiB y rechazar 10 MiB + 1. La evidencia anterior de ingreso solo cubría 513 KiB.

- [x] En Chromium, subir por Nginx una PNG sintética válida de exactamente 10 MiB; verificar HTTP 201 y bytes persistidos exactos, sin IA real.
- [x] Subir por la misma ruta una PNG de 10 MiB + 1 byte; verificar 413 `FILE_TOO_LARGE` y que no aparezca una fila nueva.
- [x] Ejecutar ambos bordes en Chromium y Pixel 5 emulado con el stack Nginx/backend/SQLite temporal, sin `page.route`; comprobar typecheck, reglas UI, formato y diff.
- [x] Commit atómico con hooks íntegros, push y CI verde para el SHA publicado; mantener PR #41 abierto y no mergearlo.

**Evidencia local (2026-10-09):** el primer intento del caso nuevo falló por una precondición del test (el navegador aún no había navegado y `fetch('/api/receipts')` no tenía origen); se añadió navegación a `/api/health`, sin cambio de producción. El caso pasó **1/1** aislado y luego el archivo completo pasó **4/4** en Chromium y Pixel 5 con `pnpm run test:e2e:nginx -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/receipt-ingress.spec.ts --reporter=line`. SQLite aislado confirma para el borde válido `file_bytes=10485760` y trabajo `NO_CONFIG`; para 10485761 bytes se recibe 413 `FILE_TOO_LARGE` y el conteo de tickets de la cuenta no aumenta. El runner creó y quitó su proyecto Compose, imagen, red, DB y archivos temporales; no hubo `page.route`, proveedor externo, ni uso de la DB/servicios normales. El Dockerfile compila el backend con Node 22. Commit atómico `41bac95`, publicado con hooks completos; CI `37993458616` pasó **9/9 jobs** para el SHA `41bac950aaa8555cb14f8c9257718cd1df3e68d8`. PR #41 continúa abierto y Ready for review, sin merge.

**Rollback:** retirar el test de borde `receipt-ingress.spec.ts` y esta subunidad; no cambiar el máximo API de 10 MiB ni la excepción Nginx de 11 MiB.

## Unidad QA-REC.FAV.1 · quitar favoritos desde la pestaña filtrada (resuelta)

**Fuente de verdad revalidada (2026-10-01):** la ruta activa de `/recipes` etiqueta el filtro como «Favoritas»; `RecipesComponent.setFilter('favorites')` pide `RecipeService.loadRecipes({ isFavorite: true })` y `GET /api/recipes` aplica `is_favorite = 1`. El endpoint `POST /api/recipes/:id/favorite` confirma el valor nuevo. Sin embargo, `RecipeService.toggleFavorite()` solo cambia `isFavorite` en el array cargado; la receta desfavoritada sigue pintándose mientras `activeFilter` continúa en «Favoritas». Los E2E actuales verifican el toggle o la selección del filtro por separado, pero no la consistencia de pertenencia ni su persistencia tras recargar.

**Conducta esperada (inferencia explícita de la semántica del filtro):** una vez que el servidor confirma `isFavorite: false`, la receta deja de pertenecer a «Favoritas» y debe desaparecer de esa lista; las demás favoritas permanecen. El fallo de red/servidor no debe quitar la tarjeta ni modificar el estado visual. Cambiar de filtro y recargar debe mostrar los datos persistidos, sin ocultar la receta de «Todas».

- [x] Escribir primero una regresión Playwright con dos recetas sintéticas en stack SQLite aislado: activar «Favoritas», quitar una, comprobar que desaparece solo tras éxito, la otra sigue, y el resultado persiste al recargar y volver a «Todas».
- [x] Reproducir el fallo contra el build actual y añadir prueba unitaria para toggle en filtro de favoritas, toggle en «Todas» y respuesta fallida; conservar conteo/estado y evitar desapariciones optimistas ante error.
- [x] Corregir el estado del filtro/lista en el punto mínimo, sin duplicar la fuente del filtro; verificar fallo y reintento, nombres accesibles ES/EN y activación por teclado.
- [x] Ejecutar tests unitarios/coverage focal, typecheck/build y Playwright real Chromium + Pixel 5 con puerto, SQLite, semilla y limpieza aislados; comprobar 1440×900, 393×851 y 320×568 sin overflow horizontal ni control favorito fuera del viewport.
- [x] Guardar e inspeccionar capturas sintéticas comparables de escritorio y móvil tras el cambio; revisar errores JS, estados de fallo/red y anotar limitaciones.

**Evidencia TDD y cierre (2026-10-01):** la regresión E2E y la unidad reprodujeron en rojo la tarjeta que seguía en Favoritas tras desfavoritarla; un caso adicional reprodujo que un GET filtrado fallido no debe cambiar la identidad del listado que sigue visible. Tras el arreglo mínimo, `recipe.service.spec.ts` pasó **11/11** en Chrome Headless. La cobertura focal del código tocado fue **100 %** en statements, branches, functions y lines (36/36, 12/12, 10/10 y 27/27). `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/recipe-favorites.spec.ts` pasó **2/2** (Chromium escritorio y Pixel 5); usó Chrome local mediante `E2E_CHROME_BIN`, puerto y SQLite temporales, usuario/recetas sintéticos y cleanup del runner. El flujo cubre fallo HTTP 500 sin cambio visual, reintento real exitoso, persistencia tras recarga, lista «Todas», nombres accesibles ES/EN y Enter. Sin errores de página; sin overflow horizontal; control favorito visible y ≥44×44 en 1440×900, 393×851 y 320×568.

**Artefactos y gates:** capturas inspeccionadas (solo fixtures sintéticos): [Chromium 1440×900](.e2e-screenshots/qa-rec-fav-1/chromium/all-recipes-after-unfavorite-1440x900.png), [Pixel 5 393×851](.e2e-screenshots/qa-rec-fav-1/mobile-chrome/all-recipes-after-unfavorite-393x851.png) y [Pixel 5 320×568](.e2e-screenshots/qa-rec-fav-1/mobile-chrome/all-recipes-after-unfavorite-320x568.png). `tsc -p tsconfig.e2e.json --noEmit`, build de producción y diff check pasaron. La suite frontend completa pasó **591/591**, pero el gate global configurado en 80 % continúa fallando: statements **58.36 %**, branches **49.26 %**, lines **60.00 %**, functions **47.92 %**; no se redujo el gate y QA-04c sigue abierta. El formato Prettier focal pasó; se conserva sin reformatear el estilo histórico de los archivos completos.

## Hallazgo QA-AUTH.PW-LIMIT.1 · límite de bytes al establecer una contraseña (resuelta, revalidada)

**Fuente revalidada (2026-10-01):** `bcryptjs` 2.4.3 limita la credencial efectiva a 72 bytes UTF-8. La reproducción y descripción de baseline que siguen corresponden al estado anterior a la implementación; en el source actual, `bcrypt-password.schema.ts` aplica ese límite en `registerSchema`, `resetPasswordSchema` y `changePasswordSchema`, y `password-policy.ts` lo valida en registro y Cuenta con `TextEncoder`. Login y contraseña actual no reciben un límite nuevo para preservar compatibilidad. Los schemas, rutas, componentes y pruebas enumerados en esta unidad son la fuente vigente; no se debe volver a implementar este hallazgo.

**Reproducción sin datos ni red:** con una contraseña sintética de 73 bytes, `bcryptjs.hash` la aceptó y `bcrypt.compare` devolvió `true` tanto para los 73 bytes como para el mismo prefijo de 72 bytes. Esto confirma que el sufijo que la persona cree haber establecido no distingue la credencial.

**Conducta esperada (decisión técnica explícita):** rechazar contraseñas nuevas de más de 72 bytes UTF-8 en registro, restablecimiento y cambio; no recortarlas silenciosamente. Aceptar exactamente 72 bytes, también con caracteres multibyte. No imponer ahora un límite nuevo al login ni a la contraseña actual: preservar compatibilidad con cuentas existentes y limitar únicamente los valores que se guardan como credencial nueva.

- [x] Añadir primero pruebas de schema con bordes 72/73 ASCII y UTF-8 en registro, reset y cambio, más pruebas de rutas que rechazan 73 bytes sin crear ni cambiar la credencial.
- [x] Añadir validación de bytes UTF-8 con mensajes accesibles ES/EN a los formularios de registro y cambio en Cuenta; comprobar que maxlength nativo no sustituye la validación en bytes. Mantener sin límite nuevo el campo de contraseña actual/login.
- [x] Reproducir en rojo y verificar en verde con Playwright real contra stack aislado: registro y cambio de contraseña en el borde, rechazo de más de 72 bytes antes de mutar la credencial, reintento/login con la credencial aceptada; no exponer valores en artefactos.
- [x] Ejecutar cobertura focal ≥70 % en statements/branches/functions/lines, typecheck/build y Chromium + Pixel 5; revisar ES/EN, teclado, 320/393 px, escritorio, errores de consola y persistencia; comprobar en el flujo real de envío, sin alterar el scroll para la captura, que el aviso no quede tapado por cabecera/nav fijas en paisaje 568×320.
- [x] Guardar e inspeccionar capturas PC/móvil sintéticas de la pantalla de seguridad; actualizar evidencia, riesgos de compatibilidad y rollback tras las pruebas.

**TDD rojo (2026-10-01; solo pruebas nuevas, sin cambios de producción):** `node ./node_modules/vitest/vitest.mjs run src/schemas/auth-password-boundaries.spec.ts` falla porque registro acepta 73 bytes ASCII; `node ./node_modules/vitest/vitest.mjs run src/routes/auth.routes.spec.ts -t 'limite bcrypt'` falla en 3/3: registro responde 201 y cambio/restablecimiento responden 200 donde deben rechazar; Karma focal (`register-form.validation.spec.ts`) falla porque el validador devuelve `null` para 73 bytes UTF-8 en vez de `tooLongBytes`. En la reproducción Playwright aislada previa, registro envió al servidor una contraseña de 73 bytes y la pantalla de Cuenta no mostró el límite antes de POST; se probó aparte el borde válido exacto de 72 bytes. Todas las corridas usan datos sintéticos; no se tocó la base habitual ni se llamó a proveedores externos. El intento de ejecutar además todo `auth.routes.spec.ts` presentó un fallo preexistente de permisos de directorio (`chmod`) específico de este entorno Windows; por eso los fallos nuevos se aislaron con el patrón `-t 'limite bcrypt'`.

**Hallazgo del helper de captura (2026-10-01):** el scroll artificial con `scrollIntoView` produjo una falsa alarma: situó el aviso en top 45/36 px detrás del header (bottom 56 px). Reproducción real con viewport apaisado establecido antes de rellenar/enviar: el aviso queda en 62–80 px, entre el header (56 px) y la nav inferior (256 px), sin overflow; captura sintética `.e2e-screenshots/qa-auth-pw-limit-1/mobile-chrome/natural-es-568x320.png`. No se justifica cambio CSS. Se corrigió el helper para que interactúe y capture en cada viewport sin reposicionar el scroll; criterio de salida: aviso legible y fuera de barras fijas en el estado posterior al envío.

**Evidencia final (2026-10-01):** las schemas/rutas focales pasan (Vitest: 6 passed, 9 omitidos por el filtro; cobertura V8 de `bcrypt-password.schema.ts`: 100 % statements/branches/functions/lines). Karma focal de policy/registro: 7/7, cobertura 100 % en las cuatro métricas. `tsc -p server/tsconfig.json --noEmit`, `tsc -p tsconfig.e2e.json --noEmit` y build Angular de producción pasan. Playwright real aislado: Chromium **3/3** y Pixel 5 **3/3**; registra y cambia contraseña en ES/EN, prueba 72/73 bytes, teclado, no-POST local al rechazo, no overflow ni superposición en 320×568/393×851/568×320 y persistencia de credencial; se usó Chrome local vía `E2E_CHROME_BIN` porque no está el Chromium administrado por Playwright. Capturas revisadas: PC `.e2e-screenshots/qa-auth-pw-limit-1/chromium/-data-test--account-password-error---en-1440x900.png`, móvil apaisado `.e2e-screenshots/qa-auth-pw-limit-1/mobile-chrome/-data-test--account-password-error---es-568x320.png`, móvil estrecho `.e2e-screenshots/qa-auth-pw-limit-1/mobile-chrome/-password-error-en-320x568.png`. `check-ui` deja 13 incidencias históricas en `core/i18n/labels.ts:345-358`; `ng lint` no arranca porque falta `@angular-eslint/builder:lint`. Build mantiene avisos preexistentes de budget/imports no usados. No se ejecutó el smoke de proveedor LAN ni se usó el token; las pruebas escriben solo en SQLite temporal. Rollback: revertir el commit atómico de PW-LIMIT.1 elimina la política, su UI, tests y evidencia de esta unidad.

**Revalidación adicional (2026-10-01):** con `E2E_RATE_LIMIT=off` y `E2E_CHROME_BIN` apuntando al Chrome local, `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-password-byte-limit.spec.ts` pasó **6/6** (3 Chromium + 3 Pixel 5), con SQLite y puertos efímeros; el runner limpió sus datos al terminar. Esta repetición confirma el source actual y no introduce otro cambio de producción.

### QA-AUTH.PW-LIMIT.COPY.1 · aviso de longitud comprensible (resuelta)

**Fuente revalidada (2026-10-08):** el código aplica correctamente el máximo interno de 72 bytes UTF-8 para contraseñas nuevas, pero los avisos visibles en registro y Cuenta dicen «bytes» y el helper de registro muestra «72 bytes UTF-8». Ese término no orienta a una persona que solo quiere completar el formulario. La política técnica no se cambia: el rechazo debe seguir ocurriendo en cliente antes de enviar una contraseña demasiado larga.

**Conducta esperada:** la alerta ES/EN explica en lenguaje cotidiano que la contraseña escrita no se puede guardar porque es demasiado larga e indica probar con una más corta. Ningún texto visible del formulario de registro o cambio de contraseña menciona bytes/UTF-8; los helpers describen los requisitos sin prometer un máximo en caracteres que no corresponda a todos los caracteres Unicode.

- [x] Cambiar primero las expectativas E2E para comprobar el aviso exacto en ES/EN, los helpers comprensibles y la ausencia de jerga «bytes» en registro y Cuenta; reproducir el rojo antes de editar producción.
- [x] Sustituir solo los textos visibles; conservar sin cambios la validación UTF-8, los límites de entrada y las respuestas backend.
- [x] Revalidar registro y cambio, rechazo local sin POST, aceptación del borde válido, accesibilidad del error y layout en Chromium/Pixel 5 a 1440×900, 393×851, 320×568 y 568×320; revisar capturas nuevas sintéticas PC/móvil.
- [x] Ejecutar pruebas focales, typecheck, build/formato y `git diff --check`; documentar resultados y límites sin reducir gates.
- [x] A petición del usuario (2026-10-08), aclarar también que la contraseña no se podrá guardar, además de decir que es demasiado larga y cómo corregirlo; conservar la validación y la jerga fuera del mensaje.

**TDD rojo y evidencia verde (2026-10-08):** las nuevas expectativas de copy fallaron antes del cambio en Chromium y Pixel 5 (**4/4** escenarios del foco), mostrando que ambos helpers aún exponían «72 bytes». Después, `E2E_RATE_LIMIT=on; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-password-byte-limit.spec.ts --reporter=line` pasó **6/6** en Chromium de escritorio y Pixel 5. La suite valida alertas exactas ES/EN y accesibles, helper sin jerga, rechazo local sin POST, borde de 72 bytes aceptado, cambio y autenticación posterior; revisa 1440×900, 393×851, 320×568 y 568×320, overflow y posición frente a cabecera/nav. Usa SQLite/puertos/usuarios temporales, rate limit activo y cleanup. `typecheck:e2e`, `check:ui` (**210 ficheros, 21 reglas**), Prettier focal, build de producción y `git diff --check` pasan; el build conserva avisos preexistentes de imports/budgets ajenos al cambio. No hay lógica nueva, por lo que coverage focal no aplica. Capturas sintéticas revisadas e ignoradas por Git: `.e2e-screenshots/qa-auth-password-copy-20261008/chromium/-data-test--account-password-error---es-1440x900.png` y `.e2e-screenshots/qa-auth-password-copy-20261008/mobile-chrome/-data-test--account-password-error---es-320x568.png`. La política de 72 bytes y los límites backend no cambiaron.

**Aclaración solicitada (2026-10-08):** la alerta ES ahora explica: «La contraseña que has escrito no se puede guardar porque es demasiado larga. Prueba con una más corta.»; EN: “The password you entered is too long to save. Try a shorter one.” Antes de actualizar las traducciones, la E2E real aislada de registro en Chromium falló con el mensaje corto previo, reproduciendo la discrepancia de copy. Las expectativas comprueban el texto literal en registro y Cuenta.

**Evidencia final de la aclaración:** `E2E_RATE_LIMIT=on` y `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-password-byte-limit.spec.ts --reporter=line` pasó **6/6** en Chromium escritorio y Pixel 5; verificó los textos ES/EN, rechazo local sin POST, el borde aceptado de 72 bytes, cambio y autenticación posterior, roles/nombres accesibles y ausencia de overflow/solapamiento en 1440×900, 393×851, 320×568 y 568×320. El E2E usó SQLite/puertos/usuarios sintéticos y cleanup; las capturas `.e2e-screenshots/qa-auth-password-copy-clarification-20261008b/chromium/-data-test--account-password-error---es-1440x900.png` y `.e2e-screenshots/qa-auth-password-copy-clarification-20261008b/mobile-chrome/-data-test--account-password-error---es-568x320.png` se revisaron y Git las ignora. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 ficheros/21 reglas/sin incidencias), `pnpm exec prettier --check APP-QA-SPEC.md frontend/src/app/core/i18n/dict/account.ts frontend/src/app/core/i18n/dict/auth.ts tests/e2e/auth-password-byte-limit.spec.ts`, `pnpm run build:client` y `git diff --check`. El build conserva avisos preexistentes de presupuesto e imports/tipos no usados; coverage focal N/A porque solo cambia copy y expectativas, sin lógica de producción.

### QA-AUTH.PW-LIMIT.ALERT-LANDSCAPE.1 · evitar que el error quede bajo la cabecera fija

**Fuente revalidada (2026-10-08):** `AccountComponent.savePassword()` pone el error UTF-8 en una alerta después de los campos de contraseña. En `MainLayoutComponent`, `.header` es fija, mide 56 px y tiene `z-index:100`; `.main` reserva 56 px arriba y la barra inferior también es fija. El test E2E aislado reproduce el defecto real en Pixel 5 a 568×320: tras fijar viewport, recargar, rellenar y enviar con Enter, la alerta queda en `top=34 px` frente a `header.bottom=56 px`. No modifica el scroll en el helper y no hubo POST de cambio de contraseña. La captura sintética anterior a la corrección confirma que la cabecera tapa la alerta.

**TDD rojo (2026-10-08):** se conserva primero la aserción geométrica real en `auth-password-byte-limit.spec.ts`; el test falla con `top=34`, `bottom=52`, `headerBottom=56`, `bottomNavTop=256` y `scrollY=485`. El aviso ya tenía foco de accesibilidad y `scroll-margin-block`, pero eso no bastaba. Un primer intento con `scrollIntoView({ block: 'center' })` solo movió el aviso a `top=51`: `html` tiene un `scroll-padding-bottom` global de `calc(64px + 148px)`, que sesga el área usada para centrar y todavía lo deja bajo la cabecera fija.

**Corrección mínima:** `FocusErrorDirective` enfoca el aviso después del render con `preventScroll`, da al párrafo `tabindex=-1` y márgenes de scroll basados en tokens; solo si su rectángulo se cruza con barras fijas calcula el centro del área libre entre `.header` y `.bottom-nav` y aplica ese delta al scroll. La directiva no reposiciona avisos que ya están despejados. `AccountComponent` la conecta solo al error de contraseña. La prueba unitaria verifica foco, márgenes, el caso de solapamiento y los casos sin necesidad de desplazarse.

- [x] Guardar e inspeccionar la captura sintética previa a la aserción geométrica en 568×320, conservando la interacción real que reproduce el estado.
- [x] Reproducir la superposición con test enfocado y confirmar geometría, foco/scroll y ausencia de POST; separar el defecto del helper y del cambio de viewport.
- [x] Aplicar una corrección guiada por regresión; el error queda entre cabecera y navegación inferior, sin overflow ni petición de cambio de contraseña.
- [x] Revalidar ES/EN en 393×851, 320×568 y 568×320, más escritorio; ejecutar E2E real aislado, cobertura ≥70 % S/B/F/L de la directiva de producción, build/typecheck/formato y guardar/revisar capturas PC/móvil.

**Evidencia final (2026-10-08):** `focus-error.directive.spec.ts` pasa **4/4**; suite Angular completa con gate global ≥80 % pasa (**1168/1168**), y la directiva alcanza **100/83,33/100/100 %** statements/branches/functions/lines. Playwright aislado `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-password-byte-limit.spec.ts` pasa **6/6**; prueba ES/EN, rechazo previo a POST, foco, teclado, 320×568/393×851/568×320 y escritorio, sin overflow ni alertas bajo las barras fijas. `pnpm run typecheck:e2e`, `pnpm run build`, `pnpm run check:ui` (**208 ficheros, 21 reglas, cero incidencias**) y `git diff --check` pasan. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-auth-pw-limit-1/chromium/-data-test--account-password-error---es-1440x900.png`, `.e2e-screenshots/qa-auth-pw-limit-1/mobile-chrome/-data-test--account-password-error---es-393x851.png` y `.e2e-screenshots/qa-auth-pw-limit-1/mobile-chrome/-data-test--account-password-error---es-568x320.png`; están ignoradas por Git y muestran solo campos de contraseña enmascarados y datos de prueba. El CI del commit `c4856f7` terminó **9/9 jobs en verde** (run `37723259392`).

**Rollback:** revertir únicamente la corrección de visibilidad, su regresión y esta subunidad; no cambia la política de contraseña ni credenciales existentes.

## Evidencia inicial (no equivale a aprobación de la app)

- [x] La ruta pública `/auth/login` responde desde `http://localhost:4200`; revisé también `/auth/register`, `/auth/forgot-password` y la invitación inválida.
- [x] Barrido exploratorio sin sesión en 320, 360, 390, 430, 768, 1023, 1024 y 1440 px: esas cuatro pantallas no mostraron overflow horizontal. No se probó aquí la app autenticada ni cada acción.
- [x] El árbol actual declara las áreas pública, onboarding, dashboard, despensa, recetas, compra, tickets, calendario, hogar, configuración de IA, logs, cuenta, preferencias y ajustes; el detalle de rutas está más abajo.
- [x] Playwright enumera 636 casos en 31 archivos y configura Chromium escritorio, Pixel 5 y iPhone 13. Se enumeraron, **no se ejecutaron**.
- [x] Repetir el barrido con captura de errores de red/console en la matriz de rutas y viewports definida abajo.
- [x] Comprobar si los fallos pertenecen a la app: cero errores de consola/página/requests del origen app, cero respuestas no-2xx inesperadas, cero rutas/componentes faltantes y cero overflow. Los 404 son fixtures deliberadamente inexistentes; Google Fonts es el único host externo fallido (`ERR_NETWORK_ACCESS_DENIED`).
- [x] Revalidar Google Fonts en un entorno con acceso de red antes de decidir si la apariencia con fallback representa el estilo de producción; no atribuirlo a la aplicación basándose solo en el bloqueo local.
- [x] Capturar evidencia autenticada en escritorio y móvil después de preparar una base aislada.

**Revalidación real del baseline (2026-10-01):** `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/route-baseline.spec.ts`, con `E2E_RATE_LIMIT=off` y Chrome local. El runner asignó la SQLite a `%TEMP%\hogaria-e2e-*\hogaria.sqlite`, semilla única y puertos loopback efímeros (no se usó `localhost:4200` para escrituras); validación de entorno confirmó `isolated=true` y el runner limpió la DB temporal al terminar. Chromium y Pixel 5: **2/2**; cada proyecto cargó 28 rutas/componentes en 5 tamaños (320×568, 393×851, 768×1024, 1024×768, 1440×900), 140 mediciones por proyecto; navegación, page errors, console errors, fallos app-origin, componentes faltantes, HTTP inesperado y overflow: **0**. Único fallo externo: `https://fonts.googleapis.com/css2`, `net::ERR_NETWORK_ACCESS_DENIED` (142 solicitudes por proyecto); los 404 de API son los casos `qa-baseline-*` esperados. Capturas autenticadas sintéticas inspeccionadas: `.e2e-screenshots/qa-route-baseline-5686ee0a982c429b9f0197e05bb36ea0/dashboard-chromium-1440x900.png` y `dashboard-mobile-chrome-320x568.png`. Esta es navegación/layout baseline, no validación de todas las acciones de formulario.

**Revalidación de continuidad (2026-10-01):** sobre el estado local actual, el mismo spec volvió a pasar en Chromium **1/1** y móvil **1/1** (matriz completa de 28 rutas × 5 viewports, DB/puertos/semillas temporales). En una ejecución combinada, Chromium pasó, pero Pixel 5 informó un único fallo de request a `/api/pantry/catalog/products` (`net::ERR_NO_BUFFER_SPACE`); todos los indicadores restantes (navegación, JS, consola, componentes y overflow) estaban limpios. La repetición inmediata móvil-only pasó **1/1** y no reprodujo el fallo. Se registra como transporte transitorio observado en este host, no como defecto funcional confirmado ni como evidencia de fallo inexistente; Google Fonts sigue bloqueada externamente (`ERR_NETWORK_ACCESS_DENIED`). No se usó la DB normal ni proveedor real.

**Revalidación de Google Fonts (2026-10-08):** el CSS de `frontend/src/styles.scss` respondió **200** desde `fonts.googleapis.com` (24 015 bytes) y un WOFF2 **200** desde `fonts.gstatic.com` (25 960 bytes). Chromium real cargó el stylesheet y tres WOFF2 sin requests fallidas; `document.fonts.load` confirmó **Inter**, **Plus Jakarta Sans** y **JetBrains Mono** cargadas. La prueba de navegador se hizo sin credenciales ni datos de app. Además, `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium tests/e2e/route-baseline.spec.ts` pasó **1/1** con SQLite y puertos efímeros; no reportó navegación fallida, componentes faltantes, errores app-origin, respuestas HTTP inesperadas ni overflow. La observación de 2026-10-01 era un bloqueo del entorno (`ERR_NETWORK_ACCESS_DENIED`): con red disponible, la tipografía intencional sí se carga; no se justifica cambiar estilos ni atribuir el fallback a un defecto de la app. No se tocó la DB normal ni se llamó a proveedores.

### Baseline real de Chromium (2026-09-30; hallazgos, no cierre)

- Build de servidor: `node ./node_modules/typescript/bin/tsc -p server/tsconfig.json` — pasó.
- Build de cliente: desde `frontend/`, `node ./node_modules/@angular/cli/bin/ng.js build --configuration production` — pasó con avisos de budget de bundle/estilos y componentes/imports sin uso.
- `tests/e2e/full-stack/served-app.spec.ts`: 4 pasaron y 1 se omitió (no hay manifest enlazado); Chrome de sistema, SQLite y uploads exclusivos bajo `%TEMP%`, sin vídeo/traza.
- Suite `tests/e2e/full-stack` inicial: 11 pasaron, 3 fallaron y 1 se omitió; Chrome de sistema, un worker, limitador activo y SQLite temporal. Tras aislar los dos specs de QA, `shopping-money.spec.ts` pasó 3/3 y `request-budget.spec.ts` 2/2. No se llamó al proveedor IA ni se usó una credencial real.
- Los fallos iniciales de `request-budget.spec.ts` eran falsos positivos de medición: el watcher contaba registro, rangos pedidos intencionalmente, varias mutaciones de cesta en la misma ventana y el sondeo de cola permitido por §12aj. No se observó repetición en las ventanas de reposo aisladas ni reconexión SSE; el watcher redacta ahora tokens/credenciales en sus diagnósticos.
- El rojo de `shopping-money.spec.ts` combinaba dos defectos comprobados: `tickAll()` conservaba locators por índice cuando la pestaña filtraba líneas marcadas y `parseLine()` descartaba `Pan` como unidad antes de comprobar `isKnownUnit()`. QA-02 corrige ambos; los tres casos de `shopping-money.spec.ts` pasan en Chromium aislado.
- Las suites Playwright configuradas con vídeo/traza fallaron al cerrar Chromium en este sandbox (`browserContext.close: spawn EPERM`); desactivar ambos para la ejecución local hizo reproducible el cierre. Esto es una limitación del entorno, no evidencia de un fallo de la app.
- Suite unitaria frontend completa inicial (Chrome Headless 154, con coverage; 2026-09-30): 452/471 pasaron; 19 fallaron en `AuthService` (4), `authGuard` (2), `home-profile` (1), `ModulesService` (7), `CheckboxComponent` (1), `ThemeService` (3) y `ModalComponent` (1). La línea base y su cobertura inicial (75.54/62.18/72.78/76.77 % en statements/branches/functions/lines) quedan como historial reproducible; QA-04a corrigió los tests/defectos y QA-04c conserva pendiente el gate de 80 % sin rebajarlo.
- Históricamente, `node scripts/check-ui.mjs` en Windows informó 13 incidencias `texto-en-un-catalogo` en `labels.ts`; la revalidación posterior muestra que ese archivo sí traduce las 13 categorías y que el ruido viene de una ruta de exclusión incompatible con separadores `\\`. QA-05.PATH.1 conserva el baseline y requiere una regresión del checker antes de cerrar.

## Unidad QA-01 · fiabilidad de medición E2E (completada)

- [x] `request-budget.spec.ts`: aísla del watcher el registro/acciones intencionales, mide reposo tras cada carga, sigue detectando bucles y `429`, y comprueba que cada pantalla abre su stream una vez sin reintentos. Excluye el sondeo intencional de `/api/receipts/queue` definido en `HOGARIA-SPEC.md` §12aj.
- [x] `request-watch` conserva query no sensible para distinguir rangos, pero redacta tokens/credenciales y userinfo al capturarlos y en diagnósticos; unitarias Node 3/3 (`node --import tsx --test tests/e2e/helpers/request-watch.unit.ts`).
- [x] `shopping-money.spec.ts`: marcar las líneas por identidad estable, afirmar que ambas están en el carro antes de finalizar y comprobar que la hoja permite guardar ambos precios y que se recuerdan en la siguiente lista. Evidencia: ejecución aislada Chromium/build producción, 3/3 pasaron.
- [x] Ejecutar specs enfocados contra build/servidor real con base/uploads temporales únicos y limitador activo: `request-budget.spec.ts` 2/2 y `shopping-money.spec.ts` 3/3, Chromium de sistema, sin vídeo/traza ni proveedor externo.

## Unidad QA-02 · conservar nombres al parsear cantidad y unidad (completada)

Contrato activo: `HOGARIA-SPEC.md`, §8 (entrada `2 Leche` y `1kg Tomates`); `unit-families.ts` es la lista de unidades reconocidas.

- [x] Prueba Jasmine pura: conserva nombres cortos (`1 Pan de cristal`, `2 Leche semidesnatada`), reconoce unidades válidas con/sin espacio, decimales, alias/unidad compuesta, texto plano, marcadores de lista con/sin espacio y cantidad+unidad sin producto.
- [x] El input rápido usa el parser puro; solo consume prefijos de unidad reconocidos por `isKnownUnit()`. Playwright confirma que `2 Leche semidesnatada` se conserva como dos unidades (total recordado 1,90 €) y no pierde el nombre corto.
- [x] Playwright Chromium aislado: `1 Pan de cristal` se muestra completo, ambas líneas se marcan por nombre, la hoja de pago enumera ambas y guarda precios; al crear otra lista, se recupera el precio correcto.
- Evidencia reproducible: build `ng build --configuration production` pasó con warnings ya existentes; prueba unitaria enfocada 5/5; suite `shopping-money.spec.ts` 3/3 con base SQLite y uploads temporales únicos, limitador activo, sin vídeo/traza ni proveedor externo. Cobertura del alcance (suite completa): `quick-add.ts` statements/functions/lines 100 %, branches 88.89 %; `unit-families.ts` 100 % en las cuatro métricas. La suite frontend global permanece roja y bajo su gate local del 80 % (ver baseline).

## Unidad QA-03 · contrato de validación del registro (completada)

**Decisión de alcance:** `server/src/schemas/auth.schema.ts::registerSchema` es la fuente de verdad disponible (HOGARIA-SPEC no fija reglas de registro): nombre de 2 a 100 caracteres, correo válido y contraseña de mínimo 6 caracteres con una mayúscula ASCII (`[A-Z]`) y un dígito ASCII (`[0-9]`). El cliente debe reflejarla y explicar los rechazos antes de llamar a la API; no se relaja la validación backend.

- [x] Añadir pruebas puras de fronteras para nombre (1/2/100/101), email inválido y contraseña (5/6 caracteres, falta mayúscula, falta dígito, acento no ASCII, válida) contra el contrato del servidor.
- [x] El formulario valida los mismos límites, muestra mensajes ES/EN coherentes con cada error, limita visualmente nombre a 100 caracteres y permite corregir/reintentar sin enviar datos inválidos; el error está asociado al campo y anunciado.
- [x] Playwright real con DB temporal cubre rechazos sin petición, aceptación en fronteras válidas, error/reintento y ausencia de doble envío, en escritorio y móvil; capturas comparables guardadas sin datos personales.
- [x] Ejecutar tests unitarios cliente/servidor, typecheck y E2E Chromium escritorio + mobile-chrome; registrar cobertura del alcance sin rebajar los gates existentes.

Evidencia QA-03 (2026-09-30):

- Contrato: `server/src/schemas/auth.schema.ts::registerSchema`. Pruebas backend `node ./node_modules/vitest/vitest.mjs run src/schemas/auth-register-boundaries.spec.ts` — 3/3; Karma enfocado en Chrome Headless 154 — 39/39 (`input.component.spec.ts`, `register-form.validation.spec.ts`, `register.component.spec.ts`, `auth-register-context.spec.ts`). Para Karma local se generó y eliminó un launcher temporal `ChromeHeadlessSafe` por las restricciones GPU/sandbox de Chrome; el archivo no cambia el gate ni queda en el repo.
- Typecheck: `node ./node_modules/typescript/bin/tsc -p server/tsconfig.json` y `node ./node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit` — pasaron. Build frontend producción — pasó con warnings preexistentes de imports, bundle y estilos. Auditoría de CI (`.github/workflows/ci.yml`): servidor con gate de coverage 70 %/archivo, build producción y Playwright full-stack Chromium + mobile-chrome; no ejecuta Karma/frontend unit coverage ni `check-ui`, así que esos resultados son gates locales.
- Playwright sobre build de producción y servidor real, puerto, SQLite, uploads y semilla únicos bajo `%TEMP%`, `RATE_LIMIT` activo y limpieza tras éxito: `tests/e2e/full-stack/register-contract.spec.ts` Chromium — 4/4; `mobile-chrome` (Pixel 5) — 4/4. Viewports sin overflow: escritorio 1023/1024/1440; móvil 320×740, 390×844 y horizontal 844×390. Capturas sintéticas ignoradas por Git: `.e2e-screenshots/registration-desktop.png` (1440×900) y `.e2e-screenshots/registration-mobile.png` (390×844). Revisadas visualmente.
- Interacción directa de solo lectura con el servidor dev existente `http://localhost:4200/auth/register`: Chromium escritorio y móvil revisaron campos, validación, ARIA y los mismos seis tamaños; 0 POST a registro. Capturas adicionales `.e2e-screenshots/dev-registration-desktop.png` y `dev-registration-mobile.png`, inspeccionadas visualmente.
- Cobertura del alcance, medida en el informe HTML de Karma: `register-form.validation.ts` y `register.component.ts` — 100 % en statements, ramas, funciones y líneas; `input.component.ts` — 100 % en statements/ramas/líneas y 92.85 % en funciones (13/14), supera 70 % en cada métrica. En `AuthService.register`, todas las sentencias y callbacks del método (contexto silencioso y caminos éxito/error) se ejecutaron; el archivo completo sigue en 53.68/22.73/45.45/54.95 % (statements/branches/functions/lines) por métodos ajenos al alcance. La suite global completa sigue bloqueada por los 19 tests anotados en el baseline y por su gate 80 %; no se rebajó.

## Unidad QA-03b · estado touched del control compartido (completada)

**Hallazgo revalidado:** `frontend/src/app/shared/components/ui/input/input.component.ts` solo emite `onBlur` en el evento blur. En cambio `onInput()` llama `onTouched()` para texto y valores numéricos vacíos/no válidos, pero retorna sin hacerlo para números válidos. Esto vuelve inconsistente el estado touched de `ControlValueAccessor` según el tipo de campo y no sigue el momento de interacción esperado (salir del campo).

- [x] `onTouched` se ejecuta al salir de cualquier input y no al teclear, tanto texto como número; el output público `onBlur` se conserva.
- [x] Tests CVA reprodujeron primero la discrepancia (2 fallos), luego verificaron blur/touched y que no cambia al teclear (componente 28/28).
- [x] Ejecutar el E2E real de registro en Chromium y mobile-chrome contra un servidor/DB aislados; cobertura de todas las métricas ≥70 % en el alcance, sin tocar los gates existentes.

Evidencia QA-03b (2026-09-30): red TDD 2/28 fallos esperados antes del cambio; suite `input.component.spec.ts` verde 28/28 y subconjunto completo 39/39. Playwright full-stack tras build de producción Chromium 4/4 y mobile-chrome 4/4; servidor dev 4200 escritorio/móvil pasó sin POST de registro; build y typechecks pasaron. El coverage HTML de `InputComponent` indica 100/100/92.85/100 % (statements/branches/functions/lines). La suite global tenía entonces 19 fallos basales, resueltos en QA-04a.

## Unidad QA-04a · rebaselinar suite unitaria y resolver discrepancias (completada)

**Fuente revalidada antes de implementar:** la línea base aislada de Karma volvió a dar 19 specs fallidos y 452/471 verdes: `AuthService` (4), `authGuard` (2), `home-profile` (1), `ModulesService` (7), `CheckboxComponent` (1), `ThemeService` (3) y `ModalComponent` (1). En `ModulesService.spec.ts`, el fake `profile` era una función mutable pero no estaba respaldada por una señal Angular; por ello los `computed` del servicio no reaccionaban a `set()` y seis de los siete specs caían por estado obsoleto. El séptimo supone incorrectamente que `receipts` aún no está disponible. No cambiar el comportamiento de producción solo para hacer verdes estos tests.

- [x] Repetir la línea base aislada de Karma y registrar los nombres de los specs rojos y porcentajes; no tocar datos ni el servidor de uso normal.
- [x] `AuthService`/`authGuard`: sembrar y afirmar `STORAGE_KEYS` antes de construir servicios; modelar `isAuthenticated` como señal invocable. Probar el ciclo legado → migración → logout → nueva migración/arranque para confirmar que una sesión cerrada no se restaura; preservar prioridad/idempotencia de migración y comportamiento de login.
- [x] `AuthService` emite `AuthResponse`/`User` normalizado tanto con respuesta API `{data: ...}` como plana: contrastar login, registro, refresh y `updateProfile` con sus consumidores; normalizar el observable además de actualizar el cache.
- [x] Aumentar cobertura de caminos relevantes de refresh, perfil/avatar, contraseñas y evento de cambio del tema del sistema; ambos servicios superan ≥70 % en statements, ramas, funciones y líneas (ver informe actual abajo).
- [x] Corregir el logout solo tras reproducir la migración: al cerrar sesión borrar credenciales de sesión heredadas sin eliminar preferencias ni claves ajenas, y cubrir la regresión con unit test y flujo Playwright.
- [x] `ThemeService`: usar `STORAGE_KEYS.theme`, limpiar/sembrar almacenamiento antes de instanciar y crear instancias de prueba dentro del contexto Angular; verificar valores válidos, valor por defecto, persistencia y evento de media query.
- [x] `ModulesService`/`home-profile`: alinear fixtures con `MODULE_REGISTRY` (`meals`, `pantry`, `shopping`, `receipts` disponibles; `home` pendiente); probar selección vacía/expresa, módulo no disponible, último módulo visible, rollback con selección válida y reintento después del error.
- [x] Reconciliar la frase histórica contradictoria de `HOGARIA-SPEC.md` §8c con el registro, rutas y funciones implementadas; no deshabilitar módulos vigentes para complacer tests viejos.
- [x] `ModalComponent`/`CheckboxComponent`: comprobar ambos outputs de cierre; actualizar el fixture tras el click antes de leer `aria-checked`; conservar estado disabled.
- [x] Repetir las pruebas focalizadas y toda la suite frontend: cero assertions fallidas. Se registra por separado el gate global de coverage aún rojo en QA-04c; no se redujo ningún umbral.

Evidencia QA-04a (2026-09-30): baseline Chrome Headless 154 aislado — `TOTAL: 19 FAILED, 452 SUCCESS`. Tras corregir fixtures/expectativas y dos defectos reales (migración que restauraba credenciales tras logout y `ModulesService.isSaving` retenido ante error), el grupo auditado pasó 84/84 y la suite completa `488/488`. Las pruebas nuevas Playwright de logout+migración y fallo/reintento de módulos pasan Chromium `2/2` y Pixel 5 `2/2`, con rate limit activo, servidor de producción efímero y SQLite/semilla/puerto temporales únicos; `tsc -p tsconfig.e2e.json --noEmit` pasó. `GET http://localhost:4200/` responde 200 y el dev server permanece activo en IPv6; no se realizaron escrituras contra él ni contra la base de uso normal.

## Unidad QA-04c · cobertura global sin rebajar gates (en curso)

**Evidencia histórica (2026-10-01/02):** la línea base pasó `507/507` con 80.80/69.75/79.25/82.32 % (sentencias/ramas/funciones/líneas); corridas posteriores pasaron `651/651` con 60.64/51.37/50.72/62.41 % y `665/665` con **60.30/52.21/49.80/61.92 %**, por debajo de los gates. No se rebajó ningún umbral. Estas métricas ya no describen el estado actual.

**Revalidación vigente (2026-10-09, pre-push de `a09d4e9`):** `pnpm run test:client` pasó **1233/1233** en Chrome Headless 154 con **91.11/82.13/89.69/92.56 % S/B/F/L**. Los callbacks de `ShoppingListsComponent.refresh()` y `PickerComponent.onViewportChange()` siguen cubiertos determinísticamente; las cuatro métricas globales superan 80 %. LCOV de referencia archivado fuera del repo en `%TEMP%\hogaria-coverage-avatar-image-baseline-a09d4e9-20261009.lcov`. `.github/workflows/ci.yml` comprueba el cableado Karma y ejecuta E2E, pero no incluye la suite frontend completa.

- [x] Revalidar cobertura global y por archivo antes del siguiente lote; archivar el reporte base de esta ejecución en `%TEMP%`.
- [ ] Añadir pruebas unitarias/integración para ramas y caminos de error/éxito no cubiertos; cada lote debe partir de fuentes actuales, tener regresión útil, cobertura ≥70 % en cada métrica del alcance y commit atómico.
- [x] Repetir la suite frontend completa con coverage y alcanzar 80 % en statements, ramas, funciones y líneas; documentar comandos y salidas, sin bajar umbrales.

Candidatos del informe previo al lote (histórico; orden statements/branches/functions/lines): `auth.service.ts` 100/81.82/94.59/100 %, `theme.service.ts` 96.67/92.86/87.50/96.67 %, `shopping.model.ts` 79.22/62.40/66.67/79.22 %, `error.interceptor.ts` 7.89/0/0/7.89 %, `swipe-row.directive.ts` 10.09/11.11/11.76/10.09 %, `core/time.ts` 86.75/57.83/95/86.75 %, `data-table.util.ts` 95.86/78.77/100/95.86 %, `i18n.service.ts` 61.70/23.68/61.54/61.70 %, `household.service.ts` 1.79/0/0/1.79 % y `taste-profile.service.ts` 3.33/0/0/3.33 %.

### QA-04c.AI-CONFIG.TIMEOUT-RESULT.1 · no presentar un timeout como éxito

**Fuente revalidada (2026-10-09):** `/ai-config` ya tiene E2E de estados correctos, error 503,
prueba desde formulario y tarjeta y bloqueo de carga. `AiService.testConnection()` convierte errores
HTTP a `null`; `AiConfigComponent.testFromForm()` y `testConfig()` deben tratar ese resultado como
fallo contextual. La casilla de ruta `/ai-config` (línea 2777) exige comprobar también timeout; los
E2E presentes solo fuerzan 503/fallos genéricos, no una respuesta 504. El nuevo caso usa únicamente
un `page.route()` sintético sobre la API local aislada, sin invocar al proveedor ni guardar claves.

**Conducta esperada:** ante HTTP 504 tanto al probar una configuración guardada como al probar los
datos sin guardar, termina el estado de carga y se abre el resultado «Error de conexión»; no aparece
un aviso de éxito ni un toast genérico duplicado, la configuración/formulario permanece utilizable y
la clave sintética no aparece en el resultado.

- [x] Añadir primero regresión E2E de 504 para la tarjeta guardada y el formulario; confirmar un único
      POST por modo, resultado de error, fin del loading, cero toast de éxito/error duplicado y secreto
      ausente del contenido visible.
- [x] Ejecutar Playwright aislado en Chromium y Pixel 5 con SQLite/puerto/semilla temporales y rate
      limit activo; confirmar que el handler sintético intercepta ambas peticiones y que no se contacta
      WebAPI/proveedor. Cambio de producción y coverage: N/A si el contrato actual ya pasa.
- [x] Ejecutar `typecheck:e2e`, `check:ui`, build, formato y `git diff --check`; registrar rollback,
      commit atómico, hooks completos, push y CI verde. No cambia el aspecto de la UI; capturas: N/A.

**Evidencia (2026-10-09):** el E2E se añadió sin cambiar producción y las dos pruebas primero
interceptan localmente `/api/ai/test-connection` con un 504 sintético. En el formulario y en una
configuración guardada se verifican un solo POST, el resultado accesible de error, fin del estado de
carga, ausencia de ambos tipos de toast y de la clave sintética en el modal; la configuración
guardada manda solo `configId`, nunca la clave. Con `E2E_RATE_LIMIT=on` y Chrome local,
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/ai-config.spec.ts --grep='timeout' --reporter=line` pasó **4/4** (dos variantes en
Chromium y Pixel 5). El runner aisló SQLite, semilla, puerto y limpieza bajo `%TEMP%`; el mock
interceptó cada petición antes de llegar al servicio, por lo que no hubo WebAPI/proveedor externo.
`pnpm run typecheck:e2e`, `pnpm exec prettier --check tests/e2e/ai-config.spec.ts APP-QA-SPEC.md`,
`pnpm run check:ui` (**212 ficheros, 21 reglas**), `pnpm run build` y `git diff --check` pasaron.
Build mantiene warnings de budget de estilos ya existentes; no se tocó CSS ni geometría, así que
capturas y coverage de producción no aplican. Commit `46e4d44` pasó pre-commit (Prettier/check-ui) y
pre-push completo; CI del HEAD final `fc92eee` (**37980861919**) pasó **9/9** jobs, incluidos los
cuatro shards E2E y full-stack.

**Rollback:** retirar solo la E2E focal y esta subunidad; no cambiar la semántica de conexión ni tocar
configuración real.

### QA-04c.AI-CONFIG.SECRET-VISIBILITY.1 · mostrar/ocultar clave desde el formulario

**Fuente revalidada (2026-10-09):** `/ai-config` define `apiKey` como `type="password"`; el
`app-input` compartido muestra el botón con nombre accesible localizado y permite alternar la
visibilidad. Sus pruebas de componente validan ese control genérico, pero la E2E del formulario de
configuración no demuestra que el campo real lo conecte y preserve el valor. El contrato general de
la ruta (línea 2817) exige mostrar/ocultar clave. Unidad test-only, con valor completamente sintético;
no guardar ni llamar al proveedor.

**Contrato:** clave oculta inicialmente; el botón «Mostrar contraseña» se acciona por teclado, cambia
el tipo a texto y actualiza su nombre a «Ocultar contraseña»; se puede volver a ocultar por teclado y
el valor queda intacto. No debe abrir el diálogo de resultado, guardar configuración ni emitir una
petición de prueba. Nunca capturar el campo mientras la clave sintética esté visible.

- [x] Añadir primero una E2E real de `/ai-config` que pruebe estado inicial, visibilidad, teclado,
      etiquetas accesibles, conservación del valor y cero POST de guardado/prueba.
- [x] Ejecutar en Chromium y Pixel 5 sobre runner aislado con rate limit activo; no producir
      screenshots/traces/videos con la clave visible ni contactar WebAPI/proveedor.
- [x] Ejecutar `typecheck:e2e`, `check:ui`, build, formato y `git diff --check`. No cambia geometría:
      capturas y coverage de producción N/A.
- [x] Registrar evidencia final, commit atómico con hooks, push y CI verde para el SHA del PR.

**Evidencia local (2026-10-09):** `tests/e2e/ai-config.spec.ts` ahora llena solo una clave ficticia
y comprueba que comienza oculta; el botón accesible revela el valor con Enter, lo vuelve a ocultar
con Space y preserva el mismo valor. Dos rutas interceptadas prueban que no hay POST de guardado ni
de prueba. Con rate limit activo, la E2E aislada en Chromium y Pixel 5 pasó **2/2**; SQLite, semilla,
puerto y cleanup fueron temporales. No se contactó WebAPI/proveedor ni se habilitó captura del campo.
`pnpm run typecheck:e2e`, `pnpm exec prettier --check tests/e2e/ai-config.spec.ts APP-QA-SPEC.md`,
`pnpm run check:ui` (**212 ficheros/21 reglas**), `pnpm run build` y `git diff --check` pasaron;
el build conserva sus warnings preexistentes de tamaño. Sin cambio de producción/UI: coverage y
capturas comparables no aplican. Commit `fc92eee` pasó pre-commit (Prettier/check-ui) y pre-push
completo. CI `37980861919` del mismo SHA pasó **9/9** jobs, incluidos full-stack y los cuatro shards.

**Rollback:** retirar solamente la E2E y esta subunidad; el control genérico de contraseña permanece
intacto.

### QA-04c.AI-QUEUE-PAGE.PARAM-ABSENT.1 · fallback defensivo si falta configId

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md §12an` y `ai-config.routes.ts` fijan la ruta
real en `:configId/queue`; por tanto, una ruta sin `configId` no es una URL de producto. Aun así,
`AiProviderQueuePageComponent` contempla una `paramMap` o `snapshot.paramMap` sin esa clave mediante
`?? ''`, mientras su spec solo construye la ruta con parámetro. El último LCOV completo generado el
10-10 a las 09:15 CEST registra `ai-provider-queue-page.component.ts` en **100/50/100/100 % S/B/F/L**
(BRF 4 / BRH 2); las dos ramas pendientes son precisamente esos defaults defensivos. Se toma
`frontend/coverage/lcov.info` como fuente actual: `coverage-final.json` conserva fecha 2026-10-02 y el árbol
HTML contiene páginas históricas duplicadas.

**Contrato:** una prueba unitaria monta el componente mediante una ruta local de test sin `configId`;
el `provider()` queda sin seleccionar, la página muestra el aviso accesible de proveedor inexistente,
la carga de configuraciones se solicita una vez y la cola no se observa. La ruta real de producción no
cambia. Unidad test-only: no se cambia comportamiento, datos, ni configuración real de IA.

- [x] Añadir primero una prueba focal con `paramMap` y snapshot sin `configId`; comprobar aviso de
      proveedor inexistente y cero llamadas a `AiQueueService.watch`.
- [x] Alcanzar ≥70 % en cada métrica del componente (preferiblemente 100 %); ejecutar la spec focal
      y la suite frontend completa con gate global ≥80 % intacto.
- [x] Ejecutar typecheck E2E, `check:ui`, build, formato y `git diff --check`; registrar resultados,
      limitaciones y rollback. Hooks completos, commit atómico, push y CI verde; PR #41 abierta y sin merge.

**Evidencia local (2026-10-10):** se añadió primero una ruta de test sin `configId`; el componente ya
tenía los defaults defensivos y no necesitó cambio de producción. La prueba comprueba `provider()` sin
selección, alerta accesible de proveedor inexistente, una sola solicitud de configuración y cero
`AiQueueService.watch`. Karma focal pasó **4/4** con
`pnpm --filter @hogaria/web exec ng test --no-watch --include
src/app/features/ai-config/ai-provider-queue-page.component.spec.ts --browsers=ChromeHeadlessLocal`.
Con `--code-coverage`, las mismas 4 pruebas pasan; el proceso focal termina 1 solo porque su subset
no alcanza el gate global configurado (21.86/5.43/10.15/23.69 % S/B/F/L). El reporte específico del
componente es **100/100/100/100 %**: 8/8 líneas, 5/5 funciones y 4/4 ramas; statements 100 % según
el HTML generado. La suite completa
`pnpm --filter @hogaria/web exec ng test --no-watch --code-coverage --progress=false
--browsers=ChromeHeadlessLocal` pasa **1298/1298** con **92.30/83.71/91.06/93.68 % S/B/F/L** y sin
rebajar el gate. `coverage-final.json` es obsoleto y las vistas HTML conservan directorios viejos;
se verificó el LCOV actual (2026-10-10 09:41 CEST) y su página canónica `coverage/app/...`. Sin cambio visual,
E2E/capturas N/A; el route real exige `configId`, por lo que la prueba es defensiva, no una ruta de
producto. Commit de implementación `24959d6` pasó los hooks Lefthook pre-commit/pre-push y está publicado;
CI del HEAD `24959d6` (run `38035476337`) pasó **9/9 jobs**, incluidos los cuatro shards E2E y full-stack.

**Rollback:** retirar solamente la prueba y esta subunidad; el componente y la ruta de producción no
cambian.

### QA-04c.PANTRY.FILTER-PROJECTIONS.1 · filtros de filas, sugerencias y utensilios

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §12aa.C exige filtrar por el subárbol de categoría;
§12ab.B/C define búsqueda sin acentos/mayúsculas, filas con existencias, sugerencias sin existencias y
filtrado de utensilios en la tabla. `PantryComponent` implementa esos resultados en los `computed` de
`coincideBusqueda`, `clavesFiltro`, `filasInventario`, `hayInventario`, `suggestions`, `inPantryCount` y
`utensiliosFiltrados`. La spec unitaria existente (`pantry.component.spec.ts`) crea el componente e invoca
acciones concretas, pero no evalúa estos cálculos; el LCOV generado por la suite completa del 2026-10-10
09:57 CEST registra el rango actual `pantry.component.ts:1484–1544` en **20/0/0/20 % S/B/F/L** (5/25
sentencias, 0/25 ramas, 0/14 funciones y 5/25 líneas ejecutables). Unidad test-only; el baseline no
demuestra un defecto de producto ni justifica cambiar su comportamiento.

**Contrato:** con datos sintéticos, las filas contienen solo cantidades positivas y las sugerencias las
cantidades `<= 0` (incluido `null`/ausente); los conteos de casa no dependen de búsqueda/categoría. La
búsqueda recorta espacios y no distingue mayúsculas ni acentos. Elegir una categoría padre aplica su
subárbol tanto a filas como a sugerencias. La tabla de utensilios convierte disponibilidad API `0/1` y
`boolean` a un único booleano y busca ignorando mayúsculas/acentos. No se escribe en almacenamiento ni se
llaman servicios reales.

- [x] Añadir primero pruebas unitarias focales con signals sintéticas que cubran búsqueda vacía y con
      texto, coincidencia y no coincidencia, cantidades positivas/cero/negativas/nulas, padre e hija de
      categoría y disponibilidad API `0/1`/boolean en utensilios.
- [x] Alcanzar ≥70 % S/B/F/L en el rango de proyecciones `1484–1544` (objetivo 100 %); repetir la spec
      focal y suite frontend completa manteniendo el gate global ≥80 %.
- [x] Registrar comandos, métricas y limitaciones; formato, `check:ui`, build, typecheck E2E y
      `git diff --check`; hooks, commit atómico, push y CI verde. No hay cambio visual, por lo que E2E y
      capturas no aplican.

**Rollback:** retirar únicamente las pruebas de proyecciones y esta subunidad; no cambiar el componente,
el servicio ni el contrato de las tablas.

**Evidencia local (2026-10-10):** baseline focal previo **14/14**; antes de añadir las pruebas el rango
`1484–1544` medía **20/0/0/20 % S/B/F/L**. Con cuatro nuevos casos sintéticos, `pnpm --filter
@hogaria/web exec ng test --no-watch --include src/app/features/pantry/pantry.component.spec.ts
--browsers=ChromeHeadlessLocal` pasó **18/18**. La variante focal con `--code-coverage` también pasa
18/18 y mide el rango en **100/100/100/100 %**, pero sale con código 1 por el gate global del subset
(18.55/7/10.29/20.37 % S/B/F/L); el gate no se alteró. La suite completa con coverage pasó
**1302/1302** y **92.61/84.29/91.62/93.93 % S/B/F/L**; su LCOV temporal confirma en el rango objetivo
25/25 sentencias/líneas, 25/25 ramas y 14/14 funciones. Pasaron `pnpm run typecheck:e2e`,
`pnpm run check:ui` (**212 ficheros, 21 reglas**), `pnpm run build`, Prettier focal y `git diff --check`.
El build conserva warnings existentes de imports no usados, cadenas opcionales y budgets. Sin cambio de
producción/UI: E2E y capturas N/A; los logs de build no muestran regresión funcional.
Commit atómico `caffcd5` pasó hooks Lefthook pre-commit/pre-push, se publicó y su CI (`38036745128`) pasó
**9/9 jobs**. PR #41 sigue abierta, sin Draft y sin merge.

### QA-04c.PANTRY.BULK-ACTIONS.1 · errores y cancelación de acciones por lote

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md §12ab.B/C` define vaciar inventario por PATCH
`quantity: 0`, borrar cada fila por DELETE, confirmación propia con el número de filas y cambios masivos
de disponibilidad para utensilios. `pantry.component.ts` implementa esos caminos en `loteVaciar`,
`loteBorrar` y `loteUtensilios`; la E2E existente cubre los caminos de éxito, pero la suite unitaria no
ejercita métodos por lote. El LCOV de la suite completa actual mide `pantry.component.ts:1716–1793` en
**0/0/0/0 % S/B/F/L** (0/34 sentencias/líneas, 0/5 ramas y 0/12 funciones). Unidad test-only: no implica
un defecto ni permite mutar datos del servidor normal.

**Contrato:** selección vacía o confirmación cancelada no produce escrituras; confirmar vaciado/borrado
envía una petición por ID válido en paralelo y mantiene el flujo aun si falla una fila; tras completarse
se limpia/refresca la tabla y se muestra un único toast. El lote de utensilios actualiza disponibilidad
para los IDs seleccionados, tolera errores individuales y vuelve a cargar el catálogo. Usar únicamente
signals, promesas y observables sintéticos, sin almacenamiento ni servicios reales.

- [x] Añadir primero pruebas unitarias para lote vacío, cancelar confirmación, IDs inválidos, éxito y
      rechazo individual en vaciar/borrar, y actualización/carga de utensilios.
- [x] Alcanzar ≥70 % S/B/F/L en `pantry.component.ts:1716–1793`; repetir prueba focal y suite frontend
      completa manteniendo el gate global ≥80 %.
- [x] Registrar comandos/resultados y rollback; ejecutar Prettier, `check:ui`, build, typecheck E2E,
      `git diff --check`, hooks completos, commit atómico, push y CI verde. Sin cambio de UI, E2E/capturas
      nuevas no aplican; el E2E de éxito existente sigue siendo evidencia complementaria.

**Rollback:** retirar únicamente las pruebas de acciones por lote y esta subunidad; no cambiar la
implementación ni las operaciones persistidas.

**Evidencia local (2026-10-10):** `pnpm --filter @hogaria/web exec ng test --no-watch --include
src/app/features/pantry/pantry.component.spec.ts --browsers=ChromeHeadlessLocal` pasó **24/24**. El run
con `--code-coverage` también pasó las **24/24** pruebas; su exit code 1 se debe únicamente a que el
subset no alcanza el gate global configurado de 80 % (20.57/7.54/12.34/22.45 % S/B/F/L), sin cambiar
ningún umbral. El LCOV focal medido en `pantry.component.ts:1716–1793` alcanzó **94.1/100/83.3/94.1 %
S/B/F/L** (32/34 sentencias/líneas, 5/5 ramas, 10/12 funciones). `pnpm run test:client` pasó **1308/1308**
con cobertura global **93.08/84.43/92.08/94.40 % S/B/F/L**. También pasaron `pnpm run typecheck:e2e`,
`pnpm run check:ui` (212 ficheros/21 reglas), `pnpm run build`, Prettier focal y `git diff --check`.
El build conserva warnings preexistentes de imports/optional chaining y budgets. Sin cambio de producto,
API ni UI; no se escribieron datos persistentes ni se llamó a proveedores.

**Publicación y CI (2026-10-10):** commit atómico `15c5335` con pruebas y spec pasó Lefthook
pre-commit/pre-push, se publicó en la rama del PR y su CI `38038159189` pasó **9/9 jobs**.

### QA-04c.I18N-SERVICE.1 · cobertura de idioma y mensajes localizados

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md §12t-R` fija `I18nService` como responsable de resolver `es/en/auto`, actualizar el locale de fechas/números al cambiar idioma y componer frases localizadas; `i18n.service.ts` implementa además selección persistida, `languagechange`, fallback de diccionario, interpolación, plurales y tiempos relativos. No existe `i18n.service.spec.ts`; el uso indirecto en otras pruebas deja este servicio en **69.23/31.58/69.23/72.34 % S/B/F/L** (36/52 sentencias, 12/38 ramas, 9/13 funciones, 34/47 líneas). La cobertura baja no prueba un fallo de producto: faltan pruebas unitarias directas de rutas existentes. Alcance test-only, sin cambiar traducciones, producción, preferencias ajenas ni llamadas externas.

**Contrato de esta unidad:** probar selección persistida válida/inválida y detección del navegador; que `auto` reaccione a `languagechange` y los idiomas explícitos no, que el efecto alinee `<html lang>` y `dateLocale()`, y que los cambios se guarden en `STORAGE_KEYS.language`. Cubrir traducción disponible/fallback/clave ausente, advertencia solo en desarrollo, sustitución de parámetros repetidos y `null`, plural singular/plural y todas las formas de `relativeTime()` (vacío, ahora, unidades pasadas/futuras y fechas con/sin año). Cada spec restaura storage, idioma global y locale para aislar la suite.

- [x] Añadir primero `i18n.service.spec.ts` y cubrir las rutas del contrato contra la implementación actual; no cambiar producción si las expectativas pasan.
- [x] Cubrir ramas auto/explicit y los estados de `languagechange`, fallback de locale/diccionario, advertencia, parámetros/plural y clases de tiempo relativo con reloj controlado.
- [x] Elevar `i18n.service.ts` a ≥70 % en statements/branches/functions/lines; repetir suite completa ≥80 % global, build, `typecheck:e2e`, `check:ui`, formato y `git diff --check` sin alterar gates.
- [x] Registrar evidencia reproducible y rollback; ejecutar hooks completos, commit atómico, push y CI del SHA de implementación.

**Evidencia local y publicación (2026-10-09):** el spec focal pasa **11/11** en Chrome Headless 154; no fue necesario modificar producción. `pnpm run test:client` pasó primero **1256/1256** con cobertura **91.69/83.07/90.20/93.13 % S/B/F/L**; `i18n.service.ts` quedó en **100/100/100/100 %** (52/52 sentencias, 38/38 ramas, 13/13 funciones, 47/47 líneas). Tras añadir la unidad de compra sugerida, la suite actual pasa **1264/1264** y conserva esos 100 %; `pnpm run build`, `typecheck:e2e`, `check:ui`, formato y `git diff --check` pasaron. El spec restaura `STORAGE_KEYS.language`, `<html lang>`, `dateLocale()`, `environment.production`, `navigator.language` y la clave de diccionario temporal al terminar cada caso. Commit `13ed97c` con hooks completos; CI run **#636 (`37932210836`)** sobre el HEAD sucesor `ae46a63` pasó **9/9** jobs. Sin E2E visual (solo test unitario), IA ni escrituras fuera de almacenamiento temporal/local del test.

**Rollback:** retirar solo el nuevo spec y este bloque; no hay cambios de producción ni datos.

### QA-04c.SHOPPING-SUGGESTED.COMPONENT.1 · contrato del modal de compra sugerida

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md §12al` define el botón minimalista, el modal con
motivo/tienda/precio y las acciones distintas de crear o actualizar. La E2E
`tests/e2e/shopping-suggested.spec.ts` verifica ya el flujo real de extremo a extremo, incluida la
preservación de líneas compradas al actualizar; faltaba una prueba unitaria directa de
`ShoppingSuggestedComponent`, que calcula estados/total, asigna variante a cada motivo y orquesta
loading, toast, cierre y evento. El último LCOV completo disponible (HEAD `13ed97c`) mide el renderer
en **9.68/0/0/9.68 % S/B/F/L** (3/31 sentencias/líneas, 0/12 ramas, 0/12 funciones). Esta unidad añade
pruebas de la frontera Angular con servicios sintéticos controlables; no cambia producción ni duplica
la prueba del motor/almacenamiento del servidor.

**Contrato de pruebas:** una sugerencia con lista abierta mantiene la entrada visible aunque no haya
filas; sin filas ni lista no se ofrece acción. Abrir vuelve a cargar y abre el modal; cerrar lo oculta.
Las cuatro causas asignan variantes declaradas; el total suma solo precios conocidos y el formato de
euros conserva coma decimal. `aplicar()` no duplica solicitudes mientras trabaja; un resultado fallido
no muestra éxito, cierra ni emite; crear y actualizar muestran el copy correcto, cierran y emiten una vez.
Usar reloj/promesas y señales controladas, sin red, IA ni almacenamiento real.

- [x] Añadir primero tests del componente real para visibilidad/estados del modal, los cuatro motivos,
      total/precios opcionales, carga al iniciar/abrir y cierre.
- [x] Cubrir aplicación exitosa nueva/actualización, resultado fallido y doble invocación concurrente;
      comprobar toast localizado, cierre y emisión exactamente una vez.
- [x] Superar ≥70 % en statements/branches/functions/lines del componente y mantener ≥80 % global en
      la suite frontend; ejecutar la E2E existente de compra sugerida en Chromium y Pixel 5 aislados.
- [x] Ejecutar build, typecheck, `check:ui`, formato y `git diff --check`; registrar rollback, hooks,
      commit, push y CI sin bypass. Sin cambio visual: capturas nuevas N/A.

**Evidencia y cierre (2026-10-09):** Karma focal sin coverage pasa **8/8**. El run focal instrumentado
también pasa 8/8, y `shopping-suggested.component.ts` alcanza **100/100/100/100 % S/B/F/L**; el proceso
focal sale 1 únicamente porque el reporte parcial agrega 14.38/4.52/7.91/15.52 % contra el gate global
de 80 % (no se cambia el gate). La suite completa `pnpm run test:client`, con LCOV archivado fuera del
repo en `%TEMP%\hogaria-shopping-suggested-full-20261009`, pasa **1264/1264**, con **92.06/83.35/90.66/
93.49 % S/B/F/L**. La E2E existente `shopping-suggested.spec.ts`, con runner aislado, rate limit activo,
SQLite/puertos/semilla temporales y cleanup, pasa **2/2** (Chromium y Pixel 5); se recorren crear y
actualizar conservando lo comprado. No se llama a IA/WebAPI ni se modifican datos normales. Sin cambios
visuales; capturas adicionales N/A. El build pasó con warnings previos de budgets/imports; typecheck
E2E, `check:ui` (212 ficheros/21 reglas), Prettier y `git diff --check` también pasaron. Commit
`ae46a63` (`test(shopping): cover suggested list modal`): pre-commit pasó Prettier/check-ui; pre-push
pasó formato/check-ui, builds, typecheck E2E, config **11/11**, Karma **1264/1264** (gate global verde)
y server **1236 pasadas/1 omitida**. Push completado sin bypass; CI run **#636 (`37932210836`)** pasó
**9/9** jobs. PR #41 sigue Ready for review, abierto y sin merge.

**Rollback:** retirar solo `shopping-suggested.component.spec.ts` y esta subunidad; no se toca el
componente ni el flujo persistido.

### QA-04c.HOME-PROFILE-PICKER.1 · cobertura directa del selector de perfil

**Fuente revalidada (2026-10-09, HEAD `c8b85de`):** `HOGARIA-SPEC.md §8b` fija el mismo control de
nivel de cocina y módulos para el tour y Preferencias: selección compartida, nivel con efecto sobre
el detalle inicial de receta, módulos todavía no disponibles marcados «pronto» y valores por defecto
traducidos que admiten overrides por pantalla. `home-profile.spec.ts` ya cubre el modelo y
`tests/e2e/onboarding.spec.ts` y `tests/e2e/preferences.spec.ts` recorren persistencia real; no hay
una spec directa del componente, así que sus ramas de presentación/outputs quedan sin contrato
unitario. El LCOV completo mide `home-profile-picker.component.ts` **70.59/66.67/60/70.59 % S/B/F/L**
(12/17 líneas, 8/12 ramas, 6/10 funciones). Alcance limitado al selector y su evento de salida; no
cambiar guardado ni persistencia del perfil.

**Contrato de pruebas:** defaults de etiquetas provienen de `I18nService` al leer y cada `@Input`
explícito los reemplaza; cambiar nivel o marcar/desmarcar módulo emite un perfil completo preservando
el otro campo. La selección activa y la pista de efecto deben reflejar el nivel nuevo en el mismo
ciclo tras un click (sin valor cacheado), también al recibir un perfil actualizado. Renderizar
indicación «pronto» del módulo no disponible y los modos `askForLevel`/`askForModules` sin controles
ajenos; la pista opcional de nivel solo aparece si se pasa. Usar I18n y perfil deterministas, sin
API/storage reales.

- [x] Añadir pruebas Angular directas del componente para getters traducidos/overrides, opciones,
      selección, hint opcional, marcas pronto y visibilidad configurable de secciones.
- [x] Probar clicks/cambios de nivel y módulos, outputs completos, preservación del estado no editado
      y actualización de la pista de efecto; si falla, corregir mínimamente el selector. Alcanzar
      ≥70 % S/B/F/L del componente y mantener ≥80 % global en Karma.
- [x] Repetir `tests/e2e/onboarding.spec.ts` y `tests/e2e/preferences.spec.ts` en Chromium/Pixel 5 con
      `node scripts/run-isolated-playwright.mjs`; guardar e inspeccionar el selector antes/después del
      cambio en ambos proyectos, con perfil sintético y sin datos personales. Typecheck/build/check-ui/
      formato/diff-check, rollback, hooks, commit, push y CI sin bypass.

**Evidencia TDD y pruebas (2026-10-09):** el test nuevo falló primero
**2/8** porque `computed()` cacheaba la clave derivada de un `@Input` no reactivo; cambiar el nivel en
la misma instancia no refrescaba la pista. Convertir la expresión en un método que lee el perfil actual
hizo pasar la prueba focal **8/8**. Karma completo pasó **1272/1272**, global **92.12/83.40/90.81/93.55 %
S/B/F/L**; LCOV de `home-profile-picker.component.ts`: **100/83.33/100/100 % S/B/F/L**. E2E aislada,
`E2E_RATE_LIMIT=on`, Chromium y Pixel 5, ambos specs: **26/26**, SQLite/semilla temporales y cleanup
confirmado. `typecheck:e2e`, `check:ui` (212 archivos/21 reglas), build y `git diff --check` pasan; el
build conserva avisos de presupuesto/imports existentes. Capturas sintéticas inspeccionadas:
`%TEMP%\hogaria-home-profile-picker-ui-2a9a92e2d085417bbbddc682f5fc51a8\` (`chromium` y
`mobile-chrome`, `beginner`/`expert`); no se guardaron en Git.

**Cierre (2026-10-09):** pre-commit aprobó Prettier y `check:ui` (212 archivos/21 reglas). Pre-push
aprobó formato, `check:ui`, build, `typecheck:e2e`, configuración **11/11**, Karma **1272/1272** y
Vitest server **1236 pasadas/1 omitida**, sin bypass. Commit `5dbf992` (`fix(profile): refresh cooking
level hint`) publicado. CI #641 (`37939214848`) pasó **9/9** jobs; PR #41 continúa abierto, Ready for
Review y sin merge.

**Validación de esta especificación (2026-10-09):** contrato revalidado en fuentes vigentes;
`pnpm exec prettier --check APP-QA-SPEC.md` y `git diff --check` pasan.

**Rollback:** retirar solo `home-profile-picker.component.spec.ts`, esta subunidad y, si hiciera falta,
la corrección mínima del selector; no se cambia el modelo ni persistencia.

### QA-04c.CATALOG-LABEL-PIPE.1 · contrato de traducción del pipe de catálogo

**Fuente revalidada (2026-10-09, HEAD `aeffa17`):** `catalog-label.pipe.ts` deja el dato persistido
intacto y traduce solo nombres sembrados; el pipe impuro consulta `changeTick()` antes de resolver la
etiqueta para seguir cambios de idioma. `catalog-label.spec.ts` cubre el helper puro, pero no hay
pruebas directas de `CatalogLabelPipe` ni de su integración con `I18nService`. LCOV completo vigente:
**50/100/25/50 % S/B/F/L** (3/6 sentencias y líneas, 4/4 ramas y 1/4 funciones).

**Contrato:** con I18n determinista, el pipe pasa la clave del nombre sembrado a `t` y devuelve su
traducción; nombres escritos por una persona pasan intactos; `null`, `undefined` y `''` siguen vacíos
y no buscan una clave. Cada llamada lee `changeTick()`, incluso para nombres ajenos, sin tocar storage,
diccionarios globales ni datos reales.

- [x] Añadir pruebas Angular directas de `CatalogLabelPipe` con un `I18nService` falso: nombre conocido,
      clave/traducción y lectura de `changeTick()`.
- [x] Cubrir nombres personalizados y valores ausentes/vacíos, sin llamar `t` cuando no hay clave;
      lograr ≥70 % S/B/F/L del pipe y mantener ≥80 % global en Karma.
- [x] Ejecutar Karma focal y suite completa, build/typecheck/check-ui/formato/diff-check; no cambia
      UI ni geometría, así que E2E/capturas nuevas N/A. Registrar rollback, hooks, commit, push y CI.

**Evidencia de cobertura (2026-10-09):** `catalog-label.pipe.spec.ts`
focal pasa **2/2**; junto con `catalog-label.spec.ts`, el run instrumentado pasa **7/7**. El proceso
focal instrumentado devuelve exit 1 solo por aplicar el gate global a ese subconjunto (**29.12/4.76/
11.11/31.73 % S/B/F/L**); no se alteró el umbral. LCOV focal de `catalog-label.pipe.ts`:
**100/100/100/100 % S/B/F/L**. La suite completa pasa **1274/1274**, global
**92.16/83.40/90.92/93.59 % S/B/F/L**; LCOV archivado fuera de Git en
`%TEMP%\hogaria-catalog-label-pipe-full-20261009\lcov.info`. No se cambió producción, UI ni storage.
El pre-commit aprobó Prettier y `check:ui` (212 archivos/21 reglas); el pre-push aprobó formato,
`check:ui`, build, `typecheck:e2e`, configuración **11/11**, Karma **1274/1274** y Vitest server
**1236 pasadas/1 omitida**, sin saltar hooks. Commit `aeffa17` (`test(i18n): cover catalog label pipe`)
publicado; CI #644 (`37943374621`) pasó **9/9** jobs.

**Validación spec-first (2026-10-09):** el contrato y el baseline se contrastaron con el código actual;
`pnpm exec prettier --check APP-QA-SPEC.md` y `git diff --check` pasan. No se requieren E2E ni capturas
porque esta unidad solo añade cobertura unitaria y no altera UI/geometría.

**Rollback:** retirar solo las pruebas directas nuevas y este subapartado; no cambia el helper, el pipe,
el diccionario ni la persistencia.

### QA-04c.ICON-FALLBACK.1 · fallback seguro ante nombres de icono desconocidos

**Fuente revalidada (2026-10-09, HEAD `b3d1925`):** `HOGARIA-SPEC.md §8f` mantiene los iconos como
SVG locales, sin dependencia de red, y exige nombres/etiquetas accesibles según su uso. `IconComponent`
acepta en TypeScript solo `IconName`, pero el getter verifica `hasIcon()` en runtime y devuelve `null`
para entradas inesperadas; el SVG conserva un `viewBox` por defecto y no renderiza paths. La spec actual
cubre formas conocidas, estado decorativo/etiquetado y tamaño relativo, pero no esa rama defensiva.
LCOV vigente de `icon.component.ts`: **100/50/100/100 % S/B/F/L** (5/5 líneas y 1/2 ramas).

**Contrato:** si en runtime llega un nombre obsoleto o desconocido, el componente no lanza error, produce
el SVG vacío con `viewBox="0 0 24 24"` y mantiene la semántica decorativa (`role="presentation"`,
`aria-hidden="true"`). Alcance test-only; no cambiar el registry, los tipos ni los templates de producción.

- [x] Añadir una prueba Angular directa con nombre desconocido en runtime; comprobar fallback visual
      vacío, accesibilidad decorativa y ausencia de excepción.
- [x] Cubrir ≥70 % S/B/F/L en `icon.component.ts` y mantener ≥80 % en las cuatro métricas globales.
- [x] Ejecutar prueba focal y Karma completo, build/typecheck/check-ui/formato/diff-check. No modifica
      UI/geometría, así que E2E/capturas nuevas N/A.
- [x] Pasar los hooks obligatorios y registrar commit/push y CI verde; conservar el rollback descrito.

**Validación spec-first (2026-10-09):** el contrato de §8f y la rama actual del getter se verificaron;
el baseline procede de la suite Karma completa **1274/1274**, **92.16/83.40/90.92/93.59 % S/B/F/L**.
`pnpm exec prettier --check APP-QA-SPEC.md` y `git diff --check` pasan. La subunidad se publicó antes
de añadir la prueba en `2764395` (`docs(qa): scope icon fallback tests`).

**Evidencia de la prueba (2026-10-09):** no hubo cambio de producción; la prueba de caracterización
se ejecutó primero contra el comportamiento actual. Karma focal pasó **7/7**; `pnpm run test:client`
pasó **1275/1275**, global **92.16/83.42/90.92/93.59 % S/B/F/L**. Build, `typecheck:e2e`, `check:ui`
(212 archivos/21 reglas), Prettier y `git diff --check` pasan; el build deja avisos Angular de presupuesto,
imports no usados y optional chaining ya reflejados por el build. LCOV actual de `icon.component.ts`
confirma **100/100/100/100 % S/B/F/L** (5/5 sentencias y líneas, 2/2 ramas, 2/2 funciones), en
`frontend/coverage/lcov.info` (ignorado por Git). Formato del test y `git diff --check` pasan. Los gates
locales están completos. Pre-commit aprobó Prettier y `check:ui` (212 archivos/21 reglas); pre-push aprobó
formato, `check:ui`, build, `typecheck:e2e`, configuración **11/11**, Karma **1275/1275** y Vitest
server **1236 pasadas/1 omitida**, sin bypass. Commit `06ca504` (`test(ui): cover unknown icon fallback`)
publicado; CI #647 (`37947337476`) pasó **9/9** jobs. Los avisos actuales de build no bloquean el gate.

**Rollback:** retirar solo la nueva prueba y este subapartado; no cambia el registry ni el renderizado.

### QA-04c.AVATAR-IMAGE.1 · cubrir decodificación, canvas y cleanup de la foto de perfil

**Fuente revalidada (2026-10-09, HEAD `f4b8462`):** `HOGARIA-SPEC.md` §12j exige aceptar JPEG/PNG/WebP hasta 4 MiB, recortar una región cuadrada y re-encodear a JPEG de 128 px desde el dispositivo. `avatar-image.spec.ts` prueba ahora la validación pura, `squareCrop`, la decodificación real/fallback, canvas y liberación; producción permanece sin cambios. El baseline antes de esta unidad era **34.78/26.32/25.00/34.78 % S/B/F/L** (16/46 líneas, 5/19 ramas, 3/12 funciones), archivado en `%TEMP%\hogaria-coverage-avatar-image-baseline-a09d4e9-20261009.lcov`.

**Contrato:** la decodificación prefiere `createImageBitmap`; si falla, usa `<img>` con una URL de objeto y la revoca al resolver o rechazar. Los ficheros inválidos se rechazan antes de decodificar. Canvas configura smoothing, usa exactamente la región compartida con el editor y devuelve JPEG con la calidad contractual; sin contexto lanza `AvatarIssue`. Los bitmaps se liberan también si falla el recorte/render. No cambiar producción salvo que una regresión revele una discrepancia real.

- [x] Añadir pruebas de ChromeHeadless para el camino válido y los errores de `decodeAvatarFile`, incluyendo fallback `<img>` y revocación de URL sin dejar recursos vivos.
- [x] Probar el render real/sintético de canvas: dimensiones, smoothing, región recibida, MIME/calidad de salida, contexto ausente y liberación en éxito/error.
- [x] Ejecutar la suite focal y la suite cliente completa; alcanzar **≥70 % en S/B/F/L** para `avatar-image.ts` y mantener **≥80 % global** sin alterar gates. Archivar LCOV fuera de Git, y ejecutar build/typecheck/formato/diff-check.
- [x] Registrar comandos, resultados y rollback; commit atómico con hooks completos y push a la rama del PR, sin tocar base/proveedor de uso normal.

**Evidencia QA-04c.AVATAR-IMAGE.1 (2026-10-09):** la suite focal
`pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/avatar-image.spec.ts --browsers=ChromeHeadless --progress=false`
pasó **13/13**. `pnpm run test:client`, ejecutado por el hook pre-push, pasó **1242/1242**; cobertura global **91.50/82.44/90.03/92.94 % S/B/F/L**. En el informe LCOV/HTML de
`%TEMP%\hogaria-coverage-avatar-image-final-20261009-0849`, `avatar-image.ts` alcanzó **100/94.73/100/100 % S/B/F/L** (52/52 statements, 18/19 ramas, 12/12 funciones, 46/46 líneas). El código de producción no cambió.

El hook pre-push completo pasó: format-check, `check:ui` (211 ficheros, 21 reglas), build, `typecheck:e2e`, configuración **11/11**, suite cliente **1242/1242** y servidor **1236 pasadas/1 omitida**. `git diff --check` también pasó. No hay cambio de comportamiento UI que requiera E2E/capturas; no se tocaron base de datos, proveedor ni artefactos personales. Rollback: retirar las pruebas añadidas en `frontend/src/app/core/avatar-image.spec.ts` y este subapartado, sin modificar producción.

**Rollback:** retirar solo las pruebas de `avatar-image.spec.ts` agregadas en esta unidad y este subapartado; no cambiar la conducta de producción ni la cuenta/datos reales.

### QA-04c.CONFIRM-SERVICE.1 · cubrir el ciclo de vida de confirmación destructiva

**Fuente revalidada (2026-10-09, HEAD `700e812`):** `HOGARIA-SPEC.md` §B exige que todo borrado destructivo pase por `ConfirmService`. `confirm-dialog.component.spec.ts` sustituye el servicio por spies, de modo que comprueba el cableado del diálogo pero no las promesas/señal del servicio; no existe un `confirm.service.spec.ts`. La corrida base `pnpm run test:client` pasó **1213/1213** con gate global verde. El LCOV actual del servicio marca **8.33/0/0/8.33 % S/B/F/L** (1/12 líneas, 0/0 ramas reportadas, 0/5 funciones); informe archivado en `%TEMP%\hogaria-coverage-qa-20261009-0207\lcov.info`.

**Contrato:** `confirm(options)` publica la petición activa; si ya hay una, resuelve la anterior como cancelada antes de sustituirla. `accept()` resuelve `true` y limpia la señal; `cancel()` resuelve `false` y limpia la señal. Aceptar/cancelar sin petición activa son no-op seguros. No deben quedar promesas pendientes tras reemplazar una petición.

- [x] Añadir una suite unitaria focal que use el `ConfirmService` real y verifique señal inicial, petición/opciones activas y resolución verdadera/falsa tras aceptar/cancelar.
- [x] Cubrir reemplazo de petición (la anterior resuelve `false`, la nueva conserva sus opciones y termina normalmente) y llamadas redundantes a aceptar/cancelar sin petición.
- [x] Ejecutar pruebas focales y la suite frontend completa; alcanzar ≥70 % en cada métrica instrumentada de `confirm.service.ts` (S/F/L) y mantener ≥80 % global sin cambiar configuración ni umbrales. B se registra como no aplicable si LCOV reporta 0 ramas.
- [x] Archivar el LCOV final fuera de Git; ejecutar Prettier y `git diff --check`. No tocar el diálogo ni lógica de producción, pues las regresiones pasaron.
- [x] Ejecutar build de producción, `typecheck:e2e`, Prettier focal y `git diff --check`; conservar los avisos previos del bundle sin rebajar gates.
- [x] Completar hooks de commit/push sin bypass y anotar sus resultados antes de cerrar la unidad.

**Evidencia de pruebas/cobertura (2026-10-09):** Karma focal
`pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/services/confirm.service.spec.ts --browsers=ChromeHeadless --progress=false` pasó **4/4**. La corrida completa `pnpm run test:client` pasó **1217/1217** con **90.54/81.61/89.32/91.99 % S/B/F/L** global. `confirm.service.ts` quedó en **100 % statements, B no aplicable (0/0 ramas instrumentadas), 100 % funciones y 100 % líneas** (12/12 líneas, 5/5 funciones). LCOV final: `%TEMP%\hogaria-coverage-confirm-service-20261009-0211\lcov.info`. Prettier focal, `git diff --check`, `pnpm run build` y `pnpm run typecheck:e2e` pasan; el build conserva los warnings previos de budget/imports. Publicación (2026-10-09): commit `d2bc61a`; pre-commit pasó Prettier y `check:ui` (210 ficheros, sin incidencias). Pre-push pasó formato, `check:ui`, builds de servidor/cliente, `typecheck:e2e`, tests de config 10/10, Karma 1217/1217 y Vitest server 1234 passed / 1 skipped. Push completado sin bypass; PR #41 sigue Draft y sin merge.

### QA-04c.SHOPPING-REFRESH.1 · temporizador de refresco determinista

**Fuente revalidada (2026-10-09, HEAD `ef1d55f`):** `ShoppingListsComponent.refresh()` pone `refreshing=true` y programa `refreshing=false` tras **500 ms** (`shopping-lists.component.ts:1231-1235`). La prueba `refreshes and creates only valid trimmed lists...` llama al método y solo afirma el estado inmediato; deja el callback de `setTimeout` a merced del reloj real. Comparar los LCOV de las tres corridas completas detectó que el único hit variable era `(anonymous_24)` en `shopping-lists.component.ts:1235` (**1 → 0** en el run más reciente); el global sigue sobre 80 %, pero la cobertura actual no es reproducible.

**Contrato:** el indicador de actualización queda activo durante 499 ms y se apaga exactamente al cumplir 500 ms. La prueba debe controlar el reloj, no dormir ni depender de la carga del runner. No se cambia producción ni se llaman servicios reales.

- [x] Añadir primero una prueba con `fakeAsync`/`tick`: estado activo al inicio y a 499 ms, inactivo a 500 ms.
- [x] Ejecutar Karma focal y dos corridas completas de `pnpm run test:client`; en ambas, la función del callback de 500 ms debe quedar cubierta y las cuatro métricas globales deben superar 80 %.
- [x] Archivar LCOV fuera de Git y comprobar `shopping-lists.component.ts` ≥70 % en las cuatro métricas instrumentadas.
- [x] Ejecutar formato, `git diff --check`, build/typecheck y hooks de commit/push sin bypass; mantener abierta la auditoría global QA-04c por sus otros déficits.

**Evidencia inicial de variabilidad (2026-10-09):** las corridas ejecutadas durante el pre-push de `d2bc61a` pasaron 1217/1217; la cobertura varió entre **90.53–90.54 % S**, **81.61 % B**, **89.28–89.32 % F** y **91.99 % L**. Al comparar `FNDA`, la única función diferencial fue el timeout de 500 ms de `refresh()`; informes previos archivados fuera de Git: `%TEMP%\hogaria-coverage-shopping-refresh-baseline-20261009-0214\lcov.info` (última corrida) y `%TEMP%\hogaria-coverage-confirm-service-20261009-0211\lcov.info`.

**Evidencia de cierre (2026-10-09):** Karma focal `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/shopping/shopping-lists.component.spec.ts --browsers=ChromeHeadless --progress=false` pasó **12/12**; `fakeAsync`/`tick(499+1)` demuestra el cambio exacto sin dormir. Tres corridas manuales completas de `pnpm run test:client` pasaron **1217/1217** y la corrida completa del hook pre-push pasó **1218/1218** con **90.54/81.61/89.32/91.99 % S/B/F/L**; las cuatro LCOV muestran `FNDA=2` para el callback. `shopping-lists.component.ts`: **95.43/86.8/91.8/97.14 % S/B/F/L**. Informe final: `%TEMP%\hogaria-coverage-shopping-refresh-prepush-20261009-0222\lcov.info`; comparación pre-test: `%TEMP%\hogaria-coverage-shopping-refresh-baseline-20261009-0214\lcov.info`. Build y `typecheck:e2e` pasaron con los warnings previos de budget/imports. Commit `4da6ca8` (`test(shopping): cover refresh timeout`) pasó pre-commit (Prettier, `check:ui`) y pre-push (formato, `check:ui`, builds servidor/cliente, typecheck E2E, config 10/10, Karma 1218/1218, Vitest server 1234 passed / 1 skipped); push completado sin bypass. PR #41 sigue Draft y sin merge. El callback de viewport del picker quedó cubierto en `QA-04c.PICKER-VIEWPORT.1`; QA-04c global permanece abierta por otros déficits.

### QA-04c.PICKER-VIEWPORT.1 · cobertura determinista del reposicionamiento flotante

**Fuente revalidada (2026-10-09, HEAD `7f7f375`):** `PickerComponent.ngOnInit()` registra `resize` y
`scroll` en captura; `ngOnDestroy()` los elimina. La función `onViewportChange` (`picker.component.ts:426`)
delega en `positionFloatingPanel()`, que solo reposiciona un menú abierto con `floatingPanel=true`.
`picker.component.spec.ts` cubre apertura y orientación inicial, pero no dispara esos eventos. El último
LCOV de la suite completa pasó **1218/1218** con **90.54/81.61/89.32/91.99 % S/B/F/L** global; el
callback de línea 426 registró `FNDA=0`.
Baseline archivado fuera de Git: `%TEMP%\hogaria-coverage-picker-baseline-20261009-023005\lcov.info`.

**Contrato:** con el menú flotante abierto, cambios sintéticos de la geometría del trigger seguidos por
`resize` y `scroll` deben recalcular la posición del panel. Destruir el fixture elimina ambos listeners:
eventos posteriores no deben cambiar la última posición. Usar rectángulos sintéticos y eventos directos,
sin sleeps, servicios reales ni cambios de producción.

- [x] Añadir primero una prueba unitaria que verifique reposicionamiento en `resize` y `scroll` y ausencia
      de callback tras destruir el componente.
- [x] Ejecutar Karma focal y suite frontend completa; demostrar que el callback queda cubierto y mantener
      ≥70 % en S/B/F/L por archivo y ≥80 % global en todas las métricas, sin relajar gates.
- [x] Ejecutar formato, `git diff --check`, build, `typecheck:e2e` y hooks de commit/push sin bypass; anotar
      evidencia antes de cerrar la unidad.

**Evidencia de cierre (2026-10-09):** la prueba focal `pnpm --filter @hogaria/web exec ng test
--no-watch --include=src/app/shared/components/ui/picker/picker.component.spec.ts
--browsers=ChromeHeadless --progress=false` pasó **14/14**. `pnpm run test:client` y el hook pre-push
pasaron **1219/1219**, **90.69/81.87/89.35/92.15 % S/B/F/L** global. `picker.component.ts` quedó en
**92.39/82.20/97.44/95.03 % S/B/F/L**; el callback de línea 426 registró `FNDA=2`. La prueba mueve el
panel mediante geometría sintética en `resize` y `scroll`, y confirma que el cleanup impide cambios tras
destruir el fixture. LCOV/HTML pre-push: `%TEMP%\hogaria-coverage-picker-prepush-20261009-023703`.
`pnpm run build`, `pnpm run typecheck:e2e`, Prettier y `git diff --check` pasaron; el build conserva
advertencias previas de presupuesto/importaciones. Commit `0bf2713` (`test(ui): cover picker viewport
events`) pasó hooks pre-commit y pre-push completos (formato, `check:ui`, builds, typecheck, config 10/10,
Karma 1219/1219, Vitest server 1234 passed / 1 skipped) y fue publicado sin bypass. PR #41 sigue Draft;
QA-04c global permanece abierta por déficits ajenos a esta subunidad.

**Rollback:** retirar solo esta suite y la subunidad; no cambiar `PickerComponent` de producción salvo que
la regresión demuestre un defecto distinto.

### Unidad QA-04c.SWIPE-DIRECTIVES.1 · cobertura de los gestos de compra

**Fuente revalidada (2026-10-08):** el contrato vigente de `HOGARIA-SPEC.md` §8e fija revelar el riel al superar 56 px, confirmar quitar al 60 % del ancho, sumar una unidad a la derecha con `max(56 px, 35 %)`, pulsación larga de 350 ms y prioridad del scroll vertical. También exige que el gesto no se convierta en un tap residual y permite iniciar el swipe sobre botones de la fila, salvo controles con `data-gesture-stop`. `shopping-lists.spec.ts` ya ejercita reveal, quitar/undo, +1 y selección por pulsación larga en Chromium/Pixel 5. Sin embargo, `swipe-row.directive.spec.ts` solo prueba siete casos de las funciones puras y no ejecuta los dos ciclos de vida de directiva. El LCOV de la suite completa actual registra para `swipe-row.directive.ts` **10.09/11.11/11.76/10.09 % S/B/F/L** (11/109 líneas, 5/45 ramas, 2/17 funciones); esta unidad añade cobertura unitaria sin duplicar la E2E de producto.

**Alcance:** probar `SwipeRowDirective` y `LongPressDirective` contra el contrato y los handlers actuales; no cambiar producción si las pruebas confirman el comportamiento existente. Si una regresión revela discrepancia, registrar primero su criterio y prueba roja antes de corregir.

**Discrepancia a reproducir (2026-10-08):** durante el arrastre izquierdo, `onPointerMove()` escribe un desplazamiento negativo; al soltar, `onPointerEnd()` llama `apply()` con un desplazamiento positivo. El consumidor transforma `.detail__face` directamente con `translateX(var(--swipe-x))`, mientras `.detail__rail` está anclado a la derecha. Esto contradice §8e: el gesto debe dejar accesibles los botones del riel derecho. La E2E existente solo usa `toBeVisible()` —que no prueba hit-testing—, así que se añadirá una aserción con `document.elementFromPoint()` al botón expuesto antes de cambiar producción.

- [x] Añadir pruebas de ciclo de vida de `SwipeRowDirective`: puntero izquierdo y propiedad del `pointerId`, exclusiones de controles/`data-gesture-stop`, eje vertical, movimiento bajo umbral, reveal/cierre, +1 por umbral, quitar al 60 %, `gestureEnded`, protección residual de 250 ms y cleanup al destruir.
- [x] Reforzar la E2E del reveal para comprobar que la cara se desplaza hacia la izquierda y el botón `Quitar` del riel derecho es realmente el elemento alcanzable en su centro; confirmar que el test falla en el baseline antes del arreglo.
- [x] Corregir el signo del offset final solo tras confirmar la regresión de hit-testing, preservando umbrales, undo y supresión del tap residual.
- [x] Añadir pruebas temporizadas de `LongPressDirective`: emitir exactamente a 350 ms, cancelar por movimiento o liberación/cancelación temprana, no iniciar con deshabilitado/puntero secundario/controles excluidos y consumir el click posterior una sola vez.
- [x] Alcanzar ≥70 % en statements, branches, functions y lines para el archivo de directivas, conservando los cuatro gates globales de 80 %.
- [x] Ejecutar Karma focal y la suite frontend completa; repetir en Playwright real aislado los casos existentes de swipe/undo/+1/long-press en Chromium y Pixel 5, sin DB ni proveedor de uso normal.
- [x] Registrar cobertura/comandos/resultados actuales.
- [x] Ejecutar formato, typecheck E2E y `git diff --check`.
- [x] Hacer commit atómico con hooks y push al PR sin bypass; registrar después el resultado del CI.

**Rollback:** revertir el commit atómico que añade la spec y las pruebas focales; no elimina gestos existentes ni toca datos.

**Evidencia de regresión y cobertura (2026-10-08):** la prueba E2E endurecida falla antes de la corrección en Chromium y Pixel 5 (**2/2**, el offset se asentaba en `+134px` en lugar de `-134px`). Tras el cambio mínimo en `SwipeRowDirective.onPointerEnd()`, la prueba verifica matriz de transformación, hit-test con `document.elementFromPoint()` y que el check no se active por el gesto. Se desplazó la fila por encima de la barra fija antes del hit-test móvil para confirmar que el contenido puede desplazarse y la CTA no tapa el riel. Karma focal (`pnpm exec ng test --no-watch --code-coverage --include=src/app/shared/directives/swipe-row.directive.spec.ts --browsers=ChromeHeadless --progress=false` desde `frontend`): **19/19**, cobertura de `swipe-row.directive.ts` **99.20/97.77/100/100 % S/B/F/L**. La suite completa `pnpm run test:client`: **1164/1164**, **90.18/81.39/88.97/91.54 % S/B/F/L**. Playwright real aislado con `$env:E2E_RATE_LIMIT='on'` y `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --grep "un arrastre corto descubre|arrastrar del todo borra|deslizar a la derecha suma|pulsación larga entra" tests/e2e/shopping-lists.spec.ts --reporter=line`: **8/8** (reveal/quitar+undo, +1 y pulsación larga en Chromium y Pixel 5); el runner aisló DB, semilla, puerto y limpieza. `pnpm exec prettier --check` sobre los cuatro ficheros de la unidad, `pnpm run typecheck:e2e` y `git diff --check`: salida **0**. Capturas sintéticas comparables, incluidas y revisadas: `.e2e-screenshots/qa-swipe-row-reveal-20261008/desktop.png` (1440×900) y `.e2e-screenshots/qa-swipe-row-reveal-20261008/mobile.png` (Pixel 5); están excluidas por `.gitignore`. La unidad no cambia tokens ni el shell compartido; la auditoría geométrica global sigue abierta.

**CI y publicación (2026-10-08):** commit `28a6a95` (`fix(shopping): expose swipe rail`) publicado en `arena/01a0a6c2-micocinai`; pasaron pre-commit y todos los hooks de pre-push (formato, calidad UI, builds, typecheck E2E, tests de config, Karma frontend **1164/1164** y Vitest server **1225 passed/1 skipped**). CI #460 asociado al SHA `28a6a95e42bdeb1963a5f197e5ea1a3c0322da74`: **9/9 trabajos verdes**, incluidos typecheck, server tests, build, 4 shards E2E y full-stack. PR #41 sigue abierto, `draft=false`, sin merge.

**Informe por archivo histórico (2026-10-01):** `picker.component.ts` 96.90/92.42/100/97.37 %, `shopping.model.ts` 93.55/86.18/100/96.25 %, `shopping-http-error.ts` 100/100/100/100 %. Ese reporte instrumentaba 135 de 182 fuentes de producción TS bajo `frontend/src/app` y medía entonces `shopping.service.ts` 0.29/0/0/0.33 %, `receipts.service.ts` 1.56/0/0/1.58 %, `household.service.ts` 3.33/0/0/1.78 %, `pantry.service.ts` 14.60/1.92/4.46/16.48 % y `calendar.service.ts` 43.60/42.64/15.78/45.94 % (S/B/F/L). Se conserva fuera de Git en `%TEMP%\hogaria-coverage-qa-20261001-1812`; estos porcentajes son históricos, no el informe actual.

### QA-04c.GATE.1 · ejecutar realmente el gate configurado (positivo verificado)

**Fuente y rojo reproducible (2026-10-01):** `frontend/karma.conf.js` declara 80 % global para sentencias, ramas, funciones y líneas, pero `frontend/angular.json` no conecta esa configuración al builder `test`. `ng test --no-watch --browsers=ChromeHeadlessNoSandbox --code-coverage` ejecutó 665/665 y salió `0` pese a los porcentajes inferiores. Cargando explícitamente `karma.conf.js` mediante un config temporal seguro para Chrome, la misma suite ejecutó 665/665, reportó **60.30/52.21/49.80/61.92 %** y falló las cuatro métricas con salida `1`. El launcher temporal se eliminó; no se tocó el umbral. Criterio: el comando estándar debe imponer el gate, no solo imprimirlo.

**Revalidación de fuente/ejecución (2026-10-02):** la opción `projects.hogaria.architect.test.options.karmaConfig` sigue ausente en `frontend/angular.json`; `frontend/package.json` llama `ng test --no-watch --code-coverage` y `test:coverage` agrega `--browsers=ChromeHeadless`, sin pasar la configuración. `frontend/karma.conf.js` mantiene los thresholds globales 80 % en S/B/F/L y el launcher por defecto `ChromeHeadless`. En esta máquina el comando sin config intentó Chrome 154 y falló antes de iniciar los tests por `GPU process isn't usable` (dos intentos); no se atribuye ese resultado al gate. En cambio, al cargar el `karma.conf.js` real con launcher SwiftShader temporal, la suite actual ejecutó 797/797, reportó **75.55/65.61/73.92/77.19 %** y salió `1` por las cuatro métricas; el déficit de ramas sobre 70 % sigue abierto. La verificación local deberá seleccionar el launcher compatible con Windows sin cambiar el launcher predeterminado de CI.

- [x] Reproducir que el comando estándar devuelve éxito con coverage bajo el gate.
- [x] Confirmar que la configuración de Karma existente detecta el mismo déficit y devuelve fallo sin cambiar los thresholds.
- [x] Añadir primero una prueba de configuración que exija al target `test` cargar `karma.conf.js` y preserve sus cuatro thresholds globales.
- [x] Conectar el target `test` estándar a `karma.conf.js`; mantener 80 % en las cuatro métricas y el launcher de CI `ChromeHeadless`.
- [x] Verificar con Chrome local compatible que el comando estándar ejecuta la suite y falla por el baseline bajo, sin fallos de tests; conservar los artefactos de cobertura.
- [x] Probar un caso positivo auténtico donde la suite completa supere 80 % en las cuatro métricas; no fabricar cobertura ni relajar la instrumentación.

**TDD rojo (2026-10-02):** `node --test scripts/karma-coverage-gate.test.mjs` falló 2/2 antes del cambio: el target Angular no declaraba `karmaConfig` y `karma.conf.js` no registraba el launcher local `ChromeHeadlessLocal`. El comando `ng test --no-watch --code-coverage --browsers=ChromeHeadlessLocal` confirmó el launcher no registrado antes de ejecutar tests. La ejecución estándar con `ChromeHeadless` sí falló antes de iniciar tests por la limitación GPU de Chrome en esta máquina; no se contó como evidencia del gate.

**Evidencia de gate conectado (2026-10-02):** ahora `frontend/angular.json` carga `karma.conf.js`; los cuatro thresholds siguen en 80 %, el launcher por defecto continúa `ChromeHeadless` para CI y `ChromeHeadlessLocal` con SwiftShader permite validar aquí. `npm run test:config` pasa **2/2**. `npm run test:coverage -- --browsers=ChromeHeadlessLocal` ejecuta **797/797** pruebas, luego retorna código **1** por statements/branches/functions/lines **75.55/65.61/73.92/77.19 %**, sin bajar umbrales. `node scripts/check-workflows.mjs` valida **5 workflows**; `make ci:yaml` no es invocable con GNU Make en esta máquina Windows porque interpreta los dos puntos del nombre del target. CI remoto no se ejecutó en esta ronda. Los artefactos de coverage permanecen en `frontend/coverage/`.

**Revalidación completa más reciente (2026-10-02 06:06, árbol actual):** desde `frontend`, `npm run test:coverage -- --browsers=ChromeHeadlessLocal --progress=false` ejecutó **844/844** assertions, sin fallos funcionales; terminó con código **1** únicamente porque el gate 80 % recibe **74.97/62.80/72.66/76.47 % S/B/F/L**. El script ya incluye `--browsers=ChromeHeadless`, por lo que el override imprime una advertencia de parámetro duplicado y Karma selecciona el último valor `ChromeHeadlessLocal`; no afecta al umbral. No se redujeron thresholds ni se usaron servidor/base normales; `frontend/coverage/` corresponde a esta corrida.

**Caso positivo auténtico (2026-10-08):** `pnpm run test:client` usa el target estándar Angular con `karma.conf.js`, preserva los cuatro thresholds de 80 % y terminó con **1152/1152** y **88.88/80.44/88.38/90.23 % S/B/F/L** (salida 0). No se fabricó cobertura ni se modificaron exclusiones. El workflow `.github/workflows/ci.yml` todavía valida el cableado de Karma y ejecuta coverage de servidor, pero no corre la suite frontend completa; esa discrepancia permanece registrada en QA-04.

**Rollback:** revertir la unidad del gate restaura el builder Angular sin `karmaConfig`, elimina el guard de configuración/launcher local y quita su step de CI y script de test; no cambia los thresholds ni lógica de producto.

### QA-04c.TESTPORT.UPLOADS.1 · portabilidad de los tests de filesystem en Windows

**Baseline actual (2026-10-02):** `npm run test --prefix server -- src/utils/uploads.spec.ts` reproduce **3 fallos / 6 pases**. `isInside` recibe una ruta POSIX pero usa por defecto el separador del host (`\`); `uploadsRoot` usa `resolve` nativo y el test exige una ruta POSIX literal; y la prueba de solo lectura usa `chmod(0o500)`, que en este NTFS/proceso no impide escribir. `server/src/utils/uploads.ts` expone explícitamente el separador de `isInside` y resuelve las rutas con `node:path`; no se ha observado defecto de producción en esta evidencia. El objetivo es corregir solo las expectativas/fixture para que midan contratos de ruta y fallo de filesystem reproducibles entre hosts.

- [x] Probar ambos separadores explícitamente, comparar `uploadsRoot` con la resolución nativa del host y reemplazar la dependencia de permisos `chmod` por una falla determinista de filesystem; sin cambiar la lógica de producción.
- [x] Ejecutar `uploads.spec.ts` y el build/typecheck del servidor; confirmar sin residuos de archivos en la prueba y actualizar evidencia.
- [x] Repetir la suite server con coverage y registrar todos los fallos restantes; no bajar thresholds ni presentar como verde un gate bloqueado por otras suites.

**Evidencia QA-04c.TESTPORT.UPLOADS.1 (2026-10-02):** rojo aislado inicial: `uploads.spec.ts` **6/9**, con los tres fallos descritos. Después, los separadores POSIX y Windows quedan explícitos, `uploadsRoot` se contrasta con `node:path` del host y el error de filesystem se reproduce mediante un archivo que bloquea la carpeta de destino (sin depender de `chmod`). `afterEach` limpia la carpeta temporal propia. `npm run test --prefix server -- src/utils/uploads.spec.ts` pasa **9/9**; `npm run build --prefix server` y `git diff --check` pasan. La suite completa con coverage mejora de **917/922** a **920/922**; únicamente siguen fallando las dos aserciones estáticas de `pantry-catalog-i18n.spec.ts` contra imports/markup históricos. Al fallar pruebas, Vitest no presenta un resultado verde del gate de coverage. `prettier --check` también falla sobre este archivo en el contenido de `HEAD` anterior a la unidad; no se reformateó el archivo entero para evitar ruido ajeno.

### QA-04c.TESTPORT.CATALOG.1 · consumidores reales de etiquetas del semillero

**Baseline y contrato revalidados (2026-10-02):** `npm run test --prefix server -- src/utils/pantry-catalog-i18n.spec.ts` pasa **17/19**; las dos assertions fallan porque exigen `| catalog` y `CatalogLabelPipe` en `features/onboarding/onboarding.component.ts`. La fuente actual del onboarding son `COMMON_ALLERGENS`, `COMMON_LIKES`, `COMMON_DISLIKES` y `GOAL_OPTIONS` del perfil, presentados por `ChipSelectComponent`/traducciones; no lee nombres sembrados de despensa/utensilios. El catálogo de lectura sí se pinta en Pantry, ingredientes de Recetas y filas de Compra (`| catalog`); los nombres de líneas fotografiadas se conservan como texto propio. Esto coincide con el contrato vivo de preservar las elecciones y emojis de alergias/gustos; añadir el pipe al onboarding para satisfacer un grep traduciría una fuente distinta de la que describe ese test.

**Baseline visual real:** `tests/e2e/onboarding.spec.ts` ejecutada con `scripts/run-isolated-playwright.mjs`, rate limit activo, DB/puertos/semilla temporales y cleanup: **12/12** entre Chromium escritorio y Pixel 5. La ruta directa del test está en código actual; no se accedió al dev server ni a la base de datos normal.

- [x] Limitar la expectativa estática a pantallas que realmente leen el semillero (`pantry`, `recipes`, `shopping-list-detail`); no imponer `CatalogLabelPipe` al onboarding de preferencias.
- [x] Conservar el contrato de dejar `line.name` del ticket intacto y ejecutar las 19 assertions enfocadas.
- [x] Repetir la suite completa de server con coverage, comprobar typecheck/build y `git diff --check`; registrar sin ocultar los fallos que queden, sin cambiar lógica de producción ni thresholds.

**Evidencia QA-04c.TESTPORT.CATALOG.1 (2026-10-02):** ajuste solo de la lista de consumidoras en el test estático; ninguna lógica de producto cambió. `npm run test --prefix server -- src/utils/pantry-catalog-i18n.spec.ts`: **19/19**. La aserción de líneas de ticket (`line.name` crudo y sin `| catalog`) permanece activa. `npm run test:coverage --prefix server -- --reporter=dot`: **45/45 archivos de test, 922/922 pruebas**, salida **0** y coverage **93.97/85.60/95.19/96.66 %** en statements/branches/functions/lines; se satisface el umbral configurado por archivo de 70 % sin alterarlo. `npm run build --prefix server` y `git diff --check` pasan. `prettier --check` ya fallaba para este archivo en el `HEAD` previo; no se reformateó su contenido histórico. La E2E de onboarding citada arriba recorrió Chromium + Pixel 5 con SQLite aislada y cleanup; no se cambió interfaz ni se usó `localhost:4200`.

### QA-04c.TESTPORT.PANTRY-CLOCK.1 · fixture civil frente al reloj UTC de SQLite

**Fuente revalidada (2026-10-02/03):** `pantry.routes.ts` compara caducidades con `date('now')` y documenta UTC como reloj del servidor. El helper `dayFromNow()` del spec usaba getters/setters locales. A las 23:51 UTC del 2 de octubre (01:51 del día 3 en Europe/Madrid), «ayer» local generaba `2026-10-02`, igual al día SQLite; por eso la consulta `< date('now')` devolvía cero filas. La reproducción aislada confirma un desfase del fixture, no un cambio de conducta de producción.

- [x] Reproducir la aserción de «caducó ayer» en DB temporal durante el desfase de medianoche local/UTC.
- [x] Alinear el helper de fechas del spec al reloj UTC ya fijado por la ruta; no alterar lógica de producto ni configuración de zona.
- [x] Ejecutar el spec completo de Pantry y repetir toda la suite del servidor con coverage en directorios temporales, comprobando `DATABASE_PATH` efectivo y conservando el umbral del 70 %.

**TDD rojo→verde y cierre local (2026-10-03):** el test focal aislado falló antes del cambio (**1 fallo / 5 skips**, esperaba «Leche del lunes», recibió `[]`) y pasó después (**1/1**); el spec completo de Pantry pasó **6/6**. La suite server con coverage pasó **46/46 archivos, 943/943 pruebas**; resultado **93.01/84.52/94.81/95.45 % S/B/F/L**, incluidas las rutas/esquema de tickets por encima del 70 % por archivo. SQLite y reportes se limitaron a una carpeta `%TEMP%` única; se comprobó `DATABASE_PATH` antes de ejecutar y no se tocaron `server/coverage` ni la lógica de producción. Umbrales sin cambios.

### QA-04c.UI.DATATABLE.1 · cobertura del componente compartido de tabla (resuelta localmente)

**Fuente revalidada (2026-10-02):** el contrato vigente de `app-data-table` está en `HOGARIA-SPEC.md` §§12ab–12ad. `DataTableComponent` recibe filas/columnas y presenta búsqueda proyectada, celdas proyectadas, orden multi-columna, filtros de texto/número/fecha, paginación, selección y una hoja móvil; `data-table.util.spec.ts` ya cubría helpers puros, y `pantry.spec.ts`, `pantry-managers.spec.ts` y `pantry-catalog.spec.ts` recorren consumidores reales. No había `data-table.component.spec.ts`; LCOV atribuyó **2/254 líneas, 0/163 ramas y 0/97 funciones**. Se añadió cobertura directa y solo se cambió comportamiento respaldado por regresiones rojas.

- [x] Añadir pruebas Angular del render y proyección: lista vacía vs. sin coincidencias, celdas proyectadas/booleanas y formato texto/número/fecha, clases e identificadores de fila y `resultadoChange` con todas las filas filtradas (no solo la página).
- [x] Cubrir orden ascendente/descendente y multiorden con Shift, columnas no ordenables y `aria-sort`; un clic sin Shift sobre una clave activa deja solo esa clave, como documenta `rotarOrden`. Cubrir filtros de valores y búsqueda de menú insensible a mayúsculas/acentos, todos/ninguno/limpiar/recortar, extremos numéricos/fechas válidos y vacíos, anclaje dentro del viewport, clic exterior y Escape.
- [x] Cubrir paginación y reanclaje al cambiar tamaño, rangos y saltos en límites, rechazar tamaño inválido, selección y poda de IDs al retirar filas, estados none/mixed/all, selección por página y tramos Shift.
- [x] Verificar que `tamanoInicial` y `tamanos` enlazados como inputs se aplican después de que Angular los asigne.
- [x] Contrato de salida elegido: una interacción de selección emite una vez el estado final; en Shift se emite solo el tramo inclusivo visible, nunca el toggle transitorio del checkbox. La aserción unitaria verifica conteo y contenido tanto con ratón como con Shift+Space, además del caso sin ancla.
- [x] Cubrir el cambio de superficie en el límite 719/720 px y formatos 320×568, 393×851 y 568×320: hoja única de ordenar/filtrar en móvil, cabezal en escritorio, sin overflow horizontal; validar acceso por teclado, Escape y un solo DOM de controles visible.
- [x] Escribir/ejecutar Playwright real aislado con filas sintéticas sobre Pantry en Chromium y Pixel 5; revalidar los flujos existentes de tabla y paginación/reanclaje. Datos, puertos y DB fueron temporales; proveedor IA no utilizado.
- [x] Revalidar la suite E2E actual como baseline antes de añadir pruebas: aislar una expectativa antigua de test de cualquier fallo de producto, contrastándola con el markup real.
- [x] Lograr ≥70 % de statements/branches/functions/lines en `DataTableComponent`, ejecutar typecheck/build y repetir la suite frontend completa con el gate existente sin rebajarlo; registrar conteos, resultado real del gate, limitaciones y rollback. Mantener QA-04c global abierto hasta que las cuatro métricas completas alcancen 80 %.

**Baseline anterior a implementación:** LCOV atribuye al componente **2/254 líneas, 0/163 ramas y 0/97 funciones**, sin spec propia. La primera pasada aislada de `pantry.spec.ts` dio **21/26**, cuatro skips de proyecto y un fallo móvil por pedir `hoja-cerrar` dentro del subpanel; la vista actual ofrece `hoja-volver` y solo muestra el cierre al volver a la lista de columnas. Era un locator E2E obsoleto, no un defecto de interfaz.

**Revalidación del E2E (2026-10-02):** al corregir el retorno apareció una segunda expectativa desactualizada: el filtro parte de todos los valores marcados, así que clicar «l» excluía litros. El E2E ahora pulsa «Ninguno» y después la casilla con nombre accesible exacto «l»; así filtra leche correctamente. No era un defecto de producto.

**TDD rojo→verde (2026-10-02):** se calibraron primero expectativas de fixture/contrato —`SIN_VALOR` queda al final, el primer nombre ascendente es «Leche», no hay página 3 con 30 filas a tamaño 24, y `Recortar` requiere una faceta reducida por otro filtro—. Las pruebas rojas reprodujeron: `tamanoInicial` se leía antes de recibir inputs; el efecto de tamaño borraba el reanclaje; la selección mantenía IDs de filas retiradas; el clic normal en una clave activa conservaba criterios secundarios; y la búsqueda de «verd» no encontraba «Verduras» por no normalizar la etiqueta. Las pruebas corregidas dieron **45: 39 verdes/6 rojas** antes de producción. Después, una regresión adicional falló antes del fix porque Shift emitía primero el toggle del checkbox y después el tramo final; el contrato queda definido en una emisión final por gesto. Se corrigió con captura previa del modificador y emisión única. Resultado focal final: **46/46**.

**Evidencia final:** `DataTableComponent` cubre **94.98/75.29/92.38/94.98 %** (statements/branches/functions/lines), superando el mínimo del scope en las cuatro dimensiones. `pantry.spec.ts` aislada repitió **24 pasadas/4 skips de proyecto** en Chromium + Pixel 5 (28 casos contabilizados), incluidos orden, filtro, selección, reanclaje y el límite responsive **719/720 px** con 320×568, 393×851 y 568×320, sin overflow. La matriz confirma hoja accesible por nombre en móvil, teclado Enter/Escape en escritorio y tap en Pixel 5. Typecheck E2E y build de producción pasan. Capturas sintéticas inspeccionadas (ignoradas por Git): `.e2e-screenshots/qa-datatable-20261002/pantry-chromium-1280x720.png` y `pantry-mobile-chrome-393x727.png`.

**Gate global y limitaciones:** la suite frontend instrumentada ejecutó **809/809** pruebas, pero el gate preexistente de 80 % sigue rojo: **80.98/70.89/79.47/82.46 %** (statements/branches/functions/lines). No se redujo ningún umbral. El build deja warnings de bundle inicial (707.32 kB frente a 500 kB), estilos de `DataTableComponent` (11.49 kB frente a 10 kB) y warnings Angular existentes; no son errores de compilación. El estado global de cobertura permanece abierto en QA-04c.GATE.1.

**Revalidación del gate global (2026-10-08, HEAD `9002aa4`):** el hook pre-push volvió a pasar Karma **1201/1201**, con **90.32/81.46/88.96/91.75 % S/B/F/L**, y Vitest de servidor **1226 pasadas/1 omitida**. Así queda cerrada esta unidad, que ya superaba ≥70 % en las cuatro métricas focales; el trabajo global QA-04c sigue abierto para otras fuentes por cubrir. El build pasa sin cambiar budgets y conserva las advertencias documentadas.

**Rollback previsto:** revertir esta unidad de forma atómica: `data-table.component.ts`, `data-table.util.ts`, `data-table.component.spec.ts`, `data-table.util.spec.ts`, los cambios focales de `tests/e2e/pantry.spec.ts` y este bloque de spec. No incluir archivos modificados por otras unidades.

### QA-04c.UI.TAG-ACCESSIBILITY.1 · chips de filtro accesibles y con cobertura

**Fuente revalidada (2026-10-09, HEAD `104adf7`):** `TagComponent` se usa como filtro seleccionable
en Recetas, categorías e inventario de productos, pero también como texto de alias y etiquetas de solo
lectura en fichas/revisión. El baseline confirmado en Git tenía filtros como `<span (click)>`, sin
foco/teclado ni estado accesible; `selected` solo añadía una clase CSS. La variante removible incluye
una acción separada; convertir el contenedor en botón produciría controles anidados. No había specs
unitarios propios y la cobertura focal era inferior al 70 %.

**Conducta esperada:** los filtros usan un componente de botón nativo con nombre visible, `aria-pressed`
sincronizado con `selected` y activación por teclado; pulsar un filtro no debe deseleccionarlo si el
consumidor lo modela como opción única. Los tags informativos siguen siendo texto no enfocable. `disabled`
bloquea la acción correspondiente. Un tag removible conserva una etiqueta de texto y una acción de borrado
separada, localizada y accesible por teclado/táctil, sin que quitarlo active un filtro. Nunca se anidan
botones. Las cajas conservan dimensiones actuales (tolerancia ≤1 CSS px).

- [x] Añadir pruebas unitarias de `TagComponent` informativo/removible y `FilterTagComponent`
      interactivo; cubrir combinaciones
      base/seleccionada/deshabilitada/removible, nombre, `aria-pressed`, `onClick` y `onRemove` aislado.
- [x] Confirmar en el baseline la causa `<span (click)>` y verificar en E2E click/tap,
      Enter/Espacio y estado anunciado en Recetas, categorías e inventario de productos, usando fixture/DB
      aislados. Comprobar en un alias removible que Enter/tap lo elimina sin presentar una acción de filtro.
- [x] Separar semántica pasiva e interactiva sin botones anidados; conservar visualización y geometría de chips
      base/seleccionados/removibles en desktop y móvil y estado deshabilitado.
- [x] Capturar/inspeccionar antes y después en PC y móvil; comparar las cajas con tolerancia ≤1 px y
      ejecutar los breakpoints/anchos relevantes sin overflow.
- [x] Alcanzar ≥70 % S/B/F/L focales y ejecutar Karma completa (gate ≥80 %), E2E afectadas,
      typecheck/build, formato y `git diff --check`.
- [x] Publicar esta unidad en commit atómico con todos los hooks de commit/push; mantener Draft y cerrar
      solo con evidencia CI verde.
      de confirmar push y evidencia CI de la rama.

**Evidencia (2026-10-09):** `tag.component.spec.ts` y `filter-tag.component.spec.ts` cubren texto
informativo/removible, botón de borrado desacoplado y localizado, bloqueo por disabled, botón nativo de
filtro, nombre visible, sincronía de `aria-pressed` y eventos aislados. El HTML focal de Karma marca
`TagComponent` **9/9 statements, 1/1 branches, 2/2 functions, 8/8 lines (100 %)** y
`FilterTagComponent` **10/10, 2/2, 2/2, 8/8 (100 %)**.

La suite completa `pnpm run test:client:coverage` ejecutó **1224/1224** y pasó el umbral global con
**90.82/81.92/89.44/92.27 % S/B/F/L**. La suite E2E aislada de las rutas afectadas ejecutó
**27 passed, 1 skipped** en Chromium y `mobile-chrome`; activa filtros por Enter/Espacio/click/tap,
verifica `aria-pressed` y elimina un alias con Enter/tap sin filtro anidado. Otro E2E móvil comprobó
las filas de filtros en 23 anchos (320–1024 px), incluidos los límites 400/480/720/760/768/860/959/
960/1023/1024, sin overflow. `pnpm run typecheck:e2e`, `pnpm run check:ui` (211 ficheros/21 reglas),
Prettier, `git diff --check` y `pnpm run build` pasaron. El build conserva warnings existentes de
bundles, presupuestos de estilos y Angular. Capturas sintéticas antes/después inspeccionadas: PC
1440×900 y móvil 393×851 en `.e2e-screenshots/qa-tag-accessibility-before-20261009/` y
`.e2e-screenshots/qa-tag-accessibility-after-20261009/`; dimensiones de tags: recetas 86×31 px,
categorías 66×31 px, productos 86×31 px y alias removible 149×31 px, dentro de la tolerancia de 1 px.
El test y las capturas usan DB/fixtures sintéticos; los artefactos están ignorados por Git.
Lefthook pasó pre-commit (`prettier`, `ui-quality`) y pre-push (`format-check`, `ui-quality`, `build`,
`e2e-typecheck`, `unit-tests`). El CI `37871768326` del SHA `8723903` terminó success en todos los jobs,
incluidos cuatro shards E2E, full-stack E2E, build, typecheck y tests de servidor; PR #41 permanece Draft.

**Rollback:** revertir únicamente `tag.component.ts`, `filter-tag.component.ts`, sus specs, las referencias
de filtros en recetas/categorías/productos y esta subunidad; no revertir otros componentes ni el resto de
los cambios de sus consumidores.

### QA-04c.CORE.TASTE.1 · cobertura del servicio de perfil (resuelta localmente; gate global revalidado)

**Fuente revalidada antes de añadir el spec (2026-10-01):** `TasteProfileService` no tenía spec propio y el reporte marcaba 5.40/0/0/3.33 % (sentencias/ramas/funciones/líneas). Sus caminos actuales son `ensureLoaded`/`load`, `save` con campos opcionales, normalización/aplicación de `TasteResponse` y `finalize` de loading en éxito/error. El alcance no cambia comportamiento de producción ni toca DB: se ejercita con `HttpTestingController`.

- [x] Añadir pruebas unitarias para carga/idempotencia/reintento, defaults y perfil normalizado, payload mínimo/completo de PATCH y limpieza de loading en éxito/error.
- [x] Asegurar ≥70 % por statements/branches/functions/lines en `TasteProfileService` con pruebas sobre la fuente actual.
- [x] Repetir la suite global y registrar el impacto real; mantener todos los thresholds existentes.

**Evidencia QA-04c.CORE.TASTE.1 (2026-10-01):** `taste-profile.service.spec.ts` cubre carga/idempotencia, normalización, payloads y errores con `HttpTestingController`: 10/10; cobertura actual 100/100/100/100 %. La suite frontend completa, ya con esta spec, ejecutó 665/665 y dejó el global en 60.30/52.21/49.80/61.92 %, por debajo del gate 80 % (QA-04c.GATE.1). No se modificó threshold ni se escribieron datos externos.

**Revalidación del gate (2026-10-08):** tras el trabajo actual, `pnpm run test:client` pasó **1199/1199** y el global quedó en **90.32/81.45/88.95/91.75 % S/B/F/L**. Esto sustituye el estado global histórico citado arriba, no cierra QA-04c completo: siguen abiertas pruebas de rutas restantes y las auditorías funcionales/responsive globales.

### QA-04c.CORE.SHOPPING.1 · cobertura y drenaje de escrituras offline (resuelta localmente; gate frontend revalidado)

**Fuente revalidada (2026-10-01):** no hay spec directa de `ShoppingService`; la única spec que lo importa lo reemplaza con un mock. El HTML del reporte global actual confirma 1/338 statements (0.29 %), 0/174 branches, 0/154 functions y 1/298 lines (0.33 %). El servicio concentra consultas/paginación, sugerencias, CRUD de listas/artículos, precios, fotos, SSE y cola offline.

- [x] Añadir primero regresiones `HttpTestingController` para parámetros/respuestas y estados de lectura, guardado, errores HTTP y recargas anidadas de las operaciones públicas principales.
- [x] Reproducir de forma acotada el fallo de red de `flush()`: el código conserva la primera escritura y ejecuta `continue` en el mismo `while`, reemitiéndola enseguida en vez de esperar el evento `online`; fijar conducta esperada de cola retenida, un intento por desconexión y reanudación al recuperar red, sin tormenta de solicitudes.
- [x] Implementar las correcciones mínimas que exijan las regresiones; cubrir deduplicación, orden, conflicto 409, errores de red/no-red, cambios optimistas y `pendingWrites`.
- [x] Cubrir streams, fotos, cierre de compra, artículos, precios y búsquedas dentro del contrato actual; alcanzar ≥70 % S/B/F/L del servicio antes de cerrar la unidad.
- [x] Repetir full frontend + gate local sin reducirlo; registrar impacto y mantener fixture sintético, sin tocar DB normal/proveedor real.

**Evidencia QA-04c.CORE.SHOPPING.1 (2026-10-01):** se añadieron 32 pruebas `HttpTestingController`; `shopping.service.spec.ts` pasó **32/32**. La regresión reprodujo el retry en bucle al recibir error de red; ahora conserva las escrituras, pausa el drenaje (también para nuevos cambios locales) y reanuda al evento `online`, con una comprobación de evento concurrente para no perder una reconexión recibida antes de que falle la request. Se normaliza whitespace en nombre de tienda y nota de foto en consonancia con `createListSchema`/`photoAnalyzeSchema`. Cobertura de `ShoppingService`: **98.56/90.96/100/99.02 %** (S/B/F/L). No se usó DB/proveedor normal; la repetición global y su impacto están revalidados en QA-04c.GATE.1 (2026-10-08).

### QA-04c.CORE.PANTRY.1 · cobertura de inventario, categorías y catálogo (resuelta localmente; gate frontend revalidado)

**Fuente revalidada (2026-10-01):** `pantry.service.spec.ts` existente solo cubre la carga/reintento de caducidades; el reporte global muestra `PantryService` en 14.60/1.92/4.46/16.48 % (S/B/F/L). La API actual agrupa ingredientes/utensilios, carga paginada, stats, categorías/productos, impactos y catálogo. `GET /ingredients/:id` devuelve `{data: ingredient}`, pero `getIngredient()` usa `tap(response => response.data)` sin proyectar el resultado; `createIngredient()` y `updateIngredient()` también declaran emitir `Ingredient|null` pero conservan el envelope mientras actualizan signals. Es discrepancia entre firmas, respuesta REST observada en `server/src/routes/pantry.routes.ts` y operador actual, no decisión de producto.

- [x] Añadir primero pruebas de contrato que exijan que `getIngredient/createIngredient/updateIngredient` emitan `data` (o `null` ante ausencia según firma) y actualicen signals/estadísticas como corresponda.
- [x] Añadir pruebas aisladas para paginación/defaults, filtros, CRUD y errores, carga de utensilios/stats, manager categorías/productos e impactos, operaciones bulk y catálogo.
- [x] Corregir la proyección de envelopes solo cuando la regresión la demuestre; comprobar finalización de `loading/saving`, error reintentable y cache/force de categorías.
- [x] Alcanzar ≥70 % S/B/F/L de `PantryService`; confirmar que el grupo unitario no escribe en DB de uso normal.
- [x] Ejecutar suite frontend completa y gate local.

**Evidencia QA-04c.CORE.PANTRY.1 (2026-10-01):** `pantry.service.spec.ts` cubre contratos HTTP, estados, filtros/paginación, CRUD, utensilios/stats, categorías/productos, impactos/bulk y catálogo. El grupo aislado de servicios ejecutó **65/65**. TDD confirmó que `getIngredient`, `createIngredient` y `updateIngredient` emitían `{data: ...}` pese a declarar `Ingredient|null`; ahora proyectan `data`, mantienen las señales y no insertan `null`. `deleteIngredient` también proyecta éxito como `true` conforme a su tipo. Cobertura de `PantryService`: **100/84.82/100/100 %** (S/B/F/L). La suite completa y el gate se revalidaron en QA-04c.GATE.1 (2026-10-08).

### QA-04c.UI.PANTRY-COMPONENT.1 · cubrir ramas del componente de inventario

**Fuente revalidada (2026-10-10, antes de editar):** `PantryComponent` centraliza las proyecciones de ingredientes/utensilios, etiquetas de las columnas y pickers, serialización del estado en query params, formato de las filas/caducidades y altas/ediciones/borrados con sus errores. `pantry.component.spec.ts` ya verifica filtros, cambios de stock/foco, recuperación de carga y operaciones por lote, pero no cubre varios de esos contratos ni sus callbacks de éxito/error. El LCOV íntegro de la última suite local (capturado por los hooks antes del commit `ce7c1b3`) sitúa este archivo en **57.14/42.51/44.00/57.14 % S/B/F/L** (192/336 statements y lines, 71/167 branches, 55/125 functions); el parser del mismo reporte no encuentra otro archivo de producción frontend bajo 70 %. Reporte archivado fuera del repo: `%TEMP%\hogaria-coverage-pantry-baseline-ce7c1b3-20261010.lcov`, SHA-256 `D3FC2A7990B8D0F59BF59ACD0327A20D14D1D806437224D1D650783076112754`.

**Alcance:** pruebas unitarias de `PantryComponent` con dependencias controladas y observables/señales sintéticas; no se cambian contratos de producto ni comportamiento productivo si las pruebas no detectan un defecto. Cubrir proyecciones/localización de columnas y opciones (catálogo vacío, personalizado, claves y valores desconocidos), helpers de fila y fechas, estado de URL y no-op cuando ya coincide, y caminos de validación/éxito/error/cancelación de las altas, ediciones, eliminaciones y utensilios. Usar reporter/LCOV en una carpeta temporal única para que una selección focal no sobrescriba el gate ni la evidencia vigente.

- [x] Añadir primero regresiones unitarias de las ramas actuales no ejercitadas: columnas/pickers y filas, query params, caducidades, validación, éxito y error de ingrediente/utensilio, y cancelación/borrado. No duplicar las pruebas de filtros, foco o lote existentes.
- [x] Alcanzar al menos **70 % en statements, branches, functions y lines** para `pantry.component.ts`; sin defectos nuevos, no tocar producción.
- [x] Repetir `pnpm run test:client` completo y dejar intactos los gates globales **80/80/80/80 %**; registrar el resultado global y el LCOV por archivo con comandos reproducibles.
- [x] Ejecutar formato focal, `pnpm run check:ui`, `pnpm run build:client` y `git diff --check`; no cambia UI ni datos, así que E2E/capturas/DB temporal son N/A. Incluir spec y pruebas en el mismo commit atómico de esta unidad tras publicar primero este cambio de spec.

**Evidencia QA-04c.UI.PANTRY-COMPONENT.1 (2026-10-10):** `frontend/src/app/features/pantry/pantry.component.spec.ts` ejecuta 36/36 en Chrome Headless 154. Comando focal desde `frontend/`: `pnpm exec ng test --no-watch --code-coverage --include=src/app/features/pantry/pantry.component.spec.ts --browsers=ChromeHeadlessLocal --progress=false`. Como el include limita la instrumentación, ese run termina con exit 1 solo por el gate global —29.32/17.18/23.84/31.57 % S/B/F/L—; el LCOV focal prueba `PantryComponent` en **98.81/89.82/93.60/98.81 %**, por encima de 70 en las cuatro métricas. LCOV preservado en `%TEMP%\hogaria-coverage-pantry-component-06461fc\lcov.info`. Verificación completa `pnpm run test:client`: **1320/1320**, cobertura global **94.83/86.27/94.41/96.18 % S/B/F/L**, gate 80 % aprobado; LCOV en `%TEMP%\hogaria-coverage-pantry-full-06461fc\lcov.info`. También pasan Prettier focal, `pnpm run check:ui` (**212 ficheros/21 reglas**), `pnpm run typecheck:e2e`, `pnpm run build:client` y `git diff --check`; el build conserva warnings Angular existentes. No se tocó producción ni datos, así que E2E, capturas, DB y llamadas a IA son N/A. La spec se publicó primero en `06461fc`; esta evidencia y el spec con pruebas forman el mismo commit atómico de implementación.

**Rollback previsto:** retirar las pruebas focales y esta subunidad de cobertura; no revertir `PantryComponent` ni rebajar los gates.

### QA-04c.UI.PANTRY-CATEGORY-LABEL.1 · cobertura del pipe de categorías

**Fuente revalidada (2026-10-08):** `PantryCategoryLabelPipe` se importa en Despensa y su gestor de
categorías, pero el LCOV de la suite frontend muestra **25/0/0/25 % S/B/F/L** (1/4 sentencias, 0/3
funciones). `pantryCategoryLabel()` ya tiene pruebas de tabla en
`features/pantry/pantry-gestor.util.spec.ts` para nombres de fábrica, categorías renombradas y claves
desconocidas; falta crear el pipe Angular y comprobar su frontera con `I18nService`, incluida la lectura
de `changeTick()` que mantiene la etiqueta sincronizada con el idioma activo.

**Alcance:** aumentar pruebas del pipe existente, sin cambiar producción si el contrato ya se cumple:
categoría de fábrica por clave se traduce con el idioma activo; una clave con nombre de fábrica explícito
también se traduce; un nombre personalizado prevalece sobre el diccionario; clave desconocida, valor nulo o
ausente se conserva según el helper. El pipe lee `changeTick()` en cada transformación. No modifica datos,
estructura ni geometría de Despensa.

- [x] Añadir pruebas Angular directas del pipe real con `I18nService` controlado (sin exigir un fallo
      inicial de producción): factoría del servicio, lectura de `changeTick()` en cada llamada y
      traducción con el idioma activo; cubrir clave
      como string, objeto con nombre de fábrica, nombre personalizado, clave desconocida, `null` y
      `undefined`. No duplicar los casos puros ya cubiertos por `pantry-gestor.util.spec.ts`.
- [x] Las pruebas no detectan defecto funcional en el pipe; no se modifica producción.
- [x] Medir el pipe y superar ≥70 % en sentencias/ramas/funciones/líneas; repetir los flujos de
      categoría en Chromium de escritorio y Pixel 5 con entorno E2E aislado. Sin cambios visuales:
      capturas N/A.
- [x] `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 ficheros/21 reglas), `pnpm run build`,
      Prettier y `git diff --check` pasan. No bajar gates.

**Evidencia (2026-10-08):** el spec focal ejecutó 5/5; `pnpm run test:client` ejecutó 1206/1206.
LCOV del pipe: statements 4/4, functions 3/3 y lines 4/4 (100 % cada métrica); branches 0/0, no
instrumentadas. Cobertura global: 90.38/81.51/89.11/91.79 % S/B/F/L, gate 80 % aprobado. E2E aislado:

```powershell
$env:E2E_RATE_LIMIT = 'on'
pnpm run test:e2e -- --project=chromium --project=mobile-chrome --grep='el filtro de categorias minimiza el riel|una categoria nueva con color y padre queda en su sitio'
Remove-Item Env:E2E_RATE_LIMIT
```

El flujo de Despensa y el gestor pasó 4/4; el runner confirmó SQLite/semilla/puertos/artefactos
temporales y su limpieza. `typecheck:e2e`, `check:ui` (210 ficheros, 21 reglas), `build`, Prettier y
`git diff --check` pasan; el build conserva avisos de presupuesto/imports ya existentes. Al no haber
cambio visual, las capturas son N/A.

**Rollback:** retirar únicamente el spec directo del pipe y este subapartado, sin afectar las pruebas puras
de categorías ni la lógica de producción.

### QA-04c.UI.PRICE-CHART.1 · cobertura del renderer SVG del historial de precios (cerrada)

**Fuente revalidada (2026-10-09):** `PriceChartComponent` presenta la leyenda y el SVG desde las
series de `precio-chart.util.ts`, cuya lógica pura ya tiene spec propia. La página real de detalle
de despensa ya tiene cobertura E2E en `tests/e2e/pantry-item.spec.ts`, incluidos dos comercios,
colores, puntos y línea; faltaba una spec unitaria del renderer. El último LCOV completo marca
`price-chart.component.ts` en **5.00/0/0/5.00 % S/B/F/L** (1/20 líneas, 0/6 ramas y 0/7 funciones).
No hay defecto de producción observado: este lote añade cobertura de renderizado, sin cambiar UI ni
contrato. El date locale se fija en ES y la traducción se sustituye por una señal determinista.

- [x] Añadir primero tests unitarios que cubran lista vacía y serie visible, tienda nula/nominada,
      formatos monetarios, fechas X repetidas/diferentes, un punto sin path vs. varios con path,
      colores y títulos accesibles por punto.
- [x] Superar ≥70 % de statements/branches/functions/lines en `price-chart.component.ts`, registrar
      las métricas focales y explicar que un comando focal conserva el gate global de 80 % intacto.
- [x] Ejecutar E2E real existente de precios en Chromium y Pixel 5 más suite frontend completa;
      typecheck/build/formato. Sin cambio de UI: capturas nuevas N/A; se conserva la evidencia de
      `pantry-item.spec.ts`.

**TDD/cobertura (2026-10-09):** baseline sin spec directa y LCOV **5.00/0/0/5.00 % S/B/F/L**.
La primera compilación del nuevo test detectó que `NodeList` no es iterable con el `tsconfig` actual;
se usó `Array.from`. La primera ejecución de aserciones mostró dos expectativas incorrectas del test
(el formato de fecha no siempre incluye año y la pipe entrega `undefined` como segundo argumento);
se corrigieron contra la salida real, sin indicio de defecto de producción. Karma focal sin coverage:
**3/3**. Con cobertura, el archivo sube a **100/83.33/100/100 % S/B/F/L** (supera el mínimo de 70 %);
el proceso focal sale 1 solo por agregar todo el código de la app al gate global (**34.37/9.64/26.53/36.97 %**),
sin cambiar el umbral. E2E real existente `tests/e2e/pantry-item.spec.ts` en Chromium + Pixel 5,
rate limit activo y runner aislado: **12/12**, cleanup de SQLite/artefactos confirmado.

**Evidencia final (2026-10-09):** `pnpm run test` con `DATABASE_PATH=:memory:` y
`KARMA_COVERAGE_DIR` único bajo `%TEMP%`: config **10/10**, Karma **1229/1229** con gate global
**91.08/82.10/89.69/92.52 % S/B/F/L**, server **1236 pasadas/1 omitida**. También pasan
`pnpm run build` (preserva warnings de budget/imports existentes), `pnpm run typecheck:e2e`,
`pnpm run check:ui` (**211 archivos/21 reglas**), Prettier y `git diff --check`. El test solo
añade cobertura del renderer; la interfaz/product code no cambia.

**Cierre (2026-10-09):** `test(pantry): cover price chart renderer` (`b5729fe`) está publicado y su CI
#601 (`37885783378`) pasó. La ejecución pre-push de la rama vigente en `06ca504` volvió a pasar build,
typecheck, configuración, Karma completa y server tests, incluyendo este renderer; los hooks locales
se ejecutaron sin bypass. No requiere más cambios.

**Rollback:** retirar solo `price-chart.component.spec.ts` y este bloque; no hay cambio productivo.

### QA-04c.CORE.HOUSEHOLD.1 · cobertura y contratos del hogar (resuelta localmente; gate frontend revalidado)

**Fuente revalidada (2026-10-01):** no existe spec directa; el reporte global mide 2/60 statements (3.33 %), 0/24 branches, 0/34 functions y 1/56 lines (1.78 %). Los callers activos consultan carga/creación/unión, permisos e invitaciones. Las firmas de `previewInvite`, `createHousehold`, `updateSettings` y `regenerateInviteCode` indican emitir `data`/entidad/código, pero los pipes actuales solo usan `tap`; la API real de regenerar devuelve `{data:{inviteCode}}`. Las pruebas fijarán contrato a partir de firma, caller y respuesta server, y cubrirán almacenamiento local corrupto.

- [x] Añadir pruebas `HttpTestingController` de `ensureHousehold` (deduplicación, vacío exitoso, error y reintento), mapeo de members/current-user/defaults y respuestas públicas de invitación.
- [x] Añadir pruebas de alta/unión/update/regeneración/salida, errores, clipboard y `getInviteLink/isAdmin`; exigir emisiones `data` conforme a las firmas públicas.
- [x] Corregir solo los mappings confirmados por las regresiones; alcanzar ≥70 % S/B/F/L de `HouseholdService` sin escribir en servidor/DB real.
- [x] Repetir suite frontend + gate existente y registrar el impacto.

**Evidencia QA-04c.CORE.HOUSEHOLD.1 (2026-10-01):** se añadió `household.service.spec.ts` con 13 casos `HttpTestingController`; el grupo aislado hogar/pantry/tickets/gustos ejecutó **65/65**. Antes del fix, las regresiones confirmaron que `previewInvite`, `createHousehold`, `updateSettings` y `regenerateInviteCode` devolvían el envelope en vez de su firma pública, y `leaveHousehold()` devolvía el objeto HTTP en vez de booleano. Tras mapear `data`, actualizar signals con la entidad y emitir `true` en salida correcta, cobertura de `HouseholdService`: **100/96.55/100/100 %** (S/B/F/L). Sin escritura a servidor/DB normal. La repetición global y el gate están revalidados en QA-04c.GATE.1 (2026-10-08).

### QA-04c.CORE.RECEIPTS.1 · cobertura del servicio de tickets y refresco inicial (resuelta localmente; gate frontend revalidado)

**Fuente revalidada (2026-10-01):** no existe spec directa; el reporte actual marca 1.56/0/0/1.58 % (S/B/F/L). `ReceiptsService.watch()` incrementa su contador y llama `void this.refreshQueue()`, pero `HttpClient` devuelve un Observable frío: ese primer GET no se ejecuta hasta el siguiente tick de polling (1 s). El comentario de `watch()` describe activar el latido; el contrato §12aj exige que el icono refleje la cola activa. Se fija como conducta esperada refrescar inmediatamente al primer watcher, luego sondear una vez por segundo solo mientras haya watchers y cancelar al destruir el servicio.

- [x] Añadir pruebas unitarias primero para endpoints/señales/flags, multipart sintético, errores y toast, operaciones explícitas de stop/retry/confirm, `stopAll()` en éxito/error y limpieza en destroy.
- [x] Reproducir que `watch()` no inicia el GET inmediatamente; conectar un solo primer refresco y mantener el contador saturado en cero y polling solo mientras exista watcher.
- [x] Alcanzar ≥70 % S/B/F/L de `ReceiptsService`; validar intervalos con tiempo virtual, sin EventSource/SSE/proveedor/DB real.
- [x] Repetir suite frontend + gate sin reducir umbrales y registrar el impacto.

**Evidencia QA-04c.CORE.RECEIPTS.1 (2026-10-01):** `receipts.service.spec.ts` añadió 9 pruebas unitarias; el grupo aislado hogar/pantry/tickets/gustos pasó **65/65**. Antes del fix, `watch()` descartaba el Observable frío y no emitía el GET inmediato; ahora solo la transición de cero a primer watcher suscribe un refresco protegido por `DestroyRef`, y el polling sigue activo únicamente con watchers. Cobertura de `ReceiptsService`: **100/100/100/100 %** (S/B/F/L). Los tests de intervalo reinicializan el injector dentro de `fakeAsync` para que `tick()` controle el scheduler real. La suite completa y el gate se revalidaron en QA-04c.GATE.1 (2026-10-08).

### QA-04c.UI.LOADING-COMPONENT.1 · estados del spinner compartido

**Fuente revalidada (2026-10-10):** el reporte Karma actual (`KARMA_COVERAGE_DIR` temporal) identifica `loading.component.ts` en **91.66/50/100/100 % S/B/F/L**: falta ejecutar la rama `fullscreen=true`; la clase puede además combinar los modificadores `fullscreen` e `inline` y renderizar mensaje/tamaños `sm|md|lg`. La búsqueda actual encuentra consumidores reales en hogar, despensa, Configuración IA, recetas y tickets, pero ningún spec dedicado al componente compartido. `LoadingComponent` solo añade clases/markup estáticos según sus inputs; no se prevé cambio de producción.

- [x] Añadir un test de componente que compruebe los valores por defecto, los modificadores `fullscreen`/`inline`, mensaje visible/ausente y el nombre de clase de los tres tamaños; debe cubrir la rama faltante y dejar el archivo ≥70 % S/B/F/L.
- [x] Ejecutar el spec Karma focal y la suite frontend completa con coverage escrito a un directorio `%TEMP%` nuevo; mantener el gate global ≥80 % y comprobar typecheck, Prettier y `git diff --check`.
- [x] Registrar resultado reproducible, cleanup/ubicación temporal y rollback. Runtime E2E N/A: solo aumenta cobertura de un componente existente, sin cambiar comportamiento ni presentación; rollback es retirar el spec y esta subunidad.

**Evidencia QA-04c.UI.LOADING-COMPONENT.1 (2026-10-10):** el test nuevo `loading.component.spec.ts`
pasó **3/3** con `pnpm --filter @hogaria/web exec ng test --no-watch
--include=src/app/shared/components/ui/loading/loading.component.spec.ts
--browsers=ChromeHeadlessLocal --progress=false`; cubre configuración predeterminada, clase `sm`, mensaje,
combinación de modificadores y clase `lg`. En el baseline medido inmediatamente antes, `loading.component.ts`
estaba en **91.66/50/100/100 % S/B/F/L** y no cubría `fullscreen=true`; después de la suite completa quedó en
**100/100/100/100 %** (12/12 statements, 2/2 branches, 3/3 functions, 10/10 lines). Karma frontend pasó
**1292/1292**, gate global **92.23/83.59/90.98/93.64 % S/B/F/L**; LCOV/HTML quedaron en
`%TEMP%\hogaria-coverage-loading-ebb2baa08484408cb3c610ad48c4a489`, sin tocar `frontend/coverage`.
`pnpm run typecheck:e2e`, Prettier focal y `git diff --check` pasan. Coverage-only, sin cambios de producción,
presentación, DB, servidor ni proveedor; E2E N/A. Rollback: retirar `loading.component.spec.ts` y esta subsección.

### QA-04c.UI.RATING-INTERACTIONS.1 · disabled, hover y limpieza del puntero

**Fuente revalidada (2026-10-10):** el reporte Karma temporal marca `rating.component.ts` en **90/66.67/85.71/96 % S/B/F/L**. `rating.component.spec.ts` ya comprueba iconos llenos/outline, hover/click y outputs, pero no ejercita `disabled=true`, `getStarClasses()` ni `onStarLeave()`. La fuente declara que deshabilitado bloquea click/hover, y que mouseleave limpia `hoveredIndex`; esta subunidad fijará esos contratos existentes sin cambiar producción.

- [x] Añadir primero pruebas del disabled real en el template: botones desactivados, click sin cambiar valor ni emitir outputs y hover sin estado; comprobar además que hover colorea únicamente el tramo señalado y mouseleave lo restablece.
- [x] Medir `rating.component.ts` ≥70 % S/B/F/L, ejecutar spec focal y suite frontend completa con cobertura bajo `%TEMP%`, conservar el gate global y verificar typecheck, Prettier y `git diff --check`.
- [x] Registrar comandos, resultados, ubicación de cobertura y rollback. Runtime E2E N/A: solo se verifica el contrato unitario del componente existente, sin cambiar producción ni presentación; rollback: retirar los tests y esta subunidad.

**Evidencia focal (2026-10-10):** el source no cambió; la prueba Karma focal pasó **4/4** con `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/shared/components/ui/rating/rating.component.spec.ts --browsers=ChromeHeadless`. La suite completa pasó **1294/1294** mediante `pnpm run test:client`; coverage se aisló en `%TEMP%\hogaria-coverage-rating-final-851782a7974f418eade877ce783a5c9c` y el gate global quedó **92.27/83.64/91.02/93.65 % S/B/F/L**. `rating.component.ts` quedó en **100/100/100/100 %** (LCOV: 6/6 ramas, 7/7 funciones y 25/25 líneas; reporte HTML indica 100 % de statements). `pnpm run typecheck:e2e`, `pnpm exec prettier --check frontend/src/app/shared/components/ui/rating/rating.component.spec.ts APP-QA-SPEC.md` y `git diff --check` pasan. Sin cambios de producción ni datos; no requiere E2E porque solo amplía cobertura unitaria. Rollback: retirar `rating.component.spec.ts` y esta subsección.

### QA-04c.UI.AVATAR-SOURCE-RESET.1 · fallback al fallar y sustituir foto

**Fuente revalidada (2026-10-10):** el Karma del commit anterior deja `avatar.component.ts` en **72.72/0/83.33/80 % S/B/F/L**; el único branch sin cubrir es el setter `src`, que solo limpia `broken` cuando cambia la URL. El template emite `imageError` y pinta iniciales sobre una foto rota; no existe spec Karma directo del componente. El contrato visible ya se ejercita parcialmente por las E2E de Cuenta; esta unidad prueba con fixture DOM el fallback, el output y que una URL nueva borra el estado roto, mientras repetir la misma URL lo conserva.

- [x] Añadir primero spec Karma del error de imagen: evento `error` muestra fallback de iniciales y emite la URL fallida; comprobar además que reasignar la misma URL conserva `broken` y cambiarla limpia el fallback.
- [x] Medir `avatar.component.ts` ≥70 % S/B/F/L, ejecutar spec focal y suite frontend completa con coverage temporal, conservar el gate global y verificar typecheck, Prettier y `git diff --check`.
- [x] Registrar comandos, resultados, cobertura y rollback. Runtime E2E N/A: no cambia producción/UI; fixture Angular dispara el evento del `<img>` real de la plantilla. Rollback: retirar el spec y esta subsección.

**Evidencia focal (2026-10-10):** `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/shared/components/ui/avatar/avatar.component.spec.ts --browsers=ChromeHeadless` pasó **2/2**. La suite completa `pnpm run test:client` pasó **1296/1296** con cobertura global **92.3/83.66/91.06/93.68 % S/B/F/L**, aislada en `%TEMP%\hogaria-coverage-avatar-component-8ecde9d355ca476382a30ae1f7e4e426`; `avatar.component.ts` pasó **100/100/100/100 %** (1/1 branches, 6/6 funciones y 10/10 líneas; HTML report 100 % statements). `pnpm run typecheck:e2e`, Prettier focal y `git diff --check` pasan. Sin cambios de producción ni datos. Rollback: retirar solo `avatar.component.spec.ts` y esta subsección.

**Subunidad QA-04c.1 — modelo de ofertas/descuentos de compra (fuente revalidada):** `HOGARIA-SPEC.md` §12h define `buy:3,take:2` como una oferta 3×2; el preset activo lo representa como `{ label:'3x2', buy:3, take:2 }`. `shopping.model.ts::describeOffer` antes devolvía `${buy}x${buy-take}` (3x1) y la plantilla de `shopping-list-detail.component.ts` lo pinta en la chapa accesible de cada fila; Playwright real reprodujo el texto visible y accesible «3x1». Los helpers puros `lineDiscountOfItem`, `describeLineDiscount`, `offerOfItem` y `describeOffer` son usados por la pantalla activa. El normalizador de backend `server/src/utils/list-discount.ts::normalizeOffer` exige `buy ≥ 2`, `take ≥ 1` y `take < buy`, por lo que el helper cliente debe ignorar también filas inválidas. Criterios:

- [x] Reproducir antes de cambiar código con Playwright real: `shopping-round6.spec.ts` Chromium (build/servidor/SQLite/semilla/puerto temporales únicos; rate limit activo) falla de forma concreta: preset «3x2» deja texto visible y title accesible «Oferta 3x1»; screenshot sintético retenido fuera de Git.
- [x] Revalidar el test para Pixel 5: el nuevo intento móvil paró antes de la oferta porque usa el locator desktop `[data-test="new-list"]`, que se oculta intencionadamente ≤600 px; `shopping-lists.component.ts` expone `[data-test="new-list-text"]` como CTA de texto visible. La captura muestra «Nueva lista» y «Empezar una lista» visibles; no es un defecto de producción. El E2E debe elegir el locator visible según viewport antes de validar la oferta.
- [x] Tras adaptar el CTA móvil, Pixel 5 confirma los asserts visibles/accesibles de la chapa, pero no puede tocar «Hecho». La primera medición usó un `setViewportSize(390×844)` de Playwright y dio layout `448×968` frente a visual `390×844`; se revalidó luego sin override con el viewport Pixel 5 del proyecto. La hoja original no tenía límites ni scroll interno.
- [x] Pixel 5 real del proyecto (sin override inicial, 393 px de ancho): prueba geométrica roja aparte del modal detecta overflow previo de la pantalla: `visualViewport.width=393`, raíz `clientWidth=393, scrollWidth=447`; el formulario `.detail__add` ocupa `x=16..377` (361 px), pero sus `app-icon-button` se dibujan en `x=359..399` y `407..447`. El DOM demuestra que los iconos del propio formulario, no el menú fijo, exceden el contenedor. Fuente actual: `.detail__add` es una sola fila flex sin wrap y `.detail__add-campo` solo tiene `flex:1`; falta permitir que el campo se contraiga o refluya.
- [x] TDD rojo de layout: `expect(documentElement.scrollWidth ≤ visualViewport.width)` falla en Chromium mobile real (`447 > 393`) antes de abrir la hoja. Ocultar temporalmente `.bottom-nav` no elimina el exceso. El rojo aislado demuestra que la fila `.detail__add` causaba el ancho extra.
- [x] Primero extender las pruebas unitarias de `shopping.model.spec.ts` para valores ausentes, 0/negativos/no válidos, amount/percent, campos ausentes, límite de unidades y singular/plural; incluir `describeOffer({buy:3,take:2}) === '3x2'` para reproducir el error del nombre visible.
- [x] Cubrir ofertas ausentes/0, `buy < 2`, `take < 1`, `take >= buy` y al menos presets válidos 3×2/2×1; no cambiar el contrato matemático de `HOGARIA-SPEC.md` §12h.
- [x] TDD rojo reproducible en Karma Chrome Headless 154: solo `shopping.model.spec.ts` da `TOTAL: 2 FAILED, 22 SUCCESS`; fallan `offerOfItem({promo_buy:3,promo_take:-1})` (se emite `{buy:3,take:-1}`) y `describeOffer({buy:3,take:2})` (emite `3x1`). La config `ChromeHeadlessSafe` fue temporal y se eliminó.
- [x] Corregir los helpers mínimos, ejecutar el mismo spec en verde y medir ≥70 % por métrica de `shopping.model.ts`: 24/24 aserciones; cobertura del archivo 96.25/86.18/100/96.25 % (statements/branches/functions/lines).
- [x] Corregir con TDD el reflujo de `.detail__add`: E2E Pixel 5 confirma en 393 px y en 320×568 que raíz, formulario y cuatro controles (Añadir, pegar, foto e historial) caben en el `visualViewport`; tras el fix no hay scroll horizontal.
- [x] E2E Chromium aislado de la oferta completa: escritorio 1/1 y Pixel 5 1/1; comprueba el nombre/texto accesible 3x2, persistencia tras recarga y eliminación con un toque. Capturas sintéticas `.e2e-screenshots/shopping-offer-desktop.png` y `shopping-offer-mobile.png` (ignoradas por Git) se inspeccionaron visualmente.
- [x] La hoja móvil a 393 px y 320×568 se mantiene dentro del `visualViewport`, limita altura y usa scroll interno (`overflow-y:auto`); el test alcanza «Hecho», enfoca la acción y la activa con Enter. El fix reserva safe-area top/bottom en CSS y la prueba confirma accesibilidad geométrica y de teclado en Chromium emulado.
- [x] Ejecutar la interacción móvil de cierre X y fondo en el proyecto Playwright `mobile-safari` (WebKit 26.6, iPhone 13 emulado en Windows): el E2E aislado pasó 1/1, incluidos ambos `tap()` y el cierre de la hoja. En 393/320 px se comprobó raíz sin overflow y hoja dentro del layout viewport; WebKit Windows informa visualViewport 384 frente a raíz/layout 390 por un gutter de scrollbar de 6 px, así que esta geometría emulada no se presenta como validación de viewport iOS real.
- [ ] Validar en un dispositivo o runtime iOS Safari real la safe-area nativa no nula y el teclado software nativo. WebKit 26.6 en Windows informa `env(safe-area-inset-*) = 0`; `page.keyboard.press('Enter')` solo valida activación de teclado sintética y no sustituye esa comprobación.

Evidencia final QA-04c.1 (2026-10-08): Karma `shopping.model.spec.ts` 24/24; cobertura del archivo 96.25/86.18/100/96.25 % (statements/branches/functions/lines); build producción del cliente pasó con warnings existentes de budget/imports. E2E aislado escritorio y Pixel 5 pasaron 1/1 cada uno; el caso también pasa ahora 1/1 en Playwright WebKit `mobile-safari` y ejercita X/fondo táctiles, con SQLite/servidor/puerto/semilla temporales y rate limit activo. Capturas PC/móvil existentes en `.e2e-screenshots/`. La emulación Windows devuelve inset safe-area cero y no dispone de teclado nativo, así que esa comprobación en iOS real sigue abierta.

### QA-04c.2 · reparar expectativas E2E de cesta (revalidación antes de cambiar tests)

La primera revalidación de `shopping-round6.spec.ts` dio 7/11; un paso intermedio, 8/11. Los cinco desajustes de expectativas/selectores y el error de UI de foto ya están corregidos o cubiertos abajo; la revalidación actual es Chromium 12 passed/3 skipped y Pixel 5 14 passed/1 skipped. Los skips son escenarios exclusivos del otro viewport; el detalle y los límites del lote permanecen en QA-04c.4/QA-04c.5.

- `newList()` (`tests/e2e/shopping-round6.spec.ts`) crea la lista, espera `/shopping/:id` y navega de vuelta a `/shopping`; por eso el `add-input` no debe existir hasta abrir de nuevo la tarjeta creada.
- `toggleCheck()` mueve la línea marcada fuera de la pestaña «Pendientes»; `visibleItems()` filtra por la pestaña activa y `toggleSelectAll()` selecciona solo esos elementos. La prueba debe pasar a «En el carro» antes de seleccionar todo.
- El atributo `data-test="discount-amount"` vive en el propio `<input>`, no en un wrapper; el selector `discount-amount input` no puede coincidir.
- `[data-test="tray-search"]` se renderiza solo con `filtersOpen()`: el control visible `.tray__filter-toggle` abre el panel; el test no lo hacía.
- El caso de descuento por producto solo asignaba precio `4,00 €/ud` a Jamón y dejaba Leche sin precio; el subtotal aislado era 4,00 €, por eso 2,00 € tras descontar 2 € es correcto. El fixture crea 2 Leches y quiere una línea de 1,00 €; debe fijar `0,50 €/ud` (subtotal previo esperado 5,00 €) para justificar el total posterior de 3,00 €.
- El error de foto confirmó un defecto real de presentación: E2E recibía `409 AI_NOT_CONFIGURED` pero la UI mostraba el mensaje genérico; QA-04c.3 conserva ahora el body original. No se llamó al provider.
- `[data-test="tray-search"]` sigue fallando solo porque el panel de filtros continúa cerrado: abrir `.tray__filter-toggle` es la interacción de UI definida por el template.
- El descuento por producto aplica correctamente el -2 €: total 2,00 € sobre Jamón de 4,00 €; Leche no tenía precio y, por tanto, no forma parte del subtotal. Falta completar el fixture con Leche a 0,50 €/ud (2 uds = 1,00 €) antes de afirmar el total de 3,00 €.

- [x] Revalidar los cuatro rojos iniciales en la suite aislada completa, con servidor/SQLite/puerto/semilla temporales y rate limit activo; registrar 7/11 y 8/11 en corridas intermedias. Tras resolver supuestos/fixtures y el error photo wrapper, Chromium completo pasó 11/11.
- [x] Contrastar helper de creación, filtro/selección visible, selector de importe, mensaje frontend y contrato/handler backend con fuente actual.
- [x] Capturar status/body sin provider: `409 AI_NOT_CONFIGURED` y redirect `/settings/ai`; la misma E2E reproduce que la UI pierde el mensaje específico. No se utilizó proveedor externo.
- [x] Completar correcciones test-only: panel de filtro explícito, selector del input directo, ambas líneas con precio unitario y subtotal previo 5,00 €/total final 3,00 €. Suite completa desktop `shopping-round6.spec.ts` pasó 11/11.
- [x] TDD del wrapper `errorInterceptor`: la regresión unitaria dio 2 FAILED y luego Karma enfocada 2/2; el unwrap conserva status, `body.message` y `body.data` en `analyzePhoto` y se comparte con `complete()`.
- [x] Playwright de foto aislado en Chromium y Pixel 5: HTTP 409 `AI_NOT_CONFIGURED`, enlace `/settings/ai`, lista sin filas; el mensaje específico se muestra y no se contacta provider.
- [x] Ejecutar `shopping-round6.spec.ts` en Chromium (12 passed, 3 skipped) y Pixel 5 (14 passed, 1 skipped); medir cada archivo de lógica focalizada nuevo/cambiado (`picker.component.ts`, `shopping.model.ts`, `shopping-http-error.ts`) por encima de 70 % en statements/branches/functions/lines. UI adicional comprobada por E2E; gate global intacto y aún rojo, ver QA-04c.

### QA-04c.3 · conservar el error de IA tras el interceptor (resuelta)

La ejecución aislada verificó el contrato POST de foto sin configuración → HTTP 409, `message=AI_NOT_CONFIGURED`, `data.redirect=/settings/ai`; antes del fix la UI caía al mensaje genérico. Fuente revalidada: `errorInterceptor` vuelve a lanzar `{ status, message, original: HttpErrorResponse }`; `ShoppingService.analyzePhoto` descartaba `original.error`, mientras `complete()` ya leía `original`. No hay filas IA en la DB de prueba y no se contacta provider.

- [x] Añadir el assert de status/body al E2E sin configuración y reproducir simultáneamente el error visual genérico y la ausencia de escritura en la lista.
- [x] Escribir tests unitarios con el `errorInterceptor` funcional para 409 `AI_NOT_CONFIGURED`/redirect y 502 `AI_UNAVAILABLE`/detail; rojo TDD reproducible en Karma Chrome Headless 154: 2 FAILED, 0 SUCCESS. En ambos resultados el servicio conserva el status pero devuelve `message=AI_UNAVAILABLE` y `data={}`.
- [x] Reutilizar `originalHttpError()` en `complete()` y `analyzePhoto()`; no cambia la semántica del interceptor ni duplica toasts.
- [x] E2E aislado en Chromium y Pixel 5: la respuesta/UI expresan «Falta configurar la IA», enlace lleva a `/settings/ai`, `item-row` sigue vacío y no hay llamada a provider.
- [x] Coverage de la lógica nueva ≥70 % en statements/branches/functions/lines; typecheck, `shopping-round6` Chromium/Pixel 5 y build. El gate global sigue en 80 % y se registra sin rebajarlo (ver QA-04c global).

Evidencia: `shopping-http-error.ts` cubre el helper puro al 100 % en las cuatro métricas; el E2E sin configuración verifica status/body, presentación, cero filas añadidas y cero llamadas al provider. La suite actual de `shopping-round6.spec.ts` pasa en ambos proyectos. La cobertura global y el gate intacto se registran en QA-04c.

**Revalidación posterior:** esta unidad verificó que el enlace mostrara el destino del body, pero no lo siguió. El árbol actual declara `/ai-config`; `settings.routes.ts` solo declara `path: ''`; por tanto `/settings/ai` no es una ruta válida y el wildcard conduce a `/dashboard`. Mantener la preservación del mensaje como resuelta y auditar/cambiar el destino por separado en QA-04c.10.

### QA-04c.10 · el error sin IA recupera a la ruta real sin toast duplicado (verificada)

**Decisión basada en la fuente activa:** `app.routes.ts` declara `/ai-config` como área protegida y `main-layout.component.ts` la ofrece en la navegación; `/settings` es una pantalla distinta y no tiene subruta `ai`. El contrato anterior `/settings/ai` estaba obsoleto. La acción de recuperación del error sin proveedor debe llevar a `/ai-config`; no se añadirá un alias ficticio de settings.

**Hallazgo de la inspección visual PC/móvil:** la hoja ya muestra un error específico y el enlace, pero el mismo `409 AI_NOT_CONFIGURED` además crea un toast global «Error / AI_NOT_CONFIGURED» que persiste al navegar y cubre parte de la cabecera móvil. `error.interceptor.ts` ya define `SILENT_TOAST` precisamente para errores que la pantalla resuelve; `ShoppingService.complete()` lo usa, `analyzePhoto()` no. Para esta respuesta tipada y presentada inline, se conserva status/body pero se silencia el toast genérico.

**Hallazgo de la pantalla de destino:** la captura real de `/ai-config` en Pixel 5 (393 px) muestra que el CTA de cabecera rebasa el borde derecho. La fuente actual `.ai-config__header` es una fila flex sin reflujo móvil. El flujo de recuperación solo queda utilizable si la pantalla destino mantiene su CTA dentro del viewport a 393 y 320 px.

- [x] Actualizar primero el contrato activo y expectativas de backend para `409 AI_NOT_CONFIGURED` → `data.redirect: '/ai-config'`; conservar el estado sin configuración y no llamar al proveedor.
- [x] Añadir regresión E2E al flujo real de foto: mostrar error/link accesible, seguirlo en escritorio y Pixel 5, confirmar URL `/ai-config` y encabezado de configuración, y confirmar cero filas creadas.
- [x] Reproducir rojo aislado con el link actual `/settings/ai`, y corregir backend más fallback frontend al destino único vigente.
- [x] Añadir prueba unitaria focalizada de la política de contexto HTTP silencioso y cubrir el resultado específico con E2E real de `analyzePhoto()`; confirmar que desaparece el toast redundante antes/después de navegar, sin incorporar al scope de coverage las ramas ajenas del servicio legado completo.
- [x] En Pixel 5, demostrar sin overflow horizontal que el CTA «Agregar configuración» queda entero dentro del viewport de `/ai-config` a 393×851 y 320×568; refluir el header si la regresión lo reproduce.
- [x] Ejecutar pruebas unitarias de ruta, Playwright desktop/móvil, typecheck/build y verificar coverage del alcance ≥70 % sin bajar gates.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil; actualizar evidencia y solo entonces marcar checklist.

Evidencia reproducible (2026-09-30): TDD rojo: seguir `/settings/ai` acababa en `/dashboard`, el error dejaba un `.toast--error` global y Pixel 5 a 393 px tenía `scrollWidth=474`; al quitar el toast antes de corregir el servicio, el test de contexto falló (`false` esperado como `true`). Verde: `shopping.routes.spec.ts` 94/94; cobertura del archivo de ruta 89.80/79.92/89.69/92.65 % (statements/branches/functions/lines). `shopping-photo-http-context.spec.ts` 1/1 y su helper 100/100/100/100 %. La cobertura parcial del spec de ruta sale con código 1 porque el scope incluye otros ficheros no ejecutados (por ejemplo `database.ts`, `ai-client.ts`, `memory-monitor.ts`, `taste-profile.ts`, `week-calendar.ts`, `weekly-plan.ts`); no se redujo el gate server global de 70 %.

El E2E full-stack usa el runner aislado `%TEMP%\hogaria-e2e-runner-audit.mjs`, `DATABASE_PATH` SQLite temporal único y rate limit activo, sin proveedor externo ni base normal: `shopping-ai-recovery.spec.ts` Chromium 1/1 y Pixel 5 1/1; en Pixel 5 comprueba 393×851 y 320×568, destino, CTA en viewport, cero overflow, cero items y cero toast duplicado antes/después de navegar. La regresión existente `shopping-round6.spec.ts` pasa Chromium 12 (3 skips esperados) y Pixel 5 14 (1 skip esperado). Typechecks de servidor y E2E y build de producción pasaron; se mantienen warnings previos de bundle (691.41 kB frente al warning de 500 kB), estilos e imports. Capturas sintéticas inspeccionadas: `.e2e-screenshots/shopping-ai-recovery-final-2/shopping-ai-recovery-config-1280.png`, `...-393.png` y `...-320.png` (también se conserva el estado de error PC/móvil); todas ignoradas por Git. El gate global frontend de 80 % sigue pendiente en QA-04c.

### QA-04c.11 · enlaces de recetas y generación IA desde el Dashboard (resuelta)

**Fuente activa y decisión antes de codificar:** `app.routes.ts` declara `/recipes` pero `recipes.routes.ts` solo declara `path: ''`; el `*` envía `/recipes/:id` al Dashboard. La pantalla de Recetas enseña el detalle en un modal (`viewRecipe`) y ya ofrece la API autenticada `GET /api/recipes/:id`. Por tanto, la tarjeta sugerida conservará su destino concreto con `?recipe=<id>` y abrirá ese modal existente; no se creará una segunda vista de detalle. Los CTA Dashboard existentes llevan `#ai`, así que cargar/navegar a ese fragmento abrirá el modal de generación sin enviar una petición al proveedor. Al cerrar cualquiera de los modales, su estado URL se limpiará; un id inexistente debe volver a la lista sin dejar un destino roto.

**Hallazgos TDD durante la integración:** el primer test rojo reprodujo que el click original acababa en `/dashboard`; al reencaminarlo, la modal de detalle aparece pero la ficha queda vacía porque `RecipeService.getRecipe()` devuelve `{ success, data }` como si fuese `Recipe`. El modal IA también conserva un `h2` vacío: el template asigna `[attr.title]` en vez del `@Input() title` de `app-modal`, dejando al diálogo sin nombre accesible. La prueba unitaria de servicio red (3/8 fallos) destapó además que `createRecipe()` y `deleteRecipe()` filtran el envelope de API hacia fuera pese a que sus firmas prometen `Recipe | null` y `boolean`; esta unidad normaliza ambos retornos.

**Hallazgo responsive adicional (Pixel 5 estrecho 320×568):** el E2E midió 302 px de contenido de acciones en 240 px disponibles: el segundo botón de `.ai-form__actions` queda cortado horizontalmente porque la regla móvil solo apila los campos. El reflujo y la medición real de ambos botones son la unidad pendiente.

**Hallazgo responsive de la ficha (Pixel 5 320×568):** tras abrir el deep link a 320 px en un documento nuevo, `.recipe-detail__actions` también desborda: la fila mide 332 px de contenido dentro de 240 px disponibles. El primer intento de E2E se detuvo ante esta aserción y dejó el fixture sintético sin borrar; el siguiente caso falló en cascada por encontrar esa receta. La prueba debe limpiar su receta propia en `finally`, incluso si una aserción falla.

- [x] TDD E2E con receta sintética creada por API en SQLite temporal: la tarjeta sugerida del Dashboard abre la receta concreta en desktop y Pixel 5; recargar el deep link conserva modal/contenido; cerrar vuelve a `/recipes` y quita `recipe`.
- [x] TDD E2E del CTA principal y del estado vacío: seguir `#ai` abre el formulario accesible tanto al navegar desde Dashboard como al cargar `/recipes#ai`; cerrar limpia el fragmento y no llama a IA.
- [x] Refluir las acciones de la modal IA a 320 px y medir ambos botones completos dentro del viewport; mantener scroll vertical usable y comprobar 393×851/320×568.
- [x] Refluir también las acciones de la ficha a 320 px; medir «Cocinar ahora» y «Añadir a favoritos» completos en su contenedor y viewport, con espacio bajo los botones.
- [x] Limpiar siempre la receta sintética E2E con `finally`, para que una aserción fallida no contamine casos posteriores.
- [x] Probar `/recipes?recipe=missing` como borde: mantener la página de Recetas, no abrir detalle vacío ni caer en Dashboard, limpiar el id inválido con una salida recuperable.
- [x] Corregir `RecipeService.getRecipe()` para desempaquetar el DTO; unit test cubre éxito/error y `currentRecipe`.
- [x] E2E comprueba nombre/descripción/ingredientes reales del detalle abierto por deep link.
- [x] Alinear `createRecipe()` y `deleteRecipe()` con sus tipos de salida (`Recipe | null` y `boolean`); los tests comprueban payload y persistencia de la señal al fallar.
- [x] Corregir el binding del título del modal IA a su `@Input()`; E2E confirma el nombre accesible del diálogo al navegar y al cargar `#ai` directamente.
- [x] Añadir pruebas unitarias de resolución de intención de ruta (incluida precedencia entre `recipe` y `#ai`).
- [x] La cobertura de `RecipeService` y del resolver, con la prueba focal aislada, supera el 70 % de statements, ramas, funciones y líneas sin bajar gates.
- [x] Revisar patrones de ruta/template y ejecutar typecheck/build, pruebas aisladas desktop/Pixel 5 y capturas sintéticas PC/móvil inspeccionadas.

**Evidencia final (2026-09-30):** las corridas reales de Playwright usaron `E2E_SCOPE=all`, `E2E_RATE_LIMIT=on` y el runner `%TEMP%\hogaria-e2e-runner-audit.mjs`, que asigna puerto/SQLite únicos y limpia el DB temporal al terminar. Comando reproducible (desde la raíz; repetir para cada variante):

```powershell
$env:E2E_SCOPE='all'; $env:E2E_PROJECT='<chromium|mobile-chrome>'; $env:E2E_FILES='<dashboard-recipe-links.spec.ts|recipe-actions-mobile.spec.ts>'; $env:E2E_RATE_LIMIT='on'; node "$env:TEMP\hogaria-e2e-runner-audit.mjs" (Get-Location).Path
```

`dashboard-recipe-links.spec.ts` pasó **3/3 Chromium** y **3/3 Pixel 5**; `recipe-actions-mobile.spec.ts` pasó **1/1 Pixel 5**, midiendo 393×851 y 320×568. Las regresiones rojas anteriores midieron 302 px (IA) y 332 px (ficha) en 240 px disponibles; el CSS ahora apila ambas filas a ≤480 px. Aserciones miden ancho, cajas completas, viewport y 8 px de separación inferior; el modal IA conserva desplazamiento vertical, raíz sin overflow horizontal y cero llamadas `/api/ai/`. Los fixtures API sintéticos se borran en `finally`.

Karma focal, desde `frontend`: `node .\node_modules\@angular\cli\bin\ng test --no-watch --code-coverage --include=src/app/core/services/recipe.service.spec.ts --include=src/app/features/recipes/recipe-route-intent.spec.ts --browsers=ChromeHeadless` pasó **11/11**, statements **100 % (64/64)**, ramas **83.33 % (10/12)**, funciones **100 % (31/31)** y líneas **100 % (50/50)**; servicio aislado **8/8**, 100/80/100/100. Gate local Karma existente: 80 % por métrica. También pasaron `node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.e2e.json`, `node .\node_modules\prettier\bin\prettier.cjs --check tests/e2e/dashboard-recipe-links.spec.ts tests/e2e/helpers/recipe-fixtures.ts tests/e2e/recipe-actions-mobile.spec.ts` y `node .\node_modules\@angular\cli\bin\ng build --configuration production` (warnings previos: bundle 691.58 kB vs 500 kB, estilos e imports no usados; exit 0).

Capturas sintéticas inspeccionadas: `.e2e-screenshots/dashboard-recipe-links-route-rerun/desktop/` (1280), `.../mobile/` (393×851) y `.e2e-screenshots/recipe-actions-mobile-final-rerun/` (detalle/IA 393×851 y 320×568), todas ignoradas por Git. Se repitieron los tres proyectos/alcances antes de cerrar; cada runner eliminó su SQLite/artefactos temporales tras el resultado verde. Rollback: los commits de servicios, navegación y reflujo son unidades separadas; esta última solo revierte el apilado de `.ai-form__actions` y `.recipe-detail__actions` y su E2E móvil.

### QA-04c.4 · matriz móvil de bandeja (revalidada en este alcance)

En la línea base histórica, la suite Chromium pasó 11/11 y Pixel 5 pasó 3/11; tras corregir el CTA móvil, una corrida intermedia pasó 4/11. Cuatro fallos de bandeja compartían un selector helper defectuoso: `[data-test="back"], a[href="/shopping"]` elegía primero un enlace del sidebar fuera del viewport, aunque existía el botón de retorno visible `[data-test="back"]`. Otros tres fallos de cesta eran pointer interception: el botón Añadir quedaba debajo de la lista de autocomplete abierta (`.detail__sugs`). La bandeja es intencionalmente tarjeta móvil: a ≤720 px la cabecera/columnheaders se ocultan y cada celda lleva su etiqueta. `HOGARIA-SPEC.md` §8f especifica la tabla y ordenación de escritorio, filtros compactos en móvil y no exige ordenar desde la tarjeta. El resultado actual de la suite está debajo.

- [x] Baseline aislado Pixel 5: 3/11 pasó con selectores desktop; la ejecución con CTA móvil corrigió cuatro flujos y pasó 4/11 (oferta, foto y dos calendarios), con 7 rojos capturados.
- [x] Revalidar en el template/CSS que el CTA de texto es la acción móvil y que la cabecera de tabla oculta es comportamiento responsive previsto.
- [x] Corregir el helper de retorno para usar el control visible `[data-test="back"]`; conservar ordenación de columnas en escritorio y comprobar en móvil tarjetas, acciones, filtro expandible, crear/abrir, renombrar y paginación.
- [x] Asegurar en móvil que la lista de sugerencias no bloquea Añadir: selección táctil/teclado, entrada libre con cantidad y envío sin Escape ni `force`.
- [x] Repetir la suite de compra en Pixel 5 aislado, además de Chromium escritorio; capturar e inspeccionar PC y 393×851/320×568.

Evidencia actual, `shopping-round6.spec.ts` aislado con rate limit activo, SQLite/puerto/semilla temporales únicos: Chromium **12 passed, 3 skipped** (solo escenarios móviles omitidos) y Pixel 5 **14 passed, 1 skipped** (solo escritorio omitido). Las capturas PC/móvil quedaron bajo `.e2e-screenshots/shopping-final-desktop/` y `.e2e-screenshots/shopping-final-mobile-verified/`; las de 320 px verifican navegación y ancho sin scroll horizontal.

### QA-04c.5 · autocomplete bloquea «Añadir» en móvil (resuelta)

En la línea base Pixel 5, el listbox de `.detail__sugs` aparecía debajo del input como `position:absolute; z-index:40` y cubría acciones de `.detail__add` al envolver en móvil la segunda fila del formulario. `HOGARIA-SPEC.md` §8e/§8f exige captura rápida, lista accesible y acciones funcionales con una mano; no debe necesitar Escape de escritorio para poder pulsar Añadir. El estado vigente cambia el listbox a flujo estático a ≤600 px.

Hallazgo intermedio histórico: después del primer reflujo CSS, un hit-test DOM no coincidía con el botón aunque el CTA era visible; el test inicialmente usó `.click()` y el snapshot mostraba el input reiniciado tras la acción. La validación final sustituyó el hit-test frágil por `tap()` real, comprobó cantidad persistida y pasó en ambos viewports.

- [x] Reproducir en Pixel 5 real del proyecto: click de puntero en `add-submit` con sugerencias visibles es interceptado; 3 casos de `shopping-round6` se detienen ahí. Captura synthetic del overlay inspeccionada.
- [x] Contrastar el comportamiento con el markup (`role=combobox`, `aria-autocomplete=list`, `role=listbox/option`, `mousedown.preventDefault`) y la capa absoluta/z-index; desktop Chromium puede usar el flujo actual.
- [x] Escribir regresión móvil con sugerencias visibles; el primer `elementFromPoint()` fue intermitente durante la transición de vista aunque el CTA se veía, por eso el test final usa `tap()` real y verifica el estado guardado, sin `force` ni Escape.
- [x] Refluir el listbox en móvil dentro del formulario; preservar toque a sugerencia, flechas/Enter/Escape, foco y entrada libre.
- [x] E2E quick-add móvil: en 393×851 envía texto libre con cantidad; en 320×568 el envío repetido fusiona cantidad (2→4) sin fila duplicada ni selección accidental; además añade una sugerencia táctil y otra con teclado, sin scroll horizontal ni `pageerror`.
- [x] Repetir `shopping-round6` completa en escritorio y Pixel 5 a 393×851/320×568; capturas sintéticas inspeccionadas. El test de toque real pasa 1/1 focalizado y el proyecto móvil 14/15 (un skip de escenario exclusivo de escritorio).
- [x] Probar `tap()` táctil real sobre Añadir con sugerencias abiertas en ambos anchos; verificar una sola alta/fusión por acción y que el autocompletado no se elija accidentalmente.

### QA-04c.6 · selector de descuento bloquea Guardar en hoja móvil (resuelta)

La revalidación de `shopping-round6.spec.ts` en Pixel 5 pasó 11/12. En «Descuento de la lista», tras elegir `10 %`, el click real a `discount-save` queda interceptado por la opción `50 %` del listbox; la captura synthetic muestra el panel abierto cubriendo el CTA al pie de la hoja. Causa probable respaldada por el DOM: `app-picker` (con su botón interactivo interno) está envuelto por `<label class="detail__field">`; al elegir una opción el panel se cierra, pero la activación por defecto del label puede volver a pulsar el trigger y reabrirlo. La prueba genérica del picker cierra con éxito fuera de ese wrapper. No afecta al run desktop observado.

- [x] Reproducir en Pixel 5 aislado con rate limit: 11/12; `locator.click()` sobre Guardar agotó 45 s y Playwright identificó `.picker__label` «50 %» interceptando el puntero.
- [x] Inspeccionar `PickerComponent.choose()` → `emit()` → `close()` y el wrapper `<label>` de descuento; el label re-activa el trigger descendiente tras elegir la opción.
- [x] Añadir regresión enfocada: tras elegir se exige panel ausente y `aria-expanded=false` antes de pulsar Guardar. Rojo Pixel 5 aislado: esperado 0 paneles, recibido 1 (12 s); la versión previa agotó el click a Guardar en 45 s.
- [x] Escribir prueba unitaria del picker para nombre accesible, selección/cierre, Escape y click exterior; Karma enfocada rojo 1 FAILED / 2 SUCCESS (`aria-label` actual es null), mientras selección/cierre normal pasa.
- [x] Validar que Guardar recibe la acción en móvil y mantener teclado/Escape/click exterior.
- [x] Corregir el wrapper `<label>` interactivo con un contenedor no-label; comprobar 1440×900, 393×851 y 320×568 con E2E, captura y estado cerrado antes de Guardar.

Evidencia: las pruebas unitarias del Picker (13/13), build y suites `shopping-round6` de Chromium/Pixel 5 pasan; la selección de 10 % no reabre el panel y el descuento se guarda/retira. La cobertura por archivo del Picker supera 70 % en las cuatro métricas.

### QA-04c.7 · filtro del selector no reacciona al texto escrito (resuelta)

Al ampliar las pruebas del control compartido, una regresión unitaria real detectó que `filtered` es un `computed` que lee `query` como propiedad ordinaria. El `ngModel` actual modifica el texto visible, pero no invalida el valor memoizado: al buscar por pista o valor el listado completo sigue presente y Enter elige la primera opción en vez de la escrita. Esto afecta a los pickers con buscador (p. ej. unidades/catálogos) aunque el selector de porcentaje no muestre campo por su `filterFrom` alto.

- [x] Escribir unit de búsqueda por valor, pista, texto libre y Enter exacto; Karma enfocada da 7 SUCCESS / 1 FAILED: `filtered()` devuelve las 4 opciones tras teclear `Fresco` y, ante texto desconocido, Enter elige `10`.
- [x] Convertir query y opciones en estado reactivo; filtrar label/value/hint y conservar coincidencia exacta, custom, vacíos y reset/foco al abrir/cerrar.
- [x] Añadir E2E real en el selector de unidad; buscar cero coincidencias, texto custom, flechas/Enter/Escape, persistencia tras reload y nombre accesible en escritorio/móvil.
- [x] Ejecutar unitarias focalizadas (13/13), coverage de picker ≥70 % (96.90/92.42/100/97.37), build y E2E responsive; capturas 1440×900, 393×851 y 320×568 inspeccionadas.
- [x] En el E2E real, filtrar `250`, confirmar con ArrowDown+Enter y elegir label exacto `g` aunque `kg` anterior lo contenga como substring.
- [x] Evitar doble procesamiento del keydown en el input; el espacio no confirma una opción, y cada Enter emite una sola selección.

La regresión quedó reproducida antes de corregir: Karma focalizada 13 tests, 3 fallidos. Con query `g`, `kg` (substring anterior) ganaba; ArrowDown+Enter emitía dos veces por propagación al listbox; espacio seleccionaba/cerraba. El test final pasa 13/13.

Revalidación E2E en `shopping-round6.spec.ts`: búsqueda exacta/texto custom/Escape/persistencia, ArrowDown+Enter y el caso exacto `g` pasan en Chromium 1440×900 y Pixel 5 a 393×851/320×568. En el primer run estrecho aparecieron cuatro errores de transición; las ejecuciones actuales ya no los reproducen y el test comprueba `pageerror` vacío tras reload.

### QA-04c.8 · valor anunciado y opciones dinámicas de `app-picker`

La revisión del diff señaló dos riesgos reales: el `aria-label` podía omitir el valor elegido y `filtered`/`rows` no se invalidaban cuando cambiaban las opciones mientras el panel seguía abierto.

- [x] Reproducir el nombre accesible en navegador después de seleccionar una opción, con label explícito y fallback; comunica propósito/valor y conserva `aria-expanded`/listbox.
- [x] Cambiar opciones mientras panel/búsqueda está abierto; listado, filtro y agrupaciones se actualizan sin reabrirlo.
- [x] Tests TDD cubren nombre accesible, opciones dinámicas, teclado, custom, selección/deshabilitado y click exterior.
- [x] Ejecutar unit 13/13, Playwright real PC/móvil, build y coverage del Picker 96.90/92.42/100/97.37 %.

### QA-04c.9 · desbordamiento horizontal de la shell de compra a 320 px (resuelta)

En la línea base Pixel 5 aislada a 320×568, `clientWidth` era 320 y `scrollWidth` 343; la shell y `.tray__tabs` excedían el viewport. Se observaron errores de `withViewTransitions()` en una ejecución temprana; no deben confundirse con el overflow ni con la revalidación actual.

La primera hipótesis de que solo los labels de bottom-nav imponían el ancho quedó refutada. El arreglo vigente combina anchors flexibles de navegación y reducción/truncado responsivo de la fila de filtros; el control oculto conserva nombre accesible y contador.

Medición directa posterior: `.tray__tabs` está en x=16..304 (288 px) pero su `scrollWidth` es 327; los botones «Activas», «Terminadas», «Todas» y «Filtros» consumen el ancho intrínseco, y el último acaba en x=343. La corrección debe mantener el nombre accesible/contador del filtro y objetivos táctiles ≥44×44 px; truncar u ocultar solo el texto visible requiere proporcionar el nombre del control explícitamente.

- [x] E2E Pixel 5 comprueba ancho, scroll y rectángulos de bottom-nav/filtros en `/shopping` a 320×568 y 393×851.
- [x] Corregir fila de estados/filtros y shell, conservando nombre/contador accesible, destinos ≥44×44 px y navegación.
- [x] Confirmar ancho raíz sin overflow en ambos viewports y `pageerror` vacío en la revalidación completa.
- [x] Capturar/inspeccionar PC y móvil estrecho; build y tests contra servidor/SQLite aislados, dejando intactos server 4200 y la base normal.

Evidencia QA-04c.9: E2E de bandeja y selector miden root `scrollWidth ≤ clientWidth`, tabs sin overflow y controles/nav dentro del viewport a 393×851 y 320×568; la suite Pixel 5 completa pasa 14/15 (un skip de escritorio). Capturas finales bajo `.e2e-screenshots/shopping-final-desktop/` y `.e2e-screenshots/shopping-final-mobile-verified/`. Las cancelaciones de transición observadas en el baseline no se reprodujeron en el test actual.

### QA-04b · hit area táctil de `app-checkbox`

**Hallazgo reproducido y causa:** la línea base de `checkbox.component.ts` declaraba `min-height: 36px` y no fijaba el ancho; el E2E aislado midió el control real antes del cambio por debajo del mínimo interno. Tras subir el CSS a 44×44, la primera medición encontró 42.49 px durante la animación `scaleIn` del modal; el test espera ahora a que finalicen las animaciones y mide el rectángulo estable.

**Criterio de aceptación:** el contrato de producto pide ≥40 px, mientras que `AGENTS.md` fija ≥44×44 px para objetivos táctiles; se aplicará el criterio interno más estricto, midiendo el rectángulo real del botón en navegador (no solo su CSS declarado), sin cambiar nombre accesible ni semántica.

- [x] Añadir regresión que mide el rectángulo real de `button[role=checkbox]` en Chromium escritorio y Pixel 5 móvil; la unidad comprueba disabled/outputs y la E2E nombre, `aria-checked`, foco, Space y Enter sin cambiar semántica.
- [x] Corregir el tamaño mínimo con CSS `min-width`/`min-height: 44px`; Calendario alcanza ≥44×44 px en navegador a 1440×900, 393×851 y 320×568, sin overflow horizontal ni solapamiento visible en capturas inspeccionadas.
- [x] Ejecutar Karma (3/3), Playwright real (Chromium 1/1; Pixel 5 2/2) para abrir, operar y cancelar el formulario; capturas sintéticas PC/móvil conservadas bajo `.e2e-screenshots/calendar-checkbox-final/` e inspeccionadas.
- [x] Cobertura del alcance `checkbox.component.ts`: 100 % statements, ramas, funciones y líneas; gate configurado del 80 % intacto. La ejecución focalizada excluyó únicamente `ui/icon/**`, dependencia fuera del alcance, para medir este componente.
- [x] Revalidar el posible solapamiento del error de Configuración con la navegación fija móvil: capturar el viewport real en vez de depender solo de screenshot `fullPage`, comprobar que el aviso contextual no intersecta `.bottom-nav` y que no aparece ningún toast HTTP duplicado; si no se reproduce, documentarlo sin cambios de producción.

Evidencia QA-04b (2026-09-30): Playwright aislado con `E2E_RATE_LIMIT=on`, proyecto `chromium` (1/1) y `mobile-chrome` Pixel 5 (2/2), cada ejecución con puerto y SQLite únicos bajo `%TEMP%`; no se usó el servidor/base de datos normal. Karma focalizada con Chrome Headless 154 y umbral configurado sin cambios: 3/3; cobertura de `checkbox.component.ts` 100/100/100/100. Build de producción ya completado para servir la compilación actual; `tsc -p tsconfig.e2e.json --noEmit` y `git diff --check` pasan. Capturas: `calendar-checkbox-desktop-1440x900.png`, `calendar-checkbox-mobile-393x851.png` y `calendar-checkbox-mobile-320x568.png`.

**Hallazgos QA-04 resueltos:** las credenciales de sesión heredadas no se limpiaban al hacer logout, el observable de AuthService dejaba salir wrappers `{data:...}`, y `ModulesService.apply()` no liberaba `isSaving` al recibir `error`. Los demás fallos basales eran mocks/expectativas obsoletas. El test de Settings confirma rollback, desbloqueo y reintento por teclado en tamaños desktop y móvil; `TasteProfileService.save()` ya suprime el toast HTTP genérico para que el formulario muestre un solo aviso contextual.

**Revalidación del aviso de error (2026-10-08):** se amplió `tests/e2e/full-stack/settings-modules-error.spec.ts` para capturar el viewport además del `fullPage`, exigir que no se produzca un `.toast` duplicado y medir que la caja de `.settings-hint--error` no intersecta `.bottom-nav` en 320×740, 360×800, 390×844, 430×932, 844×390 y 932×430. Playwright real aislado (SQLite/puerto/usuario sintéticos, cleanup propio) pasa **2/2** en Chromium escritorio y Pixel 5; los viewports móviles no tienen solapamiento. Capturas sintéticas de estado de error inspeccionadas: `.e2e-screenshots/qa-settings-modules-error-viewport/` (viewport y `fullPage` para PC/móvil). `pnpm run typecheck:e2e`, Prettier y `git diff --check` pasan; no se modificó producción porque la sospecha no se reprodujo.

### Discrepancias que requieren prueba/decisión

- [x] Dashboard/recetas: rutas para receta concreta y modal de generación resueltas con decisión y evidencia TDD en QA-04c.11; otras superficies pendientes de `/dashboard` siguen abiertas en la checklist funcional.
- [x] Revalidación aislada actualizada de `shopping-round6.spec.ts` contra vista y contrato actuales: los cuatro fallos antiguos ya no se reproducen. El input existe tras crear/abrir lista; «seleccionar todo» muestra la barra en la pestaña visible; la foto presenta `409 AI_NOT_CONFIGURED` y su error inline; el selector actual `[data-test="discount-amount"]` es el propio input. Playwright con servidor/SQLite/puerto/semilla temporales y rate limit activo: Chromium 12 passed/3 skips esperados y Pixel 5 14 passed/1 skip esperado; verificado de nuevo en esta corrida.
- [x] `playwright.full-stack.config.ts` dejó de declarar `webServer`/DB en el repo: el supervisor asigna puerto y `DATABASE_PATH` temporal exclusivos y valida readiness antes de Playwright; smoke servido real 4 passed/1 skip (QA-E2E.1).
- [x] La suite E2E de desarrollo ya no reutiliza `:4200` ni la base por defecto: ambas configs rechazan ejecución directa y el runner crea puertos/SQLite bajo `%TEMP%`; smoke de escritura autenticado pasó en Chromium y Pixel 5 (QA-E2E.1).
- [x] Confirmar gates locales: frontend 80 % y backend 70 %; CI ejecuta cobertura backend y no declara job de coverage frontend.
- [x] Elevar coverage frontend al 80 % local sin rebajar el umbral ni ocultar ficheros; registrar discrepancia de CI.

**Evidencia histórica de la suite frontend (2026-10-01):** Karma **614/614** tests, con Statements **58.76 %**, Branches **50.00 %**, Functions **47.63 %** y Lines **60.51 %**. No se modificó el umbral. CI no ejecuta este gate frontend.

**Cierre local (2026-10-08):** la revalidación vigente de QA-04c ejecutó `pnpm run test:client` con **1152/1152** y **88.88/80.44/88.38/90.23 % S/B/F/L**, salida 0. `.github/workflows/ci.yml` solo valida el cableado de Karma en Type Check; no ejecuta coverage frontend (sí ejecuta el gate backend al 70 % por archivo). Queda registrado el hueco de CI, sin falsear un resultado remoto para ese gate.

## QA-05.PATH.1 · exclusión portable del catálogo i18n (resuelta localmente)

**Fuente revalidada antes de QA-05.PATH.1 (2026-10-01):** `node scripts/check-ui.mjs` imprimía 13 avisos `texto-en-un-catalogo` en `labels.ts:345-358`. `scripts/check-ui.mjs` recorre rutas nativas de Windows con `path.join()`, pero las exclusiones equivalentes de `core/i18n` comparan el literal POSIX `file.includes('core/i18n')` (reglas 18/19); la exclusión de la regla 15 ya normaliza `\\` a `/`. `PANTRY_CATEGORY_LABEL_KEYS` asigna las 13 claves del diccionario y `PANTRY_CATEGORY_FACTORY_NAMES` conserva los nombres canónicos de datos para distinguir las categorías renombradas. `pantryCategoryLabel()` traduce las de fábrica y preserva texto personalizado; el diccionario ES/EN contiene las etiquetas. El contrato activo HOGARIA-SPEC §12x/§12aa conserva esa conducta. No convertir estos nombres canónicos en labels ni debilitar la regla.

- [x] Añadir primero una regresión del path helper/exclusión: rutas POSIX y Windows a `core/i18n/labels.ts` se excluyen; una ruta fuera de `core/i18n` se sigue analizando.
- [x] Probar las 13 categorías de fábrica en ES/EN y preservar nombre renombrado, categoría personalizada y clave huérfana; funciones tocadas ≥70 % en statements, branches, functions y lines.
- [x] Corregir únicamente la normalización de paths de las exclusiones; no añadir allowlist ni ocultar incidencias reales.
- [x] Ejecutar el test focal y `node scripts/check-ui.mjs` en Windows; mantener sin cambios gates existentes.

**Evidencia reproducible (2026-10-01):** TDD partió de los 13 falsos avisos `texto-en-un-catalogo` en `labels.ts:345-358`, causados por comparar rutas Windows con un literal POSIX. `node --test --experimental-test-coverage scripts/check-ui-paths.test.mjs`: **3/3**, el helper 100/100/100/100. Karma completo: **614/614**; incluye la tabla de las 13 categorías en ES/EN y los casos de rename, custom y huérfana; `labels.ts` mide 94.74/77.27/75.00/94.74 % (S/B/F/L), por encima del mínimo de 70 %. `node scripts/check-ui.mjs`: **181 ficheros, 20 reglas, sin incidencias**. Typecheck y build frontend pasan; no se cambió el gate global frontend de 80 % (el estado se documenta en QA-04c global). Rollback: revertir `scripts/check-ui-paths.mjs`, sus tests, las exclusiones normalizadas de `scripts/check-ui.mjs` y la ampliación de `pantry-gestor.util.spec.ts`.

## QA-05.CHECK-UI.TEST-FIXTURES.1 · no analizar fixtures como texto visible

**Fuente revalidada (2026-10-03):** `scripts/check-ui.mjs` excluye `.spec.ts`, pero analiza `frontend/src/app/core/interceptors/auth.interceptor.test-fixtures.ts` como interfaz. La única incidencia actual es `texto-en-un-catalogo` para `name: 'Auth Interceptor'`; la búsqueda del literal solo encuentra esta fixture sintética de `AuthResponse`, no texto que renderice una pantalla. La corrección debe excluir únicamente helpers de prueba y mantener analizado el código real.

- [x] Reproducir el hallazgo en `check-ui` y confirmar que la cadena solo existe en la fixture de test.
- [x] Añadir regresiones POSIX/Windows para excluir `*.test-fixtures.ts` y conservar dentro del análisis un `.ts` de pantalla real.
- [x] Excluir esos helpers del escaneo visible sin añadir allowlist ni relajar reglas sobre producción; ejecutar tests del helper y `check-ui` completo.
- [x] Reejecutar `git diff --check` y registrar limitaciones/gates globales sin cambiar sus umbrales.

**Evidencia QA-05.CHECK-UI.TEST-FIXTURES.1 (2026-10-03):** antes del ajuste `node scripts/check-ui.mjs` marcó solo la fixture `Auth Interceptor` entre 188 archivos. Las dos regresiones nuevas fallaron antes de producción por falta del filtro; después `node --test --experimental-test-coverage scripts/check-ui-paths.test.mjs` pasa **5/5** y `check-ui-paths.mjs` alcanza **100/100/100/100 %** (sentencias/ramas/funciones/líneas). `node scripts/check-ui.mjs` pasa en **187 ficheros, 20 reglas, 0 incidencias**; rutas Windows/POSIX de specs/fixtures se excluyen y pantallas reales siguen dentro del escaneo. `git diff --check` pasa; no cambia UI de producto ni el gate de cobertura frontend.

## QA-RECIPES.AI-FLOW.1 · generación, selección y persistencia (validación funcional y gate global verificados)

**Fuente revalidada antes de codificar (2026-10-01):** baseline observado: el servicio devolvía `null` sin borrar borradores previos, el componente mostraba éxito aun con `null`/lista vacía, no renderizaba `generatedRecipes()`, ambos endpoints persistían prematuramente y el múltiple hacía self-fetch a `localhost:3000` (incompatible con puerto aislado). Los nuevos tests cubren el resultado nulo/500, la lista vacía/inválida, error de proveedor, conteos antes/después y reintento. La ruta AI está deliberadamente fuera de `COVERED` en `server/vitest.config.ts` (cobertura por fichero); se prueba por integración. No afirmar coverage global aprobada.

**Decisión de producto para este flujo:** generar produce borradores; `Guardar receta` es el acto explícito que crea una sola fila persistente. El modo múltiple muestra sus candidatas para comparar y permite guardar una; cancelar/cerrar no persiste ninguna. Fallo HTTP, `null` o lista vacía da error localizado, nunca un toast de éxito; loading siempre termina y permite reintentar conservando borradores anteriores utilizables. No se debe resolver el flujo llamando a un proveedor real.

**Aislamiento:** el runner asigna a la API un puerto efímero. Los E2E usan servidor OpenAI-compatible sintético en loopback/puerto temporal y config IA exclusiva de la SQLite del run; no consultan el proveedor LAN ni escriben en la DB habitual.

- [x] Añadir primero regresiones unitarias/integración/E2E para el falso éxito, candidatos no renderizados, persistencia prematura y posible duplicado.
- [x] Extraer/reusar la lógica de generación sin self-fetch; ambas rutas devuelven borradores, no persisten recetas y fallan si la respuesta no contiene candidatas utilizables.
- [x] Presentar una receta o candidatas múltiples; permitir guardar una sola candidata y cancelar sin persistir; errores/loading permiten reintento y preservan candidatas previas utilizables.
- [x] Añadir tests del contrato single/multiple, error, respuesta vacía, guardado y aislamiento. AiService: coverage **98.59/89.47/97.50/98.59 %** (S/B/F/L); rutas: 13 pruebas de integración. El módulo de rutas no forma parte del umbral server por diseño vigente.
- [x] E2E full-stack/dev aislado app + API + SQLite temporal y proveedor sintético: error/timeout/retry, recetas simples y tres candidatas, payload, guardado/cancelación y lecturas tras reload.
- [x] Ejecutar Chromium + Pixel 5 en 1440×900, 393×851, 320×568 y paisaje; verificar Enter/Escape, nombres accesibles, overflow, errores de página y datos persistidos. Capturas desktop/móvil guardadas e inspeccionadas.
- [x] Cerrar cobertura global frontend; conservar gate de 80 %, documentar que CI no ejecuta este gate y hacer commit/push de la unidad solo tras validar el gate requerido.

**Evidencia reproducible (2026-10-01):** TDD añadió expectativa antes del fix: Karma `AiService` rojo 1/11 (fallo HTTP borraba la receta/lista previa) y E2E Chromium 1440×900 rojo al segundo intento (API 500 eliminaba las tres candidatas). Verde: `AiService` **11/11**; `server/src/routes/ai.routes.spec.ts` **13/13**; build/typecheck servidor y typecheck E2E pasan; `ng build --configuration production` pasa con warnings previos de budgets/imports no usados. Playwright real: `node scripts/run-isolated-playwright.mjs tests/e2e/recipes-ai-generation.spec.ts --project=chromium --project=mobile-chrome`, **18/18**; además prueba standalone múltiple 1440×900 **1/1** para confirmar arranque cold de ruta lazy. App/API usan DB única temporal y proveedor stub loopback; `E2E_RATE_LIMIT=off` permite 18 registros sintéticos, sin llamar proveedor LAN ni usar `localhost:4200` para escrituras. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-recipes-ai-final-verify2/` (1440×900, 393×851, 320×568 y 568×320). Primer intento sin `E2E_CHROME_BIN` no lanzó navegador (binario Playwright ausente); repetido con Chrome del sistema pasó. El gate global de coverage frontend sigue abierto en QA-04c. Rollback: revertir juntos el flujo de borradores en `server/src/routes/ai.routes.ts`, el contrato de `AiService` y UI en `frontend/src/app/core/services/ai.service.ts`/`recipes.component.ts`/`dict/recipes.ts`, sus pruebas `*.spec.ts` y el E2E `tests/e2e/recipes-ai-generation.spec.ts`.

**Revalidación de E2E y cierre del gate (2026-10-08):** el catálogo vigente trae recetas semilla y el diálogo de IA
tiene tres pasos; se quitaron aserciones que esperaban catálogo vacío o buscaban controles del paso 3
antes de llegar a él. Las regresiones de catálogo, favoritos, ficha y pantry/iconografía pasaron **11/11**
en Chromium; la tanda ampliada Chromium + Pixel 5 pasó todos los casos al corregir el helper de scroll
documentado en QA-LAYOUT.RECIPE-DETAIL.1. Los fixtures siguieron siendo sintéticos y no se llamó a la IA
real. El gate global se revalidó después con `pnpm run test:client`: **1164/1164**, **90.17/81.39/88.93/91.54 % S/B/F/L**; supera 80 % en las cuatro métricas. El workflow CI #461 pasó 9/9 y su fuente confirma que no ejecuta Karma, así que el gate frontend queda documentado como verificación local. La suite de cobertura no usó proveedor IA real. Este resultado cierra el único criterio pendiente de cobertura global de esta unidad; no implica que el barrido funcional completo esté cerrado.

### QA-RECIPES.COOK-ACTION.1 · confirmar el registro de «Cocinar ahora»

**Fuente revalidada antes de implementar (2026-10-09):** `POST /api/recipes/:id/cook` registra una
cocción en el estado del usuario y la API incrementa el contador solo al completar la escritura. Sin
embargo, `RecipeService.recordCooking()` oculta los errores y retorna `void`; `RecipesComponent` muestra
éxito y cierra la ficha antes de saber si el POST terminó. No hay una E2E de navegador que compruebe el
resultado del botón. `HOGARIA-SPEC.md` no define explícitamente el comportamiento ante ese error.

**Decisión de prueba (inferencia explícita):** «Cocinar ahora» solo confirma éxito y vuelve al listado
después de que el servidor registre la cocción. Mientras el POST está pendiente se impiden envíos
duplicados; si falla, la ficha queda abierta, aparece un error traducido y el usuario puede reintentar.
Un fallo no cambia el contador. Esta conducta evita declarar una acción persistente que el servidor no
guardó; la inferencia se limita a este feedback y no modifica el contrato del endpoint.

- [x] Escribir primero una E2E roja con receta propia sintética en SQLite temporal: retener el primer
      POST, impedir el doble envío, responder 503 y verificar que el detalle sigue abierto, no hay éxito
      y el contador no cambia; reintentar contra el API aislado y comprobar exactamente un incremento.
- [x] Hacer observable el resultado de `recordCooking`; el componente solo muestra éxito/cierra al
      confirmarse y muestra error recuperable en el fallo, liberando el bloqueo de envío en ambos casos.
- [x] Probar el servicio/componente con éxito, error, retry y repetición durante loading; mantener
      cobertura focal ≥70 % en statements/branches/functions/lines sin bajar ningún gate existente.
- [x] Ejecutar Playwright real con Chromium y Pixel 5, DB/puertos/semilla aislados; revisar error de
      página, persistencia tras volver/recargar, foco/estado disabled, ancho mínimo 320 y captura
      sintética comparable de PC/móvil. No llamar al proveedor IA.
- [x] Registrar comando/resultados, límites y rollback por archivos; conservar abierta la casilla
      general `/recipes` hasta cubrir las demás acciones del listado.

**Evidencia QA-RECIPES.COOK-ACTION.1 (2026-10-09):** la E2E nueva falló primero contra la
implementación original: al resolver el POST con 503, el detalle ya se había cerrado como éxito. Se
cambió el servicio para devolver resultado observable y solo incrementar el estado local con
`success: true`; el componente bloquea repeticiones de la misma receta, silencia el toast HTTP genérico,
confirma/cierra tras respuesta válida y, en error, mantiene el detalle, muestra mensaje ES/EN y permite
retry. No cambia el endpoint ni el esquema de datos.

`pnpm run test` pasó **1225/1225** unitarias frontend (coverage global **90.83/81.94/89.42/92.27 %
S/B/F/L**) y **1234** backend con un skip existente. Cobertura de los ficheros cambiados:
`recipe.service.ts` **90.19/79.06/92.45/91.59 %** y `recipes.component.ts`
**94.55/89.14/92.30/95.15 % S/B/F/L**. La build de producción, `typecheck:e2e`, `check:ui`
(211 ficheros/21 reglas), Prettier y `git diff --check` pasan; la build conserva el warning de
presupuesto de estilos inline ya existente, sin modificar el gate.

Con `E2E_RATE_LIMIT=on`, la matriz aislada de recetas pasó **26/26** en Chromium y Pixel 5; la E2E
focal `recipe-cook-action.spec.ts` pasó **2/2** con SQLite/puertos/semilla temporales. Retiene el primer
POST mientras el botón queda desactivado y solo existe una petición, devuelve 503, verifica estado/contador/foco y error único, reintenta
contra el API aislado, comprueba una sola persistencia tras volver al listado y recargar, y no produce
errores de página ni llamadas IA. Viewports: 1440×900 y Pixel 5 a 320×740. Capturas sintéticas
inspeccionadas: `.e2e-screenshots/qa-recipe-cook-action-20261009-final/chromium-recipe-cook-error.png`
y `mobile-chrome-recipe-cook-error.png`; se confirma toast claro, ficha retenida, control enfocado y
sin overflow. El flujo solo usa API local aislada y fotos sintéticas interceptadas.

**Rollback:** revertir únicamente los cambios de `frontend/src/app/core/services/recipe.service.ts`,
`frontend/src/app/core/services/recipe.service.spec.ts`,
`frontend/src/app/features/recipes/recipes.component.ts`,
`frontend/src/app/features/recipes/recipes.component.spec.ts`,
`frontend/src/app/core/i18n/dict/recipes.ts`, `tests/e2e/recipe-cook-action.spec.ts` y este bloque.
La cobertura general de `/recipes` permanece abierta por sus otras acciones/filtros.

### QA-RECIPES.QUICK-FILTERS.1 · verificar resultados y persistencia de filtros rápidos

**Fuente revalidada (2026-10-09):** `recipes.component.ts` presenta `Todas`, `Favoritas`, `Rápidas`
y `IA`; `setFilter()` mapea favoritas a `isFavorite=true`, rápidas a `maxTime=30` e IA a
`author=ai`. `GET /api/recipes` ya filtra esos campos, pero `recipes.spec.ts` solo verifica las
etiquetas/estado seleccionado y una pulsación de Favoritas, no la pertenencia de las recetas a cada
resultado. Además, `saveGeneratedRecipe()` no envía el origen IA y el `POST /api/recipes` guarda siempre
`author='user'`, por lo que una receta recién generada no coincide con el filtro `author=ai`. HOGARIA
§12au garantiza que las recetas generadas sigan perteneciendo al usuario, pero no define esa
clasificación.

**Decisión de prueba (inferencia explícita):** el filtro `IA` debe mostrar las recetas generadas por IA
guardadas por el hogar/usuario actual; la marca `author='ai'` clasifica el origen, mientras
`author_id` mantiene propiedad y edición personales. `Rápidas` significa duración total ≤30 minutos;
`Favoritas` usa el estado individual del usuario; `Todas` elimina únicamente esos filtros rápidos y
conserva búsqueda/libro. La URL, navegación atrás/adelante y recarga reflejan la pestaña activa. El
cliente no puede asignar el autor editorial `catalog`.

- [x] Añadir primero una E2E roja con usuario/DB aislados y proveedor IA sintético: guardar una receta
      manual rápida, otra manual >30 min y otra generada; demostrar miembros exactos de Todas,
      Favoritas, Rápidas e IA, sin filtraciones ni duplicados.
- [x] Persistir el origen IA de las recetas generadas sin perder `author_id`, favoritos, permisos de
      edición ni contratos de recipes manuales; mantener `catalog` solo en contenido editorial.
- [x] Cubrir API/servicio/componente con generación, persistencia y filtros combinados; ≥70 % S/B/F/L
      en cada fichero instrumentable y no rebajar gates.
- [x] Verificar pestañas, resultado real, URL, atrás/adelante y recarga en Chromium desktop y Pixel 5;
      comprobar estado vacío/error, viewport mínimo 320, cero overflow y cero llamadas IA real.
- [x] Registrar prueba roja/verde, cleanup, coverage y rollback por archivo; mantener abierta `/recipes`
      hasta cubrir las otras acciones listadas.

**TDD rojo (2026-10-09):** la E2E aislada falló al esperar `author=ai` (recibía `user`). Las dos
pruebas de API fallaron: el POST guardaba siempre `user` y el filtro IA devolvía vacío. La E2E
reprodujo además que, ante 503 del filtro, faltaban un error accesible y reintento y la UI conservaba
resultados sin indicar que podían estar desactualizados.

**Implementación/evidencia verde (2026-10-09):** el POST acepta solo origen `ai`/`user` y mantiene
`author_id` ligado a la persona autenticada; los manuales siguen por defecto como `user`, `catalog`
no se acepta desde el cliente, y favoritos/edición/privacidad de una receta IA siguen personales.
La lista conserva los resultados anteriores si falla la carga, muestra un aviso accesible de posible
desactualización (sin toast duplicado ni falso estado vacío) y permite reintentar el mismo filtro.
API focal `pnpm --filter @hogaria/server exec vitest run src/routes/recipes.routes.spec.ts
--reporter=dot`: 20/20; servicio Karma focal 20/20; componente Karma focal 14/14; Playwright aislado
con SQLite/puerto/usuario únicos, `E2E_RATE_LIMIT=on`, proveedor sintético local y cleanup: 2/2
(Chromium 1440×900, Pixel 5 393×851; error/overflow también a 320×568 y 568×320). La E2E verifica
miembros exactos de las cuatro pestañas, búsqueda preservada, query string, atrás/adelante/recarga,
estado vacío, 503 y reintento. No se llama a IA real. `pnpm run typecheck:e2e` pasa. Capturas
sintéticas inspeccionadas en `.e2e-screenshots/qa-recipe-quick-filters-20261009-final/`
(`chromium-…1440x900`, `mobile-chrome-…393x851`, `…320x568` y `…568x320`, resultado IA y error).
Coverage Karma focal por fichero: `recipe.service.ts` 90.68/79.06/92.59/92.18 % S/B/F/L y
`recipes.component.ts` 94.55/89.14/92.30/95.15 %; ambos superan 70 % en las cuatro métricas.
El comando focal con solo esos dos specs ejecuta los 34 tests, pero retorna código 1 porque el
gate global existente evalúa también todo el código de la aplicación (29.55/21.88/23.57/30.04 %
S/B/F/L); no se cambió el gate. La suite completa `pnpm run test` pasa con 1229/1229 Karma y
91.08/82.10/89.69/92.52 % S/B/F/L global. Server focal `recipes.routes.ts` 87.69/77.50/93.93/89.07 % S/B/F/L y
schema 100 %; suite completa de server: 1236 tests, 1 skipped. E2E amplia de recetas: 58/58 en
Chromium y Pixel 5.
`pnpm run build` (server TypeScript + producción Angular), `pnpm run typecheck:e2e`,
`pnpm run check:ui`, Prettier focal y `git diff --check` pasan. Build conserva los warnings
preexistentes de budgets y componentes/imports no usados; no se rebajó ninguna regla.

La ejecución de CI de PR #41 `37885783378` en `b5729fe` queda verde: 4/4 shards E2E, E2E
full-stack, build de producción, typecheck y server tests pasan. El workflow CI no ejecuta Karma
completo: valida su cableado; el pre-push local ejecutó el gate completo **1229/1229**, incluido el
renderer del gráfico.

**Rollback:** revertir solo `server/src/schemas/recipe.schema.ts`,
`server/src/routes/recipes.routes.ts`, `server/src/routes/recipes.routes.spec.ts`,
`frontend/src/app/features/recipes/recipes.component.ts`,
`frontend/src/app/features/recipes/recipes.component.spec.ts`,
`frontend/src/app/core/services/recipe.service.ts`, `frontend/src/app/core/services/recipe.service.spec.ts`,
`frontend/src/app/core/i18n/dict/recipes.ts`, `tests/e2e/recipes-ai-generation.spec.ts`,
`tests/e2e/helpers/recipe-fixtures.ts` y este bloque; conservar los filtros vigentes y la propiedad
personal de recetas.

### QA-RECIPES.BOOK-FILTER-MODAL.1 · filtros avanzados del libro

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md §12au` exige filtros combinables del catálogo,
estado coherente con URL/resultados y controles traducidos y accesibles por teclado. La vista vigente
`RecipesComponent` ya incluye país, tipo de comida, dificultad, cocina, etiquetas y tiempo máximo; al
abrir copia filtros aplicados en borradores, `Aplicar` navega con esos parámetros y `app-modal` cierra
con Escape. El E2E existente solo combina búsqueda, país y comida; no verifica los otros filtros ni que
Cancelar/Escape descarten cambios no aplicados.

**Decisión explícita para el borrador:** los filtros solo afectan los resultados y URL al confirmar
«Aplicar filtros». Cancelar, Escape o cerrar sin aplicar descarta todos los cambios; al reabrir, el
diálogo refleja los filtros persistidos. Esto evita resultados/URL adelantados a la decisión del usuario.

**TDD rojo (2026-10-09):** la nueva E2E falló primero en Chromium y Pixel 5 al medir el campo «Cocina»
en **35 CSS px** (objetivo táctil mínimo 44 px); país/comida/dificultad ya superan ese umbral. La prueba
usa la SQLite y puertos únicos del runner aislado, con las recetas del catálogo local.

- [x] Añadir E2E aislada antes de tocar producción: combinar los seis campos sobre el catálogo editorial
      sembrado en SQLite temporal, demostrar miembro exacto, URL y recarga; verificar Cancelar/Escape.
- [x] Verificar etiquetas/nombres accesibles, operación por teclado, foco y controles táctiles ≥44 px en
      Chromium desktop y Pixel 5; sin overflow a 320×568 ni 393×851.
- [x] Capturar e inspeccionar resultados de escritorio/móvil en aislamiento; confirmar que no se hacen
      llamadas a IA ni escrituras fuera de SQLite/puertos temporales.
- [x] Si las regresiones descubren defectos, escribir primero la prueba roja y aplicar el cambio mínimo;
      medir cobertura S/B/F/L por fichero ≥70 % y mantener intactos los gates. Si el código actual pasa,
      no cambiar producción solo para justificar una implementación. En esta unidad solo cambia CSS
      (no instrumentable); no se modifica TypeScript de producción.
- [x] Anotar comandos/resultados, rollback/límites; esta subunidad cierra la brecha concreta del modal
      de filtros avanzados. El E2E 2/2 está publicado (`61f5d61`) y CI `37928201856` validó el SHA
      `7c887fb`; la auditoría general `/recipes` sigue abierta por las demás acciones.

**Evidencia QA-RECIPES.BOOK-FILTER-MODAL.1 (2026-10-09):** prueba roja inicial en Chromium y Pixel 5:
el campo «Cocina» medía 35 px. `frontend/src/styles.scss` limita la corrección al formulario de filtros
del libro, con `box-sizing: border-box` y `min-height: 44px`. La E2E usa el runner aislado
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
--forbid-only tests/e2e/recipe-book-filter-modal.spec.ts --reporter=line`: **2/2** (Chromium 1440×900,
Pixel 5 393×852; además 320×568), sin overflow horizontal ni errores de página o llamadas `/api/ai/`.
Confirma seis filtros y resultado único Paella valenciana, URL/recarga, selección de país con teclado,
focus restore y descarte de cambios por Cancelar/Escape; todos los campos/acciones ≥44 px. `pnpm run
typecheck:e2e` y `pnpm run check:ui` (**212 archivos, 21 reglas**) pasan. Coverage de código no aplica
al ajuste CSS ni al spec de Playwright. Capturas de la prueba aislada, revisadas:
`.e2e-screenshots/qa-recipe-book-filter-modal-20261009/chromium-filtered-book.png` y
`.e2e-screenshots/qa-recipe-book-filter-modal-20261009/mobile-chrome-filtered-book.png`. Rollback:
revertir este bloque, `frontend/src/styles.scss` y `tests/e2e/recipe-book-filter-modal.spec.ts`.

## QA-AUTH.FORGOT.1 · resultado honesto y no enumeración en recuperación (spec-first)

**Fuente revalidada (2026-10-01):** `POST /api/auth/forgot-password` valida formato en API y responde 200 indistinguible para cuenta existente/inexistente, pero solo consulta la cuenta; no hay servicio/configuración de email ni generación de enlaces en el repo. La pantalla, su CTA y la respuesta API afirman falsamente que se envió un enlace. `ForgotPasswordComponent.onSubmit()` valida vacío pero no formato; el input es un `ControlValueAccessor` y el `ngSubmit` permite enviar `type=email` inválido. Playwright aislado reprodujo que `not-an-email` hace POST/400. La solicitud tampoco tiene contexto `SILENT_TOAST`, por lo que un error 5xx genera el toast global genérico además del mensaje local; actualmente la rama `error` también llama `toastService.success()`. El mismo E2E midió un CTA de 42 px, por debajo del objetivo táctil de 44 px. Mantener no enumeración, copy honesto en formulario/CTA/API/aviso de que recuperación por correo aún no está disponible, validación local de email y error contextual recuperable sin duplicar toast; botón accesible ≥44 px. El endpoint se aislará en un módulo pequeño para aplicar el gate de cobertura por fichero sin cambiar los gates; no se implementa proveedor de correo sin credenciales/decisión de producto.

- [x] Test de integración backend: cuentas existentes/inexistentes reciben el mismo status y mensaje genérico sin afirmar envío ni consultar existencia; email inválido rechaza.
- [x] Test unitario de respuesta/error: aviso informativo honesto ES/EN; fallo no emite éxito; loading se limpia, email se conserva, hay retry y guard contra doble envío; AuthService silencia el toast global.
- [x] Playwright real aislado: vacío/formato inválido no envían; existente/desconocida reciben el mismo status/cuerpo/aviso; 503 muestra solo error contextual y luego permite retry real.
- [x] Chromium y Pixel 5: labels/teclado, CTA ≥44 px, no-overflow a 1440×900 y 393×851, estados de carga/error; cobertura focal supera 70 % en las cuatro métricas; capturas PC/móvil inspeccionadas.
- [x] Limitación de producto comunicada: actualmente no hay entrega de correo ni generación de token de recuperación.

**TDD rojo (2026-10-01):** el contrato inicial esperaba “link sent” y el test backend falló con el texto engañoso vigente. Playwright aislado mostró que email vacío/malformado podía hacer POST, que 503 generaba toast global genérico junto al falso success local, y que el CTA solo medía 42 px. Karma reprodujo falso éxito en `error`, doble envío y copy ES/EN ausente.

**Evidencia verde QA-AUTH.FORGOT.1 (revalidada 2026-10-02):** `node ./node_modules/vitest/vitest.mjs run src/routes/auth-forgot-password.spec.ts --coverage --coverage.include=src/routes/forgot-password.routes.ts` (`server`): **2/2**, handler **100/100/100/100 % S/B/F/L** (branches 0/0); existing/unknown remain identical 200/static body without DB lookup/email, malformed email is 400. `server`: `node ./node_modules/typescript/bin/tsc -p tsconfig.json` passed. Prior full `npm run test:coverage -- --exclude=src/utils/uploads.spec.ts` passed **43 archivos/893 tests**, global **93.55/85.38/94.98/96.41**; the unexcluded POSIX-only suite has three Windows permission/path failures, without gate changes.

Frontend: Karma focal `forgot-password.component.spec.ts` + `auth.service.spec.ts`: **34/34**; coverage focal `ForgotPasswordComponent` **100/100/100/100** y `AuthService` **96/81.82/91.89/96**. El reporte focal agregado (**51.27/16.73/43.75/54.69**) es inferior al gate global porque selecciona solo estos specs; el threshold 80 % no se cambió en el repo y la cobertura global continúa abierta en QA-04c. `ng build --configuration production` compila; conserva warnings de budgets/imports no usados ajenos a esta unidad.

Playwright real revalidado con `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-forgot-password.spec.ts`, `E2E_RATE_LIMIT=on`: **4/4**. El runner exigió `DATABASE_PATH` exactamente en la SQLite aislada bajo `%TEMP%\hogaria-e2e-*`, con seed sintética y puertos efímeros, y limpió sus recursos. Comprueba vacío/malformado sin POST, respuesta igual para ambas cuentas, retry tras 503, un solo error accesible, orden de tab, target 44 px y no-overflow a 1440×900 / 393×851. Typecheck E2E también pasó. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-auth-forgot-password-qa-hogaria-e2e-JSRHAJ/error-chromium-1440x900.png` y `error-mobile-chrome-393x851.png`. No se usó `localhost:4200`, correo externo ni proveedor IA/LAN.

## QA-AUTH.INVITE.ACTIONS.1 · aceptar, rechazar y recuperar una invitación

**Fuente revalidada (2026-10-02):** `InviteComponent` consulta `GET /api/household/invite/:code`, ofrece aceptación/rechazo a personas autenticadas y conserva el código en los enlaces de login/registro. `accept()` llama a `HouseholdService.joinByCode()` y navega a `/household`; `decline()` vuelve a `/`. El endpoint de preview solo distingue código existente/inexistente y `alreadyMember`; `households` no tiene campo de expiración, así que un código anterior a regenerar es inválido pero no existe un estado de expiración por tiempo. `auth-onboarding-icons.spec.ts` cubre código inválido, miembro actual y CTA de registro; `household-action-ack.spec.ts` cubre unión directa desde Hogar, no aceptación/rechazo en la pantalla pública de invitación. `joinByCode()` también lo usan login/registro, donde sí se espera el toast común; una opción silenciosa debe ser específica a la página de invitación, que presenta feedback propio.

- [x] Añadir primero E2E real aislada para persona autenticada sin hogar: preview válido → aceptar → un único `POST /api/household/join/:code` → destino `/household` con membresía confirmada; usar owner/guest sintéticos. `invite-actions.spec.ts` confirma un solo POST por intento y persiste dos miembros tras recargar.
- [x] Rechazar/cancelar una invitación no envía el POST de unión, no crea membresía y navega al destino definido por `decline()`; validar con API y estado visible.
- [x] Simular fallo de red/5xx al aceptar: conservar URL/código, mostrar un `role="alert"` visible dentro de la propia página (el shell público no monta `app-toast`), silenciar el toast global solo para esta llamada, limpiar loading y permitir reintentar; mientras está pendiente, teclado/click no deben duplicar el POST.
- [x] Probar código inexistente y código invalidado por regeneración, además de la rama de miembro actual; no inventar expiración temporal mientras API/modelo no la definan.
- [x] Verificar en ES/EN y Chromium + Pixel 5: código preservado tanto en login como en registro, navegación directa, nombres accesibles y uso con teclado, controles táctiles ≥44 px y no-overflow a 320×568, 393×851, 568×320 y 1440×900; el E2E de iconos comprueba además que no haya errores de consola de primera parte.
- [x] Si hace falta cambio de producción, escribir primero regresión unitaria, cubrir casos de error/reintento y mantener ≥70 % S/B/F/L en el fichero tocado sin rebajar gates; inspeccionar capturas PC/móvil cuando cambie la UI.

**TDD rojo (2026-10-02):** `tests/e2e/invite-actions.spec.ts` con `node scripts/run-isolated-playwright.mjs`, Chromium + Pixel 5, rate limit activo y SQLite/semillas/puertos únicos bajo `%TEMP%`: el rechazo y la invalidación del código regenerado pasan (**4/4**). En aceptación, una respuesta simulada 503 deja **cero** `.toast--error` visibles en ambos proyectos: `AppComponent` solo monta `router-outlet` y `app-toast` vive en `MainLayoutComponent`, que la ruta pública no usa; `InviteComponent.accept()` no presenta error inline. La medición real inicial en Chromium/Pixel 5 registró botones de login/registro de **32 px** a 320 px CSS frente al mínimo de 44 px; el CTA usa `app-button` sin `[touchTarget]`. Una primera aserción de enlaces de invitado se ejecutó por error después de registrar/loguear el usuario; corregí el fixture y la regresión ya recorre correctamente tanto el estado público como el autenticado. No se tocó `localhost:4200` ni proveedor externo.

**TDD rojo adicional (2026-10-02):** la prueba `household.service.spec.ts` aislada en Karma ejecutó 14 casos y falló solo la nueva aserción de `SILENT_TOAST`: `joinByCode('INVITE123', {silentToast:true})` aún dejaba el contexto en `false` (**13/14**). Se conserva `false` por defecto para no ocultar errores de los flujos de login/registro.

**Evidencia verde (2026-10-02):** pruebas unitarias focales de `invite.component.spec.ts` + `household.service.spec.ts`: **23/23**. Coverage focal del componente: **95.74/85.71/90.00/95.74 % S/B/F/L**; del servicio: **100/96.88/100/100 %**. La ejecución parcial de Karma muestra aggregate bajo (38.48/17.17/37.73/40.45 %) por incluir solo estos specs; no representa el gate global y no se bajó el umbral configurado. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/invite-actions.spec.ts tests/e2e/auth-onboarding-icons.spec.ts`, con rate limit activo: **12/12**. Incluye aceptar/reintentar/rechazar, enlace invalidado, estado de miembro actual, ES/EN, persistencia, teclado, cuatro tamaños y CTAs táctiles; el runner aisló y limpió SQLite, puertos y artefactos de servidor bajo `%TEMP%`. Typecheck E2E y build de producción correctos; build conserva avisos de presupuesto de bundle/imports no usados ajenos a esta unidad. Prettier y `git diff --check` correctos. No se usó `localhost:4200`, DB normal ni proveedor IA/LAN.

Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-invite-actions/invite-preview-desktop.png`, `invite-preview-mobile.png`, `invite-accept-error-desktop.png` e `invite-accept-error-mobile.png`.

Rollback de la unidad: revertir el commit atómico de `QA-AUTH.INVITE.ACTIONS.1`; no cambia datos ni migraciones.

## QA-PREFERENCES.CUSTOM-LIMIT.1 · opciones personalizadas y contrato de guardado (implementada)

**Fuente revalidada antes de implementar (2026-10-01):** `ChipSelectComponent` se comparte entre Preferencias y onboarding. El cliente recorta el texto y evita duplicados sin distinguir mayúsculas, pero no limita el largo ni el número de opciones seleccionadas. El contrato vigente del servidor, `stringList` en `server/src/utils/taste-profile.ts`, exige entre 1 y 60 caracteres tras `trim()` y como máximo 60 valores por lista (`allergies`, `likes`, `dislikes`); `PATCH /api/auth/taste` devuelve rechazo de validación fuera de esos límites. Una opción personalizada demasiado larga o una lista de más de 60 se puede añadir en pantalla y volver imposible guardar junto con el resto de los cambios. Las alergias persistidas se incorporan como exclusiones estrictas en el prompt de IA (`tastePromptLines`), así que no se debe truncar, normalizar destructivamente ni ocultar el rechazo.

**Conducta esperada (alineación con el contrato API actual):** Preferencias y onboarding deben prevenir antes de guardar valores que el API rechazará: valor personalizado con `trim().length` de 1–60 y hasta 60 opciones por lista, contando las predefinidas seleccionadas. Límite, motivo y errores tienen nombre accesible y copy ES/EN; no se emite una opción inválida, no se descarta silenciosamente el texto ingresado y 60/60 son válidos. El API conserva la validación como defensa en profundidad.

- [x] Añadir primero una E2E aislada de Preferencias en Chromium y Pixel 5: aceptar alergia custom de 60 caracteres, guardar, recargar y confirmar persistencia; reproducir en rojo que una de 61 se añadía en cliente, aunque el API la rechazaría. La regresión verde conserva el input, muestra error accesible y no añade el valor inválido. Se usaron cuentas/SQLite sintéticas; la selección válida persiste sin que el texto inválido contamine el guardado.
- [x] Cubrir límite 1/60, 61, entrada en blanco/sólo espacios, duplicado case-insensitive y lista 60/61 en pruebas de `ChipSelectComponent`; probar el toggle de opciones prefijadas y el alta personalizada al llegar al límite. TDD reprodujo primero ambos fallos de límite en Karma y Chromium/Pixel 5.
- [x] Alinear el control compartido y mensajes accesibles ES/EN a `trim().length <= 60` y máximo 60 valores sin truncado silencioso; la suite real prueba alergias de Preferencias, alergias y ambos campos de gustos en onboarding. El control mantiene guardar, recargar, quitar y descartar; los emojis aprobados de alergias permanecen intactos.
- [x] Validar `/api/auth/taste` en 60/61 caracteres y 60/61 valores; la validación del servidor permanece como defensa en profundidad. El entorno aislado de Playwright solo usa su API/SQLite temporal, sin `localhost:4200`, DB normal ni proveedor IA/LAN.
- [x] Capturar e inspeccionar escritorio y móvil en Preferencias con el error visible; ejecutar Karma focal, build de producción y coverage del componente ≥70 % en statements/branches/functions/lines sin reducir los gates globales.

**TDD rojo (2026-10-01):** la prueba unitaria de `ChipSelectComponent` falló en ambos límites: aceptó 61 caracteres y el toggle produjo 61 selecciones. La E2E aislada `tests/e2e/preferences-custom-limits.spec.ts` también reprodujo en Chromium y Pixel 5 que el texto de 61 caracteres se convertía en chip (2 fallos, 1 por proyecto); no se escribió en el servidor normal.

**Evidencia verde QA-PREFERENCES.CUSTOM-LIMIT.1 (2026-10-01):** Karma focal `chip-select.component.spec.ts`: **8/8**. Coverage focal calculada para `ChipSelectComponent`: **97.22/84.00/95.45/96.97 % S/B/F/L**. `node ./node_modules/vitest/vitest.mjs run src/routes/auth.routes.spec.ts` (desde `server`): **14/14**, con base `:memory:`. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/preferences-custom-limits.spec.ts`, rate limit activo: **4/4**; persiste 60 caracteres recortados, rechaza 61 en ES/EN, confirma alergias/gustos en onboarding, guardar/recargar/quitar/descartar y comprobación de overflow en 1440, 1025/1024/1023, 601/600/599, 390, 320 y landscape 568×320. El runner limpió SQLite/puertos/artefactos temporales. `npm run build:prod`: correcto; quedan warnings preexistentes de presupuesto de bundle y componentes/imports ajenos a esta unidad.

Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-preferences-custom-limits-green/preferences-custom-limit-desktop-error.png`, `preferences-custom-limit-mobile-error.png`, `preferences-allergies-desktop-1440x900.png` y `preferences-allergies-mobile-390x844.png`. Suite frontend completa: **751/751**; el comando acaba con código 1 por el threshold global existente de 80 % (actual **73.93/64.35/72.19/75.68 % S/B/F/L**). El test focal también reporta aggregate bajo porque carga otros componentes compartidos, sin modificar ningún gate; el coverage del componente sí supera 70 % en las cuatro métricas. No marcar el gate global como cerrado.

Rollback de la unidad: revertir el commit atómico QA-PREFERENCES.CUSTOM-LIMIT.1; no cambia datos ni migraciones.

## QA-PREFERENCES.WIDTH.1 · aprovechar el ancho disponible en escritorio (implementada)

**Fuente revalidada antes de implementar (2026-10-02):** `MainLayoutComponent` reserva 280 px para la navegación en escritorio y no limita el ancho del `<main>`. `PreferencesComponent` centra `.preferences-page` con `max-width: 760px`, aunque la captura del usuario muestra un viewport de 1920 px; la tira `.preferences__tabs` usa `overflow-x: auto`, por lo que incluso las pestañas de escritorio generan scroll horizontal y la sección queda demasiado estrecha. Los breakpoints responsive existentes son 1024 px en el layout principal y 600 px en Preferencias. La conducta esperada es ocupar una porción sustancial del espacio libre en web sin eliminar márgenes/padding, manteniendo el contenido textual legible y el desplazamiento táctil de pestañas donde realmente haga falta en móvil.

- [x] Añadir primero E2E de regresión: en escritorio ≥1280 px, Preferencias debe ocupar más de 900 px y todas sus pestañas deben quedar visibles sin scroll horizontal; reproducir antes que el ancho queda limitado a ~760 px y hay pestañas recortadas.
- [x] Ampliar el contenedor de Preferencias en escritorio con padding/gutters modestos y conservando medidas legibles para párrafos; no ensanchar artificialmente otros módulos sin una fuente/criterio equivalente.
- [x] Verificar con Playwright Chromium a 1920×1080 y 1280×800, incluyendo la navegación/selección de todas las pestañas, foco de teclado, controles, contenido y ausencia de overflow global.
- [x] Verificar Pixel 5 a 393×851, 320×568 y 568×320: mantener padding lateral, scroll de tabs accesible por tacto/teclado si no caben, pestaña final alcanzable y sin overflow horizontal del documento.
- [x] Capturar e inspeccionar Preferencias en PC y móvil; ejecutar E2E real, typecheck, build y formato. El cambio solo ajusta CSS, sin lógica JS cubierta; no hay prueba unitaria/cobertura focal aplicable al layout.

**TDD rojo (2026-10-02):** la nueva `tests/e2e/preferences-width.spec.ts` reprodujo el defecto en Playwright real con base temporal: en Chromium a 1920 px el contenedor medía **760 px** y falló el mínimo de 900 px; la matriz móvil pasó. La corrida aislada usó `E2E_RATE_LIMIT=on`, SQLite/puertos/semilla propios y cleanup del runner.

**Evidencia verde QA-PREFERENCES.WIDTH.1 (2026-10-02):** el contenedor pasa a `max-width: 1360px`, conservando padding de 16 px y el límite tipográfico de 52ch del subtítulo. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/preferences-width.spec.ts` con Chrome local y rate limit activo: **2/2** (Chromium escritorio y Pixel 5; dos skips son los proyectos que no aplican a cada test). Escritorio **1920×1080 y 1280×800**: ancho >900 px, las cinco pestañas visibles sin scrollbar, selección y Enter por teclado, sin overflow global. Pixel 5 **393×851, 320×568 y 568×320**: gutter presente, objetivo accesible por toque mediante scroll interno de tabs y documento sin overflow. El runner confirma cleanup de DB/proceso/artefactos temporales. `tsc -p tsconfig.e2e.json --noEmit`, Prettier focal y `git diff --check` pasan. `npm run build:prod` pasa; solo reporta warnings preexistentes de bundle/estilos y dependencias/imports no usados, fuera de esta unidad.

Capturas sintéticas inspeccionadas: `.e2e-screenshots/preferences-width-qa/preferences-desktop-1920x1080.png` y `.e2e-screenshots/preferences-width-qa/preferences-mobile-393x851.png`. Rollback de la unidad: revertir el commit atómico `fix(preferences): use desktop content width`; no cambia lógica ni datos.

## Checklist funcional por pantalla

En cada flujo probar: camino válido, validación/límites, doble envío, carga, fallo de red/servidor, recuperación/reintento, cancelar/volver, recarga/persistencia, teclado, nombres largos y confirmación antes de borrar o perder cambios.

### Acceso y primer uso

- [x] `/auth/login`: correo/contraseña válidos e inválidos, campos vacíos, revelar/ocultar contraseña, loading, error genérico y redirección correcta.

**Evidencia QA-AUTH.LOGIN.1 (2026-10-03):** la E2E aislada `pnpm run test:e2e -- --project=chromium --project=mobile-chrome tests/e2e/auth.spec.ts` pasa **20/20** con SQLite/puertos/semillas temporales; cubre credenciales válidas e inválidas, campos vacíos, revelar/ocultar, loading, 503 recuperable y redirección. La primera corrida detectó dos toasts idénticos ante 503: el interceptor global y el formulario notificaban a la vez. `AuthService.login()` ahora marca `SILENT_TOAST` para que el formulario gestione ese error una sola vez. `AuthService` focal pasa **26/26** con **96/81.81/91.89/97.89 %** statements/branches/functions/lines en reporte temporal; typecheck E2E, formato y `git diff --check` pasan. Las rutas de registro, invitación y onboarding continúan abiertas; recuperación se cerró con la evidencia del 2026-10-08.

- [x] `/auth/register`: requerido/formato, política de contraseña y límites, correo duplicado, error del servidor, registro normal y retorno con `?code=` de invitación.

**Revalidación integral de `/auth/register` (2026-10-08):** E2E aislada full-stack `register-contract.spec.ts` + `register-invite.spec.ts`: **14/14** en Chromium y Pixel 5; `auth-flow.spec.ts` + el caso de registro de `auth-password-byte-limit.spec.ts`: **4/4**; `login-double-submit.spec.ts` full-stack confirma que login conserva el código y une una sola vez: **2/2**. La evidencia cubre campos requeridos/formato, política y límites UTF-8, conflicto, error 500 recuperable y retry, registro normal, preservación del código y persistencia de la unión. Todos los runs usaron rate limit activo y runner aislado (SQLite/puertos/semillas temporales); se confirmó cleanup. Sin cuentas reales ni proveedor IA.

- [x] `/auth/forgot-password`: correo vacío/mal formado/válido, respuesta que no revela si existe la cuenta, loading y error recuperable.

**Revalidación funcional (2026-10-08):** Vitest `pnpm --filter @hogaria/server exec vitest run src/routes/auth-forgot-password.spec.ts --coverage --coverage.include=src/routes/forgot-password.routes.ts`: **2/2**, ruta **100/100/100/100 % S/B/F/L**; Chromium Headless focal (`forgot-password.component.spec.ts` + `auth.service.spec.ts`): **34/34**; Playwright aislado `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-forgot-password.spec.ts`, `E2E_RATE_LIMIT=on`: **4/4**. Verificado: vacío/malformado sin POST, mismo 200/cuerpo para cuenta conocida y desconocida, aviso honesto, 503 no duplica toast, carga deshabilita CTA y el retry conserva email. El runner aisló SQLite/puertos/semilla y confirmó cleanup; los viewports fueron 1440×900 y 393×851. No se implementa envío de correo porque el servicio sigue sin estar disponible.

- [x] `/invite/:code`: código válido, inválido o invalidado al regenerar (sin expiración temporal en el modelo actual), invitación repetida, ya pertenece al hogar, aceptar/rechazar con sesión y entrada por registro/login preservando el código.

**Revalidación integral de `/invite/:code` (2026-10-08):** Playwright aislado `invite-actions.spec.ts` + `auth-onboarding-icons.spec.ts`: **12/12** en Chromium y Pixel 5; cubre aceptación con retry tras 503, rechazo sin unión, código invalidado al regenerar, estado ya-miembro y enlaces ES/EN, teclado, CTA táctiles ≥44 px y 320×568 / 393×851 / 568×320 / 1440×900. `household.routes.spec.ts` (SQLite `:memory:`): **25/25**, incluida membresía duplicada 409 sin escrituras. `login-double-submit.spec.ts` full-stack: **2/2**; `register-invite.spec.ts` full-stack: **2/2**, preservan código y unen una sola vez. Runs E2E con rate limit y runner aislado; cleanup confirmado. Sin datos reales ni proveedor IA.

- [x] `/onboarding`: validar los seis pasos de §12C/§12E; Pantry conserva la edición de utensilios y `kitchen` solo enlaza según §8c. Probar perfil, alergias/gustos/objetivos, horario, siguiente/anterior, omitir, persistencia, salida, recarga y reanudación.

**Revalidación integral de `/onboarding` (2026-10-08):** Playwright real aislado `onboarding.spec.ts` + `onboarding-pantry-parity.spec.ts`: **14/14** en Chromium y Pixel 5; recorre los seis pasos y valida perfil, alergias (predefinidas y manuales), gustos, objetivos, horarios, saltar un paso o el tour, Atrás, progreso guardado al salir a Pantry, reentrada, finalización, Preferencias y persistencia tras recargar. La subunidad `QA-ONBOARDING.PANTRY-LINK.1` confirma que `kitchen` solo enlaza a Pantry y que solo allí se edita disponibilidad, también en EN y en 320×568, 393×851, 559/560/561, 568×320 y 1440×900. Comando PowerShell: `$env:E2E_RATE_LIMIT='on'; $env:E2E_CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/onboarding.spec.ts tests/e2e/onboarding-pantry-parity.spec.ts`; resultado **14 passed (32.8 s)**, con SQLite/puertos/semillas temporales y cleanup confirmado. El pre-push del mismo source pasó suite Karma **1168/1168**, cobertura global **90.21/81.39/88.98/91.57 % S/B/F/L**, build y typecheck; no se cambió UI y permanecen las capturas PC/móvil sintéticas inspeccionadas en `QA-ONBOARDING.PANTRY-LINK.1`.

### Navegación y superficies de hogar

- [x] Shell autenticado: redirección de ruta privada sin sesión; menú lateral, overlay, botón cerrar, Escape, bottom-nav, sidebar de escritorio, cuenta/avatar, cerrar sesión y cola de tickets; verificar ruta directa y atrás/adelante.

**Revalidación integral del shell autenticado (2026-10-08):** `auth.spec.ts`, `main-layout-drawer.spec.ts`, `account.spec.ts` y `receipt-queue-panel-layout.spec.ts`: **40/40** en Chromium y Pixel 5 con rate limit activo; cubren guard privado, drawer/overlay/Escape/foco, bottom-nav/sidebar, perfil/avatar/logout y cola vacía/scroll. `main-layout-drawer.spec.ts` añade una E2E de bottom-nav/sidebar con rutas directas y `goBack`/`goForward`; pasa **2/2** en escritorio y móvil. `route-baseline.spec.ts`, separado con `E2E_RATE_LIMIT=off` por su barrido de alto volumen: **2/2**, 28 rutas y 140 mediciones por proyecto en 320×568, 393×851, 768×1024, 1024×768 y 1440×900; cero errores de página/consola/origen, navegación, componentes ausentes, respuestas HTTP no-2xx inesperadas u overflow. En un primer intento lo mezclé con el rate limit activo y el recorrido agotó el cupo; el guard de `/ai-config` redirigió tras recibir 429. Repetido con el perfil aislado documentado, pasó sin cambios de producto. SQLite/puertos/semillas temporales y cleanup confirmados. No se cambió UI; las capturas sintéticas PC/móvil previas del drawer/cuenta siguen inspeccionadas.

### QA-SHELL.DRAWER.ESCAPE.1 · Escape y foco del menú móvil (resuelta)

**Fuente revalidada (2026-10-01):** `MainLayoutComponent` abre/cierra el drawer con `isSidebarOpen` y ofrece cierre por botón, overlay o navegación, pero no tiene listener de teclado. El breakpoint vigente es 1024 px: por debajo hay cabecera/overlay; desde 1024 px el sidebar queda fijo, sin trigger móvil ni overlay. Escape debe cerrar solo el drawer móvil abierto y devolver el foco al botón que lo abrió; el botón debe exponer su estado accesible.

- [x] Añadir primero una regresión Playwright real aislada: activar el menú por teclado, pulsar Escape, exigir overlay ausente, `aria-expanded=false` y foco devuelto al trigger; reproducir rojo antes del cambio, sin `force`.
- [x] Cubrir 393×851, 320×568, 568×320 y los bordes 1023/1024/1025 px; probar click en overlay, botón cerrar y navegación para conservar el cierre actual; confirmar que Escape no oculta el sidebar desktop.
- [x] Añadir prueba unitaria/de integración de cierre por Escape (incluye no-op cerrado y no afectar un overlay superior), manteniendo la navegación por teclado.
- [x] Corregir accesibilidad/estado mínimo y ejecutar Playwright real Chromium + Pixel 5; revisar foco/teclado, límites, scroll y no-overflow.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil y registrar tests/rollback; no modificar los datos ni el server normal.

**TDD rojo (2026-10-01):** `tests/e2e/main-layout-drawer.spec.ts` en Chromium aislado detectó que Escape dejaba el overlay montado (`Expected: 0, Received: 1`); la unidad Karma también falló porque el drawer permanecía abierto. El runner asignó SQLite, puerto y semilla bajo `%TEMP%`; no usó `localhost:4200`.

**Evidencia verde QA-SHELL.DRAWER.ESCAPE.1 (2026-10-01):** `frontend` Karma focal, 4/4; `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/main-layout-drawer.spec.ts`, 2/2, rate limit activo y cleanup del entorno temporal. Se ejercitaron teclado/Enter/Escape, foco devuelto, Escape no-op al cerrar y en desktop, dialog superior, cierre por botón/overlay/navegación y scroll del menú en horizontal 568×320. Matriz: 320×568, 393×851, 568×320, 1023×768, 1024×900, 1025×900 y 1440×900; no hubo overflow horizontal. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-shell-drawer-final-20261001/main-layout-drawer-desktop.png` y `main-layout-drawer-mobile.png`. Rollback: revertir el commit atómico QA-SHELL.DRAWER.ESCAPE.1; no hay migración de datos.

### QA-SHELL.DRAWER.PROFILE-NAV.1 · cerrar el drawer al abrir Cuenta

**Fuente revalidada (2026-10-04):** `MainLayoutComponent` cierra el drawer al navegar mediante `.sidebar__item` y Configuración, pero `.sidebar__account-main` llama a `navigateToProfile()`, que solo navega a `/account`. Si se usa el avatar/cuenta del drawer móvil, `isSidebarOpen` y el overlay persisten sobre Cuenta. La E2E del Escape prueba navegación por Recetas, no la acción de Cuenta; tampoco exige que el sidebar esté fuera del viewport antes de capturar campos.

**Conducta esperada:** navegar a Cuenta desde el drawer móvil cierra el drawer y retira el overlay antes de mostrar la pantalla; el header de perfil sigue navegando como hasta ahora y el sidebar de escritorio sigue visible.

- [x] Añadir primero regresiones Karma y Playwright reales que abran el drawer, activen Cuenta y verifiquen destino, `aria-expanded=false`, overlay ausente y sidebar fuera del viewport; confirmar rojo antes de producción.
- [x] Cerrar el drawer en el flujo de perfil sin alterar la navegación, foco/teclado, header de perfil ni sidebar desktop.
- [x] En Chromium y Pixel 5 cubrir 393×851, 320×568, 568×320 y el borde 1023/1024/1025; probar también la captura móvil cerrada de Cuenta tras completar la transición, sin overflow.
- [x] Ejecutar Karma focal, cobertura ≥70 % S/B/F/L del componente instrumentable, `typecheck:e2e`, E2E aislada, Prettier focal y `git diff --check`; guardar e inspeccionar capturas sintéticas PC/móvil.

**Evidencia QA-SHELL.DRAWER.PROFILE-NAV.1 (2026-10-04):** TDD rojo en Karma (`pnpm exec ng test --no-watch --include src/app/layouts/main-layout/main-layout.component.spec.ts --browsers=ChromeHeadless`): **4/5** pasaban y la regresión nueva falló porque `isSidebarOpen` seguía en `true` y `.sidebar-overlay` permanecía. La E2E aislada Chromium, ejecutada contra el código pre-fix, reprodujo `aria-expanded=false` esperado frente a `true`. El cambio mínimo llama `closeSidebar()` antes de navegar a `/account`; el header de perfil conserva el destino y el sidebar desktop no se transforma en drawer.

`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/main-layout-drawer.spec.ts --reporter=dot`, con `E2E_RATE_LIMIT=on`, SQLite/puertos/semillas temporales: **4/4** (`chromium` + Pixel 5) para los flujos previos del drawer y navegación a Cuenta. La regresión recorre 393×851, 320×568, 568×320 y 1023×768 en móvil; el sidebar desktop se espera estable y visible en 1024/1025/1440 px. Una primera aserción inmediata de `x=0` detectó solo la transición CSS aún en curso; se corrigió esperando la geometría estable antes de medir. Cuenta quedó en viewport y sin overlay/overflow. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-shell-profile-navigation-20261004/{chromium-account-mobile-closed.png,chromium-account-desktop.png,mobile-chrome-account-mobile-closed.png,mobile-chrome-account-desktop.png}`.

`pnpm exec ng test --no-watch --include src/app/layouts/main-layout/main-layout.component.spec.ts --browsers=ChromeHeadless`: **7/7**. Cobertura focal de `main-layout.component.ts`: **100/81,81/100/100 % S/B/F/L**. El mismo comando con `--code-coverage` devuelve exit 1 por el gate global preexistente de 80 % aplicado al subconjunto (15,06/1,79/4,60/15,87 % agregado), no por las pruebas; no se rebajó. `pnpm run typecheck:e2e`, Prettier focal y `git diff --check` pasan. `git diff --check` solo emite avisos preexistentes de conversión LF/CRLF en archivos dirty no relacionados.

**Rollback focal:** retirar el cierre al navegar desde el perfil del drawer, las regresiones de navegación/captura y este subapartado; no revertir los cierres existentes por enlace, overlay o Escape.

- [x] `/dashboard`: estados con/sin datos, resumen, vencimientos, comidas/recetas y cada CTA; verificar los destinos anotados en discrepancias.
- [x] `/household`: crear hogar, unirse por código, código incorrecto, copiar/regenerar invitación, miembros/roles, permisos para compartir, salir del hogar y estados sin hogar.
- [x] `/account`: tabs y URL, editar/cancelar nombre, seguridad/cambio de contraseña, cerrar sesión, información de cuenta; avatar: formatos/tamaño permitidos, recorte, zoom, recentrar, cancelar, subir, quitar, error y persistencia.
- [x] `/preferences`: tabs/URL y recarga, perfil, alergias, gustos, comidas/horas y objetivos; añadir/quitar opciones personalizadas, guardar/descartar, aviso de cambios sin guardar y enlaces a onboarding/despensa.
- [x] `/settings`: tema claro/oscuro/sistema, idioma ES/EN, módulos habilitar/deshabilitar, reinicio/persistencia y rutas directas con módulo oculto.

**Revalidación integral de `/dashboard` (2026-10-08):** las seis specs de Dashboard pasaron aisladas en Chromium y Pixel 5: **28/28** en 1,3 min, con rate limit activo, SQLite/puertos/semilla temporales y cleanup confirmado. Cubren bienvenida/vacío, resumen y estadísticas, CTAs y destinos, detalle/deep link/modal de recetas, preferencias/errores/reintento de caducidades, comidas de hoy, próxima comida y su cola, permisos del hogar y enlaces recuperables. El caso de hogar recién creado valida un miembro visible. Capturas sintéticas del arreglo de estadísticas, comparables PC/móvil, revisadas e ignoradas por Git: `.e2e-screenshots/qa-ci-dashboard-shard-2/dashboard-members-{1440x900,393x851}.png`.

**Revalidación integral de `/preferences` (2026-10-08):** Playwright aislado ejecuta
`preferences.spec.ts`, `preferences-meals.spec.ts`, `preferences-custom-limits.spec.ts`,
`preferences-width.spec.ts` y `preferences-end-control-reachability.spec.ts` en Chromium y Pixel 5:
**25 passed, 3 skips aplicables a proyectos/viewports**, con `E2E_RATE_LIMIT=on`, SQLite/puertos/semillas
únicos y cleanup confirmado. Cubre URL/recarga de cinco pestañas, nombres y contexto de alergias («La IA lo
descarta de raíz»), perfil, opciones personalizadas y límites, horas y comidas planificables, parche parcial
exacto, persistencia, descartar/restaurar, error 503/reintento 200 sin perder cambios ni duplicar el toast,
objetivos, enlace a despensa y redo de onboarding. En Pixel 5, 320×568, 393×851 y 568×320, valida acceso
táctil al último tab y al CTA de guardar, hit-test contra navegación fija y ausencia de overflow; desktop
valida pestañas por teclado y ancho/gutters a 1280/1920 px. TDD reprodujo que el PATCH fallido mostraba dos
avisos (interceptor + formulario); `TasteProfileService.save()` marca `SILENT_TOAST` y deja el error
localizado al formulario; Karma focal `taste-profile.service.spec.ts` pasa **10/10**. El primer barrido
también expuso una aserción obsoleta: el padding horizontal vive en `app-page-container`, no en
`.preferences-page`; se corrigió la medición para comprobar el frame compartido, sin cambiar el layout.
`pnpm run typecheck:e2e`, `pnpm run check:ui`, Prettier focal y `git diff --check` pasan. Karma focal
`taste-profile.service.spec.ts --code-coverage`: **10/10**; `TasteProfileService` **100/100/100/100 %
S/B/F/L**. Por aislar una sola spec, el grafo parcial da **31.92/19.75/21.09/33.87 % S/B/F/L** y el gate
global configurado de 80 % falla como corresponde; no se rebajó. El hook pre-push vuelve a ejecutar el
gate completo. Capturas sintéticas de escritorio/móvil y error inspeccionadas en
`.e2e-screenshots/qa-preferences-route-20261008/`; artefactos ignorados por Git.

**Evidencia QA-SETTINGS.SURFACE.1 (2026-10-01):** fuente revalidada en `SettingsComponent`, `ThemeService` y `ModulesService`; las preferencias de tema se guardan y recargan desde `localStorage`, y los módulos se persisten mediante el perfil. Playwright aislado `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/settings-theme-i18n.spec.ts tests/e2e/settings-modules.spec.ts`, con rate limit activo, Chrome local y SQLite/puertos/semilla temporales: **34/34**. Comprueba tema claro/oscuro/sistema, idioma inglés con recarga, activación/desactivación, reinicio, error/guardado pendiente, teclado/foco, módulo apagado con navegación directa, límites de 320 px a 1023 px y orientación horizontal 852×393; el runner confirmó cleanup. Karma focal: **30/30**; cobertura por archivo `SettingsComponent` **100/100/100/100**, `ThemeService` **96.66/92.85/87.5/96.66** y `ModulesService` **97.91/90/100/100 % S/B/F/L**. El proceso focal conserva el umbral global de 80 % y sale con error porque el grafo agregado de la suite parcial da **35.09/9.09/26.71/37.98 % S/B/F/L**; no se bajó ningún gate y la casilla global de cobertura completa sigue abierta. Capturas sintéticas revisadas: `.e2e-screenshots/qa-settings-baseline-20261001-220732/settings-desktop.png` y `settings-mobile.png`.

### QA-DASHBOARD.TODAY-MEALS.1 · reintento de comidas y fecha local

**Fuente revalidada antes del ajuste (2026-10-02):** `DashboardComponent.loadDashboardData()` carga el rango de hoy mediante `CalendarService`; el template muestra error recuperable, carga o vacío de forma excluyente. El spec aislado `dashboard-today-meals.spec.ts` esperaba inicialmente el fallo HTTP después de `registerAndGoto()`, pero el helper visita el Dashboard durante `skipOnboarding()` y luego navega otra vez a la ruta solicitada. La interceptación 503 se consumía en la primera visita y la segunda ya respondía correctamente; esto falseaba el escenario de error, no demostraba un defecto de producto. Se armó la respuesta de error después del setup y se recargó explícitamente el Dashboard medido. No cambió código de producción.

- [x] Reproducir el fallo inicial en Chromium y Pixel 5; confirmar desde `registerAndGoto()`/`registerUser()` la doble visita que consumía el fallo de una sola vez.
- [x] Armado posterior al setup: comprobar error visible y recuperación por teclado con segundo request retenido/liberado; target real del retry ≥44×44 px.
- [x] Verificar fixture SQLite sintética: solo comidas pendientes de hoy, sin ayer/mañana ni completadas, orden/tipo/hora, idioma ES/EN, limpieza de cada fila, CTA a Calendario y cero llamadas IA/errores JS.
- [x] Matriz visual a 320, 393, 479, 480, 481, 767, 768, 769, 844×390, 1023, 1024 y 1440 px: sin overflow ni comida tapada por navegación fija.
- [x] Ejecución focal tras el arreglo: `tests/e2e/dashboard-today-meals.spec.ts` **2/2** (Chromium + Pixel 5). Suite combinada `dashboard.spec.ts`, `dashboard-recipe-links.spec.ts` y `dashboard-today-meals.spec.ts`: **14/14** aislada con rate limit activo y SQLite/puertos temporales. Cobertura de producción N/A (solo se corrigió sincronización del test); no se cambió el gate.

**Evidencia/limitación:** la primera suite combinada reprodujo **12/14**, con los dos fallos del mismo escenario de recuperación (desktop/móvil); tras armar el error después del helper, el spec focal pasa **2/2** y la suite combinada original **14/14**. La revisión de los enlaces visibles detectó que faltaba cubrir Planificar ahora y Ver todo de recetas; QA-DASHBOARD.CTA-SUMMARY.1 los cierra. La casilla general `/dashboard` permanece abierta por las superficies de Today que el contrato activo aún requiere. Runner temporal sin escrituras a `localhost:4200` ni proveedor externo.

### QA-DASHBOARD.NEXT-MEAL.1 · siguiente comida planificada

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §2 define Today con comidas debidas y §P5 requiere la próxima comida planificada. El Dashboard actual consulta `CalendarService.loadRange(todayIso, todayIso)` y `pendingMealsForDate()` solo representa comidas pendientes de hoy; `CalendarService.getMealsForRange()` ya permite leer un rango auxiliar sin cambiar la vista/rango compartido del calendario. No existe aún una vista que permita anticipar el próximo día planificado.

**Decisión de alcance (inferencia acotada):** buscar la próxima comida sin completar desde la hora local actual en un horizonte de siete fechas locales contando hoy (hoy y los seis días siguientes). El rango de fechas es inclusivo: aceptar el séptimo día y excluir el octavo. Ordenar por fecha, hora, título e ID; las comidas sin hora quedan después de las que sí la tienen en el mismo día. Si la próxima comida ya pertenece a «Comidas de hoy», marcar esa fila como siguiente en vez de duplicarla. Si cae en otra fecha, mostrar una vista compacta con fecha, tipo, título y hora, con enlace a Calendario. Carga, error reintentable y ausencia de planes se distinguen; la ausencia ofrece el CTA a Calendario. Solo se leen datos: no se crea comida ni se llama a IA.

- [x] Añadir primero pruebas de la selección: excluir completadas y horas pasadas de hoy, aceptar comida sin hora hoy, respetar zona/fecha local, ordenar empates establemente e incluir el séptimo día total (hoy + 6) pero excluir el octavo (hoy + 7).
- [x] Cargar el rango futuro con `getMealsForRange()` sin mutar la señal/rango que usa Calendario; al cancelarse/destruirse el Dashboard, no permitir que una respuesta antigua sobrescriba el estado actual.
- [x] Mostrar la próxima comida en la fila de hoy sin duplicación o, si es futura, en una vista compacta con fecha/tipo/título/hora y destino funcional a `/calendar`; añadir textos ES/EN y estados loading/vacío/error/reintento.
- [x] Probar fixtures sintéticas con Chromium y Pixel 5: comida futura hoy, siguiente fecha, comida completada, sin planes y fallo 503 seguido de recuperación; cubrir keyboard/focus/tap y límites 320×568, 393×851, 568×320 y 1440×900.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil; asegurar ≥70 % S/B/F/L en cada fuente de producción instrumentable del cambio, ejecutar suite frontend con gate 80 %, E2E aislada, typecheck, `check:ui`, formato, build y `git diff --check`.

**Evidencia (2026-10-08):** TDD primero mostró la exportación/contrato ausentes; tests focales de helpers y componente pasan **12/12**. El hook pre-push más reciente de esta rama ejecutó `pnpm run test:client` (**1185/1185**, cobertura global **90.28/81.44/89.02/91.64 % S/B/F/L**). Cobertura focal por archivo: `dashboard.component.ts` **94.87/75.00/87.50/94.87 %**; `dashboard-meals.util.ts` **100 %** en las cuatro métricas; `dict/dashboard.ts` **100 %** en sentencias/líneas, sin ramas ni funciones instrumentables. Playwright real aislado: `pnpm run test:e2e -- tests/e2e/dashboard-next-meal.spec.ts`, **4 passed**, 2 Safari omitidos por alcance; usa `DATABASE_PATH` temporal validado por el runner y limpieza automática. Se recorrieron las cuatro medidas indicadas en Chromium y Pixel 5, foco/teclado, tap, 503/carga/reintento, cambio ES/EN, navegación, ausencia y no llamada a IA. `pnpm run build:client`, `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 archivos/21 reglas), Prettier y `git diff --check` pasan. Capturas sintéticas inspeccionadas: `.e2e-screenshots/dashboard-next-meal/dashboard-next-meal-1440x900.png` y `.e2e-screenshots/dashboard-next-meal/dashboard-next-meal-393x851.png`; el preview reutiliza la geometría de `.meal-card` (anchos iguales dentro de 1 px, mismo padding, radio y gap), sin overflow ni solapamiento con navegación en la vista comprobada.

**Rollback:** revertir la unidad que añade la búsqueda de siguiente comida, sus textos/pruebas y este subapartado; no cambiar el listado de comidas de hoy ni el estado del calendario compartido.

### QA-DASHBOARD.CTA-SUMMARY.1 · resumen y CTA renderizados

**Fuente revalidada (2026-10-08):** `DashboardComponent` renderiza cuatro tarjetas numéricas, CTA a generar receta (`/recipes#ai`), despensa y calendario, vista de caducidades, comidas de hoy con próxima comida, cola de trabajos IA y recetas sugeridas. También expone enlaces para Planificar ahora, Ver todo de comidas/recetas y abrir una receta sugerida; los tests siguen sus destinos. Frente a HOGARIA-SPEC §2/§P5 queda pendiente comparar el total de las listas abiertas con un presupuesto semanal; no hay aún una preferencia para guardar ese presupuesto y decidir su ámbito.

- [x] Añadir E2E para las cuatro tarjetas de resumen y los dos CTA sin destino verificado: Planificar ahora abre `/calendar` y Ver todo de recetas abre `/recipes`.
- [x] Revalidar en Chromium escritorio y Pixel 5 los CTA actualmente renderizados, estados vacíos/poblados, resumen y destino de receta sugerida; preservar el test que confirma que abrir el modal IA no invoca el proveedor.
- [x] Mantener los localizadores del CTA «Planificar ahora» acotados al bloque vacío de comidas de hoy, para que el mismo enlace de la próxima comida no vuelva ambigua la prueba en modo estricto.

**Evidencia (2026-10-08):** `dashboard.spec.ts --grep 'empty-meals'` pasa **2/2** en Chromium y Pixel 5; verifica cuatro resúmenes numéricos, el CTA vacío de comidas y el listado de recetas. Repetición aislada de `dashboard.spec.ts`, `dashboard-recipe-links.spec.ts` y `dashboard-today-meals.spec.ts`: **16/16** en **39,6 s**, con `E2E_RATE_LIMIT=on`, Chromium instalado, SQLite/puertos/semillas temporales y cleanup confirmado. Se cubren los CTA presentes, enlaces directos y estados de hoy; ninguna llamada a IA ocurre en el flujo de enlaces. No cambió UI, por lo que no se generaron capturas nuevas.

**Regresión CI y reparación (2026-10-08):** en `0c432ab`, `E2E Tests (shard 2)` falla en `tests/e2e/dashboard.spec.ts:93` porque el localizador del CTA, limitado a la sección general de comidas, encuentra tanto el enlace de hoy como el nuevo CTA de próxima comida. La E2E aislada reproduce **2 fallos** (Chromium y Pixel 5, strict mode con dos coincidencias); al limitar la búsqueda a `[data-test="today-meals-empty"]`, el mismo comando pasa **2/2**. Es un ajuste del selector, no cambia el comportamiento visible.

**Pendiente de producto, mantiene abierta la casilla general `/dashboard`:** decidir dónde se guarda y a quién pertenece el presupuesto semanal que se compara con las listas abiertas; la cola IA y los vencimientos ya tienen unidades propias.

### QA-DASHBOARD.AI-QUEUE.1 · trabajos IA pendientes en Today

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §P5 exige mostrar trabajos IA pendientes en Today y un salto a la cola. La pantalla existente `/ai-config/:configId/queue` muestra trabajos `queued`/`running`/`failed` por configuración y solo está disponible cuando `concurrency > 0`; `AiQueueService` ofrece snapshots con metadatos seguros, sin contenido de prompts, respuestas o claves. `GET /api/ai/configs` y `aiHouseholdSettingsGuard` exigen permiso `settings` en el hogar activo. La unidad backend `0c432ab` añadió el mismo permiso a todos los métodos de `server/src/routes/ai-queue.routes.ts`; el dashboard también está disponible a integrantes sin permiso, así que el resumen no consulta configuraciones ni colas para ellos.

**Contrato:** en modo personal, o en el hogar activo únicamente para miembros con `permissions.settings === true`, Today puede consultar configuraciones y resumir por proveedor con `concurrency > 0` sus trabajos `queued`, `running` y `failed`. Cada resumen con trabajos enlaza a la cola de ese proveedor. Si no hay trabajos, no se muestra ruido vacío; durante carga, error de lectura debe ser visible y reintentable. Si falla una configuración, conservar los resultados de las demás y permitir reintentar la fallida. No consultar configuraciones/colas mientras la membresía se carga, falla, exige elegir hogar o carece de permiso. Aplicar la misma ACL en **todas** las rutas de cola (`GET`, reordenar, cancelar y reintentar), manteniendo respuestas existentes de selección requerida y `HOUSEHOLD_SETTINGS_REQUIRED` (403). Ignorar respuestas tardías al cambiar hogar/destruir el Dashboard. Este resumen es solo lectura, no inicia, cancela ni reintenta trabajos, y no hace peticiones al proveedor externo.

- [x] Añadir primero pruebas de componente/servicios para personal permitido, admin permitido, miembro sin `settings`, selección de hogar pendiente, carga/fallo de membresía, cero trabajos, varias configuraciones, fallo parcial/reintento y respuesta tardía al cambiar contexto/destruir.
- [x] Añadir primero pruebas de ruta backend que prueben 403 `HOUSEHOLD_SETTINGS_REQUIRED` en cada método protegido para miembro de hogar sin permiso; conservar cobertura personal/admin, selección requerida y aislamiento de otra configuración/hogar. Ninguna mutación debe ocurrir tras 403.
- [x] Implementar lectura segura del resumen y enlaces por configuración con `concurrency > 0`; conservar ES/EN, semántica accesible, estados de carga/error/reintento y guardas contra llamadas antes de verificar el permiso.
- [x] Verificar con Chromium y Pixel 5, ES/EN y fixtures sintéticas con trabajos queued/running/failed; teclado/foco, reintento, navegación al proveedor correcto, 320×568, 393×851, 568×320 y 1440×900, sin overflow ni solape con la navegación fija. Confirmar que el proveedor externo no recibe llamadas y que la respuesta de UI/API no expone datos sensibles.
- [x] Ejecutar pruebas focales, cobertura ≥70 % S/B/F/L por fuente instrumentable (sin bajar el gate frontend 80 %), E2E real aislada, typecheck, `check:ui`, formato, build y `git diff --check`; guardar e inspeccionar capturas sintéticas de escritorio/móvil e incorporar evidencia y rollback.

**Rollback:** revertir el commit atómico `feat(dashboard): summarize pending AI jobs` (resumen del Dashboard, snapshot del servicio, traducciones y pruebas UI/E2E); conservar la ACL API de `0c432ab`, que corrige una brecha de autorización independiente; no borrar ni alterar trabajos persistidos.

**Evidencia ACL backend (2026-10-08):** la prueba añadida falló primero en el baseline porque las rutas devolvían 200/409 en vez de 403; el cambio aplica `canManageHouseholdAiSettings` antes de todos los handlers de cola. `pnpm --filter @hogaria/server exec vitest run src/routes/ai-queue.routes.spec.ts --reporter=dot` pasa **9/9**, incluyendo acceso denegado a GET/reordenar/cancelar/reintentar sin alterar trabajos. La cobertura de `ai-queue.routes.ts` en `pnpm run test:server:coverage` es **96.72/96.42/87.50/98.21 % S/B/F/L**; backend completo **1226 passed, 1 skipped**, gate allowlist global **91.63/83.04/95.74/94.16 %**. `pnpm run build:server` y `git diff --check` pasan.

**Evidencia UI (2026-10-08):** los unitarios de `DashboardComponent`/`AiService` pasan **30/30**, incluidos cuenta personal con membresías vacías, admin, miembro sin permiso, membresía pendiente/fallida, cola vacía oculta, proveedores concurrentes, error parcial/reintento y respuestas tardías tras cambio de hogar/destrucción. La suite cliente completa pasa **1194/1194**, cobertura global **90.28/81.39/88.95/91.71 % S/B/F/L**. Cobertura de archivos modificados: `dashboard.component.ts` **92.06/76.19/86/96.38 %**, `ai.service.ts` **97.56/82.60/95.55/97.36 %**, `dict/dashboard.ts` **100/100/100/100 %**.

`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/dashboard-ai-queue.spec.ts --reporter=line` pasa **4/4**. Con `E2E_RATE_LIMIT=on` crea la cuenta/hogar/jobs sintéticos en SQLite aislada y limpia tras cerrar la app; el proveedor está inactivo, la base URL es loopback vacía y el test confirma cero solicitudes a `127.0.0.1:9`/rutas de generación. Verifica resúmenes queued/running/failed, fallo 503 y reintento GET, idioma ES/EN, destino de cola, teclado/foco y toque, permiso hogar/403 directo/guard de navegación, y anchos 320×568, 393×851, 568×320 y 1440×900 sin overflow ni cruce con navegación fija. El DTO `queueForConfig` whitelistea solo id, config, tipo, estado, intentos, código de error, flag de reintento, fecha y orden; nunca devuelve clave, prompt, adjuntos, resultado ni cuerpo de error del proveedor. Capturas sintéticas revisadas: `.e2e-screenshots/dashboard-ai-queue/dashboard-ai-queue-chromium.png` y `.e2e-screenshots/dashboard-ai-queue/dashboard-ai-queue-mobile-chrome.png`.

`pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 ficheros, 21 reglas**), Prettier focal, `pnpm run build:client` y `git diff --check` pasan. El build conserva warnings previos de imports/tipos opcionales y budgets de bundle/estilos. No se redujo el gate Karma de 80 %.

### QA-DASHBOARD.EXPIRY-WINDOW.1 · vencimientos próximos configurables

**Fuente y alcance revalidados (2026-10-08):** HOGARIA-SPEC §2/P5 exige ver en Today los productos que vencen dentro de N días y que N se configure en Settings. `GET /api/pantry/expiry` ya devuelve `daysLeft` (negativo = caducado; `null` = sin fecha conocida) y orden por urgencia; el endpoint de estadísticas de despensa conserva una ventana histórica de tres días. Settings hoy persiste tema e idioma en el navegador y los módulos en el perfil. No existe preferencia de horizonte.

**Decisión de alcance:** añadir en Settings una preferencia local de 1–30 días, con valor inicial de 3 para conservar el umbral vigente de «por caducar». Es una preferencia de visualización, no modifica datos ni el API. Dashboard incluye caducados y los que vencen hoy o dentro de N días; omite fechas desconocidas y ofrece enlace a Caducidades. El presupuesto de compra, la próxima comida planificada y la cola IA son unidades Today separadas; no quedan implícitamente resueltas por este cambio.

- [x] Añadir primero una E2E roja con despensa sintética que verifique límite inclusivo N, producto ya caducado, N+1 días, fecha desconocida y lista vacía; probar 3 → 5 días desde Settings y persistencia tras recarga.
- [x] Implementar la preferencia accesible ES/EN en Settings, persistida con el patrón local de tema/idioma, rango 1–30 y default 3; entrada inválida no debe alterar el último valor válido.
- [x] Mostrar en Dashboard la cantidad y nombres de hasta cinco próximos/caducados, correctamente ordenados; añadir estados loading, vacío, error y reintento, y enlace funcional a `/pantry/caducidades`.
- [x] Verificar Chromium escritorio y Pixel 5, desktop 1440×900, móvil 393×851 y mínimo 320×568, rotación 568×320, sin overflow ni contenido inaccesible tras la navegación fija; guardar e inspeccionar capturas sintéticas PC/móvil.
- [x] Ejecutar regresión roja→verde, Karma/unitarios, E2E aislada con rate limit activo y SQLite/puerto/semilla temporales, cobertura ≥70 % S/B/F/L por archivo instrumentable, `typecheck:e2e`, `check:ui`, formato, build y `git diff --check`; documentar comandos y rollback.

**TDD y evidencia (2026-10-08):** la E2E inicial fue roja en el baseline porque faltaba
`[data-test="dashboard-expiry"]`. Tras implementar, `node scripts/run-isolated-playwright.mjs
--workers=1 --project=chromium --project=mobile-chrome
tests/e2e/dashboard-expiry-window.spec.ts --reporter=line` pasa **4/4** con
`E2E_RATE_LIMIT=on`; la ejecución usa SQLite, puertos y semilla temporales, y confirma cleanup.
Se prueba N inclusivo, caducados/hoy/N+1/fecha desconocida, cambio 3→5 con recarga, error,
reintento, estado vacío, destino del enlace, overflow, controles táctiles ≥44 px y acceso al
último vencimiento por encima de la navegación fija. `pnpm --filter @hogaria/web exec ng test
--no-watch --include src/app/features/dashboard/dashboard.component.spec.ts --include
src/app/features/dashboard/dashboard-expiry.util.spec.ts --include
src/app/core/services/dashboard-preferences.service.spec.ts --include
src/app/features/settings/settings.component.spec.ts --browsers=ChromeHeadless` pasa **17/17**;
`pnpm run test:client:coverage` pasa **1180/1180**, cobertura global S/B/F/L
**90,28/81,48/89,01/91,64 %**. Cobertura por archivo (S/B/F/L): `dashboard-expiry.util.ts`
**100/88,24/100/100 %**; `dashboard-preferences.service.ts` **100/100/100/100 %**;
`settings.component.ts` **100/100/100/100 %**; `dashboard.component.ts`
**97,83/87,5/93,75/97,83 %**. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui`
(210 archivos, 21 reglas), `pnpm run build` y `git diff --check`; Prettier valida los archivos
del cambio. La build mantiene avisos de presupuesto Angular ya existentes, sin error de salida.

Capturas sintéticas inspeccionadas (ignoradas por Git): `.e2e-screenshots/qa-dashboard-expiry-window-20261008/`; incluye Dashboard y Settings en escritorio/móvil, anchos 1440, 393, 320 y orientación 568×320.

**Rollback de unidad:** retirar la preferencia de horizonte, su control Settings, el resumen de caducidades Dashboard, las pruebas y este subapartado; no cambiar la lista completa de Caducidades ni el umbral del API.

### QA-AUTH.LOGIN.DOUBLE-SUBMIT.1 · Evitar envíos concurrentes del login

**Fuente revalidada (2026-10-01):** `LoginComponent.onSubmit()` comprueba campos vacíos y activa `isLoading`, pero no consulta ese estado antes de volver a enviar. El botón compartido queda `disabled` durante la carga, pero el formulario sigue teniendo un único listener `ngSubmit`; falta una prueba runtime que compruebe si una segunda petición de submit mientras la primera está pendiente genera otra llamada. Si el login lleva `?code=`, el éxito continúa con `HouseholdService.joinByCode()` y navega a `/household`; el fallo de login limpia `isLoading` y permite reintentar. La solución solo se aplicará si la regresión se reproduce.

- [x] Añadir primero una prueba unitaria que mantenga pendiente `AuthService.login`, dispare dos submits y exija una única llamada; cubrir campos inválidos y permitir retry tras error.
- [x] Reproducir en Playwright aislado con un usuario/hogar sintéticos: durante el login pendiente volver a someter el formulario, observar una sola petición de login, una sola unión por `?code=`, y destino `/household`; bloquear service workers para que no omitan la interceptación de prueba.
- [x] El doble envío se reprodujo; añadir guard temprano en `onSubmit()` y verificar rojo/verde con la misma prueba.
- [x] Ejecutar en Chromium escritorio y Pixel 5, sin escritura en DB/servidor normal; confirmar cobertura de `login.component.ts` ≥70 % en statements/branches/functions/lines sin rebajar gates existentes.
- [x] No hay cambio visual; capturas PC/móvil son N/A.

**TDD rojo (2026-10-01):** Karma reprodujo 2 llamadas a `AuthService.login` en el segundo submit (1 fallo y 3 pruebas vecinas verdes). En el build full-stack aislado, `login-double-submit.spec.ts` falló en Chromium y Pixel 5 porque el segundo `requestSubmit()` generó otra petición durante la primera autenticación. El runner usó SQLite, puerto y semilla únicos; la ejecución roja retuvo sus artefactos bajo `%TEMP%`, sin tocar la base de datos normal.

**Evidencia verde QA-AUTH.LOGIN.DOUBLE-SUBMIT.1 (2026-10-01):** el guard `if (this.isLoading()) return` en `LoginComponent.onSubmit()` evita el envío concurrente sin alterar validación ni estados de error. Karma `login.component.spec.ts`: **6/6**; coverage focal de `login.component.ts`: **100/85,71/100/100 % S/B/F/L**. Playwright full-stack aislado, rate limit activo y service workers bloqueados: `login-double-submit.spec.ts` **2/2** (Chromium y Pixel 5); registra un solo POST de login, un solo `POST /api/household/join/:code`, URL final `/household` y cero `pageerror`. Cada run verde limpió su SQLite/puerto/semilla temporales. `pnpm run build` (server+client antes del guard) y `pnpm run build:client` (después del guard), `tsc -p tsconfig.e2e.json --noEmit`, Prettier focal y `git diff --check`: correctos; el build conserva warnings preexistentes de bundle/imports.

Rollback previsto: revertir el commit atómico de esta unidad para quitar el guard y sus pruebas; conservar el commit previo que publicó primero la especificación.

### QA-HOUSEHOLD.CREATE-JOIN.ATOMICITY.1 · Crear o unirse a un hogar sin escrituras parciales

**Fuente de verdad antes del cambio (2026-10-01):** `POST /api/household`, `POST /api/household/join` y `POST /api/household/join/:code` escribían membresía, `users.household_id`, adopción del inventario personal y semillas del hogar sin abarcar la secuencia completa en una transacción. El contrato define que HogarIA comparte inventario y el código trasladaba el inventario personal al hogar; no define una política distinta para quien ya pertenecía a otro hogar. Esta unidad conserva el comportamiento exitoso y no decide esa política.

- [x] Añadir primero pruebas de integración de las rutas con `DATABASE_PATH=:memory:` y un trigger SQLite determinista que falle durante la siembra, después de iniciar la adopción; reproducir el resultado actual antes de implementar.
- [x] En fallo al crear: no dejar hogar, membresía, `users.household_id` ni semillas parciales; conservar intactos los ingredientes y utensilios personales.
- [x] En fallo al unirse por ambos endpoints: conservar hogar y membresía anteriores, `users.household_id` y filas personales; no dejar nueva membresía ni semillas parciales.
- [x] Confirmar que al retirar el trigger crear/unirse sí termina con adopción y siembra completas; conservar 404 de código inválido y 409 de miembro duplicado.
- [x] Cubrir la lógica transaccional en éxito/error con ≥70 % de statements, branches, functions y lines; ejecutar la suite focal y repetir `household.spec.ts` en Chromium y Pixel 5 con SQLite temporal y rate limit activo.
- [x] No hay cambio visual; capturas PC/móvil son N/A. Mantener sin marcar el barrido general `/household` hasta cubrir invitaciones, permisos, roles, salida, errores y dimensiones.

**TDD rojo (2026-10-01):** un trigger `BEFORE INSERT` en categorías interrumpió la siembra después de iniciar la adopción; antes de la corrección, los tests observaron que create dejaba un hogar huérfano y join trasladaba `household_id`, membresía e inventario personal pese al 500 (**3 fallos focales**). Tras envolver las secuencias create/join en transacciones, las regresiones comprobaron rollback íntegro en ambos endpoints de unión, sin cambiar el comportamiento exitoso ni decidir la política de transferencia entre hogares.

**Evidencia verde QA-HOUSEHOLD.CREATE-JOIN.ATOMICITY.1 (2026-10-01):** `node node_modules/vitest/vitest.mjs run src/routes/household.routes.spec.ts --coverage.enabled --coverage.include=src/routes/household.routes.ts --coverage.reporter=text --coverage.reportsDirectory=%TEMP%\hogaria-household-coverage-20261001 --reporter=dot`: **16/16**, cobertura focal **100/90,36/100/100 % S/B/F/L**; `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: pasa. Playwright aislado `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/household.spec.ts`, `E2E_RATE_LIMIT=on`, Chrome local, usuario/puerto/SQLite temporales: **4/4** en Chromium y Pixel 5; la suite recorre crear hogar, enlace y controles de compartir e invitación pública. El runner confirmó limpieza de su DB/artefactos. No hay cambio visual. El barrido amplio `/household` sigue abierto.

### QA-HOUSEHOLD.MEMBER-OWNERSHIP.1 · Limitar cambios de miembros al hogar administrador

**Fuente de verdad antes del cambio (2026-10-01):** `PATCH /api/household` autorizaba al admin de su hogar, pero actualizaba la membresía opcional solo por ID. La conducta esperada es que no pueda modificar miembros ajenos; responder 404 para membresía ausente/ajena evita revelar su existencia. No hay cambio visual previsto y el formulario actual de Hogar no expone edición de roles.

- [x] Añadir primero una prueba de integración con dos hogares y administrador sintético; enviar el ID de membresía del otro hogar y reproducir el resultado actual sobre SQLite en memoria.
- [x] Rechazar membresía ausente o de otro hogar con 404, sin cambiar rol ni permisos; conservar la actualización legítima de un miembro local por admin y el 403 de un usuario no admin.
- [x] Cubrir la autorización de miembro con ≥70 % de statements, branches, functions y lines; comprobar lectura posterior y ausencia de escrituras cruzadas en la base aislada.
- [x] Sin cambio visual: capturas N/A. Mantener pendiente el barrido general `/household` y no mezclar decisiones de política de roles no mostradas por la UI.

**Evidencia QA-HOUSEHOLD.MEMBER-OWNERSHIP.1 (2026-10-01):** la prueba roja devolvía 200 y cambiaba el rol de una membresía de otro hogar. La ruta ahora valida el hogar propio antes de cualquier ajuste combinado y aplica el `UPDATE` condicionado por ambos `id` y `household_id`; lectura posterior confirma 404 y cero escrituras cruzadas. Los casos de 403 para no-admin y edición legítima están en la misma suite aislada (16/16); typecheck y coverage focal pasan (100/90,36/100/100 % S/B/F/L). Sin UI/capturas.

### QA-HOUSEHOLD.API-SURFACE.1 · Contrato HTTP de hogar sobre SQLite aislada

**Fuente de verdad antes del cambio (2026-10-01):** `household.routes.ts` contiene lecturas privadas/públicas, create/join, cambios de permisos/ajustes, regeneración de invitación y salida. El E2E existente recorría solo creación e invitación pública. Se añadió la suite de ruta al gate por fichero de Vitest sin rebajar umbrales.

- [x] Cubrir `GET /` con y sin hogar; `GET /invite/:code` válido/inválido y miembro/no miembro; comprobar el sobre y los miembros devueltos sin secretos.
- [x] Cubrir cambios de nombre y los tres permisos de compartir con admin; no-op, hogar ausente y miembro sin rol admin; verificar persistencia tras lectura.
- [x] Cubrir regenerar invitación, salida de miembro con admin restante, salida del único admin, ausencia de hogar y datos que se conservan/eliminan.
- [x] Mantener las regresiones separadas de crear/unirse y propiedad de miembro; ejecutar Vitest aislado, incluir `household.routes.ts` en el gate ≥70 % S/B/F/L y repetir Playwright real de Hogar en Chromium/Pixel 5.
- [x] Esta unidad no sustituye el recorrido Playwright de cada formulario/confirmación responsive de `/household`; sin cambio visual en el router, capturas N/A.

**Evidencia QA-HOUSEHOLD.API-SURFACE.1 (2026-10-01):** la suite integrada con SQLite `:memory:` cubre lectura sin/con hogar; invitación pública inválida/válida/miembro; create y los dos joins; PATCH de nombre y permisos, no-op y 403; regeneración; salidas y conservación/eliminación. **16/16** pruebas; `household.routes.ts` **100/90,36/100/100 % S/B/F/L**; typecheck pasa. Playwright real aislado para crear/invitar comparte **4/4** Chromium/Pixel 5. El intento de cobertura de todo el servidor ejecutó 919 tests (916 pasaron) y falló solo en los tres casos Windows-específicos de `src/utils/uploads.spec.ts` (expectativas POSIX/chmod incompatibles con esta shell); se registra como limitación de entorno, no como éxito de suite global. No se recorrió con E2E toda la UI/formularios responsive de Hogar; esa casilla global permanece abierta. Sin cambios visuales en esta unidad.

### QA-HOUSEHOLD.ACTION-ACK.1 · no anunciar éxito si el hogar no confirma

**Fuente revalidada antes de implementar (2026-10-01):** el contrato de dominio está en `HOGARIA-SPEC.md` §§8b–8c y las respuestas autoritativas en `server/src/routes/household.routes.ts`. La ruta real devuelve 404/409 para códigos inválidos o membresía duplicada; 403/404 para cambios sin permiso/hogar y respuestas `{ success: true, data }` para mutaciones completadas. `HouseholdService` convierte errores de `createHousehold`, `joinHousehold`, `updateSettings`, `regenerateInviteCode` y `leaveHousehold` en valores `null`/`false`; `HouseholdComponent` interpreta hoy cualquier emisión `next` como éxito, y regeneración/salida no tienen rama local de error. Create/join muestran loading pero sus métodos no comprueban `isSaving()` antes de iniciar otra solicitud. Los tres `<app-modal>` de crear/unirse/invitar asignan `[attr.title]`, aunque `ModalComponent` requiere el `@Input() title` para rotular el diálogo.

**Conducta esperada:** una mutación solo comunica éxito al recibir su valor afirmativo; un error HTTP/runtime o sentinel `null`/`false` mantiene el hogar/formulario/código anterior, presenta un único error localizable (sin éxito falso ni duplicado genérico del interceptor) y deja reintentar. El control de compartir conserva visualmente el valor confirmado por el servidor mientras espera respuesta y tras un fallo. Las peticiones de mutación con error propio de la pantalla se marcan con `SILENT_TOAST` para reservar el feedback al mensaje accionable local. Los formularios create/join no pueden enviar dos mutaciones simultáneas. Los diálogos exponen su título como nombre accesible y sus acciones tienen área táctil mínima de 44×44 px. Esta unidad no agrega UI de edición de roles (no existe en la pantalla) ni cierra el barrido general de copiar invitación, permisos, salida y responsive.

- [x] Escribir primero pruebas unitarias para todos los sentinels de mutación: crear/unirse/ajustes/regenerar/salir; reproducir toast de éxito falsa y modal cerrado después de error; verificar estado, capacidad de reintento y `SILENT_TOAST` en cada mutación.
- [x] E2E real aislada: creación con 503 conserva nombre/modal y reintenta a 201; unión con 404 conserva el código/modal y reintenta con invitación sintética válida; no filtrar datos del hogar anterior.
- [x] E2E: un PATCH 503 de compartir conserva visualmente el valor confirmado y presenta solo el error local; retry exitoso persiste y se refleja al recargar. Regenerar 503 conserva enlace/código; retry 200 solo anuncia éxito cuando llega el nuevo código.
- [x] E2E: rechazar salida en confirmación no envía DELETE; DELETE 503 mantiene hogar y no anuncia salida; retry 200 limpia el hogar local y muestra éxito una sola vez.
- [x] Mientras POST de create/join está pendiente, someter por teclado dos veces y afirmar un solo request; loading acaba tanto en éxito como en fallo, y un fallo permite volver a intentar.
- [x] Nombrar accesiblemente los diálogos crear/unirse/invitar y operarlos por roles/teclado; validar error/loading, foco y controles táctiles ≥44×44 px.
- [x] Ejecutar en Chromium y Pixel 5 con SQLite/puertos/semilla propios y rate limit activo; comprobar 320×568, 393×851, 568×320, 1023/1024/1025 y 1440×900, no-overflow y cero `pageerror`. Guardar e inspeccionar capturas PC/móvil sintéticas.
- [x] Cobertura ≥70 % S/B/F/L por cada fichero de producción tocado, sin rebajar gates; ejecutar typecheck, formato/diff y registrar el estado del gate global existente.

**TDD rojo (2026-10-02):** `household.component.spec.ts` reprodujo 8 fallos de 9: falso éxito para sentinels, envíos duplicados, títulos de diálogo vacíos y falta de errores de regenerar/salir. Playwright real contra SQLite aislada reprodujo además los diálogos sin área táctil de 44 px, checkbox de compartir visualmente optimista tras PATCH 503 y toast genérico del interceptor duplicado con el mensaje local en 404/503. No se llamó al proveedor externo ni al servidor/base habituales.

**Evidencia final (2026-10-02):** Karma focal `household.service.spec.ts` + `household.component.spec.ts`: **22/22**. Playwright real aislado con `scripts/run-isolated-playwright.mjs`, SQLite/puertos/semillas temporales, rate limit activo y cleanup: **6/6 Chromium + 6/6 Pixel 5**. Verificó create 503→201, join 404→invitación sintética, ausencia de datos del hogar anterior, compartir PATCH 503 con checkbox confirmado y retry persistente tras reload, regeneración 503→200, cancelar salida sin DELETE y DELETE 503→retry, serialización de envíos por teclado y el diálogo de invitación con nombre accesible, foco/restauración, Escape, copiar al clipboard real y targets táctiles. En los diálogos se midieron 320×568, 393×851, 568×320, 1023×900, 1024×900, 1025×900 y 1440×900: dentro del viewport, sin overflow; cero `pageerror`/errores inesperados de la app. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-household-action-ack-qa-hogaria-e2e-4VdRUm/chromium/household-invite-dialog.png`, `.e2e-screenshots/qa-household-action-ack-qa-hogaria-e2e-qTFRug/mobile-chrome/household-invite-dialog.png` y los correspondientes `household-settings-regenerate-retry.png`.

La coverage focal S/B/F/L de `HouseholdComponent` es **88.04/95.65/74.28/87.2 %**, `HouseholdService` **100/96.55/100/100 %** y el diccionario de Hogar **100/100/100/100 %**. `tsc -p tsconfig.e2e.json --noEmit`, Prettier focal, `git diff --check` y `npm run build:prod` pasan; el build conserva warnings del presupuesto de bundle/estilos, imports no usados y optional chaining no necesario ya presentes en el árbol. La suite frontend completa pasa **797/797** tests, aunque Karma sale con código 1 por el gate global existente del 80 % (S/B/F/L **75.55/65.61/73.92/77.19 %**); branches aún no alcanzan el mínimo global solicitado de 70 %, por lo que el gate global permanece abierto y no se rebajó. El primer rerun E2E había fallado por el test intentando cerrar el toast después de su auto-dismiss de 5 s; el test ahora lo cierra inmediatamente tras verificarlo y ambas matrices pasan. Sin llamadas a proveedor IA ni escrituras a la base habitual.

**Comandos:** desde `frontend`, Karma focal (22/22): `node .\node_modules\@angular\cli\bin\ng.js test --no-watch --include=src/app/core/services/household.service.spec.ts --include=src/app/features/household/household.component.spec.ts --karma-config=karma.local-headless.conf.js --browsers=ChromeHeadlessLocal`; Playwright aislado con `E2E_SCOPE=all`, `E2E_RATE_LIMIT=on`: `node scripts/run-isolated-playwright.mjs --project=chromium tests/e2e/household-action-ack.spec.ts` y el mismo comando con `--project=mobile-chrome` (6/6 cada uno). Suite frontend completa (797/797, salida 1 solo por cobertura): `node .\node_modules\@angular\cli\bin\ng.js test --no-watch --code-coverage --karma-config=karma.local-headless.conf.js --browsers=ChromeHeadlessLocal`. También pasan `node frontend/node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`, Prettier focal, `git diff --check` y `npm run build:prod`. Karma usó una configuración local temporal de launcher Chrome para esta máquina; se eliminó tras las pruebas.

**Rollback:** revertir el commit atómico de esta unidad restaura el feedback previo de acciones de Hogar; afecta únicamente `HouseholdComponent`, `HouseholdService`, las traducciones de Hogar, sus pruebas y esta sección de checklist. No hay migración ni escritura persistente fuera de las fixtures aisladas.

### QA-HOUSEHOLD.CLIPBOARD.1 · no confirmar copiado si falla el portapapeles

**Fuente revalidada antes de implementar (2026-10-02):** `HouseholdComponent.copyLink()` invoca `navigator.clipboard.writeText()` sin esperar la promesa y muestra éxito inmediatamente. Si el navegador rechaza el permiso, la UI afirma algo falso y la promesa puede generar un `unhandledrejection`. `LogsComponent` sí espera la promesa, pero mantiene una segunda implementación que usa `document.execCommand('copy')` sin comprobar su resultado ni limpiar el `textarea` ante excepción. Los diccionarios de Hogar ya tienen feedback de éxito, no de fallo; Logs ya distingue fallo.

**Conducta esperada:** extraer una única operación de copia compartida. Si existe Clipboard API, solo resolverá cuando `writeText` confirme; rechazo se propaga sin éxito falso. En contextos sin esa API, el fallback legacy debe resolver únicamente si `execCommand('copy')` devuelve `true`, y retirar siempre el `textarea`. Hogar informa el fallo de forma localizada en español e inglés y mantiene visible el enlace para copiar manualmente; Logs conserva sus feedbacks actuales y no genera `pageerror`/rechazos sin manejar.

- [x] Escribir primero unitarias de la utilidad compartida: éxito/rechazo de Clipboard API, API no disponible + fallback true/false/throw y limpieza del DOM; reproducir los feedbacks incorrectos de Hogar y Logs antes de implementar.
- [x] Playwright real aislada Chromium/Pixel 5: simular permiso de portapapeles rechazado en Household y Logs; verificar error localizado, enlace conservado, sin éxito simultáneo, `pageerror` ni `unhandledrejection`.
- [x] Confirmar Household en ES/EN y anchos 320, 393 y 1440 px sin desbordamiento; capturas sintéticas de error en PC/móvil guardadas e inspeccionadas.
- [x] Alcanzar ≥70 % de statements/branches/functions/lines de cada fuente de producción tocada; ejecutar suites unitarias focales, E2E real aislada, typecheck, build, formato y `git diff --check`, sin bajar el gate global. Prettier pasa en los archivos focales; `logs.component.ts` ya estaba sin formato en HEAD y el diff de formatearlo completo sería ajeno a esta unidad, así que solo se verificó el estilo de las líneas cambiadas.
- [x] Mantener abierta la casilla amplia `/household` y registrar comandos/resultados, artefactos y rollback exacto de esta unidad.

**TDD rojo (2026-10-02):** antes del cambio, Karma focal ejecutó 18 casos y reprodujo 2 fallos: Household mostraba éxito sin esperar una promesa de escritura aún pendiente; Logs anunciaba éxito aunque `document.execCommand('copy')` devolvía `false`. La nueva unidad comparte la misma reproducción a ambos consumidores; no se ha afirmado un rojo E2E previo al cambio.

**Evidencia QA-HOUSEHOLD.CLIPBOARD.1 (2026-10-02):** Karma focal del servicio y ambos consumidores ejecutó **24/24**; cobertura por fuente: `ClipboardService` **100/100/100/100 %**, `HouseholdComponent` **89,77/95,65/78,38/89,77 %** y `LogsComponent` **96,47/88,10/94,44/96,47 %** (S/B/F/L). La orden focal con coverage sale 1 por el gate existente de 80 % aplicado al subconjunto de specs (agregado 47,86/25,80/42,46/50,15 %); no se cambió ni rebajó el gate. La suite frontend completa ejecutó **870/870**, con cobertura agregada **76,58/63,69/74,77/78,15 % S/B/F/L**, bajo el 80 % existente y con branches bajo el mínimo general solicitado de 70 %. Typecheck `node frontend/node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit` y `frontend: npm run build:prod` pasan; build conserva warnings previos de budget/imports/tipos opcionales. Playwright real aislada con SQLite/puertos/semilla propios y rate limit activo: **2/2** (Chromium + Pixel 5); comprueba feedback ES/EN, rechazo en Logs, enlace conservado, 320/393/1440 px, sin overflow, `pageerror` ni `unhandledrejection`. El primer intento E2E expiró esperando el nombre accesible inglés incorrecto (`Copy all`); se corrigió al texto real `Copy everything`, sin cambio de producto. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-household-clipboard-errors-qa-hogaria-e2e-iKLvxM/{chromium,mobile-chrome}/household-copy-error.png`. Prettier pasa en archivos focales; la comprobación de `logs.component.ts` falla también sobre el archivo original de HEAD por formato previo (reformatearlo completo añadiría 340 líneas y quitaría 288 ajenas al cambio); el código modificado mantiene formato. `git diff --check` pasa. El barrido general `/household` sigue abierto.

**Rollback:** revertir la unidad atómica que agrega el servicio compartido de clipboard, su cableado de Household/Logs, traducción de fallo, pruebas y esta sección. No cambia datos persistidos ni contratos HTTP.

### QA-HOUSEHOLD.UI-SURFACE.1 · revalidación integral de Hogar

**Fuente revalidada (2026-10-08):** `HouseholdComponent` mantiene estados sin hogar, pestañas de Hogar/Miembros/Permisos/Ajustes, enlace de invitación, creación/unión y salida; `household-tabs.spec.ts` comprueba URL, historial, roles y autorización. Las regresiones vigentes añaden errores/reintentos de creación, unión, compartir, regeneración y salida, clipboard, y hogar secundario. Se evitó sobrescribir las capturas previas de `household-tabs` añadiendo `E2E_SCREENSHOT_DIR` configurable a su helper; sin esa variable conserva su destino histórico.

- [x] Cubrir en Playwright creación, unión válida/incorrecta, invitación copiar/regenerar, miembros/roles, permisos compartidos, salida, múltiples hogares y estado sin hogar.
- [x] Ejecutar esas rutas en Chromium y Pixel 5 con rate limit activo, SQLite/puertos/semilla aislados y cleanup; comprobar límites responsive, tabs/URL/historial, errores y reintentos.
- [x] Guardar capturas sintéticas en carpeta única ignorada por Git e inspeccionar PC y móvil para Hogar y Permisos; preservar intactos los artefactos previos.

**Evidencia (2026-10-08):** en PowerShell, `$env:E2E_RATE_LIMIT='on'`, `$env:E2E_CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'` y `$env:E2E_SCREENSHOT_DIR='.e2e-screenshots/qa-household-revalidation-35fb7c17dd3b470cb37ad7815cde2f6e'`; después `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/household.spec.ts tests/e2e/household-action-ack.spec.ts tests/e2e/household-clipboard-errors.spec.ts tests/e2e/household-icon-consistency.spec.ts tests/e2e/household-tabs.spec.ts tests/e2e/multi-household-switcher.spec.ts --reporter=dot` — **30/30** en **2 min**, runner confirmó limpieza de SQLite/puertos/semillas. La captura de Hogar escritorio, Hogar móvil, Permisos móvil y estado sin hogar móvil se inspeccionó; no se cambió UI. Capturas actuales: `.e2e-screenshots/qa-household-revalidation-35fb7c17dd3b470cb37ad7815cde2f6e/household-tabs/{chromium,mobile-chrome}/home.png` y `.../mobile-chrome/permissions.png`; la ruta completa está verificada como ignorada por `.gitignore`. `household-tabs.spec.ts` también pasa bajo `pnpm run typecheck:e2e` y Prettier focal.

La evidencia de QA-HOUSEHOLD.API-SURFACE.1 y QA-HOUSEHOLD.CLIPBOARD.1 dejó abierta la casilla general porque cada una declaraba explícitamente no sustituir el recorrido completo de UI; esta revalidación posterior cubre ese alcance y cierra ahora `/household`.

### QA-ONBOARDING.PANTRY-LINK.1 · Mantener Pantry como fuente de verdad de utensilios

**Fuente revalidada antes de implementar (2026-10-01):** `HOGARIA-SPEC.md` §8c establece paridad: los utensilios se editan en Pantry y el tour solo enlaza. §12C añadió el paso de horarios y §12E documenta el contador `Paso 3 de 6`; prevalece sobre el conteo inicial de cinco de §8b. `ONBOARDING_STEPS` actual contiene `profile, allergies, tastes, goal, meals, kitchen`, como requiere el contrato posterior. Sin embargo, la plantilla actual de `kitchen` renderiza checkboxes que llaman `toggleUtensil()` → `PantryService.updateUtensil()`, mutando inventario desde el tour. La conducta esperada es conservar seis pasos y convertir `kitchen` en un paso informativo con enlace accesible a `/pantry?tab=utensils`; las modificaciones de disponibilidad se hacen allí.

- [x] Añadir primero una E2E aislada con cuenta y utensilio sintéticos que reproduzca una escritura `PATCH` al marcarlo dentro del paso `kitchen`; no tocar DB/servidor normal ni usar proveedor IA.
- [x] El paso `kitchen` no debe presentar controles que muten disponibilidad; el enlace lleva a Pantry › Utensilios, persiste antes las respuestas previas del tour y conserva la acción editable en Pantry.
- [x] Afirmar que el tour no envía cambios de utensilios, que el enlace sí navega a `?tab=utensils`, y que la edición en Pantry persiste después de volver/recargar.
- [x] Mantener el total/orden de seis pasos, siguiente/anterior/saltar paso y global, y entrada de teclado; errores de guardado no deben perder el progreso anterior.
- [x] Verificar en ES/EN, Playwright real Chromium/Pixel 5, 320×568, 393×851, 568×320, 1440×900 y límites del breakpoint actual 559/560/561 px. Revisar overflow, foco/labels, teclado y CTA táctiles.
- [x] Añadir cobertura unitaria/integración focal ≥70 % S/B/F/L sin reducir gates; ejecutar typecheck/build y el gate frontend vigente, registrando si falla por deuda global.
- [x] Guardar e inspeccionar capturas sintéticas PC y móvil; no incluir datos personales ni credenciales. Rollback: revertir únicamente la unidad del paso `kitchen` y sus pruebas/evidencia.

**TDD rojo → verde (2026-10-01):** la primera E2E aislada confirmó que el tour exponía **8** `.utensil-card__check`; en la fuente baseline, su `change` llamaba a `toggleUtensil()` → `PantryService.updateUtensil()`. La E2E ahora conserva una sonda que, si reaparece ese control, lo marca y exige el `PATCH` real antes de fallar la aserción de cero controles. La nueva matriz reveló además un overflow móvil reproducible a 320 px (`document.scrollWidth=359`; el botón Guardar terminaba en x=359), corregido refloweando la navegación del pie hasta 560 px. El primer intento de activar el enlace por teclado esperó 45 s sin el `PATCH` de progreso: `onCardKeydown()` consumía Enter en un `<a>`; se preservó el comportamiento nativo para enlaces/roles `link`. La E2E de Pantry confirmó que la UI real usa `role=checkbox` en botones, no inputs nativos; el recorrido actualizado opera el control accesible de la fila.

**Verificación focal y E2E (2026-10-01):** `OnboardingComponent` Karma **11/11**; cobertura focal **97,77/79,16/96,42/98,76 % S/B/F/L** (≥70 en cada métrica). `tsc -p tsconfig.e2e.json --noEmit`, `node scripts/check-ui.mjs` (186 ficheros, 20 reglas) y `ng build --configuration production` pasan; el build conserva warnings de budget/imports/diagnósticos preexistentes en otras pantallas. Playwright real y aislado (runner crea SQLite, puertos y semilla sintéticos bajo OS temp, `E2E_RATE_LIMIT=on`, sin proveedor IA): `onboarding-pantry-parity.spec.ts` **2/2** entre Chromium y Pixel 5, incluidos EN, 320×568, 393×851, 559/560/561, 568×320 y 1440×900; comprueba scroll/límites, targets táctiles de 44 px con tolerancia de subpíxel, foco visible, Enter, cero errores de página, persistencia de perfil/utensilio y recarga. `onboarding.spec.ts` pasa **6/6** en Chromium y **6/6** en Pixel 5.

**Gate global y capturas:** la suite frontend ejecuta **768/768**, pero el agregado queda en **74,54/64,57/72,67/76,28 % S/B/F/L**, inferior a los umbrales `80/80/80/80` declarados en `frontend/karma.conf.js` (la orden terminó con exit 0, limitación del gate a registrar; no se bajó ningún umbral y QA-04c sigue abierto). Capturas sintéticas PC/móvil inspeccionadas en `.e2e-screenshots/qa-onboarding-pantry-link-final/` (`onboarding-kitchen-chromium-desktop.png`, `onboarding-kitchen-mobile-chrome-mobile.png`); artefactos ignorados por Git. El diff de la unidad supera 400 líneas por el E2E responsive y cobertura focal nuevos; `size:exception` documentada: es un único flujo vertical Cocina→Despensa y separarlo dejaría implementación o validación de esa misma conducta fuera del commit. Rollback: `frontend/src/app/features/onboarding/onboarding.component.ts`, `frontend/src/app/features/onboarding/onboarding.component.spec.ts`, `frontend/src/app/core/i18n/dict/onboarding.ts`, `tests/e2e/onboarding.spec.ts`, `tests/e2e/onboarding-pantry-parity.spec.ts` y esta sección de `APP-QA-SPEC.md`.

### Cocina, despensa y planificación

- [x] `/pantry`: ingredientes/utensilios, búsqueda, filtro/categoría, orden, paginar/seleccionar, lote, cantidad/unidad, alta/edición/borrado y sugerencias; estados vacío, sin resultados, error y recarga. Evidencia QA-PANTRY.ROOT-ROUTE.1.
- [x] `/pantry/caducidades`: fechas ausentes/pasadas/próximas, orden por caducidad/nombre/duración, estado vacío frente a error/reintento y navegación de vuelta a `/pantry`; evidencia en QA-PANTRY.2 y QA-PANTRY.EXPIRY.ROUTE.1. §12ak no define filtros ni enlace a la ficha.
- [x] `/pantry/inventario/:id` y `/editar`: ficha válida/no encontrada, atributos, historial/precios, editar/cancelar/guardar, aliases/código de barras, error y borrar observación con confirmación; evidencia QA-PANTRY.ITEM.ROUTE.1.
- [x] `/pantry/categories[/:id]` y `/pantry/products[/:id]`: buscar/filtrar/ordenar, alta/edición, padres/aliases, selección y acciones por lote, protección de registros en uso, validación y confirmaciones; evidencia QA-PANTRY.MANAGERS.ROUTES.1.
- [x] `/pantry/catalogo`: búsqueda, pasillos/categorías, query string, filtros/paginación, alta individual y por lote, ya existente/en inventario, quitar con confirmación y persistencia al volver; evidencia QA-PANTRY.CATALOG.ROUTE.1.
- [x] `/recipes`: filtros/tabs, favoritos, detalle, cocinar, temporizadores y vuelta; generar 1/3 recetas, ingredientes/utensilios, restricciones/dificultad/raciones/detalle, error/vacío, guardar y cancelar. Evidencia QA-RECIPES.ROUTES.1.
- [x] `/calendar`: día/semana/mes, anterior/siguiente/hoy/salto a fecha, filtros, recarga/error; alta/edición/borrado de comidas y eventos, recurrencia/instancia, invitados, horarios, completado y confirmación. Evidencia QA-CALENDAR.ROUTES.1.
- [x] Planificación IA desde calendario: objetivo/fechas/tipos de comida/exclusiones/preferencias, loading/error/reintento, aplicar o cancelar y cambios persistidos sin duplicar comidas.

**Cierre funcional (2026-10-09):** `QA-CALENDAR.PLAN-WEEK-E2E.1` verifica la generación inicial, objetivos,
fechas/tipos/exclusiones, estado de carga, error recuperable, reintento e idempotencia; `QA-PLANNER.GOALS-AND-PARTIAL-REPLAN.1`
verifica la propuesta editable, aplicar/cancelar, persistencia atómica y aislamiento del hogar. E2E repetibles usan
proveedor sintético, no WebAPI real ni tickets. CI `37966484202` incluyó estas pruebas y pasó **9/9** jobs en
`0af4741`; el smoke real de tickets permanece separado y aplazado hasta el final.

#### QA-CALENDAR.PLAN-WEEK-E2E.1 · generación semanal inicial con proveedor sintético

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §8.D define la selección real de tipos de comida, el periodo semanal, el conteo de comidas creadas/omitidas y que una selección vacía equivale a solicitar todas las comidas permitidas; §12aq define objetivos plurales/custom, preferencias de participantes y la confirmación previa de la replanificación parcial. La generación semanal inicial no tiene vista previa: el servidor persiste y reporta los espacios creados/omitidos. La cancelación antes de generar no debe llamar al proveedor (ya cubierta en `ai-goal.spec.ts`). La aplicación/cancelación de una propuesta de replanificación parcial se valida por separado en `QA-PLANNER.GOALS-AND-PARTIAL-REPLAN.1`.

**Brecha de evidencia:** `ai-goal.spec.ts` cubre el payload plural y cancelación, pero intercepta el endpoint de planificación; `ai-weekly-participants.spec.ts` usa servidor proveedor sintético y persiste una comida, pero no comprueba selección de fechas/tipos, fallo recuperable, bloqueo mientras se procesa ni repetición idempotente. Esta unidad añade solo cobertura E2E contra app/SQLite aisladas y proveedor loopback sintético; no llama a IA/WebAPI reales ni usa tickets de usuario.

- [x] Añadir primero un E2E que valide periodo/tipos/objetivos/preferencias seleccionados y `response_format` JSON Schema estricto en la solicitud del servidor al proveedor sintético.
- [x] Mantener un request en curso y verificar estado accesible/submit deshabilitado; simular fallo de proveedor sin persistencia, mantener el diálogo y permitir retry manual.
- [x] En el retry exitoso, verificar que solo se guardan los tipos elegidos en las fechas solicitadas; repetir generación y comprobar `created=0`, comidas omitidas y ninguna fila duplicada.
- [x] Repetir la E2E en Chromium escritorio y Pixel 5 con DB/puertos/semilla temporales, rate limit activo y cleanup; no sobrescribir capturas preexistentes. Confirmar typecheck/formato, gates aplicables, comandos y limitaciones antes de cerrar esta unidad.

**Evidencia focal y cierre CI (2026-10-09):** el E2E nuevo configura un proveedor loopback
sintético, `retryAttempts: 0` y concurrencia `0` (según `HOGARIA-SPEC.md` §12an, para que el error de
esta operación síncrona vuelva al modal; concurrencia positiva abre la ventana de retry del gestor de
cola). La semana `2026-10-19`–`2026-10-25` pide solo `lunch`; el request conserva los objetivos `weight-loss`
y `custom`/texto, y miembros activos. El proveedor recibe `response_format.type=json_schema`, `strict=true`
y un schema dinámico que solo permite `lunch`. Durante la respuesta lenta, el botón queda disabled y con
`aria-busy`; un 503 no guarda comidas y deja el modal listo para reintento manual. El siguiente envío crea
una comida y el tercero informa `created=0, skipped=1`; GET al rango confirma que hay exactamente una
comida `lunch` en la fecha pedida.

El grupo aislado de `ai-goal.spec.ts` + `calendar-plan-week.spec.ts` pasó **12/12** en Chromium y Pixel 5;
`ai-weekly-participants.spec.ts` pasó **2/2** en los mismos proyectos, con proveedor loopback y datos
sintéticos: selección/exclusión de miembros, alergia de invitado, notas y privacidad del prompt. Se cambió
su carpeta fija de capturas a `.e2e-screenshots/ai-weekly-participants-${process.pid}` antes de repetirla,
sin sobrescribir las capturas de 2026-10-06; las nuevas capturas PC/móvil se inspeccionaron. `calendar-replan.spec.ts`
pasó **6/6** con provider stub: edición/aplicación de propuestas y fallo sin cambios parciales; capturas
PC/móvil nuevas en `.e2e-screenshots/calendar-replan-{58688,11508}/` inspeccionadas. Cancelar la selección
antes de pedir el plan, sin llamadas ni persistencia, lo cubre `ai-goal.spec.ts`. Comandos focales:

```powershell
$env:E2E_RATE_LIMIT='on'; $env:E2E_CHROME_BIN='C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/ai-goal.spec.ts tests/e2e/calendar-plan-week.spec.ts --reporter=line
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/ai-weekly-participants.spec.ts --reporter=line
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/calendar-replan.spec.ts --reporter=line
```

`pnpm run typecheck:e2e` y Prettier focal pasan. Runner inspeccionado antes de iniciar: fija `DATABASE_PATH`
a `hogaria.sqlite` en su `E2E_RUN_DIR` bajo `%TEMP%`, semilla/puertos únicos y cleanup propio; rate limit
activo. No se llamó a IA/WebAPI reales ni se usaron tickets. Cobertura de producción N/A (solo tests y ruta
de capturas); ninguna UI de producto cambió. El commit de pruebas `cf9b2a7992f311b7e8516ca6bf310aeceff9af48`
pasó CI #651 (**9/9 jobs**, run `37953362743`: typecheck, servidor, cuatro shards E2E, full-stack E2E y
build; todos en verde). Hooks pre-commit y pre-push pasaron sin omisiones antes del push; los detalles
están en el historial del commit. Capturas existentes no se sobrescribieron. Rollback: revertir el test
`tests/e2e/calendar-plan-week.spec.ts`, su aislamiento de capturas en
`tests/e2e/ai-weekly-participants.spec.ts` y esta sección de spec; no hay cambio de producto.

**Evidencia QA-CALENDAR.ROUTES.1 (2026-10-09):** la barrida aislada de las 12 specs de Calendario
pasó **95 pruebas**, omitió **3** por condiciones existentes de proyecto y tuvo **0 fallos** (6,9 min;
Chromium + Pixel 5). Los casos cubren semana/día/mes, navegación y salto/URL, filtros, carga/error,
comidas y eventos, invitaciones, recurrencia/instancia, horarios, confirmación y completado; los
subcasos recientes de error de rango pasan **2/2** y completado/deshacer **4/4**. Runner con rate limit,
SQLite/puertos/semilla temporales y cleanup; IA solo simulada, sin datos reales. Capturas PC/móvil se
registran e inspeccionan en las unidades visuales/funcionales respectivas; este cierre no cambia UI.
Hooks sin bypass, build/typecheck/check-ui y Karma pasan en el pre-push de `53a8c49`; CI #648
(`37948562809`) pasó **9/9** jobs para el mismo código. La planificación IA se cerró después con
`QA-CALENDAR.PLAN-WEEK-E2E.1` y `QA-PLANNER.GOALS-AND-PARTIAL-REPLAN.1`.

**Evidencia QA-RECIPES.ROUTES.1 (2026-10-09):** el grupo Playwright aislado
de 15 archivos de Recetas/Dashboard terminó **94 pasadas, 2 skips intencionales, 0 fallos** en 5,3 min.
Comando reproducible (SQLite/puertos/semilla temporales del runner):

```powershell
$env:E2E_RATE_LIMIT='on'
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only `
  tests/e2e/dashboard-recipe-links.spec.ts tests/e2e/recipe-actions-mobile.spec.ts `
  tests/e2e/recipe-book-filter-modal.spec.ts tests/e2e/recipe-book.spec.ts `
  tests/e2e/recipe-card-geometry.spec.ts tests/e2e/recipe-cook-action.spec.ts `
  tests/e2e/recipe-edit.spec.ts tests/e2e/recipe-favorites.spec.ts `
  tests/e2e/recipe-full-detail.spec.ts tests/e2e/recipe-pantry-iconography.spec.ts `
  tests/e2e/recipe-step-photo-retry.spec.ts tests/e2e/recipe-step-photos-real.spec.ts `
  tests/e2e/recipe-timer-controls.spec.ts tests/e2e/recipes-ai-generation.spec.ts `
  tests/e2e/recipes.spec.ts --reporter=line
```

Incluye filtros/libro, favoritos, edición/guardar/cancelar, detalle, cocinar/confirmación, temporizador,
mobile, deep links y generación/error/reintento IA simulada. Los dos skips son la prueba de fotos reales
contra Wikimedia, opt-in por proyecto; no se habilitó. El primer barrido dio 92 pasadas y dos fallos
idénticos: el test de portada observaba una tarjeta de la lista anterior antes de terminar la navegación
del tab. Se reprodujo la retirada temporal de la lista; el test ahora espera `collection=book`, la
respuesta `catalogOnly=true` y el fin de carga antes de desplazar la tarjeta. Repetición focal Chromium/
Pixel 5: **2/2**, ambas verifican portada en tarjeta y detalle. Comando focal:

```powershell
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --grep='sirve la portada del libro desde un fixture local' tests/e2e/recipe-book.spec.ts --reporter=line
```

Runner con rate limit, SQLite/puertos/semilla temporales; no hubo IA real ni escritura a datos normales.
`pnpm run typecheck:e2e` y
`pnpm run check:ui` pasan (212 ficheros, 21 reglas). No cambia código de producción; coverage N/A.
Los hooks pre-commit/pre-push se ejecutaron sin bypass; el pre-push en `06ca504` aprobó formato,
`check:ui`, build, typecheck, suite de configuración, Karma y server tests. El fix de espera en
`tests/e2e/recipe-book.spec.ts` (`5d88b55`) está publicado; el CI #648 (`37948562809`) del head
`53a8c49` pasó **9/9** jobs, incluidos los shards E2E. La ruta queda cerrada; no hubo IA real. Rollback:
revertir la espera del catálogo en `tests/e2e/recipe-book.spec.ts` y retirar esta evidencia; no hay
cambio productivo.

**Evidencia QA-PANTRY.ROOT-ROUTE.1 (2026-10-09):** Playwright aislado con rate limit activo —`$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR=Join-Path $env:TEMP 'hogaria-pantry-route-rerun-20261009'; node scripts/run-isolated-playwright.mjs --workers=2 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/pantry.spec.ts tests/e2e/utensils.spec.ts tests/e2e/pantry-root-crud.spec.ts tests/e2e/pantry-inventory-load-error.spec.ts --reporter=line`— pasó **48 pruebas**; 6 skips son intencionales: los filtros/orden del encabezado solo se ejercitan en Chromium y la hoja móvil solo en Pixel 5. Cubre CRUD del inventario, búsqueda/categoría/columna, orden/paginación/selección/lote/stepper/sugerencias, controles de utensilios, sin resultados, error/reintento y recarga. La E2E full-stack de estado vacío —`$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR=Join-Path $env:TEMP 'hogaria-pantry-empty-fullstack-20261009'; pnpm run test:e2e:full-stack -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/full-stack/pantry-empty-state.spec.ts --reporter=line`— pasó **2/2** sobre build de producción y SQLite/puertos sintéticos; runner y datos temporales limpiados. Cancelar el alta no crea datos. Capturas sintéticas PC/móvil inspeccionadas: `%TEMP%\hogaria-pantry-empty-fullstack-20261009\chromium\pantry-empty-1440x900.png` y `%TEMP%\hogaria-pantry-empty-fullstack-20261009\mobile-chrome\pantry-empty-393x851.png`; también diálogo/error/reintento/recuperación en `%TEMP%\hogaria-pantry-route-rerun-20261009\{chromium,mobile-chrome}\`. Coverage N/A: no cambió código de producción. Rollback: retirar esta casilla/evidencia; no hay cambios productivos.

**Evidencia QA-PANTRY.MANAGERS.ROUTES.1 (2026-10-09):**

- `$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR=Join-Path $env:TEMP 'hogaria-pantry-managers-verified-20261009'; node scripts/run-isolated-playwright.mjs --workers=2 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/pantry-managers.spec.ts tests/e2e/pantry-category-parent-link.spec.ts tests/e2e/pantry-product-deep-link.spec.ts tests/e2e/pantry-manager-action-geometry.spec.ts --reporter=line`: **33 pasaron, 1 omitida**. El único skip intencional es el menú de filtro del encabezado, que no existe en el reflujo móvil. Se añadió orden por nombre en ambas rutas, tanto encabezado de escritorio como hoja móvil.
- `$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR=Join-Path $env:TEMP 'hogaria-pantry-manager-fullstack-rerun-20261009'; pnpm run test:e2e:full-stack -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/full-stack/pantry-category-color-picker.spec.ts tests/e2e/full-stack/pantry-manager-alias-clash.spec.ts tests/e2e/full-stack/pantry-manager-record-crud.spec.ts --reporter=line`: **8/8** sobre build de producción y DB temporal; cubre picker, alias/409, alta-edición-borrado, persistencia, protecciones y confirmaciones.

El test del menú espera HTTP 201 y la lista antes de filtrar para evitar una carrera de sincronización de la prueba; no se detectó defecto de producción. Coverage N/A para la ampliación E2E-only. Capturas sintéticas PC/móvil del picker inspeccionadas en `.e2e-screenshots/qa-pantry-color-picker-20261008/{chromium/category-color-picker-1440x900.png,mobile-chrome/category-color-picker-393x851.png}`; el popup nativo del sistema no es automatizable con este harness y Safari no se declara validado. Rollback: retirar el test de orden/sincronización y esta casilla/evidencia; no hay cambios productivos.

**Evidencia QA-PANTRY.CATALOG.ROUTE.1 (2026-10-09):** `$env:E2E_RATE_LIMIT='on'; node scripts/run-isolated-playwright.mjs --workers=2 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/pantry-catalog.spec.ts --reporter=line` pasó **16/16** en Chromium y Pixel 5; SQLite, puertos y semilla fueron temporales y el runner confirmó cleanup. La cobertura de ruta verifica catálogo completo y páginas 1→2→1, búsqueda, pasillos/categorías y query al entrar directo, alta individual/lote sin duplicar, producto ya en casa, quitar con confirmación, persistencia al volver y navegación al gestor correspondiente. Coverage N/A: solo se añadió E2E de paginación, sin cambios productivos ni de presentación. Rollback: retirar el test de paginación y esta casilla/evidencia; no hay cambios productivos.

#### QA-CALENDAR.MEAL-COMPLETION.1 · completar y deshacer una comida

**Fuente revalidada (2026-10-09):** la casilla `/calendar` exige comprobar el estado completado. `CalendarService.toggleComplete()` ya implementa actualización optimista, PATCH y rollback; `CalendarComponent.toggleMeal()` lo invoca, pero `CalendarTimelineComponent` nunca emite su `@Output toggleMeal`. `CalendarEventComponent` tiene acciones de completar, aunque sus únicos usos actuales son `mode="row"`, donde esas acciones están ocultas y tampoco se enlaza el output. No se encontró una E2E que complete/deshaga una comida desde la interfaz. El modal de detalle/edición sí es común a las vistas de día, semana, mes y agenda, así que la acción se expondrá allí con los botones compartidos de 44 px para evitar controles diminutos o anidados dentro de las tarjetas.

**Contrato:** al abrir una comida ya guardada desde cualquiera de las vistas día/semana/mes/agenda, su modal expone un control accesible «Marcar como hecha» o «Quitar de hechas», con estado `aria-pressed` correcto y objetivo táctil ≥44×44 px. Activarlo actualiza de inmediato el estado visual/resumen y persiste mediante el PATCH existente; si falla, se revierte el estado sin cerrar ni descartar el borrador y se puede reintentar. Guardar/cancelar edición no debe cambiar la completitud; completar/deshacer no elimina ni duplica comidas. El borrado conserva su confirmación actual. Fixtures y API SQLite temporales; no proveedor IA ni datos personales.

**TDD y hallazgo visual (2026-10-09):** en worktree detached del baseline `1eadbe5`, con solo el nuevo
spec E2E copiado y SQLite/puerto temporales, Chromium falló 1/1 exactamente porque el editor no ofrecía
«Marcar como hecha» (`toBeVisible`: elemento inexistente). Una ejecución E2E real anterior al ajuste
CSS midió en 393 px que el footer de borrar/cancelar/guardar excedía el borde del diálogo en 14 px
(derecho 392 frente al límite 378), aunque el documento no tenía scroll horizontal. Se amplió el
breakpoint responsive a 480 px y la suite final confirma que los tres botones caben a 320/393/479/480/
481 y 1440 px.

**Evidencia verde (2026-10-09):** Karma focal del servicio/componente de calendario **74/74**. El gate
Karma completo pasó **1245/1245**, sin rebajar umbral: **91.52/82.45/90.08/92.96 %** S/B/F/L. Cobertura
focal del código: `calendar.component.ts` **88.09/80.60/81.56/90.46 %**; el componente nuevo
`calendar-meal-completion.component.ts`, **100/100/100/100 %**; `calendar.service.ts` (sin cambios de
producción), **95.94/80.95/92.13/95.95 %**. El Playwright real aislado pasó **4/4** (Chromium y Pixel 5):
vistas día/semana/mes/agenda; PATCH retenido, estado optimista, fallo 503 y rollback, retry 200,
persistencia tras reload, Enter/foco visible, botón ≥44×44, no duplicación y límites responsive 320,
393, 479/480/481 y 1440 px. El runner confirmó cleanup de DB/puertos/artefactos temporales.
Capturas sintéticas limpias (se descarta el toast efímero para que no tape el título del modal):
`.e2e-screenshots/qa-calendar-meal-completion/chromium.png` y `mobile-chrome.png`, ambas revisadas.
`pnpm run typecheck:e2e`, `pnpm run check:ui` (212 ficheros/21 reglas), Prettier focal,
`pnpm run build` (server+client) y `git diff --check` pasaron; el build conserva warnings preexistentes
de presupuestos/imports que no pertenecen a esta unidad. El gate global se ejecutó con coverage en
`%TEMP%`, sin sobrescribir `frontend/coverage` preexistente.

**Revalidación de estabilidad (2026-10-10):** CI `38024229940` tuvo un timeout transitorio de PATCH
al completar una comida; esta regresión no se reprodujo en la repetición aislada:

```powershell
$env:E2E_RATE_LIMIT='on'
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --repeat-each=2 --forbid-only tests/e2e/calendar-completion.spec.ts --reporter=line
```

Pasó **8/8**; cada ejecución usó DB, puertos y semilla temporales, con cleanup confirmado.

- [x] Escribir primero la E2E de regresión, confirmar rojo en baseline por ausencia del control y cubrir todas las vistas con una comida sintética; red 1/1 en baseline `1eadbe5`, control ausente.
- [x] Añadir un control compartido de completado dentro del editor de comida; probar componente/servicio en éxito, rollback, reintento, desmarcado y repetición, con ≥70 % S/B/F/L por archivo nuevo o modificado dentro del alcance.
- [x] Probar en Chromium y Pixel 5: PATCH retenido/fallido y recuperación, estado optimista, persistencia tras reload, completar y deshacer, teclado/foco/nombre accesible, 44×44 px; medir que todos los botones de edición caben dentro del diálogo y no hay overflow a 320×568, 393×851, 479/480/481 px y 1440×900.
- [x] Guardar e inspeccionar capturas sintéticas comparables de PC/móvil; ejecutar typecheck E2E, Karma global sin rebajar el gate, `check:ui`, Prettier, build y `git diff --check`.
- [x] Ejecutar todos los hooks sin bypass; hacer commit atómico, push y esperar CI verde en el SHA final. El commit `bc9281e` se incluye en `7c887fb`; pre-push completo pasó y el CI `37928201856` terminó verde (9/9 jobs).

**Rollback:** retirar el control/modal, el componente y sus pruebas; conservar el comportamiento actual del servicio, y revertir únicamente esta subunidad.

### Compra, tickets, proveedores y observabilidad

- [x] `/shopping`: crear/renombrar/borrar lista, tienda, tabs abiertas/completadas, búsqueda/filtros/orden/páginas, completar/reabrir y sugerencias.

**Barrido integrado (2026-10-09):** con `$env:E2E_RATE_LIMIT='on'` se ejecutaron en Chromium y Pixel 5 las doce
specs de Compra: `shopping-ai-recovery`, `shopping-lists`, `shopping-primary-geometry`, `shopping-round10`,
`shopping-round6`, `shopping-sugerencias`, `shopping-suggested`, `shopping-tray-lifecycle`, `shopping-tray-rename`,
`shopping-tray-store-filter`, `shopping-unit-recents` y `shopping-view-order`; comando reproducible: `pnpm run test:e2e --
--workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-ai-recovery.spec.ts
tests/e2e/shopping-lists.spec.ts tests/e2e/shopping-primary-geometry.spec.ts tests/e2e/shopping-round10.spec.ts
tests/e2e/shopping-round6.spec.ts tests/e2e/shopping-sugerencias.spec.ts tests/e2e/shopping-suggested.spec.ts
tests/e2e/shopping-tray-lifecycle.spec.ts tests/e2e/shopping-tray-rename.spec.ts
tests/e2e/shopping-tray-store-filter.spec.ts tests/e2e/shopping-unit-recents.spec.ts
tests/e2e/shopping-view-order.spec.ts --reporter=line`. Resultado: **98 pasaron, 4 omitidas intencionalmente** por
especificidad de proyecto/viewport en `shopping-round6.spec.ts`, 0 fallos (6,9 min). El runner confirmó cleanup de
SQLite, puertos y procesos aislados; el test de recuperación de foto responde `AI_NOT_CONFIGURED` sin llamar a
proveedores ni crear líneas. CI `37966484202` validó HEAD `0af4741` con **9/9** jobs verdes; no hubo cambio de
producto en este barrido.

#### QA-SHOPPING.TRAY-LIFECYCLE.1 · completar, reabrir y borrar desde la bandeja

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §8e define `/shopping` como bandeja con alta,
apertura, finalización, borrado y pestaña de historial `?tab=hechas`; borrar una lista elimina sus líneas,
no admite deshacer y exige confirmación mediante `ConfirmService`, nunca `window.confirm`. El template de
`ShoppingListsComponent` expone acción de terminar/reabrir y borrar por fila; el método `archive()` cambia
estado con opción de deshacer y `remove()` confirma antes de llamar a `ShoppingService.deleteList()`. Los
tests de componente verifican ramas de estado/confirmación con spies, y `shopping-lists.spec.ts` finaliza
una compra desde el detalle y visita el historial, pero no se encontró E2E para reabrir/borrar desde la fila
de la bandeja. Esta unidad cubrió solo esos caminos reales; el barrido integrado y las unidades de filtro y
sugerencias posteriores cerraron después la casilla general.

**Contrato de aceptación:** con listas sintéticas en SQLite aislada, terminar desde la fila quita la lista de
activas; al mostrar Terminadas aparece en el historial. Reabrir desde la fila la devuelve a activas y persiste
tras recarga. Al volver a activas se elimina también el alias antiguo `tab`, para que `?tab=hechas` no revierta
la selección tras recargar. En borrar, Cancelar conserva la lista y sus líneas; confirmar elimina únicamente
esa lista y ambas vistas la mantienen ausente después de recargar. Las acciones tienen nombre accesible y el
borrado usa diálogo accesible propio, sin diálogo nativo. Si el servidor responde con error, no se muestra éxito
falso, la fila conserva el estado real y se puede reintentar.

**Hallazgos TDD:** antes del fix, `setStatus()` descartaba el resultado de completar y recargaba listas con
filtros por defecto incluso cuando fallaba el PATCH de reapertura; `archive()`/`remove()` anunciaban éxito
incondicionalmente. Además, `writeUrl()` fusionaba parámetros y dejaba `tab=hechas` obsoleto al elegir
«Activas», por lo que la recarga regresaba al historial. Las regresiones unitarias reprodujeron los tres
comportamientos; la E2E confirmó el estado final incorrecto tras recargar.

- [x] Revalidar §8e, template/métodos actuales y la brecha entre las pruebas unitarias y E2E de ruta.
- [x] Añadir primero regresión unitaria roja para los fallos de completar/reabrir/borrar y la pérdida del
      filtro/historial; devolver el resultado real, conservar el query y anunciar éxito solo tras confirmación.
- [x] Añadir E2E aislada de `/shopping` para terminar/reabrir, Cancelar/borrar y persistencia; validar diálogo/
      nombres accesibles, ausencia de `window.confirm`, fallo HTTP sin éxito falso y reintento recuperable.
- [x] Ejecutar Chromium desktop y Pixel 5 con rate limit activo, SQLite/puertos/semilla temporales y cleanup.
      Playwright real pasó **4/4**; se guardaron e inspeccionaron capturas sintéticas en
      `%TEMP%\hogaria-shop-tray-lifecycle-final-20261009\{chromium,mobile-chrome}`. La suite frontend pasó
      **1.278/1.278** con **92,17/83,45/90,92/93,59 % S/B/F/L** global. Por archivo: `shopping.service.ts`
      **97,24/87,92/100/99,46 %** y `shopping-lists.component.ts` **95,52/87,42/91,80/97,18 %**. Pasan
      `pnpm run typecheck:e2e`, `pnpm run check:ui` (212 ficheros/21 reglas), Prettier focal,
      `pnpm run build` y `git diff --check`; el build mantiene avisos preexistentes de budgets y componentes
      no pertenecientes a esta unidad.
- [x] Registrar commit/rollback, ejecutar hooks completos, publicar en la rama y confirmar CI verde para el
      SHA resultante. La unidad quedó en `98e27e4`; los hooks completos del push final pasaron y CI
      `37966484202` verificó el código incluido en `0af4741` (**9/9** jobs). Rollback focal: servicio,
      componente, sus regresiones/E2E y esta unidad; no retirar otros flujos de Compra ni cambios de tickets/IA.

**Limitación:** no se ejecutaron ni reenviaron tickets reales ni se llamó a proveedor de IA. Las pruebas usan
solo datos sintéticos y almacenamiento/puertos aislados; el smoke real pendiente de WebAPI queda pospuesto
hasta el final y requiere volver a preguntarlo al usuario.

`pnpm run lint:client` completó `check:ui` pero `ng lint` no pudo arrancar: el builder
`@angular-eslint/builder:lint` referenciado en `frontend/angular.json` no está declarado en
`frontend/package.json` ni disponible localmente. No se añadió una dependencia fuera de alcance.

#### QA-SHOPPING.TRAY-503.1 · error localizado al reabrir

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §8e define reabrir desde la bandeja por el mismo PATCH
de estado y la unidad `QA-SHOPPING.TRAY-LIFECYCLE.1` exige que un error no anuncie éxito, conserve la fila y
permita reintentar. El E2E `shopping-tray-lifecycle.spec.ts` simula 503 y espera el aviso accesible «Servicio no
disponible». Tras hacer silencioso el PATCH para que `ShoppingService` evite duplicar los avisos del interceptor,
`request()` muestra `errorMessage()` del cuerpo del servidor en vez de la traducción específica del 503; el run CI
`37963790615` falló precisamente porque no encontró el alert esperado (artifact `hogaria-run-4/junit.xml`).

**Conducta esperada:** un 503 de reapertura muestra una sola alerta accesible y traducida como «Servicio no
disponible», no expone el texto crudo del servidor ni genera el éxito de reapertura, y deja la fila en Terminadas;
al quitar el fallo, reabrir vuelve a funcionar. Los otros estados de error y el conflicto 409 mantienen su conducta.

- [x] Revalidar §8e, el E2E vigente, `ShoppingService.request()`, `SILENT_TOAST` y el resultado CI.
- [x] Añadir primero prueba unitaria roja del mapeo de 503 y conservar E2E que reproduce la fila/alerta/reintento.
- [x] Mapear 503 a `ui.servicio_no_disponible` en el único aviso del servicio, sin duplicarlo ni filtrar el cuerpo.
- [x] Ejecutar tests focales y E2E aislada de Chromium/Pixel 5 con rate limit, SQLite/puertos/semilla efímeros,
      cleanup y coverage focal ≥70 % S/B/F/L; revisar que no haya geometría ni flujo móvil alterado.
- [x] Registrar resultado, comandos y rollback; hooks completos, commit atómico, push y CI verde. Fix en
      `0af4741`; hooks completos y push pasaron, CI `37966484202` quedó verde (**9/9** jobs).

**Evidencia local (2026-10-09):** la regresión unitaria primero falló porque enviaba `synthetic unavailable`; tras
el mapeo localizado `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/core/services/shopping.service.spec.ts`
pasó **38/38**. El E2E aislado se ejecutó con `$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR="$env:TEMP\hogaria-tray-lifecycle-503-final-20261009"; pnpm run test:e2e -- tests/e2e/shopping-tray-lifecycle.spec.ts --grep "terminar y reabrir desde el historial conserva el estado tras recargar" --project=chromium --project=mobile-chrome`
y pasó **2/2** (Chromium/Pixel 5): una sola alerta 503, fila aún terminada, reintento correcto y cero
desbordamiento horizontal a 320×568/568×320. Las capturas sintéticas del aviso fueron inspeccionadas en
`%TEMP%\hogaria-tray-lifecycle-503-final-20261009\{chromium,mobile-chrome}\shopping-list-reopen-503.png`.
`pnpm run test:client:coverage` pasó **1285/1285**, global **92.22/83.54/90.97/93.64 % S/B/F/L**; `shopping.service.ts`
**97.25/88.67/100/99.46 %**. `pnpm run typecheck:e2e` pasó. Rollback focal: revertir el mapeo 503 y sus regresiones
unitaria/E2E, junto con esta subsección; no retirar otras conductas de Compra. Fix publicado en `0af4741`;
hooks completos y CI `37966484202` están verdes para el código final.

#### QA-SHOPPING.TRAY-503.ALERT-BOUNDS.1 · aviso sin recorte en móvil

**Fuente revalidada (2026-10-09):** CI `37968280085`, shard 4, y la repetición local aislada de
`shopping-tray-lifecycle.spec.ts` reproducen un defecto distinto del estado HTTP: el documento no tiene
overflow, pero la alerta `role=alert` sale del viewport estrecho. El CI midió el borde derecho en 464,7 px
frente a 320 px (retry: 339,5 px); localmente llegó a 536,95 px frente a 320 px. La aserción E2E ya existente
lo detecta; el cierre anterior solo había comprobado el `scrollWidth` del documento y no el rectángulo del aviso.

**Contrato:** la única alerta 503 sigue visible, accesible y completamente dentro del viewport a 320×568 y
568×320 una vez terminada la animación de entrada; su borde izquierdo es ≥0 y conserva un margen derecho de
16 px (tolerancia 1 px). La página tampoco adquiere overflow horizontal. En escritorio el aviso conserva la
anchura máxima compartida de 400 px.

**TDD rojo:** CI `37968280085` falló en la aserción del rectángulo; la repetición local aislada también falló
(**1/1**) antes del arreglo:

```powershell
$env:E2E_RATE_LIMIT='on'
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium tests/e2e/shopping-tray-lifecycle.spec.ts --grep 'terminar y reabrir desde el historial conserva el estado tras recargar' --reporter=line
```

- [x] Revalidar el E2E, aislar el rectángulo del aviso como causa y reproducir el fallo con Playwright real,
      rate limit activo y SQLite/puertos/semilla aislados.

- [x] Ajustar el contenedor superior con `left: auto` y ancho `min(400px, calc(100vw - 2 × margen))`;
      así conserva 16 px a la derecha también en móvil y al cruzar 480/481 px. No altera estados, texto,
      persistencia ni avisos de acción inferiores.
- [x] Reejecutar Chromium y Pixel 5 en escritorio (1440×900), móvil (390×844, 320×740, 320×568),
      horizontal (568×320) y en el borde del breakpoint (480/481 px). La alerta sigue visible, tiene rol `alert`, queda dentro del viewport,
      no genera overflow ni `pageerror`; guardar e inspeccionar capturas sintéticas comparables.
- [x] Ejecutar `pnpm run typecheck:e2e`, `pnpm run check:ui` (212 ficheros/21 reglas), Prettier y
      `git diff --check`. La cobertura es N/A: solo cambia CSS de producción y la aserción E2E; no cambia
      lógica TypeScript de producción.
- [x] Registrar evidencia y rollback en commits atómicos; todos los hooks pasaron, los commits se publicaron
      y CI quedó verde para el cambio de producción.

**Ajuste detectado por CI (run `37972650590`, shard 4):** el navegador remoto midió la alerta a 1440×900
antes de que terminara `slideInRight` (borde derecho 1647,3 px); la captura mostraba el desplazamiento
transitorio de entrada, no el estado final. La repetición local no lo reprodujo porque la animación ya había
acabado antes de la medición. El contrato y la regresión esperan ahora a que terminen las animaciones activas
del aviso antes de medir la geometría; producción no cambia en esta segunda corrección.

**Evidencia local (2026-10-09):** el E2E aislado con `$env:E2E_RATE_LIMIT='on'` y la base/puertos/semilla
temporales pasó **2/2** (Chromium y Pixel 5). En cada proyecto el aviso no supera `min(400px, ancho − 32px)`;
queda a 16 px del borde derecho (±1 px) en los siete viewports y `scrollWidth <= innerWidth`, sin errores
de página.
Capturas sintéticas guardadas en `%TEMP%\hogaria-toast-bounds-20261009\{chromium,mobile-chrome}\` con
los siete anchos/altos indicados y revisadas visualmente en escritorio, 320×568, 480/481×800 y 568×320.
No se guardaron artefactos en Git. La primera corrida CI `37972650590` reveló la medición antes del fin de
`slideInRight`; se esperó el fin de la animación y se alineó la geometría en todos los breakpoints. El E2E
aislado final pasó 2/2. Hooks completos en `6ee77d9`, `fb963f8` y `7f89ecb`: Prettier, `check:ui` (212/21),
build, typecheck E2E y suites (11 config, 1285/1285 cliente con cobertura 92.22/83.54/90.97/93.64 % S/B/F/L,
1236 pasadas/1 omitida servidor). CI `37974621196` pasó **9/9 jobs** para `7f89ecb`. Cobertura focal N/A:
el cambio de producción es CSS solamente. Rollback: revertir en orden inverso `7f89ecb`, `fb963f8` y
`6ee77d9`; el arreglo 503 previo permanece en `0af4741`.

**Rollback:** revertir el ajuste geométrico y la regresión/cierre de esta subunidad; conservar el manejo 503
de `shopping.service.ts` y su alerta localizada.

#### QA-SHOPPING.TRAY-STORE-FILTER.1 · filtro de tienda con enlace recuperable

**Fuente revalidada (2026-10-09):** `ShoppingListsComponent` obtiene las opciones del servicio de tiendas,
presenta el selector «Tienda», actualiza `store` en la URL y carga de nuevo la bandeja; `readUrl()` restaura el
filtro. Las pruebas de `shopping-round6.spec.ts` validan la búsqueda por producto, el orden y la paginación,
pero no seleccionar una tienda ni recuperar ese filtro tras una recarga. La prueba de componente cubre cambios
de estado con spies, no el resultado del endpoint real.

**Contrato:** crear dos listas sintéticas de tiendas distintas; seleccionar una tienda debe dejar visible solo
su lista y reflejar `store` en la URL. Tras recargar, deben conservarse el selector y el resultado. Quitar el
filtro debe restaurar ambas listas. No se cambia backend ni se contacta a proveedores externos.

- [x] Revalidar template, `storeOptions`/`setStore`/`readUrl`, E2E actuales de la bandeja y brecha concreta.
- [x] Añadir primero E2E aislada de `/shopping` que cree las dos listas, filtre por tienda, compruebe el enlace,
      recargue y quite el filtro.
- [x] Ejecutar Chromium desktop y Pixel 5 con rate limit activo, SQLite/puertos/semilla temporales y cleanup;
      guardar e inspeccionar capturas sintéticas PC/móvil del filtro aplicado, confirmar nombres/roles accesibles
      del selector/opciones y botón para quitar filtros, y ausencia de overflow horizontal. Si no hay cambio de
      producción, cobertura de código: N/A. E2E real aislada: **2/2** (Chromium + Pixel 5); URL `?store=Ahorro`,
      resultado exclusivo, recuperación después de recarga y limpieza recuperando las dos listas. El test comprueba
      `scrollWidth <= clientWidth` en ambos proyectos. Capturas inspeccionadas en
      `%TEMP%\hogaria-shop-tray-store-filter-final-20261009\{chromium,mobile-chrome}\shopping-tray-store-filter.png`.
      Pasan `pnpm run typecheck:e2e`, `pnpm exec prettier --check tests/e2e/shopping-tray-store-filter.spec.ts`
      y `git diff --check`.
- [x] Registrar comandos/resultados y rollback (solo la regresión E2E y esta subunidad si producción no cambia);
      ejecutar hooks completos, push y CI verde. Commit `7bba4b8`; revalidado en el barrido integrado (**98/102**,
      cuatro skips de viewport intencionales) y CI `37966484202` (**9/9** jobs). Rollback: revertir solo la
      regresión E2E y retirar esta evidencia.

#### QA-SHOPPING.SUGGESTED-PRESERVE-MANUAL.1 · actualizar sin perder líneas de la casa

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §12al promete que al actualizar una lista
sugerida se sustituyen solo las líneas sugeridas pendientes; las compradas y las añadidas manualmente
se conservan. `shopping.routes.ts` implementa el filtro por `source='sugerida'`, `checked=0` y
`deleted_at IS NULL`; `shopping-suggested.routes.spec.ts` prueba las tres clases mediante inserciones
directas en SQLite aislada. `shopping-suggested.spec.ts` ya recorre UI, compra y actualización, pero solo
verifica desde E2E la conservación de la línea comprada y que quede una sugerencia viva, no una línea manual
creada por la persona.

**Contrato:** con actividad y lista sintéticas, crear sugerencias, marcar una comprada, añadir otra línea
desde la UI de detalle y actualizar desde la bandeja. Tras la actualización, la comprada conserva `checked`,
la manual conserva `source=manual` y ambas existen una sola vez; las sugerencias pendientes se reemplazan sin
duplicados. No se invoca IA/proveedor ni se escribe en la base de datos habitual.

- [x] Revalidar §12al, filtros de `POST /shopping/suggested`, regresión de servidor y E2E actual; acotar
      la brecha a conservar una línea manual creada por UI.
- [x] Añadir primero regresión E2E aislada para crear/actualizar, conservar línea manual y comprada y no
      duplicar las sugerencias.
- [x] Ejecutar Chromium desktop y Pixel 5 con rate limit activo, SQLite/puertos/semilla temporales y cleanup;
      comprobar los estados en persistencia, accesibilidad/scroll, guardar e inspeccionar capturas sintéticas.
      E2E real aislada `shopping-suggested.spec.ts`: **2/2**; `Detergente QA` se añade desde la UI, persiste una
      vez con `source=manual`, el pan comprado sigue en el tab del carro con `aria-checked=true` y queda una sola
      sugerencia vigente de tomate. El test comprueba ancho sin overflow en estados pendientes y carro. Capturas
      sintéticas de la línea manual inspeccionadas en
      `%TEMP%\hogaria-suggested-manual-final-20261009\{chromium,mobile-chrome}\shopping-suggested-manual-preserved.png`.
      Pasan `pnpm run typecheck:e2e` y `pnpm exec prettier --check tests/e2e/shopping-suggested.spec.ts`; cobertura
      de producción: N/A (sin cambio productivo).
- [x] Registrar resultado, comandos y rollback (solo la regresión E2E y esta unidad); ejecutar hooks completos,
      push y CI verde. Commit `1add612`; barrido integrado (**98/102**, cuatro skips de viewport intencionales)
      y CI `37966484202` (**9/9** jobs). Rollback: revertir solo la regresión E2E y retirar esta unidad.

#### QA-SHOPPING.TRAY-RENAME.1 · renombrado accesible y sin avisos duplicados

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §8f requiere confirmar con Enter, cancelar con Escape,
confirmar en blur solo si el nombre cambió y revertir/avisar en fallo. `shopping-lists.component.ts` implementa
esas transiciones, pero el input no declara nombre accesible y el foco se pierde al sustituir el botón por el
editor. La prueba E2E de `shopping-round6.spec.ts` cubre Escape, no éxito/blur/conflicto. La prueba de componente
cubre el retorno `null`, aunque el interceptor HTTP convierte el `HttpErrorResponse` en un objeto que el servicio
no reconoce; el interceptor y el componente muestran dos toasts de error. El PATCH real conserva compare-and-swap
por versión y `shopping.routes.spec.ts` ya verifica el HTTP 409.

**Contrato:** el campo editor anuncia «Renombrar la lista» y recibe el foco al abrirse para poder escribir de
inmediato desde teclado. En conflicto, el título previo sigue visible y se presenta un único aviso claro (sin
falso éxito ni segundo toast); después se puede reintentar. Un renombre dirty confirmado al sacar el foco queda
persistido tras recargar. Escape conserva el nombre y no escribe. El conflicto E2E se inyecta solo para ese PATCH;
el éxito usa el servidor SQLite aislado. No hay proveedor externo.

- [x] Revalidar §8f, template/servicio, comparación de versión de servidor y diferencia entre pruebas unitarias
      y E2E; limitar el cambio a etiqueta/foco accesibles y propiedad única del aviso de error.
- [x] Añadir primero E2E roja para nombre/foco accesibles, conflicto, reversión visible, reintento por blur y
      persistencia; registrar baseline sintético.
- [x] Aplicar el cambio mínimo y ajustar regresión unitaria: solo el servicio notifica errores/conflictos; mantener
      Escape, Enter, blur limpio/sin cambios y evitar PATCH cuando no cambia el texto.
- [x] Validar en Chromium escritorio y Pixel 5 con rate limit activo, SQLite/puertos/semillas temporales y cleanup;
      revisar teclado/foco, sin overflow a 320×568, 393×851, 568×320, 1023×768, 1024×768, 1025×768 y 1440×900,
      e inspeccionar capturas sintéticas PC/móvil. Karma global supera los umbrales; registrar S/B/F/L por archivo.
- [x] Anotar comandos/resultado y rollback focal (E2E, etiqueta/aviso y prueba unitaria); ejecutar hooks completos,
      commit atómico, push y confirmar CI verde. Fix en `a80a8b8`; barrido integrado (**98/102**, cuatro skips de
      viewport intencionales) y CI `37966484202` (**9/9** jobs). Rollback focal: revertir ese commit, sus regresiones
      y esta subsección.

**TDD rojo (2026-10-09):** Playwright aislado con Chrome local, rate limit activo, SQLite/puertos/semillas efímeros
y cleanup reprodujo en Chromium y Pixel 5 que el campo no tenía nombre accesible y que el conflicto 409 mostraba
dos toasts rojos (`Error · LIST_VERSION_CONFLICT` y «No se ha podido guardar»). El test espera la respuesta
interceptada y confirma HTTP 409; no envía peticiones al proveedor IA. Al exigir foco inicial, Chromium reprodujo
además que el editor dinámico quedaba inactivo tras pulsar «Renombrar».

**Evidencia local (2026-10-09):** `ShoppingListsComponent` etiqueta el editor con la clave ES/EN existente y
`autofocus`; `ShoppingService.renameList()` marca el PATCH `SILENT_TOAST` y procesa el error original conservado
por el interceptor, de modo que es el único responsable del aviso; el componente ya no duplica el toast. Karma
focal: **51/51**; Karma global: **1278/1278**, coverage global **92.17/83.48/90.92/93.59 % S/B/F/L**. Cobertura
por archivo: `shopping-lists.component.ts` **95.50/87.33/91.80/97.16 %** y `shopping.service.ts`
**97.24/88.57/100/99.46 % S/B/F/L**. `pnpm run typecheck:e2e` pasa. `shopping-tray-rename.spec.ts` pasa **4/4**
en Chromium escritorio + Pixel 5: el input es accesible y enfocado, Enter falla una sola vez con 409 dejando el
título intacto y un único aviso warning (cero error toasts), y el reintento por blur persiste tras recarga.
`shopping-round6.spec.ts --grep "renombrar se puede cancelar"` pasa **2/2** (Escape no escribe). Cada E2E usa
`scripts/run-isolated-playwright.mjs`, `E2E_RATE_LIMIT=on`, datos sintéticos, DB/puerto/semilla efímeros; cleanup
confirmado. Se revisó overflow en los siete tamaños de escritorio/móvil indicados. Capturas sintéticas inspeccionadas
en `%TEMP%\hogaria-shop-tray-rename-final2-20261009\{chromium,mobile-chrome}\shopping-tray-rename-editor-baseline.png`,
`shopping-tray-rename-conflict-baseline.png` y `shopping-tray-rename-conflict-recovered.png`. Rollback focal:
revertir el commit atómico de este punto de spec, template/servicio y sus regresiones E2E/unitarias.

#### QA-SHOPPING.DISCOUNT-FIRST-UNITS.1 · descuento limitado a las primeras unidades

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §8f define que `firstUnits` limita la base
del descuento a las primeras unidades pagadas, en orden de posición. El cálculo y sus bordes ya
tienen pruebas de servidor en `server/src/utils/list-discount.spec.ts`; la E2E existente solo
comprueba el descuento porcentual sobre toda la lista. La fila general `/shopping/:id` sigue abierta
para el resto de interacciones. El contrato activo habla de descuentos de lista, no de una entidad
«cupón» independiente; esta unidad no inventa ese alcance.

**Contrato:** en una lista con precios, un porcentaje configurado para las primeras N unidades
reduce solo el subtotal de esas unidades pagadas; el total permanece correcto después de guardar y
recargar, y la hoja reabre con el alcance y el límite persistidos.

- [x] Añadir primero una E2E de producción que cree una cesta sintética con cantidades/precios
      distintos, aplique un porcentaje a `firstUnits`, y afirme el subtotal reducido, el total,
      el resumen accesible y el alcance/límite al reabrir tras reload.
- [x] Ejecutar la E2E aislada con rate limit, DB/puertos/semilla temporales y cleanup en Chromium
      escritorio y Pixel 5; no contactar WebAPI ni proveedor IA. Guardar e inspeccionar capturas
      sintéticas PC/móvil en un directorio nuevo ignorado por Git.
- [x] Ejecutar typecheck E2E, formato, `check:ui`, cobertura completa y `git diff --check`; registrar
      comando/resultados, limitaciones y rollback. El cambio de DTO toca producción: no marcar coverage
      N/A; la cobertura focal de `shopping.model.ts` es 95.70/91.06/100/98.75 % S/B/F/L y el componente
      no se instrumenta en Karma, por lo que se verificó por E2E de producción.

**TDD y causa raíz:** la E2E roja falló tras recargar en Chromium y Pixel 5: el servidor persistía el
DTO `firstUnits: 3`, pero el editor volvía a `1` y perdía el porcentaje. `shopping.routes.ts` ya serializa
el DTO en `camelCase`; el modelo y la hoja del cliente leían claves obsoletas en `snake_case`, por lo que
la hidratación y el Undo no conservaban el descuento. Se tipó el contrato real y se centralizó la
conversión entre DTO, borrador editable y payload de Undo; el cálculo del servidor no cambió.

**Evidencia local (2026-10-09):** la prueba roja usó `pnpm run test:e2e:full-stack -- --workers=1
--project=chromium --project=mobile-chrome --forbid-only tests/e2e/full-stack/shopping-money.spec.ts
--grep='primeras unidades' --reporter=line` y falló en ambos proyectos al reabrir el editor (esperado
`3`, recibido `1`). La corrida final de todo el archivo con rate limit activo y recursos efímeros,
`E2E_RATE_LIMIT=on`, `E2E_SCREENSHOT_DIR=.e2e-screenshots/qa-shopping-first-units-inspected-20261009`
y el mismo comando sin `--grep`, pasó **8/8**: persiste/reabre alcance, cap y total y confirma la
respuesta GET del servidor. Cleanup del stack aislado confirmado; no hubo llamadas a WebAPI/IA ni
escrituras al inventario. `pnpm run test:client:coverage` pasó **1287/1287**, global
92.23/83.57/90.98/93.64 % S/B/F/L (sin rebajar umbrales); `pnpm run typecheck:e2e`,
`pnpm run check:ui` (212 ficheros/21 reglas), Prettier focal y `git diff --check` pasan. Build
productivo aprobado por el runner E2E con warnings preexistentes de budgets/imports. Capturas
sintéticas inspeccionadas:
`.e2e-screenshots/qa-shopping-first-units-inspected-20261009/shopping-first-units-chromium.png` y
`.e2e-screenshots/qa-shopping-first-units-inspected-20261009/shopping-first-units-mobile-chrome.png`.

**Rollback:** revertir la unidad atómica del DTO/helper de descuentos en `shopping.model.ts`, su uso
en `shopping-list-detail.component.ts`, las pruebas unitarias y E2E, el fixture de DTO de servicio y
esta subsección; no revertir cálculos ni comportamiento del servidor.

#### QA-SHOPPING.UNIT-RECENTS.1 · seis unidades usadas recientemente

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §8f pide fijar arriba las seis unidades usadas recientemente
desde `localStorage`. `UnitPickerComponent` solo convierte `UNIT_FAMILIES` en opciones; ni este componente ni
`unit-families.ts` leen/escriben unidades recientes, y no hay una clave `shopping:*unit*` en `StorageService`.
`shopping-round10.spec.ts` prueba selección por toque y unidad personalizada, no orden reciente ni restauración tras
recarga. `StorageService` ya aporta JSON, namespace `hogar:v1:` y manejo de errores de cuota.

**Conducta esperada:** al elegir una unidad (incluida una cadena personalizada), se coloca primera en una sección
«Recientes»; las seis más recientes quedan ordenadas de más a menos reciente, sin duplicados y sin perderse al
recargar. Una unidad de catálogo puede aparecer arriba como reciente y conservar su opción dentro de la familia sin
duplicar valores elegibles; la cadena personalizada se conserva literalmente. Si el almacenamiento está vacío,
corrupto o no admite escritura, el catálogo completo sigue siendo utilizable y no falla el editor.

- [x] Revalidar el contrato activo, selector compartido, catálogo de familias, `StorageService` y cobertura E2E
      actual; limitar esta unidad a recencia persistente del selector, sin alterar el contrato de guardado de la línea.
- [x] Escribir primero E2E roja con datos sintéticos que elija más de seis unidades, mezcle catálogo y una cadena
      personalizada, y compruebe orden, límite, unicidad y persistencia tras reload en escritorio y Pixel 5.
- [x] Implementar recencia con `StorageService` y opciones recientes localizadas, deduplicadas de las familias; tratar
      JSON inválido y cuota llena sin romper búsqueda, selección custom ni el teclado (↑/↓/Enter/Escape).
- [x] Validar interfaz real y accesibilidad en Chromium/Pixel 5 con rate limit activo, DB/puerto/semilla aislados y
      cleanup; cubrir 320×568, 393×851, 568×320 y breakpoints 1023/1024/1025/1440 sin overflow. Inspeccionar y guardar
      capturas sintéticas de PC/móvil; coverage focal ≥70 % S/B/F/L y Karma global sin rebajar gates.
- [x] Registrar comandos/evidencia y rollback focal; ejecutar hooks completos, commit atómico, push y confirmar CI.
      Commit `4e1e1bc`; barrido integrado (**98/102**, cuatro skips de viewport intencionales) y CI
      `37966484202` (**9/9** jobs). Rollback focal: revertir ese commit, sus pruebas y esta subsección.

El caso de almacenamiento corrupto/cuota llena se simuló con fixtures de navegador: no se limpia almacenamiento
real ni se modifica la DB habitual. `rg app-unit-picker frontend/src/app tests/e2e` confirma que
`shopping-list-detail.component.ts` es su único consumidor de producción; la E2E valida la hoja real de esa pantalla.

**Evidencia local (2026-10-09):** E2E roja reprodujo la ausencia de «Recientes» tras reload en Chromium y Pixel 5;
el test previo de teclado pasaba. Después, con `E2E_RATE_LIMIT=on`, `pnpm run test:e2e -- tests/e2e/shopping-unit-recents.spec.ts --project=chromium --project=mobile-chrome` pasó 4/4: seis últimas unidades en
orden, custom literal, unicidad, persistencia, filtro, ↑/↓/Enter/Escape y sin desbordamiento horizontal en las siete anchuras. Karma
focal pasó 18/18, incluido idioma inglés, JSON corrupto y cuota llena; `pnpm run test:client:coverage` pasó 1284/1284,
global 92.22/83.53/90.97/93.64 % S/B/F/L; picker 100/100/100/100 % y StorageService 88.46/85.71/83.33/89.36 %.
`pnpm run typecheck:e2e` y `pnpm run check:ui` pasaron. Capturas sintéticas inspeccionadas:
`%TEMP%\hogaria-unit-recents-final-20261009\chromium\shopping-unit-recents.png` y
`%TEMP%\hogaria-unit-recents-final-20261009\mobile-chrome\shopping-unit-recents.png`.
Commit `4e1e1bc` y push con hooks completos pasaron; CI `37966484202` validó el código final en `0af4741` (**9/9** jobs).

- [x] `/shopping/:id`: alta rápida/typeahead/teclado/pegado multilínea/foto, marcar y editar items, selección/lote, unidades/cantidad/precio/oferta/descuento/cupón, carro pendiente/comprado, subtotal/total, vaciar/finalizar, reabrir, inventario, auditoría en vivo y volver tras recarga.

**Cierre de `/shopping/:id` (2026-10-10):** los subcasos de esta ruta están cerrados abajo; la matriz aislada de 14 specs en Chromium y Pixel 5 emulado cubrió alta/typeahead/pegado, selección, precios/unidades/ofertas/descuentos/cupón, estado de la cesta, cierre/reapertura, transferencia a despensa, sugerencias, recuperación de error y auditoría SSE. Se ejecutó con rate limit activo, runner y SQLite temporales y semilla propia. El resultado agregado fue **106 passed, 9 skipped por guardas de proyecto y 1 fallo**: el bootstrap móvil del test preexistente «quitar desde la hoja» agotó el timeout esperando que apareciera la acción «nueva lista», sin alcanzar sus aserciones de Compra. Su reproducción aislada pasó **2/2**; la spec `shopping-sugerencias.spec.ts` completa pasó **10/10**. El runner paró el servidor propio pero preservó los artefactos/SQLite de ese intento fallido en `%TEMP%` para diagnóstico; las repeticiones verdes limpiaron sus propios recursos. El proceso/puerto temporal quedó detenido. La E2E photo-review corre en el proyecto full-stack sintético; la CI del HEAD `5bb1606` terminó **9/9 jobs verdes** en `38056833392`, incluyendo full-stack y los cuatro shards. Por ello se cierra la cobertura funcional de la ruta, dejando constancia del fallo intermitente de setup (sin atribuirle una causa no probada). Capturas sintéticas revisadas en `.e2e-screenshots/qa-shopping-route-matrix-20261010/`: `shopping-discount-1440x900.png`, `shopping-discount-393x851.png` y `shopping-quick-add-mobile-320x568.png`. No hubo llamada a proveedores externos ni escritura fuera de los entornos aislados.

#### QA-SHOPPING.AUDIT-LIVE.1 · refresco de autoría con la hoja abierta

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §8e define el historial de autoría mediante
`GET /lists/:id/events` y SSE `GET /api/shopping/stream/lists/:id`; el cliente usa cada aviso para volver a leer el
estado canónico y solo vuelve a leer los eventos mientras la hoja «Quién ha tocado qué» está abierta.
`ShoppingListDetailComponent.startStream()` implementa esa invalidación, pero `tests/e2e/shopping-round10.spec.ts`
solo comprueba el reloj relativo/absoluto de una fila ya existente, no el refresco en vivo desde otro cliente.

- [x] Crear lista y línea sintéticas, abrir el historial y esperar la lectura inicial de eventos y conexión SSE.
- [x] En una segunda pestaña autenticada del mismo usuario, añadir otra línea a esa lista. Verificar que el
      historial abierto se actualiza por SSE/GET de eventos, contiene la nueva acción y no requiere reload ni
      navegación de la pestaña observada; confirmar que el stream estaba conectado y no hay sondeo periódico
      durante el estado inactivo ni errores de página.
- [x] Ejecutar en Chromium escritorio y Pixel 5 con servidor, SQLite, puerto y semilla aislados; guardar e
      inspeccionar capturas sintéticas del historial actualizado, pasar typecheck E2E, formato y `git diff --check`.
      No se cambia comportamiento productivo; cobertura instrumentable N/A.
- [x] Registrar evidencia y rollback focal (retirar `tests/e2e/shopping-audit-live.spec.ts` y esta subsección).
      La unidad no cierra el resto del barrido `/shopping/:id` ni la matriz visual global.

**Evidencia QA-SHOPPING.AUDIT-LIVE.1 (2026-10-10):** `$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR='D:\projects\MiCocinAI\.e2e-screenshots\qa-shopping-audit-live-20261010'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-audit-live.spec.ts --reporter=line` pasó **2/2**. Ambas vistas recibieron el stream HTTP 200 `text/event-stream`; con la hoja abierta, una pestaña secundaria añadió una línea y la primera recibió exactamente una acción más, con la persona y el artículo correctos, sin navegación ni cambio de `performance.timeOrigin`. Durante 1,2 s inactivos no hubo GET de eventos adicional; no hubo errores de página. Runner confirmó SQLite, puerto, semilla y artefactos temporales y limpió la DB al cerrar el proceso propio. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-shopping-audit-live-20261010/{chromium,mobile-chrome}/audit-updated.png`. `pnpm run typecheck:e2e`, `pnpm exec prettier --check tests/e2e/shopping-audit-live.spec.ts APP-QA-SPEC.md` y `git diff --check` pasan; sin cambios productivos, coverage N/A. Rollback: revertir el test de historial en vivo y este subapartado; el barrido integral `/shopping/:id` sigue abierto.

### QA-SHOPPING.LIST-DELETE.1 · confirmación y recuperación al borrar una lista

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §8e define el borrado de lista como irreversible y exige
`ConfirmService`, no diálogo nativo. `ShoppingListsComponent.remove()` solo envía DELETE después de aceptar y
no muestra éxito si falla. La ruta borra la lista y la cascada de sus líneas. Antes de esta unidad el E2E cubría
cancelar, 503 y retry, pero no contaba solicitudes DELETE alrededor de Cancelar ni durante el reintento; ahora
las aserciones instrumentan ambas rutas.

- [x] Medir solicitudes reales en UI aislada: Cancelar no envía DELETE y conserva lista/líneas; un 503 preserva
      la lista y no anuncia éxito; el reintento envía exactamente una solicitud y, al confirmarse, elimina solo
      la lista objetivo de forma persistente tras reload.
- [x] Confirmar que se usa diálogo accesible propio (sin diálogo nativo), el error es visible y no hay errores
      de página ni overflow en Chromium escritorio y Pixel 5.
- [x] Ejecutar la prueba focal en ambas configuraciones con SQLite/puertos temporales, inspeccionar capturas
      sintéticas PC/móvil y anotar comando, resultado, cleanup y rollback. La ruta general `/shopping/:id`
      permanece abierta para las demás acciones y su matriz.

**Evidencia QA-SHOPPING.LIST-DELETE.1 (2026-10-10):** en PowerShell, `$env:E2E_RATE_LIMIT='on';
$env:E2E_SCREENSHOT_DIR='D:\projects\MiCocinAI\.e2e-screenshots\qa-shopping-list-delete-20261010'; node
scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only
--grep 'Cancelar conserva; borrar fallido' tests/e2e/shopping-tray-lifecycle.spec.ts --reporter=line` pasó
**2/2**. La prueba captura el DELETE: Cancelar produjo **0** solicitudes, el 503 produjo **1** solicitud,
conservó lista y línea y no mostró éxito; el retry produjo exactamente una segunda solicitud (200), borró solo
la lista objetivo y la ausencia persistió tras reload, mientras la otra lista siguió presente. Se verificaron
el diálogo propio (`role=dialog`), cero diálogos nativos y cero errores de página; escritorio Chromium y Pixel 5
sin overflow horizontal. Runner confirmó SQLite/puerto/artefactos temporales y cleanup. `pnpm exec prettier
--check APP-QA-SPEC.md tests/e2e/shopping-tray-lifecycle.spec.ts`, `pnpm run typecheck:e2e` y `pnpm run
check:ui` pasaron (**212 archivos/21 reglas**). No cambió código productivo; gate de coverage no aplica.
Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-shopping-list-delete-20261010/{chromium,mobile-chrome}/
shopping-list-delete-confirmation.png` y estados de error/éxito. Rollback: revertir esta subunidad y las
aserciones E2E agregadas a `shopping-tray-lifecycle.spec.ts`; no modifica la API ni datos persistidos.

#### QA-SHOPPING.COMPLETE-TO-PANTRY.1 · trasladar a despensa solo lo comprado

**Fuente revalidada:** `HOGARIA-SPEC.md` §8f y `POST /lists/:id/complete` distinguen líneas compradas de pendientes; al cerrar, las compradas crean, reponen o fusionan existencias en la despensa, sin duplicar el producto. La UI confirma el traslado. La casilla integral `/shopping/:id` sigue abierta para otras acciones y matriz.

- [x] Probar desde UI que una línea con precio marcada como comprada, al cerrar la lista, muestra confirmación y aparece en la despensa.
- [x] Probar en la integración de servidor que el cierre suma stock existente, repone ficha agotada, crea ficha nueva y no traslada la línea pendiente.
- [x] Ejecutar Chromium y Pixel 5 emulado con entorno aislado, rate limit activo y búsqueda de imágenes en fixture; sin proveedor externo ni DB de desarrollo.

**Evidencia (2026-10-10):** `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-sugerencias.spec.ts --grep 'la linea comprada, con su precio, aparece en la despensa y el aviso lo dice' --reporter=line` pasó **2/2**. El fixture de `PANTRY_IMAGE_SEARCH_FIXTURE` evita llamadas externas; el runner aisló SQLite, puerto, usuario y uploads con cleanup. Con `DATABASE_PATH=:memory:`, `pnpm --filter @hogaria/server exec vitest run src/routes/shopping.routes.spec.ts --reporter=dot` pasó **95/95**, incluida la regresión de suma/reposición/alta y exclusión de pendientes. Sin cambios de producción.

**Rollback:** retirar esta subunidad y su evidencia; no revertir los contratos ni el comportamiento probado de cierre/transferencia.

#### QA-SHOPPING.QUICK-ADD.1 · typeahead, Enter sin selección y pegado multilínea

**Fuente revalidada:** `HOGARIA-SPEC.md` §12ag C define búsqueda de productos del catálogo mientras se teclea; la selección reutiliza el alta normal y conserva la sección/categoría. El contrato de la lista también distingue elegir una sugerencia de enviar texto libre; pegar varias líneas debe parsearlas como altas individuales. `onDraftKeys()` implementa `ArrowDown`, `ArrowUp`, `Enter` y `Escape`, pero la E2E existente solo cubría Enter sin selección; quedaba sin probar el recorrido completo del typeahead por teclado y la exposición del elemento activo.

- [x] Buscar y elegir una sugerencia del catálogo: el nombre se canoniza, desaparece el panel y la línea nace en su sección.
- [x] Con sugerencias visibles pero ninguna seleccionada, Enter añade el texto original en vez de capturar la primera sugerencia.
- [x] Pegar tres líneas parsea las tres, incluida cantidad/unidad, en escritorio Chromium y Pixel 5 emulado.
- [x] Ejecutar con rate limit activo y runner aislado (SQLite, puerto, usuario y cleanup propios); sin proveedor externo.
- [x] Completar teclado del typeahead: flechas arriba/abajo recorren opciones y actualizan `aria-selected` manteniendo foco; Enter selecciona sin enviar el formulario y Escape cierra sin modificar el texto; el alta final conserva el producto elegido.

**Evidencia (2026-10-10):** `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-sugerencias.spec.ts --grep 'despliega el catalogo|sin tocar ninguna hoja' --reporter=line` pasó **4/4**. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-lists.spec.ts --grep 'pegar una lista de tres' --reporter=line` pasó **2/2**. Ambas corridas usaron `$env:E2E_RATE_LIMIT='on'`, DB/puerto/semilla temporales y cleanup del runner; no hubo llamadas externas ni escrituras en la DB normal.

**Cobertura de teclado (2026-10-10):** la E2E nueva recorre `ArrowDown`/`ArrowUp`, comprueba la opción activa por `aria-selected` y su estado visual mientras el foco sigue en el combobox; Escape cierra sin alterar el texto y Enter conserva el flujo de alta libre; tras seleccionar con Enter, la propuesta se conserva en el input sin enviarse hasta pulsar «Añadir». El primer run focal pasó **2/2** (Chromium y Pixel 5); la suite completa de `shopping-sugerencias.spec.ts` pasó **10/10** con el mismo aislamiento y rate limit. `pnpm run typecheck:e2e`, Prettier y `git diff --check` pasan. La interacción ya estaba implementada en `onDraftKeys()`; fue una brecha de cobertura, sin cambio de producción. Sin proveedor externo ni datos reales.

**Rollback:** retirar esta subunidad y su evidencia; no revertir typeahead, parser de pegado ni comportamiento de alta existentes.

#### QA-SHOPPING.PROMOTIONS.1 · ofertas y descuentos de lista, producto y línea

**Fuente revalidada:** `HOGARIA-SPEC.md` §12g–§12h separa ofertas de línea, descuentos de cesta dirigidos y descuentos por línea. La cobertura de esta unidad es solo la interacción y el cálculo visible en los cuatro escenarios; no cierra el barrido integral de `/shopping/:id` ni valida cupones.

- [x] Aplicar una oferta 3x2, comprobar que el chip conserva el nombre accesible y la etiqueta, y quitarla desde la fila.
- [x] Aplicar y quitar un descuento porcentual de lista: 10,00 € pasa a 9,00 € y vuelve a 10,00 €; comprobar 1440×900, 393×851 y 320×568.
- [x] Dirigir un descuento de 2,00 € al producto elegido desde la lista (5,00 € → 3,00 €); cerrar la hoja sin cambios conserva el total.
- [x] Verificar descuento porcentual limitado a dos unidades: chip, vista previa en vivo y borrado del descuento de línea.
- [x] Ejecutar escenarios en Chromium y Pixel 5 emulado con tasa limitada y runner aislado; sin proveedor externo ni base normal.

**Evidencia (2026-10-10):** `$env:E2E_RATE_LIMIT='on'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-round6.spec.ts tests/e2e/shopping-round10.spec.ts --grep 'una oferta 3x2|el descuento de la lista se aplica al total|un descuento prometido en un producto|porcentaje con tope de unidades' --reporter=line` pasó **8/8**. El runner usó DB/puerto/usuario/artefactos temporales y ejecutó cleanup. Estos cuatro casos no llaman a IA ni a un proveedor externo.

**Rollback:** retirar esta subunidad y su evidencia; no revertir los cálculos de oferta/descuento ni las pruebas existentes.

#### QA-SHOPPING.DISCOUNT-CLAMP.1 · el descuento no deja un total negativo

**Fuente revalidada:** `HOGARIA-SPEC.md` §12h establece que un descuento superior al importe de la línea se limita a cero y se explica en la hoja; nunca debe descontar el resto de la cesta.

- [x] Con línea de 0,95 € y descuento de 2,00 €, la vista previa indica el límite en cero y el total general nunca muestra importe negativo.
- [x] Ejecutar en Chromium y Pixel 5 emulado con rate limit y DB/puerto/usuario aislados; sin proveedor externo.

**Evidencia (2026-10-10):** `$env:E2E_RATE_LIMIT='on'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-round10.spec.ts --grep 'un importe mayor que la linea se recorta' --reporter=line` pasó **2/2**. El runner confirmó cleanup de base y artefactos temporales.

**Rollback:** retirar solo esta subunidad/evidencia; no revertir el clamp monetario ni su regresión E2E.

#### QA-SHOPPING.DISCOUNT-STACKING.1 · oferta, descuento de línea y cupón de cesta

**Fuente revalidada:** `HOGARIA-SPEC.md` §12h exige el orden de caja: oferta sobre unidades, descuento propio de línea sobre las unidades pagadas y, después, descuento/cupón de cesta. `server/src/utils/list-discount.ts::basketMoney` codifica ese orden, pero las E2E cubrían cada mecanismo por separado.

**Contrato:** para 3 unidades a 10,00 € con oferta 3x2, el importe tras oferta es 20,00 €; un 10 % en las dos unidades pagadas reduce 2,00 €; el descuento de cesta de 2,50 € deja 15,50 €. La ficha muestra los chips/desglose y conserva todos los descuentos tras recargar. En la matriz móvil, el nombre del producto permanece legible con ambos chips activos y ninguno desborda su fila.

- [x] Añadir regresión E2E aislada que combine los tres descuentos mediante la UI y verifique cada total intermedio y el total final exacto.
- [x] En Pixel 5 a 393×851 y 320×568, comprobar que el nombre no se parte letra por letra y que los chips caben dentro de la fila; verificar también el límite CSS 600/601 px.
- [x] Ejecutarla en Chromium y Pixel 5 emulado a 1440×900, 393×851, 320×568, 600×851 y 601×851; guardar e inspeccionar capturas sintéticas, revisar overflow y errores de página.
- [x] Pasar la prueba focal del motor de descuentos, `typecheck:e2e`, Prettier y `git diff --check`; la regresión roja confirmó que la ficha estrecha dejaba el nombre con ancho cero, por lo que se añadió ajuste responsive sin cambiar el motor.

**Evidencia (2026-10-10):** la regresión Playwright aislada con tasa limitada se ejecutó para Chromium y los proyectos Pixel 5 emulado Chrome/WebKit; pasaron **5** pruebas y **10** se omitieron por proyecto. El runner eliminó DB/puerto/artefactos temporales tras cerrar el servidor propio. Los totales comprobados son 20,00 € → 18,00 € → 15,50 €, con el desglose de línea `-2,00 €` conservado tras recarga. La primera regresión móvil mostró `.detail__name` con ancho **0 px** y el texto partido por letra; se permitió que la ficha flex redistribuya sus elementos, se dio un ancho mínimo al nombre y se confirmó que nombres/chips quedan dentro del viewport. En el cruce 600→601 px, el ancho de la fila varía exactamente 1 CSS px y las alturas de fila/nombre, como máximo 1 px. A 320 px el cupón se activa con toque medido en el control visible; el disclosure del desglose usa teclado porque el hit-test de Playwright móvil misrutea el pie sticky hacia la fila, así que esta subunidad no afirma verificación táctil de ese control específico. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-shopping-discount-stacking-20261010/discount-stacking-{chromium-1440x900,mobile-chrome-393x851,mobile-chrome-320x568,mobile-chrome-600x851,mobile-chrome-601x851}.png`. `pnpm --filter @hogaria/server exec vitest run src/utils/list-discount.spec.ts`: **43/43**; `pnpm run typecheck:e2e`, Prettier, `pnpm run check:ui` (**212 ficheros / 21 reglas**), build de producción y `git diff --check`: verdes. El build confirmó que el estilo de la ficha quedó bajo el presupuesto duro de 20 kB; mantuvo avisos globales de tamaño de bundle.

**Rollback:** retirar la E2E y esta subsección y revertir las reglas responsive añadidas a `.detail__face`; el motor monetario no se modifica.

#### QA-SHOPPING.LINE-LIFECYCLE.1 · alta, carro, precios y cierre

**Fuente revalidada:** `HOGARIA-SPEC.md` §12g–§12h y la conducta del detalle de compra: el mismo producto suma cantidades, marcar lo mueve al carro y el cierre solo archiva con el total pagado correcto. Esta subunidad no cubre el barrido completo, reordenamiento ni cupones.

- [x] Alta con cantidad muestra una fila sin precio y el aviso correspondiente; repetir producto suma la cantidad sin duplicar la fila.
- [x] Marcar una línea la mueve de pendientes al carro y el estado sigue persistido tras recargar.
- [x] Editar un precio decimal con coma en una línea de dos unidades actualiza el total estimado a 9,50 €.
- [x] Vaciar el carro requiere confirmación, conserva lo pendiente y «Deshacer» restaura la línea comprada.
- [x] Cerrar la compra archiva la lista y su total de 3,20 € aparece en el historial.
- [x] Ejecutar en Chromium y Pixel 5 emulado con tasa limitada y runner aislado; sin proveedor externo ni base normal.

**Evidencia (2026-10-10):** `$env:E2E_RATE_LIMIT='on'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-lists.spec.ts --grep 'anadir una línea|repetir un producto|marcar una línea se guarda|un precio con coma|terminar compra archiva|vaciar el carro' --reporter=line` pasó **12/12**. SQLite, puerto, usuario y artefactos fueron temporales; el runner confirmó cleanup. Sin llamadas a IA/proveedores externos.

**Rollback:** retirar esta subunidad y su evidencia; no revertir el comportamiento existente de alta, marcado, precios, cierre ni deshacer.

#### QA-SHOPPING.TRAY-COMPLETE-REOPEN.1 · reabrir tras error sin perder el carro

**Fuente revalidada:** el ciclo de vida de `/shopping` permite terminar una lista con líneas compradas, abrirla desde `Terminadas` y volver a activarla. Debe mantener líneas, marcas y precios; un HTTP 503 al reabrir no debe anunciar éxito ni sacar la fila del historial, y el reintento válido debe persistir tras recargar. La casilla global `/shopping/:id` sigue abierta para el resto de acciones.

- [x] Terminar desde la bandeja muestra estado/aviso de terminada y mueve la lista al historial.
- [x] Un 503 simulado al reabrir deja la lista terminada y muestra error; el reintento exitoso vuelve a la bandeja activa.
- [x] Después de recargar, reabrir el detalle conserva la línea en el carro comprado y su precio anotado.
- [x] Verificar Chromium y Pixel 5 emulado, sin overflow en la matriz de viewports del test; guardar e inspeccionar capturas sintéticas PC/móvil.

**Evidencia (2026-10-10):** con `E2E_RATE_LIMIT=on`, `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-tray-lifecycle.spec.ts --grep 'terminar y reabrir desde el historial conserva el estado tras recargar' --reporter=line` pasó **2/2**. La E2E usa SQLite/puerto/usuario/semilla aislados, simula solo el 503 con `page.route` y valida el item `Cafe` con clase `detail__row--checked` y precio `3,20 €` después de recargar. Capturas revisadas: `.e2e-screenshots/qa-shopping-complete-reopen-20261010/{chromium,mobile-chrome}/shopping-list-reopened-details.png`. Sin llamadas externas ni cambios de producción.

**Rollback:** revertir únicamente las aserciones/captura E2E de reapertura y esta subsección; no cambiar el flujo de cierre ni la lógica del servidor.

#### QA-SHOPPING.MULTISELECT.1 · acciones de lote y deshacer

**Fuente revalidada:** `HOGARIA-SPEC.md` §8f define selección múltiple con pulsación larga, barra de acciones (marcar/quitar) y una sola notificación de deshacer que restaura todas las filas. El móvil debe emitir pulsos táctiles reales, no eventos de ratón simulados.

- [x] Una pulsación larga abre la selección y al tocar otra línea aumenta el contador.
- [x] «Marcar» aplica la acción a las dos líneas y sale del modo de selección.
- [x] «Quitar» elimina ambas líneas con un solo toast; «Deshacer» restaura las dos.
- [x] Ejecutar Chromium y Pixel 5 emulado; en viewport táctil `dragRow()` usa CDP touch events.

**Evidencia (2026-10-10):** con `E2E_RATE_LIMIT=on`, `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-lists.spec.ts --grep 'pulsación larga|quitar en selección múltiple' --reporter=line` pasó **4/4**. SQLite, puerto, usuario y semilla fueron temporales; cleanup confirmado. Sin llamada al proveedor ni cambios de producción.

**Rollback:** retirar esta subsección/evidencia; no revertir el comportamiento de selección o la barra de deshacer.

#### QA-SHOPPING.PHOTO-REVIEW.1 · revisar, editar y confirmar una propuesta por foto

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §8f define un flujo de dos pasos: `POST …/photo/analyze` devuelve una propuesta validada sin escribir en la lista; solo `POST …/items/apply` persiste lo confirmado y fusiona por `product_key`. `shopping.routes.spec.ts` prueba la respuesta exitosa y que analizar no escribe, y `shopping-round6.spec.ts`/`shopping-ai-recovery.spec.ts` prueban únicamente el error sin configuración. No había E2E del flujo feliz ni los campos de revisión tenían nombres accesibles. El primer E2E también reveló que la cuadrícula fija de líneas desplazaba su fila **48 px fuera de la hoja** en ancho 320.

**Contrato:** con una lista y una línea sintéticas, seleccionar un PNG local y analizarlo mediante la API real contra un proveedor OpenAI-compatible local y controlado. El proveedor recibe imagen, modo/nota y `response_format` JSON Schema estricto; devuelve líneas y avisos válidos. Antes de confirmar, la UI permite revisar, desmarcar y editar propuestas; cada editor tiene un nombre accesible localizado y la lista persiste intacta. A 320 px, controles y líneas de revisión quedan dentro de la hoja sin desbordamiento horizontal. Al aplicar, solo se guardan las líneas seleccionadas y editadas, las equivalentes se fusionan sin duplicados, y la propuesta queda cerrada; tras recargar, la lista conserva exactamente esos cambios.

- [x] Añadir primero E2E aislada del camino exitoso con provider stub local; verificar request JSON Schema estricto, imagen, modo/nota, propuestas/avisos visibles, nombres accesibles localizados y que `photo/analyze` no cree items.
- [x] Editar una propuesta, desmarcar otra, aplicar y comprobar el payload de `items/apply`, la fusión por `product_key`, ausencia de líneas no confirmadas y persistencia tras recargar.
- [x] Validar escritorio Chromium y Pixel 5 móvil con rate limit, SQLite/puerto/semilla propios y cleanup; inspeccionar el flujo en 1440×900, 393×851 y 320×568, sin overflow ni CTA tapada. Guardar capturas sintéticas PC/móvil.
- [x] Ejecutar typecheck E2E, tests focales de servidor/UI, `check:ui`, formato, build y `git diff --check`; registrar rollback y evidencia. Coverage S/B/F/L de producción no aplica: cambios solo de plantilla, traducciones y CSS; el gate global frontend sí se ejecutó.

**Rollback:** revertir la E2E, las etiquetas accesibles/traducciones y la cuadrícula móvil junto con esta subunidad; no cambiar endpoints, lectura IA ni contratos.

**Evidencia TDD y validación local (2026-10-10):** el runner full-stack aislado contra Chromium y Pixel 5 reprodujo primero campos de nombre/cantidad/precio sin nombre accesible y luego la fila con `x=-48` en la hoja de 320 px. Se añadieron etiquetas localizadas dinámicas y una cuadrícula móvil de dos filas, sin cambiar medidas compartidas. El flujo final pasó **2/2** (`shopping-photo-review.spec.ts`): JSON Schema estricto, PNG, nota/modo, avisos/confianza; análisis sin escritura; edición y desmarcado; una fusión/una alta por `items/apply`, línea no seleccionada ausente y persistencia tras recargar. En 393 px la hoja/fila queda dentro del viewport; en 320 px no hay overflow horizontal, la fila permanece dentro de la hoja y el CTA queda visible al desplazarla. Rate limit activo; SQLite, puerto, usuario y artefactos efímeros con cleanup. El provider es local sintético; no se contactó a WebAPI/proveedor ni se reenvió ningún ticket.

Capturas sintéticas inspeccionadas: [escritorio 1440×900](.e2e-screenshots/qa-shopping-photo-review-20261010-07/chromium/photo-review-desktop-1440x900.png), [móvil 393×851](.e2e-screenshots/qa-shopping-photo-review-20261010-07/mobile-chrome/photo-review-mobile-393x851.png) y [móvil 320×568 con CTA visible](.e2e-screenshots/qa-shopping-photo-review-20261010-07/mobile-chrome/photo-review-mobile-320x568-cta.png).

`pnpm run typecheck:e2e`, Prettier, `pnpm --filter @hogaria/server exec vitest run src/routes/shopping.routes.spec.ts` (**95/95**), `pnpm test` (config **11/11**, frontend **1287/1287** con **92.23/83.57/90.98/93.64 % S/B/F/L**, servidor **1236 pasaron/1 omitida**), `pnpm run check:ui` (**212 archivos/21 reglas**), `pnpm run build` y `git diff --check` pasaron. El build mantiene avisos preexistentes de bundles/styles; la hoja queda justo en el límite de aviso de 20 kB de CSS. Sin llamadas externas ni efectos en datos reales.

- [x] Interacciones de compra en Chromium/Pixel 5 emulado: swipe táctil corto no ejecuta la acción, swipe completo confirma antes de quitar, swipe derecho suma una unidad, hoja/selector de unidad y teclado de activación, etiquetas accesibles de cantidad/precio e `inputmode="decimal"`, scroll interno hasta el CTA a 320×568 y sin overflow.
- [ ] Teclado virtual nativo: comprobar en Android/iOS real que el teclado abre, redimensiona el viewport y no tapa los campos ni el CTA. Playwright `page.keyboard` y la emulación Pixel 5 no acreditan un teclado software nativo; iOS/safe-area siguen pendientes en QA-LAYOUT.MOBILE-SAFARI.

**Evidencia QA-SHOPPING.MOBILE.INTERACTIONS.1 (2026-10-10):** con `E2E_RATE_LIMIT=on`, el runner aislado Chromium/Pixel 5 ejecutó `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/shopping-round6.spec.ts tests/e2e/shopping-round10.spec.ts tests/e2e/shopping-unit-recents.spec.ts --reporter=line`: **40 passed, 4 skips de viewport esperados**, SQLite/puerto/semilla temporales y cleanup confirmado. Para que el gesto móvil no se valide como ratón, `dragRow()` despacha touch events por CDP cuando `navigator.maxTouchPoints > 0`; en `shopping-lists.spec.ts`, swipe corto/derecho pasaron **4/4** con `--grep 'un arrastre corto|deslizar a la derecha'`, y arrastre completo con deshacer **2/2** con `--grep 'arrastrar del todo borra y la barra de deshacer lo devuelve'` en Chromium y Pixel 5. Las aserciones nuevas verifican nombre accesible de cantidad/precio y tipos `number`/`inputmode=decimal`; la prueba de hoja/CTA pasó **2/2**. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-shopping-mobile-check-20261010/swipe-row-touch-desktop-verified.png`, `.../swipe-row-touch-mobile-verified.png`, `.e2e-screenshots/qa-shopping-accessibility-20261010/shopping-offer-desktop.png`, `.../shopping-offer-mobile.png` y `.../shopping-edit-sheet-320x568-cta.png`. `pnpm run typecheck:e2e`, Prettier focal y `git diff --check` pasan. No hubo llamadas al proveedor ni escrituras fuera de los entornos aislados. Rollback: revertir los cambios test-only de `shopping-lists.spec.ts`/`shopping-round6.spec.ts` junto con esta evidencia; no cambia comportamiento de producción.

- [x] `/receipts`: elegir/arrastrar archivo, validar formatos y borde de 10 MiB a través del ingress de producción, rechazar inválidos, estados de cola, detener/reintentar/quitar, concurrencia y volver a abrir ticket desde cola.
- [x] `/receipts/:id`: procesamiento IA directo (sin OCR según HOGARIA-SPEC §12aj), edición de tienda/notas/líneas/unidad/cantidad/precio/oferta, añadir/quitar, total que cuadra/no cuadra, confirmar a inventario, detener/reintentar/borrar y fallo de proveedor.

**Evidencia previa parcial de ficha/cola (2026-10-10; superada por el cierre integral de abajo):** el runner aislado ejecutó en Chromium y Pixel 5
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/receipts.spec.ts tests/e2e/receipt-line-note.spec.ts tests/e2e/receipt-queue-actions.spec.ts --reporter=line`: **42/42**. Incluye extracción contra proveedor HTTP sintético (sin WebAPI/proveedor real), JSON de inventario en el request, corrección de metadatos/líneas, confirmación y lectura de inventario/tienda en SQLite efímera, nota de línea, total no coincidente, parada/reintento y borrado; el runner confirmó cleanup. La suite unitaria cubre parsing de unidad/oferta y `ai-queue.spec.ts` comprueba `response_format` estricto. Esta primera ejecución no cubría aún la remoción de líneas y no bastaba para cerrar la ruta; la matriz integral, ejecutada después, queda registrada debajo. No hubo llamadas al proveedor externo ni escrituras reales.

**Cierre integral de `/receipts/:id` (2026-10-10):** reejecutada la matriz aislada con
`$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR='.e2e-screenshots/qa-receipt-parent-final-rerun-20261010'; pnpm run test:e2e -- --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/receipts.spec.ts tests/e2e/receipt-line-note.spec.ts tests/e2e/receipt-line-removal.spec.ts tests/e2e/receipt-queue-actions.spec.ts --reporter=line`: **50/50 passed** en 4,1 min, con SQLite/app/puertos/semillas temporales y cleanup confirmado. Las pruebas cubren lectura por proveedor HTTP sintético con `response_format` estricto y catálogo adjunto, tienda/fecha y notas editables, altas y edición de líneas, unidad/cantidad/precio/oferta, suma exacta y descuadre, confirmación con persistencia en inventario/tienda, cancelar/confirmar borrado, y parar/reintentar. `server/src/routes/receipts.routes.spec.ts` pasó **26/26** con DB `:memory:`, incluyendo ausencia de configuración, rechazo del proveedor y respuesta malformada; todo el conjunto servidor también está verde en CI. Una corrida combinada previa dio 49/50 por timeout de navegación durante `skipOnboarding` en el bootstrap móvil (sin llegar a la aserción del ticket); el escenario aislado pasó 2/2 y esta repetición integral pasó 50/50. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-receipt-parent-final-rerun-20261010/receipt-line-quantity-price-chromium-es.png`, `receipt-line-quantity-price-mobile-chrome-es.png`, `receipt-delete-confirmation-chromium-1440x900.png` y `receipt-delete-confirmation-mobile-chrome-320x740.png`. Sin llamadas a WebAPI/proveedor real ni escrituras en datos reales.

CI del HEAD `10d960c` terminó **9/9 jobs verdes** (`38055182315`), incluidos cuatro shards E2E, tests de servidor, typecheck, build y full-stack. Esta casilla cierra la ruta de ticket; no cierra el smoke real de IA ni las limitaciones de teclado/safe-area nativos listadas por separado.

#### QA-RECEIPTS.AI-REVIEW-OUTPUT.1 · mostrar líneas detectadas en la ficha

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §12aj.A/D define lectura JSON directa sin OCR y una ficha revisable con cada línea del ticket. `tests/e2e/receipts.spec.ts` ya envía un PNG sintético y `inventario.json` a un proveedor HTTP local, verifica `response_format`/transporte y espera `review`; sin embargo, no comprueba que la línea devuelta por el proveedor aparezca como control editable en `/receipts/:id`, ni que unidad/precio/categoría del resultado sigan vinculados a esa fila. Además, `ticket-queue.ts::inventarioDeLaCasa()` solo lee `pantry_categories`; la siembra idempotente `ensureDefaultCategories()` se invoca en confirmación/rutas de despensa, no antes de esta instantánea. En un usuario recién registrado aún no había filas de categorías al procesar el ticket, pese a existir productos semilla con claves como `fruits`.

**Contrato:** una respuesta sintética válida contiene una línea identificable y total coincidente. Tras el `review`, la ficha presenta exactamente esa fila con nombre, cantidad, unidad, precio y oferta editables; la suma no avisa descuadre, y el `GET /api/receipts/:id` conserva la categoría y valores emitidos. Para afirmar que la categoría sigue el inventario, la clave devuelta debe existir en el adjunto JSON de esa misma solicitud. El request al stub local mantiene JSON Schema estricto y los adjuntos independientes del ticket y catálogo. Solo se usan PNG/catalogo sintéticos, SQLite/puerto/usuario temporales y el servidor HTTP local del test; ninguna llamada a WebAPI/modelo real ni confirmación en inventario normal.

- [x] Ejecutar el test existente como baseline aislado en Chromium y Pixel 5; comprobar que el proveedor local devuelve una línea y la ficha llega a `review`.
- [x] Añadir primero aserciones E2E de representación editable, valores de línea/categoría y total cuadrado sobre la respuesta IA sintética.
- [x] Comprobar que la categoría de la respuesta stub pertenece al catálogo `categorias[].clave` adjuntado en `inventario.json`, y se conserva en `GET /api/receipts/:id`.
- [x] Antes de construir la instantánea, sembrar categorías base idempotentemente solo si el catálogo está vacío; preservar cualquier árbol/categorías existentes y probar ambas ramas.
- [x] Repetir en Chromium escritorio y Pixel 5 móvil; ejecutar `typecheck:e2e`, formato, `check:ui`, build y el conjunto focal de tickets, y confirmar cleanup sin artefactos con contenido real.
- [x] Registrar evidencia y rollback sin marcar todavía la casilla padre `/receipts/:id`; esta subunidad cubre salida IA visible, no el ciclo completo de edición/confirmación/cola.

**TDD rojo / causa (2026-10-10):** con el fixture corregido a la clave válida `fruits`, el E2E exigió que esa categoría apareciera en el `inventario.json` de la misma petición y falló: `Expected "fruits"; Received array: []` (4 proyectos). La función `inventarioDeLaCasa()` consultaba `pantry_categories` sin inicializarla; en una cuenta recién creada el prompt recibía productos semilla, pero ninguna categoría, porque la siembra solo ocurría al visitar despensa o al confirmar el ticket.

**Corrección y evidencia verde:** `inventarioDeLaCasa()` llama ahora a `ensureDefaultCategories()` para el usuario/hogar resuelto antes de construir la instantánea. La inicialización existente solo siembra si el catálogo está vacío; no reemplaza categorías personalizadas. Regresiones SQLite: el caso nuevo recibe las 13 categorías base y una segunda lectura no duplica filas; un catálogo personalizado no recibe semillas. `pnpm --filter @hogaria/server exec vitest run src/utils/ai-queue.spec.ts --reporter=dot` pasó **28/28**. `pnpm --filter @hogaria/server run test:coverage` pasó **1.245 pruebas** y omitió 1; `ticket-queue.ts` queda en **86,56/80,09/95,23/92,23 % S/B/F/L**, sobre el gate del 70 % por métrica.

El E2E sintético focal, en Chromium y Pixel 5, pasó **4/4**; valida JSON Schema estricto, adjuntos separados, categoría `fruits` dentro de `categorias[].clave`, persistencia en `GET`, controles de línea editables y total coincidente. El conjunto aislado de `receipts.spec.ts`, `receipt-line-note.spec.ts`, `receipt-line-removal.spec.ts` y `receipt-queue-actions.spec.ts` pasó **46/46** en la repetición final (3,9 min); una corrida anterior dio **45/46** por `page.reload: net::ERR_NO_BUFFER_SPACE`, y la focal afectada volvió a pasar **4/4**. Todos los runs usaron SQLite, puertos, usuario y provider loopback sintéticos; el runner confirmó cleanup en las corridas verdes. `pnpm run typecheck:e2e`, Prettier, `git diff --check`, `pnpm run check:ui` (**212 ficheros/21 reglas**) y `pnpm run build` pasaron; el build conserva warnings previos de templates y budgets.

**Limitación/rollback:** esta subunidad valida catálogo y render con IA sintética, no la extracción real ni la categoría emitida por un modelo; eso sigue en `QA-AI.RECEIPT.RESUME-SAFE-SELECTION.1`. No cierra el ciclo completo de edición/confirmación/cola ni la casilla padre `/receipts/:id`. Retirar solo la llamada de inicialización previa al snapshot, sus dos regresiones, las aserciones E2E y este subapartado; conservar la siembra ya existente en rutas de despensa/confirmación.

#### QA-RECEIPTS.LINE-QUANTITY-PRICE.1 · editar cantidad y precio desde la ficha

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §12aj.D promete que cada propiedad de la línea, incluidas cantidad y precio, es editable. `receipt-detail.component.ts` renderiza controles numéricos con IDs estables y guarda con `editarLinea()` al cambiar; a diferencia de unidad/oferta, cantidad y precio no tienen nombre accesible. `receipt-line-note.spec.ts` ya verifica por navegador los PATCH/persistencia de unidad y oferta, y el componente prueba sus conversores, pero no hay E2E de edición web de cantidad/precio. La medición Pixel 5 a 393×851 reveló además que cantidad (`x=29,w=44`) se solapa 36 px con unidad (`x=37,w=159.5`): `grid-template-columns: 1fr auto auto` deja colapsar la primera pista frente a inputs con `width:100%`.

**Contrato:** una ficha sintética en `review` expone en español e inglés cantidad/precio mediante nombres accesibles localizados que incluyen el producto. Editar cada campo envía al endpoint real el PATCH numérico correcto, el GET refleja el valor y ambos sobreviven a reload. Los nombres accesibles no cambian geometría; a 1440×900, 393×851 y 320×568 no hay overflow, los controles móviles cumplen 44×44 y las cajas de sus inputs no se solapan. E2E usa usuario/SQLite/puerto/semilla propios, sin IA ni datos reales.

- [x] Reproducir antes del cambio con Chromium el nombre accesible ausente en cantidad y precio y, en Pixel 5, el solapamiento de controles móviles; conservar verde el control previo de unidad/oferta.
- [x] Añadir etiquetas ARIA localizadas sin alterar medidas y verificar los nombres en español/inglés, valor, `inputmode=decimal` y tipo numérico.
- [x] Editar cantidad y precio en la ficha; comprobar cada PATCH (payload/200), GET de detalle y persistencia tras reload.
- [x] Ejecutar Chromium y Pixel 5 aislados en 1440×900, 393×851 y 320×568; revisar overflow, objetivos táctiles, errores de página y capturas sintéticas PC/móvil.
- [x] Registrar comando, salida, cleanup y rollback; pasar typecheck E2E, formato, `check:ui`, build y la suite focal. La cobertura S/B/F/L de estas expresiones de plantilla no instrumentadas es N/A; no rebajar el gate global.

**TDD y evidencia (2026-10-10):** `pnpm run test:e2e -- --grep 'persiste (cantidad y precio|unidad y oferta)' --project=chromium --project=mobile-chrome` reprodujo primero **4 fallos** por nombre accesible ausente mientras el control de unidad/oferta pasó **4/4**. Al añadir la aserción geométrica, `pnpm run test:e2e -- --grep 'persiste cantidad y precio' --project=chromium --project=mobile-chrome` reprodujo **4 fallos** por solapamiento cantidad/unidad. Se localizó causa en la cuadrícula móvil `1fr auto auto`, cuyos inputs `width:100%` colapsaban la primera pista. La solución usa tres columnas `minmax(0,1fr)` para evitar solapamientos y añade nombre accesible completo localizado (`Cantidad`/`Quantity`, `Precio`/`Price`). La aserción comparativa confirma que retirar las etiquetas ARIA no cambia geometría en más de 1 px.

La repetición verde de `pnpm run test:e2e -- --grep 'persiste (cantidad y precio|unidad y oferta)' --project=chromium --project=mobile-chrome` pasó **8/8**; cada locale valida nombre, PATCH exacto (`quantity: 1.5`, `priceMinor: 200`), respuesta 200, GET y reload. `pnpm run test:e2e -- tests/e2e/receipt-line-note.spec.ts --project=chromium --project=mobile-chrome` pasó **12/12**. Incluyó 1440×900, 393×851 y 320×568, sin overflow/errores/solapamientos, con objetivos táctiles ≥44×44; el runner confirmó cleanup aislado. Capturas sintéticas PC/móvil revisadas y conservadas (ignoradas por Git) en `.e2e-screenshots/qa-receipt-quantity-price-green-20261010-145110/`.

`pnpm run typecheck:e2e`, Prettier sobre los cuatro archivos afectados, `git diff --check`, `pnpm run check:ui` (**212 ficheros/21 reglas**) y `pnpm run build` pasaron. Build conserva avisos preexistentes de imports/templates no usados y presupuestos Angular (bundle inicial/component styles); no se tocaron sus gates. No hay sentencias/ramos/funciones/líneas instrumentadas en las expresiones de plantilla, traducción ni CSS de esta unidad: cobertura S/B/F/L **N/A**, sin rebajar el gate global. No se invocó IA ni se usaron datos reales.

**Rollback:** retirar los nombres ARIA y la clave `receipts.cantidad_accesible`, restaurar la cuadrícula móvil anterior, retirar aserciones E2E/capturas ignoradas y esta subunidad; no cambiar el contrato API ni la edición de unidad/oferta.

#### QA-RECEIPTS.LINE-REMOVAL-MATCHING-TOTAL.1 · quitar una línea y validar la suma exacta

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §12aj.C/D promete líneas revisables con altas/bajas y aviso solo cuando el total no cuadra. `receipt-detail.component.ts` ya pide confirmación accesible antes de `DELETE` y calcula la suma, pero los E2E cubren añadir líneas y el aviso de descuadre, no borrar una línea ni el caso exacto. La hoja de estilos declara 28×28 CSS px para `.linea__quitar`; falta medir su caja renderizada, que debe cumplir el objetivo táctil móvil de 44×44.

**Contrato:** sobre una ficha sintética `review` cuya línea suma exactamente el total, no mostrar alerta/desacuerdo. Cancelar la confirmación de quitar conserva la línea y no envía `DELETE`; confirmar hace un único `DELETE`, la línea desaparece tras GET/recarga y la suma/aviso se actualizan coherentemente. El botón conserva su icono compacto y nombre accesible localizado, pero ofrece un objetivo móvil de al menos 44×44 CSS px sin overflow en 390×844 y 320×740; desktop sigue validado en 1440×900.

- [x] Añadir primero una E2E aislada que compruebe total exacto, cancelación sin mutación, confirmación con método/ruta `DELETE`, GET y recarga sin la fila, nombre accesible ES/EN y objetivo táctil ≥44×44 en Pixel 5.
- [x] Corregir solo la superficie táctil responsive del control si el test la detecta, manteniendo el glifo y la geometría del resto de la fila; inspeccionar capturas sintéticas comparables desktop/móvil.
- [x] Ejecutar E2E focal en Chromium/Pixel 5, la suite de tickets, `typecheck:e2e`, tests/coverage si cambia producción, `check:ui`, build, formato, diff, hooks, commit, push y CI verde.

**Evidencia TDD (2026-10-10):** primero, la E2E aislada falló en móvil en 2 casos porque `.linea__quitar` medía 28×28 CSS px; escritorio pasó los otros 2. El cambio se limita a 44×44 en el breakpoint móvil y conserva el glifo SVG de 14×14 y el tamaño de escritorio. La repetición focal pasó **4/4** (ES/EN, Chromium/Pixel 5): total exacto sin aviso, cancelar sin DELETE y con línea preservada, un DELETE 200 tras confirmar, respuesta GET y recarga sin línea, suma 0 y aviso de descuadre localizado. Objetivo táctil ≥44×44 a 390×844 y 320×740, sin overflow a esos anchos; escritorio medido a 1440×900. La suite combinada de tickets pasó **46/46** en Chromium/Pixel 5 en 4.0 min con SQLite/app temporales y cleanup confirmado. Capturas sintéticas ignoradas por Git, inspeccionadas: `.e2e-screenshots/qa-receipt-line-remove-20261010/receipt-line-remove-es-desktop.png` y `receipt-line-remove-es-mobile.png` (también guardadas para EN). Sin proveedor externo.

**Aislamiento:** usuario/SQLite/uploads temporales; solo fixtures sintéticas; no WebAPI, modelo, tickets reales ni inventario real.

**Cierre CI/hooks (2026-10-10):** el commit `0f44e71` se publicó en PR #41 con hooks Lefthook de pre-commit y pre-push ejecutados sin bypass. La corrida `38044063543`, intento 1, tuvo tres fallos intermitentes en el shard 3 (modal de paginación de despensa no encontrado, fila PDF duplicada y fila de historial ausente); las reproducciones locales focales pasaron (PDF 5/5; paginación y rescate 12/12 en Chromium/Pixel 5). El reintento del shard fallido —intento 2 de la misma corrida— terminó verde: **9/9 jobs**, incluidos los cuatro shards E2E, servidor, build, full-stack y typecheck. PR #41 sigue abierto, no-Draft y sin merge. No se ocultó el fallo inicial ni se usaron bypasses.

**Rollback:** retirar la E2E y, solo si se requiere por accesibilidad, el ajuste CSS del área táctil; no cambiar API ni datos.

#### QA-RECEIPTS.LINE-UNIT-OFFER.1 · editar unidad y oferta de una línea

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §12aj.A/D exige que cada línea del ticket permita editar unidad y oferta. `receipt-detail.component.ts` y `receipts.routes.ts` implementan los campos y PATCH correspondiente; las pruebas unitarias ya cubren el parseo de oferta, pero no había E2E que probara edición, payload y persistencia conjunta en la ficha. Los inputs de unidad y oferta tampoco exponen nombre accesible.

**Contrato:** en una ficha sintética en revisión, editar unidad (`ud` → `pack`) y oferta (`3x2` → `{ buy: 3, take: 2 }`) debe enviar solo el campo editado y persistir tras GET/recarga; borrar unidad o vaciar/invalidar oferta guarda `null`. Los controles tienen nombres accesibles localizados y asociados al nombre del producto. Una ficha confirmada no expone esos editores.

- [x] TDD primero: E2E aislada demuestra payload exacto, persistencia tras recargar, limpieza a `null` y modo confirmado de solo lectura; assertions por nombre accesible.
- [x] Ejecutar en Chromium escritorio y Pixel 5 móvil; comprobar 390×844 y 320×740 sin overflow ni controles táctiles menores de 44 CSS px, guardar e inspeccionar capturas sintéticas comparables.
- [x] Ejecutar pruebas focales, suite frontend completa con coverage, `typecheck:e2e`, `check:ui`, build, formato y `git diff --check`; registrar rollback, hooks, commit atómico, push y CI verde.

**Aislamiento:** fixtures y SQLite/puerto del runner temporal; no se llama a proveedor/WebAPI ni se confirma ni modifica el inventario real. El cambio previsto es solo de nombres accesibles, sin alteración visual; comparar geometría de los controles antes/después con tolerancia de 1 CSS px.

**TDD y evidencia local (2026-10-10):** la E2E nueva falló primero en los cuatro proyectos/idiomas porque los inputs de unidad/oferta no tenían nombre accesible. Se añadieron etiquetas `aria-label` localizadas con el nombre del producto, sin CSS ni cambios de geometría. Tras el cambio, la subunidad focal pasó **4/4** y `receipt-line-note.spec.ts` pasó **8/8** en Chromium y Pixel 5 móvil. Comprueba payload PATCH exacto, lectura API y recarga de valores, unidad vacía/oferta vacía o inválida a `null`, controles ausentes en ticket confirmado, accesibilidad localizada y sin `pageerror`. La prueba compara rectángulos, márgenes y paddings con y sin `aria-label` (diferencia ≤1 CSS px) en 1440×900, 390×844 y 320×740; no detecta overflow y conserva targets móviles ≥44 px. Cleanup del runner SQLite/app temporal confirmado.

`pnpm run test:client`: **1308/1308**, cobertura global **93.08/84.43/92.08/94.40 % S/B/F/L**; `receipt-detail.component.ts` alcanza **100/89.16/100/100 %** (S/B/F/L). `pnpm run typecheck:e2e`, `pnpm run check:ui` (212 ficheros/21 reglas), `pnpm run build`, Prettier y `git diff --check` pasan. El build mantiene warnings preexistentes de imports no usados, optional chaining y budgets.

Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-receipt-line-unit-offer-20261010/receipt-line-unit-offer-chromium-es.png` y `receipt-line-unit-offer-mobile-chrome-es.png`.

**Cierre de QA-RECEIPTS.LINE-UNIT-OFFER.1:** el cambio de accesibilidad está en `6cae5c6`, publicado en la rama de PR #41; CI `38040936155` terminó verde (9/9 jobs). Los hooks Lefthook de pre-commit y pre-push se ejecutaron sin bypass; el pre-push pasó `format-check`, `ui-quality`, `build`, `e2e-typecheck` y `unit-tests`. Comandos, resultados focales, coverage y runtime Chromium/Pixel 5 constan arriba. Esta casilla queda cerrada; la ruta `/receipts/:id` sigue abierta y no se infiere cubierta solo por esta subunidad.

**Rollback:** retirar solo la E2E, atributos accesibles y este bloque; no cambiar contratos ni datos.

**Cierre QA-RECEIPTS.ROOT.1 (2026-10-10):** HOGARIA-SPEC §12aj C–E y `server/src/routes/receipts.routes.ts` confirman validación por firma de PNG/JPEG/WebP/PDF, techo de 10 MiB, estados y acciones de cola. La cobertura desde bandeja quedó trazada a E2E existentes de selección/archivo inválido, cola/reintento/parada concurrente/«Abrir», y borrado confirmado; se añadió fixture de firma JPEG, WebP y PDF para probar también esos tres formatos por el ingress real Nginx. La ficha `/receipts/:id` se mantiene abierta como checklist separado.

`$env:E2E_RATE_LIMIT='on'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/receipt-queue-actions.spec.ts tests/e2e/receipts.spec.ts --reporter=line` pasó **30/30**; `... receipt-drag-drop.spec.ts --reporter=line` pasó **2/2**. `pnpm run test:e2e:nginx -- --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/receipt-ingress.spec.ts --reporter=line` pasó **6/6**: PNG/JPEG/WebP/PDF, 10 MiB aceptado y 10 MiB+1 rechazado sin persistencia; el ingress usó Nginx/backend/SQLite temporales. `pnpm run typecheck:e2e` y Prettier focal pasaron. Sin proveedor externo ni cambios de producción; cada runner limpió sus recursos aislados.

- [x] `/ai-config`: alta/edición/borrado, campos y rangos, mostrar/ocultar clave, probar desde formulario y desde ficha, loading/éxito/error/timeout, activar una sola config y conservar el secreto sin exponerlo.
- [x] `/logs`: conexión SSE/reconexión, pausar/reanudar/autoscroll, filtrar fuente/nivel, seleccionar/copiar líneas o todo, borrar con confirmación y cola de logs vacía/larga.

**Evidencia de `/logs` (2026-10-09):** las pruebas E2E aisladas en Chromium y Pixel 5 pasaron **16/16** para `logs.spec.ts`, `logs-clear-filters.spec.ts` y `logs-sse-reconnect.spec.ts`; cubren SSE, reconexión, pausa/autoscroll, filtros de fuente/nivel, selección y copiado, y borrado confirmado. La E2E contra el build/servidor de producción pasó **6/6** (`logs-only-errors.spec.ts` y `logs-history-queue.spec.ts`): combinación de «Solo errores» por teclado/táctil con fuentes y niveles, lista vacía y 250 líneas, orden, autoscroll activo/desactivado y SSE en vivo sin recarga. Todas las corridas usaron puertos, SQLite y fixtures sintéticos aislados con cleanup verificado; no llamaron al proveedor de IA. Se guardaron capturas PC/móvil ignoradas por Git en `.e2e-screenshots/qa-logs-matrix-20261009-followup/`; se inspeccionó el par `chromium/logs-history-long.png` y `mobile-chrome/logs-history-long.png`. Los tests de historial y solo-errores asertan cero `pageerror`. Sin cambio de producción; cobertura de producción N/A.

Comandos ejecutados:

```powershell
$env:E2E_RATE_LIMIT='on'
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/logs.spec.ts tests/e2e/logs-clear-filters.spec.ts tests/e2e/logs-sse-reconnect.spec.ts --reporter=line

$env:E2E_SCREENSHOT_DIR='.e2e-screenshots/qa-logs-matrix-20261009-followup'
pnpm run test:e2e:full-stack -- --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/full-stack/logs-only-errors.spec.ts tests/e2e/full-stack/logs-history-queue.spec.ts --reporter=line
```

**Evidencia de `/ai-config` (2026-10-09):** suite aislada completa
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
--forbid-only tests/e2e/ai-config.spec.ts --reporter=line`: **52/52**; cobertura adicional de límites/defaults de
concurrencia con `tests/e2e/ai-provider-concurrency.spec.ts`: **6/6** en los mismos dos proyectos. Se verifican alta,
edición, borrado/confirmación, campos, límites `0..8`, visibilidad por Enter/Space, clave no reenviada al editar,
prueba desde formulario y ficha, estados loading/éxito/error/503/504 y única configuración activa. Los tests nuevos
usan interceptores sintéticos, valores no secretos, SQLite/puerto/semilla temporales y cleanup confirmado; no llaman
a WebAPI/proveedor. La cobertura de timeout dio **4/4** y visibilidad **2/2**. Pre-push pasó formato, `check:ui`,
build, typecheck E2E y suites unitarias; CI del HEAD `fc92eee` (`37980861919`) pasó **9/9**. No hubo cambio productivo
ni visual, por lo que capturas/coverage de producción N/A.

### Unidad QA-LOGS.SSE-RECONNECT.1 · recuperación tras fallo de transporte

**Fuente revalidada antes de la prueba:** `HOGARIA-SPEC.md` es el contrato activo. Su §6 mantiene filtros, pausa y autoscroll y añade vistas guardadas, filtro independiente «solo errores» y expansión de `data`; también exige `/report`. Al abrir esta unidad, el componente de Logs aún no implementaba esas cuatro capacidades, por lo que la casilla general `/logs` permanecía abierta y esta unidad no representaba conformidad completa con el contrato. `LogService.connect()` usa `openResilientStream()`; `core/sse.ts` cierra el `EventSource` fallido, anuncia `retrying`, aplica backoff y vuelve a informar `live`; el estado está expuesto en `[data-test="logs-status"]`. `sse.spec.ts` cubre estos tiempos con reloj falso, pero los E2E actuales cubren apertura inicial/navegación de regreso y no fuerzan un error de transporte. No se cambia el comportamiento de pausa: hoy descarta eventos entrantes mientras está pausado, y el contrato no determina si deben guardarse para reanudarlos.

- [x] Añadir primero un E2E real que aborte solo la primera petición `/api/logs/stream` y deje pasar la conexión de recuperación al backend aislado.
- [x] Verificar el estado visible `Reintentando` → `En vivo`, que un marcador sintético emitido por el servidor aparece sin recargar, y que el único aborto esperado no produce errores JavaScript (`pageerror`).
- [x] Afirmar dos aperturas exactas del stream (inicial fallida + una recuperación) tras un margen de observación, sin tormenta de reintentos; comprobarlo en Chromium escritorio y Pixel 5, con rate limit activo, SQLite/puertos/semilla temporales y cleanup.
- [x] Ejecutar `sse.spec.ts` con coverage focal ≥70 % en statements/branches/functions/lines, conservar intacto el gate global de frontend y registrar su estado real.
- [x] Ejecutar typecheck E2E, formato y diff checks. No hay cambios de producción/UI en esta unidad; capturas comparativas PC/móvil: N/A. Mantener sin marcar la casilla general `/logs`, pues quedan funciones del contrato y acciones por recorrer.

**Baseline observado (2026-10-01):** `logs.spec.ts` pasa **12/12** en el runner aislado, con rate limit activo, Chrome local, DB/puertos/semilla efímeros y cleanup (`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/logs.spec.ts`). `tests/e2e/full-stack/logs-live.spec.ts` añade la verificación de conexión inicial y navegación de vuelta; ninguna de las dos suites inyecta una caída SSE involuntaria. Playwright no tiene su Chromium administrado instalado en este Windows; el Chrome del sistema funciona vía `E2E_CHROME_BIN`. No se utilizó el servidor/base habitual ni el proveedor IA.

**Evidencia QA-LOGS.SSE-RECONNECT.1 (2026-10-01):** `tests/e2e/logs-sse-reconnect.spec.ts` aborta la primera apertura SSE y deja que la siguiente llegue al servidor; Playwright aislado con rate limit activo, Chrome del sistema, SQLite/puertos/semilla temporales pasó **2/2** (`--project=chromium --project=mobile-chrome`). En ambos perfiles se ve `Reintentando` → `En vivo`, el marcador de un GET sintético aparece en Logs sin recargar (se conserva `performance.timeOrigin`), el contador queda en exactamente dos aperturas, `pageerror` queda vacío y no hay overflow a 320×568, 393×851, 568×320, 1023×768, 1024×768, 1025×768 ni 1440×900; el runner limpió su DB/artefactos. Dos primeras iteraciones corrigieron aserciones del test —dos filas distintas (request/respuesta) comparten el marcador y Playwright notificó dos `framenavigated` para `/logs`—, no defectos de la aplicación; la aserción final distingue ambas cosas sin modificar producción.

`sse.spec.ts` en Chrome Headless del sistema pasó **7/7**. Cobertura focal de `core/sse.ts`: **80/70,59/71,43/85,07 % S/B/F/L**; el test adicional de error tardío tras cierre explícito eleva ramas sobre el mínimo de 70 %. Karma terminó con exit 1 porque el umbral global configurado de **80 %** no se alcanza en branches/functions durante esta ejecución focal; no se rebajó ningún gate. `node node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`, Prettier local (`node node_modules/prettier/bin/prettier.cjs --check APP-QA-SPEC.md frontend/src/app/core/sse.spec.ts tests/e2e/logs-sse-reconnect.spec.ts`) y `git diff --check` pasan. `pnpm exec prettier` no pudo abrir el directorio de Corepack por `EPERM`; usar el binario local dio resultado verde. No hubo cambios de diseño/UI; capturas PC/móvil: N/A. La ruta completa `/logs`, la deuda global frontend QA-04c y las capacidades de HOGARIA §6 continúan pendientes.

### Unidad QA-LOGS.CLEAR-FILTERS.1 · filtro por nivel y borrado confirmado

**Fuente revalidada antes de implementar:** el contrato activo `HOGARIA-SPEC.md` §6 conserva filtros de nivel/fuente y navegación de logs. El E2E `logs.spec.ts` cubre filtro de fuente, selección/copia y controles de pausa/autoscroll, pero no el filtro de nivel ni el borrado. El componente sí presenta `levelOptions`, pide `ConfirmService.confirm()` antes de borrar y llama a `clearSelection()` inmediatamente después de iniciar el DELETE. `LogService.clear()` solo maneja `next`: ante fallo HTTP la lista no se vacía, pero la selección ya se pierde y el `subscribe` carece de handler de error; el interceptor común emite su toast genérico. Los dos `<select>` no declaran `<label>` ni `aria-label`, así que se comprobarán también sus nombres accesibles reales y se localizarán explícitamente. La ruta general `/logs` sigue abierta también por cola vacía/larga y las capacidades aún ausentes de HOGARIA §6 (vistas guardadas, expansión de `data` y `/report`).

- [x] Sembrar errores/warnings/info sintéticos; filtrar por nivel y verificar que solo las entradas del nivel elegido permanecen visibles, y que «Todos» recupera las tres.
- [x] Exponer nombres accesibles localizados para los filtros de fuente y nivel y operarlos por rol/teclado; comprobar que el foco regresa al disparador al cerrar la confirmación con Escape.
- [x] Seleccionar una línea, abrir confirmación y cancelar con Escape y con el botón Cancelar; afirmar cero DELETE, contenido y selección intactos.
- [x] Confirmar un DELETE que responda 503; preservar logs y selección, anunciar el error accesiblemente, no producir `pageerror` y permitir reintentar.
- [x] Reintentar contra el servidor aislado con éxito; esperar el DELETE 200, vista vacía y selección despejada. Cubrir la lógica modificada con pruebas de `LogService`/integración.
- [x] Ejecutar el flujo real en Chromium y Pixel 5, con rate limit, DB/puertos/semillas sintéticos; comprobar overflow en 320×568, 393×851, 568×320, 1023/1024/1025 y 1440×900, teclado/foco/Escape y targets táctiles ≥44×44 px.
- [x] Alcanzar ≥70 % S/B/F/L en cada archivo de producción tocado, respetar los gates superiores, ejecutar typecheck/formato/diff checks y guardar/inspeccionar capturas sintéticas PC/móvil de la notificación de error.

**Baseline previo al cambio (2026-10-01):** `logs.spec.ts` pasa **12/12** en el runner Playwright aislado con rate limit activo, Chrome local y SQLite/puertos/semilla efímeros (`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/logs.spec.ts`). En ese momento `LogService` carecía de spec unitaria; la pantalla aún no tenía prueba del estado de selección/error tras el DELETE.

**Evidencia de cierre (2026-10-01):** TDD reprodujo tres defectos antes del arreglo: la selección desaparecía tras el 503, los filtros no tenían nombre accesible y los botones de confirmación medían 30.57 px de alto. Karma pasa **19/19** en `dict/logs.spec.ts`, `log.service.spec.ts`, `logs.component.spec.ts` y `confirm-dialog.component.spec.ts`. Coverage focal por archivo (S/B/F/L): `dict/logs.ts` **100/—/—/100 %** (sin ramas/funciones), `log.service.ts` **100/94.7/100/100 %**, `logs.component.ts` **87.7/88.4/94.6/87.5 %**, `confirm-dialog.component.ts` **100/—/100/100 %** (sin ramas instrumentadas). El proceso focal reporta el gate global existente de 80 % como incumplido (**57.74/33.92/57.86/59.46 %** S/B/F/L en este subconjunto); no se modificó ni rebajó el gate.

`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/logs.spec.ts`: **12/12**. `node scripts/run-isolated-playwright.mjs tests/e2e/logs-clear-filters.spec.ts --workers=1 --project=chromium --project=mobile-chrome`: **2/2**. La prueba focal sembró solo filas sintéticas, mantuvo el rate limit activo, confirmó que Escape/Cancelar no envían DELETE, probó el 503 con `role=alert`/`aria-live=assertive`, y reintentó el DELETE aislado hasta 200. Verificó sin overflow 320×568, 393×851, 568×320, 1023×768, 1024×768, 1025×768 y 1440×900, foco, selección y targets táctiles ≥44×44 px. Ambos runs limpiaron sus DB/puertos/artefactos temporales.

Capturas sintéticas generadas e inspeccionadas (escritorio + Pixel 5): `.e2e-screenshots/qa-logs-clear-filters-final-aria-20261001/` (`logs-clear-confirm-*`, `logs-clear-error-*`). También pasaron `tsc -p tsconfig.e2e.json --noEmit`, Prettier para spec/tests nuevos y `git diff --check`. Los cuatro ficheros TS de producción tocados ya incumplían `prettier --check` en `HEAD`; se mantuvo el estilo local sin formatear archivos completos ajenos al cambio.

**Rollback del work unit:** revertir el commit `fix(logs): retain selection after clear failure` restaura el comportamiento previo de borrado/filtros y elimina sus pruebas, sin tocar otros cambios de la rama.

### Unidad QA-LOGS.ONLY-ERRORS.1 · filtro independiente «solo errores»

**Fuente revalidada (2026-10-09):** el contrato activo `HOGARIA-SPEC.md` §6 exige que el visor conserve los filtros de nivel/fuente y añada «solo errores». `LogService.isVisible()` combina actualmente únicamente fuente y nivel; el toolbar no expone otro control. La capacidad debe ser un filtro adicional, no un alias del selector de nivel: al activarlo solo quedan errores visibles; no altera la fuente ni el nivel elegidos y, al desactivarlo, esos filtros previos siguen aplicándose.

**Contrato:** un control de casilla con nombre accesible «Solo errores» alterna el predicado de error y conserva los filtros de nivel y fuente. Los filtros se intersectan: con «solo errores» activo y nivel `warn`, el resultado es vacío; al apagarlo, vuelven las warnings de la fuente seleccionada. El valor inicial es apagado y no requiere escritura remota ni persistencia entre sesiones. La casilla y su etiqueta ofrecen foco visible y una superficie táctil de al menos 44×44 CSS px; no añade dependencias ni modifica el contrato del API.

- [x] Añadir primero regresión unitaria y E2E con logs sintéticos error/warn/info; reproducir el filtro ausente y verificar activación/desactivación, combinación con fuente/nivel y restauración de los filtros previos.
- [x] Implementar el estado independiente en `LogService` y un control localizado, nombrado y operable por teclado; mantener semántica de casilla, foco visible y hit area ≥44×44 px.
- [x] Verificar en Chromium y Pixel 5 a 320×568, 393×851, 568×320, 1023/1024/1025 y 1440×900: cero overflow/pageerror, conteos correctos, persistencia del filtro mientras cambia fuente/nivel y captura sintética comparable PC/móvil.
- [x] Ejecutar unitarias focales con coverage ≥70 % S/B/F/L en cada archivo de producción afectado, E2E full-stack aislada con DB temporal, typecheck, `check:ui`, formato, build y `git diff --check`; registrar los comandos/resultados y no rebajar gates.

**TDD rojo → verde (2026-10-09):** antes del cambio de producción, la E2E aislada de Chromium falló porque no había un checkbox accesible «Solo errores». La regresión `tests/e2e/full-stack/logs-only-errors.spec.ts` siembra error/warn/info propios en la API y prueba teclado, ratón y toque real en móvil, filtros acumulados, restauración de nivel/fuente, ausencia de overflow y errores de página.

**Evidencia final (2026-10-09):** `pnpm run test:e2e:full-stack -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/full-stack/logs-only-errors.spec.ts --reporter=line`: **2/2**, servidor de producción compilado y aislado, SQLite temporal, rate limit activo. Se revisaron 320×568, 393×851, 568×320, 1023/1024/1025 y 1440×900; el checkbox mantiene foco visible y superficie ≥44×44 CSS px, los filtros fuente/nivel siguen intactos y no hay overflow ni `pageerror`. Capturas sintéticas del toolbar generadas e inspeccionadas (sin líneas ni datos de usuario) en `.e2e-screenshots/qa-logs-only-errors-20261009/` para PC/móvil.

`pnpm run test:client`: **1213/1213**, cobertura global **90,40/81,61/89,09/91,84 % S/B/F/L**. Cobertura focal de `log.service.ts`: **100/94,74/100/100 %**; `logs.component.ts`: **87,72/88,37/94,59/96,51 %**. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 archivos/21 reglas, 0 incidencias**), Prettier, `git diff --check` y el build de producción ejecutado por `test:e2e:full-stack`; persisten solo warnings previos de budgets/imports no usados. El gate global de coverage frontend (80 %) se mantiene intacto.

**Rollback:** retirar el control «solo errores» de `logs.component.ts`, su estado/predicado y pruebas de `LogService`, las claves de idioma y esta sección; no revertir filtros existentes, reconexión SSE ni borrado.

### Unidad QA-LOGS.HISTORY-QUEUE.1 · estados de historial vacío/largo y autoscroll real

**Fuente revalidada antes de probar:** el contrato vigente `HOGARIA-SPEC.md` §6 conserva el visor `/logs`; su checklist amplia de QA incluye cola vacía/larga. `LogService.connect()` carga hasta 500 filas del endpoint histórico (orden más reciente primero) y las invierte para mostrar cronológicamente; la plantilla muestra un estado vacío cuando no hay filas. `LogsComponent.ngAfterViewChecked()` solo fuerza el scroll inferior si autoscroll está activo y cambia la longitud del buffer. Los E2E de Logs existentes prueban toggles, filtros, selección/borrado y SSE básico, pero no afirman esos estados ni que el scroll siga/deje de seguir eventos en vivo. Para fijar las 250 filas sin insertar cientos de solicitudes al servicio, el E2E interceptará solo el GET histórico con datos sintéticos; el SSE y el POST que generan el marcador en vivo seguirán pasando por el servidor full-stack aislado.

- [x] Añadir primero un E2E que entregue historial vacío y bloquee el SSE para mantener la cola vacía; comprobar la presentación del estado vacío. En el E2E largo, emitir después una fila al backend aislado y comprobar que aparece por SSE sin recargar ni cambiar `performance.timeOrigin`.
- [x] Entregar 250 filas sintéticas en el orden de respuesta del servidor y afirmar 250 filas visibles, orden oldest→newest y scroll inicial al final con autoscroll ON.
- [x] Desactivar autoscroll, desplazar al inicio, emitir otro marcador por el POST real al backend y comprobar que aparece sin mover el scroll; verificar `pageerror` vacío.
- [x] Ejecutar con SQLite/puertos/semilla propios, rate limit activo, servidor full-stack real, Chromium y Pixel 5; inspeccionar capturas sintéticas PC/móvil del estado largo, ejecutar typecheck E2E, formato y `git diff --check`. Coverage N/A si el test no requiere cambios de producción. Esta unidad solo cierra la verificación de cola vacía/larga; no cierra la ruta general `/logs` ni las capacidades todavía pendientes de HOGARIA §6.

**Rollback:** retirar el test de cola de historial y esta unidad; no cambia producción ni datos persistentes.

**TDD/evidencia QA-LOGS.HISTORY-QUEUE.1 (2026-10-09):** la primera ejecución reprodujo que el E2E no aislaba el historial; se hizo explícito el matcher del GET `?limit=500` y se bloqueó el service worker solo en esta suite. Una segunda ejecución falló por capturar `marker` desde una función serializada en el navegador; se pasó como argumento de `evaluateAll`. No era un defecto de producción y no se modificó código de producto.

Evidencia final: `$env:E2E_RATE_LIMIT='on'; $env:E2E_SCREENSHOT_DIR='.e2e-screenshots/qa-logs-history-queue-20261009'; pnpm run test:e2e:full-stack -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/full-stack/logs-history-queue.spec.ts --reporter=line` pasó **4/4** (2 casos en Chromium y Pixel 5), usando build de producción, SQLite temporal y cleanup verificado. Solo el GET de historial usa 250 filas sintéticas; el POST de marcador y SSE permanecen reales contra el servidor aislado. Se verificaron orden oldest→newest, autoscroll al final y permanencia en el inicio al desactivarlo; cero `pageerror`. Capturas sintéticas generadas e inspeccionadas: `.e2e-screenshots/qa-logs-history-queue-20261009/{chromium,mobile-chrome}/logs-history-long.png` y los equivalentes `logs-history-empty.png`. `pnpm run typecheck:e2e`, Prettier y `git diff --check` pasan; coverage N/A (solo E2E/spec). La casilla general `/logs` sigue abierta por otras capacidades pendientes de HOGARIA §6.

## Matriz responsive, visual y accesibilidad

- [x] Barrido de **todas las rutas** en 320, 360, 390/393, 430, 768, 1023, 1024, 1280 y 1440 px; guardar ruta, viewport, overflow y errores por página.
- [x] Cubrir móvil vertical y horizontal (mínimo 844×390 y 932×430), tablet vertical/horizontal y escritorio. Mantener pruebas de dispositivo real emulado Android/Chromium e iOS/WebKit además del cambio de ancho.
- [x] Para cada breakpoint usado por una pantalla, probar `B−1`, `B` y `B+1` px; buscar breakpoints de nuevo en los estilos fuente al iniciar cada tarea.
- [ ] En cada flujo crítico móvil revisar viewport sin overflow horizontal, scroll real, safe-area, teclado virtual, modales/hojas, tablas/listas, botones fijos y orientación; el contenido no debe quedar tras header/nav/teclado.
- [ ] Revisar cada control por nombre accesible, label/error asociado, foco visible/orden lógico, teclado/Escape, estado disabled/loading, contraste WCAG AA, tamaño táctil objetivo ≥44×44 px y zoom de texto.
- [ ] Guardar capturas comparables de escritorio (1440×900) y móvil (390×844 y 320×740) por pantalla modificada, antes/después. Adjuntar al reporte/PR; no guardar datos personales ni credenciales en capturas.

**Hallazgo para esta matriz (2026-10-10):** la captura sintética móvil del fallo de borrado muestra que el toast
superior (`app-toast`, `top: var(--space-2)` hasta 480 px) se dibuja sobre la cabecera fija de 56 px y alcanza
el título de `/shopping`. La prueba focal sí confirmó anuncio accesible y ausencia de overflow, pero no cierra
la auditoría de solapamiento visual del toast compartido; revalidar su posición en las familias/rutas afectadas
antes de corregirlo o cerrar esta matriz.

### QA-LAYOUT.TOAST-HEADER-OVERLAP.1 · separar avisos de la cabecera móvil

**Fuente revalidada (2026-10-10):** `toast.component.ts` posiciona avisos superiores en `space-2` hasta
480 px y en `space-4` en anchuras mayores. `main-layout.component.ts` fija `.header` en `top:0`, alto
56 px y lo oculta desde 1024 px; el toast usa z-index 1100 frente a 100 de la cabecera. El E2E
`shopping-tray-lifecycle.spec.ts` comprueba posición horizontal y overflow del toast de error en varias
anchuras, pero no su separación vertical. `auth-layout.component.ts` comparte el toast sin tener cabecera.

**Contrato:** en `MainLayout`, el aviso superior queda al menos 8 CSS px debajo de la cabecera visible en
320, 390, 480, 481, 568 horizontal y 1023 px; a 1024/1440 px, la cabecera está oculta y se mantiene el
offset superior desktop existente. En `AuthLayout`, donde no hay cabecera fija, se conserva el offset
actual (8 px móvil, 16 px desktop). No hay overflow; rol/anuncio y geometría interna del toast no cambian.

- [x] Añadir primero aserciones E2E rojas para la separación vertical bajo el aviso 503 de `/shopping`,
      incluyendo ambos lados de los breakpoints 480/481 y 1023/1024.
- [x] Usar una variable de altura en la cabecera autenticada como única fuente del offset; posicionar
      el toast debajo solo en `MainLayout`, conservar `AuthLayout` y desktop, y pasar E2E con tolerancia
      de 1 CSS px sin overflow ni errores de página.
- [x] Ejecutar Chromium escritorio y Pixel 5 móvil; guardar/inspeccionar capturas sintéticas de error
      PC/móvil. Pasar typecheck E2E, Prettier, `check:ui`, build, suite focal y diff; registrar cleanup,
      coverage (N/A para geometría/CSS) y rollback sin cerrar la matriz global.

**Rollback:** revertir variable CSS de altura, offset superior condicionado al shell, aserciones/capturas
E2E y esta subunidad; no modificar duración, contenido, accesibilidad ni posición inferior de los toasts.

**Evidencia QA-LAYOUT.TOAST-HEADER-OVERLAP.1 (2026-10-10):** TDD rojo primero en Chromium y
Pixel 5: la prueba falló con el primer viewport móvil (390 px), `toast.top=8` y posición mínima
esperada `header.bottom + 8 = 64`; las seis comprobaciones restantes de autenticación/errores pasaron.
La altura móvil `56px` ahora tiene una sola fuente en `MainLayout` y el offset se hereda solo desde
ese shell: aviso a 64 px en anchuras con cabecera, offset original de 8 px en `AuthLayout` y de 16 px
en escritorio. `pnpm run test:e2e -- --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/shopping-tray-lifecycle.spec.ts tests/e2e/auth-forgot-password.spec.ts --reporter=line`:
**8/8**; comprobó 320, 390, 480, 481, 568 horizontal, 1023, 1024 y 1440 px, sin overflow horizontal
ni errores JS; la base SQLite y artefactos de ejecución se limpiaron al detener el servidor aislado.
Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-toast-header-final-20261010/chromium/
shopping-toast-503-1440x900.png` y `.e2e-screenshots/qa-toast-header-final-20261010/mobile-chrome/
shopping-toast-503-390x844.png`. `pnpm run typecheck:e2e`, Prettier focal, `pnpm run check:ui`
(212 ficheros/21 reglas), `pnpm run build` y `git diff --check` pasan; build informa avisos
Angular/budgets preexistentes. Coverage N/A: corrección geométrica de CSS sin lógica productiva cubierta.

**Evidencia QA-LAYOUT.ROUTE-MATRIX.1 (2026-10-09):** `tests/e2e/layout-gutters.spec.ts` recorrió 31 rutas estáticas (públicas, onboarding y privadas) y 8 detalles poblados, cada una en **59** combinaciones de viewport (incluye los anchos requeridos, 320×568/740, 390×844, 844×390, 932×430 y tablet 768×1024/1024×768). `pnpm run test:e2e -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/layout-gutters.spec.ts --reporter=dot`, con `E2E_RATE_LIMIT=on` y SQLite/puertos/semilla temporales: **6/6**. Los cuatro reportes PC/Pixel (`layout-route-viewport-audit*.json`) registran **1829** filas de rutas iniciales y **472** de detalles por perfil; **0** overflow horizontal y **0** `pageerror`. Los reportes solo guardan rutas saneadas, dimensiones, anchos calculados y nombres de error; están ignorados por Git en `.e2e-screenshots/qa-layout-route-matrix-20261009-final/{chromium,mobile-chrome}/`. El primer reintento encontró colisión del archivo de reporte entre perfiles; los artefactos se separaron por proyecto y la corrida final pasó. `pnpm run typecheck:e2e`, Prettier y `git diff --check` pasan. Coverage N/A: solo se modificaron E2E/helpers, no producción.

**Revalidación iOS/WebKit (2026-10-09):** Playwright `mobile-safari` (WebKit, emulación iPhone 13) recorrió la matriz completa de `layout-gutters.spec.ts`: las 59 combinaciones incluyen móvil vertical/horizontal (320×568, 320×740, 844×390 y 932×430), tablet vertical/horizontal (768×1024 y 1024×768), escritorio y B−1/B/B+1 codificados en la matriz. El informe fuera del repo registra **1829** filas estáticas y **472** detalles poblados; **0** overflow y **0** errores de página en los pases guardados. El test estático pasó aislado **1/1** y repetido **2/2**; el de detalles poblados pasó **1/1**. Una corrida exploratoria inicial sí detectó un `XMLHttpRequest cannot load http` en `/pantry/categories/new`; el mensaje completo no quedó capturado y no se reprodujo en las tres corridas posteriores. Se mejoró el diagnóstico E2E para incluir el mensaje acotado y sanear URLs (sin credenciales ni query), pero ese evento puntual sigue sin causa confirmada: no se cierra con esta evidencia la casilla global de errores inexplicados. WebKit en Windows es emulación, no Safari/iOS nativo ni verificación de safe-area/teclado nativo; esas comprobaciones siguen abiertas.

**Auditoría B−1/B/B+1 (2026-10-09):** la búsqueda de estilos de `frontend/src` encontró 24 anchos únicos en `@media min/max-width`: `360, 362, 400, 420, 480, 481, 560, 600, 601, 640, 641, 719, 720, 721, 760, 767, 768, 860, 900, 920, 959, 1023, 1024, 1100` px (`40rem` equivale a 640 px). Primero se añadió una regresión E2E: falló y enumeró los 12 anchos faltantes alrededor de `400`, `420`, `760` y `920`; se agregaron esos cuatro umbrales a la matriz y pasó **1/1**. La guardia ahora escanea `.css`, `.scss` y `.ts` de frontend y exige para cada umbral representable los tres anchos adyacentes. La matriz ampliada cubre **71** viewports y pasó **12/12** en Chromium escritorio, Pixel 5 y WebKit/iPhone 13. Los informes temporales registran, por perfil, **2201** filas estáticas y **568** detalles poblados, con **0** overflow y **0** errores de página. Comando: `$env:E2E_RATE_LIMIT='on'; $env:E2E_LAYOUT_AUDIT_DIR='%TEMP%\hogaria-responsive-breakpoint-matrix-2026-10-09'; node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --project=mobile-safari --forbid-only tests/e2e/layout-gutters.spec.ts --reporter=line`. Solo E2E/spec; cobertura de producción N/A.

## Datos, proveedor IA y privacidad de la prueba

- [x] Preparar fixtures deterministas con usuario(s), hogar, invitación, despensa, utensilios, listas, ticket/archivo y configuración de IA; cada run debe usar una SQLite temporal y semilla única.
- [x] Verificar que la suite puede crear/leer/borrar solo sus propios datos; no usar la base normal del dev server ni reutilizar `localhost:4200` para pruebas con escritura. No limpiar ni restaurar datos ajenos.
- [x] Los E2E repetibles deben usar proveedor stub/mock controlado. Separar el smoke del proveedor LAN real, opt-in, con timeout/límites y `API_KEY` desde variable de entorno o almacén de secretos; nunca escribir token/URL con credenciales en git, spec, fixture, screenshot, trace, video o logs.
- [x] Probar fallo del proveedor, respuesta mal formada/ilegible, 4xx/5xx, desconexión, timeout, reintento y concurrencia sin claves reales.

**Evidencia de fallos sintéticos (2026-10-10):**
`pnpm --filter @hogaria/server exec vitest run src/utils/ai-client.spec.ts src/utils/ai-queue.spec.ts src/routes/ai-queue.routes.spec.ts src/routes/receipts.routes.spec.ts --reporter=dot`
pasó **121/121**. `ai-client.spec.ts` sustituye `fetch` y cubre HTTP 401/4xx/5xx,
cuerpo/JSON malformado, proveedor sin `choices`, error DNS/desconexión, abort/timeout y caída de
stream; `ai-queue.spec.ts` prueba los límites de concurrencia por configuración, reintentos
automáticos/manuales y cancelación; las rutas de tickets verifican configuración ausente, rechazo
del proveedor y respuesta 200 ilegible. Los tests de cola/rutas usan `DATABASE_PATH=:memory:` y
respuestas/credenciales marcadoras sintéticas; no se requiere token real ni se llama a la red externa.
CI `38056833392` terminó con **9/9 jobs verdes** en el HEAD `5bb1606`. No se modificó producción
en esta verificación; se mantiene el gate existente y no aplica coverage focal nuevo.

**Aislamiento, fixtures y credenciales (2026-10-10):** `scripts/run-isolated-playwright.mjs`
crea una carpeta `hogaria-e2e-*` propia bajo el `%TEMP%` efectivo, genera `hogaria.sqlite`, puertos
loopback libres y una `E2E_SEED` única; `playwright.config.ts` exige `validateIsolatedEnvironment`,
usa la URL de ese puerto y `tests/e2e/helpers/seed.ts` genera identidades únicas por run/test. Las
E2E de Hogar/invitaciones, Despensa, Utensilios, Compra, Tickets y Configuración IA crean sus fixtures
sintéticos desde esas ayudas y sus propias APIs. Al terminar una corrida verde, el runner para su
servidor, verifica que sus puertos cerraron y elimina solo su carpeta temporal; si hay fallo conserva
esa carpeta propia para diagnóstico, como en la matriz de Compra de arriba. Nunca usa la base normal
ni un servidor preexistente para escritura en `pnpm run test:e2e`; el servidor se enlaza a un puerto
loopback recién reservado.

La suite repetible intercepta proveedores con `fetch` stub/local controlado y activa fixtures locales
de búsqueda; el proyecto `full-stack` también usa proveedor sintético. El smoke LAN real se limita a
`playwright.ai-real-smoke.config.ts` + `tests/e2e/ai-real-smoke.spec.ts`, exige opt-in exacto, está
prohibido en CI, acota config/request/test/global timeouts y solo acepta el proxy loopback autorizado.
La credencial del proveedor y el bearer WebAPI se reciben por variables de entorno/proceso con
separación coordinator/runner; se verifica la redacción antes de subir documentos y el token temporal
propio se elimina al terminar. Los tests de seguridad/redacción usan sentinels sintéticos, y el
preflight real de `QA-AI.SMOKE.PRESERVE-REDACTED-LOGS.1` confirmó cleanup sin llamadas al proveedor ni
cambios de settings. Esta evidencia **no** cierra `QA-AI.REAL-INTEGRATIONS.1`: los resultados reales
de tickets y su autorización de repetición siguen pendientes por separado.

## Cierre y evidencia requerida

- [ ] Antes de corregir, ejecutar baseline reproducible y separar fallos previos, fallos de entorno y regresiones; después aplicar TDD y actualizar esta checklist en cada unidad de trabajo.
- [ ] Tests unitarios e integración enfocados + Playwright real sobre servidor y navegador para cada flujo afectado; casos borde y estados de error incluidos. Ejecutar la matriz de navegadores/tamaños, no solo enumerar los tests.
- [ ] Cobertura de líneas, ramas, funciones y statements de al menos 70 % para el alcance probado, sin bajar gates existentes (frontend configurado en 80 %; backend en 70 % para la allowlist cubierta); registrar cualquier limitación del gate de CI.
- [ ] Sin errores de consola/red no explicados, rutas rotas, pérdidas de datos ni regresiones visuales; todas las casillas aplicables marcadas con evidencia.
- [ ] Informe final con resumen, comandos/resultados, defectos corregidos/pendientes, capturas PC+móvil y enlaces a los commits/PR. No mergear sin permiso explícito.

## Siguiente unidad de trabajo

1. QA-AUTH.PW-LIMIT.ALERT-LANDSCAPE.1 y QA-AUTH.REGISTER.FORM.1 están cerradas; `/auth/forgot-password`, `/auth/register`, `/invite/:code`, `/onboarding`, el shell autenticado, `/household`, `/account` y `/preferences` se revalidaron aislados; los CTA actuales de `/dashboard`, vencimientos, próxima comida y cola IA también están cubiertos. La ruta sigue abierta por comparar el total de las listas abiertas con un presupuesto semanal; decidir su ámbito y origen antes de marcar `/dashboard` completa.
2. QA-REC.INGRESS.1 ya está verificada con Nginx real aislado; la siguiente validación de motor pendiente es Safari/iOS real para la hoja de ofertas de QA-04c.1, sin sustituir safe-area/teclado nativos por emulación WebKit/Chromium.
3. Cubrir la matriz responsive global: breakpoints B−1/B/B+1, orientación, scroll, teclado, safe-area, tablet y navegadores emulados además de Chromium.
4. QA-04c: el gate global frontend en el hook pre-push del commit `db2eeeb` pasó (**90.20/81.39/88.94/91.57 % S/B/F/L**, 1168/1168 tests, 2026-10-08); mantenerlo al añadir cobertura focal ≥70 % en cada nueva unidad y revalidar la fuente antes de cada lote. No rebajar gates superiores existentes.
5. QA-05.PATH.1 está corregida y revalidada; no reabrir salvo nueva evidencia del source actual.
6. QA-04b checkbox y el aviso de error de Configuración quedan revalidados con Playwright real en escritorio/Pixel 5; no se reprodujo solapamiento ni toast HTTP duplicado.
7. QA-RECIPES.AI-FLOW.1 ya tiene pruebas unitarias, integración, E2E funcionales y gate frontend global ≥80 % verificado; no reabrir salvo cambio de código o nueva regresión.
8. Dashboard/recetas y Pantry (incluida la unidad TOUCH.1) ya tienen regresiones verificadas; completar las demás acciones/estados de esas rutas y todas las rutas pendientes.
9. QA-RECEIPTS `/receipts/:id` queda cerrada por la matriz integral **50/50** documentada abajo; reabrir solo ante cambio o regresión.
10. QA-SHOPPING `/shopping/:id` queda cerrada por la matriz en escritorio/móvil y CI 9/9 documentadas arriba; reabrir solo ante cambio o regresión.

## Unidad QA-CALENDAR.DELETE-FAILURE.1 · conservar el plan si falla el borrado de una comida

**Fuente revalidada (2026-10-02):** `HOGARIA-SPEC.md` §8f mantiene las comidas como proyección del plan semanal y `server/src/routes/calendar.routes.ts` solo confirma `DELETE /meals/:id` con éxito o `404`. `CalendarService.deleteMeal()` quita la comida de forma optimista, devuelve `false` ante error y solicita una recarga; `CalendarComponent.removeMealById()` ignora ese booleano, anuncia éxito y cierra el modal también ante un `503`. Además, `error.interceptor.ts` presenta un toast genérico salvo que la petición use `SILENT_TOAST`, contexto que este DELETE no establece. La entrada de borrado desde el modal tampoco pasa título y por ello pregunta por «esta comida» en vez de nombrar el plato. La política de fallo no está especificada por §8f; se fija como inferencia de UX/datos: nombrar el elemento en la confirmación, nunca mostrar éxito ni cerrar el formulario si el servidor no confirmó la eliminación, informar el error en ES/EN sin toast duplicado, preservar la comida y permitir reintentar. La prueba existente de borrado usa `.cal-event` (solo vista mensual); la vista semanal actual dibuja comidas en `app-calendar-timeline` como `[data-test="timeline-block-meal"]`, así que la línea base falla antes de alcanzar el borrado. El test actual solo cubre éxito y no contempla cancelar ni error.

**Revalidación de error (2026-10-09):** la suite de rutas volvió a medir en 320×568 el aviso bajo el encabezado del modal (`alert y=5..98`, header `y=16..93`). Al fallar DELETE, el diálogo de confirmación restaura foco al botón «Eliminar» situado abajo; ese scroll del cuerpo oculta/parcialmente superpone el aviso. La conducta queda fijada: mover foco al `role=alert` recién renderizado para anunciarlo y mantener visible el error antes de reintentar.

- [x] Actualizar el E2E de borrado a la superficie de calendario vigente; confirmar que el diálogo nombra la comida, que Cancelar no envía DELETE y conserva comida/modal, y que el DELETE exitoso la elimina incluso después de recargar.
- [x] Añadir primero pruebas unitarias del resultado booleano/error de `CalendarService.deleteMeal()` y de la decisión de UI: `true` anuncia éxito/cierra; `false` muestra error sin cierre ni falso éxito. Comprobar traducciones ES/EN y que el contexto suprime el toast genérico duplicado.
- [x] Añadir E2E real aislado que cree una comida sintética, haga fallar solo el primer DELETE con `503`, espere la recuperación de la comida, compruebe aviso de error accesible sin duplicados y reintente contra el backend hasta obtener éxito; sin `pageerror` ni errores de origen no esperados.
- [x] Comprobar con Playwright que el foco entra en la confirmación, que Escape/cancelar cierra solo esa confirmación y conserva el editor/comida sin enviar DELETE.
- [x] En 320×568, verificar que todas las acciones del editor de comida quedan dentro del modal sin recorte; mantener el scroll dentro del modal (sin desplazar el documento de fondo), targets táctiles ≥44×44 px y aviso de error accesible sin tapar el formulario.
- [x] Ejecutar en Chromium escritorio y Pixel 5 con rate limit, SQLite/puertos/semillas temporales verificados y cleanup. Revisar confirmación, foco/teclado, scroll y targets táctiles móviles; capturar e inspeccionar estado de error PC y móvil sin datos personales.
- [x] Asegurar que la acción táctil «Eliminar» del editor de comida mide al menos 44×44 CSS px en móvil, también durante la animación de entrada del modal; repetir la medición real tras el ajuste.
- [x] Mantener cobertura focal ≥70 % en statements/branches/functions/lines para cada archivo de producción tocado, sin reducir gates; ejecutar typecheck, build/formato/diff checks y dejar la checklist general `/calendar` abierta hasta completar las demás acciones.
- [x] En el 503, mover el foco al aviso accesible después de que el modal de confirmación lo restaure; a 320×568 medir que el aviso no queda bajo el encabezado, verificar foco real y conservar el reintento con teclado.

**Baseline Playwright (2026-10-02):** `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --grep "quitar una comida pasa por el dialogo de la app" tests/e2e/calendar.spec.ts`, con `E2E_RATE_LIMIT=on` y `E2E_CHROME_BIN` local: **2 fallos antes de iniciar el flujo de borrado**. En la base SQLite temporal se creó `Ensalada completa` y la página la mostró como botón de timeline, pero el selector obsoleto `.cal-event` (ambos proyectos) esperaba 1 y recibió 0. El runner confirmó servidor/puerto/SQLite/semilla aislados; guardó contextos sintéticos en `%TEMP%\hogaria-e2e-MeaLkm\artifacts\`. No se accedió a `localhost:4200` con una sesión autenticada ni se utilizó el proveedor IA.

**Hallazgo adicional antes del ajuste (2026-10-02):** tras corregir el selector y recorrer el caso de error/reintento real, Chromium escritorio pasa, pero Pixel 5 mide el botón «Eliminar» en **33,59 CSS px** de alto (target inferior al mínimo de 44×44 exigido para esta auditoría). El E2E confirma también que la ruta de error, persistencia tras recargar y ausencia de overflow pasan antes de fallar únicamente en ese tamaño táctil. La medición se obtuvo con `getBoundingClientRect()` sobre el botón visible en el editor; el código fuente es `.cal-btn` en `frontend/src/app/features/calendar/calendar.component.ts`.

**TDD del tamaño táctil (2026-10-02):** un primer CSS `min-height: 44px` elevó la medición visible a **42,22 CSS px** porque el test toma la caja al abrir el editor, mientras `app-modal` aún ejecuta `scaleIn` (200 ms, desde `scale(0.95)` hasta `scale(1)`). El área táctil cae bajo 44 durante esa animación; por ello el mínimo base se fijó en 48 px y se vuelve a medir el rectángulo renderizado en móvil.

**Hallazgo de teclado durante el flujo real (2026-10-02):** al pulsar Escape con la confirmación destructiva sobre el editor, ambos overlays se cierran aunque el foco está en el diálogo superior; los dos `ModalComponent` procesan el mismo `keydown` de documento, y al cerrar el superior el inferior pasa a ser «topmost» durante la propagación del mismo evento. La prueba unitaria existente de modales anidados no lo detectaba porque despachaba un `KeyboardEvent` Escape no cancelable. El flujo exige que solo se cierre la confirmación, el editor siga abierto y no haya petición DELETE.

**Hallazgo visual en ancho mínimo (2026-10-02):** la captura real del flujo de error en Pixel 5 a **320×568** muestra el botón «Guardar cambios» recortado en el borde derecho del modal. El documento no presenta overflow, por lo que la aserción global de `scrollWidth` no detecta el recorte interno. El editor necesita una prueba geométrica que exija que cada acción quede dentro del `role=dialog`; conservar además el scroll del cuerpo del modal.

**Hallazgo de scroll del modal (2026-10-02):** después de reordenar las acciones a dos filas, al llevar «Guardar cambios» a la vista en 320×568 el E2E mide `document.scrollingElement.scrollTop = 10` (debería seguir en 0). El desplazamiento puede escaparse al documento detrás del overlay en vez de resolverse solo en `.modal__body`; la verificación exige que, si el cuerpo tiene overflow, el scroll se produzca ahí y el fondo permanezca inmóvil.

**Hallazgo visual del aviso de error (2026-10-02):** la captura 320×568 muestra el toast fijo superior encima del encabezado y del contenido inicial del editor, porque `.toast-container--top` usa `z-index: 1100` frente al overlay del modal (`z-index: 1000`). La política de fallo es mantener el mensaje localizado y `role=alert` sin ocultar el formulario; al ser un error de la comida que sigue abierta para reintento, el aviso contextual debe acompañar al editor y desaparecer al cerrar o completar el reintento.

**Evidencia funcional final y deuda de cobertura (2026-10-02):** TDD reprodujo el 503 con comida optimista desaparecida, éxito falso y toast global duplicable; pruebas reales adicionales reprodujeron Escape que cerraba ambos modales, el target de 33,59 px, el recorte de «Guardar cambios» y el toast que tapaba el editor a 320×568. La solución usa el booleano correcto de `deleteMeal`, `SILENT_TOAST`, aviso contextual `role=alert` ES/EN dentro del formulario, target base de 48 px, distribución en dos filas a ≤360 px, y scroll confinado dentro del modal; Escape consume el evento al cerrar solo el diálogo superior.

Karma focal ejecutó **37/37** pruebas para `CalendarService`, `CalendarComponent`, diccionario ES/EN y `ModalComponent`. Playwright aislado con rate limit activo, SQLite/puertos/semilla temporales: `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --grep "conserva la comida y permite reintentar" tests/e2e/calendar.spec.ts` pasó **2/2**. Verificó Cancelar y Escape sin DELETE, foco dentro de confirmación, 503 con recuperación GET/aviso único y accesible, retry 200, borrado persistido tras reload, sin `pageerror`, overflow horizontal ni desplazamiento del documento; a 320×568 todas las acciones caben y el aviso no tapa el encabezado. Capturas sintéticas PC/Pixel 5 y 320×568 inspeccionadas: `.e2e-screenshots/qa-calendar-delete-failure/{chromium.png,mobile-chrome.png,mobile-chrome-320x568-top.png,mobile-chrome-320x568-actions.png}`.

`tsc -p tsconfig.e2e.json --noEmit` y `npm run build:prod` pasan; el build conserva advertencias previas de imports/tipos y budget (calendar component styles 14,62 kB frente a 10 kB). `git diff --check` pasa. En la ejecución histórica del 2026-10-02, Prettier señaló cinco ficheros (`dict/calendar.ts`, `dict-simetrico.spec.ts`, `calendar.service.ts`, `calendar.component.ts`, `tests/e2e/calendar.spec.ts`); se comprobó entonces que también fallaban `--check` en el `HEAD` de esa fecha y no se reformateó código ajeno. La suite completa ejecutó **825/825** tests, pero el gate configurado de 80 % fallaba: **74,16/61,09/72,30/75,62 % S/B/F/L**. Cobertura por archivo en esa línea base: `calendar.service.ts` **49,71/44,12/24,68/51,01 %**, `calendar.component.ts` **20,14/1,77/5,13/22,25 %**, `dict/calendar.ts` **100/—/—/100 %** y `modal.component.ts` **92,39/83,33/100/93,33 %**. La casilla permaneció abierta entonces; la revalidación siguiente la cierra para esta unidad, no para la auditoría global `/calendar`.

**Revalidación de cobertura (2026-10-08, HEAD `4a92e82`):** `pnpm run test:client` pasa **1194/1194** y conserva el gate global **90,29/81,39/88,99/91,71 % S/B/F/L**. Cobertura focal actual: `calendar.component.ts` **87,88/80,47/80,79/90,26 %**, `calendar.service.ts` **95,94/80,95/92,13/95,95 %**, `dict/calendar.ts` **100/100/100/100 %** y `modal.component.ts` **92,39/83,33/100/93,33 %**; todos los archivos de producción tocados superan ≥70 % en las cuatro métricas. `pnpm run typecheck:e2e`, `pnpm run check:ui` (**210 ficheros/21 reglas**), `pnpm run build:client`, Prettier para los cinco ficheros de la unidad y `git diff --check` pasan; se dio formato únicamente a las 4 líneas necesarias de `dict-simetrico.spec.ts`. El build solo reporta advertencias preexistentes de presupuesto/imports/tipos. No se redujo ningún gate. La E2E aislada y capturas sintéticas PC/Pixel 5 constan en la evidencia funcional de arriba. La checklist general `/calendar` sigue pendiente.

**Revalidación del foco (2026-10-09):** la suite amplia inicial encontró 92 aprobadas, 3 omitidas y 3 fallidas. Dos eran defectos deterministas: la aserción del mini-calendario aceptaba `view=month` antes de que desapareciera `date`, y en móvil el retorno de foco desde la confirmación de borrado dejaba el aviso fuera de contexto visual. La tercera fue `ERR_NO_BUFFER_SPACE` al registrar una prueba en Windows; no reapareció en la ejecución focal ni en la repetición amplia. TDD hizo fallar primero la E2E por falta de foco en el aviso. Tras esperar ambos parámetros URL y enfocar el `role=alert` después del render, la E2E focal de borrado pasó **2/2** (Chromium y Pixel 5, incluido 320×568) y el spec unitario focal de `CalendarComponent` pasó **47/47**. La suite de las 12 rutas calendar en ambos proyectos pasó **95**, omitió **3** por condiciones de proyecto existentes y no tuvo fallos (6,9 min):

```sh
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/calendar-all-day-gutter.spec.ts tests/e2e/calendar-checkbox.spec.ts tests/e2e/calendar-completion.spec.ts tests/e2e/calendar-early-hours.spec.ts tests/e2e/calendar-goals-save.spec.ts tests/e2e/calendar-google-like-ui.spec.ts tests/e2e/calendar-household-context.spec.ts tests/e2e/calendar-mobile-header-layout.spec.ts tests/e2e/calendar-number-locale.spec.ts tests/e2e/calendar-range-order.spec.ts tests/e2e/calendar-replan.spec.ts tests/e2e/calendar.spec.ts --reporter=line
```

Se inspeccionaron capturas sintéticas del error, sin datos personales, para 1280×720, Pixel 5 (393×851) y ancho mínimo 320×568: `.e2e-screenshots/qa-calendar-delete-failure/{chromium.png,mobile-chrome.png,mobile-chrome-320x568-top.png,mobile-chrome-320x568-actions.png}`. El aviso permanece bajo el encabezado, recibe foco real y el flujo conserva el reintento; el scroll del formulario queda en el modal. DB, servidor y puertos fueron aislados por el runner; no se llamó a IA real. `pnpm run typecheck:e2e`, `pnpm run check:ui` (**212 ficheros/21 reglas**), Prettier de los cuatro archivos modificados y `git diff --check` pasan. El cierre de publicación y CI se registra tras el commit atómico.

## Unidad QA-CALENDAR.RANGE-ERROR.1 · error y reintento de la carga visible

**Fuente revalidada (2026-10-09):** el criterio activo `/calendar` de esta spec requiere verificar recarga y error; `CalendarService.loadRange()` conserva el rango anterior, guarda un error localizado y deja reintentar la misma fecha. Antes del cambio, la vista mostraba el error sin rol de anuncio, mantenía el estado «Nada planificado» y el GET no marcaba `SILENT_TOAST`. Contrato: el error inicial debe anunciarse como alerta accesible, no fingir que el periodo está vacío ni duplicarse con un toast, mantener un reintento de teclado y limpiar el error al recuperar HTTP 200; los datos cargados previamente se conservan. Ninguna escritura ni llamada a IA.

- [x] Añadir primero E2E aislada con primera respuesta `GET /api/calendar/range` 503; el baseline falló en Chromium y Pixel 5 por falta de anuncio accesible y estado vacío engañoso antes de modificar producción.
- [x] Silenciar el toast común solo para la carga que ya tiene feedback local, anunciar el error como `role=alert` y ocultar el resumen/estado vacío mientras la carga falla, sin borrar comidas/rango previamente cargados.
- [x] Añadir aserción unitaria de `SILENT_TOAST` para la petición de rango; probar E2E de error → reintento por Enter → 200, error despejado y estado vacío legítimo solo tras respuesta correcta.
- [x] Validar Chromium escritorio y Pixel 5 (incluido 320×568), foco/teclado/overflow, capturas sintéticas inspeccionadas, `typecheck:e2e`, `check:ui`, formato, build, coverage ≥70 % para producción tocada, hooks completos, push y CI del SHA de implementación.

**Evidencia local (2026-10-09):** TDD rojo: E2E aislada pre-cambio **2/2 fallos** (alerta sin `role=alert`; «Nada planificado» aparecía tras 503) y `CalendarService` **25/26** (GET sin `SILENT_TOAST`). Verde focal: E2E **2/2** (`chromium`, `mobile-chrome`/Pixel 5), incluida respuesta 200 vacía tras reintento Enter, ancho 320×568 sin overflow y ausencia del toast común; servicio **26/26**. Las comidas/rango previos quedan cubiertos por el caso unitario de fallo 503. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-calendar-range-error-verified-20261009/{chromium-range-error.png,mobile-chrome-range-error.png,mobile-chrome-320x568.png}`. `pnpm run test:client`: **1245/1245**, cobertura agregada **91.51/82.45/90.05/92.96 % S/B/F/L**; cobertura del alcance: `CalendarService` **95.95/80.95/92.13/95.96 %**, `CalendarComponent` **88.01/80.60/81.11/90.49 %**. `pnpm run build` pasa con warnings de budget/imports preexistentes en otras vistas; `typecheck:e2e`, `check:ui` (212 ficheros/21 reglas), Prettier focal y `git diff --check` pasan. Runner E2E usó servidor/SQLite temporales; sin IA ni escrituras en datos reales. Commit de implementación `7c887fb`; pre-commit y pre-push sin bypass pasaron, el push actualizó la rama y CI run **37928201856** (9/9 jobs) está verde.

**Rollback:** retirar el contexto silencioso, la semántica del aviso/condición del estado vacío y las regresiones; no hay cambios de datos ni migraciones.

## Unidad QA-04c.ERROR-INTERCEPTOR.1 · cobertura de errores HTTP compartidos

**Fuente revalidada (2026-10-02):** `frontend/src/app/core/interceptors/error.interceptor.ts` es el punto común de traducción de errores y avisos; traduce respuestas 400/401/403/404/409/422/429/500/503, conserva errores cliente, agrupa avisos por estado durante 4 s (30 s en 401/429), lee `Retry-After`, respeta `SILENT_TOAST` y omite el toast 401 en rutas de autenticación. No hay spec unitaria del interceptor. La suite frontend ya tiene ejecución completa registrada, pero no cubre este módulo directamente; no se cambiará su comportamiento en esta unidad. El contrato observable a fijar es que el interceptor anuncie como máximo el aviso debido y siempre propague `status`, mensaje localizado y error original al consumidor.

- [x] Añadir primero pruebas unitarias para códigos mapeados, fallback/body message, error de cliente y estado desconocido; verificar payload reenviado sin pérdida.
- [x] Cubrir `SILENT_TOAST`, la exclusión de login/register/refresh/me para 401 y los límites de throttle 4 s/30 s con reloj controlado.
- [x] Cubrir `Retry-After` en header y cuerpo, valores inválidos/no positivos, y traducciones ES/EN en errores presentados.
- [x] Alcanzar 100 % de statements/branches/functions/lines en `error.interceptor.ts`; el gate global frontend configurado de 80 % permanece íntegro.
- [x] Reejecutar un flujo Playwright aislado real que falle una acción HTTP y compruebe el aviso accesible/ausencia de toast duplicado; DB/puertos/semillas propios, rate limit activo y cleanup.
- [x] Ejecutar suite focal, build, formato y `git diff --check`; registrar el resultado de coverage global sin declarar cerrado QA-04c. No hay cambios visuales, capturas PC/móvil: N/A; rollback: eliminar el spec focal y esta sección, sin tocar producción.

**Evidencia QA-04c.ERROR-INTERCEPTOR.1 (2026-10-02):** el primer pase focal fue 7/8: el cambio de idioma en `I18nService` necesita vaciar efectos antes de leer la traducción, corregido con `TestBed.flushEffects()`. La suite completa encontró además que los specs podían compartir el `recentlyShown` a nivel de módulo: se aumentó la separación del reloj falso entre specs a una hora, manteniendo comprobaciones exactas en 4.000/4.001 ms y 30.000/30.001 ms. Tras el ajuste, `npm run test -- --include=src/app/core/interceptors/error.interceptor.spec.ts --browsers=ChromeHeadlessLocal`: **8/8**. Reporte focal de `error.interceptor.ts`: **40/40 statements, 41/41 branches, 4/4 functions y 38/38 lines (100 %)**.

El flujo UI Playwright actual `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --grep "conserva la comida y permite reintentar" tests/e2e/calendar.spec.ts`, con `E2E_RATE_LIMIT=on` y Chrome local, pasó **2/2**. En Chromium y Pixel 5 provocó un 503 sintético en DELETE sobre stack aislado; comprobó alerta accesible única, cero toast global duplicado, reintento confirmado y limpieza de SQLite/puertos propios. No se utilizó proveedor IA ni `localhost:4200`.

La suite completa `npm run test -- --browsers=ChromeHeadlessLocal --progress=false` terminó finalmente **833/833**; el gate global existente sí falla por coverage: **74,77/62,58/72,46/76,29 % S/B/F/L**, contra 80 % en cada métrica (branches además bajo 70 %). Una corrida inmediatamente anterior tuvo un fallo no reproducido; la repetición capturada no registró fallos funcionales. `npm run build:prod`, Prettier focal (`frontend/src/app/core/interceptors/error.interceptor.spec.ts`) y `git diff --check` pasan. Build conserva warnings previos de budget e imports. No se modificó código de producción; QA-04c global y el barrido funcional completo siguen abiertos.

## Unidad QA-AUTH.INTERCEPTOR.REFRESH.1 · resolver todas las peticiones tras expirar la sesión

**Fuente revalidada (2026-10-02):** `HOGARIA-SPEC.md` fija access token de 15 minutos, refresh token de 30 días y borrado explícito de credenciales al cerrar sesión; no define el fallo concurrente del refresh. El código actual separa peticiones concurrentes con un `BehaviorSubject` que solo libera al recibir token no nulo. Sin embargo, `AuthService.refreshToken()` convierte 401/ausencia de refresh token en `of()` tras cerrar sesión; el `switchMap` principal del interceptor completa vacío sin resetear `isRefreshing`, y las peticiones concurrentes quedan esperando indefinidamente. Además, el `catchError` actual envuelve también `next(clonedReq)`: si una petición reintentada falla con 503, lo trata como error del refresh y cierra sesión sin motivo. Conducta esperada inferida de UX/seguridad: cada petición debe terminar con error (nunca completar falsamente ni quedar colgada), la sesión debe cerrarse solo ante fallo de autenticación/refresh, una renovación exitosa debe reintentar cada petición a lo sumo una vez con el token nuevo, y endpoints públicos/refresh no deben iniciar un refresh recursivo.

- [x] Añadir primero unitarias que reproduzcan refresh vacío/fallido con dos peticiones simultáneas y demuestren que ambas quedan pendientes antes del arreglo.
- [x] Cubrir no-token, token en header, endpoints públicos y `/auth/refresh`, renovación exitosa, fallback de token, refresh sin token resultante, error HTTP y completion sin valor.
- [x] Al fallar el refresh, liberar todos los esperadores, rechazar cada petición protegida y mantener el comportamiento de logout sin contaminar un intento posterior.
- [x] Propagar sin logout el error de una petición ya reintentada cuando el refresh había tenido éxito.
- [x] Ejecutar una Playwright real aislada con sesión sintética expirada y refresh inválido; comprobar retorno a login y que todas las solicitudes concluyen tanto en escritorio como Pixel 5, con rate limit, DB/puertos propios y cleanup.
- [x] Alcanzar ≥70 % S/B/F/L en cada archivo de producción tocado; mantener el gate global configurado de 80 %, hacer build/typecheck/formato/diff checks y dejar QA-04c y el barrido `/account` abiertos hasta completar sus demás flujos.
- [x] No cambia el diseño visual; se capturaron e inspeccionaron estados sintéticos en escritorio y móvil. No usar tokens reales; rollback: revertir únicamente interceptor, specs unitarios/E2E y esta sección.

**Evidencia QA-AUTH.INTERCEPTOR.REFRESH.1 (2026-10-02):** TDD reprodujo que una respuesta de refresh vacía (la forma en que `AuthService` termina tras un 401 y logout) completaba la petición inicial, no resolvía la concurrente y dejaba `isRefreshing` activo; también encontró que un 503 de la petición reintentada se confundía con error del refresh y cerraba sesión. El cambio limita el manejo de fallo al observable de refresh, convierte completion vacío en fallo explícito, libera a todos los esperadores y no repite logout ya ejecutado por `AuthService`. Las pruebas unitarias enfocadas pasan **11/11**; `auth.interceptor.ts` alcanza **100/100/100/100 % S/B/F/L** (47/47 statements, 17/17 branches, 13/13 functions, 40/40 lines).

`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-refresh-failure.spec.ts`, con rate limit, Chrome local y DB/puertos/semilla aislados: **2/2**. En escritorio y Pixel 5, siete peticiones protegidas y el refresh inválido concluyen, las credenciales sintéticas se limpian, la app vuelve a login, sin `pageerror` ni overflow; cleanup propio completado. Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-auth-refresh-failure-20261002/{desktop.png,mobile.png}`. No se utilizó el servidor habitual en `localhost:4200` ni el proveedor IA.

**Reparación de fiabilidad E2E (2026-10-10):** CI `38024229940` falló esperando que terminara el conjunto de peticiones protegidas. El test anterior instalaba listeners antes del registro y vaciaba sus contadores al terminarlo; respuestas tardías del bootstrap podían mezclarse con la navegación probada. Ahora espera a que el dashboard aislado quede sin tráfico inicial, observa solo la recarga con el JWT sintético inválido, excluye `/api/auth/refresh` del conjunto protegido y descuenta cada petición al recibir `requestfinished` o `requestfailed`. Repetición local con rate limit y almacenamiento/puertos aislados:

```powershell
$env:E2E_RATE_LIMIT='on'
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome --repeat-each=3 --forbid-only tests/e2e/auth-refresh-failure.spec.ts --reporter=line
```

Pasó **6/6**; cada ejecución confirmó cleanup. `pnpm run typecheck:e2e`, Prettier focal y `git diff --check` pasan. Sin cambios de producción ni proveedor IA; pendiente CI del cambio. Rollback: revertir solo la instrumentación del test y retirar esta evidencia; no hay cambio de producción.

La suite frontend completa pasa **844/844**, aunque su gate configurado de **80 %** falla y no se redujo: **74,97/62,80/72,66/76,47 % S/B/F/L**. `npm run build:prod`, `tsc -p tsconfig.e2e.json --noEmit`, Prettier local focal y `git diff --check` pasan. El build conserva advertencias existentes de budget/imports; QA-04c, el barrido `/account` y el resto del barrido funcional siguen abiertos.

## Unidad QA-AUTH.LOGIN-401.FEEDBACK.1 · error de credenciales sin falso aviso de sesión

**Fuente revalidada (2026-10-03):** `HOGARIA-SPEC.md` §12n exige suprimir el aviso global de sesión caducada cuando el 401 pertenece al login, cuya pantalla debe indicar el error junto al campo. `error.interceptor.ts` suprime el toast global de `/api/auth/login`, pero devuelve al componente el mensaje global «la sesión de este navegador ya no vale»; `LoginComponent.onSubmit()` vuelve a mostrar cualquier error como toast y no llena `passwordError`. Por eso una respuesta de credenciales inválidas se presenta como sesión caducada, igual que en la captura reportada. `tests/e2e/auth.spec.ts` solo comprobaba quedarse en login, no el contenido ni el canal del error. No se usa la cuenta ni los datos personales visibles en la captura.

Conducta esperada: un 401 del login muestra «Credenciales incorrectas» de forma accesible junto a la contraseña, no muestra el aviso de sesión ni otro toast duplicado y conserva la página para reintentar. Fallos de red/servidor mantienen un mensaje recuperable; una autenticación exitosa conserva su flujo normal.

- [x] Añadir primero una regresión unitaria que reproduzca el 401 de login como toast de sesión caducada y sin error junto al campo.
- [x] Mostrar un 401 de autenticación en el formulario como error localizado de credenciales; no alterar la recuperación de fallos de red/servidor ni el login exitoso.
- [x] Verificar en E2E aislada con respuesta 401 sintética en escritorio y Pixel 5 que no aparece el toast engañoso, el formulario sigue utilizable y se puede volver a intentar; no usar credenciales reales ni la DB habitual.
- [x] Ejecutar los checks focales, build, typecheck, formato y `git diff --check`; guardar e inspeccionar capturas sintéticas PC/móvil sin datos personales.

**Rollback:** revertir únicamente la validación de error del formulario, su regresión unitaria/E2E y esta sección; no modifica sesión, tokens ni credenciales persistidas.

**TDD rojo (2026-10-03):** se añadió primero la regresión a `login.component.spec.ts` y se ejecutó `pnpm --filter @hogaria/web exec ng test --no-watch --include=src/app/features/auth/login/login.component.spec.ts --browsers=ChromeHeadlessLocal --progress=false`: **6/7** pasan; falla la aserción que exige `auth.credenciales_incorrectas` junto al campo y ningún toast. El código actual deja `passwordError` vacío y emite el mensaje genérico de sesión.

**Evidencia verde (2026-10-03):** Karma/ChromeHeadless ejecutó **909/909** pruebas. La cobertura actual de `login.component.ts` es **100/87.5/100/100 % S/B/F/L**, por encima del mínimo por archivo. El proceso informa que el agregado frontend permanece bajo su gate existente de 80 %: **77.42/64.51/75.64/79.00 %**; los umbrales no se modificaron y el reporte se aisló en `%TEMP%`, dejando `frontend/coverage` intacto. E2E aislada con Chromium y Pixel 5: **2/2**; credenciales incorrectas muestran el error accesible junto al campo, sin toast de sesión, permiten reintentar y las credenciales sintéticas válidas llevan al dashboard. Capturas inspeccionadas: `%TEMP%\hogaria-e2e-3OFVTS\artifacts\auth-Authentication-shows--9f9bf-ad-of-a-stale-session-toast-chromium\login-invalid-credentials-chromium.png` y `%TEMP%\hogaria-e2e-3OFVTS\artifacts\auth-Authentication-shows--9f9bf-ad-of-a-stale-session-toast-mobile-chrome\login-invalid-credentials-mobile-chrome.png`. `pnpm run typecheck:e2e`, `pnpm run check:ui`, build de producción Angular, Prettier focal y `git diff --check` pasan. El build mantiene avisos de presupuesto/imports en componentes no relacionados.

## Unidad QA-AUTH.REGISTER-INVITE.1 · conservar la invitación al registrarse

**Fuente revalidada (2026-10-03):** la pantalla `/invite/:code` ofrece registro con `?code=`; la ruta de registro conserva el código para que, tras crear la cuenta, esta se una al hogar invitante. La checklist general de `/auth/register` y `/invite/:code` sigue abierta para sus demás casos; esta unidad cubre solo la transición registro-desde-invitación y su persistencia.

- [x] Crear en E2E un hogar/owner sintéticos, abrir una invitación válida, seguir su enlace de registro y comprobar que conserva el mismo código.
- [x] Registrar un invitee sintético y comprobar respuestas HTTP exitosas, exactamente un POST de registro para el invitee y una unión, dos miembros y persistencia tras recargar.
- [x] Ejecutar el full-stack real aislado en Chromium escritorio y Pixel 5, con rate limit activo y cleanup; capturar errores JS de página. Cobertura unitaria de producción: N/A, no cambia código de producción; capturas: N/A, no cambia UI.

**Evidencia QA-AUTH.REGISTER-INVITE.1 (2026-10-03):** el primer run falló solo porque el contador de la prueba incluía el registro del owner además del invitee; el flujo real ya completaba registro 201, unión 200 y persistencia. Se reinició el contador tras preparar el hogar y antes de enviar el formulario del invitee. Con `E2E_RATE_LIMIT=on` y `E2E_CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe`, `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts --project=chromium tests/e2e/full-stack/register-invite.spec.ts` pasó **1/1**; el mismo comando con `--project=mobile-chrome` pasó **1/1**. Cada runner usó SQLite, puerto, semilla y artefactos temporales propios; confirmó cleanup tras detener su proceso de app. Sin `pageerror`; no se usó la base habitual ni una cuenta real.

**Rollback:** revertir únicamente `tests/e2e/full-stack/register-invite.spec.ts` y esta unidad de checklist; no cambia el comportamiento de producción.

## Unidad QA-AUTH.REGISTER.FORM.1 · completar errores y recuperación del alta

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §8b define que el alta pide solo nombre, correo y contraseña. El cliente valida nombre 2–100 caracteres, formato de correo y contraseña de al menos 6 caracteres, mayúscula, número y máximo bcrypt de 72 bytes; `server/src/schemas/auth.schema.ts` mantiene los límites de nombre/correo y `bcryptPasswordSchema`. `RegisterComponent` muestra error 409 para correo duplicado, 429 para límite de frecuencia y mensaje genérico recuperable para los demás estados; al éxito, sin código entra en onboarding y con `?code=` intenta unirse al hogar. Ya existen E2E de formato/política, límites, conflicto/doble envío, registro normal y transición de invitación. La cobertura de navegador no comprueba todavía que email y contraseña vacíos se anuncien como requeridos ni el estado visible y reintento tras un 500; los tests unitarios de `RegisterComponent` no sustituyen esas interacciones reales.

- [x] E2E aislada: completar campos uno por uno y verificar requerido de nombre/correo/contraseña, formato inválido, errores accesibles asociados al input y cero POST mientras la validación cliente no pasa.
- [x] E2E aislada: retener la primera solicitud válida, comprobar loading/submit deshabilitado, devolver 500 sintético, exigir un único mensaje genérico accesible, datos conservados y formulario reintentable; reintentar contra el backend aislado y confirmar 201 y entrada a onboarding.
- [x] Revalidar `register-contract.spec.ts` (full-stack 12/12), `auth-flow.spec.ts` (4/4), el caso de registro UTF-8 de `auth-password-byte-limit.spec.ts` (2/2) y `register-invite.spec.ts` (2/2) en Chromium escritorio y Pixel 5; rate limit activo, SQLite/puerto/semilla por runner y cleanup. El caso de cambio de contraseña que falló en 568×320 se separó a QA-AUTH.PW-LIMIT.ALERT-LANDSCAPE.1 y no se ocultó con un skip.
- [x] No se tocó producción: cobertura focal N/A; typecheck E2E, Prettier y `git diff --check` pasan. Las capturas PC/móvil no aplican a esta unidad de pruebas, que no altera la UI.

**Evidencia QA-AUTH.REGISTER.FORM.1 (2026-10-08):** el registro completo pasa en stack de producción aislado, Chromium + Pixel 5, con `register-contract.spec.ts` **12/12**; incluye los requeridos accesibles, errores ES/EN, límites de nombre/contraseña, 409 recuperable, doble envío, 500 sintético sin revelar el detalle y retry 201. El flujo de autenticación `auth-flow.spec.ts` pasa **4/4**; `auth-password-byte-limit.spec.ts --grep 'registro rechaza'` **2/2**; `register-invite.spec.ts` full-stack **2/2**. Los runners confirman cleanup y no usan datos reales ni proveedor IA. El primer intento de simular 500 expiró porque Angular NGSW interceptaba el POST y Playwright `page.route` no recibía la petición; el test bloquea service workers solo en `register-contract.spec.ts`, tras lo que el grupo pasó 12/12. La revalidación aparte del flujo completo de cambio de contraseña halló la nueva discrepancia 568×320, que permanece abierta en la subunidad siguiente.

**Rollback:** revertir solo las pruebas de registro incorporadas en esta unidad y esta sección; cualquier cambio de producción tendrá que formar parte del mismo commit atómico y ser reversible con él.

## Unidad QA-CALENDAR.NUMBER-LOCALE.1 · respetar el idioma activo al formatear calorías

**Fuente revalidada antes de implementar (2026-10-02):** el contrato vigente de internacionalización en `HOGARIA-SPEC.md` §12t centraliza `dateLocale()` en `core/time.ts` y exige que fechas y números —incluidas las kcal del calendario— sigan el idioma de la app; `I18nService.aplicaLocale()` cambia ese locale al alternar ES/EN. `calendar.util.ts` crea `numberFmt` en el ámbito del módulo con el locale que exista al importarlo, y `formatNumber()` lo reutiliza de por vida; a diferencia de `labels`, no consulta el idioma actual. El resultado puede conservar el separador español tras cambiar a inglés. No hay actualmente un spec unitario dedicado para `calendar.util.ts`. La conducta esperada es que la misma función refleje el locale activo en cada llamada, preservando su redondeo y la semántica de fecha local.

- [x] Añadir primero una regresión unitaria que cambie `dateLocale` de `es-ES` a `en-GB` después de importar el helper; reproducir que `formatNumber(1450)` conserva el separador español y restaurar el locale al terminar cada spec. La prueba inicial también reprodujo la rejilla truncada.
- [x] Cubrir helpers de calendario: round-trip ISO local y fechas malformadas/bisiestas, suma de días/meses en bordes de mes y cambio DST, semanas que empiezan en lunes, rejillas mensuales completas de 4–6 filas, diferencia de días y etiquetas del mismo mes/entre meses en ambos idiomas.
- [x] Corregir el mínimo necesario para que el formateador siga cambios de idioma sin capturar un formatter obsoleto; verificar redondeo, cero y valores negativos. La rejilla calcula las semanas con el desplazamiento real del primer día del mes.
- [x] Alcanzar ≥70 % en statements/branches/functions/lines de cada archivo de producción tocado; no reducir el gate global de 80 %. Ejecutar build, typecheck, formato y `git diff --check`.
- [x] Playwright real y aislado en Chromium escritorio y Pixel 5: fixture sintética con calorías visibles, cambiar ES→EN→ES y comprobar el separador en el calendario, sin errores de consola ni overflow; usar DB/puertos propios y confirmar cleanup.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil del mismo estado y revisar que no contengan datos personales; documentar el resultado actual del gate global y dejar abiertas las demás rutas/unidades de QA.

**Evidencia QA-CALENDAR.NUMBER-LOCALE.1 (2026-10-02):** la regresión de `formatNumber(1450)` falló antes del arreglo al conservar es-ES tras cambiar a en-GB; pruebas adicionales encontraron una rejilla de agosto de 2020 con 35 celdas en vez de 42. `formatNumber()` cachea formatter por locale activo y conserva redondeo; la rejilla incluye el offset de lunes. Karma focal ejecutó **9/9** y `calendar.util.ts` mide **100 %** en statements (57/57), branches (18/18), functions (25/25) y lines (53/53). La corrida focal con `--code-coverage` también ejecutó 9/9, pero el comando devuelve exit 1 porque el gate local existente de 80 % se evalúa sobre el subconjunto (aggregate: S39.26/B18.81/F60/L44.11); no se modificó el umbral. La suite completa previamente documentada sigue bajo el gate frontend y su casilla permanece abierta.

Playwright aislado en Chromium escritorio y Pixel 5: **2/2**. La misma sesión cambia ES→EN→ES desde Ajustes, crea una receta/calendario sintéticos, verifica separador de miles en resumen y celda visible en escritorio, sin overflow en móvil ni errores de consola; SQLite/puertos temporales se limpiaron. Capturas inspeccionadas: `.e2e-screenshots/calendar-locale-qa/calendar-locale-chromium.png` y `calendar-locale-mobile-chrome.png`. `npx tsc -p tsconfig.e2e.json --noEmit`, build de producción, Prettier focal y `git diff --check` pasan.

**Rollback:** revertir la unidad atómica de `QA-CALENDAR.NUMBER-LOCALE.1` junto a su test unitario/E2E y esta sección; no cambia datos ni migraciones.

## Unidad QA-RECEIPT-QUEUE.ACTIONS.1 · detener y reintentar desde la cola global de tickets

**Fuente revalidada antes de implementar (2026-10-02):** `HOGARIA-SPEC.md` §12aj exige que el panel del icono permita parar todo, detener un trabajo queued/running y reintentar uno failed/stopped; el retry debe borrar sus líneas parciales antes de procesar de nuevo. `ReceiptQueueComponent` llamaba a `ReceiptsService` para esas acciones y actualizaba la vista con un refresh, pero no tenía prueba unitaria. `tests/e2e/receipts.spec.ts` solo comprobaba que aparecía el botón de retry sin pulsarlo; su prueba de «Parar todo» usaba una subida sin proveedor y condicionaba el click a que el botón existiera, por lo que no acreditaba transición ni aborto reales. Las E2E del gestor IA por proveedor verificaban su propio dispatcher, no los controles del icono de tickets. Se conserva el panel global ya presente; esta unidad verifica sus acciones y su ciclo de datos, no reabre la geometría cerrada en QA-UI.1.

**Evidencia QA-RECEIPT-QUEUE.ACTIONS.1 (2026-10-02):** una primera E2E reprodujo que «Abrir» cerraba sin navegar porque el panel se desmontaba antes del click de `RouterLink`; también midió «Parar» con solo 22 px de alto. Se movió el cierre a `NavigationEnd` y se habilitó el `touchTarget` de los controles del panel. La E2E aislada intercepta Google Fonts (sin acceso externo), configura un proveedor sintético loopback y consulta los estados persistidos por API. Las capturas contienen solo fixture sintética.

**Revalidación CI (2026-10-08):** las fixtures E2E de streaming y respuesta sintética se alinearon con el
buffer de redacción y el esquema estricto vigente (incluidos `purchaseDate`, campos nullable y
`warnings`). La lectura del panel se sincroniza con el snapshot asíncrono y se usa el selector actual de
historial. Las suites de acciones y panel volvieron a pasar en Chromium y Pixel 5 con SQLite/puertos
temporales; el proveedor siguió siendo loopback, sin llamadas a servicios externos.

- [x] Unitarias de `watch/unwatch`, stop-all, stop por id en queued/running, retry por id en failed/stopped y job sin `receipt_id`; cada mutación refresca incluso al resolver el servicio con `null`. `frontend`: `node ./node_modules/@angular/cli/bin/ng.js test --no-watch --include=src/app/shared/components/receipts/receipt-queue.component.spec.ts --karma-config=karma.conf.js --browsers=ChromeHeadlessLocal --progress=false` — **9/9**.
- [x] Baseline Playwright aislado sin click condicional: `E2E_RATE_LIMIT=on`, `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/receipt-queue-actions.spec.ts`; el botón debe estar visible para hacer click. Proveedor solo `127.0.0.1` con hold/failure/success y oráculo de estados por API.
- [x] Chromium escritorio y Pixel 5: la prueba detiene en curso tras persistir línea parcial; comprueba `AbortController`, línea parcial conservada, «Abrir» navega y cierra el panel, retry desde el panel llega a review/done y deja únicamente la línea final.
- [x] «Parar todo» con running+queued: ambas fichas/job quedan stopped, la respuesta running se aborta y la línea incremental del running persiste; el queued no crea líneas.
- [x] `receipt-queue.component.ts`: coverage focal **100 %** statements (48/48), branches (10/10), functions (17/17), lines (42/42). E2E `tsc -p tsconfig.e2e.json --noEmit`, `frontend: npm run build:prod`, Prettier y `git diff --check` pasan; no se rebajó el gate global 80 %.
- [x] E2E final: **4/4** (Chromium + Pixel 5, dos escenarios por proyecto), sin errores JS/console/red observados; comprobados nombre accesible del diálogo, foco, Escape y botones con targets ≥44×44. El runner confirmó cleanup de SQLite, proceso y puertos. Capturas inspeccionadas: `.e2e-screenshots/receipt-queue-actions-qa/receipt-queue-chromium.png` y `receipt-queue-mobile-chrome.png`.

**Limitación de cobertura global:** al ejecutar solo este spec con `--code-coverage`, pasan sus 9 tests y la cobertura focal anterior es 100 %, pero Karma devuelve fallo por comparar el subconjunto contra el umbral global 80 % (aggregate parcial: S31.62/B10.85/F15.7/L33.25). El umbral no se cambió; ese resultado no representa la corrida completa de cobertura del frontend.

**Rollback:** revertir el commit atómico de `QA-RECEIPT-QUEUE.ACTIONS.1` con su unidad de pruebas/capturas y esta sección; no cambia datos ni migraciones.

## Unidad QA-RECEIPT.METADATA-HISTORY.1 · tienda/fecha detectadas, editables e historial

**Fuente revalidada (2026-10-03):** `ticket-prompt.ts` y `ticketAnswerSchema` aceptan la tienda,
pero no una fecha de compra. La tabla `receipts` tampoco tiene `purchase_date`; `created_at` es la
hora de subida y la UI la presenta como fecha del ticket (`receipts.component.ts` y
`receipt-detail.component.ts`). La ficha permite corregir la tienda, pero no tiene campo de fecha.
`GET /api/receipts` devuelve como máximo 100 recibos por `created_at`; la pantalla ya lista estados
`review` y `confirmed`, pero no etiqueta/separa un historial ni garantiza acceso a registros más
antiguos. Las E2E de recepción no verifican que un valor devuelto por IA se persista, se pueda corregir
y se conserve en recarga. El contrato nuevo de `HOGARIA-SPEC.md` §12ao prevalece sobre cualquier
descripción histórica de §12aj en lo relativo a fecha e historial; se mantiene la decisión de no usar
OCR.

Conducta esperada: la respuesta IA incluye `store` y `purchaseDate` (`YYYY-MM-DD` o `null` si falta o
es ambigua); no se deriva la fecha de `created_at`. La ficha permite editar y guardar ambos valores
desde todos los recibos con análisis terminado, incluidos los confirmados; corregir uno no confirma
de nuevo ni duplica movimientos de inventario. La sección «Historial» de `/receipts` conserva y permite
abrir todos los tickets con procesamiento terminado (`review`, `confirmed`, `failed`, `stopped`), no
los trabajos en curso; paginar es válido si se puede recorrer la colección completa. Ámbitos de hogar,
usuario y propiedad de adjuntos deben mantenerse.

Un error al consultar historial no equivale a una respuesta vacía: «sin tickets» solo aparece tras una
carga exitosa sin resultados; en error se muestra el aviso accesible y se conserva el reintento.

- [x] Escribir primero regresiones unitarias para prompt/validación/serialización: tienda detectada,
      fecha válida, fecha ausente, fecha civil imposible, año bisiesto y respuesta malformada. La fecha
      ausente nunca usa el timestamp de carga como fallback.

**TDD unitario (2026-10-03):** el rojo de `src/schemas/receipts.schema.spec.ts` y
`src/utils/ticket-prompt.spec.ts` produjo 11 fallos y 3 pases antes de producción: faltaba la fecha
en el contrato del prompt/esquema, se aceptaban días imposibles y no se rechazaba una respuesta sin
`purchaseDate` aunque incluyera `created_at`. Tras añadir fecha civil requerida o `null` y las reglas
del prompt, `pnpm --filter @hogaria/server exec vitest run src/schemas/receipts.schema.spec.ts
src/utils/ticket-prompt.spec.ts` pasa **14/14**. La ejecución inicial aislada bloqueó el subproceso
esbuild (`EPERM`); el mismo test focal pasó con ejecución local aprobada. Esta evidencia cierra solo
la casilla unitaria.

- [x] Añadir primero regresiones de rutas/SQLite en DB temporal: migración aditiva a `purchase_date`
      conserva los tickets existentes con fecha desconocida; POST/GET/PATCH persisten fecha y tienda,
      validan ownership y aislamiento entre usuarios/hogares, y una edición en ticket confirmado no
      repite el `confirm` ni cambia stock.

**TDD rutas/SQLite (2026-10-03):** las regresiones detectaron la ausencia de `purchase_date` en una
base heredada, fechas civiles inválidas aceptadas, PATCH metadata bloqueado tras confirmar y el límite
de 100 resultados sin paginación. Tras migración aditiva y rutas validadas,
`pnpm --filter @hogaria/server exec vitest run src/config/database.spec.ts
src/schemas/receipts.schema.spec.ts src/utils/ticket-prompt.spec.ts src/utils/ai-queue.spec.ts
src/routes/receipts.routes.spec.ts` pasa **63/63** en 5 archivos. Incluye persistencia/ownership,
aislamiento de hogar, metadata confirmada sin repetir efectos de inventario/precios y recorrido paginado
de más de 100 recibos con estados terminales; DB de test aislada.

- [x] Implementar la extracción multimodal sin OCR y persistencia de la fecha civil; E2E sintética
      loopback comprueba el JSON generado, la tienda/fecha en API y UI, valores null y su distinción de
      la fecha de subida, ES/EN y persistencia tras recargar/reabrir.
- [x] En UI, ambos campos tienen nombre accesible, operación por teclado, guardado/error recuperable y
      siguen editables en `review` y `confirmed`. Un valor manual guardado no puede perderse por una
      respuesta de análisis tardía/reintento.
- [x] Añadir un apartado visible «Historial» con los cuatro estados acordados, orden coherente por fecha
      de compra y subida, navegación al detalle y paginación/carga adicional si hay más resultados que
      el tamaño de página. E2E verifica tickets >100, recarga, búsqueda del más antiguo, apertura,
      estado vacío/error, autorización e idioma.
- [x] Ejecutar E2E real aislada en Chromium escritorio y Pixel 5, en 320×568, 393×851 y breakpoints del
      código: alta/análisis, corrección, confirmación, historial, recarga, navegación de teclado/foco y
      ausencia de overflow. Usar sólo fixture sintética, DB/puertos/semilla temporales, rate limit y
      cleanup; guardar e inspeccionar capturas PC/móvil sin datos personales.
- [x] Alcanzar ≥70 % de statements/branches/functions/lines por cada archivo de producción tocado, no
      reducir el gate frontend existente de 80 % ni el del server, ejecutar build/typecheck/formato/
      `check-ui` y mantener abierta cualquier casilla sin evidencia reproducible.
- [x] Añadir al gate por archivo del servidor el esquema, prompt y ruta de tickets con regresiones
      propias; mantener intacto el umbral existente del 70 % en las cuatro métricas.
- [x] Añadir tests unitarios focales de bandeja y ficha y comprobar ≥70 % por cada componente
      en statements/branches/functions/lines, sin reducir el gate global frontend.

**Límite de esta unidad:** los stubs loopback son regresión repetible del pipeline; no prueban la
calidad del modelo real. Esa comprobación se registra por separado en `QA-AI.REAL-INTEGRATIONS.1`.

**Evidencia UI/E2E (2026-10-03):** `receipts.service.spec.ts` pasa 11/11; la regresión de cola
comprueba que fecha/tienda manuales prevalecen ante respuesta del modelo y reintento (incluido `null`).
La ejecución final de `tests/e2e/receipts.spec.ts`, con servidor/SQLite aislados y rate limit activo,
pasa **18/18** entre Chromium escritorio y Pixel 5 (0 fallos, skips o pruebas flaky). El flujo sintético
completa carga fallida, edición de tienda/fecha, PATCH 503 seguido de reintento exitoso por teclado,
confirmación y edición posterior sin cambiar las unidades de inventario; verifica persistencia por API
y las etiquetas «Fecha de compra»/«Subido» en historial. La navegación pagina 105 tickets, muestra los
cuatro estados terminales, excluye trabajos activos y abre el más antiguo; la prueba del PDF verifica su
estado terminal. Resultados: `%TEMP%\hogaria-e2e-eyYgtr\results.json`; capturas de metadata/historial:
`%TEMP%\hogaria-e2e-eyYgtr\artifacts\receipts-tickets-la-cola-d-c5d43-tienda-precios-e-inventario-{chromium,mobile-chrome}\receipt-{metadata,history}.png`.

**Regresión error ≠ vacío (2026-10-03):** primero, la prueba de `receipts.component.spec.ts` falló
con **9 pases/1 fallo** porque un HTTP 503 mostraba el estado vacío de historial; tras condicionar ese
estado a carga exitosa, pasó **10/10**. La E2E final simula 503, comprueba aviso y reintento sin falso
vacío, y muestra vacío solo después de una respuesta exitosa sin resultados y tras recargar. También
verifica 401 directo a la API, redirección de sesión invitada a `/auth/login`, teclado y límites/overflow
en 320×568, 393×851, 480/481, 568×320, 640/641 y 1280×720. Capturas de error/reintento inspeccionadas:
`%TEMP%\hogaria-e2e-eyYgtr\artifacts\receipts-tickets-la-cola-d-0d122-intenta-y-protege-el-acceso-chromium\receipt-history-error-desktop.png`
y `%TEMP%\hogaria-e2e-eyYgtr\artifacts\receipts-tickets-la-cola-d-0d122-intenta-y-protege-el-acceso-mobile-chrome\receipt-history-error-mobile.png`.

**Loopback multimodal (2026-10-03):** el spec levanta un proveedor OpenAI-compatible en `127.0.0.1` con
puerto aleatorio, sin credenciales reales, que responde por SSE. Comprueba que el proveedor recibe el
prompt con `purchaseDate` e imagen sintética, y que tienda/fecha pasan de la respuesta a ficha, API e
historial tras recargar. Casos español con `2024-02-29` e inglés con `null` (sin fallback a subida):
**4/4** entre Chromium escritorio y Pixel 5. Ejecución aislada con `CI=true`, Chromium de sistema,
SQLite/puertos/semilla únicos y rate limit activo. El primer intento no pudo abrir el Chromium
empaquetado ausente; la repetición con `C:\Program Files\Google\Chrome\Application\chrome.exe` pasó.
Capturas sintéticas inspeccionadas en `%TEMP%\hogaria-e2e-6Ojcjp\artifacts\` (`receipt-loopback-es.png`
y `receipt-loopback-en.png` para escritorio y Pixel 5). `pnpm run typecheck:e2e` pasa. Tras recargar la
ficha, la geometría de ambos campos y el documento se verifica sin overflow en 320×568, 480/481 px,
568×320, 640/641 px y 1280×720 en ambos proyectos.

**Coverage de componentes de recibos (2026-10-03):** specs nuevas `receipts.component.spec.ts` (10/10)
y `receipt-detail.component.spec.ts` (25/25) pasan en ChromeHeadless. Medición focal instrumentada en
un directorio temporal externo, sin escribir `frontend/coverage`: bandeja **100/100/100/100 % S/B/F/L**;
ficha **98.63/88.75/100/100 %**. El comando focal deja el resumen global por debajo del gate porque ejecuta
solo dos specs; los umbrales del proyecto permanecen en 80 %. La cobertura global completa se reejecutó
por separado y su resultado vigente se registra a continuación.
Informe: `%TEMP%\hogaria-receipts-components-coverage-1b265243c8da4810bb2d23f749613628`.

**Revalidación global frontend (2026-10-03):** Karma/ChromeHeadlessLocal ejecutó **907/907** tests. Los
archivos de recibos cumplen el mínimo por archivo: `receipts.service.ts` **100/71.43/100/100 %**,
`receipts.component.ts` **100/100/100/100 %**, `receipt-detail.component.ts`
**100/88.75/100/100 %**, y `receipt-queue.component.ts` y `receipt-queue-position.ts` **100/100/100/100 %
S/B/F/L**. El gate global existente de 80 % falla en **77.41/64.50/75.64/78.99 % S/B/F/L**; branches
también está bajo 70 %. No se alteraron umbrales. El reporte global actualizado está en
`%TEMP%\hogaria-frontend-finalcov-580337b4f7dc4cb8b4a2f736fce6394d\coverage`; `frontend/coverage` quedó intacto.

**Cobertura del servidor (2026-10-03):** `server/vitest.config.ts` incluye ahora `receipts.routes.ts`,
`receipts.schema.ts` y `ticket-prompt.ts` en el gate por archivo, sin tocar umbrales. La revalidación
completa pasó **46/46 archivos y 943/943 pruebas**, con **93.01/84.52/94.81/95.45 % S/B/F/L** globales;
las rutas, esquema y prompt de tickets superan el 70 % por archivo. Reportes y SQLite se escribieron
solo bajo `%TEMP%`; `server/coverage` quedó intacto.

**Cierre local de QA-RECEIPT.METADATA-HISTORY.1 (2026-10-03):** completados los estados de historial,
el flujo de error/vacío, autorización, paginación, navegación, teclado y matriz responsive en E2E real
aislada; build, `typecheck:e2e`, `check-ui`, formato y `git diff --check` pasaron. La cobertura por archivo
de recibos cumple el 70 % sin rebajar gates. El gate global frontend permanece abierto y el smoke de
proveedores reales corresponde a `QA-AI.REAL-INTEGRATIONS.1`, fuera de esta unidad.

### QA-RECEIPT.STOPPED-METADATA.1 · edición desde el historial de un ticket parado

**Fuente revalidada (2026-10-03):** `receipts.spec.ts` ya siembra 105 tickets terminales y muestra el
estado «Parado» en el historial; la fixture `history-003` es uno de ellos. El test actual abre el más
antiguo (`history-000`), pero no abre ni edita un ticket `stopped`. `receipt-detail.component.spec.ts`
sí comprueba que la ficha permite editar `review`, `confirmed`, `failed` y `stopped`; se añade aquí
la prueba real de navegación/persistencia para cerrar la brecha de interacción del estado parado.

- [x] E2E real aislada: abrir desde el historial el registro terminal `stopped`, cambiar tienda y fecha,
      guardar por UI, verificar los metadatos por GET y reload, y comprobar que el estado sigue `stopped` sin
      confirmar ni tocar inventario. Usar la SQLite/puertos/semilla temporales del runner existente.
      **Evidencia QA-RECEIPT.STOPPED-METADATA.1 (2026-10-03):** el historial abre `history-003` con estado
      `stopped`; se editaron tienda y fecha desde la ficha, el guardado mostró éxito, el GET y la recarga
      conservaron ambos valores y el estado siguió parado. `node scripts/run-isolated-playwright.mjs
--workers=1 --project=chromium --project=mobile-chrome tests/e2e/receipts.spec.ts --grep 'recorre el historial completo'
--reporter=dot` pasó **2/2** (Chromium y Pixel 5); el runner confirmó parada de la app y limpieza de su
      SQLite/artefactos temporales. No hizo falta cambiar producción.

## Unidad QA-AI.REAL-INTEGRATIONS.1 · smoke real de proveedores IA

**Fuente revalidada (2026-10-08):** `server/src/utils/ai-client.ts` declara ocho `AiJobKind` y sus
rutas siguen en `ai.routes.ts`, `pantry.routes.ts`, `shopping.routes.ts` y `receipts.routes.ts`.
`tests/e2e/ai-real-smoke.spec.ts` cubre los ocho flujos, receta compleja, dos recetas distintas y una
foto sintética de estantería con modo `shelf`. El coordinador valida opt-in/CI, usa la WebAPI ya
levantada, ejecuta la aplicación con SQLite/puertos temporales y solo limpia los recursos que crea.
Una corrida live autorizada ya validó `gpt-5` texto+imagen y los ocho flujos: 10 completions, incluida
la recuperación de `receipt` de streaming HTTP 400 a no-stream HTTP 200. No se usaron tickets reales.
El alcance live solo prueba el modelo activo de esa WebAPI; no afirma cobertura de otros proveedores.

| `AiJobKind`        | Ruta de la aplicación                        | Aserción real mínima con fixture sintética                                                                        |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `connection_test`  | `POST /api/ai/test-connection`               | Veredicto válido del esquema JSON estricto.                                                                       |
| `recipe`           | `POST /api/ai/generate-recipe`               | Receta compleja con varios ingredientes y tres niveles de instrucciones válidos, mostrada en la UI.               |
| `multiple_recipes` | `POST /api/ai/generate-multiple-recipes`     | Dos borradores distintos/validables (`count: 2`) con despensa de varios ingredientes, ambos devueltos.            |
| `recommendations`  | `POST /api/ai/recommendations`               | Lista JSON de recomendaciones; admite inventario sintético vacío.                                                 |
| `weekly_plan`      | `POST /api/ai/plan-week`                     | Plan JSON con objetivos múltiples/custom, persistido en calendario/planificador.                                  |
| `expiry_estimate`  | `POST /api/pantry/expiry/estimate`           | Ingrediente sintético no catalogado recibe días estimados persistidos.                                            |
| `shopping_photo`   | `POST /api/shopping/lists/:id/photo/analyze` | Foto PNG sintética produce al menos una línea de compra editable.                                                 |
| `receipt`          | `POST /api/receipts`                         | Ticket PNG sintético; el modelo reconoce tienda y fecha impresas, la UI permite corregirlas y persiste historial. |

**Resolución de discrepancia para `multiple_recipes`:** la ruta no debe reportar éxito parcial ni aceptar
dos borradores equivalentes. Cada candidato debe ser utilizable por el flujo actual de mostrar/guardar
receta; la distinción se comprobará con una huella normalizada de nombre, ingredientes (nombre/cantidad/
unidad) y pasos (instrucción), no solo con el título. El prompt puede pedir variación, pero la validación
en servidor decide el éxito. Si una candidata no cumple el contrato de borrador o duplica otra, toda la
petición falla sin persistir recetas ni hacer llamadas correctivas.

El `retryAttempts: 0` debe establecerse al crear la configuración aislada (el valor omitido es 3;
PATCH/formulario no es evidencia de cero). Con el contrato actual, el máximo esperado es 9 completions:
una por integración salvo `multiple_recipes` (2); el recibo puede usar hasta 2 dentro de su único
intento si el stream cae antes del primer fragmento. Por tanto, el proxy aplica techo duro de **10**,
acepta 9–10 respuestas 2xx y falla ante cualquier exceso, ruta ausente, veredicto inválido o error
de limpieza. Concurrencia 1; parar en el primer fallo; no hacer reintentos manuales.

**Privacidad y aislamiento obligatorio (contrato vigente):** usar solo la WebAPI ya levantada en
`127.0.0.1:3001`; el smoke no inicia, detiene ni reconfigura ese servicio, sus logs, su perfil o su
base. El preflight es de solo lectura y valida identidad/readiness, ajustes de registro, grabación de
sesión, HTML diagnóstico y modelo. En la corrida autorizada el registro local estaba habilitado,
pero `maxBodyChars`, `maxHeaderValueChars` y `maxHeaders` eran 0; grabación de sesión y HTML
diagnóstico estaban desactivados. El permiso explícito `HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS=1`
acepta ese perfil acotado sin cambiarlo. Si la attestation falla, no se envía ninguna completion.
Cuando no hay bearer seguro en el entorno, se crea un único token propio, nunca expira y se borra y
verifica por ID al terminar; tokens preexistentes no se modifican. El bearer solo permanece en
coordinador/proxy, nunca en el runner. La app usa SQLite, puertos, semilla y artefactos temporales
aislados, con cleanup confirmado. Las imágenes y ticket usados son fixtures sintéticas; no se han
procesado tickets personales/reales.

El bearer WebAPI solo reside en memoria del coordinador y el proxy local que lo presenta a WebAPI;
si se crea para el smoke, no expira, pero se borra y verifica por ID al terminar. No se entrega al
runner Playwright ni al backend E2E: ese backend solo recibe una credencial aleatoria y limitada al
proxy, que no sirve para autenticarse en WebAPI.
Ninguna credencial aparece en argumentos, navegador, fuentes, specs, logs, capturas, traces, fixtures,
SQLite ni memoria persistente. El proxy solo reenvía a `127.0.0.1:3001`, rechaza redirects/hosts/rutas
ajenos, no guarda prompt/respuesta y expone únicamente estado, modelo, duración y uso/coste si WebAPI
los devuelve. El smoke es opt-in, prohibido en CI y excluido de la suite normal; el fallo o la omisión
nunca se reporta como verde. Una E2E sintética independiente seguirá comprobando que la suite normal
no contacta la red exterior.

- [x] Mantener la tabla exhaustiva alineada con el enum y rutas vigentes; el preflight live validó el modelo activo `gpt-5` con entrada texto+imagen sin imprimir bearer.
- [x] Usar attestation de solo lectura para la WebAPI existente; no iniciar/parar ni cambiar settings. Aislar DB/puertos/artifacts del runner y limpiar token/proxy/runner propios.
- [x] Completar el smoke opt-in con los ocho `AiJobKind`, presupuesto duro 10, una configuración activa, concurrencia 1, `retryAttempts: 0` al crear y parada ante el primer fallo.
- [x] Hacer que la E2E valide los contratos de cada resultado; el ticket sintético reconoció tienda/fecha, permitió edición UI y persistió historial tras recarga.
- [x] Para `shopping_photo`, usar fixture de estantería sintética distinta del ticket, elegir `shelf` desde el picker, verificar el payload y devolver un producto etiquetado editable antes de aplicar.
- [x] Mantener `server/src/routes/ai.routes.ts` con cobertura focal ≥70 % en statements, branches, functions y lines; incluir recomendaciones, persistencia de plan semanal y comparador de recetas con varios ingredientes.
- [x] Probar setup, opt-in/CI, allowlist, redacción, cancelación, exceso de presupuesto y cleanup; las suites sintéticas no contactan proveedor exterior y omisión/fallo es rojo.
- [x] Ejecutar una corrida live autorizada en el modelo activo; registrar solo modelo, resultado, recuento/latencia/uso y coste si está disponible. Mantenerla manual y fuera de CI.

**Evidencia focal de rutas AI (2026-10-03):** el baseline con las pruebas anteriores pasó **17/17**, pero `ai.routes.ts` quedó bajo el gate: **66.16/65/72.41/66.15 % S/B/F/L**. Se añadieron pruebas de recomendaciones con preferencias/comidas recientes, planificación semanal con persistencia y comidas bloqueadas, y una segunda receta con varios ingredientes para ejecutar el comparador. Con `DATABASE_PATH=:memory:`, el run final `pnpm --filter @hogaria/server exec vitest run --coverage.enabled --coverage.reportsDirectory=$report --coverage.include=src/routes/ai.routes.ts src/routes/ai.routes.spec.ts` pasó **20/20**; cobertura focal **83.83/72.50/96.55/83.58 % S/B/F/L**. El informe quedó en `%TEMP%\hogaria-ai-routes-coverage-20261003-r5`; `pnpm --filter @hogaria/server run build`, Prettier focal y `git diff --check` pasan. `fetch` del proveedor se sustituyó por fixture; sin llamadas externas.

**Revalidación sintética de QA-AI (2026-10-03):** `node --test scripts/ai-live-smoke-safety.test.mjs
scripts/ai-live-smoke-runner-control.test.mjs scripts/ai-live-webapi-supervisor.test.mjs` pasó **26/26**,
incluyendo opt-in/CI a nivel helper, presupuesto, allowlist/redacción, attestation, veto de puerto ocupado,
cancelación del runner y cleanup del proceso propio. `tests/e2e/ai-real-smoke.spec.ts` ejecutó además
su prueba loopback de seis tipos con fixture sintética (sin bearer/proveedor exterior), aislada con
`--config=playwright.ai-real-smoke.config.ts` y Chromium: **1/1**, DB/puertos temporales limpiados.
La configuración Playwright estándar excluye este archivo, por lo que se requiere la configuración
focal. Estas pruebas no ejecutaban entonces el coordinador con opt-in ausente/CI ni sustituían el
smoke real; la corrida live se completó en la revalidación posterior del 2026-10-08.

**Nota histórica (2026-10-04, sustituida por la revalidación del 2026-10-08):** `Get-NetTCPConnection`
no mostraba listener en `3001`, aunque los probes de Node alcanzaban `web-api`; no se podía atribuir
dueño al proceso ni validar bearer/modelo. En ese momento no hubo completions live y el runner aún
iniciaba/reconfiguraba una WebAPI propia. Esa ruta quedó sustituida: la implementación vigente usa la
instancia existente, no cambia su configuración y la corrida real queda documentada arriba.

### Subunidad QA-AI.EXISTING-WEBAPI.1 · usar la instancia local autorizada

**Fuente revalidada (2026-10-08):** la instrucción activa del usuario pide la WebAPI existente en
`localhost:3001`, configuración `webapi / Custom / gpt-5 / concurrencia 1`, usar el token local
autorizado y, si no está disponible desde una fuente segura, permite crear uno para las pruebas. El
usuario había especificado que ese token no caducara; el smoke debe borrarlo al terminar. El harness
actual usa la WebAPI existente, admite bearer efímero de entorno o crea un token propio con
`expiresAt: null` y borra/verifica solo ese token al terminar; no inicia ni reconfigura el servicio y
aborta antes de usar el modelo si los ajustes observados no satisfacen el perfil permitido. El smoke
live ejecutado el 2026-10-08 completó 10 requests con `gpt-5`; la E2E incluye receta con 11
ingredientes y tres niveles, dos recetas distintas y foto `shelf`. Esta subunidad reemplaza
instrucciones anteriores incompatibles de iniciar otra WebAPI, cambiar privacidad o usar un token
corto.

**Contrato único para el smoke live:** modo manual independiente y opt-in contra la instancia ya
existente. Nunca iniciar, parar o reconfigurar WebAPI; no cambiar sus settings de privacidad/logs,
base, proceso o perfil personal; no modificar tokens preexistentes. Primero intentar obtener el bearer
de una fuente segura y efímera. Dado que el usuario autorizó expresamente crear un token si hace falta,
si esa fuente no lo proporciona, el coordinador puede crear exactamente un token dedicado con
caducidad **Nunca**, mantenerlo solo en memoria y borrar/verificar borrado únicamente de ese token ID
en `finally`. La creación/borrado de ese token propio son las únicas escrituras administrativas
permitidas; si no se puede garantizar su limpieza, abortar antes de llamar al modelo. El preflight se
ejecuta desde el coordinador real y debe demostrar acceso al origin fijo `http://127.0.0.1:3001`,
validez del bearer y disponibilidad estricta de `gpt-5` con texto+imagen; ante fallo, termina en rojo
sin fallback a Browser MCP, otro modelo ni una segunda WebAPI.

El bearer solo permanece en memoria del coordinador/proxy; nunca va en argumentos, variables del
runner/navegador, logs, UI, E2E backend, capturas, artefactos, fixtures, SQLite o memoria persistente.
El proxy solo permite host/rutas/modelo aprobados y la clave aleatoria del proxy es la única
credencial que recibe el runner. Antes de procesar datos de tickets, el preflight debe comprobar sin
revelar valores que la captura de cuerpos/sesiones está desactivada y que Authorization, prompt y
respuesta no quedan registrados en los logs existentes; no cambiar settings para conseguirlo. Si no
puede demostrar redacción y captura desactivada, abortar sin enviar tickets. La app bajo prueba usa
DB/puertos/seed propios y el cleanup se confirma antes de borrar sus temporales. Los tickets reales no
entran en capturas, traces, vídeos, reportes o fixtures; solo se conservan resultado, recuentos,
latencias/uso/coste agregados, sin tienda, artículos, importes ni fechas personales.

- [x] Confirmar desde Node coordinador `GET /health/ready` y `/` sin Authorization (200/200, identidad
      `web-api`); esto solo prueba conectividad/identidad, no autoriza modelo ni bearer.
- [x] Implementar fuente efímera del bearer para `existing-webapi`, incluida creación opcional del token
      propio autorizado y su borrado/verificación; probar opt-in/CI, servicio ausente, 401, modelo
      incorrecto, redacción, allowlist y que no toca settings/perfil/tokens preexistentes.
- [x] Añadir primero E2E/test de coordinador con mocks loopback: secreto nunca entra al runner, artefactos,
      SQLite o logs; budget y concurrency siguen limitados; la ruta antigua no se activa como fallback.
- [x] Verificar de solo lectura redacción/captura de request y session logs desde el servicio ya
      levantado; si no es verificable, no enviar tickets reales ni completar smoke live.
- [x] Ejecutar los ocho flujos reales opt-in con `gpt-5`, stop-on-first-failure y métricas agregadas; sin
      reintentos/manual retries, conservar DB/artifacts solo mientras se demuestra cleanup.
- [x] En el mismo presupuesto estricto, probar generación real con al menos 8 ingredientes sintéticos
      variados y una preparación de varias fases; validar ingredientes presentes una sola vez en el JSON,
      pasos utilizables y contenido `basic`/`intermediate`/`expert` no vacío. La receta múltiple recibe
      ingredientes variados y devuelve 2 borradores distintos; la planificación transmite más de un
      objetivo y texto custom cuando están seleccionados, sin reducirlos a una sola preferencia.
- [x] Admitir exactamente los seis archivos PDF/JPEG de la carpeta indicada (dos PDF y cuatro JPEG),
      comprobar firma real y límite de 10 MiB antes de subir; no seguir enlaces ni leer carpetas hijas.
- [x] Tratar los dos PDF como tickets independientes y la JPEG que el usuario identifica como más clara
      por separado; agrupar las tres fotos restantes, ordenadas por nombre, en un PDF multipágina temporal
      en memoria para analizarlas como un único ticket largo. Así se prueba el solape entre tramos sin
      crear tickets o productos repetidos por procesar cada foto de forma independiente.
- [ ] Procesar los cuatro tickets secuencialmente desde UI aislada, con concurrencia 1 y
      `retryAttempts: 0`; techo duro de 8 completions (una por ticket y, como máximo, un fallback
      no-stream por ticket), sin reintentos manuales y parada al fallar.
- [ ] En PDFs multipágina, instruir al modelo para tratar todas las páginas como un mismo ticket y no
      repetir líneas visibles en páginas/fotos solapadas; deduplicar defensivamente líneas equivalentes
      conservando orden y filas de mismo producto con cantidad/precio distintos. Verificar que el ticket
      largo no persiste artículos duplicados.
- [x] Construir la instantánea vigente de categorías/productos sin existencias, precios ni historial,
      adjuntarla como `inventario.json` independiente y conservar `response_format` estricto; la lectura
      de ambos ficheros está probada con la pareja live sintética y el envío real del grupo largo se
      acredita por telemetría. Ver `QA-AI.REAL-INTEGRATIONS.ATTACHMENT-PAIR.1`.
- [ ] Validar con respuestas reales de JPEG y PDF que la categoría de cada línea respeta la categoría
      vigente del snapshot y comprobar reconocimiento/schema de los tickets; no hay salida real
      validable del grupo largo y no se repiten solicitudes posiblemente completadas.
- [x] Enviar PDFs a Chat Completions como parte `type: "file"` con `filename` genérico y
      `file_data: data:application/pdf;base64,...`, nunca como `image_url`; las fotos JPEG siguen como
      `image_url`. Mantener el `response_format` JSON Schema estricto en ambos transportes. La compatibilidad
      del fichero JSON como adjunto se valida contra el relay de la WebAPI existente, que recibe partes
      `type: "file"` y MIME explícito; no se asume soporte equivalente en un endpoint OpenAI directo.
      Contratos del proveedor: [File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
      y [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- [ ] Verificar en UI aislada estado/reconocimiento, campos editables, guardado y aparición en historial;
      no confirmar los tickets ni tocar despensa/inventario. Usar nombres genéricos al subir.
- [x] Mantener cuerpos/sesiones/diagnóstico sin captura, Playwright sin screenshot/trace/video/reportes
      con contenido, y stdout/errores limitados a estado y métricas agregadas; no conservar nombres,
      tiendas, artículos, importes, fechas, imágenes, prompts ni respuestas.
- [x] Confirmar cierre de app/procesos/puertos, borrado de token propio y limpieza de SQLite/uploads/
      artefactos temporales antes de marcar verde; abortar ante privacidad insegura o cleanup no verificado.

**Evidencia QA-AI.REAL-INTEGRATIONS.1 (2026-10-08):** `node --test scripts/ai-live-existing-webapi.test.mjs
scripts/run-ai-real-smoke.test.mjs scripts/ai-live-smoke-safety.test.mjs scripts/ai-live-smoke-runner-control.test.mjs`
y `node --test scripts/ai-live-smoke-contract.test.mjs` pasaron en conjunto **48/48** tras añadir la
regresión de cancelación descrita abajo. La E2E sintética loopback pasó **1/1** con proyecto
`chromium-ai-real-smoke`; usa SQLite/puertos temporales. Smoke live autorizado: `gpt-5`, 10 completions,
latencias agregadas en ms `[146487, 15872, 152151, 117259, 19133, 22275, 19050, 30608, 15, 39796]`;
la llamada 9 de `receipt` devolvió 400 al pedir stream y el fallback no-stream devolvió 200. El proceso
confirmó cleanup del runner y borrado/verificación del token propio. No se pasó un ticket real.

**Inventario fresco para tickets (primer transporte; corregido el 2026-10-08):** TDD reprodujo que
la petición anterior llevaba una sola parte de texto y el prompt describía falsamente el inventario como
archivo adjunto. Ese primer cambio envió la instantánea como otra parte `type: "text"`, etiquetada
`INVENTARIO_JSON_ACTUAL`; no satisfacía que la persona viera un segundo archivo. La subunidad
`QA-AI.RECEIPT-INVENTORY-ATTACHMENT.1` que sigue corrigió el transporte vigente: `ticket-queue.ts`
adjunta la instantánea fresca del hogar como `type: "file"`, nombre `inventario.json` y MIME
`application/json`; PDF también es `file` y JPEG continúa como `image_url`. `ai-queue.spec.ts` decodifica
y comprueba los bytes JSON y las categorías/productos actuales en ambas rutas, el MIME/nombre del PDF y
`RECEIPT_RESPONSE_FORMAT`; `tests/e2e/receipts.spec.ts` comprueba en el proveedor sintético las tres
partes del mensaje JPEG. La instantánea no incluye existencias/precios/historial. El prompt/schema
estricto exige una categoría no nula por línea; el prompt reutiliza la categoría vigente del producto y
solo usa `other`/propone clave cuando corresponde. El TDD de categoría primero falló en `missing` y
`null`; ahora el contrato estricto los rechaza.

La cobertura focal de schemas/cola/prompt fue **59/59**; schemas de receipt y prompt, **22/22** con
**100/100/100/100 % S/B/F/L**. Suite de servidor registrada en esa revalidación: **1234/1234** pruebas
no omitidas (1 skip explícito), coverage global **91.72/83.23/96.05/94.23 %**. La E2E de acciones de
cola pasó **2/2** y la sintética loopback **1/1**, ambas con cleanup y sin proveedor real. La prueba
loopback acredita el transporte sintético, no la ruta vigente de `localhost:3001`; no se repetirá el
lote de tickets reales ni se afirmará que el modelo vio ambos archivos hasta reparar y verificar ese
relay en WebAPI. Comandos: `pnpm --filter @hogaria/server exec vitest run
src/schemas/receipts.schema.spec.ts src/schemas/ai-response-format.spec.ts
src/utils/ai-queue.spec.ts src/utils/ticket-prompt.spec.ts --reporter=dot` (59/59); `node --test
scripts/ai-live-existing-webapi.test.mjs scripts/run-ai-real-smoke.test.mjs
scripts/ai-live-smoke-safety.test.mjs scripts/ai-live-smoke-runner-control.test.mjs
scripts/ai-live-smoke-contract.test.mjs scripts/ai-live-receipt-inputs.test.mjs` (57/57); y la suite
E2E aislada `tests/e2e/receipt-queue-actions.spec.ts` (2/2) más `ai-real-smoke.spec.ts` loopback (1/1).

**Revalidación del lote real de tickets (2026-10-08):** el opt-in procesó la carpeta autorizada como
cuatro tickets secuenciales y llegó al techo de **8/8 completions**. Las llamadas de formato streaming
recibieron HTTP 400 y sus fallbacks no-stream previos devolvieron HTTP 200; el fallback de la última
solicitud devolvió HTTP 504, Playwright acabó en rojo y no se alcanzó la fase final «cuatro tickets
verificados». Se detuvo sin reintento manual según el presupuesto/stop-on-failure vigente. El
coordinador no reportó fallo al borrar el token propio; la aplicación aislada paró y no quedó carpeta
temporal `hogaria-e2e-*` reciente. Esta corrida es anterior al nuevo bloque textual del inventario y al
schema que exige categoría no nula, así que no valida esos cambios ni cierra el lote; el resultado live
queda fallido y la unidad continúa abierta.

**Preflight de la revalidación (2026-10-08):** el primer arranque de la corrida adicional se detuvo
antes de subir archivos y antes de cualquier completion porque no llevaba el opt-in explícito para
logs locales acotados. La lectura sin mutaciones de los controles confirma `maxBodyChars: 0`,
`maxHeaderValueChars: 0`, `maxHeaders: 0`, y `sessionRecording`/`diagnosticHtml` desactivados; por tanto,
se repetirá el preflight con ese opt-in, sin capturar cuerpos, cabeceras ni sesiones. El fallo de setup
consumió **0/8 completions** y no llamó al proveedor.

**Revalidación limitada del payload actualizado (2026-10-08):** como el cambio posterior ahora adjunta
el inventario fresco como `inventario.json` (`application/json`), fuerza la decisión de categoría y
transporta el PDF como `file`, se autoriza una única corrida nueva de los mismos cuatro tickets para
validar esa versión. Esta
corrida conserva el techo de **8 completions**, concurrencia 1, `retryAttempts: 0` y parada en el primer
fallo; no habrá reintento individual ni tercera repetición del lote si esta validación vuelve a fallar.
El primer setup fallido no consumió el presupuesto ni alcanzó archivos/proveedor; solo se ejecutará el
lote cuando pase el preflight de privacidad. Solo se registrarán estado y métricas agregadas, con el
cleanup ya existente.

- [ ] Completar la validación real pendiente solo tras probar con evidencia live sintética que WebAPI
      sube ambos adjuntos. No reenviar los dos PDF individuales ni la JPEG preferida: sus intentos
      previos siguen siendo potencialmente completados. Ejecutar únicamente el PDF temporal que agrupa
      las otras tres fotos, nunca enviado, con `inventario.json` y `response_format`, UI/DB temporal,
      respuesta validada y sin líneas equivalentes duplicadas. Detenerse ante el primer fallo y no
      repetir ninguna petición ya completada o posiblemente completada.

**Diagnóstico seguro del intento único (2026-10-08):** el preflight y los ajustes de privacidad volvieron
a pasar; se leyó el log local con extracción allowlist, sin volcar cuerpos, prompts, respuestas, nombres
ni datos del ticket. Se consumieron **6/8 completions**: las tres peticiones streaming dieron HTTP 400;
los fallbacks no-stream de los dos PDF dieron HTTP 200 y el de la JPEG preferida dio HTTP 500. Los
diagnósticos de WebAPI (HEAD `fd00bfd3`) muestran dos adjuntos recibidos en cada flujo de subida: los
dos PDF completaron la subida; para la JPEG el flujo terminó en `upload_failed`,
`attachment_cleanup_failed` (HTTP 500, `cleanupOutcome=failure`) después de aproximadamente 54 s.
El flujo de prompt quedó en `upload_attachments` → `turn_failed`, sin `prompt_submitted`; esto confirma
que los dos adjuntos alcanzaron el uploader de WebAPI, pero **no** que el modelo recibiera o leyera la
foto junto con el inventario. El fallo está en la recuperación/limpieza del uploader de WebAPI ante la
subida fallida, no en que MiCocinAI omitiera un segundo adjunto. No se hicieron reintentos manuales ni
se confirmaron compras al inventario; el cuarto ticket no se procesó. El coordinador no informó fallo
al borrar el token propio y no quedó una carpeta `hogaria-e2e-*` reciente. La única repetición queda
consumida: no enviar de nuevo los tickets reales en esta subunidad.

**Preparación y cleanup:** el coordinador validó en memoria seis archivos regulares (2 PDF, 4 JPEG),
firmas y límites; formó cuatro tickets: cada PDF, la JPEG preferida y las otras tres fotos en un PDF
multipágina. No se escribieron copias permanentes ni nombres en evidencia. El preflight observó
`maxBodyChars=0`, `maxHeaderValueChars=0`, `maxHeaders=0`, grabación de sesión y diagnóstico HTML
desactivados; Playwright tiene screenshot/trace/video apagados y el coordinador solo emitió fases y
métricas. Al terminar, no reportó fallo de limpieza del token/proxy y el runner confirmó cierre de la
app/puertos y eliminación de su directorio SQLite/uploads temporal antes de devolver el resultado rojo.

**Preflight condicionado de la nueva validación (2026-10-08):** antes de abrir o subir tickets comprobé
la WebAPI local. `http://127.0.0.1:3001/health/ready` respondió HTTP 200, pero eso solo acredita
disponibilidad. En `D:\projects\webApi`, el árbol está limpio y la rama local coincide con
`origin/fix/ticket-prompt-association-diagnostics` en `fd00bfd3`; el cambio más reciente del flujo de
adjuntos es `9c8de018` («trace attachment upload stages»), de instrumentación, no de recuperación. El
código de `src/providers/chatgpt/flows/attachment-flow.ts` todavía llama a
`rollbackAttachmentState()` tras un upload parcial/fallido y puede terminar en
`attachment_cleanup_failed` HTTP 500 si no restaura el estado base; el test sintético
`attachment-clipboard-fallback.e2e.test.ts` aún cubre ese fallo cerrado. No encontré una corrección
posterior. La revisión no ata el proceso vivo de 3001 a un SHA verificable y no hubo una ejecución nueva
que pruebe la recuperación de la JPEG; el preflight, por tanto, falla y no autoriza subir tickets.

**Reintento de preflight solicitado (2026-10-08):** volví a inspeccionar WebAPI antes de reabrir los
tickets. El checkout local está limpio en `fix/partial-attachment-cleanup`, commit `d4843c0b`; su único
cambio respecto de `fd00bfd3` añade `openspec/changes/partial-attachment-cleanup/spec.md` y no modifica
el flujo ni las pruebas. Esa propuesta mantiene tareas sin marcar de rollback verificado, reset seguro
del composer, conservación del error original y veto a repetir uploads ambiguos. El código vigente aún
propaga `attachment_cleanup_failed` HTTP 500 cuando no puede verificar el baseline; por tanto el error
de limpieza sigue presente. El servicio de `127.0.0.1:3001` devuelve 200 en `/health/ready` y `/`, pero
ninguna ruta identifica el SHA servido. La lectura allowlist del log asociado al PID 58572 no encontró
eventos `attachment`/`upload`/`prompt_submitted`; una línea genérica `cleanup` no se puede atribuir a
esta ruta. Esto no aporta evidencia de que la WebAPI desplegada haya corregido la recuperación. Por la
regla de no repetir nada que pudiera completar: **0 archivos re-subidos, 0 nuevas completions y 0
escrituras en el inventario/base normal**. No reenvío los PDF cuyo fallback anterior devolvió HTTP 200,
ni la JPEG que ya terminó en cleanup fallido; tampoco se procesa el lote largo. Se requieren el cambio
real de WebAPI y una prueba sintética de la nueva recuperación, además de poder identificar la versión
activa, antes de considerar otra corrida live.

El usuario autorizó una nueva validación **solo si** se demuestra que el fallo se corrigió y prohibió
repetir peticiones que pudieran completarse. Los dos fallbacks no-stream de los PDF devolvieron HTTP 200
en la corrida anterior; se consideran potencialmente completados y quedan excluidos de todo reenvío. Si
WebAPI se corrige y acredita la entrega, la única parte que puede continuar son la JPEG preferida y el
ticket largo multipágina aún no enviado.

Por la condición explícita de no enviar si el fallo continúa, **no se abrieron ni reenviaron tickets**:
0 archivos subidos, 0 nuevas completions y 0 escrituras en la base/inventario real. La validación real
sigue incompleta; no se afirma que WebAPI envíe ambos adjuntos al modelo ni que la respuesta/deduplicación
sean correctas. Reanudar únicamente tras demostrar la recuperación de adjuntos en WebAPI y sin volver a
enviar los PDF que podrían haber completado.

**Reintento de preflight (2026-10-09, solicitado por el usuario):** el checkout local de WebAPI está
limpio en `fix/partial-attachment-cleanup`, HEAD `7c1e52e9`; el cambio `e679f44d` (`recover partial
attachment uploads`) está incluido. El PID activo `43088` escucha en `3001` y arrancó a las 23:48,
después del commit del cambio a las 23:42; `/health/ready` sigue indicando `ready=true`. La API no
expone el SHA del runtime, así que esa relación temporal es evidencia indirecta, no atestación de build.
Leí `GET /admin/api/logs?lines=2000` sin imprimir líneas: 411 líneas, sin truncar; cuatro eventos
terminales `upload_failed`, todos `errorStatus=504`, `cleanupOutcome=success` y `cleanupMethod=page_closed`;
los cuatro intentos parciales previos también acabaron en cleanup exitoso. En total constan ocho
`cleanup_completed`, cero `cleanup_failed`, cero `prompt_submitted` y cero `response_completed` en el
tail. La recuperación de estado tras el fallo parece corregida en ejecución, pero la subida todavía no
completa: HTTP 504 impide que PDF/foto + inventario alcancen el prompt. Este preflight hizo solo GET de
readiness/logs: no abrió, leyó ni subió tickets y no creó requests/completions ni escrituras nuevas.
No reintentar el PDF que pudo completarse; dejar el smoke real abierto hasta que la subida sin 504 y la
entrega de ambos adjuntos queden verificadas sin repetir peticiones ambiguas.

**Recomprobación tras el cambio anunciado (2026-10-09):** `git fetch --all` no encontró un commit nuevo:
WebAPI sigue limpia en `7c1e52e9` y el proceso de `3001` sigue siendo PID `43088`. La prueba sintética
`pnpm exec vitest run --config vitest.clipboard-e2e.config.ts
tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts --reporter=dot` pasó **18/18**; esto
confirma limpieza simulada, no entrega real al proveedor. El último intento real ya registrado en el log
del proceso, posterior al fix, termina en `chatgpt_attachment_upload`/`upload_failed`, HTTP **504**, con
dos adjuntos y timeout de 45 s; la recuperación se limpió con `page_closed`, pero nunca llegó a
`prompt_submitted`/`response_completed`. Por la instrucción vigente de no reenviar mientras el fallo
persista, esta comprobación no hizo POST, no reabrió los tickets y no generó completions/escrituras
reales. El fix resuelve el cleanup parcial; el bloqueo actual es que el upload real no termina. No
declarar validación de IA ni procesamiento/deduplicación completos hasta demostrar entrega sin 504.

**Nuevo intento de validación solicitado (2026-10-09, 08:33–08:35 Europe/Madrid):** `git fetch origin
--prune` no encontró commits nuevos: WebAPI sigue limpio en `7c1e52e9`, con el fix de cleanup
`e679f44d`; el proceso activo `43088` (`tsx src/main.ts`) arrancó después del fix. `/health/ready`
responde 200 (`ready=true`, `storage=ready`), lo cual no demuestra entrega de adjuntos. La lectura
filtrada de `/admin/api/logs?lines=2000` encontró 27 `attachment_upload_failed`; el más reciente
registrado sigue siendo de las 03:16:09 y muestra dos adjuntos, HTTP 504 al vencer los 45 s y cleanup
`page_closed` exitoso. No aparecen `prompt_submitted`, `response_completed` ni `cleanup_failed`.
Repetí `pnpm exec vitest run --config vitest.clipboard-e2e.config.ts
tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts --reporter=dot`: **18/18** en
12,08 s; es cobertura sintética de fallback/cleanup, no una comprobación del proveedor real. La última
evidencia live sigue mostrando que solo se corrigió la limpieza: la carga no termina y el modelo no
recibe el turno. Por la condición vigente de no reenviar mientras persista ese fallo, esta
recomprobación no hizo POST ni abrió tickets: **0 archivos reenviados, 0 nuevas completions y 0
escrituras reales**. Se mantiene sin ejecutar el smoke live; los PDF cuyo fallback anterior devolvió
200 siguen excluidos por posible finalización.

**Preflight tras las correcciones anunciadas (2026-10-09, 10:41–10:44 Europe/Madrid):** la rama
`fix/live-ticket-inventory-attachments` contiene `e679f44d` (recuperación/limpieza), `67b0de74`
(detección de tarjetas mixtas) y `246291eb` (forzar la subida del snapshot JSON). Su spec documenta
una prueba live sintética con PID `47764`, SHA de `opencode-executor.ts`
`138A09D6272AD7385A115D5E16993FD9A59234A888D6C1FB7BBEDA850BBC5F38`, dos adjuntos subidos,
`inlineContextCount=0`, readiness `2/2` y ambos marcadores recibidos bajo JSON Schema estricto.
El PID `7100` del listener actual arrancó el 09-10 a las 10:09:43, cuando el reflog sitúa el checkout
en `b55f9589` de esa rama; el checkout cambió a `feat/session-attachment-previews` a las 10:18:46.
WebAPI no expone una atestación del SHA cargado, así que el vínculo del PID con el código es temporal,
no criptográfico.

La lectura allowlist de `GET /admin/api/logs?lines=2000` devolvió 550 líneas, sin truncar. En ese
proceso hay dos flujos con `attachmentCount=2`, un snapshot de inventario, readiness correcta
(`expectedCount=2`, `visibleCount=2`), `upload_completed` y `prompt_submitted`; hay dos limpiezas
completadas y cero `cleanup_failed`. Por tanto, la subida/limpieza que antes acababa en 504 ya no es
el bloqueo observado. Sin embargo, uno de esos flujos terminó en `wait_for_reply`/`turn_failed` con
`errorName=OpenCodeHttpError`, `timeoutMs=120000` y `durationMs=132096`; el tail no contiene
`response_completed` ni un status HTTP seguro para distinguir el detalle. Los logs no incluyen nombres ni
permiten asignar esas solicitudes a un grupo de ticket; dado que ambas llegaron a `prompt_submitted` y podrían haberse
completado, no se reenvía ninguna ni se abren otros tickets en esta comprobación. Solo se hicieron
lecturas locales y GET de readiness/logs: **0 archivos abiertos/subidos, 0 nuevas completions y 0
escrituras** en esta pasada. La validación de respuesta, schema y deduplicación sigue pendiente; no
marcar la unidad como completa hasta resolver/atestiguar la respuesta final y distinguir entradas no
enviadas sin riesgo de duplicado.

**Rollback del registro:** revertir solo este bloque diagnóstico/preparación y la actualización de
checklist; no alterar el transporte probado ni los datos reales.

**Registro de fallo aportado (2026-10-08):** OpenCode recibió un mensaje con el marcador antiguo
`INVENTARIO_JSON_ACTUAL:` vacío y `attachmentCount: 1`; la versión actual de MiCocinAI pide leer el
fichero `inventario.json` y adjunta PDF + JSON, así que este registro no acredita el payload nuevo.
Además, la WebAPI observó HTTP 200 y 69 fragmentos de `/backend-api/f/conversation`, pero no detectó
cierre (`terminalRequestCount: 0`) y agotó 120 s de inactividad (`validated_output_timeout`). El código
local de WebAPI tiene recuperación acotada en `stream-reply-flow.ts`, sin evento de refresh en el
extracto aportado; queda por distinguir fallo del ciclo de vida vs. runtime desplegado desactualizado.
No repetir tickets reales hasta resolver esta recuperación y comprobar que la petición nueva llega con
los dos adjuntos esperados.

**Reintento live solicitado por el usuario (2026-10-09):** `/health/ready` devolvió `ready=true`.
El smoke sintético contra el PID 7100 registró dos adjuntos visibles, un snapshot de inventario,
cero contexto inline, compilación del JSON Schema estricto y `validated-output.validation.succeeded`.
Esto confirma el transporte de adjuntos en ese proceso, no la versión exacta cargada: el PID arrancó
a las 10:09:43, antes de las modificaciones actuales de `stream-reply-flow.ts` y
`validated-output-executor.ts` (11:55–11:57); ahora el checkout WebAPI está en
`fix/chatgpt-inactivity-recovery`/`e52e5f47`, con cambios locales sin commit, y no expone el SHA del
runtime. No se reinició ni modificó WebAPI ni su trabajo local.

Se creó en almacenamiento temporal una instantánea mediante `buildInventarioJson`, desde una apertura
SQLite `readonly` + `query_only`; contenía solo tiendas, categorías y productos, sin existencias,
precios ni historial. MiCocinAI no escribió ningún resultado en el inventario real. A petición nueva
del usuario se enviaron una vez los dos PDF por separado y la JPEG preferida por separado, cada cual
con `inventario.json` y `response_format` JSON Schema estricto. Ambos PDF devolvieron HTTP 200; WebAPI
registró dos adjuntos preparados/visibles, snapshot único, cero contexto inline y validación final;
el schema local también pasó (18 líneas por PDF). La JPEG llegó a `Prompt submitted` con sus dos
adjuntos visibles y schema compilado, pero acabó HTTP 502: el output no validó y la corrección terminó
con `composer_not_ready`; no hubo respuesta final válida ni reintento manual del cliente. El servicio
realizó las correcciones internas indicadas en sus logs. La attestation de privacidad se consultó
después, no antes, de estos POST: WebAPI tenía logging/captureDetails activos, grabación de sesión y
HTML diagnóstico desactivados; el código de la revisión de adjuntos inspeccionada redacta
`messages`/adjuntos y solo
permite una allowlist de cabeceras, pero esta pasada no satisface el preflight previo requerido.

No se repitió el ticket largo de tres fotos: su envío anterior llegó a `Prompt submitted` y devolvió
504, por lo que podría haberse completado; su deduplicación sigue sin validar. Tampoco se ejecutó el
flujo UI/DB aislado ni se confirmó ningún ticket. El token temporal fue revocado, eliminado y verificado
ausente; el contenido del snapshot y los scripts auxiliares temporales se vació. Los resultados
anteriores son parciales y no cierran QA-AI.REAL-INTEGRATIONS.1.

**Comprobación read-only tras el reinicio de WebAPI (2026-10-10):** `/health/ready` devolvió
`ready=true`, `storage=ready`. El checkout local está en `feat/session-attachment-previews`, HEAD
`a1c64d4e`; el PID que atiende `3001` arrancó a las 00:54:11, después de ese commit (la API no
atestigua el SHA cargado). No se tocó el cambio local previo `tools.txt` de WebAPI. Una sesión posterior,
a las 00:56, registra exactamente `image/jpeg` + `application/json`, `attachmentCount=2` y
`includedInProviderRequestAttachmentCount=2`; terminó `success`, con `validatedOutput=true` y
`validationPending=false`. Sin imprimir ni guardar la respuesta, el análisis transitorio confirmó JSON
válido con las claves de ticket previstas, 24 líneas, cero categorías vacías y `createCategory` booleano
en todas. Pero el log filtrado y redactado de esa misma sesión distingue el envío efectivo: se recibieron
2 ficheros y la petición interna incluyó 2 (`includedInProviderRequestAttachmentCount=2`), pero
`Attachments are ready` y `Prompt submitted` reportan respectivamente `readyAttachmentCount=1` y
`sentToModelAttachmentCount=1`. Por tanto, la vista previa y el recuento de la petición interna no
demuestran que ambos archivos fueran adjuntos en el prompt; el JSON del inventario no queda acreditado
como segundo fichero y sus categorías no se validan contra el catálogo. En esa misma corrida el proxy
aislado de MiCocinAI verificó `response_format` JSON Schema estricto y el par de adjuntos en ambos
intentos HTTP antes de reenviarlos; WebAPI informa validación estructurada de la respuesta. Esto no
demuestra que el JSON llegara como fichero al prompt de ChatGPT.

**Revalidación read-only tras reiniciar WebAPI (2026-10-10, 05:36 CEST):** el listener continúa en
`127.0.0.1:3001`, PID `56924`, iniciado a las 00:54:11; readiness sigue en `ready=true`,
`storage=ready`. Los logs actuales no contienen un intento posterior al registrado a las 00:56:29, así
que no se creó ni reenvió ninguna petición. La lectura del checkout `D:\projects\webApi` (HEAD
`a1c64d4e`, sin modificar su cambio local `tools.txt`) encuentra una causa probable y reproducible en
código: `writeAttachmentBuffer()` antepone un UUID al nombre del fichero; después,
`buildOpenCodeMessageAttachments()` fuerza la subida del inventario solo si el basename coincide con
`inventario.json`/`inventory.json` o con prefijo numérico. El basename con UUID no coincide, y
`prepareOpenCodeAttachments()` inlinea los ficheros de texto menores de 64 KiB que no estén marcados
para subida forzada. Esto explica los contadores `readyAttachmentCount=1` y
`sentToModelAttachmentCount=1`, pero no sustituye una regresión ejecutada ni prueba por sí solo el
contenido del prompt. El fix no está presente en el checkout inspeccionado; readiness no equivale a
comportamiento corregido. Se localizó el fix en el PR abierto de WebAPI
[#163](https://github.com/juanjoGonDev/webApi/pull/163): su rama `fix/ticket-prompt-association-diagnostics`
normaliza el prefijo UUID al reconocer el snapshot y declara una regresión multipart, prueba sintética
con proveedor real y CI verde. No está integrado en el checkout local inspeccionado, que sigue en
`feat/session-attachment-previews` / `a1c64d4e`; el proceso actual no expone SHA cargado que permita
vincularlo al código de #163. No se integró ni reemplazó el proceso y no se repitió ningún ticket
potencialmente completado. Para continuar el smoke de tickets se necesita primero que el servicio activo
use el fix de #163 y que una petición sintética confirme dos subidas efectivas.

Los logs también muestran una finalización anterior con las cuatro fotos JPEG juntas y el JSON de
inventario (agrupación distinta a la acordada), además de sesiones PDF+JSON cuyo ticket no se puede
atribuir con seguridad sin leer datos privados. Como cualquiera pudo completar, no se reenvía ningún
ticket. Esta pasada hizo solo lecturas locales/GET: cero POST al proveedor, cero archivos fuente de
tickets abiertos/subidos y cero escrituras en la aplicación. Continúan pendientes el grupo exacto de tres fotos, la
verificación de no duplicados para su respuesta, confirmar `response_format` en la petición entrante sin
capturar su body y el flujo de revisión/historial en UI aislada; la unidad permanece abierta.

### Subunidad QA-AI.RECEIPT-INVENTORY-ATTACHMENT.1 · adjuntar el catálogo visible

**Fuente revalidada (2026-10-08):** la captura que aportó el usuario muestra el prompt con el marcador
`INVENTARIO_JSON_ACTUAL:` pero sin el JSON a continuación ni un segundo fichero adjunto. Las pruebas
anteriores solo comprobaron el body HTTP saliente de MiCocinAI, no lo que recibía la UI/modelo a través
de la WebAPI. En la fuente local de WebAPI, `controller.ts` arma el texto recorriendo solo `part.text`;
además, `sanitizeOpenAiMessageText` descarta cada línea cuyo primer carácter sea `{` o `[`. La
instantánea minificada, al viajar como bloque de texto separado, empieza por `{` y se pierde en esa
frontera. El relay de adjuntos, en cambio, extrae `file.file_data`, conserva el MIME y resuelve
`application/json` con extensión `.json`. La petición más reciente aportada por el usuario muestra
categorías diversas y una nota de línea, pero no acredita que el fichero de catálogo se haya adjuntado.

**Comprobación del registro aportado (2026-10-08):** el archivo tiene 36 líneas y contiene el marcador
`INVENTARIO_JSON_ACTUAL:`, pero no menciona `inventario.json` ni `application/json`; tampoco contiene
un estado HTTP identificable. Por tanto, no demuestra el resultado del payload nuevo y es compatible
con una ejecución anterior que todavía enviaba el catálogo como texto. No se han extraído ni reproducido
prompts, respuestas o datos privados del registro.

**Decisión:** enviar el catálogo limitado como `inventario.json` real, codificado como parte
`type: "file"` con MIME `application/json`, y dejar en texto solo las instrucciones para leerlo. El
adjunto contendrá únicamente tiendas conocidas, categorías y productos/nombre/categoría/unidad vigentes;
no incluirá existencias, precios, historial, secretos ni datos de tickets. Conservar PDF `file`/JPEG
`image_url` y `response_format` JSON Schema estricto. No editar la WebAPI compartida para ocultar el
problema ni alterar su configuración.

- [x] Añadir primero pruebas fallidas de la petición de proveedor para JPEG y PDF: texto invita a leer
      `inventario.json`, se adjunta exactamente un fichero JSON con la instantánea fresca, el ticket
      mantiene su transporte y se conserva `response_format` estricto; comprobar categoría movida.
- [x] Verificar en un contrato aislado con WebAPI que el catálogo se conserva como adjunto `application/json`
      legible aunque las instrucciones de usuario se normalicen; usar contenido sintético, sin ticket real.
- [x] Ejecutar pruebas focales y suite server requerida, coverage ≥70 % S/B/F/L por archivo afectado,
      formato, build/typecheck y E2E apropiada con SQLite temporal; no llamar al proveedor con tickets reales.
- [x] Documentar resultados/rollback, commit atómico con hooks completos, push a la rama del PR y comprobar
      todos los jobs CI del SHA publicado; mantener el PR abierto y fuera de Draft como pidió el usuario.

**Evidencia reproducible:** primero, las pruebas focales fallaron antes del cambio (3 fallos esperados)
y luego `pnpm --filter @hogaria/server exec vitest run src/utils/ai-queue.spec.ts
src/utils/ticket-prompt.spec.ts --reporter=dot` pasó 33/33. La suite `pnpm --filter
@hogaria/server run test:coverage` pasó 1234, 1 omitida; `ticket-queue.ts` quedó en
86.53/80.09/95.23/92.21 % S/B/F/L y `ticket-prompt.ts` en 100 % en las cuatro métricas.
También pasaron `pnpm --filter @hogaria/server run build`, `pnpm run typecheck:e2e`, Prettier,
`pnpm run check:ui`, `pnpm run build` y `git diff --check`. El E2E aislado
`pnpm run test:e2e -- --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/receipts.spec.ts --grep "guarda en cola y durante el análisis" --reporter=line`
pasó 4/4 con SQLite temporal y proveedor sintético; el runner confirmó limpieza de DB/artefactos.
En WebAPI pasó la prueba existente `pnpm exec vitest run tests/api/opencode/controller.test.ts -t
"passes OpenAI image and file data URL parts as executor attachments" --config vitest.config.ts
--reporter=dot` (1/1), y una petición aislada al router con JSON/JPEG sintéticos entregó ambos bytes
intactos al ejecutor falso (HTTP 200, 2 adjuntos, 0 llamadas a proveedor). No se usaron tickets reales.

**Corrección CI (run 37781914046):** Type Check, Server Tests, Production Build, full-stack y los
shards 1, 2 y 4 pasaron; shard 3 descubrió que la E2E de metadatos todavía exigía solo texto+imagen.
Las dos variantes ES/EN fallaron en esa aserción al recibir ahora el tercer adjunto JSON. Se reprodujo
localmente antes de corregirla (2 fallos) y se amplió la E2E para validar exactamente los tres tipos,
el nombre/MIME y el JSON legible; la repetición aislada pasó 2/2 con proveedor sintético. La prueba de
favoritos tuvo un timeout en su primer intento de CI, pero su retry pasó; no causó el fallo del job;
una ejecución local aislada adicional pasó 1/1. El fix se publicó en `27749a9`; CI run
`37783573686` terminó con **9/9 jobs verdes**. Los hooks pre-commit y pre-push también pasaron en
los commits publicados. PR #41 permanece abierto y fuera de Draft; no se mergeó.

**Rollback:** revertir únicamente la serialización/adjunto `inventario.json`, sus pruebas de cola/contrato
y esta subunidad; mantener el snapshot de catálogo consultado en memoria y el transporte PDF/JPEG.

**Rollback:** revertir la ruta de tickets en `server/src/utils/ai-client.ts`, `ticket-queue.ts`,
`ticket-prompt.ts`, `ticket-lines-dedup.ts` y `server/src/schemas/receipts.schema.ts`, sus specs
`ai-client.spec.ts`, `ai-queue.spec.ts`, `ticket-prompt.spec.ts`, `ticket-lines-dedup.spec.ts`,
`receipts.schema.spec.ts`, `ai-response-format.spec.ts`, `server/vitest.config.ts`, el modo de lote
aislado en `scripts/ai-live-receipt-inputs.mjs`, `ai-live-receipt-inputs.d.mts`,
`ai-live-receipt-inputs.test.mjs`, `scripts/ai-live-smoke-runner-control.mjs`,
`ai-live-smoke-runner-control.test.mjs`, `ai-live-smoke-safety.mjs`, `ai-live-smoke-safety.test.mjs`,
`scripts/run-ai-real-smoke.mjs`, `run-ai-real-smoke.test.mjs`, la regresión de
`tests/e2e/receipt-queue-actions.spec.ts` y el flujo de `tests/e2e/ai-real-smoke.spec.ts` junto con esta
subunidad. No hay migración ni cambio de settings/datos de WebAPI; mantener separados los tests
sintéticos y el smoke general preexistente.

### QA-AI.SMOKE.PRESERVE-REDACTED-LOGS.1 · conservar la telemetría local existente

**Fuente revalidada (2026-10-09):** el usuario activó expresamente los logs locales para poder
diagnosticar fallos y pidió ejecutarlos. El coordinador real usa
`prepareExistingAiLiveSmokeSession()`, que ya hace preflight read-only y solo acepta logs con
`HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS=1` y bounds verificados. La inspección del
WebAPI activo muestra `enabled=true`, `captureDetails=true`, límites numéricos en cero y grabación
de sesión/HTML desactivadas. El logger de WebAPI tiene allowlist de cabeceras (`accept`, content
type/length y encoding), estructura/cantidad/profundidad acotadas y redacción de `messages`, prompt,
contenido de adjuntos, autorización, cookies y claves; `tests/api/create-app.test.ts` verifica que los
detalles quedan sanitizados. El intento de preflight anterior llamó por error al helper legado
`prepareAiLiveSmokeSession()`, no al coordinador activo; ese helper sí modificaba ajustes. Se lo
actualizó para que también rechace estado inseguro sin mutarlo.

**Contrato:** conservar íntegros los settings del servicio. El preflight real permite logs
`enabled=true` y `captureDetails=true` solo con el opt-in explícito, código de redacción vigente y
bounds que impiden campos/cabeceras arbitrarios; cualquier estado fuera de la allowlist aborta antes
de crear el token/subir tickets. `sessionRecording` y `diagnosticHtml` deben estar desactivados. No
parchear ni revertir ajustes. Sí se permite crear y borrar el token propio autorizado, sin tocar tokens
preexistentes.

- [x] Confirmar primero las pruebas del coordinador que preservan logs sanitizados con opt-in,
      rechazan captura/bounds/recording inseguros sin token ni `PATCH`, y limpian solo el token propio
      al cancelar o fallar el catálogo.
- [x] Eliminar la escritura/restauración de settings del helper legado para que ambas rutas sean
      read-only; mantener cleanup verificable solo para el token temporal propio.
- [x] Ejecutar pruebas del coordinador/seguridad, contract tests, formato, typecheck/build; comprobar
      que las rutas de fallo no mutan ningún control local.
- [x] Confirmar en el preflight de la próxima corrida que los logs técnicos permanecen activos con
      contenido redacted y los demás controles de captura siguen apagados.

**Evidencia (2026-10-09):** TDD rojo: al sustituir las expectativas de mutación del helper legado,
`node --test --test-reporter=dot scripts/ai-live-smoke-safety.test.mjs` reprodujo **4 fallos** por
el `PATCH` que apagaba/restauraba ajustes; tras el cambio, seguridad/coordinador/contrato pasan
**47/47** con `node --experimental-test-coverage --test scripts/ai-live-existing-webapi.test.mjs
scripts/ai-live-smoke-safety.test.mjs scripts/run-ai-real-smoke.test.mjs
scripts/ai-live-smoke-contract.test.mjs`. Coverage en archivos de alcance: `ai-live-existing-webapi.mjs`
95.28 % líneas / 90.27 % ramas / 76 % funciones; `ai-live-smoke-safety.mjs` 88.84 / 77.61 / 93.10 %.
La suite WebAPI `pnpm exec vitest run --config vitest.config.ts tests/api/create-app.test.ts
--reporter=dot` pasa **9/9**, incluido el rechazo de prompt, adjunto, Authorization, cookies y claves
en request logs. También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 archivos/21 reglas),
Prettier, build (solo warnings previos de presupuesto/template/imports) y `git diff --check`.

El preflight real se ejecutó con `prepareExistingAiLiveSmokeSession()` y el opt-in de logs redacted;
validó identidad/readiness, modelo `gpt-5` y privacidad, creó y borró/verificó solo su token propio:
`{result: passed, model: gpt-5, cleanup: verified, completedRequests: 0}`. No se abrió ni subió ticket.
GETs posteriores confirmaron sin cambio `enabled=true`, `captureDetails=true`, los tres límites en 0,
`sessionRecording=false` y `diagnosticHtml=false`. La lectura del sanitizer del WebAPI activo y sus
pruebas sustentan que esos logs locales muestran estructura técnica redacted, no el prompt ni sus
adjuntos. No hubo PATCH de settings.

**Rollback:** revertir solo el preflight read-only del helper legado y sus tests; no restaurar ni
modificar settings actuales de WebAPI.

### QA-AI.RECEIPT.RESUME-SAFE-SELECTION.1 · reanudar solo las fuentes no completadas

**Fuente revalidada (2026-10-10):** WebAPI ya incluye las PR #163/#164 fusionadas: checkout limpio
`D:\projects\webApi`, rama `master` idéntica a `origin/master` en `f47f4b8`; el servicio local
`127.0.0.1:3001/health/ready` devuelve HTTP 200. La E2E sintética
`pnpm exec vitest run --config vitest.e2e.config.ts
tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts --reporter=dot` pasó **22/22**.
Esto verifica el comportamiento de adjuntos con fixtures, no la extracción de tickets reales; WebAPI
no expone por HTTP el SHA de proceso. Las ejecuciones anteriores de los dos PDF sí obtuvieron
respuestas válidas y permanecen excluidas. La JPEG preferida y el grupo de las otras tres fotos
tuvieron resultados ambiguos/sin respuesta validable. El usuario renovó expresamente (2026-10-10) la
autorización para repetir **una vez cada uno de esos dos grupos**, no los PDF.

**Contrato actualizado:** usar separadamente los selectores `preferred-jpeg-only` (JPEG ordinal 4)
y `long-ticket-only` (las otras tres JPEG como un PDF temporal de tres páginas); no usar
`unsubmitted-only` ni abrir los PDF individuales. Cada selección representa un ticket y permite como
máximo la petición streaming más un solo fallback no-stream ante HTTP 400 sin respuesta utilizable;
no volver a intentar ningún grupo tras timeout, 5xx o resultado ambiguo. El proxy debe validar en cada
petición JSON Schema estricto en `response_format` y exactamente un adjunto de ticket más un
`inventario.json` válido; los logs redacted de WebAPI deben acreditar dos ficheros listos y enviados
al modelo (`inlineContextCount=0`). El resultado debe pasar el parser/schema, quedar en `review` con
líneas, y cada categoría debe pertenecer al catálogo de la instantánea; el ticket de tres páginas no
debe guardar líneas equivalentes duplicadas. Verificar edición de metadatos e historial. Usar solo
runner, SQLite y uploads temporales, sin confirmar compras ni escribir en el inventario real. No
guardar nombres/contenido real en logs, capturas, traces, vídeos, reportes o Git. Si falla un criterio,
informar exactamente qué queda sin validar y no marcar completa esta unidad.

- [x] Añadir primero pruebas rojas de loader/coordinador que prueben que `unsubmitted-only` devuelve
      solo JPEG + PDF multipágina, no lee los dos PDF originales, rechaza selecciones inválidas y
      limita el total a cuatro requests sin avanzar al segundo ticket tras un fallo inesperado.
- [x] Implementar la selección explícita en loader, ambiente aislado y E2E; conservar la selección
      completa únicamente donde sea necesaria para probar el agrupamiento, pero el coordinador live
      solo permite el modo no reenviable definido arriba y deriva el presupuesto del número de tickets.
- [x] Ejecutar unitarias focales, typecheck E2E, `check:ui`, formato, build y regresión loopback
      sintética; confirmar antes de tickets que proceso/checkout WebAPI siguen en estado corregido,
      readiness, privacidad y redacción de logs son seguros.
- [x] Respetar la autorización explícita de reintento solo para fuentes indicadas, en almacenamiento
      temporal; no reenviar la JPEG ya potencialmente completada y consumir una sola vez el permiso
      usado para el grupo largo.
- [x] Ejecutar un smoke live único con un PDF y catálogo JSON sintéticos, `response_format` JSON Schema
      estricto, validar HTTP 200, salida conforme al esquema/categoría del catálogo y cleanup del token
      temporal; no tocar tickets ni inventario real.
- [x] Acreditar que ambos adjuntos llegan como archivos independientes y el modelo lee ambos: la E2E
      live sintética y la telemetría real del grupo largo demuestran 2 listos/visibles/enviados. Véase
      `QA-AI.REAL-INTEGRATIONS.ATTACHMENT-PAIR.1`; esta marca no acredita extracción de tickets.
- [x] Verificar con proveedor simulado que el prompt trata páginas solapadas como una compra, la
      deduplicación final fusiona líneas equivalentes y conserva compras distintas del mismo producto;
      la base aislada guarda solo una copia de cada línea equivalente.
- [x] Evitar borrar compras impresas idénticas: pasar `totalMinor` a la deduplicación final y buscar
      de forma acotada la combinación de cantidades por grupo equivalente que cuadra con el total.
      Deduplicar solo si hay una interpretación única; preservar filas ante precios/total incompletos,
      sumas discordantes, ambigüedad o exceso de estados de búsqueda.
- [x] Consumir la autorización renovada en una única ejecución por grupo (JPEG ordinal 4 y PDF
      multipágina de las otras tres fotos); no reenviar ninguno tras esta validación.
- [ ] Validar la respuesta real de ambos grupos, sus categorías contra el catálogo y, para el ticket
      multipágina, que no queden líneas equivalentes duplicadas. La JPEG terminó correctamente; el
      grupo multipágina no produjo una respuesta validable y queda consumido sin reintento.
- [x] Confirmar cleanup de recursos propios y registrar solo evidencia agregada; se preservan sin
      cambios los tres tokens smoke preexistentes por decisión expresa del usuario.
- [ ] Cerrar la validación solo después de resultados reales verificables, revisión/historial y CI
      verde en el head; mantener abierto y sin merge mientras falte evidencia.

**Revalidación live con WebAPI sincronizada (2026-10-10):** tras la confirmación del usuario, se
comprobó `D:\projects\webApi` limpio y sincronizado (`master` = `origin/master`,
`f47f4b8deb9fc4a7a027e77bcea46ae733a9f5cd`); readiness devolvió HTTP 200. Los logs se consultaron
filtrando solo eventos y contadores, sin leer ni conservar cuerpos, nombres, rutas o contenido de
adjuntos.

- **JPEG preferida (ordinal 4), una ejecución:** el smoke aislado pasó con 1 ticket, 2 solicitudes
  strict-schema, una respuesta completada y fallback recuperado: streaming HTTP 400, fallback HTTP
  200 con JSON. El coordinador validó el resultado y la ficha en `review`, líneas editables, metadatos
  e historial; las categorías devueltas pertenecen al catálogo enviado. Su resumen registró dos
  solicitudes con un adjunto JSON de inventario y uno de ticket cada una. Los logs redacted de WebAPI
  acreditan `includedInProviderRequestAttachmentCount=2`, `inventorySnapshotUploadCount=1`,
  `inlineContextCount=0`, `readyAttachmentCount=2` y `sentToModelAttachmentCount=2` antes del submit.
- **Ticket largo (las otras tres fotos, una ejecución):** el coordinador creó un único PDF temporal
  de tres páginas y no abrió los dos PDF ni la JPEG preferida. El proxy aceptó como máximo dos
  solicitudes —streaming HTTP 400 y fallback HTTP 502— tras exigir a cada request `response_format`
  JSON Schema estricto y exactamente el adjunto de ticket más `inventario.json`. Los logs redacted
  acreditan para el request que alcanzó el submit `attachmentCount=2`,
  `requiredInventoryAttachmentCount=1`, `inventorySnapshotUploadCount=1`, `inlineContextCount=0`,
  `readyAttachmentCount=2` y `sentToModelAttachmentCount=2`. No hubo salida JSON final; el runner
  terminó con error. En la correlación redacted que sí alcanzó `prompt_submitted`, WebAPI registró
  `failureStage=wait_for_reply`, `HttpConnectionAbortedError` y **229730 ms** hasta el fallo; esto no
  permite determinar si la desconexión se originó en ChatGPT o en el transporte. No se obtuvo salida
  JSON final, así que no se pudieron comprobar categorías, líneas, deduplicación, edición ni historial
  de este grupo. La autorización quedó consumida: **no reenviar**.
- Ambos runs usaron runner, SQLite, uploads y token propio temporales; no confirmaron compras ni
  escribieron en el inventario real. El runner terminó y no quedó su directorio E2E recién creado;
  la limpieza del token propio no reportó error. Se conservaron sin cambios los tres tokens smoke
  preexistentes. La falta de respuesta del grupo largo mantiene abierta esta subunidad y no permite
  declarar validación live integral ni cerrar el spec.

**Evidencia con proveedor simulado (2026-10-10):**
`pnpm --filter @hogaria/server exec vitest run src/utils/ticket-prompt.spec.ts
src/utils/ticket-lines-dedup.spec.ts src/utils/ai-queue.spec.ts --reporter=dot` pasó **36/36**.
Las pruebas comprueban la instrucción explícita de no repetir líneas entre páginas solapadas,
normalización de mayúsculas/acentos/unidades, preservación de compras distintas con cantidad/precio/
oferta diferentes, y persistencia de una sola línea equivalente cuando el stream sintético entrega
«Tomate»/«Tomáte» repetidos. `ai-queue.spec.ts` usa SQLite `:memory:` y un directorio temporal para
la integración; no se llamó a proveedor/WebAPI ni se usaron fotos reales. Esto acredita la defensa
del código, pero no sustituye el resultado real del grupo de tres fotos, que permanece pendiente.

**Regresión de conservación de filas (2026-10-10):** TDD detectó primero dos fallos en la función:
con grupos mixtos se dejaba una repetición de Tomate por conservar también dos compras reales de
Agua idénticas, y un grupo de tres observaciones no podía representar las dos filas que confirmaba
el total. La deduplicación ahora agrupa líneas compatibles y resuelve, con tope de **4096 estados**, el
número de filas a retener por grupo; aplica cambios solo si existe una combinación única. Si coinciden
varias combinaciones, faltan precios/total, ninguna cuadra o se excede el tope, conserva el original.
Una línea colapsada mantiene el merge previo de sus campos; filas idénticas distintas y respaldadas
por el total se conservan en orden. `ticket-queue.ts` pasa el total validado antes de persistir.

`ai-queue.spec.ts` usa stream sintético y SQLite/directorio temporales para validar el límite de
persistencia: conserva las dos compras Agua de 1,00 € y colapsa solo la visualización repetida de
Tomate, y persiste 4 filas en total. Pruebas unitarias adicionales cubren grupo mixto, 3→2, soluciones
ambiguas, total que confirma todas las filas, precios/total incompletos y fallback al superar el límite.
Comando focal `pnpm --filter @hogaria/server exec vitest run src/utils/ticket-prompt.spec.ts
src/utils/ticket-lines-dedup.spec.ts src/utils/ai-queue.spec.ts --reporter=dot`: **43/43**; el baseline
antes de implementar el solver dio **2 fallos/9** en la suite del deduplicador. La suite completa del
servidor pasó **1243/1243 ejecutadas, 1 omitida**; `ticket-lines-dedup.ts` quedó en
**98.94/92.70/100/100 % S/B/F/L**, y `ticket-queue.ts` conservó **86.53/80.09/95.23/92.21 %**.
`pnpm --filter @hogaria/server run build`, Prettier y `git diff --check` pasaron. `pnpm --filter
@hogaria/server run lint` sigue sin poder ejecutarse con el script heredado: `eslint src --ext .ts`
usa una opción retirada por ESLint 9/flat config; no se alteró configuración ajena. No se usaron
tickets reales ni se llamó proveedor. Rollback: retirar el solver acotado, el paso de `totalMinor`
desde `ticket-queue.ts`, estas regresiones y esta evidencia; sin cambios de API/datos ni WebAPI.

**Entrega inicial de la reconciliación (2026-10-10):** commit `2e8ee90` se publicó con hooks completos;
pre-commit y pre-push validaron Prettier, `check:ui`, build server+frontend, typecheck E2E y unitarias
(frontend **1308/1308**; servidor **1239/1239 ejecutadas**, 1 omitida). La integración de conteos
mixtos descubrió después el defecto global descrito arriba.

**Corrección de conteos mixtos y CI (2026-10-10):** commit `9eeb96f` corrige esa regresión, pasa
las suites locales y sus hooks Lefthook sin bypass, y se publicó en la rama del PR. GitHub Actions,
run [38047761073](https://github.com/juanjoGonDev/MiCocinAI/actions/runs/38047761073), terminó con
**9/9 jobs verdes**, incluidos type check, server tests, production build, full-stack E2E y los cuatro
shards. PR #41 continúa abierto, fuera de Draft y sin merge. La validación con tickets reales sigue
abierta por la restricción vigente de no repetir solicitudes que pudieron completarse.

**Smoke live sintético WebAPI previo (2026-10-10, 10:53 CEST; supersedido):** preflight `prepareExistingAiLiveSmokeSession` con el opt-in
de logging local acotado; una llamada `POST /v1/chat/completions` desde Node stdin con dos `data:` URIs
sintéticas (`application/pdf` y `application/json`), `response_format.type=json_schema`, `strict=true` y
`stream=false`. HTTP **200**; la respuesta JSON cumplió el esquema y devolvió la categoría sintética del
catálogo; `cleanupVerified=true`. Los logs agregados registran `receivedFileCount=2`,
`normalizedAttachmentCount=2`, `includedInProviderRequestAttachmentCount=2`, pero
`readyAttachmentCount=1` y `sentToModelAttachmentCount=1`; por tanto, el resultado correcto no demuestra
que el JSON se enviara como archivo separado. No se repitió la petición, no se usaron tickets, no hubo
DB/inventario real y no se conservó contenido de la petición/respuesta ni credenciales.

**Evidencia de preflight (2026-10-09):** `pnpm exec vitest run --config
vitest.clipboard-e2e.config.ts tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts
--reporter=dot` en `D:\projects\webApi`: **18/18** con PNG/JSON sintéticos, sin completion, ticket
real, base de datos de MiCocinAI ni reinicio del listener. Repetido inmediatamente antes del smoke:
**18/18**. En MiCocinAI las unitarias focales pasaron **57/57**; cobertura por archivo modificado:
`ai-live-receipt-inputs.mjs` 94.34% líneas / 72.22% ramas / 100% funciones,
`ai-live-smoke-safety.mjs` 89.50% / 78.63% / 93.94% y `run-ai-real-smoke.mjs` 92.62% / 82.89% /
86.36%. También pasaron `pnpm run typecheck:e2e`, `pnpm run check:ui`, Prettier, `pnpm run build`,
`git diff --check` y el E2E sintético loopback (**1 passed, 2 skipped**) con SQLite/upload aislados.
Build finaliza; conserva warnings Angular y budgets preexistentes. El nuevo loader verificó seis
fuentes y construyó dos entradas `[1,3]` JPEG/PDF sin leer los PDF originales. El preflight live
comprobó identidad/readiness, controles de privacidad y modelo `gpt-5`, y limpió su credencial propia;
reportó **0 requests de completion**. El listener existente (PID 43088; iniciado 21:48 UTC) sigue
ready, WebAPI está limpio en `fix/partial-attachment-cleanup` a `7c1e52e9`; no se cambió settings ni
se reinició el servicio.

**Intento real y limitación (2026-10-09; unidad incompleta):** el smoke aislado activó exclusivamente
`unsubmitted-only`, sin capturas, traces o vídeo. El proxy verificó antes de reenviar las dos
peticiones que cada una llevaba `response_format` JSON Schema estricto y exactamente el adjunto
`inventario.json` más un ticket; no se abrió ni se leyó ningún PDF original. La JPEG preferida fue el
único ticket que llegó al flujo WebAPI: petición streaming **HTTP 400**, seguida solo por el fallback
no-stream permitido **HTTP 504**. El proxy se bloqueó y la E2E no inició el PDF largo ni otra llamada.
Los logs locales redacted del PID 43088 muestran `attachmentCount: 2`, etapa
`chatgpt_attachment_upload`, `errorCode: attachment_upload_failed`, `errorStatus: 504`,
`outcome: timeout`, `retryCount: 0`; el fallo ocurrió en `upload_attachments`, antes de que hubiera
una respuesta del modelo. El cleanup terminó cerrando la página (`cleanupOutcome: success`,
`cleanupMethod: page_closed`). No se afirma que el modelo recibiera ambos ficheros: el servicio los
intentó subir, pero el upload falló. Se observaron **2 requests HTTP, 0 respuestas completadas**;
no hubo duplicados evaluables, revisión/historial ni escritura de compra. El runner de aplicación,
SQLite y uploads fue temporal; no quedaban carpetas `hogaria-e2e-*` recientes al verificar después,
y el coordinador no reportó fallo al limpiar su token propio. WebAPI permaneció arriba, sin cambios.
En ese momento se detuvo aquí; posteriormente el usuario autorizó explícitamente un nuevo intento,
documentado a continuación.

**Segundo intento real (2026-10-09; autorizado por el usuario, unidad aún incompleta):** se revalidó
que `D:\projects\webApi` seguía limpio en `7c1e52e9`, que incluye el fix `e679f44d` y que el
listener existente PID 43088 arrancó después de ese commit. La E2E sintética WebAPI volvió a pasar
**18/18**; el preflight live volvió a confirmar identidad, readiness, privacidad, modelo `gpt-5` y
limpieza verificada del token temporal, con **0 requests de completion**. Antes del envío se comprobó
por nombre (sin registrarlo) que la JPEG preferida ahora ocupa el ordinal 4; el plan cerrado quedó en
dos tickets `[1,3]` (JPEG individual y PDF de tres páginas), sin leer los dos PDF individuales.

El contrato del proxy exigió `response_format` JSON Schema estricto y exactamente un `inventario.json`
más un ticket en cada petición; ambas solicitudes reenviadas cumplieron esa validación. El ticket JPEG
produjo HTTP **400** en streaming y solo se intentó el fallback no-stream permitido, que terminó en
HTTP **504**. Se registraron **2/4 requests, 0 respuestas 2xx/completadas**; el coordinador detuvo el
flujo y no envió el PDF largo ni volvió a intentar la JPEG. Los logs redacted del PID 43088 muestran
fallo `attachment_upload_failed`/timeout 504 durante la subida, sin eventos `prompt_submitted` ni
`response_completed`; el upload de ambos adjuntos no se considera exitoso ni se afirma que el modelo
los recibiera. La suite no pudo evaluar extracción, categorías, duplicados, edición o historial. El
servicio siguió listo; no se tocaron ajustes ni procesos de WebAPI. El coordinador no informó fallo al
limpiar el token propio y no quedaron directorios temporales del runner recientes; ninguna compra se
confirmó ni se guardó en la despensa/inventario real. No se generaron capturas, traces ni vídeos.

**Revalidación solicitada (2026-10-09; preflight, sin reenvío):** `D:\projects\webApi` sigue limpio
en `fix/partial-attachment-cleanup`, HEAD `7c1e52e9` (incluye `e679f44d`, limpieza de subidas
parciales). El servicio existente responde `ready=true` y `storage=ready`; sin embargo, el tail actual
de `/admin/api/logs` conserva 18 eventos `attachment_upload_failed` y 16 menciones HTTP 504 (los
eventos pueden duplicarse por una sola petición). El último fallo, a las 01:00:17 según el timestamp
local del log, es HTTP 504 con cleanup `page_closed`; el tail termina a las 02:04:51. No aparecen
`prompt_submitted` ni `response_completed`. Por tanto, el fix de cleanup no ha resuelto el timeout de
subida y no hay evidencia de que el proveedor recibiera el prompt. No se volvió a invocar la IA ni se
reenvió ticket alguno. Este preflight no constituye otro smoke y la unidad permanece abierta.

**Reintento de preflight (2026-10-09; sin enviar tickets):** WebAPI sigue limpio en el mismo HEAD
`7c1e52e9`; el listener existente continúa en `ready=true`/`storage=ready`. Una nueva lectura de
`GET /admin/api/logs?lines=2000` devolvió 405 líneas (sin truncar), con 18 `attachment_upload_failed`,
16 menciones del código 504 y cero `prompt_submitted`/`response_completed`. El último error de subida
sigue siendo el de las 01:00:17; el tail de esta lectura llega a las 02:26:24 por eventos locales de
salud/logs, no por una nueva petición de IA. Como el fallo de subida sigue registrado y no hay evidencia
de que el proveedor no recibiera los adjuntos, no se reenvió ningún PDF/JPEG ni se hizo otra llamada.
La validación real permanece incompleta; no volver a intentarla hasta verificar una corrección efectiva
de WebAPI/proveedor.

El mismo 504 persiste en el límite de subida de WebAPI pese al fix y a la cobertura sintética. No
reenviar tickets ni declarar esta validación completa hasta que WebAPI/provider resuelva este fallo.
El usuario concedió autorización permanente para la IA, así que no hace falta pedir consentimiento
otra vez tras corregirlo; antes de retomar, revalidar readiness/logs y continuar solo con fuentes cuyo
estado siga siendo inequívocamente no completado. Detenerse si una llamada pudiera haberse completado
o duplicado.

Por tanto, quedan sin marcar las casillas de validación de los tickets y cierre completo; la respuesta
real no llegó al modelo y no se puede declarar esta subunidad ni la spec completa.

**Nuevo reintento solicitado (2026-10-09; resultado fallido, unidad abierta):** se hizo `git fetch --all`
en `D:\projects\webApi`: no aparecieron commits posteriores; el checkout continúa limpio en
`7c1e52e9` (incluye `e679f44d`) y el listener existente PID 43088 sigue en `ready=true` /
`storage=ready`. La prueba sintética `pnpm exec vitest run --config vitest.clipboard-e2e.config.ts
tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts --reporter=dot` pasó **18/18**;
prueba limpieza/recovery con fixtures, no demuestra que el proveedor acepte ahora los adjuntos. El
preflight read-only volvió a validar `gpt-5`, readiness/privacidad y cleanup verificado del token
temporal (0 completions).

Se reanudó el smoke cerrado `unsubmitted-only`, en concurrencia 1, sin abrir los dos PDF individuales:
la JPEG preferida volvió a producir HTTP **400** en streaming y el único fallback no-stream permitido
terminó en HTTP **504** (**2/4 requests, 0 respuestas completadas**). Ambos requests atravesaron el
validador previo del proxy —`response_format` JSON Schema estricto y exactamente un adjunto
`inventario.json` más un ticket—; WebAPI registra el fallo como `attachment_upload_failed` durante
`chatgpt_attachment_upload`, antes de `prompt_submitted`. El tail sin truncar de 577 líneas muestra
27 fallos de subida, cero `prompt_submitted`/`response_completed` y cero `cleanup_failed`; el servicio
permanece listo. El test aislado se detuvo tras el primer ticket y **no** mandó el PDF de tres fotos ni
repitió el intento de subida después del 504. No se pudo validar la respuesta/schema, las categorías,
duplicados, edición o historial. La base de datos/uploads y browser del runner fueron temporales; el
cleanup del token propio se verificó, sin nuevas carpetas de runner ni procesos Chrome/Node huérfanos;
no se escribió en la despensa/inventario real ni se guardaron resultados o medios.

**Conclusión:** sigue presente el timeout de subida pese al cleanup/recovery probado. No hacer otro
reenvío de tickets hasta observar un cambio efectivo del WebAPI/proveedor; si se corrige, retomar solo
la JPEG (su último resultado fue 504 sin prompt ni respuesta) y luego, únicamente si pasa, las tres
fotos juntas como PDF multipágina. Los dos PDF individuales continúan excluidos.

**Comprobación adicional solicitada (2026-10-09; sin nuevo smoke):** `git fetch --all --prune` no
encontró commits nuevos; WebAPI continúa limpio en `7c1e52e9` y el listener PID 43088 respondió
`/health/ready` con HTTP 200 (`ready=true`, `storage=ready`). La lectura de
`/admin/api/logs?lines=500` conserva la correlación del intento anterior (`kaamY`): nueve registros
`attachment_upload_failed` entre 03:15:09–03:16:09, ocho `page_closed` y cero
`prompt_submitted`/`response_completed` (las filas de log no son el número de peticiones). El intento
previo acabó en HTTP 504 tras el fallback, con cleanup correcto; el timeout de subida sigue sin
resolverse. En esta comprobación solo se hicieron GET de readiness/logs: no hubo petición IA nueva ni
se reenvió un ticket, por lo que la validación permanece incompleta.

**Reintento solicitado (2026-10-09; solo preflight, sin reenvío):** tras actualizar referencias con
`git fetch --all --prune`, no hay commits nuevos: `D:\projects\webApi` sigue limpio en
`7c1e52e9` y su upstream apunta al mismo commit. El listener PID 43088 arrancó a las 23:48, después
del fix `e679f44d` (23:42), y `/health/ready` responde HTTP 200. Sus logs locales aún contienen la
correlación previa `kaamY`: dos adjuntos, timeout de subida de 45 s y HTTP 504 a las 03:16:09;
`page_closed` confirma que sí funcionó la limpieza, pero no hay `prompt_submitted` ni
`response_completed`. No aparecen intentos IA posteriores en ese log hasta su última escritura a las
07:16. Esto confirma que el fix de recuperación/limpieza no corrigió el bloqueo de subida. No se hizo
ninguna llamada IA ni se reenvió ticket alguno; no evaluar todavía extracción, categorías ni duplicados.

**Revalidación tras los cambios locales de WebAPI (2026-10-09; sin reenvío de tickets):** la rama
`fix/live-ticket-inventory-attachments` sigue en HEAD `a6105c20`, pero su árbol ahora contiene cambios
locales no confirmados en el flujo de adjuntos, navegador y pruebas. El listener PID 36628 inició a las
07:02 UTC, después de esos cambios, y `/health/ready` devolvió `ready=true`; no se tocaron settings ni
credenciales. Sobre esta fuente, la E2E sintética de fallback pasó **19/19** y las unitarias de
`attachment-flow.test.ts` pasaron **14/14**. No bastan para demostrar aceptación real del proveedor.

El smoke live de WebAPI `pnpm run test:e2e:chatgpt-ticket-inventory-live` usó exclusivamente un JPEG y
un `inventario.json` sintéticos con marcadores únicos, en el perfil autenticado existente, con
`AGENTA_CAPTURE_CONTENT=false`; no accedió a tickets reales. La sonda encontró tres inputs de fichero y
el código eligió el índice 2, el único que acepta imagen/JSON/PDF. Aun así, la carga terminó en
`attachment_upload_failed`/HTTP 504 después de 45 s, antes de enviar el prompt: `attachments_not_represented`,
`expectedCount=2`, `visibleCount=1`, `mediaPreviewCount=1`, `fileNameMatchCount=0`,
`fileInputCount=3`, `selectedFileCount=0`, `pending=false` y `rejected=false`. No llegó respuesta que
contuviera ambos marcadores; el arreglo aún no está validado y la limitación observable es la
representación/readiness de los dos adjuntos, no el tiempo de espera.

La prueba cerró navegador y runtime; se verificó que no quedara lease del perfil, directorio temporal
de archivos sintéticos ni proceso Chrome del test, y WebAPI siguió listo. El smoke aislado de MiCocinAI
ejecutado antes de observar este cambio local devolvió HTTP 400 en streaming y HTTP 504 en el único
fallback; el proceso previo se reinició y ya no ofrece logs correlacionables de esa petición, por lo
que no se afirma si el proveedor llegó a recibirla. No se repitió esa JPEG, no se envió el PDF largo ni
ningún PDF original, y no hubo escritura al inventario real. No volver a enviar los tickets hasta que
el par sintético obtenga ambos marcadores y se confirme el estado de la petición anterior.

**Reintento tras corregir la representación de adjuntos (2026-10-09; validación incompleta):** el
checkout WebAPI sigue en `fix/live-ticket-inventory-attachments`, HEAD `a6105c20`, con cambios locales
no confirmados que se dejaron intactos. El listener PID 59588 ejecuta `node --import tsx src/main.ts`,
arrancó a las 09:14 hora local después de las modificaciones de producción (`attachment-flow.ts`
09:10 y `browser.ts` 08:56), y `/health/ready` respondió 200 (`ready=true`, `storage=ready`). WebAPI no
publica SHA del proceso. `pnpm run test:e2e:chatgpt-ticket-inventory-live` pasó **1/1** con solo una
imagen y un JSON sintéticos: la sonda vio tres inputs; el índice 2 acepta JPEG/JSON/PDF; la respuesta
de ChatGPT contenía ambos marcadores únicos. Esto demuestra la ruta de adjuntos para el par sintético,
no el resultado real de MiCocinAI ni el esquema de tickets.

El preflight aislado de MiCocinAI validó identidad, disponibilidad/modelo y controles de privacidad de
WebAPI antes de crear el runner. El plan local revalidó seis fuentes (2 PDF y 4 JPEG), mantuvo la JPEG
preferida en el ordinal 4 y seleccionó únicamente `[1,3]`: esa JPEG sola y las otras tres fotos como
PDF temporal de tres páginas; no leyó ni reenvió los PDF individuales. El proxy de pruebas acepta y
registra una petición solo si lleva JSON Schema estricto `response_format`, exactamente un adjunto
`inventario.json` y un ticket. Ambas solicitudes observadas pasaron ese contrato: el stream devolvió
HTTP **400** y el único fallback no-stream permitido devolvió HTTP **502**. El runner terminó en rojo
con **2/4 requests, 0 respuestas HTTP 2xx** y se detuvo; no envió el PDF largo ni volvió a intentar la
JPEG. El tail redacted de WebAPI no expone un evento correlacionable ni una causa interna para ese 502,
así que no puede afirmarse si el proveedor llegó a completar el turno. La respuesta/schema, categorías,
deduplicación, revisión e historial no pudieron validarse.

Se confirmó que no quedaban procesos del runner ni directorios `hogaria-e2e-*` recientes; `/health/ready`
siguió en 200 y el coordinador no reportó error al limpiar su token temporal. No se escribieron compras
ni resultados en inventario real. No repetir la petición de la JPEG ni enviar las tres fotos hasta
aclarar el 502 con una prueba sintética/código/logs; los PDF individuales permanecen excluidos por su
resultado anterior potencialmente completado. La subunidad sigue abierta.

**Rollback:** revertir únicamente la selección live `unsubmitted-only`, sus pruebas y esta subunidad;
mantener el cargador general de fixtures sintéticas, adjuntos de inventario ya probados y el código de
WebAPI en su repositorio.

**Revalidación tras el supuesto arreglo de WebAPI (2026-10-09; detenida antes de IA y sin reenvío):**
el checkout local `D:\projects\webApi`, rama `fix/live-ticket-inventory-attachments`, está en
`f4241290`; el último commit solo actualiza la spec de WebAPI y no cambia los archivos de producción.
El listener existente PID 21588 ejecuta `node --import tsx src/main.ts`, arrancó a las 09:46 hora local
y `/health/ready` devolvió `ready=true`, `storage=ready`. La fuente vigente aún contiene el fallo: el
middleware multipart guarda cada fichero con el nombre `<índice>-<nombre original>` (p. ej.
`1-inventario.json`), mientras `buildOpenCodeMessageAttachments()` solo reconoce el nombre exacto o
un prefijo UUID para forzar la subida. Por ello el JSON staged no se clasifica como adjunto requerido;
`prepareOpenCodeAttachments()` lo trata como texto pequeño y lo añade al prompt. Además, si el JSON
fuera forzado pero excediese presupuesto/tamaño, la política actual también permite inlinearlo en vez
de fallar cerrado.

La reproducción local aislada con `0-ticket.jpg` y `1-inventario.json` sintéticos y temporales produjo
`ticketUploaded=true`, `inventoryUploaded=false`, `inventoryInlined=true`; los ficheros se limpiaron y
no se llamó al proveedor. Las pruebas focales
`pnpm exec vitest run tests/api/opencode/attachment-policy.test.ts tests/api/opencode/multipart-chat-completions.test.ts tests/providers/chatgpt/opencode-executor.test.ts --config vitest.config.ts --reporter=dot`
pasaron **30/30**, pero no cubren el prefijo numérico multipart (la regresión existente cubre el UUID),
por lo que no invalidan esta reproducción. El resultado sintético previo que solo comprobaba ambos
marcadores tampoco demuestra que ChatGPT recibiera dos tarjetas: el JSON puede provenir del contexto
inline. La spec vigente de WebAPI deja sin marcar la clasificación del nombre staged y el fallo cerrado.

**Situación antes del nuevo smoke (2026-10-09, 10:02):** no se envió otra llamada live: la causa de
upload se reprodujo antes de tocar el proveedor. La JPEG anterior, potencialmente ambigua, y los PDF
individuales seguían excluidos; el PDF largo todavía no se había enviado. Para retomar, WebAPI debía
reconocer el prefijo multipart numérico, fallar cerrado para el inventario requerido y demostrar con
evidencia de upload (no solo marcadores) que ambos ficheros llegaron al modelo.

**Revalidación del arreglo WebAPI antes del nuevo smoke (2026-10-09, 10:02; sin reenviar tickets):**
el checkout observado entonces en `D:\projects\webApi` estaba en `b55f958`; el fix de producción
estaba en `246291eb` y el commit posterior registraba la aceptación live sintética. El smoke sintético
pasó contra PID 47764, que inició después del fix. El listener observado entonces era PID 23540,
iniciado a las 10:02:01, después del fix;
`/health/ready` devuelve `ready=true`, `storage=ready`. El SHA-256 del executor en el checkout
(`138A09D6…BBC5F38`) coincide con el valor documentado por la spec de WebAPI. Esa spec registra el
smoke live con dos ficheros sintéticos: `uploadAttachmentCount=2`,
`inventorySnapshotUploadCount=1`, `inlineContextCount=0`, readiness `expectedCount=2` /
`visibleCount=2` y ambos marcadores; el token temporal de ese smoke fue revocado. Las pruebas focales
repetidas aquí, sin proveedor, pasaron **33/33** con el comando registrado arriba. No repetí la prueba
live sintética ni envié tickets reales en esta revalidación.

La JPEG preferida continúa excluida: el intento previo pudo completar upstream pese al HTTP 400/502,
por lo que no se reenvía. El único input elegible era el ticket largo formado por las otras tres fotos.
El harness `long-ticket-only` confirma sintéticamente que se genera un PDF de tres páginas y solo se
leen esas tres JPEG (no la JPEG preferida ni los PDF originales); el coordinador limita la ejecución a
un ticket y a su request streaming más un único fallback. Las pruebas focales del harness pasaron
**42/42** y `pnpm run typecheck:e2e` pasó. La carpeta de fuente contenía seis ficheros regulares
(2 PDF/4 JPEG), y la JPEG preferida era el ordinal 4 según el orden del cargador.

**Ejecución live del ticket largo (2026-10-09, 10:12; aislada):** tras preflight se envió una única
petición con el PDF temporal de las tres fotos y el inventario JSON; los PDF individuales y la JPEG
preferida no se leyeron ni reenviaron. El proxy del smoke observó `response_format` de tipo
`json_schema` estricto y exactamente un adjunto JSON de inventario junto con el adjunto del ticket.
En los logs correlacionados de WebAPI: `attachmentCount=2`, `requiredInventoryAttachmentCount=1`,
`inventorySnapshotUploadCount=1`, `inlineContextCount=0`; la preparación terminó correctamente y la
verificación de ChatGPT registró `expectedCount=2`, `visibleCount=2`, dos nombres coincidentes,
`pending=false`, `rejected=false`. `Prompt submitted` ocurrió a las 10:12:46.

No se recibió un reply final: el stream devolvió eventos de actividad, pero `wait_for_reply` terminó
con `timeoutMs=120000` y `OpenCodeHttpError`; el log seguro registró `responseCompleted=false` y no
apareció `Reply detected` ni una respuesta validada. MiCocinAI observó stream HTTP 400 y el único
fallback permitido acabó en HTTP 504. El smoke se detuvo
sin reenviar otro ticket; este ticket largo también queda excluido de reintentos porque pudo avanzar
upstream. No se validaron extracción, `response_format` en la respuesta, categorías, deduplicación,
revisión ni historial. Por tanto esta unidad **sigue incompleta**.

El runner usó una SQLite y directorio de subida temporales, sin escribir en el inventario real; el
token temporal de este run se eliminó y se comprobó ausente, y ya no queda proceso del smoke. La
limpieza automática del directorio `C:\Users\juanj\AppData\Local\Temp\hogaria-e2e-rROpSo` fue
bloqueada por la política del entorno: aún contiene el artefacto temporal y debe eliminarse después
de cerrar esta revisión. La inspección posterior mostró que el checkout de WebAPI ya estaba en otra
rama y tenía un cambio staged; no se modificó ni se usó para atribuir el resultado live.

**Reintento solicitado por el usuario (2026-10-09; preflight de WebAPI, sin nueva petición IA):**
`git fetch --all --prune` no encontró una corrección de producción posterior. El checkout visible de
`D:\projects\webApi` está limpio en `feat/session-attachment-previews`, HEAD `cdb14b9b` (el último
commit es documental). La rama local `fix/live-ticket-inventory-attachments` sigue en `b55f9589`, que
contiene `246291eb fix(chatgpt): upload staged inventory snapshots`; allí el executor elimina los
prefijos multipart numéricos/UUID para reconocer `inventario.json` y la política fuerza su subida sin
inline fallback por tamaño/presupuesto. El listener PID 7100 continúa respondiendo HTTP 200 en
`/health/ready`; arrancó a las 10:09 hora local, después de esos commits, pero WebAPI no expone el SHA
cargado, por lo que no se afirma una identidad binaria exacta del proceso.

El tail actual de `/admin/api/logs?lines=500` está truncado, termina a las 11:15:58 y conserva el
historial de esta corrida: una respuesta sintética detectada a las 10:10:27; el ticket largo tuvo
`Prompt submitted` a las 10:12:46 y `wait_for_reply` agotado a las 10:14:46. No hay un
`Reply detected` posterior al envío del ticket, `response_completed`, `attachment_upload_failed` ni
`cleanup_failed` en ese tail. Esto concuerda con la evidencia de la corrida anterior: ambos adjuntos
del ticket largo se vieron en ChatGPT, pero no se obtuvo reply dentro de 120 s. El problema observado
ya no es la representación/subida del par de ficheros; sigue sin demostrarse corregido el timeout de
espera/lectura de respuesta, y no aparece un cambio de producción posterior que lo resuelva.

No se hizo una nueva petición al proveedor ni se abrieron o reenviaron tickets. El ticket largo ya
alcanzó `prompt_submitted`; la JPEG tuvo un resultado ambiguo y los dos PDF individuales permanecen
excluidos por ejecuciones previas potencialmente completadas. Según la regla de no repetir una
petición que pudo completarse, no queda un grupo real elegible para otro smoke. La respuesta/schema,
las categorías y la deduplicación continúan sin validar; esta unidad no se marca completa.

**Reintento tras el supuesto arreglo WebAPI (2026-10-09, 12:42; sin reenviar tickets):** el checkout
actual de `D:\projects\webApi` está en `5b51127d` e incluye `5267dcd8` (recuperar replies inactivos)
y `b9e32fb5` (ignorar actualizaciones tardías). En un worktree detached temporal, las regresiones
locales pasaron: cuatro archivos unitarios, **39/39**, y el E2E de stream/recovery, **14/14**. Son
pruebas con fixtures, no validación del proveedor real. El PID antiguo 7100 (inicio 10:09:43) desapareció;
ahora escucha en `127.0.0.1:3001` el PID 8280, iniciado a las 12:42:06 —después de ambos fixes—.
`/health/ready` devuelve HTTP 200 (`ready=true`, `storage=ready`). Su tail contiene 20 líneas, sin
fallos de upload/cleanup ni requests posteriores al arranque; no hay aún etapas de recovery que observar.
WebAPI no publica el SHA cargado, por lo que el inicio posterior es evidencia de despliegue, no una
atestación binaria exacta.

No se abrió un smoke live: los dos PDFs ya dieron respuestas 200 validadas, la JPEG preferida llegó a
`Prompt submitted` antes del error 502 ambiguo, y el ticket largo llegó a `Prompt submitted` antes del
timeout. El selector denominado `unsubmitted-only` no consulta historial de envíos: el código carga
precisamente la JPEG preferida y el ticket largo ya intentados. Reusarlo repetiría peticiones que
pudieron completarse, contra la restricción vigente. Se mantiene sin validar la extracción real,
schema/categorías y deduplicación; para retomar se necesita que el servicio activo cargue el fix y un
ticket nuevo no enviado (o autorización explícita para repetir los anteriores). El usuario indica que
WebAPI sigue en reparación y pide posponer esta validación live hasta el final de la spec; entonces se
le volverá a preguntar si ya está listo. No se enviarán esos grupos antes. La unidad no se marca
completa.

**Preflight tras la nueva solicitud (2026-10-09; sin tickets):** `D:\projects\webApi` sigue en
`feat/session-attachment-previews`, HEAD `7eee7c7c`; el listener Node PID 50248 arrancó a las
13:10:59Z, después del fix de producción `fc324f07` (14:40 CEST), y `/health/ready` devuelve
`ready=true`, `storage=ready`. La regresión sintética
`pnpm exec vitest run --config vitest.clipboard-e2e.config.ts tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts --reporter=dot`
pasó **18/18**; verifica el flujo con fixtures, no extracción real ni respuesta del modelo. El usuario
confirmó que las dos sesiones recientes con dos/cuatro adjuntos eran sintéticas; este preflight no abrió
ni reenvió ningún ticket real. La evidencia anterior sigue siendo el ledger de los tickets reales: los dos
PDF tuvieron HTTP 200; la JPEG quedó ambigua y el PDF de tres fotos alcanzó `prompt_submitted` antes del
timeout. Aunque WebAPI esté listo, ninguno es seguro para reenviar bajo el criterio vigente de no repetir
peticiones que pudieron completarse. No hay grupo real no enviado que pueda procesarse ahora: schema,
respuesta, categorías y deduplicación siguen sin validar. Para cerrar la unidad hace falta una nueva fuente
no enviada o que el usuario cambie expresamente el criterio de no reenvío.

**Revalidación tras indicar el usuario que WebAPI ya debería funcionar (2026-10-09, 20:58):**
`D:\projects\webApi` está en `feat/session-attachment-previews`, HEAD `7eee7c7c`; su árbol
conserva el cambio ajeno `tools.txt` sin tocarlo. El fix de producción `fc324f07` es anterior al
listener actual (PID 50248, iniciado 13:10:59Z); `GET /health/ready` responde `ready=true`,
`storage=ready`. La regresión local
`pnpm exec vitest run --config vitest.clipboard-e2e.config.ts
tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts --reporter=dot` pasó **18/18**.
Es cobertura de browser con páginas/archivos sintéticos locales: no consulta al proveedor ni prueba
la petición live de MiCocinAI. No se reinició WebAPI ni se leyeron logs administrativos. Sigue sin
haber fuente real segura para reenviar: los PDF individuales ya respondieron, y la JPEG y el PDF de
tres fotos pudieron llegar al modelo en intentos anteriores. No se repitió ningún ticket; la
extracción real, schema/categorías y deduplicación permanecen pendientes hasta recibir una fuente
nueva no enviada o autorización explícita para cambiar la regla de no repetición.

**Comprobación posterior al aviso del usuario (2026-10-09, 21:23 CEST; sin tickets):** WebAPI sí
está activo en `127.0.0.1:3001` (PID 50248, `node --import tsx src/main.ts`); el endpoint
`GET /health/ready` responde **HTTP 200**. `:8000` no es el puerto de este proceso. El checkout
permanece en `feat/session-attachment-previews`, HEAD `7eee7c7c`; se preservó sin tocar el cambio
ajeno `tools.txt`. No hice una petición IA ni leí logs administrativos. El estado de readiness no
cambia la condición de no repetir: los dos PDF ya tienen respuesta; la JPEG quedó ambigua y el ticket
largo sí alcanzó `prompt_submitted`. Hace falta material nuevo no enviado o una instrucción explícita
que permita repetir los grupos ambiguos. La validación real no se marca completa.

**Revalidación live tras autorización expresa del usuario (2026-10-09):** el usuario
autorizó repetir una vez la JPEG preferida y el grupo largo ambiguos. Reprocesé **solo** el grupo largo
que aún no tenía una respuesta válida; no repetí los PDF ni la JPEG y no volveré a repetir este grupo.
WebAPI seguía en `feat/session-attachment-previews`/`7eee7c7c`; el proceso PID 50248 arrancó después
del fix `fc324f07`, readiness HTTP 200 y `maxAttachmentCount=10`. El plan cargó 6 fuentes pero abrió
únicamente las otras tres fotos para construir un PDF de tres páginas en memoria. En runner Chromium,
SQLite, uploads y puertos temporales, el smoke devolvió `result=passed`, 1 ticket, 2 peticiones: ambas
llevaban `response_format` JSON Schema estricto, exactamente un `inventario.json` y un ticket; la
primera respuesta streaming fue HTTP 400 y el fallback no-stream permitido fue HTTP 200, con JSON
utilizable. La UI dejó el ticket en revisión con líneas no vacías, no encontró líneas equivalentes
duplicadas y verificó edición de metadatos e historial tras recarga. No se confirmó compra ni se
escribió en el inventario real; el coordinador confirmó cleanup del token propio y runner aislado.

**Límite descubierto en la misma ejecución:** los logs redacted de WebAPI registran que MiCocinAI
entregó ambos ficheros a la API, pero la etapa ChatGPT preparó/subió `fileCount=1` y registró
`Prompt submitted` con `attachmentCount=1`. El límite efectivo es 10, sin aviso de truncamiento. El
código de WebAPI explica la diferencia: `writeAttachmentBuffer()` antepone un UUID a cada basename;
`buildOpenCodeMessageAttachments()` solo reconoce `inventario.json` sin prefijo o con prefijo
numérico, así que no fuerza la subida de `<UUID>-inventario.json`. `prepareOpenCodeAttachments()` puede
tratar ese JSON pequeño como contexto inline en vez de un segundo archivo. Por tanto, aunque el proxy
validó que ambos adjuntos salieron de MiCocinAI, **no está verificado que WebAPI enviara ambos como
adjuntos al modelo**; la validación solicitada sigue incompleta. El resultado no se usa para afirmar
que la clasificación recibiera el inventario como archivo.

El runner también imprimió el hito estático «los cuatro tickets ... verificados» cuando esta selección
procesó uno; el JSON final sí indicó `tickets=1`. Se corrige esa telemetría junto al selector para que
el mensaje sea válido para una o varias fuentes.

**Revalidación de WebAPI antes de tocar la JPEG:** checkout `D:\projects\webApi`, rama
`feat/session-attachment-previews`, HEAD `7eee7c7c`; árbol de trabajo sin cambios nuevos salvo el
`tools.txt` del usuario, que se preservó. El listener PID 50248 continúa activo y readiness HTTP 200,
pero el código fuente en ese checkout conserva el detector
`/^(?:\d+-)?(?:inventario|inventory)\.json$/iu`; `writeAttachmentBuffer()` genera en cambio
`<UUID>-inventario.json`. La prueba existente solo cubre `1-inventario.json`, no esta ruta UUID. Esto
coincide con la telemetría redacted `fileCount=1`/`attachmentCount=1` del smoke anterior. Readiness
no prueba la entrega del archivo al modelo y no se vuelve a llamar al proveedor hasta verificar en
WebAPI ambos contadores en 2. No se editó ni reinició ese servicio.

**Evidencia previa al último reintento autorizado (2026-10-10):** `/health/ready` responde
`ready=true, storage=ready` en `127.0.0.1:3001`; el listener es PID 56924 y el checkout está en
`a1c64d4e`. La PR [#164](https://github.com/juanjoGonDev/webApi/pull/164) está abierta, ya no en Draft,
y su CI actual terminó correctamente (`37994193530`). Su instrumentación mejora los contadores de
adjuntos/previews, pero la inspección del HEAD confirma que `writeAttachmentBuffer()` aún guarda con
prefijo UUID mientras `buildOpenCodeMessageAttachments()` solo fuerza nombres exactos o prefijos
numéricos; la regresión existente cubre `1-inventario.json`, no `<UUID>-inventario.json`. Por eso
readiness, CI verde y contadores de recepción/preparación no demuestran que ambos ficheros lleguen al
modelo como archivos. El cuerpo actual de la PR anuncia diez pruebas con proveedor y adjuntos
sintéticos; eso no equivale al smoke de tickets ni resuelve por sí solo esta discrepancia de ruta.
No se reenvían la JPEG ni el grupo largo; el smoke real de tickets y la entrega del inventario como
segundo archivo siguen sin validación completa.

**Plan SDD histórico (supersedido por la evidencia de adjuntos posterior):** la autorización nueva no permite repetir un
grupo que ya terminó en esta corrida. Los dos PDF siguen excluidos, el grupo largo queda cerrado con
respuesta pero sin validar el segundo adjunto y solo la JPEG preferida queda pendiente de un nuevo
intento. El selector existente `unsubmitted-only` vuelve a incluir el grupo largo, por lo que no se
puede usar sin duplicarlo. Añadir un modo explícito `preferred-jpeg-only` que lea/suba únicamente esa
JPEG, con un ticket, máximo dos solicitudes (stream y fallback solo ante HTTP 400), y pruebas de que no
lee PDFs ni las otras tres fotos. Usarlo para la llamada real únicamente después de corregir y verificar
la preparación de adjuntos en WebAPI; no volver a procesar el grupo largo.

- [x] TDD del selector `preferred-jpeg-only`: el plan contiene un JPEG; instrumentar el lector para
      demostrar que no abre los dos PDFs ni las otras tres JPEG; derivar presupuesto/ticket esperado de 1.
- [x] Corregir el texto de progreso estático para que `real-receipts-all-verified` no afirme que se
      verificaron cuatro tickets al procesar una sola selección; cubrir el mapa del hito con prueba.
- [x] Validar las selecciones y el contrato con suites aisladas/loopback; verificar strict JSON Schema,
      un adjunto de ticket + un adjunto JSON y cleanup. No llamar al proveedor en pruebas sintéticas.
- [x] Antes del reintento autorizado del grupo largo, exigir que los logs redacted acrediten dos
      adjuntos listos y enviados; la prueba live sintética confirmó que el modelo lee ambos. La JPEG
      potencialmente completada no se reenvió y no hubo retry tras el fallo 400/502 del grupo largo.

**TDD y evidencia local (2026-10-09):** primero fallaron las pruebas nuevas de single-JPEG,
presupuesto del coordinador, allowlist y hito genérico. Tras añadir el selector, el comando
`node --test scripts/ai-live-receipt-inputs.test.mjs scripts/ai-live-smoke-safety.test.mjs
scripts/run-ai-real-smoke.test.mjs scripts/ai-live-smoke-runner-control.test.mjs` pasó **50/50**.
Incluye fixture temporal que lee solo `04.jpeg`, selección/coordinador limitados a un ticket y dos
requests, validación loopback de JSON Schema estricto y un adjunto de recibo + inventario, y cierre
de proxy/sesión propios; no llama a proveedor. `pnpm run typecheck:e2e`, `pnpm run check:ui`
(212 ficheros/21 reglas) y `git diff --check` también pasaron. El E2E live queda pendiente por el
defecto de WebAPI descrito arriba.

**Rollback:** retirar solamente el selector single-JPEG, su presupuesto y pruebas, la corrección del
hito genérico y esta actualización de spec; no cambiar el grupo largo ya completado ni datos reales.

**Revalidación del diagnóstico de adjuntos (2026-10-10; sin tickets):** el usuario confirmó que en la
UI de WebAPI se veían los dos adjuntos. La corrección de logs de WebAPI aclara que `fileCount=1` era
el recuento de una operación individual `page.setInputFiles`, no el tamaño del lote. La rama de la
PR #164 (`feat/session-attachment-previews`, HEAD `a1c64d4e`) ahora separa contadores de archivos
recibidos, preparados, listos en lote, asignados por operación, enviados al prompt y disponibles para
vista previa; el conteo de previews se actualiza después de persistir artefactos y los fallos de
cleanup no ocultan el error original. En la copia local, la E2E sintética de adjuntos pasó **19/19**;
el PR aparece abierto y Ready for review y `gh pr checks 164` mostró sus gates verdes. Esto prueba
los logs/casos sintéticos, no que el listener local cargue esos cambios ni que el proveedor recibiera
ambos adjuntos en una nueva petición.

El listener existente de `127.0.0.1:3001` (PID 39880) está listo (HTTP 200 en `/health/ready`), pero
inició el 2026-10-09 a las 23:16, antes de los commits de comportamiento/telemetría de la PR
(`dbf0e742` 23:18, `87644939` 23:21, `043f50d8` 23:24 y `a1c64d4e` 23:27 CEST). El comando activo
es `node --import tsx src/main.ts`, sin watcher; por tanto readiness no acredita que ese proceso haya
cargado el cambio posterior. Se preservó el servicio sin reiniciarlo ni reconfigurarlo. No se abrió ni
reenvió la JPEG o el grupo largo. El grupo largo ya tuvo una respuesta válida y no se repite; la única
petición pendiente sigue siendo la JPEG, cuya repetición estaba autorizada, pero queda pospuesta hasta
que el listener esté actualizado y su log redacted pueda verificar los contadores descritos arriba.

**Smoke autorizado de la JPEG preferida tras el reinicio (2026-10-10):** el proceso en `:3001`
fue PID 56924 (`node --import tsx src/main.ts`), iniciado a las 00:54:11 CEST, después del HEAD
`a1c64d4e`; `/health/ready` dio `ready=true`, `storage=ready`. La E2E sintética de WebAPI volvió a
pasar **19/19**. Después se ejecutó una sola vez `preferred-jpeg-only`, ordinal 4, con DB, runner y
almacenamiento temporales; el coordinador terminó `result=passed`, `tickets=1`, `requests=2`,
`completions=1`, `verifiedStrictSchemaRequests=2`, `verifiedInventoryJsonAttachments=2` y
`verifiedReceiptAttachments=2`. Hubo fallback de HTTP 400 a HTTP 200; la respuesta fue JSON y la UI
dejó líneas en revisión, permitió editar metadatos y verificó persistencia/historial. No hubo compra
confirmada ni escritura en el inventario real; el runner confirmó la limpieza de su entorno aislado.

La inspección acotada del detalle/logs WebAPI de esa misma sesión confirma dos ficheros recibidos,
normalizados e incluidos en la petición interna, más dos previews (JPEG y JSON). No obstante, solo
se registra un archivo adjunto listo y enviado en el prompt: `readyAttachmentCount=1` y
`sentToModelAttachmentCount=1`. La fuente actual explica que el UUID del nombre impide forzar la
subida de `inventario.json`; como el JSON mide menos de 64 KiB, la política lo convierte en bloque de
texto inline. Esto apunta a que el inventario llegó como texto, no como segundo archivo; no se
inspeccionó el prompt para comprobar su contenido y la UI de previews no prueba el envío al modelo.
Por ello el JSON devuelto, aunque pasó el contrato de respuesta, no valida que las categorías
respetasen el inventario.
La prueba de deduplicación entre las tres fotos pertenece al ticket largo ya procesado y no se repitió;
la JPEG individual no cubre ese criterio. La autorización de repetir la JPEG ya se consumió; no se
reintenta ni se vuelve a enviar el ticket largo. Esta evidencia no cierra QA-AI.REAL-INTEGRATIONS.1.

**Revalidación posterior al aviso de reinicio (2026-10-10, 08:28 CEST):** el listener que atendió
seguía siendo PID `56924`, con CWD `D:\projects\webApi`, HEAD `a1c64d4e` e inicio `00:54:11 CEST`
(el mismo PID/inicio que en el smoke de las 00:56, sin un reinicio posterior observable);
`/health/ready` devolvió `ready=true`, `storage=ready`. El preflight solo aceptó los logs locales con
`HOGARIA_AI_REAL_SMOKE_ALLOW_REDACTED_REQUEST_LOGS=1`: captura de cuerpo/cabeceras en cero y grabación
de sesión/HTML diagnóstico apagados; no se cambiaron ajustes. Se ejecutó otra selección aislada
`preferred-jpeg-only` (solo la JPEG preferida, una vez): `result=passed`, 1 ticket, 2 solicitudes
estrictas, primer intento streaming HTTP 400 y fallback no-stream HTTP 200. La app validó/persistió la
respuesta como JSON en estado `review`, con líneas, edición de metadatos e historial tras recarga; el
runner y su SQLite/uploads temporales se limpiaron. No se confirmó el ticket ni se escribió en el
inventario real.

**El criterio de adjuntos volvió a fallar.** En las dos solicitudes la app/proxy verificó
`response_format` JSON Schema estricto y exactamente 1 adjunto de ticket + 1 `inventario.json`; WebAPI
registró `receivedFileCount=2`, `normalizedAttachmentCount=2`,
`includedInProviderRequestAttachmentCount=2` y dos previews, pero solo
`readyAttachmentCount=1` y `sentToModelAttachmentCount=1`. No se inspeccionó el prompt: los contadores
no prueban el contenido inline ni que el modelo usara las categorías del snapshot.

La causa comprobable sigue en el camino de Chat Completions activo: `src/api/opencode/controller.ts`
`writeAttachmentBuffer()` crea `<UUID>-<basename>`, mientras `src/providers/chatgpt/opencode-executor.ts`
solo fuerza `inventario.json` sin prefijo o con prefijo decimal. El nombre UUID no coincide; por tanto,
la política puede inlinear el JSON pequeño y solo enviar un fichero. La detección de prefijo multipart
numérico no corrige esta ruta UUID. No se reenvía ninguna otra fuente: la JPEG ya pudo completarse y
el ticket largo no se repitió; la entrega de ambos adjuntos, la clasificación basada en inventario y
la deduplicación de las tres fotos siguen sin validar. Mantener la casilla live abierta hasta que la
telemetría muestre dos adjuntos listos y dos enviados, y exista una ejecución autorizada no duplicada.

**Comprobación tras nuevo aviso de reinicio (2026-10-10, 09:00 CEST; solo lectura):** aunque el usuario
indicó que WebAPI se había reiniciado, el listener consultado seguía siendo PID `56924`, con creación
`00:54:11 CEST`; `/health` informó `startTime=2026-10-09T22:54:12Z`, igual que en la comprobación
anterior. El checkout local está en `feat/session-attachment-previews`, HEAD `a1c64d4e`; se observó el
cambio local ajeno `tools.txt` y se preservó. No se hizo llamada IA, no se releyeron ni reenviaron
tickets y la autorización de repetición de la JPEG sigue consumida. No hay evidencia observable de un
reinicio posterior, por lo que no se reabre el smoke: ambos adjuntos enviados al modelo, categorías
guiadas por el snapshot y deduplicación del grupo largo siguen sin validarse.

**Revalidación tras el aviso del usuario (2026-10-10, 10:22 CEST; solo lectura):** confirmo que el
listener de `127.0.0.1:3001` está listo y PID `56924` inició después del HEAD local `a1c64d4e`
(`2026-10-09 23:27:42 CEST`), así que el proceso sí pudo cargar esa revisión. Sin llamar al proveedor,
ejecuté `buildOpenCodeMessageAttachments()` con rutas sintéticas: `1-inventario.json` quedó forzado a
subida (`true`), pero `550e8400-e29b-41d4-a716-446655440000-inventario.json` no (`false`). La causa es
concreta: `controller.ts::writeAttachmentBuffer()` antepone un UUID, mientras la expresión en
`opencode-executor.ts` admite solo nombre exacto o prefijo decimal. La corrección publicada para el
prefijo ordinal no cubre el nombre que realmente genera esta ruta. No reenvié tickets ni hice una
petición live: el intento autorizado de la JPEG ya se consumió y el ticket de tres fotos ya obtuvo una
respuesta potencialmente completada. El smoke real queda bloqueado hasta corregir y probar el caso UUID
con datos sintéticos y disponer de una fuente no repetida o autorización expresa para otra lectura real.

### Subunidad QA-AI.REAL-INTEGRATIONS.ATTACHMENT-PAIR.1 · adjuntar y leer el inventario junto al ticket

**Contrato:** el inventario actual se entrega como un fichero `application/json` independiente del
ticket, sin inlinearlo en el prompt. WebAPI debe preparar ambos ficheros, confirmar que ChatGPT ve los
dos y que los dos se envían; una prueba sintética con respuesta JSON Schema estricta debe demostrar que
el modelo leyó el contenido de ambos. Esta subunidad solo valida el transporte/lectura del par: no cierra
la clasificación de tickets reales ni la deduplicación del ticket multipágina.

- [x] Ejecutar la suite focal de `opencode-executor.test.ts` (**23/23**); validar el nombre UUID real en
      la siguiente prueba live, ya que la suite unitaria no tiene una assertion específica para ese
      prefijo.
- [x] Tras reiniciar WebAPI, ejecutar con una sola pareja sintética ticket+JSON una petición real no
      streaming, con `response_format` JSON Schema estricto; validar los marcadores de ambos ficheros y
      la evidencia segura de preparación, visibilidad y envío (`inlineContextCount=0`, `visibleCount=2`).
- [x] Hacer una lectura del grupo largo autorizado y comprobar por logs que el snapshot generado se
      envió como fichero separado, sin abrir los PDF ni la JPEG preferida; no confirmar ni persistir en
      el inventario real.
- [x] Limpiar y verificar solo el token y temporales propios de estas corridas; no modificar tokens
      preexistentes ni capturar contenido personal en logs, reportes o artefactos.

**Evidencia live (2026-10-10, 11:22–11:35 CEST):** `pnpm exec vitest run
tests/providers/chatgpt/opencode-executor.test.ts` en WebAPI pasó **23/23**. En la única ejecución real
autorizada `long-ticket-only`, el runner aislado agrupó las tres fotos restantes y produjo el PDF temporal
del ticket más el snapshot actual; no abrió los dos PDF ni la JPEG preferida. WebAPI registró
`attachmentCount=2`, `requiredInventoryAttachmentCount=1`, `inventorySnapshotUploadCount=1`,
`inlineContextCount=0`, `uploadAttachmentCount=2`; la preparación del navegador confirmó
`expectedCount=2`, `visibleCount=2`, `pending=false`, `rejected=false`, `readyAttachmentCount=2` y
`sentToModelAttachmentCount=2`. Por tanto, el caso del nombre con UUID ya envía realmente el JSON como
segundo fichero, no como texto inline.

Esa petición no devolvió un ticket validable: el intento streaming recibió HTTP 400 y el único fallback
no-streaming recibió HTTP 502; el runner terminó en error sin JSON final. El log seguro termina en
`prompt_submitted`, la sesión quedó en estado `error` y el listener cambió de PID `44736` a `21112` a
las 11:24:42, durante esa ventana. La coincidencia temporal no demuestra que el reinicio causara el 502;
no se obtuvo respuesta que permita comprobar categorías, edición, historial o duplicados. La repetición
autorizada de este grupo queda consumida y no se reenvía porque el modelo pudo haber completado.

Después, sobre el listener estable `21112`, la E2E real sintética
`node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run
tests/providers/chatgpt/attachment-pair.live.e2e.test.ts --config vitest.e2e.config.ts` pasó **1/1** en
24,17 s. El modelo devolvió los dos marcadores exactos bajo el esquema estricto; logs del mismo request:
`inventorySnapshotUploadCount=1`, `inlineContextCount=0`, `readinessVisibleCount=2` y
`uploadAttachmentCount=2`. El token sintético propio fue borrado y verificado, igual que sus temporales.
Una consulta de solo lectura encontró tres tokens anteriores de smoke aún activos y sin caducidad,
creados el 2026-10-04/07; no se registraron sus IDs/valores ni se modificaron, pues no pertenecen a esta
corrida. El usuario autorizó conservarlos por ahora (2026-10-10); no revocar ni modificar sin nueva indicación.

**Actualización WebAPI (2026-10-10, posterior al smoke):** se verificó que las PR #163 (entrega de adjuntos de inventario) y #164 (previews/diagnóstico de adjuntos) están merged. El checkout local `D:\projects\webApi` está limpio en `master` y coincide con `origin/master` en `f47f4b8`; en ese repositorio la rama principal se llama `master`. `GET http://127.0.0.1:3001/health/ready` devuelve `ready=true`, `storage=ready` (listener PID 55680). WebAPI no expone el SHA cargado por el proceso, por lo que el health check no demuestra el commit runtime. El intento anterior del ticket largo terminó HTTP 400/502 sin JSON validable; no se repite porque pudo haber completado. No se tocaron los tres tokens preexistentes conservados a petición del usuario.

**Revalidación sintética post-merge (2026-10-10):** con el listener PID 55680 y sin cambiar settings,
`prepareExistingAiLiveSmokeSession` verificó health/modelo/privacidad, creó un token temporal propio y
confirmó su borrado al terminar. Se usó el opt-in local para logs acotados: `enabled=true`,
`captureDetails=true`, `maxBodyChars=0`, `maxHeaderValueChars=0`, `maxHeaders=0`; grabación de sesión
y HTML diagnóstico desactivados;
`AGENTA_CAPTURE_CONTENT=false`. La E2E live `tests/providers/chatgpt/attachment-pair.live.e2e.test.ts`
pasó **1/1** (24,35 s): pidió JSON Schema estricto, el modelo devolvió ambos marcadores sintéticos
exactos y WebAPI registró `attachmentCount=2`, `inventorySnapshotUploadCount=1`,
`inlineContextCount=0`, `uploadAttachmentCount=2`, `readinessVisibleCount=2`. Fixture, perfil de
navegador y token propios limpiados; no se abrieron tickets reales ni se escribió en el inventario.

**Verificación adicional del WebAPI fusionado (2026-10-10):** el checkout limpio de
`D:\projects\webApi` coincide con `origin/master` en `f47f4b8`; las PR #163 y #164 constan como
merged. `GET http://localhost:3001/health/ready` responde HTTP 200, aunque WebAPI no expone el SHA
cargado por el listener. La regresión sintética del navegador, ejecutada contra ese checkout con
`pnpm exec vitest run --config vitest.e2e.config.ts
tests/providers/chatgpt/attachment-clipboard-fallback.e2e.test.ts --reporter=dot`, pasó **22/22**.
Incluye fallo parcial con dos ficheros y verifica el reset/limpieza sin volver a invocar `setInputFiles`;
solo usa el compositor y adjuntos sintéticos, sin completar peticiones al proveedor ni abrir tickets.
El primer comando sin `--config=vitest.e2e.config.ts` no encontró pruebas porque la config unitaria
excluye `*.e2e.test.ts`; no ejecutó pruebas ni hizo llamadas. No se reenviaron las solicitudes reales
que podían haberse completado.

**Revalidación del listener tras el merge (2026-10-10; solo lectura):** Git confirma
`HEAD=origin/master=f47f4b8`, commitado a las 11:56:20 CEST. El listener en `127.0.0.1:3001` es PID
`55680`, iniciado a las 12:32:45 CEST; `/health/ready` devuelve `ready=true`, `storage=ready`. La
hora de inicio posterior al merge es coherente con el reinicio comunicado, pero el health endpoint no
expone un SHA y no permite acreditar por sí solo el binario/source cargado. No se reenviaron tickets ni
se hicieron llamadas al proveedor en esta comprobación.

**Cierre limitado:** quedan demostrados el envío y la lectura por el modelo de la pareja de ficheros en
el WebAPI activo. `QA-AI.REAL-INTEGRATIONS.1` sigue abierta hasta obtener una respuesta validada de los
tickets, respetando la prohibición de repetir los grupos que pudieron completarse, y comprobar
clasificación con el snapshot, deduplicación multipágina, revisión e historial.

**Rollback:** retirar solamente este subapartado y sus cuatro marcas; no alterar servicios, tickets,
tokens preexistentes ni inventario.

### QA-AI.SMOKE.CANCELLATION.1 · cancelar el smoke sin dejar procesos o datos huérfanos

**Fuente revalidada (2026-10-08):** el perfil vigente usa la WebAPI preexistente: la cancelación nunca
debe parar/reiniciar el servicio ni revertir settings. `prepareExistingAiLiveSmokeSession` propaga
`AbortSignal` antes y durante requests normales; su ruta de limpieza ignora la señal para borrar y
verificar solo el token propio. El coordinador cierra primero el proxy y luego limpia la sesión; el
runner Playwright solicita cierre por IPC y confirma procesos/puertos antes de limpiar SQLite y
temporales. Tests ya cubrían cancelación antes del preflight, del runner, durante E2E y cleanup del
coordinador; se añade cobertura del instante posterior a crear el token y anterior a consultar modelo.
Los deadlines vigentes en `ai-live-smoke-contract.mjs` son 270 s/request, 20 min/test, 21 min/global
y 22 min/watchdog. La corrida live alcanzó 152 s en la completion más lenta, por lo que el antiguo
límite de 90 s no representa la latencia del modelo activo; el plazo de 270 s conserva margen sin
elevar el techo de 10 completions ni permitir retries/hard-stop.

- [x] Propagar cancelación en preparación de sesión y ejecución E2E; responder con fallo seguro,
      limpiar el token propio y cerrar el proxy sin modificar/parar la WebAPI existente.
- [x] Confirmar cierre de procesos y puertos del runner antes de limpiar temporales; ante cierre no
      verificable, preservar datos para no borrar bajo un proceso activo.
- [x] Cubrir cancelación antes/durante setup tras creación del token y durante E2E con pruebas
      deterministas sin proveedor; comprobar orden de cleanup y no imprimir secretos.
- [x] Alinear límite a 270 s por request, 20 min/test, 21 min/global y 22 min/watchdog; respetar
      el presupuesto duro de 10 completions y no recurrir a retries ni hard-stop.

### Subunidad QA-AI.SECRET-REDACTION.1 · proteger credenciales y datos en errores upstream

**Fuente revalidada (2026-10-03):** `ai-client.ts` era una frontera común para errores upstream,
lecturas de JSON y streaming; `ai.routes.ts` devuelve el borrador completo de receta y la cola de
tickets persiste fallos en `ai_jobs.error_detail`. El runner Playwright común conserva artefactos/SQLite
cuando CI está activo o el test falla, por lo que no es seguro usarlo sin cambios con una configuración
que contenga una credencial real.

- [x] Antes de un smoke real, añadir pruebas con un token sentinel sintético que el proveedor simulado
      repite en respuestas HTTP, cuerpo JSON/stream y fallo de transporte; exigir que no aparece en
      mensajes/API/filas persistidas, sin borrar códigos útiles de error ni semántica de timeout/cancel.
- [x] Redactar los diagnósticos de generación, conexión y lectura de tickets antes de que alcancen la
      UI, base de datos o logs; conservar solo información de transporte/estado que no incluya secretos
      ni payloads arbitrarios.
- [x] Separar el smoke con credencial del runner general: salida/trace/video/screenshot
      desactivados, 1 worker y cero reintentos. Borrar solo SQLite, uploads y artefactos propios tras
      confirmar que el proceso y los puertos aislados cerraron; si no se puede verificar, conservar
      temporales y fallar en vez de reportar éxito. Demostrar que la suite normal usa proveedores
      sintéticos/loopback y excluye el smoke live.

**Evidencia TDD (2026-10-03):** las pruebas se añadieron antes del endurecimiento y fallaron con
sentinels en errores HTTP/transporte, respuesta JSON válida/malformada, eco de clave corta, streaming,
respuesta de conexión, API de receta y fila/consulta de ticket. Con `DATABASE_PATH=:memory:`:

- `$env:DATABASE_PATH=':memory:'; pnpm --filter @hogaria/server test`: **959/959**.
- `$env:DATABASE_PATH=':memory:'; $report = Join-Path $env:TEMP 'hogaria-server-coverage-20261003-r2'; pnpm --filter @hogaria/server exec vitest run --coverage.enabled --coverage.reportsDirectory=$report`: **959/959**; todas las unidades incluidas superan 70 % en statements/branches/functions/lines (total: 93.07/84.58/95.15/95.59 %).
- `pnpm --filter @hogaria/server run build` y `git diff --check`: pasan.

Las respuestas upstream de estas pruebas son simuladas, sin llamadas externas. `shopping.routes.ts`
ya fallaba `prettier --check` en el `HEAD` inicial; se conservaron sus líneas ajenas al cambio sin
reformatear el archivo entero. En esta revalidación histórica aún quedaban pendientes el manejo del
runner con secretos y la verificación explícita de red.

**Revalidación de CI (2026-10-08):** el run `37711377694` falló porque el test comprobaba que la
respuesta no contuviera el prefijo genérico `sk-`; un ID aleatorio de configuración coincidió por
azar con ese texto aunque la clave no se devolviera. Se reprodujo de forma determinista con un ID
sintético que contiene el prefijo: la assertion antigua falla; la nueva verifica ausencia de ambos
campos (`api_key`/`apiKey`) y del valor sintético completo enviado como clave, conservando el ID.
El test dirigido pasó **1/1** y `ai.routes.spec.ts` **57/57**, sin modificar producción ni llamar al
proveedor.

**Revalidación del runner (2026-10-08):** `playwright.ai-real-smoke.config.ts` mantiene reporter de
consola, `retries: 0`, `workers: 1` y `screenshot`/`trace`/`video` apagados; `outputDir` queda dentro
del directorio de aislamiento temporal. El coordinador reduce el entorno heredado, excluye el bearer
de WebAPI del runner/navegador y solo informa hitos allowlistados. El runner detiene la app antes de
comprobar puertos y borrar su propio directorio (DB, uploads y artefactos); ante cierre o limpieza no
verificables devuelve fallo y conserva el temporal en lugar de borrarlo mientras pueda estar en uso.
Las pruebas de cleanup/cancelación son deterministas y el coordinador solo acepta éxito cuando recibe
`runnerCleaned: true`.

`node --test scripts/ai-live-existing-webapi.test.mjs scripts/ai-live-smoke-safety.test.mjs
scripts/ai-live-smoke-runner-control.test.mjs scripts/ai-live-smoke-contract.test.mjs
scripts/run-ai-real-smoke.test.mjs`: **48/48**. Smoke E2E dedicado con
`node scripts/run-isolated-playwright.mjs --config=playwright.ai-real-smoke.config.ts
--project=chromium-ai-real-smoke tests/e2e/ai-real-smoke.spec.ts`, rate limit activo y Chrome local:
**1 pasada, 1 escenario live omitido por falta de opt-in**, cleanup confirmado; la pasada usa solo el
proveedor loopback sintético. Las suites normales se revalidaron en SQLite/puertos temporales con
`node scripts/run-isolated-playwright.mjs --project=chromium tests/e2e/ai-config.spec.ts
tests/e2e/ai-provider-queue.spec.ts tests/e2e/recipes-ai-generation.spec.ts`, `E2E_RATE_LIMIT=on`:
**41/41**. El censo de llamadas de IA confirma configuración interceptada, proveedores locales
loopback o fixtures sintéticas; `playwright.config.ts` excluye explícitamente el smoke live y
`playwright.full-stack.config.ts` solo carga `tests/e2e/full-stack/`. No se usaron claves reales ni
proveedor exterior. La E2E real del runner usa SQLite/puertos temporales y reporta que eliminó
DB/artefactos tras detener su app aislada.

## Unidad QA-LAYOUT.CONTENT-GUTTERS.1 · márgenes homogéneos en las vistas

**Fuente inicial anterior a la implementación (2026-10-03):** `app.routes.ts` monta las rutas privadas de producto bajo
`MainLayoutComponent`; Auth, invitación y onboarding tienen shells separados por diseño. El shell
principal no posee un contenedor/gutter común de contenido y las features declaran máximos y padding
propios (p. ej. Dashboard 800 px, Calendar 1280 px, Preferences 1360 px). `DESIGN-SYSTEM.md` ya fija
`--container-max: 1280px` y gutters de 16/24/32 px según breakpoint, pero `route-baseline.spec.ts` solo
mide visibilidad, errores y overflow en 28 rutas; no compara bordes de contenido ni comprueba qué shell
espera cada ruta. La intención explícita del usuario es homogeneizar los márgenes sin ensanchar
formularios/columnas de lectura por encima de límites útiles.

**TDD rojo (2026-10-03):** la regresión `layout-gutters.spec.ts`, con el runner aislado, SQLite efímera,
`E2E_RATE_LIMIT=on`, Chrome escritorio y Pixel 5, falló en ambos proyectos antes de cambiar producción:
los shells esperados sí estaban, pero las seis rutas representativas no montaban ningún
`app-page-container` en los 8 viewports (320, 393, 568 horizontal, 767/768, 1023/1024 y 1440 px). Un
sondeo inicial que comparaba el `padding` de Dashboard/Calendar/Preferences halló discrepancias (Dashboard
32 px desde 768 frente a 24 esperados; Calendar 24 px desde 768 frente a 32 desde 1024; Preferences 16 px
en todos), pero se descartó como contrato insuficiente porque no mide el marco exterior ni el shell.

- [x] Convertir los gutters de `DESIGN-SYSTEM.md` en un único contenedor/patrón compartido de página;
      eliminar paddings laterales literales divergentes en wrappers externos de features. Contenido
      interno más estrecho puede conservar `max-width` propio, centrado y legible.
- [x] Mantener shells intencionales: privada usa `MainLayout`; Auth, invitación y onboarding conservan
      su composición específica, pero aplican los gutters comunes. Ninguna ruta protegida puede perder
      el shell o renderizar un segundo shell.
- [x] Extender el manifiesto E2E a todas las rutas reales, parámetros/detalles y vistas por módulo;
      afirmar shell esperado y medir en navegador el mismo gutter/borde exterior por viewport. Incluir
      cada breakpoint hallado en código y 320 px/orientación horizontal; no sustituir mediciones por
      `scrollWidth` solamente.
- [x] Ejecutar la matriz real en desktop y móvil: bordes alineados, sin clipping/overflow, safe-area,
      scroll, navegación fija, drawers/modales, teclado/foco y targets táctiles; guardar e inspeccionar
      capturas sintéticas comparables PC/móvil y mantener los anchos internos intencionalmente distintos.
- [x] Añadir pruebas unitarias para la regla compartida, ejecutar E2E completo del manifiesto en
      Chromium escritorio y Pixel 5, build/typecheck/formato/diff checks y cobertura por archivo ≥70 %;
      no marcar como homogéneo un baseline que solo haya comprobado ausencia de overflow.

**Evidencia final (2026-10-08):** fuente revalidada en `styles.scss`, `PageContainerComponent` y los tests
del manifiesto antes de cerrar. La unidad de `app-page-container` pasó **3/3** pruebas Karma y cobertura
por archivo **100/100/100/100 % S/B/F/L** (0 ramas instrumentadas); comprueba proyección y la variante
deliberada `fullContent=false`. La matriz aislada de
`layout-gutters.spec.ts` más `safe-area-layout.spec.ts`, `main-layout-drawer.spec.ts` y
`pantry-touch-targets.spec.ts` cubrió 39 rutas (incluidos detalles sintéticos) en Chromium y Pixel 5:
shell/gutters/raíces en 49 viewports, scroll hasta el final sin quedar bajo navegación fija, insets
sintéticos portrait/landscape, nav fija, drawer/foco/Escape, modales y acciones táctiles. La unidad
E2E valida en navegador la geometría calculada del marco/gutter. El primer pase combinado reveló y
reprodujo la carrera del test de Pantry descrita en QA-PANTRY.TOUCH.1; tras corregir solo la
sincronización E2E, todas las pruebas de layout/drawer/safe-area pasaron y el archivo Pantry pasó
**7/7 aplicables** (un caso táctil omitido en Chromium). `preferences-width.spec.ts` pasó sus dos casos
aplicables en desktop y Pixel 5 (dos skips condicionados al proyecto). También pasan
`page-container.component.spec.ts` **3/3**, `pnpm run test:client` **1201/1201** con coverage
**90,32/81,46/88,96/91,75 % S/B/F/L**, `pnpm run typecheck:e2e`, `pnpm run check:ui` (210 archivos,
21 reglas, 0 incidencias), build de producción, Prettier focal y `git diff --check`. Las capturas
sintéticas comparables, guardadas e
inspeccionadas de Dashboard, Calendario, Preferencias, drawer, safe-area y Pantry están en
`.e2e-screenshots/qa-layout-content-gutters-recheck-20261008/` (ignoradas por Git). No hubo cambios CSS:
las raíces mantienen el marco común `--container-max:1280px`, sin alterar los max-width interiores de
formularios y tarjetas; la auditoría geométrica global de familias sigue abierta.

**Revalidación del drawer en WebKit (2026-10-10):** el fallo del E2E estaba en su coordenada, no en
`MainLayoutComponent` ni en Escape. En Safari `innerWidth` era 393 px, pero el hitbox del overlay
terminaba en x=387; el clic fijo en x=391 caía en el gutter de scrollbar (`elementFromPoint` devolvía
`null`). La prueba ahora calcula un punto dentro del overlay y a la derecha del sidebar, y verifica el
hit-test antes del clic. `main-layout-drawer.spec.ts` pasó **3/3** en mobile-safari y **6/6** en
Chromium + Pixel 5; el Escape/foco funciona en los cuatro viewports móviles y el clic exterior, botón,
navegación, límites desktop y ruta de cuenta pasan. El runner aislado confirmó cleanup de DB/proceso;
no cambió CSS ni runtime, por lo que siguen vigentes las capturas PC/móvil inspeccionadas arriba.

### QA-LAYOUT.PREFERENCES-END-CONTROL.1 · acción final alcanzable sobre navegación fija

**Fuente revalidada (2026-10-03):** `/preferences` usa la ruta autenticada bajo `MainLayoutComponent`.
La vista termina en `.preferences__actions` con el botón accesible «Guardar preferencias»; en móvil,
`.bottom-nav` es fija y `main.main` reserva 64 px más el inset inferior disponible. `preferences-width.spec.ts`
ya cubre gutters/overflow y pestañas, pero no mide si la acción final se puede alcanzar y activar sobre
esa navegación en una altura corta.

- [x] Añadir una E2E aislada en archivo nuevo, solo para Pixel 5, que mida 320×568, 393×851 y 568×320.
- [x] En cada viewport, desplazar hasta «Guardar preferencias», medir que su caja queda completamente
      visible y fuera del rectángulo de `.bottom-nav`, comprobar hit-test/click y esperar confirmación.
- [x] Ejecutar la prueba con el runner aislado (SQLite/puertos/semilla propios); no usar la base normal.

**Evidencia de cierre (2026-10-08):** `node scripts/run-isolated-playwright.mjs --workers=1
--project=mobile-chrome tests/e2e/preferences-end-control-reachability.spec.ts --reporter=dot` pasa
**1/1** con el rate limit activo, Chrome local, SQLite/puertos/semilla temporales y cleanup confirmado.
En Pixel 5 valida 320×568, 393×851 y 568×320: tras scroll, «Guardar preferencias» queda íntegramente
visible sobre `.bottom-nav` fija, recibe el hit-test central, se puede pulsar y espera el PATCH exitoso
y la confirmación. No se usó la base/servidor normal. E2E typecheck, Prettier focal y `git diff --check`
se reejecutan junto con la unidad activa de Preferencias.

**Rollback:** quitar el archivo E2E nuevo y este subapartado; no modifica producción ni datos normales.

### QA-LAYOUT.RECIPE-DETAIL.1 · medir la ficha real de receta desde su deep link

**Fuente revalidada (2026-10-03):** `route-layout-manifest.ts` y `layout-gutters.spec.ts` ahora ejercitan 31 casos estáticos (5 públicos, 1 de onboarding y 25 autenticados) más 8 detalles poblados, para **39 casos**. El manifiesto comprueba `/` → `/dashboard`, `/auth` → `/auth/login` y el fallback de una ruta desconocida. `populatedDynamicRoutes()` incluye la receta persistida; el test comprueba la descripción real y elimina solo esa fixture en `finally`. `recipe-actions-mobile.spec.ts` abre el deep link real y recorre la ficha larga y los dos diálogos relevantes.

**Hallazgo visual adicional (2026-10-03, captura y geometría sintéticas):** la primera medición real a 320 px halló que el título «Generar Receta con IA» tocaba el botón de cierre (gap **0 px**). Se añadió primero la aserción geométrica y después se ajustó el CSS compartido del modal; el test actual usa además un título de receta deliberadamente largo.

- [x] Reconciliar el censo del manifiesto con `app.routes.ts` y rutas de features; probar las redirecciones raíz, `/auth` y fallback, y no fijar un total obsoleto.
- [x] Añadir la receta sintética guardada al manifiesto mediante `createSyntheticRecipe()`; abrir `/recipes?recipe=<id>`, comprobar diálogo/receta reales (no 404/fallback) y borrar solo esa fixture incluso ante fallo.
- [x] Recorrer la ficha real en Chromium y Pixel 5 por los viewports y límites de breakpoint ya medidos; confirmar shell único, contenedor/gutters 16/24/32 px, límites internos intencionales y ausencia de clipping/overflow.
- [x] Verificar el diálogo accesible desde el deep link: foco inicial/trampa, scroll del cuerpo, Escape/cierre y limpieza del query; incluir 320×568, 393×851 y 1440×900.
- [x] Confirmar con geometría de navegador que los títulos largos no se solapan ni se recortan frente al botón de cierre a 320, 393 y 1440 px.
- [x] Guardar e inspeccionar capturas sintéticas comparables de PC/móvil; ejecutar typecheck, E2E focal y matriz completa, build, formato, diff checks y coverage focal ≥70 % sin bajar gates. La validación de safe-area no nula en iOS/WebKit permanece explícitamente abierta porque falta el ejecutable requerido.

**Rollback:** revertir solo la extensión de receta/redirect del manifiesto, sus E2E y este subapartado; no cambia el contrato ni los datos de producción.

**Implementación y evidencia (2026-10-03):** se añadió `app-page-container` como marco de página,
con variantes bounded/unbounded y gutters compartidos de 16/24/32 px; el shell privado usa el ancho
máximo común de 1280 px y conserva los máximos internos de cada vista. Los shells de Auth/invitación/
onboarding conservan su composición sin duplicar padding horizontal exterior. `route-layout-manifest.ts`
comparte su inventario con el baseline y define 31 casos estáticos; la ampliación posterior añade 8
detalles dinámicos poblados. La primera implementación roja detectó ausencia del contenedor en las seis rutas de
referencia; el barrido geométrico posterior detectó además overflow real en Dashboard a 480–482/559–561
px y Compra a 361 px. El cambio mínimo de breakpoint (Dashboard 4 columnas desde 600 px, filtro compacto
de Compra hasta 362 px) eliminó ambos defectos.

`layout-gutters.spec.ts`, runner aislado, rate limit activo: **2/2** proyectos (Chromium desktop y
Pixel 5) pasan tras las comprobaciones finales de shells; cada proyecto recorre 31 casos estáticos en 49
viewports (incluye 320 px, horizontal y cada breakpoint numérico CSS ±1), mide gutter efectivo,
contenedor único, max-width privado, shell correcto y overflow horizontal. `main-layout-drawer.spec.ts`
añade **2/2** Chromium/Pixel 5 para navegación fija, safe-area CSS disponible, targets táctiles,
teclado/foco, Escape, scroll del drawer y bordes 1024/1025/1440. El navegador Pixel no aporta un inset
safe-area no nulo; la verificación en Safari/WebKit quedó bloqueada porque falta el ejecutable de la
versión Playwright requerida (no se instaló ni actualizó nada). En ese primer pase todavía faltaban
detalles dinámicos y la interacción de ficha; la ampliación siguiente y la evidencia focal de esta
subunidad los cubren. El cierre de la unidad padre sigue pendiente por safe-area no nula, cobertura por
archivo del resto de componentes y auditoría visual/interactiva completa.

**Ampliación de detalles poblados (2026-10-03):** las rutas dinámicas de categoría, producto, cola IA,
inventario (ficha y edición), receta, lista de compra y ticket cuentan con contenido sintético real; la ruta de
ticket se prepara antes de una config `.invalid` para evitar llamadas externas. Se añadieron fixtures
para inventario, edición, lista y ticket, comprobando contenido y no solo el estado 404. Tras un TDD
rojo con ID inexistente, `pnpm run test:e2e -- tests/e2e/layout-gutters.spec.ts --project=chromium --project=mobile-chrome --reporter=list`
pasó **4/4** con `E2E_CHROME_BIN` apuntando al Brave instalado; usa el runner aislado, rate limit activo
y limpia SQLite/artefactos al cerrar. `pnpm run typecheck:e2e` y
`pnpm exec prettier --check tests/e2e/helpers/route-layout-manifest.ts tests/e2e/layout-gutters.spec.ts`
también pasan. En ese pase inicial las capturas y la safe-area no nula seguían pendientes; las capturas
comparables se generaron después en una carpeta ignorada por Git, y Pixel 5 no expone un inset no nulo.

Karma `page-container.component.spec.ts`: **2/2**; E2E y pruebas aisladas con SQLite/puertos/usuario
sintéticos, nunca contra la base normal. También pasan `pnpm run typecheck:e2e`, Prettier focal y build
de producción; el build conserva avisos de presupuesto/imports sin cambiar sus gates. Última matriz capturada
y revisada: escritorio y móvil en `%TEMP%\hogaria-e2e-7CJKSx\artifacts\layout-gutters-todas-las-r-47ec2-lican-un-único-gutter-común-{chromium,mobile-chrome}\dashboard-{desktop,mobile}.png`.

**Cierre focal QA-LAYOUT.RECIPE-DETAIL.1 (2026-10-03):** la matriz E2E completa se repitió con un
worker, rate limit activo, Chrome local y stack/SQLite/puertos aislados:
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/layout-gutters.spec.ts --reporter=dot`
pasó **4/4** en 1,7 min; cada proyecto recorrió 39 casos × 49 viewports. La prueba focal
`recipe-actions-mobile.spec.ts` pasó **2/2** en escritorio y Pixel 5, con título sintético largo;
comprobó deep link, foco inicial, scroll, acciones, Tab/Shift+Tab, Escape/cierre, query y gap geométrico
≥8 px. También comprobó el modal IA en 320/393 px sin requests reales al endpoint IA.

**Revalidación de la E2E móvil (2026-10-09):** el baseline aislado reprodujo un fallo porque la
prueba buscaba los dos botones de generación mientras el wizard seguía en el paso 1; esos controles
solo existen en el paso 3. La E2E ahora avanza y verifica los pasos 1→2→3, y mide los tres botones
finales («Anterior», «Generar 1 receta» y «Generar 3 opciones»). La focal en Pixel 5 pasó **1/1** y
el grupo aislado de regresión de recetas pasó **26/26** en Chromium y Pixel 5 (`E2E_RATE_LIMIT=on`);
el test confirma que no se llama al endpoint IA. Es corrección de la prueba, sin cambio de producto.

Capturas sintéticas revisadas: `.e2e-screenshots/qa-layout-recipe-current/recipe-actions-detail-1440.png`,
`recipe-actions-detail-320.png`, `recipe-actions-detail-393.png`, `recipe-actions-ai-320.png` y
`recipe-actions-ai-393.png`. `pnpm run typecheck:e2e`, Prettier focal y `git diff --check` pasan.
`pnpm --filter @hogaria/web run build:prod` pasa con advertencias de bundle/styles/imports. Karma focal
ejecutó **22/22** pruebas; `modal.component.ts` cubre **90,21/79,62/100/91,11 % S/B/F/L** y
`page-container.component.ts` **100/100/100/100 %** (sin ramas en el archivo). El comando enfocado sale
con código 1 únicamente porque el agregado parcial no alcanza el gate global 80 % (**53,26/28,27/46,96/57,53 %**); no se cambió ningún umbral y el gate global permanece abierto.

**Revalidación por CI (2026-10-08):** la E2E móvil había usado `Locator.scrollIntoViewIfNeeded()`, que
dejó el paso final en `y=5.9 px` bajo la cabecera fija de 56 px. Se cambió la prueba a
`Element.scrollIntoView({ block: 'start' })` para ejercitar el `scroll-margin-block` CSS existente. La
repetición Chromium + Pixel 5 de `recipe-full-detail.spec.ts` pasó **2/2**; no hubo cambio de producción.
La verificación WebKit/safe-area no nula sigue abierta como ya se documenta en esta unidad.

### QA-CI.RECIPE-AI-REQUEST-SCOPE.1 · contar solo llamadas que pueden llegar al proveedor

**Fuente revalidada (2026-10-10):** CI `38042245009` falló en shard 3 en
`recipe-actions-mobile.spec.ts:238`: la aserción «sin llamadas IA» contó `GET /api/ai/configs`, que
solo lee configuraciones locales y no llama al proveedor. `server/src/routes/ai.routes.ts` distingue
esa lectura de las acciones POST que ejecutan modelos (`/test-connection`, `/generate-recipe`,
`/generate-multiple-recipes`, `/replace-meal`, `/recommendations`, `/plan-week`).

**Contrato:** al recorrer el detalle y abrir/cerrar el formulario IA sin ejecutarlo, permitir GET de
configuración y fallar ante cualquier POST de generación/test de proveedor; no relajar la prohibición
de llamadas externas ni cambiar producción.

- [x] Diagnosticar el rojo de CI y ajustar el observer/assertion E2E para distinguir las rutas locales
      de configuración de los endpoints provider-bound; validar el método HTTP y rutas del router.
- [x] Ejecutar `recipe-actions-mobile.spec.ts` en Chromium y Pixel 5, conservar asserts de scroll,
      foco, geometría y que no se invoca ningún endpoint de proveedor.
- [x] Ejecutar `typecheck:e2e`, formato, `check:ui`, `git diff --check`, hooks, commit atómico, push y
      esperar CI verde; test-only, sin cambio de producto ni llamadas al modelo.

**Evidencia (2026-10-10):** CI `38042245009` expuso el falso positivo; la corrida local previa al
cambio pasó 2/2 porque no reprodujo la carrera de carga de configuraciones. La observación ahora solo
cuenta POST a los endpoints de IA que llaman al proveedor según `ai.routes.ts`, permitiendo
`GET /api/ai/configs`. Tras el ajuste, el mismo runner aislado `node scripts/run-isolated-playwright.mjs
--workers=1 --project=chromium --project=mobile-chrome --forbid-only
tests/e2e/recipe-actions-mobile.spec.ts --grep 'formulario IA cabe en móvil' --reporter=line` pasó
**2/2** en Chromium y Pixel 5; la aplicación temporal se limpió y no se invocó ningún proveedor.

**Cierre (2026-10-10):** el código/test quedó publicado en la rama de PR #41; el CI `38044063543`
terminó en el intento 2 con **9/9 jobs verdes**, incluidos E2E, typecheck, build y servidor. El intento
1 tuvo fallos transitorios en tres E2E ajenos a este observer, documentados en
`QA-RECEIPTS.LINE-REMOVAL-MATCHING-TOTAL.1`; las reproducciones focales y el reintento CI pasaron.
Hooks Lefthook corrieron sin bypass. No hubo llamada IA.

**Rollback:** revertir únicamente el filtro/assertion de solicitudes del test E2E y este subapartado.

### QA-LAYOUT.MAIN-CONTENT-WIDTH.1 · mismo ancho útil en todas las vistas

**Fuente revalidada (2026-10-03):** `MainLayoutComponent` limita `app-page-container` a
`--container-max: 1280px` y aplica gutters de 16/24/32 px. Sin embargo, las raíces de página conservan
límites independientes: Dashboard 800 px, Ajustes 640 px, Cuenta 720 px, tickets 760 px, Pantry 860–1000
px, Compras 760–1040 px y otros. `layout-gutters.spec.ts` comprueba la geometría del marco compartido y
que el wrapper raíz no duplique padding, pero no compara el ancho real de ese root con el contenido del
marco. Por eso el baseline aprobaba mientras el contenido visible variaba entre vistas. La instrucción
posterior del usuario exige que cada vista use exactamente la misma caja útil del contenido de `main`;
prevalece sobre la excepción anterior que permitía anchos máximos distintos en wrappers de página.

- [x] Unificar el marco de contenido en todas las rutas y shells con el ancho máximo común de 1280 px y
      los gutters responsivos existentes. Fondos a sangre completa pueden seguir fuera del marco.
- [x] Hacer que cada raíz de vista/render de ruta ocupe exactamente el área interior del marco común,
      sin `max-width`, padding lateral ni centrado independientes. Si una tarjeta o formulario requiere
      lectura estrecha, limitar solo ese elemento interior sin estrechar el root de la vista.
- [x] Extender el manifiesto/Playwright para comparar bordes reales de cada root con el área útil de
      `app-page-container` en rutas públicas, onboarding, privadas y detalles poblados; incluir 320 px,
      horizontal, 1920 px y cada breakpoint ±1, con tolerancia geométrica ≤1 px y sin overflow.
- [x] Ejecutar primero la regresión roja; luego matriz Chromium escritorio/Pixel 5, comprobar shells,
      scroll, drawer/modal/teclado/foco/targets táctiles y safe-area; guardar e inspeccionar capturas
      sintéticas PC/móvil. Correr build, typecheck, formato, diff-check y coverage sin rebajar gates.

**Rollback:** revertir únicamente los cambios de anchura de raíces de página, su cobertura en manifiesto/
E2E y este subapartado; conservar el contenedor compartido y las pruebas de safe-area ya existentes.

**Evidencia QA-LAYOUT.MAIN-CONTENT-WIDTH.1 (2026-10-03):** TDD reprodujo primero la diferencia a 1440 px:
`/account` tenía una raíz de 720 px frente a los 1096 px útiles del main. Tras el cambio, la matriz `layout-gutters.spec.ts`
pasó **4/4** en Chromium escritorio y Pixel 5; verificó 31 rutas estáticas y 8 detalles poblados en 50 viewports
(320 px, horizontal, 1920 px y bordes de breakpoint ±1), alineación ≤1 px y ausencia de overflow. Las regresiones
adyacentes de drawer, safe-area sintética y acciones/teclado del detalle pasaron **6/6**. Capturas sintéticas revisadas
(PC/móvil): `.e2e-screenshots/qa-layout-main-width-697042c84fd041f58eaae287424ce3f7/dashboard-{desktop,mobile}.png`
y `recipe-detail-{desktop,mobile}.png`.

`pnpm run typecheck:e2e`, `pnpm run check:ui` (**188 ficheros, 20 reglas, sin incidencias**), build de producción y
`git diff --check` pasan; el build conserva avisos existentes de bundle/imports. La suite Karma completa pasó **912/912**,
pero el reporte agregado no supera el gate global configurado (coverage **77.43/64.51/75.65/78.93 % S/B/F/L**); no se
rebajó. Prettier focal pasa en los demás archivos cambiados, pero señala `logs.component.ts` y `caducidades.component.ts`
por formato histórico: se conservaron sin reformateo masivo. Por estos gates de cobertura/formato, la última casilla
quedó abierta en ese momento.

**Revalidación final (2026-10-08, HEAD `e53d6e9`):** la matriz se repitió en Chromium y Pixel 5 con
`E2E_RATE_LIMIT=on` y el runner aislado:
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/layout-gutters.spec.ts --reporter=dot`.
Pasó **4/4**; volvió a recorrer 31 rutas estáticas y 8 detalles poblados, cada una en 49 viewports desde 320 px
hasta 1920 px, incluyendo orientación horizontal y cada breakpoint CSS ±1. Las raíces coinciden con el área
útil compartida (≤1 px), se conservan shells y anchos internos deliberados y no aparece overflow horizontal.
El runner detuvo su proceso y limpió DB, puertos y artefactos temporales. Generó 68 capturas sintéticas en
`.e2e-screenshots/qa-layout-main-content-width-20261008-final/`; se inspeccionaron Dashboard, ficha de receta
y lista de compra comparables PC/móvil.

El hook pre-push de este HEAD volvió a ejecutar build/typecheck y suite completa: Karma **1201/1201**, coverage
**90.33/81.46/88.99/91.75 % S/B/F/L**, server **1226 passed/1 skipped**; formato y `check:ui` pasan. En esta
unidad solo cambian wrappers/estilos, sin lógica de negocio instrumentable, así que coverage focal por archivo
es N/A; la geometría se valida en navegador. Se conserva sin bajar ningún gate. PR #41 está abierto y Ready
(no Draft), sin merge. La validación de safe-area nativa no nula en iOS sigue pendiente en su unidad propia.

### QA-LAYOUT.SAFE-AREA.SYNTHETIC.1 · geometría del shell con inset inyectado

**Fuente revalidada (2026-10-03):** `index.html` declara `viewport-fit=cover`, pero el header ocupa
56 px desde el borde superior, `.main` solo reserva esos 56 px, y el drawer va de borde a borde sin
padding de notch/home indicator. `.bottom-nav` declara 64 px totales y añade `padding-bottom` dentro de
esa altura por `box-sizing:border-box`, reduciendo el área de sus controles; `.main` sí reserva el
inset inferior. Playwright en Pixel 5 informa `env(safe-area-inset-*) = 0`, así que la matriz actual no
prueba inset no nulo. WebKit/iPhone nativo sigue sin poder ejecutarse por la revisión de navegador
ausente y no se atribuirá evidencia nativa a insets sintéticos.

Contrato esperado: con insets superior/inferior/laterales no nulos, el shell móvil mantiene visibles y
tocables el header, drawer, contenido y navegación inferior; el alto útil de la barra inferior sigue
siendo 64 px además del área segura. En cero inset y en escritorio la geometría existente permanece.

- [x] Escribir primero una E2E aislada que inyecte tokens CSS app de safe-area no nulos y reproduzca
      header/control bajo el notch, controles del drawer bajo notch/home indicator y barra inferior sin
      64 px útiles; cubrir retrato y paisaje sin depender del valor `env()` del navegador.
- [x] Implementar tokens app derivados de `env(safe-area-inset-*, 0px)` y aplicarlos a header, gutter
      compartido, drawer, barra inferior y reserva del contenido; conservar el shell desktop y el caso
      inset cero.
- [x] Comprobar geometría, hit-test/teclado del drawer, objetivos inferiores ≥44×44, scroll corto y
      ausencia de clipping/overflow en 393×851 y 568×320 con insets sintéticos declarados.
- [x] Ejecutar Playwright aislado en Chromium y Pixel 5, build/typecheck/formato, diff-check y cobertura
      ≥70 % S/B/F/L para archivos de producción instrumentables; SCSS sin instrumentación queda N/A,
      sin rebajar gates globales. Guardar e inspeccionar capturas sintéticas comparables PC/móvil.
- [ ] Ejecutar aparte `mobile-safari` y observar inset nativo superior/inferior no nulo antes de afirmar
      validación real iOS; si falta WebKit o devuelve cero, registrar el bloqueo y dejar abierta esta casilla.

**Rollback:** revertir solo los tokens/reglas de safe-area, la E2E focal y este subapartado; no revertir
el contenedor común ni otros cambios del layout.

**Evidencia QA-LAYOUT.SAFE-AREA.SYNTHETIC.1 (2026-10-03):** TDD reprodujo primero el fallo en ambos
proyectos: con inset superior sintético de 24 px, el header seguía midiendo 56 px frente a los 80 px
esperados. Tras añadir tokens CSS para top/right/bottom/left, la primera corrida validó la geometría;
la captura encontró una espera frágil (`boundingBox()` devolvía null para el drawer ya fuera de vista).
Se cambió a sondeo de `getBoundingClientRect()` y se espera a que termine la transición de apertura
antes de medir el cierre y sus controles. La corrida final con un worker pasó **2/2** en Chromium y
Pixel 5; cubre 393×851 y 568×320, inset cero/no nulo, click de Recetas/Inicio, header, contenido, barra
inferior, drawer, foco/Escape, scroll corto, hit targets y ausencia de overflow.

Comando: `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/safe-area-layout.spec.ts --reporter=dot`, con `E2E_RATE_LIMIT=on`, Chrome local y DB/puertos/
semilla/artefactos temporales; runner limpió tras detener su app. `pnpm run typecheck:e2e`,
`pnpm --filter @hogaria/web run build:prod`, Prettier focal y `git diff --check` pasan. El build conserva
warnings existentes de bundle, presupuesto e imports; no se rebajaron gates. Solo se modificó CSS de
producción (`styles.scss`), sin archivo TS instrumentable para cobertura; cobertura S/B/F/L: N/A.
Capturas sintéticas revisadas en `%TEMP%\hogaria-safe-area-final-b8dcc311afa94912afce3c827a458c7d\`
(`safe-area-desktop-chromium.png`, `safe-area-mobile-mobile-chrome.png`).

**Revalidación WebKit (2026-10-10):** `pnpm run test:e2e -- --workers=1 --project=mobile-safari
tests/e2e/safe-area-layout.spec.ts --reporter=line` pasa **1/1** y el runner limpia SQLite y procesos;
ese E2E solo inyecta tokens sintéticos. En contexto Playwright `iPhone 13` medí directamente los cuatro
`env(safe-area-inset-*)`: top/right/bottom/left son **0 px**. WebKit está disponible en este Windows,
pero no ofrece un inset de dispositivo real en esta emulación; la última casilla permanece abierta hasta
ejecutar/medir Safari en hardware iOS con inset nativo superior e inferior no nulo.

### QA-LAYOUT.ROUTE-MATRIX.CI.1 · mantener la matriz de rutas completa dentro del presupuesto de CI

**Fuente revalidada (2026-10-09):** el run CI `37989343357`, shard 2, ejecutó 111 E2E correctamente
y agotó el timeout de 300 s en `layout-gutters.spec.ts` al comprobar `/settings`; el retry volvió a
agotarlo en `/logs`. El protocolo del navegador informó `session closed` al vencerse el test. El código
recorría secuencialmente las rutas públicas, onboarding y 25 rutas autenticadas, probando todas las
anchuras declaradas y B−1/B/B+1 en un único test. El timeout ocultaba una matriz sin resultado completo;
no demuestra un fallo de geometría de `/settings` o `/logs`.

**Conducta esperada:** mantener todas las rutas, anchos/altos, comprobaciones de shell, gutter, raíz,
overflow, errores de página, scroll y capturas actuales, pero distribuir la matriz estática en grupos
deterministas acotados. Cada test debe adjuntar un reporte propio, el manifiesto de lotes debe cubrir
cada ruta exactamente una vez, y ninguna ruta ni viewport se omite para hacer pasar CI.

- [x] Añadir primero una aserción que pruebe que los lotes cubren exactamente las rutas del manifiesto,
      sin duplicados ni omisiones; conservar el rojo CI como evidencia de la unidad indivisible actual.
- [x] Separar público/onboarding y rutas privadas en lotes equilibrados con reportes separados, sin
      reducir `VIEWPORTS`, las mediciones, capturas o asserts actuales.
- [x] Ejecutar la matriz completa aislada en Chromium y Pixel 5, verificar cada lote, artefactos únicos
      y cleanup; confirmar que no hay timeout ni errores JS de página inexplicados.
- [x] Ejecutar typecheck, formato, `check:ui`, `git diff --check`, build y gates de cobertura aplicables;
      registrar resultado, límites y rollback focal.
- [x] Commit atómico, push con hooks completos y esperar CI verde para el SHA final; dejar PR Ready y
      sin merge.

**Rollback:** revertir el agrupamiento de `layout-gutters.spec.ts`, su aserción de cobertura del
manifiesto y esta subsección; no quitar las rutas ni las anchuras de la matriz.

**Evidencia local (2026-10-09):** la regresión preexistente está reproducida por CI `37989343357`:
111 tests del shard 2 pasan antes de que la matriz monolítica alcance el timeout de 300 s (`/settings`; en
el retry, `/logs`), con `Protocol error ... session closed` como consecuencia del cierre por timeout.
La aserción de manifiesto confirma que los dos grupos contienen las 25 rutas privadas, en el orden del
manifiesto, sin omisiones. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium
--project=mobile-chrome --forbid-only tests/e2e/layout-gutters.spec.ts --reporter=line`, con
`E2E_RATE_LIMIT=on`, DB/puertos/semilla aislados y cleanup, pasó **14/14** en **2.8 min**: 5 rutas
públicas, onboarding, 25 rutas privadas y 8 detalles poblados recorren todos los viewports del
manifiesto en ambos proyectos. Se generaron 68 capturas sintéticas ignoradas por Git; se inspeccionó el
par PC/móvil de Dashboard y Configuración. `pnpm run test:client:coverage` pasó **1287/1287** con
92.23/83.57/90.98/93.64 % S/B/F/L. También pasan build productivo (warnings preexistentes de tamaño y
imports Angular), `pnpm run typecheck:e2e`, `pnpm run check:ui` (212 archivos/21 reglas), Prettier y
`git diff --check`. No se cambió producción en esta unidad; coverage focal para el código E2E: N/A.
El run remoto fallido pertenece al SHA anterior; los cambios están incluidos en `6f8f5ba`, que forma
parte del HEAD actual. CI `38003391607` pasó todos los jobs en `30aa041`; PR #41 sigue abierto y
Ready for review, sin merge. El cleanup, ancho de matriz, rutas y viewports del código no se redujeron.

### QA-LAYOUT.VISUAL-CONSISTENCY.1 · geometría uniforme en toda la interfaz

**Fuente inicial de esta unidad (2026-10-03):** `AGENTS.md` ya exige uniformidad geométrica de componentes
equivalentes y comparación calculada con tolerancia de 1 CSS px; faltaba instrumentarlo en rutas/familias. La
matriz global de `APP-QA-SPEC.md` valida responsive y gutters, pero no comparaba componentes interiores entre
vistas. El baseline original de `/calendar` sí reprodujo la diferencia: `.cal-btn` medía 48 px frente a
30 px de `.cal-pill`, con padding y tipografía también distintos. La subunidad CALENDAR de abajo corrigió
esa barra y dejó la prioridad de «Planificar IA» solo en color. `layout-gutters.spec.ts` aún compara el marco
y la raíz, no botones, campos, tarjetas ni el ritmo de espaciado interior.

**Contrato esperado:** los controles/componentes equivalentes usan el mismo contrato geométrico y tokens
en todas las vistas: dimensiones por familia, tipografía, alineación, padding, gaps, márgenes, radios y
bordes. La prioridad visual cambia mediante color, icono o estado, no aumentando dimensiones. Anchos
ligados al texto solo se permiten cuando el contrato de la familia los define así; controles pares de una
misma barra/grupo comparten tamaño. Variantes compactas, icon-only y touch-target pueden diferir solo por
función o accesibilidad, deben ser explícitas y no pueden servir para destacar importancia. Se documentan
excepciones deliberadas antes de implantarlas; no hay excepciones visuales implícitas por página.

- [x] Recorrer el manifiesto vigente de rutas, shells y vistas pobladas con fixtures sintéticos; inventariar
      familias equivalentes de botones/acciones, tabs/segmentos, campos, tarjetas, modales, navegación,
      encabezados, gutters y espaciado interior. Registrar rutas/estados no cubiertos y el baseline calculado.
- [x] Medir «Planificar IA» y sus acciones pares dentro de `/calendar` con una regresión E2E: rectángulos,
      padding, font/line-height, gap, margen y radio calculados, tolerancia ≤1 CSS px; un cambio de
      color/estado no altera caja. Se cubren 7 viewports (320, 393, 568×320, 767, 768, 1024 y 1440 px).
- [ ] Extender la comparación de familias equivalentes a través de todas las rutas pertinentes; registrar
      rectángulos, padding, font/line-height, gap, margen y radio con tolerancia ≤1 CSS px y documentar
      excepciones funcionales explícitas.
- [x] Subcaso loading/disabled de la CTA «Planificar IA»: el E2E reprodujo primero un salto de ancho
      119→150 px y verifica ahora que ancho/alto y estilos calculados se mantienen con tolerancia ≤1 px,
      nombre accesible, `aria-busy` y spinner superpuesto en Chromium y Pixel 5. La matriz completa de
      familias y rutas de la casilla anterior sigue abierta.
- [ ] Extender la comprobación a loading/disabled/focus/validación y overlays relevantes; verificar que no
      haya overrides locales contradictorios y que los mismos tokens produzcan las mismas medidas.
- [ ] Normalizar las familias en tokens/primitivas compartidas; eliminar el tamaño diferencial de CTA por
      jerarquía y usar color/icono/estado para el énfasis. Mantener diferencias solo para familias
      funcionales explícitas (p. ej., icon-only o touch target) y dejar su contrato en el sistema de diseño.
- [ ] Auditar todas las vistas privadas y públicas, además de los shells y detalles poblados; revisar
      márgenes, padding, alineación, controles, tipografía, radios, bordes y separación de secciones, no solo
      el ancho del contenedor. Corregir discrepancias en unidades revisables y revalidar rutas fuente.
- [ ] Ejecutar Playwright real aislado en escritorio Chromium y Pixel 5: ancho mínimo, móviles comunes,
      orientación vertical/horizontal, cada breakpoint B−1/B/B+1, tablet y escritorio ancho; cubrir scroll,
      safe-area, teclado, foco, modales/drawers y ausencia de overflow. Usar iOS/WebKit si está disponible;
      si no, dejar explícita la limitación.
- [ ] Guardar e inspeccionar capturas sintéticas comparables PC/móvil por grupo corregido y actualizar la
      matriz con comandos, resultados, errores existentes, gates de formato/build y cobertura ≥70 % S/B/F/L
      del alcance. No bajar gates superiores ni declarar la web pixel-perfect si queda una familia pendiente.

**Inventario inicial (2026-10-08):** `layout-gutters.spec.ts` adjunta mediciones calculadas y sin texto/
valores de 31 rutas de manifiesto (públicas, onboarding y privadas en estado inicial) y 8 detalles dinámicos
poblados con fixtures sintéticos, a 393×851 y 1440×900, tanto en Chromium como en Pixel 5. La matriz pasó
**6/6** con SQLite/puertos temporales. En las rutas iniciales se midieron 1097 acciones, 32 tabs, 48 campos,
50 tarjetas, 190 elementos de navegación, 164 encabezados y 86 secciones; los detalles poblados añadieron
218 acciones, 6 tabs, 34 campos, 4 tarjetas, 72 elementos de navegación, 28 encabezados y 24 secciones.
Los perfiles se agrupan por viewport y firma geométrica (dimensiones, padding/márgenes, gap, tipografía,
radios, bordes y alineación); son baseline para comparar, no una declaración de equivalencia aprobada.
No se encontró ningún diálogo visible en esas vistas (`dialogs: 0`): los overlays cerrados, loading,
disabled, focus, validación y listas pobladas quedan fuera. Los detalles sí están poblados; las rutas de
colecciones permanecen en su estado inicial. Gutter/espaciado del marco se conserva cubierto por la matriz
existente. `pnpm run typecheck:e2e`, Prettier focal y `git diff --check` pasan; coverage de producción:
N/A (solo instrumentación E2E, sin código de producción). La matriz completa sigue abierta.

**Revalidación del subcaso loading de la CTA (2026-10-09):** la prueba aislada bloquea una respuesta
sintética del endpoint de planificación, mide ready/loading y comprueba que el estado deshabilitado no
altera ancho, alto, padding, margen, gap, tipografía, borde ni radio; también verifica `aria-busy`, el
nombre accesible y que el spinner queda centrado. Antes del fix el nombre/spinner sustituidos ensanchaban
la CTA de 119 a 150 px. Mantener la etiqueta normal oculta en layout y posicionar el spinner sobre ella
restaura el ancho intrínseco sin `min-width` rígido. `node scripts/run-isolated-playwright.mjs
--workers=1 --project=chromium --project=mobile-chrome tests/e2e/ui-geometry-consistency.spec.ts
--reporter=dot` pasó **6/6**; el subcaso pasó **2/2** y guardó capturas sintéticas comparables en
`.e2e-screenshots/qa-layout-ai-loading/`: `plan-cta-ready-desktop.png`, `plan-cta-loading-desktop.png`,
`plan-cta-ready-mobile.png` y `plan-cta-loading-mobile.png`. También pasaron Karma **1242/1242**,
`pnpm run typecheck:e2e`, `pnpm run check:ui` (**211 ficheros, 21 reglas**) y `pnpm run build`; el
build conserva avisos previos de imports/optional chaining y budgets. La cobertura global Karma es
91.50/82.44/90.03/92.94 % S/B/F/L, pero `CalendarComponent` queda en 20.14/1.77/5.13/0 % por
archivo: no satisface el gate ≥70 % por archivo de la spec. Quedan abiertos focus/validación/overlays,
las demás familias/rutas y esa limitación de coverage; este subcaso no cierra la unidad global.

**Revalidación de geometría intraruta (2026-10-10):** fuentes actuales confirmadas en
`tests/e2e/ui-geometry-consistency.spec.ts` y la barra de `CalendarComponent`; la suite aislada
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/ui-geometry-consistency.spec.ts --reporter=line` pasó **6/6** con SQLite, puertos y semilla
temporales. La prueba mide acciones pares de la cabecera en los 7 viewports, compara estilos calculados
con la CTA y limita la diferencia de dimensiones a 1 CSS px. La comparación entre rutas sigue abierta;
esta revalidación no cierra la unidad global. Coverage de producción: N/A, sin cambio de código productivo.

**Rollback:** revertir solo los tokens/primitivas y ajustes geométricos de esta unidad, sus pruebas/capturas
ignoradas y este subapartado; preservar el marco/gutters compartidos y las correcciones ajenas.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.CALENDAR.1 · barra y rejilla de `/calendar`

**Fuente revalidada (2026-10-03):** la barra combina `.cal-btn`, `.cal-pill`, `.cal-segment__btn`,
botones de icono y selector de fecha; antes declaraban alto/padding/tipografía distintos. En móvil, los
siete tracks de la rejilla reducían weekday/número/acción a menos de su contenido; elevar el mínimo de
columna por sí solo ensanchaba `.cal-body` fuera del panel en vez de crear un scroll local.

- [x] E2E primero en rojo: medir controles equivalentes de la barra en 7 tamaños (320, 393, 568×320,
      767, 768, 1024 y 1440 px), verificar estilo calculado y límites de los encabezados de día; baseline
      falla con 48 px vs 30 px, padding 6/14 vs 5/11 px y texto 14 vs 12 px, y encabezados móviles fuera
      de su columna.
- [x] Normalizar altura (48 px), padding/tipografía/radio/gap de controles de texto y targets de icono;
      el énfasis de «Planificar IA» queda solo en color. Mantener la anchura natural del texto y dar a cada
      columna móvil un mínimo táctil de 48 px, con scroll horizontal contenido y nombres apilados.
- [x] Limitar el elemento grid padre para que el overflow quede dentro del visor; probar 320 px, recorrer
      por Tab hasta el último día y comprobar desplazamiento/foco sin expandir el documento.
- [x] Hacer coherente la señal del cursor con la acción: antes la zona delegada calculaba `auto` y la
      columna `copy`, pese a que abrir un evento no copia nada; ahora el área/columna clicable calcula
      `pointer` y el gutter conserva cursor normal. E2E verifica los tres estilos.
- [x] Verificar Playwright real aislado con rate limit activo, SQLite/semilla/puertos temporales:
      `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/ui-geometry-consistency.spec.ts --reporter=dot`
      pasó **2/2**; recorre siete viewports, compara rectángulos y estilos y guarda capturas de escritorio/móvil.
      `calendar-mobile-header-layout.spec.ts` pasó **2/2** (modal, teclado, foco y scroll).
- [x] Añadir prueba unitaria para semana vacía/7 días; Karma ejecuta **2/2**. Las líneas de los dos métodos
      geométricos cambiados quedan cubiertas; el gate global en la corrida focal no pasa (21,42/0/2,94/25,04
      % S/B/F/L por excluir el resto de la suite), sin modificar el umbral 80 %.
- [x] `pnpm run typecheck:e2e`, `pnpm run check:ui` (**188 ficheros, 20 reglas**), `git diff --check` y
      Prettier de las dos pruebas nuevas pasan. El archivo de producción `calendar-timeline.component.ts`
      ya falla Prettier en `HEAD` y se conserva sin reformat masivo. Build de producción pasa; mantiene
      avisos existentes de bundle inicial (**715,17 kB frente a 500 kB**), estilos calendar/pantry y
      imports/expresiones Angular sin uso. No se rebajaron gates.

Capturas sintéticas inspeccionadas: `.e2e-screenshots/calendar-geometry-final/ui-geometry-desktop.png` y
`ui-geometry-mobile.png`. La matriz global sigue abierta: estos resultados solo cierran el primer grupo
visual de `/calendar`; aún faltan familias/rutas públicas y privadas.

**Revalidación por CI (2026-10-08):** la cabecera tenía una regresión en el reflujo del grupo derecho a
768 px; ahora este pasa a línea propia hasta 920 px. El selector de vista es un control de selección
distinto de los siete botones de acción y se mide por separado. La tanda `node scripts/run-isolated-playwright.mjs
--workers=1 --project=chromium --project=mobile-chrome tests/e2e/auth-onboarding-icons.spec.ts
tests/e2e/calendar-all-day-gutter.spec.ts tests/e2e/calendar-mobile-header-layout.spec.ts
tests/e2e/calendar-number-locale.spec.ts tests/e2e/ui-geometry-consistency.spec.ts
tests/e2e/ui-text-field-geometry.spec.ts tests/e2e/shopping-primary-geometry.spec.ts --reporter=dot`
pasó **20/20**; `pnpm run typecheck:e2e`, `pnpm run check:ui` (207 ficheros/21 reglas) y
`git diff --check` también pasan. La matriz visual global continúa abierta.

**Rollback focal:** revertir solo los estilos de barra, mínimo de columnas/scroll local, las dos pruebas de
geometría y este subapartado; no revertir `AGENTS.md` ni la matriz global.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.SHARED-ACTIONS.1 · botones de texto compartidos entre rutas

**Fuente revalidada (2026-10-10):** `ButtonComponent` (`button.component.ts`) define la misma geometría
para `sm`/`md`/`lg` mediante tokens; sus variantes cambian color, no tamaño. `check-ui` protege el
contrato de origen, y `layout-gutters.spec.ts` ya mide botones visibles por ruta, pero el reporte agrupa
perfiles y no falla si un botón `.btn` computa geometría distinta en otra vista. La regresión de
`/calendar` cubre `.cal-btn`, no esta primitiva compartida.

**Contrato:** botones textuales `app-button` comparables comparten altura (≥44 CSS px), padding, gap,
tipografía/line-height, márgenes, alineación, radio y bordes con tolerancia ≤1 CSS px entre rutas y
viewports comunes. Se excluyen anchuras naturales por texto, color/sombra de variantes, icon-only y
controles custom de otras familias; no se fuerzan excepciones locales sin contrato funcional.

- [x] Añadir primero prueba del comparador con fixtures geométricos: detecta diferencias >1 px,
      permitir ancho natural/texto y color distintos, y separar botones icon-only/touch-target.
- [x] Ejecutar E2E aislado en rutas representativas que usan la primitiva (`/account`, `/ai-config`,
      `/pantry`, `/preferences`, `/recipes`, `/shopping`), Chromium y Pixel 5, 393×851 y 1440×900;
      registrar solo geometría computada, comprobar botones con etiqueta textual y comparar las
      variantes presentes; no se invocaron proveedores.
- [x] El baseline no detectó drift (>1 CSS px); no se tocó código de producción ni hubo ficheros
      aplicables a la cobertura S/B/F/L. Se conserva únicamente prueba/inventario, sin alterar gates.
- [x] Capturar e inspeccionar PC/móvil con fixtures sintéticos, ejecutar typecheck, check-ui, formato y
      Playwright aislado, documentar rollback y dejar intacta la comparación global de las demás familias.

**Evidencia (2026-10-10):** `pnpm run typecheck:e2e`, `pnpm run check:ui` (212 ficheros/21 reglas),
Prettier y E2E aislado con Chromium y Pixel 5: **6/6 tests**, entre la regresión existente
`ui-shared-button-geometry.spec.ts` y la nueva `ui-shared-button-routes-geometry.spec.ts`. Se conserva
la cobertura previa de tamaños `sm/md/lg`, botones de diálogo y siete anchuras; el runner usó SQLite temporal bajo
`%TEMP%\hogaria-e2e-*`, luego limpiada. 20 muestras por proyecto cubren las seis rutas y ambos
viewports; se compararon las variantes `primary`, `secondary` y `outline`, y se mantuvieron separados
los perfiles de botones touch-target. No hubo drift, errores de página, conexión de IA ni tráfico
externo: Google Fonts se sirvió como CSS vacío local y los demás destinos externos se bloquearon. Los
reportes sin texto ni valores y las capturas inspeccionadas quedan en el artefacto Git-ignorado
`.e2e-screenshots/qa-layout-shared-buttons-20261010/` (`chromium-geometry.json`,
`mobile-chrome-geometry.json`, capturas `*-1440-shared-button.png` y `*-393-shared-button.png`).
Las fuentes remotas se sustituyeron durante esta validación; la inspección visual usa el fallback local.

**Rollback focal:** revertir el commit de esta subunidad para retirar su E2E, inventario temporal y
registro; no requiere cambio ni reversión de estilos de producción.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.ROOT-DISPLAY.1 · preservar el layout de las raíces

**Fuente revalidada (2026-10-08):** `route-layout-manifest.ts` declara 24 selectores `pageRoot` distintos
y un `contentRoot` adicional de autenticación. Las raíces con layout intencional explícito son `.cad`,
`.calendar`, `.ficha` de tickets y `.tickets` (`grid`), y las restantes familias con `display: flex`
son cuenta, autenticación, invitación, logs, onboarding, gestores de despensa, ficha/edición de artículo,
preferencias, ajustes y listas/detalle de compra. Las demás raíces son `block` por regla local o estilo
predeterminado. La matriz medía cajas y solo contrastaba tres displays; se hará un contrato único y
exhaustivo sobre todas las raíces estáticas y dinámicas, incluidos ambos niveles de autenticación.

- [x] Extender primero la E2E real para contrastar el `display` calculado de esas tres raíces en todos
      los viewports del manifiesto; antes del cambio falla en Chromium mostrando `block` en vez de
      `grid/flex` a través de todos los anchos (TDD rojo).
- [x] Quitar solo el override global de `display`; conservar `width`, `max-width`, `min-width` y los
      márgenes del contenedor común para no modificar gutters ni límites horizontales.
- [x] Ejecutar la matriz estática en escritorio y Pixel 5, guardar/inspeccionar capturas sintéticas
      de Caducidades, Tickets y Preferencias en ambos tamaños; repetir el manifiesto completo incluidas
      rutas dinámicas antes de cerrar esta subunidad.
- [x] Extender el censo a todas las raíces y familias internas con un contrato exhaustivo sobre
      `pageRoot` y `contentRoot`, incluida cobertura exacta del manifiesto estático y dinámico.

**Evidencia de la subunidad (2026-10-03):** TDD aislado reprodujo `display:block` para las tres raíces en
todos los anchos; tras quitar únicamente esa declaración, la matriz completa estática + dinámica y el
test de calendario pasaron **6/6** con Chrome/Chromium desktop y emulación Pixel 5, 39 rutas y 50
viewports por proyecto, incluida orientación horizontal y B−1/B/B+1. Los roots mantienen caja/gutters,
sin overflow; las raíces elegidas conservan `grid/grid/flex`. Capturas sintéticas guardadas e inspeccionadas
en `.e2e-screenshots/qa-ui-uniformidad-20261003/` (incluye Caducidades, Tickets, Preferencias, receta,
Dashboard y geometría del calendario, PC/móvil). `pnpm run typecheck:e2e`, `pnpm run check:ui` (**188
ficheros, 20 reglas, 0 incidencias**), Prettier focal y `git diff --check` pasan. Build de producción
aislado pasa; conserva avisos previos de bundle inicial (**715,16 kB > 500 kB**), estilos de Calendar y
otros componentes e imports Angular sin uso. Los cambios de producción de esta subunidad son CSS (global
y estilos inline); coverage instrumentable S/B/F/L: N/A. No se modificaron gates ni datos normales.

El checkbox del inventario global sigue abierto deliberadamente: este contrato valida el `display` de
todas las raíces, no la comparación geométrica/visual de todos los componentes interiores; no se declara
«pixel-perfect» ni finalizada la auditoría.

**Censo exhaustivo (2026-10-08):** un contrato central cubre exactamente los 24 selectores `pageRoot`
distintos y el selector `contentRoot` de autenticación; comprueba raíz y contenido calculado en la matriz.
La prueba `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium
tests/e2e/layout-gutters.spec.ts --grep "contrato de display" --reporter=line` pasó 1/1 y la matriz
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/layout-gutters.spec.ts --reporter=line` pasó **6/6** (1,6 min), sin desajustes ni overflow.
El TDD rojo previo mostró los 22 roots faltantes al declarar solo los tres casos históricos.
`pnpm run typecheck:e2e`, `pnpm exec prettier --check tests/e2e/helpers/route-layout-manifest.ts
tests/e2e/layout-gutters.spec.ts APP-QA-SPEC.md` y `git diff --check` pasan. No hubo cambios de CSS;
coverage S/B/F/L N/A (contrato E2E, sin código instrumentable de producción).

**Rollback focal:** restaurar la declaración global `display: block` solo si se revierte toda la unidad
de raíces; quitar `ROOT_DISPLAY_EXPECTATIONS`, sus aserciones E2E y el test de cobertura del manifiesto,
además de este subapartado. Conservar el resto de la normalización de ancho/gutters.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.PAGE-SPACING.1 · separación vertical común

**Fuente revalidada (2026-10-03):** el marco privado ya define `--container-padding` compartido (16 px
por debajo de 768 px, 24 px desde 768 px y 32 px desde 1024 px), pero cada vista fija su propio padding
vertical: Dashboard usa 16/32 px; Recetas, Despensa y Logs 16/24 px; Calendario 12/32 px en móvil y
16/40 px en escritorio; Compra y Tickets 16 px en ambos. El contrato elegido es que el padding vertical
de cada raíz privada use ese mismo `--container-padding`: así bloque e inline mantienen exactamente el
mismo gutter del main content en cada breakpoint, sin inventar otro token. Los shells públicos, diálogos
y espaciados dentro de tarjetas pertenecen a familias aparte y no se deben forzar dentro de esta unidad.

- [x] Añadir primero E2E Playwright que compare `padding-block-start/end` calculado con `--container-padding`
      de las raíces de Dashboard, Recetas, Despensa, Calendario, Compra, Tickets y Logs en 320, 393,
      568×320, 767, 768, 769, 1023, 1024, 1025 y 1440 px; el baseline falla antes de ajustar estilos en ambos proyectos.
- [x] Hacer que esas raíces usen el token horizontal `--container-padding` en bloque, sin alterar padding
      interior de paneles, formularios, tarjetas ni safe-area; registrar en spec cualquier excepción
      funcional detectada antes de conservarla.
- [x] Repetir la comparación Playwright en Chromium escritorio y Pixel 5, cubrir breakpoints B−1/B/B+1,
      scroll y ausencia de overflow horizontal; guardar e inspeccionar capturas sintéticas PC/móvil y ejecutar
      gates focales. Esta unidad no modifica controles ni modales; los shells públicos y el censo completo
      de familias siguen abiertos en la unidad padre.

**Evidencia (2026-10-03):** TDD aislado primero falló en Chromium y Pixel 5 con **28 diferencias** entre
padding vertical de raíz e inline del main content en los 56 pares ruta×viewport iniciales. Tras usar el
token común, `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/page-spacing-consistency.spec.ts --reporter=dot` pasó **2/2**; la matriz final recorre 7 rutas ×
10 viewports (320, 393, 568×320, 767, 768, 769, 1023, 1024, 1025 y 1440 px) por proyecto y valida padding
en ambos ejes más overflow horizontal. `pnpm run typecheck:e2e`, `pnpm run check:ui` (**188 ficheros, 20
reglas, 0 incidencias**), Prettier de la nueva E2E, `git diff --check` y build Angular de producción pasan.
El build mantiene warnings existentes de bundle (715,16 kB > 500 kB), estilos de componentes e imports
Angular sin uso; no se rebajaron gates. Capturas sintéticas PC/móvil inspeccionadas en
`.e2e-screenshots/qa-page-spacing-20261003/` para las siete rutas. Producción modificada solo en padding CSS;
coverage instrumentable S/B/F/L: N/A. DB, semillas, servidor y artefactos E2E fueron temporales/aislados.

**Rollback focal:** revertir solo el token/uso del padding vertical común, la regresión E2E y este
subapartado; preservar gutters horizontales y los paddings internos de cada componente.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.ALL-PRIVATE-ROOTS.1 · padding de todas las vistas privadas

**Fuente revalidada (2026-10-03):** `tests/e2e/helpers/route-layout-manifest.ts` declara las raíces
privadas y ocho rutas dinámicas que deben renderizar fixtures reales. La matriz `page-spacing-consistency.spec.ts`
solo cubre siete raíces; omite Ajustes, Cuenta, Preferencias, Hogar, Configuración IA, cola IA y vistas de
detalle. El CSS actual presenta diferencias comprobables: Ajustes cambia de 16 a 32 px; Cuenta y Preferencias
usan 16 px fijos; Hogar y Configuración IA usan 16/24 px; detalles y gestores de Despensa añaden padding
inferior desigual. Ese último espacio se medirá aparte y solo se conserva si evita que una acción fija o el
safe-area tape contenido; no se asume que sea una excepción válida por existir hoy.

- [x] Añadir primero E2E sobre cada raíz privada distinta del manifiesto, incluidos detalles con fixtures
      sintéticos; medir `padding-block-start/end` frente al `--container-padding` calculado del marco en los
      diez viewports de la subunidad anterior. La línea base aislada falla primero: **507 discrepancias** en
      rutas estáticas y **277** en ocho detalles poblados, Chromium escritorio, 39 rutas y 10 tamaños por
      ruta (50 viewports en la matriz; los detalles solo en los tamaños habilitados para ellos). El primer
      intento sin `E2E_CHROME_BIN` no llegó al test body porque falta el Chromium descargado por Playwright;
      se repitió con Chrome instalado, manteniendo el runner, DB y puertos aislados.
- [x] Normalizar las raíces privadas omitidas con `padding-block: var(--container-padding)`: Ajustes,
      Cuenta, Preferencias, Hogar, Configuración IA, cola IA, Caducidades, ticket, artículo de despensa,
      edición, gestores de catálogo/categorías/productos y detalle de compra. Se conservaron paddings
      internos; el espacio extra de gestores ya se reserva dentro de la tabla (`.lote__empuje`) y la barra
      del detalle de compra permanece en flujo sticky, así que no hay excepción de padding de raíz.
- [x] Repetir Playwright aislado en Chromium escritorio y Pixel 5: **4/4** pruebas de rutas estáticas y
      ocho detalles sintéticos, 39 rutas y 10 viewports por ruta/proyecto (incluye orientación horizontal y
      B−1/B/B+1); todas las raíces privadas comparten padding en bloque con el gutter inline, llegan al final
      por scroll por encima de la navegación fija y no desbordan. Se guardaron **68 capturas PC/móvil** en
      `.e2e-screenshots/qa-private-root-padding-20261003/` y se inspeccionaron visualmente las vistas
      modificadas. Regresión de acciones Despensa/Compra: **65 pasaron, 1 omitida**. `typecheck:e2e`,
      `check:ui` (188 ficheros, 20 reglas), Prettier de la prueba, `git diff --check` y build de producción
      pasan. El build mantiene avisos existentes (bundle inicial 715,16 kB frente al límite 500 kB, estilos
      grandes/imports Angular no usados); no se bajaron gates. El `--check` global de fuentes detecta que
      `caducidades.component.ts` ya incumple Prettier en `HEAD`; se preservó ese formato histórico y solo
      cambió una declaración CSS. Cobertura de código no aplica a este cambio de estilos; DB, servidor y
      semillas fueron temporales/aislados.

**Rollback focal:** revertir solo las reglas de padding de las raíces privadas adicionales, la extensión de
la regresión E2E y este subapartado; conservar la unidad de gutters y `PAGE-SPACING.1` ya verificada.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.SHARED-BUTTONS.1 · tamaños del botón compartido

**Fuente revalidada (2026-10-03):** `app-button` se usa en vistas públicas y privadas, y expone `sm`, `md`
y `lg`. En `button.component.ts`, esas clases cambian actualmente padding, tamaño tipográfico y, en `sm/lg`,
radio; además los estilos hover de primary/secondary trasladan el botón 1 px. Las llamadas existentes
distribuyen tamaños por pantalla/acción (p. ej. login/registro `lg`, acciones de lista `sm`, acciones generales
`md`), así que la importancia se está expresando parcialmente mediante geometría. El contrato global vigente
de la unidad padre exige que el énfasis cambie por color/icono/estado; se conserva ancho fluido o `fullWidth`
por su función de contenido/layout y se excluyen solo controles realmente de familia icon-only.

- [x] Añadir primero regresión roja para comparar la geometría renderizada de `sm/md/lg` (caja,
      padding, tipografía, radio y borde) y comprobar que hover no desplace ni redimensione el control.
      Evidencia: el baseline aislado falló en Chromium y Pixel 5: alturas de 26/34/42 px según variante y
      hover primary con traslación vertical de −1 px.
- [x] Normalizar el botón de texto compartido para que sus tamaños nominales tengan un contrato geométrico
      idéntico en todas las variantes de color; la jerarquía se expresa visualmente y ningún CTA crece por ser
      principal. `sm/md/lg` conservan compatibilidad de plantilla, pero comparten `min-height:44px`, padding
      `var(--space-2) var(--space-4)`, `var(--text-sm)` y `var(--radius-lg)`; ancho fluido/`fullWidth` e
      icon-only mantienen sus contratos funcionales.
- [x] Medir consumidores reales con fixture sintético en login, recetas, logs y diálogo de configuración IA.
      Playwright comprobó la misma geometría en siete viewports (320×568, 393×851, 568×320, 767×1024,
      768×1024, 1024×768 y 1440×900), y en diálogo a 393×851/1440×900; se guardaron e inspeccionaron
      capturas escritorio 1440×900 y Pixel 5 393×851. La captura de logs se limita a la barra de controles.
- [x] Ejecutar regresiones unitarias (15/15), Playwright aislado real (2/2: Chromium y Pixel 5),
      `pnpm run typecheck:e2e`, Prettier, `pnpm run check:ui` (188 ficheros/20 reglas), build de producción
      frontend, build del servidor y `git diff --check`. `check:ui` no reportó incidencias. El runner de
      desarrollo aislado no superó readiness en dos intentos; se cambió al runner aislado full-stack con DB
      temporal y cleanup propio, que sí pasó. Limitación: disabled/loading no forman parte de esta subunidad;
      el inventario visual global de rutas y familias sigue abierto.

**Rollback focal:** restaurar únicamente las reglas de tamaño/estados de `app-button`, retirar las aserciones
geométricas correspondientes y este subapartado; mantener abiertas las demás familias de la matriz global.

**Revalidación por CI (2026-10-08):** el token compartido `--button-control-padding-inline` había
derivado de `--space-4` a `--space-3`; se restauró el contrato existente y el gate estático ahora detecta
esa regresión. `node --test scripts/check-ui-button-geometry.test.mjs` pasa **6/6**; `pnpm run check:ui`
reporta **207 ficheros, 21 reglas, 0 incidencias**. Los E2E de Compra verifican además caja/foco del CTA
sin imponer un ancho de outline dependiente del navegador. No cambia el contrato de ancho ni la familia
icon-only; el censo visual global sigue abierto.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.BUTTON-STATES.1 · loading, disabled y foco sin salto

**Fuente revalidada (2026-10-09):** `ButtonComponent` iguala la geometría nominal `sm/md/lg` y usa
`disabled`/`focus-visible` como estados de apariencia, pero `loading` inserta un spinner en el flujo
`inline-flex` antes del contenido. La prueba roja focal aumenta el ancho **22 px** en Karma y en Chromium/
Pixel 5, y no existe `aria-busy`. La E2E contra el hogar con `PATCH` sintético retenido reprodujo otro
defecto de consumidor: tras 503, `savingName=false` dispara el efecto que reemplaza el borrador no guardado
por el nombre confirmado, deja «Guardar nombre» disabled e impide reintentar; la prueba unitaria falló
**25/26** (`Casa sintética` en lugar de `Nombre actualizado`).

**Contrato:** activar `loading`, `disabled` o foco visible no desplaza ni redimensiona la caja del botón
(tolerancia ≤1 CSS px); el spinner no sustituye su nombre accesible, la acción ocupada expone `aria-busy`
y `loading` mantiene la acción inhabilitada. Si falla el guardado del nombre del hogar, se conserva el
borrador para corregirlo/reintentarlo; solo un hogar persistido o un cambio de hogar confirmado reemplaza
el valor editado. Colores, opacidad y contorno de foco pueden cambiar sin variar caja, padding, tipografía,
gap o radio.

- [x] Añadir primero prueba roja de componente y Playwright real aislado que contrasten rectángulo y estilos
      calculados antes/durante/después de `loading`, `disabled` y `focus-visible`; medir un consumidor real
      mientras una respuesta de servidor sintético queda retenida.
- [x] Corregir el salto con el menor cambio compartido y evitar que un error de guardado descarte el borrador;
      conservar contenido/nombre accesible, indicar estado ocupado y bloquear dobles acciones. No alterar la
      geometría base normalizada de `sm/md/lg`, las variantes cromáticas, `fullWidth` ni botones de solo icono.
- [x] Verificar respuesta exitosa y fallida del request retenido, borrador recuperable, foco por teclado y
      ausencia de una segunda petición; ejecutar Chromium escritorio y Pixel 5 emulado con DB/puertos/semillas
      aisladas y cleanup.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil del estado normal y ocupado; ejecutar prueba focal,
      suite frontend/gate de cobertura, typecheck, `check:ui`, Prettier, build y `git diff --check`.
      Documentar resultados y rollback sin cerrar la matriz visual global.

**Verificación (2026-10-09):** las regresiones primero fallaron con el spinner ensanchando 22 px y el
guardado de hogar perdiendo el borrador tras 503; después la suite focal del botón/hogar pasó **44/44**.
`E2E_RATE_LIMIT=on node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium
--project=mobile-chrome tests/e2e/household.spec.ts --grep 'el botón de guardar conserva geometría'
--reporter=line` pasó **2/2**. La E2E comprobó foco de teclado, nombre accesible, `aria-busy`, spinner
centrado, caja/estilos con diferencia ≤1 px, acción deshabilitada sin segundo PATCH, recuperación del
borrador tras 503, retry HTTP 200 y persistencia tras recargar. Usó DB/servidor/semilla aislados; el runner
detuvo su proceso propio y limpió artifacts.

Capturas sintéticas normales/cargando, guardadas e inspeccionadas en
`.e2e-screenshots/qa-button-state-geometry-20261009-0736/` (`chromium` y `mobile-chrome`; ignoradas por
Git). `pnpm test` pasó con cobertura global **91.11/82.13/89.69/92.56 %** (statements/branches/functions/
lines); en archivos afectados: `button.component.ts` **100/100/100/100 %** y `household.component.ts`
**88.04/95.65/74.29/87.21 %**. Pasaron `check:ui` (**211 ficheros, 21 reglas**), typecheck E2E,
Prettier, build y `git diff --check`; el build conserva sus warnings existentes de dependencias Angular y
presupuesto, sin errores. No se cerró la matriz visual global.

**Rollback:** revertir la gestión visual/accesible del estado loading de `ButtonComponent`, la sincronización
de borrador de `HouseholdComponent`, sus regresiones unitarias/E2E y este subapartado; conservar los
contratos previos de tamaño y demás consumidores.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.SHOPPING-PRIMARY.1 · CTA primario de Compra

**Fuente revalidada antes del cambio (2026-10-03):** `shopping-lists.component.ts` declaraba `.tray__primary` con alto mínimo
de 40 px y padding vertical `--space-2`; `shopping-list-detail.component.ts` declaraba `.detail__primary` y
`.detail__add-btn` con alto mínimo de 48 px y padding vertical `--space-3`. Eran acciones primarias de texto
rellenas del mismo flujo Compra, no controles compactos ni icon-only. El `app-button` vigente ya fija para
todo botón de texto 44 px, padding `--space-2 var(--space-4)`, `--text-sm`, `--font-sans`, peso medio,
`--leading-none` y `--radius-lg`; ese es el contrato geométrico común que deben reutilizar, con el énfasis
expresado por color y sin imponer igual anchura a etiquetas de longitudes distintas.

- [x] Añadir primero E2E aislada que cree usuario/lista/artículo sintéticos y compare el botón de crear lista
      en `/shopping` con añadir/finalizar en `/shopping/:id`; medir caja, padding, fuente, interlineado, borde,
      radio, margen y transform con tolerancia de 1 CSS px. El baseline debe reproducir 40 px frente a 48 px.
- [x] Alinear los primarios textuales de las dos vistas al contrato `app-button` sin cambiar sus acciones,
      semántica, color de énfasis ni reglas de anchura; disabled/loading/focus no debe mover ni redimensionar.
- [x] Repetir Playwright real aislado en Chromium y Pixel 5 a 320×568, 393×851, 719/720/721 px y 1440×900;
      cubrir teclado/foco, estado deshabilitado, ausencia de overflow y persistencia de la lista sintética.
- [x] Guardar e inspeccionar capturas sintéticas comparables PC/móvil. Ejecutar typecheck E2E, `check:ui`,
      formato, build Angular y `git diff --check`; esta unidad reutiliza el componente compartido y no cambia
      lógica de negocio (coverage S/B/F/L del consumidor: N/A). Evidencia: baseline 40/48 px reproducido;
      `ButtonComponent` unitario 15/15 (100 % statements/branches/functions/lines); Playwright geométrico
      aislado 2/2 (Chromium y Pixel 5), seis anchos, foco/teclado, disabled/loading, persistencia y sin overflow;
      capturas inspeccionadas en `.e2e-screenshots/qa-shopping-primary-20261003/`. `typecheck:e2e`, Prettier,
      acciones de lista 4/4 y full-stack de importes 6/6, `check:ui` (188 ficheros/20 reglas), build de
      producción frontend y `git diff --check` pasan. Build deja advertencias previas de presupuesto global
      (714.99/500 KB) y otros estilos no pertenecientes a esta unidad. Mantener abierto el censo global.

**Rollback focal:** revertir únicamente la migración de los CTA primarios de Compra a `app-button`, esta
regresión E2E y este subapartado; no revertir la unidad `app-button` ni otros cambios de Compra.

**Revalidación por CI (2026-10-08):** Chromium y Pixel 5 vuelven a medir las acciones de lista/detalle y
el foco visible; las capturas sintéticas de Compra a 1440×900 y 393×851 se inspeccionaron. El test no fija
el grosor exacto del outline (el navegador calcula 3 px), pero exige estilo sólido y al menos 2 px; no
reduce los requisitos de caja ni de objetivo táctil.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.SETTINGS-TABS.1 · pestañas de Cuenta y Preferencias

**Fuente revalidada (2026-10-08):** `/account` y `/preferences` implementan pestañas de sección con el mismo
contrato de `.tab`: icono más texto, tipografía, padding, gap, borde activo y transiciones equivalentes.
Sin embargo, Preferencias conserva una sola fila desplazable en móvil (`overflow-x: auto`, elementos sin
reducción), mientras Cuenta cambia a `flex-wrap: wrap` hasta 560 px. La prioridad/selección debe reflejarse
solo en color y borde, no cambiar medidas; ambas listas deben conservar la fila y exponer por scroll las
pestañas que no quepan.

**Contrato:** comparar el estilo calculado de `.tab`, sus cajas y el contenedor de pestañas en Cuenta y
Preferencias, sin exigir que el ancho de etiquetas distintas sea igual. En móvil, tabs de una sola línea,
sin reducción ni salto de fila, scroll horizontal dentro del grupo y último elemento alcanzable por toque,
Tab y Enter; la página no adquiere overflow. Todas las pestañas conservan un objetivo ≥44×44 CSS px en
desktop y móvil. El foco/selección no altera la geometría. Las diferencias de contenido (tres frente a
cinco secciones) se conservan.

- [x] Añadir primero una regresión Playwright real aislada para Account y Preferences; comparar medidas,
      padding, gap, fuente, borde y radio con tolerancia ≤1 CSS px en 320, 393, 568×320, 559/560/561,
      767/768/769, 1023/1024/1025 y 1440 px; exigir targets ≥44×44. El baseline debe fallar por wrap de
      Cuenta ≤560 px y por altura táctil de 43 px.
- [x] Normalizar el grupo móvil de Cuenta al contrato desplazable/no encogible de Preferencias y fijar
      mínimo 44 px a los controles equivalentes en ambas rutas; no alterar rutas/query, contenido ni color.
- [x] Repetir en Chromium escritorio y Pixel 5; probar selección normal/foco, scroll hasta la última tab
      con toque y teclado, estados activos sin cambio de caja y ausencia de overflow global.
- [x] Guardar e inspeccionar capturas sintéticas comparables PC/móvil de ambas rutas. Ejecutar typecheck,
      `check:ui`, Prettier, build y `git diff --check`; coverage instrumentable S/B/F/L: N/A si el cambio
      queda en CSS estático, documentando la razón. Mantener abierta la auditoría visual global.

**Evidencia (2026-10-08):** TDD aislado en Chromium y Pixel 5 falló antes de los cambios: Cuenta envolvía
sus tabs en dos filas a 320 px; tras normalizar el scroll, la medición E2E detectó 43 px de alto en la
primera tab de Cuenta (debajo del target táctil; Preferencias compartía padding y tipografía). El arreglo
conserva los tabs en una fila desplazable hasta 560 px y fija `min-height: 44px` en Cuenta y Preferencias.
`node scripts/run-isolated-playwright.mjs
--workers=1 --project=chromium --project=mobile-chrome tests/e2e/settings-tabs-geometry.spec.ts
--reporter=line` pasó **2/2**: contrasta propiedades calculadas en los 13 viewports de la lista (incluidos
559/560/561 y B−1/B/B+1), controla selección/foco y targets ≥44×44, alcanza la última pestaña con toque
Pixel 5 y Tab/Enter, sin overflow global ni errores de consola/JS. Se desactivó solo la transición durante
la medición para comparar el estado geométrico asentado. Karma frontend pasó **1201/1201** con
90,32/81,46/88,96/91,75 % S/B/F/L; `typecheck:e2e`, `check:ui` (210 archivos/21 reglas, 0 incidencias),
Prettier focal, build Angular de producción y `git diff --check` pasan. Coverage focal instrumentable:
N/A, cambio solo CSS estático validado con E2E; no se rebajó gate. Capturas sintéticas PC/móvil de ambas
rutas inspeccionadas en `.e2e-screenshots/qa-settings-tabs-final-20261008/` (ignoradas por Git).

**Rollback focal:** restaurar únicamente el comportamiento de wrap/overflow de las pestañas en
`AccountComponent` y `min-height` de las pestañas en `AccountComponent` y `PreferencesComponent`, retirar
su regresión Playwright y este subapartado; preservar las demás vistas de Cuenta y Preferencias.

### QA-CI.ACCOUNT-SCROLLABLE-TABS.1 · alinear E2E heredada al contrato de pestañas desplazables

**Fuente revalidada (2026-10-08, CI `37824419628`):** `QA-LAYOUT.VISUAL-CONSISTENCY.SETTINGS-TABS.1` establece una fila desplazable en móvil y que cada pestaña sea alcanzable; `AccountComponent` ya aplica `overflow-x: auto`, `flex-wrap: nowrap` y conserva cada `.tab` sin encogimiento hasta 560 px. En cambio, `tests/e2e/full-stack/account-responsive.spec.ts` todavía exige que los tres rectángulos de tab estén visibles simultáneamente dentro de 320 px. CI falló en esa aserción aunque la medida anterior del mismo E2E confirmó `documentWidth <= viewportWidth`; la ruta de tabs que corre tras el cambio de contrato deja la tercera tab fuera de la ventana desplazable, no de la página.

**Conducta esperada:** mantener la barra dentro del viewport y sin overflow del documento. Las tabs quepan juntas cuando corresponda; donde excedan el espacio, la barra conserva scroll horizontal interno y cada tab —incluida Información— sigue accesible con toque y teclado/Enter. Al seleccionar una tab, debe permanecer visible dentro del scrollport (puede verse solo una parte si otras tabs siguen ocupando la fila); la subunidad `SETTINGS-TABS.1` ya verifica que se pueda desplazar hasta mostrar completo el último control. No reintroducir el wrap que el contrato más reciente eliminó, ni hacer cambios de producción para satisfacer una expectativa E2E obsoleta.

- [x] Reproducir primero el rojo actual con el E2E full-stack de Cuenta en Chromium y Pixel 5 a 320 px; registrar que falla la aserción de «todas las pestañas dentro» pero pasa la de ancho de documento. Evidencia: CI `37824419628` y reproducción local antes de sustituir esa aserción.
- [x] Actualizar la regresión para medir límites de la barra y scroll interno, y activar cada tab por click y secuencia real de teclado Tab/Enter, comprobando que la activa intersecta el área visible; conservar nombre de 100 caracteres, orientación y breakpoints vigentes.
- [x] Ejecutar el E2E contra build de producción y rate limit activo, con SQLite/puertos/semillas aisladas; guardar/inspeccionar capturas sintéticas en destino único y confirmar cleanup propio.
- [x] Ejecutar typecheck, Prettier, `check:ui`, build y diff-check; sin cambios de producción, coverage instrumentable N/A. CI del SHA `be1e677a49f79c7eebb3fcc59c3d3403be19484d` verde en run `37826841166` (todos los jobs, incluidos full-stack y cuatro shards); no se cierra la auditoría visual global.

**Evidencia local (2026-10-08):** `E2E_RATE_LIMIT=on`, Chrome local y `E2E_SCREENSHOT_DIR=.e2e-screenshots/qa-account-scrollable-tabs-ci-37824419628-attempt3`; `pnpm run test:e2e:full-stack -- --workers=1 --project=chromium --project=mobile-chrome tests/e2e/full-stack/account-responsive.spec.ts --reporter=line` pasó **2/2**. Recorre 320/393/559/560/561/568×320/844×390; no hay overflow global, las tres tabs activan con click y con Tab/Enter, incluida Información, y no aparecen errores JS. El runner confirma cleanup de DB/puertos/proceso aislados. Capturas sintéticas de `/account` escritorio 1440×900 y Pixel 5 320×568 inspeccionadas en `.e2e-screenshots/qa-account-scrollable-tabs-ci-37824419628-attempt3/` (ignorada por Git). `pnpm run typecheck:e2e` y `git diff --check` pasan; cobertura de producción N/A al ser cambio E2E/spec solamente. La aserción deja de exigir que todas las tabs estén visibles juntas y no cambia CSS ni UI.

**Rollback:** revertir únicamente `tests/e2e/full-stack/account-responsive.spec.ts` y esta subunidad; no cambiar `AccountComponent` ni `PreferencesComponent`.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.TEXT-FIELDS.1 · campos de texto de una línea

**Fuente revalidada (2026-10-04):** el marco/gutter y las raíces ya se comparan en `layout-gutters.spec.ts`,
pero aún no hay una E2E que contraste controles interiores equivalentes. El mismo campo estándar tiene
geometrías distintas en tres superficies reales: login usa `app-input` (label a 4 px, control de 16 px/
24 px, radio 12 px); Cuenta usa `.account__field`/`.account__input` (gap 8 px, label semibold, control
14 px y radio 8 px); el diálogo de Evento en Calendario usa `.meal-form__field`/`.cal-input` (gap 8 px,
label 12 px y control 14 px/radio 8 px). La discrepancia es de componentes equivalentes, no de ancho de
columna. Esta pasada se limita a inputs de texto estándar; `date/time`, `select`, `textarea`, archivo,
icon-only y filtros compactos quedan en sus familias funcionales hasta que se especifiquen aparte.

**Contrato:** inputs de texto estándar y sus labels comparten la geometría media del `app-input` vigente:
label 14 px/medium con 4 px hasta el control; control con la misma altura calculada, fuente/interlineado,
padding 8/12 px, borde 1 px y radio 12 px. El control ocupa el ancho de su contenedor; no se fuerza la
misma anchura entre formularios con columnas intencionalmente distintas. Foco/error no cambian las cajas,
padding ni separación label-control; el texto de validación puede ocupar su propia fila y reordenar el
contenido posterior. El E2E prueba errores donde el campo los expone y, en el título del evento, la
validación existente del botón deshabilitado sin inventar un estado de error que el producto no ofrece.
No se añade una variante por ruta.

**Hallazgo de captura (2026-10-04):** el artefacto sintético
`.e2e-screenshots/qa-text-fields-1/mobile-chrome-account-393x851.png` muestra el drawer móvil abierto,
que cubre el formulario aunque `toBeVisible()` siga considerando visible el input. La E2E debe comprobar
el estado cerrado accesible del menú y que el campo queda dentro del viewport antes de guardar la captura;
no debe cerrar el drawer a ciegas y ocultar un estado inicial incorrecto.

- [x] Añadir primero una regresión E2E aislada para Email de login, Nombre de Cuenta y título del diálogo
      Evento; medir label-control, caja, padding, márgenes, fuente, interlineado, borde y radio calculados,
      documentar el baseline rojo y comprobar que un login inválido no hace POST.
- [x] Normalizar la geometría de los tres inputs al contrato compartido sin alterar su semántica, validación,
      focos accesibles ni anchura de formulario; mantener iguales medidas en estados normal/foco/error.
- [x] Verificar Chromium y Pixel 5 a 320×568, 393×851, 568×320, 767/768/769, 1023/1024/1025 y 1440×900;
      revisar teclado, label/nombre, foco, error aplicable, scroll y ausencia de overflow. Comparar propiedades con
      tolerancia ≤1 CSS px; a 393×851 confirmar que el drawer está cerrado, el campo de Cuenta está en viewport
      y las capturas sintéticas PC/móvil muestran los controles comparados.
- [x] Ejecutar Karma completo y verificar ≥70 % S/B/F/L para el código ejecutable modificado; las declaraciones
      estáticas HTML/CSS se validan geométricamente por E2E, sin reducir los gates globales. Ejecutar `typecheck:e2e`,
      Prettier focal, `check:ui`, build de producción y `git diff --check`.

**TDD rojo→verde y evidencia (2026-10-04):** en un checkout temporal de `HEAD`, con solo el harness E2E aislado actual y el arreglo de compilación de `MainLayout` (ajeno a inputs), la misma prueba falló **2/2** (Chromium y Pixel 5): Cuenta medía 35 px/14 px/radio 8 px, etiqueta 600 y gaps 8 px frente a contrato 42 px/16 px/radio 12 px, etiqueta 500 y gap 4 px; el título de Calendario medía 35 px/14 px/radio 8 px, etiqueta 12 px y gaps 8 px. Login ya cumplía el contrato. Con la normalización, la E2E aislada volvió a ejecutarse contra app/API/SQLite propios y pasó **2/2**; comparó controles, labels, gap, padding, márgenes, fuente, interlineado, borde/radio y ancho en 10 viewports en Chromium y Pixel 5; comprueba teclado/foco, nombre accesible, error de login sin POST, error de nombre, CTA deshabilitado, drawer cerrado, hit-test y overflow. Capturas sintéticas comparables inspeccionadas en `.e2e-screenshots/qa-text-fields-recheck-20261004-1010/`.

Karma frontend completo: **929/929** tests; el gate global configurado en 80 % sigue abierto (**78.11/65.50/76.18/79.56 % S/B/F/L**), sin rebajar umbrales. `input.component.ts` queda en **100/100/94.12/100 %**; los cambios en Account/Calendar son declaraciones de geometría dentro de templates/estilos estáticos, no lógica ejecutable, y quedan cubiertos por la medición E2E. `typecheck:e2e`, Prettier del spec E2E, `check:ui` (**189 archivos, 20 reglas, 0 incidencias**), build frontend producción y `git diff --check` pasan. El build mantiene avisos existentes de budget inicial (715.52 kB frente a 500 kB) y estilos grandes; no se modificaron los budgets.

**Revalidación por CI (2026-10-08):** el título del evento vuelve al componente compartido `.cal-input--text`
y expone una etiqueta visible localizada («Título»/«Title»); se quitó su override tipográfico y de 48 px,
que contradecía el contrato de esta sección. La regresión de campos pasó en Chromium y Pixel 5; la
captura móvil confirma drawer cerrado y campo visible. `typecheck:e2e` y `check:ui` pasan. La cobertura
global permanece bajo el gate de 80 % anotado arriba; no se cambia el umbral.
**Rollback focal:** retirar únicamente los tokens/reglas de geometría de inputs de texto estándar, esta
regresión E2E y esta subunidad; conservar el contrato global, el marco común y estilos de otras familias.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.PAGE-HEADINGS.1 · títulos principales de vistas

**Fuente revalidada (2026-10-08):** Dashboard, Cuenta, Preferencias y la portada de Compra muestran un
`h1` que nombra la vista. Sus estilos repiten la misma familia display, tamaño `--text-2xl`, peso bold y
color principal; el reset global elimina los márgenes por defecto, pero solo `.dashboard__title` declara
`margin-bottom: var(--space-1)`. Los otros tres títulos calculan margen inferior cero, así que un grupo
de la misma jerarquía deja una separación distinta respecto al subtítulo siguiente. Esta unidad cubre
solo esos cuatro títulos de página; no incluye títulos de diálogo, contenido de recetas/artículos ni
encabezados de sección con jerarquía inferior.

**Contrato:** los cuatro `h1` de vista usan un único `.page-heading`: familia `--font-display`, tamaño
`--text-2xl`, peso `--font-bold`, `--leading-normal`, color `--text-primary` y margen `0 0 var(--space-1)`;
sus cajas miden el line-height por el número real de líneas. No se exige igual alto entre títulos con
diferente longitud: el Dashboard puede envolver el saludo. El ancho sigue dependiendo del texto y de su
contenedor. El contrato se mantiene en los anchos móviles, tablet y escritorio; selección, hover u otros
estados no aplican a estos encabezados no interactivos. No se cambia el texto/localización ni la estructura
semántica `h1`.

**Baseline rojo (2026-10-08):** la nueva E2E aislada falló en Chromium y Pixel 5 en 320 px al comparar
Dashboard con Cuenta. El saludo mide 72 px por sus dos líneas frente a 36 px del título de Cuenta; esa
diferencia de altura es contenido esperado. Las métricas tipográficas coinciden, pero Dashboard calcula
margen inferior de 4 px y Cuenta/Preferencias/Compra 0 px; el test se limita por tanto a exigir que cada
caja mida `line-height × líneas` y contrasta el margen y resto de estilos entre rutas.

- [x] Añadir primero una E2E aislada roja que mida los cuatro `h1` con Chromium y Pixel 5 en 320, 393,
      568×320, 767/768/769, 1023/1024/1025 y 1440×900; contrastar fuente, tamaño, peso, interlineado,
      tracking, márgenes, padding y borde con tolerancia ≤1 CSS px; comprobar el alto de caja frente al
      número real de líneas, sin comparar títulos de distinta longitud como si tuvieran el mismo alto. La
      reproducción debe localizar la diferencia de margen Dashboard vs. las otras tres vistas.
- [x] Crear un único contrato compartido para los títulos de página y migrar los cuatro consumidores,
      preservando texto, rutas, jerarquía semántica, subtítulos y anchuras fluidas.
- [x] Repetir la matriz de medidas, comprobar encabezado accesible único, contenido visible y sin
      overflow; guardar e inspeccionar capturas sintéticas comparables de las cuatro rutas en escritorio
      1440×900 y móvil 393×851.
- [x] Ejecutar Karma completo con gate ≥80 % S/B/F/L, `typecheck:e2e`, `check:ui`, formato, build de
      producción y `git diff --check`; CSS estático se valida por E2E y coverage instrumentable: N/A.
      Registrar comando/resultados, rollback acotado y mantener abierta la auditoría global.

**TDD rojo→verde y evidencia (2026-10-08):** la primera E2E aislada falló en Chromium y Pixel 5 con
Dashboard margin-block-end 4 px vs. 0 px en Cuenta/Preferencias/Compra. Se normalizaron los cuatro
consumidores al estilo global `.page-heading` sin alterar texto, jerarquía `h1`, anchuras ni subtítulos.
La repetición con `E2E_RATE_LIMIT=on` y
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/ui-page-heading-geometry.spec.ts --reporter=line` pasó **2/2** con la app, SQLite, semilla y
puertos propios; comparó los cuatro títulos en los diez anchos/orientaciones declarados, midió borde,
padding, márgenes, tipografía e interlineado, validó altura por rango de texto/líneas, heading accesible
único y ausencia de overflow. El runner confirmó cleanup tras cerrar la app. Ocho capturas sintéticas
1440×900 y 393×851 se guardaron e inspeccionaron en
`.e2e-screenshots/qa-page-headings-20261008/` (cuatro rutas × Chromium y Pixel 5), ignoradas por Git.
`pnpm run test:client` pasó **1201/1201**; el hook pre-push repitió **1201/1201** y coverage global
**90,33/81,46/88,99/91,75 % S/B/F/L**, con
los gates 80 % intactos. `pnpm run typecheck:e2e`, Prettier focal, `pnpm run check:ui` (**210 ficheros,
21 reglas, 0 incidencias**), `pnpm run build` de servidor + cliente producción y `git diff --check`
pasaron. La cobertura instrumentable del cambio es N/A: solo CSS estático y clases de plantilla, medidos
en el navegador. El build conserva warnings preexistentes de bundle inicial, presupuestos de estilos e
imports/plantillas no relacionados; no se modificaron budgets. La auditoría visual global sigue abierta.

**Rollback focal:** retirar la clase/estilo compartido de estos cuatro títulos, restaurar sus reglas
locales y quitar esta regresión y subunidad; mantener intactos los encabezados de otras jerarquías.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.STAT-CARDS.1 · métricas de Dashboard y Despensa

**Fuente revalidada (2026-10-08):** las tarjetas de resumen de Dashboard y Despensa comparten la misma
clase `.stat-card`, la misma separación de icono (`--space-3`) y tipografía de valor/etiqueta. El bloque de
Dashboard declara `padding: var(--space-4)` (16 px); el de Despensa declara `var(--space-3) var(--space-4)`
(12 px arriba/abajo). Esta discrepancia geométrica no figura como excepción. La superficie externa sí es
funcionalmente distinta: Dashboard dibuja tarjetas independientes; Despensa agrupa tres celdas en una
superficie continua con separadores y apila esas celdas en móvil. Ese tratamiento de borde/radio/fondo se
conserva y no justifica cambiar el padding del contenido.

**Contrato:** los `.stat-card` de ambas vistas comparten padding de 16 px en los cuatro lados, gap,
alineación y tipografía de valor/etiqueta; anchos dependen del grid contenedor y no se fuerzan iguales.
Despensa conserva `font-variant-numeric: tabular-nums`; superficies/divisores del contenedor siguen sus
variantes funcionales actuales. Sin cambio de datos, etiquetas, orden ni acciones.

- [x] Añadir primero una E2E roja con usuario sintético vacío que mida todas las `.stat-card` en
      `/dashboard` y `/pantry`: padding, gap, alineación y tipografía de valor/etiqueta deben coincidir
      con tolerancia ≤1 CSS px; el baseline reproduce 12 px frente a 16 px de padding vertical.
- [x] Cambiar solo el padding interno de Despensa al contrato compartido; preservar wrapper continuo,
      separadores, colores, anchuras responsivas y números tabulares.
- [x] Repetir Chromium y Pixel 5 en 320×568, 393×851, 600/601 y 1440×900; validar todas las tarjetas,
      estado vacío y ausencia de overflow, sin escribir en la DB normal.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil de las dos rutas; ejecutar `typecheck:e2e`,
      `check:ui`, Prettier, build, pruebas focales, `git diff --check` y coverage ≥70 % S/B/F/L si
      aparece lógica instrumentable. Registrar evidencia y rollback antes de cerrar.

**Evidencia (2026-10-08):** la E2E roja aislada falló en Chromium y Pixel 5 con 30 discrepancias por
proyecto: los tres `.stat-card` de Despensa calculaban 12 px de padding arriba/abajo en cada uno de cinco
viewports, frente a 16 px en Dashboard; gap, alineación y tipografía de valor/etiqueta coincidían. Se
aplicó TDD cambiando únicamente ese padding a `var(--space-4)` y dejando intactos el wrapper agrupado,
divisores, anchos del grid y números tabulares. `node scripts/run-isolated-playwright.mjs --workers=1
--project=chromium --project=mobile-chrome tests/e2e/stats-card-geometry.spec.ts --reporter=line` pasó
**2/2** en 320×568, 393×851, 600/601×900 y 1440×900; todas las tarjetas ahora comparten los estilos
geométricos declarados y no hay overflow. Se guardaron e inspeccionaron capturas PC/móvil de ambas rutas
en `.e2e-screenshots/qa-stat-card-parity-20261008/`. `pnpm run typecheck:e2e`, `pnpm run check:ui`
(210 ficheros, 21 reglas, sin incidencias), `pnpm run build` de servidor + frontend producción,
Prettier focal y `git diff --check` pasan; el build conserva avisos de presupuestos del bundle/estilos y
templates no usados, sin cambiar sus gates. Coverage S/B/F/L: N/A, la producción cambiada es CSS estático
y el cambio no añade lógica instrumentable. El runner preservó el diagnóstico temporal del primer intento
rojo en su carpeta propia `hogaria-e2e-*`; no se usó ni modificó la DB normal.

**Rollback focal:** restaurar el padding vertical previo solo en `.stat-card` de Despensa, retirar la
regresión E2E y esta subunidad; no revertir el contrato de los títulos ni otros componentes de resumen.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.RECIPE-CARDS.1 · tarjeta de receta entre rutas

**Fuente revalidada (2026-10-08):** Dashboard y `/recipes` renderizan la misma familia `.recipe-card` y
comparten radio XL, borde, fondo e imagen 16:10, pero el estilo local varía: Dashboard usa padding de
contenido `--space-3`, nombre `--text-sm`/`--font-medium` y margen inferior `--space-2`; el catálogo usa
`--space-4`, `--font-display`/`--text-base`/`--font-semibold` y margen `--space-1`. La meta de Dashboard
no fija tamaño de fuente (16 px frente a 12 px), line-height (24 px frente a 18 px) ni gap (normal frente
a 12 px), mientras que el catálogo fija `--text-xs` y `--space-3`. El título del Dashboard mide 14 px,
500 y 21 px de line-height, frente a 16 px, 600 y 24 px en catálogo; también difiere su margen inferior
(8 px frente a 4 px). El Dashboard omite descripción, porciones y favorito; el catálogo los incorpora.
Esos datos opcionales y las anchuras de grid no deben forzar altura/ancho iguales, pero no justifican
estilos tipográficos distintos para el mismo título/cuerpo.

**Contrato:** ambas rutas comparten borde, radio, fondo, relación 16:10 de la imagen, padding del cuerpo
`--space-4`, título display `--text-base`/semibold con margen `--space-1` y meta `--text-xs`; las cajas
respetan contenido y grid fluidos. Se mantienen el anchor clicable del Dashboard y el botón de detalle/
favorito del catálogo, así como descripción y metadatos exclusivos de cada vista. La prueba compara solo
propiedades compartidas y ratio de imagen, no anchuras ni alturas afectadas por contenido opcional.

- [x] Añadir primero una regresión Playwright roja con receta sintética presente en ambas rutas; medir
      estilos comunes de card, imagen, cuerpo, título y meta a 320, 393, 568×320, 767/768/769,
      1023/1024/1025 y 1440 px. El baseline Chromium y Pixel 5 reprodujo padding 12/16 px, diferencias
      de familia/tamaño/peso/line-height/margen del título y meta 16/12 px, line-height 24/18 px y gap
      normal/12 px; las medidas se comparan con tolerancia ≤1 CSS px.
- [x] Alinear solo los estilos de Dashboard con el contrato compartido; no retirar descripción,
      favorito, porciones, badges, deep links ni comportamiento de cada card.
- [x] Repetir con Chromium y Pixel 5, asegurar ratios 16:10, sin overflow, tarjeta/receta legible y
      deep link conservado; no escribir fuera de fixtures/SQLite temporal.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil de ambas rutas y ejecutar prueba focal,
      `typecheck:e2e`, `check:ui`, Prettier, build y `git diff --check`; documentar cobertura por archivo
      ≥70 % S/B/F/L si cambia lógica instrumentable, warnings y rollback.

**Evidencia (2026-10-08):** TDD: la regresión aislada falló en Chromium y Pixel 5 antes del cambio,
localizando las diferencias descritas en los diez viewports declarados (320×568, 393×851, 568×320,
767/768/769×1024, 1023/1024/1025×768 y 1440×900). Se ajustaron únicamente las reglas CSS de la card
del Dashboard: padding `--space-4`, título display `--text-base`/semibold con margen `--space-1`, y meta
`--text-xs`/gap `--space-3`; se conservaron superficies, estructura, enlaces, dificultad y el layout
específico de cada ruta. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium
--project=mobile-chrome tests/e2e/recipe-card-geometry.spec.ts tests/e2e/dashboard-recipe-links.spec.ts
--reporter=line` pasó **8/8**. La regresión recorre los diez tamaños en ambos proyectos, verifica estilos
compartidos/ratio 16:10 y ausencia de overflow en ambas rutas; el test de enlaces confirma el deep link.
Se guardaron e inspeccionaron capturas sintéticas en
`.e2e-screenshots/qa-recipe-card-parity-20261008/` (`dashboard/recipes` × PC/móvil). Pasaron
`pnpm run typecheck:e2e`, `pnpm run check:ui` (210 ficheros, 21 reglas, sin incidencias),
`pnpm run build` (servidor y frontend de producción), Prettier focal y `git diff --check`. El build
mantiene avisos de budgets de bundle/estilos e imports/plantillas no usados fuera del alcance; no se
alteraron gates. Coverage: N/A, solo CSS estático sin nueva lógica instrumentable. El runner usó SQLite
aislado/fixture sintética y limpió su DB y artefactos temporales propios.

**Rollback focal:** restaurar las declaraciones de geometría originales solo en las tarjetas del
Dashboard (`--space-3`, título sm/medium con margen `--space-2`, meta sin tamaño/gap explícitos), retirar
la regresión y esta subunidad; conservar la paridad de métricas y títulos.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.SCREENSHOT-STABILITY.1 · capturas sin transición intermedia

**Fuente revalidada (2026-10-09):** el E2E de paridad de «Planificar IA» y el botón primario de
Recetas cambia el viewport varias veces y captura PC/móvil inmediatamente después del último resize.
La corrida aislada de la matriz geométrica pasó **32/32** en Chromium y Pixel 5, pero la captura
`calendar-cta-mobile.png` muestra la barra lateral a medio cerrar; la captura desktop también queda
desplazada mientras termina el cambio de breakpoint. Otras capturas del mismo run (`calendar-calendar-route-desktop.png`
y `ui-geometry-mobile.png`) muestran el estado estable. Esto apunta a una captura prematura del E2E, no
confirma un defecto de producción. Todos los artefactos son sintéticos y están en `%TEMP%`.

**Contrato:** antes de capturar 393×851 o 1440×900, esperar la posición final calculada del sidebar
según el viewport (oculto en móvil y fijo en escritorio), la estabilización del layout y `scrollX=0`;
no usar un `waitForTimeout` fijo. La captura debe mostrar el contenido entero, sin overlay accidental ni
recorte transitorio. No cambiar producción.

- [x] Añadir una aserción E2E que espere mediante polling geométrico el estado final del sidebar tras el
      resize y que compruebe ausencia de overflow horizontal antes de la captura.
- [x] Repetir el test en Chromium y Pixel 5; guardar e inspeccionar capturas sintéticas comparables de
      `/calendar` a 1440×900 y 393×851 para confirmar que no hay transición ni recorte.
- [x] Ejecutar typecheck, formato, `git diff --check` y hooks de commit/push sin bypass; actualizar la
      evidencia al pasar todas las casillas y no tocar estilos de producción.

**Evidencia focal (2026-10-09):** `tests/e2e/ui-geometry-consistency.spec.ts` espera el rectángulo
final del sidebar con `expect.poll`, comprueba ausencia de overlay/overflow y posiciona la ventana en
`scrollX=0` antes de capturar; no usa esperas fijas ni cambia producción. `pnpm run typecheck:e2e` pasó;
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
--forbid-only tests/e2e/ui-geometry-consistency.spec.ts` pasó **4/4** con `E2E_RATE_LIMIT=on`, DB,
puertos y artefactos temporales propios. Capturas guardadas en
`%TEMP%\hogaria-geometry-capture-fix-20261009-024905\calendar-cta-{desktop,mobile}.png` e
inspeccionadas: ambas muestran calendario y CTA completos, sin sidebar/overlay intermedio ni recorte.
Prettier focal y `git diff --check` pasan. El commit `9223bb5` pasó los hooks pre-commit/pre-push sin
bypass y quedó enviado a la rama: pre-push completó formato, `check:ui`, build, `typecheck:e2e`, Karma
**1219/1219** (90.69/81.87/89.35/92.15 % S/B/F/L) y servidor **1234 pass + 1 skip**. Esta subunidad
queda cerrada; la matriz geométrica global sigue abierta.

**Rollback:** retirar únicamente la sincronización/aserciones de captura y este subapartado; conservar
los tests y correcciones geométricas de producto ya validadas.

### Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.MODAL-SHELL.1 · shell modal compartido

**Fuente revalidada (2026-10-09):** `ModalComponent` (`app-modal`) sirve los diálogos de objetivos del
Calendario y el alta de Configuración IA. Define overlay fijo con padding `--space-4`, variantes explícitas
`sm/md/lg/xl/full`, límite de altura, header/body compartidos y botón de cierre de 44×44 px. Objetivos usa
`md`; alta de Configuración IA usa `lg`. El inventario visual de rutas no abre diálogos, y las E2E existentes
revisan cada flujo por separado, pero no comparan el shell común entre rutas. El modal de evento del
Calendario es una excepción funcional deliberada (popup anclado en escritorio/hoja inferior en móvil) con
overrides de overlay y caja en `styles.scss`; queda fuera de la comparación del shell estándar y no se
normalizará con una modal centrada.

**Contrato:** comparar el overlay, header, body, título y cierre de los dos diálogos estándar `md/lg` en 320×568,
393×851, 568×320, 767/768/769 y 1440×900; verificar caja contenida, ausencia de overflow global,
padding/radio comunes, cierre táctil ≥44×44 y body desplazable cuando su contenido supera la altura. El
diálogo debe tener nombre/rol accesibles, mover y atrapar el foco, cerrar con Escape y devolver el foco al
disparador. Capturas solo con identidad y contenido sintéticos (PC y móvil); no usar datos personales ni
ejecutar llamadas al proveedor IA.

- [x] Añadir primero una E2E Playwright aislada que abra Objetivos del Calendario y el alta de
      Configuración IA; comparar propiedades calculadas del shell sin tratar `md` y `lg` como el mismo ancho.
- [x] Validar Chromium y Pixel 5 en los viewports del contrato, navegación/foco/Escape, dimensiones y
      scroll del modal, hit-target del cierre y ausencia de overflow; guardar e inspeccionar capturas PC/móvil.
- [x] Ejecutar typecheck E2E, Prettier, `check:ui`, build de producción y `git diff --check`; cobertura de
      producción N/A si no se cambia lógica ejecutable. Registrar resultados/limitaciones y mantener abierta
      la matriz geométrica global mientras quede cualquier otra familia sin auditar.

**Evidencia (2026-10-09):** la regresión aislada abre los dos diálogos y compara overlay, header,
body, título y cierre en 320×568, 393×851, 568×320, 767/768/769 y 1440×900; también verifica tamaños
`md/lg` por separado, accesibilidad, foco/teclado/Escape, scroll del formulario y ausencia de overflow.
La inspección inicial revalidó que el diálogo de evento del Calendario tiene un layout anclado/hoja
intencional y lo excluyó; el comparador usa el diálogo estándar de objetivos. La repetición final en
Chromium y Pixel 5 emulado pasó **2/2** con SQLite/puertos/servidores aislados y limpiados. Capturas
sintéticas PC/móvil guardadas e inspeccionadas en `%TEMP%\hogaria-modal-shell-rerun-20261009`:
`calendar-objectives-modal-{chromium,mobile-chrome}.png` y
`ai-config-modal-{chromium,mobile-chrome}.png`. `pnpm run typecheck:e2e`, Prettier,
`pnpm run check:ui` (**211 archivos/21 reglas**), `pnpm run build` y `git diff --check` pasan; el
build conserva warnings de bundle/imports/budgets ya existentes. Cobertura de producción: N/A,
porque no se cambió lógica ejecutable. No se llamó al proveedor IA. La auditoría global de familias
geométricas sigue abierta.

**Rollback focal:** retirar solo `tests/e2e/modal-shell-geometry.spec.ts` y este subapartado; no
cambiar estilos ni comportamiento de `ModalComponent` si la medición no descubre una discrepancia reproducible.

### Subunidad QA-CALENDAR.EARLY-HOURS.1 · hora actual visible en la rejilla

**Fuente revalidada antes de implementar (2026-10-04):** el contrato histórico vigente de `HOGARIA-SPEC.md §8f`
establece que, al cargar, la rejilla debe acercarse a «ahora» si hoy está visible. En cambio,
`frontend/src/app/core/calendar-grid.ts` devuelve siempre la ventana fija 07:00–23:00 cuando no hay eventos
con hora; `calendar-timeline.component.ts` pinta la línea actual solo si «ahora» cae dentro de esa ventana,
y su auto-scroll prioriza un primer evento futuro incluso si hoy ya va por la madrugada. La captura del usuario
muestra el caso reproducible: calendario semanal con hoy domingo, reloj local 02:08 y rejilla empezando a 07:00.
La conducta acordada para esta unidad es incluir y mantener visible la hora actual cuando el rango de día/semana
contenga hoy, tanto con la agenda vacía como con bloques posteriores, sin recortar eventos ni expandir a las
24 horas si el mínimo de ventana permite evitarlo. Cerca de medianoche se clampa al día (00:00–24:00). En rangos
que no contienen hoy se conserva el recorte y auto-scroll por eventos actuales.

- [x] Añadir primero pruebas unitarias rojas para 02:08 vacío y con un evento posterior, incluyendo ventana,
      etiqueta 02:00 y posición inicial; cubrir límites 00:xx/23:xx y comportamiento sin hoy. Antes de la
      corrección, el unitario focal dio **17/22** y el Playwright real **0/2** (Chromium y Pixel 5): no existía
      la etiqueta 02:00 y la ventana permanecía en 07:00–23:00.
- [x] Implementar el mínimo ajuste de geometría/auto-scroll: cuando hoy está en el rango, incluir la hora
      actual en la ventana y enfocar «ahora» aunque haya eventos posteriores; preservar esos eventos. Fuera
      de hoy se conserva el recorte por eventos/ventana predeterminada.
- [x] Validar Día/Semana con Playwright real aislado y reloj fijo a las 02:08 de Madrid: Chromium escritorio + Pixel 5, agenda vacía y evento sintético a las 10:00, línea ahora visible, sin línea mañana ni errores,
      y sin overflow en 320, 393, 568×320, 767/768/769, 1023/1024/1025 y 1440 px. Teclado/foco probado al
      cambiar de vista y guardar el evento. E2E final **2/2**; DB, seed y puertos temporales propios limpiados.
      Capturas sintéticas inspeccionadas: `.e2e-screenshots/qa-calendar-early-hours-1/`
      (`chromium-week-empty-0208.png`, `mobile-chrome-week-empty-0208.png` y vistas con evento).
- [x] Ejecutar las comprobaciones focales: Karma **22/22**; coverage de `calendar-grid.ts`
      **97,05/87,17/96,15/100 % S/B/F/L**; `typecheck:e2e`, `check:ui` (**189 ficheros, 20 reglas, 0
      incidencias**), build Angular producción y `git diff --check` pasan. Prettier pasa para la nueva E2E;
      `calendar-grid.ts`, su spec y el componente ya fallaban `prettier --check` en `HEAD`, por lo que se
      preservó su formato local y se evitó reformatear líneas ajenas. Build conserva warnings de bundle
      inicial (**715,14 kB/500 kB**) y CSS en componentes fuera del cambio. Sin CSS/layout modificados; Pixel
      5 emulado no simula un inset nativo de safe-area. No se rebajó ningún gate.

**Rollback focal:** revertir únicamente el cálculo de ventana/auto-scroll para el presente, sus regresiones
unitarias y E2E, y este subapartado; conservar el resto de las unidades del calendario.

### QA-RECEIPT.TOTAL-MISMATCH.VISUAL.1 · avisar cuando no cuadra la suma del ticket

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md §12aj` indica que `totalMinor` avisa si no
cuadra. `ReceiptDetailComponent` ya calcula la suma de líneas y, cuando difiere del total reconocido,
marca ese importe y muestra el aviso localizado; su prueba unitaria cubre el cálculo, pero no la ficha
real en navegador. Esta subunidad añade cobertura de UI sin cambiar el comportamiento ni confirmar
compras.

**Contrato:** una lectura sintética en estado `review`, con suma de líneas distinta de `totalMinor`,
muestra ambas cantidades, marca el total discordante y enseña el aviso traducido ES/EN. El estado sigue
siendo revisable y la prueba no pulsa confirmar ni escribe en la despensa/inventario real. Con datos
aislados, también se verifica que no haya overflow horizontal en escritorio/móvil y se capturan solo
fixtures sintéticas.

- [x] Añadir primero una regresión Playwright de navegador para un ticket sintético descuadrado; comprobar
      la suma, el total, la clase visual de discrepancia, el aviso ES/EN y que continúa en `review`.
- [x] Ejecutar en Chromium y Pixel 5 sobre SQLite temporal, comprobar 320 px y el viewport de escritorio,
      ausencia de overflow y capturas sintéticas comparables; no llamar a WebAPI/proveedor ni confirmar.
- [x] Ejecutar `typecheck:e2e`, el test focal, formato, `check:ui` y `git diff --check`; no modificar
      producción ni pedir coverage para código instrumentable si el cambio sigue siendo solo de tests/docs.
- [x] Registrar evidencia/rollback, commit atómico con hooks y push; verificar CI actualizado del PR sin
      mergearlo.

**Evidencia local (2026-10-10):** la regresión siembra directamente un ticket/una línea sintéticos en la
SQLite temporal validada bajo `E2E_RUN_DIR`; no configura proveedor ni toca datos normales. La ficha
muestra la suma de **3,00 €** y el total discordante de **3,50 €**, color computado distinto, aviso ES/EN
y estado `review`, sin confirmar. En PowerShell, `$env:E2E_RATE_LIMIT='on';
$env:E2E_SCREENSHOT_DIR=(Join-Path $PWD '.e2e-screenshots/qa-receipt-total-mismatch-20261010');
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome
tests/e2e/receipts.spec.ts --grep 'muestra el aviso sin bloquear la revisión' --reporter=line`
pasó **4/4** (Chromium + Pixel 5,
ES/EN); se comprobó ausencia de overflow a 1440×900, 390×844 y 320×740. Las capturas sintéticas de
escritorio/móvil se guardaron e inspeccionaron en
`.e2e-screenshots/qa-receipt-total-mismatch-20261010/`. `pnpm run typecheck:e2e`, Prettier focal,
`pnpm run check:ui` (**212 ficheros, 21 reglas**) y `git diff --check` pasaron. No cambia producción,
por lo que coverage instrumentable es N/A. El runner confirmó la limpieza de SQLite/uploads y del
servidor propio. La spec se publicó antes del test en `a49ec36`; el commit de test/evidencia
`ba66df5` pasó pre-commit y pre-push sin saltar hooks y se envió a la rama. CI del PR #41
([run 38027861182](https://github.com/juanjoGonDev/MiCocinAI/actions/runs/38027861182)) pasó todos
los gates requeridos en ese HEAD. PR abierto, sin merge.

**Rollback focal:** retirar solo la regresión y esta subunidad; no cambiar cálculo ni presentación del
total salvo que la prueba revele un defecto reproducible.

### QA-RECEIPT.REVIEW-METADATA.1 · editar metadatos tras una lectura correcta

**Fuente revalidada (2026-10-04):** el prompt admite tienda/fecha no detectadas (`null`) y el esquema
mantiene la fecha civil `YYYY-MM-DD`. La ficha habilita ambos campos en estado `review`; las pruebas
unitarias cubren cambios y errores de guardado. La E2E de proveedor loopback ya comprueba lectura
exitosa con valores presentes/ausentes y persistencia sin cambiar metadatos, pero todavía no demuestra
que una persona pueda corregir desde esa ficha una tienda desconocida o fecha ausente y conservar la
corrección en historial. El loopback es fixture sintético: no prueba reconocimiento visual real; eso
pertenece a `QA-AI.REAL-INTEGRATIONS.1`.

**Contrato:** si tienda o fecha no se reconocen, sus controles accesibles quedan vacíos y editables.
La persona puede completarlos, guardar, recargar y ver los valores en detalle/historial. Los nombres
accesibles deben estar traducidos ES/EN. La unidad `QA-RECEIPT.ACTIVE-METADATA.1` amplía el mismo
contrato a `queued`/`analyzing`, con precedencia manual por campo para no competir con el worker.

- [x] Ampliar la E2E de loopback para responder `store: null` y `purchaseDate: null` en ES y EN,
      usar nombres accesibles para tienda/fecha en ES y EN, y rellenar/corregir ambos desde `review`.
- [x] Comprobar guardado por UI, detalle API, recarga y fila del historial para ambos idiomas; conservar
      los checks existentes de ausencia de overflow, fecha civil y proveedor exclusivamente loopback.
- [x] Ejecutar primero la E2E aislada en Chromium y Pixel 5; luego unitarias focales, coverage por
      archivo ≥70 % S/B/F/L si cambia producción, `typecheck:e2e`, build, checks de formato/diff y revisar
      capturas sintéticas comparables. No contactar WebAPI ni enviar tickets reales en esta unidad.

**Evidencia QA-RECEIPT.REVIEW-METADATA.1 (2026-10-04):** `node scripts/run-isolated-playwright.mjs
--workers=1 --project=chromium --project=mobile-chrome tests/e2e/receipts.spec.ts --grep
"la extracción IA conserva tienda y fecha civil|recorre el historial completo de más de cien recibos"
--reporter=line` pasó **6/6** con Chrome local + Pixel 5 emulado: ambos idiomas parten sin tienda/fecha,
permiten completar y guardar, verifican PATCH/GET/reload/historial y ausencia de overflow; la fixture
del proveedor es loopback. El mismo run editó un registro `stopped` desde historial sin cambiar estado
ni inventario. Se confirmó cleanup de app, puertos y SQLite temporal. `pnpm --filter @hogaria/web exec
ng test --no-watch --include src/app/core/time.spec.ts --include
src/app/features/receipts/receipts.component.spec.ts --browsers=ChromeHeadless` pasó **24/24**;
`time.ts` alcanza **95.83/86.67/100/95.83 % S/B/F/L** y `receipts.component.ts` **100 %** en las
cuatro métricas. `typecheck:e2e`, Prettier focal, `check:ui` (**189 archivos, 20 reglas**) y build de
producción pasan; `git diff --check` pasó. Capturas sintéticas de escritorio/móvil en ES/EN,
inspeccionadas. Al repetir Karma con `--code-coverage` en esta selección, el comando retorna código 1
porque el agregado parcial no alcanza el gate global de 80 % (**55.20/46.03/35.76/54.98 %**); el
gate no se cambió y la cobertura por archivo sí supera 70 %. Sin WebAPI ni datos reales.

**Rollback:** retirar solo la ampliación E2E y esta subunidad; cambiar código de producción únicamente
si la regresión demuestra un defecto.

#### Subunidad QA-RECEIPT.HISTORY.DATE-LOCALE.1 · fecha civil localizada en el historial

**Fuente revalidada (2026-10-04):** el idioma activo actualiza `dateLocale()` a `es-ES` o `en-GB`
(`frontend/src/app/core/services/i18n.service.ts`), y `core/time.ts` define que las fechas deben
seguir ese idioma. Sin embargo, el historial usa `DatePipe` con el `LOCALE_ID` estático. La E2E
aislada mostró el defecto: `2024-03-01` aparece como `3/1/24` con la app en español; el formato
esperado por `es-ES` es `1/3/24`. La E2E de edición también detectó que su expectativa de “No date”
era obsoleta después de guardar la fecha corregida; se sustituyó por una verificación positiva del
valor persistido que reveló la discrepancia de idioma. El endpoint conserva la fecha civil exacta.

**Contrato:** el historial presenta la fecha de compra `YYYY-MM-DD` en formato corto del idioma
activo, sin convertirla a otro día por zona horaria. La fecha de subida es un instante y se muestra
con el idioma activo y la zona local del dispositivo. Un valor de compra nulo conserva el texto
«Sin fecha / No date»; después de editarlo, el historial muestra el dato corregido.

- [x] Añadir primero pruebas unitarias para formatear fechas civiles cortas en `es-ES` y `en-GB`,
      incluido valor nulo/ilegible y estabilidad del día frente a zona horaria; la regresión original
      reproducía `3/1/24` en español frente al `1/3/24` esperado.
- [x] Sustituir en el historial de tickets el `DatePipe` estático por formateadores compartidos de
      `core/time.ts` para fecha civil y fecha/hora de subida; conservar etiqueta, fecha API y orden.
- [x] Ejecutar la E2E loopback en Chromium y Pixel 5: tienda/fecha iniciales nulas editables en ambos
      idiomas, fecha localizada tras guardar/recargar, valor visible correcto en historial, diferencia
      entre compra/subida, accesibilidad y breakpoints sin overflow. Revisar capturas solo sintéticas.
- [x] Ejecutar unitarias, typecheck, formato, `check:ui`, build, `git diff --check` y cobertura de
      archivos instrumentables modificados ≥70 % S/B/F/L; no llamar WebAPI/proveedor ni usar tickets
      reales en esta unidad.

**Evidencia QA-RECEIPT.HISTORY.DATE-LOCALE.1 (2026-10-04):** las cuatro E2E combinan idioma ES/EN
con escritorio/Pixel 5 emulado y prueban `YYYY-MM-DD` civil en `es-ES`/`en-GB` bajo `Pacific/Kiritimati`,
fecha/subida como valores distintos, teclado entre campos, guardado y persistencia. Las capturas
`receipt-history-{chromium,mobile-chrome}-{es,en}.png` muestran `1/3/24` en español y `02/03/2024`
en inglés con metadatos corregidos; son sintéticas e inspeccionadas. Cobertura focal, typecheck,
Prettier, `check:ui`, build y limitación del gate global están documentados en la evidencia de
`QA-RECEIPT.REVIEW-METADATA.1` de esta fecha; no hubo llamadas externas ni archivos de Descargas.

**Rollback:** revertir solo los formateadores/uso de fecha del historial, sus pruebas y este subapartado;
conservar la edición de metadatos y el resto del historial.

#### Subunidad QA-RECEIPT.ACTIVE-METADATA.1 · editar tienda y fecha mientras el ticket se analiza

**Fuente revalidada (2026-10-04):** `HOGARIA-SPEC.md §12ao` permite editar tickets analizados y conserva
correcciones manuales frente a respuestas tardías/reintentos, pero la petición explícita del usuario dice
que la tienda y la fecha deben quedar «siempre» editables. `ReceiptDetailComponent.metadatosEditables()`
excluye `queued` y `analyzing`, aunque `PATCH /api/receipts/:id` acepta esos estados, fija los indicadores
manuales por campo y el worker consulta dichos indicadores al persistir el resultado final. La conducta
se concreta aquí: siempre significa desde que el detalle del ticket está disponible, incluidos ambos
estados activos; la edición no espera a que termine la IA.

**Contrato:** la ficha muestra campos accesibles y editables de tienda y fecha civil en `queued`,
`analyzing` y todos los estados terminales. Guardar durante el análisis no cancela, duplica ni cambia el
estado del trabajo. Cada campo es independiente: una corrección manual prevalece sobre la respuesta y los
reintentos posteriores; un campo no editado aún puede completarse desde la IA. Si el ticket se guarda en
cola y se abre al llegar a `analyzing`, los borradores no se pierden con el refresco de estado. La revisión
de líneas, notas y confirmación de inventario conserva sus límites actuales; este cambio solo extiende
tienda/fecha.

- [x] Añadir primero pruebas de componente rojas: campos visibles/editables en `queued` y `analyzing`,
      accesibilidad/teclado y conservación de borrador mientras el ticket recibido se refresca por polling.
- [x] Añadir regresiones SQLite de PATCH en ambos estados y worker con respuesta de proveedor retenida:
      los flags manuales se respetan por campo, el campo intacto recibe el valor IA, y no se altera el
      estado/efectos del ticket por guardar metadata.
- [x] Añadir E2E loopback aislada: abrir un ticket con IA pendiente, corregir tienda/fecha desde la UI,
      guardar antes de liberar la respuesta, terminar análisis, y comprobar API, reload e historial; cubrir
      queued/analyzing, ES/EN, errores reintentables, teclado y Chromium/Pixel 5 sin overflow.
- [x] Ejecutar primero la reproducción roja; después Karma/Vitest y Playwright aislados con SQLite/puertos/
      seed temporales, coverage ≥70 % S/B/F/L por archivo instrumentable, `typecheck:e2e`, formato,
      `check:ui`, build y `git diff --check`. Solo fixtures sintéticas; sin archivos de Descargas ni llamadas
      a WebAPI/proveedores reales en esta unidad.

**Evidencia QA-RECEIPT.ACTIVE-METADATA.1 (2026-10-04):** TDD rojo confirmado primero en Karma:
`ReceiptDetailComponent` falló porque `metadatosEditables('queued')` devolvía `false` y los campos no se
renderizaban. La E2E de Chromium/Pixel 5 reprodujo el mismo hueco en las cuatro combinaciones ES/EN,
escritorio/móvil (`getByLabel('Tienda'/'Store')` ausente en cola). El cambio de producción se limita a
permitir tienda/fecha en `queued` y `analyzing`; las notas, líneas y confirmación mantienen sus límites.

La regresión SQLite de `PATCH` pasó para ambos estados conservando el estado y los flags manuales.
El worker retuvo la respuesta, falló en stream y fallback para forzar el reintento, y luego comprobó que
la tienda editada durante `analyzing` prevalece, la fecha intacta llega desde IA y no se registra la tienda
detectada que se descartó. `pnpm --filter @hogaria/server exec vitest run
src/routes/receipts.routes.spec.ts src/utils/ai-queue.spec.ts` pasó **46/46**.

Con `--coverage`, las rutas instrumentadas de esta unidad superan 70 % en las cuatro métricas:
`receipts.routes.ts` **82.99/72.58/85.18/84.23 %** y `ticket-queue.ts`
**81.74/74.80/84.12/88.78 %** (S/B/F/L). El comando focal sale con código 1 porque la configuración
existente aplica también su umbral por archivo a la lista global instrumentada, donde los ficheros no
ejecutados por este subconjunto aparecen con cobertura cero; no se alteró el gate. El porcentaje de
`ai-client.ts` en esta ejecución parcial no representa el alcance de la unidad.

`E2E_CHROME_BIN` apunta al Chrome local del sistema porque no está instalado el ejecutable Chromium de
Playwright. `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium
--project=mobile-chrome tests/e2e/receipts.spec.ts --grep "guarda en cola y durante el análisis"
--reporter=line` pasó **4/4** (Chrome escritorio + Pixel 5, ES/EN), con SQLite/semilla/puertos
temporales y proveedor loopback. Cubrió guardar en cola, fallo PATCH 503 y reintento, borrador de fecha
conservado por polling al pasar a análisis, guardar durante `analyzing`, respuesta posterior de IA,
persistencia API/recarga/historial, teclado y ausencia de overflow en 320×568, 568×320, 768×1024 y
1024×768. Chromium escritorio pasó **2/2** (ES/EN) y Pixel 5 móvil **2/2** (ES/EN). La E2E consulta
`ai_jobs` mediante SQLite en solo lectura, valida que cada ticket conserva exactamente un trabajo y
compara el número de solicitudes al proveedor antes/después de cada PATCH: guardar no provoca una
solicitud extra ni duplica/cancela la ejecución. No se fija el total de solicitudes porque una ejecución
puede incluir el fallback de streaming.
Se cierran los avisos sintéticos antes de capturar. El runner confirmó limpieza del stack y SQLite.
Capturas sintéticas revisadas e ignoradas por Git en `.e2e-screenshots/qa-receipt-active-metadata-1/`.

Karma pasó **25/25**. Cobertura de `receipt-detail.component.ts`: **98.63/89.02/100/100 % S/B/F/L**;
el run focal devuelve exit 1 solo porque el gate agregado existente exige 80 % global y el subconjunto
alcanza **30.86/16.69/22.28/32.81 %**; no se cambió el gate. `pnpm run typecheck:e2e`, Prettier focal
de los cinco archivos TypeScript, `pnpm run check:ui` (**189 archivos, 20 reglas**), build de
producción y `git diff --check` pasan. El build mantiene avisos preexistentes de presupuesto y de
imports/tipos en otras vistas; el archivo Markdown completo ya fallaba el chequeo Prettier en `HEAD` y
este fragmento sí coincide con su salida formateada. Sin WebAPI, tokens ni tickets reales.

**Rollback:** retirar únicamente el permiso de edición durante `queued`/`analyzing`, sus pruebas y este
subapartado; conservar la detección, edición terminal e historial.

#### Subunidad QA-CI.E2E.ACTIVE-CONTRACTS.1 · corregir regresiones E2E contra la UI vigente

**Fuente revalidada (CI `37701326593`, commit `9700f810`):** Type Check, build, Server Tests y Full-stack
E2E pasaron; los shards 2 y 4 fallaron. Los informes muestran selectores/assertions obsoletos (objetivo
del generador ahora son botones; varios objetivos pueden estar seleccionados; Hogar separa las pestañas
Inicio/Miembros/Ajustes; la búsqueda del inventario solo existe al montar la tabla), un rango semanal
esperado hasta el día ancla en vez de hasta domingo, y una aserción de tipo de evento que no abre antes
«Más opciones». El test de módulos también permite interacción antes de terminar la carga del perfil; hay
que probar esa carrera con GET retenido antes de decidir si hace falta un cambio de interfaz.

**Contrato:** los E2E deben representar controles y rangos que existen hoy, sembrar los datos mínimos que
montan controles condicionales y probar los estados de carga sin `waitForTimeout` ni assertions ambiguas.
Los cambios de producto se limitan a un defecto de interacción reproducido; los ajustes de test no alteran
el alcance de la app.

- [x] Añadir primero una E2E aislada que retenga la carga del perfil en Configuración y compruebe que una
      interacción temprana no puede perderse; implementar el cambio mínimo solo si reproduce el riesgo.
- [x] Actualizar los selectores/setup de Calendario, Inventario, Preferencias/planificador y Hogar contra
      templates, servicios y labels actuales; la semana solicitada debe comprobar el rango inclusivo real.
- [x] Ejecutar todas las regresiones de ambos shards en Chromium aislado; ejecutar móvil real/emulado en
      las rutas UI afectadas si se cambia producción, con DB/puertos/semillas temporales y cleanup propio.
- [x] Ejecutar typecheck E2E, pruebas unitarias focales si cambia producto, formato, `check:ui`, build y
      `git diff --check`; documentar resultado, warnings heredados y capturas PC/móvil si cambia UI.
- [x] Commit atómico con hooks, push a la rama del PR sin quitar CI ni saltar verificaciones, y esperar a
      que todos los jobs del nuevo run queden verdes.

**Evidencia local:**

- CI `37701326593` confirmó los rojos originales en shards 2 y 4. El test reteniendo `GET /api/auth/taste`
  falló primero mientras el control seguía habilitado; después el bloqueo de módulos espera la carga inicial
  y permite recuperarse si esa carga falla.
- E2E de carga del perfil, **4/4**: `$env:E2E_RATE_LIMIT='on'; pnpm run test:e2e -- --workers=1
--project=chromium --project=mobile-chrome tests/e2e/settings-modules.spec.ts --grep
'interruptores de módulo responden|no se pueden cambiar módulos'`. Red antes del cambio: la nueva E2E
  fallaba al mantener el perfil pendiente y encontrar el control habilitado.
- Los selectores y fixtures reflejan la UI viva (incluye el campo de búsqueda condicional del inventario,
  objetivos múltiples, pestañas de Hogar, rango semanal lunes–domingo y opciones avanzadas de evento).
- Las seis specs afectadas completas corrieron en Chromium + Pixel 5 emulado: **138 pasaron, 2 fallaron y
  4 se omitieron**; ambos rojos eran supuestos incorrectos de las propias E2E móviles. La prueba de scroll
  usaba rueda de ratón en contexto
  táctil; ahora envía un gesto CDP táctil y espera el fin de la animación antes de medir el botón. La prueba
  de compra cuenta el host `<app-button>` junto con los botones de icono. Repetición de ambas regresiones:
  **4/4** (Chromium + Pixel 5); configuración tras el guard de carga: **4/4**; conjunto inicial de regresiones
  CI: **20/20**.
- Comando de las dos regresiones móviles, **4/4**: `$env:E2E_RATE_LIMIT='on'; pnpm run test:e2e --
--workers=1 --project=chromium --project=mobile-chrome tests/e2e/calendar.spec.ts
tests/e2e/shopping-round6.spec.ts --grep 'conserva la comida y permite reintentar si falla el
borrado|una oferta 3x2 se pinta en la fila y se quita con un toque'`. El runner usa SQLite y puertos
  aislados; limpia los artefactos al terminar en verde.
- Karma focal: **21/21**. Coverage focal: `modules.service.ts` **98/90/100/100 %** y
  `settings.component.ts` **100/100/100/100 %** (statements/branches/functions/lines); el comando parcial
  termina con código 1 solo por el umbral global configurado al 80 % (no se bajó).
- `pnpm run typecheck:e2e`, `pnpm run check:ui` (207 ficheros, 21 reglas, sin incidencias), Prettier y
  `git diff --check` pasan. `pnpm run build:client` pasa con warnings de presupuesto, imports no usados y
  optional chaining/nullish coalescing en ficheros ajenos a este cambio.
- Capturas sintéticas revisadas e ignoradas por Git: `.e2e-screenshots/qa-ci-active-contracts/chromium/`
  y `.e2e-screenshots/qa-ci-active-contracts/mobile-chrome/`.
- CI `37705486074` (#451) pasó build, typecheck, server tests, full-stack y shards 1/3/4; shard 2 falló
  solo en `logs-clear-filters.spec.ts`: exigía terminal vacío aunque el stream global seguía recibiendo
  logs sintéticos del servidor desde otros workers. El snapshot confirma 161 entradas `[SRV]` activas tras
  el `DELETE` correcto; el contrato relevante es que se borren las tres filas del test y la selección.
- Se quitó la aserción global de terminal vacío, manteniendo las aserciones sobre las filas de este test y
  la selección. Verificado con `E2E_RATE_LIMIT=on pnpm run test:e2e -- --workers=1 --project=chromium
tests/e2e/logs-clear-filters.spec.ts` (1/1), `pnpm run typecheck:e2e` y `git diff --check`.
- Commit `0fbc74f` (`test(logs): tolerate parallel server entries`), hook pre-commit y pre-push completos;
  CI `37706780544` (#452) terminó con **todos los jobs verdes**, incluidos los cuatro shards E2E y
  Full-stack E2E.

**Rollback:** revertir únicamente este commit quita el guard y sus pruebas (`modules.service.ts` y
`settings.component.ts`, con sus specs unitarias), los ajustes de las seis specs E2E y esta evidencia; no
hay migraciones ni cambios de datos persistentes.

#### Subunidad QA-CI.E2E.DASHBOARD-SHARD-2 · corregir regresiones E2E del Dashboard

**Fuente revalidada (CI `37752614623`, commit `ccd253c`):** typecheck, full-stack E2E, server tests,
shards 1/3/4 y build pasaron; shard 2 falló en tres pruebas que contaban todo `GET /api/ai/configs`
como invocación del proveedor, y en una prueba que esperaba un miembro en el hogar recién creado
mientras la tarjeta del Dashboard mostraba cero.

**Contrato:** los accesos de solo lectura a la configuración IA no cuentan como generación ni como
llamada a proveedor; la navegación/estado vacío no debe enviar solicitudes de generación. La tarjeta
de miembros del Dashboard debe reflejar los miembros activos del hogar seleccionado, incluido quien
lo crea.

- [x] Ajustar primero las E2E para distinguir lecturas de configuración de solicitudes que generan
      contenido; reproducirlas localmente con SQLite temporal y comprobar que generación no se invoca.
- [x] Reproducir el cero de miembros en hogar recién creado; corregir el producto solo si la regresión
      se reproduce contra el contrato, de lo contrario corregir el setup/espera obsoletos del E2E.
- [x] Ejecutar las cuatro regresiones focales aisladas y el shard 2 completo, typecheck, formato,
      `check:ui`, build y `git diff --check`; no alterar datos ni proveedores reales.
- [x] Registrar evidencia y resultados, crear commit atómico con hooks completos, push sin reescribir
      historia publicada y verificar el nuevo CI completo sin mergear.

**Hallazgo y decisión:** en `dashboard.spec.ts` el registro temporal confirmó que la base contiene un
miembro activo, pero las peticiones iniciales concurrentes de hogar/membresías cargaban primero el hogar
y después `loadMemberships()` descubría el id activo, invalidaba la instantánea y la dejaba a `null`.
Dashboard ahora vuelve a asegurar la carga del hogar después de resolver membresías. Las otras tres
E2E confundían lecturas `GET /api/ai/configs` (solo metadatos) con generación; ahora capturan únicamente
`POST /api/ai/generate-recipe` y `POST /api/ai/generate-multiple-recipes`, que son las rutas que
despachan trabajo al modelo.

**Evidencia:**

- TDD: la nueva regresión unitaria falló primero porque no se llamaba `ensureHousehold`; tras el cambio,
  `pnpm --filter @hogaria/web exec ng test --no-watch
--include=src/app/features/dashboard/dashboard.component.spec.ts --browsers=ChromeHeadless` pasó
  **16/16**.
- Las cuatro E2E afectadas pasaron en Chromium escritorio y Pixel 5 emulado: **8/8**, runner aislado,
  SQLite temporal, rate limit E2E activo, sin llamadas a proveedores. Capturas comparables sintéticas,
  revisadas e ignoradas por Git: `.e2e-screenshots/qa-ci-dashboard-shard-2/` (1440×900 y 393×851).
- Shard 2 completo, `CI=true E2E_SEED=local-dashboard-shard2-20261008 node
scripts/run-isolated-playwright.mjs --project=chromium --shard=2/4 --forbid-only`: **102 pasaron**
  en 3,1 min con base aislada.
- `pnpm run test:client`: **1195/1195**. Cobertura global S/B/F/L: **90.29/81.39/88.99/91.71 %**;
  `dashboard.component.ts`: **92.1/76.19/86/96.4 %**, sobre el gate requerido del 70 %.
- `pnpm run typecheck:e2e`, Prettier de los archivos de la unidad, `pnpm run check:ui` (210 archivos,
  21 reglas), `pnpm run build` y `git diff --check` pasan. Build mantiene warnings conocidos de bundle,
  presupuestos SCSS, imports y optional chaining en archivos ajenos a esta corrección.
- Commit `21c935b` (`fix(dashboard): reload active household`) con hooks pre-commit/pre-push completos,
  push a la rama del PR; CI `37755849709` terminó **9/9 jobs en verde**, incluido shard 2. PR #41 sigue
  abierto y fuera de Draft; no se mergeó.
- No se usa WebAPI ni proveedor real; solo datos sintéticos del runner. Sin cambios de esquema ni datos
  persistentes.

**Rollback:** revertir el commit dedicado a esta subunidad conserva la evidencia CI previa; no hay
cambios de esquema ni migraciones.

### Unidad QA-RECIPES.TIMER-CONTROLS.1 · temporizador interactivo en la ficha

**Fuente revalidada (2026-10-08):** `HOGARIA-SPEC.md` §QA-RECIPE.FULL-DETAIL-VIEW.1 requiere
temporizadores por paso. `recipes.component.ts` monta `app-timer` cuando un paso declara duración de
temporizador; `TimerComponent` ya implementa iniciar, pausar, reanudar, completar y reiniciar y su
spec unitario cubría su estado interno, pero ninguna E2E visible comprobaba la integración. Además,
el temporizador no exponía un rol/nombre accesible y su etiqueta española decía «Timer paso».

**Contrato de prueba:** una receta sintética guardada con un paso cronometrado presenta el tiempo
inicial y una acción accesible de inicio; pausar detiene el contador, reanudar continúa el tiempo
restante, llegar a cero muestra el estado completado y reiniciar vuelve al tiempo inicial. La prueba
controla el reloj del navegador, no espera un minuto real, no contacta al proveedor IA y no persiste
cambios en la receta.

- [x] Añadir primero una E2E de navegador contra receta guardada en SQLite aislada que valide iniciar
      con teclado/Enter, pausa sin decrementos, reanudación, finalización exacta, reinicio y nombres
      accesibles de temporizador y controles en Chromium escritorio y Pixel 5.
- [x] Comprobar en 1440×900, 393×851, 320×568 y 568×320 que no hay overflow/recorte y que los
      controles táctiles miden ≥44×44 CSS px; el fixture sintético se persiste y elimina en su propia
      base aislada, sin tocar receta ajena.
- [x] Reproducir primero en E2E y unidad que faltaba el rol/nombre accesible; añadir `role="timer"`,
      nombre ES/EN y `aria-live="off"`, y corregir la etiqueta del paso ES/EN sin cambiar el flujo.
- [x] Ejecutar prueba focal y suite frontend, `typecheck:e2e`, `check:ui`, Prettier, build de
      producción y `git diff --check`; mantener ≥70 % S/B/F/L por archivo y capturas sintéticas
      comparables de PC/móvil.
- [x] Documentar evidencia y rollback sin marcar completa la checklist global `/recipes` mientras
      falten los demás flujos.

**Evidencia (2026-10-08):** TDD reprodujo el fallo primero: la E2E no encontraba un temporizador
con nombre accesible y la unidad quedó en **19/20** por ausencia de `role="timer"`. La suite unitaria
focal pasó **22/22**; la cobertura aislada del componente da **100/100/100/100 % S/B/F/L**
(51/51 sentencias y líneas, 5/5 ramas, 12/12 funciones). `dict/recipes.ts` da 100 % (2/2
sentencias/líneas; 0 ramas/funciones). `pnpm run test:client` pasó **1198/1198** y el gate global
fue **90,31/81,44/88,95/91,75 % S/B/F/L**. E2E aislada con `E2E_RATE_LIMIT=on`, SQLite y puerto
temporal pasó **2/2** (Chromium y Pixel 5), sin IA real; verifica estado inicial, pausa, reanudación,
fin, reinicio, Enter, overflow y geometría de los controles. Al añadir el caso de teclado una primera
repetición reveló avance de reloj en tiempo real durante la interacción; se fijó y pausó el reloj de
Playwright para hacer el tiempo determinista y la repetición pasó. El runner limpió datos/servidor.
`typecheck:e2e`, `check:ui` (**210 ficheros, 21 reglas**), Prettier focal, `pnpm run build:client`
y `git diff --check` pasan; el build solo conserva avisos de budgets/imports preexistentes. Capturas
sintéticas inspeccionadas e ignoradas por Git: `.e2e-screenshots/qa-recipe-timer-controls/`
`{chromium,mobile-chrome}-{idle,finished}.png`.

**Rollback:** revertir el commit atómico de esta unidad (`TimerComponent`, diccionario, regresión
unitaria/E2E y esta sección); no revertir evidencia o commits anteriores.

### QA-CI.RECEIPT.HISTORY-ASYNC.1 · sincronizar la E2E con el fin del análisis

**Hallazgo de CI (2026-10-08, run `37847039744`, shard 3):** 98 pruebas pasaron y falló la E2E
`la extracción IA conserva tienda y fecha civil (en)` en `tests/e2e/receipts.spec.ts:759`, porque
esperó una fila del historial que seguía vacía durante 20 segundos. La prueba espera a que el fixture
registre la solicitud upstream; `iniciarProveedorDeTickets()` la registra antes de enviar la respuesta.
El historial solo incluye tickets terminales (`review`, `confirmed`, `failed`, `stopped`), por lo que
esa señal no garantiza que el análisis asíncrono haya terminado. CI confirmó el fallo; aún no se ha
reproducido localmente.

**Contrato:** no cambiar producción salvo que una regresión reproduzca un defecto del producto. La E2E
debe sincronizar la respuesta al proveedor y el estado terminal del ticket identificado antes de exigir
que aparezca en el historial, y luego validar en EN que tienda/fecha desconocidas sigan siendo nulas y
editables. La coordinación debe seguir basada en estado/respuesta observable, no en esperas temporales.

- [x] Reproducir el rojo en la prueba aislada y añadir primero una barrera determinista que libere la
      respuesta sintética tras registrar la petición; comprobar que la prueba no confunda `analyzing`
      con historial vacío.
- [x] Sincronizar por GET del ticket hasta estado `review` después de completar la respuesta del
      proveedor; verificar la fila de historial y los campos EN tras navegación/recarga.
- [x] Ejecutar la regresión focal, `receipts.spec.ts` en Chromium y Pixel 5 emulado, typecheck E2E,
      formato, `check:ui`, build y `git diff --check`; sin fixture/proveedor real ni base compartida.
- [x] Actualizar esta evidencia, crear commits atómicos con hooks completos y push a la rama; esperar
      CI verde para el SHA actual del PR sin mergearlo.

**Evidencia (2026-10-08):** CI `37847039744` confirmó el rojo en shard 3: 98 pasaron, 6 omitidas
y falló `receipts.spec.ts:759` con 0 filas de historial. El handler de proveedor sintético guarda la
solicitud antes de responder, mientras el endpoint de historial excluye `queued`/`analyzing`; la prueba
local original sin barrera pasó **2/2**, ocultando la carrera. Se añadió una respuesta upstream retenida
determinísticamente: antes de la corrección, ambas variantes fallaron al exigir la fila mientras el
ticket seguía `analyzing` (**0** recibidas). Ahora se verifica que la API de historial excluye ese ticket,
se libera la respuesta, se espera por GET el estado terminal `review` y solo entonces se exige la fila;
también se verifica que ES/EN permitan editar tienda/fecha ausentes. La suite completa de recibos pasó
**24/24** con `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium
--project=mobile-chrome --forbid-only tests/e2e/receipts.spec.ts --reporter=line`, SQLite, puertos,
semilla y cleanup temporales; sin proveedor real ni cambios de producción. `pnpm run typecheck:e2e`,
`pnpm run check:ui` (**210 archivos, 21 reglas**), Prettier focal, `pnpm run build` y
`git diff --check` pasan. La compilación conserva warnings de bundle/imports/optional chaining y budgets
en otros componentes. Cobertura de producción: N/A, porque el cambio es solo de E2E/spec.

**Cierre (2026-10-08):** spec-first `2a948e2` y corrección atómica `997c845`, ambos publicados con
hooks completos (sin omitir ninguno). CI del código `997c845`, run `37849230117`, terminó **9/9 jobs
verdes**, incluidos los cuatro shards E2E y Full-stack E2E. PR #41 sigue abierto y no-Draft; no se
mergeó.

**Rollback:** retirar solo la barrera/sincronización E2E y esta subunidad; no cambiar la política del
historial ni los estados de producción.

### QA-CI.E2E.PANTRY-RECEIPT-ASYNC.1 · estabilizar altas y cola asíncrona

**Hallazgo de CI (2026-10-09, run `37872611309`, shard 3):** 98 pruebas pasaron y el job quedó rojo.
`pantry.spec.ts:442` agotó 45 s esperando `input#ingredientName` después de intentar abrir el modal;
la captura final muestra dos altas visibles y el modal cerrado. `receipts.spec.ts:473` esperó una fila
solo en el historial y agotó 20 s; la captura muestra `ticket.pdf` aceptado y todavía «En cola» en la
sección «En curso». El POST de ese PDF respondió 201 y el servidor guardó `file_kind='pdf'`. La
ejecución focal local previa pasó ambos casos, por lo que las aserciones actuales no sincronizan bien
el trabajo asíncrono y las altas repetidas bajo carga de CI.

**Contrato:** la helper de alta de inventario espera cada transición visible (modal abierto, guardado,
modal cerrado y fila creada) antes de iniciar la siguiente. La prueba PDF valida aceptación como PDF y
aparición única en la bandeja, tanto si el trabajo continúa como si ya terminó; el fallo por falta de
configuración se cubre en la prueba de rescate manual. No cambiar producción salvo que una regresión
reproducible demuestre una deficiencia funcional, y no introducir llamadas a IA externa.

- [x] Reproducir el flaky de `darAlta` con Playwright aislado y añadir primero sincronización por
      modal/fila, nunca por una notificación antigua; repetir la E2E de paginación para confirmar
      estabilidad de las 11 altas.
- [x] Ajustar la E2E PDF para esperar el POST 201, confirmar `fileKind='pdf'` y encontrar exactamente
      una fila de `ticket.pdf` en «En curso» o Historial sin exigir que el worker alcance estado
      terminal en 20 s.
- [x] Ejecutar las focales repetidas y ambas suites (`pantry.spec.ts`, `receipts.spec.ts`) en
      Chromium y Pixel 5 emulado; correr `typecheck:e2e`, `check:ui`, Prettier, build y
      `git diff --check` con el almacenamiento de capturas preexistentes preservado.
- [x] Hacer commit atómico con hooks completos y push; comprobar que todos los gates de CI terminan
      verdes para el SHA actual y mantener PR #41 en Draft, sin merge.

**Evidencia local (2026-10-09):** CI `37872611309` confirmó que el alta se detenía tras dos filas y
que el PDF sí se aceptaba (POST 201 y `file_kind='pdf'`) pero seguía correctamente «En cola» en la
bandeja activa; la prueba original lo buscaba solo en Historial. Se endureció `darAlta` para esperar
el diálogo, su cierre, la fila concreta y la notificación tras cada guardado. La E2E PDF ahora valida
el 201/`fileKind`/`fileName` y una única fila visible, aceptando ambos estados de la cola.

Con `CI=true E2E_RATE_LIMIT=on`, las dos pruebas del hallazgo con `--repeat-each=2` pasaron **4/4**.
Las suites completas de Inventario y Tickets en Chromium y Pixel 5 emulado pasaron **48/48** (4
casos omitidos por las condiciones existentes). Comando:

```sh
node scripts/run-isolated-playwright.mjs --workers=2 --project=chromium --project=mobile-chrome --forbid-only tests/e2e/pantry.spec.ts tests/e2e/receipts.spec.ts --reporter=line
```

DB, puerto y servidores fueron aislados y limpiados; se usaron respuestas IA sintéticas locales, no
proveedor externo. `pnpm run typecheck:e2e`, Prettier focal, `pnpm run check:ui` (**211 ficheros, 21
reglas**), `pnpm run build` y `git diff --check` pasan. Build mantiene warnings preexistentes de
budgets y imports/optional chaining. Las dos capturas de Inventario que ya existían se respaldaron y
sus SHA-256 se comprobaron idénticos tras la ejecución; esta unidad no modifica la UI ni exige nuevas
capturas. El cambio está incluido en el commit atómico `15029f4` y se publicó con hooks completos. La
CI `37876690788` pasó **9/9 jobs** para el SHA `3a88ebbd6ea0810e0c315cf0d771a4136c63d250`, incluidos
Type Check, Server Tests, Production Build, Full-stack E2E y los cuatro shards Playwright. PR #41
continúa abierto en Draft y sin merge.

**Rollback:** retirar la sincronización de la helper, la aserción PDF ajustada y esta unidad de spec;
no revertir cambios de producción ni otras unidades.

### QA-CI.E2E.SHARD-TIMEOUT.1 · dar margen al shard Playwright más lento

**Hallazgo de CI (2026-10-09, run `37891010180`, SHA `3694312`):** el step de Playwright de
`E2E Tests (shard 2)` terminó correctamente, pero el job acabó `cancelled`/check fallido tras
**8m17s** con `timeout-minutes: 8`; los otros tres shards y los demás gates pasaron. El job excede el
límite mientras termina el reporte/cleanup, no por fallos de aserción. La causa se infiere del tiempo
total del job y del límite configurado; el step de pruebas sí reportó éxito.

**Contrato:** los cuatro shards conservan su distribución, suite, retries y controles de aislamiento;
el job E2E tendrá `timeout-minutes: 12` para cubrir el shard más lento más la carga de artefactos y
cleanup. Un test de configuración debe fallar si el margen baja de 12. La validación final requiere
que CI complete todos los shards en el SHA publicado.

- [x] Añadir primero una regresión estática que lea el job `e2e` y exija timeout mínimo de 12 minutos;
      comprobar que falla contra el valor actual de 8.
- [x] Aumentar únicamente el timeout del job `e2e` a 12; no omitir shards, pruebas ni gates.
- [x] Ejecutar el test de configuración, validación de workflows/formato y el conjunto requerido por
      hooks; push atómico y verificar que todos los jobs CI terminan en verde para el head actual.

**Evidencia TDD (2026-10-09):** el run `37891010180` confirmó el problema: el step de Playwright
terminó verde, pero el job 2 quedó cancelado a los 8m17s, frente al límite de ocho minutos. La nueva
prueba `node --test scripts/ci-e2e-timeout.test.mjs` falló primero con el timeout actual de 8; después
de elevar solo ese job a 12, `pnpm run test:config` pasó **11/11**. `node scripts/check-workflows.mjs`
validó **5 workflows**, Prettier cubrió YAML/JSON/test/spec y `git diff --check` pasó. El pre-push
corrió todos los hooks y pasó: typecheck, build, UI rules, 11 tests de configuración, frontend
**1233/1233** (coverage 91.11/82.13/89.69/92.56 % S/B/F/L) y server **1236 passed, 1 skipped**.
CI `37892268641`, SHA `d07ffdc`, terminó **9/9 jobs en verde**; el shard 2 pasó completo en 6m52s
con `timeout-minutes: 12`. No se redujo ni alteró la suite E2E.

**Cierre (2026-10-09):** commit de spec `910436c` y corrección atómica `d07ffdc`, ambos publicados
con hooks completos. PR #41 sigue abierto, Ready for review y sin merge.

**Rollback:** revertir el guard de configuración, su registro en `test:config`, el valor de timeout y
esta unidad; no modificar selección/sharding ni cobertura de Playwright.

### Reapertura QA-CI.E2E.SHARD-TIMEOUT.2 · evitar cancelación del shard 2 con carga actual

**Fuente revalidada (CI run `37984423417`, SHA `07d54e2`):** el job de shard 2 conserva
`timeout-minutes: 12`; su step Playwright seguía activo hasta que GitHub registró
`The operation was canceled` y el job terminó `cancelled` tras aproximadamente 12 minutos. Los
shards 1, 3, 4, full-stack, build, typecheck y tests del servidor finalizaron correctamente. El log
del shard muestra polls de jobs de la cola de Dashboard hasta la cancelación, pero no alcanzó a
publicar su informe JUnit/HTML, así que no hay evidencia para distinguir una suite simplemente lenta
de una prueba que espera de más. El run anterior que cerró `.1` pasó con 12 minutos (shard 2 en
6m52s); el nuevo run demuestra que ese margen no cubre la variación actual.

**Contrato:** conservar los cuatro shards, todas las pruebas, retries y aislamiento. Dar al step y
al upload/cleanup margen hasta 16 minutos, sin modificar los límites individuales de Playwright; la
validación nueva debe terminar y publicar resultados del shard 2, no limitarse a evitar el rojo por
cancelación.

- [x] TDD: elevar el umbral de la regresión de timeout y demostrar que falla con el job actual de
      12 minutos.
- [x] Cambiar solo `timeout-minutes` del job E2E a 16; conservar distribución y ejecución completa.
- [x] Ejecutar suites focales, validación de workflows/formato y hooks completos; commit atómico y
      push. Verificar en un nuevo SHA que todos los jobs E2E y demás gates concluyen en verde y que
      el shard 2 publica su informe sin cancelarse.

**TDD/CI verde (2026-10-09):** el nuevo umbral de 16 falló primero contra los 12 minutos vigentes.
Tras aumentarlo a 16, `pnpm run test:config` pasó **11/11**, `node scripts/check-workflows.mjs`
validó **5 workflows**, Prettier de workflow/test/spec y `git diff --check` pasaron. El pre-push del
commit `1e8dcc7` pasó todos los hooks. CI `37986758250`, SHA `1e8dcc7a647da48d462ff0ef59fb7bce3b68df95`,
terminó **9/9 jobs verdes**: cuatro shards E2E, Full-stack E2E, Server Tests, Type Check, Production
Build e instalación. El step de Playwright del shard 2 completó en **5m35s** y el job en **5m54s**,
con `timeout-minutes: 16`; `Upload Playwright report` concluyó correctamente. No se alteraron shards,
suite, retries ni límites por test.

**Rollback:** revertir solo el umbral de timeout, el valor del job y esta reapertura; no reducir ni
excluir pruebas, shards o retries.

### QA-RECEIPT.DRAG-DROP.1 · recibir archivos al soltarlos en la zona visible

**Fuente revalidada (2026-10-09):** `HOGARIA-SPEC.md` §12aj ofrece tanto elegir como arrastrar un
archivo. En el source actual, `dragover`, `dragleave` y `drop` están ligados al `input[type=file]`,
pero ese input mide 1×1 px, es transparente y tiene `pointer-events: none`; la zona visible es su
`label` padre. `tests/e2e/receipts.spec.ts` cubre el selector de archivos con `setInputFiles`, pero
no arrastrar/soltar. Se debe reproducir antes de corregir.

**Contrato:** los eventos de arrastre se reciben sobre cualquier parte de la zona visible. Soltar un
único PNG sintético debe seguir las validaciones y el mismo endpoint que el selector, crear una única
subida/trabajo, reflejar `Falló` al terminar la cola sin configuración IA y limpiar el estado visual
«arrastrando». El selector, validación MIME/tamaño, estados ocupados y traducciones existentes se
conservan; no añadir OCR ni IA externa.

- [x] Añadir primero E2E Playwright real con `DataTransfer` y archivo sobre el `label` visible;
      reproducir que el estado de arrastre o la subida no se activan en el source actual.
- [x] Reubicar únicamente los handlers drag/drop al contenedor visible; conservar `change` en el
      input y verificar 201, una fila, un trabajo `NO_CONFIG`, estado `Falló` y hover limpio.
- [x] Ejecutar prueba aislada en Chromium escritorio y Pixel 5, revisar 1440×900, 390×844 y
      320×740 sin overflow; guardar e inspeccionar capturas sintéticas PC/móvil.
- [x] Pasar `typecheck:e2e`, `check:ui`, Prettier, build y `git diff --check`; dejar constancia de
      si la suite repetible valida solo eventos sintéticos en móvil, sin fingir drag físico táctil.
- [x] Commit atómico con hooks completos, push y CI verde para el SHA publicado; mantener PR #41
      abierto y Ready for review, sin merge.

**Rollback:** revertir solo el E2E, la reubicación de eventos en `receipts.component.ts`, capturas
aisladas y esta subunidad; mantener intacta la selección de archivos.

**Evidencia TDD (2026-10-09):** el rojo aislado en Chromium falló en el `label` visible: faltaba la
clase `tickets__drop--over` tras `dragover` (timeout 5 s; seguía en `tickets__drop`), ya que los
handlers estaban en el input oculto. Tras mover esos tres bindings al `label`, el E2E real con app y
SQLite temporales pasó **2/2** en Chromium y Pixel 5: `dragover` activa el hover; `drop` lo limpia,
POST devuelve 201 y crea exactamente un recibo/trabajo; el worker aislado termina `NO_CONFIG` y la
fila actualiza a `Falló`. Comando:

```sh
node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/receipt-drag-drop.spec.ts --reporter=line
```

En los tres tamaños calculados no hubo overflow horizontal. Capturas fixture sintética, inspeccionadas:
[PC 1440×900](.e2e-screenshots/qa-receipt-drag-drop-qa-hogaria-e2e-Xn7bIO/chromium/receipt-drag-drop-1440x900.png),
[móvil 390×844](.e2e-screenshots/qa-receipt-drag-drop-qa-hogaria-e2e-Xn7bIO/mobile-chrome/receipt-drag-drop-390x844.png)
y [móvil 320×740](.e2e-screenshots/qa-receipt-drag-drop-qa-hogaria-e2e-Xn7bIO/mobile-chrome/receipt-drag-drop-320x740.png).
El test móvil emite eventos DOM `DataTransfer` sintéticos; no valida arrastre físico/táctil de archivos
en un teléfono. El cambio no añadió lógica TypeScript con ramas nuevas; coverage de producción no aplica.
El commit atómico `3a5399f` pasó los hooks completos de pre-push. CI `37994588131` terminó **9/9 jobs
verdes** en el SHA `3a5399f32bfd7aa3e184e1f6b4ecfc3baecad55c`, incluidos los cuatro shards Playwright y
Full-stack E2E; PR #41 sigue abierto y Ready for review, sin merge.

### QA-RECEIPT.DELETE-CONFIRMATION.1 · verificar cancelar y borrar un ticket desde su ficha

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md` §12aj C incluye DELETE para cerrar el ciclo
del ticket. `receipts.routes.ts` cancela primero un trabajo activo y elimina líneas, trabajos y ficha;
`ReceiptDetailComponent.borrar()` pide confirmación, no escribe al cancelar y, si se confirma, elimina
y navega a `/receipts`. El test de ruta `receipts.routes.spec.ts` valida que DELETE borra ficha,
líneas y trabajo; `receipt-detail.component.spec.ts` valida el flujo de confirmación con servicios
espía. La auditoría de los tests E2E actuales no encontró cobertura de ese contrato desde el navegador.

**Contrato:** usar una ficha sintética en el servidor/SQLite aislados, sin proveedor real. Cancelar el
diálogo debe conservar ruta y datos y no enviar DELETE. Confirmar debe enviar DELETE real una sola vez,
navegar a la bandeja y dejar el ticket inaccesible/ausente en historial; la limpieza backend no debe
dejar líneas ni trabajo huérfanos. Mantener confirmación accesible y el control de borrado existente;
no cambiar producto salvo que el E2E reproduzca un fallo funcional.

- [x] Añadir un E2E real que cancele el borrado y compruebe que ficha y DB siguen intactas;
      confirmar después el borrado y validar 200, navegación, 404 y ausencia de filas hijas.
- [x] Ejecutar en Chromium y Pixel 5 con runner, base y semilla aislados; sin `page.route` en el
      DELETE, verificar limpieza y guardar/inspeccionar capturas sintéticas en un directorio único.
- [x] Si `E2E_SCREENSHOT_DIR` no existe, guardar las capturas del caso bajo
      `testInfo.outputPath('screenshots')`, que el runner aísla por prueba/intento; comprobar Chromium
      y Pixel 5 sin depender de una variable configurada en CI.
- [x] Ejecutar typecheck E2E, `check:ui`, Prettier, build, cobertura global y `git diff --check`;
      documentar resultados/limitaciones, commit y push con todos los hooks y CI verde.

**Rollback:** retirar solo el E2E de confirmación/borrado y esta subunidad; no cambiar la ruta DELETE
ni borrar datos reales.

**Evidencia local (2026-10-10):** el nuevo E2E usa PNG sintética, cuenta/SQLite efímeras y el
proveedor desconfigurado (`NO_CONFIG`). Añade una línea por HTTP real para comprobar la cascada.
Cancelar mantiene la ficha, su línea y su trabajo (GET 200, conteos 1/1/1) y no emite DELETE; aceptar
emite exactamente un DELETE 200, vuelve a `/receipts`, deja GET 404 y los tres conteos en cero. Sin
`page.route`, `typecheck:e2e`, Prettier, `check:ui` (212 ficheros/21 reglas), build y `git diff --check`
pasaron; build conserva avisos previos de bundles/imports. El archivo `receipts.spec.ts` completo pasó
**26/26** en Chromium y Pixel 5 con el runner, `E2E_RATE_LIMIT=on`, `E2E_SCREENSHOT_DIR` único y
cleanup verificado; el caso focal pasó **2/2** tras capturar vistas estables de la confirmación. Sin
cambio de producción; cobertura de producción N/A. Capturas sintéticas revisadas:
[PC 1440×900](.e2e-screenshots/qa-receipt-delete-confirmation-20261010/receipt-delete-confirmation-chromium-1440x900.png),
[móvil 390×844](.e2e-screenshots/qa-receipt-delete-confirmation-20261010/receipt-delete-confirmation-mobile-chrome-390x844.png)
y [móvil 320×740](.e2e-screenshots/qa-receipt-delete-confirmation-20261010/receipt-delete-confirmation-mobile-chrome-320x740.png).

**Hallazgo CI y corrección (2026-10-10):** el CI `37999416317`, shard 3, detectó que el caso exigía
`E2E_SCREENSHOT_DIR` y fallaba antes de completar cuando el runner de CI no la exportaba. Se reprodujo
rojo en el runner aislado con esa variable ausente; el E2E ahora cae a `testInfo.outputPath('screenshots')`
para conservar una ruta única por prueba/intento. El caso focal pasó **2/2** Chromium/Pixel 5 sin esa
variable y `receipts.spec.ts` completo pasó **26/26** en ambos proyectos con carpeta de captura nueva,
`E2E_RATE_LIMIT=on` y cleanup. `typecheck:e2e`, `check:ui`, Prettier, `git diff --check`, build y
suite frontend/backend pasaron en los hooks del commit documental `4cfa900`; coverage frontend
**92.23/83.57/90.98/93.64 % S/B/F/L**, server tests **1236 pasaron/1 omitida**. CI `38001425709`
en `dcb2b26` y CI `38002513901` en `4cfa900` pasaron todos los jobs. Capturas sintéticas de esta
corrida en `.e2e-screenshots/qa-receipt-delete-ci-fix-20261010-8e1c7023/`.

### QA-RECEIPT.LINE-NOTE.1 · corregir la nota de cada línea en revisión

**Fuente revalidada (2026-10-10):** `HOGARIA-SPEC.md §12aj D` promete revisión por línea de todas sus
propiedades, incluida la nota. La ficha renderiza `linea.note` como texto de solo lectura en la celda del
nombre. El endpoint `PATCH /api/receipts/:id/items/:itemId` ya acepta `note` (máximo 280 caracteres) y
lo persiste; por tanto, el hueco está en la interfaz, no en el contrato de API.

**Contrato:** en `review`, cada línea tiene un control de nota editable dentro de la celda del producto,
precargado con el valor reconocido/editado, nombre accesible ES/EN asociado al producto y contraste
WCAG AA en tema claro/oscuro. Guardar actualiza solo esa línea; una nota vacía se persiste como `null` y
al recargar permanece vacía. En los estados no revisables la nota continúa como texto, sin control de
edición. No se añade columna a la
tabla; el campo permanece en la tarjeta móvil, sin alterar el modelo responsive. Errores de guardado se
notifican y no descartan el texto introducido. Longitud máxima 280, acorde al schema vigente. En móvil,
los inputs de edición de línea comparten un objetivo táctil mínimo de 44×44 px; el guardado funciona por
teclado al abandonar el campo.

- [x] Añadir primero una E2E roja con ticket/línea sintéticos y base aislada: la nota debe ser editable
      en `review`, aceptar creación/edición/borrado, persistir tras reload y no editarse en estado terminal.
- [x] Implementar el control en la celda de nombre, con labels ES/EN, límite de 280 y guardado integrado
      con `editarLinea`; verificar payload PATCH, limpieza a `null`, errores y retención del borrador.
- [x] Ejecutar E2E real de navegador en Chromium y Pixel 5, escritorio 1440×900 y móvil 390×844/320×740;
      revisar teclado, labels, foco, contraste AA claro/oscuro, objetivo táctil ≥44×44 de todos los
      inputs de línea, overflow y geometría sin nueva columna, con capturas sintéticas PC/móvil.
- [x] Ejecutar unitarias focales, `typecheck:e2e`, build, `check:ui`, formato, `git diff --check` y
      coverage ≥70 % en S/B/F/L para cada archivo instrumentable tocado; no llamar a WebAPI/proveedor.
- [x] Registrar comandos/resultados/limitaciones y rollback; commit atómico con hooks, push, CI verde
      para el commit de implementación; PR #41 abierta y sin merge.

**Evidencia TDD y local (2026-10-10):** antes del cambio, la E2E aislada falló **2/2** porque no
existía un control con nombre accesible para la nota en ES/EN. La prueba unitaria roja ejecutó 26 casos
y falló solo el nuevo caso de guardado fallido: `editarLinea` refrescaba aunque `updateLine()` devolvía
`null`, descartando potencialmente el borrador. Ahora la nota es un input con placeholder/label ES/EN,
maxlength 280 y guardado al abandonar el campo; una respuesta fallida muestra el toast y conserva el
texto. `editarLinea` solo refresca tras una respuesta exitosa. En `confirmed`, la nota sigue siendo texto.

El E2E final usa SQLite, cuenta, puertos y servidor temporales; no configura proveedor, no llama WebAPI,
no confirma compras y el cleanup del runner quedó verificado. Comprobó creación, edición, limpieza a
`null`, PATCH 200/body, lectura API y reload, error sintético 503/toast/borrador retenido, estado
terminal, labels ES/EN, teclado Tab/blur, ausencia de overflow en 1440×900, 390×844 y 320×740, y inputs
móviles de línea ≥44×44 px. Comando `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium
--project=mobile-chrome tests/e2e/receipt-line-note.spec.ts --reporter=line`: **4/4**. Capturas de la
tabla sintética, inspeccionadas: `.e2e-screenshots/qa-receipt-line-note-20261010/receipt-line-note-chromium-es.png`,
`receipt-line-note-chromium-en.png`, `receipt-line-note-mobile-chrome-es.png` y
`receipt-line-note-mobile-chrome-en.png`.

`pnpm --filter @hogaria/web exec ng test --no-watch --include
src/app/features/receipts/receipt-detail.component.spec.ts --browsers=ChromeHeadless` pasó **26/26**;
`pnpm --filter @hogaria/web run test` pasó **1297/1297** y coverage global **92.30/83.67/91.06/93.68 %
S/B/F/L**. El reporte focal de `receipt-detail.component.ts` da **98.64/89.15/100/100 % S/B/F/L**.
El comando focal con coverage retorna 1 solo porque el gate global de 80 % se aplica a la selección
parcial; la suite completa sí pasa el gate, que no se rebajó. También pasan `pnpm run typecheck:e2e`,
`pnpm run check:ui` (**212 ficheros, 21 reglas**), `pnpm run build`, Prettier focal y `git diff --check`.
El build conserva warnings previos de imports/presupuesto Angular. El emulador Pixel 5 valida interacción
por teclado sintética, no el teclado software/safe-area de un teléfono real.

El commit de implementación `6fa43c6` se publicó tras pasar Lefthook pre-commit y pre-push, sin
omitir hooks. El pre-push ejecutó formato, `check:ui`, build, typecheck E2E y las suites completas
(cliente **1297/1297**; servidor **1236 pasaron, 1 omitida**). GitHub Actions, run
`38033079862`, quedó verde: Type Check, Production Build, Server Tests, Full-stack E2E y los cuatro
shards E2E. La PR #41 permanece abierta, Ready for review y sin merge.

**Rollback:** revertir solo el control de nota, su prueba y esta subunidad; conservar el contrato API.

### QA-RECIPES.COOKING-CHECKLIST.1 · vista de cocina minimalista (prototipo B)

**Fuente revalidada (2026-10-10):** el detalle de receta existente ya escala cantidades en
`RecipesComponent` usando `recipe.servings` y `recipeServings`, sin persistir ni llamar a IA. Cada
paso con temporizador monta un `TimerComponent` con iniciar/pausar/reanudar/reiniciar/finalizar; la
vista actual es una lista de tarjetas y no ofrece progreso/checklist, foco de paso móvil ni feedback
visible al completar el cronómetro. Contratos relacionados: `HOGARIA-SPEC.md §QA-RECIPE.FULL-DETAIL-VIEW.1`
y `APP-QA-SPEC.md §QA-RECIPES.TIMER-CONTROLS.1`.

**Decisiones confirmadas (2026-10-10):** el usuario eligió el prototipo **B**. Añadir un modo de
cocina accesible desde la ficha completa, sin quitarla ni cambiar sus deep links. En escritorio,
mostrar ingredientes/raciones en una columna lateral y pasos cronológicos como checklist con el
temporizador alineado junto al paso que lo usa. En móvil, enfocar un paso cada vez con progreso
«Paso n de N», acciones anterior/siguiente y posibilidad de marcarlo hecho; conservar acceso a
ingredientes/raciones y a los cronómetros activos. Los cambios del checklist y foco solo viven en la
sesión de cocina y no editan/persisten la receta.

El selector de comensales es un control accesible con decremento/incremento y valor numérico entero
positivo seguro (la misma cota ya aceptada por el schema de receta); cambia cantidades visibles al
instante con `cantidad × comensales / raciones base` (o la
función de escalado ya existente), sin petición IA/API, escritura de receta ni cambio de la ración
base guardada. No se añade un campo redundante «por persona» al esquema: el ratio se deriva de
cantidad+raciones base. Los tiempos de preparación, paso y temporizador siguen siendo los de la
receta; no se multiplican linealmente por comensales, porque el contrato actual no incluye un modelo
de ajuste de tiempo fiable. Al finalizar un temporizador se presenta aviso visible y accesible
`aria-live` asociado al paso; no se pide permiso de notificaciones del sistema ni se reproduce audio.
Cambiar de paso en móvil no pausa ni desmonta otros cronómetros activos. Al salir/cargar de nuevo se
descarta la sesión temporal.

- [x] Añadir primero pruebas rojas de componente y E2E para entrada/salida del modo, checklist/foco,
      navegación entre pasos, actualización inmediata de raciones y preservación de la receta/API.
- [x] Implementar B siguiendo tokens y geometría compartidos: lateral de ingredientes/timer por paso
      en escritorio; un paso enfocado en móvil con progreso, anterior/siguiente y completar. No añadir
      tarjeta/modal decorativa ni eliminar secciones del detalle existente.
- [x] Cubrir temporizadores simultáneos, avance con el reloj controlado, completar/reiniciar,
      notificación visible y `aria-live`; al cambiar foco de paso los otros timers conservan su estado.
- [x] Validar cálculo en raciones 1, base, 20, la cota de enteros seguros e input inválido; cambio de ración no emite tráfico de
      IA/API ni persiste en la receta. Los tiempos existentes no cambian al escalar comensales.
- [x] Ejecutar Playwright con fixture/DB/puertos aislados, proveedor stub sin invocarlo; Chromium
      escritorio 1440×900 y móvil 393×851, 320×568 y 568×320, más bordes de breakpoint. Revisar
      overflow, safe-area disponible, orientación, teclado/foco, nombres/labels, contraste y controles
      táctiles ≥44×44 px. Guardar e inspeccionar capturas sintéticas comparables de PC/móvil.
- [x] Ejecutar unitarias, cobertura ≥70 % S/B/F/L por archivo instrumentable, suite frontend global,
      `typecheck:e2e`, `check:ui`, Prettier, build y `git diff --check`; registrar comandos/evidencia,
      limitaciones nativas de iOS y rollback. No marcar casillas hasta contar con evidencia ejecutada.

**Evidencia QA-RECIPES.COOKING-CHECKLIST.1 (2026-10-10):** las primeras pruebas aisladas
confirmaron que faltaba la entrada accesible al modo. La E2E adicional de salida reprodujo otro fallo:
el detalle retenía temporalmente 3 comensales en vez de volver a las 2 raciones guardadas; ahora la
sesión se reinicia a la base al salir y el E2E verifica el valor y cantidad originales. El foco pasa al
título al entrar y vuelve al botón de modo tras salir. El detalle completo, edición y enlace profundo
se conservan fuera del modo.

La prueba real aislada usa fixture sintético, SQLite/puertos bajo `%TEMP%` y cleanup verificado; no
invoca proveedor/WebAPI ni escribe porciones en la receta. Comando:
`node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/recipe-cooking-checklist.spec.ts --reporter=line`:
**3 passed, 1 omitida** (la variante móvil no se repite en escritorio). Verificó escritorio 1440×900,
móvil 393×851, mínimo 320×568, orientación 568×320 y umbrales 760/761 px; overflow, un único paso
móvil, navegación/checklist, foco con teclado (incluido indicador visible en la casilla), control de
raciones 2→3→20, persistencia/API, timers simultáneos con reloj controlado, pausa y conservación al
cambiar de paso, fin de timer y aviso `status`
`aria-live="polite"`. Los textos medidos de título, instrucción y timer idle/running/paused/finished
superan contraste WCAG AA 4.5:1 en tema claro y oscuro; controles móviles comprobados ≥44×44 px.
El reloj controlado descubrió que reanudar conservaba el número en el timer, pero el resumen volvía
erróneamente a la duración inicial (`00:59` → `02:00`); se añadió primero la regresión y el resumen
ahora conserva el tiempo pausado al reanudar.

`pnpm run test:client`: **1327/1327**, cobertura global **94.76/86.25/94.39/96.10 % S/B/F/L**.
Cobertura por archivo instrumentado: `recipe-cooking-view.component.ts` **100/96/100/100 %**,
`recipes.component.ts` **92.25/87.56/90.83/92.86 %** y `timer.component.ts` **100/100/100/100 %**.
También pasan `pnpm run typecheck:e2e`, `pnpm run check:ui` (**213 ficheros, 21 reglas**),
`pnpm run build`, Prettier, `git diff --check` y la E2E indicada. Build concluye con avisos de
presupuesto Angular: bundle inicial 862.06 kB y estilos inline de `recipes.component.ts` 17.21 kB
(límite 10 kB); no se modifican los límites. Se inspeccionaron las capturas sintéticas
`.e2e-screenshots/qa-recipe-cooking-checklist/chromium-cooking-view.png`,
`mobile-chrome-cooking-view.png` y `mobile-chrome-cooking-step.png`. CSS respeta
`env(safe-area-inset-bottom)`; Chromium emulado no valida el safe-area ni teclado software de un móvil
nativo. La sesión se descarta al salir/cargar; tiempos no se escalan.

**Rollback:** revertir la entrada/vista de cocina, el estado efímero/checklist, los avisos y sus
pruebas/traducciones; mantener intactos los datos y la vista de receta existente.
