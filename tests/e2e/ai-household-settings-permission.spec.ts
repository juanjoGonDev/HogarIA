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
    await expect(memberPage.locator('[data-test="household-ai-config"]')).toHaveCount(0);

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
    await memberPage.goto('/household?tab=settings');
    const embeddedConfig = memberPage.locator('[data-test="household-ai-config"]');
    await expect(embeddedConfig).toBeVisible();
    await expect(
      embeddedConfig.getByRole('heading', { name: 'Configuración IA', level: 2 })
    ).toBeVisible();
    await expect(embeddedConfig.locator('h1.ai-config__title')).toHaveCount(0);
    await expect(memberPage.locator('.sidebar__nav a[href="/ai-config"]')).toHaveCount(0);

    const viewport =
      test.info().project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 };
    await memberPage.setViewportSize(viewport);
    await expect
      .poll(() => memberPage.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    const screenshotPath = resolve(
      `.e2e-screenshots/ai-household-settings/${test.info().project.name}-embedded.png`
    );
    await mkdir(dirname(screenshotPath), { recursive: true });
    await memberPage.screenshot({
      path: screenshotPath,
      fullPage: false,
      animations: 'disabled'
    });

    const createProvider = async (name: string) => {
      await memberPage.getByRole('button', { name: 'Agregar configuración' }).first().click();
      await memberPage.locator('input#name').fill(name);
      await memberPage.locator('input#model').fill('fixture-model');
      await memberPage.locator('input#baseUrl').fill('http://127.0.0.1:9/v1');
      await memberPage.locator('input#apiKey').fill('fixture-only-not-a-secret');
      const saved = memberPage.waitForResponse(
        (response) =>
          response.url().endsWith('/api/ai/configs') && response.request().method() === 'POST'
      );
      await memberPage.locator('app-modal button[type="submit"]').click();
      expect((await saved).status()).toBe(201);
    };
    await createProvider('Geometría 1');
    await createProvider('Geometría 2');
    await expect(memberPage.locator('.function-provider-row select')).toHaveCount(5);
    const householdAction = await memberPage
      .locator('.ai-config__header app-button button')
      .boundingBox();
    const householdSelectHeights = await memberPage
      .locator('.function-provider-row select')
      .evaluateAll((selects) => selects.map((select) => select.getBoundingClientRect().height));

    await memberPage.goto('/ai-config');
    await expect(memberPage).toHaveURL(/\/ai-config$/);
    await expect(memberPage.locator('.function-provider-row select')).toHaveCount(5);
    const directAction = await memberPage
      .locator('.ai-config__header app-button button')
      .boundingBox();
    const directSelectHeights = await memberPage
      .locator('.function-provider-row select')
      .evaluateAll((selects) => selects.map((select) => select.getBoundingClientRect().height));
    expect(householdAction).not.toBeNull();
    expect(directAction).not.toBeNull();
    expect(Math.abs(householdAction!.width - directAction!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(householdAction!.height - directAction!.height)).toBeLessThanOrEqual(1);
    expect(directSelectHeights).toHaveLength(householdSelectHeights.length);
    householdSelectHeights.forEach((height, index) => {
      expect(Math.abs(height - directSelectHeights[index])).toBeLessThanOrEqual(1);
    });
  } finally {
    await memberContext.close();
  }
});
