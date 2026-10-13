/** Match the household inventory using the same Unicode/case/spacing key as consumption. */
export function normalizeIngredientMatchKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}
