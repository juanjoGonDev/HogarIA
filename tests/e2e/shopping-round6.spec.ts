import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Locator, Page, expect } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { shoppingNewListAction } from './helpers/shopping-ui';

/**
 * Ronda 6 (HOGARIA-SPEC §8f): la bandeja como tabla con filtros, controles de solo icono,
 * cancelar en la edicion del titulo, ofertas, descuento, entrada por foto y el calendario
 * de la casa con capas.
 *
 * A proposito sin proveedor de IA: lo que se prueba de la foto es que la pantalla **no
 * escribe nada** cuando el modelo no esta configurado y que dice donde se configura. eso es
 * lo que la hace segura; si algun dia este test necesita un modelo, esta en el sitio equivocado.
 */

function watchPageErrors(page: Page): () => string {
  const errors: string[] = [];
  page.on('pageerror', (event) => errors.push(String(event.stack || event.message)));
  return () => (errors.length > 0 ? errors.join(' | ') : 'sin errores de pagina');
}

async function newList(page: Page, name: string, store?: string): Promise<void> {
  await shoppingNewListAction(page).click();
  await page.locator('[data-test="list-name"]').fill(name);
  if (store) await page.locator('input[name="listStore"]').fill(store);
  await page.locator('[data-test="create-submit"]').click();
  await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
  await page.locator('[data-test="back"]').click();
  await expect(page.locator('[data-test="list-row"]').first()).toBeVisible();
}

function rowOf(page: Page, name: string): Locator {
  return page.locator('[data-test="list-row"]', { hasText: name });
}

test.describe('Bandeja: tabla, filtros y paginación', () => {
  test('la bandeja ordena columnas en escritorio y se adapta a tarjetas móviles', async ({
    page
  }) => {
    const mobile = (page.viewportSize()?.width ?? 1024) <= 720;
    const echo = watchPageErrors(page);
    await registerAndGoto(page, '/shopping', 'r6-table');
    await newList(page, 'Cesta pequena', 'Ahorro');
    await newList(page, 'Cesta grande', 'Mercadona');

    if (mobile) {
      await expect(page.locator('.tray__row--head')).toBeHidden();
      await expect(rowOf(page, 'Cesta pequena').locator('.tray__cell--name')).toContainText(
        'Cesta pequena'
      );
      await expect(rowOf(page, 'Cesta pequena').locator('.tray__cell--store')).toContainText(
        'Ahorro'
      );
      await expect(rowOf(page, 'Cesta pequena').locator('.tray__cell--actions')).toBeVisible();
      expect(echo()).toBe('sin errores de pagina');
      return;
    }

    await expect(page.getByRole('columnheader', { name: 'Lista' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Total' })).toBeVisible();
    expect(echo()).toBe('sin errores de pagina');

    await page.getByRole('columnheader', { name: 'Total' }).click();
    await expect(page.getByRole('columnheader', { name: 'Total' })).toHaveAttribute(
      'aria-sort',
      'descending'
    );
    // Ordenar vive en la URL: la pantalla ordenada es un enlace que se puede mandar.
    await expect(page).toHaveURL(/sort=total/);
  });

  test('buscar filtra por producto y el contador de filtros dice cuanto hay puesto', async ({
    page
  }) => {
    await registerAndGoto(page, '/shopping', 'r6-search');
    await newList(page, 'Frutas', 'Ahorro');
    // `newList` vuelve a la bandeja tras comprobar que la fila existe.
    await rowOf(page, 'Frutas').getByRole('link').click();
    await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
    await page.locator('[data-test="add-input"]').fill('Manzanas');
    await page.locator('[data-test="add-submit"]').click();
    await page.locator('[data-test="back"]').click();
    await newList(page, 'Otros', 'Mercadona');

    await page.locator('.tray__filter-toggle').click();
    await page.locator('[data-test="tray-search"]').fill('Manzanas');
    await expect(page.locator('[data-test="list-row"]')).toHaveCount(1);
    await expect(rowOf(page, 'Frutas')).toBeVisible();
    await expect(page.locator('.tray__filter-count')).toHaveText('1');

    await page.locator('[data-test="tray-search"]').fill('nada que ver');
    await expect(page.locator('[data-test="list-row"]')).toHaveCount(0);
    await expect(page.getByText(/Ninguna lista encaja con los filtros/i)).toBeVisible();

    await page.getByRole('button', { name: /Quitar los 1 filtros/i }).click();
    await expect(page.locator('[data-test="list-row"]')).toHaveCount(2);
  });

  test('la paginacion corta y el tamano de pagina se elige', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'r6-pager');
    await newList(page, 'Una');
    await newList(page, 'Dos');
    await expect(page.locator('.tray__pager-text')).toContainText('1-2 de 2');
    await expect(page.getByRole('button', { name: 'Pagina siguiente' })).toBeDisabled();

    await page.locator('.tray__pager app-picker button').first().click();
    await page.getByRole('option', { name: '10 por pagina' }).click();
    await expect(page).toHaveURL(/size=10/);
    await expect(page.locator('[data-test="list-row"]')).toHaveCount(2);
  });

  test('renombrar se puede cancelar y no se queda el input abierto', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'r6-rename');
    await newList(page, 'Nombre original');

    const row = rowOf(page, 'Nombre original');
    await row.getByRole('button', { name: 'Renombrar' }).click();
    const input = page.locator('[data-test="rename-input"]');
    await expect(input).toBeVisible();
    await input.fill('Nombre torcido');
    await input.press('Escape');

    await expect(input).toHaveCount(0);
    await expect(rowOf(page, 'Nombre original')).toBeVisible();
  });
});

