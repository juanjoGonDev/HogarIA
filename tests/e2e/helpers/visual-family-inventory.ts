import type { Page, TestInfo } from '@playwright/test';
import type { RouteCase } from './route-layout-manifest';

export type VisualFamily =
  'actions' | 'tabs' | 'fields' | 'cards' | 'dialogs' | 'navigation' | 'headings' | 'sections';

export type VisualFamilyMeasurement = {
  route: string;
  shell: RouteCase['shell'];
  state: 'route-default' | 'fixture-populated';
  viewport: string;
  family: VisualFamily;
  tag: string;
  classes: string;
  rect: { x: number; y: number; width: number; height: number };
  padding: [number, number, number, number];
  margin: [number, number, number, number];
  gap: [string, string];
  font: [string, string, string];
  borderRadius: string;
  borderWidth: [string, string, string, string];
  alignment: [string, string];
};

const FAMILY_SELECTORS: ReadonlyArray<{ family: VisualFamily; selector: string }> = [
  { family: 'actions', selector: 'button, a[role="button"], [role="button"]:not(button):not(a)' },
  { family: 'tabs', selector: '[role="tab"], [role="tablist"]' },
  { family: 'fields', selector: 'input:not([type="hidden"]), textarea, select, [role="combobox"]' },
  { family: 'cards', selector: 'article, [class~="card"], [class*="__card"], [data-card]' },
  {
    family: 'dialogs',
    selector: 'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
  },
  { family: 'navigation', selector: 'header, nav, [role="navigation"], .sidebar, .bottom-nav' },
  { family: 'headings', selector: 'h1, h2, h3' },
  { family: 'sections', selector: 'main > section, section, form' }
];

const INVENTORIED_FAMILIES = FAMILY_SELECTORS.map(({ family }) => family).filter(
  (family, index, all) => all.indexOf(family) === index
);

export function safeRoute(path: string): string {
  const url = new URL(path, 'http://layout.invalid');
  const pathname = url.pathname.replace(
    /\/(?:[a-f\d]{8}-[a-f\d-]{20,}|[a-z0-9_-]{20,}|qa-(?:layout|baseline)-[a-z0-9_-]+)/giu,
    '/:fixture'
  );
  const query = [...url.searchParams.keys()]
    .sort()
    .map((key) => `${encodeURIComponent(key)}=:fixture`)
    .join('&');
  return `${pathname}${query ? `?${query}` : ''}`;
}

export async function collectVisualFamilyMeasurements(
  page: Page,
  route: RouteCase,
  viewport: { width: number; height: number }
): Promise<VisualFamilyMeasurement[]> {
  const routePath = safeRoute(route.path);
  const familySelectors = FAMILY_SELECTORS;
  const state: VisualFamilyMeasurement['state'] = route.readySelector
    ? 'fixture-populated'
    : 'route-default';

  return page.evaluate(
    ({ routePath, shell, state, viewport, familySelectors }) => {
      const round = (value: number) => Math.round(value * 10) / 10;
      const measurements: VisualFamilyMeasurement[] = [];

      for (const { family, selector } of familySelectors) {
        const seen = new Set<Element>();
        for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          if (seen.has(element)) continue;
          seen.add(element);

          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
          ) {
            continue;
          }

          const stableClasses = Array.from(element.classList)
            .filter(
              (className) =>
                /^[a-z][a-z0-9_-]{0,48}$/iu.test(className) && !/[a-f\d]{16,}/iu.test(className)
            )
            .sort()
            .slice(0, 4)
            .join(' ');
          measurements.push({
            route: routePath,
            shell,
            state,
            viewport: `${viewport.width}x${viewport.height}`,
            family,
            tag: element.tagName.toLowerCase(),
            classes: stableClasses,
            rect: {
              x: round(rect.x),
              y: round(rect.y),
              width: round(rect.width),
              height: round(rect.height)
            },
            padding: [
              round(Number.parseFloat(style.paddingBlockStart) || 0),
              round(Number.parseFloat(style.paddingInlineEnd) || 0),
              round(Number.parseFloat(style.paddingBlockEnd) || 0),
              round(Number.parseFloat(style.paddingInlineStart) || 0)
            ],
            margin: [
              round(Number.parseFloat(style.marginBlockStart) || 0),
              round(Number.parseFloat(style.marginInlineEnd) || 0),
              round(Number.parseFloat(style.marginBlockEnd) || 0),
              round(Number.parseFloat(style.marginInlineStart) || 0)
            ],
            gap: [style.rowGap, style.columnGap],
            font: [style.fontSize, style.lineHeight, style.fontWeight],
            borderRadius: style.borderRadius,
            borderWidth: [
              style.borderTopWidth,
              style.borderInlineEndWidth,
              style.borderBottomWidth,
              style.borderInlineStartWidth
            ],
            alignment: [style.alignItems, style.justifyContent]
          });
        }
      }

      return measurements;
    },
    {
      routePath,
      shell: route.shell,
      state,
      viewport,
      familySelectors
    }
  );
}

export async function attachVisualFamilyInventory(
  testInfo: TestInfo,
  attachmentName: string,
  measurements: readonly VisualFamilyMeasurement[],
  sampledRoutes: readonly string[]
): Promise<void> {
  const profilesByFamily = Object.fromEntries(
    INVENTORIED_FAMILIES.map((family) => {
      const familyMeasurements = measurements.filter((item) => item.family === family);
      const byViewport = Object.fromEntries(
        [...new Set(familyMeasurements.map((item) => item.viewport))].map((viewport) => {
          const viewportMeasurements = familyMeasurements.filter(
            (item) => item.viewport === viewport
          );
          const profiles = new Set(
            viewportMeasurements.map((item) =>
              JSON.stringify({
                tag: item.tag,
                classes: item.classes,
                size: [item.rect.width, item.rect.height],
                padding: item.padding,
                margin: item.margin,
                gap: item.gap,
                font: item.font,
                borderRadius: item.borderRadius,
                borderWidth: item.borderWidth,
                alignment: item.alignment
              })
            )
          );
          return [
            viewport,
            {
              elements: viewportMeasurements.length,
              geometryProfiles: profiles.size,
              routes: new Set(viewportMeasurements.map((item) => item.route)).size
            }
          ];
        })
      );
      return [
        family,
        {
          elements: familyMeasurements.length,
          routes: new Set(familyMeasurements.map((item) => item.route)).size,
          byViewport
        }
      ];
    })
  );

  const report = {
    sampledRoutes: [...new Set(sampledRoutes.map(safeRoute))].sort(),
    sampledViewports: [...new Set(measurements.map((item) => item.viewport))].sort(),
    scope: 'visible route-ready UI; no text, values, labels, or personal data captured',
    statesNotExercised: ['loading', 'disabled', 'focus', 'validation', 'open dialogs/overlays'],
    profilesByFamily,
    measurements
  };

  await testInfo.attach(attachmentName, {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json'
  });
  console.log(
    `[qa-visual-family-inventory] ${JSON.stringify({
      routes: report.sampledRoutes.length,
      viewports: report.sampledViewports,
      families: profilesByFamily,
      statesNotExercised: report.statesNotExercised
    })}`
  );
}
