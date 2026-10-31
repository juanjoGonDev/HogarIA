import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import type { AppEnv } from '../types/hono-env.js';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

describe('authMiddleware household setup gate', () => {
  let app: Hono<AppEnv>;
  let db: Sql;
  let closeDatabase: () => void;
  let token: string;
  let unmarkedApp: Hono;
  let productionApp: Hono;

  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { authMiddleware } = await import('./auth.middleware.js');
    const { config } = await import('../config/app.config.js');
    const { createApp } = await import('../app.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;

    app = new Hono<AppEnv>();
    app.use('/api/*', async (context, next) => {
      context.set('householdSetupGate', true);
      await next();
    });
    app.get('/api/protected', authMiddleware, (context) => context.json({ success: true }));
    app.get('/api/ai/availability', authMiddleware, (context) =>
      context.json({ success: true, data: { hasActiveProvider: false } })
    );
    app.get('/api/household/memberships', authMiddleware, (context) =>
      context.json({ success: true })
    );
    app.post('/api/household', authMiddleware, (context) => context.json({ success: true }));
    app.post('/api/household/join', authMiddleware, (context) => context.json({ success: true }));

    // Isolated route unit tests do not represent createApp's production middleware stack.
    // They must remain usable without implicitly enabling the account-setup gate.
    unmarkedApp = new Hono();
    unmarkedApp.get('/api/protected', authMiddleware, (context) => context.json({ success: true }));
    productionApp = createApp({ rateLimit: null });
    token = jwt.sign(
      { sub: 'pending-user', email: 'pending@hogaria.test' },
      config.auth.jwtSecret,
      {
        expiresIn: '1h'
      }
    );
  });

  afterAll(() => closeDatabase());

  beforeEach(() => {
    db.prepare('UPDATE users SET household_id = NULL').run();
    db.prepare('DELETE FROM household_members').run();
    db.prepare('DELETE FROM households').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      'pending-user',
      'pending@hogaria.test',
      'Pending',
      'hash'
    );
  });

  function call(method: string, path: string) {
    return app.request(path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    });
  }

  it('blocks protected endpoints when the account has no active household membership', async () => {
    const response = await call('GET', '/api/protected');

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_REQUIRED'
    });
  });

  it('does not enable the setup gate in isolated router tests without the app marker', async () => {
    const response = await unmarkedApp.request('/api/protected', {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('enforces the gate in createApp while allowing household discovery', async () => {
    const headers = { authorization: `Bearer ${token}` };
    const protectedResponse = await productionApp.request('/api/pantry/ingredients', { headers });
    const membershipsResponse = await productionApp.request('/api/household/memberships', {
      headers
    });
    const availabilityResponse = await productionApp.request('/api/ai/availability', { headers });

    expect(protectedResponse.status).toBe(409);
    expect(await protectedResponse.json()).toMatchObject({
      success: false,
      code: 'HOUSEHOLD_REQUIRED'
    });
    expect(membershipsResponse.status).toBe(200);
    expect(availabilityResponse.status).toBe(200);
    expect(await availabilityResponse.json()).toMatchObject({
      success: true,
      data: { hasActiveProvider: false, requiresHouseholdSelection: false }
    });
  });

  it('allows only household discovery, AI availability, create/join endpoints during setup', async () => {
    for (const [method, path] of [
      ['GET', '/api/household/memberships'],
      ['GET', '/api/ai/availability'],
      ['POST', '/api/household'],
      ['POST', '/api/household/join']
    ]) {
      const response = await call(method, path);
      expect(response.status, `${method} ${path}`).toBe(200);
    }
  });

  it('allows protected endpoints once an active membership is selected', async () => {
    db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
      'pending-home',
      'Test home',
      'PENDING1'
    );
    db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(
      'pending-home',
      'pending-user'
    );
    db.prepare(
      `INSERT INTO household_members (id, household_id, user_id, role, permissions)
       VALUES (?, ?, ?, 'admin', '{"settings":true}')`
    ).run('pending-membership', 'pending-home', 'pending-user');

    const response = await call('GET', '/api/protected');

    expect(response.status).toBe(200);
  });
});
