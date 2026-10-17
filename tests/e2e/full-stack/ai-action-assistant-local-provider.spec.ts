import Database from 'better-sqlite3';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { expect, test } from '../fixtures';
import { createHousehold, registerUser } from '../helpers/auth';

const LOCAL_SMOKE_ENABLED = process.env.HOGARIA_AI_ASSISTANT_LOCAL_SMOKE === '1';
const TOKEN_KEY = 'hogar:v1:auth_token';
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1';
const OLLAMA_MODEL = 'qwen3:8b';

test.use({ serviceWorkers: 'block' });

function isolatedDatabaseSnapshot(): Record<string, string[]> {
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

test('local Ollama returns an editable pantry proposal without persistent writes', async ({
  page
}) => {
  test.skip(
    !LOCAL_SMOKE_ENABLED,
    'Smoke opt-in: requiere Ollama local y qwen3:8b; no usa proveedor externo.'
  );
  test.setTimeout(180_000);

  await registerUser(page, 'Asistente Ollama smoke');
  await createHousehold(page, 'Hogar sintético Ollama smoke');

  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'sesión sintética de E2E').toBeTruthy();
  const config = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Ollama local smoke',
      provider: 'custom',
      baseUrl: OLLAMA_BASE_URL,
      apiKey: 'ollama-local-no-secret',
      model: OLLAMA_MODEL,
      temperature: 0,
      maxTokens: 2048,
      timeout: 180_000,
      retryAttempts: 0,
      concurrency: 1
    }
  });
  expect(config.status(), await config.text()).toBe(201);

  const before = isolatedDatabaseSnapshot();
  expect(before.ai_jobs ?? [], 'la línea base no debe contener trabajos IA').toEqual([]);

  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();
  await expect(page.locator('[data-test="ai-assistant-compose"]')).toBeVisible();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Añade 250 g de arroz integral a mi despensa.');

  const proposalResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/api/ai/assistant/proposals'
    );
  });
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const proposalResponse = await proposalResponsePromise;
  const proposalBody = (await proposalResponse.json()) as {
    success: boolean;
    data: {
      actions: Array<{
        kind: string;
        domain: string;
        status: string;
        selected: boolean;
        payload: { name?: string; quantity?: number; unit?: string };
      }>;
    };
  };
  expect(proposalResponse.status(), JSON.stringify(proposalBody)).toBe(200);

  expect(proposalBody.success).toBe(true);
  expect(proposalBody.data.actions).toHaveLength(1);
  expect(proposalBody.data.actions[0]).toMatchObject({
    kind: 'pantry.add_ingredient',
    domain: 'pantry',
    status: 'pending',
    selected: false
  });
  expect(proposalBody.data.actions[0].payload.name?.toLocaleLowerCase()).toContain('arroz');
  expect(proposalBody.data.actions[0].payload.quantity).toBe(250);
  expect(proposalBody.data.actions[0].payload.unit).toBe('g');
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  const after = isolatedDatabaseSnapshot();
  expect(after).toEqual(before);
  expect(after.ai_jobs ?? [], 'la propuesta transitoria no debe crear ai_jobs').toEqual([]);
});

