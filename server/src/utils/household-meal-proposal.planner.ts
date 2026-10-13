import {
  mealProposalSchema,
  type MealProposal
} from '../schemas/household-meal-proposal.schema.js';
import type { MealTypeKey } from '../schemas/household-meal-planning.schema.js';
import type {
  MealPlanningObjective,
  MealPlanningSchedule
} from './household-meal-planning.store.js';
import { findIngredientRestrictionConflicts } from './recipe-replacement.js';

export interface MealProposalMemberContext {
  alias: string;
  householdMemberId: string;
  schedule: MealPlanningSchedule;
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

function recipeText(event: MealProposal['events'][number]): string[] {
  if (!event.recipe) return [event.objectiveSummary, event.reason ?? ''];
  return [
    event.objectiveSummary,
    event.reason ?? '',
    event.recipe.name,
    event.recipe.description,
    ...event.recipe.ingredients.flatMap((ingredient) => [
      ingredient.name,
      ingredient.preparation ?? '',
      ingredient.notes ?? ''
    ]),
    ...event.recipe.instructions
  ];
}

function hasPrivateOutputLeak(
  event: MealProposal['events'][number],
  members: readonly MealProposalMemberContext[]
): boolean {
  const visibleText = comparableText(recipeText(event).join(' '));
  if (!visibleText) return false;

  return members.some((member) => {
    const soleAssignee =
      event.participantAliases.length === 1 && event.participantAliases[0] === member.alias;
    const privateTerms = [
      ...member.privateOutputTerms,
      // Allergies are model inputs for safety but never belong in calendar-visible copy, even
      // when the event is assigned to another participant or the dish itself is otherwise safe.
      ...member.strictRestrictions,
      ...(soleAssignee ? [] : member.privateGoalTerms)
    ];
    return privateTerms.some((term) => containsPrivateTerm(visibleText, term));
  });
}

function unresolvedEvent(
  event: MealProposal['events'][number],
  participantAliases = event.participantAliases
): MealProposal['events'][number] {
  return {
    ...event,
    recipe: null,
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

/** Validate the provider's schedule against the resolved household inputs and fail closed. */
export function normalizeMealProposal(
  value: unknown,
  expectedSlots: readonly ExpectedMealSlot[],
  members: readonly MealProposalMemberContext[]
): MealProposal {
  const parsed = mealProposalSchema.safeParse(value);
  if (!parsed.success)
    throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');

  const memberByAlias = new Map(members.map((member) => [member.alias, member]));
  const expectedByKey = new Map(
    expectedSlots.map((slot) => [slotKey(slot.date, slot.mealType, slot.time), slot])
  );
  const assignedBySlot = new Map<string, Set<string>>();
  const normalized: MealProposal['events'] = [];

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
    if (event.status === 'unresolved' || !event.recipe) {
      normalized.push({
        ...event,
        objectiveSummary: UNRESOLVED_SUMMARY,
        reason: UNSAFE_REASON
      });
      continue;
    }

    if (hasPrivateOutputLeak(event, members)) {
      normalized.push(unresolvedEvent(event));
      continue;
    }

    // Check every model-controlled field, not only the ingredient list. A forbidden allergen can
    // also be hidden in a description or instruction even when all listed ingredients look safe.
    const ingredientText = recipeText(event);
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
        recipe: null,
        participantAliases: slot.unresolvedAliases,
        servings: 0,
        objectiveSummary: UNRESOLVED_SUMMARY,
        status: 'unresolved',
        reason: UNSAFE_REASON
      });
    }
  }

  const result = mealProposalSchema.safeParse({ events: normalized });
  if (!result.success)
    throw new MealProposalValidationError('MEAL_PROPOSAL_SLOT_ASSIGNMENT_INVALID');
  return result.data;
}
