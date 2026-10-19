import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createHousehold, registerAndGoto, registerUser } from './helpers/auth';
import { waitForStableView } from './helpers/recipe-fixtures';

test.use({ serviceWorkers: 'block', locale: 'es-ES' });

type QueueProviderFixture = {
  suffix: string;
  name: string;
  concurrency: number;
  jobs: Array<'queued' | 'running' | 'failed'>;
};

type QueueProvider = { id: string; name: string };

function seedQueues(email: string, providers: QueueProviderFixture[]): QueueProvider[] {
  const runDirectory = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDirectory || !databasePath) throw new Error('E2E requiere SQLite temporal aislado.');
  const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
  if (
    !relativeDatabasePath ||
    isAbsolute(relativeDatabasePath) ||
    relativeDatabasePath === '..' ||
    relativeDatabasePath.startsWith(`..${sep}`)
  ) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test.');
  }

  const db = new Database(databasePath);
  try {
    const user = db
      .prepare('SELECT id, household_id AS householdId FROM users WHERE email = ?')
      .get(email) as { id: string; householdId: string | null } | undefined;
    if (!user) throw new Error('No se encontró la cuenta sintética del Dashboard.');

    return providers.map((provider) => {
      const configId = `dashboard-queue-${user.id}-${provider.suffix}`;
      db.prepare(
        `INSERT INTO ai_configs
          (id, user_id, household_id, name, provider, base_url, api_key, model,
           temperature, max_tokens, timeout, retry_attempts, concurrency, is_active)
         VALUES (?, ?, ?, ?, 'custom', 'http://127.0.0.1:9/v1', '',
           'fixture-model', 0.7, 256, 1000, 0, ?, 0)`
      ).run(configId, user.id, user.householdId, provider.name, provider.concurrency);

      const insertJob = db.prepare(
        `INSERT INTO ai_jobs
          (id, user_id, household_id, config_id, kind, status, attempts, max_attempts, queue_order)
         VALUES (?, ?, ?, ?, 'recipe', ?, 0, 3, ?)`
      );
      provider.jobs.forEach((status, index) =>
        insertJob.run(
          `${configId}-${status}-${index}`,
          user.id,
          user.householdId,
          configId,
          status,
          index
        )
      );
      return { id: configId, name: provider.name };
    });
  } finally {
    db.close();
  }
}

async function joinHome(page: Page, inviteUrl: string): Promise<void> {
  const inviteCode = new URL(inviteUrl).pathname.split('/').at(-1);
  expect(inviteCode).toBeTruthy();
  await page.goto('/household');
  await page.getByRole('button', { name: /Unirse con código/i }).click();
  const joinDialog = page.getByRole('dialog', { name: 'Unirse a un Hogar' });
  await joinDialog.getByRole('textbox', { name: 'Código de invitación' }).fill(inviteCode!);
  await joinDialog.getByRole('button', { name: 'Unirse', exact: true }).click();
  await expect(page.locator('.household-info__name')).toBeVisible();
}

function skipSafari(testInfo: { project: { name: string } }): void {
  test.skip(testInfo.project.name === 'mobile-safari', 'esta unidad valida Chromium y Pixel 5');
}

