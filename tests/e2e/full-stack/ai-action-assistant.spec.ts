import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { expect, test, type Page } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';
import { shoppingNewListAction } from '../helpers/shopping-ui';

const TOKEN_KEY = 'hogar:v1:auth_token';
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

type BrowserSpeechStubControl = {
  stopped: boolean;
  aborted: boolean;
  emitFinal(transcript: string): void;
  fail(error: string): void;
  finish(): void;
};

function localSpanishSpeechVoiceName(): string | null {
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "try { $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'es-ES' } | Select-Object -First 1; if ($voice) { $voice.VoiceInfo.Name } } finally { $synth.Dispose() }"
  ].join('; ');

  try {
    return (
      execFileSync(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { encoding: 'utf8', timeout: 5_000, windowsHide: true }
      ).trim() || null
    );
  } catch {
    return null;
  }
}

function speakSyntheticSpanishPhrase(voiceName: string): void {
  const escapedVoiceName = voiceName.replaceAll("'", "''");
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `try { $synth.SelectVoice('${escapedVoiceName}'); $synth.Volume = 75; $synth.Rate = -1; $synth.Speak('Añade lentejas a la despensa.') } finally { $synth.Dispose() }`
  ].join('; ');

  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });
}

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

function pantryAddCandidate(): string {
  return JSON.stringify({
    summary: 'Añade lentejas a la despensa.',
    questions: [],
    actions: [
      {
        kind: 'pantry.add_ingredient',
        title: 'Añadir lentejas',
        summary: 'Añade lentejas a la despensa.',
        payloadJson: JSON.stringify({
          name: 'Lentejas QA',
          category: 'other',
          quantity: 500,
          unit: 'g',
          expirationDate: null,
          location: 'pantry',
          notes: null
        }),
        dependsOn: [],
        warnings: []
      }
    ]
  });
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
      priority: 'medium',
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
  const pantryIngredient = action(
    ACTION_IDS[5],
    'pantry.add_ingredient',
    'pantry',
    'add_ingredient',
    'Añadir ingrediente de dominio QA',
    {
      name: 'Ingrediente de dominio QA',
      category: 'other',
      quantity: 3,
      unit: 'unit',
      expirationDate: null,
      location: 'pantry',
      notes: null
    }
  );

  return {
    success: true,
    data: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      summary: 'Lote sintético con acciones cruzadas para QA.',
      questions: [],
      actions: [list, { ...item, dependsOn: [list.id] }, task, event, recipe, pantryIngredient]
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
        priority: null,
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

function shoppingItemUpdateCandidate(listName: string, targetName: string) {
  return JSON.stringify({
    summary: 'Actualizar una línea de compra existente.',
    questions: [],
    actions: [
      {
        kind: 'shopping.update_item',
        title: 'Actualizar artículo de compra',
        summary: 'Ajusta los datos del artículo indicado.',
        payloadJson: JSON.stringify({
          listName,
          targetName,
          matchUnit: false,
          targetUnit: null,
          changes: {
            name: 'Harina propuesta QA',
            setName: true,
            quantity: 4,
            setQuantity: true,
            unit: null,
            setUnit: false,
            category: null,
            setCategory: false
          }
        }),
        dependsOn: [],
        warnings: []
      }
    ]
  });
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

function calendarUpdateCandidate(targetTitle: string, targetStartTime: string | null = '09:00') {
  return JSON.stringify({
    summary: 'Editar un evento existente.',
    questions: [],
    actions: [
      {
        kind: 'calendar.update_event',
        title: 'Editar evento existente',
        summary: 'Actualiza la fecha y las notas del evento.',
        payloadJson: JSON.stringify({
          targetTitle,
          targetDate: '2026-10-20',
          targetStartTime,
          changes: { date: '2026-10-21', notes: 'Notas propuestas QA' }
        }),
        dependsOn: [],
        warnings: []
      }
    ]
  });
}

function recipeUpdateCandidate(
  targetName: string,
  quantity = 75,
  instruction = 'Dora la cebolla a fuego medio.'
) {
  return JSON.stringify({
    summary: 'Editar una receta propia.',
    questions: [],
    actions: [
      {
        kind: 'recipes.update_content',
        title: 'Reducir cebolla',
        summary: 'Reduce cebolla y aclara el primer paso.',
        payloadJson: JSON.stringify({
          targetName,
          changes: {
            servings: null,
            ingredients: [{ operation: 'update', targetName: 'Cebolla', changes: { quantity } }],
            instructions: [{ level: 'legacy', stepNumber: 1, instruction }]
          }
        }),
        dependsOn: [],
        warnings: []
      }
    ]
  });
}

function recipeUpdateRefinementCandidate(
  targetName: string,
  quantity: number,
  instruction: string
) {
  return JSON.stringify({
    summary: 'Aclara las instrucciones de la receta.',
    replacement: {
      kind: 'recipes.update_content',
      title: 'Reducir cebolla',
      summary: 'Reduce cebolla y aclara el primer paso.',
      payloadJson: JSON.stringify({
        targetName,
        changes: {
          servings: null,
          ingredients: [{ operation: 'update', targetName: 'Cebolla', changes: { quantity } }],
          instructions: [{ level: 'legacy', stepNumber: 1, instruction }]
        }
      }),
      dependsOn: [],
      warnings: []
    },
    questions: []
  });
}

async function startDeterministicAiProvider(initialContent: string, responseDelayMs = 0) {
  let content = initialContent;
  const requests: string[] = [];
  const responseTimers = new Set<ReturnType<typeof setTimeout>>();
  const pendingResponses = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      requests.push(body);
      pendingResponses.add(response);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const respond = () => {
        if (timer) responseTimers.delete(timer);
        pendingResponses.delete(response);
        if (response.destroyed) return;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      };
      if (responseDelayMs > 0) {
        timer = setTimeout(respond, responseDelayMs);
        responseTimers.add(timer);
      } else {
        respond();
      }
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    setContent(nextContent: string) {
      content = nextContent;
    },
    close: () => {
      for (const timer of responseTimers) clearTimeout(timer);
      responseTimers.clear();
      for (const response of pendingResponses) response.destroy();
      pendingResponses.clear();
      return new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  };
}

async function configureDeterministicAi(page: Page, token: string, baseUrl: string): Promise<void> {
  const response = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Proveedor determinista E2E',
      provider: 'custom',
      baseUrl,
      apiKey: 'fixture-only-not-a-secret',
      model: 'calendar-fixture',
      temperature: 0,
      maxTokens: 512,
      timeout: 10000,
      retryAttempts: 0,
      concurrency: 1
    }
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function startCancellableAiProvider(retryContent: string) {
  const requests: string[] = [];
  const heldResponses = new Set<ServerResponse>();
  const heldRequestNumbers = new Set([1, 3]);
  let abortedRequests = 0;
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      requests.push(body);
      const requestNumber = requests.length;
      response.on('close', () => {
        heldResponses.delete(response);
        if (heldRequestNumbers.has(requestNumber) && !response.writableEnded) {
          abortedRequests += 1;
        }
      });

      if (heldRequestNumbers.has(requestNumber)) {
        heldResponses.add(response);
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: retryContent } }] }));
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    get abortedRequests() {
      return abortedRequests;
    },
    close: async () => {
      for (const response of heldResponses) response.destroy();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  };
}

function assistantDatabaseSnapshot(): Record<string, string[]> {
  const runDirectory = process.env.E2E_RUN_DIR;
  const databasePath = process.env.DATABASE_PATH;
  if (!runDirectory || !databasePath) throw new Error('E2E requiere SQLite temporal aislada');
  const relativeDatabasePath = relative(resolve(runDirectory), resolve(databasePath));
  if (
    !relativeDatabasePath ||
    isAbsolute(relativeDatabasePath) ||
    relativeDatabasePath === '..' ||
    relativeDatabasePath.startsWith(`..${sep}`)
  ) {
    throw new Error('DATABASE_PATH debe permanecer dentro del directorio aislado del test');
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    return Object.fromEntries(
      tables.map(({ name }) => {
        const quotedName = `"${name.replaceAll('"', '""')}"`;
        const rows = database.prepare(`SELECT * FROM ${quotedName}`).all() as Record<
          string,
          unknown
        >[];
        return [name, rows.map((row) => JSON.stringify(row)).sort()];
      })
    );
  } finally {
    database.close();
  }
}

async function createCalendarEvent(
  page: Page,
  token: string,
  householdId: string,
  title: string,
  startTime: string,
  endTime: string
): Promise<any> {
  const response = await page.request.post('/api/calendar/events', {
    headers: {
      authorization: `Bearer ${token}`,
      'x-assistant-household-id': householdId
    },
    data: {
      title,
      kind: 'appointment',
      date: '2026-10-20',
      startTime,
      endTime,
      allDay: false,
      sharedWithHousehold: true,
      location: 'Consulta QA',
      notes: 'Notas originales QA'
    }
  });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(201);
  return body.data;
}

