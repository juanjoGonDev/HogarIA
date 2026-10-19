import { productKeyOf } from './product-key.js';
import { ritmoDe, type CaducidadRow, type Compra } from './caducidades.js';

/**
 * La lista de la compra sugerida (HOGARIA-SPEC ## 12al): SIN IA, solo estadistica de la propia
 * casa. Lo que la casa ha comprado (price_observations) dice cada cuanto se repone cada
 * producto y en que pack; la despensa dice cuanto queda y cuando caduca; el calendario dice
 * que recetas tocan esta semana. Con eso, cuatro reglas legibles:
 *
 *   - CADUCA: lo que no se va a consumir a tiempo (caduca en <=2 dias o ya caduco) se repone:
 *     es comida que se tira, y reponerla es la razon de existir de una lista.
 *   - SIN STOCK: se acabo y se compraba → lo que cubre la semana al ritmo de la casa, o el
 *     tamano de la ultima compra si el ritmo aun no se conoce.
 *   - SE ACABA: al ritmo de la casa el stock no llega al horizonte → lo que falta, redondeado
 *     al pack en que se compra (sugerir 5 yogures cuando se venden de 6 es sugerir nada).
 *   - PARA EL PLAN: las recetas de la semana necesitan mas de lo que hay → lo que falta.
 *
 * La cantidad es el MAXIMO de las reglas que aplican (no la suma: si el plan pide 4 y el ritmo
 * 6, son 6) y el motivo es el de esa cantidad ganadora. La mejor tienda es la mas barata de
 * las que la casa conoce, por su ULTIMO precio (el precio de marzo no decide el de hoy).
 */

type SqlDb = import('better-sqlite3').Database;

/** La lista cubre una semana: es el ciclo natural de la compra y el del planificador. */
export const HORIZONTE_DIAS = 7;
/** Una sugerencia de 60 lineas no es una sugerencia, es una mudanza. */
export const TOPE_SUGERENCIAS = 30;
/** Caduca en 2 dias o menos (o ya caduco): lo que no se coma a tiempo se repone. */
const CADUCA_UMBRAL_DIAS = 2;

export type MotivoDeSugerencia = 'caduca' | 'sin_stock' | 'se_acaba' | 'para_el_plan';

/** Un producto de la despensa con lo que hace falta para decidir: stock, caducidad y ritmo. */
export interface ProductoSugerible {
  clave: string;
  name: string;
  category: string | null;
  unit: string | null;
  quantity: number;
  /** Dias hasta caducar (negativo = caducado); null = no se sabe. */
  daysLeft: number | null;
  cadaDias: number | null;
  unidadesPorCompra: number | null;
}

/** Una observacion de precio tal cual vive en la tabla. */
export interface ObservacionDePrecio {
  store_name: string | null;
  price_minor: number;
  quantity: number;
  observed_at: string;
}

/** Un ingrediente de una receta del plan de la semana. */
export interface NecesidadDelPlan {
  name: string;
  quantity: number;
  unit: string;
  isOptional?: boolean;
}

/** Lo que ve la pantalla y lo que se escribe en la lista. */
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
  /** Precio por unidad en centimos, del ultimo dato en la mejor tienda. */
  precioUnitarioMinor: number | null;
  /** precioUnitarioMinor x cantidad, redondeado a centimos. */
  precioEstimadoMinor: number | null;
}

/**
 * La despensa entera (tambien lo que esta a cero, que aqui es justo lo interesante), unida por
 * clave de producto: las filas de la misma clave son el mismo producto y sus stocks se suman.
 */
