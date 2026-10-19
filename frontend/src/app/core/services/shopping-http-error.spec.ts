import { HttpErrorResponse } from '@angular/common/http';
import { originalHttpError } from './shopping-http-error';

describe('originalHttpError', () => {
  it('desempaqueta el HttpErrorResponse conservado por el interceptor', () => {
    const original = new HttpErrorResponse({
      status: 409,
      statusText: 'Conflict',
      error: { message: 'AI_NOT_CONFIGURED' }
    });

    expect(originalHttpError({ status: 409, original })).toBe(original);
  });

  it('conserva una respuesta HTTP directa sin wrapper', () => {
    const response = new HttpErrorResponse({
      status: 502,
      statusText: 'Bad Gateway',
      error: { message: 'AI_UNAVAILABLE' }
    });

    expect(originalHttpError(response)).toBe(response);
  });
});
