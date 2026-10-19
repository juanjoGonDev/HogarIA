import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { expect, Page, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token).toBeTruthy();
  return token as string;
}

function seedReviewReceipt(databasePath: string, runDirectory: string, userId: string) {
  const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
  if (isAbsolute(relativeDatabasePath) || relativeDatabasePath.startsWith('..')) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test');
  }

  const receiptId = `receipt-line-remove-${randomUUID()}`;
  const lineId = `${receiptId}-line`;
  const createdAt = new Date('2026-10-10T00:00:00.000Z').toISOString();
  const database = new Database(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO receipts (
          id, user_id, status, store, purchase_date, currency, total_minor,
          file_url, file_kind, file_name, file_bytes, created_at
        ) VALUES (?, ?, 'review', 'Mercado QA', '2026-10-09', 'EUR', 300, ?, 'png', ?, 8, ?)`
      )
      .run(
        receiptId,
        userId,
        `/api/uploads/receipts/${receiptId}.png`,
        'ticket-line-remove-synthetic.png',
        createdAt
      );
    database
      .prepare(
        `INSERT INTO receipt_items (
          id, receipt_id, name, quantity, unit, category, price_minor,
          offer_buy, offer_take, note, confidence, position
        ) VALUES (?, ?, 'Producto QA', 1, 'ud', 'other', 300, NULL, NULL, '', 0.99, 0)`
      )
      .run(lineId, receiptId);
  } finally {
    database.close();
  }
  return { receiptId, lineId };
}

test.describe('quitar una línea del ticket', () => {
  for (const scenario of [
    {
      language: 'es',
      removeName: 'Quitar la línea',
      cancelName: 'Cancelar',
      confirmName: 'Eliminar',
      mismatch: 'No cuadra con el total del ticket'
    },
    {
      language: 'en',
      removeName: 'Remove line',
      cancelName: 'Cancel',
      confirmName: 'Delete',
      mismatch: "Doesn't match the receipt total"
    }
  ] as const) {
    test(`confirma la eliminación, actualiza suma y conserva cancelación (${scenario.language})`, async ({
      page
    }, testInfo) => {
      await registerAndGoto(page, '/receipts');
      await page.evaluate((language) => {
        window.localStorage.setItem('hogar:v1:language', language);
      }, scenario.language);
      await page.reload();

      const token = await tokenOf(page);
      const profileResponse = await page.request.get('/api/auth/profile', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(profileResponse.ok()).toBeTruthy();
      const profile = (await profileResponse.json()) as { data: { id: string } };

      const runDirectory = process.env.E2E_RUN_DIR;
      const databasePath = process.env.DATABASE_PATH;
      if (!runDirectory || !databasePath) throw new Error('E2E requiere rutas temporales aisladas');
      const { receiptId, lineId } = seedReviewReceipt(databasePath, runDirectory, profile.data.id);

      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await page.goto(`/receipts/${receiptId}`);

      const lineButton = page.getByRole('button', { name: scenario.removeName, exact: true });
      await expect(lineButton).toBeVisible();
      await expect(page.locator('.ficha__totales .ficha__total-importe')).toHaveCount(2);
      await expect(page.locator('.ficha__totales .ficha__total-importe').nth(0)).toContainText(
        /3[.,]00\s*€/
      );
      await expect(page.locator('.ficha__no-cuadra')).toHaveCount(0);

      const isMobile = testInfo.project.name === 'mobile-chrome';
      const inspectViewport = async (width: number, height: number) => {
        await page.setViewportSize({ width, height });
        const dimensions = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth
        }));
        expect(dimensions.content, `sin overflow a ${width}×${height}`).toBeLessThanOrEqual(
          dimensions.viewport
        );
        if (isMobile) {
          const geometry = await lineButton.evaluate((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          });
          expect(
            geometry.width,
            `ancho objetivo táctil a ${width}×${height}`
          ).toBeGreaterThanOrEqual(44);
          expect(
            geometry.height,
            `alto objetivo táctil a ${width}×${height}`
          ).toBeGreaterThanOrEqual(44);
        }
        const icon = await lineButton.locator('app-icon svg').boundingBox();
        expect(icon?.width).toBe(14);
        expect(icon?.height).toBe(14);
      };
      const screenshotDirectory =
        process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputPath('screenshots');
      mkdirSync(screenshotDirectory, { recursive: true });
      if (isMobile) {
        await inspectViewport(390, 844);
        await page.screenshot({
          path: join(screenshotDirectory, `receipt-line-remove-${scenario.language}-mobile.png`),
          fullPage: true
        });
        await inspectViewport(320, 740);
      } else {
        await inspectViewport(1440, 900);
        await page.screenshot({
          path: join(screenshotDirectory, `receipt-line-remove-${scenario.language}-desktop.png`),
          fullPage: true
        });
      }

      const deletePath = `/api/receipts/${receiptId}/items/${lineId}`;
      let deleteCount = 0;
      page.on('request', (request) => {
        if (request.method() === 'DELETE' && new URL(request.url()).pathname === deletePath) {
          deleteCount += 1;
        }
      });

      const openDialog = async () => {
        await lineButton.click();
        const dialog = page.locator('app-confirm-dialog .modal-overlay');
        await expect(dialog).toContainText('Producto QA');
        await expect(
          dialog.getByRole('button', { name: scenario.cancelName, exact: true })
        ).toBeVisible();
        await expect(
          dialog.getByRole('button', { name: scenario.confirmName, exact: true })
        ).toBeVisible();
        return dialog;
      };

      const dialog = await openDialog();
      await dialog.getByRole('button', { name: scenario.cancelName, exact: true }).click();
      await expect(page.locator('app-confirm-dialog .modal-overlay')).toHaveCount(0);
      expect(deleteCount).toBe(0);
      let preserved = await page.request.get(`/api/receipts/${receiptId}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(preserved.status()).toBe(200);
      expect((await preserved.json()).data.lines).toHaveLength(1);

      const confirmDialog = await openDialog();
      const deleteResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === deletePath &&
          response.request().method() === 'DELETE'
      );
      await confirmDialog.getByRole('button', { name: scenario.confirmName, exact: true }).click();
      const deleteResponse = await deleteResponsePromise;
      expect(deleteResponse.status()).toBe(200);
      await expect(page.locator('.tabla__fila')).toHaveCount(0);
      await expect(page.locator('.ficha__total-importe').nth(0)).toContainText(/0[.,]00\s*€/);
      await expect(page.locator('.ficha__no-cuadra')).toHaveText(scenario.mismatch);
      expect(deleteCount).toBe(1);

      const detailResponse = await page.request.get(`/api/receipts/${receiptId}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(detailResponse.status()).toBe(200);
      expect((await detailResponse.json()).data.lines).toHaveLength(0);
      await page.reload();
      await expect(page.locator('.tabla__fila')).toHaveCount(0);
      await expect(page.locator('.ficha__total-importe').nth(0)).toContainText(/0[.,]00\s*€/);
      await expect(page.locator('.ficha__no-cuadra')).toHaveText(scenario.mismatch);

      expect(pageErrors).toEqual([]);
    });
  }
});
