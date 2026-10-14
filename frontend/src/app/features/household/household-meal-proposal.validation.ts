import type { HouseholdMember } from '../../shared/models/household.model';
import type {
  HouseholdMealProposal,
  HouseholdMealProposalRecipeReference,
  HouseholdMealRecipeInstructionStep
} from '../../core/services/household-meal-proposal.service';

const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const RECIPE_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const MAX_EVENTS = 7 * 4 * 100;
const MAX_RECIPES = MAX_EVENTS;

interface ApiRecord {
  [key: string]: unknown;
  alias?: unknown;
  appliances?: unknown;
  basic?: unknown;
  batchCookingWarning?: unknown;
  baseServings?: unknown;
  calories?: unknown;
  carbs?: unknown;
  container?: unknown;
  cookTime?: unknown;
  cuisine?: unknown;
  date?: unknown;
  description?: unknown;
  difficulty?: unknown;
  duration?: unknown;
  events?: unknown;
  expert?: unknown;
  fat?: unknown;
  fiber?: unknown;
  freezingDuration?: unknown;
  freezingPossible?: unknown;
  guidance?: unknown;
  householdMemberId?: unknown;
  id?: unknown;
  ingredients?: unknown;
  instruction?: unknown;
  instructionsByLevel?: unknown;
  intermediate?: unknown;
  isOptional?: unknown;
  illustration?: unknown;
  method?: unknown;
  mealType?: unknown;
  name?: unknown;
  notes?: unknown;
  nutrition?: unknown;
  objectiveSummary?: unknown;
  parallelTasks?: unknown;
  participantAliases?: unknown;
  participantIds?: unknown;
  participants?: unknown;
  prepTime?: unknown;
  preparation?: unknown;
  protein?: unknown;
  proposalId?: unknown;
  quantity?: unknown;
  recipe?: unknown;
  recipeAlias?: unknown;
  recipeId?: unknown;
  recipes?: unknown;
  reheatingInstructions?: unknown;
  reason?: unknown;
  restTime?: unknown;
  servings?: unknown;
  source?: unknown;
  stepNumber?: unknown;
  steps?: unknown;
  storage?: unknown;
  substitutes?: unknown;
  tags?: unknown;
  temperature?: unknown;
  timerDuration?: unknown;
  timerRequired?: unknown;
  tips?: unknown;
  tipsAndVariations?: unknown;
  totalTime?: unknown;
  utensils?: unknown;
  unit?: unknown;
  status?: unknown;
  time?: unknown;
  warning?: unknown;
  weekStart?: unknown;
}

