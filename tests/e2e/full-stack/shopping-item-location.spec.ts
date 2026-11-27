import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '../fixtures';
import { registerAndGoto } from '../helpers/auth';
import { shoppingNewListAction } from '../helpers/shopping-ui';

const TOKEN_KEY = 'hogar:v1:auth_token';

test('pide consentimiento al marcar y permite elegir o editar una tienda', async ({
  page
}, testInfo) => {
  const desktop = testInfo.project.name === 'chromium';
  const desktopSize = { width: 1440, height: 900 };
  const mobileSize = { width: 390, height: 844 };
  const screenshotDirectory = resolve('.e2e-screenshots/shopping-item-locations');
  const pageErrors: string[] = [];
  const locationRequests: string[] = [];
  const candidateLookups: unknown[] = [];
  mkdirSync(screenshotDirectory, { recursive: true });
  page.on('pageerror', (error) => pageErrors.push(String(error.message).split('\n')[0]));
  page.on('request', (request) => {
    if (
      request.url().includes('/location-candidates') ||
      request.url().endsWith('/items/location')
    ) {
      locationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.setViewportSize(desktop ? desktopSize : mobileSize);
  await registerAndGoto(page, '/shopping', 'Shopping location synthetic QA');
  const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
  expect(token).toBeTruthy();

  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill('Lista de ubicación sintética');
  await page.locator('[data-test="create-submit"]').click();
  await expect(page.locator('[data-test="add-input"]')).toBeVisible();
  const listId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1);
  expect(listId).toBeTruthy();

  await page.locator('[data-test="add-input"]').fill('1 Pimientos QA');
  await page.locator('[data-test="add-submit"]').click();
  await page.locator('[data-test="add-input"]').fill('1 Tomates QA');
  await page.locator('[data-test="add-submit"]').click();
  await page.locator('[data-test="add-input"]').fill('1 Cebollas QA');
  await page.locator('[data-test="add-submit"]').click();
  const todoRow = page.locator('[data-test="item-row"]').filter({ hasText: 'Pimientos QA' });
  await expect(todoRow).toBeVisible();

  // La acción masiva no debe abrir tres flujos ni pedir permisos.
  await page.locator('[data-test="select-all"] button').click();
  await page.locator('[data-test="bulk-check"]').click();
  const prompt = page.locator('[data-test="location-prompt"]');
  await expect(prompt).toHaveCount(0);
  await expect(page.locator('[data-test="tab-cart"]')).toContainText('3');

  await page.locator('[data-test="tab-cart"]').click();
  const cartRowBeforeIndividualCheck = page
    .locator('[data-test="item-row"]')
    .filter({ hasText: 'Pimientos QA' });
  await cartRowBeforeIndividualCheck.locator('[data-test="check"]').click();
  await expect(prompt).toHaveCount(0);
  await page.locator('[data-test="tab-todo"]').click();
  await page
    .locator('[data-test="item-row"]')
    .filter({ hasText: 'Pimientos QA' })
    .locator('[data-test="check"]')
    .click();
  await expect(prompt).toBeVisible();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toHaveCSS('transform', 'none');
  const assertDialogFits = async (width: number, height: number) => {
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    const viewportMetrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualWidth: window.visualViewport?.width,
      visualHeight: window.visualViewport?.height,
      visualTop: window.visualViewport?.offsetTop,
      overlayStyle: document.querySelector('.modal-overlay')?.getAttribute('style')
    }));
    expect(
      box!.y + box!.height,
      `dialog=${JSON.stringify(box)} viewport=${JSON.stringify(viewportMetrics)}`
    ).toBeLessThanOrEqual(height + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    expect(await page.locator('.modal-overlay--safe-area').count()).toBe(1);
  };

  await assertDialogFits(desktop ? desktopSize.width : mobileSize.width, desktop ? 900 : 844);
  const acceptTarget = page.locator('[data-test="location-accept"] button');
  expect((await acceptTarget.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: join(
      screenshotDirectory,
      desktop ? 'prompt-desktop-1440x900.png' : 'prompt-mobile-390x844.png'
    )
  });

  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  if (!desktop) {
    await page.setViewportSize({ width: 320, height: 568 });
    await assertDialogFits(320, 568);
    await page.screenshot({ path: join(screenshotDirectory, 'prompt-mobile-320x568.png') });
  }
  await page.locator('[data-test="location-skip"] button').click();
  await expect(prompt).toHaveCount(0);
  expect(locationRequests).toEqual([]);
  await expect(page.locator('[data-test="tab-cart"]')).toContainText('3');

  // Unchecking does not open a second flow. Marking again does, once.
  if (!desktop) await page.setViewportSize(mobileSize);
  await page.locator('[data-test="tab-cart"]').click();
  const cartRow = page.locator('[data-test="item-row"]').filter({ hasText: 'Pimientos QA' });
  await expect(cartRow).toBeVisible();
  await cartRow.locator('[data-test="check"]').click();
  await expect(prompt).toHaveCount(0);
  expect(locationRequests).toEqual([]);
  await page.locator('[data-test="tab-todo"]').click();

  if (!desktop) await page.setViewportSize({ width: 844, height: 390 });
  const pendingRow = page.locator('[data-test="item-row"]').filter({ hasText: 'Pimientos QA' });
  await pendingRow.locator('[data-test="check"]').click();
  await expect(prompt).toBeVisible();
  await expect(dialog).toHaveCSS('transform', 'none');
  if (!desktop) await assertDialogFits(844, 390);

  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 40.4168, longitude: -3.7038 });
  await page.route(`**/api/shopping/lists/${listId}/location-candidates`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    candidateLookups.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          status: 'ok',
          candidates: [
            {
              id: 'osm:node:31337',
              name: 'Mercado sintético QA',
              address: 'Calle de Prueba 12',
              latitude: 40.417,
              longitude: -3.704,
              distanceMeters: 24,
              attribution: '© OpenStreetMap contributors',
              attributionUrl: 'https://www.openstreetmap.org/copyright',
              source: 'openstreetmap'
            }
          ]
        }
      })
    });
  });

  if (!desktop) await page.setViewportSize(mobileSize);
  await page.locator('[data-test="location-accept"] button').click();
  await expect(page.locator('[data-test="location-candidate"]')).toBeVisible();
  expect(candidateLookups).toEqual([{ latitude: 40.4168, longitude: -3.7038, radiusMeters: 500 }]);
  expect(locationRequests.filter((entry) => entry.includes('location-candidates'))).toHaveLength(1);
  await expect(page.locator('[data-test="location-results"]')).toContainText('OpenStreetMap');
  await page.screenshot({
    path: join(
      screenshotDirectory,
      desktop ? 'candidate-desktop-1440x900.png' : 'candidate-mobile-390x844.png'
    )
  });

  const savePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/shopping/lists/${listId}/items/location`) &&
      response.request().method() === 'PUT'
  );
  await page.locator('[data-test="location-candidate"]').click();
  const saveResponse = await savePromise;
  expect(saveResponse.status()).toBe(200);
  await expect(dialog).toHaveCount(0);

  const listResponse = await page.request.get(`/api/shopping/lists/${listId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(listResponse.status()).toBe(200);
  const savedList = (await listResponse.json()).data;
  expect(savedList.items[0]).toMatchObject({
    location_name: 'Mercado sintético QA',
    location_address: 'Calle de Prueba 12',
    location_latitude: 40.417,
    location_longitude: -3.704,
    location_source: 'openstreetmap',
    location_attribution: '© OpenStreetMap contributors'
  });
  expect(savedList.items[0]).not.toHaveProperty('device_latitude');
  expect(locationRequests.filter((entry) => entry.includes('items/location'))).toHaveLength(1);

  await page.reload();
  await page.locator('[data-test="tab-cart"]').click();
  const locatedRow = page.locator('[data-test="item-row"]').filter({ hasText: 'Pimientos QA' });
  await expect(locatedRow).toBeVisible();
  await locatedRow.getByRole('button', { name: 'Acciones de la linea' }).click();
  await page.locator('[data-test="edit-item-location"]').click();
  await expect(page.locator('[data-test="location-manual-form"]')).toBeVisible();
  await expect(page.locator('[data-test="location-name"]')).toHaveValue('Mercado sintético QA');
  await page.screenshot({
    path: join(
      screenshotDirectory,
      desktop ? 'edit-desktop-1440x900.png' : 'edit-mobile-390x844.png'
    )
  });
  await page.locator('[data-test="location-name"]').fill('Tienda manual QA');
  await page.locator('[data-test="location-address"]').fill('Plaza sintética 4');
  const manualSavePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/shopping/lists/${listId}/items/location`) &&
      response.request().method() === 'PUT'
  );
  await page.locator('[data-test="location-save-manual"] button').click();
  expect((await manualSavePromise).status()).toBe(200);

  const corrected = await page.request.get(`/api/shopping/lists/${listId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect((await corrected.json()).data.items[0]).toMatchObject({
    location_name: 'Tienda manual QA',
    location_address: 'Plaza sintética 4',
    location_latitude: null,
    location_longitude: null,
    location_source: 'manual',
    location_attribution: null
  });
  expect(pageErrors).toEqual([]);
});
