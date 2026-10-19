import { productKeyOf, normalizeProductName } from './product-key.js';

type ReceiptLineIdentity = {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  priceMinor?: number | null;
  offer?: { buy?: number | null; take?: number | null } | null;
  confidence?: number | null;
  note?: string | null;
  category?: string | null;
};

type DuplicateGroup<T> = {
  indexes: number[];
  lines: T[];
  priceMinor: number;
  canRetainMultiple: boolean;
};

type ReconciliationPath = {
  previous: ReconciliationPath | null;
  removedCount: number;
};

type ReconciliationState = {
  solutions: number;
  path: ReconciliationPath | null;
};

const MAX_RECONCILIATION_STATES = 4096;

/**
 * Collapse repeated visual views only when the ticket total reconciles with the deduplicated rows.
 * If the printed rows already sum to the total, or the arithmetic is incomplete/ambiguous, retain
 * every row: two separate purchases can have identical product, quantity, unit, price and offer.
 */
export function deduplicateTicketLines<T extends ReceiptLineIdentity>(
  lines: readonly T[],
  totalMinor: number | null | undefined
): T[] {
  const ticketTotal = knownNumber(totalMinor);
  const prices = lines.map((line) => knownNumber(line.priceMinor));
  if (
    ticketTotal === null ||
    !Number.isInteger(ticketTotal) ||
    ticketTotal < 0 ||
    prices.some((price) => price === null || !Number.isInteger(price) || price < 0)
  ) {
    return [...lines];
  }

  const originalTotal = prices.reduce<number>((sum, price) => sum + (price ?? 0), 0);
  if (originalTotal === ticketTotal) return [...lines];

  const groupsByKey = new Map<string, DuplicateGroup<T>>();
  lines.forEach((line, index) => {
    const priceMinor = prices[index]!;
    const key = JSON.stringify([productLineKey(line), priceMinor, offerKey(line.offer)]);
    const group = groupsByKey.get(key);
    if (group) {
      group.indexes.push(index);
      group.lines.push(line);
    } else {
      groupsByKey.set(key, {
        indexes: [index],
        lines: [line],
        priceMinor,
        canRetainMultiple: true
      });
    }
  });

  const duplicateGroups = [...groupsByKey.values()].filter(
    (group) => group.lines.length > 1 && group.priceMinor > 0
  );
  if (duplicateGroups.length === 0) return [...lines];

  for (const group of duplicateGroups) {
    const first = group.lines[0]!;
    group.canRetainMultiple = group.lines.every(
      (line) =>
        (line.category ?? null) === (first.category ?? null) &&
        (line.note ?? null) === (first.note ?? null)
    );
  }

  const reductionNeeded = originalTotal - ticketTotal;
  if (reductionNeeded <= 0) return [...lines];

  const reconciliation = findUniqueReconciliation(duplicateGroups, reductionNeeded);
  if (!reconciliation) return [...lines];

  const removedIndexes = new Set<number>();
  const mergedLines = new Map<number, T>();
  duplicateGroups.forEach((group, groupIndex) => {
    const removedCount = reconciliation[groupIndex]!;
    if (removedCount === 0) return;

    const retainedCount = group.lines.length - removedCount;
    if (retainedCount === 1) {
      const merged = group.lines
        .slice(1)
        .reduce((result, line) => mergeRepeatedLine(result, line), group.lines[0]!);
      mergedLines.set(group.indexes[0]!, merged);
    }
    group.indexes.slice(retainedCount).forEach((index) => removedIndexes.add(index));
  });

  return lines.flatMap((line, index) => {
    if (removedIndexes.has(index)) return [];
    return [mergedLines.get(index) ?? line];
  });
}

function productLineKey(line: ReceiptLineIdentity): string {
  const name = productKeyOf(line.name);
  const quantity = Number(line.quantity ?? 1);
  const unit = normalizeProductName(line.unit);
  return JSON.stringify([name, Number.isFinite(quantity) ? quantity : 1, unit]);
}

function findUniqueReconciliation<T extends ReceiptLineIdentity>(
  groups: readonly DuplicateGroup<T>[],
  reductionNeeded: number
): number[] | null {
  let states = new Map<number, ReconciliationState>([[0, { solutions: 1, path: null }]]);

  for (const group of groups) {
    const removalOptions = group.canRetainMultiple
      ? Array.from({ length: group.lines.length }, (_, count) => count)
      : [0, group.lines.length - 1];
    const nextStates = new Map<number, ReconciliationState>();

    for (const [currentReduction, state] of states) {
      for (const removedCount of removalOptions) {
        const reduction = currentReduction + removedCount * group.priceMinor;
        if (reduction > reductionNeeded) continue;

        const existing = nextStates.get(reduction);
        if (existing) {
          existing.solutions = Math.min(2, existing.solutions + state.solutions);
        } else {
          nextStates.set(reduction, {
            solutions: state.solutions,
            path: { previous: state.path, removedCount }
          });
          if (nextStates.size > MAX_RECONCILIATION_STATES) return null;
        }
      }
    }
    states = nextStates;
  }

  const result = states.get(reductionNeeded);
  if (!result || result.solutions !== 1) return null;

  const removedCounts = new Array<number>(groups.length);
  let path = result.path;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    removedCounts[index] = path?.removedCount ?? 0;
    path = path?.previous ?? null;
  }
  return removedCounts;
}

function mergeRepeatedLine<T extends ReceiptLineIdentity>(left: T, right: T): T {
  const preferred = lineQuality(right) > lineQuality(left) ? right : left;
  return {
    ...preferred,
    priceMinor: knownNumber(left.priceMinor) ?? knownNumber(right.priceMinor),
    confidence: Math.max(knownNumber(left.confidence) ?? 0, knownNumber(right.confidence) ?? 0),
    note: nonEmpty(left.note) ?? nonEmpty(right.note) ?? null,
    offer: left.offer ?? right.offer ?? null
  } as T;
}

function lineQuality(line: ReceiptLineIdentity): number {
  const presentFields = [line.priceMinor, line.unit, line.category, line.offer, line.note].filter(
    (value) => value !== undefined && value !== null && value !== ''
  ).length;
  return presentFields + (knownNumber(line.confidence) ?? 0);
}

function knownNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function offerKey(value: ReceiptLineIdentity['offer']): string | null {
  if (!value || value.buy == null || value.take == null) return null;
  return JSON.stringify([value.buy, value.take]);
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
