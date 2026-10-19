import { expect, test } from './fixtures';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('password visibility stays operable by keyboard and updates its localized accessible name', async ({
  page
}) => {
  const applicationErrors: string[] = [];
  const blockedFontHosts = new Set<string>();
  page.on('pageerror', (error) => applicationErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      applicationErrors.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (new URL(response.url()).origin === new URL(page.url()).origin && response.status() >= 400) {
      applicationErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      blockedFontHosts.add(url.hostname);
    } else if (url.origin === new URL(page.url()).origin) {
      applicationErrors.push(`Request failed ${url.pathname}`);
    } else {
      applicationErrors.push(`External request failed ${url.hostname}`);
    }
  });

  await page.goto('/auth/login');
  await page.waitForTimeout(500);

  const password = page.locator('#password');
  const toggle = page.locator('.input__toggle');
  await expect(toggle).toHaveAccessibleName('Mostrar contraseña');

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 568, height: 320 }
  ]) {
    await page.setViewportSize(viewport);
    await toggle.scrollIntoViewIfNeeded();
    const box = await toggle.boundingBox();
    const wrapper = await page.locator('#password').locator('xpath=..').boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.x).toBeGreaterThanOrEqual(wrapper?.x ?? Number.POSITIVE_INFINITY);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (wrapper?.x ?? 0) + (wrapper?.width ?? 0) + 1
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const screenshotDir = resolve('.e2e-screenshots/qa-ui-3a');
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDir, 'password-toggle-desktop.png') });

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveAccessibleName('Ocultar contraseña');
  await expect(toggle).toHaveClass(/input__toggle--visible/);
  expect(await toggle.evaluate(element => getComputedStyle(element, '::after').content)).not.toBe('none');

  await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'en'));
  await page.reload();
  await page.waitForTimeout(500);
  await expect(toggle).toHaveAccessibleName('Show password');

  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(toggle).toHaveAccessibleName('Hide password');

  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(toggle).toHaveAccessibleName('Show password');
  await expect(toggle).not.toHaveClass(/input__toggle--visible/);
  expect(await toggle.evaluate(element => getComputedStyle(element, '::after').content)).toBe('none');

  await page.evaluate(() => localStorage.setItem('hogar:v1:language', 'es'));
  await page.reload();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: 393, height: 851 });
  await page.screenshot({ path: resolve(screenshotDir, 'password-toggle-mobile.png') });
  expect(applicationErrors).toEqual([]);
  if (blockedFontHosts.size) {
    test.info().annotations.push({
      type: 'environment-limitation',
      description: `Font CDN blocked in this environment: ${[...blockedFontHosts].join(', ')}`
    });
  }
});