async function calendarEventsOn(page: Page, token: string, date: string): Promise<any[]> {
  const response = await page.request.get(`/api/calendar/events?from=${date}&to=${date}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(response.status(), 'lectura real del calendario sintético').toBe(200);
  return (await response.json()).data as any[];
}

async function tokenOf(page: Page): Promise<string> {
  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'sesión de usuario sintético').toBeTruthy();
  return token as string;
}

async function installSpeechRecognitionStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type SpeechResult = { isFinal: boolean; 0?: { transcript?: string } };
    type SpeechEvent = { results: ArrayLike<SpeechResult> };
    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      stopped = false;
      aborted = false;
      onresult: ((event: SpeechEvent) => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
      onend: (() => void) | null = null;

      start(): void {
        Object.defineProperty(window, '__assistantSpeechRecognition', {
          configurable: true,
          value: this
        });
      }

      stop(): void {
        this.stopped = true;
      }

      abort(): void {
        this.aborted = true;
      }

      pause(): void {}

      resume(): void {}

      emitFinal(transcript: string): void {
        this.onresult?.({ results: [{ 0: { transcript }, isFinal: true }] });
      }

      fail(error: string): void {
        this.onerror?.({ error });
      }

      finish(): void {
        this.onend?.();
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      writable: true,
      value: FakeSpeechRecognition
    });
  });
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
  try {
    await page.waitForFunction((expectedWidth) => window.innerWidth === expectedWidth, width, {
      timeout: 5_000
    });
  } catch {
    const actualViewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualWidth: window.visualViewport?.width ?? null,
      visualHeight: window.visualViewport?.height ?? null,
      documentWidth: document.documentElement.clientWidth,
      screenWidth: window.screen.width
    }));
    throw new Error(
      `El viewport CSS no se actualizó a ${width}×${height}: ${JSON.stringify(actualViewport)}`
    );
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  if (width <= 1023) {
    await expect(page.locator('#primary-sidebar')).toHaveAttribute('aria-hidden', 'true');
  }
  if (dialogOpen) {
    await page.waitForFunction((viewportHeight) => {
      const overlay = document.querySelector<HTMLElement>('.modal-overlay--visual-viewport');
      return (
        overlay !== null && Number.parseFloat(getComputedStyle(overlay).height) <= viewportHeight
      );
    }, height);
  }
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
    const floatingControlOverlaps =
      !hasDialog && fab && fabElement
        ? Array.from(
            document.querySelectorAll<HTMLElement>(
              'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]'
            )
          )
            .filter((control) => {
              if (
                control === fabElement ||
                control.closest('app-ai-action-assistant-launcher') ||
                control.closest('[aria-hidden="true"], [inert]')
              ) {
                return false;
              }
              const style = getComputedStyle(control);
              const rect = control.getBoundingClientRect();
              if (
                style.display === 'none' ||
                style.visibility !== 'visible' ||
                Number(style.opacity) <= 0 ||
                rect.width <= 0 ||
                rect.height <= 0
              ) {
                return false;
              }

              let ancestor: HTMLElement | null = control;
              let isFloating = false;
              while (ancestor && ancestor !== document.body) {
                const position = getComputedStyle(ancestor).position;
                if (position === 'fixed' || position === 'sticky') {
                  isFloating = true;
                  break;
                }
                ancestor = ancestor.parentElement;
              }

              return Boolean(
                isFloating &&
                fab.left < rect.right &&
                fab.right > rect.left &&
                fab.top < rect.bottom &&
                fab.bottom > rect.top
              );
            })
            .map((control) => {
              const rect = control.getBoundingClientRect();
              return {
                label:
                  control.getAttribute('aria-label') ||
                  control.title ||
                  control.getAttribute('data-test') ||
                  control.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) ||
                  control.tagName.toLowerCase(),
                rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
              };
            })
        : [];
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
      floatingControlOverlaps,
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
  if (!dialogOpen) {
    expect(
      metrics.floatingControlOverlaps,
      `FAB no tapa controles fijos o sticky en ${width}×${height}: ${JSON.stringify(metrics)}`
    ).toEqual([]);
  }
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

async function expectModalControlsAccessible(page: Page, stage: string): Promise<void> {
  await page.waitForFunction(() => {
    const dialog = document.querySelector<HTMLElement>('.modal[role="dialog"]');
    return Boolean(
      dialog && dialog.getAnimations().every((animation) => animation.playState === 'finished')
    );
  });
  const problems = await page.locator('.modal[role="dialog"]').evaluate((dialog) => {
    const selector =
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="checkbox"], [role="switch"]';
    return Array.from(dialog.querySelectorAll<HTMLElement>(selector))
      .filter((control) => {
        const style = getComputedStyle(control);
        const bounds = control.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility === 'visible' &&
          Number(style.opacity) > 0 &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      })
      .map((control) => {
        const labelledBy = control
          .getAttribute('aria-labelledby')
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ');
        const nativeLabels =
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement
            ? Array.from(control.labels ?? [])
                .map((label) => label.textContent ?? '')
                .join(' ')
            : '';
        const name =
          control.getAttribute('aria-label') ||
          labelledBy ||
          nativeLabels ||
          control.getAttribute('title') ||
          control.innerText ||
          control.textContent ||
          '';
        const touchTarget =
          control instanceof HTMLInputElement &&
          ['checkbox', 'radio'].includes(control.type) &&
          control.labels?.[0]
            ? control.labels[0]
            : control;
        const bounds = touchTarget.getBoundingClientRect();
        return {
          control: control.tagName.toLowerCase(),
          name: name.replace(/\s+/g, ' ').trim(),
          width: bounds.width,
          height: bounds.height
        };
      })
      .filter((control) => !control.name || control.width < 44 || control.height < 44);
  });

  expect(problems, `controles accesibles en etapa ${stage}`).toEqual([]);
}

test('asistente global: conserva el resultado final al parar dictado y descarta el cancelado', async ({
  page
}, testInfo) => {
  await installSpeechRecognitionStub(page);
  const pageErrors: string[] = [];
  let proposalRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/ai/assistant/proposals'
    ) {
      proposalRequests += 1;
    }
  });

  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 320, height: 568 };
  await page.setViewportSize(viewport);
  await registerUser(page, 'Asistente voz síntesis');
  await createHousehold(page, 'Hogar sintético voz');
  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.locator('.modal[role="dialog"]');
  const voiceControls = dialog.locator('.assistant__voice-controls');
  const prompt = dialog.locator('[data-test="ai-assistant-prompt"]');
  const finalizing = dialog.getByText('Finalizando el dictado…', { exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.assistant__voice-note')).toContainText(
    'procesar el audio fuera de tu dispositivo'
  );
  const voiceWarning = dialog.locator('.assistant__voice-warning');
  await expect(voiceWarning).toBeVisible();
  await expect(voiceControls.getByRole('button', { name: 'Dictar petición' })).toBeEnabled();

  await voiceControls.getByRole('button', { name: 'Dictar petición' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Escuchando; puedes corregir la transcripción' })
  ).toBeVisible();
  await expect(voiceWarning).toBeHidden();
  const recognitionStarted = await page.evaluate(() =>
    Boolean(
      (window as typeof window & { __assistantSpeechRecognition?: BrowserSpeechStubControl })
        .__assistantSpeechRecognition
    )
  );
  expect(recognitionStarted).toBe(true);
  await voiceControls.getByRole('button', { name: 'Terminar dictado' }).click();
  await expect(finalizing).toBeVisible();
  await expect(voiceControls.getByRole('button', { name: 'Terminar dictado' })).toBeDisabled();

  const stopped = await page.evaluate((transcript) => {
    const recognition = (
      window as typeof window & {
        __assistantSpeechRecognition?: BrowserSpeechStubControl;
      }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.emitFinal(transcript);
    return recognition.stopped;
  }, 'Añade 500 g de avena');
  expect(stopped).toBe(true);
  await expect(prompt).toHaveValue('Añade 500 g de avena');
  const statusGeometry = await finalizing.evaluate((element) => {
    const status = element.getBoundingClientRect();
    const body = element.closest('.modal__body')?.getBoundingClientRect();
    const footer = element
      .closest('.modal')
      ?.querySelector('.modal__footer')
      ?.getBoundingClientRect();
    return {
      top: status.top,
      bottom: status.bottom,
      bodyTop: body?.top ?? 0,
      bodyBottom: body?.bottom ?? window.innerHeight,
      footerTop: footer?.top ?? window.innerHeight
    };
  });
  expect(statusGeometry.top).toBeGreaterThanOrEqual(statusGeometry.bodyTop - 1);
  expect(statusGeometry.bottom).toBeLessThanOrEqual(statusGeometry.bodyBottom + 1);
  expect(statusGeometry.bottom).toBeLessThanOrEqual(statusGeometry.footerTop + 1);
  await capture(page, testInfo, `voice-finalizing-${viewport.width}x${viewport.height}`);

  await page.evaluate(() => {
    (
      window as typeof window & {
        __assistantSpeechRecognition?: BrowserSpeechStubControl;
      }
    ).__assistantSpeechRecognition?.finish();
  });
  await expect(finalizing).toHaveCount(0);
  await expect(voiceWarning).toBeVisible();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Escuchando; puedes corregir la transcripción' })
  ).toHaveCount(0);

  await voiceControls.getByRole('button', { name: 'Dictar petición' }).click();
  await voiceControls.getByRole('button', { name: 'Terminar dictado' }).click();
  await expect(finalizing).toBeVisible();
  await voiceControls.getByRole('button', { name: 'Cancelar' }).click();
  const aborted = await page.evaluate(() => {
    const recognition = (
      window as typeof window & {
        __assistantSpeechRecognition?: BrowserSpeechStubControl;
      }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.emitFinal('No debe entrar la transcripción cancelada');
    return recognition.aborted;
  });
  expect(aborted).toBe(true);
  await expect(prompt).toHaveValue('Añade 500 g de avena');
  await expect(finalizing).toHaveCount(0);
  expect(proposalRequests).toBe(0);

  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      viewportWidth: window.visualViewport?.width ?? window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(pageErrors).toEqual([]);
});

test('asistente global: lote revisable, refino aislado y aprobación selectiva real', async ({
  page
}, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const translationWarnings: string[] = [];
  const householdStyleRequests: string[] = [];
  const domainWrites: Array<{ url: string; actionId: string | undefined; body: unknown }> = [];
  let membershipReads = 0;
  let proposalRequests = 0;
  let refinementRequests = 0;
  let refinementScope: unknown;
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning' && message.text().startsWith('[i18n]')) {
      translationWarnings.push(message.text());
    }
  });
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (request.method() === 'GET' && requestUrl.pathname === '/api/household/memberships') {
      membershipReads += 1;
    }
    if (new URL(request.url()).pathname === '/household-feature.css') {
      householdStyleRequests.push(request.url());
    }
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
  householdStyleRequests.length = 0;
  membershipReads = 0;
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  expect(membershipReads, 'una sola lectura de membresías al entrar al dashboard').toBe(1);
  expect(householdStyleRequests, 'CSS de Hogar no se descarga en el dashboard').toEqual([]);
  await expect(page.locator('link[data-route-style="household"]')).toHaveCount(0);
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

  const composerGeometryByViewport = new Map<
    string,
    Record<string, { x: number; y: number; width: number; height: number }>
  >();
  for (const route of [
    '/dashboard',
    '/pantry',
    '/shopping',
    '/recipes',
    '/receipts',
    '/calendar',
    '/household',
    '/ai-config',
    '/logs',
    '/account',
    '/preferences',
    '/settings'
  ]) {
    await page.goto(route);
    if (route === '/household') {
      const householdStyle = page.locator('link[data-route-style="household"]');
      await expect(householdStyle, 'el CSS lazy está listo antes de renderizar Hogar').toHaveCount(
        1
      );
      await expect
        .poll(() => householdStyle.evaluate((link) => Boolean((link as HTMLLinkElement).sheet)))
        .toBe(true);
      expect(householdStyleRequests).toHaveLength(1);
    }
    if (route === '/ai-config') {
      await expect(
        page.locator('link[data-route-style="household"]'),
        'el CSS de Hogar se libera al salir de la ruta'
      ).toHaveCount(0);
    }
    const pathname = new URL(page.url()).pathname;
    expect(
      pathname === route || pathname.startsWith(`${route}/`),
      `la ruta autenticada ${route} debe permanecer accesible`
    ).toBe(true);
    const routeLauncher = page.locator('[data-test="ai-assistant-open"]');
    await expect(routeLauncher, `FAB global único en ${route}`).toBeVisible();
    await expect(
      page.locator('app-ai-action-assistant-launcher'),
      `instancia única en ${route}`
    ).toHaveCount(1);
    for (const size of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 320, height: 568 }
    ]) {
      await assertViewport(page, size.width, size.height, false);
      await routeLauncher.click();
      await expect(page.locator('.modal[role="dialog"]')).toBeVisible();
      await page.locator('.modal[role="dialog"]').evaluate(async (dialog) => {
        const overlay = dialog.closest<HTMLElement>('.modal-overlay');
        if (!overlay) throw new Error('Assistant modal overlay is missing.');
        await Promise.all(
          overlay
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined))
        );
      });
      await assertViewport(page, size.width, size.height, true);
      const composerGeometry = await page.evaluate(() => {
        const selectors = {
          dialog: '.modal[role="dialog"]',
          header: '.modal__header',
          headerClose: '.modal__close',
          body: '.modal__body',
          footer: '.modal__footer',
          footerClose: '.assistant__footer app-button:first-of-type button',
          prompt: '#ai-assistant-prompt',
          warning: '#ai-assistant-voice-warning',
          privacy: 'details.assistant__privacy > summary',
          mic: '[data-test="ai-assistant-voice-start"] button',
          submit: '[data-test="ai-assistant-submit"] button'
        } as const;
        const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};
        for (const [name, selector] of Object.entries(selectors)) {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) throw new Error(`Assistant geometry element is missing: ${name}`);
          const { x, y, width, height } = element.getBoundingClientRect();
          rects[name] = { x, y, width, height };
        }
        return rects;
      });
      const viewportKey = `${size.width}x${size.height}`;
      const routeBaseline = composerGeometryByViewport.get(viewportKey);
      if (!routeBaseline) {
        composerGeometryByViewport.set(viewportKey, composerGeometry);
      } else {
        for (const [name, actual] of Object.entries(composerGeometry)) {
          const expected = routeBaseline[name]!;
          for (const dimension of ['x', 'y', 'width', 'height'] as const) {
            expect(
              Math.abs(actual[dimension] - expected[dimension]),
              `${route}: ${name}.${dimension} debe coincidir entre rutas en ${viewportKey}; ` +
                `esperado=${expected[dimension]}, actual=${actual[dimension]}`
            ).toBeLessThanOrEqual(1);
          }
        }
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal[role="dialog"]')).toBeHidden();
    }
  }
  const householdViewports =
    testInfo.project.name === 'chromium'
      ? [
          { width: 1440, height: 900, suffix: 'desktop' },
          { width: 768, height: 1024, suffix: 'tablet' }
        ]
      : [{ width: 393, height: 851, suffix: 'mobile' }];
  for (const viewport of householdViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/household?tab=plan');
    const planEditor = page.locator('app-household-plan-editor .plan-editor');
    await expect(planEditor, 'el editor conserva sus estilos diferidos').toBeVisible();
    await expect
      .poll(() => planEditor.evaluate((element) => getComputedStyle(element).display))
      .toBe('grid');
    await capture(page, testInfo, `household-plan-styles-${viewport.suffix}`);

    await page.locator('[data-test="household-tab-tasks"]').click();
    const tasksEditor = page.locator('app-household-tasks .tasks-editor');
    await expect(tasksEditor, 'la vista de tareas conserva sus estilos diferidos').toBeVisible();
    await expect
      .poll(() => tasksEditor.evaluate((element) => getComputedStyle(element).display))
      .toBe('grid');
    await capture(page, testInfo, `household-task-styles-${viewport.suffix}`);
  }
  expect(translationWarnings, 'los bundles de las rutas evitan claves i18n ausentes').toEqual([]);
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
  const compose = page.locator('[data-test="ai-assistant-compose"]');
  await expect(compose).toBeVisible();
  await expect(compose.getByRole('heading')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Asistente' })).toBeVisible();
  await expect(compose.locator('[data-test="ai-assistant-prompt"]')).toHaveAttribute(
    'placeholder',
    'Pídele a la IA qué hacer.\nEj.: añade leche o crea una tarea.'
  );
  await expectModalControlsAccessible(page, 'redacción');
  const privacy = compose.locator('details.assistant__privacy');
  await expect(privacy).toHaveJSProperty('open', false);
  const privacySummary = privacy.locator('summary');
  await expect(privacySummary).toContainText('Ver más');
  const privacySummaryBounds = await privacySummary.boundingBox();
  expect(privacySummaryBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(compose.locator('.assistant__voice-note')).toBeHidden();
  await expect(compose.locator('.assistant__voice-warning')).toHaveText(
    'El audio puede salir del dispositivo.'
  );
  await expect(compose.locator('input[type="checkbox"]')).toHaveCount(0);
  const prompt = compose.locator('[data-test="ai-assistant-prompt"]');
  const promptStyles = await prompt.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      background: styles.backgroundColor,
      borderRadius: Number.parseFloat(styles.borderTopLeftRadius),
      minHeight: element.getBoundingClientRect().height
    };
  });
  expect(promptStyles.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(promptStyles.borderRadius).toBeGreaterThanOrEqual(12);
  expect(promptStyles.minHeight).toBeGreaterThanOrEqual(112);
  const micButton = compose.locator('[data-test="ai-assistant-voice-start"] button');
  await expect(micButton).toHaveAccessibleName('Dictar petición');
  const micBounds = await micButton.boundingBox();
  expect(micBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(micBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  await capture(page, testInfo, 'assistant-compose-minimal');
  await privacySummary.focus();
  await page.keyboard.press('Enter');
  await expect(compose.locator('.assistant__voice-note')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(compose.locator('.assistant__voice-note')).toBeHidden();
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
  const beforeAssistant = assistantDatabaseSnapshot();
  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Prepara una propuesta de compra y despensa');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);

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
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
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
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
  expect(refinementScopes[1]).toEqual({ kind: 'batch' });
  expect(domainWrites).toEqual([]);

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  const discardDialog = page.locator('.modal[role="dialog"]').last();
  await expect(discardDialog).toContainText('¿Descartar este borrador?');
  await capture(page, testInfo, 'discard-draft-confirmation');
  await discardDialog.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
  expect(domainWrites).toEqual([]);
  expect(await pantryByName(page, token, 'Action QA 01')).toEqual([]);
  expect(await shoppingListsByName(page, token, 'Lista QA confirmada')).toEqual([]);
});

test('asistente global: cancelar el cierre conserva el borrador ante botón, Escape y backdrop', async ({
  page
}, testInfo) => {
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({ json: proposal() });
  });

  await registerUser(page, 'Asistente descartar borrador E2E');
  await createHousehold(page, 'Hogar sintético descartar borrador');
  await page.goto('/dashboard');
  const bodyOverflowBeforeAssistant = await page
    .locator('body')
    .evaluate((body) => body.style.overflow);
  await page.locator('[data-test="ai-assistant-open"]').click();

  const assistantDialog = page.getByRole('dialog', { name: 'Asistente' });
  const databaseBeforeProposal = assistantDatabaseSnapshot();
  await page.locator('[data-test="ai-assistant-prompt"]').fill('Añade lentejas a la despensa.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  await expect(page.locator(`[data-action-id="${ACTION_IDS[0]}"]`)).toContainText('garbanzos');
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeProposal);

  const discardDialog = page.getByRole('dialog', { name: '¿Descartar este borrador?' });
  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(discardDialog).toBeVisible();
  const discardDescriptionId = await discardDialog.getAttribute('aria-describedby');
  expect(discardDescriptionId).toBeTruthy();
  const discardDescription = page.locator(`[id="${discardDescriptionId}"]`);
  await expect(discardDescription).toBeVisible();
  await expect(discardDescription).not.toBeEmpty();
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.style.overflow))
    .toBe('hidden');
  await capture(page, testInfo, 'assistant-dismissal-confirmation');
  await discardDialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(assistantDialog).toBeVisible();
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.style.overflow))
    .toBe('hidden');
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(discardDialog).toBeVisible();
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.style.overflow))
    .toBe('hidden');
  await discardDialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(assistantDialog).toBeVisible();
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.style.overflow))
    .toBe('hidden');
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  await page
    .locator('.modal-overlay')
    .last()
    .click({ position: { x: 4, y: 4 } });
  await expect(discardDialog).toBeVisible();
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.style.overflow))
    .toBe('hidden');
  await discardDialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(assistantDialog).toBeVisible();
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.style.overflow))
    .toBe('hidden');
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeProposal);

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(discardDialog).toBeVisible();
  await discardDialog.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(assistantDialog).toBeHidden();
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.style.overflow))
    .toBe(bodyOverflowBeforeAssistant);
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeProposal);
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
    return (await response.json()).data.tasks as Array<{ title: string; priority: string }>;
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
  expect(await pantryByName(page, token, 'Ingrediente de dominio QA')).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill(
      'Añade un ingrediente a la despensa, crea una lista, añade sus manzanas, una tarea, un evento y una receta; revisa todo antes de guardar.'
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
  await expect(confirmation).toContainText('Ingrediente de dominio QA');

  expect(await shoppingListsByName(page, token, 'Lista de dominio QA')).toEqual([]);
  expect(await readTaskWeek()).toEqual([]);
  expect(await readEvents()).toEqual([]);
  expect(await readRecipe()).toEqual([]);
  expect(await pantryByName(page, token, 'Ingrediente de dominio QA')).toEqual([]);

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const actionRows = confirmation.locator('.assistant__confirm-list > li');
  await expect(actionRows).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) {
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
    expect.arrayContaining([
      expect.objectContaining({ title: 'Tarea de dominio QA', priority: 'medium' })
    ])
  );
  expect(await readEvents()).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: 'Evento de dominio QA' })])
  );
  expect(await readRecipe()).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Receta de dominio QA' })])
  );
  expect(await pantryByName(page, token, 'Ingrediente de dominio QA')).toEqual([
    expect.objectContaining({ quantity: 3, unit: 'unit', category: 'other' })
  ]);
});

test('asistente global: aprobación parcial conserva dependencia lista-artículo', async ({
  page
}, testInfo) => {
  const actionRequests: Array<{ method: string; pathname: string; actionId: string }> = [];
  const actionResponses: Array<{
    method: string;
    pathname: string;
    actionId: string;
    status: number;
  }> = [];
  let listCreateAttempts = 0;
  await page.route('**/api/shopping/lists', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    listCreateAttempts += 1;
    if (listCreateAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, code: 'E2E_TRANSIENT_WRITE_FAILURE' })
      });
      return;
    }
    await route.continue();
  });
  page.on('request', (request) => {
    const actionId = request.headers()['x-assistant-action-id'];
    if (actionId && ['POST', 'PUT', 'PATCH'].includes(request.method())) {
      actionRequests.push({
        method: request.method(),
        pathname: new URL(request.url()).pathname,
        actionId
      });
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    const actionId = request.headers()['x-assistant-action-id'];
    if (actionId && ['POST', 'PUT', 'PATCH'].includes(request.method())) {
      actionResponses.push({
        method: request.method(),
        pathname: new URL(response.url()).pathname,
        actionId,
        status: response.status()
      });
    }
  });
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    await route.fulfill({ json: allDomainProposal() });
  });

  await registerUser(page, 'Asistente selección parcial E2E');
  await createHousehold(page, 'Hogar sintético selección parcial');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const memberships = await page.request.get('/api/household/memberships', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(memberships.status()).toBe(200);
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
  const viewport =
    testInfo.project.name === 'chromium'
      ? { width: 1440, height: 900 }
      : { width: 320, height: 568 };
  await page.setViewportSize(viewport);
  const before = assistantDatabaseSnapshot();

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

  await expect
    .poll(async () => (await shoppingListsByName(page, token, 'Lista de dominio QA')).length)
    .toBe(0);
  expect(await readTaskWeek()).toEqual([]);
  expect(await readEvents()).toEqual([]);
  expect(await readRecipe()).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill(
      'Crea una lista, añade manzanas y prepara además tarea, evento y receta; apruebo solo la compra.'
    );
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const review = page.locator('[data-test="ai-assistant-review"]');
  await expect(review).toBeVisible();
  await assertViewport(page, viewport.width, viewport.height, true);

  const listAction = page.locator(`[data-action-id="${ACTION_IDS[0]}"]`);
  const itemAction = page.locator(`[data-action-id="${ACTION_IDS[1]}"]`);
  const taskAction = page.locator(`[data-action-id="${ACTION_IDS[2]}"]`);
  await itemAction.getByRole('checkbox').click();
  await expect(itemAction).toContainText(
    'Selecciona también las acciones necesarias para este paso.'
  );
  await expect(page.locator('[data-test="ai-assistant-continue"] button')).toBeDisabled();
  await assertViewport(page, viewport.width, viewport.height, true);
  await capture(
    page,
    testInfo,
    `shopping-dependency-unselected-${viewport.width}x${viewport.height}`
  );
  await expect
    .poll(async () => (await shoppingListsByName(page, token, 'Lista de dominio QA')).length)
    .toBe(0);
  expect(actionRequests).toEqual([]);
  expect(assistantDatabaseSnapshot()).toEqual(before);

  await listAction.getByRole('checkbox').click();
  await expect(page.locator('[data-test="ai-assistant-continue"] button')).toBeEnabled();
  await listAction.getByRole('checkbox').click();
  await expect(page.locator('[data-test="ai-assistant-continue"] button')).toBeDisabled();
  await listAction.getByRole('checkbox').click();
  await expect(page.locator('[data-test="ai-assistant-continue"] button')).toBeEnabled();
  await taskAction.getByRole('checkbox').click();
  await expect(page.locator('[data-test="ai-assistant-continue"] button')).toBeEnabled();
  expect(assistantDatabaseSnapshot()).toEqual(before);
  await capture(page, testInfo, `shopping-dependency-review-${viewport.width}x${viewport.height}`);

  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toBeVisible();
  await assertViewport(page, viewport.width, viewport.height, true);
  await expect(confirmation.locator('.assistant__confirm-list > li')).toHaveCount(3);
  await expect(confirmation).toContainText('Lista de dominio QA');
  await expect(confirmation).toContainText('Manzanas QA');
  await expect(confirmation).toContainText('Tarea de dominio QA');
  await expect(confirmation).not.toContainText('Evento de dominio QA');
  await expect(confirmation).not.toContainText('Receta de dominio QA');
  expect(actionRequests).toEqual([]);
  expect(assistantDatabaseSnapshot()).toEqual(before);
  expect(await shoppingListsByName(page, token, 'Lista de dominio QA')).toEqual([]);
  await capture(page, testInfo, `shopping-dependency-confirm-${viewport.width}x${viewport.height}`);

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const rows = confirmation.locator('.assistant__confirm-list > li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator('.assistant__confirm-status').first()).toHaveText('Fallida');
  await expect(rows.nth(1).locator('.assistant__confirm-status').first()).toHaveText('Bloqueada');
  await expect(rows.nth(2).locator('.assistant__confirm-status').first()).toHaveText('Completada');
  await assertViewport(page, viewport.width, viewport.height, true);
  await expect(confirmation).toContainText('puedes reintentar esta misma propuesta');
  expect(actionRequests.map(({ actionId }) => actionId)).toEqual([ACTION_IDS[0], ACTION_IDS[2]]);
  expect(actionResponses).toEqual([
    {
      method: 'POST',
      pathname: '/api/shopping/lists',
      actionId: ACTION_IDS[0],
      status: 503
    },
    {
      method: 'PUT',
      pathname: '/api/household/tasks',
      actionId: ACTION_IDS[2],
      status: 200
    }
  ]);

  const afterFailure = assistantDatabaseSnapshot();
  expect(afterFailure.shopping_lists).toEqual(before.shopping_lists);
  expect(afterFailure.shopping_list_items).toEqual(before.shopping_list_items);
  expect(afterFailure.ai_jobs ?? []).toEqual(before.ai_jobs ?? []);

  expect(await shoppingListsByName(page, token, 'Lista de dominio QA')).toEqual([]);
  const completedTasks = await readTaskWeek();
  expect(completedTasks).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: 'Tarea de dominio QA' })])
  );
  expect(await readEvents()).toEqual([]);
  expect(await readRecipe()).toEqual([]);
  expect(actionRequests.some(({ actionId }) => actionId === ACTION_IDS[1])).toBe(false);
  await capture(page, testInfo, `shopping-dependency-partial-${viewport.width}x${viewport.height}`);

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  await expect(rows.nth(0).locator('.assistant__confirm-status').first()).toHaveText('Completada');
  await expect(rows.nth(1).locator('.assistant__confirm-status').first()).toHaveText('Completada');
  await expect(rows.nth(2).locator('.assistant__confirm-status').first()).toHaveText('Completada');
  await assertViewport(page, viewport.width, viewport.height, true);
  expect(listCreateAttempts).toBe(2);
  expect(actionRequests.map(({ actionId }) => actionId)).toEqual([
    ACTION_IDS[0],
    ACTION_IDS[2],
    ACTION_IDS[0],
    ACTION_IDS[1]
  ]);
  expect(actionResponses.slice(2)).toEqual([
    {
      method: 'POST',
      pathname: '/api/shopping/lists',
      actionId: ACTION_IDS[0],
      status: 201
    },
    {
      method: 'POST',
      pathname: expect.stringMatching(/^\/api\/shopping\/lists\/[^/]+\/items$/),
      actionId: ACTION_IDS[1],
      status: 201
    }
  ]);

  const savedLists = await shoppingListsByName(page, token, 'Lista de dominio QA');
  expect(savedLists).toHaveLength(1);
  const savedListResponse = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(savedLists[0].id)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(savedListResponse.status()).toBe(200);
  expect((await savedListResponse.json()).data.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Manzanas QA', quantity: 2 })])
  );
  expect(await readTaskWeek()).toEqual(completedTasks);
  expect(await readEvents()).toEqual([]);
  expect(await readRecipe()).toEqual([]);
  const afterRetry = assistantDatabaseSnapshot();
  expect(afterRetry.shopping_lists).toHaveLength((before.shopping_lists ?? []).length + 1);
  expect(afterRetry.shopping_list_items).toHaveLength(
    (before.shopping_list_items ?? []).length + 1
  );
  expect(afterRetry.ai_jobs ?? []).toEqual(before.ai_jobs ?? []);
  await capture(page, testInfo, `shopping-dependency-saved-${viewport.width}x${viewport.height}`);

  await page.reload();
  const persisted = await shoppingListsByName(page, token, 'Lista de dominio QA');
  expect(persisted).toHaveLength(1);
  const persistedDetail = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(persisted[0].id)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(persistedDetail.status()).toBe(200);
  expect((await persistedDetail.json()).data.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Manzanas QA', quantity: 2 })])
  );
});

test('asistente global: ejecuta primero los prerrequisitos aunque el proveedor invierta el orden', async ({
  page
}) => {
  const actionRequests: Array<{ method: string; pathname: string; actionId: string }> = [];
  await page.route('**/api/ai/assistant/proposals', async (route) => {
    const response = allDomainProposal();
    const actions = response.data.actions;
    response.data.actions = [actions[1], actions[0], ...actions.slice(2)];
    await route.fulfill({ json: response });
  });
  page.on('request', (request) => {
    const actionId = request.headers()['x-assistant-action-id'];
    if (actionId && ['POST', 'PUT', 'PATCH'].includes(request.method())) {
      actionRequests.push({
        method: request.method(),
        pathname: new URL(request.url()).pathname,
        actionId
      });
    }
  });

  await registerUser(page, 'Asistente orden de dependencias E2E');
  await createHousehold(page, 'Hogar orden de dependencias sintético');
  await page.goto('/dashboard');
  const token = await tokenOf(page);
  const before = assistantDatabaseSnapshot();

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Crea una lista de compra y añade manzanas a esa lista.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  const listAction = page.locator(`[data-action-id="${ACTION_IDS[0]}"]`);
  const itemAction = page.locator(`[data-action-id="${ACTION_IDS[1]}"]`);
  await expect(itemAction).toBeVisible();
  await listAction.getByRole('checkbox').click();
  await itemAction.getByRole('checkbox').click();
  await expect(page.locator('[data-test="ai-assistant-continue"] button')).toBeEnabled();
  expect(assistantDatabaseSnapshot()).toEqual(before);

  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  const rows = confirmation.locator('.assistant__confirm-list > li');
  await expect(rows).toHaveCount(2);
  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  await expect(rows.nth(0).locator('.assistant__confirm-status').first()).toHaveText('Completada');
  await expect(rows.nth(1).locator('.assistant__confirm-status').first()).toHaveText('Completada');

  expect(actionRequests.map(({ actionId }) => actionId)).toEqual([ACTION_IDS[0], ACTION_IDS[1]]);
  expect(actionRequests.map(({ pathname }) => pathname)).toEqual([
    '/api/shopping/lists',
    expect.stringMatching(/^\/api\/shopping\/lists\/[^/]+\/items$/)
  ]);
  const savedLists = await shoppingListsByName(page, token, 'Lista de dominio QA');
  expect(savedLists).toHaveLength(1);
  const savedList = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(savedLists[0].id)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  expect(savedList.status()).toBe(200);
  expect((await savedList.json()).data.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Manzanas QA', quantity: 2 })])
  );
  const after = assistantDatabaseSnapshot();
  expect(after.shopping_lists).toHaveLength((before.shopping_lists ?? []).length + 1);
  expect(after.shopping_list_items).toHaveLength((before.shopping_list_items ?? []).length + 1);
  expect(after.ai_jobs ?? []).toEqual(before.ai_jobs ?? []);

  await page.reload();
  expect(await shoppingListsByName(page, token, 'Lista de dominio QA')).toHaveLength(1);
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
        priority: 'low' | 'medium' | 'high';
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
      priority: 'medium',
      completed: false
    },
    {
      id: 'task-untouched-qa',
      title: 'Sacar basura',
      details: 'Mantener intacta',
      spaceId: null,
      scheduledDate: '2026-10-21',
      assignedMemberId: null,
      priority: 'medium',
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
  const priorityPicker = secondActionDetails.getByRole('button', { name: /Prioridad/ });
  await priorityPicker.click();
  await page.getByRole('option', { name: 'Alta', exact: true }).click();
  await expect(secondAction.locator('[data-test="ai-assistant-task-priority"]')).toContainText(
    'Alta'
  );
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
    { ...target, title: 'Revisar alacena QA', priority: 'high' },
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
  const writesBeforeTaskRejection = taskWrites.length;
  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Cambia el título de Revisar despensa a Revisar alacena.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  const rejectedTaskAction = page.locator(
    '[data-action-id="77777777-7777-4777-8777-777777777777"]'
  );
  await rejectedTaskAction.locator('[data-test="ai-assistant-remove"]').click();
  await expect(rejectedTaskAction).toHaveCount(0);
  expect(await readWeek()).toEqual(persisted);
  expect(taskWrites).toHaveLength(writesBeforeTaskRejection);
});

test('asistente global: propone, refina y confirma comidas con participantes explícitos', async ({
  page
}, testInfo) => {
  const mealActionId = '88888888-8888-4888-8888-888888888888';
  const taskActionId = '99999999-9999-4999-8999-999999999999';
  const eventActionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const weekStart = '2026-10-19';
  const weekEnd = '2026-10-25';
  const friday = '2026-10-23';
  const taskTitle = 'Preparar cena del viernes';
  const eventTitle = 'Cena del viernes';
  let generatedRequests = 0;
  let refinementRequests = 0;
  let refinedProposalId = '';
  let confirmationBody: Record<string, any> | null = null;
  let mealPlanPersisted = false;
  let prematureShoppingPreviewRequests = 0;
  const waitForShoppingPreview = () =>
    page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === 'GET' &&
        new URL(response.url()).pathname === '/api/household/meal-planning/shopping-preview'
      );
    });

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/shopping-preview') && !mealPlanPersisted) {
      prematureShoppingPreviewRequests += 1;
    }
    if (request.method() === 'POST' && path === '/api/household/meal-planning/confirm') {
      confirmationBody = request.postDataJSON() as Record<string, any>;
    }
  });
  page.on('response', (response) => {
    const request = response.request();
    if (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/api/household/meal-planning/confirm' &&
      response.ok()
    ) {
      mealPlanPersisted = true;
    }
  });

  await page.route('**/api/ai/assistant/proposals', async (route) => {
    const mealAction = action(
      mealActionId,
      'household.plan_meals',
      'household',
      'plan_meals',
      'Proponer cenas de la semana',
      { weekStart, instructions: 'Cenas sencillas; especialmente la del viernes.' }
    );
    const taskAction = {
      ...action(taskActionId, 'household.create_task', 'household', 'create_task', taskTitle, {
        title: taskTitle,
        details: 'Dejar lista la cocina para la cena.',
        scheduledDate: friday,
        priority: 'medium',
        spaceName: null,
        assignedMemberName: null
      }),
      dependsOn: [mealActionId]
    };
    const eventAction = {
      ...action(eventActionId, 'calendar.create_event', 'calendar', 'create_event', eventTitle, {
        title: eventTitle,
        kind: 'home',
        date: friday,
        startTime: '21:00',
        endTime: '22:00',
        allDay: false,
        sharedWithHousehold: true,
        location: 'Cocina',
        notes: 'Cena planificada.'
      }),
      dependsOn: [mealActionId]
    };
    await route.fulfill({
      json: {
        success: true,
        data: {
          id: 'meal-plan-e2e',
          summary: 'Cena de viernes con preparación, evento y revisión de compra.',
          questions: [],
          actions: [mealAction, taskAction, eventAction]
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
        mealTypes: { breakfast: false, lunch: false, snack: false, dinner: true },
        mealTimes: { dinner: '21:00' }
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
  const readTasks = async () => {
    const response = await page.request.get(`/api/household/tasks?weekStart=${weekStart}`, {
      headers: { ...authHeaders, 'x-household-id': householdId }
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data.tasks as Array<Record<string, any>>;
  };
  const readEvents = async () => {
    const response = await page.request.get(`/api/calendar/events?from=${friday}&to=${friday}`, {
      headers: authHeaders
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data as Array<Record<string, any>>;
  };
  const readActiveShoppingLists = async () => {
    const response = await page.request.get('/api/shopping/lists?status=active', {
      headers: authHeaders
    });
    expect(response.status(), 'lectura real de listas de compra').toBe(200);
    return (await response.json()).data as Array<Record<string, any>>;
  };
  expect(await readMeals()).toEqual([]);
  expect(await readTasks()).toEqual([]);
  expect(await readEvents()).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill(
      'Planifica cenas de la semana del 19 de octubre; el viernes 23 a las 21:00. Añade una tarea de preparación y un evento. Revisa los faltantes antes de guardar.'
    );
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const review = page.locator('[data-test="ai-assistant-review"]');
  await expect(review).toBeVisible();
  const participant = review.locator('.assistant__meal-participants input[type="checkbox"]');
  await expect(participant).toHaveCount(1);
  await expect(participant).not.toBeChecked();
  expect(await readMeals()).toEqual([]);
  expect(await readTasks()).toEqual([]);
  expect(await readEvents()).toEqual([]);

  await participant.check();
  await page.locator('[data-test="ai-assistant-meals-generate"] button').click();
  await expect(page.locator('[data-test="ai-assistant-meals-preview-ready"]')).toBeVisible();
  expect(generatedRequests).toBe(1);
  expect(prematureShoppingPreviewRequests).toBe(0);
  expect(await readMeals()).toEqual([]);
  expect(await readTasks()).toEqual([]);
  expect(await readEvents()).toEqual([]);
  expect(await readActiveShoppingLists()).toEqual([]);

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
  await page.getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(review).not.toBeVisible();
  expect(await readMeals()).toEqual([]);
  expect(await readTasks()).toEqual([]);
  expect(await readEvents()).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill(
      'Planifica cenas de la semana del 19 de octubre; el viernes 23 a las 21:00. Añade una tarea de preparación y un evento. Revisa los faltantes antes de guardar.'
    );
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(review).toBeVisible();
  await expect(participant).not.toBeChecked();
  expect(await readMeals()).toEqual([]);
  expect(await readTasks()).toEqual([]);
  expect(await readEvents()).toEqual([]);
  await participant.check();
  await page.locator('[data-test="ai-assistant-meals-generate"] button').click();
  await expect(page.locator('[data-test="ai-assistant-meals-preview-ready"]')).toBeVisible();
  expect(generatedRequests).toBe(2);
  expect(prematureShoppingPreviewRequests).toBe(0);
  expect(await readMeals()).toEqual([]);
  expect(await readTasks()).toEqual([]);
  expect(await readEvents()).toEqual([]);

  const servings = review.locator('.assistant__meal-servings input').first();
  await servings.fill('3');
  await servings.dispatchEvent('change');
  const mealRefinement = review.locator('.assistant__meal-refinement textarea');
  await mealRefinement.fill('Cambia la receta del lunes por pasta.');
  await page.locator('[data-test="ai-assistant-meals-refine"] button').click();
  await expect(review).toContainText('Pasta con verduras');
  expect(refinementRequests).toBe(1);
  expect(prematureShoppingPreviewRequests).toBe(0);
  expect(await readMeals()).toEqual([]);
  expect(await readActiveShoppingLists()).toEqual([]);

  const changedServings = review.locator('.assistant__meal-servings input').first();
  await changedServings.fill('4');
  await changedServings.dispatchEvent('change');
  expect(prematureShoppingPreviewRequests).toBe(0);
  const desktopViewport = page.viewportSize();
  expect(desktopViewport).toBeTruthy();
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 568, height: 320 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    await review.scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.modal__body');
      return {
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        modalWidth: body?.clientWidth ?? 0,
        modalScrollWidth: body?.scrollWidth ?? 0
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.modalScrollWidth).toBeLessThanOrEqual(geometry.modalWidth + 1);
  }
  await page.setViewportSize(desktopViewport!);

  await review.locator(`[data-action-id="${mealActionId}"] app-checkbox`).click();
  await review.locator(`[data-action-id="${taskActionId}"] app-checkbox`).click();
  await review.locator(`[data-action-id="${eventActionId}"] app-checkbox`).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toContainText('Comidas · Proponer comidas');
  await expect(confirmation).toContainText('Pasta con verduras');
  await expect(confirmation).toContainText(taskTitle);
  await expect(confirmation).toContainText(eventTitle);
  await expect(confirmation).toContainText('21:00');
  await expect(confirmation).toContainText('4 Raciones');
  expect(await readMeals()).toEqual([]);
  expect(await readTasks()).toEqual([]);
  expect(await readEvents()).toEqual([]);
  await capture(page, testInfo, 'meal-plan-confirm');

  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const confirmationRows = confirmation.locator('.assistant__confirm-list > li');
  await expect(confirmationRows).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(
      confirmationRows.nth(index).locator('.assistant__confirm-status').first()
    ).toHaveText('Completada');
  }
  expect(confirmationBody).toMatchObject({
    proposalId: refinedProposalId,
    weekStart
  });
  expect(confirmationBody!.events).toHaveLength(7);
  expect(confirmationBody!.events[0]).toMatchObject({ servings: 4 });
  const persistedMeals = await readMeals();
  expect(persistedMeals).toHaveLength(7);
  expect(persistedMeals.every((meal) => meal.custom_meal === 'Pasta con verduras')).toBe(true);
  expect(persistedMeals.find((meal) => meal.date === weekStart)).toMatchObject({ servings: 4 });
  expect(await readTasks()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: taskTitle, scheduledDate: friday, priority: 'medium' })
    ])
  );
  expect(await readEvents()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: eventTitle, date: friday, startTime: '21:00' })
    ])
  );
  expect(await readActiveShoppingLists()).toEqual([]);
  expect(prematureShoppingPreviewRequests).toBe(0);
  await capture(page, testInfo, 'meal-plan-saved');

  const shoppingPreviewPromise = waitForShoppingPreview();
  await page.locator('[data-test="ai-assistant-meals-shopping-open"] button').click();
  const shoppingPreviewResponse = await shoppingPreviewPromise;
  expect(shoppingPreviewResponse.status(), await shoppingPreviewResponse.text()).toBe(200);
  const shoppingPreview = (await shoppingPreviewResponse.json()).data as {
    startDate: string;
    endDate: string;
    plannedMealCount: number;
    requiredIngredients: Array<{
      name: string;
      unit: string;
      missingQuantity: number | null;
      status: string;
    }>;
  };
  expect(shoppingPreview).toMatchObject({
    startDate: weekStart,
    endDate: weekEnd,
    plannedMealCount: 7
  });
  const verifiedShortage = shoppingPreview.requiredIngredients.find(
    (line) =>
      (line.status === 'matched' || line.status === 'not_found') &&
      line.missingQuantity !== null &&
      line.missingQuantity > 0
  );
  expect(verifiedShortage).toBeTruthy();
  const shoppingReview = page.locator(`[data-test="ai-assistant-meals-shopping-${mealActionId}"]`);
  await expect(shoppingReview).toContainText(verifiedShortage!.name);
  await expect(
    shoppingReview.locator('[data-test="ai-assistant-meals-shopping-approve"]')
  ).toBeVisible();
  expect(await readActiveShoppingLists()).toEqual([]);
  await shoppingReview.scrollIntoViewIfNeeded();
  await capture(page, testInfo, 'meal-shopping-review');

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 568, height: 320 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(viewport);
    await shoppingReview.scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.modal__body');
      return {
        viewportWidth: window.visualViewport?.width ?? window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        modalWidth: body?.clientWidth ?? 0,
        modalScrollWidth: body?.scrollWidth ?? 0
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.modalScrollWidth).toBeLessThanOrEqual(geometry.modalWidth + 1);
  }
  await page.setViewportSize(desktopViewport!);

  let approvalAttempts = 0;
  await page.route('**/api/shopping/meal-plan/approve', async (route) => {
    approvalAttempts += 1;
    if (approvalAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, code: 'TEMPORARY_TEST_FAILURE' })
      });
      return;
    }
    await route.continue();
  });
  const failedApprovalPromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/shopping/meal-plan/approve'
  );
  await shoppingReview.locator('[data-test="ai-assistant-meals-shopping-approve"] button').click();
  const failedApprovalResponse = await failedApprovalPromise;
  expect(failedApprovalResponse.status()).toBe(503);
  await expect(shoppingReview.locator('[role="alert"]')).toBeVisible();
  expect(await readMeals()).toHaveLength(7);
  expect(await readTasks()).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: taskTitle, scheduledDate: friday })])
  );
  expect(await readEvents()).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: eventTitle, startTime: '21:00' })])
  );
  expect(await readActiveShoppingLists()).toEqual([]);
  await capture(page, testInfo, 'meal-shopping-error');

  const reloadedPreviewPromise = waitForShoppingPreview();
  await shoppingReview.locator('[data-test="ai-assistant-meals-shopping-open"] button').click();
  const reloadedPreviewResponse = await reloadedPreviewPromise;
  expect(reloadedPreviewResponse.status()).toBe(200);
  expect(await readActiveShoppingLists()).toEqual([]);
  const approvedResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/shopping/meal-plan/approve'
  );
  await shoppingReview.locator('[data-test="ai-assistant-meals-shopping-approve"] button').click();
  const approvedResponse = await approvedResponsePromise;
  expect(approvedResponse.status(), await approvedResponse.text()).toBe(201);
  const approvedShopping = (await approvedResponse.json()).data as { listId: string };
  expect(approvedShopping.listId).toBeTruthy();
  await expect(
    shoppingReview.locator('[data-test="ai-assistant-meals-shopping-success"]')
  ).toBeVisible();
  const confirmedShoppingList = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(approvedShopping.listId)}`,
    { headers: mealHeaders }
  );
  expect(confirmedShoppingList.status(), await confirmedShoppingList.text()).toBe(200);
  expect((await confirmedShoppingList.json()).data.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: verifiedShortage!.name,
        quantity: verifiedShortage!.missingQuantity,
        unit: verifiedShortage!.unit
      })
    ])
  );
  await capture(page, testInfo, 'meal-shopping-approved');

  const replay = await page.request.post('/api/household/meal-planning/confirm', {
    headers: mealHeaders,
    data: confirmationBody!
  });
  expect(replay.status(), await replay.text()).toBe(200);
  expect(await replay.json()).toMatchObject({ success: true, data: { idempotent: true } });
  expect(await readMeals()).toHaveLength(7);

  await page.reload();
  expect(await readMeals()).toHaveLength(7);
  expect(await readTasks()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: taskTitle, scheduledDate: friday, priority: 'medium' })
    ])
  );
  expect(await readEvents()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: eventTitle, date: friday, startTime: '21:00' })
    ])
  );
  const persistedShoppingList = await page.request.get(
    `/api/shopping/lists/${encodeURIComponent(approvedShopping.listId)}`,
    { headers: mealHeaders }
  );
  expect(persistedShoppingList.status(), await persistedShoppingList.text()).toBe(200);
  expect((await persistedShoppingList.json()).data.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: verifiedShortage!.name,
        quantity: verifiedShortage!.missingQuantity,
        unit: 'g'
      })
    ])
  );
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
          mealType: 'dinner',
          time: '21:00',
          recipeAlias: 'N1',
          participantAliases: ['P1'],
          participantIds: memberIds,
          servings: 2,
          objectiveSummary: 'Cena equilibrada para la semana.',
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
  const beforeAssistant = assistantDatabaseSnapshot();

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
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
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
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
  expect(await readList()).toMatchObject({ name: 'Compra privada QA', store: 'Lidl' });
  expect(assistantWrites).toEqual([]);

  await page.locator('[data-test="ai-assistant-open"]').click();
  await page.locator('[data-test="ai-assistant-prompt"]').fill('Renombra Compra privada QA.');
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  await expect(review).toBeVisible();
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
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
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
  await capture(page, testInfo, 'shopping-update-review');

  await page.getByRole('button', { name: 'Seleccionar todas' }).click();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toContainText('Compra privada QA');
  await expect(confirmation).toContainText('Compra confirmada QA');
  await expect(confirmation).toContainText('Alcampo');
  expect(await readList()).toMatchObject({ name: 'Compra privada QA', store: 'Lidl' });
  expect(assistantWrites).toEqual([]);
  expect(assistantDatabaseSnapshot()).toEqual(beforeAssistant);
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