test.describe('Cesta: iconos, oferta y descuento', () => {
  test('marcar es un icono, y seleccionar todo tambien', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'r6-icons');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Cesta');
    await page.locator('[data-test="create-submit"]').click();
    await page.locator('[data-test="add-input"]').fill('LecHE');
    await page.locator('[data-test="add-submit"]').click();

    const row = page.locator('[data-test="item-row"]').first();
    await expect(row.locator('[data-test="check"] svg')).toBeVisible();
    await row.locator('[data-test="check"]').click();
    await expect(page.locator('[data-test="tab-cart"]')).toContainText('En el carro (1)');

    // Marcar mueve la línea fuera de «Pendientes»; seleccionar todo opera sobre la pestaña visible.
    await page.locator('[data-test="tab-cart"]').click();
    await page.locator('[data-test="select-all"]').click();
    await expect(page.locator('[data-test="selection-toolbar"]')).toBeVisible();
  });

  test('las sugerencias no tapan el boton Añadir en movil', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'mobile-chrome') test.skip();
    const pageErrors = watchPageErrors(page);
    const viewports = [
      { width: 393, height: 851 },
      { width: 320, height: 568 }
    ];
    await page.setViewportSize(viewports[0]);
    await registerAndGoto(page, '/shopping', 'r6-add-suggestions');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Sugerencias');
    await page.locator('[data-test="create-submit"]').click();

    const input = page.locator('[data-test="add-input"]');
    const addButton = page.locator('[data-test="add-submit"] button');
    for (const [index, viewport] of viewports.entries()) {
      if (index > 0) await page.setViewportSize(viewport);
      await input.fill('2 LecHE');
      const suggestions = page.locator('[data-test="add-sugerencias"]');
      await expect(suggestions).toBeVisible();
      const layout = await page.evaluate(() => {
        const visual = visualViewport?.width ?? innerWidth;
        const form = document.querySelector<HTMLFormElement>('.detail__add');
        if (!form) return null;
        const rect = form.getBoundingClientRect();
        return {
          visual,
          rootScrollWidth: document.documentElement.scrollWidth,
          formClientWidth: form.clientWidth,
          formScrollWidth: form.scrollWidth,
          formRight: rect.right
        };
      });
      expect(layout).not.toBeNull();
      expect(layout!.rootScrollWidth).toBeLessThanOrEqual(layout!.visual);
      expect(layout!.formScrollWidth).toBeLessThanOrEqual(layout!.formClientWidth);
      expect(layout!.formRight).toBeLessThanOrEqual(layout!.visual + 1);

      const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
      if (screenshotDirectory) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `shopping-quick-add-mobile-${viewport.width}x${viewport.height}.png`
          )
        });
      }

      const rows = page.locator('[data-test="item-row"]');
      if (index === 0) {
        // La acción táctil real confirma tanto que el objetivo se puede alcanzar como que envía.
        await addButton.tap();
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('LecHE');
      } else {
        // También en el ancho mínimo se debe poder añadir sin que la lista de sugerencias
        // bloquee el CTA; después se prueba elegir una sugerencia y confirmar con teclado.
        await addButton.tap();
        // El mismo producto se fusiona con la línea existente: la cantidad total sube a 4,
        // no se crea una fila duplicada.
        await expect(input).toHaveValue('');
        await expect(addButton).toBeDisabled();
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('4×');

        await input.fill('2 LecHE');
        await expect(suggestions).toBeVisible();
        const suggestion = suggestions.locator('[role="option"] button').first();
        const selectedName = await suggestion.locator('.detail__sug-nombre').innerText();
        await suggestion.tap();
        await expect(input).toHaveValue(`2 ${selectedName}`);
        await expect(suggestions).toHaveCount(0);
        await addButton.tap();
        await expect(rows).toHaveCount(2);
        await expect(rows.filter({ hasText: selectedName })).toHaveCount(1);

        await input.fill('2 LecHE');
        await expect(suggestions).toBeVisible();
        const keyboardSelectedName = await suggestions
          .locator('[role="option"] .detail__sug-nombre')
          .nth(1)
          .innerText();
        await input.press('ArrowDown');
        await input.press('ArrowDown');
        await input.press('Enter');
        await expect(input).toHaveValue(`2 ${keyboardSelectedName}`);
        await expect(suggestions).toHaveCount(0);
        await input.press('Enter');
        await expect(rows).toHaveCount(3);
        await expect(rows.filter({ hasText: keyboardSelectedName })).toHaveCount(1);
      }
    }
    expect(pageErrors()).toBe('sin errores de pagina');
  });

  test('una oferta 3x2 se pinta en la fila y se quita con un toque', async ({ page }, testInfo) => {
    const isMobile = Boolean(testInfo.project.use.isMobile);
    const isWebKitDeviceEmulation = testInfo.project.name === 'mobile-safari';
    const initialViewport = page.viewportSize();
    if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
    await registerAndGoto(page, '/shopping', 'r6-offer');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Ofertas');
    await page.locator('[data-test="create-submit"]').click();
    const addInput = page.locator('[data-test="add-input"]');
    await addInput.fill('3 Yogur');
    await addInput.press('Escape');
    await expect(page.locator('[data-test="add-sugerencias"]')).toHaveCount(0);
    await page.locator('[data-test="add-submit"]').click();

    const offerRow = page.locator('[data-test="item-row"]').first();
    if (isMobile) {
      const addRow = await page.evaluate((useLayoutWidth) => {
        const visual = {
          left: visualViewport?.offsetLeft ?? 0,
          width: useLayoutWidth
            ? document.documentElement.clientWidth
            : (visualViewport?.width ?? innerWidth)
        };
        const form = document.querySelector<HTMLFormElement>('.detail__add');
        if (!form) return null;
        const rect = form.getBoundingClientRect();
        const controls = Array.from(form.children)
          .filter(
            (child): child is HTMLElement =>
              child instanceof HTMLElement && child.matches('button, app-button, app-icon-button')
          )
          .map((control) => {
            const controlRect = control.getBoundingClientRect();
            return { left: controlRect.left, right: controlRect.right };
          });
        return {
          visual,
          rootScrollWidth: document.documentElement.scrollWidth,
          form: {
            left: rect.left,
            right: rect.right,
            clientWidth: form.clientWidth,
            scrollWidth: form.scrollWidth
          },
          controls
        };
      }, isWebKitDeviceEmulation);
      expect(addRow).not.toBeNull();
      expect(addRow!.rootScrollWidth).toBeLessThanOrEqual(addRow!.visual.width);
      expect(addRow!.form.scrollWidth).toBeLessThanOrEqual(addRow!.form.clientWidth);
      expect(addRow!.form.right).toBeLessThanOrEqual(addRow!.visual.left + addRow!.visual.width);
      expect(addRow!.controls).toHaveLength(4);
      expect(
        addRow!.controls.every(
          (control) =>
            control.left >= addRow!.visual.left &&
            control.right <= addRow!.visual.left + addRow!.visual.width
        )
      ).toBe(true);
    }
    await offerRow.getByRole('button', { name: 'Acciones de la linea' }).click();
    const offerSaved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/shopping/lists/') &&
        response.url().includes('/items/') &&
        response.request().method() === 'PATCH' &&
        response.ok()
    );
    await page.locator('[data-test="offer-preset"]', { hasText: '3x2' }).click();
    await offerSaved;
    const offerChip = page.locator('[data-test="offer-chip"]');
    await expect(offerChip).toHaveText('3x2');
    await expect(offerChip).toHaveAccessibleName('3x2');
    await expect(offerChip).toHaveAttribute('title', /Oferta 3x2/);
    const editSheet = page.locator('[data-test="edit-sheet"]');
    const quantityInput = editSheet.locator('input[name="qty"]');
    const priceInput = editSheet.locator('[data-test="price-input"]');
    await expect(quantityInput).toHaveAccessibleName('Cantidad');
    await expect(quantityInput).toHaveAttribute('type', 'number');
    await expect(priceInput).toHaveAccessibleName('Precio por unidad');
    await expect(priceInput).toHaveAttribute('inputmode', 'decimal');
    const doneButton = editSheet.getByRole('button', { name: /Hecho/i });
    if (isMobile) {
      const geometry = await editSheet.evaluate((sheet) => {
        const rect = sheet.getBoundingClientRect();
        const viewport = {
          left: visualViewport?.offsetLeft ?? 0,
          top: visualViewport?.offsetTop ?? 0,
          width: visualViewport?.width ?? innerWidth,
          height: visualViewport?.height ?? innerHeight,
          layoutWidth: innerWidth,
          rootClientWidth: document.documentElement.clientWidth,
          rootScrollWidth: document.documentElement.scrollWidth
        };
        const style = getComputedStyle(sheet);
        return {
          viewport,
          sheet: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: sheet.clientWidth,
            height: sheet.clientHeight,
            scrollHeight: sheet.scrollHeight,
            overflowY: style.overflowY
          }
        };
      });
      expect(geometry.sheet.left).toBeGreaterThanOrEqual(geometry.viewport.left);
      expect(
        geometry.sheet.right,
        `sheet/viewports: ${JSON.stringify(geometry)}`
      ).toBeLessThanOrEqual(
        geometry.viewport.left +
          (testInfo.project.name === 'mobile-safari'
            ? geometry.viewport.rootClientWidth
            : geometry.viewport.width)
      );
      expect(geometry.viewport.rootScrollWidth).toBeLessThanOrEqual(
        geometry.viewport.rootClientWidth
      );
      expect(geometry.sheet.top).toBeGreaterThanOrEqual(geometry.viewport.top);
      expect(geometry.sheet.bottom).toBeLessThanOrEqual(
        geometry.viewport.top + geometry.viewport.height
      );
      expect(geometry.sheet.overflowY).toBe('auto');
    }
    await doneButton.click({ timeout: isMobile ? 6000 : undefined });

    if (isMobile) {
      // 320×568 is the narrow-height edge: the sheet must scroll internally so «Hecho» stays reachable.
      await page.setViewportSize({ width: 320, height: 568 });
      const narrowAddRow = await page.evaluate((useLayoutWidth) => {
        const width = useLayoutWidth
          ? document.documentElement.clientWidth
          : (visualViewport?.width ?? innerWidth);
        const form = document.querySelector<HTMLFormElement>('.detail__add');
        if (!form) return null;
        const rect = form.getBoundingClientRect();
        const controls = Array.from(form.children)
          .filter(
            (child): child is HTMLElement =>
              child instanceof HTMLElement && child.matches('button, app-button, app-icon-button')
          )
          .map((control) => {
            const controlRect = control.getBoundingClientRect();
            return { left: controlRect.left, right: controlRect.right };
          });
        return {
          width,
          rootScrollWidth: document.documentElement.scrollWidth,
          formWidth: form.clientWidth,
          formScrollWidth: form.scrollWidth,
          formRight: rect.right,
          controls
        };
      }, isWebKitDeviceEmulation);
      expect(narrowAddRow).not.toBeNull();
      expect(narrowAddRow!.rootScrollWidth).toBeLessThanOrEqual(narrowAddRow!.width);
      expect(narrowAddRow!.formScrollWidth).toBeLessThanOrEqual(narrowAddRow!.formWidth);
      expect(narrowAddRow!.formRight).toBeLessThanOrEqual(narrowAddRow!.width);
      expect(narrowAddRow!.controls).toHaveLength(4);
      expect(
        narrowAddRow!.controls.every(
          (control) => control.left >= 0 && control.right <= narrowAddRow!.width
        )
      ).toBe(true);
      await offerRow.getByRole('button', { name: 'Acciones de la linea' }).click();
      await expect(editSheet).toHaveCSS('transform', 'none');
      const narrowSheet = await editSheet.evaluate((sheet) => {
        const viewport = {
          width: visualViewport?.width ?? innerWidth,
          height: visualViewport?.height ?? innerHeight,
          left: visualViewport?.offsetLeft ?? 0,
          top: visualViewport?.offsetTop ?? 0,
          rootClientWidth: document.documentElement.clientWidth,
          rootScrollWidth: document.documentElement.scrollWidth
        };
        const rect = sheet.getBoundingClientRect();
        const style = getComputedStyle(sheet);
        return {
          viewport,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: sheet.clientWidth,
          height: sheet.clientHeight,
          scrollHeight: sheet.scrollHeight,
          overflowY: style.overflowY
        };
      });
      await expect(editSheet).toBeVisible();
      await expect(editSheet).toHaveCSS('transform', 'none');
      expect(narrowSheet.right).toBeLessThanOrEqual(
        narrowSheet.viewport.left +
          (testInfo.project.name === 'mobile-safari'
            ? narrowSheet.viewport.rootClientWidth
            : narrowSheet.viewport.width)
      );
      expect(narrowSheet.viewport.rootScrollWidth).toBeLessThanOrEqual(
        narrowSheet.viewport.rootClientWidth
      );
      expect(narrowSheet.top).toBeGreaterThanOrEqual(narrowSheet.viewport.top);
      expect(narrowSheet.bottom).toBeLessThanOrEqual(
        narrowSheet.viewport.top + narrowSheet.viewport.height
      );
      expect(narrowSheet.height).toBeLessThanOrEqual(narrowSheet.viewport.height);
      expect(narrowSheet.scrollHeight).toBeGreaterThan(narrowSheet.height);
      expect(narrowSheet.overflowY).toBe('auto');
      await doneButton.scrollIntoViewIfNeeded();
      const buttonInViewport = await doneButton.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const left = visualViewport?.offsetLeft ?? 0;
        const top = visualViewport?.offsetTop ?? 0;
        return (
          rect.left >= left &&
          rect.right <= left + (visualViewport?.width ?? innerWidth) &&
          rect.top >= top &&
          rect.bottom <= top + (visualViewport?.height ?? innerHeight)
        );
      });
      expect(buttonInViewport).toBe(true);
      const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
      if (screenshotDirectory) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(screenshotDirectory, 'shopping-edit-sheet-320x568-cta.png'),
          animations: 'disabled'
        });
      }
      await doneButton.focus();
      expect(await doneButton.evaluate((button) => button === document.activeElement)).toBe(true);
      await page.keyboard.press('Enter');
      await expect(editSheet).toHaveCount(0);
      if (initialViewport) await page.setViewportSize(initialViewport);

      await offerRow.getByRole('button', { name: 'Acciones de la linea' }).tap();
      await expect(editSheet).toBeVisible();
      await editSheet.locator('[data-test="edit-close"]').tap();
      await expect(editSheet).toHaveCount(0);

      await offerRow.getByRole('button', { name: 'Acciones de la linea' }).tap();
      await expect(editSheet).toBeVisible();
      await page.locator('.detail__sheet-backdrop').tap({ position: { x: 2, y: 2 } });
      await expect(editSheet).toHaveCount(0);
    }

    // La fila recuerda la oferta y el chip la quita con un toque, sin abrir la hoja.
    await expect(offerChip).toHaveText('3x2');
    await expect(offerChip).toHaveAccessibleName('3x2');
    await expect(offerChip).toHaveAttribute('title', /Oferta 3x2/);
    await expect(page.locator('.detail__status')).toHaveText('Guardado');
    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `shopping-offer-${isMobile ? 'mobile' : 'desktop'}.png`)
      });
    }
    await page.reload();
    await expect(page.locator('[data-test="edit-sheet"]')).toHaveCount(0);
    await expect(page.locator('[data-test="offer-chip"]')).toHaveText('3x2');
    await expect(page.locator('[data-test="offer-chip"]')).toHaveAccessibleName('3x2');
    await expect(page.locator('[data-test="offer-chip"]')).toHaveAttribute('title', /Oferta 3x2/);
    await offerChip.click();
    await expect(page.locator('[data-test="offer-chip"]')).toHaveCount(0);
  });

  test('el descuento de la lista se aplica al total y se puede quitar', async ({
    page
  }, testInfo) => {
    const isMobile = Boolean(testInfo.project.use.isMobile);
    const viewports = isMobile
      ? [
          { width: 393, height: 851 },
          { width: 320, height: 568 }
        ]
      : [{ width: 1440, height: 900 }];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await registerAndGoto(page, '/shopping', `r6-discount-${viewport.width}`);
      await shoppingNewListAction(page).click();
      await page.locator('[data-test="list-name"]').fill('Con descuento');
      await page.locator('[data-test="create-submit"]').click();
      await page.locator('[data-test="add-input"]').fill('1 Aceite');
      await page.locator('[data-test="add-submit"]').click();
      await page
        .locator('[data-test="item-row"]')
        .first()
        .getByRole('button', { name: 'Acciones de la linea' })
        .click();
      await page.locator('[data-test="price-input"]').fill('10');
      await page
        .locator('[data-test="edit-sheet"]')
        .getByRole('button', { name: /Hecho/i })
        .click();

      await page.locator('[data-test="discount-open"]').click();
      await page.locator('[data-test="discount-kind"]', { hasText: 'Porcentaje' }).click();
      await page.locator('[data-test="discount-percent"] button').click();
      await page.getByRole('option', { name: '10 %' }).click();
      const picker = page.locator('[data-test="discount-percent"]');
      await expect(picker.locator('.picker__panel')).toHaveCount(0);
      await expect(picker.locator('button')).toHaveAttribute('aria-expanded', 'false');

      const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
      if (screenshotDirectory) {
        mkdirSync(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `shopping-discount-${viewport.width}x${viewport.height}.png`
          )
        });
      }
      await page.locator('[data-test="discount-save"]').click();

      await expect(page.locator('[data-test="total"]')).toHaveText('9,00 €');
      await expect(page.locator('[data-test="discount-open"]')).toContainText('10');

      await page.locator('[data-test="discount-open"]').click();
      await page.locator('[data-test="discount-remove"]').click();
      await expect(page.locator('[data-test="total"]')).toHaveText('10,00 €');
    }
  });

  test('la hoja de foto avisa de que falta la IA y no escribe nada', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'r6-photo');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Con foto');
    await page.locator('[data-test="create-submit"]').click();

    await page.locator('[data-test="photo-open"]').click();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    );
    await page
      .locator('input[name="photoFile"]')
      .setInputFiles({ name: 'ticket.png', mimeType: 'image/png', buffer: png });
    const photoResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/photo/analyze') && response.request().method() === 'POST'
    );
    await page.locator('[data-test="photo-analyze"]').click();

    const photoResponse = await photoResponsePromise;
    const photoBody = (await photoResponse.json()) as {
      message?: string;
      data?: { redirect?: string };
    };
    expect(photoResponse.status(), `photo error code: ${String(photoBody.message)}`).toBe(409);
    expect(photoBody.message).toBe('AI_NOT_CONFIGURED');
    expect(photoBody.data?.redirect).toBe('/ai-config');
    await expect(page.locator('[data-test="photo-error"]')).toContainText(
      /Falta configurar la IA/i
    );
    await expect(page.locator('[data-test="photo-error"] a')).toHaveAttribute('href', '/ai-config');
    await expect(page.locator('[data-test="item-row"]')).toHaveCount(0);
  });
});

