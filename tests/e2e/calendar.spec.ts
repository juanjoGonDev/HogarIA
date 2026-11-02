import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto, skipOnboarding } from './helpers/auth';
import { selectCalendarView } from './helpers/calendar-ui';

/**
 * El calendario se ve en tres formatos (día / semana / mes) y lo que se pinta es
 * lo que hay guardado. Estos tests cubren las dos cosas: la vista y la URL que la
 * describe, y que una comida añadida desde la rejilla aparece en la rejilla
 * (antes la cuadrícula se construía con huecos vacíos y no leía el servicio, así
 * que nunca se veía nada).
 */

const isoOf = (date: Date): string =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;

const daysFromToday = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return isoOf(date);
};

const mondayOfIsoWeek = (iso: string): string => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

/** Añade una comida escrita a mano por el modal, en el hueco que se le diga. */
async function addMealThroughModal(
  page: import('@playwright/test').Page,
  dish: string
): Promise<void> {
  // El hueco de franja ya no existe: se anade desde el «+» de la cabecera del dia, que es lo que
  // queda de las cuatro filas por tipo de comida.
  await page.locator('[data-test="timeline-add-meal"]').first().click();
  await expect(page.locator('.modal__title')).toContainText('Agregar Comida');
  await page.fill('#meal-custom', dish);
  await page.locator('app-modal').getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
}

async function openMealEditorFromTimeline(
  page: import('@playwright/test').Page,
  dish: string
): Promise<import('@playwright/test').Locator> {
  const meal = page.locator('[data-test="timeline-block-meal"]').filter({ hasText: dish });
  await expect(meal).toHaveCount(1);
  await meal.click();

  const editor = page.locator('app-modal:has(#meal-custom)');
  await expect(editor.locator('.modal__title')).toContainText('Editar Comida');
  await expect(editor.locator('#meal-custom')).toHaveValue(dish);
  return editor;
}

