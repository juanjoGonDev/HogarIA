import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

test.use({ timezoneId: 'Europe/Madrid' });

const TOKEN_KEY = 'hogar:v1:auth_token';
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'la sesión sintética debe tener token').toBeTruthy();
  return token as string;
}

async function addIngredient(
  page: Page,
  token: string,
  name: string,
  expirationDate?: string
): Promise<string> {
  const response = await page.request.post('/api/pantry/ingredients', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name,
      category: 'other',
      quantity: 1,
      unit: 'unit',
      location: 'pantry',
      ...(expirationDate ? { expirationDate } : {})
    }
  });
  expect(response.status(), `el fixture ${name} debe crearse`).toBe(201);
  const payload = await response.json();
  return payload.data.id as string;
}

async function deleteIngredients(page: Page, token: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    const response = await page.request.delete(`/api/pantry/ingredients/${id}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.ok(), `el fixture sintético ${id} debe limpiarse`).toBeTruthy();
  }
}

function utcDayFromToday(offset: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function capture(
  page: Page,
  screen: 'dashboard' | 'settings',
  project: string,
  width: number
): Promise<void> {
  if (!SCREENSHOT_DIR) return;
  await waitForStableView(page);
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, `${screen}-expiry-${project}-${width}.png`),
    fullPage: true
  });
}

test('Dashboard aplica el horizonte de caducidad guardado en Settings', async ({
  page
}, testInfo) => {
  const ingredientIds: string[] = [];
  let token = '';
  await registerAndGoto(page, '/dashboard', 'dashboard-expiry-window');
  token = await tokenOf(page);

  try {
    ingredientIds.push(
      await addIngredient(page, token, 'QA caducado', utcDayFromToday(-1)),
      await addIngredient(page, token, 'QA caduca hoy', utcDayFromToday(0)),
      await addIngredient(page, token, 'QA limite tres días', utcDayFromToday(3)),
      await addIngredient(page, token, 'QA fuera del límite', utcDayFromToday(4)),
      await addIngredient(page, token, 'QA limite cinco días', utcDayFromToday(5)),
      await addIngredient(page, token, 'QA fecha desconocida')
    );

    await page.goto('/dashboard');
    const section = page.locator('[data-test="dashboard-expiry"]');
    await expect(section).toBeVisible();
    await expect(section.locator('[data-test="dashboard-expiry-row"]')).toHaveCount(3);
    await expect(section).toContainText('QA caducado');
    await expect(section).toContainText('QA caduca hoy');
    await expect(section).toContainText('QA limite tres días');
    await expect(section).not.toContainText('QA fuera del límite');
    await expect(section).not.toContainText('QA limite cinco días');
    await expect(section).not.toContainText('QA fecha desconocida');

    await page.goto('/settings');
    const horizon = page.getByRole('spinbutton', {
      name: /Avisar antes de caducidad|Expiry warning window/i
    });
    await expect(horizon).toHaveValue('3');
    await expect(horizon).toHaveAttribute('min', '1');
    await expect(horizon).toHaveAttribute('max', '30');
    await horizon.fill('5');
    await horizon.press('Tab');
    await expect(horizon).toHaveValue('5');
    await page.reload();
    await expect(
      page.getByRole('spinbutton', {
        name: /Avisar antes de caducidad|Expiry warning window/i
      })
    ).toHaveValue('5');

    await page.goto('/dashboard');
    const expanded = page.locator('[data-test="dashboard-expiry"]');
    await expect(expanded.locator('[data-test="dashboard-expiry-row"]')).toHaveCount(5);
    await expect(expanded).toContainText('QA limite cinco días');
    await expect(expanded).not.toContainText('QA fecha desconocida');
    const viewports = testInfo.project.use.isMobile
      ? [
          { width: 393, height: 851 },
          { width: 320, height: 568 },
          { width: 568, height: 320 }
        ]
      : [
          { width: 1440, height: 900 },
          { width: 393, height: 851 },
          { width: 320, height: 568 },
          { width: 568, height: 320 }
        ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard');
      const expiry = page.locator('[data-test="dashboard-expiry"]');
      await expect(expiry).toBeVisible();
      const viewAll = expiry.getByRole('link', { name: /Ver caducidades|View expiries/i });
      const viewAllBounds = await viewAll.boundingBox();
      expect(viewAllBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(viewAllBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
      const geometry = await page.evaluate(() => {
        const section = document.querySelector<HTMLElement>('[data-test="dashboard-expiry"]');
        const rect = section?.getBoundingClientRect();
        const nav = document.querySelector<HTMLElement>('.bottom-nav');
        const navRect = nav?.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
          sectionLeft: rect?.left ?? -1,
          sectionRight: rect?.right ?? Number.POSITIVE_INFINITY,
          navTop: navRect?.top ?? Number.POSITIVE_INFINITY,
          sectionBottom: rect?.bottom ?? 0
        };
      });
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.sectionLeft).toBeGreaterThanOrEqual(0);
      expect(geometry.sectionRight).toBeLessThanOrEqual(geometry.viewportWidth);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const finalRow = expiry.locator('[data-test="dashboard-expiry-row"]').last();
      const navClearance = await finalRow.evaluate((row) => {
        const nav = document.querySelector<HTMLElement>('.bottom-nav');
        return {
          rowBottom: row.getBoundingClientRect().bottom,
          navTop: nav?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
          navVisible: Boolean(nav && getComputedStyle(nav).display !== 'none')
        };
      });
      await expect(finalRow).toBeVisible();
      if (navClearance.navVisible) {
        expect(navClearance.rowBottom).toBeLessThanOrEqual(navClearance.navTop);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await capture(page, 'dashboard', testInfo.project.name, viewport.width);

      await page.goto('/settings');
      const settingsHorizon = page.getByRole('spinbutton', {
        name: /Avisar antes de caducidad|Expiry warning window/i
      });
      await expect(settingsHorizon).toBeVisible();
      const horizonBounds = await settingsHorizon.boundingBox();
      expect(horizonBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(horizonBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
      const settingsGeometry = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }));
      expect(settingsGeometry.documentWidth).toBeLessThanOrEqual(settingsGeometry.viewportWidth);
      await capture(page, 'settings', testInfo.project.name, viewport.width);
    }

    await page.goto('/dashboard');
    await page
      .locator('[data-test="dashboard-expiry"]')
      .getByRole('link', { name: /Ver caducidades|View expiries/i })
      .click();
    await expect(page).toHaveURL(/\/pantry\/caducidades$/);
  } finally {
    if (token && ingredientIds.length) await deleteIngredients(page, token, ingredientIds);
  }
});

test('Dashboard distingue error y vacío en caducidades y permite reintentar', async ({ page }) => {
  let failNextRequest = false;
  await page.route('**/api/pantry/expiry', async (route) => {
    if (failNextRequest) {
      failNextRequest = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Synthetic expiry failure' })
      });
      return;
    }
    await route.continue();
  });
  await registerAndGoto(page, '/dashboard', 'dashboard-expiry-retry');

  const section = page.locator('[data-test="dashboard-expiry"]');
  await expect(section.locator('[data-test="dashboard-expiry-empty"]')).toBeVisible();
  failNextRequest = true;
  await page.reload();
  await expect(section.locator('[data-test="dashboard-expiry-error"]')).toBeVisible();
  await expect(section.locator('[data-test="dashboard-expiry-empty"]')).toHaveCount(0);
  const retry = section.getByRole('button', { name: /Reintentar|Retry/i });
  const retryBounds = await retry.boundingBox();
  expect(retryBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(retryBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  await retry.focus();
  await expect(retry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(section.locator('[data-test="dashboard-expiry-empty"]')).toBeVisible();
  await expect(section.locator('[data-test="dashboard-expiry-error"]')).toHaveCount(0);
});
