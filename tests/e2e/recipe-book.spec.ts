import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import { mockRecipeStepPhotos } from './helpers/recipe-step-photos';

const SYNTHETIC_COVER_ID = '0123456789abcdef01234567';
const SYNTHETIC_COVER_PATH = `/api/recipe-images/${SYNTHETIC_COVER_ID}`;

function resolveScreenshotDirectory(relativePath: string): string {
  const configuredDirectory = process.env.E2E_SCREENSHOT_DIR;
  return configuredDirectory
    ? resolve(configuredDirectory, relativePath.split(/[\\/]/).at(-1) ?? 'recipe-book')
    : resolve(relativePath);
}

async function mockLocalRecipeBookCover(page: import('@playwright/test').Page) {
  const coverFixture = readFileSync(resolve('tests/e2e/fixtures/recipe-book-cover.svg'));
  let servedCoverCount = 0;

  // Attach a local fixture to one catalog item without changing app/API code or
  // contacting an image provider. The test still exercises the real catalog API.
  await page.route('**/api/recipes**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() !== 'GET' ||
      (pathname !== '/api/recipes' &&
        (!pathname.startsWith('/api/recipes/') || pathname.includes('/step-photos')))
    ) {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }

    const payload = (await response.json()) as {
      data?: Record<string, unknown> & { recipes?: Array<Record<string, unknown>> };
    };
    const patchCover = (recipe: Record<string, unknown>) => {
      if (recipe.name !== 'Riguas de elote') return recipe;
      return { ...recipe, image: SYNTHETIC_COVER_PATH, imageAttribution: null };
    };

    if (pathname === '/api/recipes' && Array.isArray(payload.data?.recipes)) {
      payload.data.recipes = payload.data.recipes.map(patchCover);
    } else if (pathname !== '/api/recipes' && payload.data && 'name' in payload.data) {
      payload.data = patchCover(payload.data);
    }

    await route.fulfill({ response, json: payload });
  });

  await page.route(`**${SYNTHETIC_COVER_PATH}`, async (route) => {
    servedCoverCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: coverFixture
    });
  });

  return { servedCoverCount: () => servedCoverCount };
}