test.describe('Calendario', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
  });

  test('arranca en la vista de semana con la URL limpia', async ({ page }) => {
    await expect(page.locator('[data-test="calendar-view-select"]')).toHaveAttribute(
      'data-view',
      'week'
    );
    await expect(page).not.toHaveURL(/view=/);

    // Titulo del periodo: «14 – 20 de septiembre» cuando la semana cabe en un mes,
    // «28 sept – 4 oct» cuando lo cruza (el formato cruzado es del propio `weekRange`,
    // no un capricho del runner: la ultima semana de cada mes lo pinta asi).
    await expect(page.locator('h1.calendar__title')).toContainText(
      /\d{1,2} – \d{1,2} de |\d{1,2} [a-zñ]{3,4}\.? – \d{1,2} [a-zñ]{3,4}/
    );

    // Siete columnas y la escala civil completa; las horas vacías también deben poder abrirse.
    await expect(page.locator('[data-test="timeline-col"]')).toHaveCount(7);
    const hours = await page.locator('.tl__hour').count();
    expect(hours).toBe(24);
    await expect(page.locator('.tl__hour').first()).toHaveText('00:00');
    await expect(page.locator('.tl__hour').last()).toHaveText('23:00');
  });

  test('la semana siguiente empieza a medianoche y permite crear un evento en la última franja', async ({
    page
  }, testInfo) => {
    const targetDate = daysFromToday(7);
    const timeline = page.locator('.tl__scroll');

    await page.locator('input[type="date"]').fill(targetDate);
    await expect(page).toHaveURL(/[?&]date=/);
    await expect(page.locator('[data-test="timeline-col"]')).toHaveCount(7);
    await expect(page.locator('.tl__hour')).toHaveCount(24);
    await expect(page.locator('.tl__hour').first()).toHaveText('00:00');
    await expect(page.locator('.tl__hour').last()).toHaveText('23:00');
    await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(0);

    const scrollMetrics = await timeline.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

    const screenshotDirectory = resolve('.e2e-screenshots/qa-calendar-full-day-1');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-next-week-midnight.png`),
      fullPage: false,
      animations: 'disabled'
    });

    await selectCalendarView(page, 'day', 'Día');
    await expect(page.locator('[data-test="timeline-col"]')).toHaveCount(1);
    await expect(page.locator('.tl__hour')).toHaveCount(24);
    await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(0);
    await selectCalendarView(page, 'week', 'Semana');
    await expect(page.locator('[data-test="timeline-col"]')).toHaveCount(7);
    await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(0);

    await page.locator('[data-test="event-add"]').click();
    await page.locator('#event-title').fill('Cita nocturna sintética');
    await page.locator('#event-date').fill(targetDate);
    await page.locator('#event-start').fill('23:30');
    await page.locator('#event-end').fill('23:59');
    await page.locator('[data-test="event-save"]').click();

    const lateEvent = page.locator('[data-test="timeline-block-event"]').filter({
      hasText: 'Cita nocturna sintética'
    });
    await expect(lateEvent).toHaveCount(1);
    await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(0);

    await timeline.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await lateEvent.scrollIntoViewIfNeeded();
    await expect(lateEvent).toBeInViewport();
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-next-week-last-hours.png`),
      fullPage: false,
      animations: 'disabled'
    });
  });

  test('el conmutador cambia la vista, viaja en la URL y sobrevive a recargar', async ({
    page
  }) => {
    await selectCalendarView(page, 'month', 'Mes');
    await expect(page).toHaveURL(/[?&]view=month/);
    await expect(page.locator('.cal-cell').first()).toBeVisible();
    const cells = await page.locator('.cal-cell').count();
    expect(cells % 7).toBe(0);

    await page.reload();
    await expect(page.locator('[data-test="calendar-view-select"]')).toHaveAttribute(
      'data-view',
      'month'
    );
    await expect(page.locator('.cal-cell')).toHaveCount(cells);

    await selectCalendarView(page, 'day', 'Día');
    await expect(page).toHaveURL(/[?&]view=day/);
    // Dia y semana son la MISMA rejilla con una columna; las cuatro franjas por tipo de comida se
    // fueron con el rediseño. Lo que hay que exigir es que quede una columna de horas.
    await expect(page.locator('[data-test="timeline-col"]')).toHaveCount(1);

    // Semana es la por defecto: vuelve a una URL sin parametro
    await selectCalendarView(page, 'week', 'Semana');
    await expect(page).not.toHaveURL(/view=/);

    await selectCalendarView(page, 'fourDays', '4 días');
    await expect(page).toHaveURL(/[?&]view=fourDays/);
    await expect(page.locator('[data-test="timeline-col"]')).toHaveCount(4);
    await expect(page.locator('.tl__hour')).toHaveCount(24);

    await selectCalendarView(page, 'year', 'Año');
    await expect(page).toHaveURL(/[?&]view=year/);
    await expect(page.locator('.year-month')).toHaveCount(12);

    await selectCalendarView(page, 'agenda', 'Agenda');
    await expect(page).toHaveURL(/[?&]view=agenda/);
    await expect(page.locator('[data-test="calendar-view-select"]')).toHaveAttribute(
      'data-view',
      'agenda'
    );
    await page.reload();
    await expect(page.locator('[data-test="calendar-view-select"]')).toHaveAttribute(
      'data-view',
      'agenda'
    );
    await expect(page.locator('.agenda-list')).toBeVisible();
  });

  test('en el mes, pinchar el numero de un dia abre ese dia', async ({ page }) => {
    await selectCalendarView(page, 'month', 'Mes');
    await expect(page.locator('.cal-cell.is-today')).toHaveCount(1);

    const target = page.locator('.cal-cell:not(.is-outside) .cal-cell__num').nth(1);
    const dayNumber = (await target.innerText()).trim();
    const targetIsToday = await target.evaluate(
      (button) => button.closest('.cal-cell')?.classList.contains('is-today') ?? false
    );
    await target.click();

    await expect(page).toHaveURL(/[?&]view=day/);
    if (targetIsToday) {
      // Today's date is omitted from canonical URLs by writeViewInUrl().
      await expect(page).not.toHaveURL(/[?&]date=/);
    } else {
      await expect(page).toHaveURL(
        new RegExp(`[?&]date=\\d{4}-\\d{2}-${dayNumber.padStart(2, '0')}`)
      );
    }
    await expect(page.locator('h1.calendar__title')).toContainText(dayNumber);
  });

  test('lo que se añade desde un hueco se ve en la rejilla y sigue despues de recargar', async ({
    page
  }) => {
    await addMealThroughModal(page, 'Tortilla de patatas');

    const event = page.locator('.tl__block--meal');
    await expect(event).toHaveCount(1);
    await expect(event).toContainText('Tortilla de patatas');

    await page.reload();
    await expect(page.locator('.tl__block--meal')).toHaveCount(1);
    await expect(page.locator('.tl__block-title')).toContainText('Tortilla de patatas');

    // El resumen del periodo se entera
    await expect(page.locator('.cal-strip__value').first()).toContainText(/1\s*\/\s*28/);
  });

  test('una comida se abre desde su bloque en la propia rejilla', async ({ page }) => {
    await addMealThroughModal(page, 'Pollo con arroz');

    const meal = page.locator('.tl__block--meal');
    await expect(meal).toContainText('Pollo con arroz');
    await meal.click();
    await expect(page.locator('.modal__title')).toContainText('Editar Comida');
    await expect(page.locator('#meal-custom')).toHaveValue('Pollo con arroz');
  });

  test('conserva la comida y permite reintentar si falla el borrado', async ({
    page
  }, testInfo) => {
    const pageErrors: string[] = [];
    const deleteStatuses: number[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.includes('/api/calendar/meals/')
      ) {
        deleteStatuses.push(response.status());
      }
    });

    await addMealThroughModal(page, 'Ensalada completa');
    await expect(page.locator('[data-test="timeline-block-meal"]')).toHaveCount(1);

    const editor = await openMealEditorFromTimeline(page, 'Ensalada completa');
    const deleteButton = editor.getByRole('button', { name: 'Eliminar', exact: true });
    let deleteButtonBounds = await deleteButton.boundingBox();
    if (testInfo.project.name === 'mobile-chrome') {
      await expect
        .poll(async () => (await deleteButton.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(44);
      deleteButtonBounds = await deleteButton.boundingBox();
    }

    // Cancelar debe conservar el editor y no iniciar ninguna petición de escritura.
    await deleteButton.click();
    const confirmation = page.locator('.confirm');
    const confirmationDialog = page.locator('app-confirm-dialog [role="dialog"]');
    await expect(confirmation.locator('.confirm__message')).toContainText(
      'Quitar «Ensalada completa» de la planificación'
    );
    const focusIsInsideConfirmation = await confirmationDialog.evaluate((dialog) =>
      dialog.contains(document.activeElement)
    );
    expect(focusIsInsideConfirmation).toBe(true);
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(editor.locator('.modal-overlay')).toBeVisible();
    expect(deleteStatuses).toEqual([]);

    await deleteButton.click();
    await page.locator('.confirm').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('.confirm')).toHaveCount(0);
    expect(deleteStatuses).toEqual([]);

    let deleteAttempts = 0;
    await page.route('**/api/calendar/meals/*', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }

      deleteAttempts++;
      if (deleteAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Synthetic temporary outage' })
        });
        return;
      }

      await route.continue();
    });

    await deleteButton.click();
    const failedConfirmation = page.locator('.confirm');
    await failedConfirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();

    const deletionError = editor.getByRole('alert');
    await expect(deletionError).toHaveCount(1);
    await expect(deletionError).toHaveAttribute('aria-live', 'assertive');
    await expect(deletionError).toContainText('Error');
    await expect(deletionError).toContainText('No se pudo quitar la comida. Vuelve a intentarlo.');
    await expect(deletionError).toBeFocused();
    await expect(page.locator('.toast--error')).toHaveCount(0);
    await expect(page.locator('.toast--success')).toHaveCount(0);
    await expect(page.locator('.confirm')).toHaveCount(0);
    await expect(editor.locator('.modal-overlay')).toBeVisible();
    await expect(page.locator('[data-test="timeline-block-meal"]')).toContainText(
      'Ensalada completa'
    );
    expect(deleteStatuses).toEqual([503]);

    const screenshotDirectory = resolve(
      process.cwd(),
      '.e2e-screenshots',
      'qa-calendar-delete-failure'
    );
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}.png`)
    });

    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    if (testInfo.project.name === 'mobile-chrome') {
      expect(mobileOverflow).toBe(false);

      const pixelViewport = page.viewportSize();
      expect(pixelViewport).not.toBeNull();
      await page.setViewportSize({ width: 320, height: 568 });
      const narrowOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(narrowOverflow).toBe(false);
      const alertHeaderGeometry = await deletionError.evaluate((alert) => {
        const dialog = alert.closest('[role="dialog"]');
        const header = dialog?.querySelector('.modal__header');
        if (!dialog || !header) return null;
        const alertBounds = alert.getBoundingClientRect();
        const headerBounds = header.getBoundingClientRect();
        return {
          alertTop: alertBounds.top,
          alertBottom: alertBounds.bottom,
          headerTop: headerBounds.top,
          headerBottom: headerBounds.bottom,
          overlaps: alertBounds.top < headerBounds.bottom && alertBounds.bottom > headerBounds.top
        };
      });
      expect(alertHeaderGeometry?.overlaps, JSON.stringify(alertHeaderGeometry)).toBe(false);
      await editor.locator('.modal__close').focus();
      await page.evaluate(() => document.scrollingElement?.scrollTo(0, 0));
      await page.screenshot({
        path: resolve(screenshotDirectory, 'mobile-chrome-320x568-top.png')
      });
      const documentScrollBeforeWheel = await page.evaluate(
        () => document.scrollingElement?.scrollTop ?? 0
      );
      expect(documentScrollBeforeWheel).toBe(0);

      const modalBody = editor.locator('.modal__body');
      const initialModalScroll = await modalBody.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      }));
      if (initialModalScroll.scrollHeight > initialModalScroll.clientHeight) {
        const bodyBounds = await modalBody.boundingBox();
        expect(bodyBounds).not.toBeNull();
        if (bodyBounds) {
          const touchX = bodyBounds.x + bodyBounds.width / 2;
          const touchStartY = bodyBounds.y + bodyBounds.height * 0.75;
          const touchEndY = bodyBounds.y + bodyBounds.height * 0.25;
          const cdp = await page.context().newCDPSession(page);
          try {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [{ x: touchX, y: touchStartY }]
            });
            for (let step = 1; step <= 4; step++) {
              await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [
                  {
                    x: touchX,
                    y: touchStartY + ((touchEndY - touchStartY) * step) / 4
                  }
                ]
              });
            }
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchEnd',
              touchPoints: []
            });
          } finally {
            await cdp.detach();
          }
        }
      }
      const narrowDeleteButtonBounds = await deleteButton.boundingBox();
      const modalScroll = await modalBody.evaluate((element) => ({
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      }));
      const documentScrollTop = await page.evaluate(
        () => document.scrollingElement?.scrollTop ?? 0
      );
      expect(narrowDeleteButtonBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(documentScrollTop).toBe(documentScrollBeforeWheel);
      if (modalScroll.scrollHeight > modalScroll.clientHeight) {
        expect(modalScroll.scrollTop).toBeGreaterThan(0);
      }
      const clippedMealActions = await editor.locator('.meal-form__actions').evaluate((actions) => {
        const dialog = actions.closest('[role="dialog"]');
        if (!dialog) return ['missing dialog'];
        const dialogBounds = dialog.getBoundingClientRect();

        return Array.from(actions.querySelectorAll('button'))
          .filter((button) => {
            const bounds = button.getBoundingClientRect();
            return bounds.left < dialogBounds.left || bounds.right > dialogBounds.right;
          })
          .map((button) => button.innerText.trim());
      });
      expect(clippedMealActions).toEqual([]);
      await page.screenshot({
        path: resolve(screenshotDirectory, 'mobile-chrome-320x568-actions.png')
      });
      if (pixelViewport) await page.setViewportSize(pixelViewport);
    }

    await deleteButton.click();
    const retryConfirmation = page.locator('.confirm');
    await retryConfirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(page.locator('.toast--success')).toBeVisible();
    await expect(editor.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('[data-test="timeline-block-meal"]')).toHaveCount(0);
    expect(deleteStatuses).toEqual([503, 200]);

    await page.reload();
    await expect(page.locator('[data-test="timeline-block-meal"]')).toHaveCount(0);
    if (testInfo.project.name === 'mobile-chrome') {
      expect(deleteButtonBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(pageErrors).toEqual([]);
  });

  test('la navegacion cambia de semana y «Hoy» vuelve a la actual', async ({ page }) => {
    const title = page.locator('h1.calendar__title');
    const currentLabel = (await title.innerText()).trim();

    await page.locator('.cal-top__nav .cal-icon-btn').last().click();
    await expect(title).not.toHaveText(currentLabel);
    await expect(page).toHaveURL(new RegExp(`[?&]date=${daysFromToday(7)}`));

    await page.locator('.cal-top__nav .cal-icon-btn').first().click();
    await expect(title).toHaveText(currentLabel);
    await expect(page).not.toHaveURL(/date=/);

    await page.locator('.cal-top__nav .cal-icon-btn').last().click();
    await page.locator('.cal-top__nav .cal-pill').click();
    await expect(title).toHaveText(currentLabel);
  });

  test('el teclado mueve el calendario (flechas, T y D/S/M)', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(new RegExp(`[?&]date=${daysFromToday(7)}`));

    await page.keyboard.press('m');
    await expect(page.locator('[data-test="calendar-view-select"]')).toHaveAttribute(
      'data-view',
      'month'
    );

    await page.keyboard.press('t');
    await expect(page).not.toHaveURL(/date=/);
    await expect(page).toHaveURL(/view=month/);

    // De vuelta a la semana: las flechas mueven de 7 en 7 dias
    await page.keyboard.press('s');
    await expect(page).not.toHaveURL(/view=/);
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(new RegExp(`[?&]date=${daysFromToday(-7)}`));
  });

  test('el selector de fecha salta a cualquier mes', async ({ page }) => {
    await page.locator('.cal-jump input').fill('2026-12-24');
    await expect(page).toHaveURL(/[?&]date=2026-12-24/);
    // La semana que contiene el 24 de diciembre
    await expect(page.locator('h1.calendar__title')).toContainText('diciembre');

    await selectCalendarView(page, 'month', 'Mes');
    await expect(page.locator('h1.calendar__title')).toContainText('diciembre de 2026');
  });

  test('el plan de la IA anuncia la semana que va a cubrir', async ({ page }) => {
    await page.getByRole('button', { name: /Planificar IA/ }).click();

    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal__title')).toContainText('Planificar con IA');
    await expect(modal).toContainText('La IA prepara la');
    await expect(modal).toContainText('Rellena los huecos');
    await expect(modal.locator('[data-test^="generate-goal-"]')).toHaveCount(7);
    const weightLoss = modal.locator('[data-test="generate-goal-weight-loss"]');
    const muscleGain = modal.locator('[data-test="generate-goal-muscle-gain"]');
    const customGoal = modal.locator('[data-test="generate-goal-custom"]');
    await weightLoss.click();
    await muscleGain.click();
    await customGoal.click();
    await expect(weightLoss).toHaveAttribute('aria-pressed', 'true');
    await expect(muscleGain).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.locator('#gen-custom')).toBeVisible();
    await modal.locator('#gen-custom').fill('Más proteína, verduras y cenas variadas.');

    await modal.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });

  test('los objetivos se guardan sobre la semana que se esta viendo', async ({
    page
  }, testInfo) => {
    await page.getByRole('button', { name: /Objetivo/ }).click();
    const modal = page.locator('.modal-overlay');
    await expect(modal.locator('.modal__title')).toContainText('Objetivos Nutricionales');

    await modal.locator('.goal-option', { hasText: 'Variada' }).click();
    await modal.locator('.goal-option', { hasText: 'Ganar músculo' }).click();
    await modal.locator('.goal-option', { hasText: 'Personalizada' }).click();
    await modal.locator('#goals-custom').fill('Cena ligera y rica en proteína.');
    await modal.locator('#goals-calories').fill('2100');
    await modal.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    // La pastilla mantiene su geometría; el detalle completo queda disponible
    // para lector de pantalla y tooltip, sin hacer crecer el control.
    const objectiveButton = page.getByRole('button', {
      name: 'Objetivo: Comida variada · Ganar músculo · Personalizado'
    });
    await expect(objectiveButton).toContainText('Objetivo');
    await expect(objectiveButton.locator('.cal-goal-count')).toHaveText('3');
    await expect(objectiveButton).toHaveAttribute(
      'title',
      'Objetivo: Comida variada · Ganar músculo · Personalizado'
    );
    const controlHeights = await page
      .locator('.cal-top .cal-pill, .cal-top .cal-btn')
      .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
    expect(controlHeights.length).toBeGreaterThan(1);
    expect(new Set(controlHeights)).toEqual(new Set([44]));
    const objectiveWidth = await objectiveButton.evaluate(
      (control) => control.getBoundingClientRect().width
    );
    expect(objectiveWidth).toBeLessThanOrEqual(160);
    // ...y la vista de dia usa las calorias nuevas como denominador
    await selectCalendarView(page, 'day', 'Día');
    // El separador de miles lo decide el ICU del navegador: en un Chromium con
    // datos completos es «2.100» y con los recortados, «2100». Se admite cualquiera.
    await expect(page.locator('[data-test="timeline-kcal"]').first()).toContainText(/2\D?100/);
    const toastCloseButtons = page.locator('.toast__close');
    while (await toastCloseButtons.count()) {
      await toastCloseButtons.first().click();
    }
    const screenshotDirectory = resolve('.e2e-screenshots/2026-10-06-calendar-multiple-goals');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}.png`)
    });
  });

  test('un evento se apunta escribiendo solo el titulo', async ({ page }) => {
    // Es la repro literal del usuario: «el calendario da error si no mandas todos los campos, y eso es
    // erroneo ya que se marcan como opcional». Aqui no se rellena nada de lo opcional: ni color, ni
    // sitio, ni notas, ni hora. Si el servidor volviera a pedir el paquete entero, este test es el
    // que lo cuenta, y lo cuenta con el boton que se pulsa, no con un safeParse.
    await page.locator('[data-test="event-add"]').click();
    await expect(page.locator('.modal__title')).toContainText('Apuntar un evento');

    await page.fill('#event-title', 'Medir el pasillo');
    await page.locator('[data-test="event-save"]').click();

    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('[data-test="household-event"]')).toContainText('Medir el pasillo');
    // Y el dialogo de error no aparecio: los 400 del calendario se ven como nota dentro del modal.
    await expect(page.locator('.cal-note[role="alert"]')).toHaveCount(0);
  });

  test('el editor valida, conserva todos los campos, descarta cancelaciones y pide confirmar el borrado', async ({
    page
  }) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/\/api\/calendar\/events(?:\/|$)/.test(pathname)) {
        const method = request.method();
        if (['POST', 'PATCH', 'DELETE'].includes(method)) writes.push(method);
      }
    });

    const openButton = page.locator('[data-test="event-add"]');
    await openButton.click();
    const dialog = page.locator('app-modal.calendar-event-modal [role="dialog"]');
    const save = dialog.locator('[data-test="event-save"]');
    await expect(dialog).toBeVisible();
    await expect(save).toBeDisabled();
    const focusStartedInDialog = await dialog.evaluate((element) =>
      element.contains(document.activeElement)
    );
    expect(focusStartedInDialog).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(openButton).toBeFocused();

    await openButton.click();
    await page.fill('#event-title', 'Revisión del botiquín');
    const eventDate = daysFromToday(1);
    await page.fill('#event-date', eventDate);
    await page.fill('#event-start', '06:30');
    await page.fill('#event-end', '07:45');
    await dialog.locator('[data-test="event-more-options"]').click();

    const kind = dialog.locator('[data-test="event-kind"]');
    await kind.locator('.picker__trigger').click();
    await page.getByRole('option', { name: 'Casa', exact: true }).click();
    await dialog.getByRole('button', { name: 'Color #E05A5A', exact: true }).click();
    await page.fill('#event-place', 'Armario del recibidor');
    await page.fill('#event-notes', 'Comprobar fecha y llevar una lista.');
    await save.click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual(['POST']);

    // El evento se crea mañana; selecciona esa fecha para que aparezca si cambia de semana.
    await page.getByRole('gridcell', { name: `Ver el día ${eventDate}`, exact: true }).click();

    const eventCard = page
      .locator('[data-test="timeline-block-event"]')
      .filter({ hasText: 'Revisión del botiquín' });
    await expect(eventCard).toHaveCount(1);
    await eventCard.click();
    await expect(dialog.locator('.modal__title')).toContainText('Editar evento');
    await expect(dialog.locator('#event-title')).toHaveValue('Revisión del botiquín');
    await expect(dialog.locator('#event-date')).toHaveValue(eventDate);
    await expect(dialog.locator('#event-start')).toHaveValue('06:30');
    await expect(dialog.locator('#event-end')).toHaveValue('07:45');
    await expect(kind.locator('.picker__value')).toHaveText('Casa');
    await expect(dialog.locator('#event-place')).toHaveValue('Armario del recibidor');
    await expect(dialog.locator('#event-notes')).toHaveValue('Comprobar fecha y llevar una lista.');
    await expect(dialog.getByRole('button', { name: 'Color #E05A5A', exact: true })).toHaveClass(
      /is-active/
    );

    // Un cambio en el borrador seguido de Cancelar no debe emitir PATCH ni reemplazar lo guardado.
    await page.fill('#event-place', 'Cambio que se descarta');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual(['POST']);
    await page.reload();
    await expect(eventCard).toHaveCount(1);
    await eventCard.click();
    await expect(dialog.locator('#event-place')).toHaveValue('Armario del recibidor');

    await page.fill('#event-notes', 'Fecha revisada; guardar el cambio.');
    await save.click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual(['POST', 'PATCH']);
    await page.reload();
    await expect(eventCard).toHaveCount(1);
    await eventCard.click();
    await expect(dialog.locator('#event-notes')).toHaveValue('Fecha revisada; guardar el cambio.');

    await dialog.getByRole('button', { name: 'Borrar', exact: true }).click();
    const confirmation = page.locator('app-confirm-dialog [role="dialog"]');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('Revisión del botiquín');
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(eventCard).toHaveCount(1);
    expect(writes).toEqual(['POST', 'PATCH']);

    await dialog.getByRole('button', { name: 'Borrar', exact: true }).click();
    await page
      .locator('app-confirm-dialog [role="dialog"]')
      .getByRole('button', { name: 'Eliminar', exact: true })
      .click();
    await expect(eventCard).toHaveCount(0);
    expect(writes).toEqual(['POST', 'PATCH', 'DELETE']);
  });

  test('quien no tiene casa no ve un picker de invitados: no hay a quien invitar', async ({
    page
  }) => {
    // No es que el control este roto: es que no hay hogar. Y la distincion importa, porque el bug que
    // trajo esta ronda era exactamente un bloque que no se pintaba por no haber cargado la casa.
    await page.locator('[data-test="event-add"]').click();
    await expect(page.locator('.modal__title')).toContainText('Apuntar un evento');
    await expect(page.locator('[data-test="event-attendees"]')).toHaveCount(0);
    await expect(page.locator('[data-test="event-no-people"]')).toHaveCount(0);

    await page.fill('#event-title', 'Regar los tomates');
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('[data-test="household-event"]')).toContainText('Regar los tomates');
  });

  test('la pestaña Receta elige del recetario en lugar de escribir el plato', async ({ page }) => {
    await page.locator('[data-test="timeline-add-meal"]').first().click();
    await page.locator('.meal-form__tabs button', { hasText: 'Receta' }).click();
    await expect(page.locator('.modal-overlay')).toContainText('Selecciona una receta');

    // Sin receta elegida no se puede guardar
    await expect(
      page.locator('app-modal').getByRole('button', { name: 'Añadir', exact: true })
    ).toBeDisabled();
  });
});

