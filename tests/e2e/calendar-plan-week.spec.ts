import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures';
import { createHousehold, registerAndGoto } from './helpers/auth';

type ProviderRequest = {
  messages?: Array<{ role?: string; content?: string }>;
  response_format?: {
    type?: string;
    json_schema?: {
      name?: string;
      strict?: boolean;
      schema?: Record<string, unknown>;
    };
  };
};

test('la planificación semanal reintenta tras error y no duplica comidas', async ({ page }) => {
  const expectedStart = '2026-10-19';
  const expectedEnd = '2026-10-25';
  const providerRequests: ProviderRequest[] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const providerRequest = JSON.parse(body) as ProviderRequest;
      providerRequests.push(providerRequest);

      const reply = () => {
        if (providerRequests.length === 1) {
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'synthetic provider failure' } }));
          return;
        }

        const prompt =
          providerRequest.messages?.find((message) => message.role === 'user')?.content ?? '';
        const startDate = prompt.match(/Del (\d{4}-\d{2}-\d{2}) al /)?.[1];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    days: startDate
                      ? [
                          {
                            date: startDate,
                            meals: {
                              lunch: {
                                name: 'Comida sintética sin duplicados',
                                ingredients: ['tomate'],
                                time: 0
                              }
                            },
                            totalCalories: 350
                          }
                        ]
                      : [],
                    shoppingList: ['tomate']
                  })
                }
              }
            ]
          })
        );
      };

      if (providerRequests.length === 1) {
        setTimeout(reply, 350);
      } else {
        reply();
      }
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerPort = (provider.address() as AddressInfo).port;

  try {
    await registerAndGoto(page, '/household', 'Planificador semanal sintético');
    await createHousehold(page, 'Hogar plan semanal sintético');

    const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(token).toBeTruthy();
    const headers = { authorization: `Bearer ${token}` };
    const householdResponse = await page.request.get('/api/household', { headers });
    expect(householdResponse.ok()).toBeTruthy();
    const household = (await householdResponse.json()) as {
      data: { members: Array<{ id: string; isActive: boolean }> };
    };
    const activeMemberIds = household.data.members
      .filter((member) => member.isActive)
      .map((member) => member.id);
    expect(activeMemberIds.length).toBeGreaterThan(0);

    const configResponse = await page.request.post('/api/ai/configs', {
      headers,
      data: {
        name: 'Proveedor local sintético',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-test-model',
        retryAttempts: 0,
        concurrency: 0
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);

    await page.goto(`/calendar?view=week&date=2026-10-21`);
    await expect(page.locator('h1.calendar__title')).toBeVisible();

    const openAndPreparePlan = async () => {
      await page.getByRole('button', { name: /Planificar IA/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Planificar con IA' });
      await expect(dialog).toBeVisible();

      for (const meal of ['breakfast', 'snack', 'dinner']) {
        const checkbox = dialog.locator(`[data-test="gen-meal-${meal}"] button[role="checkbox"]`);
        if ((await checkbox.getAttribute('aria-checked')) === 'true') await checkbox.click();
      }
      const lunch = dialog.locator('[data-test="gen-meal-lunch"] button[role="checkbox"]');
      if ((await lunch.getAttribute('aria-checked')) !== 'true') await lunch.click();

      for (const goal of [
        'balanced',
        'weight-loss',
        'weight-gain',
        'muscle-gain',
        'maintenance',
        'variety',
        'custom'
      ]) {
        const button = dialog.locator(`[data-test="generate-goal-${goal}"]`);
        const shouldSelect = ['weight-loss', 'custom'].includes(goal);
        if ((await button.getAttribute('aria-pressed')) !== String(shouldSelect)) {
          await button.click();
        }
      }
      await dialog.locator('#gen-custom').fill('Preferencia sintética: cenas sencillas.');
      return { dialog, submit: dialog.locator('button.cal-btn--primary') };
    };

    const first = await openAndPreparePlan();
    const firstRequest = page.waitForRequest(
      (request) => request.url().includes('/api/ai/plan-week') && request.method() === 'POST'
    );
    const firstResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ai/plan-week') && response.request().method() === 'POST'
    );
    await first.submit.click();

    const sent = (await firstRequest).postDataJSON() as {
      startDate: string;
      endDate: string;
      mealTypes: string[];
      goals: { types: string[]; customInstructions?: string };
      householdMemberIds: string[];
    };
    expect(sent).toMatchObject({
      startDate: expectedStart,
      endDate: expectedEnd,
      mealTypes: ['lunch'],
      goals: {
        types: ['weight-loss', 'custom'],
        customInstructions: 'Preferencia sintética: cenas sencillas.'
      },
      householdMemberIds: activeMemberIds
    });

    await expect(first.submit).toBeDisabled();
    await expect(first.submit).toHaveAttribute('aria-busy', 'true');
    const failed = await firstResponse;
    expect(failed.ok()).toBe(false);
    await expect(page.getByText('No se pudo generar el plan')).toBeVisible();
    await expect(first.dialog).toBeVisible();
    await expect(first.submit).toBeEnabled();
    expect(providerRequests).toHaveLength(1);

    const rangeUrl = `/api/calendar/range?startDate=${expectedStart}&endDate=${expectedEnd}`;
    const afterFailure = await page.request.get(rangeUrl, { headers });
    expect(afterFailure.ok()).toBeTruthy();
    const failedRange = (await afterFailure.json()) as { data: { meals: unknown[] } };
    expect(failedRange.data.meals).toHaveLength(0);

    const retryRequest = page.waitForRequest(
      (request) => request.url().includes('/api/ai/plan-week') && request.method() === 'POST'
    );
    const retryResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ai/plan-week') && response.request().method() === 'POST'
    );
    await first.submit.click();
    const retryPayload = await retryResponse;
    expect(retryPayload.status()).toBe(200);
    await retryRequest;
    const retryResult = (await retryPayload.json()) as {
      data: { saved: { created: number; skipped: number } };
    };
    expect(retryResult.data.saved).toMatchObject({ created: 1, skipped: 0 });
    await expect(page.getByText('Plan guardado')).toBeVisible();

    const successfulProviderRequest = providerRequests[1];
    expect(successfulProviderRequest?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'weekly_plan', strict: true }
    });
    const schema = successfulProviderRequest?.response_format?.json_schema?.schema;
    const properties = schema?.properties as Record<string, unknown>;
    const days = properties.days as { items: { properties: Record<string, unknown> } };
    const meals = days.items.properties.meals as { properties: Record<string, unknown> };
    expect(Object.keys(meals.properties)).toEqual(['lunch']);
    expect(
      successfulProviderRequest?.messages?.find((message) => message.role === 'user')?.content
    ).toContain('Preferencia sintética: cenas sencillas.');

    const afterSuccess = await page.request.get(rangeUrl, { headers });
    expect(afterSuccess.ok()).toBeTruthy();
    const successfulRange = (await afterSuccess.json()) as {
      data: { meals: Array<{ date: string; meal_type: string; custom_meal: string }> };
    };
    expect(successfulRange.data.meals).toMatchObject([
      {
        date: expectedStart,
        meal_type: 'lunch',
        custom_meal: 'Comida sintética sin duplicados'
      }
    ]);
    expect(successfulRange.data.meals).toHaveLength(1);

    const repeated = await openAndPreparePlan();
    const repeatedResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ai/plan-week') && response.request().method() === 'POST'
    );
    await repeated.submit.click();
    const repeatedPlan = await repeatedResponse;
    expect(repeatedPlan.status()).toBe(200);
    const repeatedResult = (await repeatedPlan.json()) as {
      data: { saved: { created: number; skipped: number } };
    };
    expect(repeatedResult.data.saved).toMatchObject({ created: 0, skipped: 1 });
    expect(providerRequests).toHaveLength(3);

    const afterRepeat = await page.request.get(rangeUrl, { headers });
    expect(afterRepeat.ok()).toBeTruthy();
    const repeatedRange = (await afterRepeat.json()) as {
      data: { meals: Array<{ date: string; meal_type: string; custom_meal: string }> };
    };
    expect(repeatedRange.data.meals).toEqual(successfulRange.data.meals);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});
