import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { createHousehold, logout, registerToOnboarding, registerUser } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

function collectFirstPartyBrowserErrors(page: import('@playwright/test').Page): string[] {
  const browserErrors: string[] = [];
  const appOrigin = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:4200').origin;
  page.on('pageerror', (error) =>
    browserErrors.push(
      `pageerror: ${JSON.stringify({ name: error.name, message: error.message, stack: error.stack })} (at ${page.url()})`
    )
  );
  page.on('console', (message) => {
    if (message.type() === 'error' && message.location().url.startsWith(appOrigin)) {
      const location = message.location();
      // Invalid invitation is deliberately represented by a 404 API response;
      // the page handles it and renders the localized invalid-invite state.
      if (
        message.text().includes('404 (Not Found)') &&
        location.url.endsWith('/api/household/invite/codigo-invalido-qa')
      ) {
        return;
      }
      browserErrors.push(
        `console: ${message.text()} (${location.url}:${location.lineNumber}:${location.columnNumber})`
      );
    }
  });
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin === appOrigin) {
      browserErrors.push(
        `requestfailed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`
      );
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (
      response.status() >= 400 &&
      ['font', 'image', 'script', 'stylesheet'].includes(request.resourceType()) &&
      new URL(response.url()).origin === appOrigin
    ) {
      browserErrors.push(`asset ${response.status()}: ${response.url()}`);
    }
  });
  return browserErrors;
}

async function waitForRouterViewTransition(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const currentDocument = document as Document & { activeViewTransition?: unknown };
    return !currentDocument.activeViewTransition;
  });
}

test('los logos de autenticación usan la casa SVG en ES y EN', async ({ page }, testInfo) => {
  const browserErrors = collectFirstPartyBrowserErrors(page);
  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  const routes = ['/auth/login', '/auth/register', '/auth/forgot-password'];

  for (const language of ['es', 'en']) {
    await page.goto('/auth/login');
    await page.evaluate((value) => localStorage.setItem('hogar:v1:language', value), language);
    await page.reload();
    await expect(page.locator('.auth-layout__logo')).toBeVisible();
    await waitForStableView(page);

    for (const route of routes) {
      if (route !== '/auth/login') await page.goto(route);
      await expect(page.locator('.auth-layout__logo')).toBeVisible();
      await expect(page.locator('.auth-layout__title')).toHaveText('HogarIA');
      await waitForStableView(page);
      const homeIcon = page.locator('.auth-layout__logo app-icon[name="home"]');
      const homeIconCount = await homeIcon.count();
      expect.soft(homeIconCount, `${route} ${language}: falta el icono SVG de casa`).toBe(1);
      if (homeIconCount) {
        await expect.soft(homeIcon.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      }
      if (language === 'es' && route === '/auth/login' && screenshotDirectory) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(screenshotDirectory, `auth-login-${testInfo.project.name}.png`)
        });
      }
    }
  }
  expect(browserErrors, 'rutas de autenticación sin errores de consola o JavaScript').toEqual([]);
});

