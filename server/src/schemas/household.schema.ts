import { z } from 'zod';
import { formDefault, formField } from './form.js';
import { COOKING_LEVELS } from '../utils/taste-profile.js';

const memberRoleEnum = z.enum(['admin', 'member', 'child']);
const cookingLevelEnum = z.enum(COOKING_LEVELS);
const dietTypeEnum = z.enum(['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'paleo']);
const spiceToleranceEnum = z.enum(['low', 'medium', 'high']);
const portionSizeEnum = z.enum(['small', 'medium', 'large']);
const allergySeverityEnum = z.enum(['mild', 'moderate', 'severe']);

const allergySchema = z.object({
  name: z.string().min(1).max(100),
  severity: formDefault(allergySeverityEnum, 'moderate'),
  notes: formField(z.string().max(200))
});

const foodPreferencesSchema = z.object({
  dietType: formDefault(dietTypeEnum, 'omnivore'),
  cuisinePreferences: formDefault(z.array(z.string()), []),
  spiceTolerance: formDefault(spiceToleranceEnum, 'medium'),
  portionSize: formDefault(portionSizeEnum, 'medium')
});

// Household schemas
export const createHouseholdSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  sharedPantry: formDefault(z.boolean(), true)
});

export const updateHouseholdSchema = z.object({
  name: formField(z.string().min(1).max(100)),
  sharedPantry: formField(z.boolean())
});

export const joinHouseholdSchema = z.object({
  inviteCode: z.string().min(1, 'Invite code is required')
});

// Member schemas
export const updateMemberSchema = z.object({
  role: formField(memberRoleEnum),
  cookingLevel: formField(cookingLevelEnum),
  preferences: formField(foodPreferencesSchema),
  allergies: formField(z.array(allergySchema)),
  dislikes: formField(z.array(z.string().max(100)))
});

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email format')
});

export type CreateHouseholdInput = z.infer<typeof createHouseholdSchema>;
export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type JoinHouseholdInput = z.infer<typeof joinHouseholdSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
