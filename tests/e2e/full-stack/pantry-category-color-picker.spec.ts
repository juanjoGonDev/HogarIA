import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../fixtures';
import { registerWithHousehold } from '../helpers/auth';

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;
const PRESETS = [
  '#4caf50',
  '#b26a00',
  '#e05a5a',
  '#4fa3d1',
  '#6c8ae4',
  '#c99a2e',
  '#8e5ac8',
  '#2fa79b'
];

async function captureEditor(page: Page, testInfo: TestInfo): Promise<void> {
  if (!SCREENSHOT_DIR) return;
  const viewport = testInfo.project.name === 'chromium' ? '1440x900' : '393x851';
  const directory = join(resolve(SCREENSHOT_DIR), testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.locator('[data-test="gestor-categorias-ficha"]').screenshot({
    path: join(directory, `category-color-picker-${viewport}.png`),
    animations: 'disabled',
    style: 'header.header, nav.bottom-nav, app-toast { visibility: hidden !important; }'
  });
}

async function chooseColor(page: Page, color: string): Promise<void> {
  await page
    .locator('[data-test="gestor-categorias-campo-color"] input')
    .evaluate((element, value) => {
      const input = element as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, color);
}

test.describe('selector de color de categoría', () => {
  test('elige y guarda un color personalizado sin escribir hexadecimal', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    const posts: Array<Record<string, unknown>> = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'POST' && url.pathname === '/api/pantry/categories') {
        posts.push(request.postDataJSON() as Record<string, unknown>);
      }
    });

    await registerWithHousehold(page, '/pantry/categories/new', 'QA Category Color Picker');
    await expect(page.locator('[data-test="gestor-categorias-ficha"]')).toBeVisible();

    const colorInput = page.locator('[data-test="gestor-categorias-campo-color"] input');
    await expect(colorInput).toHaveAttribute('type', 'color');
    await expect(colorInput).toHaveAttribute('aria-label', 'Elegir color personalizado');
    await expect(
      page.locator('[data-test="gestor-categorias-campo-color"] input[type="text"]')
    ).toHaveCount(0);
    await expect(page.locator('[data-test="gestor-categorias-color-valor"]')).toHaveText('#8A8F98');

    const swatches = page.locator('[data-test^="gestor-categorias-color-#"]');
    await expect(swatches).toHaveCount(PRESETS.length);
    for (const color of PRESETS) {
      const target = page.locator(`[data-test="gestor-categorias-color-${color}"]`);
      await expect(target).toHaveAttribute('aria-pressed', 'false');
      const box = await target.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    await page.locator(`[data-test="gestor-categorias-color-${PRESETS[0]}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(
      page.locator(`[data-test="gestor-categorias-color-${PRESETS[0]}"]`)
    ).toHaveAttribute('aria-pressed', 'true');
    await page.locator(`[data-test="gestor-categorias-color-${PRESETS.at(-1)}"]`).focus();
    await page.keyboard.press('Tab');
    await expect(colorInput).toBeFocused();
    await expect(page.locator('[data-test="gestor-categorias-color-picker-surface"]')).toHaveCSS(
      'outline-style',
      'solid'
    );

    const pickerSurface = page.locator('[data-test="gestor-categorias-color-picker-surface"]');
    if (testInfo.project.name === 'mobile-chrome') await pickerSurface.tap();
    else await pickerSurface.click();
    await expect(colorInput).toBeFocused();
    await chooseColor(page, '#12a4bc');
    await expect(colorInput).toHaveValue('#12a4bc');
    await expect(page.locator('[data-test="gestor-categorias-color-valor"]')).toHaveText('#12A4BC');
    await expect(
      page.locator(`[data-test="gestor-categorias-color-${PRESETS[0]}"]`)
    ).toHaveAttribute('aria-pressed', 'false');

    const viewports = [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 719, height: 850 },
      { width: 720, height: 850 },
      { width: 721, height: 850 },
      { width: 767, height: 850 },
      { width: 768, height: 850 },
      { width: 769, height: 850 },
      { width: 1023, height: 850 },
      { width: 1024, height: 850 },
      { width: 1025, height: 850 },
      { width: 1440, height: 900 }
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => ({
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        pickerHeight: document
          .querySelector('[data-test="gestor-categorias-color-picker-surface"]')
          ?.getBoundingClientRect().height
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.pickerHeight).toBeGreaterThanOrEqual(44);
      await expect(colorInput).toHaveValue('#12a4bc');
    }

    await page.setViewportSize(
      testInfo.project.name === 'chromium'
        ? { width: 1440, height: 900 }
        : { width: 393, height: 851 }
    );
    await captureEditor(page, testInfo);

    const name = `QA color personalizado ${Date.now()}`;
    await page.locator('[data-test="gestor-categorias-campo-nombre"] input').fill(name);
    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);
    expect(posts).toHaveLength(1);
    expect(posts[0].color).toBe('#12A4BC');

    const filter = page.locator('#gestor-categorias-q');
    await filter.fill(name);
    const row = page.locator('[data-test^="tabla-fila-"]').filter({ hasText: name });
    await expect(row.locator('.celda__punto')).toHaveCSS('background-color', 'rgb(18, 164, 188)');
    await page.reload();
    await filter.fill(name);
    await expect(row.locator('.celda__punto')).toHaveCSS('background-color', 'rgb(18, 164, 188)');
    await expect(pageErrors).toEqual([]);

    await page.locator('[data-test="gestor-categorias-nueva"]').click();
    const categoryWithoutColor = `QA sin color ${Date.now()}`;
    await page
      .locator('[data-test="gestor-categorias-campo-nombre"] input')
      .fill(categoryWithoutColor);
    await expect(page.locator('[data-test="gestor-categorias-color-valor"]')).toHaveText('#8A8F98');
    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);
    expect(posts).toHaveLength(2);
    expect(posts[1].color).toBeNull();
    await expect(pageErrors).toEqual([]);
  });
});
