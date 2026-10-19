import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { createSyntheticRecipe, deleteSyntheticRecipe } from './helpers/recipe-fixtures';

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

type RecipeCardGeometry = {
  display: string;
  backgroundColor: string;
  borderStyle: string;
  borderWidth: string;
  borderRadius: string;
  overflow: string;
  imageRatio: number;
  contentPaddingBlockStart: string;
  contentPaddingBlockEnd: string;
  contentPaddingInlineStart: string;
  contentPaddingInlineEnd: string;
  titleFontFamily: string;
  titleFontSize: string;
  titleFontWeight: string;
  titleLineHeight: string;
  titleMarginBlockStart: string;
  titleMarginBlockEnd: string;
  metaFontFamily: string;
  metaFontSize: string;
  metaFontWeight: string;
  metaLineHeight: string;
  metaGap: string;
  metaAlignItems: string;
};

const SHARED_METRICS = [
  'display',
  'backgroundColor',
  'borderStyle',
  'borderWidth',
  'borderRadius',
  'overflow',
  'contentPaddingBlockStart',
  'contentPaddingBlockEnd',
  'contentPaddingInlineStart',
  'contentPaddingInlineEnd',
  'titleFontFamily',
  'titleFontSize',
  'titleFontWeight',
  'titleLineHeight',
  'titleMarginBlockStart',
  'titleMarginBlockEnd',
  'metaFontFamily',
  'metaFontSize',
  'metaFontWeight',
  'metaLineHeight',
  'metaGap',
  'metaAlignItems'
] as const satisfies readonly (keyof RecipeCardGeometry)[];

async function measureRecipeCard(card: Locator): Promise<RecipeCardGeometry> {
  return card.evaluate((element) => {
    const image = element.querySelector<HTMLElement>('.recipe-card__image');
    const content = element.querySelector<HTMLElement>('.recipe-card__content');
    const title = element.querySelector<HTMLElement>('.recipe-card__name');
    const meta = element.querySelector<HTMLElement>('.recipe-card__meta');
    if (!image || !content || !title || !meta) {
      throw new Error('La tarjeta sintética no expone la estructura compartida esperada');
    }

    const cardStyle = getComputedStyle(element);
    const imageRect = image.getBoundingClientRect();
    const contentStyle = getComputedStyle(content);
    const titleStyle = getComputedStyle(title);
    const metaStyle = getComputedStyle(meta);
    return {
      display: cardStyle.display,
      backgroundColor: cardStyle.backgroundColor,
      borderStyle: cardStyle.borderTopStyle,
      borderWidth: cardStyle.borderTopWidth,
      borderRadius: cardStyle.borderTopLeftRadius,
      overflow: cardStyle.overflow,
      imageRatio: imageRect.width / imageRect.height,
      contentPaddingBlockStart: contentStyle.paddingBlockStart,
      contentPaddingBlockEnd: contentStyle.paddingBlockEnd,
      contentPaddingInlineStart: contentStyle.paddingInlineStart,
      contentPaddingInlineEnd: contentStyle.paddingInlineEnd,
      titleFontFamily: titleStyle.fontFamily,
      titleFontSize: titleStyle.fontSize,
      titleFontWeight: titleStyle.fontWeight,
      titleLineHeight: titleStyle.lineHeight,
      titleMarginBlockStart: titleStyle.marginBlockStart,
      titleMarginBlockEnd: titleStyle.marginBlockEnd,
      metaFontFamily: metaStyle.fontFamily,
      metaFontSize: metaStyle.fontSize,
      metaFontWeight: metaStyle.fontWeight,
      metaLineHeight: metaStyle.lineHeight,
      metaGap: metaStyle.gap,
      metaAlignItems: metaStyle.alignItems
    };
  });
}

function metricMatches(left: string | number, right: string | number): boolean {
  if (left === right) return true;
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftPx = /^(-?\d+(?:\.\d+)?)px$/u.exec(left);
  const rightPx = /^(-?\d+(?:\.\d+)?)px$/u.exec(right);
  return Boolean(leftPx && rightPx && Math.abs(Number(leftPx[1]) - Number(rightPx[1])) <= 1);
}

async function waitForSettledLayout(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
      )
  );
}

