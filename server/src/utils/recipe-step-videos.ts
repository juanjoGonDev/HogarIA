import { createHash } from 'node:crypto';
import { ReadableStream } from 'node:stream/web';

export const RECIPE_STEP_VIDEO_SCENES = [
  'wash',
  'cut',
  'mix',
  'cook',
  'bake',
  'rest',
  'serve',
  'prepare'
] as const;

export type RecipeStepVideoScene = (typeof RECIPE_STEP_VIDEO_SCENES)[number];
export type RecipeStepVideoMime = 'video/mp4' | 'video/webm';

export const MAX_RECIPE_STEP_VIDEO_RANGE_BYTES = 4 * 1024 * 1024;
export const MAX_RECIPE_STEP_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_RECIPE_STEP_VIDEO_DURATION_SECONDS = 60;

export interface RecipeStepVideo {
  id: string;
  title: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  /** Internal size bound used by range validation; stripped from HTTP search DTOs. */
  sizeBytes: number;
  mimeType: RecipeStepVideoMime;
}

/** Server-only candidate payload persisted after an explicit user selection. */
export interface RecipeStepVideoSelection extends RecipeStepVideo {
  mediaUrl: string;
}

export interface RecipeStepVideoByteRange {
  start: number;
  end: number;
}

export interface RecipeStepVideoStream {
  body: ReadableStream<Uint8Array>;
  mimeType: RecipeStepVideoMime;
  contentRange: string;
  contentLength: number;
}

export interface RecipeStepVideoProvider {
  search(scene: RecipeStepVideoScene, signal?: AbortSignal): Promise<RecipeStepVideo[]>;
  getVideo(id: string): RecipeStepVideo | null;
  getSelectedVideo(id: string): RecipeStepVideoSelection | null;
  openStream(
    id: string,
    range: RecipeStepVideoByteRange,
    signal?: AbortSignal
  ): Promise<RecipeStepVideoStream | null>;
  openStoredStream(
    selection: RecipeStepVideoSelection,
    range: RecipeStepVideoByteRange,
    signal?: AbortSignal
  ): Promise<RecipeStepVideoStream | null>;
}

export interface RecipeStepVideoProviderOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const SCENE_QUERIES: Record<RecipeStepVideoScene, string> = {
  wash: 'washing vegetables kitchen sink',
  cut: 'chopping vegetables cutting board',
  mix: 'mixing ingredients bowl',
  cook: 'cooking food pan stove',
  bake: 'baking food oven tray',
  rest: 'resting cooked food covered dish',
  serve: 'serving plated food table',
  prepare: 'preparing ingredients kitchen counter'
};

const COMMONS_API_URL = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_REST_FILE_URL = 'https://commons.wikimedia.org/w/rest.php/v1/file/';
const USER_AGENT =
  'HogarIA/1.0 (+https://github.com/juanjoGonDev/HogarIA; local cooking recipe video search)';
const UPSTREAM_TIMEOUT_MS = 8000;
const STREAM_IDLE_TIMEOUT_MS = 10000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_HITS = 8;
const MAX_VIDEO_CANDIDATES = 5;
const MAX_CACHED_VIDEOS = 40;
const SCENE_CACHE_TTL_MS = 5 * 60 * 1000;
const EMPTY_SCENE_CACHE_TTL_MS = 60 * 1000;
const VIDEO_CACHE_TTL_MS = 20 * 60 * 1000;
const MAX_CONCURRENT_STREAMS = 3;
const MEDIA_HOSTS = new Set(['upload.wikimedia.org']);
const COMMONS_HOSTS = new Set(['commons.wikimedia.org']);
const LICENSE_HOSTS = new Set([
  'creativecommons.org',
  'www.creativecommons.org',
  'gnu.org',
  'www.gnu.org',
  'commons.wikimedia.org',
  'artlibre.org',
  'www.artlibre.org',
  'freedomdefined.org'
]);
const PLAYABLE_MIME_TYPES = new Set<RecipeStepVideoMime>(['video/mp4', 'video/webm']);

type RecordLike = Record<string, unknown>;
type CommonsMetadata = Record<string, { value?: unknown } | undefined>;

interface CachedVideo {
  video: RecipeStepVideo;
  mediaUrl: string;
  expiresAt: number;
}

interface CachedScene {
  videos: RecipeStepVideo[];
  expiresAt: number;
}

interface ByteRangeResponse {
  start: number;
  end: number;
  total: number;
}

