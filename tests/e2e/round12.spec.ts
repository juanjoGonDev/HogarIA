import { Page, test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';
import { selectCalendarView } from './helpers/calendar-ui';

/** Un `pageerror` en la consola es un fallo, aunque la pantalla parezca buena (costumbre de la suite). */
function watchPageErrors(page: Page): () => string {
  const errors: string[] = [];
  page.on('pageerror', (event) => errors.push(String(event.message).split('\n')[0]));
  return () => (errors.length > 0 ? errors.join(' | ') : 'sin errores de pagina');
}

/**
 * Ronda 12. Dos cosas que la app hacia mal por el mismo vicio: apagar un modulo ocultaba una vista
 * que es de toda la casa (el calendario), y un chip de «quitar» se pintaba igual que un chip de
 * «poner». Las dos se comprueban aqui de punta a punta, con el servidor detras. La cuenta y su
 * avatar se fueron a `account.spec.ts` cuando /account tuvo pagina propia (ronda 13).
 */
test.describe('el calendario es de la casa, no de la cocina', () => {
  test('con la cocina apagada queda la agenda, y no quedan los botones de comer', async ({ page }) => {
    const echo = watchPageErrors(page);
    await registerAndGoto(page, '/settings', 'r12-cal-settings');

    await page.locator('[data-module-switch="meals"]').click();
    await expect(page.locator('[data-module-switch="meals"]')).toHaveAttribute('aria-checked', 'false');

    // La agenda de la casa sigue donde estaba: apagar la cocina no la borra del menu.
    await expect(page.locator('a[href="/calendar"]')).not.toHaveCount(0);
    // Y lo que si se va es la receta, que es de la cocina.
    await expect(page.locator('a[href="/recipes"]')).toHaveCount(0);

    await page.goto('/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await expect(page.locator('[data-test="event-add"]')).toBeVisible();
    await expect(page.locator('[data-test="agenda"]')).toBeVisible();

    // Lo especifico de la cocina, fuera: la capa de comidas, el objetivo y el planificador.
    await expect(page.locator('[data-test="layer-meals"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Planificar IA/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Objetivo/ })).toHaveCount(0);
    // La franja del periodo no miente con un «0 / 0 comidas»: no esta.
    await expect(page.locator('.cal-strip__label', { hasText: 'Comidas' })).toHaveCount(0);

    // Un apunte de la casa se sigue pudiendo anotar y leer, sin cocina y sin recargar.
    await page.locator('[data-test="event-add"]').click();
    await page.locator('[data-test="event-title"]').fill('Revisar la caldera');
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('[data-test="household-event"]')).toContainText('Revisar la caldera');

    // Las vistas siguen vivas: la rejilla del mes no pinta platos, pero pinta el dia.
    await selectCalendarView(page, 'month', 'Mes');
    await expect(page.locator('.cal-cell')).not.toHaveCount(0);
    await expect(page.locator('.cal-cell__plus')).toHaveCount(0);
    await selectCalendarView(page, 'week', 'Semana');
    // Sin la capa de cocina no hay ni un sitio donde anadir un plato: la rejilla sigue ahi (es la
    // agenda), pero no sus controles de comida.
    await expect(page.locator('[data-test="timeline-col"]')).not.toHaveCount(0);
    await expect(page.locator('[data-test="timeline-add-meal"]')).toHaveCount(0);

    // Y una URL con la capa de comidas escrita a mano no rompe nada: se ignora.
    await page.goto('/calendar?view=week&layers=meals,home');
    await expect(page.locator('[data-test="layer-meals"]')).toHaveCount(0);
    await expect(page.locator('[data-test="timeline-add-meal"]')).toHaveCount(0);
    expect(echo()).toBe('sin errores de pagina');
  });
});

test.describe('los chips de quitar se leen como lo que son', () => {
  test('«Sin oferta» y «Sin descuento» son de quite, y reclicar el activo lo apaga', async ({ page }) => {
    const echo = watchPageErrors(page);
    await registerAndGoto(page, '/shopping', 'r12-chips');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Chips');
    await page.locator('[data-test="create-submit"]').click();
    await page.locator('[data-test="add-input"]').fill('2 Yogur');
    await page.locator('[data-test="add-submit"]').click();

    await page.locator('[data-test="item-row"]').first().getByRole('button', { name: 'Acciones de la linea' }).click();
    const sheet = page.locator('[data-test="edit-sheet"]');

    // «Sin oferta» solo existe cuando hay oferta, y se pinta como un quite (borde discontinuo).
    await expect(sheet.locator('[data-test="offer-clear"]')).toHaveCount(0);
    const offer = sheet.locator('[data-test="offer-preset"]', { hasText: '2x1' });
    await expect(offer).toHaveAttribute('aria-pressed', 'false');
    await offer.click();
    await expect(offer).toHaveAttribute('aria-pressed', 'true');
    await expect(offer).toHaveClass(/detail__chip-btn--active/);
    await expect(sheet.locator('[data-test="offer-clear"]')).toHaveClass(/detail__chip-btn--clear/);

    // Reclicar la oferta activa la quita: no hace falta irse al chip de limpiar.
    await offer.click();
    await expect(offer).toHaveAttribute('aria-pressed', 'false');
    await expect(offer).not.toHaveClass(/detail__chip-btn--active/);
    await expect(sheet.locator('[data-test="offer-clear"]')).toHaveCount(0);

    // Descuento de la linea: «Sin descuento» tampoco es un estado, y el tipo activo se apaga.
    const none = sheet.locator('[data-test="line-discount-kind"]', { hasText: 'Sin descuento' });
    await expect(none).toHaveClass(/detail__chip-btn--clear/);
    await expect(none).not.toHaveClass(/--active/);
    const percent = sheet.locator('[data-test="line-discount-kind"]', { hasText: 'Porcentaje' });
    await percent.click();
    await expect(percent).toHaveClass(/detail__chip-btn--active/);
    await expect(sheet.locator('[data-test="line-discount-percent"]')).toBeVisible();
    await percent.click();
    await expect(percent).not.toHaveClass(/detail__chip-btn--active/);
    await expect(sheet.locator('[data-test="line-discount-percent"]')).toHaveCount(0);

    await sheet.getByRole('button', { name: /Hecho/i }).click();
    await page.reload();
    await expect(page.locator('[data-test="offer-chip"]')).toHaveCount(0);
    expect(echo()).toBe('sin errores de pagina');
  });
});
