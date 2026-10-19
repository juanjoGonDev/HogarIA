/**
 * Las familias de unidad y como se canoniza lo que alguien teclea. Fichero aparte a proposito:
 * es logica sin Angular, y la necesitan a la vez el selector, la fila de la lista y el pegado de
 * texto. Dos criterios de «esto es un kg» son dos unidades distintas guardadas para el mismo
 * bote, y entonces el precio por unidad deja de ser comparable entre semanas.
 */
import type { IconName } from '../../shared/components/ui/icon/icon-paths';
import type { TranslationKey } from '../../core/i18n';

export type UnitFamily = {
  id: string;
  /** Como se ensena la familia: clave del diccionario, no frase. Ver HOGARIA-SPEC ## 12u. */
  labelKey: TranslationKey;
  icon: IconName;
  /** La que se pone al elegir la familia sin afinar. */
  defaultUnit: string;
  units: readonly string[];
};

export const UNIT_FAMILIES: readonly UnitFamily[] = [
  { id: 'weight', labelKey: 'shopping_list_detail.familia_peso', icon: 'scale', defaultUnit: 'kg', units: ['kg', 'g', '500 g', '250 g', 'lb'] },
  { id: 'volume', labelKey: 'shopping_list_detail.familia_volumen', icon: 'local_drink', defaultUnit: 'L', units: ['L', 'ml', '1,5 L', '750 ml'] },
  { id: 'count', labelKey: 'shopping_list_detail.familia_unidades', icon: 'numbers', defaultUnit: 'ud', units: ['ud', 'pieza', 'docena', 'manojo'] },
  {
    id: 'package',
    labelKey: 'shopping_list_detail.familia_envase',
    icon: 'inventory_2',
    defaultUnit: 'bote',
    units: ['bote', 'lata', 'botella', 'brick', 'pack', 'caja', 'bolsa', 'bandeja', 'barra', 'paquete']
  },
  {
    id: 'kitchen',
    labelKey: 'shopping_list_detail.familia_medida_de_cocina',
    icon: 'kitchen',
    defaultUnit: 'cucharada',
    units: ['cucharada', 'cucharadita', 'taza', 'pizca', 'vaso']
  }
];

/** Como se llama cada familia cuando hay que nombrarla en una frase. */
export function familyOf(unit: string | null | undefined): UnitFamily | null {
  if (!unit) return null;
  const needle = canonicalUnit(unit);
  for (const family of UNIT_FAMILIES) {
    if (family.units.some((entry) => entry.toLowerCase() === String(needle).toLowerCase())) return family;
  }
  return null;
}

const ALIASES: Record<string, string> = {
  kilos: 'kg',
  kilo: 'kg',
  kgs: 'kg',
  'k g': 'kg',
  gramos: 'g',
  gramo: 'g',
  gs: 'g',
  litros: 'L',
  litro: 'L',
  litrona: 'L',
  l: 'L',
  mililitros: 'ml',
  mililitro: 'ml',
  mls: 'ml',
  unidades: 'ud',
  unidad: 'ud',
  uds: 'ud',
  ud_: 'ud',
  pieza: 'ud',
  botes: 'bote',
  latas: 'lata',
  botellas: 'botella',
  packs: 'pack',
  cajas: 'caja',
  barras: 'barra',
  cucharadas: 'cucharada',
  cucharaditas: 'cucharadita',
  tazas: 'taza'
};

/**
 * Lo que alguien teclea a su forma de escribir, a la cadena que se guarda. Solo toca lo que
 * reconoce: `bote de 400 g` se devuelve intacto, porque no hay nada que corregir ahi y si lo
 * reescribieramos perderiamos el dato que interesa (los 400 g).
 */
export function canonicalUnit(value: string | null | undefined): string | null {
  const text = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/, '');
  if (!text) return null;
  const lower = text.toLowerCase();
  if (ALIASES[lower]) return ALIASES[lower];
  for (const family of UNIT_FAMILIES) {
    for (const unit of family.units) {
      if (unit.toLowerCase() === lower) return unit;
    }
  }
  // El plural suelto de algo que si esta en la lista («kgs», «botellas») ya lo cazan los
  // alias; esto es para el resto: «Kg» y «KG» acaban siendo «kg».
  const match = UNIT_FAMILIES.flatMap((family) => [...family.units]).find((unit) => unit.toLowerCase() === lower);
  return match ?? text;
}

/**
 * Si la cadena es una unidad de las que se reconocen. Lo necesita el pegado de texto:
 * «2 kg Tomates» tiene unidad, «2 Tomates» no, y adivinarlo por la longitud de la palabra es
 * lo que hacia aparecer «Tomates» como unidad de 2 Kilogramos.
 */
export function isKnownUnit(value: string | null | undefined): boolean {
  const canonical = canonicalUnit(value);
  if (!canonical) return false;
  return UNIT_FAMILIES.some((family) => family.units.some((unit) => unit.toLowerCase() === canonical.toLowerCase()));
}

/**
 * Lo que se puede elegir: las unidades, con el titulo de su familia. La familia no es una
 * opcion —es una etiqueta—, y por eso aqui no hay filas duplicadas ni un `value` que valga
 * dos cosas: `kg` aparece una vez y el disparador siempre dice la unidad que hay dentro.
 */
/**
 * Lo que se puede elegir. `groupKey`, y no el titulo ya escrito: este modulo es logica sin Angular y no ve el
 * idioma; quien arma las opciones del picker (`unit-picker.component.ts`) lo resuelve con el diccionario.
 */
export function unitPickerOptions(): { value: string; label: string; groupKey: TranslationKey }[] {
  const out: { value: string; label: string; groupKey: TranslationKey }[] = [];
  for (const family of UNIT_FAMILIES) {
    for (const unit of family.units) {
      out.push({ value: unit, label: unit, groupKey: family.labelKey });
    }
  }
  return out;
}
