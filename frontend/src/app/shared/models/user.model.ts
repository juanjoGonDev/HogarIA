import type { CookingLevel } from './home-profile';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  householdId?: string;
  cookingLevel: CookingLevel;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

export type { CookingLevel } from './home-profile';

export interface UserPreferences {
  theme: Theme;
  language: Language;
  detailLevel: DetailLevel;
  notifications: NotificationPreferences;
  /** Preferencia personal de presentación de la biblioteca de recetas. */
  recipeViewMode?: 'grid' | 'list';
  /**
   * Gustos, alergias y objetivo (ver TasteProfile). Lo rellena el onboarding y
   * se edita en Preferencias; la API lo expone en /api/auth/taste.
   */
  taste?: import('./taste-profile').TasteProfile;
  onboarding?: import('./taste-profile').OnboardingState;
}

export type Theme = 'light' | 'dark' | 'system';

export type Language = 'es' | 'en';

export type DetailLevel = 'basic' | 'intermediate' | 'expert';

export interface NotificationPreferences {
  expirationAlerts: boolean;
  mealReminders: boolean;
  recipeSuggestions: boolean;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  cookingLevel?: CookingLevel;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}
