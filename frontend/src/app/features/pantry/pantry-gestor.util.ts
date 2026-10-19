import type { PantryCategory } from '../../shared/models/pantry.model';
import {
  claveDeDia,
  hoyLocal,
  quitarAcentos,
  sumarDias
} from '../../shared/components/ui/data-table/data-table.util';

/**
 * Lo que las dos pantallas del gestor calculan sin tocar el DOM (HOGARIA-SPEC ## 12x).
 *
 * Vive aqui en vez de dentro del componente porque las dos reglas que hay debajo son las unicas del gestor que
 * se pueden equivocar sin que nadie se de cuenta hasta que la lista esta mal pintada, y porque un `computed` de
 * Angular no es un sitio comodo para probar un arbol. El server tiene las mismas dos reglas (en
 * `server/src/utils/pantry-categories.ts`); aqui se replican para no pedirle un 400 a la persona despues de
 * haberla dejado elegir la opcion que lo provoca.
 */

/**
 * Las claves que NO se pueden elegir como padre de una categoria: ella misma y todo lo que cuelga de ella.
 *
 * Si el picker de padre dejara elegir un descendiente, el arbol se cerraria en un ciclo y el conteo de
 * articulos por rama —que se calcula bajando por el arbol— no acabaria nunca. El server lo rechaza igualmente
 * (`assertPlacement`), pero la pantalla puede simplemente no ofrecer la opcion, y eso es mejor que un error.
 */
export function clavesNoElegiblesComoPadre(
  categorias: PantryCategory[],
  idPropio: string | null
): Set<string> {
  // Al crear no hay nada prohibido: la categoria todavia no tiene descendientes.
  if (!idPropio) return new Set();
  const clavePropia = categorias.find((categoria) => categoria.id === idPropio)?.key;
  if (!clavePropia) return new Set();
  const prohibidas = new Set<string>([clavePropia]);
  let pendientes = [clavePropia];
  const visitadas = new Set<string>([clavePropia]);
  while (pendientes.length > 0) {
    const actual = pendientes.shift()!;
    const hijas = categorias.filter((categoria) => categoria.parentKey === actual);
    for (const hija of hijas) {
      if (visitadas.has(hija.key)) continue;
      visitadas.add(hija.key);
      prohibidas.add(hija.key);
      pendientes.push(hija.key);
    }
  }
  return prohibidas;
}

/** Acepta solo un padre conocido del catálogo; una query es una sugerencia, no autoridad sobre el árbol. */
export function padreDeCategoriaDesdeQuery(
  solicitado: string | null,
  categorias: readonly PantryCategory[]
): string | null {
  const clave = solicitado?.trim();
  if (!clave || !categorias.some((categoria) => categoria.key === clave)) return null;
  return clave;
}

/** El color con el que se pinta una fila: el punto de la categoria, o gris de reserva si no trae ninguno. */
export const COLOR_RESERVA = '#8A8F98';

/** Normaliza el valor que entregan los controles de color nativos sin convertir el vacío en un color real. */
export function normalizarColorSeleccionado(color: string | null | undefined): string | null {
  const valor = color?.trim() ?? '';
  return valor ? valor.toUpperCase() : null;
}

