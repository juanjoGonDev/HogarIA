import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, registerUser } from './helpers/auth';

async function screenshot(page: Page, name: string): Promise<void> {
  const viewport =
    test.info().project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  const screenshotRoot = process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), '.e2e-screenshots');
  const directory = join(screenshotRoot, 'household-tabs', test.info().project.name);
  while (await page.locator('.toast__close').count()) {
    await page.locator('.toast__close').first().click();
  }
  const path = join(directory, `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
}

test('Hogar organiza miembros, permisos y ajustes en pestañas enlazables', async ({
  page,
  browser
}) => {
  await registerUser(page, 'Administradora sintética de pestañas');
  await createHousehold(page, 'Hogar sintético de pestañas');

  const tabs = page.getByRole('tablist', { name: 'Hogar' });
  const homeTab = tabs.getByRole('tab', { name: 'Hogar' });
  const membersTab = tabs.getByRole('tab', { name: 'Miembros' });
  const permissionsTab = tabs.getByRole('tab', { name: 'Permisos' });
  const settingsTab = tabs.getByRole('tab', { name: 'Ajustes' });

  await expect(homeTab).toHaveAttribute('aria-selected', 'true');
  await expect(homeTab).toHaveAttribute('tabindex', '0');
  await expect(page).not.toHaveURL(/[?&]tab=/);
  for (const tab of [homeTab, membersTab, permissionsTab, settingsTab]) {
    const panelId = await tab.getAttribute('aria-controls');
    const tabId = await tab.getAttribute('id');
    expect(panelId).toBeTruthy();
    expect(tabId).toBeTruthy();
    if (!panelId || !tabId) throw new Error('Household tabs require stable panel and tab IDs.');
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute('aria-labelledby', tabId);
    if (tab === homeTab) await expect(panel).toBeVisible();
    else await expect(panel).toBeHidden();
  }
  await expect(page.locator('.invite-card')).toBeVisible();
  await screenshot(page, 'home');

  await membersTab.click();
  await expect(page).toHaveURL(/[?&]tab=members/);
  await expect(membersTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-test="household-panel-members"]')).toBeVisible();
  await expect(page.locator('.member-card')).toHaveCount(1);
  await screenshot(page, 'members');

  await settingsTab.click();
  await expect(page).toHaveURL(/[?&]tab=settings/);
  await expect(page.locator('[data-test="household-name-input"]')).toHaveValue(
    'Hogar sintético de pestañas'
  );
  await page.locator('[data-test="household-name-input"]').fill('  Hogar renombrado QA  ');
  await page.getByRole('button', { name: 'Guardar nombre' }).click();
  await expect(page.locator('[data-test="household-name-input"]')).toHaveValue(
    'Hogar renombrado QA'
  );
  await screenshot(page, 'settings');

  await page.goBack();
  await expect(page).toHaveURL(/[?&]tab=members/);
  await expect(membersTab).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(page).toHaveURL(/[?&]tab=settings/);
  await expect(settingsTab).toHaveAttribute('aria-selected', 'true');

  await page.goto('/household?source=shared&tab=permissions');
  await expect(permissionsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]source=shared.*[?&]tab=permissions/);
  await expect(page.locator('[data-test="permissions-member-select"]')).toBeVisible();
  await page.reload();
  await expect(permissionsTab).toHaveAttribute('aria-selected', 'true');

  await permissionsTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => settingsTab.evaluate((tab) => getComputedStyle(tab).outlineStyle))
    .toBe('solid');
  await expect(page).toHaveURL(/[?&]tab=settings/);

  await page.goto('/household?source=shared&tab=not-a-household-tab');
  await expect(homeTab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]source=shared/);
  await expect(page).not.toHaveURL(/[?&]tab=/);

  await page.goto('/household');
  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
  expect(inviteCode).toBeTruthy();

  const memberContext = await browser.newContext({ locale: 'es-ES' });
  const memberPage = await memberContext.newPage();
  try {
    await registerUser(memberPage, 'Miembro sintético de pestañas');
    await memberPage.goto('/household');
    await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
    const joinDialog = memberPage.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(memberPage.locator('.household-info__name')).toHaveText('Hogar renombrado QA');

    await page.reload();
    await page.goto('/household?tab=permissions');
    const memberPicker = page.locator('[data-test="permissions-member-select"]');
    await memberPicker.getByRole('button').click();
    await memberPicker.getByRole('option', { name: /Miembro sintético de pestañas/ }).click();
    await screenshot(page, 'permissions');
    const rolePicker = page.locator('[data-test="permissions-role"]');
    await rolePicker.getByRole('button').click();
    await rolePicker.getByRole('option', { name: 'Niño', exact: true }).click();
    const calendarEdit = page.locator('[data-test="permission-calendar-edit"]');
    await calendarEdit.check();
    await page.locator('[data-test="permissions-save"]').click();
    await expect(page.locator('.toast--success')).toBeVisible();

    await page.goto('/household?tab=members');
    const memberCard = page
      .locator('.member-card')
      .filter({ hasText: 'Miembro sintético de pestañas' });
    await expect(memberCard).toContainText('Niño');
    await page.reload();
    await expect(memberCard).toContainText('Niño');

    await memberPage.goto('/household?tab=permissions');
    await expect(
      memberPage.getByText('Solo los administradores pueden cambiar estos permisos.')
    ).toBeVisible();
    await expect(memberPage.locator('[data-test="permissions-member-select"]')).toHaveCount(0);
    await memberPage.goto('/household?tab=settings');
    await expect(
      memberPage.getByText('Solo los administradores pueden cambiar los ajustes del hogar.')
    ).toBeVisible();
    await expect(memberPage.locator('[data-test="household-name-input"]')).toHaveCount(0);
  } finally {
    await memberContext.close();
  }

  const viewports = [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 568, height: 320 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 }
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await expect(tabs).toBeVisible();
    await expect(homeTab).toBeAttached();
    await expect(membersTab).toBeAttached();
    await expect(permissionsTab).toBeAttached();
    await expect(settingsTab).toBeAttached();
  }
});