test.describe('Calendario de la casa', () => {
  test('las capas filtran lo que se pinta y una suelta vive en la agenda', async ({ page }) => {
    const echo = watchPageErrors(page);
    await registerAndGoto(page, '/calendar', 'r6-calendar');

    // Un unico boton de anadir, en la cabecera: apunta al dia que se esta mirando, que es
    // lo que hacia el de abajo y por eso se fue.
    await page.locator('[data-test="event-add"]').click();
    await page.locator('[data-test="event-title"]').fill('Carpinteria: medir el pasillo');
    await page.locator('[data-test="event-more-options"]').click();
    // El tipo vive dentro de «Más opciones» y usa el picker de la casa, no un select nativo.
    await page.locator('[data-test="event-kind"] button').first().click();
    await page.getByRole('option', { name: 'Casa', exact: true }).click();
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('[data-test="household-event"]')).toContainText('Carpinteria');

    await page.locator('[data-test="layer-home"]').click();
    await expect(page.locator('[data-test="household-event"]')).toHaveCount(0);
    await page.locator('[data-test="layer-home"]').click();
    await expect(page.locator('[data-test="household-event"]')).toHaveCount(1);

    await page.locator('[data-test="layer-meals"]').click();
    await expect(page.locator('[data-test="household-event"]')).toHaveCount(1);
    await page.locator('[data-test="layer-meals"]').click();
    expect(echo()).toBe('sin errores de pagina');
  });

  test('el calendario no dispara peticiones en bucle al cambiar de mes', async ({ page }) => {
    // El bug real: la ventana de sucesos alimentaba el rango visible, el rango volvia a
    // pedir los sucesos y la pantalla hacia decenas de peticiones seguidas hasta el 429.
    await registerAndGoto(page, '/calendar', 'r6-no-storm');
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/calendar\/events\?/.test(request.url())) requests.push(request.url());
    });

    const periodNav = page.locator('.cal-top__nav');
    await periodNav.getByRole('button', { name: 'Periodo siguiente' }).click();
    await periodNav.getByRole('button', { name: 'Periodo anterior' }).click();
    await page.waitForTimeout(500);
    // Uno por ventana cargada (la inicial y los dos saltos). El bucle de antes multiplicaba
    // esto por decenas y el server contestaba 429.
    expect(requests.length, requests.join(' ')).toBeLessThanOrEqual(6);
  });
});