test.describe('Libro de recetas', () => {
  test.beforeEach(async ({ page }) => {
    await mockRecipeStepPhotos(page);
    await registerWithHousehold(page, '/recipes', 'recipe-book');
    await expect(page.locator('h1.recipes__title')).toBeVisible();
  });

  test('filtros rápidos completos y táctiles en móvil estrecho', async ({ page }) => {
    const filters = page.locator('.recipes__quick-filters');
    const targets = filters.locator('app-filter-tag button');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(targets).toHaveCount(4);
    await expect
      .poll(() =>
        filters.evaluate((container) => {
          const bounds = container.getBoundingClientRect();
          return Array.from(container.querySelectorAll('button')).every((button) => {
            const target = button.getBoundingClientRect();
            return (
              target.height >= 44 &&
              target.left >= bounds.left - 0.5 &&
              target.right <= bounds.right + 0.5
            );
          });
        })
      )
      .toBe(true);

    await page.setViewportSize({ width: 320, height: 640 });
    await targets.last().scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        filters.evaluate((container) => {
          const bounds = container.getBoundingClientRect();
          const target = container.querySelector('app-filter-tag:last-child button');
          if (!target) return false;
          const rect = target.getBoundingClientRect();
          return (
            rect.height >= 44 && rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5
          );
        })
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
  });

  test('destaca una receta sin duplicarla y adapta la biblioteca a móvil', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 980 }
        : { width: 393, height: 852 };
    await page.setViewportSize(viewport);

    const featured = page.locator('[data-test="recipe-featured"]');
    const cards = page.locator('[data-test="recipe-card"]');
    let featuredName = '';
    if (testInfo.project.name === 'chromium') {
      await expect(cards).toHaveCount(9);
      await expect(page.getByText('Página 1 de 2')).toBeVisible();
      await expect(featured).toHaveCount(1);
      await expect(featured).toBeHidden();
      await expect(page.locator('[data-test="recipe-more-heading"]')).toBeHidden();
      await expect(cards.first()).toBeVisible();
      featuredName = (await cards.first().locator('.recipe-card__name').innerText()).trim();
      const gridTop = await cards.first().evaluate((card) => card.getBoundingClientRect().top);
      expect(gridTop).toBeLessThanOrEqual(240);
      const firstCardMediaGeometry = await cards
        .first()
        .locator('.recipe-card__image')
        .evaluate((media) => {
          const rect = media.getBoundingClientRect();
          const icon = media.querySelector('svg')?.getBoundingClientRect();
          return {
            isPlaceholder: media.classList.contains('recipe-card__image--placeholder'),
            imageRatio: rect.width / rect.height,
            iconWidth: icon?.width ?? 0,
            iconHeight: icon?.height ?? 0
          };
        });
      if (firstCardMediaGeometry.isPlaceholder) {
        expect(Math.abs(firstCardMediaGeometry.imageRatio - 1.6)).toBeLessThanOrEqual(0.02);
        expect(firstCardMediaGeometry.iconWidth).toBeLessThanOrEqual(80);
        expect(firstCardMediaGeometry.iconHeight).toBeLessThanOrEqual(80);
      }
    } else {
      await expect(featured).toBeVisible();
      await expect(page.getByRole('button', { name: 'Vista de lista' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      featuredName = (await featured.locator('h2').innerText()).trim();
      await expect(featured.locator('.recipes__featured-media')).toHaveAttribute(
        'aria-label',
        new RegExp(featuredName)
      );
      await expect(page.locator('[data-test="recipe-more-heading"]')).toContainText(
        'Seguir cocinando'
      );
      await expect(cards).toHaveCount(9);
      await expect(cards.filter({ hasText: featuredName })).toBeHidden();
      await expect(cards.nth(1)).toBeVisible();
      await expect(cards.nth(2)).toBeHidden();

      const toolbarGeometry = await page.locator('.recipes__browse-toolbar').evaluate((toolbar) => {
        const rect = toolbar.getBoundingClientRect();
        const featuredRect = document
          .querySelector('[data-test="recipe-featured"]')!
          .getBoundingClientRect();
        return { toolbarHeight: rect.height, featuredTop: featuredRect.top };
      });
      expect(toolbarGeometry.toolbarHeight).toBeLessThanOrEqual(52);
      expect(toolbarGeometry.featuredTop).toBeLessThanOrEqual(380);

      const cardGeometry = await cards.nth(1).evaluate((card) => {
        const cardBox = card.getBoundingClientRect();
        const mediaBox = card.querySelector('.recipe-card__image')?.getBoundingClientRect();
        const nameBox = card.querySelector('.recipe-card__name')?.getBoundingClientRect();
        return {
          cardWidth: cardBox.width,
          mediaWidth: mediaBox?.width ?? 0,
          nameWidth: nameBox?.width ?? 0,
          nameHeight: nameBox?.height ?? 0
        };
      });
      expect(cardGeometry.mediaWidth).toBeGreaterThanOrEqual(56);
      expect(cardGeometry.mediaWidth).toBeLessThan(cardGeometry.cardWidth / 2);
      expect(cardGeometry.nameWidth).toBeGreaterThan(140);
      expect(cardGeometry.nameHeight).toBeLessThan(48);

      await page.locator('[data-test="recipe-mobile-show-all"]').click();
      await expect(cards.nth(2)).toBeVisible();
      await page.locator('[data-test="recipe-mobile-show-all"]').click();
      await expect(cards.nth(2)).toBeHidden();
    }

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    const screenshotDirectory = resolveScreenshotDirectory('.e2e-screenshots/recipe-redesign');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(screenshotDirectory, `library-${testInfo.project.name}.png`),
      fullPage: false,
      animations: 'disabled'
    });

    if (testInfo.project.name === 'chromium') {
      await cards.first().locator('.recipe-card__open').click();
    } else {
      await featured.locator('.recipes__featured-title-button').click();
    }
    await expect(page.locator('[data-test="recipe-detail-page"]')).toContainText(featuredName);
  });

  test('filtra el catálogo por búsqueda, país y comida; conserva portada y atribución', async ({
    page
  }, testInfo) => {
    await page.getByRole('tab', { name: 'Libro de recetas' }).click();
    await expect(page).toHaveURL(/[?&]collection=book/);
    await page.goto('/recipes?collection=book&pageSize=20');

    const cards = page.locator('[data-test="recipe-card"]');
    await expect(cards).toHaveCount(12);
    await expect(cards.filter({ hasText: 'Tortilla de patatas' })).toHaveCount(1);
    await expect(cards.filter({ hasText: 'Pupusa revuelta con curtido' })).toHaveCount(1);

    const search = page.locator('[data-test="recipe-search"]');
    await search.fill('Maíz');
    await search.press('Enter');

    await page.getByRole('button', { name: 'Filtros', exact: true }).click();
    await page.locator('[data-test="recipe-book-country"] .picker__trigger').click();
    await page.getByRole('option', { name: 'El Salvador', exact: true }).click();
    await page.locator('[data-test="recipe-book-meal"] .picker__trigger').click();
    await page.getByRole('option', { name: 'Desayuno', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();

    await expect(page).toHaveURL(/[?&]search=Ma%C3%ADz/);
    await expect(page).toHaveURL(/[?&]country=SV/);
    await expect(page).toHaveURL(/[?&]mealType=breakfast/);
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Tamal salvadoreño de pollo' })).toHaveCount(0);
    await expect(cards.filter({ hasText: 'Pastelitos salvadoreños de carne' })).toHaveCount(0);
    await expect(page.locator('.recipes__count')).toHaveText('2 recetas');
    const riguas = cards.filter({ hasText: 'Riguas de elote' });
    await expect(riguas).toHaveCount(1);
    await expect(riguas).toContainText('El Salvador');
    await expect(riguas.locator('.recipe-card__cover-fallback')).toBeVisible();

    const screenshotDirectory = resolveScreenshotDirectory('.e2e-screenshots/recipe-book');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.evaluate(async () => {
      const animations = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY
        );
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-filtered-book.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await riguas.click();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toContainText(
      'Ministerio de Educación de El Salvador'
    );
  });

  test('la URL y los filtros se restauran al recargar y se limpian juntos', async ({ page }) => {
    const bookTab = page.getByRole('tab', { name: 'Libro de recetas' });
    await bookTab.click();
    await expect(page).toHaveURL(/[?&]collection=book/);
    await expect(bookTab).toHaveAttribute('aria-selected', 'true');
    await page.locator('[data-test="recipe-search"]').fill('Tarta de Santiago');
    await page.locator('[data-test="recipe-search"]').press('Enter');
    await expect(page).toHaveURL(/[?&]search=Tarta(?:\+|%20)de(?:\+|%20)Santiago/);
    await expect(page.locator('[data-test="recipe-card"]')).toHaveCount(1);
    await page.reload();

    await expect(page.getByRole('tab', { name: 'Libro de recetas' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.locator('[data-test="recipe-search"]')).toHaveValue('Tarta de Santiago');
    await expect(page.locator('[data-test="recipe-card"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(page.locator('[data-test="recipe-card"]')).toHaveCount(9);
    await expect(page).not.toHaveURL(/[?&]search=/);
  });

  test('sirve la portada del libro desde un fixture local y la conserva en tarjeta y detalle', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 1000 }
        : { width: 393, height: 852 };
    await page.setViewportSize(viewport);
    const cover = await mockLocalRecipeBookCover(page);

    const catalogResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/recipes' && url.searchParams.get('catalogOnly') === 'true';
    });
    await page.goto('/recipes?collection=book&pageSize=20');
    await catalogResponse;
    await expect(page.locator('app-loading')).toHaveCount(0);

    const card = page.locator('[data-test="recipe-card"]').filter({ hasText: 'Riguas de elote' });
    await expect(card).toHaveCount(1);
    await card.scrollIntoViewIfNeeded();

    const cardImage = card.locator('.recipe-card__open img');
    await expect(cardImage).toBeVisible();
    await expect(cardImage).toHaveAttribute('alt', 'Portada de Riguas de elote');
    await expect
      .poll(() => cardImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(card.locator('.recipe-card__cover-fallback')).toHaveCount(0);
    expect(cover.servedCoverCount()).toBeGreaterThan(0);

    const screenshotDirectory = resolveScreenshotDirectory(
      '.e2e-screenshots/2026-10-06-recipe-book-cover'
    );
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-book-cover-card.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await card.locator('.recipe-card__open').click();
    const detail = page.locator('[data-test="recipe-detail-page"]');
    await expect(detail).toBeVisible();
    const detailImage = detail.locator('.recipe-detail__cover img');
    await expect(detailImage).toBeVisible();
    await expect(detailImage).toHaveAttribute('src', SYNTHETIC_COVER_PATH);
    await expect(detailImage).toHaveAttribute('alt', 'Portada de Riguas de elote');
    await expect
      .poll(() => detailImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(detail.locator('[data-test="recipe-detail-title"]')).toHaveText('Riguas de elote');
    await expect(detail).toContainText('Ministerio de Educación de El Salvador');
    expect(cover.servedCoverCount()).toBeGreaterThan(0);

    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-book-cover-detail.png`),
      fullPage: false,
      animations: 'disabled'
    });
  });

  test('una receta del libro abre el detalle completo sin pedir otra generación IA', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 1000 }
        : { width: 393, height: 852 };
    await page.setViewportSize(viewport);
    const bookTab = page.getByRole('tab', { name: 'Libro de recetas' });
    await bookTab.click();
    await expect(page).toHaveURL(/[?&]collection=book/);
    await page.goto('/recipes?collection=book&pageSize=20');
    const aiRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/ai/')) aiRequests.push(request.url());
    });

    const tortilla = page.locator('[data-test="recipe-card"]').filter({
      hasText: 'Tortilla de patatas'
    });
    await tortilla.locator('.recipe-card__open').click();

    const detail = page.locator('[data-test="recipe-full-detail"]');
    await expect(detail).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-test="recipe-detail-title"]')).toHaveText(
      'Tortilla de patatas'
    );
    const detailLevel = page.locator('[data-test="recipe-detail-level"]');
    await expect(
      detailLevel.locator('[data-test="recipe-detail-level-basic"]')
    ).toHaveAccessibleName('Principiante');
    await expect(detailLevel.locator('[data-test="recipe-detail-level-basic"]')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(detail.locator('[data-test="recipe-serving-count"]')).toHaveValue('1');
    const preparation = detail.locator('[data-test="recipe-preparation"]');
    const basicInstructions = await preparation
      .locator('.step-card__instruction')
      .allTextContents();
    const basicWordCount = basicInstructions.join(' ').trim().split(/\s+/).length;
    const basicStepCount = basicInstructions.length;
    const preparationTab = detail.locator('[data-test="recipe-detail-tab-preparation"]');
    const ingredientsTab = detail.locator('[data-test="recipe-detail-tab-ingredients"]');
    const guidanceTab = detail.locator('[data-test="recipe-detail-tab-guidance"]');
    const storageTab = detail.locator('[data-test="recipe-detail-tab-storage"]');
    await expect(preparationTab).toHaveAttribute('aria-selected', 'true');
    await expect(preparation).toBeVisible();
    expect(
      basicStepCount,
      'Principiante debe ofrecer más pasos guiados que Experto'
    ).toBeGreaterThan(4);
    await expect(detail.locator('.step-card').first()).toContainText(
      /lav|enjuag|no hace falta lavar/i
    );

    const screenshotDirectory = resolveScreenshotDirectory(
      '.e2e-screenshots/recipe-book-full-detail'
    );
    mkdirSync(screenshotDirectory, { recursive: true });
    await preparation.scrollIntoViewIfNeeded();
    const expandSteps = page.locator(
      '[data-test="recipe-expand-steps-mobile"]:visible, [data-test="recipe-expand-steps-desktop"]:visible'
    );
    await expandSteps.click();
    await expect(expandSteps).toHaveAttribute('aria-expanded', 'true');
    await preparation.locator('[data-step-number="4"]').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(
        screenshotDirectory,
        `${testInfo.project.name}-tortilla-detail-basic-cooking-step.png`
      ),
      fullPage: false,
      animations: 'disabled'
    });
    await expandSteps.click();

    await ingredientsTab.click();
    await expect(ingredientsTab).toHaveAttribute('aria-selected', 'true');
    const firstIngredient = detail.locator('[data-test="recipe-ingredients"] li').first();
    await expect(firstIngredient).toContainText('150 g');
    await detail.locator('[data-test="recipe-serving-count"]').fill('2');
    await expect(firstIngredient).toContainText('300 g');

    await guidanceTab.click();
    await expect(guidanceTab).toHaveAttribute('aria-selected', 'true');
    await expect(detail.locator('[data-test="recipe-equipment"]')).toBeVisible();
    await expect(detail.locator('[data-test="recipe-parallel-tasks"]')).toBeVisible();
    await expect(detail.locator('[data-test="recipe-tips-variations"]')).toBeVisible();

    await storageTab.click();
    await expect(storageTab).toHaveAttribute('aria-selected', 'true');
    await expect(detail.locator('[data-test="recipe-storage"]')).toBeVisible();
    await expect(detail.locator('[data-test="recipe-nutrition"]')).toBeVisible();

    await preparationTab.click();
    await detailLevel.locator('[data-test="recipe-detail-level-expert"]').click();
    const expertInstructions = await preparation
      .locator('.step-card__instruction')
      .allTextContents();
    const expertWordCount = expertInstructions.join(' ').trim().split(/\s+/).length;
    expect(
      expertInstructions.length,
      'Experto debe ser más conciso en número de pasos'
    ).toBeLessThan(basicStepCount);
    expect(expertWordCount, 'Experto debe ser más conciso en la redacción').toBeLessThan(
      basicWordCount
    );
    expect(aiRequests, 'el cambio de detalle/raciones debe ser local').toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);

    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-tortilla-detail-top.png`),
      fullPage: false,
      animations: 'disabled'
    });
    await detail.locator('[data-test="recipe-preparation"]').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-tortilla-detail-steps.png`),
      fullPage: false,
      animations: 'disabled'
    });
  });

  test('pagina resultados, conserva la página al recargar y presenta una búsqueda vacía', async ({
    page
  }) => {
    await page.goto('/recipes?collection=book&pageSize=6');

    const cards = page.locator('[data-test="recipe-card"]');
    await expect(cards).toHaveCount(6);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();

    await page.getByRole('button', { name: 'Página siguiente', exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(cards).toHaveCount(6);
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await page.reload();
    await expect(cards).toHaveCount(6);
    await expect(page.getByText('Página 2 de 2')).toBeVisible();

    const search = page.locator('[data-test="recipe-search"]');
    await search.fill('zz-receta-inexistente-qa');
    await search.press('Enter');
    await expect(cards).toHaveCount(0);
    await expect(page.locator('.empty-state__title')).toBeVisible();

    await search.fill('');
    await search.press('Enter');
    await expect(cards).toHaveCount(6);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
  });

  test('el libro es operable con teclado y no desborda en móvil estrecho u horizontal', async ({
    page
  }) => {
    await page.getByRole('tab', { name: 'Libro de recetas' }).click();
    await expect(page).toHaveURL(/[?&]collection=book/);
    const firstCard = page.locator('[data-test="recipe-card"]').first();
    await expect(firstCard).toBeVisible();
    const openButton = firstCard.locator('.recipe-card__open');
    await openButton.focus();
    await expect(openButton).toBeFocused();
    await page.keyboard.press('Enter');
    const detail = page.locator('[data-test="recipe-detail-page"]');
    await expect(detail).toBeVisible();
    await page.getByRole('button', { name: 'Volver a recetas' }).focus();
    await page.keyboard.press('Enter');
    await expect(detail).toBeHidden();
    await expect(page.locator('[data-test="recipe-list-view"]')).toBeVisible();

    const favorite = firstCard.locator('.recipe-card__favorite');
    await expect(favorite).toHaveAccessibleName('Añadir a favoritos');
    await favorite.focus();
    await expect(favorite).toBeFocused();
    await page.keyboard.press('Space');
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(favorite).toHaveAccessibleName('Favorito');

    for (const viewport of [
      { width: 320, height: 640 },
      { width: 812, height: 375 }
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(viewport.width);
    }
  });

  test('busca el catálogo general, pagina y alterna cuadrícula/listado sin perder el estado', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 980 }
        : { width: 393, height: 852 };
    await page.setViewportSize(viewport);
    await page.goto('/recipes?pageSize=6');

    const cards = page.locator('[data-test="recipe-card"]');
    const search = page.getByRole('searchbox', { name: 'Buscar recetas' });
    await expect(search).toBeVisible();
    await expect(cards).toHaveCount(6);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();

    const results = page.locator('[data-test="recipe-results"]');
    const listMode = page.getByRole('button', { name: 'Vista de lista' });
    const gridMode = page.getByRole('button', { name: 'Vista de cuadrícula' });
    const previousPage = page.getByRole('button', { name: 'Página anterior' });
    const nextPage = page.getByRole('button', { name: 'Página siguiente' });
    await expect(previousPage).toBeDisabled();
    await expect(nextPage).toBeEnabled();
    if (testInfo.project.name === 'mobile-chrome') {
      await expect(listMode).toHaveAttribute('aria-pressed', 'true');
      await gridMode.click();
    }
    await expect(gridMode).toHaveAttribute('aria-pressed', 'true');
    await listMode.click();
    await expect(listMode).toHaveAttribute('aria-pressed', 'true');
    await expect(results).toHaveClass(/recipes__grid--list/);
    await expect(cards.first()).toHaveClass(/recipe-card--list/);

    const screenshotDirectory = resolveScreenshotDirectory('.e2e-screenshots/recipe-redesign');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(screenshotDirectory, `library-list-${testInfo.project.name}.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await nextPage.click({ timeout: 15000 });
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(cards).toHaveCount(6);
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await expect(results).toHaveClass(/recipes__grid--list/);
    await expect(previousPage).toBeEnabled();
    await expect(nextPage).toBeDisabled();
    await previousPage.click();
    await expect(page).toHaveURL(/[?&]page=1/);
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    await nextPage.click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByText('Página 2 de 2')).toBeVisible();

    await search.fill('Gazpacho');
    await search.press('Enter');
    await expect(page).toHaveURL(/[?&]search=Gazpacho/);
    await expect(page).not.toHaveURL(/[?&]page=\d/);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Gazpacho andaluz');
    await expect(results).toHaveClass(/recipes__grid--list/);

    await search.fill('zz-receta-inexistente-qa');
    await search.press('Enter');
    await expect(cards).toHaveCount(0);
    await expect(page.locator('.empty-state__title')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(cards).toHaveCount(6);

    await gridMode.click();
    await expect(gridMode).toHaveAttribute('aria-pressed', 'true');
    await expect(results).not.toHaveClass(/recipes__grid--list/);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(screenshotDirectory, `library-grid-${testInfo.project.name}.png`),
      fullPage: false,
      animations: 'disabled'
    });

    if (testInfo.project.name === 'mobile-chrome') {
      await page.setViewportSize({ width: 320, height: 640 });
      await listMode.click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(320);
    }
  });

  test('persiste la vista de recetas en la cuenta y la restaura al volver a cargar', async ({
    page
  }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 980 }
        : { width: 393, height: 852 };
    await page.setViewportSize(viewport);

    // Elegir el modo contrario al valor predeterminado responsive fuerza un cambio guardable en
    // ambos proyectos y permite comprobarlo también con el mismo usuario tras recargar.
    const preferredMode = testInfo.project.name === 'chromium' ? 'list' : 'grid';
    const modeButton = page.getByRole('button', {
      name: preferredMode === 'list' ? 'Vista de lista' : 'Vista de cuadrícula'
    });
    const saveResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/auth/profile' && response.request().method() === 'PATCH';
    });
    await modeButton.click();
    const response = await saveResponse;
    expect(response.status()).toBe(200);
    const savedProfile = (await response.json()) as {
      data: { preferences: { recipeViewMode?: string } };
    };
    expect(savedProfile.data.preferences.recipeViewMode).toBe(preferredMode);

    await page.reload();
    await expect(
      page.getByRole('button', {
        name: preferredMode === 'list' ? 'Vista de lista' : 'Vista de cuadrícula'
      })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('alinea la biblioteca con sus marcos Pencil en PC y móvil', async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chrome';
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 980 });

    const quickFilters = page.locator('.recipes__quick-filters');
    await expect(page.locator('[data-test="recipe-card"]').first()).toBeAttached();
    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, height: rect.height, bottom: rect.bottom };
      };
      return {
        header: bounds('.recipes__header'),
        collectionTabs: bounds('.recipes__collections'),
        quickFilters: bounds('.recipes__quick-filters'),
        toolbar: bounds('.recipes__browse-toolbar'),
        featured: bounds('[data-test="recipe-featured"]'),
        firstCard: bounds('[data-test="recipe-card"]')
      };
    });
    const expectNear = (actual: number, expected: number, label: string) => {
      expect(
        Math.abs(actual - expected),
        `${label}: ${actual}px, objetivo ${expected}px`
      ).toBeLessThanOrEqual(1);
    };

    await expect(quickFilters).toBeVisible();
    if (mobile) {
      const featured = page.locator('[data-test="recipe-featured"]');
      const toolbar = page.locator('.recipes__browse-toolbar');
      await expect(featured).toBeVisible();
      await expect(toolbar).toBeVisible();
      expect(geometry.quickFilters?.top).toBeLessThan(geometry.toolbar?.top ?? Infinity);
      expectNear(geometry.quickFilters?.top ?? -1, 241, 'filtros rápidos móvil');
      expectNear(
        geometry.featured?.top ?? -1,
        355,
        'destacado móvil tras controles de búsqueda y vista'
      );
    } else {
      const header = page.locator('.recipes__header');
      const collectionTabs = page.locator('.recipes__collections');
      const firstCard = page.locator('[data-test="recipe-card"]').first();
      await expect(header).toBeVisible();
      await expect(collectionTabs).toBeVisible();
      await expect(firstCard).toBeVisible();
      expectNear(geometry.header?.top ?? -1, 32, 'cabecera PC');
      expectNear(geometry.collectionTabs?.top ?? -1, 92, 'pestañas PC');
      expectNear(geometry.quickFilters?.top ?? -1, 150, 'filtros rápidos PC');
      expectNear(geometry.firstCard?.top ?? -1, 206, 'primera tarjeta PC');
    }

    const screenshots = resolveScreenshotDirectory('.e2e-screenshots/recipe-redesign');
    mkdirSync(screenshots, { recursive: true });
    await page.screenshot({
      path: resolve(screenshots, `library-pencil-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: false,
      animations: 'disabled',
      scale: 'css'
    });
  });

  test('distingue visualmente recetas favoritas y no favoritas', async ({ page }, testInfo) => {
    const viewport =
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 980 }
        : { width: 393, height: 852 };
    await page.setViewportSize(viewport);

    if (testInfo.project.name === 'mobile-chrome') {
      const showAll = page.locator('[data-test="recipe-mobile-show-all"]');
      await expect(showAll).toBeVisible();
      await showAll.click();
      await expect(showAll).toHaveAttribute('aria-expanded', 'true');
      await expect(
        page
          .locator('[data-test="recipe-card"] .recipe-card__favorite[aria-pressed="false"]:visible')
          .first()
      ).toBeVisible();
    }

    const favorite = page
      .locator('[data-test="recipe-card"] .recipe-card__favorite:visible')
      .first();
    await expect(favorite).toBeVisible();
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    const inactive = await favorite.evaluate((button) => ({
      iconPath: button.querySelector('app-icon svg path')?.getAttribute('d'),
      color: getComputedStyle(button).color,
      background: getComputedStyle(button).backgroundColor
    }));

    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(favorite).toHaveAccessibleName('Favorito');
    const active = await favorite.evaluate((button) => ({
      iconPath: button.querySelector('app-icon svg path')?.getAttribute('d'),
      color: getComputedStyle(button).color,
      background: getComputedStyle(button).backgroundColor,
      width: (button as HTMLElement).offsetWidth,
      height: (button as HTMLElement).offsetHeight
    }));

    expect(active.iconPath).not.toBe(inactive.iconPath);
    expect(active.color).not.toBe(inactive.color);
    expect(active.background).not.toBe(inactive.background);
    expect(active.width).toBe(44);
    expect(active.height).toBe(44);

    if (testInfo.project.name === 'mobile-chrome') {
      const inactiveCardFavorite = page
        .locator('[data-test="recipe-card"] .recipe-card__favorite[aria-pressed="false"]:visible')
        .first();
      await favorite.scrollIntoViewIfNeeded();
      await expect(favorite).toBeInViewport();
      await expect(inactiveCardFavorite).toBeInViewport();
    }

    const screenshotDirectory = resolveScreenshotDirectory('.e2e-screenshots/recipe-redesign');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `favorites-${testInfo.project.name}.png`),
      fullPage: false,
      animations: 'disabled'
    });
  });
});
