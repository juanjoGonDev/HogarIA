import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
// Las rutas se importan DENTRO de `beforeAll`, y no arriba: una importacion estatica arrastra
// `config/app.config.js`, que lee DATABASE_PATH al evaluarse —antes de la linea que lo pone a
// `:memory:`— y la prueba acaba escribiendo en la BD de desarrollo del repositorio. Era la única
// spec de rutas con este descuido, y fallaba en cuanto alguien usaba la app en local.

/**
 * Las sueltas del calendario de la casa, sobre una BD en memoria real. Lo que interesa
 * aqui no es el INSERT: es quien ve que (la casa compartida y la que no se compartio),
 * quien puede tocar (solo el autor), y que una comida NO pueda escribirse por esta via.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let persistSharedMeal: typeof import('../utils/shared-meal-calendar.store.js').persistSharedMeal;

async function makeUser(id: string, householdId: string | null, name = 'Alguien') {
  const email = `${id}@hogaria.test`;
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, email, name, 'hash', householdId);
  const config = await import('../config/app.config.js');
  const token = jwt.sign({ sub: id, email }, config.config.auth.jwtSecret, { expiresIn: '1h' });
  return { id, email, token };
}

type User = { id: string; email: string; token: string };

function call(user: User, method: string, path: string, body?: unknown) {
  return app.request(`/api/calendar${path}`, {
    method,
    headers: {
      authorization: `Bearer ${user.token}`,
      'content-type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

/** Igual que en la compra: `Response.json()` es `unknown` y aqui se ancha una vez. */
async function data(response: Response) {
  const raw = await response.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`respuesta no JSON ${response.status}: ${raw}`);
  }
  if (body?.success !== true) throw new Error(`respuesta inesperada: ${JSON.stringify(body)}`);
  return body.data;
}

