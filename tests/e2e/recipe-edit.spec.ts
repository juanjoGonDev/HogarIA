import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';
import { mockAiFunctionAvailable } from './helpers/ai';
import { mockRecipeStepPhotos } from './helpers/recipe-step-photos';
import {
  createSyntheticRecipe,
  deleteSyntheticRecipe,
  waitForStableView
} from './helpers/recipe-fixtures';

function resolveScreenshotDirectory(relativePath: string): string {
  const configuredDirectory = process.env.E2E_SCREENSHOT_DIR;
  return configuredDirectory
    ? resolve(configuredDirectory, relativePath.split(/[\\/]/).at(-1) ?? 'recipe-edit')
    : resolve(process.cwd(), relativePath);
}

const detailedFixture = {
  name: 'Guiso de prueba para editar',
  ingredients: [
    {
      name: 'Garbanzos QA',
      quantity: 240,
      unit: 'g',
      preparation: 'enjuagados',
      isOptional: false,
      substitutes: ['alubias'],
      notes: 'escurridos'
    },
    { name: 'Espinacas QA', quantity: 100, unit: 'g', isOptional: true, substitutes: [] }
  ],
  utensils: ['Cuchara de madera'],
  guidance: {
    appliances: ['Cocina de gas'],
    parallelTasks: ['Lava las espinacas mientras se calienta el caldo.'],
    tipsAndVariations: ['Termina con pimentón.'],
    batchCookingWarning: 'Dora las verduras en tandas.'
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Lava las espinacas y escurre los garbanzos.',
        duration: 12,
        temperature: { value: 90, unit: 'C' as const },
        timerRequired: true,
        timerDuration: 8,
        tips: 'Añade el caldo poco a poco.',
        warning: 'La olla estará caliente.'
      }
    ],
    intermediate: [
      { stepNumber: 1, instruction: 'Lava las espinacas; enjuaga y escurre los garbanzos.' }
    ],
    expert: [
      { stepNumber: 1, instruction: 'Enjuaga los garbanzos y seca las espinacas antes de saltear.' }
    ]
  },
  nutrition: { calories: 380, protein: 18, carbs: 50, fat: 10, fiber: 14 },
  storage: {
    method: 'Refrigerar cuando se enfríe.',
    container: 'Recipiente hermético',
    duration: '3 días',
    reheatingInstructions: 'Calentar hasta que esté bien caliente.',
    freezingPossible: true,
    freezingDuration: '2 meses'
  }
};

async function openEditor(page: import('@playwright/test').Page, id: string): Promise<void> {
  await page.goto(`/recipes?recipe=${encodeURIComponent(id)}`);
  await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
  await page.locator('[data-test="recipe-edit-action"]').click();
  await expect(page).toHaveURL(new RegExp(`/recipes/${id}/edit$`));
  await expect(page.locator('[data-test="recipe-editor-form"]')).toBeVisible();
}

async function selectEditorTab(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
}

async function selectInstructionLevel(
  page: import('@playwright/test').Page,
  level: 'basic' | 'intermediate' | 'expert'
): Promise<void> {
  await page.locator(`#editor-level-tab-${level}`).click();
}

async function stubAutomaticStepPhotos(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/recipes/step-photos?scene=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: null })
    })
  );
}

