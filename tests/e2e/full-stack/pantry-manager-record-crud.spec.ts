import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../fixtures';
import { registerWithHousehold } from '../helpers/auth';

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

async function captureEditor(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  await page.setViewportSize(viewport);
  if (!SCREENSHOT_DIR) return;
  await expect(page.locator('.toast')).toHaveCount(0);
  const directory = join(resolve(SCREENSHOT_DIR), testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  const editor = page.locator(
    name.startsWith('category')
      ? '[data-test="gestor-categorias-ficha"]'
      : '[data-test="gestor-productos-ficha"]'
  );
  await editor.screenshot({
    path: join(directory, `${name}-${viewport.width}x${viewport.height}.png`),
    animations: 'disabled',
    // Locator captures include fixed mobile navigation in the full component crop;
    // hide only the outer shell so the editor itself remains readable in evidence.
    style: 'header.header, nav.bottom-nav, app-toast { visibility: hidden !important; }'
  });
}

async function waitForSearchQuery(page: Page, value: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(value);
}

async function useMinimumMobileViewport(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name !== 'mobile-chrome') return;
  await page.setViewportSize({ width: 320, height: 568 });
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.visualViewport?.width ?? window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));
  expect(
    geometry.documentWidth,
    'el formulario no debe provocar overflow horizontal en 320×568'
  ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
}

function ownRow(page: Page, name: string) {
  return page.locator('[data-test^="tabla-fila-"]').filter({ hasText: name });
}

function countDeletes(page: Page, resource: 'categories' | 'products'): string[] {
  const deleted: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'DELETE' && url.pathname.startsWith(`/api/pantry/${resource}/`)) {
      deleted.push(url.pathname);
    }
  });
  return deleted;
}

