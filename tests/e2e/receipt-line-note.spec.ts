import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Locator, Page, TestInfo, expect } from '@playwright/test';
import { test } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token).toBeTruthy();
  return token as string;
}

function seedReceipts(databasePath: string, runDirectory: string, userId: string) {
  const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
  if (isAbsolute(relativeDatabasePath) || relativeDatabasePath.startsWith('..')) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test');
  }

  const reviewId = `receipt-note-${randomUUID()}`;
  const confirmedId = `receipt-note-confirmed-${randomUUID()}`;
  const createdAt = new Date('2026-10-09T00:00:00.000Z').toISOString();
  const database = new Database(databasePath);
  try {
    const insertReceipt = database.prepare(
      `INSERT INTO receipts (
        id, user_id, status, store, purchase_date, currency, total_minor,
        file_url, file_kind, file_name, file_bytes, created_at, confirmed_at
      ) VALUES (?, ?, ?, 'Mercado QA', '2026-10-09', 'EUR', 350, ?, 'png', ?, 8, ?, ?)`
    );
    const insertLine = database.prepare(
      `INSERT INTO receipt_items (
        id, receipt_id, name, quantity, unit, category, price_minor,
        offer_buy, offer_take, note, confidence, position
      ) VALUES (?, ?, 'Producto QA', 1, 'ud', 'other', 350, NULL, NULL, ?, 0.99, 0)`
    );

    insertReceipt.run(
      reviewId,
      userId,
      'review',
      `/api/uploads/receipts/${reviewId}.png`,
      'ticket-note-review.png',
      createdAt,
      null
    );
    insertLine.run(`${reviewId}-line`, reviewId, 'Nota reconocida');
    insertReceipt.run(
      confirmedId,
      userId,
      'confirmed',
      `/api/uploads/receipts/${confirmedId}.png`,
      'ticket-note-confirmed.png',
      createdAt,
      createdAt
    );
    insertLine.run(`${confirmedId}-line`, confirmedId, 'Nota bloqueada');
  } finally {
    database.close();
  }

  return { reviewId, confirmedId, reviewLineId: `${reviewId}-line` };
}

async function expectNoHorizontalOverflow(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content, `sin overflow a ${width}×${height}`).toBeLessThanOrEqual(
    dimensions.viewport
  );
}

async function expectMobileTouchTargets(page: Page) {
  const inputs = page.locator('.tabla__fila input.linea__input');
  const count = await inputs.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const bounds = await inputs.nth(index).boundingBox();
    expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoOverlappingLineInputs(page: Page) {
  const overlaps = await page.locator('.tabla__fila input.linea__input').evaluateAll((inputs) => {
    const bounds = inputs.map((input) => {
      const rect = input.getBoundingClientRect();
      return {
        id: input.id,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      };
    });
    const collisions: { first: string; second: string }[] = [];
    for (let first = 0; first < bounds.length; first += 1) {
      for (let second = first + 1; second < bounds.length; second += 1) {
        const a = bounds[first]!;
        const b = bounds[second]!;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
          collisions.push({ first: a.id, second: b.id });
        }
      }
    }
    return collisions;
  });
  expect(overlaps, `Los campos de línea no deben solaparse: ${JSON.stringify(overlaps)}`).toEqual(
    []
  );
}