async function expectNoDocumentOverflow(
  page: Page,
  route: 'dashboard' | 'recipes',
  viewport: (typeof VIEWPORTS)[number]
): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(
    dimensions.scroll,
    `${route} no debe desbordar a ${viewport.width}×${viewport.height}`
  ).toBeLessThanOrEqual(dimensions.client + 1);
}

async function captureCard(
  page: Page,
  card: Locator,
  route: 'dashboard' | 'recipes',
  viewport: (typeof VIEWPORTS)[number],
  testInfo: TestInfo
): Promise<void> {
  const directoryValue = process.env.E2E_SCREENSHOT_DIR;
  const isDesktopCapture = testInfo.project.name === 'chromium' && viewport.width === 1440;
  const isMobileCapture = testInfo.project.name === 'mobile-chrome' && viewport.width === 393;
  if (!directoryValue || (!isDesktopCapture && !isMobileCapture)) return;

  const directory = resolve(directoryValue);
  mkdirSync(directory, { recursive: true });
  await card.scrollIntoViewIfNeeded();
  await waitForSettledLayout(page);
  await page.screenshot({
    path: join(directory, `${route}-${isDesktopCapture ? 'desktop' : 'mobile'}.png`),
    fullPage: false,
    animations: 'disabled',
    scale: 'css'
  });
}

test('las tarjetas de receta comparten geometría entre Dashboard y catálogo', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/dashboard', 'Recipe card geometry');
  const recipe = await createSyntheticRecipe(page, { name: 'QA Recipe Card Geometry' });

  try {
    const measurements: Array<{
      viewport: (typeof VIEWPORTS)[number];
      dashboard: RecipeCardGeometry;
      recipes: RecipeCardGeometry;
    }> = [];

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard');
      const dashboardCard = page
        .locator('.recipes-grid .recipe-card')
        .filter({ hasText: recipe.name });
      await expect(dashboardCard).toHaveCount(1);
      await dashboardCard.scrollIntoViewIfNeeded();
      await waitForSettledLayout(page);
      const dashboard = await measureRecipeCard(dashboardCard);
      await expectNoDocumentOverflow(page, 'dashboard', viewport);
      await captureCard(page, dashboardCard, 'dashboard', viewport, testInfo);

      await page.goto(`/recipes?search=${encodeURIComponent(recipe.name)}`);
      await expect(page.locator('[data-test="recipe-search"]')).toHaveValue(recipe.name);
      const gridMode = page.getByRole('button', { name: 'Vista de cuadrícula' });
      if ((await gridMode.getAttribute('aria-pressed')) !== 'true') await gridMode.click();
      await expect(gridMode).toHaveAttribute('aria-pressed', 'true');
      const recipesCard = page
        .locator('.recipes__grid [data-test="recipe-card"]')
        .filter({ hasText: recipe.name });
      await expect(recipesCard).toHaveCount(1);
      await recipesCard.scrollIntoViewIfNeeded();
      await waitForSettledLayout(page);
      const recipes = await measureRecipeCard(recipesCard);
      await expectNoDocumentOverflow(page, 'recipes', viewport);
      await captureCard(page, recipesCard, 'recipes', viewport, testInfo);

      measurements.push({ viewport, dashboard, recipes });
    }

    const mismatches = measurements.flatMap(({ viewport, dashboard, recipes: catalog }) => {
      const sharedMismatches = SHARED_METRICS.flatMap((metric) =>
        metricMatches(dashboard[metric], catalog[metric])
          ? []
          : [
              `${viewport.width}×${viewport.height} ${metric}: Dashboard ${dashboard[metric]} vs Catálogo ${catalog[metric]}`
            ]
      );
      return Math.abs(dashboard.imageRatio - 1.6) <= 0.02 &&
        Math.abs(catalog.imageRatio - 1.6) <= 0.02
        ? sharedMismatches
        : [
            ...sharedMismatches,
            `${viewport.width}×${viewport.height} relación de imagen: Dashboard ${dashboard.imageRatio} vs Catálogo ${catalog.imageRatio}`
          ];
    });

    expect(mismatches, JSON.stringify(mismatches, null, 2)).toEqual([]);
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
