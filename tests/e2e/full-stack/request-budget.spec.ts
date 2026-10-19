import { expect, test } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';
import { watchRequests } from '../helpers/request-watch';
import { shoppingNewListAction } from '../helpers/shopping-ui';

async function expectNoRepeatAfterIdle(
  page: Parameters<typeof watchRequests>[0],
  watch: ReturnType<typeof watchRequests>
) {
  await page.waitForTimeout(1500);
  expect(watch.describeProblems()).toBe('sin rachas ni 429');
  watch.reset();
}

/**
 * El bucle de peticiones, medido desde fuera.
 *
 * Dos formas tiene un calendario (o un visor de logs) de quedarse mirando: pedir el mismo
 * rango otra vez porque la respuesta alimenta lo que se mira, y reconectar un stream que
 * no cuaja. Ninguna se ve en un test de «el titulo cambia cuando pulso ›»: se ve en el
 * numero de peticiones, y ese numero no lo miraba nadie.
 *
 * El umbral no es un numero redondo: son 3 repeticiones de la MISMA URL en 1,5 s. La app
 * real, navegando normal, no llega —cada accion pide URL distintas—, y el bug de las
 * rondas anteriores (un `computed` cebando a si mismo) llegaba en menos de un segundo.
 */

test.describe('presupuesto de peticiones en el stack de produccion', () => {
  test('la agenda y la cesta no repiten la misma peticion', async ({ page }) => {
    await registerUser(page, 'full-budget');
    await createHousehold(page, 'Hogar de presupuesto E2E');
    const watch = watchRequests(page);

    const firstRange = page.waitForResponse((response) =>
      response.url().includes('/api/calendar/range')
    );
    await page.goto('/calendar');
    expect((await firstRange).status()).toBe(200);
    const calendarBody = page.locator('.cal-body');
    await expect(calendarBody).toHaveAttribute('aria-busy', 'false');
    await expectNoRepeatAfterIdle(page, watch);

    const assertRangeSettles = async (action: () => Promise<void>) => {
      watch.reset();
      const range = page.waitForResponse((response) =>
        response.url().includes('/api/calendar/range')
      );
      await action();
      expect((await range).status()).toBe(200);
      await expect(calendarBody).toHaveAttribute('aria-busy', 'false');
      await expectNoRepeatAfterIdle(page, watch);
    };

    for (const label of ['Periodo siguiente', 'Periodo anterior', 'Periodo siguiente', 'Hoy']) {
      await assertRangeSettles(() =>
        page.locator('.cal-top__nav').getByRole('button', { name: label }).click()
      );
    }

    const tabs = page.getByRole('tab');
    for (let index = 0; index < (await tabs.count()); index += 1) {
      const tab = tabs.nth(index);
      if ((await tab.getAttribute('aria-selected')) === 'true') continue;
      await assertRangeSettles(() => tab.click());
    }

    await page.goto('/shopping');
    await expect(shoppingNewListAction(page)).toBeVisible();
    // The page load and first SSE-ready event are initial reads, not a repeat loop
    // caused by the list-creation action measured below.
    watch.reset();
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Cesta con presupuesto');
    await page.locator('[data-test="create-submit"]').click();
    await expect(page.locator('[data-test="add-input"]')).toBeVisible();
    await expectNoRepeatAfterIdle(page, watch);

    for (const item of ['2 Leche', '1 Pan', '3 Huevos']) {
      await page.locator('[data-test="add-input"]').fill(item);
      await page.locator('[data-test="add-submit"]').click();
      await expect(
        page.locator('[data-test="item-row"]').filter({ hasText: item.replace(/^\d+\s*/, '') })
      ).toBeVisible();
      await expectNoRepeatAfterIdle(page, watch);
    }
    await page.locator('[data-test="item-row"]').first().locator('[data-test="check"]').click();
    await expectNoRepeatAfterIdle(page, watch);

    // Los mutantes intencionales quedan fuera de la ventana de reposo que sigue.
    await watch.reset();
    await page.waitForTimeout(1500);
    expect(watch.describeProblems()).toBe('sin rachas ni 429');
    // Las pestañas siguen contando lo que hay, con lo que sea que haya en la URL.
    await expect(page.locator('[data-test="tab-todo"]')).toContainText(/Pendientes \(\d+\)/);
  });

  test('la bandeja y el detalle usan sus streams SSE reales una vez por pantalla', async ({
    page
  }) => {
    await page.addInitScript(() => {
      const OriginalEventSource = window.EventSource;
      type StreamAuditWindow = Window & {
        __qaReadyStreams?: Array<{ path: string; data: string }>;
      };

      Object.defineProperty(window, 'EventSource', {
        configurable: true,
        value: class extends OriginalEventSource {
          constructor(url: string, eventSourceInitDict?: EventSourceInit) {
            super(url, eventSourceInitDict);
            const path = new URL(url, window.location.href).pathname;
            if (!path.startsWith('/api/shopping/stream/')) return;

            this.addEventListener(
              'ready',
              (event) => {
                const audit = window as StreamAuditWindow;
                audit.__qaReadyStreams ??= [];
                audit.__qaReadyStreams.push({ path, data: (event as MessageEvent<string>).data });
              },
              { once: true }
            );
          }
        }
      });
    });
    await registerUser(page, 'full-sse');
    await createHousehold(page, 'Hogar de streams E2E');
    const watch = watchRequests(page, {
      windowMs: 2000,
      maxPerUrl: 1,
      // §12aj permite leer la cola cada segundo mientras se observa; no es un bucle SSE.
      ignore: /\.(js|css|svg|png|woff2?|ico|json)(\?|$)|\/api\/receipts\/queue(?:\?|$)/
    });
    const trayResponsePromise = page.waitForResponse((response) => {
      return new URL(response.url()).pathname === '/api/shopping/stream/tray';
    });
    await page.goto('/shopping');
    await expect(shoppingNewListAction(page)).toBeVisible();
    const trayResponse = await trayResponsePromise;
    expect(trayResponse.status()).toBe(200);
    expect(trayResponse.headers()['content-type']).toContain('text/event-stream');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const audit = window as Window & {
            __qaReadyStreams?: Array<{ path: string; data: string }>;
          };
          return audit.__qaReadyStreams?.some(
            (stream) => stream.path === '/api/shopping/stream/tray'
          );
        })
      )
      .toBe(true);
    const trayReady = await page.evaluate(() => {
      const audit = window as Window & {
        __qaReadyStreams?: Array<{ path: string; data: string }>;
      };
      return audit.__qaReadyStreams?.find((stream) => stream.path === '/api/shopping/stream/tray')
        ?.data;
    });
    expect(JSON.parse(trayReady ?? '{}').channels).toBeInstanceOf(Array);

    await expect
      .poll(
        () => watch.entries().filter((entry) => entry.url.includes('/api/shopping/stream/')).length
      )
      .toBe(1);

    const detailResponsePromise = page.waitForResponse((response) => {
      const path = new URL(response.url()).pathname;
      return /^\/api\/shopping\/stream\/lists\/[^/]+$/.test(path);
    });
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Cesta en vivo');
    await page.locator('[data-test="create-submit"]').click();
    await expect(page.locator('[data-test="add-input"]')).toBeVisible();
    const detailResponse = await detailResponsePromise;
    expect(detailResponse.status()).toBe(200);
    expect(detailResponse.headers()['content-type']).toContain('text/event-stream');
    await expect
      .poll(
        () => watch.entries().filter((entry) => entry.url.includes('/api/shopping/stream/')).length
      )
      .toBe(2);

    // La bandeja y el detalle tienen rutas de servidor distintas; una URL malformada
    // podría seguir contando como otro stream aunque sus respuestas fueran 404.
    const streams = watch.entries().filter((entry) => entry.url.includes('/api/shopping/stream/'));
    const paths = streams.map((entry) => new URL(entry.url.replace(/^[A-Z]+\s+/, '')).pathname);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe('/api/shopping/stream/tray');
    expect(paths[1]).toMatch(/^\/api\/shopping\/stream\/lists\/[^/]+$/);

    watch.reset();
    await page.waitForTimeout(2500);
    expect(watch.entries().filter((entry) => entry.url.includes('/api/shopping/stream/'))).toEqual(
      []
    );
    expect(watch.bursts(), watch.describeProblems()).toEqual([]);
  });
});
