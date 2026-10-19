import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { config } from '../config/app.config.js';
import { getDatabase } from '../config/database.js';
import { readForm } from '../utils/form-body.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema
} from '../schemas/auth.schema.js';
import { forgotPasswordRoutes } from './forgot-password.routes.js';
import { deleteUpload, parseImageDataUrl, MAX_AVATAR_BYTES, storeImage } from '../utils/uploads.js';
import { avatarImageSchema } from '../schemas/auth.schema.js';
import type { AppEnv } from '../types/hono-env.js';
import { seedDefaultsForUser } from '../utils/seed-data.js';
import { readTasteResponse, saveTasteProfile, updateTasteSchema } from '../utils/taste-profile.js';

const authRoutes = new Hono<AppEnv>();

// Helper to generate tokens
function generateTokens(userId: string, email: string) {
  // Cast explícito: los tipos de jsonwebtoken exigen `number | StringValue`,
  // mientras que la configuración tipa las duraciones como `string`.
  const token = jwt.sign({ sub: userId, email }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions['expiresIn']
  });

  const refreshToken = jwt.sign({ sub: userId, type: 'refresh' }, config.auth.jwtSecret, {
    expiresIn: config.auth.refreshTokenExpiresIn as jwt.SignOptions['expiresIn']
  });

  return { token, refreshToken };
}

// Helper to get user without password and convert snake_case DB columns to camelCase
function sanitizeUser(raw: any) {
  const { password_hash, ...u } = raw;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatar: u.avatar ?? undefined,
    householdId: u.household_id ?? undefined,
    cookingLevel: u.cooking_level ?? 'beginner',
    preferences: u.preferences ? JSON.parse(u.preferences) : {},
    createdAt: u.created_at,
    updatedAt: u.updated_at
  };
}

// POST /api/auth/register
authRoutes.post('/register', async (c) => {
  const body = await c.req.json();
  const input = registerSchema.parse(body);

  const db = getDatabase();

  // Check if user exists
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(input.email);
  if (existingUser) {
    return c.json(
      {
        success: false,
        message: 'Email already registered'
      },
      409
    );
  }

  // Hash password
  const passwordHash = await bcrypt.hash(input.password, config.auth.bcryptRounds);

  // Create user
  const userId = nanoid();
  db.prepare(
    `
    INSERT INTO users (id, email, name, password_hash, cooking_level, preferences)
    VALUES (?, ?, ?, ?, ?, ?)
  `
  ).run(
    userId,
    input.email,
    input.name,
    passwordHash,
    input.cookingLevel || 'beginner',
    JSON.stringify({ theme: 'system', language: 'es', detailLevel: 'intermediate' })
  );

  // Catálogo de partida (utensilios que marcar + ingredientes de sugerencia).
  // Al principio solo existía dentro de un hogar, así que una cuenta sin hogar
  // se encontraba las dos pestañas de la despensa vacías. Si el alta del seed
  // falla, el usuario se registra igual: no es condición de registro.
  try {
    seedDefaultsForUser(db, userId);
  } catch (err) {
    console.warn('[DB] No se pudo sembrar el catálogo personal:', err);
  }

  // Get created user
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const tokens = generateTokens(userId, input.email);

  return c.json(
    {
      success: true,
      data: {
        user: sanitizeUser(user),
        ...tokens
      }
    },
    201
  );
});

// POST /api/auth/login
authRoutes.post('/login', async (c) => {
  const body = await c.req.json();
  const input = loginSchema.parse(body);

  const db = getDatabase();

  // Find user
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(input.email) as any;
  if (!user) {
    return c.json(
      {
        success: false,
        message: 'Invalid email or password'
      },
      401
    );
  }

  // Verify password
  const isValidPassword = await bcrypt.compare(input.password, user.password_hash);
  if (!isValidPassword) {
    return c.json(
      {
        success: false,
        message: 'Invalid email or password'
      },
      401
    );
  }

  // Generate tokens
  const tokens = generateTokens(user.id, user.email);

  return c.json({
    success: true,
    data: {
      user: sanitizeUser(user),
      ...tokens
    }
  });
});

// POST /api/auth/refresh
authRoutes.post('/refresh', async (c) => {
  const body = await c.req.json();
  const input = refreshTokenSchema.parse(body);

  try {
    const payload = jwt.verify(input.refreshToken, config.auth.jwtSecret) as any;

    if (payload.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub) as any;

    if (!user) {
      throw new Error('User not found');
    }

    const tokens = generateTokens(user.id, user.email);

    return c.json({
      success: true,
      data: {
        user: sanitizeUser(user),
        ...tokens
      }
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Invalid refresh token'
      },
      401
    );
  }
});

// POST /api/auth/forgot-password
authRoutes.route('/', forgotPasswordRoutes);

// POST /api/auth/reset-password
authRoutes.post('/reset-password', async (c) => {
  const body = await c.req.json();
  const input = resetPasswordSchema.parse(body);

  try {
    const payload = jwt.verify(input.token, config.auth.jwtSecret) as any;

    if (payload.type !== 'password-reset') {
      throw new Error('Invalid token type');
    }

    const db = getDatabase();
    const passwordHash = await bcrypt.hash(input.newPassword, config.auth.bcryptRounds);

    db.prepare(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(passwordHash, payload.sub);

    return c.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        message: 'Invalid or expired reset token'
      },
      400
    );
  }
});

