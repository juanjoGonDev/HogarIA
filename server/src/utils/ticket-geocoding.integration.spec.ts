import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';

const { geocodeMock } = vi.hoisted(() => ({ geocodeMock: vi.fn() }));

vi.mock('./store-geocoder-runtime.js', () => ({
  storeGeocoder: { geocode: geocodeMock }
}));

const originalDatabasePath = process.env.DATABASE_PATH;
const originalNodeEnv = process.env.NODE_ENV;
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

type Sql = import('better-sqlite3').Database;
type ProviderRequest = {
  background?: boolean;
  store?: boolean;
  model?: string;
  input?: Array<{
    role: string;
    content?: Array<{ type: string; image_url?: string }>;
  }>;
};

const userId = 'receipt-geocoding-test-user';
let db: Sql;
let closeDatabase: (() => void) | undefined;
let uploadedTicketUrl: string | null = null;

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('Timed out waiting for receipt worker');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function providerResponse(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

describe('ticket geocoding integration', () => {
  beforeAll(async () => {
    const database = await import('../config/database.js');
    await database.initializeDatabase();
    db = database.getDatabase();
    closeDatabase = database.closeDatabase;
  });

  beforeEach(async () => {
    const { stopWorker } = await import('./ticket-queue.js');
    stopWorker();
    db.exec(
      `DELETE FROM receipt_items;
       DELETE FROM receipts;
       DELETE FROM ai_jobs;
       DELETE FROM ai_function_providers;
       DELETE FROM ai_configs;
       DELETE FROM users;`
    );
    db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').run(
      userId,
      'receipt-geocoding@test.local',
      'Receipt geocoding test',
      'test-hash'
    );
    db.prepare(
      `INSERT INTO ai_configs
        (id, user_id, name, provider, base_url, api_key, model, retry_attempts, concurrency, is_active)
       VALUES ('receipt-geocoding-config', ?, 'Test provider', 'custom',
         'http://provider.test/v1', 'synthetic-key', 'test-model', 0, 1, 1)`
    ).run(userId);
    uploadedTicketUrl = null;
    geocodeMock.mockReset();
    geocodeMock.mockResolvedValue({
      status: 'resolved',
      latitude: 36.834,
      longitude: -2.463,
      attribution: {
        text: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright'
      }
    });
  });

  afterEach(async () => {
    const { stopWorker } = await import('./ticket-queue.js');
    const { deleteUpload } = await import('./uploads.js');
    stopWorker();
    if (uploadedTicketUrl) deleteUpload(uploadedTicketUrl);
    uploadedTicketUrl = null;
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    const { stopWorker } = await import('./ticket-queue.js');
    stopWorker();
    closeDatabase?.();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('persists the AI-detected store address and geocoded location after a background receipt job', async () => {
    const { storeTicket } = await import('./uploads.js');
    const { encolarTicket } = await import('./ticket-queue.js');
    const receiptId = randomUUID();
    const address = 'Avenida Sierra Alhamilla, 04007 Almería';
    const responseId = 'resp_receipt_store_geocoding';
    const ticketBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    uploadedTicketUrl = storeTicket(userId, ticketBytes, 'jpeg');

    const answer = {
      lines: [],
      store: 'Mercadona',
      storeAddress: address,
      purchaseDate: '2026-10-07',
      currency: 'EUR',
      totalMinor: 789,
      warnings: []
    };
    let requestBody: ProviderRequest | undefined;
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      if (init?.method === 'POST') {
        requestBody = JSON.parse(String(init.body)) as ProviderRequest;
        return providerResponse(202, { id: responseId, status: 'in_progress', output: [] });
      }
      if (init?.method === 'GET' && requestUrl.pathname.endsWith(`/${responseId}`)) {
        return providerResponse(200, {
          id: responseId,
          status: 'completed',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }
          ]
        });
      }
      throw new Error(
        `Unexpected synthetic provider request: ${init?.method} ${requestUrl.pathname}`
      );
    });
    vi.stubGlobal('fetch', providerFetch);

    db.prepare(
      `INSERT INTO receipts (id, user_id, status, file_url, file_kind, ai_output_language)
       VALUES (?, ?, 'queued', ?, 'jpeg', 'es')`
    ).run(receiptId, userId, uploadedTicketUrl);

    const enqueuedJobId = encolarTicket(db, userId, receiptId);
    expect(enqueuedJobId).toBeTruthy();
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get(enqueuedJobId) as
        { status: string } | undefined;
      return row?.status === 'done' || row?.status === 'failed';
    });

    expect(db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get(enqueuedJobId)).toEqual({
      status: 'done'
    });
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(requestBody).toMatchObject({ background: true, store: true, model: 'test-model' });
    const inputContent = requestBody?.input?.find((item) => item.role === 'user')?.content;
    expect(inputContent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${ticketBytes.toString('base64')}`
        })
      ])
    );
    expect(geocodeMock).toHaveBeenCalledExactlyOnceWith(address);
    expect(
      db
        .prepare(
          `SELECT status, store_address, store_address_manual, store_latitude, store_longitude,
                  store_attribution, store_attribution_url
           FROM receipts WHERE id = ?`
        )
        .get(receiptId)
    ).toEqual({
      status: 'review',
      store_address: address,
      store_address_manual: 0,
      store_latitude: 36.834,
      store_longitude: -2.463,
      store_attribution: '© OpenStreetMap contributors',
      store_attribution_url: 'https://www.openstreetmap.org/copyright'
    });
    expect(
      db.prepare('SELECT address, latitude, longitude FROM stores WHERE name = ?').get('Mercadona')
    ).toEqual({ address, latitude: 36.834, longitude: -2.463 });
  });

  it('keeps a manually edited address when the slower AI geocoder finishes later', async () => {
    const { storeTicket } = await import('./uploads.js');
    const { encolarTicket } = await import('./ticket-queue.js');
    const { receiptsRoutes } = await import('../routes/receipts.routes.js');
    const { errorHandler } = await import('../middleware/error.middleware.js');
    const config = await import('../config/app.config.js');
    const receiptId = randomUUID();
    const aiAddress = 'Avenida detectada por IA, Almería';
    const manualAddress = 'Calle corregida a mano, Almería';
    const responseId = 'resp_receipt_manual_address_wins';
    const ticketBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    uploadedTicketUrl = storeTicket(userId, ticketBytes, 'jpeg');

    let releaseAiGeocode: ((result: unknown) => void) | undefined;
    let signalAiGeocodeStarted!: () => void;
    const aiGeocodeStarted = new Promise<void>((resolve) => {
      signalAiGeocodeStarted = resolve;
    });
    const manualLocation = {
      status: 'resolved',
      latitude: 37.258,
      longitude: -6.95,
      attribution: {
        text: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright'
      }
    };
    geocodeMock.mockImplementation((address: string) => {
      if (address === aiAddress) {
        return new Promise((resolve) => {
          releaseAiGeocode = resolve;
          signalAiGeocodeStarted();
        });
      }
      if (address === manualAddress) return Promise.resolve(manualLocation);
      throw new Error(`Unexpected synthetic address: ${address}`);
    });

    const answer = {
      lines: [],
      store: 'Mercadona',
      storeAddress: aiAddress,
      purchaseDate: '2026-10-07',
      currency: 'EUR',
      totalMinor: 789,
      warnings: []
    };
    const providerFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      if (init?.method === 'POST') {
        return providerResponse(202, { id: responseId, status: 'in_progress', output: [] });
      }
      if (init?.method === 'GET' && requestUrl.pathname.endsWith(`/${responseId}`)) {
        return providerResponse(200, {
          id: responseId,
          status: 'completed',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }
          ]
        });
      }
      throw new Error(
        `Unexpected synthetic provider request: ${init?.method} ${requestUrl.pathname}`
      );
    });
    vi.stubGlobal('fetch', providerFetch);

    db.prepare(
      `INSERT INTO receipts (id, user_id, status, file_url, file_kind, ai_output_language)
       VALUES (?, ?, 'queued', ?, 'jpeg', 'es')`
    ).run(receiptId, userId, uploadedTicketUrl);
    const jobId = encolarTicket(db, userId, receiptId);
    await aiGeocodeStarted;

    const app = new Hono();
    app.onError(errorHandler as never);
    app.route('/api/receipts', receiptsRoutes);
    const token = jwt.sign(
      { sub: userId, email: 'receipt-geocoding@test.local' },
      config.config.auth.jwtSecret,
      { expiresIn: '1h' }
    );
    const manualUpdate = await app.request(`/api/receipts/${receiptId}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ storeAddress: manualAddress })
    });
    expect(manualUpdate.status).toBe(200);
    const manualUpdateBody = (await manualUpdate.json()) as { data: Record<string, unknown> };
    expect(manualUpdateBody.data).toMatchObject({
      storeAddress: manualAddress,
      storeLatitude: manualLocation.latitude,
      storeLongitude: manualLocation.longitude
    });

    expect(releaseAiGeocode).toBeDefined();
    releaseAiGeocode?.({
      status: 'resolved',
      latitude: 36.834,
      longitude: -2.463,
      attribution: {
        text: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright'
      }
    });
    await waitFor(() => {
      const row = db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get(jobId) as
        { status: string } | undefined;
      return row?.status === 'done' || row?.status === 'failed';
    });

    expect(db.prepare('SELECT status FROM ai_jobs WHERE id = ?').get(jobId)).toEqual({
      status: 'done'
    });
    expect(
      db
        .prepare(
          `SELECT store, store_address, store_address_manual, store_latitude, store_longitude
           FROM receipts WHERE id = ?`
        )
        .get(receiptId)
    ).toEqual({
      store: 'Mercadona',
      store_address: manualAddress,
      store_address_manual: 1,
      store_latitude: manualLocation.latitude,
      store_longitude: manualLocation.longitude
    });
  });
});
