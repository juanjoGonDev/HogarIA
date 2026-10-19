import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import { createSyntheticRecipe, deleteSyntheticRecipe } from './helpers/recipe-fixtures';
import { mockRecipeStepPhotos } from './helpers/recipe-step-photos';

const timedStep = {
  stepNumber: 1,
  instruction: 'Hierve agua durante un minuto.',
  duration: 1,
  timerRequired: true,
  timerDuration: 1
};

const screenshotDir = join(process.cwd(), '.e2e-screenshots', 'qa-recipe-timer-controls');

test('temporizador del paso inicia, pausa, reanuda, termina y reinicia', async ({
  page
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile-safari',
    'Esta unidad revalida Chromium desktop y Pixel 5.'
  );
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  await mockRecipeStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'qa-recipe-timer-controls');

  const recipe = await createSyntheticRecipe(page, {
    name: 'Receta QA temporizador',
    instructionsByLevel: {
      basic: [timedStep],
      intermediate: [{ ...timedStep, instruction: 'Hierve agua con control de temperatura.' }],
      expert: [{ ...timedStep, instruction: 'Mantén un hervor suave durante un minuto.' }]
    }
  });

  try {
    await page.goto(`/recipes?collection=all&page=1&recipe=${recipe.id}`);
    await page.getByRole('button', { name: 'Empezar a cocinar' }).click();
    const timer = page.locator('[data-test="cooking-timer-step-1"] app-timer .timer');
    const display = timer.locator('.timer__display');
    await expect(timer).toBeVisible();
    await expect(display).toHaveText('01:00');
    await timer.scrollIntoViewIfNeeded();
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-idle.png`) });

    const accessibleTimer = page.getByRole('timer', { name: 'Temporizador del paso 1' });
    await expect(accessibleTimer).toBeVisible();

    const assertTimerLayout = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await accessibleTimer.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width
      );

      const timerBounds = await accessibleTimer.boundingBox();
      expect(
        timerBounds,
        'la tarjeta completa del temporizador debe estar colocada'
      ).not.toBeNull();

      for (const button of await accessibleTimer.getByRole('button').all()) {
        const bounds = await button.boundingBox();
        expect(bounds, 'cada acción del temporizador debe quedar visible').not.toBeNull();
        expect(bounds!.width, 'objetivo táctil mínimo horizontal').toBeGreaterThanOrEqual(44);
        expect(bounds!.height, 'objetivo táctil mínimo vertical').toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(timerBounds!.x);
        expect(bounds!.y).toBeGreaterThanOrEqual(timerBounds!.y);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(timerBounds!.x + timerBounds!.width);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
          timerBounds!.y + timerBounds!.height
        );
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
    };

    await assertTimerLayout(viewport.width, viewport.height);
    if (testInfo.project.name === 'mobile-chrome') {
      await assertTimerLayout(320, 568);
      await assertTimerLayout(568, 320);
      await assertTimerLayout(viewport.width, viewport.height);
    }

    const clockStart = new Date('2026-01-01T00:00:00.000Z');
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(clockStart);

    const startButton = accessibleTimer.getByRole('button', { name: 'Iniciar' });
    await startButton.focus();
    await expect(startButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(accessibleTimer).toHaveClass(/timer--running/);
    await page.clock.runFor(2_000);
    await expect(display).toHaveText('00:58');

    await accessibleTimer.getByRole('button', { name: 'Pausar' }).click();
    await expect(accessibleTimer).toHaveClass(/timer--paused/);
    await page.clock.runFor(5_000);
    await expect(display).toHaveText('00:58');

    await accessibleTimer.getByRole('button', { name: 'Reanudar' }).click();
    await page.clock.fastForward(58_000);
    await expect(display).toHaveText('00:00');
    await expect(accessibleTimer).toHaveClass(/timer--finished/);
    await page.screenshot({ path: join(screenshotDir, `${testInfo.project.name}-finished.png`) });

    await accessibleTimer.getByRole('button', { name: 'Reiniciar' }).click();
    await expect(accessibleTimer).toHaveClass(/timer--idle/);
    await expect(display).toHaveText('01:00');
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
