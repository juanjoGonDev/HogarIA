import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

async function ensureMobileSidebarOpen(page: Page): Promise<void> {
  if (test.info().project.name !== 'mobile-chrome') return;
  const sidebar = page.locator('.sidebar');
  if (!(await sidebar.evaluate((element) => element.classList.contains('sidebar--open')))) {
    await page.locator('.header__menu').click();
  }
  await expect(sidebar).toHaveClass(/sidebar--open/);
}

test('grouping and display ordering do not rewrite shopping items', async ({ page }) => {
  const viewport =
    test.info().project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  await registerAndGoto(page, '/shopping', 'shopping-display-order');
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Compra sintética orden');
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);

  for (const value of ['500 g Arroz', '2 kg Patatas', '3 kg Aceite']) {
    await page.locator('[data-test="add-input"]').fill(value);
    await page.locator('[data-test="add-submit"]').click();
    await expect(page.locator('[data-test="add-input"]')).toHaveValue('');
  }

  const names = page.locator('[data-test="item-row"] .detail__name');
  await expect(names).toHaveText(['Arroz', 'Patatas', 'Aceite']);

  const aceite = page.locator('[data-test="item-row"]', {
    has: page.locator('.detail__name', { hasText: 'Aceite' })
  });
  await aceite.locator('.detail__more').click();
  const editSheet = page.locator('[data-test="edit-sheet"]');
  await editSheet.locator('[data-test="category-picker"] .picker__trigger').click();
  await page.getByRole('option', { name: 'Congelados', exact: true }).click();
  const categorySaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      /\/api\/shopping\/lists\/[^/]+\/items\/[^/]+$/.test(new URL(response.url()).pathname)
  );
  await editSheet.locator('[data-test="edit-close"]').click();
  await categorySaved;
  await expect(page.locator('.detail__group-title')).toHaveText(['Congelados', 'Otros']);

  const frozen = page.getByRole('checkbox', { name: 'Dejar congelados al final' });
  await frozen.click();
  await expect(frozen).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.detail__group-title')).toHaveText(['Otros', 'Congelados']);

  await page.getByRole('button', { name: 'Ordenar productos: Orden de la lista' }).click();
  await page.getByRole('option', { name: 'Peso: más pesado primero' }).click();
  await expect(names).toHaveText(['Patatas', 'Arroz', 'Aceite']);

  const grouping = page.getByRole('checkbox', { name: 'Agrupar por categoría' });
  await expect(grouping).toHaveAttribute('aria-checked', 'true');
  await grouping.click();
  await expect(grouping).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.detail__group-title')).toHaveText('Todos los productos');
  await expect(names).toHaveText(['Patatas', 'Arroz', 'Aceite']);

  const screenshotPath = join(
    process.cwd(),
    '.e2e-screenshots',
    'shopping-view-order',
    `${test.info().project.name}.png`
  );
  await mkdir(join(process.cwd(), '.e2e-screenshots', 'shopping-view-order'), {
    recursive: true
  });
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });

  await page.reload();
  await expect(page.locator('.detail__group-title')).toHaveText(['Congelados', 'Otros']);
  await expect(names).toHaveText(['Aceite', 'Arroz', 'Patatas']);
  const sortPicker = page.locator('[data-test="shopping-display-options"] .picker__trigger');
  await sortPicker.focus();
  await sortPicker.press('ArrowDown');
  await sortPicker.press('Home');
  await sortPicker.press('Enter');
  await expect(sortPicker).toHaveAttribute('aria-label', 'Ordenar productos: Orden de la lista');

  const groupingAfterReload = page.getByRole('checkbox', { name: 'Agrupar por categoría' });
  await groupingAfterReload.focus();
  await groupingAfterReload.press('Space');
  await expect(groupingAfterReload).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.detail__group-title')).toHaveText('Todos los productos');
  await expect(names).toHaveText(['Arroz', 'Patatas', 'Aceite']);
  await groupingAfterReload.press('Space');
  await expect(groupingAfterReload).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.detail__group-title')).toHaveText(['Congelados', 'Otros']);
  await expect(names).toHaveText(['Aceite', 'Arroz', 'Patatas']);
  await expect(names).toHaveText(['Aceite', 'Arroz', 'Patatas']);

  const patatas = page.locator('[data-test="item-row"]', {
    has: page.locator('.detail__name', { hasText: 'Patatas' })
  });
  await patatas.locator('[data-test="check"]').click();
  await expect(page.locator('[data-test="tab-todo"]')).toContainText('Pendientes (2)');
  await page.locator('[data-test="tab-cart"]').click();
  await expect(page.locator('[data-test="tab-cart"]')).toContainText('En el carro (1)');
  await expect(names).toHaveText(['Patatas']);

  await page.reload();
  await expect(page.locator('[data-test="tab-todo"]')).toContainText('Pendientes (2)');
  await page.locator('[data-test="tab-cart"]').click();
  await expect(names).toHaveText(['Patatas']);
});

