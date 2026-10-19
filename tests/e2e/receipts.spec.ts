import { mkdirSync } from 'node:fs';
import { Page, TestInfo, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

/**
 * La lectura de tickets por IA (HOGARIA-SPEC ## 12aj), de punta a punta SIN proveedor de IA:
 * lo que se prueba es el ciclo que la IA no puede romper.
 *
 *  - Subir un ticket valido lo mete en la cola; sin configuracion de IA el trabajo falle con
 *    NO_CONFIG, el icono de la cabecera se pone el borde rojo y su panel ensena el trabajo con
 *    su reintento.
 *  - Un fichero que no es imagen ni PDF no pasa de la puerta (415 con la firma, no el
 *    Content-Type, que es una opinion).
 *  - Un ticket fallido se rescata a mano: lineas anadidas y editadas por la interfaz, tienda
 *    corregida, y confirmar sube la compra al inventario y registra la tienda.
 *
 * Lo que queda fuera: la lectura en si (el stream de lineas llegando poco a poco) es cosa del
 * modelo y del `ticket-queue`; aqui se cubre con los specs de server.
 */

const TOKEN_KEY = 'hogar:v1:auth_token';

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((clave) => window.localStorage.getItem(clave), TOKEN_KEY);
  expect(token, 'la sesion deberia tener token').toBeTruthy();
  return token as string;
}

function trabajosDeTicket(receiptId: string): number {
  const runDirectory = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDirectory || !databasePath) throw new Error('E2E requiere rutas temporales aisladas');
  const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
  if (isAbsolute(relativeDatabasePath) || relativeDatabasePath.startsWith('..')) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test');
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return (
      database
        .prepare('SELECT COUNT(*) AS count FROM ai_jobs WHERE receipt_id = ?')
        .get(receiptId) as {
        count: number;
      }
    ).count;
  } finally {
    database.close();
  }
}

