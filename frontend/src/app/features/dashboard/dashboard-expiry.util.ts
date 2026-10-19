import type { CaducidadRow } from '../../shared/models/caducidades.model';

export const DEFAULT_EXPIRY_HORIZON_DAYS = 3;
export const MIN_EXPIRY_HORIZON_DAYS = 1;
export const MAX_EXPIRY_HORIZON_DAYS = 30;
export const DASHBOARD_EXPIRY_PREVIEW_LIMIT = 5;

export function isExpiryHorizonDays(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_EXPIRY_HORIZON_DAYS &&
    value <= MAX_EXPIRY_HORIZON_DAYS
  );
}

/** Keep the most urgent known dates first; unknown expiry dates are not an urgency warning. */
export function expiringWithinDays(
  rows: readonly CaducidadRow[],
  horizonDays: number,
  limit = DASHBOARD_EXPIRY_PREVIEW_LIMIT
): CaducidadRow[] {
  if (!isExpiryHorizonDays(horizonDays) || !Number.isFinite(limit) || limit <= 0) return [];

  return rows
    .filter((row) => row.daysLeft !== null && row.daysLeft <= horizonDays)
    .slice()
    .sort((left, right) => {
      const daysDifference =
        (left.daysLeft ?? Number.POSITIVE_INFINITY) - (right.daysLeft ?? Number.POSITIVE_INFINITY);
      return daysDifference || left.name.localeCompare(right.name, 'es');
    })
    .slice(0, Math.floor(limit));
}
