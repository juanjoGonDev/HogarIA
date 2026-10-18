import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';

test.use({ serviceWorkers: 'block' });

async function ensureMobileSidebarOpen(page: Page): Promise<void> {
  if (test.info().project.name !== 'mobile-chrome') return;
  const sidebar = page.locator('.sidebar');
  if (!(await sidebar.evaluate((element) => element.classList.contains('sidebar--open')))) {
    await page.locator('.header__menu').click();
  }
  await expect(sidebar).toHaveClass(/sidebar--open/);
}

test('defers the household picker until a second membership and restores its accessible choice', async ({
  page,
  browser
}) => {
  const isMobile = test.info().project.name === 'mobile-chrome';
  const viewport = isMobile ? { width: 393, height: 851 } : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  const secondContext = await browser.newContext({
    locale: 'es-ES',
    viewport,
    serviceWorkers: 'block'
  });
  const secondPage = await secondContext.newPage();

  try {
    const scriptRequests: string[] = [];
    const switcherChunkUrls = new Set<string>();
    const scriptResponseChecks: Promise<void>[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scriptRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (response.request().resourceType() !== 'script') return;
      scriptResponseChecks.push(
        response
          .text()
          .then((body) => {
            if (body.includes('active-household-select')) switcherChunkUrls.add(response.url());
          })
          .catch(() => undefined)
      );
    });

    await registerUser(page, 'Selector diferido E2E uno');
    await createHousehold(page, 'Hogar sintético único');

    const singleMembershipsLoaded = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/household/memberships') &&
        response.request().method() === 'GET' &&
        response.ok()
    );
    await page.reload();
    await singleMembershipsLoaded;
    await page.goto('/dashboard');
    await expect(page.locator('[data-test="household-switcher"]')).toHaveCount(0);
    await page.waitForTimeout(150);
    await Promise.all(scriptResponseChecks);
    expect(switcherChunkUrls.size, 'un hogar no descarga el chunk del switcher').toBe(0);

    await registerUser(secondPage, 'Selector diferido E2E dos');
    await createHousehold(secondPage, 'Hogar sintético dos');
    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();

    await page.goto('/household');
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético único');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const joinDialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);

    const refreshedMemberships = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/household/memberships') &&
        response.request().method() === 'GET' &&
        response.ok()
    );
    const scriptsBeforeJoin = scriptRequests.length;
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    const membershipsResponse = await refreshedMemberships;
    const activeHouseholdId = (await membershipsResponse.json())?.data?.activeHouseholdId;
    expect(activeHouseholdId).toBeTruthy();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético dos');
    const dismissJoinToast = page.getByRole('button', { name: 'Descartar' });
    if (await dismissJoinToast.isVisible()) await dismissJoinToast.click();

    await ensureMobileSidebarOpen(page);
    const switcher = page.locator('[data-test="household-switcher"]');
    await expect(switcher).toBeVisible();
    await expect.poll(() => switcherChunkUrls.size).toBe(1);
    const [switcherChunkUrl] = [...switcherChunkUrls];
    expect(scriptRequests.slice(scriptsBeforeJoin)).toContain(switcherChunkUrl);
    expect(scriptRequests.filter((url) => url === switcherChunkUrl)).toHaveLength(1);
    const pickerTrigger = switcher.locator('.picker__trigger');
    await expect(pickerTrigger).toHaveAttribute('aria-label', 'Hogar activo: Hogar sintético dos');

    const screenshotDirectory = join(
      process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), '.e2e-screenshots'),
      'household-switcher-lazy-20261018'
    );
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `${test.info().project.name}.png`),
      fullPage: true,
      animations: 'disabled'
    });

    await pickerTrigger.click();
    await page.getByRole('option', { name: 'Hogar sintético único', exact: true }).click();
    await expect(pickerTrigger).toHaveAttribute(
      'aria-label',
      'Hogar activo: Hogar sintético único'
    );
    expect(scriptRequests.filter((url) => url === switcherChunkUrl)).toHaveLength(1);

    await page.locator('.sidebar__nav a[href="/dashboard"]').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await ensureMobileSidebarOpen(page);
    await expect(pickerTrigger).toHaveAttribute(
      'aria-label',
      'Hogar activo: Hogar sintético único'
    );

    await page.reload();
    await ensureMobileSidebarOpen(page);
    await expect(pickerTrigger).toHaveAttribute(
      'aria-label',
      'Hogar activo: Hogar sintético único'
    );
  } finally {
    await secondContext.close();
  }
});
