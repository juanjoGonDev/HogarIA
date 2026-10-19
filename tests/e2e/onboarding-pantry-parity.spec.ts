import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

test.describe('paridad entre onboarding y Despensa', () => {
  test.use({ serviceWorkers: 'block' });

  test('el paso de utensilios solo enlaza; la disponibilidad se cambia en Despensa', async ({
    page
  }) => {
    const pageErrors: string[] = [];
    const utensilWrites: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'PATCH' && /^\/api\/pantry\/utensils\/[^/]+$/.test(url.pathname)) {
        utensilWrites.push(url.pathname);
      }
    });

    await registerAndGoto(page, '/onboarding', 'Pantry Parity Tester');
    await page.locator('[data-level="none"]').click();
    for (let step = 0; step < 5; step += 1) {
      await page.getByRole('button', { name: 'Siguiente →' }).click();
    }

    await expect(page.locator('.onboarding__step-label')).toContainText('Paso 6 de 6 · Cocina');
    const tourUtensilControls = page.locator('.utensil-card__check');
    if ((await tourUtensilControls.count()) > 0) {
      // Baseline sentinel: before parity was fixed, clicking this control caused a real Pantry PATCH.
      const legacyWrite = page.waitForResponse(
        (response) =>
          /^\/api\/pantry\/utensils\/[^/]+$/.test(new URL(response.url()).pathname) &&
          response.request().method() === 'PATCH'
      );
      await tourUtensilControls.first().check();
      expect((await legacyWrite).status()).toBe(200);
    }
    await expect(tourUtensilControls).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);

    const pantryLink = page.getByRole('link', { name: /Gestionar utensilios/i });
    await expect(pantryLink).toHaveAttribute('href', '/pantry?tab=utensils');

    const responsiveWidths = [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 559, height: 851 },
      { width: 560, height: 851 },
      { width: 561, height: 851 },
      { width: 568, height: 320 },
      { width: 1440, height: 900 }
    ];
    for (const viewport of responsiveWidths) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => {
        const card = document.querySelector('.onboarding__card')!.getBoundingClientRect();
        const link = document.querySelector('.onboarding__link-row a')!.getBoundingClientRect();
        return {
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          cardLeft: card.left,
          cardRight: card.right,
          linkLeft: link.left,
          linkRight: link.right,
          linkHeight: link.height,
          touchHeights: Array.from(
            document.querySelectorAll(
              '.onboarding__skip, .onboarding__nav button, .onboarding__link-row a'
            )
          ).map((element) => element.getBoundingClientRect().height),
          overflow: Array.from(document.querySelectorAll('body *'))
            .map((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
                  typeof element.className === 'string' && element.className
                    ? `.${element.className.trim().replaceAll(/\s+/g, '.')}`
                    : ''
                }`,
                left: Math.round(bounds.left),
                right: Math.round(bounds.right),
                width: Math.round(bounds.width)
              };
            })
            .filter((element) => element.right > document.documentElement.clientWidth + 1)
            .slice(0, 6)
        };
      });
      expect(
        geometry.document,
        `document overflow at ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry.overflow)}`
      ).toBeLessThanOrEqual(geometry.viewport);
      expect(
        geometry.linkLeft,
        `CTA left outside card at ${viewport.width}px`
      ).toBeGreaterThanOrEqual(geometry.cardLeft - 1);
      expect(
        geometry.linkRight,
        `CTA right outside card at ${viewport.width}px`
      ).toBeLessThanOrEqual(geometry.cardRight + 1);
      expect(geometry.linkHeight, `CTA touch height at ${viewport.width}px`).toBeGreaterThanOrEqual(
        44
      );
      expect(
        geometry.touchHeights.every((height) => height >= 43.5),
        `small onboarding touch target at ${viewport.width}px: ${geometry.touchHeights.join(',')}`
      ).toBe(true);
    }

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      await mkdir(screenshotDirectory, { recursive: true });
      const project = test.info().project.name;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: join(screenshotDirectory, `onboarding-kitchen-${project}-desktop.png`),
        animations: 'disabled'
      });
      await page.setViewportSize({ width: 393, height: 851 });
      await page.screenshot({
        path: join(screenshotDirectory, `onboarding-kitchen-${project}-mobile.png`),
        animations: 'disabled'
      });
    }

    await page.setViewportSize({ width: 393, height: 851 });
    const profileSaved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/taste' &&
        response.request().method() === 'PATCH'
    );
    await pantryLink.focus();
    await expect(pantryLink).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(pantryLink).toBeFocused();
    expect(await pantryLink.evaluate((link) => getComputedStyle(link).outlineStyle)).not.toBe(
      'none'
    );
    await page.keyboard.press('Enter');
    expect((await profileSaved).status()).toBe(200);
    await expect(page).toHaveURL(/\/pantry\?tab=utensils$/);
    expect(utensilWrites).toEqual([]);

    await page.fill('input#utensilios-q', 'Airfryer');
    const airfryer = page.getByRole('row', { name: /Airfryer/ });
    await expect(airfryer).toBeVisible({ timeout: 20000 });
    const availability = airfryer.getByRole('checkbox', { name: 'Airfryer' }).last();
    const wasAvailable = (await availability.getAttribute('aria-checked')) === 'true';
    const savedUtensil = page.waitForResponse(
      (response) =>
        /^\/api\/pantry\/utensils\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === 'PATCH'
    );
    await availability.click();
    expect((await savedUtensil).status()).toBe(200);
    await expect(availability).toHaveAttribute('aria-checked', String(!wasAvailable));
    await page.reload();
    await page.fill('input#utensilios-q', 'Airfryer');
    const persisted = page
      .getByRole('row', { name: /Airfryer/ })
      .getByRole('checkbox', {
        name: 'Airfryer'
      })
      .last();
    await expect(persisted).toHaveAttribute('aria-checked', String(!wasAvailable));

    await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
    await page.reload();
    await page.goto('/onboarding');
    for (let step = 0; step < 5; step += 1) {
      await page.getByRole('button', { name: 'Next →' }).click();
    }
    await expect(page.locator('.onboarding__step-label')).toContainText('Step 6 of 6 · Kitchen');
    await expect(page.getByRole('link', { name: 'Manage utensils →' })).toHaveAttribute(
      'href',
      '/pantry?tab=utensils'
    );

    await page.goto('/preferences');
    await expect(page.locator('[data-level="none"]')).toHaveClass(/profile-picker__level--on/);
    expect(pageErrors).toEqual([]);
  });
});
