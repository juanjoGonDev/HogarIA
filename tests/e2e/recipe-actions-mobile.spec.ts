import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  waitForStableView
} from './helpers/recipe-fixtures';

const AI_PROVIDER_ROUTES = new Set([
  '/api/ai/test-connection',
  '/api/ai/generate-recipe',
  '/api/ai/generate-multiple-recipes',
  '/api/ai/replace-meal',
  '/api/ai/recommendations',
  '/api/ai/plan-week'
]);

async function expectActionsFit(
  page: import('@playwright/test').Page,
  selector: string,
  buttonNames: RegExp[]
): Promise<void> {
  const actions = page.locator(selector);
  const buttons = buttonNames.map((name) => actions.getByRole('button', { name }));
  const modalBody = page.locator('.modal__body').filter({ has: actions });
  if (await modalBody.count()) {
    await modalBody.evaluate((element: HTMLElement) => {
      element.scrollTop = element.scrollHeight;
    });
  } else {
    await actions.evaluate((element: HTMLElement) => element.scrollIntoView({ block: 'center' }));
  }
  const layout = await actions.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const bodyBounds = element.closest('.modal__body')?.getBoundingClientRect();
    const appHeaderBounds = document.querySelector('.header')?.getBoundingClientRect();
    const safeAreaBottom =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--hogaria-safe-area-bottom')
      ) || 0;
    const buttons = Array.from(element.querySelectorAll('button'), (button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: bounds.left,
      right: bounds.right,
      bodyTop: bodyBounds?.top ?? appHeaderBounds?.bottom ?? 0,
      bodyBottom: bodyBounds?.bottom ?? (visualViewport?.height ?? innerHeight) - safeAreaBottom,
      buttons
    };
  });

  expect(layout.buttons).toHaveLength(buttons.length);
  expect(layout.scrollWidth, 'las acciones no deben desbordar su contenedor').toBeLessThanOrEqual(
    layout.clientWidth
  );
  for (const [index, button] of buttons.entries()) {
    await expect(button).toBeVisible();
    await expect(button).toBeInViewport();
    expect(
      layout.buttons[index].left,
      'el botón debe caber dentro de la fila'
    ).toBeGreaterThanOrEqual(layout.left);
    expect(
      layout.buttons[index].right,
      'el botón debe caber dentro de la fila'
    ).toBeLessThanOrEqual(layout.right);
    expect(layout.buttons[index].left, 'el botón debe caber en el viewport').toBeGreaterThanOrEqual(
      0
    );
    expect(layout.buttons[index].right, 'el botón debe caber en el viewport').toBeLessThanOrEqual(
      page.viewportSize()!.width
    );
    expect(
      layout.buttons[index].top,
      'el botón debe quedar por debajo de la cabecera y dentro del área de lectura'
    ).toBeGreaterThanOrEqual(layout.bodyTop);
    expect(
      layout.buttons[index].bottom,
      'debe haber separación respecto al borde inferior visible'
    ).toBeLessThanOrEqual(layout.bodyBottom - 8);
  }
}

async function expectAiFormScrolls(page: import('@playwright/test').Page): Promise<void> {
  const layout = await page.locator('.modal__body').evaluate((element) => ({
    scrollable: element.scrollHeight > element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    rootWidth: document.documentElement.scrollWidth,
    viewportWidth: visualViewport?.width ?? innerWidth
  }));
  expect(layout.scrollable, 'el formulario largo debe desplazarse dentro de la modal').toBe(true);
  expect(layout.overflowY).toBe('auto');
  expect(layout.rootWidth).toBeLessThanOrEqual(layout.viewportWidth);
}

async function expectModalTitleDoesNotOverlapClose(
  page: import('@playwright/test').Page,
  title: string,
  width: number
): Promise<void> {
  const geometry = await page.getByRole('dialog', { name: title }).evaluate((dialog) => {
    const heading = dialog.querySelector<HTMLElement>('.modal__title');
    const close = dialog.querySelector<HTMLElement>('.modal__close');
    if (!heading || !close) return null;
    const titleBounds = heading.getBoundingClientRect();
    const closeBounds = close.getBoundingClientRect();
    return {
      gap: closeBounds.left - titleBounds.right,
      titleScrollWidth: heading.scrollWidth,
      titleClientWidth: heading.clientWidth
    };
  });

  expect(geometry, 'el diálogo debe tener título y botón de cierre').not.toBeNull();
  expect(
    geometry!.gap,
    `el título debe conservar 8px de separación del cierre a ${width}px`
  ).toBeGreaterThanOrEqual(8);
  expect(
    geometry!.titleScrollWidth,
    `el título no debe recortarse horizontalmente a ${width}px`
  ).toBeLessThanOrEqual(geometry!.titleClientWidth);
}

