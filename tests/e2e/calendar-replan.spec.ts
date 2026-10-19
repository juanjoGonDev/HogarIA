import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

const screenshotDir = resolve(`.e2e-screenshots/calendar-replan-${process.pid}`);

async function addMeal(page: import('./fixtures').Page, title: string): Promise<void> {
  await page.locator('[data-test="timeline-add-meal"]').first().click();
  const modal = page.locator('.modal-overlay:has(#meal-custom)');
  await expect(modal).toBeVisible();
  await modal.locator('#meal-custom').fill(title);
  await modal.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(
    page.locator('[data-test="timeline-block-meal"]').filter({ hasText: title })
  ).toHaveCount(1);
}

async function stubReplacementProvider(
  page: import('./fixtures').Page,
  requests: unknown[]
): Promise<void> {
  await page.route('**/api/ai/replace-meal', async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(payload);
    const index = requests.length;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          name: `Plato propuesto ${index}`,
          description: 'Propuesta sintética de prueba con ingredientes sencillos.',
          ingredients: ['arroz', 'verduras'],
          estimatedTime: 25,
          servings: 1
        }
      })
    });
  });
}

async function dismissCurrentToasts(page: import('./fixtures').Page): Promise<void> {
  await page.locator('.toast__close').evaluateAll((buttons) => {
    for (const button of buttons) (button as HTMLButtonElement).click();
  });
}

