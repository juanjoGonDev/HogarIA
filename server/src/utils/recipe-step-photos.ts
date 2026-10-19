import { createHash } from 'node:crypto';

export const RECIPE_STEP_PHOTO_SCENES = [
  'wash',
  'cut',
  'mix',
  'cook',
  'bake',
  'rest',
  'serve',
  'prepare'
] as const;

export type RecipeStepPhotoScene = (typeof RECIPE_STEP_PHOTO_SCENES)[number];

export interface RecipeStepPhoto {
  id: string;
  altText: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
  /** Validated Wikimedia thumbnail URL; persisted candidates can still preview after a restart. */
  thumbnailUrl?: string;
}

export interface RecipeStepPhotoImage {
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface RecipeStepPhotoProvider {
  search(scene: RecipeStepPhotoScene): Promise<RecipeStepPhoto | null>;
  searchByQuery(query: string, signal?: AbortSignal): Promise<RecipeStepPhoto[]>;
  getPhoto(id: string): RecipeStepPhoto | null;
  getImage(id: string): Promise<RecipeStepPhotoImage | null>;
  getImageFromUrl?(url: string): Promise<RecipeStepPhotoImage | null>;
}

export interface RecipeStepPhotoProviderOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const SEARCH_QUERY: Record<RecipeStepPhotoScene, string> = {
  wash: 'photo washing fresh vegetables kitchen sink',
  cut: 'photo chopping vegetables cutting board knife',
  mix: 'photo mixing ingredients bowl cooking',
  cook: 'photo cooking food pan stovetop',
  bake: 'photo baking food oven tray',
  rest: 'photo resting cooked food covered dish',
  serve: 'photo plated home cooked meal serving',
  prepare: 'photo preparing ingredients kitchen counter'
};

const USER_AGENT =
  'HogarIA/1.0 (+https://github.com/juanjoGonDev/MiCocinAI; local cooking recipe photo search)';
const API_URL = 'https://commons.wikimedia.org/w/api.php';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 15 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 5000;
const MAX_API_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_CACHED_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_IMAGES = 32;
const RASTER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SEARCH_QUERY_LENGTH = 80;
const MAX_QUERY_RESULTS = 10;
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
const IMAGE_HOSTS = new Set(['thumb.wikimedia.org', 'upload.wikimedia.org']);

type CommonsExtMetadata = { value?: unknown };

interface CachedScene {
  photo: RecipeStepPhoto | null;
  expiresAt: number;
}

interface CachedSourceImage {
  url: string;
  mimeType: RecipeStepPhotoImage['mimeType'];
  expiresAt: number;
}

interface CachedImageBytes extends RecipeStepPhotoImage {
  expiresAt: number;
}

function isScene(value: string): value is RecipeStepPhotoScene {
  return (RECIPE_STEP_PHOTO_SCENES as readonly string[]).includes(value);
}

function safeHttpsUrl(value: unknown, allowedHosts: ReadonlySet<string>): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !allowedHosts.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const hex = code[1]?.toLowerCase() === 'x';
    const parsed = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0x10ffff) return '';
    try {
      return String.fromCodePoint(parsed);
    } catch {
      return '';
    }
  });
}

function plainMetadata(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  const withoutExecutableBlocks = value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const withoutTags = withoutExecutableBlocks.replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(withoutTags)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function metadataValue(metadata: Record<string, CommonsExtMetadata>, key: string): unknown {
  return metadata[key]?.value;
}

async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error('Upstream response too large');
  }

  if (!response.body) return new Uint8Array(await response.arrayBuffer()).slice(0, limit + 1);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error('Upstream response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asExtMetadata(value: unknown): Record<string, CommonsExtMetadata> {
  if (!isRecord(value)) return {};
  return value as Record<string, CommonsExtMetadata>;
}

