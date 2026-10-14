import {
  mealProposalSchema,
  type MealProposalEvent,
  type ResolvedMealProposalRecipe
} from '../schemas/household-meal-proposal.schema.js';
import type { MealTypeKey } from '../schemas/household-meal-planning.schema.js';
import type {
  MealPlanningObjective,
  MealPlanningSchedule
} from './household-meal-planning.store.js';
import { findIngredientRestrictionConflicts } from './recipe-replacement.js';
import type { HouseholdMealRecipeCatalogEntry } from './household-meal-recipe-catalog.js';

export interface ResolvedMealProposalEvent extends Omit<MealProposalEvent, 'recipeAlias'> {
  recipeAlias: string | null;
}

export interface ResolvedMealProposal {
  recipes: ResolvedMealProposalRecipe[];
  events: ResolvedMealProposalEvent[];
}

export interface MealProposalMemberContext {
  alias: string;
  householdMemberId: string;
  userId: string;
  schedule: MealPlanningSchedule & { source?: 'household' | 'member' };
  goal: MealPlanningObjective;
  goalOverrideEnabled: boolean;
  strictRestrictions: string[];
  unsupportedRestrictions: string[];
  likes: string[];
  dislikes: string[];
  /** Sensitive profile strings used only by the local output privacy check; never include in prompts. */
  privateOutputTerms: string[];
  /** Personal goals are allowed for their sole assignee, never repeated in a shared/group event. */
  privateGoalTerms: string[];
}

export interface ExpectedMealSlot {
  date: string;
  mealType: MealTypeKey;
  time: string;
  participantAliases: string[];
  aiParticipantAliases: string[];
  unresolvedAliases: string[];
}

export class MealProposalValidationError extends Error {
  constructor(
    readonly code: 'MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID' | 'MEAL_PROPOSAL_SLOT_COVERAGE_INVALID'
  ) {
    super(code);
    this.name = 'MealProposalValidationError';
  }
}

const UNRESOLVED_SUMMARY = 'Requiere revisión antes de planificar una opción segura.';
const UNSAFE_REASON =
  'No se ha podido validar una opción segura para este grupo; hace falta revisarla.';
const SHARED_SUMMARY = 'Plato compartido compatible con las preferencias de este grupo.';

