import {
  Difficulty,
  MealType,
  MeasurementUnit,
  NutritionInfo,
  Recipe,
  RecipeGuidance,
  RecipeIngredient,
  RecipeStep,
  RecipeUpdateInput,
  StorageInfo
} from '../../shared/models/recipe.model';
import type { RecipeInstructionStep } from '../../shared/models/recipe-instructions';
import type { RecipeStepVideoCandidate } from '../../shared/models/recipe-step-video';
import {
  RecipeDetailLevel,
  RecipeInstructionsByLevel
} from '../../shared/models/recipe-instructions';

export interface RecipeEditorIngredient {
  ingredientId?: string;
  name: string;
  quantityText: string | number;
  unit: MeasurementUnit;
  preparation: string;
  isOptional: boolean;
  substitutesText: string;
  notes: string;
}

export interface RecipeEditorStep {
  stepNumber: number;
  instruction: string;
  durationText: string | number;
  temperatureText: string | number;
  temperatureUnit: 'C' | 'F';
  timerRequired: boolean;
  timerDurationText: string | number;
  tips: string;
  warning: string;
  imageUrl: string;
  imagePhotoId: string | null;
  imageAttribution: RecipeStep['imageAttribution'];
  videoId: string | null;
  video: RecipeStepVideoCandidate | null;
  photoSearchQuery: string;
  illustration?: RecipeStep['illustration'];
}

export interface RecipeEditorNutrition {
  calories: string | number;
  protein: string | number;
  carbs: string | number;
  fat: string | number;
  fiber: string | number;
  sugar: string | number;
  sodium: string | number;
}

export interface RecipeEditorStorage {
  method: string;
  container: string;
  duration: string;
  reheatingInstructions: string;
  freezingPossible: boolean;
  freezingDuration: string;
}

export interface RecipeEditDraft {
  name: string;
  description: string;
  difficulty: Difficulty;
  cuisine: string;
  countryCode: string;
  mealType: MealType[];
  totalTime: string | number;
  prepTime: string | number;
  cookTime: string | number;
  restTime: string | number;
  servings: string | number;
  calories: string | number;
  image: string;
  imagePhotoId: string | null;
  imageAttribution: Recipe['imageAttribution'];
  ingredients: RecipeEditorIngredient[];
  utensilsText: string;
  tagsText: string;
  appliancesText: string;
  parallelTasksText: string;
  tipsAndVariationsText: string;
  batchCookingWarningText: string;
  steps?: RecipeEditorStep[];
  instructionsByLevel?: Record<RecipeDetailLevel, RecipeEditorStep[]>;
  nutritionEnabled: boolean;
  nutrition: RecipeEditorNutrition;
  storageEnabled: boolean;
  storage: RecipeEditorStorage;
}

export interface RecipeEditPayloadResult {
  payload: RecipeUpdateInput | null;
  errors: string[];
}

function emptyEditorStep(stepNumber = 1): RecipeEditorStep {
  return {
    stepNumber,
    instruction: '',
    durationText: '',
    temperatureText: '',
    temperatureUnit: 'C',
    timerRequired: false,
    timerDurationText: '',
    tips: '',
    warning: '',
    imageUrl: '',
    imagePhotoId: null,
    imageAttribution: null,
    videoId: null,
    video: null,
    photoSearchQuery: ''
  };
}

/** A new recipe starts with one editable row per supported instruction level. */
export function createRecipeEditDraft(): RecipeEditDraft {
  return {
    name: '',
    description: '',
    difficulty: 'easy',
    cuisine: '',
    countryCode: '',
    mealType: [],
    totalTime: '',
    prepTime: '',
    cookTime: '',
    restTime: '',
    servings: 2,
    calories: '',
    image: '',
    imagePhotoId: null,
    imageAttribution: null,
    ingredients: [
      {
        name: '',
        quantityText: '1',
        unit: 'unit',
        preparation: '',
        isOptional: false,
        substitutesText: '',
        notes: ''
      }
    ],
    utensilsText: '',
    tagsText: '',
    appliancesText: '',
    parallelTasksText: '',
    tipsAndVariationsText: '',
    batchCookingWarningText: '',
    instructionsByLevel: {
      basic: [emptyEditorStep()],
      intermediate: [emptyEditorStep()],
      expert: [emptyEditorStep()]
    },
    nutritionEnabled: false,
    nutrition: toNutritionEditor(),
    storageEnabled: false,
    storage: toStorageEditor()
  };
}

