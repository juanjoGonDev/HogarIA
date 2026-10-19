import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const SCREENSHOTS =
  process.env.E2E_SCREENSHOT_DIR ??
  join(process.cwd(), '.e2e-screenshots', 'settings-tabs-geometry');

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 },
  { width: 559, height: 800 },
  { width: 560, height: 800 },
  { width: 561, height: 800 },
  { width: 767, height: 1024 },
  { width: 768, height: 1024 },
  { width: 769, height: 1024 },
  { width: 1023, height: 768 },
  { width: 1024, height: 768 },
  { width: 1025, height: 768 },
  { width: 1440, height: 900 }
];

type TabLayout = Awaited<ReturnType<typeof readTabLayout>>;

async function readTabLayout(group: import('@playwright/test').Locator) {
  return group.evaluate((element) => {
    const groupStyle = getComputedStyle(element);
    const groupRect = element.getBoundingClientRect();
    const tabs = Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    return {
      group: {
        left: Number(groupRect.left.toFixed(2)),
        right: Number(groupRect.right.toFixed(2)),
        top: Number(groupRect.top.toFixed(2)),
        height: Number(groupRect.height.toFixed(2)),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        scrollLeft: element.scrollLeft,
        flexWrap: groupStyle.flexWrap,
        overflowX: groupStyle.overflowX,
        overflowY: groupStyle.overflowY,
        gap: groupStyle.columnGap,
        borderBottomWidth: groupStyle.borderBottomWidth
      },
      tabs: tabs.map((tab) => {
        const style = getComputedStyle(tab);
        const rect = tab.getBoundingClientRect();
        return {
          selected: tab.getAttribute('aria-selected'),
          left: Number(rect.left.toFixed(2)),
          top: Number(rect.top.toFixed(2)),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
          flexShrink: style.flexShrink,
          whiteSpace: style.whiteSpace,
          marginBlockStart: style.marginBlockStart,
          marginBlockEnd: style.marginBlockEnd,
          marginInlineStart: style.marginInlineStart,
          marginInlineEnd: style.marginInlineEnd,
          paddingBlockStart: style.paddingBlockStart,
          paddingBlockEnd: style.paddingBlockEnd,
          paddingInlineStart: style.paddingInlineStart,
          paddingInlineEnd: style.paddingInlineEnd,
          gap: style.gap,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          borderBottomWidth: style.borderBottomWidth,
          borderBottomStyle: style.borderBottomStyle,
          borderRadius: style.borderTopLeftRadius
        };
      })
    };
  });
}

async function capture(page: import('@playwright/test').Page, name: string): Promise<void> {
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOTS, name), animations: 'disabled' });
}

function collectBrowserErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  const appOrigin = (): string => new URL(process.env.E2E_BASE_URL ?? page.url()).origin;
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location().url;
    if (!location || new URL(location).origin === appOrigin())
      errors.push(`console: ${message.text()}`);
  });
  return errors;
}

function expectSettingTabsToStayOnOneRow(layout: TabLayout, route: string, width: number): void {
  const rows = new Set(layout.tabs.map((tab) => tab.top));
  expect(layout.group.flexWrap, `${route} mantiene una sola fila`).toBe('nowrap');
  expect(rows.size, `${route} no debe envolver pestañas a ${width}px`).toBe(1);
  expect(
    layout.tabs.every((tab) => tab.flexShrink === '0'),
    `${route} no debe encoger tabs: ${layout.tabs.map((tab) => tab.flexShrink).join(',')}`
  ).toBe(true);
  expect(
    layout.tabs.every((tab) => tab.whiteSpace === 'nowrap'),
    `${route} mantiene labels en una línea`
  ).toBe(true);
}

function expectTabsToMeetTouchTarget(layout: TabLayout, route: string, width: number): void {
  for (const [index, tab] of layout.tabs.entries()) {
    expect(tab.width, `${route} tab ${index + 1} ancho táctil a ${width}px`).toBeGreaterThanOrEqual(
      44
    );
    expect(tab.height, `${route} tab ${index + 1} alto táctil a ${width}px`).toBeGreaterThanOrEqual(
      44
    );
  }
}