test('asistente global: edición segura de artículo requiere aprobación y tolera replay exacto', async ({
  page
}, testInfo) => {
  const listName = 'Compra artículo QA';
  const itemName = 'Leche artículo QA';
  const provider = await startDeterministicAiProvider(
    shoppingItemUpdateCandidate(listName, itemName)
  );
  const assistantWrites: Array<{
    actionId: string | undefined;
    path: string;
    body: any;
    headers: Record<string, string>;
  }> = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.endsWith('/assistant-update') &&
      new URL(request.url()).pathname.includes('/items/')
    ) {
      assistantWrites.push({
        actionId: request.headers()['x-assistant-action-id'],
        path: new URL(request.url()).pathname,
        body: request.postDataJSON(),
        headers: request.headers()
      });
    }
  });

  try {
    await registerUser(page, 'Asistente edita artículo de compra E2E');
    await createHousehold(page, 'Casa sintética edita artículo de compra');
    await page.goto('/shopping');
    await shoppingNewListAction(page).click();
    await page.locator('[data-test="list-name"]').fill(listName);
    await page.locator('[data-test="create-submit"]').click();
    await expect(page).toHaveURL(/\/shopping\/[\w-]+$/);
    await page.locator('[data-test="add-input"]').fill(`2 ${itemName}`);
    await page.locator('[data-test="add-submit"]').click();
    const itemRow = page.locator('[data-test="item-row"]', {
      has: page.locator('.detail__name', { hasText: itemName })
    });
    await expect(itemRow).toHaveCount(1);
    await expect(itemRow.locator('.detail__qty')).toHaveText('2×');

    const listId = new URL(page.url()).pathname.split('/').at(-1)!;
    const token = await tokenOf(page);
    const authHeaders = { authorization: `Bearer ${token}` };
    const memberships = await page.request.get('/api/household/memberships', {
      headers: authHeaders
    });
    expect(memberships.status(), await memberships.text()).toBe(200);
    const householdId = (await memberships.json()).data.activeHouseholdId as string;
    expect(householdId).toBeTruthy();
    const assistantHeaders = {
      ...authHeaders,
      'x-assistant-household-id': householdId
    };
    await configureDeterministicAi(page, token, provider.baseUrl);

    const readList = async () => {
      const response = await page.request.get(`/api/shopping/lists/${listId}`, {
        headers: authHeaders
      });
      expect(response.status(), 'lectura real de lista sintética').toBe(200);
      return (await response.json()).data;
    };
    const initial = await readList();
    expect(initial.items).toHaveLength(1);
    expect(initial.items[0]).toMatchObject({ name: itemName, quantity: 2, checked: 0 });

    const submitProposal = async () => {
      await page.locator('[data-test="ai-assistant-open"]').click();
      await page
        .locator('[data-test="ai-assistant-prompt"]')
        .fill(`Actualiza el nombre, cantidad, unidad y categoría de ${itemName} en ${listName}.`);
      await page.locator('[data-test="ai-assistant-submit"] button').click();
      await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
    };

    await submitProposal();
    const review = page.locator('[data-test="ai-assistant-review"]');
    await expect(review.locator('[data-test="ai-assistant-shopping-item-target"]')).toContainText(
      listName
    );
    await expect(review.locator('[data-test="ai-assistant-shopping-item-target"]')).toContainText(
      itemName
    );
    expect(await readList()).toMatchObject({ version: initial.version, items: initial.items });
    expect(assistantWrites).toEqual([]);
    await page.getByRole('button', { name: 'Cerrar asistente' }).click();
    await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
    await page.getByRole('button', { name: 'Descartar borrador' }).click();
    await expect(review).not.toBeVisible();
    expect(await readList()).toMatchObject({ version: initial.version, items: initial.items });
    expect(assistantWrites).toEqual([]);

    await submitProposal();
    const itemAction = review.locator('article', {
      has: page.locator('[data-test="ai-assistant-shopping-item-target"]')
    });
    const itemDetails = itemAction.locator('[data-test^="ai-assistant-action-details-"]');
    await expect(itemDetails).toHaveCount(1);
    await itemDetails.locator('summary').click();
    await itemDetails.locator('input[type="text"]').nth(0).fill('Harina confirmada QA');
    await itemDetails.locator('input[type="number"]').fill('5');
    await itemDetails.locator('input[type="text"]').nth(1).fill('kg');
    await itemDetails.locator('input[type="text"]').nth(2).fill('Despensa');
    await expect(itemDetails.locator('input[type="text"]').nth(0)).toHaveValue(
      'Harina confirmada QA'
    );
    await capture(page, testInfo, 'shopping-item-update-review');

    await page.getByRole('button', { name: 'Seleccionar todas' }).click();
    await page.locator('[data-test="ai-assistant-continue"] button').click();
    const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
    await expect(
      confirmation.locator('[data-test="ai-assistant-shopping-item-target-confirm"]')
    ).toContainText(listName);
    const changes = confirmation.locator(
      '[data-test="ai-assistant-shopping-item-changes-confirm"]'
    );
    await expect(changes).toContainText('Leche artículo QA');
    await expect(changes).toContainText('Harina confirmada QA');
    await expect(changes).toContainText('2');
    await expect(changes).toContainText('5');
    await expect(changes).toContainText('kg');
    await expect(changes).toContainText('Despensa');
    expect(await readList()).toMatchObject({ version: initial.version, items: initial.items });
    expect(assistantWrites).toEqual([]);
    await capture(page, testInfo, 'shopping-item-update-confirm');

    const writeResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === 'PATCH' &&
        new URL(response.url()).pathname.endsWith('/assistant-update') &&
        new URL(response.url()).pathname.includes('/items/')
      );
    });
    await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
    const writeResponse = await writeResponsePromise;
    const writeResponseBody = await writeResponse.text();
    expect(writeResponse.status(), writeResponseBody).toBe(200);
    await expect(
      confirmation.locator('.assistant__confirm-list > li .assistant__confirm-status')
    ).toHaveText('Completada');
    expect(assistantWrites).toHaveLength(1);
    const savedAction = assistantWrites[0]!;
    expect(savedAction.actionId).toMatch(/^[\da-f-]{36}$/i);
    expect(savedAction.path).toMatch(
      new RegExp(`/api/shopping/lists/${listId}/items/[^/]+/assistant-update$`)
    );
    expect(savedAction.headers['x-assistant-household-id']).toBe(householdId);
    expect(savedAction.body).toMatchObject({
      version: initial.version,
      changes: {
        name: 'Harina confirmada QA',
        quantity: 5,
        unit: 'kg',
        category: 'Despensa'
      },
      assistantAction: {
        operation: 'update_item',
        listId,
        before: {
          listName,
          name: itemName,
          quantity: 2,
          checked: false,
          deletedAt: null
        }
      }
    });

    const saved = await readList();
    expect(saved).toMatchObject({
      version: initial.version + 1,
      items: [
        expect.objectContaining({
          name: 'Harina confirmada QA',
          product_key: 'harina confirmada qa',
          quantity: 5,
          unit: 'kg',
          category: 'Despensa',
          checked: 0
        })
      ]
    });
    await page.reload();
    await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
    await expect(page.locator('[data-test="item-row"]')).toContainText('Harina confirmada QA');
    await expect(page.locator('[data-test="item-row"]')).toContainText('5');

    const replay = await page.request.patch(savedAction.path, {
      headers: {
        ...assistantHeaders,
        'x-assistant-action-id': savedAction.actionId!
      },
      data: savedAction.body
    });
    expect(replay.status(), await replay.text()).toBe(200);
    expect(await replay.json()).toMatchObject({ success: true, idempotent: true });
    expect(await readList()).toMatchObject({ version: initial.version + 1, items: saved.items });
    expect(pageErrors).toEqual([]);
    await capture(page, testInfo, 'shopping-item-update-saved');
  } finally {
    await provider.close();
  }
});

