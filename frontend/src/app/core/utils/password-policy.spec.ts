import {
  MAX_BCRYPT_PASSWORD_BYTES,
  newPasswordIssue,
  passwordUtf8ByteLength
} from './password-policy';

describe('new password policy', () => {
  it('counts ASCII and multibyte characters as UTF-8 bytes', () => {
    const exactAscii = `Aa1${'x'.repeat(69)}`;
    const overAscii = `Aa1${'x'.repeat(70)}`;
    const exactUtf8 = `Aa1${'é'.repeat(34)}a`;
    const overUtf8 = `Aa1${'é'.repeat(35)}`;

    expect(MAX_BCRYPT_PASSWORD_BYTES).toBe(72);
    expect(passwordUtf8ByteLength(exactAscii)).toBe(72);
    expect(passwordUtf8ByteLength(overAscii)).toBe(73);
    expect(passwordUtf8ByteLength(exactUtf8)).toBe(72);
    expect(exactUtf8.length).toBeLessThan(72);
    expect(passwordUtf8ByteLength(overUtf8)).toBe(73);
    expect(overUtf8.length).toBeLessThan(72);
    expect(passwordUtf8ByteLength('🍋'.repeat(18))).toBe(72);
    expect(passwordUtf8ByteLength('🍋'.repeat(19))).toBe(76);
  });

  it('accepts exactly 72 bytes and rejects 73 even when character count is lower', () => {
    const exactUtf8 = `Aa1${'é'.repeat(34)}a`;
    const overUtf8 = `Aa1${'é'.repeat(35)}`;

    expect(newPasswordIssue(`Aa1${'x'.repeat(69)}`)).toBeNull();
    expect(newPasswordIssue(exactUtf8)).toBeNull();
    expect(newPasswordIssue(overUtf8)).toBe('tooLongBytes');
  });

  it('keeps the existing minimum, uppercase and number requirements', () => {
    expect(newPasswordIssue('Abc1')).toBe('tooShort');
    expect(newPasswordIssue('abcdef')).toBe('uppercaseRequired');
    expect(newPasswordIssue('Abcdef')).toBe('numberRequired');
    expect(newPasswordIssue('Abcdef1')).toBeNull();
  });
});