test('onboarding y preferencias conservan emojis de comida y usan SVG para objetivos', async ({
  page
}, testInfo) => {
  const browserErrors = collectFirstPartyBrowserErrors(page);
  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  const isMobile = Boolean(testInfo.project.use.isMobile);
  const sizes = isMobile
    ? [
        { width: 393, height: 851 },
        { width: 320, height: 568 },
        { width: 568, height: 320 }
      ]
    : [{ width: 1440, height: 900 }];

  await registerToOnboarding(page, 'qa-onboarding-icons');
  await createHousehold(page, 'Hogar sintético onboarding iconos');
  await page.goto('/onboarding');
  await waitForRouterViewTransition(page);
  await waitForStableView(page);
  const onboardingLogo = page.locator('.onboarding__logo app-icon[name="home"]');
  expect.soft(await onboardingLogo.count(), 'Onboarding debe usar la casa SVG').toBe(1);

  await page.getByRole('button', { name: 'Siguiente →' }).click();
  await expect(page.locator('.onboarding__step-label')).toContainText('Alergias');
  const gluten = page.locator('.chip-select__chip', { hasText: 'Gluten' });
  await expect(gluten.locator('.chip-select__icon')).toHaveText('🌾');

  await page.getByRole('button', { name: 'Siguiente →' }).click();
  const chicken = page.locator('.chip-select__chip', { hasText: 'Pollo' });
  const offal = page.locator('.chip-select__chip', { hasText: 'Vísceras y casquería' });
  await expect(chicken.locator('.chip-select__icon')).toHaveText('🍗');
  await expect(offal.locator('.chip-select__icon')).toHaveText('🫀');

  await page.getByRole('button', { name: 'Siguiente →' }).click();
  await expect(page.locator('.onboarding__step-label')).toContainText('Objetivo');
  expect.soft(await page.locator('.onboarding__goal-icon app-icon').count()).toBe(7);
  expect.soft(await page.locator('.onboarding__goal-icon svg[aria-hidden="true"]').count()).toBe(7);
  const goalLabels = await page.locator('.onboarding__goal-label').allTextContents();
  expect.soft(goalLabels).toHaveLength(7);
  expect.soft(goalLabels.join('')).not.toMatch(/\p{Extended_Pictographic}/u);

  for (const size of sizes) {
    await waitForRouterViewTransition(page);
    await page.setViewportSize(size);
    await waitForStableView(page);
    if (isMobile) {
      const dimensions = await page.evaluate(() => {
        const card = document.querySelector('.onboarding__card')!.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          cardLeft: card.left,
          cardRight: card.right
        };
      });
      expect(
        dimensions.documentWidth,
        `no debe haber scroll horizontal a ${size.width}×${size.height}px`
      ).toBeLessThanOrEqual(dimensions.viewportWidth);
      expect(dimensions.cardLeft).toBeGreaterThanOrEqual(0);
      expect(dimensions.cardRight).toBeLessThanOrEqual(size.width);
      const nextButton = page.getByRole('button', { name: 'Siguiente →' });
      await nextButton.scrollIntoViewIfNeeded();
      await expect(nextButton).toBeVisible();
    }
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForStableView(page);
      await page.screenshot({
        path: join(screenshotDirectory, `onboarding-goals-${size.width}x${size.height}.png`),
        fullPage: true
      });
    }
  }

  await page.goto('/preferences?tab=goal');
  await waitForRouterViewTransition(page);
  await expect(page.locator('.preferences__title')).toBeVisible();
  expect.soft(await page.locator('.preferences__goal-icon app-icon').count()).toBe(7);

  if (isMobile) {
    for (const size of [
      { width: 393, height: 851 },
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(size);
      await waitForStableView(page);
      const documentWidth = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(
        documentWidth,
        `Preferencias no debe forzar scroll horizontal a ${size.width}×${size.height}px`
      ).toBeLessThanOrEqual(0);

      await page.locator('[data-test="preferences-tab-allergies"]').click();
      await page.locator('[data-test="preferences-tab-goal"]').click();
      expect(await page.locator('.preferences__goal-icon app-icon').count()).toBe(7);
    }
  }

  await page.goto('/preferences?tab=meals');
  await waitForRouterViewTransition(page);
  await expect(page.locator('#meal-dinner')).toBeVisible();
  const mealSizes = isMobile
    ? [
        { width: 393, height: 851 },
        { width: 320, height: 568 },
        { width: 568, height: 320 }
      ]
    : [{ width: 1440, height: 900 }];
  for (const size of mealSizes) {
    await page.setViewportSize(size);
    await waitForStableView(page);
    const layout = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return {
        width,
        documentWidth: document.documentElement.scrollWidth,
        rows: Array.from(document.querySelectorAll('.meal-hours__row')).map((row) => {
          const rect = row.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })
      };
    });
    expect(
      layout.documentWidth,
      `los horarios no deben forzar scroll horizontal a ${size.width}×${size.height}px`
    ).toBeLessThanOrEqual(layout.width);
    expect(layout.rows).toHaveLength(4);
    for (const row of layout.rows) {
      expect(row.left).toBeGreaterThanOrEqual(0);
      expect(row.right).toBeLessThanOrEqual(size.width);
    }
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForStableView(page);
      await page.screenshot({
        path: join(screenshotDirectory, `preferences-meals-${size.width}x${size.height}.png`),
        fullPage: true
      });
    }
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await waitForStableView(page);
  await page.locator('#meal-dinner').fill('21:30');
  await waitForStableView(page);
  const dinnerReset = page.locator('.meal-hours__reset');
  await expect(dinnerReset).toBeVisible();
  await dinnerReset.click();
  await expect(page.locator('#meal-dinner')).toHaveValue('20:30');
  await page.locator('#meal-dinner').fill('21:30');
  await waitForStableView(page);
  await page.getByRole('button', { name: 'Guardar preferencias' }).click();
  await expect(page.locator('.toast--success').filter({ hasText: 'Guardado' })).toBeVisible();
  await page.reload();
  await waitForRouterViewTransition(page);
  await expect(page.locator('#meal-dinner')).toHaveValue('21:30');
  await page.goto('/preferences?tab=goal');
  await waitForRouterViewTransition(page);

  await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
  await page.reload();
  await waitForRouterViewTransition(page);
  await expect(page.locator('.preferences__goal-label').first()).toHaveText('Balanced');
  expect.soft(await page.locator('.preferences__goal-icon app-icon').count()).toBe(7);

  await page.goto('/preferences?tab=allergies');
  await waitForRouterViewTransition(page);
  await expect(
    page.locator('.chip-select__chip', { hasText: 'Gluten' }).locator('.chip-select__icon')
  ).toHaveText('🌾');
  await page.goto('/preferences?tab=tastes');
  await waitForRouterViewTransition(page);
  const firstLike = page.locator('.preferences__field').first();
  await expect(firstLike.locator('.chip-select__text').first()).toHaveText('Chicken');
  await expect(firstLike.locator('.chip-select__icon').first()).toHaveText('🍗');
  expect(browserErrors, 'onboarding y preferencias sin errores de consola o JavaScript').toEqual(
    []
  );
});

