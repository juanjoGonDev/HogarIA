import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, registerAndGoto } from './helpers/auth';

async function ensureMobileSidebarOpen(page: Page): Promise<void> {
  if (test.info().project.name !== 'mobile-chrome') return;
  const sidebar = page.locator('.sidebar');
  if (!(await sidebar.evaluate((element) => element.classList.contains('sidebar--open')))) {
    await page.locator('.header__menu').click();
  }
  await expect(sidebar).toHaveClass(/sidebar--open/);
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => localStorage.getItem(key), 'hogar:v1:auth_token');
  expect(token).toBeTruthy();
  return { authorization: `Bearer ${token}` };
}

async function today(page: Page): Promise<string> {
  return page.evaluate(() => {
    const date = new Date();
    const twoDigits = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  });
}

async function daysFromToday(page: Page, days: number): Promise<string> {
  return page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const twoDigits = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
  }, days);
}

test('clears and reloads calendar data when switching active homes in place', async ({
  page,
  browser
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  const secondContext = await browser.newContext({ locale: 'es-ES', viewport });
  const secondPage = await secondContext.newPage();
  const heldResponseControl: { release?: () => void } = {};

  try {
    await registerAndGoto(page, '/household', 'Calendario sintético uno');
    await createHousehold(page, 'Calendario sintético hogar uno');
    await registerAndGoto(secondPage, '/household', 'Calendario sintético dos');
    await createHousehold(secondPage, 'Calendario sintético hogar dos');

    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();

    await page.goto('/household');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await dialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await dialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText(
      'Calendario sintético hogar dos'
    );

    const headers = await authHeaders(page);
    const membershipsResponse = await page.request.get('/api/household/memberships', { headers });
    expect(membershipsResponse.ok()).toBeTruthy();
    const memberships = (await membershipsResponse.json()).data.memberships as Array<{
      id: string;
      name: string;
    }>;
    const householdOne = memberships.find(
      (membership) => membership.name === 'Calendario sintético hogar uno'
    );
    const householdTwo = memberships.find(
      (membership) => membership.name === 'Calendario sintético hogar dos'
    );
    expect(householdOne).toBeTruthy();
    expect(householdTwo).toBeTruthy();

    const date = await today(page);
    const futureDate = await daysFromToday(page, 7);
    const createMeal = async (title: string, mealDate = date) => {
      const response = await page.request.post('/api/calendar/meals', {
        headers,
        data: { date: mealDate, mealType: 'lunch', customMeal: title, servings: 2 }
      });
      expect(response.status(), await response.text()).toBe(201);
    };

    await createMeal('Plato exclusivo hogar dos');
    await createMeal('Respuesta tardía hogar dos', futureDate);
    const switchHome = async (householdId: string) => {
      const response = await page.request.post('/api/household/active', {
        headers,
        data: { householdId }
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    };

    await switchHome(householdOne!.id);
    await createMeal('Plato exclusivo hogar uno');
    await createMeal('Respuesta vigente hogar uno', futureDate);
    await switchHome(householdTwo!.id);

    await page.goto(`/calendar?date=${date}`);
    const meal = (title: string) =>
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: title });
    await expect(meal('Plato exclusivo hogar dos')).toHaveCount(1);
    await expect(meal('Plato exclusivo hogar uno')).toHaveCount(0);

    const picker = page.locator('[data-test="active-household-select"]');
    await ensureMobileSidebarOpen(page);
    const trigger = picker.locator('.picker__trigger');
    await expect(trigger).toHaveAttribute(
      'aria-label',
      'Hogar activo: Calendario sintético hogar dos'
    );
    await trigger.click();
    const activeRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/household/active') && response.request().method() === 'POST'
    );
    await page.getByRole('option', { name: 'Calendario sintético hogar uno', exact: true }).click();
    const activation = await activeRequest;
    expect(activation.ok()).toBeTruthy();

    await expect(trigger).toHaveAttribute(
      'aria-label',
      'Hogar activo: Calendario sintético hogar uno'
    );
    await expect(meal('Plato exclusivo hogar dos')).toHaveCount(0);
    await expect(meal('Plato exclusivo hogar uno')).toHaveCount(1);

    // Hold a real API response for home one, switch to home two while it is in flight,
    // then release the old response only after home two has rendered its own range.
    if (testInfo.project.name === 'mobile-chrome') {
      await page.locator('.sidebar__close').click();
      await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--open/);
    }

    let holdNextRange = true;
    let resolveOldRangeReady!: () => void;
    let releaseOldRange!: () => void;
    const oldRangeReady = new Promise<void>((resolveReady) => {
      resolveOldRangeReady = resolveReady;
    });
    const releaseOldRangeSignal = new Promise<void>((resolveRelease) => {
      releaseOldRange = resolveRelease;
      heldResponseControl.release = resolveRelease;
    });
    let heldRangeTitle = '';

    await page.route('**/api/calendar/range?*', async (route) => {
      if (!holdNextRange) {
        await route.continue();
        return;
      }
      holdNextRange = false;
      const response = await route.fetch();
      const payload = (await response.json()) as {
        data?: { meals?: Array<{ custom_meal?: string | null }> };
      };
      heldRangeTitle = payload.data?.meals?.[0]?.custom_meal ?? '';
      resolveOldRangeReady();
      await releaseOldRangeSignal;
      await route.fulfill({ response });
    });

    await page.locator('input[type="date"]').fill(futureDate);
    await expect(page).toHaveURL(new RegExp(`[?&]date=${futureDate}`));
    await oldRangeReady;
    expect(heldRangeTitle).toBe('Respuesta vigente hogar uno');

    await ensureMobileSidebarOpen(page);
    await trigger.click();
    const returnToTwo = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/household/active') && response.request().method() === 'POST'
    );
    await page.getByRole('option', { name: 'Calendario sintético hogar dos', exact: true }).click();
    expect((await returnToTwo).ok()).toBeTruthy();
    await expect(trigger).toHaveAttribute(
      'aria-label',
      'Hogar activo: Calendario sintético hogar dos'
    );
    await expect(meal('Respuesta vigente hogar uno')).toHaveCount(0);
    await expect(meal('Respuesta tardía hogar dos')).toHaveCount(1);

    try {
      releaseOldRange();
      await expect(meal('Respuesta vigente hogar uno')).toHaveCount(0);
      await expect(meal('Respuesta tardía hogar dos')).toHaveCount(1);
    } finally {
      releaseOldRange();
      await page.unroute('**/api/calendar/range?*');
    }

    if (testInfo.project.name === 'mobile-chrome') {
      await page.locator('.sidebar__close').click();
      await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--open/);
    }

    const screenshotDirectory = resolve('.e2e-screenshots/calendar-household-context');
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}.png`),
      fullPage: true,
      animations: 'disabled'
    });
  } finally {
    heldResponseControl.release?.();
    await secondContext.close();
  }
});
