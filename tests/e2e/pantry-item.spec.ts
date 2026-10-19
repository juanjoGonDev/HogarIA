import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Page, expect } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

/**
 * La ficha del articulo de inventario (HOGARIA-SPEC ## 12ai): detalle con caracteristicas,
 * pestana de precios por tienda con grafica, y su pantalla de edicion dedicada.
 *
 * El flujo se siembra por API a proposito: crear el articulo y apuntar tres precios desde la
 * interfaz exigiria pasar por el cierre de una compra entera, que es el spec de la ## 12ag —
 * aqui lo que se prueba es la FICHA: que el nombre de la tabla enlaza, que la pestana viaja
 * en la URL, que cada tienda sale con su ultimo precio y su linea en la grafica, y que la
 * edicion guarda y vuelve. El sello de tiempo del API es «ahora», asi que la grafica no
 * puede ensenar meses de historia: eso lo cubre el spec de `precio-chart.util` con datos
 * sinteticos; aqui se comprueba que las series, los puntos y las etiquetas existen.
 */

const TOKEN_KEY = 'hogar:v1:auth_token';
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((clave) => window.localStorage.getItem(clave), TOKEN_KEY);
  expect(token, 'la sesion deberia tener token').toBeTruthy();
  return token as string;
}

async function apiPost(page: Page, path: string, token: string, body: unknown): Promise<any> {
  const response = await page.request.post(path, {
    headers: { authorization: `Bearer ${token}` },
    data: body
  });
  expect(response.ok(), `${path} deberia dar 2xx y dio ${response.status()}`).toBeTruthy();
  return response.json();
}

async function sembrarProducto(
  page: Page,
  token: string,
  nombre: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const respuesta = await apiPost(page, '/api/pantry/products', token, {
    name: nombre,
    category: 'dairy',
    quantity: 4,
    unit: 'unit',
    location: 'fridge',
    ...extra
  });
  return respuesta.data.id as string;
}

/** Un articulo en el inventario de la casa, creado por API con todo lo que la ficha sabe leer. */
async function sembrarArticulo(
  page: Page,
  token: string,
  nombre: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const respuesta = await apiPost(page, '/api/pantry/ingredients', token, {
    name: nombre,
    category: 'dairy',
    quantity: 4,
    unit: 'unit',
    location: 'fridge',
    ...extra
  });
  return respuesta.data.id as string;
}

async function sembrarPrecio(
  page: Page,
  token: string,
  nombre: string,
  minor: number,
  tienda: string
): Promise<void> {
  await apiPost(page, '/api/shopping/prices', token, {
    productName: nombre,
    priceMinor: minor,
    quantity: 1,
    store: tienda
  });
}

async function guardarCapturaSintetica(
  page: Page,
  testInfo: { project: { name: string } },
  nombre: string
): Promise<void> {
  const viewport =
    testInfo.project.name === 'mobile-chrome'
      ? { width: 393, height: 851 }
      : { width: 1440, height: 900 };
  const viewportAnterior = page.viewportSize();
  await page.setViewportSize(viewport);
  await comprobarSinDesbordamientoHorizontal(page);
  const path = resolve(
    '.e2e-screenshots/qa-pantry-item-route-20261008',
    testInfo.project.name,
    `${nombre}-${viewport.width}x${viewport.height}.png`
  );
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, animations: 'disabled' });
  if (viewportAnterior) await page.setViewportSize(viewportAnterior);
}

async function comprobarAjusteAlViewport(page: Page): Promise<void> {
  const geometria = await page.evaluate(() => {
    const boton = document.querySelector<HTMLButtonElement>('[data-test="editar-guardar"] button');
    if (!boton) throw new Error('No se encontro el boton nativo de guardado');
    const rect = boton.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      documento: document.documentElement.scrollWidth,
      botonIzquierda: rect.left,
      botonDerecha: rect.right
    };
  });
  expect(geometria.documento, 'la pantalla no debe desbordar horizontalmente').toBeLessThanOrEqual(
    geometria.viewport
  );
  expect(
    geometria.botonIzquierda,
    'el boton debe quedar dentro del viewport'
  ).toBeGreaterThanOrEqual(0);
  expect(geometria.botonDerecha, 'el boton debe quedar dentro del viewport').toBeLessThanOrEqual(
    geometria.viewport + 1
  );
}

async function comprobarSinDesbordamientoHorizontal(page: Page): Promise<void> {
  const geometria = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documento: document.documentElement.scrollWidth
  }));
  expect(geometria.documento, 'la ficha no debe desbordar horizontalmente').toBeLessThanOrEqual(
    geometria.viewport
  );
}

