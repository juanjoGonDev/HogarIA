import type { AuthResponse } from '../../shared/models/user.model';

export function authResponse(token: string): AuthResponse {
  return {
    token,
    refreshToken: 'synthetic-refresh-token',
    user: {
      id: 'auth-interceptor-user',
      email: 'auth-interceptor@example.test',
      name: 'Auth Interceptor',
      cookingLevel: 'beginner',
      preferences: {
        theme: 'system',
        language: 'es',
        detailLevel: 'basic',
        notifications: {
          expirationAlerts: false,
          mealReminders: false,
          recipeSuggestions: false
        }
      },
      createdAt: new Date(0),
      updatedAt: new Date(0)
    }
  };
}
