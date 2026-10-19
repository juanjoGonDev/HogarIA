import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

function trayRow(page: Page, name: string) {
  return page.locator('[data-test="list-row"]', { hasText: name });
}

async function createList(page: Page, name: string): Promise<void> {
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill(name);
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
  await page.locator('[data-test="back"]').click();
  await expect(trayRow(page, name)).toBeVisible();
}

async function capture(page: Page, testInfo: TestInfo, fileName: string): Promise<void> {
  const root = process.env.E2E_SCREENSHOT_DIR;
  if (!root) return;
  const directory = join(root, testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, fileName),
    animations: 'disabled'
  });
}

async function expectNoHorizontalOverflowAcrossBreakpoints(page: Page): Promise<void> {
  const originalViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 568, height: 320 },
    { width: 1023, height: 768 },
    { width: 1024, height: 768 },
    { width: 1025, height: 768 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const width = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth
    }));
    expect(
      width.document,
      `horizontal overflow at ${viewport.width}x${viewport.height}`
    ).toBeLessThanOrEqual(width.viewport);
  }
  await page.setViewportSize(originalViewport);
}

test('el editor de renombre tiene nombre accesible y guarda al salir del campo', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/shopping', 'tray-rename-label');
  await createList(page, 'Cesta original');

  await trayRow(page, 'Cesta original').getByRole('button', { name: 'Renombrar' }).click();
  const input = page.locator('[data-test="rename-input"]');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await capture(page, testInfo, 'shopping-tray-rename-editor-baseline.png');
  await expect(input).toHaveAccessibleName('Renombrar la lista');
  await expectNoHorizontalOverflowAcrossBreakpoints(page);

  await input.fill('Cesta guardada al salir');
  await page.getByRole('heading', { name: 'Lista de la compra' }).click();
  await expect(trayRow(page, 'Cesta guardada al salir')).toBeVisible();
  await page.reload();
  await expect(trayRow(page, 'Cesta guardada al salir')).toBeVisible();
  await capture(page, testInfo, 'shopping-tray-renamed.png');
});

test('un conflicto conserva el título, avisa una vez y permite reintentar', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/shopping', 'tray-rename-conflict');
  await createList(page, 'Nombre conservado');

  const href = await trayRow(page, 'Nombre conservado').getByRole('link').getAttribute('href');
  const listId = href?.split('/').at(-1);
  expect(listId).toBeTruthy();
  const endpoint = `**/api/shopping/lists/${listId}`;
  let conflictPatchCount = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    conflictPatchCount += 1;
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        message: 'LIST_VERSION_CONFLICT',
        data: { currentVersion: 2 }
      })
    });
  });

  await trayRow(page, 'Nombre conservado').getByRole('button', { name: 'Renombrar' }).click();
  const input = page.locator('[data-test="rename-input"]');
  await input.fill('Nombre que entra en conflicto');
  const conflictResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes(`/lists/${listId}`)
  );
  await input.press('Enter');
  expect((await conflictResponse).status()).toBe(409);
  expect(conflictPatchCount).toBe(1);
  await expect(input).toHaveCount(0);
  await expect(trayRow(page, 'Nombre conservado')).toBeVisible();
  await capture(page, testInfo, 'shopping-tray-rename-conflict-baseline.png');
  await expect(page.locator('.toast--warning')).toContainText('La lista cambio en otro aparato');
  await expect(page.locator('.toast--warning')).toHaveCount(1);
  await expect(page.locator('.toast--error')).toHaveCount(0);

  await page.unroute(endpoint);
  await trayRow(page, 'Nombre conservado').getByRole('button', { name: 'Renombrar' }).click();
  await input.fill('Nombre reintentado');
  await page.getByRole('heading', { name: 'Lista de la compra' }).click();
  await expect(trayRow(page, 'Nombre reintentado')).toBeVisible();
  await page.reload();
  await expect(trayRow(page, 'Nombre reintentado')).toBeVisible();
  await capture(page, testInfo, 'shopping-tray-rename-conflict-recovered.png');
  await expectNoHorizontalOverflowAcrossBreakpoints(page);
});
