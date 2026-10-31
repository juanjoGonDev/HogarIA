import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * El middleware global de la app: limitador, claves y estaticos.
 *
 * No habia tests porque no se podian escribir: el `index.ts` montaba el middleware Y
 * abria el puerto, asi que probar el limitador era levantar un servidor. Nada de esto
 * estaba cubierto, y es la capa que decidio que «toda la casa» se quedara sin poder
 * navegar —y sin ver los logs— porque un navegador entraba en bucle: los cubos eran
 * compartidos por IP, los diagnosticos consumian el mismo cupo que el negocio, y el 429
 * no decia cuando se puede volver.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

// El tipo real, no un `App` inventado: lo que se quiere comprobar es el `request` de
// Hono, y reimplementarselo por cuenta propia es la forma de que el test se equivoque
// antes que la app.
type App = Awaited<ReturnType<typeof import('./app.js').createApp>>;

let createApp: (options?: {
  rateLimit?: { windowMs: number; limit: number } | null;
  staticDir?: string | null;
}) => App;
let isRateLimitExempt: (pathname: string) => boolean;
let rateLimitKey: (
  authorization: string | undefined,
  forwarded: string | undefined,
  realIp: string | undefined
) => string;
let resolveStaticAsset: (staticDir: string, pathname: string) => string | null;
let resolveStaticDir: (env: Record<string, string | undefined>, base?: string) => string | null;
let retryAfterSeconds: (windowMs: number, resetHeader: string | null) => number;
let rateLimitFromEnv: (
  env: Record<string, string | undefined>
) => { windowMs: number; limit: number } | null;
let getLogs: (options?: { limit?: number; level?: string }) => { message: string }[];
let clearLogs: () => void;
let installConsoleCapture: () => void;

beforeAll(async () => {
  const appModule = await import('./app.js');
  createApp = appModule.createApp;
  isRateLimitExempt = appModule.isRateLimitExempt;
  rateLimitKey = appModule.rateLimitKey;
  resolveStaticAsset = appModule.resolveStaticAsset;
  resolveStaticDir = appModule.resolveStaticDir;
  retryAfterSeconds = appModule.retryAfterSeconds;
  rateLimitFromEnv = appModule.rateLimitFromEnv;

  const store = await import('./utils/log-store.js');
  getLogs = store.getLogs;
  clearLogs = store.clearLogs;
  installConsoleCapture = store.installConsoleCapture;
});

beforeEach(() => clearLogs());
afterEach(() => {
  process.env.PUBLIC_DIR = '';
});

describe('que no consume cupo', () => {
  it('los diagnosticos y los stream estan fuera', () => {
    // Bloquear el visor de logs mientras se diagnostica un atasco es la forma mas
    // eficaz de dejar al usuario sin la unica pista que tiene.
    expect(isRateLimitExempt('/api/logs')).toBe(true);
    expect(isRateLimitExempt('/api/logs/stream')).toBe(true);
    expect(isRateLimitExempt('/api/health')).toBe(true);
    expect(isRateLimitExempt('/health')).toBe(true);
    // Una conexion SSE viva no son 300 peticiones: es una.
    expect(isRateLimitExempt('/api/shopping/stream/lists/abc')).toBe(true);
    expect(isRateLimitExempt('/api/uploads/avatars/u-ana-1a2b3c.png')).toBe(true);
    expect(isRateLimitExempt('/api/uploads/avatars')).toBe(true);
    expect(isRateLimitExempt('/api/logs-x')).toBe(false);
    // La excepcion es del carpetillo de ficheros, no del resto de la API.
    expect(isRateLimitExempt('/api/uploads-x')).toBe(false);
    expect(isRateLimitExempt('/api/shopping/lists')).toBe(false);
  });

  it('un cubo para cada sesion en vez de uno para toda la casa', () => {
    // Con `x-forwarded-for` ausente (proxy sin cabeceras, preview, docker sin nginx)
    // todo el mundo caia en `'unknown'`: un navegador en bucle dejaba fuera a la casa
    // entera. Con sesion, cada usuario tiene su cupo.
    const key = (auth?: string, forwarded?: string) => rateLimitKey(auth, forwarded, undefined);
    expect(key('Bearer aaaaaa111111bbbbbb')).toMatch(/^session:[0-9a-z]{1,7}$/);
    expect(key('Bearer aaaaaa111111bbbbbb')).toBe(key('Bearer aaaaaa111111bbbbbb'));
    expect(key('Bearer cccccc222222dddddd')).not.toBe(key('Bearer aaaaaa111111bbbbbb'));
    expect(key(undefined, '203.0.113.5, 70.41.3.38')).toBe('ip:203.0.113.5');
    expect(key(undefined, undefined)).toBe('ip:unknown');
  });
});

