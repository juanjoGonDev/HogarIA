import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { selectCalendarView } from './helpers/calendar-ui';

interface ViewportCase {
  label: string;
  width: number;
  height: number;
}

interface HeaderGeometry {
  viewport: { width: number; height: number; scrollWidth: number; scrollX: number };
  panel: {
    clientWidth: number;
    scrollWidth: number;
    scrollLeft: number;
    left: number;
    right: number;
  };
  header: { clientWidth: number; scrollWidth: number; left: number; right: number };
  groups: Array<{ selector: string; left: number; right: number }>;
}

const viewports: ViewportCase[] = [
  { label: 'mobile-min', width: 320, height: 568 },
  { label: 'mobile-standard', width: 393, height: 851 },
  { label: 'mobile-landscape', width: 568, height: 320 },
  { label: 'tablet-pre-breakpoint', width: 767, height: 1024 },
  { label: 'tablet-breakpoint', width: 768, height: 1024 },
  { label: 'desktop', width: 1440, height: 900 }
];

async function waitForCalendarPaint(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !(document as Document & { activeViewTransition?: unknown }).activeViewTransition
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

async function inspectHeader(page: Page): Promise<HeaderGeometry> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.calendar__panel');
    const header = document.querySelector<HTMLElement>('.cal-top');
    if (!panel || !header) throw new Error('Calendar header/panel is missing');

    const panelRect = panel.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const selectors = ['.cal-top__title', '.cal-top__nav', '.cal-top__right'];
    const groups = selectors.flatMap((selector) => {
      const element = header.querySelector<HTMLElement>(selector);
      if (!element) return [];
      const rect = element.getBoundingClientRect();
      return [{ selector, left: rect.left, right: rect.right }];
    });

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollX: window.scrollX
      },
      panel: {
        clientWidth: panel.clientWidth,
        scrollWidth: panel.scrollWidth,
        scrollLeft: panel.scrollLeft,
        left: panelRect.left,
        right: panelRect.right
      },
      header: {
        clientWidth: header.clientWidth,
        scrollWidth: header.scrollWidth,
        left: headerRect.left,
        right: headerRect.right
      },
      groups
    };
  });
}

async function setViewportAndInspect(page: Page, viewport: ViewportCase, phase: string) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await waitForCalendarPaint(page);
  return { phase, label: viewport.label, geometry: await inspectHeader(page) };
}

function geometryProblems(
  observations: Array<{ phase: string; label: string; geometry: HeaderGeometry }>
): string[] {
  return observations.flatMap(({ phase, label, geometry }) => {
    const issues: string[] = [];
    const leftEdge = geometry.panel.left + 1;
    const rightEdge = geometry.panel.right - 1;
    if (
      geometry.viewport.scrollWidth > geometry.viewport.width + 1 ||
      geometry.viewport.scrollX !== 0
    ) {
      issues.push('document has horizontal overflow/scroll');
    }
    if (
      geometry.panel.scrollWidth > geometry.panel.clientWidth + 1 ||
      geometry.panel.scrollLeft !== 0
    ) {
      issues.push('calendar panel has hidden horizontal overflow/scroll');
    }
    if (geometry.header.scrollWidth > geometry.header.clientWidth + 1) {
      issues.push('calendar header content exceeds its width');
    }
    for (const group of geometry.groups) {
      if (group.left < leftEdge || group.right > rightEdge) {
        issues.push(`${group.selector} escapes the calendar panel`);
      }
    }
    return issues.map((issue) => `${phase}/${label}: ${issue}`);
  });
}

function dateAfterToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

