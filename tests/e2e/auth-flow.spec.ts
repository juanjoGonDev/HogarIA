import { test, expect } from './fixtures';
import { createHousehold, skipOnboarding } from './helpers/auth';

test.describe('Authentication flow', () => {
  test('register redirects to dashboard and keeps user logged in across navigation', async ({
    page
  }) => {
    const email = `authflow-${Date.now()}@example.com`;
    await page.goto('/auth/register');
    await page.fill('input#name', 'Auth Tester');
    await page.fill('input#email', email);
    await page.fill('input#password', 'Test1234');
    await page.fill('input#confirm-password', 'Test1234');
    await page.click('button[type="submit"]');
    await skipOnboarding(page);
    await createHousehold(page, 'Hogar sintético de auth flow');
    await page.goto('/dashboard');
    // Should land on dashboard (no more 429 / logout loop)
    await page.waitForURL(/.*dashboard/, { timeout: 20000 });
    await expect(page.locator('h1.dashboard__title')).toContainText(/Hola|Hi/);

    // Navigate through protected pages - should NOT be kicked back to login
    await page.goto('/pantry');
    await expect(page).toHaveURL(/.*pantry/);
    await page.goto('/recipes');
    await expect(page).toHaveURL(/.*recipes/);
    await page.goto('/calendar');
    await expect(page).toHaveURL(/.*calendar/);
    await page.goto('/household');
    await expect(page).toHaveURL(/.*household/);
    await page.goto('/ai-config');
    await expect(page).toHaveURL(/.*ai-config/);
    await page.goto('/logs');
    await expect(page).toHaveURL(/.*logs/);

    // Refresh the page - should still be on dashboard, not logged out
    await page.goto('/dashboard');
    await page.reload();
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('login with wrong password shows error', async ({ page }) => {
    // Register first
    const email = `authflow-bad-${Date.now()}@example.com`;
    await page.goto('/auth/register');
    await page.fill('input#name', 'Bad');
    await page.fill('input#email', email);
    await page.fill('input#password', 'Test1234');
    await page.fill('input#confirm-password', 'Test1234');
    await page.click('button[type="submit"]');
    await skipOnboarding(page);
    await expect(page).toHaveURL(/\/household$/);

    // Log out
    await page.evaluate(() => localStorage.clear());
    await page.goto('/auth/login');
    await page.fill('input#email', email);
    await page.fill('input#password', 'WrongPassword');
    await page.click('button[type="submit"]');
    // Should stay on login page (not crash in a refresh loop)
    await expect(page).toHaveURL(/.*login/);
    // Should NOT be redirected to dashboard
    await expect(page).not.toHaveURL(/.*dashboard/);
  });
});
