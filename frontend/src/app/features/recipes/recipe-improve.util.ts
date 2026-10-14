import {
  AIRecipeImproveInput,
  AIRecipeImprovePatch,
  AIRecipeStep,
  RecipeImproveScope
} from '../../shared/models/ai-config.model';
import type { TranslationKey, TranslationParams } from '../../core/i18n';
import { RecipeDetailLevel } from '../../shared/models/recipe-instructions';
import { RecipeStepPhotoScene } from '../../shared/models/recipe-step-photo';
import { RecipeEditDraft, RecipeEditorStep } from './recipe-edit.util';

const LEVELS: RecipeDetailLevel[] = ['basic', 'intermediate', 'expert'];
const LEVEL_FIELD_LABELS: Record<RecipeDetailLevel, TranslationKey> = {
  basic: 'recipes.improve.field.basic',
  intermediate: 'recipes.improve.field.intermediate',
  expert: 'recipes.improve.field.expert'
};

const MEDIA_SCENE_ACTIONS: Record<RecipeStepPhotoScene, RegExp> = {
  wash: /\b(lav\w*|enjuag\w*|aclar\w*|limpi\w*)\b/g,
  cut: /\b(pel\w*|cort\w*|troce\w*|pic\w*|lamin\w*|rall\w*)\b/g,
  mix: /\b(mezcl\w*|bat\w*|remuev\w*|remov\w*|incorpor\w*|combin\w*)\b/g,
  cook: /\b(cocin\w*|cuec\w*|hierv\w*|herv\w*|salte\w*|sofri\w*|frie\w*|freir\w*|calient\w*|dor\w*)\b/g,
  bake: /\b(horne\w*|gratin\w*|as(?:a|ar|ado|ando))\b/g,
  rest: /\b(repos\w*|enfr\w*|atemper\w*)\b/g,
  serve: /\b(serv\w*|sirv\w*|emplat\w*|decor\w*)\b/g,
  prepare: /\b(prepar\w*|disp\w*)\b/g
};

/** Classify to a generic scene on-device; never send the original instruction to media search. */
export function classifyRecipeMediaScene(instruction: string): RecipeStepPhotoScene {
  const normalized = instruction.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  let lastAction: { scene: RecipeStepPhotoScene; index: number } | null = null;
  for (const scene of Object.keys(MEDIA_SCENE_ACTIONS) as RecipeStepPhotoScene[]) {
    for (const match of normalized.matchAll(MEDIA_SCENE_ACTIONS[scene])) {
      if (lastAction === null || match.index > lastAction.index) {
        lastAction = { scene, index: match.index };
      }
    }
  }
  return lastAction?.scene ?? 'prepare';
}

export interface RecipeImprovementChange {
  scope: RecipeImproveScope;
  label: TranslationKey;
  before: string;
  after: string;
}

type RecipeReviewTranslator = (key: TranslationKey, params?: TranslationParams) => string;

