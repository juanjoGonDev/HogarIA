import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures';
import { createHousehold, registerUser, registerWithHousehold } from './helpers/auth';
import { ponTamano } from './helpers/tabla';

/**
 * El catalogo de utensilios se tabla desde la ## 12ab: 54 filas como lista infinita no se acaban nunca,
 * y los tramos con `?section=` eran una paginacion artesanal. Ahora el catalogo entra en `app-data-table`
 * (busqueda, filtros por columna, orden y lote) igual que el inventario, y la cuenta «x de 54» vive en la
 * meta de encima de la tabla.
 *
 * Ojo al localizar filas: hay nombres que se solapan, asi que lo que se marca se comprueba por posicion.
 */

const tabla = (page: Page): Locator => page.locator('[data-test="utensilios-tabla"]');
const filas = (page: Page): Locator => tabla(page).locator('tr.tabla__fila');
const casillaDe = (fila: Locator): Locator =>
  fila.locator('[data-test^="utensil-marcar-"]').locator('button[role="checkbox"]');
// La casilla de la tabla (seleccion de lote) no es la del «tengo» de la fila: dos cosas distintas.
const seleccionDe = (fila: Locator): Locator =>
  fila.locator('[data-test^="tabla-marcar-"]').locator('button[role="checkbox"]');

test.describe('Pantry — catalogo de utensilios en tabla', () => {
  test.beforeEach(async ({ page }) => {
    // El catalogo se siembra solo junto al hogar (no hay que anadir 54 filas a mano).
    await registerWithHousehold(page, '/pantry');
    await page.locator('.tab', { hasText: 'Utensilios' }).click();
    await expect(page.locator('.utensils')).toBeVisible();
  });

  test('una tabla con el catalogo entero, sin tramos ni rieles', async ({ page }) => {
    // La meta de siempre, fuera de la tabla; los tramos, jubilados.
    await expect(page.locator('.utensils-meta')).toContainText('0 de 54 marcados');
    // (la barra de repaso y el navegador de tramos ya no existen: el «no hay secciones» se comprueba abajo,
    //  con la URL limpia y la tabla paginando el catalogo entero)
    await expect(page).not.toHaveURL(/section=/);

    // Paginacion de la tabla (24 por pagina por defecto): las 54 no caben de golpe, y no hace falta.
    await expect(filas(page)).toHaveCount(24);
    await expect(tabla(page).locator('[data-test="tabla-rango"]')).toContainText('de 54');

    // Una casilla por fila para el lote, ademas de la del estado en su columna.
    await expect(tabla(page).locator('[data-test^="tabla-marcar-"]')).toHaveCount(24);
  });

  test('la busqueda propia filtra las filas al vuelo', async ({ page }) => {
    await page.fill('input#utensilios-q', 'Abrelatas');
    await expect(filas(page)).toHaveCount(1);

    await page.fill('input#utensilios-q', 'no-existe-nada');
    await expect(filas(page)).toHaveCount(0);

    await page.fill('input#utensilios-q', '');
    await expect(tabla(page).locator('[data-test="tabla-rango"]')).toContainText('de 54');
  });

  test('la columna de estado filtra por disponibles / no disponibles', async ({
    page
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'el menu de la columna estado cuelga del cabezal: en movil, la hoja'
    );
    await casillaDe(filas(page).first()).click();
    await expect(page.locator('.utensils-meta')).toContainText('1 de 54 marcados');

    await tabla(page).locator('[data-test="tabla-filtro-available"]').click();
    const menu = page.locator('.menu');
    // Excel-fiel, dos veces: las casillas nacen marcadas y se DESMARCA lo que estorba (quitar «No
    // disponible» deja los suyos), y el filtro por texto lleva ancla porque «Disponible» es substring de
    // «No disponible» sin distinguir mayusculas.
    await menu
      .locator('.menu__fila', { hasText: /^No disponible/ })
      .locator('button[role="checkbox"]')
      .click();
    await expect(filas(page)).toHaveCount(1);
    await page.keyboard.press('Escape');

    // La busqueda y el filtro de columna conviven: la fila marcada sigue siendo la primera.
    await expect(filas(page).first()).toHaveClass(/utensil-card--owned/);
  });

  test('ordenar por nombre cambia el orden de la tabla', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'el boton de orden del cabezal no existe en el reflujo de movil'
    );
    const primera = filas(page).first();
    await tabla(page).locator('[data-test="tabla-orden-name"]').click(); // ascendente
    const ascendente = await primera.innerText();
    await tabla(page).locator('[data-test="tabla-orden-name"]').click(); // descendente
    const descendente = await primera.innerText();
    expect(ascendente).not.toBe(descendente);
  });

  test('marcar un utensilio persiste tras recargar', async ({ page }) => {
    await casillaDe(filas(page).first()).click();

    await expect(filas(page).first()).toHaveClass(/utensil-card--owned/);
    await expect(page.locator('.tab', { hasText: 'Utensilios' })).toContainText('1');
    await expect(page.locator('.utensils-meta')).toContainText('1 de 54 marcados');

    // Ojo: tras el F5 la tabla vuelve a la pagina 1 y la fila marcada puede estar en otra pagina — con las
    // 54 de golpe la comprobacion es determinista.
    await page.reload();
    await page.locator('.tab', { hasText: 'Utensilios' }).click();
    await ponTamano(tabla(page), 100);
    await expect(page.locator('.utensil-card--owned')).toHaveCount(1);
  });

  test('marcar no mueve la vista: la fila no se re-renderiza entera', async ({ page }) => {
    // A 100 por pagina entran las 54: la pagina scrollea de verdad.
    await ponTamano(tabla(page), 100);

    const ultima = filas(page).nth(53);
    const casilla = casillaDe(ultima);
    await ultima.scrollIntoViewIfNeeded();

    // Se marca el nodo del DOM para detectar si Angular lo reemplaza entero (la tabla sigue por id).
    await casilla.evaluate((el) => el.setAttribute('data-e2e-node', 'original'));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(0);

    await casilla.click();
    await expect(ultima).toHaveClass(/utensil-card--owned/);
    await expect(page.locator('[data-e2e-node="original"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test('agregar un utensilio propio lo marca y la busqueda lo deja a la vista', async ({
    page
  }) => {
    await page.getByRole('button', { name: '+ Agregar' }).click();
    await expect(page.locator('.modal__title')).toContainText('Agregar Utensilio');
    await page.fill('input#utensilName', 'Sous vide');
    await page.selectOption('select#utensilCategory', 'tools');
    await page.locator('.modal-overlay button[type="submit"]').click();

    await expect(page.locator('.toast--success .toast__title')).toContainText('Añadido');

    // La tabla pagina, asi que el alta «deja a la vista» poniendo el nombre en la busqueda (## 12ab):
    // una sola fila, marcada, y con su dialogo de borrado a mano.
    await expect(page.locator('input#utensilios-q')).toHaveValue('Sous vide');
    await expect(filas(page)).toHaveCount(1);
    const custom = filas(page).first();
    await expect(custom).toContainText('Sous vide');
    await expect(custom).toHaveClass(/utensil-card--owned/);

    await custom.locator('.utensil-card__delete').click();
    const confirmDialog = page.locator('.modal-overlay');
    await expect(confirmDialog.locator('.modal__title')).toHaveText('Eliminar utensilio');
    await expect(confirmDialog.locator('.confirm__message')).toContainText(
      'Quitar Sous vide del catálogo'
    );
    await confirmDialog.getByRole('button', { name: 'Eliminar' }).click();

    await expect(page.locator('.toast--success').filter({ hasText: 'Eliminado' })).toBeVisible();
    await expect(filas(page)).toHaveCount(0);
  });

  test('no deja anadir un utensilio con nombre duplicado', async ({ page }) => {
    await page.getByRole('button', { name: '+ Agregar' }).click();
    await page.fill('input#utensilName', 'Abrelatas'); // viene del catalogo
    await page.locator('.modal-overlay button[type="submit"]').click();

    await expect(page.locator('.input__error')).toContainText('Ya existe');
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    await page.fill('input#utensilios-q', 'Abrelatas');
    await expect(filas(page)).toHaveCount(1);
  });

  test('el lote marca y desmarca de golpe, con anular para soltar la seleccion', async ({
    page
  }) => {
    await ponTamano(tabla(page), 100);

    await seleccionDe(filas(page).first()).click();
    await seleccionDe(filas(page).nth(1)).click();
    await expect(page.locator('[data-test="utensilios-lote"]')).toContainText('2 seleccionados');

    await page.locator('[data-test="utensilios-lote-marcar"]').click();
    await expect(page.locator('.toast--success .toast__title')).toContainText(
      '2 utensilios actualizados'
    );
    await expect(page.locator('.utensil-card--owned')).toHaveCount(2);
    await expect(page.locator('.utensils-meta')).toContainText('2 de 54 marcados');
    await expect(page.locator('[data-test="utensilios-lote"]')).toHaveCount(0); // la accion suelta la seleccion sola

    await seleccionDe(filas(page).first()).click();
    await seleccionDe(filas(page).nth(1)).click();
    await page.locator('[data-test="utensilios-lote-desmarcar"]').click();
    await expect(page.locator('.utensil-card--owned')).toHaveCount(0);

    // y «anular» suelta el lote sin tocar el inventario de nadie
    await seleccionDe(filas(page).first()).click();
    await expect(page.locator('[data-test="utensilios-lote"]')).toBeVisible();
    await page.locator('[data-test="utensilios-lote-anular"]').click();
    await expect(page.locator('[data-test="utensilios-lote"]')).toHaveCount(0);
    await expect(filas(page).first()).not.toHaveClass(/utensil-card--owned/);
  });
});

