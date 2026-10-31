import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { mockAiFunctionAvailable } from './helpers/ai';
import { createHousehold } from './helpers/auth';
import { tapSvgPolygonInterior } from './helpers/plan-geometry';
import { assertSwitchGeometry, assertSwitchHitArea } from './helpers/switch-geometry';
import type {
  HouseholdPlan,
  HouseholdPlanPoint
} from '../../frontend/src/app/shared/models/household-plan.model';

async function registerForHousehold(page: Page, name: string): Promise<void> {
  await page.goto('/auth/register');
  await page.locator('input#name').waitFor({ state: 'visible' });
  await page.locator('input#name').fill(name);
  await page.locator('input#email').fill(`household-tasks-${randomUUID()}@example.test`);
  await page.locator('input#password').fill('Test1234');
  await page.locator('input#confirm-password').fill('Test1234');
  const registration = page.waitForResponse((response) =>
    response.url().includes('/api/auth/register')
  );
  await page.locator('button[type="submit"]').click();
  const response = await registration;
  expect(response.status(), await response.text()).toBe(201);
  await expect(page).toHaveURL(/\/(dashboard|onboarding|household)(\?|$)/, { timeout: 45000 });
  if (new URL(page.url()).pathname.endsWith('/onboarding')) {
    await page.getByRole('button', { name: /Saltar por ahora/i }).click();
    await expect(page).toHaveURL(/\/(dashboard|household)/, { timeout: 45000 });
  }
  await page.goto('/household');
}

async function mobileViewportBottom(page: Page): Promise<number> {
  return page.evaluate(() => window.innerHeight);
}

function fitSyntheticPlan(
  source: HouseholdPlan,
  shape: 'landscape' | 'portrait' | 'photo' | 'task' | 'task-mobile'
): HouseholdPlan {
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
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const scaleX =
      shape === 'portrait'
        ? 5800 / width
        : Math.min(shape === 'photo' ? 1.15 : shape === 'task' ? 1.3 : 1.25, 9600 / width);
    const scaleY =
      shape === 'portrait'
        ? 8800 / height
        : shape === 'task'
          ? Math.min(1.05, 9600 / height, (width * scaleX) / height)
          : shape === 'task-mobile'
            ? Math.min(1.05, 9600 / height, (width * scaleX) / (height * 1.3))
            : Math.min(1.15, 9600 / height);
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

function irregularSyntheticPlan(source: HouseholdPlan): HouseholdPlan {
  const plan = structuredClone(source);
  const floor = plan.floors[0];
  if (!floor) throw new Error('The synthetic household plan needs a ground floor');

  const kitchen = floor.spaces.find((space) => space.kind === 'kitchen');
  const livingRoom = floor.spaces.find((space) => space.kind === 'living_room');
  const garden = floor.spaces.find((space) => space.kind === 'garden');
  if (!kitchen || !livingRoom || !garden)
    throw new Error('The synthetic household plan needs a kitchen, living room, and garden');

  const bounds = (space: HouseholdPlan['floors'][number]['spaces'][number]) => ({
    minX: Math.min(...space.polygon.map((point) => point.x)),
    maxX: Math.max(...space.polygon.map((point) => point.x)),
    minY: Math.min(...space.polygon.map((point) => point.y)),
    maxY: Math.max(...space.polygon.map((point) => point.y))
  });
  const kitchenBounds = bounds(kitchen);
  const livingBounds = bounds(livingRoom);
  const gardenBounds = bounds(garden);
  const diagonalX = Math.round(
    kitchenBounds.maxX + (kitchenBounds.maxX - kitchenBounds.minX) * 0.08
  );
  const diagonalWall = floor.walls.find(
    (wall) =>
      wall.kind === 'interior' &&
      wall.from.x === wall.to.x &&
      wall.from.x === kitchenBounds.maxX &&
      wall.from.y === kitchenBounds.minY &&
      wall.to.y === kitchenBounds.maxY
  );
  if (!diagonalWall) throw new Error('The synthetic kitchen needs its shared interior wall');

  kitchen.polygon = [
    { x: kitchenBounds.minX, y: kitchenBounds.minY },
    { x: kitchenBounds.maxX, y: kitchenBounds.minY },
    { x: diagonalX, y: kitchenBounds.maxY },
    { x: kitchenBounds.minX, y: kitchenBounds.maxY }
  ];
  livingRoom.polygon = [
    { x: livingBounds.minX, y: livingBounds.minY },
    { x: livingBounds.maxX, y: livingBounds.minY },
    { x: livingBounds.maxX, y: livingBounds.maxY },
    { x: diagonalX, y: livingBounds.maxY },
    { x: diagonalX, y: kitchenBounds.maxY }
  ];
  diagonalWall.to = { x: diagonalX, y: kitchenBounds.maxY };

  const gardenWidth = gardenBounds.maxX - gardenBounds.minX;
  const gardenHeight = gardenBounds.maxY - gardenBounds.minY;
  const notchY = Math.round(gardenBounds.minY + gardenHeight * 0.62);
  const notchX = Math.round(gardenBounds.minX + gardenWidth * 0.62);
  garden.polygon = [
    { x: gardenBounds.minX, y: gardenBounds.minY },
    { x: gardenBounds.maxX, y: gardenBounds.minY },
    { x: gardenBounds.maxX, y: gardenBounds.maxY },
    { x: notchX, y: gardenBounds.maxY },
    { x: Math.round(gardenBounds.minX + gardenWidth * 0.42), y: notchY },
    { x: gardenBounds.minX, y: notchY }
  ];

  return fitSyntheticPlan(plan, 'photo');
}

function landscapePlan(source: HouseholdPlan): HouseholdPlan {
  return fitSyntheticPlan(source, 'landscape');
}

function portraitPlan(source: HouseholdPlan): HouseholdPlan {
  return fitSyntheticPlan(source, 'portrait');
}

function taskPlan(source: HouseholdPlan, mobile: boolean): HouseholdPlan {
  return fitSyntheticPlan(source, mobile ? 'task-mobile' : 'task');
}

function addAseoByBedrooms(source: HouseholdPlan): HouseholdPlan {
  const plan = structuredClone(source);
  const floor = plan.floors[0];
  if (!floor) throw new Error('The synthetic household plan needs a ground floor');

  const bathroom = floor.spaces.find((space) => space.kind === 'bathroom');
  const bedroom = floor.spaces.find((space) => space.kind === 'bedroom');
  const livingRoom = floor.spaces.find((space) => space.kind === 'living_room');
  if (!bathroom || !bedroom || !livingRoom)
    throw new Error('The synthetic household plan needs a bathroom, bedroom, and living room');

  const bounds = (space: HouseholdPlan['floors'][number]['spaces'][number]) => ({
    minX: Math.min(...space.polygon.map((point) => point.x)),
    maxX: Math.max(...space.polygon.map((point) => point.x)),
    minY: Math.min(...space.polygon.map((point) => point.y)),
    maxY: Math.max(...space.polygon.map((point) => point.y))
  });
  const bathroomBounds = bounds(bathroom);
  const bedroomBounds = bounds(bedroom);
  const livingBounds = bounds(livingRoom);
  const aseoRight = bedroomBounds.maxX;
  const aseoTop = bathroomBounds.minY;
  const aseoBottom = bathroomBounds.maxY;

  // Remove the lower-left overlap from the living area so the new washroom
  // shares a real wall with the bedroom and hall instead of sitting on top.
  livingRoom.polygon = [
    { x: livingBounds.minX, y: livingBounds.minY },
    { x: livingBounds.maxX, y: livingBounds.minY },
    { x: livingBounds.maxX, y: livingBounds.maxY },
    { x: aseoRight, y: livingBounds.maxY },
    { x: aseoRight, y: aseoTop },
    { x: livingBounds.minX, y: aseoTop }
  ];

  const topWall = floor.walls.find(
    (wall) =>
      wall.kind === 'interior' &&
      wall.from.y === aseoTop &&
      wall.to.y === aseoTop &&
      Math.min(wall.from.x, wall.to.x) === bathroomBounds.minX
  );
  const rightWall = floor.walls.find(
    (wall) =>
      wall.kind === 'interior' &&
      wall.from.x === aseoRight &&
      wall.to.x === aseoRight &&
      Math.min(wall.from.y, wall.to.y) === aseoBottom
  );
  const livingDivider = floor.walls.find(
    (wall) =>
      wall.kind === 'interior' &&
      wall.from.y === livingBounds.maxY &&
      wall.to.y === livingBounds.maxY &&
      Math.max(wall.from.x, wall.to.x) === livingBounds.maxX
  );
  if (!topWall || !rightWall || !livingDivider)
    throw new Error('The synthetic plan walls do not support the washroom adjustment');

  const topWallFarX = Math.max(topWall.from.x, topWall.to.x);
  if (topWall.from.x === topWallFarX) topWall.from.x = aseoRight;
  else topWall.to.x = aseoRight;
  const rightWallNearY = Math.min(rightWall.from.y, rightWall.to.y);
  if (rightWall.from.y === rightWallNearY) rightWall.from.y = aseoTop;
  else rightWall.to.y = aseoTop;
  const dividerNearX = Math.min(livingDivider.from.x, livingDivider.to.x);
  if (livingDivider.from.x === dividerNearX) livingDivider.from.x = aseoRight;
  else livingDivider.to.x = aseoRight;

  const aseoWallId = rightWall.id;
  floor.openings.push({
    id: 'opening-followup-aseo',
    wallId: aseoWallId,
    kind: 'door',
    offset: 260,
    width: 700,
    isMainEntrance: false
  });
  floor.spaces.push({
    id: 'space-followup-aseo',
    kind: 'toilet',
    label: 'Aseo',
    polygon: [
      { x: bathroomBounds.maxX, y: aseoTop },
      { x: aseoRight, y: aseoTop },
      { x: aseoRight, y: aseoBottom },
      { x: bathroomBounds.maxX, y: aseoBottom }
    ],
    parentSpaceId: null
  });

  return plan;
}

async function syntheticPlanImage(page: Page, desktop = false): Promise<Buffer> {
  const dataUrl = await page.evaluate((desktopPhoto) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = desktopPhoto ? 660 : 400;
    const paperTop = desktopPhoto ? -295 : -170;
    const paperHeight = desktopPhoto ? 590 : 340;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');

    const desk = context.createLinearGradient(0, 0, 0, canvas.height);
    desk.addColorStop(0, '#a9825e');
    desk.addColorStop(0.5, '#bd9c78');
    desk.addColorStop(1, '#96704f');
    context.fillStyle = desk;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(79, 49, 27, 0.12)';
    context.lineWidth = 2;
    for (let y = 8; y < canvas.height; y += 17) {
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(170, y - 5, 420, y + 5, canvas.width, y - 2);
      context.stroke();
    }

    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(-0.022);
    context.shadowColor = 'rgba(35, 27, 20, 0.28)';
    context.shadowBlur = 13;
    context.shadowOffsetY = 7;
    context.fillStyle = '#f2eee4';
    context.fillRect(-286, paperTop, 572, paperHeight);
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.save();
    context.beginPath();
    context.rect(-286, paperTop, 572, paperHeight);
    context.clip();
    context.strokeStyle = 'rgba(89, 131, 163, 0.22)';
    context.lineWidth = 1;
    for (let x = -280; x <= 280; x += 18) {
      context.beginPath();
      context.moveTo(x, paperTop);
      context.lineTo(x + 1, paperTop + paperHeight);
      context.stroke();
    }
    for (let y = paperTop + 6; y <= paperTop + paperHeight; y += 18) {
      context.beginPath();
      context.moveTo(-286, y);
      context.lineTo(286, y + 1);
      context.stroke();
    }

    context.save();
    if (desktopPhoto) context.scale(1, 1.8);
    const walls = [
      [
        [-226, -122],
        [214, -129],
        [220, 116],
        [-207, 126],
        [-226, -122]
      ],
      [
        [-88, -124],
        [-84, -12],
        [-222, -8]
      ],
      [
        [-84, -8],
        [-92, 126]
      ],
      [
        [-88, 54],
        [82, 48],
        [80, 121]
      ],
      [
        [82, -127],
        [75, 48]
      ],
      [
        [75, 48],
        [218, 44]
      ],
      [
        [-207, 20],
        [-88, 18]
      ],
      [
        [-88, -8],
        [75, -4]
      ]
    ];
    const drawWall = (offsetX = 0, offsetY = 0) => {
      context.beginPath();
      for (const [index, points] of walls.entries()) {
        context.moveTo(points[0][0] + offsetX, points[0][1] + offsetY);
        for (const point of points.slice(1)) {
          context.lineTo(point[0] + offsetX, point[1] + offsetY);
        }
        if (index === 1) context.moveTo(-84 + offsetX, -8 + offsetY);
      }
      context.stroke();
    };
    context.strokeStyle = '#2c3b50';
    context.lineWidth = 4.6;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    drawWall();
    context.globalAlpha = 0.2;
    context.lineWidth = 2;
    drawWall(2, -1);
    context.globalAlpha = 1;

    context.fillStyle = '#30415a';
    context.font = 'italic 17px cursive';
    context.rotate(-0.015);
    context.fillText('Cocina', -185, -62);
    context.fillText('Salón', -23, -65);
    context.fillText('Baño', -185, 42);
    context.fillText('Dormitorio', -159, 101);
    context.fillText('Patio', 122, -16);
    context.fillText('Entrada', 11, 151);
    context.restore();
    context.restore();
    context.restore();
    return canvas.toDataURL('image/png');
  }, desktop);
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
  await page.mouse.move(-20, -20);
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

async function openPlanZoneList(page: Page): Promise<void> {
  const advancedSettings = page.locator('.plan-editor__advanced-settings');
  const zoneDisclosure = page.locator('.plan-details__zones-disclosure');
  if ((await zoneDisclosure.getAttribute('open')) === null) {
    await expect(advancedSettings).toBeVisible();
    if ((await advancedSettings.getAttribute('open')) === null)
      await advancedSettings.locator('summary').click();
    await expect(zoneDisclosure).toBeVisible();
    await zoneDisclosure.locator('summary').click();
  }
  await expect(zoneDisclosure).toHaveAttribute('open', '');
  await expect(advancedSettings).not.toHaveAttribute('open');
  await expect(zoneDisclosure).toBeVisible();
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
  await page.getByRole('option', { name: optionName }).click();
}

test('el menú del plano alinea sus acciones y distingue la eliminación', async ({
  page
}, testInfo) => {
  const mobile = testInfo.project.name.startsWith('mobile-');
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 970 };
  await page.setViewportSize(viewport);
  await registerForHousehold(page, 'Ana');
  await createHousehold(page, 'Hogar sintético menú de opciones');
  await page.getByRole('tab', { name: 'Plano' }).click();
  await expect(page.locator('[data-test="plan-setup"]')).toBeVisible();
  await page.locator('[data-test="plan-dwelling-house"]').click();

  const floorCount = page.locator('[data-test="plan-floor-count"]');
  await floorCount.locator('button.picker__trigger').click();
  await floorCount.getByRole('option', { name: /^2(?:\s|$)/ }).click();
  await page.locator('[data-test="plan-method-guided"]').click();
  await page.getByRole('button', { name: 'Empezar plano' }).click();
  await expect(page.locator('[data-test="plan-setup"]')).toBeHidden();
  await expect(page.locator('[data-test="plan-floor-tabs"] .plan-floor-tabs__tab')).toHaveCount(2);
  const savePlan = page.locator('[data-test="plan-save"]');
  await expect(savePlan).toBeEnabled();
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/plan')
  );
  await savePlan.click();
  expect((await saveResponse).status()).toBe(200);
  await expect(savePlan).toBeDisabled();

  const advanced = page.locator('.plan-editor__advanced-settings');
  await advanced.locator('summary').click();
  const menu = advanced.locator('.plan-editor__advanced-settings-content');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Eliminar planta' })).toBeVisible();
  const discardAction = menu.getByRole('button', { name: 'Descartar cambios' });
  await expect(discardAction).toBeDisabled();
  const discardDisabledStyle = await discardAction.evaluate((button) => {
    const styles = getComputedStyle(button);
    return { opacity: Number(styles.opacity), cursor: styles.cursor };
  });
  expect.soft(discardDisabledStyle.opacity).toBeGreaterThanOrEqual(0.5);
  expect.soft(discardDisabledStyle.cursor).toBe('not-allowed');
  if (mobile) {
    const snapSwitch = menu.locator('[data-test="plan-snap-grid-mobile"]');
    await expect(snapSwitch).toHaveRole('switch');
    await expect(snapSwitch).toHaveAccessibleName('Ajustar a cuadrícula');
    const originalState = await snapSwitch.getAttribute('aria-checked');
    for (let stateIndex = 0; stateIndex < 2; stateIndex += 1) {
      const checked = (await snapSwitch.getAttribute('aria-checked')) === 'true';
      const expectedLeftInset = checked ? 19 : 3;
      await expect
        .poll(async () =>
          snapSwitch.evaluate((element, expectedInset) => {
            const track = element.querySelector('[data-switch-track]')!.getBoundingClientRect();
            const thumb = element.querySelector('[data-switch-thumb]')!.getBoundingClientRect();
            return Math.abs(thumb.left - track.left - expectedInset);
          }, expectedLeftInset)
        )
        .toBeLessThanOrEqual(1);
      const switchGeometry = await snapSwitch.evaluate((element) => {
        const host = element.getBoundingClientRect();
        const track = element.querySelector('[data-switch-track]')!.getBoundingClientRect();
        const thumb = element.querySelector('[data-switch-thumb]')!.getBoundingClientRect();
        return {
          hitTargetWidth: host.width,
          hitTargetHeight: host.height,
          trackCenterOffset: Math.abs(track.left + track.width / 2 - host.left - 22),
          thumbCenterOffset: Math.abs(thumb.top + thumb.height / 2 - track.top - track.height / 2),
          leftInset: thumb.left - track.left,
          rightInset: track.right - thumb.right
        };
      });
      expect.soft(switchGeometry.hitTargetWidth).toBeGreaterThanOrEqual(44);
      expect.soft(switchGeometry.hitTargetHeight).toBeGreaterThanOrEqual(44);
      expect.soft(switchGeometry.trackCenterOffset).toBeLessThanOrEqual(1);
      expect.soft(switchGeometry.thumbCenterOffset).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(switchGeometry.leftInset - expectedLeftInset)).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(switchGeometry.rightInset - (checked ? 3 : 19))).toBeLessThanOrEqual(1);
      console.info(`[switch:geometry] ${JSON.stringify({ checked, ...switchGeometry })}`);
      await snapSwitch.click();
      await expect(snapSwitch).toHaveAttribute(
        'aria-checked',
        stateIndex === 0 ? (originalState === 'true' ? 'false' : 'true') : originalState!
      );
    }
  }
  const toastClose = page.locator('.toast-container--top .toast__close');
  if (await toastClose.isVisible()) await toastClose.click();
  await screenshot(
    page,
    mobile ? '08-options-menu-mobile-after' : '08-options-menu-desktop-after',
    viewport
  );

  const drawAreaAction = menu.locator('[data-test="plan-draw-area"]');
  await drawAreaAction.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const focusState = await drawAreaAction.evaluate((button) => ({
    keyboardFocus: button.matches(':focus-visible'),
    outlineStyle: getComputedStyle(button).outlineStyle,
    outlineWidth: getComputedStyle(button).outlineWidth
  }));
  expect(focusState.keyboardFocus, 'drawing action is reachable with visible keyboard focus').toBe(
    true
  );
  expect(focusState.outlineStyle).toBe('solid');
  expect(Number.parseFloat(focusState.outlineWidth)).toBeGreaterThanOrEqual(2);
  await drawAreaAction.evaluate((button) => button.blur());

  const menuActions = [
    menu.locator('[data-test="plan-draw-area"]'),
    menu.locator('[data-test="plan-add-floor"]'),
    menu.locator('[data-test="plan-add-basement"]'),
    menu.locator('[data-test="plan-remove-floor"]'),
    menu.getByRole('button', { name: 'Descartar cambios' })
  ];
  const actionGeometry = await Promise.all(
    menuActions.map((button) =>
      button.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const contents = element.querySelector<HTMLElement>('.plan-menu-action__content');
        const contentBounds = contents?.getBoundingClientRect();
        return {
          testId: element.getAttribute('data-test'),
          height: bounds.height,
          width: bounds.width,
          contentCenterOffset: contentBounds
            ? Math.abs(
                contentBounds.left + contentBounds.width / 2 - bounds.left - bounds.width / 2
              )
            : Infinity,
          contentVerticalOffset: contentBounds
            ? Math.abs(
                contentBounds.top + contentBounds.height / 2 - bounds.top - bounds.height / 2
              )
            : Infinity,
          iconCount: element.querySelectorAll('svg').length
        };
      })
    )
  );
  console.info(`[menu:after] ${JSON.stringify({ viewport, actionGeometry })}`);
  expect.soft(actionGeometry.length, 'all five menu actions are audited').toBe(5);
  for (const action of actionGeometry) {
    expect
      .soft(action.height, `${action.testId ?? 'discard'} has a consistent 44px height`)
      .toBe(44);
    expect
      .soft(action.contentCenterOffset, `${action.testId ?? 'discard'} centers icon and label`)
      .toBeLessThanOrEqual(1);
    expect
      .soft(
        action.contentVerticalOffset,
        `${action.testId ?? 'discard'} centers icon and label vertically`
      )
      .toBeLessThanOrEqual(1);
    expect.soft(action.iconCount, `${action.testId ?? 'discard'} has an aligned SVG icon`).toBe(1);
    expect
      .soft(
        Math.abs(action.width - actionGeometry[0].width),
        `${action.testId ?? 'discard'} shares the menu action width`
      )
      .toBeLessThanOrEqual(1);
  }

  const [addFloor, addBasement] = actionGeometry.filter((action) =>
    ['plan-add-floor', 'plan-add-basement'].includes(action.testId ?? '')
  );
  expect
    .soft(
      Math.abs(addFloor!.width - addBasement!.width),
      'plant actions align on the same full-width track'
    )
    .toBeLessThanOrEqual(1);

  const dangerColors = await menu.locator('[data-test="plan-remove-floor"]').evaluate((button) => {
    const style = getComputedStyle(button);
    const color = style.color;
    const background = style.backgroundColor;
    button.style.color = 'var(--color-error-700)';
    button.style.backgroundColor = 'var(--error-subtle)';
    const error = getComputedStyle(button).color;
    const errorSubtle = getComputedStyle(button).backgroundColor;
    button.style.removeProperty('color');
    button.style.removeProperty('background-color');
    return {
      className: button.className,
      color,
      background,
      error,
      errorSubtle
    };
  });
  expect.soft(dangerColors.className).toContain('plan-button--danger');
  expect.soft(dangerColors.color, 'delete action uses the danger token').toBe(dangerColors.error);
  expect
    .soft(dangerColors.background, 'delete action uses the danger surface token')
    .toBe(dangerColors.errorSubtle);
  const dangerContrastRatios = await primaryButtonContrast(page, '[data-test="plan-remove-floor"]');
  console.info(`[menu:danger] ${JSON.stringify({ dangerColors, dangerContrastRatios })}`);
  for (const ratio of dangerContrastRatios) {
    expect
      .soft(ratio, 'delete action text meets WCAG AA in both themes')
      .toBeGreaterThanOrEqual(4.5);
  }

  await drawAreaAction.click();
  await expect(advanced).not.toHaveAttribute('open', '');
  await expect(drawAreaAction).toHaveAttribute('aria-pressed', 'true');
  await expect(drawAreaAction).toHaveClass(/is-selected/);
  const selectedDrawColors = await drawAreaAction.evaluate((button) => {
    const style = getComputedStyle(button);
    const color = style.color;
    const background = style.backgroundColor;
    button.style.color = 'var(--primary-dark)';
    button.style.backgroundColor = 'var(--primary-subtle)';
    const primaryDark = getComputedStyle(button).color;
    const primarySubtle = getComputedStyle(button).backgroundColor;
    button.style.removeProperty('color');
    button.style.removeProperty('background-color');
    return { color, background, primaryDark, primarySubtle };
  });
  expect(selectedDrawColors.color).toBe(selectedDrawColors.primaryDark);
  expect(selectedDrawColors.background).toBe(selectedDrawColors.primarySubtle);
  await advanced.locator('summary').click();
  await expect(menu).toBeVisible();
  await screenshot(
    page,
    mobile ? '08-options-menu-draw-selected-mobile' : '08-options-menu-draw-selected-desktop',
    viewport
  );

  if (mobile) {
    for (const size of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 568, height: 320 },
      { width: 568, height: 399 },
      { width: 568, height: 400 },
      { width: 568, height: 401 },
      { width: 766, height: 844 },
      { width: 767, height: 844 },
      { width: 768, height: 844 }
    ]) {
      await page.setViewportSize(size);
      await expect(menu).toBeVisible();
      const bounds = await menu.boundingBox();
      expect(bounds).not.toBeNull();
      expect.soft(bounds!.x).toBeGreaterThanOrEqual(8);
      expect.soft(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width - 8);
      const menuFlow = await menu.evaluate((element) => {
        const header = document.querySelector('.header')?.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        return {
          top: bounds.top,
          bottom: bounds.bottom,
          headerBottom: header?.bottom ?? 0,
          viewportBottom: window.innerHeight,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: styles.overflowY
        };
      });
      const menuFitsViewport = menuFlow.bottom <= menuFlow.viewportBottom - 8;
      const menuCanScroll =
        menuFlow.scrollHeight > menuFlow.clientHeight &&
        ['auto', 'scroll'].includes(menuFlow.overflowY);
      expect
        .soft(
          menuFitsViewport || menuCanScroll,
          `menu fits the viewport or has its own scroll at ${size.width}×${size.height}: ${JSON.stringify(menuFlow)}`
        )
        .toBe(true);
      if (size.height <= 400) {
        expect
          .soft(
            menuFlow.top,
            `short-screen menu starts below the fixed header at ${size.width}×${size.height}: ${JSON.stringify(menuFlow)}`
          )
          .toBeGreaterThanOrEqual(menuFlow.headerBottom + 8);
      }
      if (size.width === 320 && size.height === 568) {
        const firstFloorAction = await menu.locator('[data-test="plan-add-floor"]').boundingBox();
        expect(firstFloorAction).not.toBeNull();
        expect
          .soft(firstFloorAction!.y + firstFloorAction!.height)
          .toBeLessThanOrEqual(menuFlow.bottom + 1);
      }
      if (menuCanScroll) {
        const finalAction = menu.locator('[data-test="plan-discard-changes"]');
        await menu.locator('.plan-editor__floor-name input').fill('Planta editada para prueba');
        await expect(finalAction).toBeEnabled();
        await menu.locator('[data-test="plan-draw-area"]').focus();
        for (let tabIndex = 0; tabIndex < 12; tabIndex += 1) {
          await page.keyboard.press('Tab');
          if (await finalAction.evaluate((element) => element === document.activeElement)) break;
        }
        await expect(finalAction).toBeFocused();
        const finalActionBounds = await finalAction.boundingBox();
        const visibleMenuBounds = await menu.boundingBox();
        expect(finalActionBounds).not.toBeNull();
        expect(visibleMenuBounds).not.toBeNull();
        const scrolledMenu = await menu.evaluate((element) => element.scrollTop);
        expect
          .soft(scrolledMenu, 'the final menu action is reachable by scrolling')
          .toBeGreaterThan(0);
        expect.soft(finalActionBounds!.y).toBeGreaterThanOrEqual(visibleMenuBounds!.y - 1);
        expect
          .soft(finalActionBounds!.y + finalActionBounds!.height)
          .toBeLessThanOrEqual(visibleMenuBounds!.y + visibleMenuBounds!.height + 1);
        const viewportOverflow = await finalAction.evaluate((element) => {
          const action = element.getBoundingClientRect();
          return action.top < -1 || action.bottom > window.innerHeight + 1;
        });
        expect
          .soft(viewportOverflow, 'the final menu action remains inside the viewport')
          .toBe(false);
        if (size.width === 568 && size.height === 320) {
          await screenshot(page, '08-options-menu-568x320-final-action', size);
        }
        await menu.evaluate((element) => {
          element.scrollTop = 0;
        });
        await advanced.locator('summary').focus();
      }
      await screenshot(page, `08-options-menu-${size.width}x${size.height}`, size);
    }
  }
});

