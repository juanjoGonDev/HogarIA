import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { secureHeaders } from 'hono/secure-headers';
import { rateLimiter } from 'hono-rate-limiter';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { config } from './config/app.config.js';
import { errorHandler } from './middleware/error.middleware.js';
import { timestampMiddleware } from './middleware/timestamp.middleware.js';
import { authRoutes } from './routes/auth.routes.js';
import { readUpload } from './utils/uploads.js';
import { pantryRoutes } from './routes/pantry.routes.js';
import {
  createPantryProductImageRoutes,
  createProductImagePreviewRoutes
} from './routes/pantry-product-images.routes.js';
import { shoppingRoutes } from './routes/shopping.routes.js';
import { receiptsRoutes } from './routes/receipts.routes.js';
import { recipeRoutes } from './routes/recipes.routes.js';
import { recipeImageRoutes } from './routes/recipe-images.routes.js';
import {
  recipePhotoPreviewRoutes,
  recipeStepPhotoRoutes
} from './routes/recipe-step-photos.routes.js';
import { householdRoutes } from './routes/household.routes.js';
import { householdPlanRoutes } from './routes/household-plan.routes.js';
import { householdTasksRoutes } from './routes/household-tasks.routes.js';
import { calendarRoutes } from './routes/calendar.routes.js';
import { aiRoutes } from './routes/ai.routes.js';
import { aiQueueRoutes } from './routes/ai-queue.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { logRoutes } from './routes/logs.routes.js';

/**
 * Ensamblado de la app, separado del `listen`.
 *
 * `index.ts` hacia todo: middleware, rutas Y arrancar el puerto. Con ese forma,
 * probar el limitador significaba levantar un servidor real, asi que nunca se probo
 * —y el limitador es precisamente la pieza que deja a toda la casa sin poder tocar
 * nada cuando un cliente hablador se pasa del umbral. Aqui queda una funcion que
 * recibe opciones: el test monta la app en memoria, el binario la monta con estaticos.
 */
export type AppOptions = {
  /**
   * `null`/`undefined` apaga el limitador. Se apaga en la suite e2e de desarrollo
   * (`DISABLE_RATE_LIMIT=1`) porque todos los workers comparten IP; el job de CI de
   * stack completo lo deja ENCENDIDO a proposito, que es donde se ve si la politica
   * asfixia a una app real.
   */
  rateLimit?: { windowMs: number; limit: number } | null;
  /**
   * Carpeta con el `index.html` del frontend. Si esta, el node server es capaz de
   * servir la aplicacion entera (es lo que hace el `CMD` del Dockerfile al copiar
   * `frontend/dist` a `./public`); si no, se comporta como un API puro y manda el
   * nginx del docker-compose.
   */
  staticDir?: string | null;
};

/** Rutas que NO consumen el cupo: diagnosticos y streams. Ver el comentario de abajo. */
/**
 * Lo que no gasta cupo. `logs`, `health` y cualquier `stream` (una conexion SSE viva es UNA
 * peticion, no trescientas) —y `uploads`, que son las fotos de las personas: un `<img>` no puede
 * mandar token, asi que caeria en el cubo por IP y una lista con treinta autores seria un pico de
 * treinta peticiones en la primera carga. Son ficheros estaticos con nombre unico y cache
 * `immutable`: no hay nada aqui a lo que haya que poner un techo.
 */
const EXEMPT_PATHS = [
  /^\/api\/logs(\/|$)/,
  /^\/api\/health(\/|$)/,
  /^\/health$/,
  /\/stream(\/|$)/,
  /^\/api\/uploads(\/|$)/
];

export function isRateLimitExempt(pathname: string): boolean {
  return EXEMPT_PATHS.some((pattern) => pattern.test(pathname));
}

