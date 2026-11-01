# E2E: lecturas de listas al cambiar de hogar

## Evidencia vigente

- En CI, `shopping-view-order.spec.ts` falló porque contó un GET válido a la lista del hogar anterior antes de que el servidor confirmara el cambio de hogar. El trace muestra el GET (`200`) a las `21:10:37.276Z` y el `POST /api/household/active` posterior a las `21:10:37.862Z`.
- La aserción ya verifica que, tras el cambio, ni la lista anterior ni sus productos aparecen en pantalla. No hay evidencia de fuga ni de regresión de producto.

## Criterios de aceptación

- [x] El test solo contabiliza GETs de la lista anterior iniciados después de la respuesta `200` del cambio de hogar.
- [x] Tras cambiar de hogar, la lista y productos anteriores siguen ausentes de la UI y no se solicitan de nuevo.
- [x] La regresión dirigida pasa en Chromium con DB aislada y la suite CI vuelve a pasar.

## Verificación

- Antes del ajuste, la prueba dirigida local pasó 1/1; el trace de CI confirmó que la ventana medida por el test incluía una lectura anterior al cambio.
- Después del ajuste: `node scripts/run-isolated-playwright.mjs tests/e2e/shopping-view-order.spec.ts --grep 'switching homes hides a shopping list from the previous home and restores it when selected' --project=chromium --workers=1 --forbid-only` — 1/1.
- GitHub Actions run `41351821237` en `0df6a28` — todos los checks pasaron, incluido el shard 4 que reproducía el falso positivo.
