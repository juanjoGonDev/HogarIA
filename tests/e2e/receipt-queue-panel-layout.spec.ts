import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

test('el panel de cola queda fuera del lateral y dentro del viewport', async ({ page }) => {
  const browserErrors: string[] = [];
  const appOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:4200').origin;
  page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.location().url.startsWith(appOrigin)) {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin === appOrigin) {
      const failure = request.failure()?.errorText ?? 'unknown';
      const cancelledRead =
        request.method() === 'GET' &&
        /^(?:Load request cancelled|net::ERR_ABORTED|NS_BINDING_ABORTED)$/i.test(failure);
      if (cancelledRead) return;
      browserErrors.push(`requestfailed: ${request.url()} (${failure})`);
    }
  });

  await registerAndGoto(page, '/dashboard', 'receipt-queue-layout');
  await page.waitForFunction(() => {
    const currentDocument = document as Document & { activeViewTransition?: unknown };
    return !currentDocument.activeViewTransition;
  });
  await waitForStableView(page);
  const initialViewport = page.viewportSize()!;
  const isDesktop = initialViewport.width >= 1024;
  if (isDesktop) await page.setViewportSize({ width: 1440, height: 900 });
  const viewport = page.viewportSize()!;
  const queueButton =
    viewport.width >= 1024
      ? page.locator('.sidebar [data-test="receipt-queue-icon"]')
      : page.locator('.header [data-test="receipt-queue-icon"]');
  await expect(queueButton).toBeVisible();
  const triggerSize = await queueButton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(triggerSize.width).toBeGreaterThanOrEqual(44);
  expect(triggerSize.height).toBeGreaterThanOrEqual(44);
  await queueButton.click();

  const panel = page.locator('[data-test="receipt-queue-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Nada en la cola');
  await waitForStableView(page);

  const bounds = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const sidebar = element.closest('.sidebar');
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      sidebarRight: sidebar?.getBoundingClientRect().right ?? null
    };
  });
  expect(bounds.left, 'el panel completo debe quedar dentro del viewport').toBeGreaterThanOrEqual(
    8
  );
  expect(bounds.right, 'el panel completo debe quedar dentro del viewport').toBeLessThanOrEqual(
    viewport.width - 8
  );
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
  if (viewport.width >= 1024) {
    expect(bounds.sidebarRight).not.toBeNull();
    expect(
      bounds.right,
      'el panel debe expandirse sobre el contenido, no quedar atrapado en el lateral'
    ).toBeGreaterThan(bounds.sidebarRight!);
    expect(
      bounds.left,
      'el panel debe empezar después del lateral y no quedar metido en él'
    ).toBeGreaterThanOrEqual(bounds.sidebarRight! + 8);

    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await waitForStableView(page);
      const resizedBounds = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const sidebar = element.closest('.sidebar')!;
        return {
          left: rect.left,
          right: rect.right,
          sidebarRight: sidebar.getBoundingClientRect().right
        };
      });
      expect(
        resizedBounds.left,
        `a ${width}px el panel debe dejar libre el lateral`
      ).toBeGreaterThanOrEqual(resizedBounds.sidebarRight + 8);
      expect(resizedBounds.right).toBeLessThanOrEqual(width - 8);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await waitForStableView(page);
  }

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, 'receipt-queue-panel.png') });
  }

  if (!isDesktop) {
    await page.setViewportSize({ width: 568, height: 320 });
    await waitForStableView(page);
    const landscapeBounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    expect(landscapeBounds.left).toBeGreaterThanOrEqual(8);
    expect(landscapeBounds.right).toBeLessThanOrEqual(560);
    expect(landscapeBounds.top).toBeGreaterThanOrEqual(0);
    expect(landscapeBounds.bottom).toBeLessThanOrEqual(320);
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, 'receipt-queue-panel-568x320.png') });
    }

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 568 });
    await queueButton.click();
    await expect(panel).toBeVisible();
    await waitForStableView(page);
    const narrowBounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    expect(narrowBounds.left).toBeGreaterThanOrEqual(8);
    expect(narrowBounds.right).toBeLessThanOrEqual(312);
    expect(narrowBounds.top).toBeGreaterThanOrEqual(0);
    expect(narrowBounds.bottom).toBeLessThanOrEqual(568);
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, 'receipt-queue-panel-320x568.png') });
    }
  }

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  if (!isDesktop) {
    await page.locator('.header__menu').click();
    const drawerQueueButton = page.locator('.sidebar [data-test="receipt-queue-icon"]');
    await expect(drawerQueueButton).toBeVisible();
    await drawerQueueButton.click();
    await expect(panel).toBeVisible();
    const drawerPanelBounds = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      };
    });
    expect(drawerPanelBounds.left).toBeGreaterThanOrEqual(8);
    expect(drawerPanelBounds.right).toBeLessThanOrEqual(page.viewportSize()!.width - 8);
    expect(drawerPanelBounds.top).toBeGreaterThanOrEqual(0);
    expect(drawerPanelBounds.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, 'receipt-queue-panel-drawer.png') });
    }
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  }

  expect(browserErrors, 'el flujo no debe introducir errores de consola o JavaScript').toEqual([]);
});

test('la cola desplaza varios tickets sin salirse de la pantalla estrecha', async ({ page }) => {
  await registerAndGoto(page, '/receipts', 'receipt-queue-scroll');
  const ticketInput = page.locator('input[name="ticketFile"]');
  const ticketRows = page.locator('[data-test="ticket-history-item"]');

  for (let index = 1; index <= 10; index++) {
    await ticketInput.setInputFiles({
      name: `synthetic-ticket-${index}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    });
    await expect(ticketRows).toHaveCount(index, { timeout: 20000 });
  }

  await page.setViewportSize({ width: 320, height: 568 });
  const queueButton = page.locator('.header [data-test="receipt-queue-icon"]');
  await expect(queueButton).toBeVisible();
  await queueButton.click();

  const panel = page.locator('[data-test="receipt-queue-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-test="queue-job-failed"]')).toHaveCount(10);
  const scrollDimensions = await panel.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop
  }));
  expect(scrollDimensions.left).toBeGreaterThanOrEqual(8);
  expect(scrollDimensions.right).toBeLessThanOrEqual(312);
  expect(scrollDimensions.scrollHeight).toBeGreaterThan(scrollDimensions.height);

  await panel.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, 'receipt-queue-panel-scrolled.png') });
  }

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});
