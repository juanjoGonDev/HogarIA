import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from './fixtures';
import { registerAndGoto } from './helpers/auth';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 393, height: 851 },
  { width: 1440, height: 900 }
] as const;

async function createHousehold(page: Page): Promise<void> {
  await page.goto('/household');
  await page.getByRole('button', { name: /Crear hogar/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Crear Hogar' });
  await dialog.getByRole('textbox', { name: 'Nombre del hogar' }).fill('Hogar clipboard sintético');
  await dialog.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.locator('.household-info__name')).toHaveText('Hogar clipboard sintético');
}

async function makeClipboardReject(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('synthetic permission denial')) }
    });
  });
}

async function expectNoHorizontalOverflow(page: Page, width: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
}

async function captureHouseholdError(page: Page): Promise<void> {
  const viewport = test.info().project.name === 'chromium' ? VIEWPORTS[2] : VIEWPORTS[1];
  await page.setViewportSize(viewport);
  const seed = (process.env.E2E_SEED ?? 'local').replace(/[^a-zA-Z0-9_-]/g, '_');
  const file = join(
    process.cwd(),
    '.e2e-screenshots',
    `qa-household-clipboard-errors-${seed}`,
    test.info().project.name,
    'household-copy-error.png'
  );
  await mkdir(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
}

test('clipboard failures show localized errors in Household and Logs without unhandled rejection', async ({
  page
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    (window as Window & { __clipboardRejections?: string[] }).__clipboardRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      (window as Window & { __clipboardRejections?: string[] }).__clipboardRejections?.push(
        String(event.reason)
      );
    });
  });

  await registerAndGoto(page, '/household', 'Clipboard synthetic');
  await createHousehold(page);
  while (await page.locator('.toast__close').count()) {
    await page.locator('.toast__close').first().click();
  }

  const inviteLink = page.locator('.invite-card__code');
  const visibleLink = (await inviteLink.innerText()).trim();
  await makeClipboardReject(page);
  await page.getByRole('button', { name: 'Copiar enlace' }).click();
  const spanishError = page.locator('.toast--error .toast__message');
  await expect(spanishError).toHaveText(
    'No se pudo copiar el enlace. Puedes seleccionarlo y copiarlo manualmente.'
  );
  await expect(page.locator('.toast--success')).toHaveCount(0);
  await expect(inviteLink).toHaveText(visibleLink);
  await captureHouseholdError(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page, viewport.width);
  }

  await page.goto('/settings');
  await page.getByRole('button', { name: 'English' }).click();
  await page.goto('/household');
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await makeClipboardReject(page);
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.locator('.toast--error .toast__message')).toHaveText(
    'Could not copy the invitation link. You can select it and copy it manually.'
  );
  await expect(page.locator('.toast--success')).toHaveCount(0);
  await expect(page.locator('.invite-card__code')).toHaveText(visibleLink);

  const seed = `clipboard-${Date.now()}`;
  const logResponse = await page.request.post('/api/logs', {
    data: { level: 'warn', message: `${seed} synthetic entry`, url: 'e2e' }
  });
  expect(logResponse.ok()).toBeTruthy();
  await page.goto('/logs');
  await expect(page.locator('.terminal__line', { hasText: seed })).toBeVisible();
  await makeClipboardReject(page);
  await page.getByRole('button', { name: 'Copy everything' }).click();
  await expect(page.locator('.toast--error .toast__message')).toHaveText(
    'Could not copy to the clipboard'
  );
  await expect(page.locator('.toast--success')).toHaveCount(0);

  const unhandled = await page.evaluate(
    () => (window as Window & { __clipboardRejections?: string[] }).__clipboardRejections ?? []
  );
  expect(unhandled).toEqual([]);
  expect(pageErrors).toEqual([]);
});