test.describe('la ficha del articulo de inventario', () => {
  test('el nombre de la tabla enlaza, y la ficha dice lo que el articulo es', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/pantry', 'r37-ficha');
    const token = await tokenOf(page);
    const id = await sembrarProducto(page, token, 'Leche entera', {
      barcode: '8480000123456',
      notes: 'La de siempre, entera',
      aliases: ['Leche de casa'],
      expirationDate: '2026-10-18'
    });

    await page.goto('/pantry');
    const enlace = page.locator(`[data-test="pantry-item-${id}"]`);
    await expect(enlace).toBeVisible();
    await enlace.click();

    await expect(page).toHaveURL(new RegExp(`/pantry/inventario/${id}$`));
    await expect(page.locator('.item__nombre')).toHaveText('Leche entera');
    // Lo que la ficha promete: caracteristicas, no solo un nombre grande.
    await expect(page.locator('[data-test="item-detalles"]')).toBeVisible();
    await expect(page.locator('.item__clase')).toHaveText('Lácteos');
    await expect(page.locator('.item__estado')).toContainText('4 unit');
    await expect(page.locator('.item__estado')).toContainText('Nevera');
    await expect(page.locator('[data-test="item-detalles"]')).toContainText('8480000123456');
    await expect(page.locator('[data-test="item-detalles"]')).toContainText('18/10/2026');
    await expect(page.locator('[data-test="item-detalles"]')).toContainText(
      'La de siempre, entera'
    );
    await expect(page.locator('[data-test="item-detalles"]')).toContainText('Leche de casa');
    await comprobarSinDesbordamientoHorizontal(page);
    await guardarCapturaSintetica(page, testInfo, 'detalle');

    // La pestana de precios existe y viaja en la URL; sin historia, dice que no hay nada.
    await page.locator('[data-test="item-tab-precios"]').click();
    await expect(page).toHaveURL(new RegExp(`/pantry/inventario/${id}\\?tab=precios$`));
    await expect(page.locator('[data-test="item-precios-vacio"]')).toBeVisible();
  });

  test('los precios se ven por tienda, dibujan la grafica y una observacion se puede quitar', async ({
    page
  }) => {
    await registerAndGoto(page, '/pantry', 'r37-precios');
    const token = await tokenOf(page);
    const id = await sembrarArticulo(page, token, 'Leche entera');
    await sembrarPrecio(page, token, 'Leche entera', 175, 'Mercadona');
    await sembrarPrecio(page, token, 'Leche entera', 180, 'Mercadona');
    await sembrarPrecio(page, token, 'Leche entera', 160, 'Lidl');

    await page.goto(`/pantry/inventario/${id}?tab=precios`);
    const precios = page.locator('[data-test="item-precios"]');
    await expect(precios.locator('[data-test="item-tienda"]')).toHaveCount(2);

    // Cada tienda con su ultimo precio: la tarjeta lo dice en euros.
    const mercadona = precios.locator('[data-test="item-tienda"]', { hasText: 'Mercadona' });
    await expect(mercadona).toContainText('1,80');
    const lidl = precios.locator('[data-test="item-tienda"]', { hasText: 'Lidl' });
    await expect(lidl).toContainText('1,60');

    // La grafica: dos series (dos colores en la leyenda), tres puntos, y la linea del que
    // tiene historia (Mercadona con dos observaciones).
    const grafica = page.locator('[data-test="precios-grafica"]');
    await expect(grafica.locator('svg')).toBeVisible();
    await expect(grafica.locator('.grafica__clave')).toHaveCount(2);
    await expect(grafica.locator('svg circle')).toHaveCount(3);
    await expect(grafica.locator('svg path.grafica__linea')).toHaveCount(1);

    // El historial cuenta las tres observaciones, y una se quita con su confirmacion.
    await expect(precios.locator('[data-test^="item-precio-"]')).toHaveCount(3);
    await precios.locator('.item__quitar').first().click();
    const confirmacion = page.locator('app-confirm-dialog');
    await expect(confirmacion.locator('.modal')).toBeVisible();
    await confirmacion.getByRole('button', { name: 'Quitar', exact: true }).click();
    await expect(precios.locator('[data-test^="item-precio-"]')).toHaveCount(2);
  });

  test('la edicion es su propia pantalla: guarda, vuelve a la ficha y lo cambiado se ve', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/pantry', 'r37-editar');
    const token = await tokenOf(page);
    const id = await sembrarProducto(page, token, 'Yogur natural', { location: 'pantry' });

    await page.goto(`/pantry/inventario/${id}`);
    await page.locator('[data-test="item-editar"]').click();
    await expect(page).toHaveURL(new RegExp(`/pantry/inventario/${id}/editar$`));

    // El stock se ve pero no se toca: la regla de la ## 12x, dicha en la propia pantalla.
    await expect(page.locator('[data-test="editar-stock"]')).toContainText('4 unit');

    const viewportInicial = page.viewportSize();
    expect(viewportInicial).not.toBeNull();
    await guardarCapturaSintetica(page, testInfo, 'edicion');
    await comprobarAjusteAlViewport(page);
    for (const viewport of [
      { width: 641, height: 800 },
      { width: 640, height: 800 },
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(viewport);
      await comprobarAjusteAlViewport(page);
    }
    await page.setViewportSize(viewportInicial!);

    await page.locator('input#item-nombre').fill('Yogur natural de avena');
    await page.locator('[data-test="editar-campo-categoria"] button').click();
    await page.getByRole('option', { name: 'Cereales', exact: true }).click();
    await page.locator('[data-test="editar-campo-unidad"] button').click();
    await page.getByRole('option', { name: 'Gramos (g)', exact: true }).click();
    await page.locator('[data-test="editar-campo-ubicacion"] button').click();
    await page.getByRole('option', { name: 'Congelador', exact: true }).click();
    await page.locator('input#item-caducidad').fill('2026-11-30');
    await page.locator('input#item-alias').fill('Yogur avena QA');
    await page.getByRole('button', { name: 'Añadir alias', exact: true }).click();
    await page.locator('input#item-nota').fill('El de la caja roja');
    await page.locator('input#item-codigo').fill('1234567890');
    await page.getByRole('button', { name: 'Guardar producto', exact: true }).focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/pantry/inventario/${id}$`));
    await expect(page.locator('.item__nombre')).toHaveText('Yogur natural de avena');
    await expect(page.locator('.item__clase')).toHaveText('Cereales');
    await expect(page.locator('.item__estado')).toContainText('4 g');
    await expect(page.locator('.item__estado')).toContainText('Congelador');
    await expect(page.locator('[data-test="item-detalles"]')).toContainText('El de la caja roja');
    await expect(page.locator('[data-test="item-detalles"]')).toContainText('1234567890');
    await expect(page.locator('[data-test="item-detalles"]')).toContainText('30/11/2026');
    await expect(page.locator('[data-test="item-detalles"]')).toContainText('Yogur avena QA');
  });

  test('detalle y edicion muestran el estado 404 con un camino de vuelta', async ({ page }) => {
    await registerAndGoto(page, '/pantry', 'r37-ficha-404');
    const id = 'producto-inexistente-qa';

    const respuestaDetalle = page.waitForResponse((respuesta) =>
      respuesta.url().endsWith(`/api/pantry/products/${id}`)
    );
    await page.goto(`/pantry/inventario/${id}`);
    expect((await respuestaDetalle).status()).toBe(404);
    await expect(page.locator('[data-test="item-no-encontrado"]')).toContainText(
      'Ese artículo no está en esta casa'
    );
    await expect(
      page.locator('[data-test="item-no-encontrado"]').getByRole('link', { name: 'Inventario' })
    ).toHaveAttribute('href', '/pantry');

    const respuestaEdicion = page.waitForResponse((respuesta) =>
      respuesta.url().endsWith(`/api/pantry/products/${id}`)
    );
    await page.goto(`/pantry/inventario/${id}/editar`);
    expect((await respuestaEdicion).status()).toBe(404);
    await expect(page.locator('[data-test="editar-no-encontrado"]')).toContainText(
      'Ese artículo no está en esta casa'
    );
    await expect(
      page.locator('[data-test="editar-no-encontrado"]').getByRole('link', { name: 'Inventario' })
    ).toHaveAttribute('href', '/pantry');
  });

  test('cancelar edicion permite seguir editando o descartar sin guardar', async ({ page }) => {
    await registerAndGoto(page, '/pantry', 'r37-editar-cancelar');
    const token = await tokenOf(page);
    const id = await sembrarArticulo(page, token, 'Tofu firme');
    await page.goto(`/pantry/inventario/${id}/editar`);
    await page.locator('input#item-nota').fill('Solo una prueba sin guardar');

    const guardarDialogo = async () => {
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(page.locator('app-confirm-dialog')).toContainText(
        'Hay cambios sin guardar en este artículo.'
      );
    };

    await guardarDialogo();
    await page.locator('app-confirm-dialog').getByRole('button', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(new RegExp(`/pantry/inventario/${id}/editar$`));
    await expect(page.locator('input#item-nota')).toHaveValue('Solo una prueba sin guardar');

    await guardarDialogo();
    await page.locator('app-confirm-dialog').getByRole('button', { name: 'Confirmar' }).click();
    await expect(page).toHaveURL(new RegExp(`/pantry/inventario/${id}$`));
    await expect(page.locator('[data-test="item-detalles"]')).not.toContainText(
      'Solo una prueba sin guardar'
    );
  });

  test('el choque de alias se explica sin salir de la edicion', async ({ page }) => {
    await registerAndGoto(page, '/pantry', 'r37-editar-alias-choca');
    const token = await tokenOf(page);
    await sembrarProducto(page, token, 'Queso cabra QA choque');
    const id = await sembrarProducto(page, token, 'Queso fresco QA alias');
    await page.goto(`/pantry/inventario/${id}/editar`);
    await page.locator('input#item-alias').fill('Queso cabra QA choque');
    await page.getByRole('button', { name: 'Añadir alias', exact: true }).click();

    const patch = page.waitForResponse(
      (respuesta) =>
        respuesta.url().endsWith(`/api/pantry/products/${id}`) &&
        respuesta.request().method() === 'PATCH'
    );
    await page.getByRole('button', { name: 'Guardar producto', exact: true }).click();
    expect((await patch).status()).toBe(409);
    await expect(page.locator('[data-test="editar-error"]')).toContainText(
      'Ese alias ya es el nombre de otro producto de esta casa'
    );
    await expect(page).toHaveURL(new RegExp(`/pantry/inventario/${id}/editar$`));
  });
});
