import { expect, test } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';

test.use({ serviceWorkers: 'block' });

test('carga el shell solo al entrar en una ruta autenticada', async ({ page }) => {
  const layoutChunkUrls = new Set<string>();
  const scriptBodyChecks: Promise<void>[] = [];
  const scriptBodyErrors: string[] = [];

  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return;

    scriptBodyChecks.push(
      response
        .body()
        .then((body) => {
          if (body.includes(Buffer.from('sidebar__nav'))) layoutChunkUrls.add(response.url());
        })
        .catch((error: unknown) => {
          scriptBodyErrors.push(error instanceof Error ? error.message : String(error));
        })
    );
  });

  const verifyNoAuthenticatedShell = async () => {
    await expect(page.locator('app-main-layout')).toHaveCount(0);
    await expect(page.locator('[data-test="ai-assistant-open"]')).toHaveCount(0);
    await Promise.all(scriptBodyChecks.splice(0));
    expect(scriptBodyErrors).toEqual([]);
    expect([...layoutChunkUrls]).toEqual([]);
  };

  for (const route of ['/auth/login', '/invite/SYNTHETIC-INVALID-CODE', '/onboarding']) {
    await page.goto(route);
    if (route === '/onboarding') await expect(page).toHaveURL(/\/auth\/login$/);
    await verifyNoAuthenticatedShell();
  }

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/auth\/login$/);
  await verifyNoAuthenticatedShell();

  await registerUser(page, 'Shell lazy E2E');
  await createHousehold(page, 'Hogar sintético shell lazy');
  await page.goto('/dashboard');
  await expect(page.locator('app-main-layout')).toHaveCount(1);
  await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
  await Promise.all(scriptBodyChecks.splice(0));
  expect(scriptBodyErrors).toEqual([]);
  expect(layoutChunkUrls.size).toBe(1);

  await page.goto('/pantry');
  await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
  await Promise.all(scriptBodyChecks.splice(0));
  expect(scriptBodyErrors).toEqual([]);
  expect(layoutChunkUrls.size).toBe(1);
});