/** Defensively checks the API boundary before rendering or allowing a confirmation write. */
export function validateHouseholdMealProposal(
  value: unknown,
  weekStart: string,
  selectedMemberIds: readonly string[],
  members: readonly HouseholdMember[]
): value is HouseholdMealProposal {
  if (!isRecord(value) || !nonEmpty(value.proposalId) || value.weekStart !== weekStart) {
    return false;
  }
  if (
    !Array.isArray(value.participants) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.recipes)
  ) {
    return false;
  }
  if (value.events.length > MAX_EVENTS || value.recipes.length > MAX_RECIPES) return false;

  const selected = new Set(selectedMemberIds);
  const membersByMembershipId = new Map(
    members
      .filter(
        (member) =>
          member.isActive && member.permissions?.calendar?.view === true && selected.has(member.id)
      )
      .map((member) => [member.id, member])
  );
  if (membersByMembershipId.size !== selected.size || value.participants.length !== selected.size) {
    return false;
  }

  const aliasToMember = new Map<string, HouseholdMember>();
  const usedMembershipIds = new Set<string>();
  for (const participant of value.participants) {
    if (!isRecord(participant) || !nonEmpty(participant.alias)) return false;
    if (!/^P(?:[1-9]|[1-9]\d|100)$/.test(participant.alias)) return false;
    if (!nonEmpty(participant.householdMemberId)) return false;
    const member = membersByMembershipId.get(participant.householdMemberId);
    if (!member || aliasToMember.has(participant.alias) || usedMembershipIds.has(member.id)) {
      return false;
    }
    aliasToMember.set(participant.alias, member);
    usedMembershipIds.add(member.id);
  }

  const recipesByAlias = new Map<string, HouseholdMealProposalRecipeReference>();
  const catalogRecipeIds = new Set<string>();
  for (const recipeReference of value.recipes) {
    if (!isValidRecipeReference(recipeReference)) return false;
    if (recipesByAlias.has(recipeReference.alias)) return false;
    if (recipeReference.source === 'catalog') {
      if (!recipeReference.recipeId || catalogRecipeIds.has(recipeReference.recipeId)) return false;
      catalogRecipeIds.add(recipeReference.recipeId);
    } else if (recipeReference.recipeId !== null) {
      return false;
    }
    recipesByAlias.set(recipeReference.alias, recipeReference);
  }

  const seenEventIds = new Set<string>();
  const assignedSlots = new Set<string>();
  for (const event of value.events) {
    if (!isRecord(event) || !nonEmpty(event.id) || seenEventIds.has(event.id)) return false;
    seenEventIds.add(event.id);
    if (!isDateInWeek(event.date, weekStart)) return false;
    if (typeof event.mealType !== 'string' || !MEAL_TYPES.has(event.mealType)) return false;
    if (
      event.time !== null &&
      (typeof event.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time))
    ) {
      return false;
    }
    if (!nonEmpty(event.objectiveSummary)) return false;
    if (!Array.isArray(event.participantAliases) || event.participantAliases.length === 0) {
      return false;
    }
    if (!Array.isArray(event.participantIds)) return false;
    const participantIds = event.participantIds as unknown[];

    const eventAliases = new Set<string>();
    const expectedParticipantIds: string[] = [];
    for (const alias of event.participantAliases) {
      if (typeof alias !== 'string' || eventAliases.has(alias)) return false;
      const member = aliasToMember.get(alias);
      if (!member) return false;
      eventAliases.add(alias);
      expectedParticipantIds.push(member.userId);
      const slot = `${alias}|${event.date}|${event.mealType}`;
      if (assignedSlots.has(slot)) return false;
      assignedSlots.add(slot);
    }
    if (
      participantIds.length !== expectedParticipantIds.length ||
      new Set(participantIds).size !== participantIds.length ||
      expectedParticipantIds.some((id) => !participantIds.includes(id))
    ) {
      return false;
    }

    if (event.status === 'scheduled') {
      if (
        !Number.isInteger(event.servings) ||
        (event.servings as number) < 1 ||
        (event.servings as number) > 100 ||
        event.reason !== null ||
        !nonEmpty(event.recipeAlias) ||
        !recipesByAlias.has(event.recipeAlias)
      ) {
        return false;
      }
    } else if (event.status === 'unresolved') {
      if (event.servings !== 0 || event.recipeAlias !== null || !nonEmpty(event.reason))
        return false;
    } else {
      return false;
    }
  }

  return true;
}

function isValidRecipeReference(value: unknown): value is HouseholdMealProposalRecipeReference {
  if (!isRecord(value) || !nonEmpty(value.alias) || value.alias.length > 100) return false;
  if (value.source !== 'catalog' && value.source !== 'new') return false;
  if (value.source === 'catalog' && !nonEmpty(value.recipeId)) return false;
  if (value.source === 'new' && value.recipeId !== null) return false;
  return isValidRecipe(value.recipe);
}

function isValidRecipe(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !nonEmpty(value.name) ||
    !nonEmpty(value.description) ||
    !Number.isInteger(value.baseServings) ||
    (value.baseServings as number) < 1 ||
    (value.baseServings as number) > 100 ||
    typeof value.difficulty !== 'string' ||
    !RECIPE_DIFFICULTIES.has(value.difficulty) ||
    !(value.cuisine === null || typeof value.cuisine === 'string') ||
    !positiveInteger(value.totalTime) ||
    !nonNegativeInteger(value.prepTime) ||
    !nonNegativeInteger(value.cookTime) ||
    !(value.restTime === null || nonNegativeInteger(value.restTime)) ||
    !(value.calories === null || nonNegativeNumber(value.calories)) ||
    !Array.isArray(value.ingredients) ||
    value.ingredients.length === 0 ||
    !isStringArray(value.utensils) ||
    !isValidGuidance(value.guidance) ||
    !isValidNutrition(value.nutrition) ||
    !isValidStorage(value.storage) ||
    !isStringArray(value.tags)
  ) {
    return false;
  }

  const hasLevelProperty = value.instructionsByLevel !== undefined;
  // The server serializes a missing flat-step representation as `null` for catalog recipes that
  // already have three explicit instruction levels. Treat that exactly like an omitted field.
  const hasLegacyProperty = value.steps !== undefined && value.steps !== null;
  if (hasLevelProperty === hasLegacyProperty) return false;
  const hasLevels = isRecord(value.instructionsByLevel);
  const hasLegacySteps = Array.isArray(value.steps);
  if (hasLevels !== hasLevelProperty || hasLegacySteps !== hasLegacyProperty) return false;
  const validInstructions = hasLevels
    ? isValidInstructionLevels(value.instructionsByLevel as ApiRecord)
    : isValidLegacySteps(value.steps);

  return validInstructions && value.ingredients.every(isValidIngredient);
}