/**
 * Invitaciones a un evento. Viven en su propio describe porque necesitan dos sesiones: «invitar a
 * alguien de la casa» no se puede probar con un usuario solo, que es justo el caso en el que el control
 * dejo de existir.
 *
 * Escrito en la ronda de los horarios y con `typecheck:e2e` pasado; no se ha ejecutado aqui porque el
 * sandbox no tiene Chromium. Corre en el job de Playwright.
 */
test.describe('Calendario — invitar a la casa', () => {
  test('una casa de uno dice que no hay a quien invitar, en lugar de callarse', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await registerAndGoto(page, '/household');
    await page.getByRole('button', { name: /Crear hogar/i }).click();
    await page.fill('input#householdName', 'Familia Uno');
    await page.click('button[type="submit"]');

    await page.goto('/calendar');
    await page.locator('[data-test="event-add"]').click();
    await page.locator('[data-test="event-more-options"]').click();
    // El bloque sale (hay casa) y dice lo que hay: una persona. Antes de esta ronda, «no hay mas» y «no
    // he cargado la casa» se pintaban igual: nada.
    await expect(page.locator('[data-test="event-no-people"]')).toBeVisible();
    await expect(page.locator('[data-test="event-no-people"]')).toContainText('única persona');
    await expect(page.getByRole('button', { name: /Invitar a alguien/i })).toBeVisible();

    await page.getByRole('button', { name: /Invitar a alguien/i }).click();
    await expect(page).toHaveURL(/household/);
    await ctx.close();
  });

  test('se marca a otra persona, se guarda, y al reabrir el evento sigue marcada', async ({
    browser
  }) => {
    const ownerName = `Sótano de ${Date.now()}`;
    const ownerCtx = await browser.newContext();
    const page = await ownerCtx.newPage();
    await registerAndGoto(page, '/household');
    await page.getByRole('button', { name: /Crear hogar/i }).click();
    await page.fill('input#householdName', ownerName);
    await page.click('button[type="submit"]');
    const inviteUrl = (await page.locator('.invite-card__code').textContent()) ?? '';
    expect(inviteUrl).toContain('/invite/');
    const code = inviteUrl.split('/invite/')[1];

    // Segunda persona, en su propia sesion: el picker tiene que listar a la OTRA y nunca a quien escribe.
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await memberPage.goto('/auth/register');
    await memberPage.fill('input#name', 'Bea');
    await memberPage.fill('input#email', `bea-${Date.now()}@example.com`);
    await memberPage.fill('input#password', 'Test1234');
    await memberPage.fill('input#confirm-password', 'Test1234');
    await memberPage.click('button[type="submit"]');
    await skipOnboarding(memberPage);
    await memberPage.goto('/household');
    await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
    await memberPage.locator('.join-form input').fill(code);
    await memberPage.getByRole('button', { name: 'Unirse', exact: true }).click();
    await expect(memberPage.locator('.household-info')).toBeVisible();

    await page.goto('/calendar');
    await page.locator('[data-test="event-add"]').click();
    await page.locator('[data-test="event-more-options"]').click();
    const people = page.locator('[data-test="event-attendees"] .cal-person');
    await expect(people).toHaveCount(1);
    await expect(people.first()).toContainText('Bea');

    await people.first().click();
    await expect(people.first()).toHaveAttribute('aria-pressed', 'true');
    await page.fill('#event-title', 'Medir el pasillo');
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect(page.locator('[data-test="household-event"]')).toContainText('Medir el pasillo');

    // El bug que reportó el usuario: abrir «editar» empezaba sin nadie seleccionado, y guardar
    // escribia ese vacio (desinvitar a todos sin querer). Reabierto, la marca tiene que estar.
    await page.locator('[data-test="household-event"]').first().click();
    await expect(page.locator('#event-title')).toHaveValue('Medir el pasillo');
    await expect(page.locator('[data-test="event-attendees"] .cal-person').first()).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Y la otra persona lo ve en su calendario: es un evento de la casa, no una nota privada.
    await memberPage.goto('/calendar');
    await expect(memberPage.locator('[data-test="household-event"]')).toContainText(
      'Medir el pasillo'
    );

    await memberCtx.close();
    await ownerCtx.close();
  });
});

