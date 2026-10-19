import { expect, type Locator } from '@playwright/test';

/**
 * Cambia las filas por pagina desde el picker del pie (## 12ad): los botones `tabla-tamano-<n>` estan
 * jubilados. Ratón primero, que es el gesto de siempre; si el hit-test no cuaja (en movil el pie de la
 * tarjeta roza con el borde de la ultima fila), se cae al teclado del picker, que no pisa geometria.
 */
export async function ponTamano(tabla: Locator, n: number): Promise<void> {
  // Los avisos de alta tapan un rato el pie de la tarjeta (en movil, con la nav debajo): cola apagada antes.
  await expect(tabla.page().locator('.toast-container .toast')).toHaveCount(0, { timeout: 90_000 });
  const tam = tabla.locator('[data-test="tabla-tamano"]');
  const panel = tam.locator('.picker__panel');
  const wanted = `${n} por p\u00e1gina`;
  const trig = tam.locator('.picker__trigger');
  await trig.scrollIntoViewIfNeeded();
  const aCuerpo = await trig
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!aCuerpo) {
    await trig.focus();
    await trig.press('Enter');
  }
  await expect(panel).toBeVisible();
  if (aCuerpo) {
    const opcion = tam.locator('.picker__option').filter({ hasText: wanted }).first();
    const pulsada = await opcion
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (pulsada) {
      await expect(panel).toBeHidden();
      return;
    }
  }
  for (let i = 0; i < 8; i++) {
    const activo = ((await tam.locator('.picker__option--active').textContent()) ?? '').trim();
    if (activo === wanted) break;
    await tam.page().keyboard.press('ArrowDown');
  }
  await expect(tam.locator('.picker__option--active')).toHaveText(wanted);
  await tam.page().keyboard.press('Enter');
  await expect(panel).toBeHidden();
}
