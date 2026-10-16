import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';

const TOKEN_KEY = 'hogar:v1:auth_token';
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

// Intercept only the deterministic AI response; domain writes still reach the real backend.
// Blocking the PWA worker lets Playwright observe and fulfill that API request reliably.
test.use({ serviceWorkers: 'block' });

const ACTION_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666'
] as const;

function action(
  id: string,
  kind: string,
  domain: string,
  actionType: string,
  title: string,
  payload: Record<string, unknown>
) {
  return {
    id,
    kind,
    domain,
    actionType,
    title,
    summary: `Propuesta sintética para ${title.toLowerCase()}.`,
    payload,
    dependsOn: [],
    warnings: [],
    selected: false,
    status: 'pending'
  };
}

function proposal() {
  return {
    success: true,
    data: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      summary: 'Propuesta sintética multiruta para pruebas aisladas.',
      questions: [],
      actions: [
        action(
          ACTION_IDS[0],
          'pantry.add_ingredient',
          'pantry',
          'add_ingredient',
          'Añadir garbanzos',
          {
            name: 'Action QA 01',
            category: 'other',
            quantity: 500,
            unit: 'g',
            expirationDate: null,
            location: 'pantry',
            notes: null
          }
        ),
        action(
          ACTION_IDS[1],
          'shopping.create_list',
          'shopping',
          'create_list',
          'Crear lista confirmada',
          {
            name: 'Lista QA confirmada',
            store: null
          }
        ),
        action(ACTION_IDS[2], 'pantry.add_ingredient', 'pantry', 'add_ingredient', 'Añadir arroz', {
          name: 'Action QA no confirmada 02',
          category: 'other',
          quantity: 1,
          unit: 'kg',
          expirationDate: null,
          location: 'pantry',
          notes: null
        }),
        action(
          ACTION_IDS[3],
          'shopping.create_list',
          'shopping',
          'create_list',
          'Crear lista no confirmada',
          {
            name: 'Lista QA no confirmada',
            store: null
          }
        ),
        action(ACTION_IDS[4], 'pantry.add_ingredient', 'pantry', 'add_ingredient', 'Añadir pasta', {
          name: 'Action QA no confirmada 04',
          category: 'other',
          quantity: 1,
          unit: 'kg',
          expirationDate: null,
          location: 'pantry',
          notes: null
        }),
        action(ACTION_IDS[5], 'pantry.add_ingredient', 'pantry', 'add_ingredient', 'Añadir avena', {
          name: 'Action QA no confirmada 05',
          category: 'other',
          quantity: 1,
          unit: 'kg',
          expirationDate: null,
          location: 'pantry',
          notes: null
        })
      ]
    }
  };
}

function allDomainProposal() {
  const list = action(
    ACTION_IDS[0],
    'shopping.create_list',
    'shopping',
    'create_list',
    'Crear lista de dominio QA',
    { name: 'Lista de dominio QA', store: null }
  );
  const item = action(
    ACTION_IDS[1],
    'shopping.add_item',
    'shopping',
    'add_item',
    'Añadir manzanas a la lista',
    {
      listName: 'Lista de dominio QA',
      name: 'Manzanas QA',
      quantity: 2,
      unit: 'unit',
      category: null
    }
  );
  const task = action(
    ACTION_IDS[2],
    'household.create_task',
    'household',
    'create_task',
    'Crear tarea de dominio QA',
    {
      title: 'Tarea de dominio QA',
      details: 'Creada tras confirmación.',
      scheduledDate: '2026-10-20',
      spaceName: null,
      assignedMemberName: null
    }
  );
  const event = action(
    ACTION_IDS[3],
    'calendar.create_event',
    'calendar',
    'create_event',
    'Crear evento de dominio QA',
    {
      title: 'Evento de dominio QA',
      kind: 'appointment',
      date: '2026-10-20',
      startTime: '19:00',
      endTime: '19:30',
      allDay: false,
      sharedWithHousehold: true,
      location: 'Cocina',
      notes: 'Evento sintético.'
    }
  );
  const recipe = action(
    ACTION_IDS[4],
    'recipes.create_draft',
    'recipes',
    'create_draft',
    'Crear receta de dominio QA',
    {
      recipe: {
        name: 'Receta de dominio QA',
        description: 'Receta sintética para validar el flujo de aprobación.',
        difficulty: 'easy',
        cuisine: 'mediterránea',
        totalTime: 20,
        prepTime: 10,
        cookTime: 10,
        restTime: null,
        baseServings: 1,
        calories: 350,
        ingredients: [
          {
            name: 'Manzanas QA',
            quantity: 2,
            unit: 'unit',
            preparation: null,
            isOptional: false,
            substitutes: [],
            notes: null
          }
        ],
        utensils: [],
        guidance: {
          appliances: [],
          parallelTasks: [],
          tipsAndVariations: [],
          batchCookingWarning: null
        },
        instructionsByLevel: Object.fromEntries(
          (['basic', 'intermediate', 'expert'] as const).map((level) => [
            level,
            [
              {
                stepNumber: 1,
                instruction: 'Preparar y servir.',
                duration: null,
                temperature: null,
                timerRequired: false,
                timerDuration: null,
                tips: null,
                warning: null,
                illustration: null
              }
            ]
          ])
        ),
        nutrition: null,
        storage: {
          method: 'Refrigerar',
          duration: '2 días',
          reheatingInstructions: null,
          container: 'Recipiente cerrado',
          freezingPossible: false,
          freezingDuration: null
        },
        tags: ['qa']
      }
    }
  );

  return {
    success: true,
    data: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      summary: 'Lote sintético con acciones cruzadas para QA.',
      questions: [],
      actions: [list, { ...item, dependsOn: [list.id] }, task, event, recipe]
    }
  };
}

function taskUpdateProposal(executionTarget: Record<string, any>) {
  const update = action(
    '77777777-7777-4777-8777-777777777777',
    'household.update_task',
    'household',
    'update_task',
    'Cambiar tarea existente',
    {
      targetTitle: executionTarget.snapshot.title,
      targetScheduledDate: executionTarget.snapshot.scheduledDate,
      changes: {
        title: 'Revisar alacena',
        details: null,
        scheduledDate: null,
        spaceName: null,
        assignedMemberName: null
      }
    }
  );
  return {
    success: true,
    data: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      summary: 'Cambiar una tarea existente.',
      questions: [],
      actions: [{ ...update, executionTarget }]
    }
  };
}

function shoppingUpdateProposal(executionTarget: Record<string, any>) {
  const update = action(
    '88888888-8888-4888-8888-888888888888',
    'shopping.update_list',
    'shopping',
    'update_list',
    'Editar lista existente',
    {
      targetName: executionTarget.snapshot.name,
      changes: {
        name: 'Compra propuesta QA',
        setName: true,
        store: 'Carrefour',
        setStore: true
      }
    }
  );
  return {
    success: true,
    data: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      summary: 'Edita una lista activa existente.',
      questions: [],
      actions: [{ ...update, executionTarget }]
    }
  };
}

function pantryUpdateProposal(executionTarget: Record<string, any>) {
  const update = action(
    '99999999-9999-4999-8999-999999999999',
    'pantry.update_ingredient',
    'pantry',
    'update_ingredient',
    'Actualizar ingrediente existente',
    {
      targetName: executionTarget.snapshot.name,
      changes: {
        name: 'Azúcar propuesta QA',
        setName: true,
        category: null,
        setCategory: false,
        quantity: 250,
        setQuantity: true,
        unit: null,
        setUnit: false,
        expirationDate: null,
        setExpirationDate: false,
        location: null,
        setLocation: false,
        notes: null,
        setNotes: false
      }
    }
  );
  return {
    success: true,
    data: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      summary: 'Edita un ingrediente existente.',
      questions: [],
      actions: [{ ...update, executionTarget }]
    }
  };
}

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'sesión de usuario sintético').toBeTruthy();
  return token as string;
}