export function colorDeCategoria(
  categoria: Pick<PantryCategory, 'color'> | null | undefined
): string {
  const valor = (categoria?.color ?? '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(valor) ? valor : COLOR_RESERVA;
}

/**
 * El alias que se anade a la ficha, o `null` si no es un alias.
 *
 * Tres cosas lo convierten en `null` y las tres las decide la persona, no el servidor: vacio, el propio nombre
 * del producto (no es un alias, es el nombre), y uno que ya esta puesto. El techo de 20 y de 60 caracteres son
 * los mismos del server, para que el boton no se quede con ganas.
 */
export function normalizarAlias(
  entrada: string,
  nombre: string,
  existentes: string[]
): { valor: string } | { error: 'vacio' | 'repetido' | 'es-el-nombre' } | null {
  const valor = String(entrada ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!valor) return { error: 'vacio' };
  if (nombre && valor.toLowerCase() === nombre.trim().toLowerCase())
    return { error: 'es-el-nombre' };
  if (existentes.some((previo) => previo.toLowerCase() === valor.toLowerCase()))
    return { error: 'repetido' };
  if (existentes.length >= 20) return null;
  return { valor };
}

/** Lo que se pinta en la fila: los tres primeros alias y un «+n» con el resto, para que la lista no baile. */
export function aliasVisibles(
  aliases: string[],
  maximo = 3
): { visibles: string[]; ocultos: number } {
  if (aliases.length <= maximo) return { visibles: aliases, ocultos: 0 };
  return { visibles: aliases.slice(0, maximo), ocultos: aliases.length - maximo };
}

// ── el estado de la lista, que viaja en la query ─────────────────────────────────────────────────────────
//
// Escribir `?filter=&q=&offset=` con `replaceUrl` no sirve de nada si al entrar nadie lo lee: el F5 se queda en
// la primera pagina del filtro de fabrica y la caja de busqueda vacia. Paso en la tanda 25, descubierto por el
// CI (los casos `pantry-managers` que aqui dentro se escribieron a ciegas): la URL decia `filter=in-pantry` y la
// pantalla pintaba `staples`. Se resuelve en el util, y no en cada componente, porque las dos pantallas del
// gestor tienen que leer el estado exactamente igual.

/** Un trozo de la query, con forma de «lo que no esta en la lista de valores no vale». */
export type ConsultaDeQuery = { get(campo: string): string | null };

/**
 * El valor de `campo`, si la app lo conoce. `permitidos` a `null` es «texto libre» —la busqueda—: la URL
 * transporta lo que escribio una persona, con sus espacios, y la ausencia es cadena vacia (no `null`: un input
 * ligado a `null` es un input que alguien tendra que recordar cazar).
 */
export function valorDeQuery<T extends string>(
  query: ConsultaDeQuery,
  campo: string,
  permitidos: readonly T[] | null,
  porDefecto: T
): T {
  const valor = query.get(campo);
  if (valor === null) return porDefecto;
  if (permitidos === null) return valor as T;
  // El `as` es para el tipador, no para el dato: `permitidos` es una lista de literales y `valor` viene de
  // la URL como string; lo que decide si vale es la comparacion, y esa compara cadenas.
  return (permitidos as readonly string[]).includes(valor) ? (valor as T) : porDefecto;
}

/**
 * El desplazamiento en filas. La query es texto del navegador: lo que no es un numero no es pagina, y lo
 * negativo se queda en la primera —una pagina antes de la primera no existe—.
 */
export function offsetDeQuery(query: ConsultaDeQuery, campo = 'offset'): number {
  const leido = Number(query.get(campo));
  return Number.isFinite(leido) && leido > 0 ? Math.floor(leido) : 0;
}

/**
 * Las claves de la raiz y de todo lo que cuelga de ella (HOGARIA-SPEC ## 12ab).
 *
 * Es la misma expansion que hace el server al filtrar `?category=` por subarbol (## 12aa), replicada en cliente
 * porque la tabla del visor filtra sus propias filas: al elegir el padre «Alimentos» entran tambien sus hijas.
 * Se comparte aqui con el gestor porque las dos reglas del arbol viven en este fichero desde la ## 12x.
 */
export function clavesSubarbolDe(
  categorias: readonly Pick<PantryCategory, 'key' | 'parentKey'>[],
  raiz: string
): Set<string> {
  const claves = new Set<string>([raiz]);
  let pendientes = [raiz];
  while (pendientes.length > 0) {
    const actual = pendientes[0]!;
    pendientes = pendientes.slice(1);
    for (const cat of categorias) {
      if (cat.parentKey === actual && !claves.has(cat.key)) {
        claves.add(cat.key);
        pendientes.push(cat.key);
      }
    }
  }
  return claves;
}

/** La pagina tal y como la devuelven los tres endpoints de lista del gestor; `null` es «no llego». */
export type PaginaGestor<T> = {
  data: readonly T[];
  meta?: { total?: number } | null;
  hasMore?: boolean;
} | null;

/**
 * Todas las filas de una consulta, de pagina en pagina (HOGARIA-SPEC ## 12ac).
 *
 * Los tres gestores leian su pagina de 10 y paginaban a mano; la tabla que sustituye a esas listas filtra,
 * ordena y pagina en cliente, y necesita el conjunto completo —filtrar una pagina es la mentira que la casa
 * ya corrigio en el visor (## 12ab). El server no deja pasar de `limit=100` (lo fija el schema), asi que la
 * unica forma honesta de tenerlo todo es recorrer las paginas aqui.
 *
 * Para cuando la pagina llega vacia, cuando se cubre el `total` que anuncia el server, cuando el server dice
 * `hasMore: false`, o al chocar con el `tope` (el mismo techo de 2.000 filas del visor: es un guardagabanes,
 * no una politica de producto). `null` de una pagina = peticion fallida: se devuelve `null` en vez de una
 * media lista muda —la pantalla decide entonces que pinta, y nunca filas a medias por descuido.
 */
export async function cargarTodasLasPaginas<T>(
  pedirPagina: (offset: number, tamano: number) => Promise<PaginaGestor<T>>,
  tamano = 100,
  tope = 2000
): Promise<T[] | null> {
  const salida: T[] = [];
  let offset = 0;
  for (;;) {
    const pagina = await pedirPagina(offset, tamano);
    if (!pagina) return null;
    const filas = pagina.data ?? [];
    for (const fila of filas) if (salida.length < tope) salida.push(fila as T);
    offset += filas.length;
    const total = pagina.meta?.total;
    if (filas.length === 0) break;
    if (salida.length >= tope) break;
    if (typeof total === 'number' && offset >= total) break;
    if (pagina.hasMore === false) break;
  }
  return salida;
}

/** El dia caduca dentro de los proximos tres (hoy incluido), contado POR DIA —la misma leccion del server
 *  de la ## 12z: contra el instante, lo que caduca hoy cuenta como caducado desde la primera hora. */
export function caducaEnTresDias(valor: unknown, hoy: string = hoyLocal()): boolean {
  const dia = claveDeDia(valor);
  if (!dia) return false;
  return dia >= hoy && dia <= sumarDias(hoy, 3);
}

/**
 * La busqueda de las cajas del gestor: sin acentos y sin mayusculas, sobre cualquiera de los campos que la
 * pantalla nombre (el producto encuentra el alias; la categoria, la clave; el catalogo, solo el nombre, que
 * es lo que buscaba `buscarProductos` del server). Con la caja vacia lo deja pasar todo.
 */
export function coincideGestor(
  campos: readonly (string | null | undefined)[],
  consulta: string
): boolean {
  const q = quitarAcentos(consulta.trim().toLowerCase());
  if (!q) return true;
  return campos.some((campo) => !!campo && quitarAcentos(campo.toLowerCase()).includes(q));
}

/**
 * La clave con la que el server dice «esta ficha ya es de la casa» (`normalizeProductName`,
 * `server/src/utils/product-key.ts`), portada al cliente para que el lote del catálogo pueda resolver el
 * ingrediente por la MISMA regla que pintó el «en casa» (## 12ad). Es un espejo, no una reinterpretación: las
 * unidades abreviadas, la puntuación de sobra y los rellenos se tratan igual; si el server cambia, cambia
 * aqui (el test de arriba es el candado). Se traduce la lectura, no la comparación.
 */
const UNIDADES_PORTUGUES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:kilogramos?|kilos?|kgs?)\b/g, 'kg'],
  [/\b(?:gramos?|grs?)\b/g, 'g'],
  [/\b(?:litros?|lts?|ls)\b/g, 'l'],
  [/\b(?:mililitros?|mls?)\b/g, 'ml'],
  [/\b(?:unidades?|uds?|pzas?)\b/g, 'ud'],
  [/\b(?:packs?|paquetes?)\b/g, 'pack'],
  [/\b(?:botellas?|botellines?)\b/g, 'botella'],
  [/\b(?:botes?|tarros?|frascos?)\b/g, 'bote']
];
const RUIDO_PORTUGUES: readonly RegExp[] = [
  /\bx\s*\d+\b/g,
  /\(\d+(?:[.,]\d+)?\s*[a-zç-ž]*\)/g,
  /[.,;:!?]+/g
];

export function claveDeProductoCasa(nombre: string | null | undefined): string {
  const raw = (nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!raw) return '';
  let clave = raw;
  for (const patron of RUIDO_PORTUGUES) clave = clave.replace(patron, ' ');
  for (const [patron, reemplazo] of UNIDADES_PORTUGUES)
    clave = clave.replace(patron, ` ${reemplazo} `);
  clave = clave.replace(/\b(?:de|del|la|el|los|las)\b/g, ' ');
  return clave.replace(/\s+/g, ' ').trim();
}
