import { z } from 'zod';
import { productKeyOf } from './product-key.js';
import { activeHouseholdId } from './household-context.js';

/**
 * Las caducidades de la casa (HOGARIA-SPEC ## 12ak): cuanto dura cada producto y cuando toca
 * comerselo.
 *
 * Tres fuentes de verdad, por orden: la FECHA que la persona registro; los DIAS que la IA
 * estimo para ese producto concreto (`ingredients.estimated_shelf_days`); y el catalogo de
 * bolsillo de abajo, que sabe lo que dura un pan de barra sin preguntarle a nadie —asi la
 * pantalla funciona aunque la IA local siga sin configurar—. Y aparte, el RITMO: con el
 * historial de compras (`price_observations`, que ya llega del cierre de lista y de los
 * tickets) se calcula cada cuanto se repone y cuanto dura el stock actual. Nada de esto se
 * guarda: se calcula al pedirlo, que es lo que hace que sea «en tiempo real».
 */

type SqlDb = import('better-sqlite3').Database;

/**
 * Vida util tipica (dias, en su sitio normal: nevera o armario) para lo que sale en casi
 * cualquier ticket espanol. No es ciencia: es el punto de partida cuando la casa no ha
 * registrado fecha y la IA no ha dicho nada —mejor un «pan, ~4 dias» aproximado que nada—.
 */
const CATALOGO_CRUDO: Readonly<Record<string, number>> = {
  'pan de barra': 4,
  'pan de molde': 6,
  pan: 4,
  leche: 7,
  'leche entera': 7,
  'leche semidesnatada': 7,
  'leche desnatada': 7,
  'leche uht': 90,
  huevos: 28,
  yogur: 21,
  'yogur griego': 21,
  'yogur natural': 21,
  'queso fresco': 14,
  'queso rallado': 30,
  'queso en lonchas': 14,
  queso: 60,
  mantequilla: 60,
  tomate: 7,
  'tomate cherry': 7,
  lechuga: 5,
  espinacas: 5,
  platano: 4,
  manzana: 21,
  naranja: 21,
  fresas: 3,
  uvas: 7,
  sandia: 5,
  melon: 5,
  aguacate: 4,
  pimiento: 7,
  calabacin: 7,
  pepino: 7,
  cebolla: 30,
  patata: 30,
  zanahoria: 21,
  ajo: 30,
  pollo: 2,
  'pollo crudo': 2,
  pavo: 3,
  'carne picada': 2,
  ternera: 3,
  cerdo: 3,
  chorizo: 60,
  jamon: 30,
  'jamon cocido': 5,
  'jamon serrano': 180,
  salchichas: 10,
  pescado: 2,
  merluza: 2,
  salmon: 2,
  atun: 365,
  gambas: 2,
  tofu: 5,
  arroz: 365,
  pasta: 365,
  'pasta integral': 365,
  macarrones: 365,
  espaguetis: 365,
  lentejas: 365,
  garbanzos: 365,
  alubias: 365,
  harina: 180,
  azucar: 365,
  sal: 365,
  aceite: 365,
  'aceite de oliva': 365,
  vinagre: 365,
  cafe: 180,
  cereales: 180,
  galletas: 90,
  chocolate: 180,
  miel: 730,
  mermelada: 180,
  mayonesa: 90,
  ketchup: 180,
  mostaza: 180
};

/**
 * El catalogo se indexa por la clave normalizada (`productKeyOf`), no por el nombre como se
 * escribe: «Pan de barra» y «pan barra» son la misma clave para el resto de la casa (precios,
 * tickets), y el catalogo no puede ser la excepcion. Se normaliza una vez, al cargar.
 */
export const CATALOGO_DE_VIDA: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(CATALOGO_CRUDO).map(([nombre, dias]) => [productKeyOf(nombre), dias])
);

export type OrigenDeVida = 'fecha' | 'ia' | 'catalogo';

/** Una compra del historial: el DIA (las observaciones del mismo dia son una sola compra). */
export interface Compra {
  dia: string;
  cantidad: number;
}

/** El ritmo que se deduce de dos o mas compras en dias distintos. */
export interface RitmoDeCompra {
  /** Se repone cada ~N dias. */
  cadaDias: number;
  unidadesPorCompra: number;
  /** Dias que dura UNA unidad al ritmo de la casa. */
  diasPorUnidad: number;
}

/** La fila que ve la pantalla de caducidades. */
export interface CaducidadRow {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string | null;
  /** 'YYYY-MM-DD' registrado por la casa. */
  expirationDate: string | null;
  /** Dias de vida utiles cuando no hay fecha (IA o catalogo). */
  estimatedDays: number | null;
  shelfSource: OrigenDeVida | null;
  /** La fecha que sea (registrada o estimada), en ISO de dia. */
  vence: string | null;
  /** Dias hasta caducar; negativo = ya caducado; null = no se sabe. */
  daysLeft: number | null;
  cadaDias: number | null;
  unidadesPorCompra: number | null;
  /** El stock actual, a este ritmo, dura ~N dias. */
  duraDias: number | null;
  lastBought: string | null;
}