/**
 * Clave del cubo. `x-forwarded-for || 'unknown'` suena razonable hasta que se rellena
 * la tabla: detras del proxy del preview (y detras de cualquier nginx casero sin
 * `proxy_set_header`), TODAS las peticiones del mundo llegan sin cabecera y caen en el
 * mismo cubo `'unknown'` —una casa entera compartiendo 300 peticiones por minuto, y un
 * solo bucle de un navegador dejando fuera al resto, logs incluidos.
 *
 * Con sesion se usa un identificador derivado del token (sus ultimos 16 caracteres): no
 * se verifica la firma aqui —eso lo hace `authMiddleware`—, solo se reparte el cupo por
 * pestana-sesion. Un usuario que cambie de token se da mas margen: cierto, y aun asi
 * mejor que castigar al vecino. Los endpoints de credenciales siguen por IP.
 */
/** FNV-1a de 32 bits, sin dependencias y suficiente para repartir un cubo. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function rateLimitKey(
  authorization: string | undefined,
  forwarded: string | undefined,
  realIp: string | undefined
): string {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  // Se deriva un identificador corto del token (FNV-1a): el cubo tiene que ser estable
  // para la misma sesion y no puede llevar material del token, que acaba en logs.
  if (bearer) return `session:${fnv1a(bearer).toString(36)}`;
  const ip = (forwarded?.split(',')[0] ?? realIp)?.trim();
  return ip ? `ip:${ip}` : 'ip:unknown';
}

/**
 * Resuelve que fichero de disco corresponde a una URL.
 *
 * Tres decisiones que no son de gusto: (1) un path que sale de la raiz (`..`) es
 * `null`, no «se intenta igualmente» —un server de estaticos que sirve `/etc/passwd`
 * no es un server de estaticos—; (2) una ruta de SPA sin extension (`/shopping/abc`,
 * que el navegador pide porque el enrutador vive en el cliente) cae en `index.html`;
 * (3) un fichero CON extension que no existe es un 404 normal, nunca HTML: si un
 * `main-XYZ.js` no esta, devolver el index es la forma mas creativa de que la app se
 * quede en blanco sin decir nada en consola.
 */
export function resolveStaticAsset(staticDir: string, pathname: string): string | null {
  const decoded = safeDecode(pathname);
  if (decoded === null) return null;

  const root = resolve(staticDir);
  const candidate = resolve(join(root, decoded === '' ? 'index.html' : decoded));
  if (!inside(root, candidate)) return null;

  if (isFile(candidate)) return candidate;
  if (isFile(join(candidate, 'index.html'))) return join(candidate, 'index.html');
  if (decoded.includes('.')) return null;

  const index = join(root, 'index.html');
  return isFile(index) ? index : null;
}

function safeDecode(pathname: string): string | null {
  try {
    const decoded = decodeURIComponent(pathname.replace(/^\/+/, ''));
    // Un `\0` colado en el path es un truncado clasico de los servidores estaticos.
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.manifest': 'text/cache-manifest',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  return MIME[dot >= 0 ? path.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream';
}

/** `RateLimit: limit=600, remaining=0, reset=42` -> 42. */
export function resetFromRateLimitHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /(?:^|[,;\s])reset=(\d+)/.exec(header);
  return match ? match[1] : null;
}

/** Un 429 sin `Retry-After` obliga al cliente a adivinar cuando vuelve. */
export function retryAfterSeconds(windowMs: number, resetHeader: string | null): number {
  const seconds = Number(resetHeader ?? '');
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  return Math.max(1, Math.ceil(windowMs / 1000));
}

/**
 * Donde esta el frontend compilado.
 *
 * Se probean varias formas en vez de fijar una: el binario del Dockerfile vive en
 * `/app/public`, un `pnpm start` local tiene el `dist` a un nivel de distancia, y un
 * `ng build` moderno escribe dentro de `dist/browser`. Fijar una ruta es lo que hace
 * que «en local si, en el contenedor no» sea un bug de despliegue en lugar de una linea
 * de config —y servir la app es lo que permite levantar el proyecto ENTERO (API +
 * interfaz) en un solo proceso, que es como se prueba el limitador en CI.
 */