const DETAIL_LEVELS: RecipeDetailLevel[] = ['basic', 'intermediate', 'expert'];

function optionalText(value: string | null | undefined): string {
  return value ?? '';
}

function optionalNumberText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

type EditableRecipeStepInput = RecipeInstructionStep &
  Partial<Pick<RecipeStep, 'image' | 'imageAttribution'>>;

function toEditorStep(step: EditableRecipeStepInput): RecipeEditorStep {
  return {
    stepNumber: step.stepNumber,
    instruction: step.instruction,
    durationText: optionalNumberText(step.duration),
    temperatureText: optionalNumberText(step.temperature?.value),
    temperatureUnit: step.temperature?.unit ?? 'C',
    timerRequired: step.timerRequired ?? false,
    timerDurationText: optionalNumberText(step.timerDuration),
    tips: optionalText(step.tips),
    warning: optionalText(step.warning),
    imageUrl: optionalText(step.image),
    imagePhotoId: null,
    imageAttribution: step.imageAttribution ?? null,
    videoId: step.videoId ?? null,
    video: step.video ?? null,
    photoSearchQuery: '',
    illustration: step.illustration ?? null
  };
}

function toEditorIngredient(ingredient: RecipeIngredient): RecipeEditorIngredient {
  return {
    ...(ingredient.ingredientId ? { ingredientId: ingredient.ingredientId } : {}),
    name: ingredient.name,
    quantityText: String(ingredient.quantity),
    unit: ingredient.unit,
    preparation: optionalText(ingredient.preparation),
    isOptional: ingredient.isOptional,
    substitutesText: (ingredient.substitutes ?? []).join(', '),
    notes: optionalText(ingredient.notes)
  };
}

function toNutritionEditor(nutrition?: NutritionInfo | null): RecipeEditorNutrition {
  return {
    calories: optionalNumberText(nutrition?.calories),
    protein: optionalNumberText(nutrition?.protein),
    carbs: optionalNumberText(nutrition?.carbs),
    fat: optionalNumberText(nutrition?.fat),
    fiber: optionalNumberText(nutrition?.fiber),
    sugar: optionalNumberText(nutrition?.sugar),
    sodium: optionalNumberText(nutrition?.sodium)
  };
}

function toStorageEditor(storage?: StorageInfo | null): RecipeEditorStorage {
  return {
    method: storage?.method ?? '',
    container: optionalText(storage?.container),
    duration: storage?.duration ?? '',
    reheatingInstructions: optionalText(storage?.reheatingInstructions),
    freezingPossible: storage?.freezingPossible ?? false,
    freezingDuration: optionalText(storage?.freezingDuration)
  };
}

export function recipeToEditDraft(recipe: Recipe): RecipeEditDraft {
  const draft: RecipeEditDraft = {
    name: recipe.name,
    description: optionalText(recipe.description),
    difficulty: recipe.difficulty,
    cuisine: optionalText(recipe.cuisine),
    countryCode: optionalText(recipe.countryCode),
    mealType: [...recipe.mealType],
    totalTime: optionalNumberText(recipe.totalTime),
    prepTime: optionalNumberText(recipe.prepTime),
    cookTime: optionalNumberText(recipe.cookTime),
    restTime: optionalNumberText(recipe.restTime),
    servings: String(recipe.servings || 2),
    calories: optionalNumberText(recipe.calories),
    image: optionalText(recipe.image),
    imagePhotoId: null,
    imageAttribution: recipe.imageAttribution ?? null,
    ingredients: recipe.ingredients.map(toEditorIngredient),
    utensilsText: recipe.utensils.join('\n'),
    tagsText: recipe.tags.join(', '),
    appliancesText: recipe.guidance?.appliances.join('\n') ?? '',
    parallelTasksText: recipe.guidance?.parallelTasks.join('\n') ?? '',
    tipsAndVariationsText: recipe.guidance?.tipsAndVariations.join('\n') ?? '',
    batchCookingWarningText: recipe.guidance?.batchCookingWarning ?? '',
    nutritionEnabled: Boolean(recipe.nutrition),
    nutrition: toNutritionEditor(recipe.nutrition),
    storageEnabled: Boolean(recipe.storage),
    storage: toStorageEditor(recipe.storage)
  };

  if (recipe.instructionsByLevel) {
    draft.instructionsByLevel = Object.fromEntries(
      DETAIL_LEVELS.map((level) => [
        level,
        recipe.instructionsByLevel?.[level].map(toEditorStep) ?? []
      ])
    ) as Record<RecipeDetailLevel, RecipeEditorStep[]>;
  } else {
    draft.steps = (recipe.steps ?? []).map(toEditorStep);
  }

  return draft;
}

