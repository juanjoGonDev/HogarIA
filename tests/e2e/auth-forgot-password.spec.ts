import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerUser } from './helpers/auth';

const RECOVERY_ENDPOINT = '/api/auth/forgot-password';

test('forgot password validates input and returns indistinguishable results for known/unknown email', async ({
  page
}, testInfo) => {
  const existingEmail = await registerUser(page, 'Recovery Existing');
  await page.goto('/auth/forgot-password');
  const viewport = testInfo.project.name.startsWith('mobile-')
    ? { width: 393, height: 851 }
    : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);

  let requestCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === RECOVERY_ENDPOINT) {
      requestCount += 1;
    }
  });

  const email = page.getByLabel('Email');
  const submit = page.getByRole('button', { name: /Solicitar recuperación/i });
  await email.focus();
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  const submitBounds = await submit.boundingBox();
  expect(submitBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width
  );
  await submit.click();
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAttribute('aria-describedby', 'email-error');
  await expect(page.locator('#email-error')).toContainText('El email es requerido');
  expect(requestCount).toBe(0);

  await email.fill('not-an-email');
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  await submit.click();
  await expect(page.locator('#email-error')).toContainText('Introduce un email válido');
  expect(requestCount).toBe(0);

  const observed: Array<{ status: number; body: unknown }> = [];
  for (const address of [existingEmail, `missing-${process.env.E2E_SEED}@hogaria.test`]) {
    await email.fill(address);
    const responsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === RECOVERY_ENDPOINT
    );
    await submit.click();
    const response = await responsePromise;
    observed.push({ status: response.status(), body: await response.json() });
    await expect(page.locator('.toast--info').last()).toContainText(
      'La recuperación por correo todavía no está disponible'
    );
    await expect(page.locator('.toast--info').last()).toContainText(
      'por ahora no se envían enlaces'
    );
    await expect(page.locator('.toast--success')).toHaveCount(0);
    await expect(page.locator('.toast--error')).toHaveCount(0);
  }

  expect(observed[0]).toEqual(observed[1]);
  expect(observed[0].status).toBe(200);
  expect(JSON.stringify(observed[0].body)).not.toMatch(/sent|link/i);
});

test('a provider/server failure is an error, keeps the email, and can be retried', async ({
  page
}, testInfo) => {
  await page.goto('/auth/forgot-password');
  const email = page.getByLabel('Email');
  const submit = page.getByRole('button', { name: /Solicitar recuperación/i });
  await email.fill(`retry-${process.env.E2E_SEED}@hogaria.test`);

  let firstAttempt = true;
  await page.route(`**${RECOVERY_ENDPOINT}`, async (route) => {
    if (firstAttempt) {
      firstAttempt = false;
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'temporarily unavailable' })
      });
      return;
    }
    await route.continue();
  });

  const failure = page.waitForResponse(
    (response) => new URL(response.url()).pathname === RECOVERY_ENDPOINT
  );
  await submit.click();
  await expect(submit).toBeDisabled();
  expect((await failure).status()).toBe(503);
  await expect(page.locator('.toast--error')).toContainText('No se pudo enviar la solicitud');
  await expect(page.locator('.toast--error')).toHaveCount(1);
  await expect(page.locator('.toast')).toHaveCount(1);
  await expect(page.locator('.toast--success')).toHaveCount(0);
  await expect(page.locator('.toast--info')).toHaveCount(0);
  await expect(email).toHaveValue(`retry-${process.env.E2E_SEED}@hogaria.test`);

  const viewport = testInfo.project.name.startsWith('mobile-')
    ? { width: 393, height: 851 }
    : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  const errorToast = page.locator('.toast--error');
  const toastBounds = await errorToast.boundingBox();
  expect(toastBounds).not.toBeNull();
  if (toastBounds) {
    const expectedTop = testInfo.project.name.startsWith('mobile-') ? 8 : 16;
    expect(Math.abs(toastBounds.y - expectedTop)).toBeLessThanOrEqual(1);
  }
  const captureDir = join(
    process.cwd(),
    '.e2e-screenshots',
    `qa-auth-forgot-password-${process.env.E2E_SEED}`
  );
  mkdirSync(captureDir, { recursive: true });
  await page.screenshot({
    path: join(
      captureDir,
      `error-${testInfo.project.name}-${viewport.width}x${viewport.height}.png`
    ),
    animations: 'disabled'
  });

  await page.locator('.toast--error .toast__close').click();
  const success = page.waitForResponse(
    (response) => new URL(response.url()).pathname === RECOVERY_ENDPOINT
  );
  await submit.click();
  expect((await success).status()).toBe(200);
  await expect(page.locator('.toast--info').last()).toContainText(
    'La recuperación por correo todavía no está disponible'
  );
  await expect(page.locator('.toast--info').last()).toContainText('por ahora no se envían enlaces');
  await expect(page.locator('.toast--success')).toHaveCount(0);
  await expect(page.locator('.toast--error')).toHaveCount(0);
  expect(await email.inputValue()).toBe(`retry-${process.env.E2E_SEED}@hogaria.test`);
});