export function resolveStaticDir(
  env: Record<string, string | undefined> = process.env,
  base = process.cwd()
): string | null {
  // `PUBLIC_DIR` es autoritativo, no una pista: si alguien lo pone mal, mejor un 404
  // honesto que servir una copia vieja encontrada por casualidad.
  if (env.PUBLIC_DIR)
    return isAbsolute(env.PUBLIC_DIR) ? env.PUBLIC_DIR : resolve(base, env.PUBLIC_DIR);
  const candidates: string[] = [];
  for (const root of [base, resolve(base, '..'), resolve(base, '..', '..')]) {
    candidates.push(
      resolve(root, 'public'),
      resolve(root, 'public', 'browser'),
      resolve(root, 'frontend', 'dist', 'browser'),
      resolve(root, 'frontend', 'dist'),
      resolve(root, 'dist', 'browser'),
      resolve(root, 'browser')
    );
  }
  for (const candidate of candidates) {
    const dir = isAbsolute(candidate) ? candidate : resolve(base, candidate);
    if (existsSync(resolve(dir, 'index.html'))) return dir;
  }
  return null;
}

/**
 * Que se deja pedir antes de responder 429.
 *
 * `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` siguen valiendo, pero el valor por defecto
 * vive aqui: 300 peticiones por minuto compartidas por toda la casa (clave `unknown`
 * detras de un proxy) es lo que hacia que, en cuanto un cliente entraba en bucle, NADIE
 * pudiese navegar ni ver los logs. Mismo umbral, pero por sesion y con los
 * diagnosticos fuera del cupo.
 */
