import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const VIEWPORTS = [
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

const PAGE_HEADINGS = [
  { route: '/dashboard', selector: '.dashboard__title', name: 'dashboard' },
  { route: '/account', selector: '.account__title', name: 'account' },
  { route: '/preferences', selector: '.preferences__title', name: 'preferences' },
  { route: '/shopping', selector: '.tray__title', name: 'shopping' }
] as const;

const SHARED_STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'color',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInlineStart',
  'marginInlineEnd',
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInlineStart',
  'paddingInlineEnd',
  'borderBlockStartWidth',
  'borderBlockEndWidth',
  'borderInlineStartWidth',
  'borderInlineEndWidth',
  'borderBlockStartStyle',
  'borderBlockEndStyle',
  'borderInlineStartStyle',
  'borderInlineEndStyle',
  'borderBlockStartColor',
  'borderBlockEndColor',
  'borderInlineStartColor',
  'borderInlineEndColor',
  'borderRadius'
] as const;

type HeadingStyle = Record<(typeof SHARED_STYLE_KEYS)[number], string>;
type HeadingGeometry = { style: HeadingStyle; height: number; lineCount: number };

async function readHeadingGeometry(page: Page, selector: string): Promise<HeadingGeometry> {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const keys = [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'color',
      'marginBlockStart',
      'marginBlockEnd',
      'marginInlineStart',
      'marginInlineEnd',
      'paddingBlockStart',
      'paddingBlockEnd',
      'paddingInlineStart',
      'paddingInlineEnd',
      'borderBlockStartWidth',
      'borderBlockEndWidth',
      'borderInlineStartWidth',
      'borderInlineEndWidth',
      'borderBlockStartStyle',
      'borderBlockEndStyle',
      'borderInlineStartStyle',
      'borderInlineEndStyle',
      'borderBlockStartColor',
      'borderBlockEndColor',
      'borderInlineStartColor',
      'borderInlineEndColor',
      'borderRadius'
    ] as const;
    const computed = Object.fromEntries(keys.map((key) => [key, style[key]]));
    const range = document.createRange();
    range.selectNodeContents(element);

    return {
      style: computed as HeadingStyle,
      height: Number(rect.height.toFixed(2)),
      lineCount: Math.max(1, range.getClientRects().length)
    };
  });
}

test('los títulos principales comparten geometría tipográfica en sus vistas', async ({ page }) => {
  await registerAndGoto(page, '/dashboard', 'qa-page-headings');
  const screenshotDirectory = resolve(process.cwd(), '.e2e-screenshots/qa-page-headings-20261008');
  mkdirSync(screenshotDirectory, { recursive: true });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    let reference: HeadingStyle | undefined;
    let referenceName = '';

    for (const heading of PAGE_HEADINGS) {
      if (!page.url().includes(heading.route)) {
        await page.goto(heading.route, { waitUntil: 'domcontentloaded' });
      }

      const title = page.locator(heading.selector);
      await expect(title, `${heading.route} debe mostrar su h1`).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(title).toBeVisible();
      await expect(title).not.toHaveText('');

      const geometry = await readHeadingGeometry(page, heading.selector);
      const lineHeight = Number.parseFloat(geometry.style.lineHeight);
      expect(
        Math.abs(geometry.height - lineHeight * geometry.lineCount),
        `${heading.name} debe medir su line-height por ${geometry.lineCount} líneas a ${viewport.width}px`
      ).toBeLessThanOrEqual(1);

      if (!reference) {
        reference = geometry.style;
        referenceName = heading.name;
      } else {
        expect(
          geometry.style,
          `${heading.name} debe compartir estilo de título con ${referenceName} a ${viewport.width}px`
        ).toEqual(reference);
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(overflow, `${heading.route} no debe desbordar a ${viewport.width}px`).toBe(false);

      if (
        (viewport.width === 393 && viewport.height === 851) ||
        (viewport.width === 1440 && viewport.height === 900)
      ) {
        await page.screenshot({
          path: resolve(
            screenshotDirectory,
            `${heading.name}-${viewport.width}x${viewport.height}-${test.info().project.name}.png`
          ),
          animations: 'disabled'
        });
      }
    }
  }
});