test('resume las colas por proveedor, recupera fallos y navega con teclado o toque', async ({
  page
}, testInfo) => {
  skipSafari(testInfo);
  const paths: string[] = [];
  const providerCalls: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    paths.push(url.pathname);
    if (url.hostname === '127.0.0.1' && url.port === '9') providerCalls.push(url.href);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const email = await registerAndGoto(page, '/dashboard', 'Dashboard AI queue');
  const [main, flaky, unlimited] = seedQueues(email, [
    {
      suffix: 'main',
      name: 'Proveedor sintético',
      concurrency: 1,
      jobs: ['queued', 'running', 'failed']
    },
    { suffix: 'flaky', name: 'Proveedor parcial', concurrency: 1, jobs: ['failed'] },
    { suffix: 'unlimited', name: 'Sin gestor de cola', concurrency: 0, jobs: ['queued'] }
  ]);

  let allowFlakyQueue = false;
  await page.route(`**/api/ai/configs/${flaky.id}/queue`, async (route) => {
    if (allowFlakyQueue) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'synthetic queue read failure' })
    });
  });
  await page.reload();

  const summary = page.locator('[data-test="dashboard-ai-queue"]');
  await expect(summary).toBeVisible();
  const mainLink = summary.locator('[data-test="dashboard-ai-queue-link"]').filter({
    hasText: main.name
  });
  await expect(mainLink).toHaveCount(1);
  await expect(mainLink).toContainText('En espera: 1 · En curso: 1 · Fallidos: 1');
  await expect(summary.locator('[data-test="dashboard-ai-queue-link"]')).toHaveCount(1);
  await expect(summary.locator('[data-test="dashboard-ai-queue-provider-error"]')).toContainText(
    flaky.name
  );
  await expect(summary).not.toContainText(unlimited.name);

  const retry = summary.locator(`[data-test="dashboard-ai-queue-provider-retry-${flaky.id}"]`);
  await expect(retry).toBeVisible();
  allowFlakyQueue = true;
  await retry.click();
  const flakyLink = summary.locator('[data-test="dashboard-ai-queue-link"]').filter({
    hasText: flaky.name
  });
  await expect(flakyLink).toBeVisible();
  await expect(flakyLink).toContainText('Fallidos: 1');

  const screenshotDirectory =
    process.env.E2E_SCREENSHOT_DIR ?? '.e2e-screenshots/dashboard-ai-queue';
  const viewports = [
    { width: 320, height: 568 },
    { width: 393, height: 851 },
    { width: 568, height: 320 },
    { width: 1440, height: 900 }
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await mainLink.scrollIntoViewIfNeeded();
    await waitForStableView(page);
    const geometry = await page.evaluate(() => {
      const link = document.querySelector<HTMLElement>('[data-test="dashboard-ai-queue-link"]');
      const rect = link?.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>('.bottom-nav');
      const navRect = nav?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        card: rect
          ? { left: rect.left, right: rect.right, bottom: rect.bottom, height: rect.height }
          : null,
        navTop: navRect?.top ?? Number.POSITIVE_INFINITY,
        navVisible: Boolean(nav && getComputedStyle(nav).display !== 'none')
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.card).not.toBeNull();
    expect(geometry.card!.left).toBeGreaterThanOrEqual(0);
    expect(geometry.card!.right).toBeLessThanOrEqual(viewport.width);
    expect(geometry.card!.height).toBeGreaterThanOrEqual(44);
    if (geometry.navVisible) expect(geometry.card!.bottom).toBeLessThanOrEqual(geometry.navTop);

    if (
      (testInfo.project.use.isMobile && viewport.width === 393) ||
      (!testInfo.project.use.isMobile && viewport.width === 1440)
    ) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: join(screenshotDirectory, `dashboard-ai-queue-${testInfo.project.name}.png`),
        fullPage: false,
        animations: 'disabled'
      });
    }
  }

  const linkAfterResize = summary.locator('[data-test="dashboard-ai-queue-link"]').filter({
    hasText: main.name
  });
  if (testInfo.project.use.isMobile) {
    await linkAfterResize.tap();
  } else {
    await linkAfterResize.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(linkAfterResize).toBeFocused();
    const focusStyle = await linkAfterResize.evaluate(
      (element) => getComputedStyle(element).outlineStyle
    );
    expect(focusStyle).not.toBe('none');
    await linkAfterResize.press('Enter');
  }
  await expect(page).toHaveURL(new RegExp(`/ai-config/${main.id}/queue$`));
  await expect(page.locator('[data-test="ai-queue-job-queued"]')).toHaveCount(1);
  await expect(page.locator('[data-test="ai-queue-job-running"]')).toHaveCount(1);
  await expect(page.locator('[data-test="ai-queue-job-failed"]')).toHaveCount(1);

  await page.goto('/dashboard');
  await page.evaluate(() => window.localStorage.setItem('hogar:v1:language', 'en'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'AI jobs' })).toBeVisible();
  await expect(
    page.locator('[data-test="dashboard-ai-queue-link"]').filter({ hasText: main.name })
  ).toContainText('Waiting: 1 · Running: 1 · Failed: 1');
  expect(paths).toContain(`/api/ai/configs/${main.id}/queue`);
  expect(paths).toContain(`/api/ai/configs/${flaky.id}/queue`);
  expect(paths).not.toContain(`/api/ai/configs/${unlimited.id}/queue`);
  expect(paths.some((path) => /\/api\/ai\/(?:recipes|generate|weekly-plan)/.test(path))).toBe(
    false
  );
  expect(providerCalls).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('no revela la cola a miembros sin permiso de configuración, ni por API directa', async ({
  page,
  browser
}, testInfo) => {
  skipSafari(testInfo);
  const adminEmail = await registerUser(page, 'Admin sintético cola IA');
  await createHousehold(page, 'Casa sintética cola IA');
  const inviteUrl = (await page.locator('.invite-card__code').innerText()).trim();
  const [provider] = seedQueues(adminEmail, [
    { suffix: 'protected', name: 'Proveedor protegido', concurrency: 1, jobs: ['queued'] }
  ]);

  const memberContext = await browser.newContext({ locale: 'es-ES' });
  const memberPage = await memberContext.newPage();
  try {
    await registerUser(memberPage, 'Miembro sin permiso IA');
    await joinHome(memberPage, inviteUrl);

    const queueReads: string[] = [];
    memberPage.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/ai/configs' || path.includes('/api/ai/configs/')) queueReads.push(path);
    });
    await memberPage.goto('/dashboard');
    await expect(memberPage.locator('[data-test="dashboard-ai-queue"]')).toHaveCount(0);
    expect(queueReads).toEqual([]);

    const token = await memberPage.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
    expect(token).toBeTruthy();
    const response = await memberPage.request.get(`/api/ai/configs/${provider.id}/queue`, {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SETTINGS_REQUIRED'
    });

    await memberPage.goto(`/ai-config/${provider.id}/queue`);
    await expect(memberPage).toHaveURL(/\/household\?tab=settings$/);
    expect(queueReads).toEqual([]);
  } finally {
    await memberContext.close();
  }
});