async function expectAccessibleNamesNotToAffectGeometry(page: Page, ids: string[]) {
  const labels = await page.evaluate(
    (inputIds) =>
      inputIds.map((id) => document.getElementById(id)?.getAttribute('aria-label') ?? null),
    ids
  );
  expect(labels.every((label) => label !== null)).toBe(true);

  const captureGeometry = () =>
    page.evaluate((inputIds) => {
      return inputIds.map((id) => {
        const input = document.getElementById(id);
        if (!(input instanceof HTMLElement)) throw new Error(`No existe el control ${id}`);
        const rect = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          marginTop: style.marginTop,
          marginRight: style.marginRight,
          marginBottom: style.marginBottom,
          marginLeft: style.marginLeft,
          paddingTop: style.paddingTop,
          paddingRight: style.paddingRight,
          paddingBottom: style.paddingBottom,
          paddingLeft: style.paddingLeft
        };
      });
    }, ids);

  const before = await captureGeometry();
  await page.evaluate((inputIds) => {
    for (const id of inputIds) document.getElementById(id)?.removeAttribute('aria-label');
  }, ids);
  const withoutNames = await captureGeometry();
  await page.evaluate(
    ({ inputIds, savedLabels }) => {
      inputIds.forEach((id, index) => {
        const label = savedLabels[index];
        if (label !== null && label !== undefined) {
          document.getElementById(id)?.setAttribute('aria-label', label);
        }
      });
    },
    { inputIds: ids, savedLabels: labels }
  );

  for (const [index, original] of before.entries()) {
    const next = withoutNames[index]!;
    for (const key of Object.keys(original) as (keyof typeof original)[]) {
      const originalValue = original[key];
      const nextValue = next[key];
      if (typeof originalValue === 'number' && typeof nextValue === 'number') {
        expect(Math.abs(originalValue - nextValue)).toBeLessThanOrEqual(1);
      } else {
        expect(nextValue).toBe(originalValue);
      }
    }
  }
}

