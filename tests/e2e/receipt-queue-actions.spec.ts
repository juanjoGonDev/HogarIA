import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

type ProviderBehavior = 'hold-partial' | 'failure' | 'success';

type ReceiptDetail = {
  status: string;
  lines: { name: string }[];
  job: { status: string; attempts: number; max_attempts: number } | null;
};

type ApiReply<T> = { status: number; body: { data: T; error?: string; message?: string } };

/** Provider local de la prueba: nunca accede a la LAN ni guarda prompts/tokens. */
class SyntheticReceiptProvider {
  private server?: Server;
  private behaviors: ProviderBehavior[] = [];
  private readonly openResponses = new Set<ServerResponse>();
  requestCount = 0;
  abortCount = 0;
  baseUrl = '';

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        stream?: boolean;
      };
      this.requestCount += 1;
      const behavior = this.behaviors.shift() ?? 'success';
      response.once('close', () => {
        this.openResponses.delete(response);
        if (!response.writableEnded) this.abortCount += 1;
      });

      if (behavior === 'failure') {
        response.writeHead(503, { 'content-type': 'text/plain' });
        response.end('synthetic provider failure');
        return;
      }

      if (behavior === 'hold-partial') {
        this.openResponses.add(response);
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        response.write(
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  content:
                    '{"lines":[{"name":"Partial synthetic product","quantity":1,"unit":"unit","category":"other","createCategory":false,"priceMinor":100,"offer":null,"confidence":1,"note":null},' +
                    ' '.repeat(64)
                }
              }
            ]
          })}\n\n`
        );
        return;
      }

      const answer = JSON.stringify({
        lines: [
          {
            name: 'Final synthetic product',
            quantity: 1,
            unit: 'unit',
            category: 'other',
            createCategory: false,
            priceMinor: 200,
            offer: null,
            confidence: 1,
            note: null
          }
        ],
        store: 'Synthetic market',
        purchaseDate: null,
        currency: 'EUR',
        totalMinor: 200,
        warnings: []
      });

      if (requestBody.stream) {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        response.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`
        );
        response.end('data: [DONE]\n\n');
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  setNextBehaviors(...behaviors: ProviderBehavior[]): void {
    this.behaviors.push(...behaviors);
  }

  async close(): Promise<void> {
    for (const response of this.openResponses) response.destroy();
    this.openResponses.clear();
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token, 'la sesión E2E debe estar autenticada').toBeTruthy();
  return token as string;
}

async function api<T>(
  page: Page,
  path: string,
  method = 'GET',
  body?: unknown
): Promise<ApiReply<T>> {
  const token = await tokenOf(page);
  const response = await page.request.fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { data: body })
  });
  return {
    status: response.status(),
    body: (await response.json()) as ApiReply<T>['body']
  };
}

async function configureProvider(page: Page, provider: SyntheticReceiptProvider): Promise<void> {
  const reply = await api<{ id: string }>(page, '/api/ai/configs', 'POST', {
    name: 'Synthetic receipt queue',
    provider: 'custom',
    baseUrl: provider.baseUrl,
    apiKey: 'synthetic-key-not-for-display',
    model: 'synthetic-model',
    concurrency: 1,
    retryAttempts: 0,
    timeout: 20000
  });
  expect(reply.status, JSON.stringify(reply.body)).toBe(201);
  expect(reply.body.data.id).toBeTruthy();
}

async function uploadSyntheticReceipt(page: Page): Promise<string> {
  const token = await tokenOf(page);
  const response = await page.evaluate(async (authToken) => {
    const form = new FormData();
    form.append(
      'file',
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        'synthetic.png',
        {
          type: 'image/png'
        }
      )
    );
    const result = await fetch('/api/receipts', {
      method: 'POST',
      headers: { authorization: `Bearer ${authToken}` },
      body: form
    });
    return { status: result.status, body: await result.json() };
  }, token);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return String(response.body.data.id);
}

async function receiptDetail(page: Page, receiptId: string): Promise<ReceiptDetail> {
  const reply = await api<ReceiptDetail>(page, `/api/receipts/${encodeURIComponent(receiptId)}`);
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply.body.data;
}

async function screenshotQueue(page: Page): Promise<void> {
  const directory = join(process.cwd(), '.e2e-screenshots', 'receipt-queue-actions-qa');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `receipt-queue-${test.info().project.name}.png`)
  });
}

function queueIcon(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1024
    ? page.locator('.sidebar [data-test="receipt-queue-icon"]')
    : page.locator('.header [data-test="receipt-queue-icon"]');
}

async function openQueue(page: Page) {
  const icon = queueIcon(page);
  await expect(icon).toBeVisible();
  await icon.click();
  const panel = page.locator('[data-test="receipt-queue-panel"]');
  await expect(panel).toBeVisible();
  return panel;
}

