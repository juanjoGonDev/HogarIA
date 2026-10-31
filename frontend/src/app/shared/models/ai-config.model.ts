import type { RecipeDetailLevel } from './recipe-instructions';
import type { MeasurementUnit } from './recipe.model';

export interface AIProviderConfig {
  id: string;
  name: string;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  timeout: number;
  retryAttempts: number;
  /** Máximo de trabajos IA en vuelo por proveedor; 0 = ilimitado. */
  concurrency: number;
  isActive: boolean;
  assignedFunctions?: AiFunctionKey[];
  lastTested?: Date;
  testStatus?: TestStatus;
  testError?: string;
  testStartedAt?: Date;
  testLatencyMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AiFunctionKey =
  'assistant' | 'recipes' | 'planning' | 'shopping_pantry' | 'household_automation';

export interface AiFunctionProviderAssignment {
  functionKey: AiFunctionKey;
  configId: string | null;
  providerName: string | null;
}

export type AIProvider = 'openai' | 'custom';

export type TestStatus = 'idle' | 'testing' | 'success' | 'failed' | 'interrupted';

export interface AIRequestConfig {
  recipeGeneration: RecipeGenerationConfig;
  weeklyPlanning: WeeklyPlanningConfig;
  recommendations: RecommendationsConfig;
}

export interface RecipeGenerationConfig {
  detailLevel: DetailLevel;
  includeNutrition: boolean;
  includeStorage: boolean;
  includeAlternatives: boolean;
  language: string;
}

export type DetailLevel = RecipeDetailLevel;

export interface WeeklyPlanningConfig {
  considerSeasonal: boolean;
  varietyWeight: number;
  budgetConsideration: boolean;
  leftoverReuse: boolean;
}

export interface RecommendationsConfig {
  basedOnHistory: boolean;
  historyDays: number;
  considerPreferences: boolean;
  suggestNew: boolean;
}

export interface AIRecipeRequest {
  ingredients: AIIngredient[];
  utensils: AIUtensil[];
  servings: number;
  householdMemberIds?: string[];
  guests?: AIGuestPreferences[];
  difficulty: 'easy' | 'medium' | 'hard';
  detailLevel: DetailLevel;
  dietaryRestrictions: string[];
  allergies: string[];
  preferences: string[];
  cookingTime?: {
    min: number;
    max: number;
  };
}

/** Ephemeral food preferences for a guest; deliberately contains no name or account identifier. */
export interface AIGuestPreferences {
  allergies: string[];
  intolerances: string[];
  diets: string[];
  likes: string[];
  dislikes: string[];
  notes: string;
}

/** Backwards-compatible alias for the meal-replacement request contract. */
export type AIReplacementGuest = AIGuestPreferences;

export interface AIReplacementCandidate {
  name: string;
  description: string;
  ingredients: string[];
  estimatedTime: number;
  servings: number;
}

export interface AIIngredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

export interface AIUtensil {
  id: string;
  name: string;
  available: boolean;
}

export interface AIRecipeResponse {
  name: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  cuisine: string | null;
  totalTime: number;
  prepTime: number;
  cookTime: number;
  /** Must match server `aiRecipeOutputSchema`; do not fork for a planning or recipe UI flow. */
  baseServings: 1;
  calories: number | null;
  ingredients: AIRecipeIngredient[];
  utensils: string[];
  guidance: AIRecipeGuidance;
  instructionsByLevel: AIRecipeInstructionsByLevel;
  /** Initial view selection returned by the API; changing it is local-only. */
  selectedDetailLevel?: DetailLevel;
  tags: string[];
  nutrition: AINutritionInfo | null;
  storage: AIStorageInfo | null;
  restTime: number | null;
}

/** Fields editable through the canonical recipe-improvement contract. Keep media and IDs out. */
export type RecipeImproveScope =
  'details' | 'ingredients' | 'timing' | 'preparation' | 'guidance' | 'nutrition' | 'storage';

export type AIRecipeImproveInput = Partial<AIRecipeResponse> & {
  /** Saved editor quantities are normalized to one serving before they reach the AI. */
  servings?: number;
  /** Legacy recipes may still contain flat steps instead of detail-level instructions. */
  steps?: AIRecipeStep[];
};

export interface AIRecipeImproveRequest {
  recipe: AIRecipeImproveInput;
  scopes: RecipeImproveScope[];
}

export type AIRecipeImprovePatch = Partial<
  Pick<
    AIRecipeResponse,
    | 'name'
    | 'description'
    | 'difficulty'
    | 'cuisine'
    | 'totalTime'
    | 'prepTime'
    | 'cookTime'
    | 'calories'
    | 'ingredients'
    | 'utensils'
    | 'guidance'
    | 'instructionsByLevel'
    | 'tags'
    | 'nutrition'
    | 'storage'
    | 'restTime'
  >
>;

export interface AIRecipeImproveResponse {
  proposal: AIRecipeResponse;
  patch: AIRecipeImprovePatch;
  scopes: RecipeImproveScope[];
}

export interface AIRecipeIngredient {
  name: string;
  quantity: number;
  unit: MeasurementUnit;
  preparation: string | null;
  isOptional: boolean;
  substitutes: string[];
  notes: string | null;
}

export interface AIRecipeGuidance {
  appliances: string[];
  parallelTasks: string[];
  tipsAndVariations: string[];
  batchCookingWarning: string | null;
}

export interface AIRecipeStep {
  stepNumber: number;
  instruction: string;
  duration: number | null;
  temperature: { value: number; unit: 'C' | 'F' } | null;
  timerRequired: boolean;
  timerDuration: number | null;
  tips: string | null;
  warning: string | null;
  illustration: null;
}

export interface AIRecipeInstructionsByLevel {
  basic: AIRecipeStep[];
  intermediate: AIRecipeStep[];
  expert: AIRecipeStep[];
}

export interface AINutritionInfo {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
}

export interface AIStorageInfo {
  method: string;
  duration: string;
  reheatingInstructions: string | null;
  container: string | null;
  freezingPossible: boolean;
  freezingDuration: string | null;
}

export interface AIWeeklyPlanRequest {
  startDate: string;
  endDate: string;
  goals: AIGoals;
  availableIngredients: string[];
  householdPreferences?: AIHouseholdPreferences;
  householdMemberIds?: string[];
  guests?: AIGuestPreferences[];
}

export interface AIGoals {
  type: string;
  caloriesTarget?: number;
  proteinTarget?: number;
  restrictions: string[];
}

export interface AIHouseholdPreferences {
  likes: string[];
  dislikes: string[];
  allergies: string[];
}

export interface AIRecommendationRequest {
  recentMeals: AIRecentMeal[];
  availableIngredients: string[];
  householdPreferences: AIHouseholdPreferences;
  goals: AIGoals;
  count: number;
}

export interface AIRecentMeal {
  date: string;
  meal: string;
  recipeId?: string;
}

export interface AITestConnectionResponse {
  success: boolean;
  model: string;
  latency: number;
  error?: string;
  /** Lo que el modelo contesto cuando la prueba pasa (el JSON pedido, validado en el server). */
  message?: string;
}

/** Immediate acknowledgement for a persisted test that continues on the server. */
export interface AITestConnectionStarted {
  status: 'testing';
  configId: string;
}

export type AITestConnectionOutcome = AITestConnectionResponse | AITestConnectionStarted;

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI',
  custom: 'Custom (OpenAI-like)'
};