function slotKey(date: string, mealType: MealTypeKey, time: string): string {
  return `${date}|${mealType}|${time}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days));
  return value.toISOString().slice(0, 10);
}

function comparableText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPrivateTerm(text: string, term: string): boolean {
  const normalized = comparableText(term);
  if (normalized.length < 3) return false;
  const isWordCharacter = (value: string | undefined) =>
    Boolean(value && /[\p{L}\p{N}]/u.test(value));
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(normalized, offset);
    if (index < 0) return false;
    const previous = [...text.slice(0, index)].at(-1);
    const next = [...text.slice(index + normalized.length)].at(0);
    if (!isWordCharacter(previous) && !isWordCharacter(next)) return true;
    offset = index + 1;
  }
  return false;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectStrings);
}

function recipeText(event: MealProposalEvent, recipe: Record<string, unknown> | null): string[] {
  return [event.objectiveSummary, event.reason ?? '', ...collectStrings(recipe)];
}

function privacyVisibleText(
  event: MealProposalEvent,
  recipe: Record<string, unknown> | null
): string[] {
  return [event.objectiveSummary, event.reason ?? '', ...collectStrings(recipe)];
}

function containsAllergyDisclosure(
  event: MealProposalEvent,
  recipe: Record<string, unknown> | null,
  member: MealProposalMemberContext
): boolean {
  if (!member.strictRestrictions.length) return false;
  const narrative = comparableText(privacyVisibleText(event, recipe).join(' '));
  if (/(?:alergi|allerg|intoleran)/.test(narrative)) return true;
  return member.strictRestrictions.some(
    (restriction) =>
      containsPrivateTerm(narrative, member.alias) && containsPrivateTerm(narrative, restriction)
  );
}

function hasPrivateOutputLeak(
  event: MealProposalEvent,
  recipe: Record<string, unknown> | null,
  members: readonly MealProposalMemberContext[]
): boolean {
  const visibleText = comparableText(privacyVisibleText(event, recipe).join(' '));
  if (!visibleText) return false;

  return members.some((member) => {
    const soleAssignee =
      event.participantAliases.length === 1 && event.participantAliases[0] === member.alias;
    const privateTerms = [
      ...member.privateOutputTerms,
      ...(soleAssignee ? [] : member.privateGoalTerms)
    ];
    return (
      privateTerms.some((term) => containsPrivateTerm(visibleText, term)) ||
      containsAllergyDisclosure(event, recipe, member)
    );
  });
}

function unresolvedEvent(
  event: MealProposalEvent,
  participantAliases = event.participantAliases
): ResolvedMealProposalEvent {
  return {
    ...event,
    recipeAlias: null,
    participantAliases,
    servings: 0,
    objectiveSummary: UNRESOLVED_SUMMARY,
    status: 'unresolved',
    reason: UNSAFE_REASON
  };
}

/** Resolve each member's configured weekly turns; matching meal times may share an event. */
export function buildExpectedMealSlots(
  weekStart: string,
  members: readonly MealProposalMemberContext[]
): ExpectedMealSlot[] {
  const grouped = new Map<string, ExpectedMealSlot>();
  for (let day = 0; day < 7; day += 1) {
    const date = addDays(weekStart, day);
    for (const mealType of ['breakfast', 'lunch', 'snack', 'dinner'] as const) {
      for (const member of members) {
        if (!member.schedule.mealTypes[mealType]) continue;
        const time = member.schedule.mealTimes[mealType];
        const key = slotKey(date, mealType, time);
        const slot = grouped.get(key) ?? {
          date,
          mealType,
          time,
          participantAliases: [],
          aiParticipantAliases: [],
          unresolvedAliases: []
        };
        slot.participantAliases.push(member.alias);
        if (member.unsupportedRestrictions.length) {
          slot.unresolvedAliases.push(member.alias);
        } else {
          slot.aiParticipantAliases.push(member.alias);
        }
        grouped.set(key, slot);
      }
    }
  }
  return [...grouped.values()];
}

/** Build review placeholders locally when every scheduled participant must stay out of AI. */
export function buildUnresolvedMealProposal(
  expectedSlots: readonly ExpectedMealSlot[]
): ResolvedMealProposal {
  if (
    !expectedSlots.length ||
    expectedSlots.some(
      (slot) =>
        slot.aiParticipantAliases.length > 0 ||
        slot.participantAliases.length === 0 ||
        slot.unresolvedAliases.length !== slot.participantAliases.length ||
        slot.participantAliases.some((alias) => !slot.unresolvedAliases.includes(alias))
    )
  ) {
    throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
  }

  const result = mealProposalSchema.safeParse({
    newRecipes: [],
    events: expectedSlots.map((slot) => ({
      date: slot.date,
      mealType: slot.mealType,
      time: slot.time,
      recipeAlias: null,
      participantAliases: slot.unresolvedAliases,
      servings: 0,
      objectiveSummary: UNRESOLVED_SUMMARY,
      status: 'unresolved',
      reason: UNSAFE_REASON
    }))
  });
  if (!result.success) {
    throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
  }
  return { recipes: [], events: result.data.events.map((event) => ({ ...event })) };
}

/** Validate the provider's schedule against the resolved household inputs and fail closed. */
export function normalizeMealProposal(
  value: unknown,
  expectedSlots: readonly ExpectedMealSlot[],
  members: readonly MealProposalMemberContext[],
  catalog: readonly HouseholdMealRecipeCatalogEntry[]
): ResolvedMealProposal {
  const parsed = mealProposalSchema.safeParse(value);
  if (!parsed.success)
    throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');

  const memberByAlias = new Map(members.map((member) => [member.alias, member]));
  const recipeByAlias = new Map<string, ResolvedMealProposalRecipe>();
  const selectableCatalogByAlias = new Map(catalog.map((recipe) => [recipe.alias, recipe]));
  const newRecipesByAlias = new Map(parsed.data.newRecipes.map((entry) => [entry.alias, entry]));
  for (const event of parsed.data.events) {
    if (event.status !== 'scheduled' || !event.recipeAlias) continue;
    const catalogRecipe = selectableCatalogByAlias.get(event.recipeAlias);
    if (event.recipeAlias.startsWith('R')) {
      if (!catalogRecipe)
        throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
      recipeByAlias.set(event.recipeAlias, catalogRecipe);
    } else {
      const generatedRecipe = newRecipesByAlias.get(event.recipeAlias);
      if (!generatedRecipe)
        throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
      recipeByAlias.set(event.recipeAlias, {
        alias: event.recipeAlias,
        source: 'new',
        recipeId: null,
        recipe: generatedRecipe.recipe
      });
    }
  }

  const expectedByKey = new Map(
    expectedSlots.map((slot) => [slotKey(slot.date, slot.mealType, slot.time), slot])
  );
  const assignedBySlot = new Map<string, Set<string>>();
  const normalized: ResolvedMealProposalEvent[] = [];

  for (const event of parsed.data.events) {
    const key = slotKey(event.date, event.mealType, event.time ?? '');
    const expected = expectedByKey.get(key);
    if (
      !expected ||
      event.participantAliases.some((alias) => !expected.aiParticipantAliases.includes(alias))
    ) {
      throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
    }
    const assigned = assignedBySlot.get(key) ?? new Set<string>();
    for (const alias of event.participantAliases) assigned.add(alias);
    assignedBySlot.set(key, assigned);

    const eventMemberRestrictions = event.participantAliases.map(
      (alias) => memberByAlias.get(alias)?.strictRestrictions ?? []
    );
    const definition = event.recipeAlias ? recipeByAlias.get(event.recipeAlias) : undefined;
    if (event.status === 'unresolved' || !definition) {
      normalized.push({
        ...event,
        recipeAlias: null,
        objectiveSummary: UNRESOLVED_SUMMARY,
        reason: UNSAFE_REASON
      });
      continue;
    }

    const catalogEntry = selectableCatalogByAlias.get(definition.alias);
    if (catalogEntry && !catalogEntry.selectable) {
      normalized.push(unresolvedEvent(event));
      continue;
    }

    if (hasPrivateOutputLeak(event, definition.recipe, members)) {
      normalized.push(unresolvedEvent(event));
      continue;
    }

    // Check every field and every detail level; restrictions can be hidden in advanced instructions.
    const ingredientText = recipeText(event, definition.recipe);
    const unsafeAliases = event.participantAliases.filter(
      (_, index) =>
        findIngredientRestrictionConflicts(ingredientText, eventMemberRestrictions[index] ?? [])
          .length > 0
    );
    const safeAliases = event.participantAliases.filter((alias) => !unsafeAliases.includes(alias));

    if (safeAliases.length) {
      const summary = safeAliases.length > 1 ? SHARED_SUMMARY : event.objectiveSummary;
      normalized.push({
        ...event,
        recipeAlias: definition.alias,
        participantAliases: safeAliases,
        servings: safeAliases.length,
        objectiveSummary: summary,
        reason: null
      });
    }
    if (unsafeAliases.length) {
      normalized.push(unresolvedEvent(event, unsafeAliases));
    }
  }

  for (const slot of expectedSlots) {
    const key = slotKey(slot.date, slot.mealType, slot.time);
    const assigned = assignedBySlot.get(key) ?? new Set<string>();
    const expectedAliases = slot.aiParticipantAliases;
    if (expectedAliases.some((alias) => !assigned.has(alias))) {
      throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_COVERAGE_INVALID');
    }
    if ([...assigned].some((alias) => !expectedAliases.includes(alias))) {
      throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
    }
    if (slot.unresolvedAliases.length) {
      normalized.push({
        date: slot.date,
        mealType: slot.mealType,
        time: slot.time,
        recipeAlias: null,
        participantAliases: slot.unresolvedAliases,
        servings: 0,
        objectiveSummary: UNRESOLVED_SUMMARY,
        status: 'unresolved',
        reason: UNSAFE_REASON
      });
    }
  }

  const usedAliases = new Set(
    normalized.flatMap((event) =>
      event.status === 'scheduled' && event.recipeAlias ? [event.recipeAlias] : []
    )
  );
  return {
    recipes: [...usedAliases]
      .map((alias) => recipeByAlias.get(alias))
      .filter((recipe): recipe is ResolvedMealProposalRecipe => Boolean(recipe)),
    events: normalized
  };
}
