/**
 * La lógica de `app-data-table`, fuera del componente (HOGARIA-SPEC ## 12ab).
 *
 * Orden, filtros por columna y paginación son las tres reglas que se pueden equivocar sin que nadie lo note
 * hasta que la tabla está mal pintada, y un `computed` de Angular no es un sitio cómodo para probarlas. Aquí
 * son funciones puras con su spec al lado (el patrón de `pantry-gestor.util.ts`) y el componente solo las
 * llama.
 *
 * Ninguna de estas funciones escribe texto de la interfaz: las etiquetas las pone la pantalla y el cubo de
 * las filas sin dato es la clave interna `SIN_VALOR`, no una frase.
 */

import type {
  DireccionOrden,
  FiltroColumna,
  FiltroFecha,
  FiltroNumero,
  FiltroValores,
  OrdenTabla,
  TipoColumna
} from './data-table.types';

/** La fila sin dato entra en este cubo del filtro de valores. */
export const SIN_VALOR = '\u0000sin-valor';

/** El collator de siempre en español, con números naturales: 'Lechuga 2' va despues de 'Lechuga 10' no. */
const colacion = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export type LeedorFila = (fila: unknown, clave: string) => unknown;

/** El valor de la celda convertido en cadena-cubo: `null`/hueco al cubo SIN_VALOR, lo demas a string. */
export function cuboDe(valor: unknown): string {
  if (valor === null || valor === undefined) return SIN_VALOR;
  if (valor === '') return SIN_VALOR;
  return String(valor);
}

/** `2026-12-31T…`, `2026-12-31 `, `2026/12/31` → `2026-12-31`. Lo que no se parece a un dia, hueco. */
export function claveDeDia(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(/\//g, '-');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** `numero`→number estricto, `booleano`→booleano, `fecha`→dia, `texto`→cadena. El hueco se queda hueco. */
export function valorTipado(valor: unknown, tipo: TipoColumna): number | string | boolean | null {
  if (valor === null || valor === undefined || valor === '') return null;
  switch (tipo) {
    case 'numero': {
      const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/,/g, '.'));
      return Number.isFinite(n) ? n : null;
    }
    case 'booleano': {
      if (typeof valor === 'boolean') return valor;
      const b = String(valor).toLowerCase();
      return b === 'true' || b === '1';
    }
    case 'fecha':
      return claveDeDia(valor);
    default:
      return String(valor);
  }
}

/**
 * El ciclo del encabezado (lo que se comprueba en el spec antes de pintar ni un boton):
 *  - clic normal: la columna se queda SOLA en el orden —ausente→asc, asc→desc, desc→sin orden—;
 *  - Shift+clic: se suma a lo que habia —ausente→asc al final, asc→desc, desc→se va del orden.
 */
export function rotarOrden(actual: OrdenTabla, clave: string, multiple: boolean): OrdenTabla {
  const indice = actual.findIndex((c) => c.clave === clave);
  if (indice === -1) {
    return multiple ? [...actual, { clave, dir: 'asc' }] : [{ clave, dir: 'asc' }];
  }
  const criterio = actual[indice];
  if (criterio.dir === 'asc') {
    if (!multiple) return [{ clave, dir: 'desc' }];
    const copia = [...actual];
    copia[indice] = { clave, dir: 'desc' };
    return copia;
  }
  // desc → fuera. Con Shift se quita esa clave y las demas siguen; sin Shift, desc→asc es «empezar de
  // nuevo por esta columna»: el clic suelto no puede dejar la tabla sin orden porque entonces no habria
  // forma de volver al asc desde el desc sin disparar dos filtros mentales.
  if (multiple) return actual.filter((c) => c.clave !== clave);
  return [{ clave, dir: 'asc' }];
}

/** El sentido que hay que pintar en el encabezado: el propio criterio, o hueco si la columna no ordena. */
export function direccionDe(actual: OrdenTabla, clave: string): DireccionOrden | null {
  return actual.find((c) => c.clave === clave)?.dir ?? null;
}

