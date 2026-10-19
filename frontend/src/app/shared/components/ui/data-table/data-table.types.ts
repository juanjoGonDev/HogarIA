/**
 * Tipos de `app-data-table` (HOGARIA-SPEC ## 12ab).
 *
 * Viven en su propio fichero porque los dos lados los necesitan sin arrastrar el componente: la pantalla que
 * define columnas y la lógica pura que las aplica (`data-table.util.ts`), que se prueba sin Angular.
 */

export type TipoColumna = 'texto' | 'numero' | 'fecha' | 'booleano';

export type DireccionOrden = 'asc' | 'desc';

/** Una clave del orden activo. Con varias, se aplican en el orden de la lista (Excel). */
export type CriterioOrden = { clave: string; dir: DireccionOrden };

export type OrdenTabla = CriterioOrden[];

/**
 * Filtro de valores (texto/booleano): la seleccion del menu de casillas. `activos: null` es «sin filtro»;
 * un array vacio si es un filtro real (el «nada marcado» de Excel, que no deja ver filas).
 */
export type FiltroValores = { tipo: 'valores'; activos: string[] | null };

export type ModoNumero = 'igual' | 'mayor' | 'menor' | 'entre';
export type FiltroNumero = { tipo: 'numero'; modo: ModoNumero; a: number | null; b: number | null };

export type ModoFecha = 'hoy' | 'siete' | 'vencidos' | 'antes' | 'despues' | 'entre';
export type FiltroFecha = { tipo: 'fecha'; modo: ModoFecha; a: string | null; b: string | null };

export type FiltroColumna = FiltroValores | FiltroNumero | FiltroFecha;

/**
 * La definicion que pinta la pantalla. `etiqueta` viene ya traducida (la tabla no escribe texto: reglas
 * 14/15 del `check-ui`); `etiquetaValor` convierte el valor crudo de la celda en lo que se lee (la clave
 * 'vegetables' en 'Verduras'), y es TAMBIEN la que nomina los valores unicos del menu de filtro, asi que el
 * filtro trabaja sobre el dato, no sobre la frase.
 */
export interface DataTableColumna {
  clave: string;
  etiqueta: string;
  tipo?: TipoColumna;
  /** Nombre de la celda proyectada (`appDataTableCell`); si falta, la celda es el valor del campo. */
  celda?: string;
  ordenable?: boolean;
  filtrable?: boolean;
  alineacion?: 'start' | 'center' | 'end';
  ancho?: string;
  /** Etiqueta del valor para la celda y para el menu de filtro (enums). Sin esto, valor crudo. */
  etiquetaValor?: (valor: unknown) => string;
}
