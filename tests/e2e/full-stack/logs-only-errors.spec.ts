import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';

test.describe('filtro independiente Solo errores en Logs', () => {
  test('combina fuente y nivel sin reemplazarlos, también por teclado y en móvil', async ({
    page
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await registerAndGoto(page, '/logs', 'logs-only-errors');
    const tag = `e2e-only-errors-${Date.now()}`;

    for (const level of ['error', 'warn', 'info'] as const) {
      const response = await page.request.post('/api/logs', {
        data: { level, message: `${tag}-${level}`, url: 'e2e' }
      });
      expect(response.ok()).toBeTruthy();
    }

    await page.reload();
    await expect(page.locator('.terminal__body')).toBeVisible();

    const markerLines = page.locator('[data-test="logs-line"]').filter({ hasText: tag });
    await expect(markerLines).toHaveCount(3);

    const sourceFilter = page.getByRole('combobox', { name: 'Filtrar por fuente' });
    const levelFilter = page.getByRole('combobox', { name: 'Filtrar por nivel' });
    const onlyErrors = page.getByRole('checkbox', { name: 'Solo errores' });
    const control = page.locator('[data-test="logs-only-errors-control"]');

    await expect(onlyErrors).toBeVisible();
    await expect(onlyErrors).not.toBeChecked();
    await expect(control).toHaveCSS('min-height', '44px');
    await onlyErrors.focus();
    await expect(onlyErrors).toBeFocused();
    await expect(onlyErrors).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Space');
    await expect(onlyErrors).toBeChecked();
    await expect(markerLines).toHaveCount(1);
    await expect(markerLines.first()).toContainText(`${tag}-error`);

    // Solo errores es un predicado separado: la fuente continúa actuando sobre el resultado.
    await sourceFilter.selectOption('server');
    await expect(markerLines).toHaveCount(0);
    await sourceFilter.selectOption('browser');
    await expect(markerLines).toHaveCount(1);

    // El nivel también permanece seleccionado aunque la intersección no tenga resultados.
    await levelFilter.selectOption('warn');
    await expect(markerLines).toHaveCount(0);
    await onlyErrors.focus();
    await page.keyboard.press('Space');
    await expect(onlyErrors).not.toBeChecked();
    await expect(levelFilter).toHaveValue('warn');
    await expect(sourceFilter).toHaveValue('browser');
    await expect(markerLines).toHaveCount(1);
    await expect(markerLines.first()).toContainText(`${tag}-warn`);

    await levelFilter.selectOption('all');
    await expect(markerLines).toHaveCount(3);
    if (test.info().project.name === 'mobile-chrome') {
      await onlyErrors.tap();
    } else {
      await control.click();
    }
    await expect(onlyErrors).toBeChecked();
    await expect(markerLines).toHaveCount(1);

    for (const size of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 1023, height: 768 },
      { width: 1024, height: 768 },
      { width: 1025, height: 768 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(size.width);
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    expect(pageErrors).toEqual([]);

    const screenshotDir = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('.logs-toolbar__filters').screenshot({
        path: join(screenshotDir, `logs-only-errors-desktop-${test.info().project.name}.png`)
      });
      await page.setViewportSize({ width: 393, height: 851 });
      await page.locator('.logs-toolbar__filters').screenshot({
        path: join(screenshotDir, `logs-only-errors-mobile-${test.info().project.name}.png`)
      });
    }
  });
});
