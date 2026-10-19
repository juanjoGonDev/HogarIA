import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type User = { id: string; token: string };

const SECRET = 'synthetic-provider-key-sentinel';
let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let user: User;

async function createUser(): Promise<User> {
  const email = `ai-redaction-${Math.random().toString(36).slice(2)}@test.local`;
  const id = `u-${email.split('@')[0]}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    'Synthetic test user',
    'hash'
  );
  const config = await import('../config/app.config.js');
  return {
    id,
    token: jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' })
  };
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  return await app.request(`/api/ai${path}`, {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;

  const { aiRoutes } = await import('./ai.routes.js');
  const { errorHandler } = await import('../middleware/error.middleware.js');
  const { timestampMiddleware } = await import('../middleware/timestamp.middleware.js');
  app = new Hono();
  app.onError(errorHandler as never);
  app.use('/api/*', timestampMiddleware());
  app.route('/api/ai', aiRoutes);
});

beforeEach(async () => {
  vi.unstubAllGlobals();
  db.exec('DELETE FROM ai_jobs; DELETE FROM recipes; DELETE FROM ai_configs; DELETE FROM users;');
  user = await createUser();
});

afterEach(() => vi.unstubAllGlobals());
afterAll(() => closeDatabase?.());

describe('redacción de secretos en la configuración IA', () => {
  async function saveConfig() {
    const created = await request('POST', '/configs', {
      name: 'Synthetic provider',
      provider: 'custom',
      baseUrl: 'https://redaction-test.invalid/v1',
      apiKey: SECRET,
      model: 'synthetic-model',
      retryAttempts: 0,
      concurrency: 0,
      timeout: 1000
    });
    return ((await created.json()) as { data: { id: string } }).data.id;
  }

  it('no expone ni persiste la clave cuando el proveedor la repite en un error HTTP', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(`Invalid API key: Bearer ${SECRET}`, { status: 401 })
    );

    const configId = await saveConfig();

    const tested = await request('POST', '/test-connection', { configId });
    const testedText = await tested.text();
    const stored = db
      .prepare('SELECT test_status, test_error FROM ai_configs WHERE id = ? AND user_id = ?')
      .get(configId, user.id) as { test_status: string; test_error: string | null };
    const listed = await request('GET', '/configs');
    const listedText = await listed.text();

    expect(tested.status).toBe(200);
    expect(stored.test_status).toBe('failed');
    expect(stored.test_error).toBe('HTTP 401');
    expect(`${testedText}\n${stored.test_error}\n${listedText}`).not.toContain(SECRET);
    expect(testedText).toContain('HTTP 401');
    expect(listedText).not.toContain('api_key');
  });

  it('redacta una clave que el modelo repita en una receta antes de responder al navegador', async () => {
    const responseContent = JSON.stringify({
      name: `Receta ${SECRET}`,
      description: 'Sintética',
      difficulty: 'easy',
      cuisine: null,
      totalTime: 10,
      prepTime: 5,
      cookTime: 5,
      restTime: null,
      baseServings: 1,
      calories: 100,
      ingredients: [
        {
          name: 'Tomate',
          quantity: 1,
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
      instructionsByLevel: {
        basic: [
          {
            stepNumber: 1,
            instruction: 'Lava el tomate.',
            duration: null,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ],
        intermediate: [
          {
            stepNumber: 1,
            instruction: 'Lava y corta el tomate.',
            duration: null,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ],
        expert: [
          {
            stepNumber: 1,
            instruction: 'Lava y corta el tomate en dados regulares.',
            duration: null,
            temperature: null,
            timerRequired: false,
            timerDuration: null,
            tips: null,
            warning: null,
            illustration: null
          }
        ]
      },
      nutrition: null,
      storage: null,
      tags: []
    });
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: responseContent } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    await saveConfig();

    const generated = await request('POST', '/generate-recipe', {
      ingredients: [{ id: 'i-1', name: 'tomate', quantity: 1, unit: 'un' }]
    });
    const body = await generated.text();

    expect(generated.status).toBe(200);
    expect(body).not.toContain(SECRET);
    expect(body).toContain('[redactado]');
  });

  it('no expone el excerpt del body si la respuesta 200 del proveedor no es JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response(`Invalid API key: ${SECRET}`, { status: 200 }));
    await saveConfig();

    const generated = await request('POST', '/generate-recipe', {
      ingredients: [{ id: 'i-1', name: 'tomate', quantity: 1, unit: 'un' }]
    });
    const body = await generated.text();

    expect(generated.status).toBe(500);
    expect(body).not.toContain(SECRET);
    expect(body).toContain('Invalid AI response format');
  });
});