/** Posicion (1-based) de la clave dentro del orden multiple; hueco si manda sola o no esta. */
export function posicionDeOrden(actual: OrdenTabla, clave: string): number | null {
  if (actual.length <= 1) return null;
  const i = actual.findIndex((c) => c.clave === clave);
  return i === -1 ? null : i + 1;
}

function comparar(a: unknown, b: unknown, tipo: TipoColumna, dir: DireccionOrden): number {
  const sa = valorTipado(a, tipo);
  const sb = valorTipado(b, tipo);
  // El cubo SIN_VALOR va siempre al final, también con `desc`: en Excel un «(Vacías)» abajo no es un
  // detalle estetico, es que el hueco no es un valor comparable.
  if (sa === null && sb === null) return 0;
  // El hueco va al final en los dos sentidos: en Excel un «(Vacías)» abajo no es un detalle estético,
  // es que el hueco no es un valor comparable.
  if (sa === null) return 1;
  if (sb === null) return -1;
  let r = 0;
  if (tipo === 'numero')
    r = (sa as number) < (sb as number) ? -1 : (sa as number) > (sb as number) ? 1 : 0;
  else if (tipo === 'booleano') r = Number(sa as boolean) - Number(sb as boolean);
  else r = colacion.compare(String(sa), String(sb));
  return dir === 'asc' ? r : -r;
}

/**
 * Orden multiple estable: `Array.prototype.sort` es estable en V8 y se le pasa la lista ya filtrada; los
 * empates entre la ultima clave conocida conservan el orden de entrada, que es lo que espera quien mira.
 */
export function ordenar<T>(
  filas: readonly T[],
  orden: OrdenTabla,
  leedor: LeedorFila,
  tipoDe: (clave: string) => TipoColumna
): T[] {
  if (orden.length === 0) return [...filas];
  return [...filas].sort((a, b) => {
    for (const criterio of orden) {
      const r = comparar(
        leedor(a, criterio.clave),
        leedor(b, criterio.clave),
        tipoDe(criterio.clave),
        criterio.dir
      );
      if (r !== 0) return r;
    }
    return 0;
  });
}

/** El numero de filas por valor presente, con el orden que ver el menu (colacion; SIN_VALOR al final). */
export function valoresUnicos<T>(
  filas: readonly T[],
  clave: string,
  leedor: LeedorFila,
  tipo: TipoColumna
): { valor: string; cuenta: number }[] {
  const cuentaPorValor = new Map<string, number>();
  for (const fila of filas) {
    const cubo = cuboDe(leedor(fila, clave));
    cuentaPorValor.set(cubo, (cuentaPorValor.get(cubo) ?? 0) + 1);
  }
  const salida = [...cuentaPorValor.entries()].map(([valor, cuenta]) => ({ valor, cuenta }));
  salida.sort((a, b) => {
    if (a.valor === SIN_VALOR) return 1;
    if (b.valor === SIN_VALOR) return -1;
    if (tipo === 'numero') {
      const na = Number(a.valor.replace(/,/g, '.'));
      const nb = Number(b.valor.replace(/,/g, '.'));
      return na - nb;
    }
    return colacion.compare(a.valor, b.valor);
  });
  return salida;
}

export function filtroValoresActivo(filtro: FiltroValores | undefined): boolean {
  return !!filtro && filtro.tipo === 'valores' && filtro.activos !== null;
}

export function filtroNumeroActivo(filtro: FiltroNumero | undefined): boolean {
  if (!filtro || filtro.tipo !== 'numero') return false;
  if (filtro.modo === 'entre') return filtro.a !== null || filtro.b !== null;
  return filtro.a !== null;
}

export function filtroFechaActivo(filtro: FiltroFecha | undefined): boolean {
  if (!filtro || filtro.tipo !== 'fecha') return false;
  if (filtro.modo === 'hoy' || filtro.modo === 'siete' || filtro.modo === 'vencidos') return true;
  if (filtro.modo === 'entre') return filtro.a !== null || filtro.b !== null;
  return filtro.a !== null;
}

