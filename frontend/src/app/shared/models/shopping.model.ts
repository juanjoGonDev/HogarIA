/**
 * Modelo de la lista de la compra y de los precios.
 *
 * El dinero viaja en centimos (enteros) por contrato con el backend; aqui solo se
 * convierte para pintar y para leer lo que teclea una persona. Las dos funciones de
 * conversion son puras y tienen sus pruebas: un "1,290.50" mal leido es una cesta
 * mal contada, y eso es exactamente el tipo de bug que hace que nadie vuelva a anotar
 * un precio.
 */

import type { TranslationKey } from '../../core/i18n';
import { LIST_EVENT_LABEL_KEYS } from '../../core/i18n/labels';

import { dateLocale } from '../../core/time';

export type ShoppingListStatus = 'active' | 'archived' | 'done';

export interface ShoppingList {
  /** De quien es la lista (nombre y foto), resueltos en la lectura de la bandeja. */
  ownerName?: string | null;
  ownerAvatar?: string | null;
  id: string;
  name: string;
  store: string | null;
  status: ShoppingListStatus;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** Calculados por el server: la pantalla y el dashboard tienen que decir lo mismo. */
  totalItems: number;
  checkedItems: number;
  pricedTotalMinor: number;
  /** El descuento de la lista, y la frase que lo cuenta (el server la escribe). */
  discount?: ListDiscount | null;
  discountDescription?: string | null;
  /** Suministra el server cuando hay casa: la lista puede ser de otra persona. */
  added_by_name?: string | null;
}

export interface ShoppingListItem {
  id: string;
  list_id: string;
  name: string;
  product_key: string;
  quantity: number;
  unit: string | null;
  category: string | null;
  /** Precio POR UNIDAD en centimos; null = sin dato (no es lo mismo que 0). */
  price_minor: number | null;
  note: string | null;
  position: number;
  checked: 0 | 1;
  deleted_at: string | null;
  /** Oferta de linea (3x2 = buy 3 / take 2). `null` = precio normal. */
  promo_buy: number | null;
  promo_take: number | null;
  /**
   * Descuento propio de la linea (§12h), en las cuatro columnas que guarda el server. Van
   * juntas: `disc_kind` sin importe es una fila que se lee «hay descuento» y se calcula «0».
   */
  disc_kind: LineDiscountKind | null;
  disc_value_minor: number | null;
  disc_percent_bps: number | null;
  disc_units: number | null;
  added_by: string | null;
  updated_by: string | null;
  /** Los resuelve el server al leer la lista: un id de usuario no es legible. */
  added_by_name?: string | null;
  updated_by_name?: string | null;
  /** La foto de quien toco la linea por ultima vez; sin foto, `app-avatar` pinta la inicial. */
  added_by_avatar?: string | null;
  updated_by_avatar?: string | null;
}

/**
 * Clave de producto, igual que en el server (`utils/product-key.ts`): acentos fuera,
 * mayusculas fuera, simbolos  espacios, y se compara por esa clave. Se duplica el criterio
 * a proposito en una linea —lo que no se puede duplicar es que la pantalla crea que «Jamón»
 * y «jamon» son dos productos—, y por eso vive aqui y no en cada componente.
 */
export function productKeyOf(name: string | null | undefined): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Descuento de una linea: porcentaje o importe, sobre todas las unidades pagadas o sobre las
 * N primeras. Va en la fila y no en la lista porque el cartel del pasillo habla del producto
 * («segunda unidad a mitad de precio»), y porque en una cesta real conviven dos descuentos
 * distintos. El de la lista sigue siendo el cupón: se reparte entre todas las líneas.
 */
export type LineDiscountKind = 'amount' | 'percent';

export interface LineDiscount {
  kind: LineDiscountKind;
  /** Importe en céntimos que baja la línea (kind 'amount'). */
  valueMinor?: number | null;
  /** Porcentaje en centésimas: 1500 = 15 % (kind 'percent'). */
  percentBps?: number | null;
  /** Primeras N unidades pagadas a las que se aplica; `null` = a todas. */
  units?: number | null;
}