test('el detalle a página completa conserva scroll y teclado; el formulario IA cabe en móvil', async ({
  page
}, testInfo) => {
  const isMobile = testInfo.project.name === 'mobile-chrome';
  const detailViewports = isMobile
    ? [
        { width: 320, height: 568 },
        { width: 393, height: 851 }
      ]
    : [{ width: 1440, height: 900 }];
  await registerWithHousehold(page, '/dashboard', 'recipe-actions-mobile');
  const recipe = await createSyntheticRecipe(page, {
    name: 'Receta sintética para comprobar que el título largo no invade el botón de cierre',
    steps: Array.from({ length: 32 }, (_, index) => ({
      stepNumber: index + 1,
      instruction: `Paso sintético ${index + 1}: comprueba que el contenido extenso de la ficha se desplaza sin perder el foco ni invadir los controles.`
    }))
  });
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && AI_PROVIDER_ROUTES.has(url.pathname)) {
      providerRequests.push(url.pathname);
    }
  });

  try {
    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    for (const viewport of detailViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/recipes?recipe=${recipe.id}`);
      const detailPage = page.locator('[data-test="recipe-detail-page"]');
      await expect(detailPage).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('[data-test="recipe-detail-title"]')).toHaveText(recipe.name);
      await expect(page.locator('[data-test="recipe-detail-title"]')).toBeFocused();
      await expect(page.locator('.recipe-detail')).toBeVisible();
      await expect(detailPage.locator('[data-test="recipe-favorite-toggle"]')).toBeVisible();
      await waitForStableView(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const titleGeometry = await page
        .locator('[data-test="recipe-detail-title"]')
        .evaluate((heading: HTMLElement) => ({
          clientWidth: heading.clientWidth,
          scrollWidth: heading.scrollWidth
        }));
      expect(
        titleGeometry.scrollWidth,
        `el nombre de la receta no debe desbordar a ${viewport.width}px`
      ).toBeLessThanOrEqual(titleGeometry.clientWidth);

      const rootWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(rootWidth, `la ficha no debe desbordar a ${viewport.width}px`).toBeLessThanOrEqual(
        viewport.width
      );
      const expandSteps = page.locator(
        '[data-test="recipe-expand-steps-mobile"]:visible, [data-test="recipe-expand-steps-desktop"]:visible'
      );
      await expect(expandSteps).toBeVisible();
      await expandSteps.click();
      await expect(page.locator('.recipe-detail__steps > .step-card')).toHaveCount(32);
      const detailBody = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: window.innerHeight,
        scrollY: window.scrollY
      }));
      expect(
        detailBody.scrollHeight,
        `la ficha larga debe desplazarse como página a ${viewport.width}px`
      ).toBeGreaterThan(detailBody.clientHeight);
      if (viewport.width <= 1024) {
        await page.locator('.recipe-detail__actions').scrollIntoViewIfNeeded();
        await expectActionsFit(page, '.recipe-detail__actions', [/Empezar a cocinar/]);
      } else {
        await expectActionsFit(page, '.recipe-detail-page__actions', [
          /Añadir a favoritos/,
          /Editar receta/
        ]);
      }

      if (screenshotDirectory) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(screenshotDirectory, `recipe-actions-detail-${viewport.width}.png`),
          animations: 'disabled'
        });
      }

      const backToRecipes = page.getByRole('button', { name: 'Volver a recetas' });
      await backToRecipes.focus();
      await page.keyboard.press('Enter');
      await expect(detailPage).toBeHidden();
      await expect(page).toHaveURL(/\/recipes$/);
      await expect(page.locator('[data-test="recipe-list-heading"]')).toBeFocused();
    }

    if (isMobile) {
      for (const viewport of [
        { width: 393, height: 851 },
        { width: 320, height: 568 }
      ]) {
        await page.setViewportSize(viewport);
        await page.goto('/recipes#ai');
        await expect(page.getByRole('dialog', { name: 'Generar Receta con IA' })).toBeVisible();
        await waitForStableView(page);
        await expectModalTitleDoesNotOverlapClose(page, 'Generar Receta con IA', viewport.width);
        await expectAiFormScrolls(page);
        await expect(page.locator('[data-test="recipe-ai-step-1"]')).toBeVisible();
        await page.locator('[data-test="recipe-ai-next"]').click();
        await expect(page.locator('[data-test="recipe-ai-step-2"]')).toBeVisible();
        await page.locator('[data-test="recipe-ai-next"]').click();
        await expect(page.locator('[data-test="recipe-ai-step-3"]')).toBeVisible();
        await expectActionsFit(page, '.ai-form__actions', [
          /Anterior/,
          /Generar 1 receta/,
          /Generar 3 opciones/
        ]);
        if (screenshotDirectory) {
          await page.screenshot({
            path: join(screenshotDirectory, `recipe-actions-ai-${viewport.width}.png`),
            animations: 'disabled'
          });
        }

        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/\/recipes$/);
      }
    }

    expect(providerRequests).toEqual([]);
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
