import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { selectCalendarView } from './helpers/calendar-ui';

const isoOf = (date: Date): string =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;

function mondayOfIsoWeek(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

async function addMeal(page: Page, title: string): Promise<void> {
  const nextMonday = new Date();
  nextMonday.setDate(nextMonday.getDate() + 7);
  await page.locator('input[type="date"]').fill(mondayOfIsoWeek(isoOf(nextMonday)));
  await page.locator('[data-test="timeline-add-meal"]').first().click();
  await page.locator('#meal-custom').fill(title);
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0);
  await expect(
    page.locator('[data-test="timeline-block-meal"]').filter({ hasText: title })
  ).toHaveCount(1);
}

async function openMealFromTimeline(page: Page, title: string): Promise<void> {
  const meal = page.locator('[data-test="timeline-block-meal"]').filter({ hasText: title });
  await expect(meal).toHaveCount(1);
  await meal.click();
}

async function openMealFromRow(page: Page, title: string): Promise<void> {
  const meal = page.locator('app-calendar-event').filter({ hasText: title });
  await expect(meal).toHaveCount(1);
  await meal.locator('.cal-event__open').click();
}

function isMealCompletionPatch(
  response: {
    url(): string;
    request(): { method(): string; postDataJSON(): unknown };
  },
  completed: boolean
): boolean {
  if (response.request().method() !== 'PATCH') return false;
  const pathname = new URL(response.url()).pathname;
  if (!/^\/api\/calendar\/meals\/[^/]+$/.test(pathname)) return false;
  return (response.request().postDataJSON() as { completed?: boolean }).completed === completed;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
}

async function expectMealEditorActionsFit(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Editar Comida' });
  const dialogBounds = await dialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  const buttons = dialog.locator('.meal-edit-actions > button.cal-btn');
  await expect(buttons).toHaveCount(3);
  const actionBounds = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    })
  );

  for (const bounds of actionBounds) {
    expect(bounds.left).toBeGreaterThanOrEqual((dialogBounds?.x ?? 0) - 1);
    expect(bounds.right).toBeLessThanOrEqual(
      (dialogBounds?.x ?? 0) + (dialogBounds?.width ?? 0) + 1
    );
  }
  for (let first = 0; first < actionBounds.length; first += 1) {
    for (let second = first + 1; second < actionBounds.length; second += 1) {
      const a = actionBounds[first];
      const b = actionBounds[second];
      const overlap = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      expect(overlap).toBe(false);
    }
  }
}

