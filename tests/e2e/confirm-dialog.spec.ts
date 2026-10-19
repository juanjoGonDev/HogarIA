import { test, expect, type Page } from './fixtures';
import { registerAndGoto, registerWithHousehold } from './helpers/auth';

/**
 * Las confirmaciones de la app se hacen con `app-confirm-dialog`
 * (ConfirmService), nunca con `confirm()` del navegador.
 *
 * Los diálogos nativos quedan fuera del diseño, no se pueden traducir ni
 * personalizar y en Playwright bloquean el test hasta que alguien los acepte.
 * `tests/e2e/fixtures.ts` añade además un listener global que hace fallar el
 * test si se abre cualquier diálogo nativo, así que este spec no necesita
 * aceptarlos: si algo volviera a usar `confirm()`, fallaría él solo.
 */

/** El diálogo de confirmación abierto (si no hay ninguno, falla). */
function confirmDialog(page: Page) {
  return page.locator('.modal-overlay');
}

/** Añade un utensilio propio desde el modal del header (queda marcado). */
async function addCustomUtensil(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ Agregar' }).click();
  await page.fill('input#utensilName', name);
  await page.selectOption('select#utensilCategory', 'tools');
  await page.locator('.modal-overlay button[type="submit"]').click();
  await expect(page.locator('.utensil-card', { hasText: name })).toHaveCount(1);
}