function parseFinite(value: string | number): number | null {
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | number, minimum: number): number | null {
  const parsed = parseFinite(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

function parseLines(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toAiStep(step: RecipeEditorStep, index: number): AIRecipeStep | null {
  const instruction = step.instruction.trim();
  if (!instruction) return null;
  const temperature = parseFinite(step.temperatureText);
  return {
    stepNumber: index + 1,
    instruction,
    duration: parseInteger(step.durationText, 1),
    temperature: temperature === null ? null : { value: temperature, unit: step.temperatureUnit },
    timerRequired: step.timerRequired,
    timerDuration: parseInteger(step.timerDurationText, 1),
    tips: step.tips.trim() || null,
    warning: step.warning.trim() || null,
    illustration: null
  };
}

function projectSteps(steps: RecipeEditorStep[]): AIRecipeStep[] | null {
  const nonEmpty = steps.filter((step) => step.instruction.trim());
  if (nonEmpty.length === 0) return null;
  return nonEmpty.map((step, index) => toAiStep(step, index)!);
}

/**
 * Project editable form content into the same one-serving culinary contract used by generation.
 * Identifiers, search text, photos, attributions and any account/household data stay out.
 */
export function recipeImprovementInput(draft: RecipeEditDraft): AIRecipeImproveInput | null {
  const name = draft.name.trim();
  const servings = parseInteger(draft.servings, 1);
  if (!name || servings === null || servings > 100) return null;

  const ingredients = draft.ingredients.filter((ingredient) => ingredient.name.trim());
  if (ingredients.length === 0) return null;
  const projectedIngredients = ingredients.map((ingredient) => {
    const quantity = parseFinite(ingredient.quantityText);
    if (quantity === null || quantity <= 0 || quantity > 1_000_000 * servings) return null;
    return {
      name: ingredient.name.trim(),
      quantity: Math.round((quantity / servings) * 1_000_000) / 1_000_000,
      unit: ingredient.unit,
      preparation: ingredient.preparation.trim() || null,
      isOptional: ingredient.isOptional,
      substitutes: parseLines(ingredient.substitutesText),
      notes: ingredient.notes.trim() || null
    };
  });
  if (projectedIngredients.some((ingredient) => ingredient === null)) return null;

  const instructionsByLevel = draft.instructionsByLevel
    ? {
        basic: projectSteps(draft.instructionsByLevel.basic),
        intermediate: projectSteps(draft.instructionsByLevel.intermediate),
        expert: projectSteps(draft.instructionsByLevel.expert)
      }
    : null;
  const flatSteps = draft.instructionsByLevel ? null : projectSteps(draft.steps ?? []);
  if (
    (instructionsByLevel && LEVELS.some((level) => !instructionsByLevel[level])) ||
    (!instructionsByLevel && !flatSteps)
  ) {
    return null;
  }

  const input: AIRecipeImproveInput = {
    name,
    difficulty: draft.difficulty,
    baseServings: 1,
    servings,
    ingredients: projectedIngredients as NonNullable<(typeof projectedIngredients)[number]>[],
    utensils: parseLines(draft.utensilsText),
    guidance: {
      appliances: parseLines(draft.appliancesText),
      parallelTasks: parseLines(draft.parallelTasksText),
      tipsAndVariations: parseLines(draft.tipsAndVariationsText),
      batchCookingWarning: draft.batchCookingWarningText.trim() || null
    },
    tags: parseLines(draft.tagsText)
  };

  const description = draft.description.trim();
  if (description) input.description = description;
  const cuisine = draft.cuisine.trim();
  if (cuisine) input.cuisine = cuisine;

  const totalTime = parseInteger(draft.totalTime, 1);
  const prepTime = parseInteger(draft.prepTime, 1);
  const cookTime = parseInteger(draft.cookTime, 0);
  const restTime = parseInteger(draft.restTime, 0);
  if (totalTime !== null && totalTime <= 1440) input.totalTime = totalTime;
  if (prepTime !== null && prepTime <= 1440) input.prepTime = prepTime;
  if (cookTime !== null && cookTime <= 1440) input.cookTime = cookTime;
  if (restTime !== null && restTime <= 1440) input.restTime = restTime;

  const calories = parseFinite(draft.calories);
  if (calories !== null && calories >= 0) input.calories = calories;

  if (draft.nutritionEnabled) {
    const nutritionValues = {
      calories: parseFinite(draft.nutrition.calories),
      protein: parseFinite(draft.nutrition.protein),
      carbs: parseFinite(draft.nutrition.carbs),
      fat: parseFinite(draft.nutrition.fat),
      fiber: parseFinite(draft.nutrition.fiber)
    };
    if (
      nutritionValues.calories !== null &&
      nutritionValues.calories >= 0 &&
      nutritionValues.protein !== null &&
      nutritionValues.protein >= 0 &&
      nutritionValues.carbs !== null &&
      nutritionValues.carbs >= 0 &&
      nutritionValues.fat !== null &&
      nutritionValues.fat >= 0 &&
      (nutritionValues.fiber === null || nutritionValues.fiber >= 0)
    ) {
      input.nutrition = {
        calories: nutritionValues.calories,
        protein: nutritionValues.protein,
        carbs: nutritionValues.carbs,
        fat: nutritionValues.fat,
        fiber: nutritionValues.fiber
      };
    }
  }

  if (draft.storageEnabled) {
    const method = draft.storage.method.trim();
    const duration = draft.storage.duration.trim();
    if (method && duration) {
      input.storage = {
        method,
        duration,
        reheatingInstructions: draft.storage.reheatingInstructions.trim() || null,
        container: draft.storage.container.trim() || null,
        freezingPossible: draft.storage.freezingPossible,
        freezingDuration: draft.storage.freezingDuration.trim() || null
      };
    }
  }

  if (instructionsByLevel) {
    input.instructionsByLevel = instructionsByLevel as unknown as NonNullable<
      AIRecipeImproveInput['instructionsByLevel']
    >;
  } else if (flatSteps) {
    input.steps = flatSteps;
  }

  return input;
}

function formatIngredients(draft: RecipeEditDraft): string {
  return draft.ingredients
    .filter((ingredient) => ingredient.name.trim())
    .map(
      (ingredient) => `${ingredient.quantityText} ${ingredient.unit} · ${ingredient.name.trim()}`
    )
    .join('\n');
}

function formatSteps(
  steps: RecipeEditorStep[] | undefined,
  translate: RecipeReviewTranslator
): string {
  return (steps ?? [])
    .filter((step) => step.instruction.trim())
    .map(
      (step, index) =>
        `${index + 1}. ${step.instruction.trim()}${formatStepDetails(
          {
            duration: step.durationText,
            temperature:
              String(step.temperatureText).trim() === ''
                ? null
                : { value: step.temperatureText, unit: step.temperatureUnit },
            timerRequired: step.timerRequired,
            timerDuration: step.timerDurationText,
            tips: step.tips,
            warning: step.warning
          },
          translate
        )}`
    )
    .join('\n');
}

function formatAiSteps(
  steps: AIRecipeStep[] | undefined,
  translate: RecipeReviewTranslator
): string {
  return (steps ?? [])
    .map((step, index) => `${index + 1}. ${step.instruction}${formatStepDetails(step, translate)}`)
    .join('\n');
}

function formatStepDetails(
  step: {
    duration?: string | number | null;
    temperature?: { value: string | number; unit: 'C' | 'F' } | null;
    timerRequired?: boolean;
    timerDuration?: string | number | null;
    tips?: string | null;
    warning?: string | null;
  },
  translate: RecipeReviewTranslator
): string {
  const details: string[] = [];
  if (step.duration !== undefined && step.duration !== null && String(step.duration).trim()) {
    details.push(translate('recipes.improve.step_duration', { n: step.duration }));
  }
  if (step.temperature) {
    details.push(
      translate('recipes.improve.step_temperature', {
        value: step.temperature.value,
        unit: step.temperature.unit
      })
    );
  }
  if (
    step.timerRequired &&
    step.timerDuration !== undefined &&
    step.timerDuration !== null &&
    String(step.timerDuration).trim()
  ) {
    details.push(translate('recipes.improve.step_timer', { n: step.timerDuration }));
  }
  if (step.tips?.trim()) {
    details.push(translate('recipes.improve.step_tip', { text: step.tips.trim() }));
  }
  if (step.warning?.trim()) {
    details.push(translate('recipes.improve.step_warning', { text: step.warning.trim() }));
  }
  return details.length ? `\n   ${details.join(' · ')}` : '';
}

function formatDraftValue(
  draft: RecipeEditDraft,
  field: string,
  translate: RecipeReviewTranslator
): string {
  if (field === 'ingredients') return formatIngredients(draft);
  if (field === 'steps') return formatSteps(draft.steps, translate);
  if (field === 'instructionsByLevel') {
    return LEVELS.map(
      (level) => `${level}:\n${formatSteps(draft.instructionsByLevel?.[level], translate)}`
    ).join('\n\n');
  }
  if (field.startsWith('instructionsByLevel.')) {
    return formatSteps(
      draft.instructionsByLevel?.[field.split('.')[1] as RecipeDetailLevel] ?? draft.steps,
      translate
    );
  }
  if (field.startsWith('nutrition.')) {
    return String(draft.nutrition[field.split('.')[1] as keyof RecipeEditDraft['nutrition']] ?? '');
  }
  if (field.startsWith('storage.')) {
    return String(draft.storage[field.split('.')[1] as keyof RecipeEditDraft['storage']] ?? '');
  }
  return String(draft[field as keyof RecipeEditDraft] ?? '');
}

function formatPatchValue(
  draft: RecipeEditDraft,
  patch: AIRecipeImprovePatch,
  field: string,
  translate: RecipeReviewTranslator
): string {
  if (field === 'ingredients') {
    const servings = parseInteger(draft.servings, 1) ?? 1;
    return (patch.ingredients ?? [])
      .map(
        (ingredient) =>
          `${formatQuantity(ingredient.quantity * servings)} ${ingredient.unit} · ${ingredient.name}`
      )
      .join('\n');
  }
  if (field === 'steps') return '';
  if (field === 'instructionsByLevel') {
    return LEVELS.map(
      (level) => `${level}:\n${formatAiSteps(patch.instructionsByLevel?.[level], translate)}`
    ).join('\n\n');
  }
  if (field === 'utensilsText') return patch.utensils?.join('\n') ?? '';
  if (field === 'appliancesText') return patch.guidance?.appliances.join('\n') ?? '';
  if (field === 'parallelTasksText') return patch.guidance?.parallelTasks.join('\n') ?? '';
  if (field === 'tipsAndVariationsText') return patch.guidance?.tipsAndVariations.join('\n') ?? '';
  if (field === 'batchCookingWarningText') return patch.guidance?.batchCookingWarning ?? '';
  if (field.startsWith('nutrition.')) {
    const property = field.split('.')[1] as keyof NonNullable<AIRecipeImprovePatch['nutrition']>;
    return String(patch.nutrition?.[property] ?? '');
  }
  if (field.startsWith('storage.')) {
    const property = field.split('.')[1] as keyof NonNullable<AIRecipeImprovePatch['storage']>;
    return String(patch.storage?.[property] ?? '');
  }
  if (field === 'tagsText') return patch.tags?.join('\n') ?? '';
  const value = patch[field as keyof AIRecipeImprovePatch];
  if (value === null || value === undefined) return '';
  return Array.isArray(value) ? value.join('\n') : String(value);
}

function formatQuantity(quantity: number): string {
  return String(Math.round(quantity * 100) / 100);
}

/** Changes only selected fields; media IDs/attribution and the saved serving base stay intact. */
export function applyRecipeImprovement(
  draft: RecipeEditDraft,
  patch: AIRecipeImprovePatch,
  scopes: readonly RecipeImproveScope[]
): RecipeEditDraft {
  const includes = (scope: RecipeImproveScope) => scopes.includes(scope);
  const servings = parseInteger(draft.servings, 1) ?? 1;

  if (includes('details')) {
    if (patch.name !== undefined) draft.name = patch.name;
    if (patch.description !== undefined) draft.description = patch.description ?? '';
    if (patch.difficulty !== undefined) draft.difficulty = patch.difficulty;
    if (patch.cuisine !== undefined) draft.cuisine = patch.cuisine ?? '';
    if (patch.tags !== undefined) draft.tagsText = patch.tags.join('\n');
  }

  if (includes('ingredients') && patch.ingredients !== undefined) {
    draft.ingredients = patch.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantityText: formatQuantity(ingredient.quantity * servings),
      unit: ingredient.unit,
      preparation: ingredient.preparation ?? '',
      isOptional: ingredient.isOptional,
      substitutesText: ingredient.substitutes.join(', '),
      notes: ingredient.notes ?? ''
    }));
  }

  if (includes('timing')) {
    if (patch.totalTime !== undefined) draft.totalTime = patch.totalTime;
    if (patch.prepTime !== undefined) draft.prepTime = patch.prepTime;
    if (patch.cookTime !== undefined) draft.cookTime = patch.cookTime;
    if (patch.restTime !== undefined) draft.restTime = patch.restTime ?? '';
  }

  if (includes('preparation') && patch.instructionsByLevel !== undefined) {
    const oldLevels = draft.instructionsByLevel;
    const previousFlat = draft.steps ?? [];
    const nextLevels = Object.fromEntries(
      LEVELS.map((level) => [
        level,
        patch.instructionsByLevel![level].map((step, index) => {
          const previous = (oldLevels?.[level] ?? previousFlat).find(
            (candidate) => candidate.stepNumber === index + 1
          );
          return {
            stepNumber: index + 1,
            instruction: step.instruction,
            durationText: step.duration ?? '',
            temperatureText: step.temperature?.value ?? '',
            temperatureUnit: step.temperature?.unit ?? 'C',
            temperatureEnabled: step.temperature != null,
            timerRequired: step.timerRequired,
            timerDurationText: step.timerDuration ?? '',
            tips: step.tips ?? '',
            warning: step.warning ?? '',
            imageUrl: previous?.imageUrl ?? '',
            imagePhotoId: previous?.imagePhotoId ?? null,
            imageAttribution: previous?.imageAttribution ?? null,
            videoId: previous?.videoId ?? null,
            video: previous?.video ?? null,
            photoSearchQuery: previous?.photoSearchQuery ?? '',
            illustration: previous?.illustration ?? undefined
          } satisfies RecipeEditorStep;
        })
      ])
    );
    draft.instructionsByLevel = nextLevels as Record<RecipeDetailLevel, RecipeEditorStep[]>;
    draft.steps = undefined;
  }

  if (includes('guidance')) {
    if (patch.utensils !== undefined) draft.utensilsText = patch.utensils.join('\n');
    if (patch.guidance !== undefined && patch.guidance !== null) {
      draft.appliancesText = patch.guidance.appliances.join('\n');
      draft.parallelTasksText = patch.guidance.parallelTasks.join('\n');
      draft.tipsAndVariationsText = patch.guidance.tipsAndVariations.join('\n');
      draft.batchCookingWarningText = patch.guidance.batchCookingWarning ?? '';
    }
  }

  if (includes('nutrition')) {
    if (patch.calories !== undefined) draft.calories = patch.calories ?? '';
    if (patch.nutrition !== undefined) {
      draft.nutritionEnabled = patch.nutrition !== null;
      if (patch.nutrition) {
        draft.nutrition = {
          calories: String(patch.nutrition.calories),
          protein: String(patch.nutrition.protein),
          carbs: String(patch.nutrition.carbs),
          fat: String(patch.nutrition.fat),
          fiber: patch.nutrition.fiber === null ? '' : String(patch.nutrition.fiber),
          sugar: draft.nutrition.sugar,
          sodium: draft.nutrition.sodium
        };
      }
    }
  }

  if (includes('storage') && patch.storage !== undefined) {
    draft.storageEnabled = patch.storage !== null;
    if (patch.storage) {
      draft.storage = {
        method: patch.storage.method,
        container: patch.storage.container ?? '',
        duration: patch.storage.duration,
        reheatingInstructions: patch.storage.reheatingInstructions ?? '',
        freezingPossible: patch.storage.freezingPossible,
        freezingDuration: patch.storage.freezingDuration ?? ''
      };
    }
  }

  return draft;
}

