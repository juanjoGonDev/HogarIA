import { test, expect } from './fixtures';
import { registerAndGoto, registerWithHousehold } from './helpers/auth';

/**
 * Convencion de la aplicacion: toda pestaña que muestra contenido distinto
 * queda reflejada en la URL, de modo que la vista sea enlazable, sobreviva
 * a recargas y se pueda compartir.
 */
test.describe('Pestañas y URL', () => {
  test('la pestaña de la despensa viaja en la URL y sobrevive a la recarga', async ({ page }) => {
    await registerWithHousehold(page, '/pantry');
    await expect(page.locator('h1.pantry__title')).toBeVisible();

    // La pestaña por defecto no ensucia la URL
    await expect(page).not.toHaveURL(/[?&]tab=/);

    await page.locator('.tab', { hasText: 'Utensilios' }).click();
    await expect(page.locator('.utensils')).toBeVisible();
    await expect(page).toHaveURL(/[?&]tab=utensils/);

    await page.reload();
    await expect(page.locator('.utensils')).toBeVisible();
    await expect(page.locator('.tab--active')).toContainText('Utensilios');

    // Volver a la pestaña por defecto limpia el parametro
    await page.locator('.tab', { hasText: 'Ingredientes' }).click();
    await expect(page.locator('.suggestions__title')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]tab=/);
  });

  test('se puede entrar directamente en la pestaña de utensilios', async ({ page }) => {
    await registerWithHousehold(page, '/pantry?tab=utensils');

    await expect(page.locator('.utensils')).toBeVisible();
    await expect(page.locator('.tab--active')).toContainText('Utensilios');
  });

  test('un valor de pestaña desconocido se descarta', async ({ page }) => {
    await registerWithHousehold(page, '/pantry?tab=batidora');

    await expect(page.locator('.tab--active')).toContainText('Ingredientes');
    await expect(page).not.toHaveURL(/[?&]tab=/);
  });

  test('las pestañas de Preferencias también viajan en la URL', async ({ page }) => {
    await registerAndGoto(page, '/preferences', 'urls-prefs');

    await expect(page.locator('.tab--active')).toContainText('Perfil');
    await expect(page).not.toHaveURL(/tab=/);

    await page.locator('.tab', { hasText: 'Alergias' }).click();
    await expect(page).toHaveURL(/tab=allergies/);

    await page.locator('.tab', { hasText: 'Objetivo' }).click();
    await expect(page).toHaveURL(/[?&]tab=goal/);

    await page.goto('/preferences?tab=tastes');
    await expect(page.locator('.tab--active')).toContainText('Gustos');
  });

  test('las sub-secciones de la cuenta también viajan en la URL', async ({ page }) => {
    await registerAndGoto(page, '/account', 'urls-account');

    await expect(page.locator('.tab--active')).toContainText('Cuenta');
    await expect(page).not.toHaveURL(/tab=/);

    await page.locator('.tab', { hasText: 'Seguridad' }).click();
    await expect(page).toHaveURL(/[?&]tab=security/);

    // Un valor que no existe no se inventa: cae en la primera, y la URL se limpia.
    await page.goto('/account?tab=loquesea');
    await expect(page.locator('.tab--active')).toContainText('Cuenta');
  });

  test('la busqueda y la categoria del inventario viajan en la URL (## 12ab)', async ({ page }) => {
    await registerWithHousehold(page, '/pantry');
    await expect(page.locator('h1.pantry__title')).toBeVisible();

    // La tabla —y su búsqueda— se monta cuando hay inventario. El hogar nuevo está vacío, así que
    // sembramos una fila sintética por la misma UI antes de probar URL/reload.
    await page.getByRole('button', { name: '+ Agregar', exact: true }).click();
    await page.fill('input#ingredientName', 'Tomate');
    await page.fill('input#quantity', '500');
    await page.locator('app-modal button[type="submit"]').click();
    await expect(page.locator('.toast--success').last()).toContainText('Agregado');

    // Escribir en la busqueda no navega a ningun otro sitio: reescribe la URL de la pantalla, sin historial.
    await page.fill('input#search', 'Leche');
    await expect(page).toHaveURL(/[?&]buscar=Leche/);

    // El subarbol elegido tambien viaja, y los dos sobreviven a la recarga.
    const picker = page.locator('[data-test="pantry-filtro-categoria"]');
    await picker.locator('.picker__trigger').click();
    await picker.locator('.picker__option').filter({ hasText: 'Verduras' }).first().click();
    await expect(page).toHaveURL(/category=/);

    await page.reload();
    await expect(page.locator('input#search')).toHaveValue('Leche');
    await expect(picker.locator('.picker__trigger')).toContainText('Verduras');

    // Y se puede enlazar la vista directamente
    await page.goto('/pantry?buscar=Tomate');
    await expect(page.locator('input#search')).toHaveValue('Tomate');

    // Quitar los dos filtros deja la URL limpia: el estado vacio no se inventa un parametro.
    await page.fill('input#search', '');
    await picker.locator('.picker__trigger').click();
    await picker.locator('.picker__option').filter({ hasText: 'Todos' }).first().click();
    await expect(page).not.toHaveURL(/buscar=/);
    await expect(page).not.toHaveURL(/category=/);

    // `?section=` se jubilo con los tramos: la tabla lo sustituyo. El parametro, si alguien lo escribe a
    // mano, es decorativo: la pantalla lo ignora y pinta la tabla entera igualmente.
    await page.goto('/pantry?tab=utensils&section=tools-2');
    await expect(page.locator('.utensils')).toBeVisible();
    await expect(page.locator('[data-test="utensilios-tabla"]')).toBeVisible();
  });

  test('las pestañas del modal de comida también cambian la URL', async ({ page }) => {
    await registerWithHousehold(page, '/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();

    await page.locator('[data-test="timeline-add-meal"]').first().click();
    await expect(page.locator('.modal__title')).toContainText('Agregar Comida');

    await page.locator('.meal-form__tabs button', { hasText: 'Receta' }).click();
    await expect(page.locator('.modal-overlay')).toContainText('Selecciona una receta');
    await expect(page).toHaveURL(/[?&]mealTab=recipe/);

    // Al cerrar el modal la pestaña deja de tener sentido en la URL
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page).not.toHaveURL(/mealTab=/);
  });
});
