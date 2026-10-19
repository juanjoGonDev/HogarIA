import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

/**
 * La pantalla de caducidades (HOGARIA-SPEC ## 12ak), de punta a punta y SIN proveedor de IA.
 *
 * Lo que se prueba es la promesa de la pantalla, no la calidad de las estimaciones (eso viven
 * los specs de server `caducidades` y `pantry-expiry`): que desde la despensa se llega con un
 * clic y la URL es la suya, que la lista llega ordenada por prisa —caducado, 2 dias, catalogo,
 * sin fecha al final—, que el origen de cada vida se ve (una fecha registrada no es un «≈4 dias»
 * del catalogo), que las cabeceras reordenan, y que «Estimar» sin IA configurada dice lo suyo
 * en vez de un error a secas. El ritmo de compra no se siembra aqui: el API pone «ahora» en
 * cada precio, y dos compras el mismo dia no hacen ritmo.
 */

const TOKEN_KEY = 'hogar:v1:auth_token';

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((clave) => window.localStorage.getItem(clave), TOKEN_KEY);
  expect(token, 'la sesion deberia tener token').toBeTruthy();
  return token as string;
}

async function apiPost(page: Page, path: string, token: string, body: unknown): Promise<any> {
  const response = await page.request.post(path, {
    headers: { authorization: `Bearer ${token}` },
    data: body
  });
  expect(response.ok(), `${path} deberia dar 2xx y dio ${response.status()}`).toBeTruthy();
  return response.json();
}

/** Un articulo con stock, por API: la pantalla solo lee. */
async function sembrar(
  page: Page,
  token: string,
  nombre: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await apiPost(page, '/api/pantry/ingredients', token, {
    name: nombre,
    category: 'other',
    quantity: 2,
    unit: 'unit',
    location: 'pantry',
    ...extra
  });
}

function dia(desplazado: number): string {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + desplazado);
  return fecha.toISOString().slice(0, 10);
}

const filaDe = (page: import('@playwright/test').Page) => page.locator('[data-test^="cad-fila-"]');
const nombreDe = (page: import('@playwright/test').Page, texto: string | RegExp) =>
  filaDe(page).filter({ hasText: texto });

async function captureErrorState(page: Page, testInfo: TestInfo): Promise<void> {
  const directory = process.env.E2E_SCREENSHOT_DIR;
  const viewport = page.viewportSize();
  if (!directory || !viewport) return;

  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(
      directory,
      `expiry-load-error-${testInfo.project.name}-${viewport.width}x${viewport.height}.png`
    ),
    fullPage: true
  });
}

async function expectErrorStateFitsViewport(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const button = document.querySelector('[data-test="cad-reintentar"] button');
    const rect = button?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      left: rect?.left ?? -1,
      right: rect?.right ?? Number.POSITIVE_INFINITY,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0
    };
  });

  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewport);
  expect(layout.width).toBeGreaterThanOrEqual(44);
  expect(layout.height).toBeGreaterThanOrEqual(44);
}

