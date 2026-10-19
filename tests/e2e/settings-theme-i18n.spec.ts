import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test.describe('Settings — theme & i18n', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/settings', 'Tester');
    await expect(page.locator('.settings-group__title').first()).toBeVisible();
  });

  test('settings page renders theme and language sections', async ({ page }) => {
    await expect(page.locator('.settings-group__title').nth(0)).toContainText(/Tema|Theme/);
    await expect(page.getByRole('button', { name: /Claro|Light/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Oscuro|Dark/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sistema|System/ })).toBeVisible();

    await expect(page.locator('.settings-group__title').nth(1)).toContainText(/Idioma|Language/);
    await expect(
      page.locator('.settings-group').nth(1).locator('button.settings-option')
    ).toHaveCount(3);
  });

  test('uses clean labels for themes and languages in both locales', async ({ page }, testInfo) => {
    const visibleText = await page.locator('.settings-title, .settings-group').allTextContents();
    expect(visibleText.join(' ')).not.toMatch(/\p{Extended_Pictographic}/u);
    await expect(page.locator('.settings-title app-icon svg')).toBeVisible();
    await expect(
      page.locator('.settings-group__title').last().locator('app-icon svg')
    ).toBeVisible();

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      const isMobile = testInfo.project.name === 'mobile-chrome';
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.setViewportSize(
        isMobile ? { width: 393, height: 852 } : { width: 1440, height: 900 }
      );
      await page.screenshot({
        path: join(screenshotDirectory, `settings-${isMobile ? 'mobile' : 'desktop'}.png`),
        animations: 'disabled'
      });
    }

    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('.settings-group').nth(1)).toContainText('Language');
    const englishText = await page.locator('.settings-title, .settings-group').allTextContents();
    expect(englishText.join(' ')).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  test('switching to dark theme applies data-theme=dark', async ({ page }) => {
    const darkTheme = page.getByRole('button', { name: /Oscuro|Dark/ });
    await expect(darkTheme).toHaveAttribute('aria-pressed', 'false');
    await darkTheme.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(darkTheme).toHaveAttribute('aria-pressed', 'true');
  });

  test('switching to light theme applies data-theme=light', async ({ page }) => {
    await page.getByRole('button', { name: /Claro|Light/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('theme and language options are operable by keyboard and retain their selected state', async ({
    page
  }) => {
    const dark = page.getByRole('button', { name: /Oscuro|Dark/ });
    await dark.focus();
    await page.keyboard.press('Space');
    await expect(dark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const english = page.getByRole('button', { name: 'English' });
    await english.focus();
    await page.keyboard.press('Enter');
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.settings-group').nth(1)).toContainText('Language');
  });

  test('switching language to English translates the settings page', async ({ page }) => {
    await page.getByRole('button', { name: /English/ }).click();
    await expect(page.locator('.settings-group__title').nth(1)).toHaveText('Language');
  });

  test('language preference persists across reloads', async ({ page }) => {
    const english = page.getByRole('button', { name: /English/ });
    await expect(english).toHaveAttribute('aria-pressed', 'false');
    await english.click();
    await expect(english).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('.settings-group__title').nth(1)).toHaveText('Language');
  });

  test('system theme follows prefers-color-scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/settings');
    await page.getByRole('button', { name: /Sistema|System/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
