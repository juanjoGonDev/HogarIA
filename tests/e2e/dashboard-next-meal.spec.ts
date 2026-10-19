import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { isRecipeGenerationRequest } from './helpers/ai-requests';
import { waitForStableView } from './helpers/recipe-fixtures';

test.use({ serviceWorkers: 'block', timezoneId: 'Europe/Madrid' });

const TOKEN_KEY = 'hogar:v1:auth_token';
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'la sesión sintética debe tener token').toBeTruthy();
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
  expect(response.ok(), `${method} ${path} debe responder correctamente`).toBeTruthy();
  return response.json();
}

async function addMeal(
  page: Page,
  token: string,
  date: string,
  customMeal: string,
  time: string
): Promise<string> {
  const response = await api(page, 'POST', '/api/calendar/meals', token, {
    date,
    mealType: 'lunch',
    customMeal,
    time,
    servings: 1
  });
  return response.data.id as string;
}

async function deleteMeals(page: Page, token: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    const response = await page.request.delete(`/api/calendar/meals/${id}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.ok(), `la comida sintética ${id} debe limpiarse`).toBeTruthy();
  }
}

async function localDates(page: Page): Promise<{ today: string; tomorrow: string }> {
  return page.evaluate(() => {
    const iso = (date: Date): string =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return { today: iso(today), tomorrow: iso(tomorrow) };
  });
}

function skipSafari(testInfo: { project: { name: string } }): void {
  test.skip(testInfo.project.name === 'mobile-safari', 'esta unidad valida Chromium y Pixel 5');
}

test('Dashboard marca la comida siguiente de hoy y anticipa la próxima fecha', async ({
  page
}, testInfo) => {
  skipSafari(testInfo);
  const pageErrors: string[] = [];
  const generationRequests: string[] = [];
  const mealIds: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (isRecipeGenerationRequest(request.url(), request.method())) {
      generationRequests.push(request.url());
    }
  });
  await page.clock.install({ time: new Date('2026-10-08T08:30:00.000Z') });
  await registerAndGoto(page, '/dashboard', 'dashboard-next-meal');
  const token = await tokenOf(page);
  const dates = await localDates(page);

  try {
    const past = await addMeal(page, token, dates.today, 'QA comida ya pasada', '09:00');
    const nextToday = await addMeal(page, token, dates.today, 'QA siguiente hoy', '10:45');
    const laterToday = await addMeal(page, token, dates.today, 'QA más tarde hoy', '18:00');
    const nextDate = await addMeal(page, token, dates.tomorrow, 'QA siguiente fecha', '08:00');
    const completed = await addMeal(page, token, dates.today, 'QA comida completada', '10:40');
    mealIds.push(past, nextToday, laterToday, nextDate, completed);
    await api(page, 'PATCH', `/api/calendar/meals/${completed}`, token, { completed: true });

    await page.reload();
    const todaySection = page
      .locator('.dashboard__section')
      .filter({ has: page.getByRole('heading', { name: /Comidas de hoy|Today's meals/i }) });
    const todayMeals = todaySection.locator('[data-test="today-meal"]');
    await expect(todayMeals).toHaveCount(3);
    await expect(todayMeals.filter({ hasText: 'QA comida ya pasada' })).not.toHaveClass(
      /meal-card--next/
    );
    const nextTodayRow = todayMeals.filter({ hasText: 'QA siguiente hoy' });
    await expect(nextTodayRow).toHaveClass(/meal-card--next/);
    await expect(nextTodayRow.locator('.meal-card__next')).toHaveText('Siguiente');
    await expect(todaySection.locator('[data-test="next-meal-card"]')).toHaveCount(0);

    await api(page, 'PATCH', `/api/calendar/meals/${nextToday}`, token, { completed: true });
    await api(page, 'PATCH', `/api/calendar/meals/${laterToday}`, token, { completed: true });
    await page.reload();
    const nextMeal = page.locator('[data-test="next-meal"]');
    const preview = nextMeal.locator('[data-test="next-meal-card"]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('QA siguiente fecha');
    await expect(preview).toContainText('Almuerzo');
    await expect(preview.locator('time')).toHaveCount(2);
    await expect(preview.locator('time').last()).toHaveText('08:00');
    await expect(todayMeals).toHaveCount(1);
    await expect(todayMeals.first()).toContainText('QA comida ya pasada');
    await expect(todaySection).not.toContainText('QA comida completada');

    const viewports = [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 1440, height: 900 }
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await preview.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await waitForStableView(page);
      const geometry = await page.evaluate(() => {
        const today = document.querySelector<HTMLElement>('[data-test="today-meal"]');
        const next = document.querySelector<HTMLElement>('[data-test="next-meal-card"]');
        const todayStyle = today ? getComputedStyle(today) : null;
        const nextStyle = next ? getComputedStyle(next) : null;
        const todayRect = today?.getBoundingClientRect();
        const nextRect = next?.getBoundingClientRect();
        const nav = document.querySelector<HTMLElement>('.bottom-nav');
        const navRect = nav?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          today: todayRect
            ? { left: todayRect.left, right: todayRect.right, width: todayRect.width }
            : null,
          next: nextRect
            ? {
                left: nextRect.left,
                right: nextRect.right,
                bottom: nextRect.bottom,
                width: nextRect.width
              }
            : null,
          samePadding: todayStyle?.padding === nextStyle?.padding,
          sameRadius: todayStyle?.borderRadius === nextStyle?.borderRadius,
          sameGap: todayStyle?.gap === nextStyle?.gap,
          navTop: navRect?.top ?? Number.POSITIVE_INFINITY,
          navVisible: Boolean(nav && getComputedStyle(nav).display !== 'none')
        };
      });
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.today).not.toBeNull();
      expect(geometry.next).not.toBeNull();
      expect(geometry.today!.left).toBeGreaterThanOrEqual(0);
      expect(geometry.next!.right).toBeLessThanOrEqual(viewport.width);
      expect(Math.abs(geometry.today!.width - geometry.next!.width)).toBeLessThanOrEqual(1);
      expect(geometry.samePadding).toBeTruthy();
      expect(geometry.sameRadius).toBeTruthy();
      expect(geometry.sameGap).toBeTruthy();
      if (geometry.navVisible) {
        expect(geometry.next!.bottom).toBeLessThanOrEqual(geometry.navTop);
      }

      if (
        SCREENSHOT_DIR &&
        ((testInfo.project.use.isMobile && viewport.width === 393) ||
          (!testInfo.project.use.isMobile && viewport.width === 1440))
      ) {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: join(
            SCREENSHOT_DIR,
            `dashboard-next-meal-${viewport.width}x${viewport.height}.png`
          ),
          fullPage: false
        });
      }
    }

    await page.evaluate(() => window.localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Next meal' })).toBeVisible();
    await expect(page.locator('[data-test="next-meal-card"]')).toContainText('Lunch');
    await page.evaluate(() => window.localStorage.setItem('hogar:v1:language', 'es'));
    await page.reload();

    await page.setViewportSize(
      testInfo.project.use.isMobile ? { width: 393, height: 851 } : { width: 1440, height: 900 }
    );
    const card = page.locator('[data-test="next-meal-card"]');
    await card.focus();
    await expect(card).toBeFocused();
    if (testInfo.project.use.isMobile) await card.tap();
    else await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/calendar/);
  } finally {
    await deleteMeals(page, token, mealIds);
  }

  await page.goto('/dashboard');
  await expect(page.locator('[data-test="next-meal-card"]')).toHaveCount(0);
  expect(generationRequests, 'la navegación del calendario no debe generar recetas').toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Dashboard distingue una cola vacía del error 503 y permite reintentar con teclado', async ({
  page
}, testInfo) => {
  skipSafari(testInfo);
  await page.clock.install({ time: new Date('2026-10-08T08:30:00.000Z') });
  let failNext = false;
  let holdNext = false;
  let notifyHeldRequest: (() => void) | undefined;
  let releaseHeldRequest: (() => void) | undefined;
  const heldRequest = new Promise<void>((resolve) => {
    notifyHeldRequest = resolve;
  });
  const releaseRequest = new Promise<void>((resolve) => {
    releaseHeldRequest = resolve;
  });
  await page.route('**/api/calendar/range**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('endDate') !== '2026-10-14') {
      await route.continue();
      return;
    }
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic meal preview failure' })
      });
      return;
    }
    if (holdNext) {
      holdNext = false;
      notifyHeldRequest?.();
      await releaseRequest;
    }
    await route.continue();
  });

  await registerAndGoto(page, '/dashboard', 'dashboard-next-meal-retry');
  const nextMeal = page.locator('[data-test="next-meal"]');
  await expect(nextMeal.locator('[data-test="next-meal-empty"]')).toBeVisible();

  failNext = true;
  await page.reload();
  await expect(nextMeal.locator('[data-test="next-meal-error"]')).toContainText(
    'No se pudo cargar la próxima comida.'
  );
  await expect(nextMeal.locator('[data-test="next-meal-empty"]')).toHaveCount(0);
  const retry = nextMeal.locator('[data-test="next-meal-retry"]');
  const retryBounds = await retry.boundingBox();
  expect(retryBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  await retry.focus();
  await expect(retry).toBeFocused();
  holdNext = true;
  await page.keyboard.press('Enter');
  await heldRequest;
  await expect(nextMeal.locator('[data-test="next-meal-loading"]')).toBeVisible();
  releaseHeldRequest?.();
  await expect(nextMeal.locator('[data-test="next-meal-empty"]')).toBeVisible();
  await expect(nextMeal.locator('[data-test="next-meal-error"]')).toHaveCount(0);

  const planNow = nextMeal.getByRole('link', { name: 'Planificar ahora' });
  await planNow.focus();
  await expect(planNow).toBeFocused();
  if (testInfo.project.use.isMobile) await planNow.tap();
  else await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/calendar/);
});
