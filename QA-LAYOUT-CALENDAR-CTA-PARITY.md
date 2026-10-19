# Subunidad QA-LAYOUT.VISUAL-CONSISTENCY.CALENDAR-CTA.1

## Fuente y decisión

La unidad global activa `APP-QA-SPEC.md` (`QA-LAYOUT.VISUAL-CONSISTENCY.1`) exige que el énfasis de
un CTA sea visual, no geométrico. El subapartado de la barra de Calendario dejó sus controles en 48 px,
pero `app-button` define el botón de texto compartido en 44 px. La captura del usuario pidió que
«Planificar IA» no destaque por tamaño y que los componentes equivalentes mantengan exactamente las
mismas dimensiones.

La medición E2E inicial reprodujo la discrepancia en Chromium y Pixel 5: `Planificar IA` medía 48 px y
tenía radio 9999 px; el CTA primario de Recetas medía 44 px y radio 12 px. Padding (8/16 px), fuente,
peso, interlineado, separación e incluso margen coincidían. La regresión quedó añadida al E2E.

**Contrato actualizado:** los botones de texto primarios comparten el contrato geométrico canónico de
`app-button`: alto mínimo 44 px, padding vertical/horizontal 8/16 px, fuente sans de 14 px/peso 500,
interlineado 14 px, gap 8 px, borde de 1 px, radio 12 px y márgenes cero. La etiqueta determina solo
el ancho natural. «Planificar IA» puede destacarse por color/estado, no por altura, padding o radio.
Los controles icon-only son otra familia y deben conservar caja cuadrada y target táctil ≥44×44 px.
Este addendum sustituye expresamente el alto/radio 48 px/full del subapartado previo del calendario.

## Checklist

- [x] Publicar la regresión E2E que compara «Planificar IA» con el CTA primario de Recetas, sin
      incluir el ancho natural de etiquetas en la igualdad; el test falló antes del cambio y pasa
      después.
- [x] Alinear los botones textuales de la barra del calendario al contrato compartido de 44 px/12 px;
      conservar la diferencia de color y el target cuadrado de controles icon-only.
- [x] Ejecutar Chromium escritorio y Pixel 5 con 320×568, 393×851, 568×320, 767/768/769,
      1023/1024/1025 y 1440 px; comparar alto, padding, fuente, interlineado, gap, márgenes, borde y
      radio con tolerancia de 1 CSS px; comprobar navegación por teclado, foco y ausencia de overflow
      horizontal del documento. La línea de tiempo mantiene su scroll horizontal interno esperado.
- [x] Guardar e inspeccionar capturas sintéticas PC/móvil; ejecutar typecheck E2E, prueba geométrica
      completa de la barra, `check:ui`, build y `git diff --check`. La cobertura S/B/F/L es N/A porque
      esta corrección es CSS sin lógica instrumentable; no rebajar gates globales.

## Evidencia

- `node scripts/run-isolated-playwright.mjs --workers=1 --project=chromium --project=mobile-chrome tests/e2e/ui-geometry-consistency.spec.ts --reporter=dot` — 4 passed; base de datos SQLite
  temporal y servidor aislado limpiados por el runner.
- `node node_modules/typescript/bin/tsc -p tsconfig.e2e.json --noEmit`, `pnpm run check:ui` y
  `git diff --check` — correctos.
- `pnpm run build` — completado. Angular mostró advertencias de presupuesto/tamaño y avisos
  existentes de componentes/optional chaining no usados, sin errores de build.
- Capturas sintéticas revisadas: `.e2e-screenshots/qa-calendar-cta-parity/calendar-cta-desktop.png`
  y `calendar-cta-mobile.png`.

## Rollback

Revertir solo el token/reglas geométricas de la barra y la regresión E2E añadida por esta unidad; no
revertir la familia compartida de botones ni otras correcciones de layout.
