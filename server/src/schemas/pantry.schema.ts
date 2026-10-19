import { z } from 'zod';
import { formColor, formDefault, formField, formNumber, formPartial, formText, optionalDate, requiredText } from './form.js';

const measurementUnitEnum = z.enum([
  'g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'unit', 'bunch', 'slice', 'piece'
]);

// La categoria de un articulo dejo de ser un enum cerrado en la ## 12x: es la `key` de una fila de
// `pantry_categories`, y la casa puede anadir las suyas. Las doce claves de siempre siguen siendo las
// que nacen con la casa (ver `utils/pantry-categories.ts`), pero lo que se valida aqui es la FORMA de la
// clave; si la clave existe o no lo decide la ruta, con 400 y la lista de las validas en el cuerpo, que
// es la unica manera de que el desplegable del cliente pueda decir algo util.
const pantryCategoryKeySchema = z.string().trim().min(1).max(64);

const storageLocationEnum = z.enum(['fridge', 'freezer', 'pantry', 'counter']);

const utensilCategoryEnum = z.enum([
  'oven', 'microwave', 'airfryer', 'stovetop', 'blender', 'mixer',
  'food-processor', 'cookware', 'bakeware', 'tools'
]);

// Ingredient schemas
export const createIngredientSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  // Clave del catalogo de la casa, no enum: ver el bloque de arriba. Sin categoria = la reserva.
  category: formDefault(pantryCategoryKeySchema, 'other'),
  quantity: z.number().positive('Quantity must be positive'),
  unit: measurementUnitEnum,
  // `formField` alrededor del refine: la caducidad se QUITA vaciando la casilla, y un input de fecha
  // vacio manda `''`, que `Date.parse` leia como fecha invalida (400) en vez de «sin fecha».
  expirationDate: formField(
    z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Fecha no valida')
  ),
  location: formDefault(storageLocationEnum, 'pantry'),
  image: formField(z.string().url()),
  barcode: formField(z.string()),
  notes: formField(z.string().max(500))
});

// `formPartial` y no `.partial()`: ver el contrato en `form-contract.spec.ts` —un PATCH tiene que
// poder escribir `null` para quitar la foto o la nota, y `.partial()` lo rechaza.
// `formPartial` y no `.partial()`: ver el contrato de la ## 12x —un PATCH tiene que
// poder escribir `null` para quitar la foto o la nota, y `.partial()` lo rechaza.
//
// La unica excepcion al `extend` de arriba se llama `quantity`: el alta exige >= 1 (una cantidad vacia
// no es un ingrediente, es una sugerencia), pero el PATCH tiene que poder escribir el 0, que es la
// accion del stepper de la fila en el visor —«bajar a 0 lo devuelve a sugerencias sin borrarlo» (## 12aa)—.
// `formNumber` y no un `min(0)` pelado por coherencia con el alta de `createProductSchema`, que mide igual.
export const updateIngredientSchema = formPartial(createIngredientSchema).extend({
  quantity: formNumber({ min: 0, max: 100000 })
});

/**
 * Un flag pasado por la URL. `z.boolean()` a secas no sirve: la query siempre manda texto, y
 * el `?expiringSoon=true` que manda la pantalla de la despensa reventaba con un ZodError en
 * vez de filtrar — o sea, los dos unicos botones de filtro de la despensa no funcionaban.
 */
/**
 * Flag de consulta: `?expiringSoon=1`, `=true`, o el `''` que deja una URL compartida con el filtro
 * sin valor. El hueco vale «sin filtro», que NO es `false`: con `false` el listado excluye, y un
 * enlace guardado hace un mes no estaba excluyendo nada.
 */
export const queryFlag = z.preprocess(
  (value: unknown) => (value === '' || value === '   ' || value === null ? undefined : value),
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true' || value === '1'))
);

export const ingredientFilterSchema = z.object({
  search: formField(z.string()),
  category: formField(pantryCategoryKeySchema),
  location: formField(storageLocationEnum),
  expiringSoon: queryFlag,
  expired: queryFlag,
  // Los query params llegan como string: hay que coercionarlos.
  page: formDefault(z.coerce.number().int().positive(), 1),
  pageSize: formDefault(z.coerce.number().int().positive().max(100), 20)
});

// ── El gestor de categorias del inventario (HOGARIA-SPEC ## 12x) ──
// `name` es la etiqueta y `key` es el dato que guardan las filas y el prompt: por eso el PATCH no expone
// `key` ni siquiera con otro nombre. El color es `#rrggbb` o nada (formColor), y `parentKey` admite `null`
// para «subir la categoria de nivel», que es lo que el dialogo de colocar necesita poder decir.
export const createPantryCategorySchema = z.object({
  name: requiredText(120, 'nombre'),
  color: formColor(),
  description: formText(280, 'descripcion'),
  parentKey: formField(pantryCategoryKeySchema)
});

