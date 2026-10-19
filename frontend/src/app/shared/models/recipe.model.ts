import type {
  RecipeInstructionStep,
  RecipeInstructionsByLevel,
  RecipeStepImageAttribution
} from './recipe-instructions';

export interface Recipe {
  id: string;
  name: string;
  description: string;
  difficulty: Difficulty;
  cuisine: string | null;
  countryCode?: string | null;
  catalogKey?: string | null;
  sourceAttribution?: RecipeSourceAttribution | null;
  imageAttribution?: RecipeImageAttribution | null;
  mealType: MealType[];
  totalTime: number;
  prepTime: number;
  cookTime: number;
  restTime?: number | null;
  servings: number;
  calories?: number | null;
  image?: string;
  ingredients: RecipeIngredient[];
  utensils: string[];
  guidance?: RecipeGuidance | null;
  /** Legacy recipes keep their one historical list; new AI recipes use instructionsByLevel. */
  steps?: RecipeStep[];
  instructionsByLevel?: RecipeInstructionsByLevel;
  nutrition?: NutritionInfo;
  storage?: StorageInfo;
  author: AuthorType;
  authorId?: string;
  rating?: number;
  timesCooked: number;
  tags: string[];
  isFavorite: boolean;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type RecipeEditableKey =
  | 'name'
  | 'description'
  | 'difficulty'
  | 'cuisine'
  | 'countryCode'
  | 'mealType'
  | 'totalTime'
  | 'prepTime'
  | 'cookTime'
  | 'restTime'
  | 'servings'
  | 'calories'
  | 'image'
  | 'ingredients'
  | 'utensils'
  | 'steps'
  | 'instructionsByLevel'
  | 'guidance'
  | 'nutrition'
  | 'storage'
  | 'tags';

type NullableRecipeEditableKey =
  | 'description'
  | 'cuisine'
  | 'countryCode'
  | 'totalTime'
  | 'prepTime'
  | 'cookTime'
  | 'restTime'
  | 'calories'
  | 'image'
  | 'steps'
  | 'instructionsByLevel'
  | 'guidance'
  | 'nutrition'
  | 'storage';

export type RecipeUpdateInput = Partial<
  Omit<Pick<Recipe, RecipeEditableKey>, NullableRecipeEditableKey>
> & {
  [Key in NullableRecipeEditableKey]?: Recipe[Key] | null;
} & {
  /** A short-lived Wikimedia search result; the server stores and replaces it with a local asset URL. */
  imagePhotoId?: string;
};

export interface RecipeIngredient {
  ingredientId?: string;
  name: string;
  quantity: number;
  unit: MeasurementUnit;
  preparation?: string | null;
  isOptional: boolean;
  substitutes?: string[];
  notes?: string | null;
}

export interface RecipeGuidance {
  appliances: string[];
  parallelTasks: string[];
  tipsAndVariations: string[];
  /** Explicit provider/editor decision; absent on legacy saved guidance. */
  batchCookingWarning?: string | null;
}

export interface RecipeStep extends RecipeInstructionStep {
  temperature?: Temperature;
  image?: string;
}

export interface Temperature {
  value: number;
  unit: 'C' | 'F';
}

export interface NutritionInfo {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  sugar?: number;
  sodium?: number;
}

export interface StorageInfo {
  method: string;
  container?: string | null;
  duration: string;
  reheatingInstructions?: string | null;
  freezingPossible: boolean;
  freezingDuration?: string | null;
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export type MealType = 'breakfast' | 'brunch' | 'lunch' | 'snack' | 'dinner' | 'dessert';

export type AuthorType = 'ai' | 'user' | 'catalog';

export interface RecipeSourceAttribution {
  publisher: string;
  title: string;
  url: string;
  note: string;
}

export type RecipeImageAttribution = RecipeStepImageAttribution;

export type MeasurementUnit =
  'g' | 'kg' | 'ml' | 'l' | 'cup' | 'tbsp' | 'tsp' | 'unit' | 'bunch' | 'slice' | 'piece';

export interface RecipeFilter {
  search?: string;
  difficulty?: Difficulty;
  mealType?: MealType;
  mealTypes?: MealType[];
  maxTime?: number;
  cuisine?: string;
  countryCode?: string;
  tags?: string[];
  isFavorite?: boolean;
  author?: AuthorType;
  catalogOnly?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: 'name' | 'difficulty' | 'totalTime' | 'rating' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface RecipeListResponse {
  recipes: Recipe[];
  total: number;
  page: number;
  pageSize: number;
}
