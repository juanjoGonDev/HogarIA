import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';
import { navigateToShopping, shoppingNewListAction } from '../helpers/shopping-ui';

/**
 * El dinero de la cesta, contra el binario que sirve todo.
 *
 * These three flows are the ones that cannot be tested against `ng serve` with a proxied
 * API: they are about a price being *remembered* —the next list has to know what milk costs
 * at this shop—, and remembering lives in the server's SQLite, and since round 8 behind the
 * budget that guards it. Same origin, real DB, limits on, exactly like the container.
 */

async function createList(page: Page, name: string, store?: string) {
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill(name);
  if (store) await page.locator('[data-test="list-store"]').fill(store);
  await page.locator('[data-test="create-submit"]').click();
  await expect(page.locator('[data-test="add-input"]')).toBeVisible();
}

async function add(page: Page, line: string) {
  await page.locator('[data-test="add-input"]').fill(line);
  await page.locator('[data-test="add-submit"]').click();
}

/** Precio de una linea: la hoja de edicion se abre desde el boton de acciones de la fila. */
async function price(page: Page, index: number, value: string) {
  await page
    .locator('[data-test="item-row"]')
    .nth(index)
    .getByRole('button', { name: 'Acciones de la linea' })
    .click();
  await page.locator('[data-test="price-input"]').fill(value);
  await page.locator('[data-test="edit-sheet"]').getByRole('button', { name: /Hecho/i }).click();
}

async function tickByName(page: Page, name: string) {
  await page.getByRole('checkbox', { name: `Marcar ${name}`, exact: true }).click();
}

