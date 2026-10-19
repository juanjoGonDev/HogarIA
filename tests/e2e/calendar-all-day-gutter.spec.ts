import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

interface ViewportCase {
  label: string;
  width: number;
  height: number;
}

interface GutterGeometry {
  viewport: { width: number; height: number; scrollWidth: number; scrollX: number };
  panel: { clientWidth: number; scrollWidth: number };
  timeline: { left: number; right: number };
  gutter: { left: number; right: number; width: number; textLeft: number; textRight: number };
  tracks: { header: number; band: number; hours: number };
}

const viewports: ViewportCase[] = [
  { label: 'mobile-min', width: 320, height: 568 },
  { label: 'mobile-standard', width: 393, height: 851 },
  { label: 'mobile-landscape', width: 568, height: 320 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'desktop', width: 1440, height: 900 }
];

const date = '2026-10-03';

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

async function inspectGutter(page: Page): Promise<GutterGeometry> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.calendar__panel');
    const timeline = document.querySelector<HTMLElement>('.tl');
    const bandGutter = document.querySelector<HTMLElement>('.tl__gutter--band');
    const head = document.querySelector<HTMLElement>('.tl__head');
    const band = document.querySelector<HTMLElement>('.tl__band');
    const hours = document.querySelector<HTMLElement>('.tl__inner');
    if (!panel || !timeline || !bandGutter || !head || !band || !hours) {
      throw new Error('Timeline gutter elements are missing');
    }

    const textRange = document.createRange();
    textRange.selectNodeContents(bandGutter);
    const textRect = textRange.getBoundingClientRect();
    const gutterRect = bandGutter.getBoundingClientRect();
    const timelineRect = timeline.getBoundingClientRect();
    const firstTrack = (element: HTMLElement) =>
      Number.parseFloat(getComputedStyle(element).gridTemplateColumns.split(' ')[0]);

    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollX: window.scrollX
      },
      panel: { clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth },
      timeline: { left: timelineRect.left, right: timelineRect.right },
      gutter: {
        left: gutterRect.left,
        right: gutterRect.right,
        width: gutterRect.width,
        textLeft: textRect.left,
        textRight: textRect.right
      },
      tracks: { header: firstTrack(head), band: firstTrack(band), hours: firstTrack(hours) }
    };
  });
}

function gutterProblems(
  observations: Array<{ view: string; viewport: string; geometry: GutterGeometry }>
): string[] {
  return observations.flatMap(({ view, viewport, geometry }) => {
    const problems: string[] = [];
    if (
      geometry.gutter.textLeft < geometry.gutter.left ||
      geometry.gutter.textRight > geometry.gutter.right
    ) {
      problems.push('all-day label escapes its gutter track');
    }
    if (new Set([geometry.tracks.header, geometry.tracks.band, geometry.tracks.hours]).size !== 1) {
      problems.push('header, all-day band, and hour scale gutters are misaligned');
    }
    if (geometry.panel.scrollWidth > geometry.panel.clientWidth + 1) {
      problems.push('calendar panel has horizontal overflow');
    }
    if (
      geometry.viewport.scrollWidth > geometry.viewport.width + 1 ||
      geometry.viewport.scrollX !== 0
    ) {
      problems.push('document has horizontal overflow/scroll');
    }
    return problems.map((problem) => `${view}/${viewport}: ${problem}`);
  });
}

test('la etiqueta de eventos de todo el día cabe en la columna común del timeline', async ({
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

  await registerAndGoto(page, '/calendar', 'calendar-all-day-gutter');
  await expect(page.locator('h1.calendar__title')).toBeVisible();

  const observations = [];
  for (const view of ['day', 'week']) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${process.env.E2E_BASE_URL}/calendar?view=${view}&date=${date}`);
      await expect(page.locator('h1.calendar__title')).toBeVisible();
      await expect(page.locator('.tl__gutter--band')).toHaveText('Todo el día');
      await waitForCalendarPaint(page);
      observations.push({ view, viewport: viewport.label, geometry: await inspectGutter(page) });
    }
  }

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    const isMobile = testInfo.project.name === 'mobile-chrome';
    const screenshotPage = await page.context().newPage();
    await screenshotPage.setViewportSize(
      isMobile ? { width: 393, height: 851 } : { width: 1440, height: 900 }
    );
    await screenshotPage.goto(`${process.env.E2E_BASE_URL}/calendar?view=day&date=${date}`);
    await expect(screenshotPage.locator('.tl__gutter--band')).toHaveText('Todo el día');
    await waitForCalendarPaint(screenshotPage);
    await screenshotPage.screenshot({
      path: join(
        screenshotDirectory,
        isMobile
          ? 'mobile-chrome-calendar-all-day-gutter.png'
          : 'chromium-calendar-all-day-gutter.png'
      )
    });
    await screenshotPage.close();
  }

  expect(gutterProblems(observations), JSON.stringify(observations, null, 2)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