export function productosSugeribles(
  caducidades: CaducidadRow[],
  sinStock: { name: string; category: string; unit: string | null }[],
  compras: Map<string, Compra[]>
): Map<string, ProductoSugerible> {
  const porClave = new Map<string, ProductoSugerible>();
  const fundir = (fila: Partial<ProductoSugerible> & { clave: string; name: string }) => {
    const previa = porClave.get(fila.clave);
    if (!previa) {
      porClave.set(fila.clave, {
        clave: fila.clave,
        name: fila.name,
        category: fila.category ?? null,
        unit: fila.unit ?? null,
        quantity: fila.quantity ?? 0,
        daysLeft: fila.daysLeft ?? null,
        cadaDias: fila.cadaDias ?? null,
        unidadesPorCompra: fila.unidadesPorCompra ?? null
      });
      return;
    }
    // Dos filas de la misma clave: el stock se suma, la caducidad manda la mas cercana y el
    // ritmo el primero que lo tenga (es el mismo producto: es el mismo ritmo).
    previa.quantity += fila.quantity ?? 0;
    const daysLeft = fila.daysLeft ?? null;
    if (daysLeft !== null && (previa.daysLeft === null || daysLeft < previa.daysLeft)) {
      previa.daysLeft = daysLeft;
    }
    if (previa.cadaDias === null && fila.cadaDias != null) previa.cadaDias = fila.cadaDias;
    if (previa.unidadesPorCompra === null && fila.unidadesPorCompra != null) {
      previa.unidadesPorCompra = fila.unidadesPorCompra;
    }
  };

  for (const fila of caducidades) {
    fundir({
      clave: productKeyOf(fila.name),
      name: fila.name,
      category: fila.category,
      unit: fila.unit,
      quantity: fila.quantity,
      daysLeft: fila.daysLeft,
      cadaDias: fila.cadaDias,
      unidadesPorCompra: fila.unidadesPorCompra
    });
  }
  for (const fila of sinStock) {
    const clave = productKeyOf(fila.name);
    const ritmo = ritmoDe(compras.get(clave) ?? []);
    const ultima = compras.get(clave)?.at(-1) ?? null;
    fundir({
      clave,
      name: fila.name,
      category: fila.category,
      unit: fila.unit,
      quantity: 0,
      // Sin stock no hay caducidad que vigilar; lo que importa es que se compraba.
      daysLeft: null,
      cadaDias: ritmo?.cadaDias ?? null,
      unidadesPorCompra: ritmo?.unidadesPorCompra ?? ultima?.cantidad ?? null
    });
  }
  return porClave;
}

/**
 * La tienda mas barata para un producto, entre las que la casa conoce, por el ULTIMO precio de
 * cada una. El ultimo y no la media porque la lista se compra hoy: una oferta de enero no
 * abarata marzo, y una subida de la semana pasada si que encarece hoy.
 */
export function mejorTiendaDe(observaciones: ObservacionDePrecio[]): {
  tienda: string;
  precioUnitarioMinor: number;
} | null {
  const ultimoPorTienda = new Map<string, ObservacionDePrecio>();
  for (const obs of observaciones) {
    if (!obs.store_name) continue;
    const previa = ultimoPorTienda.get(obs.store_name);
    if (!previa || String(obs.observed_at) > String(previa.observed_at)) {
      ultimoPorTienda.set(obs.store_name, obs);
    }
  }
  let mejor: { tienda: string; precioUnitarioMinor: number } | null = null;
  for (const [tienda, obs] of ultimoPorTienda) {
    const cantidad = Number(obs.quantity) || 1;
    const porUnidad = obs.price_minor / cantidad;
    if (!mejor || porUnidad < mejor.precioUnitarioMinor) {
      mejor = { tienda, precioUnitarioMinor: porUnidad };
    }
  }
  return mejor;
}

/** 'unit' (las recetas) y 'ud' (la despensa) son la misma unidad con dos nombres. */
function unidadCanonica(unidad: string | null | undefined): string {
  const texto = String(unidad ?? '').trim().toLowerCase();
  if (!texto) return '';
  return texto === 'unit' || texto === 'units' || texto === 'unidad' || texto === 'unidades' ? 'ud' : texto;
}

