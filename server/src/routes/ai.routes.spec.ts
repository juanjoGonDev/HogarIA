import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

/**
 * Las rutas de configuracion de IA (revision de la ## 8f a peticion del usuario): la prueba de
 * conexion con JSON DADO (no un «Hello» a ver que contesta) y la activacion. Dos promesas:
 *
 *   - La prueba va contra una config guardada (`configId`) o contra los datos del formulario
 *     tal cual (baseUrl+apiKey+model), que es lo que permite probar ANTES de guardar; y el
 *     estado (`test_status`) solo se persiste en la primera.
 *   - La configuracion activa es UNA: la recien creada es la activa, y activar otra apaga la
 *     anterior. La queja era «la IA no se activa se queda inactivada»: creabas una config
 *     nueva y la primera fila (la vieja, por rowid) seguia siendo la que contestaba.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let app: Hono;
let db: Sql;
let closeDatabase: () => void;

async function makeUser(email: string) {
  const id = `u-${email.split('@')[0]}`;
  db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
    id,
    email,
    'Tester',
    'hash'
  );
  const config = await import('../config/app.config.js');
  const token = jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' });
  return { id, token };
}

type User = { id: string; token: string };

function selectHousehold(
  user: User,
  householdId: string,
  permissions: { settings: boolean }
): void {
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    householdId,
    `Hogar ${householdId}`,
    `invite-${householdId}`
  );
  addMembership(user, householdId, permissions);
  db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, user.id);
}

function addMembership(user: User, householdId: string, permissions: { settings: boolean }): void {
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'member', ?)`
  ).run(`member-${householdId}-${user.id}`, householdId, user.id, JSON.stringify(permissions));
}

function call(user: User, method: string, path: string, body?: unknown, appLanguage?: string) {
  return app.request(`/api/ai${path}`, {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json',
      ...(appLanguage ? { 'x-app-language': appLanguage } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const json = async (response: Response): Promise<any> => await response.json();
const data = async (response: Response): Promise<any> => (await json(response)).data;

/** El proveedor contesta lo que se le diga: aqui se decide si la prueba pasa o no. */
function stubDelProveedor(content: string, status = 200): void {
  vi.stubGlobal(
    'fetch',
    (async (): Promise<Response> =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status
      })) as unknown as typeof fetch
  );
}

let alice: User;

beforeEach(async () => {
  vi.unstubAllGlobals();
  db.prepare('UPDATE users SET household_id = NULL').run();
  db.exec(
    'DELETE FROM calendar_event_attendees; DELETE FROM calendar_events; DELETE FROM meals; DELETE FROM weekly_calendars; DELETE FROM ai_jobs; DELETE FROM recipes; DELETE FROM ai_configs; DELETE FROM household_members; DELETE FROM households; DELETE FROM users;'
  );
  alice = await makeUser(`alice-${Math.random().toString(36).slice(2)}@test.local`);
});

afterEach(() => {
  if (!db || !alice) return;
  db.prepare(
    'DELETE FROM meals WHERE calendar_id IN (SELECT id FROM weekly_calendars WHERE user_id = ?)'
  ).run(alice.id);
  db.prepare('DELETE FROM weekly_calendars WHERE user_id = ?').run(alice.id);
});

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

afterAll(() => closeDatabase?.());

async function crearConfig(
  user: User,
  nombre: string,
  baseUrl = 'http://localhost:9/v1',
  retryAttempts = 3,
  apiKey = 'sk-x'
) {
  return data(
    await call(user, 'POST', '/configs', {
      name: nombre,
      provider: 'custom',
      baseUrl,
      apiKey,
      model: 'gpt-5',
      retryAttempts
    })
  );
}

describe('la configuracion activa es UNA', () => {
  it('la config recien creada es la activa, y apaga la anterior', async () => {
    const primera = await crearConfig(alice, 'Vieja');
    expect(primera.isActive).toBe(true);

    const segunda = await crearConfig(alice, 'Nueva');
    const filas = db
      .prepare('SELECT name, is_active FROM ai_configs ORDER BY created_at, rowid')
      .all() as { name: string; is_active: number }[];
    expect(filas).toEqual([
      { name: 'Vieja', is_active: 0 },
      { name: 'Nueva', is_active: 1 }
    ]);
    expect(segunda.isActive).toBe(true);
  });

  it('omite la api_key sin rechazar ids que contienen texto parecido', async () => {
    const config = await crearConfig(
      alice,
      'Con llave',
      'http://localhost:9/v1',
      3,
      'fixture-secret-value-not-returned'
    );
    db.prepare('UPDATE ai_configs SET id = ? WHERE id = ?').run('fixture-sk-id', config.id);
    const respuesta = await call(alice, 'GET', '/configs');
    const cuerpo = (await respuesta.json()) as { data: Record<string, unknown>[] };
    expect(cuerpo.data).toHaveLength(1);
    expect(cuerpo.data[0].id).toBe('fixture-sk-id');
    expect(cuerpo.data[0]).not.toHaveProperty('api_key');
    expect(cuerpo.data[0]).not.toHaveProperty('apiKey');
    expect(JSON.stringify(cuerpo.data)).not.toContain('fixture-secret-value-not-returned');
    expect(cuerpo.data[0].baseUrl).toBe('http://localhost:9/v1'); // camelCase, lo que la UI lee
  });

  it('activar una config apaga las demas: elegir es exclusivo', async () => {
    await crearConfig(alice, 'Vieja');
    const nueva = await crearConfig(alice, 'Nueva');
    const vieja = db.prepare('SELECT id FROM ai_configs WHERE name = ?').get('Vieja') as {
      id: string;
    };

    await call(alice, 'PATCH', `/configs/${vieja.id}`, { isActive: true });
    const filas = db
      .prepare('SELECT name, is_active FROM ai_configs ORDER BY created_at, rowid')
      .all() as { name: string; is_active: number }[];
    expect(filas).toEqual([
      { name: 'Vieja', is_active: 1 },
      { name: 'Nueva', is_active: 0 }
    ]);
    expect(nueva.isActive).toBe(true); // lo que devolvio el alta, antes del cambio
  });
});