async function pantryByName(page: Page, token: string, name: string): Promise<any[]> {
  const response = await page.request.get(
    `/api/pantry/ingredients?search=${encodeURIComponent(name)}&page=1&pageSize=100`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(response.status(), 'lectura real del inventario de prueba').toBe(200);
  const rows = (await response.json()).data.ingredients as any[];
  return rows.filter((row) => row.name === name);
}

async function shoppingListsByName(page: Page, token: string, name: string): Promise<any[]> {
  const response = await page.request.get(
    `/api/shopping/lists?q=${encodeURIComponent(name)}&status=active`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(response.status(), 'lectura real de listas de compra').toBe(200);
  const rows = (await response.json()).data as any[];
  return rows.filter((row) => row.name === name);
}

async function capture(
  page: Page,
  testInfo: {
    project: { name: string };
    outputPath(...segments: string[]): string;
  },
  name: string
) {
  const directory = SCREENSHOT_DIR
    ? join(resolve(SCREENSHOT_DIR), testInfo.project.name)
    : testInfo.outputPath('assistant-screenshots');
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`), animations: 'disabled' });
}

async function assertViewport(page: Page, width: number, height: number, dialogOpen: boolean) {
  await page.setViewportSize({ width, height });
  const metrics = await page.evaluate((hasDialog) => {
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const fab = document
      .querySelector<HTMLElement>('[data-test="ai-assistant-open"]')
      ?.getBoundingClientRect();
    const fabElement = document.querySelector<HTMLElement>('[data-test="ai-assistant-open"]');
    const fabStyle = fabElement ? getComputedStyle(fabElement) : null;
    const assistantHost = document.querySelector<HTMLElement>('app-ai-action-assistant-launcher');
    const assistantLayerZ = assistantHost
      ? Number.parseInt(getComputedStyle(assistantHost).zIndex, 10)
      : 0;
    const appHeader = document.querySelector<HTMLElement>('.header');
    const appHeaderStyle = appHeader ? getComputedStyle(appHeader) : null;
    const appHeaderVisible = Boolean(
      appHeader &&
      appHeaderStyle?.display !== 'none' &&
      appHeaderStyle?.visibility === 'visible' &&
      appHeader.getBoundingClientRect().height > 0
    );
    const appHeaderZ = appHeaderStyle ? Number.parseInt(appHeaderStyle.zIndex, 10) : 0;
    const noticeElement = document.querySelector<HTMLElement>(
      '[data-test="planning-automation-notice"]'
    );
    const notice = noticeElement?.getBoundingClientRect();
    const dialog = hasDialog
      ? document.querySelector<HTMLElement>('.modal[role="dialog"]')?.getBoundingClientRect()
      : null;
    const modalBody = hasDialog ? document.querySelector<HTMLElement>('.modal__body') : null;
    const overlaps = Boolean(
      fab &&
      notice &&
      notice.width > 0 &&
      notice.height > 0 &&
      fab.left < notice.right &&
      fab.right > notice.left &&
      fab.top < notice.bottom &&
      fab.bottom > notice.top
    );
    return {
      viewportWidth,
      viewportHeight,
      documentWidth: document.documentElement.scrollWidth,
      fabWidth: fab?.width ?? 0,
      fabHeight: fab?.height ?? 0,
      fabVisible: Boolean(
        fabStyle &&
        fabStyle.display !== 'none' &&
        fabStyle.visibility === 'visible' &&
        Number(fabStyle.opacity) > 0
      ),
      assistantLayerZ,
      appHeaderVisible,
      appHeaderZ,
      fabRect: fab ? { left: fab.left, right: fab.right, top: fab.top, bottom: fab.bottom } : null,
      fabNoticeOverlap: overlaps,
      noticePresent: Boolean(noticeElement),
      noticeRect: notice
        ? { left: notice.left, right: notice.right, top: notice.top, bottom: notice.bottom }
        : null,
      noticeVisibility: noticeElement ? getComputedStyle(noticeElement).visibility : null,
      dialogLeft: dialog?.left ?? null,
      dialogTop: dialog?.top ?? null,
      dialogRight: dialog?.right ?? null,
      dialogBottom: dialog?.bottom ?? null,
      modalBodyWidth: modalBody?.clientWidth ?? null,
      modalBodyScrollWidth: modalBody?.scrollWidth ?? null,
      modalBodyClientHeight: modalBody?.clientHeight ?? null,
      modalBodyScrollHeight: modalBody?.scrollHeight ?? null,
      modalBodyOverflowY: modalBody ? getComputedStyle(modalBody).overflowY : null
    };
  }, dialogOpen);

  expect(
    metrics.documentWidth,
    `sin desbordamiento horizontal en ${width}×${height}`
  ).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.fabWidth, 'target táctil mínimo').toBeGreaterThanOrEqual(44);
  expect(metrics.fabHeight, 'target táctil mínimo').toBeGreaterThanOrEqual(44);
  expect(metrics.fabVisible, `FAB visible en ${width}×${height}`).toBe(true);
  expect(metrics.fabRect?.left ?? -1).toBeGreaterThanOrEqual(0);
  expect(metrics.fabRect?.top ?? -1).toBeGreaterThanOrEqual(0);
  expect(metrics.fabRect?.right ?? Infinity).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.fabRect?.bottom ?? Infinity).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.noticePresent, 'el aviso inferior sintético está activo').toBe(true);
  expect(
    metrics.fabNoticeOverlap,
    `FAB separado del aviso del hogar en ${width}×${height}: ${JSON.stringify(metrics)}`
  ).toBe(false);
  if (dialogOpen) {
    if (metrics.appHeaderVisible) {
      expect(
        metrics.assistantLayerZ,
        'el diálogo global debe apilarse sobre la cabecera móvil'
      ).toBeGreaterThan(metrics.appHeaderZ);
    }
    expect(metrics.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(metrics.dialogTop).toBeGreaterThanOrEqual(0);
    expect(metrics.dialogRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.dialogBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.modalBodyScrollWidth).toBeLessThanOrEqual((metrics.modalBodyWidth ?? 0) + 1);
    if ((metrics.modalBodyScrollHeight ?? 0) > (metrics.modalBodyClientHeight ?? 0)) {
      expect(['auto', 'scroll']).toContain(metrics.modalBodyOverflowY);
    }
  }
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const values = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!values || values.length !== 3) throw new Error(`Unsupported computed color: ${color}`);
    const [red, green, blue] = values.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test('asistente global: lote revisable, refino aislado y aprobación selectiva real', async ({
  page
}, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const domainWrites: Array<{ url: string; actionId: string | undefined; body: unknown }> = [];
  let proposalRequests = 0;
  let refinementRequests = 0;
  let refinementScope: unknown;
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const actionId = request.headers()['x-assistant-action-id'];
    if (
      actionId &&
      request.method() === 'POST' &&
      (request.url().includes('/api/pantry/ingredients') ||
        request.url().includes('/api/shopping/lists'))
    ) {
      domainWrites.push({
        url: new URL(request.url()).pathname,
        actionId,
        body: request.postDataJSON()
      });
    }
  });
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    proposalRequests += 1;
    await route.fulfill({ json: proposal() });
  });
  await page.route('**/api/ai/assistant/refine', async (route) => {
    refinementRequests += 1;
    const body = route.request().postDataJSON() as {
      actionId: string;
      action: Record<string, any>;
      scope: unknown;
    };
    refinementScope = body.scope;
    const candidate = body.action;
    await route.fulfill({
      json: {
        success: true,
        data: {
          actionId: body.actionId,
          summary: 'Cantidad revisada conservando la nota manual.',
          replacement: {
            ...candidate,
            summary: 'Añade 750 g y conserva la preparación indicada.',
            payload: { ...candidate.payload, quantity: 750 }
          },
          questions: []
        }
      }
    });
  });

  const sizes = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 1023, height: 768 },
    { width: 767, height: 768 },
    { width: 640, height: 800 },
    { width: 639, height: 800 },
    { width: 480, height: 800 },
    { width: 393, height: 851 },
    { width: 320, height: 568 },
    { width: 568, height: 320 }
  ];

  await registerUser(page, 'Asistente global E2E');
  await createHousehold(page, 'Hogar sintético asistente');
  await page.goto('/dashboard');
  const launcher = page.locator('[data-test="ai-assistant-open"]');
  await expect(launcher).toBeVisible();
  await expect(page.locator('app-ai-action-assistant-launcher')).toHaveCount(1);
  await expect(launcher).toHaveAttribute('aria-label', 'Abrir asistente de acciones con IA');
  const token = await tokenOf(page);
  const memberships = await page.request.get('/api/household/memberships', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(memberships.status(), 'hogar aislado de prueba').toBe(200);
  const householdId = (await memberships.json()).data.activeHouseholdId as string;
  expect(householdId).toBeTruthy();
  const automation = await page.request.patch('/api/household/planning-automation', {
    headers: {
      authorization: `Bearer ${token}`,
      'x-household-id': householdId
    },
    data: {
      expectedVersion: 0,
      enabled: true,
      mode: 'generate',
      scopes: ['tasks'],
      weekday: 7,
      localTime: '23:59',
      timeZone: 'Europe/Madrid'
    }
  });
  expect(automation.status(), await automation.text()).toBe(200);
  await page.reload();
  await expect(page.locator('[data-test="planning-automation-notice"]')).toBeVisible();

  for (const route of [
    '/dashboard',
    '/pantry',
    '/shopping',
    '/recipes',
    '/calendar',
    '/household',
    '/preferences',
    '/settings'
  ]) {
    await page.goto(route);
    const routeLauncher = page.locator('[data-test="ai-assistant-open"]');
    await expect(routeLauncher, `FAB global único en ${route}`).toBeVisible();
    await expect(
      page.locator('app-ai-action-assistant-launcher'),
      `instancia única en ${route}`
    ).toHaveCount(1);
  }
  await page.goto('/dashboard');
  await expect(launcher).toBeVisible();

  for (const size of sizes) await assertViewport(page, size.width, size.height, false);
  const launcherCapture =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 393, height: 851 };
  const tabletCapture = { width: 768, height: 1024 };
  const assertDialogViewportMatrix = async () => {
    for (const size of sizes) {
      await page.setViewportSize(size);
      await assertViewport(page, size.width, size.height, true);
    }
    await page.setViewportSize(launcherCapture);
  };
  await page.setViewportSize(launcherCapture);
  await capture(page, testInfo, `launcher-${launcherCapture.width}x${launcherCapture.height}`);
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize(tabletCapture);
    await assertViewport(page, tabletCapture.width, tabletCapture.height, false);
    await capture(page, testInfo, `launcher-${tabletCapture.width}x${tabletCapture.height}`);
    await page.setViewportSize(launcherCapture);
  }

  expect(await pantryByName(page, token, 'Action QA 01')).toHaveLength(0);
  expect(await shoppingListsByName(page, token, 'Lista QA confirmada')).toHaveLength(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await launcher.click();
  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  const motionStyles = await dialog.evaluate((element) => ({
    dialogAnimation: getComputedStyle(element).animationName,
    overlayAnimation: getComputedStyle(element.closest('.modal-overlay')!).animationName,
    launcherTransition: getComputedStyle(document.querySelector('[data-test="ai-assistant-open"]')!)
      .transitionDuration
  }));
  expect(motionStyles).toEqual({
    dialogAnimation: 'none',
    overlayAnimation: 'none',
    launcherTransition: '0s'
  });
  const launcherColors = await launcher.evaluate((element) => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(
    contrastRatio(launcherColors.foreground, launcherColors.background)
  ).toBeGreaterThanOrEqual(3);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('[data-test="ai-assistant-compose"]')).toBeVisible();
  await expect(page.locator('.assistant__voice-note')).toContainText('Privacidad de voz');
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  expect(
    await page.evaluate(() => {
      const dialogElement = document.querySelector('[role="dialog"]');
      return Boolean(dialogElement?.contains(document.activeElement));
    }),
    'el foco inicial permanece dentro del diálogo'
  ).toBe(true);
  const focusableBoundary = await page.evaluate(() => {
    const dialogElement = document.querySelector<HTMLElement>('.modal[role="dialog"]');
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(
      dialogElement?.querySelectorAll<HTMLElement>(selector) ?? []
    ).filter((element) => !element.hasAttribute('hidden') && element.tabIndex >= 0);
    focusable.at(-1)?.focus();
    return focusable.length;
  });
  expect(focusableBoundary).toBeGreaterThan(1);
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => {
      const dialogElement = document.querySelector<HTMLElement>('.modal[role="dialog"]');
      const selector =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const first = Array.from(dialogElement?.querySelectorAll<HTMLElement>(selector) ?? []).find(
        (element) => !element.hasAttribute('hidden') && element.tabIndex >= 0
      );
      return document.activeElement === first;
    }),
    'Tab desde el último control vuelve al primero'
  ).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.evaluate(() => {
      const dialogElement = document.querySelector<HTMLElement>('.modal[role="dialog"]');
      const selector =
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusable = Array.from(
        dialogElement?.querySelectorAll<HTMLElement>(selector) ?? []
      ).filter((element) => !element.hasAttribute('hidden') && element.tabIndex >= 0);
      return document.activeElement === focusable.at(-1);
    }),
    'Mayús+Tab desde el primero vuelve al último'
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(dialog).toBeVisible();
  await page.locator('.modal-overlay').click({ position: { x: 2, y: 2 } });
  await expect(dialog).not.toBeVisible();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(dialog).toBeVisible();
  await assertDialogViewportMatrix();
  await capture(page, testInfo, `compose-${launcherCapture.width}x${launcherCapture.height}`);
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize(tabletCapture);
    await assertViewport(page, tabletCapture.width, tabletCapture.height, true);
    await capture(page, testInfo, `compose-${tabletCapture.width}x${tabletCapture.height}`);
    await page.setViewportSize(launcherCapture);
  }

  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Añade garbanzos y crea una lista de compra; revisa cada acción antes de guardar.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  expect(proposalRequests).toBe(1);
  await assertDialogViewportMatrix();
  await assertViewport(page, launcherCapture.width, launcherCapture.height, true);
  await capture(
    page,
    testInfo,
    `review-collapsed-${launcherCapture.width}x${launcherCapture.height}`
  );
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize(tabletCapture);
    await assertViewport(page, tabletCapture.width, tabletCapture.height, true);
    await capture(
      page,
      testInfo,
      `review-collapsed-${tabletCapture.width}x${tabletCapture.height}`
    );
    await page.setViewportSize(launcherCapture);
  }

  const firstAction = page.locator(`[data-action-id="${ACTION_IDS[0]}"]`);
  await page.getByRole('button', { name: 'Seleccionar todas' }).click();
  await page.getByRole('button', { name: 'Quitar selección' }).click();
  await firstAction.getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  const shoppingAction = page.locator(`[data-action-id="${ACTION_IDS[1]}"]`);
  await shoppingAction.getByRole('checkbox').click();
  await expect(
    page.locator('[data-test="ai-assistant-actions"] [role="checkbox"][aria-checked="true"]')
  ).toHaveCount(2);

  const actionDetails = page.locator(`[data-test="ai-assistant-action-details-${ACTION_IDS[0]}"]`);
  await actionDetails.locator('summary').click();
  await actionDetails.locator('input[type="number"]').fill('600');
  await actionDetails.locator('textarea').fill('Preparar sin sal añadida');
  expect(await pantryByName(page, token, 'Action QA 01')).toHaveLength(0);
  expect(await shoppingListsByName(page, token, 'Lista QA confirmada')).toHaveLength(0);
  await capture(
    page,
    testInfo,
    `review-expanded-${launcherCapture.width}x${launcherCapture.height}`
  );

  await firstAction.locator('[data-test="ai-assistant-refine"] button').click();
  await expect(page.locator('[data-test="ai-assistant-refine-stage"]')).toBeVisible();
  await page.getByRole('button', { name: 'Ámbito de la revisión: Acción completa' }).click();
  await page.getByRole('option', { name: 'Campo: Cantidad' }).click();
  await capture(page, testInfo, `refine-field-${launcherCapture.width}x${launcherCapture.height}`);
  await page.locator('#ai-assistant-refine-input').fill('Ajusta solo la cantidad a 750 g.');
  await page.getByRole('button', { name: 'Actualizar propuestas' }).click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  expect(refinementRequests).toBe(1);
  expect(refinementScope).toEqual({ kind: 'field', path: ['quantity'] });
  await expect(actionDetails.locator('input[type="number"]')).toHaveValue('750');
  await expect(actionDetails.locator('textarea')).toHaveValue('Preparar sin sal añadida');
  await expect(shoppingAction).toContainText('Crear lista confirmada');
  expect(await pantryByName(page, token, 'Action QA 01')).toHaveLength(0);
  expect(await shoppingListsByName(page, token, 'Lista QA confirmada')).toHaveLength(0);
  await capture(
    page,
    testInfo,
    `review-refined-${launcherCapture.width}x${launcherCapture.height}`
  );

  await page.locator('[data-test="ai-assistant-continue"] button').click();
  await expect(page.locator('[data-test="ai-assistant-confirm"]')).toBeVisible();
  await assertDialogViewportMatrix();
  await expect(page.locator('[data-test="ai-assistant-confirm"]')).toContainText('Action QA 01');
  await expect(page.locator('[data-test="ai-assistant-confirm"]')).toContainText(
    'Lista QA confirmada'
  );
  const confirmColors = await page
    .locator('[data-test="ai-assistant-confirm-submit"] button')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor };
    });
  expect(contrastRatio(confirmColors.foreground, confirmColors.background)).toBeGreaterThanOrEqual(
    4.5
  );
  await capture(page, testInfo, `confirm-${launcherCapture.width}x${launcherCapture.height}`);
  await assertViewport(page, launcherCapture.width, launcherCapture.height, true);
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize(tabletCapture);
    await assertViewport(page, tabletCapture.width, tabletCapture.height, true);
    await capture(page, testInfo, `confirm-${tabletCapture.width}x${tabletCapture.height}`);
    await page.setViewportSize(launcherCapture);
  }

  const execute = page.locator('[data-test="ai-assistant-confirm-submit"] button');
  await execute.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(
    page.locator('[data-test="ai-assistant-confirm"] .assistant__confirm-status')
  ).toHaveText(['Completada', 'Completada']);
  expect(domainWrites).toHaveLength(2);
  expect(domainWrites.map((write) => write.actionId)).toEqual([ACTION_IDS[0], ACTION_IDS[1]]);
  expect(domainWrites[0].body).toMatchObject({ name: 'Action QA 01', quantity: 750 });
  expect(domainWrites[1].body).toMatchObject({ name: 'Lista QA confirmada' });

  const savedPantry = await pantryByName(page, token, 'Action QA 01');
  const savedList = await shoppingListsByName(page, token, 'Lista QA confirmada');
  expect(savedPantry).toHaveLength(1);
  expect(savedPantry[0].quantity).toBe(750);
  expect(savedList).toHaveLength(1);
  expect(await pantryByName(page, token, 'Action QA no confirmada 02')).toHaveLength(0);
  expect(await shoppingListsByName(page, token, 'Lista QA no confirmada')).toHaveLength(0);
  await capture(page, testInfo, `success-${launcherCapture.width}x${launcherCapture.height}`);

  await page.reload();
  await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
  expect((await pantryByName(page, token, 'Action QA 01'))[0].quantity).toBe(750);
  expect(await shoppingListsByName(page, token, 'Lista QA confirmada')).toHaveLength(1);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('asistente global: refina un grupo de dominio o el lote completo sin escribir datos', async ({
  page
}, testInfo) => {
  const refinementScopes: unknown[] = [];
  const domainWrites: string[] = [];
  page.on('request', (request) => {
    if (
      request.headers()['x-assistant-action-id'] &&
      request.method() === 'POST' &&
      /\/api\/(pantry\/ingredients|shopping\/lists)/.test(new URL(request.url()).pathname)
    ) {
      domainWrites.push(new URL(request.url()).pathname);
    }
  });
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({ json: proposal() });
  });
  await page.route('**/api/ai/assistant/refine-batch', async (route) => {
    const body = route.request().postDataJSON() as {
      scope: unknown;
      actions: Array<{ actionId: string; action: Record<string, any> }>;
    };
    refinementScopes.push(body.scope);
    const replacements = body.actions.map(({ action }) => ({
      ...action,
      ...(body.scope && (body.scope as { kind?: string }).kind === 'group'
        ? { summary: `Grupo revisado: ${action.summary}` }
        : {})
    }));
    await route.fulfill({
      json: {
        success: true,
        data: {
          summary: 'Revisión sin persistir.',
          replacements: body.actions.map(({ actionId }, index) => ({
            actionId,
            replacement: replacements[index]
          })),
          questions: []
        }
      }
    });
  });

  await registerUser(page, 'Asistente refinamiento por ámbitos');
  await createHousehold(page, 'Hogar sintético refinamiento por ámbitos');
  const token = await tokenOf(page);
  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Prepara una propuesta de compra y despensa');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  const groupButton = page.getByRole('button', { name: 'Refinar grupo de Compra' });
  await expect(groupButton).toBeVisible();
  await groupButton.click();
  await expect(page.locator('[data-test="ai-assistant-refine-stage"]')).toBeVisible();
  await expect(page.locator('.assistant__refine-target')).toContainText(
    'Grupo de Compra · 2 propuestas'
  );
  await page.locator('#ai-assistant-refine-input').fill('Reconsidera solo las compras.');
  await capture(page, testInfo, 'refine-domain-group');
  await page.getByRole('button', { name: 'Actualizar propuestas' }).click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  expect(refinementScopes[0]).toEqual({ kind: 'group', domain: 'shopping' });
  await expect(page.locator(`[data-action-id="${ACTION_IDS[0]}"]`)).not.toContainText(
    'Grupo revisado:'
  );
  await expect(page.locator(`[data-action-id="${ACTION_IDS[1]}"]`)).toContainText(
    'Grupo revisado:'
  );

  await page.locator('[data-test="ai-assistant-refine-batch"] button').click();
  await expect(page.locator('[data-test="ai-assistant-refine-stage"]')).toBeVisible();
  await expect(page.locator('.assistant__refine-target')).toContainText(
    'Lote pendiente · 6 propuestas'
  );
  await page.locator('#ai-assistant-refine-input').fill('Revisa la coherencia del lote.');
  await capture(page, testInfo, 'refine-full-batch');
  await page.getByRole('button', { name: 'Actualizar propuestas' }).click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  expect(refinementScopes[1]).toEqual({ kind: 'batch' });
  expect(domainWrites).toEqual([]);

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  const discardDialog = page.locator('.modal[role="dialog"]').last();
  await expect(discardDialog).toContainText('¿Descartar este borrador?');
  await capture(page, testInfo, 'discard-draft-confirmation');
  await discardDialog.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
  expect(domainWrites).toEqual([]);
  expect(await pantryByName(page, token, 'Action QA 01')).toEqual([]);
  expect(await shoppingListsByName(page, token, 'Lista QA confirmada')).toEqual([]);
});

test('asistente global: ejecuta acciones de todos los dominios solo tras confirmar', async ({
  page
}) => {
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({ json: allDomainProposal() });
  });

  await registerUser(page, 'Asistente todos dominios E2E');
  await createHousehold(page, 'Hogar sintético todos dominios');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const memberships = await page.request.get('/api/household/memberships', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(memberships.status()).toBe(200);
  const householdId = (await memberships.json()).data.activeHouseholdId as string;
  expect(householdId).toBeTruthy();

  const readTaskWeek = async () => {
    const response = await page.request.get('/api/household/tasks?weekStart=2026-10-19', {
      headers: {
        authorization: `Bearer ${token}`,
        'x-household-id': householdId
      }
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data.tasks as Array<{ title: string }>;
  };
  const readEvents = async () => {
    const response = await page.request.get('/api/calendar/events?from=2026-10-20&to=2026-10-20', {
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data as Array<{ title: string }>;
  };
  const readRecipe = async () => {
    const response = await page.request.get(
      `/api/recipes?search=${encodeURIComponent('Receta de dominio QA')}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    expect(response.status()).toBe(200);
    return (await response.json()).data.recipes as Array<{ name: string }>;
  };

  await expect.poll(async () => (await readTaskWeek()).length).toBe(0);
  expect(await readEvents()).toEqual([]);
  expect(await readRecipe()).toEqual([]);
  expect(await shoppingListsByName(page, token, 'Lista de dominio QA')).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill(
      'Crea una lista, añade sus manzanas, una tarea, un evento y una receta; revisa todo antes de guardar.'
    );
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  await page.getByRole('button', { name: 'Seleccionar todas' }).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('Lista de dominio QA');
  await expect(confirmation).toContainText('Tarea de dominio QA');
  await expect(confirmation).toContainText('Evento de dominio QA');
  await expect(confirmation).toContainText('Receta de dominio QA');

  expect(await shoppingListsByName(page, token, 'Lista de dominio QA')).toEqual([]);
  expect(await readTaskWeek()).toEqual([]);
  expect(await readEvents()).toEqual([]);
  expect(await readRecipe()).toEqual([]);

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const actionRows = confirmation.locator('.assistant__confirm-list > li');
  await expect(actionRows).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    await expect(actionRows.nth(index).locator('.assistant__confirm-status').first()).toHaveText(
      'Completada'
    );
  }

  const savedList = await shoppingListsByName(page, token, 'Lista de dominio QA');
  expect(savedList).toHaveLength(1);
  const savedItemsResponse = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(savedList[0].id)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        'x-assistant-household-id': householdId
      }
    }
  );
  expect(savedItemsResponse.status()).toBe(200);
  expect((await savedItemsResponse.json()).data.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Manzanas QA', quantity: 2 })])
  );
  expect(await readTaskWeek()).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: 'Tarea de dominio QA' })])
  );
  expect(await readEvents()).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: 'Evento de dominio QA' })])
  );
  expect(await readRecipe()).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Receta de dominio QA' })])
  );
});

