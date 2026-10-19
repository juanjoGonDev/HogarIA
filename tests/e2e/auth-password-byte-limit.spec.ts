import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

const PASSWORD_AT_72_UTF8_BYTES = `Aa1${'é'.repeat(34)}a`;
const PASSWORD_AT_73_UTF8_BYTES = `Aa1${'é'.repeat(35)}`;
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORTS = [
  { width: 393, height: 851 },
  { width: 320, height: 568 },
  { width: 568, height: 320 }
];

function viewportsFor(projectName: string): Array<{ width: number; height: number }> {
  return projectName.startsWith('mobile-') ? MOBILE_VIEWPORTS : [DESKTOP_VIEWPORT];
}

async function capturePasswordError(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  name: string,
  language: string,
  viewport: { width: number; height: number }
): Promise<void> {
  const error = page.locator(name);
  const directory = join(
    resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-auth-pw-limit-1'),
    testInfo.project.name
  );
  mkdirSync(directory, { recursive: true });
  const isMobile = testInfo.project.name.startsWith('mobile-');
  await expect(error).toBeVisible();
  await waitForStableView(page);

  const layout = await page.evaluate((selector) => {
    const alert = document.querySelector<HTMLElement>(selector)!;
    const alertRect = alert.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>('.header')?.getBoundingClientRect();
    const bottomNav = document.querySelector<HTMLElement>('.bottom-nav')?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      viewportHeight: window.innerHeight,
      document: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
      alert: { top: alertRect.top, bottom: alertRect.bottom },
      activeElementId: document.activeElement?.id ?? null,
      alertTabIndex: alert.tabIndex,
      alertScrollMarginStart: getComputedStyle(alert).scrollMarginBlockStart,
      alertScrollMarginEnd: getComputedStyle(alert).scrollMarginBlockEnd,
      headerBottom: header?.bottom ?? 0,
      bottomNavTop: bottomNav?.top ?? window.innerHeight
    };
  }, name);
  const screenshotPath = join(
    directory,
    `${name.replace(/[^a-z0-9-]/gi, '-')}-${language}-${viewport.width}x${viewport.height}.png`
  );
  await page.screenshot({ path: screenshotPath, animations: 'disabled' });

  expect(layout.viewport).toBe(viewport.width);
  expect(layout.viewportHeight).toBe(viewport.height);
  expect(layout.document, `no debe haber overflow a ${viewport.width}px`).toBeLessThanOrEqual(
    layout.viewport
  );
  expect(
    layout.alert.top,
    `el error debe estar visible a ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`
  ).toBeGreaterThanOrEqual(isMobile ? layout.headerBottom : 0);
  expect(
    layout.alert.bottom,
    `el error no debe quedar bajo la barra inferior a ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`
  ).toBeLessThanOrEqual(isMobile ? layout.bottomNavTop : layout.viewportHeight);
}

