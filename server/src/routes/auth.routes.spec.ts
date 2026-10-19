import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../config/app.config.js';

/**
 * La cuenta de la persona: su nombre, su foto y su contrasena. Era el hueco que la app tenia —el
 * servidor ya aceptaba `name` y `avatar` en `PATCH /profile`, y no habia pantalla donde tocarlo—
 * y dos de las tres cosas necesitan un fichero en disco, que es lo que se prueba aqui.
 *
 * La BD va en memoria, pero `uploads/` NO: con `:memory:` el carpetillo cae en el temporal del
 * proceso (ver `uploadsRoot`), asi que la prueba escribe fuera del arbol del repo y no deja restos
 * que commitear.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let app: Awaited<ReturnType<typeof import('../app.js').createApp>>;

/** `Response.json()` es `unknown` en TS; se ancha a `any` una vez y se acaba el asunto. */
const json = async (response: Response): Promise<any> => await response.json();

function withAuth(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    }
  };
}

async function seedTestHousehold(userId: string): Promise<void> {
  // These tests exercise account/profile routes after onboarding. The real app now gates every
  // other API until the person creates or joins a household; that gate has separate integration
  // coverage in household-required.middleware.spec.ts. Seed membership as fixture data here so
  // failures stay focused on the auth route under test rather than the onboarding gate.
  const db = (await import('../config/database.js')).getDatabase();
  const householdId = `auth-spec-home-${userId}`;
  db.prepare('INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)').run(
    householdId,
    'Hogar sintético de auth',
    `AUTH-${userId}`
  );
  db.prepare('UPDATE users SET household_id = ? WHERE id = ?').run(householdId, userId);
  db.prepare(
    `INSERT INTO household_members (id, household_id, user_id, role, permissions)
     VALUES (?, ?, ?, 'admin', '{"settings":true}')`
  ).run(`auth-spec-membership-${userId}`, householdId, userId);
}

