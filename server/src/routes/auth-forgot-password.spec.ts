import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Definir antes de importar la configuración: esta integración nunca abre la BD de desarrollo.
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

let app: Awaited<ReturnType<typeof import('../app.js').createApp>>;
let closeDatabase: (() => void) | undefined;

const json = async (response: Response): Promise<unknown> => response.json();

async function register(email: string): Promise<void> {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Recovery Fixture', email, password: 'Test1234' })
  });
  expect(response.status).toBe(201);
}

async function requestRecovery(email: string): Promise<Response> {
  return app.request('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email })
  });
}

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  closeDatabase = database.closeDatabase;
  const { createApp } = await import('../app.js');
  app = createApp({ rateLimit: null, staticDir: null });
});

afterAll(() => closeDatabase?.());

describe('POST /api/auth/forgot-password', () => {
  it('returns the same generic response for a known and unknown account', async () => {
    const email = 'recovery-existing@hogaria.test';
    await register(email);

    const existing = await requestRecovery(email);
    const unknown = await requestRecovery('recovery-missing@hogaria.test');

    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    const existingBody = await json(existing);
    expect(existingBody).toEqual(await json(unknown));
    expect(existingBody).toEqual({
      success: true,
      message: 'Password recovery is not currently available'
    });
    expect(JSON.stringify(existingBody)).not.toMatch(/sent|link/i);
    expect(existingBody).not.toHaveProperty('data');
  });

  it('rejects a malformed email instead of acknowledging a recovery request', async () => {
    const response = await requestRecovery('not-an-email');

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ success: false });
  });
});
