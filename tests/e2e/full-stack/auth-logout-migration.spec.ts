import { expect, test } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';

// This flow uses a real test account; do not persist browser credentials in Playwright artifacts.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('explicit logout cannot be undone by the legacy-storage migration on reload', async ({
  page
}) => {
  await registerAndGoto(page, '/account');
  const logout = page.locator('[data-test="account-logout"]');
  await page.getByRole('tab', { name: /Seguridad|Security/i }).click();
  await expect(logout).toBeVisible();

  // Simulate a browser that has migrated from both historical key formats. Values stay in-page and
  // are never attached to the test report, screenshot, video, or trace.
  await page.evaluate(() => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    const refreshToken = localStorage.getItem('hogar:v1:refresh_token');
    const user = localStorage.getItem('hogar:v1:current_user');
    if (!token || !refreshToken || !user)
      throw new Error('Expected a valid test session before migration.');

    for (const key of ['auth_token', 'recipeapp_auth_token']) localStorage.setItem(key, token);
    for (const key of ['refresh_token', 'recipeapp_refresh_token'])
      localStorage.setItem(key, refreshToken);
    for (const key of ['current_user', 'recipeapp_current_user']) localStorage.setItem(key, user);
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('recipeapp_theme', 'light');
  });

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe('/account');
  await page.getByRole('tab', { name: /Seguridad|Security/i }).click();
  await expect(page.locator('[data-test="account-logout"]')).toBeVisible();

  await page.locator('[data-test="account-logout"]').click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  const stateAfterLogout = await page.evaluate(() => ({
    sessionKeys: [
      'hogar:v1:auth_token',
      'hogar:v1:refresh_token',
      'hogar:v1:current_user',
      'auth_token',
      'refresh_token',
      'current_user',
      'recipeapp_auth_token',
      'recipeapp_refresh_token',
      'recipeapp_current_user'
    ].map((key) => localStorage.getItem(key)),
    theme: localStorage.getItem('hogar:v1:theme'),
    legacyTheme: localStorage.getItem('theme'),
    recipeappTheme: localStorage.getItem('recipeapp_theme')
  }));
  expect(stateAfterLogout.sessionKeys).toEqual(Array(9).fill(null));
  expect(stateAfterLogout.theme).toBe('dark');
  expect(stateAfterLogout.legacyTheme).toBe('dark');
  expect(stateAfterLogout.recipeappTheme).toBe('light');

  await page.reload();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/auth\/login$/);
});