describe('permisos de configuración IA por hogar', () => {
  it('no recurre a la config personal ni la expone sin una casa activa entre varias membresías', async () => {
    const personal = await crearConfig(alice, 'Personal privada');
    selectHousehold(alice, 'unselected-home-a', { settings: true });
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'unselected-home-b',
      'Hogar sin selección',
      'invite-unselected-b'
    );
    addMembership(alice, 'unselected-home-b', { settings: true });
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(alice.id);

    const { activeAiConfig } = await import('../utils/ai-client.js');
    expect(activeAiConfig(db, alice.id)).toBeUndefined();
    const response = await call(alice, 'GET', '/configs');

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SELECTION_REQUIRED'
    });
    expect(db.prepare('SELECT household_id FROM ai_configs WHERE id = ?').get(personal.id)).toEqual(
      {
        household_id: null
      }
    );
  });

  it('deniega también las rutas directas a quien no tiene settings en la casa activa', async () => {
    selectHousehold(alice, 'home-without-settings', { settings: false });

    const responses = await Promise.all([
      call(alice, 'GET', '/configs'),
      call(alice, 'POST', '/configs'),
      call(alice, 'PATCH', '/configs/not-owned'),
      call(alice, 'DELETE', '/configs/not-owned'),
      call(alice, 'POST', '/test-connection')
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    expect(await json(responses[0])).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SETTINGS_REQUIRED'
    });
    expect((db.prepare('SELECT COUNT(*) AS n FROM ai_configs').get() as { n: number }).n).toBe(0);
  });

  it('aísla configuraciones por hogar y permite usar la de casa sin conceder permiso settings', async () => {
    const personal = await crearConfig(alice, 'Personal');
    selectHousehold(alice, 'ai-home-a', { settings: true });
    const { activeAiConfig } = await import('../utils/ai-client.js');
    expect(activeAiConfig(db, alice.id)).toBeUndefined();

    const homeA = await crearConfig(alice, 'Proveedor casa A');
    expect(
      db.prepare('SELECT user_id, household_id FROM ai_configs WHERE id = ?').get(homeA.id)
    ).toEqual({ user_id: alice.id, household_id: 'ai-home-a' });

    const member = await makeUser('home-member@test.local');
    addMembership(member, 'ai-home-a', { settings: false });
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('ai-home-a', member.id);
    expect((await call(member, 'GET', '/configs')).status).toBe(403);
    expect(activeAiConfig(db, member.id)?.id).toBe(homeA.id);

    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'ai-home-b',
      'Hogar ai-home-b',
      'invite-ai-home-b'
    );
    addMembership(alice, 'ai-home-b', { settings: true });
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('ai-home-b', alice.id);
    const homeB = await crearConfig(alice, 'Proveedor casa B');

    expect(activeAiConfig(db, alice.id)?.id).toBe(homeB.id);
    expect((await data(await call(alice, 'GET', '/configs'))).map((row: any) => row.id)).toEqual([
      homeB.id
    ]);

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('ai-home-a', alice.id);
    expect(activeAiConfig(db, alice.id)?.id).toBe(homeA.id);
    expect((await data(await call(alice, 'GET', '/configs'))).map((row: any) => row.id)).toEqual([
      homeA.id
    ]);
    expect(db.prepare('SELECT household_id FROM ai_configs WHERE id = ?').get(personal.id)).toEqual(
      {
        household_id: null
      }
    );
  });
});

describe('POST /test-connection', () => {
  it('la config guardada se prueba con el JSON dado, y el estado queda en la fila', async () => {
    const config = await crearConfig(alice, 'Local');
    stubDelProveedor('{"status":"ok","message":"conexión establecida"}');

    const respuesta = await call(alice, 'POST', '/test-connection', { configId: config.id });
    expect(respuesta.status).toBe(200);
    const cuerpo = await data(respuesta);
    expect(cuerpo.success).toBe(true);
    expect(cuerpo.model).toBe('gpt-5');
    expect(typeof cuerpo.latency).toBe('number');

    const fila = db
      .prepare('SELECT test_status, test_error FROM ai_configs WHERE id = ?')
      .get(config.id) as { test_status: string | null; test_error: string | null };
    expect(fila.test_status).toBe('success');
    expect(fila.test_error).toBeNull();
  });

  it('el modelo que no devuelve el JSON pedido suspende la prueba, con su error en la fila', async () => {
    const config = await crearConfig(alice, 'Local');
    stubDelProveedor('Hello! How can I help you today?');

    const respuesta = await call(alice, 'POST', '/test-connection', { configId: config.id });
    const cuerpo = await data(respuesta);
    expect(cuerpo.success).toBe(false);
    expect(cuerpo.error).toContain('no devolvió el JSON pedido');

    const fila = db
      .prepare('SELECT test_status, test_error FROM ai_configs WHERE id = ?')
      .get(config.id) as { test_status: string | null; test_error: string | null };
    expect(fila.test_status).toBe('failed');
    expect(fila.test_error).toContain('no devolvió el JSON pedido');
  });

  it('se puede probar desde el formulario (sin guardar): el veredicto si, la fila no', async () => {
    stubDelProveedor('{"status":"ok","message":"conexión establecida"}');

    const respuesta = await call(alice, 'POST', '/test-connection', {
      baseUrl: 'http://localhost:9',
      apiKey: 'sk-x',
      model: 'gpt-5'
    });
    expect(respuesta.status).toBe(200);
    const cuerpo = await data(respuesta);
    expect(cuerpo.success).toBe(true);

    // Sin configId no hay fila que tocar: la casa aun no ha guardado nada.
    expect((db.prepare('SELECT COUNT(*) AS n FROM ai_configs').get() as { n: number }).n).toBe(0);
  });

  it('sin configId y sin datos de formulario no hay prueba que hacer', async () => {
    const respuesta = await call(alice, 'POST', '/test-connection', {});
    expect(respuesta.status).toBe(400);
  });
});

const recetaGenerada = {
  name: 'Lentejas de prueba',
  description: 'Una receta determinista de prueba.',
  difficulty: 'easy',
  cuisine: 'Mediterránea',
  totalTime: 30,
  prepTime: 10,
  cookTime: 20,
  restTime: null,
  baseServings: 1,
  calories: 420,
  ingredients: [
    {
      name: 'lentejas',
      quantity: 200,
      unit: 'g',
      preparation: '',
      isOptional: false,
      substitutes: [],
      notes: ''
    }
  ],
  utensils: ['Olla'],
  guidance: {
    appliances: ['Cocina de gas'],
    parallelTasks: ['Lavar y cortar las verduras mientras hierve el caldo.'],
    tipsAndVariations: ['Añadir pimentón fuera del fuego para que no se queme.'],
    batchCookingWarning: null
  },
  instructionsByLevel: {
    basic: [
      {
        stepNumber: 1,
        instruction: 'Cocer las lentejas.',
        duration: 20,
        temperature: null,
        timerRequired: true,
        timerDuration: 20,
        tips: '',
        warning: '',
        illustration: null
      }
    ],
    intermediate: [
      {
        stepNumber: 1,
        instruction: 'Sofreír y cocer las lentejas hasta que estén tiernas.',
        duration: 20,
        temperature: null,
        timerRequired: true,
        timerDuration: 20,
        tips: '',
        warning: '',
        illustration: null
      }
    ],
    expert: [
      {
        stepNumber: 1,
        instruction: 'Sofreír a fuego medio y cocer a hervor suave hasta textura al dente.',
        duration: 20,
        temperature: null,
        timerRequired: true,
        timerDuration: 20,
        tips: '',
        warning: '',
        illustration: null
      }
    ]
  },
  nutrition: { calories: 420, protein: 24, carbs: 60, fat: 8, fiber: 14 },
  storage: {
    method: 'Refrigerar',
    duration: '3 días',
    reheatingInstructions: 'Calentar',
    container: null,
    freezingPossible: true,
    freezingDuration: '3 meses'
  },
  tags: ['vegetariana']
};

const recetaConInstruccionesPorNivel = {
  ...recetaGenerada,
  instructionsByLevel: {
    basic: recetaGenerada.instructionsByLevel.basic,
    intermediate: recetaGenerada.instructionsByLevel.intermediate.map((step) => ({
      ...step,
      instruction: 'Sofreír las verduras y cocer las lentejas con el caldo.'
    })),
    expert: recetaGenerada.instructionsByLevel.expert.map((step) => ({
      ...step,
      instruction: 'Sofreír a fuego medio y cocer a hervor suave hasta textura al dente.'
    }))
  }
};

const peticionGeneracion = {
  ingredients: [{ id: 'lentils', name: 'lentejas', quantity: 200, unit: 'g' }],
  utensils: [{ id: 'pot', name: 'Olla', available: true }],
  servings: 2,
  difficulty: 'easy',
  detailLevel: 'basic',
  dietaryRestrictions: ['vegetariana'],
  allergies: ['cacahuete'],
  preferences: ['picante'],
  cookingTime: { min: 20, max: 35 }
};

