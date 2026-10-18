import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { devices, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { test, expect } from './fixtures';
import { registerAndGoto } from './helpers/auth';
import { seededEmail } from './helpers/seed';

const TEST_PASSWORD = 'Test1234';
const INVALID_INVITE = 'INVALID1';

test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

test('registerAndGoto creates a household before opening a protected route', async ({ page }) => {
  await registerAndGoto(page, '/dashboard', 'Fixture hogar protegido');

  await expect(page).toHaveURL(/\/dashboard(?:$|[?#])/);
  await expect(page.locator('.no-household')).toHaveCount(0);

  const token = await page.evaluate(() => localStorage.getItem('hogar:v1:auth_token'));
  expect(token).toBeTruthy();
  const response = await page.request.get('/api/household/memberships', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).data.activeHouseholdId).toBeTruthy();
});

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

async function expectNoRequestDuringPendingSubmission(
  page: Page,
  predicate: (request: import('@playwright/test').Request) => boolean
): Promise<void> {
  const duplicateRequest = page
    .waitForRequest(predicate, { timeout: 750 })
    .then(() => true)
    .catch((error: { name?: string }) => {
      if (error.name === 'TimeoutError') return false;
      throw error;
    });
  expect(await duplicateRequest, 'un doble envío no debe crear una segunda petición').toBe(false);
}

async function createHouseholdWithDoubleSubmit(page: Page, name: string): Promise<void> {
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  let signalCreateObserved!: () => void;
  const createObserved = new Promise<void>((resolve) => {
    signalCreateObserved = resolve;
  });
  let createAttempts = 0;

  await page.route('**/api/household', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    createAttempts += 1;
    if (createAttempts === 1) {
      signalCreateObserved();
      await createGate;
      return route.continue();
    }
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'SYNTHETIC_DUPLICATE_CREATE' })
    });
  });

  await page.getByRole('button', { name: /Crear hogar/i }).click();
  await page.locator('input#householdName').fill(name);
  const submit = page.locator('app-modal .create-form button[type="submit"]');
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/household'
  );
  const firstSubmission = submit.click();

  try {
    await createObserved;
    await expect(submit).toBeDisabled();
    await page.locator('app-modal .create-form').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });
    await expectNoRequestDuringPendingSubmission(
      page,
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/household'
    );

    releaseCreate();
    expect((await createResponse).status()).toBe(201);
    await firstSubmission;
    expect(createAttempts).toBe(1);
    await expect(page.locator('.household-info__name')).toHaveText(name);
  } finally {
    releaseCreate();
  }
}

async function submitJoinWithDoubleSubmit(page: Page): Promise<void> {
  let releaseJoin!: () => void;
  const joinGate = new Promise<void>((resolve) => {
    releaseJoin = resolve;
  });
  let signalJoinObserved!: () => void;
  const joinObserved = new Promise<void>((resolve) => {
    signalJoinObserved = resolve;
  });
  let joinAttempts = 0;

  await page.route('**/api/household/join', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    joinAttempts += 1;
    if (joinAttempts === 1) {
      signalJoinObserved();
      await joinGate;
      return route.continue();
    }
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'SYNTHETIC_DUPLICATE_JOIN' })
    });
  });

  const submit = page.locator('app-modal .join-form button[type="submit"]');
  const joinResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/household/join'
  );
  const firstSubmission = submit.click();

  try {
    await joinObserved;
    await expect(submit).toBeDisabled();
    await page.locator('app-modal .join-form').evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
    });
    await expectNoRequestDuringPendingSubmission(
      page,
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/household/join'
    );

    releaseJoin();
    expect((await joinResponse).status()).toBe(200);
    await firstSubmission;
    expect(joinAttempts).toBe(1);
  } finally {
    releaseJoin();
  }
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
  return browser.newContext({
    ...householdDevice(projectName),
    baseURL,
    locale: 'es-ES',
    serviceWorkers: 'block'
  });
}