function isRecord(value: unknown): value is RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeHttpsUrl(value: unknown, allowedHosts: ReadonlySet<string>): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !allowedHosts.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function safeMediaUrl(value: unknown): string | null {
  const normalized = safeHttpsUrl(value, MEDIA_HOSTS);
  if (!normalized) return null;
  const url = new URL(normalized);
  return url.pathname.startsWith('/wikipedia/commons/') ? url.href : null;
}

function safeThumbnailUrl(value: unknown): string | null {
  const normalized = safeMediaUrl(value);
  if (!normalized) return null;
  return new URL(normalized).pathname.includes('/thumb/') ? normalized : null;
}

function plainText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      if (code[0] !== '#') return namedEntities[code.toLowerCase()] ?? entity;
      const hexadecimal = code[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isSafeInteger(point) || point <= 0 || point > 0x10ffff) return '';
      try {
        return String.fromCodePoint(point);
      } catch {
        return '';
      }
    })
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function metadataValue(metadata: unknown, key: string): unknown {
  if (!isRecord(metadata)) return undefined;
  const entry = (metadata as CommonsMetadata)[key];
  return entry?.value;
}

function safeLicenseUrl(value: unknown): string | null {
  const url = safeHttpsUrl(value, LICENSE_HOSTS);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.hostname === 'commons.wikimedia.org' && !parsed.pathname.startsWith('/wiki/'))
    return null;
  return url;
}

export function isValidRecipeStepVideoSelection(value: unknown): value is RecipeStepVideoSelection {
  if (!isRecord(value)) return false;
  const mediaUrl = safeMediaUrl(value.mediaUrl);
  const sourceUrl = safeHttpsUrl(value.sourceUrl, COMMONS_HOSTS);
  const thumbnailUrl = safeThumbnailUrl(value.thumbnailUrl);
  const licenseUrl = safeLicenseUrl(value.licenseUrl);
  const title = typeof value.title === 'string' ? value.title : '';
  const author = typeof value.author === 'string' ? value.author : '';
  const licenseName = typeof value.licenseName === 'string' ? value.licenseName : '';
  return Boolean(
    /^[a-f0-9]{24}$/.test(String(value.id ?? '')) &&
    mediaUrl &&
    createHash('sha256').update(mediaUrl).digest('hex').slice(0, 24) === value.id &&
    sourceUrl &&
    new URL(sourceUrl).pathname.startsWith('/wiki/File:') &&
    thumbnailUrl &&
    licenseUrl &&
    title &&
    plainText(title, 180) === title &&
    author &&
    plainText(author, 180) === author &&
    licenseName &&
    plainText(licenseName, 80) === licenseName &&
    PLAYABLE_MIME_TYPES.has(value.mimeType as RecipeStepVideoMime) &&
    Number.isSafeInteger(value.durationSeconds) &&
    Number(value.durationSeconds) > 0 &&
    Number(value.durationSeconds) <= MAX_RECIPE_STEP_VIDEO_DURATION_SECONDS &&
    Number.isSafeInteger(value.sizeBytes) &&
    Number(value.sizeBytes) > 0 &&
    Number(value.sizeBytes) <= MAX_RECIPE_STEP_VIDEO_BYTES
  );
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel();
    throw new Error('Invalid Commons response type');
  }
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error('Commons response too large');
  }
  if (!response.body) throw new Error('Empty Commons response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Commons response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('Invalid Commons JSON');
  }
}

function getJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isScene(value: string): value is RecipeStepVideoScene {
  return (RECIPE_STEP_VIDEO_SCENES as readonly string[]).includes(value);
}

function parseDerivative(
  value: unknown
): { url: string; mimeType: RecipeStepVideoMime; width: number } | null {
  if (!isRecord(value)) return null;
  const url = safeMediaUrl(value.src);
  const mimeType = typeof value.type === 'string' ? value.type.toLowerCase() : '';
  const width = Number(value.width);
  if (
    !url ||
    !PLAYABLE_MIME_TYPES.has(mimeType as RecipeStepVideoMime) ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    width > 1280
  ) {
    return null;
  }
  return { url, mimeType: mimeType as RecipeStepVideoMime, width };
}

function derivativeList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return Object.values(value);
  return [];
}

function parseByteRangeHeader(header: string, size: number): RecipeStepVideoByteRange | null {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    !/^bytes=/i.test(header) ||
    header.includes(',')
  ) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (!startText && !endText) return null;

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    end = size - 1;
    start = Math.max(0, size - Math.min(suffixLength, MAX_RECIPE_STEP_VIDEO_RANGE_BYTES));
  } else {
    start = Number(startText);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;
    const requestedEnd = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
    end = Math.min(requestedEnd, size - 1, start + MAX_RECIPE_STEP_VIDEO_RANGE_BYTES - 1);
  }
  return end >= start ? { start, end } : null;
}

