import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../fixtures';
import { createHousehold, logout, registerUser } from '../helpers/auth';
import { seededEmail } from '../helpers/seed';

test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

test('registration from an invite link preserves the code and joins that household once', async ({
  page
}) => {
  const pageErrors: string[] = [];
  const failedScripts: string[] = [];
  const scriptRequests: string[] = [];
  let registrationRequests = 0;
  let joinRequests = 0;
  const inviteeName = 'QA invitee from registration';
  const inviteeEmail = seededEmail();

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'script') failedScripts.push(request.url());
  });
  page.on('request', (request) => {
    if (request.resourceType() === 'script') {
      scriptRequests.push(new URL(request.url()).pathname);
    }
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'POST' && pathname === '/api/auth/register') {
      registrationRequests += 1;
    }
    if (request.method() === 'POST' && /^\/api\/household\/join\//.test(pathname)) {
      joinRequests += 1;
    }
  });

  await registerUser(page, 'QA invite owner');
  await createHousehold(page, 'QA registration invite home');
  const invitationUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const code = new URL(invitationUrl).pathname.split('/').filter(Boolean).at(-1);
  expect(code).toBeTruthy();

  await logout(page);
  const scriptsBeforeInvite = new Set(scriptRequests);
  await page.goto(`/invite/${encodeURIComponent(code!)}`);
  await expect(page.locator('.invite-card__title')).toContainText('QA registration invite home');
  expect(failedScripts).toEqual([]);
  expect(
    scriptRequests.some(
      (url) => url.startsWith('/chunk-') && url.endsWith('.js') && !scriptsBeforeInvite.has(url)
    ),
    'visitar una invitación pública carga un chunk lazy nuevo'
  ).toBe(true);
  const screenshotRoot = process.env.E2E_SCREENSHOT_DIR;
  if (screenshotRoot) {
    const screenshotDirectory = join(screenshotRoot, test.info().project.name);
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, 'invite-route-after-lazy-load.png'),
      animations: 'disabled'
    });
  }

  const registerLink = page.locator('a[href^="/auth/register"]');
  const registerTarget = new URL((await registerLink.getAttribute('href'))!, page.url());
  expect(registerTarget.pathname).toBe('/auth/register');
  expect(registerTarget.searchParams.get('code')).toBe(code);
  await registerLink.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === '/auth/register' && url.searchParams.get('code') === code
  );

  const registrationResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/auth/register' &&
      response.request().method() === 'POST'
  );
  const joinResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/household/join/${code}` &&
      response.request().method() === 'POST'
  );

  await page.locator('#name').fill(inviteeName);
  await page.locator('#email').fill(inviteeEmail);
  await page.locator('#password').fill('Test1234');
  registrationRequests = 0;
  await page.locator('button[type="submit"]').click();

  expect((await registrationResponse).status()).toBe(201);
  expect((await joinResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/household$/);
  await expect(page.locator('.household-info__name')).toHaveText('QA registration invite home');
  await page.getByRole('tab', { name: 'Miembros' }).click();
  await expect(page.locator('.member-card')).toHaveCount(2);
  expect(registrationRequests).toBe(1);
  expect(joinRequests).toBe(1);
  expect(pageErrors).toEqual([]);

  await page.reload();
  await expect(page.locator('.member-card')).toHaveCount(2);
  await page.goto('/household');
  await expect(page.locator('.household-info__name')).toHaveText('QA registration invite home');
  expect(pageErrors).toEqual([]);
});