test('la vista dedicada edita todos los campos, conserva el estado personal y no llama a IA', async ({
  page
}, testInfo) => {
  const manualCoverUrl = 'https://images.example.test/cover.jpg';
  const manualStepUrl = 'https://images.example.test/step.jpg';
  if (testInfo.project.name === 'chromium')
    await page.setViewportSize({ width: 1440, height: 1000 });
  await stubAutomaticStepPhotos(page);
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'
    })
  );
  await registerWithHousehold(page, '/recipes', 'recipe-editor-save');
  const recipe = await createSyntheticRecipe(page, detailedFixture);
  const token = recipe.token;
  const headers = { authorization: `Bearer ${token}` };
  const requests: string[] = [];
  const patchRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/ai/')) {
      requests.push(request.url());
    }
    if (request.method() === 'PATCH') patchRequests.push(request.url());
  });

  try {
    await page.request.post(`/api/recipes/${recipe.id}/favorite`, { headers });
    await page.request.post(`/api/recipes/${recipe.id}/cook`, { headers });
    await openEditor(page, recipe.id);
    await expect(page.getByRole('heading', { name: 'Editar receta' })).toBeFocused();

    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'mobile-chrome') {
      const directory = resolveScreenshotDirectory('.e2e-screenshots/recipe-editor');
      mkdirSync(directory, { recursive: true });
      const file = testInfo.project.name === 'chromium' ? 'desktop.png' : 'mobile.png';
      await page.screenshot({
        path: resolve(directory, file),
        fullPage: false,
        animations: 'disabled'
      });
    }

    await selectEditorTab(page, 'Preparación');
    await expect(page.locator('#step-instruction-basic-0')).toHaveValue(
      detailedFixture.instructionsByLevel.basic[0].instruction
    );
    await selectInstructionLevel(page, 'intermediate');
    await expect(page.locator('#step-instruction-intermediate-0')).toHaveValue(
      detailedFixture.instructionsByLevel.intermediate[0].instruction
    );
    await selectInstructionLevel(page, 'expert');
    await expect(page.locator('#step-instruction-expert-0')).toHaveValue(
      detailedFixture.instructionsByLevel.expert[0].instruction
    );
    await selectEditorTab(page, 'Ingredientes');
    await expect(page.locator('#ingredient-substitutes-0')).toHaveValue('alubias');
    await selectEditorTab(page, 'Nutrición y conservación');
    await expect(page.locator('#storage-duration')).toHaveValue('3 días');
    await selectEditorTab(page, 'Datos');

    await page.locator('#editor-name').fill('');
    await page.locator('[data-test="recipe-editor-save"] button').click();
    await expect(page.locator('[data-test="recipe-editor-error"]')).toContainText(
      'Revisa los campos marcados'
    );
    expect(patchRequests).toHaveLength(0);
    await page.locator('#editor-name').fill(detailedFixture.name);

    await page.locator('#editor-name').fill('Guiso de garbanzos y espinacas QA');
    await selectEditorTab(page, 'Ingredientes');
    await page.locator('#ingredient-name-0').fill('Garbanzos cocidos QA');
    await selectEditorTab(page, 'Multimedia');
    await page.locator('#editor-image').fill(manualCoverUrl);
    await selectEditorTab(page, 'Preparación');
    await selectInstructionLevel(page, 'basic');
    await page.locator('#step-image-basic-0').fill(manualStepUrl);
    await selectInstructionLevel(page, 'intermediate');
    await page
      .locator('#step-instruction-intermediate-0')
      .fill('Enjuaga los garbanzos y corta las espinacas.');
    await selectEditorTab(page, 'Nutrición y conservación');
    await page.locator('#nutrition-protein').fill('21');
    await selectEditorTab(page, 'Datos');
    await page.getByRole('checkbox', { name: 'Almuerzo' }).check();
    await page.locator('[data-test="recipe-editor-save"] button').click();

    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-title"]')).toHaveText(
      'Guiso de garbanzos y espinacas QA'
    );
    const response = await page.request.get(`/api/recipes/${recipe.id}`, { headers });
    expect(response.ok()).toBeTruthy();
    const saved = ((await response.json()) as { data: Record<string, any> }).data;
    expect(saved.name).toBe('Guiso de garbanzos y espinacas QA');
    expect(saved.ingredients[0]).toMatchObject({
      name: 'Garbanzos cocidos QA',
      quantity: 240,
      unit: 'g'
    });
    expect(saved.instructionsByLevel.intermediate[0].instruction).toBe(
      'Enjuaga los garbanzos y corta las espinacas.'
    );
    expect(saved.instructionsByLevel.basic[0].instruction).toBe(
      detailedFixture.instructionsByLevel.basic[0].instruction
    );
    expect(saved.image).toBe(manualCoverUrl);
    expect(saved.instructionsByLevel.basic[0].image).toBe(manualStepUrl);
    expect(saved.instructionsByLevel.expert[0].instruction).toBe(
      detailedFixture.instructionsByLevel.expert[0].instruction
    );
    expect(saved.nutrition.protein).toBe(21);
    expect(saved.isFavorite).toBe(true);
    expect(saved.timesCooked).toBe(1);
    expect(requests.some((url) => url.includes('/api/ai/'))).toBe(false);

    const detailLevel = page.locator('[data-test="recipe-detail-level"]');
    await expect(detailLevel).toBeVisible();
    await detailLevel.locator('[data-test="recipe-detail-level-basic"]').click();
    const preparation = page.locator('[data-test="recipe-preparation"]');
    await expect(preparation).toContainText('Lava las espinacas y escurre los garbanzos.');
    await expect(preparation).toContainText('Temperatura: 90 °C');
    await expect(preparation).toContainText('Añade el caldo poco a poco.');
    await expect(preparation).toContainText('La olla estará caliente.');
    await expect(page.locator('[data-test="recipe-tips-variations"]')).toContainText(
      'Termina con pimentón.'
    );
    await expect(page.locator('[data-test="recipe-equipment"]')).toContainText('Cuchara de madera');
    await expect(page.locator('[data-test="recipe-parallel-tasks"]')).toContainText(
      'Lava las espinacas mientras se calienta el caldo.'
    );
    await expect(page.locator('[data-test="recipe-batch-warning"]')).toContainText(
      'Dora las verduras en tandas.'
    );
    await expect(page.locator('[data-test="recipe-nutrition"]')).toContainText('21 g');
    await expect(page.locator('[data-test="recipe-storage"]')).toContainText('2 meses');
    await detailLevel.locator('[data-test="recipe-detail-level-expert"]').click();
    await expect(preparation).toContainText(
      'Enjuaga los garbanzos y seca las espinacas antes de saltear.'
    );
    await detailLevel.locator('[data-test="recipe-detail-level-basic"]').click();
    await page
      .locator(
        '[data-test="recipe-cooking-open"]:visible button, [data-test="recipe-cooking-open-sidebar"]:visible button'
      )
      .click();
    await expect(page.locator('[data-test="recipe-cooking-view"]')).toContainText(
      'Temperatura: 90 °C'
    );
    await waitForStableView(page);

    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'mobile-chrome') {
      await page.goto('/recipes');
      await expect(page.locator('[data-test="recipe-list-view"]')).toBeVisible();
    }
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('edita y guarda textos de receta largos en escritorio y móvil', async ({ page }, testInfo) => {
  const isDesktop = testInfo.project.name === 'chromium';
  const mobileViewports = [
    { width: 393, height: 852 },
    { width: 320, height: 700 }
  ];
  await page.setViewportSize(isDesktop ? { width: 1440, height: 1000 } : mobileViewports[0]);
  await stubAutomaticStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'recipe-editor-unbounded-text');
  const recipe = await createSyntheticRecipe(page, detailedFixture);
  const longText = 'x'.repeat(2_501);

  try {
    await openEditor(page, recipe.id);
    await selectEditorTab(page, 'Datos');
    await page.locator('#editor-name').fill(longText);
    await page.locator('#editor-description').fill(longText);
    await page.locator('#editor-cuisine').fill(longText);
    await page.getByRole('checkbox', { name: 'Almuerzo' }).check();

    for (const field of ['#editor-name', '#editor-description', '#editor-cuisine']) {
      expect(await page.locator(field).getAttribute('maxlength')).toBeNull();
    }

    const viewports = isDesktop ? [{ width: 1440, height: 1000 }] : mobileViewports;
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => ({
        viewportWidth: visualViewport?.width ?? innerWidth,
        documentWidth: document.documentElement.scrollWidth
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);

      if (viewport.width === (isDesktop ? 1440 : 393)) {
        await page.locator('#recipe-editor-title').scrollIntoViewIfNeeded();
        const directory = resolveScreenshotDirectory('.e2e-screenshots/recipe-editor');
        mkdirSync(directory, { recursive: true });
        await page.screenshot({
          path: resolve(directory, `unbounded-text-${isDesktop ? 'desktop' : 'mobile'}.png`),
          animations: 'disabled'
        });
      }
    }

    await page.locator('[data-test="recipe-editor-save"] button').click();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    const response = await page.request.get(`/api/recipes/${recipe.id}`, {
      headers: { authorization: `Bearer ${recipe.token}` }
    });
    expect(response.ok()).toBe(true);
    const saved = ((await response.json()) as { data: Record<string, unknown> }).data;
    expect(saved).toMatchObject({ name: longText, description: longText, cuisine: longText });
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('pide confirmación al abandonar cambios y conserva el borrador cuando falla el guardado', async ({
  page
}) => {
  await stubAutomaticStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'recipe-editor-recover');
  const recipe = await createSyntheticRecipe(page, detailedFixture);
  try {
    await openEditor(page, recipe.id);
    await page.getByRole('checkbox', { name: 'Almuerzo' }).check();
    await page.locator('#editor-name').fill('Borrador que no se pierde');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('#editor-name')).toHaveValue('Borrador que no se pierde');

    await page.route(`**/api/recipes/${recipe.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 503,
          json: { success: false, message: 'Temporary test failure' }
        });
      } else {
        await route.continue();
      }
    });
    await page.locator('[data-test="recipe-editor-save"] button').click();
    await expect(page.locator('[data-test="recipe-editor-error"]')).toContainText(
      'Tu borrador sigue aquí'
    );
    await expect(page.locator('#editor-name')).toHaveValue('Borrador que no se pierde');

    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.locator('[data-test="recipe-editor-confirm-discard"]').click();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('busca y selecciona fotos reales para portada y pasos, con vista previa y atribución', async ({
  page
}, testInfo) => {
  if (testInfo.project.name === 'chromium')
    await page.setViewportSize({ width: 1440, height: 1000 });
  const photoId = 'f'.repeat(24);
  const searchQueries: string[] = [];
  await page.route('**/api/recipes/step-photos/search**', async (route) => {
    const url = new URL(route.request().url());
    searchQueries.push(url.searchParams.get('q') ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          {
            id: photoId,
            altText: 'Cebolla cortada en dados sobre tabla',
            author: 'Fotógrafa de prueba',
            licenseName: 'CC BY 4.0',
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
            sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cebolla-test.jpg',
            previewUrl: `/api/recipe-photo-previews/${photoId}`
          }
        ]
      })
    });
  });
  await page.route('**/api/recipe-photo-previews/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZkAAAAASUVORK5CYII=',
        'base64'
      )
    })
  );

  await stubAutomaticStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'recipe-step-photo-search');
  const recipe = await createSyntheticRecipe(page, detailedFixture);
  try {
    await openEditor(page, recipe.id);
    await selectEditorTab(page, 'Multimedia');
    await expect(page.getByRole('button', { name: 'Generar foto con IA' })).toBeDisabled();
    await expect(page.locator('#editor-image-generation-help')).toContainText(
      'La configuración de IA activa no ofrece generación de imágenes'
    );
    const coverQuery = page.locator('#editor-photo-search');
    await coverQuery.fill('guiso de prueba');
    const coverResults = page.locator('[data-test="recipe-photo-results"]');
    await expect(coverResults).toBeVisible();
    await coverResults.getByRole('button', { name: /Usar esta foto/ }).click();
    await expect(coverResults.getByRole('button', { name: /Foto seleccionada/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('.editor-cover-preview')).toContainText('Fotógrafa de prueba');

    await selectEditorTab(page, 'Preparación');
    const query = page.locator('#step-photo-search-basic-0');
    await query.fill('cebolla picada');
    const results = page.locator('[data-test="recipe-step-photo-results-basic-0"]');
    await expect(results).toBeVisible();
    await expect(results.getByRole('button', { name: /Usar esta foto/ })).toBeVisible();
    await results.getByRole('button', { name: /Usar esta foto/ }).click();

    await expect(results.getByRole('button', { name: /Foto seleccionada/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('.editor-step-preview')).toContainText('Fotógrafa de prueba');
    expect(searchQueries).toEqual(['guiso de prueba', 'cebolla picada']);

    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'mobile-chrome') {
      await page.locator('[data-test="recipe-step-photo-search-basic-0"]').scrollIntoViewIfNeeded();
      const directory = resolveScreenshotDirectory('.e2e-screenshots/recipe-step-photo-edit');
      mkdirSync(directory, { recursive: true });
      const file = testInfo.project.name === 'chromium' ? 'desktop.png' : 'mobile.png';
      await page.screenshot({
        path: resolve(directory, file),
        fullPage: false,
        animations: 'disabled'
      });
    }
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('selecciona vídeos licenciados y solo carga el del paso activo al cocinar', async ({
  page
}, testInfo) => {
  if (testInfo.project.name === 'chromium')
    await page.setViewportSize({ width: 1440, height: 1000 });
  const photoRequests = await mockRecipeStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'recipe-step-video-selection');
  const videoFixture = {
    ...detailedFixture,
    instructionsByLevel: {
      ...detailedFixture.instructionsByLevel,
      basic: [
        ...detailedFixture.instructionsByLevel.basic,
        {
          stepNumber: 2,
          instruction: 'Cocina la calabaza a fuego lento.',
          duration: 6,
          temperature: { value: 90, unit: 'C' as const },
          timerRequired: false,
          timerDuration: null,
          tips: null,
          warning: null
        }
      ]
    }
  };
  const recipe = await createSyntheticRecipe(page, videoFixture);
  const candidate = {
    id: 'a'.repeat(24),
    title: 'Cortar verduras',
    author: 'Autora sintética',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cutting.webm',
    thumbnailUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Cutting.jpg',
    durationSeconds: 10,
    mimeType: 'video/webm'
  };
  const secondCandidate = { ...candidate, id: 'b'.repeat(24), title: 'Corte fino de verduras' };
  const candidates = [candidate, secondCandidate];
  const videoAttributions = new Map(
    candidates.map((item) => [
      item.id,
      Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id'))
    ])
  );
  const searchedScenes: string[] = [];
  let searchIndex = 0;
  let savedRecipe: Record<string, any> | null = null;
  const patchedRecipe: { value: Record<string, any> | null } = { value: null };

  try {
    const originalResponse = await page.request.get(`/api/recipes/${recipe.id}`, {
      headers: { authorization: `Bearer ${recipe.token}` }
    });
    expect(originalResponse.ok()).toBeTruthy();
    const original = (await originalResponse.json()) as { data: Record<string, any> };

    await page.route('**/api/recipes/step-videos/search**', async (route) => {
      searchedScenes.push(new URL(route.request().url()).searchParams.get('scene') ?? '');
      const result = candidates[searchIndex++];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: result ? [result] : [] })
      });
    });
    await page.route('https://upload.wikimedia.org/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZkAAAAASUVORK5CYII=',
          'base64'
        )
      })
    );
    await page.route(`**/api/recipes/${recipe.id}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        const patch = route.request().postDataJSON() as Record<string, any>;
        const levels = patch.instructionsByLevel as Record<string, Array<Record<string, any>>>;
        const decoratedLevels = Object.fromEntries(
          Object.entries(levels).map(([level, steps]) => [
            level,
            steps.map((step) => ({
              ...step,
              ...(typeof step.videoId === 'string' && videoAttributions.has(step.videoId)
                ? { videoAttribution: videoAttributions.get(step.videoId) }
                : {})
            }))
          ])
        );
        patchedRecipe.value = patch;
        savedRecipe = { ...original.data, ...patch, instructionsByLevel: decoratedLevels };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: savedRecipe })
        });
        return;
      }
      if (route.request().method() === 'GET' && savedRecipe) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: savedRecipe })
        });
        return;
      }
      await route.continue();
    });
    await page.route(`**/api/recipes/${recipe.id}/step-videos/*/playback`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      })
    );
    await page.route('https://upload.wikimedia.org/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f0dfcf"/><rect x="36" y="28" width="568" height="304" rx="28" fill="#dec39f"/><circle cx="320" cy="185" r="112" fill="#f8f5ea" stroke="#75836f" stroke-width="12"/><circle cx="320" cy="185" r="82" fill="#d9ad61"/><g fill="#55735a"><circle cx="282" cy="164" r="12"/><circle cx="350" cy="198" r="14"/><circle cx="300" cy="224" r="9"/></g><g fill="#b46d3c"><circle cx="350" cy="151" r="10"/><circle cx="286" cy="198" r="8"/></g><text x="64" y="70" fill="#35251a" font-size="18" font-family="sans-serif">VISTA PREVIA</text></svg>`
      })
    );
    await page.route(`**/api/recipes/${recipe.id}/step-videos/*/stream`, (route) =>
      route.fulfill({
        status: 206,
        contentType: 'video/webm',
        headers: {
          'accept-ranges': 'bytes',
          'content-range': 'bytes 0-3/4',
          'content-length': '4'
        },
        body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
      })
    );

    await openEditor(page, recipe.id);
    await selectEditorTab(page, 'Preparación');
    await page.locator('#step-instruction-basic-0').fill('Corta la calabaza en dados uniformes.');
    await page.locator('[data-test="recipe-step-media-search-basic-0"]').click();
    const result = page.locator('[data-test="recipe-step-video-result-basic-0"]');
    await expect(result).toContainText(candidate.title);
    expect(searchedScenes).toEqual(['cut']);
    expect(JSON.stringify(searchedScenes)).not.toContain('calabaza');
    await result.getByRole('button', { name: 'Usar este vídeo', exact: true }).click();
    await expect(page.locator('.editor-selected-video')).toContainText(candidate.licenseName);

    await page.locator('#step-instruction-basic-1').fill('Cocina la calabaza a fuego lento.');
    await page.locator('[data-test="recipe-step-media-search-basic-1"]').click();
    const secondResult = page.locator('[data-test="recipe-step-video-result-basic-1"]');
    await expect(secondResult).toContainText(secondCandidate.title);
    expect(searchedScenes).toEqual(['cut', 'cook']);
    expect(JSON.stringify(searchedScenes)).not.toContain('calabaza');
    await secondResult.getByRole('button', { name: 'Usar este vídeo', exact: true }).click();

    const patchResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/recipes/${recipe.id}`)
    );
    await selectEditorTab(page, 'Datos');
    await page.getByRole('checkbox', { name: 'Almuerzo' }).check();
    await selectEditorTab(page, 'Preparación');
    await page.locator('[data-test="recipe-editor-save"] button').click();
    expect((await patchResponse).ok()).toBeTruthy();
    expect(patchedRecipe.value).not.toBeNull();
    expect(
      (patchedRecipe.value?.instructionsByLevel as Record<string, Array<Record<string, unknown>>>)
        .basic[0].videoId
    ).toBe(candidate.id);
    expect(
      (patchedRecipe.value?.instructionsByLevel as Record<string, Array<Record<string, unknown>>>)
        .basic[1].videoId
    ).toBe(secondCandidate.id);
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    expect(savedRecipe).not.toBeNull();

    await page.locator('[data-test="recipe-detail-level-basic"]').click();
    await page
      .locator(
        '[data-test="recipe-cooking-open"]:visible button, [data-test="recipe-cooking-open-sidebar"]:visible button'
      )
      .click();
    const player = page.locator('[data-test="recipe-step-video-player"]');
    await expect(player).toBeVisible();
    await expect(
      player.getByRole('link', { name: 'Ver vídeo original en Wikimedia Commons' })
    ).toBeVisible();
    const video = player.locator('[data-test="recipe-step-video"]');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('crossorigin', 'use-credentials');
    await expect(video.locator('source')).toHaveAttribute(
      'src',
      `/api/recipes/${recipe.id}/step-videos/${candidate.id}/stream`
    );
    expect(await page.locator('[data-test="recipe-step-video-player"]').count()).toBe(1);
    await page.getByRole('button', { name: 'Siguiente paso' }).click();
    expect(await page.locator('[data-test="recipe-step-video-player"]').count()).toBe(1);
    await expect(page.locator('[data-test="recipe-step-video"] source')).toHaveAttribute(
      'src',
      `/api/recipes/${recipe.id}/step-videos/${secondCandidate.id}/stream`
    );

    await page
      .locator('[data-test="recipe-step-video"]')
      .evaluate((element) => element.dispatchEvent(new Event('error')));
    await expect(player).toHaveCount(0);
    const photoFallback = page.locator('[data-test="recipe-step-photo"]');
    await expect(photoFallback).toBeVisible();
    await expect(photoFallback.locator('img')).toBeVisible();
    await expect(photoFallback.locator('img')).toHaveJSProperty('naturalWidth', 800);
    await expect(photoFallback).toContainText('Autora sintética de E2E');
    await expect(
      photoFallback.getByRole('link', { name: 'Ver foto original en Wikimedia Commons' })
    ).toBeVisible();
    expect(
      photoRequests.some(
        (request) => request.path.endsWith('/step-photos') && request.params.scene === 'cook'
      )
    ).toBeTruthy();
    const fallbackNotice = page.locator('[data-test="recipe-step-video-fallback"]');
    await expect(fallbackNotice.getByRole('status')).toContainText('No se pudo reproducir');
    await expect(
      page.getByText('Cocina la calabaza a fuego lento.', { exact: true })
    ).toBeVisible();

    const directory = resolveScreenshotDirectory('.e2e-screenshots/recipe-step-video');
    mkdirSync(directory, { recursive: true });
    await page.screenshot({
      path: resolve(directory, `${testInfo.project.name}-video-fallback-photo.png`),
      animations: 'disabled'
    });

    await page.getByRole('button', { name: 'Paso anterior' }).click();
    await expect(page.locator('[data-test="recipe-step-video"] source')).toHaveAttribute(
      'src',
      `/api/recipes/${recipe.id}/step-videos/${candidate.id}/stream`
    );
    await page.getByRole('button', { name: 'Siguiente paso' }).click();
    await expect(photoFallback).toBeVisible();
    await page.getByRole('button', { name: 'Reintentar vídeo' }).click();
    await expect(player).toBeVisible();
    await expect(page.locator('[data-test="recipe-step-video"] source')).toHaveAttribute(
      'src',
      `/api/recipes/${recipe.id}/step-videos/${secondCandidate.id}/stream`
    );

    await page.screenshot({
      path: resolve(directory, `${testInfo.project.name}-video-fallback-after-retry.png`),
      animations: 'disabled'
    });
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('revisa una mejora canónica, busca medios genéricos y persiste solo al guardar', async ({
  page
}, testInfo) => {
  await mockAiFunctionAvailable(page, 'recipes');
  await page.setViewportSize(
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 1000 }
      : { width: 393, height: 852 }
  );
  await registerWithHousehold(page, '/recipes', 'recipe-improve-review');
  const recipe = await createSyntheticRecipe(page, detailedFixture);
  const headers = { authorization: `Bearer ${recipe.token}` };
  const improveRequests: Record<string, any>[] = [];
  const patchRequests: string[] = [];
  const photoScenes: string[] = [];
  const videoScenes: string[] = [];
  let firstImproveAttempt = true;
  const allowedScenes = ['wash', 'cut', 'mix', 'cook', 'bake', 'rest', 'serve', 'prepare'];
  const improvedInstructions = {
    basic: [{ stepNumber: 1, instruction: 'Corta la calabaza en dados uniformes.' }],
    intermediate: [
      { stepNumber: 1, instruction: 'Corta la calabaza en dados uniformes de tamaño similar.' }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Corta la calabaza en una brunoise regular para cocción homogénea.'
      }
    ]
  };
  const canonicalSteps = Object.fromEntries(
    Object.entries(improvedInstructions).map(([level, steps]) => [
      level,
      steps.map((step) => ({
        ...step,
        duration: 12,
        temperature: { value: 180, unit: 'C' },
        timerRequired: true,
        timerDuration: 8,
        tips: 'No llenes la olla.',
        warning: 'Evita salpicaduras.',
        illustration: null
      }))
    ])
  );
  const canonicalProposal = {
    name: recipe.name,
    description: 'Fixture sintético para comprobar navegación y deep links.',
    difficulty: 'easy',
    cuisine: null,
    totalTime: 15,
    prepTime: 5,
    cookTime: 10,
    restTime: null,
    baseServings: 1,
    calories: null,
    ingredients: [
      {
        name: 'Garbanzos QA',
        quantity: 120,
        unit: 'g',
        preparation: 'enjuagados',
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    utensils: [],
    guidance: {
      appliances: [],
      parallelTasks: [],
      tipsAndVariations: [],
      batchCookingWarning: null
    },
    instructionsByLevel: canonicalSteps,
    nutrition: null,
    storage: null,
    tags: []
  };

  try {
    await page.route('**/api/ai/improve-recipe', async (route) => {
      improveRequests.push(route.request().postDataJSON() as Record<string, any>);
      if (firstImproveAttempt) {
        firstImproveAttempt = false;
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, code: 'PROVIDER_ERROR' })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            proposal: canonicalProposal,
            patch: { instructionsByLevel: canonicalSteps },
            scopes: ['preparation']
          }
        })
      });
    });
    await page.route('**/api/recipes/step-photos?scene=**', async (route) => {
      photoScenes.push(new URL(route.request().url()).searchParams.get('scene') ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: null })
      });
    });
    await page.route('**/api/recipes/step-videos/search**', async (route) => {
      videoScenes.push(new URL(route.request().url()).searchParams.get('scene') ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] })
      });
    });
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        new URL(request.url()).pathname === `/api/recipes/${recipe.id}`
      ) {
        patchRequests.push(request.url());
      }
    });

    await openEditor(page, recipe.id);
    await page.locator('[data-test="recipe-improve-open"] button').click();
    const dialog = page.getByRole('dialog', { name: 'Mejorar receta' });
    await expect(dialog).toBeVisible();
    const checkboxes = dialog.getByRole('checkbox');
    await checkboxes.nth(3).check();
    await checkboxes.last().check();

    const failedImproveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/ai/improve-recipe'
    );
    await dialog.getByRole('button', { name: 'Proponer cambios', exact: true }).click();
    expect((await failedImproveResponse).status()).toBe(502);
    const retry = dialog.locator('[data-test="recipe-improve-retry"] button');
    await expect(retry).toHaveText('Reintentar propuesta');
    const improveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/ai/improve-recipe'
    );
    await retry.click();
    expect((await improveResponse).ok()).toBeTruthy();
    await expect
      .poll(() => dialog.locator('.modal__body').evaluate((body) => body.scrollTop))
      .toBe(0);
    await expect(dialog).toContainText('Corta la calabaza en dados uniformes.');
    await expect(dialog).toContainText('12 min');
    await expect(dialog).toContainText('180 °C');
    await expect(dialog).toContainText('Temporizador · 8 min');
    await expect(dialog).toContainText('Consejo: No llenes la olla.');
    await expect(dialog).toContainText('Aviso: Evita salpicaduras.');
    expect(improveRequests).toHaveLength(2);
    expect(improveRequests[0].scopes).toEqual(['preparation']);
    expect(improveRequests[0].recipe.baseServings).toBe(1);
    expect(improveRequests[0].recipe.servings).toBe(2);
    expect(JSON.stringify(improveRequests[0])).not.toContain(recipe.id);
    expect(JSON.stringify(improveRequests[0])).not.toContain('household');

    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'mobile-chrome') {
      const directory = resolveScreenshotDirectory('.e2e-screenshots/recipe-editor');
      mkdirSync(directory, { recursive: true });
      const device = testInfo.project.name === 'chromium' ? 'desktop' : 'mobile';
      await page.screenshot({
        path: resolve(directory, `improve-review-${device}.png`),
        animations: 'disabled'
      });
    }

    const photoSearch = page.waitForResponse((response) =>
      response.url().includes('/api/recipes/step-photos?scene=cut')
    );
    const videoSearch = page.waitForResponse((response) =>
      response.url().includes('/api/recipes/step-videos/search?scene=cut')
    );
    await dialog.getByRole('button', { name: 'Aplicar al borrador', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await photoSearch).ok()).toBeTruthy();
    expect((await videoSearch).ok()).toBeTruthy();
    expect(photoScenes.at(-1)).toBe('cut');
    expect(videoScenes).toContain('cut');
    expect(photoScenes.every((scene) => allowedScenes.includes(scene))).toBeTruthy();
    expect(videoScenes.every((scene) => allowedScenes.includes(scene))).toBeTruthy();
    expect(patchRequests).toHaveLength(0);
    await selectEditorTab(page, 'Preparación');
    await selectInstructionLevel(page, 'basic');
    await expect(page.locator('#step-instruction-basic-0')).toHaveValue(
      'Corta la calabaza en dados uniformes.'
    );
    await expect(page.locator('#step-duration-basic-0')).toHaveValue('12');
    await expect(page.locator('#step-temperature-basic-0')).toHaveValue('180');
    await expect(page.locator('#step-timer-duration-basic-0')).toHaveValue('8');
    await expect(page.locator('#step-tips-basic-0')).toHaveValue('No llenes la olla.');
    await expect(page.locator('#step-warning-basic-0')).toHaveValue('Evita salpicaduras.');

    const persistedBeforeSave = await page.request.get(`/api/recipes/${recipe.id}`, { headers });
    const beforeSave = (await persistedBeforeSave.json()) as { data: Record<string, any> };
    expect(beforeSave.data.instructionsByLevel.basic[0].instruction).toBe(
      detailedFixture.instructionsByLevel.basic[0].instruction
    );

    await selectEditorTab(page, 'Datos');
    await page.getByRole('checkbox', { name: 'Almuerzo' }).check();
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/recipes/${recipe.id}`
    );
    await page.locator('[data-test="recipe-editor-save"] button').click();
    expect((await saveResponse).ok()).toBeTruthy();
    expect(patchRequests).toHaveLength(1);

    const persistedAfterSave = await page.request.get(`/api/recipes/${recipe.id}`, { headers });
    const afterSave = (await persistedAfterSave.json()) as { data: Record<string, any> };
    expect(afterSave.data.instructionsByLevel.basic[0].instruction).toBe(
      'Corta la calabaza en dados uniformes.'
    );
    expect(afterSave.data.instructionsByLevel.expert[0].instruction).toContain('brunoise regular');
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('la búsqueda de fotos anuncia vacío/error, permite reintentar e ignora resultados obsoletos', async ({
  page
}, testInfo) => {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 1000 }
      : { width: 393, height: 852 };
  await page.setViewportSize(viewport);

  let retryCount = 0;
  let announceStaleRequest!: () => void;
  let releaseStaleResponse!: () => void;
  let finishStaleResponse!: () => void;
  const staleRequestStarted = new Promise<void>((resolveStarted) => {
    announceStaleRequest = resolveStarted;
  });
  const staleResponseGate = new Promise<void>((resolveResponse) => {
    releaseStaleResponse = resolveResponse;
  });
  const staleResponseFinished = new Promise<void>((resolveFinished) => {
    finishStaleResponse = resolveFinished;
  });
  const queries: string[] = [];
  const photoResponse = (id: string, author: string) => ({
    success: true,
    data: [
      {
        id,
        altText: `Foto de prueba: ${author}`,
        author,
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: `https://commons.wikimedia.org/wiki/File:${author}.jpg`,
        previewUrl: `/api/recipe-photo-previews/${id}`
      }
    ]
  });
  await page.route('**/api/recipes/step-photos/search**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    queries.push(query);

    if (query === 'consulta antigua') {
      announceStaleRequest();
      await staleResponseGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(photoResponse('a'.repeat(24), 'Resultado obsoleto'))
        });
      } catch {
        // Angular may cancel the old XHR after the next keystroke; either way its data is stale.
      } finally {
        finishStaleResponse();
      }
      return;
    }

    if (query === 'sin coincidencias') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] })
      });
      return;
    }

    if (query === 'fallo temporal' && retryCount++ === 0) {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: '{"success":false}'
      });
      return;
    }

    const author = query === 'consulta actual' ? 'Resultado vigente' : 'Foto recuperada';
    const id = query === 'consulta actual' ? 'c'.repeat(24) : 'b'.repeat(24);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(photoResponse(id, author))
    });
  });
  await page.route('**/api/recipe-photo-previews/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZkAAAAASUVORK5CYII=',
        'base64'
      )
    })
  );
  await stubAutomaticStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'recipe-photo-search-states');
  const recipe = await createSyntheticRecipe(page, detailedFixture);
  try {
    await openEditor(page, recipe.id);
    await selectEditorTab(page, 'Multimedia');
    const query = page.locator('#editor-photo-search');
    const results = page.locator('[data-test="recipe-photo-results"]');

    await query.fill('sin coincidencias');
    await expect(page.getByRole('status')).toContainText(
      'No se han encontrado fotos con licencia y atribución verificables.'
    );
    await expect(page.locator('[data-test="recipe-editor-save"] button')).toBeEnabled();

    await query.fill('fallo temporal');
    const searchAlert = page.locator('.editor-photo-search__error');
    await expect(searchAlert).toContainText('No se pudo buscar ahora.');
    await expect(page.locator('.toast.toast--error')).toHaveCount(0);
    const retryButton = searchAlert.getByRole('button', { name: 'Reintentar búsqueda' });
    await retryButton.focus();
    await expect(retryButton).toBeFocused();
    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'mobile-chrome') {
      const directory = resolveScreenshotDirectory('.e2e-screenshots/recipe-photo-search-states');
      mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: resolve(directory, `${testInfo.project.name}-failure.png`),
        fullPage: false,
        animations: 'disabled'
      });
    }
    await retryButton.press('Enter');
    await expect(results).toContainText('Foto recuperada');

    await query.fill('consulta antigua');
    await staleRequestStarted;
    await query.fill('consulta actual');
    await expect(results).toContainText('Resultado vigente');
    releaseStaleResponse();
    await staleResponseFinished;
    await expect(results).toContainText('Resultado vigente');
    await expect(results).not.toContainText('Resultado obsoleto');
    expect(queries).toEqual([
      'sin coincidencias',
      'fallo temporal',
      'fallo temporal',
      'consulta antigua',
      'consulta actual'
    ]);
  } finally {
    releaseStaleResponse();
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('crea una receta manual solo al guardar y mantiene privada la receta nueva', async ({
  page
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 1000 }
      : { width: 393, height: 852 }
  );
  await registerWithHousehold(page, '/recipes', 'recipe-editor-create');
  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token).toBeTruthy();
  const createRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api/recipes')) {
      createRequests.push(request.url());
    }
  });
  let created: { id: string; name: string; token: string } | undefined;

  try {
    await expect(page.locator('[data-test="recipe-list-view"]')).toBeVisible();
    await expect(page.locator('[data-test="recipe-create-action"]')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Libro de recetas', exact: true }).click();
    await expect(page.locator('[data-test="recipe-create-action"]')).toBeVisible();
    await page.locator('[data-test="recipe-create-action"] button').click();
    await expect(page).toHaveURL(/\/recipes\/new$/);
    await expect(page.locator('[data-test="recipe-editor-form"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nueva receta' })).toBeFocused();
    expect(createRequests).toHaveLength(0);
    if (testInfo.project.name === 'chromium') {
      await expect(page.locator('[data-test="recipe-editor-cover-sidebar"]')).toBeVisible();
    } else if (testInfo.project.name === 'mobile-chrome') {
      const mobileCoverAction = page.locator('[data-test="recipe-editor-mobile-cover-edit"]');
      await expect(mobileCoverAction).toBeVisible();
      await mobileCoverAction.click();
      await expect(page.locator('[data-test="editor-panel-media"]')).toBeVisible();
      await expect(page.locator('#editor-image')).toBeFocused();
      await selectEditorTab(page, 'Datos');
    }

    await page.goto('/recipes/new');
    await expect(page.locator('[data-test="recipe-editor-form"]')).toBeVisible();
    expect(createRequests).toHaveLength(0);
    await page.locator('.recipe-editor__actions app-button:first-child button').click();
    await expect(page.locator('[data-test="recipe-list-view"]')).toBeVisible();
    expect(createRequests).toHaveLength(0);
    await page.getByRole('tab', { name: 'Libro de recetas', exact: true }).click();
    await page.locator('[data-test="recipe-create-action"] button').click();
    await expect(page).toHaveURL(/\/recipes\/new$/);

    const recipeName = `Crema manual QA ${Date.now()}`;
    await page.locator('#editor-name').fill(recipeName);
    await page.locator('#editor-total-time').fill('30');
    await page.locator('#editor-prep-time').fill('10');
    await page.getByRole('checkbox', { name: 'Cena' }).check();
    await selectEditorTab(page, 'Ingredientes');
    await page.locator('#ingredient-name-0').fill('Calabaza QA');
    await page.locator('#ingredient-quantity-0').fill('400');
    await selectEditorTab(page, 'Preparación');
    await page.locator('#step-instruction-basic-0').fill('Pela y trocea la calabaza.');
    await selectInstructionLevel(page, 'intermediate');
    await page
      .locator('#step-instruction-intermediate-0')
      .fill('Corta la calabaza en dados uniformes.');
    await selectInstructionLevel(page, 'expert');
    await page
      .locator('#step-instruction-expert-0')
      .fill('Corta en dados regulares para una cocción homogénea.');
    expect(createRequests).toHaveLength(0);

    if (testInfo.project.name === 'chromium' || testInfo.project.name === 'mobile-chrome') {
      const directory = resolveScreenshotDirectory('.e2e-screenshots/recipe-editor');
      mkdirSync(directory, { recursive: true });
      const device = testInfo.project.name === 'chromium' ? 'desktop' : 'mobile';
      await page.screenshot({
        path: resolve(directory, `create-${device}.png`),
        animations: 'disabled'
      });

      await page.locator('[data-test="recipe-improve-open"] button').click();
      const improveDialog = page.getByRole('dialog', { name: 'Mejorar receta' });
      await expect(improveDialog).toBeVisible();
      const scopeCheckboxes = improveDialog.getByRole('checkbox');
      await scopeCheckboxes.first().check();
      await scopeCheckboxes.last().check();
      expect(createRequests).toHaveLength(0);
      await page.screenshot({
        path: resolve(directory, `improve-${device}.png`),
        animations: 'disabled'
      });
      await improveDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(improveDialog).toBeHidden();
    }

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/api/recipes')
    );
    await page.locator('[data-test="recipe-editor-save"] button').click();
    const response = await createResponse;
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { data: { id: string; isPublic: boolean } };
    created = { id: body.data.id, name: recipeName, token: token! };
    expect(body.data.isPublic).toBe(false);
    expect(createRequests).toHaveLength(1);
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();
    await expect(page.locator('[data-test="recipe-detail-title"]')).toHaveText(recipeName);

    const persisted = await page.request.get(`/api/recipes/${created.id}`, {
      headers: { authorization: `Bearer ${created.token}` }
    });
    const saved = (await persisted.json()) as { data: Record<string, any> };
    expect(saved.data.author).toBe('user');
    expect(saved.data.authorId).toBeTruthy();
    expect(saved.data.instructionsByLevel.basic[0].instruction).toBe('Pela y trocea la calabaza.');
  } finally {
    if (created) await deleteSyntheticRecipe(page, created);
  }
});

