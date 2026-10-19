import { newPasswordIssue, type NewPasswordIssue } from '../../../core/utils/password-policy';

export type RegisterValidationIssue =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'tooLongBytes'
  | 'invalidEmail'
  | 'uppercaseRequired'
  | 'numberRequired';

export type RegisterNameIssue = Extract<
  RegisterValidationIssue,
  'required' | 'tooShort' | 'tooLong'
>;
export type RegisterEmailIssue = Extract<RegisterValidationIssue, 'required' | 'invalidEmail'>;
export type RegisterPasswordIssue = 'required' | NewPasswordIssue;

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;
const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

export function registerNameIssue(name: string): RegisterNameIssue | null {
  if (!name) return 'required';
  if (name.length < NAME_MIN_LENGTH) return 'tooShort';
  if (name.length > NAME_MAX_LENGTH) return 'tooLong';
  return null;
}

export function registerEmailIssue(email: string): RegisterEmailIssue | null {
  if (!email) return 'required';
  return EMAIL_PATTERN.test(email) ? null : 'invalidEmail';
}

export function registerPasswordIssue(password: string): RegisterPasswordIssue | null {
  if (!password) return 'required';
  return newPasswordIssue(password);
}
