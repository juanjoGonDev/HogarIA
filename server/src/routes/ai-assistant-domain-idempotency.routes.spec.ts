import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { ReadableStream } from 'node:stream/web';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type DomainResponse = { status: number; body: any };
type DelayedCall = {
  bodyStarted: Promise<void>;
  pending: Promise<Response>;
  releaseBody: () => void;
};

const ACTIONS = {
  pantry: '123e4567-e89b-42d3-a456-426614174001',
  list: '123e4567-e89b-42d3-a456-426614174002',
  item: '123e4567-e89b-42d3-a456-426614174003',
  event: '123e4567-e89b-42d3-a456-426614174004',
  recipe: '123e4567-e89b-42d3-a456-426614174005',
  task: '123e4567-e89b-42d3-a456-426614174006'
} as const;

const userId = 'assistant-domain-user';
const householdId = 'assistant-domain-household';
let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let token = '';

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  db = database.getDatabase();
  closeDatabase = database.closeDatabase;
  const { config } = await import('../config/app.config.js');
  const [pantry, shopping, calendar, recipes, tasks] = await Promise.all([
    import('./pantry.routes.js'),
    import('./shopping.routes.js'),
    import('./calendar.routes.js'),
    import('./recipes.routes.js'),
    import('./household-tasks.routes.js')
  ]);

  app = new Hono();
  app.onError((error, context) => context.json({ success: false, message: error.message }, 500));
  app.route('/api/pantry', pantry.pantryRoutes);
  app.route('/api/shopping', shopping.shoppingRoutes);
  app.route('/api/calendar', calendar.calendarRoutes);
  app.route('/api/recipes', recipes.recipeRoutes);
  app.route('/api/household', tasks.householdTasksRoutes);
  token = jwt.sign({ sub: userId, email: 'assistant-domain@test.local' }, config.auth.jwtSecret);
});

afterAll(async () => {
  const { stopWorker } = await import('../utils/ticket-queue.js');
  stopWorker();
  closeDatabase?.();
});