/** Como la oferta: solo existe si es válida. Un «0 %» no es un descuento, es ruido. */
export function lineDiscountOfItem(
  item: Pick<ShoppingListItem, 'disc_kind' | 'disc_value_minor' | 'disc_percent_bps' | 'disc_units'>
): LineDiscount | null {
  if (item.disc_kind !== 'amount' && item.disc_kind !== 'percent') return null;
  return {
    kind: item.disc_kind,
    valueMinor: item.disc_value_minor ?? null,
    percentBps: item.disc_percent_bps ?? null,
    units: item.disc_units ?? null
  };
}

export function describeLineDiscount(
  discount: LineDiscount | null | undefined,
  // Las palabras las pone quien llama, y por el diccionario: un modelo que escribe «unidades» tiene el
  // idioma metido en el sitio equivocado, y aqui no hay forma de preguntar cual es el de la app.
  etiquetas: { unidad: string; unidades: string }
): string | null {
  if (!discount) return null;
  const core =
    discount.kind === 'percent'
      ? `${formatPercentBps(discount.percentBps ?? 0)} %`
      : `${((discount.valueMinor ?? 0) / 100).toLocaleString(dateLocale(), {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} €`;
  const units = Number(discount.units ?? 0);
  const cap =
    units > 0
      ? ` en ${units.toLocaleString(dateLocale(), { maximumFractionDigits: 2 })} ${units === 1 ? etiquetas.unidad : etiquetas.unidades}`
      : '';
  return `${core}${cap}`;
}

function formatPercentBps(bps: number): string {
  return (bps / 100).toLocaleString(dateLocale(), { maximumFractionDigits: 2 });
}

/** Mantiene las mismas unidades enteras y límites que el normalizador del servidor. */
function normalizeLineOffer(buyInput: unknown, takeInput: unknown): LineOffer | null {
  const buy = Math.floor(Number(buyInput ?? 0));
  const take = Math.floor(Number(takeInput ?? 0));
  if (!Number.isFinite(buy) || !Number.isFinite(take) || buy < 2 || take < 1 || take >= buy) {
    return null;
  }
  return { buy, take };
}

/** La oferta como dato de UI; aplica los mismos límites que el servidor. */
export function offerOfItem(
  item: Pick<ShoppingListItem, 'promo_buy' | 'promo_take'>
): LineOffer | null {
  return normalizeLineOffer(item.promo_buy, item.promo_take);
}

export interface EstimateLine {
  itemId: string;
  name: string;
  source: 'manual' | 'observed' | 'unpriced';
  unitMinor?: number;
  /** Lo que cuesta la linea (con su oferta, sin el descuento de la lista): el ticket. */
  lineTotalMinor: number | null;
  /** Lo que se paga de esa linea despues del reparto del descuento. */
  netMinor?: number;
  units?: number;
  paidUnits?: number;
  offerSavingsMinor?: number;
  /** Lo que baja el descuento propio de la línea (antes del cupón de la cesta). */
  lineDiscountMinor?: number;
  /** `clamped` = el cartel prometía más de lo que la línea vale; `fewerUnits` = no da. */
  lineDiscountReason?: 'applied' | 'clamped' | 'fewerUnits' | 'noValue' | 'noUnitPrice';
  lineDiscountDescription?: string | null;
  store?: string | null;
  observedAt?: string;
  /**
   * El precio viene de OTRA tienda. Un numero sin procedencia se cree; uno que dice
   * «esto es lo de Lidl» se acepta o se corrige, y en una casa con dos supermercados la
   * diferencia es el 20 % de la cesta.
   */
  otherStore?: boolean;
  /** Unidades pagadas de la oferta (3x2: llevas 3, pagas 2). */
  offer?: { buy: number; take: number } | null;
}

export interface ListEstimate {
  listId: string;
  currency: string;
  totalMinor: number;
  subtotalMinor?: number;
  offerSavingsMinor?: number;
  discountMinor?: number;
  /** Suma de los descuentos propios de las líneas. */
  lineDiscountMinor?: number;
  pricedLines: number;
  unpriced: string[];
  lines: EstimateLine[];
}

export interface PriceObservation {
  id: string;
  product_name: string;
  product_key: string;
  store_name: string | null;
  price_minor: number;
  quantity: number;
  observed_at: string;
  observations?: number;
}

