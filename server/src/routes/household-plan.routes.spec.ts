import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { HOUSEHOLD_PLAN_RESPONSE_FORMAT } from '../schemas/household-plan.schema.js';
import type { HouseholdPlan } from '../schemas/household-plan.schema.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type User = { id: string; token: string };

let app: Hono;
let db: Sql;
let closeDatabase: () => void;
let jwtSecret = '';

function responsesText(content: string, id = 'resp_household_plan_fixture'): Response {
  return new Response(
    JSON.stringify({
      id,
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

async function responsesReply(
  reply: Response,
  id = 'resp_household_plan_fixture'
): Promise<Response> {
  if (!reply.ok) return reply;
  const payload = (await reply
    .clone()
    .json()
    .catch(() => null)) as any;
  if (typeof payload?.id === 'string' && Array.isArray(payload?.output)) return reply;
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    return new Response(JSON.stringify({ id, status: 'incomplete', output: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }
  if (typeof choice?.message?.refusal === 'string') {
    return new Response(
      JSON.stringify({
        id,
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'refusal', refusal: choice.message.refusal }] }
        ]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  return responsesText(String(choice?.message?.content ?? ''), id);
}

function stubResponsesFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
) {
  const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/cancel')) {
      expect(init?.method).toBe('POST');
      return new Response('{}', { status: 200 });
    }
    expect(url.pathname).toMatch(/\/responses$/);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ background: true, store: true });
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.text?.format).toBeDefined();
    return responsesReply(
      await implementation(input, init),
      `resp_household_plan_${provider.mock.calls.length}`
    );
  });
  vi.stubGlobal('fetch', provider);
  return provider;
}

function inputText(body: any, index: number): string {
  const content = body.input[index]?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content
        .filter((part: any) => part.type === 'input_text')
        .map((part: any) => part.text)
        .join('')
    : '';
}

function validPlan(): HouseholdPlan {
  return {
    schemaVersion: 1,
    dwellingType: 'apartment',
    dwellingTypeLabel: null,
    summary: 'Plano de prueba',
    warnings: [],
    floors: [
      {
        id: 'floor-0',
        name: 'Planta baja',
        level: 0,
        walls: [],
        openings: [],
        spaces: [
          {
            id: 'living-room',
            kind: 'living_room',
            label: 'Salón',
            polygon: [
              { x: 100, y: 100 },
              { x: 900, y: 100 },
              { x: 900, y: 900 },
              { x: 100, y: 900 }
            ],
            parentSpaceId: null
          }
        ]
      }
    ]
  };
}

function planWithoutSpaces(): HouseholdPlan {
  const plan = validPlan();
  plan.floors[0].spaces = [];
  return plan;
}