function safePhotoFromApi(value: unknown, pageTitle: string, id: string): {
  photo: RecipeStepPhoto;
  sourceImage: CachedSourceImage;
} | null {
  if (!isRecord(value)) return null;
  const mime = typeof value.mime === 'string' ? value.mime.toLowerCase() : '';
  if (!RASTER_MIME_TYPES.has(mime)) return null;

  const thumbUrl = safeHttpsUrl(value.thumburl, IMAGE_HOSTS);
  const sourceUrl = safeHttpsUrl(value.descriptionurl, new Set(['commons.wikimedia.org']));
  if (!thumbUrl || !sourceUrl) return null;

  const metadata = asExtMetadata(value.extmetadata);
  const author = plainMetadata(metadataValue(metadata, 'Artist'), 180);
  const licenseName = plainMetadata(metadataValue(metadata, 'LicenseShortName'), 80);
  const licenseUrl = safeHttpsUrl(metadataValue(metadata, 'LicenseUrl'), LICENSE_HOSTS);
  const description =
    plainMetadata(metadataValue(metadata, 'ObjectName'), 180) ||
    plainMetadata(metadataValue(metadata, 'ImageDescription'), 180);
  const contentDescription = `${pageTitle} ${description}`;
  if (
    !author ||
    /^(unknown|anonymous|not provided|unspecified)$/i.test(author) ||
    !licenseName ||
    !licenseUrl ||
    /\b(drawing|illustration|diagram|vector|clip.?art|icon|graphic|infographic)\b/i.test(
      contentDescription
    )
  ) {
    return null;
  }

  return {
    photo: {
      id,
      altText: description || 'Fotografía real de una técnica de cocina.',
      author,
      licenseName,
      licenseUrl,
      sourceUrl,
      thumbnailUrl: thumbUrl
    },
    sourceImage: {
      url: thumbUrl,
      mimeType: mime as CachedSourceImage['mimeType'],
      expiresAt: 0
    }
  };
}

function checkImageMime(value: string | null): RecipeStepPhotoImage['mimeType'] | null {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  return mime && RASTER_MIME_TYPES.has(mime) ? (mime as RecipeStepPhotoImage['mimeType']) : null;
}

function hasRasterSignature(bytes: Uint8Array, mimeType: RecipeStepPhotoImage['mimeType']): boolean {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte
    );
  }
  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  );
}