describe('el 429', () => {
  it('dice cuando se puede volver', () => {
    expect(retryAfterSeconds(60_000, '34')).toBe(34);
    expect(retryAfterSeconds(60_000, null)).toBe(60);
    expect(retryAfterSeconds(1500, 'nope')).toBe(2);
  });

  it('llega despues del umbral, con reintentar y con aviso en el visor', async () => {
    installConsoleCapture();
    const app = createApp({ rateLimit: { windowMs: 60_000, limit: 2 } });

    const first = await app.request('/api/esto-no-existe');
    const second = await app.request('/api/esto-no-existe');
    expect(first.status).toBe(404);
    expect(second.status).toBe(404);

    const third = await app.request('/api/esto-no-existe');
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await third.json()) as { error?: string; message?: string };
    // Un 429 con cuerpo vacio es un toast con «Ha ocurrido un error inesperado»: el
    // usuario no sabe que espere ni que no ha roto nada.
    expect(body.error).toBe('Too Many Requests');
    expect(body.message).toMatch(/espera/i);

    // Y se ve en `/logs` sin tener que entrar al contenedor.
    const warn = getLogs({ limit: 50 }).some((entry) => entry.message.includes('rate-limit'));
    expect(warn, 'el aviso del limitador debe llegar al almacen de logs').toBe(true);
  });

  it('no castiga a quien solo queria ver los logs', async () => {
    const app = createApp({ rateLimit: { windowMs: 60_000, limit: 1 } });
    for (let i = 0; i < 6; i += 1) {
      const response = await app.request('/api/logs?limit=20');
      // Exento: el status que sea del endpoint, pero NUNCA 429.
      expect(response.status, `peticion ${i}`).not.toBe(429);
    }
  });

  it('dos sesiones no comparten el cubo', async () => {
    const app = createApp({ rateLimit: { windowMs: 60_000, limit: 2 } });
    const as = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

    expect((await app.request('/api/uno', as('aaaaaa111111bbbbbb'))).status).toBe(404);
    expect((await app.request('/api/dos', as('aaaaaa111111bbbbbb'))).status).toBe(404);
    expect((await app.request('/api/tres', as('aaaaaa111111bbbbbb'))).status).toBe(429);
    // La otra sesion sigue pudiendo: si esto compartiera cubo, el companero de casa
    // se queda fuera por culpa de un bucle que no es suyo.
    expect((await app.request('/api/uno', as('cccccc222222dddddd'))).status).toBe(404);
  });
});

