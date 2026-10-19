import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { selectCalendarView } from './helpers/calendar-ui';

test.use({ timezoneId: 'Europe/Madrid' });

function madridDateAt(hour: number, minute: number): { iso: string; time: Date } {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const value = (type: string): string => dateParts.find((part) => part.type === type)?.value ?? '';
  const iso = `${value('year')}-${value('month')}-${value('day')}`;
  const offsetLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'longOffset'
  })
    .formatToParts(new Date(`${iso}T12:00:00Z`))
    .find((part) => part.type === 'timeZoneName')?.value;
  const offset = offsetLabel === 'GMT' ? '+00:00' : offsetLabel?.replace('GMT', '');
  if (!iso || !offset) throw new Error('Could not create a fixed Europe/Madrid test time.');
  return {
    iso,
    time: new Date(
      `${iso}T${`${hour}`.padStart(2, '0')}:${`${minute}`.padStart(2, '0')}:00${offset}`
    )
  };
}

function nextIsoDay(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

async function waitForCalendarStable(page: Page): Promise<void> {
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

async function expectCurrentHourVisible(page: Page): Promise<void> {
  await expect(page.locator('.tl__hour').filter({ hasText: '02:00' })).toHaveCount(1);
  const today = page.locator('.tl__col.is-today');
  await expect(today).toHaveCount(1);
  const line = today.locator('.tl__now');
  await expect(line).toBeVisible();
  const visibleInTimeline = await line.evaluate((element) => {
    const lineRect = element.getBoundingClientRect();
    const viewportRect = element.closest('.tl__scroll')?.getBoundingClientRect();
    return Boolean(
      viewportRect && lineRect.bottom >= viewportRect.top && lineRect.top <= viewportRect.bottom
    );
  });
  expect(
    visibleInTimeline,
    'La línea de ahora debe quedar dentro de la parte visible de la rejilla'
  ).toBe(true);
}

test('muestra y enfoca las horas de madrugada si hoy está visible, haya eventos o no', async ({
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

  const { iso, time } = madridDateAt(2, 8);
  const initialViewport = page.viewportSize();
  if (!initialViewport) throw new Error('The browser test needs an explicit viewport.');
  await registerAndGoto(page, '/calendar', 'calendar-early-hours');
  await page.clock.setFixedTime(time);
  await page.reload();
  await expect(page.locator('h1.calendar__title')).toBeVisible();
  expect(await page.evaluate(() => [new Date().getHours(), new Date().getMinutes()])).toEqual([
    2, 8
  ]);

  await selectCalendarView(page, 'week', 'Semana');
  await waitForCalendarStable(page);
  await expect(page.locator('[data-test="timeline-col"]')).toHaveCount(7);
  await expectCurrentHourVisible(page);

  const screenshotDirectory =
    process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-calendar-early-hours-1';
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, `${testInfo.project.name}-week-empty-0208.png`),
    fullPage: false
  });

  const viewports = [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 568, height: 320 },
    { width: 767, height: 1024 },
    { width: 768, height: 1024 },
    { width: 769, height: 1024 },
    { width: 1023, height: 768 },
    { width: 1024, height: 768 },
    { width: 1025, height: 768 },
    { width: 1440, height: 900 }
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectCurrentHourVisible(page);
    const noPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    );
    expect(
      noPageOverflow,
      `No debe haber overflow horizontal en ${viewport.width}×${viewport.height}`
    ).toBe(true);
  }

  await page.setViewportSize(initialViewport);
  const dayView = page.locator('[data-test="calendar-view-select"] .picker__trigger');
  await dayView.focus();
  await expect(dayView).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-test="calendar-view-select"]')).toHaveAttribute(
    'data-view',
    'day'
  );
  await waitForCalendarStable(page);
  await expectCurrentHourVisible(page);
  await page.locator('[data-test="event-add"]').click();
  await page.locator('#event-title').fill('Evento de prueba a las diez');
  await page.locator('#event-date').fill(iso);
  await page.locator('#event-start').fill('10:00');
  const saveEvent = page.locator('[data-test="event-save"]');
  await saveEvent.focus();
  await expect(saveEvent).toBeFocused();
  await page.keyboard.press('Enter');
  const event = page.locator('[data-test="timeline-block-event"]');
  await expect(event).toContainText('Evento de prueba a las diez');
  await expectCurrentHourVisible(page);
  await page.screenshot({
    path: join(screenshotDirectory, `${testInfo.project.name}-day-event-0208.png`),
    fullPage: false
  });

  await page.locator('input[type="date"]').fill(nextIsoDay(iso));
  await waitForCalendarStable(page);
  await expect(page.locator('.tl__col.is-today')).toHaveCount(0);
  await expect(page.locator('.tl__now')).toHaveCount(0);
  const midnightLabel = page.locator('.tl__hour').first();
  await expect(midnightLabel).toHaveText('00:00');
  const midnightFitsTimeline = await midnightLabel.evaluate((element) => {
    const label = element.getBoundingClientRect();
    const viewport = element.closest('.tl__scroll')?.getBoundingClientRect();
    return Boolean(viewport && label.top >= viewport.top && label.bottom <= viewport.bottom);
  });
  expect(
    midnightFitsTimeline,
    'La etiqueta 00:00 debe mostrarse completa cuando el día comienza a medianoche'
  ).toBe(true);
  await page.screenshot({
    path: join(screenshotDirectory, `${testInfo.project.name}-next-day-midnight.png`),
    fullPage: false
  });
  expect(pageErrors).toEqual([]);
});
