import { MEAL_LABEL_KEYS } from '../../core/i18n/labels';
import type { TranslationKey } from '../../core/i18n';
import type { CalendarMeal } from '../../shared/models/calendar.model';

/** ISO date in the user's local calendar, avoiding UTC's previous-day boundary. */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shift by local calendar days without crossing a UTC date boundary or mutating the input. */
export function localIsoDateOffset(date: Date, offset: number): string {
  return localIsoDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));
}

function compareMealTimes(left: CalendarMeal, right: CalendarMeal): number {
  if (left.time == null && right.time != null) return 1;
  if (left.time != null && right.time == null) return -1;

  return (
    (left.time ?? '').localeCompare(right.time ?? '') ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

/** Keep only pending meals for one local date, in a stable time order. */
export function pendingMealsForDate(meals: readonly CalendarMeal[], date: string): CalendarMeal[] {
  return meals.filter((meal) => meal.date === date && !meal.completed).sort(compareMealTimes);
}

/**
 * Find the next incomplete meal in seven local calendar dates, including today.
 * Untimed meals today remain candidates; timed meals earlier than the local
 * current time do not.
 */
export function nextPendingMeal(meals: readonly CalendarMeal[], now: Date): CalendarMeal | null {
  const today = localIsoDate(now);
  const lastDate = localIsoDateOffset(now, 6);
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    meals
      .filter(
        (meal) =>
          !meal.completed &&
          meal.date >= today &&
          meal.date <= lastDate &&
          (meal.date !== today || meal.time == null || meal.time >= currentTime)
      )
      .sort(
        (left, right) => left.date.localeCompare(right.date) || compareMealTimes(left, right)
      )[0] ?? null
  );
}

/** Resolve meal type through the shared dictionary instead of hard-coding Spanish text. */
export function mealTypeLabel(
  mealType: CalendarMeal['mealType'],
  translate: (key: TranslationKey) => string
): string {
  return translate(MEAL_LABEL_KEYS[mealType]);
}