test('edita una receta histórica sin inventarle niveles de preparación', async ({ page }) => {
  await registerWithHousehold(page, '/recipes', 'recipe-editor-legacy');
  const recipe = await createSyntheticRecipe(page, {
    name: `Receta legacy QA ${Date.now()}`,
    ingredients: [{ name: 'Tomate legacy QA', quantity: 1, unit: 'unit' }]
  });
  try {
    await openEditor(page, recipe.id);
    await selectEditorTab(page, 'Preparación');
    await expect(page.getByText('Esta receta conserva una sola lista de pasos.')).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Nivel de detalle de los pasos' })).toHaveCount(
      0
    );
    await page.locator('#step-instruction-legacy-0').fill('Corta el tomate en dados pequeños.');
    await selectEditorTab(page, 'Datos');
    await page.getByRole('checkbox', { name: 'Almuerzo' }).check();
    await selectEditorTab(page, 'Preparación');
    await page.locator('[data-test="recipe-editor-save"] button').click();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();

    const response = await page.request.get(`/api/recipes/${recipe.id}`, {
      headers: { authorization: `Bearer ${recipe.token}` }
    });
    expect(response.ok()).toBeTruthy();
    const saved = (await response.json()) as { data: Record<string, any> };
    expect(saved.data.steps[0].instruction).toBe('Corta el tomate en dados pequeños.');
    expect(saved.data.instructionsByLevel).toBeUndefined();
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('el calor es opcional y quitarlo deja el paso guardado sin temperatura', async ({
  page
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 1000 }
      : { width: 393, height: 852 }
  );
  await registerWithHousehold(page, '/recipes', 'recipe-editor-optional-temperature');
  const recipe = await createSyntheticRecipe(page, {
    ...detailedFixture,
    name: `Receta sin calor QA ${Date.now()}`,
    instructionsByLevel: {
      basic: [{ stepNumber: 1, instruction: 'Mezcla y sirve frío.' }],
      intermediate: [{ stepNumber: 1, instruction: 'Integra los ingredientes y sirve.' }],
      expert: [{ stepNumber: 1, instruction: 'Combina y presenta al momento.' }]
    }
  });
  const headers = { authorization: `Bearer ${recipe.token}` };

  try {
    await openEditor(page, recipe.id);
    await selectEditorTab(page, 'Preparación');
    await selectInstructionLevel(page, 'basic');
    await expect(page.locator('#step-temperature-basic-0')).toHaveCount(0);
    const addTemperature = page.getByRole('button', { name: /Añadir temperatura/ });
    await addTemperature.focus();
    await expect(addTemperature).toBeFocused();
    await page.keyboard.press('Enter');
    await page.locator('#step-temperature-basic-0').fill('5');
    const removeTemperature = page.getByRole('button', {
      name: 'Quitar temperatura',
      exact: true
    });
    await removeTemperature.focus();
    await expect(removeTemperature).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#step-temperature-basic-0')).toHaveCount(0);
    const screenshotDirectory = resolveScreenshotDirectory('.e2e-screenshots/recipe-editor');
    mkdirSync(screenshotDirectory, { recursive: true });
    const device = testInfo.project.name === 'chromium' ? 'desktop' : 'mobile';
    await page.locator('.editor-item.editor-step').first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(screenshotDirectory, `optional-temperature-${device}.png`),
      animations: 'disabled'
    });
    await selectEditorTab(page, 'Datos');
    await page.getByRole('checkbox', { name: 'Almuerzo' }).check();
    await page.locator('[data-test="recipe-editor-save"] button').click();
    await expect(page.locator('[data-test="recipe-detail-page"]')).toBeVisible();

    const response = await page.request.get(`/api/recipes/${recipe.id}`, { headers });
    const saved = (await response.json()) as { data: Record<string, any> };
    expect(response.ok()).toBeTruthy();
    expect(saved.data.instructionsByLevel.basic[0].temperature).toBeUndefined();
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('the recipe editor follows Pencil desktop cover and mobile tab layout', async ({
  page
}, testInfo) => {
  const desktop = testInfo.project.name === 'chromium';
  await page.setViewportSize(desktop ? { width: 1440, height: 980 } : { width: 390, height: 844 });
  await stubAutomaticStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'recipe-editor-pencil-layout');
  const recipe = await createSyntheticRecipe(page, detailedFixture);

  try {
    await openEditor(page, recipe.id);
    const tabs = page.locator('[data-test="recipe-editor-tabs"]');
    const coverSidebar = page.locator('[data-test="recipe-editor-cover-sidebar"]');
    const visiblePanels = page.locator('[data-test^="editor-panel-"]:visible');
    const screenshotDirectory = resolveScreenshotDirectory('.e2e-screenshots/recipe-editor');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `pencil-layout-${desktop ? 'desktop' : 'mobile'}.png`),
      animations: 'disabled'
    });

    await expect(page.locator('[data-test="editor-panel-basics"]')).toBeVisible();
    await expect(visiblePanels).toHaveCount(1);

    if (desktop) {
      await expect(coverSidebar).toBeVisible();
      const geometry = await page.evaluate(() => {
        const editor = document
          .querySelector<HTMLElement>('.recipe-editor')!
          .getBoundingClientRect();
        const main = document
          .querySelector<HTMLElement>('[data-test="recipe-editor-main"]')!
          .getBoundingClientRect();
        const sidebar = document
          .querySelector<HTMLElement>('[data-test="recipe-editor-cover-sidebar"]')!
          .getBoundingClientRect();
        return {
          editorLeft: editor.left,
          mainLeft: main.left,
          mainWidth: main.width,
          mainRight: main.right,
          sidebarLeft: sidebar.left,
          sidebarWidth: sidebar.width
        };
      });

      // Pencil PC: content 746 px + 18 px gutter + 326 px cover column.
      expect(Math.abs(geometry.mainLeft - geometry.editorLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.mainWidth - 746)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.sidebarLeft - geometry.mainRight - 18)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.sidebarWidth - 326)).toBeLessThanOrEqual(1);

      await page.locator('[data-test="recipe-editor-cover-edit"] button').click();
      await expect(page.locator('[data-test="editor-panel-media"]')).toBeVisible();
      await expect(page.locator('#editor-image')).toBeFocused();
    } else {
      await expect(coverSidebar).toBeHidden();
      const mobileGeometry = await page.evaluate(() => {
        const main = document
          .querySelector<HTMLElement>('[data-test="recipe-editor-main"]')!
          .getBoundingClientRect();
        const panel = document
          .querySelector<HTMLElement>('[data-test="editor-panel-basics"]')!
          .getBoundingClientRect();
        return {
          mainLeft: main.left,
          mainWidth: main.width,
          panelLeft: panel.left,
          panelWidth: panel.width
        };
      });
      expect(Math.abs(mobileGeometry.mainLeft - 16)).toBeLessThanOrEqual(1);
      expect(Math.abs(mobileGeometry.mainWidth - 358)).toBeLessThanOrEqual(1);
      expect(Math.abs(mobileGeometry.panelLeft - 16)).toBeLessThanOrEqual(1);
      expect(Math.abs(mobileGeometry.panelWidth - 358)).toBeLessThanOrEqual(1);
      const tabGeometry = await tabs.locator('[role="tab"]').evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        })
      );
      expect(
        Math.max(...tabGeometry.map(({ top }) => top)) -
          Math.min(...tabGeometry.map(({ top }) => top))
      ).toBeLessThanOrEqual(1);
      expect(tabGeometry.every(({ height }) => height >= 44)).toBeTruthy();
      expect(await tabs.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
        await tabs.evaluate((element) => element.clientWidth)
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        )
      ).toBeTruthy();

      await tabs.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect(page.getByRole('tab', { name: 'Multimedia', exact: true })).toBeInViewport();
    }

    await selectEditorTab(page, 'Preparación');
    await expect(page.locator('[data-test="editor-panel-instructions"]')).toBeVisible();
    await expect(visiblePanels).toHaveCount(1);
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});

