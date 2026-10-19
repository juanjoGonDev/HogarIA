import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, Request, Response } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

test.describe('historial de Compra en vivo', () => {
  test('refresca la autoría por SSE cuando otra pestaña cambia la lista', async ({ page }) => {
    const pageErrors: string[] = [];
    const auditReads: Request[] = [];
    const streamResponses: Response[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error.message).split('\n')[0]));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        request.method() === 'GET' &&
        /\/api\/shopping\/lists\/[^/]+\/events$/.test(url.pathname)
      ) {
        auditReads.push(request);
      }
    });
    page.on('response', (response) => {
      if (/\/api\/shopping\/stream\/lists\/[^/]+$/.test(new URL(response.url()).pathname)) {
        streamResponses.push(response);
      }
    });

    await registerAndGoto(page, '/shopping', 'Persona auditoria');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Auditoría en vivo');
    await page.locator('[data-test="create-submit"]').click();
    await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
    const listId = new URL(page.url()).pathname.split('/').at(-1)!;

    await page.locator('[data-test="add-input"]').fill('Compra inicial SSE');
    await page.locator('[data-test="add-submit"]').click();
    await expect(page.locator('[data-test="item-row"]')).toContainText('Compra inicial SSE');
    await expect
      .poll(() => streamResponses.some((response) => response.status() === 200), {
        message: 'la pestaña principal debe tener su stream de eventos activo'
      })
      .toBe(true);
    const connectedStream = streamResponses.find((response) => response.status() === 200)!;
    expect(await connectedStream.headerValue('content-type')).toContain('text/event-stream');

    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.getByRole('button', { name: 'Quien ha tocado que' }).click();
    const auditSheet = page.locator('[data-test="audit-sheet"]');
    await expect(auditSheet).toBeVisible();
    await expect(
      auditSheet.locator('[data-test="audit-row"]', { hasText: 'Compra inicial SSE' })
    ).toHaveCount(1);
    const initialRows = await auditSheet.locator('[data-test="audit-row"]').count();
    const initialAuditReadCount = auditReads.length;

    // Mantener la pestaña secundaria abierta permite comprobar el estado inactivo: sin una
    // mutación, la hoja no vuelve a pedir el historial periódicamente.
    const collaborator = await page.context().newPage();
    const collaboratorErrors: string[] = [];
    collaborator.on('pageerror', (error) =>
      collaboratorErrors.push(String(error.message).split('\n')[0])
    );
    try {
      await collaborator.goto(`/shopping/${listId}`);
      await expect(collaborator.locator('.detail__title')).toContainText('Auditoría en vivo');
      await expect(collaborator.locator('[data-test="add-input"]')).toBeVisible();
      await collaborator.waitForTimeout(1200);
      expect(auditReads).toHaveLength(initialAuditReadCount);

      await collaborator.locator('[data-test="add-input"]').fill('Añadido desde otra pestaña');
      await collaborator.locator('[data-test="add-submit"]').click();
      await expect(
        collaborator.locator('[data-test="item-row"]', {
          hasText: 'Añadido desde otra pestaña'
        })
      ).toBeVisible();

      await expect(auditSheet.locator('[data-test="audit-row"]')).toHaveCount(initialRows + 1);
      const newEvent = auditSheet.locator('[data-test="audit-row"]', {
        hasText: 'Añadido desde otra pestaña'
      });
      await expect(newEvent).toBeVisible();
      await expect(newEvent.locator('app-avatar [title="Persona auditoria"]')).toBeVisible();
      expect(auditReads.length).toBeGreaterThan(initialAuditReadCount);
      await expect(page).toHaveURL(new RegExp(`/shopping/${listId}$`));
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      expect(collaboratorErrors).toEqual([]);

      const screenshotDirectory = resolve(
        process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-shopping-audit-live-20261010',
        test.info().project.name
      );
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, 'audit-updated.png')
      });
    } finally {
      await collaborator.close();
    }

    expect(pageErrors).toEqual([]);
  });
});