export function createRecipeStepPhotoProvider(
  options: RecipeStepPhotoProviderOptions = {}
): RecipeStepPhotoProvider {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const scenes = new Map<RecipeStepPhotoScene, CachedScene>();
  const sourceImages = new Map<string, CachedSourceImage>();
  const photos = new Map<string, { photo: RecipeStepPhoto; expiresAt: number }>();
  const imageBytes = new Map<string, CachedImageBytes>();
  const pendingImageBytes = new Map<string, Promise<RecipeStepPhotoImage>>();
  const pendingScenes = new Map<RecipeStepPhotoScene, Promise<RecipeStepPhoto | null>>();

  async function request(
    url: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<{ response: Response; bytes: Uint8Array }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const response = await fetcher(url, {
        headers: { 'Api-User-Agent': USER_AGENT, 'User-Agent': USER_AGENT },
        redirect: 'error',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Wikimedia request failed (${response.status})`);
      const bytes = await readBoundedBody(response, limit);
      if (bytes.byteLength > limit) throw new Error('Upstream response too large');
      return { response, bytes };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  async function searchCommons(
    query: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<RecipeStepPhoto[]> {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: String(limit),
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '800',
      format: 'json',
      formatversion: '2'
    }).toString();

    const { response, bytes } = await request(url.href, MAX_API_BYTES, signal);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new Error('Invalid Wikimedia response type');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('Invalid Wikimedia response');
    }
    if (!isRecord(parsed) || !isRecord(parsed.query) || !Array.isArray(parsed.query.pages)) {
      throw new Error('Invalid Wikimedia response');
    }

    const found: RecipeStepPhoto[] = [];
    for (const page of parsed.query.pages) {
      if (found.length >= limit) break;
      if (!isRecord(page) || !Array.isArray(page.imageinfo)) continue;
      const imageInfo = page.imageinfo[0];
      if (!isRecord(imageInfo)) continue;
      const stableId = createHash('sha256')
        .update(String(imageInfo.thumburl ?? ''))
        .digest('hex')
        .slice(0, 24);
      if (!stableId || /^0+$/.test(stableId)) continue;
      const validated = safePhotoFromApi(imageInfo, String(page.title ?? ''), stableId);
      if (!validated) continue;
      found.push(validated.photo);
      photos.set(stableId, { photo: validated.photo, expiresAt: now() + CACHE_TTL_MS });
      sourceImages.set(stableId, { ...validated.sourceImage, expiresAt: now() + CACHE_TTL_MS });
      while (sourceImages.size > MAX_SOURCE_IMAGES) {
        const oldestId = sourceImages.keys().next().value;
        if (!oldestId) break;
        sourceImages.delete(oldestId);
        imageBytes.delete(oldestId);
      }
    }

    return found;
  }

  function normalizeQuery(value: string): string {
    if (typeof value !== 'string') throw new Error('Invalid recipe photo query');
    const query = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (query.length < 2 || query.length > MAX_SEARCH_QUERY_LENGTH) {
      throw new Error('Invalid recipe photo query');
    }
    return query;
  }

  async function searchScene(scene: RecipeStepPhotoScene): Promise<RecipeStepPhoto | null> {
    if (!isScene(scene)) throw new Error('Unknown recipe photo scene');
    const cached = scenes.get(scene);
    if (cached && cached.expiresAt > now()) return cached.photo;

    const [found] = await searchCommons(SEARCH_QUERY[scene], 5);

    scenes.set(scene, {
      photo: found ?? null,
      expiresAt: now() + (found ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS)
    });
    return found ?? null;
  }

  async function search(scene: RecipeStepPhotoScene): Promise<RecipeStepPhoto | null> {
    if (!isScene(scene)) throw new Error('Unknown recipe photo scene');
    const cached = scenes.get(scene);
    if (cached && cached.expiresAt > now()) return cached.photo;

    let pending = pendingScenes.get(scene);
    if (!pending) {
      pending = searchScene(scene);
      pendingScenes.set(scene, pending);
    }
    try {
      return await pending;
    } finally {
      if (pendingScenes.get(scene) === pending) pendingScenes.delete(scene);
    }
  }

  async function searchByQuery(queryValue: string, signal?: AbortSignal): Promise<RecipeStepPhoto[]> {
    const query = normalizeQuery(queryValue);
    if (signal?.aborted) return [];
    const result = await searchCommons(query, MAX_QUERY_RESULTS, signal);
    return signal?.aborted ? [] : result;
  }

  function getPhoto(id: string): RecipeStepPhoto | null {
    if (!/^[a-f0-9]{24}$/.test(id)) return null;
    const cached = photos.get(id);
    if (!cached || cached.expiresAt <= now()) {
      photos.delete(id);
      sourceImages.delete(id);
      imageBytes.delete(id);
      return null;
    }
    return cached.photo;
  }

  async function fetchImageBytes(id: string): Promise<RecipeStepPhotoImage> {
    const source = sourceImages.get(id);
    if (!source || source.expiresAt <= now()) throw new Error('Recipe step photo expired');
    const { response, bytes } = await request(source.url, MAX_IMAGE_BYTES);
    const mimeType = checkImageMime(response.headers.get('content-type'));
    if (!mimeType || mimeType !== source.mimeType || !hasRasterSignature(bytes, mimeType)) {
      throw new Error('Invalid recipe step photo image');
    }
    return { bytes, mimeType };
  }

  async function getImageFromUrl(urlValue: string): Promise<RecipeStepPhotoImage | null> {
    const url = safeHttpsUrl(urlValue, IMAGE_HOSTS);
    if (!url) return null;
    const { response, bytes } = await request(url, MAX_IMAGE_BYTES);
    const mimeType = checkImageMime(response.headers.get('content-type'));
    if (!mimeType || !hasRasterSignature(bytes, mimeType)) {
      throw new Error('Invalid recipe step photo image');
    }
    return { bytes, mimeType };
  }

  async function getImage(id: string): Promise<RecipeStepPhotoImage | null> {
    if (!/^[a-f0-9]{24}$/.test(id)) return null;
    const cached = imageBytes.get(id);
    if (cached && cached.expiresAt > now()) return { bytes: cached.bytes, mimeType: cached.mimeType };
    if (cached) imageBytes.delete(id);

    let pending = pendingImageBytes.get(id);
    if (!pending) {
      pending = fetchImageBytes(id);
      pendingImageBytes.set(id, pending);
    }
    try {
      const image = await pending;
      imageBytes.set(id, { ...image, expiresAt: now() + CACHE_TTL_MS });
      let total = [...imageBytes.values()].reduce((size, item) => size + item.bytes.byteLength, 0);
      for (const [oldestId, oldest] of imageBytes) {
        if (total <= MAX_CACHED_IMAGE_BYTES) break;
        imageBytes.delete(oldestId);
        total -= oldest.bytes.byteLength;
      }
      return image;
    } finally {
      pendingImageBytes.delete(id);
    }
  }

  return { search, searchByQuery, getPhoto, getImage, getImageFromUrl };
}

export const recipeStepPhotoProvider = createRecipeStepPhotoProvider();