test.describe('CRUD individual de gestores de despensa', () => {
  test('edita y elimina una categoría propia solo tras confirmación', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    const patchRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'PATCH' && url.pathname.startsWith('/api/pantry/categories/')) {
        patchRequests.push(url.pathname);
      }
    });

    await registerWithHousehold(page, '/pantry/categories', 'QA Pantry Category CRUD');
    const originalName = `QA categoría ${Date.now()}`;
    const editedName = `${originalName} editada`;
    const description = `Descripción sintética ${Date.now()}`;

    await page.locator('[data-test="gestor-categorias-nueva"]').click();
    await page.locator('[data-test="gestor-categorias-campo-nombre"] input').fill(originalName);
    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);

    const originalRow = ownRow(page, originalName);
    await expect(originalRow).toHaveCount(1);
    await originalRow.getByRole('button', { name: 'Editar categoría', exact: true }).click();
    await expect(page.locator('[data-test="gestor-categorias-ficha"]')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Nombre', exact: true })).toBeVisible();
    await captureEditor(page, testInfo, 'category-edit');
    await useMinimumMobileViewport(page, testInfo);

    await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill(editedName);
    await page.getByRole('textbox', { name: 'Descripción', exact: true }).fill(description);
    await page.locator('[data-test="gestor-categorias-color-#e05a5a"]').click();
    await page.locator('[data-test="gestor-categorias-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/categories$/);
    expect(patchRequests).toHaveLength(1);

    await page.locator('#gestor-categorias-q').fill(editedName);
    const editedRow = ownRow(page, editedName);
    await expect(editedRow).toHaveCount(1);
    await expect(editedRow.locator('.celda__punto')).toHaveCSS(
      'background-color',
      'rgb(224, 90, 90)'
    );
    await waitForSearchQuery(page, editedName);
    await page.reload();
    await expect(page.locator('#gestor-categorias-q')).toHaveValue(editedName);
    await expect(editedRow).toHaveCount(1);
    await editedRow.getByRole('button', { name: 'Editar categoría', exact: true }).click();
    await expect(page.locator('[data-test="gestor-categorias-campo-nombre"] input')).toHaveValue(
      editedName
    );
    await expect(
      page.locator('[data-test="gestor-categorias-campo-descripcion"] input')
    ).toHaveValue(description);
    await page.locator('[data-test="gestor-categorias-cancelar"]').click();

    const deleted = countDeletes(page, 'categories');
    await editedRow.getByRole('button', { name: 'Eliminar categoría', exact: true }).click();
    const cancelDialog = page.locator('.modal-overlay');
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(deleted, 'cancelar no debe enviar DELETE').toHaveLength(0);
    await expect(editedRow).toHaveCount(1);

    await editedRow.getByRole('button', { name: 'Eliminar categoría', exact: true }).click();
    const confirmDialog = page.locator('.modal-overlay');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(editedRow).toHaveCount(0);
    expect(deleted, 'confirmar debe enviar exactamente un DELETE propio').toHaveLength(1);
    await page.reload();
    await expect(editedRow).toHaveCount(0);
    await expect(pageErrors).toEqual([]);
  });

  test('edita y elimina un producto sin stock solo tras confirmación', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    const patchRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'PATCH' && url.pathname.startsWith('/api/pantry/products/')) {
        patchRequests.push(url.pathname);
      }
    });

    await registerWithHousehold(page, '/pantry/products', 'QA Pantry Product CRUD');
    const originalName = `QA producto ${Date.now()}`;
    const editedName = `${originalName} editado`;
    const alias = `alias QA ${Date.now()}`;

    await page.locator('[data-test="gestor-productos-nueva"]').click();
    await page.locator('[data-test="gestor-productos-campo-nombre"] input').fill(originalName);
    await page.locator('[data-test="gestor-productos-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/products$/);

    await page.locator('#gestor-productos-q').fill(originalName);
    const originalRow = ownRow(page, originalName);
    await expect(originalRow).toHaveCount(1);
    await originalRow.getByRole('button', { name: 'Editar producto', exact: true }).click();
    await expect(page.locator('[data-test="gestor-productos-ficha"]')).toBeVisible();
    await expect(page.getByRole('textbox', { name: /Nombre/ }).first()).toBeVisible();
    await captureEditor(page, testInfo, 'product-edit');
    await useMinimumMobileViewport(page, testInfo);

    await page
      .getByRole('textbox', { name: /Nombre/ })
      .first()
      .fill(editedName);
    const categoryPicker = page.locator('[data-test="gestor-productos-campo-categoria"]');
    await categoryPicker.locator('.picker__trigger').click();
    await page.getByRole('option', { name: 'Verduras', exact: true }).click();
    const unitPicker = page.locator('[data-test="gestor-productos-campo-unidad"]');
    await unitPicker.locator('.picker__trigger').click();
    await page.getByRole('option', { name: /Kilogramos/ }).click();
    await page.locator('#gestor-producto-alias').fill(alias);
    await page.locator('[data-test="gestor-productos-anadir-alias"]').click();
    await page.locator('[data-test="gestor-productos-guardar"]').click();
    await expect(page).toHaveURL(/\/pantry\/products(?:\?|$)/);
    expect(patchRequests).toHaveLength(1);

    await page.locator('#gestor-productos-q').fill(editedName);
    const editedRow = ownRow(page, editedName);
    await expect(editedRow).toBeVisible();
    await expect(editedRow).toContainText(alias);
    await expect(editedRow.locator('.celda--categoria')).toContainText('Verduras');
    await waitForSearchQuery(page, editedName);
    await page.reload();
    await expect(page.locator('#gestor-productos-q')).toHaveValue(editedName);
    await expect(editedRow).toBeVisible();
    await editedRow.getByRole('button', { name: 'Editar producto', exact: true }).click();
    await expect(page.locator('[data-test="gestor-productos-campo-nombre"] input')).toHaveValue(
      editedName
    );
    await expect(page.locator('[data-test="gestor-productos-campo-categoria"]')).toContainText(
      'Verduras'
    );
    await expect(page.locator('[data-test="gestor-productos-campo-unidad"]')).toContainText(
      /Kilogramos/
    );
    await expect(page.locator('.alias app-tag')).toContainText(alias);
    await page.locator('[data-test="gestor-productos-cancelar"]').click();

    // La navegación de vuelta omite el filtro; recuperarlo hace visible el producto propio,
    // que queda fuera de la primera página del catálogo sembrado.
    await page.locator('#gestor-productos-q').fill(editedName);
    await expect(editedRow).toBeVisible();
    const deleted = countDeletes(page, 'products');
    await editedRow.getByRole('button', { name: 'Eliminar producto', exact: true }).click();
    const cancelDialog = page.locator('.modal-overlay');
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(deleted, 'cancelar no debe enviar DELETE').toHaveLength(0);
    await expect(editedRow).toBeVisible();

    await editedRow.getByRole('button', { name: 'Eliminar producto', exact: true }).click();
    const confirmDialog = page.locator('.modal-overlay');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(editedRow).toHaveCount(0);
    expect(deleted, 'confirmar debe enviar exactamente un DELETE propio').toHaveLength(1);
    await page.reload();
    await expect(editedRow).toHaveCount(0);
    await expect(pageErrors).toEqual([]);
  });
});
