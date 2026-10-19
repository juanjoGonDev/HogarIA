import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, registerAndGoto } from './helpers/auth';

type Envelope<T> = { data: T };
type Membership = { id: string; name: string };
type HomeData = {
  ingredientName: string;
  mealName: string;
  listName: string;
  receiptId: string;
  receiptFileName: string;
};

async function headersFor(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate((key) => localStorage.getItem(key), 'hogar:v1:auth_token');
  expect(token).toBeTruthy();
  return { authorization: `Bearer ${token}` };
}

async function postJson<T>(
  page: Page,
  path: string,
  headers: Record<string, string>,
  data: unknown
) {
  const response = await page.request.post(path, { headers, data });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(201);
  return ((await response.json()) as Envelope<T>).data;
}

async function readJson<T>(page: Page, path: string, headers: Record<string, string>): Promise<T> {
  const response = await page.request.get(path, { headers });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return ((await response.json()) as Envelope<T>).data;
}

async function seedHomeData(page: Page, name: string, date: string): Promise<HomeData> {
  const headers = await headersFor(page);
  const ingredientName = `Alimento ${name}`;
  const mealName = `Comida ${name}`;
  const listName = `Lista ${name}`;
  const receiptFileName = `ticket-${name}.png`;
  await postJson(page, '/api/pantry/ingredients', headers, {
    name: ingredientName,
    category: 'other',
    quantity: 1,
    unit: 'unit',
    location: 'pantry'
  });

  const receipt = await page.request.post('/api/receipts', {
    headers,
    multipart: {
      file: {
        name: receiptFileName,
        mimeType: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      }
    }
  });
  expect(receipt.status(), `/api/receipts: ${await receipt.text()}`).toBe(201);
  const receiptData = ((await receipt.json()) as Envelope<{ id: string; fileName: string }>).data;
  expect(receiptData.fileName).toBe(receiptFileName);
  await expect
    .poll(
      async () => {
        const detail = await page.request.get(`/api/receipts/${receiptData.id}`, { headers });
        if (!detail.ok()) return null;
        const data = (
          (await detail.json()) as Envelope<{ status: string; job: { error_code: string } | null }>
        ).data;
        return { status: data.status, error: data.job?.error_code ?? null };
      },
      { message: 'synthetic ticket must not reach an AI provider in the isolated run' }
    )
    .toEqual({ status: 'failed', error: 'NO_CONFIG' });

  await postJson(page, '/api/calendar/meals', headers, {
    date,
    mealType: 'lunch',
    customMeal: mealName,
    servings: 2
  });

  const list = await postJson<{ id: string }>(page, '/api/shopping/lists', headers, {
    name: listName
  });
  await postJson(page, `/api/shopping/lists/${list.id}/items`, headers, {
    name: `Compra ${name}`,
    quantity: 1,
    unit: 'ud'
  });

  return {
    ingredientName,
    mealName,
    listName,
    receiptId: receiptData.id,
    receiptFileName
  };
}

async function chooseHome(page: Page, name: string): Promise<void> {
  if (test.info().project.name === 'mobile-chrome') {
    const sidebar = page.locator('.sidebar');
    if (!(await sidebar.evaluate((element) => element.classList.contains('sidebar--open')))) {
      await page.locator('.header__menu').click();
    }
    await expect(sidebar).toHaveClass(/sidebar--open/);
  }
  const trigger = page.locator('[data-test="active-household-select"] .picker__trigger');
  await trigger.click();
  const selection = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/household/active') && response.request().method() === 'POST'
  );
  await page.getByRole('option', { name, exact: true }).click();
  expect((await selection).ok()).toBeTruthy();
  await expect(trigger).toHaveAttribute('aria-label', `Hogar activo: ${name}`);
  if (test.info().project.name === 'mobile-chrome') {
    await page.locator('.sidebar__close').click();
    await expect(page.locator('.sidebar-overlay')).toHaveCount(0);
  }
}

async function localDate(page: Page): Promise<string> {
  return page.evaluate(() => {
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  });
}

