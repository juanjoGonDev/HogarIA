import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, test as baseTest } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';
import { shoppingNewListAction } from '../helpers/shopping-ui';

type ProviderContentPart = {
  type?: string;
  text?: string;
  image_url?: { url?: string; detail?: string };
};

type ProviderMessage = {
  role?: string;
  content?: string | ProviderContentPart[];
};

type ProviderRequest = {
  model?: string;
  stream?: boolean;
  response_format?: {
    type?: string;
    json_schema?: { name?: string; strict?: boolean; schema?: unknown };
  };
  messages?: ProviderMessage[];
};

interface SyntheticPhotoProvider {
  readonly baseUrl: string;
  readonly requests: ProviderRequest[];
}

const photoAnswer = {
  lines: [
    {
      name: 'Leche semidesnatada',
      quantity: 2,
      unit: 'botella',
      category: 'Lacteos',
      createCategory: false,
      priceMinor: 129,
      offer: null,
      confidence: 0.95,
      note: ''
    },
    {
      name: 'Pan de pueblo',
      quantity: 1,
      unit: 'ud',
      category: 'Panaderia',
      createCategory: false,
      priceMinor: null,
      offer: null,
      confidence: 0.4,
      note: ''
    },
    {
      name: 'Galletas QA foto',
      quantity: 1,
      unit: 'paquete',
      category: 'Dulces',
      createCategory: false,
      priceMinor: 200,
      offer: null,
      confidence: 0.95,
      note: ''
    }
  ],
  currency: 'EUR',
  warnings: ['El precio del pan no se ve con claridad']
};

const test = baseTest.extend<{ syntheticPhotoProvider: SyntheticPhotoProvider }>({
  syntheticPhotoProvider: async ({}, use) => {
    const requests: ProviderRequest[] = [];
    const provider = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
          response.writeHead(404).end();
          return;
        }

        let body: ProviderRequest;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProviderRequest;
        } catch {
          response.writeHead(400).end();
          return;
        }
        requests.push(body);
        const content = JSON.stringify(photoAnswer);

        if (body.stream) {
          const delta = JSON.stringify({ choices: [{ delta: { content } }] });
          response
            .writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
            .end(`data: ${delta}\n\ndata: [DONE]\n\n`);
          return;
        }

        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });

    await new Promise<void>((resolveListen, reject) => {
      provider.once('error', reject);
      provider.listen(0, '127.0.0.1', resolveListen);
    });

    try {
      const address = provider.address() as AddressInfo;
      await use({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        requests
      });
    } finally {
      await new Promise<void>((resolveClose, reject) => {
        provider.close((error) => (error ? reject(error) : resolveClose()));
      });
    }
  }
});

const TOKEN_KEY = 'hogar:v1:auth_token';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

