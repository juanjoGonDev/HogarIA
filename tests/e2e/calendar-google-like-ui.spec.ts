import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

/** Capturas visuales con cuenta y eventos sintéticos para revisar el diseño en PC y móvil. */
test('las vistas, el selector de repetición y los editores conservan su diseño y caben en pantalla', async ({
  page
}, testInfo) => {
  await registerAndGoto(page, '/calendar');
  await expect(page.locator('h1.calendar__title')).toBeVisible();

  const screenshotRoot = process.env.E2E_SCREENSHOT_DIR
    ? resolve(process.env.E2E_SCREENSHOT_DIR)
    : resolve('.e2e-screenshots');
  const screenshots = resolve(screenshotRoot, 'calendar-google-like');
  mkdirSync(screenshots, { recursive: true });
  const capture = (name: string) =>
    page.screenshot({
      path: resolve(screenshots, `${testInfo.project.name}-${name}.png`),
      fullPage: false,
      animations: 'disabled'
    });

  await expect(page.locator('[data-test="calendar-view-select"]')).toHaveAttribute(
    'data-view',
    'week'
  );
  await capture('week');

  await page.locator('[data-test="event-add"]').click();
  const editor = page.locator('app-modal.calendar-event-modal .modal-overlay');
  await expect(editor).toBeVisible();
  const eventDate = await editor.locator('#event-date').inputValue();
  const expectedDateLabels = await page.evaluate((iso) => {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    return {
      full: new Intl.DateTimeFormat('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }).format(date),
      compact: new Intl.DateTimeFormat('es-ES', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      })
        .format(date)
        .replace(/\./g, '')
    };
  }, eventDate);
  const compactDate = (await page.evaluate(() => window.innerWidth)) <= 600;
  await expect(
    editor.locator(compactDate ? '.cal-event-date__compact' : '.cal-event-date__full')
  ).toHaveText(compactDate ? expectedDateLabels.compact : expectedDateLabels.full);
  await capture('event-editor');

  const repeat = editor.locator('[data-test="event-recurrence"]');
  await repeat.locator('.picker__trigger').click();
  const weekdayName = await page.evaluate((iso) => {
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(
      new Date(year, month - 1, day, 12)
    );
  }, eventDate);
  await expect(
    repeat.locator('.picker__option').filter({ hasText: /^Cada semana el / })
  ).toContainText(weekdayName);
  const customOption = repeat.locator('.picker__option').filter({ hasText: 'Personalizar' });
  await expect(customOption).toBeVisible();
  await expect(customOption).toBeInViewport();
  const weekdayOptionLabel = repeat
    .locator('.picker__option')
    .filter({ hasText: 'Todos los días laborables' })
    .locator('.picker__label');
  await expect(weekdayOptionLabel).toBeVisible();
  await expect
    .poll(() => weekdayOptionLabel.evaluate((label) => label.scrollWidth <= label.clientWidth))
    .toBe(true);
  const repeatPanel = await repeat.locator('.picker__panel').boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(repeatPanel).not.toBeNull();
  expect(repeatPanel!.y + repeatPanel!.height).toBeLessThanOrEqual(viewportHeight);
  await capture('repeat-selector');

  await repeat.locator('.picker__option').filter({ hasText: 'Personalizar' }).click();
  const custom = page.locator('[data-test="custom-recurrence"]');
  await expect(custom).toBeVisible();
  await expect(custom.locator('.recurrence-editor__day')).toHaveText([
    'L',
    'M',
    'X',
    'J',
    'V',
    'S',
    'D'
  ]);
  const fullWeekdayNames = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat('es-ES', { weekday: 'long' }).format(new Date(2024, 0, index + 1, 12))
  );
  expect(
    await custom
      .locator('.recurrence-editor__day')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
  ).toEqual(fullWeekdayNames);
  await capture('custom-repeat');

  await page.keyboard.press('Escape');
  await expect(custom).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();

  const viewPicker = page.locator('[data-test="calendar-view-select"]');
  await viewPicker.locator('.picker__trigger').click();
  await expect(viewPicker.locator('.picker__option .picker__label')).toHaveText([
    'Día',
    '4 días',
    'Semana',
    'Mes',
    'Año',
    'Agenda'
  ]);
  await capture('view-selector');
  await page.getByRole('option', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.agenda-list')).toBeVisible();
  await capture('agenda');

  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
});

