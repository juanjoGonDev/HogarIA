import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { devices, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { test, expect } from './fixtures';
import { seededEmail } from './helpers/seed';

const TEST_PASSWORD = 'Test1234';
const INVALID_INVITE = 'INVALID1';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function localUrl(path: string, baseURL: string): string {
  return new URL(path, baseURL).toString();
}

function testViewport(projectName: string): { width: number; height: number } {
  return projectName.startsWith('mobile')
    ? { width: 393, height: 851 }
    : { width: 1440, height: 900 };
}

async function registerAccount(page: Page, baseURL: string, inviteCode?: string): Promise<void> {
  const target = inviteCode
    ? `/auth/register?code=${encodeURIComponent(inviteCode)}`
    : '/auth/register';
  await page.goto(localUrl(target, baseURL));
  await page.locator('input#name').waitFor({ state: 'visible' });

  const registrationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/api/auth/register')
  );
  await page.fill('input#name', 'Usuario de pruebas');
  await page.fill('input#email', seededEmail());
  await page.fill('input#password', TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();

  const response = await registrationResponse;
  expect(response.status(), 'el alta sintética debe completar correctamente').toBe(201);
}

async function createHousehold(page: Page, name: string): Promise<void> {
  await expect(page.locator('.no-household')).toBeVisible();
  await page.getByRole('button', { name: /Crear hogar/i }).click();
  await page.locator('input#householdName').fill(name);
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/household'
  );
  await page.locator('app-modal button[type="submit"]').click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.locator('.household-info__name')).toHaveText(name);
}

async function readSetupGate(page: Page): Promise<{
  status: number;
  code: string | null;
}> {
  return page.evaluate(async () => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    if (!token) throw new Error('No se encontró sesión de la cuenta sintética.');

    const response = await fetch('/api/pantry/ingredients', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await response.json()) as { code?: unknown };
    return {
      status: response.status,
      code: typeof body.code === 'string' ? body.code : null
    };
  });
}