test('asistente global: cancelar propuesta/refino aborta proveedor, no escribe y libera reintentos', async ({
  page
}) => {
  const provider = await startCancellableAiProvider(pantryAddCandidate());
  try {
    await registerUser(page, 'Asistente cancelación E2E');
    await createHousehold(page, 'Hogar sintético para cancelación');
    await page.goto('/dashboard');
    const token = await tokenOf(page);
    await configureDeterministicAi(page, token, provider.baseUrl);

    await page.locator('[data-test="ai-assistant-open"]').click();
    const dialog = page.locator('.modal[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar asistente' }).click();
    await expect(dialog).not.toBeVisible();
    const before = assistantDatabaseSnapshot();

    const submitProposal = async () => {
      await page.locator('[data-test="ai-assistant-open"]').click();
      await page
        .locator('[data-test="ai-assistant-prompt"]')
        .fill('Añade lentejas a la despensa y revisa la propuesta.');
      await page.locator('[data-test="ai-assistant-submit"] button').click();
    };

    await submitProposal();
    await expect.poll(() => provider.requests.length, { timeout: 10_000 }).toBe(1);
    await page.locator('.modal[role="dialog"] .modal__close').click();
    await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
    await page.getByRole('button', { name: 'Descartar borrador' }).click();
    await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
    await expect.poll(() => provider.abortedRequests, { timeout: 10_000 }).toBe(1);
    expect(assistantDatabaseSnapshot()).toEqual(before);

    await submitProposal();
    await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
    expect(provider.requests).toHaveLength(2);
    expect(assistantDatabaseSnapshot()).toEqual(before);

    const action = page.locator('[data-action-id]').first();
    await action.locator('[data-test="ai-assistant-refine"] button').click();
    await expect(page.locator('[data-test="ai-assistant-refine-stage"]')).toBeVisible();
    await page.locator('#ai-assistant-refine-input').fill('Ajusta la cantidad a 750 g.');
    const refineButton = page.getByRole('button', { name: 'Actualizar propuestas' });
    await refineButton.click();
    await expect.poll(() => provider.requests.length, { timeout: 10_000 }).toBe(3);
    await expect(refineButton).toBeDisabled();
    // Exercise the handler guard too; native users cannot click the disabled button again.
    await refineButton.dispatchEvent('click');
    await page.waitForTimeout(250);
    expect(provider.requests).toHaveLength(3);
    expect(assistantDatabaseSnapshot()).toEqual(before);
    await page.locator('.modal[role="dialog"] .modal__close').click();
    await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
    await page.getByRole('button', { name: 'Descartar borrador' }).click();
    await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
    await expect.poll(() => provider.abortedRequests, { timeout: 10_000 }).toBe(2);
    expect(assistantDatabaseSnapshot()).toEqual(before);

    await submitProposal();
    await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
    expect(provider.requests).toHaveLength(4);
    expect(assistantDatabaseSnapshot()).toEqual(before);

    await page.getByRole('button', { name: 'Cerrar asistente' }).click();
    await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
    await page.getByRole('button', { name: 'Descartar borrador' }).click();
    expect(assistantDatabaseSnapshot()).toEqual(before);
  } finally {
    await provider.close();
  }
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
  await expect(review.locator('[data-test="ai-assistant-pantry-target"]')).toContainText('Otros');
  await expect(review.locator('[data-test="ai-assistant-pantry-target"]')).not.toContainText(
    'other'
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
  await expect(
    confirmation.locator('[data-test="ai-assistant-pantry-target-confirm"]')
  ).toContainText('Otros');
  await expect(
    confirmation.locator('[data-test="ai-assistant-pantry-target-confirm"]')
  ).not.toContainText('other');
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

test('asistente global: edita una receta propia tras revisión explícita y protege el replay', async ({
  page
}, testInfo) => {
  const recipeName = 'Lentejas actualización QA';
  const provider = await startDeterministicAiProvider(recipeUpdateCandidate(recipeName));
  const assistantWrites: Array<{ body: any; actionId: string | undefined }> = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.startsWith('/api/recipes/') &&
      new URL(request.url()).pathname.endsWith('/assistant-update')
    ) {
      assistantWrites.push({
        body: request.postDataJSON(),
        actionId: request.headers()['x-assistant-action-id']
      });
    }
  });

  try {
    await registerUser(page, 'Asistente edita receta E2E');
    await createHousehold(page, 'Hogar sintético receta');
    await page.goto('/dashboard');
    const token = await tokenOf(page);
    const authHeaders = { authorization: `Bearer ${token}` };
    await configureDeterministicAi(page, token, provider.baseUrl);

    const created = await page.request.post('/api/recipes', {
      headers: authHeaders,
      data: {
        name: recipeName,
        description: 'Receta sintética para pruebas aisladas.',
        servings: 2,
        ingredients: [
          { name: 'Cebolla', quantity: 100, unit: 'g' },
          { name: 'Lentejas', quantity: 200, unit: 'g' }
        ],
        steps: [{ stepNumber: 1, instruction: 'Sofríe la cebolla.' }]
      }
    });
    expect(created.status(), await created.text()).toBe(201);
    const recipe = (await created.json()).data as {
      id: string;
      name: string;
      servings: number;
      ingredients: Array<{ name: string; quantity: number; unit: string }>;
      steps: Array<{ stepNumber: number; instruction: string }>;
    };
    const readRecipe = async () => {
      const response = await page.request.get(`/api/recipes/${recipe.id}`, {
        headers: authHeaders
      });
      expect(response.status(), 'lectura de la receta sintética').toBe(200);
      return (await response.json()).data;
    };
    const before = await readRecipe();
    expect(before).toMatchObject({
      servings: 2,
      ingredients: expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 100 })
      ])
    });

    await page.locator('[data-test="ai-assistant-open"]').click();
    await page
      .locator('[data-test="ai-assistant-prompt"]')
      .fill('Reduce la cebolla de Lentejas actualización QA y aclara el paso 1.');
    const proposalResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/ai/assistant/proposals'
      );
    });
    await page.locator('[data-test="ai-assistant-submit"] button').click();
    const proposalResponse = await proposalResponsePromise;
    const proposalBody = await proposalResponse.text();
    expect(
      proposalResponse.status(),
      `${proposalBody}; proveedor recibió ${provider.requests.length} petición(es)`
    ).toBe(200);
    const review = page.locator('[data-test="ai-assistant-review"]');
    await expect(review).toBeVisible();
    await expect(review.locator('h2[tabindex="-1"]')).toBeFocused();
    await expect(review.locator('[data-test="ai-assistant-recipe-target"]')).toContainText(
      recipeName
    );
    expect(await readRecipe()).toMatchObject({
      servings: 2,
      ingredients: expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 100 })
      ]),
      steps: [{ stepNumber: 1, instruction: 'Sofríe la cebolla.' }]
    });
    expect(assistantWrites).toEqual([]);
    expect(provider.requests.at(-1)).not.toContain(recipe.id);
    const referenceDate = await page.evaluate(() => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
      return `${value('year')}-${value('month')}-${value('day')}`;
    });
    const providerRequest = JSON.parse(provider.requests.at(-1) ?? '{}');
    expect(providerRequest.messages[0].content).toContain(
      `Fecha local de referencia del cliente: ${referenceDate}`
    );

    await page.keyboard.press('Escape');
    const discardDialog = page.getByRole('dialog', { name: '¿Descartar este borrador?' });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole('button', { name: 'Descartar borrador' }).click();
    await expect(page.locator('.modal[role="dialog"]')).not.toBeVisible();
    expect(await readRecipe()).toEqual(before);
    expect(assistantWrites).toEqual([]);

    await page.locator('[data-test="ai-assistant-open"]').click();
    await page
      .locator('[data-test="ai-assistant-prompt"]')
      .fill('Reduce la cebolla de Lentejas actualización QA y aclara el paso 1.');
    const retryProposalResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/ai/assistant/proposals'
      );
    });
    await page.locator('[data-test="ai-assistant-submit"] button').click();
    expect((await retryProposalResponsePromise).status()).toBe(200);
    await expect(review).toBeVisible();
    expect(provider.requests).toHaveLength(2);

    const details = review.locator('details.assistant__details').first();
    await details.locator('summary').click();
    const ingredientChange = details.locator(
      '[data-test="ai-assistant-recipe-ingredient-changes"]'
    );
    await expect(ingredientChange).toContainText('Cebolla · 100 g');
    await expect(ingredientChange).toContainText('Cebolla · 75 g');
    const originalViewport = page.viewportSize();
    expect(originalViewport).not.toBeNull();
    for (const viewport of [
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
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction((height) => {
        const overlay = document.querySelector<HTMLElement>('.modal-overlay--visual-viewport');
        return overlay !== null && Number.parseFloat(getComputedStyle(overlay).height) <= height;
      }, viewport.height);
      const geometry = await page.evaluate(() => {
        const modal = document.querySelector<HTMLElement>('.modal[role="dialog"]');
        const body = modal?.querySelector<HTMLElement>('.modal__body');
        const rect = modal?.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          modalLeft: rect?.left ?? -1,
          modalRight: rect?.right ?? Infinity,
          modalTop: rect?.top ?? -1,
          modalBottom: rect?.bottom ?? Infinity,
          bodyWidth: body?.clientWidth ?? 0,
          bodyScrollWidth: body?.scrollWidth ?? Infinity,
          overflowingChildren: Array.from(body?.querySelectorAll<HTMLElement>('*') ?? [])
            .map((element) => ({
              tag: element.tagName.toLowerCase(),
              className: String(element.className),
              text: element.textContent?.trim().slice(0, 40),
              width: Math.round(element.getBoundingClientRect().width),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth
            }))
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .slice(0, 30)
        };
      });
      expect(
        geometry.documentWidth,
        `sin overflow en ${viewport.width}×${viewport.height}`
      ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.modalLeft).toBeGreaterThanOrEqual(0);
      expect(
        geometry.modalRight,
        `modal dentro del ancho en ${viewport.width}×${viewport.height}`
      ).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.modalTop).toBeGreaterThanOrEqual(0);
      expect(
        geometry.modalBottom,
        `modal dentro del alto en ${viewport.width}×${viewport.height}`
      ).toBeLessThanOrEqual(geometry.viewportHeight + 1);
      expect(
        geometry.bodyScrollWidth,
        `sin overflow interno en ${viewport.width}×${viewport.height}: ${JSON.stringify(geometry.overflowingChildren)}`
      ).toBeLessThanOrEqual(geometry.bodyWidth + 1);
    }
    await page.setViewportSize(originalViewport!);
    const quantity = ingredientChange.locator('input[type="number"]');
    await expect(quantity).toHaveAccessibleName('Cantidad');
    await quantity.scrollIntoViewIfNeeded();
    await quantity.fill('80');
    await expect(quantity).toHaveValue('80');
    await expect(ingredientChange).toContainText('Cebolla · 80 g');
    await expect(details.locator('textarea')).toHaveValue('Dora la cebolla a fuego medio.');
    await details.locator('textarea').fill('Dora la cebolla despacio.');
    expect(await readRecipe()).toMatchObject({
      ingredients: expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 100 })
      ]),
      steps: [{ stepNumber: 1, instruction: 'Sofríe la cebolla.' }]
    });
    expect(assistantWrites).toEqual([]);

    provider.setContent(
      recipeUpdateRefinementCandidate(recipeName, 80, 'Dora la cebolla lentamente.')
    );
    await page.locator('[data-test="ai-assistant-refine"] button').click();
    await expect(page.locator('[data-test="ai-assistant-refine-stage"]')).toBeVisible();
    await page.getByRole('button', { name: 'Ámbito de la revisión: Acción completa' }).click();
    await page.getByRole('option', { name: 'Sección: Instrucciones' }).click();
    await page.locator('#ai-assistant-refine-input').fill('Aclara solo el primer paso.');
    const refinementResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/ai/assistant/refine'
      );
    });
    await page.getByRole('button', { name: 'Actualizar propuestas' }).click();
    const refinementResponse = await refinementResponsePromise;
    expect(refinementResponse.status(), await refinementResponse.text()).toBe(200);
    await expect(review).toBeVisible();
    await expect(ingredientChange.locator('input[type="number"]')).toHaveValue('80');
    await expect(details.locator('textarea')).toHaveValue('Dora la cebolla lentamente.');
    expect(provider.requests).toHaveLength(3);
    expect(await readRecipe()).toEqual(before);
    expect(assistantWrites).toEqual([]);

    await details.locator('textarea').evaluate((element: HTMLTextAreaElement) => element.blur());
    await review.evaluate((element) =>
      element.closest<HTMLElement>('.modal__body')?.scrollTo(0, 0)
    );
    await capture(page, testInfo, 'recipe-update-review');
    if (testInfo.project.name === 'mobile-chrome') {
      await ingredientChange.scrollIntoViewIfNeeded();
      await capture(page, testInfo, 'recipe-update-review-fields-mobile');
      await review.evaluate((element) =>
        element.closest<HTMLElement>('.modal__body')?.scrollTo(0, 0)
      );
    }

    await page.getByRole('button', { name: 'Seleccionar todas' }).click();
    await page.locator('[data-test="ai-assistant-continue"] button').click();
    const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
    await expect(confirmation).toContainText(recipeName);
    await expect(confirmation).toContainText('Cebolla · 100 g');
    await expect(confirmation).toContainText('Cebolla · 80 g');
    await expect(confirmation).toContainText('Dora la cebolla lentamente.');
    expect(await readRecipe()).toMatchObject({
      ingredients: expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 100 })
      ])
    });
    expect(assistantWrites).toEqual([]);
    await capture(page, testInfo, 'recipe-update-confirm');

    const saveResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/recipes/${recipe.id}/assistant-update`
      );
    });
    await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status(), await saveResponse.text()).toBe(200);
    const savedAction = assistantWrites[0];
    expect(savedAction?.actionId).toBeTruthy();
    if (!savedAction?.actionId) throw new Error('No se capturó la acción confirmada.');
    expect(savedAction?.body).toMatchObject({
      changes: {
        ingredients: [{ operation: 'update', targetName: 'Cebolla', changes: { quantity: 80 } }],
        instructions: [
          { level: 'legacy', stepNumber: 1, instruction: 'Dora la cebolla lentamente.' }
        ]
      },
      assistantAction: { targetId: recipe.id }
    });
    expect(savedAction?.body.assistantAction.before).toMatchObject({
      name: recipeName,
      servings: 2,
      ingredients: expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 100 })
      ])
    });
    await expect(confirmation.locator('.assistant__confirm-status')).toHaveText('Completada');
    expect(await readRecipe()).toMatchObject({
      servings: 2,
      ingredients: expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 80 }),
        expect.objectContaining({ name: 'Lentejas', quantity: 200 })
      ]),
      steps: [{ stepNumber: 1, instruction: 'Dora la cebolla lentamente.' }]
    });

    await page.reload();
    expect(await readRecipe()).toMatchObject({
      ingredients: expect.arrayContaining([
        expect.objectContaining({ name: 'Cebolla', quantity: 80 })
      ]),
      steps: [{ stepNumber: 1, instruction: 'Dora la cebolla lentamente.' }]
    });
    const replay = await page.request.patch(`/api/recipes/${recipe.id}/assistant-update`, {
      headers: { ...authHeaders, 'x-assistant-action-id': savedAction.actionId },
      data: savedAction!.body
    });
    expect(replay.status(), await replay.text()).toBe(200);
    expect(await replay.json()).toMatchObject({ success: true, idempotent: true });
    expect((await readRecipe()).ingredients).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Cebolla', quantity: 80 })])
    );
    if (testInfo.project.name === 'mobile-chrome') {
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    }
  } finally {
    await provider.close();
  }
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

test('asistente global: resuelve y edita un evento propio con aprobación, rechazo y replay real', async ({
  page
}, testInfo) => {
  const provider = await startDeterministicAiProvider(calendarUpdateCandidate('No existe QA'));
  const assistantWrites: Array<{ body: any; actionId: string | undefined }> = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname.startsWith('/api/calendar/events/') &&
      new URL(request.url()).pathname.endsWith('/assistant-update')
    ) {
      assistantWrites.push({
        body: request.postDataJSON(),
        actionId: request.headers()['x-assistant-action-id']
      });
    }
  });

  try {
    await registerUser(page, 'Asistente edita evento E2E');
    await createHousehold(page, 'Hogar sintético edita evento');
    await page.goto('/dashboard');
    const token = await tokenOf(page);
    const authHeaders = { authorization: `Bearer ${token}` };
    const memberships = await page.request.get('/api/household/memberships', {
      headers: authHeaders
    });
    expect(memberships.status()).toBe(200);
    const householdId = (await memberships.json()).data.activeHouseholdId as string;
    expect(householdId).toBeTruthy();
    await configureDeterministicAi(page, token, provider.baseUrl);

    const ambiguousTitle = 'Ambigua calendario QA';
    await createCalendarEvent(page, token, householdId, ambiguousTitle, '09:00', '09:30');
    await createCalendarEvent(page, token, householdId, ambiguousTitle, '09:00', '10:00');
    const uniqueEvent = await createCalendarEvent(
      page,
      token,
      householdId,
      'Dentista calendario QA',
      '11:00',
      '11:30'
    );
    const noMatchCandidate = calendarUpdateCandidate('Evento inexistente QA');
    provider.setContent(noMatchCandidate);
    const noMatch = await page.request.post('/api/ai/assistant/proposals', {
      headers: { ...authHeaders, 'x-assistant-household-id': householdId },
      data: { prompt: 'Mueve el evento inexistente QA.', route: 'calendar' }
    });
    expect(noMatch.status(), await noMatch.text()).toBe(200);
    expect(await noMatch.json()).toMatchObject({
      data: {
        actions: [],
        questions: [expect.stringMatching(/no encontré exactamente un evento/i)]
      }
    });
    expect(assistantWrites).toEqual([]);

    provider.setContent(calendarUpdateCandidate(ambiguousTitle));
    const ambiguous = await page.request.post('/api/ai/assistant/proposals', {
      headers: { ...authHeaders, 'x-assistant-household-id': householdId },
      data: { prompt: 'Mueve el evento ambiguo QA.', route: 'calendar' }
    });
    expect(ambiguous.status(), await ambiguous.text()).toBe(200);
    expect(await ambiguous.json()).toMatchObject({
      data: { actions: [], questions: [expect.stringMatching(/más de un evento propio/i)] }
    });
    expect(assistantWrites).toEqual([]);

    const readUniqueEvent = async (date: string) =>
      (await calendarEventsOn(page, token, date)).filter((event) => event.id === uniqueEvent.id);
    expect(await readUniqueEvent('2026-10-20')).toHaveLength(1);
    provider.setContent(calendarUpdateCandidate(uniqueEvent.title, uniqueEvent.startTime));

    const openAssistantAndPropose = async () => {
      const responsePromise = page.waitForResponse((response) => {
        const path = new URL(response.url()).pathname;
        return response.request().method() === 'POST' && path === '/api/ai/assistant/proposals';
      });
      await page.locator('[data-test="ai-assistant-open"]').click();
      await page
        .locator('[data-test="ai-assistant-prompt"]')
        .fill('Mueve la cita del dentista calendario QA al día siguiente.');
      await page.locator('[data-test="ai-assistant-submit"] button').click();
      await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
      return responsePromise;
    };

    await openAssistantAndPropose();
    let review = page.locator('[data-test="ai-assistant-review"]');
    await expect(review.locator('[data-test="ai-assistant-calendar-target"]')).toContainText(
      'Dentista calendario QA'
    );
    await expect(review.locator('[data-test="ai-assistant-calendar-target"]')).toContainText(
      '2026-10-20'
    );
    await expect(review.locator('[data-test="ai-assistant-calendar-target"]')).toContainText(
      '11:00–11:30'
    );
    expect((await readUniqueEvent('2026-10-20'))[0]).toMatchObject({
      title: uniqueEvent.title,
      date: '2026-10-20',
      notes: 'Notas originales QA'
    });
    expect(assistantWrites).toEqual([]);
    expect(provider.requests.at(-1)).toBeTruthy();
    expect(provider.requests.at(-1)).not.toContain(uniqueEvent.id);

    await review.locator('[data-test="ai-assistant-remove"]').click();
    await expect(review.locator('.assistant__empty')).toBeVisible();
    expect((await readUniqueEvent('2026-10-20'))[0].date).toBe('2026-10-20');
    expect(assistantWrites).toEqual([]);
    await page.getByRole('button', { name: 'Cerrar asistente' }).click();
    await expect(page.getByRole('dialog', { name: '¿Descartar este borrador?' })).toBeVisible();
    await page.getByRole('button', { name: 'Descartar borrador' }).click();

    const uiProposalResponse = await openAssistantAndPropose();
    const uiProposal = await uiProposalResponse.json();
    review = page.locator('[data-test="ai-assistant-review"]');
    const details = review.locator('details.assistant__details').first();
    await details.locator('summary').click();
    const dateField = details.locator('input[type="date"]');
    const notesField = details.locator('textarea');
    await expect(dateField).toHaveAccessibleName('Fecha');
    await expect(notesField).toHaveAccessibleName('Notas');
    if (testInfo.project.name === 'mobile-chrome') {
      const editorTouchTargets = await details.evaluate((section) =>
        Array.from(
          section.querySelectorAll<HTMLElement>('input, textarea, button, [role="button"], summary')
        )
          .filter((control) => control.getClientRects().length > 0)
          .map((control) => {
            const target = control.matches('input[type="checkbox"]')
              ? ((control.closest('label') as HTMLElement | null) ?? control)
              : control;
            const bounds = target.getBoundingClientRect();
            return {
              control: control.getAttribute('type') ?? control.tagName.toLowerCase(),
              width: bounds.width,
              height: bounds.height
            };
          })
      );
      expect(editorTouchTargets.length).toBeGreaterThan(0);
      for (const target of editorTouchTargets) {
        expect(target.width, `${target.control} touch width`).toBeGreaterThanOrEqual(44);
        expect(target.height, `${target.control} touch height`).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(dateField).toHaveValue('2026-10-21');
    await dateField.fill('2026-10-22');
    await notesField.fill('Notas confirmadas QA');
    await notesField.focus();
    await expect(notesField).toBeFocused();
    expect((await readUniqueEvent('2026-10-20'))[0]).toMatchObject({
      date: '2026-10-20',
      notes: 'Notas originales QA'
    });
    expect(assistantWrites).toEqual([]);

    await notesField.evaluate((element: HTMLTextAreaElement) => element.blur());
    await review.evaluate((element) =>
      element.closest<HTMLElement>('.modal__body')?.scrollTo(0, 0)
    );
    await capture(page, testInfo, 'calendar-update-review');
    if (testInfo.project.name === 'mobile-chrome') {
      await notesField.scrollIntoViewIfNeeded();
      await capture(page, testInfo, 'calendar-update-review-fields-mobile');
      await review.evaluate((element) =>
        element.closest<HTMLElement>('.modal__body')?.scrollTo(0, 0)
      );
    }
    if (testInfo.project.name === 'chromium') {
      await page.setViewportSize({ width: 834, height: 1112 });
      await capture(page, testInfo, 'calendar-update-review-tablet');
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    await page.getByRole('button', { name: 'Seleccionar todas' }).click();
    await page.locator('[data-test="ai-assistant-continue"] button').click();
    const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
    await expect(confirmation).toContainText('Dentista calendario QA');
    await expect(confirmation).toContainText('2026-10-20');
    await expect(confirmation).toContainText('2026-10-22');
    await expect(confirmation).toContainText('Notas originales QA');
    await expect(confirmation).toContainText('Notas confirmadas QA');
    expect(await readUniqueEvent('2026-10-20')).toHaveLength(1);
    expect(assistantWrites).toEqual([]);
    await capture(page, testInfo, 'calendar-update-confirm');
    if (testInfo.project.name === 'chromium') {
      await page.setViewportSize({ width: 834, height: 1112 });
      await capture(page, testInfo, 'calendar-update-confirm-tablet');
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    const saveResponsePromise = page.waitForResponse((response) => {
      const path = new URL(response.url()).pathname;
      return response.request().method() === 'PATCH' && path.endsWith('/assistant-update');
    });
    await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
    const saveResponse = await saveResponsePromise;
    const saveBody = await saveResponse.json();
    const currentBeforeSubmit = (await readUniqueEvent('2026-10-20'))[0];
    expect(
      saveResponse.status(),
      JSON.stringify({
        saveBody,
        request: assistantWrites[0],
        uiTarget: uiProposal.data.actions[0],
        currentBeforeSubmit
      })
    ).toBe(200);
    await expect(
      confirmation.locator('.assistant__confirm-list > li .assistant__confirm-status')
    ).toHaveText('Completada');
    expect(assistantWrites).toHaveLength(1);
    expect(assistantWrites[0]).toMatchObject({
      body: {
        changes: {
          date: '2026-10-22',
          notes: 'Notas confirmadas QA'
        },
        assistantAction: {
          operation: 'update_event',
          targetId: uniqueEvent.id,
          householdId
        }
      }
    });
    const saved = (await readUniqueEvent('2026-10-22'))[0];
    expect(saved).toMatchObject({
      id: uniqueEvent.id,
      title: uniqueEvent.title,
      date: '2026-10-22',
      startTime: '11:00',
      endTime: '11:30',
      notes: 'Notas confirmadas QA'
    });
    await capture(page, testInfo, 'calendar-update-saved');

    const replay = await page.request.patch(
      `/api/calendar/events/${uniqueEvent.id}/assistant-update`,
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
    expect(await readUniqueEvent('2026-10-22')).toHaveLength(1);
    await page.reload();
    await expect(page.locator('[data-test="ai-assistant-open"]')).toBeVisible();
    expect((await readUniqueEvent('2026-10-22'))[0]).toMatchObject({
      date: '2026-10-22',
      notes: 'Notas confirmadas QA'
    });
    expect(provider.requests).toHaveLength(4);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    await provider.close();
  }
});

test('asistente global: evento obsoleto no pisa el cambio concurrente', async ({ page }) => {
  const provider = await startDeterministicAiProvider(calendarUpdateCandidate('Cita obsoleta QA'));
  const assistantResponses: number[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/assistant-update')) {
      assistantResponses.push(response.status());
    }
  });

  try {
    await registerUser(page, 'Asistente conflicto calendario E2E');
    await createHousehold(page, 'Hogar sintético conflicto calendario');
    await page.goto('/dashboard');
    const token = await tokenOf(page);
    const authHeaders = { authorization: `Bearer ${token}` };
    const memberships = await page.request.get('/api/household/memberships', {
      headers: authHeaders
    });
    expect(memberships.status()).toBe(200);
    const householdId = (await memberships.json()).data.activeHouseholdId as string;
    await configureDeterministicAi(page, token, provider.baseUrl);
    const target = await createCalendarEvent(
      page,
      token,
      householdId,
      'Cita obsoleta QA',
      '09:00',
      '09:30'
    );

    await page.locator('[data-test="ai-assistant-open"]').click();
    await page
      .locator('[data-test="ai-assistant-prompt"]')
      .fill('Mueve la cita obsoleta QA al día siguiente.');
    await page.locator('[data-test="ai-assistant-submit"] button').click();
    await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
    const concurrent = await page.request.patch(`/api/calendar/events/${target.id}`, {
      headers: { ...authHeaders, 'x-assistant-household-id': householdId },
      data: { notes: 'Cambio concurrente QA' }
    });
    expect(concurrent.status()).toBe(200);

    await page.getByRole('button', { name: 'Seleccionar todas' }).click();
    await page.locator('[data-test="ai-assistant-continue"] button').click();
    await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
    const row = page.locator('[data-test="ai-assistant-confirm"] .assistant__confirm-list > li');
    await expect(row.locator('.assistant__confirm-status')).toHaveText('Fallida');
    expect(assistantResponses).toEqual([409]);

    const saved = (await calendarEventsOn(page, token, '2026-10-20')).filter(
      (event) => event.id === target.id
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      date: '2026-10-20',
      notes: 'Cambio concurrente QA'
    });
  } finally {
    await provider.close();
  }
});

test('asistente global: cambio del hogar invalida la aprobación del evento', async ({ page }) => {
  const provider = await startDeterministicAiProvider(
    calendarUpdateCandidate('Cita cambio hogar QA')
  );
  const assistantResponses: number[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/assistant-update')) {
      assistantResponses.push(response.status());
    }
  });

  try {
    await registerUser(page, 'Asistente cambio hogar E2E');
    await createHousehold(page, 'Hogar activo sintético');
    await page.goto('/dashboard');
    const token = await tokenOf(page);
    const authHeaders = { authorization: `Bearer ${token}` };
    const memberships = await page.request.get('/api/household/memberships', {
      headers: authHeaders
    });
    expect(memberships.status()).toBe(200);
    const firstHouseholdId = (await memberships.json()).data.activeHouseholdId as string;

    const createdSecondHousehold = await page.request.post('/api/household', {
      headers: authHeaders,
      data: { name: 'Hogar alternativo sintético', sharedPantry: true }
    });
    expect(createdSecondHousehold.status(), await createdSecondHousehold.text()).toBe(201);
    const secondHouseholdId = (await createdSecondHousehold.json()).data.id as string;
    const restoreFirstHousehold = await page.request.post('/api/household/active', {
      headers: authHeaders,
      data: { householdId: firstHouseholdId }
    });
    expect(restoreFirstHousehold.status()).toBe(200);
    await page.reload();
    await expect(page.locator('[data-test="household-switcher"]')).toBeVisible();
    await configureDeterministicAi(page, token, provider.baseUrl);

    const target = await createCalendarEvent(
      page,
      token,
      firstHouseholdId,
      'Cita cambio hogar QA',
      '09:00',
      '09:30'
    );
    await page.locator('[data-test="ai-assistant-open"]').click();
    await page
      .locator('[data-test="ai-assistant-prompt"]')
      .fill('Mueve la cita cambio hogar QA al día siguiente.');
    await page.locator('[data-test="ai-assistant-submit"] button').click();
    await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
    await page.getByRole('button', { name: 'Seleccionar todas' }).click();
    await page.locator('[data-test="ai-assistant-continue"] button').click();

    const switched = await page.request.post('/api/household/active', {
      headers: authHeaders,
      data: { householdId: secondHouseholdId }
    });
    expect(switched.status()).toBe(200);

    await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
    const row = page.locator('[data-test="ai-assistant-confirm"] .assistant__confirm-list > li');
    await expect(row.locator('.assistant__confirm-status')).toHaveText('Fallida');
    expect(assistantResponses).toEqual([409]);

    const restoreForRead = await page.request.post('/api/household/active', {
      headers: authHeaders,
      data: { householdId: firstHouseholdId }
    });
    expect(restoreForRead.status()).toBe(200);
    const saved = (await calendarEventsOn(page, token, '2026-10-20')).filter(
      (event) => event.id === target.id
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      date: '2026-10-20',
      notes: 'Notas originales QA'
    });
  } finally {
    await provider.close();
  }
});

test('asistente global: difiere el diálogo hasta abrir y reutiliza el código al reabrir', async ({
  page
}) => {
  const scriptRequests: string[] = [];
  const assistantChunkUrls = new Set<string>();
  const scriptResponseChecks: Promise<void>[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scriptRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return;
    scriptResponseChecks.push(
      response
        .text()
        .then((body) => {
          if (body.includes('assistant__')) assistantChunkUrls.add(response.url());
        })
        .catch(() => undefined)
    );
  });

  await registerUser(page, 'Asistente carga diferida E2E');
  await createHousehold(page, 'Hogar carga diferida sintético');
  await page.goto('/dashboard');

  const launcher = page.locator('[data-test="ai-assistant-open"]');
  await expect(launcher).toBeVisible();
  await page.waitForTimeout(150);
  await Promise.all(scriptResponseChecks);
  expect(assistantChunkUrls.size).toBe(0);
  const scriptsBeforeOpen = scriptRequests.length;

  await launcher.click();
  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect.poll(() => assistantChunkUrls.size).toBe(1);
  const scriptsAfterFirstOpen = scriptRequests.length;
  expect(scriptsAfterFirstOpen).toBeGreaterThan(scriptsBeforeOpen);
  const [assistantChunkUrl] = [...assistantChunkUrls];
  expect(scriptRequests.filter((url) => url === assistantChunkUrl)).toHaveLength(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await launcher.click();
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(150);
  expect(assistantChunkUrls.size).toBe(1);
  expect(scriptRequests.filter((url) => url === assistantChunkUrl)).toHaveLength(1);
  expect(scriptRequests).toHaveLength(scriptsAfterFirstOpen);
});

test('asistente global: explica que falta configurar IA sin escribir datos', async ({
  page
}, testInfo) => {
  await registerUser(page, 'Asistente sin proveedor E2E');
  await createHousehold(page, 'Hogar sin proveedor sintético');
  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  const databaseBeforeRequest = assistantDatabaseSnapshot();
  const proposalResponse = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/api/ai/assistant/proposals'
    );
  });
  await dialog.locator('[data-test="ai-assistant-prompt"]').fill('Añade arroz a la despensa.');
  await dialog.locator('[data-test="ai-assistant-submit"] button').click();

  const response = await proposalResponse;
  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    code: 'AI_NOT_CONFIGURED'
  });
  const assistantError = dialog.locator('[data-test="ai-assistant-error"]');
  await expect(assistantError).toHaveText(
    'Configura un proveedor de IA antes de usar el asistente.'
  );
  const errorBounds = await assistantError.boundingBox();
  const bodyBounds = await dialog.locator('.modal__body').boundingBox();
  expect(errorBounds).not.toBeNull();
  expect(bodyBounds).not.toBeNull();
  expect(errorBounds!.y).toBeGreaterThanOrEqual(bodyBounds!.y);
  expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(
    bodyBounds!.y + bodyBounds!.height
  );
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeRequest);
  await capture(page, testInfo, 'missing-ai-provider-error');
});

test('asistente global: muestra en inglés el error de proveedor sin configurar', async ({
  page
}, testInfo) => {
  await registerUser(page, 'Assistant without provider E2E');
  await createHousehold(page, 'Synthetic household without provider');
  await page.addInitScript(() => localStorage.setItem('hogar:v1:language', 'en'));
  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.getByRole('dialog', { name: 'Assistant' });
  await expect(dialog.getByRole('heading', { name: 'Assistant' })).toBeVisible();
  await expect(dialog.locator('[data-test="ai-assistant-prompt"]')).toHaveAttribute(
    'placeholder',
    'Tell the AI what to do.\nE.g. add milk or create a task.'
  );
  const databaseBeforeRequest = assistantDatabaseSnapshot();
  const proposalResponse = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/api/ai/assistant/proposals'
    );
  });
  await dialog.locator('[data-test="ai-assistant-prompt"]').fill('Add rice to the pantry.');
  await dialog.locator('[data-test="ai-assistant-submit"] button').click();

  const response = await proposalResponse;
  expect(response.status()).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    success: false,
    code: 'AI_NOT_CONFIGURED'
  });
  const assistantError = dialog.locator('[data-test="ai-assistant-error"]');
  await expect(assistantError).toHaveText('Configure an AI provider before using the assistant.');
  const errorBounds = await assistantError.boundingBox();
  const bodyBounds = await dialog.locator('.modal__body').boundingBox();
  expect(errorBounds).not.toBeNull();
  expect(bodyBounds).not.toBeNull();
  expect(errorBounds!.y).toBeGreaterThanOrEqual(bodyBounds!.y);
  expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(
    bodyBounds!.y + bodyBounds!.height
  );
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeRequest);
  await capture(page, testInfo, 'missing-ai-provider-error-en');
});

test('asistente global: una ráfaga de envíos genera una sola petición efímera', async ({
  page
}) => {
  const provider = await startDeterministicAiProvider(pantryAddCandidate(), 500);
  let proposalRequests = 0;
  const proposalStatuses: number[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/ai/assistant/proposals'
    ) {
      proposalRequests += 1;
    }
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/ai/assistant/proposals') {
      proposalStatuses.push(response.status());
    }
  });

  try {
    await registerUser(page, 'Asistente deduplicación E2E');
    await createHousehold(page, 'Hogar deduplicación sintético');
    await page.goto('/dashboard');
    const token = await tokenOf(page);
    await configureDeterministicAi(page, token, provider.baseUrl);

    const databaseBeforeProposal = assistantDatabaseSnapshot();
    await page.locator('[data-test="ai-assistant-open"]').click();
    await page.locator('[data-test="ai-assistant-prompt"]').fill('Añade lentejas a la despensa.');
    const submit = page.locator('[data-test="ai-assistant-submit"] button');
    await expect(submit).toBeEnabled();
    const dispatchedClicks = await submit.evaluate((button) => {
      let count = 0;
      const onClick = () => count++;
      button.addEventListener('click', onClick, { capture: true });
      for (let index = 0; index < 2; index += 1) {
        button.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
        );
      }
      button.removeEventListener('click', onClick, { capture: true });
      return count;
    });
    expect(dispatchedClicks).toBe(2);

    await expect.poll(() => provider.requests.length).toBe(1);
    await page.waitForTimeout(150);
    expect(proposalRequests).toBe(1);
    expect(provider.requests).toHaveLength(1);
    await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
    expect(proposalStatuses).toEqual([200]);
    expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeProposal);
  } finally {
    await provider.close();
  }
});

test('asistente global: cerrar aborta el dictado y descarta callbacks tardíos', async ({
  page
}) => {
  await installSpeechRecognitionStub(page);
  let proposalRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/ai/assistant/proposals'
    ) {
      proposalRequests += 1;
    }
  });

  await registerUser(page, 'Asistente cierre de voz E2E');
  await createHousehold(page, 'Hogar cierre de voz sintético');
  await page.goto('/dashboard');
  const launcher = page.locator('[data-test="ai-assistant-open"]');
  await launcher.click();

  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  const voiceControls = dialog.locator('.assistant__voice-controls');
  await voiceControls.getByRole('button', { name: 'Dictar petición' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Escuchando; puedes corregir la transcripción' })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar asistente' }).click();
  await expect(dialog).toBeHidden();
  const abortedOnClose = await page.evaluate(() => {
    const recognition = (
      window as typeof window & { __assistantSpeechRecognition?: BrowserSpeechStubControl }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.emitFinal('Transcripción tardía que debe descartarse');
    return recognition.aborted;
  });
  expect(abortedOnClose).toBe(true);
  expect(proposalRequests).toBe(0);

  await launcher.click();
  const reopenedPrompt = page.locator('[data-test="ai-assistant-prompt"]');
  await expect(reopenedPrompt).toBeVisible();
  await expect(reopenedPrompt).toHaveValue('');
  expect(proposalRequests).toBe(0);
});

test('asistente global: muestra error si el dictado termina sin transcripción', async ({
  page
}, testInfo) => {
  await installSpeechRecognitionStub(page);
  let proposalRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/ai/assistant/proposals'
    ) {
      proposalRequests += 1;
    }
  });

  await registerUser(page, 'Asistente sin transcripción E2E');
  await createHousehold(page, 'Hogar sin transcripción sintético');
  await page.goto('/dashboard');
  const databaseBeforeVoice = assistantDatabaseSnapshot();
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.locator('.modal[role="dialog"]');
  const voiceControls = dialog.locator('.assistant__voice-controls');
  await voiceControls.getByRole('button', { name: 'Dictar petición' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Escuchando; puedes corregir la transcripción' })
  ).toBeVisible();

  await page.evaluate(() => {
    const recognition = (
      window as typeof window & { __assistantSpeechRecognition?: BrowserSpeechStubControl }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.finish();
  });

  const voiceError = dialog.locator('.assistant__error[role="alert"]');
  await expect(voiceError).toContainText('No se recibió voz.');
  await expect(voiceControls.getByRole('button', { name: 'Dictar petición' })).toBeVisible();
  await expect(voiceControls.getByRole('button', { name: 'Terminar dictado' })).toHaveCount(0);
  const errorBounds = await voiceError.boundingBox();
  const bodyBounds = await dialog.locator('.modal__body').boundingBox();
  expect(errorBounds).not.toBeNull();
  expect(bodyBounds).not.toBeNull();
  expect(errorBounds!.y).toBeGreaterThanOrEqual(bodyBounds!.y);
  expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(
    bodyBounds!.y + bodyBounds!.height
  );
  expect(proposalRequests).toBe(0);
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeVoice);
  await capture(page, testInfo, 'voice-no-transcript-error');
});

test('asistente global: guía si falla el servicio de dictado del navegador', async ({
  page
}, testInfo) => {
  await installSpeechRecognitionStub(page);
  await registerUser(page, 'Asistente servicio de voz E2E');
  await createHousehold(page, 'Hogar servicio de voz sintético');
  await page.goto('/dashboard');
  if (testInfo.project.name === 'mobile-chrome') {
    await page.setViewportSize({ width: 320, height: 568 });
  }
  const databaseBeforeVoice = assistantDatabaseSnapshot();
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.locator('.modal[role="dialog"]');
  const voiceControls = dialog.locator('.assistant__voice-controls');
  await voiceControls.getByRole('button', { name: 'Dictar petición' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Escuchando; puedes corregir la transcripción' })
  ).toBeVisible();

  await page.evaluate(() => {
    const recognition = (
      window as typeof window & { __assistantSpeechRecognition?: BrowserSpeechStubControl }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.fail('network');
  });

  const voiceError = dialog.locator('.assistant__error[role="alert"]');
  await expect(voiceError).toContainText('Si usas Brave');
  await expect(voiceError).toContainText('Chrome o Edge');
  await expect(voiceError).toContainText('Win+H');
  await expect(voiceError).toContainText('reconocimiento online');
  await expect(voiceControls.getByRole('button', { name: 'Dictar petición' })).toBeVisible();
  await expect(voiceError).toBeInViewport();
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeVoice);
  await capture(page, testInfo, 'voice-service-fallback');
});

test('asistente global: conserva texto sin avisos de voz si el navegador no ofrece dictado', async ({
  page
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: undefined
    });
  });
  await registerUser(page, 'Asistente navegador sin dictado E2E');
  await createHousehold(page, 'Hogar sin dictado sintético');
  await page.goto('/dashboard');
  if (testInfo.project.name === 'mobile-chrome') {
    await page.setViewportSize({ width: 320, height: 568 });
  }

  const databaseBefore = assistantDatabaseSnapshot();
  let proposalRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/ai/assistant/proposals')) {
      proposalRequests += 1;
    }
  });
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  const fallback = dialog.locator('.assistant__prompt-shell .assistant__hint[role="note"]');
  await expect(fallback).toContainText('El reconocimiento de voz no está disponible');
  await expect(dialog.getByRole('button', { name: 'Dictar petición' })).toHaveCount(0);
  await expect(dialog.locator('.assistant__voice-warning')).toHaveCount(0);
  await expect(dialog.locator('details.assistant__privacy')).toHaveCount(0);

  const prompt = dialog.locator('[data-test="ai-assistant-prompt"]');
  await expect(prompt).toBeVisible();
  await expect(prompt).toBeEnabled();
  await prompt.fill('Añade lentejas a la despensa');
  await expect(prompt).toHaveValue('Añade lentejas a la despensa');
  expect(proposalRequests).toBe(0);
  expect(assistantDatabaseSnapshot()).toEqual(databaseBefore);
  await capture(page, testInfo, 'voice-unsupported-browser');
});

test('asistente global: traduce el fallback de dictado al inglés', async ({ page }, testInfo) => {
  await installSpeechRecognitionStub(page);
  await registerUser(page, 'Assistant English voice fallback E2E');
  await createHousehold(page, 'Synthetic English voice household');
  await page.addInitScript(() => localStorage.setItem('hogar:v1:language', 'en'));
  await page.goto('/dashboard');

  const databaseBeforeVoice = assistantDatabaseSnapshot();
  await page.locator('[data-test="ai-assistant-open"]').click();

  const dialog = page.getByRole('dialog', { name: 'Assistant' });
  await expect(dialog.getByRole('heading', { name: 'Assistant' })).toBeVisible();
  await expect(dialog.locator('[data-test="ai-assistant-prompt"]')).toHaveAttribute(
    'placeholder',
    'Tell the AI what to do.\nE.g. add milk or create a task.'
  );
  const privacy = dialog.locator('details.assistant__privacy');
  await expect(privacy).toHaveJSProperty('open', false);
  await expect(privacy.locator('summary')).toContainText('Learn more');
  await expect(dialog.locator('.assistant__voice-note')).toBeHidden();
  const voiceControls = dialog.locator('.assistant__voice-controls');
  await voiceControls.getByRole('button', { name: 'Dictate request' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Listening; you can edit the transcript' })
  ).toBeVisible();

  await page.evaluate(() => {
    const recognition = (
      window as typeof window & { __assistantSpeechRecognition?: BrowserSpeechStubControl }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.fail('network');
  });

  const voiceError = dialog.locator('.assistant__error[role="alert"]');
  await expect(voiceError).toContainText('If you use Brave');
  await expect(voiceError).toContainText('Chrome or Edge');
  await expect(voiceError).toContainText('Win+H');
  await expect(voiceError).toContainText('online recognition');
  await expect(voiceError).toBeInViewport();
  expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeVoice);
  await capture(page, testInfo, 'voice-service-fallback-en');
});

test('asistente global: smoke opt-in con micrófono físico y frase sintética', async ({
  page
}, testInfo) => {
  test.skip(
    process.env.HOGARIA_AI_ASSISTANT_PHYSICAL_MIC_SMOKE !== '1',
    'requiere autorización, preflight y Chrome con micrófono físico'
  );
  test.skip(testInfo.project.name !== 'chromium', 'el smoke usa solo Chrome de escritorio');
  test.skip(!process.env.E2E_CHROME_BIN, 'requiere E2E_CHROME_BIN apuntando a Chrome estable');

  let proposalRequests = 0;
  await page.route('**/api/ai/assistant/proposals', async (route, request) => {
    if (request.method() === 'POST') proposalRequests += 1;
    await route.abort();
  });
  await registerUser(page, 'Asistente micrófono físico E2E');
  await createHousehold(page, 'Hogar micrófono físico sintético');
  await page.goto('/dashboard');
  await page.context().grantPermissions(['microphone'], { origin: new URL(page.url()).origin });

  const dialog = page.locator('.modal[role="dialog"]');
  await page.locator('[data-test="ai-assistant-open"]').click();
  await expect(dialog).toBeVisible();
  const privacy = dialog.locator('details.assistant__privacy');
  await privacy.locator('summary').click();
  await expect(privacy.locator('.assistant__voice-note')).toContainText('fuera de tu dispositivo');
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0);

  const defaultMicrophone = await page.evaluate(async () => {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput'
    );
    return inputs.find((device) => device.deviceId === 'default')?.label ?? '';
  });
  expect(defaultMicrophone).toMatch(/HD Pro Webcam C920/i);
  expect(defaultMicrophone).not.toMatch(/ManyCam|WO Mic/i);
  const localVoiceName = localSpanishSpeechVoiceName();
  test.skip(!localVoiceName, 'requiere voz de sistema local es-ES; no se inicia el micrófono');

  const prompt = dialog.locator('[data-test="ai-assistant-prompt"]');
  const voiceStart = dialog.locator('[data-test="ai-assistant-voice-start"] button');
  const voiceStop = dialog.locator('[data-test="ai-assistant-voice-stop"] button');
  const databaseBeforeVoice = assistantDatabaseSnapshot();
  await voiceStart.click();
  await expect(voiceStop).toBeVisible();

  try {
    speakSyntheticSpanishPhrase(localVoiceName!);

    await expect
      .poll(() => prompt.inputValue(), { timeout: 30_000 })
      .toMatch(/lentejas[\s\S]*despensa/i);
    await voiceStop.click();
    await expect(voiceStart).toBeVisible();
    expect(assistantDatabaseSnapshot()).toEqual(databaseBeforeVoice);
    expect(proposalRequests).toBe(0);
  } finally {
    if (await voiceStop.isVisible().catch(() => false)) {
      await voiceStop.click().catch(() => undefined);
    }
  }
});

test('asistente global: navegar durante dictado libera voz y conserva el borrador', async ({
  page
}) => {
  await installSpeechRecognitionStub(page);
  let proposalRequests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/ai/assistant/proposals'
    ) {
      proposalRequests += 1;
    }
  });

  const viewport =
    (page.viewportSize()?.width ?? 0) < 1024
      ? { width: 320, height: 568 }
      : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
  await registerUser(page, 'Asistente navegación voz E2E');
  await createHousehold(page, 'Hogar navegación voz sintético');
  await page.goto('/dashboard');

  if (viewport.width < 1024) await page.locator('.header__menu').click();
  await page.locator('.sidebar__nav a[href="/shopping"]').click();
  await expect(page).toHaveURL(/\/shopping$/);

  await page.locator('[data-test="ai-assistant-open"]').click();
  const dialog = page.locator('.modal[role="dialog"]');
  const voiceControls = dialog.locator('.assistant__voice-controls');
  const prompt = dialog.locator('[data-test="ai-assistant-prompt"]');
  await voiceControls.getByRole('button', { name: 'Dictar petición' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'Escuchando; puedes corregir la transcripción' })
  ).toBeVisible();

  await page.evaluate((transcript) => {
    const recognition = (
      window as typeof window & { __assistantSpeechRecognition?: BrowserSpeechStubControl }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.emitFinal(transcript);
  }, 'Añade lentejas');
  await expect(prompt).toHaveValue('Añade lentejas');

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(dialog).toBeVisible();
  await expect(voiceControls.getByRole('button', { name: 'Dictar petición' })).toBeVisible();
  const aborted = await page.evaluate((transcript) => {
    const recognition = (
      window as typeof window & { __assistantSpeechRecognition?: BrowserSpeechStubControl }
    ).__assistantSpeechRecognition;
    if (!recognition) throw new Error('Speech recognition stub was not started');
    recognition.emitFinal(transcript);
    return recognition.aborted;
  }, 'Añade lentejas y harina');

  expect(aborted).toBe(true);
  await expect(prompt).toHaveValue('Añade lentejas');
  await expect(voiceControls.getByRole('button', { name: 'Dictar petición' })).toBeVisible();
  await expect(voiceControls.getByRole('button', { name: 'Terminar dictado' })).toHaveCount(0);
  expect(proposalRequests).toBe(0);
});

test('asistente global: oculta el FAB cuando visualViewport reduce espacio móvil', async ({
  page
}) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await registerUser(page, 'Asistente teclado móvil E2E');
  await createHousehold(page, 'Hogar teclado móvil sintético');
  await page.goto('/dashboard');

  const launcher = page.locator('[data-test="ai-assistant-open"]');
  await expect(launcher).toBeVisible();

  await page.evaluate(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) throw new Error('Visual viewport is unavailable');
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      get: () => window.innerHeight - 250
    });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(launcher).toBeHidden();

  await page.evaluate(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) throw new Error('Visual viewport is unavailable');
    Reflect.deleteProperty(visualViewport, 'height');
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(launcher).toBeVisible();
});

test('asistente global: adapta el diálogo cuando aparece el teclado virtual', async ({
  page
}, testInfo) => {
  const viewport = { width: 393, height: 851 };
  const desktopViewport = { width: 1440, height: 900 };
  await page.setViewportSize(testInfo.project.name === 'chromium' ? desktopViewport : viewport);
  await registerUser(page, 'Asistente teclado modal E2E');
  await createHousehold(page, 'Hogar teclado modal sintético');
  await page.goto('/dashboard');

  const launcher = page.locator('[data-test="ai-assistant-open"]');
  await launcher.click();
  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  if (testInfo.project.name === 'chromium') {
    await capture(page, testInfo, 'assistant-modal-desktop');
  }
  await page.setViewportSize(viewport);
  const prompt = dialog.locator('[data-test="ai-assistant-prompt"]');
  await prompt.focus();
  await expect(prompt).toBeFocused();

  await page.evaluate(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) throw new Error('Visual viewport is unavailable');
    Object.defineProperty(visualViewport, 'height', {
      configurable: true,
      get: () => window.innerHeight - 250
    });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(launcher).toBeHidden();

  const geometry = await page.evaluate(() => {
    const visualViewport = window.visualViewport;
    const dialog = document.querySelector<HTMLElement>('.modal[role="dialog"]');
    const body = document.querySelector<HTMLElement>('.modal__body');
    const footer = document.querySelector<HTMLElement>('.modal__footer');
    const prompt = document.querySelector<HTMLElement>('[data-test="ai-assistant-prompt"]');
    const rect = (element: HTMLElement | null) => {
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    };
    return {
      visualViewportHeight: visualViewport?.height ?? window.innerHeight,
      layoutViewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: visualViewport?.width ?? window.innerWidth,
      dialog: rect(dialog),
      prompt: rect(prompt),
      footer: rect(footer),
      bodyClientHeight: body?.clientHeight ?? 0,
      bodyScrollHeight: body?.scrollHeight ?? 0,
      promptFocused: document.activeElement === prompt
    };
  });

  await capture(page, testInfo, 'assistant-modal-virtual-keyboard');
  expect(geometry.visualViewportHeight).toBeLessThan(geometry.layoutViewportHeight - 160);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.dialog?.top ?? -1).toBeGreaterThanOrEqual(0);
  expect(geometry.dialog?.bottom ?? Infinity).toBeLessThanOrEqual(
    geometry.visualViewportHeight + 1
  );
  expect(geometry.footer?.bottom ?? Infinity).toBeLessThanOrEqual(
    geometry.visualViewportHeight + 1
  );
  expect(geometry.prompt?.top ?? -1).toBeGreaterThanOrEqual(geometry.dialog?.top ?? 0);
  expect(geometry.prompt?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.footer?.top ?? -1);
  expect(geometry.bodyClientHeight).toBeGreaterThan(0);
  expect(geometry.promptFocused).toBe(true);
});

test('asistente global: respeta safe-area emulada en FAB y diálogo móvil', async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'requiere viewport móvil Chromium');

  const safeArea = { top: 36, right: 20, bottom: 48, left: 20 };
  await page.setViewportSize({ width: 320, height: 568 });
  await registerUser(page, 'Asistente safe area E2E');
  await createHousehold(page, 'Hogar safe area sintético');
  await page.goto('/dashboard');

  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: safeArea });
  const emulatedInsets = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = `
      position: fixed;
      top: env(safe-area-inset-top);
      right: env(safe-area-inset-right);
      bottom: env(safe-area-inset-bottom);
      left: env(safe-area-inset-left);
    `;
    document.body.append(probe);
    const styles = getComputedStyle(probe);
    const result = {
      top: Number.parseFloat(styles.top),
      right: Number.parseFloat(styles.right),
      bottom: Number.parseFloat(styles.bottom),
      left: Number.parseFloat(styles.left)
    };
    probe.remove();
    return result;
  });
  expect(emulatedInsets).toEqual(safeArea);

  const layoutViewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  expect(Math.abs(layoutViewport.width - 320)).toBeLessThanOrEqual(1);
  expect(Math.abs(layoutViewport.height - 568)).toBeLessThanOrEqual(1);

  const launcher = page.locator('[data-test="ai-assistant-open"]');
  await expect(launcher).toBeVisible();
  const launcherBounds = await launcher.boundingBox();
  expect(launcherBounds).not.toBeNull();
  expect(launcherBounds!.x).toBeGreaterThanOrEqual(safeArea.left - 1);
  expect(launcherBounds!.y).toBeGreaterThanOrEqual(safeArea.top - 1);
  expect(launcherBounds!.x + launcherBounds!.width).toBeLessThanOrEqual(
    layoutViewport.width - safeArea.right + 1
  );
  expect(launcherBounds!.y + launcherBounds!.height).toBeLessThanOrEqual(
    layoutViewport.height - safeArea.bottom + 1
  );
  await capture(page, testInfo, 'assistant-safe-area-fab');

  await launcher.click();
  const dialog = page.locator('.modal[role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async (element) => {
    const overlay = element.closest<HTMLElement>('.modal-overlay');
    if (!overlay) throw new Error('Assistant modal overlay is missing');
    await Promise.all(
      overlay
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined))
    );
  });
  const geometry = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>('.modal-overlay--visual-viewport');
    const dialog = document.querySelector<HTMLElement>('.modal[role="dialog"]');
    if (!overlay || !dialog) throw new Error('Assistant modal geometry is unavailable');
    const bounds = dialog.getBoundingClientRect();
    const styles = getComputedStyle(overlay);
    return {
      paddingTop: Number.parseFloat(styles.paddingTop),
      paddingRight: Number.parseFloat(styles.paddingRight),
      paddingBottom: Number.parseFloat(styles.paddingBottom),
      paddingLeft: Number.parseFloat(styles.paddingLeft),
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      viewportWidth: window.visualViewport?.width ?? window.innerWidth,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight
    };
  });
  expect(geometry.paddingTop).toBeGreaterThanOrEqual(safeArea.top);
  expect(geometry.paddingRight).toBeGreaterThanOrEqual(safeArea.right);
  expect(geometry.paddingBottom).toBeGreaterThanOrEqual(safeArea.bottom);
  expect(geometry.paddingLeft).toBeGreaterThanOrEqual(safeArea.left);
  expect(geometry.left).toBeGreaterThanOrEqual(safeArea.left - 1);
  expect(geometry.top).toBeGreaterThanOrEqual(safeArea.top - 1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - safeArea.right + 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - safeArea.bottom + 1);
  await capture(page, testInfo, 'assistant-safe-area-dialog');

  await session.detach();
});

type ChromeHeapSnapshot = {
  snapshot: {
    meta: {
      node_fields: string[];
      node_types: string[][];
      edge_fields: string[];
      edge_types: string[][];
    };
  };
  nodes: number[];
  edges: number[];
  strings: string[];
};

type HeapRetainerStep = {
  nodeIndex: number;
  viaEdgeType: string | null;
  viaEdgeName: string | null;
};

type HeapRetainerSearchResult = {
  rootNodeFound: boolean;
  searchTruncated: boolean;
  path: HeapRetainerStep[] | null;
};

function safeHeapEdgeName(name: string | null): string | null {
  if (name === null) return null;
  if (name.startsWith('Symbol(') && name.endsWith(')') && name.length <= 80) {
    return '<symbol-property>';
  }
  return /^[A-Za-z_$][A-Za-z0-9_$.:\-]{0,79}$/.test(name) || /^#[0-9]{1,6}$/.test(name)
    ? name
    : '<redacted>';
}

function findHeapRetainerPath(
  snapshot: ChromeHeapSnapshot,
  targetNodeIndex: number
): HeapRetainerSearchResult {
  const nodeFieldIndex = new Map(
    snapshot.snapshot.meta.node_fields.map((name, index) => [name, index])
  );
  const edgeFieldIndex = new Map(
    snapshot.snapshot.meta.edge_fields.map((name, index) => [name, index])
  );
  const nodeStride = snapshot.snapshot.meta.node_fields.length;
  const edgeStride = snapshot.snapshot.meta.edge_fields.length;
  const typeField = nodeFieldIndex.get('type');
  const nameField = nodeFieldIndex.get('name');
  const edgeCountField = nodeFieldIndex.get('edge_count');
  const edgeTypeField = edgeFieldIndex.get('type');
  const edgeNameField = edgeFieldIndex.get('name_or_index');
  const targetNodeField = edgeFieldIndex.get('to_node');
  const nodeTypes = snapshot.snapshot.meta.node_types[0];
  const edgeTypes = snapshot.snapshot.meta.edge_types[0];
  const nodeCount = snapshot.nodes.length / nodeStride;

  if (
    !Number.isInteger(nodeCount) ||
    nodeStride === 0 ||
    edgeStride === 0 ||
    typeField === undefined ||
    nameField === undefined ||
    edgeCountField === undefined ||
    edgeTypeField === undefined ||
    edgeNameField === undefined ||
    targetNodeField === undefined ||
    targetNodeIndex < 0 ||
    targetNodeIndex >= nodeCount
  ) {
    return { rootNodeFound: false, searchTruncated: false, path: null };
  }

  const nodeType = (index: number) => nodeTypes[snapshot.nodes[index * nodeStride + typeField]];
  const nodeName = (index: number) =>
    snapshot.strings[snapshot.nodes[index * nodeStride + nameField]];
  const rootNodeIndex = Array.from({ length: nodeCount }, (_, index) => index).find(
    (index) => nodeType(index) === 'synthetic' && nodeName(index) === '(GC roots)'
  );
  if (rootNodeIndex === undefined) {
    return { rootNodeFound: false, searchTruncated: false, path: null };
  }

  const incoming = new Map<
    number,
    Array<{ ownerNodeIndex: number; edgeType: string; edgeName: string }>
  >();
  let edgeOffset = 0;
  for (let ownerNodeIndex = 0; ownerNodeIndex < nodeCount; ownerNodeIndex += 1) {
    const ownerOffset = ownerNodeIndex * nodeStride;
    const edgeCount = snapshot.nodes[ownerOffset + edgeCountField];
    for (let edge = 0; edge < edgeCount; edge += 1) {
      if (edgeOffset + edgeStride > snapshot.edges.length) {
        return { rootNodeFound: true, searchTruncated: true, path: null };
      }
      const edgeType = edgeTypes[snapshot.edges[edgeOffset + edgeTypeField]];
      const edgeNameOrIndex = snapshot.edges[edgeOffset + edgeNameField];
      const edgeName =
        edgeType === 'element'
          ? `#${edgeNameOrIndex}`
          : (snapshot.strings[edgeNameOrIndex] ?? `#${edgeNameOrIndex}`);
      const targetOffset = snapshot.edges[edgeOffset + targetNodeField];
      edgeOffset += edgeStride;
      if (edgeType === 'weak' || targetOffset % nodeStride !== 0) continue;

      const targetIndex = targetOffset / nodeStride;
      if (targetIndex < 0 || targetIndex >= nodeCount) continue;
      const retainers = incoming.get(targetIndex) ?? [];
      retainers.push({ ownerNodeIndex, edgeType, edgeName });
      incoming.set(targetIndex, retainers);
    }
  }

  const queue: Array<{ nodeIndex: number; path: HeapRetainerStep[] }> = [
    {
      nodeIndex: targetNodeIndex,
      path: [{ nodeIndex: targetNodeIndex, viaEdgeType: null, viaEdgeName: null }]
    }
  ];
  const visited = new Set([targetNodeIndex]);
  let searchTruncated = false;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    if (cursor >= 10_000) {
      searchTruncated = true;
      break;
    }
    const current = queue[cursor]!;
    if (current.nodeIndex === rootNodeIndex) {
      return { rootNodeFound: true, searchTruncated, path: current.path };
    }
    if (current.path.length >= 12) {
      searchTruncated = true;
      continue;
    }

    for (const retainer of incoming.get(current.nodeIndex) ?? []) {
      if (visited.has(retainer.ownerNodeIndex)) continue;
      visited.add(retainer.ownerNodeIndex);
      const path = [
        ...current.path,
        {
          nodeIndex: retainer.ownerNodeIndex,
          viaEdgeType: retainer.edgeType,
          viaEdgeName: retainer.edgeName
        }
      ];
      if (retainer.ownerNodeIndex === rootNodeIndex) {
        return { rootNodeFound: true, searchTruncated, path };
      }
      queue.push({ nodeIndex: retainer.ownerNodeIndex, path });
    }
  }
  return { rootNodeFound: true, searchTruncated, path: null };
}

