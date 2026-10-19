import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { AUTHENTICATED_ROUTES } from './helpers/route-layout-manifest';
import {
  collectVisualFamilyMeasurements,
  type VisualFamilyMeasurement
} from './helpers/visual-family-inventory';

type SharedButtonGeometry = Pick<
  VisualFamilyMeasurement,
  | 'route'
  | 'viewport'
  | 'classes'
  | 'rect'
  | 'padding'
  | 'margin'
  | 'gap'
  | 'font'
  | 'borderRadius'
  | 'borderWidth'
  | 'alignment'
>;

const GEOMETRY_KEYS = [
  'height',
  'padding',
  'margin',
  'gap',
  'font',
  'borderRadius',
  'borderWidth',
  'alignment'
] as const;

function isSharedTextButton(measurement: VisualFamilyMeasurement): boolean {
  if (measurement.family !== 'actions' || measurement.tag !== 'button') return false;
  const classes = new Set(measurement.classes.split(/\s+/));
  return (
    classes.has('btn') &&
    [...classes].some((className) => /^btn--(?:sm|md|lg)$/.test(className)) &&
    !classes.has('btn--icon')
  );
}

function buttonProfile(measurement: SharedButtonGeometry): 'standard' | 'touch-target' {
  return measurement.classes.split(/\s+/).includes('btn--touch-target')
    ? 'touch-target'
    : 'standard';
}

function geometryValue(measurement: SharedButtonGeometry, key: (typeof GEOMETRY_KEYS)[number]) {
  return key === 'height' ? measurement.rect.height : measurement[key];
}

function equivalentWithinOneCssPixel(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) <= 1;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equivalentWithinOneCssPixel(value, right[index]))
    );
  }
  if (typeof left === 'string' && typeof right === 'string') {
    const leftPx = /^(-?\d+(?:\.\d+)?)px$/.exec(left);
    const rightPx = /^(-?\d+(?:\.\d+)?)px$/.exec(right);
    if (leftPx && rightPx) return Math.abs(Number(leftPx[1]) - Number(rightPx[1])) <= 1;
  }
  return left === right;
}

function findSharedButtonGeometryDrifts(
  measurements: readonly VisualFamilyMeasurement[]
): string[] {
  const buttons = measurements.filter(isSharedTextButton);
  const viewports = [...new Set(buttons.map((button) => button.viewport))];
  const drifts: string[] = [];

  for (const viewport of viewports) {
    for (const profile of ['standard', 'touch-target'] as const) {
      const samples = buttons.filter(
        (button) => button.viewport === viewport && buttonProfile(button) === profile
      );
      const reference = samples[0];
      if (!reference) continue;

      for (const sample of samples) {
        if (sample.rect.height < 44) {
          drifts.push(
            `${viewport} ${sample.route}: ${profile} text action height ${sample.rect.height}px < 44px`
          );
        }
      }

      for (const sample of samples.slice(1)) {
        for (const key of GEOMETRY_KEYS) {
          const expected = geometryValue(reference, key);
          const actual = geometryValue(sample, key);
          if (!equivalentWithinOneCssPixel(expected, actual)) {
            drifts.push(
              `${viewport} ${profile} ${key}: ${reference.route}=${JSON.stringify(expected)} vs ${sample.route}=${JSON.stringify(actual)}`
            );
          }
        }
      }
    }
  }

  return drifts;
}

function sharedButtonSample(
  route: string,
  overrides: Partial<SharedButtonGeometry> = {}
): VisualFamilyMeasurement {
  return {
    route,
    shell: 'private',
    state: 'route-default',
    viewport: '393x851',
    family: 'actions',
    tag: 'button',
    classes: 'btn btn--md btn--primary',
    rect: { x: 0, y: 0, width: 100, height: 44 },
    padding: [8, 16, 8, 16],
    margin: [0, 0, 0, 0],
    gap: ['normal', '8px'],
    font: ['16px', '16px', '500'],
    borderRadius: '8px',
    borderWidth: ['1px', '1px', '1px', '1px'],
    alignment: ['center', 'center'],
    ...overrides
  };
}

