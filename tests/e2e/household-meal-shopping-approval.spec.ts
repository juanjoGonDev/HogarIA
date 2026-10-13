import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { createHousehold } from './helpers/auth';

type ApiEnvelope<T> = { success: boolean; data: T };
type ShoppingList = {
  id: string;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string | null;
    checked: boolean | number;
    source: string;
  }>;
};

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

function nextMonday(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const current = new Date(Date.UTC(year!, month! - 1, day!));
  const daysUntilMonday = (8 - current.getUTCDay()) % 7 || 7;
  return addDays(date, daysUntilMonday);
}

async function registerAndCreateSyntheticHousehold(page: import('@playwright/test').Page) {
  await page.goto('/auth/register');
  await page.locator('input#name').waitFor({ state: 'visible' });
  await page.locator('input#name').fill('Aprobación sintética');
  await page.locator('input#email').fill(`meal-shopping-${randomUUID()}@example.test`);
  await page.locator('input#password').fill('Test1234');
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register')
  );
  await page.locator('button[type="submit"]').click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  await expect(page).toHaveURL(/\/(dashboard|onboarding|household)(\?|$)/, { timeout: 45000 });
  if (new URL(page.url()).pathname.endsWith('/onboarding')) {
    await page.getByRole('button', { name: /Saltar por ahora/i }).click();
    await expect(page).toHaveURL(/\/(dashboard|household)/, { timeout: 45000 });
  }
  await createHousehold(page, 'Hogar sintético de compra');
}

