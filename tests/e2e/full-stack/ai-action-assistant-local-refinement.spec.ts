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

test('Ollama local refina solo cantidad y preserva el borrador manual sin escribir', async ({
  page
}) => {
  test.skip(
    !LOCAL_SMOKE_ENABLED,
    'Smoke opt-in: requiere Ollama local y qwen3:8b; no usa proveedor externo.'
  );
  test.setTimeout(180_000);

  await registerUser(page, 'Asistente Ollama refino');
  await createHousehold(page, 'Hogar sintético Ollama refino');

  const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
  expect(token, 'sesión sintética de E2E').toBeTruthy();
  const config = await page.request.post('/api/ai/configs', {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: 'Ollama local refinement smoke',
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
        payload: { name?: string; quantity?: number; unit?: string; notes?: string | null };
      }>;
    };
  };
  expect(proposalResponse.status(), JSON.stringify(proposalBody)).toBe(200);
  expect(proposalBody.success).toBe(true);
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
  expect(pantryAction.payload.quantity).toBe(250);
  expect(pantryAction.payload.unit).toBe('g');

  const pantryCard = page.locator(`[data-action-id="${pantryAction.id}"]`);
  const listCard = page.locator(`[data-action-id="${listAction.id}"]`);
  const actionDetails = page.locator(
    `[data-test="ai-assistant-action-details-${pantryAction.id}"]`
  );
  await actionDetails.locator('summary').click();
  await actionDetails.locator('input[type="text"]').first().fill('Arroz integral manual');
  await actionDetails.locator('textarea').fill('Nota manual que debe conservarse.');

  const afterProposal = isolatedDatabaseSnapshot();
  expect(afterProposal).toEqual(before);
  expect(afterProposal.ai_jobs ?? [], 'proponer no debe crear ai_jobs').toEqual([]);

  await pantryCard.locator('[data-test="ai-assistant-refine"] button').click();
  await expect(page.locator('[data-test="ai-assistant-refine-stage"]')).toBeVisible();
  await page.getByRole('button', { name: 'Ámbito de la revisión: Acción completa' }).click();
  await page.getByRole('option', { name: 'Campo: Cantidad' }).click();
  await page.locator('#ai-assistant-refine-input').fill('Ajusta solo la cantidad a 300 g.');

  const refinementResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === 'POST' && new URL(response.url()).pathname === '/api/ai/assistant/refine'
    );
  });
  await page.getByRole('button', { name: 'Actualizar propuestas' }).click();
  const refinementResponse = await refinementResponsePromise;
  const refinementBody = (await refinementResponse.json()) as {
    success: boolean;
    data: {
      replacement: {
        kind: string;
        payload: { name?: string; quantity?: number; unit?: string; notes?: string | null };
      };
    };
  };
  expect(refinementResponse.status(), JSON.stringify(refinementBody)).toBe(200);
  expect(refinementBody.success).toBe(true);
  expect(refinementBody.data.replacement).toMatchObject({
    kind: 'pantry.add_ingredient',
    payload: {
      name: 'Arroz integral manual',
      quantity: 300,
      unit: 'g',
      notes: 'Nota manual que debe conservarse.'
    }
  });

  await expect(page.locator('[data-test="ai-assistant-review"]')).toBeVisible();
  await expect(actionDetails.locator('input[type="text"]').first()).toHaveValue(
    'Arroz integral manual'
  );
  await expect(actionDetails.locator('input[type="number"]')).toHaveValue('300');
  await expect(actionDetails.locator('textarea')).toHaveValue('Nota manual que debe conservarse.');
  await expect(listCard.locator('input[type="text"]').first()).toHaveValue(
    listAction.payload.name ?? ''
  );
  await expect(pantryCard.getByRole('checkbox')).not.toBeChecked();
  await expect(listCard.getByRole('checkbox')).not.toBeChecked();

  const afterRefinement = isolatedDatabaseSnapshot();
  expect(afterRefinement).toEqual(before);
  expect(afterRefinement.ai_jobs ?? [], 'refinar no debe crear ai_jobs').toEqual([]);
});
