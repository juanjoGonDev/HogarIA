import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 },
  { width: 767, height: 1024 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
];

const BUTTON_PARITY_VIEWPORTS = [
  ...VIEWPORTS,
  { width: 769, height: 1024 },
  { width: 1023, height: 768 },
  { width: 1025, height: 768 }
];

const GEOMETRY_KEYS = [
  'paddingBlockStart',
  'paddingBlockEnd',
  'paddingInlineStart',
  'paddingInlineEnd',
  'marginBlockStart',
  'marginBlockEnd',
  'marginInlineStart',
  'marginInlineEnd',
  'gap',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'borderStyle',
  'borderWidth',
  'borderRadius'
] as const;

type ButtonGeometry = Record<(typeof GEOMETRY_KEYS)[number], string> & {
  label: string;
  className: string;
  width: number;
  height: number;
};

test('las acciones equivalentes de la cabecera del calendario comparten geometría', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/calendar', 'UI geometry calendar');
  await expect(page.getByRole('button', { name: 'Planificar IA', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const observations: Array<{
    viewport: { width: number; height: number };
    controls: ButtonGeometry[];
    viewPicker: {
      width: number;
      height: number;
      paddingBlockStart: string;
      paddingBlockEnd: string;
      paddingInlineStart: string;
      paddingInlineEnd: string;
      borderRadius: string;
    };
    datePicker: { width: number; height: number };
    groupGaps: string[];
    dayHeaders: Array<{
      cell: { left: number; right: number; top: number; bottom: number };
      text: Array<{ left: number; right: number; top: number; bottom: number }>;
      addAction?: { left: number; right: number; top: number; bottom: number };
    }>;
  }> = [];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );

    const controls = await page
      .locator('.cal-top button:not(.picker__trigger)')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const element = button as HTMLButtonElement;
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            label: element.innerText.replace(/\s+/g, ' ').trim(),
            className: String(element.className),
            width: Number(rect.width.toFixed(2)),
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
            borderWidth: style.borderWidth,
            borderRadius: style.borderTopLeftRadius
          };
        })
      );
    const viewPicker = await page
      .locator('.cal-view-picker .picker__trigger')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
          paddingBlockStart: style.paddingBlockStart,
          paddingBlockEnd: style.paddingBlockEnd,
          paddingInlineStart: style.paddingInlineStart,
          paddingInlineEnd: style.paddingInlineEnd,
          borderRadius: style.borderTopLeftRadius
        };
      });
    const datePicker = await page.locator('.cal-top .cal-jump').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Number(rect.width.toFixed(2)), height: Number(rect.height.toFixed(2)) };
    });
    const groupGaps = await page
      .locator('.cal-top__nav, .cal-top__right')
      .evaluateAll((groups) => groups.map((group) => getComputedStyle(group).columnGap));
    const dayHeaders = await page.locator('.tl__dayhead').evaluateAll((headers) =>
      headers.map((header) => {
        const rect = header.getBoundingClientRect();
        const text = Array.from(header.querySelectorAll<HTMLElement>('.tl__dow, .tl__num')).map(
          (label) => {
            const labelRect = label.getBoundingClientRect();
            return {
              left: labelRect.left,
              right: labelRect.right,
              top: labelRect.top,
              bottom: labelRect.bottom
            };
          }
        );
        const addAction = header.querySelector('app-icon-button')?.getBoundingClientRect();
        return {
          cell: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          text,
          ...(addAction
            ? {
                addAction: {
                  left: addAction.left,
                  right: addAction.right,
                  top: addAction.top,
                  bottom: addAction.bottom
                }
              }
            : {})
        };
      })
    );

    expect(controls, `controles de acción a ${viewport.width}×${viewport.height}`).toHaveLength(7);
    expect(viewPicker.width).toBe(144);
    expect(viewPicker.height).toBe(44);
    expect(viewPicker.paddingBlockStart).toBe('8px');
    expect(viewPicker.paddingBlockEnd).toBe('8px');
    expect(viewPicker.paddingInlineStart).toBe('12px');
    expect(viewPicker.paddingInlineEnd).toBe('12px');
    expect(viewPicker.borderRadius).toBe('8px');
    observations.push({ viewport, controls, viewPicker, datePicker, groupGaps, dayHeaders });
  }

  const mismatches = observations.flatMap(
    ({ viewport, controls, datePicker, groupGaps, dayHeaders }) => {
      const reference = controls.find((control) => control.label === 'Planificar IA');
      if (!reference) return [`Falta Planificar IA a ${viewport.width}×${viewport.height}`];

      const mismatches = controls.flatMap((control) =>
        Math.abs(Number(reference.height) - Number(control.height)) <= 1
          ? []
          : [
              `${viewport.width}×${viewport.height} ${control.className} height: ${control.height} vs ${reference.height}`
            ]
      );
      for (const control of controls.filter((item) => item.className.includes('cal-icon-btn'))) {
        if (Math.abs(Number(control.width) - Number(reference.height)) > 1) {
          mismatches.push(
            `${viewport.width}×${viewport.height} ${control.className} width: ${control.width} vs ${reference.height}`
          );
        }
      }
      if (
        Math.abs(datePicker.height - Number(reference.height)) > 1 ||
        Math.abs(datePicker.width - datePicker.height) > 1
      ) {
        mismatches.push(
          `${viewport.width}×${viewport.height} cal-jump size: ${datePicker.width}×${datePicker.height} vs ${reference.height}px`
        );
      }
      if (new Set(groupGaps).size !== 1) {
        mismatches.push(
          `${viewport.width}×${viewport.height} toolbar gaps differ: ${groupGaps.join(', ')}`
        );
      }
      if (viewport.width <= 720) {
        for (const [index, day] of dayHeaders.entries()) {
          for (const text of day.text) {
            if (text.left < day.cell.left - 1 || text.right > day.cell.right + 1) {
              mismatches.push(
                `${viewport.width}×${viewport.height} day ${index + 1} text escapes its column: ${text.left.toFixed(2)}–${text.right.toFixed(2)} vs ${day.cell.left.toFixed(2)}–${day.cell.right.toFixed(2)}`
              );
            }
          }
          if (
            day.addAction &&
            (day.addAction.left < day.cell.left - 1 || day.addAction.right > day.cell.right + 1)
          ) {
            mismatches.push(
              `${viewport.width}×${viewport.height} day ${index + 1} add action escapes its column`
            );
          }
        }
      }
      const textControls = controls.filter(
        (control) => !control.className.includes('cal-icon-btn')
      );
      const textReference = textControls.find((control) => control.label === 'Planificar IA');
      if (!textReference) return [...mismatches, `Falta Planificar IA en controles de texto`];

      mismatches.push(
        ...textControls
          .filter((control) => control.label !== 'Planificar IA')
          .flatMap((control) =>
            GEOMETRY_KEYS.flatMap((key) =>
              textReference[key] === control[key]
                ? []
                : [
                    `${viewport.width}×${viewport.height} ${control.className} ${key}: ${textReference[key]} vs ${control[key]}`
                  ]
            )
          )
      );

      return mismatches;
    }
  );

  await page.setViewportSize({ width: 320, height: 568 });
  const timelineViewport = page.locator('.tl__viewport');
  const scrollMetrics = await timelineViewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
  await expect(page.locator('.tl__scroll')).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('.tl__col').first()).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('.tl__hours').first()).toHaveCSS('cursor', 'auto');

  const dayButtons = page.locator('.tl__daynum');
  await dayButtons.first().focus();
  for (
    let tab = 0;
    tab < 20 && !(await dayButtons.last().evaluate((e) => e === document.activeElement));
    tab++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(dayButtons.last()).toBeFocused();
  await expect
    .poll(() => timelineViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    const mobile = testInfo.project.name === 'mobile-chrome';
    await page.setViewportSize(mobile ? { width: 393, height: 851 } : { width: 1440, height: 900 });
    await timelineViewport.evaluate((element) => (element.scrollLeft = 0));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await page.screenshot({
      path: join(screenshotDirectory, `ui-geometry-${mobile ? 'mobile' : 'desktop'}.png`)
    });
  }

  expect(mismatches, JSON.stringify(observations, null, 2)).toEqual([]);
});

