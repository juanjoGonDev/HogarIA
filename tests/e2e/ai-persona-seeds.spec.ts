import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from './fixtures';
import { activateAiPersona, seedAiPersonaMatrix } from './helpers/ai-persona-seeds';

const PERSONA_SCREENSHOT_DIR = resolve(process.cwd(), '.e2e-screenshots/ai-persona-seeds');

async function captureHousehold(
  page: import('@playwright/test').Page,
  household: { name: string; members: Array<unknown> },
  viewport: { width: number; height: number },
  fileName: string
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/household');
  await expect(page.locator('.household-info__name')).toHaveText(household.name, {
    timeout: 15000
  });
  await page.locator('[data-test="household-tab-members"]').click();
  await expect(page.locator('.members-list .member-card')).toHaveCount(household.members.length);
  await page.screenshot({
    path: resolve(PERSONA_SCREENSHOT_DIR, fileName),
    fullPage: true,
    animations: 'disabled'
  });
}

test('genera perfiles sintéticos solos y de hogar con la matriz completa', async ({
  page
}, testInfo) => {
  test.setTimeout(5 * 60 * 1000);
  test.skip(
    testInfo.project.name !== 'chromium',
    'La matriz escribe una vez por ejecución aislada; se captura UI desktop y mobile en Chromium.'
  );
  test.skip(
    process.env.HOGARIA_AI_SEED_GENERATION !== '1',
    'La creación opt-in de perfiles sintéticos requiere el stack E2E aislado.'
  );

  const runId = process.env.E2E_SEED;
  expect(runId).toBeTruthy();
  const seeded = await seedAiPersonaMatrix(page, runId!);
  if (process.env.HOGARIA_AI_SEED_GENERATION_INJECT_FAILURE === 'after-seed') {
    throw new Error('Injected failure after synthetic persona seeding.');
  }

  expect(Object.keys(seeded.accounts)).toHaveLength(10);
  expect(seeded.households['solo-one'].members).toHaveLength(1);
  expect(seeded.households['solo-two'].members).toHaveLength(1);
  expect(seeded.households.couple.members).toHaveLength(2);
  expect(seeded.households.family.members).toHaveLength(6);
  expect(seeded.households.family.members.map((member) => member.role).sort()).toEqual(
    ['admin', 'child', 'child', 'child', 'child', 'member'].sort()
  );

  await mkdir(PERSONA_SCREENSHOT_DIR, { recursive: true });
  const soloAccount = seeded.accounts['solo-beginner'];
  const soloHousehold = seeded.households['solo-one'];
  await activateAiPersona(page, soloAccount);
  await captureHousehold(page, soloHousehold, { width: 1440, height: 900 }, 'solo-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.household-info__name')).toHaveText(soloHousehold.name, {
    timeout: 15000
  });
  await page.locator('[data-test="household-tab-members"]').click();
  await expect(page.locator('.members-list .member-card')).toHaveCount(1);
  await page.screenshot({
    path: resolve(PERSONA_SCREENSHOT_DIR, 'solo-mobile.png'),
    fullPage: true,
    animations: 'disabled'
  });

  const familyOwner = seeded.accounts['family-owner'];
  const familyHousehold = seeded.households.family;
  await activateAiPersona(page, familyOwner);
  await captureHousehold(page, familyHousehold, { width: 1440, height: 900 }, 'family-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.household-info__name')).toHaveText(familyHousehold.name, {
    timeout: 15000
  });
  await page.locator('[data-test="household-tab-members"]').click();
  await expect(page.locator('.members-list .member-card')).toHaveCount(6);
  await page.screenshot({
    path: resolve(PERSONA_SCREENSHOT_DIR, 'family-mobile.png'),
    fullPage: true,
    animations: 'disabled'
  });

  testInfo.annotations.push({
    type: 'synthetic-seed-count',
    description: '10 users; 2 one-member homes; 1 couple (2 members); 1 family (6 members).'
  });
});
