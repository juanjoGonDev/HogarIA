import { HttpErrorResponse } from '@angular/common/http';

import { passwordChangeErrorKey } from './account-password-error';

describe('passwordChangeErrorKey', () => {
  it('reads a wrong-current-password reason through the interceptor wrapper', () => {
    const original = new HttpErrorResponse({
      status: 400,
      error: { message: 'Current password is incorrect' }
    });

    expect(
      passwordChangeErrorKey({
        status: 400,
        message: 'Bad request',
        original
      })
    ).toBe('account.la_contrasena_actual_no');
  });

  it('keeps compatibility with an unwrapped HTTP response', () => {
    const response = new HttpErrorResponse({
      status: 400,
      error: { message: 'Current password is incorrect' }
    });

    expect(passwordChangeErrorKey(response)).toBe('account.la_contrasena_actual_no');
  });

  it('uses the generic key for network and unrelated server errors', () => {
    expect(
      passwordChangeErrorKey({
        status: 503,
        message: 'Service unavailable',
        original: new HttpErrorResponse({
          status: 503,
          error: { message: 'Service unavailable' }
        })
      })
    ).toBe('account.no_se_pudo_cambiar');
  });
});
