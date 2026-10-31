import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import { mockAiFunctionAvailable } from './helpers/ai';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  waitForStableView
} from './helpers/recipe-fixtures';

const fullRecipe = {
  name: 'Arroz de prueba detallado',
  servings: 2,
  calories: 520,
  restTime: 5,
  ingredients: [
    {
      name: 'Arroz QA',
      quantity: 200,
      unit: 'g',
      preparation: 'enjuagado hasta que el agua salga clara',
      isOptional: false,
      substitutes: ['quinoa'],
      notes: 'usar grano redondo'
    },
    { name: 'Azafrán QA', quantity: 1, unit: 'g', isOptional: true, substitutes: [] }
  ],
  guidance: {
    appliances: ['Cocina de gas'],
    parallelTasks: ['Calienta el caldo mientras preparas las verduras.'],
    tipsAndVariations: ['Tuesta el arroz antes de añadir el caldo para más sabor.']
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Lava el arroz y escurre el agua.',
        duration: 2,
        tips: null,
        warning: null,
        illustration: {
          url: 'https://media.example.test/step-one.svg',
          altText: 'Arroz QA bajo el grifo antes de cocinar',
          sourceLabel: 'Ilustración sintética de prueba',
          sourceUrl: 'https://media.example.test/source'
        }
      },
      {
        stepNumber: 2,
        instruction: 'Pica la cebolla en dados pequeños.',
        duration: 2,
        tips: null,
        warning: null,
        illustration: null
      },
      {
        stepNumber: 3,
        instruction: 'Sirve caliente y decora con perejil.',
        duration: 1,
        tips: null,
        warning: null,
        illustration: {
          url: 'https://media.example.test/broken.svg',
          altText: 'Emplatado de arroz QA',
          sourceLabel: 'Fuente de una imagen que no carga',
          sourceUrl: 'https://media.example.test/source'
        }
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Enjuaga el arroz en agua fría hasta retirar el almidón superficial.',
        duration: 3,
        tips: 'Mueve los granos con suavidad.',
        warning: null,
        illustration: {
          url: 'https://media.example.test/step-one.svg',
          altText: 'Enjuague del arroz',
          sourceLabel: 'Ilustración sintética de prueba',
          sourceUrl: 'https://media.example.test/source'
        }
      },
      {
        stepNumber: 2,
        instruction: 'Corta la cebolla en dados regulares.',
        duration: 2,
        tips: null,
        warning: null,
        illustration: null
      },
      {
        stepNumber: 3,
        instruction: 'Emplata caliente y termina con perejil.',
        duration: 1,
        tips: null,
        warning: null,
        illustration: {
          url: 'https://media.example.test/broken.svg',
          altText: 'Emplatado de arroz QA',
          sourceLabel: 'Fuente de una imagen que no carga',
          sourceUrl: 'https://media.example.test/source'
        }
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Lava el arroz y mide el caldo con una proporción de dos a uno.',
        duration: 4,
        tips: 'El agua del último enjuague debe quedar casi transparente.',
        warning: 'No dejes el arroz en remojo más tiempo del indicado.',
        illustration: {
          url: 'https://media.example.test/step-one.svg',
          altText: 'Preparación experta del arroz',
          sourceLabel: 'Ilustración sintética de prueba',
          sourceUrl: 'https://media.example.test/source'
        }
      },
      {
        stepNumber: 2,
        instruction: 'Corta la cebolla en brunoise uniforme.',
        duration: 2,
        tips: null,
        warning: null,
        illustration: null
      },
      {
        stepNumber: 3,
        instruction: 'Presenta el plato y decora con perejil.',
        duration: 1,
        tips: null,
        warning: null,
        illustration: {
          url: 'https://media.example.test/broken.svg',
          altText: 'Emplatado de arroz QA',
          sourceLabel: 'Fuente de una imagen que no carga',
          sourceUrl: 'https://media.example.test/source'
        }
      }
    ]
  },
  nutrition: { calories: 520, protein: 12, carbs: 86, fat: 12, fiber: 4, sugar: 3, sodium: 410 },
  storage: {
    method: 'Guardar una vez se haya enfriado.',
    container: 'Recipiente hermético',
    duration: 'hasta 2 días',
    reheatingInstructions: 'Añade una cucharada de agua y calienta bien.',
    freezingPossible: true,
    freezingDuration: 'hasta 1 mes'
  }
};

