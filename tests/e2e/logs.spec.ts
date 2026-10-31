import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const SCREENSHOT_DIR = resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/logs-runtime');

test.describe('Logs page', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/logs');
    await expect(page.locator('.terminal__body')).toBeVisible();
  });

  test('should render the logs terminal', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Logs');
    // El indicador dice en que estado esta el stream, y ahora hay cuatro estados: un
    // booleano «conectado/no» esconda el «reintentando en 5 s», que es el unico que
    // permite distinguir un servidor reiniciandose de uno que no contesta.
    await expect(page.locator('[data-test="logs-status"]')).toContainText(
      /En vivo|Conectando|Reintentando|Sin conexion/
    );
    // Source/level filters
    await expect(page.locator('select.logs-select').first()).toBeVisible();
    // Pause / autoscroll / clear buttons exist
    await expect(page.getByRole('button', { name: /Pausar|Pause/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Auto-scroll/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Limpiar|Clear/ })).toBeVisible();
  });

  test('shows server uptime and the exact runtime image reference', async ({ page }) => {
    const viewport =
      test.info().project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 };
    await page.setViewportSize(viewport);

    const runtime = page.locator('[data-test="logs-runtime"]');
    const uptime = page.locator('[data-test="logs-server-uptime"]');
    const imageRef = page.locator('[data-test="logs-image-ref"]');
    await expect(runtime).toBeVisible();
    await expect(uptime).toHaveText(/\d+d \d{2}:\d{2}:\d{2}|No disponible|Unavailable/);
    await expect(imageRef).toContainText(
      /ghcr\.io\/|Build local \(sin etiqueta GHCR\)|Local build \(no GHCR tag\)/
    );
    if (process.env.E2E_EXPECTED_IMAGE_REF) {
      await expect(imageRef).toContainText(process.env.E2E_EXPECTED_IMAGE_REF);
    }

    for (const size of [
      { width: 320, height: 720 },
      { width: 360, height: 800 },
      { width: 393, height: 851 },
      { width: 600, height: 800 },
      { width: 601, height: 800 },
      { width: 768, height: 900 },
      { width: 851, height: 393 },
      { width: 1023, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(size);
      const box = await runtime.boundingBox();
      expect(box, `runtime metadata visible at ${size.width} × ${size.height}`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      expect(
        await runtime.evaluate((element) => element.scrollWidth <= element.clientWidth),
        `runtime metadata does not overflow at ${size.width} × ${size.height}`
      ).toBe(true);
    }

    await page.setViewportSize(viewport);

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await runtime.screenshot({
      path: join(SCREENSHOT_DIR, `${test.info().project.name}-runtime-info.png`),
      animations: 'disabled'
    });
  });

  test('should toggle pause and resume', async ({ page }) => {
    const pauseBtn = page.getByRole('button', { name: /Pausar|Pause/ });
    await pauseBtn.click();
    await expect(page.getByRole('button', { name: /Reanudar|Resume/ })).toBeVisible();

    await page.getByRole('button', { name: /Reanudar|Resume/ }).click();
    await expect(page.getByRole('button', { name: /Pausar|Pause/ })).toBeVisible();
  });

  test('should toggle auto-scroll off and on', async ({ page }) => {
    const autoBtn = page.getByRole('button', { name: /Auto-scroll/ });
    await autoBtn.click();
    await expect(autoBtn).toContainText('OFF');
    await autoBtn.click();
    await expect(autoBtn).toContainText('ON');
  });

  test('should filter by server source', async ({ page }) => {
    await page.locator('select.logs-select').first().selectOption('server');

    const lines = page.locator('.terminal__line');
    const count = await lines.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      await expect(lines.nth(i)).toContainText('[SRV]');
    }
  });

  // ── Copiar y seleccionar líneas ────────────────────────────────────────

  /**
   * Escribe tres líneas propias en el servidor (POST /api/logs es público) y
   * recarga para que el terminal las lea del historial: así el test no
   * depende de que el stream SSE llegue a través del proxy del dev server.
   */
  async function pushLogs(page: import('@playwright/test').Page, tag: string): Promise<void> {
    for (const suffix of ['alpha', 'beta', 'gamma']) {
      const res = await page.request.post('/api/logs', {
        data: { level: 'warn', message: `${tag} ${suffix}`, url: 'e2e' }
      });
      expect(res.ok()).toBeTruthy();
    }

    await page.reload();
    await expect(page.locator('.terminal__body')).toBeVisible();
    await expect(page.locator('.terminal__line', { hasText: `${tag} gamma` })).toBeVisible({
      timeout: 20000
    });
  }

  test('copies all the visible lines when nothing is selected', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const tag = `e2e-${Date.now()}`;
    await pushLogs(page, tag);

    const copyBtn = page.getByRole('button', { name: /Copiar/ });
    await expect(copyBtn).toContainText('Copiar todo');
    await expect(page.getByRole('button', { name: /Limpiar selección/ })).toHaveCount(0);

    await copyBtn.click();
    await expect(page.locator('.toast--success .toast__title')).toContainText('Copiado');

    await page.bringToFront();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(`${tag} alpha`);
    expect(clipboard).toContain(`${tag} gamma`);
  });

  test('selects lines with click, ctrl and shift and copies just those', async ({
    page,
    context
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const tag = `e2e-${Date.now()}`;
    await pushLogs(page, tag);

    const lines = page.locator('.terminal__line', { hasText: tag });
    await expect(lines).toHaveCount(3);
    const selected = page.locator('.terminal__line--selected');
    const countBtn = page.getByRole('button', { name: /Copiar seleccionado/ });
    /** El (N) del boton; NaN mientras la seleccion aun no esta pintada. */
    const readCount = () =>
      countBtn.textContent().then((t) => Number(t?.match(/\((\d+)\)/)?.[1] ?? NaN));

    // Clic normal: una línea
    await lines.nth(0).click();
    await expect(lines.nth(0)).toHaveClass(/terminal__line--selected/);
    await expect(countBtn).toContainText('(1)');
    await expect(page.getByRole('button', { name: /Limpiar selección/ })).toBeVisible();

    // Mayús + clic: selecciona el rango completo entre las dos. No se puede
    // esperar un (3) exacto: entre nuestra primera y nuestra tercera linea el
    // servidor puede haber escrito otras ([SRV] de las propias peticiones de la
    // app) y esas tambien entran en el rango. Lo que si tiene que cumplirse es
    // que las tres nuestras quedan seleccionadas y que el contador refleja el
    // rango real.
    await lines.nth(2).click({ modifiers: ['Shift'] });
    let range = 0;
    await expect
      .poll(async () => {
        range = await readCount();
        return range;
      })
      .toBeGreaterThanOrEqual(3);
    await expect(selected).toHaveCount(range);
    for (const i of [0, 1, 2]) {
      await expect(lines.nth(i)).toHaveClass(/terminal__line--selected/);
    }

    // Ctrl + clic: quita una del medio y el contador baja justo uno
    await lines.nth(1).click({ modifiers: ['Control'] });
    await expect.poll(readCount).toBe(range - 1);
    await expect(lines.nth(1)).not.toHaveClass(/terminal__line--selected/);
    await expect(selected).toHaveCount(range - 1);

    // Copiar solo lo seleccionado
    await countBtn.click();
    await page.bringToFront();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(`${tag} alpha`);
    expect(clipboard).not.toContain(`${tag} beta`);
    expect(clipboard).toContain(`${tag} gamma`);

    // Limpiar la selección
    await page.getByRole('button', { name: /Limpiar selección/ }).click();
    await expect(page.getByRole('button', { name: /Copiar todo/ })).toBeVisible();
    await expect(page.locator('.terminal__line--selected')).toHaveCount(0);
  });
});