test.describe('lo que cuesta, y en que tienda', () => {
  test('una compra no se cierra sin precios, y se cierran escribiendolos ahi', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'full-money');
    await createList(page, 'Compra sin precios', 'Mercadona');
    await add(page, '2 Leche semidesnatada');
    await add(page, '1 Pan de cristal');
    await expect(
      page.locator('[data-test="item-row"]').filter({ hasText: 'Pan de cristal' })
    ).toBeVisible();
    const lineCount = await page.locator('[data-test="item-row"]').count();
    await tickByName(page, 'Leche semidesnatada');
    await tickByName(page, 'Pan de cristal');
    await expect(page.locator('[data-test="tab-todo"]')).toContainText('Pendientes (0)');
    await expect(page.locator('[data-test="tab-cart"]')).toContainText(
      `En el carro (${lineCount})`
    );

    // Primer intento: falta todo. Y la respuesta no es un toast —es la hoja donde se anotan.
    await page.locator('[data-test="complete"]').click();
    const sheet = page.locator('[data-test="pay-sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Leche semidesnatada');
    await expect(sheet).toContainText('Pan de cristal');
    await expect(sheet).toContainText('Mercadona');
    // Con una linea sin escribir, el boton primario no se puede pulsar: el server se niega,
    // y dejar que el usuario reciba un 409 al final es ensenarle un codigo en vez de un campo.
    await expect(page.locator('[data-test="pay-confirm"] button')).toBeDisabled();

    const money = sheet.locator('input[inputmode="decimal"]');
    await money.nth(0).fill('0,95');
    await money.nth(1).fill('1,30');
    await page.locator('[data-test="pay-confirm"]').click();

    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/tab=hechas/);

    // Y el precio se acordo: otra lista, misma tienda, se rellena sola.
    await createList(page, 'Compra siguiente', 'Mercadona');
    await add(page, '2 Leche semidesnatada');
    // 2 x 0,95 = 1,90 €, del historial, sin teclear nada.
    await expect(page.locator('[data-test="total"]')).toContainText('1,90');
  });

  test('el total recordado es de ESTA tienda, no del ultimo ticket', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'full-money-store');
    // La misma leche, dos precios: se compra en Mercadona a 1,00 y en Lidl a 0,60.
    for (const [store, value] of [
      ['Mercadona', '1,00'],
      ['Lidl', '0,60']
    ] as const) {
      await createList(page, `Compra ${store}`, store);
      await add(page, '1 Leche');
      await page.locator('[data-test="item-row"]').first().locator('[data-test="check"]').click();
      await page.locator('[data-test="complete"]').click();
      const money = page.locator('[data-test="pay-sheet"] input[inputmode="decimal"]');
      await expect(money).toBeVisible();
      await money.fill(value);
      await page.locator('[data-test="pay-confirm"]').click();
      await expect(page).toHaveURL(/tab=hechas/);
      // De vuelta a la bandeja por el enlace del menu: el `href` es lo que el router pinta,
      // y depender de un `data-test` del shell para volver seria inventarse una prueba nueva.
      await navigateToShopping(page);
    }

    // La tercera lista, en Lidl, vale 0,60 —no el 1,00 anotado despues en Mercadona. Este es
    // el bug que tenia forma de «ultimo precio»: leer la tabla entera era correcto mientras
    // hubo una tienda, y deja de serlo en cuanto la casa tiene dos.
    await createList(page, 'En Lidl otra vez', 'Lidl');
    await add(page, '1 Leche');
    await expect(page.locator('[data-test="total"]')).toContainText('0,60');
  });

  test('un descuento puede decir dos productos', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'full-discount');
    await createList(page, 'Cesta con promocion');
    await add(page, '1 Jamon serrano');
    await add(page, '1 Queso curado');
    await add(page, '1 Leche');
    await price(page, 0, '12');
    await price(page, 1, '6');
    await price(page, 2, '1');
    await expect(page.locator('[data-test="total"]')).toContainText('19,00');

    await page.locator('[data-test="discount-open"]').click();
    await page
      .locator('[data-test="discount-sheet"]')
      .getByRole('button', { name: /En productos/ })
      .click();
    await page.locator('[data-test="discount-target-jamon-serrano"]').click();
    await page.locator('[data-test="discount-target-queso-curado"]').click();
    await page.locator('[data-test="discount-amount"]').fill('2,50');
    await page.locator('[data-test="discount-save"]').click();

    // 2,50 € sobre jamon y queso. Con la cesta a 19,00 el total no distingue un mal reparto
    // de un buen reparto, y si el recorte se contara dos veces esto saldria a 16,50 igual:
    // lo que se prueba aqui es que la pantalla dice SOBRE QUE paso el recorte.
    await expect(page.locator('[data-test="total"]')).toContainText('16,50');
    await expect(page.locator('[data-test="discount-open"]')).toContainText('Jamon serrano');

    // Y se puede quitar otra vez, que es la otra mitad de poder escribirlo.
    await page.locator('[data-test="discount-open"]').click();
    await page.locator('[data-test="discount-remove"]').click();
    await expect(page.locator('[data-test="total"]')).toContainText('19,00');
  });

  test('un descuento porcentual respeta las primeras unidades y sobrevive a recargar', async ({
    page
  }, testInfo) => {
    const isMobile = Boolean(testInfo.project.use.isMobile);
    await page.setViewportSize(
      isMobile ? { width: 393, height: 851 } : { width: 1440, height: 900 }
    );
    await registerAndGoto(page, '/shopping', 'full-first-units-discount');
    await createList(page, 'Primeras unidades');
    await add(page, '2 Avena');
    await add(page, '2 Zumo');
    await price(page, 0, '2');
    await price(page, 1, '1');
    await expect(page.locator('[data-test="total"]')).toContainText('6,00');

    await page.locator('[data-test="discount-open"]').click();
    const sheet = page.locator('[data-test="discount-sheet"]');
    await sheet.locator('[data-test="discount-kind"]', { hasText: 'Porcentaje' }).click();
    const percent = sheet.locator('[data-test="discount-percent"]');
    await percent.locator('button').click();
    await page.getByRole('option', { name: '50 %' }).click();
    await sheet.locator('[data-test="discount-scope"]', { hasText: 'Primeras unidades' }).click();
    await sheet.locator('[data-test="discount-first-units"]').fill('3');

    await sheet.locator('[data-test="discount-save"]').click();
    // Las tres primeras unidades cuestan 5 €: 50 % son 2,50 €, no el 50 % de los 6 €.
    await expect(page.locator('[data-test="total"]')).toContainText('3,50');
    await expect(page.locator('[data-test="discount-open"]')).toContainText('50');
    const toast = page.locator('.toast--success').filter({ hasText: 'Descuento aplicado' });
    await expect(toast).toBeVisible();
    await expect
      .poll(() =>
        toast.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= window.innerWidth;
        })
      )
      .toBe(true);
    await toast.locator('.toast__close').click();
    await expect(toast).toHaveCount(0);

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(resolve(screenshotDirectory), { recursive: true });
      await page.screenshot({
        path: join(
          resolve(screenshotDirectory),
          `shopping-first-units-${testInfo.project.name}.png`
        )
      });
    }

    const listResponsePromise = page.waitForResponse((response) => {
      const path = new URL(response.url()).pathname;
      return response.request().method() === 'GET' && /^\/api\/shopping\/lists\/[^/]+$/.test(path);
    });
    await page.reload();
    const listPayload = await (await listResponsePromise).json();
    expect(listPayload.data.discount).toMatchObject({
      scope: 'firstUnits',
      firstUnits: 3,
      percentBps: 5000
    });
    await expect(page.locator('[data-test="total"]')).toContainText('3,50');
    await page.locator('[data-test="discount-open"]').click();
    await expect(page.locator('[data-test="discount-first-units"]')).toHaveValue('3');
    await expect(page.locator('[data-test="discount-percent"] .picker__trigger')).toContainText(
      '50 %'
    );
  });
});