async function readMembershipState(page: Page): Promise<{
  status: number;
  count: number;
  activeMatches: boolean;
  activeName: string | null;
}> {
  return page.evaluate(async () => {
    const token = localStorage.getItem('hogar:v1:auth_token');
    if (!token) throw new Error('No se encontró sesión de la cuenta sintética.');

    const response = await fetch('/api/household/memberships', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = (await response.json()) as {
      data?: {
        activeHouseholdId?: string | null;
        memberships?: Array<{ id?: string; name?: string }>;
      };
    };
    const memberships = body.data?.memberships ?? [];
    const activeHouseholdId = body.data?.activeHouseholdId ?? null;
    const active = memberships.find((membership) => membership.id === activeHouseholdId);
    return {
      status: response.status,
      count: memberships.length,
      activeMatches: Boolean(activeHouseholdId && active),
      activeName: active?.name ?? null
    };
  });
}

async function captureSetupScreen(page: Page, projectName: string, fileName: string) {
  const directory = process.env.HOGARIA_E2E_SCREENSHOT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${projectName}-${fileName}.png`),
    fullPage: true,
    animations: 'disabled'
  });
}

function householdDevice(projectName: string) {
  return projectName.startsWith('mobile') ? devices['Pixel 5'] : devices['Desktop Chrome'];
}

async function createContext(
  browser: Browser,
  projectName: string,
  baseURL: string
): Promise<BrowserContext> {
  return browser.newContext({ ...householdDevice(projectName), baseURL, locale: 'es-ES' });
}

test.describe('Mandatory household setup after registration', () => {
  test('blocks protected routes and server data until creating a household', async ({
    page
  }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL);
    await page.setViewportSize(testViewport(testInfo.project.name));
    await registerAccount(page, baseURL);

    // Registration must take the new account into the required household setup, not onboarding/dashboard.
    await expect(page).toHaveURL(/\/household(?:$|[?#])/);
    await expect(page.locator('.no-household')).toBeVisible();
    await expect(page.getByRole('button', { name: /Crear hogar/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Unirse con código/i })).toBeVisible();
    await captureSetupScreen(page, testInfo.project.name, 'create-or-join');

    // Client-side navigation and the real app middleware both fail closed before membership exists.
    await page.goto(localUrl('/dashboard', baseURL));
    await expect(page).toHaveURL(/\/household(?:$|[?#])/);
    await page.goto(localUrl('/calendar', baseURL));
    await expect(page).toHaveURL(/\/household(?:$|[?#])/);
    expect(await readSetupGate(page)).toEqual({ status: 409, code: 'HOUSEHOLD_REQUIRED' });
    expect(await readMembershipState(page)).toMatchObject({
      status: 200,
      count: 0,
      activeMatches: false
    });

    const homeName = `Casa QA ${Date.now().toString(36)}`;
    await createHousehold(page, homeName);
    expect(await readMembershipState(page)).toMatchObject({
      status: 200,
      count: 1,
      activeMatches: true,
      activeName: homeName
    });
    expect(await readSetupGate(page)).toMatchObject({ status: 200, code: null });

    await page.goto(localUrl('/dashboard', baseURL));
    await expect(page).toHaveURL(/\/dashboard(?:$|[?#])/);
    await expect(page.locator('h1.dashboard__title')).toBeVisible();
  });

  test('keeps invalid-invite registration recoverable and joins after retrying with a valid code', async ({
    browser
  }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL);
    const viewport = testViewport(testInfo.project.name);
    const ownerContext = await createContext(browser, testInfo.project.name, baseURL);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.setViewportSize(viewport);

    let memberContext: BrowserContext | undefined;
    try {
      await registerAccount(ownerPage, baseURL);
      await expect(ownerPage).toHaveURL(/\/household(?:$|[?#])/);
      const homeName = `Casa invitación QA ${Date.now().toString(36)}`;
      await createHousehold(ownerPage, homeName);

      const inviteLink = (await ownerPage.locator('.invite-card__code').innerText()).trim();
      const inviteCode = new URL(inviteLink, baseURL).pathname.split('/').filter(Boolean).at(-1);
      if (!inviteCode) throw new Error('La invitación sintética no contiene código.');
      await ownerContext.close();

      memberContext = await createContext(browser, testInfo.project.name, baseURL);
      const memberPage = await memberContext.newPage();
      await memberPage.setViewportSize(viewport);
      await registerAccount(memberPage, baseURL, INVALID_INVITE);

      // The invalid link is reported, but the signed-in account can still resume setup.
      await expect(memberPage).toHaveURL(new RegExp(`/invite/${INVALID_INVITE}$`));
      await expect(memberPage.locator('.invite-card__title')).toContainText(/no válida|no válida/i);
      await memberPage.goto(localUrl('/household', baseURL));
      await expect(memberPage.locator('.no-household')).toBeVisible();
      await expect(memberPage).toHaveURL(/\/household(?:$|[?#])/);
      expect(await readSetupGate(memberPage)).toEqual({ status: 409, code: 'HOUSEHOLD_REQUIRED' });
      await memberPage.reload();
      await expect(memberPage.locator('.no-household')).toBeVisible();
      await captureSetupScreen(memberPage, testInfo.project.name, 'retry-join');

      await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
      await memberPage.locator('input#inviteCode').fill(inviteCode);
      const joinResponse = memberPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/household/join'
      );
      await memberPage.locator('app-modal .join-form button[type="submit"]').click();
      expect((await joinResponse).status()).toBe(200);
      await expect(memberPage.locator('.household-info__name')).toHaveText(homeName);
      expect(await readMembershipState(memberPage)).toMatchObject({
        status: 200,
        count: 1,
        activeMatches: true,
        activeName: homeName
      });
      expect(await readSetupGate(memberPage)).toMatchObject({ status: 200, code: null });

      await memberPage.goto(localUrl('/calendar', baseURL));
      await expect(memberPage).toHaveURL(/\/calendar(?:$|[?#])/);
    } finally {
      await ownerContext.close().catch(() => undefined);
      await memberContext?.close().catch(() => undefined);
    }
  });
});