test.describe('límite de bytes UTF-8 para contraseñas nuevas', () => {
  test('registro rechaza 73 bytes y acepta exactamente 72', async ({ page }, testInfo) => {
    expect(new TextEncoder().encode(PASSWORD_AT_72_UTF8_BYTES).length).toBe(72);
    expect(new TextEncoder().encode(PASSWORD_AT_73_UTF8_BYTES).length).toBe(73);
    const pageErrors: string[] = [];
    const registerRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/auth/register')) {
        registerRequests.push(request.url());
      }
    });

    await page.goto('/auth/register');
    expect(PASSWORD_AT_73_UTF8_BYTES.length).toBeLessThan(72);
    const email = `qa-pw-limit-${Date.now()}@example.test`;
    for (const language of ['es', 'en']) {
      await page.evaluate(
        (nextLanguage) => localStorage.setItem('hogar:v1:language', nextLanguage),
        language
      );
      for (const viewport of viewportsFor(testInfo.project.name)) {
        await page.setViewportSize(viewport);
        await page.reload();
        expect(await page.locator('#password').getAttribute('maxlength')).toBe('72');
        await expect(page.locator('#password-helper')).toHaveText(
          language === 'es'
            ? 'Mínimo 6 caracteres, una mayúscula y un número. Si aparece un aviso de longitud, prueba con una contraseña más corta.'
            : 'At least 6 characters, one uppercase letter, and one number. If you see a length warning, try a shorter password.'
        );
        await page.locator('#name').fill('QA límite bcrypt');
        await page.locator('#email').fill(email);
        await page.locator('#password').fill(PASSWORD_AT_73_UTF8_BYTES);
        await page.locator('#password').press('Enter');

        const passwordError = page.locator('#password-error');
        await expect(passwordError).toHaveText(
          language === 'es'
            ? 'La contraseña que has escrito no se puede guardar porque es demasiado larga. Prueba con una más corta.'
            : 'The password you entered is too long to save. Try a shorter one.'
        );
        await expect(passwordError).not.toContainText(/bytes?|UTF-8/i);
        const registerPasswordDescription = await page
          .locator('#password')
          .getAttribute('aria-describedby');
        expect(registerPasswordDescription?.split(/\s+/)).toContain('password-error');
        expect(registerRequests).toHaveLength(0);
        await capturePasswordError(page, testInfo, '#password-error', language, viewport);
      }
    }

    await page.locator('#password').fill(PASSWORD_AT_72_UTF8_BYTES);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/auth/register')
    );
    await page.getByRole('button', { name: /Crear Cuenta|Create account/i }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    await expect(page).toHaveURL(/\/household$/);
    expect(pageErrors).toEqual([]);
  });

  test('Cuenta rechaza más de 72 bytes antes de llamar al servidor', async ({ page }, testInfo) => {
    await registerAndGoto(page, '/account?tab=security', 'qa-auth-pw-limit-change');
    const pageErrors: string[] = [];
    const changeRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/auth/change-password')) {
        changeRequests.push(request.url());
      }
    });

    const error = page.locator('[data-test="account-password-error"]');
    expect(PASSWORD_AT_73_UTF8_BYTES.length).toBeLessThan(72);
    expect(
      await page.locator('[data-test="account-password-current"]').getAttribute('maxlength')
    ).toBeNull();
    expect(await page.locator('[data-test="account-password-new"]').getAttribute('maxlength')).toBe(
      '72'
    );
    for (const language of ['es', 'en']) {
      await page.evaluate(
        (nextLanguage) => localStorage.setItem('hogar:v1:language', nextLanguage),
        language
      );
      for (const viewport of viewportsFor(testInfo.project.name)) {
        await page.setViewportSize(viewport);
        await page.reload();
        await expect(page.locator('#account-password-new-hint')).toHaveText(
          language === 'es'
            ? 'Si aparece un aviso de longitud, prueba con una contraseña más corta.'
            : 'If you see a length warning, try a shorter password.'
        );
        await page.locator('[data-test="account-password-current"]').fill('Test1234');
        await page.locator('[data-test="account-password-new"]').fill(PASSWORD_AT_73_UTF8_BYTES);
        await page.locator('[data-test="account-password-repeat"]').fill(PASSWORD_AT_73_UTF8_BYTES);
        const saveButton = page.locator('[data-test="account-password-save"] button');
        await saveButton.focus();
        await page.keyboard.press('Enter');

        await expect(error).toHaveText(
          language === 'es'
            ? 'La contraseña que has escrito no se puede guardar porque es demasiado larga. Prueba con una más corta.'
            : 'The password you entered is too long to save. Try a shorter one.',
          { useInnerText: true }
        );
        await expect(error).not.toContainText(/bytes?|UTF-8/i);
        await expect(error).toHaveAttribute('role', 'alert');
        await expect(error).toBeFocused();
        const accountPasswordDescription = await page
          .locator('[data-test="account-password-new"]')
          .getAttribute('aria-describedby');
        expect(accountPasswordDescription?.split(/\s+/)).toContain('account-password-error');
        expect(changeRequests).toHaveLength(0);
        await capturePasswordError(
          page,
          testInfo,
          '[data-test="account-password-error"]',
          language,
          viewport
        );
      }
    }
    expect(pageErrors).toEqual([]);
  });

  test('Cuenta guarda 72 bytes UTF-8 y la nueva credencial autentica', async ({ page }) => {
    const email = await registerAndGoto(page, '/account?tab=security', 'qa-auth-pw-limit-exact');
    await page.locator('[data-test="account-password-current"]').fill('Test1234');
    await page.locator('[data-test="account-password-new"]').fill(PASSWORD_AT_72_UTF8_BYTES);
    await page.locator('[data-test="account-password-repeat"]').fill(PASSWORD_AT_72_UTF8_BYTES);

    const changePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/auth/change-password')
    );
    await page.locator('[data-test="account-password-save"]').click();
    expect((await changePromise).status()).toBe(200);
    await expect(page.locator('.toast--success')).toContainText(
      /contrasena cambiada|password changed/i
    );

    const oldLogin = await page.request.post('/api/auth/login', {
      data: { email, password: 'Clave1234' }
    });
    expect(oldLogin.status()).toBe(401);
    const newLogin = await page.request.post('/api/auth/login', {
      data: { email, password: PASSWORD_AT_72_UTF8_BYTES }
    });
    expect(newLogin.status()).toBe(200);
  });
});
