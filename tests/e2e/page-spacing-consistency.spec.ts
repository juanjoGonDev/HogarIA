import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

import { expect, test } from './fixtures';
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

const PRIVATE_PAGE_ROOTS = [
  { path: '/dashboard', selector: 'app-dashboard > .dashboard', name: 'dashboard' },
  { path: '/recipes', selector: 'app-recipes > .recipes', name: 'recipes' },
  { path: '/pantry', selector: 'app-pantry > .pantry', name: 'pantry' },
  { path: '/calendar', selector: 'app-calendar > .calendar', name: 'calendar' },
  { path: '/shopping', selector: 'app-shopping-lists > .tray', name: 'shopping' },
  { path: '/receipts', selector: 'app-receipts > .tickets', name: 'receipts' },
  { path: '/logs', selector: 'app-logs > .logs-page', name: 'logs' }
];

test('las vistas privadas comparten el mismo padding vertical de contenido', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/dashboard', 'UI page spacing');
  const mismatches: string[] = [];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);

    for (const root of PRIVATE_PAGE_ROOTS) {
      await page.goto(root.path);
      const element = page.locator(root.selector);
      await expect(element, `${root.path} debe renderizar su raíz`).toBeVisible();

      const padding = await element.evaluate((node) => {
        const style = getComputedStyle(node);
        const frame = getComputedStyle(node.closest('app-page-container')!);
        return {
          blockStart: Number.parseFloat(style.paddingBlockStart),
          blockEnd: Number.parseFloat(style.paddingBlockEnd),
          inlineStart: Number.parseFloat(frame.paddingInlineStart),
          inlineEnd: Number.parseFloat(frame.paddingInlineEnd)
        };
      });

      if (
        Math.abs(padding.blockStart - padding.inlineStart) > 1 ||
        Math.abs(padding.blockEnd - padding.inlineEnd) > 1 ||
        Math.abs(padding.inlineStart - padding.inlineEnd) > 1
      ) {
        mismatches.push(
          `${root.path} @ ${viewport.width}×${viewport.height}: block ${padding.blockStart}/${padding.blockEnd}px, inline ${padding.inlineStart}/${padding.inlineEnd}px`
        );
      }

      const documentWidth = await page.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      );
      const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
      if (documentWidth > viewportWidth + 1) {
        mismatches.push(
          `${root.path} @ ${viewport.width}×${viewport.height}: overflow horizontal ${documentWidth}px > ${viewportWidth}px`
        );
      }

      const captureDirectory = process.env.E2E_SCREENSHOT_DIR;
      const shouldCaptureDesktop = testInfo.project.name === 'chromium' && viewport.width === 1440;
      const shouldCaptureMobile =
        testInfo.project.name === 'mobile-chrome' && viewport.width === 393;
      if (captureDirectory && (shouldCaptureDesktop || shouldCaptureMobile)) {
        const screenshotPath = join(
          captureDirectory,
          `${root.name}-${shouldCaptureDesktop ? 'desktop' : 'mobile'}.png`
        );
        mkdirSync(dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
      }
    }
  }

  expect(mismatches, 'El gutter del main content debe ser idéntico en ambos ejes').toEqual([]);
});
