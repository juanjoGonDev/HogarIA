import { describe, expect, it, vi } from 'vitest';
import { NearbyStoreLocator, type StoreLocatorClock } from './store-locator.js';

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

describe('NearbyStoreLocator', () => {
  const options = {
    endpoint: 'https://overpass.example/api/interpreter',
    userAgent: 'HogarIA test/1.0',
    attribution: {
      text: '© OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright'
    }
  };

  it('bounds the query, identifies the app, and returns only named nearby shops', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 40.4168,
            lon: -3.7038,
            tags: { shop: 'supermarket', name: 'Mercado Uno', 'addr:street': 'Calle Sol' }
          },
          {
            type: 'way',
            id: 2,
            center: { lat: 40.417, lon: -3.704 },
            tags: { shop: 'bakery', name: 'Panadería Dos' }
          },
          { type: 'node', id: 3, lat: 40.4, lon: -3.7, tags: { shop: 'convenience' } },
          { type: 'node', id: 4, lat: 0, lon: 0, tags: { amenity: 'school', name: 'Colegio' } }
        ]
      })
    );
    const locator = new NearbyStoreLocator({ ...options, fetchImpl });

    const result = await locator.search(40.4168, -3.7038, 600);

    expect(result.status).toBe('ok');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      name: 'Mercado Uno',
      address: 'Calle Sol',
      source: 'openstreetmap'
    });
    expect(result.candidates[0].distanceMeters).toBe(0);
    const [url, request] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(options.endpoint);
    expect(request.headers).toMatchObject({ 'user-agent': options.userAgent });
    expect(String(request.body)).toContain('around:600,40.4168,-3.7038');
  });

  it('rejects invalid coordinates and clamps radius without making a request', async () => {
    const fetchImpl = vi.fn();
    const locator = new NearbyStoreLocator({ ...options, fetchImpl });

    await expect(locator.search(Number.NaN, 0)).resolves.toMatchObject({
      status: 'invalid_input',
      candidates: []
    });
    await expect(locator.search(91, 0)).resolves.toMatchObject({
      status: 'invalid_input',
      candidates: []
    });
    await locator.search(0, 0, 5000);

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(String(fetchImpl.mock.calls[0][1]?.body)).toContain('around:1000,0,0');
  });

  it('caches successful and empty responses and coalesces concurrent requests', async () => {
    let release!: (value: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const locator = new NearbyStoreLocator({ ...options, fetchImpl });
    const first = locator.search(40.4, -3.7);
    const second = locator.search(40.4, -3.7);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    release(response({ elements: [] }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'ok', candidates: [] },
      { status: 'ok', candidates: [] }
    ]);
    await locator.search(40.4, -3.7);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('turns provider errors, rate limits, malformed payloads, and timeouts into safe fallbacks', async () => {
    const rateLimited = new NearbyStoreLocator({
      ...options,
      fetchImpl: vi.fn().mockResolvedValue(response({}, 429))
    });
    const malformed = new NearbyStoreLocator({
      ...options,
      fetchImpl: vi.fn().mockResolvedValue(response({ elements: 'bad' }))
    });
    const unavailable = new NearbyStoreLocator({
      ...options,
      fetchImpl: vi.fn().mockResolvedValue(response({}, 503))
    });
    const timedOut = new NearbyStoreLocator({
      ...options,
      timeoutMs: 1,
      fetchImpl: vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      )
    });

    await expect(rateLimited.search(1, 1)).resolves.toMatchObject({
      status: 'rate_limited',
      candidates: []
    });
    await expect(malformed.search(2, 2)).resolves.toMatchObject({
      status: 'invalid_response',
      candidates: []
    });
    await expect(unavailable.search(3, 3)).resolves.toMatchObject({
      status: 'unavailable',
      candidates: []
    });
    await expect(timedOut.search(4, 4)).resolves.toMatchObject({
      status: 'timeout',
      candidates: []
    });
  });

  it('serializes calls and validates endpoint and user-agent configuration', async () => {
    let now = 0;
    const waits: number[] = [];
    const clock: StoreLocatorClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      }
    };
    const fetchImpl = vi.fn().mockResolvedValue(response({ elements: [] }));
    const locator = new NearbyStoreLocator({ ...options, fetchImpl, clock, intervalMs: 250 });
    await locator.search(10, 10);
    await locator.search(11, 11);
    expect(waits).toEqual([250]);
    expect(
      () => new NearbyStoreLocator({ ...options, endpoint: 'http://remote.example/x' })
    ).toThrow();
    expect(() => new NearbyStoreLocator({ ...options, userAgent: '  ' })).toThrow();
  });

  it('backs off for 30 seconds after provider HTTP 429 or 406', async () => {
    let now = 0;
    const waits: number[] = [];
    const clock: StoreLocatorClock = {
      now: () => now,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      }
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({}, 429))
      .mockResolvedValueOnce(response({}, 406));
    const locator = new NearbyStoreLocator({ ...options, fetchImpl, clock });

    await expect(locator.search(10, 10)).resolves.toMatchObject({ status: 'rate_limited' });
    await expect(locator.search(11, 11)).resolves.toMatchObject({ status: 'rate_limited' });
    expect(waits).toEqual([30_000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