test.describe('las caducidades de la despensa (## 12ak)', () => {
  test('distingue el error de carga del vacío y permite reintentar por teclado', async ({
    page
  }, testInfo) => {
    let controlExpiryResponses = false;
    let controlledRequests = 0;
    await page.route('**/api/pantry/expiry', async (route) => {
      if (!controlExpiryResponses) {
        await route.continue();
        return;
      }

      controlledRequests += 1;
      if (controlledRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'TEMPORARY_FAILURE' })
        });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'qa-expiry-retry',
              name: 'Tomates de prueba',
              category: 'other',
              quantity: 2,
              unit: 'ud',
              expirationDate: '2026-10-04',
              estimatedDays: null,
              shelfSource: 'fecha',
              vence: '2026-10-04',
              daysLeft: 2,
              cadaDias: null,
              unidadesPorCompra: null,
              duraDias: null,
              lastBought: null
            }
          ]
        })
      });
    });

    await registerAndGoto(page, '/pantry/caducidades', 'qa-cad-load-retry');
    await expect(page.locator('.cad__vacio')).toBeVisible();
    controlExpiryResponses = true;

    const firstFailure = page.waitForResponse(
      (response) => response.url().endsWith('/api/pantry/expiry') && response.status() === 503
    );
    await page.reload();
    await firstFailure;
    await expect(page.locator('.cad__vacio')).toHaveCount(0);
    await expect(page.locator('[data-test="cad-error-carga"]')).toContainText(
      'No se pudieron cargar las caducidades'
    );
    await expect(page.locator('.toast-container [role="alert"]')).toHaveCount(0);

    const mobile = testInfo.project.name === 'mobile-chrome';
    await page.setViewportSize(mobile ? { width: 320, height: 740 } : { width: 1440, height: 900 });
    await expectErrorStateFitsViewport(page);
    await captureErrorState(page, testInfo);
    if (mobile) {
      await page.setViewportSize({ width: 393, height: 851 });
      await expectErrorStateFitsViewport(page);
      await captureErrorState(page, testInfo);
      await page.setViewportSize({ width: 320, height: 740 });
    }

    const retry = page.getByRole('button', { name: 'Reintentar' });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-test="cad-reintentar"]')).toHaveCount(0);
    await expect(page.locator('app-loading .spinner')).toBeVisible();

    await expect(page.locator('[data-test="cad-fila-Tomates de prueba"]')).toBeVisible();
    await expect(page.locator('[data-test="cad-error-carga"]')).toHaveCount(0);
    expect(controlledRequests).toBe(2);
  });

  test('un 200 con lista vacía conserva el estado vacío legítimo', async ({ page }) => {
    await page.route('**/api/pantry/expiry', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] })
      })
    );

    await registerAndGoto(page, '/pantry/caducidades', 'qa-cad-load-empty');

    await expect(page.locator('.cad__vacio')).toContainText('La despensa está vacía');
    await expect(page.locator('[data-test="cad-error-carga"]')).toHaveCount(0);
  });

  test('traduce el error de carga al inglés', async ({ page }) => {
    await page.route('**/api/pantry/expiry', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'TEMPORARY_FAILURE' })
      })
    );

    await registerAndGoto(page, '/pantry/caducidades', 'qa-cad-load-english');
    await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();

    await expect(page.locator('[data-test="cad-error-carga"]')).toContainText(
      'Expiry data could not be loaded'
    );
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('de la despensa a la pantalla: orden por prisa, origen a la vista, reordenar y estimar sin IA', async ({
    page
  }) => {
    await registerAndGoto(page, '/pantry', 'r39-cad');
    const token = await tokenOf(page);

    // Cuatro casos, uno por origen de vida: fecha caducada, fecha critica, catalogo y nada.
    await sembrar(page, token, 'Yogur natural', { expirationDate: dia(-1) });
    await sembrar(page, token, 'Leche entera', { expirationDate: dia(2) });
    await sembrar(page, token, 'Pan de barra');
    await sembrar(page, token, 'Quinoa real');

    await page.locator('[data-test="pantry-caducidades"]').click();
    await expect(page).toHaveURL(/\/pantry\/caducidades/);
    await expect(page.locator('h1')).toContainText('Caducidades');

    // El resumen cuenta lo que hay: uno caducado, dos esta semana (la leche y el pan del
    // catalogo, que tambien vence en dias), y la quinoa sin fecha conocida.
    const resumen = page.locator('[data-test="cad-resumen"]');
    await expect(resumen).toContainText('1 caducados');
    await expect(resumen).toContainText('2 esta semana');
    await expect(resumen).toContainText('1 sin fecha');

    // La prisa manda: caducado, 2 dias, catalogo (~dias) y lo sin fecha cierra la marcha.
    await expect(filaDe(page)).toHaveCount(4);
    await expect(filaDe(page).nth(0)).toContainText('Yogur natural');
    await expect(filaDe(page).nth(0)).toContainText('Hace 1 días');
    await expect(filaDe(page).nth(1)).toContainText('Leche entera');
    await expect(filaDe(page).nth(1)).toContainText('2 días');
    await expect(filaDe(page).nth(2)).toContainText('Pan de barra');
    // El pan sale del catalogo de bolsillo: origen «Catálogo» y dias con ≈, no fecha.
    await expect(filaDe(page).nth(2)).toContainText('Catálogo');
    await expect(filaDe(page).nth(2)).toContainText('≈');
    await expect(nombreDe(page, 'Leche entera')).toContainText('Fecha');
    // La quinoa no sabe cuando vence y eso tambien se dice.
    await expect(filaDe(page).nth(3)).toContainText('Quinoa real');
    await expect(filaDe(page).nth(3)).toContainText('sin datos');

    // La grafica es la misma historia en barras: la primera es lo caducado.
    await expect(page.locator('[data-test="cad-grafica"] .cad-barra')).toHaveCount(4);
    await expect(page.locator('[data-test="cad-grafica"] .cad-barra').first()).toContainText(
      'Yogur natural'
    );

    // Reordenar por nombre: alfabetico y toggle de vuelta.
    await page.locator('[data-test="cad-orden-nombre"]').click();
    await expect(filaDe(page).nth(0)).toContainText('Leche entera');
    await expect(filaDe(page).nth(3)).toContainText('Yogur natural');
    await page.locator('[data-test="cad-orden-nombre"]').click();
    await expect(filaDe(page).nth(0)).toContainText('Yogur natural');

    // «Estimar» sin IA configurada: la quinoa no esta en el catalogo, asi que el server dice
    // NO_CONFIG y la pantalla lo traduce —configura la IA—, no un error generico.
    await page.locator('[data-test="cad-estimar"]').click();
    await expect(page.locator('[data-test="cad-error"]')).toContainText('Falta configurar la IA');

    // El aviso del planificador (## 12ak en /calendar): lo que caduca en 7 dias, a la vista.
    await page.goto('/calendar');
    await page.getByRole('button', { name: /Planificar IA/ }).click();
    await expect(page.locator('[data-test="gen-caducidades"]')).toContainText('Yogur natural');
  });

  test('ordena por caducidad, nombre y duración, y vuelve al inventario', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const rows = [
      {
        id: 'qa-expiry-zeta',
        name: 'Zanahoria',
        category: 'other',
        quantity: 2,
        unit: 'ud',
        expirationDate: dia(2),
        estimatedDays: null,
        shelfSource: 'fecha',
        vence: dia(2),
        daysLeft: 2,
        cadaDias: null,
        unidadesPorCompra: null,
        duraDias: 20,
        lastBought: null
      },
      {
        id: 'qa-expiry-uva',
        name: 'Uva',
        category: 'other',
        quantity: 2,
        unit: 'ud',
        expirationDate: dia(-1),
        estimatedDays: null,
        shelfSource: 'fecha',
        vence: dia(-1),
        daysLeft: -1,
        cadaDias: null,
        unidadesPorCompra: null,
        duraDias: 30,
        lastBought: null
      },
      {
        id: 'qa-expiry-manzana',
        name: 'Manzana',
        category: 'other',
        quantity: 2,
        unit: 'ud',
        expirationDate: dia(5),
        estimatedDays: null,
        shelfSource: 'fecha',
        vence: dia(5),
        daysLeft: 5,
        cadaDias: null,
        unidadesPorCompra: null,
        duraDias: 10,
        lastBought: null
      },
      {
        id: 'qa-expiry-sin-fecha',
        name: 'Sin fecha',
        category: 'other',
        quantity: 2,
        unit: 'ud',
        expirationDate: null,
        estimatedDays: null,
        shelfSource: null,
        vence: null,
        daysLeft: null,
        cadaDias: null,
        unidadesPorCompra: null,
        duraDias: null,
        lastBought: null
      }
    ];

    await page.route('**/api/pantry/expiry', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: rows })
      });
    });

    await registerAndGoto(page, '/pantry/caducidades', 'qa-expiry-route-audit');
    const mobile = testInfo.project.name === 'mobile-chrome';
    const viewport = mobile ? { width: 393, height: 851 } : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await expect(filaDe(page)).toHaveCount(4);

    const names = () =>
      page.locator('[data-test^="cad-fila-"] .cad-tabla__nombre').allTextContents();
    await expect.poll(names).toEqual(['Uva', 'Zanahoria', 'Manzana', 'Sin fecha']);

    const sortByExpiry = page.getByRole('button', { name: 'Ordenar por Caduca' });
    const sortByName = page.getByRole('button', { name: 'Ordenar por Producto' });
    const sortByDuration = page.getByRole('button', { name: 'Ordenar por El stock dura' });
    await expect(sortByExpiry).toBeVisible();
    await expect(sortByName).toBeVisible();
    await expect(sortByDuration).toBeVisible();

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      const projectDirectory = join(screenshotDirectory, testInfo.project.name);
      mkdirSync(projectDirectory, { recursive: true });
      await page.screenshot({
        path: join(projectDirectory, `expiry-route-${viewport.width}x${viewport.height}.png`),
        fullPage: true,
        animations: 'disabled'
      });
    }

    await sortByExpiry.focus();
    await page.keyboard.press('Enter');
    await expect.poll(names).toEqual(['Manzana', 'Zanahoria', 'Uva', 'Sin fecha']);
    await sortByName.click();
    await expect.poll(names).toEqual(['Manzana', 'Sin fecha', 'Uva', 'Zanahoria']);
    await sortByDuration.click();
    await expect.poll(names).toEqual(['Sin fecha', 'Manzana', 'Zanahoria', 'Uva']);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewport.width);
    await page.getByRole('link', { name: 'Volver al inventario' }).click();
    await expect(page).toHaveURL(/\/pantry$/);
    await expect(page.locator('[data-test="pantry-caducidades"]')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