async function expectMobileShoppingLayout(
  page: import('@playwright/test').Page,
  viewport: { width: number; height: number }
) {
  await page.setViewportSize(viewport);
  const layout = await page.evaluate(() => {
    const tabList = document.querySelector<HTMLElement>('.meal-planner__steps');
    const tabs = Array.from(tabList?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const header = document.querySelector<HTMLElement>('.meal-planner__shopping-header');
    const heading = header?.querySelector('h3')?.getBoundingClientRect();
    const count = header?.querySelector('.meal-planner__event-count')?.getBoundingClientRect();
    const listBounds = tabList?.getBoundingClientRect();
    return {
      tabClientWidth: tabList?.clientWidth ?? 0,
      tabScrollWidth: tabList?.scrollWidth ?? 0,
      tabBounds: listBounds ? { left: listBounds.left, right: listBounds.right } : null,
      tabs: tabs.map((tab) => {
        const bounds = tab.getBoundingClientRect();
        return {
          text: tab.innerText.trim(),
          width: bounds.width,
          height: bounds.height,
          left: bounds.left,
          right: bounds.right
        };
      }),
      heading: heading ? { top: heading.top, bottom: heading.bottom } : null,
      count: count ? { top: count.top, bottom: count.bottom } : null
    };
  });

  expect(layout.tabs.map((tab) => tab.text)).toEqual([
    'Preparar',
    'Revisar propuesta',
    'Revisar compra'
  ]);
  expect(layout.tabScrollWidth).toBeLessThanOrEqual(layout.tabClientWidth + 1);
  expect(layout.tabBounds).toBeTruthy();
  for (const tab of layout.tabs) {
    expect(tab.width).toBeGreaterThan(0);
    expect(tab.height).toBeGreaterThanOrEqual(44);
    expect(tab.left).toBeGreaterThanOrEqual(layout.tabBounds!.left - 1);
    expect(tab.right).toBeLessThanOrEqual(layout.tabBounds!.right + 1);
  }
  expect(layout.heading).toBeTruthy();
  expect(layout.count).toBeTruthy();
  expect(layout.heading!.bottom).toBeLessThanOrEqual(layout.count!.top);
}

test('plan semanal de compra permite revisar, editar, cancelar y aprobar sin tocar el inventario', async ({
  page
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await registerAndCreateSyntheticHousehold(page);

  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token).toBeTruthy();
  const householdResponse = await page.request.get('/api/household', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(householdResponse.ok(), await householdResponse.text()).toBeTruthy();
  const household = (await householdResponse.json()) as ApiEnvelope<{
    id: string;
    members: Array<{ id: string; isActive: boolean }>;
  }>;
  const householdId = household.data.id;
  const memberId = household.data.members.find((member) => member.isActive)?.id;
  expect(memberId).toBeTruthy();
  const headers = {
    authorization: `Bearer ${token}`,
    'x-household-id': householdId
  };

  const settings = await page.request.patch('/api/household/meal-planning', {
    headers,
    data: {
      household: {
        mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
        mealTimes: { lunch: '13:00' }
      }
    }
  });
  expect(settings.ok(), await settings.text()).toBeTruthy();

  // Seed one future household meal through the normal confirmation route. This is a synthetic
  // fixture, so the E2E does not call a provider and does not write to a real pantry.
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = nextMonday(today);
  const recipeName = 'Ingrediente de compra sintético';
  const confirmation = await page.request.post('/api/household/meal-planning/confirm', {
    headers,
    data: {
      proposalId: `shopping-e2e-${testInfo.workerIndex}-${testInfo.retry}`,
      weekStart,
      householdMemberIds: [memberId],
      events: Array.from({ length: 7 }, (_, index) => ({
        id: `synthetic-lunch-event-${index}`,
        date: addDays(weekStart, index),
        mealType: 'lunch',
        time: '13:00',
        recipe: {
          name: 'Comida de prueba',
          description: 'Comida sintética de una ración.',
          baseServings: 1,
          prepTimeMinutes: 5,
          cookTimeMinutes: 10,
          ingredients: [
            {
              name: recipeName,
              quantity: 20,
              unit: 'g',
              preparation: null,
              isOptional: false,
              notes: null
            }
          ],
          instructions: ['Preparación sintética para E2E.']
        },
        participantAliases: ['P1'],
        servings: 1,
        objectiveSummary: 'Comida sintética equilibrada.',
        status: 'scheduled',
        reason: null
      }))
    }
  });
  expect(confirmation.status(), await confirmation.text()).toBe(200);

  const readLists = async () => {
    const response = await page.request.get('/api/shopping/lists?status=active', { headers });
    expect(response.ok(), await response.text()).toBeTruthy();
    return ((await response.json()) as ApiEnvelope<Array<{ id: string }>>).data;
  };
  const readPantrySnapshot = async () => {
    const response = await page.request.get('/api/pantry/ingredients?pageSize=100', { headers });
    expect(response.ok(), await response.text()).toBeTruthy();
    const body = (await response.json()) as ApiEnvelope<{
      ingredients: Array<{ id: string; name: string; quantity: number; unit: string }>;
    }>;
    return body.data.ingredients
      .map(({ id, name, quantity, unit }) => ({ id, name, quantity, unit }))
      .sort((left, right) => left.id.localeCompare(right.id));
  };

  const pantryBefore = await readPantrySnapshot();
  expect(await readLists()).toHaveLength(0);

  await page.goto('/household?tab=tasks&planning=meals');
  const shoppingTab = page.locator('[data-test="meal-proposal-step-tab-shopping"]');
  await expect(shoppingTab).toBeVisible();
  await shoppingTab.click();
  const shoppingPanel = page.locator('[data-test="meal-shopping-step-panel"]');
  await expect(shoppingPanel).toBeVisible();
  await expect(page.locator('[data-test="meal-shopping-line-"]')).toHaveCount(0);
  const quantityInput = page.locator('[data-test="meal-shopping-quantity"]');
  await expect(quantityInput).toHaveCount(1);
  await expect(quantityInput).toHaveValue('140');

  // Editing is local until approval. Cancel must discard the draft and not create a list.
  await quantityInput.fill('280');
  await page.locator('[data-test="meal-shopping-cancel"] button').click();
  await expect(shoppingPanel).toBeHidden();
  expect(await readLists()).toHaveLength(0);
  expect(await readPantrySnapshot()).toEqual(pantryBefore);

  await shoppingTab.click();
  await expect(shoppingPanel).toBeVisible();
  await expect(quantityInput).toHaveValue('140');
  await quantityInput.fill('280');

  // Simulate a transient API failure and prove it leaves both pantry and list untouched.
  let failedOnce = false;
  await page.route('**/api/shopping/meal-plan/approve', async (route) => {
    if (!failedOnce) {
      failedOnce = true;
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, code: 'SYNTHETIC_TEMPORARY_FAILURE' })
      });
      return;
    }
    await route.continue();
  });
  await page.locator('[data-test="meal-shopping-approve"] button').click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await readLists()).toHaveLength(0);
  expect(await readPantrySnapshot()).toEqual(pantryBefore);

  let approvalRequestBody: Record<string, unknown> | undefined;
  const approvalRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/api/shopping/meal-plan/approve') && request.method() === 'POST'
  );
  await page.locator('[data-test="meal-shopping-approve"] button').click();
  approvalRequestBody = (await approvalRequest).postDataJSON() as Record<string, unknown>;
  await expect(page.locator('.meal-planner__shopping-success')).toContainText(/lista de compra/i);
  await page.unroute('**/api/shopping/meal-plan/approve');

  const createdLists = await readLists();
  expect(createdLists).toHaveLength(1);
  const listId = createdLists[0]!.id;
  const listResponse = await page.request.get(`/api/shopping/lists/${listId}`, { headers });
  expect(listResponse.ok(), await listResponse.text()).toBeTruthy();
  const approvedList = (await listResponse.json()) as ApiEnvelope<ShoppingList>;
  const approvedLine = approvedList.data.items.find((item) => item.name === recipeName);
  expect(approvedLine).toMatchObject({ quantity: 280, unit: 'g', source: 'meal_plan' });

  // The UI approval is the only pantry-neutral action. Add a manual row and mark the generated
  // row bought through the real list endpoints, then replay the exact approval payload: neither
  // row may be recreated, removed, unchecked, or folded into the pantry.
  const manualResponse = await page.request.post(`/api/shopping/lists/${listId}/items`, {
    headers,
    data: { name: 'Fila manual sintética', quantity: 1, unit: 'unit' }
  });
  expect(manualResponse.status(), await manualResponse.text()).toBe(201);
  const manualLine = ((await manualResponse.json()) as ApiEnvelope<{ id: string; source: string }>)
    .data;
  expect(manualLine.source).toBe('manual');
  const checkResponse = await page.request.patch(
    `/api/shopping/lists/${listId}/items/${approvedLine!.id}`,
    { headers, data: { checked: true } }
  );
  expect(checkResponse.ok(), await checkResponse.text()).toBeTruthy();

  const replay = await page.request.post('/api/shopping/meal-plan/approve', {
    headers,
    data: approvalRequestBody
  });
  expect(replay.ok(), await replay.text()).toBeTruthy();
  expect(((await replay.json()) as ApiEnvelope<{ idempotent: boolean }>).data.idempotent).toBe(
    true
  );

  const finalListResponse = await page.request.get(`/api/shopping/lists/${listId}`, { headers });
  expect(finalListResponse.ok(), await finalListResponse.text()).toBeTruthy();
  const finalList = (await finalListResponse.json()) as ApiEnvelope<ShoppingList>;
  expect(finalList.data.items).toHaveLength(2);
  expect(finalList.data.items.find((item) => item.id === approvedLine!.id)).toMatchObject({
    checked: 1,
    source: 'meal_plan'
  });
  expect(finalList.data.items.find((item) => item.id === manualLine.id)).toMatchObject({
    name: 'Fila manual sintética',
    source: 'manual'
  });
  expect(await readPantrySnapshot()).toEqual(pantryBefore);

  if (testInfo.project.name === 'mobile-chrome') {
    await expectMobileShoppingLayout(page, { width: 390, height: 844 });
    await expectMobileShoppingLayout(page, { width: 320, height: 740 });
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  const screenshotDirectory = resolve('.e2e-screenshots/household-meal-shopping-approval');
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, `${testInfo.project.name}-approval.png`),
    fullPage: testInfo.project.name === 'chromium',
    animations: 'disabled'
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width
  );
});
