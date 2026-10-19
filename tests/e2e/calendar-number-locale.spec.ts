import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { selectCalendarView } from './helpers/calendar-ui';

type ApiReply<T> = { status: number; body: { data: T; message?: string } };

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token, 'la sesión E2E debe estar autenticada').toBeTruthy();
  return token as string;
}

async function post<T>(page: Page, path: string, body: unknown): Promise<ApiReply<T>> {
  const token = await tokenOf(page);
  const response = await page.request.post(path, {
    headers: { authorization: `Bearer ${token}` },
    data: body
  });
  return { status: response.status(), body: (await response.json()) as ApiReply<T>['body'] };
}

async function deleteOwnFixture(page: Page, path: string): Promise<void> {
  const token = await tokenOf(page);
  const response = await page.request.delete(path, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(response.ok(), `la fixture sintética ${path} debe limpiarse`).toBeTruthy();
}

async function localToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${today.getFullYear()}-${month}-${day}`;
  });
}

async function navigateInApp(page: Page, path: '/settings' | '/calendar'): Promise<void> {
  const sidebar = page.locator('.sidebar');
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    const isOpen = await sidebar.evaluate((element) => element.classList.contains('sidebar--open'));
    if (!isOpen) await page.locator('.header__menu').click();
    await expect(sidebar).toHaveClass(/sidebar--open/);
  }

  const expectedUrl = new URL(path, page.url()).toString();
  await sidebar.locator(`a[href="${path}"]`).click();
  await expect(page).toHaveURL(expectedUrl);
}

async function screenshotCalendar(page: Page): Promise<void> {
  const directory = join(process.cwd(), '.e2e-screenshots', 'calendar-locale-qa');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `calendar-locale-${test.info().project.name}.png`)
  });
}

test.describe('locale activo en los números del calendario', () => {
  test.use({ serviceWorkers: 'block' });

  test('actualiza kcal al cambiar ES→EN→ES sin recargar la app', async ({ page }) => {
    const appOrigin = new URL(test.info().project.use.baseURL!).origin;
    const browserErrors: string[] = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      const location = message.location().url;
      if (
        message.type() === 'error' &&
        location.length > 0 &&
        new URL(location).origin === appOrigin
      ) {
        browserErrors.push(message.text());
      }
    });
    page.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? '';
      if (new URL(request.url()).origin === appOrigin && !failure.includes('ERR_ABORTED')) {
        browserErrors.push(`${request.url()} ${failure}`);
      }
    });
    await page.route(/^https:\/\/fonts\.googleapis\.com\/.*/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    );

    await registerAndGoto(page, '/calendar', 'calendar-number-locale');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    const recipe = await post<{ id: string }>(page, '/api/recipes', {
      name: 'Locale QA recipe',
      difficulty: 'easy',
      servings: 1,
      calories: 1450,
      ingredients: [{ name: 'Locale QA ingredient', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Synthetic calendar fixture.' }]
    });
    expect(recipe.status, JSON.stringify(recipe.body)).toBe(201);
    let mealId = '';

    try {
      const meal = await post<{ id: string }>(page, '/api/calendar/meals', {
        date: await localToday(page),
        mealType: 'lunch',
        recipeId: recipe.body.data.id,
        servings: 1
      });
      expect(meal.status, JSON.stringify(meal.body)).toBe(201);
      mealId = meal.body.data.id;
      await page.reload();
      await expect(page.locator('h1.calendar__title')).toBeVisible();

      const energyValue = page
        .locator('.cal-strip__item')
        .filter({ hasText: /Energía|Energy/ })
        .locator('.cal-strip__value');
      await expect(energyValue).toContainText('1.450');

      await navigateInApp(page, '/settings');
      await page.locator('[data-test="settings-lang-en"]').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await navigateInApp(page, '/calendar');
      await expect(energyValue).toContainText('1,450');
      await expect(energyValue).not.toContainText('1.450');

      await selectCalendarView(page, 'month', 'Month');
      await expect(page).toHaveURL(/[?&]view=month/);
      const viewportWidth = page.viewportSize()?.width ?? 0;
      await page.setViewportSize(
        viewportWidth < 1024 ? { width: 393, height: 851 } : { width: 1440, height: 900 }
      );
      await expect(energyValue).toContainText('1,450');
      if (viewportWidth >= 768) {
        const todayCell = page.locator('.cal-cell').filter({ hasText: 'Locale QA recipe' });
        await expect(todayCell.locator('.cal-cell__kcal')).toHaveText('1,450');
      }
      const width = page.viewportSize()?.width ?? 0;
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      await screenshotCalendar(page);

      await navigateInApp(page, '/settings');
      await page.locator('[data-test="settings-lang-es"]').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
      await navigateInApp(page, '/calendar');
      await expect(energyValue).toContainText('1.450');
      await expect(energyValue).not.toContainText('1,450');

      expect(browserErrors).toEqual([]);
    } finally {
      if (mealId) await deleteOwnFixture(page, `/api/calendar/meals/${mealId}`);
      await deleteOwnFixture(page, `/api/recipes/${recipe.body.data.id}`);
    }
  });
});
