export type CookingLevel = 'none' | 'beginner' | 'intermediate' | 'expert';
export type TasteGoal =
  'balanced' | 'weight-loss' | 'weight-gain' | 'muscle-gain' | 'maintenance' | 'variety' | 'custom';
export type HomeModule = 'meals' | 'pantry' | 'shopping' | 'receipts' | 'home';
export type HouseholdKey = 'solo-one' | 'solo-two' | 'couple' | 'family';
export type HouseholdRole = 'admin' | 'member' | 'child';
export type PersonaAccountType = 'solo' | 'household-member';

export interface AiPersonaMemberProfile {
  dietType: 'omnivore' | 'vegetarian' | 'vegan' | 'pescatarian' | 'keto' | 'paleo';
  cuisinePreferences: string[];
  spiceTolerance: 'low' | 'medium' | 'high';
  portionSize: 'small' | 'medium' | 'large';
  allergies: Array<{ name: string; severity: 'mild' | 'moderate' | 'severe' }>;
  dislikes: string[];
}

export interface AiPersonaSeedUser {
  key: string;
  accountType: PersonaAccountType;
  name: string;
  email: string;
  cookingLevel: CookingLevel;
  taste: {
    goals: TasteGoal[];
    allergies: string[];
    likes: string[];
    dislikes: string[];
    notes: string;
    goalNotes: string;
  };
  modules: HomeModule[];
  householdKey: HouseholdKey;
  role: HouseholdRole;
  memberProfile: AiPersonaMemberProfile | null;
}

export interface AiPersonaSeedHousehold {
  key: HouseholdKey;
  name: string;
  memberKeys: string[];
}

export interface AiPersonaSeedPlan {
  runId: string;
  users: AiPersonaSeedUser[];
  households: Record<HouseholdKey, AiPersonaSeedHousehold>;
  coverage: {
    cookingLevels: CookingLevel[];
    tasteGoals: TasteGoal[];
    homeModules: HomeModule[];
    dietTypes: AiPersonaMemberProfile['dietType'][];
    spiceTolerances: AiPersonaMemberProfile['spiceTolerance'][];
    portionSizes: AiPersonaMemberProfile['portionSize'][];
    allergySeverities: AiPersonaMemberProfile['allergies'][number]['severity'][];
  };
}

export function createAiPersonaSeedPlan(runId: string): AiPersonaSeedPlan;

export function assertSafeAiPersonaSeedTarget(input: {
  optIn: string | undefined;
  origin: string;
  databasePath: string | undefined;
  runDirectory: string | undefined;
  environment?: Record<string, string | undefined>;
}): { origin: string; databasePath: string; runDirectory: string };