test('Cuenta y Preferencias comparten geometría y desplazamiento de pestañas', async ({
  page
}, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await registerAndGoto(page, '/account', 'settings-tabs-geometry');
  await expect(page.locator('[data-test="account-tabs"]')).toBeVisible();
  const accountInfo = page.locator('[data-test="account-tab-info"]');
  await expect(accountInfo).toBeVisible();
  await expect(accountInfo).toHaveAccessibleName('Información');
  // The real tabs use a 150 ms transition; measure their settled geometry, not an intermediate frame.
  await page.addStyleTag({ content: '[role="tab"] { transition: none !important; }' });

  const accountGroup = page.locator('[data-test="account-tabs"]');
  const accountSnapshots: Array<{ width: number; layout: TabLayout }> = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );

    const layout = await readTabLayout(accountGroup);
    expectTabsToMeetTouchTarget(layout, '/account', viewport.width);
    if (viewport.width <= 560) {
      expectSettingTabsToStayOnOneRow(layout, '/account', viewport.width);
      expect(layout.group.overflowX, 'Cuenta desplaza tabs dentro de su grupo').toBe('auto');
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `Cuenta no debe tener overflow global a ${viewport.width}px`
    ).toBeLessThanOrEqual(viewport.width);
    accountSnapshots.push({ width: viewport.width, layout });

    if (viewport.width === 1440) await capture(page, 'account-tabs-desktop-1440x900.png');
    if (viewport.width === 320) await capture(page, 'account-tabs-mobile-320x568.png');
  }

  await page.setViewportSize({ width: 320, height: 568 });
  const accountBeforeSelection = await readTabLayout(accountGroup);
  await page.locator('[data-test="account-tab-security"]').click();
  await expect(page.locator('[data-test="account-tab-security"]')).toHaveAttribute(
    'aria-selected',
    'true'
  );
  const accountAfterSelection = await readTabLayout(accountGroup);
  expect(
    accountAfterSelection.tabs.map(({ left, top, width, height }) => ({ left, top, width, height }))
  ).toEqual(
    accountBeforeSelection.tabs.map(({ left, top, width, height }) => ({
      left,
      top,
      width,
      height
    }))
  );

  if (testInfo.project.name === 'mobile-chrome') await accountInfo.tap();
  else await accountInfo.click();
  await expect(accountInfo).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => accountGroup.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await page.locator('[data-test="account-tab-account"]').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(accountInfo).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(accountInfo).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => accountGroup.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);

  await page.goto('/preferences');
  const preferencesGroup = page.locator('.preferences__tabs');
  await expect(preferencesGroup).toBeVisible();
  await expect(page.locator('[data-test="preferences-tab-goal"]')).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );

    const layout = await readTabLayout(preferencesGroup);
    expectTabsToMeetTouchTarget(layout, '/preferences', viewport.width);
    if (viewport.width <= 560) {
      expectSettingTabsToStayOnOneRow(layout, '/preferences', viewport.width);
      expect(layout.group.overflowX).toBe('auto');
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `Preferencias no debe tener overflow global a ${viewport.width}px`
    ).toBeLessThanOrEqual(viewport.width);

    const account = accountSnapshots.find((snapshot) => snapshot.width === viewport.width);
    expect(account, `falta baseline de Cuenta a ${viewport.width}px`).toBeDefined();
    if (!account) continue;
    const reference = account.layout.tabs[0];
    const current = layout.tabs[0];
    expect(layout.group.gap, `gap del grupo tab a ${viewport.width}px`).toBe(
      account.layout.group.gap
    );
    expect(layout.group.borderBottomWidth).toBe(account.layout.group.borderBottomWidth);
    expect(
      current.height,
      `altura del control tab equivalente a ${viewport.width}px`
    ).toBeGreaterThanOrEqual(reference.height - 1);
    expect(current.height).toBeLessThanOrEqual(reference.height + 1);
    for (const key of [
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
      'borderBottomWidth',
      'borderBottomStyle',
      'borderRadius'
    ] as const) {
      expect(current[key], `${key} en tab equivalente a ${viewport.width}px`).toBe(reference[key]);
    }

    if (viewport.width === 1440) await capture(page, 'preferences-tabs-desktop-1440x900.png');
    if (viewport.width === 320) await capture(page, 'preferences-tabs-mobile-320x568.png');
  }

  expect(browserErrors, 'rutas de pestañas sin errores de JavaScript ni consola').toEqual([]);
});
