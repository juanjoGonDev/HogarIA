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

test('local Ollama returns independent cross-domain actions without persistent writes', async ({
  page
}) => {
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
  expect(pantryAction?.payload.name?.toString().toLocaleLowerCase()).toContain('arroz');
  expect(pantryAction?.payload.quantity).toBe(250);
  expect(pantryAction?.payload.unit).toBe('g');

  const listAction = proposalBody.data.actions.find(({ kind }) => kind === 'shopping.create_list');
  expect(listAction?.payload.name?.toString().toLocaleLowerCase()).toContain('cena');
  expect(proposalBody.data.actions.every(({ dependsOn }) => dependsOn.length === 0)).toBe(true);
  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();

  const after = isolatedDatabaseSnapshot();
  expect(after).toEqual(before);
  expect(after.ai_jobs ?? [], 'la propuesta transitoria no debe crear ai_jobs').toEqual([]);
});
