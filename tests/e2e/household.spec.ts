import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from './fixtures';
import { registerWithHousehold, skipOnboarding } from './helpers/auth';

test.describe('Household sharing & invite flow', () => {
  test('invite code appears immediately after creating household and is a full URL', async ({
    page
  }) => {
    const email = `hh-${Date.now()}@example.com`;
    await page.goto('/auth/register');
    await page.fill('input#name', 'Homeowner');
    await page.fill('input#email', email);
    await page.fill('input#password', 'Test1234');
    await page.fill('input#confirm-password', 'Test1234');
    await page.click('button[type="submit"]');
    await skipOnboarding(page);

    // Create household
    await page.goto('/household');
    await page.getByRole('button', { name: /Crear hogar/i }).click();
    await page.fill('input#householdName', 'Mi Casa');
    await page.click('button[type="submit"]');

    // Invite code should be a full URL (http.../invite/CODE)
    await expect(page.locator('.invite-card__code')).toContainText('/invite/');
    // Copy link button present
    await expect(page.getByRole('button', { name: /Copiar enlace/ })).toBeVisible();
    await page.getByRole('tab', { name: 'Ajustes' }).click();
    // Share toggles present (admin sees them)
    const shareSection = page
      .locator('.settings-section')
      .filter({ hasText: 'Compartir en el hogar' });
    await expect(shareSection).toContainText('Inventario compartido'); // ## 12aa: la pantalla es del inventario de la casa, no solo de la cocina
    await expect(shareSection).toContainText('Recetas compartidas');
    await expect(shareSection).toContainText('Calendario compartido');
    await page.getByRole('tab', { name: 'Miembros' }).click();
    // Admin badge on member list
    await expect(page.locator('.member-card').first()).toContainText('Admin');
  });

  test('el botón de guardar conserva geometría, nombre y foco durante estados de carga', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'mobile-chrome'
        ? { width: 393, height: 851 }
        : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await registerWithHousehold(page, '/household', 'button-state-geometry');
    await page.getByRole('tab', { name: 'Ajustes' }).click();

    const name = page.locator('[data-test="household-name-input"]');
    const save = page.locator('[data-test="household-name-save"] button');
    await name.fill('Hogar de geometría sintética');
    await expect(save).toBeEnabled();
    await expect(save).toHaveAccessibleName('Guardar nombre');
    await name.focus();
    await page.keyboard.press('Tab');
    await expect(save).toBeFocused();
    const focus = await save.evaluate((button) => ({
      visible: button.matches(':focus-visible'),
      outlineStyle: getComputedStyle(button).outlineStyle,
      outlineWidth: getComputedStyle(button).outlineWidth
    }));
    expect(focus.visible).toBe(true);
    expect(focus.outlineStyle).toBe('solid');
    expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);

    const readGeometry = () =>
      save.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
          gap: style.gap,
          font: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight],
          border: [style.borderWidth, style.borderRadius],
          transform: style.transform
        };
      });
    const expectSameGeometry = (
      expected: Awaited<ReturnType<typeof readGeometry>>,
      actual: Awaited<ReturnType<typeof readGeometry>>,
      state: string
    ) => {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(
          Math.abs(actual[key] - expected[key]),
          `${state}: ${key} no debe cambiar más de 1 CSS px`
        ).toBeLessThanOrEqual(1);
      }
      expect(actual.padding, `${state}: padding`).toEqual(expected.padding);
      expect(actual.margin, `${state}: márgenes`).toEqual(expected.margin);
      expect(actual.gap, `${state}: gap`).toBe(expected.gap);
      expect(actual.font, `${state}: tipografía`).toEqual(expected.font);
      expect(actual.border, `${state}: borde`).toEqual(expected.border);
      expect(actual.transform, `${state}: transform`).toBe(expected.transform);
    };
    const normal = await readGeometry();

    let releaseFirstResponse!: () => void;
    let markFirstRequestStarted!: () => void;
    const firstResponseBarrier = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    const firstRequestStarted = new Promise<void>((resolve) => {
      markFirstRequestStarted = resolve;
    });
    let patchAttempts = 0;
    await page.route('**/api/household', async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      patchAttempts += 1;
      if (patchAttempts === 1) {
        markFirstRequestStarted();
        await firstResponseBarrier;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'synthetic failure' })
        });
        return;
      }
      await route.continue();
    });

    const screenshotDirectory = process.env.HOGARIA_E2E_SCREENSHOT_DIR;
    const saveScreenshot = async (state: 'normal' | 'loading') => {
      if (!screenshotDirectory) return;
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `${testInfo.project.name}-${state}.png`),
        animations: 'disabled'
      });
    };
    await save.evaluate((button) => button.blur());
    await saveScreenshot('normal');
    await save.focus();

    const firstRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' && new URL(request.url()).pathname.endsWith('/api/household')
    );
    await page.keyboard.press('Enter');
    await Promise.all([firstRequestPromise, firstRequestStarted]);
    await expect(save).toBeDisabled();
    await expect(save.locator('.btn__spinner')).toBeVisible();
    const loading = await readGeometry();
    expectSameGeometry(normal, loading, 'loading');
    const spinnerOffset = await save.evaluate((button) => {
      const buttonRect = button.getBoundingClientRect();
      const spinnerRect = button.querySelector('.btn__spinner')!.getBoundingClientRect();
      return {
        x: Math.abs(buttonRect.x + buttonRect.width / 2 - (spinnerRect.x + spinnerRect.width / 2)),
        y: Math.abs(buttonRect.y + buttonRect.height / 2 - (spinnerRect.y + spinnerRect.height / 2))
      };
    });
    expect(spinnerOffset.x).toBeLessThanOrEqual(1);
    expect(spinnerOffset.y).toBeLessThanOrEqual(1);
    await expect(save).toHaveAttribute('aria-busy', 'true');
    await expect(save).toHaveAccessibleName('Guardar nombre');
    await saveScreenshot('loading');

    const disabledClickCount = await save.evaluate((button) => {
      let clicks = 0;
      button.addEventListener('click', () => clicks++);
      (button as HTMLButtonElement).click();
      return clicks;
    });
    expect(disabledClickCount).toBe(0);
    expect(patchAttempts).toBe(1);

    const failedResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith('/api/household')
    );
    releaseFirstResponse();
    const failedResponse = await failedResponsePromise;
    expect(failedResponse.status()).toBe(503);
    await expect(name).toHaveValue('Hogar de geometría sintética');
    await expect(save).toBeEnabled();
    await expect(save).not.toHaveAttribute('aria-busy', 'true');
    expectSameGeometry(normal, await readGeometry(), 'tras error');

    await name.focus();
    await page.keyboard.press('Tab');
    await expect(save).toBeFocused();
    const successfulResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith('/api/household')
    );
    await page.keyboard.press('Enter');
    const successfulResponse = await successfulResponsePromise;
    expect(successfulResponse.status()).toBe(200);
    expect(patchAttempts).toBe(2);
    await expect(name).toHaveValue('Hogar de geometría sintética');
    await expect(save).toBeDisabled();
    await expect(save).not.toHaveAttribute('aria-busy', 'true');
    expectSameGeometry(normal, await readGeometry(), 'tras éxito');

    await page.reload();
    await page.getByRole('tab', { name: 'Ajustes' }).click();
    await expect(name).toHaveValue('Hogar de geometría sintética');
  });

  test('public invite page shows household name and join/login CTAs for logged-out users', async ({
    browser
  }) => {
    // First register + create household in one context
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    const email = `owner-${Date.now()}@example.com`;
    await ownerPage.goto('/auth/register');
    await ownerPage.fill('input#name', 'Owner');
    await ownerPage.fill('input#email', email);
    await ownerPage.fill('input#password', 'Test1234');
    await ownerPage.fill('input#confirm-password', 'Test1234');
    await ownerPage.click('button[type="submit"]');
    await skipOnboarding(ownerPage);
    await ownerPage.goto('/household');
    await ownerPage.getByRole('button', { name: /Crear hogar/i }).click();
    await ownerPage.fill('input#householdName', 'Familia López');
    await ownerPage.click('button[type="submit"]');
    const inviteUrl = await ownerPage.locator('.invite-card__code').textContent();
    expect(inviteUrl).toContain('/invite/');
    const code = inviteUrl!.split('/invite/')[1];
    await ownerCtx.close();

    // Fresh context: open invite page without login
    const guestCtx = await browser.newContext();
    const guestPage = await guestCtx.newPage();
    await guestPage.goto(`/invite/${code}`);
    await expect(guestPage.locator('.invite-card__title')).toContainText('Familia López');
    await expect(guestPage.getByRole('link', { name: /Iniciar sesión/ })).toBeVisible();
    await expect(guestPage.getByRole('link', { name: /Crear cuenta/ })).toBeVisible();
    await guestCtx.close();
  });
});
