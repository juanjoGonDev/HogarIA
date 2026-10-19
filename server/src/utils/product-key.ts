/**
 * Clave de producto para los precios, mientras el catálogo canónico (P2) no
 * existe: el nombre normalizado. No es una identidad de producto, es la forma
 * honesta de decir «esto es lo mismo que aquello» sin tabla maestra.
 *
 * Reglas: minúsculas, sin acentos (un «Lechuga» y un «lechuga» son la misma
 * línea de la compra), espacios colapsados, puntuación de sobra fuera y
 * unidades abreviadas reconocidas. Cuando llegue `canonical_products`, esta
 * funcion pasa a ser el `alias` que se escribe en `product_aliases`: el clave
 * normalizada ya esta guardada en las observaciones, asi que no hay migracion
 * de datos, solo una columna nueva.
 */
const UNIT_ABBREVIATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:kilogramos?|kilos?|kgs?)\b/g, 'kg'],
  [/\b(?:gramos?|grs?)\b/g, 'g'],
  [/\b(?:litros?|lts?|ls)\b/g, 'l'],
  [/\b(?:mililitros?|mls?)\b/g, 'ml'],
  [/\b(?:unidades?|uds?|pzas?)\b/g, 'ud'],
  [/\b(?:packs?|paquetes?)\b/g, 'pack'],
  [/\b(?:botellas?|botellines?)\b/g, 'botella'],
  [/\b(?:botes?|tarros?|frascos?)\b/g, 'bote']
];

/** Quita lo que sobra al final: marcas, cantidad entre paréntesis, «x2». */
const NOISE = [/\bx\s*\d+\b/g, /\(\d+(?:[.,]\d+)?\s*[a-zç-ž]*\)/g, /[.,;:!?]+/g];

export function normalizeProductName(input: string | null | undefined): string {
  const raw = (input ?? '')
    .normalize('NFD')
    // Los diacríticos se quitan aparte: `normalize('NFD')` los separa en
    // combinaciones U+0300..U+036F, que es lo que borra este regex.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!raw) return '';

  let key = raw;
  for (const pattern of NOISE) key = key.replace(pattern, ' ');
  for (const [pattern, replacement] of UNIT_ABBREVIATIONS) key = key.replace(pattern, ` ${replacement} `);

  // Palabras sueltas de relleno que no aportan nada a la coincidencia. Los
  // modificadores que SI cambian el producto (`sin`, `con`, `eco`, `sin gluten`)
  // se quedan: quitar `sin` juntaba «leche sin lactosa» con «leche con lactosa»,
  // y dos cosas con precios distintos no pueden compartir clave.
  key = key.replace(/\b(?:de|del|la|el|los|las)\b/g, ' ');

  return key.replace(/\s+/g, ' ').trim();
}

/**
 * El lado humano del par clave/nombre: `Leche Semi 1L` y `leche semi` comparten
 * clave, pero cada uno conserva su nombre tal cual se escribio para pintarlo.
 */
export function productKeyOf(name: string | null | undefined): string {
  return normalizeProductName(name);
}