async function register(name: string): Promise<{ token: string; email: string; userId: string }> {
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}-${Math.random().toString(36).slice(2, 8)}@hogaria.test`;
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'Clave1234' })
  });
  const data = (await json(response)).data;
  const token = data.token as string;
  const userId = data.user.id as string;
  await seedTestHousehold(userId);
  return { token, email, userId };
}

const profileAvatar = async (token: string) =>
  (await json(await app.request('/api/auth/profile', withAuth(token)))).data.avatar as
    string | null;

beforeAll(async () => {
  const database = await import('../config/database.js');
  await database.initializeDatabase();
  const { createApp } = await import('../app.js');
  app = createApp({ rateLimit: null, staticDir: null });
});

describe('la cuenta de la persona', () => {
  it('sube una foto, la sirve y la guarda en el perfil', async () => {
    const { token } = await register('Ana');

    const uploaded = await json(
      await app.request(
        '/api/auth/avatar',
        withAuth(token, { method: 'POST', body: JSON.stringify({ image: PNG_1PX }) })
      )
    );
    const avatar = uploaded.data.avatar as string;
    // El id de usuario es un nanoid (mayusculas incluidas): la URL lleva su prefijo.
    expect(avatar).toMatch(/^\/api\/uploads\/avatars\/[A-Za-z0-9._-]+\.png$/);

    const served = await app.request(avatar);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect((await served.arrayBuffer()).byteLength).toBeGreaterThan(0);

    expect(await profileAvatar(token)).toBe(avatar);
  });

  it('con el destino de imagen inutilizable, se dice 500: nada de un 200 mentiroso', async () => {
    // El fallo que esto cierra es el peor posible en una pantalla de identidad: la subida
    // responde satisfecha, la URL queda en la base de datos y el navegador recibe un 404 en cada
    // `img` —una foto que «no cambia» y un toast que dice que si. Si escribir no se pudo, el
    // perfil tiene que quedarse como estaba y hay que decir por que.
    const { token } = await register('Eun');
    const before = await profileAvatar(token);
    const ro = mkdtempSync(join(tmpdir(), 'hogaria-uploads-inutilizables-'));
    // `chmod(0500)` no impide escribir en Windows. En vez de depender de permisos del sistema,
    // se coloca un fichero donde `uploads/` tendría que ser un directorio; `mkdir` falla igual
    // en todos los sistemas y no requiere tocar datos ni rutas fuera de este fixture temporal.
    writeFileSync(join(ro, 'uploads'), 'fixture no-dir');
    const tempRoot = resolve(tmpdir());
    const tempRelative = relative(tempRoot, resolve(ro));
    const saved = process.env.DATABASE_PATH;
    try {
      if (
        isAbsolute(tempRelative) ||
        tempRelative === '..' ||
        tempRelative.startsWith(`..${sep}`)
      ) {
        throw new Error('El fixture debe permanecer bajo el directorio temporal del sistema');
      }
      process.env.DATABASE_PATH = join(ro, 'hogaria.sqlite'); // `uploads/` se crea dentro: no podra
      const res = await app.request(
        '/api/auth/avatar',
        withAuth(token, { method: 'POST', body: JSON.stringify({ image: PNG_1PX }) })
      );
      expect(res.status).toBe(500);
      expect((await json(res)).message).toBe('UPLOAD_WRITE_FAILED');
      expect(await profileAvatar(token)).toBe(before);
    } finally {
      process.env.DATABASE_PATH = saved;
      rmSync(ro, { recursive: true, force: true });
    }
  });

  it('la segunda foto sustituye a la primera: la URL cambia', async () => {
    const { token } = await register('Bea');
    const upload = async () =>
      (
        await json(
          await app.request(
            '/api/auth/avatar',
            withAuth(token, { method: 'POST', body: JSON.stringify({ image: PNG_1PX }) })
          )
        )
      ).data.avatar;
    const first = await upload();
    const second = await upload();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(await profileAvatar(token)).toBe(second);
  });

  it('lo que no es una foto de siempre no entra', async () => {
    const { token } = await register('Che');
    const svg = await app.request(
      '/api/auth/avatar',
      withAuth(token, {
        method: 'POST',
        body: JSON.stringify({
          image: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0IG9ubG9hZD1hbGVydCgxKSAvPjwvc3ZnPg=='
        })
      })
    );
    expect(svg.status).toBe(415);
    expect((await json(svg)).message).toBe('UNSUPPORTED_IMAGE');

    const nonsense = await app.request(
      '/api/auth/avatar',
      withAuth(token, { method: 'POST', body: JSON.stringify({ image: 'no soy una imagen' }) })
    );
    expect(nonsense.status).toBe(400);
    expect((await json(nonsense)).message).toBe('INVALID_IMAGE');

    expect(
      (await app.request('/api/auth/avatar', withAuth(token, { method: 'POST', body: '{}' })))
        .status
    ).toBe(400);
    // Y no se guardo nada: sigue sin foto.
    expect(await profileAvatar(token)).toBeFalsy();
  });

  it('quitar la foto deja el campo vacio', async () => {
    const { token } = await register('Die');
    await app.request(
      '/api/auth/avatar',
      withAuth(token, { method: 'POST', body: JSON.stringify({ image: PNG_1PX }) })
    );
    expect(await profileAvatar(token)).toBeTruthy();

    const removed = await app.request('/api/auth/avatar', withAuth(token, { method: 'DELETE' }));
    expect(removed.status).toBe(200);
    // `sanitizeUser` omite el campo cuando no hay foto (nunca un string vacio): para el frontend
    // `User.avatar?: string` es exactamente lo mismo, ausencia.
    expect(await profileAvatar(token)).toBeFalsy();
  });

  it('el perfil acepta la ruta que el propio backend devuelve, y no un /etc/passwd', async () => {
    const { token } = await register('Ene');
    const ok = await app.request(
      '/api/auth/profile',
      withAuth(token, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Ene Lar', avatar: '/api/uploads/avatars/u-ene-f1e2d3.png' })
      })
    );
    expect(ok.status).toBe(200);
    const profile = await json(await app.request('/api/auth/profile', withAuth(token)));
    expect(profile.data.name).toBe('Ene Lar');
    expect(profile.data.avatar).toBe('/api/uploads/avatars/u-ene-f1e2d3.png');

    const absolute = await app.request(
      '/api/auth/profile',
      withAuth(token, {
        method: 'PATCH',
        body: JSON.stringify({ avatar: 'https://cdn.ejemplo.com/a.png' })
      })
    );
    expect(absolute.status).toBe(200);

    const traversal = await app.request(
      '/api/auth/profile',
      withAuth(token, { method: 'PATCH', body: JSON.stringify({ avatar: '/etc/passwd' }) })
    );
    expect(traversal.status).toBeGreaterThanOrEqual(400);

    const cleared = await app.request(
      '/api/auth/profile',
      withAuth(token, { method: 'PATCH', body: JSON.stringify({ avatar: null }) })
    );
    expect(cleared.status).toBe(200);
    expect(await profileAvatar(token)).toBeFalsy();
  });

  it('guarda y restaura la preferencia de vista de recetas', async () => {
    const { token } = await register('VistaRecetas');
    const preferences = {
      theme: 'dark',
      language: 'en',
      detailLevel: 'expert',
      recipeViewMode: 'list'
    };

    const saved = await app.request(
      '/api/auth/profile',
      withAuth(token, { method: 'PATCH', body: JSON.stringify({ preferences }) })
    );
    expect(saved.status).toBe(200);
    expect((await json(saved)).data.preferences).toMatchObject(preferences);

    const reloaded = await json(await app.request('/api/auth/profile', withAuth(token)));
    expect(reloaded.data.preferences).toMatchObject(preferences);
  });

  it('cambiar la contrasena exige la anterior, y con la nueva se entra', async () => {
    const { token, email } = await register('Luis');
    const assertDefaultPasswordStillWorks = async () => {
      const response = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'Clave1234' })
      });
      expect(response.status).toBe(200);
    };
    const wrong = await app.request(
      '/api/auth/change-password',
      withAuth(token, {
        method: 'POST',
        body: JSON.stringify({ oldPassword: 'no-es', newPassword: 'Nueva1234' })
      })
    );
    expect(wrong.status).toBe(400);
    await assertDefaultPasswordStillWorks();

    const weak = await app.request(
      '/api/auth/change-password',
      withAuth(token, {
        method: 'POST',
        body: JSON.stringify({ oldPassword: 'Clave1234', newPassword: 'corta' })
      })
    );
    expect(weak.status).toBeGreaterThanOrEqual(400);
    await assertDefaultPasswordStillWorks();

    const ok = await app.request(
      '/api/auth/change-password',
      withAuth(token, {
        method: 'POST',
        body: JSON.stringify({ oldPassword: 'Clave1234', newPassword: 'Nueva1234' })
      })
    );
    expect(ok.status).toBe(200);

    const loginOld = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Clave1234' })
    });
    expect(loginOld.status).toBeGreaterThanOrEqual(400);
    const loginNew = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Nueva1234' })
    });
    expect(loginNew.status).toBe(200);
  });

  it('sin token no se sube nada, y la foto no se adivina por la ruta', async () => {
    const anonymous = await app.request('/api/auth/avatar', {
      method: 'POST',
      body: JSON.stringify({ image: PNG_1PX })
    });
    expect(anonymous.status).toBe(401);
    expect((await app.request('/api/uploads/avatars/no-existe.png')).status).toBe(404);
    // Un directorio que la app no sirve, aunque el fichero existiera.
    expect((await app.request('/api/uploads/secrets/x.png')).status).toBe(404);
  });
});

describe('saltarse el onboarding (HOGARIA-SPEC 12o)', () => {
  it('un PATCH de gusto sin ningun campo no es un 500 y no borra lo que habia', async () => {
    // «Saltar por ahora» manda el cuerpo vacio: los cuatro campos del perfil son opcionales, y hasta
    // esta ronda `z.string().min(1)` los exigia todos. Ademas el perfil se fusiona sobre
    // `users.preferences`, que es donde vive el tema y el idioma: si el vacio escribiera algo, saltarse
    // el onboarding cambiaria el idioma de la cuenta.
    const { token } = await register('Rafa');
    const before = await json(await app.request('/api/auth/taste', withAuth(token)));
    const response = await app.request(
      '/api/auth/taste',
      withAuth(token, { method: 'PATCH', body: '{}' })
    );
    expect(response.status).toBe(200);

    const after = await json(await app.request('/api/auth/taste', withAuth(token)));
    expect(after.data).toEqual(before.data);

    // Y vaciar un campo con `null` si lo borra: ausente no tocar, null quitar.
    const filled = await app.request(
      '/api/auth/taste',
      withAuth(token, { method: 'PATCH', body: JSON.stringify({ dislikes: ['el cilantro'] }) })
    );
    expect(filled.status).toBe(200);
    const emptied = await app.request(
      '/api/auth/taste',
      withAuth(token, { method: 'PATCH', body: JSON.stringify({ dislikes: null }) })
    );
    expect(emptied.status).toBe(200);
    const final = await json(await app.request('/api/auth/taste', withAuth(token)));
    expect(final.data.dislikes ?? []).toEqual([]);
  });

  it('guarda objetivos múltiples y texto libre con respuesta plural, conservando el alias antiguo', async () => {
    const { token } = await register('Objetivos');
    const save = await app.request(
      '/api/auth/taste',
      withAuth(token, {
        method: 'PATCH',
        body: JSON.stringify({
          taste: {
            goals: ['weight-loss', 'variety'],
            goalNotes: 'Prioriza legumbres y cenas sencillas'
          }
        })
      })
    );

    expect(save.status).toBe(200);
    expect((await json(save)).data.taste).toMatchObject({
      goals: ['weight-loss', 'variety'],
      goalNotes: 'Prioriza legumbres y cenas sencillas'
    });
    const reloaded = await json(await app.request('/api/auth/taste', withAuth(token)));
    expect(reloaded.data.taste.goals).toEqual(['weight-loss', 'variety']);
    expect(reloaded.data.taste.goal).toBeUndefined();

    const legacy = await app.request(
      '/api/auth/taste',
      withAuth(token, {
        method: 'PATCH',
        body: JSON.stringify({ taste: { goal: 'muscle-gain' } })
      })
    );
    expect(legacy.status).toBe(200);
    expect((await json(legacy)).data.taste.goals).toEqual(['muscle-gain']);
  });
});

describe('límites del perfil de preferencias', () => {
  it('acepta 60 caracteres y 60 opciones, y rechaza cada límite excedido', async () => {
    const { token } = await register('Nora');
    const patchTaste = (allergies: string[]) =>
      app.request(
        '/api/auth/taste',
        withAuth(token, { method: 'PATCH', body: JSON.stringify({ taste: { allergies } }) })
      );
    const withinListLimit = Array.from({ length: 60 }, (_, index) => `Alergia ${index}`);

    const atCharacterLimit = await patchTaste(['A'.repeat(60)]);
    expect(atCharacterLimit.status).toBe(200);
    expect((await json(atCharacterLimit)).data.taste.allergies).toEqual(['A'.repeat(60)]);

    const aboveCharacterLimit = await patchTaste(['A'.repeat(61)]);
    expect(aboveCharacterLimit.status).toBe(400);

    const atListLimit = await patchTaste(withinListLimit);
    expect(atListLimit.status).toBe(200);
    expect((await json(atListLimit)).data.taste.allergies).toEqual(withinListLimit);

    const aboveListLimit = await patchTaste([...withinListLimit, 'Alergia 60']);
    expect(aboveListLimit.status).toBe(400);
    const preserved = await json(await app.request('/api/auth/taste', withAuth(token)));
    expect(preserved.data.taste.allergies).toEqual(withinListLimit);
  });
});

describe('limite bcrypt para contrasenas nuevas', () => {
  const passwordAt72Bytes = `Aa1${'x'.repeat(69)}`;
  const passwordAt73Bytes = `Aa1${'x'.repeat(70)}`;

  async function login(email: string, password: string): Promise<Response> {
    return app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
  }

  it('rechaza registro de 73 bytes sin crear una cuenta con un prefijo distinto', async () => {
    const email = `pw-register-${Math.random().toString(36).slice(2, 8)}@hogaria.test`;
    const response = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ana', email, password: passwordAt73Bytes })
    });

    expect(response.status).toBe(400);
    expect((await login(email, passwordAt72Bytes)).status).toBe(401);
  });

  it('rechaza el cambio de 73 bytes y mantiene la credencial previa', async () => {
    const { token, email } = await register('Nora');
    const response = await app.request(
      '/api/auth/change-password',
      withAuth(token, {
        method: 'POST',
        body: JSON.stringify({ oldPassword: 'Clave1234', newPassword: passwordAt73Bytes })
      })
    );

    expect(response.status).toBe(400);
    expect((await login(email, 'Clave1234')).status).toBe(200);
    expect((await login(email, passwordAt72Bytes)).status).toBe(401);
  });

  it('rechaza el restablecimiento de 73 bytes sin cambiar la credencial previa', async () => {
    const { email, userId } = await register('Rita');
    const token = jwt.sign({ sub: userId, type: 'password-reset' }, config.auth.jwtSecret, {
      expiresIn: '1h'
    });
    const response = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: passwordAt73Bytes })
    });

    expect(response.status).toBe(400);
    expect((await login(email, 'Clave1234')).status).toBe(200);
    expect((await login(email, passwordAt72Bytes)).status).toBe(401);
  });

  it('acepta exactamente 72 bytes en registro, cambio y restablecimiento', async () => {
    const email = `pw-exact-${Math.random().toString(36).slice(2, 8)}@hogaria.test`;
    const registered = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sol', email, password: passwordAt72Bytes })
    });
    expect(registered.status).toBe(201);

    const registration = await json(registered);
    const { token: authToken, userId } = {
      token: registration.data.token as string,
      userId: registration.data.user.id as string
    };
    await seedTestHousehold(userId);
    const changed = await app.request(
      '/api/auth/change-password',
      withAuth(authToken, {
        method: 'POST',
        body: JSON.stringify({ oldPassword: passwordAt72Bytes, newPassword: passwordAt72Bytes })
      })
    );
    expect(changed.status).toBe(200);

    const resetToken = jwt.sign({ sub: userId, type: 'password-reset' }, config.auth.jwtSecret, {
      expiresIn: '1h'
    });
    const reset = await app.request('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: resetToken, newPassword: passwordAt72Bytes })
    });
    expect(reset.status).toBe(200);
    expect((await login(email, passwordAt72Bytes)).status).toBe(200);
  });
});
