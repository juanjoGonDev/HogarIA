import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { selectCalendarView } from './helpers/calendar-ui';

function isoAfterToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

async function waitForCalendarStable(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const currentDocument = document as Document & { activeViewTransition?: unknown };
    return !currentDocument.activeViewTransition;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

async function openDay(page: Page, date: string): Promise<void> {
  await selectCalendarView(page, 'day', 'Día');
  await page.locator('input[type="date"]').fill(date);
  await expect(page.locator('input[type="date"]')).toHaveValue(date);
  await waitForCalendarStable(page);
}

async function addMeal(page: Page, title: string): Promise<void> {
  await page.locator('[data-test="timeline-add-meal"]').first().click();
  await page.locator('#meal-custom').fill(title);
  await page
    .locator('.meal-form__actions')
    .getByRole('button', { name: 'Añadir', exact: true })
    .click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}

test('una respuesta tardía no reemplaza las comidas del rango visible', async ({
  page
}, testInfo) => {
  const pageErrors: string[] = [];
  const appOrigin = new URL(process.env.E2E_BASE_URL!).origin;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.location().url.startsWith(appOrigin)) {
      pageErrors.push(message.text());
    }
  });

  await registerAndGoto(page, '/calendar', 'calendar-range-race');
  await expect(page.locator('h1.calendar__title')).toBeVisible();

  const staleDate = isoAfterToday(1);
  const visibleDate = isoAfterToday(2);
  const staleTitle = 'QA comida rango anterior';
  const visibleTitle = 'QA comida rango visible';

  await openDay(page, staleDate);
  await addMeal(page, staleTitle);
  await openDay(page, visibleDate);
  await addMeal(page, visibleTitle);

  let releaseStale!: () => void;
  let markStaleStarted!: () => void;
  let markStaleCompleted!: () => void;
  const staleRelease = new Promise<void>((resolve) => (releaseStale = resolve));
  const staleStarted = new Promise<void>((resolve) => (markStaleStarted = resolve));
  const staleCompleted = new Promise<void>((resolve) => (markStaleCompleted = resolve));
  let delayed = false;
  await page.route(/\/api\/calendar\/range(?:\?|$)/, async (route) => {
    const requestedDate = new URL(route.request().url()).searchParams.get('startDate');
    if (requestedDate === staleDate && !delayed) {
      delayed = true;
      const response = await route.fetch();
      const body = await response.body();
      markStaleStarted();
      await staleRelease;
      await route.fulfill({ response, body });
      markStaleCompleted();
      return;
    }
    await route.continue();
  });

  try {
    await openDay(page, staleDate);
    await staleStarted;
    const currentResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/calendar/range' &&
        url.searchParams.get('startDate') === visibleDate &&
        response.ok()
      );
    });
    await openDay(page, visibleDate);
    await currentResponse;
    await expect(page.getByRole('button', { name: visibleTitle, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: staleTitle, exact: true })).toHaveCount(0);
  } finally {
    releaseStale();
  }
  await staleCompleted;
  await waitForCalendarStable(page);
  await expect(page.getByRole('button', { name: visibleTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: staleTitle, exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  const toastCloseButtons = page.locator('.toast__close');
  while ((await toastCloseButtons.count()) > 0) await toastCloseButtons.first().click();

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `${testInfo.project.name}-calendar-range-latest.png`),
      fullPage: false
    });
  }
});