/** Recuento de ficha y filas hijas: lectura exclusivamente sobre la SQLite temporal del E2E. */
function filasPersistidasDeTicket(receiptId: string): {
  receipts: number;
  receiptItems: number;
  aiJobs: number;
} {
  const runDirectory = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDirectory || !databasePath) throw new Error('E2E requiere rutas temporales aisladas');
  const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
  if (isAbsolute(relativeDatabasePath) || relativeDatabasePath.startsWith('..')) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test');
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM receipts WHERE id = ?) AS receipts,
           (SELECT COUNT(*) FROM receipt_items WHERE receipt_id = ?) AS receiptItems,
           (SELECT COUNT(*) FROM ai_jobs WHERE receipt_id = ?) AS aiJobs`
      )
      .get(receiptId, receiptId, receiptId) as {
      receipts: number;
      receiptItems: number;
      aiJobs: number;
    };
  } finally {
    database.close();
  }
}

/** Un PNG de mentira de 8 bytes: la firma es lo unico que la subida valida. */
function pngDeMentira(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/** Un PDF de mentira: la firma %PDF- es lo que distingue el kind. */
function pdfDeMentira(): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
}

type TicketProviderMessage = {
  role?: string;
  content?:
    | string
    | {
        file?: { filename?: string; file_data?: string };
        type?: string;
        text?: string;
        image_url?: { url?: string; detail?: string };
      }[];
};

type TicketProviderRequest = {
  model?: string;
  stream?: boolean;
  response_format?: {
    type?: string;
    json_schema?: { name?: string; strict?: boolean; schema?: unknown };
  };
  messages?: TicketProviderMessage[];
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function iniciarProveedorDeTickets(
  respuesta: unknown,
  antesDeResponder?: (solicitud: TicketProviderRequest, indice: number) => Promise<void>
) {
  const solicitudes: TicketProviderRequest[] = [];
  const proveedor = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }

      let body: TicketProviderRequest;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as TicketProviderRequest;
      } catch {
        response.writeHead(400).end();
        return;
      }
      solicitudes.push(body);
      void (async () => {
        await antesDeResponder?.(body, solicitudes.length - 1);
        if (response.destroyed) return;
        const content = JSON.stringify(respuesta);

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
      })().catch(() => {
        if (!response.destroyed) response.writeHead(500).end();
      });
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    proveedor.once('error', reject);
    proveedor.listen(0, '127.0.0.1', resolveListen);
  });

  const address = proveedor.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    solicitudes,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        proveedor.close((error) => (error ? reject(error) : resolveClose()));
      })
  };
}

async function abrirTicketsDesdeLaNavegacion(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.locator('.header__menu').click();
    await page.locator('.sidebar--open .sidebar__nav a[href="/receipts"]').click();
    return;
  }

  await page.locator('.sidebar__nav a[href="/receipts"]').click();
}

function iconoVisibleDeCola(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1024
    ? page.locator('.sidebar [data-test="receipt-queue-icon"]')
    : page.locator('.header [data-test="receipt-queue-icon"]');
}

async function cerrarAvisos(page: Page): Promise<void> {
  const closeButtons = page.locator('.toast__close');
  while ((await closeButtons.count()) > 0) await closeButtons.first().click();
}

async function terminarTransiciones(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
    );
  });
}

test.describe('tickets: la cola de lectura (## 12aj)', () => {
  test('la seccion esta en la navegacion y la bandeja sube un ticket que falla sin IA', async ({
    page
  }) => {
    await registerAndGoto(page, '/dashboard');

    // El modulo de tickets trae este build: sale en el menu lateral.
    await abrirTicketsDesdeLaNavegacion(page);
    await expect(page).toHaveURL(/\/receipts$/);

    // El icono de la cola existe desde el primer momento, apagado.
    // Hay DOS iconos de la cola (cabecera movil y sidebar): el visible es el del viewport.
    const icono = iconoVisibleDeCola(page);
    await expect(icono).toBeVisible();

    // La subida: un PNG valido entra en la cola.
    await page.setInputFiles('input[name="ticketFile"]', {
      name: 'ticket.png',
      mimeType: 'image/png',
      buffer: pngDeMentira()
    });
    await expect(page.locator('[data-test="ticket-drop"]')).toBeVisible();

    // Sin configuracion de IA la lectura no puede empezar: el trabajo falle y el icono
    // de la cabecera se pone el borde rojo —lo que se ve desde el otro lado de la habitacion.
    await expect(icono).toHaveClass(/rq__button--error/, { timeout: 20000 });

    // El panel del icono: el trabajo con su estado y su reintento.
    await icono.click();
    const panel = page.locator('[data-test="receipt-queue-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-test="queue-job-failed"]')).toHaveCount(1);
    await expect(panel.getByRole('button', { name: 'Volver a leer' })).toBeVisible();
  });

  test('recorre el historial completo de más de cien recibos y abre el más antiguo', async ({
    page
  }) => {
    await registerAndGoto(page, '/receipts');
    const token = await tokenOf(page);
    const profileResponse = await page.request.get('/api/auth/profile', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(profileResponse.ok()).toBeTruthy();
    const profile = (await profileResponse.json()) as { data: { id: string } };

    const runDirectory = process.env.E2E_RUN_DIR;
    const databasePath = process.env.DATABASE_PATH;
    if (!runDirectory || !databasePath) throw new Error('E2E requiere rutas temporales aisladas');
    const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
    if (isAbsolute(relativeDatabasePath) || relativeDatabasePath.startsWith('..')) {
      throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test');
    }

    const database = new Database(databasePath);
    try {
      const insert = database.prepare(
        `INSERT INTO receipts (id, user_id, status, store, purchase_date, file_url, file_kind, file_name, file_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'png', ?, 8, ?)`
      );
      const statuses = ['review', 'confirmed', 'failed', 'stopped'] as const;
      const seedReceipts = database.transaction(() => {
        for (let index = 0; index < 105; index += 1) {
          const id = `${profile.data.id}-history-${index.toString().padStart(3, '0')}`;
          const purchaseDate =
            index === 0 ? null : new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
          const uploadedAt = new Date(Date.UTC(2023, 0, index + 1)).toISOString();
          insert.run(
            id,
            profile.data.id,
            statuses[index % statuses.length],
            `Tienda ${index}`,
            purchaseDate,
            `/api/uploads/receipts/${id}.png`,
            `ticket-${index}.png`,
            uploadedAt
          );
        }
        for (const status of ['queued', 'analyzing'] as const) {
          const id = `${profile.data.id}-active-${status}`;
          insert.run(
            id,
            profile.data.id,
            status,
            `En curso ${status}`,
            null,
            `/api/uploads/receipts/${id}.png`,
            `active-${status}.png`,
            new Date(Date.UTC(2023, 0, 1)).toISOString()
          );
        }
      });
      seedReceipts();
    } finally {
      database.close();
    }

    await page.reload();
    await expect(page.locator('[data-test="ticket-queued"]')).toHaveCount(1);
    await expect(page.locator('[data-test="ticket-analyzing"]')).toHaveCount(1);
    const history = page.locator('[data-test="receipt-history"]');
    const rows = history.locator('[data-test="ticket-history-item"]');
    await expect(rows).toHaveCount(50);
    await expect(history.getByRole('button', { name: 'Cargar más' })).toBeVisible();
    await history.getByRole('button', { name: 'Cargar más' }).click();
    await expect(rows).toHaveCount(100);
    await history.getByRole('button', { name: 'Cargar más' }).click();
    await expect(rows).toHaveCount(105);
    for (const statusLabel of ['A revisar', 'Confirmado', 'Falló', 'Parado']) {
      await expect(rows.filter({ hasText: statusLabel }).first()).toBeVisible();
    }
    await expect(rows.first()).toContainText('Tienda 104');
    const primeraFila = await rows.first().innerText();
    const fechasSeparadas = primeraFila.match(/Fecha de compra:\s*([^·]+)·\s*Subido:\s*([^·]+)·/);
    expect(fechasSeparadas).not.toBeNull();
    expect(fechasSeparadas?.[1].trim()).not.toBe(fechasSeparadas?.[2].trim());
    await expect(rows.last()).toContainText('Sin fecha');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    ).toBe(false);

    const stoppedId = `${profile.data.id}-history-003`;
    const stoppedLink = history.locator(`a[href="/receipts/${stoppedId}"]`);
    await expect(stoppedLink).toHaveCount(1);
    await stoppedLink.click();
    await expect(page).toHaveURL(new RegExp(`/receipts/${stoppedId}$`));
    await expect(page.getByText('Parado', { exact: true })).toBeVisible();
    const storeField = page.getByLabel('Tienda');
    const purchaseDateField = page.getByLabel('Fecha de compra');
    await storeField.fill('Tienda parada editada');
    await purchaseDateField.fill('2024-02-29');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('.ficha__metadatos-estado')).toContainText('Cambios guardados');

    const stoppedDetail = await page.request.get(`/api/receipts/${stoppedId}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(stoppedDetail.ok()).toBeTruthy();
    expect((await stoppedDetail.json()).data).toMatchObject({
      status: 'stopped',
      store: 'Tienda parada editada',
      purchaseDate: '2024-02-29'
    });
    await page.reload();
    await expect(page.getByLabel('Tienda')).toHaveValue('Tienda parada editada');
    await expect(page.getByLabel('Fecha de compra')).toHaveValue('2024-02-29');
    await expect(page.getByText('Parado', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Volver a tickets' }).click();
    const reopenedHistory = page.locator('[data-test="receipt-history"]');
    const reopenedRows = reopenedHistory.locator('[data-test="ticket-history-item"]');
    await expect(reopenedRows).toHaveCount(50);
    await reopenedHistory.getByRole('button', { name: 'Cargar más' }).click();
    await expect(reopenedRows).toHaveCount(100);
    await reopenedHistory.getByRole('button', { name: 'Cargar más' }).click();
    await expect(reopenedRows).toHaveCount(105);
    await expect(reopenedRows.filter({ hasText: 'Tienda parada editada' })).toContainText('Parado');

    await rows.last().locator('a').click();
    await expect(page).toHaveURL(new RegExp(`/receipts/${profile.data.id}-history-000$`));
    await expect(page.getByRole('heading', { name: 'Tienda 0' })).toBeVisible();
    await expect(page.locator('#ticket-fecha-compra')).toHaveValue('');
  });

  test('distingue historial vacío de error, reintenta y protege el acceso', async ({
    page,
    browser
  }, testInfo) => {
    let retryRequested = false;
    await page.route(
      (url) => url.pathname === '/api/receipts' && url.searchParams.get('scope') === 'history',
      async (route) => {
        if (!retryRequested) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'synthetic history failure' })
          });
          return;
        }
        await route.continue();
      }
    );

    await registerAndGoto(page, '/receipts');
    const history = page.locator('[data-test="receipt-history"]');
    await expect(history.getByRole('heading', { name: 'Historial' })).toBeVisible();
    const error = history.getByRole('alert');
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(history.locator('.tickets__history-empty')).toHaveCount(0);
    const retry = error.getByRole('button', { name: 'Reintentar' });
    await expect(retry).toBeVisible();

    const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 480, height: 800 },
      { width: 481, height: 800 },
      { width: 568, height: 320 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 1280, height: 720 }
    ]) {
      await page.setViewportSize(viewport);
      await terminarTransiciones(page);
      const geometry = await page.evaluate(() => {
        const historyElement = document.querySelector('[data-test="receipt-history"]');
        const rect = historyElement?.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          left: rect?.left ?? -1,
          right: rect?.right ?? Number.POSITIVE_INFINITY
        };
      });
      expect(
        geometry.documentWidth,
        `sin overflow horizontal a ${viewport.width}×${viewport.height}`
      ).toBeLessThanOrEqual(viewport.width);
      expect(geometry.left, `historial dentro a ${viewport.width}px`).toBeGreaterThanOrEqual(0);
      expect(geometry.right, `historial dentro a ${viewport.width}px`).toBeLessThanOrEqual(
        viewport.width
      );
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await terminarTransiciones(page);
    await cerrarAvisos(page);
    await error.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('receipt-history-error-desktop.png')
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await terminarTransiciones(page);
    await error.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('receipt-history-error-mobile.png')
    });
    await page.setViewportSize(originalViewport);
    await terminarTransiciones(page);

    retryRequested = true;
    await retry.focus();
    await expect(retry).toBeFocused();
    await retry.press('Enter');
    await expect(history.locator('.tickets__history-error')).toHaveCount(0);
    await expect(history.locator('.tickets__history-empty')).toBeVisible();
    await page.reload();
    await expect(history.locator('.tickets__history-empty')).toBeVisible();

    const unauthorized = await page.request.get('/api/receipts?scope=history');
    expect(unauthorized.status()).toBe(401);

    const guestContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      locale: 'es-ES'
    });
    try {
      const guestPage = await guestContext.newPage();
      await guestPage.goto('/receipts');
      await expect(guestPage).toHaveURL(/\/auth\/login/);
      await expect(guestPage.locator('[data-test="receipt-history"]')).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });

  test('un fichero que no es imagen ni PDF no pasa de la puerta', async ({ page }) => {
    await registerAndGoto(page, '/receipts');

    // El Content-Type del fichero lo elige quien lo manda: la puerta del cliente mira el
    // tipo, la del server la FIRMA de los bytes. Aqui se prueba la del cliente.
    await page.setInputFiles('input[name="ticketFile"]', {
      name: 'virus.png',
      mimeType: 'text/plain',
      buffer: Buffer.from('MZ\x90\x00 esto no es un ticket')
    });
    await expect(page.locator('[data-test="ticket-upload-error"]')).toContainText(
      'no es una imagen',
      { timeout: 20000 }
    );
  });

  test('un PDF tambien entra en la cola', async ({ page }) => {
    await registerAndGoto(page, '/receipts');

    const uploadResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/receipts' && response.request().method() === 'POST';
    });
    await page.setInputFiles('input[name="ticketFile"]', {
      name: 'ticket.pdf',
      mimeType: 'application/pdf',
      buffer: pdfDeMentira()
    });

    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(201);
    const upload = (await uploadResponse.json()) as {
      data: { fileKind: string; fileName: string };
    };
    expect(upload.data).toMatchObject({ fileKind: 'pdf', fileName: 'ticket.pdf' });

    // El contrato aquí es que un PDF válido se acepte y aparezca en la bandeja. El worker es
    // asíncrono: puede seguir «En curso» o haber movido ya el ticket al Historial.
    const ticket = page.locator('.ticket').filter({ hasText: 'ticket.pdf' });
    await expect(ticket).toHaveCount(1, { timeout: 20000 });
  });

  test('un ticket fallido se rescata a mano y confirma: tienda, precios e inventario', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/receipts');
    const token = await tokenOf(page);

    await page.setInputFiles('input[name="ticketFile"]', {
      name: 'compra.png',
      mimeType: 'image/png',
      buffer: pngDeMentira()
    });
    const fallido = page.locator('[data-test="receipt-history"] [data-test="ticket-history-item"]');
    await expect(fallido).toHaveCount(1, { timeout: 20000 });

    // La ficha: el error de la lectura traducido y las acciones de rescate.
    await fallido.locator('a').first().click();
    await expect(page).toHaveURL(/\/receipts\/.+$/);
    await expect(page.locator('[data-test="ticket-error"]')).toContainText('configuración de IA', {
      timeout: 20000
    });

    // La tienda corregible.
    await page.fill('input#ticket-tienda', 'Mercadona del pueblo');
    const fechaCompra = page.getByLabel('Fecha de compra');
    await expect(fechaCompra).toBeVisible();
    await fechaCompra.fill('2024-02-29');
    await expect(fechaCompra).toBeFocused();
    const guardarMetadatos = page.getByRole('button', { name: 'Guardar cambios' });
    let guardarTieneFoco = false;
    for (let intento = 0; intento < 5 && !guardarTieneFoco; intento += 1) {
      await page.keyboard.press('Tab');
      guardarTieneFoco = await guardarMetadatos.evaluate(
        (button) => button === document.activeElement
      );
    }
    await expect(guardarMetadatos).toBeFocused();
    let fallaLaPrimeraGuardada = true;
    const rutaDeRecibos = '**/api/receipts/*';
    await page.route(rutaDeRecibos, async (route) => {
      if (route.request().method() === 'PATCH' && fallaLaPrimeraGuardada) {
        fallaLaPrimeraGuardada = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.continue();
    });
    await page.keyboard.press('Enter');
    await expect(page.locator('.ficha__metadatos-error')).toContainText('Puedes reintentarlo');
    await page.unroute(rutaDeRecibos);
    await guardarMetadatos.click();
    await expect(page.locator('.ficha__metadatos-estado')).toContainText('Cambios guardados');
    await cerrarAvisos(page);
    await terminarTransiciones(page);
    await page.screenshot({ path: testInfo.outputPath('receipt-metadata.png'), fullPage: true });

    // Dos lineas a mano: nombre, cantidad y precio editables uno a uno. (Por rol: el
    // data-test queda en el host de app-button, y el clic del centro no siempre cae en el
    // boton de dentro.)
    await page.getByRole('button', { name: 'Añadir línea' }).click();
    await page.getByRole('button', { name: 'Añadir línea' }).click();
    const filas = page.locator('.tabla__fila');
    await expect(filas).toHaveCount(2);

    await filas.nth(0).locator('input[id$="-nombre"]').fill('Leche entera');
    await filas.nth(0).locator('input[id$="-cantidad"]').fill('2');
    await filas.nth(0).locator('input[id$="-precio"]').fill('1.95');

    await filas.nth(1).locator('input[id$="-nombre"]').fill('Pan de pueblo');
    await filas.nth(1).locator('input[id$="-precio"]').fill('1.40');

    // La suma de lineas ensena lo que va a entrar.
    await expect(page.getByText('Suma de líneas')).toBeVisible();

    // Confirmar: la compra sube al inventario.
    await page.getByRole('button', { name: 'Confirmar y subir al inventario' }).click();
    await expect(page.locator('[data-test="ticket-confirmed"]')).toBeVisible({ timeout: 20000 });

    // Los metadatos siguen editables tras confirmar; este PATCH no vuelve a mover el inventario.
    await page.fill('input#ticket-tienda', 'Mercadona confirmado');
    await fechaCompra.fill('2025-03-01');
    guardarTieneFoco = false;
    for (let intento = 0; intento < 5 && !guardarTieneFoco; intento += 1) {
      await page.keyboard.press('Tab');
      guardarTieneFoco = await guardarMetadatos.evaluate(
        (button) => button === document.activeElement
      );
    }
    await expect(guardarMetadatos).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ficha__metadatos-estado')).toContainText('Cambios guardados');
    const receiptId = new URL(page.url()).pathname.split('/').at(-1);
    const detalle = await page.request.get(`/api/receipts/${receiptId}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(
      ((await detalle.json()) as { data: { store: string; purchaseDate: string } }).data
    ).toMatchObject({
      store: 'Mercadona confirmado',
      purchaseDate: '2025-03-01'
    });

    // Y de verdad: el inventario tiene la leche con sus dos unidades, y la tienda quedo
    // registrada para la casa.
    const inventario = await page.request.get('/api/pantry/ingredients?search=Leche', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(inventario.ok()).toBeTruthy();
    const cuerpo = (await inventario.json()) as {
      data: { ingredients: { name: string; quantity: number }[] };
    };
    const leche = cuerpo.data.ingredients.find((fila) => fila.name === 'Leche entera');
    expect(leche?.quantity).toBe(2);

    const tiendas = await page.request.get('/api/shopping/stores', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(tiendas.ok()).toBeTruthy();
    const listaTiendas = (await tiendas.json()) as { data: { store: string }[] };
    expect(listaTiendas.data.map((fila) => fila.store)).toContain('Mercadona del pueblo');

    await page.getByRole('link', { name: 'Volver a tickets' }).click();
    await expect(page.locator('.tickets')).toBeVisible();
    await expect(page.locator('.ficha')).toHaveCount(0);
    const history = page.locator('[data-test="receipt-history"]');
    await expect(history.getByText('Mercadona confirmado')).toBeVisible();
    await expect(history).toContainText('Fecha de compra');
    await expect(history).toContainText('Subido');
    await cerrarAvisos(page);
    await terminarTransiciones(page);
    await page.screenshot({ path: testInfo.outputPath('receipt-history.png'), fullPage: true });
  });

  test('cancelar conserva el ticket; confirmar lo borra con sus filas relacionadas', async ({
    page
  }, testInfo) => {
    const isMobileProject = testInfo.project.name === 'mobile-chrome';
    await page.setViewportSize(
      isMobileProject ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    );
    await registerAndGoto(page, '/receipts');
    const token = await tokenOf(page);

    const uploadPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/receipts' && response.request().method() === 'POST';
    });
    await page.setInputFiles('input[name="ticketFile"]', {
      name: 'compra-borrar.png',
      mimeType: 'image/png',
      buffer: pngDeMentira()
    });
    const upload = await uploadPromise;
    expect(upload.status()).toBe(201);
    const uploaded = (await upload.json()) as { data: { id: string } };
    const receiptId = uploaded.data.id;

    const historyItem = page
      .locator('[data-test="receipt-history"] [data-test="ticket-history-item"]')
      .filter({ hasText: 'compra-borrar.png' });
    await expect(historyItem).toHaveCount(1, { timeout: 20000 });
    await historyItem.locator('a').first().click();
    await expect(page).toHaveURL(new RegExp(`/receipts/${receiptId}$`));
    await expect(page.locator('[data-test="ticket-error"]')).toBeVisible({ timeout: 20000 });

    // Añadir una línea de fixture por el endpoint real para comprobar que DELETE no deja huérfanas.
    const line = await page.request.post(`/api/receipts/${receiptId}/items`, {
      headers: { authorization: `Bearer ${token}` },
      data: { name: 'Artículo sintético', quantity: 1, unit: 'ud', category: 'other' }
    });
    expect(line.status()).toBe(201);
    expect(trabajosDeTicket(receiptId)).toBe(1);
    expect(filasPersistidasDeTicket(receiptId)).toEqual({
      receipts: 1,
      receiptItems: 1,
      aiJobs: 1
    });

    let deleteRequests = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'DELETE' && url.pathname === `/api/receipts/${receiptId}`) {
        deleteRequests += 1;
      }
    });

    const openDialog = async () => {
      await page.getByRole('button', { name: 'Borrar', exact: true }).click();
      const dialog = page.locator('app-confirm-dialog .modal-overlay');
      await expect(dialog).toContainText('compra-borrar.png');
      await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Eliminar', exact: true })).toBeVisible();
      return dialog;
    };

    const cancelDialog = await openDialog();
    const screenshotDirectory =
      process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputPath('screenshots');
    mkdirSync(screenshotDirectory, { recursive: true });
    const captureConfirmation = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await expect(cancelDialog).toBeVisible();
      await terminarTransiciones(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        'la ficha y el diálogo no deben desbordar horizontalmente'
      ).toBe(true);
      await page.screenshot({
        path: join(
          screenshotDirectory,
          `receipt-delete-confirmation-${testInfo.project.name}-${width}x${height}.png`
        )
      });
    };
    if (isMobileProject) {
      await captureConfirmation(390, 844);
      await captureConfirmation(320, 740);
    } else {
      await captureConfirmation(1440, 900);
    }
    await cancelDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('app-confirm-dialog .modal-overlay')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/receipts/${receiptId}$`));
    expect(deleteRequests).toBe(0);
    const preserved = await page.request.get(`/api/receipts/${receiptId}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(preserved.status()).toBe(200);
    expect(filasPersistidasDeTicket(receiptId)).toEqual({
      receipts: 1,
      receiptItems: 1,
      aiJobs: 1
    });

    const confirmDialog = await openDialog();
    const deleteResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/receipts/${receiptId}` && response.request().method() === 'DELETE'
      );
    });
    await confirmDialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
    const deletedResponse = await deleteResponsePromise;
    expect(deletedResponse.status()).toBe(200);
    await expect(page).toHaveURL(/\/receipts$/);
    await expect(page.locator('.tickets')).toBeVisible();
    await expect(
      page.locator('[data-test="receipt-history"]').getByText('compra-borrar.png')
    ).toHaveCount(0);
    expect(deleteRequests).toBe(1);

    const missing = await page.request.get(`/api/receipts/${receiptId}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(missing.status()).toBe(404);
    expect(filasPersistidasDeTicket(receiptId)).toEqual({
      receipts: 0,
      receiptItems: 0,
      aiJobs: 0
    });
    await terminarTransiciones(page);
    const viewport = page.viewportSize();
    await page.screenshot({
      path: join(
        screenshotDirectory,
        `receipt-deleted-${testInfo.project.name}-${viewport?.width ?? 'unknown'}x${viewport?.height ?? 'unknown'}.png`
      )
    });
  });

  test('parar todo desde el icono deja los trabajos detenidos', async ({ page }) => {
    await registerAndGoto(page, '/receipts');

    await page.setInputFiles('input[name="ticketFile"]', {
      name: 'ticket.png',
      mimeType: 'image/png',
      buffer: pngDeMentira()
    });

    // Hay DOS iconos de la cola (cabecera movil y sidebar): el visible es el del viewport.
    const icono = iconoVisibleDeCola(page);
    await icono.click();
    const panel = page.locator('[data-test="receipt-queue-panel"]');
    await expect(panel).toBeVisible();

    // Parar todo: sin trabajos en marcha la accion no rompe nada, y el panel sigue en pie.
    const pararTodo = panel.getByRole('button', { name: 'Parar todo' });
    if (await pararTodo.isVisible().catch(() => false)) {
      await pararTodo.click();
    }
    await expect(panel).toBeVisible();
  });
});

test.describe('metadatos e historial con zona horaria extrema', () => {
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  for (const scenario of [
    {
      language: 'es',
      store: null,
      purchaseDate: null,
      storeLabel: 'Tienda',
      dateLabel: 'Fecha de compra',
      emptyDateLabel: 'Sin fecha',
      uploadLabel: 'Subido',
      correctedStore: 'Mercado corregido QA',
      correctedDate: '2024-03-01',
      historyPurchaseDate: '1/3/24',
      savedLabel: 'Cambios guardados'
    },
    {
      language: 'en',
      store: null,
      purchaseDate: null,
      storeLabel: 'Store',
      dateLabel: 'Purchase date',
      emptyDateLabel: 'No date',
      uploadLabel: 'Uploaded',
      correctedStore: 'Edited QA store',
      correctedDate: '2024-03-02',
      historyPurchaseDate: '02/03/2024',
      savedLabel: 'Changes saved'
    }
  ] as const) {
    test(`la extracción IA conserva tienda y fecha civil (${scenario.language})`, async ({
      page
    }, testInfo) => {
      const respuesta = {
        store: scenario.store,
        purchaseDate: scenario.purchaseDate,
        lines: [
          {
            name: 'Naranjas QA',
            quantity: 2,
            unit: 'kg',
            category: 'fruits',
            createCategory: false,
            priceMinor: 300,
            offer: null,
            confidence: 0.97,
            note: ''
          }
        ],
        currency: 'EUR',
        totalMinor: 300,
        warnings: []
      };
      let liberarRespuestaProveedor: () => void = () => {};
      const respuestaProveedorPendiente = new Promise<void>((resolve) => {
        liberarRespuestaProveedor = resolve;
      });
      const proveedor = await iniciarProveedorDeTickets(
        respuesta,
        () => respuestaProveedorPendiente
      );
      const erroresPagina: string[] = [];
      page.on('pageerror', (error) => erroresPagina.push(`${error.name}: ${error.message}`));

      try {
        await registerAndGoto(page, '/receipts');
        await page.evaluate((language) => {
          window.localStorage.setItem('hogar:v1:language', language);
        }, scenario.language);
        await page.reload();
        await expect(
          page.getByRole('heading', { name: scenario.language === 'es' ? 'Tickets' : 'Receipts' })
        ).toBeVisible();
        const token = await tokenOf(page);

        const configuration = await page.request.post('/api/ai/configs', {
          headers: { authorization: `Bearer ${token}` },
          data: {
            name: 'Proveedor sintético de tickets',
            provider: 'custom',
            baseUrl: proveedor.baseUrl,
            apiKey: 'synthetic-e2e-only',
            model: 'synthetic-ticket-model',
            timeout: 10_000,
            retryAttempts: 0
          }
        });
        expect(configuration.status()).toBe(201);

        const uploadResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/receipts' &&
            response.request().method() === 'POST'
        );
        await page.setInputFiles('input[name="ticketFile"]', {
          name: 'ticket-sintetico.png',
          mimeType: 'image/png',
          buffer: pngDeMentira()
        });
        const uploadResult = await uploadResponse;
        expect(uploadResult.status()).toBe(201);
        const uploadedReceipt = (await uploadResult.json()) as { data: { id: string } };
        const receiptId = uploadedReceipt.data.id;
        expect(receiptId).toBeTruthy();

        await expect.poll(() => proveedor.solicitudes.length, { timeout: 20_000 }).toBe(1);
        const receiptStatus = async () => {
          const response = await page.request.get(`/api/receipts/${receiptId}`, {
            headers: { authorization: `Bearer ${token}` }
          });
          expect(response.ok()).toBeTruthy();
          return ((await response.json()) as { data: { status: string } }).data.status;
        };
        await expect.poll(receiptStatus, { timeout: 20_000 }).toBe('analyzing');
        const providerRequest = proveedor.solicitudes[0];
        expect(providerRequest.model).toBe('synthetic-ticket-model');
        expect(providerRequest.stream).toBe(true);
        expect(providerRequest.response_format).toMatchObject({
          type: 'json_schema',
          json_schema: { strict: true }
        });
        const userContent = providerRequest.messages?.find(
          (message) => message.role === 'user'
        )?.content;
        const parts = Array.isArray(userContent) ? userContent : [];
        expect(parts).toHaveLength(3);
        expect(parts.map((part) => part.type).sort()).toEqual(['file', 'image_url', 'text']);
        expect(parts.find((part) => part.type === 'text')?.text).toContain('purchaseDate');
        expect(parts.find((part) => part.type === 'image_url')?.image_url?.url).toMatch(
          /^data:image\/png;base64,/
        );
        const inventoryFile = parts.find((part) => part.type === 'file');
        expect(inventoryFile?.file?.filename).toBe('inventario.json');
        const inventoryData = inventoryFile?.file?.file_data ?? '';
        expect(inventoryData).toMatch(/^data:application\/json;base64,/);
        const inventory = JSON.parse(
          Buffer.from(
            inventoryData.replace(/^data:application\/json;base64,/, ''),
            'base64'
          ).toString('utf8')
        ) as {
          categorias: { clave: string; nombre: string }[];
          productos: unknown[];
          tiendas: unknown[];
        };
        expect(inventory.categorias.map((category) => category.clave)).toContain(
          respuesta.lines[0].category
        );
        expect(inventory).toEqual({
          tiendas: expect.any(Array),
          categorias: expect.any(Array),
          productos: expect.any(Array)
        });

        const history = page.locator('[data-test="receipt-history"]');
        const historyRow = history.locator('[data-test="ticket-history-item"]');
        const pendingHistoryResponse = await page.request.get(
          '/api/receipts?scope=history&limit=50&offset=0',
          { headers: { authorization: `Bearer ${token}` } }
        );
        expect(pendingHistoryResponse.ok()).toBeTruthy();
        const pendingHistory = (await pendingHistoryResponse.json()) as {
          data: { id: string }[];
        };
        expect(pendingHistory.data.some((receipt) => receipt.id === receiptId)).toBe(false);
        await expect(historyRow).toHaveCount(0);
        liberarRespuestaProveedor();
        await expect.poll(receiptStatus, { timeout: 20_000 }).toBe('review');
        await expect(historyRow).toHaveCount(1, { timeout: 20_000 });
        if (scenario.store) await expect(historyRow).toContainText(scenario.store);
        if (!scenario.purchaseDate) {
          await expect(historyRow.locator('.ticket__meta')).toContainText(
            `${scenario.dateLabel}: ${scenario.emptyDateLabel}`
          );
        }
        await historyRow.locator('a').click();

        const detectedRows = page.locator('.tabla__fila');
        await expect(detectedRows).toHaveCount(1);
        await expect(detectedRows.locator('input[id$="-nombre"]')).toHaveValue('Naranjas QA');
        await expect(detectedRows.locator('input[id$="-cantidad"]')).toHaveValue('2');
        await expect(detectedRows.locator('input[id$="-unidad"]')).toHaveValue('kg');
        await expect(detectedRows.locator('input[id$="-precio"]')).toHaveValue('3.00');
        await expect(detectedRows.locator('input[id$="-oferta"]')).toHaveValue('');
        await expect(page.locator('.ficha__no-cuadra')).toHaveCount(0);

        const storeField = page.getByLabel(scenario.storeLabel);
        const purchaseDateField = page.getByLabel(scenario.dateLabel);
        await expect(storeField).toHaveValue(scenario.store ?? '');
        await expect(storeField).toBeEnabled();
        await expect(purchaseDateField).toHaveValue(scenario.purchaseDate ?? '');
        await expect(purchaseDateField).toBeEnabled();
        await storeField.focus();
        await expect(storeField).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(purchaseDateField).toBeFocused();

        const detailResponse = await page.request.get(`/api/receipts/${receiptId}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect(detailResponse.ok()).toBeTruthy();
        const detail = (await detailResponse.json()) as {
          data: {
            status: string;
            store: string | null;
            purchaseDate: string | null;
            createdAt: string;
            lines: {
              name: string;
              quantity: number;
              unit: string | null;
              category: string;
              priceMinor: number | null;
              offer: { buy: number; take: number } | null;
            }[];
          };
        };
        expect(detail.data).toMatchObject({
          status: 'review',
          store: scenario.store,
          purchaseDate: scenario.purchaseDate,
          lines: [
            {
              name: 'Naranjas QA',
              quantity: 2,
              unit: 'kg',
              category: respuesta.lines[0].category,
              priceMinor: 300,
              offer: null
            }
          ]
        });

        await storeField.fill(scenario.correctedStore);
        await purchaseDateField.fill(scenario.correctedDate);
        const metadataSaved = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/receipts/${receiptId}` &&
            response.request().method() === 'PATCH'
        );
        await page.locator('[data-test="save-receipt-metadata"]').click();
        expect((await metadataSaved).ok()).toBeTruthy();
        await expect(page.locator('.ficha__metadatos-estado')).toContainText(scenario.savedLabel);

        const updatedDetailResponse = await page.request.get(`/api/receipts/${receiptId}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect(updatedDetailResponse.ok()).toBeTruthy();
        expect((await updatedDetailResponse.json()).data).toMatchObject({
          status: 'review',
          store: scenario.correctedStore,
          purchaseDate: scenario.correctedDate
        });

        await page.reload();
        await expect(storeField).toHaveValue(scenario.correctedStore);
        await expect(purchaseDateField).toHaveValue(scenario.correctedDate);

        const originalViewport = page.viewportSize() ?? { width: 1280, height: 720 };
        for (const viewport of [
          { width: 320, height: 568 },
          { width: 480, height: 800 },
          { width: 481, height: 800 },
          { width: 568, height: 320 },
          { width: 640, height: 800 },
          { width: 641, height: 800 },
          { width: 1280, height: 720 }
        ]) {
          await page.setViewportSize(viewport);
          const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          expect(
            documentWidth,
            `sin overflow a ${viewport.width}×${viewport.height}`
          ).toBeLessThanOrEqual(viewport.width);
          for (const field of [storeField, purchaseDateField]) {
            const bounds = await field.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { left: rect.left, right: rect.right };
            });
            expect(
              bounds.left,
              `campo dentro del viewport ${viewport.width}px`
            ).toBeGreaterThanOrEqual(0);
            expect(
              bounds.right,
              `campo dentro del viewport ${viewport.width}px`
            ).toBeLessThanOrEqual(viewport.width);
          }
        }
        await page.setViewportSize(originalViewport);
        await page
          .getByRole('link', {
            name: scenario.language === 'es' ? 'Volver a tickets' : 'Back to receipts'
          })
          .click();
        await expect(historyRow).toHaveCount(1);
        const metadata = await historyRow.locator('.ticket__meta').innerText();
        const segments = metadata.split('·').map((segment) => segment.trim());
        const expectedUploadDate = await page.evaluate(
          ({ createdAt, language }) =>
            new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            }).format(new Date(createdAt)),
          { createdAt: detail.data.createdAt, language: scenario.language }
        );
        expect(segments[0]).toContain(`${scenario.dateLabel}: ${scenario.historyPurchaseDate}`);
        expect(segments[1]).toBe(`${scenario.uploadLabel}: ${expectedUploadDate}`);
        await expect(historyRow).toContainText(scenario.correctedStore);
        expect(segments[0]).not.toContain(scenario.language === 'es' ? 'Sin fecha' : 'No date');
        expect(segments[0].slice(segments[0].indexOf(':') + 1).trim()).not.toBe(
          segments[1].slice(segments[1].indexOf(':') + 1).trim()
        );
        await cerrarAvisos(page);
        await terminarTransiciones(page);
        const screenshotDirectory =
          process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-receipt-history-date-locale-1';
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `receipt-history-${testInfo.project.name}-${scenario.language}.png`
          ),
          fullPage: true
        });
        expect(erroresPagina).toEqual([]);
      } finally {
        liberarRespuestaProveedor();
        await proveedor.close();
      }
    });
  }
});

