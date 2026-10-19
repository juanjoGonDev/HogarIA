import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { TestInfo } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 600, height: 900 },
  { width: 601, height: 900 },
  { width: 1440, height: 900 }
];

const STAT_CARD_METRICS = [
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInlineStart',
  'paddingInlineEnd',
  'gap',
  'alignItems',
  'valueFontFamily',
  'valueFontSize',
  'valueFontWeight',
  'valueLineHeight',
  'labelFontFamily',
  'labelFontSize',
  'labelFontWeight',
  'labelLineHeight'
] as const;

type StatCardMetric = (typeof STAT_CARD_METRICS)[number];
type StatCardGeometry = Record<StatCardMetric, string>;

async function measureStatCards(page: Page): Promise<StatCardGeometry[]> {
  return page.locator('.stat-card').evaluateAll((cards) =>
    cards.map((card) => {
      const style = getComputedStyle(card);
      const value = card.querySelector<HTMLElement>('.stat-card__value');
      const label = card.querySelector<HTMLElement>('.stat-card__label');
      if (!value || !label) throw new Error('La tarjeta estadística perdió valor o etiqueta');

      const valueStyle = getComputedStyle(value);
      const labelStyle = getComputedStyle(label);
      return {
        paddingBlockStart: style.paddingBlockStart,
        paddingBlockEnd: style.paddingBlockEnd,
        paddingInlineStart: style.paddingInlineStart,
        paddingInlineEnd: style.paddingInlineEnd,
        gap: style.gap,
        alignItems: style.alignItems,
        valueFontFamily: valueStyle.fontFamily,
        valueFontSize: valueStyle.fontSize,
        valueFontWeight: valueStyle.fontWeight,
        valueLineHeight: valueStyle.lineHeight,
        labelFontFamily: labelStyle.fontFamily,
        labelFontSize: labelStyle.fontSize,
        labelFontWeight: labelStyle.fontWeight,
        labelLineHeight: labelStyle.lineHeight
      };
    })
  );
}

function metricMatches(left: string, right: string): boolean {
  if (left === right) return true;
  const leftMatch = /^(-?\d+(?:\.\d+)?)px$/u.exec(left);
  const rightMatch = /^(-?\d+(?:\.\d+)?)px$/u.exec(right);
  return Boolean(
    leftMatch && rightMatch && Math.abs(Number(leftMatch[1]) - Number(rightMatch[1])) <= 1
  );
}

async function captureSyntheticRoute(
  page: Page,
  route: 'dashboard' | 'pantry',
  viewport: { width: number; height: number },
  testInfo: TestInfo
): Promise<void> {
  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  const isDesktopCapture = testInfo.project.name === 'chromium' && viewport.width === 1440;
  const isMobileCapture = testInfo.project.name === 'mobile-chrome' && viewport.width === 393;
  if (!screenshotDirectory || (!isDesktopCapture && !isMobileCapture)) return;

  const directory = resolve(screenshotDirectory);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${route}-${isDesktopCapture ? 'desktop' : 'mobile'}.png`),
    fullPage: false,
    animations: 'disabled',
    scale: 'css'
  });
}

async function collectDocumentOverflow(
  page: Page,
  route: 'dashboard' | 'pantry',
  viewport: { width: number; height: number }
): Promise<string | undefined> {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  if (dimensions.scroll <= dimensions.client + 1) return undefined;
  return `${route} ${viewport.width}×${viewport.height} overflow: ${dimensions.scroll}px > ${dimensions.client}px`;
}

test('las tarjetas estadísticas conservan geometría de contenido en Dashboard y Despensa', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/dashboard', 'Stats card geometry');
  await expect(page.locator('.dashboard__stats .stat-card')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);

  const dashboardMeasurements: Array<{
    viewport: (typeof VIEWPORTS)[number];
    cards: StatCardGeometry[];
  }> = [];
  const overflowMismatches: string[] = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.dashboard__stats .stat-card').first()).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
        )
    );
    dashboardMeasurements.push({ viewport, cards: await measureStatCards(page) });
    const dashboardOverflow = await collectDocumentOverflow(page, 'dashboard', viewport);
    if (dashboardOverflow) overflowMismatches.push(dashboardOverflow);
    await captureSyntheticRoute(page, 'dashboard', viewport, testInfo);
  }

  await page.goto('/pantry');
  await expect(page.locator('.pantry__stats .stat-card')).toHaveCount(3);
  const pantryMeasurements: typeof dashboardMeasurements = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.pantry__stats .stat-card').first()).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
        )
    );
    pantryMeasurements.push({ viewport, cards: await measureStatCards(page) });
    const pantryOverflow = await collectDocumentOverflow(page, 'pantry', viewport);
    if (pantryOverflow) overflowMismatches.push(pantryOverflow);
    await captureSyntheticRoute(page, 'pantry', viewport, testInfo);
  }

  const mismatches = dashboardMeasurements.flatMap(({ viewport, cards }, index) => {
    const otherCards = pantryMeasurements[index].cards;
    const dashboardBaseline = cards[0];
    const allCards = [
      ...cards
        .slice(1)
        .map((card, cardIndex) => ({ route: 'Dashboard', card, cardIndex: cardIndex + 1 })),
      ...otherCards.map((card, cardIndex) => ({
        route: 'Despensa',
        card,
        cardIndex: cardIndex + 1
      }))
    ];
    return allCards.flatMap(({ route, card, cardIndex }) =>
      STAT_CARD_METRICS.flatMap((metric) =>
        metricMatches(dashboardBaseline[metric], card[metric])
          ? []
          : [
              `${viewport.width}×${viewport.height} tarjeta ${route} ${cardIndex + 1} ${metric}: ${card[metric]} vs Dashboard 1 ${dashboardBaseline[metric]}`
            ]
      )
    );
  });

  expect(
    [...mismatches, ...overflowMismatches],
    JSON.stringify(
      { dashboardMeasurements, pantryMeasurements, metricScope: STAT_CARD_METRICS },
      null,
      2
    )
  ).toEqual([]);
});
