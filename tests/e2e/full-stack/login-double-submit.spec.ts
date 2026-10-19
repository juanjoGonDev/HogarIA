import { expect, test } from '../fixtures';
import { createHousehold, logout, registerUser } from '../helpers/auth';

test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

function isLoginRequest(request: import('@playwright/test').Request): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api/auth/login');
}

test('login with invite ignores a second submit while authentication is pending', async ({
  page
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await registerUser(page, 'QA owner');
  await createHousehold(page, 'QA invitation home');
  const invitationUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const inviteCode = new URL(invitationUrl).pathname.split('/').at(-1);
  expect(inviteCode).toBeTruthy();

  await logout(page);
  const inviteeEmail = await registerUser(page, 'QA invitee');
  await logout(page);

  let releaseLogin!: () => void;
  const loginGate = new Promise<void>((resolve) => {
    releaseLogin = resolve;
  });
  let signalLoginObserved!: () => void;
  const loginObserved = new Promise<void>((resolve) => {
    signalLoginObserved = resolve;
  });
  let loginRequestCount = 0;
  let joinRequestCount = 0;

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && /\/api\/household\/join(?:\/|$)/.test(url.pathname)) {
      joinRequestCount += 1;
    }
  });

  await page.route('**/api/auth/login', async (route) => {
    loginRequestCount += 1;
    if (loginRequestCount === 1) {
      signalLoginObserved();
      await loginGate;
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Synthetic duplicate login request' })
    });
  });

  try {
    await page.goto(`/auth/login?code=${encodeURIComponent(inviteCode!)}`);
    await page.locator('input#email').fill(inviteeEmail);
    await page.locator('input#password').fill('Test1234');

    const successfulLogin = page.waitForResponse((response) => isLoginRequest(response.request()));
    await page.locator('input#password').press('Enter');
    await loginObserved;
    await expect(page.locator('button[type="submit"]')).toBeDisabled();

    const duplicateLogin = page
      .waitForRequest(isLoginRequest, { timeout: 750 })
      .then(() => true)
      .catch((error: { name?: string }) => {
        if (error.name === 'TimeoutError') return false;
        throw error;
      });
    await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
    expect(await duplicateLogin).toBe(false);
    expect(loginRequestCount).toBe(1);

    releaseLogin();
    expect((await successfulLogin).ok()).toBe(true);
    await expect(page).toHaveURL(/\/household$/);
    expect(loginRequestCount).toBe(1);
    expect(joinRequestCount).toBe(1);
    expect(pageErrors).toEqual([]);
  } finally {
    releaseLogin();
  }
});
