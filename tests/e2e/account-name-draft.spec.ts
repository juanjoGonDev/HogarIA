import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const NAME_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 393, height: 851 },
  { width: 320, height: 568 },
  { width: 568, height: 320 }
];

test.describe('Borrador del nombre en Cuenta', () => {
  for (const viewport of NAME_VIEWPORTS) {
    test(`conserva una edición concurrente y permite guardarla o cancelarla (${viewport.width}×${viewport.height})`, async ({
      page
    }, testInfo) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await page.setViewportSize(viewport);
      await registerAndGoto(page, '/account', `acct-name-race-${viewport.width}`);

      let signalPatchResponse!: () => void;
      let releasePatchResponse!: () => void;
      const patchResponseReady = new Promise<void>((resolve) => {
        signalPatchResponse = resolve;
      });
      const responseGate = new Promise<void>((resolve) => {
        releasePatchResponse = resolve;
      });

      const profileRoute = '**/api/auth/profile';
      await page.route(profileRoute, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();

        const response = await route.fetch();
        signalPatchResponse();
        await responseGate;
        await route.fulfill({ response });
      });

      const nameInput = page.locator('[data-test="account-name"]');
      const saveButton = page.locator('[data-test="account-name-save"] button');
      const cancelButton = page.locator('[data-test="account-name-cancel"]');
      const submittedName = page.locator('.sidebar__account-name');

      try {
        await nameInput.fill('Ana Belen');
        await saveButton.focus();
        await expect(saveButton).toBeFocused();
        await page.keyboard.press('Enter');
        await patchResponseReady;

        // El servidor ya confirmó el snapshot inicial, pero el navegador aún no ha recibido
        // esa respuesta: durante ese intervalo la persona puede seguir editando el formulario.
        await expect(saveButton).toBeDisabled();
        await nameInput.fill('Bea');
        releasePatchResponse();

        await expect(
          page.locator('.toast--success').filter({ hasText: 'Nombre guardado' })
        ).toBeVisible();
        await expect(submittedName).toHaveText('Ana Belen');
        await expect(nameInput).toHaveValue('Bea');
        await expect(saveButton).toBeEnabled();
        await expect(cancelButton).toBeVisible();

        const screenshotDirectory = join(
          resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-account-name-draft'),
          testInfo.project.name
        );
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(screenshotDirectory, `name-draft-${viewport.width}x${viewport.height}.png`),
          animations: 'disabled'
        });

        await saveButton.focus();
        await page.keyboard.press('Enter');
        await expect(submittedName).toHaveText('Bea');
        await expect(nameInput).toHaveValue('Bea');
        await expect(saveButton).toBeDisabled();
        await expect(cancelButton).toHaveCount(0);

        await nameInput.fill('No guardar');
        await expect(cancelButton).toBeVisible();
        await cancelButton.click();
        await expect(nameInput).toHaveValue('Bea');
        await expect(saveButton).toBeDisabled();
        await expect(cancelButton).toHaveCount(0);

        const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(documentWidth).toBeLessThanOrEqual(viewport.width);
        expect(pageErrors).toEqual([]);
      } finally {
        releasePatchResponse();
        await page.unroute(profileRoute);
      }
    });
  }

  test('envía el nombre recortado y sincroniza el valor confirmado', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    await registerAndGoto(page, '/account', 'acct-name-normalize');

    const nameInput = page.locator('[data-test="account-name"]');
    const saveButton = page.locator('[data-test="account-name-save"] button');
    const cancelButton = page.locator('[data-test="account-name-cancel"]');
    await nameInput.fill(' Ana Belen ');

    const patchRequest = page.waitForRequest(
      (request) => request.url().includes('/api/auth/profile') && request.method() === 'PATCH'
    );
    const patchResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/profile') && response.request().method() === 'PATCH'
    );
    await saveButton.click();

    const request = await patchRequest;
    expect(request.postDataJSON().name).toBe('Ana Belen');
    expect((await patchResponse).status()).toBe(200);
    await expect(
      page.locator('.toast--success').filter({ hasText: 'Nombre guardado' })
    ).toBeVisible();
    await expect(page.locator('.sidebar__account-name')).toHaveText('Ana Belen');
    await expect(nameInput).toHaveValue('Ana Belen');
    await expect(saveButton).toBeDisabled();
    await expect(cancelButton).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test('conserva el borrador en error y permite reintentar', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    await registerAndGoto(page, '/account', 'acct-name-race');
    const profileRoute = '**/api/auth/profile';
    let patchCount = 0;
    await page.route(profileRoute, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patchCount += 1;
      if (patchCount === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic profile failure' })
        });
        return;
      }
      await route.continue();
    });

    const nameInput = page.locator('[data-test="account-name"]');
    const saveButton = page.locator('[data-test="account-name-save"] button');
    const cancelButton = page.locator('[data-test="account-name-cancel"]');
    const nameError = page.locator('[data-test="account-name-error"]');
    const failedPatch = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/profile') && response.request().method() === 'PATCH'
    );

    try {
      await nameInput.fill('Ana Belen');
      await saveButton.focus();
      await page.keyboard.press('Enter');
      expect((await failedPatch).status()).toBe(500);
      await expect(nameError).toContainText('No se pudo guardar el nombre');
      await expect(nameInput).toHaveAttribute('aria-describedby', 'account-name-error');
      await expect(
        page.getByRole('alert').filter({ hasText: 'No se pudo guardar el nombre' })
      ).toHaveCount(1);
      await expect(nameInput).toHaveValue('Ana Belen');
      await expect(saveButton).toBeEnabled();
      await expect(cancelButton).toBeVisible();

      await nameInput.fill('Bea');
      const retry = page.waitForResponse(
        (response) =>
          response.url().includes('/api/auth/profile') && response.request().method() === 'PATCH'
      );
      await saveButton.focus();
      await page.keyboard.press('Enter');
      expect((await retry).status()).toBe(200);
      await expect(page.locator('.sidebar__account-name')).toHaveText('Bea');
      await expect(nameInput).toHaveValue('Bea');
      await expect(nameInput).not.toHaveAttribute('aria-describedby');
      await expect(nameError).toHaveCount(0);
      await expect(cancelButton).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.unroute(profileRoute);
    }
  });
});
