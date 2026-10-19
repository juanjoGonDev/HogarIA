/**
 * La hoja del catalogo global → la seccion del carrito (HOGARIA-SPEC ## 12ah).
 *
 * Elegir una sugerencia del catalogo no puede dejar la linea «sin clase»: la hoja del
 * super (dairy, bakery…) ya dice en que pasillo se compra, y el carrito agrupa por su
 * propia seccion («Lacteos», «Panaderia»…). Esta tabla es la unica traduccion entre
 * los dos vocabularios, dato puro con spec al lado, porque es el sitio que un
 * `computed` no puede probar.
 *
 * Las secciones son entradas de `LIST_CATEGORIES` —el vocabulario que siembra el server
 * y con el que la lista agrupa y ordena— y se escriben una sola vez: la tabla va de
 * seccion a hojas (como se lee en la tienda: «en Lacteos cae dairy»), y el record que
 * usa el codigo se deriva de ella. Mascotas y bebe no tienen pasillo propio en el
 * carrito: se quedan en «Otros», como cualquier hoja que nazca manana en el catalogo.
 */

import { LIST_CATEGORIES } from '../../shared/models/shopping.model';

/** Lo que puede valer una seccion del carrito: las nueve de siempre. */
export type SeccionDeLista = (typeof LIST_CATEGORIES)[number];

/** Cada seccion del carrito y las hojas del catalogo del super que se compran en ella. */
const HOJAS_POR_SECCION: ReadonlyArray<readonly [SeccionDeLista, readonly string[]]> = [
  ['Frutas y verduras', ['fruits', 'vegetables']],
  ['Panaderia', ['bakery']],
  ['Carne y pescado', ['meat', 'fish', 'charcuteria']],
  ['Lacteos', ['dairy']],
  ['Congelados', ['frozen']],
  ['Despensa', ['grains', 'canned', 'spices', 'condiments', 'breakfast', 'snacks', 'sweets']],
  ['Bebidas', ['beverages']],
  [
    'Limpieza e higiene',
    [
      'colada',
      'fregadero',
      'superficies',
      'bano',
      'cabello',
      'corporal',
      'bucal',
      'botiquin',
      'desechables',
      'almacenaje',
      'mantenimiento'
    ]
  ]
];

/** El registro al reves —hoja → seccion—, que es lo que consulta el alta de una linea. */
const SECCION_POR_HOJA: Readonly<Record<string, SeccionDeLista>> = Object.fromEntries(
  HOJAS_POR_SECCION.flatMap(([seccion, hojas]) => hojas.map((hoja) => [hoja, seccion]))
) as Record<string, SeccionDeLista>;

/** La seccion del carrito de una hoja del catalogo; lo desconocido cae en «Otros». */
export function seccionDeLista(hoja: string | null | undefined): SeccionDeLista {
  return (hoja && SECCION_POR_HOJA[hoja]) || 'Otros';
}

export { SECCION_POR_HOJA };
