import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

function trayRow(page: Page, name: string): Locator {
  return page.locator('[data-test="list-row"]', { hasText: name });
}

async function createList(page: Page, name: string): Promise<string> {
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill(name);
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
  const listId = new URL(page.url()).pathname.split('/').filter(Boolean).pop();
  if (!listId) throw new Error('La ruta no contiene el id de la lista creada');
  await page.locator('[data-test="back"]').click();
  await expect(trayRow(page, name)).toBeVisible();
  return listId;
}

async function captureIfRequested(page: Page, testInfo: TestInfo, fileName: string): Promise<void> {
  const root = process.env.E2E_SCREENSHOT_DIR;
  if (!root) return;
  const directory = join(root, testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, fileName),
    fullPage: true,
    animations: 'disabled'
  });
}

async function waitForPaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

test.describe('Bandeja: ciclo de vida de una lista', () => {
  test('terminar y reabrir desde el historial conserva el estado tras recargar', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/shopping', 'tray-lifecycle-status');
    const name = 'QA estado bandeja';
    const listId = await createList(page, name);

    await trayRow(page, name)
      .getByRole('link', { name: `Abrir ${name}` })
      .click();
    await page.locator('[data-test="add-input"]').fill('1 Cafe');
    await page.locator('[data-test="add-submit"]').click();
    const item = page.locator('[data-test="item-row"]', {
      has: page.locator('.detail__name', { hasText: 'Cafe' })
    });
    await expect(item).toBeVisible();
    await item.locator('.detail__more').click();
    await page.locator('[data-test="price-input"]').fill('3,20');
    await page.locator('[data-test="price-input"]').blur();
    await page.locator('[data-test="edit-sheet"]').getByRole('button', { name: /Hecho/i }).click();
    await item.locator('[data-test="check"]').click();
    await page.locator('[data-test="back"]').click();
    await expect(trayRow(page, name)).toBeVisible();
    const finish = trayRow(page, name).locator(`[data-test="row-done-${listId}"] button`);
    await expect(finish).toHaveAccessibleName(/Terminar/i);
    await finish.click();
    await expect(
      page.locator('.toast__title').filter({ hasText: 'Lista terminada' })
    ).toBeVisible();
    await expect(trayRow(page, name)).toHaveCount(0);
    await page.getByRole('button', { name: 'Terminadas' }).click();
    await expect(page).toHaveURL(/status=done/);

    const doneRow = trayRow(page, name);
    const reopen = doneRow.locator(`[data-test="row-done-${listId}"] button`);
    await expect(reopen).toHaveAccessibleName(/Reabrir/i);

    let reopenFailures = 0;
    const listUrl = `**/api/shopping/lists/${listId}`;
    await page.route(listUrl, async (route) => {
      if (route.request().method() === 'PATCH' && reopenFailures === 0) {
        reopenFailures += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'synthetic unavailable' })
        });
        return;
      }
      await route.continue();
    });

    const failedReopen = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/shopping/lists/${listId}` &&
        response.status() === 503
    );
    await reopen.click();
    await failedReopen;
    const serviceUnavailable = page
      .getByRole('alert')
      .filter({ hasText: 'Servicio no disponible' });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.name));
    await expect(serviceUnavailable).toHaveCount(1);
    await expect(serviceUnavailable).toBeVisible();
    await expect.poll(() => reopenFailures).toBe(1);
    await expect(doneRow).toBeVisible();
    await serviceUnavailable.evaluate(async (alert) => {
      await Promise.all(alert.getAnimations().map((animation) => animation.finished));
    });
    await waitForPaint(page);
    await captureIfRequested(page, testInfo, 'shopping-list-reopen-503.png');
    const originalViewport = page.viewportSize();
    if (!originalViewport) throw new Error('El contexto Playwright no informa el viewport');
    const viewports = [
      { width: 1440, height: 900, fileName: 'shopping-toast-503-1440x900.png' },
      { width: 390, height: 844, fileName: 'shopping-toast-503-390x844.png' },
      { width: 480, height: 800, fileName: 'shopping-toast-503-480x800.png' },
      { width: 481, height: 800, fileName: 'shopping-toast-503-481x800.png' },
      { width: 1023, height: 800, fileName: 'shopping-toast-503-1023x800.png' },
      { width: 1024, height: 800, fileName: 'shopping-toast-503-1024x800.png' },
      { width: 320, height: 740, fileName: 'shopping-toast-503-320x740.png' },
      { width: 320, height: 568, fileName: 'shopping-toast-503-320x568.png' },
      { width: 568, height: 320, fileName: 'shopping-toast-503-568x320.png' }
    ];
    for (const viewport of viewports) {
      const { fileName, ...size } = viewport;
      await page.setViewportSize(size);
      await expect(serviceUnavailable).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth
      }));
      expect(dimensions.viewport).toBe(viewport.width);
      expect(
        dimensions.document,
        `desbordamiento horizontal a ${viewport.width}px`
      ).toBeLessThanOrEqual(dimensions.viewport);
      const alertBox = await serviceUnavailable.boundingBox();
      expect(alertBox).not.toBeNull();
      if (alertBox) {
        expect(alertBox.x).toBeGreaterThanOrEqual(0);
        expect(
          alertBox.x + alertBox.width,
          `alerta fuera del viewport ${viewport.width}×${viewport.height}`
        ).toBeLessThanOrEqual(viewport.width);
        const rightInset = viewport.width - (alertBox.x + alertBox.width);
        expect(Math.abs(rightInset - 16)).toBeLessThanOrEqual(1);
        expect(alertBox.width).toBeLessThanOrEqual(Math.min(400, viewport.width - 32) + 1);
        if (viewport.width < 1024) {
          const headerBox = await page.locator('.header').boundingBox();
          expect(headerBox).not.toBeNull();
          if (headerBox) {
            expect(alertBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height + 8);
          }
        } else {
          await expect(page.locator('.header')).toBeHidden();
          expect(Math.abs(alertBox.y - 16)).toBeLessThanOrEqual(1);
        }
      }
      await captureIfRequested(page, testInfo, fileName);
    }
    expect(pageErrors).toEqual([]);
    await page.setViewportSize(originalViewport);
    await expect(page.locator('.toast__title').filter({ hasText: 'Lista reabierta' })).toHaveCount(
      0
    );

    await page.unroute(listUrl);
    await reopen.click();
    await expect(page.locator('[data-test="list-row"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Activas' }).click();
    await expect(trayRow(page, name)).toBeVisible();
    await page.reload();
    const reopenedRow = trayRow(page, name);
    await expect(reopenedRow).toBeVisible();
    await captureIfRequested(page, testInfo, 'shopping-list-reopened.png');
    await reopenedRow.getByRole('link', { name: `Abrir ${name}` }).click();
    await page.locator('[data-test="tab-cart"]').click();
    const reopenedItem = page.locator('[data-test="item-row"]', {
      has: page.locator('.detail__name', { hasText: 'Cafe' })
    });
    await expect(reopenedItem).toHaveClass(/detail__row--checked/);
    await expect(reopenedItem.locator('.detail__price')).toHaveText('3,20 €');
    await captureIfRequested(page, testInfo, 'shopping-list-reopened-details.png');
  });

  test('Cancelar conserva; borrar fallido no da éxito y permite reintentar', async ({
    page
  }, testInfo) => {
    const nativeDialogs: string[] = [];
    const pageErrors: string[] = [];
    let deleteRequests = 0;
    let deleteFailures = 0;
    page.on('dialog', async (dialog) => {
      nativeDialogs.push(dialog.type());
      await dialog.dismiss();
    });
    page.on('pageerror', (error) => pageErrors.push(error.name));
    await registerAndGoto(page, '/shopping', 'tray-lifecycle-delete');
    const otherName = 'QA otra lista';
    const targetName = 'QA borrar bandeja';
    await createList(page, otherName);
    const listId = await createList(page, targetName);
    const target = trayRow(page, targetName);
    await target.getByRole('link', { name: `Abrir ${targetName}` }).click();
    await page.locator('[data-test="add-input"]').fill('1 Cacao');
    await page.locator('[data-test="add-submit"]').click();
    const targetItem = page.locator('[data-test="item-row"]', {
      has: page.locator('.detail__name', { hasText: 'Cacao' })
    });
    await expect(targetItem).toBeVisible();
    await page.locator('[data-test="back"]').click();
    await expect(target).toBeVisible();

    const listUrl = `**/api/shopping/lists/${listId}`;
    await page.route(listUrl, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deleteRequests += 1;
      if (deleteFailures === 0) {
        deleteFailures += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'synthetic unavailable' })
        });
        return;
      }
      await route.continue();
    });

    const deleteButton = target.getByRole('button', { name: 'Borrar lista' });
    const dialog = page.getByRole('dialog', { name: '¿Borrar esta lista?' });

    await deleteButton.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(targetName);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('El contexto Playwright no informa el viewport');
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(viewport.width);
    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds).not.toBeNull();
    if (dialogBounds) {
      expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
      expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(viewport.width);
    }
    await captureIfRequested(page, testInfo, 'shopping-list-delete-confirmation.png');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    expect(deleteRequests).toBe(0);
    await expect(target).toBeVisible();
    await target.getByRole('link', { name: `Abrir ${targetName}` }).click();
    await expect(targetItem).toBeVisible();
    await page.locator('[data-test="back"]').click();
    await expect(target).toBeVisible();

    const failedDelete = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === `/api/shopping/lists/${listId}` &&
        response.status() === 503
    );
    await deleteButton.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Borrar' }).click();
    await failedDelete;
    await expect(
      page.getByRole('alert').filter({ hasText: 'Servicio no disponible' })
    ).toBeVisible();
    await expect.poll(() => deleteFailures).toBe(1);
    await expect(target).toBeVisible();
    await waitForPaint(page);
    await captureIfRequested(page, testInfo, 'shopping-list-delete-after-failure.png');
    await expect(page.locator('.toast__title').filter({ hasText: 'Lista borrada' })).toHaveCount(0);
    expect(deleteRequests).toBe(1);
    await target.getByRole('link', { name: `Abrir ${targetName}` }).click();
    await expect(targetItem).toBeVisible();
    await page.locator('[data-test="back"]').click();
    await expect(target).toBeVisible();

    const successfulDelete = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === `/api/shopping/lists/${listId}` &&
        response.status() === 200
    );
    await deleteButton.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Borrar' }).click();
    await successfulDelete;
    expect(deleteRequests).toBe(2);
    expect(deleteFailures).toBe(1);
    await expect(target).toHaveCount(0);
    await expect(trayRow(page, otherName)).toBeVisible();
    await page.reload();
    await expect(trayRow(page, targetName)).toHaveCount(0);
    await expect(trayRow(page, otherName)).toBeVisible();
    expect(nativeDialogs).toEqual([]);
    expect(pageErrors).toEqual([]);
    await captureIfRequested(page, testInfo, 'shopping-list-delete-completed.png');
  });
});