function lines(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numericValue(
  value: string | number,
  field: string,
  errors: string[],
  options: {
    required?: boolean;
    integer?: boolean;
    positive?: boolean;
    min?: number;
    safeInteger?: boolean;
  } = {}
): number | null {
  const normalized = String(value).trim();
  if (!normalized) {
    if (options.required) errors.push(`${field}_required`);
    return null;
  }
  const parsed = Number(normalized);
  if (
    !Number.isFinite(parsed) ||
    (options.integer && !Number.isInteger(parsed)) ||
    (options.safeInteger && !Number.isSafeInteger(parsed)) ||
    (options.positive && parsed <= 0) ||
    (options.min !== undefined && parsed < options.min)
  ) {
    errors.push(`${field}_invalid`);
    return null;
  }
  return parsed;
}

function safeHttpsUrl(value: string, field: string, errors: string[]): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || url.username || url.password) {
      errors.push(`${field}_https`);
      return null;
    }
    return url.href;
  } catch {
    errors.push(`${field}_invalid`);
    return null;
  }
}

function safeRecipeImageReference(value: string, errors: string[], field = 'image'): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (/^\/api\/recipe-images\/[a-f0-9]{24}$/.test(normalized)) return normalized;
  return safeHttpsUrl(normalized, field, errors);
}

function buildEditorSteps(
  steps: RecipeEditorStep[],
  field: string,
  errors: string[]
): RecipeStep[] {
  if (steps.length === 0) errors.push(`${field}_required`);
  return steps.map((step, index) => {
    const instruction = step.instruction.trim();
    if (!instruction) errors.push(`${field}_${index}_instruction`);
    const duration = numericValue(step.durationText, `${field}_${index}_duration`, errors, {
      integer: true,
      positive: true
    });
    const timerDuration = numericValue(
      step.timerDurationText,
      `${field}_${index}_timer_duration`,
      errors,
      { integer: true, positive: true }
    );
    const temperature = numericValue(step.temperatureText, `${field}_${index}_temperature`, errors);
    const photoId = step.imagePhotoId?.trim() ?? '';
    if (photoId && !/^[a-f0-9]{24}$/.test(photoId)) {
      errors.push(`${field}_${index}_image_photo_invalid`);
    }
    const image = photoId
      ? null
      : safeRecipeImageReference(step.imageUrl, errors, `${field}_${index}_image`);

    return {
      stepNumber: index + 1,
      instruction,
      duration,
      timerRequired: step.timerRequired,
      timerDuration,
      tips: step.tips.trim() || null,
      warning: step.warning.trim() || null,
      illustration: step.illustration ?? null,
      ...(temperature === null
        ? {}
        : { temperature: { value: temperature, unit: step.temperatureUnit } }),
      ...(photoId ? { imagePhotoId: photoId } : {}),
      ...(step.videoId ? { videoId: step.videoId } : {}),
      ...(image ? { image } : {})
    };
  });
}

function buildNutrition(draft: RecipeEditDraft, errors: string[]): NutritionInfo | null {
  if (!draft.nutritionEnabled) return null;
  const nutrition = draft.nutrition;
  const calories = numericValue(nutrition.calories, 'nutrition_calories', errors, {
    required: true,
    min: 0
  });
  const protein = numericValue(nutrition.protein, 'nutrition_protein', errors, {
    required: true,
    min: 0
  });
  const carbs = numericValue(nutrition.carbs, 'nutrition_carbs', errors, {
    required: true,
    min: 0
  });
  const fat = numericValue(nutrition.fat, 'nutrition_fat', errors, { required: true, min: 0 });
  const fiber = numericValue(nutrition.fiber, 'nutrition_fiber', errors, { min: 0 });
  const sugar = numericValue(nutrition.sugar, 'nutrition_sugar', errors, { min: 0 });
  const sodium = numericValue(nutrition.sodium, 'nutrition_sodium', errors, { min: 0 });
  if (calories === null || protein === null || carbs === null || fat === null) return null;
  return {
    calories,
    protein,
    carbs,
    fat,
    fiber,
    ...(sugar === null ? {} : { sugar }),
    ...(sodium === null ? {} : { sodium })
  };
}