test.describe('Mandatory household setup after registration', () => {
  test('blocks protected routes and server data until creating a household', async ({
    page
  }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL);
    const protectedStartupResponses: Array<{ path: string; status: number }> = [];
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path === '/api/auth/taste' || path === '/api/receipts/queue') {
        protectedStartupResponses.push({ path, status: response.status() });
      }
    });
    await page.setViewportSize(testViewport(testInfo.project.name));
    await registerAccount(page, baseURL);

    // Registration must take the new account into the required household setup, not onboarding/dashboard.
    await expect(page).toHaveURL(/\/household(?:$|[?#])/);
    await expect(page.locator('.no-household')).toBeVisible();
    await expect(page.getByRole('button', { name: /Crear hogar/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Unirse con código/i })).toBeVisible();
    await expect(
      page.getByText('Conflicto con el recurso', { exact: true }),
      'la cuenta nueva no debe mostrar un error de conflicto al completar el registro'
    ).toHaveCount(0);
    await expect(page.locator('app-receipt-queue')).toHaveCount(0);
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
    expect(
      protectedStartupResponses,
      'no se deben pedir datos protegidos hasta crear o unirse a un hogar'
    ).toEqual([]);

    const homeName = `Casa QA ${Date.now().toString(36)}`;
    const tasteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname === '/api/auth/taste'
    );
    await createHouseholdWithDoubleSubmit(page, homeName);
    expect((await tasteResponse).status(), 'el perfil vuelve a cargarse al activar un hogar').toBe(
      200
    );
    await expect(page.locator('app-receipt-queue')).toHaveCount(2);
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

  test('ignores a second registration submit while the account request is pending', async ({
    page
  }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL);
    await page.setViewportSize(testViewport(testInfo.project.name));

    let releaseRegistration!: () => void;
    const registrationGate = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    let signalRegistrationObserved!: () => void;
    const registrationObserved = new Promise<void>((resolve) => {
      signalRegistrationObserved = resolve;
    });
    let registrationAttempts = 0;

    await page.route('**/api/auth/register', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      registrationAttempts += 1;
      if (registrationAttempts === 1) {
        signalRegistrationObserved();
        await registrationGate;
        return route.continue();
      }
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, code: 'SYNTHETIC_DUPLICATE_REGISTRATION' })
      });
    });

    await page.goto(localUrl('/auth/register', baseURL));
    await page.locator('input#name').fill('Usuario de pruebas');
    await page.locator('input#email').fill(seededEmail());
    await page.locator('input#password').fill(TEST_PASSWORD);
    const submit = page.locator('button[type="submit"]');
    const registrationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/api/auth/register')
    );
    const firstSubmission = submit.click();

    try {
      await registrationObserved;
      await expect(submit).toBeDisabled();
      await page.locator('form.register-form').evaluate((form) => {
        (form as HTMLFormElement).requestSubmit();
      });
      await expectNoRequestDuringPendingSubmission(
        page,
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith('/api/auth/register')
      );

      releaseRegistration();
      expect((await registrationResponse).status()).toBe(201);
      await firstSubmission;
      expect(registrationAttempts).toBe(1);
      await expect(page).toHaveURL(/\/household(?:$|[?#])/);
      expect(await readMembershipState(page)).toMatchObject({
        status: 200,
        count: 0,
        activeMatches: false
      });
    } finally {
      releaseRegistration();
    }
  });

  test('joins a valid invitation during registration and restores membership after reload', async ({
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
      const homeName = `Casa enlace válido QA ${Date.now().toString(36)}`;
      await createHousehold(ownerPage, homeName);

      const invitationUrl = (await ownerPage.locator('.invite-card__code').innerText()).trim();
      const inviteCode = new URL(invitationUrl, baseURL).pathname.split('/').filter(Boolean).at(-1);
      if (!inviteCode) throw new Error('La invitación sintética no contiene código.');
      await ownerContext.close();

      memberContext = await createContext(browser, testInfo.project.name, baseURL);
      const memberPage = await memberContext.newPage();
      await memberPage.setViewportSize(viewport);
      await memberPage.goto(localUrl(`/invite/${encodeURIComponent(inviteCode)}`, baseURL));
      await expect(memberPage.locator('.invite-card__title')).toContainText(homeName);

      const registerLink = memberPage.locator('a[href^="/auth/register"]');
      await expect(registerLink).toHaveAttribute(
        'href',
        new RegExp(`[?&]code=${encodeURIComponent(inviteCode)}(?:&|$)`)
      );
      await registerLink.click();
      await expect(memberPage).toHaveURL(
        (url) => url.pathname === '/auth/register' && url.searchParams.get('code') === inviteCode
      );

      let joinRequests = 0;
      memberPage.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === `/api/household/join/${inviteCode}`
        ) {
          joinRequests += 1;
        }
      });
      const registrationResponse = memberPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/auth/register'
      );
      const joinResponse = memberPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === `/api/household/join/${inviteCode}`
      );
      await memberPage.locator('input#name').fill('Invitado de pruebas');
      await memberPage.locator('input#email').fill(seededEmail());
      await memberPage.locator('input#password').fill(TEST_PASSWORD);
      await memberPage.locator('button[type="submit"]').click();

      expect((await registrationResponse).status()).toBe(201);
      expect((await joinResponse).status()).toBe(200);
      await expect(memberPage).toHaveURL(/\/household(?:$|[?#])/);
      await expect(memberPage.locator('.household-info__name')).toHaveText(homeName);
      expect(joinRequests, 'el enlace válido debe activar una única solicitud para unirse').toBe(1);
      expect(await readMembershipState(memberPage)).toMatchObject({
        status: 200,
        count: 1,
        activeMatches: true,
        activeName: homeName
      });

      await memberPage.reload();
      await expect(memberPage.locator('.household-info__name')).toHaveText(homeName);
      expect(await readMembershipState(memberPage)).toMatchObject({
        status: 200,
        count: 1,
        activeMatches: true,
        activeName: homeName
      });
      expect(await readSetupGate(memberPage)).toMatchObject({ status: 200, code: null });

      await memberPage.goto(localUrl('/dashboard', baseURL));
      await expect(memberPage).toHaveURL(/\/dashboard(?:$|[?#])/);
      await expect(memberPage.locator('h1.dashboard__title')).toBeVisible();
    } finally {
      await ownerContext.close().catch(() => undefined);
      await memberContext?.close().catch(() => undefined);
    }
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

      const revokedLink = (await ownerPage.locator('.invite-card__code').innerText()).trim();
      const revokedCode = new URL(revokedLink, baseURL).pathname.split('/').filter(Boolean).at(-1);
      if (!revokedCode) throw new Error('La invitación sintética no contiene código.');
      const revokeResponse = ownerPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/household/regenerate-invite'
      );
      await ownerPage.getByRole('button', { name: /Regenerar/i }).click();
      expect((await revokeResponse).status()).toBe(200);
      const inviteLink = (await ownerPage.locator('.invite-card__code').innerText()).trim();
      const inviteCode = new URL(inviteLink, baseURL).pathname.split('/').filter(Boolean).at(-1);
      if (!inviteCode) throw new Error('La invitación regenerada sintética no contiene código.');
      expect(inviteCode).not.toBe(revokedCode);
      await ownerContext.close();

      memberContext = await createContext(browser, testInfo.project.name, baseURL);
      const memberPage = await memberContext.newPage();
      await memberPage.setViewportSize(viewport);
      await registerAccount(memberPage, baseURL, INVALID_INVITE);

      // The invalid link is reported, but the signed-in account can still resume setup.
      await expect(memberPage).toHaveURL(new RegExp(`/invite/${INVALID_INVITE}$`));
      await expect(memberPage.locator('.invite-card__title')).toContainText(/no válida|no válida/i);
      await memberPage.goto(localUrl(`/invite/${revokedCode}`, baseURL));
      await expect(memberPage.locator('.invite-card__title')).toContainText(/no válida|no válida/i);
      await memberPage.getByRole('link', { name: /Ir al inicio/i }).click();
      await expect(memberPage.locator('.no-household')).toBeVisible();
      await expect(memberPage).toHaveURL(/\/household(?:$|[?#])/);
      expect(await readSetupGate(memberPage)).toEqual({ status: 409, code: 'HOUSEHOLD_REQUIRED' });
      await memberPage.reload();
      await expect(memberPage.locator('.no-household')).toBeVisible();
      await captureSetupScreen(memberPage, testInfo.project.name, 'retry-join');

      await memberPage.getByRole('button', { name: /Unirse con código/i }).click();
      await memberPage.locator('input#inviteCode').fill(inviteCode);
      await submitJoinWithDoubleSubmit(memberPage);
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

  test('recovers from a network failure, resumes after reload, and creates one household', async ({
    page
  }, testInfo) => {
    const baseURL = String(testInfo.project.use.baseURL);
    await page.setViewportSize(testViewport(testInfo.project.name));
    await registerAccount(page, baseURL);
    await expect(page).toHaveURL(/\/household(?:$|[?#])/);

    let createAttempts = 0;
    await page.route('**/api/household', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      createAttempts += 1;
      if (createAttempts === 1) {
        return route.abort('failed');
      }
      return route.continue();
    });

    await page.getByRole('button', { name: /Crear hogar/i }).click();
    await page.locator('input#householdName').fill(`Casa reintento QA ${Date.now().toString(36)}`);
    const failedCreateRequest = page.waitForEvent(
      'requestfailed',
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/household'
    );
    await page.locator('app-modal button[type="submit"]').click();
    await failedCreateRequest;
    await expect(page.locator('.toast--error')).toBeVisible();
    await expect(page.locator('input#householdName')).toBeVisible();
    await expect(page.locator('.household-info__name')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.no-household')).toBeVisible();
    expect(await readSetupGate(page)).toEqual({ status: 409, code: 'HOUSEHOLD_REQUIRED' });
    expect(await readMembershipState(page)).toMatchObject({
      status: 200,
      count: 0,
      activeMatches: false
    });

    const homeName = `Casa reintento QA ${Date.now().toString(36)}`;
    await createHousehold(page, homeName);
    expect(createAttempts).toBe(2);
    expect(await readMembershipState(page)).toMatchObject({
      status: 200,
      count: 1,
      activeMatches: true,
      activeName: homeName
    });
  });
});
