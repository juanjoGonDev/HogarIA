import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, map, catchError, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { LEGACY_AUTH_KEYS, STORAGE_KEYS } from './storage.service';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import {
  User,
  AuthCredentials,
  RegisterData,
  AuthResponse,
  TokenPayload
} from '../../shared/models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly apiUrl = `${environment.apiUrl}/auth`;
  private readonly TOKEN_KEY = STORAGE_KEYS.authToken;
  private readonly REFRESH_TOKEN_KEY = STORAGE_KEYS.refreshToken;
  private readonly USER_KEY = STORAGE_KEYS.currentUser;

  // Signals for reactive state
  private currentUserSignal = signal<User | null>(null);
  private isAuthenticatedSignal = signal<boolean>(false);
  private isLoadingSignal = signal<boolean>(false);

  // Public computed signals
  readonly currentUser = this.currentUserSignal.asReadonly();
  readonly isAuthenticated = this.isAuthenticatedSignal.asReadonly();
  readonly isLoading = this.isLoadingSignal.asReadonly();
  readonly userName = computed(() => this.currentUserSignal()?.name || '');
  readonly userId = computed(() => this.currentUserSignal()?.id || '');

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    this.initializeFromStorage();
  }

  private initializeFromStorage(): void {
    const token = this.getToken();
    const user = this.getStoredUser();

    if (token && user && !this.isTokenExpired(token)) {
      this.currentUserSignal.set(user);
      this.isAuthenticatedSignal.set(true);
    } else {
      this.clearStorage();
    }
  }

  login(credentials: AuthCredentials): Observable<AuthResponse> {
    this.isLoadingSignal.set(true);

    return this.http
      .post<any>(`${this.apiUrl}/login`, credentials, {
        // LoginComponent owns recoverable errors; a global toast would duplicate its feedback.
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(
        map((response) => this.unwrap(response)),
        tap((response) => {
          this.handleAuthResponse(response);
          this.isLoadingSignal.set(false);
        }),
        catchError((error) => {
          this.isLoadingSignal.set(false);
          throw error;
        })
      );
  }

  register(data: RegisterData): Observable<AuthResponse> {
    this.isLoadingSignal.set(true);

    return this.http
      .post<any>(`${this.apiUrl}/register`, data, {
        context: new HttpContext().set(SILENT_TOAST, true)
      })
      .pipe(
        map((response) => this.unwrap(response)),
        tap((response) => {
          this.handleAuthResponse(response);
          this.isLoadingSignal.set(false);
        }),
        catchError((error) => {
          this.isLoadingSignal.set(false);
          throw error;
        })
      );
  }

  /**
   * The backend wraps responses in `{ success, data: {...} }`.
   * Accept either shape so the service works if the backend is ever flattened.
   */
  private unwrap(response: any): AuthResponse {
    if (response && response.data && response.data.token) {
      return response.data as AuthResponse;
    }
    return response as AuthResponse;
  }

  logout(): void {
    this.clearStorage();
    this.currentUserSignal.set(null);
    this.isAuthenticatedSignal.set(false);
    this.router.navigate(['/auth/login']);
  }

  refreshToken(): Observable<AuthResponse> {
    const refreshToken = this.getRefreshToken();

    if (!refreshToken) {
      this.logout();
      return of();
    }

    return this.http.post<any>(`${this.apiUrl}/refresh`, { refreshToken }).pipe(
      map((response) => this.unwrap(response)),
      tap((response) => this.handleAuthResponse(response)),
      catchError(() => {
        this.logout();
        return of();
      })
    );
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  private handleAuthResponse(response: AuthResponse): void {
    localStorage.setItem(this.TOKEN_KEY, response.token);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, response.refreshToken);
    localStorage.setItem(this.USER_KEY, JSON.stringify(response.user));

    this.currentUserSignal.set(response.user);
    this.isAuthenticatedSignal.set(true);
  }

  private clearStorage(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    for (const key of LEGACY_AUTH_KEYS) localStorage.removeItem(key);
  }

  private getStoredUser(): User | null {
    const userStr = localStorage.getItem(this.USER_KEY);
    if (!userStr) return null;

    try {
      return JSON.parse(userStr) as User;
    } catch {
      return null;
    }
  }

  private isTokenExpired(token: string): boolean {
    try {
      const payload = this.decodeToken(token);
      return payload.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  }

  private decodeToken(token: string): TokenPayload {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload) as TokenPayload;
  }

  updateProfile(userData: Partial<User>): Observable<User> {
    return this.http.patch(`${this.apiUrl}/profile`, userData).pipe(
      map((response: any) => (response?.data ? response.data : response) as User),
      tap((user) => {
        this.currentUserSignal.set(user);
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      })
    );
  }

  /**
   * La foto de la cuenta. El servidor guarda un fichero y devuelve SU RUTA —no los bytes—, y el
   * usuario en cache se actualiza con ella: si no, al volver de la foto seguiria viendo la inicial
   * hasta recargar.
   */
  uploadAvatar(image: string): Observable<string | null> {
    return this.http
      .post<{ data: { avatar: string | null } }>(`${this.apiUrl}/avatar`, { image })
      .pipe(map((response) => this.applyAvatar(response.data?.avatar ?? null)));
  }

  removeAvatar(): Observable<null> {
    return this.http.delete(`${this.apiUrl}/avatar`).pipe(
      map(() => {
        this.applyAvatar(null);
        return null;
      })
    );
  }

  private applyAvatar(avatar: string | null): string | null {
    const current = this.currentUserSignal();
    if (!current) return avatar;
    const next: User = { ...current, avatar: avatar ?? undefined };
    this.currentUserSignal.set(next);
    localStorage.setItem(this.USER_KEY, JSON.stringify(next));
    return avatar;
  }

  changePassword(oldPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/change-password`,
      {
        oldPassword,
        newPassword
      },
      {
        // AccountComponent translates the reason beside the fields; a global toast would duplicate
        // the inline message and expose the server's English detail.
        context: new HttpContext().set(SILENT_TOAST, true)
      }
    );
  }

  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/forgot-password`,
      { email },
      { context: new HttpContext().set(SILENT_TOAST, true) }
    );
  }

  resetPassword(token: string, newPassword: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/reset-password`, {
      token,
      newPassword
    });
  }
}
