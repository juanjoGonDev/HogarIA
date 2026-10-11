import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, registerUser } from './helpers/auth';

const SYNTHETIC_PLAN_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
  'base64'
);

async function screenshot(page: Page, name: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  if (viewport.width > 767) await page.evaluate(() => window.scrollTo(0, 0));
  const root = process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), '.e2e-screenshots');
  const path = join(root, 'household-plan-tasks', test.info().project.name, `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: viewport.width > 767, animations: 'disabled' });
}

async function tabGeometry(page: Page, name: string) {
  return page.getByRole('tab', { name }).evaluate((tab) => {
    const rect = tab.getBoundingClientRect();
    const style = getComputedStyle(tab);
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      gap: style.gap,
      font: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight],
      borderRadius: style.borderRadius
    };
  });
}

async function choosePickerOption(
  page: Page,
  labelPattern: RegExp,
  optionName: string
): Promise<void> {
  await page.getByRole('button', { name: labelPattern }).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

test('plano por hogar, propuesta revisable y tareas semanales zonificadas en PC y móvil', async ({
  page,
  browser
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chrome';
  const viewport = mobile ? { width: 393, height: 851 } : { width: 1440, height: 900 };

  await registerUser(page, 'Administradora sintética del plano');
  await createHousehold(page, 'Hogar sintético de plano y tareas');
  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
  expect(inviteCode).toBeTruthy();

  const memberContext = await browser.newContext({ locale: 'es-ES' });
  const memberPage = await memberContext.newPage();
  try {
    await registerUser(memberPage, 'Miembro sintético del hogar');
    await memberPage.goto('/household');
    await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
    const joinDialog = memberPage.getByRole('dialog', { name: 'Unirse a un Hogar' });
    await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
    await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(memberPage.locator('.household-info__name')).toHaveText(
      'Hogar sintético de plano y tareas'
    );
  } finally {
    // Keep the second synthetic account active in the household; only close its browser context.
    await memberContext.close();
  }

  await page.reload();
  await expect(page.locator('.member-card')).toHaveCount(2);
  const activeMemberNames = await page.locator('.member-card__name').allTextContents();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(page.locator('[data-test="household-panel-plan"]')).toBeVisible();
  await expect(page.locator('.plan-canvas')).toHaveAttribute('role', 'group');
  await expect(page.locator('.plan-file input')).toHaveAttribute(
    'accept',
    'image/jpeg,image/png,image/webp,application/pdf'
  );

  await choosePickerOption(page, /Tipo de zona:/, 'Cocina');
  await page.getByRole('button', { name: 'Añadir al plano' }).click();
  const areaName = page.getByLabel('Nombre visible');
  await expect(areaName).toHaveValue('Cocina');
  await areaName.fill('Cocina QA');
  const savePlan = page.getByRole('button', { name: 'Guardar plano' });
  await expect(savePlan).toBeEnabled();
  const planSaveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/plan')
  );
  await savePlan.click();
  const savedPlanResponse = await planSaveResponse;
  expect(savedPlanResponse.status()).toBe(200);
  let savedPlanEnvelope = await savedPlanResponse.json();
  let savedPlan = savedPlanEnvelope.data.plan as {
    schemaVersion: 1;
    dwellingType: string;
    dwellingTypeLabel: string | null;
    summary: string;
    warnings: string[];
    floors: Array<{
      id: string;
      name: string;
      level: number;
      walls: unknown[];
      openings: Array<{ isMainEntrance: boolean }>;
      spaces: Array<{
        id: string;
        kind: string;
        label: string;
        polygon: Array<{ x: number; y: number }>;
        parentSpaceId: string | null;
      }>;
    }>;
  };
  expect(savedPlan.floors[0]?.spaces[0]?.label).toBe('Cocina QA');
  const kitchenId = savedPlan.floors[0].spaces[0].id;
  await expect(page.locator('.plan-details__area.is-selected')).toContainText('Cocina QA');

  await page.getByRole('button', { name: 'Dibujar pared' }).click();
  await choosePickerOption(page, /Tipo de pared:/, 'Pared exterior');
  const canvas = page.locator('.plan-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  const wallStart = {
    x: canvasBounds!.x + canvasBounds!.width * 0.15,
    y: canvasBounds!.y + canvasBounds!.height * 0.68
  };
  const wallEnd = {
    x: canvasBounds!.x + canvasBounds!.width * 0.85,
    y: wallStart.y
  };
  await page.mouse.move(wallStart.x, wallStart.y);
  await page.mouse.down();
  await page.mouse.move(wallEnd.x, wallEnd.y, { steps: 4 });
  await page.mouse.up();
  await expect(canvas.locator('.plan-canvas__wall--exterior')).toHaveCount(1);
  const wallDetails = page.locator('[data-test="plan-wall-details"]');
  await expect(wallDetails).toBeVisible();
  await wallDetails.getByRole('button', { name: 'Añadir puerta', exact: true }).click();
  await expect(canvas.locator('.plan-canvas__entrance-mark')).toHaveCount(1);

  const vectorSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/plan')
  );
  await savePlan.click();
  const vectorResponse = await vectorSave;
  expect(vectorResponse.status()).toBe(200);
  savedPlanEnvelope = await vectorResponse.json();
  savedPlan = savedPlanEnvelope.data.plan;
  expect(savedPlan.floors[0].walls).toHaveLength(1);
  expect(savedPlan.floors[0].openings[0].isMainEntrance).toBe(true);

  const canvasSpace = canvas.locator('[data-space-id]').first();
  if (mobile) await canvasSpace.tap();
  else await canvasSpace.click();
  await expect(canvasSpace).toHaveClass(/plan-canvas__space--selected/);
  await canvasSpace.focus();
  await page.keyboard.press('Enter');
  await expect(canvasSpace).toHaveClass(/plan-canvas__space--selected/);

  await screenshot(page, 'plan-desktop-or-mobile', viewport);
  if (mobile) {
    await page.locator('.plan-canvas').scrollIntoViewIfNeeded();
    await screenshot(page, 'plan-canvas-mobile', viewport);
  }

  await page.getByRole('button', { name: 'Añadir planta' }).click();
  const floorPicker = page.getByRole('button', { name: /Planta: Planta 1/ });
  await expect(floorPicker).toBeVisible();
  const removeFloorButton = page.getByRole('button', { name: 'Eliminar planta' });
  await removeFloorButton.click();
  const floorConfirmation = page.getByRole('dialog', { name: 'Eliminar esta planta' });
  await expect(floorConfirmation).toContainText('Planta 1');
  await expect
    .poll(() => floorConfirmation.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(floorConfirmation).toBeHidden();
  await expect(floorPicker).toBeVisible();
  await removeFloorButton.click();
  await floorConfirmation.getByRole('button', { name: 'Eliminar planta' }).click();
  await expect(floorConfirmation).toBeHidden();
  await expect(page.getByRole('button', { name: /Planta: Planta baja/ })).toBeVisible();

  await choosePickerOption(page, /Tipo de zona:/, 'Baño');
  await page.getByRole('button', { name: 'Añadir al plano' }).click();
  await page.getByLabel('Nombre visible').fill('Borrador QA');
  await expect(savePlan).toBeEnabled();
  await page.getByRole('tab', { name: 'Tareas' }).click();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(page.getByRole('button', { name: 'Borrador QA', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.getByRole('button', { name: 'Borrador QA', exact: true })).toHaveCount(0);

  // This browser-level stub exercises the upload/review UI without contacting an AI provider.
  // Real request_format, geometry validation, and persistence are covered by isolated server tests.
  const proposedPlan = structuredClone(savedPlan);
  proposedPlan.floors[0].spaces[0].label = 'Cocina renovada QA';
  let proposalRequestBody = '';
  await page.route('**/api/household/plan/proposal', async (route) => {
    proposalRequestBody = route.request().postDataBuffer()?.toString('latin1') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          baseVersion: savedPlanEnvelope.data.version,
          current: savedPlan,
          draft: savedPlan,
          proposal: proposedPlan,
          diff: { addedSpaceIds: [], modifiedSpaceIds: [kitchenId], removedSpaceIds: [] },
          orphanedTaskIds: []
        }
      })
    });
  });
  const proposalWrites: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'PUT' &&
      new URL(request.url()).pathname.endsWith('/api/household/plan')
    ) {
      proposalWrites.push(request.url());
    }
  });
  await page.locator('.plan-file input').setInputFiles({
    name: 'plano-sintetico.png',
    mimeType: 'image/png',
    buffer: SYNTHETIC_PLAN_IMAGE
  });
  await page.getByLabel('¿Qué quieres cambiar?').fill('Amplía la cocina hacia el patio');
  await page.getByRole('button', { name: 'Generar propuesta' }).click();
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeVisible();
  await expect.poll(() => proposalRequestBody).toContain('name="image"');
  expect(proposalRequestBody).toContain('name="draftPlan"');
  expect(proposalRequestBody).toContain('name="prompt"');
  expect(proposalRequestBody).toContain('plano-sintetico.png');
  await expect(page.getByRole('button', { name: 'Cocina renovada QA', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver borrador' })).toBeVisible();
  expect(proposalWrites).toHaveLength(0);
  if (mobile) await page.locator('[data-test="plan-proposal-review"]').scrollIntoViewIfNeeded();
  await screenshot(page, 'proposal-desktop-or-mobile', viewport);
  await page.getByRole('button', { name: 'Aplicar propuesta' }).click();
  await expect(page.locator('.plan-editor__message--success')).toContainText(
    'La propuesta se guardó'
  );
  await expect.poll(() => proposalWrites.length).toBe(1);
  await page.reload();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(page.getByRole('button', { name: 'Cocina renovada QA', exact: true })).toBeVisible();

  // Verify the shared tab shell is geometrically identical on the two new sections.
  const planTabGeometry = await tabGeometry(page, 'Plano');
  await page.getByRole('tab', { name: 'Tareas' }).click();
  await expect(page).toHaveURL(/[?&]tab=tasks/);
  await expect(page.locator('[data-test="household-panel-tasks"]')).toBeVisible();
  const taskTabGeometry = await tabGeometry(page, 'Plano');
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(planTabGeometry[key] - taskTabGeometry[key]),
      `${key} geometry`
    ).toBeLessThanOrEqual(1);
  }
  expect(taskTabGeometry.padding).toEqual(planTabGeometry.padding);
  expect(taskTabGeometry.margin).toEqual(planTabGeometry.margin);
  expect(taskTabGeometry.gap).toBe(planTabGeometry.gap);
  expect(taskTabGeometry.font).toEqual(planTabGeometry.font);
  expect(taskTabGeometry.borderRadius).toBe(planTabGeometry.borderRadius);

  // Opening a zone from the vector canvas routes to the same zone-filtered task view.
  await page.getByRole('tab', { name: 'Plano' }).click();
  await page.getByRole('button', { name: 'Cocina renovada QA', exact: true }).click();
  await page.getByRole('button', { name: 'Ver tareas de esta zona' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tab=tasks.*[?&]space=${kitchenId}`));
  await expect(
    page.getByRole('button', { name: /Filtrar por zona: Cocina renovada QA/ })
  ).toBeVisible();

  const taskTitles = ['Tarea cocina QA 1', 'Tarea cocina QA 2', 'Tarea cocina QA 3'];
  for (const [index, title] of taskTitles.entries()) {
    const createForm = page.locator('.tasks-create');
    await createForm.getByLabel('Nombre de la tarea').fill(title);
    await createForm.getByRole('button', { name: /^Día:/ }).click();
    await page.getByRole('option').nth(index).click();
    await createForm.getByRole('button', { name: /^Zona:/ }).click();
    await page.getByRole('option', { name: /^Cocina renovada QA/ }).click();
    await page.getByRole('button', { name: 'Añadir a la semana' }).click();
  }
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  await page.getByRole('button', { name: 'Proponer reparto' }).click();
  const preview = page.locator('[data-test="tasks-random-preview"]');
  await expect(preview).toBeVisible();
  const previewRows = preview.locator('li');
  await expect(previewRows).toHaveCount(3);
  const assignments = await previewRows.locator('strong').allTextContents();
  expect(new Set(assignments).size).toBe(2);
  expect(assignments.every((member) => activeMemberNames.includes(member))).toBe(true);
  expect(assignments[0]).not.toBe(assignments[1]);
  expect(assignments[1]).not.toBe(assignments[2]);
  const loadCounts = [...new Set(assignments)].map(
    (member) => assignments.filter((assignment) => assignment === member).length
  );
  expect(Math.max(...loadCounts) - Math.min(...loadCounts)).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-test="tasks-save"]')).toBeDisabled();
  await screenshot(page, 'tasks-random-preview-desktop-or-mobile', viewport);
  await page.getByRole('button', { name: 'Usar este reparto' }).click();
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await page.getByRole('tab', { name: 'Tareas' }).click();
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  await expect(page.locator('.task-card')).toHaveCount(3);
  const saveTasksResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/tasks')
  );
  await page.getByRole('button', { name: 'Guardar semana' }).click();
  const tasksResponse = await saveTasksResponse;
  expect(tasksResponse.status()).toBe(200);
  const savedTasksEnvelope = await tasksResponse.json();
  expect(savedTasksEnvelope.data.tasks).toHaveLength(3);
  expect(
    savedTasksEnvelope.data.tasks.every((task: { spaceId: string }) => task.spaceId === kitchenId)
  ).toBe(true);
  await expect(page.locator('.task-card')).toHaveCount(3);
  if (mobile) await page.locator('.tasks-days').scrollIntoViewIfNeeded();
  await screenshot(page, 'tasks-saved-desktop-or-mobile', viewport);
  if (mobile) await screenshot(page, 'tasks-agenda-mobile', viewport);

  // A field-level edit remains a local draft until saving and persists on reload.
  const editedTitle = 'Tarea cocina QA editada';
  await page
    .locator('.task-card')
    .first()
    .locator('.task-card__fields input')
    .first()
    .fill(editedTitle);
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  const editSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/tasks')
  );
  await page.getByRole('button', { name: 'Guardar semana' }).click();
  expect((await editSave).status()).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Tareas' }).click();
  await expect(page.locator('.task-card')).toHaveCount(3);
  await expect(page.locator('.task-card').filter({ hasText: editedTitle })).toHaveCount(1);

  // Keyboard tab navigation, focus visibility, orientation, breakpoints, and minimum width.
  const planTab = page.getByRole('tab', { name: 'Plano' });
  const tasksTab = page.getByRole('tab', { name: 'Tareas' });
  await planTab.click();
  await planTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(tasksTab).toBeFocused();
  await expect(tasksTab).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => tasksTab.evaluate((tab) => getComputedStyle(tab).outlineStyle))
    .toBe('solid');

  for (const size of [
    { width: 320, height: 568 },
    { width: 359, height: 740 },
    { width: 360, height: 800 },
    { width: 639, height: 900 },
    { width: 640, height: 900 },
    { width: 767, height: 900 },
    { width: 768, height: 900 },
    { width: 1023, height: 900 },
    { width: 1024, height: 900 },
    { width: 568, height: 320 }
  ]) {
    await page.setViewportSize(size);
    const overflowDiagnostics = await page.evaluate((viewportWidth) => {
      const elements = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: typeof element.className === 'string' ? element.className : '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth
          };
        })
        .filter((element) => element.width > 0 && element.right > viewportWidth + 1)
        .sort((left, right) => right.right - left.right)
        .slice(0, 8);
      return {
        documentWidth: document.documentElement.scrollWidth,
        elements,
        overflowingPickers: Array.from(document.querySelectorAll<HTMLElement>('app-picker'))
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const parent = element.parentElement;
            return {
              id: element.id,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              parentClass: parent?.className ?? '',
              parentWidth: Math.round(parent?.getBoundingClientRect().width ?? 0)
            };
          })
          .filter((picker) => picker.right > viewportWidth + 1),
        pickerAncestors: (() => {
          const picker = document.querySelector<HTMLElement>(
            'app-picker#household-tasks-filter-area'
          );
          const ancestors: Array<Record<string, string | number>> = [];
          let element: HTMLElement | null = picker;
          while (element && ancestors.length < 7) {
            const rect = element.getBoundingClientRect();
            ancestors.push({
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === 'string' ? element.className : '',
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              paddingLeft: getComputedStyle(element).paddingLeft,
              boxSizing: getComputedStyle(element).boxSizing
            });
            element = element.parentElement;
          }
          return ancestors;
        })()
      };
    }, size.width);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
        message: `${size.width}px viewport overflow: ${JSON.stringify(overflowDiagnostics)}`
      })
      .toBeLessThanOrEqual(size.width);
    await expect(page.locator('[data-test="household-panel-tasks"]')).toBeVisible();
    await expect(page.locator('[data-test="tasks-week"]')).toBeVisible();
  }
});
