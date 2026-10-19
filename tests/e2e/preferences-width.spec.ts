import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const SCREENSHOTS =
  process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), '.e2e-screenshots', 'preferences-width');

async function capture(
  page: import('@playwright/test').Page,
  name: string,
  fullPage = true
): Promise<void> {
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: join(SCREENSHOTS, name), fullPage, animations: 'disabled' });
}

test.describe('ancho responsive de Preferencias', () => {
  test.use({ serviceWorkers: 'block' });

  test('usa el espacio de escritorio y muestra las pestañas sin scroll', async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'matriz exclusiva de escritorio');
    await registerAndGoto(page, '/preferences', 'preferences-width-desktop');

    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 800 }
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.locator('.preferences-page').evaluate((element) => {
        const page = element.getBoundingClientRect();
        const tabs = element.querySelector('.preferences__tabs');
        return {
          width: page.width,
          tabsWidth: tabs?.clientWidth ?? 0,
          tabsContentWidth: tabs?.scrollWidth ?? 0,
          documentWidth: document.documentElement.scrollWidth
        };
      });

      expect(layout.width, `Preferencias debe aprovechar ${viewport.width}px`).toBeGreaterThan(900);
      expect(
        layout.tabsContentWidth,
        'Las pestañas no deben requerir scroll horizontal en escritorio'
      ).toBeLessThanOrEqual(layout.tabsWidth + 1);
      expect(
        layout.documentWidth,
        'La página no debe desbordarse horizontalmente'
      ).toBeLessThanOrEqual(viewport.width);

      for (const tabId of ['profile', 'allergies', 'tastes', 'meals', 'goal']) {
        const tab = page.locator(`[data-test="preferences-tab-${tabId}"]`);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
      }

      if (viewport.width === 1920) await capture(page, 'preferences-desktop-1920x1080.png');
    }

    const firstTab = page.locator('[data-test="preferences-tab-profile"]');
    await firstTab.focus();
    await page.keyboard.press('Enter');
    await expect(firstTab).toHaveAttribute('aria-selected', 'true');
  });

  test('mantiene padding, acceso táctil a la última pestaña y sin overflow en móvil', async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'matriz exclusiva de móvil');
    await registerAndGoto(page, '/preferences', 'preferences-width-mobile');

    for (const viewport of [
      { width: 393, height: 851 },
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(viewport);
      const tabs = page.locator('.preferences__tabs');
      const goalTab = page.locator('[data-test="preferences-tab-goal"]');
      if (viewport.width === 393) await capture(page, 'preferences-mobile-393x851.png', false);
      await goalTab.tap();
      await expect(goalTab).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => tabs.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

      const geometry = await page.locator('.preferences-page').evaluate((element) => {
        const page = element.getBoundingClientRect();
        const frame = document.querySelector<HTMLElement>(
          'main.main app-page-container.page-container'
        );
        if (!frame) throw new Error('Falta el contenedor compartido de página');
        const container = frame.getBoundingClientRect();
        const frameStyle = getComputedStyle(frame);
        return {
          left: page.left,
          right: page.right,
          documentWidth: document.documentElement.scrollWidth,
          frameLeft: container.left,
          frameRight: container.right,
          framePaddingLeft: Number.parseFloat(frameStyle.paddingLeft),
          framePaddingRight: Number.parseFloat(frameStyle.paddingRight)
        };
      });
      expect(geometry.left, 'Debe conservar gutter lateral').toBeGreaterThanOrEqual(0);
      expect(
        geometry.framePaddingLeft,
        'Debe conservar padding táctil razonable'
      ).toBeGreaterThanOrEqual(12);
      expect(
        geometry.framePaddingRight,
        'Debe conservar gutter en el borde derecho'
      ).toBeGreaterThanOrEqual(12);
      expect(
        geometry.left,
        'La página debe respetar el gutter izquierdo compartido'
      ).toBeGreaterThanOrEqual(geometry.frameLeft + geometry.framePaddingLeft - 1);
      expect(
        geometry.right,
        'La página debe respetar el gutter derecho compartido'
      ).toBeLessThanOrEqual(geometry.frameRight - geometry.framePaddingRight + 1);
      expect(geometry.right, 'La página debe caber en el viewport').toBeLessThanOrEqual(
        viewport.width
      );
      expect(geometry.documentWidth, 'No debe aparecer scroll global').toBeLessThanOrEqual(
        viewport.width
      );
    }
  });
});
