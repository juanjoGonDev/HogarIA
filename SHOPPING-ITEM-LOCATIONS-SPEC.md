# Ubicación de productos en la lista de la compra

**Estado:** implementación local verificada; CI remoto pendiente.
**Rama:** `feat/calendar-recipe-cooking` (PR #72 Draft).
**Fecha:** 2026-11-04.

## Objetivo

Permitir asociar una tienda/establecimiento a productos añadidos desde una foto o marcados como comprados. La ubicación es opcional, requiere confirmación explícita y usa un único flujo reutilizable para detectar, elegir y editar el establecimiento.

## Evidencia vigente

- `HOGARIA-SPEC.md`, §8e, define el gesto de fila/checkbox para marcar producto y el uso principal de la lista en móvil.
- `frontend/src/app/features/shopping/shopping-list-detail.component.ts` mantiene la cámara, revisión del borrador y aplicación explícita; la IA no escribe productos antes de que la persona confirme.
- `shopping_list_items` no almacena ubicación. Ya existe `stores`, scoped por usuario/hogar y con nombre, dirección, coordenadas y atribución.
- `store-geocoder` resuelve direcciones manuales en servidor. No se usa reverse-geocoding para deducir una tienda.
- No existe un contrato activo para ubicación de productos de compra; este archivo pasa a ser su fuente vigente.

## Decisiones

1. La ubicación nunca se consulta en segundo plano ni por el mero hecho de capturar/subir una foto. Tras aplicar las líneas revisadas de la foto, o al marcar individualmente un producto como comprado, se ofrece «¿Añadir ubicación?». El aviso explica que, al aceptar, la ubicación aproximada podrá enviarse a OpenStreetMap si no hay coincidencia local. «Ahora no» conserva el alta/marcado y no solicita permisos ni envía coordenadas.
2. Una sola hoja/componente de ubicación se comparte entre foto, marcado y edición manual de ubicación. Gestiona consentimiento, permisos nativos, detección, selección y corrección; no se crean flujos paralelos por origen.
3. Solo tras aceptar se consulta `navigator.geolocation`. Si el permiso se deniega, la API no existe, expira o falla, se mantiene la acción original y se ofrece edición manual en la misma hoja. Rechazar ubicación nunca desmarca ni elimina productos.
4. Con coordenadas obtenidas, primero se comparan establecimientos ya registrados en el alcance usuario/hogar. Si no hay coincidencia cercana, el servidor puede consultar OpenStreetMap Overpass como detección online de mejor esfuerzo; una lista de candidatos ambigua requiere selección humana. Nunca se guarda una ubicación distinta de la candidata elegida.
5. Overpass es opcional e intercambiable por configuración. Consultas pequeñas de establecimientos próximos, límite de radio/candidatos, timeout, caché, `User-Agent` identificable y limitación de concurrencia/ritmo son obligatorios. El servicio público puede saturarse y no es garantía de disponibilidad; error, `429`, timeout o resultado vacío llevan a edición manual, sin bloquear compra ni lista. Véase [Overpass API: instancias públicas y políticas](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
6. Los datos externos se solicitan solo tras consentimiento, desde servidor, con coordenadas y radio estrictamente necesarios. No se envían foto, líneas de compra, nombre de cuenta, hogar, tokens ni prompts a Overpass o a IA. Esta función no usa IA para localizar tiendas.
7. Se persiste en cada producto una referencia opcional a la tienda y un snapshot de nombre, dirección, coordenadas del establecimiento y atribución/fuente. No se persiste la coordenada GPS exacta del dispositivo salvo que coincida con coordenadas oficiales de la tienda seleccionada. La ubicación manual puede quedar sin coordenadas si no hay dirección resoluble.
8. La edición manual permite corregir nombre/dirección de la tienda desde la misma hoja; guardar una dirección puede reutilizar `store-geocoder`. Los errores de geocodificación conservan texto manual y no impiden guardar.
9. Un lote confirmado desde foto aplica la tienda elegida a las líneas afectadas (creadas o fusionadas); marcar varios productos mediante acción masiva no abre varias hojas ni consulta ubicación. El marcado individual sí ofrece la hoja una vez. Desmarcar no vuelve a preguntar.
10. Atribuir resultados OSM de forma visible y persistir enlace/atribución con la ubicación. No mostrar mapa en esta unidad.

## Criterios de aceptación

### Flujo funcional y privacidad

- [x] Tras aplicar una revisión de foto, mostrar una sola pregunta opcional; aceptar abre el selector compartido y «Ahora no» mantiene líneas añadidas sin permiso, geolocalización ni llamada externa.
- [x] Marcar un producto individual muestra la misma pregunta/hoja una sola vez; aceptar permite asociar ubicación y cancelar mantiene producto marcado. Desmarcar y marcado masivo no abren preguntas duplicadas.
- [x] La geolocalización nativa se invoca solo tras consentimiento; denegación, timeout, API ausente y cancelación permiten continuar o escribir ubicación manual.
- [x] Coincidencias registradas se limitan al usuario/hogar activo. Sin coincidencia, búsqueda OSM es best-effort y presenta resultados cercanos seleccionables; no guarda una sugerencia ambigua sin selección.
- [x] La misma hoja permite corregir manualmente nombre/dirección y volver a guardar la ubicación desde la edición del producto.
- [ ] Solo se guardan ubicaciones elegidas; no se persisten coordenadas GPS crudas. El producto mantiene snapshots legibles tras recarga, cambio de hogar y actualización de datos de tienda. (Recarga y actualización de tienda validadas; falta prueba explícita de cambio de hogar.)
- [x] API valida límites y coordenadas, aplica autorización/aislamiento, no permite asociar tiendas ajenas y no registra ubicación precisa en logs.
- [x] Timeout, límite/`429`, error, respuesta inválida o lista vacía de Overpass dejan disponible la ruta manual y no bloquean las operaciones de lista.

### Pruebas y calidad

- [ ] TDD: pruebas de esquema/migración, autorización, deduplicación, guardado/lectura, proveedor OSM simulado, caché, límites, errores y ubicación manual antes de implementar.
- [x] Pruebas frontend cubren flujo compartido, consentimiento, denegación/fallo, cancelación, corrección y prevención de prompts duplicados.
- [x] Playwright real contra app y servidor con SQLite temporal: alta por foto y marcado individual, ubicación online simulada, manual, recarga y fallback; prueba de tienda registrada en unit/API.
- [x] Coverage supera 70 % en sentencias, ramas, funciones y líneas; gates existentes permanecen intactos.
- [x] Revisar escritorio y móvil en 1440×900, 390×844 y ancho mínimo 320 px, incluyendo apaisado, teclado/foco, hoja/modal, scroll, safe-area y targets táctiles.
- [ ] Capturas sintéticas guardadas en `.e2e-screenshots/shopping-item-locations/` (ignoradas por Git); falta registrar comparación geométrica explícita ±1 CSS px entre orígenes.
- [ ] Ejecutar suites focales, build, typecheck, UI gates y CI del PR; registrar comandos, resultados y limitaciones antes de marcar casillas. (Pruebas locales verdes; CI remoto y comparación geométrica pendientes.)

## Plan por unidades

1. Contrato de datos, migración y API validada para detección/selección/guardado, con pruebas primero.
2. Hoja compartida y servicio de ubicación con permiso explícito, tiendas registradas, Overpass configurable/cacheado y edición manual.
3. Integrar foto, marcado individual y edición; conservar acciones cuando se omite/falla ubicación.
4. E2E real, capturas, revisión geométrica y gates completos.

## Evidencia local — 2026-11-04

- `pnpm --filter @hogaria/server exec vitest run --maxWorkers=2 src/config/database.spec.ts src/routes/shopping.routes.spec.ts`: 126/126.
- `node scripts/run-isolated-playwright.mjs --config=playwright.full-stack.config.ts full-stack/shopping-item-location.spec.ts full-stack/shopping-photo-review.spec.ts`: 4/4 en Chromium escritorio y mobile Chrome; backend real, SQLite temporal, producto reabierto tras reload y flujo de foto/omisión sin permiso ni llamadas de ubicación.
- `pnpm run test:client:coverage`: 1837/1837; 90.49 % statements, 80.96 % branches, 92.02 % functions, 93.12 % lines.
- `pnpm run test:server:coverage`: 2259 pasados, 1 omitido; 89.52 % statements, 81.76 % branches, 95.47 % functions, 92.41 % lines. `store-locator.ts`: 87.97/86.4/84.84/90.51 % (S/B/F/L).
- `pnpm run check:ui` (278 ficheros/21 reglas), `pnpm run typecheck:e2e` y `pnpm run test:config` (146/146) pasan. `pnpm run build` pasó antes de estos últimos cambios, que solo añaden pruebas/criterios; CI lo revalidará.
- Capturas sintéticas: `prompt-desktop-1440x900.png`, `prompt-mobile-390x844.png`, `prompt-mobile-320x568.png`, `candidate-desktop-1440x900.png`, `candidate-mobile-390x844.png`, `edit-desktop-1440x900.png`, `edit-mobile-390x844.png`. `git check-ignore` confirma que no entran en Git.
- Limitaciones por cerrar: cambio de hogar explícito, comparación geométrica de ±1 CSS px y CI remoto verde tras el fix de locators del run #1146. PR #72 sigue Draft.