function stubRecipeProvider(
  responseForCall: (callIndex: number) => Response = () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(recetaGenerada) } }] }),
      { status: 200 }
    )
) {
  const requests: Array<{ url: string; body: string }> = [];
  vi.stubGlobal('fetch', (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    requests.push({ url: String(input), body: String(init?.body ?? '') });
    return responseForCall(requests.length);
  }) as typeof fetch);
  return requests;
}

function recipeCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM recipes').get() as { count: number }).count;
}

function createMealForReplacement(
  userId: string,
  mealId: string,
  householdId: string | null = null
): void {
  const calendarId = `calendar-${mealId}`;
  db.prepare(
    `
    INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
    VALUES (?, ?, ?, '2026-10-05', '2026-10-11', '{}')
  `
  ).run(calendarId, householdId, userId);
  db.prepare(
    `
    INSERT INTO meals (id, calendar_id, date, meal_type, custom_meal, time, servings)
    VALUES (?, ?, '2026-10-07', 'dinner', 'Pasta con salsa', '20:00', 2)
  `
  ).run(mealId, calendarId);
}

describe('POST /generate-recipe y /generate-multiple-recipes', () => {
  it('rechaza restricciones estrictas sin verificador antes de llamar al proveedor', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    for (const [path, body] of [
      ['/generate-recipe', { ...peticionGeneracion, allergies: ['fructosa'] }],
      ['/generate-multiple-recipes', { ...peticionGeneracion, count: 2, allergies: ['histamina'] }]
    ] as const) {
      const response = await call(alice, 'POST', path, body);
      expect(response.status).toBe(422);
      expect((await json(response)).code).toBe('UNSUPPORTED_STRICT_RESTRICTION');
    }

    expect(requests).toHaveLength(0);
  });

  it('instruye el idioma activo resuelto y evita forzar español cuando la app está en inglés', async () => {
    await crearConfig(alice, 'Proveedor de prueba', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/generate-recipe', peticionGeneracion, 'en');
    expect(response.status).toBe(200);
    const system = JSON.parse(requests[0].body).messages[0].content as string;
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;

    expect(system).toContain('English (United Kingdom)');
    expect(prompt).toContain('English (United Kingdom)');
    expect(prompt).not.toContain('Responde siempre en español de España');
  });

  it('genera cantidades base para una ración y conserva en la respuesta el rendimiento normalizado', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/generate-recipe', {
      ...peticionGeneracion,
      servings: 4
    });
    const result = await json(response);
    const providerRequest = JSON.parse(requests[0].body);
    const prompt = providerRequest.messages[1].content as string;

    expect(response.status).toBe(200);
    expect(providerRequest.response_format.type).toBe('json_schema');
    expect(providerRequest.response_format.json_schema.strict).toBe(true);
    expect(prompt).toContain('Raciones solicitadas para cocinar: 4');
    expect(prompt).toContain('rendimiento base de exactamente 1 ración');
    expect(prompt).toContain('cantidades de ingredientes por ración');
    expect(prompt).toContain('baseServings=1');
    expect(result.data).toMatchObject({
      baseServings: 1,
      ingredients: [{ name: 'lentejas', quantity: 200, unit: 'g' }],
      guidance: { batchCookingWarning: null }
    });
    expect(recipeCount()).toBe(0);
  });

  it('rechaza una respuesta que no esté normalizada a una ración sin guardar nada', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ ...recetaGenerada, baseServings: 4 }) } }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/generate-recipe', {
      ...peticionGeneracion,
      servings: 4
    });

    expect(response.status).toBe(500);
    expect((await json(response)).success).toBe(false);
    expect(requests).toHaveLength(1);
    expect(recipeCount()).toBe(0);
  });

  it('uses the active household member count as the default recipe servings', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'servings-house',
      'Casa de raciones',
      'SERVINGS1'
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('servings-house', alice.id);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{"settings":true}')`
    ).run('servings-admin-membership', 'servings-house', alice.id);
    for (const suffix of ['two', 'three']) {
      const member = await makeUser(`servings-${suffix}@test.local`);
      db.prepare(
        `INSERT INTO household_members (id, household_id, user_id, role, permissions)
         VALUES (?, ?, ?, 'member', '{}')`
      ).run(`servings-${suffix}-membership`, 'servings-house', member.id);
    }
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);

    const generated = { ...recetaGenerada, baseServings: 1 };
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(generated) } }] }),
          { status: 200 }
        )
    );
    const request = { ...peticionGeneracion };
    delete (request as Partial<typeof peticionGeneracion>).servings;

    const response = await call(alice, 'POST', '/generate-recipe', request);
    const result = await json(response);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;

    expect(response.status).toBe(200);
    expect(result.data.baseServings).toBe(1);
    expect(prompt).toContain('Raciones solicitadas para cocinar: 3');
  });

  it('uses only selected active household tastes and ephemeral guest constraints', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'participants-house',
      'Casa interna',
      'PARTICP1'
    );
    db.prepare('UPDATE users SET household_id = ?, preferences = ? WHERE id = ?').run(
      'participants-house',
      JSON.stringify({
        taste: { allergies: ['lactosa'], likes: ['calabacín'], notes: 'nota alice' }
      }),
      alice.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{"settings":true}')`
    ).run('participants-alice', 'participants-house', alice.id);
    const selected = await makeUser('selected-participant@test.local');
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({
        taste: { allergies: ['marisco'], likes: ['tomate'], notes: 'no enviar nota' }
      }),
      selected.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('participants-selected', 'participants-house', selected.id);
    const inactive = await makeUser('inactive-participant@test.local');
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({ taste: { allergies: ['anacardo'], likes: ['piña'] } }),
      inactive.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
       VALUES (?, ?, ?, 'member', '{}', 0)`
    ).run('participants-inactive', 'participants-house', inactive.id);
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);

    const requests = stubRecipeProvider();
    const {
      servings: _legacyDefault,
      allergies: _legacyAllergies,
      ...request
    } = peticionGeneracion;
    const response = await call(alice, 'POST', '/generate-recipe', {
      ...request,
      householdMemberIds: ['participants-selected'],
      guests: [
        { allergies: ['huevo'], likes: ['lentejas'], notes: 'No usar correo ana@example.com' }
      ]
    });
    const result = await json(response);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;

    expect(response.status).toBe(200);
    expect(result.data.baseServings).toBe(1);
    expect(prompt).toContain('marisco');
    expect(prompt).toContain('tomate');
    expect(prompt).toContain('huevo');
    expect(prompt).toContain('lentejas');
    expect(prompt).not.toContain('lactosa');
    expect(prompt).not.toContain('anacardo');
    expect(prompt).not.toContain('nota alice');
    expect(prompt).not.toContain('no enviar nota');
    expect(prompt).not.toContain('alice@');
    expect(prompt).not.toContain('selected-participant@');
    expect(prompt).not.toContain('participants-selected');
    expect(prompt).not.toContain('ana@example.com');
  });

  it('rejects inactive or foreign member IDs before calling the recipe provider', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'invalid-participants-house',
      'Casa interna',
      'INVPART1'
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(
      'invalid-participants-house',
      alice.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{}')`
    ).run('invalid-participants-alice', 'invalid-participants-house', alice.id);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/generate-recipe', {
      ...peticionGeneracion,
      householdMemberIds: ['membership-from-another-house']
    });

    expect(response.status).toBe(400);
    expect((await json(response)).code).toBe('INVALID_HOUSEHOLD_MEMBER_SELECTION');
    expect(requests).toHaveLength(0);
    expect(recipeCount()).toBe(0);
  });

  it('does not return or save a generated recipe that conflicts with a selected allergy', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'allergy-participants-house',
      'Casa interna',
      'ALLPART1'
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(
      'allergy-participants-house',
      alice.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{"settings":true}')`
    ).run('allergy-participants-alice', 'allergy-participants-house', alice.id);
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({ taste: { allergies: ['cacahuete'] } }),
      alice.id
    );
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const conflictingRecipe = {
      ...recetaGenerada,
      ingredients: [
        {
          name: 'cacahuete',
          quantity: 30,
          unit: 'g',
          preparation: '',
          isOptional: false,
          substitutes: [],
          notes: ''
        }
      ]
    };
    stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(conflictingRecipe) } }] })
        )
    );

    const response = await call(alice, 'POST', '/generate-recipe', {
      ...peticionGeneracion,
      householdMemberIds: ['allergy-participants-alice']
    });

    const result = await json(response);
    expect(response.status, JSON.stringify(result)).toBe(422);
    expect(result.code).toBe('PARTICIPANT_RESTRICTION_CONFLICT');
    expect(recipeCount()).toBe(0);
  });

  it('single rechaza la respuesta si falta un nivel de instrucciones', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ...recetaGenerada,
                    instructionsByLevel: {
                      basic: recetaGenerada.instructionsByLevel.basic
                    }
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/generate-recipe', peticionGeneracion);
    const result = await json(response);

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('data');
    expect(requests).toHaveLength(1);
    expect(recipeCount()).toBe(0);
  });

  it('single devuelve todas las instrucciones y la selección inicial en una llamada', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(recetaConInstruccionesPorNivel) } }]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/generate-recipe', peticionGeneracion);
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.data.instructionsByLevel).toEqual(
      recetaConInstruccionesPorNivel.instructionsByLevel
    );
    expect(result.data.selectedDetailLevel).toBe('basic');
    expect(result.data).not.toHaveProperty('steps');
    expect(requests).toHaveLength(1);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;
    expect(prompt).toContain('genera SIEMPRE los tres niveles completos');
    expect(recipeCount()).toBe(0);
  });

  it('single devuelve un borrador con el prompt vigente y no crea filas', async () => {
    await crearConfig(alice, 'Proveedor de prueba', 'http://ai.test/v1');
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/generate-recipe', peticionGeneracion);
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject(recetaGenerada);
    expect(result.data).not.toHaveProperty('id');
    expect(recipeCount()).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('http://ai.test/v1/chat/completions');
    const providerBody = JSON.parse(requests[0].body);
    const prompt = providerBody.messages[1].content as string;
    expect(prompt).toContain('Ingredientes disponibles: 200 g de lentejas');
    expect(prompt).toContain('Utensilios disponibles: Olla');
    expect(prompt).toContain('Raciones solicitadas para cocinar: 2');
    expect(prompt).toContain('rendimiento base de exactamente 1 ración');
    expect(prompt).toContain('Dificultad: easy');
    expect(prompt).toContain('Nivel seleccionado al abrir la ficha: basic');
    expect(prompt).toContain('genera SIEMPRE los tres niveles completos');
    expect(prompt).toContain('Restricciones dietéticas: vegetariana');
    expect(prompt).toContain('Alergias: cacahuete');
    expect(prompt).toContain('Preferencias: picante');
    expect(prompt).toContain('Tiempo de cocción: entre 20 y 35 minutos');
    expect(prompt).toContain('español de España');
    expect(prompt).toContain('basic: pasos muy descriptivos');
    expect(prompt).toContain('El primer paso debe indicar qué ingredientes necesitan lavado');
    expect(prompt).toContain('si no hace falta lavar ninguno, indícalo expresamente');
    expect(prompt).toContain('freidora de aire/mini horno (máximo 200 °C)');
    expect(prompt).toContain('evita usarla si existe una alternativa razonable');
    expect(prompt).toContain('Instrucciones por nivel, todas completas y coherentes');
    expect(prompt).toContain('basic: pasos muy descriptivos');
    expect(prompt).toContain('intermediate: explicación equilibrada');
    expect(prompt).toContain('expert: instrucciones concisas y precisas');
    expect(prompt).toContain('Incluye tareas seguras que puedan hacerse en paralelo');
    expect(prompt).toContain(
      'consejos y variaciones concretos para mejorar sabor, textura o presentación'
    );
    expect(prompt).toContain('Estima kcal y macronutrientes por ración');
    expect(prompt).toContain('duración en frigorífico');
    expect(prompt).toContain('si admite congelación y recalentado');
    expect(prompt).toContain('nunca inventes URLs');
    expect(result.data.guidance).toEqual(recetaGenerada.guidance);
  });

  it('multiple genera exactamente las candidatas pedidas mediante el proveedor y no persiste ninguna', async () => {
    await crearConfig(alice, 'Proveedor de prueba', 'http://ai.test/v1');
    const requests = stubRecipeProvider((callIndex) => {
      const recipe = {
        ...recetaGenerada,
        name: `Receta ${callIndex}`,
        ingredients: recetaGenerada.ingredients.map((ingredient) => ({
          ...ingredient,
          name: `ingrediente ${callIndex}`
        })),
        instructionsByLevel: {
          basic: recetaGenerada.instructionsByLevel.basic.map((step) => ({
            ...step,
            instruction: `Preparar receta ${callIndex} en versión basic.`
          })),
          intermediate: recetaGenerada.instructionsByLevel.intermediate.map((step) => ({
            ...step,
            instruction: `Preparar receta ${callIndex} en versión intermediate.`
          })),
          expert: recetaGenerada.instructionsByLevel.expert.map((step) => ({
            ...step,
            instruction: `Preparar receta ${callIndex} en versión expert.`
          }))
        }
      };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }),
        { status: 200 }
      );
    });

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      count: 3
    });
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data.map((recipe: { name: string }) => recipe.name)).toEqual([
      'Receta 1',
      'Receta 2',
      'Receta 3'
    ]);
    expect(requests).toHaveLength(3);
    expect(requests.every(({ url }) => url === 'http://ai.test/v1/chat/completions')).toBe(true);
    expect(recipeCount()).toBe(0);
  });

  it('multiple devuelve un borrador completo y utilizable con retries desactivados', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      count: 1
    });
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      name: recetaGenerada.name,
      description: recetaGenerada.description,
      difficulty: 'easy',
      totalTime: 30,
      prepTime: 10,
      cookTime: 20,
      baseServings: 1,
      ingredients: [{ name: 'lentejas', quantity: 200, unit: 'g' }],
      guidance: { batchCookingWarning: null },
      instructionsByLevel: recetaGenerada.instructionsByLevel
    });
    expect(requests).toHaveLength(1);
    expect(recipeCount()).toBe(0);
  });

  it('multiple comparte las raciones elegidas como contexto y devuelve cada candidata normalizada', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      servings: 5,
      count: 1
    });
    const result = await json(response);
    const providerRequest = JSON.parse(requests[0].body);
    const prompt = providerRequest.messages[1].content as string;

    expect(response.status).toBe(200);
    expect(providerRequest.response_format.json_schema.strict).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data.map((recipe: { baseServings: number }) => recipe.baseServings)).toEqual([1]);
    expect(
      result.data.map(
        (recipe: { ingredients: { quantity: number }[] }) => recipe.ingredients[0].quantity
      )
    ).toEqual([200]);
    expect(prompt).toContain('Raciones solicitadas para cocinar: 5');
    expect(prompt).toContain('cantidades de ingredientes por ración');
    expect(requests).toHaveLength(1);
    expect(recipeCount()).toBe(0);
  });

  it('valida y devuelve un aviso explícito de cocinar en tandas', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const warning = 'Dora la cebolla en tres tandas; amontonarla haría que soltara agua.';
    stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ...recetaGenerada,
                    guidance: { ...recetaGenerada.guidance, batchCookingWarning: warning }
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/generate-recipe', {
      ...peticionGeneracion,
      servings: 6
    });
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.data.guidance.batchCookingWarning).toBe(warning);
    expect(recipeCount()).toBe(0);
  });

  it('multiple rechaza un JSON insuficiente en lugar de devolver un candidato parcial', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ name: 'Solo el título' }) } }]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      count: 2
    });
    const result = await json(response);

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('data');
    expect(requests).toHaveLength(1);
    expect(recipeCount()).toBe(0);
  });

  it('multiple rechaza una receta duplicada por contenido aunque el título cambie', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(() => {
      const isSecondCall = requests.length !== 1;
      const recipe = {
        ...recetaGenerada,
        name: isSecondCall ? 'Guiso rústico de lentejas' : 'Lentejas mediterráneas',
        ingredients: [
          {
            ...recetaGenerada.ingredients[0],
            name: isSecondCall ? 'LÉNTEJAS' : 'lentejas'
          }
        ],
        instructionsByLevel: {
          basic: [
            {
              ...recetaGenerada.instructionsByLevel.basic[0],
              instruction: isSecondCall ? 'COCER las lentejas!!!' : 'Cocer las lentejas.'
            }
          ],
          intermediate: [
            {
              ...recetaGenerada.instructionsByLevel.intermediate[0],
              instruction: isSecondCall
                ? 'SOFREÍR y cocer las lentejas hasta que estén tiernas!!!'
                : 'Sofreír y cocer las lentejas hasta que estén tiernas.'
            }
          ],
          expert: [
            {
              ...recetaGenerada.instructionsByLevel.expert[0],
              instruction: isSecondCall
                ? 'SOFREÍR a fuego medio y cocer a hervor suave hasta textura al dente!!!'
                : 'Sofreír a fuego medio y cocer a hervor suave hasta textura al dente.'
            }
          ]
        }
      };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }),
        { status: 200 }
      );
    });

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      count: 2
    });
    const result = await json(response);

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('data');
    expect(requests).toHaveLength(2);
    expect(recipeCount()).toBe(0);
  });

  it('multiple devuelve dos candidatas completas y distintas con una llamada por candidata', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider((callIndex) => {
      const recipe = {
        ...recetaGenerada,
        name: callIndex === 1 ? 'Lentejas mediterráneas' : 'Garbanzos al horno',
        ingredients: [
          {
            ...recetaGenerada.ingredients[0],
            name: callIndex === 1 ? 'lentejas' : 'garbanzos'
          },
          {
            ...recetaGenerada.ingredients[0],
            name: callIndex === 1 ? 'zanahoria' : 'calabacín'
          }
        ],
        instructionsByLevel: {
          basic: recetaGenerada.instructionsByLevel.basic.map((step) => ({
            ...step,
            instruction: callIndex === 1 ? 'Cocer las lentejas.' : 'Hornear los garbanzos.'
          })),
          intermediate: recetaGenerada.instructionsByLevel.intermediate.map((step) => ({
            ...step,
            instruction: callIndex === 1 ? 'Sofreír las lentejas.' : 'Dorar los garbanzos.'
          })),
          expert: recetaGenerada.instructionsByLevel.expert.map((step) => ({
            ...step,
            instruction:
              callIndex === 1
                ? 'Cocer las lentejas a hervor suave.'
                : 'Asar los garbanzos a temperatura controlada.'
          }))
        }
      };
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }),
        { status: 200 }
      );
    });

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      count: 2
    });
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].ingredients[0].name).toBe('lentejas');
    expect(result.data[1].ingredients[0].name).toBe('garbanzos');
    expect(result.data[0].instructionsByLevel.basic[0].instruction).not.toBe(
      result.data[1].instructionsByLevel.basic[0].instruction
    );
    expect(requests).toHaveLength(2);
    expect(recipeCount()).toBe(0);
  });

  it('un fallo del proveedor no se oculta como lista vacía ni éxito parcial', async () => {
    await crearConfig(alice, 'Proveedor de prueba', 'http://ai.test/v1');
    const requests = stubRecipeProvider((callIndex) =>
      callIndex === 1
        ? new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(recetaGenerada) } }] }),
            { status: 200 }
          )
        : new Response('provider unavailable', { status: 503 })
    );

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      count: 3
    });
    const result = await json(response);

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('data', []);
    expect(requests).toHaveLength(5);
    expect(recipeCount()).toBe(0);
  });

  it('single reporta el error del proveedor y no persiste una receta', async () => {
    await crearConfig(alice, 'Proveedor de prueba', 'http://ai.test/v1');
    const requests = stubRecipeProvider(
      () => new Response('provider unavailable', { status: 503 })
    );

    const response = await call(alice, 'POST', '/generate-recipe', peticionGeneracion);
    const result = await json(response);

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(requests).toHaveLength(4);
    expect(recipeCount()).toBe(0);
  });

  it('multiple falla si el proveedor no produce ninguna candidata utilizable', async () => {
    await crearConfig(alice, 'Proveedor de prueba', 'http://ai.test/v1');
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ ...recetaGenerada, name: ' ' }) } }]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/generate-multiple-recipes', {
      ...peticionGeneracion,
      count: 3
    });
    const result = await json(response);

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(result.data ?? []).toHaveLength(0);
    expect(requests).toHaveLength(1);
    expect(recipeCount()).toBe(0);
  });

  it('una respuesta sin receta útil falla y no devuelve un borrador vacío', async () => {
    await crearConfig(alice, 'Proveedor de prueba', 'http://ai.test/v1');
    stubRecipeProvider(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 })
    );

    const response = await call(alice, 'POST', '/generate-recipe', peticionGeneracion);
    const result = await json(response);

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(recipeCount()).toBe(0);
  });
});

