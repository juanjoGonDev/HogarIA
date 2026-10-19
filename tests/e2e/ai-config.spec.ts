import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test.describe('AI Config', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/ai-config');
    await expect(page.locator('h1.ai-config__title')).toBeVisible();
  });

  test('should display AI config page', async ({ page }) => {
    await expect(page.locator('h1.ai-config__title')).toContainText('Configuración IA');
  });

  test('should show info message', async ({ page }) => {
    await expect(page.locator('.ai-config__info')).toContainText('Conecta tu proveedor de IA');
  });

  test('should show empty state with the add button', async ({ page }) => {
    await expect(page.locator('.empty-state__title')).toContainText('Sin configuraciones');
    await expect(page.getByRole('button', { name: /Agregar configuración/ }).first()).toBeVisible();
  });

  test('uses SVG decorations and clean text in the empty state', async ({ page }, testInfo) => {
    const copy = await page.locator('.ai-config__title, .empty-state').allTextContents();
    expect(copy.join(' ')).not.toMatch(/\p{Extended_Pictographic}/u);
    await expect(page.locator('.empty-state__icon app-icon svg')).toBeVisible();

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      const isMobile = testInfo.project.name === 'mobile-chrome';
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.setViewportSize(
        isMobile ? { width: 393, height: 852 } : { width: 1440, height: 900 }
      );
      await page.screenshot({
        path: join(screenshotDirectory, `ai-config-empty-${isMobile ? 'mobile' : 'desktop'}.png`),
        animations: 'disabled'
      });
    }
  });

  test('does not confuse loading or request failure with an empty configuration list', async ({
    page
  }) => {
    let signalLoadedResponse!: () => void;
    let releaseLoadedResponse!: () => void;
    const loadedResponse = new Promise<void>((resolve) => {
      signalLoadedResponse = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseLoadedResponse = resolve;
    });

    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      signalLoadedResponse();
      await responseGate;
      await route.fulfill({ response });
    });

    const reload = page.reload();
    await loadedResponse;
    await expect(page.locator('.ai-config__loading')).toBeVisible();
    await expect(page.locator('.empty-state')).toHaveCount(0);
    releaseLoadedResponse();
    await reload;
    await expect(page.locator('.empty-state__title')).toContainText('Sin configuraciones');

    await page.unroute('**/api/ai/configs');
    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic load failure' })
        });
        return;
      }
      await route.continue();
    });
    await page.reload();
    await expect(page.locator('.ai-config__load-error')).toHaveAttribute('role', 'alert');
    await expect(page.locator('.empty-state')).toHaveCount(0);
    await expect(page.locator('.toast--error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reintentar' })).toBeEnabled();

    await page.unroute('**/api/ai/configs');
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.locator('.empty-state__title')).toContainText('Sin configuraciones');
  });

  test('AI form actions stay inside the modal and remain touchable across breakpoints', async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.reload();
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await expect
      .poll(() =>
        page
          .locator('.modal')
          .evaluate((modal) =>
            modal.getAnimations().some((animation) => animation.playState === 'running')
          )
      )
      .toBe(false);

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 852 },
      { width: 480, height: 852 },
      { width: 481, height: 852 },
      { width: 600, height: 852 },
      { width: 601, height: 852 },
      { width: 767, height: 900 },
      { width: 768, height: 900 },
      { width: 769, height: 900 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      const modal = await page.locator('.modal--lg').boundingBox();
      expect(modal, `modal visible en ${viewport.width}×${viewport.height}`).not.toBeNull();
      expect(modal!.y, `modal dentro del viewport en ${viewport.height}px`).toBeGreaterThanOrEqual(
        0
      );
      expect(
        modal!.y + modal!.height,
        `modal dentro del viewport en ${viewport.height}px`
      ).toBeLessThanOrEqual(viewport.height);

      const documentBounds = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }));
      expect(
        documentBounds.scrollWidth,
        `documento sin overflow en ${viewport.width}px`
      ).toBeLessThanOrEqual(documentBounds.viewportWidth);

      for (const button of await page.locator('.form-actions button').all()) {
        const box = await button.boundingBox();
        expect(box, `acción visible en ${viewport.width}×${viewport.height}`).not.toBeNull();
        expect(
          box!.x,
          `acción no sobresale a la izquierda en ${viewport.width}px`
        ).toBeGreaterThanOrEqual(modal!.x);
        expect(
          box!.x + box!.width,
          `acción no sobresale a la derecha en ${viewport.width}px`
        ).toBeLessThanOrEqual(modal!.x + modal!.width);
        if (viewport.width <= 600) {
          expect(
            box!.height,
            `objetivo táctil mínimo a ${viewport.width}px`
          ).toBeGreaterThanOrEqual(44);
        }
      }

      if (viewport.width <= 600) {
        const closeTarget = await page.locator('.modal__close').boundingBox();
        expect(closeTarget, `cerrar modal visible en ${viewport.width}px`).not.toBeNull();
        expect(
          closeTarget!.width,
          `ancho táctil del cierre en ${viewport.width}px`
        ).toBeGreaterThanOrEqual(44);
        expect(
          closeTarget!.height,
          `alto táctil del cierre en ${viewport.width}px`
        ).toBeGreaterThanOrEqual(44);
      }

      const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
      const shouldCapture =
        (testInfo.project.name === 'mobile-chrome' && viewport.width === 393) ||
        (testInfo.project.name === 'chromium' && viewport.width === 1440);
      if (screenshotDirectory && shouldCapture) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `ai-config-form-${testInfo.project.name === 'mobile-chrome' ? 'mobile' : 'desktop'}.png`
          ),
          animations: 'disabled'
        });
      }

      if (testInfo.project.name === 'mobile-chrome' && viewport.width === 393) {
        const modalBody = page.locator('.modal__body');
        const scrollMetrics = await modalBody.evaluate((body) => ({
          clientHeight: body.clientHeight,
          scrollHeight: body.scrollHeight
        }));
        expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
        await modalBody.evaluate((body) => {
          body.scrollTop = body.scrollHeight;
        });
        await expect(page.getByRole('button', { name: 'Crear' })).toBeInViewport();

        if (screenshotDirectory) {
          await page.screenshot({
            path: join(screenshotDirectory, 'ai-config-form-actions-mobile.png'),
            animations: 'disabled'
          });
        }

        await modalBody.evaluate((body) => {
          body.scrollTop = 0;
        });
      }
    }
  });

  test('should open add config modal with its fields', async ({ page }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();

    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal__title')).toContainText('Nueva Configuración');
    await expect(page.locator('input#maxTokens')).toHaveValue('4096');
    await expect(page.locator('input#name')).toBeVisible();
    await expect(page.locator('input#model')).toBeVisible();
    await expect(page.locator('input#baseUrl')).toBeVisible();
    await expect(page.locator('input#apiKey')).toBeVisible();
  });

  test('toggles the API key visibility accessibly without saving or testing the config', async ({
    page
  }) => {
    let saveRequests = 0;
    let testRequests = 0;
    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      saveRequests += 1;
      await route.fulfill({ status: 500, json: { success: false } });
    });
    await page.route('**/api/ai/test-connection', async (route) => {
      testRequests += 1;
      await route.fulfill({ status: 500, json: { success: false } });
    });

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    const apiKey = page.locator('input#apiKey');
    const syntheticKey = 'synthetic-ai-key-for-ui-test';
    await apiKey.fill(syntheticKey);
    await expect(apiKey).toHaveAttribute('type', 'password');

    const showButton = page.getByRole('button', { name: 'Mostrar contraseña' });
    await expect(showButton).toBeVisible();
    await showButton.focus();
    await page.keyboard.press('Enter');
    await expect(apiKey).toHaveAttribute('type', 'text');
    await expect(apiKey).toHaveValue(syntheticKey);

    const hideButton = page.getByRole('button', { name: 'Ocultar contraseña' });
    await expect(hideButton).toBeVisible();
    await hideButton.focus();
    await page.keyboard.press('Space');
    await expect(apiKey).toHaveAttribute('type', 'password');
    await expect(apiKey).toHaveValue(syntheticKey);
    await expect(page.getByRole('dialog', { name: 'Nueva Configuración' })).toBeVisible();
    await expect(page.locator('.test-result__title')).toHaveCount(0);
    expect(saveRequests).toBe(0);
    expect(testRequests).toBe(0);
  });

  test('moves, traps and restores keyboard focus for the configuration dialog', async ({
    page
  }) => {
    const addButton = page.getByRole('button', { name: /Agregar configuración/ }).first();
    await addButton.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Nueva Configuración' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    const closeButton = dialog.locator('.modal__close');
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Crear' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('input#name')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(addButton).toBeFocused();
  });

  test('keeps the form open and does not submit missing required fields', async ({ page }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.locator('app-modal button[type="submit"]').click();

    await expect(page.locator('.modal-overlay')).toBeVisible();
    expect(
      await page.locator('input#name').evaluate((input: HTMLInputElement) => input.validity.valid)
    ).toBe(false);
    expect(
      await page.locator('input#model').evaluate((input: HTMLInputElement) => input.validity.valid)
    ).toBe(false);
    await expect(page.locator('.config-card')).toHaveCount(0);
  });

  test('should show provider options and temperature', async ({ page }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();

    const provider = page.locator('select[name="provider"]');
    await expect(provider).toBeVisible();
    await expect(provider.locator('option')).toContainText(['OpenAI', 'Custom (OpenAI-like)']);

    await expect(page.locator('.form-label', { hasText: 'Temperatura' })).toBeVisible();
    await expect(page.locator('input#maxTokens')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Proveedor' })).toBeVisible();
    await expect(page.getByRole('slider', { name: /Temperatura/ })).toBeVisible();
  });

  test('should create a new config', async ({ page }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();

    await page.fill('input#name', 'Mi Proveedor');
    await page.fill('input#model', 'gpt-4o-mini');
    await page.fill('input#baseUrl', 'https://api.openai.com/v1');
    await page.fill('input#apiKey', 'sk-test-key');
    await page.locator('app-modal button[type="submit"]').click();

    // El modal se cierra y la configuracion aparece en el listado
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('.config-card__name')).toContainText('Mi Proveedor');
    await expect(page.locator('.config-detail__label', { hasText: 'Temperatura' })).toBeVisible();
    const actionText = await page.locator('.config-card__actions').allTextContents();
    expect(actionText.join(' ')).not.toMatch(/\p{Extended_Pictographic}/u);
    await expect(page.locator('.config-card__actions app-icon svg')).toHaveCount(4);

    await page.setViewportSize({ width: 320, height: 568 });
    for (const action of await page.locator('.config-card__actions button').all()) {
      await action.scrollIntoViewIfNeeded();
      const bounds = await action.boundingBox();
      expect(bounds, 'cada acción de la tarjeta debe ser visible').not.toBeNull();
      expect(bounds!.width, 'ancho táctil mínimo de 44px').toBeGreaterThanOrEqual(44);
      expect(bounds!.height, 'alto táctil mínimo de 44px').toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps the newest configuration after an older overlapping reload completes last', async ({
    page
  }) => {
    await expect(page.locator('.empty-state__title')).toContainText('Sin configuraciones');

    let signalStaleRead!: () => void;
    let releaseStaleRead!: () => void;
    let signalStaleReadFinished!: () => void;
    const staleReadStarted = new Promise<void>((resolve) => {
      signalStaleRead = resolve;
    });
    const staleReadGate = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    const staleReadFinished = new Promise<void>((resolve) => {
      signalStaleReadFinished = resolve;
    });
    let configReads = 0;

    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      configReads += 1;
      const response = await route.fetch();
      if (configReads === 1) {
        const staleSnapshot = await response.json();
        signalStaleRead();
        await staleReadGate;
        await route.fulfill({ response, json: staleSnapshot });
        signalStaleReadFinished();
        return;
      }
      await route.fulfill({ response });
    });

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Synthetic provider before edit');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    await page.locator('app-modal button[type="submit"]').click();
    await staleReadStarted;

    const card = page.locator('.config-card').filter({
      hasText: 'Synthetic provider before edit'
    });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /Editar/ }).click();
    await page.fill('input#name', 'Synthetic provider after edit');

    const newestReload = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.endsWith('/api/ai/configs')
    );
    await page.locator('app-modal button[type="submit"]').click();
    await newestReload;
    await expect(page.locator('.config-card__name')).toContainText('Synthetic provider after edit');

    releaseStaleRead();
    await staleReadFinished;
    await expect(page.locator('.config-card__name')).toContainText('Synthetic provider after edit');
    expect(configReads).toBe(2);
  });

  test('does not restore a configuration deleted while an older reload is pending', async ({
    page
  }) => {
    await expect(page.locator('.empty-state__title')).toContainText('Sin configuraciones');
    const name = 'Synthetic provider deleted during reload';

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', name);
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    const createReload = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.endsWith('/api/ai/configs')
    );
    await page.locator('app-modal button[type="submit"]').click();
    await createReload;

    const card = page.locator('.config-card').filter({ hasText: name });
    await expect(card).toBeVisible();

    await page.route('**/api/ai/test-connection', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: { success: true, model: 'gpt-test', latency: 12, message: 'Synthetic success' }
        }
      });
    });

    let signalStaleRead!: () => void;
    let releaseStaleRead!: () => void;
    let signalStaleReadFinished!: () => void;
    const staleReadStarted = new Promise<void>((resolve) => {
      signalStaleRead = resolve;
    });
    const staleReadGate = new Promise<void>((resolve) => {
      releaseStaleRead = resolve;
    });
    const staleReadFinished = new Promise<void>((resolve) => {
      signalStaleReadFinished = resolve;
    });

    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const staleSnapshot = await response.json();
      signalStaleRead();
      await staleReadGate;
      await route.fulfill({ response, json: staleSnapshot });
      signalStaleReadFinished();
    });

    await card.getByRole('button', { name: /Probar/ }).click();
    await expect(page.locator('.test-result__title')).toContainText('Conexión exitosa');
    await staleReadStarted;
    await page
      .getByRole('dialog', { name: 'Resultado del Test' })
      .getByRole('button', { name: 'Cerrar' })
      .click();

    await card.getByRole('button', { name: /Eliminar/ }).click();
    const confirmation = page.locator('app-confirm-dialog .modal-overlay');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Eliminar' }).click();
    await expect(card).toHaveCount(0);

    releaseStaleRead();
    await staleReadFinished;
    await expect(page.locator('.config-card')).toHaveCount(0);
  });

  test('keeps the last load error visible after deleting a cached config', async ({ page }) => {
    await expect(page.locator('.empty-state__title')).toContainText('Sin configuraciones');
    const name = 'Synthetic provider with a stale load warning';

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', name);
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    const createReload = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.endsWith('/api/ai/configs')
    );
    await page.locator('app-modal button[type="submit"]').click();
    await createReload;

    const card = page.locator('.config-card').filter({ hasText: name });
    await expect(card).toBeVisible();
    await page.route('**/api/ai/test-connection', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: { success: true, model: 'gpt-test', latency: 12, message: 'Synthetic success' }
        }
      });
    });
    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic load failure' })
      });
    });

    await card.getByRole('button', { name: /Probar/ }).click();
    await expect(page.locator('.test-result__title')).toContainText('Conexión exitosa');
    await expect(page.locator('.ai-config__load-error')).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Resultado del Test' })
      .getByRole('button', { name: 'Cerrar' })
      .click();

    await card.getByRole('button', { name: /Eliminar/ }).click();
    const confirmation = page.locator('app-confirm-dialog .modal-overlay');
    await confirmation.getByRole('button', { name: 'Eliminar' }).click();

    await expect(card).toHaveCount(0);
    await expect(page.locator('.ai-config__load-error')).toBeVisible();
  });

  test('does not reveal or resend the saved API key when editing other fields', async ({
    page
  }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Editable provider');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    await page.locator('app-modal button[type="submit"]').click();

    const card = page.locator('.config-card').filter({ hasText: 'Editable provider' });
    await card.getByRole('button', { name: /Editar/ }).click();
    await expect(page.locator('input#apiKey')).toHaveValue('');

    const update = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' && new URL(request.url()).pathname.includes('/api/ai/configs/')
    );
    await page.fill('input#name', 'Renamed provider');
    await page.locator('app-modal button[type="submit"]').click();
    const request = await update;
    expect(request.postDataJSON()).not.toHaveProperty('apiKey');
    await expect(page.locator('.config-card__name')).toContainText('Renamed provider');
  });

  test('keeps the form open and reports an error when a configuration cannot be saved', async ({
    page
  }) => {
    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic QA failure' })
        });
        return;
      }
      await route.continue();
    });

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'No se guardará');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    await page.locator('app-modal button[type="submit"]').click();

    await expect(page.locator('.modal-overlay')).toBeVisible();
    await expect(
      page.locator('.toast--error').filter({ hasText: 'No se pudo guardar la configuración' })
    ).toHaveCount(1);
    await expect(
      page.locator('.toast--error').filter({ hasText: 'Error del servidor' })
    ).toHaveCount(0);
    await expect(page.locator('.toast--success')).toHaveCount(0);
  });

  test('does not claim success when activating or deleting a saved configuration fails', async ({
    page
  }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Proveedor sintético');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    await page.locator('app-modal button[type="submit"]').click();
    const card = page.locator('.config-card').filter({ hasText: 'Proveedor sintético' });
    await expect(card).toBeVisible();

    await page.route('**/api/ai/configs/**', async (route) => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic QA failure' })
        });
        return;
      }
      await route.continue();
    });

    await card.getByRole('button', { name: /Desactivar/ }).click();
    await expect(card.locator('app-badge').first()).toContainText('Activo');
    await expect(
      page.locator('.toast--error').filter({ hasText: 'No se pudo actualizar la configuración' })
    ).toHaveCount(1);
    await expect(
      page.locator('.toast--error').filter({ hasText: 'Error del servidor' })
    ).toHaveCount(0);
    await expect(page.locator('.toast--success').filter({ hasText: /Actualizado/ })).toHaveCount(0);

    await card.getByRole('button', { name: /Eliminar/ }).click();
    await page.locator('.modal-overlay').getByRole('button', { name: 'Eliminar' }).click();
    await expect(card).toBeVisible();
    await expect(
      page.locator('.toast--error').filter({ hasText: 'No se pudo eliminar la configuración' })
    ).toHaveCount(1);
    await expect(
      page.locator('.toast--error').filter({ hasText: 'Error del servidor' })
    ).toHaveCount(0);
    await expect(page.locator('.toast--success').filter({ hasText: 'Eliminada' })).toHaveCount(0);
  });

  test('canceling the delete confirmation keeps the configuration and sends no delete request', async ({
    page
  }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Proveedor cancelado');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    await page.locator('app-modal button[type="submit"]').click();

    const card = page.locator('.config-card').filter({ hasText: 'Proveedor cancelado' });
    const deleteButton = card.getByRole('button', { name: /Eliminar/ });
    let deleteRequests = 0;
    await page.route('**/api/ai/configs/**', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteRequests += 1;
      }
      await route.continue();
    });

    await deleteButton.click();
    const confirmation = page.locator('app-confirm-dialog .modal-overlay');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'Cancelar' })).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancelar' }).click();

    await expect(confirmation).toHaveCount(0);
    await expect(card).toBeVisible();
    await expect(deleteButton).toBeFocused();
    expect(deleteRequests).toBe(0);
  });

  test('refreshes the saved test badge after success and failure', async ({ page }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Proveedor estado');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    await page.locator('app-modal button[type="submit"]').click();
    const card = page.locator('.config-card').filter({ hasText: 'Proveedor estado' });
    await expect(card).toBeVisible();

    let nextStatus: 'success' | 'failed' = 'success';
    await page.route('**/api/ai/test-connection', async (route) => {
      const success = nextStatus === 'success';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success,
          data: success
            ? { success: true, model: 'gpt-test', latency: 12, message: 'Synthetic success' }
            : { success: false, model: 'gpt-test', latency: 18, error: 'Synthetic failure' }
        })
      });
    });
    await page.route('**/api/ai/configs', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      for (const config of body.data ?? []) config.testStatus = nextStatus;
      await route.fulfill({ response, json: body });
    });

    const testButton = card.getByRole('button', { name: /Probar/ });
    await testButton.click();
    await expect(page.locator('.test-result__title')).toContainText('Conexión exitosa');
    await expect(card.locator('.config-card__status app-badge').last()).toContainText('OK');

    nextStatus = 'failed';
    await page.keyboard.press('Escape');
    await testButton.click();
    await expect(page.locator('.test-result__title')).toContainText('Error de conexión');
    await expect(card.locator('.config-card__status app-badge').last()).toContainText('Error');
  });

  test('probar desde el formulario: el boton se bloquea en «Comprobando…» y el resultado llega al terminar', async ({
    page
  }) => {
    // El proveedor tarda: sin esto, la peticion falla en milisegundos (localhost:9) y no da
    // tiempo a ver el estado «comprobando». El retraso es la mitad de la prueba.
    let respondido = false;
    await page.route('**/api/ai/test-connection', async (route) => {
      await new Promise((resolver) => setTimeout(resolver, 700));
      respondido = true;
      await route.fulfill({
        json: {
          success: true,
          data: { success: true, model: 'gpt-5', latency: 12, message: 'conexión establecida' }
        }
      });
    });

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Mi webapi');
    await page.fill('input#model', 'gpt-5');
    await page.fill('input#baseUrl', 'http://localhost:8000');
    await page.fill('input#apiKey', 'sk-test');

    const boton = page.locator('[data-test="probar-formulario"] button');
    await boton.click();

    // Mientras el proveedor no ha contestado: bloqueado, «Comprobando…», y NINGUN aviso de
    // exito por adelantado (el pecado original: el toast salia sin haber llamado a nadie).
    await expect(boton).toBeDisabled();
    await expect(boton).toContainText('Comprobando');
    await page.waitForTimeout(300);
    expect(respondido).toBe(false);
    await expect(page.locator('.toast--success')).toHaveCount(0);

    // Y cuando llega, el resultado —sea el que sea— es lo unico que se ensena.
    await expect(page.locator('.test-result__title')).toContainText('Conexión exitosa', {
      timeout: 10000
    });
    await expect(page.locator('.test-result__detail').first()).toContainText('gpt-5');
    expect(respondido, 'el mock del proveedor debe haber respondido antes de mostrar éxito').toBe(
      true
    );
    await expect(page.locator('.modal-overlay').last().locator('.modal')).toHaveAttribute(
      'aria-label',
      'Resultado del Test'
    );
    await expect(page.locator('.modal-overlay').last().locator('.modal__title')).toHaveText(
      'Resultado del Test'
    );
    await expect(page.locator('.test-result__icon app-icon svg')).toBeVisible();

    const openDialogs = page.locator('.modal-overlay [role="dialog"]');
    const formDialog = openDialogs.nth(0);
    const resultDialog = openDialogs.nth(1);
    await expect(formDialog).toBeVisible();
    await expect(resultDialog).toBeVisible();
    await expect(formDialog).not.toHaveAttribute('aria-modal', 'true');
    await expect(formDialog).toHaveAttribute('aria-hidden', 'true');
    await expect(formDialog).toHaveAttribute('inert', '');
    await expect(resultDialog).toHaveAttribute('aria-modal', 'true');
    await expect(resultDialog).not.toHaveAttribute('aria-hidden', 'true');
    await expect(resultDialog).not.toHaveAttribute('inert', '');
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(openDialogs).toHaveCount(1);
    await expect(formDialog).toBeVisible();
    await expect(formDialog).toHaveAttribute('aria-modal', 'true');
    await expect(formDialog).not.toHaveAttribute('aria-hidden', 'true');
    await expect(formDialog).not.toHaveAttribute('inert', '');
    await expect(page.locator('input#name')).toHaveValue('Mi webapi');
    await expect(formDialog.locator('.modal__close')).toBeFocused();
  });

  test('probar desde el formulario muestra un resultado de error sin afirmar éxito', async ({
    page
  }) => {
    let testRequests = 0;
    await page.route('**/api/ai/test-connection', async (route) => {
      testRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic provider unavailable' })
      });
    });

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Proveedor sintético');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-synthetic-only');
    const testButton = page.locator('[data-test="probar-formulario"] button');
    await testButton.click();

    await expect(page.locator('.test-result__title')).toContainText('Error de conexión');
    expect(testRequests).toBe(1);
    await expect(page.locator('.toast--success')).toHaveCount(0);
    await expect(page.locator('.toast--error')).toHaveCount(0);

    const resultDialog = page.getByRole('dialog', { name: 'Resultado del Test' });
    await resultDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(resultDialog).toHaveCount(0);
    await expect(page.locator('input#name')).toBeVisible();
  });

  test('a saved connection timeout shows an error result and clears loading', async ({ page }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Timeout guardado');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-timeout-secret');
    await page.locator('app-modal button[type="submit"]').click();

    const card = page.locator('.config-card').filter({ hasText: 'Timeout guardado' });
    await expect(card).toBeVisible();
    let requestCount = 0;
    let requestBody: Record<string, unknown> | undefined;
    await page.route('**/api/ai/test-connection', async (route) => {
      requestCount += 1;
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 504,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic gateway timeout' })
      });
    });

    const testButton = card.getByRole('button', { name: /Probar/ });
    await testButton.click();
    await expect(page.locator('.test-result__title')).toContainText('Error de conexión');
    await expect(testButton).toBeEnabled();
    expect(requestCount).toBe(1);
    expect(requestBody).toEqual({ configId: expect.any(String) });
    expect(JSON.stringify(requestBody)).not.toContain('sk-timeout-secret');
    await expect(page.locator('.toast--success')).toHaveCount(0);
    await expect(page.locator('.toast--error')).toHaveCount(0);

    const resultDialog = page.getByRole('dialog', { name: 'Resultado del Test' });
    await expect(resultDialog).toBeVisible();
    await expect(resultDialog).not.toContainText('sk-timeout-secret');
    await resultDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(resultDialog).toHaveCount(0);
    await expect(card).toBeVisible();
  });

  test('an unsaved connection timeout shows an error result and keeps the form usable', async ({
    page
  }) => {
    let requestCount = 0;
    let requestBody: Record<string, unknown> | undefined;
    await page.route('**/api/ai/test-connection', async (route) => {
      requestCount += 1;
      requestBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 504,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic gateway timeout' })
      });
    });

    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await page.fill('input#name', 'Timeout sin guardar');
    await page.fill('input#model', 'gpt-test');
    await page.fill('input#baseUrl', 'http://localhost:8000/v1');
    await page.fill('input#apiKey', 'sk-timeout-secret');
    const testButton = page.locator('[data-test="probar-formulario"] button');
    await testButton.click();

    await expect(page.locator('.test-result__title')).toContainText('Error de conexión');
    await expect(testButton).toBeEnabled();
    expect(requestCount).toBe(1);
    expect(requestBody).toMatchObject({
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'sk-timeout-secret',
      model: 'gpt-test'
    });
    await expect(page.locator('.toast--success')).toHaveCount(0);
    await expect(page.locator('.toast--error')).toHaveCount(0);

    const resultDialog = page.getByRole('dialog', { name: 'Resultado del Test' });
    await expect(resultDialog).toBeVisible();
    await expect(resultDialog).not.toContainText('sk-timeout-secret');
    await resultDialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(resultDialog).toHaveCount(0);
    await expect(page.locator('input#name')).toHaveValue('Timeout sin guardar');
    await expect(page.locator('input#apiKey')).toHaveValue('sk-timeout-secret');
  });

  test('la configuracion recien creada es LA activa, y activar otra apaga la anterior', async ({
    page
  }) => {
    const crear = async (nombre: string) => {
      await page
        .getByRole('button', { name: /Agregar configuración/ })
        .first()
        .click();
      await page.fill('input#name', nombre);
      await page.fill('input#model', 'gpt-5');
      await page.fill('input#baseUrl', 'http://localhost:8000/v1');
      await page.fill('input#apiKey', 'sk-test');
      await page.locator('app-modal button[type=\"submit\"]').click();
      await expect(page.locator('.modal-overlay')).toHaveCount(0);
    };

    await crear('La vieja');
    await crear('La nueva');

    const tarjetaDe = (nombre: string) => page.locator('.config-card').filter({ hasText: nombre });
    // La recien creada es la activa; la anterior se apaga (antes: ambas activas y la VIEJA
    // era la que contestaba, que era «la IA no se activa»).
    await expect(tarjetaDe('La vieja').locator('app-badge').first()).toContainText('Inactivo');
    await expect(tarjetaDe('La nueva').locator('app-badge').first()).toContainText('Activo');

    // Activar la vieja apaga la nueva: solo hay una.
    await tarjetaDe('La vieja')
      .getByRole('button', { name: /Activar/ })
      .click();
    await expect(tarjetaDe('La vieja').locator('app-badge').first()).toContainText('Activo');
    await expect(tarjetaDe('La nueva').locator('app-badge').first()).toContainText('Inactivo');
  });

  test('should close modal on cancel', async ({ page }) => {
    await page
      .getByRole('button', { name: /Agregar configuración/ })
      .first()
      .click();
    await expect(page.locator('.modal__title')).toContainText('Nueva Configuración');

    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });
});
