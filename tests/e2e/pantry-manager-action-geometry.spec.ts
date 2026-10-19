import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

const DESKTOP = { width: 1440, height: 900 };
const MOBILES = [
  { width: 393, height: 851 },
  { width: 320, height: 568 },
  { width: 568, height: 320 }
];

async function medirAcciones(
  page: import('@playwright/test').Page,
  selector: string
): Promise<{
  token: {
    height: number;
    paddingBlock: string;
    paddingInline: string;
    fontSize: string;
    borderRadius: string;
    borderTopWidth: string;
    borderTopStyle: string;
  };
  buttons: Array<{
    height: number;
    paddingBlock: string;
    paddingInline: string;
    fontSize: string;
    borderRadius: string;
    borderTopWidth: string;
    borderTopStyle: string;
  }>;
}> {
  return page.evaluate((buttonSelector) => {
    const probe = document.createElement('button');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.boxSizing = 'border-box';
    probe.style.height = 'var(--button-control-height)';
    probe.style.paddingBlock = 'var(--button-control-padding-block)';
    probe.style.paddingInline = 'var(--button-control-padding-inline)';
    probe.style.fontSize = 'var(--button-control-font-size)';
    probe.style.border = '1px solid var(--border-default)';
    probe.style.borderRadius = 'var(--radius-lg)';
    document.body.appendChild(probe);
    const tokenStyle = getComputedStyle(probe);
    const token = {
      height: probe.getBoundingClientRect().height,
      paddingBlock: tokenStyle.paddingBlockStart,
      paddingInline: tokenStyle.paddingInlineStart,
      fontSize: tokenStyle.fontSize,
      borderRadius: tokenStyle.borderTopLeftRadius,
      borderTopWidth: tokenStyle.borderTopWidth,
      borderTopStyle: tokenStyle.borderTopStyle
    };
    probe.remove();
    return {
      token,
      buttons: Array.from(document.querySelectorAll<HTMLElement>(buttonSelector), (button) => {
        const style = getComputedStyle(button);
        return {
          height: button.getBoundingClientRect().height,
          paddingBlock: style.paddingBlockStart,
          paddingInline: style.paddingInlineStart,
          fontSize: style.fontSize,
          borderRadius: style.borderTopLeftRadius,
          borderTopWidth: style.borderTopWidth,
          borderTopStyle: style.borderTopStyle
        };
      })
    };
  }, selector);
}

async function comprobarFormulario(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  nombre: string,
  fichaSelector: string,
  actionSelector: string,
  botonesEsperados: number
): Promise<void> {
  const movil = testInfo.project.name !== 'chromium';
  const viewports = movil ? MOBILES : [DESKTOP];
  const directorio = join(
    resolve(
      process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-pantry-manager-action-geometry-1'
    ),
    testInfo.project.name
  );
  mkdirSync(directorio, { recursive: true });
  const acciones = page.locator(actionSelector);
  await expect(acciones).toHaveCount(botonesEsperados);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate((selector) => {
      const ficha = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        left: ficha?.left,
        right: ficha?.right
      };
    }, fichaSelector);
    expect(layout.viewport).toBe(viewport.width);
    expect(
      layout.document,
      `${nombre}: no debe haber overflow en ${viewport.width}x${viewport.height}`
    ).toBeLessThanOrEqual(layout.viewport);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(viewport.width);

    const geometry = await medirAcciones(page, actionSelector);
    for (const button of geometry.buttons) {
      expect(button.height, `${nombre}: alto del boton`).toBe(geometry.token.height);
      expect(button.paddingBlock, `${nombre}: padding vertical`).toBe(geometry.token.paddingBlock);
      expect(button.paddingInline, `${nombre}: padding horizontal`).toBe(
        geometry.token.paddingInline
      );
      expect(button.fontSize, `${nombre}: tipografia`).toBe(geometry.token.fontSize);
      expect(button.borderRadius, `${nombre}: radio del borde`).toBe(geometry.token.borderRadius);
      expect(button.borderTopWidth, `${nombre}: grosor del borde`).toBe(
        geometry.token.borderTopWidth
      );
      expect(button.borderTopStyle, `${nombre}: estilo del borde`).toBe(
        geometry.token.borderTopStyle
      );
    }
    await page.screenshot({
      path: join(directorio, `${nombre}-${viewport.width}x${viewport.height}.png`),
      animations: 'disabled'
    });
  }

  if (movil) {
    await page.setViewportSize(MOBILES[0]);
    const cta = page.locator(actionSelector).first();
    await cta.scrollIntoViewIfNeeded();
    const bounds = await page.evaluate((selector) => {
      const button = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      const navigation = document
        .querySelector<HTMLElement>('.bottom-nav')
        ?.getBoundingClientRect();
      return { top: button?.top, bottom: button?.bottom, navigationTop: navigation?.top };
    }, actionSelector);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.navigationTop!);
    await page.screenshot({
      path: join(directorio, `${nombre}-cta-393x851.png`),
      animations: 'disabled'
    });
  }
}

test.describe('geometría de las acciones de los gestores', () => {
  test.beforeEach(async ({ page }) => {
    await registerWithHousehold(page, '/pantry');
  });

  test('alta de categoría conserva la altura y padding estándar en toda la matriz', async ({
    page
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/pantry/categories/new?parent=alimentos');
    await expect(page.locator('[data-test="gestor-categorias-ficha"]')).toBeVisible();
    await page.locator('[data-test="gestor-categorias-color-#4caf50"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-test="gestor-categorias-color-#4caf50"]')).toHaveClass(
      /swatch--activa/
    );

    await comprobarFormulario(
      page,
      testInfo,
      'categoria',
      '[data-test="gestor-categorias-ficha"]',
      '[data-test="gestor-categorias-ficha"] .ficha__acciones .boton',
      2
    );
    expect(errors).toEqual([]);
  });

  test('alta de producto y añadir alias conservan la altura y padding estándar', async ({
    page
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/pantry/products/new');
    await expect(page.locator('[data-test="gestor-productos-ficha"]')).toBeVisible();
    await page.locator('#gestor-producto-alias').fill('alias de prueba');
    await page.locator('[data-test="gestor-productos-anadir-alias"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-test="gestor-productos-ficha"] app-tag')).toContainText(
      'alias de prueba'
    );

    await comprobarFormulario(
      page,
      testInfo,
      'producto',
      '[data-test="gestor-productos-ficha"]',
      '[data-test="gestor-productos-ficha"] .boton',
      3
    );
    expect(errors).toEqual([]);
  });
});