test('returns to a non-empty page when the final row on the last page disappears', async ({
  page
}) => {
  const viewport =
    test.info().project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  await registerAndGoto(page, '/household', 'Compra rango sintético');
  await createHousehold(page, 'Casa rango sintético');

  let lastPageRowsDeleted = false;
  const listOffsets: string[] = [];
  await page.route('**/api/shopping/lists?*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() !== 'GET') return route.continue();
    const onLaterPage = requestUrl.searchParams.get('offset') === '25';
    const offset = requestUrl.searchParams.get('offset') ?? '0';
    listOffsets.push(offset);
    if (onLaterPage) lastPageRowsDeleted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: onLaterPage
          ? []
          : [
              {
                id: 'synthetic-list-a',
                name: 'Lista sintética',
                store: 'Tienda de prueba',
                status: 'active',
                version: 1,
                created_at: '2026-10-01T10:00:00.000Z',
                updated_at: '2026-10-02T10:00:00.000Z',
                completed_at: null,
                totalItems: 1,
                checkedItems: 0,
                pricedTotalMinor: 0
              }
            ],
        meta: {
          total: lastPageRowsDeleted ? 25 : 26,
          limit: 25,
          offset: onLaterPage ? 25 : 0
        }
      })
    });
  });
  await page.goto('/shopping');

  const range = page.locator('.tray__pager-text');
  await expect(range).toHaveText('1-1 de 26');
  await page.getByRole('button', { name: 'Pagina siguiente' }).click();
  await expect(range).toHaveText('1-1 de 25');
  await expect(page.locator('.tray__empty-title')).toHaveCount(0);
  expect(listOffsets).toContain('25');
  expect(listOffsets.slice(listOffsets.indexOf('25') + 1)).toContain('0');
  await expect(page.getByRole('button', { name: 'Pagina siguiente' })).toBeDisabled();

  const screenshotRoot = process.env.E2E_SCREENSHOT_DIR
    ? resolve(process.env.E2E_SCREENSHOT_DIR)
    : join(process.cwd(), '.e2e-screenshots');
  const directory = join(screenshotRoot, 'shopping-empty-page-range');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${test.info().project.name}.png`),
    fullPage: true,
    animations: 'disabled'
  });
});

test('switching homes hides a shopping list from the previous home and restores it when selected', async ({
  page,
  browser
}) => {
  const viewport =
    test.info().project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  const secondContext = await browser.newContext({ locale: 'es-ES', viewport });
  const secondPage = await secondContext.newPage();

  try {
    await registerAndGoto(page, '/household', 'Compra sintética casa uno');
    await createHousehold(page, 'Casa compra sintética uno');
    await page.goto('/shopping');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Lista casa sintética uno');
    await page.locator('[data-test="create-submit"]').click();
    await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
    const previousHomeListId = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.locator('[data-test="add-input"]').fill('Garbanzos casa uno');
    await page.locator('[data-test="add-submit"]').click();
    await expect(page.locator('.detail__name')).toContainText('Garbanzos casa uno');

    await registerAndGoto(secondPage, '/household', 'Compra sintética casa dos');
    await createHousehold(secondPage, 'Casa compra sintética dos');
    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();
    await secondPage.goto('/shopping');
    await shoppingNewListAction(secondPage).click();
    await secondPage.locator('[data-test="list-name"]').fill('Lista casa sintética dos');
    await secondPage.locator('[data-test="create-submit"]').click();
    await expect(secondPage).toHaveURL(/\/shopping\/[\w-]+$/);
    await secondPage.locator('[data-test="add-input"]').fill('Arroz casa dos');
    await secondPage.locator('[data-test="add-submit"]').click();
    await expect(secondPage.locator('.detail__name')).toContainText('Arroz casa dos');

    await page.goto('/household');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await dialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await dialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Casa compra sintética dos');

    await ensureMobileSidebarOpen(page);
    const activeHomePicker = page.locator('[data-test="active-household-select"] .picker__trigger');
    await activeHomePicker.click();
    await page.getByRole('option', { name: 'Casa compra sintética uno' }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Casa compra sintética uno');
    await page.goto(`/shopping/${previousHomeListId}`);
    await expect(page.locator('.detail__name')).toContainText('Garbanzos casa uno');

    await ensureMobileSidebarOpen(page);
    const staleDetailReads: string[] = [];
    const recordPreviousHomeReads = (request: import('@playwright/test').Request) => {
      const url = new URL(request.url());
      if (
        request.method() === 'GET' &&
        url.pathname === `/api/shopping/lists/${previousHomeListId}`
      ) {
        staleDetailReads.push(request.url());
      }
    };
    page.on('request', recordPreviousHomeReads);
    const homeTwoListsLoaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/shopping/lists'
    );
    await activeHomePicker.click();
    await page.getByRole('option', { name: 'Casa compra sintética dos' }).click();
    await expect(page).toHaveURL(/\/shopping$/);
    expect((await homeTwoListsLoaded).status()).toBe(200);
    await expect(page.getByText('Lista casa sintética dos', { exact: true })).toBeVisible();
    await expect(page.getByText('Lista casa sintética uno', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Garbanzos casa uno', { exact: true })).toHaveCount(0);
    expect(staleDetailReads).toEqual([]);
    page.off('request', recordPreviousHomeReads);

    if (test.info().project.name === 'mobile-chrome') {
      const sidebar = page.locator('.sidebar');
      if (await sidebar.evaluate((element) => element.classList.contains('sidebar--open'))) {
        await page.locator('.sidebar__close').click();
      }
      await expect(sidebar).not.toHaveClass(/sidebar--open/);
    }

    const screenshotRoot = process.env.E2E_SCREENSHOT_DIR
      ? resolve(process.env.E2E_SCREENSHOT_DIR)
      : join(process.cwd(), '.e2e-screenshots');
    const screenshotDirectory = join(screenshotRoot, 'shopping-household-context-20261006');
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `${test.info().project.name}.png`),
      fullPage: true,
      animations: 'disabled'
    });

    await ensureMobileSidebarOpen(page);
    await activeHomePicker.click();
    const homeOneListsLoaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/shopping/lists'
    );
    await page.getByRole('option', { name: 'Casa compra sintética uno' }).click();
    expect((await homeOneListsLoaded).status()).toBe(200);
    await expect(page.getByText('Lista casa sintética uno', { exact: true })).toBeVisible();
    await expect(page.getByText('Lista casa sintética dos', { exact: true })).toHaveCount(0);
  } finally {
    await secondContext.close();
  }
});
