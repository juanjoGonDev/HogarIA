import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

declare global {
  interface Window {
    __receiptDropTransfer?: DataTransfer;
  }
}

function ticketState(receiptId: string) {
  const runDirectory = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDirectory || !databasePath) throw new Error('E2E requiere SQLite temporal aislado.');
  if (resolve(databasePath) !== resolve(runDirectory, 'hogaria.sqlite')) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio temporal del run.');
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const receipt = database
      .prepare('SELECT status, file_name AS fileName FROM receipts WHERE id = ?')
      .get(receiptId) as { status: string; fileName: string } | undefined;
    const job = database
      .prepare(
        `SELECT status, error_code AS errorCode FROM ai_jobs
         WHERE receipt_id = ? AND kind = 'receipt' ORDER BY created_at DESC LIMIT 1`
      )
      .get(receiptId) as { status: string; errorCode: string | null } | undefined;
    const receiptCount = database
      .prepare('SELECT COUNT(*) AS count FROM receipts WHERE id = ?')
      .get(receiptId) as { count: number };
    const jobCount = database
      .prepare("SELECT COUNT(*) AS count FROM ai_jobs WHERE receipt_id = ? AND kind = 'receipt'")
      .get(receiptId) as { count: number };
    return {
      receiptCount: receiptCount.count,
      jobCount: jobCount.count,
      fileName: receipt?.fileName ?? null,
      status: receipt?.status ?? null,
      errorCode: job?.errorCode ?? null,
      jobStatus: job?.status ?? null
    };
  } finally {
    database.close();
  }
}

test('arrastrar un PNG a la zona visible lo acepta una sola vez', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await registerAndGoto(page, '/receipts');

  const mobile = testInfo.project.name === 'mobile-chrome';
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const dropZone = page.locator('[data-test="ticket-drop"]');
  await expect(dropZone).toBeVisible();

  await dropZone.evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        'ticket-dragged.png',
        { type: 'image/png' }
      )
    );
    window.__receiptDropTransfer = transfer;
    target.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true })
    );
  });
  await expect(dropZone).toHaveClass(/tickets__drop--over/);

  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/receipts' &&
      response.request().method() === 'POST',
    { timeout: 10000 }
  );
  await dropZone.evaluate((target) => {
    const transfer = window.__receiptDropTransfer;
    if (!transfer) throw new Error('Falta el DataTransfer sintético del test.');
    target.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
    );
    delete window.__receiptDropTransfer;
  });
  await expect(dropZone).not.toHaveClass(/tickets__drop--over/);

  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(201);
  const upload = (await uploadResponse.json()) as {
    data: { id: string; fileKind: string; fileName: string };
  };
  expect(upload.data).toMatchObject({ fileKind: 'png', fileName: 'ticket-dragged.png' });
  await expect
    .poll(() => ticketState(upload.data.id), { timeout: 20000 })
    .toEqual({
      receiptCount: 1,
      jobCount: 1,
      fileName: 'ticket-dragged.png',
      status: 'failed',
      errorCode: 'NO_CONFIG',
      jobStatus: 'failed'
    });

  const ticketRow = page.locator('.ticket').filter({ hasText: 'ticket-dragged.png' });
  await expect(ticketRow).toHaveCount(1, { timeout: 20000 });
  await expect(ticketRow).toContainText('Falló', { timeout: 10000 });

  const runId = (process.env.E2E_SEED ?? 'local').replace(/[^a-zA-Z0-9-]/g, '-');
  const screenshotDirectory = resolve(
    '.e2e-screenshots',
    `qa-receipt-drag-drop-${runId}`,
    testInfo.project.name
  );
  mkdirSync(screenshotDirectory, { recursive: true });
  const viewports = mobile
    ? [
        { width: 390, height: 844, suffix: '390x844' },
        { width: 320, height: 740, suffix: '320x740' }
      ]
    : [{ width: 1440, height: 900, suffix: '1440x900' }];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    await page.screenshot({
      path: resolve(screenshotDirectory, `receipt-drag-drop-${viewport.suffix}.png`),
      fullPage: true
    });
  }
  expect(pageErrors).toEqual([]);
});
