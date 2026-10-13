import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;

describe('authMiddleware household setup gate', () => {
  let app: Hono;
  let db: Sql;
  let closeDatabase: () => void;
  let token: string;

  beforeAll(async () => {
    const database = await import('../config/database.js');
    const { authMiddleware } = await import('./auth.middleware.js');
    const { config } = await import('../config/app.config.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;

    app = new Hono();
    app.get('/api/protected', authMiddleware, (context) => context.json({ success: true }));
    app.get('/api/household/memberships', authMiddleware, (context) =>
      context.json({ success: true })
    );
    app.post('/api/household', authMiddleware, (context) => context.json({ success: true }));
    app.post('/api/household/join', authMiddleware, (context) => context.json({ success: true }));
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

  it('allows only household discovery/create/join endpoints during setup', async () => {
    for (const [method, path] of [
      ['GET', '/api/household/memberships'],
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
