import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const MOBILE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 }
];

async function measureFooterButton(page: Page) {
  return page.evaluate(() => {
    const button = document.querySelector<HTMLElement>(
      '.preferences__actions app-button button.btn--primary'
    );
    const bottomNav = document.querySelector<HTMLElement>('.bottom-nav');
    if (!button || !bottomNav) throw new Error('Falta la acción final o la navegación inferior');

    const action = button.getBoundingClientRect();
    const navigation = bottomNav.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const hitTarget = document.elementFromPoint(
      action.left + action.width / 2,
      action.top + action.height / 2
    );

    return {
      action: {
        left: action.left,
        top: action.top,
        right: action.right,
        bottom: action.bottom
      },
      navigation: {
        top: navigation.top,
        right: navigation.right,
        bottom: navigation.bottom,
        left: navigation.left,
        position: getComputedStyle(bottomNav).position
      },
      viewportWidth,
      viewportHeight,
      fullyVisible:
        action.left >= 0 &&
        action.top >= 0 &&
        action.right <= viewportWidth &&
        action.bottom <= viewportHeight,
      aboveNavigation: action.bottom <= navigation.top,
      hitByPointer: hitTarget === button || Boolean(hitTarget && button.contains(hitTarget))
    };
  });
}

test.describe('alcanzabilidad de la acción final de Preferencias', () => {
  test.use({ serviceWorkers: 'block' });

  test('Guardar preferencias queda visible y activable sobre la navegación fija', async ({
    page
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'viewports móviles Pixel 5');

    await registerAndGoto(page, '/preferences', 'Layout end control');
    const goalTab = page.locator('[data-test="preferences-tab-goal"]');
    await goalTab.click();
    await expect(goalTab).toHaveAttribute('aria-selected', 'true');

    const saveButton = page.getByRole('button', { name: 'Guardar preferencias' });
    const lastButton = page.locator('main.main').getByRole('button').last();
    await expect(saveButton).toHaveAccessibleName('Guardar preferencias');
    await expect(lastButton).toHaveAccessibleName('Guardar preferencias');

    for (const viewport of MOBILE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(saveButton).toBeVisible();
      await expect(saveButton).toBeEnabled();
      await saveButton.scrollIntoViewIfNeeded();

      const geometry = await measureFooterButton(page);
      expect(geometry.navigation.position, `${viewport.width}x${viewport.height}`).toBe('fixed');
      expect(
        geometry.fullyVisible,
        `acción final visible en ${viewport.width}x${viewport.height}`
      ).toBe(true);
      expect(
        geometry.aboveNavigation,
        `acción final no solapada por bottom-nav en ${viewport.width}x${viewport.height}`
      ).toBe(true);
      expect(
        geometry.hitByPointer,
        `el centro de la acción final recibe el hit-test en ${viewport.width}x${viewport.height}`
      ).toBe(true);

      const saveResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/auth/taste' &&
          response.request().method() === 'PATCH'
      );
      await saveButton.click();
      expect((await saveResponse).ok()).toBe(true);
      await expect(page.locator('.preferences__state--ok')).toBeVisible();
    }
  });
});
