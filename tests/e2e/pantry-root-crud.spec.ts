import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerWithHousehold } from './helpers/auth';

const ingredientName = 'Ingrediente CRUD QA';

test('editar y borrar una fila de despensa requiere el control accesible y persiste', async ({
  page
}, testInfo) => {
  const pageErrors: string[] = [];
  const deleteRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'DELETE' && /^\/api\/pantry\/ingredients\/[^/]+$/.test(pathname)) {
      deleteRequests.push(pathname);
    }
  });

  await registerWithHousehold(page, '/pantry', `pantry-root-crud-${testInfo.project.name}`);
  await expect(page.locator('.pantry__header')).toBeVisible();
  await page.getByRole('button', { name: '+ Agregar', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Agregar Ingrediente' });
  await addDialog.locator('input#ingredientName').fill(ingredientName);
  await addDialog.locator('input#quantity').fill('500');
  await addDialog.locator('select[name="unit"]').selectOption('g');
  await addDialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  const addedToast = page.locator('.toast--success').last();
  await expect(addedToast).toBeVisible();
  await addedToast.locator('.toast__close').click();
  await expect(page.locator('.toast--success')).toHaveCount(0);

  const row = page.locator('tr.ingredient-item').filter({ hasText: ingredientName });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Editar Ingrediente' }).click();

  const editDialog = page.getByRole('dialog', { name: 'Editar Ingrediente' });
  await expect(editDialog).toBeVisible();
  const unit = editDialog.getByRole('combobox', { name: 'Unidad', exact: true });
  await expect(unit).toHaveValue('g');
  await editDialog.locator('input#quantity').fill('750');
  await unit.selectOption('ml');

  const viewports =
    testInfo.project.name === 'chromium'
      ? [
          { width: 1023, height: 768 },
          { width: 1024, height: 768 },
          { width: 1440, height: 900 }
        ]
      : [
          { width: 320, height: 568 },
          { width: 393, height: 851 },
          { width: 568, height: 320 },
          { width: 719, height: 851 },
          { width: 720, height: 851 },
          { width: 851, height: 393 }
        ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(editDialog).toBeVisible();
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(
      documentWidth,
      `sin overflow en ${viewport.width}×${viewport.height}`
    ).toBeLessThanOrEqual(viewport.width);
  }
  await page.setViewportSize(
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 }
  );

  const screenshotDirectory = join(
    resolve(process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/qa-pantry-root-crud-1'),
    testInfo.project.name
  );
  mkdirSync(screenshotDirectory, { recursive: true });
  await editDialog.screenshot({
    path: join(screenshotDirectory, 'edit-dialog.png'),
    animations: 'disabled'
  });

  const update = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'PATCH' &&
      new URL(response.url()).pathname.startsWith('/api/pantry/ingredients/')
    );
  });
  await editDialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  expect((await update).ok()).toBe(true);
  await expect(row).toContainText('750 ml');
  await page.reload();
  const persistedRow = page.locator('tr.ingredient-item').filter({ hasText: ingredientName });
  await expect(persistedRow).toContainText('750 ml');

  const deleteButton = persistedRow.getByRole('button', { name: 'Eliminar ingrediente' });
  await deleteButton.click();
  const confirmation = page.locator('.modal-overlay');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(ingredientName);
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(persistedRow).toBeVisible();
  expect(deleteRequests).toEqual([]);

  await deleteButton.click();
  const deletion = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'DELETE' &&
      new URL(response.url()).pathname.startsWith('/api/pantry/ingredients/')
    );
  });
  await page
    .locator('.modal-overlay')
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  expect((await deletion).ok()).toBe(true);
  await expect(persistedRow).toHaveCount(0);
  expect(deleteRequests).toHaveLength(1);

  await page.reload();
  await expect(page.locator('tr.ingredient-item').filter({ hasText: ingredientName })).toHaveCount(
    0
  );
  expect(pageErrors).toEqual([]);
  expect(deleteRequests).toHaveLength(1);
});
