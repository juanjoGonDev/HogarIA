import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, registerAndGoto } from './helpers/auth';

async function ensureMobileSidebarOpen(page: Page): Promise<void> {
  if (test.info().project.name !== 'mobile-chrome') return;
  const sidebar = page.locator('.sidebar');
  if (!(await sidebar.evaluate((element) => element.classList.contains('sidebar--open')))) {
    await page.locator('.header__menu').click();
  }
  await expect(sidebar).toHaveClass(/sidebar--open/);
}

async function capture(page: Page): Promise<void> {
  const viewport =
    test.info().project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  const screenshotRoot = process.env.E2E_SCREENSHOT_DIR
    ? resolve(process.env.E2E_SCREENSHOT_DIR)
    : join(process.cwd(), '.e2e-screenshots');
  const directory = join(screenshotRoot, 'multi-household-switcher');
  await mkdir(directory, { recursive: true });
  const householdPicker = page.locator('[data-test="active-household-select"]');
  await ensureMobileSidebarOpen(page);
  await expect(householdPicker).toBeVisible();
  await page.screenshot({
    path: join(directory, `${test.info().project.name}.png`),
    fullPage: true,
    animations: 'disabled'
  });
}

async function tokenDe(page: Page): Promise<string> {
  const token = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    'hogar:v1:auth_token'
  );
  expect(token).toBeTruthy();
  return token as string;
}

async function subirTicketSintetico(page: Page): Promise<string> {
  const token = await tokenDe(page);
  const response = await page.request.post('/api/receipts', {
    headers: { authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: 'ticket-sintetico.png',
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      }
    }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.id as string;
}

test('can join a second home, switch context and restore the selection after refresh', async ({
  page,
  browser
}) => {
  const viewport =
    test.info().project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  const secondContext = await browser.newContext({ locale: 'es-ES', viewport });
  const secondPage = await secondContext.newPage();

  try {
    await registerAndGoto(page, '/household', 'Administradora sintética de casa uno');
    await createHousehold(page, 'Hogar sintético uno');

    await registerAndGoto(secondPage, '/household', 'Administradora sintética de casa dos');
    await createHousehold(secondPage, 'Hogar sintético dos');
    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();

    await page.goto('/household');
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético uno');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await dialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    const refreshedMemberships = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/household/memberships') &&
        response.request().method() === 'GET'
    );
    await dialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    const membershipResponse = await refreshedMemberships;
    const activeHouseholdId = (await membershipResponse.json())?.data?.activeHouseholdId;
    expect(activeHouseholdId).toBeTruthy();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético dos');
    const dismissJoinToast = page.getByRole('button', { name: 'Descartar' });
    if (await dismissJoinToast.isVisible()) await dismissJoinToast.click();

    const householdPicker = page.locator('[data-test="active-household-select"]');
    await ensureMobileSidebarOpen(page);
    await expect(householdPicker).toBeVisible();
    const pickerTrigger = householdPicker.locator('.picker__trigger');
    await expect(pickerTrigger).toHaveAttribute('aria-label', 'Hogar activo: Hogar sintético dos');
    const receiptId = await subirTicketSintetico(page);
    const authHeaders = { authorization: `Bearer ${await tokenDe(page)}` };
    const inventoryResponse = await page.request.post('/api/pantry/ingredients', {
      headers: authHeaders,
      data: {
        name: 'Garbanzos sintéticos del hogar dos',
        category: 'other',
        quantity: 1,
        unit: 'unit',
        location: 'pantry'
      }
    });
    expect(inventoryResponse.status()).toBe(201);
    const homeTwoReceipts = await page.request.get('/api/receipts', { headers: authHeaders });
    expect(
      (await homeTwoReceipts.json()).data.map((receipt: { id: string }) => receipt.id)
    ).toContain(receiptId);
    const homeTwoInventory = await page.request.get('/api/pantry/ingredients', {
      headers: authHeaders
    });
    expect(
      (await homeTwoInventory.json()).data.ingredients.map((item: { name: string }) => item.name)
    ).toContain('Garbanzos sintéticos del hogar dos');

    await page.goto('/recipes');
    await page.getByRole('tab', { name: 'Libro de recetas' }).click();
    const tortillaCard = page
      .locator('[data-test="recipe-card"]')
      .filter({ hasText: 'Tortilla de patatas' });
    const tortillaFavorite = tortillaCard.locator('.recipe-card__favorite');
    await expect(tortillaFavorite).toHaveAttribute('aria-pressed', 'false');
    await tortillaFavorite.click();
    await expect(tortillaFavorite).toHaveAttribute('aria-pressed', 'true');
    const favoriteScreenshots = join(process.cwd(), '.e2e-screenshots', 'recipe-favorites-house-switch');
    await mkdir(favoriteScreenshots, { recursive: true });
    await page.screenshot({
      path: join(favoriteScreenshots, `${test.info().project.name}-home-two.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await page.goto('/household');
    await ensureMobileSidebarOpen(page);
    await pickerTrigger.click();
    await page.getByRole('option').filter({ hasText: 'Hogar sintético uno' }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético uno');
    await expect(pickerTrigger).toHaveAttribute('aria-label', 'Hogar activo: Hogar sintético uno');
    const homeOneReceipts = await page.request.get('/api/receipts', { headers: authHeaders });
    expect(
      (await homeOneReceipts.json()).data.map((receipt: { id: string }) => receipt.id)
    ).not.toContain(receiptId);
    expect(
      (await page.request.get(`/api/receipts/${receiptId}`, { headers: authHeaders })).status()
    ).toBe(404);
    const homeOneInventory = await page.request.get('/api/pantry/ingredients', {
      headers: authHeaders
    });
    expect(
      (await homeOneInventory.json()).data.ingredients.map((item: { name: string }) => item.name)
    ).not.toContain('Garbanzos sintéticos del hogar dos');

    await page.goto('/recipes');
    await page.getByRole('tab', { name: 'Libro de recetas' }).click();
    const sameTortilla = page
      .locator('[data-test="recipe-card"]')
      .filter({ hasText: 'Tortilla de patatas' });
    await expect(sameTortilla.locator('.recipe-card__favorite')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page.screenshot({
      path: join(favoriteScreenshots, `${test.info().project.name}-home-one.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await page.goto('/household');
    await capture(page);

    await page.reload();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético uno');
    await ensureMobileSidebarOpen(page);
    await expect(pickerTrigger).toHaveAttribute('aria-label', 'Hogar activo: Hogar sintético uno');

    await pickerTrigger.click();
    await page.getByRole('option').filter({ hasText: 'Hogar sintético dos' }).click();
    const returnedHomeReceipts = await page.request.get('/api/receipts', { headers: authHeaders });
    expect(
      (await returnedHomeReceipts.json()).data.map((receipt: { id: string }) => receipt.id)
    ).toContain(receiptId);
    const returnedHomeInventory = await page.request.get('/api/pantry/ingredients', {
      headers: authHeaders
    });
    expect(
      (await returnedHomeInventory.json()).data.ingredients.map(
        (item: { name: string }) => item.name
      )
    ).toContain('Garbanzos sintéticos del hogar dos');
  } finally {
    await secondContext.close();
  }
});
