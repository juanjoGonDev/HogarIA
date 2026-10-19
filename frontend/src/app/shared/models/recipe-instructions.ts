export type RecipeDetailLevel = 'basic' | 'intermediate' | 'expert';

export interface RecipeInstructionStep {
  stepNumber: number;
  instruction: string;
  duration?: number | null;
  temperature?: { value: number; unit: 'C' | 'F' } | null;
  image?: string;
  /** Short-lived Wikimedia result id; the API resolves it to a local asset before persistence. */
  imagePhotoId?: string;
  imageAttribution?: RecipeStepImageAttribution | null;
  /** Search result ID; the API resolves and persists its licensed Commons metadata. */
  videoId?: string;
  /** Server-hydrated Commons attribution for an explicitly selected saved clip. */
  video?: import('./recipe-step-video').RecipeStepVideoCandidate | null;
  tips?: string | null;
  warning?: string | null;
  timerRequired?: boolean;
  timerDuration?: number | null;
  illustration?: RecipeStepIllustration | null;
}

export interface RecipeStepImageAttribution {
  altText: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
}

export interface RecipeStepIllustration {
  url: string;
  altText: string;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
}

export type RecipeInstructionsByLevel = Record<RecipeDetailLevel, RecipeInstructionStep[]>;

export interface RecipeInstructionSource {
  instructionsByLevel?: Partial<RecipeInstructionsByLevel> | null;
  steps?: RecipeInstructionStep[] | null;
}

/** Prefer a stored detail variant, then fall back to the single legacy list without fabricating variants. */
export function recipeInstructionsForLevel(
  recipe: RecipeInstructionSource,
  level: RecipeDetailLevel
): RecipeInstructionStep[] {
  const selectedInstructions = recipe.instructionsByLevel?.[level];
  return selectedInstructions?.length ? selectedInstructions : (recipe.steps ?? []);
}
