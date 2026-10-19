import { canonicalUnit, isKnownUnit } from './unit-families';

export type QuickAddLine = {
  name: string;
  quantity: number;
  unit: string | null;
};

/** Parses `1kg Tomates` or `2 Leche` without mistaking a short product name for a unit. */
export function parseQuickAddLine(raw: string): QuickAddLine {
  const cleaned = raw
    .trim()
    .replace(/^[-•*]\s*/, '')
    .trim();
  const match = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(cleaned);
  if (!match || !match[2].trim()) return { name: cleaned, quantity: 1, unit: null };

  const [, rawQuantity, remainder] = match;
  const quantity = Number.parseFloat(rawQuantity.replace(',', '.')) || 1;
  const words = remainder.trim().split(/\s+/);

  // A bare quantity + unit is not a product row; keep it as entered, like the old parser did.
  if (words.length === 1 && isKnownUnit(words[0])) {
    return { name: cleaned, quantity: 1, unit: null };
  }

  // Match the longest recognized unit prefix; unknown short words stay part of the product name.
  for (let unitWordCount = words.length - 1; unitWordCount > 0; unitWordCount -= 1) {
    const typedUnit = words.slice(0, unitWordCount).join(' ');
    if (!isKnownUnit(typedUnit)) continue;

    return {
      name: words.slice(unitWordCount).join(' '),
      quantity,
      unit: canonicalUnit(typedUnit)
    };
  }

  return { name: remainder.trim(), quantity, unit: null };
}