test('el editor y el selector no desbordan en el ancho mínimo ni en horizontal', async ({
  page
}) => {
  await registerAndGoto(page, '/calendar');

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 812, height: 375 }
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);

    await page.locator('[data-test="event-add"]').click();
    const editor = page.locator('app-modal.calendar-event-modal .modal-overlay');
    await expect(editor).toBeVisible();
    const modal = await editor.locator('.modal').boundingBox();
    expect(modal).not.toBeNull();
    expect(modal!.x).toBeGreaterThanOrEqual(0);
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(viewport.width);

    const repeat = editor.locator('[data-test="event-recurrence"]');
    await repeat.locator('.picker__trigger').click();
    const panel = await repeat.locator('.picker__panel').boundingBox();
    expect(panel).not.toBeNull();
    expect(panel!.x).toBeGreaterThanOrEqual(0);
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Cerrar' }).click();
    await expect(editor).toBeHidden();
  }
});

test('la mini agenda cambia de mes y fecha, enlaza el estado y conserva hoy tras recargar', async ({
  page
}) => {
  await registerAndGoto(page, '/calendar?view=month&date=2026-10-01');

  const mini = page.locator('app-calendar-mini-month');
  const miniMonth = mini.locator('.mini__head h2');
  await expect(miniMonth).toHaveText('octubre de 2026');
  await expect(page.locator('h1.calendar__title')).toContainText('octubre de 2026');

  await mini.locator('.mini__nav button').nth(1).click();
  await expect(miniMonth).toHaveText('noviembre de 2026');
  await expect(page).toHaveURL(/view=month.*date=2026-11-01/);

  const selectedDate = mini.locator('.mini__day[aria-label="Ver el día 2026-11-15"]');
  await selectedDate.click();
  await expect(page.locator('h1.calendar__title')).toContainText('noviembre de 2026');
  await expect(page).toHaveURL(/view=month.*date=2026-11-15/);
  await expect(selectedDate).toHaveClass(/is-selected/);

  await page.reload();
  await expect(miniMonth).toHaveText('noviembre de 2026');
  await expect(mini.locator('.mini__day.is-selected')).toHaveAttribute(
    'aria-label',
    'Ver el día 2026-11-15'
  );

  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  await mini.locator('.mini__today').click();
  await expect(mini.locator(`.mini__day[aria-label="Ver el día ${today}"]`)).toHaveClass(
    /is-selected/
  );
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('month');
  await expect.poll(() => new URL(page.url()).searchParams.has('date')).toBe(false);

  await page.reload();
  await expect(mini.locator(`.mini__day[aria-label="Ver el día ${today}"]`)).toHaveClass(
    /is-selected/
  );
});

test('los días y meses de las rejillas sincronizan fecha, vista, URL y mini agenda', async ({
  page
}) => {
  await registerAndGoto(page, '/calendar?view=month&date=2026-10-01');

  const viewPicker = page.locator('[data-test="calendar-view-select"]');
  const mini = page.locator('app-calendar-mini-month');
  const dateInput = page.locator('.cal-jump input[type="date"]');

  await page
    .getByRole('button', { name: 'Ver el jueves, 15 de octubre de 2026', exact: true })
    .click();
  await expect(viewPicker).toHaveAttribute('data-view', 'day');
  await expect(page).toHaveURL(/view=day.*date=2026-10-15/);
  await expect(dateInput).toHaveValue('2026-10-15');
  await expect(mini.locator('.mini__day.is-selected')).toHaveAttribute(
    'aria-label',
    'Ver el día 2026-10-15'
  );

  await viewPicker.locator('.picker__trigger').click();
  await page.getByRole('option', { name: 'Año', exact: true }).click();
  await expect(viewPicker).toHaveAttribute('data-view', 'year');
  const yearGrid = page.getByRole('grid', { name: '2026', exact: true });
  await yearGrid.getByRole('button', { name: 'marzo de 2026', exact: true }).click();
  await expect(viewPicker).toHaveAttribute('data-view', 'month');
  await expect(page).toHaveURL(/view=month.*date=2026-03-01/);
  await expect(page.locator('h1.calendar__title')).toContainText('marzo de 2026');
  await expect(mini.locator('.mini__day.is-selected')).toHaveAttribute(
    'aria-label',
    'Ver el día 2026-03-01'
  );

  await viewPicker.locator('.picker__trigger').click();
  await page.getByRole('option', { name: 'Año', exact: true }).click();
  await page
    .getByRole('grid', { name: '2026', exact: true })
    .getByRole('button', { name: 'Ver el día 2026-03-25', exact: true })
    .click();
  await expect(viewPicker).toHaveAttribute('data-view', 'day');
  await expect(page).toHaveURL(/view=day.*date=2026-03-25/);
  await expect(dateInput).toHaveValue('2026-03-25');
  await expect(mini.locator('.mini__day.is-selected')).toHaveAttribute(
    'aria-label',
    'Ver el día 2026-03-25'
  );

  await page.reload();
  await expect(viewPicker).toHaveAttribute('data-view', 'day');
  await expect(page).toHaveURL(/view=day.*date=2026-03-25/);
  await expect(mini.locator('.mini__day.is-selected')).toHaveAttribute(
    'aria-label',
    'Ver el día 2026-03-25'
  );
});