test('asistente global: actualiza solo la tarea resuelta y persiste tras recargar', async ({
  page
}, testInfo) => {
  const taskWrites: Array<{ body: any; actionId: string | undefined }> = [];
  page.on('request', (request) => {
    const actionId = request.headers()['x-assistant-action-id'];
    if (
      actionId &&
      request.method() === 'PUT' &&
      new URL(request.url()).pathname === '/api/household/tasks'
    ) {
      taskWrites.push({ body: request.postDataJSON(), actionId });
    }
  });
  let refinementRequests = 0;

  await registerUser(page, 'Asistente edita tarea E2E');
  await createHousehold(page, 'Hogar sintético edición tarea');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const memberships = await page.request.get('/api/household/memberships', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(memberships.status()).toBe(200);
  const householdId = (await memberships.json()).data.activeHouseholdId as string;
  expect(householdId).toBeTruthy();

  const weekStart = '2026-10-19';
  const taskHeaders = {
    authorization: `Bearer ${token}`,
    'x-household-id': householdId
  };
  const readWeek = async () => {
    const response = await page.request.get(
      `/api/household/tasks?weekStart=${encodeURIComponent(weekStart)}`,
      { headers: taskHeaders }
    );
    expect(response.status(), 'lectura de la semana real del hogar aislado').toBe(200);
    return (await response.json()).data as {
      version: number;
      tasks: Array<{
        id: string;
        title: string;
        details: string | null;
        spaceId: string | null;
        scheduledDate: string;
        assignedMemberId: string | null;
        completed: boolean;
      }>;
    };
  };
  const beforeSeed = await readWeek();
  expect(beforeSeed.tasks).toEqual([]);
  const seededTasks = [
    {
      id: 'task-existing-qa',
      title: 'Revisar despensa',
      details: 'Reponer garbanzos',
      spaceId: null,
      scheduledDate: '2026-10-20',
      assignedMemberId: null,
      completed: false
    },
    {
      id: 'task-untouched-qa',
      title: 'Sacar basura',
      details: 'Mantener intacta',
      spaceId: null,
      scheduledDate: '2026-10-21',
      assignedMemberId: null,
      completed: false
    }
  ];
  const seedResponse = await page.request.put('/api/household/tasks', {
    headers: taskHeaders,
    data: { baseVersion: beforeSeed.version, weekStart, tasks: seededTasks }
  });
  expect(seedResponse.status(), await seedResponse.text()).toBe(200);
  const seededWeek = await readWeek();
  expect(seededWeek.tasks).toEqual(seededTasks);

  const target = seededWeek.tasks[0];
  const executionTarget = {
    kind: 'household-task',
    id: target.id,
    weekStart,
    version: seededWeek.version,
    snapshot: target
  };
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({ json: taskUpdateProposal(executionTarget) });
  });
  await page.route('**/api/ai/assistant/refine', async (route) => {
    refinementRequests += 1;
    const body = route.request().postDataJSON() as { actionId: string; action: any };
    await route.fulfill({
      json: {
        success: true,
        data: {
          actionId: body.actionId,
          summary: 'Añade el detalle solicitado.',
          replacement: {
            ...body.action,
            summary: 'Revisa las existencias antes de comprar.',
            payload: {
              ...body.action.payload,
              changes: { ...body.action.payload.changes, details: 'Revisar existencias' }
            }
          },
          questions: []
        }
      }
    });
  });

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Cambia el título de Revisar despensa a Revisar alacena.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const review = page.locator('[data-test="ai-assistant-review"]');
  await expect(review).toBeVisible();
  await expect(review.locator('[data-test="ai-assistant-task-target"]')).toContainText(
    'Revisar despensa'
  );
  await expect(review.locator('[data-test="ai-assistant-task-target"]')).toContainText(
    'Reponer garbanzos'
  );
  expect(await readWeek()).toEqual(seededWeek);
  expect(taskWrites).toEqual([]);
  const updateAction = page.locator('[data-action-id="77777777-7777-4777-8777-777777777777"]');
  await updateAction.locator('[data-test="ai-assistant-refine"] button').click();
  await expect(page.locator('[data-test="ai-assistant-refine-stage"]')).toBeVisible();
  await page.locator('#ai-assistant-refine-input').fill('Añade que revise las existencias.');
  await page.getByRole('button', { name: 'Actualizar propuestas' }).click();
  await expect(review).toBeVisible();
  expect(refinementRequests).toBe(1);
  await expect(review.locator('[data-test="ai-assistant-task-target"]')).toContainText(
    'Revisar despensa'
  );
  expect(await readWeek()).toEqual(seededWeek);
  expect(taskWrites).toEqual([]);

  const actionDetails = page.locator(
    '[data-test="ai-assistant-action-details-77777777-7777-4777-8777-777777777777"]'
  );
  await actionDetails.locator('summary').click();
  await expect(actionDetails.locator('textarea')).toHaveValue('Revisar existencias');
  await capture(page, testInfo, 'task-update-review');

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(review).not.toBeVisible();
  expect(await readWeek()).toEqual(seededWeek);
  expect(taskWrites).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Cambia el título de Revisar despensa a Revisar alacena.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(review).toBeVisible();
  const secondAction = page.locator('[data-action-id="77777777-7777-4777-8777-777777777777"]');
  const secondActionDetails = page.locator(
    '[data-test="ai-assistant-action-details-77777777-7777-4777-8777-777777777777"]'
  );
  await secondActionDetails.locator('summary').click();
  await secondActionDetails.locator('input[type="text"]').first().fill('Revisar alacena QA');
  await secondAction.getByRole('checkbox').click();
  expect(await readWeek()).toEqual(seededWeek);
  expect(taskWrites).toEqual([]);

  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toContainText('Revisar despensa');
  await expect(confirmation).toContainText('Reponer garbanzos');
  await expect(confirmation).toContainText('Revisar alacena QA');
  expect(await readWeek()).toEqual(seededWeek);
  expect(taskWrites).toEqual([]);
  await capture(page, testInfo, 'task-update-confirm');

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  await expect(confirmation.locator('.assistant__confirm-status')).toHaveText('Completada');
  expect(taskWrites).toHaveLength(1);
  expect(taskWrites[0]).toMatchObject({
    actionId: '77777777-7777-4777-8777-777777777777',
    body: {
      assistantAction: { operation: 'update_task', targetId: target.id, before: target },
      baseVersion: seededWeek.version,
      weekStart
    }
  });

  const persisted = await readWeek();
  expect(persisted.version).toBe(seededWeek.version + 1);
  expect(persisted.tasks).toEqual([
    { ...target, title: 'Revisar alacena QA' },
    seededWeek.tasks[1]
  ]);

  const assistantWriteHeaders = {
    ...taskHeaders,
    'x-assistant-action-id': '77777777-7777-4777-8777-777777777777'
  };
  const replay = await page.request.put('/api/household/tasks', {
    headers: assistantWriteHeaders,
    data: taskWrites[0].body
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({ success: true, idempotent: true });
  expect(await readWeek()).toEqual(persisted);

  const changedReplay = await page.request.put('/api/household/tasks', {
    headers: assistantWriteHeaders,
    data: {
      ...taskWrites[0].body,
      tasks: persisted.tasks.map((task, index) =>
        index === 0 ? { ...task, title: 'No volver a ejecutar con otra carga' } : task
      )
    }
  });
  expect(changedReplay.status()).toBe(409);
  expect(await changedReplay.json()).toMatchObject({
    success: false,
    code: 'ASSISTANT_ACTION_ID_CONFLICT'
  });
  expect(await readWeek()).toEqual(persisted);

  await page.reload();
  expect(await readWeek()).toEqual(persisted);
});

test('asistente global: propone, refina y confirma comidas con participantes explícitos', async ({
  page
}, testInfo) => {
  const mealActionId = '88888888-8888-4888-8888-888888888888';
  const weekStart = '2026-10-19';
  const weekEnd = '2026-10-25';
  let generatedRequests = 0;
  let refinementRequests = 0;
  let refinedProposalId = '';
  let confirmationBody: Record<string, any> | null = null;

  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/household/meal-planning/confirm'
    ) {
      confirmationBody = request.postDataJSON() as Record<string, any>;
    }
  });

  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({
      json: {
        success: true,
        data: {
          id: 'meal-plan-e2e',
          summary: 'Propuesta de comidas sintética.',
          questions: [],
          actions: [
            action(
              mealActionId,
              'household.plan_meals',
              'household',
              'plan_meals',
              'Proponer comidas',
              { weekStart, instructions: 'Cenas sencillas.' }
            )
          ]
        }
      }
    });
  });

  await page.route('**/api/ai/assistant/meal-proposals/refine', async (route) => {
    refinementRequests += 1;
    const body = route.request().postDataJSON() as { householdMemberIds: string[] };
    refinedProposalId = `meal-proposal-refined-${body.householdMemberIds[0]}`;
    await route.fulfill({
      json: assistantMealDraft(refinedProposalId, 'Pasta con verduras', body.householdMemberIds)
    });
  });
  await page.route('**/api/ai/assistant/meal-proposals', async (route) => {
    generatedRequests += 1;
    const body = route.request().postDataJSON() as { householdMemberIds: string[] };
    await route.fulfill({
      json: assistantMealDraft(
        'meal-proposal-generated',
        'Crema de verduras',
        body.householdMemberIds
      )
    });
  });

  await registerUser(page, 'Asistente comidas E2E');
  await createHousehold(page, 'Hogar sintético comidas asistente');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const authHeaders = { authorization: `Bearer ${token}` };
  const memberships = await page.request.get('/api/household/memberships', {
    headers: authHeaders
  });
  expect(memberships.status()).toBe(200);
  const householdId = (await memberships.json()).data.activeHouseholdId as string;
  expect(householdId).toBeTruthy();
  const mealHeaders = { ...authHeaders, 'x-household-id': householdId };
  const planning = await page.request.patch('/api/household/meal-planning', {
    headers: mealHeaders,
    data: {
      household: {
        mealTypes: { breakfast: false, lunch: true, snack: false, dinner: false },
        mealTimes: { lunch: '13:00' }
      }
    }
  });
  expect(planning.status(), await planning.text()).toBe(200);

  const readMeals = async () => {
    const response = await page.request.get(
      `/api/calendar/range?startDate=${weekStart}&endDate=${weekEnd}`,
      { headers: authHeaders }
    );
    expect(response.status(), 'lectura real del calendario hogar').toBe(200);
    return (await response.json()).data.meals as Array<Record<string, any>>;
  };
  expect(await readMeals()).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Planifica las comidas de la semana del 19 de octubre con cenas sencillas.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const review = page.locator('[data-test="ai-assistant-review"]');
  await expect(review).toBeVisible();
  const participant = review.locator('.assistant__meal-participants input[type="checkbox"]');
  await expect(participant).toHaveCount(1);
  await expect(participant).not.toBeChecked();
  expect(await readMeals()).toEqual([]);

  await participant.check();
  await page.locator('[data-test="ai-assistant-meals-generate"] button').click();
  await expect(page.locator('[data-test="ai-assistant-meals-preview-ready"]')).toBeVisible();
  expect(generatedRequests).toBe(1);
  expect(await readMeals()).toEqual([]);

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(review).not.toBeVisible();
  expect(await readMeals()).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Planifica las comidas de la semana del 19 de octubre con cenas sencillas.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(review).toBeVisible();
  await expect(participant).not.toBeChecked();
  expect(await readMeals()).toEqual([]);
  await participant.check();
  await page.locator('[data-test="ai-assistant-meals-generate"] button').click();
  await expect(page.locator('[data-test="ai-assistant-meals-preview-ready"]')).toBeVisible();
  expect(generatedRequests).toBe(2);
  expect(await readMeals()).toEqual([]);

  const servings = review.locator('.assistant__meal-servings input').first();
  await servings.fill('3');
  await servings.dispatchEvent('change');
  const mealRefinement = review.locator('.assistant__meal-refinement textarea');
  await mealRefinement.fill('Cambia la receta del lunes por pasta.');
  await page.locator('[data-test="ai-assistant-meals-refine"] button').click();
  await expect(review).toContainText('Pasta con verduras');
  expect(refinementRequests).toBe(1);
  expect(await readMeals()).toEqual([]);

  await review.locator(`[data-action-id="${mealActionId}"] app-checkbox`).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toContainText('Comidas · Proponer comidas');
  await expect(confirmation).toContainText('Pasta con verduras');
  await expect(confirmation).toContainText('3 Raciones');
  expect(await readMeals()).toEqual([]);
  await capture(page, testInfo, 'meal-plan-confirm');

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  await expect(confirmation.locator('.assistant__confirm-status')).toHaveText('Completada');
  expect(confirmationBody).toMatchObject({
    proposalId: refinedProposalId,
    weekStart
  });
  expect(confirmationBody!.events).toHaveLength(7);
  expect(confirmationBody!.events[0]).toMatchObject({ servings: 3 });
  const persistedMeals = await readMeals();
  expect(persistedMeals).toHaveLength(7);
  expect(persistedMeals.every((meal) => meal.custom_meal === 'Pasta con verduras')).toBe(true);
  expect(persistedMeals.find((meal) => meal.date === weekStart)).toMatchObject({ servings: 3 });
  await capture(page, testInfo, 'meal-plan-saved');

  const replay = await page.request.post('/api/household/meal-planning/confirm', {
    headers: mealHeaders,
    data: confirmationBody!
  });
  expect(replay.status(), await replay.text()).toBe(200);
  expect(await replay.json()).toMatchObject({ success: true, data: { idempotent: true } });
  expect(await readMeals()).toHaveLength(7);
  const lists = await page.request.get('/api/shopping/lists?status=active', {
    headers: authHeaders
  });
  expect(lists.status()).toBe(200);
  expect((await lists.json()).data).toEqual([]);

  await page.reload();
  expect(await readMeals()).toHaveLength(7);
});