const DIA = 86400000;

/** 'YYYY-MM-DD' de lo que devuelva SQLite ('YYYY-MM-DD HH:MM:SS' o dia suelto). */
function diaDe(valor: unknown): string | null {
  const texto = String(valor ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : null;
}

/** Hoy en dia suelto, en el mismo reloj que los sellos del server (UTC). */
export function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dias de `desde` a `hasta` (positivo si falta). Ambos 'YYYY-MM-DD'. */
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / DIA);
}

function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA).toISOString().slice(0, 10);
}

/** La casa de un usuario (su household, si comparte despensa). */
function casaDe(
  db: SqlDb,
  userId: string
): {
  userId: string;
  householdId: string | null;
  clause: string;
  params: unknown[];
} {
  const householdId = activeHouseholdId(db, userId);
  if (!householdId) {
    return {
      userId,
      householdId: null,
      clause: '(household_id IS NULL AND user_id = ?)',
      params: [userId]
    };
  }
  const household = db
    .prepare('SELECT shared_pantry FROM households WHERE id = ?')
    .get(householdId) as { shared_pantry: number } | undefined;
  return household?.shared_pantry
    ? {
        userId,
        householdId,
        clause: '(household_id = ? OR (household_id IS NULL AND user_id = ?))',
        params: [householdId, userId]
      }
    : {
        userId,
        householdId,
        clause: '((household_id = ? AND user_id = ?) OR (household_id IS NULL AND user_id = ?))',
        params: [householdId, userId, userId]
      };
}

/**
 * Todo el historial de compras de la casa, agrupado por clave de producto y con las
 * observaciones del mismo dia fundidas en UNA compra —el cierre de una lista y el ticket del
 * mismo dia son la misma compra, y contarla doble doblaria el ritmo—.
 */
export function comprasDeLaCasa(db: SqlDb, userId: string): Map<string, Compra[]> {
  const casa = casaDe(db, userId);
  const filas = db
    .prepare(
      `SELECT product_key, substr(observed_at, 1, 10) AS dia, SUM(quantity) AS cantidad
       FROM price_observations
       WHERE ${casa.clause}
       GROUP BY product_key, dia
       ORDER BY dia ASC`
    )
    .all(...casa.params) as { product_key: string; dia: string; cantidad: number }[];
  const porClave = new Map<string, Compra[]>();
  for (const fila of filas) {
    const lista = porClave.get(fila.product_key) ?? [];
    lista.push({ dia: fila.dia, cantidad: Number(fila.cantidad) || 1 });
    porClave.set(fila.product_key, lista);
  }
  return porClave;
}

/** El ritmo de una lista de compras: hace falta mas de un dia distinto. */
export function ritmoDe(compras: Compra[]): RitmoDeCompra | null {
  if (compras.length < 2) return null;
  const primero = compras[0].dia;
  const ultimo = compras[compras.length - 1].dia;
  const tramo = diasEntre(primero, ultimo);
  if (tramo <= 0) return null;
  const total = compras.reduce((suma, compra) => suma + compra.cantidad, 0);
  const cadaDias = tramo / (compras.length - 1);
  const unidadesPorCompra = total / compras.length;
  if (unidadesPorCompra <= 0) return null;
  return {
    cadaDias: Math.round(cadaDias * 10) / 10,
    unidadesPorCompra: Math.round(unidadesPorCompra * 10) / 10,
    diasPorUnidad: cadaDias / unidadesPorCompra
  };
}

/** Que vida le toca a una fila de la despensa: la fecha manda, luego la IA, luego el catalogo. */
export function vidaDe(fila: {
  name: string;
  expiration_date: string | null;
  estimated_shelf_days: number | null;
}): { source: OrigenDeVida | null; dias: number | null } {
  if (diaDe(fila.expiration_date)) return { source: 'fecha', dias: null };
  if (Number.isFinite(Number(fila.estimated_shelf_days)) && Number(fila.estimated_shelf_days) > 0) {
    return { source: 'ia', dias: Math.trunc(Number(fila.estimated_shelf_days)) };
  }
  const delCatalogo = CATALOGO_DE_VIDA[productKeyOf(fila.name)];
  if (delCatalogo) return { source: 'catalogo', dias: delCatalogo };
  return { source: null, dias: null };
}

/**
 * La lista entera, lista para pintar: stock en casa, cada fila con su fecha (real o estimada),
 * los dias que le quedan y su ritmo. Ordenada por urgencia —lo que caduca primero, arriba—.
 */