/** La cantidad que falta para cubrir el horizonte, redondeada al pack en que se compra. */
function cubrirHorizonte(
  quantity: number,
  diasPorUnidad: number,
  unidadesPorCompra: number | null
): number {
  const faltan = Math.ceil(HORIZONTE_DIAS / diasPorUnidad - quantity);
  if (faltan <= 0) return 0;
  const pack = unidadesPorCompra && unidadesPorCompra >= 2 ? Math.ceil(unidadesPorCompra) : 1;
  return Math.max(pack, Math.ceil(faltan / pack) * pack);
}

const ORDEN_DE_MOTIVO: Record<MotivoDeSugerencia, number> = {
  caduca: 0,
  sin_stock: 1,
  se_acaba: 2,
  para_el_plan: 3
};

/**
 * Las sugerencias, de punta a punta. Recibe los datos ya leidos (nada de SQL aqui: asi la
 * politica es probable con casos escritos, no con una base de datos de prueba) y devuelve las
 * filas ordenadas por prisa: lo que se tira, lo que no hay, lo que se acaba, el plan.
 */
export function sugerenciasDeCompra(entrada: {
  caducidades: CaducidadRow[];
  sinStock: { name: string; category: string; unit: string | null }[];
  compras: Map<string, Compra[]>;
  precios: Map<string, ObservacionDePrecio[]>;
  plan: NecesidadDelPlan[];
}): SugerenciaRow[] {
  const productos = productosSugeribles(entrada.caducidades, entrada.sinStock, entrada.compras);

  // El plan, agregado por clave Y unidad: 400 g de lomo y 2 ud de lomo no son lo mismo, y
  // restarles el mismo stock seria inventar una equivalencia que nadie ha dicho.
  const planPorClave = new Map<string, { cantidad: number; unit: string }[]>();
  for (const need of entrada.plan) {
    if (need.isOptional || !(need.quantity > 0)) continue;
    const clave = productKeyOf(need.name);
    const unidad = unidadCanonica(need.unit);
    const necesidades = planPorClave.get(clave) ?? [];
    const previa = necesidades.find((n) => n.unit === unidad);
    if (previa) previa.cantidad += need.quantity;
    else necesidades.push({ cantidad: need.quantity, unit: unidad });
    planPorClave.set(clave, necesidades);
  }

  const filas: SugerenciaRow[] = [];

  // Los productos registrados: caducidad, ritmo y stock.
  for (const producto of productos.values()) {
    const ritmo =
      producto.cadaDias && producto.cadaDias > 0 && producto.unidadesPorCompra &&
      producto.unidadesPorCompra > 0
        ? { diasPorUnidad: producto.cadaDias / producto.unidadesPorCompra }
        : null;
    const unidadesPorDia = ritmo ? 1 / ritmo.diasPorUnidad : null;

    // El candidato lleva su unidad: la del producto casi siempre, pero el plan puede pedir
    // en otra (medio kilo de limones y la receta pide «2 ud»), y la fila tiene que decir en
    // QUE se pide, no en que esta guardado.
    const candidatos: { motivo: MotivoDeSugerencia; cantidad: number; unit: string | null }[] = [];

    // 1) El plan de la semana pide mas de lo que hay. Solo se descuenta el stock de la MISMA
    //    unidad (400 g contra 2 ud no se restan): lo que llega en otra unidad se pide entero.
    for (const necesidad of planPorClave.get(producto.clave) ?? []) {
      const mismaUnidad = unidadCanonica(producto.unit) === necesidad.unit;
      const faltan = Math.ceil(necesidad.cantidad - (mismaUnidad ? producto.quantity : 0));
      if (faltan > 0) {
        candidatos.push({
          motivo: 'para_el_plan',
          cantidad: faltan,
          unit: mismaUnidad ? producto.unit : necesidad.unit
        });
      }
    }

    // 2) El ritmo: sin stock, o el que hay no llega a la semana.
    if (producto.quantity <= 0) {
      if (ritmo) {
        const cantidad = cubrirHorizonte(0, ritmo.diasPorUnidad, producto.unidadesPorCompra);
        if (cantidad > 0) candidatos.push({ motivo: 'sin_stock', cantidad, unit: producto.unit });
      } else if (producto.unidadesPorCompra && producto.unidadesPorCompra > 0) {
        // Sin ritmo (una sola compra) el tamano honesto es el de la ultima compra.
        candidatos.push({
          motivo: 'sin_stock',
          cantidad: Math.ceil(producto.unidadesPorCompra),
          unit: producto.unit
        });
      }
    } else if (ritmo && producto.quantity * ritmo.diasPorUnidad < HORIZONTE_DIAS) {
      const cantidad = cubrirHorizonte(producto.quantity, ritmo.diasPorUnidad, producto.unidadesPorCompra);
      if (cantidad > 0) candidatos.push({ motivo: 'se_acaba', cantidad, unit: producto.unit });
    }

    // 3) Caduca antes de consumirlo: la parte que no se va a comer a tiempo se repone.
    if (producto.daysLeft !== null && producto.daysLeft <= CADUCA_UMBRAL_DIAS) {
      if (unidadesPorDia !== null) {
        const sobrevive = Math.max(0, producto.daysLeft * unidadesPorDia);
        const perdidas = Math.ceil(producto.quantity - sobrevive);
        if (perdidas > 0) candidatos.push({ motivo: 'caduca', cantidad: perdidas, unit: producto.unit });
      } else if (producto.daysLeft < 0 && producto.quantity > 0) {
        // Ya caducado y sin ritmo que diga cuanto se consume: se repone lo que se perdio.
        candidatos.push({
          motivo: 'caduca',
          cantidad: Math.ceil(producto.quantity),
          unit: producto.unit
        });
      }
    }

    if (candidatos.length === 0) continue;
    // La cantidad manda, y el motivo es el de esa cantidad (empate → el motivo mas urgente).
    const ganador = candidatos.reduce((mejor, otro) =>
      otro.cantidad > mejor.cantidad ||
      (otro.cantidad === mejor.cantidad && ORDEN_DE_MOTIVO[otro.motivo] < ORDEN_DE_MOTIVO[mejor.motivo])
        ? otro
        : mejor
    );

    filas.push(filaDe(producto, ganador, entrada.precios));
  }

  // Los ingredientes del plan que NO estan en la despensa: nadie los ha comprado nunca, pero
  // la receta del miercoles los necesita igual. Se sugieren solos, sin ritmo ni tienda.
  for (const [clave, necesidades] of planPorClave) {
    if (productos.has(clave)) continue;
    const nombre = entrada.plan.find((need) => productKeyOf(need.name) === clave)?.name ?? clave;
    for (const necesidad of necesidades) {
      filas.push({
        name: nombre,
        unit: necesidad.unit || null,
        category: null,
        quantity: Math.ceil(necesidad.cantidad),
        motivo: 'para_el_plan',
        daysLeft: null,
        cadaDias: null,
        mejorTienda: null,
        precioUnitarioMinor: null,
        precioEstimadoMinor: null
      });
    }
  }

  return filas
    .sort(
      (a, b) =>
        ORDEN_DE_MOTIVO[a.motivo] - ORDEN_DE_MOTIVO[b.motivo] || a.name.localeCompare(b.name, 'es')
    )
    .slice(0, TOPE_SUGERENCIAS);
}

