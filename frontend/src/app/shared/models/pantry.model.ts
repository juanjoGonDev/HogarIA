export interface Ingredient {
  id: string;
  name: string;
  // Desde la ## 12x esto es una clave del catalogo de la casa, no las doce palabras del codigo: la casa puede
  // anadir las suyas desde el gestor. `IngredientCategory` se queda como el tipo de las de fabrica (las que
  // nacen con la casa y las que tienen etiqueta traducida), y `PantryCategoryKey` es lo que viaja por la red.
  category: PantryCategoryKey;
  quantity: number;
  unit: MeasurementUnit;
  expirationDate?: Date;
  location: StorageLocation;
  image?: string;
  barcode?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IngredientCategory =
  | 'dairy'
  | 'meat'
  | 'fish'
  | 'vegetables'
  | 'fruits'
  | 'grains'
  | 'spices'
  | 'condiments'
  | 'frozen'
  | 'canned'
  | 'beverages'
  | 'other';

/** Lo que guarda la fila y lo que entiende el prompt: una clave, no una etiqueta. */
export type PantryCategoryKey = string;

/** Una fila del catalogo de categorias de la casa (HOGARIA-SPEC ## 12x). */
export interface PantryCategory {
  id: string;
  key: string;
  /** El dato que escribe la persona. Se pinta tal cual; la traduccion es solo para las de fabrica. */
  name: string;
  color: string;
  description: string | null;
  parentKey: string | null;
  parentName: string | null;
  position: number;
  createdAt?: string;
  updatedAt?: string;
  counts: { products: number; children: number; descendantProducts: number };
  /** La reserva: se puede pintar y anotar, no renombrar, mover ni borrar. */
  protected: boolean;
  canDelete: boolean;
}

export interface PantryCategoryInput {
  name: string;
  color?: string | null;
  description?: string | null;
  /** `null` sube la categoria de nivel; ausente deja el padre como estaba. */
  parentKey?: string | null;
}

export type PantryCategoryView = 'all' | 'without-products' | 'with-children';

export interface PantryCategoryListResult {
  data: PantryCategory[];
  meta: { total: number; limit: number; offset: number };
  hasMore: boolean;
}

/** Un producto principal: una fila de la despensa con `quantity = 0` (lo que la casa conoce y no tiene). */
export interface PantryProduct {
  id: string;
  name: string;
  category: PantryCategoryKey;
  categoryKey: PantryCategoryKey;
  categoryName: string;
  quantity: number;
  unit: MeasurementUnit;
  inPantry: boolean;
  expirationDate: string | null;
  location: StorageLocation;
  image?: string | null;
  barcode: string | null;
  notes: string | null;
  /** Como llama la familia a esto. Sirve para buscar y para pintar la ficha; nada mas. */
  aliases: string[];
  createdAt: string;
  updatedAt: string;
  impact: { listLines: number; priceObservations: number };
}

export interface ProductImageCandidate {
  id: string;
  altText: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  previewUrl: string;
}

export interface ProductImageSearchView {
  status: 'idle' | 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  jobId: string | null;
  candidates: ProductImageCandidate[];
  errorCode: string | null;
}

export interface PantryProductInput {
  name: string;
  category?: PantryCategoryKey;
  unit?: MeasurementUnit;
  quantity?: number;
  expirationDate?: string | null;
  notes?: string | null;
  aliases?: string[] | null;
  /** La ficha del articulo (## 12ai) edita tambien donde vive y su codigo de barras. */
  location?: StorageLocation | null;
  barcode?: string | null;
}

/**
 * El catalogo pre-registrado del super (## 12aa). Es dato de fabrica: no vive en ninguna tabla y su `id`
 * (`hoja:indice`) es una referencia efimera —lo que se guarda en la casa al anadir es el nombre, la unidad y
 * la categoria—.
 */
export interface PantryCatalogCategory {
  key: string;
  name: string;
  color: string;
  /** `null` = padre de seis; lo demas cuelga de uno. */
  parent: string | null;
  productCount: number;
}

export interface PantryCatalogProduct {
  id: string;
  name: string;
  unit: MeasurementUnit;
  category: string;
  /** La etiqueta del pasillo, en el vocabulario del catalogo (no de la casa). */
  categoryLabel: string;
  /** Si ese nombre ya es un producto de la casa (clave `productKeyOf`, no un parecidos). */
  inHousehold: boolean;
}

export interface PantryCatalogQuery {
  q?: string;
  /** Hoja o padre; con padre, el server responde el subarbol. */
  category?: string;
  limit?: number;
  offset?: number;
}

export interface PantryCatalogListResult {
  data: PantryCatalogProduct[];
  meta: { total: number; limit: number; offset: number };
  hasMore: boolean;
}

export interface PantryCatalogAddResult {
  added: number;
  skipped: number;
  categoriesCreated: number;
}

export type PantryProductFilter = 'all' | 'staples' | 'in-pantry' | 'expiring';
export type PantryProductSort = 'name' | 'recent';

export interface PantryProductQuery {
  q?: string;
  category?: PantryCategoryKey;
  filter?: PantryProductFilter;
  sort?: PantryProductSort;
  limit?: number;
  offset?: number;
}

export interface PantryProductListResult {
  data: PantryProduct[];
  meta: { total: number; limit: number; offset: number };
  hasMore: boolean;
}

export interface PantryProductImpact {
  id: string;
  name: string;
  quantity: number;
  listLines: number;
  priceObservations: number;
  canDelete: boolean;
}

export interface PantryCategoryImpact {
  products: number;
  children: number;
  descendantCategories: number;
  descendantProducts: number;
  protected: boolean;
  canDelete: boolean;
}

export interface PantryBulkImpact {
  requestedCount: number;
  deletableIds: string[];
  blocked: PantryProductImpact[];
  canDelete: boolean;
}

/**
 * Lo que devuelve una peticion del gestor. El `ok:false` conserva `status` y `details` a proposito: un 409 de
 * borrado bloqueado trae el recuento, y si el servicio lo colapsara a `null` la pantalla tendria que decir «no
 * se puede» en vez de «42 articulos y 3 subcategorias», que es justo para lo que existe ese cuerpo.
 */
export type PantryRequest<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; details?: unknown };