test.describe('Confirmaciones sin diálogos nativos', () => {
  test('cancelar en el diálogo deja el utensilio en el catálogo', async ({ page }) => {
    await registerWithHousehold(page, '/pantry?tab=utensils');
    await expect(page.locator('.utensils')).toBeVisible();
    await addCustomUtensil(page, 'Sous vide');

    await page
      .locator('.utensil-card', { hasText: 'Sous vide' })
      .locator('.utensil-card__delete')
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toContainText('Eliminar utensilio');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.utensil-card', { hasText: 'Sous vide' })).toHaveCount(1);
  });

  test('la X y la tecla Escape cancelan igual que el botón', async ({ page }) => {
    await registerWithHousehold(page, '/pantry?tab=utensils');
    await expect(page.locator('.utensils')).toBeVisible();
    await addCustomUtensil(page, 'Roner');

    // Cerrando con la X
    await page
      .locator('.utensil-card', { hasText: 'Roner' })
      .locator('.utensil-card__delete')
      .click();
    await expect(confirmDialog(page)).toContainText('Eliminar utensilio');
    await confirmDialog(page).locator('.modal__close').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.utensil-card', { hasText: 'Roner' })).toHaveCount(1);

    // Cerrando con Escape
    await page
      .locator('.utensil-card', { hasText: 'Roner' })
      .locator('.utensil-card__delete')
      .click();
    await expect(confirmDialog(page)).toContainText('Eliminar utensilio');
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.utensil-card', { hasText: 'Roner' })).toHaveCount(1);
  });

  test('hacer clic fuera del diálogo cancela la acción', async ({ page }) => {
    await registerWithHousehold(page, '/pantry?tab=utensils');
    await expect(page.locator('.utensils')).toBeVisible();
    await addCustomUtensil(page, 'Sopera');

    await page
      .locator('.utensil-card', { hasText: 'Sopera' })
      .locator('.utensil-card__delete')
      .click();
    await expect(confirmDialog(page)).toContainText('Eliminar utensilio');

    // Se pincha en la esquina del overlay, fuera de la caja del modal
    await confirmDialog(page).click({ position: { x: 4, y: 4 } });
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.utensil-card', { hasText: 'Sopera' })).toHaveCount(1);
  });

  test('eliminar un ingrediente real de la despensa', async ({ page }) => {
    await registerWithHousehold(page, '/pantry');
    await expect(page.locator('h1.pantry__title')).toBeVisible();

    await page.getByRole('button', { name: '+ Agregar' }).click();
    await page.fill('input#ingredientName', 'Tomate');
    await page.fill('input#quantity', '500');
    // Mismo cadaver que en dashboard.spec.ts: categoria y ubicacion son app-picker desde la ## 12af/12x.
    for (const [testDelPicker, opcion] of [
      ['pantry-picker-categoria', 'Verduras'],
      ['pantry-picker-ubicacion', 'Nevera']
    ] as const) {
      const caja = page.locator(`[data-test="${testDelPicker}"]`);
      await caja.locator('.picker__trigger').click();
      await caja.locator('.picker__option').filter({ hasText: opcion }).first().click();
    }
    await page.locator('app-modal button[type="submit"]').click();

    await expect(page.locator('.ingredient-item', { hasText: 'Tomate' })).toHaveCount(1);
    await expect(page.locator('.stat-card--total .stat-card__value')).toHaveText('1');

    // El toast del alta sigue visible cuando se borra: se filtra por texto.

    await page
      .locator('.ingredient-item', { hasText: 'Tomate' })
      .locator('.action-btn--danger')
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog.locator('.modal__title')).toHaveText('Eliminar ingrediente');
    await expect(dialog.locator('.confirm__message')).toContainText('Tomate');
    await dialog.getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.locator('.toast--success').filter({ hasText: 'Eliminado' })).toBeVisible();
    await expect(page.locator('.ingredient-item', { hasText: 'Tomate' })).toHaveCount(0);
    await expect(page.locator('.stat-card--total .stat-card__value')).toHaveText('0');
  });

  test('borrar logs: cancelar conserva el histórico y aceptar lo limpia', async ({ page }) => {
    await registerAndGoto(page, '/logs');
    await expect(page.locator('.terminal__body')).toBeVisible();

    // Linea propia: POST /api/logs es publico y el terminal la lee del historial
    const tag = `e2e-confirm-${Date.now()}`;
    await page.request.post('/api/logs', {
      data: { level: 'warn', message: `${tag} persiste`, url: 'e2e' }
    });
    await page.reload();
    const line = page.locator('.terminal__line', { hasText: tag });
    await expect(line).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: /Limpiar$/ }).click();
    await expect(confirmDialog(page).locator('.modal__title')).toHaveText('Borrar logs');
    await expect(confirmDialog(page).locator('.confirm__message')).toContainText(
      'no se puede deshacer'
    );
    await confirmDialog(page).getByRole('button', { name: 'Cancelar' }).click();
    await expect(line).toBeVisible();

    await page.getByRole('button', { name: /Limpiar$/ }).click();
    await confirmDialog(page).getByRole('button', { name: 'Borrar' }).click();
    await expect(line).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.terminal__body')).toBeVisible();
    await expect(line).toHaveCount(0);
  });

  test('eliminar una configuración de IA', async ({ page }) => {
    await registerAndGoto(page, '/ai-config');
    await expect(page.locator('h1.ai-config__title')).toBeVisible();

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Mi Proveedor');
    await page.fill('input#model', 'gpt-4o-mini');
    await page.fill('input#baseUrl', 'https://api.openai.com/v1');
    await page.fill('input#apiKey', 'sk-test-key');
    await page.locator('app-modal button[type="submit"]').click();
    await expect(page.locator('.config-card__name')).toContainText('Mi Proveedor');

    await page
      .locator('.config-card')
      .getByRole('button', { name: /Eliminar/ })
      .click();
    await expect(confirmDialog(page).locator('.modal__title')).toHaveText('Eliminar configuración');
    await confirmDialog(page).getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.locator('.toast--success').filter({ hasText: 'Eliminada' })).toBeVisible();
    await expect(page.locator('.config-card')).toHaveCount(0);
  });

  test('salir del hogar pide confirmación y cancelar no saca del hogar', async ({ page }) => {
    await registerWithHousehold(page, '/household');
    await expect(page.locator('.invite-card__code')).toContainText('/invite/');

    await page.getByRole('tab', { name: 'Ajustes' }).click();
    await page.getByRole('button', { name: /Salir del hogar/ }).click();
    const dialog = confirmDialog(page);
    // El titulo real lleva la bandera de la puerta: 'household.salir_del_hogar' es «🚪 Salir del hogar» y el
    // emoji se quita en su propia tanda (deuda perdonada del check-ui, ## 12af). Contenido, no exacto.
    await expect(dialog.locator('.modal__title')).toContainText('Salir del hogar');
    await expect(dialog.getByRole('button', { name: 'Salir' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Hogar' }).click();
    await expect(page.locator('.invite-card__code')).toContainText('/invite/');
  });
});