test('invitaciones válidas e inválidas conservan el copy accesible sin emoji decorativo', async ({
  page
}) => {
  const browserErrors = collectFirstPartyBrowserErrors(page);
  const invalidInviteResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/household/invite/codigo-invalido-qa')
  );
  await page.goto('/invite/codigo-invalido-qa');
  expect((await invalidInviteResponse).status()).toBe(404);
  await expect(page.locator('.invite-card__title')).toHaveText('Invitación no válida');
  await waitForRouterViewTransition(page);
  const inviteLogo = page.locator('.invite-card__icon app-icon[name="home"]');
  expect.soft(await inviteLogo.count(), 'Invitación debe usar la casa SVG').toBe(1);

  await registerUser(page, 'qa-invite-owner');
  await createHousehold(page, 'Casa sintética de iconos');
  await waitForRouterViewTransition(page);
  const inviteLink = (await page.locator('.invite-card__code').textContent())?.trim();
  expect(inviteLink).toBeTruthy();
  const inviteCode = new URL(inviteLink!).pathname.split('/').filter(Boolean).at(-1)!;

  await page.goto(`/invite/${inviteCode}`);
  await expect(page.locator('.invite-card__info')).toHaveText('Ya eres miembro de este hogar');
  await waitForRouterViewTransition(page);

  await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
  await page.reload();
  await waitForRouterViewTransition(page);
  await expect(page.locator('.invite-card__info')).toHaveText(
    'You are already a member of this household'
  );

  await logout(page);
  await page.goto(`/invite/${inviteCode}`);
  await expect(page.locator('.invite-card__text')).toContainText('Casa sintética de iconos');
  await waitForRouterViewTransition(page);
  const createAccount = page.locator('a[href^="/auth/register"]');
  await expect(createAccount).toBeVisible();
  await expect(createAccount).toHaveAttribute('href', new RegExp(`code=${inviteCode}`));
  await createAccount.click();
  await expect(page).toHaveURL(new RegExp(`/auth/register.*code=${inviteCode}`));
  await waitForRouterViewTransition(page);
  expect(browserErrors, 'flujo de invitación sin errores de consola o JavaScript').toEqual([]);
});
