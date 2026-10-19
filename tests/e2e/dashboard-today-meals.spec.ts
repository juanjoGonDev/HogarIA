import { Page, expect } from '@playwright/test';
import { test } from './fixtures';
import { isRecipeGenerationRequest } from './helpers/ai-requests';
import { registerAndGoto } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

// A worker bypasses page.route(); pin Madrid to exercise local/UTC date boundaries.
test.use({ serviceWorkers: 'block', timezoneId: 'Europe/Madrid' });

const TOKEN_KEY = 'hogar:v1:auth_token';
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'la sesion deberia tener token').toBeTruthy();
  return token as string;
}

async function api(
  page: Page,
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<any> {
  const response = await page.request.fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: body === undefined ? undefined : JSON.stringify(body)
  });
  expect(response.ok(), `${method} ${path} respondio ${response.status()}`).toBeTruthy();
  return response.json();
}

test('Dashboard lista solo comidas pendientes de hoy y permite recuperar un error', async ({
  page
}, testInfo) => {
  const pageErrors: string[] = [];
  const generationRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (isRecipeGenerationRequest(request.url(), request.method())) {
      generationRequests.push(request.url());
    }
  });

  // Registration enters Dashboard once while skipping onboarding, and
  // registerAndGoto then navigates there again. Arm the fault only after both
  // setup navigations so the first measured Dashboard load receives the 503.
  let failNextRangeRequest = false;
  let holdNextRangeRequest = false;
  let notifyHeldRange: (() => void) | undefined;
  let releaseHeldRange: (() => void) | undefined;
  const heldRangeRequest = new Promise<void>((resolve) => {
    notifyHeldRange = resolve;
  });
  const waitForRangeRelease = new Promise<void>((resolve) => {
    releaseHeldRange = resolve;
  });
  await page.route('**/api/calendar/range**', async (route) => {
    if (failNextRangeRequest) {
      failNextRangeRequest = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic calendar failure' })
      });
      return;
    }
    if (holdNextRangeRequest) {
      holdNextRangeRequest = false;
      notifyHeldRange?.();
      await waitForRangeRelease;
    }
    await route.continue();
  });

  await page.clock.install({ time: new Date('2026-09-30T22:30:00.000Z') });
  await registerAndGoto(page, '/dashboard', 'dashboard-today-meals');
  const token = await tokenOf(page);
  failNextRangeRequest = true;
  await page.reload();
  const todaySection = page
    .locator('.dashboard__section')
    .filter({ has: page.getByRole('heading', { name: /Comidas de hoy|Today's meals/ }) });
  await expect(todaySection.locator('[data-test="today-meals-error"]')).toContainText(
    'No se han podido cargar tus comidas.'
  );
  await expect(todaySection.locator('[data-test="today-meals-empty"]')).toHaveCount(0);
  const initialRetry = todaySection.getByRole('button', { name: 'Reintentar' });
  await initialRetry.focus();
  await expect(initialRetry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(todaySection.locator('[data-test="today-meals-empty"]')).toBeVisible();

  const dates = await page.evaluate(() => {
    const localIsoDate = (date: Date): string =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const shifted = (days: number): string => {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return localIsoDate(date);
    };
    return {
      yesterday: shifted(-1),
      today: shifted(0),
      tomorrow: shifted(1),
      utcToday: new Date().toISOString().slice(0, 10)
    };
  });
  expect(dates.today).toBe('2026-10-01');
  expect(dates.utcToday).toBe('2026-09-30');
  const mealIds: string[] = [];

  try {
    const fixtures = [
      {
        date: dates.yesterday,
        mealType: 'breakfast',
        customMeal: 'QA ayer no visible',
        time: '08:00'
      },
      {
        date: dates.today,
        mealType: 'dinner',
        customMeal: 'QA cena tardia',
        time: '21:30'
      },
      {
        date: dates.today,
        mealType: 'lunch',
        customMeal: 'QA comida temprana',
        time: '12:15'
      },
      {
        date: dates.today,
        mealType: 'breakfast',
        customMeal: 'QA desayuno completado',
        time: '08:00'
      },
      {
        date: dates.tomorrow,
        mealType: 'snack',
        customMeal: 'QA manana no visible',
        time: '16:00'
      }
    ];

    for (const fixture of fixtures) {
      const response = await api(page, 'POST', '/api/calendar/meals', token, {
        ...fixture,
        servings: 1
      });
      mealIds.push(response.data.id);
    }
    await api(page, 'PATCH', `/api/calendar/meals/${mealIds[3]}`, token, { completed: true });

    await page.reload();
    const meals = todaySection.locator('[data-test="today-meal"]');
    await expect(meals).toHaveCount(2);
    await expect(meals.nth(0)).toContainText('Almuerzo');
    await expect(meals.nth(0)).toContainText('QA comida temprana');
    await expect(meals.nth(0).locator('time')).toHaveText('12:15');
    await expect(meals.nth(1)).toContainText('Cena');
    await expect(meals.nth(1)).toContainText('QA cena tardia');
    await expect(meals.nth(1).locator('time')).toHaveText('21:30');
    await expect(todaySection).not.toContainText('QA ayer no visible');
    await expect(todaySection).not.toContainText('QA desayuno completado');
    await expect(todaySection).not.toContainText('QA manana no visible');

    failNextRangeRequest = true;
    await page.reload();
    await expect(todaySection.locator('[data-test="today-meals-error"]')).toContainText(
      'No se han podido cargar tus comidas.'
    );
    await expect(todaySection.locator('.empty-state')).toHaveCount(0);

    const retry = todaySection.locator('[data-test="today-meals-retry"]');
    const retrySize = await retry.evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    });
    expect(retrySize.width).toBeGreaterThanOrEqual(44);
    expect(retrySize.height).toBeGreaterThanOrEqual(44);
    holdNextRangeRequest = true;
    await retry.click();
    await heldRangeRequest;
    await expect(todaySection.locator('[data-test="today-meals-loading"]')).toBeVisible();
    releaseHeldRange?.();
    await expect(meals).toHaveCount(2);
    await expect(meals.nth(0)).toContainText('Almuerzo');
    await expect(meals.nth(0)).toContainText('QA comida temprana');
    await expect(meals.nth(0).locator('time')).toHaveText('12:15');
    await expect(meals.nth(1)).toContainText('Cena');
    await expect(meals.nth(1)).toContainText('QA cena tardia');
    await expect(meals.nth(1).locator('time')).toHaveText('21:30');
    await expect(todaySection).not.toContainText('QA ayer no visible');
    await expect(todaySection).not.toContainText('QA desayuno completado');
    await expect(todaySection).not.toContainText('QA manana no visible');
    await expect(todaySection.locator('[data-test="today-meals-error"]')).toHaveCount(0);

    await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();
    await expect(meals).toHaveCount(2);
    await expect(meals.nth(0)).toContainText('Lunch');
    await expect(meals.nth(1)).toContainText('Dinner');
    await waitForStableView(page);

    const viewportSizes = testInfo.project.use.isMobile
      ? [
          { width: 320, height: 568 },
          { width: 393, height: 851 },
          { width: 479, height: 851 },
          { width: 480, height: 851 },
          { width: 481, height: 851 },
          { width: 767, height: 851 },
          { width: 768, height: 851 },
          { width: 769, height: 851 },
          { width: 844, height: 390 }
        ]
      : [
          { width: 1440, height: 900 },
          { width: 1023, height: 800 },
          { width: 1024, height: 800 }
        ];

    for (const viewport of viewportSizes) {
      await page.setViewportSize(viewport);
      await meals.first().scrollIntoViewIfNeeded();
      await waitForStableView(page);
      const layout = await page.evaluate(() => {
        const meal = document.querySelector<HTMLElement>('[data-test="today-meal"]');
        const rect = meal?.getBoundingClientRect();
        const bottomNav = document.querySelector<HTMLElement>('.bottom-nav');
        const navRect = bottomNav?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          meal: rect
            ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
            : null,
          bottomNav: navRect ? { top: navRect.top, bottom: navRect.bottom } : null
        };
      });
      expect(
        layout.documentWidth,
        `sin overflow a ${viewport.width}x${viewport.height}`
      ).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.meal, 'la comida debe seguir renderizada en cada viewport').not.toBeNull();
      expect(layout.meal!.left).toBeGreaterThanOrEqual(0);
      expect(layout.meal!.right).toBeLessThanOrEqual(viewport.width);
      if (layout.bottomNav && layout.meal!.top < layout.bottomNav.bottom) {
        expect(
          layout.meal!.bottom,
          'la barra inferior no debe cubrir la comida'
        ).toBeLessThanOrEqual(layout.bottomNav.top);
      }

      if (
        SCREENSHOT_DIR &&
        ((testInfo.project.use.isMobile && viewport.width === 393) ||
          (!testInfo.project.use.isMobile && viewport.width === 1440))
      ) {
        const { mkdirSync } = await import('node:fs');
        const { join } = await import('node:path');
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: join(
            SCREENSHOT_DIR,
            `dashboard-today-meals-${viewport.width}x${viewport.height}.png`
          )
        });
      }
    }

    await todaySection.getByRole('link', { name: /Ver todo|See all/ }).click();
    await expect(page).toHaveURL(/\/calendar/);
  } finally {
    const cleanupErrors: string[] = [];
    for (const id of mealIds) {
      try {
        await api(page, 'DELETE', `/api/calendar/meals/${id}`, token);
      } catch (error) {
        cleanupErrors.push(`${id}: ${String(error)}`);
      }
    }
    expect(cleanupErrors, 'cada comida sintética debe limpiarse').toEqual([]);
  }

  await page.goto('/dashboard');
  await expect(todaySection.locator('[data-test="today-meals-empty"]')).toBeVisible();
  await expect(todaySection.locator('[data-test="today-meals-error"]')).toHaveCount(0);
  expect(generationRequests, 'no se deben generar recetas desde este flujo').toEqual([]);
  expect(pageErrors, 'la pantalla no debe lanzar errores JavaScript').toEqual([]);
});