async function expectTouchTargets(panel: ReturnType<Page['locator']>): Promise<void> {
  const buttons = panel.getByRole('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const bounds = await buttons.nth(index).boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
}

test.describe('acciones reales del gestor de cola de tickets', () => {
  test.use({ serviceWorkers: 'block' });
  let provider: SyntheticReceiptProvider;
  let browserErrors: string[];

  test.beforeEach(async ({ page }) => {
    browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? '';
      if (!failure.includes('ERR_ABORTED')) browserErrors.push(`${request.url()} ${failure}`);
    });
    await page.route(/^https:\/\/fonts\.googleapis\.com\/.*/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    );
    provider = new SyntheticReceiptProvider();
    await provider.start();
    await registerAndGoto(page, '/receipts', 'receipt-queue-actions');
    await configureProvider(page, provider);
  });

  test.afterEach(async ({ page }) => {
    await provider?.close();
    expect(browserErrors).toEqual([]);
  });

  test('detiene una lectura parcial desde el panel y la reintenta sin mezclar líneas', async ({
    page
  }) => {
    provider.setNextBehaviors('hold-partial', 'success');
    const receiptId = await uploadSyntheticReceipt(page);

    await expect
      .poll(async () => (await receiptDetail(page, receiptId)).lines.map((line) => line.name))
      .toEqual(['Partial synthetic product']);
    await expect
      .poll(async () => (await receiptDetail(page, receiptId)).job?.status)
      .toBe('running');

    const panel = await openQueue(page);
    await expect(page.getByRole('dialog', { name: 'Cola de lectura de tickets' })).toBeVisible();
    const runningRow = panel.locator('[data-test="queue-job-running"]');
    await expect(runningRow).toBeVisible();
    await expect(runningRow).toContainText('1 línea');
    await expectTouchTargets(panel);
    const stopButton = runningRow.getByRole('button', { name: 'Parar', exact: true });
    const stopBounds = await stopButton.boundingBox();
    expect(stopBounds?.width).toBeGreaterThanOrEqual(44);
    expect(stopBounds?.height).toBeGreaterThanOrEqual(44);
    await stopButton.focus();
    await expect(stopButton).toBeFocused();
    await screenshotQueue(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-test="receipt-queue-panel"]')).toHaveCount(0);
    const reopenedRunningPanel = await openQueue(page);
    await reopenedRunningPanel
      .locator('[data-test="queue-job-running"]')
      .getByRole('button', { name: 'Parar', exact: true })
      .click();

    await expect
      .poll(async () => (await receiptDetail(page, receiptId)).job?.status)
      .toBe('stopped');
    await expect.poll(() => provider.abortCount).toBe(1);
    expect((await receiptDetail(page, receiptId)).lines.map((line) => line.name)).toEqual([
      'Partial synthetic product'
    ]);

    await panel.getByRole('button', { name: 'Abrir', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/receipts/${receiptId}$`));
    await expect(page.locator('[data-test="receipt-queue-panel"]')).toHaveCount(0);

    const reopenedPanel = await openQueue(page);
    const stoppedRow = reopenedPanel.locator('[data-test="queue-job-stopped"]');
    await stoppedRow.getByRole('button', { name: 'Volver a leer', exact: true }).click();
    await expect.poll(async () => (await receiptDetail(page, receiptId)).status).toBe('review');
    const finalReceipt = await receiptDetail(page, receiptId);
    expect(finalReceipt.lines.map((line) => line.name)).toEqual(['Final synthetic product']);
    expect(finalReceipt.job?.status).toBe('done');
  });

  test('reintenta un fallo agotado y parar todo detiene un running y un queued', async ({
    page
  }) => {
    provider.setNextBehaviors('failure', 'failure', 'success');
    const failedReceiptId = await uploadSyntheticReceipt(page);
    await expect
      .poll(async () => (await receiptDetail(page, failedReceiptId)).job?.status)
      .toBe('failed');
    const failedReceipt = await receiptDetail(page, failedReceiptId);
    expect(failedReceipt.job?.attempts).toBe(failedReceipt.job?.max_attempts);
    expect(failedReceipt.job?.max_attempts).toBe(1);

    let panel = await openQueue(page);
    await expect(panel.locator('[data-test="queue-job-failed"]')).toBeVisible();
    await expectTouchTargets(panel);
    const failedRow = panel.locator('[data-test="queue-job-failed"]');
    await expect(failedRow).toBeVisible();
    await failedRow.getByRole('button', { name: 'Volver a leer', exact: true }).click();
    await expect
      .poll(async () => (await receiptDetail(page, failedReceiptId)).status)
      .toBe('review');
    expect((await receiptDetail(page, failedReceiptId)).lines.map((line) => line.name)).toEqual([
      'Final synthetic product'
    ]);

    provider.setNextBehaviors('hold-partial', 'success');
    const runningReceiptId = await uploadSyntheticReceipt(page);
    await expect
      .poll(async () => (await receiptDetail(page, runningReceiptId)).lines.length)
      .toBe(1);
    const queuedReceiptId = await uploadSyntheticReceipt(page);
    await expect
      .poll(async () => (await receiptDetail(page, runningReceiptId)).job?.status)
      .toBe('running');
    await expect
      .poll(async () => (await receiptDetail(page, queuedReceiptId)).job?.status)
      .toBe('queued');

    // El panel permanece abierto tras las mutaciones; exigirlo evita omitir acciones por UI ausente.
    panel = page.locator('[data-test="receipt-queue-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Parar todo', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Parar todo', exact: true }).click();

    await expect
      .poll(async () => (await receiptDetail(page, runningReceiptId)).job?.status)
      .toBe('stopped');
    await expect
      .poll(async () => (await receiptDetail(page, queuedReceiptId)).job?.status)
      .toBe('stopped');
    await expect.poll(() => provider.abortCount).toBe(1);
    expect((await receiptDetail(page, runningReceiptId)).lines.map((line) => line.name)).toEqual([
      'Partial synthetic product'
    ]);
    expect((await receiptDetail(page, queuedReceiptId)).lines).toEqual([]);
  });
});