async function assignZone(
  page: Page,
  zoneName: string,
  memberIndices: number[],
  persist = true
): Promise<void> {
  const zone = page.locator('.plan-details__area').filter({ hasText: zoneName }).first();
  const mapZones = page.locator('.plan-canvas [data-space-id]');
  const mapZoneIndex = await mapZones.evaluateAll(
    (elements, name) =>
      elements.findIndex((element) => element.getAttribute('aria-label') === name),
    zoneName
  );
  if (mapZoneIndex >= 0) {
    const mapZone = mapZones.nth(mapZoneIndex);
    if ((page.viewportSize()?.width ?? 1440) <= 767) {
      await tapSvgPolygonInterior(mapZone);
    } else {
      await mapZone.click();
    }
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
  if (persist && (await saveButton.isEnabled())) {
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
  const mobile = testInfo.project.name.startsWith('mobile-');
  const viewport = mobile ? { width: 390, height: 950 } : { width: 1280, height: 970 };

  await mockAiFunctionAvailable(page, ['planning', 'assistant']);
  await registerForHousehold(page, 'Ana');
  await createHousehold(page, 'Hogar sintético de plano y tareas');
  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
  expect(inviteCode).toBeTruthy();

  for (const memberName of ['Leo', 'Nora']) {
    const memberContext = await browser.newContext({ locale: 'es-ES' });
    const memberPage = await memberContext.newPage();
    try {
      await registerForHousehold(memberPage, memberName);
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
    for (const tabName of ['Hogar', 'Plano', 'Planificación', 'Miembros', 'Permisos', 'Ajustes']) {
      await expect(householdTabs.getByRole('tab', { name: tabName })).toBeVisible();
    }
    await expect(householdTabs.getByRole('tab', { name: 'Plano' })).toBeInViewport();
    const tabDimensions = await householdTabs.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    expect(
      tabDimensions.scrollWidth,
      'long household tabs scroll instead of compressing their labels'
    ).toBeGreaterThan(tabDimensions.clientWidth);
    const pageWidths = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      layoutViewportWidth: document.documentElement.clientWidth
    }));
    expect(
      pageWidths.documentWidth,
      'the scrollable household tab row does not cause layout-viewport overflow'
    ).toBeLessThanOrEqual(pageWidths.layoutViewportWidth);
    for (const width of [320, 359, 360, 389, 390]) {
      await page.setViewportSize({ width, height: 568 });
      const tabLayout = await householdTabs.evaluate((element) =>
        Array.from(element.querySelectorAll<HTMLButtonElement>('[role="tab"]')).map((tab) => {
          const bounds = tab.getBoundingClientRect();
          const labelBounds = document.createRange();
          labelBounds.selectNodeContents(tab);
          const label = labelBounds.getBoundingClientRect();
          return {
            text: tab.innerText,
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            labelLeft: label.left,
            labelRight: label.right
          };
        })
      );
      expect(tabLayout, `all six household tabs exist at ${width}px`).toHaveLength(6);
      for (let index = 1; index < tabLayout.length; index += 1) {
        expect(tabLayout[index].left).toBeGreaterThanOrEqual(tabLayout[index - 1].right - 1);
        expect(
          tabLayout[index].labelLeft,
          `household tab labels do not overlap at ${width}px: ${JSON.stringify(tabLayout)}`
        ).toBeGreaterThanOrEqual(tabLayout[index - 1].labelRight - 1);
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
    await expect(page).toHaveURL(/tab=settings/);
    await expect
      .poll(async () => {
        return householdTabs.evaluate((element) => {
          const selected = element.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
          const selectedBounds = selected?.getBoundingClientRect();
          const listBounds = element.getBoundingClientRect();
          return (
            !!selectedBounds &&
            selectedBounds.left >= listBounds.left - 1 &&
            selectedBounds.right <= listBounds.right + 1
          );
        });
      })
      .toBe(true);
    await planTab.click();
    await expect(planTab).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize(viewport);
  }
  await expect(page.locator('[data-test="plan-setup"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-method-canvas"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-method-photo"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-method-guided"]')).toBeVisible();
  await expect(
    page.locator('.plan-method-card[aria-pressed="true"]'),
    'the three entry methods stay neutral until the user chooses one'
  ).toHaveCount(0);
  const methodChevronIcons = page.locator('.plan-method-card__chevron svg');
  if (mobile) {
    await expect(methodChevronIcons, 'mobile method cards use proper chevron icons').toHaveCount(3);
    const chevronGeometry = await methodChevronIcons.evaluateAll((icons) =>
      icons.map((icon) => {
        const bounds = icon.getBoundingClientRect();
        const card = icon.closest('.plan-method-card')?.getBoundingClientRect();
        return {
          width: bounds.width,
          height: bounds.height,
          stroke: icon.querySelector('path')
            ? getComputedStyle(icon.querySelector('path')!).stroke
            : '',
          strokeWidth: icon.querySelector('path')
            ? getComputedStyle(icon.querySelector('path')!).strokeWidth
            : '',
          verticalOffset: card
            ? Math.abs(bounds.top + bounds.height / 2 - card.top - card.height / 2)
            : Infinity
        };
      })
    );
    for (const geometry of chevronGeometry) {
      expect(geometry.width, 'method chevrons match the shared icon size').toBe(18);
      expect(geometry.height, 'method chevrons remain square').toBe(18);
      expect(geometry.strokeWidth, 'method chevrons match the prototype stroke weight').toBe(
        '2.2px'
      );
      expect(geometry.stroke, 'method chevrons use the prototype navy icon color').toBe(
        'rgb(32, 52, 73)'
      );
      expect(
        geometry.verticalOffset,
        'method chevrons align to the card center'
      ).toBeLessThanOrEqual(1);
    }
    const darkThemeChevronColor = await page.locator('html').evaluate((html) => {
      const previousTheme = html.getAttribute('data-theme');
      html.setAttribute('data-theme', 'dark');
      const chevronPath = html.querySelector('.plan-method-card__chevron path');
      const color = chevronPath ? getComputedStyle(chevronPath).stroke : '';
      if (previousTheme === null) html.removeAttribute('data-theme');
      else html.setAttribute('data-theme', previousTheme);
      return color;
    });
    expect(darkThemeChevronColor, 'method chevrons retain contrast in dark theme').toBe(
      'rgb(250, 250, 249)'
    );
  } else {
    await expect(
      page.locator('.plan-method-card__chevron').first(),
      'desktop method cards omit the mobile-only directional affordance from the prototype'
    ).toBeHidden();
  }
  await page.locator('[data-test="plan-dwelling-house"]').click();
  await expect(
    page.locator('.plan-setup__dwelling-card[aria-pressed="true"]'),
    'only one dwelling type may appear selected'
  ).toHaveCount(1);
  const selectedDwellingIcon = await page
    .locator('.plan-setup__dwelling-card[aria-pressed="true"] svg path')
    .first()
    .evaluate((path) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--primary)';
      document.body.append(probe);
      const primary = getComputedStyle(probe).color;
      probe.remove();
      return { stroke: getComputedStyle(path).stroke, primary };
    });
  expect(selectedDwellingIcon.stroke, 'the chosen home type uses the prototype orange icon').toBe(
    selectedDwellingIcon.primary
  );
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
    const methodIcon = await page.locator('.plan-method-card__icon').first().boundingBox();
    expect(
      methodIcon?.width,
      'mobile entry icons match the approved drawing scale'
    ).toBeGreaterThanOrEqual(56);
    const methodTitle = await page.locator('.plan-method-card strong').first().boundingBox();
    expect(methodTitle).not.toBeNull();
    expect(
      (methodIcon?.x ?? 0) + (methodIcon?.width ?? 0),
      'the enlarged method glyph keeps clear of its title'
    ).toBeLessThanOrEqual(methodTitle!.x - 4);
  } else {
    const desktopFloorGeometry = await page.evaluate(() => {
      const dwellingHeading = document
        .querySelector('.plan-setup__dwelling-types h3')
        ?.getBoundingClientRect();
      const floorGroup = document.querySelector('.plan-setup__floor-count');
      const floorLabel = floorGroup?.querySelector(':scope > span')?.getBoundingClientRect();
      const floorPicker = floorGroup?.querySelector('app-picker')?.getBoundingClientRect();
      if (!dwellingHeading || !floorLabel || !floorPicker) {
        throw new Error('The desktop dwelling and floor-count fields must be present');
      }
      return {
        dwellingHeadingTop: dwellingHeading.top,
        floorLabelTop: floorLabel.top,
        pickerWidth: floorPicker.width
      };
    });
    expect(
      Math.abs(desktopFloorGeometry.dwellingHeadingTop - desktopFloorGeometry.floorLabelTop),
      'desktop floor label aligns with dwelling type heading'
    ).toBeLessThanOrEqual(1);
    expect(desktopFloorGeometry.pickerWidth, 'desktop floor picker matches prototype width').toBe(
      168
    );
    const methodIcon = await page.locator('.plan-method-card__icon').first().boundingBox();
    expect(
      methodIcon?.width,
      'desktop entry icons match the approved drawing scale'
    ).toBeGreaterThanOrEqual(96);
  }
  for (const ratio of await primaryButtonContrast(page, '[data-test="plan-start"]')) {
    expect(ratio, 'primary plan actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(4.5);
  }
  await screenshot(page, '01-plan-start', viewport);
  if (mobile) {
    const startButton = await page.locator('[data-test="plan-start"]').boundingBox();
    const viewportBottom = await mobileViewportBottom(page);
    expect(startButton).not.toBeNull();
    expect(startButton!.y + startButton!.height).toBeLessThanOrEqual(viewportBottom - 8);
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
  await expect(page.locator('[data-test="plan-undo"] svg')).toBeVisible();
  await expect(page.locator('[data-test="plan-redo"] svg')).toBeVisible();
  await expect(page.locator('[data-test="plan-floor-tabs"] .plan-floor-tabs__tab')).toHaveCount(2);
  const floorTabsControl = page.locator('[data-test="plan-floor-tabs"] .plan-floor-tabs__tab');
  const emptyCanvasState = page.locator('[data-test="plan-canvas-empty"]');
  await expect(
    page.locator('.plan-canvas__grid'),
    'the canvas must not layer a second grid over the viewport grid'
  ).toHaveCount(0);
  await expect(
    page.locator('.plan-canvas__paper'),
    'the drawing surface must stay transparent over the single canvas grid'
  ).toHaveCount(0);
  const canvasSurfaceStyle = await page.locator('.plan-canvas__viewport').evaluate((viewport) => ({
    grid: getComputedStyle(viewport).backgroundImage,
    drawingSurface: getComputedStyle(viewport.querySelector('.plan-canvas')!).backgroundColor
  }));
  expect(canvasSurfaceStyle.grid, 'the viewport owns one continuous grid').toContain(
    'radial-gradient'
  );
  expect(canvasSurfaceStyle.drawingSurface, 'the SVG does not mask that grid with a paper').toBe(
    'rgba(0, 0, 0, 0)'
  );
  await floorTabsControl.nth(1).click();
  await expect(emptyCanvasState, 'a blank floor gets one clear start hint').toBeVisible();
  await expect(
    emptyCanvasState.locator('svg'),
    'the empty-state cue uses a matching plan icon'
  ).toBeVisible();
  const emptyStateLayout = await emptyCanvasState.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const icon = element.querySelector('svg')?.getBoundingClientRect();
    const text = element.querySelector('span')?.getBoundingClientRect();
    return {
      width: bounds.width,
      iconWidth: icon?.width ?? 0,
      iconHeight: icon?.height ?? 0,
      centerOffset:
        icon && text
          ? Math.abs(icon.top + icon.height / 2 - (text.top + text.height / 2))
          : Infinity
    };
  });
  expect(emptyStateLayout.iconWidth, 'the empty-state icon shares the action icon scale').toBe(18);
  expect(emptyStateLayout.iconHeight, 'the empty-state icon remains square').toBe(18);
  expect(
    emptyStateLayout.centerOffset,
    'empty-state icon and copy share a visual center'
  ).toBeLessThanOrEqual(1);
  await screenshot(page, '02-plan-editor-empty-floor', viewport);
  const advancedSettings = page.locator('.plan-editor__advanced-settings');
  const advancedPanel = page.locator('.plan-editor__advanced-settings-content');
  const assertAdvancedPanelBelowDescription = async () => {
    const geometry = await advancedPanel.evaluate((panel) => {
      const editor = panel.closest('.plan-editor');
      const header = editor?.querySelector('.plan-editor__header') ?? null;
      const description = header?.querySelector(':scope > div:first-child p') ?? null;
      const summary = panel.parentElement?.querySelector(':scope > summary') ?? null;
      const rect = (element: Element | null) => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
          top: Math.round(bounds.top * 100) / 100,
          bottom: Math.round(bounds.bottom * 100) / 100,
          left: Math.round(bounds.left * 100) / 100,
          right: Math.round(bounds.right * 100) / 100,
          width: Math.round(bounds.width * 100) / 100,
          height: Math.round(bounds.height * 100) / 100
        };
      };
      const style = getComputedStyle(panel);
      return {
        scrollY: window.scrollY,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        detailsOpen: (panel.parentElement as HTMLDetailsElement | null)?.open ?? false,
        panelPosition: style.position,
        panelDisplay: style.display,
        header: rect(header),
        description: rect(description),
        summary: rect(summary),
        panel: rect(panel)
      };
    });
    const clearance =
      geometry.panel && geometry.description
        ? Number(geometry.panel.top) - Number(geometry.description.bottom)
        : Number.NEGATIVE_INFINITY;
    expect(
      clearance,
      `the mobile options panel starts after the plan description: ${JSON.stringify(geometry)}`
    ).toBeGreaterThanOrEqual(0);
  };
  if (mobile) {
    await advancedSettings.locator('summary').click();
    const headerDescription = page.locator('.plan-editor__header > div:first-child p');
    await expect(advancedPanel).toBeVisible();
    await assertAdvancedPanelBelowDescription();
    await expect(headerDescription).toBeVisible();
  }
  const snapSwitchSelector = mobile
    ? '[data-test="plan-snap-grid-mobile"]'
    : '[data-test="plan-snap-grid"]';
  await assertSwitchGeometry(page, snapSwitchSelector);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator(snapSwitchSelector).scrollIntoViewIfNeeded();
  await screenshot(page, '07-plan-snap-switch', viewport, false);
  if (mobile) {
    for (const size of [
      { width: 320, height: 568 },
      { width: 568, height: 320 }
    ]) {
      await page.setViewportSize(size);
      await assertAdvancedPanelBelowDescription();
      await page.locator(snapSwitchSelector).scrollIntoViewIfNeeded();
      await assertSwitchHitArea(page, snapSwitchSelector);
    }
    await page.setViewportSize(viewport);
    await advancedSettings.locator('summary').click();
  }
  await page.locator('[data-test="plan-tool-freeform"]').click();
  await expect(
    emptyCanvasState,
    'the generic hint leaves room for active drawing guidance'
  ).toBeHidden();
  await expect(page.locator('[data-test="plan-freeform-actions"]')).toBeVisible();
  await screenshot(page, '02-plan-editor-empty-freeform', viewport);
  await page.locator('.plan-canvas-toolbar__tools .plan-tool').first().click();
  await expect(
    emptyCanvasState,
    'returning to selection restores the blank-floor hint'
  ).toBeVisible();
  await floorTabsControl.first().click();
  if (mobile) {
    await expect(page.locator('.plan-editor__toolbar-actions .plan-snap-control')).toBeHidden();
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
  const selectPointerFill = await page
    .locator('.plan-tool')
    .first()
    .locator('svg path')
    .evaluate((path) => getComputedStyle(path).fill);
  expect(selectPointerFill, 'the selected pointer uses the prototype filled glyph').not.toBe(
    'none'
  );
  if (!mobile) {
    const starterCanvas = await page.locator('.plan-canvas').boundingBox();
    expect(starterCanvas?.width, 'desktop canvas uses the wide map area').toBeGreaterThanOrEqual(
      500
    );
  }
  await expect(page.locator('.plan-canvas [data-space-id]')).toHaveCount(7);
  await expect(page.locator('.plan-canvas svg[householdAreaGlyph]')).toHaveCount(7);
  const starterGeometry = await page.locator('.plan-canvas').evaluate((svg) => {
    const bedroom = svg.querySelector<SVGPolygonElement>(
      '.plan-canvas__space[data-kind="bedroom"]'
    );
    const bedroomPoints = (bedroom?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((point) => point.split(',').map(Number));
    const nonRectangularRoom = bedroomPoints.some((point, index) => {
      const next = bedroomPoints[(index + 1) % bedroomPoints.length];
      return point[0] !== next[0] && point[1] !== next[1];
    });
    const angledWall = Array.from(svg.querySelectorAll<SVGLineElement>('.plan-canvas__wall')).some(
      (wall) =>
        wall.getAttribute('x1') !== wall.getAttribute('x2') &&
        wall.getAttribute('y1') !== wall.getAttribute('y2')
    );
    const footprintBounds = Array.from(
      svg.querySelectorAll<SVGGraphicsElement>('.plan-canvas__space, .plan-canvas__wall')
    ).reduce(
      (bounds, element) => {
        const box = element.getBBox();
        return {
          left: Math.min(bounds.left, box.x),
          top: Math.min(bounds.top, box.y),
          right: Math.max(bounds.right, box.x + box.width),
          bottom: Math.max(bounds.bottom, box.y + box.height)
        };
      },
      { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: 0, bottom: 0 }
    );
    return {
      nonRectangularRoom,
      angledWall,
      footprintAspectRatio:
        (footprintBounds.right - footprintBounds.left) /
        (footprintBounds.bottom - footprintBounds.top)
    };
  });
  expect(starterGeometry.nonRectangularRoom, 'the guided plan shows a non-rectangular room').toBe(
    true
  );
  expect(starterGeometry.angledWall, 'the guided plan shows a diagonal wall').toBe(true);
  expect(
    starterGeometry.footprintAspectRatio,
    'the starter floor footprint keeps the near-square silhouette of the approved assignment prototype'
  ).toBeGreaterThanOrEqual(0.92);
  expect(starterGeometry.footprintAspectRatio).toBeLessThanOrEqual(1.04);
  await expect(page.locator('.plan-canvas__door-leaf')).toHaveCount(4);
  await expect(page.locator('.plan-canvas__door-swing')).toHaveCount(4);
  await expect(page.locator('.plan-canvas__window-rail')).toHaveCount(6);
  const kitchenFill = await page
    .locator('.plan-canvas__space[data-kind="kitchen"]')
    .first()
    .evaluate((space) => getComputedStyle(space).fill);
  expect(kitchenFill, 'unassigned indoor rooms stay white while drawing').toBe(
    'rgb(255, 255, 255)'
  );
  const zoneDisclosure = page.locator('.plan-details__zones-disclosure');
  await expect(page.locator('.plan-editor__advanced-settings')).toBeVisible();
  const advancedSettingsToggle = page.locator('.plan-editor__advanced-settings > summary');
  await expect(
    advancedSettingsToggle.locator('svg'),
    'the overflow control uses the product icon system'
  ).toBeVisible();
  await expect(advancedSettingsToggle).toHaveAccessibleName('Más opciones');
  await expect(zoneDisclosure, 'zone list is tucked into accessible More options').toBeHidden();
  const prototypeGlyphSizes = await page.evaluate(() => ({
    tool: document.querySelector('.plan-tool svg')?.getBoundingClientRect().width,
    room: document.querySelector('.plan-room-chip svg')?.getBoundingClientRect().width
  }));
  expect(prototypeGlyphSizes).toEqual({ tool: 32, room: 32 });
  const quickAddIcons = await page
    .locator('.plan-canvas-toolbar__rooms > button > svg')
    .evaluateAll((icons) =>
      icons.map((icon) => {
        const bounds = icon.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      })
    );
  expect(quickAddIcons, 'all six quick-add room buttons have matching icons').toHaveLength(6);
  for (const icon of quickAddIcons) {
    expect(icon.width, 'quick-add icons match the approved 32 px glyph').toBe(32);
    expect(icon.height, 'quick-add icons use consistent square geometry').toBe(32);
  }
  if (!mobile) {
    const previewAction = await page.locator('.plan-editor__header-actions').boundingBox();
    const editorBounds = await page.locator('.plan-editor').boundingBox();
    expect(previewAction).not.toBeNull();
    expect(editorBounds).not.toBeNull();
    expect(previewAction!.width, 'desktop preview matches the 460 px prototype button').toBe(460);
    expect(
      Math.abs(
        previewAction!.x + previewAction!.width / 2 - editorBounds!.x - editorBounds!.width / 2
      ),
      'desktop preview aligns to the editor center'
    ).toBeLessThanOrEqual(1);
    const toolbarAlignment = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.plan-editor')?.getBoundingClientRect();
      const floors = document
        .querySelector<HTMLElement>('.plan-floor-tabs')
        ?.getBoundingClientRect();
      const actions = document
        .querySelector<HTMLElement>('.plan-editor__toolbar-actions')
        ?.getBoundingClientRect();
      if (!editor || !floors || !actions) throw new Error('Desktop plan controls are missing');
      return {
        editorLeft: editor.left,
        editorRight: editor.right,
        floorLeft: floors.left,
        actionsRight: actions.right
      };
    });
    expect(
      Math.abs(toolbarAlignment.floorLeft - toolbarAlignment.editorLeft),
      'desktop floor tabs align to the canvas and editor left edge'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(toolbarAlignment.actionsRight - toolbarAlignment.editorRight),
      'desktop zoom/history controls align to the canvas and editor right edge'
    ).toBeLessThanOrEqual(1);
  }
  await screenshot(page, '02-plan-editor', viewport);
  await openPlanZoneList(page);
  const accessibleAreaListHeading = page.locator('.plan-details__zones > h3.visually-hidden');
  await expect(accessibleAreaListHeading).toHaveAccessibleName('Zonas de esta planta');
  const accessibleAreaListHeadingBounds = await accessibleAreaListHeading.boundingBox();
  expect(accessibleAreaListHeadingBounds).not.toBeNull();
  expect(accessibleAreaListHeadingBounds!.width).toBeLessThanOrEqual(1);
  expect(accessibleAreaListHeadingBounds!.height).toBeLessThanOrEqual(1);
  for (const [label, kind] of [
    ['Trastero', 'storage_room'],
    ['Balcón', 'balcony'],
    ['Tendedero', 'clothes_drying_area']
  ] as const) {
    await choosePickerOption(page, /Tipo de zona:/, label);
    await page.locator('[data-test="plan-add-guided-space"]').click();
    await expect(
      page.locator(`.plan-canvas__space[data-kind="${kind}"]`),
      `${label} catalogue option creates the expected area`
    ).toHaveCount(1);
    await page.locator('[data-test="plan-undo"]').click();
    await expect(page.locator(`.plan-canvas__space[data-kind="${kind}"]`)).toHaveCount(0);
  }
  if ((await zoneDisclosure.getAttribute('open')) !== null)
    await zoneDisclosure.locator('summary').click();
  await expect(zoneDisclosure).not.toHaveAttribute('open', '');
  const drawingTools = page.locator('.plan-canvas-toolbar__tools .plan-tool');
  await expect(drawingTools).toHaveCount(5);
  await expect(drawingTools.nth(1)).toHaveText('Pared');
  const primaryToolGlyphs = await drawingTools.evaluateAll((buttons) =>
    buttons.map((button) => ({
      viewBox: button.querySelector('svg')?.getAttribute('viewBox'),
      path: button.querySelector('svg path')?.getAttribute('d')
    }))
  );
  expect(primaryToolGlyphs, 'the five drawing tools keep the prototype icon silhouettes').toEqual([
    { viewBox: '0 0 64 64', path: 'M18 8v45l12-13 8 17 8-4-8-17h16L18 8Z' },
    { viewBox: '0 0 64 64', path: 'M10 32h44' },
    { viewBox: '0 0 64 64', path: 'm12 17 31-6 10 24-22 20-19-17z' },
    { viewBox: '0 0 64 64', path: 'M14 52V30a20 20 0 0 1 20-20h14v42H14Z' },
    {
      viewBox: '0 0 64 64',
      path: 'M10 17h44v30H10zM11 27h42M11 37h42M32 27v10'
    }
  ]);
  const doorGlyph = await drawingTools.nth(3).locator('svg path').getAttribute('d');
  expect(doorGlyph, 'the prototype door has a rounded upper-left contour').toContain(
    'a20 20 0 0 1 20-20'
  );
  expect(doorGlyph, 'the prototype door omits the door-swing arc').not.toContain('a17 17');
  const windowGlyph = await drawingTools.nth(4).locator('svg path').getAttribute('d');
  expect(windowGlyph, 'the prototype window divides only the center band vertically').toContain(
    'M32 27v10'
  );
  expect(windowGlyph, 'the prototype window has a horizontal rail at the top band').toContain(
    'M11 27h42'
  );
  expect(windowGlyph, 'the prototype window has a horizontal rail at the bottom band').toContain(
    'M11 37h42'
  );
  await page.locator('.plan-editor__advanced-settings > summary').click();
  const drawAreaMode = page.locator('[data-test="plan-draw-area"]');
  await expect(drawAreaMode).toBeVisible();
  await drawAreaMode.click();
  await expect(drawAreaMode).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.plan-canvas-toolbar__tools .plan-tool').first().click();
  if (mobile) {
    await captureResponsiveScreenshot(page, '02-plan-editor-320x568', {
      width: 320,
      height: 568
    });
    await page.setViewportSize(viewport);
  }
  await openPlanZoneList(page);
  await expect(zoneDisclosure).toHaveAttribute('open', '');
  await choosePickerOption(page, /Tipo de zona:/, 'Otra zona personalizada');
  const customAreaName = page.getByLabel('Nombre de la zona');
  await customAreaName.fill('Sala de música');
  await page.locator('[data-test="plan-add-guided-space"]').click();
  const guidedCustomArea = page.locator(
    '.plan-canvas__space[data-kind="custom"][aria-label="Sala de música"]'
  );
  await expect(guidedCustomArea).toBeVisible();
  await expect(page.locator('[data-test="plan-selected-space"] h3')).toHaveText('Sala de música');
  const guidedSpaceBounds = await page.locator('.plan-canvas__space').evaluateAll((elements) => {
    const bounds = (element: Element) => {
      const points = Array.from((element as SVGPolygonElement).points, (point) => ({
        x: point.x,
        y: point.y
      }));
      return {
        minX: Math.min(...points.map((point) => point.x)),
        maxX: Math.max(...points.map((point) => point.x)),
        minY: Math.min(...points.map((point) => point.y)),
        maxY: Math.max(...points.map((point) => point.y))
      };
    };
    const inserted = elements.find(
      (element) => element.getAttribute('aria-label') === 'Sala de música'
    );
    if (!inserted) throw new Error('The new guided area is not in the plan canvas');
    const insertedBounds = bounds(inserted);
    return elements
      .filter((element) => element !== inserted)
      .map(bounds)
      .map((existing) => ({
        overlaps:
          insertedBounds.minX < existing.maxX &&
          insertedBounds.maxX > existing.minX &&
          insertedBounds.minY < existing.maxY &&
          insertedBounds.maxY > existing.minY
      }));
  });
  expect(guidedSpaceBounds.every(({ overlaps }) => !overlaps)).toBe(true);
  const customLabelFits = await guidedCustomArea.evaluate((element) => {
    const polygon = element as SVGPolygonElement;
    const label = element.parentElement?.querySelector<SVGTextElement>('.plan-canvas__space-label');
    if (!label) throw new Error('The guided area has no visible label');
    const areaBounds = polygon.getBBox();
    const labelBounds = label.getBBox();
    return (
      labelBounds.x >= areaBounds.x &&
      labelBounds.y >= areaBounds.y &&
      labelBounds.x + labelBounds.width <= areaBounds.x + areaBounds.width &&
      labelBounds.y + labelBounds.height <= areaBounds.y + areaBounds.height
    );
  });
  expect(customLabelFits).toBe(true);

  await page.locator('[data-test="plan-selected-space"] .plan-details__close').click();
  await openPlanZoneList(page);
  await choosePickerOption(page, /Tipo de zona:/, 'Otra zona personalizada');
  await customAreaName.fill('Despacho en L');
  const activeFreeformTool = page.locator('[data-test="plan-tool-freeform"]');
  await expect(activeFreeformTool, 'freeform drawing is a primary tool').toBeVisible();
  await activeFreeformTool.click();
  await expect(page.locator('.plan-editor')).toHaveClass(/plan-editor--freeform/);
  await expect(
    activeFreeformTool,
    'the active freeform mode stays visible in the primary drawing dock'
  ).toBeVisible();
  await expect(activeFreeformTool).toHaveAttribute('aria-pressed', 'true');
  await expect(
    activeFreeformTool.locator('svg'),
    'the visible mode has a matching icon'
  ).toBeVisible();
  await page.locator('.plan-editor__advanced-settings > summary').click();
  await page.locator('[data-test="plan-draw-area"]').click();
  await expect(activeFreeformTool).toHaveAttribute('aria-pressed', 'true');
  await expect(activeFreeformTool).toHaveText('Dibujar zona');
  await activeFreeformTool.click();
  await expect(activeFreeformTool).toHaveText('Zona libre');
  const toolIcons = await page
    .locator('.plan-canvas-toolbar__tools .plan-tool svg')
    .evaluateAll((icons) =>
      icons.map((icon) => {
        const bounds = icon.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      })
    );
  expect(toolIcons.length, 'every primary tool has a visible icon').toBe(5);
  expect(
    Math.max(...toolIcons.map(({ width }) => width)) -
      Math.min(...toolIcons.map(({ width }) => width)),
    'primary tool icons share one width'
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...toolIcons.map(({ height }) => height)) -
      Math.min(...toolIcons.map(({ height }) => height)),
    'primary tool icons share one height'
  ).toBeLessThanOrEqual(1);
  const freeformCanvas = page.locator('.plan-canvas');
  await freeformCanvas.scrollIntoViewIfNeeded();
  const freeformActionButtons = page.locator('[data-test="plan-freeform-actions"] > button');
  await expect(freeformActionButtons).toHaveCount(3);
  for (const action of await freeformActionButtons.all()) {
    await expect(action.locator('svg'), 'each freeform action has a matching icon').toBeVisible();
  }
  const alignedFreeformActions = await freeformActionButtons.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const icon = element.querySelector('svg')?.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        iconWidth: icon?.width ?? 0,
        iconHeight: icon?.height ?? 0
      };
    })
  );
  expect(
    Math.max(...alignedFreeformActions.map(({ y }) => y)) -
      Math.min(...alignedFreeformActions.map(({ y }) => y)),
    'freeform actions share one baseline'
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...alignedFreeformActions.map(({ height }) => height)) -
      Math.min(...alignedFreeformActions.map(({ height }) => height)),
    'freeform actions share a consistent touch height'
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...alignedFreeformActions.map(({ width }) => width)) -
      Math.min(...alignedFreeformActions.map(({ width }) => width)),
    'freeform actions share equal columns'
  ).toBeLessThanOrEqual(1);
  for (const action of alignedFreeformActions) {
    expect(action.iconWidth, 'action icon width stays consistent').toBe(18);
    expect(action.iconHeight, 'action icon height stays consistent').toBe(18);
  }
  const freeformContentAlignment = await freeformActionButtons.evaluateAll((elements) =>
    elements.map((element) => {
      const button = element.getBoundingClientRect();
      const icon = element.querySelector('svg')?.getBoundingClientRect();
      const label = Array.from(element.querySelectorAll('span'))
        .find((candidate) => {
          const bounds = candidate.getBoundingClientRect();
          return getComputedStyle(candidate).display !== 'none' && bounds.width > 0;
        })
        ?.getBoundingClientRect();
      if (!icon || !label) throw new Error('Freeform action requires a visible icon and label');
      const content = {
        left: Math.min(icon.left, label.left),
        right: Math.max(icon.right, label.right),
        top: Math.min(icon.top, label.top),
        bottom: Math.max(icon.bottom, label.bottom)
      };
      return {
        horizontalCenterOffset: Math.abs(
          (content.left + content.right) / 2 - (button.left + button.right) / 2
        ),
        verticalCenterOffset: Math.abs(
          (content.top + content.bottom) / 2 - (button.top + button.bottom) / 2
        )
      };
    })
  );
  for (const alignment of freeformContentAlignment) {
    expect(
      alignment.horizontalCenterOffset,
      'the icon and label are centered as one action'
    ).toBeLessThanOrEqual(1);
    expect(
      alignment.verticalCenterOffset,
      'the icon and label share the action centerline'
    ).toBeLessThanOrEqual(1);
  }
  await expect(
    page.locator('.plan-canvas__preview-action svg'),
    'preview has an icon alongside its label'
  ).toBeVisible();
  await expect(freeformActionButtons.nth(0)).toHaveAccessibleName('Quitar último punto');
  await expect(freeformActionButtons.nth(1)).toHaveAccessibleName('Terminar zona');
  await expect(freeformActionButtons.nth(2)).toHaveAccessibleName('Cancelar dibujo');
  if (mobile) {
    await expect(freeformActionButtons.nth(2).locator('.plan-freeform-label--compact')).toHaveText(
      'Cancelar'
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    const mobileEditorFirstView = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing first-view region: ${selector}`);
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          marginTop: style.marginTop
        };
      };
      const workspace = document.querySelector<HTMLElement>('.plan-editor__workspace');
      const editor = document.querySelector<HTMLElement>('.plan-editor');
      return {
        actions: bounds('.plan-canvas__freeform-actions'),
        toolbar: bounds('.plan-canvas-toolbar'),
        preview: bounds('.plan-canvas__preview-action'),
        viewportBottom: window.innerHeight,
        workspace: workspace ? getComputedStyle(workspace).display : 'missing',
        editorGap: editor ? getComputedStyle(editor).rowGap : 'missing',
        canvasColumn: document
          .querySelector<HTMLElement>('.plan-canvas-column')
          ?.getBoundingClientRect().height
      };
    });
    console.info(`[visual:mobile-freeform-first-view] ${JSON.stringify(mobileEditorFirstView)}`);
    for (const region of [mobileEditorFirstView.actions, mobileEditorFirstView.toolbar]) {
      expect(
        region.bottom,
        'mobile freeform actions and both toolbar rows stay inside the viewport'
      ).toBeLessThanOrEqual(mobileEditorFirstView.viewportBottom - 8);
    }
    expect(
      mobileEditorFirstView.preview.bottom,
      'mobile preview remains visible in the freeform first view'
    ).toBeLessThanOrEqual(mobileEditorFirstView.viewportBottom - 8);
  }
  if (!mobile) {
    const freeformPreview = await page.locator('.plan-canvas__preview-action').boundingBox();
    expect(freeformPreview).not.toBeNull();
    expect(
      freeformPreview!.y + freeformPreview!.height,
      'the preview action stays visible after drawing controls appear'
    ).toBeLessThanOrEqual(viewport.height);
  }
  if ((await zoneDisclosure.getAttribute('open')) !== null) {
    await zoneDisclosure.locator('summary').click();
    await expect(zoneDisclosure).not.toHaveAttribute('open', '');
  }
  await expect(
    zoneDisclosure,
    'the default editor capture hides the optional zone list'
  ).toBeHidden();
  await screenshot(page, '02-plan-editor-freeform', viewport);
  if (!mobile) {
    const wideDesktop = { width: 1920, height: 1032 };
    await page.setViewportSize(wideDesktop);
    const drawingDockMetrics = await page.evaluate(() => {
      const tiles = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.plan-canvas-toolbar__tools > .plan-tool, .plan-canvas-toolbar__rooms > .plan-room-chip'
        )
      );
      const icons = Array.from(
        document.querySelectorAll<SVGSVGElement>(
          '.plan-canvas-toolbar__tools > .plan-tool > span > svg, .plan-canvas-toolbar__rooms > .plan-room-chip > svg[householdAreaGlyph]'
        )
      );
      const selectedTool = document.querySelector<HTMLElement>('.plan-tool.is-selected');
      const selectedIcon = selectedTool?.querySelector('svg');
      const unselectedTool = document.querySelector<HTMLElement>('.plan-tool:not(.is-selected)');
      return {
        tileHeights: tiles.map((tile) => Math.round(tile.getBoundingClientRect().height)),
        iconSizes: icons.map((icon) => {
          const bounds = icon.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
        selectedIconColor: selectedIcon ? getComputedStyle(selectedIcon).color : null,
        selectedLabelColor: selectedTool ? getComputedStyle(selectedTool).color : null,
        unselectedLabelColor: unselectedTool ? getComputedStyle(unselectedTool).color : null
      };
    });
    expect(drawingDockMetrics.tileHeights).toHaveLength(11);
    for (const tileHeight of drawingDockMetrics.tileHeights) {
      expect(tileHeight, 'desktop tool and room cards match the 88px prototype row').toBe(88);
    }
    expect(drawingDockMetrics.iconSizes).toHaveLength(11);
    for (const icon of drawingDockMetrics.iconSizes) {
      expect(icon.width, 'desktop toolbar SVGs match the prototype 32px size').toBe(32);
      expect(icon.height, 'desktop toolbar SVGs keep a square 32px box').toBe(32);
    }
    expect(drawingDockMetrics.selectedIconColor).toBe('rgb(249, 115, 22)');
    expect(drawingDockMetrics.selectedLabelColor).not.toBe(drawingDockMetrics.unselectedLabelColor);
    const editorAlignment = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.plan-editor');
      const pageContainer = document.querySelector<HTMLElement>(
        'app-page-container.page-container--bounded'
      );
      const selectors = [
        '.plan-editor__header',
        '.plan-editor__toolbar',
        '.plan-canvas-toolbar',
        '.plan-editor__workspace'
      ];
      if (!editor) throw new Error('The plan editor is missing at the wide desktop breakpoint');
      if (!pageContainer) throw new Error('The bounded page container is missing');
      const editorBounds = editor.getBoundingClientRect();
      const pageBounds = pageContainer.getBoundingClientRect();
      const children = selectors.map((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing editor region: ${selector}`);
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right };
      });
      return {
        width: editorBounds.width,
        editorLeft: editorBounds.left,
        editorRight: editorBounds.right,
        editorCenter: editorBounds.left + editorBounds.width / 2,
        pageCenter: pageBounds.left + pageBounds.width / 2,
        children
      };
    });
    expect(
      editorAlignment.width,
      'desktop width stays within the approved prototype scale'
    ).toBeLessThanOrEqual(800);
    expect(
      Math.abs(editorAlignment.editorCenter - editorAlignment.pageCenter),
      'the editor centers inside the main content track on a wide desktop'
    ).toBeLessThanOrEqual(1);
    for (const region of editorAlignment.children) {
      expect(Math.abs(region.left - editorAlignment.editorLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(region.right - editorAlignment.editorRight)).toBeLessThanOrEqual(1);
    }
    const widePreview = await page.locator('.plan-canvas__preview-action').boundingBox();
    expect(widePreview).not.toBeNull();
    expect(
      widePreview!.y + widePreview!.height,
      'preview stays visible in the 1920 × 1032 first view'
    ).toBeLessThanOrEqual(wideDesktop.height);
    await screenshot(page, '02-plan-editor-wide-desktop', wideDesktop);
    await page.setViewportSize(viewport);
  }
  if (mobile) {
    await page.setViewportSize({ width: 320, height: 568 });
    const quickRoomButtons = page.locator('.plan-canvas-toolbar__rooms > button');
    await expect(quickRoomButtons).toHaveCount(6);
    const quickRoomRow = page.locator('.plan-canvas-toolbar__rooms');
    const rowOverflow = await quickRoomRow.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }));
    expect(
      rowOverflow.scrollWidth,
      'the narrow quick-add row signals more content'
    ).toBeGreaterThan(rowOverflow.clientWidth);
    await quickRoomButtons.first().focus();
    for (let index = 0; index < 5; index++) await page.keyboard.press('Tab');
    await expect(quickRoomButtons.nth(5)).toBeFocused();
    const finalRoomBounds = await quickRoomButtons.nth(5).boundingBox();
    const quickRoomBounds = await quickRoomRow.boundingBox();
    expect(finalRoomBounds).not.toBeNull();
    expect(quickRoomBounds).not.toBeNull();
    expect(
      finalRoomBounds!.x,
      'the last shortcut can be reached by keyboard focus'
    ).toBeGreaterThanOrEqual(quickRoomBounds!.x - 1);
    expect(
      finalRoomBounds!.x + finalRoomBounds!.width,
      'the focused last shortcut is brought fully into view'
    ).toBeLessThanOrEqual(quickRoomBounds!.x + quickRoomBounds!.width + 1);
    expect(
      finalRoomBounds!.width,
      'quick-add targets remain at least 44 px wide'
    ).toBeGreaterThanOrEqual(44);
    expect(
      finalRoomBounds!.height,
      'quick-add targets remain at least 44 px high'
    ).toBeGreaterThanOrEqual(44);
    await expect(
      freeformActionButtons.nth(0).locator('.plan-freeform-label--compact'),
      'the point-removal action uses a concise mobile label'
    ).toHaveText('Deshacer');
    const narrowActionButtons = await freeformActionButtons.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      })
    );
    expect(
      Math.max(...narrowActionButtons.map(({ y }) => y)) -
        Math.min(...narrowActionButtons.map(({ y }) => y)),
      'freeform actions remain aligned at the 320 px minimum'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...narrowActionButtons.map(({ height }) => height)) -
        Math.min(...narrowActionButtons.map(({ height }) => height)),
      'freeform actions keep equal touch targets at the 320 px minimum'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...narrowActionButtons.map(({ width }) => width)) -
        Math.min(...narrowActionButtons.map(({ width }) => width)),
      'freeform action columns stay aligned at the 320 px minimum'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.min(...narrowActionButtons.map(({ height }) => height)),
      'freeform action touch targets remain at least 44 px high at the 320 px minimum'
    ).toBeGreaterThanOrEqual(44);
    const narrowCanvas = await page.locator('.plan-canvas__viewport').boundingBox();
    expect(
      narrowCanvas?.height,
      'the narrow freeform canvas remains drawable'
    ).toBeGreaterThanOrEqual(200);
    const narrowDocumentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(
      narrowDocumentWidth,
      'the narrow editor has no horizontal page overflow'
    ).toBeLessThanOrEqual(320);
    const narrowPreviewButton = page.locator('.plan-canvas__preview-action');
    await narrowPreviewButton.scrollIntoViewIfNeeded();
    const narrowPreview = await narrowPreviewButton.boundingBox();
    const viewportBottom = await mobileViewportBottom(page);
    expect(narrowPreview).not.toBeNull();
    const narrowScrollMetrics = await page.evaluate(() => {
      const preview = document.querySelector<HTMLElement>('.plan-canvas__preview-action');
      const main = document.querySelector<HTMLElement>('.main');
      const rect = preview?.getBoundingClientRect();
      return {
        windowScrollY: window.scrollY,
        mainScrollTop: main?.scrollTop ?? null,
        previewTop: rect?.top ?? null,
        previewBottom: rect?.bottom ?? null,
        mainOverflowY: main ? getComputedStyle(main).overflowY : 'missing',
        documentScrollHeight: document.documentElement.scrollHeight
      };
    });
    console.info(`[visual:narrow-freeform-preview] ${JSON.stringify(narrowScrollMetrics)}`);
    expect(
      narrowPreview!.y,
      'the primary preview action remains within the viewport after scrolling at 320 px'
    ).toBeGreaterThanOrEqual(0);
    expect(
      narrowPreview!.y + narrowPreview!.height,
      'the primary preview action scrolls inside the viewport at 320 px'
    ).toBeLessThanOrEqual(viewportBottom - 8);
    await screenshot(
      page,
      '02-plan-editor-freeform-320x568',
      {
        width: 320,
        height: 568
      },
      false
    );
    await page.setViewportSize(viewport);
  }
  await openPlanZoneList(page);
  const freeformTapPoints = await freeformCanvas.evaluate((element) => {
    const svg = element as SVGSVGElement;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('Plan SVG has no screen transform');
    return [
      [8200, 6800],
      [9500, 6800],
      [9500, 8300],
      [8950, 8300],
      [8950, 7500],
      [8200, 7500]
    ].map(([x, y]) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      const screen = point.matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  });
  const freeformCanvasBounds = await freeformCanvas.boundingBox();
  expect(freeformCanvasBounds).not.toBeNull();
  for (const [index, point] of freeformTapPoints.entries()) {
    if (mobile) {
      await freeformCanvas.tap({
        position: {
          x: point.x - freeformCanvasBounds!.x,
          y: point.y - freeformCanvasBounds!.y
        }
      });
    } else {
      await page.mouse.click(point.x, point.y);
    }
    await expect(
      freeformCanvas.locator('.plan-canvas__drawing-outline, .plan-canvas__drawing-preview'),
      `tap ${index + 1} must add a freeform vertex`
    ).toHaveAttribute('points', /.+/);
  }
  await page.locator('[data-test="plan-freeform-finish"]').click();
  const freeformArea = page.locator(
    '.plan-canvas__space[data-kind="custom"][aria-label="Despacho en L"]'
  );
  await expect(freeformArea).toBeVisible();
  const freeformVertexCount = await freeformArea.evaluate(
    (element) => (element.getAttribute('points') ?? '').trim().split(/\s+/).length
  );
  expect(freeformVertexCount, 'a freeform zone keeps its concave six-corner shape').toBe(6);
  await page.locator('[data-test="plan-undo"]').click();
  await expect(freeformArea).toHaveCount(0);
  await page.locator('[data-test="plan-undo"]').click();
  await expect(guidedCustomArea).toHaveCount(0);

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
    const viewportBottom = await mobileViewportBottom(page);
    expect(previewAction).not.toBeNull();
    expect(previewAction!.y + previewAction!.height).toBeLessThanOrEqual(viewportBottom - 8);
  }
  await expect(page.locator('.plan-file input')).toHaveAttribute(
    'accept',
    'image/jpeg,image/png,image/webp,application/pdf'
  );

  await page.locator('.plan-details__area').filter({ hasText: 'Cocina' }).first().click();
  await page.locator('.plan-details__selected-actions > summary').click();
  const renameSummary = page.locator('.plan-details__rename summary');
  const renameSummaryIsHitTarget = await renameSummary.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
    return hit === element || element.contains(hit);
  });
  expect(renameSummaryIsHitTarget, 'the actions menu is not obscured by the floor plan').toBe(true);
  await renameSummary.click();
  const areaName = page.getByLabel('Nombre visible');
  await expect(areaName).toHaveValue('Cocina');
  await areaName.fill('Cocina con isla');
  await page.locator('.plan-details__selected-actions > summary').click();
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
  const editedKitchen = savedPlan.floors[0].spaces.find(
    (space) => space.label === 'Cocina con isla'
  );
  expect(editedKitchen).toBeTruthy();
  const kitchenId = editedKitchen!.id;

  // Keep the edited label verification, then restore the neutral fixture label for visual QA.
  await openPlanZoneList(page);
  await expect(
    page.locator('.plan-details__area').filter({ hasText: 'Cocina con isla' })
  ).toBeVisible();
  await page.locator('.plan-details__area').filter({ hasText: 'Cocina con isla' }).click();
  await page.locator('.plan-details__selected-actions > summary').click();
  await page.locator('.plan-details__rename summary').click();
  await page.getByLabel('Nombre visible').fill('Cocina');
  await page.locator('.plan-details__selected-actions > summary').click();
  await page.locator('[data-test="plan-selected-space"] .plan-details__close').click();
  const restoreLabelResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/plan')
  );
  await page.locator('[data-test="plan-save"]').click();
  savedPlanEnvelope = await (await restoreLabelResponse).json();
  savedPlan = savedPlanEnvelope.data.plan as HouseholdPlan;
  await openPlanZoneList(page);
  await expect(page.locator('.plan-details__area').filter({ hasText: 'Cocina' })).toBeVisible();
  const floorTabs = page.locator('[data-test="plan-floor-tabs"]');
  await expect(floorTabs, 'floor switching should stay beside the drawing tools').toBeVisible();
  await expect(floorTabs.getByRole('button', { name: 'Planta baja' })).toBeVisible();
  await page.locator('.plan-details__area').filter({ hasText: 'Cocina' }).first().click();

  const zoneAssignment = page.locator('[data-test="plan-zone-assignment"]');
  await expect(zoneAssignment).toBeVisible();
  const sharedAssignmentGlyph = zoneAssignment.locator(
    '.plan-zone-member--shared .plan-zone-member__avatar svg'
  );
  await expect(
    sharedAssignmentGlyph,
    'shared responsibility uses the prototype people glyph'
  ).toBeVisible();
  await expect(sharedAssignmentGlyph.locator('circle')).toHaveCount(2);
  await expect(sharedAssignmentGlyph.locator('path')).toHaveAttribute(
    'd',
    'M3.5 19a5.5 5.5 0 0 1 11 0m-.5-4a4.5 4.5 0 0 1 7.5 3.5'
  );
  await expect(
    page.locator('.plan-canvas-toolbar'),
    'zone assignment must not expose drawing controls'
  ).toBeHidden();
  const assignmentCanvasBackground = await page
    .locator('.plan-canvas__viewport')
    .evaluate((viewport) => getComputedStyle(viewport).backgroundImage);
  expect(assignmentCanvasBackground, 'assignment uses the clean prototype map surface').toBe(
    'none'
  );
  await expect(
    page.locator('[data-test="plan-selected-space"] .plan-details__selected-actions'),
    'zone editing actions remain accessible alongside assignment choices'
  ).toBeVisible();
  const assignmentMoreActions = page.locator(
    '[data-test="plan-selected-space"] .plan-details__selected-actions > summary'
  );
  await expect(assignmentMoreActions).toHaveAccessibleName('Más acciones');
  await expect(
    assignmentMoreActions.locator('svg'),
    'the secondary zone action uses the household SVG icon system'
  ).toBeVisible();
  if (mobile) {
    await expect(zoneAssignment.locator('[data-test="plan-zone-member"]')).toHaveCount(3);
    await expect(zoneAssignment.locator('.plan-zone-member--shared')).toBeVisible();
    await expect(
      page.locator('[data-test="plan-selected-space"] .plan-details__close')
    ).toBeVisible();
    await expect(page.locator('.plan-editor__header')).toBeVisible();
    await expect(page.locator('.plan-editor__header h2')).toHaveText('Plano de tu hogar');
    const visibleAssignmentHeading = await page.locator('.plan-editor__header h2').boundingBox();
    expect(
      visibleAssignmentHeading?.width,
      'the assignment title stays accessible without taking space absent from the approved screen'
    ).toBeLessThanOrEqual(1);
    const householdTabsBounds = await page.locator('.household-tabs').boundingBox();
    expect(householdTabsBounds).not.toBeNull();
    await expect(page.locator('.plan-editor__toolbar')).toBeHidden();
    await expect(page.locator('.plan-editor__toolbar-actions')).toBeHidden();
    await expect(page.locator('.plan-canvas-toolbar')).toBeHidden();
    const floorTabsBounds = await page
      .locator('[data-test="plan-assignment-floor-tabs"]')
      .boundingBox();
    const assignmentFloorTab = page
      .locator('[data-test="plan-assignment-floor-tabs"] .plan-floor-tabs__tab')
      .first();
    await expect(assignmentFloorTab).toHaveCSS('border-top-width', '1px');
    await expect(assignmentFloorTab).toHaveCSS('border-top-style', 'solid');
    const assignmentHeadingBounds = await page.locator('.plan-editor__header').boundingBox();
    const assignmentMapBounds = await page.locator('.plan-canvas__viewport').boundingBox();
    const assignmentSheetBounds = await page
      .locator('[data-test="plan-selected-space"]')
      .boundingBox();
    expect(floorTabsBounds).not.toBeNull();
    expect(floorTabsBounds!.y).toBeGreaterThanOrEqual(
      householdTabsBounds!.y + householdTabsBounds!.height
    );
    expect(
      floorTabsBounds!.y,
      'floor selection follows the household tabs without an extra heading block'
    ).toBeLessThanOrEqual(householdTabsBounds!.y + householdTabsBounds!.height + 24);
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
      assignmentMapBounds!.height,
      'the mobile assignment map matches the prototype’s vertical prominence'
    ).toBeGreaterThanOrEqual(380);
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
    await expect(
      page.locator('[data-test="plan-selected-space"] .plan-details__close'),
      'desktop side panel keeps an explicit way to leave assignment mode'
    ).toBeVisible();
    await expect(
      zoneAssignment.locator('.plan-zone-assignment__state'),
      'desktop selected radio conveys the state without a duplicate status pill'
    ).toBeHidden();
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
  await openPlanZoneList(page);
  await page.locator('.plan-details__area').filter({ hasText: 'Cocina' }).first().click();
  await expect(
    page.locator('[data-test="plan-zone-assignment"] [aria-pressed="true"]')
  ).toContainText(assignedMemberName ?? '');
  await assignZone(page, 'Salón', [0]);
  await assignZone(page, 'Baño', [1]);
  await assignZone(page, 'Dormitorio', [2]);
  await assignZone(page, 'Patio', [0, 1, 2]);
  await assignZone(page, 'Jardín', [0, 1, 2]);
  await assignZone(page, 'Cocina', [3], false);
  await expect(zoneAssignment.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(zoneAssignment.locator('.plan-zone-member--shared')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  if (mobile) {
    const assignmentSheet = page.locator('[data-test="plan-selected-space"]');
    await expect(assignmentSheet.locator('h3')).toHaveText('Cocina');
    const selectedState = assignmentSheet.locator('.plan-details__selected-state');
    await expect(selectedState).toHaveText('Compartida');
    const memberButtons = assignmentSheet.locator(
      '[data-test="plan-zone-member"], .plan-zone-member--shared'
    );
    expect(await memberButtons.count()).toBe(4);
    const memberButtonBounds = await memberButtons.first().boundingBox();
    expect(
      memberButtonBounds?.height,
      'the mobile assignment sheet keeps the four member choices easy to scan and tap'
    ).toBeGreaterThanOrEqual(100);
    const memberRows = await memberButtons.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().y)
    );
    expect(Math.max(...memberRows) - Math.min(...memberRows)).toBeLessThanOrEqual(1);
    const saveBounds = await assignmentSheet
      .locator('[data-test="plan-zone-assignment-save"]')
      .boundingBox();
    const viewportBottom = await mobileViewportBottom(page);
    expect(saveBounds).not.toBeNull();
    expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(viewportBottom - 8);
  } else {
    const memberButtons = zoneAssignment.locator(
      '[data-test="plan-zone-member"], .plan-zone-member--shared'
    );
    await expect(memberButtons).toHaveCount(4);
    const memberTiles = await memberButtons.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        };
      })
    );
    expect(
      Math.max(...memberTiles.map((tile) => tile.x)) -
        Math.min(...memberTiles.map((tile) => tile.x)),
      'desktop responsibility choices form one aligned vertical list'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...memberTiles.map((tile) => tile.height)) -
        Math.min(...memberTiles.map((tile) => tile.height)),
      'desktop responsibility rows share the same height'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.min(...memberTiles.map((tile) => tile.height)),
      'desktop responsibility rows remain easy to scan and tap'
    ).toBeGreaterThanOrEqual(48);
    expect(
      Math.max(...memberTiles.map((tile) => tile.y)) -
        Math.min(...memberTiles.map((tile) => tile.y)),
      'desktop responsibility rows are stacked instead of compressed into tiny cards'
    ).toBeGreaterThan(3 * 48);
    const sharedLabel = zoneAssignment.locator('.plan-zone-member--shared > span:nth-child(2)');
    const sharedTextLayout = await sharedLabel.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflowWrap: getComputedStyle(element).overflowWrap,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
    }));
    expect(
      sharedTextLayout.scrollWidth,
      'the shared assignment label must fit as a whole word without an awkward mid-word wrap'
    ).toBeLessThanOrEqual(sharedTextLayout.clientWidth);
    expect(sharedTextLayout.overflowWrap).toBe('normal');
    expect(sharedTextLayout.fontSize).toBeGreaterThanOrEqual(14);
    const alignedMemberContent = await memberButtons.evaluateAll((elements) =>
      elements.map((element) => {
        const button = element.getBoundingClientRect();
        const avatar = element.querySelector('.plan-zone-member__avatar')?.getBoundingClientRect();
        const label = element.querySelector('span:nth-child(2)')?.getBoundingClientRect();
        const radio = element.querySelector('.plan-zone-member__radio')?.getBoundingClientRect();
        if (!avatar || !label || !radio) throw new Error('Assignment row content is incomplete');
        const buttonCenterY = button.top + button.height / 2;
        return [
          avatar.top + avatar.height / 2,
          label.top + label.height / 2,
          radio.top + radio.height / 2
        ].map((centerY) => Math.abs(centerY - buttonCenterY));
      })
    );
    for (const offsets of alignedMemberContent.flat()) {
      expect(offsets, 'avatar, name and radio share the row centerline').toBeLessThanOrEqual(1);
    }
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
  const selectedZone = page.locator('.plan-canvas__space--selected');
  await expect(selectedZone).toHaveAttribute('aria-label', 'Cocina');
  await expect(selectedZone).toHaveClass(/plan-canvas__space--shared/);
  await expect(selectedZone).toHaveCSS('fill', 'rgb(217, 246, 231)');
  const selectedZoneDraftMarkers = await selectedZone.evaluate(
    (element) =>
      element.parentElement?.querySelectorAll('.plan-canvas__assignee-avatar').length ?? 0
  );
  expect(
    selectedZoneDraftMarkers,
    'the map previews all household members while the shared assignment draft is selected'
  ).toBe(3);
  const selectedZoneColors = await selectedZone.evaluate((element) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--primary)';
    document.body.append(probe);
    const primary = getComputedStyle(probe).color;
    probe.remove();
    return {
      fill: getComputedStyle(element).fill,
      stroke: getComputedStyle(element).stroke,
      primary
    };
  });
  expect(
    selectedZoneColors.stroke,
    'orange selection outline must remain distinct from the responsibility fill'
  ).toBe(selectedZoneColors.primary);
  expect(selectedZoneColors.fill).toBe('rgb(217, 246, 231)');
  const overlappingAssignmentLabels = await page
    .locator('.plan-canvas__space-label')
    .evaluateAll((labels) =>
      labels.flatMap((label) => {
        const svgLabel = label as SVGTextElement;
        const labelBounds = svgLabel.getBBox();
        const markers = Array.from(
          svgLabel.parentElement?.querySelectorAll<SVGCircleElement>(
            '.plan-canvas__assignee-avatar'
          ) ?? []
        );
        return markers
          .filter((marker) => {
            const markerBounds = marker.getBBox();
            return (
              markerBounds.x < labelBounds.x + labelBounds.width &&
              markerBounds.x + markerBounds.width > labelBounds.x &&
              markerBounds.y < labelBounds.y + labelBounds.height &&
              markerBounds.y + markerBounds.height > labelBounds.y
            );
          })
          .map(() => svgLabel.textContent?.trim() ?? '');
      })
    );
  expect(
    overlappingAssignmentLabels,
    'assignment badges must not obscure room names in the floor plan'
  ).toEqual([]);
  const assignmentMarkersOutsideRooms = await page
    .locator('.plan-canvas__space')
    .evaluateAll((spaces) =>
      spaces.flatMap((space) => {
        const polygon = space as SVGPolygonElement;
        const points = Array.from(polygon.points, (point) => ({ x: point.x, y: point.y }));
        const isInside = (x: number, y: number) => {
          let inside = false;
          for (
            let current = 0, previous = points.length - 1;
            current < points.length;
            previous = current++
          ) {
            const a = points[current]!;
            const b = points[previous]!;
            const crosses = a.y > y !== b.y > y;
            if (crosses && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
          }
          return inside;
        };
        const markers = Array.from(
          polygon.parentElement?.querySelectorAll<SVGCircleElement>(
            '.plan-canvas__assignee-avatar'
          ) ?? []
        );
        return markers
          .filter((marker) => {
            const radius = Number(marker.getAttribute('r')) + 20;
            const centerX = Number(marker.getAttribute('cx'));
            const centerY = Number(marker.getAttribute('cy'));
            return Array.from({ length: 16 }, (_, index) => (index * Math.PI * 2) / 16).some(
              (angle) =>
                !isInside(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius)
            );
          })
          .map(() => polygon.getAttribute('aria-label') ?? '');
      })
    );
  expect(
    assignmentMarkersOutsideRooms,
    'assignment badges and their outlines must remain inside irregular room boundaries'
  ).toEqual([]);
  const assignmentIconsOutsideRooms = await page
    .locator('.plan-canvas__space-icon')
    .evaluateAll((icons) =>
      icons.flatMap((icon) => {
        const polygon = icon.parentElement?.querySelector<SVGPolygonElement>('.plan-canvas__space');
        if (!polygon) return ['missing room boundary'];
        const points = Array.from(polygon.points, (point) => ({ x: point.x, y: point.y }));
        const isInside = (x: number, y: number) => {
          let inside = false;
          for (
            let current = 0, previous = points.length - 1;
            current < points.length;
            previous = current++
          ) {
            const a = points[current]!;
            const b = points[previous]!;
            if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
              inside = !inside;
            }
          }
          return inside;
        };
        const bounds = {
          x: Number(icon.getAttribute('x')),
          y: Number(icon.getAttribute('y')),
          width: Number(icon.getAttribute('width')),
          height: Number(icon.getAttribute('height'))
        };
        const corners = [
          [bounds.x, bounds.y],
          [bounds.x + bounds.width, bounds.y],
          [bounds.x, bounds.y + bounds.height],
          [bounds.x + bounds.width, bounds.y + bounds.height]
        ];
        return corners.every(([x, y]) => isInside(x!, y!))
          ? []
          : [polygon.getAttribute('aria-label') ?? ''];
      })
    );
  expect(
    assignmentIconsOutsideRooms,
    'room icons must remain inside their zone when responsibility markers are shown'
  ).toEqual([]);
  // Force Chromium to rasterize the selected SVG path before the viewport capture.
  await selectedZone.screenshot({ animations: 'disabled' });
  await screenshot(page, '04-zone-assignment', viewport);
  const finalAssignmentSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/plan/assignments')
  );
  await page.locator('[data-test="plan-zone-assignment-save"]').click();
  expect((await finalAssignmentSave).status()).toBe(200);
  const assignmentClose = page.locator('[data-test="plan-selected-space"] .plan-details__close');
  if (await assignmentClose.isVisible()) await assignmentClose.click();

  await page.getByRole('button', { name: 'Pared', exact: true }).click();
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
  await expect(canvas.locator('.plan-canvas__wall--exterior')).toHaveCount(6);
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
  expect(savedPlan.floors[0].walls).toHaveLength(12);
  expect(savedPlan.floors[0].openings[0].isMainEntrance).toBe(true);

  const canvasSpace = canvas.locator('[data-space-id]').first();
  await canvasSpace.focus();
  await expect(canvasSpace).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(canvasSpace).toHaveClass(/plan-canvas__space--selected/);

  await screenshot(page, 'plan-desktop-or-mobile', viewport);
  if (mobile) await screenshot(page, 'plan-canvas-mobile', viewport);
  await page.locator('[data-test="plan-selected-space"] .plan-details__close').click();

  await openPlanZoneList(page);
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
  await page.getByRole('tab', { name: 'Planificación' }).click();
  await page.locator('[data-test="household-planning-tab-tasks"]').click();
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
  const proposedPlan = mobile
    ? irregularSyntheticPlan(savedPlan)
    : portraitPlan(irregularSyntheticPlan(savedPlan));
  proposedPlan.floors[0].spaces.find((space) => space.id === kitchenId)!.label = 'Cocina';
  const followupPlan = addAseoByBedrooms(proposedPlan);
  const chatCurrentPlan = mobile ? landscapePlan(savedPlan) : portraitPlan(savedPlan);
  const chatDraftPlan = mobile ? landscapePlan(proposedPlan) : portraitPlan(proposedPlan);
  const chatProposalPlan = mobile ? landscapePlan(followupPlan) : portraitPlan(followupPlan);
  const proposalRequestBodies: string[] = [];
  await page.route('**/api/household/plan/proposal', async (route) => {
    const request = route.request();
    const contentType = request.headers()['content-type'] ?? '';
    const requestBody =
      request
        .postDataBuffer()
        ?.toString(contentType.includes('multipart/form-data') ? 'latin1' : 'utf8') ?? '';
    proposalRequestBodies.push(requestBody);
    const requestNumber = proposalRequestBodies.length;
    const requestedDraft =
      requestNumber === 1 ? savedPlan : requestNumber === 2 ? chatDraftPlan : followupPlan;
    const result =
      requestNumber === 1
        ? proposedPlan
        : requestNumber === 2
          ? chatProposalPlan
          : taskPlan(followupPlan, mobile);
    const modifiedLivingRoomId = proposedPlan.floors[0].spaces.find(
      (space) => space.kind === 'living_room'
    )!.id;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          baseVersion: savedPlanEnvelope.data.version,
          current: requestNumber === 1 ? savedPlan : chatCurrentPlan,
          draft: requestedDraft,
          proposal: result,
          diff: {
            addedSpaceIds: requestNumber === 2 ? ['space-followup-aseo'] : [],
            modifiedSpaceIds:
              requestNumber === 1
                ? result.floors[0].spaces.map((space) => space.id)
                : [requestNumber === 2 ? modifiedLivingRoomId : 'space-followup-aseo'],
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
  const planImage = await syntheticPlanImage(page, !mobile);
  await page.locator('.plan-file input').setInputFiles({
    name: 'boceto-hogar.png',
    mimeType: 'image/png',
    buffer: planImage
  });
  await page.getByLabel('¿Qué quieres cambiar?').fill('Convierte el boceto en un plano editable.');
  await page.getByRole('button', { name: 'Generar propuesta' }).click();
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeVisible();
  await expect(page.locator('.plan-editor__header h2')).toHaveText('Convertir boceto en plano');
  await expect(page.locator('[data-test="plan-proposal-photo"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cambiar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar editando', exact: true })).toBeVisible();
  const entryQuestion = await page.locator('.plan-review__photo-entry-question').boundingBox();
  const entryDecisionButtons = await Promise.all(
    ['Confirmar', 'Cambiar'].map((name) =>
      page.getByRole('button', { name, exact: true }).boundingBox()
    )
  );
  expect(entryQuestion).not.toBeNull();
  expect(entryDecisionButtons.every(Boolean)).toBe(true);
  expect(
    Math.min(
      ...entryDecisionButtons.map((button) => button!.y - entryQuestion!.y - entryQuestion!.height)
    ),
    'the photo entry question keeps breathing room above both decision buttons'
  ).toBeGreaterThanOrEqual(8);
  const discardPhotoProposal = page.getByRole('button', { name: 'Descartar propuesta' });
  await expect(discardPhotoProposal).toBeVisible();
  await expect(
    discardPhotoProposal.locator('svg'),
    'discard has an icon-only affordance'
  ).toBeVisible();
  expect(
    await discardPhotoProposal.evaluate(
      (element) => element.closest('.plan-review__card-heading') !== null
    ),
    'discard stays with the proposal status, not as a detached link under the primary action'
  ).toBe(true);
  const photoHeaderGeometry = await page
    .locator('.plan-review__photo-result .plan-review__card-heading')
    .evaluate((header) => {
      const bounds = (element: Element) => {
        const { left, right, top, bottom } = element.getBoundingClientRect();
        return { left, right, top, bottom };
      };
      const intersects = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const title = header.querySelector('h4');
      const ready = header.querySelector('.plan-review__ready');
      const discard = header.querySelector('[data-test="plan-proposal-discard"]');
      return {
        discardOverlapsTitle: !!title && !!discard && intersects(bounds(title), bounds(discard)),
        discardOverlapsStatus: !!ready && !!discard && intersects(bounds(ready), bounds(discard)),
        discardHeight: discard?.getBoundingClientRect().height ?? 0
      };
    });
  expect(
    photoHeaderGeometry.discardOverlapsTitle,
    'discard does not cover the proposal title'
  ).toBe(false);
  expect(
    photoHeaderGeometry.discardOverlapsStatus,
    'discard does not cover the ready-to-review status'
  ).toBe(false);
  expect(
    photoHeaderGeometry.discardHeight,
    'discard remains an accessible touch target'
  ).toBeGreaterThanOrEqual(44);
  await expect(
    page.locator('.plan-review__actions--photo [data-test="plan-proposal-discard"]')
  ).toHaveCount(0);
  await expect(page.locator('[data-test="plan-attachment-preview"]')).toBeVisible();
  await expect(
    page.locator('.plan-review__photo-source-actions svg'),
    'photo actions keep their upload and camera glyphs'
  ).toHaveCount(2);
  await expect
    .poll(() =>
      page.locator('[data-test="plan-attachment-preview"]').evaluate((image) => {
        const preview = image as HTMLImageElement;
        return preview.complete ? preview.naturalWidth : 0;
      })
    )
    .toBeGreaterThan(300);
  let sourceImageVisualWidth = 0;
  if (mobile) {
    const sourceImage = page.locator('[data-test="plan-attachment-preview"]');
    sourceImageVisualWidth = await sourceImage.evaluate((element) => {
      const image = element as HTMLImageElement;
      const bounds = image.getBoundingClientRect();
      const scale = Math.min(
        bounds.width / image.naturalWidth,
        bounds.height / image.naturalHeight
      );
      return image.naturalWidth * scale;
    });
    const sourceImageBounds = await sourceImage.boundingBox();
    const sourceActionsBounds = await page
      .locator('.plan-review__photo-source-actions')
      .boundingBox();
    expect(
      sourceImageVisualWidth,
      'the uploaded sketch should be readable at the same prominence as the reference'
    ).toBeGreaterThanOrEqual(260);
    expect(sourceImageBounds).not.toBeNull();
    expect(sourceActionsBounds).not.toBeNull();
    expect(
      sourceActionsBounds!.y - (sourceImageBounds!.y + sourceImageBounds!.height),
      'photo source actions keep the breathing room shown in the approved mobile screen'
    ).toBeGreaterThanOrEqual(8);
  }
  await expect.poll(() => proposalRequestBodies[0] ?? '').toContain('name="image"');
  expect(proposalRequestBodies[0]).toContain('name="draftPlan"');
  expect(proposalRequestBodies[0]).toContain('name="prompt"');
  expect(proposalRequestBodies[0]).toContain('boceto-hogar.png');
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
  const irregularGeometry = await proposedMap.evaluate((map) => {
    const concaveSpace = map.querySelector<SVGPolygonElement>(
      '.plan-compare-canvas__space[data-kind="garden"]'
    );
    const vertices = (concaveSpace?.getAttribute('points') ?? '').trim().split(/\s+/);
    const diagonalWall = Array.from(
      map.querySelectorAll<SVGLineElement>('.plan-compare-canvas__wall')
    ).some(
      (wall) =>
        wall.getAttribute('x1') !== wall.getAttribute('x2') &&
        wall.getAttribute('y1') !== wall.getAttribute('y2')
    );
    return { vertexCount: vertices.length, diagonalWall };
  });
  expect(irregularGeometry.vertexCount, 'photo proposal preserves the concave outline').toBe(6);
  expect(irregularGeometry.diagonalWall, 'photo proposal preserves an oblique wall').toBe(true);
  await expect(proposedMap.locator('.plan-canvas__door-swing')).not.toHaveCount(0);
  await expect(proposedMap.locator('.plan-canvas__window-rail')).not.toHaveCount(0);
  if (mobile) {
    const proposalMap = await proposedMap.boundingBox();
    expect(proposalMap).not.toBeNull();
    expect(
      proposalMap!.width,
      'photo proposal should read as the main visual, not a thumbnail'
    ).toBeGreaterThan(200);
    expect(
      proposalMap!.height,
      'the proposal map should have the same prominence as the uploaded sketch'
    ).toBeGreaterThanOrEqual(205);
    expect(
      proposalMap!.height,
      'the mobile proposal map should match the approved portrait proportion'
    ).toBeLessThanOrEqual(220);
    expect(
      Math.abs(proposalMap!.width - sourceImageVisualWidth),
      'the uploaded sketch and generated plan keep the same visual width on mobile'
    ).toBeLessThanOrEqual(12);
  } else {
    const proposalMap = await proposedMap.boundingBox();
    expect(proposalMap).not.toBeNull();
    expect(
      proposalMap!.width,
      'the desktop proposal plan matches the roughly 340px canvas in the approved mockup'
    ).toBeGreaterThanOrEqual(336);
    expect(proposalMap!.width).toBeLessThanOrEqual(344);
    expect(
      proposalMap!.height,
      'the desktop proposal plan remains square and matches the approved mockup'
    ).toBeGreaterThanOrEqual(336);
    expect(proposalMap!.height).toBeLessThanOrEqual(344);
  }
  if (mobile) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const initialApply = await page.locator('[data-test="plan-proposal-apply"]').boundingBox();
    const initialChat = await page.locator('[data-test="plan-proposal-chat"]').boundingBox();
    const initialContinue = await page
      .locator('[data-test="plan-proposal-continue"]')
      .boundingBox();
    const stickyActions = await page.locator('.plan-review__actions--photo').boundingBox();
    const viewportBottom = await mobileViewportBottom(page);
    await screenshot(page, '03-photo-layout-audit', viewport);
    expect(initialApply).not.toBeNull();
    expect(initialChat).not.toBeNull();
    expect(initialContinue).not.toBeNull();
    expect(stickyActions).not.toBeNull();
    expect(
      initialApply!.y + initialApply!.height,
      'photo review apply action should be visible without scrolling'
    ).toBeLessThanOrEqual(viewportBottom - 8);
    expect(
      initialChat!.y + initialChat!.height,
      'photo review chat action should be visible without scrolling'
    ).toBeLessThanOrEqual(viewportBottom - 8);
    expect(
      initialContinue!.y + initialContinue!.height,
      'continue editing stays inside the mobile viewport'
    ).toBeLessThanOrEqual(viewportBottom - 8);
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
    const compactViewportBottom = await mobileViewportBottom(page);
    expect(compactDecision).not.toBeNull();
    expect(compactSticky).not.toBeNull();
    expect(compactContinue).not.toBeNull();
    expect(compactDecision!.y + compactDecision!.height).toBeLessThanOrEqual(compactSticky!.y - 8);
    await page.locator('[data-test="plan-proposal-continue"]').scrollIntoViewIfNeeded();
    const scrolledContinue = await page
      .locator('[data-test="plan-proposal-continue"]')
      .boundingBox();
    const scrolledViewportBottom = await mobileViewportBottom(page);
    expect(scrolledContinue).not.toBeNull();
    expect(scrolledContinue!.y + scrolledContinue!.height).toBeLessThanOrEqual(
      scrolledViewportBottom - 8
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
      const narrowProposalMap = await page
        .locator('.plan-review__photo-result .plan-compare-canvas')
        .boundingBox();
      expect(narrowProposalMap).not.toBeNull();
      expect(narrowProposalMap!.height).toBeGreaterThanOrEqual(170);
      expect(narrowProposalMap!.height).toBeLessThanOrEqual(180);
      const discardCollision = await page
        .locator('.plan-review__photo-result .plan-review__card-heading')
        .evaluate((header) => {
          const discard = header.querySelector('[data-test="plan-proposal-discard"]');
          const title = header.querySelector('h4');
          const status = header.querySelector('.plan-review__ready');
          if (!discard || !title || !status) throw new Error('Photo proposal header is incomplete');
          const overlaps = (element: Element) => {
            const a = discard.getBoundingClientRect();
            const b = element.getBoundingClientRect();
            return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          };
          return overlaps(title) || overlaps(status);
        });
      expect(discardCollision, `discard must not cover photo proposal text at ${width}px`).toBe(
        false
      );
    }
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('[data-test="plan-proposal-chat"]').scrollIntoViewIfNeeded();
    const applyButton = await page.locator('[data-test="plan-proposal-apply"]').boundingBox();
    const chatButton = await page.locator('[data-test="plan-proposal-chat"]').boundingBox();
    const photoActionsViewportBottom = await mobileViewportBottom(page);
    expect(applyButton).not.toBeNull();
    expect(chatButton).not.toBeNull();
    expect(applyButton!.y + applyButton!.height).toBeLessThanOrEqual(
      photoActionsViewportBottom - 8
    );
    expect(
      chatButton!.y + chatButton!.height,
      'photo review actions remain reachable inside the mobile viewport'
    ).toBeLessThanOrEqual(photoActionsViewportBottom - 8);
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
  await expect(page.locator('[data-test="plan-chat-continuation"]')).toHaveCount(4);
  await expect(page.locator('.plan-editor__header h2')).toHaveText('Plano');
  await expect(page.locator('.plan-review__header-actions .plan-file')).toBeVisible();
  if (mobile) {
    const continuationLayout = await page
      .locator('[data-test="plan-chat-continuation"]')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        })
      );
    expect(
      Math.abs(continuationLayout[0].y - continuationLayout[1].y),
      'the first two chat continuations share a row on mobile'
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(continuationLayout[2].y - continuationLayout[3].y),
      'the second two chat continuations share a row on mobile'
    ).toBeLessThanOrEqual(1);
    expect(continuationLayout[1].x, 'continuation columns stay side by side').toBeGreaterThan(
      continuationLayout[0].x
    );
  } else {
    const headerCollision = await page.locator('.plan-editor__header').evaluate((header) => {
      const paragraph = header.querySelector('p');
      const actions = header.querySelector('.plan-review__header-actions');
      if (!paragraph || !actions) throw new Error('Missing header copy or actions');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const textLines = Array.from(range.getClientRects());
      const buttons = actions.getBoundingClientRect();
      return textLines.some(
        (line) =>
          line.left < buttons.right &&
          line.right > buttons.left &&
          line.top < buttons.bottom &&
          line.bottom > buttons.top
      );
    });
    expect(
      headerCollision,
      'the desktop subtitle never runs beneath the photo/canvas actions'
    ).toBe(false);
    const returnActionGeometry = await page
      .locator('[data-test="plan-return-to-canvas"]')
      .evaluate((button) => {
        const labelNode = Array.from(button.childNodes).find(
          (node): node is Text => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()
        );
        const icon = button.querySelector('svg')?.getBoundingClientRect();
        const bounds = button.getBoundingClientRect();
        if (!labelNode || !icon) throw new Error('The return action needs a label and icon');
        const label = labelNode.textContent?.trim() ?? '';
        const start = labelNode.textContent?.indexOf(label) ?? 0;
        const range = document.createRange();
        range.setStart(labelNode, start);
        range.setEnd(labelNode, start + label.length);
        const labelLines = Array.from(range.getClientRects());
        return {
          labelLines: labelLines.length,
          iconCenter: icon.top + icon.height / 2,
          labelCenter: labelLines[0] ? labelLines[0].top + labelLines[0].height / 2 : -1,
          buttonWidth: bounds.width
        };
      });
    const uploadActionGeometry = await page
      .locator('.plan-review__header-actions .plan-file')
      .evaluate((button) => {
        const label = button.querySelector(':scope > span');
        if (!label) throw new Error('The upload action needs a visible label');
        const range = document.createRange();
        range.selectNodeContents(label);
        return {
          labelLines: range.getClientRects().length,
          width: button.getBoundingClientRect().width
        };
      });
    expect(
      returnActionGeometry.labelLines,
      'the desktop return action label stays on one line beside its icon'
    ).toBe(1);
    expect(
      uploadActionGeometry.labelLines,
      `the desktop upload label stays on one line in ${uploadActionGeometry.width}px`
    ).toBe(1);
    expect(
      Math.abs(returnActionGeometry.iconCenter - returnActionGeometry.labelCenter),
      'the desktop return label and icon share a visual centerline'
    ).toBeLessThanOrEqual(1);
    expect(returnActionGeometry.buttonWidth).toBeGreaterThanOrEqual(164);
    await page.setViewportSize({ width: 1920, height: viewport.height });
    await expect
      .poll(() =>
        page.locator('[data-test="plan-return-to-canvas"]').evaluate((button) => {
          const labelNode = Array.from(button.childNodes).find(
            (node): node is Text => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()
          );
          if (!labelNode) return 0;
          const label = labelNode.textContent?.trim() ?? '';
          const range = document.createRange();
          const start = labelNode.textContent?.indexOf(label) ?? 0;
          range.setStart(labelNode, start);
          range.setEnd(labelNode, start + label.length);
          return range.getClientRects().length;
        })
      )
      .toBe(1);
    await page.setViewportSize(viewport);
  }
  await expect(
    page.locator('.plan-chat__assistant-avatar svg'),
    'the assistant reply retains its home mark'
  ).toBeVisible();
  await expect(page.locator('.plan-chat__assistant-avatar svg path')).toHaveAttribute(
    'd',
    'm2 11 10-8 10 8v10a1 1 0 0 1-1 1h-6v-7H9v7H3a1 1 0 0 1-1-1V11Z'
  );
  const assistantAvatarGeometry = await page
    .locator('.plan-chat__assistant-avatar')
    .evaluate((avatar) => {
      const circle = avatar.getBoundingClientRect();
      const icon = avatar.querySelector('svg')?.getBoundingClientRect();
      return {
        iconWidth: icon?.width ?? 0,
        iconHeight: icon?.height ?? 0,
        centerOffset: icon
          ? Math.abs(icon.top + icon.height / 2 - circle.top - circle.height / 2)
          : Infinity
      };
    });
  expect(
    assistantAvatarGeometry.iconWidth,
    'the home avatar glyph matches the reference scale'
  ).toBe(24);
  expect(assistantAvatarGeometry.iconHeight, 'the home avatar glyph stays square').toBe(24);
  expect(
    assistantAvatarGeometry.centerOffset,
    'the home glyph is centered in its avatar'
  ).toBeLessThanOrEqual(1);
  await expect(
    page.locator('[data-test="plan-proposal-discard"] svg'),
    'undo is represented by its circular arrow icon'
  ).toBeVisible();
  const currentPlanCard = page.locator('.plan-review__compare-card--current');
  const proposedPlanCard = page.locator('.plan-review__compare-card--proposal');
  if (mobile) {
    const comparisonTabs = page.locator('.plan-review__mobile-tabs');
    await expect(comparisonTabs).toBeVisible();
    await expect(comparisonTabs.locator('button')).toHaveCount(2);
    await expect(proposedPlanCard).toBeVisible();
    await expect(
      currentPlanCard,
      'the selected proposal tab shows one large plan, not two reduced thumbnails'
    ).toBeHidden();
    await expect(page.locator('.plan-compare-canvas')).toHaveCount(2);
    const proposedCardBounds = await proposedPlanCard.boundingBox();
    expect(proposedCardBounds).not.toBeNull();
    const proposedCanvasBounds = await proposedPlanCard
      .locator('.plan-compare-canvas')
      .boundingBox();
    expect(proposedCanvasBounds).not.toBeNull();
    const comparisonTabsBounds = await comparisonTabs.boundingBox();
    expect(comparisonTabsBounds).not.toBeNull();
    expect(
      proposedCardBounds!.y,
      'the selected mobile plan sits below the before/after tabs'
    ).toBeGreaterThanOrEqual(comparisonTabsBounds!.y + comparisonTabsBounds!.height);
    expect(proposedCanvasBounds!.width).toBeGreaterThanOrEqual(viewport.width * 0.74);
    expect(
      proposedCanvasBounds!.height,
      'the selected mobile comparison map matches the prototype size'
    ).toBeGreaterThanOrEqual(260);
    expect(proposedCanvasBounds!.height).toBeLessThanOrEqual(330);
    const currentTab = comparisonTabs.locator('button').nth(0);
    await currentTab.click();
    await expect(currentPlanCard).toBeVisible();
    await expect(proposedPlanCard).toBeHidden();
    await expect(currentTab).toHaveAttribute('aria-pressed', 'true');
    await comparisonTabs.locator('button').nth(1).click();
    await expect(currentPlanCard).toBeHidden();
    await expect(proposedPlanCard).toBeVisible();
    await expect(comparisonTabs.locator('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  } else {
    await expect(page.locator('.plan-review__mobile-tabs')).toBeHidden();
    await expect(currentPlanCard).toBeVisible();
    await expect(proposedPlanCard).toBeVisible();
    await expect(page.locator('.plan-compare-canvas')).toHaveCount(2);
    const currentCardBounds = await currentPlanCard.boundingBox();
    const proposedCardBounds = await proposedPlanCard.boundingBox();
    const chatCardBounds = await page.locator('.plan-chat').boundingBox();
    expect(currentCardBounds).not.toBeNull();
    expect(proposedCardBounds).not.toBeNull();
    expect(chatCardBounds).not.toBeNull();
    expect(proposedCardBounds!.x).toBeGreaterThanOrEqual(
      currentCardBounds!.x + currentCardBounds!.width
    );
    expect(chatCardBounds!.x).toBeGreaterThanOrEqual(
      proposedCardBounds!.x + proposedCardBounds!.width
    );
    await expect(page.locator('.plan-chat__continuations-heading')).toHaveText(
      '¿Cómo quieres seguir?'
    );
    const proposedCanvasBounds = await proposedPlanCard
      .locator('.plan-compare-canvas')
      .boundingBox();
    expect(proposedCanvasBounds).not.toBeNull();
    const mapControlsBounds = await page
      .locator('[data-test="plan-chat-map-controls"]')
      .boundingBox();
    expect(mapControlsBounds).not.toBeNull();
    const mapCardBottom = Math.max(
      currentCardBounds!.y + currentCardBounds!.height,
      proposedCardBounds!.y + proposedCardBounds!.height
    );
    expect(
      mapControlsBounds!.y - mapCardBottom,
      'desktop zoom and fit controls stay directly beneath the before/after maps'
    ).toBeGreaterThanOrEqual(0);
    expect(
      mapControlsBounds!.y - mapCardBottom,
      'desktop zoom controls do not drift toward the bottom of the taller chat column'
    ).toBeLessThanOrEqual(24);
    const proposedPlanOccupancy = await proposedPlanCard
      .locator('.plan-compare-canvas')
      .evaluate((element) => {
        const svg = element as SVGSVGElement;
        const canvas = svg.getBoundingClientRect();
        const viewBox = svg.viewBox.baseVal;
        const bounds = Array.from(
          svg.querySelectorAll<SVGGraphicsElement>(
            '.plan-compare-canvas__space, .plan-compare-canvas__wall'
          )
        ).map((shape) => shape.getBBox());
        const minY = Math.min(...bounds.map(({ y }) => y));
        const maxY = Math.max(...bounds.map(({ y, height }) => y + height));
        const scale = Math.min(canvas.width / viewBox.width, canvas.height / viewBox.height);
        return { height: ((maxY - minY) * scale) / canvas.height };
      });
    console.info(`[visual:chat-plan-occupancy] ${JSON.stringify(proposedPlanOccupancy)}`);
    expect(
      proposedPlanOccupancy.height,
      'the desktop floorplan footprint fills its portrait comparison frame'
    ).toBeGreaterThanOrEqual(0.74);
    expect(
      proposedCanvasBounds!.height,
      'desktop before/after plans should match the prototype height'
    ).toBeGreaterThanOrEqual(380);
  }
  await expect(page.locator('[data-test="plan-return-to-canvas"]')).toHaveText('Volver al lienzo');
  if (mobile) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.plan-review__mobile-tabs')).toBeVisible();
    await expect(page.locator('.plan-review__compare-card')).toHaveCount(2);
    const currentPlanCard = page.locator('.plan-review__compare-card--current');
    const proposalPlanCard = page.locator('.plan-review__compare-card--proposal');
    await expect(proposalPlanCard).toBeVisible();
    await expect(currentPlanCard).toBeHidden();
    const beforeBounds = await currentPlanCard.boundingBox();
    const afterBounds = await proposalPlanCard.boundingBox();
    expect(beforeBounds).toBeNull();
    expect(afterBounds).not.toBeNull();
    await expect(proposalPlanCard).toBeVisible();
    await expect(currentPlanCard).toBeHidden();
    const selectedMap = await proposalPlanCard.locator('.plan-compare-canvas').boundingBox();
    expect(selectedMap).not.toBeNull();
    expect(selectedMap!.width).toBeGreaterThanOrEqual(viewport.width * 0.74);
    expect(selectedMap!.height).toBeGreaterThanOrEqual(260);
    expect(selectedMap!.height).toBeLessThanOrEqual(280);
    const userMessage = await page.locator('.plan-chat__user-message').boundingBox();
    const assistantMessage = await page.locator('.plan-chat__assistant-message').boundingBox();
    const applyButton = await page
      .locator('.plan-chat [data-test="plan-proposal-apply"]')
      .boundingBox();
    const viewportBottom = await mobileViewportBottom(page);
    expect(userMessage).not.toBeNull();
    expect(assistantMessage).not.toBeNull();
    expect(applyButton).not.toBeNull();
    expect(userMessage!.y + userMessage!.height).toBeLessThanOrEqual(viewportBottom - 8);
    expect(assistantMessage!.y + assistantMessage!.height).toBeLessThanOrEqual(viewportBottom - 8);
    expect(applyButton!.y + applyButton!.height).toBeLessThanOrEqual(viewportBottom - 8);
    const chatTouchTargets = await page
      .locator(
        [
          '.plan-review__header-actions .plan-file',
          '.plan-review__header-actions > button',
          '.plan-review__mobile-tabs button',
          '[data-test="plan-chat-map-controls"] button',
          '.plan-chat .plan-review__actions .plan-button',
          '.plan-chat__continuation'
        ].join(',')
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            name: (element as HTMLElement).innerText.trim(),
            width: bounds.width,
            height: bounds.height
          };
        })
      );
    expect(
      chatTouchTargets.every(({ width, height }) => width >= 44 && height >= 44),
      `all mobile chat actions meet the 44 px touch target: ${JSON.stringify(chatTouchTargets)}`
    ).toBe(true);
    const continuationButtons = await page
      .locator('[data-test="plan-chat-continuation"]')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom };
        })
      );
    expect(continuationButtons).toHaveLength(4);
    expect(
      continuationButtons.every((bounds) => bounds.top >= 0 && bounds.bottom <= viewportBottom - 8),
      `all chat follow-up choices should be visible inside the viewport: ${JSON.stringify({ continuationButtons, viewportBottom })}`
    ).toBe(true);
  }
  const previewControls = page.locator('[data-test="plan-chat-map-controls"]');
  await expect(previewControls).toBeVisible();
  await expect(previewControls.locator('button')).toHaveCount(3);
  const previewControlsBounds = await previewControls.boundingBox();
  const proposalPreviewBounds = await page
    .locator('.plan-review__compare-card--proposal .plan-compare-canvas')
    .boundingBox();
  expect(previewControlsBounds).not.toBeNull();
  expect(proposalPreviewBounds).not.toBeNull();
  expect(previewControlsBounds!.y).toBeGreaterThanOrEqual(
    proposalPreviewBounds!.y + proposalPreviewBounds!.height
  );
  await expect(page.locator('[data-test="plan-preview-zoom"]')).toHaveText('100%');
  const proposalDrawing = page.locator(
    '.plan-review__compare-card--proposal .plan-compare-canvas__drawing'
  );
  await previewControls.locator('[data-test="plan-chat-zoom-in"]').click();
  await expect(page.locator('[data-test="plan-preview-zoom"]')).toHaveText('110%');
  await expect(proposalDrawing).toHaveAttribute('transform', /scale\(1\.1\)/);
  await previewControls.locator('[data-test="plan-chat-fit"]').click();
  await expect(page.locator('[data-test="plan-preview-zoom"]')).toHaveText('100%');
  await expect(proposalDrawing).toHaveAttribute('transform', /scale\(1\)/);
  expect(proposalWrites).toHaveLength(0);

  // Continue the proposal as a true text-only AI revision so the approved chat
  // screen shows a before/after plan with a concrete added washroom.
  await page.locator('[data-test="plan-return-to-canvas"]').click();
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeHidden();
  await expect(page.locator('.plan-editor__toolbar')).toBeVisible();
  await page.locator('.plan-editor__advanced-settings > summary').click();
  await page.getByLabel('¿Qué quieres cambiar?').fill('Añade un aseo junto a los dormitorios');
  await page.locator('[data-test="plan-request-proposal"]').click();
  await expect(page.locator('[data-test="plan-proposal-chat-view"]')).toBeVisible();
  await expect(page.locator('.plan-chat h4')).toHaveText('Asistente IA');
  const assistantHeadingIcon = await page.locator('.plan-chat h4 > svg').evaluate((svg) => {
    const icon = svg.getBoundingClientRect();
    const heading = svg.parentElement?.getBoundingClientRect();
    return {
      width: icon.width,
      height: icon.height,
      verticalOffset: heading
        ? Math.abs(icon.top + icon.height / 2 - heading.top - heading.height / 2)
        : Infinity
    };
  });
  expect(assistantHeadingIcon.width, 'assistant sparkle matches the prototype size').toBe(24);
  expect(assistantHeadingIcon.height, 'assistant sparkle remains square').toBe(24);
  expect(
    assistantHeadingIcon.verticalOffset,
    'assistant sparkle aligns with the heading'
  ).toBeLessThanOrEqual(1);
  await expect(page.locator('.plan-chat h4 > svg path')).toHaveCount(2);
  await expect(page.locator('.plan-chat h4 > svg path').first()).toHaveAttribute(
    'd',
    'm12 2 2.2 6.4L20.5 11l-6.3 2.6L12 20l-2.2-6.4L3.5 11l6.3-2.6L12 2Z'
  );
  await expect(page.locator('.plan-chat h4 > svg path').nth(1)).toHaveAttribute(
    'd',
    'm19 14 .9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z'
  );
  await expect.poll(() => proposalRequestBodies.length).toBe(2);
  expect(proposalRequestBodies[1]).toContain('"draftPlan"');
  expect(proposalRequestBodies[1]).toContain('"prompt"');
  expect(proposalRequestBodies[1]).toContain('Añade un aseo junto a los dormitorios');
  expect(proposalRequestBodies[1]).not.toContain('name="image"');
  await expect(
    page.locator('.plan-review__compare-card--proposal .plan-compare-canvas__label').filter({
      hasText: 'Aseo'
    })
  ).toBeVisible();
  const proposalMap = page.locator(
    '.plan-review__compare-card--proposal .plan-compare-canvas__drawing'
  );
  const proposalMapCounts = await proposalMap.evaluate((drawing) => ({
    spaces: drawing.querySelectorAll('.plan-compare-canvas__space').length,
    labels: drawing.querySelectorAll('.plan-compare-canvas__label').length
  }));
  expect(proposalMapCounts.labels).toBe(proposalMapCounts.spaces);
  const compactRoomLabel = page.locator(
    '.plan-review__compare-card--proposal .plan-compare-canvas__label--compact[data-space-id="space-followup-aseo"]'
  );
  await expect(compactRoomLabel).toHaveText('Aseo');
  await expect(compactRoomLabel).toHaveCSS('paint-order', 'stroke');
  await expect(compactRoomLabel).toHaveCSS('stroke-width', '64px');
  await expect(
    proposalMap.locator('.plan-compare-canvas__glyph[data-space-id="space-followup-aseo"]'),
    'the compact washroom remains named without a pictogram crowding its doorway'
  ).toHaveCount(0);
  await expect(page.locator('.plan-chat__user-message')).toContainText(
    'Añade un aseo junto a los dormitorios'
  );
  await expect(page.locator('.plan-chat__assistant-copy')).toHaveText(
    'He preparado la propuesta: 1 zona nueva y 1 zona modificada. Revisa el resultado antes de aplicarlo.'
  );
  await expect(page.locator('[data-test="plan-proposal-apply"]')).toBeVisible();
  await expect(page.locator('[data-test="plan-chat-continuation"]')).toHaveCount(4);
  const continuationGeometry = await page
    .locator('[data-test="plan-chat-continuation"]')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const icon = button.querySelector('svg')?.getBoundingClientRect();
        const textElement = button.querySelector(':scope > span');
        let textBounds = textElement?.getBoundingClientRect() ?? null;
        if (!textBounds) {
          const textNode = Array.from(button.childNodes).find(
            (node): node is Text => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()
          );
          if (textNode) {
            const range = document.createRange();
            range.selectNodeContents(textNode);
            textBounds = range.getBoundingClientRect();
          }
        }
        return {
          iconWidth: icon?.width ?? 0,
          iconHeight: icon?.height ?? 0,
          horizontalGap: icon && textBounds ? textBounds.left - icon.right : -Infinity,
          verticalOffset:
            icon && textBounds
              ? Math.abs(icon.top + icon.height / 2 - textBounds.top - textBounds.height / 2)
              : Infinity
        };
      })
    );
  for (const geometry of continuationGeometry) {
    expect(geometry.iconWidth, 'continuation icons match the reference scale').toBe(24);
    expect(geometry.iconHeight, 'continuation icons stay square').toBe(24);
    expect(
      geometry.horizontalGap,
      'continuation labels remain to the right of their icons'
    ).toBeGreaterThanOrEqual(4);
    expect(
      geometry.verticalOffset,
      'continuation icons align with single- or multi-line labels'
    ).toBeLessThanOrEqual(4);
  }
  const continuationGlyphs = await page
    .locator('[data-test="plan-chat-continuation"] svg')
    .evaluateAll((icons) =>
      icons.map((icon) =>
        Array.from(icon.querySelectorAll('path'), (path) => path.getAttribute('d'))
      )
    );
  expect(
    continuationGlyphs,
    'chat continuation actions match their four distinct prototype icons'
  ).toEqual([
    ['M4 5h16v11H9l-5 4V5Z', 'M8 9h8M8 12h5'],
    ['M5 4h14v16H5zM8 8h8M8 12h8M8 16h5'],
    ['M12 16V4m-5 5 5-5 5 5M4 14v5h16v-5'],
    ['M19 12H5m0 0 6-6m-6 6 6 6']
  ]);
  if (mobile) await expect(page.locator('.plan-review__mobile-tabs')).toBeVisible();
  if (mobile) {
    const mobileChatPlan = page.locator(
      '.plan-review__compare-card--proposal .plan-compare-canvas'
    );
    const mobileChatDrawing = mobileChatPlan.locator('.plan-compare-canvas__drawing');
    const canvasBounds = await mobileChatPlan.boundingBox();
    expect(canvasBounds).not.toBeNull();
    const footprintBounds = await mobileChatDrawing.evaluate((drawing) => {
      const polygons = Array.from(
        drawing.querySelectorAll<SVGPolygonElement>('.plan-compare-canvas__space')
      );
      const bounds = polygons.map((polygon) => polygon.getBoundingClientRect());
      if (!bounds.length) return null;
      const left = Math.min(...bounds.map((bound) => bound.left));
      const right = Math.max(...bounds.map((bound) => bound.right));
      const top = Math.min(...bounds.map((bound) => bound.top));
      const bottom = Math.max(...bounds.map((bound) => bound.bottom));
      return { width: right - left, height: bottom - top };
    });
    expect(footprintBounds).not.toBeNull();
    const roomLabels = await mobileChatPlan.evaluate((canvas) => {
      const spaces = Array.from(canvas.querySelectorAll('.plan-compare-canvas__space'));
      const labels = Array.from(canvas.querySelectorAll('.plan-compare-canvas__label'));
      return labels.map((label, index) => ({
        height: label.getBoundingClientRect().height,
        width: label.getBoundingClientRect().width,
        roomWidth: spaces[index]?.getBoundingClientRect().width ?? 0
      }));
    });
    expect(roomLabels.length).toBeGreaterThan(0);
    expect(
      roomLabels.every(({ height, width, roomWidth }) => height >= 10 && width <= roomWidth * 0.9),
      `mobile room labels should be readable without escaping their zones: ${JSON.stringify(roomLabels)}`
    ).toBe(true);
    expect(
      footprintBounds!.width,
      'the final irregular proposal should fill the mobile canvas rather than render as a thumbnail'
    ).toBeGreaterThanOrEqual(canvasBounds!.width * 0.74);
    expect(
      footprintBounds!.width / footprintBounds!.height,
      'the final mobile proposal matches the approved near-square house-plan proportion'
    ).toBeGreaterThanOrEqual(0.9);
  }
  expect(proposalWrites).toHaveLength(0);
  await screenshot(page, '06-chat-adjustment', viewport);
  if (mobile) {
    await captureResponsiveScreenshot(page, '06-chat-adjustment-320x568', {
      width: 320,
      height: 568
    });
    await page.setViewportSize(viewport);
  }

  await page.locator('[data-test="plan-chat-photo-upload"]').setInputFiles({
    name: 'boceto-ajuste.png',
    mimeType: 'image/png',
    buffer: await syntheticPlanImage(page, !mobile)
  });
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeHidden();
  await expect(
    page.locator('.plan-canvas__space-label').filter({ hasText: 'Cocina' }),
    'photo follow-up must keep the proposed geometry as an unsaved draft'
  ).toBeVisible();
  await expect(page.locator('.plan-file__selected')).toContainText('boceto-ajuste.png');
  const followupPrompt = page.getByLabel('¿Qué quieres cambiar?');
  await expect(followupPrompt).toHaveValue('');
  await followupPrompt.fill('Mantén el aseo y ajusta el plano a este boceto');
  await page.getByRole('button', { name: 'Generar propuesta' }).click();
  await expect(page.locator('[data-test="plan-proposal-review"]')).toBeVisible();
  await expect(page.locator('.plan-editor__header h2')).toHaveText('Convertir boceto en plano');
  await expect.poll(() => proposalRequestBodies.length).toBe(3);
  expect(proposalRequestBodies[2]).toContain('"draftPlan"');
  expect(proposalRequestBodies[2]).toContain('name="image"');
  expect(proposalRequestBodies[2]).toContain('boceto-ajuste.png');
  expect(proposalRequestBodies[2]).toContain('Cocina');
  expect(proposalRequestBodies[2]).toContain('el aseo y ajusta el plano a este boceto');
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
  await openPlanZoneList(page);
  await expect(page.locator('.plan-details__area').filter({ hasText: 'Cocina' })).toBeVisible();
  await assignZone(page, 'Cocina', [0]);
  await assignZone(page, 'Salón', [0]);
  await assignZone(page, 'Baño', [1]);
  await assignZone(page, 'Dormitorio', [2]);
  await assignZone(page, 'Patio', [0, 1, 2]);
  await assignZone(page, 'Jardín', [0, 1, 2]);
  await assignZone(page, 'Cocina', [0]);
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
  await expect(
    page.locator('.tasks-plan-canvas__grid'),
    'the task map uses the clean paper treatment from the approved screen'
  ).toHaveCount(0);
  await expect(page.locator('.tasks-map-viewport')).toHaveCSS('background-image', 'none');
  await expect(
    page.locator('.tasks-plan-canvas svg[householdAreaGlyph]'),
    'the map omits a glyph from one compact space but keeps its polygon and accessible name'
  ).toHaveCount(7);
  await expect(page.locator('.tasks-zone-heading__title h3')).toHaveText('Cocina');
  await expect(page.locator('.tasks-weekbar button svg')).toHaveCount(2);
  await expect(page.locator('[data-test="tasks-add"] svg')).toBeVisible();
  const fairAssignment = page.getByRole('radio', { name: 'Aleatoria y equitativa' });
  await fairAssignment.focus();
  await expect(fairAssignment, 'assignment mode is keyboard focusable').toBeFocused();
  await page.keyboard.press('Space');
  await expect(fairAssignment, 'Space selects the focused assignment mode').toBeChecked();
  await expect(fairAssignment).toHaveAttribute('aria-describedby', 'tasks-random-mode-description');
  await expect(page.locator('#tasks-random-mode-description')).toContainText(
    'Reparto aleatorio equitativo'
  );
  const manualAssignment = page.getByRole('radio', { name: 'Elegir persona' });
  await manualAssignment.focus();
  await page.keyboard.press('Space');
  await expect(manualAssignment, 'the manual mode remains keyboard selectable').toBeChecked();
  if (mobile) {
    await expect(page.locator('.tasks-create__title-caption')).toHaveCSS('position', 'absolute');
    await expect(page.locator('.tasks-assignment-settings h3')).toHaveCSS('position', 'absolute');
    await expect(page.locator('.tasks-assignment-settings')).toHaveAttribute(
      'aria-labelledby',
      'tasks-assignment-mode-title'
    );
    await expect(page.locator('.tasks-schedule__header')).toHaveClass(/visually-hidden/);
    const taskForm = await page.locator('.tasks-create').boundingBox();
    const assignmentSettings = await page.locator('.tasks-assignment-settings').boundingBox();
    const taskTitleRow = await page.locator('.tasks-create__primary-row').boundingBox();
    const taskTitleCaption = await page.locator('.tasks-create__title-caption').boundingBox();
    const taskTitleInput = await page.locator('.tasks-create__title input').boundingBox();
    const viewportBottom = await mobileViewportBottom(page);
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
    expect(taskTitleCaption).not.toBeNull();
    expect(taskTitleInput).not.toBeNull();
    expect(
      taskTitleCaption!.y + taskTitleCaption!.height,
      'the visible task label sits above the input without adding a second flow row'
    ).toBeLessThanOrEqual(taskTitleInput!.y + 1);
    expect(taskTitleRow!.y + taskTitleRow!.height).toBeLessThanOrEqual(assignmentSettings!.y);
    expect(assignmentSettings!.y + assignmentSettings!.height).toBeLessThanOrEqual(
      viewportBottom - 8
    );
  }
  if (mobile) {
    await expect(page.locator('.tasks-zone-heading__controls')).toBeHidden();
    await expect(
      page.locator('.tasks-zone-heading__title h3'),
      'the selected zone title should remain visible beside the weekly list'
    ).toBeVisible();
    await expect(page.locator('.tasks-map__area[role="button"]').first()).toBeVisible();
    const zoneAndWeekLayout = await page.evaluate(() => {
      const heading = document.querySelector('.tasks-zone-heading');
      const title = heading
        ?.querySelector('.tasks-zone-heading__title h3')
        ?.getBoundingClientRect();
      const weekbar = heading?.querySelector('.tasks-weekbar')?.getBoundingClientRect();
      return {
        weekbarIsIntegrated: !!weekbar,
        titleCenter: title ? title.top + title.height / 2 : -1,
        weekbarCenter: weekbar ? weekbar.top + weekbar.height / 2 : -1
      };
    });
    expect(zoneAndWeekLayout.weekbarIsIntegrated).toBe(true);
    expect(
      Math.abs(zoneAndWeekLayout.titleCenter - zoneAndWeekLayout.weekbarCenter),
      'the selected zone and week navigation share one compact mobile row'
    ).toBeLessThanOrEqual(1);
  }
  const taskMap = await page.locator('.tasks-map-viewport').boundingBox();
  expect(taskMap?.height).toBeLessThanOrEqual(mobile ? 350 : 700);
  if (mobile) {
    const renderedPlan = await page.locator('.tasks-plan-canvas').evaluate((svg) => {
      const viewport = svg.parentElement?.getBoundingClientRect();
      const regions = Array.from(svg.querySelectorAll('[data-space-id]')).map((space) =>
        space.getBoundingClientRect()
      );
      if (!viewport || regions.length === 0) {
        return { width: 0, height: 0, viewportWidth: 0 };
      }
      const left = Math.min(...regions.map((bounds) => bounds.left));
      const right = Math.max(...regions.map((bounds) => bounds.right));
      const top = Math.min(...regions.map((bounds) => bounds.top));
      const bottom = Math.max(...regions.map((bounds) => bounds.bottom));
      return { width: right - left, height: bottom - top, viewportWidth: viewport.width };
    });
    expect(renderedPlan.viewportWidth, 'mobile household map must render').toBeGreaterThan(0);
    expect(
      renderedPlan.width,
      'mobile floor regions should use the map width instead of leaving a large empty frame'
    ).toBeGreaterThanOrEqual(renderedPlan.viewportWidth * 0.84);
  }
  if (mobile) {
    const floorTabs = page.locator('.tasks-floor-tabs');
    if (await floorTabs.isVisible()) {
      const floorTabsBounds = await floorTabs.boundingBox();
      expect(floorTabsBounds).not.toBeNull();
      expect(
        floorTabsBounds!.y + floorTabsBounds!.height,
        'floor selection occupies its own row above the map'
      ).toBeLessThanOrEqual(taskMap!.y - 8);
    }
  }
  if (!mobile) {
    expect(
      taskMap?.height,
      'desktop household plan should keep the large canvas seen in the approved mockup'
    ).toBeGreaterThanOrEqual(560);
    const footerButtons = page.locator('.tasks-schedule__footer > .tasks-button');
    await expect(footerButtons).toHaveCount(1);
    for (const button of await footerButtons.all()) {
      await expect(button).toHaveCSS('white-space', 'nowrap');
      const textBounds = await button.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }));
      expect(textBounds.scrollWidth).toBeLessThanOrEqual(textBounds.clientWidth + 1);
    }
  }
  const scheduleHeading = page.getByRole('heading', { name: 'Asignación de la semana' });
  await expect(
    scheduleHeading,
    'the weekly assignment heading stays accessible on both desktop and mobile'
  ).toHaveCount(1);
  if (!mobile) await expect(scheduleHeading).toBeVisible();
  await expect(page.locator('.tasks-schedule__summary svg')).toBeVisible();
  await expect(page.locator('[data-test="tasks-actions-menu"] summary svg')).toBeVisible();
  await expect(page.locator('[data-test="tasks-save"] svg')).toBeVisible();
  const weeklySummarySurface = await page
    .locator('.tasks-schedule__summary')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(weeklySummarySurface).not.toBe('rgba(0, 0, 0, 0)');
  const saveActionWidth = await page.locator('.tasks-schedule__footer').evaluate((footer) => {
    const button = footer.querySelector<HTMLElement>('[data-test="tasks-save"]');
    if (!button) throw new Error('The week footer must contain its save action');
    return {
      button: button.getBoundingClientRect().width,
      available: footer.getBoundingClientRect().width
    };
  });
  expect(
    saveActionWidth.button,
    'the apply-week CTA should retain almost all of the footer width'
  ).toBeGreaterThanOrEqual(saveActionWidth.available - 16);
  if (mobile) {
    expect(
      taskMap?.height,
      'the interactive household plan should dominate mobile tasks'
    ).toBeGreaterThanOrEqual(275);
    const assignmentMode = await page.locator('.tasks-assignment-mode').boundingBox();
    expect(assignmentMode).not.toBeNull();
    expect(assignmentMode!.height).toBeGreaterThanOrEqual(44);
    for (const target of await page.locator('.tasks-assignment-mode label').all()) {
      const bounds = await target.boundingBox();
      expect(
        bounds?.height,
        'assignment choices remain comfortable touch targets'
      ).toBeGreaterThanOrEqual(44);
      const fontSize = await target.evaluate((label) =>
        Number.parseFloat(getComputedStyle(label).fontSize)
      );
      expect(fontSize, 'assignment labels remain legible on mobile').toBeGreaterThanOrEqual(12);
    }
  }
  const taskCanvas = await page.locator('.tasks-plan-canvas').boundingBox();
  const taskPlanFootprint = await page.locator('.tasks-plan-canvas').evaluate((svg) => {
    const regions = Array.from(svg.querySelectorAll<SVGPolygonElement>('.tasks-map__area')).map(
      (space) => space.getBBox()
    );
    if (!regions.length) return null;
    const left = Math.min(...regions.map((bounds) => bounds.x));
    const right = Math.max(...regions.map((bounds) => bounds.x + bounds.width));
    const top = Math.min(...regions.map((bounds) => bounds.y));
    const bottom = Math.max(...regions.map((bounds) => bounds.y + bounds.height));
    return { width: right - left, height: bottom - top };
  });
  expect(taskPlanFootprint).not.toBeNull();
  const taskPlanAspect = taskPlanFootprint!.width / taskPlanFootprint!.height;
  const expectedTaskPlanAspect = mobile ? 1.3 : 1.0;
  expect(
    Math.abs(taskPlanAspect - expectedTaskPlanAspect),
    `the synthetic floor matches the approved ${mobile ? 'mobile' : 'desktop'} silhouette`
  ).toBeLessThanOrEqual(0.04);
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
  const compactAseoLabel = page.locator('.tasks-map__label[data-space-id="space-followup-aseo"]');
  await expect(compactAseoLabel.locator('.tasks-map__name')).toHaveText('Aseo');
  await expect(compactAseoLabel.locator('.tasks-map__name')).toHaveClass(
    /tasks-map__name--compact/
  );
  await expect(compactAseoLabel.locator('.tasks-map__name')).toHaveCSS('paint-order', 'stroke');
  await expect(
    compactAseoLabel.locator('.tasks-map__glyph'),
    'a glyph is omitted when its compact room cannot give it a clear margin'
  ).toHaveCount(0);
  await expect(
    compactAseoLabel.locator('.tasks-map__owner'),
    'a compact room keeps its room name while removing an owner caption that cannot fit'
  ).toHaveCount(0);
  await expect(
    page.locator('.tasks-map__area[data-space-id="space-followup-aseo"]'),
    'the compact-room assignment remains available to assistive technology'
  ).toHaveAttribute('aria-label', 'Aseo, Sin asignar');
  await expect(page.locator('.tasks-map__area.is-selected')).toHaveAttribute(
    'data-space-id',
    kitchenId
  );
  const kitchenTaskMapArea = page.locator(`.tasks-map__area[data-space-id="${kitchenId}"]`);
  await expect(kitchenTaskMapArea).toHaveAttribute('aria-label', 'Cocina, Ana');
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
  await expect(page.locator('.tasks-zone-heading__title h3')).toHaveText('Patio');
  await page.locator(`.tasks-map__area[data-space-id="${kitchenId}"]`).click();
  await expect(page.locator('.tasks-zone-heading__title h3')).toHaveText('Cocina');

  const taskTitles = Array.from({ length: 7 }, () => 'Limpieza de cocina');
  const createForm = page.locator('.tasks-create');
  const planningOptions = createForm.locator('.tasks-create__details');
  await expect(planningOptions.locator('.tasks-create__fields')).toBeHidden();
  await planningOptions.locator('summary').click();
  await expect(planningOptions.locator('.tasks-create__fields')).toBeVisible();
  const manualAssigneeName = activeMemberNames[0].trim();
  await choosePickerOption(page, /^Asignada a:/, manualAssigneeName);
  for (const [index, title] of taskTitles.entries()) {
    await createForm.getByLabel('Nombre de la tarea').fill(title);
    if (index === 0) await choosePickerOption(page, /^Prioridad:/, 'Alta');
    await createForm.getByRole('button', { name: /^Día:/ }).click();
    await page.getByRole('option').nth(index).click();
    await createForm.getByRole('button', { name: /^Zona:/ }).click();
    await page.getByRole('option', { name: /^Cocina/ }).click();
    await page.getByRole('button', { name: 'Añadir a la semana' }).click();
  }
  const secondTaskCard = page.locator('.task-card').nth(1);
  const taskDetailsSummary = secondTaskCard.locator('.task-card__details summary');
  const priorityLauncher = page.locator('[data-test="ai-assistant-open"]');
  await taskDetailsSummary.scrollIntoViewIfNeeded();
  const [launcherBox, summaryBox] = await Promise.all([
    priorityLauncher.boundingBox(),
    taskDetailsSummary.boundingBox()
  ]);
  expect(launcherBox).toBeTruthy();
  expect(summaryBox).toBeTruthy();
  if (!launcherBox || !summaryBox) throw new Error('The assistant or task details are not visible');
  expect(
    launcherBox.x < summaryBox.x + summaryBox.width &&
      launcherBox.x + launcherBox.width > summaryBox.x &&
      launcherBox.y < summaryBox.y + summaryBox.height &&
      launcherBox.y + launcherBox.height > summaryBox.y,
    'the global assistant must not cover the task details control'
  ).toBe(false);
  await screenshot(page, `task-priority-edit-${mobile ? 'mobile' : 'desktop'}`, viewport);
  await taskDetailsSummary.click();
  const taskPriorityTrigger = page.getByRole('button', {
    name: /^Prioridad: .+: Media$/
  });
  await taskPriorityTrigger.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
  );
  const [taskPriorityBox, scheduleFooterBox] = await Promise.all([
    taskPriorityTrigger.boundingBox(),
    page.locator('.tasks-schedule__footer').boundingBox()
  ]);
  expect(taskPriorityBox).toBeTruthy();
  expect(scheduleFooterBox).toBeTruthy();
  if (!taskPriorityBox || !scheduleFooterBox) {
    throw new Error('The priority control or sticky schedule footer is not visible');
  }
  const [taskCardBox, taskFieldsBox] = await Promise.all([
    secondTaskCard.boundingBox(),
    secondTaskCard.locator('.task-card__fields').boundingBox()
  ]);
  expect(taskCardBox).toBeTruthy();
  expect(taskFieldsBox).toBeTruthy();
  if (!taskCardBox || !taskFieldsBox) throw new Error('Expanded task details are not measurable');
  if (mobile) {
    expect(
      taskCardBox.y + taskCardBox.height,
      'expanded task details stay inside task card flow instead of spilling over following content'
    ).toBeGreaterThanOrEqual(taskFieldsBox.y + taskFieldsBox.height - 1);
  }
  expect(
    taskPriorityBox.y >= 0 && taskPriorityBox.y + taskPriorityBox.height <= viewport.height,
    `the priority control is fully visible after scrolling: ${JSON.stringify({
      taskPriorityBox,
      viewport
    })}`
  ).toBe(true);
  expect(
    taskPriorityBox.y + taskPriorityBox.height <= scheduleFooterBox.y,
    `the sticky schedule footer must not obscure task priority controls: ${JSON.stringify({
      taskPriorityBox,
      scheduleFooterBox
    })}`
  ).toBe(true);
  await screenshot(
    page,
    `task-priority-controls-${mobile ? 'mobile' : 'desktop'}`,
    viewport,
    false
  );
  await choosePickerOption(page, /^Prioridad: .+: Media$/, 'Baja');
  await expect(secondTaskCard.locator('[data-test^="household-task-priority-"]')).toHaveCount(1);
  await expect(secondTaskCard.locator('.task-card__priority')).toHaveText('Baja');
  await planningOptions.locator('summary').click();
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  const manualSaveResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/tasks')
  );
  await page.locator('[data-test="tasks-save"]').click();
  const manualSaveResponse = await manualSaveResponsePromise;
  expect(manualSaveResponse.status()).toBe(200);
  const manualSaveEnvelope = await manualSaveResponse.json();
  expect(manualSaveEnvelope.data.tasks.map((task: { priority: string }) => task.priority)).toEqual([
    'high',
    'low',
    'medium',
    'medium',
    'medium',
    'medium',
    'medium'
  ]);
  expect(manualSaveEnvelope.data.tasks).toHaveLength(7);
  const manualAssignedMemberIds = [
    ...new Set(
      manualSaveEnvelope.data.tasks.map(
        (task: { assignedMemberId: string | null }) => task.assignedMemberId
      )
    )
  ];
  expect(
    manualAssignedMemberIds,
    'the fixture persists one deliberate manual assignee'
  ).toHaveLength(1);
  expect(manualAssignedMemberIds[0]).toBeTruthy();
  const manualAssignmentsByTaskId = Object.fromEntries(
    manualSaveEnvelope.data.tasks.map((task: { id: string; assignedMemberId: string | null }) => [
      task.id,
      task.assignedMemberId
    ])
  );
  await page.reload();
  await expect(
    page.locator('[data-test="household-planning-panel-tasks"]'),
    'the saved task week reloads before checking its compact mobile state'
  ).toBeVisible();
  if (mobile) {
    await expect(
      page.locator('[data-test="tasks-create-open"]'),
      'a saved week offers an explicit action to open task creation on mobile'
    ).toBeVisible();
    await expect(page.locator('.tasks-create')).toBeHidden();
  }
  const persistedCheckPage = await page.context().newPage();
  const readPersistedAssignments = async () => {
    const taskWeekResponsePromise = persistedCheckPage.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.endsWith('/api/household/tasks')
    );
    if (persistedCheckPage.url() === 'about:blank') {
      await persistedCheckPage.goto(`/household?tab=tasks&space=${encodeURIComponent(kitchenId)}`);
    } else {
      await persistedCheckPage.reload();
    }
    await expect(
      persistedCheckPage.locator('[data-test="household-planning-panel-tasks"]')
    ).toBeVisible();
    const response = await taskWeekResponsePromise;
    const envelope = await response.json();
    return {
      status: response.status(),
      assignments: Object.fromEntries(
        envelope.data.tasks.map((task: { id: string; assignedMemberId: string | null }) => [
          task.id,
          task.assignedMemberId
        ])
      )
    };
  };
  const readDraftAssignees = async () =>
    (await page.locator('.task-card__member-name').allTextContents()).map((name) => name.trim());

  expect(await readDraftAssignees()).toEqual(Array.from({ length: 7 }, () => manualAssigneeName));
  await expect(page.locator('[data-test="tasks-save"]')).toBeDisabled();
  await page.locator('[data-test="tasks-actions-menu"] summary').click();
  await page.getByRole('button', { name: 'Proponer reparto' }).click();
  await page.locator('[data-test="tasks-actions-menu"] summary').click();
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
  expect(
    await readDraftAssignees(),
    'proposing a random distribution leaves the manually assigned draft untouched'
  ).toEqual(Array.from({ length: 7 }, () => manualAssigneeName));
  const persistedAfterProposal = await readPersistedAssignments();
  expect(persistedAfterProposal.status).toBe(200);
  expect(
    persistedAfterProposal.assignments,
    'a random proposal does not overwrite persisted manual assignments'
  ).toEqual(manualAssignmentsByTaskId);
  await screenshot(page, 'tasks-random-preview-desktop-or-mobile', viewport);
  await page.getByRole('button', { name: 'Usar este reparto' }).click();
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  expect(
    await readDraftAssignees(),
    'the explicit Use action applies the proposed assignees to the editable draft'
  ).toEqual(assignments);
  const persistedAfterUse = await readPersistedAssignments();
  expect(persistedAfterUse.status).toBe(200);
  expect(
    persistedAfterUse.assignments,
    'applying a proposal is still a draft; persistence waits for Save week'
  ).toEqual(manualAssignmentsByTaskId);
  await persistedCheckPage.close();
  for (const ratio of await primaryButtonContrast(page, '[data-test="tasks-save"]')) {
    expect(ratio, 'primary task actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(4.5);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const taskCards = page.locator('.task-card');
  await expect(taskCards).toHaveCount(7);
  const taskCardsFit = await taskCards.evaluateAll((cards) => {
    const visibleBottom = window.innerHeight;
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
    const weekdayLabels = await page.locator('.tasks-day__header h4').evaluateAll((headers) =>
      headers.map((header) => ({
        fullDisplay: getComputedStyle(header.querySelector('.tasks-day__label-full')!).display,
        shortDisplay: getComputedStyle(header.querySelector('.tasks-day__label-short')!).display,
        shortText: header.querySelector('.tasks-day__label-short')!.textContent?.trim(),
        height: Math.round(header.getBoundingClientRect().height),
        accessibleDate: header.getAttribute('aria-label')
      }))
    );
    expect(weekdayLabels).toHaveLength(7);
    for (const weekday of weekdayLabels) {
      expect(
        weekday.fullDisplay,
        'desktop checklist matches the prototype with a compact one-line weekday label'
      ).toBe('none');
      expect(weekday.shortDisplay).not.toBe('none');
      expect(weekday.shortText).toBeTruthy();
      expect(weekday.height, 'weekday labels fit a single line').toBeLessThanOrEqual(20);
      expect(weekday.accessibleDate?.length ?? 0).toBeGreaterThan(weekday.shortText?.length ?? 0);
    }
  }
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
      'mobile checklist rows remain easy to scan and tap'
    ).toBeGreaterThanOrEqual(44);
    const completionTarget = await taskCards.first().locator('.task-card__complete').boundingBox();
    expect(completionTarget).not.toBeNull();
    expect(completionTarget!.width).toBeGreaterThanOrEqual(44);
    expect(completionTarget!.height).toBeGreaterThanOrEqual(44);
    const editTarget = await taskCards.first().locator('.task-card__details summary').boundingBox();
    expect(editTarget).not.toBeNull();
    expect(editTarget!.width).toBeGreaterThanOrEqual(44);
    expect(editTarget!.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => window.scrollTo(0, 0));
    const firstTaskRow = await taskCards.first().boundingBox();
    const viewportBottom = await mobileViewportBottom(page);
    const weekActions = await page.locator('.tasks-schedule__footer').boundingBox();
    expect(firstTaskRow).not.toBeNull();
    expect(weekActions).not.toBeNull();
    await expect(page.locator('.tasks-schedule__footer')).toHaveCSS('position', 'sticky');
    const taskRowsLayout = await taskCards.evaluateAll((cards) => {
      const footerTop = document
        .querySelector('.tasks-schedule__footer')!
        .getBoundingClientRect().top;
      const rows = cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        return { top: Math.round(bounds.top), bottom: Math.round(bounds.bottom) };
      });
      return {
        footerTop: Math.round(footerTop),
        rows,
        visibleCount: rows.filter((row) => row.bottom <= footerTop - 8).length
      };
    });
    expect(
      taskRowsLayout.visibleCount,
      `the mobile checklist should show three full task rows above sticky actions: ${JSON.stringify(taskRowsLayout)}`
    ).toBeGreaterThanOrEqual(3);
    console.info(`[visual:tasks-week-three-rows] ${JSON.stringify(taskRowsLayout)}`);
    await screenshot(page, 'tasks-week-three-rows', viewport);
    for (const size of [viewport, { width: 320, height: 568 }, { width: 568, height: 320 }]) {
      await page.setViewportSize(size);
      await page.locator('.tasks-schedule__footer').scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            );
          })
      );
      const floatingLayout = await page.evaluate(() => {
        const launcher = document
          .querySelector<HTMLElement>('[data-test="ai-assistant-open"]')
          ?.getBoundingClientRect();
        const footer = document
          .querySelector<HTMLElement>('.tasks-schedule__footer')
          ?.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        if (!launcher || !footer)
          throw new Error('The assistant launcher and task footer must exist');
        return {
          viewportHeight,
          launcherBottom: launcher.bottom,
          footerTop: footer.top,
          footerBottom: footer.bottom,
          overlaps:
            launcher.left < footer.right &&
            launcher.right > footer.left &&
            launcher.top < footer.bottom &&
            launcher.bottom > footer.top
        };
      });
      expect(
        floatingLayout.footerBottom,
        `task save controls remain visible at ${size.width}×${size.height}: ${JSON.stringify(floatingLayout)}`
      ).toBeLessThanOrEqual(floatingLayout.viewportHeight + 1);
      expect(
        floatingLayout.overlaps,
        `the global assistant FAB does not cover the sticky task controls at ${size.width}×${size.height}: ${JSON.stringify(floatingLayout)}`
      ).toBe(false);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await taskCards.last().evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const lastTaskBounds = await taskCards.last().boundingBox();
    const scrolledWeekActions = await page.locator('.tasks-schedule__footer').boundingBox();
    const scrolledViewportBottom = await mobileViewportBottom(page);
    expect(lastTaskBounds).not.toBeNull();
    expect(scrolledWeekActions).not.toBeNull();
    expect(
      lastTaskBounds!.y + lastTaskBounds!.height,
      'scrolling exposes the last assignment row above the sticky save actions'
    ).toBeLessThanOrEqual(scrolledWeekActions!.y - 8);
    expect(
      scrolledWeekActions!.y + scrolledWeekActions!.height,
      'sticky save actions stay inside the viewport'
    ).toBeLessThanOrEqual(scrolledViewportBottom - 8);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      firstTaskRow!.y + firstTaskRow!.height,
      'at least one planned task should appear unobscured below the interactive plan without scrolling'
    ).toBeLessThanOrEqual(viewportBottom - 8);
    const firstTaskHit = await taskCards.first().evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      );
      return hit instanceof HTMLElement && element.contains(hit);
    });
    expect(firstTaskHit, 'the visible planned task must not be covered by week actions').toBe(true);
    const footerButtons = page.locator('.tasks-schedule__footer > .tasks-button');
    await expect(footerButtons).toHaveCount(1);
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
    await page.locator('[data-test="tasks-create-open"]').click();
    await expect(page.locator('.tasks-create')).toBeVisible();
  }
  await createForm.getByLabel('Nombre de la tarea').fill('Limpiar cocina');
  await fairAssignment.check();
  await expect(page.locator('.tasks-day__count').first()).toBeHidden();
  await expect(page.locator('.tasks-day__label-short').first()).toBeVisible();
  const firstTaskDetails = taskCards.first().locator('.task-card__details');
  await firstTaskDetails.locator('summary').click();
  await expect(firstTaskDetails.locator('.tasks-link--danger')).toBeVisible();
  await firstTaskDetails.locator('summary').click();
  await expect(
    page.locator('.task-card__fields > .task-card__title'),
    'a single scheduled task per day should not repeat its title in the compact weekly row'
  ).toHaveCount(0);
  const firstWeeklyTask = page.locator('.task-card').first();
  await firstWeeklyTask.locator('.task-card__details summary').click();
  await expect(
    firstWeeklyTask.locator('.task-card__more-fields .task-card__title input'),
    'the title remains editable in the accessible task details'
  ).toHaveValue('Limpieza de cocina');
  await firstWeeklyTask.locator('.task-card__details summary').click();
  if (!mobile) {
    const wideDesktop = { width: 1920, height: 1032 };
    await page.setViewportSize(wideDesktop);
    const taskEditorAlignment = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.tasks-editor');
      const pageContainer = document.querySelector<HTMLElement>(
        'app-page-container.page-container--bounded'
      );
      if (!editor || !pageContainer) throw new Error('The wide desktop task editor is missing');
      const editorBounds = editor.getBoundingClientRect();
      const pageBounds = pageContainer.getBoundingClientRect();
      return {
        width: editorBounds.width,
        center: editorBounds.left + editorBounds.width / 2,
        pageCenter: pageBounds.left + pageBounds.width / 2
      };
    });
    expect(taskEditorAlignment.width).toBeLessThanOrEqual(800);
    expect(
      Math.abs(taskEditorAlignment.center - taskEditorAlignment.pageCenter),
      'the task checklist aligns with the centered plan editor on a wide desktop'
    ).toBeLessThanOrEqual(1);
    await screenshot(page, '05-weekly-tasks-wide-desktop', wideDesktop);
    await page.setViewportSize(viewport);
  }
  if (mobile) {
    const floorTabs = page.locator('.tasks-floor-tabs');
    const map = page.locator('.tasks-map-viewport');
    const floorTabsBounds = await floorTabs.boundingBox();
    const mapBounds = await map.boundingBox();
    expect(floorTabsBounds).not.toBeNull();
    expect(mapBounds).not.toBeNull();
    expect(
      floorTabsBounds!.y + floorTabsBounds!.height,
      'mobile floor tabs sit above the map instead of covering room labels'
    ).toBeLessThanOrEqual(mapBounds!.y - 8);
    for (const tab of await floorTabs.locator('button').all()) {
      const tabBounds = await tab.boundingBox();
      expect(
        tabBounds?.height,
        'floor tabs remain comfortable touch targets'
      ).toBeGreaterThanOrEqual(44);
    }
    const zoneHeadingBounds = await page.locator('.tasks-zone-heading__title h3').boundingBox();
    const weekbarBounds = await page.locator('.tasks-weekbar').boundingBox();
    expect(zoneHeadingBounds).not.toBeNull();
    expect(weekbarBounds).not.toBeNull();
    expect(
      Math.abs(
        zoneHeadingBounds!.y +
          zoneHeadingBounds!.height / 2 -
          (weekbarBounds!.y + weekbarBounds!.height / 2)
      ),
      'selected-zone title and weekly navigation share one balanced row'
    ).toBeLessThanOrEqual(1);
    const headingsOverlap =
      zoneHeadingBounds!.x < weekbarBounds!.x + weekbarBounds!.width &&
      zoneHeadingBounds!.x + zoneHeadingBounds!.width > weekbarBounds!.x &&
      zoneHeadingBounds!.y < weekbarBounds!.y + weekbarBounds!.height &&
      zoneHeadingBounds!.y + zoneHeadingBounds!.height > weekbarBounds!.y;
    expect(headingsOverlap, 'selected-zone title and week controls never overlap').toBe(false);
    for (const control of await page.locator('.tasks-weekbar .tasks-button--icon').all()) {
      const controlBounds = await control.boundingBox();
      expect(controlBounds).not.toBeNull();
      expect(
        controlBounds!.width,
        'weekly navigation has a 44px touch target'
      ).toBeGreaterThanOrEqual(44);
      expect(
        controlBounds!.height,
        'weekly navigation has a 44px touch target'
      ).toBeGreaterThanOrEqual(44);
      expect(
        controlBounds!.x + controlBounds!.width,
        'weekly navigation remains inside the mobile viewport'
      ).toBeLessThanOrEqual(viewport.width);
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
  await page.getByRole('tab', { name: 'Planificación' }).click();
  await page.locator('[data-test="household-planning-tab-tasks"]').click();
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
  await page.locator('[data-test="tasks-save"]').click();
  const tasksResponse = await saveTasksResponse;
  expect(tasksResponse.status()).toBe(200);
  const savedTasksEnvelope = await tasksResponse.json();
  expect(savedTasksEnvelope.data.tasks).toHaveLength(7);
  expect(
    savedTasksEnvelope.data.tasks.every((task: { spaceId: string }) => task.spaceId === kitchenId)
  ).toBe(true);
  const persistedMemberIds = new Set(
    savedTasksEnvelope.data.tasks.map(
      (task: { assignedMemberId: string | null }) => task.assignedMemberId
    )
  );
  expect(
    persistedMemberIds.size,
    'saving after explicit Use persists the randomized assignments instead of the old manual owner'
  ).toBe(3);
  const changedAssignmentCount = savedTasksEnvelope.data.tasks.filter(
    (task: { id: string; assignedMemberId: string | null }) =>
      manualAssignmentsByTaskId[task.id] !== task.assignedMemberId
  ).length;
  expect(
    changedAssignmentCount,
    'saving after explicit Use persists changed taskId-to-member assignments; balance may keep tasks with the former owner'
  ).toBeGreaterThan(0);
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
    const viewportBottom = await mobileViewportBottom(page);
    expect(lastTask).not.toBeNull();
    expect(saveButton).not.toBeNull();
    await expect(page.locator('.task-card').last()).toBeInViewport({ ratio: 0.5 });
    expect(lastTask!.y).toBeGreaterThanOrEqual(0);
    expect(lastTask!.y + lastTask!.height).toBeLessThanOrEqual(viewportBottom - 8);
    expect(saveButton!.y + saveButton!.height).toBeLessThanOrEqual(viewportBottom - 8);
  }
  await screenshot(page, 'tasks-saved-desktop-or-mobile', viewport, !mobile);
  if (mobile) await screenshot(page, 'tasks-agenda-mobile', viewport, false);

  // A field-level edit remains a local draft until saving and persists on reload.
  const editedTitle = 'Limpieza cocina editada';
  const editableTaskRow = page.locator('.task-card').first();
  await editableTaskRow.locator('.task-card__details summary').click();
  const editableTaskTitle = editableTaskRow.locator(
    '.task-card__more-fields .task-card__title input'
  );
  await editableTaskTitle.fill(editedTitle);
  await expect(editableTaskTitle).toHaveValue(editedTitle);
  await expect(page.locator('[data-test="tasks-save"]')).toBeEnabled();
  for (const ratio of await primaryButtonContrast(page, '[data-test="tasks-save"]')) {
    expect(ratio, 'weekly task actions meet WCAG AA in both themes').toBeGreaterThanOrEqual(4.5);
  }
  const editSave = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname.endsWith('/api/household/tasks')
  );
  await page.locator('[data-test="tasks-save"]').click();
  expect((await editSave).status()).toBe(200);
  await page.reload();
  await page.getByRole('tab', { name: 'Planificación' }).click();
  await page.locator('[data-test="household-planning-tab-tasks"]').click();
  await expect(page.locator('.task-card')).toHaveCount(7);
  const persistedTaskRow = page.locator('.task-card').first();
  await persistedTaskRow.locator('.task-card__details summary').click();
  await expect(
    persistedTaskRow.locator('.task-card__more-fields .task-card__title input')
  ).toHaveValue(editedTitle);

  // Keyboard tab navigation, focus visibility, orientation, breakpoints, and minimum width.
  const planTab = page.getByRole('tab', { name: 'Plano' });
  const planningTab = page.getByRole('tab', { name: 'Planificación' });
  await planTab.click();
  await planTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(planningTab).toBeFocused();
  await expect(planningTab).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => planningTab.evaluate((tab) => getComputedStyle(tab).outlineStyle))
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
      const footerButtons = page.locator('.tasks-schedule__footer > .tasks-button');
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
