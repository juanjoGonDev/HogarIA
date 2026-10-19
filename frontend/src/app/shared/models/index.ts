// Recipe model
export {
  Recipe,
  RecipeIngredient,
  RecipeStep,
  Temperature,
  NutritionInfo,
  StorageInfo,
  Difficulty,
  AuthorType,
  RecipeFilter,
  RecipeListResponse
} from './recipe.model';

export type { MealType as RecipeMealType } from './recipe.model';
export type { MeasurementUnit as RecipeMeasurementUnit } from './recipe.model';

// Pantry model
export {
  Ingredient,
  IngredientCategory,
  StorageLocation,
  Utensil,
  UtensilCategory,
  PantryFilter,
  PantryStats
} from './pantry.model';

export type { MeasurementUnit } from './pantry.model';

// Household model
export {
  Household,
  HouseholdMember,
  MemberRole,
  CookingLevel,
  FoodPreferences,
  DietType,
  SpiceTolerance,
  PortionSize,
  Allergy,
  AllergySeverity,
  COOKING_LEVEL_LABEL_KEYS
} from './household.model';

// Calendar model
export {
  WeeklyCalendar,
  DayPlan,
  Meal,
  DayOfWeek,
  MealType,
  GenerationType,
  NutritionalGoals,
  GoalType,
  CustomGoal,
  GoalFrequency,
  GOAL_TYPE_LABELS,
  DAY_ORDER,
  MEAL_ORDER
} from './calendar.model';

// AI Config model
export {
  AIProviderConfig,
  AIProvider,
  TestStatus,
  AIRequestConfig,
  RecipeGenerationConfig,
  WeeklyPlanningConfig,
  RecommendationsConfig,
  AIRecipeRequest,
  AIIngredient,
  AIUtensil,
  AIRecipeResponse,
  AIRecipeIngredient,
  AIRecipeGuidance,
  AIRecipeStep,
  AIRecipeInstructionsByLevel,
  AINutritionInfo,
  AIStorageInfo,
  AIWeeklyPlanRequest,
  AIGoals,
  AIHouseholdPreferences,
  AIRecommendationRequest,
  AIRecentMeal,
  AITestConnectionResponse,
  DetailLevel
} from './ai-config.model';

// User model
export {
  User,
  UserPreferences,
  Theme,
  Language,
  NotificationPreferences,
  AuthCredentials,
  RegisterData,
  AuthResponse,
  TokenPayload
} from './user.model';

export type { CookingLevel as UserCookingLevel } from './user.model';

// Home profile model (nivel de cocina + secciones que se quieren usar)
export {
  COOKING_LEVEL_OPTIONS,
  DEFAULT_HOME_PROFILE,
  HOME_MODULE_OPTIONS,
  HOME_MODULES,
  detailLevelHintKey,
  isCookingLevel,
  isHomeModule,
  toHomeProfile,
  toggleHomeModule,
  cookingLevelWord
} from './home-profile';
export type { HomeModule, HomeProfile } from './home-profile';