export function filtroActivo(filtro: FiltroColumna | undefined): boolean {
  if (!filtro) return false;
  switch (filtro.tipo) {
    case 'valores':
      return filtroValoresActivo(filtro);
    case 'numero':
      return filtroNumeroActivo(filtro);
    case 'fecha':
      return filtroFechaActivo(filtro);
  }
}

/** El «Recortar» de Excel: deja el filtro con lo que hay seleccionado en la casilla. */
export function recortarFiltro(filtro: FiltroValores): FiltroValores {
  return { tipo: 'valores', activos: filtro.activos ?? [] };
}

function pasaValores(filtro: FiltroValores, cubo: string): boolean {
  if (filtro.activos === null) return true;
  return filtro.activos.includes(cubo);
}

function pasaNumero(filtro: FiltroNumero, valor: unknown): boolean {
  const leido = valorTipado(valor, 'numero');
  if (leido === null) return false; // las condiciones numericas de Excel tampoco ven los huecos
  const n = leido as number;
  const a = filtro.a;
  const b = filtro.b;
  switch (filtro.modo) {
    case 'igual':
      return a !== null && n === a;
    case 'mayor':
      return a !== null && n > a;
    case 'menor':
      return a !== null && n < a;
    case 'entre':
      if (a !== null && n < a) return false;
      if (b !== null && n > b) return false;
      return a !== null || b !== null;
  }
}

function pasaFecha(filtro: FiltroFecha, valor: unknown, hoy: string): boolean {
  const dia = claveDeDia(valor);
  if (dia === null) return false;
  switch (filtro.modo) {
    case 'hoy':
      return dia === hoy;
    case 'siete':
      return dia >= hoy && dia <= sumarDias(hoy, 7);
    case 'vencidos':
      return dia < hoy;
    case 'antes':
      return filtro.a !== null && dia < filtro.a;
    case 'despues':
      return filtro.a !== null && dia > filtro.a;
    case 'entre':
      if (filtro.a !== null && dia < filtro.a) return false;
      if (filtro.b !== null && dia > filtro.b) return false;
      return filtro.a !== null || filtro.b !== null;
  }
}

/** Suma dias a un `YYYY-MM-DD` sin zona horaria de por medio: la caducidad es un dia, no un instante. */
export function sumarDias(dia: string, cantidad: number): string {
  const d = new Date(`${dia}T12:00:00`);
  d.setDate(d.getDate() + cantidad);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dd}`;
}

/** El hoy local como dia: el mismo criterio de `daysUntil` (mediodia local), para que «hoy» no dependa de la hora. */
export function hoyLocal(ahora: Date = new Date()): string {
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dd = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dd}`;
}

export type FiltroDeColumna = { columna: string; tipo: TipoColumna; filtro: FiltroColumna };

/**
 * El pase de filtros: la fila sobrevive si cumple TODOS los filtros activos (interseccion, como en Excel).
 * `filtros` es la lista de filtros puestos; quien llama decide que columna es cada uno y de que tipo es.
 */
export function pasarFiltros<T>(
  filas: readonly T[],
  filtros: readonly FiltroDeColumna[],
  leedor: LeedorFila,
  hoy: string = hoyLocal()
): T[] {
  if (filtros.length === 0) return [...filas];
  return filas.filter((fila) =>
    filtros.every(({ columna, tipo, filtro }) => {
      switch (filtro.tipo) {
        case 'valores':
          return pasaValores(filtro, cuboDe(leedor(fila, columna)));
        case 'numero':
          return pasaNumero(filtro, leedor(fila, columna));
        case 'fecha':
          return pasaFecha(filtro, leedor(fila, columna), hoy);
      }
    })
  );
}