function buildStorage(draft: RecipeEditDraft, errors: string[]): StorageInfo | null {
  if (!draft.storageEnabled) return null;
  const method = draft.storage.method.trim();
  const duration = draft.storage.duration.trim();
  if (!method) errors.push('storage_method_required');
  if (!duration) errors.push('storage_duration_required');
  if (!method || !duration) return null;
  return {
    method,
    container: draft.storage.container.trim() || null,
    duration,
    reheatingInstructions: draft.storage.reheatingInstructions.trim() || null,
    freezingPossible: draft.storage.freezingPossible,
    freezingDuration: draft.storage.freezingDuration.trim() || null
  };
}

export function buildRecipeEditPayload(draft: RecipeEditDraft): RecipeEditPayloadResult {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (!name) errors.push('name_required');
  const servings = numericValue(draft.servings, 'servings', errors, {
    required: true,
    integer: true,
    safeInteger: true,
    positive: true,
    min: 1
  });

  const countryCode = draft.countryCode.trim().toUpperCase();
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) errors.push('country_code');
  if (draft.mealType.length === 0) errors.push('meal_type_required');
  const photoId = draft.imagePhotoId?.trim() ?? '';
  if (photoId && !/^[a-f0-9]{24}$/.test(photoId)) errors.push('image_photo_invalid');
  const image = photoId ? undefined : safeRecipeImageReference(draft.image, errors);
  const totalTime = numericValue(draft.totalTime, 'total_time', errors, {
    integer: true,
    positive: true
  });
  const prepTime = numericValue(draft.prepTime, 'prep_time', errors, {
    integer: true,
    positive: true
  });
  const cookTime = numericValue(draft.cookTime, 'cook_time', errors, { integer: true, min: 0 });
  const restTime = numericValue(draft.restTime, 'rest_time', errors, { integer: true, min: 0 });
  const calories = numericValue(
    draft.nutritionEnabled ? draft.nutrition.calories : draft.calories,
    'calories',
    errors,
    { positive: true }
  );

  if (draft.ingredients.length === 0) errors.push('ingredients_required');
  const ingredients: RecipeIngredient[] = draft.ingredients.map((ingredient, index) => {
    const ingredientName = ingredient.name.trim();
    if (!ingredientName) errors.push(`ingredient_${index}_name`);
    const quantity = numericValue(ingredient.quantityText, `ingredient_${index}_quantity`, errors, {
      required: true,
      positive: true
    });
    return {
      name: ingredientName,
      quantity: quantity ?? 0,
      unit: ingredient.unit,
      preparation: ingredient.preparation.trim() || null,
      isOptional: ingredient.isOptional,
      substitutes: lines(ingredient.substitutesText),
      notes: ingredient.notes.trim() || null
    };
  });

  const utensils = lines(draft.utensilsText);
  const tags = lines(draft.tagsText);
  const appliances = lines(draft.appliancesText);
  const parallelTasks = lines(draft.parallelTasksText);
  const tipsAndVariations = lines(draft.tipsAndVariationsText);
  const batchCookingWarning = draft.batchCookingWarningText.trim();
  const guidance: RecipeGuidance | null =
    appliances.length || parallelTasks.length || tipsAndVariations.length || batchCookingWarning
      ? {
          appliances,
          parallelTasks,
          tipsAndVariations,
          batchCookingWarning: batchCookingWarning || null
        }
      : null;

  const instructionsByLevel = draft.instructionsByLevel
    ? (Object.fromEntries(
        DETAIL_LEVELS.map((level) => [
          level,
          buildEditorSteps(draft.instructionsByLevel?.[level] ?? [], `level_${level}`, errors)
        ])
      ) as RecipeInstructionsByLevel)
    : undefined;
  const steps = draft.instructionsByLevel
    ? undefined
    : buildEditorSteps(draft.steps ?? [], 'steps', errors);
  const nutrition = buildNutrition(draft, errors);
  const storage = buildStorage(draft, errors);

  if (errors.length > 0 || servings === null) return { payload: null, errors };

  const payload: RecipeUpdateInput = {
    name,
    description: draft.description.trim() || null,
    difficulty: draft.difficulty,
    cuisine: draft.cuisine.trim() || null,
    countryCode: countryCode || null,
    mealType: [...draft.mealType],
    totalTime,
    prepTime,
    cookTime,
    restTime,
    servings,
    calories,
    ...(photoId ? { imagePhotoId: photoId } : { image }),
    ingredients,
    utensils,
    ...(instructionsByLevel ? { instructionsByLevel } : { steps }),
    guidance,
    nutrition,
    storage,
    tags
  };
  return { payload, errors };
}