test('the direct editor route preserves shared content geometry at phone and landscape widths', async ({
  page
}) => {
  await stubAutomaticStepPhotos(page);
  await registerWithHousehold(page, '/recipes', 'recipe-editor-responsive');
  const recipe = await createSyntheticRecipe(page, detailedFixture);
  try {
    for (const viewport of [
      { width: 320, height: 700 },
      { width: 393, height: 852 },
      { width: 568, height: 320 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(`/recipes/${recipe.id}/edit`);
      await expect(page.locator('[data-test="recipe-editor-form"]')).toBeVisible();
      await selectEditorTab(page, 'Preparación');
      await selectInstructionLevel(page, 'basic');
      const widths = await page.evaluate(() => ({
        body: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            right: Math.round(element.getBoundingClientRect().right * 100) / 100,
            left: Math.round(element.getBoundingClientRect().left * 100) / 100
          }))
          .filter((element) => element.right > window.innerWidth + 1)
          .sort((left, right) => right.right - left.right)
          .slice(0, 12),
        scrollOverflow: Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === 'string' ? element.className : '',
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth
          }))
          .sort(
            (left, right) =>
              right.scrollWidth - right.clientWidth - (left.scrollWidth - left.clientWidth)
          )
          .slice(0, 12),
        inlineControls: Array.from(document.querySelectorAll<HTMLElement>('.editor-inline-inputs'))
          .filter((container) => container.getClientRects().length > 0)
          .map((container) => {
            const containerRight = container.getBoundingClientRect().right;
            return Array.from(container.children).map((child) => ({
              tag: child.tagName.toLowerCase(),
              right: child.getBoundingClientRect().right,
              containerRight
            }));
          })
          .flat(),
        editor: (() => {
          const rect = document.querySelector('.recipe-editor')!.getBoundingClientRect();
          return { left: rect.left, width: rect.width };
        })()
      }));
      expect(
        widths.scroll,
        `sin overflow en ${viewport.width}x${viewport.height}; elementos=${JSON.stringify(widths.scrollOverflow)}`
      ).toBeLessThanOrEqual(widths.body);
      expect(widths.editor.width).toBeLessThanOrEqual(widths.body);
      for (const control of widths.inlineControls) {
        expect(
          control.right,
          `${control.tag} queda dentro de su fila en ${viewport.width}×${viewport.height}`
        ).toBeLessThanOrEqual(control.containerRight + 1);
      }

      await page.goto('/recipes');
      await expect(page.locator('[data-test="recipe-list-view"]')).toBeVisible();
      const list = await page.locator('.recipes').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      });
      expect(
        Math.abs(widths.editor.left - list.left),
        `margen izquierdo coherente en ${viewport.width}px`
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(widths.editor.width - list.width),
        `ancho de contenido coherente en ${viewport.width}px`
      ).toBeLessThanOrEqual(1);
    }
  } finally {
    await deleteSyntheticRecipe(page, recipe);
  }
});
