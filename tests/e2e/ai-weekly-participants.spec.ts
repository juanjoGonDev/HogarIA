import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from './fixtures';
import { expectAiParticipantsSafetyNoteGeometry } from './helpers/ai-participants';
import { createHousehold, registerAndGoto } from './helpers/auth';

type ProviderRequest = {
  messages?: Array<{ role?: string; content?: string }>;
};

const screenshotDirectory = resolve(`.e2e-screenshots/ai-weekly-participants-${process.pid}`);

test('la planificación usa solo miembros activos elegidos e invitados efímeros', async ({
  page,
  browser
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 320, height: 568 };
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
      const userPrompt =
        payload.messages?.find((message) => message.role === 'user')?.content ?? '';
      const startDate = userPrompt.match(/Del (\d{4}-\d{2}-\d{2}) al /)?.[1];
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
                              name: 'Garbanzos sintéticos de prueba',
                              ingredients: ['garbanzos'],
                              time: null
                            }
                          }
                        }
                      ]
                    : [],
                  shoppingList: []
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

  try {
    await registerAndGoto(page, '/household', 'Planificador sintético uno');
    await createHousehold(page, 'Hogar sintético uno');
    const firstToken = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(firstToken).toBeTruthy();
    const firstHeaders = { authorization: `Bearer ${firstToken}` };
    const firstHouseholdResponse = await page.request.get('/api/household', {
      headers: firstHeaders
    });
    expect(firstHouseholdResponse.ok()).toBeTruthy();
    const firstHousehold = (await firstHouseholdResponse.json()) as {
      data: { members: Array<{ id: string; isActive: boolean }> };
    };
    const previousHomeMemberId = firstHousehold.data.members.find((member) => member.isActive)?.id;
    expect(previousHomeMemberId).toBeTruthy();

    await registerAndGoto(secondPage, '/household', 'Planificador sintético dos');
    await createHousehold(secondPage, 'Hogar sintético dos');
    const secondToken = await secondPage.evaluate(() =>
      localStorage.getItem('hogar:v1:auth_token')
    );
    expect(secondToken).toBeTruthy();
    const secondHeaders = { authorization: `Bearer ${secondToken}` };
    const configResponse = await secondPage.request.post('/api/ai/configs', {
      headers: secondHeaders,
      data: {
        name: 'Proveedor sintético de planificación',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'synthetic-e2e-only',
        model: 'synthetic-test-model',
        retryAttempts: 0,
        concurrency: 1
      }
    });
    expect(configResponse.status(), await configResponse.text()).toBe(201);

    const inviteUrl = (await secondPage.locator('.invite-card__code').innerText()).trim();
    const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
    expect(inviteCode).toBeTruthy();
    await page.goto('/household');
    await page.getByRole('button', { name: 'Unirse a otro hogar' }).click();
    const joinDialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(page.locator('.household-info__name')).toHaveText('Hogar sintético dos');

    const activeHouseholdResponse = await page.request.get('/api/household', {
      headers: firstHeaders
    });
    expect(activeHouseholdResponse.ok()).toBeTruthy();
    const activeHousehold = (await activeHouseholdResponse.json()) as {
      data: {
        members: Array<{
          id: string;
          name: string;
          email: string;
          isActive: boolean;
        }>;
      };
    };
    const activeMembers = activeHousehold.data.members.filter((member) => member.isActive);
    expect(activeMembers).toHaveLength(2);
    expect(activeMembers.some((member) => member.id === previousHomeMemberId)).toBe(false);
    const memberToKeep = activeMembers.find(
      (member) => member.name === 'Planificador sintético uno'
    );
    const memberToExclude = activeMembers.find(
      (member) => member.name === 'Planificador sintético dos'
    );
    expect(memberToKeep).toBeTruthy();
    expect(memberToExclude).toBeTruthy();

    await page.goto('/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await page.getByRole('button', { name: /Planificar IA/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Planificar con IA' });
    await expect(dialog).toBeVisible();
    const participants = dialog.locator('[data-test="ai-participants"]');
    const safetyNote = participants.locator('[data-test="ai-participants-safety-note"]');
    await expect(safetyNote).toContainText('La app no puede garantizar');
    await expect(safetyNote).toBeInViewport({ ratio: 0.9 });
    await expectAiParticipantsSafetyNoteGeometry(safetyNote);
    for (const member of activeMembers) {
      await expect(participants.locator(`[data-test="ai-member-${member.id}"]`)).toBeChecked();
    }
    await expect(
      participants.locator(`[data-test="ai-member-${previousHomeMemberId}"]`)
    ).toHaveCount(0);
    await participants.locator(`[data-test="ai-member-${memberToExclude!.id}"]`).uncheck();

    const addGuest = participants.locator('[data-test="ai-add-guest"]');
    await addGuest.focus();
    await page.keyboard.press('Enter');
    await participants.locator('[data-test="ai-guest-0-allergies-toggle"]').click();
    const eggOption = participants.locator('[data-test="ai-guest-0-allergies-option-huevo"]');
    await eggOption.focus();
    await page.keyboard.press('Space');
    await expect(eggOption).toHaveAttribute('aria-pressed', 'true');
    await participants
      .locator('[data-test="ai-guest-0-notes"]')
      .fill('Preferencia sintética de prueba');
    await expect(dialog.locator('[data-test="generate-participant-servings"]')).toContainText('2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width
    );

    mkdirSync(screenshotDirectory, { recursive: true });
    await dialog.locator('.modal__body').evaluate((body) => {
      body.scrollTop = 0;
    });
    await dialog.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-participants.png`),
      animations: 'disabled'
    });

    const planRequest = page.waitForRequest(
      (request) => request.url().includes('/api/ai/plan-week') && request.method() === 'POST'
    );
    const planResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ai/plan-week') && response.request().method() === 'POST'
    );
    await dialog.getByRole('button', { name: /Generar plan/ }).click();
    const request = (await planRequest).postDataJSON() as {
      householdMemberIds: string[];
      guests: Array<{ allergies: string[]; notes: string }>;
    };
    expect(request.householdMemberIds).toEqual([memberToKeep!.id]);
    expect(request.guests).toEqual([
      expect.objectContaining({ allergies: ['huevo'], notes: 'Preferencia sintética de prueba' })
    ]);
    const result = await planResponse;
    const resultText = await result.text();
    expect(result.status(), resultText).toBe(200);
    const resultBody = JSON.parse(resultText) as { data: { saved: { created: number } } };
    expect(resultBody.data.saved.created).toBe(1);
    await expect(page.locator('.toast__title')).toContainText('Plan guardado');

    expect(providerRequests).toHaveLength(1);
    const providerPrompt =
      providerRequests[0]?.messages?.map((message) => message.content ?? '').join('\n') ?? '';
    expect(providerPrompt).toContain('Preferencia sintética de prueba');
    expect(providerPrompt).not.toContain('Planificador sintético uno');
    expect(providerPrompt).not.toContain('Planificador sintético dos');
    for (const member of activeMembers) {
      expect(providerPrompt).not.toContain(member.email);
      expect(providerPrompt).not.toContain(member.id);
    }
  } finally {
    await secondPage.close();
    await new Promise<void>((resolveClose, rejectClose) =>
      provider.close((error) => (error ? rejectClose(error) : resolveClose()))
    );
  }
});