test('el comparador permite ancho natural/variantes y detecta drift geométrico', () => {
  const naturalWidth = sharedButtonSample('/recipes', {
    classes: 'btn btn--outline btn--lg',
    rect: { x: 200, y: 500, width: 288, height: 44 }
  });
  const tinyRounding = sharedButtonSample('/shopping', {
    rect: { x: 2, y: 10, width: 80, height: 44.5 },
    padding: [8.5, 16, 8, 16]
  });
  const iconOnly = sharedButtonSample('/pantry', {
    classes: 'btn btn--icon btn--primary',
    rect: { x: 0, y: 0, width: 44, height: 44 }
  });
  const touchTarget = sharedButtonSample('/account', {
    classes: 'btn btn--md btn--primary btn--touch-target',
    rect: { x: 0, y: 0, width: 120, height: 48 }
  });
  const otherTouchTarget = sharedButtonSample('/pantry', {
    classes: 'btn btn--md btn--secondary btn--touch-target',
    rect: { x: 0, y: 0, width: 120, height: 48 }
  });

  expect(
    findSharedButtonGeometryDrifts([
      naturalWidth,
      tinyRounding,
      iconOnly,
      touchTarget,
      otherTouchTarget
    ])
  ).toEqual([]);
  expect(
    findSharedButtonGeometryDrifts([
      naturalWidth,
      sharedButtonSample('/shopping', { rect: { x: 0, y: 0, width: 100, height: 46 } })
    ])
  ).toContain('393x851 standard height: /recipes=44 vs /shopping=46');
  expect(
    findSharedButtonGeometryDrifts([
      touchTarget,
      sharedButtonSample('/pantry', {
        classes: 'btn btn--md btn--secondary btn--touch-target',
        rect: { x: 0, y: 0, width: 120, height: 50 }
      })
    ])
  ).toContain('393x851 touch-target height: /account=48 vs /pantry=50');
});

test('app-button textual actions keep shared geometry across routed views', async ({
  page
}, testInfo) => {
  test.setTimeout(240_000);
  const selectedPaths = [
    '/account',
    '/ai-config',
    '/pantry',
    '/preferences',
    '/recipes',
    '/shopping'
  ];
  const routes = selectedPaths.map((path) => {
    const route = AUTHENTICATED_ROUTES.find((candidate) => candidate.path === path);
    if (!route?.pageRoot)
      throw new Error(`Falta ruta con raíz declarada en el manifiesto: ${path}`);
    return route;
  });
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  const aiConnectionRequests: string[] = [];
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue();
    if (url.hostname === 'fonts.googleapis.com') {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    externalRequests.push(url.origin);
    return route.abort();
  });
  page.on('pageerror', (error) => pageErrors.push(error.name));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/ai/test-connection') aiConnectionRequests.push(url.pathname);
  });
  await registerAndGoto(page, routes[0].path, 'QA shared button geometry');

  const measurements: VisualFamilyMeasurement[] = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 393, height: 851 }
  ]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.locator(route.pageRoot!)).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator('button.btn--sm:visible, button.btn--md:visible, button.btn--lg:visible')
            .count()
        )
        .toBeGreaterThan(0);
      expect(
        await page
          .locator('button.btn--sm:visible, button.btn--md:visible, button.btn--lg:visible')
          .evaluateAll((buttons) => buttons.every((button) => Boolean(button.textContent?.trim()))),
        `labels textuales visibles en ${route.path}`
      ).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolveFrame) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
          )
      );
      const routeButtons = (await collectVisualFamilyMeasurements(page, route, viewport)).filter(
        isSharedTextButton
      );
      expect(
        routeButtons,
        `botones textuales compartidos visibles en ${route.path}`
      ).not.toHaveLength(0);
      expect(
        routeButtons.every((button) => button.rect.height >= 44),
        `target táctil mínimo en ${route.path}`
      ).toBe(true);
      measurements.push(...routeButtons);

      if (route.path === '/recipes' && process.env.E2E_SCREENSHOT_DIR) {
        const directory = resolve(process.env.E2E_SCREENSHOT_DIR);
        mkdirSync(directory, { recursive: true });
        await page.screenshot({
          path: join(directory, `${testInfo.project.name}-${viewport.width}-shared-button.png`),
          animations: 'disabled'
        });
      }
    }
  }

  expect(findSharedButtonGeometryDrifts(measurements)).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(aiConnectionRequests).toEqual([]);

  if (process.env.E2E_SCREENSHOT_DIR) {
    const directory = resolve(process.env.E2E_SCREENSHOT_DIR);
    mkdirSync(directory, { recursive: true });
    const geometryOnly = measurements.map(
      ({
        route,
        viewport,
        classes,
        rect,
        padding,
        margin,
        gap,
        font,
        borderRadius,
        borderWidth,
        alignment
      }) => ({
        route,
        viewport,
        classes,
        rect,
        padding,
        margin,
        gap,
        font,
        borderRadius,
        borderWidth,
        alignment
      })
    );
    writeFileSync(
      join(directory, `${testInfo.project.name}-geometry.json`),
      `${JSON.stringify(geometryOnly, null, 2)}\n`,
      'utf8'
    );
  }
});
