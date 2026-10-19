/**
 * Conservative ingredient check for explicit allergy/intolerance constraints.
 * It is a guardrail, not a substitute for checking labels or cross-contamination.
 */
const FAMILY_TERMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'dairy',
    [
      'leche',
      'lactosa',
      'lactose',
      'lacteo',
      'lacteos',
      'milk',
      'dairy',
      'nata',
      'queso',
      'yogur',
      'yogurt',
      'mantequilla',
      'cream',
      'butter',
      'caseina',
      'casein',
      'suero de leche',
      'whey'
    ]
  ],
  [
    'egg',
    ['huevo', 'huevos', 'egg', 'eggs', 'albumina', 'clara de huevo', 'yema de huevo', 'ovoproducto']
  ],
  [
    'gluten',
    [
      'gluten',
      'celiaquia',
      'celiaco',
      'trigo',
      'cebada',
      'centeno',
      'espelta',
      'kamut',
      'triticale',
      'avena',
      'wheat',
      'barley',
      'rye',
      'spelt',
      'oats',
      'malt',
      'malta'
    ]
  ],
  ['peanut', ['cacahuete', 'cacahuetes', 'mani', 'peanut', 'peanuts', 'arachis']],
  [
    'tree-nut',
    [
      'fruto seco',
      'frutos secos',
      'almendra',
      'almendras',
      'almond',
      'almonds',
      'nuez',
      'nueces',
      'walnut',
      'walnuts',
      'avellana',
      'avellanas',
      'hazelnut',
      'pistacho',
      'pistachos',
      'pistachio',
      'anacardo',
      'anacardos',
      'cashew',
      'nuez pecana',
      'pecan',
      'macadamia',
      'castana',
      'castanas',
      'pinon',
      'pine nut',
      'nuez de brasil',
      'brazil nut'
    ]
  ],
  [
    'fish',
    [
      'pescado',
      'salmon',
      'atun',
      'merluza',
      'fish',
      'bacalao',
      'sardina',
      'trucha',
      'anchoa',
      'anchoas',
      'tuna',
      'cod',
      'hake',
      'sardine',
      'trout',
      'anchovy'
    ]
  ],
  [
    'shellfish',
    [
      'marisco',
      'crustaceo',
      'crustaceos',
      'crustacean',
      'gamba',
      'gambas',
      'langostino',
      'langostinos',
      'cangrejo',
      'cangrejos',
      'langosta',
      'bogavante',
      'cigala',
      'percebe',
      'shrimp',
      'prawn',
      'crab',
      'lobster',
      'crayfish',
      'shellfish'
    ]
  ],
  [
    'mollusc',
    [
      'marisco',
      'molusco',
      'moluscos',
      'mollusc',
      'molluscs',
      'mollusk',
      'mollusks',
      'pulpo',
      'calamar',
      'sepia',
      'mejillon',
      'almeja',
      'ostra',
      'vieira',
      'octopus',
      'squid',
      'mussel',
      'clam',
      'oyster',
      'scallop'
    ]
  ],
  ['soy', ['soja', 'soya', 'soy', 'soybean', 'soybeans']],
  ['sesame', ['sesamo', 'ajonjoli', 'tahini', 'sesame']],
  ['celery', ['apio', 'apionabo', 'celery', 'celeriac']],
  ['mustard', ['mostaza', 'mustard']],
  [
    'sulphites',
    [
      'sulfito',
      'sulfitos',
      'sulphite',
      'sulphites',
      'sulfite',
      'sulfites',
      'dioxido de azufre',
      'dioxide of sulfur',
      'sulfur dioxide',
      'sulphur dioxide'
    ]
  ],
  ['lupin', ['altramuz', 'altramuces', 'lupino', 'lupinos', 'lupin', 'lupine']]
];

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function familiesFor(value: string): Set<string> {
  const normalized = ` ${normalize(value)} `;
  return new Set(
    FAMILY_TERMS.filter(([, terms]) =>
      terms.some((term) => normalized.includes(` ${normalize(term)} `))
    ).map(([family]) => family)
  );
}

function containsPhrase(ingredient: string, restriction: string): boolean {
  const normalizedIngredient = ` ${normalize(ingredient)} `;
  const normalizedRestriction = normalize(restriction);
  return (
    normalizedRestriction.length > 0 && normalizedIngredient.includes(` ${normalizedRestriction} `)
  );
}

export function findIngredientRestrictionConflicts(
  ingredients: readonly string[],
  restrictions: readonly string[]
): string[] {
  if (ingredients.length === 0 || restrictions.length === 0) return [];
  const restrictedFamilies = new Set(
    restrictions.flatMap((restriction) => [...familiesFor(restriction)])
  );
  return ingredients.filter((ingredient) => {
    if (restrictions.some((restriction) => containsPhrase(ingredient, restriction))) return true;
    const ingredientFamilies = familiesFor(ingredient);
    return [...ingredientFamilies].some((family) => restrictedFamilies.has(family));
  });
}

/** Return strict restrictions that this intentionally partial text matcher cannot verify. */
export function findUnsupportedStrictRestrictions(restrictions: readonly string[]): string[] {
  return restrictions.filter((restriction) => familiesFor(restriction).size === 0);
}

/** Remove obvious identifiers from the only free-text guest field before it reaches a provider. */
export function safeGuestNote(value: string): string {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[dato omitido]')
    .replace(/https?:\/\/\S+/gi, '[dato omitido]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[dato omitido]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 300);
}
