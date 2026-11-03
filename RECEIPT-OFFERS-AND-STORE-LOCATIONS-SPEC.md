# Ofertas de ticket y ubicaciones de tienda

**Estado:** ampliación implementada y validada localmente en PR #72; queda subir commits y confirmar CI. Se conserva el estado Ready del PR.
**Base:** `origin/master` en `a0a9f09137d8c5f20e13884cc80dce03d9844449` (incluye PR #70 y la spec inicial).
**Rama:** `feat/calendar-recipe-cooking` (PR consolidado #72; #71 queda como duplicado).
**Objetivo:** edición visual de promociones por línea y persistencia de la sucursal exacta asociada al ticket/precios.

## Evidencia vigente

- La revisión de ticket muestra `offer` como un input de texto (`3x2`); el parser frontend solo acepta `buy/take`.
- `receipt_items` solo persiste `offer_buy` y `offer_take`. El contrato de ticket usa ese mismo formato.
- La compra ya define presets (`3x2`, `2x1`, `4x3`, `5x4`) y descuentos por porcentaje/importe/unidades afectadas. La spec principal describe ese modelo Basketra-style en `HOGARIA-SPEC.md`, sección «Discounts and offers, Basketra-style».
- El ticket solo extrae el nombre de tienda. `receipts` no tiene dirección ni coordenadas; `price_observations` guarda únicamente `store_name`, así que no distingue sucursales.
- OpenStreetMap Nominatim permite uso externo moderado con máximo 1 req/s, `User-Agent` identificable, atribución, caché y capacidad de cambiar de servicio. No admite autocomplete con el servicio público. Solo se enviará el domicilio comercial detectado/editado, nunca la foto, el contenido completo del ticket ni datos de la cuenta.

## Decisiones

1. El editor del ticket ofrece botones/presets y campos tipados; no exige escribir expresiones como `3x2`. Presets de un toque: `3x2`, `2x1`, `4x3`, `5x4`; también formato personalizado `buy/take`.
2. La promoción de línea tiene una sola modalidad activa: oferta por cantidad (`buy/take`, como `3x2`) o descuento directo (`percent` o `amount`). El formulario de descuento permite escoger las unidades afectadas. `percent` se calcula sobre el subtotal de esas unidades; `amount` es el descuento total en céntimos para esas unidades, no por unidad. Se elimina la modalidad de «precio unitario final»: Basketra solo ofrece porcentaje/importe y no forma parte de lo pedido. `priceMinor` del ticket continúa siendo el total realmente pagado por toda la línea; la promoción es informativa y nunca vuelve a restarse.
3. La IA extrae solo la dirección literal visible (`storeAddress`), sin inventar coordenadas. Un geocodificador de servidor común resuelve coordenadas tanto tras la lectura IA como al guardar una dirección manual, evitando dos flujos distintos.
4. Una ubicación es sucursal, no marca: dos tiendas con igual nombre y dirección distinta deben persistir como ubicaciones distintas. Cada ticket conserva nombre y dirección/coordenadas como snapshot, además de la referencia opcional a la sucursal; las observaciones nuevas de precio se vinculan a esa sucursal y conservan el nombre snapshot existente. No se asignan tickets/precios legacy a una sucursal solo por coincidir el nombre, porque puede ser ambiguo.
5. Geocodificación nunca bloquea la lectura/guardado: si no encuentra o el servicio falla, conservar nombre/dirección y dejar coordenadas vacías con estado seguro reintentable. No sustituir una ubicación manual por una dirección IA posterior.
6. Configuración del geocoder intercambiable por entorno, petición server-side identificada, rate-limit global de 1 req/s, cache por dirección normalizada y atribución OSM visible. Sin autocomplete ni geocodificación en cada tecla.
7. La UI queda integrada con el sistema visual/i18n actual, usable con teclado y móvil. El mapa queda fuera de alcance; se persisten datos listos para usarlo después.
8. Los valores de descuento se introducen numéricamente, mayores que cero y con hasta dos decimales; el porcentaje debe ser estrictamente menor que 100 %. El importe no tiene un máximo de producto adicional.
9. Al leer un ticket, la IA reutiliza una categoría existente cuando encaja. Si un producto pertenece claramente a una familia ausente (por ejemplo, cuidado personal, limpieza o papel del hogar), propone una categoría legible con `createCategory: true`; el servidor la crea/reutiliza de forma idempotente y solo en el catálogo del hogar del ticket. Si OCR/modelo devuelve `other` para abreviaturas reconocibles, el servidor rescata de forma conservadora familias de cuidado personal, limpieza y papel. No se guardan como «Otros» productos reconocibles solo porque no sean alimentos. Por seguridad, se crean como máximo 12 categorías nuevas por ticket.
10. El selector de categoría de cada línea de ticket debe poder abrirse desde las últimas filas sin que la tabla recorte el buscador ni las opciones; el panel flotante se mantiene dentro del viewport también en móvil.

## Criterios de aceptación

### Ofertas en líneas

- [x] El editor sustituye el campo libre por selector visual; incluye presets one-tap `3x2`, `2x1`, `4x3`, `5x4` y alternativa personalizada.
- [x] Se puede configurar descuento porcentual o importe exacto, limitarlo a N unidades y aplicar presets de oferta `3x2`, `2x1`, `4x3`, `5x4` con una acción; editar, limpiar y volver a abrir conserva exactamente la configuración.
- [x] Para un importe, la UI deja claro que se descuenta una cantidad total de las unidades seleccionadas; el porcentaje se aplica al subtotal de esas unidades. Los controles muestran el resumen y el efecto antes de guardar.
- [x] IA, API, SQLite y DTO validan/persisten tipos y límites; trabajos/tickets legacy con solo `offer_buy/take` siguen leyéndose igual.
- [x] El precio registrado sigue siendo el importe realmente pagado en el ticket; descuentos informativos no cambian el total ni producen doble descuento.
- [x] Pruebas cubren presets, valores inválidos, límites, redondeo/moneda, unidades parciales, lectura legacy y seguridad de alcance usuario/hogar.
- [x] El campo de importe/porcentaje es numérico, acepta hasta dos decimales, rechaza cero/negativos y porcentajes de 100 o más; contrato de API rechaza porcentajes de 100 %.

### Categorías de productos en tickets

- [x] El prompt prioriza categorías adecuadas del catálogo; productos claros de cuidado personal/aseo/limpieza no se envían a `other` si falta una categoría útil. Una clasificación en `other` para productos reconocibles (gel de aloe, hidratante, dentífrico, rollos multiuso y detergente) se corrige en servidor.
- [x] Solo una propuesta válida con `createCategory: true` crea una categoría legible, con clave/color derivados en servidor, dentro del hogar correcto; la creación es idempotente, limitada a 12 familias nuevas por ticket y aparece en el selector de revisión.
- [x] Confirmar el ticket conserva la categoría creada. Categorías desconocidas sin propuesta explícita o propuestas inválidas siguen cayendo de forma segura en «Otros».
- [x] Pruebas de prompt y worker cubren una categoría nueva propuesta, categoría ya existente, repetición sin duplicados, límite de 12, alcance del hogar y confirmación.

### Selector de categorías

- [x] El selector usa el panel flotante existente para escapar del `overflow` de la tabla; una prueba con el selector de la última fila comprueba buscador, foco, teclado y opciones en viewport en escritorio, móvil, apaisado y ancho mínimo de 320 px.

### Dirección y sucursal

- [x] El esquema IA acepta dirección opcional sin lat/lon; campo ausente/ilegible se representa null y no se inventa.
- [x] Una resolución de ubicación común se usa desde el worker IA y desde edición manual; dirección unchanged reutiliza cache, dirección cambiada vuelve a resolver.
- [x] Persistir dirección y coordenadas opcionales por ticket/sucursal; sucursales con nombre igual y dirección distinta se conservan separadas. Las price observations nuevas quedan asociadas a la sucursal, sin atribuir historiales legacy ambiguos.
- [x] Fallos, timeout, `429`, `404`/sin resultado y respuesta malformada del geocoder mantienen ticket y dirección; coordenadas permanecen null, sin almacenar errores o mensajes remotos crudos.
- [x] Nominatim público (si se usa) respeta 1 req/s, `User-Agent`, atribución, caché, endpoint configurable y nunca recibe fotos, prompts, tokens, nombres de usuario ni datos del hogar.
- [x] Pruebas cubren autorización/aislamiento, migración de DB existente, carrera de dirección manual vs respuesta IA tardía, geocoding cacheado y proveedor externo simulado.

### Navegador y calidad

- [x] Playwright real con server y SQLite temporal recorre edición/guardado/recarga de promoción y dirección, más selector de categoría en escritorio/móvil; ningún dato personal o secreto en artefactos.
- [x] Capturas comparables de PC/móvil, geometría de controles equivalente (±1 CSS px; `app-input` mantiene 42 px), foco/teclado y targets de acción revisados.
- [ ] Tests/build/gates remotos de CI pasan; umbral existente de coverage se conserva.

## Plan por unidades

1. Modelo/API/migración de ofertas y sucursales, con TDD.
2. Resolver geográfico reutilizable, configuración, caché/rate-limit y tolerancia a fallos.
3. Contrato de extracción IA para dirección; worker resuelve sucursal con el mismo servicio que PATCH manual.
4. UI de ofertas, domicilio y categorías; integración, accesibilidad y E2E real aislado.

## Evidencia de implementación

- Suites server focales: `receipts.routes.spec.ts`, `receipts.schema.spec.ts`, `database.spec.ts`, `store-geocoder.spec.ts`, `ticket-prompt.spec.ts` y `ticket-geocoding.integration.spec.ts`; 98 tests pasaron.
- Playwright real `tests/e2e/receipt-line-note.spec.ts`: ofertas y dirección en Chromium escritorio/móvil, español/inglés; guardado, recarga, preview, teclado, accesibilidad, overflow, targets táctiles y geometría. Capturas en `.e2e-screenshots/receipt-offers/` y `.e2e-screenshots/receipt-store-address/`.
- Coverage con DB en memoria: server 89,51 % sentencias, 81,77 % ramas, 95,69 % funciones y 92,39 % líneas; frontend 90,53 %, 80,97 %, 91,99 % y 93,14 %.
- `pnpm run build`, `pnpm run typecheck:e2e` y `pnpm run check:ui`: verdes. CI pendiente del push consolidado a PR #72.
- Limitación local ajena al alcance: el lint de frontend no completa porque falta `@angular-eslint/builder:lint`; el script server usa `--ext`, incompatible con ESLint 9, y no hay config server detectable. CI no ejecuta lint.

### Ampliación feedback (categorías, selector y valores numéricos)

- `pnpm run test:coverage`: cliente 1.828 tests, statements 90,56 %, branches 81,13 %, functions 91,99 %, lines 93,15 %; servidor 2.237 tests (+ 1 skip), statements 89,50 %, branches 81,75 %, functions 95,70 %, lines 92,40 %. Umbrales locales superados.
- `pnpm run test:e2e -- --grep "selector de categoría|persiste unidad y oferta"`: 9/9 Playwright pass con app y SQLite aisladas; cubre escritorio Chromium, móviles Chrome/Safari, inglés/español, 320 px, apaisado, teclado y persistencia numérica. Un run intermedio falló por CORS transitorio en Safari; el rerun completo pasó 9/9.
- `pnpm run test:config`, `pnpm run typecheck:e2e`, `pnpm run check:ui`, `pnpm run build`, Prettier y `git diff --check`: verdes.
- Capturas sintéticas PC/móvil del selector y editor numérico en `.e2e-screenshots/receipt-category-picker/` (ignorado por Git).
- CI remoto pendiente tras el push. La workflow activa cubre typecheck E2E, UI rules, server coverage y build; no tiene paso de lint.