describe('estaticos', () => {
  let dir = '';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'hogaria-static-'));
    writeFileSync(join(dir, 'index.html'), '<html><body>hogaria</body></html>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'logo.svg'), '<svg/>');
    writeFileSync(join(dir, 'main-ABCDEFGH.js'), 'console.log(1)');
    writeFileSync(join(dir, 'main.js'), 'console.log(1)');
    writeFileSync(join(dir, 'manifest.json'), '{}');
    writeFileSync(join(dir, 'ngsw.json'), '{}');
    writeFileSync(join(dir, 'ngsw-worker.js'), '/* service worker */');
    writeFileSync(join(dir, 'safety-worker.js'), '/* safety worker */');
    mkdirSync(join(dir, 'deep'));
    writeFileSync(join(dir, 'deep', 'index.html'), '<html>deep</html>');
  });

  it('sirve el fichero, la SPA y nada fuera de la raiz', () => {
    expect(resolveStaticAsset(dir, '/')).toBe(join(dir, 'index.html'));
    expect(resolveStaticAsset(dir, '/main-ABCDEFGH.js')).toBe(join(dir, 'main-ABCDEFGH.js'));
    expect(resolveStaticAsset(dir, '/assets/logo.svg')).toBe(join(dir, 'assets', 'logo.svg'));
    expect(resolveStaticAsset(dir, '/deep')).toBe(join(dir, 'deep', 'index.html'));
    // Ruta de aplicacion: la resuelve el enrutador del navegador, asi que toca index.html.
    expect(resolveStaticAsset(dir, '/shopping/abc-123')).toBe(join(dir, 'index.html'));
    // Un asset que no esta es un 404, no HTML: si el JS se transforma en un documento,
    // el navegador dice «Unexpected token '<'» y la pantalla se queda en blanco.
    expect(resolveStaticAsset(dir, '/no-existe.js')).toBeNull();
    expect(resolveStaticAsset(dir, '/../etc/passwd')).toBeNull();
    expect(resolveStaticAsset(dir, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveStaticAsset(dir, '/index.html%00.png')).toBeNull();
  });

  it('no almacena recursos sin hash y reserva cache inmutable a bundles con hash', async () => {
    const app = createApp({ rateLimit: null, staticDir: dir });

    for (const path of [
      '/',
      '/index.html',
      '/ruta-spa',
      '/manifest.json',
      '/ngsw.json',
      '/ngsw-worker.js',
      '/safety-worker.js',
      '/main.js',
      '/assets/logo.svg'
    ]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path).toBe(
        'no-cache, no-store, must-revalidate'
      );
    }

    const hashedBundle = await app.request('/main-ABCDEFGH.js');
    expect(hashedBundle.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('configura Nginx para no cachear recursos sin hash y reservar immutable a los hash', () => {
    const config = readFileSync(new URL('../../nginx/nginx.conf', import.meta.url), 'utf8');

    for (const path of [
      '/index.html',
      '/ngsw.json',
      '/ngsw-worker.js',
      '/safety-worker.js',
      '/manifest.json'
    ]) {
      const escapedPath = path.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
      const location = new RegExp(
        `location = ${escapedPath}\\s*\\{[^}]*Cache-Control \\"no-cache, no-store, must-revalidate\\" always;[^}]*\\}`,
        's'
      );
      expect(config, `nginx location ${path}`).toMatch(location);
    }
    expect(config).toContain(String.raw`location ~* "-[a-z0-9_-]{8,}\.(js|css|png`);
    expect(config).not.toContain(String.raw`location ~* \.(js|css|png`);
  });

  it('conserva cabeceras de seguridad en cada location que sobrescribe Cache-Control', () => {
    const config = readFileSync(new URL('../../nginx/nginx.conf', import.meta.url), 'utf8');
    const cacheLocations = config
      .split(/^\s*location\s+/m)
      .slice(1)
      .map((location) => location.split(/\n\s*}\s*/)[0] ?? '')
      .filter((body) => /add_header\s+Cache-Control\b/.test(body));

    expect(cacheLocations).toHaveLength(7);
    for (const body of cacheLocations) {
      expect(body).toMatch(/add_header\s+X-Frame-Options\s+"SAMEORIGIN"\s+always;/);
      expect(body).toMatch(/add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/);
    }
  });

  it('encuentra el dist donde cada uno lo tiene', () => {
    const root = mkdtempSync(join(tmpdir(), 'hogaria-layout-'));
    mkdirSync(join(root, 'public', 'browser'), { recursive: true });
    writeFileSync(join(root, 'public', 'browser', 'index.html'), '<html/>');

    expect(resolveStaticDir({}, root)).toBe(join(root, 'public', 'browser'));
    expect(resolveStaticDir({ PUBLIC_DIR: '/algo/fijo' }, root)).toBe('/algo/fijo');
    // Sin index.html en ninguna forma conocida, API puro: mejor un 404 honesto que
    // un server de estaticos apuntando a una carpeta vacia.
    expect(resolveStaticDir({}, mkdtempSync(join(tmpdir(), 'hogaria-empty-')))).toBeNull();
  });

  it('no almacena recursos sin hash y reserva cache inmutable a los hash', async () => {
    const app = createApp({ rateLimit: null, staticDir: dir });
    const paths = [
      '/',
      '/index.html',
      '/shopping/abc-123',
      '/manifest.json',
      '/ngsw.json',
      '/ngsw-worker.js',
      '/safety-worker.js',
      '/main.js',
      '/assets/logo.svg'
    ];

    for (const path of paths) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path).toBe(
        'no-cache, no-store, must-revalidate'
      );
    }

    const hashedChunk = await app.request('/main-ABCDEFGH.js');
    expect(hashedChunk.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('configura nginx para revalidar el shell/manifest y conservar las cabeceras de seguridad', () => {
    const config = readFileSync(new URL('../../nginx/nginx.conf', import.meta.url), 'utf8');
    const paths = [
      '/index.html',
      '/ngsw.json',
      '/ngsw-worker.js',
      '/safety-worker.js',
      '/manifest.json'
    ];

    for (const path of paths) {
      const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const location = new RegExp(
        `location = ${escapedPath}\\s*\\{[^}]*Cache-Control \\"no-cache, no-store, must-revalidate\\" always;[^}]*\\}`,
        's'
      );
      expect(config, `nginx location ${path}`).toMatch(location);
      expect(config.match(location)?.[0]).toContain('X-Frame-Options "SAMEORIGIN" always');
      expect(config.match(location)?.[0]).toContain('X-Content-Type-Options "nosniff" always');
    }
    expect(config).toContain(String.raw`location ~* "-[a-z0-9_-]{8,}\.(js|css|png`);
    expect(config).not.toContain(String.raw`location ~* \.(js|css|png`);
    expect(config).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable" always;'
    );
  });

  it('el limitador se apaga y se configura, y una tonteria no lo apaga', () => {
    expect(rateLimitFromEnv({ DISABLE_RATE_LIMIT: '1' })).toBeNull();
    expect(rateLimitFromEnv({ RATE_LIMIT_WINDOW_MS: '30000', RATE_LIMIT_MAX: '42' })).toEqual({
      windowMs: 30000,
      limit: 42
    });
    // `RATE_LIMIT_MAX=0` no puede significar «sin limite»: alguien lo pondra pensando
    // en apagarlo y se encontrara con una API que 429-loquea. Se vuelve al defecto.
    expect(rateLimitFromEnv({ RATE_LIMIT_MAX: '0' })).toEqual({ windowMs: 60_000, limit: 600 });
    expect(rateLimitFromEnv({})).toEqual({ windowMs: 60_000, limit: 600 });
  });
});

