import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import {
  BehaviorSubject,
  catchError,
  defaultIfEmpty,
  filter,
  switchMap,
  take,
  throwError
} from 'rxjs';
import { AuthService } from '../services/auth.service';
import { I18nService } from '../services/i18n.service';

type RefreshState = { kind: 'success'; token: string } | { kind: 'failure' } | null;

// Prevent infinite refresh loops when several requests fail with 401 at once.
let isRefreshing = false;
let refreshTokenSubject = new BehaviorSubject<RefreshState>(null);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  // Never attach auth to login / register / refresh / public endpoints
  const isAuthEndpoint =
    req.url.includes('/auth/login') ||
    req.url.includes('/auth/register') ||
    req.url.includes('/auth/forgot-password') ||
    req.url.includes('/auth/reset-password');

  if (isAuthEndpoint) {
    return next(req);
  }

  const appLanguage = inject(I18nService).resolved();

  // Add token to request if available
  if (token) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
        'X-App-Language': appLanguage
      }
    });
  } else {
    req = req.clone({ setHeaders: { 'X-App-Language': appLanguage } });
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // If 401, try to refresh token (but don't trigger refresh from /refresh itself)
      if (error.status === 401 && token && !req.url.includes('/auth/refresh')) {
        if (!isRefreshing) {
          isRefreshing = true;
          refreshTokenSubject.next(null);

          const refresh$ = authService.refreshToken().pipe(
            // AuthService logs out and completes empty when refresh credentials are missing
            // or rejected. Turn that completion into a value so waiters receive a failure too.
            defaultIfEmpty(null),
            catchError((refreshError) => {
              isRefreshing = false;
              refreshTokenSubject.next({ kind: 'failure' });
              authService.logout();
              return throwError(() => refreshError);
            })
          );

          return refresh$.pipe(
            switchMap((response) => {
              isRefreshing = false;
              if (response === null) {
                // AuthService already closed the session before its empty completion.
                refreshTokenSubject.next({ kind: 'failure' });
                return throwError(() => error);
              }

              const newToken = response?.token || authService.getToken();
              if (!newToken) {
                refreshTokenSubject.next({ kind: 'failure' });
                authService.logout();
                return throwError(() => error);
              }

              refreshTokenSubject.next({ kind: 'success', token: newToken });
              const clonedReq = req.clone({
                setHeaders: { Authorization: `Bearer ${newToken}` }
              });
              return next(clonedReq);
            })
          );
        } else {
          // Wait for the in-flight refresh to finish, then retry
          return refreshTokenSubject.pipe(
            filter((state): state is Exclude<RefreshState, null> => state !== null),
            take(1),
            switchMap((state) => {
              if (state.kind === 'failure') return throwError(() => error);
              const clonedReq = req.clone({
                setHeaders: { Authorization: `Bearer ${state.token}` }
              });
              return next(clonedReq);
            }),
            catchError(() => throwError(() => error))
          );
        }
      }

      return throwError(() => error);
    })
  );
};
