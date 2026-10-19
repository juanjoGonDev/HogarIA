import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, logout, registerUser } from './helpers/auth';

const INVITE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 },
  { width: 1440, height: 900 }
];

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

async function getInviteCode(page: Page): Promise<string> {
  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const code = new URL(inviteUrl).pathname.split('/').filter(Boolean).at(-1);
  if (!code) throw new Error('The synthetic household did not expose an invite code.');
  return code;
}

async function assertNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  const scrollWidth = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  );
  expect(scrollWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(width);
}

test('authenticated invite acceptance stays recoverable and joins the intended household', async ({
  page
}, testInfo) => {
  const pageErrors = collectPageErrors(page);
  await registerUser(page, 'Inviter QA');
  await createHousehold(page, 'Casa de invitación QA');
  const code = await getInviteCode(page);

  await logout(page);
  await page.goto(`/invite/${code}`);
  await expect(page.locator('.invite-card__title')).toContainText('Casa de invitación QA');
  const loginLink = page.locator('a[href^="/auth/login"]');
  const registerLink = page.locator('a[href^="/auth/register"]');
  const codeQuery = new RegExp(`[?&]code=${code}(?:&|$)`);
  await expect(loginLink).toHaveAttribute('href', codeQuery);
  await expect(registerLink).toHaveAttribute('href', codeQuery);

  const screenshotDir = join(process.cwd(), '.e2e-screenshots', 'qa-invite-actions');
  mkdirSync(screenshotDir, { recursive: true });
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertNoHorizontalOverflow(page, 1440);
    await page.screenshot({ path: join(screenshotDir, 'invite-preview-desktop.png') });
  } else if (testInfo.project.name === 'mobile-chrome') {
    await page.setViewportSize({ width: 393, height: 851 });
    await assertNoHorizontalOverflow(page, 393);
    await page.screenshot({ path: join(screenshotDir, 'invite-preview-mobile.png') });
  }

  const undersizedTargets: string[] = [];
  for (const viewport of INVITE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page, viewport.width);
    const card = await page.locator('.invite-card').boundingBox();
    expect(card).not.toBeNull();
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(viewport.width);
    for (const link of [loginLink, registerLink]) {
      const button = link.locator('app-button button');
      const bounds = await button.boundingBox();
      expect(bounds, `${await link.innerText()} button has no bounds`).not.toBeNull();
      if (bounds!.height < 44) {
        undersizedTargets.push(
          `${await link.innerText()} at ${viewport.width}px: ${bounds!.height}px`
        );
      }
    }
  }

  await registerUser(page, 'Invitado QA');
  await page.goto(`/invite/${code}`);
  const acceptButton = page.getByRole('button', { name: 'Unirme al hogar', exact: true });
  const declineButton = page.getByRole('button', { name: 'Cancelar', exact: true });
  await expect(acceptButton).toBeVisible();
  await expect(declineButton).toBeVisible();
  for (const viewport of INVITE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page, viewport.width);
    for (const button of [acceptButton, declineButton]) {
      const bounds = await button.boundingBox();
      expect(bounds, `${await button.innerText()} has no bounds`).not.toBeNull();
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
  }

  let joinRequests = 0;
  let releaseFirstRequest: (() => void) | undefined;
  await page.route(`**/api/household/join/${code}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    joinRequests += 1;
    if (joinRequests === 1) {
      await new Promise<void>((resolve) => (releaseFirstRequest = resolve));
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic temporary failure' })
      });
      return;
    }
    await route.continue();
  });

  await acceptButton.focus();
  const failedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/household/join/${code}`) &&
      response.request().method() === 'POST'
  );
  await page.keyboard.press('Enter');
  await expect.poll(() => joinRequests).toBe(1);
  await expect(acceptButton).toBeDisabled();
  await expect(declineButton).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect.poll(() => joinRequests).toBe(1);
  releaseFirstRequest?.();
  expect((await failedResponse).status()).toBe(503);

  await expect(page).toHaveURL(new RegExp(`/invite/${code}$`));
  await expect(acceptButton).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.locator('.invite-card__error[role="alert"]')).toHaveText(
    'No se pudo unir al hogar'
  );
  await expect(page.locator('.toast--error')).toHaveCount(0);

  const errorViewport =
    testInfo.project.name === 'mobile-chrome'
      ? { width: 393, height: 851 }
      : { width: 1440, height: 900 };
  await page.setViewportSize(errorViewport);
  await assertNoHorizontalOverflow(page, errorViewport.width);
  await page.screenshot({
    path: join(
      screenshotDir,
      testInfo.project.name === 'mobile-chrome'
        ? 'invite-accept-error-mobile.png'
        : 'invite-accept-error-desktop.png'
    )
  });

  const successfulResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/household/join/${code}`) &&
      response.request().method() === 'POST' &&
      response.status() === 200
  );
  await acceptButton.focus();
  await page.keyboard.press('Enter');
  expect((await successfulResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/household$/);
  await expect(page.locator('.household-info__name')).toHaveText('Casa de invitación QA');
  await page.getByRole('tab', { name: 'Miembros' }).click();
  await expect(page.locator('.member-card')).toHaveCount(2);
  expect(joinRequests).toBe(2);
  await expect(page.locator('.toast--error')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.member-card')).toHaveCount(2);
  expect(pageErrors, 'invite flow should not throw in the browser').toEqual([]);
  expect(undersizedTargets, 'all invitation CTAs should have 44px targets').toEqual([]);
});

test('declining a valid invitation does not add the user to the household', async ({ page }) => {
  await registerUser(page, 'Inviter cancel QA');
  await createHousehold(page, 'Casa sin aceptar QA');
  const code = await getInviteCode(page);

  await logout(page);
  await registerUser(page, 'Invitado que rechaza QA');
  await page.goto(`/invite/${code}`);
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();

  let joinRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/api/household/join/${code}`)) {
      joinRequests += 1;
    }
  });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).not.toBe(`/invite/${code}`);
  expect(joinRequests).toBe(0);

  await page.goto(`/invite/${code}`);
  await expect(page.getByRole('button', { name: 'Unirme al hogar', exact: true })).toBeVisible();
  await expect(page.locator('.invite-card__info')).toHaveCount(0);
  expect(joinRequests).toBe(0);
});

test('regenerating an invite invalidates the previous public link', async ({ page }) => {
  await registerUser(page, 'Owner regenerate QA');
  await createHousehold(page, 'Casa con código rotatorio QA');
  const previousCode = await getInviteCode(page);

  const regenerated = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/household/regenerate-invite') &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Regenerar', exact: true }).click();
  expect((await regenerated).status()).toBe(200);
  await expect(page.locator('.invite-card__code')).not.toContainText(previousCode);

  const invalidatedPreview = page.waitForResponse((response) =>
    response.url().endsWith(`/api/household/invite/${previousCode}`)
  );
  await page.goto(`/invite/${previousCode}`);
  expect((await invalidatedPreview).status()).toBe(404);
  await expect(page.locator('.invite-card__title')).toHaveText('Invitación no válida');
});
