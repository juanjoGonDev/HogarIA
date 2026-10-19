import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { AuthService } from './auth.service';
import { migrateLegacyStorage, STORAGE_KEYS } from './storage.service';
import type { User } from '../../shared/models/user.model';

const TEST_USER: User = {
  id: '1',
  email: 'test@test.com',
  name: 'Test User',
  cookingLevel: 'beginner',
  preferences: {
    theme: 'system',
    language: 'es',
    detailLevel: 'basic',
    notifications: { expirationAlerts: true, mealReminders: true, recipeSuggestions: true }
  },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z')
};

function createToken(expiresInSeconds = 3600): string {
  const payload = {
    sub: TEST_USER.id,
    email: TEST_USER.email,
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };
  return `header.${btoa(JSON.stringify(payload)).replace(/=/g, '')}.signature`;
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: jasmine.SpyObj<Router>;

  function createSignedInService(user: User = TEST_USER, token = createToken()): AuthService {
    localStorage.setItem(STORAGE_KEYS.authToken, token);
    localStorage.setItem(STORAGE_KEYS.refreshToken, 'test-refresh-token');
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(user));
    return new AuthService(TestBed.inject(HttpClient), router);
  }

  beforeEach(() => {
    localStorage.clear();
    const routerSpy = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService, { provide: Router, useValue: routerSpy }]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('login', () => {
    it('should login successfully', () => {
      const credentials = { email: 'test@test.com', password: 'Password1' };
      const mockResponse = {
        user: { id: '1', email: 'test@test.com', name: 'Test User' },
        token: 'mock-token',
        refreshToken: 'mock-refresh-token'
      };

      service.login(credentials).subscribe((response) => {
        expect(response.user.email).toBe('test@test.com');
        expect(service.isAuthenticated()).toBeTrue();
        expect(service.currentUser()?.name).toBe('Test User');
      });

      const req = httpMock.expectOne('/api/auth/login');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(credentials);
      expect(req.request.context.get(SILENT_TOAST)).toBeTrue();
      req.flush(mockResponse);
    });

    it('should handle login error', () => {
      const credentials = { email: 'test@test.com', password: 'wrong' };

      service.login(credentials).subscribe({
        error: (error) => {
          expect(error).toBeTruthy();
          expect(service.isAuthenticated()).toBeFalse();
        }
      });

      const req = httpMock.expectOne('/api/auth/login');
      req.flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    });

    it('should store tokens in localStorage', () => {
      const credentials = { email: 'test@test.com', password: 'Password1' };
      const mockResponse = {
        user: { id: '1', email: 'test@test.com', name: 'Test' },
        token: 'token123',
        refreshToken: 'refresh123'
      };

      service.login(credentials).subscribe();

      const req = httpMock.expectOne('/api/auth/login');
      req.flush(mockResponse);

      expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBe('token123');
      expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe('refresh123');
    });
  });

  describe('register', () => {
    it('should register successfully', () => {
      const data = {
        name: 'New User',
        email: 'new@test.com',
        password: 'Password1',
        cookingLevel: 'beginner' as const
      };

      const mockResponse = {
        user: { id: '2', email: 'new@test.com', name: 'New User' },
        token: 'new-token',
        refreshToken: 'new-refresh'
      };

      service.register(data).subscribe((response) => {
        expect(response.user.name).toBe('New User');
        expect(service.isAuthenticated()).toBeTrue();
      });

      const req = httpMock.expectOne('/api/auth/register');
      expect(req.request.method).toBe('POST');
      req.flush({ data: mockResponse });
    });
  });

  describe('logout', () => {
    it('should clear tokens and redirect to login', () => {
      // Setup logged in state
      localStorage.setItem(STORAGE_KEYS.authToken, 'token');
      localStorage.setItem(STORAGE_KEYS.refreshToken, 'refresh');
      localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify({ id: '1' }));
      localStorage.setItem('auth_token', 'token');
      localStorage.setItem('refresh_token', 'refresh');
      localStorage.setItem('current_user', JSON.stringify({ id: '1' }));

      service.logout();

      expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.currentUser)).toBeNull();
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(localStorage.getItem('current_user')).toBeNull();
      expect(service.isAuthenticated()).toBeFalse();
      expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('does not restore a migrated session after logout and app reload', () => {
      const token = createToken();
      const user = TEST_USER;

      localStorage.setItem('auth_token', token);
      localStorage.setItem('refresh_token', 'legacy-refresh');
      localStorage.setItem('current_user', JSON.stringify(user));
      localStorage.setItem('recipeapp_auth_token', token);
      localStorage.setItem('recipeapp_refresh_token', 'legacy-refresh');
      localStorage.setItem('recipeapp_current_user', JSON.stringify(user));
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('unrelated-key', 'keep-me');
      migrateLegacyStorage();

      const http = TestBed.inject(HttpClient);
      const firstLoad = new AuthService(http, router);
      expect(firstLoad.isAuthenticated()).toBeTrue();

      firstLoad.logout();
      migrateLegacyStorage();

      const afterReload = new AuthService(http, router);
      expect(afterReload.isAuthenticated()).toBeFalse();
      expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.currentUser)).toBeNull();
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      expect(localStorage.getItem('current_user')).toBeNull();
      expect(localStorage.getItem('recipeapp_auth_token')).toBeNull();
      expect(localStorage.getItem('recipeapp_refresh_token')).toBeNull();
      expect(localStorage.getItem('recipeapp_current_user')).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('dark');
      expect(localStorage.getItem('theme')).toBe('dark');
      expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
    });
  });

  describe('refreshToken', () => {
    it('logs out and completes without a request when no refresh token exists', () => {
      let completed = false;
      service.refreshToken().subscribe({ complete: () => (completed = true) });

      expect(completed).toBeTrue();
      expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
      httpMock.expectNone('/api/auth/refresh');
    });

    it('stores a refreshed session from the wrapped response', () => {
      const response = {
        user: TEST_USER,
        token: 'refreshed-access',
        refreshToken: 'refreshed-refresh'
      };
      localStorage.setItem(STORAGE_KEYS.refreshToken, 'old-refresh');
      service.refreshToken().subscribe((result) => expect(result.token).toBe(response.token));

      const request = httpMock.expectOne('/api/auth/refresh');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ refreshToken: 'old-refresh' });
      request.flush({ data: response });

      expect(service.isAuthenticated()).toBeTrue();
      expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBe(response.token);
      expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBe(response.refreshToken);
    });

    it('logs out if the refresh request fails', () => {
      localStorage.setItem(STORAGE_KEYS.refreshToken, 'expired-refresh');
      service.refreshToken().subscribe();

      const request = httpMock.expectOne('/api/auth/refresh');
      request.flush({ message: 'expired' }, { status: 401, statusText: 'Unauthorized' });

      expect(service.isAuthenticated()).toBeFalse();
      expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBeNull();
      expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });

  describe('getToken', () => {
    it('should return token from localStorage', () => {
      localStorage.setItem(STORAGE_KEYS.authToken, 'test-token');
      expect(service.getToken()).toBe('test-token');
    });

    it('should return null if no token', () => {
      expect(service.getToken()).toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('should return false when not logged in', () => {
      expect(service.isAuthenticated()).toBeFalse();
    });

    it('should return true when logged in with valid token', () => {
      // A new instance models application startup; TestBed.inject() returns the existing singleton.
      service = createSignedInService();

      expect(service.isAuthenticated()).toBeTrue();
    });
  });

  describe('session restoration', () => {
    it('clears an expired token instead of restoring the user', () => {
      localStorage.setItem(STORAGE_KEYS.authToken, createToken(-3600));
      localStorage.setItem(STORAGE_KEYS.refreshToken, 'expired-refresh');
      localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(TEST_USER));

      const restored = new AuthService(TestBed.inject(HttpClient), router);

      expect(restored.isAuthenticated()).toBeFalse();
      expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.refreshToken)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.currentUser)).toBeNull();
    });

    it('clears a token it cannot decode', () => {
      localStorage.setItem(STORAGE_KEYS.authToken, 'not-a-jwt');
      localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(TEST_USER));

      const restored = new AuthService(TestBed.inject(HttpClient), router);

      expect(restored.isAuthenticated()).toBeFalse();
      expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBeNull();
    });

    it('clears malformed stored user data', () => {
      localStorage.setItem(STORAGE_KEYS.authToken, createToken());
      localStorage.setItem(STORAGE_KEYS.currentUser, '{not-json');

      const restored = new AuthService(TestBed.inject(HttpClient), router);

      expect(restored.isAuthenticated()).toBeFalse();
      expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.currentUser)).toBeNull();
    });
  });

  describe('forgotPassword', () => {
    it('should send forgot password request', () => {
      service.forgotPassword('test@test.com').subscribe();

      const req = httpMock.expectOne('/api/auth/forgot-password');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'test@test.com' });
      expect(req.request.context.get(SILENT_TOAST)).toBeTrue();
      req.flush({});
    });

    it('changes a password with the old and new credentials', () => {
      service.changePassword('old-password', 'new-password').subscribe();

      const request = httpMock.expectOne('/api/auth/change-password');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        oldPassword: 'old-password',
        newPassword: 'new-password'
      });
      expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
      request.flush({});
    });

    it('resets a password with the reset token', () => {
      service.resetPassword('reset-token', 'new-password').subscribe();

      const request = httpMock.expectOne('/api/auth/reset-password');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ token: 'reset-token', newPassword: 'new-password' });
      request.flush({});
    });
  });

  describe('profile and avatar', () => {
    it('updates the profile cache from a wrapped response', () => {
      const updatedUser = { ...TEST_USER, name: 'Updated User' };
      service
        .updateProfile({ name: updatedUser.name })
        .subscribe((user) => expect(user).toEqual(updatedUser));

      const request = httpMock.expectOne('/api/auth/profile');
      expect(request.request.method).toBe('PATCH');
      request.flush({ data: updatedUser });

      expect(service.currentUser()).toEqual(updatedUser);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.currentUser) ?? 'null')).toEqual(
        JSON.parse(JSON.stringify(updatedUser))
      );
    });

    it('accepts a flattened profile response', () => {
      const updatedUser = { ...TEST_USER, name: 'Flat Response' };
      service.updateProfile({ name: updatedUser.name }).subscribe();

      httpMock.expectOne('/api/auth/profile').flush(updatedUser);

      expect(service.currentUser()).toEqual(updatedUser);
    });

    it('stores an uploaded avatar for the current user', () => {
      const signedIn = createSignedInService({ ...TEST_USER, avatar: 'old-avatar.png' });
      const image = 'data:image/png;base64,synthetic';
      signedIn
        .uploadAvatar(image)
        .subscribe((avatar) => expect(avatar).toBe('/uploads/avatar.png'));

      const request = httpMock.expectOne('/api/auth/avatar');
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ image });
      request.flush({ data: { avatar: '/uploads/avatar.png' } });

      expect(signedIn.currentUser()?.avatar).toBe('/uploads/avatar.png');
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.currentUser) ?? 'null').avatar).toBe(
        '/uploads/avatar.png'
      );
    });

    it('removes the avatar from the current user after a successful delete', () => {
      const signedIn = createSignedInService({ ...TEST_USER, avatar: 'old-avatar.png' });
      signedIn.removeAvatar().subscribe((avatar) => expect(avatar).toBeNull());

      const request = httpMock.expectOne('/api/auth/avatar');
      expect(request.request.method).toBe('DELETE');
      request.flush({});

      expect(signedIn.currentUser()?.avatar).toBeUndefined();
      expect(
        JSON.parse(localStorage.getItem(STORAGE_KEYS.currentUser) ?? 'null').avatar
      ).toBeUndefined();
    });

    it('returns an uploaded avatar without changing an absent user cache', () => {
      service
        .uploadAvatar('synthetic-image')
        .subscribe((avatar) => expect(avatar).toBe('/uploads/avatar.png'));

      httpMock.expectOne('/api/auth/avatar').flush({ data: { avatar: '/uploads/avatar.png' } });

      expect(service.currentUser()).toBeNull();
      expect(localStorage.getItem(STORAGE_KEYS.currentUser)).toBeNull();
    });

    it('normalizes an empty upload response to null', () => {
      service.uploadAvatar('synthetic-image').subscribe((avatar) => expect(avatar).toBeNull());

      httpMock.expectOne('/api/auth/avatar').flush({ data: {} });
      expect(service.currentUser()).toBeNull();
    });
  });
});
