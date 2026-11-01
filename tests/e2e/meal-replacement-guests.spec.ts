import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures';
import { responsesCompleted, type ResponsesRequest } from './helpers/ai-responses';
import { expectAiParticipantsSafetyNoteGeometry } from './helpers/ai-participants';
import { registerAndGoto } from './helpers/auth';

const dateOfToday = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
};

test('sustituye una sola comida con restricciones efímeras de invitados tras revisión explícita', async ({
  page
}, testInfo) => {
  if (testInfo.project.name === 'chromium')
    await page.setViewportSize({ width: 1440, height: 1000 });
  await registerAndGoto(page, '/calendar', 'Reemplazo con invitados');
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token).toBeTruthy();

  const providerRequests: ResponsesRequest[] = [];
  const provider = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/responses') {
        response.writeHead(404).end();
        return;
      }
      providerRequests.push(JSON.parse(body) as ResponsesRequest);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          responsesCompleted(
            JSON.stringify({
              safe: true,
              name: 'Arroz de verduras QA',
              description: 'Una alternativa vegetal sintética para la prueba.',
              ingredients: ['arroz', 'calabacín', 'tomate'],
              estimatedTime: 30,
              servings: 2
            })
          )
        )
      );
    });
  });
  await new Promise<void>((resolveListen) => provider.listen(0, '127.0.0.1', resolveListen));
  const providerPort = (provider.address() as AddressInfo).port;
  const headers = { authorization: `Bearer ${token}` };
  const householdResponse = await page.request.get('/api/household', { headers });
  expect(householdResponse.ok()).toBeTruthy();
  const household = (await householdResponse.json()) as {
    data: { id: string; members: Array<{ id: string; isActive: boolean }> };
  };
  const activeMember = household.data.members.find((member) => member.isActive);
  expect(activeMember).toBeTruthy();
  let configId = '';
  let mealId = '';

  try {
    const configResponse = await page.request.post('/api/ai/configs', {
      headers,
      data: {
        name: 'Proveedor sintético de E2E',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-key',
        model: 'gpt-5',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.ok()).toBeTruthy();
    configId = ((await configResponse.json()) as { data: { id: string } }).data.id;

    const mealResponse = await page.request.post('/api/calendar/meals', {
      headers,
      data: {
        date: dateOfToday(),
        mealType: 'dinner',
        customMeal: 'Pasta original QA',
        time: '20:00',
        servings: 2
      }
    });
    expect(mealResponse.ok()).toBeTruthy();
    mealId = ((await mealResponse.json()) as { data: { id: string } }).data.id;
    await page.reload();
    const meal = page
      .locator('[data-test="timeline-block-meal"]')
      .filter({ hasText: 'Pasta original QA' });
    await expect(meal).toHaveCount(1);
    await meal.click();

    const editor = page.locator('app-modal:has(#meal-custom)');
    await editor.locator('.modal').evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });
    const replacementToggle = editor.locator('[data-test="open-meal-replacement"]');
    const toggleGeometry = await replacementToggle.boundingBox();
    await replacementToggle.click();
    const replacementRequest = editor.locator('[data-test="request-meal-replacement"]');
    const requestGeometry = await replacementRequest.boundingBox();
    const replacementWidth = await editor
      .locator('[data-test="meal-replacement"]')
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(toggleGeometry).not.toBeNull();
    expect(requestGeometry).not.toBeNull();
    expect(toggleGeometry!.width).toBeLessThan(replacementWidth - 24);
    expect(
      Math.abs(toggleGeometry!.height - requestGeometry!.height),
      JSON.stringify({ toggleGeometry, requestGeometry })
    ).toBeLessThanOrEqual(1);
    const participants = editor.locator('[data-test="ai-participants"]');
    await expect(participants).toBeVisible();
    const safetyNote = participants.locator('[data-test="ai-participants-safety-note"]');
    await expect(safetyNote).toContainText('La app no puede garantizar');
    await safetyNote.scrollIntoViewIfNeeded();
    await expect(safetyNote).toBeInViewport({ ratio: 0.9 });
    await expectAiParticipantsSafetyNoteGeometry(safetyNote);
    if (process.env.E2E_SCREENSHOT_DIR) {
      mkdirSync(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: resolve(
          process.env.E2E_SCREENSHOT_DIR,
          `${testInfo.project.name}-meal-replacement-allergy-safety-note.png`
        ),
        animations: 'disabled'
      });
    }
    const memberChoice = participants.locator(`[data-test="ai-member-${activeMember!.id}"]`);
    await expect(memberChoice).toBeChecked();
    await memberChoice.uncheck();
    await memberChoice.check();

    const addGuest = participants.locator('[data-test="ai-add-guest"]');
    await addGuest.focus();
    await expect(addGuest).toBeFocused();
    await page.keyboard.press('Enter');
    const allergyPicker = participants.locator('[data-test="ai-guest-0-allergies-toggle"]');
    await allergyPicker.click();
    await participants.locator('[data-test="ai-guest-0-allergies-option-huevo"]').click();
    await participants.locator('[data-test="ai-guest-0-allergies-option-cacahuetes"]').click();
    await participants.locator('[data-test="ai-guest-0-intolerances-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-intolerances-option-lactosa"]').click();
    await participants.locator('[data-test="ai-guest-0-diets-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-diets-option-vegetariana"]').click();
    await participants.locator('[data-test="ai-guest-0-likes-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-likes-option-verduras"]').click();
    const customLike = participants.locator('[data-test="ai-guest-0-likes-custom-input"]');
    await customLike.fill('calabacín');
    await participants.locator('[data-test="ai-guest-0-likes-custom-add"]').click();
    await participants.locator('[data-test="ai-guest-0-dislikes-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-dislikes-option-cilantro"]').click();
    await participants
      .locator('[data-test="ai-guest-0-notes"]')
      .fill('Sin picante y texturas suaves');

    await participants.locator('[data-test="ai-add-guest"]').click();
    await participants.locator('[data-test="ai-guest-1-allergies-toggle"]').click();
    await participants.locator('[data-test="ai-guest-1-allergies-option-gluten"]').click();
    await participants.locator('[data-test="ai-guest-1-diets-toggle"]').click();
    await participants.locator('[data-test="ai-guest-1-diets-option-vegana"]').click();
    await editor.locator('[data-test="request-meal-replacement"]').click();
    const candidate = editor.locator('[data-test="replacement-candidate"]');
    await expect(candidate).toContainText('Arroz de verduras QA');
    await expect(
      candidate.locator('text=Revisa la propuesta y las etiquetas del producto')
    ).toBeVisible();

    // Generar una propuesta no escribe nada; solo el botón de aplicación altera el slot seleccionado.
    await expect(editor.locator('#meal-custom')).toHaveValue('Pasta original QA');
    const requestContent = JSON.stringify(providerRequests[0]?.input ?? {});
    expect(requestContent).toContain('cacahuete');
    expect(requestContent).toContain('huevo');
    expect(requestContent).toContain('lactosa');
    expect(requestContent).toContain('vegetariana');
    expect(requestContent).toContain('calabacín');
    expect(requestContent).toContain('gluten');
    expect(requestContent).toContain('vegana');
    expect(requestContent).toContain('Sin picante y texturas suaves');
    expect(requestContent).not.toContain(activeMember!.id);

    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'mobile-chrome') {
      const directory = resolve('.e2e-screenshots/meal-replacement-shared-picker-20261006');
      mkdirSync(directory, { recursive: true });
      const secondGuestDiets = participants.locator('[data-test="ai-guest-1-diets-toggle"]');
      if ((await secondGuestDiets.getAttribute('aria-expanded')) === 'true') {
        await secondGuestDiets.click();
      }
      await participants.locator('[data-test="ai-guest-0-notes"]').fill('');
      await participants.locator('[data-test="ai-guest-1-notes"]').fill('');
      await editor.locator('.modal__body').evaluate((element) => {
        element.scrollTop = 0;
      });
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(documentWidth).toBeLessThanOrEqual(viewportWidth);
      await page.screenshot({
        path: resolve(directory, `${testInfo.project.name}.png`),
        fullPage: false,
        animations: 'disabled'
      });
    }

    await editor.locator('[data-test="apply-meal-replacement"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('[data-test="timeline-block-meal"]')).toContainText(
      'Arroz de verduras QA'
    );
    const persistedResponse = await page.request.get(
      `/api/calendar/range?startDate=${dateOfToday()}&endDate=${dateOfToday()}`,
      { headers }
    );
    expect(persistedResponse.ok()).toBeTruthy();
    const persisted = (await persistedResponse.json()) as {
      data: {
        meals: Array<{ id: string; custom_meal: string; servings: number; time: string | null }>;
      };
    };
    expect(persisted.data.meals.find((item) => item.id === mealId)).toMatchObject({
      custom_meal: 'Arroz de verduras QA',
      servings: 2
    });
    expect(providerRequests).toHaveLength(1);
  } finally {
    if (mealId)
      await page.request
        .delete(`/api/calendar/meals/${mealId}`, { headers })
        .catch(() => undefined);
    if (configId)
      await page.request.delete(`/api/ai/configs/${configId}`, { headers }).catch(() => undefined);
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});