describe('household plan persistence routes', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { householdPlanRoutes } = await import('./household-plan.routes.js');
    const { config } = await import('../config/app.config.js');
    await database.initializeDatabase();
    closeDatabase = database.closeDatabase;
    db = database.getDatabase();
    app = new Hono();
    app.route('/api/household', householdPlanRoutes);
    app.onError((error, context) => context.json({ success: false, message: error.message }, 500));
    jwtSecret = config.auth.jwtSecret;
  });

  afterAll(async () => {
    const { stopWorker } = await import('../utils/ticket-queue.js');
    stopWorker();
    closeDatabase();
  });

  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    db.prepare('DELETE FROM household_task_weeks').run();
    db.prepare('DELETE FROM household_plan_assignments').run();
    db.prepare('DELETE FROM household_plan_revisions').run();
    db.prepare('DELETE FROM household_plans').run();
    db.prepare('DELETE FROM ai_jobs').run();
    db.prepare('DELETE FROM ai_configs').run();
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM households').run();
    db.exec('DROP TRIGGER IF EXISTS fail_plan_revision');
  });

  function makeHousehold(id: string) {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      id,
      id,
      `INVITE-${id}`
    );
  }

  function makeUser(id: string, householdId: string | null, settings: boolean): User {
    db.prepare(
      'INSERT INTO users (id, email, name, password_hash, household_id) VALUES (?, ?, ?, ?, ?)'
    ).run(id, `${id}@hogaria.test`, id, 'not-a-real-password-hash', householdId);
    if (householdId) {
      db.prepare(
        `INSERT INTO household_members (id, household_id, user_id, role, permissions)
         VALUES (?, ?, ?, 'member', ?)`
      ).run(`${id}-membership`, householdId, id, JSON.stringify({ settings }));
    }
    return {
      id,
      token: jwt.sign({ sub: id, email: `${id}@hogaria.test` }, jwtSecret, { expiresIn: '1h' })
    };
  }

  function currentHouseholdId(user: User): string | undefined {
    return (
      (
        db.prepare('SELECT household_id FROM users WHERE id = ?').get(user.id) as
          { household_id: string | null } | undefined
      )?.household_id ?? undefined
    );
  }

  function call(
    user: User,
    method: string,
    body?: unknown,
    requestedHouseholdId = currentHouseholdId(user)
  ) {
    return app.request('/api/household/plan', {
      method,
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        ...(requestedHouseholdId ? { 'x-household-id': requestedHouseholdId } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  function callProposal(
    user: User,
    body: unknown,
    signal?: AbortSignal,
    requestedHouseholdId = currentHouseholdId(user)
  ) {
    const isForm = body instanceof FormData;
    return app.request('/api/household/plan/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        ...(requestedHouseholdId ? { 'x-household-id': requestedHouseholdId } : {}),
        ...(isForm ? {} : { 'content-type': 'application/json' })
      },
      body: isForm ? body : JSON.stringify(body),
      signal
    });
  }

  function callAssignments(user: User, method: string, body?: unknown) {
    const householdId = currentHouseholdId(user);
    return app.request('/api/household/plan/assignments', {
      method,
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
        ...(householdId ? { 'x-household-id': householdId } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  function addAiConfig(id: string, userId: string, householdId: string) {
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, household_id, name, provider, base_url, api_key, model,
         timeout, retry_attempts, concurrency, is_active)
       VALUES (?, ?, ?, 'Synthetic plan provider', 'custom', 'http://127.0.0.1:9/v1',
         'synthetic-secret', 'vision-model', 2000, 0, 0, 1)`
    ).run(id, userId, householdId);
  }

  it('lets active members read the shared versioned plan but only settings members apply it', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    const reader = makeUser('reader-a', 'home-a', false);

    const initial = await call(reader, 'GET');
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ success: true, data: { version: 0, plan: null } });

    const denied = await call(reader, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(denied.status).toBe(403);

    const saved = await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      success: true,
      data: {
        version: 1,
        plan: { schemaVersion: 1, floors: [{ spaces: [{ id: 'living-room' }] }] }
      }
    });
    const sharedPlan = await call(reader, 'GET');
    expect(await sharedPlan.json()).toMatchObject({
      success: true,
      data: { version: 1, plan: { schemaVersion: 1 } }
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plan_revisions').get()).toEqual({
      count: 1
    });
  });

  it('persists and reloads the user-defined name of a custom household area', async () => {
    makeHousehold('home-custom');
    const owner = makeUser('owner-custom', 'home-custom', true);
    const plan = validPlan();
    plan.floors[0].spaces[0].kind = 'custom';
    plan.floors[0].spaces[0].label = 'Sala de música';

    const saved = await call(owner, 'PUT', { baseVersion: 0, plan });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      success: true,
      data: { plan: { floors: [{ spaces: [{ kind: 'custom', label: 'Sala de música' }] }] } }
    });

    const loaded = await call(owner, 'GET');
    expect(await loaded.json()).toMatchObject({
      success: true,
      data: { plan: { floors: [{ spaces: [{ kind: 'custom', label: 'Sala de música' }] }] } }
    });
  });

  it('persists household-scoped zone responsibility with membership and plan version checks', async () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    const owner = makeUser('owner-a', 'home-a', true);
    const second = makeUser('second-a', 'home-a', true);
    const reader = makeUser('reader-a', 'home-a', false);
    const otherHomeMember = makeUser('member-b', 'home-b', true);
    const savedPlan = await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(savedPlan.status).toBe(200);

    const initial = await callAssignments(owner, 'GET');
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      success: true,
      data: { planVersion: 1, version: 0, assignments: {} }
    });

    const denied = await callAssignments(reader, 'PUT', {
      baseVersion: 0,
      basePlanVersion: 1,
      spaceId: 'living-room',
      memberIds: [reader.id]
    });
    expect(denied.status).toBe(403);

    const assigned = await callAssignments(owner, 'PUT', {
      baseVersion: 0,
      basePlanVersion: 1,
      spaceId: 'living-room',
      memberIds: [owner.id]
    });
    expect(assigned.status).toBe(200);
    expect(await assigned.json()).toMatchObject({
      success: true,
      data: { planVersion: 1, version: 1, assignments: { 'living-room': [owner.id] } }
    });

    const shared = await callAssignments(owner, 'PUT', {
      baseVersion: 1,
      basePlanVersion: 1,
      spaceId: 'living-room',
      memberIds: [owner.id, second.id]
    });
    expect(shared.status).toBe(200);
    expect(await shared.json()).toMatchObject({
      success: true,
      data: { version: 2, assignments: { 'living-room': [owner.id, second.id] } }
    });

    const staleAssignment = await callAssignments(owner, 'PUT', {
      baseVersion: 1,
      basePlanVersion: 1,
      spaceId: 'living-room',
      memberIds: [owner.id]
    });
    expect(staleAssignment.status).toBe(409);
    expect(await staleAssignment.json()).toMatchObject({
      success: false,
      code: 'PLAN_ASSIGNMENTS_VERSION_CONFLICT'
    });

    const stalePlan = await callAssignments(owner, 'PUT', {
      baseVersion: 2,
      basePlanVersion: 0,
      spaceId: 'living-room',
      memberIds: [owner.id]
    });
    expect(stalePlan.status).toBe(409);
    expect(await stalePlan.json()).toMatchObject({
      success: false,
      code: 'PLAN_VERSION_CONFLICT'
    });

    const foreignMember = await callAssignments(owner, 'PUT', {
      baseVersion: 2,
      basePlanVersion: 1,
      spaceId: 'living-room',
      memberIds: [otherHomeMember.id]
    });
    expect(foreignMember.status).toBe(422);
    expect(await foreignMember.json()).toMatchObject({
      success: false,
      code: 'PLAN_ASSIGNMENT_MEMBER_NOT_ACTIVE'
    });

    const missingSpace = await callAssignments(owner, 'PUT', {
      baseVersion: 2,
      basePlanVersion: 1,
      spaceId: 'missing-space',
      memberIds: [owner.id]
    });
    expect(missingSpace.status).toBe(404);
    expect(await missingSpace.json()).toMatchObject({
      success: false,
      code: 'PLAN_ASSIGNMENT_SPACE_NOT_FOUND'
    });

    const unassigned = await callAssignments(owner, 'PUT', {
      baseVersion: 2,
      basePlanVersion: 1,
      spaceId: 'living-room',
      memberIds: []
    });
    expect(unassigned.status).toBe(200);
    expect(await unassigned.json()).toMatchObject({
      success: true,
      data: { version: 3, assignments: {} }
    });

    await callAssignments(owner, 'PUT', {
      baseVersion: 3,
      basePlanVersion: 1,
      spaceId: 'living-room',
      memberIds: [owner.id]
    });
    const spaceRemoved = await call(owner, 'PUT', { baseVersion: 1, plan: planWithoutSpaces() });
    expect(spaceRemoved.status).toBe(200);
    const afterRemoval = await callAssignments(owner, 'GET');
    expect(await afterRemoval.json()).toMatchObject({
      success: true,
      data: { planVersion: 2, version: 5, assignments: {} }
    });
  });

  it('uses compare-and-swap and returns the latest version without overwriting it', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });

    const updated = await call(owner, 'PUT', { baseVersion: 1, plan: validPlan() });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ success: true, data: { version: 2 } });

    const stale = await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      success: false,
      code: 'PLAN_VERSION_CONFLICT',
      data: { version: 2, plan: { schemaVersion: 1 } }
    });
    expect(
      (
        db
          .prepare('SELECT version FROM household_plans WHERE household_id = ?')
          .get('home-a') as any
      ).version
    ).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plan_revisions').get()).toEqual({
      count: 2
    });
  });

  it('revalidates geometry and does not persist malformed plans', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    const invalid = validPlan();
    invalid.floors[0].spaces[0].polygon[0].x = 10_001;

    const response = await call(owner, 'PUT', { baseVersion: 0, plan: invalid });
    expect(response.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });
  });

  it('does not fall back to another household when the active household is ambiguous', async () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    const member = makeUser('multi-home-member', null, true);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', ?)`
    ).run('member-a', 'home-a', member.id, JSON.stringify({ settings: true }));
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', ?)`
    ).run('member-b', 'home-b', member.id, JSON.stringify({ settings: true }));

    const response = await call(member, 'GET');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SELECTION_REQUIRED'
    });
  });

  it('rejects a plan read, write, or AI proposal captured for a home that is no longer active', async () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    const member = makeUser('switching-member', 'home-a', true);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES ('switching-member-b', 'home-b', ?, 'member', ?)`
    ).run(member.id, JSON.stringify({ settings: true }));
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-b', member.id);

    const staleRead = await call(member, 'GET', undefined, 'home-a');
    expect(staleRead.status).toBe(409);
    expect(await staleRead.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_CONTEXT_CHANGED'
    });

    const staleWrite = await call(member, 'PUT', { baseVersion: 0, plan: validPlan() }, 'home-a');
    expect(staleWrite.status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });

    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const staleProposal = await callProposal(
      member,
      { baseVersion: 0, prompt: 'Añade una cocina' },
      undefined,
      'home-a'
    );
    expect(staleProposal.status).toBe(409);
    expect(await staleProposal.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_CONTEXT_CHANGED'
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns a validated, versioned proposal through the household queue without saving it', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    let providerBody: any;
    stubResponsesFetch(async (_url, init) => {
      providerBody = JSON.parse(String(init?.body));
      return responsesText(JSON.stringify(validPlan()));
    });

    const response = await callProposal(owner, { baseVersion: 0, prompt: 'Crea un plano inicial' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        baseVersion: 0,
        current: null,
        proposal: { schemaVersion: 1, floors: [{ spaces: [{ id: 'living-room' }] }] },
        diff: { addedSpaceIds: ['living-room'], modifiedSpaceIds: [], removedSpaceIds: [] },
        orphanedTaskIds: []
      }
    });
    expect(providerBody.text.format).toEqual({
      type: 'json_schema',
      ...HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema
    });
    expect(inputText(providerBody, 1)).toContain('No hay un plano confirmado');
    expect(db.prepare('SELECT kind, status FROM ai_jobs').get()).toMatchObject({
      kind: 'household_plan',
      status: 'done'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plan_revisions').get()).toEqual({
      count: 0
    });
  });

  it('includes the exact tasks orphaned by an AI proposal that removes their zone', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    db.prepare(
      'INSERT INTO household_plans (household_id, version, plan_json) VALUES (?, 1, ?)'
    ).run('home-a', JSON.stringify(validPlan()));
    db.prepare(
      `INSERT INTO household_task_weeks
        (household_id, week_start, version, tasks_json, updated_by)
       VALUES (?, ?, 1, ?, ?)`
    ).run(
      'home-a',
      '2026-10-05',
      JSON.stringify([
        {
          id: 'task-in-kitchen',
          title: 'Limpiar',
          details: null,
          spaceId: 'living-room',
          scheduledDate: '2026-10-05',
          assignedMemberId: null,
          completed: false
        }
      ]),
      owner.id
    );
    const proposedPlan = planWithoutSpaces();
    stubResponsesFetch(async () => responsesText(JSON.stringify(proposedPlan)));

    const response = await callProposal(owner, { baseVersion: 1, prompt: 'Quita la cocina' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { orphanedTaskIds: ['task-in-kitchen'] }
    });
    expect(db.prepare('SELECT version FROM household_task_weeks').get()).toMatchObject({
      version: 1
    });
  });

  it('attaches a sketch from memory and never sends its uploaded filename', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    let providerBody: any;
    stubResponsesFetch(async (_url, init) => {
      providerBody = JSON.parse(String(init?.body));
      return responsesText(JSON.stringify(validPlan()));
    });
    const form = new FormData();
    form.set('baseVersion', '0');
    const draft = validPlan();
    draft.summary = 'Borrador local';
    form.set('draftPlan', JSON.stringify(draft));
    form.set(
      'image',
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        'private-sketch-name.png',
        { type: 'image/png' }
      )
    );

    const response = await callProposal(owner, form);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { draft: { summary: 'Borrador local' } }
    });
    expect(providerBody.input[1].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input_image',
          image_url: 'data:image/png;base64,iVBORw0KGgo=',
          detail: 'high'
        })
      ])
    );
    expect(JSON.stringify(providerBody)).not.toContain('private-sketch-name');
    expect(inputText(providerBody, 1)).toContain(JSON.stringify(draft));
    expect(providerBody.text.format).toEqual({
      type: 'json_schema',
      ...HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema
    });
  });

  it('rejects stale base versions, missing prompts and members without settings before calling AI', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    const reader = makeUser('reader-a', 'home-a', false);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const stale = await callProposal(owner, { baseVersion: 3, prompt: 'Ajusta el plano' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ success: false, code: 'PLAN_VERSION_CONFLICT' });
    expect(provider).not.toHaveBeenCalled();

    const missing = await callProposal(owner, { baseVersion: 0, prompt: '  ' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ success: false, code: 'PLAN_REQUEST_REQUIRED' });

    const invalidDraft = validPlan();
    invalidDraft.floors[0].spaces[0].polygon[0].x = 10_001;
    const badDraft = await callProposal(owner, {
      baseVersion: 0,
      prompt: 'Usa el borrador',
      draftPlan: invalidDraft
    });
    expect(badDraft.status).toBe(400);
    expect(await badDraft.json()).toMatchObject({ success: false, code: 'INVALID_PLAN_REQUEST' });

    const denied = await callProposal(reader, { baseVersion: 0, prompt: 'Añade una cocina' });
    expect(denied.status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });

  it('does not save invalid AI geometry, refuses unsupported JSON uploads and maps missing config', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    const invalid = validPlan();
    invalid.floors[0].walls.push({
      id: 'diagonal',
      kind: 'interior',
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 }
    });
    stubResponsesFetch(async () => responsesText(JSON.stringify(invalid)));
    const invalidProposal = await callProposal(owner, { baseVersion: 0, prompt: 'Crea un plano' });
    expect(invalidProposal.status).toBe(422);
    expect(await invalidProposal.json()).toMatchObject({
      success: false,
      code: 'AI_PROPOSAL_INVALID'
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });

    db.prepare('DELETE FROM ai_configs').run();
    const noConfig = await callProposal(owner, { baseVersion: 0, prompt: 'Crea un plano' });
    expect(noConfig.status).toBe(503);
    expect(await noConfig.json()).toMatchObject({
      success: false,
      code: 'AI_CONFIGURATION_REQUIRED'
    });

    const unsupported = await app.request('/api/household/plan/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'x-household-id': 'home-a',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ baseVersion: 0, prompt: 'Test', photoUrl: 'https://example.test' })
    });
    expect(unsupported.status).toBe(400);
  });

  it('maps truncated, refused and malformed provider replies to a recoverable validation error', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    const replies = [
      new Response(JSON.stringify({ id: 'resp_incomplete', status: 'incomplete', output: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }),
      new Response(
        JSON.stringify({
          id: 'resp_refusal',
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'Refused' }] }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
      responsesText('{"schemaVersion":1', 'resp_malformed')
    ];

    for (const reply of replies) {
      stubResponsesFetch(async () => reply);
      const response = await callProposal(owner, { baseVersion: 0, prompt: 'Crea un plano' });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ success: false, code: 'AI_PROPOSAL_INVALID' });
    }

    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plan_revisions').get()).toEqual({
      count: 0
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM ai_jobs WHERE error_code = ?').get('BAD_JSON')
    ).toEqual({ count: 2 });
    expect(
      db.prepare('SELECT status, error_code, error_detail FROM ai_jobs ORDER BY rowid').all()
    ).toEqual([
      { status: 'failed', error_code: 'BAD_JSON', error_detail: null },
      { status: 'failed', error_code: 'BAD_JSON', error_detail: null },
      { status: 'done', error_code: null, error_detail: null }
    ]);
  });

  it('uses the latest confirmed plan as chat context and never falls back when a provider rejects JSON schema', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });
    const draft = validPlan();
    draft.summary = 'Borrador en memoria';
    let providerBody: any;
    const provider = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerBody = JSON.parse(String(init?.body));
      return new Response('response_format json_schema is unsupported', { status: 400 });
    });
    stubResponsesFetch(provider);

    const response = await callProposal(owner, {
      baseVersion: 1,
      prompt: 'Mueve la cocina sin cambiar el resto',
      draftPlan: draft
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'AI_PROVIDER_UNAVAILABLE'
    });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(providerBody.text.format).toEqual({
      type: 'json_schema',
      ...HOUSEHOLD_PLAN_RESPONSE_FORMAT.json_schema
    });
    expect(inputText(providerBody, 1)).toContain(JSON.stringify(validPlan()));
    expect(inputText(providerBody, 1)).toContain(JSON.stringify(draft));
    expect(inputText(providerBody, 1)).toContain('Mueve la cocina');
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plan_revisions').get()).toEqual({
      count: 1
    });
    expect(db.prepare('SELECT status, error_detail FROM ai_jobs').get()).toMatchObject({
      status: 'failed',
      error_detail: null
    });
  });

  it('keeps the queued proposal running after the HTTP caller disconnects', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    let providerStarted!: () => void;
    let finishProvider!: () => void;
    let providerSignal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => (providerStarted = resolve));
    const providerResponse = new Promise<void>((resolve) => (finishProvider = resolve));
    const provider = stubResponsesFetch(async (_input, init) => {
      providerSignal = init?.signal as AbortSignal | undefined;
      providerStarted();
      await providerResponse;
      return responsesText(JSON.stringify(validPlan()));
    });
    const controller = new AbortController();
    const pendingResponse = callProposal(
      owner,
      { baseVersion: 0, prompt: 'Añade un jardín' },
      controller.signal
    );
    await started;
    controller.abort();
    expect(providerSignal?.aborted).toBe(false);
    finishProvider();
    const response = await pendingResponse;

    expect(response.status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT status, error_code FROM ai_jobs').get()).toMatchObject({
      status: 'done',
      error_code: null
    });
  });

  it('maps provider timeouts without persisting a partial plan', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    addAiConfig('ai-home-a', owner.id, 'home-a');
    db.prepare('UPDATE ai_configs SET timeout = 50 WHERE id = ?').run('ai-home-a');
    const provider = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
            once: true
          });
        })
    );
    vi.stubGlobal('fetch', provider);

    const response = await callProposal(owner, { baseVersion: 0, prompt: 'Crea un plano' });

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ success: false, code: 'AI_PROVIDER_TIMEOUT' });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT status, error_code, error_detail FROM ai_jobs').get()).toMatchObject({
      status: 'failed',
      error_code: 'TIMEOUT',
      error_detail: null
    });
  });

  it('returns no-household when the user has no active household membership', async () => {
    const user = makeUser('personal-user', null, true);
    const response = await call(user, 'GET');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false, code: 'HOUSEHOLD_REQUIRED' });
  });

  it('requires confirmation before detaching zone-linked tasks and updates both records atomically', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    const created = await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(created.status).toBe(200);
    db.prepare(
      `INSERT INTO household_task_weeks
        (household_id, week_start, version, tasks_json, updated_by)
       VALUES (?, ?, 1, ?, ?)`
    ).run(
      'home-a',
      '2026-10-05',
      JSON.stringify([
        {
          id: 'clean-kitchen',
          title: 'Limpiar cocina',
          details: null,
          spaceId: 'living-room',
          scheduledDate: '2026-10-05',
          assignedMemberId: null,
          completed: false
        }
      ]),
      owner.id
    );

    const needsConfirmation = await call(owner, 'PUT', {
      baseVersion: 1,
      plan: planWithoutSpaces()
    });
    expect(needsConfirmation.status).toBe(409);
    expect(await needsConfirmation.json()).toMatchObject({
      success: false,
      code: 'PLAN_TASKS_REQUIRE_CONFIRMATION',
      data: { orphanedTaskIds: ['clean-kitchen'] }
    });
    expect(db.prepare('SELECT version FROM household_plans').get()).toMatchObject({ version: 1 });
    expect(db.prepare('SELECT version FROM household_task_weeks').get()).toMatchObject({
      version: 1
    });

    const confirmed = await call(owner, 'PUT', {
      baseVersion: 1,
      plan: planWithoutSpaces(),
      confirmOrphanedTaskIds: ['clean-kitchen']
    });
    expect(confirmed.status).toBe(200);
    expect(db.prepare('SELECT version FROM household_plans').get()).toMatchObject({ version: 2 });
    expect(db.prepare('SELECT version FROM household_task_weeks').get()).toMatchObject({
      version: 2
    });
    expect(db.prepare('SELECT tasks_json FROM household_task_weeks').get()).toMatchObject({
      tasks_json: expect.stringContaining('"spaceId":null')
    });
  });

  it('scopes plans to the active household even when a member belongs to two homes', async () => {
    makeHousehold('home-a');
    makeHousehold('home-b');
    const member = makeUser('multi-home-member', 'home-a', true);
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'member', ?)`
    ).run('member-b', 'home-b', member.id, JSON.stringify({ settings: true }));
    await call(member, 'PUT', { baseVersion: 0, plan: validPlan() });

    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run('home-b', member.id);
    const switchedHome = await call(member, 'GET');
    expect(await switchedHome.json()).toMatchObject({
      success: true,
      data: { version: 0, plan: null }
    });
    expect((db.prepare('SELECT household_id FROM household_plans').get() as any).household_id).toBe(
      'home-a'
    );
  });

  it('rolls back the current plan when creating its revision fails', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    db.exec(`
      CREATE TRIGGER fail_plan_revision
      BEFORE INSERT ON household_plan_revisions
      BEGIN
        SELECT RAISE(ABORT, 'forced revision failure');
      END;
    `);

    const response = await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(response.status).toBe(500);
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plans').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM household_plan_revisions').get()).toEqual({
      count: 0
    });
  });

  it('fails closed instead of returning a corrupt stored plan', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    for (const invalidJson of ['{invalid', '{}']) {
      db.prepare('DELETE FROM household_plans').run();
      db.prepare(
        'INSERT INTO household_plans (household_id, version, plan_json) VALUES (?, ?, ?)'
      ).run('home-a', 1, invalidJson);

      const response = await call(owner, 'GET');
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        success: false,
        code: 'HOUSEHOLD_PLAN_UNAVAILABLE'
      });
    }
  });

  it('denies malformed permission data rather than inferring editor access', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    db.prepare('UPDATE household_members SET permissions = ? WHERE user_id = ?').run(
      '{invalid',
      owner.id
    );

    const response = await call(owner, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(response.status).toBe(403);
  });

  it('honors the active-household requirement on plan reads, writes and proposals', async () => {
    const personal = makeUser('personal-user', null, true);
    const noHouseholdWrite = await call(personal, 'PUT', { baseVersion: 0, plan: validPlan() });
    const noHouseholdProposal = await callProposal(personal, {
      baseVersion: 0,
      prompt: 'Crea un plano'
    });
    expect(noHouseholdWrite.status).toBe(404);
    expect(noHouseholdProposal.status).toBe(404);

    makeHousehold('home-a');
    makeHousehold('home-b');
    const ambiguous = makeUser('ambiguous-user', null, true);
    for (const [id, householdId] of [
      ['membership-a', 'home-a'],
      ['membership-b', 'home-b']
    ]) {
      db.prepare(
        `INSERT INTO household_members (id, household_id, user_id, role, permissions)
         VALUES (?, ?, ?, 'member', ?)`
      ).run(id, householdId, ambiguous.id, JSON.stringify({ settings: true }));
    }
    const ambiguousWrite = await call(ambiguous, 'PUT', { baseVersion: 0, plan: validPlan() });
    const ambiguousProposal = await callProposal(ambiguous, {
      baseVersion: 0,
      prompt: 'Crea un plano'
    });
    expect(ambiguousWrite.status).toBe(409);
    expect(ambiguousProposal.status).toBe(409);
    expect(await ambiguousProposal.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_SELECTION_REQUIRED'
    });
  });

  it('rejects oversized or malformed sketch requests before any AI call', async () => {
    makeHousehold('home-a');
    const owner = makeUser('owner-a', 'home-a', true);
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);

    const declaredOversized = await app.fetch(
      new Request('http://localhost/api/household/plan/proposal', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${owner.token}`,
          'content-type': 'application/json',
          'content-length': String(10 * 1024 * 1024 + 128 * 1024 + 1)
        },
        body: '{}'
      })
    );
    expect(declaredOversized.status).toBe(413);

    const oversizedRequest = new Request('http://localhost/api/household/plan/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'content-type': 'multipart/form-data; boundary=synthetic-boundary'
      },
      body: new Blob([new Uint8Array(10 * 1024 * 1024 + 128 * 1024 + 1)])
    });
    const oversized = await app.fetch(oversizedRequest);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ success: false, code: 'ATTACHMENT_TOO_LARGE' });

    const wrongMedia = await app.request('/api/household/plan/proposal', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${owner.token}`,
        'x-household-id': 'home-a',
        'content-type': 'text/plain'
      },
      body: 'not supported'
    });
    expect(wrongMedia.status).toBe(415);

    const stringImage = new FormData();
    stringImage.set('baseVersion', '0');
    stringImage.set('prompt', 'Crea un plano');
    stringImage.set('image', 'not-a-file');
    const malformedImage = await callProposal(owner, stringImage);
    expect(malformedImage.status).toBe(400);

    const multipleImages = new FormData();
    multipleImages.set('baseVersion', '0');
    multipleImages.set('prompt', 'Crea un plano');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    multipleImages.append('image', new File([png], 'one.png', { type: 'image/png' }));
    multipleImages.append('image', new File([png], 'two.png', { type: 'image/png' }));
    const duplicateImage = await callProposal(owner, multipleImages);
    expect(duplicateImage.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });

  it('uses the existing admin settings default and validates uploaded media signatures', async () => {
    makeHousehold('home-a');
    const admin = makeUser('admin-a', 'home-a', false);
    db.prepare('UPDATE household_members SET role = ?, permissions = NULL WHERE user_id = ?').run(
      'admin',
      admin.id
    );
    const allowed = await call(admin, 'PUT', { baseVersion: 0, plan: validPlan() });
    expect(allowed.status).toBe(200);

    const invalidSketch = new FormData();
    invalidSketch.set('baseVersion', '1');
    invalidSketch.set('prompt', 'Ajusta el plano');
    invalidSketch.set('image', new File(['not png'], 'sketch.png', { type: 'image/png' }));
    const rejected = await callProposal(admin, invalidSketch);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ success: false, code: 'INVALID_ATTACHMENT' });
  });
});
