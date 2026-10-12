import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { createHousehold, registerUser } from './helpers/auth';
import type {
  HouseholdPlan,
  HouseholdPlanPoint
} from '../../frontend/src/app/shared/models/household-plan.model';

function landscapePlan(source: HouseholdPlan): HouseholdPlan {
  const plan = structuredClone(source);
  for (const floor of plan.floors) {
    const points = [
      ...floor.spaces.flatMap((space) => space.polygon),
      ...floor.walls.flatMap((wall) => [wall.from, wall.to])
    ];
    if (!points.length) continue;

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const scaleX = Math.min(1.35, 9600 / Math.max(1, maxX - minX));
    const scaleY = Math.min(1, 9000 / Math.max(1, maxY - minY));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const transformPoint = (point: HouseholdPlanPoint): HouseholdPlanPoint => ({
      x: Math.round(5000 + (point.x - centerX) * scaleX),
      y: Math.round(5000 + (point.y - centerY) * scaleY)
    });
    const originalWalls = structuredClone(floor.walls);
    floor.spaces = floor.spaces.map((space) => ({
      ...space,
      polygon: space.polygon.map(transformPoint)
    }));
    floor.walls = floor.walls.map((wall) => ({
      ...wall,
      from: transformPoint(wall.from),
      to: transformPoint(wall.to)
    }));
    floor.openings = floor.openings.map((opening) => {
      const originalWall = originalWalls.find((wall) => wall.id === opening.wallId);
      const transformedWall = floor.walls.find((wall) => wall.id === opening.wallId);
      if (!originalWall || !transformedWall) return opening;
      const isHorizontal = originalWall.from.y === originalWall.to.y;
      const scale = isHorizontal ? scaleX : scaleY;
      const transformedLength =
        Math.abs(transformedWall.to.x - transformedWall.from.x) +
        Math.abs(transformedWall.to.y - transformedWall.from.y);
      const offset = Math.min(Math.round(opening.offset * scale), transformedLength - 1);
      const width = Math.min(Math.round(opening.width * scale), transformedLength - offset);
      return { ...opening, offset, width: Math.max(1, width) };
    });
  }
  return plan;
}

