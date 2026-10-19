import {
  registerNameIssue,
  registerEmailIssue,
  registerPasswordIssue,
  type RegisterPasswordIssue
} from './register-form.validation';

describe('register form validation', () => {
  it('matches the backend name length boundaries', () => {
    expect(registerNameIssue('')).toBe('required');
    expect(registerNameIssue('A')).toBe('tooShort');
    expect(registerNameIssue('Ab')).toBeNull();
    expect(registerNameIssue('N'.repeat(100))).toBeNull();
    expect(registerNameIssue('N'.repeat(101))).toBe('tooLong');
  });

  it('matches the backend email format', () => {
    expect(registerEmailIssue('')).toBe('required');
    expect(registerEmailIssue('not-an-email')).toBe('invalidEmail');
    expect(registerEmailIssue('ana@localhost')).toBe('invalidEmail');
    expect(registerEmailIssue('ana@example.c')).toBe('invalidEmail');
    expect(registerEmailIssue('ana..smith@example.com')).toBe('invalidEmail');
    expect(registerEmailIssue('ana@example.com')).toBeNull();
    expect(registerEmailIssue('first.last+tag@sub.example.co')).toBeNull();
  });

  it('matches the backend password requirements in validation order', () => {
    const cases: [string, RegisterPasswordIssue | null][] = [
      ['', 'required'],
      ['Abc1', 'tooShort'],
      ['abcdef1', 'uppercaseRequired'],
      ['Abcdef', 'numberRequired'],
      ['Ábcde1', 'uppercaseRequired'],
      ['Abcde1', null]
    ];

    for (const [password, issue] of cases) {
      expect(registerPasswordIssue(password)).withContext(password).toBe(issue);
    }
  });

  it('limits passwords by UTF-8 bytes instead of visible characters', () => {
    const at72Bytes = `Aa1${'é'.repeat(34)}a`;
    const at73Bytes = `Aa1${'é'.repeat(35)}`;

    expect(new TextEncoder().encode(at72Bytes).length).toBe(72);
    expect(new TextEncoder().encode(at73Bytes).length).toBe(73);
    expect(at72Bytes.length).toBeLessThan(72);
    expect(at73Bytes.length).toBeLessThan(72);
    expect(registerPasswordIssue(at72Bytes)).toBeNull();
    expect(registerPasswordIssue(at73Bytes)).toBe('tooLongBytes');
  });
});