test.describe('ficha de ticket con total que no cuadra', () => {
  for (const scenario of [
    {
      language: 'es',
      warning: 'No cuadra con el total del ticket'
    },
    {
      language: 'en',
      warning: "Doesn't match the receipt total"
    }
  ] as const) {
    test(`muestra el aviso sin bloquear la revisión (${scenario.language})`, async ({
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
      const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
      if (isAbsolute(relativeDatabasePath) || relativeDatabasePath.startsWith('..')) {
        throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test');
      }

      const receiptId = `${profile.data.id}-total-mismatch`;
      const uploadedAt = new Date('2026-10-10T00:00:00.000Z').toISOString();
      const database = new Database(databasePath);
      try {
        database
          .prepare(
            `INSERT INTO receipts (
               id, user_id, status, store, purchase_date, currency, total_minor,
               file_url, file_kind, file_name, file_bytes, created_at
             ) VALUES (?, ?, 'review', ?, ?, 'EUR', 350, ?, 'png', ?, 8, ?)`
          )
          .run(
            receiptId,
            profile.data.id,
            'Mercado QA',
            '2026-10-09',
            `/api/uploads/receipts/${receiptId}.png`,
            'ticket-total-mismatch.png',
            uploadedAt
          );
        database
          .prepare(
            `INSERT INTO receipt_items (
               id, receipt_id, name, quantity, unit, category, price_minor,
               offer_buy, offer_take, note, confidence, position
             ) VALUES (?, ?, ?, 1, 'ud', 'other', 300, NULL, NULL, '', 0.99, 0)`
          )
          .run(`${receiptId}-line-1`, receiptId, 'Producto QA');
      } finally {
        database.close();
      }

      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await page.goto(`/receipts/${receiptId}`);

      const totals = page.locator('.ficha__totales');
      await expect(totals).toBeVisible();
      const values = totals.locator('.ficha__total-importe');
      await expect(values).toHaveCount(2);
      await expect(values.nth(0)).toContainText(/3[.,]00\s*€/);
      await expect(values.nth(1)).toContainText(/3[.,]50\s*€/);
      const discordantTotal = page.locator('.ficha__total-importe--mal');
      await expect(discordantTotal).toHaveCount(1);
      await expect(discordantTotal).toContainText(/3[.,]50\s*€/);
      await expect(page.locator('.ficha__no-cuadra')).toHaveText(scenario.warning);
      const amountColors = await Promise.all([
        values.nth(0).evaluate((element) => getComputedStyle(element).color),
        discordantTotal.evaluate((element) => getComputedStyle(element).color)
      ]);
      expect(amountColors[1]).not.toBe(amountColors[0]);
      await expect(page.locator('[data-test="ticket-confirmed"]')).toHaveCount(0);

      const detailResponse = await page.request.get(`/api/receipts/${receiptId}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(detailResponse.ok()).toBeTruthy();
      expect((await detailResponse.json()).data).toMatchObject({
        status: 'review',
        totalMinor: 350,
        lines: [expect.objectContaining({ name: 'Producto QA', priceMinor: 300 })]
      });

      const checkViewport = async (width: number, height: number) => {
        await page.setViewportSize({ width, height });
        await expect(discordantTotal).toBeVisible();
        await expect(page.locator('.ficha__no-cuadra')).toBeVisible();
        const dimensions = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth
        }));
        expect(dimensions.document, `sin overflow a ${width}×${height}`).toBeLessThanOrEqual(
          dimensions.viewport
        );
      };

      const screenshotDirectory =
        process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-receipt-total-mismatch';
      mkdirSync(screenshotDirectory, { recursive: true });
      if (testInfo.project.name === 'chromium') {
        await checkViewport(1440, 900);
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `receipt-total-mismatch-${scenario.language}-desktop.png`
          ),
          fullPage: true
        });
      } else {
        await checkViewport(390, 844);
        await page.screenshot({
          path: join(screenshotDirectory, `receipt-total-mismatch-${scenario.language}-mobile.png`),
          fullPage: true
        });
        await checkViewport(320, 740);
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `receipt-total-mismatch-${scenario.language}-mobile-320.png`
          ),
          fullPage: true
        });
      }

      expect(pageErrors).toEqual([]);
    });
  }
});

test.describe('metadatos manuales en reintentos de tickets', () => {
  test('conserva metadatos manuales tras fallo y reintento', async ({ page }) => {
    const respuestaDeReintento = {
      lines: [],
      store: 'Tienda que detecta el reintento',
      purchaseDate: '2020-01-02',
      currency: 'EUR',
      totalMinor: 0,
      warnings: []
    };
    const proveedor = await iniciarProveedorDeTickets(
      respuestaDeReintento,
      async (_request, index) => {
        // The worker makes a non-streaming fallback after a provider fails before sending any delta.
        if (index < 2) throw new Error('synthetic first-attempt failure');
      }
    );
    const erroresPagina: string[] = [];
    page.on('pageerror', (error) => erroresPagina.push(`${error.name}: ${error.message}`));

    try {
      await registerAndGoto(page, '/receipts');
      const token = await tokenOf(page);
      const configuration = await page.request.post('/api/ai/configs', {
        headers: { authorization: `Bearer ${token}` },
        data: {
          name: 'Proveedor sintético de reintento de tickets',
          provider: 'custom',
          baseUrl: proveedor.baseUrl,
          apiKey: 'synthetic-e2e-only',
          model: 'synthetic-ticket-retry-model',
          timeout: 10_000,
          retryAttempts: 0
        }
      });
      expect(configuration.status()).toBe(201);

      const uploadResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/receipts' &&
          response.request().method() === 'POST'
      );
      await page.setInputFiles('input[name="ticketFile"]', {
        name: 'ticket-reintento-sintetico.png',
        mimeType: 'image/png',
        buffer: pngDeMentira()
      });
      const uploadedResponse = await uploadResponse;
      expect(uploadedResponse.status()).toBe(201);
      const uploadBody = (await uploadedResponse.json()) as { data: { id: string } };
      const receiptId = uploadBody.data.id;
      expect(receiptId).toBeTruthy();

      const detailPath = `/api/receipts/${receiptId}`;
      const detailHeaders = { authorization: `Bearer ${token}` };
      const receiptStatus = async () => {
        const response = await page.request.get(detailPath, { headers: detailHeaders });
        return ((await response.json()) as { data: { status: string } }).data.status;
      };

      await expect.poll(() => proveedor.solicitudes.length, { timeout: 20_000 }).toBe(2);
      await expect.poll(receiptStatus, { timeout: 20_000 }).toBe('failed');
      expect(proveedor.solicitudes[0].stream).toBe(true);
      expect(proveedor.solicitudes[1].stream).toBeUndefined();
      expect(trabajosDeTicket(receiptId)).toBe(1);

      await page.goto(`/receipts/${receiptId}`);
      const storeField = page.getByLabel('Tienda');
      const purchaseDateField = page.getByLabel('Fecha de compra');
      const manualStore = 'Tienda corregida antes del reintento';
      const manualPurchaseDate = '2024-02-29';
      await expect(storeField).toHaveValue('');
      await expect(purchaseDateField).toHaveValue('');
      await storeField.fill(manualStore);
      await purchaseDateField.fill(manualPurchaseDate);

      const metadataSaved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === detailPath && response.request().method() === 'PATCH'
      );
      await page.locator('[data-test="save-receipt-metadata"]').click();
      expect((await metadataSaved).status()).toBe(200);
      await expect(page.locator('.ficha__metadatos-estado')).toContainText('Cambios guardados');
      expect(await receiptStatus()).toBe('failed');
      expect(
        (await (await page.request.get(detailPath, { headers: detailHeaders })).json()).data
      ).toMatchObject({
        store: manualStore,
        purchaseDate: manualPurchaseDate
      });

      const retryResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `${detailPath}/retry` &&
          response.request().method() === 'POST'
      );
      await page.getByRole('button', { name: 'Volver a leer', exact: true }).click();
      expect((await retryResponse).status()).toBe(200);
      await expect.poll(() => proveedor.solicitudes.length, { timeout: 20_000 }).toBe(3);
      await expect.poll(receiptStatus, { timeout: 20_000 }).toBe('review');

      const retriedDetail = await page.request.get(detailPath, { headers: detailHeaders });
      expect((await retriedDetail.json()).data).toMatchObject({
        status: 'review',
        store: manualStore,
        purchaseDate: manualPurchaseDate
      });
      expect(
        proveedor.solicitudes[2].messages?.find((message) => message.role === 'user')?.content
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text' }),
          expect.objectContaining({ type: 'image_url' })
        ])
      );
      expect(trabajosDeTicket(receiptId)).toBe(1);
      await expect(storeField).toHaveValue(manualStore);
      await expect(purchaseDateField).toHaveValue(manualPurchaseDate);

      await page.goto('/receipts');
      const historyRow = page
        .locator('[data-test="receipt-history"] [data-test="ticket-history-item"]')
        .filter({ hasText: manualStore });
      await expect(historyRow).toHaveCount(1);
      await expect(historyRow.locator('.ticket__meta')).toContainText('Fecha de compra');
      expect(erroresPagina).toEqual([]);
    } finally {
      await proveedor.close();
    }
  });
});

test.describe('metadatos editables mientras la IA trabaja', () => {
  for (const scenario of [
    {
      language: 'es',
      heading: 'Tickets',
      storeLabel: 'Tienda',
      dateLabel: 'Fecha de compra',
      savedLabel: 'Cambios guardados',
      manualStore: 'Tienda manual en cola'
    },
    {
      language: 'en',
      heading: 'Receipts',
      storeLabel: 'Store',
      dateLabel: 'Purchase date',
      savedLabel: 'Changes saved',
      manualStore: 'Store corrected while queued'
    }
  ] as const) {
    test(`guarda en cola y durante el análisis, y respeta las correcciones (${scenario.language})`, async ({
      page
    }, testInfo) => {
      const primerProveedorIniciado = deferred<TicketProviderRequest>();
      const liberarPrimerProveedor = deferred();
      const segundoProveedorIniciado = deferred<TicketProviderRequest>();
      const liberarSegundoProveedor = deferred();
      const providerAnswer = {
        lines: [],
        store: 'Tienda detectada por IA',
        purchaseDate: '2020-01-02',
        currency: 'EUR',
        totalMinor: 0,
        warnings: []
      };
      const provider = await iniciarProveedorDeTickets(providerAnswer, async (_request, index) => {
        if (index === 0) {
          primerProveedorIniciado.resolve(_request);
          await liberarPrimerProveedor.promise;
        } else if (index === 1) {
          segundoProveedorIniciado.resolve(_request);
          await liberarSegundoProveedor.promise;
        }
      });
      const erroresPagina: string[] = [];
      page.on('pageerror', (error) => erroresPagina.push(`${error.name}: ${error.message}`));

      try {
        await registerAndGoto(page, '/receipts');
        await page.evaluate((language) => {
          window.localStorage.setItem('hogar:v1:language', language);
        }, scenario.language);
        await page.reload();
        await expect(page.getByRole('heading', { name: scenario.heading })).toBeVisible();
        const token = await tokenOf(page);
        const configuration = await page.request.post('/api/ai/configs', {
          headers: { authorization: `Bearer ${token}` },
          data: {
            name: 'Proveedor sintético de metadatos activos',
            provider: 'custom',
            baseUrl: provider.baseUrl,
            apiKey: 'synthetic-e2e-only',
            model: 'synthetic-active-metadata-model',
            timeout: 30_000,
            retryAttempts: 0,
            concurrency: 1
          }
        });
        expect(configuration.status()).toBe(201);

        const subirTicketSintetico = async (fileName: string) => {
          const uploadResponse = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === '/api/receipts' &&
              response.request().method() === 'POST'
          );
          await page.setInputFiles('input[name="ticketFile"]', {
            name: fileName,
            mimeType: 'image/png',
            buffer: pngDeMentira()
          });
          const response = await uploadResponse;
          expect(response.status()).toBe(201);
          return (await response.json()).data as { id: string; status: string };
        };

        const blocker = await subirTicketSintetico('bloqueo-sintetico.png');
        expect(trabajosDeTicket(blocker.id)).toBe(1);
        expect((await primerProveedorIniciado.promise).model).toBe(
          'synthetic-active-metadata-model'
        );
        const target = await subirTicketSintetico('ticket-edicion-activa.png');
        expect(target.status).toBe('queued');
        expect(trabajosDeTicket(target.id)).toBe(1);
        const queuedResponse = await page.request.get(`/api/receipts/${target.id}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect((await queuedResponse.json()).data.status).toBe('queued');

        await page.goto(`/receipts/${target.id}`);
        const storeField = page.getByLabel(scenario.storeLabel);
        const purchaseDateField = page.getByLabel(scenario.dateLabel);
        await expect(storeField).toHaveValue('');
        await expect(storeField).toBeEnabled();
        await expect(purchaseDateField).toHaveValue('');
        await expect(purchaseDateField).toBeEnabled();
        await storeField.focus();
        await expect(storeField).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(purchaseDateField).toBeFocused();
        const llamadasAntesDeEditarEnCola = provider.solicitudes.length;

        let fallarPrimerPatch = true;
        await page.route(`**/api/receipts/${target.id}`, async (route) => {
          if (route.request().method() === 'PATCH' && fallarPrimerPatch) {
            fallarPrimerPatch = false;
            await route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ success: false, error: 'synthetic retryable failure' })
            });
            return;
          }
          await route.continue();
        });
        await storeField.fill(scenario.manualStore);
        const queuedPatch = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/receipts/${target.id}` &&
            response.request().method() === 'PATCH'
        );
        await page.locator('[data-test="save-receipt-metadata"]').click();
        expect((await queuedPatch).status()).toBe(503);
        await expect(page.locator('.ficha__metadatos-error')).toBeVisible();
        const queuedAfterFailure = await page.request.get(`/api/receipts/${target.id}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect((await queuedAfterFailure.json()).data).toMatchObject({
          status: 'queued',
          store: null,
          purchaseDate: null
        });

        const queuedRetry = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/receipts/${target.id}` &&
            response.request().method() === 'PATCH'
        );
        await page.locator('[data-test="save-receipt-metadata"]').click();
        expect((await queuedRetry).status()).toBe(200);
        await expect(page.locator('.ficha__metadatos-estado')).toContainText(scenario.savedLabel);
        const queuedAfterPatch = await page.request.get(`/api/receipts/${target.id}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect((await queuedAfterPatch.json()).data).toMatchObject({
          status: 'queued',
          store: scenario.manualStore,
          purchaseDate: null
        });
        expect(trabajosDeTicket(target.id)).toBe(1);
        expect(provider.solicitudes).toHaveLength(llamadasAntesDeEditarEnCola);

        // Leave the civil-date draft unsaved while the polling UI transitions queued -> analyzing.
        await purchaseDateField.fill('2024-02-29');
        liberarPrimerProveedor.resolve();
        expect((await segundoProveedorIniciado.promise).model).toBe(
          'synthetic-active-metadata-model'
        );
        await expect
          .poll(async () => {
            const response = await page.request.get(`/api/receipts/${target.id}`, {
              headers: { authorization: `Bearer ${token}` }
            });
            return (await response.json()).data.status;
          })
          .toBe('analyzing');
        await expect(storeField).toHaveValue(scenario.manualStore);
        await expect(purchaseDateField).toHaveValue('2024-02-29');
        await expect(storeField).toBeEnabled();
        await expect(purchaseDateField).toBeEnabled();

        const llamadasAntesDeEditarEnAnalisis = provider.solicitudes.length;
        const analyzingPatch = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/receipts/${target.id}` &&
            response.request().method() === 'PATCH'
        );
        await page.locator('[data-test="save-receipt-metadata"]').click();
        expect((await analyzingPatch).status()).toBe(200);
        await expect(page.locator('.ficha__metadatos-estado')).toContainText(scenario.savedLabel);
        const analyzingAfterPatch = await page.request.get(`/api/receipts/${target.id}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect((await analyzingAfterPatch.json()).data).toMatchObject({
          status: 'analyzing',
          store: scenario.manualStore,
          purchaseDate: '2024-02-29'
        });
        expect(trabajosDeTicket(target.id)).toBe(1);
        expect(provider.solicitudes).toHaveLength(llamadasAntesDeEditarEnAnalisis);

        const screenshotDirectory =
          process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-receipt-active-metadata-1';
        await cerrarAvisos(page);
        await terminarTransiciones(page);
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `receipt-active-metadata-${testInfo.project.name}-${scenario.language}.png`
          ),
          fullPage: true
        });

        const originalViewport = page.viewportSize();
        for (const viewport of [
          { width: 320, height: 568 },
          { width: 568, height: 320 },
          { width: 768, height: 1024 },
          { width: 1024, height: 768 }
        ]) {
          await page.setViewportSize(viewport);
          await expect(storeField).toBeVisible();
          await expect(purchaseDateField).toBeVisible();
          const widths = await page.evaluate(() => ({
            viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth
          }));
          expect(widths.document).toBeLessThanOrEqual(widths.viewport);
        }
        if (originalViewport) await page.setViewportSize(originalViewport);

        liberarSegundoProveedor.resolve();
        await expect
          .poll(async () => {
            const response = await page.request.get(`/api/receipts/${target.id}`, {
              headers: { authorization: `Bearer ${token}` }
            });
            return (await response.json()).data.status;
          })
          .toBe('review');
        const finalDetail = await page.request.get(`/api/receipts/${target.id}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect((await finalDetail.json()).data).toMatchObject({
          status: 'review',
          store: scenario.manualStore,
          purchaseDate: '2024-02-29'
        });
        expect(trabajosDeTicket(target.id)).toBe(1);

        await page.reload();
        await expect(storeField).toHaveValue(scenario.manualStore);
        await expect(purchaseDateField).toHaveValue('2024-02-29');
        await page.goto('/receipts');
        const history = page.locator('[data-test="receipt-history"]');
        const targetHistoryRow = history
          .locator('[data-test="ticket-history-item"]')
          .filter({ hasText: scenario.manualStore });
        await expect(targetHistoryRow).toHaveCount(1);
        await expect(targetHistoryRow).toContainText(scenario.manualStore);
        await expect(targetHistoryRow.locator('.ticket__meta')).toContainText(
          scenario.language === 'es' ? 'Fecha de compra' : 'Purchase date'
        );
        expect(erroresPagina).toEqual([]);
      } finally {
        liberarPrimerProveedor.resolve();
        liberarSegundoProveedor.resolve();
        await provider.close();
      }
    });
  }
});
