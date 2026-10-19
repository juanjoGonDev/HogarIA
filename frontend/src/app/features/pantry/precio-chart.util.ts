/**
 * La logica de la grafica de precios (HOGARIA-SPEC ## 12ai), fuera del componente.
 *
 * Agrupar por tienda, decidir escalas y dibujar un path son las tres cosas que se rompen
 * en silencio (una tienda que desaparece, un eje que empieza en cero y aplasta todo, un
 * solo punto que dibuja «nada»), y un template de Angular no es sitio para probarlas.
 * Aqui son funciones puras con su spec al lado —el patron de `pantry-gestor.util.ts`— y
 * el componente solo pinta lo que estas devuelven.
 */

import type { PriceObservation } from '../../shared/models/shopping.model';

/** Un precio por unidad, en el instante en que se apunto. */
export interface PuntoPrecio {
  ms: number;
  minor: number;
}

/** Una tienda y su historia de precios: lo que pinta una linea de la grafica. */
export interface SerieTienda {
  tienda: string | null;
  color: string;
  puntos: PuntoPrecio[];
  /** Lo ultimo que costo alla, por unidad. */
  ultimo: number;
  /** La media de lo que ha costado, por unidad. */
  media: number;
  observaciones: number;
}

/**
 * La paleta de la grafica: colores de la familia de los que ya usa la casa (los pasillos del
 * catalogo), elegidos para que dos tiendas vecinas no se confundan ni en blanco ni en oscuro.
 * Ocho basta: mas tiendas que colores es una grafica que nadie lee.
 */
export const PALETA_GRAFICA: readonly string[] = [
  '#4CAF50',
  '#5C6BC0',
  '#EF6C00',
  '#C2185B',
  '#00897B',
  '#8E5AC8',
  '#B26A00',
  '#546E7A'
];

/**
 * Las observaciones de una clave de producto, repartidas por tienda. El precio que se compara
 * es el de POR UNIDAD (`price_minor / quantity`): un ticket de «2x 3,40 €» no es mas caro que
 * uno de «1x 1,70 €», y pintarlos tal cual dibujaria montanas que no existen.
 */
export function seriesPorTienda(observaciones: PriceObservation[]): SerieTienda[] {
  const porTienda = new Map<string | null, PriceObservation[]>();
  for (const observacion of observaciones) {
    const tienda = observacion.store_name?.trim() || null;
    const cubo = porTienda.get(tienda) ?? [];
    cubo.push(observacion);
    porTienda.set(tienda, cubo);
  }
  // Orden estable y legible: las tiendas con nombre por alfabeto, y «sin tienda» al final —
  // que el color de una tienda no dependa de en que orden llegaron las filas del server.
  const tiendas = [...porTienda.entries()].sort(([a], [b]) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a.localeCompare(b, 'es', { sensitivity: 'base' });
  });
  return tiendas
    .map(([tienda, filas], indice) => {
      const puntos = filas
        .map((fila, orden) => ({
          ms: Date.parse(fila.observed_at),
          minor: Math.round(Number(fila.price_minor) / (Number(fila.quantity) || 1)),
          orden
        }))
        .filter((punto) => Number.isFinite(punto.ms) && Number.isFinite(punto.minor))
        // El tiempo hacia arriba; y en el empate a instante, gana el que el API conto primero:
        // `/prices` llega de nuevo a viejo, asi que «el ultimo de ese dia» es el PRIMERO que
        // llego en la respuesta, no el que cae al final tras un sort estable.
        .sort((a, b) => a.ms - b.ms || b.orden - a.orden)
        .map(({ ms, minor }) => ({ ms, minor }));
      return {
        tienda,
        color: PALETA_GRAFICA[indice % PALETA_GRAFICA.length],
        puntos,
        ultimo: puntos.length ? puntos[puntos.length - 1].minor : 0,
        media: puntos.length
          ? Math.round(puntos.reduce((suma, punto) => suma + punto.minor, 0) / puntos.length)
          : 0,
        observaciones: puntos.length
      };
    })
    .filter((serie) => serie.puntos.length > 0);
}

