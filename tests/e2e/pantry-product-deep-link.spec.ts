import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

test('una ficha de producto fuera de la primera pagina abre desde su URL', async ({
  page
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  await page.setViewportSize(viewport);
  await registerWithHousehold(page, '/pantry/products');

  const product = await page.evaluate(async () => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    if (!token) throw new Error('La fixture aislada no tiene sesión autenticada');

    const prefix = 'ZZ QA Deep Link Product ';
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    };

    for (let index = 0; index < 40; index++) {
      const response = await fetch('/api/pantry/products', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: `${prefix}${String(index).padStart(3, '0')}`,
          category: 'other',
          quantity: 0
        })
      });
      if (!response.ok) {
        throw new Error(`La fixture sintética de producto respondió HTTP ${response.status}`);
      }
    }

    const first = await fetch('/api/pantry/products?filter=all&limit=100&offset=0', { headers });
    if (!first.ok)
      throw new Error(`No se pudo contar el catálogo sintético (HTTP ${first.status})`);
    const { meta } = (await first.json()) as { meta: { total: number } };

    for (let offset = 100; offset < meta.total; offset += 100) {
      const response = await fetch(`/api/pantry/products?filter=all&limit=100&offset=${offset}`, {
        headers
      });
      if (!response.ok) {
        throw new Error(`No se pudo leer la página sintética ${offset} (HTTP ${response.status})`);
      }
      const payload = (await response.json()) as {
        data: { id: string; name: string }[];
      };
      const found = payload.data.find((row) => row.name.startsWith(prefix));
      if (found) return { ...found, offset };
    }

    throw new Error('La fixture no encontró un producto propio más allá de la página 100');
  });

  expect(product.offset).toBeGreaterThanOrEqual(100);
  await page.goto(`/pantry/products/${encodeURIComponent(product.id)}`);
  await expect(page.locator('[data-test="gestor-productos-ficha"]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/pantry/products/${product.id}$`));
  await expect(page.locator('[data-test="gestor-productos-campo-nombre"] input')).toHaveValue(
    product.name
  );
  const save = page.locator('[data-test="gestor-productos-guardar"]');
  await save.scrollIntoViewIfNeeded();
  const bounds = await page.evaluate(() => {
    const button = document
      .querySelector<HTMLElement>('[data-test="gestor-productos-guardar"]')
      ?.getBoundingClientRect();
    const navigation = document.querySelector<HTMLElement>('.bottom-nav')?.getBoundingClientRect();
    return {
      top: button?.top,
      bottom: button?.bottom,
      viewportHeight: window.innerHeight,
      navigationTop: navigation?.top ?? window.innerHeight
    };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  if (testInfo.project.name !== 'chromium') {
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.navigationTop);
  }
  const screenshotDirectory = join(
    resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-pantry-product-deep-link-1'),
    testInfo.project.name
  );
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, 'ficha-producto-cta.png'),
    animations: 'disabled'
  });

  await page.goto('/pantry/products/qa-deep-link-missing-product');
  await expect(page).toHaveURL(/\/pantry\/products$/);
  await expect(page.locator('[data-test="gestor-productos-lista"]')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
