export type StoreLocatorStatus =
  'ok' | 'invalid_input' | 'invalid_response' | 'rate_limited' | 'timeout' | 'unavailable';

export interface StoreLocatorCandidate {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  attribution: string;
  attributionUrl: string;
  source: 'openstreetmap';
}

export interface StoreLocatorResult {
  status: StoreLocatorStatus;
  candidates: StoreLocatorCandidate[];
}

export interface StoreLocatorClock {
  now(): number;
  sleep(milliseconds: number): Promise<void>;
}

export interface NearbyStoreLocatorOptions {
  endpoint?: string;
  userAgent: string;
  attribution?: { text: string; url: string };
  fetchImpl?: typeof fetch;
  clock?: StoreLocatorClock;
  timeoutMs?: number;
  intervalMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
}

interface CacheEntry {
  result: StoreLocatorResult;
  expiresAt: number;
}

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 200;
const DEFAULT_ATTRIBUTION = {
  text: '© OpenStreetMap contributors',
  url: 'https://www.openstreetmap.org/copyright'
};
const MAX_RADIUS_METERS = 1000;
const DEFAULT_RADIUS_METERS = 500;
const MAX_CANDIDATES = 12;
const MAX_ELEMENTS = 100;

const DEFAULT_CLOCK: StoreLocatorClock = {
  now: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
};

function validCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Great-circle distance in metres; input must already be coordinate-validated. */
export function distanceMeters(
  latitude: number,
  longitude: number,
  otherLatitude: number,
  otherLongitude: number
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = radians(otherLatitude - latitude);
  const lonDelta = radians(otherLongitude - longitude);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(otherLatitude)) * Math.sin(lonDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function failed(status: StoreLocatorStatus): StoreLocatorResult {
  return { status, candidates: [] };
}

function safeText(value: unknown, maximum = 120): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function endpointUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('STORE_LOCATOR_INVALID_ENDPOINT');
  }
  const secure = url.protocol === 'https:';
  const localHttp =
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!secure && !localHttp) throw new Error('STORE_LOCATOR_INVALID_ENDPOINT');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('STORE_LOCATOR_INVALID_ENDPOINT');
  }
  return url;
}

function coordinates(value: unknown): { latitude: number; longitude: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const latitude = Number(raw.lat);
  const longitude = Number(raw.lon);
  return validCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

function candidateFromElement(
  raw: unknown,
  latitude: number,
  longitude: number,
  attribution: { text: string; url: string }
): StoreLocatorCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const element = raw as Record<string, unknown>;
  const tags =
    element.tags && typeof element.tags === 'object' && !Array.isArray(element.tags)
      ? (element.tags as Record<string, unknown>)
      : {};
  if (typeof tags.shop !== 'string' && tags.amenity !== 'marketplace') return null;
  const name = safeText(tags.name);
  if (!name) return null;
  const point = coordinates(element) ?? coordinates(element.center);
  if (!point) return null;
  const id = safeText(`${String(element.type ?? '')}:${String(element.id ?? '')}`, 80);
  if (!id || !/^\w+:\d+$/u.test(id)) return null;
  const street = safeText(tags['addr:street'], 120);
  const number = safeText(tags['addr:housenumber'], 24);
  const postcode = safeText(tags['addr:postcode'], 20);
  const city = safeText(tags['addr:city'], 80);
  const address = [street ? `${street}${number ? ` ${number}` : ''}` : '', postcode, city]
    .filter(Boolean)
    .join(', ');

  return {
    id: `osm:${id}`,
    name,
    address: address || null,
    latitude: point.latitude,
    longitude: point.longitude,
    distanceMeters: Math.round(
      distanceMeters(latitude, longitude, point.latitude, point.longitude)
    ),
    attribution: attribution.text,
    attributionUrl: attribution.url,
    source: 'openstreetmap'
  };
}

