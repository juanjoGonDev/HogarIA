import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import type { Page } from './fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 },
  { width: 767, height: 1024 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
];

type ButtonGeometry = Record<string, string | number>;

async function measureGeometry(page: Page, selector: string): Promise<ButtonGeometry> {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const button = element as HTMLButtonElement;
      const style = getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return {
        height: Number(rect.height.toFixed(2)),
        paddingBlockStart: style.paddingBlockStart,
        paddingBlockEnd: style.paddingBlockEnd,
        paddingInlineStart: style.paddingInlineStart,
        paddingInlineEnd: style.paddingInlineEnd,
        marginBlockStart: style.marginBlockStart,
        marginBlockEnd: style.marginBlockEnd,
        marginInlineStart: style.marginInlineStart,
        marginInlineEnd: style.marginInlineEnd,
        gap: style.gap,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        borderStyle: style.borderTopStyle,
        borderWidth: style.borderTopWidth,
        borderRadius: style.borderTopLeftRadius,
        boxSizing: style.boxSizing
      };
    });
}

test('los botones compartidos mantienen la misma geometría sin importar su tamaño nominal', async ({
  page
}, testInfo) => {
  test.setTimeout(240_000);

  await page.route(/^https:\/\/fonts\.googleapis\.com\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );

  const observations: Array<{
    viewport: (typeof VIEWPORTS)[number];
    large: ButtonGeometry;
    medium: ButtonGeometry;
    small: ButtonGeometry;
  }> = [];
  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  const mobileProject = testInfo.project.name === 'mobile-chrome';
  const capture = async (route: string, viewport: (typeof VIEWPORTS)[number]) => {
    const captureViewport = mobileProject ? viewport.width === 393 : viewport.width === 1440;
    if (!screenshotDirectory || !captureViewport) return;
    mkdirSync(screenshotDirectory, { recursive: true });
    const device = mobileProject ? 'pixel' : 'desktop';
    const path = join(
      screenshotDirectory,
      `shared-button-${route}-${device}-${viewport.width}.png`
    );
    if (route === 'logs') {
      await page.locator('.logs-toolbar').screenshot({ path, animations: 'disabled' });
    } else {
      await page.screenshot({ path, animations: 'disabled' });
    }
  };
  const geometryMismatches: string[] = [];

  await page.goto('/auth/login');
  for (const [index, viewport] of VIEWPORTS.entries()) {
    await page.setViewportSize(viewport);
    const largeButton = page.locator('button.btn--lg').first();
    await expect(largeButton).toBeVisible();
    observations.push({
      viewport,
      large: await measureGeometry(page, 'button.btn--lg'),
      medium: {},
      small: {}
    });

    await capture('login', viewport);
    if (viewport.width === 1440) {
      const beforeHover = await largeButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const transform = getComputedStyle(element).transform;
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transform
        };
      });
      await largeButton.hover();
      await page.waitForTimeout(180);
      const afterHover = await largeButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const transform = getComputedStyle(element).transform;
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          transform
        };
      });
      if (JSON.stringify(beforeHover) !== JSON.stringify(afterHover)) {
        geometryMismatches.push(
          `hover cambia la caja del botón primario: ${JSON.stringify(beforeHover)} -> ${JSON.stringify(afterHover)}`
        );
      }
    }
  }

  await registerWithHousehold(page, '/dashboard', 'UI geometry buttons');

  for (const [index, viewport] of VIEWPORTS.entries()) {
    await page.setViewportSize(viewport);

    await page.goto('/recipes');
    const mediumButton = page.locator('button.btn--md').first();
    await expect(mediumButton).toBeVisible();
    const medium = await measureGeometry(page, 'button.btn--md');
    await capture('recipes', viewport);

    await page.goto('/logs');
    const smallButton = page.locator('button.btn--sm').first();
    await expect(smallButton).toBeVisible();
    const small = await measureGeometry(page, 'button.btn--sm');
    await capture('logs', viewport);

    observations[index].medium = medium;
    observations[index].small = small;
  }

  const dialogObservations: Array<{
    viewport: (typeof VIEWPORTS)[number];
    geometry: ButtonGeometry;
  }> = [];
  for (const viewport of VIEWPORTS.filter(({ width }) => width === 393 || width === 1440)) {
    await page.setViewportSize(viewport);
    await page.goto('/ai-config');
    await page
      .getByRole('button', { name: /Agregar configuración/i })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });
    const dialogButton = dialog.locator('button.btn--md').first();
    await expect(dialogButton).toBeVisible();
    dialogObservations.push({
      viewport,
      geometry: await measureGeometry(page, 'app-modal button.btn--md')
    });
    await capture('ai-config-dialog', viewport);
  }

  geometryMismatches.push(
    ...observations.flatMap(({ viewport, large, medium, small }) => {
      const variants = { sm: small, md: medium, lg: large };
      return (Object.keys(large) as Array<keyof ButtonGeometry>).flatMap((key) =>
        Object.entries(variants).flatMap(([variant, geometry]) =>
          geometry[key] === large[key]
            ? []
            : [
                `${viewport.width}×${viewport.height} ${variant} ${key}: ${geometry[key]} vs ${large[key]}`
              ]
        )
      );
    })
  );

  for (const { viewport, geometry } of dialogObservations) {
    const reference = observations.find((item) => item.viewport.width === viewport.width)?.medium;
    if (!reference) {
      geometryMismatches.push(`no existe botón md de referencia a ${viewport.width}px`);
      continue;
    }
    for (const key of Object.keys(reference) as Array<keyof ButtonGeometry>) {
      if (geometry[key] !== reference[key]) {
        geometryMismatches.push(
          `${viewport.width}px dialog ${key}: ${geometry[key]} vs ${reference[key]}`
        );
      }
    }
  }

  expect(geometryMismatches, JSON.stringify(observations, null, 2)).toEqual([]);
});
