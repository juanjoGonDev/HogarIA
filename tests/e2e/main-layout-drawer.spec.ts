import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

test.describe('authenticated mobile navigation drawer', () => {
  test('opens and closes progressively from the left edge with interruptible touch swipes', async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-safari', 'Gesture test uses Chromium touch input.');
    await page.setViewportSize({ width: 393, height: 851 });
    await registerWithHousehold(page, '/dashboard', 'Drawer edge gesture');

    const menuButton = page.locator('.header__menu');
    const sidebar = page.locator('.sidebar');
    const overlay = page.locator('.sidebar-overlay');
    await expect(page.locator('.sidebar-edge-sensor')).toBeVisible();
    await expect(page.locator('.sidebar-edge-sensor')).toHaveAttribute(
      'data-gesture-ready',
      'true'
    );
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    const session = await page.context().newCDPSession(page);
    const touch = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      point?: { x: number; y: number }
    ) => {
      await session.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: point ? [{ ...point, id: 1, force: 1 }] : []
      });
    };

    await touch('touchStart', { x: 3, y: 320 });
    await touch('touchMove', { x: 100, y: 320 });
    await expect
      .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().left))
      .toBeGreaterThan(-210);
    const dragState = await page.evaluate(() => ({
      left: document.querySelector('.sidebar')!.getBoundingClientRect().left,
      opacity: Number.parseFloat(
        getComputedStyle(document.querySelector('.sidebar-overlay')!).opacity
      )
    }));
    expect(dragState.left).toBeLessThan(-140);
    expect(dragState.opacity).toBeGreaterThan(0.1);
    expect(dragState.opacity).toBeLessThan(0.3);

    await touch('touchMove', { x: 175, y: 320 });
    await touch('touchEnd');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toHaveAttribute('role', 'dialog');

    await touch('touchStart', { x: 160, y: 320 });
    await touch('touchMove', { x: 90, y: 320 });
    await expect
      .poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().left))
      .toBeLessThan(-50);
    await touch('touchMove', { x: 10, y: 320 });
    await touch('touchEnd');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(overlay).toBeHidden();

    // A short, slow drag is a cancellation, not an accidental partial-open state.
    await touch('touchStart', { x: 3, y: 320 });
    await touch('touchMove', { x: 8, y: 320 });
    await page.waitForTimeout(80);
    await touch('touchMove', { x: 18, y: 320 });
    await page.waitForTimeout(80);
    await touch('touchMove', { x: 30, y: 320 });
    await touch('touchEnd');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(overlay).toBeHidden();

    // New intent can reverse the drawer while its previous snap is still settling.
    await menuButton.click();
    await touch('touchStart', { x: 160, y: 320 });
    await touch('touchMove', { x: 25, y: 320 });
    await touch('touchEnd');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    await touch('touchStart', { x: 3, y: 320 });
    await touch('touchMove', { x: 140, y: 320 });
    await touch('touchEnd');
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toBeVisible();
    await session.detach();
  });

  test('traps focus and locks the page while the mobile drawer is modal', async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await registerWithHousehold(page, '/dashboard', 'Drawer focus and scroll lock');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const initialScrollY = await page.evaluate(() => window.scrollY);
    const menuButton = page.locator('.header__menu');
    const sidebar = page.locator('.sidebar');
    const closeButton = page.locator('.sidebar__close');
    const logoutButton = page.locator('.sidebar__account app-icon-button button');
    const overlay = page.locator('.sidebar-overlay');

    await menuButton.click();
    await expect(sidebar).toHaveAttribute('role', 'dialog');
    await expect(sidebar).toHaveAttribute('aria-modal', 'true');
    await expect(sidebar).toHaveAttribute('aria-labelledby', 'primary-sidebar-title');
    await expect(closeButton).toBeFocused();
    await expect(page.locator('header.header')).toHaveAttribute('inert', '');
    await expect(page.locator('main.main')).toHaveAttribute('inert', '');
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');

    await page.keyboard.press('Shift+Tab');
    await expect(logoutButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    if (testInfo.project.name !== 'mobile-safari') {
      await page.mouse.wheel(0, 500);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);
      const touchSession = await page.context().newCDPSession(page);
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 330, y: 500, id: 7, force: 1 }]
      });
      await touchSession.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 330, y: 390, id: 7, force: 1 }]
      });
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);
      await touchSession.detach();
    }
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).not.toBeNull();
    await overlay.click({
      position: { x: overlayBox!.width - 10, y: overlayBox!.height / 2 }
    });
    await expect(sidebar).not.toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('header.header')).not.toHaveAttribute('inert', '');
    await expect(page.locator('main.main')).not.toHaveAttribute('inert', '');
    await expect(menuButton).toBeFocused();
  });

  test('supports keyboard and existing close paths across breakpoint edges', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await registerWithHousehold(page, '/dashboard', 'Drawer Escape');

    const menuButton = page.locator('.header__menu');
    const overlay = page.locator('.sidebar-overlay');
    const sidebar = page.locator('.sidebar');
    const bottomNav = page.locator('.bottom-nav');

    await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveAttribute(
      'href',
      '/dashboard'
    );

    for (const viewport of [
      { width: 393, height: 851 },
      { width: 320, height: 568 },
      { width: 568, height: 320 },
      { width: 1023, height: 768 }
    ]) {
      await page.setViewportSize(viewport);
      await expect(menuButton).toBeVisible();
      await expect(menuButton).toHaveAttribute('aria-controls', 'primary-sidebar');
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      await expect(bottomNav).toHaveCount(0);
      const mainBottomPadding = await page
        .locator('main.main')
        .evaluate((main) => Number.parseFloat(getComputedStyle(main).paddingBottom));
      expect(mainBottomPadding).toBeLessThan(64);

      await menuButton.focus();
      await page.keyboard.press('Enter');
      await expect(overlay).toBeVisible();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(overlay).toBeHidden();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      await expect(menuButton).toBeFocused();

      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(viewport.width);

      if (viewport.height === 320) {
        const nav = page.locator('.sidebar__nav');
        const dimensions = await nav.evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight
        }));
        expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
        await nav.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(await nav.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }

      // The visible close button, outside click, and navigation still dismiss the drawer.
      await menuButton.click();
      await expect(overlay).toBeVisible();
      await page.locator('.sidebar__close').click();
      await expect(overlay).toBeHidden();
      await expect(menuButton).toBeFocused();

      await menuButton.click();
      await expect(overlay).toBeVisible();
      const outsidePoint = await page.evaluate(() => {
        const overlayElement = document.querySelector<HTMLElement>('.sidebar-overlay');
        const sidebarElement = document.querySelector<HTMLElement>('.sidebar');
        if (!overlayElement || !sidebarElement) throw new Error('Falta el drawer móvil');

        const overlayRect = overlayElement.getBoundingClientRect();
        const sidebarRect = sidebarElement.getBoundingClientRect();
        const outsideStart = Math.max(overlayRect.left, sidebarRect.right);
        return {
          x: Math.floor((outsideStart + overlayRect.right) / 2),
          y: Math.floor((overlayRect.top + overlayRect.bottom) / 2)
        };
      });
      expect(
        await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('sidebar-overlay'),
          outsidePoint
        )
      ).toBe(true);
      await page.mouse.click(outsidePoint.x, outsidePoint.y);
      await expect(overlay).toBeHidden();
      await expect(menuButton).toBeFocused();

      await menuButton.click();
      await page.locator('.sidebar__nav').getByRole('link', { name: 'Recetas' }).click();
      await expect(page).toHaveURL(/\/recipes/);
      await expect(overlay).toBeHidden();
      await expect(menuButton).toBeFocused();
      await expect(page.locator('.sidebar a[aria-current="page"]')).toHaveAttribute(
        'href',
        '/recipes'
      );
      await page.goto('/dashboard');
    }

    for (const width of [1024, 1025, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(menuButton).toBeHidden();
      await expect(sidebar).toBeVisible();
      await expect(overlay).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(sidebar).toBeVisible();
      expect((await sidebar.boundingBox())?.x).toBe(0);
    }

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: join(screenshotDirectory, 'main-layout-drawer-desktop.png'),
        animations: 'disabled'
      });
      await page.setViewportSize({ width: 393, height: 851 });
      await menuButton.click();
      await expect(overlay).toBeVisible();
      await page.screenshot({
        path: join(screenshotDirectory, 'main-layout-drawer-mobile.png'),
        animations: 'disabled'
      });
    }
  });

  test('keeps every primary route reachable and active without mobile bottom navigation', async ({
    page
  }) => {
    const routes = [
      '/dashboard',
      '/pantry',
      '/recipes',
      '/calendar',
      '/shopping',
      '/receipts',
      '/household',
      '/settings'
    ];
    const viewports = [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 1023, height: 768 },
      { width: 1440, height: 900 }
    ];

    await page.setViewportSize(viewports[0]);
    await registerWithHousehold(page, '/dashboard', 'Drawer route family audit');

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const isMobile = viewport.width < 1024;
      const shellGeometryBySelector = new Map<string, number[]>();
      for (const route of routes) {
        const menuButton = page.locator('.header__menu');
        const needsNavigation = (await page.evaluate(() => location.pathname)) !== route;
        if (needsNavigation) {
          if (isMobile) {
            await menuButton.click();
            await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
          }
          await page.locator(`.sidebar a[href="${route}"]`).click();
        }

        await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
        await expect(page.locator('.bottom-nav')).toHaveCount(0);
        await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
        if (isMobile) await expect(menuButton).toBeVisible();
        else await expect(menuButton).toBeHidden();
        const activeRoute = page.locator('.sidebar a[aria-current="page"]');
        await expect(activeRoute).toHaveCount(1);
        await expect(activeRoute).toHaveAttribute('href', route);
        if (isMobile && needsNavigation) {
          await expect(
            menuButton,
            `focus should return after ${route} at ${viewport.width}px`
          ).toBeFocused();
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${route} at ${viewport.width}x${viewport.height} must not overflow horizontally`
        ).toBe(true);

        if (isMobile) {
          await menuButton.click();
          await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
          await expect(page.locator('.sidebar-overlay')).toBeVisible();
          await expect
            .poll(() =>
              page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().left)
            )
            .toBeGreaterThanOrEqual(0);
        }

        const shellGeometry = await page.evaluate(() => {
          const selectors = [
            '.header',
            '.header__menu',
            '.header__profile',
            '.sidebar',
            '.sidebar__header',
            '.sidebar__nav',
            '.sidebar__footer',
            '.sidebar__account',
            'main.main',
            'main app-page-container'
          ];
          return Object.fromEntries(
            selectors.map((selector) => {
              const element = document.querySelector<HTMLElement>(selector);
              if (!element) throw new Error(`Missing shared shell element: ${selector}`);
              const bounds = element.getBoundingClientRect();
              const horizontalOnly =
                selector === 'main.main' || selector === 'main app-page-container';
              return [
                selector,
                [
                  bounds.left,
                  ...(horizontalOnly ? [] : [bounds.top]),
                  bounds.width,
                  ...(horizontalOnly ? [] : [bounds.height])
                ].map((value) => Math.round(value * 10) / 10)
              ];
            })
          );
        });
        for (const [selector, values] of Object.entries(shellGeometry)) {
          const baseline = shellGeometryBySelector.get(selector);
          if (!baseline) {
            shellGeometryBySelector.set(selector, values);
            continue;
          }
          expect(values, `${selector} should expose same geometry across routes`).toHaveLength(
            baseline.length
          );
          for (const [index, value] of values.entries()) {
            expect(
              Math.abs(value - baseline[index]),
              `${selector} geometry differs by more than 1 CSS px across routes at ${viewport.width}px`
            ).toBeLessThanOrEqual(1);
          }
        }

        if (isMobile) {
          await page.keyboard.press('Escape');
          await expect(page.locator('.sidebar-overlay')).toBeHidden();
          await expect(menuButton).toBeFocused();
        }
      }
    }
  });

  test('navigating from the drawer account action closes it without hiding desktop navigation', async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await registerWithHousehold(page, '/dashboard', 'Drawer profile navigation');

    const accountName = page.locator('#account-name');
    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    for (const viewport of [
      { width: 393, height: 851 },
      { width: 320, height: 568 },
      { width: 568, height: 320 },
      { width: 1023, height: 768 }
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard');
      const menuButton = page.locator('.header__menu');
      const overlay = page.locator('.sidebar-overlay');
      const sidebar = page.locator('.sidebar');
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      await expect(overlay).toBeHidden();

      await menuButton.click();
      await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
      await expect(overlay).toBeVisible();
      await page.locator('.sidebar__account-main').click();

      await expect(page).toHaveURL(/\/account/);
      await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
      await expect(overlay).toBeHidden();
      await expect(sidebar).not.toBeInViewport();
      await expect(menuButton).toBeFocused();
      await accountName.scrollIntoViewIfNeeded();
      await expect(accountName).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width
      );

      if (screenshotDirectory && viewport.width === 393) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(screenshotDirectory, `${testInfo.project.name}-account-mobile-closed.png`),
          animations: 'disabled',
          fullPage: false
        });
      }
    }

    for (const width of [1024, 1025, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.header__menu')).toBeHidden();
      const sidebar = page.locator('.sidebar');
      await expect(sidebar).toBeInViewport();
      await expect.poll(async () => (await sidebar.boundingBox())?.x).toBe(0);
      await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
      await expect(accountName).toBeVisible();
      if (screenshotDirectory && width === 1440) {
        await page.screenshot({
          path: join(screenshotDirectory, `${testInfo.project.name}-account-desktop.png`),
          animations: 'disabled',
          fullPage: false
        });
      }
    }
  });

  test('mobile and desktop navigation preserve direct routes and browser history', async ({
    page
  }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await registerWithHousehold(page, '/dashboard', 'Shell browser history');

    await page.locator('.header__menu').click();
    const mobileRecipes = page.locator('.sidebar__nav .sidebar__item[href="/recipes"]');
    await expect(mobileRecipes).toBeVisible();
    await mobileRecipes.click();
    await expect(page).toHaveURL(/\/recipes$/);
    await expect(page.locator('app-recipes')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('app-dashboard')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/recipes$/);
    await expect(page.locator('app-recipes')).toBeVisible();

    // Deep links and the desktop sidebar must reach the same routed views.
    await page.goto('/dashboard');
    await expect(page.locator('app-dashboard')).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    const desktopPantry = page.locator('.sidebar__nav .sidebar__item[href="/pantry"]');
    await expect(desktopPantry).toBeVisible();
    await desktopPantry.click();
    await expect(page).toHaveURL(/\/pantry$/);
    await expect(page.locator('app-pantry')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('app-dashboard')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/pantry$/);
    await expect(page.locator('app-pantry')).toBeVisible();
  });
});