function assistantMealDraft(proposalId: string, recipeName: string, memberIds: string[]) {
  const recipe = {
    name: recipeName,
    description: `Receta sintética ${recipeName}.`,
    difficulty: 'easy',
    cuisine: 'mediterránea',
    totalTime: 35,
    prepTime: 10,
    cookTime: 25,
    restTime: null,
    baseServings: 1,
    calories: 350,
    ingredients: [
      {
        name: 'verduras',
        quantity: 120,
        unit: 'g',
        preparation: null,
        isOptional: false,
        substitutes: [],
        notes: null
      }
    ],
    utensils: ['olla'],
    guidance: {
      appliances: [],
      parallelTasks: [],
      tipsAndVariations: [],
      batchCookingWarning: null
    },
    instructionsByLevel: Object.fromEntries(
      (['basic', 'intermediate', 'expert'] as const).map((level) => [
        level,
        [
          {
            stepNumber: 1,
            instruction: 'Cocina y sirve.',
            duration: null,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ]
      ])
    ),
    nutrition: { calories: 350, protein: 8, carbs: 45, fat: 7, fiber: 4 },
    storage: {
      method: 'Refrigerar',
      duration: '3 días',
      reheatingInstructions: 'Calentar completamente.',
      container: 'Recipiente cerrado',
      freezingPossible: true,
      freezingDuration: '2 meses'
    },
    tags: ['qa']
  };
  const participants = [{ alias: 'P1', householdMemberId: memberIds[0] }];
  return {
    success: true,
    data: {
      proposalId,
      weekStart: '2026-10-19',
      participants,
      recipes: [{ alias: 'N1', source: 'new', recipeId: null, recipe }],
      events: Array.from({ length: 7 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 9, 19 + index)).toISOString().slice(0, 10);
        return {
          id: `${proposalId}-event-${index}`,
          date,
          mealType: 'lunch',
          time: '13:00',
          recipeAlias: 'N1',
          participantAliases: ['P1'],
          participantIds: memberIds,
          servings: 2,
          objectiveSummary: 'Comida equilibrada para la semana.',
          status: 'scheduled',
          reason: null
        };
      })
    }
  };
}