/** Las rutas de despensa están protegidas hasta que la cuenta cree o se una a un hogar. */
test.describe('Pantry — utensilios sin hogar', () => {
  test('redirige al setup obligatorio antes de acceder o marcar utensilios', async ({ page }) => {
    await registerUser(page, 'Utensilios sin hogar');
    await page.goto('/pantry?tab=utensils');

    await expect(page).toHaveURL(/\/household(?:$|[?#])/);
    await expect(page.locator('.no-household')).toBeVisible();
    await expect(page.locator('.utensils')).toHaveCount(0);
  });

  test('el catalogo del hogar se marca una vez y persiste tras recargar', async ({ page }) => {
    await registerUser(page, 'Utensilios hogar');
    await createHousehold(page);
    await page.goto('/pantry?tab=utensils');
    await expect(page.locator('.utensils')).toBeVisible();
    await ponTamano(tabla(page), 100);

    const total = await filas(page).count();
    expect(total).toBeGreaterThanOrEqual(54);

    await casillaDe(filas(page).first()).click();
    await expect(filas(page).first()).toHaveClass(/utensil-card--owned/);
    await page.reload();
    await expect(page.locator('.utensils')).toBeVisible();
    await ponTamano(tabla(page), 100);

    // Mismo numero de filas y marca persistida; nombres similares hacen fragil buscar por texto.
    await expect(filas(page)).toHaveCount(total);
    await expect(filas(page).first()).toHaveClass(/utensil-card--owned/);
    await expect(page.locator('.tab', { hasText: 'Utensilios' })).toContainText('1');
  });
});
