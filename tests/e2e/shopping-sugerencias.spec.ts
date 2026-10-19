import { Locator, Page, expect } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

/**
 * Ronda 35 (HOGARIA-SPEC ## 12ag): el autocompletado al anadir lineas y el vuelco del carro
 * comprado al inventario de la casa al cerrar la lista.
 *
 * Son dos cosas que un test de unit no ve: el panel de sugerencias solo vive si el teclado, el
 * debounce y el catalogo global se ponen de acuerdo, y la ficha que nace al cerrar la compra sale
 * de una transaccion del server que el frontend solo sabe contar. Por eso el primer test teclea
 * «lech» de verdad y el segundo cierra una compra y baja a la despensa a comprobar la fila.
 *
 * Ronda 36 (## 12ah) anade dos probechas del mismo sitio: la sugerencia elegida arrastra su
 * seccion (la linea nace clasificada, no «sin clase»), y el confirm de quitar linea se abre POR
 * ENCIMA de la hoja de edicion —se mide el z-index de los dos y se pulsa el dialogo con la hoja
 * abierta, que es lo que antes no podia hacerse—.
 */

async function openNewList(page: Page, seed: string, store?: string): Promise<void> {
  await registerAndGoto(page, '/shopping', seed);
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Compra ronda 35');
  if (store) await page.locator('[data-test="list-store"]').fill(store);
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
}

function row_(page: Page, name: string): Locator {
  return page.locator('[data-test="item-row"]', {
    has: page.locator('.detail__name', { hasText: name })
  });
}

/** Precio por unidad desde la hoja de la linea, con la coma espaola. */
async function priceRow(page: Page, name: string, price: string): Promise<void> {
  const row = row_(page, name);
  await row.locator('.detail__more').click();
  await expect(page.locator('[data-test="edit-sheet"]')).toBeVisible();
  await page.locator('[data-test="price-input"]').fill(price);
  await page.locator('[data-test="price-input"]').blur();
  await page.locator('[data-test="edit-sheet"]').getByRole('button', { name: /Hecho/i }).click();
  await expect(page.locator('[data-test="edit-sheet"]')).toHaveCount(0);
}

test.describe('el anadido sugiere del catalogo', () => {
  test('«lech» despliega el catalogo, y elegir la hoja escribe el nombre canonico', async ({
    page
  }) => {
    await openNewList(page, 'r35-sug');

    // `fill` no basta: el panel se alimenta del `input` tras un debounce, y `pressSequentially`
    // es el dedo tecleando, que es lo que se quiere probar.
    // «lech» a secas no basta: el limite son seis hojas por orden alfabético y se las llevan las
    // lechugas y las leches vegetales. «leche semi» es lo que teclearia alguien que sabe lo que busca.
    await page.locator('[data-test="add-input"]').pressSequentially('leche semi', { delay: 40 });
    const panel = page.locator('[data-test="add-sugerencias"]');
    await expect(panel).toBeVisible();
    const fila = panel.locator('.detail__sug').filter({ hasText: 'Leche semidesnatada' });
    await expect(fila.first()).toBeVisible();

    await fila.first().click();
    // La eleccion reemplaza el nombre, no toda la linea: quien escribio «2kg » conserva su cantidad.
    await expect(page.locator('[data-test="add-input"]')).toHaveValue('Leche semidesnatada');
    await expect(panel).toHaveCount(0);

    await page.locator('[data-test="add-submit"]').click();
    await expect(row_(page, 'Leche semidesnatada')).toHaveCount(1);

    // Y nace ya clasificada (## 12ah): la hoja del catalogo (dairy) arrastra su seccion, la
    // linea no espera a que alguien la reclasifique a mano.
    const lacteos = page.locator('.detail__group', {
      has: page.locator('.detail__group-title', { hasText: 'Lacteos' })
    });
    await expect(lacteos.locator('[data-test="item-row"]')).toHaveCount(1);
  });

  test('sin tocar ninguna hoja, Enter manda lo tecleado tal cual', async ({ page }) => {
    await openNewList(page, 'r35-sug-enter');
    await page.locator('[data-test="add-input"]').pressSequentially('leche semi', { delay: 40 });
    await expect(page.locator('[data-test="add-sugerencias"]')).toBeVisible();

    // El panel esta abierto pero NADIE resalta una hoja: Enter no elige, envia. Es la garantia de
    // que el autocompletado no secuestra la escritura de siempre.
    await page.locator('[data-test="add-input"]').press('Enter');
    await expect(row_(page, 'leche semi')).toHaveCount(1);
  });

  test('las flechas recorren sugerencias; Enter elige y Escape conserva el texto', async ({
    page
  }) => {
    await openNewList(page, 'r35-sug-keyboard');
    const input = page.locator('[data-test="add-input"]');
    await input.pressSequentially('lech', { delay: 40 });

    const panel = page.locator('[data-test="add-sugerencias"]');
    await expect(panel).toBeVisible();
    const options = panel.getByRole('option');
    await expect.poll(() => options.count()).toBeGreaterThan(1);

    // Escape cierra el listbox sin tocar el borrador; Enter sigue siendo alta libre.
    await input.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('lech');
    await input.press('Enter');
    await expect(row_(page, 'lech')).toHaveCount(1);

    // Reabrir el catálogo y mover la selección con el teclado sin sacar el foco del combobox.
    await input.pressSequentially('lech', { delay: 40 });
    await expect(panel).toBeVisible();
    await expect.poll(() => options.count()).toBeGreaterThan(1);

    await input.press('ArrowDown');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(0).locator('.detail__sug')).toHaveClass(/detail__sug--on/);
    await input.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowUp');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

    const selectedName = await options.nth(1).locator('.detail__sug-nombre').innerText();
    await input.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(selectedName);
    await expect(row_(page, selectedName)).toHaveCount(0);

    await page.locator('[data-test="add-submit"]').click();
    await expect(row_(page, selectedName)).toHaveCount(1);
  });
});

