export const MAX_BCRYPT_PASSWORD_BYTES = 72;

export type NewPasswordIssue = 'tooShort' | 'tooLongBytes' | 'uppercaseRequired' | 'numberRequired';

const utf8Encoder = new TextEncoder();

export function passwordUtf8ByteLength(password: string): number {
  return utf8Encoder.encode(password).byteLength;
}

export function newPasswordIssue(password: string): NewPasswordIssue | null {
  if (password.length < 6) return 'tooShort';
  if (passwordUtf8ByteLength(password) > MAX_BCRYPT_PASSWORD_BYTES) return 'tooLongBytes';
  if (!/[A-Z]/.test(password)) return 'uppercaseRequired';
  if (!/[0-9]/.test(password)) return 'numberRequired';
  return null;
}
