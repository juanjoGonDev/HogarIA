import type { HouseholdMember } from '../../shared/models/household.model';
import type { HouseholdMealProposal } from '../../core/services/household-meal-proposal.service';

const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const MAX_EVENTS = 7 * 4 * 100;

interface ApiRecord {
  [key: string]: unknown;
  alias?: unknown;
  baseServings?: unknown;
  cookTimeMinutes?: unknown;
  date?: unknown;
  description?: unknown;
  events?: unknown;
  householdMemberId?: unknown;
  id?: unknown;
  ingredients?: unknown;
  instructions?: unknown;
  isOptional?: unknown;
  mealType?: unknown;
  name?: unknown;
  notes?: unknown;
  objectiveSummary?: unknown;
  participantAliases?: unknown;
  participantIds?: unknown;
  participants?: unknown;
  prepTimeMinutes?: unknown;
  preparation?: unknown;
  proposalId?: unknown;
  quantity?: unknown;
  reason?: unknown;
  recipe?: unknown;
  servings?: unknown;
  status?: unknown;
  time?: unknown;
  unit?: unknown;
  weekStart?: unknown;
}

/** Defensively checks the API boundary before rendering or allowing a confirmation write. */
export function validateHouseholdMealProposal(
  value: unknown,
  weekStart: string,
  selectedMemberIds: readonly string[],
  members: readonly HouseholdMember[]
): value is HouseholdMealProposal {
  if (!isRecord(value) || !nonEmpty(value.proposalId) || value.weekStart !== weekStart)
    return false;
  if (!Array.isArray(value.participants) || !Array.isArray(value.events)) return false;
  if (value.events.length > MAX_EVENTS) return false;

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
    if (!member || aliasToMember.has(participant.alias) || usedMembershipIds.has(member.id))
      return false;
    aliasToMember.set(participant.alias, member);
    usedMembershipIds.add(member.id);
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
    if (!Array.isArray(event.participantAliases) || event.participantAliases.length === 0)
      return false;
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
        !isValidRecipe(event.recipe)
      ) {
        return false;
      }
    } else if (event.status === 'unresolved') {
      if (event.servings !== 0 || event.recipe !== null || !nonEmpty(event.reason)) return false;
    } else {
      return false;
    }
  }

  return true;
}

function isValidRecipe(value: unknown): boolean {
  if (!isRecord(value) || !nonEmpty(value.name) || !nonEmpty(value.description)) return false;
  if (
    value.baseServings !== 1 ||
    !Number.isInteger(value.prepTimeMinutes) ||
    !Number.isInteger(value.cookTimeMinutes) ||
    !Array.isArray(value.ingredients) ||
    value.ingredients.length === 0 ||
    !Array.isArray(value.instructions) ||
    value.instructions.length === 0
  ) {
    return false;
  }
  return (
    value.ingredients.every(
      (ingredient) =>
        isRecord(ingredient) &&
        nonEmpty(ingredient.name) &&
        typeof ingredient.quantity === 'number' &&
        Number.isFinite(ingredient.quantity) &&
        ingredient.quantity > 0 &&
        nonEmpty(ingredient.unit) &&
        (ingredient.preparation === null || typeof ingredient.preparation === 'string') &&
        typeof ingredient.isOptional === 'boolean' &&
        (ingredient.notes === null || typeof ingredient.notes === 'string')
    ) && value.instructions.every(nonEmpty)
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

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
