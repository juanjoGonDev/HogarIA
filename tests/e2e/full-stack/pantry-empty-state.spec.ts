import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

type SeedIngredient = { id: string; quantity: number };

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key: string) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'el usuario sintético debe tener sesión autenticada').toBeTruthy();
  return token as string;
}

async function deletePersonalSeeds(page: Page, token: string): Promise<void> {
  const headers = { authorization: `Bearer ${token}` };
  const ingredients: SeedIngredient[] = [];
  let pageNumber = 1;
  let total = Number.POSITIVE_INFINITY;
  let totalPages = 0;

  while (ingredients.length < total) {
    const response = await page.request.get(
      `/api/pantry/ingredients?page=${pageNumber}&pageSize=100`,
      { headers }
    );
    expect(response.status(), 'solo se leen filas del usuario sintético').toBe(200);
    const payload = (await response.json()).data as {
      ingredients: SeedIngredient[];
      total: number;
      totalPages: number;
    };
    ingredients.push(...payload.ingredients);
    total = payload.total;
    totalPages = payload.totalPages;
    if (pageNumber >= totalPages) break;
    pageNumber += 1;
  }

  expect(ingredients.length, 'se eliminarán todas las filas iniciales propias').toBeGreaterThan(0);
  expect(ingredients.length).toBe(total);
  expect(
    ingredients.every((ingredient) => Number(ingredient.quantity) === 0),
    'el seed inicial solo contiene productos sugeridos, sin existencias'
  ).toBe(true);

  for (let offset = 0; offset < ingredients.length; offset += 100) {
    const batch = ingredients.slice(offset, offset + 100);
    const response = await page.request.post('/api/pantry/products/bulk-delete', {
      headers,
      data: { ids: batch.map(({ id }) => id) }
    });
    expect(response.status(), 'el lote solo borra los productos semilla del usuario propio').toBe(
      200
    );
    const payload = (await response.json()).data as { deleted: number };
    expect(payload.deleted).toBe(batch.length);
  }
}

async function captureEmptyState(
  page: Page,
  projectName: string,
  width: number,
  height: number
): Promise<void> {
  if (!SCREENSHOT_DIR) return;
  const directory = join(resolve(SCREENSHOT_DIR), projectName);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `pantry-empty-${width}x${height}.png`),
    fullPage: true,
    animations: 'disabled'
  });
}

test('la despensa realmente vacía ofrece alta manual y no modifica datos al cancelar', async ({
  page
}, testInfo) => {
  const pageErrors: string[] = [];
  let createRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));

  await registerAndGoto(page, '/pantry', 'QA Pantry Empty State');
  await expect(page.locator('h1.pantry__title')).toBeVisible();
  const token = await tokenOf(page);
  await deletePersonalSeeds(page, token);
  await page.reload();

  const emptyState = page.locator('.empty-state');
  const heading = page.getByRole('heading', { name: 'Tu inventario está vacío', exact: true });
  const description = page.getByText(
    'Empieza contando qué tienes en casa: la IA lo tendrá en cuenta',
    { exact: true }
  );
  const addFirst = page.getByRole('button', {
    name: 'Agregar primer ingrediente',
    exact: true
  });

  await expect(emptyState).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(description).toBeVisible();
  await expect(addFirst).toBeVisible();
  await expect(page.locator('[data-test="pantry-sugerencias"]')).toHaveCount(0);
  await expect(page.locator('[data-test="pantry-tabla-inventario"]')).toHaveCount(0);
  await expect(page.locator('[data-test="pantry-inventory-error"]')).toHaveCount(0);

  const viewports = [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 479, height: 851 },
    { width: 480, height: 851 },
    { width: 481, height: 851 },
    { width: 568, height: 320 },
    { width: 599, height: 851 },
    { width: 600, height: 851 },
    { width: 601, height: 851 },
    { width: 719, height: 851 },
    { width: 720, height: 851 },
    { width: 721, height: 851 },
    { width: 1022, height: 851 },
    { width: 1023, height: 851 },
    { width: 1024, height: 851 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(heading).toBeVisible();
    await expect(addFirst).toBeVisible();
    await addFirst.scrollIntoViewIfNeeded();

    const geometry = await page.evaluate(() => {
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const button = document
        .querySelector<HTMLElement>('.empty-state app-button button')
        ?.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>('.bottom-nav');
      const navRect = nav?.getBoundingClientRect();
      return {
        viewportWidth,
        viewportHeight: window.innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        buttonLeft: button?.left ?? null,
        buttonRight: button?.right ?? null,
        buttonTop: button?.top ?? null,
        buttonBottom: button?.bottom ?? null,
        bottomNavTop:
          nav && navRect && getComputedStyle(nav).display !== 'none' ? navRect.top : null
      };
    });
    expect(
      geometry.documentWidth,
      `el estado vacío no debe ensanchar la página en ${viewport.width}×${viewport.height}`
    ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.buttonLeft).not.toBeNull();
    expect(geometry.buttonRight).not.toBeNull();
    expect(geometry.buttonTop).toBeGreaterThanOrEqual(0);
    expect(geometry.buttonBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    if (geometry.bottomNavTop !== null) {
      expect(
        geometry.buttonBottom,
        `la CTA no debe quedar bajo la navegación fija en ${viewport.width}×${viewport.height}`
      ).toBeLessThanOrEqual(geometry.bottomNavTop + 1);
    }
  }

  const screenshotViewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(screenshotViewport);
  await addFirst.scrollIntoViewIfNeeded();
  await captureEmptyState(
    page,
    testInfo.project.name,
    screenshotViewport.width,
    screenshotViewport.height
  );

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/api/pantry/ingredients') {
      createRequests += 1;
    }
  });
  if (testInfo.project.name === 'mobile-chrome') {
    await addFirst.tap();
  } else {
    await addFirst.click();
  }
  await expect(page.locator('input#ingredientName')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('input#ingredientName')).toBeHidden();
  expect(createRequests, 'abrir y cancelar no debe crear ingredientes').toBe(0);

  const persisted = await page.request.get('/api/pantry/ingredients?page=1&pageSize=100', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(persisted.status()).toBe(200);
  const persistedPayload = (await persisted.json()).data as { total: number };
  expect(persistedPayload.total, 'la despensa debe seguir vacía después de cancelar').toBe(0);
  expect(pageErrors, 'la vista vacía no debe romper Angular').toEqual([]);
});
