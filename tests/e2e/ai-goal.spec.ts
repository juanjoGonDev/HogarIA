import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';

test.describe('Planificación IA — objetivos múltiples y personalizados', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
  });

  test('la preferencia persiste varios objetivos y las notas personalizadas', async ({ page }) => {
    await page.goto('/preferences?tab=goal');
    const perderPeso = page.locator('.preferences__goal', { hasText: 'Perder peso' });
    const ganarMusculo = page.locator('.preferences__goal', { hasText: 'Ganar músculo' });
    const personalizada = page.locator('.preferences__goal', { hasText: 'Personalizada' });

    await perderPeso.click();
    await ganarMusculo.click();
    await personalizada.click();
    await page.locator('#goalNotes').fill('Más legumbres y cenas sencillas.');
    await expect(page.locator('.preferences__goal--on')).toHaveCount(3);

    await page.getByRole('button', { name: 'Guardar preferencias' }).click();
    await expect(page.locator('.toast--success').filter({ hasText: 'Guardado' })).toBeVisible();
    await page.reload();

    await expect(page.locator('.preferences__goal--on')).toHaveCount(3);
    await expect(page.locator('#goalNotes')).toHaveValue('Más legumbres y cenas sencillas.');
    await expect(perderPeso).toHaveAttribute('aria-pressed', 'true');
    await expect(ganarMusculo).toHaveAttribute('aria-pressed', 'true');
    await expect(personalizada).toHaveAttribute('aria-pressed', 'true');
  });

  test('valida vacío/custom y revela las indicaciones de texto libre', async ({ page }) => {
    await page.getByRole('button', { name: /Planificar IA/ }).click();
    const modal = page.locator('.modal-overlay');
    await expect(modal.locator('.modal__title')).toContainText('Planificar con IA');

    const generar = modal.getByRole('button', { name: /Generar plan/ });
    const equilibrada = modal.locator('[data-test="generate-goal-balanced"]');
    const personalizada = modal.locator('[data-test="generate-goal-custom"]');
    const texto = modal.locator('#gen-custom');

    await equilibrada.click();
    await expect(generar).toBeDisabled();
    await personalizada.click();
    await expect(texto).toBeVisible();
    await expect(generar).toBeDisabled();
    await texto.fill('Más legumbres y cenas sencillas.');
    await expect(generar).toBeEnabled();
  });

  test('los selectores de objetivos usan iconos y medidas legibles en 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole('button', { name: /Planificar IA/ }).click();
    const modal = page.locator('.modal-overlay');
    const options = modal.locator('[data-test^="generate-goal-"]');

    await expect(options).toHaveCount(7);
    await expect(modal.locator('.goal-option__icon app-icon svg')).toHaveCount(7);
    const fieldsetBorder = await modal
      .locator('[data-test="gen-goals"]')
      .evaluate((fieldset) => getComputedStyle(fieldset).borderTopWidth);
    expect(fieldsetBorder).toBe('0px');

    const boxes = await options.evaluateAll((buttons) =>
      buttons.map((button) => {
        const buttonBox = button.getBoundingClientRect();
        const iconBox = button.querySelector('.goal-option__icon')?.getBoundingClientRect();
        const labelBox = button.querySelector('.goal-option__label')?.getBoundingClientRect();
        return {
          width: buttonBox.width,
          iconRight: iconBox?.right ?? Number.POSITIVE_INFINITY,
          labelLeft: labelBox?.left ?? Number.NEGATIVE_INFINITY,
          labelRight: labelBox?.right ?? Number.POSITIVE_INFINITY,
          buttonRight: buttonBox.right
        };
      })
    );

    expect(
      Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width))
    ).toBeLessThanOrEqual(1);
    for (const box of boxes) {
      expect(box.labelLeft).toBeGreaterThanOrEqual(box.iconRight);
      expect(box.labelRight).toBeLessThanOrEqual(box.buttonRight);
    }
  });

  test('envía todos los objetivos y el texto custom en una sola planificación', async ({
    page
  }) => {
    type PlanPayload = {
      goals?: { types?: string[]; customInstructions?: string; type?: string };
    };
    const payloads: PlanPayload[] = [];
    await page.route('**/api/ai/plan-week', async (route) => {
      payloads.push(JSON.parse(route.request().postData() || '{}') as PlanPayload);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { days: [], saved: { created: 0, skipped: 0 } }
        })
      });
    });

    await page.getByRole('button', { name: /Planificar IA/ }).click();
    const modal = page.locator('.modal-overlay');
    for (const goal of ['weight-loss', 'muscle-gain', 'custom']) {
      await modal.locator(`[data-test="generate-goal-${goal}"]`).click();
    }
    await expect(modal.locator('[data-test="generate-goal-balanced"]')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    for (const goal of ['weight-loss', 'muscle-gain', 'custom']) {
      await expect(modal.locator(`[data-test="generate-goal-${goal}"]`)).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    }
    await modal.locator('#gen-custom').fill('Más legumbres y cenas sencillas.');

    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await modal.locator('[data-test="gen-goals"]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(
          screenshotDirectory,
          `planner-multiple-goals-${test.info().project.name}.png`
        ),
        fullPage: false
      });
    }

    await modal.getByRole('button', { name: /Generar plan/ }).click();
    await expect(page.locator('.toast__title')).toContainText('Plan guardado');
    expect(payloads).toHaveLength(1);
    const payload = payloads[0];
    expect(payload?.goals).toMatchObject({
      types: ['weight-loss', 'muscle-gain', 'custom'],
      customInstructions: 'Más legumbres y cenas sencillas.'
    });
    expect(payload?.goals).not.toHaveProperty('type');
  });

  test('cancelar la selección no llama al planificador ni guarda platos', async ({ page }) => {
    let planningRequests = 0;
    await page.route('**/api/ai/plan-week', async (route) => {
      planningRequests += 1;
      await route.fulfill({ status: 500, body: 'unexpected request' });
    });

    await page.getByRole('button', { name: /Planificar IA/ }).click();
    const modal = page.locator('.modal-overlay');
    await modal.locator('[data-test="generate-goal-weight-loss"]').click();
    await modal.locator('[data-test="generate-goal-custom"]').click();
    await modal.locator('#gen-custom').fill('Solo preparar cenas ligeras.');
    await modal.getByRole('button', { name: 'Cancelar' }).click();

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect.poll(() => planningRequests).toBe(0);
  });
});