test('asistente global: traza retainers fuertes y omite referencias débiles en heap', () => {
  const snapshot: ChromeHeapSnapshot = {
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [['synthetic', 'object', 'closure']],
        edge_fields: ['type', 'name_or_index', 'to_node'],
        edge_types: [['context', 'property', 'weak']]
      }
    },
    nodes: [
      0,
      0,
      1,
      0,
      1, // GC roots -> owner
      1,
      1,
      2,
      44,
      0, // retained context
      2,
      2,
      3,
      32,
      1 // owner -> retained context
    ],
    edges: [1, 4, 10, 0, 3, 5],
    strings: [
      '(GC roots)',
      'system / Context / scope @7',
      'assistant owner',
      'context',
      'activeAssistant'
    ]
  };

  expect(findHeapRetainerPath(snapshot, 1)).toEqual({
    rootNodeFound: true,
    searchTruncated: false,
    path: [
      { nodeIndex: 1, viaEdgeType: null, viaEdgeName: null },
      { nodeIndex: 2, viaEdgeType: 'context', viaEdgeName: 'context' },
      { nodeIndex: 0, viaEdgeType: 'property', viaEdgeName: 'activeAssistant' }
    ]
  });
  expect(findHeapRetainerPath({ ...snapshot, edges: [1, 0, 10, 2, 0, 5] }, 1)).toEqual({
    rootNodeFound: true,
    searchTruncated: false,
    path: null
  });
  expect(
    findHeapRetainerPath(
      { ...snapshot, strings: ['not the root', ...snapshot.strings.slice(1)] },
      1
    )
  ).toEqual({
    rootNodeFound: false,
    searchTruncated: false,
    path: null
  });
  expect(safeHeapEdgeName('activeAssistant')).toBe('activeAssistant');
  expect(safeHeapEdgeName('activeAssistant.current-state')).toBe('activeAssistant.current-state');
  expect(safeHeapEdgeName('user@example.com')).toBe('<redacted>');
  expect(safeHeapEdgeName('Symbol(assistant)')).toBe('<symbol-property>');
});

