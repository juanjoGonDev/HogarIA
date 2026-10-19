import { HttpErrorResponse, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, Subscription, of, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { I18nService } from '../services/i18n.service';
import { authInterceptor } from './auth.interceptor';
import { authResponse } from './auth.interceptor.test-fixtures';

describe('authInterceptor', () => {
  let authService: jasmine.SpyObj<AuthService>;
  let resolvedLanguage: 'es' | 'en';

  beforeEach(() => {
    authService = jasmine.createSpyObj<AuthService>('AuthService', [
      'getToken',
      'refreshToken',
      'logout'
    ]);
    authService.getToken.and.returnValue('old-access-token');
    authService.refreshToken.and.returnValue(of(authResponse('fresh-access-token')));
    resolvedLanguage = 'es';
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: I18nService, useValue: { resolved: () => resolvedLanguage } }
      ]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('does not attach an access token to public auth endpoints', () => {
    for (const url of [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/forgot-password',
      '/api/auth/reset-password'
    ]) {
      let sent: HttpRequest<unknown> | undefined;
      collect(url, (request) => {
        sent = request;
        return of(new HttpResponse({ status: 200 }));
      });

      expect(sent?.headers.has('Authorization')).withContext(url).toBe(false);
    }
  });

  it('attaches the cached token to protected requests', () => {
    let sent: HttpRequest<unknown> | undefined;
    collect('/api/pantry', (request) => {
      sent = request;
      return of(new HttpResponse({ status: 200 }));
    });

    expect(sent?.headers.get('Authorization')).toBe('Bearer old-access-token');
    expect(sent?.headers.get('X-App-Language')).toBe('es');
  });

  it('sends the resolved English app locale rather than the auto selector value', () => {
    resolvedLanguage = 'en';
    let sent: HttpRequest<unknown> | undefined;
    collect('/api/ai/generate-recipe', (request) => {
      sent = request;
      return of(new HttpResponse({ status: 200 }));
    });

    expect(sent?.headers.get('X-App-Language')).toBe('en');
  });

  it('does not attempt a refresh when no access token exists', () => {
    authService.getToken.and.returnValue(null);
    const original = new HttpErrorResponse({ status: 401, url: '/api/pantry' });
    const result = collect('/api/pantry', () => throwError(() => original));

    expect(result.error).toBe(original);
    expect(result.completed).toBe(false);
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  it('refreshes once and retries a protected request with the new token', () => {
    const requests: HttpRequest<unknown>[] = [];
    const original = new HttpErrorResponse({ status: 401, url: '/api/pantry' });
    let attempt = 0;
    const result = collect('/api/pantry', (request) => {
      requests.push(request);
      return attempt++ === 0
        ? throwError(() => original)
        : of(new HttpResponse({ status: 200, body: 'retried' }));
    });

    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect(requests.map((request) => request.headers.get('Authorization'))).toEqual([
      'Bearer old-access-token',
      'Bearer fresh-access-token'
    ]);
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(true);
  });

  it('does not log out when the successfully retried resource fails', () => {
    const serviceFailure = new HttpErrorResponse({ status: 503, url: '/api/pantry' });
    let attempt = 0;
    const result = collect('/api/pantry', () =>
      attempt++ === 0
        ? throwError(() => new HttpErrorResponse({ status: 401, url: '/api/pantry' }))
        : throwError(() => serviceFailure)
    );

    expect(result.error).toBe(serviceFailure);
    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('shares one successful refresh across concurrent protected requests', () => {
    const refresh = new Subject<ReturnType<typeof authResponse>>();
    authService.refreshToken.and.returnValue(refresh);
    const seen: string[] = [];
    const attempts = new Map<string, number>();
    const next: HttpHandlerFn = (request) => {
      const attempt = (attempts.get(request.url) ?? 0) + 1;
      attempts.set(request.url, attempt);
      seen.push(`${request.url}:${request.headers.get('Authorization')}`);
      return attempt === 1
        ? throwError(() => new HttpErrorResponse({ status: 401, url: request.url }))
        : of(new HttpResponse({ status: 200, body: request.url }));
    };

    const first = collect('/api/pantry', next);
    const second = collect('/api/recipes', next);
    expect(authService.refreshToken).toHaveBeenCalledTimes(1);
    expect(first.completed).toBe(false);
    expect(second.completed).toBe(false);

    refresh.next(authResponse('shared-fresh-token'));
    refresh.complete();

    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    expect(first.completed).toBe(true);
    expect(second.completed).toBe(true);
    expect(seen).toContain('/api/pantry:Bearer shared-fresh-token');
    expect(seen).toContain('/api/recipes:Bearer shared-fresh-token');
  });

  it('releases concurrent requests when the refresh request errors', () => {
    const refreshFailure = new HttpErrorResponse({ status: 503, url: '/api/auth/refresh' });
    const refresh = new Subject<ReturnType<typeof authResponse>>();
    authService.refreshToken.and.returnValue(refresh);
    const first401 = new HttpErrorResponse({ status: 401, url: '/api/pantry' });
    const second401 = new HttpErrorResponse({ status: 401, url: '/api/recipes' });
    const first = collect('/api/pantry', () => throwError(() => first401));
    const second = collect('/api/recipes', () => throwError(() => second401));

    refresh.error(refreshFailure);

    expect(first.error).toBe(refreshFailure);
    expect(second.error).toBe(second401);
    expect(first.completed).toBe(false);
    expect(second.completed).toBe(false);
    expect(authService.logout).toHaveBeenCalledTimes(1);
    first.subscription.unsubscribe();
    second.subscription.unsubscribe();
  });

  it('logs out when the refresh response has no usable token', () => {
    authService.refreshToken.and.returnValue(of(authResponse('')));
    authService.getToken.and.returnValues('old-access-token', null);
    const original = new HttpErrorResponse({ status: 401 });
    const result = collect('/api/pantry', () => throwError(() => original));

    expect(result.error).toBe(original);
    expect(authService.logout).toHaveBeenCalledTimes(1);
  });

  it('falls back to the token persisted by AuthService after refresh', () => {
    authService.refreshToken.and.returnValue(of(authResponse('')));
    authService.getToken.and.returnValues('old-access-token', 'persisted-fresh-token');
    const requests: HttpRequest<unknown>[] = [];
    let attempt = 0;
    collect('/api/pantry', (request) => {
      requests.push(request);
      return attempt++ === 0
        ? throwError(() => new HttpErrorResponse({ status: 401 }))
        : of(new HttpResponse({ status: 200 }));
    });

    expect(requests[1]?.headers.get('Authorization')).toBe('Bearer persisted-fresh-token');
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('does not recursively refresh a 401 from the refresh endpoint', () => {
    const original = new HttpErrorResponse({ status: 401, url: '/api/auth/refresh' });
    let sent: HttpRequest<unknown> | undefined;
    const result = collect('/api/auth/refresh', (request) => {
      sent = request;
      return throwError(() => original);
    });

    expect(result.error).toBe(original);
    expect(sent?.headers.get('Authorization')).toBe('Bearer old-access-token');
    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  function intercept(url: string, next: HttpHandlerFn): Observable<unknown> {
    return TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', url), next));
  }

  function collect(
    url: string,
    next: HttpHandlerFn
  ): { error?: unknown; completed: boolean; subscription: Subscription } {
    const result: { error?: unknown; completed: boolean; subscription?: Subscription } = {
      completed: false
    };
    result.subscription = intercept(url, next).subscribe({
      error: (cause) => (result.error = cause),
      complete: () => (result.completed = true)
    });
    return result as { error?: unknown; completed: boolean; subscription: Subscription };
  }
});