async function saveSyntheticScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  const dismissToast = page.getByRole('button', { name: 'Descartar' }).first();
  if (await dismissToast.isVisible()) await dismissToast.click();
  const directory = resolve(process.cwd(), '.e2e-screenshots', 'qa-calendar-meal-completion');
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${testInfo.project.name}.png`),
    fullPage: true
  });
}

test('the meal editor exposes completion from day, week, month and agenda views', async ({
  page
}) => {
  await registerAndGoto(page, '/calendar');
  await expect(page.locator('h1.calendar__title')).toBeVisible();

  const title = 'Comida sintética para completar';
  await addMeal(page, title);

  const views = [
    { value: 'week', label: 'Semana', timeline: true },
    { value: 'day', label: 'Día', timeline: true },
    { value: 'month', label: 'Mes', timeline: false },
    { value: 'agenda', label: 'Agenda', timeline: false }
  ] as const;

  for (const view of views) {
    await selectCalendarView(page, view.value, view.label);
    if (view.timeline) await openMealFromTimeline(page, title);
    else await openMealFromRow(page, title);

    const editor = page.locator('app-modal:has(#meal-custom)');
    await expect(editor.locator('.modal__title')).toContainText('Editar Comida');
    const completion = editor.getByRole('button', { name: 'Marcar como hecha', exact: true });
    await expect(completion).toBeVisible();
    await expect(completion).toHaveAttribute('aria-pressed', 'false');

    await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  }
});

test('completion is optimistic, accessible, recoverable, and persists without duplicating meals', async ({
  page
}, testInfo) => {
  const nominalViewport =
    testInfo.project.name === 'mobile-chrome'
      ? { width: 393, height: 851 }
      : { width: 1440, height: 900 };
  await page.setViewportSize(nominalViewport);
  await registerAndGoto(page, '/calendar');

  const title = 'Comida sintética para persistir completado';
  await addMeal(page, title);
  await selectCalendarView(page, 'week', 'Semana');
  await openMealFromTimeline(page, title);

  const editor = page.locator('app-modal:has(#meal-custom)');
  let toggle = editor.getByRole('button', { name: 'Marcar como hecha', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const geometryViewports =
    testInfo.project.name === 'chromium'
      ? [
          { width: 1440, height: 900 },
          { width: 320, height: 568 },
          { width: 393, height: 851 },
          { width: 479, height: 851 },
          { width: 480, height: 851 },
          { width: 481, height: 851 }
        ]
      : [
          { width: 393, height: 851 },
          { width: 320, height: 568 }
        ];
  for (const viewport of geometryViewports) {
    await page.setViewportSize(viewport);
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect
      .poll(async () => (await toggle.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
    const targetBounds = await toggle.boundingBox();
    expect(targetBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(targetBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expectMealEditorActionsFit(page);
  }

  await page.setViewportSize(nominalViewport);
  await toggle.evaluate((button) => button.blur());
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await toggle.evaluate((button) => button === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(toggle).toBeFocused();
  expect(await toggle.evaluate((button) => button.matches(':focus-visible'))).toBe(true);

  let releaseMark!: () => void;
  let markRequestStarted!: () => void;
  const markGate = new Promise<void>((resolveGate) => (releaseMark = resolveGate));
  const markStarted = new Promise<void>((resolveStarted) => (markRequestStarted = resolveStarted));
  let holdMark = true;
  let failNextUnmark = true;

  await page.route('**/api/calendar/meals/*', async (route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') {
      await route.continue();
      return;
    }

    const body = request.postDataJSON() as { completed?: boolean };
    if (body.completed === true && holdMark) {
      holdMark = false;
      markRequestStarted();
      await markGate;
      await route.continue();
      return;
    }

    if (body.completed === false && failNextUnmark) {
      failNextUnmark = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Synthetic temporary outage' })
      });
      return;
    }

    await route.continue();
  });

  try {
    const markResponsePromise = page.waitForResponse((response) =>
      isMealCompletionPatch(response, true)
    );
    await page.keyboard.press('Enter');
    await markStarted;
    toggle = editor.getByRole('button', { name: 'Quitar de hechas', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toBeFocused();

    releaseMark();
    expect((await markResponsePromise).status()).toBe(200);
    await expect(
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: title })
    ).toHaveCount(1);
    await saveSyntheticScreenshot(page, testInfo);

    await page.reload();
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await openMealFromTimeline(page, title);
    const reloadedEditor = page.getByRole('dialog', { name: 'Editar Comida' });
    toggle = reloadedEditor.getByRole('button', { name: 'Quitar de hechas', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toBeVisible();

    const failedUnmarkResponse = page.waitForResponse((response) =>
      isMealCompletionPatch(response, false)
    );
    await toggle.click();
    expect((await failedUnmarkResponse).status()).toBe(503);
    toggle = reloadedEditor.getByRole('button', { name: 'Quitar de hechas', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(reloadedEditor).toBeVisible();

    const retryResponse = page.waitForResponse((response) =>
      isMealCompletionPatch(response, false)
    );
    await toggle.click();
    expect((await retryResponse).status()).toBe(200);
    toggle = reloadedEditor.getByRole('button', { name: 'Marcar como hecha', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: title })
    ).toHaveCount(1);

    await page.reload();
    await expect(page.locator('h1.calendar__title')).toBeVisible();
    await openMealFromTimeline(page, title);
    toggle = page
      .getByRole('dialog', { name: 'Editar Comida' })
      .getByRole('button', { name: 'Marcar como hecha', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.locator('[data-test="timeline-block-meal"]').filter({ hasText: title })
    ).toHaveCount(1);
  } finally {
    releaseMark();
  }
});