/** El menu del filtro de texto se filtra por substring sin acentos, igual que el buscador de la pantalla. */
export function coincideEnMenu(valorEtiqueta: string, busqueda: string): boolean {
  const q = busqueda.trim().toLowerCase();
  if (!q) return true;
  return quitarAcentos(valorEtiqueta.toLowerCase()).includes(quitarAcentos(q));
}

export function quitarAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Recorte de paginacion. `pagina` es 1-based; la pagina pedida se acota a la ultima antes de cortar. */
export function paginar<T>(
  filas: readonly T[],
  pagina: number,
  tamano: number
): { filas: T[]; desde: number; hasta: number; total: number; ultima: number } {
  const total = filas.length;
  const ultima = Math.max(1, Math.ceil(total / Math.max(1, tamano)));
  const efectiva = Math.min(Math.max(1, Math.trunc(pagina) || 1), ultima);
  const desde = (efectiva - 1) * tamano;
  const cortadas = filas.slice(desde, desde + tamano);
  return {
    filas: cortadas,
    desde: total === 0 ? 0 : desde + 1,
    hasta: desde + cortadas.length,
    total,
    ultima
  };
}

/**
 * El tramo de indices entre dos posiciones, inclusivo y en orden ascendente (## 12ad, seleccion con Shift).
 * El componente lo aplica sobre la lista de ids visibles; aqui solo vive la aritmetica, que es lo que se
 * prueba sin arbol de Angular.
 */
export function tramoDeIndices(a: number, b: number): number[] {
  const [desde, hasta] = a <= b ? [a, b] : [b, a];
  const tramo: number[] = [];
  for (let i = desde; i <= hasta; i++) tramo.push(i);
  return tramo;
}

/**
 * Que pagina conservar al cambiar el tamano para que la primera fila de la pagina actual siga a la vista
 * (## 12ad). Se cuenta sobre la fila, no sobre la pagina: `floor((pagina-1)*viejo/nuevo)+1`.
 */
export function reanclarPagina(pagina: number, tamanoViejo: number, tamanoNuevo: number): number {
  if (tamanoNuevo <= 0 || tamanoViejo <= 0) return 1;
  const primeraFila = Math.max(0, (pagina - 1) * tamanoViejo);
  return Math.max(1, Math.floor(primeraFila / tamanoNuevo) + 1);
}

/**
 * La hilera del paginador (## 12ad): primera y ultima siempre, ventana de +-1 sobre la actual, y los huecos
 * con sus marcas. Un hueco de UNA sola pagina se imprime como numero —un «…» por una pagina ausente miente
 * sobre cuanto queda—; dos huecos que se solapan se fusionan, y si al final no queda nada entre los bloques,
 * las marcas desaparecen.
 */
export function tramoDePaginas(actual: number, ultima: number): (number | 'ini' | 'fin')[] {
  if (ultima <= 0) return [];
  if (ultima <= 7) return Array.from({ length: ultima }, (_, i) => i + 1);
  const centro = Math.min(Math.max(actual, 1), ultima);
  // SIEMPRE siete casillas mientras haya mas de siete paginas (## 12ah): la hilera de numeros es lo
  // unico del pie que cambia al navegar, y si en la pagina 1 pinta cuatro casillas y en la 5 pinta siete,
  // el pie entero respira con cada clic y la tabla baila debajo. Antes la ventana era «lo que saliera»
  // («1 2 … 10», «1 … 4 5 6 … 20»): lo que gana en casillas lo pierde el ancho. Siete fijas —la marca
  // «…» mide exactamente lo que un numero, que para eso el CSS la encaja en la misma casilla— y el
  // mismo total en la primera pagina que en la ultima.
  if (centro <= 4) return [1, 2, 3, 4, 5, 'fin', ultima];
  if (centro >= ultima - 3)
    return [1, 'ini', ultima - 4, ultima - 3, ultima - 2, ultima - 1, ultima];
  return [1, 'ini', centro - 1, centro, centro + 1, 'fin', ultima];
}
