import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Locator } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import { logout, registerAndGoto } from './helpers/auth';

const HOUSEHOLD_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 568, height: 320 },
  { width: 1023, height: 900 },
  { width: 1024, height: 900 },
  { width: 1025, height: 900 },
  { width: 1440, height: 900 }
] as const;

function trackApplicationErrors(page: Page): string[] {
  const errors: string[] = [];
  const appOrigin = process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).origin : '';
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const source = message.location().url;
    if (message.type() === 'error' && source.startsWith(appOrigin)) {
      errors.push(message.text());
    }
  });
  return errors;
}

async function createHouseholdThroughUi(page: Page, name: string): Promise<void> {
  await page.goto('/household');
  await expect(page.locator('.no-household')).toBeVisible();
  await page.getByRole('button', { name: /Crear hogar/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear Hogar' });
  await dialog.getByRole('textbox', { name: 'Nombre del hogar' }).fill(name);
  await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.locator('.household-info__name')).toHaveText(name);
}

async function readInviteCode(page: Page): Promise<string> {
  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const code = new URL(inviteUrl).pathname.split('/').at(-1);
  if (!code) throw new Error('The synthetic household did not expose an invitation code.');
  return code;
}

async function capture(page: Page, name: string): Promise<void> {
  const viewport =
    test.info().project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  const dismissButtons = page.locator('.toast__close');
  while (await dismissButtons.count()) await dismissButtons.first().click();

  const seed = (process.env.E2E_SEED ?? 'local').replace(/[^a-zA-Z0-9_-]/g, '_');
  const output = join(
    process.cwd(),
    '.e2e-screenshots',
    `qa-household-action-ack-${seed}`,
    test.info().project.name,
    name
  );
  await mkdir(dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: true, animations: 'disabled' });
}

async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
}

async function expectDialogWithinViewport(
  page: Page,
  dialog: Locator,
  viewport: { width: number; height: number }
): Promise<void> {
  await expectNoHorizontalOverflow(page, viewport.width);
  await expect
    .poll(async () => {
      const bounds = await dialog.boundingBox();
      return (
        bounds !== null &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= viewport.width + 1 &&
        bounds.y + bounds.height <= viewport.height + 1
      );
    })
    .toBe(true);
}

function errorToast(page: Page, message: string) {
  return page.locator('.toast--error').filter({ hasText: message });
}

function successToast(page: Page, message: string) {
  return page.locator('.toast--success').filter({ hasText: message });
}

function expectNoUnexpectedApplicationErrors(
  errors: string[],
  expectedHttpStatuses: number[] = []
): void {
  const unexpected = errors.filter(
    (error) =>
      !expectedHttpStatuses.some((status) =>
        error.includes(`Failed to load resource: the server responded with a status of ${status} (`)
      )
  );
  expect(unexpected).toEqual([]);
}

