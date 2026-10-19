import { Page, expect } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

/**
 * Ronda 10 (HOGARIA-SPEC §12h): un solo control para elegir la unidad, el descuento propio de
 * una linea y las horas de toda la app en la zona del navegador.
 *
 * Las tres cosas se ven en la misma pantalla, la hoja de una linea, y las tres son de las que
 * un test unitario no ve: el duplicado era de los que se pintan los dos y manda el ultimo
 * tocado, el descuento se aplica en el server y solo el desglose cuenta lo que se cobra, y el
 * hora mal` solo aparece con una zona distinta de UTC — por eso `timezoneId`.
 */
test.use({ timezoneId: 'Europe/Madrid' });

function watchPageErrors(page: Page): () => string {
  const errors: string[] = [];
  page.on('pageerror', (event) => errors.push(String(event.message).split('\n')[0]));
  return () => (errors.length > 0 ? errors.join(' | ') : 'sin errores de pagina');
}

/** La hoja se cierra por la X o por el fondo; lo que no hay es un «cancelar» que deshaga. */
async function closeSheet(page: Page): Promise<void> {
  await page.locator('[data-test="edit-close"]').click();
  await expect(page.locator('[data-test="edit-sheet"]')).toHaveCount(0);
}

/** Lista nueva con una linea y la hoja de edicion de esa linea abierta. */
async function openLineSheet(page: Page, slug: string, line: string): Promise<void> {
  await registerAndGoto(page, '/shopping', slug);
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Compra ronda 10');
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
  await page.locator('[data-test="add-input"]').fill(line);
  await page.locator('[data-test="add-submit"]').click();
  await page.locator('button[aria-label="Acciones de la linea"]').first().click();
  await expect(page.locator('[data-test="edit-sheet"]')).toBeVisible();
}

test.describe('la unidad se elige una sola vez', () => {
  test('hay un unico control, y elegir la familia ya pone su unidad', async ({ page }) => {
    const echo = watchPageErrors(page);
    await openLineSheet(page, 'r10-unit', 'Leche');

    // El duplicado que se quita: habia chips Rapidos Y el desplegable debajo, cada uno con su
    // estado, y tocar uno dejaba al otro diciendo «Otra unidad…».
    await expect(page.locator('[data-test="unit-picker"]')).toHaveCount(1);
    await expect(page.locator('.detail__chips[aria-label="Unidades rapidas"]')).toHaveCount(0);

    const picker = page.locator('[data-test="unit-picker"]');
    await picker.locator('.picker__trigger').click();
    // La familia TITULA, no se elige: si fuera una opcion, el disparador acabaria diciendo
    // «Peso» (o «Volumen») con una unidad dentro, que es exactamente como se veia mal.
    await expect(picker.locator('.picker__group', { hasText: 'Peso' })).toBeVisible();
    await expect(picker.locator('.picker__option', { hasText: /^Peso$/ })).toHaveCount(0);
    await picker.locator('.picker__option', { hasText: /^g$/ }).first().click();
    await expect(picker.locator('.picker__trigger')).toContainText('g');

    expect(echo()).toBe('sin errores de pagina');
  });

  test('escribir una medida de estanteria sigue valiendo', async ({ page }) => {
    await openLineSheet(page, 'r10-unit-custom', 'Merluza');
    const picker = page.locator('[data-test="unit-picker"]');
    await picker.locator('.picker__trigger').click();
    await picker.locator('.picker__search input').fill('bote de 400 g');
    await picker.locator('.picker__option--custom').click();
    await expect(picker.locator('.picker__trigger')).toContainText('bote de 400 g');

    // Y al cerrar y reabrir la hoja, lo que se guardo es lo que se escribe: si la hoja lo
    // normalizara a su antojo, el peso del bote se perderia.
    await closeSheet(page);
    await page.locator('button[aria-label="Acciones de la linea"]').first().click();
    await expect(picker.locator('.picker__trigger')).toContainText('bote de 400 g');
  });
});

test.describe('el descuento de una linea', () => {
  test('porcentaje con tope de unidades, y su chip en la fila', async ({ page }) => {
    const echo = watchPageErrors(page);
    await openLineSheet(page, 'r10-discount', 'Tomate pera');
    const sheet = page.locator('[data-test="edit-sheet"]');
    await expect(sheet.locator('[data-test="line-discount"]')).toBeVisible();
    await sheet.locator('[data-test="line-discount-kind"]', { hasText: 'Porcentaje' }).click();
    await sheet.locator('[data-test="line-discount-percent"]').fill('10');
    await expect(page.locator('[data-test="line-discount-chip"]')).toContainText('10 %');

    await sheet.locator('[data-test="line-discount-units"]').fill('2');
    await expect(page.locator('[data-test="line-discount-chip"]')).toContainText('10 % en 2 unidades');

    // La pista en vivo es la que se lee antes de tocar nada mas: si no dice de a cuanto baja,
    // el descuento es un numero suelto.
    await expect(sheet.locator('[data-test="line-discount-preview"]')).toContainText('a');

    await sheet.locator('[data-test="line-discount-clear"]').click();
    await expect(page.locator('[data-test="line-discount-chip"]')).toHaveCount(0);
    expect(echo()).toBe('sin errores de pagina');
  });

  test('un importe mayor que la linea se recorta y lo dice, no pinta un negativo', async ({ page }) => {
    await openLineSheet(page, 'r10-clamp', 'Leche');
    const sheet = page.locator('[data-test="edit-sheet"]');
    await sheet.locator('[data-test="price-input"]').fill('0,95');
    await sheet.locator('[data-test="price-input"]').blur();
    await sheet.locator('[data-test="line-discount-kind"]', { hasText: 'Importe' }).click();
    await sheet.locator('[data-test="line-discount-amount"]').fill('2');
    await expect(sheet.locator('[data-test="line-discount-preview"]')).toContainText('no puede bajar de 0');
    // El total de la cabecera nunca es negativo por mucho que el cartel prometa.
    await expect(page.locator('[data-test="total"]')).not.toContainText('-');
  });
});

test.describe('las horas, en la zona de quien mira', () => {
  test('la auditoria no cuenta hacia atras', async ({ page }) => {
    await openLineSheet(page, 'r10-time', 'Pollo');
    await closeSheet(page);
    await page.getByRole('button', { name: 'Quien ha tocado que' }).click();
    const when = page.locator('[data-test="audit-row"]').first().locator('.detail__audit-when');
    await expect(when).toBeVisible();
    // Con la marca del server sin zona, un navegador en Madrid la leia como hora local y el
    // suceso acabado de hacer quedaba DOS HORAS EN EL FUTURO: «en 2 h».
    await expect(when).toContainText(/ahora|hace/);
    await expect(when).not.toContainText('en ');
    // Y el titulo lleva la hora absoluta, que es lo que permite discutir el «hace 5 min».
    await expect(when).toHaveAttribute('title', /\d{2}:\d{2}/);
  });
});
