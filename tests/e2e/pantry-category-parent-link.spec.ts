import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

const filaDe = (page: import('@playwright/test').Page, texto: string | RegExp) =>
  page.locator('[data-test^="tabla-fila-"]').filter({ hasText: texto });

async function crearHija(
  page: import('@playwright/test').Page,
  nombre: string,
  parentKey: string,
  parentName: string
): Promise<string> {
  await page.goto(`/pantry/categories/new?parent=${encodeURIComponent(parentKey)}`);
  await expect(
    page.locator('[data-test="gestor-categorias-campo-padre"] .picker__value')
  ).toHaveText(parentName);
  await page.locator('[data-test="gestor-categorias-campo-nombre"] input').fill(nombre);
  await page.locator('[data-test="gestor-categorias-guardar"]').click();
  await expect(page).toHaveURL(/\/pantry\/categories$/);
  await page.locator('#gestor-categorias-q').fill(nombre);
  const fila = filaDe(page, nombre);
  await expect(fila.locator('.celda--padre')).toHaveText(parentName);
  const marcador = await fila
    .locator('[data-test^="gestor-categorias-fila-"]')
    .getAttribute('data-test');
  expect(marcador).toMatch(/^gestor-categorias-fila-/);
  return marcador!.slice('gestor-categorias-fila-'.length);
}

test.describe('enlace directo para crear subcategorías', () => {
  test.beforeEach(async ({ page }) => {
    await registerWithHousehold(page, '/pantry');
  });

  test('el padre del enlace sobrevive a F5 y se guarda; una clave desconocida se ignora', async ({
    page
  }, testInfo) => {
    const erroresPagina: string[] = [];
    page.on('pageerror', (error) => erroresPagina.push(error.message));
    const movil = testInfo.project.name === 'mobile-chrome';
    const viewports = movil
      ? [
          { width: 393, height: 851 },
          { width: 320, height: 568 },
          { width: 568, height: 320 }
        ]
      : [{ width: 1440, height: 900 }];
    const directorio = join(
      resolve(
        process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-pantry-category-parent-link-1'
      ),
      testInfo.project.name
    );
    mkdirSync(directorio, { recursive: true });

    await page.setViewportSize(viewports[0]);
    await page.goto('/pantry/categories/new?parent=alimentos');
    const selectorPadre = page.locator(
      '[data-test="gestor-categorias-campo-padre"] .picker__value'
    );
    await expect(selectorPadre).toHaveText('Alimentos');

    await page.reload();
    await expect(page).toHaveURL(/\/pantry\/categories\/new\?parent=alimentos$/);
    await expect(selectorPadre).toHaveText('Alimentos');
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const form = document
          .querySelector('[data-test="gestor-categorias-ficha"]')
          ?.getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          formLeft: form?.left,
          formRight: form?.right
        };
      });
      expect(layout.viewport).toBe(viewport.width);
      expect(
        layout.document,
        `sin overflow en ${viewport.width}x${viewport.height}`
      ).toBeLessThanOrEqual(layout.viewport);
      expect(layout.formLeft).toBeGreaterThanOrEqual(0);
      expect(layout.formRight).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({
        path: join(directorio, `alta-subcategoria-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled'
      });
    }

    if (movil) {
      await page.setViewportSize({ width: 393, height: 851 });
      const guardar = page.locator('[data-test="gestor-categorias-guardar"]');
      await guardar.scrollIntoViewIfNeeded();
      const cta = await page.evaluate(() => {
        const boton = document
          .querySelector<HTMLElement>('[data-test="gestor-categorias-guardar"]')
          ?.getBoundingClientRect();
        const navegacion = document
          .querySelector<HTMLElement>('.bottom-nav')
          ?.getBoundingClientRect();
        return {
          top: boton?.top,
          bottom: boton?.bottom,
          height: boton?.height,
          navTop: navegacion?.top
        };
      });
      expect(cta.top).toBeGreaterThanOrEqual(0);
      expect(cta.bottom).toBeLessThanOrEqual(cta.navTop!);
      await page.screenshot({
        path: join(directorio, 'alta-subcategoria-cta-393x851.png'),
        animations: 'disabled'
      });
    }

    await page.locator('[data-test="gestor-categorias-campo-nombre"] input').fill('Fruta local');
    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);
    await page.locator('#gestor-categorias-q').fill('Fruta local');
    const fila = filaDe(page, 'Fruta local');
    await expect(fila).toBeVisible();
    await expect(fila.locator('.celda--padre')).toHaveText('Alimentos');

    await page.goto('/pantry/categories/new?parent=category_food');
    await expect(selectorPadre).toHaveText('Sin padre: queda arriba del todo');

    let parentKey = 'alimentos';
    let parentName = 'Alimentos';
    for (const level of [2, 3, 4]) {
      parentName = `Nivel ${level}`;
      parentKey = await crearHija(
        page,
        parentName,
        parentKey,
        level === 2 ? 'Alimentos' : `Nivel ${level - 1}`
      );
    }

    await page.goto(`/pantry/categories/new?parent=${encodeURIComponent(parentKey)}`);
    await expect(selectorPadre).toHaveText('Sin padre: queda arriba del todo');
    await page
      .locator('[data-test="gestor-categorias-campo-nombre"] input')
      .fill('Categoria sin padre por profundidad');
    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);
    await page.locator('#gestor-categorias-q').fill('Categoria sin padre por profundidad');
    const filaSinPadre = filaDe(page, 'Categoria sin padre por profundidad');
    await expect(filaSinPadre).toBeVisible();
    await expect(filaSinPadre.locator('.celda--padre')).toHaveCount(0);
    expect(erroresPagina).toEqual([]);
  });
});
