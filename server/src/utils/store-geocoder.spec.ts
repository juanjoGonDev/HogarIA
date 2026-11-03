import { describe, expect, it, vi } from 'vitest';
import { createStoreGeocoder, normalizeStoreAddress } from './store-geocoder.js';

type FetchInput = Parameters<typeof fetch>[0];
type FetchOptions = Parameters<typeof fetch>[1];

function response(status: number, payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

function fakeClock(start = 0) {
  let now = start;
  const waits: number[] = [];
  return {
    now: () => now,
    waits,
    sleep: async (milliseconds: number) => {
      waits.push(milliseconds);
      now += milliseconds;
    }
  };
}

describe('normalizeStoreAddress', () => {
  it('trims, canonicalizes Unicode and collapses whitespace', () => {
    expect(normalizeStoreAddress('  AV.  de Andalucía  12\n ')).toBe('AV. de Andalucía 12');
    expect(normalizeStoreAddress('   ')).toBe('');
  });
});

describe('createStoreGeocoder', () => {
  it('geocodes a normalized address once and caches case/space variants', async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchOptions) =>
      response(200, [{ lat: '36.834', lon: '-2.463' }])
    );
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl
    });

    const first = await geocoder.geocode('  Av.  de Almería  12 ');
    const second = await geocoder.geocode('av. de almería 12');

    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'resolved', latitude: 36.834, longitude: -2.463 });
    expect(first.attribution).toMatchObject({
      text: expect.stringContaining('OpenStreetMap'),
      url: 'https://www.openstreetmap.org/copyright'
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('q=Av.+de+Almer%C3%ADa+12');
    expect(String(url)).toContain('format=jsonv2');
    expect(String(url)).toContain('limit=1');
    expect(new Headers(init?.headers).get('user-agent')).toBe(
      'HogarIA/1.0 (https://hogaria.example/contact)'
    );
  });

  it('serializes distinct lookups with at least one second between starts', async () => {
    const clock = fakeClock();
    const startedAt: number[] = [];
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchOptions) => {
      startedAt.push(clock.now());
      return response(200, [{ lat: 37, lon: -3 }]);
    });
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl,
      clock
    });

    await Promise.all([
      geocoder.geocode('Calle uno 1'),
      geocoder.geocode('Calle dos 2'),
      geocoder.geocode('Calle tres 3')
    ]);

    expect(startedAt).toEqual([0, 1000, 2000]);
    expect(clock.waits).toEqual([1000, 1000]);
  });

  it('coalesces concurrent requests for the same normalized address', async () => {
    let release!: (value: Response) => void;
    const fetchImpl = vi.fn(
      (_input: FetchInput, _init?: FetchOptions) =>
        new Promise<Response>((resolve) => (release = resolve))
    );
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl
    });

    const first = geocoder.geocode('Calle Mayor 4');
    const second = geocoder.geocode('  calle   mayor 4 ');
    await Promise.resolve();
    release(response(200, [{ lat: '40.4', lon: '-3.7' }]));

    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ status: 'resolved', latitude: 40.4, longitude: -3.7 }),
      expect.objectContaining({ status: 'resolved', latitude: 40.4, longitude: -3.7 })
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns and caches a safe no-match result', async () => {
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchOptions) => response(200, []));
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl
    });

    const first = await geocoder.geocode('Calle que no existe 999');
    const second = await geocoder.geocode('Calle que no existe 999');

    expect(first).toMatchObject({ status: 'not_found', latitude: null, longitude: null });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps HTTP 404 and 429 to safe statuses without caching transient rate limits', async () => {
    const clock = fakeClock();
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(response(404, { error: 'private remote detail' }))
      .mockResolvedValueOnce(
        response(429, { error: 'private remote detail' }, { 'Retry-After': '2' })
      )
      .mockResolvedValueOnce(response(200, [{ lat: '1', lon: '2' }]));
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl,
      clock
    });

    const notFound = await geocoder.geocode('No existe 1');
    const limited = await geocoder.geocode('Calle retry 1');
    const resolved = await geocoder.geocode('Calle retry 1');

    expect(notFound).toMatchObject({ status: 'not_found', latitude: null, longitude: null });
    expect(limited).toMatchObject({ status: 'rate_limited', latitude: null, longitude: null });
    expect(limited).not.toHaveProperty('error');
    expect(JSON.stringify(limited)).not.toContain('private remote detail');
    expect(resolved).toMatchObject({ status: 'resolved', latitude: 1, longitude: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(clock.waits).toEqual([1000, 2000]);
  });

  it('returns timeout without exposing transport errors', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_input: FetchInput, init?: FetchOptions) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('secret transport detail'))
            );
          })
      );
      const geocoder = createStoreGeocoder({
        userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
        fetchImpl,
        timeoutMs: 25
      });

      const pending = geocoder.geocode('Calle lenta 1');
      await vi.advanceTimersByTimeAsync(30);

      const result = await pending;
      expect(result).toMatchObject({ status: 'timeout', latitude: null, longitude: null });
      expect(JSON.stringify(result)).not.toContain('secret transport detail');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed, missing and out-of-range coordinates as safe invalid responses', async () => {
    const payloads = [
      [{ lat: 'Infinity', lon: '-2' }],
      [{ lat: '91', lon: '2' }],
      [{ lat: '40', lon: '181' }],
      [{ lat: '40' }],
      { error: 'private remote detail' }
    ];
    const fetchImpl = vi.fn(async (_input: FetchInput, _init?: FetchOptions) =>
      response(200, payloads.shift())
    );
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl
    });

    for (let index = 0; index < 5; index += 1) {
      const result = await geocoder.geocode(`Calle inválida ${index}`);
      expect(result).toMatchObject({
        status: 'invalid_response',
        latitude: null,
        longitude: null
      });
      expect(JSON.stringify(result)).not.toContain('private remote detail');
    }
  });

  it('does not cache network failures so a later attempt can recover', async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('secret network failure'))
      .mockResolvedValueOnce(response(200, [{ lat: '10', lon: '20' }]));
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl
    });

    const failed = await geocoder.geocode('Calle recuperable 1');
    const retried = await geocoder.geocode('Calle recuperable 1');

    expect(failed).toMatchObject({ status: 'unavailable', latitude: null, longitude: null });
    expect(JSON.stringify(failed)).not.toContain('secret network failure');
    expect(retried).toMatchObject({ status: 'resolved', latitude: 10, longitude: 20 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns invalid_address for empty/control-only input without a network request', async () => {
    const fetchImpl = vi.fn(async () => response(200, [{ lat: '0', lon: '0' }]));
    const geocoder = createStoreGeocoder({
      userAgent: 'HogarIA/1.0 (https://hogaria.example/contact)',
      fetchImpl
    });

    await expect(geocoder.geocode(' \n\u0000 ')).resolves.toMatchObject({
      status: 'invalid_address',
      latitude: null,
      longitude: null
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
