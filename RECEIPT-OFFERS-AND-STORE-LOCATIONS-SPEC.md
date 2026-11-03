# Ofertas de ticket y ubicaciones de tienda

**Estado:** spec publicada; implementación pendiente.
**Base:** `origin/master` en `a0a9f09137d8c5f20e13884cc80dce03d9844449` (incluye PR #70 y la spec inicial).
**Rama:** `feat/receipt-offers-store-location`.
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

## Criterios de aceptación

### Ofertas en líneas

- [ ] El editor sustituye el campo libre por selector visual; incluye presets one-tap `3x2`, `2x1`, `4x3`, `5x4` y alternativa personalizada.
- [ ] Se puede configurar descuento porcentual o importe exacto, limitarlo a N unidades y aplicar presets de oferta `3x2`, `2x1`, `4x3`, `5x4` con una acción; editar, limpiar y volver a abrir conserva exactamente la configuración.
- [ ] Para un importe, la UI deja claro que se descuenta una cantidad total de las unidades seleccionadas; el porcentaje se aplica al subtotal de esas unidades. Los controles muestran el resumen y el efecto antes de guardar.
- [ ] IA, API, SQLite y DTO validan/persisten tipos y límites; trabajos/tickets legacy con solo `offer_buy/take` siguen leyéndose igual.
- [ ] El precio registrado sigue siendo el importe realmente pagado en el ticket; descuentos informativos no cambian el total ni producen doble descuento.
- [ ] Pruebas cubren presets, valores inválidos, límites, redondeo/moneda, unidades parciales, lectura legacy y seguridad de alcance usuario/hogar.

### Dirección y sucursal

- [ ] El esquema IA acepta dirección opcional sin lat/lon; campo ausente/ilegible se representa null y no se inventa.
- [ ] Una resolución de ubicación común se usa desde el worker IA y desde edición manual; dirección unchanged reutiliza cache, dirección cambiada vuelve a resolver.
- [ ] Persistir dirección y coordenadas opcionales por ticket/sucursal; sucursales con nombre igual y dirección distinta se conservan separadas. Las price observations nuevas quedan asociadas a la sucursal, sin atribuir historiales legacy ambiguos.
- [ ] Fallos, timeout, `429`, `404`/sin resultado y respuesta malformada del geocoder mantienen ticket y dirección; coordenadas permanecen null, sin almacenar errores o mensajes remotos crudos.
- [ ] Nominatim público (si se usa) respeta 1 req/s, `User-Agent`, atribución, caché, endpoint configurable y nunca recibe fotos, prompts, tokens, nombres de usuario ni datos del hogar.
- [ ] Pruebas cubren autorización/aislamiento, migración de DB existente, carrera de dirección manual vs respuesta IA tardía, geocoding cacheado y proveedor externo simulado.

### Navegador y calidad

- [ ] Playwright real con server y SQLite temporal recorre edición/guardado/recarga de promoción y dirección en escritorio/móvil; ningún dato personal o secreto en artefactos.
- [ ] Capturas comparables de PC/móvil, geometría de controles equivalente (±1 CSS px), foco/teclado y targets táctiles revisados.
- [ ] Tests/build/gates de CI pasan; umbral existente de coverage se conserva.

## Plan por unidades

1. Modelo/API/migración de ofertas y sucursales, con TDD.
2. Resolver geográfico reutilizable, configuración, caché/rate-limit y tolerancia a fallos.
3. Contrato de extracción IA para dirección; worker resuelve sucursal con el mismo servicio que PATCH manual.
4. UI de ofertas y domicilio; integración, accesibilidad y E2E real aislado.
