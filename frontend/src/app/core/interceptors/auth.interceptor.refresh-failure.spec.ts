import { HttpErrorResponse, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, Subscription, of, throwError } from 'rxjs';
import { authResponse } from './auth.interceptor.test-fixtures';
import { AuthService } from '../services/auth.service';
import { authInterceptor } from './auth.interceptor';
import { I18nService } from '../services/i18n.service';

describe('authInterceptor refresh failure regression', () => {
  let authService: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    authService = jasmine.createSpyObj<AuthService>('AuthService', [
      'getToken',
      'refreshToken',
      'logout'
    ]);
    authService.getToken.and.returnValue('expired-access-token');
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: I18nService, useValue: { resolved: () => 'en' } }
      ]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('rejects the original failures instead of completing or hanging when refresh completes empty', () => {
    const refresh = new Subject<ReturnType<typeof authResponse>>();
    authService.refreshToken.and.returnValue(refresh);
    const first401 = new HttpErrorResponse({ status: 401, url: '/api/pantry' });
    const second401 = new HttpErrorResponse({ status: 401, url: '/api/recipes' });
    const first = collect('/api/pantry', () => throwError(() => first401));
    const second = collect('/api/recipes', () => throwError(() => second401));

    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    // AuthService logs out before completing empty on a rejected/missing refresh token.
    authService.getToken.and.returnValue(null);
    authService.logout();
    refresh.complete();

    expect(first.error).toBe(first401);
    expect(second.error).toBe(second401);
    expect(first.completed).toBe(false);
    expect(second.completed).toBe(false);
    expect(authService.logout).toHaveBeenCalledTimes(1);

    first.subscription.unsubscribe();
    second.subscription.unsubscribe();

    authService.getToken.and.returnValue('next-access-token');
    authService.refreshToken.and.returnValue(of(authResponse('recovered-access-token')));
    let attempt = 0;
    const recovered = collect('/api/shopping', (request) => {
      if (attempt++ === 0) return throwError(() => new HttpErrorResponse({ status: 401 }));
      expect(request.headers.get('Authorization')).toBe('Bearer recovered-access-token');
      expect(request.headers.get('X-App-Language')).toBe('en');
      return of(new HttpResponse({ status: 200 }));
    });

    expect(recovered.error).toBeUndefined();
    expect(recovered.completed).toBe(true);
    expect(authService.refreshToken).toHaveBeenCalledTimes(2);
  });

  function collect(
    url: string,
    next: HttpHandlerFn
  ): {
    error?: unknown;
    completed: boolean;
    subscription: Subscription;
  } {
    const result: { error?: unknown; completed: boolean; subscription?: Subscription } = {
      completed: false
    };
    result.subscription = TestBed.runInInjectionContext(() =>
      authInterceptor(new HttpRequest('GET', url), next).subscribe({
        error: (cause) => (result.error = cause),
        complete: () => (result.completed = true)
      })
    );
    return result as { error?: unknown; completed: boolean; subscription: Subscription };
  }
});