/** Las marcas de un eje: donde caen y que numero llevan. */
export interface MarcaEje {
  valor: number;
  pos: number;
}

/** La geometria de la grafica: escalas, margenes y marcas, ya resueltas. */
export interface Geometria {
  ancho: number;
  alto: number;
  izq: number;
  der: number;
  arriba: number;
  abajo: number;
  msMin: number;
  msMax: number;
  minorMin: number;
  minorMax: number;
  marcasY: MarcaEje[];
  marcasX: MarcaEje[];
  x(ms: number): number;
  y(minor: number): number;
}

/**
 * Escalas de la grafica. Cuatro reglas que no son negociables:
 *
 *  - el eje Y no empieza en cero si todos los precios viven lejos de cero: una linea que
 *    solo baja «un poco» en un eje de 0 a 100 € miente por omision; el aire es del 8%;
 *  - un solo dia de historia no colapsa el eje X: se le da un dia de aire a cada lado;
 *  - un solo precio no colapsa el eje Y: ±10 centimos de aire;
 *  - `null` cuando no hay nada que dibujar —la pantalla pone su vacio, no la geometria.
 */
export function geometria(series: SerieTienda[], ancho = 720, alto = 280): Geometria | null {
  const puntos = series.flatMap((serie) => serie.puntos);
  if (puntos.length === 0) return null;

  let msMin = Infinity;
  let msMax = -Infinity;
  let minorMin = Infinity;
  let minorMax = -Infinity;
  for (const punto of puntos) {
    msMin = Math.min(msMin, punto.ms);
    msMax = Math.max(msMax, punto.ms);
    minorMin = Math.min(minorMin, punto.minor);
    minorMax = Math.max(minorMax, punto.minor);
  }
  if (msMax === msMin) {
    msMin -= 12 * 3600 * 1000;
    msMax += 12 * 3600 * 1000;
  }
  if (minorMax === minorMin) {
    minorMin = Math.max(0, minorMin - 10);
    minorMax = minorMax + 10;
  } else {
    const aire = (minorMax - minorMin) * 0.08;
    minorMin = Math.max(0, Math.round(minorMin - aire));
    minorMax = Math.round(minorMax + aire);
  }

  const izq = 56;
  const der = 14;
  const arriba = 14;
  const abajo = 30;
  const x = (ms: number): number => izq + ((ms - msMin) / (msMax - msMin)) * (ancho - izq - der);
  const y = (minor: number): number =>
    arriba + (1 - (minor - minorMin) / (minorMax - minorMin)) * (alto - arriba - abajo);

  // Cuatro lineas horizontales, del piso al techo: ni una por euro (ruido) ni dos (pobreza).
  const marcasY: MarcaEje[] = [0, 1, 2, 3].map((paso) => {
    const valor = Math.round(minorMin + ((minorMax - minorMin) * paso) / 3);
    return { valor, pos: y(valor) };
  });
  // Hasta cuatro fechas repartidas por el recorrido; el componente deduplica etiquetas.
  const marcasX: MarcaEje[] = [0, 1, 2, 3].map((paso) => {
    const valor = Math.round(msMin + ((msMax - msMin) * paso) / 3);
    return { valor, pos: x(valor) };
  });

  return {
    ancho,
    alto,
    izq,
    der,
    arriba,
    abajo,
    msMin,
    msMax,
    minorMin,
    minorMax,
    marcasY,
    marcasX,
    x,
    y
  };
}

/** El `d` del path de una serie: `M` en el primer punto y `L` en el resto. */
export function caminoDe(serie: SerieTienda, g: Geometria): string {
  return serie.puntos
    .map((punto, indice) => {
      const comando = indice === 0 ? 'M' : 'L';
      return `${comando}${g.x(punto.ms).toFixed(1)},${g.y(punto.minor).toFixed(1)}`;
    })
    .join(' ');
}