test.describe('cerrar la compra baja el carro a la despensa', () => {
  test('la linea comprada, con su precio, aparece en la despensa y el aviso lo dice', async ({
    page
  }) => {
    await openNewList(page, 'r35-cierre', 'Familia');
    await page.locator('[data-test="add-input"]').fill('Pan de pueblo');
    await page.locator('[data-test="add-submit"]').click();
    await expect(row_(page, 'Pan de pueblo')).toHaveCount(1);

    await priceRow(page, 'Pan de pueblo', '2,40');
    await row_(page, 'Pan de pueblo').locator('[data-test="check"]').click();

    await page.locator('[data-test="complete"]').click();
    // El recibo del cierre ya no es solo dinero: una linea se fue al inventario, y se dice.
    await expect(page.locator('.toast--success').filter({ hasText: /inventario/i })).toBeVisible();

    // Y la prueba del algodon: la ficha existe en la despensa con lo comprado.
    await page.goto('/pantry');
    await expect(
      page.locator('[data-test="pantry-tabla-inventario"]').getByText('Pan de pueblo')
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('el confirm de quitar queda POR ENCIMA de la hoja de linea', () => {
  test('quitar desde la hoja: el dialogo se ve, se pulsa y la linea se va (## 12ah)', async ({
    page
  }) => {
    await openNewList(page, 'r36-encima');
    await page.locator('[data-test="add-input"]').fill('Pan de pueblo');
    await page.locator('[data-test="add-submit"]').click();
    await expect(row_(page, 'Pan de pueblo')).toHaveCount(1);

    // La hoja de edicion abierta, y desde ella el «Quitar linea» de siempre.
    await row_(page, 'Pan de pueblo').locator('.detail__more').click();
    const hoja = page.locator('[data-test="edit-sheet"]');
    await expect(hoja).toBeVisible();
    await hoja.getByRole('button', { name: 'Quitar linea' }).click();

    // El dialogo de confirmacion tiene que quedar POR ENCIMA del backdrop de la hoja: antes
    // la hoja iba a 1200 y el modal de la app a 1000, y el confirm nacia detras del oscuro,
    // inalcanzable. Se mide el z-index real de los dos, no solo que «existen los dos».
    const confirmacion = page.locator('app-confirm-dialog');
    await expect(confirmacion.locator('.modal')).toBeVisible();
    const capas = await page.evaluate(() => {
      const hoja = document.querySelector('.detail__sheet-backdrop');
      const confirmacion = document.querySelector('app-confirm-dialog .modal-overlay');
      return {
        hoja: hoja ? Number(getComputedStyle(hoja).zIndex) : -1,
        confirmacion: confirmacion ? Number(getComputedStyle(confirmacion).zIndex) : -1
      };
    });
    expect(capas.confirmacion).toBeGreaterThan(capas.hoja);

    // Y el clic llega al dialogo, no al backdrop de la hoja: la linea desaparece. (Con la hoja
    // por encima, este mismo clic cerraba la hoja y la linea se quedaba.)
    await confirmacion.getByRole('button', { name: 'Quitar', exact: true }).click();
    await expect(confirmacion.locator('.modal')).toHaveCount(0);
    await expect(row_(page, 'Pan de pueblo')).toHaveCount(0);
  });
});