export function caducidadesDe(db: SqlDb, userId: string): CaducidadRow[] {
  const casa = casaDe(db, userId);
  const filas = db
    .prepare(
      `SELECT id, name, category, quantity, unit, expiration_date, estimated_shelf_days, created_at
       FROM ingredients
       WHERE ${casa.clause} AND quantity > 0
       ORDER BY name ASC`
    )
    .all(...casa.params) as {
    id: string;
    name: string;
    category: string;
    quantity: number;
    unit: string | null;
    expiration_date: string | null;
    estimated_shelf_days: number | null;
    created_at: string;
  }[];
  const compras = comprasDeLaCasa(db, userId);
  const hoyIso = hoy();

  const filasConVida = filas.map((fila) => {
    const clave = productKeyOf(fila.name);
    const historial = compras.get(clave) ?? [];
    const ritmo = ritmoDe(historial);
    const vida = vidaDe(fila);
    const ultimaCompra = historial.length > 0 ? historial[historial.length - 1].dia : null;
    const base = ultimaCompra ?? diaDe(fila.created_at);
    let vence: string | null = null;
    if (vida.source === 'fecha') {
      vence = diaDe(fila.expiration_date);
    } else if (vida.source !== null && vida.dias && base) {
      vence = sumarDias(base, vida.dias);
    }
    return {
      id: fila.id,
      name: fila.name,
      category: fila.category,
      quantity: Number(fila.quantity) || 0,
      unit: fila.unit,
      expirationDate: diaDe(fila.expiration_date),
      estimatedDays: vida.dias,
      shelfSource: vida.source,
      vence,
      daysLeft: vence ? diasEntre(hoyIso, vence) : null,
      cadaDias: ritmo?.cadaDias ?? null,
      unidadesPorCompra: ritmo?.unidadesPorCompra ?? null,
      duraDias: ritmo ? Math.round(Number(fila.quantity) * ritmo.diasPorUnidad) : null,
      lastBought: ultimaCompra
    };
  });

  // Urgencia primero; lo que no sabe cuando vence, al final y por nombre.
  return filasConVida.sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return a.name.localeCompare(b.name, 'es');
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft || a.name.localeCompare(b.name, 'es');
  });
}

/**
 * El bloque que se cuela en el prompt del plan semanal y de las sugerencias: lo que caduca en
 * los proximos 7 dias (o ya caduco), con su estimacion marcada —que la IA sepa que «~4 dias»
 * del pan no es lo mismo que la fecha del yogur—. Vacio si no hay nada urgente.
 */
export function bloqueDeCaducidades(db: SqlDb, userId: string, maximo = 8): string {
  const urgentes = caducidadesDe(db, userId).filter(
    (fila) => fila.daysLeft !== null && fila.daysLeft <= 7
  );
  if (urgentes.length === 0) return '';
  const linea = urgentes
    .slice(0, maximo)
    .map((fila) => {
      const dias = fila.daysLeft!;
      const cuando =
        dias < 0
          ? `caduco hace ${Math.abs(dias)} dia(s)`
          : dias === 0
            ? 'caduca HOY'
            : `caduca en ${dias} dia(s)`;
      const estimado = fila.shelfSource !== 'fecha' ? ' (fecha estimada)' : '';
      return `${fila.name} (${cantidadHumana(fila)}${estimado}, ${cuando})`;
    })
    .join('; ');
  const sobran = urgentes.length > maximo ? `; y ${urgentes.length - maximo} mas` : '';
  return `Caducan pronto en casa (priorizalos en el plan para no tirar comida): ${linea}${sobran}.`;
}

function cantidadHumana(fila: CaducidadRow): string {
  const unidad = fila.unit ? ` ${fila.unit}` : '';
  return `${fila.quantity}${unidad}`;
}

/** El prompt de estimacion de vida util para lo que no tiene ni fecha ni catalogo. */
export function buildShelfPrompt(
  productos: { name: string; unit: string | null; category: string }[]
): {
  system: string;
  user: string;
} {
  const system = [
    'Eres experto en conservacion de alimentos de la cesta espanola. Tu salida es UN objeto JSON y nada mas: sin markdown, sin prosa.',
    'Reglas que no se pueden romper:',
    '- Para cada producto, DIAS ENTEROS de vida util en condiciones normales (nevera si va frio, armario si no), contando desde que se compra.',
    '- Entre 1 y 730 dias. Un producto ultracongelado o de conserva dura meses; un pescado fresco, dias.',
    '- NO inventes productos: responde exactamente los que se te piden, con su mismo nombre.',
    '- Si no conoces el producto, dale los dias de lo mas parecido que conozcas.'
  ].join('\n');
  const user = `Estos productos de la despensa no tienen fecha de caducidad registrada. Estima cuantos dias dura cada uno:\n\n${productos
    .map(
      (producto) =>
        `- ${producto.name}${producto.unit ? ` (${producto.unit})` : ''}${producto.category ? ` [${producto.category}]` : ''}`
    )
    .join('\n')}\n\nResponde SOLO con un JSON valido: {"products": [{"name": "", "days": 0}]}`;
  return { system, user };
}

/** Lo que el modelo contesta al pedirle vidas utiles. */
export const shelfAnswerSchema = z.object({
  products: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        days: z.coerce.number().int().min(1).max(730)
      })
    )
    .max(60)
});