// POST /api/auth/change-password (protected)
authRoutes.post('/change-password', authMiddleware, async (c) => {
  const body = await c.req.json();
  const input = changePasswordSchema.parse(body);
  const userId = c.get('userId');

  const db = getDatabase();
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;

  const isValidPassword = await bcrypt.compare(input.oldPassword, user.password_hash);
  if (!isValidPassword) {
    return c.json(
      {
        success: false,
        message: 'Current password is incorrect'
      },
      400
    );
  }

  const passwordHash = await bcrypt.hash(input.newPassword, config.auth.bcryptRounds);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    passwordHash,
    userId
  );

  return c.json({
    success: true,
    message: 'Password changed successfully'
  });
});

// GET /api/auth/profile (protected)
/**
 * La foto de la cuenta. Escribe un fichero y guarda SU RUTA en `users.avatar`; el base64 no
 * entra en la base de datos ni en el JSON de nadie (ver `utils/uploads.ts`). Se sirve sin token
 * porque un `img` no puede mandar cabeceras: quien conoce la URL, ve la foto.
 */
authRoutes.post('/avatar', authMiddleware, async (c) => {
  const userId = c.get('userId') as string;
  const parsed = avatarImageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        message: 'INVALID_IMAGE',
        data: { issues: parsed.error.issues.slice(0, 3) }
      },
      400
    );
  }
  const image = parseImageDataUrl(parsed.data.image);
  if (!image) {
    return c.json(
      {
        success: false,
        message: 'UNSUPPORTED_IMAGE',
        data: { allowed: ['image/jpeg', 'image/png', 'image/webp'] }
      },
      415
    );
  }
  if (image.buffer.byteLength > MAX_AVATAR_BYTES) {
    return c.json(
      { success: false, message: 'IMAGE_TOO_LARGE', data: { maxBytes: MAX_AVATAR_BYTES } },
      413
    );
  }

  const db = getDatabase();
  const previous = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId) as
    { avatar: string | null } | undefined;
  let avatar: string;
  try {
    avatar = storeImage('avatars', userId, image);
  } catch (error) {
    // Si no se puede escribir, NO se guarda la URL: una fila apuntando a la nada es un 404
    // de por vida, y es justo lo que esta prueba evita.
    console.error('[auth] avatar no guardado:', error instanceof Error ? error.message : error);
    return c.json(
      {
        success: false,
        message: 'UPLOAD_WRITE_FAILED',
        data: { detail: error instanceof Error ? error.message : '' }
      },
      500
    );
  }
  db.prepare(`UPDATE users SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    avatar,
    userId
  );
  deleteUpload(previous?.avatar);
  return c.json({ success: true, data: { avatar } });
});

// Quitar la foto: vuelve a la inicial con color, que es lo que la mayoria vera siempre.
authRoutes.delete('/avatar', authMiddleware, async (c) => {
  const userId = c.get('userId') as string;
  const db = getDatabase();
  const current = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId) as
    { avatar: string | null } | undefined;
  db.prepare(`UPDATE users SET avatar = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    userId
  );
  deleteUpload(current?.avatar);
  return c.json({ success: true, data: { avatar: null } });
});

authRoutes.get('/profile', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user) {
    return c.json(
      {
        success: false,
        message: 'User not found'
      },
      404
    );
  }

  return c.json({
    success: true,
    data: sanitizeUser(user)
  });
});

// ═══════════════════════════════════════════════════════════════════
// Perfil de gustos / alergias / objetivo (onboarding + Ajustes)
// ═══════════════════════════════════════════════════════════════════

// GET /api/auth/taste — lo que contestó en el onboarding
authRoutes.get('/taste', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDatabase();

  return c.json({ success: true, data: readTasteResponse(db, userId) });
});

// PATCH /api/auth/taste — guarda el perfil (y el estado del onboarding)
// Se fusiona sobre `users.preferences`, así que Ajustes y onboarding no se
// pisan entre sí ni borran tema/idioma al guardar.
authRoutes.patch('/taste', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const parsed = await readForm(c, updateTasteSchema, 'Perfil');
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const db = getDatabase();
  const saved = saveTasteProfile(db, userId, input);

  return c.json({ success: true, data: saved });
});

// PATCH /api/auth/profile (protected)
authRoutes.patch('/profile', authMiddleware, async (c) => {
  const body = await c.req.json();
  const input = updateProfileSchema.parse(body);
  const userId = c.get('userId');

  const db = getDatabase();
  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }

  if (input.avatar !== undefined) {
    updates.push('avatar = ?');
    values.push(input.avatar);
  }

  if (input.cookingLevel !== undefined) {
    updates.push('cooking_level = ?');
    values.push(input.cookingLevel);
  }

  if (input.preferences !== undefined) {
    updates.push('preferences = ?');
    values.push(JSON.stringify(input.preferences));
  }

  if (updates.length > 0) {
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  return c.json({
    success: true,
    data: sanitizeUser(user)
  });
});

export { authRoutes };
