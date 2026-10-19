import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Locator, type Page } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import { createSyntheticRecipe, deleteSyntheticRecipe } from './helpers/recipe-fixtures';
import { mockRecipeStepPhotos } from './helpers/recipe-step-photos';

const cookingRecipe = {
  name: 'Receta sintética para cocinar',
  servings: 2,
  ingredients: [
    { name: 'Arroz QA', quantity: 200, unit: 'g', isOptional: false, substitutes: [] },
    { name: 'Azafrán QA', quantity: 1, unit: 'g', isOptional: true, substitutes: [] }
  ],
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Lava el arroz y escurre el agua.',
        duration: 1,
        timerRequired: true,
        timerDuration: 1
      },
      {
        stepNumber: 2,
        instruction: 'Hierve el caldo durante dos minutos.',
        duration: 2,
        timerRequired: true,
        timerDuration: 2
      },
      {
        stepNumber: 3,
        instruction: 'Sirve el arroz caliente.',
        duration: 1
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Enjuaga el arroz con agua fría.',
        duration: 1,
        timerRequired: true,
        timerDuration: 1
      },
      {
        stepNumber: 2,
        instruction: 'Lleva el caldo a ebullición.',
        duration: 2,
        timerRequired: true,
        timerDuration: 2
      },
      { stepNumber: 3, instruction: 'Sirve el arroz caliente.', duration: 1 }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Termina y sirve inmediatamente.'
      }
    ]
  }
};

const screenshotDir = resolve(
  process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-recipe-cooking-checklist'
);

