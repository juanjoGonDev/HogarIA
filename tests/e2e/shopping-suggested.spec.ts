import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Page, expect } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

/**
 * La lista de la compra sugerida por la actividad de la casa (HOGARIA-SPEC ## 12al), de punta
 * a punta y SIN IA: lo que se prueba aqui es la PROMESA de la tarjeta, no la estadistica (el
 * reparto de cantidades y motivos vive en `lista-sugerida.spec.ts` del server, con numeros
 * escritos).
 *
 *   - La tarjeta de la bandeja ensena que sugeriria y POR QUE (un motivo por fila) y DONDE
 *     (la tienda mas barata conocida), y no escribe nada hasta que se pulsa el boton.
 *   - «Crear lista» la crea de verdad y sus lineas llevan la tienda en la nota.
 *   - Con la lista abierta, el boton pasa a ser «Actualizar»: lo ya comprado se queda.
 *
 * El ritmo de compra no se siembra aqui a proposito: el API de precios escribe «ahora» en cada
 * observacion, y dos compras el mismo dia no hacen ritmo. Los casos con dias distintos estan
 * en la spec del server; esta prueba cubre sin stock, caducado y plan de la semana.
 */

const TOKEN_KEY = 'hogar:v1:auth_token';

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((clave) => window.localStorage.getItem(clave), TOKEN_KEY);
  expect(token, 'la sesion deberia tener token').toBeTruthy();
  return token as string;
}

async function api(
  page: Page,
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<any> {
  const response = await page.request.fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body)
  });
  expect(
    response.ok(),
    `${method} ${path} deberia dar 2xx y dio ${response.status()}`
  ).toBeTruthy();
  return response.json();
}

const filaDe = (page: import('@playwright/test').Page, texto: string | RegExp) =>
  page.locator('[data-test^="sugerida-item-"]').filter({ hasText: texto });

async function captureState(page: Page, testInfo: TestInfo, fileName: string): Promise<void> {
  const root = process.env.E2E_SCREENSHOT_DIR;
  if (!root) return;
  const directory = join(root, testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, fileName),
    animations: 'disabled'
  });
}

