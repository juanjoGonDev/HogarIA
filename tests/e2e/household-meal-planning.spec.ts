import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { createHousehold } from './helpers/auth';

interface ProviderRequest {
  messages?: Array<{ role?: string; content?: string }>;
  response_format?: { type?: string; json_schema?: { name?: string; strict?: boolean } };
}

interface ExpectedSlot {
  date: string;
  mealType: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  time: string;
  eligibleParticipants: string[];
}

const screenshotDirectory = resolve('.e2e-screenshots/household-meal-planning');

async function registerWithoutAssumingOnboarding(
  page: import('@playwright/test').Page,
  name: string
) {
  await page.goto('/auth/register');
  await page.locator('input#name').waitFor({ state: 'visible' });
  await page.locator('input#name').fill(name);
  await page.locator('input#email').fill(`meal-proposal-${randomUUID()}@example.test`);
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
  await page.goto('/household');
}

test('genera, revisa y confirma comidas con navegación de planificación en escritorio y móvil', async ({
  page,
  browser
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 };
  await page.setViewportSize(viewport);

  const secondPage = await browser.newPage({ locale: 'es-ES', viewport });
  const providerRequests: ProviderRequest[] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const payload = JSON.parse(body) as ProviderRequest;
      providerRequests.push(payload);
      const prompt = payload.messages?.find((message) => message.role === 'user')?.content ?? '';
      const marker = 'Turnos que deben quedar resueltos exactamente una vez por participante:\n';
      const start = prompt.indexOf(marker);
      const end = prompt.indexOf('\n\nObjetivo común del hogar', start + marker.length);
      const slots =
        start >= 0 && end > start
          ? (JSON.parse(prompt.slice(start + marker.length, end)) as ExpectedSlot[])
          : [];
      const events = slots.flatMap((slot, slotIndex) => {
        const groups =
          slotIndex % 2 === 0
            ? [slot.eligibleParticipants]
            : slot.eligibleParticipants.map((alias) => [alias]);
        return groups.map((participantAliases) => ({
          date: slot.date,
          mealType: slot.mealType,
          time: slot.time,
          recipe: {
            name:
              participantAliases.length > 1
                ? 'Lentejas sintéticas compartidas'
                : 'Almuerzo sintético individual',
            description: 'Receta sintética para validar la vista de planificación.',
            baseServings: 1,
            prepTimeMinutes: 10,
            cookTimeMinutes: 20,
            ingredients: [
              {
                name: 'lentejas',
                quantity: 100,
                unit: 'g',
                preparation: null,
                isOptional: false,
                notes: null
              }
            ],
            instructions: ['Cocina las lentejas sintéticas hasta que estén tiernas.']
          },
          participantAliases,
          servings: participantAliases.length,
          objectiveSummary: 'Almuerzo equilibrado.',
          status: 'scheduled',
          reason: null
        }));
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify({ events }) }
            }
          ]
        })
      );
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerPort = (provider.address() as AddressInfo).port;

  try {
    await registerWithoutAssumingOnboarding(page, 'Planificador sintético uno');
    await createHousehold(page, 'Hogar sintético de comidas');
    const firstToken = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(firstToken).toBeTruthy();
    const firstHeaders = { authorization: `Bearer ${firstToken}` };

    await registerWithoutAssumingOnboarding(secondPage, 'Planificador sintético dos');
    await createHousehold(secondPage, 'Hogar proveedor sintético');
    const ownerToken = await secondPage.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(ownerToken).toBeTruthy();
    const ownerHeaders = { authorization: `Bearer ${ownerToken}` };
    const ownerHouseholdResponse = await secondPage.request.get('/api/household', {
      headers: ownerHeaders
    });
    expect(ownerHouseholdResponse.ok(), await ownerHouseholdResponse.text()).toBeTruthy();
    const ownerHousehold = (await ownerHouseholdResponse.json()) as {
      data: { id: string; members: Array<{ id: string; isActive: boolean }> };
    };
    const householdId = ownerHousehold.data.id;
    const ownerMemberId = ownerHousehold.data.members.find((member) => member.isActive)?.id;
    expect(ownerMemberId).toBeTruthy();

    const configResponse = await secondPage.request.post('/api/ai/configs', {
      headers: ownerHeaders,
      data: {
        name: 'Proveedor sintético de comidas',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-meal-planner',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);

    const scheduleResponse = await secondPage.request.patch('/api/household/meal-planning', {
      headers: { ...ownerHeaders, 'x-household-id': householdId },
      data: {
        household: {
          mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
          mealTimes: { lunch: '13:00' }
        }
      }
    });
    expect(scheduleResponse.ok(), await scheduleResponse.text()).toBeTruthy();

    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();
    await page.goto('/household');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const joinDialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar proveedor sintético');

    const householdResponse = await page.request.get('/api/household', { headers: firstHeaders });
    expect(householdResponse.ok(), await householdResponse.text()).toBeTruthy();
    const household = (await householdResponse.json()) as {
      data: {
        id: string;
        members: Array<{ id: string; userId: string; name: string; isActive: boolean }>;
      };
    };
    expect(household.data.id).toBe(householdId);
    const activeMembers = household.data.members.filter((member) => member.isActive);
    expect(activeMembers).toHaveLength(2);
    expect(activeMembers.map((member) => member.id)).toContain(ownerMemberId);

    await page.goto('/household?tab=tasks&planning=meals&source=synthetic-e2e');
    const planningTabs = page.locator('.household-planning-tabs');
    await expect(planningTabs).toHaveAttribute('role', 'tablist');
    await expect(page).toHaveURL(/tab=tasks.*planning=meals.*source=synthetic-e2e/);
    await expect(page.locator('[data-test="household-planning-tab-meals"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('[data-test^="household-planning-panel-"]')).toHaveCount(1);

    const settingsTab = page.getByRole('tab', { name: 'Ajustes de comidas' });
    await settingsTab.click();
    await expect(page).toHaveURL(/planning=settings.*source=synthetic-e2e/);
    await expect(page.locator('[data-test^="household-planning-panel-"]')).toHaveCount(1);
    await expect(page.locator('[data-test="meal-settings-content"]')).toBeVisible();
    await settingsTab.focus();
    await page.keyboard.press('Home');
    await expect(page.locator('[data-test="household-planning-tab-meals"]')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page).toHaveURL(/planning=meals.*source=synthetic-e2e/);
    await expect(page.locator('[data-test^="household-planning-panel-"]')).toHaveCount(1);

    const proposalRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/api/household/meal-planning/proposal') &&
        request.method() === 'POST'
    );
    const proposalResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/household/meal-planning/proposal') &&
        response.request().method() === 'POST'
    );
    await page.locator('[data-test="meal-proposal-generate"] button').click();
    const generatedRequest = (await proposalRequest).postDataJSON() as {
      weekStart: string;
      householdMemberIds: string[];
    };
    expect(generatedRequest.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(generatedRequest.householdMemberIds).toEqual(activeMembers.map((member) => member.id));
    const generatedResponse = await proposalResponse;
    expect(generatedResponse.status(), await generatedResponse.text()).toBe(200);
    const review = page.locator('[data-test="meal-proposal-review"]');
    await expect(review).toBeVisible();
    await expect(review).toContainText('Compartida');
    await expect(review).toContainText('Individual');
    await expect(review).toContainText('2 raciones');
    await expect(review).toContainText('Planificador sintético uno');
    await expect(review).toContainText('Planificador sintético dos');
    await expect(page.locator('[data-test="meal-proposal-confirm"] button')).toBeEnabled();

    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'weekly_meal_proposal', strict: true }
    });
    const prompt =
      providerRequests[0]?.messages?.map((message) => message.content ?? '').join('\n') ?? '';
    expect(prompt).toContain('Turnos que deben quedar resueltos exactamente una vez');
    for (const member of activeMembers) {
      expect(prompt).not.toContain(member.name);
      expect(prompt).not.toContain(member.userId);
    }

    await mkdir(screenshotDirectory, { recursive: true });
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-proposal.png`),
      fullPage: true,
      animations: 'disabled'
    });

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width
    );
    if (testInfo.project.name === 'mobile-chrome') {
      for (const size of [
        { width: 320, height: 568 },
        { width: 568, height: 320 }
      ]) {
        await page.setViewportSize(size);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(size.width);
        await expect(page.locator('[data-test="household-planning-tab-meals"]')).toBeVisible();
        await expect(page.locator('[data-test^="household-planning-panel-"]')).toHaveCount(1);
      }
      await page.setViewportSize(viewport);
    }

    const noEarlyConfirm = await page.request.get('/api/calendar/range', {
      headers: firstHeaders,
      params: { startDate: generatedRequest.weekStart, endDate: generatedRequest.weekStart }
    });
    expect(noEarlyConfirm.ok(), await noEarlyConfirm.text()).toBeTruthy();
    const noEarlyConfirmBody = (await noEarlyConfirm.json()) as {
      data: { meals: Array<{ date: string; mealType: string }> };
    };
    expect(noEarlyConfirmBody.data.meals).toHaveLength(0);

    let confirmCalls = 0;
    const confirmRequest = page.waitForRequest(
      (request) =>
        request.url().includes('/api/household/meal-planning/confirm') &&
        request.method() === 'POST'
    );
    const confirmResponse = page.waitForResponse((response) => {
      const matches =
        response.url().includes('/api/household/meal-planning/confirm') &&
        response.request().method() === 'POST';
      if (matches) confirmCalls += 1;
      return matches;
    });
    await page.locator('[data-test="meal-proposal-confirm"] button').click();
    const submitted = (await confirmRequest).postDataJSON() as {
      proposalId: string;
      weekStart: string;
      householdMemberIds: string[];
      events: Array<{ id: string; participantAliases: string[] }>;
    };
    expect(submitted.proposalId).toBeTruthy();
    expect(submitted.weekStart).toBe(generatedRequest.weekStart);
    expect(submitted.householdMemberIds).toEqual(generatedRequest.householdMemberIds);
    expect(submitted.events.length).toBeGreaterThan(0);
    const confirmation = await confirmResponse;
    const confirmationText = await confirmation.text();
    expect(confirmation.status(), confirmationText).toBe(200);
    await expect(page.getByText(/comidas añadidas al calendario/i)).toBeVisible();
    expect(confirmCalls).toBe(1);

    const persistedResponse = await page.request.get('/api/calendar/range', {
      headers: firstHeaders,
      params: { startDate: generatedRequest.weekStart, endDate: generatedRequest.weekStart }
    });
    expect(persistedResponse.ok(), await persistedResponse.text()).toBeTruthy();
    const persistedBody = (await persistedResponse.json()) as {
      data: { meals: Array<{ date: string; mealType: string; servings: number }> };
    };
    expect(persistedBody.data.meals.length).toBeGreaterThan(0);
  } finally {
    await secondPage.close();
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});