test('Planificar IA comparte la geometría del botón primario de Recetas', async ({ page }) => {
  await registerAndGoto(page, '/calendar', 'UI button parity');
  const calendarButton = page.locator('.cal-top .cal-btn--primary');
  await expect(calendarButton).toHaveText('Planificar IA');
  await page.evaluate(() => document.fonts.ready);

  const measure = (locator: typeof calendarButton) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
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
        borderWidth: style.borderWidth,
        borderRadius: style.borderTopLeftRadius
      };
    });
  const calendarMeasurements: Array<{
    viewport: (typeof BUTTON_PARITY_VIEWPORTS)[number];
    geometry: Awaited<ReturnType<typeof measure>>;
  }> = [];
  const documentOverflow: string[] = [];
  for (const viewport of BUTTON_PARITY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(calendarButton).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    calendarMeasurements.push({ viewport, geometry: await measure(calendarButton) });
    const pageWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth
    }));
    if (pageWidth.scroll > pageWidth.client + 1) {
      documentOverflow.push(
        `${viewport.width}×${viewport.height} document width: ${pageWidth.scroll}px > ${pageWidth.client}px`
      );
    }
  }

  const screenshotDirectory =
    process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-calendar-cta-parity';
  mkdirSync(screenshotDirectory, { recursive: true });
  const mobile = test.info().project.name === 'mobile-chrome';
  const screenshotViewport = mobile ? { width: 393, height: 851 } : { width: 1440, height: 900 };
  await page.setViewportSize(screenshotViewport);
  const sidebar = page.locator('.sidebar');
  await expect
    .poll(async () => {
      const box = await sidebar.boundingBox();
      if (!box) return Number.POSITIVE_INFINITY;
      return mobile ? box.x + box.width : Math.abs(box.x);
    })
    .toBeLessThanOrEqual(1);
  await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  const screenshotLayout = await page.evaluate(() => ({
    scrollX: window.scrollX,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(screenshotLayout.scrollX).toBe(0);
  expect(screenshotLayout.scrollWidth).toBeLessThanOrEqual(screenshotLayout.clientWidth + 1);
  await page.screenshot({
    path: join(screenshotDirectory, `calendar-cta-${mobile ? 'mobile' : 'desktop'}.png`)
  });

  await page.goto(new URL('/recipes', page.url()).toString());
  const sharedButton = page.locator('.recipes__actions app-button button.btn--primary');
  await expect(sharedButton).toBeVisible();
  const sharedMeasurements: typeof calendarMeasurements = [];
  for (const viewport of BUTTON_PARITY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(sharedButton).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    sharedMeasurements.push({ viewport, geometry: await measure(sharedButton) });
  }

  const mismatches = calendarMeasurements.flatMap(({ viewport, geometry }, index) => {
    const sharedGeometry = sharedMeasurements[index].geometry;
    return Object.entries(geometry).flatMap(([key, value]) => {
      const other = sharedGeometry[key as keyof typeof sharedGeometry];
      if (typeof value === 'number' && typeof other === 'number') {
        return Math.abs(value - other) > 1
          ? [`${viewport.width}×${viewport.height} ${key}: ${value}px vs ${other}px`]
          : [];
      }
      return value === other
        ? []
        : [`${viewport.width}×${viewport.height} ${key}: ${value} vs ${other}`];
    });
  });

  expect(
    [...mismatches, ...documentOverflow],
    JSON.stringify({ calendarMeasurements, sharedMeasurements, documentOverflow }, null, 2)
  ).toEqual([]);
});

test('la CTA de planificación conserva su geometría mientras carga y está deshabilitada', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/calendar', 'UI geometry loading state');
  const mobile = testInfo.project.name === 'mobile-chrome';
  const viewport = mobile ? { width: 393, height: 851 } : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);

  let releaseResponse: (() => void) | undefined;
  const responseHeld = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/ai/plan-week', async (route) => {
    await responseHeld;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { message: 'Synthetic provider unavailable' } })
    });
  });

  try {
    await page.getByRole('button', { name: 'Planificar IA', exact: true }).click();
    const modal = page.locator('.modal-overlay');
    await modal.locator('[data-test="generate-goal-custom"]').click();
    await modal.locator('#gen-custom').fill('Fixture de geometría');

    const generateButton = modal.locator('.meal-form__actions .cal-btn--primary');
    await expect(generateButton).toBeEnabled();
    const screenshotDirectory =
      process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-layout-ai-loading';
    mkdirSync(screenshotDirectory, { recursive: true });
    await generateButton.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(screenshotDirectory, `plan-cta-ready-${mobile ? 'mobile' : 'desktop'}.png`)
    });
    const measure = () =>
      generateButton.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          box: {
            left: Number(rect.left.toFixed(2)),
            top: Number(rect.top.toFixed(2)),
            width: Number(rect.width.toFixed(2)),
            height: Number(rect.height.toFixed(2)),
            right: Number(rect.right.toFixed(2)),
            bottom: Number(rect.bottom.toFixed(2))
          },
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
          borderWidth: style.borderWidth,
          borderRadius: style.borderTopLeftRadius
        };
      });

    const readyGeometry = await measure();
    const request = page.waitForRequest(
      (candidate) =>
        new URL(candidate.url()).pathname === '/api/ai/plan-week' && candidate.method() === 'POST'
    );
    await generateButton.click();
    await request;
    await expect(generateButton).toBeDisabled();
    await expect(generateButton).toHaveAttribute('aria-busy', 'true');
    await expect(generateButton).toHaveAttribute('aria-label', /Planificando/);
    await generateButton.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(screenshotDirectory, `plan-cta-loading-${mobile ? 'mobile' : 'desktop'}.png`)
    });
    const loadingGeometry = await measure();

    const differences = Object.entries(readyGeometry).flatMap(([key, value]) => {
      const loading = loadingGeometry[key as keyof typeof loadingGeometry];
      if (key === 'box') {
        const readyBox = value as typeof readyGeometry.box;
        const loadingBox = loading as typeof loadingGeometry.box;
        return (['width', 'height'] as const).flatMap((boxKey) => {
          const dimension = readyBox[boxKey];
          const next = loadingBox[boxKey];
          return Math.abs(dimension - next) <= 1 ? [] : [`${boxKey}: ${dimension}px → ${next}px`];
        });
      }
      return value === loading ? [] : [`${key}: ${String(value)} → ${String(loading)}`];
    });

    expect(differences, JSON.stringify({ readyGeometry, loadingGeometry }, null, 2)).toEqual([]);
    releaseResponse?.();
    await expect(generateButton).toBeEnabled();
  } finally {
    releaseResponse?.();
  }
});