export function rateLimitFromEnv(
  env: Record<string, string | undefined> = process.env
): { windowMs: number; limit: number } | null {
  if (env.DISABLE_RATE_LIMIT === '1') return null;
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS ?? config.rateLimit.windowMs);
  const limit = Number(env.RATE_LIMIT_MAX ?? config.rateLimit.max);
  if (!Number.isFinite(windowMs) || windowMs < 1000 || !Number.isFinite(limit) || limit < 1) {
    // Un `RATE_LIMIT_MAX=0` mal puesto no puede dejar la API sin proteccion ni sin
    // respuesta: se usa el defecto y se dice, en lugar de arrancar «apagado por fuera».
    console.warn(
      `[config] rate limit ignorado (windowMs=${windowMs}, max=${limit}); se usan los valores por defecto`
    );
    return { windowMs: config.rateLimit.windowMs, limit: config.rateLimit.max };
  }
  return { windowMs, limit };
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  app.use('*', secureHeaders());

  // Logger con el formato que se ve en la terminal del Pi. Pasa por `console`, que
  // `installConsoleCapture()` redirige al almacen de logs: por eso lo que se ve en
  // `/logs` y lo que se ve en `docker logs` es lo mismo, y por eso un 429 tambien.
  app.use('*', async (c, next) => {
    const start = Date.now();
    const { method } = c.req;
    // Un token que viaja por la URL (solo el stream, ver auth.middleware) no tiene por
    // que acabar en el visor de logs ni en el fichero que lo respalda.
    const url = c.req.url.replace(/([?&]access_token=)[^&]+/g, '$1···');
    // eslint-disable-next-line no-console
    console.log(`<-- ${method} ${url}`);
    await next();
    const ms = Date.now() - start;
    const status = c.res.status;
    const color =
      status >= 500
        ? '\x1b[31m'
        : status >= 400
          ? '\x1b[33m'
          : status >= 300
            ? '\x1b[36m'
            : '\x1b[32m';
    const reset = '\x1b[0m';
    // eslint-disable-next-line no-console
    console.log(`--> ${color}${method} ${url} ${status}${reset} ${ms}ms`);
  });

  app.use('*', prettyJSON());
  // Despues de `prettyJSON` y antes de las rutas: lo que sale por aqui ya es el cuerpo
  // definitivo, y normalizarlo una vez en el borde evita que cada pantalla vuelva a
  // inventarse como se le echa la zona horaria a una cadena de SQLite.
  app.use('/api/*', timestampMiddleware());

  app.use(
    '*',
    cors({
      origin: config.cors.origin,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: [
        'X-Request-Id',
        'Retry-After',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset'
      ],
      maxAge: 86400,
      credentials: true
    })
  );

  const limit = options.rateLimit ?? null;
  if (limit) {
    // Credenciales: por IP y prieto, que es donde hay alguien intentando cosas.
    app.use(
      '/api/auth/login',
      rateLimiter({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: 'draft-6',
        keyGenerator: (c) =>
          c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
      })
    );
    app.use(
      '/api/auth/refresh',
      rateLimiter({
        windowMs: 60 * 1000,
        limit: 30,
        standardHeaders: 'draft-6',
        keyGenerator: (c) =>
          c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
      })
    );

    // El resto, con la clave por sesion y con los diagnosticos fuera del cupo.
    // El limitador se construye UNA vez por app: construirlo dentro del middleware, que
    // es lo que parece mas natural, regala un contador nuevo a cada peticion y el cupo
    // no se llena nunca —el 429 no llega jamas, y el test lo cuenta enseguida.
    const windowMs = limit.windowMs;
    const limited = rateLimiter({
      windowMs,
      limit: limit.limit,
      standardHeaders: 'draft-6',
      keyGenerator: (request) =>
        rateLimitKey(
          request.req.header('authorization'),
          request.req.header('x-forwarded-for'),
          request.req.header('x-real-ip')
        ),
      message: {
        success: false,
        error: 'Too Many Requests',
        // El mensaje llega al interceptor del frontend, que traduce el 429 a algo
        // legible. Que diga CUANDO se puede volver, o al usuario no le queda mas
        // remedio que dar a F5 —que es justo lo que multiplica las peticiones.
        message: 'Demasiadas peticiones desde este dispositivo. Espera un momento y sigue.'
      }
    });

    app.use('/api/*', async (c, next) => {
      if (isRateLimitExempt(new URL(c.req.url).pathname)) {
        await next();
        return;
      }
      // `rateLimiter` responde por su cuenta cuando corta (devuelve un Response en vez
      // de dejar seguir la cadena). Llamado a mano dentro de otro middleware, ese
      // Response no se asigna solo al contexto, y Hono se queja con «Context is not
      // finalized»: se copia aqui, que es el unico modo de encadenar los dos.
      const blocked = await limited(c, next);
      if (blocked && !c.finalized) c.res = blocked;
      if (c.res.status === 429) {
        // `draft-6` escribe `RateLimit: limit=..,remaining=..,reset=..`; se lee el reset
        // de ahi, y si no hay se usa la ventana.
        const reset = resetFromRateLimitHeader(
          c.res.headers.get('ratelimit') ?? c.res.headers.get('x-rate-limit-reset')
        );
        const headers = new Headers(c.res.headers);
        headers.set('Retry-After', String(retryAfterSeconds(windowMs, reset)));
        // `exposeHeaders` del CORS: sin esto, desde el navegador la cabecera no se lee.
        headers.set('Access-Control-Expose-Headers', 'Retry-After');
        c.res = new Response(c.res.body, { status: 429, headers });
        // Una linea por cubo y ventana, no por peticion: si alguien esta en bucle, un
        // log por peticion es lena al fuego. Y por `console.warn`, para que el visor de
        // la aplicacion lo muestre sin tener que entrar al contenedor.
        noteLimit(reset, windowMs);
      }
    });
  }

  app.route('/health', healthRoutes);
  app.route('/api/health', healthRoutes);
  app.route('/api/auth', authRoutes);

  // Las fotos que suben las cuentas (`users.avatar`) se sirven aqui y NO detras del token: un
  // `<img>` no puede mandar cabeceras de autorizacion. Lo que hace esto seguro es el nombre del
  // fichero, que lleva un sufijo aleatorio por subida —la URL es el permiso—, y que el unico
  // directorio del que se lee es `uploads/avatars`, resuelto y validado en `utils/uploads.ts`.
  app.get('/api/uploads/:kind/:file', (c) => {
    const url = `/api/uploads/${c.req.param('kind')}/${c.req.param('file')}`;
    const found = readUpload(url);
    if (!found) {
      // Un 404 no se guarda: si el disco estaba de paso (un volumen remontado, un despliegue),
      // la proxima carga tiene que poder reintentar en vez de quedarse clavada en el vacio —y es
      // lo que evita que «subi la foto y ya no hay forma de que aparezca» dure hasta el
      // hard-reload. Se responde en el JSON de la casa, no con un cuerpo vacio.
      return c.json(
        {
          success: false,
          error: 'Not Found',
          message: `Upload ${c.req.param('kind')}/${c.req.param('file')} not on disk`
        },
        404,
        {
          'cache-control': 'no-store'
        }
      );
    }
    // `immutable`: el nombre cambia con cada foto, asi que un 404 de cache no puede quedar viejo.
    return new Response(found.body, {
      status: 200,
      headers: { 'content-type': found.type, 'cache-control': 'private, max-age=3600, immutable' }
    });
  });
  app.route('/api/pantry', pantryRoutes);
  app.route('/api/pantry', createPantryProductImageRoutes());
  app.route('/api/product-image-previews', createProductImagePreviewRoutes());
  app.route('/api/shopping', shoppingRoutes);
  app.route('/api/receipts', receiptsRoutes);
  app.route('/api/recipes/step-photos', recipeStepPhotoRoutes);
  app.route('/api/recipe-photo-previews', recipePhotoPreviewRoutes);
  app.route('/api/recipe-images', recipeImageRoutes);
  app.route('/api/recipes', recipeRoutes);
  app.route('/api/household', householdRoutes);
  app.route('/api/household', householdPlanRoutes);
  app.route('/api/household', householdTasksRoutes);
  app.route('/api/calendar', calendarRoutes);
  app.route('/api/ai', aiRoutes);
  app.route('/api/ai', aiQueueRoutes);
  app.route('/api/logs', logRoutes);

  app.onError(errorHandler);
  app.notFound((c) =>
    c.json(
      {
        success: false,
        error: 'Not Found',
        message: `Route ${c.req.method} ${c.req.url} not found`
      },
      404
    )
  );

  const staticDir = options.staticDir;
  if (staticDir) {
    // Se sirve a mano, sin `serveStatic`, por dos motivos: el criterio del punto
    // (index.html para rutas de SPA, 404 para un asset que no existe) y porque el
    // `root` de `serveStatic` se resuelve contra el `cwd` del proceso, que en el
    // contenedor no es el de los tests.
    app.get('*', async (c) => {
      const path = new URL(c.req.url).pathname;
      if (path.startsWith('/api/') || path === '/api' || path === '/health') return next404(c);
      const file = resolveStaticAsset(staticDir, path);
      if (!file) return next404(c);
      const body = readFileSync(file);
      const immutable = /-[A-Za-z0-9_]{8,}\./.test(path); // hashed chunk de Angular
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': mimeFor(file),
          'cache-control': file.endsWith('index.html')
            ? 'no-cache'
            : immutable
              ? 'public, max-age=31536000, immutable'
              : 'public, max-age=3600'
        }
      });
    });
  }

  return app;
}

// `notFound` de Hono no es invocable desde un handler suelto; se replica su respuesta
// para que un asset raro y una API inexistente contesten igual (JSON, 404).
function next404(c: import('hono').Context) {
  return c.json(
    { success: false, error: 'Not Found', message: `Route ${c.req.method} ${c.req.url} not found` },
    404
  );
}

const warnedBuckets = new Map<string, number>();
function noteLimit(reset: string | null, windowMs: number): void {
  // Clave de la deduplicacion: la ventana de reset, que es lo que cambia cuando cambia
  // el cubo de verdad. Sin cabecera `reset` (el cliente no la manda todavia, o no es
  // draft-6) se usa la ventana: un numero que un humano entiende mejor que un divisor.
  const bucket = reset ?? `window:${Math.floor(Date.now() / windowMs)}`;
  const now = Date.now();
  if (now - (warnedBuckets.get(bucket) ?? 0) < 10_000) return;
  warnedBuckets.set(bucket, now);
  if (warnedBuckets.size > 32) warnedBuckets.clear();
  // eslint-disable-next-line no-console
  console.warn(`[rate-limit] un cliente ha agotado su cupo; 429 con Retry-After`);
}
