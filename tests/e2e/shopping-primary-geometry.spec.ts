import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Locator } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 719, height: 900 },
  { width: 720, height: 900 },
  { width: 721, height: 900 },
  { width: 1440, height: 900 }
] as const;

const GEOMETRY_TOLERANCE = 1;

type ButtonGeometry = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  margin: { top: number; right: number; bottom: number; left: number };
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  gap: number;
  borderWidths: { top: number; right: number; bottom: number; left: number };
  borderStyle: string;
  borderRadius: string;
  boxSizing: string;
  display: string;
  alignItems: string;
  justifyContent: string;
  transform: string;
  textOverflow: boolean;
  tokens: {
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    gap: string;
    paddingBlock: string;
    paddingInline: string;
    borderRadius: string;
  };
};

async function readGeometry(button: Locator): Promise<ButtonGeometry> {
  return button.evaluate((element) => {
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const resolveToken = (property: string, token: string): string => {
      const probe = document.createElement('span');
      probe.style.position = 'fixed';
      probe.style.visibility = 'hidden';
      probe.style.setProperty(property, `var(${token})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(property).trim();
      probe.remove();
      return value;
    };

    return {
      width: rect.width,
      height: rect.height,
      padding: {
        top: parseFloat(styles.paddingTop),
        right: parseFloat(styles.paddingRight),
        bottom: parseFloat(styles.paddingBottom),
        left: parseFloat(styles.paddingLeft)
      },
      margin: {
        top: parseFloat(styles.marginTop),
        right: parseFloat(styles.marginRight),
        bottom: parseFloat(styles.marginBottom),
        left: parseFloat(styles.marginLeft)
      },
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      lineHeight: styles.lineHeight,
      gap: parseFloat(styles.columnGap),
      borderWidths: {
        top: parseFloat(styles.borderTopWidth),
        right: parseFloat(styles.borderRightWidth),
        bottom: parseFloat(styles.borderBottomWidth),
        left: parseFloat(styles.borderLeftWidth)
      },
      borderStyle: styles.borderTopStyle,
      borderRadius: styles.borderTopLeftRadius,
      boxSizing: styles.boxSizing,
      display: styles.display,
      alignItems: styles.alignItems,
      justifyContent: styles.justifyContent,
      transform: styles.transform,
      textOverflow: element.scrollWidth > element.clientWidth + 1,
      tokens: {
        fontFamily: resolveToken('font-family', '--font-sans'),
        fontSize: resolveToken('font-size', '--text-sm'),
        fontWeight: resolveToken('font-weight', '--font-medium'),
        gap: resolveToken('column-gap', '--space-2'),
        paddingBlock: resolveToken('padding-top', '--space-2'),
        paddingInline: resolveToken('padding-left', '--space-4'),
        borderRadius: resolveToken('border-top-left-radius', '--radius-lg')
      }
    };
  });
}

function expectTextButtonContract(actual: ButtonGeometry, label: string): void {
  expect(Math.abs(actual.height - 44), `${label}: alto común de 44 px`).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE
  );
  expect(actual.boxSizing, `${label}: caja`).toBe('border-box');
  expect(actual.padding.top, `${label}: padding superior`).toBeCloseTo(8, 0);
  expect(actual.padding.bottom, `${label}: padding inferior`).toBeCloseTo(8, 0);
  expect(actual.padding.left, `${label}: padding izquierdo`).toBeCloseTo(16, 0);
  expect(actual.padding.right, `${label}: padding derecho`).toBeCloseTo(16, 0);
  expect(actual.fontFamily, `${label}: familia`).toBe(actual.tokens.fontFamily);
  expect(actual.fontSize, `${label}: tamaño`).toBe(actual.tokens.fontSize);
  expect(actual.fontWeight, `${label}: peso`).toBe(actual.tokens.fontWeight);
  expect(actual.lineHeight, `${label}: interlineado unitario`).toBe(actual.fontSize);
  expect(
    Math.abs(actual.gap - parseFloat(actual.tokens.gap)),
    `${label}: separación`
  ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
  expect(actual.borderRadius, `${label}: radio`).toBe(actual.tokens.borderRadius);
  expect(actual.borderWidths, `${label}: borde`).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
  expect(actual.borderStyle, `${label}: estilo de borde`).toBe('solid');
  expect(['flex', 'inline-flex'], `${label}: display flex`).toContain(actual.display);
  expect(actual.alignItems, `${label}: alineación vertical`).toBe('center');
  expect(actual.justifyContent, `${label}: alineación horizontal`).toBe('center');
  expect(actual.margin, `${label}: márgenes`).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(actual.transform, `${label}: transform`).toBe('none');
  expect(actual.textOverflow, `${label}: texto íntegro`).toBe(false);
  expect(actual.width, `${label}: ancho natural positivo`).toBeGreaterThan(0);
}

function expectSameGeometry(expected: ButtonGeometry, actual: ButtonGeometry, label: string): void {
  expect(Math.abs(actual.height - expected.height), `${label}: alto`).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE
  );
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    expect(
      Math.abs(actual.padding[side] - expected.padding[side]),
      `${label}: padding ${side}`
    ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE);
    expect(actual.margin[side], `${label}: margen ${side}`).toBe(expected.margin[side]);
    expect(actual.borderWidths[side], `${label}: borde ${side}`).toBe(expected.borderWidths[side]);
  }
  for (const property of [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'gap',
    'borderStyle',
    'borderRadius',
    'boxSizing',
    'display',
    'alignItems',
    'justifyContent',
    'transform'
  ] as const) {
    expect(actual[property], `${label}: ${property}`).toBe(expected[property]);
  }
  expect(actual.textOverflow, `${label}: texto íntegro`).toBe(false);
}

async function expectNoHorizontalOverflow(
  page: import('@playwright/test').Page,
  viewportWidth: number
): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    client: document.documentElement.clientWidth,
    offenders: Array.from(document.body.querySelectorAll('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        };
      })
      .filter((element) => element.right > window.innerWidth + 1 || element.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8)
  }));
  expect(
    dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport,
    `la vista no debe introducir scroll horizontal (${viewportWidth}px): ${JSON.stringify(dimensions)}`
  ).toBe(true);
}

async function tabTo(page: import('@playwright/test').Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('El control primario no se alcanza con Tab desde el campo anterior.');
}

test.describe('Geometría de los CTA primarios de Compra', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'La unidad cubre Chromium escritorio y Chromium con emulación Pixel 5.'
  );

  test('crear, añadir y terminar comparten el contrato visual y persisten la lista', async ({
    page
  }, testInfo) => {
    const screenshotPath = (filename: string): string => {
      const directory = process.env.HOGARIA_E2E_SCREENSHOT_DIR;
      if (!directory) return testInfo.outputPath(filename);
      mkdirSync(directory, { recursive: true });
      return join(directory, `${testInfo.project.name}-${filename}`);
    };

    await registerAndGoto(page, '/shopping', 'shopping-primary-geometry');
    await shoppingNewListAction(page).click();

    const listName = page.locator('[data-test="list-name"]');
    const create = page.locator('[data-test="create-submit"] button');
    await expect(create).toBeVisible();
    await expect(create).toBeDisabled();

    const createDisabled = await readGeometry(create);
    await listName.fill('Lista geométrica sintética');
    await expect(create).toBeEnabled();

    const createEnabled = await readGeometry(create);
    expectTextButtonContract(createDisabled, 'Crear lista deshabilitado');
    expectSameGeometry(createDisabled, createEnabled, 'Crear lista habilitado');

    await create.hover();
    const createHovered = await readGeometry(create);
    expectTextButtonContract(createHovered, 'Crear lista hover');
    expectSameGeometry(createEnabled, createHovered, 'Crear lista hover');

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      await expectNoHorizontalOverflow(page, viewport.width);
      const geometry = await readGeometry(create);
      expectTextButtonContract(geometry, `Crear lista a ${viewport.width}px`);
      expectSameGeometry(createEnabled, geometry, `Crear lista a ${viewport.width}px`);
      if (viewport.width === 1440) {
        await page.mouse.move(viewport.width - 2, 2);
        await page.screenshot({ path: screenshotPath('shopping-create-desktop.png') });
      } else if (viewport.width === 393) {
        await page.mouse.move(viewport.width - 2, 2);
        await page.screenshot({ path: screenshotPath('shopping-create-mobile.png') });
      }
    }

    await listName.focus();
    await tabTo(page, create);
    await expect(create).toBeFocused();
    const focusedCreate = await readGeometry(create);
    expectTextButtonContract(focusedCreate, 'Crear lista con foco de teclado');
    expectSameGeometry(createEnabled, focusedCreate, 'Crear lista con foco de teclado');
    const createFocus = await create.evaluate((element) => ({
      visible: element.matches(':focus-visible'),
      outlineStyle: getComputedStyle(element).outlineStyle,
      outlineWidth: getComputedStyle(element).outlineWidth
    }));
    expect(createFocus.visible).toBe(true);
    expect(createFocus.outlineStyle).toBe('solid');
    expect(Number.parseFloat(createFocus.outlineWidth)).toBeGreaterThanOrEqual(2);

    await page.route('**/api/shopping/lists', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      await route.continue();
    });
    const createRequest = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().includes('/api/shopping/lists')
    );
    await create.press('Enter');
    await createRequest;
    await expect(create).toBeDisabled();
    await expect(create).toContainText(/Creando/i);
    const creating = await readGeometry(create);
    expectTextButtonContract(creating, 'Crear lista en carga');
    expectSameGeometry(createEnabled, creating, 'Crear lista en carga');
    await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
    await page.unroute('**/api/shopping/lists');

    const addInput = page.locator('[data-test="add-input"]');
    const add = page.locator('[data-test="add-submit"] button');
    const complete = page.locator('[data-test="complete"] button');
    await expect(add).toBeVisible();
    await expect(add).toBeDisabled();
    await expect(complete).toBeVisible();

    const addDisabled = await readGeometry(add);
    await addInput.fill('1 Leche');
    await expect(add).toBeEnabled();
    const addEnabled = await readGeometry(add);
    expectTextButtonContract(addDisabled, 'Añadir deshabilitado');
    expectSameGeometry(addDisabled, addEnabled, 'Añadir habilitado');

    await add.hover();
    const addHovered = await readGeometry(add);
    expectTextButtonContract(addHovered, 'Añadir hover');
    expectSameGeometry(addEnabled, addHovered, 'Añadir hover');

    await addInput.focus();
    await tabTo(page, add);
    await expect(add).toBeFocused();
    const addFocused = await readGeometry(add);
    expectTextButtonContract(addFocused, 'Añadir con foco de teclado');
    expectSameGeometry(addEnabled, addFocused, 'Añadir con foco de teclado');
    await add.press('Enter');
    await expect(page.locator('[data-test="item-row"]')).toContainText('Leche');

    let canonical: ButtonGeometry | undefined;
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      await expectNoHorizontalOverflow(page, viewport.width);
      await complete.scrollIntoViewIfNeeded();
      const addGeometry = await readGeometry(add);
      const completeGeometry = await readGeometry(complete);
      expectTextButtonContract(addGeometry, `Añadir a ${viewport.width}px`);
      expectTextButtonContract(completeGeometry, `Terminar compra a ${viewport.width}px`);
      expectSameGeometry(addGeometry, completeGeometry, `CTA de Compra a ${viewport.width}px`);
      if (canonical) {
        expectSameGeometry(canonical, addGeometry, `Añadir a ${viewport.width}px`);
        expectSameGeometry(canonical, completeGeometry, `Terminar compra a ${viewport.width}px`);
      } else {
        canonical = addGeometry;
      }
      if (viewport.width === 1440) {
        await page.mouse.move(viewport.width - 2, 2);
        await page.screenshot({ path: screenshotPath('shopping-detail-desktop.png') });
      } else if (viewport.width === 393) {
        await page.mouse.move(viewport.width - 2, 2);
        await page.screenshot({ path: screenshotPath('shopping-detail-mobile.png') });
      }
    }

    await page.reload();
    await expect(page.locator('[data-test="item-row"]')).toContainText('Leche');
    await expect(page.locator('.detail__title')).toContainText('Lista geométrica sintética');
  });
});
