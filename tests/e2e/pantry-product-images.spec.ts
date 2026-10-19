import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Page, expect } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAA8CAIAAAB+RarbAAABfElEQVR4nO3aTW7CMBAFYO6UBRKrSixQlSP0Du0FWHIjjoNyiKLu6SKSNbKxY/C8ySR50lvxI82nRyDY3j3ut01lN/sEBBNMMMEEE0zwZmIB/rycQl59luAlgAsqYy3ByHx8H0JSsNkYc4Lt67UDD30nwUPfDX0nweMjawCPkggsqUEbslRwxKgHQ9kocArIgX+/9mNszPrgaOjgkeC/n2OanNw1+Kl29EyCJRtn1gSnWimpBAc2yAwBy2LfA6dVuwPnun1czzI11FzPjsCVWg9mZXD0SW4HR2YX4MKlqwVWNCuDo1lVwLolt4ILv0MgcKNZDZxq27+lESXDwVohmGCCgeCnN8/q4GCeH7y5hgkmmODFg6FmR/fSNiU7+rc0uZSlovUFRpfsbsUDeiU7XdMCmf2uWkZmlYvZ+7r05M5DS7dOweW9pfeK1dWa7h5WUhe2e5hjS3ku6VsQg9mdAEj95ReAprI741Ef6Dx2p3hmp5qC/YTgtYfgtecfDUQWo6W+HLIAAAAASUVORK5CYII=',
  'base64'
);

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token).toBeTruthy();
  return token as string;
}

test.describe('imágenes de producto', () => {
  test('busca candidatos en segundo plano, conserva atribución, selecciona y permite subir una foto propia', async ({ page }, testInfo) => {
    await registerAndGoto(page, '/pantry', 'producto-fotos');
    const token = await tokenOf(page);
    const created = await page.request.post('/api/pantry/ingredients', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        name: 'Tomates fixture de prueba',
        category: 'vegetables',
        quantity: 2,
        unit: 'unit',
        location: 'fridge'
      }
    });
    expect(created.status()).toBe(201);
    const { data } = await created.json();

    await page.goto(`/pantry/inventario/${data.id}`);
    const imageSection = page.locator('[data-test="item-imagen"]');
    await expect(imageSection.locator('.item__imagen-candidato')).toHaveCount(10, { timeout: 15_000 });
    await expect(imageSection.getByText('HogarIA test fixture').first()).toBeVisible();
    await expect
      .poll(() => imageSection.locator('.item__imagen-candidato img').first().evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(80);
    const actionGeometry = await imageSection.locator('app-button > button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return {
          height: rect.height,
          padding: style.padding,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          borderRadius: style.borderRadius,
          whiteSpace: style.whiteSpace
        };
      })
    );
    expect(actionGeometry.length).toBe(12);
    expect(new Set(actionGeometry.map((geometry) => JSON.stringify(geometry))).size).toBe(1);
    expect(actionGeometry[0]).toMatchObject({ height: 44, whiteSpace: 'nowrap' });

    const screenshotDirectory = resolve('.e2e-screenshots/2026-10-06-pantry-image-editor-refactor');
    mkdirSync(screenshotDirectory, { recursive: true });
    await imageSection.evaluate((section) => {
      const topOffset = window.innerWidth < 768 ? 72 : 0;
      window.scrollTo(0, Math.max(0, window.scrollY + section.getBoundingClientRect().top - topOffset));
    });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}.png`),
      animations: 'disabled',
      fullPage: false
    });

    const chooseImage = imageSection.getByRole('button', { name: 'Usar imagen' }).first();
    await chooseImage.focus();
    await expect(chooseImage).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(imageSection.locator('.item__imagen-actual')).toHaveAttribute(
      'src',
      /\/api\/recipe-images\/[a-f0-9]{24}$/
    );
    await page.reload();
    await expect(page.locator('[data-test="item-imagen"] .item__imagen-actual')).toHaveAttribute(
      'src',
      /\/api\/recipe-images\/[a-f0-9]{24}$/
    );

    await page.locator('input.item__imagen-archivo').setInputFiles({
      name: 'fixture.png',
      mimeType: 'image/png',
      buffer: ONE_PIXEL_PNG
    });
    await expect(page.locator('[data-test="item-imagen"] .item__imagen-actual')).toHaveAttribute(
      'src',
      /\/api\/uploads\/product-images\//
    );

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 393, height: 851 },
      { width: 568, height: 320 },
      { width: 1440, height: 900 }
    ]) {
      await page.setViewportSize(viewport);
      const layout = await imageSection.evaluate((section) => ({
        pageWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        sectionWidth: section.getBoundingClientRect().width,
        buttons: Array.from(section.querySelectorAll('app-button > button')).map((button) => {
          const style = getComputedStyle(button);
          return {
            height: button.getBoundingClientRect().height,
            padding: style.padding,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            borderRadius: style.borderRadius,
            whiteSpace: style.whiteSpace
          };
        })
      }));
      expect(layout.pageScrollWidth).toBeLessThanOrEqual(layout.pageWidth);
      expect(layout.sectionWidth).toBeLessThanOrEqual(layout.pageWidth);
      expect(new Set(layout.buttons.map((geometry) => JSON.stringify(geometry))).size).toBe(1);
      expect(layout.buttons[0]?.height).toBe(44);
    }
  });
});