export function recipeImprovementChanges(
  draft: RecipeEditDraft,
  patch: AIRecipeImprovePatch,
  scopes: readonly RecipeImproveScope[],
  translate: RecipeReviewTranslator
): RecipeImprovementChange[] {
  const original = JSON.parse(JSON.stringify(draft)) as RecipeEditDraft;
  const improved = JSON.parse(JSON.stringify(draft)) as RecipeEditDraft;
  applyRecipeImprovement(improved, patch, scopes);
  const fieldGroups: Record<RecipeImproveScope, Array<{ field: string; label: TranslationKey }>> = {
    details: [
      { field: 'name', label: 'recipes.improve.field.name' },
      { field: 'description', label: 'recipes.improve.field.description' },
      { field: 'difficulty', label: 'recipes.improve.field.difficulty' },
      { field: 'cuisine', label: 'recipes.improve.field.cuisine' },
      { field: 'tagsText', label: 'recipes.improve.field.tags' }
    ],
    ingredients: [{ field: 'ingredients', label: 'recipes.improve.field.ingredients' }],
    timing: [
      { field: 'totalTime', label: 'recipes.editor.total_time' },
      { field: 'prepTime', label: 'recipes.editor.prep_time' },
      { field: 'cookTime', label: 'recipes.editor.cook_time' },
      { field: 'restTime', label: 'recipes.editor.rest_time' }
    ],
    preparation: LEVELS.map((level) => ({
      field: `instructionsByLevel.${level}`,
      label: LEVEL_FIELD_LABELS[level]
    })),
    guidance: [
      { field: 'utensilsText', label: 'recipes.improve.field.utensils' },
      { field: 'appliancesText', label: 'recipes.editor.appliances' },
      { field: 'parallelTasksText', label: 'recipes.editor.parallel_tasks' },
      { field: 'tipsAndVariationsText', label: 'recipes.editor.tips_variations' },
      { field: 'batchCookingWarningText', label: 'recipes.improve.field.batch_warning' }
    ],
    nutrition: [
      { field: 'calories', label: 'recipes.editor.calories' },
      { field: 'nutrition.protein', label: 'recipes.editor.protein' },
      { field: 'nutrition.carbs', label: 'recipes.editor.carbs' },
      { field: 'nutrition.fat', label: 'recipes.editor.fat' },
      { field: 'nutrition.fiber', label: 'recipes.editor.fiber' }
    ],
    storage: [
      { field: 'storage.method', label: 'recipes.editor.storage_method' },
      { field: 'storage.container', label: 'recipes.editor.storage_container' },
      { field: 'storage.duration', label: 'recipes.editor.storage_duration' },
      { field: 'storage.reheatingInstructions', label: 'recipes.editor.storage_reheating' },
      { field: 'storage.freezingPossible', label: 'recipes.editor.storage_freezing' },
      { field: 'storage.freezingDuration', label: 'recipes.editor.storage_freezing_duration' }
    ]
  };

  return scopes.flatMap((scope) =>
    fieldGroups[scope].flatMap(({ field, label }) => {
      const before = formatDraftValue(original, field, translate);
      const after = field.startsWith('instructionsByLevel.')
        ? formatAiSteps(
            patch.instructionsByLevel?.[field.split('.')[1] as RecipeDetailLevel],
            translate
          )
        : field === 'steps' && patch.instructionsByLevel
          ? LEVELS.map(
              (level) =>
                `${level}:\n${formatAiSteps(patch.instructionsByLevel?.[level], translate)}`
            ).join('\n\n')
          : formatPatchValue(draft, patch, field, translate);
      if (before === after) return [];
      return [{ scope, label, before, after }];
    })
  );
}
