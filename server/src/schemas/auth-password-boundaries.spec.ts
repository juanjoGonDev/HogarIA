import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema
} from './auth.schema.js';

const asciiAtLimit = `Aa1${'x'.repeat(69)}`;
const asciiOverLimit = `Aa1${'x'.repeat(70)}`;
const utf8AtLimit = `Aa1${'é'.repeat(34)}a`;
const utf8OverLimit = `Aa1${'é'.repeat(35)}`;

const setters = [
  {
    name: 'registro',
    accepts: (password: string) =>
      registerSchema.safeParse({ name: 'Ana', email: 'ana@example.com', password }).success
  },
  {
    name: 'restablecimiento',
    accepts: (password: string) =>
      resetPasswordSchema.safeParse({ token: 'synthetic-reset-token', newPassword: password })
        .success
  },
  {
    name: 'cambio desde la cuenta',
    accepts: (password: string) =>
      changePasswordSchema.safeParse({ oldPassword: 'Clave1234', newPassword: password }).success
  }
];

describe('limite bcrypt para credenciales nuevas', () => {
  it('cuenta bytes UTF-8, acepta 72 y rechaza 73 en cada punto de escritura', () => {
    expect(Buffer.byteLength(asciiAtLimit, 'utf8')).toBe(72);
    expect(Buffer.byteLength(asciiOverLimit, 'utf8')).toBe(73);
    expect(Buffer.byteLength(utf8AtLimit, 'utf8')).toBe(72);
    expect(utf8AtLimit.length).toBeLessThan(72);
    expect(Buffer.byteLength(utf8OverLimit, 'utf8')).toBe(73);
    expect(utf8OverLimit.length).toBeLessThan(72);

    for (const setter of setters) {
      expect(setter.accepts(asciiAtLimit), setter.name).toBe(true);
      expect(setter.accepts(utf8AtLimit), `${setter.name}, UTF-8`).toBe(true);
      expect(setter.accepts(asciiOverLimit), `${setter.name}, ASCII`).toBe(false);
      expect(setter.accepts(utf8OverLimit), `${setter.name}, UTF-8`).toBe(false);
    }
  });

  it('no añade un límite nuevo al login ni a la contraseña actual', () => {
    const longExistingPassword = 'legacy-password-'.repeat(8);

    expect(
      loginSchema.safeParse({ email: 'ana@example.com', password: longExistingPassword }).success
    ).toBe(true);
    expect(
      changePasswordSchema.safeParse({
        oldPassword: longExistingPassword,
        newPassword: asciiAtLimit
      }).success
    ).toBe(true);
  });
});