async function syntheticPlanImage(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 400;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');

    context.fillStyle = '#b99b79';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f2eee4';
    context.fillRect(22, 20, 596, 360);
    context.strokeStyle = '#d8d0c2';
    context.lineWidth = 1;
    for (let x = 22; x <= 618; x += 24) {
      context.beginPath();
      context.moveTo(x, 20);
      context.lineTo(x, 380);
      context.stroke();
    }
    for (let y = 20; y <= 380; y += 24) {
      context.beginPath();
      context.moveTo(22, y);
      context.lineTo(618, y);
      context.stroke();
    }

    context.strokeStyle = '#26364b';
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(78, 60);
    context.lineTo(562, 60);
    context.lineTo(562, 342);
    context.lineTo(104, 342);
    context.lineTo(78, 60);
    context.moveTo(238, 60);
    context.lineTo(238, 176);
    context.lineTo(94, 176);
    context.moveTo(238, 176);
    context.lineTo(238, 342);
    context.moveTo(238, 232);
    context.lineTo(400, 232);
    context.moveTo(400, 232);
    context.lineTo(400, 342);
    context.moveTo(400, 60);
    context.lineTo(400, 232);
    context.stroke();

    context.fillStyle = '#26364b';
    context.font = '20px cursive';
    context.fillText('COCINA', 130, 126);
    context.fillText('SALÓN', 292, 147);
    context.fillText('BAÑO', 132, 214);
    context.fillText('DORMITORIO', 266, 299);
    context.fillText('PATIO', 454, 180);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function screenshot(
  page: Page,
  name: string,
  viewport: { width: number; height: number },
  scrollToTop = true
) {
  const currentViewport = page.viewportSize();
  if (
    !currentViewport ||
    currentViewport.width !== viewport.width ||
    currentViewport.height !== viewport.height
  ) {
    await page.setViewportSize(viewport);
  }
  if (scrollToTop) await page.evaluate(() => window.scrollTo(0, 0));
  const viewportState = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio
  }));
  console.info(
    `[visual:${name}] ${JSON.stringify({ viewport: page.viewportSize(), ...viewportState })}`
  );
  const root = process.env.E2E_SCREENSHOT_DIR ?? join(process.cwd(), '.e2e-screenshots');
  const path = join(root, 'household-plan-tasks', test.info().project.name, `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  const image = await page.screenshot({ fullPage: false, scale: 'css', animations: 'disabled' });
  expect(image.readUInt32BE(16), `${name} screenshot width`).toBe(viewport.width);
  expect(image.readUInt32BE(20), `${name} screenshot height`).toBe(viewport.height);
  await writeFile(path, image);
}

async function captureResponsiveScreenshot(
  page: Page,
  name: string,
  viewport: { width: number; height: number }
) {
  await page.setViewportSize(viewport);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width);
  await screenshot(page, name, viewport);
}

async function primaryButtonContrast(page: Page, selector: string): Promise<number[]> {
  const button = page.locator(selector);
  const root = page.locator('html');
  const originalTheme = await root.getAttribute('data-theme');
  const ratios: number[] = [];
  try {
    for (const theme of ['light', 'dark']) {
      await root.evaluate((element, selectedTheme) => {
        if (selectedTheme === 'dark') element.setAttribute('data-theme', 'dark');
        else element.removeAttribute('data-theme');
      }, theme);
      ratios.push(
        await button.evaluate((element) => {
          const luminance = (value: string) => {
            const channels =
              value
                .match(/[\d.]+/g)
                ?.slice(0, 3)
                .map(Number) ?? [];
            const [red, green, blue] = channels.map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          };
          const style = getComputedStyle(element);
          const foreground = luminance(style.color);
          const background = luminance(style.backgroundColor);
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        })
      );
    }
  } finally {
    await root.evaluate((element, theme) => {
      if (theme) element.setAttribute('data-theme', theme);
      else element.removeAttribute('data-theme');
    }, originalTheme);
  }
  return ratios;
}

async function tabGeometry(page: Page, name: string) {
  return page.getByRole('tab', { name }).evaluate((tab) => {
    const rect = tab.getBoundingClientRect();
    const tablist = tab.closest('[role="tablist"]');
    const tablistRect = tablist?.getBoundingClientRect();
    const style = getComputedStyle(tab);
    return {
      x: rect.x,
      y: rect.y - (tablistRect?.y ?? 0),
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
  const trigger = page.getByRole('button', { name: labelPattern });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function assignZone(page: Page, zoneName: string, memberIndices: number[]): Promise<void> {
  const zone = page.locator('.plan-details__area').filter({ hasText: zoneName }).first();
  const mapZones = page.locator('.plan-canvas [data-space-id]');
  const mapZoneIndex = await mapZones.evaluateAll(
    (elements, name) =>
      elements.findIndex((element) => element.getAttribute('aria-label') === name),
    zoneName
  );
  if (mapZoneIndex >= 0) {
    const mapZone = mapZones.nth(mapZoneIndex);
    if ((page.viewportSize()?.width ?? 1440) <= 767) await mapZone.tap();
    else await mapZone.click();
    await expect(page.locator('[data-test="plan-selected-space"] h3')).toHaveText(zoneName);
  } else {
    if (!(await zone.isVisible())) {
      const close = page.locator('[data-test="plan-selected-space"] .plan-details__close');
      if (await close.isVisible()) await close.click();
    }
    await zone.click();
    await expect(page.locator('[data-test="plan-selected-space"] h3')).toHaveText(zoneName);
  }
  const assignment = page.locator('[data-test="plan-zone-assignment"]');
  const members = assignment.locator('[data-test="plan-zone-member"]');
  if ((page.viewportSize()?.width ?? 1440) <= 767) {
    for (const label of await assignment.locator('.plan-zone-member > span:nth-child(2)').all()) {
      const textLayout = await label.evaluate((element) => ({
        whiteSpace: getComputedStyle(element).whiteSpace,
        textOverflow: getComputedStyle(element).textOverflow,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      }));
      expect(textLayout.whiteSpace).toBe('normal');
      expect(textLayout.textOverflow).not.toBe('ellipsis');
      expect(textLayout.scrollHeight).toBeLessThanOrEqual(textLayout.clientHeight + 1);
    }
  }
  const memberCount = await members.count();
  const sharedOption = assignment.locator('.plan-zone-member--shared');
  const wantsShared =
    memberIndices.includes(memberCount) ||
    (memberIndices.length === memberCount && memberIndices.every((index) => index < memberCount));
  const isShared = (await sharedOption.getAttribute('aria-pressed')) === 'true';
  if (wantsShared && !isShared) {
    await sharedOption.click();
  } else if (!wantsShared && memberIndices.length === 0 && isShared && memberCount > 0) {
    await members.first().click();
    await members.first().click();
  } else if (!wantsShared) {
    for (let index = 0; index < memberCount; index++) {
      const member = members.nth(index);
      const shouldBeAssigned = memberIndices.includes(index);
      const isAssigned = (await member.getAttribute('aria-pressed')) === 'true';
      if (shouldBeAssigned !== isAssigned) {
        await member.click();
      }
    }
  }
  const selectedIndices: number[] = [];
  for (let index = 0; index < memberCount; index++) {
    if ((await members.nth(index).getAttribute('aria-pressed')) === 'true') {
      selectedIndices.push(index);
    }
  }
  expect(await sharedOption.getAttribute('aria-pressed')).toBe(String(wantsShared));
  expect(selectedIndices).toEqual(wantsShared ? [] : memberIndices);

  const saveButton = assignment.locator('[data-test="plan-zone-assignment-save"]');
  if (await saveButton.isEnabled()) {
    const save = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith('/api/household/plan/assignments')
    );
    await saveButton.click();
    expect((await save).status()).toBe(200);
    await expect(saveButton).toBeDisabled();
  }
  if (wantsShared) await expect(sharedOption).toHaveAttribute('aria-pressed', 'true');
}

test('plano por hogar, propuesta revisable y tareas semanales zonificadas en PC y móvil', async ({
  page,
  browser
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-chrome';
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };

  await registerUser(page, 'Ana');
  await createHousehold(page, 'Hogar sintético de plano y tareas');
  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
  expect(inviteCode).toBeTruthy();

  for (const memberName of ['Leo', 'Nora']) {
    const memberContext = await browser.newContext({ locale: 'es-ES' });
    const memberPage = await memberContext.newPage();
    try {
      await registerUser(memberPage, memberName);
      await memberPage.goto('/household');
      await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
      const joinDialog = memberPage.getByRole('dialog', { name: 'Unirse a un Hogar' });
      await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
      await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
      await expect(memberPage.locator('.household-info__name')).toHaveText(
        'Hogar sintético de plano y tareas'
      );
    } finally {
      // Keep each synthetic account active in the household; close only its browser context.
      await memberContext.close();
    }
  }

  await page.reload();
  await expect(page.locator('.member-card')).toHaveCount(3);
  const activeMemberNames = await page.locator('.member-card__name').allTextContents();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(page.locator('[data-test="household-panel-plan"]')).toBeVisible();
  const householdTabs = page.locator('.household-tabs');
  if (mobile) {
    for (const tabName of ['Hogar', 'Plano', 'Tareas', 'Miembros', 'Permisos', 'Ajustes']) {
      await expect(householdTabs.getByRole('tab', { name: tabName })).toBeInViewport();
    }
    const tabDimensions = await householdTabs.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(
      tabDimensions.scrollWidth,
      'all household sections remain visible on mobile'
    ).toBeLessThanOrEqual(tabDimensions.clientWidth + 1);
    for (const width of [320, 359, 360, 389, 390]) {
      await page.setViewportSize({ width, height: 568 });
      const tabLayout = await householdTabs.evaluate((element) =>
        Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]')).map((tab) => {
          const bounds = tab.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            scrollWidth: tab.scrollWidth,
            clientWidth: tab.clientWidth
          };
        })
      );
      expect(tabLayout, `all six household tabs exist at ${width}px`).toHaveLength(6);
      for (const tab of tabLayout) {
        expect(
          tab.scrollWidth,
          `household tab labels do not overlap at ${width}px`
        ).toBeLessThanOrEqual(tab.clientWidth + 1);
      }
      for (let index = 1; index < tabLayout.length; index += 1) {
        expect(tabLayout[index].left).toBeGreaterThanOrEqual(tabLayout[index - 1].right - 1);
      }
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByRole('tab', { name: 'Plano' })).toBeInViewport();
    const planTab = page.getByRole('tab', { name: 'Plano' });
    const settingsTab = page.getByRole('tab', { name: 'Ajustes' });
    await planTab.focus();
    await page.keyboard.press('End');
    await expect(settingsTab).toBeFocused();
    await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
    const [settingsBounds, tabsBounds] = await Promise.all([
      settingsTab.boundingBox(),
      householdTabs.boundingBox()
    ]);
    const tabsScrollLeft = await householdTabs.evaluate((element) => element.scrollLeft);
    expect(settingsBounds).not.toBeNull();
    expect(tabsBounds).not.toBeNull();
    expect(settingsBounds!.x).toBeGreaterThanOrEqual(tabsBounds!.x - 1);
    expect(settingsBounds!.x + settingsBounds!.width).toBeLessThanOrEqual(
      tabsBounds!.x + tabsBounds!.width + 1
    );
    expect(
      tabsScrollLeft,
      'keyboard selection scrolls a narrow household tab into view'
    ).toBeGreaterThan(0);
    await planTab.click();
    await expect(planTab).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize(viewport);
  }
  await expect(page.locator('[data-test="plan-setup"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-method-canvas"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-method-photo"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-method-guided"]')).toBeVisible();
  await page.locator('[data-test="plan-dwelling-house"]').click();
  await expect(
    page.locator('.plan-setup__dwelling-card[aria-pressed="true"]'),
    'only one dwelling type may appear selected'
  ).toHaveCount(1);
  const floorCountPicker = page.locator('[data-test="plan-floor-count"]');
  await expect(floorCountPicker.locator('button.picker__trigger')).toBeVisible();
  await floorCountPicker.locator('button.picker__trigger').click();
  await floorCountPicker.getByRole('option', { name: /^2(?:\s|$)/ }).click();
  if (mobile) {
    const methodCard = await page.locator('.plan-method-card').first().boundingBox();
    expect(
      methodCard?.height,
      'setup methods retain prototype-sized touch cards'
    ).toBeGreaterThanOrEqual(80);
    const floorCountAlignment = await page
      .locator('.plan-setup__floor-count')
      .evaluate((element) => {
        const label = element.querySelector('span')?.getBoundingClientRect();
        const picker = element.querySelector('app-picker')?.getBoundingClientRect();
        return {
          labelCenter: label ? label.top + label.height / 2 : -1,
          pickerCenter: picker ? picker.top + picker.height / 2 : -1
        };
      });
    expect(
      Math.abs(floorCountAlignment.labelCenter - floorCountAlignment.pickerCenter)
    ).toBeLessThanOrEqual(1);
  }
  for (const ratio of await primaryButtonContrast(page, '[data-test="plan-start"]')) {
    expect(ratio, 'primary plan actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(4.5);
  }
  await screenshot(page, '01-plan-start', viewport);
  if (mobile) {
    const startButton = await page.locator('[data-test="plan-start"]').boundingBox();
    const bottomNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(startButton).not.toBeNull();
    expect(bottomNavigation).not.toBeNull();
    expect(startButton!.y + startButton!.height).toBeLessThanOrEqual(bottomNavigation!.y - 8);
    await captureResponsiveScreenshot(page, '01-plan-start-320x568', { width: 320, height: 568 });
    await page.setViewportSize(viewport);
  }
  await expect(floorCountPicker.locator('button.picker__trigger')).toContainText('2');
  await page.locator('[data-test="plan-method-guided"]').click();
  await page.getByRole('button', { name: 'Empezar plano' }).click();
  await expect(page.locator('[data-test="plan-setup"]')).toBeHidden();
  await expect(page.locator('[data-test="plan-canvas-toolbar"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-undo"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-redo"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-floor-tabs"] .plan-floor-tabs__tab')).toHaveCount(2);
  if (mobile) {
    await expect(page.locator('.plan-editor__toolbar-actions .plan-canvas__snap')).toBeHidden();
    const floorTabText = await page
      .locator('[data-test="plan-floor-tabs"] .plan-floor-tabs__tab')
      .first()
      .evaluate((tab) => ({ width: tab.clientWidth, textWidth: tab.scrollWidth }));
    expect(floorTabText.textWidth, 'mobile floor names must not be clipped').toBeLessThanOrEqual(
      floorTabText.width + 1
    );
  } else {
    const floorTabs = await page.locator('[data-test="plan-floor-tabs"]').boundingBox();
    expect(floorTabs?.width, 'desktop floor tabs do not become an empty outlined bar').toBeLessThan(
      220
    );
    await expect(page.locator('[data-test="plan-canvas-toolbar"]')).toHaveCSS(
      'border-top-width',
      '0px'
    );
  }
  await expect(page.locator('.plan-canvas')).toHaveAttribute('role', 'group');
  if (!mobile) {
    const starterCanvas = await page.locator('.plan-canvas').boundingBox();
    expect(starterCanvas?.width, 'desktop canvas uses the wide map area').toBeGreaterThanOrEqual(
      500
    );
  }
  await expect(page.locator('.plan-canvas [data-space-id]')).toHaveCount(7);
  await expect(page.locator('.plan-canvas svg[householdAreaGlyph]')).toHaveCount(7);
  await expect(page.locator('.plan-canvas__door-leaf')).toHaveCount(4);
  await expect(page.locator('.plan-canvas__door-swing')).toHaveCount(4);
  await expect(page.locator('.plan-canvas__window-rail')).toHaveCount(6);
  await screenshot(page, '02-plan-editor', viewport);
  if (mobile) {
    await captureResponsiveScreenshot(page, '02-plan-editor-320x568', {
      width: 320,
      height: 568
    });
    await page.setViewportSize(viewport);
  }
  const canvasAndDetails = await page.evaluate(() => {
    const canvas = document.querySelector('.plan-canvas__viewport')?.getBoundingClientRect();
    const details = document.querySelector('.plan-details')?.getBoundingClientRect();
    return { canvasTop: canvas?.top ?? -1, detailsTop: details?.top ?? -1 };
  });
  if (mobile)
    expect(canvasAndDetails.canvasTop, 'plan canvas precedes area details').toBeLessThan(
      canvasAndDetails.detailsTop
    );
  if (!mobile) {
    const editorCanvas = await page.locator('.plan-canvas__viewport').boundingBox();
    expect(editorCanvas?.height).toBeLessThanOrEqual(440);
    await page.evaluate(() => window.scrollTo(0, 0));
    const previewButton = await page.locator('.plan-canvas__preview-action').boundingBox();
    expect(previewButton).not.toBeNull();
    expect(previewButton!.y + previewButton!.height).toBeLessThanOrEqual(viewport.height);
  } else {
    await expect(page.locator('.plan-canvas-toolbar__tools button').first()).toBeInViewport();
    await expect(page.locator('.plan-canvas-toolbar__tools button').last()).toBeInViewport();
    const toolbarRows = await page.evaluate(() =>
      ['.plan-canvas-toolbar__tools', '.plan-canvas-toolbar__rooms'].map((selector) => {
        const row = document.querySelector<HTMLElement>(selector);
        if (!row) throw new Error(`Missing toolbar row: ${selector}`);
        return { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth };
      })
    );
    for (const row of toolbarRows) {
      expect(row.scrollWidth, 'mobile plan toolbar row fits without clipping').toBeLessThanOrEqual(
        row.clientWidth + 1
      );
    }
    const previewAction = await page.locator('.plan-canvas__preview-action').boundingBox();
    const bottomNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(previewAction).not.toBeNull();
    expect(bottomNavigation).not.toBeNull();
    expect(previewAction!.y + previewAction!.height).toBeLessThanOrEqual(bottomNavigation!.y - 8);
  }
  await expect(page.locator('.plan-file input')).toHaveAttribute(
    'accept',
    'image/jpeg,image/png,image/webp,application/pdf'
  );

  await page.locator('.plan-details__area').filter({ hasText: 'Cocina' }).first().click();
  await page.locator('.plan-details__selected-actions > summary').click();
  await page.locator('.plan-details__rename summary').click();
  const areaName = page.getByLabel('Nombre visible');
  await expect(areaName).toHaveValue('Cocina');
  await areaName.fill('Cocina QA');
  const selectedAreaClose = page.locator('[data-test="plan-selected-space"] .plan-details__close');
  await selectedAreaClose.click();
  const savePlan = page.locator('[data-test="plan-save"]');
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
  let savedPlan = savedPlanEnvelope.data.plan as HouseholdPlan;
  const editedKitchen = savedPlan.floors[0].spaces.find((space) => space.label === 'Cocina QA');
  expect(editedKitchen).toBeTruthy();
  const kitchenId = editedKitchen!.id;
  if (mobile) {
    await expect(
      page.locator('.plan-details__area').filter({ hasText: 'Cocina QA' })
    ).toBeVisible();
  } else {
    await expect(
      page.locator('.plan-details__area').filter({ hasText: 'Cocina QA' })
    ).toBeVisible();
  }
  const floorTabs = page.locator('[data-test="plan-floor-tabs"]');
  await expect(floorTabs, 'floor switching should stay beside the drawing tools').toBeVisible();
  await expect(floorTabs.getByRole('button', { name: 'Planta baja' })).toBeVisible();
  await page.locator('.plan-details__area').filter({ hasText: 'Cocina QA' }).click();

  const zoneAssignment = page.locator('[data-test="plan-zone-assignment"]');
  await expect(zoneAssignment).toBeVisible();
  await expect(
    page.locator('.plan-canvas-toolbar'),
    'zone assignment must not expose drawing controls'
  ).toBeHidden();
  if (mobile) {
    await expect(zoneAssignment.locator('[data-test="plan-zone-member"]')).toHaveCount(3);
    await expect(zoneAssignment.locator('.plan-zone-member--shared')).toBeVisible();
    await expect(page.locator('.plan-editor__header')).toBeVisible();
    await expect(page.locator('.plan-editor__header h2')).toHaveText('Plano de tu hogar');
    await expect(page.locator('.plan-editor__toolbar')).toBeHidden();
    await expect(page.locator('.plan-editor__toolbar-actions')).toBeHidden();
    await expect(page.locator('.plan-canvas-toolbar')).toBeHidden();
    const floorTabsBounds = await page
      .locator('[data-test="plan-assignment-floor-tabs"]')
      .boundingBox();
    const assignmentHeadingBounds = await page.locator('.plan-editor__header').boundingBox();
    const assignmentMapBounds = await page.locator('.plan-canvas__viewport').boundingBox();
    const assignmentSheetBounds = await page
      .locator('[data-test="plan-selected-space"]')
      .boundingBox();
    expect(floorTabsBounds).not.toBeNull();
    expect(assignmentHeadingBounds).not.toBeNull();
    expect(assignmentMapBounds).not.toBeNull();
    expect(assignmentSheetBounds).not.toBeNull();
    expect(assignmentHeadingBounds!.y + assignmentHeadingBounds!.height).toBeLessThanOrEqual(
      floorTabsBounds!.y
    );
    expect(assignmentMapBounds!.y).toBeGreaterThanOrEqual(
      floorTabsBounds!.y + floorTabsBounds!.height
    );
    expect(
      assignmentMapBounds!.y + assignmentMapBounds!.height,
      'the assignment sheet must not cover the floor plan'
    ).toBeLessThanOrEqual(assignmentSheetBounds!.y - 8);
    for (const size of [
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(size.width);
      const compactMap = await page.locator('.plan-canvas__viewport').boundingBox();
      const compactSheet = await page.locator('[data-test="plan-selected-space"]').boundingBox();
      expect(compactMap).not.toBeNull();
      expect(compactSheet).not.toBeNull();
      expect(compactMap!.y + compactMap!.height).toBeLessThanOrEqual(compactSheet!.y - 8);
      await expect(page.locator('[data-test="plan-selected-space"]')).toHaveCSS(
        'position',
        'static'
      );
      await screenshot(page, `04-zone-assignment-${size.width}x${size.height}`, size);
    }
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  if (!mobile) {
    await expect(page.locator('.plan-editor__header h2')).toHaveText('Plano de tu hogar');
  }
  if (!mobile) {
    const selectedPlanCanvas = await page.locator('.plan-canvas__viewport').boundingBox();
    expect(
      selectedPlanCanvas?.height,
      'zone assignment keeps the floor plan large beside its editor'
    ).toBeGreaterThanOrEqual(500);
  }
  const assignedMemberName = await zoneAssignment
    .locator('[data-test="plan-zone-member"]')
    .first()
    .getAttribute('aria-label');
  await zoneAssignment.locator('[data-test="plan-zone-member"]').first().click();
  for (const ratio of await primaryButtonContrast(
    page,
    '[data-test="plan-zone-assignment-save"]'
  )) {
    expect(ratio, 'assignment actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(4.5);
  }
  const zoneAssignmentSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/plan/assignments')
  );
  await zoneAssignment.locator('[data-test="plan-zone-assignment-save"]').click();
  expect((await zoneAssignmentSave).status()).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await page.locator('.plan-details__area').filter({ hasText: 'Cocina QA' }).click();
  await expect(
    page.locator('[data-test="plan-zone-assignment"] [aria-pressed="true"]')
  ).toContainText(assignedMemberName ?? '');
  await assignZone(page, 'Salón', [0]);
  await assignZone(page, 'Baño', [1]);
  await assignZone(page, 'Dormitorio', [2]);
  await assignZone(page, 'Patio', [0, 1, 2]);
  await assignZone(page, 'Jardín', [0, 1, 2]);
  await assignZone(page, 'Cocina QA', [3]);
  await expect(zoneAssignment.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(zoneAssignment.locator('.plan-zone-member--shared')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  if (mobile) {
    const assignmentSheet = page.locator('[data-test="plan-selected-space"]');
    await expect(assignmentSheet.locator('h3')).toHaveText('Cocina QA');
    const memberButtons = assignmentSheet.locator(
      '[data-test="plan-zone-member"], .plan-zone-member--shared'
    );
    expect(await memberButtons.count()).toBe(4);
    const memberRows = await memberButtons.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().y)
    );
    expect(Math.max(...memberRows) - Math.min(...memberRows)).toBeLessThanOrEqual(1);
    const saveBounds = await assignmentSheet
      .locator('[data-test="plan-zone-assignment-save"]')
      .boundingBox();
    const bottomNavBounds = await page.locator('app-bottom-nav, .bottom-nav').first().boundingBox();
    expect(saveBounds).not.toBeNull();
    if (bottomNavBounds)
      expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(bottomNavBounds.y);
  }
  if (!mobile) {
    const workspace = page.locator('.plan-editor__workspace');
    const canvasColumn = page.locator('.plan-canvas-column');
    const detailsPanel = page.locator('.plan-details');
    await expect(workspace).toHaveCSS('display', 'grid');
    const canvasBounds = await canvasColumn.boundingBox();
    const detailsBounds = await detailsPanel.boundingBox();
    expect(canvasBounds).not.toBeNull();
    expect(detailsBounds).not.toBeNull();
    expect(detailsBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x + canvasBounds!.width);
  }
  await screenshot(page, '04-zone-assignment', viewport);
  const assignmentClose = page.locator('[data-test="plan-selected-space"] .plan-details__close');
  if (await assignmentClose.isVisible()) await assignmentClose.click();

  await page.getByRole('button', { name: 'Dibujar pared' }).click();
  await choosePickerOption(page, /Tipo de pared:/, 'Pared exterior');
  const canvas = page.locator('.plan-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  const wallStart = {
    x: canvasBounds!.x + canvasBounds!.width * 0.455,
    y: canvasBounds!.y + canvasBounds!.height * 0.52
  };
  const wallEnd = {
    x: canvasBounds!.x + canvasBounds!.width * 0.49,
    y: wallStart.y
  };
  await page.mouse.move(wallStart.x, wallStart.y);
  await page.mouse.down();
  await page.mouse.move(wallEnd.x, wallEnd.y, { steps: 4 });
  await page.mouse.up();
  await expect(canvas.locator('.plan-canvas__wall--exterior')).toHaveCount(5);
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
  expect(savedPlan.floors[0].walls).toHaveLength(11);
  expect(savedPlan.floors[0].openings[0].isMainEntrance).toBe(true);

  const canvasSpace = canvas.locator('[data-space-id]').first();
  if (mobile) await canvasSpace.tap();
  else await canvasSpace.click();
  await expect(canvasSpace).toHaveClass(/plan-canvas__space--selected/);
  await canvasSpace.focus();
  await page.keyboard.press('Enter');
  await expect(canvasSpace).toHaveClass(/plan-canvas__space--selected/);

  await screenshot(page, 'plan-desktop-or-mobile', viewport);
  if (mobile) await screenshot(page, 'plan-canvas-mobile', viewport);
  if (mobile) await page.locator('[data-test="plan-selected-space"] .plan-details__close').click();

  await page.locator('.plan-editor__advanced-settings summary').click();
  await page.getByRole('button', { name: 'Añadir planta' }).click();
  const floorTab = page.locator('[data-test="plan-floor-tabs"]').getByRole('button', {
    name: 'Planta 2',
    exact: true
  });
  await expect(floorTab).toBeVisible();
  const removeFloorButton = page.getByRole('button', { name: 'Eliminar planta' });
  await removeFloorButton.click();
  const floorConfirmation = page.getByRole('dialog', { name: 'Eliminar esta planta' });
  await expect(floorConfirmation).toContainText('Planta 2');
  await expect
    .poll(() => floorConfirmation.evaluate((dialog) => dialog.contains(document.activeElement)))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(floorConfirmation).toBeHidden();
  await expect(floorTab).toBeVisible();
  await removeFloorButton.click();
  const confirmFloorRemoval = floorConfirmation.getByRole('button', { name: 'Eliminar planta' });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(confirmFloorRemoval).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(floorConfirmation).toBeHidden();
  await expect(
    page.locator('[data-test="plan-floor-tabs"]').getByRole('button', {
      name: 'Planta baja',
      exact: true
    })
  ).toBeVisible();

  await choosePickerOption(page, /Tipo de zona:/, 'Baño');
  await page.getByRole('button', { name: 'Añadir al plano' }).click();
  await page.locator('.plan-details__selected-actions > summary').click();
  await page.locator('.plan-details__rename summary').click();
  await page.getByLabel('Nombre visible').fill('Borrador QA');
  await expect(savePlan).toBeEnabled();
  await page.getByRole('tab', { name: 'Tareas' }).click();
  await page.getByRole('tab', { name: 'Plano' }).click();
  if (mobile) await page.locator('[data-test="plan-selected-space"] .plan-details__close').click();
  await expect(
    page.locator('.plan-details__area').filter({ hasText: 'Borrador QA' })
  ).toBeVisible();
  const undoButton = page.getByRole('button', { name: 'Deshacer' });
  const redoButton = page.getByRole('button', { name: 'Rehacer' });
  await undoButton.click();
  await expect(page.locator('.plan-details__area').filter({ hasText: 'Borrador QA' })).toHaveCount(
    0
  );
  await expect(redoButton).toBeEnabled();
  await redoButton.click();
  await expect(
    page.locator('.plan-details__area').filter({ hasText: 'Borrador QA' })
  ).toBeVisible();
  await undoButton.click();
  await expect(page.locator('.plan-details__area').filter({ hasText: 'Borrador QA' })).toHaveCount(
    0
  );

  // This browser-level stub exercises the upload/review UI without contacting an AI provider.
  // Real request_format, geometry validation, and persistence are covered by isolated server tests.
  const proposedPlan = landscapePlan(savedPlan);
  proposedPlan.floors[0].spaces.find((space) => space.id === kitchenId)!.label = 'Cocina con isla';
  const followupPlan = structuredClone(proposedPlan);
  followupPlan.floors[0].spaces.find((space) => space.id === kitchenId)!.label = 'Cocina ampliada';
  const proposalRequestBodies: string[] = [];
  await page.route('**/api/household/plan/proposal', async (route) => {
    const request = route.request();
    const contentType = request.headers()['content-type'] ?? '';
    const requestBody =
      request
        .postDataBuffer()
        ?.toString(contentType.includes('multipart/form-data') ? 'latin1' : 'utf8') ?? '';
    proposalRequestBodies.push(requestBody);
    const isFollowup = proposalRequestBodies.length > 1;
    const requestedDraft = isFollowup ? proposedPlan : savedPlan;
    const result = isFollowup ? followupPlan : proposedPlan;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          baseVersion: savedPlanEnvelope.data.version,
          current: savedPlan,
          draft: requestedDraft,
          proposal: result,
          diff: {
            addedSpaceIds: [],
            modifiedSpaceIds: result.floors[0].spaces.map((space) => space.id),
            removedSpaceIds: []
          },
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
  const planImage = await syntheticPlanImage(page);
  await page.locator('.plan-file input').setInputFiles({
    name: 'plano-sintetico.png',
    mimeType: 'image/png',
    buffer: planImage
  });
  await page.getByLabel('¿Qué quieres cambiar?').fill('Amplía la cocina hacia el patio');
  await page.getByRole('button', { name: 'Generar propuesta' }).click();
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeVisible();
  await expect(page.locator('.plan-editor__header h2')).toHaveText('Convertir boceto en plano');
  await expect(page.locator('[data-test="plan-proposal-photo"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cambiar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar editando', exact: true })).toBeVisible();
  await expect(page.locator('[data-test="plan-attachment-preview"]')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('[data-test="plan-attachment-preview"]').evaluate((image) => {
        const preview = image as HTMLImageElement;
        return preview.complete ? preview.naturalWidth : 0;
      })
    )
    .toBeGreaterThan(300);
  if (mobile) {
    const sourceImageWidth = await page
      .locator('[data-test="plan-attachment-preview"]')
      .evaluate((element) => {
        const image = element as HTMLImageElement;
        const bounds = image.getBoundingClientRect();
        const scale = Math.min(
          bounds.width / image.naturalWidth,
          bounds.height / image.naturalHeight
        );
        return image.naturalWidth * scale;
      });
    expect(
      sourceImageWidth,
      'the uploaded sketch should be readable at the same prominence as the reference'
    ).toBeGreaterThanOrEqual(260);
  }
  await expect.poll(() => proposalRequestBodies[0] ?? '').toContain('name="image"');
  expect(proposalRequestBodies[0]).toContain('name="draftPlan"');
  expect(proposalRequestBodies[0]).toContain('name="prompt"');
  expect(proposalRequestBodies[0]).toContain('plano-sintetico.png');
  await expect(page.locator('.plan-review__photo-result')).toContainText('Cocina');
  const proposalOutlineWidth = await page
    .locator('.plan-review__photo-result .plan-compare-canvas__space')
    .first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeWidth));
  expect(
    proposalOutlineWidth,
    'proposal walls should stay visually prominent at mobile scale'
  ).toBeGreaterThanOrEqual(84);
  await expect(page.locator('[data-test="plan-proposal-chat"]')).toBeVisible();
  const proposedMap = page.locator('.plan-review__photo-result .plan-compare-canvas');
  await expect(proposedMap.locator('.plan-compare-canvas__wall--exterior')).not.toHaveCount(0);
  await expect(proposedMap.locator('.plan-canvas__door-swing')).not.toHaveCount(0);
  await expect(proposedMap.locator('.plan-canvas__window-rail')).not.toHaveCount(0);
  if (mobile) {
    const proposalMap = await proposedMap.boundingBox();
    expect(proposalMap).not.toBeNull();
    expect(
      proposalMap!.width,
      'photo proposal should read as the main visual, not a thumbnail'
    ).toBeGreaterThan(200);
  }
  if (mobile) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const initialApply = await page.locator('[data-test="plan-proposal-apply"]').boundingBox();
    const initialChat = await page.locator('[data-test="plan-proposal-chat"]').boundingBox();
    const initialContinue = await page
      .locator('[data-test="plan-proposal-continue"]')
      .boundingBox();
    const stickyActions = await page.locator('.plan-review__actions--photo').boundingBox();
    const initialBottomNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(initialApply).not.toBeNull();
    expect(initialChat).not.toBeNull();
    expect(initialContinue).not.toBeNull();
    expect(stickyActions).not.toBeNull();
    expect(initialBottomNavigation).not.toBeNull();
    expect(
      initialApply!.y + initialApply!.height,
      'photo review apply action should be visible without scrolling'
    ).toBeLessThanOrEqual(initialBottomNavigation!.y - 8);
    expect(
      initialChat!.y + initialChat!.height,
      'photo review chat action should be visible without scrolling'
    ).toBeLessThanOrEqual(initialBottomNavigation!.y - 8);
    expect(
      initialContinue!.y + initialContinue!.height,
      'continue editing stays above mobile navigation'
    ).toBeLessThanOrEqual(initialBottomNavigation!.y - 8);
    expect(
      initialApply!.y + initialApply!.height,
      'proposal decision remains visible above the sticky continue actions'
    ).toBeLessThanOrEqual(stickyActions!.y - 8);
    expect(
      initialChat!.y + initialChat!.height,
      'change action remains visible above the sticky continue actions'
    ).toBeLessThanOrEqual(stickyActions!.y - 8);
    for (const selector of [
      '[data-test="plan-proposal-apply"]',
      '[data-test="plan-proposal-continue"]'
    ]) {
      for (const ratio of await primaryButtonContrast(page, selector)) {
        expect(ratio, 'photo proposal actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(
          4.5
        );
      }
    }
    await screenshot(page, '03-photo-proposal', viewport);
    await captureResponsiveScreenshot(page, '03-photo-proposal-320x568', {
      width: 320,
      height: 568
    });
    const compactDecision = await page.locator('[data-test="plan-proposal-apply"]').boundingBox();
    const compactSticky = await page.locator('.plan-review__actions--photo').boundingBox();
    const compactContinue = await page
      .locator('[data-test="plan-proposal-continue"]')
      .boundingBox();
    const compactNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(compactDecision).not.toBeNull();
    expect(compactSticky).not.toBeNull();
    expect(compactContinue).not.toBeNull();
    expect(compactNavigation).not.toBeNull();
    expect(compactDecision!.y + compactDecision!.height).toBeLessThanOrEqual(compactSticky!.y - 8);
    await page.locator('[data-test="plan-proposal-continue"]').scrollIntoViewIfNeeded();
    const scrolledContinue = await page
      .locator('[data-test="plan-proposal-continue"]')
      .boundingBox();
    const scrolledNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(scrolledContinue).not.toBeNull();
    expect(scrolledNavigation).not.toBeNull();
    expect(scrolledContinue!.y + scrolledContinue!.height).toBeLessThanOrEqual(
      scrolledNavigation!.y - 8
    );
    await screenshot(
      page,
      '03-photo-proposal-actions-320x568',
      {
        width: 320,
        height: 568
      },
      false
    );
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const width of [320, 359]) {
      await page.setViewportSize({ width, height: viewport.height });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      const decision = await page.locator('[data-test="plan-proposal-apply"]').boundingBox();
      const sticky = await page.locator('.plan-review__actions--photo').boundingBox();
      expect(decision).not.toBeNull();
      expect(sticky).not.toBeNull();
      expect(decision!.y + decision!.height).toBeLessThanOrEqual(sticky!.y - 8);
    }
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[data-test="plan-proposal-chat"]').scrollIntoViewIfNeeded();
    const applyButton = await page.locator('[data-test="plan-proposal-apply"]').boundingBox();
    const chatButton = await page.locator('[data-test="plan-proposal-chat"]').boundingBox();
    const bottomNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(applyButton).not.toBeNull();
    expect(chatButton).not.toBeNull();
    expect(bottomNavigation).not.toBeNull();
    expect(applyButton!.y + applyButton!.height).toBeLessThanOrEqual(bottomNavigation!.y - 8);
    expect(
      chatButton!.y + chatButton!.height,
      'photo review actions remain reachable above the mobile navigation'
    ).toBeLessThanOrEqual(bottomNavigation!.y - 8);
    await screenshot(page, '03-photo-proposal-actions-mobile', viewport, false);
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    const continueEditing = await page
      .locator('[data-test="plan-proposal-continue"]')
      .boundingBox();
    expect(continueEditing).not.toBeNull();
    expect(
      continueEditing!.y + continueEditing!.height,
      'desktop photo review keeps the continue action in the initial viewport'
    ).toBeLessThanOrEqual(viewport.height - 8);
    for (const selector of [
      '[data-test="plan-proposal-apply"]',
      '[data-test="plan-proposal-continue"]'
    ]) {
      for (const ratio of await primaryButtonContrast(page, selector)) {
        expect(ratio, 'photo proposal actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(
          4.5
        );
      }
    }
    await screenshot(page, '03-photo-proposal', viewport);
  }
  await page.locator('[data-test="plan-proposal-chat"]').click();
  await expect(page.locator('[data-test="plan-proposal-chat-view"]')).toBeVisible();
  await expect(page.locator('.plan-editor__header h2')).toHaveText('Plano');
  await expect(page.locator('.plan-review__header-actions .plan-file')).toBeVisible();
  await expect(page.locator('[data-test="plan-return-to-canvas"]')).toHaveText('Volver al lienzo');
  if (mobile) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const userMessage = await page.locator('.plan-chat__user-message').boundingBox();
    const assistantMessage = await page.locator('.plan-chat__assistant-message').boundingBox();
    const applyButton = await page
      .locator('.plan-chat [data-test="plan-proposal-apply"]')
      .boundingBox();
    const bottomNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(userMessage).not.toBeNull();
    expect(assistantMessage).not.toBeNull();
    expect(applyButton).not.toBeNull();
    expect(bottomNavigation).not.toBeNull();
    expect(userMessage!.y + userMessage!.height).toBeLessThanOrEqual(bottomNavigation!.y - 8);
    expect(assistantMessage!.y + assistantMessage!.height).toBeLessThanOrEqual(
      bottomNavigation!.y - 8
    );
    expect(applyButton!.y + applyButton!.height).toBeLessThanOrEqual(bottomNavigation!.y - 8);
  }
  await screenshot(page, '06-chat-adjustment', viewport);
  if (mobile) {
    await captureResponsiveScreenshot(page, '06-chat-adjustment-320x568', {
      width: 320,
      height: 568
    });
    await page.setViewportSize(viewport);
  }
  expect(proposalWrites).toHaveLength(0);

  await page.locator('[data-test="plan-chat-photo-upload"]').setInputFiles({
    name: 'seguimiento-sintetico.png',
    mimeType: 'image/png',
    buffer: await syntheticPlanImage(page)
  });
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeHidden();
  await expect(
    page.locator('.plan-details__area').filter({ hasText: 'Cocina con isla' }),
    'photo follow-up must keep the proposed geometry as an unsaved draft'
  ).toBeVisible();
  await expect(page.locator('.plan-file__selected')).toContainText('seguimiento-sintetico.png');
  const followupPrompt = page.getByLabel('¿Qué quieres cambiar?');
  await expect(followupPrompt).toHaveValue('');
  await followupPrompt.fill('Amplía la cocina hacia el patio');
  await page.getByRole('button', { name: 'Generar propuesta' }).click();
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeVisible();
  await expect(page.locator('.plan-editor__header h2')).toHaveText('Convertir boceto en plano');
  await expect.poll(() => proposalRequestBodies.length).toBe(2);
  expect(proposalRequestBodies[1]).toContain('"draftPlan"');
  expect(proposalRequestBodies[1]).toContain('name="image"');
  expect(proposalRequestBodies[1]).toContain('seguimiento-sintetico.png');
  expect(proposalRequestBodies[1]).toContain('Cocina con isla');
  expect(proposalRequestBodies[1]).toContain('la cocina hacia el patio');
  expect(proposalWrites).toHaveLength(0);
  if (mobile) await page.locator('[data-test="plan-proposal-review"]').scrollIntoViewIfNeeded();
  await screenshot(page, 'proposal-desktop-or-mobile', viewport);
  await page.locator('[data-test="plan-proposal-apply"]').click();
  await expect(page.locator('.plan-editor__message--success')).toContainText(
    'La propuesta se guardó'
  );
  await expect.poll(() => proposalWrites.length).toBe(1);
  await page.reload();
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(
    page.locator('.plan-details__area').filter({ hasText: 'Cocina ampliada' })
  ).toBeVisible();
  await assignZone(page, 'Cocina ampliada', [0]);
  await assignZone(page, 'Salón', [0]);
  await assignZone(page, 'Baño', [1]);
  await assignZone(page, 'Dormitorio', [2]);
  await assignZone(page, 'Patio', [0, 1, 2]);
  await assignZone(page, 'Jardín', [0, 1, 2]);
  await assignZone(page, 'Cocina ampliada', [0]);
  const kitchenAssignment = page.locator('[data-test="plan-zone-assignment"]');
  await expect(kitchenAssignment.locator('[data-test="plan-zone-member"]').first()).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(kitchenAssignment.locator('.plan-zone-member--shared')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  // Verify the shared tab shell is geometrically identical on the two new sections.
  const planTabGeometry = await tabGeometry(page, 'Plano');
  await page.locator('.plan-details__selected-actions > summary').click();
  await page.getByRole('button', { name: 'Ver tareas de esta zona' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tab=tasks.*[?&]space=${kitchenId}`));
  await expect(page.locator('[data-test="household-panel-tasks"]')).toBeVisible();
  await expect(page.locator('[data-test="tasks-layout"]')).toBeVisible();
  await expect(page.locator('[data-test="tasks-plan-canvas"]')).toBeVisible();
  await expect(page.locator('.tasks-plan-canvas svg[householdAreaGlyph]')).toHaveCount(7);
  await expect(page.locator('.tasks-zone-heading h3')).toHaveText('Cocina ampliada');
  const fairAssignment = page.getByRole('radio', { name: 'Aleatoria y equitativa' });
  await fairAssignment.check();
  await expect(fairAssignment).toHaveAttribute('aria-describedby', 'tasks-random-mode-description');
  await expect(page.locator('#tasks-random-mode-description')).toContainText(
    'Reparto aleatorio equitativo'
  );
  await page.getByRole('radio', { name: 'Elegir persona' }).check();
  if (mobile) {
    const taskForm = await page.locator('.tasks-create').boundingBox();
    const assignmentSettings = await page.locator('.tasks-assignment-settings').boundingBox();
    const taskTitleRow = await page.locator('.tasks-create__primary-row').boundingBox();
    const bottomNavigation = await page.locator('.bottom-nav').boundingBox();
    const scheduleTop = await page
      .locator('.tasks-schedule')
      .evaluate((element) => element.getBoundingClientRect().top);
    const addTaskTop = await page
      .locator('.tasks-create')
      .evaluate((element) => element.getBoundingClientRect().top);
    expect(
      addTaskTop,
      'task form follows the selected-zone summary and precedes the weekly list'
    ).toBeLessThan(scheduleTop);
    await expect(page.locator('.tasks-assignment-settings .tasks-repeat-rule')).toBeVisible();
    expect(taskForm).not.toBeNull();
    expect(assignmentSettings).not.toBeNull();
    expect(taskTitleRow).not.toBeNull();
    expect(bottomNavigation).not.toBeNull();
    expect(taskTitleRow!.y + taskTitleRow!.height).toBeLessThanOrEqual(assignmentSettings!.y);
    expect(assignmentSettings!.y + assignmentSettings!.height).toBeLessThanOrEqual(
      bottomNavigation!.y - 8
    );
  }
  if (mobile) {
    await expect(page.locator('.tasks-zone-heading__controls')).toBeHidden();
    await expect(
      page.locator('.tasks-zone-heading h3'),
      'the selected zone title should remain visible beside the weekly list'
    ).toBeVisible();
    await expect(page.locator('.tasks-map__area[role="button"]').first()).toBeVisible();
  }
  const taskMap = await page.locator('.tasks-map-viewport').boundingBox();
  expect(taskMap?.height).toBeLessThanOrEqual(mobile ? 350 : 700);
  if (!mobile) {
    expect(
      taskMap?.height,
      'desktop household plan should keep the large canvas seen in the approved mockup'
    ).toBeGreaterThanOrEqual(560);
    const footerButtons = page.locator(
      '.tasks-schedule__footer > .tasks-button, .tasks-schedule__footer .tasks-editor__actions .tasks-button'
    );
    expect(await footerButtons.count()).toBeGreaterThanOrEqual(2);
    for (const button of await footerButtons.all()) {
      await expect(button).toHaveCSS('white-space', 'nowrap');
      const textBounds = await button.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }));
      expect(textBounds.scrollWidth).toBeLessThanOrEqual(textBounds.clientWidth + 1);
    }
  }
  if (mobile) {
    expect(
      taskMap?.height,
      'the interactive household plan should dominate mobile tasks'
    ).toBeGreaterThanOrEqual(240);
    const assignmentMode = await page.locator('.tasks-assignment-mode').boundingBox();
    expect(assignmentMode).not.toBeNull();
    expect(assignmentMode!.height).toBeGreaterThanOrEqual(44);
  }
  const taskCanvas = await page.locator('.tasks-plan-canvas').boundingBox();
  const taskAreas = await page.locator('.tasks-map__area').evaluateAll((areas) =>
    areas.map((area) => {
      const bounds = area.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    })
  );
  const exteriorWallWidth = await page
    .locator('.tasks-plan-canvas__wall--exterior')
    .first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeWidth));
  expect(
    exteriorWallWidth,
    'exterior walls should read clearly on the household plan'
  ).toBeGreaterThanOrEqual(145);
  expect(taskCanvas?.height).toBeLessThanOrEqual(taskMap?.height ?? 0);
  expect(taskCanvas?.width).toBeLessThanOrEqual(taskMap?.width ?? 0);
  expect(taskMap).not.toBeNull();
  for (const area of taskAreas) {
    expect(area.left, 'floor space fits inside the task map').toBeGreaterThanOrEqual(
      taskMap!.x - 1
    );
    expect(area.right, 'floor space fits inside the task map').toBeLessThanOrEqual(
      taskMap!.x + taskMap!.width + 1
    );
    expect(area.top, 'floor space fits inside the task map').toBeGreaterThanOrEqual(taskMap!.y - 1);
    expect(area.bottom, 'floor space fits inside the task map').toBeLessThanOrEqual(
      taskMap!.y + taskMap!.height + 1
    );
  }
  for (const ownerIndex of [0, 1, 2]) {
    await expect(page.locator(`.tasks-map__area--owner-${ownerIndex}`)).not.toHaveCount(0);
  }
  await expect(page.locator('.tasks-map__area--shared')).toHaveCount(2);
  await expect(page.locator('.tasks-map__area.is-selected')).toHaveAttribute(
    'data-space-id',
    kitchenId
  );
  const kitchenTaskMapArea = page.locator(`.tasks-map__area[data-space-id="${kitchenId}"]`);
  await expect(kitchenTaskMapArea).toHaveAttribute('aria-label', 'Cocina ampliada, Ana');
  await expect(kitchenTaskMapArea).not.toHaveClass(/tasks-map__area--shared/);
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

  const patioSpaceId = savedPlan.floors[0].spaces.find((space) => space.kind === 'patio')!.id;
  const patioOnTaskMap = page.locator(`.tasks-map__area[data-space-id="${patioSpaceId}"]`);
  await patioOnTaskMap.click();
  await expect(page.locator('.tasks-zone-heading h3')).toHaveText('Patio');
  await page.locator(`.tasks-map__area[data-space-id="${kitchenId}"]`).click();
  await expect(page.locator('.tasks-zone-heading h3')).toHaveText('Cocina ampliada');

  const taskTitles = Array.from({ length: 7 }, (_, index) => `Limpieza cocina ${index + 1}`);
  const createForm = page.locator('.tasks-create');
  const planningOptions = createForm.locator('.tasks-create__details');
  await expect(planningOptions.locator('.tasks-create__fields')).toBeHidden();
  await planningOptions.locator('summary').click();
  await expect(planningOptions.locator('.tasks-create__fields')).toBeVisible();
  for (const [index, title] of taskTitles.entries()) {
    await createForm.getByLabel('Nombre de la tarea').fill(title);
    await createForm.getByRole('button', { name: /^Día:/ }).click();
    await page.getByRole('option').nth(index).click();
    await createForm.getByRole('button', { name: /^Zona:/ }).click();
    await page.getByRole('option', { name: /^Cocina/ }).click();
    await page.getByRole('button', { name: 'Añadir a la semana' }).click();
  }
  await planningOptions.locator('summary').click();
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  await page.getByRole('button', { name: 'Proponer reparto' }).click();
  const preview = page.locator('[data-test="tasks-random-preview"]');
  await expect(preview).toBeVisible();
  const previewRows = preview.locator('li');
  await expect(previewRows).toHaveCount(7);
  const assignments = await previewRows.locator('strong').allTextContents();
  expect(new Set(assignments).size).toBe(3);
  expect(assignments.every((member) => activeMemberNames.includes(member))).toBe(true);
  for (let index = 1; index < assignments.length; index += 1) {
    expect(assignments[index]).not.toBe(assignments[index - 1]);
  }
  const loadCounts = [...new Set(assignments)].map(
    (member) => assignments.filter((assignment) => assignment === member).length
  );
  expect(Math.max(...loadCounts) - Math.min(...loadCounts)).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-test="tasks-save"]')).toBeDisabled();
  await screenshot(page, 'tasks-random-preview-desktop-or-mobile', viewport);
  await page.getByRole('button', { name: 'Usar este reparto' }).click();
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  for (const ratio of await primaryButtonContrast(page, '[data-test="tasks-save"]')) {
    expect(ratio, 'primary task actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(4.5);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const taskCards = page.locator('.task-card');
  await expect(taskCards).toHaveCount(7);
  await createForm.getByLabel('Nombre de la tarea').fill('Limpiar cocina');
  await fairAssignment.check();
  await expect(page.locator('.tasks-day__count').first()).toBeHidden();
  await expect(
    page.locator(mobile ? '.tasks-day__label-short' : '.tasks-day__label-full').first()
  ).toBeVisible();
  const firstTaskDetails = taskCards.first().locator('.task-card__details');
  await firstTaskDetails.locator('summary').click();
  await expect(firstTaskDetails.locator('.tasks-link--danger')).toBeVisible();
  await firstTaskDetails.locator('summary').click();
  const taskCardsFit = await taskCards.evaluateAll((cards) => {
    const bottomNavigation = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    const visibleBottom =
      bottomNavigation && bottomNavigation.height > 0 ? bottomNavigation.top : window.innerHeight;
    const rows = cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      return { top: Math.round(bounds.top), bottom: Math.round(bounds.bottom) };
    });
    return {
      visibleCount: rows.filter((row) => row.top >= 0 && row.bottom <= visibleBottom - 8).length,
      visibleBottom: Math.round(visibleBottom),
      rows
    };
  });
  expect(
    taskCardsFit.visibleCount,
    `the weekly list should begin on screen below the plan and task controls: ${JSON.stringify(taskCardsFit)}`
  ).toBeGreaterThanOrEqual(mobile ? 1 : 7);
  if (!mobile) {
    const saveActionBottom = await page
      .locator('[data-test="tasks-save"]')
      .evaluate((element) => Math.round(element.getBoundingClientRect().bottom));
    expect(
      saveActionBottom,
      'the primary week action should remain on screen after all seven assignments'
    ).toBeLessThanOrEqual(taskCardsFit.visibleBottom - 8);
  } else {
    const firstTaskHeight = await taskCards
      .first()
      .evaluate((element) => Math.round(element.getBoundingClientRect().height));
    expect(
      firstTaskHeight,
      'mobile task rows retain a comfortable touch height'
    ).toBeGreaterThanOrEqual(40);
    await page.evaluate(() => window.scrollTo(0, 0));
    const firstTaskRow = await taskCards.first().boundingBox();
    const visibleNavigation = await page.locator('.bottom-nav').boundingBox();
    const weekActions = await page.locator('.tasks-schedule__footer').boundingBox();
    expect(firstTaskRow).not.toBeNull();
    expect(visibleNavigation).not.toBeNull();
    expect(weekActions).not.toBeNull();
    await expect(page.locator('.tasks-schedule__footer')).toHaveCSS('position', 'static');
    expect(
      firstTaskRow!.y + firstTaskRow!.height,
      'at least one planned task should appear unobscured below the interactive plan without scrolling'
    ).toBeLessThanOrEqual(visibleNavigation!.y - 8);
    const firstTaskHit = await taskCards.first().evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      );
      return hit instanceof HTMLElement && element.contains(hit);
    });
    expect(firstTaskHit, 'the visible planned task must not be covered by week actions').toBe(true);
    const footerButtons = page.locator(
      '.tasks-schedule__footer > .tasks-button, .tasks-schedule__footer .tasks-editor__actions .tasks-button'
    );
    await expect(footerButtons).toHaveCount(3);
    for (const button of await footerButtons.all()) {
      await expect(button).toHaveCSS('white-space', 'nowrap');
      const textBounds = await button.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }));
      expect(textBounds.scrollWidth).toBeLessThanOrEqual(textBounds.clientWidth + 1);
    }
  }
  await screenshot(page, '05-weekly-tasks', viewport);
  if (mobile) {
    for (const size of [
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await captureResponsiveScreenshot(page, `05-weekly-tasks-${size.width}x${size.height}`, size);
    }
    await page.setViewportSize(viewport);
  }
  await page.getByRole('tab', { name: 'Plano' }).click();
  await page.getByRole('tab', { name: 'Tareas' }).click();
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  await expect(page.locator('.task-card')).toHaveCount(7);
  if (mobile) {
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth).toBeLessThanOrEqual(viewport.width);
  }
  const saveTasksResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/tasks')
  );
  await page.getByRole('button', { name: 'Guardar semana' }).click();
  const tasksResponse = await saveTasksResponse;
  expect(tasksResponse.status()).toBe(200);
  const savedTasksEnvelope = await tasksResponse.json();
  expect(savedTasksEnvelope.data.tasks).toHaveLength(7);
  expect(
    savedTasksEnvelope.data.tasks.every((task: { spaceId: string }) => task.spaceId === kitchenId)
  ).toBe(true);
  await expect(page.locator('.task-card')).toHaveCount(7);
  if (mobile) {
    for (const label of await page.locator('.task-card__member-name').all()) {
      const textLayout = await label.evaluate((element) => ({
        whiteSpace: getComputedStyle(element).whiteSpace,
        textOverflow: getComputedStyle(element).textOverflow,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      }));
      expect(textLayout.whiteSpace).toBe('normal');
      expect(textLayout.textOverflow).not.toBe('ellipsis');
      expect(textLayout.scrollHeight).toBeLessThanOrEqual(textLayout.clientHeight + 1);
    }
    await page
      .locator('.task-card')
      .last()
      .evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    const lastTask = await page.locator('.task-card').last().boundingBox();
    const saveButton = await page.locator('[data-test="tasks-save"]').boundingBox();
    const bottomNavigation = await page.locator('.bottom-nav').boundingBox();
    expect(lastTask).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(bottomNavigation).not.toBeNull();
    await expect(page.locator('.task-card').last()).toBeInViewport({ ratio: 0.5 });
    expect(lastTask!.y).toBeGreaterThanOrEqual(0);
    expect(lastTask!.y + lastTask!.height).toBeLessThanOrEqual(bottomNavigation!.y - 8);
    expect(saveButton!.y + saveButton!.height).toBeLessThanOrEqual(bottomNavigation!.y - 8);
  }
  await screenshot(page, 'tasks-saved-desktop-or-mobile', viewport, !mobile);
  if (mobile) await screenshot(page, 'tasks-agenda-mobile', viewport, false);

  // A field-level edit remains a local draft until saving and persists on reload.
  const editedTitle = 'Limpieza cocina editada';
  await page
    .locator('.task-card')
    .first()
    .locator('.task-card__fields input')
    .first()
    .fill(editedTitle);
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  for (const ratio of await primaryButtonContrast(page, '[data-test="tasks-save"]')) {
    expect(ratio, 'weekly task actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(4.5);
  }
  const editSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/tasks')
  );
  await page.getByRole('button', { name: 'Guardar semana' }).click();
  expect((await editSave).status()).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Tareas' }).click();
  await expect(page.locator('.task-card')).toHaveCount(7);
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
    { width: 389, height: 800 },
    { width: 390, height: 844 },
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
    if (size.width <= 359) {
      const footerButtons = page.locator(
        '.tasks-schedule__footer > .tasks-button, .tasks-schedule__footer .tasks-editor__actions .tasks-button'
      );
      for (const button of await footerButtons.all()) {
        const bounds = await button.evaluate((element) => ({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          height: element.getBoundingClientRect().height
        }));
        expect(
          bounds.scrollWidth,
          `footer label should fit at ${size.width}px`
        ).toBeLessThanOrEqual(bounds.clientWidth + 1);
        expect(bounds.height, 'mobile week actions must remain touch-sized').toBeGreaterThanOrEqual(
          44
        );
      }
    }
  }
});
