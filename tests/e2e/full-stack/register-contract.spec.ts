import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '../fixtures';

const REGISTER_ENDPOINT = '/api/auth/register';

// The SPA registers NGSW; service-worker-controlled requests bypass Playwright's page.route stubs.
test.use({ serviceWorkers: 'block' });

function uniqueEmail(): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `qa-register-${suffix}@example.test`;
}

async function submitRegistration(page: Page) {
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname === REGISTER_ENDPOINT && candidate.request().method() === 'POST';
  });

  await page.getByRole('button', { name: /Crear Cuenta|Create account/i }).click();
  return response;
}

async function fillValidRegistration(page: Page, name: string, email: string, password = 'Abc123') {
  await page.locator('#name').fill(name);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
}

function fieldError(page: Page, id: string) {
  return page.locator(`app-input:has(#${id}) .input__error`);
}

test.describe('contrato del formulario de registro', () => {
  test('mantiene el diseño sin overflow en escritorio, móvil estrecho y horizontal', async ({
    page
  }, testInfo) => {
    const isMobile = testInfo.project.name === 'mobile-chrome';
    await page.setViewportSize(
      isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    );
    await page.goto('/auth/register');
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `registration-${isMobile ? 'mobile' : 'desktop'}.png`),
        fullPage: true
      });
    }

    const viewports = isMobile
      ? [
          { width: 390, height: 844 },
          { width: 320, height: 740 },
          { width: 844, height: 390 }
        ]
      : [
          { width: 1023, height: 768 },
          { width: 1024, height: 768 },
          { width: 1440, height: 900 }
        ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(
        hasHorizontalOverflow,
        `registro no debe desbordarse a ${viewport.width}x${viewport.height}`
      ).toBe(false);
    }
  });

  test('anuncia cada campo requerido y no solicita el registro hasta completar el formulario', async ({
    page
  }) => {
    await page.goto('/auth/register');
    let registerRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === REGISTER_ENDPOINT && request.method() === 'POST') {
        registerRequests += 1;
      }
    });
    const submit = page.getByRole('button', { name: /Crear Cuenta|Create account/i });

    await submit.click();
    await expect(fieldError(page, 'name')).toContainText('requerido');
    await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#name')).toHaveAttribute('aria-describedby', 'name-error');
    await expect(page.locator('#name-error')).toHaveAttribute('role', 'alert');

    await page.locator('#name').fill('Ana');
    await submit.click();
    await expect(fieldError(page, 'email')).toContainText('requerido');
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#email')).toHaveAttribute('aria-describedby', 'email-error');
    await expect(page.locator('#email-error')).toHaveAttribute('role', 'alert');

    await page.locator('#email').fill('ana@example.test');
    await submit.click();
    await expect(fieldError(page, 'password')).toContainText('requerida');
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#password')).toHaveAttribute('aria-describedby', 'password-error');
    await expect(page.locator('#password-error')).toHaveAttribute('role', 'alert');
    expect(registerRequests).toBe(0);
  });

  test('recupera un 500 de registro con mensaje genérico y permite reintentar', async ({
    page
  }) => {
    await page.goto('/auth/register');
    const email = uniqueEmail();
    await fillValidRegistration(page, 'Ana', email);

    let failFirstRequest!: () => void;
    let sawFirstRequest!: () => void;
    const firstRequestSeen = new Promise<void>((resolve) => {
      sawFirstRequest = resolve;
    });
    const firstResponseGate = new Promise<void>((resolve) => {
      failFirstRequest = resolve;
    });
    let requestCount = 0;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route(
      (url) => url.pathname === REGISTER_ENDPOINT,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        requestCount += 1;
        if (requestCount === 1) {
          sawFirstRequest();
          await firstResponseGate;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, message: 'Synthetic private server detail' })
          });
          return;
        }
        await route.continue();
      }
    );

    const submit = page.getByRole('button', { name: /Crear Cuenta|Create account/i });
    const failedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === REGISTER_ENDPOINT &&
        response.request().method() === 'POST'
    );
    const firstSubmission = submit.click();
    try {
      await firstRequestSeen;
      await expect(submit).toBeDisabled();
      await expect(page.locator('#name')).toHaveValue('Ana');
      await expect(page.locator('#email')).toHaveValue(email);
      await expect(page.locator('#password')).toHaveValue(/\S+/);

      failFirstRequest();
      expect((await failedResponse).status()).toBe(500);
      await firstSubmission;
      const errorToast = page.locator('.toast--error[role="alert"]');
      await expect(errorToast).toHaveCount(1);
      await expect(errorToast).toContainText('Error al crear la cuenta');
      await expect(errorToast).not.toContainText('Synthetic private server detail');
      await expect(submit).toBeEnabled();

      const retryResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === REGISTER_ENDPOINT &&
          response.request().method() === 'POST'
      );
      await submit.click();
      expect((await retryResponse).status()).toBe(201);
      await expect(page).toHaveURL(/\/household$/);
      expect(requestCount).toBe(2);
      expect(pageErrors).toEqual([]);
    } finally {
      failFirstRequest();
    }
  });

  test('rechaza entradas inválidas en cliente, en español e inglés, sin escribir en el servidor', async ({
    page
  }) => {
    await page.goto('/auth/register');
    let registerRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === REGISTER_ENDPOINT && request.method() === 'POST') {
        registerRequests += 1;
      }
    });

    await page.getByRole('button', { name: /Crear Cuenta/i }).click();
    await expect(fieldError(page, 'name')).toContainText('requerido');

    await page.locator('#name').fill('A');
    await page.locator('#email').fill('ana@example.test');
    await page.locator('#password').fill('Abc123');
    await page.getByRole('button', { name: /Crear Cuenta/i }).click();
    await expect(fieldError(page, 'name')).toContainText('al menos 2');

    await page.locator('#name').fill('Ana');
    await page.locator('#email').fill('no-es-un-email');
    await page.getByRole('button', { name: /Crear Cuenta/i }).click();
    await expect(fieldError(page, 'email')).toContainText('email válido');
    await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#email')).toHaveAttribute('aria-describedby', 'email-error');
    await expect(page.locator('#email-error')).toHaveAttribute('role', 'alert');

    await page.locator('#email').fill('ana@example.test');
    await page.locator('#password').fill('abcdef1');
    await page.getByRole('button', { name: /Crear Cuenta/i }).click();
    await expect(fieldError(page, 'password')).toContainText('mayúscula');

    await page.locator('#password').fill('Abcdef');
    await page.getByRole('button', { name: /Crear Cuenta/i }).click();
    await expect(fieldError(page, 'password')).toContainText('número');
    expect(registerRequests).toBe(0);

    await page.addInitScript(() => localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();
    await page.locator('#name').fill('Ana');
    await page.locator('#email').fill('not-an-email');
    await page.locator('#password').fill('Abc123');
    await page.getByRole('button', { name: /Create account/i }).click();
    await expect(fieldError(page, 'email')).toContainText('valid email');
    expect(registerRequests).toBe(0);
  });

  test('acepta los límites válidos de nombre y contraseña', async ({ page }) => {
    await page.goto('/auth/register');
    const name = page.locator('#name');
    await expect(name).toHaveAttribute('maxlength', '100');
    await name.pressSequentially('N'.repeat(101));
    await expect(name).toHaveValue('N'.repeat(100));

    for (const validName of ['Ab', 'N'.repeat(100)]) {
      if (validName.length === 100) {
        await page.evaluate(() => localStorage.clear());
        await page.goto('/auth/register');
      }
      await fillValidRegistration(page, validName, uniqueEmail(), 'Abc123');
      const response = await submitRegistration(page);
      expect(response.status()).toBe(201);
      await expect(page).toHaveURL(/\/household$/);
    }
  });

  test('muestra conflicto duplicado, permite corregirlo y evita doble envío', async ({ page }) => {
    const duplicateEmail = uniqueEmail();
    await page.goto('/auth/register');
    await fillValidRegistration(page, 'Ana', duplicateEmail);
    expect((await submitRegistration(page)).status()).toBe(201);
    await expect(page).toHaveURL(/\/household$/);

    await page.evaluate(() => localStorage.clear());
    await page.goto('/auth/register');
    await fillValidRegistration(page, 'Ana', duplicateEmail);
    expect((await submitRegistration(page)).status()).toBe(409);
    await expect(page.locator('.toast--error').first()).toContainText('ya está registrado');
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Crear Cuenta/i })).toBeEnabled();

    const button = page.getByRole('button', { name: /Crear Cuenta/i });
    const retriedEmail = uniqueEmail();
    await fillValidRegistration(page, 'Ana', retriedEmail);
    let registerRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === REGISTER_ENDPOINT && request.method() === 'POST') {
        registerRequests += 1;
      }
    });
    await page.route(`**${REGISTER_ENDPOINT}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });

    const responsePromise = submitRegistration(page);
    await expect(button).toBeDisabled();
    // Prueba el segundo envío desde el teclado mientras la petición real sigue pendiente.
    await page.locator('#password').press('Enter');
    expect((await responsePromise).status()).toBe(201);
    await expect(page).toHaveURL(/\/household$/);
    expect(registerRequests).toBe(1);
  });
});