describe('POST /replace-meal', () => {
  const guest = {
    allergies: ['cacahuete'],
    intolerances: ['lactosa'],
    diets: ['vegetariana'],
    likes: ['calabacín'],
    dislikes: ['cilantro'],
    notes: 'Sin picante; correo ana@example.test'
  };

  it('returns an ephemeral alternative, omits identifiers and leaves persistence to confirmation', async () => {
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    createMealForReplacement(alice.id, 'replace-meal-safe');
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: true,
                    name: 'Arroz de verduras',
                    description: 'Una alternativa vegetal sencilla.',
                    ingredients: ['arroz', 'calabacín', 'tomate'],
                    estimatedTime: 30,
                    servings: 2
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(
      alice,
      'POST',
      '/replace-meal',
      {
        mealId: 'replace-meal-safe',
        guests: [
          {
            ...guest,
            allergies: ['cacahuete; correo ana@example.test'],
            likes: ['calabacín; enlace https://example.test/perfil'],
            dislikes: ['cilantro; teléfono +34 600 123 456']
          }
        ]
      },
      'en'
    );
    const result = await json(response);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;
    const savedMeal = db
      .prepare('SELECT custom_meal FROM meals WHERE id = ?')
      .get('replace-meal-safe') as { custom_meal: string } | undefined;

    expect(response.status).toBe(200);
    expect(result.data.name).toBe('Arroz de verduras');
    expect(prompt).toContain('cacahuete');
    expect(prompt).toContain('English (United Kingdom)');
    expect(prompt).toContain('lactosa');
    expect(prompt).toContain('vegetariana');
    expect(prompt).toContain('calabacín');
    expect(prompt).toContain('[dato omitido]');
    expect(prompt).not.toContain('ana@example.test');
    expect(prompt).not.toContain('https://example.test/perfil');
    expect(prompt).not.toContain('+34 600 123 456');
    expect(prompt).not.toContain(alice.id);
    expect(savedMeal?.custom_meal).toBe('Pasta con salsa');
  });

  it('rejects an incomplete AI alternative and leaves the existing meal unchanged', async () => {
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    createMealForReplacement(alice.id, 'replace-meal-incomplete');
    stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: true,
                    name: 'Crema de verduras',
                    description: 'Una alternativa ligera.',
                    ingredients: [],
                    estimatedTime: 25,
                    servings: 2
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/replace-meal', {
      mealId: 'replace-meal-incomplete'
    });
    const body = await json(response);
    const savedMeal = db
      .prepare('SELECT custom_meal FROM meals WHERE id = ?')
      .get('replace-meal-incomplete') as { custom_meal: string } | undefined;

    expect(response.status).toBe(502);
    expect(body.code).toBe('INVALID_AI_RESULT');
    expect(savedMeal?.custom_meal).toBe('Pasta con salsa');
  });

  it('honors an explicit no-safe-alternative response without changing the existing meal', async () => {
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    createMealForReplacement(alice.id, 'replace-meal-no-safe-alternative');
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: false,
                    name: null,
                    description: null,
                    ingredients: null,
                    estimatedTime: null,
                    servings: null
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/replace-meal', {
      mealId: 'replace-meal-no-safe-alternative',
      guests: [guest]
    });
    const body = await json(response);
    const savedMeal = db
      .prepare('SELECT custom_meal FROM meals WHERE id = ?')
      .get('replace-meal-no-safe-alternative') as { custom_meal: string } | undefined;

    expect(response.status).toBe(422);
    expect(body.code).toBe('NO_SAFE_ALTERNATIVE');
    expect(requests).toHaveLength(1);
    expect(savedMeal?.custom_meal).toBe('Pasta con salsa');
  });

  it('applies plural goals and only the selected household members preferences to the prompt', async () => {
    selectHousehold(alice, 'replan-house', { settings: true });
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    const otherMember = await makeUser(
      `replan-other-${Math.random().toString(36).slice(2)}@test.local`
    );
    addMembership(otherMember, 'replan-house', { settings: false });
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({ taste: { allergies: ['huevo'], likes: ['lentejas'] } }),
      alice.id
    );
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({ taste: { allergies: ['nuez'], likes: ['champiñones'] } }),
      otherMember.id
    );
    createMealForReplacement(alice.id, 'replace-meal-goals', 'replan-house');
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: true,
                    name: 'Lentejas con verduras',
                    description: 'Un plato de cuchara.',
                    ingredients: ['lentejas', 'zanahoria'],
                    estimatedTime: 35,
                    servings: 2
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/replace-meal', {
      mealId: 'replace-meal-goals',
      householdMemberIds: [`member-replan-house-${alice.id}`],
      goals: {
        types: ['weight-loss', 'custom'],
        caloriesTarget: 1700,
        customInstructions: 'Prioriza platos saciantes con legumbres.'
      }
    });
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;

    expect(response.status).toBe(200);
    expect(prompt).toContain('weight-loss');
    expect(prompt).toContain('1700');
    expect(prompt).toContain('Prioriza platos saciantes con legumbres.');
    expect(prompt).toContain('huevo');
    expect(prompt).not.toContain('nuez');
    expect(prompt).not.toContain(otherMember.id);
  });

  it('rejects a member from another household without contacting the provider', async () => {
    selectHousehold(alice, 'replan-house-a', { settings: true });
    const other = await makeUser(
      `replan-foreign-${Math.random().toString(36).slice(2)}@test.local`
    );
    selectHousehold(other, 'replan-house-b', { settings: true });
    createMealForReplacement(alice.id, 'replace-meal-foreign-member', 'replan-house-a');
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/replace-meal', {
      mealId: 'replace-meal-foreign-member',
      householdMemberIds: [`member-replan-house-b-${other.id}`]
    });

    expect(response.status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('rejects guest identifiers and never calls the provider for an invalid request', async () => {
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();
    const response = await call(alice, 'POST', '/replace-meal', {
      mealId: 'some-meal',
      guests: [{ ...guest, name: 'Ana' }]
    });

    expect(response.status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('rejects an unverified strict restriction before contacting the provider', async () => {
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    createMealForReplacement(alice.id, 'replace-meal-unsupported');
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/replace-meal', {
      mealId: 'replace-meal-unsupported',
      guests: [{ ...guest, allergies: ['fructosa'] }]
    });

    expect(response.status).toBe(422);
    expect((await json(response)).code).toBe('UNSUPPORTED_STRICT_RESTRICTION');
    expect(requests).toHaveLength(0);
  });

  it('fails closed if the generated ingredient list contradicts an intolerance', async () => {
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    createMealForReplacement(alice.id, 'replace-meal-unsafe');
    stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    safe: true,
                    name: 'Puré cremoso',
                    description: 'Una alternativa sencilla.',
                    ingredients: ['patata', 'leche'],
                    estimatedTime: 25,
                    servings: 2
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/replace-meal', {
      mealId: 'replace-meal-unsafe',
      guests: [guest]
    });
    const body = await json(response);
    const savedMeal = db
      .prepare('SELECT custom_meal FROM meals WHERE id = ?')
      .get('replace-meal-unsafe') as { custom_meal: string } | undefined;

    expect(response.status).toBe(422);
    expect(body.code).toBe('NO_SAFE_ALTERNATIVE');
    expect(savedMeal?.custom_meal).toBe('Pasta con salsa');
  });

  it('does not disclose another user’s meal', async () => {
    const bob = await makeUser(`replace-bob-${Math.random().toString(36).slice(2)}@test.local`);
    createMealForReplacement(bob.id, 'replace-meal-private');
    await crearConfig(alice, 'Proveedor de reemplazo', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/replace-meal', { mealId: 'replace-meal-private' });

    expect(response.status).toBe(404);
    expect(requests).toHaveLength(0);
  });

  it('does not use the active home provider to replan a meal belonging to another home', async () => {
    selectHousehold(alice, 'replan-active-home', { settings: true });
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'replan-other-home',
      'Otra casa',
      'invite-replan-other'
    );
    addMembership(alice, 'replan-other-home', { settings: false });
    db.prepare(
      `
      INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
      VALUES ('calendar-other-home-meal', 'replan-other-home', ?, '2026-10-05', '2026-10-11', '{}')
    `
    ).run(alice.id);
    db.prepare(
      `
      INSERT INTO meals (id, calendar_id, date, meal_type, custom_meal, time, servings)
      VALUES ('meal-other-home', 'calendar-other-home-meal', '2026-10-07', 'dinner', 'Cena privada', '20:00', 2)
    `
    ).run();
    await crearConfig(alice, 'Proveedor hogar activo', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/replace-meal', { mealId: 'meal-other-home' });

    expect(response.status).toBe(404);
    expect((await json(response)).code).toBe('MEAL_NOT_FOUND');
    expect(requests).toHaveLength(0);
  });
});

