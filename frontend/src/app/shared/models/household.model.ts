import type { CookingLevel } from './home-profile';

export interface Household {
  id: string;
  name: string;
  inviteCode: string;
  members: HouseholdMember[];
  sharedPantry: boolean;
  shareRecipes: boolean;
  shareCalendar: boolean;
  myRole?: MemberRole;
  myPermissions?: MemberPermissions;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemberPermissions {
  pantry: { view: boolean; edit: boolean; manage: boolean };
  recipes: { view: boolean; create: boolean; edit: boolean; delete: boolean; generateAI: boolean };
  calendar: { view: boolean; edit: boolean };
  members: { invite: boolean; kick: boolean; manageRoles: boolean };
  settings: boolean;
}

export interface HouseholdMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  cookingLevel: CookingLevel;
  avatar?: string;
  joinedAt: Date;
  permissions?: MemberPermissions;
  isActive: boolean;
}

/** Resumen de una casa a la que pertenece la persona autenticada. */
export interface HouseholdMembership {
  id: string;
  name: string;
  role: MemberRole;
  permissions: MemberPermissions;
  active: boolean;
}

export interface InvitePreview {
  householdId: string;
  householdName: string;
  memberCount: number;
  alreadyMember: boolean;
}

export type MemberRole = 'admin' | 'member' | 'child';

export type { CookingLevel } from './home-profile';

export interface FoodPreferences {
  dietType: DietType;
  cuisinePreferences: string[];
  spiceTolerance: SpiceTolerance;
  portionSize: PortionSize;
}

export type DietType = 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'keto' | 'paleo';

export type SpiceTolerance = 'low' | 'medium' | 'high';

export type PortionSize = 'small' | 'medium' | 'large';

export interface Allergy {
  id: string;
  name: string;
  severity: AllergySeverity;
  notes?: string;
}

export type AllergySeverity = 'mild' | 'moderate' | 'severe';

// Los cinco `Record<Rol, string>` que habia aqui (roles, dieta, tolerancia al picante, racion y severidad
// de la alergia) estaban exportados y no los leia nadie: texto en espanol que ningun idioma alcanzaba y que
// ninguna pantalla ensenaba. Lo que si se ensena lleva `LABEL_KEYS` y sale del diccionario (## 12u).
export { COOKING_LEVEL_LABEL_KEYS } from './home-profile';