async function expectTextContrastAA(locator: Locator) {
  const ratios = await locator.evaluate((element) => {
    const root = document.documentElement;
    const originalTheme = root.getAttribute('data-theme');
    const channels = (color: string) => color.match(/[\d.]+/g)?.map(Number) ?? [];
    const luminance = (color: number[]) => {
      const linear = color.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const ratioForTheme = (theme: 'light' | 'dark') => {
      if (theme === 'dark') root.setAttribute('data-theme', theme);
      else root.removeAttribute('data-theme');
      const foreground = channels(getComputedStyle(element).color);
      let ancestor: HTMLElement | null = element as HTMLElement;
      let background: number[] = [];
      while (ancestor) {
        const candidate = channels(getComputedStyle(ancestor).backgroundColor);
        if (candidate.length >= 3 && (candidate[3] ?? 1) > 0.99) {
          background = candidate;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };

    try {
      return { light: ratioForTheme('light'), dark: ratioForTheme('dark') };
    } finally {
      if (originalTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', originalTheme);
    }
  });
  expect(ratios.light, 'light-theme text contrast').toBeGreaterThanOrEqual(4.5);
  expect(ratios.dark, 'dark-theme text contrast').toBeGreaterThanOrEqual(4.5);
}

async function expectCookingTouchTargets(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  const undersized = await page
    .locator(
      '[data-test="recipe-cooking-view"] button:visible, [data-test="recipe-cooking-view"] input[type="number"]:visible, [data-test="recipe-cooking-view"] label[data-test^="cooking-step-check"]:visible'
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const { width, height } = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        const parent = element.parentElement;
        const parentRect = parent?.getBoundingClientRect();
        return width >= 44 && height >= 44
          ? []
          : [
              {
                control: element.outerHTML.slice(0, 100),
                width,
                height,
                display: computed.display,
                minWidth: computed.minWidth,
                minHeight: computed.minHeight,
                parent: parent?.outerHTML.slice(0, 180),
                parentWidth: parentRect?.width,
                parentHeight: parentRect?.height
              }
            ];
      })
    );
  expect(undersized).toEqual([]);
}

test('modo cocina escala comensales sin consultar IA ni cambiar la receta guardada', async ({
  page
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  const photoRequests = await mockRecipeStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'qa-recipe-cooking-checklist');
  const recipe = await createSyntheticRecipe(page, cookingRecipe);
  const writes: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/ai/')) writes.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === `/api/recipes/${recipe.id}` && request.method() !== 'GET') {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });

  try {
    await page.goto(`/recipes?collection=all&page=1&recipe=${recipe.id}`);
    await page.getByRole('button', { name: 'Empezar a cocinar' }).click();

    const cookingView = page.locator('[data-test="recipe-cooking-view"]');
    await expect(cookingView).toBeVisible();
    await expect(cookingView).toContainText('Receta sintética para cocinar');
    await expect(page.locator('[data-test="recipe-detail-title"]')).toHaveCount(0);
    await expect(cookingView.getByRole('heading', { level: 1 })).toHaveText(
      'Receta sintética para cocinar'
    );
    await expect(page.getByRole('button', { name: 'Editar receta' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Volver a recetas' })).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-test]')
              ?.dataset.test
        )
      )
      .toBe('recipe-cooking-title');
    const servings = cookingView.getByRole('spinbutton', { name: 'Comensales' });
    const decreaseServings = cookingView.getByRole('button', { name: 'Restar un comensal' });
    await page.keyboard.press('Tab');
    await expect(decreaseServings).toBeDisabled();
    await expect(servings).toBeFocused();
    await expect(servings).toHaveValue('1');
    const firstStepCheckbox = cookingView.locator('[data-test="cooking-step-check-1"] input');
    await firstStepCheckbox.focus();
    await expect(
      firstStepCheckbox.locator('xpath=following-sibling::span[@aria-hidden="true"]')
    ).toHaveCSS('outline-style', 'solid');
    await expect(cookingView.locator('[data-test="recipe-cooking-step"]:visible')).toHaveCount(1);
    await expect(cookingView.locator('[data-test="recipe-step-photo"] img')).toHaveAttribute(
      'alt',
      'Imagen sintética de referencia: wash'
    );
    expect(
      await cookingView
        .locator('[data-test="recipe-step-photo"] img')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth)
    ).toBe(800);
    const requestedScenes = photoRequests
      .map((request) => request.params.scene)
      .filter((scene): scene is string => Boolean(scene))
      .sort();
    expect(
      requestedScenes,
      'solo se busca media del paso enfocado; no se descargan pasos futuros'
    ).toEqual(['wash']);
    await expect(cookingView.locator('[data-test="recipe-step-photo"]')).toHaveCount(1);
    if (testInfo.project.name === 'mobile-chrome') await expectCookingTouchTargets(page);
    await expectTextContrastAA(cookingView.locator('[data-test="recipe-cooking-title"]'));
    await expectTextContrastAA(cookingView.locator('.recipe-cooking__instruction').first());
    await expectTextContrastAA(
      cookingView.locator('[data-test="cooking-timer-step-1"] [role="timer"] .timer__display')
    );
    if (testInfo.project.name === 'mobile-chrome') {
      await cookingView.getByRole('button', { name: 'Mostrar ingredientes' }).click();
    }
    await cookingView.getByRole('button', { name: 'Añadir un comensal' }).click();
    await expect(servings).toHaveValue('2');
    await cookingView.getByRole('button', { name: 'Añadir un comensal' }).click();
    await expect(servings).toHaveValue('3');
    await expect(cookingView.locator('[data-test="cooking-ingredient"]').first()).toContainText(
      '300 g'
    );
    await expect(cookingView.getByRole('timer', { name: 'Temporizador del paso 1' })).toContainText(
      '01:00'
    );
    await servings.fill('20');
    await servings.press('Tab');
    await expect(servings).toHaveValue('20');
    await expect(
      cookingView.locator('[data-test="cooking-ingredient"] strong').first()
    ).toContainText(/2[,.]000 g/);
    await expect(cookingView.getByRole('timer', { name: 'Temporizador del paso 1' })).toContainText(
      '01:00'
    );
    await servings.fill('3');
    await servings.press('Tab');
    if (testInfo.project.name === 'mobile-chrome') {
      await cookingView.getByRole('button', { name: 'Ocultar ingredientes' }).click();
    }
    const start = new Date('2026-01-01T00:00:00.000Z');
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start);
    const firstTimer = cookingView.getByRole('timer', { name: 'Temporizador del paso 1' });
    await firstTimer.getByRole('button', { name: 'Iniciar' }).click();
    await page.clock.runFor(1_000);
    await expect(firstTimer).toContainText('00:59');
    await cookingView.locator('[data-test="cooking-step-check-1"]').getByText('Paso listo').click();
    await expect(firstStepCheckbox).toBeChecked();
    await cookingView.getByRole('button', { name: 'Siguiente paso' }).click();
    await expect(cookingView.locator('[data-test="cooking-step-progress"]')).toHaveText(
      'Paso 2 de 3'
    );
    await expect(cookingView.locator('[data-test="recipe-step-photo"] img')).toHaveAttribute(
      'alt',
      'Imagen sintética de referencia: prepare'
    );
    expect(
      photoRequests
        .map((request) => request.params.scene)
        .filter((scene): scene is string => Boolean(scene))
        .sort()
    ).toEqual(['prepare', 'wash']);
    await expect(page).toHaveURL(new RegExp(`/recipes\\?[^#]*recipe=${recipe.id}`));
    expect(writes, 'escalar porciones debe ser local y no volver a invocar IA').toEqual([]);

    const persistedResponse = await page.request.get(`/api/recipes/${recipe.id}`, {
      headers: { authorization: `Bearer ${recipe.token}` }
    });
    expect(persistedResponse.ok()).toBeTruthy();
    const persisted = (await persistedResponse.json()).data;
    expect(persisted.servings).toBe(2);
    expect(persisted.ingredients[0].quantity).toBe(200);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDir, `${testInfo.project.name}-cooking-view.png`),
      fullPage: false,
      animations: 'disabled'
    });
    if (testInfo.project.name === 'chromium') {
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(768);
      await page.screenshot({
        path: resolve(screenshotDir, 'tablet-cooking-view.png'),
        fullPage: false,
        animations: 'disabled'
      });
      await page.setViewportSize(viewport);
    }

    await cookingView.getByRole('button', { name: 'Salir del modo cocina' }).click();
    await expect(cookingView).toHaveCount(1);
    await expect(cookingView).toBeHidden();
    await expect(page.getByRole('button', { name: 'Modo cocina' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar receta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Volver a recetas' })).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-title"]')).toBeVisible();
    await expect(page.locator('.recipe-detail__servings input')).toHaveValue('3');
    await expect(page.locator('.recipe-detail__ingredients')).toContainText('300 g');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-test]')
              ?.dataset.test
        )
      )
      .toMatch(/^recipe-cooking-open(?:-sidebar)?$/);
    await page.clock.runFor(2_000);
    await page.getByRole('button', { name: 'Modo cocina' }).click();
    await expect(cookingView).toBeVisible();
    await expect(cookingView.locator('[data-test="cooking-step-progress"]')).toHaveText(
      'Paso 2 de 3'
    );
    await expect(cookingView.locator('[data-test="cooking-step-check-1"] input')).toBeChecked();
    await expect(cookingView.locator('[data-test="cooking-active-timers"]')).toContainText('00:57');
    await expect(cookingView.getByRole('spinbutton', { name: 'Comensales' })).toHaveValue('3');
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDir, `${testInfo.project.name}-cooking-view-resumed.png`),
      fullPage: false,
      animations: 'disabled'
    });
    await cookingView.getByRole('button', { name: 'Salir del modo cocina' }).click();
    await expect(cookingView).toBeHidden();
    await page.locator('[data-test="recipe-detail-level-expert"]').click();
    await page.getByRole('button', { name: 'Modo cocina' }).click();
    await expect(cookingView).toBeVisible();
    await expect(cookingView.locator('[data-test="cooking-step-progress"]')).toHaveText(
      'Paso 1 de 1'
    );
    await expect(cookingView.locator('[data-test="cooking-step-check-1"] input')).not.toBeChecked();
    await expect(cookingView.locator('[data-test^="cooking-timer-step-"]')).toHaveCount(0);
    await expect(cookingView.locator('[data-test="cooking-active-timers"] button')).toHaveCount(0);
    await cookingView.getByRole('button', { name: 'Salir del modo cocina' }).click();
    await expect(cookingView).toBeHidden();
    await page.getByRole('button', { name: 'Volver a recetas' }).click();
    await expect(cookingView).toHaveCount(0);
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('checklist y temporizadores siguen sincronizados al enfocar pasos en móvil', async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'La vista enfocada se usa en móvil.');
  await page.setViewportSize({ width: 393, height: 851 });
  await mockRecipeStepPhotos(page);
  await page.route('**/api/receipts/queue', (route) =>
    route.fulfill({
      json: { success: true, data: { jobs: [], counts: { queued: 0, running: 0, failed: 0 } } }
    })
  );
  await registerWithHousehold(page, '/recipes', 'qa-recipe-cooking-checklist-mobile');
  const recipe = await createSyntheticRecipe(page, cookingRecipe);

  try {
    await page.goto(`/recipes?collection=all&page=1&recipe=${recipe.id}`);
    await page.getByRole('button', { name: 'Empezar a cocinar' }).click();
    const cookingView = page.locator('[data-test="recipe-cooking-view"]');
    const progress = cookingView.locator('[data-test="cooking-step-progress"]');
    await expect(progress).toHaveText('Paso 1 de 3');

    const start = new Date('2026-01-01T00:00:00.000Z');
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start);
    const firstTimer = cookingView.getByRole('timer', { name: 'Temporizador del paso 1' });
    await firstTimer.getByRole('button', { name: 'Iniciar' }).click();
    await cookingView.getByRole('button', { name: 'Siguiente paso' }).click();
    await expect(progress).toHaveText('Paso 2 de 3');
    await expect(cookingView.locator('[data-test="cooking-active-timers"]')).toContainText(
      'Paso 1'
    );

    const secondTimer = cookingView.getByRole('timer', { name: 'Temporizador del paso 2' });
    await secondTimer.getByRole('button', { name: 'Iniciar' }).click();
    await cookingView.getByRole('button', { name: 'Siguiente paso' }).click();
    await expect(progress).toHaveText('Paso 3 de 3');

    const markDone = cookingView.locator('[data-test="cooking-step-check-3"]');
    await markDone.click();
    await expect(markDone.locator('input')).toBeChecked();
    await expect(cookingView.locator('[data-test="cooking-completion-status"]')).toHaveText(
      '1 de 3 pasos completados'
    );

    const timerFocusButton = cookingView
      .locator('[data-test="cooking-active-timers"]')
      .getByRole('button', { name: /Ir al temporizador del paso 2/ });
    await timerFocusButton.evaluate((button) => button.scrollIntoView({ block: 'start' }));
    await timerFocusButton.click();
    await expect(progress).toHaveText('Paso 2 de 3');
    await expect(markDone.locator('input')).toBeChecked();
    await secondTimer.getByRole('button', { name: 'Pausar' }).click();
    await expectTextContrastAA(secondTimer.locator('.timer__display'));
    await secondTimer.getByRole('button', { name: 'Reanudar' }).click();
    await expect(cookingView.locator('[data-test="cooking-active-timers"]')).toContainText('02:00');

    await cookingView.getByRole('button', { name: 'Siguiente paso' }).click();
    await expect(progress).toHaveText('Paso 3 de 3');
    await expect(markDone.locator('input')).toBeChecked();
    await page.clock.fastForward(61_000);
    await expect(cookingView.locator('[data-test="cooking-timer-notice"]')).toHaveText(
      'El temporizador del paso 1 ha terminado'
    );
    await expect(cookingView.locator('[data-test="cooking-timer-notice"]')).toHaveAttribute(
      'role',
      'status'
    );
    await expect(cookingView.locator('[data-test="cooking-timer-notice"]')).toHaveAttribute(
      'aria-live',
      'polite'
    );
    await expectTextContrastAA(
      cookingView.locator('[data-test="cooking-timer-step-1"] [role="timer"] .timer__display')
    );
    await expect(cookingView.locator('[data-test="cooking-active-timers"]')).toContainText('00:59');
    await expectTextContrastAA(
      cookingView.locator('[data-test="cooking-timer-step-2"] [role="timer"] .timer__display')
    );
    await expect(cookingView.locator('[data-test="cooking-active-timers"]')).toContainText(
      /00:5\d/
    );
    await page.clock.resume();
    await expect(cookingView.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(393);

    await page.setViewportSize({ width: 320, height: 568 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await expectCookingTouchTargets(page);
    await page.setViewportSize({ width: 568, height: 320 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(568);
    await expectCookingTouchTargets(page);
    await page.setViewportSize({ width: 760, height: 900 });
    await expect(cookingView.locator('[data-test="recipe-cooking-step"]:visible')).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(760);
    await page.setViewportSize({ width: 761, height: 900 });
    await expect(cookingView.locator('[data-test="recipe-cooking-step"]:visible')).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(761);
    await page.setViewportSize({ width: 393, height: 851 });
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDir, 'mobile-chrome-cooking-step.png'),
      fullPage: false,
      animations: 'disabled'
    });
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('los pasos sin temporizador ni temperatura no reservan huecos vacíos', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockRecipeStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'qa-recipe-cooking-no-optional-controls');
  const recipe = await createSyntheticRecipe(page, cookingRecipe);

  try {
    await page.goto(`/recipes?collection=all&page=1&recipe=${recipe.id}`);
    await page.getByRole('button', { name: 'Empezar a cocinar' }).click();
    const cookingView = page.locator('[data-test="recipe-cooking-view"]');
    await cookingView.getByRole('button', { name: 'Siguiente paso' }).click();
    await cookingView.getByRole('button', { name: 'Siguiente paso' }).click();

    await expect(cookingView.locator('[data-test="cooking-step-progress"]')).toHaveText(
      'Paso 3 de 3'
    );
    await expect(cookingView.locator('.recipe-cooking__temperature')).toHaveCount(0);
    await expect(cookingView.locator('[data-test="cooking-timer-step-3"]')).toHaveCount(0);
    await expect(cookingView.locator('.recipe-cooking__ingredients')).toBeVisible();
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