test.describe('Descuento por producto (la etiqueta del supermercado)', () => {
  test('un descuento prometido en un producto solo baja ese producto', async ({ page }) => {
    await registerAndGoto(page, '/shopping', 'r6-discount-product');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill('Jamon y leche');
    await page.locator('[data-test="create-submit"]').click();

    for (const line of ['1 Jamon Serrano', '2 Leche']) {
      await page.locator('[data-test="add-input"]').fill(line);
      await page.locator('[data-test="add-submit"]').click();
    }
    // Precios unitarios: 4,00 € Jamón y 0,50 € Leche (dos unidades = 1,00 €).
    await page
      .locator('[data-test="item-row"]')
      .first()
      .getByRole('button', { name: 'Acciones de la linea' })
      .click();
    await page.locator('[data-test="price-input"]').fill('4');
    await page.locator('[data-test="edit-sheet"]').getByRole('button', { name: /Hecho/i }).click();

    const milkRow = page.locator('[data-test="item-row"]').filter({ hasText: 'Leche' });
    await milkRow.getByRole('button', { name: 'Acciones de la linea' }).click();
    await page.locator('[data-test="price-input"]').fill('0,50');
    const milkPriceSaved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/shopping/lists/') &&
        response.url().includes('/items/') &&
        response.request().method() === 'PATCH' &&
        response.ok()
    );
    await page.locator('[data-test="edit-sheet"]').getByRole('button', { name: /Hecho/i }).click();
    await milkPriceSaved;
    await expect(page.locator('[data-test="total"]')).toHaveText('5,00 €');

    await page.locator('[data-test="discount-open"]').click();
    await page.locator('[data-test="discount-scope"]', { hasText: 'En productos' }).click();
    // Sin diana no se guarda: «-2 €» a secas mentiria el total de la cesta.
    await page.locator('[data-test="discount-amount"]').fill('2');
    await page.locator('[data-test="discount-save"]').click();
    await expect(page.locator('[data-test="discount-sheet"]')).toBeVisible();

    // Se elige la linea de la lista, no un nombre escrito a mano: asi el descuento no
    // depende de que alguien acierte con el acento.
    await page.locator('[data-test="discount-target-jamon-serrano"]').click();
    await page.locator('[data-test="discount-save"]').click();

    await expect(page.locator('[data-test="total"]')).toHaveText('3,00 €');
    await expect(page.locator('[data-test="discount-open"]')).toContainText('Jamon Serrano');

    // Y la X de la hoja cierra sin tocar nada: la prueba de que hay forma de cancelar.
    await page.locator('[data-test="discount-open"]').click();
    await page.locator('[data-test="discount-close"]').click();
    await expect(page.locator('[data-test="discount-sheet"]')).toHaveCount(0);
    await expect(page.locator('[data-test="total"]')).toHaveText('3,00 €');
  });
});