async function expectReadableNote(note: Locator) {
  const ratios = await note.evaluate((element) => {
    const root = document.documentElement;
    const originalTheme = root.getAttribute('data-theme');
    const parseColor = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    const luminance = (channels: number[]) => {
      const linear = channels.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const contrastForTheme = (theme: 'light' | 'dark') => {
      if (theme === 'dark') root.setAttribute('data-theme', theme);
      else root.removeAttribute('data-theme');

      const foreground = parseColor(getComputedStyle(element).color);
      let ancestor: HTMLElement | null = element as HTMLElement;
      let background: number[] = [];
      while (ancestor) {
        const candidate = parseColor(getComputedStyle(ancestor).backgroundColor);
        if (candidate.length >= 3 && (candidate[3] ?? 1) > 0.99) {
          background = candidate;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    };

    try {
      return {
        light: contrastForTheme('light'),
        dark: contrastForTheme('dark'),
        placeholderOpacity: getComputedStyle(element, '::placeholder').opacity
      };
    } finally {
      if (originalTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', originalTheme);
    }
  });

  expect(ratios.light).toBeGreaterThanOrEqual(4.5);
  expect(ratios.dark).toBeGreaterThanOrEqual(4.5);
  expect(ratios.placeholderOpacity).toBe('1');
}

async function guardarCaptura(page: Page, testInfo: TestInfo, language: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputPath('screenshots');
  mkdirSync(directory, { recursive: true });
  await page.locator('.tabla').screenshot({
    path: join(directory, `receipt-line-note-${testInfo.project.name}-${language}.png`),
    animations: 'disabled'
  });
}

async function guardarCapturaUnidadOferta(page: Page, testInfo: TestInfo, language: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputPath('screenshots');
  mkdirSync(directory, { recursive: true });
  await page.locator('.tabla').screenshot({
    path: join(directory, `receipt-line-unit-offer-${testInfo.project.name}-${language}.png`),
    animations: 'disabled'
  });
}

async function guardarCapturaCantidadPrecio(page: Page, testInfo: TestInfo, language: string) {
  const directory = process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputPath('screenshots');
  mkdirSync(directory, { recursive: true });
  await page.locator('.tabla').screenshot({
    path: join(directory, `receipt-line-quantity-price-${testInfo.project.name}-${language}.png`),
    animations: 'disabled'
  });
}

test.describe('edición de nota de línea del ticket', () => {
  for (const scenario of [
    {
      language: 'es',
      noteLabel: 'Nota de Producto QA',
      notePlaceholder: 'Añadir nota…',
      errorText: 'No se pudo completar la operación.'
    },
    {
      language: 'en',
      noteLabel: 'Note for Producto QA',
      notePlaceholder: 'Add a note…',
      errorText: "Couldn't complete the operation."
    }
  ]) {
    test(`permite crear, corregir y borrar la nota (${scenario.language})`, async ({
      page
    }, info) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await registerAndGoto(page, '/receipts');
      await page.evaluate((language) => {
        window.localStorage.setItem('hogar:v1:language', language);
      }, scenario.language);
      await page.reload();

      const token = await tokenOf(page);
      const profileResponse = await page.request.get('/api/auth/profile', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(profileResponse.ok()).toBeTruthy();
      const profile = (await profileResponse.json()) as { data: { id: string } };
      const runDirectory = process.env.E2E_RUN_DIR;
      const databasePath = process.env.DATABASE_PATH;
      if (!runDirectory || !databasePath) throw new Error('E2E requiere rutas temporales aisladas');
      const { reviewId, confirmedId, reviewLineId } = seedReceipts(
        databasePath,
        runDirectory,
        profile.data.id
      );

      await page.goto(`/receipts/${reviewId}`);
      const note = page.getByLabel(scenario.noteLabel, { exact: true });
      await expect(note).toHaveValue('Nota reconocida');
      await expect(note).not.toHaveAttribute('maxlength');
      await expect(note).toHaveAttribute('placeholder', scenario.notePlaceholder);
      await expectReadableNote(note);
      await note.focus();
      await expect(note).toBeFocused();
      expect(await note.evaluate((element) => getComputedStyle(element).borderColor)).not.toBe(
        'rgba(0, 0, 0, 0)'
      );

      const linePath = `/api/receipts/${reviewId}/items/${reviewLineId}`;
      const saveNote = async (value: string, expectedNote: string | null) => {
        const patch = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === linePath && response.request().method() === 'PATCH'
        );
        await note.fill(value);
        await note.press('Tab');
        const response = await patch;
        expect(response.status()).toBe(200);
        const body = response.request().postDataJSON() as { note?: string | null };
        expect(body.note).toBe(expectedNote);
        const detailResponse = await page.request.get(`/api/receipts/${reviewId}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect((await detailResponse.json()).data.lines[0].note).toBe(expectedNote);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
      };

      await saveNote('Nota corregida', 'Nota corregida');

      if (info.project.name === 'chromium') {
        await expectNoHorizontalOverflow(page, 1440, 900);
        await expect(note).toBeVisible();
        await guardarCaptura(page, info, scenario.language);
        await expectNoHorizontalOverflow(page, 320, 740);
        await expectMobileTouchTargets(page);
      } else {
        await expectNoHorizontalOverflow(page, 390, 844);
        await expect(note).toBeVisible();
        await expectMobileTouchTargets(page);
        await guardarCaptura(page, info, scenario.language);
        await expectNoHorizontalOverflow(page, 320, 740);
        await expectMobileTouchTargets(page);
      }

      const longNote = 'Nota sintética de revisión. '.repeat(100).trimEnd();
      expect(longNote.length).toBeGreaterThan(2500);
      await saveNote(longNote, longNote);
      await expect(note).toHaveValue(longNote);

      await saveNote('', null);
      await page.reload();
      await expect(note).toHaveValue('');

      await page.route(`**${linePath}`, (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'SYNTHETIC_FAILURE' })
        })
      );
      const failedPatch = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === linePath && response.request().method() === 'PATCH'
      );
      await note.fill('Borrador conservado');
      await note.press('Tab');
      expect((await failedPatch).status()).toBe(503);
      await expect(note).toHaveValue('Borrador conservado');
      await expect(
        page.locator('.toast--error').filter({ hasText: scenario.errorText })
      ).toBeVisible();
      await page.unroute(`**${linePath}`);

      await page.goto(`/receipts/${confirmedId}`);
      await expect(page.getByText('Nota bloqueada', { exact: true })).toBeVisible();
      await expect(page.getByLabel(scenario.noteLabel, { exact: true })).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    });
  }
});

test.describe('edición de unidad y oferta en línea de ticket', () => {
  for (const scenario of [
    { language: 'es', unitLabel: 'Unidad: Producto QA', offerLabel: 'Oferta: Producto QA' },
    { language: 'en', unitLabel: 'Unit: Producto QA', offerLabel: 'Offer: Producto QA' }
  ]) {
    test(`persiste unidad y oferta con controles accesibles (${scenario.language})`, async ({
      page
    }, info) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await registerAndGoto(page, '/receipts');
      await page.evaluate((language) => {
        window.localStorage.setItem('hogar:v1:language', language);
      }, scenario.language);
      await page.reload();

      const token = await tokenOf(page);
      const profileResponse = await page.request.get('/api/auth/profile', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(profileResponse.ok()).toBeTruthy();
      const profile = (await profileResponse.json()) as { data: { id: string } };
      const runDirectory = process.env.E2E_RUN_DIR;
      const databasePath = process.env.DATABASE_PATH;
      if (!runDirectory || !databasePath) throw new Error('E2E requiere rutas temporales aisladas');
      const { reviewId, confirmedId, reviewLineId } = seedReceipts(
        databasePath,
        runDirectory,
        profile.data.id
      );

      await page.goto(`/receipts/${reviewId}`);
      const unit = page.getByLabel(scenario.unitLabel, { exact: true });
      const offer = page.getByLabel(scenario.offerLabel, { exact: true });
      await expect(unit).toHaveValue('ud');
      await expect(offer).toHaveValue('');

      const linePath = `/api/receipts/${reviewId}/items/${reviewLineId}`;
      const unitId = `linea-${reviewLineId}-unidad`;
      const offerId = `linea-${reviewLineId}-oferta`;
      const editableFieldIds = [unitId, offerId];
      const saveAndRead = async (
        field: Locator,
        value: string,
        expectedPatch: Record<string, unknown>,
        expectedLine: Record<string, unknown>
      ) => {
        const patch = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === linePath && response.request().method() === 'PATCH'
        );
        await field.fill(value);
        await field.press('Tab');
        const response = await patch;
        expect(response.status()).toBe(200);
        expect(response.request().postDataJSON()).toEqual(expectedPatch);

        const detailResponse = await page.request.get(`/api/receipts/${reviewId}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect(detailResponse.status()).toBe(200);
        const detail = (await detailResponse.json()) as {
          data: { lines: (Record<string, unknown> & { id: string })[] };
        };
        expect(detail.data.lines.find((line) => line.id === reviewLineId)).toMatchObject(
          expectedLine
        );
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
      };

      await saveAndRead(unit, 'pack', { unit: 'pack' }, { unit: 'pack' });
      await saveAndRead(
        offer,
        '3x2',
        { offer: { buy: 3, take: 2 } },
        {
          unit: 'pack',
          offer: { buy: 3, take: 2 }
        }
      );
      await page.reload();
      await expect(unit).toHaveValue('pack');
      await expect(offer).toHaveValue('3x2');

      if (info.project.name === 'chromium') {
        await expectNoHorizontalOverflow(page, 1440, 900);
        await expect(unit).toBeVisible();
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await guardarCapturaUnidadOferta(page, info, scenario.language);
        await expectNoHorizontalOverflow(page, 320, 740);
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await expectMobileTouchTargets(page);
      } else {
        await expectNoHorizontalOverflow(page, 390, 844);
        await expect(unit).toBeVisible();
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await expectMobileTouchTargets(page);
        await guardarCapturaUnidadOferta(page, info, scenario.language);
        await expectNoHorizontalOverflow(page, 320, 740);
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await expectMobileTouchTargets(page);
      }

      await saveAndRead(unit, '', { unit: null }, { unit: null, offer: { buy: 3, take: 2 } });
      await saveAndRead(offer, '', { offer: null }, { unit: null, offer: null });
      await saveAndRead(offer, 'oferta inválida', { offer: null }, { offer: null });
      await page.reload();
      await expect(unit).toHaveValue('');
      await expect(offer).toHaveValue('');

      await page.goto(`/receipts/${confirmedId}`);
      await expect(page.getByLabel(scenario.unitLabel, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(scenario.offerLabel, { exact: true })).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    });
  }
});

test.describe('edición de cantidad y precio en línea de ticket', () => {
  for (const scenario of [
    {
      language: 'es',
      quantityLabel: 'Cantidad: Producto QA',
      priceLabel: 'Precio: Producto QA'
    },
    {
      language: 'en',
      quantityLabel: 'Quantity: Producto QA',
      priceLabel: 'Price: Producto QA'
    }
  ]) {
    test(`persiste cantidad y precio con controles accesibles (${scenario.language})`, async ({
      page
    }, info) => {
      test.skip(info.project.name === 'mobile-safari', 'La matriz de esta subunidad usa Chromium');
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await registerAndGoto(page, '/receipts');
      await page.evaluate((language) => {
        window.localStorage.setItem('hogar:v1:language', language);
      }, scenario.language);
      await page.reload();

      const token = await tokenOf(page);
      const profileResponse = await page.request.get('/api/auth/profile', {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(profileResponse.ok()).toBeTruthy();
      const profile = (await profileResponse.json()) as { data: { id: string } };
      const runDirectory = process.env.E2E_RUN_DIR;
      const databasePath = process.env.DATABASE_PATH;
      if (!runDirectory || !databasePath) throw new Error('E2E requiere rutas temporales aisladas');
      const { reviewId, confirmedId, reviewLineId } = seedReceipts(
        databasePath,
        runDirectory,
        profile.data.id
      );

      await page.goto(`/receipts/${reviewId}`);
      const quantity = page.getByLabel(scenario.quantityLabel, { exact: true });
      const price = page.getByLabel(scenario.priceLabel, { exact: true });
      await expect(quantity).toHaveValue('1');
      await expect(price).toHaveValue('3.50');
      for (const field of [quantity, price]) {
        await expect(field).toHaveAttribute('type', 'number');
        await expect(field).toHaveAttribute('inputmode', 'decimal');
      }

      const linePath = `/api/receipts/${reviewId}/items/${reviewLineId}`;
      const quantityId = `linea-${reviewLineId}-cantidad`;
      const priceId = `linea-${reviewLineId}-precio`;
      const editableFieldIds = [quantityId, priceId];
      const saveAndRead = async (
        field: Locator,
        value: string,
        expectedPatch: Record<string, unknown>,
        expectedLine: Record<string, unknown>
      ) => {
        const patch = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === linePath && response.request().method() === 'PATCH'
        );
        await field.fill(value);
        await field.press('Tab');
        const response = await patch;
        expect(response.status()).toBe(200);
        expect(response.request().postDataJSON()).toEqual(expectedPatch);

        const detailResponse = await page.request.get(`/api/receipts/${reviewId}`, {
          headers: { authorization: `Bearer ${token}` }
        });
        expect(detailResponse.status()).toBe(200);
        const detail = (await detailResponse.json()) as {
          data: { lines: (Record<string, unknown> & { id: string })[] };
        };
        expect(detail.data.lines.find((line) => line.id === reviewLineId)).toMatchObject(
          expectedLine
        );
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
      };

      await saveAndRead(quantity, '1.5', { quantity: 1.5 }, { quantity: 1.5 });
      await saveAndRead(price, '2.00', { priceMinor: 200 }, { priceMinor: 200 });
      await page.reload();
      await expect(quantity).toHaveValue('1.5');
      await expect(price).toHaveValue('2.00');

      if (info.project.name === 'chromium') {
        await expectNoHorizontalOverflow(page, 1440, 900);
        await expect(quantity).toBeVisible();
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await guardarCapturaCantidadPrecio(page, info, scenario.language);
        await expectNoHorizontalOverflow(page, 393, 851);
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await expectMobileTouchTargets(page);
        await expectNoOverlappingLineInputs(page);
        await expectNoHorizontalOverflow(page, 320, 568);
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await expectMobileTouchTargets(page);
        await expectNoOverlappingLineInputs(page);
      } else {
        await expectNoHorizontalOverflow(page, 393, 851);
        await expect(quantity).toBeVisible();
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await expectMobileTouchTargets(page);
        await expectNoOverlappingLineInputs(page);
        await guardarCapturaCantidadPrecio(page, info, scenario.language);
        await expectNoHorizontalOverflow(page, 320, 568);
        await expectAccessibleNamesNotToAffectGeometry(page, editableFieldIds);
        await expectMobileTouchTargets(page);
        await expectNoOverlappingLineInputs(page);
      }

      await page.goto(`/receipts/${confirmedId}`);
      await expect(page.getByLabel(scenario.quantityLabel, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(scenario.priceLabel, { exact: true })).toHaveCount(0);
      expect(pageErrors).toEqual([]);
    });
  }
});
