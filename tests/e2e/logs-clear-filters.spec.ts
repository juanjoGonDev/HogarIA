import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

test.describe('filtros y borrado de Logs', () => {
  test('filtra por nivel y solo borra tras confirmar un DELETE exitoso', async ({ page }) => {
    await registerAndGoto(page, '/logs', 'logs-clear-filters');
    await expect(page.locator('.terminal__body')).toBeVisible();
    const screenshotDir =
      process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-logs-clear-filters';
    await mkdir(screenshotDir, { recursive: true });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tag = `e2e-log-level-${Date.now()}`;
    for (const level of ['error', 'warn', 'info'] as const) {
      const response = await page.request.post('/api/logs', {
        data: { level, message: `${tag}-${level}`, url: 'e2e' }
      });
      expect(response.ok()).toBeTruthy();
    }

    await page.reload();
    const markerLines = page.locator('[data-test="logs-line"]').filter({ hasText: tag });
    await expect(markerLines).toHaveCount(3);

    const sourceFilter = page.getByRole('combobox', { name: 'Filtrar por fuente' });
    const levelFilter = page.getByRole('combobox', { name: 'Filtrar por nivel' });
    await expect(sourceFilter).toBeVisible();
    await expect(levelFilter).toBeVisible();
    await sourceFilter.selectOption('server');
    await expect(markerLines).toHaveCount(0);
    await sourceFilter.selectOption('all');
    await expect(markerLines).toHaveCount(3);
    await levelFilter.selectOption('error');
    await expect(markerLines).toHaveCount(1);
    await expect(markerLines.first()).toContainText(`${tag}-error`);
    await levelFilter.selectOption('all');
    await expect(markerLines).toHaveCount(3);

    const errorLine = markerLines.filter({ hasText: `${tag}-error` });
    await errorLine.click();
    await expect(errorLine).toHaveClass(/terminal__line--selected/);

    let deleteAttempts = 0;
    let failNextDelete = true;
    await page.route('**/api/logs*', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'DELETE' && pathname === '/api/logs') {
        deleteAttempts += 1;
        if (failNextDelete) {
          failNextDelete = false;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, message: 'Synthetic unavailable' })
          });
          return;
        }
      }
      await route.continue();
    });

    const clearButton = page.getByRole('button', { name: 'Limpiar', exact: true });
    await clearButton.click();
    let dialog = page.getByRole('dialog', { name: 'Borrar logs' });
    await expect(dialog).toBeVisible();
    await dialog.screenshot({
      path: join(screenshotDir, `logs-clear-confirm-${test.info().project.name}.png`)
    });
    const cancelButton = dialog.getByRole('button', { name: 'Cancelar' });
    const confirmButton = dialog.getByRole('button', { name: 'Borrar', exact: true });
    for (const button of [cancelButton, confirmButton]) {
      const bounds = await button.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(clearButton).toBeFocused();
    expect(deleteAttempts).toBe(0);
    await expect(errorLine).toHaveClass(/terminal__line--selected/);

    await clearButton.click();
    dialog = page.getByRole('dialog', { name: 'Borrar logs' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(clearButton).toBeFocused();
    expect(deleteAttempts).toBe(0);
    await expect(markerLines).toHaveCount(3);
    await expect(errorLine).toHaveClass(/terminal__line--selected/);

    await clearButton.click();
    dialog = page.getByRole('dialog', { name: 'Borrar logs' });
    const failedDelete = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === '/api/logs' &&
        response.status() === 503
    );
    await dialog.getByRole('button', { name: 'Borrar', exact: true }).click();
    await failedDelete;

    const errorToast = page.locator('.toast-container--top .toast--error').first();
    await expect(errorToast).toBeVisible();
    await expect(errorToast).toContainText('Servicio no disponible');
    await expect(errorToast).toHaveAttribute('role', 'alert');
    await expect(errorToast).toHaveAttribute('aria-live', 'assertive');
    expect(pageErrors).toEqual([]);
    await errorToast.screenshot({
      path: join(screenshotDir, `logs-clear-error-${test.info().project.name}.png`)
    });

    // A failed clear must leave both the visible entries and the user's selection intact.
    await expect(markerLines).toHaveCount(3);
    await expect(errorLine).toHaveClass(/terminal__line--selected/);

    const successfulDelete = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' && new URL(response.url()).pathname === '/api/logs'
    );
    await clearButton.click();
    dialog = page.getByRole('dialog', { name: 'Borrar logs' });
    await dialog.getByRole('button', { name: 'Borrar', exact: true }).click();
    const response = await successfulDelete;
    expect(response.status()).toBe(200);
    expect(deleteAttempts).toBe(2);

    // El stream de logs es global al proceso: otros workers de la shard pueden seguir añadiendo
    // entradas del servidor justo después del DELETE. Verificamos las filas sintéticas de este test.
    await expect(markerLines).toHaveCount(0);
    await expect(page.locator('.terminal__line--selected')).toHaveCount(0);
  });
});