test('asistente global: mide heap y listeners tras reaperturas repetidas', async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'requiere métricas CDP de Chromium');
  const requestedReopenings = Number(process.env.HOGARIA_AI_ASSISTANT_HEAP_REOPENINGS ?? 40);
  expect(
    Number.isSafeInteger(requestedReopenings) &&
      requestedReopenings >= 40 &&
      requestedReopenings <= 200 &&
      requestedReopenings % 20 === 0,
    'el target debe ser múltiplo de 20 entre 40 y 200'
  ).toBe(true);
  const allocationSamplingEnabled = process.env.HOGARIA_AI_ASSISTANT_HEAP_ALLOCATIONS === '1';
  const sharedConfirmDialogControl = process.env.HOGARIA_AI_ASSISTANT_HEAP_CONTROL_MODAL === '1';
  expect(
    !allocationSamplingEnabled || requestedReopenings === 40,
    'el perfil de asignaciones solo acompaña al perfil default de 40 ciclos'
  ).toBe(true);
  test.setTimeout(90_000 + Math.max(0, requestedReopenings - 40) * 2_000);

  const proposalRequests: string[] = [];
  const destructiveRequests: string[] = [];
  const scriptRequests: string[] = [];
  let receiptQueueRequests = 0;
  let pantryCategoryRequests = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scriptRequests.push(request.url());
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET' && pathname === '/api/receipts/queue') {
      receiptQueueRequests += 1;
    }
    if (request.method() === 'GET' && pathname === '/api/pantry/categories') {
      pantryCategoryRequests += 1;
    }
    if (request.method() === 'DELETE') destructiveRequests.push(pathname);
    if (request.method() !== 'POST') return;
    if (pathname.startsWith('/api/ai/assistant/')) proposalRequests.push(pathname);
  });

  await registerUser(page, 'Asistente rendimiento E2E');
  await createHousehold(page, 'Hogar rendimiento sintético');
  await page.goto(sharedConfirmDialogControl ? '/pantry' : '/dashboard');
  let sharedModalDatabaseBefore: Record<string, string[]> | undefined;
  if (sharedConfirmDialogControl) {
    await expect(page.locator('h1.pantry__title')).toBeVisible();
    await page.getByRole('button', { name: '+ Agregar' }).click();
    await page.fill('input#ingredientName', 'Tomate de control');
    await page.fill('input#quantity', '500');
    for (const [testDelPicker, opcion] of [
      ['pantry-picker-categoria', 'Verduras'],
      ['pantry-picker-ubicacion', 'Nevera']
    ] as const) {
      const caja = page.locator(`[data-test="${testDelPicker}"]`);
      await caja.locator('.picker__trigger').click();
      await caja.locator('.picker__option').filter({ hasText: opcion }).first().click();
    }
    await page.locator('app-modal button[type="submit"]').click();
    await expect(page.locator('.ingredient-item', { hasText: 'Tomate de control' })).toHaveCount(1);
    await expect(page.locator('.toast--success')).toHaveCount(0);
    sharedModalDatabaseBefore = assistantDatabaseSnapshot();
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let allocationSamplingActive = false;
  const browser = page.context().browser();
  if (!browser) throw new Error('Missing Chromium browser for process-level metrics.');
  const browserCdp = await browser.newBrowserCDPSession();

  const sampleBrowserProcesses = async () => {
    const { processInfo } = (await browserCdp.send('SystemInfo.getProcessInfo')) as {
      processInfo: Array<{ id: number; type: string; cpuTime: number }>;
    };
    const processIds = processInfo.map(({ id }) => id).filter(Number.isSafeInteger);
    if (processIds.length === 0) throw new Error('Chromium reported no process IDs.');

    let rssByProcess: Array<{ pid: number; workingSetBytes: number }>;
    if (process.platform === 'win32') {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-Process -Id ${processIds.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { Write-Output "$($_.Id):$($_.WorkingSet64)" }`
        ],
        { encoding: 'utf8', timeout: 5000, windowsHide: true }
      );
      rssByProcess = output
        .trim()
        .split(/\r?\n/)
        .flatMap((line) => {
          const [pid, bytes] = line.split(':').map(Number);
          return Number.isSafeInteger(pid) && Number.isFinite(bytes)
            ? [{ pid, workingSetBytes: bytes }]
            : [];
        });
    } else {
      const output = execFileSync('ps', ['-o', 'pid=,rss=', '-p', processIds.join(',')], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });
      rssByProcess = output
        .trim()
        .split(/\r?\n/)
        .flatMap((line) => {
          const [pid, kibibytes] = line.trim().split(/\s+/).map(Number);
          return Number.isSafeInteger(pid) && Number.isFinite(kibibytes)
            ? [{ pid, workingSetBytes: kibibytes * 1024 }]
            : [];
        });
    }

    const measuredProcesses = new Map(rssByProcess.map((entry) => [entry.pid, entry]));
    const measured = processInfo.filter(({ id }) => measuredProcesses.has(id));
    if (measured.length === 0) throw new Error('Could not read Chromium process working sets.');

    return {
      processCount: measured.length,
      workingSetMiB: Number(
        (
          measured.reduce(
            (total, { id }) => total + measuredProcesses.get(id)!.workingSetBytes,
            0
          ) /
          1024 /
          1024
        ).toFixed(2)
      ),
      cpuTimeSeconds: Number(measured.reduce((total, { cpuTime }) => total + cpuTime, 0).toFixed(3))
    };
  };

  const captureHeapObjectCounts = async (
    previousSnapshot?: Record<string, { count: number; selfSizeBytes: number }>
  ) => {
    const snapshotCdp = await page.context().newCDPSession(page);
    const chunks: string[] = [];
    const onSnapshotChunk = ({ chunk }: { chunk: string }) => chunks.push(chunk);
    snapshotCdp.on('HeapProfiler.addHeapSnapshotChunk', onSnapshotChunk);

    try {
      await snapshotCdp.send('HeapProfiler.enable');
      await snapshotCdp.send('HeapProfiler.collectGarbage');
      await snapshotCdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      const snapshot = JSON.parse(chunks.join('')) as ChromeHeapSnapshot;
      const nodeFields = new Map(snapshot.snapshot.meta.node_fields.map((name, i) => [name, i]));
      const typeIndex = nodeFields.get('type');
      const nameIndex = nodeFields.get('name');
      const sizeIndex = nodeFields.get('self_size');
      if (typeIndex === undefined || nameIndex === undefined || sizeIndex === undefined) {
        throw new Error('Chromium heap snapshot did not include node type/name/size fields.');
      }

      const nodeTypes = snapshot.snapshot.meta.node_types[0];
      const stride = snapshot.snapshot.meta.node_fields.length;
      const counts: Record<string, { count: number; selfSizeBytes: number }> = {};
      for (let offset = 0; offset < snapshot.nodes.length; offset += stride) {
        const type = nodeTypes[snapshot.nodes[offset + typeIndex]];
        if (
          !['array', 'closure', 'code', 'hidden', 'native', 'object', 'regexp', 'string'].includes(
            type
          )
        ) {
          continue;
        }
        const name =
          type === 'string'
            ? 'values redacted'
            : snapshot.strings[snapshot.nodes[offset + nameIndex]];
        const key = `${type}:${name}`;
        const current = counts[key] ?? { count: 0, selfSizeBytes: 0 };
        current.count += 1;
        current.selfSizeBytes += snapshot.nodes[offset + sizeIndex];
        counts[key] = current;
      }

      if (previousSnapshot) {
        const growingContexts = Object.entries(counts)
          .filter(([key]) => key.startsWith('object:system / Context / scope'))
          .map(([key, current]) => ({
            key,
            countDelta: current.count - (previousSnapshot[key]?.count ?? 0)
          }))
          .filter(({ countDelta }) => countDelta > 0)
          .sort((left, right) => right.countDelta - left.countDelta);
        const target = growingContexts[0];

        if (target) {
          const targetName = target.key.slice('object:'.length);
          const targetNodeIndexes: number[] = [];
          const typeIndex = nodeFields.get('type')!;
          const nameIndex = nodeFields.get('name')!;
          for (let offset = 0; offset < snapshot.nodes.length; offset += stride) {
            const type = nodeTypes[snapshot.nodes[offset + typeIndex]];
            const name = snapshot.strings[snapshot.nodes[offset + nameIndex]];
            if (type === 'object' && name === targetName) {
              targetNodeIndexes.push(offset / stride);
              if (targetNodeIndexes.length >= 3) break;
            }
          }

          const labels = targetNodeIndexes.map((nodeIndex) => {
            const search = findHeapRetainerPath(snapshot, nodeIndex);
            const path = search.path?.map((step) => {
              const offset = step.nodeIndex * stride;
              const type = nodeTypes[snapshot.nodes[offset + typeIndex]];
              const name = snapshot.strings[snapshot.nodes[offset + nameIndex]];
              const safeName =
                type === 'string'
                  ? '<redacted>'
                  : type === 'object' && name.startsWith('system / Context / scope')
                    ? 'system / Context / scope'
                    : name.slice(0, 100);
              return {
                node: `${type}:${safeName}`,
                via: step.viaEdgeType,
                edge: safeHeapEdgeName(step.viaEdgeName)
              };
            });
            return {
              rootNodeFound: search.rootNodeFound,
              searchTruncated: search.searchTruncated,
              path: path ?? null
            };
          });
          console.log(
            '[assistant-retainers]',
            JSON.stringify({ scopeCountDelta: target.countDelta, samplePaths: labels })
          );
        } else {
          console.log(
            '[assistant-retainers]',
            JSON.stringify({ scopeCountDelta: 0, samplePaths: [] })
          );
        }
      }
      return counts;
    } finally {
      snapshotCdp.off('HeapProfiler.addHeapSnapshotChunk', onSnapshotChunk);
      await snapshotCdp.send('HeapProfiler.disable').catch(() => undefined);
      await snapshotCdp.detach();
    }
  };

  const sample = async (phase: string) => {
    await cdp.send('HeapProfiler.collectGarbage');
    const [performance, dom] = await Promise.all([
      cdp.send('Performance.getMetrics'),
      cdp.send('Memory.getDOMCounters')
    ]);
    const metrics = new Map(performance.metrics.map((metric) => [metric.name, metric.value]));
    const value = (name: string) => {
      const measurement = metrics.get(name);
      if (typeof measurement !== 'number') throw new Error(`Missing CDP metric: ${name}`);
      return measurement;
    };

    return {
      phase,
      jsHeapUsedMiB: Number((value('JSHeapUsedSize') / 1024 / 1024).toFixed(2)),
      taskDurationSeconds: Number(value('TaskDuration').toFixed(3)),
      scriptDurationSeconds: Number(value('ScriptDuration').toFixed(3)),
      nodes: dom.nodes,
      jsEventListeners: dom.jsEventListeners
    };
  };

  const sampleAfterStableCounters = async (phase: string) => {
    let previous: Awaited<ReturnType<typeof sample>> | undefined;
    let stableSamples = 0;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await sample(phase);
      if (
        previous &&
        current.nodes === previous.nodes &&
        current.jsEventListeners === previous.jsEventListeners
      ) {
        stableSamples += 1;
        if (stableSamples >= 2) return current;
      } else {
        stableSamples = 0;
      }
      previous = current;
      await page.waitForTimeout(100);
    }

    throw new Error('DOM nodes/listeners did not stabilize after closing the modal.');
  };

  const launcher = sharedConfirmDialogControl
    ? page
        .locator('.ingredient-item', { hasText: 'Tomate de control' })
        .locator('.action-btn--danger')
    : page.locator('[data-test="ai-assistant-open"]');
  await expect(launcher).toBeVisible();
  await page.waitForTimeout(100);
  const closedBeforeWarmup = await sample('closed-before-warmup');
  const dialog = sharedConfirmDialogControl
    ? page.locator('.modal-overlay')
    : page.locator('.modal[role="dialog"]');

  const openAndClose = async (phase: string, measureOpenProcess = false) => {
    await launcher.click();
    await expect(dialog).toBeVisible();
    if (sharedConfirmDialogControl) {
      await expect(dialog.locator('.modal__title')).toHaveText('Eliminar ingrediente');
    }
    const open = await sample(`${phase}-open`);
    const openProcess = measureOpenProcess ? await sampleBrowserProcesses() : null;
    if (sharedConfirmDialogControl) {
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.locator('.ingredient-item', { hasText: 'Tomate de control' })).toHaveCount(
        1
      );
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(250);
    const closed = await sampleAfterStableCounters(`${phase}-closed`);
    return { open, closed, openProcess };
  };

  const allocationProfiles: Array<{
    group: number;
    sampleCount: number;
    topSites: Array<{ liveSampledBytes: number; stack: string }>;
  }> = [];
  const stopAndSummarizeAllocationSampling = async (group: number) => {
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    allocationSamplingActive = false;
    const siteBytes = new Map<string, number>();
    const formatFrame = (frame: (typeof profile.head)['callFrame']) => {
      const rawPath = frame.url.split(/[?#]/, 1)[0] ?? '';
      const script = rawPath.split('/').pop() || '<native>';
      const name = frame.functionName
        ? frame.functionName.replace(/[^A-Za-z0-9_$<>.]/g, '?').slice(0, 80)
        : '<anonymous>';
      return `${name}@${script}:${frame.lineNumber + 1}`;
    };
    const visit = (node: typeof profile.head, ancestors: string[]) => {
      const stack = [...ancestors, formatFrame(node.callFrame)].slice(-6);
      if (node.selfSize > 0) {
        const key = stack.join(' ← ');
        siteBytes.set(key, (siteBytes.get(key) ?? 0) + node.selfSize);
      }
      node.children.forEach((child) => visit(child, stack));
    };
    visit(profile.head, []);
    const topSites = [...siteBytes.entries()]
      .map(([stack, liveSampledBytes]) => ({ stack, liveSampledBytes }))
      .sort((left, right) => right.liveSampledBytes - left.liveSampledBytes)
      .slice(0, 8);
    const result = { group, sampleCount: profile.samples.length, topSites };
    allocationProfiles.push(result);
    console.log('[assistant-allocation-profile]', JSON.stringify(result));
  };

  try {
    if (allocationSamplingEnabled) await cdp.send('HeapProfiler.enable');
    const processBeforeWarmup = await sampleBrowserProcesses();
    const warmup = await openAndClose('warmup', true);
    const processAfterWarmup = await sampleBrowserProcesses();
    const warmedScriptRequestCount = scriptRequests.length;
    const controlStartedAt = Date.now();
    const idleControl = [];
    for (let cycle = 1; cycle <= requestedReopenings; cycle += 1) {
      await page.waitForTimeout(600);
      idleControl.push(await sample(`idle-${cycle}`));
    }
    const controlDurationSeconds = Number(((Date.now() - controlStartedAt) / 1000).toFixed(2));
    expect(idleControl).toHaveLength(requestedReopenings);
    const heapBeforeAssistant = await captureHeapObjectCounts();
    const processAfterIdleControl = await sampleBrowserProcesses();

    const reopeningsPerGroup = 20;
    const reopeningGroupCount = requestedReopenings / reopeningsPerGroup;
    const repeatedCycles: Array<Awaited<ReturnType<typeof openAndClose>>> = [];
    const heapSnapshots: Array<Awaited<ReturnType<typeof captureHeapObjectCounts>>> = [
      heapBeforeAssistant
    ];
    const reopeningGroups: Array<{
      group: number;
      firstReopening: number;
      lastReopening: number;
      durationSeconds: number;
      processBefore: Awaited<ReturnType<typeof sampleBrowserProcesses>>;
      processDuringOpen: Awaited<ReturnType<typeof sampleBrowserProcesses>>;
      processAfter: Awaited<ReturnType<typeof sampleBrowserProcesses>>;
      closedHeapStartMiB: number;
      closedHeapEndMiB: number;
      closedHeapDeltaMiB: number;
    }> = [];
    let processBeforeGroup = processAfterIdleControl;

    for (let groupIndex = 0; groupIndex < reopeningGroupCount; groupIndex += 1) {
      const firstReopening = groupIndex * reopeningsPerGroup + 1;
      const lastReopening = firstReopening + reopeningsPerGroup - 1;
      const groupStartedAt = Date.now();
      let processDuringOpen: Awaited<ReturnType<typeof sampleBrowserProcesses>> | undefined;

      if (allocationSamplingEnabled) {
        await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, stackDepth: 24 });
        allocationSamplingActive = true;
      }

      for (let cycle = firstReopening; cycle <= lastReopening; cycle += 1) {
        const cycleResult = await openAndClose(
          `cycle-${cycle}`,
          cycle === firstReopening + reopeningsPerGroup / 2 - 1
        );
        repeatedCycles.push(cycleResult);
        if (cycleResult.openProcess) processDuringOpen = cycleResult.openProcess;
      }

      if (allocationSamplingEnabled) await stopAndSummarizeAllocationSampling(groupIndex + 1);

      const durationSeconds = Number(((Date.now() - groupStartedAt) / 1000).toFixed(2));
      const processAfter = await sampleBrowserProcesses();
      const traceRetainers =
        process.env.HOGARIA_AI_ASSISTANT_HEAP_RETAINERS === '1' &&
        groupIndex + 1 === reopeningGroupCount;
      const heapAfterGroup = await captureHeapObjectCounts(
        traceRetainers ? heapSnapshots[heapSnapshots.length - 1] : undefined
      );
      heapSnapshots.push(heapAfterGroup);
      const closedHeapStartMiB =
        groupIndex === 0
          ? idleControl[idleControl.length - 1]!.jsHeapUsedMiB
          : repeatedCycles[firstReopening - 2]!.closed.jsHeapUsedMiB;
      const closedHeapEndMiB = repeatedCycles[lastReopening - 1]!.closed.jsHeapUsedMiB;
      if (!processDuringOpen) {
        throw new Error(`Missing Chromium process sample in reopening group ${groupIndex + 1}.`);
      }
      reopeningGroups.push({
        group: groupIndex + 1,
        firstReopening,
        lastReopening,
        durationSeconds,
        processBefore: processBeforeGroup,
        processDuringOpen,
        processAfter,
        closedHeapStartMiB,
        closedHeapEndMiB,
        closedHeapDeltaMiB: Number((closedHeapEndMiB - closedHeapStartMiB).toFixed(2))
      });
      if (groupIndex + 1 < reopeningGroupCount) {
        processBeforeGroup = await sampleBrowserProcesses();
      }
    }

    expect(repeatedCycles).toHaveLength(requestedReopenings);
    if (allocationSamplingEnabled) {
      expect(allocationProfiles).toHaveLength(requestedReopenings / reopeningsPerGroup);
      expect(allocationProfiles.every((profile) => profile.sampleCount > 0)).toBe(true);
    }
    const firstTwentyDurationSeconds = reopeningGroups[0]!.durationSeconds;
    const secondTwentyDurationSeconds = reopeningGroups[1]!.durationSeconds;
    const targetDurationSeconds = Number(
      reopeningGroups.reduce((total, group) => total + group.durationSeconds, 0).toFixed(2)
    );
    const idleToTargetDurationRatio = Number(
      (controlDurationSeconds / targetDurationSeconds).toFixed(2)
    );
    // This control includes a full shared-confirm-dialog flow; keep the idle-ratio gate assistant-specific.
    if (!sharedConfirmDialogControl) {
      expect(idleToTargetDurationRatio).toBeGreaterThanOrEqual(0.75);
      expect(idleToTargetDurationRatio).toBeLessThanOrEqual(1.35);
    }
    const processAfterFirstTwenty = reopeningGroups[0]!.processAfter;
    const processBeforeSecondTwenty = reopeningGroups[1]!.processBefore;
    const processAfterSecondTwenty = reopeningGroups[1]!.processAfter;
    const processAfterAssistant = reopeningGroups[reopeningGroups.length - 1]!.processAfter;
    const heapAfterFirstTwenty = heapSnapshots[1]!;
    const heapAfterSecondTwenty = heapSnapshots[2]!;
    const heapAfterAssistant = heapSnapshots[heapSnapshots.length - 1]!;
    const processDuringFirstTwenty = reopeningGroups[0]!.processDuringOpen;
    const processDuringSecondTwenty = reopeningGroups[1]!.processDuringOpen;

    const stableNodes = [warmup.closed, ...repeatedCycles.map(({ closed }) => closed)].map(
      ({ nodes }) => nodes
    );
    const stableListeners = [warmup.closed, ...repeatedCycles.map(({ closed }) => closed)].map(
      ({ jsEventListeners }) => jsEventListeners
    );
    console.log(
      '[assistant-performance-counters]',
      JSON.stringify({
        closedNodes: stableNodes[0],
        closedListeners: stableListeners[0],
        stableClosedNodes: new Set(stableNodes).size === 1,
        stableClosedListeners: new Set(stableListeners).size === 1
      })
    );
    expect(new Set(stableNodes).size).toBe(1);
    expect(new Set(stableListeners).size).toBe(1);
    expect(scriptRequests).toHaveLength(warmedScriptRequestCount);
    expect(proposalRequests).toEqual([]);
    expect(destructiveRequests).toEqual([]);
    expect(pantryCategoryRequests).toBe(1);
    if (sharedConfirmDialogControl) {
      expect(sharedModalDatabaseBefore).toBeDefined();
      expect(assistantDatabaseSnapshot()).toEqual(sharedModalDatabaseBefore);
      await expect(page.locator('.ingredient-item', { hasText: 'Tomate de control' })).toHaveCount(
        1
      );
    }

    const closedSamples = [warmup.closed, ...repeatedCycles.map(({ closed }) => closed)];
    const openSamples = [warmup.open, ...repeatedCycles.map(({ open }) => open)];
    const closedHeapValues = closedSamples.map(({ jsHeapUsedMiB }) => jsHeapUsedMiB);
    const idleHeapValues = idleControl.map(({ jsHeapUsedMiB }) => jsHeapUsedMiB);
    const finalIdle = idleControl[idleControl.length - 1];
    const finalClosed = closedSamples[closedSamples.length - 1];
    const summarizeHeapGrowth = (
      beforeSnapshot: Awaited<ReturnType<typeof captureHeapObjectCounts>>,
      afterSnapshot: Awaited<ReturnType<typeof captureHeapObjectCounts>>
    ) =>
      Object.entries(afterSnapshot)
        .map(([typeAndName, after]) => {
          const before = beforeSnapshot[typeAndName] ?? { count: 0, selfSizeBytes: 0 };
          return {
            typeAndName,
            countDelta: after.count - before.count,
            selfSizeDeltaBytes: after.selfSizeBytes - before.selfSizeBytes
          };
        })
        .filter(({ countDelta, selfSizeDeltaBytes }) => countDelta > 0 || selfSizeDeltaBytes > 4096)
        .sort((a, b) => b.selfSizeDeltaBytes - a.selfSizeDeltaBytes)
        .slice(0, 8);
    const retainedHeapObjectGrowthFirstTwenty = summarizeHeapGrowth(
      heapBeforeAssistant,
      heapAfterFirstTwenty
    );
    const retainedHeapObjectGrowthSecondTwenty = summarizeHeapGrowth(
      heapAfterFirstTwenty,
      heapAfterSecondTwenty
    );
    const retainedHeapObjectGrowthByGroup = reopeningGroups.map((group, index) => ({
      group: group.group,
      firstReopening: group.firstReopening,
      lastReopening: group.lastReopening,
      retainedHeapObjects: summarizeHeapGrowth(heapSnapshots[index]!, heapSnapshots[index + 1]!)
    }));

    console.log(
      '[assistant-performance]',
      JSON.stringify({
        browser: testInfo.project.name,
        profileTarget: sharedConfirmDialogControl ? 'shared-confirm-dialog' : 'ai-assistant',
        chromiumProcesses: {
          beforeWarmup: processBeforeWarmup,
          afterWarmupOpen: warmup.openProcess,
          afterWarmupClosed: processAfterWarmup,
          beforeAssistantAfterIdleControl: processAfterIdleControl,
          afterFirstTwentyClosed: processAfterFirstTwenty,
          afterSecondTwentyClosed: processAfterSecondTwenty,
          beforeSecondTwentyAfterSnapshot: processBeforeSecondTwenty,
          duringFirstTwentyOpen: processDuringFirstTwenty,
          duringSecondTwentyOpen: processDuringSecondTwenty,
          afterAssistantClosed: processAfterAssistant,
          byReopeningGroup: reopeningGroups.map((group) => ({
            group: group.group,
            firstReopening: group.firstReopening,
            lastReopening: group.lastReopening,
            before: group.processBefore,
            duringOpen: group.processDuringOpen,
            after: group.processAfter,
            cpuTimeDeltaSeconds: Number(
              (group.processAfter.cpuTimeSeconds - group.processBefore.cpuTimeSeconds).toFixed(3)
            )
          })),
          firstTwentyCpuTimeDeltaSeconds: Number(
            (
              processAfterFirstTwenty.cpuTimeSeconds - processAfterIdleControl.cpuTimeSeconds
            ).toFixed(3)
          ),
          secondTwentyCpuTimeDeltaSeconds: Number(
            (
              processAfterSecondTwenty.cpuTimeSeconds - processBeforeSecondTwenty.cpuTimeSeconds
            ).toFixed(3)
          )
        },
        retainedHeapObjectGrowthFirstTwenty,
        retainedHeapObjectGrowthSecondTwenty,
        retainedHeapObjectGrowthByGroup,
        closedBeforeWarmup,
        warmupOpen: warmup.open,
        warmupClosed: warmup.closed,
        idleControlCycles: idleControl.length,
        controlDurationSeconds,
        idleHeapRangeMiB: [Math.min(...idleHeapValues), Math.max(...idleHeapValues)],
        idleHeapDeltaFromWarmupMiB: Number(
          (finalIdle.jsHeapUsedMiB - warmup.closed.jsHeapUsedMiB).toFixed(2)
        ),
        reopenings: repeatedCycles.length,
        requestedReopenings,
        reopeningsPerGroup,
        reopeningGroupCount,
        closedHeapDeltaByGroupMiB: reopeningGroups.map(
          ({ closedHeapDeltaMiB }) => closedHeapDeltaMiB
        ),
        reopeningGroupDurationsSeconds: reopeningGroups.map(
          ({ durationSeconds }) => durationSeconds
        ),
        targetDurationSeconds,
        idleToTargetDurationRatio,
        firstTwentyDurationSeconds,
        secondTwentyDurationSeconds,
        closedHeapRangeMiB: [Math.min(...closedHeapValues), Math.max(...closedHeapValues)],
        closedHeapDeltaFirstTwentyMiB: Number(
          (repeatedCycles[19].closed.jsHeapUsedMiB - finalIdle.jsHeapUsedMiB).toFixed(2)
        ),
        closedHeapDeltaSecondTwentyMiB: Number(
          (
            repeatedCycles[39].closed.jsHeapUsedMiB - repeatedCycles[19].closed.jsHeapUsedMiB
          ).toFixed(2)
        ),
        closedHeapDeltaFromWarmupMiB: Number(
          (finalClosed.jsHeapUsedMiB - warmup.closed.jsHeapUsedMiB).toFixed(2)
        ),
        closedHeapDeltaAfterIdleControlMiB: Number(
          (finalClosed.jsHeapUsedMiB - finalIdle.jsHeapUsedMiB).toFixed(2)
        ),
        peakOpenHeapMiB: Math.max(...openSamples.map(({ jsHeapUsedMiB }) => jsHeapUsedMiB)),
        finalClosed: {
          jsHeapUsedMiB: finalClosed.jsHeapUsedMiB,
          nodes: finalClosed.nodes,
          jsEventListeners: finalClosed.jsEventListeners
        },
        taskDurationDeltaSeconds: Number(
          (finalClosed.taskDurationSeconds - closedBeforeWarmup.taskDurationSeconds).toFixed(3)
        ),
        scriptDurationDeltaSeconds: Number(
          (finalClosed.scriptDurationSeconds - closedBeforeWarmup.scriptDurationSeconds).toFixed(3)
        ),
        proposalRequests: proposalRequests.length,
        destructiveRequests: destructiveRequests.length,
        newScriptsAfterWarmup: scriptRequests.length - warmedScriptRequestCount,
        receiptQueueRequests,
        pantryCategoryRequests
      })
    );
  } finally {
    if (allocationSamplingActive)
      await cdp.send('HeapProfiler.stopSampling').catch(() => undefined);
    await Promise.all([cdp.detach(), browserCdp.detach()]);
  }
});
