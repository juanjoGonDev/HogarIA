import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';

type SyntheticInsets = { top: number; right: number; bottom: number; left: number };

async function applyInsets(page: import('@playwright/test').Page, insets: SyntheticInsets) {
  await page.evaluate((values) => {
    for (const [edge, pixels] of Object.entries(values)) {
      document.documentElement.style.setProperty(`--hogaria-safe-area-${edge}`, `${pixels}px`);
    }
  }, insets);
}

test('keeps the shell controls clear of injected safe areas on portrait and landscape', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.addInitScript(() => {
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      document.documentElement.style.setProperty(`--hogaria-safe-area-${edge}`, '0px');
    }
  });
  await registerAndGoto(page, '/dashboard', 'Safe Area');

  for (const scenario of [
    {
      viewport: { width: 393, height: 851 },
      insets: { top: 0, right: 0, bottom: 0, left: 0 }
    },
    {
      viewport: { width: 393, height: 851 },
      insets: { top: 24, right: 12, bottom: 34, left: 18 }
    },
    {
      viewport: { width: 568, height: 320 },
      insets: { top: 12, right: 20, bottom: 18, left: 32 }
    }
  ]) {
    await page.setViewportSize(scenario.viewport);
    await applyInsets(page, scenario.insets);
    await expect(page.locator('.header')).toBeVisible();
    await expect(page.locator('.header__menu')).toBeVisible();
    await expect(page.locator('.header__profile')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const element = (selector: string): HTMLElement => {
        const found = document.querySelector<HTMLElement>(selector);
        if (!found) {
          const navClasses = Array.from(document.querySelectorAll('nav'), (nav) => nav.className);
          throw new Error(
            `Missing layout element: ${selector}; nav classes: ${navClasses.join(',')}`
          );
        }
        return found;
      };
      const rect = (selector: string) => {
        const bounds = element(selector).getBoundingClientRect();
        return {
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          left: bounds.left,
          width: bounds.width,
          height: bounds.height
        };
      };
      const rootStyle = getComputedStyle(document.documentElement);
      const value = (edge: string) =>
        Number.parseFloat(rootStyle.getPropertyValue(`--hogaria-safe-area-${edge}`));
      const main = element('main.main');
      const container = element('main app-page-container');

      return {
        width: window.innerWidth,
        height: window.innerHeight,
        insets: {
          top: value('top'),
          right: value('right'),
          bottom: value('bottom'),
          left: value('left')
        },
        header: rect('.header'),
        menu: rect('.header__menu'),
        profile: rect('.header__profile'),
        headerPadding: {
          left: Number.parseFloat(getComputedStyle(element('.header')).paddingLeft),
          right: Number.parseFloat(getComputedStyle(element('.header')).paddingRight)
        },
        mainPadding: {
          top: Number.parseFloat(getComputedStyle(main).paddingTop),
          right: Number.parseFloat(getComputedStyle(main).paddingRight),
          bottom: Number.parseFloat(getComputedStyle(main).paddingBottom),
          left: Number.parseFloat(getComputedStyle(main).paddingLeft)
        },
        pagePadding: {
          right: Number.parseFloat(getComputedStyle(container).paddingRight),
          left: Number.parseFloat(getComputedStyle(container).paddingLeft)
        },
        documentWidth: document.documentElement.scrollWidth
      };
    });

    expect(geometry.header.top).toBe(0);
    expect(geometry.header.height).toBeGreaterThanOrEqual(56 + scenario.insets.top - 1);
    expect(geometry.menu.left).toBeGreaterThanOrEqual(scenario.insets.left);
    expect(geometry.profile.right).toBeLessThanOrEqual(
      scenario.viewport.width - scenario.insets.right
    );
    expect(geometry.menu.top).toBeGreaterThanOrEqual(scenario.insets.top);
    expect(geometry.profile.top).toBeGreaterThanOrEqual(scenario.insets.top);
    expect(geometry.mainPadding.top).toBeGreaterThanOrEqual(56 + scenario.insets.top - 1);
    expect(geometry.mainPadding.bottom).toBeGreaterThanOrEqual(64 + scenario.insets.bottom);
    expect(geometry.headerPadding.left).toBeGreaterThanOrEqual(scenario.insets.left);
    expect(geometry.headerPadding.right).toBeGreaterThanOrEqual(scenario.insets.right);
    expect(geometry.pagePadding.left).toBeGreaterThanOrEqual(scenario.insets.left);
    expect(geometry.pagePadding.right).toBeGreaterThanOrEqual(scenario.insets.right);
    expect(geometry.documentWidth).toBeLessThanOrEqual(scenario.viewport.width);

    await page.locator('.header__menu').click();
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toHaveClass(/sidebar--open/);
    await expect
      .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().left))
      .toBeGreaterThanOrEqual(0);
    const drawer = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>('.sidebar');
      const close = document.querySelector<HTMLElement>('.sidebar__close');
      const nav = document.querySelector<HTMLElement>('.sidebar__nav');
      const footer = document.querySelector<HTMLElement>('.sidebar__footer');
      const account = document.querySelector<HTMLElement>('.sidebar__account');
      if (!sidebar || !close || !nav || !footer || !account) {
        throw new Error('Missing drawer safe-area elements');
      }
      const rect = (element: HTMLElement) => {
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
      };
      const style = (element: HTMLElement) => {
        const computed = getComputedStyle(element);
        return {
          paddingTop: Number.parseFloat(computed.paddingTop),
          paddingBottom: Number.parseFloat(computed.paddingBottom),
          paddingLeft: Number.parseFloat(computed.paddingLeft),
          paddingRight: Number.parseFloat(computed.paddingRight)
        };
      };
      return {
        open: sidebar.classList.contains('sidebar--open'),
        close: rect(close),
        closeSize: close.getBoundingClientRect().toJSON(),
        header: style(document.querySelector<HTMLElement>('.sidebar__header')!),
        nav: style(nav),
        footer: style(footer),
        account: rect(account)
      };
    });
    expect(drawer.open).toBe(true);
    expect(drawer.close.top).toBeGreaterThanOrEqual(scenario.insets.top);
    expect(drawer.close.right).toBeLessThanOrEqual(scenario.viewport.width - scenario.insets.right);
    expect(drawer.close.bottom).toBeLessThanOrEqual(
      scenario.viewport.height - scenario.insets.bottom
    );
    expect(drawer.closeSize.width).toBeGreaterThanOrEqual(32);
    expect(drawer.closeSize.height).toBeGreaterThanOrEqual(32);
    for (const section of [drawer.header, drawer.nav, drawer.footer]) {
      expect(section.paddingLeft).toBeGreaterThanOrEqual(scenario.insets.left);
      expect(section.paddingRight).toBeGreaterThanOrEqual(scenario.insets.right);
    }
    expect(drawer.header.paddingTop).toBeGreaterThanOrEqual(scenario.insets.top);
    expect(drawer.footer.paddingBottom).toBeGreaterThanOrEqual(scenario.insets.bottom);
    expect(drawer.account.bottom).toBeLessThanOrEqual(
      scenario.viewport.height - scenario.insets.bottom
    );
    if (scenario.viewport.height < 400) {
      const nav = page.locator('.sidebar__nav');
      const scroll = await nav.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      }));
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
      await nav.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.sidebar--open')).toHaveCount(0);
    await expect(page.locator('.header__menu')).toBeFocused();
  }

  await page.setViewportSize({ width: 393, height: 851 });
  await applyInsets(page, { top: 24, right: 12, bottom: 34, left: 18 });
  const sidebarNav = page.locator('.sidebar__nav');
  await page.locator('.header__menu').click();
  await sidebarNav.getByRole('link', { name: 'Recetas' }).click();
  await expect(page).toHaveURL(/\/recipes/);
  await page.locator('.header__menu').click();
  await sidebarNav.getByRole('link', { name: 'Inicio' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.setViewportSize({ width: 1440, height: 900 });
  await applyInsets(page, { top: 24, right: 18, bottom: 34, left: 24 });
  await expect(page.locator('.header')).toBeHidden();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar__nav')).toBeVisible();
  const desktopSafePadding = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('main.main');
    const container = document.querySelector<HTMLElement>('main app-page-container');
    if (!main || !container) throw new Error('Missing desktop content shell');
    return {
      mainTop: Number.parseFloat(getComputedStyle(main).paddingTop),
      mainBottom: Number.parseFloat(getComputedStyle(main).paddingBottom),
      contentLeft: Number.parseFloat(getComputedStyle(container).paddingLeft),
      contentRight: Number.parseFloat(getComputedStyle(container).paddingRight)
    };
  });
  expect(desktopSafePadding.mainTop).toBeGreaterThanOrEqual(24);
  expect(desktopSafePadding.mainBottom).toBeGreaterThanOrEqual(34);
  expect(desktopSafePadding.contentLeft).toBeGreaterThanOrEqual(24);
  expect(desktopSafePadding.contentRight).toBeGreaterThanOrEqual(18);

  await applyInsets(page, { top: 0, right: 0, bottom: 0, left: 0 });
  const desktopPadding = await page.locator('main.main').evaluate((main) => ({
    top: Number.parseFloat(getComputedStyle(main).paddingTop),
    bottom: Number.parseFloat(getComputedStyle(main).paddingBottom)
  }));
  expect(desktopPadding).toEqual({ top: 0, bottom: 0 });

  const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `safe-area-desktop-${testInfo.project.name}.png`)
    });
    await page.setViewportSize({ width: 393, height: 851 });
    await applyInsets(page, { top: 24, right: 12, bottom: 34, left: 18 });
    await expect(page.locator('.sidebar--open')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const sidebar = document.querySelector<HTMLElement>('.sidebar');
          return sidebar ? sidebar.getBoundingClientRect().right : Infinity;
        })
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: join(screenshotDirectory, `safe-area-mobile-${testInfo.project.name}.png`)
    });
  }
});