describe('POST /recommendations y /plan-week', () => {
  it('rechaza intolerancias libres no verificables antes de llamar al proveedor o guardar', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      goals: { type: 'balanced' },
      mealTypes: ['lunch'],
      guests: [{ allergies: [], intolerances: ['histamina'], diets: [], likes: [], dislikes: [] }]
    });

    expect(response.status).toBe(422);
    expect((await json(response)).code).toBe('UNSUPPORTED_STRICT_RESTRICTION');
    expect(requests).toHaveLength(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars WHERE user_id = ?').get(alice.id)
    ).toEqual({ count: 0 });
  });

  it('devuelve recomendaciones usando comidas recientes, ingredientes y preferencias', async () => {
    const recommendations = [
      {
        name: 'Sopa de tomate',
        reason: 'Aprovecha lo disponible',
        ingredients: ['tomate'],
        estimatedTime: 20
      }
    ];
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ recommendations }) } }]
          }),
          { status: 200 }
        )
    );

    const response = await call(
      alice,
      'POST',
      '/recommendations',
      {
        recentMeals: [{ date: '2026-10-02', meal: 'Pasta', recipeId: 'pasta-1' }],
        availableIngredients: ['tomate'],
        householdPreferences: { likes: ['sopa'], dislikes: ['picante'], allergies: ['nuez'] },
        count: 1
      },
      'en'
    );
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(recommendations);
    expect(requests).toHaveLength(1);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;
    expect(prompt).toContain('2026-10-02: Pasta');
    expect(prompt).toContain('Ingredientes disponibles: tomate');
    expect(prompt).toContain('Likes=sopa, Dislikes=picante, Alergias=nuez');
    expect(prompt).toContain('English (United Kingdom)');
  });

  it('persiste el plan semanal solicitado y respeta solo las comidas elegidas', async () => {
    const plan = {
      days: [
        {
          date: '2026-10-05',
          meals: { dinner: { name: 'Cena QA', ingredients: ['Tomate'], time: 0 } },
          totalCalories: 180
        }
      ],
      shoppingList: ['Tomate']
    };
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }),
          { status: 200 }
        )
    );

    const response = await call(
      alice,
      'POST',
      '/plan-week',
      {
        startDate: '2026-10-05',
        endDate: '2026-10-05',
        goals: { type: 'balanced', caloriesTarget: 2000, customInstructions: 'Prioriza sencillez' },
        availableIngredients: ['Tomate'],
        mealTypes: ['dinner']
      },
      'en'
    );
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data.days).toEqual(plan.days);
    expect(result.data.saved.created).toBe(1);
    expect(result.data.saved.skipped).toBe(0);
    expect(requests).toHaveLength(1);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;
    expect(prompt).toContain('Indicaciones del usuario (prioritarias): Prioriza sencillez');
    expect(prompt).toContain('Ingredientes disponibles: Tomate');
    expect(prompt).toContain('Planifica SOLO estas comidas: dinner');
    expect(prompt).toContain('English (United Kingdom)');
    expect(prompt).not.toContain('"breakfast":');

    const persisted = db
      .prepare(
        `SELECT m.date, m.meal_type, m.custom_meal, m.notes
         FROM meals m
         INNER JOIN weekly_calendars c ON c.id = m.calendar_id
         WHERE c.user_id = ?`
      )
      .get(alice.id) as
      { date: string; meal_type: string; custom_meal: string; notes: string } | undefined;
    expect(persisted).toEqual({
      date: '2026-10-05',
      meal_type: 'dinner',
      custom_meal: 'Cena QA',
      notes: 'Ingredientes: Tomate'
    });
  });

  it('rechaza preferencias de hogar falsificadas antes de llamar al proveedor o persistir', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      goals: { type: 'balanced' },
      mealTypes: ['lunch'],
      householdPreferences: {
        likes: ['forged-household-like'],
        dislikes: ['forged-household-dislike'],
        allergies: ['forged-household-allergy']
      }
    });

    expect(response.status).toBe(400);
    expect(requests).toHaveLength(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars WHERE user_id = ?').get(alice.id)
    ).toEqual({ count: 0 });
  });

  it('usa miembros activos como raciones al planificar y guardar una semana', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'weekly-servings-house',
      'Casa de raciones',
      'WEEKSRV1'
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(
      'weekly-servings-house',
      alice.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{"settings":true}')`
    ).run('weekly-servings-admin', 'weekly-servings-house', alice.id);
    for (const suffix of ['one', 'two']) {
      const user = await makeUser(`weekly-serving-${suffix}@test.local`);
      db.prepare(
        `INSERT INTO household_members (id, household_id, user_id, role, permissions)
         VALUES (?, ?, ?, 'member', '{}')`
      ).run(`weekly-serving-${suffix}`, 'weekly-servings-house', user.id);
    }
    const inactive = await makeUser('weekly-serving-inactive@test.local');
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
       VALUES (?, ?, ?, 'member', '{}', 0)`
    ).run('weekly-serving-inactive', 'weekly-servings-house', inactive.id);
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);

    const plan = {
      days: [
        { date: '2026-10-05', meals: { dinner: { name: 'Cena QA', ingredients: ['Tomate'] } } }
      ],
      shoppingList: []
    };
    const requests = stubRecipeProvider(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }))
    );

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      goals: { type: 'balanced' },
      mealTypes: ['dinner']
    });
    const result = await json(response);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;
    const savedMeal = db
      .prepare(
        `SELECT m.servings FROM meals m
         JOIN weekly_calendars c ON c.id = m.calendar_id WHERE c.user_id = ?`
      )
      .get(alice.id) as { servings: number };

    expect(response.status).toBe(200);
    expect(prompt).toContain('Raciones por comida: 3');
    expect(result.data.saved.created).toBe(1);
    expect(savedMeal.servings).toBe(3);
  });

  it('planifica para miembros seleccionados e invitados sin persistir sus perfiles', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'weekly-participants-house',
      'Casa interna',
      'WEEKPART1'
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(
      'weekly-participants-house',
      alice.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{"settings":true}')`
    ).run('weekly-participants-alice', 'weekly-participants-house', alice.id);
    const selected = await makeUser('weekly-selected@test.local');
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({ taste: { allergies: ['sésamo'], likes: ['arroz'] } }),
      selected.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', '{}')`
    ).run('weekly-participants-selected', 'weekly-participants-house', selected.id);
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const plan = {
      days: [
        {
          date: '2026-10-12',
          meals: { lunch: { name: 'Arroz con verduras', ingredients: ['arroz'] } }
        }
      ],
      shoppingList: []
    };
    const requests = stubRecipeProvider(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }))
    );

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      goals: { type: 'balanced' },
      mealTypes: ['lunch'],
      householdMemberIds: ['weekly-participants-selected'],
      guests: [{ allergies: ['huevo'], likes: ['lentejas'] }]
    });
    const result = await json(response);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;
    const calendar = db
      .prepare('SELECT goals FROM weekly_calendars WHERE user_id = ?')
      .get(alice.id) as {
      goals: string;
    };
    const savedMeal = db.prepare('SELECT servings FROM meals WHERE calendar_id = ?').get(
      (
        db.prepare('SELECT id FROM weekly_calendars WHERE user_id = ?').get(alice.id) as {
          id: string;
        }
      ).id
    ) as { servings: number };

    expect(response.status).toBe(200);
    expect(prompt).toContain('Raciones por comida: 2');
    expect(prompt).toContain('sésamo');
    expect(prompt).toContain('arroz');
    expect(prompt).toContain('huevo');
    expect(prompt).toContain('lentejas');
    expect(prompt).not.toContain('weekly-selected@');
    expect(prompt).not.toContain('weekly-participants-selected');
    expect(result.data.saved.created).toBe(1);
    expect(savedMeal.servings).toBe(2);
    expect(calendar.goals).not.toContain('huevo');
    expect(calendar.goals).not.toContain('lentejas');
  });

  it('rechaza un plan semanal que incluya ingredientes incompatibles y no lo persiste', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'weekly-allergy-house',
      'Casa interna',
      'WEEKALG1'
    );
    db.prepare('UPDATE users SET household_id = ?, preferences = ? WHERE id = ?').run(
      'weekly-allergy-house',
      JSON.stringify({ taste: { allergies: ['huevo'] } }),
      alice.id
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{"settings":true}')`
    ).run('weekly-allergy-alice', 'weekly-allergy-house', alice.id);
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    days: [
                      {
                        date: '2026-10-12',
                        meals: { lunch: { name: 'Tortilla', ingredients: ['huevo'] } }
                      }
                    ],
                    shoppingList: []
                  })
                }
              }
            ]
          })
        )
    );

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      goals: { type: 'balanced' },
      mealTypes: ['lunch'],
      householdMemberIds: ['weekly-allergy-alice']
    });

    expect(response.status).toBe(422);
    expect((await json(response)).code).toBe('PARTICIPANT_RESTRICTION_CONFLICT');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars WHERE user_id = ?').get(alice.id)
    ).toEqual({ count: 0 });
  });

  const unverifiablePlans: Array<{ label: string; plan: unknown }> = [
    {
      label: 'plato devuelto como string',
      plan: { days: [{ date: '2026-10-12', meals: { lunch: 'Tortilla' } }], shoppingList: [] }
    },
    {
      label: 'lista de ingredientes vacía',
      plan: {
        days: [{ date: '2026-10-12', meals: { lunch: { name: 'Tortilla', ingredients: [] } } }],
        shoppingList: []
      }
    },
    {
      label: 'campo de ingredientes ausente',
      plan: {
        days: [{ date: '2026-10-12', meals: { lunch: { name: 'Tortilla' } } }],
        shoppingList: []
      }
    },
    { label: 'respuesta sin días', plan: { shoppingList: [] } },
    { label: 'lista de días vacía', plan: { days: [], shoppingList: [] } },
    { label: 'día mal formado', plan: { days: [null], shoppingList: [] } },
    {
      label: 'día sin comidas verificables',
      plan: { days: [{ date: '2026-10-12' }], shoppingList: [] }
    },
    {
      label: 'comidas con forma no válida',
      plan: { days: [{ date: '2026-10-12', meals: [] }], shoppingList: [] }
    }
  ];

  for (const { label, plan } of unverifiablePlans) {
    it(`no devuelve ni persiste una comida con restricciones sin ingredientes verificables: ${label}`, async () => {
      db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
        JSON.stringify({ taste: { allergies: ['huevo'] } }),
        alice.id
      );
      await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
      const requests = stubRecipeProvider(
        () =>
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }),
            { status: 200 }
          )
      );

      const response = await call(alice, 'POST', '/plan-week', {
        startDate: '2026-10-12',
        endDate: '2026-10-12',
        goals: { type: 'balanced' },
        mealTypes: ['lunch']
      });
      const result = await json(response);

      expect(response.status).toBe(422);
      expect(result.code).toBe('PARTICIPANT_RESTRICTIONS_UNVERIFIABLE');
      expect(result).not.toHaveProperty('data');
      expect(requests).toHaveLength(1);
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars WHERE user_id = ?').get(alice.id)
      ).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM meals').get()).toEqual({ count: 0 });
    });
  }

  it('acepta varios objetivos y texto libre, los incluye en el prompt y persiste el contrato plural', async () => {
    const plan = {
      days: [
        {
          date: '2026-10-12',
          meals: {
            lunch: { name: 'Garbanzos con espinacas', ingredients: ['garbanzos', 'espinacas'] }
          }
        }
      ],
      shoppingList: []
    };
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      goals: {
        types: ['weight-loss', 'variety'],
        caloriesTarget: 1850,
        customInstructions: 'Prioriza legumbres y cenas sencillas'
      },
      mealTypes: ['lunch']
    });
    const result = await json(response);

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data.saved.created).toBe(1);
    const prompt = JSON.parse(requests[0].body).messages[1].content as string;
    expect(prompt).toContain('Objetivos: Perder peso, Variada');
    expect(prompt).toContain(
      'Indicaciones del usuario (prioritarias): Prioriza legumbres y cenas sencillas'
    );

    const calendar = db
      .prepare('SELECT goals FROM weekly_calendars WHERE user_id = ?')
      .get(alice.id) as { goals: string };
    expect(JSON.parse(calendar.goals)).toMatchObject({
      type: 'weight-loss',
      types: ['weight-loss', 'variety'],
      customInstructions: 'Prioriza legumbres y cenas sencillas',
      dailyCalories: 1850
    });
  });

  it('rechaza objetivos vacíos o un objetivo personalizado sin texto antes de llamar al proveedor', async () => {
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider();

    for (const goals of [{ types: [] }, { types: ['custom'] }]) {
      const response = await call(alice, 'POST', '/plan-week', {
        startDate: '2026-10-12',
        endDate: '2026-10-12',
        goals
      });

      expect(response.status).toBe(400);
    }
    expect(requests).toHaveLength(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars WHERE user_id = ?').get(alice.id)
    ).toEqual({ count: 0 });
  });

  it('mantiene compatible el objetivo singular legacy y lo normaliza a una lista', async () => {
    const plan = { days: [{ date: '2026-10-12', meals: { dinner: { name: 'Sopa' } } }] };
    await crearConfig(alice, 'Proveedor sin retries', 'http://ai.test/v1', 0);
    const requests = stubRecipeProvider(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }),
          { status: 200 }
        )
    );

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-12',
      endDate: '2026-10-12',
      goals: { type: 'balanced' },
      mealTypes: ['dinner']
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(requests[0].body).messages[1].content).toContain('Objetivo: Equilibrada');
    const calendar = db
      .prepare('SELECT goals FROM weekly_calendars WHERE user_id = ?')
      .get(alice.id) as { goals: string };
    expect(JSON.parse(calendar.goals)).toMatchObject({ type: 'balanced', types: ['balanced'] });
  });

  it('rechaza un plan cuando todas las comidas están bloqueadas sin llamar al proveedor', async () => {
    db.prepare('UPDATE users SET preferences = ? WHERE id = ?').run(
      JSON.stringify({
        mealPlan: { breakfast: false, lunch: false, snack: false, dinner: false }
      }),
      alice.id
    );
    const requests = stubRecipeProvider();

    const response = await call(alice, 'POST', '/plan-week', {
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      goals: { type: 'balanced' },
      mealTypes: ['dinner']
    });
    const result = await json(response);

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.code).toBe('MEAL_PLAN_ALL_BLOCKED');
    expect(requests).toHaveLength(0);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM weekly_calendars WHERE user_id = ?').get(alice.id)
    ).toEqual({ count: 0 });
  });
});
