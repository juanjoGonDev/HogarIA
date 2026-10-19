import { originalHttpError } from '../../core/services/shopping-http-error';

export type PasswordChangeErrorKey =
  'account.la_contrasena_actual_no' | 'account.no_se_pudo_cambiar';

/** Resolve the server's specific wrong-current-password reason through the shared HTTP interceptor. */
export function passwordChangeErrorKey(error: unknown): PasswordChangeErrorKey {
  const message = originalHttpError(error)?.error?.message;
  return typeof message === 'string' && message.toLowerCase().includes('incorrect')
    ? 'account.la_contrasena_actual_no'
    : 'account.no_se_pudo_cambiar';
}