/** La fila completa: lo que falta (motivo, cantidad y unidad) mas donde sale mas barato. */
function filaDe(
  producto: ProductoSugerible,
  ganador: { motivo: MotivoDeSugerencia; cantidad: number; unit: string | null },
  precios: Map<string, ObservacionDePrecio[]>
): SugerenciaRow {
  const mejor = mejorTiendaDe(precios.get(producto.clave) ?? []);
  const precioUnitario = mejor ? Math.round(mejor.precioUnitarioMinor) : null;
  return {
    name: producto.name,
    unit: ganador.unit ?? producto.unit,
    category: producto.category,
    quantity: Math.max(1, Math.round(ganador.cantidad * 10) / 10),
    motivo: ganador.motivo,
    daysLeft: producto.daysLeft,
    cadaDias: producto.cadaDias,
    mejorTienda: mejor?.tienda ?? null,
    precioUnitarioMinor: precioUnitario,
    precioEstimadoMinor:
      precioUnitario !== null ? Math.round(precioUnitario * ganador.cantidad) : null
  };
}

// ── La lectura de la base de datos, para que las rutas no repitan SQL ─────────────────────

/** Las observaciones de precio de la casa, agrupadas por clave de producto. */
export function preciosDeLaCasa(db: SqlDb, userId: string): Map<string, ObservacionDePrecio[]> {
  const casa = db
    .prepare('SELECT household_id AS hid FROM users WHERE id = ?')
    .get(userId) as { hid: string | null } | undefined;
  const filas = db
    .prepare(
      `SELECT product_key, store_name, price_minor, quantity, observed_at
       FROM price_observations
       WHERE user_id = ? OR (household_id IS NOT NULL AND household_id = ?)
       ORDER BY observed_at ASC`
    )
    .all(userId, casa?.hid ?? null) as (ObservacionDePrecio & { product_key: string })[];
  const porClave = new Map<string, ObservacionDePrecio[]>();
  for (const fila of filas) {
    const lista = porClave.get(fila.product_key) ?? [];
    const { product_key: _clave, ...obs } = fila;
    lista.push(obs);
    porClave.set(fila.product_key, lista);
  }
  return porClave;
}