test.describe('la lista sugerida por la actividad (## 12al)', () => {
  test('de la tarjeta a la lista: motivos a la vista, crear, y actualizar sin perder lo comprado', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/shopping', 'r40-sug');
    const token = await tokenOf(page);

    // La casa: pan agotado (y comprado ayer en Lidl), pescado que caduco ayer, y una receta
    // de manana que pide tomate — que no esta en la despensa.
    // El alta exige cantidad >= 1: el pan nace con una barra y se come al momento (PATCH a 0,
    // que es como una casa real se queda sin pan).
    const panSembrado = await api(page, 'POST', '/api/pantry/ingredients', token, {
      name: 'Pan de barra',
      category: 'other',
      quantity: 1,
      unit: 'unit',
      location: 'pantry'
    });
    await api(page, 'PATCH', `/api/pantry/ingredients/${panSembrado.data.id}`, token, {
      quantity: 0
    });
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await api(page, 'POST', '/api/pantry/ingredients', token, {
      name: 'Pescado fresco',
      category: 'other',
      quantity: 2,
      unit: 'unit',
      location: 'fridge',
      expirationDate: ayer
    });
    await api(page, 'POST', '/api/shopping/prices', token, {
      productName: 'Pan de barra',
      priceMinor: 180,
      quantity: 2,
      store: 'Lidl'
    });
    await api(page, 'POST', '/api/shopping/prices', token, {
      productName: 'Pescado fresco',
      priceMinor: 1000,
      quantity: 1,
      store: 'Mercadona'
    });
    const receta = await api(page, 'POST', '/api/recipes', token, {
      name: 'Pasta al pomodoro',
      servings: 2,
      ingredients: [{ name: 'Tomate', quantity: 400, unit: 'g' }],
      steps: [{ stepNumber: 1, instruction: 'Sofreir el tomate.' }]
    });
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await api(page, 'POST', '/api/calendar/meals', token, {
      date: manana,
      mealType: 'dinner',
      recipeId: receta.data.id,
      servings: 2
    });

    await page.goto('/shopping');
    // La entrada es minimalista: un boton con el carrito y el numero de sugerencias. El
    // detalle vive en el modal que abre.
    const abrir = page.locator('[data-test="sugerida-abrir"]');
    await expect(abrir).toBeVisible();
    await expect(page.locator('[data-test="sugerida-n"]')).toHaveText('3');
    await abrir.click();
    const tarjeta = page.locator('.modal-overlay');
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.locator('.modal__title')).toContainText('Sugerencia de compra');

    // Tres filas con su motivo y su tienda: la decision ya esta tomada, solo falta pagarla.
    await expect(filaDe(page, 'Pescado fresco')).toContainText('caduca pronto');
    await expect(filaDe(page, 'Pescado fresco')).toContainText('mejor en Mercadona');
    await expect(filaDe(page, 'Pan de barra')).toContainText('sin stock');
    await expect(filaDe(page, 'Pan de barra')).toContainText('mejor en Lidl');
    await expect(filaDe(page, 'Tomate')).toContainText('para el plan');
    // El total solo cuenta lo que tiene precio: 2×10,00 + 2×0,90 = 21,80.
    await expect(page.locator('[data-test="sugerida-total"]')).toContainText('21,80');

    // Crear: el modal se cierra y la lista aparece en la bandeja con su nombre y sus lineas.
    await page.locator('[data-test="sugerida-crear"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.toast--success .toast__title').last()).toContainText(
      'Lista sugerida creada'
    );
    await expect(page.locator('[data-test="list-row"]').first()).toContainText('Lista sugerida');

    // La casa compra el pan: se marca en la lista.
    const listas = await api(page, 'GET', '/api/shopping/lists?status=active', token);
    const lista = listas.data.find((l: { name: string }) => l.name === 'Lista sugerida');
    expect(lista, 'la lista sugerida deberia existir').toBeTruthy();
    const detalle = await api(page, 'GET', `/api/shopping/lists/${lista.id}`, token);
    const pan = detalle.data.items.find((i: { name: string }) => i.name === 'Pan de barra');
    expect(pan.note).toBe('Mejor en Lidl');
    await api(page, 'PATCH', `/api/shopping/lists/${lista.id}/items/${pan.id}`, token, {
      checked: true
    });

    // La persona añade algo a mano desde el detalle: actualizar la sugerencia no debe borrarlo.
    await page.goto(`/shopping/${lista.id}`);
    await page.locator('[data-test="add-input"]').fill('Detergente QA');
    await page.locator('[data-test="add-submit"]').click();
    await expect(
      page.locator('[data-test="item-row"]').filter({ hasText: 'Detergente QA' })
    ).toBeVisible();
    await page.locator('[data-test="back"]').click();
    await expect(page).toHaveURL(/\/shopping$/);

    // Dias despues hay registros nuevos: el boton del modal ofrece ACTUALIZAR, y lo comprado
    // se queda.
    await page.goto('/shopping');
    await page.locator('[data-test="sugerida-abrir"]').click();
    await expect(page.locator('[data-test="sugerida-actualizar"]')).toBeVisible();
    await expect(page.locator('[data-test="sugerida-abierta"]')).toContainText('pendientes');
    await page.locator('[data-test="sugerida-actualizar"]').click();
    await expect(page.locator('.toast--success .toast__title').last()).toContainText(
      'Lista sugerida actualizada'
    );

    const despues = await api(
      page,
      'GET',
      `/api/shopping/lists/${lista.id}?includeDeleted=1`,
      token
    );
    const panDespues = despues.data.items.find((i: { name: string }) => i.name === 'Pan de barra');
    expect(panDespues.checked, 'lo comprado se queda, no se retira al actualizar').toBe(1);
    expect(panDespues.deleted_at, 'lo comprado no se borra').toBeNull();
    // El Tomate viejo se retira (borrado logico) y nace la linea nueva: con includeDeleted
    // llegan las dos, y lo que debe quedar es UNA viva.
    const tomatesVivos = despues.data.items.filter(
      (i: { name: string; deleted_at: string | null }) => i.name === 'Tomate' && !i.deleted_at
    );
    expect(tomatesVivos, 'la sugerencia del plan sigue viva').toHaveLength(1);
    const detergentesVivos = despues.data.items.filter(
      (i: { name: string; deleted_at: string | null }) =>
        i.name === 'Detergente QA' && !i.deleted_at
    );
    expect(detergentesVivos, 'la línea manual no se pierde ni duplica').toHaveLength(1);
    expect(detergentesVivos[0].source).toBe('manual');

    await page.goto(`/shopping/${lista.id}`);
    const detergentRow = page
      .locator('[data-test="item-row"]')
      .filter({ hasText: 'Detergente QA' });
    await expect(detergentRow).toBeVisible();
    await detergentRow.scrollIntoViewIfNeeded();
    const { clientWidth, scrollWidth } = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await captureState(page, testInfo, 'shopping-suggested-manual-preserved.png');

    await page.locator('[data-test="tab-cart"]').click();
    const boughtPan = page.locator('[data-test="item-row"]').filter({ hasText: 'Pan de barra' });
    await expect(boughtPan).toHaveCount(1);
    await expect(boughtPan.locator('[data-test="check"]')).toHaveAttribute('aria-checked', 'true');
    const checkedLayout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(checkedLayout.scrollWidth).toBeLessThanOrEqual(checkedLayout.clientWidth);
  });
});
