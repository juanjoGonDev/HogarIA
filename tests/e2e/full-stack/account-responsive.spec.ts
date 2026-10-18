import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';

async function measureAccountLayout(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const elements = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          selector: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
            typeof element.className === 'string' && element.className.trim()
              ? `.${element.className.trim().replace(/\s+/g, '.')}`
              : ''
          }`,
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          whiteSpace: style.whiteSpace
        };
      })
      .filter((element) => element.width > 0 && element.right > viewportWidth + 1)
      .sort((left, right) => right.right - left.right)
      .slice(0, 8);

    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      elements
    };
  });
}

async function expectAccountTabReachable(
  page: Page,
  tabList: ReturnType<Page['locator']>,
  tab: 'account' | 'security' | 'info',
  activation: string,
  width: number
) {
  const layout = await measureAccountLayout(page);
  expect(
    layout.documentWidth,
    `${tab} (${activation}) a ${width}px no debe ampliar el documento; nodos que rebasan: ${JSON.stringify(layout.elements)}`
  ).toBeLessThanOrEqual(layout.viewportWidth + 1);

  const tabsGeometry = await tabList.evaluate((container, testId) => {
    const containerRect = container.getBoundingClientRect();
    const activeTab = container.querySelector<HTMLElement>(`[data-test="${testId}"]`);
    const activeRect = activeTab?.getBoundingClientRect();
    const clipLeft = containerRect.left + container.clientLeft;
    const clipRight = clipLeft + container.clientWidth;
    return {
      containerLeft: containerRect.left,
      containerRight: containerRect.right,
      clipLeft,
      clipRight,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      activeLeft: activeRect?.left ?? null,
      activeRight: activeRect?.right ?? null,
      activeVisibleWidth: activeRect
        ? Math.max(0, Math.min(activeRect.right, clipRight) - Math.max(activeRect.left, clipLeft))
        : 0
    };
  }, `account-tab-${tab}`);

  expect(
    tabsGeometry.containerLeft,
    `la barra debe empezar dentro del viewport a ${width}px: ${JSON.stringify(tabsGeometry)}`
  ).toBeGreaterThanOrEqual(-1);
  expect(
    tabsGeometry.containerRight,
    `la barra debe acabar dentro del viewport a ${width}px: ${JSON.stringify(tabsGeometry)}`
  ).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(
    tabsGeometry.scrollWidth,
    `el contenido de la barra no debe encogerse ni ocultarse a ${width}px: ${JSON.stringify(tabsGeometry)}`
  ).toBeGreaterThanOrEqual(tabsGeometry.clientWidth);
  expect(
    tabsGeometry.activeLeft,
    `${tab} debe existir y quedar visible tras ${activation} a ${width}px: ${JSON.stringify(tabsGeometry)}`
  ).not.toBeNull();
  expect(
    tabsGeometry.activeVisibleWidth,
    `${tab} debe conservar un área visible dentro del scrollport tras ${activation} a ${width}px: ${JSON.stringify(tabsGeometry)}`
  ).toBeGreaterThan(0);
  if (width === 320) {
    expect(
      tabsGeometry.scrollWidth,
      'a 320px la barra desplaza internamente las pestañas que no caben juntas'
    ).toBeGreaterThan(tabsGeometry.clientWidth);
  }
}

test('Cuenta no desborda en móvil estrecho', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));

  await page.setViewportSize(
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 320, height: 568 }
  );
  await registerAndGoto(page, '/account', 'QA Account Responsive');
  await expect(page.locator('app-account')).toBeVisible();

  if (testInfo.project.name === 'chromium') {
    const screenshotDir = join(
      resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-account-responsive-20261001'),
      'final-desktop'
    );
    mkdirSync(screenshotDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(screenshotDir, 'account-1440x900.png'),
      animations: 'disabled'
    });
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await page.reload();
  await expect(page.locator('app-account')).toBeVisible();
  await expect(page.locator('[data-test="account-tabs"]')).toBeVisible();
  if (testInfo.project.name === 'mobile-chrome') {
    const screenshotDir = join(
      resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-account-responsive-20261001'),
      'final-mobile'
    );
    const screenshotPath = join(screenshotDir, 'account-320x568.png');
    mkdirSync(screenshotDir, { recursive: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotPath, animations: 'disabled' });
  }

  const viewports = [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 559, height: 568 },
    { width: 560, height: 568 },
    { width: 561, height: 568 },
    { width: 568, height: 320 },
    { width: 844, height: 390 }
  ];
  for (const viewport of viewports) {
    const { width } = viewport;
    await page.setViewportSize(viewport);
    const tabList = page.locator('[data-test="account-tabs"]');
    await expect(tabList.getByRole('tab')).toHaveCount(3);

    for (const tab of ['account', 'security', 'info'] as const) {
      const tabButton = page.locator(`[data-test="account-tab-${tab}"]`);
      await tabButton.click();
      await expect(tabButton).toHaveAttribute('aria-selected', 'true');

      if (width === 320 && tab === 'account') {
        await page.locator('[data-test="account-name"]').fill('N'.repeat(100));
      }

      await expectAccountTabReachable(page, tabList, tab, 'click', width);
    }

    const accountTab = page.locator('[data-test="account-tab-account"]');
    await accountTab.click();
    await page.keyboard.press('Enter');
    await expect(accountTab).toHaveAttribute('aria-selected', 'true');
    await expectAccountTabReachable(page, tabList, 'account', 'Enter', width);

    for (const tab of ['security', 'info'] as const) {
      await page.keyboard.press('Tab');
      const tabButton = page.locator(`[data-test="account-tab-${tab}"]`);
      await expect(tabButton).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(tabButton).toHaveAttribute('aria-selected', 'true');
      await expectAccountTabReachable(page, tabList, tab, 'Tab + Enter', width);
    }
  }

  expect(pageErrors, 'la pantalla de Cuenta no debe romper Angular').toEqual([]);
});