test('asistente global: rechazar no escribe y renombrar una lista solo persiste tras confirmar', async ({
  page
}, testInfo) => {
  let updateProposal: ReturnType<typeof shoppingUpdateProposal>;
  let proposalRequests = 0;
  const assistantWrites: Array<{ body: any; actionId: string | undefined }> = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.endsWith('/assistant-update')
    ) {
      assistantWrites.push({
        body: request.postDataJSON(),
        actionId: request.headers()['x-assistant-action-id']
      });
    }
  });
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    proposalRequests += 1;
    await route.fulfill({ json: updateProposal });
  });

  await registerUser(page, 'Asistente edita lista E2E');
  await createHousehold(page, 'Casa sintética edita lista');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const authHeaders = { authorization: `Bearer ${token}` };
  const created = await page.request.post('/api/shopping/lists', {
    headers: authHeaders,
    data: { name: 'Compra privada QA', store: 'Lidl' }
  });
  const createdBody = await created.json();
  expect(created.status(), JSON.stringify(createdBody)).toBe(201);
  const list = createdBody.data;
  const seededItem = await page.request.post(`/api/shopping/lists/${list.id}/items`, {
    headers: authHeaders,
    data: { name: 'Lentejas QA', quantity: 2, unit: 'latas' }
  });
  expect(seededItem.status()).toBe(201);
  const seededListResponse = await page.request.get(`/api/shopping/lists/${list.id}`, {
    headers: authHeaders
  });
  expect(seededListResponse.status()).toBe(200);
  const seededList = (await seededListResponse.json()).data;
  updateProposal = shoppingUpdateProposal({
    kind: 'shopping-list',
    id: list.id,
    version: seededList.version,
    snapshot: { name: seededList.name, store: seededList.store }
  });

  const readList = async () => {
    const response = await page.request.get(`/api/shopping/lists/${list.id}`, {
      headers: authHeaders
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page.locator('[data-test="ai-assistant-prompt"]').fill('Renombra Compra privada QA.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const review = page.locator('[data-test="ai-assistant-review"]');
  await expect(review).toBeVisible();
  await expect(review.locator('[data-test="ai-assistant-shopping-target"]')).toContainText(
    'Compra privada QA'
  );
  await expect(review.locator('[data-test="ai-assistant-shopping-target"]')).toContainText('Lidl');
  expect(await readList()).toMatchObject({ name: 'Compra privada QA', store: 'Lidl' });
  expect(assistantWrites).toEqual([]);

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(review).not.toBeVisible();
  expect(await readList()).toMatchObject({ name: 'Compra privada QA', store: 'Lidl' });
  expect(assistantWrites).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page.locator('[data-test="ai-assistant-prompt"]').fill('Renombra Compra privada QA.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(review).toBeVisible();
  const actionDetails = page.locator(
    '[data-test="ai-assistant-action-details-88888888-8888-4888-8888-888888888888"]'
  );
  await actionDetails.locator('summary').click();
  const editFields = actionDetails.locator('input[type="text"]');
  await expect(editFields.nth(0)).toHaveValue('Compra propuesta QA');
  await expect(editFields.nth(1)).toHaveValue('Carrefour');
  await editFields.nth(0).fill('Compra confirmada QA');
  await editFields.nth(1).fill('Alcampo');
  await editFields.nth(1).scrollIntoViewIfNeeded();
  expect(
    await editFields.nth(1).evaluate((element) => {
      const modal = element.closest('app-modal');
      const body = modal?.querySelector<HTMLElement>('.modal__body')?.getBoundingClientRect();
      const footer = modal?.querySelector<HTMLElement>('.modal__footer')?.getBoundingClientRect();
      const field = element.getBoundingClientRect();
      return Boolean(body && footer && field.top >= body.top - 1 && field.bottom <= footer.top + 1);
    }),
    'la tienda debe poder verse y editarse por completo sobre el footer móvil'
  ).toBe(true);
  await editFields.nth(1).focus();
  await expect(editFields.nth(1)).toBeFocused();
  expect(await readList()).toMatchObject({ name: 'Compra privada QA', store: 'Lidl' });
  expect(assistantWrites).toEqual([]);
  await capture(page, testInfo, 'shopping-update-review');

  await page.getByRole('button', { name: 'Seleccionar todas' }).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toContainText('Compra privada QA');
  await expect(confirmation).toContainText('Compra confirmada QA');
  await expect(confirmation).toContainText('Alcampo');
  expect(await readList()).toMatchObject({ name: 'Compra privada QA', store: 'Lidl' });
  expect(assistantWrites).toEqual([]);
  await capture(page, testInfo, 'shopping-update-confirm');

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const row = confirmation.locator('.assistant__confirm-list > li');
  await expect(row.locator('.assistant__confirm-status')).toHaveText('Completada');
  expect(assistantWrites).toHaveLength(1);
  expect(assistantWrites[0]).toMatchObject({
    actionId: '88888888-8888-4888-8888-888888888888',
    body: {
      version: seededList.version,
      changes: { name: 'Compra confirmada QA', store: 'Alcampo' },
      assistantAction: {
        operation: 'update_list',
        targetId: list.id,
        before: { name: 'Compra privada QA', store: 'Lidl' }
      }
    }
  });
  const saved = await readList();
  expect(saved).toMatchObject({
    name: 'Compra confirmada QA',
    store: 'Alcampo',
    version: seededList.version + 1,
    items: [expect.objectContaining({ name: 'Lentejas QA', quantity: 2 })]
  });
  await capture(page, testInfo, 'shopping-update-saved');

  await page.reload();
  await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
  expect(await readList()).toMatchObject({ name: 'Compra confirmada QA', store: 'Alcampo' });
  expect(proposalRequests).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('asistente global: conflicto de lista obsoleta no pisa el cambio concurrente', async ({
  page
}) => {
  let updateProposal: ReturnType<typeof shoppingUpdateProposal>;
  const assistantResponses: number[] = [];
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({ json: updateProposal });
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/assistant-update')) {
      assistantResponses.push(response.status());
    }
  });

  await registerUser(page, 'Asistente conflicto lista E2E');
  await createHousehold(page, 'Casa sintética conflicto lista');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const headers = { authorization: `Bearer ${token}` };
  const created = await page.request.post('/api/shopping/lists', {
    headers,
    data: { name: 'Lista en conflicto QA', store: 'Lidl' }
  });
  expect(created.status()).toBe(201);
  const list = (await created.json()).data;
  updateProposal = shoppingUpdateProposal({
    kind: 'shopping-list',
    id: list.id,
    version: list.version,
    snapshot: { name: list.name, store: list.store }
  });

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page.locator('[data-test="ai-assistant-prompt"]').fill('Renombra Lista en conflicto QA.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  const concurrent = await page.request.patch(`/api/shopping/lists/${list.id}`, {
    headers,
    data: { version: list.version, store: 'Competidor' }
  });
  expect(concurrent.status()).toBe(200);

  await page.getByRole('button', { name: 'Seleccionar todas' }).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const row = page.locator('[data-test="ai-assistant-confirm"] .assistant__confirm-list > li');
  await expect(row.locator('.assistant__confirm-status')).toHaveText('Fallida');
  expect(assistantResponses).toEqual([409]);

  const saved = await page.request.get(`/api/shopping/lists/${list.id}`, { headers });
  expect(saved.status()).toBe(200);
  expect((await saved.json()).data).toMatchObject({
    name: 'Lista en conflicto QA',
    store: 'Competidor',
    version: list.version + 1
  });
});

test('asistente global: edita un ingrediente propio solo tras confirmar y protege el replay', async ({
  page
}, testInfo) => {
  let updateProposal: ReturnType<typeof pantryUpdateProposal>;
  let proposalRequests = 0;
  const assistantWrites: Array<{ body: any; actionId: string | undefined; headers: any }> = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.startsWith('/api/pantry/ingredients/') &&
      new URL(request.url()).pathname.endsWith('/assistant-update')
    ) {
      assistantWrites.push({
        body: request.postDataJSON(),
        actionId: request.headers()['x-assistant-action-id'],
        headers: request.headers()
      });
    }
  });
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    proposalRequests += 1;
    await route.fulfill({ json: updateProposal });
  });

  await registerUser(page, 'Asistente edita despensa E2E');
  await createHousehold(page, 'Casa sintética edita despensa');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const authHeaders = { authorization: `Bearer ${token}` };
  const memberships = await page.request.get('/api/household/memberships', {
    headers: authHeaders
  });
  expect(memberships.status()).toBe(200);
  const householdId = (await memberships.json()).data.activeHouseholdId as string;
  expect(householdId).toBeTruthy();

  const created = await page.request.post('/api/pantry/ingredients', {
    headers: { ...authHeaders, 'x-assistant-household-id': householdId },
    data: {
      name: 'Azúcar moreno QA',
      category: 'other',
      quantity: 500,
      unit: 'g',
      expirationDate: '2026-11-30',
      location: 'pantry',
      notes: 'Reserva sintética para repostería'
    }
  });
  expect(created.status(), await created.text()).toBe(201);
  const ingredient = (await created.json()).data;
  const executionTarget = {
    kind: 'pantry-ingredient',
    id: ingredient.id,
    snapshot: {
      name: ingredient.name,
      category: ingredient.category,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      expirationDate: ingredient.expiration_date,
      location: ingredient.location,
      notes: ingredient.notes,
      updatedAt: ingredient.updated_at
    }
  };
  updateProposal = pantryUpdateProposal(executionTarget);

  const readIngredient = async () => {
    const response = await page.request.get(`/api/pantry/ingredients/${ingredient.id}`, {
      headers: authHeaders
    });
    expect(response.status(), 'lectura real del ingrediente sintético').toBe(200);
    return (await response.json()).data;
  };

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Corrige los datos del azúcar moreno.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const review = page.locator('[data-test="ai-assistant-review"]');
  await expect(review).toBeVisible();
  await expect(review.locator('[data-test="ai-assistant-pantry-target"]')).toContainText(
    'Azúcar moreno QA'
  );
  expect(await readIngredient()).toMatchObject({
    name: 'Azúcar moreno QA',
    quantity: 500,
    expiration_date: '2026-11-30',
    notes: 'Reserva sintética para repostería'
  });
  expect(assistantWrites).toEqual([]);

  await review.locator('[data-test="ai-assistant-remove"]').click();
  await expect(review.locator('.assistant__empty')).toBeVisible();
  expect(await readIngredient()).toMatchObject({ name: 'Azúcar moreno QA', quantity: 500 });
  expect(assistantWrites).toEqual([]);

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(review).not.toBeVisible();
  expect(await readIngredient()).toMatchObject({ name: 'Azúcar moreno QA', quantity: 500 });
  expect(assistantWrites).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Corrige los datos del azúcar moreno.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(review).toBeVisible();
  const actionDetails = page.locator(
    '[data-test="ai-assistant-action-details-99999999-9999-4999-8999-999999999999"]'
  );
  await actionDetails.locator('summary').click();
  const textFields = actionDetails.locator('input[type="text"]');
  const quantity = actionDetails.locator('input[type="number"]');
  const expiration = actionDetails.locator('input[type="date"]');
  const notes = actionDetails.locator('textarea');
  await expect(textFields.nth(0)).toHaveValue('Azúcar propuesta QA');
  await expect(quantity).toHaveValue('250');
  await textFields.nth(0).fill('Azúcar confirmada QA');
  await quantity.fill('0');
  await expiration.fill('');
  await notes.fill('');
  expect(await readIngredient()).toMatchObject({
    name: 'Azúcar moreno QA',
    quantity: 500,
    expiration_date: '2026-11-30',
    notes: 'Reserva sintética para repostería'
  });
  expect(assistantWrites).toEqual([]);
  await notes.evaluate((element: HTMLTextAreaElement) => element.blur());
  await review.evaluate((element) => element.closest<HTMLElement>('.modal__body')?.scrollTo(0, 0));
  await capture(page, testInfo, 'pantry-update-review');

  await page.getByRole('button', { name: 'Seleccionar todas' }).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toContainText('Azúcar moreno QA');
  await expect(confirmation).toContainText('Azúcar confirmada QA');
  await expect(confirmation).toContainText('0 g');
  expect(await readIngredient()).toMatchObject({ name: 'Azúcar moreno QA', quantity: 500 });
  expect(assistantWrites).toEqual([]);
  await capture(page, testInfo, 'pantry-update-confirm');

  const updateResponse = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return response.request().method() === 'PATCH' && path.endsWith('/assistant-update');
  });
  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const writeResponse = await updateResponse;
  const writeBody = await writeResponse.json();
  expect(writeResponse.status(), JSON.stringify(writeBody)).toBe(200);
  const row = confirmation.locator('.assistant__confirm-list > li');
  await expect(row.locator('.assistant__confirm-status')).toHaveText('Completada');
  expect(assistantWrites).toHaveLength(1);
  expect(assistantWrites[0]).toMatchObject({
    actionId: '99999999-9999-4999-8999-999999999999',
    body: {
      changes: {
        name: 'Azúcar confirmada QA',
        quantity: 0,
        expirationDate: null,
        notes: null
      },
      assistantAction: { operation: 'update_ingredient', targetId: ingredient.id }
    }
  });
  const saved = await readIngredient();
  expect(saved).toMatchObject({
    name: 'Azúcar confirmada QA',
    category: 'other',
    quantity: 0,
    unit: 'g',
    expiration_date: null,
    location: 'pantry',
    notes: null
  });
  await capture(page, testInfo, 'pantry-update-saved');

  const replay = await page.request.patch(
    `/api/pantry/ingredients/${ingredient.id}/assistant-update`,
    {
      headers: {
        ...authHeaders,
        'x-assistant-action-id': assistantWrites[0].actionId as string,
        'x-assistant-household-id': householdId
      },
      data: assistantWrites[0].body
    }
  );
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({ success: true, idempotent: true });
  expect((await readIngredient()).updated_at).toBe(saved.updated_at);

  await page.reload();
  await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
  expect(await readIngredient()).toMatchObject({
    name: 'Azúcar confirmada QA',
    quantity: 0,
    expiration_date: null,
    notes: null
  });
  expect(proposalRequests).toBe(2);
  expect(pageErrors).toEqual([]);
});