/** Small, best-effort OSM nearby-shop lookup. Results and in-flight requests stay in memory only. */
export class NearbyStoreLocator {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: StoreLocatorClock;
  private readonly userAgent: string;
  private readonly attribution: { text: string; url: string };
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<StoreLocatorResult>>();
  private queue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: NearbyStoreLocatorOptions) {
    this.endpoint = endpointUrl(options.endpoint ?? DEFAULT_ENDPOINT);
    this.userAgent = options.userAgent.trim();
    if (!this.userAgent || this.userAgent.length > 256 || /\p{Cc}/u.test(this.userAgent)) {
      throw new Error('STORE_LOCATOR_INVALID_USER_AGENT');
    }
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.attribution = options.attribution ?? DEFAULT_ATTRIBUTION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    for (const [key, value] of Object.entries({
      timeoutMs: this.timeoutMs,
      intervalMs: this.intervalMs,
      cacheTtlMs: this.cacheTtlMs,
      maxCacheEntries: this.maxCacheEntries
    })) {
      if (!Number.isSafeInteger(value) || value < (key === 'intervalMs' ? 0 : 1)) {
        throw new Error(`STORE_LOCATOR_INVALID_${key.toUpperCase()}`);
      }
    }
  }

  search(
    latitude: number,
    longitude: number,
    requestedRadius = DEFAULT_RADIUS_METERS
  ): Promise<StoreLocatorResult> {
    if (!validCoordinate(latitude, longitude) || !Number.isFinite(requestedRadius)) {
      return Promise.resolve(failed('invalid_input'));
    }
    const radius = Math.min(MAX_RADIUS_METERS, Math.max(50, Math.round(requestedRadius)));
    // Four decimals are ~11 m: enough to limit cache cardinality, still close to the chosen spot.
    const latitudeKey = Number(latitude.toFixed(4));
    const longitudeKey = Number(longitude.toFixed(4));
    const key = `${latitudeKey}:${longitudeKey}:${radius}`;
    const cached = this.readCache(key);
    if (cached) return Promise.resolve(cached);
    const existing = this.inFlight.get(key);
    if (existing) return existing.then((result) => this.clone(result));

    const pending = this.enqueue(latitudeKey, longitudeKey, radius)
      .then((result) => {
        if (result.status === 'ok') this.writeCache(key, result);
        return result;
      })
      .catch(() => failed('unavailable'));
    this.inFlight.set(key, pending);
    return pending
      .then((result) => this.clone(result))
      .finally(() => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      });
  }

  clearCache(): void {
    this.cache.clear();
  }

  private enqueue(
    latitude: number,
    longitude: number,
    radius: number
  ): Promise<StoreLocatorResult> {
    const pending = this.queue.then(async () => {
      while (this.nextRequestAt > this.clock.now()) {
        await this.clock.sleep(this.nextRequestAt - this.clock.now());
      }
      this.nextRequestAt = this.clock.now() + this.intervalMs;
      return this.request(latitude, longitude, radius);
    });
    this.queue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }

  private async request(
    latitude: number,
    longitude: number,
    radius: number
  ): Promise<StoreLocatorResult> {
    const query = `[out:json][timeout:5][maxsize:1048576];(node(around:${radius},${latitude},${longitude})["shop"];way(around:${radius},${latitude},${longitude})["shop"];relation(around:${radius},${latitude},${longitude})["shop"];node(around:${radius},${latitude},${longitude})["amenity"="marketplace"];way(around:${radius},${latitude},${longitude})["amenity"="marketplace"];);out center tags 30;`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'text/plain;charset=UTF-8',
          'user-agent': this.userAgent
        },
        body: query,
        signal: controller.signal
      });
      if (response.status === 429 || response.status === 406) {
        this.nextRequestAt = Math.max(this.nextRequestAt, this.clock.now() + 30_000);
        return failed('rate_limited');
      }
      if (!response.ok) return failed('unavailable');
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return failed('invalid_response');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return failed('invalid_response');
      }
      const elements = (payload as Record<string, unknown>).elements;
      if (!Array.isArray(elements)) return failed('invalid_response');
      const candidates = elements
        .slice(0, MAX_ELEMENTS)
        .map((element) => candidateFromElement(element, latitude, longitude, this.attribution))
        .filter((candidate): candidate is StoreLocatorCandidate => candidate !== null)
        .sort((left, right) => left.distanceMeters - right.distanceMeters)
        .slice(0, MAX_CANDIDATES);
      return { status: 'ok', candidates };
    } catch (error) {
      return failed(
        error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unavailable'
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private readCache(key: string): StoreLocatorResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.clock.now()) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return this.clone(entry.result);
  }

  private writeCache(key: string, result: StoreLocatorResult): void {
    this.cache.delete(key);
    this.cache.set(key, {
      result: this.clone(result),
      expiresAt: this.clock.now() + this.cacheTtlMs
    });
    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private clone(result: StoreLocatorResult): StoreLocatorResult {
    return {
      status: result.status,
      candidates: result.candidates.map((candidate) => ({ ...candidate }))
    };
  }
}
