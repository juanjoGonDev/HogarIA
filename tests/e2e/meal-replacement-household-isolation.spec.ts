import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures';
import { createHousehold, registerAndGoto } from './helpers/auth';

const today = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
};

test('sustituir una comida usa solo miembros elegidos del hogar activo y persiste al confirmar', async ({
  page,
  browser
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 320, height: 568 };
  await page.setViewportSize(viewport);
  const secondPage = await browser.newPage({ locale: 'es-ES', viewport });
  const providerRequests: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      providerRequests.push(JSON.parse(body) as (typeof providerRequests)[number]);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  safe: true,
                  name: 'Arroz vegetal multicasa QA',
                  description: 'Alternativa sintética para comprobar aislamiento.',
                  ingredients: ['arroz', 'calabacín'],
                  estimatedTime: 25,
                  servings: 2
                })
              }
            }
          ]
        })
      );
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerPort = (provider.address() as AddressInfo).port;
  let firstHeaders: { authorization: string } | undefined;
  let secondHeaders: { authorization: string } | undefined;
  let mealId = '';
  let configId = '';

  try {
    await registerAndGoto(page, '/household', 'Sustitución sintética hogar uno');
    await createHousehold(page, 'Hogar sintético de sustitución uno');
    const firstToken = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(firstToken).toBeTruthy();
    firstHeaders = { authorization: `Bearer ${firstToken}` };
    const firstHouseResponse = await page.request.get('/api/household', { headers: firstHeaders });
    expect(firstHouseResponse.ok()).toBeTruthy();
    const firstHouse = (await firstHouseResponse.json()) as {
      data: { members: Array<{ id: string; isActive: boolean }> };
    };
    const formerHouseMemberId = firstHouse.data.members.find((member) => member.isActive)?.id;
    expect(formerHouseMemberId).toBeTruthy();

    await registerAndGoto(secondPage, '/household', 'Sustitución sintética hogar dos');
    await createHousehold(secondPage, 'Hogar sintético de sustitución dos');
    const secondToken = await secondPage.evaluate(() =>
      localStorage.getItem('hogar:v1:auth_token')
    );
    expect(secondToken).toBeTruthy();
    secondHeaders = { authorization: `Bearer ${secondToken}` };
    const configResponse = await secondPage.request.post('/api/ai/configs', {
      headers: secondHeaders,
      data: {
        name: 'Proveedor sintético multicasa',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-test-model',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);
    configId = ((await configResponse.json()) as { data: { id: string } }).data.id;

    const secondInvite = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(secondInvite).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();
    await page.goto('/household');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const joinDialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText(
      'Hogar sintético de sustitución dos'
    );

    const currentHouseResponse = await page.request.get('/api/household', {
      headers: firstHeaders
    });
    expect(currentHouseResponse.ok()).toBeTruthy();
    const currentHouse = (await currentHouseResponse.json()) as {
      data: {
        members: Array<{ id: string; name: string; email: string; isActive: boolean }>;
      };
    };
    const currentMembers = currentHouse.data.members.filter((member) => member.isActive);
    expect(currentMembers).toHaveLength(2);
    expect(currentMembers.some((member) => member.id === formerHouseMemberId)).toBe(false);
    const selectedMember = currentMembers.find(
      (member) => member.name === 'Sustitución sintética hogar uno'
    );
    const excludedMember = currentMembers.find(
      (member) => member.name === 'Sustitución sintética hogar dos'
    );
    expect(selectedMember).toBeTruthy();
    expect(excludedMember).toBeTruthy();

    for (const [headers, allergy] of [
      [firstHeaders, 'sésamo QA'],
      [secondHeaders, 'nuez QA']
    ] as const) {
      const tasteResponse = await page.request.patch('/api/auth/taste', {
        headers,
        data: { taste: { allergies: [allergy] } }
      });
      expect(tasteResponse.ok(), await tasteResponse.text()).toBeTruthy();
    }

    const mealResponse = await page.request.post('/api/calendar/meals', {
      headers: firstHeaders,
      data: {
        date: today(),
        mealType: 'dinner',
        customMeal: 'Pasta original multicasa QA',
        time: '20:00',
        servings: 2
      }
    });
    expect(mealResponse.status(), await mealResponse.text()).toBe(201);
    mealId = ((await mealResponse.json()) as { data: { id: string } }).data.id;

    await page.goto('/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    const meal = page.locator('[data-test="timeline-block-meal"]').filter({
      hasText: 'Pasta original multicasa QA'
    });
    await expect(meal).toHaveCount(1);
    await meal.click();
    const editor = page.locator('app-modal:has(#meal-custom)');
    const replacementToggle = editor.locator('[data-test="open-meal-replacement"]');
    await replacementToggle.click();
    const participants = editor.locator('[data-test="ai-participants"]');
    await expect(
      participants.locator(`[data-test="ai-member-${selectedMember!.id}"]`)
    ).toBeChecked();
    await expect(
      participants.locator(`[data-test="ai-member-${excludedMember!.id}"]`)
    ).toBeChecked();
    await expect(
      participants.locator(`[data-test="ai-member-${formerHouseMemberId}"]`)
    ).toHaveCount(0);
    await participants.locator(`[data-test="ai-member-${excludedMember!.id}"]`).uncheck();

    const replacementRequest = page.waitForRequest(
      (request) => request.url().includes('/api/ai/replace-meal') && request.method() === 'POST'
    );
    const replacementResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ai/replace-meal') && response.request().method() === 'POST'
    );
    await editor.locator('[data-test="request-meal-replacement"]').click();
    const request = (await replacementRequest).postDataJSON() as {
      householdMemberIds: string[];
      guests: unknown[];
    };
    expect(request).toEqual({
      mealId,
      householdMemberIds: [selectedMember!.id],
      guests: []
    });
    const response = await replacementResponse;
    expect(response.status(), await response.text()).toBe(200);
    await expect(editor.locator('[data-test="replacement-candidate"]')).toContainText(
      'Arroz vegetal multicasa QA'
    );

    expect(providerRequests).toHaveLength(1);
    const prompt =
      providerRequests[0]?.messages?.map((message) => message.content ?? '').join('\n') ?? '';
    expect(prompt).toContain('sésamo QA');
    expect(prompt).not.toContain('nuez QA');
    for (const member of currentMembers) {
      expect(prompt).not.toContain(member.name);
      expect(prompt).not.toContain(member.email);
      expect(prompt).not.toContain(member.id);
    }
    expect(prompt).not.toContain(formerHouseMemberId);

    const beforeApply = await page.request.get(
      `/api/calendar/range?startDate=${today()}&endDate=${today()}`,
      { headers: firstHeaders }
    );
    expect(beforeApply.ok()).toBeTruthy();
    const oldMeal = (
      (await beforeApply.json()) as {
        data: { meals: Array<{ id: string; custom_meal: string }> };
      }
    ).data.meals.find((item) => item.id === mealId);
    expect(oldMeal?.custom_meal).toBe('Pasta original multicasa QA');

    await editor.locator('[data-test="apply-meal-replacement"]').click();
    await expect(page.locator('[data-test="timeline-block-meal"]')).toContainText(
      'Arroz vegetal multicasa QA'
    );
    const persistedResponse = await page.request.get(
      `/api/calendar/range?startDate=${today()}&endDate=${today()}`,
      { headers: firstHeaders }
    );
    expect(persistedResponse.ok()).toBeTruthy();
    const persistedMeal = (
      (await persistedResponse.json()) as {
        data: {
          meals: Array<{ id: string; custom_meal: string; time: string | null; servings: number }>;
        };
      }
    ).data.meals.find((item) => item.id === mealId);
    expect(persistedMeal).toMatchObject({
      id: mealId,
      custom_meal: 'Arroz vegetal multicasa QA',
      time: '20:00',
      servings: 2
    });
    expect(providerRequests).toHaveLength(1);
  } finally {
    if (mealId && firstHeaders) {
      await page.request
        .delete(`/api/calendar/meals/${mealId}`, { headers: firstHeaders })
        .catch(() => undefined);
    }
    if (configId && secondHeaders) {
      await secondPage.request
        .delete(`/api/ai/configs/${configId}`, { headers: secondHeaders })
        .catch(() => undefined);
    }
    await secondPage.close();
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});