/**
 * Repeticiones (HOGARIA-SPEC 12t-R): lo que pidio quien usa la app —«que en la creacion de eventos pueda
 * repetirse, semanal, diario»—. Se comprueba en la agenda del dia, que es donde la app pinta las sueltas:
 * la serie es UNA fila guardada, y lo que se ve el lunes es una replica del lunes pasado. La cadencia se
 * prueba cambiando de dia con las flechas, no contando la semana entera: si se cuenta, el test depende de
 * que el calendario pinte o no cada dia, y eso es otra pantalla.
 */
test.describe('Calendario — repeticiones', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoto(page, '/calendar');
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    // La agenda del dia es la que dice lo que hay hoy; la vista de dia ancla en hoy al entrar.
    await selectCalendarView(page, 'day', 'Día');
    await expect(page.locator('[data-test="agenda"]')).toBeVisible();
  });

  /** El dia anterior, con la flecha de la cabecera. */
  async function diaAnterior(page: import('@playwright/test').Page): Promise<void> {
    await page.locator('.cal-top__nav .cal-icon-btn').first().click();
  }

  /** El dia siguiente, con la flecha de la cabecera. */
  async function diaSiguiente(page: import('@playwright/test').Page): Promise<void> {
    await page.locator('.cal-top__nav .cal-icon-btn').nth(1).click();
  }

  /** Abre el «+», rellena titulo y fecha, y elige la cadencia si se le dice. */
  async function nuevaSuelta(
    page: import('@playwright/test').Page,
    titulo: string,
    fecha: string,
    cadencia?: 'Cada semana' | 'Todos los días',
    conHorario = false
  ): Promise<void> {
    await page.locator('[data-test="event-add"]').click();
    await expect(page.locator('.modal__title')).toContainText('Apuntar un evento');
    await page.fill('#event-title', titulo);
    await page.fill('#event-date', fecha);
    if (conHorario) {
      await page.fill('#event-start', '08:30');
      await page.fill('#event-end', '09:30');
    }
    if (cadencia) {
      const repetir = page.locator('[data-test="event-recurrence"]');
      await repetir.locator('.picker__trigger').click();
      const option =
        cadencia === 'Cada semana'
          ? repetir.getByRole('option', { name: /^Cada semana el / })
          : repetir.getByRole('option', { name: cadencia, exact: true });
      await option.click();
    }
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  }

  test('una serie semanal aparece hoy y no ayer, con la marca de repeticion', async ({ page }) => {
    // La fecha de la serie es HACE SIETE DIAS: si hoy aparece y ayer no, la expansion respeta la cadencia.
    // Era la alternativa facil (guardar una fila por dia) lo que habria pintado los dos.
    await nuevaSuelta(page, 'Sacar la basura', daysFromToday(-7), 'Cada semana');

    const hoy = page.locator('[data-test="household-event"]', { hasText: 'Sacar la basura' });
    await expect(hoy).toHaveCount(1);
    // El glifo va en la pastilla: «esto se repite» tiene que verse sin abrir nada.
    await expect(hoy.locator('.cal-evt__repeat')).toHaveCount(1);

    await diaAnterior(page);
    await expect(
      page.locator('[data-test="household-event"]', { hasText: 'Sacar la basura' })
    ).toHaveCount(0);
  });

  test('una serie diaria se repite tambien el dia anterior, y sigue siendo un solo evento', async ({
    page
  }) => {
    await nuevaSuelta(page, 'Revisar el riego', daysFromToday(-30), 'Todos los días');

    const hoy = page.locator('[data-test="household-event"]', { hasText: 'Revisar el riego' });
    await expect(hoy).toHaveCount(1);

    await diaSiguiente(page);
    await expect(
      page.locator('[data-test="household-event"]', { hasText: 'Revisar el riego' })
    ).toHaveCount(1);
    await diaAnterior(page);
    await expect(hoy).toHaveCount(1);

    await diaAnterior(page);
    await expect(
      page.locator('[data-test="household-event"]', { hasText: 'Revisar el riego' })
    ).toHaveCount(1);

    // Un evento, no dos: al abrirlo desde una burbuja el modal avisa de que se edita la SERIE, y da la
    // opcion de faltar solo a un dia. Las dos frases a la vez es lo que hace que no haya susto.
    await page
      .locator('[data-test="household-event"]', { hasText: 'Revisar el riego' })
      .first()
      .click();
    await expect(page.locator('[data-test="event-skip-day"]')).toBeVisible();
    await expect(
      page.locator('.cal-note').filter({ hasText: 'afectan a todas las repeticiones' })
    ).toHaveCount(1);
  });

  test('los botones del modal de evento tienen una geometría uniforme', async ({
    page
  }, testInfo) => {
    await page.setViewportSize(
      testInfo.project.name === 'mobile-chrome'
        ? { width: 320, height: 800 }
        : { width: 1440, height: 900 }
    );
    await nuevaSuelta(page, 'Ordenar la entrada', daysFromToday(0), 'Todos los días');
    await page
      .locator('[data-test="household-event"]', { hasText: 'Ordenar la entrada' })
      .first()
      .click();

    const actions = page.locator('[data-test="event-actions"] > .cal-btn');
    await expect(actions).toHaveCount(4);
    await expect
      .poll(() => actions.first().evaluate((button) => button.getBoundingClientRect().height))
      .toBe(44);
    const geometry = await actions.evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          textFits: button.scrollWidth <= button.clientWidth
        };
      })
    );

    expect(new Set(geometry.map(({ width }) => width)).size).toBe(1);
    expect(new Set(geometry.map(({ height }) => height))).toEqual(new Set([44]));
    expect(geometry.every(({ width }) => width <= 112)).toBe(true);
    expect(geometry.every(({ textFits }) => textFits)).toBe(true);
    const modalBounds = await page.locator('app-modal.calendar-event-modal .modal').boundingBox();
    const actionBounds = await page.locator('[data-test="event-actions"]').boundingBox();
    expect(modalBounds).not.toBeNull();
    expect(actionBounds).not.toBeNull();
    expect(actionBounds!.x).toBeGreaterThanOrEqual(modalBounds!.x);
    expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(
      modalBounds!.x + modalBounds!.width + 1
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBe(true);

    await actions.last().scrollIntoViewIfNeeded();
    const screenshotDirectory = resolve('.e2e-screenshots/qa-button-geometry');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-event-actions.png`),
      fullPage: false,
      animations: 'disabled'
    });
  });

  test('la recurrencia personalizada guarda intervalo y fin por número de repeticiones', async ({
    page
  }) => {
    const start = daysFromToday(-6);
    await page.locator('[data-test="event-add"]').click();
    await page.locator('#event-title').fill('Riego cada dos días');
    await page.locator('#event-date').fill(start);

    const repeat = page.locator('[data-test="event-recurrence"]');
    await repeat.locator('.picker__trigger').click();
    await repeat.locator('.picker__option', { hasText: 'Personalizar' }).click();
    const custom = page.locator('[data-test="custom-recurrence"]');
    await expect(custom).toBeVisible();

    await custom.locator('[data-test="recurrence-frequency"] .picker__trigger').click();
    await custom.getByRole('option', { name: 'día', exact: true }).click();
    await custom.locator('#recurrence-interval').fill('2');
    await custom.locator('input[type="radio"][value="count"]').check();
    await custom.locator('.recurrence-editor__count input').fill('4');
    await custom.locator('[data-test="recurrence-done"]').click();
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    await page
      .locator('[data-test="household-event"]', { hasText: 'Riego cada dos días' })
      .waitFor();
    await page.locator('.cal-top__nav .cal-icon-btn').first().click();
    await expect(
      page.locator('[data-test="household-event"]', { hasText: 'Riego cada dos días' })
    ).toHaveCount(0);
    await page.locator('.cal-top__nav .cal-icon-btn').first().click();
    await expect(
      page.locator('[data-test="household-event"]', { hasText: 'Riego cada dos días' })
    ).toHaveCount(1);
  });

  test('la serie semanal personalizada conserva varios días y fin al editar/cancelar', async ({
    page
  }) => {
    const start = daysFromToday(1);
    const startDate = new Date(`${start}T12:00:00`);
    const firstWeekday = ((startDate.getDay() + 6) % 7) + 1;
    const secondWeekday = firstWeekday === 7 ? 1 : firstWeekday + 1;
    const selectedWeekdays = [firstWeekday, secondWeekday].sort((a, b) => a - b);
    const weekdayName = (weekday: number) =>
      new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(new Date(2024, 0, weekday, 12));
    const end = new Date(`${start}T12:00:00`);
    end.setDate(end.getDate() + 14);
    const endDate = isoOf(end);
    const title = 'Revisión de plantas semanal';

    await page.locator('[data-test="event-add"]').click();
    await page.locator('#event-title').fill(title);
    await page.locator('#event-date').fill(start);

    const repeat = page.locator('[data-test="event-recurrence"]');
    await repeat.locator('.picker__trigger').click();
    await repeat.locator('.picker__option', { hasText: 'Personalizar' }).click();
    const custom = page.locator('[data-test="custom-recurrence"]');
    await expect(custom).toBeVisible();

    const secondDay = custom.getByRole('button', { name: weekdayName(secondWeekday), exact: true });
    await expect(secondDay).toHaveAttribute('aria-pressed', 'false');
    await secondDay.focus();
    await expect(secondDay).toBeFocused();
    await page.keyboard.press('Space');
    await expect(secondDay).toHaveAttribute('aria-pressed', 'true');
    await custom.locator('input[type="radio"][value="date"]').check();
    await custom.locator('input[type="date"]').fill(endDate);
    await custom.locator('[data-test="recurrence-done"]').click();

    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith('/api/calendar/events') &&
        response.request().method() === 'POST'
    );
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    const created = (await createdResponse).json() as Promise<{
      data: {
        id: string;
        recurrenceRule: {
          frequency: string;
          weekdays: number[];
          end: { type: string; date: string };
        };
      };
    }>;
    const createdBody = await created;
    expect(createdBody.data.recurrenceRule).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: selectedWeekdays,
      end: { type: 'date', date: endDate }
    });

    const token = await page.evaluate(() => window.localStorage.getItem('hogar:v1:auth_token'));
    expect(token).toBeTruthy();
    const readOccurrences = async () => {
      const response = await page.request.get(`/api/calendar/events?from=${start}&to=${endDate}`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.status()).toBe(200);
      return (await response.json()).data as Array<{
        id: string;
        title: string;
        date: string;
        recurrenceRule: {
          frequency: string;
          weekdays: number[];
          end: { type: string; date: string };
        };
      }>;
    };
    const expectedDates: string[] = [];
    const cursor = new Date(`${start}T12:00:00`);
    while (isoOf(cursor) <= endDate) {
      const weekday = ((cursor.getDay() + 6) % 7) + 1;
      if (selectedWeekdays.includes(weekday)) expectedDates.push(isoOf(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    const initialOccurrences = await readOccurrences();
    expect(initialOccurrences.map((event) => event.date)).toEqual(expectedDates);
    expect(new Set(initialOccurrences.map((event) => event.id)).size).toBe(1);

    await page.goto(`/calendar?view=day&date=${start}`);
    const event = page.locator('[data-test="household-event"]', { hasText: title }).first();
    await expect(event).toBeVisible();
    await event.click();
    await expect(page.locator('#event-title')).toHaveValue(title);
    await page.locator('[data-test="event-recurrence"] .picker__trigger').click();
    await page
      .locator('[data-test="event-recurrence"] .picker__option', { hasText: 'Personalizar' })
      .click();
    const reopened = page.locator('[data-test="custom-recurrence"]');
    await expect(reopened).toBeVisible();
    await expect(reopened.locator('.recurrence-editor__day[aria-pressed="true"]')).toHaveCount(2);
    for (const weekday of selectedWeekdays) {
      await expect(
        reopened.getByRole('button', { name: weekdayName(weekday), exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(reopened.locator('input[type="radio"][value="date"]')).toBeChecked();
    await expect(reopened.locator('input[type="date"]')).toHaveValue(endDate);

    // Cambiar el borrador de la periodicidad y cancelar no debe alterar la serie persistida.
    const unselectedDay = reopened.locator('.recurrence-editor__day[aria-pressed="false"]').first();
    await unselectedDay.click();
    await reopened.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page
      .locator('[data-test="event-actions"]')
      .getByRole('button', { name: 'Cancelar' })
      .click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    const afterCancel = await readOccurrences();
    expect(afterCancel.map((event) => event.date)).toEqual(expectedDates);
    expect(afterCancel.every((event) => event.title === title)).toBe(true);
    expect(afterCancel[0].recurrenceRule.weekdays).toEqual(selectedWeekdays);

    // Reabrir y guardar un cambio ordinario conserva la recurrencia completa de la serie.
    await event.click();
    await expect(page.locator('#event-title')).toHaveValue(title);
    await page.locator('#event-title').fill(`${title} editada`);
    const updatedResponse = page.waitForResponse(
      (response) =>
        /^\/api\/calendar\/events\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.request().method() === 'PATCH'
    );
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    expect((await updatedResponse).status()).toBe(200);
    const updatedOccurrences = await readOccurrences();
    expect(updatedOccurrences.map((event) => event.date)).toEqual(expectedDates);
    expect(updatedOccurrences.every((event) => event.title === `${title} editada`)).toBe(true);
    expect(updatedOccurrences[0].recurrenceRule).toEqual(createdBody.data.recurrenceRule);
  });

  test('«quitar solo este día» deja el resto de la serie en pie', async ({ page }) => {
    await nuevaSuelta(page, 'Pasar el aspirador', daysFromToday(-30), 'Todos los días');
    const hoy = page.locator('[data-test="household-event"]', { hasText: 'Pasar el aspirador' });
    await expect(hoy).toHaveCount(1);

    await hoy.first().click();
    await page.locator('[data-test="event-skip-day"]').click();
    // Confirmacion propia de la app, no `confirm()` del navegador: se acepta por el boton que la app pinta.
    const confirmation = page.locator('.confirm');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Quitar solo este día' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    // Hoy no esta, y el hueco no se rellena solo: eso es la excepcion guardada, no una espera.
    await expect(
      page.locator('[data-test="household-event"]', { hasText: 'Pasar el aspirador' })
    ).toHaveCount(0);
    await diaAnterior(page);
    await expect(
      page.locator('[data-test="household-event"]', { hasText: 'Pasar el aspirador' })
    ).toHaveCount(1);
  });

  test('una suelta normal no se repite: «No se repite» es el defecto y no lleva glifo', async ({
    page
  }) => {
    await page.locator('[data-test="event-add"]').click();
    const repetir = page.locator('[data-test="event-recurrence"]');
    await repetir.locator('.picker__trigger').click();
    const noSeRepite = repetir.locator('.picker__option', { hasText: 'No se repite' });
    await expect(noSeRepite).toHaveCount(1);
    await expect(noSeRepite).toHaveAttribute('aria-selected', 'true');
    // Cierra el menú antes de guardar; el panel abierto intercepta correctamente
    // los clics en los controles que quedan debajo.
    await noSeRepite.click();
    await page.fill('#event-title', 'Comprar lija');
    await page.locator('[data-test="event-save"]').click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    const chip = page.locator('[data-test="household-event"]', { hasText: 'Comprar lija' });
    await expect(chip).toHaveCount(1);
    await expect(chip.locator('.cal-evt__repeat')).toHaveCount(0);
  });

  test('una serie semanal también se carga al abrir la semana siguiente', async ({
    page
  }, testInfo) => {
    const start = daysFromToday(0);
    const followingOccurrence = daysFromToday(7);
    await nuevaSuelta(page, 'Cambiar sábanas semanal', start, 'Cada semana', true);

    const nextWeek = mondayOfIsoWeek(followingOccurrence);
    const nextWeekEndDate = new Date(`${nextWeek}T12:00:00Z`);
    nextWeekEndDate.setUTCDate(nextWeekEndDate.getUTCDate() + 6);
    const nextWeekEnd = nextWeekEndDate.toISOString().slice(0, 10);
    const eventsResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/api/calendar/events') &&
        url.searchParams.get('from') === nextWeek &&
        url.searchParams.get('to') === nextWeekEnd
      );
    });
    const responseData = eventsResponse.then(
      (response) =>
        response.json() as Promise<{
          data: Array<{ title: string; date: string; startTime: string | null }>;
        }>
    );
    await page.goto(`/calendar?view=week&date=${followingOccurrence}`);
    const responseBody = await responseData;
    expect(
      responseBody.data.some(
        (event) =>
          event.title === 'Cambiar sábanas semanal' &&
          event.date === followingOccurrence &&
          event.startTime === '08:30'
      ),
      'La API del rango futuro debe incluir la ocurrencia de la serie'
    ).toBe(true);
    const occurrence = page.locator('[data-test="timeline-block-event"]', {
      hasText: 'Cambiar sábanas semanal'
    });
    await expect(occurrence).toHaveCount(1);
    await expect
      .poll(() =>
        occurrence
          .first()
          .evaluate((element) => element.closest('[data-date]')?.getAttribute('data-date'))
      )
      .toBe(followingOccurrence);

    const timeline = page.locator('.tl__scroll');
    await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(0);
    const midnightLabel = page.locator('.tl__hour').first();
    await expect(midnightLabel).toHaveText('00:00');
    const midnightFitsTimeline = await midnightLabel.evaluate((element) => {
      const label = element.getBoundingClientRect();
      const viewport = element.closest('.tl__scroll')?.getBoundingClientRect();
      return Boolean(viewport && label.top >= viewport.top && label.bottom <= viewport.bottom);
    });
    expect(
      midnightFitsTimeline,
      '00:00 debe quedar completo al abrir una semana futura desde medianoche'
    ).toBe(true);
    await page.evaluate(() => {
      const timeline = document.querySelector('.tl__scroll');
      const appHeader = document.querySelector('.header');
      if (!timeline) return;
      const timelineTop = timeline.getBoundingClientRect().top;
      const appHeaderBottom = appHeader?.getBoundingClientRect().bottom ?? 0;
      document.scrollingElement?.scrollBy(0, timelineTop - appHeaderBottom - 8);
    });
    await page.waitForFunction(
      () => !(document as Document & { activeViewTransition?: unknown }).activeViewTransition
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    const midnightVisibleOnScreen = await midnightLabel.evaluate((element) => {
      const label = element.getBoundingClientRect();
      const timelineViewport = element.closest('.tl__scroll')?.getBoundingClientRect();
      const appHeaderBottom =
        document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0;
      return Boolean(
        timelineViewport &&
        label.top >= Math.max(timelineViewport.top, appHeaderBottom) &&
        label.bottom <= Math.min(timelineViewport.bottom, window.innerHeight)
      );
    });
    expect(midnightVisibleOnScreen, '00:00 debe quedar visible bajo la cabecera fija').toBe(true);
    const screenshotDirectory = resolve('.e2e-screenshots/calendar-week-midnight');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-recurring-next-week.png`),
      fullPage: false
    });
  });

  test('el editor de eventos usa superficies, título y color de HogarIA', async ({
    page
  }, testInfo) => {
    await registerAndGoto(page, '/calendar', 'calendar-modal-design');
    await page.locator('[data-test="event-add"]').click();

    const modal = page.locator('.calendar-event-modal .modal');
    await expect(modal).toBeVisible();
    await page.waitForFunction(
      () => !(document as Document & { activeViewTransition?: unknown }).activeViewTransition
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await page.locator('.modal-overlay').evaluate(async (overlay) => {
      await Promise.all(
        overlay
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined))
      );
    });
    const title = modal.locator('.modal__title');
    await expect(title).toContainText('Apuntar un evento');
    await modal.locator('#event-title').fill('Prueba visual de evento');
    await expect(modal.locator('[data-test="event-save"]')).toBeEnabled();
    const metrics = await modal.evaluate((element) => {
      const style = getComputedStyle(element);
      const root = document.documentElement;
      const probe = document.createElement('span');
      root.append(probe);
      probe.style.backgroundColor = 'var(--bg-secondary)';
      const surface = getComputedStyle(probe).backgroundColor;
      probe.style.backgroundColor = 'var(--primary)';
      const primary = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const button = element.querySelector<HTMLElement>('.cal-btn--primary');
      const titleBox = element.querySelector('.modal__title')?.getBoundingClientRect();
      return {
        background: style.backgroundColor,
        surface,
        button: button ? getComputedStyle(button).backgroundColor : '',
        primary,
        titleHeight: titleBox?.height ?? 0
      };
    });
    expect(metrics.background).toBe(metrics.surface);
    expect(metrics.button).toBe(metrics.primary);
    expect(metrics.titleHeight).toBeGreaterThan(4);

    const screenshotDirectory = resolve('.e2e-screenshots/calendar-app-modal');
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(screenshotDirectory, `${testInfo.project.name}-event-modal.png`),
      fullPage: false
    });
  });
});