export interface CreateItemInput {
  name: string;
  quantity?: number;
  unit?: string | null;
  category?: string | null;
  priceMinor?: number | null;
  note?: string | null;
  /** 3x2 = {buy:3, take:2}; `null` la quita. En la fila son promo_buy/promo_take. */
  offer?: LineOffer | null;
  /** Descuento de la línea (§12h); `null` lo quita. */
  discount?: LineDiscount | null;
  /**
   * Enlazar la linea con un producto que la casa ya conoce, porque en la tienda se llama
   * de otra forma. `null` lo desengancha y la clave vuelve a ser la del nombre.
   */
  productKey?: string | null;
}

/** Categorias de la lista, en el orden en que se recorren en la tienda. */
export const LIST_CATEGORIES = [
  'Frutas y verduras',
  'Panaderia',
  'Carne y pescado',
  'Lacteos',
  'Congelados',
  'Despensa',
  'Bebidas',
  'Limpieza e higiene',
  'Otros'
] as const;

/**
 * Agrupa por seccion de tienda, con `Otros` siempre al final: lo que no tiene
 * seccion no debe colarse en medio del recorrido. Dentro de la seccion se
 * respeta el orden manual (`position`), que es lo que sostiene el arrastrar.
 */
export function groupItemsByCategory(
  items: ShoppingListItem[],
  options: { frozenLast?: boolean } = {}
): { category: string; items: ShoppingListItem[] }[] {
  const buckets = new Map<string, ShoppingListItem[]>();
  for (const item of items) {
    const category = item.category && item.category.trim() ? item.category : 'Otros';
    const bucket = buckets.get(category);
    if (bucket) bucket.push(item);
    else buckets.set(category, [item]);
  }

  const order = (category: string): number => {
    const index = (LIST_CATEGORIES as readonly string[]).indexOf(category);
    return index === -1 || category === 'Otros' ? LIST_CATEGORIES.length : index;
  };

  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (options.frozenLast) {
        const frozenDifference = Number(isFrozenCategory(a)) - Number(isFrozenCategory(b));
        if (frozenDifference) return frozenDifference;
      }
      return order(a) - order(b) || a.localeCompare(b, 'es');
    })
    .map(([category, groupItems]) => ({ category, items: groupItems }));
}

export interface ShoppingViewOrder {
  weightFirst: boolean;
  frozenLast: boolean;
}