export type MeasurementUnit =
  | 'g' | 'kg' | 'ml' | 'l'
  | 'cup' | 'tbsp' | 'tsp'
  | 'unit' | 'bunch' | 'slice' | 'piece';

export type StorageLocation = 'fridge' | 'freezer' | 'pantry' | 'counter';

export interface Utensil {
  id: string;
  name: string;
  category: UtensilCategory;
  available: boolean;
  notes?: string;
}

export type UtensilCategory =
  | 'oven'
  | 'microwave'
  | 'airfryer'
  | 'stovetop'
  | 'blender'
  | 'mixer'
  | 'food-processor'
  | 'cookware'
  | 'bakeware'
  | 'tools';

export interface PantryFilter {
  search?: string;
  category?: PantryCategoryKey;
  location?: StorageLocation;
  expiringSoon?: boolean;
  expired?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PantryStats {
  totalItems: number;
  expiringSoon: number;
  expired: number;
  byCategory: Record<IngredientCategory, number>;
  byLocation: Record<StorageLocation, number>;
}

// Las etiquetas de categoria, ubicacion y utensilio ya no estan aqui: eran un `Record<..., string>` en
// espanol que ningun componente leia, y el texto que si se ensena vive en los catalogos de la
// pantalla con su `labelKey` (HOGARIA-SPEC ## 12u).

// Input types for API operations
export interface CreateIngredientInput {
  name: string;
  category: PantryCategoryKey;
  quantity: number;
  unit: MeasurementUnit;
  expirationDate?: Date | string;
  location: StorageLocation;
  image?: string;
  barcode?: string;
  notes?: string;
}

export interface UpdateIngredientInput {
  name?: string;
  category?: PantryCategoryKey;
  quantity?: number;
  unit?: MeasurementUnit;
  expirationDate?: Date | string;
  location?: StorageLocation;
  image?: string;
  barcode?: string;
  notes?: string;
}

export interface CreateUtensilInput {
  name: string;
  category: UtensilCategory;
  available?: boolean;
  notes?: string;
}

export interface UpdateUtensilInput {
  name?: string;
  category?: UtensilCategory;
  available?: boolean;
  notes?: string;
}