function resolveScreenshotDirectory(relativePath: string): string {
  const configuredDirectory = process.env.E2E_SCREENSHOT_DIR;
  return configuredDirectory
    ? resolve(configuredDirectory, relativePath.split(/[\\/]/).at(-1) ?? 'recipe-full-detail')
    : resolve(relativePath);
}

test('la ficha completa presenta detalle, ajusta raciones solo en pantalla y no solicita más IA', async ({
  page
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 980 }
      : { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await mockAiFunctionAvailable(page, 'assistant');
  await registerWithHousehold(page, '/recipes', 'recipe-full-detail');
  const recipe = await createSyntheticRecipe(page, fullRecipe);
  const aiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/ai/')) {
      aiRequests.push(request.url());
    }
  });

  try {
    await page.goto(`/recipes?collection=all&page=1&recipe=${recipe.id}`);
    const detail = page.locator('[data-test="recipe-full-detail"]');
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-test="recipe-list-view"]')).toBeHidden();
    await expect(detail).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-title"]')).toBeFocused();
    await expect(detail.locator('[data-test="recipe-serving-count"]')).toHaveValue('1');
    await expect(detail.locator('.recipe-detail__header app-badge')).toHaveText('Fácil');
    const timings = detail.locator('.recipe-detail__timings');
    await expect(timings).toHaveCSS('display', 'flex');
    await expect(timings).not.toContainText('porciones');
    await expect(timings.locator(':scope > span')).toHaveCount(4);
    if (testInfo.project.name === 'mobile-chrome') {
      await expect(timings.locator('.recipe-detail__timing-label--full').first()).toBeHidden();
      await expect(timings.locator('.recipe-detail__timing-label--compact').first()).toBeVisible();
    }
    const screenshotDirectory = resolveScreenshotDirectory('.e2e-screenshots/recipe-redesign');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `detail-${testInfo.project.name}.png`),
      fullPage: false,
      animations: 'disabled'
    });
    if (testInfo.project.name === 'chromium') {
      const tabletViewport = { width: 768, height: 1024 };
      await page.setViewportSize(tabletViewport);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(tabletViewport.width);
      await expect(page.locator('[data-test="recipe-detail-level"]')).toBeVisible();
      await page.screenshot({
        path: resolve(screenshotDirectory, 'detail-tablet-768x1024.png'),
        fullPage: false,
        animations: 'disabled'
      });
      await page.setViewportSize(viewport);
    }
    if (testInfo.project.name === 'mobile-chrome') {
      await page.setViewportSize({ width: 320, height: 640 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(320);
      await expect(timings).toHaveCSS('display', 'flex');
      await page.setViewportSize(viewport);
    }
    await expect(
      detail.locator('.recipe-detail__cover'),
      'sin una portada guardada no debe reservarse un gran hueco vacío'
    ).toHaveCount(0);
    const summaryBox = await detail.locator('.recipe-detail__header').boundingBox();
    const detailTabs = detail.locator('[data-test="recipe-detail-tabs"]');
    const detailTabsBox = await detailTabs.boundingBox();
    const preparationBox = await detail.locator('[data-test="recipe-preparation"]').boundingBox();
    const articleBox = await detail.boundingBox();
    expect(articleBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(detailTabsBox).not.toBeNull();
    expect(preparationBox).not.toBeNull();
    expect(summaryBox!.width).toBeCloseTo(articleBox!.width, 0);
    if (viewport.width > 1024) {
      const ingredientsBox = await detail.locator('[data-test="recipe-ingredients"]').boundingBox();
      expect(ingredientsBox).not.toBeNull();
      expect(articleBox!.x).toBeCloseTo(312, 0);
      expect(articleBox!.width).toBeCloseTo(1090, 0);
      expect(detailTabsBox!.x).toBeCloseTo(312, 0);
      expect(detailTabsBox!.width).toBeCloseTo(1090, 0);
      expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(detailTabsBox!.y + 1);
      expect(preparationBox!.x).toBeCloseTo(312, 0);
      expect(preparationBox!.width).toBeCloseTo(746, 0);
      expect(ingredientsBox!.x).toBeCloseTo(1076, 0);
      expect(ingredientsBox!.width).toBeCloseTo(326, 0);
      expect(detailTabsBox!.y + detailTabsBox!.height).toBeLessThanOrEqual(preparationBox!.y + 1);
      expect(ingredientsBox!.y).toBeCloseTo(preparationBox!.y, 0);
    }
    if (viewport.width <= 760) {
      const pageHeader = await page.locator('.recipe-detail-page__header').boundingBox();
      const pageTitle = await page.locator('[data-test="recipe-detail-title"]').boundingBox();
      const summaryMeta = await detail.locator('.recipe-detail__meta').boundingBox();
      const summaryDescription = await detail.locator('.recipe-detail__description').boundingBox();
      const summaryTimings = await timings.boundingBox();
      const backAction = await page.locator('.recipe-detail-page__back').boundingBox();
      const editAction = await page.locator('[data-test="recipe-edit-action"]').boundingBox();
      expect(pageHeader).not.toBeNull();
      expect(pageTitle).not.toBeNull();
      expect(summaryMeta).not.toBeNull();
      expect(summaryDescription).not.toBeNull();
      expect(summaryTimings).not.toBeNull();
      expect(backAction).not.toBeNull();
      expect(editAction).not.toBeNull();
      expect(pageTitle!.x).toBeCloseTo(pageHeader!.x, 0);
      expect(pageTitle!.width).toBeGreaterThanOrEqual(pageHeader!.width - 1);
      expect(detailTabsBox!.x).toBeCloseTo(16, 0);
      expect(detailTabsBox!.width).toBeCloseTo(358, 0);
      expect(pageTitle!.y + pageTitle!.height).toBeLessThanOrEqual(summaryMeta!.y + 1);
      expect(summaryMeta!.y + summaryMeta!.height).toBeLessThanOrEqual(summaryDescription!.y + 1);
      expect(summaryDescription!.y + summaryDescription!.height).toBeLessThanOrEqual(
        summaryTimings!.y + 1
      );
      expect(summaryTimings!.y + summaryTimings!.height).toBeLessThanOrEqual(detailTabsBox!.y + 1);
      expect(detailTabsBox!.y + detailTabsBox!.height).toBeLessThanOrEqual(preparationBox!.y + 1);
      expect(backAction!.y).toBeCloseTo(editAction!.y, 0);
      expect(pageTitle!.y).toBeGreaterThanOrEqual(backAction!.y + backAction!.height);
      expect(editAction!.x + editAction!.width).toBeLessThanOrEqual(
        pageHeader!.x + pageHeader!.width
      );
      await expect(detail.locator('.recipe-detail__actions')).toHaveCSS('position', 'fixed');
      const expandSteps = await detail
        .locator('[data-test="recipe-expand-steps-mobile"]')
        .boundingBox();
      const actions = await detail.locator('.recipe-detail__actions').boundingBox();
      expect(expandSteps).not.toBeNull();
      expect(actions).not.toBeNull();
      expect(expandSteps!.y + expandSteps!.height).toBeLessThanOrEqual(actions!.y);
    }
    await expect(detail).toContainText('~520 kcal por ración');
    await expect(detail).toContainText('Tiempo total');
    await expect(detail).toContainText('Preparación');
    await expect(detail).toContainText('Cocción');
    await expect(detail).toContainText('Reposo');
    await expect(detailTabs.getByRole('tab')).toHaveCount(4);
    const tabStripOverflow = await detailTabs.evaluate((tabStrip) => ({
      overflowY: getComputedStyle(tabStrip).overflowY,
      clientHeight: tabStrip.clientHeight,
      scrollHeight: tabStrip.scrollHeight
    }));
    expect(
      tabStripOverflow.overflowY,
      'la navegación horizontal de subtabs no debe mostrar una barra vertical interna'
    ).toBe('hidden');
    expect(tabStripOverflow.scrollHeight).toBeLessThanOrEqual(tabStripOverflow.clientHeight);
    const preparationTab = detail.locator('[data-test="recipe-detail-tab-preparation"]');
    const ingredientsTab = detail.locator('[data-test="recipe-detail-tab-ingredients"]');
    const guidanceTab = detail.locator('[data-test="recipe-detail-tab-guidance"]');
    const storageTab = detail.locator('[data-test="recipe-detail-tab-storage"]');
    await expect(preparationTab).toHaveAttribute('aria-selected', 'true');
    await expect(detail.locator('[data-test="recipe-preparation"]')).toBeVisible();
    await expect(page.locator('[data-test="recipe-favorite-toggle"]')).toBeVisible();
    const sidebarCook = detail.locator('[data-test="recipe-cooking-open-sidebar"]');
    const responsiveCook = detail.locator('[data-test="recipe-cooking-open"]');
    if (viewport.width > 1024) {
      await expect(sidebarCook).toBeVisible();
      await expect(responsiveCook).toBeHidden();
      const sidebarButton = await sidebarCook.locator('button').boundingBox();
      const sidebarBox = await sidebarCook.boundingBox();
      expect(sidebarButton).not.toBeNull();
      expect(sidebarBox).not.toBeNull();
      expect(sidebarButton!.width).toBeCloseTo(sidebarBox!.width, 0);
    } else {
      await expect(sidebarCook).toBeHidden();
      await expect(responsiveCook).toBeVisible();
      await expect(detail.locator('.recipe-detail__actions app-button')).toHaveCount(1);
      const stickyButton = await responsiveCook.locator('button').boundingBox();
      const stickyBox = await responsiveCook.boundingBox();
      expect(stickyButton).not.toBeNull();
      expect(stickyBox).not.toBeNull();
      expect(stickyButton!.width).toBeCloseTo(stickyBox!.width, 0);
      if (testInfo.project.name === 'mobile-chrome') {
        const assistantButton = page.locator('[data-test="ai-assistant-open"]');
        for (const responsiveViewport of [viewport, { width: 320, height: 640 }]) {
          await page.setViewportSize(responsiveViewport);
          const actionBox = await responsiveCook.boundingBox();
          const assistantBox = await assistantButton.boundingBox();
          expect(actionBox).not.toBeNull();
          expect(assistantBox).not.toBeNull();
          expect(
            actionBox!.x + actionBox!.width,
            `el CTA fijo no invade el FAB a ${responsiveViewport.width}px`
          ).toBeLessThanOrEqual(assistantBox!.x);
        }
        await page.setViewportSize(viewport);
      }
    }
    await expect(
      detail.locator('[data-test="recipe-preparation"] [data-test="recipe-step-photo"]'),
      'la ficha mantiene los pasos compactos; las fotos de cada paso se reservan para cocinar'
    ).toHaveCount(0);
    await expect(
      detail.locator('[data-test="recipe-preparation"] app-timer'),
      'la ficha muestra duraciones; el temporizador interactivo vive en modo cocina'
    ).toHaveCount(0);
    if (viewport.width > 1024) {
      await expect(detail.locator('[data-test="recipe-ingredients"]')).toBeVisible();
    } else {
      await expect(detail.locator('[data-test="recipe-ingredients"]')).toBeHidden();
    }

    await preparationTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(ingredientsTab).toBeFocused();
    await expect(ingredientsTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(preparationTab).toBeFocused();
    await expect(preparationTab).toHaveAttribute('aria-selected', 'true');

    await ingredientsTab.click();
    await expect(ingredientsTab).toHaveAttribute('aria-selected', 'true');
    await expect(detail.locator('[data-test="recipe-ingredients"]')).toContainText('Azafrán QA');
    await expect(detail.locator('[data-test="recipe-ingredients"]')).toContainText('Opcional');
    await expect(detail.locator('[data-test="recipe-ingredients"]')).toContainText('quinoa');
    await expect(detail.locator('[data-test="recipe-cooking-mark-done"]')).toBeVisible();
    await expect(detail.locator('[data-test="recipe-nutrition"]')).toBeHidden();
    const servingsLabel = detail.locator('.recipe-detail__servings label');
    const servingsInput = detail.locator('[data-test="recipe-serving-count"]');
    const [servingsLabelBox, servingsInputBox] = await Promise.all([
      servingsLabel.boundingBox(),
      servingsInput.boundingBox()
    ]);
    expect(servingsLabelBox).not.toBeNull();
    expect(servingsInputBox).not.toBeNull();
    expect(servingsLabelBox!.height).toBeLessThanOrEqual(24);
    expect(servingsLabelBox!.x + servingsLabelBox!.width).toBeLessThanOrEqual(servingsInputBox!.x);
    await expect(detail.locator('[data-test="recipe-preparation"]')).toBeHidden();

    await guidanceTab.click();
    await expect(detail.locator('[data-test="recipe-equipment"]')).toContainText('Cocina de gas');
    await expect(detail.locator('[data-test="recipe-parallel-tasks"]')).toContainText(
      'Calienta el caldo'
    );
    await expect(detail.locator('[data-test="recipe-tips-variations"]')).toContainText(
      'Tuesta el arroz'
    );
    await expect(detail.locator('[data-test="recipe-preparation"]')).toBeHidden();

    await storageTab.click();
    await expect(detail.locator('[data-test="recipe-storage"]')).toContainText('hasta 2 días');
    await expect(detail.locator('[data-test="recipe-storage"]')).toContainText(
      'Recipiente hermético'
    );
    await expect(detail.locator('[data-test="recipe-storage"]')).toContainText('hasta 1 mes');
    await expect(detail.locator('[data-test="recipe-nutrition"]')).toBeVisible();
    await preparationTab.click();

    const detailLevel = page.locator('[data-test="recipe-detail-level"]');
    await expect(detailLevel).toBeVisible();
    await expect(
      detailLevel.locator('[data-test="recipe-detail-level-basic"]')
    ).toHaveAccessibleName('Principiante');
    await expect(
      detailLevel.locator('[data-test="recipe-detail-level-intermediate"]')
    ).toHaveAccessibleName('Intermedio');
    await expect(
      detailLevel.locator('[data-test="recipe-detail-level-expert"]')
    ).toHaveAccessibleName('Experto');
    await expect(detailLevel.locator('[data-test="recipe-detail-level-basic"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const commonIngredientRows = await detail
      .locator('[data-test="recipe-ingredients"] li')
      .allTextContents();
    const commonTimings = await detail.locator('.recipe-detail__timings').textContent();
    expect(commonTimings).not.toBeNull();
    expect(commonIngredientRows.length).toBeGreaterThan(0);
    const secondStep = detail.locator('.step-card[data-step-number="2"]');
    const expandSteps = detail.locator('[data-test="recipe-expand-steps-mobile"]');
    if (testInfo.project.name === 'mobile-chrome') {
      await expect(secondStep).toBeHidden();
      await expect(expandSteps).toBeVisible();
      await expandSteps.click();
      await expect(secondStep).toBeVisible();
      await expandSteps.click();
      await expect(secondStep).toBeHidden();
      await expandSteps.click();
    } else {
      await expect(secondStep).toBeVisible();
      await expect(detail.locator('[data-test="recipe-expand-steps-desktop"]')).toHaveCount(0);
    }
    const finalStep = detail.locator('.step-card[data-step-number="3"]');
    await finalStep.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    const finalStepBox = await finalStep.boundingBox();
    const appHeaderBox = await page.locator('.header').boundingBox();
    expect(finalStepBox).not.toBeNull();
    if (testInfo.project.name === 'mobile-chrome') expect(appHeaderBox).not.toBeNull();
    if (appHeaderBox) {
      expect(finalStepBox!.y).toBeGreaterThanOrEqual(appHeaderBox.y + appHeaderBox.height);
    }
    await detailLevel.locator('[data-test="recipe-detail-level-basic"]').click();
    await expect(detail).toContainText('Lava el arroz y escurre el agua.');
    await expect(detail.locator('[data-test="recipe-ingredients"] li')).toHaveText(
      commonIngredientRows
    );
    await expect(detail.locator('.recipe-detail__timings')).toHaveText(commonTimings!);

    await ingredientsTab.click();
    const servings = page.locator('[data-test="recipe-serving-count"]');
    await expect(servings).toHaveValue('1');
    await expect(detail.locator('[data-test="recipe-ingredients"] li').first()).toContainText(
      '100 g'
    );
    await servings.fill('4');
    await expect(detail.locator('[data-test="recipe-ingredients"] li').first()).toContainText(
      '400 g'
    );
    const commonIngredientRowsAtFourServings = await detail
      .locator('[data-test="recipe-ingredients"] li')
      .allTextContents();

    await preparationTab.click();
    await detailLevel.locator('[data-test="recipe-detail-level-expert"]').click();
    await expect(detail).toContainText('proporción de dos a uno');
    await expect(detail).toContainText('No dejes el arroz en remojo');
    await expect(detail.locator('[data-test="recipe-ingredients"] li')).toHaveText(
      commonIngredientRowsAtFourServings
    );
    await expect(detail.locator('.recipe-detail__timings')).toHaveText(commonTimings!);
    expect(aiRequests, 'cambiar nivel y raciones no debe volver a invocar la IA').toEqual([]);

    const persistedResponse = await page.request.get(`/api/recipes/${recipe.id}`, {
      headers: { authorization: `Bearer ${recipe.token}` }
    });
    expect(persistedResponse.ok()).toBeTruthy();
    const persisted = (await persistedResponse.json()).data;
    expect(persisted.servings).toBe(2);
    expect(persisted.ingredients[0].quantity).toBe(200);
    expect(persisted.instructionsByLevel.expert[0].instruction).toContain(
      'proporción de dos a uno'
    );

    await waitForStableView(page);
    await ingredientsTab.click();
    await servings.fill('2');
    await preparationTab.click();
    await detailLevel.locator('[data-test="recipe-detail-level-basic"]').click();
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    const screenshots = resolveScreenshotDirectory('.e2e-screenshots/recipe-full-detail');
    mkdirSync(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, `${testInfo.project.name}-full-detail.png`),
      fullPage: false,
      animations: 'disabled'
    });

    if (testInfo.project.name === 'mobile-chrome') {
      await page.setViewportSize({ width: 320, height: 568 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(320);
      await expect(detail.getByRole('heading', { name: 'Preparación' })).toBeVisible();
      await detail.locator('[data-test="recipe-expand-steps-mobile"]').click();
      const finalStep = detail.locator('.step-card[data-step-number="3"]');
      await finalStep.scrollIntoViewIfNeeded();
      const narrowStepBox = await finalStep.boundingBox();
      expect(narrowStepBox).not.toBeNull();
      expect(narrowStepBox!.x + narrowStepBox!.width).toBeLessThanOrEqual(320);

      await page.setViewportSize({ width: 568, height: 320 });
      await finalStep.scrollIntoViewIfNeeded();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(568);
      const landscapeStepBox = await finalStep.boundingBox();
      expect(landscapeStepBox).not.toBeNull();
      expect(landscapeStepBox!.x + landscapeStepBox!.width).toBeLessThanOrEqual(568);
    }

    await detailLevel.locator('[data-test="recipe-detail-level-expert"]').click();
    await expect(detail).toContainText('proporción de dos a uno');
    const backToRecipes = page.getByRole('button', { name: 'Volver a recetas' });
    await backToRecipes.focus();
    await backToRecipes.press('Enter');
    await expect(page).toHaveURL(/\/recipes\?collection=all&page=1$/);
    await expect(page.locator('[data-test="recipe-list-heading"]')).toBeFocused();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.evaluate(() => window.scrollTo(0, 0));

    if (viewport.width <= 760) {
      const featured = page.locator('[data-test="recipe-featured"]');
      await expect(featured).toContainText(recipe.name);
      const featuredPlaceholder = featured.locator('.recipes__featured-media--placeholder');
      await expect(featuredPlaceholder).toHaveCount(1);
      const featuredPlaceholderBox = await featuredPlaceholder.boundingBox();
      expect(featuredPlaceholderBox?.height).toBeLessThanOrEqual(112);
      await page.screenshot({
        path: resolve(screenshotDirectory, `no-cover-library-top-${testInfo.project.name}.png`),
        fullPage: false,
        animations: 'disabled'
      });
      await featured.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(screenshotDirectory, `no-cover-library-${testInfo.project.name}.png`),
        fullPage: false,
        animations: 'disabled'
      });
      const featuredMedia = featured.locator('.recipes__featured-media');
      await page.keyboard.press('Tab');
      await featuredMedia.focus();
      await expect(featuredMedia).toHaveCSS('outline-style', 'solid');
      await page.screenshot({
        path: resolve(
          screenshotDirectory,
          `featured-media-keyboard-focus-${testInfo.project.name}.png`
        ),
        fullPage: false,
        animations: 'disabled'
      });
      await featured.locator('.recipes__featured-title-button').focus();
      await featured.locator('.recipes__featured-title-button').press('Enter');
    } else {
      const recipeCard = page.locator('.recipe-card').filter({ hasText: recipe.name });
      await expect(recipeCard).toBeVisible();
      const cardPlaceholder = recipeCard.locator('.recipe-card__image--placeholder');
      await expect(cardPlaceholder).toHaveCount(1);
      const cardPlaceholderBox = await cardPlaceholder.boundingBox();
      expect(cardPlaceholderBox).not.toBeNull();
      expect(
        Math.abs(cardPlaceholderBox!.width / cardPlaceholderBox!.height - 1.6),
        'el fallback de catálogo conserva la proporción compartida 16:10'
      ).toBeLessThanOrEqual(0.02);
      await page.screenshot({
        path: resolve(screenshotDirectory, `no-cover-library-${testInfo.project.name}.png`),
        fullPage: false,
        animations: 'disabled'
      });
      await recipeCard.locator('.recipe-card__open').focus();
      await recipeCard.locator('.recipe-card__open').press('Enter');
    }
    await expect(page).toHaveURL(new RegExp(`/recipes\\?[^#]*recipe=${recipe.id}`));
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-level-expert"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(aiRequests, 'reabrir la ficha no debe volver a invocar la IA').toEqual([]);
    await expect(page.locator('[data-test="recipe-detail-title"]')).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/recipes\?collection=all&page=1$/);
    await expect(page.locator('[data-test="recipe-list-view"]')).toBeVisible();
    await expect(page.locator('[data-test="recipe-list-heading"]')).toBeFocused();

    await page.goto('/recipes#ai');
    const aiDialog = page.getByRole('dialog', { name: 'Generar Receta con IA' });
    await expect(aiDialog).toBeVisible();
    await aiDialog.locator('[data-test="recipe-ai-next"]').click();
    await aiDialog.locator('[data-test="recipe-ai-next"]').click();
    await expect(aiDialog.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();
    const generationServings = aiDialog.getByLabel('Porciones', { exact: true });
    await expect(generationServings).toHaveValue('1');
    await generationServings.fill('3');
    await expect(generationServings).toHaveValue('3');
    expect(
      aiRequests,
      'confirmar o cambiar raciones no debe iniciar por sí solo una llamada'
    ).toEqual([]);
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