test('analiza una foto, deja revisar la propuesta y persiste solo lo confirmado', async ({
  page,
  syntheticPhotoProvider
}, testInfo) => {
  const desktop = testInfo.project.name === 'chromium';
  const viewport = desktop ? { width: 1440, height: 900 } : { width: 393, height: 851 };
  const pageErrors: string[] = [];
  const applyRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message).split('\n')[0]));
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/items/apply')) {
      applyRequests.push(request.url());
    }
  });
  await page.setViewportSize(viewport);
  await registerAndGoto(page, '/shopping', 'Shopping photo review QA');

  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'la configuración IA debe pertenecer al usuario del runner aislado').toBeTruthy();

  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Lista QA foto sintética');
  await page.locator('[data-test="create-submit"]').click();
  await expect(page.locator('[data-test="add-input"]')).toBeVisible();
  const listId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(listId).toBeTruthy();

  const configResponse = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Provider stub foto QA',
      provider: 'custom',
      baseUrl: syntheticPhotoProvider.baseUrl,
      apiKey: 'synthetic-e2e-only',
      model: 'synthetic-shopping-photo',
      timeout: 300,
      retryAttempts: 0
    }
  });
  expect(configResponse.status()).toBe(201);

  const seededItem = await page.request.post(`/api/shopping/lists/${listId}/items`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Leche semidesnatada',
      quantity: 1,
      unit: 'botella',
      category: 'Lacteos'
    }
  });
  expect(seededItem.status()).toBe(201);
  await page.reload();
  await expect(page.locator('[data-test="item-row"]')).toHaveCount(1);

  await page.locator('[data-test="photo-open"]').click();
  const photoMode = page.locator('[data-test="photo-mode"]');
  await photoMode.locator('.picker__trigger').click();
  await page.getByRole('option', { name: /Ticket/i }).click();
  await page.locator('input[name="photoNote"]').fill('Compra sintética para revisar el ticket');
  await page.locator('input[name="photoFile"]').setInputFiles({
    name: 'ticket-sintetico.png',
    mimeType: 'image/png',
    buffer: PNG
  });

  const analyzeResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/shopping/lists/${listId}/photo/analyze`) &&
      response.request().method() === 'POST'
  );
  await page.locator('[data-test="photo-analyze"]').click();
  const analyzeResponse = await analyzeResponsePromise;
  expect(analyzeResponse.status()).toBe(200);

  const nameMilk = page.locator('.detail__photo-name').nth(0);
  const quantityMilk = page.locator('.detail__photo-qty').nth(0);
  const priceMilk = page.locator('.detail__photo-price').nth(0);
  const nameBread = page.locator('.detail__photo-name').nth(1);
  const quantityBread = page.locator('.detail__photo-qty').nth(1);
  const priceBread = page.locator('.detail__photo-price').nth(1);
  await expect(nameMilk).toHaveValue('Leche semidesnatada');
  await expect(nameMilk).toHaveAccessibleName('Nombre del producto: Leche semidesnatada');
  await expect(quantityMilk).toHaveAccessibleName('Cantidad: Leche semidesnatada');
  await expect(priceMilk).toHaveAccessibleName('Precio: Leche semidesnatada');
  await expect(nameBread).toHaveAccessibleName('Nombre del producto: Pan de pueblo');
  await expect(quantityBread).toHaveAccessibleName('Cantidad: Pan de pueblo');
  await expect(priceBread).toHaveAccessibleName('Precio: Pan de pueblo');
  await expect(page.locator('.detail__photo-doubt')).toContainText('baja confianza');
  await expect(page.locator('.detail__photo-warnings')).toContainText(
    'El precio del pan no se ve con claridad'
  );
  await expect(page.locator('.detail__photo-name').nth(2)).toHaveValue('Galletas QA foto');
  await expect(page.locator('[data-test="photo-apply"]')).toBeEnabled();
  expect(applyRequests, 'analizar y revisar no debe persistir items').toEqual([]);

  const screenshotRoot = process.env.E2E_SCREENSHOT_DIR;
  if (!desktop) {
    const viewportMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth);
    const sheetBounds = await page.locator('[data-test="photo-sheet"]').boundingBox();
    const proposalRowBounds = await page.locator('.detail__photo-line').first().boundingBox();
    expect(sheetBounds).not.toBeNull();
    expect(proposalRowBounds).not.toBeNull();
    expect(sheetBounds!.x).toBeGreaterThanOrEqual(0);
    expect(sheetBounds!.x + sheetBounds!.width).toBeLessThanOrEqual(393);
    expect(proposalRowBounds!.x).toBeGreaterThanOrEqual(sheetBounds!.x);
    expect(proposalRowBounds!.x + proposalRowBounds!.width).toBeLessThanOrEqual(
      sheetBounds!.x + sheetBounds!.width
    );

    if (screenshotRoot) {
      const directory = join(resolve(screenshotRoot), testInfo.project.name);
      mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: join(directory, 'photo-review-mobile-393x851.png')
      });
    }
  }

  const providerRequest = syntheticPhotoProvider.requests[0];
  expect(syntheticPhotoProvider.requests).toHaveLength(1);
  expect(providerRequest.model).toBe('synthetic-shopping-photo');
  expect(providerRequest.response_format).toMatchObject({
    type: 'json_schema',
    json_schema: { strict: true }
  });
  const promptText = (providerRequest.messages ?? [])
    .flatMap((message) =>
      typeof message.content === 'string'
        ? [message.content]
        : (message.content ?? []).map((part) => part.text ?? '')
    )
    .join('\n');
  expect(promptText).toContain('Compra sintética para revisar el ticket');
  expect(promptText).toContain('TICKET');
  const imagePart = (providerRequest.messages ?? [])
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .find((part) => part.type === 'image_url');
  expect(Boolean(imagePart?.image_url?.url?.startsWith('data:image/png;base64,'))).toBe(true);

  const listBeforeConfirm = await page.request.get(`/api/shopping/lists/${listId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(listBeforeConfirm.status()).toBe(200);
  expect((await listBeforeConfirm.json()).data.items).toHaveLength(1);

  await nameBread.fill('Pan de molde QA');
  await quantityBread.fill('2');
  await priceBread.fill('0,95');
  await expect(nameBread).toHaveValue('Pan de molde QA');
  await expect(nameBread).toHaveAccessibleName('Nombre del producto: Pan de molde QA');
  await expect(quantityBread).toHaveAccessibleName('Cantidad: Pan de molde QA');
  await expect(priceBread).toHaveAccessibleName('Precio: Pan de molde QA');
  await page.locator('.detail__photo-lines button[role="checkbox"]').nth(2).click();
  await expect(page.locator('.detail__photo-lines button[role="checkbox"]').nth(2)).toHaveAttribute(
    'aria-checked',
    'false'
  );

  if (!desktop) {
    await page.setViewportSize({ width: 320, height: 568 });
    const viewportMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth);
    await page.locator('[data-test="photo-apply"]').scrollIntoViewIfNeeded();
    const applyBounds = await page.locator('[data-test="photo-apply"]').boundingBox();
    expect(applyBounds).not.toBeNull();
    expect(applyBounds!.y).toBeGreaterThanOrEqual(0);
    expect(applyBounds!.y + applyBounds!.height).toBeLessThanOrEqual(568);

    const sheetBounds = await page.locator('[data-test="photo-sheet"]').boundingBox();
    const proposalRowBounds = await page.locator('.detail__photo-line').first().boundingBox();
    expect(sheetBounds).not.toBeNull();
    expect(proposalRowBounds).not.toBeNull();
    expect(sheetBounds!.x).toBeGreaterThanOrEqual(0);
    expect(sheetBounds!.x + sheetBounds!.width).toBeLessThanOrEqual(320);
    expect(proposalRowBounds!.x).toBeGreaterThanOrEqual(sheetBounds!.x);
    expect(proposalRowBounds!.x + proposalRowBounds!.width).toBeLessThanOrEqual(
      sheetBounds!.x + sheetBounds!.width
    );
  }

  if (screenshotRoot) {
    const directory = join(resolve(screenshotRoot), testInfo.project.name);
    mkdirSync(directory, { recursive: true });
    await page.screenshot({
      path: join(
        directory,
        desktop ? 'photo-review-desktop-1440x900.png' : 'photo-review-mobile-320x568-cta.png'
      ),
      fullPage: desktop
    });
  }

  const applyRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes(`/api/shopping/lists/${listId}/items/apply`) &&
      request.method() === 'POST'
  );
  const applyResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/shopping/lists/${listId}/items/apply`) &&
      response.request().method() === 'POST'
  );
  await page.locator('[data-test="photo-apply"]').click();
  const applyRequest = await applyRequestPromise;
  const applyResponse = await applyResponsePromise;
  expect(applyResponse.status()).toBe(200);
  const applyBody = (await applyResponse.json()).data as {
    merged: unknown[];
    added: unknown[];
  };
  const appliedLines = (applyRequest.postDataJSON() as { lines: Array<Record<string, unknown>> })
    .lines;
  expect(appliedLines).toHaveLength(2);
  expect(appliedLines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'Leche semidesnatada',
        quantity: 2,
        unit: 'botella',
        priceMinor: 129
      }),
      expect.objectContaining({
        name: 'Pan de molde QA',
        quantity: 2,
        unit: 'ud',
        priceMinor: 95
      })
    ])
  );
  expect(appliedLines.some((line) => line.name === 'Galletas QA foto')).toBe(false);
  expect(applyBody.merged).toHaveLength(1);
  expect(applyBody.added).toHaveLength(1);
  await expect(nameMilk).toHaveCount(0);
  await expect(page.locator('[data-test="item-row"]')).toHaveCount(2);
  await expect(
    page.locator('[data-test="item-row"]').filter({ hasText: 'Leche semidesnatada' })
  ).toContainText('3 botella');
  await expect(
    page.locator('[data-test="item-row"]').filter({ hasText: 'Pan de molde QA' })
  ).toContainText('2 ud');

  await page.reload();
  await expect(page.locator('[data-test="item-row"]')).toHaveCount(2);
  await expect(
    page.locator('[data-test="item-row"]').filter({ hasText: 'Leche semidesnatada' })
  ).toContainText('3 botella');
  await expect(
    page.locator('[data-test="item-row"]').filter({ hasText: 'Pan de molde QA' })
  ).toContainText('2 ud');
  const savedList = await page.request.get(`/api/shopping/lists/${listId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(savedList.status()).toBe(200);
  expect(
    (await savedList.json()).data.items.map((item: { name: string }) => item.name).sort()
  ).toEqual(['Leche semidesnatada', 'Pan de molde QA']);
  expect(pageErrors).toEqual([]);
});