test.describe('Replanificación parcial del calendario', () => {
  test.beforeEach(async ({ page }) => {
    await registerWithHousehold(page, '/calendar', 'Replan E2E');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await addMeal(page, 'Plato original uno');
    await addMeal(page, 'Plato original dos');
  });

  test('propone un día completo, mantiene objetivos visibles y guarda todo junto al confirmar', async ({
    page
  }, testInfo) => {
    const requests: unknown[] = [];
    await stubReplacementProvider(page, requests);

    await page.locator('[data-test="calendar-replan-open"]').click();
    const modal = page.locator('[data-test="calendar-replan-modal"]');
    await expect(modal).toBeVisible();
    const day = modal.locator('[data-test^="replan-day-"]').first();
    await day.locator('app-checkbox button[role="checkbox"]').click();
    await expect(
      modal.locator('.cal-hint').filter({ hasText: 'Platos seleccionados: 2' })
    ).toBeVisible();
    await modal.locator('[data-test="replan-goal-weight-loss"]').click();
    await modal.locator('[data-test="replan-goal-custom"]').click();
    await modal
      .locator('[data-test="replan-custom-goal"]')
      .fill('Más verduras y platos saciantes.');

    await modal.locator('[data-test="replan-generate"]').click();
    await expect(modal.locator('[data-test="replan-preview"]')).toBeVisible();
    await expect(modal.locator('[data-test^="replan-draft-"]')).toHaveCount(2);
    await expect(modal.locator('[data-test="replan-custom-goal"]')).toHaveValue(
      'Más verduras y platos saciantes.'
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      goals: {
        types: expect.arrayContaining(['weight-loss', 'custom']),
        customInstructions: 'Más verduras y platos saciantes.'
      }
    });

    await dismissCurrentToasts(page);
    const folder = screenshotDir;
    mkdirSync(folder, { recursive: true });
    await page.screenshot({
      path: resolve(folder, `${testInfo.project.name}-preview.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await modal
      .locator('[data-test^="replan-draft-"]')
      .first()
      .locator('input')
      .fill('Plato revisado por usuario');
    await modal.locator('[data-test="replan-apply"]').click();
    await expect(modal).toHaveCount(0);
    await expect(
      page
        .locator('[data-test="timeline-block-meal"]')
        .filter({ hasText: 'Plato revisado por usuario' })
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: 'Plato propuesto 2' })
    ).toHaveCount(1);
    await expect(page.getByText('Se han sustituido 2 platos.')).toBeVisible();
  });

  test('solo sustituye el plato seleccionado y conserva el resto', async ({ page }) => {
    const requests: unknown[] = [];
    await stubReplacementProvider(page, requests);
    await page.locator('[data-test="calendar-replan-open"]').click();

    const modal = page.locator('[data-test="calendar-replan-modal"]');
    await expect(modal).toBeVisible();
    const selectedMeal = modal.locator('[data-test^="replan-meal-"]').first();
    await selectedMeal.check();
    await expect(
      modal.locator('.cal-hint').filter({ hasText: 'Platos seleccionados: 1' })
    ).toBeVisible();
    const participants = modal.locator('[data-test="ai-participants"]');
    await expect(participants).toBeVisible();
    await participants.locator('[data-test="ai-add-guest"]').click();
    await participants.locator('[data-test="ai-guest-0-allergies-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-allergies-option-huevo"]').click();
    await participants.locator('[data-test="ai-guest-0-intolerances-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-intolerances-option-lactosa"]').click();
    await participants.locator('[data-test="ai-guest-0-diets-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-diets-option-vegetariana"]').click();
    await participants.locator('[data-test="ai-guest-0-likes-toggle"]').click();
    await participants.locator('[data-test="ai-guest-0-likes-option-verduras"]').click();
    await participants.locator('[data-test="ai-add-guest"]').click();
    await participants.locator('[data-test="ai-guest-1-allergies-toggle"]').click();
    await participants.locator('[data-test="ai-guest-1-allergies-option-gluten"]').click();
    await participants.locator('[data-test="ai-guest-1-diets-toggle"]').click();
    await participants.locator('[data-test="ai-guest-1-diets-option-vegana"]').click();
    await participants.locator('[data-test="ai-guest-1-notes"]').fill('Preferencia sintética');
    await modal.locator('[data-test="replan-generate"]').click();
    await expect(modal.locator('[data-test="replan-preview"]')).toBeVisible();
    await expect(modal.locator('[data-test^="replan-draft-"]')).toHaveCount(1);
    expect(requests[0]).toMatchObject({
      guests: [
        {
          allergies: ['huevo'],
          intolerances: ['lactosa'],
          diets: ['vegetariana'],
          likes: ['verduras'],
          dislikes: [],
          notes: ''
        },
        {
          allergies: ['gluten'],
          intolerances: [],
          diets: ['vegana'],
          likes: [],
          dislikes: [],
          notes: 'Preferencia sintética'
        }
      ]
    });
    await modal.locator('[data-test="replan-apply"]').click();
    await expect(modal).toHaveCount(0);

    await expect(
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: 'Plato propuesto 1' })
    ).toHaveCount(1);
    await expect(
      page
        .locator('[data-test="timeline-block-meal"]')
        .filter({ hasText: /Plato original (uno|dos)/ })
    ).toHaveCount(1);
    expect(requests).toHaveLength(1);
  });

  test('si falla una propuesta no confirma ningún cambio del día', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/ai/replace-meal', async (route) => {
      requests += 1;
      if (requests === 2) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Proveedor no disponible' })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            name: 'Propuesta que no debe persistir',
            description: 'Candidata sintética.',
            ingredients: ['arroz'],
            estimatedTime: 20,
            servings: 1
          }
        })
      });
    });

    await page.locator('[data-test="calendar-replan-open"]').click();
    const modal = page.locator('[data-test="calendar-replan-modal"]');
    await expect(modal).toBeVisible();
    await modal
      .locator('[data-test^="replan-day-"]')
      .first()
      .locator('app-checkbox button[role="checkbox"]')
      .click();
    await modal.locator('[data-test="replan-generate"]').click();
    await expect(modal.locator('[data-test="replan-error"]')).toBeVisible();
    await expect(modal.locator('[data-test="replan-preview"]')).toHaveCount(0);
    expect(requests).toBe(2);

    await page.locator('app-modal .modal__close').click();
    await expect(modal).toHaveCount(0);
    await page.reload();
    await expect(
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: 'Plato original uno' })
    ).toHaveCount(1);
    await expect(
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: 'Plato original dos' })
    ).toHaveCount(1);
    await expect(
      page
        .locator('[data-test="timeline-block-meal"]')
        .filter({ hasText: 'Propuesta que no debe persistir' })
    ).toHaveCount(0);
  });
});
