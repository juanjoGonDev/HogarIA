import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

function trayRow(page: Page, name: string): Locator {
  return page.locator('[data-test="list-row"]', { hasText: name });
}

async function createList(page: Page, name: string, store: string): Promise<void> {
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill(name);
  await page.locator('input[name="listStore"]').fill(store);
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
  await page.locator('[data-test="back"]').click();
  await expect(trayRow(page, name)).toBeVisible();
}

async function captureAppliedFilter(page: Page, testInfo: TestInfo): Promise<void> {
  const root = process.env.E2E_SCREENSHOT_DIR;
  if (!root) return;
  const directory = join(root, testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, 'shopping-tray-store-filter.png'),
    animations: 'disabled'
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test('el filtro de tienda queda en el enlace y se recupera tras recargar', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/shopping', 'tray-store-filter');
  await createList(page, 'QA tienda Ahorro', 'Ahorro');
  await createList(page, 'QA tienda Mercado', 'Mercado');
  await expect(page.locator('[data-test="list-row"]')).toHaveCount(2);

  await page.locator('.tray__filter-toggle').click();
  await page.getByRole('button', { name: 'Tienda' }).click();
  await page.getByRole('option', { name: /Ahorro/ }).click();

  await expect(page).toHaveURL(/store=Ahorro/);
  await expect(page.locator('[data-test="list-row"]')).toHaveCount(1);
  await expect(trayRow(page, 'QA tienda Ahorro')).toBeVisible();
  await expect(trayRow(page, 'QA tienda Mercado')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await captureAppliedFilter(page, testInfo);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Tienda: Ahorro' })).toBeVisible();
  await expect(page.locator('[data-test="list-row"]')).toHaveCount(1);
  await expect(trayRow(page, 'QA tienda Ahorro')).toBeVisible();
  await expect(trayRow(page, 'QA tienda Mercado')).toHaveCount(0);

  await page.getByRole('button', { name: /Quitar los 1 filtros/i }).click();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(page.locator('[data-test="list-row"]')).toHaveCount(2);
  await expect(trayRow(page, 'QA tienda Ahorro')).toBeVisible();
  await expect(trayRow(page, 'QA tienda Mercado')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
