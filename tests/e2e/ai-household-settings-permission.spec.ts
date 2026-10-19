import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { createHousehold, registerUser } from './helpers/auth';

test('la configuración IA del hogar respeta settings en navegación directa y lateral', async ({
  page,
  browser
}) => {
  await registerUser(page, 'Admin sintético IA hogar');
  await createHousehold(page, 'Casa sintética IA permisos');

  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
  expect(inviteCode).toBeTruthy();

  const memberContext = await browser.newContext({ locale: 'es-ES' });
  const memberPage = await memberContext.newPage();
  try {
    await registerUser(memberPage, 'Miembro sintético IA');
    await memberPage.goto('/household');
    await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
    const joinDialog = memberPage.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(memberPage.locator('.household-info__name')).toHaveText(
      'Casa sintética IA permisos'
    );

    await memberPage.goto('/ai-config');
    await expect(memberPage).toHaveURL(/\/household\?tab=settings$/);
    await expect(memberPage.locator('.sidebar__nav a[href="/ai-config"]')).toHaveCount(0);

    await page.goto('/household?tab=permissions');
    const memberPicker = page.locator('[data-test="permissions-member-select"]');
    await memberPicker.getByRole('button').click();
    await memberPicker.getByRole('option', { name: /Miembro sintético IA/ }).click();
    const aiSettingsPermission = page.locator('[data-test="permission-settings-settings"]');
    await expect(aiSettingsPermission).not.toBeChecked();
    await aiSettingsPermission.check();
    await page.locator('[data-test="permissions-save"]').click();
    await expect(page.locator('.toast--success')).toBeVisible();

    await memberPage.reload();
    await memberPage.goto('/ai-config');
    await expect(memberPage).toHaveURL(/\/ai-config$/);
    await expect(memberPage.locator('.sidebar__nav a[href="/ai-config"]')).toBeVisible();
    await expect(memberPage.getByRole('heading', { name: 'Configuración IA' })).toBeVisible();

    const viewport =
      test.info().project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 };
    await memberPage.setViewportSize(viewport);
    await expect
      .poll(() => memberPage.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    const screenshotPath = resolve(
      `.e2e-screenshots/ai-household-settings/${test.info().project.name}-permitted.png`
    );
    await mkdir(dirname(screenshotPath), { recursive: true });
    await memberPage.screenshot({
      path: screenshotPath,
      fullPage: false,
      animations: 'disabled'
    });
  } finally {
    await memberContext.close();
  }
});