/**
 * Lo que el plan de la semana (los proximos 7 dias) necesita de cada receta: los ingredientes
 * no opcionales, escalados a las raciones apuntadas (2 raciones de una receta de 4 son media
 * receta, y las cantidades de la lista tienen que decirlo).
 */
export function necesidadesDelPlan(
  db: SqlDb,
  userId: string,
  hoy: string
): NecesidadDelPlan[] {
  const casa = db
    .prepare('SELECT household_id AS hid FROM users WHERE id = ?')
    .get(userId) as { hid: string | null } | undefined;
  const hid = casa?.hid ?? null;
  const filas = db
    .prepare(
      `SELECT m.servings AS meal_servings, r.servings AS recipe_servings, r.ingredients
       FROM meals m
       JOIN weekly_calendars wc ON wc.id = m.calendar_id
       JOIN recipes r ON r.id = m.recipe_id
       WHERE (wc.user_id = ? OR (wc.household_id IS NOT NULL AND wc.household_id = ?))
         AND m.recipe_id IS NOT NULL
         AND m.date >= ? AND m.date <= date(?, '+${HORIZONTE_DIAS - 1} days')`
    )
    .all(userId, hid, hoy, hoy) as {
    meal_servings: number | null;
    recipe_servings: number | null;
    ingredients: string | null;
  }[];

  const necesidades: NecesidadDelPlan[] = [];
  for (const fila of filas) {
    let ingredientes: unknown;
    try {
      ingredientes = JSON.parse(fila.ingredients ?? '[]');
    } catch {
      continue; // una receta con ingredientes ilegibles no rompe la lista entera
    }
    if (!Array.isArray(ingredientes)) continue;
    const factor = (fila.meal_servings || 1) / Math.max(1, fila.recipe_servings || 1);
    for (const ing of ingredientes as Record<string, unknown>[]) {
      const nombre = typeof ing?.name === 'string' ? ing.name.trim() : '';
      const cantidad = Number(ing?.quantity);
      if (!nombre || !Number.isFinite(cantidad) || cantidad <= 0) continue;
      necesidades.push({
        name: nombre,
        quantity: cantidad * factor,
        unit: typeof ing?.unit === 'string' ? ing.unit : '',
        isOptional: ing?.isOptional === true
      });
    }
  }
  return necesidades;
}