export const updatePantryCategorySchema = formPartial(createPantryCategorySchema);

export const pantryCategoryFilterSchema = z.object({
  view: formDefault(z.enum(['all', 'without-products', 'with-children']), 'all'),
  q: formField(z.string().trim().max(80)),
  limit: formDefault(z.coerce.number().int().min(1).max(100), 10),
  offset: formDefault(z.coerce.number().int().min(0), 0)
});

// ── El gestor de productos principales (## 12x) ──
// Un producto principal es una fila de la despensa con `quantity = 0`. No hay tabla nueva porque no hay
// dato nuevo: lo que faltaba era una pantalla para gestionarlos. `quantity` se acepta en el alta (es lo que
// hace que registrar un basico no meta unidades en la despensa) y NO en el PATCH: el stock se mueve desde la
// despensa, con sus motivos de cambio, no desde la ficha del catalogo.
export const createProductSchema = z.object({
  name: requiredText(120, 'nombre'),
  category: formDefault(pantryCategoryKeySchema, 'other'),
  unit: formDefault(z.enum(['g', 'kg', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'unit', 'bunch', 'slice', 'piece']), 'unit'),
  quantity: formDefault(formNumber({ min: 0, max: 100000 }), 0),
  expirationDate: optionalDate('caducidad'),
  notes: formText(500, 'nota'),
  aliases: formField(z.array(z.string().trim().min(1).max(60)).max(20)),
  // La ficha del articulo (## 12ai) edita TODO lo que la fila sabe de si misma en un solo PUT
  // semantico: la ubicacion y el codigo de barras tambien viajan por aqui. `null` en la ubicacion
  // no significa «sin ubicacion» sino la de siempre (despensa), y en el codigo si es «quitar».
  location: formField(storageLocationEnum),
  barcode: formField(z.string().trim().max(32))
});

export const updateProductSchema = formPartial(createProductSchema);

export const productFilterSchema = z.object({
  q: formField(z.string().trim().max(80)),
  category: formField(pantryCategoryKeySchema),
  // `staples` es la pestana con la que abre la pantalla: lo que la casa conoce y no tiene.
  filter: formDefault(z.enum(['all', 'staples', 'in-pantry', 'expiring']), 'all'),
  sort: formDefault(z.enum(['name', 'recent']), 'name'),
  limit: formDefault(z.coerce.number().int().min(1).max(100), 10),
  offset: formDefault(z.coerce.number().int().min(0), 0)
});

export const bulkProductIdsSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, 'Marca al menos un producto').max(100, 'Son demasiados de una vez (100)')
});

// ── El catalogo pre-registrado del super (HOGARIA-SPEC ## 12aa) ──
// `category` es la hoja o el padre del catalogo (no hace falta que exista en la casa: es vocabulario del
// catalogo, no de la casa); los `ids` son la referencia efimera `hoja:indice`, maximo 100 por lote.
export const catalogFilterSchema = z.object({
  q: formField(z.string().trim().max(80)),
  category: formField(pantryCategoryKeySchema),
  limit: formDefault(z.coerce.number().int().min(1).max(100), 24),
  offset: formDefault(z.coerce.number().int().min(0), 0)
});

export const catalogAddSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, 'Marca al menos un producto').max(100, 'Son demasiados de una vez (100)')
});

export const selectProductImageSchema = z.object({
  photoId: z.string().regex(/^[a-f0-9]{24}$/)
}).strict();

export const uploadProductImageSchema = z.object({
  dataUrl: z.string().max(2_900_000)
}).strict();

// Utensil schemas
export const createUtensilSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  category: utensilCategoryEnum,
  available: formDefault(z.boolean(), true),
  notes: formField(z.string().max(500))
});

export const updateUtensilSchema = formPartial(createUtensilSchema);

export const utensilFilterSchema = z.object({
  search: formField(z.string()),
  category: formField(utensilCategoryEnum),
  available: queryFlag
});

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;
export type IngredientFilterInput = z.infer<typeof ingredientFilterSchema>;
export type CreatePantryCategoryInput = z.infer<typeof createPantryCategorySchema>;
export type UpdatePantryCategoryInput = z.infer<typeof updatePantryCategorySchema>;
export type PantryCategoryFilterInput = z.infer<typeof pantryCategoryFilterSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductFilterInput = z.infer<typeof productFilterSchema>;
export type BulkProductIdsInput = z.infer<typeof bulkProductIdsSchema>;
export type CatalogFilterInput = z.infer<typeof catalogFilterSchema>;
export type CatalogAddInput = z.infer<typeof catalogAddSchema>;
export type CreateUtensilInput = z.infer<typeof createUtensilSchema>;
export type UpdateUtensilInput = z.infer<typeof updateUtensilSchema>;
export type UtensilFilterInput = z.infer<typeof utensilFilterSchema>;