/** Reorders a display-only copy; `position` and server order are never mutated. */
export function orderShoppingItems(
  items: ShoppingListItem[],
  options: ShoppingViewOrder
): ShoppingListItem[] {
  return items
    .map((item, index) => ({ item, index, grams: weightInGrams(item) }))
    .sort((left, right) => {
      if (options.frozenLast) {
        const frozenDifference =
          Number(isFrozenCategory(left.item.category)) -
          Number(isFrozenCategory(right.item.category));
        if (frozenDifference) return frozenDifference;
      }
      if (options.weightFirst) {
        if (left.grams !== null && right.grams === null) return -1;
        if (left.grams === null && right.grams !== null) return 1;
        if (left.grams !== null && right.grams !== null && left.grams !== right.grams) {
          return right.grams - left.grams;
        }
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function isFrozenCategory(category: string | null | undefined): boolean {
  const normalized = String(category ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es');
  return normalized === 'congelados';
}

/** Only explicit mass units are comparable. Volume, pieces and unknown units stay together. */
function weightInGrams(item: Pick<ShoppingListItem, 'quantity' | 'unit'>): number | null {
  const quantity = Number(item.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) return null;
  const unit = String(item.unit ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('es')
    .replace(/[.\s]/g, '');
  const factors: Record<string, number> = {
    mg: 0.001,
    miligramo: 0.001,
    miligramos: 0.001,
    g: 1,
    gr: 1,
    gramo: 1,
    gramos: 1,
    kg: 1000,
    kilo: 1000,
    kilos: 1000,
    kilogramo: 1000,
    kilogramos: 1000
  };
  const factor = factors[unit];
  return factor === undefined ? null : quantity * factor;
}

/** `85 -> "0,85 €"`, `null -> "—"` (la raya dice «sin dato», el 0 diria «gratis»). */
export function formatMoney(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  const euros = (minor < 0 ? -minor : minor) / 100;
  const text = euros.toLocaleString(dateLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${minor < 0 ? '-' : ''}${text} €`;
}

/**
 * `12,40 €` leido a mano -> `1240`. Null si no es un importe utilizable.
 *
 * Las reglas son las de un teclado espanol, no las de `Number.parseFloat`:
 *  - la coma es SIEMPRE el separador decimal ("1,20" -> 120, "1.290,50" -> 129050);
 *  - sin coma, un punto con 3 digitos detras son miles ("1.290" -> 1290 €), y con
 *    1-2 digitos es decimal ("1.5" -> 1,50, "1.20" -> 1,20);
 *  - "0" es un precio legitimo (gratis), el vacio no: es null, que es lo que pinta
 *    la raya en lugar de un 0 que se sumaria como si fuera real.
 * Y por arriba, 100.000 € por unidad es un dedo resbalado, no un precio.
 */
export function parseMoneyToMinor(input: string | null | undefined): number | null {
  const original = (input ?? '').replace(/\s/g, '').replace(/€|eur\b/gi, '');
  if (!original) return null;

  const usesComma = original.includes(',');
  if (!/^[\d.,]+$/.test(original)) return null;

  let digits = '';
  let decimals = '';

  if (usesComma) {
    // Con coma: la coma manda como decimal y los puntos son separadores de miles.
    const cleaned = original.replace(/\./g, '');
    const parts = cleaned.split(',');
    if (parts.length > 2) return null;
    digits = parts[0] || '0';
    decimals = (parts[1] ?? '').slice(0, 3);
  } else {
    const lastDot = original.lastIndexOf('.');
    if (lastDot === -1) {
      digits = original;
    } else {
      const head = original.slice(0, lastDot);
      const tail = original.slice(lastDot + 1);
      if (tail.length === 3 && /^\d{3}$/.test(tail)) {
        // "1.290" y "1.234.567": el punto separa miles, no decimales.
        digits = original.replace(/\./g, '');
      } else if (tail.length <= 2) {
        digits = head.replace(/\./g, '') || '0';
        decimals = tail;
      } else {
        return null;
      }
    }
  }

  if (!/^\d*$/.test(digits)) return null;
  if (decimals && !/^\d{1,3}$/.test(decimals)) return null;

  // Tres decimales redondean ("3,999" -> 4,00) en lugar de truncar: un presupuesto
  // que pierde un centimo por linea no es un presupuesto, es una costumbre.
  const minor = Math.round(Number(`${digits || '0'}.${decimals || '0'}`) * 100);
  if (!Number.isFinite(minor) || minor > 10_000_000) return null;
  return minor;
}

/** `2` + `"kg"` -> `"2 kg"`, `1` + `null` -> `""` (una unidad suelta no se pinta). */
export function formatQuantity(quantity: number, unit: string | null | undefined): string {
  const amount = Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toLocaleString(dateLocale(), { maximumFractionDigits: 2 });
  if (!unit) return quantity === 1 ? '' : `${amount}×`;
  return `${amount} ${unit}`;
}

// ---------------------------------------------------------------------------
// Lo que anadio la ronda 8f (secciones, auditoria, descuentos, foto, bandeja)
// ---------------------------------------------------------------------------

export interface ShoppingCategory {
  id: string;
  name: string;
  /** El color es DATO y no CSS: la IA lo elige al proponer una seccion nueva. */
  color: string;
  position: number;
  key: string;
}

/**
 * Las acciones que escribe la auditoria del server: `server/src/utils/shopping-events.ts`, `EVENT_ACTIONS`, palabra
 * por palabra y sin inventar ninguna (HOGARIA-SPEC ## 12w). Antes este tipo describia acciones que el server no
 * manda (`items.add`, `list.rename`, `list.clear_checked`…): nueve de diecinueve. Nadie las usaba mal porque nadie
 * las podia usar, y eso es lo que hace que un tipo asi sea un bug silencioso —el espejo del server lo impide.
 */
export type ListEventAction =
  | 'list.create'
  | 'list.update'
  | 'list.complete'
  | 'list.reopen'
  | 'list.delete'
  | 'list.discount'
  | 'list.discount-remove'
  | 'list.clear-checked'
  | 'list.order'
  | 'item.add'
  | 'item.merge'
  | 'item.update'
  | 'item.discount'
  | 'item.offer'
  | 'item.check'
  | 'item.uncheck'
  | 'item.remove'
  | 'item.restore'
  | 'items.bulk'
  | 'items.apply';

/** Lo que escribio la auditoria del server: `description` es la frase en castellano, la reserva de siempre. */
export interface ListEvent {
  id: string;
  list_id: string;
  user_id: string;
  user_name: string | null;
  user_avatar?: string | null;
  action: ListEventAction;
  item_name: string | null;
  created_at: string;
  description: string;
}

/**
 * La voz con la que se compone una frase del historial. `t` es el traductor de la pantalla, que es el unico que
 * sabe en que idioma se esta leyendo; `item`, opcional, traduce el nombre del articulo por su etiqueta de
 * catalogo (el articulo es dato del semillero, no texto de la app: ## 12w). Sin voz, la fila se pinta como la
 * escribe el server.
 */
export interface AuditVoice {
  t: (key: TranslationKey, params?: Record<string, string>) => string;
  item?: (name: string) => string;
}

/** La frase de una fila del historial, en el idioma activo. */
export function listEventText(
  // `action` es `string` a proposito: la busqueda sobre el mapa tipado no puede prometer que la accion que
  // mando el server exista en el diccionario del cliente —si no existe, abajo se ve la frase del server.
  event: Pick<ListEvent, 'item_name' | 'description'> & { action: string },
  who: string,
  voz: AuditVoice
): string {
  const key = (LIST_EVENT_LABEL_KEYS as Partial<Record<string, TranslationKey>>)[event.action];
  if (!key) {
    // Accion que el diccionario todavia no cubre: mejor la frase del server que un codigo en pantalla.
    const reserva = (event.description ?? '').trim();
    return reserva || voz.t('list_event.lista_tocada', { who, item: '' });
  }
  // Las comias las escribe cada idioma (el castellano las lleva, el ingles no); aqui solo se quita el grupo
  // cuando la accion promete un articulo que la fila no tiene, que es lo que hoy hace el server al omitir `item`.
  const nombre = event.item_name ? (voz.item ? voz.item(event.item_name) : event.item_name) : '';
  return voz
    .t(key, { who, item: nombre })
    .replace(/«\s*»/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * La cara de una fila del historial, resuelta contra la sesion viva.
 *
 * El servidor manda ya el nombre y la foto de hoy (la instantanea de la fila es la reserva para cuando la cuenta
 * no existe), pero entre que se sube una foto o se cambia el nombre y se vuelve a pedir la lista pueden pasar
 * minutos de uso —y el aviso dice «foto actualizada», que se tiene que notar en la pantalla y no en la proxima
 * visita. Por eso las filas PROPIAS se pintan con lo que hay en la senal de sesion; las de las demas personas se
 * dejan tal cual las contesto el servidor. La frase, en cambio, siempre la compone el cliente: recortar la del
 * server para cambiarle el sujeto era un apaño que dejaba el verbo en el otro idioma.
 */
export function auditFace(
  event: Pick<ListEvent, 'user_id' | 'user_name' | 'user_avatar' | 'description' | 'item_name'> & {
    action: string;
  },
  me: { id: string; name: string; avatar?: string | null } | null,
  voz?: AuditVoice
): { name: string; avatar?: string; text: string } {
  const guardado = event.user_name?.trim() ?? '';
  const mine = Boolean(me?.id) && me?.id === event.user_id;
  const nombre =
    (mine ? me?.name?.trim() || guardado : guardado) ||
    (voz ? voz.t('list_event.alguien') : 'Alguien');
  const avatar = (mine ? (me?.avatar ?? event.user_avatar) : event.user_avatar) ?? undefined;
  const text = voz ? listEventText(event, nombre, voz) : (event.description ?? '').trim();
  return { name: nombre, avatar, text };
}

export type DiscountKind = 'amount' | 'percent';
export type DiscountScope = 'all' | 'firstUnits' | 'product' | 'category';

export interface ListDiscount {
  kind: DiscountKind;
  valueMinor: number | null;
  percentBps: number | null;
  scope: DiscountScope;
  firstUnits: number | null;
  /** Que producto o seccion entra con `scope: 'product' | 'category'`. */
  target?: string | null;
  /** Las demas dianas del mismo cartel: «2,50 € en jamon, queso y pan» es UN descuento. */
  targets?: string[] | null;
  label: string | null;
  /** La frase que pinta la fila de totales: el server la escribe, la app no la reconstruye. */
  description?: string | null;
}

export interface DiscountInput {
  kind: DiscountKind;
  valueMinor?: number | null;
  percentBps?: number | null;
  scope?: DiscountScope;
  firstUnits?: number | null;
  /** Obligatorio cuando `scope` promete un producto o una seccion: sin diana no hay descuento. */
  target?: string | null;
  /** Se mandan los nombres legibles de las lineas elegidas; el server normaliza al comparar. */
  targets?: string[] | null;
  label?: string | null;
}

export interface SavedDiscountDraft {
  kind: DiscountKind;
  scope: DiscountScope;
  firstUnits: number | null;
  targets: string[];
  label: string | null;
  amount: string;
  percent: string | null;
}

/** El API devuelve el modelo de dominio camelCase; transforma ese DTO para la hoja de edición. */
export function discountDraftFromSaved(
  discount: ListDiscount | null | undefined
): SavedDiscountDraft {
  const scoped = discount?.scope === 'product' || discount?.scope === 'category';
  const targets = scoped
    ? [
        ...new Set(
          [...(discount?.targets ?? []), discount?.target ?? null].filter(
            (value): value is string => !!value
          )
        )
      ]
    : [];

  return {
    kind: discount?.kind ?? 'amount',
    scope: discount?.scope ?? 'all',
    firstUnits: discount?.firstUnits ?? null,
    targets,
    label: discount?.label ?? null,
    amount: discount?.valueMinor ? (discount.valueMinor / 100).toFixed(2).replace('.', ',') : '',
    percent: discount?.percentBps ? String(discount.percentBps / 100) : null
  };
}

/** Conserva el contrato camelCase de escritura al ofrecer deshacer un borrado. */
export function discountInputFromSaved(discount: ListDiscount): DiscountInput {
  return {
    kind: discount.kind,
    valueMinor: discount.valueMinor,
    percentBps: discount.percentBps,
    scope: discount.scope,
    firstUnits: discount.firstUnits,
    target: discount.target,
    targets: discount.targets,
    label: discount.label
  };
}

/** Lo que se escribe al cerrar la compra, linea a linea. */
export interface CompletePriceInput {
  itemId: string;
  /** Precio POR UNIDAD, la alternativa a decir cuanto se pago en total. */
  priceMinor?: number | null;
  /** Lo que decia el ticket. La app divide por lo que llevabas; no al reves. */
  totalPaidMinor?: number | null;
  /** Unidades que se llevaron (por defecto, las pagadas de la linea). */
  quantity?: number | null;
  store?: string | null;
  /** Como se llamaba el producto en esa tienda. */
  productName?: string | null;
}

export interface CompletePurchaseInput {
  store?: string | null;
  prices?: CompletePriceInput[];
}

export interface CompleteReceipt {
  pricesRecorded: number;
  items: number;
  paidMinor: number;
  store: string | null;
  /** Fichas creadas o repuestas en la despensa al cerrar (## 12ag). */
  pantryMoved: number;
  /** Sumas sobre fichas que ya tenian stock; son las mismas, con mas cantidad. */
  pantryMerged: number;
}

/** La linea que impide cerrar la compra, en la forma que necesita la hoja de precios. */
export interface MissingPriceLine {
  itemId: string;
  name: string;
  quantity: number;
  unit: string | null;
}

/**
 * Cerrar la compra puede no poder cerrarse, y eso no es un error de red: es un
 * formulario. Por eso `complete` devuelve un resultado en vez de prometer y fallar.
 */
export type CompleteResult =
  | ({ ok: true } & CompleteReceipt)
  | { ok: false; code: 'PRICES_MISSING'; missing: MissingPriceLine[] }
  | { ok: false; code: 'STORE_REQUIRED' }
  | { ok: false; code: 'STALE_LIST' }
  | { ok: false; code: 'ERROR' };

/** Cuanto cuesta el mismo producto en cada tienda. */
export interface ProductVariant {
  store: string | null;
  productName: string;
  unitMinor: number;
  observedAt: string;
}

export interface KnownProduct {
  productKey: string;
  name: string;
  lastObservedAt: string;
  observations: number;
  variants: ProductVariant[];
}

/** Oferta de linea (3x2, 2x1): se pagan `buy - take` unidades de cada `buy`. */
export interface LineOffer {
  buy: number;
  take: number;
}

/**
 * Las ofertas redondas. `label` es el nombre del truco (3x2), no texto de interfaz: se guarda, se busca y se
 * lee igual en los dos idiomas. La pista si que es una frase, y por eso viaja como clave del diccionario —el
 * mismo arreglo que `home-profile.ts` con `hintKey`: un tipo importado, no una dependencia (HOGARIA-SPEC ## 12u).
 */
export const OFFER_PRESETS: {
  label: string;
  buy: number;
  take: number;
  hintKey: TranslationKey;
}[] = [
  { label: '3x2', buy: 3, take: 2, hintKey: 'shopping_list_detail.oferta_pista_3x2' },
  { label: '2x1', buy: 2, take: 1, hintKey: 'shopping_list_detail.oferta_pista_2x1' },
  { label: '4x3', buy: 4, take: 3, hintKey: 'shopping_list_detail.oferta_pista_4x3' },
  { label: '5x4', buy: 5, take: 4, hintKey: 'shopping_list_detail.oferta_pista_5x4' }
];

export function describeOffer(offer: LineOffer | null | undefined): string | null {
  if (!offer) return null;
  const normalized = normalizeLineOffer(offer.buy, offer.take);
  if (!normalized) return null;
  return `${normalized.buy}x${normalized.take}`;
}

export interface PhotoLine {
  name: string;
  quantity: number;
  unit?: string | null;
  category?: string | null;
  /** Pedir seccion nueva es normal: la IA ve un pasillo que el catalogo no tiene. */
  createCategory?: boolean;
  priceMinor?: number | null;
  offer?: LineOffer | null;
  confidence?: number;
  note?: string | null;
}

export interface PhotoAnalysis {
  listId: string;
  mode: 'auto' | 'ticket' | 'shelf';
  currency: string;
  warnings: string[];
  lines: PhotoLine[];
  categories: { name: string; color: string }[];
}

export type PhotoOutcome =
  | { ok: true; data: PhotoAnalysis }
  | { ok: false; status: number; message: string; data: Record<string, unknown> };

export type ListsSort = 'updated' | 'name' | 'total' | 'lines';

export interface ListsQuery {
  /** `all` es solo del filtro de la bandeja; el server lo entiende como "sin estado". */
  status?: ShoppingListStatus | 'all';
  q?: string;
  store?: string | null;
  minTotalMinor?: number | null;
  from?: string | null;
  to?: string | null;
  sort?: ListsSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ListsMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface StoreCount {
  store: string;
  lists: number;
}

// ═══════════════════════════════════════════════════════════════════
// La lista sugerida por la actividad (HOGARIA-SPEC ## 12al)
// ═══════════════════════════════════════════════════════════════════

/** Por que se sugiere: cada motivo es una regla del motor estadistico del server. */
export type MotivoDeSugerencia = 'caduca' | 'sin_stock' | 'se_acaba' | 'para_el_plan';

export interface SugerenciaRow {
  name: string;
  unit: string | null;
  category: string | null;
  quantity: number;
  motivo: MotivoDeSugerencia;
  daysLeft: number | null;
  cadaDias: number | null;
  /** La tienda mas barata que la casa conoce, por su ultimo precio. */
  mejorTienda: string | null;
  precioUnitarioMinor: number | null;
  precioEstimadoMinor: number | null;
}

/** La lista sugerida abierta, si la hay: actualizarla no es duplicarla. */
export interface SugeridaActiva {
  id: string;
  name: string;
  version: number;
  itemsPendientes: number;
}

export interface SugerenciaDeCompra {
  sugerencias: SugerenciaRow[];
  lista: SugeridaActiva | null;
}