function parseContentRange(value: string | null): ByteRangeResponse | null {
  const match = value ? /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(value.trim()) : null;
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    return null;
  }
  return { start, end, total };
}

function throwAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

export function createRecipeStepVideoProvider(
  options: RecipeStepVideoProviderOptions = {}
): RecipeStepVideoProvider {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const cachedVideos = new Map<string, CachedVideo>();
  const cachedScenes = new Map<RecipeStepVideoScene, CachedScene>();
  const pendingScenes = new Map<RecipeStepVideoScene, Promise<RecipeStepVideo[]>>();
  let activeStreams = 0;

  async function requestJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const response = await fetcher(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Api-User-Agent': USER_AGENT,
          'User-Agent': USER_AGENT
        },
        redirect: 'error',
        signal: controller.signal
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Commons HTTP ${response.status}`);
      }
      return await readBoundedJson(response, MAX_JSON_BYTES);
    } catch (error) {
      if (didTimeout) throw new Error('Commons request timed out');
      if (signal?.aborted) throw throwAbortError();
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  function getVideo(id: string): RecipeStepVideo | null {
    if (!/^[a-f0-9]{24}$/.test(id)) return null;
    const cached = cachedVideos.get(id);
    if (!cached || cached.expiresAt <= now()) {
      cachedVideos.delete(id);
      return null;
    }
    return cached.video;
  }

  function getSelectedVideo(id: string): RecipeStepVideoSelection | null {
    const video = getVideo(id);
    const cached = cachedVideos.get(id);
    return video && cached ? { ...video, mediaUrl: cached.mediaUrl } : null;
  }

  function parseVideo(
    page: unknown,
    details: unknown
  ): { video: RecipeStepVideo; mediaUrl: string } | null {
    if (!isRecord(page) || !isRecord(details)) return null;
    const pageTitle = typeof page.title === 'string' ? page.title : '';
    const fileTitle = pageTitle.startsWith('File:') ? pageTitle : '';
    const videoInfo = getJsonArray(page.videoinfo)[0];
    if (!fileTitle || !isRecord(videoInfo)) return null;
    const sourceUrl = safeHttpsUrl(videoInfo.descriptionurl, COMMONS_HOSTS);
    if (!sourceUrl || !new URL(sourceUrl).pathname.startsWith('/wiki/File:')) return null;

    const detailTitle = typeof details.title === 'string' ? details.title : '';
    if (detailTitle && detailTitle !== fileTitle && detailTitle !== fileTitle.slice(5)) return null;
    const preferred = details.preferred;
    const thumbnail = details.thumbnail;
    if (!isRecord(preferred) || !isRecord(thumbnail)) return null;
    if (preferred.mediatype !== 'VIDEO' && preferred.mediatype !== 'MULTIMEDIA') return null;
    if (!isRecord(thumbnail) || thumbnail.mediatype !== 'BITMAP') return null;

    const durationSeconds = Number(preferred.duration);
    const sizeBytes = Number(preferred.size);
    if (
      !Number.isSafeInteger(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > MAX_RECIPE_STEP_VIDEO_DURATION_SECONDS ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_RECIPE_STEP_VIDEO_BYTES
    ) {
      return null;
    }

    const preferredUrl = safeMediaUrl(preferred.url);
    const thumbnailUrl = safeThumbnailUrl(videoInfo.thumburl) ?? safeThumbnailUrl(thumbnail.url);
    if (!preferredUrl || !thumbnailUrl) return null;

    const derivatives = derivativeList(videoInfo.derivatives)
      .map(parseDerivative)
      .filter((value): value is NonNullable<typeof value> => value !== null);
    const preferredMime = derivatives.find((item) => item.url === preferredUrl)?.mimeType;
    if (!preferredMime) return null;

    const metadata = videoInfo.extmetadata;
    const author = plainText(metadataValue(metadata, 'Artist'), 180);
    const licenseName = plainText(metadataValue(metadata, 'LicenseShortName'), 80);
    const licenseUrl = safeLicenseUrl(metadataValue(metadata, 'LicenseUrl'));
    const title = plainText(fileTitle.slice(5), 180);
    if (
      !title ||
      !author ||
      /^(unknown|anonymous|not provided|unspecified)$/i.test(author) ||
      !licenseName ||
      !licenseUrl
    ) {
      return null;
    }

    const id = createHash('sha256').update(preferredUrl).digest('hex').slice(0, 24);
    return {
      video: {
        id,
        title,
        author,
        licenseName,
        licenseUrl,
        sourceUrl,
        thumbnailUrl,
        durationSeconds,
        sizeBytes,
        mimeType: preferredMime
      },
      mediaUrl: preferredUrl
    };
  }

  async function searchScene(
    scene: RecipeStepVideoScene,
    signal?: AbortSignal
  ): Promise<RecipeStepVideo[]> {
    const searchUrl = new URL(COMMONS_API_URL);
    searchUrl.search = new URLSearchParams({
      action: 'query',
      list: 'search',
      srnamespace: '6',
      srsearch: `${SCENE_QUERIES[scene]} filetype:video`,
      srlimit: String(MAX_SEARCH_HITS),
      format: 'json',
      formatversion: '2'
    }).toString();
    const searchData = await requestJson(searchUrl.href, signal);
    if (!isRecord(searchData) || !isRecord(searchData.query)) {
      throw new Error('Invalid Commons search response');
    }
    const searchHits = getJsonArray(searchData.query.search)
      .filter(isRecord)
      .map((hit) => hit.title)
      .filter(
        (title): title is string => typeof title === 'string' && /^File:.{1,240}$/.test(title)
      )
      .slice(0, MAX_VIDEO_CANDIDATES);
    if (searchHits.length === 0) return [];

    const detailsUrl = new URL(COMMONS_API_URL);
    detailsUrl.search = new URLSearchParams({
      action: 'query',
      prop: 'videoinfo',
      titles: searchHits.join('|'),
      viprop: 'url|mime|size|extmetadata|thumburls|derivatives',
      viextmetadatalanguage: 'en',
      viextmetadatamultilang: '0',
      viurlwidth: '480',
      format: 'json',
      formatversion: '2'
    }).toString();
    const detailsData = await requestJson(detailsUrl.href, signal);
    if (!isRecord(detailsData) || !isRecord(detailsData.query)) {
      throw new Error('Invalid Commons video metadata response');
    }
    const pages = getJsonArray(detailsData.query.pages).filter(isRecord);

    const videos = await Promise.all(
      pages.slice(0, MAX_VIDEO_CANDIDATES).map(async (page) => {
        const title = typeof page.title === 'string' ? page.title : '';
        if (!/^File:.{1,240}$/.test(title)) return null;
        const fileUrl = `${COMMONS_REST_FILE_URL}${encodeURIComponent(title)}`;
        const details = await requestJson(fileUrl, signal);
        return parseVideo(page, details);
      })
    );

    const found: RecipeStepVideo[] = [];
    for (const candidate of videos) {
      if (!candidate || found.some((video) => video.id === candidate.video.id)) continue;
      found.push(candidate.video);
      cachedVideos.set(candidate.video.id, {
        video: candidate.video,
        mediaUrl: candidate.mediaUrl,
        expiresAt: now() + VIDEO_CACHE_TTL_MS
      });
    }
    while (cachedVideos.size > MAX_CACHED_VIDEOS) {
      const oldestId = cachedVideos.keys().next().value;
      if (!oldestId) break;
      cachedVideos.delete(oldestId);
    }
    return found;
  }

  async function search(
    sceneValue: RecipeStepVideoScene,
    signal?: AbortSignal
  ): Promise<RecipeStepVideo[]> {
    if (!isScene(sceneValue)) throw new Error('Unknown recipe step video scene');
    if (signal?.aborted) return [];

    const cached = cachedScenes.get(sceneValue);
    if (cached && cached.expiresAt > now()) return cached.videos;
    let pending = signal ? undefined : pendingScenes.get(sceneValue);
    if (!pending) {
      pending = searchScene(sceneValue, signal);
      if (!signal) pendingScenes.set(sceneValue, pending);
    }
    try {
      const videos = await pending;
      cachedScenes.set(sceneValue, {
        videos,
        expiresAt: now() + (videos.length ? SCENE_CACHE_TTL_MS : EMPTY_SCENE_CACHE_TTL_MS)
      });
      return videos;
    } finally {
      if (!signal && pendingScenes.get(sceneValue) === pending) pendingScenes.delete(sceneValue);
    }
  }

  async function openStream(
    id: string,
    range: RecipeStepVideoByteRange,
    signal?: AbortSignal
  ): Promise<RecipeStepVideoStream | null> {
    const selection = getSelectedVideo(id);
    return selection ? openStoredStream(selection, range, signal) : null;
  }

  async function openStoredStream(
    selection: RecipeStepVideoSelection,
    range: RecipeStepVideoByteRange,
    signal?: AbortSignal
  ): Promise<RecipeStepVideoStream | null> {
    if (!isValidRecipeStepVideoSelection(selection)) return null;
    const mediaUrl = safeMediaUrl(selection.mediaUrl)!;
    const video = selection;
    if (
      !Number.isSafeInteger(range.start) ||
      !Number.isSafeInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end >= video.sizeBytes ||
      range.end - range.start + 1 > MAX_RECIPE_STEP_VIDEO_RANGE_BYTES
    ) {
      throw new Error('Invalid video range');
    }
    if (activeStreams >= MAX_CONCURRENT_STREAMS) throw new Error('Too many active video streams');
    if (signal?.aborted) throw throwAbortError();

    activeStreams += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeStreams = Math.max(0, activeStreams - 1);
    };
    const controller = new AbortController();
    let didTimeout = false;
    const connectTimer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });

    let upstream: Response;
    try {
      upstream = await fetcher(mediaUrl, {
        method: 'GET',
        headers: {
          Accept: video.mimeType,
          'Accept-Encoding': 'identity',
          Range: `bytes=${range.start}-${range.end}`,
          'Api-User-Agent': USER_AGENT,
          'User-Agent': USER_AGENT
        },
        redirect: 'error',
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(connectTimer);
      signal?.removeEventListener('abort', abortFromCaller);
      release();
      if (didTimeout) throw new Error('Video source timed out');
      if (signal?.aborted) throw throwAbortError();
      throw error;
    }
    clearTimeout(connectTimer);

    const contentType = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    const contentRange = parseContentRange(upstream.headers.get('content-range'));
    const expectedLength = range.end - range.start + 1;
    const declaredLength = Number(upstream.headers.get('content-length') ?? '');
    const contentEncoding = upstream.headers.get('content-encoding');
    const validResponse =
      upstream.status === 206 &&
      contentType === video.mimeType &&
      contentRange?.start === range.start &&
      contentRange.end === range.end &&
      contentRange.total === video.sizeBytes &&
      expectedLength > 0 &&
      expectedLength <= MAX_RECIPE_STEP_VIDEO_RANGE_BYTES &&
      (!Number.isFinite(declaredLength) || declaredLength === expectedLength) &&
      (!contentEncoding || contentEncoding.toLowerCase() === 'identity') &&
      upstream.body !== null;
    if (!validResponse) {
      await upstream.body?.cancel();
      signal?.removeEventListener('abort', abortFromCaller);
      release();
      throw new Error('Invalid video byte-range response');
    }

    const upstreamReader = upstream.body!.getReader();
    let streamedBytes = 0;
    let ended = false;
    const output = new ReadableStream<Uint8Array>(
      {
        async pull(outputController) {
          if (ended) return;
          let idleTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            const readResult = await Promise.race([
              upstreamReader.read(),
              new Promise<never>((_, reject) => {
                idleTimer = setTimeout(() => {
                  controller.abort();
                  reject(new Error('Video source stalled'));
                }, STREAM_IDLE_TIMEOUT_MS);
              })
            ]);
            if (idleTimer) clearTimeout(idleTimer);
            if (readResult.done) {
              ended = true;
              if (streamedBytes !== expectedLength) {
                throw new Error('Incomplete video byte range');
              }
              signal?.removeEventListener('abort', abortFromCaller);
              release();
              outputController.close();
              return;
            }
            streamedBytes += readResult.value.byteLength;
            if (
              streamedBytes > expectedLength ||
              streamedBytes > MAX_RECIPE_STEP_VIDEO_RANGE_BYTES
            ) {
              throw new Error('Video byte range exceeded its limit');
            }
            outputController.enqueue(readResult.value);
          } catch (error) {
            if (idleTimer) clearTimeout(idleTimer);
            ended = true;
            controller.abort();
            await upstreamReader.cancel().catch(() => undefined);
            signal?.removeEventListener('abort', abortFromCaller);
            release();
            outputController.error(error);
          }
        },
        async cancel(reason) {
          if (ended) return;
          ended = true;
          controller.abort();
          await upstreamReader.cancel(reason).catch(() => undefined);
          signal?.removeEventListener('abort', abortFromCaller);
          release();
        }
      },
      { highWaterMark: 0 }
    );

    return {
      body: output,
      mimeType: video.mimeType,
      contentRange: upstream.headers.get('content-range')!,
      contentLength: expectedLength
    };
  }

  return { search, getVideo, getSelectedVideo, openStream, openStoredStream };
}

export const recipeStepVideoProvider = createRecipeStepVideoProvider();

export function parseRecipeStepVideoRange(
  header: string | null,
  sizeBytes: number
): RecipeStepVideoByteRange | null {
  return header ? parseByteRangeHeader(header, sizeBytes) : null;
}