test('local Ollama writes a selected cross-domain action only after approval', async ({ page }) => {
  test.skip(
    !LOCAL_SMOKE_ENABLED,
    'Smoke opt-in: requiere Ollama local y qwen3:8b; no usa proveedor externo.'
  );
  test.setTimeout(180_000);

  await registerUser(page, 'Asistente Ollama multiaction');
  await createHousehold(page, 'Hogar sintético Ollama multiaction');

  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'sesión sintética de E2E').toBeTruthy();
  const config = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Ollama local smoke',
      provider: 'custom',
      baseUrl: OLLAMA_BASE_URL,
      apiKey: 'ollama-local-no-secret',
      model: OLLAMA_MODEL,
      temperature: 0,
      maxTokens: 2048,
      timeout: 180_000,
      retryAttempts: 0,
      concurrency: 1
    }
  });
  expect(config.status(), await config.text()).toBe(201);

  const before = isolatedDatabaseSnapshot();
  expect(before.ai_jobs ?? [], 'la línea base no debe contener trabajos IA').toEqual([]);

  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();
  await expect(page.locator('[data-test="ai-assistant-compose"]')).toBeVisible();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill(
      'Añade 250 g de arroz integral a mi despensa. Además, crea una lista de compras llamada Cena del viernes.'
    );

  const proposalResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/api/ai/assistant/proposals'
    );
  });
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const proposalResponse = await proposalResponsePromise;
  const proposalBody = (await proposalResponse.json()) as {
    success: boolean;
    data: {
      actions: Array<{
        id: string;
        kind: string;
        status: string;
        selected: boolean;
        dependsOn: number[];
        payload: Record<string, unknown>;
      }>;
    };
  };
  expect(proposalResponse.status(), JSON.stringify(proposalBody)).toBe(200);
  expect(proposalBody.success).toBe(true);
  expect(proposalBody.data.actions).toHaveLength(2);
  expect(proposalBody.data.actions.map(({ kind }) => kind).sort()).toEqual([
    'pantry.add_ingredient',
    'shopping.create_list'
  ]);
  expect(
    proposalBody.data.actions.every(({ status, selected }) => status === 'pending' && !selected)
  ).toBe(true);

  const pantryAction = proposalBody.data.actions.find(
    ({ kind }) => kind === 'pantry.add_ingredient'
  );
  const listAction = proposalBody.data.actions.find(({ kind }) => kind === 'shopping.create_list');
  if (!pantryAction || !listAction) throw new Error('Faltan acciones entre dominios');

  const pantryName = String(pantryAction.payload.name);
  const listName = String(listAction.payload.name);
  expect(pantryName.toLocaleLowerCase()).toContain('arroz');
  expect(pantryAction?.payload.quantity).toBe(250);
  expect(pantryAction?.payload.unit).toBe('g');
  expect(listName.toLocaleLowerCase()).toContain('cena');
  expect(proposalBody.data.actions.every(({ dependsOn }) => dependsOn.length === 0)).toBe(true);
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  const afterProposal = isolatedDatabaseSnapshot();
  expect(afterProposal).toEqual(before);
  expect(afterProposal.ai_jobs ?? [], 'la propuesta transitoria no debe crear ai_jobs').toEqual([]);

  const pantryCard = page.locator(`[data-action-id="${pantryAction.id}"]`);
  const listCard = page.locator(`[data-action-id="${listAction.id}"]`);
  await expect(pantryCard.getByRole('checkbox')).not.toBeChecked();
  await listCard.getByRole('checkbox').click();
  await expect(listCard.getByRole('checkbox')).toBeChecked();
  await page.locator('[data-test="ai-assistant-continue"] button').click();
  const confirmation = page.locator('[data-test="ai-assistant-confirm"]');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(listName);
  await expect(confirmation).not.toContainText(pantryName);

  const creationResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' && new URL(response.url()).pathname === '/api/shopping/lists'
    );
  });
  await page.locator('[data-test="ai-assistant-confirm-submit"] button').click();
  const creationResponse = await creationResponsePromise;
  const creationBody = await creationResponse.json();
  expect(creationResponse.status(), JSON.stringify(creationBody)).toBe(201);
  expect(creationBody).toMatchObject({ success: true, data: { name: listName } });

  const afterApproval = isolatedDatabaseSnapshot();
  const changedTables = [
    ...new Set([...Object.keys(before), ...Object.keys(afterApproval)])
  ].filter((table) => JSON.stringify(before[table]) !== JSON.stringify(afterApproval[table]));
  expect(changedTables.sort()).toEqual(
    ['assistant_action_results', 'shopping_list_events', 'shopping_lists'].sort()
  );
  expect(afterApproval.shopping_lists).toHaveLength((before.shopping_lists ?? []).length + 1);
  expect(afterApproval.shopping_list_items).toEqual(before.shopping_list_items);
  expect(afterApproval.ingredients).toEqual(before.ingredients);
  expect(afterApproval.ai_jobs ?? []).toEqual([]);

  await page.reload();
  const persistedLists = await page.request.get('/api/shopping/lists?status=active', {
    headers: { authorization: `Bearer ${token}` }
  });
  expect(persistedLists.status()).toBe(200);
  const persistedBody = (await persistedLists.json()) as {
    data: Array<{ name: string }>;
  };
  expect(persistedBody.data.some(({ name }) => name === listName)).toBe(true);
  expect(isolatedDatabaseSnapshot()).toEqual(afterApproval);
});

test('local Ollama resolves calendar dates from the client local reference date', async ({
  page
}) => {
  test.skip(
    !LOCAL_SMOKE_ENABLED,
    'Smoke opt-in: requiere Ollama local y qwen3:8b; no usa proveedor externo.'
  );
  test.setTimeout(180_000);

  await registerUser(page, 'Asistente Ollama fecha local');
  await createHousehold(page, 'Hogar sintético Ollama fecha local');

  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'sesión sintética de E2E').toBeTruthy();
  const config = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Ollama local smoke',
      provider: 'custom',
      baseUrl: OLLAMA_BASE_URL,
      apiKey: 'ollama-local-no-secret',
      model: OLLAMA_MODEL,
      temperature: 0,
      maxTokens: 2048,
      timeout: 180_000,
      retryAttempts: 0,
      concurrency: 1
    }
  });
  expect(config.status(), await config.text()).toBe(201);

  const before = isolatedDatabaseSnapshot();
  expect(before.ai_jobs ?? [], 'la línea base no debe contener trabajos IA').toEqual([]);

  await page.goto('/dashboard');
  await page.locator('[data-test="ai-assistant-open"]').click();
  await expect(page.locator('[data-test="ai-assistant-compose"]')).toBeVisible();
  await page
    .locator('[data-test="ai-assistant-prompt"]')
    .fill('Crea un evento de calendario titulado "Cita de prueba" mañana a las 19:00.');

  const proposalResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' &&
      new URL(response.url()).pathname === '/api/ai/assistant/proposals'
    );
  });
  await page.locator('[data-test="ai-assistant-submit"] button').click();
  const proposalResponse = await proposalResponsePromise;
  const proposalBody = (await proposalResponse.json()) as {
    success: boolean;
    data: {
      actions: Array<{
        kind: string;
        status: string;
        selected: boolean;
        payload: { date?: string; startTime?: string | null };
      }>;
    };
  };
  expect(proposalResponse.status(), JSON.stringify(proposalBody)).toBe(200);
  expect(proposalBody.success).toBe(true);

  const requestBody = proposalResponse.request().postDataJSON() as { referenceDate?: string };
  expect(requestBody.referenceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const [year, month, day] = requestBody.referenceDate!.split('-').map(Number);
  const expectedDate = new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
  expect(proposalBody.data.actions).toHaveLength(1);
  expect(proposalBody.data.actions[0]).toMatchObject({
    kind: 'calendar.create_event',
    status: 'pending',
    selected: false,
    payload: { date: expectedDate, startTime: '19:00' }
  });
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  const after = isolatedDatabaseSnapshot();
  expect(after).toEqual(before);
  expect(after.ai_jobs ?? [], 'la propuesta transitoria no debe crear ai_jobs').toEqual([]);
});