describe('calendario de la casa (§8f)', () => {
  const householdId = 'hh-cal';

  beforeAll(async () => {
    const { calendarRoutes } = await import('./calendar.routes.js');
    const database = await import('../config/database.js');
    await database.initializeDatabase();
    closeDatabase = database.closeDatabase;
    db = database.getDatabase();
    persistSharedMeal = (await import('../utils/shared-meal-calendar.store.js')).persistSharedMeal;
    app = new Hono();
    app.route('/api/calendar', calendarRoutes);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(() => {
    // Orden inverso a las FK: primero las sueltas, luego las cuentas, luego la casa.
    // Borrar TODO (y no solo lo de esta suite) es lo que permite repetir el mismo id
    // en cada test y leer el fallo sin ambiguedad cuando algo se queda atras.
    for (const sql of [
      'DELETE FROM calendar_event_attendees',
      'DELETE FROM calendar_events',
      'DELETE FROM household_members',
      'DELETE FROM meals',
      'DELETE FROM weekly_calendars',
      'DELETE FROM users',
      'DELETE FROM households'
    ]) {
      db.prepare(sql).run();
    }
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      householdId,
      'La casa',
      'CALTEST1'
    );
  });

  const event = {
    title: 'Carpinteria: medir el pasillo',
    kind: 'home',
    date: '2026-03-11',
    startTime: '17:30',
    endTime: '18:15'
  } as const;

  it('crea, lee y borra una suelta', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const created = (await data(
      await call(alice, 'POST', '/events', { ...event, sharedWithHousehold: true })
    )) as any;
    expect(created.id).toBeTruthy();
    expect(created.allDay).toBe(false);
    expect(created.editable).toBe(true);

    const list = await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31'));
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe(event.title);
    // El nombre de quien la escribio viaja en la lectura: es lo que pinta la burbuja.
    expect(list[0].authorName).toBe('Alice');
    // Y su foto junto a el, para que el «de quien» sea el mismo icono en toda la app.
    expect(list[0].authorAvatar).toBeNull();
    db.prepare(`UPDATE users SET avatar = '/uploads/alice.png' WHERE id = ?`).run(alice.id);
    const conFoto = (await data(
      await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
    )) as any[];
    expect(conFoto[0].authorAvatar).toBe('/uploads/alice.png');

    expect((await call(alice, 'DELETE', `/events/${created.id}`)).status).toBe(200);
    expect(await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31'))).toEqual(
      []
    );
  });

  it('la casa ve la suelta compartida, y la que no se compartio no', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const bob = await makeUser('cal-bob', householdId, 'Bob');
    for (const [id, userId, role] of [
      ['hm-share-alice', alice.id, 'admin'],
      ['hm-share-bob', bob.id, 'member']
    ]) {
      db.prepare(
        'INSERT INTO household_members (id, household_id, user_id, role, permissions) VALUES (?, ?, ?, ?, ?)'
      ).run(id, householdId, userId, role, '{}');
    }
    await call(alice, 'POST', '/events', { ...event, sharedWithHousehold: true });
    const privateOne = (await data(
      await call(alice, 'POST', '/events', { ...event, title: 'Mi dentista' })
    )) as any;
    // Al crear no se devuelve el nombre de quien escribe: quien llama ya lo sabe, y la
    // lectura es el sitio donde el nombre interesa (es de otra persona).
    expect(privateOne.authorName).toBeNull();

    const seen = await data(await call(bob, 'GET', '/events?from=2026-03-01&to=2026-03-31'));
    expect(seen.map((e: any) => e.title)).toEqual([event.title]);
    expect(seen[0].editable).toBe(false);
    expect(
      await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31'))
    ).toHaveLength(2);
  });

  it('proyecta una comida confirmada una vez solo a participantes con permiso, sin compartir notas ni objetivos privados', async () => {
    const alice = await makeUser('meal-alice', householdId, 'Alice');
    const bob = await makeUser('meal-bob', householdId, 'Bob');
    const carol = await makeUser('meal-carol', householdId, 'Carol');
    const dave = await makeUser('meal-dave', householdId, 'Dave');
    const erin = await makeUser('meal-erin', householdId, 'Erin');
    for (const user of [alice, bob, carol, dave, erin]) {
      db.prepare(
        'INSERT INTO household_members (id, household_id, user_id, role, permissions) VALUES (?, ?, ?, ?, ?)'
      ).run(
        `hm-${user.id}`,
        householdId,
        user.id,
        'member',
        JSON.stringify({ calendar: { view: true, edit: true } })
      );
    }
    db.prepare('UPDATE households SET share_calendar = 0 WHERE id = ?').run(householdId);
    db.prepare(
      `INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'meal-bob-calendar',
      householdId,
      bob.id,
      '2026-10-12',
      '2026-10-18',
      '{"private":"bob-goal"}'
    );

    const saved = persistSharedMeal(db, alice.id, {
      proposalId: 'proposal-calendar-shared-meal',
      date: '2026-10-14',
      mealType: 'lunch',
      customMeal: 'Guiso común',
      time: '13:30',
      servings: 5,
      participantIds: [alice.id, bob.id],
      recipeSnapshot: {
        name: 'Guiso común',
        description: 'Receta compartida sintética',
        baseServings: 1,
        times: { prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 },
        ingredients: [{ name: 'arroz', quantity: 100, unit: 'g' }],
        instructions: ['Lavar', 'Cocer'],
        prompt: 'dato privado que no debe viajar'
      }
    });
    await call(alice, 'POST', '/meals', {
      date: '2026-10-14',
      mealType: 'dinner',
      customMeal: 'Comida personal de Alice',
      servings: 1
    });
    db.prepare('UPDATE meals SET notes = ? WHERE id = ?').run(
      'nota privada de Alice',
      saved.meal.id
    );
    db.prepare('UPDATE weekly_calendars SET goals = ? WHERE user_id = ?').run(
      '{"private":"alice-goal"}',
      alice.id
    );

    const bobData = (await data(
      await call(bob, 'GET', '/range?startDate=2026-10-14&endDate=2026-10-14')
    )) as any;
    const sharedForBob = bobData.meals.filter((meal: any) => meal.isShared);
    expect(sharedForBob).toHaveLength(1);
    expect(sharedForBob[0]).toMatchObject({
      id: saved.meal.id,
      servings: 5,
      notes: null,
      calendar_id: null,
      participantIds: [alice.id, bob.id]
    });
    expect(sharedForBob[0].recipe_snapshot).toEqual({
      name: 'Guiso común',
      description: 'Receta compartida sintética',
      baseServings: 1,
      times: { prepTimeMinutes: 10, cookTimeMinutes: 20, totalTimeMinutes: 30 },
      ingredients: [{ name: 'arroz', quantity: 100, unit: 'g' }],
      instructions: ['Lavar', 'Cocer']
    });
    expect(JSON.stringify(sharedForBob[0])).not.toContain('dato privado');
    expect(sharedForBob[0]).not.toHaveProperty('source_proposal_id');
    expect(bobData.goals).toEqual({ private: 'bob-goal' });

    const aliceData = (await data(
      await call(alice, 'GET', '/range?startDate=2026-10-14&endDate=2026-10-14')
    )) as any;
    expect(aliceData.meals.filter((meal: any) => meal.isShared)).toHaveLength(1);
    expect(aliceData.goals).toEqual({ private: 'alice-goal' });

    const carolData = (await data(
      await call(carol, 'GET', '/range?startDate=2026-10-14&endDate=2026-10-14')
    )) as any;
    expect(carolData.meals.filter((meal: any) => meal.isShared)).toHaveLength(1);
    expect(carolData.meals.map((meal: any) => meal.custom_meal)).toEqual(['Guiso común']);
    expect(carolData.meals[0]).toMatchObject({
      participantIds: [alice.id, bob.id],
      participants: [
        { id: alice.id, name: 'Alice' },
        { id: bob.id, name: 'Bob' }
      ],
      calendar_id: null
    });
    expect(JSON.stringify(carolData.meals)).not.toContain('Alice-goal');
    expect(JSON.stringify(carolData.meals)).not.toContain('nota privada');

    // La ruta semanal también proyecta el plan del hogar si el miembro aún no tiene
    // calendario propio, sin copiar los objetivos privados de quien confirmó la propuesta.
    const carolWeek = (await data(await call(carol, 'GET', ''))) as any;
    expect(carolWeek.meals.filter((meal: any) => meal.isShared)).toHaveLength(1);
    expect(carolWeek.meals.map((meal: any) => meal.custom_meal)).toEqual(['Guiso común']);
    expect(carolWeek.goals).toEqual({});
    expect(carolWeek.id).toBeNull();

    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      JSON.stringify({ calendar: { view: false, edit: true } }),
      dave.id
    );
    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run(erin.id);
    expect(
      (
        (await data(
          await call(dave, 'GET', '/range?startDate=2026-10-14&endDate=2026-10-14')
        )) as any
      ).meals
    ).toEqual([]);
    expect(await data(await call(dave, 'GET', ''))).toBeNull();
    expect(
      (
        (await data(
          await call(erin, 'GET', '/range?startDate=2026-10-14&endDate=2026-10-14')
        )) as any
      ).meals
    ).toEqual([]);
    expect(await data(await call(erin, 'GET', ''))).toBeNull();
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM meals WHERE source_proposal_id = ?')
        .get('proposal-calendar-shared-meal:single')
    ).toEqual({ count: 1 });
  });

  it('oculta la comida compartida si posteriormente se revoca calendar.view o se desactiva la membresía', async () => {
    const alice = await makeUser('meal-acl-alice', householdId, 'Alice');
    const bob = await makeUser('meal-acl-bob', householdId, 'Bob');
    for (const user of [alice, bob]) {
      db.prepare(
        'INSERT INTO household_members (id, household_id, user_id, role, permissions) VALUES (?, ?, ?, ?, ?)'
      ).run(
        `hm-${user.id}`,
        householdId,
        user.id,
        'member',
        JSON.stringify({ calendar: { view: true, edit: true } })
      );
    }
    persistSharedMeal(db, alice.id, {
      proposalId: 'proposal-calendar-acl-meal',
      date: '2026-10-14',
      mealType: 'lunch',
      customMeal: 'Arroz',
      servings: 2,
      participantIds: [bob.id]
    });
    db.prepare(
      `INSERT INTO weekly_calendars (id, household_id, user_id, week_start, week_end, goals)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'meal-acl-bob-calendar',
      householdId,
      bob.id,
      '2026-10-12',
      '2026-10-18',
      '{"private":"bob-goal"}'
    );

    const bobWeek = (await data(await call(bob, 'GET', ''))) as any;
    expect(bobWeek.meals.filter((meal: any) => meal.isShared)).toHaveLength(1);
    expect(bobWeek.meals.find((meal: any) => meal.isShared).calendar_id).toBeNull();
    expect(bobWeek.goals).toEqual({ private: 'bob-goal' });
    expect(
      ((await data(await call(alice, 'GET', ''))) as any).meals.filter((meal: any) => meal.isShared)
    ).toHaveLength(1);

    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      JSON.stringify({ calendar: { view: false, edit: true } }),
      bob.id
    );
    const revoked = (await data(
      await call(bob, 'GET', '/range?startDate=2026-10-14&endDate=2026-10-14')
    )) as any;
    expect(revoked.meals).toEqual([]);

    db.prepare('UPDATE household_members SET permissions = ?, is_active = 1 WHERE user_id = ?').run(
      JSON.stringify({ calendar: { view: true, edit: true } }),
      bob.id
    );
    db.prepare('UPDATE household_members SET is_active = 0 WHERE user_id = ?').run(bob.id);
    const inactive = (await data(
      await call(bob, 'GET', '/range?startDate=2026-10-14&endDate=2026-10-14')
    )) as any;
    expect(inactive.meals).toEqual([]);
  });

  it('ver el evento de otra persona no es poder reescribirlo', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const bob = await makeUser('cal-bob', householdId, 'Bob');
    const created = (await data(
      await call(alice, 'POST', '/events', { ...event, sharedWithHousehold: true })
    )) as any;

    const patch = await call(bob, 'PATCH', `/events/${created.id}`, { title: 'Ya no vengo' });
    expect(patch.status).toBe(403);
    expect(((await patch.json()) as any).message).toBe('FORBIDDEN');
    expect((await call(bob, 'DELETE', `/events/${created.id}`)).status).toBe(403);
    expect(
      (await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')))[0].title
    ).toBe(event.title);
  });

  it('el filtro de tipos deja pintar solo lo que interesa', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    await call(alice, 'POST', '/events', { ...event, sharedWithHousehold: true });
    await call(alice, 'POST', '/events', {
      title: 'Comprar velas',
      kind: 'shopping',
      date: '2026-03-12',
      allDay: 1
    });
    await call(alice, 'POST', '/events', { title: 'Cumple', kind: 'personal', date: '2026-03-13' });

    const home = await data(
      await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31&kinds=home')
    );
    expect(home.map((e: any) => e.title)).toEqual([event.title]);
    const two = await data(
      await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31&kinds=home,shopping')
    );
    expect(two).toHaveLength(2);
    // Las de todo el día van delante: en el día se pintan como franja completa y si no,
    // quedan debajo de las horas, que es lo que hace legible la columna.
    expect(two[1].allDay).toBe(true);
  });

  it('una comida no se cuela por aqui: la manda el plan', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const response = await call(alice, 'POST', '/events', {
      title: 'Cena',
      kind: 'meal',
      date: '2026-03-11'
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).message).toBe('MEAL_COMES_FROM_THE_PLAN');
  });

  it('rechaza horas absurdas y fechas sin formato', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    expect((await call(alice, 'POST', '/events', { ...event, endTime: '17:00' })).status).toBe(400);
    expect((await call(alice, 'POST', '/events', { ...event, startTime: '25:00' })).status).toBe(
      400
    );
    expect((await call(alice, 'POST', '/events', { ...event, date: '11/03/2026' })).status).toBe(
      400
    );
    expect((await call(alice, 'POST', '/events', { ...event, title: '   ' })).status).toBe(400);
    expect((await call(alice, 'POST', '/events', { ...event, color: 'rojo' })).status).toBe(400);
    // `to` falta: sin ventana no hay forma razonable de responder, y devolver todo
    // seria el peor comportamiento posible para un endpoint que se paga en milisegundos.
    expect((await call(alice, 'GET', '/events?from=2026-03-01')).status).toBe(400);
  });

  it('marcar todo el dia borra las horas, y el PATCH no toca lo que no se mando', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const created = (await data(await call(alice, 'POST', '/events', event))) as any;
    expect(created.startTime).toBe('17:30');

    const updated = (await data(
      await call(alice, 'PATCH', `/events/${created.id}`, { allDay: true })
    )) as any;
    expect(updated.allDay).toBe(true);
    expect(updated.startTime).toBeNull();
    expect(updated.endTime).toBeNull();
    // El titulo sigue ahi: un PATCH parcial no borra lo que no se menciona.
    expect(updated.title).toBe(event.title);
  });

  it('fuera de la ventana no se devuelve nada, aunque el evento exista', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    await call(alice, 'POST', '/events', event);
    expect(await data(await call(alice, 'GET', '/events?from=2026-04-01&to=2026-04-30'))).toEqual(
      []
    );
  });

  it('sin token no hay calendario de la casa', async () => {
    const response = await app.request('/api/calendar/events?from=2026-03-01&to=2026-03-31');
    expect(response.status).toBe(401);
  });

  /* ── 12o: los huecos de un formulario, y quien entra en el evento ───────────── */

  it('un evento con SOLO lo obligatorio se crea, y lo demas queda vacio de verdad', async () => {
    // El repro del usuario: «da error si no mandas todos los campos», siendo campos que el propio
    // dialog marca como opcionales. Aquí no se manda ninguno de esos.
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const created = (await data(
      await call(alice, 'POST', '/events', { title: 'Carpinteria', date: '2026-03-11' })
    )) as any;
    expect(created.title).toBe('Carpinteria');
    expect(created.kind).toBe('other');
    expect(created.allDay).toBe(true); // sin hora, «todo el dia»: no un evento a medianoche
    for (const field of ['startTime', 'endTime', 'color', 'notes', 'location']) {
      expect(created[field], `${field} deberia estar vacio`).toBeNull();
    }
    // Y se lee por la ventana, que es lo que hace que exista en la rejilla.
    const list = (await data(
      await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
    )) as any[];
    expect(list.map((row) => row.id)).toContain(created.id);
  });

  it('los opcionales admiten null y cadena vacia, que son las formas del hueco', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const shapes = [
      { notes: null, location: null, color: null },
      { notes: '', location: '   ', color: '' },
      { startTime: '', endTime: '', allDay: null, sharedWithHousehold: null }
    ];
    for (const [index, shape] of shapes.entries()) {
      const response = await call(alice, 'POST', '/events', {
        title: `Forma ${index}`,
        date: '2026-03-12',
        ...shape
      });
      expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    }
    const rows = (await data(
      await call(alice, 'GET', '/events?from=2026-03-12&to=2026-03-12')
    )) as any[];
    expect(rows).toHaveLength(3);
    // Un hueco no se guarda como cadena en blanco: se guarda como «sin valor», que es lo que
    // permite volver a dejarlo vacio después.
    expect(rows.map((row) => row.notes)).toEqual([null, null, null]);
  });

  it('un 400 dice el campo y el motivo, no «Invalid input data»', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const response = await call(alice, 'POST', '/events', { title: '', date: '11-03-2026' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.code).toBe('INVALID_FORM');
    expect(body.message).toMatch(/Titulo/);
    expect(body.issues.map((issue: any) => issue.field)).toContain('date');
  });

  it('quitar la nota con null si la quita (y no es un «guardado» que no toca nada)', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const created = (await data(
      await call(alice, 'POST', '/events', {
        title: 'Carpinteria',
        date: '2026-03-11',
        notes: 'Medir 90 cm'
      })
    )) as any;
    expect(created.notes).toBe('Medir 90 cm');

    const cleared = (await data(
      await call(alice, 'PATCH', `/events/${created.id}`, { notes: null })
    )) as any;
    expect(cleared.notes).toBeNull();
    // Y el resto sigue donde estaba.
    expect(cleared.title).toBe('Carpinteria');
  });

  it('la hora de una comida se puede quitar: el PATCH la escribe, no la ignora', async () => {
    // Dos bugs de una: `time` no estaba en la lista de columnas del PATCH (cambiar la hora no hacfa
    // nada) y con `.optional()` a secas vaciar el campo devolvfa un 400.
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const created = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'lunch',
        customMeal: 'Gazpacho',
        time: '14:00'
      })
    )) as any;
    expect(created.time).toBe('14:00');

    const moved = (await data(
      await call(alice, 'PATCH', `/meals/${created.id}`, { time: '15:30' })
    )) as any;
    expect(moved.time).toBe('15:30');

    const cleared = (await data(
      await call(alice, 'PATCH', `/meals/${created.id}`, { time: null })
    )) as any;
    expect(cleared.time).toBeNull();
  });

  it('sustituye varios platos seleccionados juntos y conserva sus horarios y raciones', async () => {
    const alice = await makeUser('cal-replan-alice', householdId, 'Alice');
    const breakfast = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'breakfast',
        customMeal: 'Tostadas',
        time: '08:00',
        servings: 2,
        notes: 'Sin prisa'
      })
    )) as any;
    const dinner = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'dinner',
        customMeal: 'Pasta',
        time: '20:30',
        servings: 4,
        notes: 'Con ensalada'
      })
    )) as any;

    const response = await call(alice, 'PATCH', '/meals/bulk/replace-selected', {
      replacements: [
        { id: breakfast.id, customMeal: 'Avena con fruta' },
        { id: dinner.id, customMeal: 'Merluza al horno' }
      ]
    });

    expect(response.status).toBe(200);
    const replaced = (await data(response)) as any[];
    expect(replaced.map((meal) => meal.id)).toEqual([breakfast.id, dinner.id]);
    expect(replaced.map((meal) => meal.custom_meal)).toEqual([
      'Avena con fruta',
      'Merluza al horno'
    ]);
    expect(replaced.map((meal) => [meal.time, meal.servings, meal.notes])).toEqual([
      ['08:00', 2, 'Sin prisa'],
      ['20:30', 4, 'Con ensalada']
    ]);
  });

  it('no aplica sustituciones parciales cuando un plato seleccionado ya no existe', async () => {
    const alice = await makeUser('cal-replan-stale-alice', householdId, 'Alice');
    const existing = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'lunch',
        customMeal: 'Lentejas',
        time: '14:00'
      })
    )) as any;

    const response = await call(alice, 'PATCH', '/meals/bulk/replace-selected', {
      replacements: [
        { id: existing.id, customMeal: 'Arroz con verduras' },
        { id: 'missing-meal-id', customMeal: 'Tortilla' }
      ]
    });

    expect(response.status).toBe(404);
    const unchanged = (await data(
      await call(alice, 'GET', `/range?startDate=2026-03-11&endDate=2026-03-11`)
    )) as any;
    expect(unchanged.meals).toHaveLength(1);
    expect(unchanged.meals[0]).toMatchObject({
      id: existing.id,
      custom_meal: 'Lentejas',
      time: '14:00'
    });
  });

  it('repetir la misma confirmación no crea comidas duplicadas ni cambia los demás campos', async () => {
    const alice = await makeUser('cal-replan-idempotent', householdId, 'Alice');
    const meal = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'lunch',
        customMeal: 'Sopa',
        time: '13:30',
        servings: 3,
        notes: 'Sin cilantro'
      })
    )) as any;
    const replacements = [{ id: meal.id, customMeal: 'Crema de calabaza' }];

    const first = await call(alice, 'PATCH', '/meals/bulk/replace-selected', { replacements });
    const second = await call(alice, 'PATCH', '/meals/bulk/replace-selected', { replacements });
    const range = (await data(
      await call(alice, 'GET', '/range?startDate=2026-03-11&endDate=2026-03-11')
    )) as any;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(range.meals).toHaveLength(1);
    expect(range.meals[0]).toMatchObject({
      id: meal.id,
      custom_meal: 'Crema de calabaza',
      time: '13:30',
      servings: 3,
      notes: 'Sin cilantro'
    });
  });

  it('separa calendario, objetivos y sustituciones por hogar activo del mismo usuario', async () => {
    const alice = await makeUser('cal-two-homes', householdId, 'Alice');
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).run('hm-cal-home-a', householdId, alice.id, 'admin');
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'hh-cal-other',
      'Otra casa',
      'CALTEST2'
    );
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).run('hm-cal-home-b', 'hh-cal-other', alice.id, 'admin');

    const mealA = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'lunch',
        customMeal: 'Plato casa A',
        time: '14:00'
      })
    )) as any;
    await call(alice, 'PATCH', '/goals', {
      weekStart: '2026-03-09',
      types: ['weight-loss'],
      customInstructions: 'Objetivos casa A'
    });

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('hh-cal-other', alice.id);
    const mealB = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'dinner',
        customMeal: 'Plato casa B',
        time: '20:00'
      })
    )) as any;
    await call(alice, 'PATCH', '/goals', {
      weekStart: '2026-03-09',
      types: ['muscle-gain'],
      customInstructions: 'Objetivos casa B'
    });

    const rangeB = (await data(
      await call(alice, 'GET', '/range?startDate=2026-03-09&endDate=2026-03-15')
    )) as any;
    expect(rangeB.meals.map((meal: any) => meal.id)).toEqual([mealB.id]);
    expect(rangeB.goals).toMatchObject({
      types: ['muscle-gain'],
      customInstructions: 'Objetivos casa B'
    });
    expect((await data(await call(alice, 'GET', ''))).meals.map((meal: any) => meal.id)).toEqual([
      mealB.id
    ]);

    const cannotReplaceOtherHouse = await call(alice, 'PATCH', '/meals/bulk/replace-selected', {
      replacements: [{ id: mealA.id, customMeal: 'No tocar casa A' }]
    });
    expect(cannotReplaceOtherHouse.status).toBe(404);
    expect(
      (await call(alice, 'PATCH', `/meals/${mealA.id}`, { customMeal: 'No tocar casa A' })).status
    ).toBe(404);
    expect((await call(alice, 'DELETE', `/meals/${mealA.id}`)).status).toBe(404);
    expect(
      (
        db.prepare('SELECT custom_meal FROM meals WHERE id = ?').get(mealA.id) as {
          custom_meal: string;
        }
      ).custom_meal
    ).toBe('Plato casa A');

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, alice.id);
    const rangeA = (await data(
      await call(alice, 'GET', '/range?startDate=2026-03-09&endDate=2026-03-15')
    )) as any;
    expect(rangeA.meals.map((meal: any) => meal.id)).toEqual([mealA.id]);
    expect(rangeA.goals).toMatchObject({
      types: ['weight-loss'],
      customInstructions: 'Objetivos casa A'
    });
  });

  it('requiere hogar activo cuando hay varias membresías en vez de mezclar calendarios', async () => {
    const alice = await makeUser('cal-no-active-home', householdId, 'Alice');
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).run('hm-cal-no-active-a', householdId, alice.id, 'admin');
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'hh-cal-no-active-b',
      'Otra casa',
      'CALTEST3'
    );
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).run('hm-cal-no-active-b', 'hh-cal-no-active-b', alice.id, 'admin');
    db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(alice.id);

    const read = await call(alice, 'GET', '/range?startDate=2026-03-09&endDate=2026-03-15');
    const write = await call(alice, 'POST', '/meals', {
      date: '2026-03-11',
      mealType: 'lunch',
      customMeal: 'No guardar sin contexto'
    });
    expect(read.status).toBe(409);
    expect(write.status).toBe(409);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM meals').get() as { count: number }).count
    ).toBe(0);
  });

  it('rechaza platos ajenos o ya completados antes de aplicar cualquier cambio', async () => {
    const alice = await makeUser('cal-replan-owner', householdId, 'Alice');
    const bob = await makeUser('cal-replan-other', householdId, 'Bob');
    const aliceMeal = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'lunch',
        customMeal: 'Sopa',
        time: '14:00'
      })
    )) as any;
    const bobMeal = (await data(
      await call(bob, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'dinner',
        customMeal: 'Pupusas',
        time: '20:30'
      })
    )) as any;

    const foreign = await call(alice, 'PATCH', '/meals/bulk/replace-selected', {
      replacements: [
        { id: aliceMeal.id, customMeal: 'Crema de verduras' },
        { id: bobMeal.id, customMeal: 'Yuca frita' }
      ]
    });
    expect(foreign.status).toBe(404);
    expect(
      (await data(await call(alice, 'GET', '/range?startDate=2026-03-11&endDate=2026-03-11')))
        .meals[0]
    ).toMatchObject({ id: aliceMeal.id, custom_meal: 'Sopa' });

    await call(alice, 'PATCH', `/meals/${aliceMeal.id}`, { completed: true });
    const completed = await call(alice, 'PATCH', '/meals/bulk/replace-selected', {
      replacements: [{ id: aliceMeal.id, customMeal: 'Arroz' }]
    });
    expect(completed.status).toBe(409);
    expect(
      (await data(await call(alice, 'GET', '/range?startDate=2026-03-11&endDate=2026-03-11')))
        .meals[0]
    ).toMatchObject({ id: aliceMeal.id, custom_meal: 'Sopa', completed: 1 });
  });

  it('usa los miembros activos del hogar como raciones por defecto y respeta el cambio explícito', async () => {
    const alice = await makeUser('cal-servings-alice', householdId, 'Alice');
    const members = [
      { id: alice.id, active: 1 },
      { id: 'cal-servings-bob', active: 1 },
      { id: 'cal-servings-child', active: 1 },
      { id: 'cal-servings-away', active: 0 }
    ];
    for (const [index, member] of members.entries()) {
      if (member.id !== alice.id) {
        db.prepare(
          'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
        ).run(member.id, `${member.id}@hogaria.test`, member.id, 'hash', householdId);
      }
      db.prepare(
        `INSERT INTO household_members (id, household_id, user_id, role, permissions, is_active)
         VALUES (?, ?, ?, ?, '{}', ?)`
      ).run(
        `cal-servings-membership-${index}`,
        householdId,
        member.id,
        member.id === alice.id ? 'admin' : 'member',
        member.active
      );
    }

    const defaultMeal = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'lunch',
        customMeal: 'Lentejas'
      })
    )) as any;
    const overrideMeal = (await data(
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: 'dinner',
        customMeal: 'Tortilla',
        servings: 5
      })
    )) as any;

    expect(defaultMeal.servings).toBe(3);
    expect(overrideMeal.servings).toBe(5);
  });

  it('las comidas se ordenan por el dia, y la merienda va antes que la cena', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    for (const type of ['dinner', 'snack', 'lunch', 'breakfast']) {
      await call(alice, 'POST', '/meals', {
        date: '2026-03-11',
        mealType: type,
        customMeal: `Plato ${type}`
      });
    }
    const range = (await data(
      await call(alice, 'GET', '/range?startDate=2026-03-11&endDate=2026-03-11')
    )) as any;
    expect(range.meals.map((meal: any) => meal.meal_type)).toEqual([
      'breakfast',
      'lunch',
      'snack',
      'dinner'
    ]);
  });

  it('invitar a alguien de la casa le abre el evento, y salirse de el no es borrarlo', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const bob = await makeUser('cal-bob', householdId, 'Bob');
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).run('hm-a', householdId, alice.id, 'admin');
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).run('hm-b', householdId, bob.id, 'member');

    // Un evento NO compartido con la casa, pero si con Bob: solo lo ve Bob, no «toda la casa».
    const created = (await data(
      await call(alice, 'POST', '/events', {
        title: 'Cita del dentista',
        date: '2026-03-11',
        startTime: '09:00',
        sharedWithHousehold: false,
        attendeeIds: [bob.id]
      })
    )) as any;
    expect(created.attendeeIds).toEqual([bob.id]);

    const seen = (await data(
      await call(bob, 'GET', '/events?from=2026-03-01&to=2026-03-31')
    )) as any[];
    expect(seen.map((row) => row.id)).toContain(created.id);
    expect(seen[0].editable).toBe(false);
    expect(seen[0].attendees[0].name).toBe('Bob');
    // El listado tiene que traer la pareja: el dialogo de edicion marca las casillas con `attendeeIds`,
    // y sin el se abria con la cara de Bob pintada y la casilla vacia —guardar sin tocar nada borraba la
    // invitacion. Es el bug que el usuario volvio a reportar, y estaba aqui, no en el POST.
    expect(seen[0].attendeeIds).toEqual([bob.id]);

    // Bob no puede reescribirlo...
    expect((await call(bob, 'PATCH', `/events/${created.id}`, { title: 'Otra cosa' })).status).toBe(
      403
    );
    // ...pero si puede salirse de el, y eso lo quita de SU calendario sin borrar el de Alice.
    expect((await call(bob, 'DELETE', `/events/${created.id}/attendees/me`)).status).toBe(200);
    expect(await data(await call(bob, 'GET', '/events?from=2026-03-01&to=2026-03-31'))).toEqual([]);
    const stillThere = (await data(
      await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
    )) as any[];
    expect(stillThere.map((row) => row.id)).toContain(created.id);

    // Y Alice no «se sale» de lo suyo: eso se borra.
    expect((await call(alice, 'DELETE', `/events/${created.id}/attendees/me`)).status).toBe(403);
  });

  it('invitar a quien no es de la casa se dice, no se traga', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const response = await call(alice, 'POST', '/events', {
      title: 'Cita',
      date: '2026-03-11',
      attendeeIds: ['no-existe']
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.code).toBe('ATTENDEE_NOT_IN_HOUSEHOLD');
    expect(body.data.rejected).toEqual(['no-existe']);
  });

  it('quitar a todos los invitados con una lista vacia funciona', async () => {
    const alice = await makeUser('cal-alice', householdId, 'Alice');
    const bob = await makeUser('cal-bob', householdId, 'Bob');
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role, permissions) VALUES (?, ?, ?, ?, ?)'
    ).run('hm-a-empty-attendees', householdId, alice.id, 'admin', '{}');
    db.prepare(
      'INSERT INTO household_members (id, household_id, user_id, role) VALUES (?, ?, ?, ?)'
    ).run('hm-b', householdId, bob.id, 'member');
    const created = (await data(
      await call(alice, 'POST', '/events', {
        title: 'Mudanza',
        date: '2026-03-14',
        attendeeIds: [bob.id]
      })
    )) as any;
    expect(
      await data(await call(bob, 'GET', '/events?from=2026-03-01&to=2026-03-31'))
    ).toHaveLength(1);

    const updated = (await data(
      await call(alice, 'PATCH', `/events/${created.id}`, { attendeeIds: [] })
    )) as any;
    expect(updated.attendeeIds).toEqual([]);
    // ...y el proximo listado ya no la trae: una lectura que no refleja el vaciado es un guardado que
    // el usuario dara por perdido.
    const after = (await data(
      await call(alice, 'GET', '/events?from=2026-03-09&to=2026-03-15')
    )) as any[];
    expect(after.find((event) => event.id === created.id)?.attendeeIds).toEqual([]);
    expect(await data(await call(bob, 'GET', '/events?from=2026-03-01&to=2026-03-31'))).toEqual([]);
  });

  // ── recurrencia de las sueltas (HOGARIA-SPEC 12t-R) ─────────────────────────────
  //
  // Lo que se comprueba aqui no es el INSERT: es que una serie sea UNA fila y N dias leidos, que
  // «quitar un dia» no sea «quitar la costumbre», y que la cadencia no se pueda ni inventar ni
  // escribir por la puerta de atras (`exceptions`).
  describe('una serie se guarda una vez y se ve los dias que le tocan', () => {
    it('un «cada semana» son cuatro jueves y una sola fila', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      await call(alice, 'POST', '/events', { ...event, date: '2026-03-05', recurrence: 'weekly' });
      const lista = (await data(
        await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
      )) as any[];
      expect(lista.map((e) => e.date)).toEqual([
        '2026-03-05',
        '2026-03-12',
        '2026-03-19',
        '2026-03-26'
      ]);
      // La misma fila en los cuatro dias: si el titulo cambia, cambian los jueves de verdad.
      expect(new Set(lista.map((e) => e.id)).size).toBe(1);
      expect(lista[0].seriesDate).toBe('2026-03-05');
      expect(lista[0].recurrence).toBe('weekly');
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number }).n
      ).toBe(1);
    });

    it('un «todos los dias» empieza el dia de la serie, no el primero de la ventana', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      await call(alice, 'POST', '/events', { ...event, date: '2026-03-09', recurrence: 'daily' });
      const lista = (await data(
        await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
      )) as any[];
      expect(lista).toHaveLength(23);
      expect(lista[0].date).toBe('2026-03-09');
    });

    it('una serie de enero se sigue viendo en octubre: la ventana no la corta por delante', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      await call(alice, 'POST', '/events', { ...event, date: '2026-01-01', recurrence: 'weekly' });
      const lista = (await data(
        await call(alice, 'GET', '/events?from=2026-10-01&to=2026-10-31')
      )) as any[];
      // 2026-01-01 era jueves, y octubre de 2026 tiene cinco jueves (1, 8, 15, 22, 29).
      expect(lista.map((e) => e.date)).toEqual([
        '2026-10-01',
        '2026-10-08',
        '2026-10-15',
        '2026-10-22',
        '2026-10-29'
      ]);
      expect(lista[0].date >= '2026-10-01').toBe(true);
    });

    it('sin recurrencia no hay multiplicacion, y la cadencia viaja en la lectura', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      await call(alice, 'POST', '/events', { ...event, date: '2026-03-11' });
      const lista = (await data(
        await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
      )) as any[];
      expect(lista).toHaveLength(1);
      expect(lista[0].recurrence).toBe('none');
      expect(lista[0].recurrenceRule).toBeNull();
      expect(lista[0].seriesDate).toBe('2026-03-11');
    });

    it('el LIMIT cuenta sueltas escritas, no dias pintados', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      await call(alice, 'POST', '/events', { ...event, date: '2026-03-01', recurrence: 'daily' });
      await call(alice, 'POST', '/events', {
        ...event,
        title: 'Otra',
        date: '2026-03-02',
        recurrence: 'daily'
      });
      const cuerpo = (await (
        await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31&limit=1')
      ).json()) as any;
      // Paso una fila y se expande entera: el corte es de escritura, no de pantalla.
      expect(new Set(cuerpo.data.map((e: any) => e.id)).size).toBe(1);
      expect(cuerpo.data.length).toBeGreaterThan(1);
    });
  });

  describe('reglas estructuradas de recurrencia (§12at)', () => {
    const recurrenceRule = {
      frequency: 'weekly',
      interval: 2,
      weekdays: [1, 3],
      end: { type: 'count', count: 3 }
    } as const;

    it('persiste una regla semanal custom, la devuelve y proyecta sus fechas sin duplicar la serie', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const created = (await data(
        await call(alice, 'POST', '/events', {
          ...event,
          date: '2026-03-04',
          recurrenceRule
        })
      )) as any;
      expect(created.recurrenceRule).toEqual(recurrenceRule);

      const stored = db
        .prepare('SELECT recurrence, recurrence_rule, exceptions FROM calendar_events WHERE id = ?')
        .get(created.id) as { recurrence: string; recurrence_rule: string; exceptions: string };
      expect(stored).toEqual({
        recurrence: 'none',
        recurrence_rule: JSON.stringify(recurrenceRule),
        exceptions: '[]'
      });

      const listed = (await data(
        await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
      )) as any[];
      expect(listed.map((item) => item.date)).toEqual(['2026-03-04', '2026-03-16', '2026-03-18']);
      expect(new Set(listed.map((item) => item.id)).size).toBe(1);
      expect(listed.every((item) => item.recurrenceRule.frequency === 'weekly')).toBe(true);
      const windowAfterSeriesStart = (await data(
        await call(alice, 'GET', '/events?from=2026-03-15&to=2026-03-31')
      )) as any[];
      expect(windowAfterSeriesStart.map((item) => item.date)).toEqual(['2026-03-16', '2026-03-18']);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number }).n
      ).toBe(1);
    });

    it('proyecta en una consulta futura reglas diaria y semanal guardadas antes de la ventana', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const daily = (await data(
        await call(alice, 'POST', '/events', {
          ...event,
          title: 'Riego cada dos días',
          date: '2026-03-01',
          recurrenceRule: { frequency: 'daily', interval: 2, end: { type: 'never' } }
        })
      )) as any;
      const weekly = (await data(
        await call(alice, 'POST', '/events', {
          ...event,
          title: 'Turno lunes y miércoles alternos',
          date: '2026-03-02',
          recurrenceRule: {
            frequency: 'weekly',
            interval: 2,
            weekdays: [1, 3],
            end: { type: 'never' }
          }
        })
      )) as any;

      // Ambas consultas empiezan mucho después del ancla; no deben depender de que el rango
      // incluya el primer día de la serie para que el SQL cargue y el motor expanda la regla.
      const later = (await data(
        await call(alice, 'GET', '/events?from=2026-04-01&to=2026-04-30')
      )) as any[];
      expect(later.filter((item) => item.id === daily.id).map((item) => item.date)).toEqual(
        Array.from(
          { length: 15 },
          (_, index) => `2026-04-${String(index * 2 + 2).padStart(2, '0')}`
        )
      );
      expect(later.filter((item) => item.id === weekly.id).map((item) => item.date)).toEqual([
        '2026-04-01',
        '2026-04-13',
        '2026-04-15',
        '2026-04-27',
        '2026-04-29'
      ]);
      expect(
        later
          .filter((item) => item.id === daily.id)
          .every((item) => item.seriesDate === '2026-03-01')
      ).toBe(true);
      expect(
        later
          .filter((item) => item.id === weekly.id)
          .every((item) => item.seriesDate === '2026-03-02')
      ).toBe(true);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number }).n
      ).toBe(2);
    });

    it('actualiza y limpia recurrenceRule sin romper una serie legacy', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const created = (await data(
        await call(alice, 'POST', '/events', {
          ...event,
          date: '2026-03-05',
          recurrence: 'weekly'
        })
      )) as any;
      const custom = { frequency: 'daily', interval: 2, end: { type: 'count', count: 2 } };

      expect(
        (
          await call(alice, 'PATCH', `/events/${created.id}`, {
            recurrenceRule: {
              frequency: 'daily',
              interval: 1,
              end: { type: 'date', date: '2026-03-04' }
            }
          })
        ).status
      ).toBe(400);
      expect(
        (await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31'))).map(
          (item: any) => item.date
        )
      ).toEqual(['2026-03-05', '2026-03-12', '2026-03-19', '2026-03-26']);

      const updated = (await data(
        await call(alice, 'PATCH', `/events/${created.id}`, { recurrenceRule: custom })
      )) as any;
      expect(updated.recurrenceRule).toEqual(custom);
      expect(
        (await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31'))).map(
          (item: any) => item.date
        )
      ).toEqual(['2026-03-05', '2026-03-07']);

      const cleared = (await data(
        await call(alice, 'PATCH', `/events/${created.id}`, { recurrenceRule: null })
      )) as any;
      expect(cleared.recurrenceRule).toBeNull();
      expect(
        (await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31'))).map(
          (item: any) => item.date
        )
      ).toEqual(['2026-03-05', '2026-03-12', '2026-03-19', '2026-03-26']);
    });

    it('rechaza frecuencias, intervalos, días o finales inválidos y no crea filas', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const invalidRules = [
        { frequency: 'monthly', interval: 0, end: { type: 'never' } },
        { frequency: 'yearly', interval: 100, end: { type: 'never' } },
        { frequency: 'weekly', interval: 1, weekdays: [0], end: { type: 'never' } },
        { frequency: 'weekly', interval: 1, weekdays: [2, 2], end: { type: 'never' } },
        { frequency: 'daily', interval: 1, weekdays: [1], end: { type: 'never' } },
        { frequency: 'daily', interval: 1, end: { type: 'count', count: 0 } },
        { frequency: 'daily', interval: 1, end: { type: 'date', date: '2026-02-30' } },
        { frequency: 'daily', interval: 1, end: { type: 'date', date: '2026-03-10' } }
      ];

      for (const invalidRule of invalidRules) {
        const response = await call(alice, 'POST', '/events', {
          ...event,
          recurrenceRule: invalidRule
        });
        expect(response.status).toBe(400);
      }
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM calendar_events').get() as { n: number }).n
      ).toBe(0);
    });

    it('quita una ocurrencia custom, conserva la regla y aplica los mismos permisos que a una serie legacy', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const bob = await makeUser('cal-bob', householdId, 'Bob');
      const created = (await data(
        await call(alice, 'POST', '/events', {
          ...event,
          date: '2026-03-01',
          recurrenceRule: { frequency: 'daily', interval: 2, end: { type: 'count', count: 3 } }
        })
      )) as any;

      expect(
        (await call(bob, 'DELETE', `/events/${created.id}/occurrences/2026-03-03`)).status
      ).toBe(403);
      expect(
        (await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-02`)).status
      ).toBe(400);
      expect(
        (await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-03`)).status
      ).toBe(200);
      expect(
        (await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-10'))).map(
          (item: any) => item.date
        )
      ).toEqual(['2026-03-01', '2026-03-05']);

      const stored = db
        .prepare('SELECT recurrence_rule, exceptions FROM calendar_events WHERE id = ?')
        .get(created.id) as { recurrence_rule: string; exceptions: string };
      expect(JSON.parse(stored.recurrence_rule)).toEqual({
        frequency: 'daily',
        interval: 2,
        end: { type: 'count', count: 3 }
      });
      expect(JSON.parse(stored.exceptions)).toEqual(['2026-03-03']);
    });
  });

  describe('«solo este dia no» de una serie', () => {
    async function serieSemanalDeMarzo() {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const created = (await data(
        await call(alice, 'POST', '/events', { ...event, date: '2026-03-05', recurrence: 'weekly' })
      )) as any;
      return { alice, created };
    }

    it('quita el jueves marcado y deja los otros tres', async () => {
      const { alice, created } = await serieSemanalDeMarzo();
      expect(
        (await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-12`)).status
      ).toBe(200);
      const lista = (await data(
        await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31')
      )) as any[];
      expect(lista.map((e) => e.date)).toEqual(['2026-03-05', '2026-03-19', '2026-03-26']);
    });

    it('repetir el quite no es un error, y las excepciones no se inyectan por el alta', async () => {
      const { alice, created } = await serieSemanalDeMarzo();
      await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-12`);
      // Doble clic, o reintento tras un pico de red: lo pedido ya esta, no hay nada que fallar.
      expect(
        (await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-12`)).status
      ).toBe(200);
      // `exceptions` no es un campo del formulario: el schema lo tira, y nadie puede nacer con dias
      // quitados que no pidio.
      const otro = (await data(
        await call(alice, 'POST', '/events', {
          ...event,
          date: '2026-03-05',
          recurrence: 'weekly',
          exceptions: ['2026-03-12']
        })
      )) as any;
      const lista = (await data(
        await call(alice, 'GET', '/events?from=2026-03-12&to=2026-03-12')
      )) as any[];
      expect(lista.filter((e) => e.id === otro.id)).toHaveLength(1);
    });

    it('un dia que no se repite se borra, no se quita', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const created = (await data(
        await call(alice, 'POST', '/events', { ...event, date: '2026-03-11' })
      )) as any;
      const respuesta = await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-11`);
      expect(respuesta.status).toBe(400);
      expect(((await respuesta.json()) as any).message).toBe('EVENTO_SIN_REPETICION');
    });

    it('rechaza una fecha con otra forma, un evento que no existe y el de otra persona', async () => {
      const { alice, created } = await serieSemanalDeMarzo();
      expect(
        (await call(alice, 'DELETE', `/events/${created.id}/occurrences/12-03-2026`)).status
      ).toBe(400);
      expect(
        (await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-02-30`)).status
      ).toBe(400);
      expect((await call(alice, 'DELETE', '/events/no-existe/occurrences/2026-03-12')).status).toBe(
        404
      );
      const bob = await makeUser('cal-bob', householdId, 'Bob');
      // Que te inviten no te da potestad sobre la agenda de quien invita: lo mismo que en el PATCH.
      expect(
        (await call(bob, 'DELETE', `/events/${created.id}/occurrences/2026-03-12`)).status
      ).toBe(403);
    });

    it('borrar la serie se lleva todos los dias', async () => {
      const { alice, created } = await serieSemanalDeMarzo();
      await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-12`);
      expect((await call(alice, 'DELETE', `/events/${created.id}`)).status).toBe(200);
      expect(await data(await call(alice, 'GET', '/events?from=2026-03-01&to=2026-03-31'))).toEqual(
        []
      );
    });
  });

  describe('cambiar la cadencia', () => {
    it('deja de ser semanal cuando pasa a diaria, y no toca lo que no se mando', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const created = (await data(
        await call(alice, 'POST', '/events', { ...event, date: '2026-03-05', recurrence: 'weekly' })
      )) as any;
      await call(alice, 'PATCH', `/events/${created.id}`, { recurrence: 'daily' });
      const lista = (await data(
        await call(alice, 'GET', '/events?from=2026-03-05&to=2026-03-12')
      )) as any[];
      expect(lista).toHaveLength(8);

      await call(alice, 'PATCH', `/events/${created.id}`, { title: 'Carpinteria: cortar' });
      const otra = (await data(
        await call(alice, 'GET', '/events?from=2026-03-05&to=2026-03-12')
      )) as any[];
      expect(otra[0].recurrence).toBe('daily');
      expect(otra[0].title).toBe('Carpinteria: cortar');
    });

    it('mover el inicio a un dia quitado lo devuelve, y quitar la cadencia limpia las excepciones', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const created = (await data(
        await call(alice, 'POST', '/events', { ...event, date: '2026-03-05', recurrence: 'weekly' })
      )) as any;
      await call(alice, 'DELETE', `/events/${created.id}/occurrences/2026-03-19`);
      await call(alice, 'PATCH', `/events/${created.id}`, { date: '2026-03-19' });
      // El dia que uno elige a mano no puede venir ya excluido de fabrica.
      expect(
        await data(await call(alice, 'GET', '/events?from=2026-03-19&to=2026-03-19'))
      ).toHaveLength(1);

      await call(alice, 'PATCH', `/events/${created.id}`, { recurrence: 'none' });
      const fila = db
        .prepare('SELECT recurrence, exceptions FROM calendar_events WHERE id = ?')
        .get(created.id) as { recurrence: string; exceptions: string };
      expect(fila.recurrence).toBe('none');
      // Una excepcion sin serie no significa nada, y resucitaria el dia que la cosa vuelva a repetirse.
      expect(fila.exceptions).toBe('[]');
    });

    it('una cadencia inventada no entra: 400 con el campo dicho', async () => {
      const alice = await makeUser('cal-alice', householdId, 'Alice');
      const respuesta = await call(alice, 'POST', '/events', { ...event, recurrence: 'monthly' });
      expect(respuesta.status).toBe(400);
      const cuerpo = (await respuesta.json()) as any;
      expect(cuerpo.code).toBe('INVALID_FORM');
      expect(JSON.stringify(cuerpo)).toContain('recurrence');
    });
  });

  describe('objetivos semanales múltiples', () => {
    it('guarda varias opciones y texto personalizado sin volver a una sola opción', async () => {
      const alice = await makeUser('cal-goals', householdId, 'Alice');
      const result = await call(alice, 'PATCH', '/goals', {
        weekStart: '2026-03-16',
        types: ['weight-loss', 'muscle-gain', 'custom'],
        customInstructions: 'Priorizar verdura y proteína en cada cena.',
        dailyCalories: 2100
      });

      expect(result.status).toBe(200);
      const range = (await data(
        await call(alice, 'GET', '/range?startDate=2026-03-16&endDate=2026-03-22')
      )) as { goals: Record<string, unknown> };
      expect(range.goals).toMatchObject({
        types: ['weight-loss', 'muscle-gain', 'custom'],
        customInstructions: 'Priorizar verdura y proteína en cada cena.',
        dailyCalories: 2100
      });
      expect(range.goals).not.toHaveProperty('type');
    });

    it('rechaza Personalizada sin texto antes de persistirla', async () => {
      const alice = await makeUser('cal-goals-custom', householdId, 'Alice');
      const result = await call(alice, 'PATCH', '/goals', {
        weekStart: '2026-03-16',
        types: ['custom']
      });
      expect(result.status).toBe(400);
      expect(
        await data(await call(alice, 'GET', '/range?startDate=2026-03-16&endDate=2026-03-22'))
      ).toMatchObject({ goals: {} });
    });
  });
});
