import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth.schema.js';

const valid = { name: 'Ana', email: 'ana@example.com', password: 'Abcde1' };

describe('registerSchema boundaries used by the register form', () => {
  it('accepts the inclusive name and password boundaries', () => {
    expect(registerSchema.safeParse({ ...valid, name: 'Ab' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, name: 'N'.repeat(100) }).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, password: 'Abcde1' }).success).toBe(true);
  });

  it('rejects out-of-range names and malformed email', () => {
    for (const name of ['A', 'N'.repeat(101)]) {
      expect(registerSchema.safeParse({ ...valid, name }).success).toBe(false);
    }
    for (const email of [
      'not-an-email',
      'ana@localhost',
      'ana@example.c',
      'ana..smith@example.com'
    ]) {
      expect(registerSchema.safeParse({ ...valid, email }).success).toBe(false);
    }
    expect(
      registerSchema.safeParse({ ...valid, email: 'first.last+tag@sub.example.co' }).success
    ).toBe(true);
  });

  it('requires six characters, an ASCII uppercase letter and an ASCII digit', () => {
    for (const password of ['Abc1', 'abcdef1', 'Abcdef', 'Ábcde1']) {
      expect(registerSchema.safeParse({ ...valid, password }).success).toBe(false);
    }
  });
});
