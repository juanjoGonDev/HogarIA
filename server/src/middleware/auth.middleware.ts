import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { config } from '../config/app.config.js';
import { getDatabase } from '../config/database.js';
import type { AppEnv } from '../types/hono-env.js';
import { resolveAiOutputLanguage } from '../utils/ai-output-language.js';

/**
 * `EventSource` no puede mandar cabeceras, y el listado en vivo (HOGARIA-SPEC §8f)
 * se hace con el. Se acepta `?access_token=` SOLO en `GET /api/shopping/stream/*`:
 * ni en POST (un token en la URL de una escritura acabaria en el historial de
 * navegacion de una red del hogar), ni en el resto de rutas. Y el logger de `index.ts`
 * lo enmascara, porque un token en la URL es un token en los logs si nadie lo evita.
 */
function bearerToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.substring(7);

  if (c.req.method === 'GET' && c.req.path.startsWith('/api/shopping/stream/')) {
    const query = c.req.query('access_token');
    if (query && query.trim()) return query.trim();
  }
  return null;
}

export async function authMiddleware(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  return authenticate(c, next, true);
}

/** Authentication for endpoints whose contract forbids repairing user state during a read. */
export async function readOnlyAuthMiddleware(
  c: Context<AppEnv>,
  next: Next
): Promise<Response | void> {
  return authenticate(c, next, false);
}

async function authenticate(
  c: Context<AppEnv>,
  next: Next,
  repairStaleHouseholdSelection: boolean
): Promise<Response | void> {
  const token = bearerToken(c);

  if (!token) {
    return c.json(
      {
        success: false,
        message: 'Authorization header required'
      },
      401
    );
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret) as any;

    if (payload.type === 'refresh') {
      throw new Error('Invalid token type');
    }

    // Set user info in context
    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);

    // When a home's admin deactivates the selected membership, do not let other
    // household-scoped routes keep using users.household_id as an authorization shortcut.
    // The user may inspect/select another active membership, but otherwise must fail closed.
    const db = getDatabase();
    const userPreferences = db
      .prepare('SELECT preferences FROM users WHERE id = ?')
      .get(payload.sub) as { preferences: string | null } | undefined;
    let savedLanguage: string | undefined;
    try {
      const preferences = JSON.parse(userPreferences?.preferences ?? '{}') as {
        language?: unknown;
      };
      if (typeof preferences.language === 'string') savedLanguage = preferences.language;
    } catch {
      // A malformed legacy preference must not make an authenticated request fail.
    }
    c.set(
      'appLanguage',
      resolveAiOutputLanguage(
        c.req.header('X-App-Language'),
        savedLanguage,
        c.req.header('Accept-Language')
      )
    );
    const selection = db
      .prepare(
        `SELECT u.household_id, hm.is_active AS membership_active
           FROM users u
           LEFT JOIN household_members hm
             ON hm.household_id = u.household_id AND hm.user_id = u.id
          WHERE u.id = ?`
      )
      .get(payload.sub) as
      { household_id: string | null; membership_active: number | null } | undefined;
    const activeMemberships = db
      .prepare(
        'SELECT COUNT(*) AS count FROM household_members WHERE user_id = ? AND is_active = 1'
      )
      .get(payload.sub) as { count: number };
    const selectionRoute = isHouseholdSelectionRoute(c);

    // A NULL pointer is a personal context only when the account has no household (or exactly
    // one, which activeHouseholdId can safely restore). With multiple memberships it means the
    // user deliberately has no selected household; do not silently expose personal-scope data.
    if (!selection?.household_id && activeMemberships.count > 1 && !selectionRoute) {
      return c.json({ success: false, code: 'HOUSEHOLD_SELECTION_REQUIRED' }, 409);
    }

    if (selection?.household_id && selection.membership_active !== 1) {
      if (activeMemberships.count === 0) {
        if (repairStaleHouseholdSelection) {
          db.prepare('UPDATE users SET household_id = NULL WHERE id = ?').run(payload.sub);
        }
      } else if (!selectionRoute) {
        return c.json({ success: false, code: 'HOUSEHOLD_SELECTION_REQUIRED' }, 409);
      }
    }

    // createApp sets the internal marker for production API requests. Route-only unit harnesses do
    // not set it, preserving their previous isolated behavior. Accounts without any active
    // membership must finish setup before calling the rest of the authenticated API; discovery and
    // create/join routes stay available so registration can recover after reload or network failure.
    // The client guard is UX only; this server-side gate is the authorization boundary.
    if (
      c.get('householdSetupGate') === true &&
      activeMemberships.count === 0 &&
      !selectionRoute &&
      !isHouseholdSetupRoute(c)
    ) {
      return c.json({ success: false, code: 'HOUSEHOLD_REQUIRED' }, 409);
    }

    await next();
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Invalid or expired token'
      },
      401
    );
  }
}

function isHouseholdSelectionRoute(c: Context): boolean {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '') || '/';
  return (
    (c.req.method === 'GET' &&
      (path.endsWith('/api/household/memberships') || path.endsWith('/api/household'))) ||
    (c.req.method === 'POST' && path.endsWith('/api/household/active'))
  );
}

function isHouseholdSetupRoute(c: Context): boolean {
  const path = new URL(c.req.url).pathname.replace(/\/+$/, '') || '/';
  if (c.req.method === 'GET') return path === '/api/ai/availability';
  if (c.req.method !== 'POST') return false;
  return (
    path === '/api/household' ||
    path === '/api/household/join' ||
    /^\/api\/household\/join\/[^/]+$/.test(path)
  );
}

export async function optionalAuthMiddleware(c: Context, next: Next) {
  const token = bearerToken(c);

  if (token) {
    try {
      const payload = jwt.verify(token, config.auth.jwtSecret) as any;

      if (payload.type !== 'refresh') {
        c.set('userId', payload.sub);
        c.set('userEmail', payload.email);
      }
    } catch {
      // Token invalid, but continue without auth
    }
  }

  await next();
}
