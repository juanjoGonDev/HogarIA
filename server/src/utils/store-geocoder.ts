const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const REQUEST_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;
const MAX_ADDRESS_LENGTH = 512;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

export type StoreGeocodeStatus =
  | 'resolved'
  | 'not_found'
  | 'invalid_address'
  | 'invalid_response'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable';

export interface StoreGeocodeAttribution {
  text: string;
  url: string;
}

export interface StoreGeocodeResult {
  status: StoreGeocodeStatus;
  latitude: number | null;
  longitude: number | null;
  attribution: StoreGeocodeAttribution;
}

export interface StoreGeocoderClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface StoreGeocoderOptions {
  /** Search endpoint; defaults to the public Nominatim search API. */
  endpoint?: string;
  /** Identifies HogarIA to the geocoding service. Never use a generic HTTP client UA. */
  userAgent: string;
  fetchImpl?: typeof fetch;
  clock?: StoreGeocoderClock;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  attribution?: StoreGeocodeAttribution;
}

interface CacheEntry {
  result: StoreGeocodeResult;
  expiresAt: number;
}

const DEFAULT_ATTRIBUTION: StoreGeocodeAttribution = {
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright'
};

const DEFAULT_CLOCK: StoreGeocoderClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
};

/** Canonical address sent to the provider and used as the in-memory cache key. */
export function normalizeStoreAddress(address: string): string {
  if (typeof address !== 'string') return '';
  return address
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseCoordinate(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeResult(
  status: StoreGeocodeStatus,
  attribution: StoreGeocodeAttribution,
  latitude: number | null = null,
  longitude: number | null = null
): StoreGeocodeResult {
  return { status, latitude, longitude, attribution: { ...attribution } };
}

function cacheKey(address: string): string {
  return address.toLocaleLowerCase('es-ES');
}

function validatedEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('STORE_GEOCODER_INVALID_ENDPOINT');
  }

  const secure = endpoint.protocol === 'https:';
  const localHttp =
    endpoint.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    (!secure && !localHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('STORE_GEOCODER_INVALID_ENDPOINT');
  }

  return endpoint;
}

function retryAfterMs(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value.trim());
  const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(delay) || delay <= 0) return 0;
  return Math.min(Math.ceil(delay), MAX_RETRY_AFTER_MS);
}

function cloneResult(result: StoreGeocodeResult): StoreGeocodeResult {
  return { ...result, attribution: { ...result.attribution } };
}

/**
 * Server-side, single-result address geocoder. One instance serializes requests at <= 1 req/s;
 * successful and no-match results are cached, while transient failures remain retryable.
 */
export class StoreGeocoder {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: StoreGeocoderClock;
  private readonly attribution: StoreGeocodeAttribution;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<StoreGeocodeResult>>();
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: StoreGeocoderOptions) {
    this.endpoint = validatedEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
    this.userAgent = options.userAgent.trim();
    if (!this.userAgent || this.userAgent.length > 256 || /\p{Cc}/u.test(this.userAgent)) {
      throw new Error('STORE_GEOCODER_INVALID_USER_AGENT');
    }

    this.fetchImpl = options.fetchImpl ?? fetch;
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error('STORE_GEOCODER_INVALID_TIMEOUT');
    }
    if (!Number.isSafeInteger(this.cacheTtlMs) || this.cacheTtlMs < 1) {
      throw new Error('STORE_GEOCODER_INVALID_CACHE_TTL');
    }
    if (!Number.isSafeInteger(this.maxCacheEntries) || this.maxCacheEntries < 1) {
      throw new Error('STORE_GEOCODER_INVALID_CACHE_SIZE');
    }
    this.attribution = options.attribution ?? DEFAULT_ATTRIBUTION;
  }

  geocode(address: string): Promise<StoreGeocodeResult> {
    const normalizedAddress = normalizeStoreAddress(address);
    if (!normalizedAddress || normalizedAddress.length > MAX_ADDRESS_LENGTH) {
      return Promise.resolve(safeResult('invalid_address', this.attribution));
    }

    const key = cacheKey(normalizedAddress);
    const cached = this.readCache(key);
    if (cached) return Promise.resolve(cloneResult(cached));

    const existing = this.inFlight.get(key);
    if (existing) return existing.then(cloneResult);

    const pending = this.enqueue(normalizedAddress)
      .then((result) => {
        if (result.status === 'resolved' || result.status === 'not_found') {
          this.writeCache(key, result);
        }
        return result;
      })
      .catch(() => safeResult('unavailable', this.attribution));
    this.inFlight.set(key, pending);

    return pending.then(cloneResult).finally(() => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  private readCache(key: string): StoreGeocodeResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.cache.delete(key);
      return null;
    }
    // Refresh LRU order without extending the address TTL.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  private writeCache(key: string, result: StoreGeocodeResult): void {
    this.cache.delete(key);
    this.cache.set(key, {
      result: cloneResult(result),
      expiresAt: this.clock.now() + this.cacheTtlMs
    });
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  private enqueue(address: string): Promise<StoreGeocodeResult> {
    const result = this.queue.then(async () => {
      while (this.nextRequestAt > this.clock.now()) {
        await this.clock.sleep(this.nextRequestAt - this.clock.now());
      }

      const requestStartedAt = this.clock.now();
      this.nextRequestAt = requestStartedAt + REQUEST_INTERVAL_MS;
      return this.request(address);
    });
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async request(address: string): Promise<StoreGeocodeResult> {
    const url = new URL(this.endpoint);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', address);

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': this.userAgent
        },
        signal: controller.signal
      });

      if (response.status === 429) {
        const cooldown = retryAfterMs(response.headers.get('Retry-After'), this.clock.now());
        this.nextRequestAt = Math.max(this.nextRequestAt, this.clock.now() + cooldown);
        return safeResult('rate_limited', this.attribution);
      }
      if (response.status === 404) return safeResult('not_found', this.attribution);
      if (!response.ok) return safeResult('unavailable', this.attribution);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return safeResult(timedOut ? 'timeout' : 'invalid_response', this.attribution);
      }

      if (Array.isArray(payload) && payload.length === 0) {
        return safeResult('not_found', this.attribution);
      }
      if (!Array.isArray(payload) || payload.length === 0) {
        return safeResult('invalid_response', this.attribution);
      }

      const candidate = asObject(payload[0]);
      const latitude = parseCoordinate(candidate?.lat);
      const longitude = parseCoordinate(candidate?.lon);
      if (
        latitude === null ||
        longitude === null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return safeResult('invalid_response', this.attribution);
      }

      return safeResult('resolved', this.attribution, latitude, longitude);
    } catch {
      return safeResult(timedOut ? 'timeout' : 'unavailable', this.attribution);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createStoreGeocoder(options: StoreGeocoderOptions): StoreGeocoder {
  return new StoreGeocoder(options);
}