test.describe('acciones de Hogar: confirmación real y reintento', () => {
  test('pausa y reactiva una membresía sin borrar sus datos', async ({ browser }) => {
    const viewport =
      test.info().project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 };
    const ownerContext = await browser.newContext({ viewport });
    const ownerPage = await ownerContext.newPage();
    const memberContext = await browser.newContext({ viewport });
    const memberPage = await memberContext.newPage();

    try {
      await registerAndGoto(ownerPage, '/household', 'Owner membership QA');
      await createHouseholdThroughUi(ownerPage, 'Hogar sintético de membresías');
      const inviteCode = await readInviteCode(ownerPage);

      await registerAndGoto(memberPage, '/household', 'Guest membership QA');
      await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
      const joinDialog = memberPage.getByRole('dialog', { name: 'Unirse a un Hogar' });
      await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode);
      await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
      await expect(memberPage.locator('.household-info__name')).toHaveText(
        'Hogar sintético de membresías'
      );

      await ownerPage.reload();
      await ownerPage.goto('/household?tab=members');
      const memberCard = ownerPage
        .locator('.member-card')
        .filter({ hasText: 'Guest membership QA' });
      const deactivate = memberCard.locator('[data-test^="member-active-"]');
      await expect(deactivate).toHaveText('Desactivar');
      let failedDeactivation = false;
      await ownerPage.route('**/api/household', async (route) => {
        if (
          route.request().method() === 'PATCH' &&
          !failedDeactivation &&
          (route.request().postDataJSON() as { memberActive?: boolean } | null)?.memberActive ===
            false
        ) {
          failedDeactivation = true;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ success: false, message: 'Synthetic temporary failure' })
          });
          return;
        }
        await route.continue();
      });

      await deactivate.locator('button').focus();
      await ownerPage.keyboard.press('Enter');

      const confirmation = ownerPage.getByRole('dialog', { name: 'Desactivar' });
      await expect(confirmation).toContainText('Sus datos se conservarán');
      await confirmation.getByRole('button', { name: 'Desactivar miembro' }).click();
      await expect(errorToast(ownerPage, 'No se pudo cambiar el estado del miembro')).toBeVisible();
      await expect(memberCard).toContainText('Activo');
      await expect(deactivate).toHaveText('Desactivar');

      await deactivate.locator('button').focus();
      await ownerPage.keyboard.press('Enter');
      const retryConfirmation = ownerPage.getByRole('dialog', { name: 'Desactivar' });
      await retryConfirmation.getByRole('button', { name: 'Desactivar miembro' }).click();
      await expect(memberCard).toContainText('Inactivo');
      const reactivate = memberCard.locator('[data-test^="member-active-"]');
      await expect(reactivate).toHaveText('Reactivar');
      await capture(ownerPage, 'membership-inactive.png');

      await ownerPage.goto('/calendar');
      await expect(ownerPage.locator('h1.calendar__title')).toBeVisible();
      await ownerPage.locator('[data-test="timeline-add-meal"]').first().click();
      await expect(ownerPage.locator('#meal-servings')).toHaveValue('1');
      await capture(ownerPage, 'servings-one-inactive.png');
      await ownerPage.locator('app-modal .modal__close').click();

      await ownerPage.goto('/household?tab=members');
      await expect(memberCard).toBeVisible();
      await reactivate.click();
      await expect(memberCard).toContainText('Activo');
      await expect(memberCard.locator('[data-test^="member-active-"]')).toHaveText('Desactivar');
      await ownerPage.goto('/calendar');
      await expect(ownerPage.locator('h1.calendar__title')).toBeVisible();
      await ownerPage.locator('[data-test="timeline-add-meal"]').first().click();
      await expect(ownerPage.locator('#meal-servings')).toHaveValue('2');
      await capture(ownerPage, 'servings-two-reactivated.png');
      await ownerPage.locator('app-modal .modal__close').click();
      await ownerPage.goto('/household?tab=members');
      await expect(memberCard).toContainText('Activo');
      await capture(ownerPage, 'membership-reactivated.png');
    } finally {
      await memberContext.close();
      await ownerContext.close();
    }
  });

  test('creation failure keeps the dialog and input, then retries successfully at viewport boundaries', async ({
    page
  }) => {
    const appErrors = trackApplicationErrors(page);
    await registerAndGoto(page, '/household', 'Owner synthetic');

    let createRequests = 0;
    await page.route('**/api/household', async (route) => {
      if (route.request().method() === 'POST' && ++createRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic temporary failure' })
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: /Crear hogar/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Crear Hogar' });
    const name = dialog.getByRole('textbox', { name: 'Nombre del hogar' });
    await name.fill('Casa sintética recuperable');

    for (const viewport of HOUSEHOLD_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expectDialogWithinViewport(page, dialog, viewport);
    }

    await page.setViewportSize({ width: 393, height: 851 });
    const createButton = dialog.getByRole('button', { name: 'Crear', exact: true });
    const cancelButton = dialog.getByRole('button', { name: 'Cancelar', exact: true });
    await expect
      .poll(async () => (await createButton.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    await expect
      .poll(async () => (await cancelButton.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const createButtonBounds = await createButton.boundingBox();
    const cancelButtonBounds = await cancelButton.boundingBox();
    expect(createButtonBounds).not.toBeNull();
    expect(cancelButtonBounds).not.toBeNull();
    await createButton.click();

    await expect(errorToast(page, 'No se pudo crear el hogar')).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Casa sintética recuperable');
    await expect(createButton).toBeEnabled();
    expect(createRequests).toBe(1);

    await createButton.click();
    await expect(page.locator('.household-info__name')).toHaveText('Casa sintética recuperable');
    await expect(dialog).toHaveCount(0);
    await expect(successToast(page, 'Tu hogar ha sido creado')).toBeVisible();
    expect(createRequests).toBe(2);
    expectNoUnexpectedApplicationErrors(appErrors, [503]);
    await capture(page, 'household-create-retry.png');
  });

  test('invalid join preserves the code and dialog, then joins with a real synthetic invite', async ({
    page
  }) => {
    const appErrors = trackApplicationErrors(page);
    await registerAndGoto(page, '/household', 'Owner synthetic');
    await createHouseholdThroughUi(page, 'Hogar sintético invitador');
    const validCode = await readInviteCode(page);

    await logout(page);
    await registerAndGoto(page, '/household', 'Guest synthetic');
    await expect(page.locator('.household-info__name')).toHaveCount(0);

    let joinRequests = 0;
    await page.route('**/api/household/join', async (route) => {
      if (route.request().method() === 'POST' && ++joinRequests === 1) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic invalid invite' })
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: /Unirse con código/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    const codeInput = dialog.getByRole('textbox', { name: 'Código de invitación' });
    await codeInput.fill(validCode);
    await dialog.getByRole('button', { name: 'Unirse', exact: true }).click();

    await expect(errorToast(page, 'Código inválido o ya eres miembro')).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(dialog).toBeVisible();
    await expect(codeInput).toHaveValue(validCode);
    await expect(page.locator('.household-info__name')).toHaveCount(0);
    expect(joinRequests).toBe(1);

    await dialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético invitador');
    await expect(dialog).toHaveCount(0);
    await expect(successToast(page, 'Ahora eres miembro del hogar')).toBeVisible();
    expect(joinRequests).toBe(2);
    expectNoUnexpectedApplicationErrors(appErrors, [404]);
    await capture(page, 'household-join-retry.png');
  });

  test('invite dialog is named, keyboard-accessible, responsive, and copies its link', async ({
    page
  }) => {
    const appErrors = trackApplicationErrors(page);
    await registerAndGoto(page, '/household', 'Owner synthetic');
    await createHouseholdThroughUi(page, 'Hogar sintético invitación');

    const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('[data-test="household-tab-members"]').click();
    const inviteTrigger = page.getByRole('button', { name: /Invitar/i });
    await inviteTrigger.focus();
    await inviteTrigger.press('Enter');

    const dialog = page.getByRole('dialog', { name: /Invitar Miembro/i });
    const copyButton = dialog.getByRole('button', { name: 'Copiar' });
    const closeButton = dialog.locator('.modal__close');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);

    for (const viewport of HOUSEHOLD_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expectDialogWithinViewport(page, dialog, viewport);
    }

    for (const button of [copyButton, closeButton]) {
      await expect
        .poll(async () => {
          const bounds = await button.boundingBox();
          return bounds ? Math.min(bounds.width, bounds.height) : 0;
        })
        .toBeGreaterThanOrEqual(44);
    }
    await capture(page, 'household-invite-dialog.png');

    await copyButton.click();
    await expect(successToast(page, 'Copiado')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(inviteTrigger).toBeFocused();
    expectNoUnexpectedApplicationErrors(appErrors);
  });

  test('settings and invite regeneration keep confirmed values after errors and succeed on retry', async ({
    page
  }) => {
    const appErrors = trackApplicationErrors(page);
    await registerAndGoto(page, '/household', 'Owner synthetic');
    await createHouseholdThroughUi(page, 'Hogar sintético ajustes');
    await page.locator('[data-test="household-tab-settings"]').click();
    const checkbox = page.getByRole('checkbox', { name: 'Inventario compartido' });
    const initialInviteUrl = (await page.locator('.invite-card__code').innerText()).trim();

    let patchRequests = 0;
    let regenerateRequests = 0;
    await page.route('**/api/household', async (route) => {
      if (route.request().method() === 'PATCH' && ++patchRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic temporary failure' })
        });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/household/regenerate-invite', async (route) => {
      if (route.request().method() === 'POST' && ++regenerateRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic temporary failure' })
        });
        return;
      }
      await route.continue();
    });

    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await expect(errorToast(page, 'No se pudo actualizar')).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(checkbox).toBeChecked();
    expect((await page.locator('.invite-card__code').innerText()).trim()).toBe(initialInviteUrl);
    expect(patchRequests).toBe(1);

    // Error toasts auto-dismiss after five seconds; close this one while it is
    // still present instead of trying to target it after the retry and reload.
    await errorToast(page, 'No se pudo actualizar').locator('.toast__close').click();
    await expect(errorToast(page, 'No se pudo actualizar')).toHaveCount(0);

    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    await expect(successToast(page, 'Ajustes del hogar guardados')).toBeVisible();
    expect(patchRequests).toBe(2);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: 'Inventario compartido' })).not.toBeChecked();

    await page.locator('[data-test="household-tab-home"]').click();
    await page.getByRole('button', { name: 'Regenerar' }).click();
    await expect(errorToast(page, 'No se pudo regenerar el código de invitación')).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(page.locator('.invite-card__code')).toHaveText(initialInviteUrl);
    expect(regenerateRequests).toBe(1);

    await page.getByRole('button', { name: 'Regenerar' }).click();
    await expect(successToast(page, 'Nuevo código de invitación generado')).toBeVisible();
    await expect(page.locator('.invite-card__code')).not.toHaveText(initialInviteUrl);
    expect(regenerateRequests).toBe(2);
    expectNoUnexpectedApplicationErrors(appErrors, [503]);
    await capture(page, 'household-settings-regenerate-retry.png');
  });

  test('leave cancellation sends no request; failed leave preserves household and retry succeeds', async ({
    page
  }) => {
    const appErrors = trackApplicationErrors(page);
    await registerAndGoto(page, '/household', 'Owner synthetic');
    await createHouseholdThroughUi(page, 'Hogar sintético salida');
    await page.locator('.toast--success .toast__close').click();
    await page.getByRole('tab', { name: 'Ajustes' }).click();

    let leaveRequests = 0;
    await page.route('**/api/household/leave', async (route) => {
      if (route.request().method() === 'DELETE' && ++leaveRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic temporary failure' })
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Salir del hogar' }).click();
    let dialog = page.getByRole('dialog', { name: 'Salir del hogar' });
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    expect(leaveRequests).toBe(0);

    await page.getByRole('button', { name: 'Salir del hogar' }).click();
    dialog = page.getByRole('dialog', { name: 'Salir del hogar' });
    await dialog.getByRole('button', { name: 'Salir', exact: true }).click();
    await expect(errorToast(page, 'No se pudo salir del hogar')).toBeVisible();
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(page.locator('[data-test="household-name-input"]')).toHaveValue(
      'Hogar sintético salida'
    );
    await expect(page.locator('.toast--success')).toHaveCount(0);
    expect(leaveRequests).toBe(1);

    await page.getByRole('button', { name: 'Salir del hogar' }).click();
    dialog = page.getByRole('dialog', { name: 'Salir del hogar' });
    const leaveConfirm = dialog.getByRole('button', { name: 'Salir', exact: true });
    await expect
      .poll(async () => (await leaveConfirm.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const leaveBounds = await leaveConfirm.boundingBox();
    expect(leaveBounds).not.toBeNull();
    await leaveConfirm.click();
    await expect(page.locator('.household-info__name')).toHaveCount(0);
    await expect(page.locator('.no-household')).toBeVisible();
    await expect(successToast(page, 'Has salido del hogar')).toBeVisible();
    expect(leaveRequests).toBe(2);
    expectNoUnexpectedApplicationErrors(appErrors, [503]);
    await capture(page, 'household-leave-retry.png');
  });

  test('serializes repeated keyboard submits for create and join while requests are in progress', async ({
    page
  }) => {
    const appErrors = trackApplicationErrors(page);
    await registerAndGoto(page, '/household', 'Owner synthetic');

    let releaseCreate: (() => void) | undefined;
    let createRequests = 0;
    await page.route('**/api/household', async (route) => {
      if (route.request().method() === 'POST') {
        createRequests += 1;
        if (createRequests === 1) {
          await new Promise<void>((resolve) => (releaseCreate = resolve));
        }
      }
      await route.continue();
    });

    await page.getByRole('button', { name: /Crear hogar/i }).click();
    let dialog = page.getByRole('dialog', { name: 'Crear Hogar' });
    const nameInput = dialog.getByRole('textbox', { name: 'Nombre del hogar' });
    await nameInput.fill('Hogar con envío serializado');
    await nameInput.press('Enter');
    await expect.poll(() => createRequests).toBe(1);
    await nameInput.press('Enter');
    await expect.poll(() => createRequests).toBe(1);
    releaseCreate?.();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar con envío serializado');
    expect(createRequests).toBe(1);

    const code = await readInviteCode(page);
    await logout(page);
    await registerAndGoto(page, '/household', 'Guest synthetic');

    let releaseJoin: (() => void) | undefined;
    let joinRequests = 0;
    await page.route('**/api/household/join', async (route) => {
      if (route.request().method() === 'POST') {
        joinRequests += 1;
        if (joinRequests === 1) {
          await new Promise<void>((resolve) => (releaseJoin = resolve));
        }
      }
      await route.continue();
    });

    await page.getByRole('button', { name: /Unirse con código/i }).click();
    dialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    const codeInput = dialog.getByRole('textbox', { name: 'Código de invitación' });
    await codeInput.fill(code);
    await codeInput.press('Enter');
    await expect.poll(() => joinRequests).toBe(1);
    await codeInput.press('Enter');
    await expect.poll(() => joinRequests).toBe(1);
    releaseJoin?.();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar con envío serializado');
    expect(joinRequests).toBe(1);
    expectNoUnexpectedApplicationErrors(appErrors);
  });
});
