import { z } from 'zod';

export const MAX_BCRYPT_PASSWORD_BYTES = 72;

/** bcrypt uses at most 72 bytes; count the encoded value, not JavaScript characters. */
export const bcryptPasswordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .refine(
    (password) => Buffer.byteLength(password, 'utf8') <= MAX_BCRYPT_PASSWORD_BYTES,
    `Password must not exceed ${MAX_BCRYPT_PASSWORD_BYTES} UTF-8 bytes`
  );