function isValidIngredient(value: unknown): boolean {
  return (
    isRecord(value) &&
    nonEmpty(value.name) &&
    positiveNumber(value.quantity) &&
    nonEmpty(value.unit) &&
    (value.preparation === null || typeof value.preparation === 'string') &&
    typeof value.isOptional === 'boolean' &&
    isStringArray(value.substitutes) &&
    (value.notes === null || typeof value.notes === 'string')
  );
}

function isValidGuidance(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringArray(value.appliances) &&
    isStringArray(value.parallelTasks) &&
    isStringArray(value.tipsAndVariations) &&
    (value.batchCookingWarning === null || typeof value.batchCookingWarning === 'string')
  );
}

function isValidInstructionLevels(value: ApiRecord): boolean {
  return (
    isOrderedSteps(value.basic, true) &&
    isOrderedSteps(value.intermediate, true) &&
    isOrderedSteps(value.expert, true)
  );
}

function isValidLegacySteps(value: unknown): value is HouseholdMealRecipeInstructionStep[] {
  return isOrderedSteps(value, false);
}

function isOrderedSteps(value: unknown, strictIllustration: boolean): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((step, index) => {
    if (!isRecord(step) || !positiveInteger(step.stepNumber) || !nonEmpty(step.instruction)) {
      return false;
    }
    if (
      strictIllustration &&
      (!('duration' in step) || !('tips' in step) || !('warning' in step))
    ) {
      return false;
    }
    if (strictIllustration && step.illustration !== null) return false;
    if (!strictIllustration && 'illustration' in step && step.illustration !== null) {
      // Legacy saved recipes may carry an illustration object; it is never rendered as trusted HTML.
      if (!isRecord(step.illustration)) return false;
    }
    if ('duration' in step && !(step.duration === null || positiveInteger(step.duration))) {
      return false;
    }
    if ('temperature' in step && !isValidTemperature(step.temperature)) return false;
    if ('timerRequired' in step && typeof step.timerRequired !== 'boolean') return false;
    if (
      'timerDuration' in step &&
      !(step.timerDuration === null || positiveInteger(step.timerDuration))
    ) {
      return false;
    }
    if ('tips' in step && !(step.tips === null || typeof step.tips === 'string')) return false;
    if ('warning' in step && !(step.warning === null || typeof step.warning === 'string')) {
      return false;
    }
    return strictIllustration ? step.stepNumber === index + 1 : true;
  });
}

function isValidNutrition(value: unknown): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    finiteNumber(value.calories) &&
    finiteNumber(value.protein) &&
    finiteNumber(value.carbs) &&
    finiteNumber(value.fat) &&
    (value.fiber === null || finiteNumber(value.fiber))
  );
}

function isValidTemperature(value: unknown): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    finiteNumber(value['value']) &&
    (value['unit'] === 'C' || value['unit'] === 'F')
  );
}

function isValidStorage(value: unknown): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    nonEmpty(value.method) &&
    nonEmpty(value.duration) &&
    (value.reheatingInstructions === null || typeof value.reheatingInstructions === 'string') &&
    (value.container === null || typeof value.container === 'string') &&
    typeof value.freezingPossible === 'boolean' &&
    (value.freezingDuration === null || typeof value.freezingDuration === 'string')
  );
}

function isDateInWeek(value: unknown, weekStart: string): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = Date.parse(`${value}T00:00:00.000Z`);
  const start = Date.parse(`${weekStart}T00:00:00.000Z`);
  return Number.isFinite(date) && date >= start && date < start + 7 * 24 * 60 * 60 * 1000;
}

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
