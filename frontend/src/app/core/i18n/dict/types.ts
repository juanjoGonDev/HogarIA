export type Dict = Record<string, string>;

/**
 * Un par de diccionarios del mismo dominio.
 *
 * `en` se tipa como `Record<keyof typeof es, string>` en cada fichero, que es lo que hace que anadir una
 * cadena al espanol y no traducirla sea un fallo de compilacion en vez de una pantalla a medias. El tipo
 * union de claves (`TranslationKey`) se construye en `../index.ts` sobre la mezcla de todos los dominios.
 */
export interface Pair {
  es: Dict;
  en: Dict;
}