test('isolates pantry, receipts, calendar and shopping across active homes in one session', async ({
  page,
  browser
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  const secondContext = await browser.newContext({ locale: 'es-ES', viewport });
  const secondPage = await secondContext.newPage();
  const date = await localDate(page);
  const names = {
    one: 'Integración hogar uno',
    two: 'Integración hogar dos'
  };
  let homeOneData: HomeData;
  let homeTwoData: HomeData;
  let releaseHeldShoppingResponse: (() => void) | undefined;

  try {
    await registerAndGoto(page, '/household', 'Cuenta integración uno');
    await createHousehold(page, names.one);
    homeOneData = await seedHomeData(page, 'hogar uno', date);

    await registerAndGoto(secondPage, '/household', 'Cuenta integración dos');
    await createHousehold(secondPage, names.two);
    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();

    await page.goto('/household');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await dialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await dialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText(names.two);
    homeTwoData = await seedHomeData(page, 'hogar dos', date);

    const headers = await headersFor(page);
    const membershipResponse = await page.request.get('/api/household/memberships', { headers });
    expect(membershipResponse.ok()).toBeTruthy();
    const memberships = (await membershipResponse.json()).data.memberships as Membership[];
    const homeOne = memberships.find((membership) => membership.name === names.one);
    const homeTwo = memberships.find((membership) => membership.name === names.two);
    expect(homeOne).toBeTruthy();
    expect(homeTwo).toBeTruthy();

    const assertApiScope = async (included: HomeData, excluded: HomeData): Promise<void> => {
      const ingredients = await readJson<{ ingredients: Array<{ name: string }> }>(
        page,
        '/api/pantry/ingredients',
        headers
      );
      expect(ingredients.ingredients.map((item) => item.name)).toContain(included.ingredientName);
      expect(ingredients.ingredients.map((item) => item.name)).not.toContain(
        excluded.ingredientName
      );

      const receipts = await readJson<Array<{ id: string; fileName: string }>>(
        page,
        '/api/receipts',
        headers
      );
      expect(receipts.map((receipt) => receipt.id)).toEqual([included.receiptId]);
      expect(receipts.map((receipt) => receipt.fileName)).not.toContain(excluded.receiptFileName);

      const calendar = await readJson<{ meals: Array<{ custom_meal: string }> }>(
        page,
        `/api/calendar/range?startDate=${date}&endDate=${date}`,
        headers
      );
      expect(calendar.meals.map((meal) => meal.custom_meal)).toContain(included.mealName);
      expect(calendar.meals.map((meal) => meal.custom_meal)).not.toContain(excluded.mealName);

      const shopping = await readJson<Array<{ name: string }>>(
        page,
        '/api/shopping/lists?status=active',
        headers
      );
      expect(shopping.map((list) => list.name)).toContain(included.listName);
      expect(shopping.map((list) => list.name)).not.toContain(excluded.listName);
    };

    const screenshotRoot = process.env.E2E_SCREENSHOT_DIR
      ? resolve(process.env.E2E_SCREENSHOT_DIR)
      : join(process.cwd(), '.e2e-screenshots');
    const screenshotDirectory = join(screenshotRoot, 'household-cross-service-context');
    const assertUiScope = async (
      included: HomeData,
      excluded: HomeData,
      homeKey: string
    ): Promise<void> => {
      const views = [
        {
          name: 'pantry',
          route: '/pantry',
          included: page
            .locator('[data-test="pantry-tabla-inventario"] tr.ingredient-item')
            .filter({ hasText: included.ingredientName }),
          excluded: page
            .locator('[data-test="pantry-tabla-inventario"] tr.ingredient-item')
            .filter({ hasText: excluded.ingredientName })
        },
        {
          name: 'receipts',
          route: '/receipts',
          included: page.locator('.ticket__nombre').filter({ hasText: included.receiptFileName }),
          excluded: page.locator('.ticket__nombre').filter({ hasText: excluded.receiptFileName })
        },
        {
          name: 'calendar',
          route: '/calendar',
          included: page.getByRole('button', { name: included.mealName, exact: true }),
          excluded: page.getByRole('button', { name: excluded.mealName, exact: true })
        },
        {
          name: 'shopping',
          route: '/shopping',
          included: page.getByText(included.listName, { exact: true }),
          excluded: page.getByText(excluded.listName, { exact: true })
        }
      ];

      for (const view of views) {
        await page.goto(view.route);
        if (view.name === 'calendar') {
          const picker = page.locator('[data-test="calendar-view-select"]');
          await picker.locator('.picker__trigger').click();
          await page.getByRole('option', { name: 'Día', exact: true }).click();
          await expect(picker).toHaveAttribute('data-view', 'day');
        }
        await expect(view.included, `${view.name} should show active-household data`).toBeVisible();
        await view.included.scrollIntoViewIfNeeded();
        await expect(view.excluded, `${view.name} must not show other-household data`).toHaveCount(
          0
        );
        await mkdir(join(screenshotDirectory, testInfo.project.name, homeKey), { recursive: true });
        await page.screenshot({
          path: join(screenshotDirectory, testInfo.project.name, homeKey, `${view.name}.png`),
          animations: 'disabled'
        });
      }
    };

    await assertApiScope(homeTwoData, homeOneData);
    await assertUiScope(homeTwoData, homeOneData, 'home-two');
    await page.goto('/household');
    await chooseHome(page, names.one);
    await expect(page.locator('.household-info__name')).toHaveText(names.one);
    await assertApiScope(homeOneData, homeTwoData);
    await assertUiScope(homeOneData, homeTwoData, 'home-one');

    await page.goto('/shopping');
    let resolveReady!: () => void;
    let releaseResponse!: () => void;
    const oldResponseReady = new Promise<void>((resolveReadyPromise) => {
      resolveReady = resolveReadyPromise;
    });
    const releaseOldResponse = new Promise<void>((resolveRelease) => {
      releaseResponse = resolveRelease;
      releaseHeldShoppingResponse = resolveRelease;
    });
    let holdNextList = true;
    let namesFromOldResponse: string[] = [];

    await page.route('**/api/shopping/lists?*', async (route) => {
      if (!holdNextList) return route.continue();
      holdNextList = false;
      const response = await route.fetch();
      const payload = (await response.json()) as { data?: Array<{ name: string }> };
      namesFromOldResponse = payload.data?.map((list) => list.name) ?? [];
      resolveReady();
      await releaseOldResponse;
      await route.fulfill({ response });
    });

    await page.reload();
    await oldResponseReady;
    expect(namesFromOldResponse).toContain(homeOneData.listName);
    expect(namesFromOldResponse).not.toContain(homeTwoData.listName);

    await chooseHome(page, names.two);
    await expect(page.getByText(homeTwoData.listName, { exact: true })).toBeVisible();
    await expect(page.getByText(homeOneData.listName, { exact: true })).toHaveCount(0);
    releaseResponse();
    await expect(page.getByText(homeTwoData.listName, { exact: true })).toBeVisible();
    await expect(page.getByText(homeOneData.listName, { exact: true })).toHaveCount(0);
    await mkdir(join(screenshotDirectory, testInfo.project.name, 'late-response'), {
      recursive: true
    });
    await page.screenshot({
      path: join(screenshotDirectory, testInfo.project.name, 'late-response', 'home-two.png'),
      animations: 'disabled'
    });
  } finally {
    releaseHeldShoppingResponse?.();
    await secondContext.close();
  }
});
