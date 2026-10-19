import { Browser, BrowserContext, devices, Page, expect } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

async function enterPantry(page: Page, suffix: string): Promise<void> {
  await registerAndGoto(page, '/pantry', `pantry-header-${suffix}`);
  await expect(page.locator('.pantry__header')).toBeVisible();
}

async function pageAtMobileViewport(
  browser: Browser,
  origin: string,
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>,
  viewport: { width: number; height: number }
): Promise<{ context: Awaited<ReturnType<Browser['newContext']>>; page: Page }> {
  const context = await browser.newContext({
    ...devices['Pixel 5'],
    storageState,
    viewport,
    screen: viewport,
    locale: 'es-ES'
  });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/pantry`);
    await expect(page.locator('.pantry__header')).toBeVisible();
    await waitForStableView(page);
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

test('las tres acciones del encabezado de inventario caben y reciben el toque', async ({
  page,
  browser
}, testInfo) => {
  await enterPantry(page, 'geometry');
  const storageState = await page.context().storageState();
  const origin = new URL(page.url()).origin;

  const viewports = testInfo.project.use.isMobile
    ? [
        { width: 320, height: 568 },
        { width: 393, height: 851 },
        { width: 479, height: 851 },
        { width: 480, height: 851 },
        { width: 481, height: 851 },
        { width: 599, height: 851 },
        { width: 600, height: 851 },
        { width: 601, height: 851 },
        { width: 767, height: 851 },
        { width: 768, height: 851 },
        { width: 769, height: 851 },
        { width: 1022, height: 800 },
        { width: 1023, height: 800 },
        { width: 1024, height: 800 },
        { width: 568, height: 320 },
        { width: 844, height: 390 }
      ]
    : [
        { width: 1440, height: 900 },
        { width: 1022, height: 800 },
        { width: 1023, height: 800 },
        { width: 1024, height: 800 }
      ];

  for (const viewport of viewports) {
    const mobilePage = testInfo.project.use.isMobile
      ? await pageAtMobileViewport(browser, origin, storageState, viewport)
      : null;
    const targetPage = mobilePage?.page ?? page;
    try {
      if (!mobilePage) await targetPage.setViewportSize(viewport);
      await waitForStableView(targetPage);
      await targetPage.evaluate(() => window.scrollTo(0, 0));
      if (
        SCREENSHOT_DIR &&
        ((testInfo.project.use.isMobile && [320, 393].includes(viewport.width)) ||
          (!testInfo.project.use.isMobile && viewport.width === 1440))
      ) {
        const { mkdirSync } = await import('node:fs');
        const { join } = await import('node:path');
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        await targetPage.screenshot({
          path: join(SCREENSHOT_DIR, `pantry-header-${viewport.width}x${viewport.height}.png`)
        });
      }
      const actionButtons = [
        targetPage.locator('[data-test="pantry-caducidades"] button'),
        targetPage.locator('[data-test="pantry-anadir-catalogo"] button'),
        targetPage.getByRole('button', { name: '+ Agregar', exact: true })
      ];
      for (const button of actionButtons) await expect(button).toBeVisible();

      const layout = await targetPage.evaluate(() => {
        const headerButtons = document.querySelectorAll<HTMLButtonElement>(
          '.pantry__header-acciones button'
        );
        const controls = [
          document.querySelector<HTMLElement>('[data-test="pantry-caducidades"] button'),
          document.querySelector<HTMLElement>('[data-test="pantry-anadir-catalogo"] button'),
          headerButtons.item(headerButtons.length - 1)
        ];
        const title = document
          .querySelector<HTMLElement>('.pantry__title')
          ?.getBoundingClientRect();
        const actions = controls.map((button) => {
          if (!button) return null;
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            centerReceivesPointer: hit === button || button.contains(hit),
            pointerReceiver: hit
              ? {
                  tagName: hit.tagName,
                  className: (hit as HTMLElement).className,
                  testId: hit.closest<HTMLElement>('[data-test]')?.dataset['test'],
                  ariaLabel: hit.getAttribute('aria-label'),
                  text: hit.textContent?.trim().slice(0, 40)
                }
              : null
          };
        });
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          visualViewport: window.visualViewport
            ? {
                left: window.visualViewport.offsetLeft,
                top: window.visualViewport.offsetTop,
                width: window.visualViewport.width,
                height: window.visualViewport.height,
                scale: window.visualViewport.scale
              }
            : null,
          documentWidth: document.documentElement.scrollWidth,
          title: title
            ? { left: title.left, right: title.right, top: title.top, bottom: title.bottom }
            : null,
          actions
        };
      });
      const visualViewport = layout.visualViewport ?? {
        left: 0,
        top: 0,
        width: layout.viewportWidth,
        height: layout.viewportHeight,
        scale: 1
      };
      expect
        .soft(
          visualViewport.width,
          `el viewport visual conserva el ancho pedido (${viewport.width}px)`
        )
        .toBe(viewport.width);
      expect
        .soft(
          layout.documentWidth,
          `el documento no debe desbordar a ${viewport.width}x${viewport.height}`
        )
        .toBeLessThanOrEqual(visualViewport.left + visualViewport.width);
      expect.soft(layout.actions).toHaveLength(3);
      for (const [index, action] of layout.actions.entries()) {
        expect.soft(action, `acción ${index} presente a ${viewport.width}px`).not.toBeNull();
        expect
          .soft(action!.left, `acción ${index} no sale por la izquierda`)
          .toBeGreaterThanOrEqual(visualViewport.left);
        expect
          .soft(action!.right, `acción ${index} no sale por la derecha`)
          .toBeLessThanOrEqual(visualViewport.left + visualViewport.width);
        expect
          .soft(action!.top, `acción ${index} no queda tapada por encima`)
          .toBeGreaterThanOrEqual(visualViewport.top);
        expect
          .soft(action!.bottom, `acción ${index} cabe en el viewport`)
          .toBeLessThanOrEqual(visualViewport.top + visualViewport.height);
        expect
          .soft(action!.width, `acción ${index} tiene hit target ancho`)
          .toBeGreaterThanOrEqual(44);
        expect
          .soft(action!.height, `acción ${index} tiene hit target alto`)
          .toBeGreaterThanOrEqual(44);
        expect.soft(action!.centerReceivesPointer, `acción ${index} recibe el puntero`).toBe(true);
        if (layout.title) {
          const overlapsTitle =
            action!.left < layout.title.right &&
            action!.right > layout.title.left &&
            action!.top < layout.title.bottom &&
            action!.bottom > layout.title.top;
          expect.soft(overlapsTitle, `acción ${index} no solapa el título`).toBe(false);
        }
      }
      for (let index = 0; index < layout.actions.length; index++) {
        for (let other = index + 1; other < layout.actions.length; other++) {
          const current = layout.actions[index]!;
          const next = layout.actions[other]!;
          const overlaps =
            current.left < next.right &&
            current.right > next.left &&
            current.top < next.bottom &&
            current.bottom > next.top;
          expect.soft(overlaps, `acciones ${index}/${other} no se solapan`).toBe(false);
        }
      }
    } finally {
      await mobilePage?.context.close();
    }
  }
});

test('las acciones conservan su destino y el alta respeta la pestaña', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await enterPantry(page, 'actions');
  await page.setViewportSize({ width: 393, height: 851 });
  await waitForStableView(page);

  await page.getByRole('button', { name: '+ Agregar', exact: true }).click({ timeout: 5000 });
  const ingredientDialog = page.getByRole('dialog', { name: 'Agregar Ingrediente' });
  await expect(ingredientDialog).toBeVisible();
  await ingredientDialog.locator('.modal__close').click();

  const addIngredient = page.getByRole('button', { name: '+ Agregar', exact: true });
  await addIngredient.focus();
  await page.keyboard.press('Enter');
  await expect(ingredientDialog).toBeVisible();
  await ingredientDialog.locator('.modal__close').click();

  await page.getByRole('button', { name: /Utensilios/ }).click();
  await page
    .getByRole('button', { name: '+ Agregar utensilio', exact: true })
    .click({ timeout: 5000 });
  const utensilDialog = page.getByRole('dialog', { name: 'Agregar Utensilio' });
  await expect(utensilDialog).toBeVisible();
  await utensilDialog.locator('.modal__close').click();

  await page.locator('[data-test="pantry-caducidades"] button').click({ timeout: 5000 });
  await expect(page).toHaveURL(/\/pantry\/caducidades/);
  await page.goto('/pantry');
  await page.locator('[data-test="pantry-anadir-catalogo"] button').click({ timeout: 5000 });
  await expect(page).toHaveURL(/\/pantry\/catalogo/);
  expect(pageErrors, 'las acciones no deben lanzar errores JavaScript').toEqual([]);
});