test.describe('Selector de unidad con búsqueda', () => {
  async function checkUnitSearch(
    page: Page,
    viewport: { width: number; height: number }
  ): Promise<void> {
    const pageErrors = watchPageErrors(page);
    await registerAndGoto(page, '/shopping', `r6-unit-picker-${viewport.width}`);
    await newList(page, 'Unidad buscable');
    if (viewport.width <= 600) {
      const shellLayout = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const nav = document.querySelector<HTMLElement>('.bottom-nav');
        const tabs = document.querySelector<HTMLElement>('.tray__tabs');
        return {
          viewportWidth,
          rootScrollWidth: document.documentElement.scrollWidth,
          navRight: nav?.getBoundingClientRect().right ?? null,
          tabs: tabs && {
            left: tabs.getBoundingClientRect().left,
            right: tabs.getBoundingClientRect().right,
            width: tabs.getBoundingClientRect().width,
            clientWidth: tabs.clientWidth,
            scrollWidth: tabs.scrollWidth
          },
          tabTargets: Array.from(
            tabs?.querySelectorAll<HTMLElement>('.tray__tab, .tray__filter-toggle') ?? []
          ).map((item) => {
            const rect = item.getBoundingClientRect();
            return {
              name: item.getAttribute('aria-label') || item.innerText,
              width: rect.width,
              height: rect.height
            };
          }),
          tabChildren: Array.from(tabs?.children ?? []).map((child) => {
            const element = child as HTMLElement;
            const rect = element.getBoundingClientRect();
            return {
              className: element.className,
              text: element.innerText,
              left: rect.left,
              right: rect.right,
              width: rect.width
            };
          }),
          navItems: Array.from(nav?.querySelectorAll<HTMLElement>('.bottom-nav__item') ?? []).map(
            (item) => {
              const rect = item.getBoundingClientRect();
              return {
                label: item.innerText,
                left: rect.left,
                right: rect.right,
                width: rect.width,
                height: rect.height,
                style: {
                  flex: getComputedStyle(item).flex,
                  minWidth: getComputedStyle(item).minWidth,
                  labelWidth: item.querySelector('.bottom-nav__label')?.getBoundingClientRect()
                    .width
                }
              };
            }
          )
        };
      });
      expect(shellLayout.viewportWidth).toBe(viewport.width);
      expect(shellLayout.rootScrollWidth, JSON.stringify(shellLayout)).toBeLessThanOrEqual(
        shellLayout.viewportWidth
      );
      expect(shellLayout.navRight).toBeLessThanOrEqual(shellLayout.viewportWidth);
      expect(
        shellLayout.navItems.every(
          (item) =>
            item.left >= 0 &&
            item.right <= shellLayout.viewportWidth &&
            item.width >= 44 &&
            item.height >= 44
        )
      ).toBe(true);
      expect(shellLayout.tabs?.scrollWidth).toBeLessThanOrEqual(shellLayout.tabs?.clientWidth ?? 0);
      expect(shellLayout.tabTargets.every((item) => item.width >= 44 && item.height >= 44)).toBe(
        true
      );
      await expect(page.locator('.tray__filter-toggle')).toHaveAccessibleName('Filtros');
      await expect(page.locator('.tray__filter-toggle')).toHaveAttribute('aria-expanded', 'false');
    }
    const screenshotDirectory = process.env.E2E_SCREENSHOT_DIR;
    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `shopping-tray-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled'
      });
    }
    await rowOf(page, 'Unidad buscable').getByRole('link').click();
    await page.locator('[data-test="add-input"]').fill('1 Leche');
    await page.locator('[data-test="add-submit"]').click();
    await page
      .locator('[data-test="item-row"]')
      .first()
      .getByRole('button', { name: 'Acciones de la linea' })
      .click();

    const editSheet = page.locator('[data-test="edit-sheet"]');
    const picker = editSheet.locator('[data-test="unit-picker"]');
    const trigger = picker.locator('.picker__trigger');
    await trigger.click();
    const search = page.getByPlaceholder('Buscar unidad o escribir la que quieras');
    await expect(search).toBeFocused();
    await search.fill('250 g');
    await expect(page.getByRole('option', { name: '250 g' })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('option', { name: '250 g' }).click();
    await expect(trigger).toContainText('250 g');
    await expect(picker.locator('.picker__panel')).toHaveCount(0);

    // El selector acepta formatos que no están en el catálogo, incluso con Enter.
    await trigger.click();
    await search.fill('caja familiar');
    await expect(page.getByRole('option', { name: 'caja familiar' })).toBeVisible();
    await expect(picker.locator('.picker__option:not(.picker__option--custom)')).toHaveCount(0);
    await search.press('Enter');
    await expect(trigger).toContainText('caja familiar');
    await expect(trigger).toHaveAccessibleName(/Unidad o formato.*caja familiar/);
    await expect(picker.locator('.picker__panel')).toHaveCount(0);

    // Escape cancela la consulta siguiente sin cambiar el valor ya guardado.
    await trigger.click();
    await search.fill('sin coincidencias');
    await search.press('Escape');
    await expect(picker.locator('.picker__panel')).toHaveCount(0);
    await expect(trigger).toContainText('caja familiar');

    // El teclado opera sobre las filas filtradas: una coincidencia parcial requiere ArrowDown
    // para elegir la opción y un label exacto debe ganar frente a un substring anterior.
    await trigger.click();
    await search.fill('250');
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(picker.locator('.picker__value')).toHaveText('250 g');

    await trigger.click();
    await search.fill('g');
    await search.press('Enter');
    await expect(picker.locator('.picker__value')).toHaveText('g');

    // Dejar el formato libre como valor final para verificar su persistencia, no solo el texto UI.
    await trigger.click();
    await search.fill('caja familiar');
    await search.press('Enter');
    await expect(picker.locator('.picker__value')).toHaveText('caja familiar');

    if (screenshotDirectory) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(
          screenshotDirectory,
          `shopping-unit-search-${viewport.width}x${viewport.height}.png`
        ),
        animations: 'disabled'
      });
    }

    const unitSaved = page.waitForResponse(
      (response) =>
        response.url().includes('/api/shopping/lists/') &&
        response.url().includes('/items/') &&
        response.request().method() === 'PATCH' &&
        response.ok()
    );
    await page.locator('[data-test="edit-sheet"]').getByRole('button', { name: /Hecho/i }).click();
    await unitSaved;
    await page.reload();
    await page
      .locator('[data-test="item-row"]')
      .first()
      .getByRole('button', { name: 'Acciones de la linea' })
      .click();
    await expect(page.locator('[data-test="unit-picker"] .picker__trigger')).toContainText(
      'caja familiar'
    );
    expect(pageErrors()).toBe('sin errores de pagina');
  }

  test.describe('1440×900', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    test('búsqueda y persistencia en escritorio', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'mobile-chrome');
      await checkUnitSearch(page, { width: 1440, height: 900 });
    });
  });

  test.describe('393×851', () => {
    test.use({ viewport: { width: 393, height: 851 } });
    test('búsqueda y persistencia en móvil', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-chrome');
      await checkUnitSearch(page, { width: 393, height: 851 });
    });
  });

  test.describe('320×568', () => {
    test.use({ viewport: { width: 320, height: 568 } });
    test('búsqueda y persistencia en móvil estrecho', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-chrome');
      await checkUnitSearch(page, { width: 320, height: 568 });
    });
  });
});