beforeEach(() => {
  db.exec(`
    DELETE FROM assistant_action_results;
    DELETE FROM household_task_weeks;
    DELETE FROM calendar_event_attendees;
    DELETE FROM calendar_events;
    DELETE FROM recipe_step_video_assets;
    DELETE FROM recipe_image_assets;
    DELETE FROM user_recipes;
    DELETE FROM recipes;
    DELETE FROM shopping_list_events;
    DELETE FROM shopping_list_discounts;
    DELETE FROM shopping_list_items;
    DELETE FROM shopping_lists;
    DELETE FROM ingredients;
    DELETE FROM pantry_categories;
    DELETE FROM household_members;
    DELETE FROM users;
    DELETE FROM households;
  `);
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    householdId,
    'Casa sintética',
    'ASSISTANT-TEST'
  );
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, 'assistant-domain@test.local', 'Prueba', 'hash', householdId);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'admin', NULL)`
  ).run('assistant-domain-membership', householdId, userId);
});

async function call(
  method: string,
  path: string,
  body: unknown,
  actionId?: string,
  assistantHouseholdId: string | null = householdId
): Promise<Response> {
  return await app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-assistant-household-id': assistantHouseholdId ?? '',
      'x-household-id': householdId,
      ...(actionId ? { 'x-assistant-action-id': actionId } : {})
    },
    body: JSON.stringify(body)
  });
}

function callWithDelayedBody(
  method: string,
  path: string,
  bodyValue: unknown,
  actionId: string,
  assistantHouseholdId: string | null = householdId
): DelayedCall {
  let markBodyStarted!: () => void;
  let releaseBody!: () => void;
  let hasStarted = false;
  const bodyStarted = new Promise<void>((resolve) => {
    markBodyStarted = resolve;
  });
  const bodyText = JSON.stringify(bodyValue);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!hasStarted) {
        hasStarted = true;
        markBodyStarted();
      }
      return new Promise<void>((resolve) => {
        releaseBody = () => {
          controller.enqueue(new TextEncoder().encode(bodyText));
          controller.close();
          resolve();
        };
      });
    }
  });
  const pending = Promise.resolve(
    app.request(
      path,
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-assistant-household-id': assistantHouseholdId ?? '',
          'x-household-id': householdId,
          'x-assistant-action-id': actionId
        },
        body,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' })
    )
  );
  return { bodyStarted, pending, releaseBody: () => releaseBody() };
}

async function read(response: Response): Promise<DomainResponse> {
  return { status: response.status, body: await response.json() };
}

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe('atomic idempotency for global assistant domain actions', () => {
  it('rejects household writes when selection changes during body parsing', async () => {
    const otherHouseholdId = 'assistant-domain-other-household';
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      otherHouseholdId,
      'Otra casa sintética',
      'ASSISTANT-OTHER'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', NULL)`
    ).run('assistant-domain-other-membership', otherHouseholdId, userId);

    const pantry = callWithDelayedBody(
      'POST',
      '/api/pantry/ingredients',
      {
        name: 'Garbanzos',
        category: 'other',
        quantity: 1,
        unit: 'unit',
        expirationDate: null,
        location: 'pantry',
        notes: null
      },
      ACTIONS.pantry
    );
    await pantry.bodyStarted;
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(otherHouseholdId, userId);
    pantry.releaseBody();

    const pantryResponse = await read(await pantry.pending);
    expect(pantryResponse.status).toBe(409);
    expect(pantryResponse.body).toMatchObject({ code: 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED' });
    expect(count('ingredients')).toBe(0);
    expect(count('pantry_categories')).toBe(0);
    expect(count('assistant_action_results')).toBe(0);

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, userId);
    const shoppingList = callWithDelayedBody(
      'POST',
      '/api/shopping/lists',
      { name: 'Compra sintética', store: null },
      ACTIONS.list
    );
    await shoppingList.bodyStarted;
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(otherHouseholdId, userId);
    shoppingList.releaseBody();

    const shoppingListResponse = await read(await shoppingList.pending);
    expect(shoppingListResponse.status).toBe(409);
    expect(shoppingListResponse.body).toMatchObject({
      code: 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED'
    });
    expect(count('shopping_lists')).toBe(0);
    expect(count('assistant_action_results')).toBe(0);

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, userId);
    const savedList = await read(
      await call('POST', '/api/shopping/lists', { name: 'Compra sintética', store: null })
    );
    expect(savedList.status).toBe(201);
    const listId = savedList.body.data.id as string;
    const shoppingItem = callWithDelayedBody(
      'POST',
      `/api/shopping/lists/${listId}/items`,
      { name: 'Manzanas', quantity: 2, unit: 'unit', category: null, note: null },
      ACTIONS.item
    );
    await shoppingItem.bodyStarted;
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(otherHouseholdId, userId);
    shoppingItem.releaseBody();

    const shoppingItemResponse = await read(await shoppingItem.pending);
    expect(shoppingItemResponse.status).toBe(409);
    expect(shoppingItemResponse.body).toMatchObject({
      code: 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED'
    });
    expect(count('shopping_lists')).toBe(1);
    expect(count('shopping_list_items')).toBe(0);
    expect(count('assistant_action_results')).toBe(0);

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, userId);
    const calendar = callWithDelayedBody(
      'POST',
      '/api/calendar/events',
      {
        title: 'Cita sintética',
        kind: 'appointment',
        date: '2026-10-20',
        allDay: true,
        sharedWithHousehold: true
      },
      ACTIONS.event
    );
    await calendar.bodyStarted;
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(otherHouseholdId, userId);
    calendar.releaseBody();

    const calendarResponse = await read(await calendar.pending);
    expect(calendarResponse.status).toBe(409);
    expect(calendarResponse.body).toMatchObject({ code: 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED' });
    expect(count('calendar_events')).toBe(0);
    expect(count('assistant_action_results')).toBe(0);

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, userId);
    const task = callWithDelayedBody(
      'PUT',
      '/api/household/tasks',
      {
        weekStart: '2026-10-19',
        baseVersion: 0,
        tasks: [
          {
            id: `assistant-${ACTIONS.task}`,
            title: 'Regar plantas',
            details: null,
            scheduledDate: '2026-10-20',
            spaceId: null,
            assignedMemberId: null,
            completed: false
          }
        ]
      },
      ACTIONS.task
    );
    await task.bodyStarted;
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(otherHouseholdId, userId);
    task.releaseBody();

    const taskResponse = await read(await task.pending);
    expect(taskResponse.status).toBe(409);
    expect(taskResponse.body).toMatchObject({ code: 'HOUSEHOLD_CONTEXT_CHANGED' });
    expect(count('household_task_weeks')).toBe(0);
    expect(count('assistant_action_results')).toBe(0);
  });

  it('uses the validated sole-household snapshot without repairing a null selection', async () => {
    const savedList = await read(
      await call('POST', '/api/shopping/lists', { name: 'Compra de hogar', store: null })
    );
    expect(savedList.status).toBe(201);
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(userId);

    const householdLists = await read(await call('GET', '/api/shopping/lists', undefined));
    expect(householdLists.status).toBe(200);
    expect(householdLists.body.data.map((list: { name: string }) => list.name)).toContain(
      'Compra de hogar'
    );
    const shoppingItem = await read(
      await call(
        'POST',
        `/api/shopping/lists/${savedList.body.data.id}/items`,
        { name: 'Manzanas', quantity: 2, unit: 'unit', category: null, note: null },
        ACTIONS.item
      )
    );
    expect(shoppingItem.status).toBe(201);
    expect(
      db.prepare('SELECT household_id FROM shopping_lists WHERE id = ?').get(savedList.body.data.id)
    ).toEqual({
      household_id: householdId
    });

    const pantry = await read(
      await call(
        'POST',
        '/api/pantry/ingredients',
        {
          name: 'Lentejas',
          category: 'other',
          quantity: 1,
          unit: 'unit',
          expirationDate: null,
          location: 'pantry',
          notes: null
        },
        ACTIONS.pantry
      )
    );

    expect(pantry.status).toBe(201);
    expect(
      db.prepare('SELECT household_id FROM ingredients WHERE name = ?').get('Lentejas')
    ).toEqual({ household_id: householdId });
    expect(db.prepare('SELECT household_id FROM users WHERE id = ?').get(userId)).toEqual({
      household_id: null
    });

    const calendar = await read(
      await call(
        'POST',
        '/api/calendar/events',
        {
          title: 'Cita de hogar',
          kind: 'appointment',
          date: '2026-10-20',
          allDay: true,
          sharedWithHousehold: true
        },
        ACTIONS.event
      )
    );
    expect(calendar.status).toBe(201);
    expect(
      db.prepare('SELECT household_id FROM calendar_events WHERE title = ?').get('Cita de hogar')
    ).toEqual({ household_id: householdId });
    expect(db.prepare('SELECT household_id FROM users WHERE id = ?').get(userId)).toEqual({
      household_id: null
    });
  });

  it('replays the same approved action without duplicating writes in every supported domain', async () => {
    const pantryInput = {
      name: 'Garbanzos',
      category: 'other',
      quantity: 500,
      unit: 'g',
      expirationDate: null,
      location: 'pantry',
      notes: null
    };
    expect(
      (await read(await call('POST', '/api/pantry/ingredients', pantryInput, ACTIONS.pantry)))
        .status
    ).toBe(201);
    expect(
      (await read(await call('POST', '/api/pantry/ingredients', pantryInput, ACTIONS.pantry))).body
    ).toMatchObject({ success: true, idempotent: true });
    expect(count('ingredients')).toBe(1);

    const listInput = { name: 'Compra sintética', store: null };
    const firstList = await read(
      await call('POST', '/api/shopping/lists', listInput, ACTIONS.list)
    );
    const replayList = await read(
      await call('POST', '/api/shopping/lists', listInput, ACTIONS.list)
    );
    expect(firstList.status).toBe(201);
    expect(replayList.body).toMatchObject({ success: true, idempotent: true });
    expect(count('shopping_lists')).toBe(1);

    const listId = firstList.body.data.id as string;
    const itemInput = { name: 'Manzanas', quantity: 2, unit: 'unit', category: null, note: null };
    await call('POST', `/api/shopping/lists/${listId}/items`, itemInput, ACTIONS.item);
    const replayItem = await read(
      await call('POST', `/api/shopping/lists/${listId}/items`, itemInput, ACTIONS.item)
    );
    expect(replayItem.body).toMatchObject({ success: true, idempotent: true });
    expect(count('shopping_list_items')).toBe(1);
    expect(
      (db.prepare('SELECT quantity FROM shopping_list_items').get() as { quantity: number })
        .quantity
    ).toBe(2);

    const eventInput = {
      title: 'Cita sintética',
      kind: 'appointment',
      date: '2026-10-20',
      allDay: true,
      sharedWithHousehold: true
    };
    await call('POST', '/api/calendar/events', eventInput, ACTIONS.event);
    const replayEvent = await read(
      await call('POST', '/api/calendar/events', eventInput, ACTIONS.event)
    );
    expect(replayEvent.body).toMatchObject({ success: true, idempotent: true });
    expect(count('calendar_events')).toBe(1);

    const recipeInput = {
      name: 'Sopa sintética',
      ingredients: [{ name: 'Calabacín', quantity: 1, unit: 'unit' }],
      steps: [{ stepNumber: 1, instruction: 'Cocer.' }],
      author: 'ai',
      isPublic: false
    };
    await call('POST', '/api/recipes', recipeInput, ACTIONS.recipe);
    const replayRecipe = await read(
      await call('POST', '/api/recipes', recipeInput, ACTIONS.recipe)
    );
    expect(replayRecipe.body).toMatchObject({ success: true, idempotent: true });
    expect(count('recipes')).toBe(1);

    const taskInput = {
      weekStart: '2026-10-19',
      baseVersion: 0,
      tasks: [
        {
          id: `assistant-${ACTIONS.task}`,
          title: 'Regar plantas',
          details: null,
          scheduledDate: '2026-10-20',
          spaceId: null,
          assignedMemberId: null,
          completed: false
        }
      ]
    };
    expect(
      (await read(await call('PUT', '/api/household/tasks', taskInput, ACTIONS.task))).status
    ).toBe(200);
    const replayTask = await read(
      await call('PUT', '/api/household/tasks', taskInput, ACTIONS.task)
    );
    expect(replayTask.body).toMatchObject({ success: true, idempotent: true });
    expect(count('household_task_weeks')).toBe(1);
    expect(
      JSON.parse(
        (db.prepare('SELECT tasks_json FROM household_task_weeks').get() as { tasks_json: string })
          .tasks_json
      )
    ).toHaveLength(1);
    expect(count('assistant_action_results')).toBe(6);
  });

  it('rejects a changed payload for the same key and rejects shared events without a home', async () => {
    const id = ACTIONS.pantry;
    const initial = {
      name: 'Lentejas',
      category: 'other',
      quantity: 1,
      unit: 'unit',
      location: 'pantry'
    };
    await call('POST', '/api/pantry/ingredients', initial, id);
    const changed = await read(
      await call('POST', '/api/pantry/ingredients', { ...initial, quantity: 2 }, id)
    );
    expect(changed.status).toBe(409);
    expect(changed.body).toMatchObject({ code: 'ASSISTANT_ACTION_ID_CONFLICT' });
    expect(count('ingredients')).toBe(1);

    const noHome = '123e4567-e89b-42d3-a456-426614174007';
    const contextChanged = await read(
      await call(
        'POST',
        '/api/calendar/events',
        { title: 'No debe escribirse', kind: 'personal', date: '2026-10-21' },
        noHome,
        'otro-hogar'
      )
    );
    expect(contextChanged.status).toBe(409);
    expect(contextChanged.body).toMatchObject({ code: 'ASSISTANT_HOUSEHOLD_CONTEXT_CHANGED' });
    expect(count('calendar_events')).toBe(0);

    db.prepare('DELETE FROM household_members WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(userId);
    const event = await read(
      await call(
        'POST',
        '/api/calendar/events',
        {
          title: 'Privado no válido',
          kind: 'personal',
          date: '2026-10-21',
          sharedWithHousehold: true
        },
        noHome,
        null
      )
    );
    expect(event.status).toBe(409);
    expect(event.body).toMatchObject({ code: 'ASSISTANT_HOUSEHOLD_REQUIRED' });
    expect(count('calendar_events')).toBe(0);
  });
});