describe('el visor de logs, servido por el propio proceso', () => {
  it('el stream responde text/event-stream: sin esa cabecera, EventSource aborta', async () => {
    // El fallo historico: `stream()` de Hono fabricaba una Response con `text/plain`, y el
    // navegador cortaba la conexion con el MIME en la nariz —el visor se quedaba en
    // «Reintentando» mientras el servidor escribia y escribia—. Ninguna prueba de desarrollo
    // miraba esa pantalla; la mira esta. Y la mira de verdad es el job full-stack, que por
    // culpa del `import.meta` del config llevaba rondas sin enterarse de nada.
    const app = createApp({ rateLimit: null });
    const res = await app.request('/api/logs/stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // Primera encuadre:: comentario de apertura y el evento `connected`. Si esto no sale, el visor
    // no sale de «Conectando» ni con toda la suerte del mundo.
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let texto = '';
    for (let i = 0; i < 6 && !texto.includes('data: {"type":"connected"'); i++) {
      const chunk = await reader!.read();
      if (chunk.done) break;
      texto += decoder.decode(chunk.value, { stream: true });
    }
    await reader!.cancel().catch(() => undefined);
    expect(texto).toContain('data: {"type":"connected"');
  });
});

describe('CORS de reproducción de vídeos', () => {
  it('permite credenciales, Range y expone las cabeceras de respuesta del stream', async () => {
    const app = createApp({ rateLimit: null });
    const origin = 'http://localhost:4200';
    const preflight = await app.request(
      '/api/recipes/recipe/step-videos/0123456789abcdef01234567/stream',
      {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'range'
        }
      }
    );

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('range');

    const response = await app.request(
      '/api/recipes/recipe/step-videos/0123456789abcdef01234567/stream',
      { headers: { Origin: origin, Range: 'bytes=0-0' } }
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    const exposed = response.headers.get('access-control-expose-headers')?.toLowerCase() ?? '';
    expect(exposed).toContain('accept-ranges');
    expect(exposed).toContain('content-range');
    expect(exposed).toContain('content-length');
  });
});