test('asistente global: preimagen obsoleta del inventario no pisa el cambio concurrente', async ({
  page
}) => {
  let updateProposal: ReturnType<typeof pantryUpdateProposal>;
  const assistantResponses: number[] = [];
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({ json: updateProposal });
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/assistant-update')) {
      assistantResponses.push(response.status());
    }
  });

  await registerUser(page, 'Asistente conflicto despensa E2E');
  await createHousehold(page, 'Casa sintética conflicto despensa');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const authHeaders = { authorization: `Bearer ${token}` };
  const memberships = await page.request.get('/api/household/memberships', {
    headers: authHeaders
  });
  expect(memberships.status()).toBe(200);
  const householdId = (await memberships.json()).data.activeHouseholdId as string;
  const created = await page.request.post('/api/pantry/ingredients', {
    headers: { ...authHeaders, 'x-assistant-household-id': householdId },
    data: {
      name: 'Tomate triturado QA',
      category: 'other',
      quantity: 2,
      unit: 'unit',
      expirationDate: null,
      location: 'pantry',
      notes: null
    }
  });
  expect(created.status(), await created.text()).toBe(201);
  const ingredient = (await created.json()).data;
  updateProposal = pantryUpdateProposal({
    kind: 'pantry-ingredient',
    id: ingredient.id,
    snapshot: {
      name: ingredient.name,
      category: ingredient.category,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
      expirationDate: ingredient.expiration_date,
      location: ingredient.location,
      notes: ingredient.notes,
      updatedAt: ingredient.updated_at
    }
  });

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page.locator('[data-test="ai-assistant-prompt"]').fill('Actualiza el tomate triturado.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  const concurrent = await page.request.patch(`/api/pantry/ingredients/${ingredient.id}`, {
    headers: authHeaders,
    data: { quantity: 4 }
  });
  expect(concurrent.status()).toBe(200);

  await page.getByRole('button', { name: 'Seleccionar todas' }).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const row = page.locator('[data-test="ai-assistant-confirm"] .assistant__confirm-list > li');
  await expect(row.locator('.assistant__confirm-status')).toHaveText('Fallida');
  expect(assistantResponses).toEqual([409]);

  const saved = await page.request.get(`/api/pantry/ingredients/${ingredient.id}`, {
    headers: authHeaders
  });
  expect(saved.status()).toBe(200);
  expect((await saved.json()).data).toMatchObject({
    name: 'Tomate triturado QA',
    quantity: 4
  });
});