test('la cabecera del calendario refluye y permanece accesible en móviles y escritorio', async ({
  page
}, testInfo) => {
  const appOrigin = new URL(process.env.E2E_BASE_URL!).origin;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.location().url.startsWith(appOrigin)) {
      pageErrors.push(message.text());
    }
  });

  await registerAndGoto(page, '/calendar', 'calendar-mobile-header');
  await expect(page.locator('h1.calendar__title')).toBeVisible();

  const observations = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${process.env.E2E_BASE_URL}/calendar`);
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await waitForCalendarPaint(page);
    observations.push({
      phase: 'initial',
      label: viewport.label,
      geometry: await inspectHeader(page)
    });
  }

  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto(`${process.env.E2E_BASE_URL}/calendar`);
  await expect(page.locator('h1.calendar__title')).toBeVisible();
  await waitForCalendarPaint(page);
  await selectCalendarView(page, 'day', 'Día');
  const dateInput = page.locator('.cal-jump input[type="date"]');
  const mealDate = dateAfterToday(4);
  await dateInput.fill(mealDate);
  await expect(dateInput).toHaveValue(mealDate);
  await page.locator('[data-test="timeline-add-meal"]').first().click();
  const mealTitle = 'QA calendario responsive';
  await page.locator('#meal-custom').fill(mealTitle);
  await page
    .locator('.meal-form__actions')
    .getByRole('button', { name: 'Añadir', exact: true })
    .click();
  await expect(page.getByRole('button', { name: mealTitle, exact: true })).toBeVisible();
  await waitForCalendarPaint(page);

  observations.push(await setViewportAndInspect(page, viewports[1], 'after-day-view-and-meal'));
  await selectCalendarView(page, 'week', 'Semana');
  await waitForCalendarPaint(page);
  observations.push(await setViewportAndInspect(page, viewports[1], 'after-week-view'));
  await selectCalendarView(page, 'month', 'Mes');
  await waitForCalendarPaint(page);
  observations.push(await setViewportAndInspect(page, viewports[1], 'after-month-view'));
  await selectCalendarView(page, 'day', 'Día');

  const previousPeriod = page.locator('.cal-top__nav button').first();
  const dateBeforeKeyboardNavigation = await page.locator('h1.calendar__title').innerText();
  await previousPeriod.focus();
  await expect(previousPeriod).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.locator('.cal-top__nav').getByRole('button', { name: 'Hoy', exact: true })
  ).toBeFocused();
  await previousPeriod.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('h1.calendar__title')).not.toHaveText(dateBeforeKeyboardNavigation);
  await waitForCalendarPaint(page);
  observations.push(await setViewportAndInspect(page, viewports[1], 'after-date-meal-keyboard'));

  await page
    .locator('.cal-top__right')
    .getByRole('button', { name: /Objetivo/ })
    .click();
  await expect(page.locator('.modal-overlay .modal__title')).toContainText(
    'Objetivos Nutricionales'
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  await page.locator('[data-test="event-add"]').click();
  await expect(page.locator('.modal-overlay .modal__title')).toContainText('Apuntar un evento');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  observations.push(await setViewportAndInspect(page, viewports[1], 'after-header-actions'));

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    const isMobile = testInfo.project.name === 'mobile-chrome';
    const screenshotPage = await page.context().newPage();
    await screenshotPage.setViewportSize(
      isMobile ? { width: 393, height: 851 } : { width: 1440, height: 900 }
    );
    await screenshotPage.goto(`${process.env.E2E_BASE_URL}/calendar?view=day&date=${mealDate}`);
    await expect(screenshotPage.locator('h1.calendar__title')).toBeVisible();
    await waitForCalendarPaint(screenshotPage);
    const toastCloseButtons = screenshotPage.locator('.toast__close');
    while ((await toastCloseButtons.count()) > 0) await toastCloseButtons.first().click();
    await screenshotPage.screenshot({
      path: join(
        screenshotDirectory,
        isMobile
          ? 'mobile-chrome-calendar-header-mobile.png'
          : 'chromium-calendar-header-desktop.png'
      )
    });
    await screenshotPage.close();
  }

  expect(geometryProblems(observations), JSON.stringify(observations, null, 2)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