test('el salto de fecha sincroniza el encabezado y la mini agenda en todas las vistas', async ({
  page
}) => {
  await registerAndGoto(page, '/calendar?view=week&date=2026-10-03');

  const viewPicker = page.locator('[data-test="calendar-view-select"]');
  const dateInput = page.locator('.cal-jump input[type="date"]');
  const cases = [
    { view: 'day', label: 'Día', date: '2026-11-11', month: 'noviembre de 2026' },
    { view: 'fourDays', label: '4 días', date: '2026-12-12', month: 'diciembre de 2026' },
    { view: 'week', label: 'Semana', date: '2027-01-09', month: 'enero de 2027' },
    { view: 'month', label: 'Mes', date: '2027-02-15', month: 'febrero de 2027' },
    { view: 'year', label: 'Año', date: '2027-03-14', month: 'marzo de 2027' },
    { view: 'agenda', label: 'Agenda', date: '2027-04-01', month: 'abril de 2027' }
  ];

  for (const state of cases) {
    await viewPicker.locator('.picker__trigger').click();
    await page.getByRole('option', { name: state.label, exact: true }).click();
    await expect(viewPicker).toHaveAttribute('data-view', state.view);

    await dateInput.fill(state.date);
    await expect.poll(() => new URL(page.url()).searchParams.get('date')).toBe(state.date);
    await expect(viewPicker).toHaveAttribute('data-view', state.view);
    await expect(page.locator('app-calendar-mini-month .mini__head h2')).toHaveText(state.month);
  }
});

test('las capas seleccionadas se conservan al alternar las seis vistas', async ({ page }) => {
  await registerAndGoto(page, '/calendar?view=week&date=2026-10-03&layers=meals,home');

  const viewPicker = page.locator('[data-test="calendar-view-select"]');
  const expectedLayers = [
    ['layer-meals', 'true'],
    ['layer-home', 'true'],
    ['layer-shopping', 'false'],
    ['layer-appointment', 'false'],
    ['layer-personal', 'false'],
    ['layer-other', 'false']
  ];

  for (const label of ['Día', '4 días', 'Semana', 'Mes', 'Año', 'Agenda']) {
    await viewPicker.locator('.picker__trigger').click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('layers')).toBe('meals,home');
    for (const [selector, pressed] of expectedLayers) {
      await expect(page.locator(`[data-test="${selector}"]`)).toHaveAttribute(
        'aria-pressed',
        pressed
      );
    }
  }

  await page.reload();
  for (const [selector, pressed] of expectedLayers) {
    await expect(page.locator(`[data-test="${selector}"]`)).toHaveAttribute(
      'aria-pressed',
      pressed
    );
  }
});

test('atrás y adelante del navegador restauran la vista y el periodo del calendario', async ({
  page
}) => {
  await registerAndGoto(page, '/calendar?view=week&date=2026-10-03');

  const viewPicker = page.locator('[data-test="calendar-view-select"]');
  const expectUrlState = async (view: string, date: string) => {
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return { view: params.get('view') ?? 'week', date: params.get('date') };
      })
      .toEqual({ view, date });
  };
  await viewPicker.locator('.picker__trigger').click();
  await page.getByRole('option', { name: 'Mes', exact: true }).click();
  await expect(viewPicker).toHaveAttribute('data-view', 'month');

  await page.locator('.cal-top__nav .cal-icon-btn').nth(1).click();
  await expectUrlState('month', '2026-11-03');
  await expect(page.locator('h1.calendar__title')).toContainText('noviembre de 2026');

  await page.goBack();
  await expectUrlState('month', '2026-10-03');
  await expect(viewPicker).toHaveAttribute('data-view', 'month');
  await expect(page.locator('h1.calendar__title')).toContainText('octubre de 2026');

  await page.goBack();
  await expectUrlState('week', '2026-10-03');
  await expect(viewPicker).toHaveAttribute('data-view', 'week');
  await expect(page.locator('h1.calendar__title')).toContainText('28 sept');

  await page.goForward();
  await expect(viewPicker).toHaveAttribute('data-view', 'month');
  await expect(page.locator('h1.calendar__title')).toContainText('octubre de 2026');
  await page.goForward();
  await expect(page.locator('h1.calendar__title')).toContainText('noviembre de 2026');
});
