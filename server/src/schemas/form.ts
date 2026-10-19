import { z } from 'zod';

/**
 * Campos de FORMULARIO, con las cuatro formas en que un formulario manda «esto no lo he rellenado».
 *
 * El motivo de que esto exista en vez de usar `z.string().optional()` en cada schema: un input
 * vacio puede llegar ausente, `null`, `''` o `'   '`, segun el control, del binding y de si el
 * campo ya tenia un valor que se ha borrado. `.optional()` acepta la primera y NINGUNA mas, y el
 * resultado es el 400 que vio el usuario en el calendario —«Expected string, received null», un
 * mensaje sobre la forma del JSON, enseñado a alguien que no habia hecho nada malo.
 *
 * Las dos palabras que hay que no perder, porque son las que dan semantica al PATCH:
 *   - **ausente** = no tocar lo que hay;
 *   - **`null` (o vacio)** = borrarlo.
 * Por eso el helper devuelve `null` en lugar de colapsar el vacio a `undefined`: si hiciera eso,
 * «quitar la hora de una comida» no existiria, y de hecho no existia —el frontend mandaba
 * `undefined` y la hora se quedaba puesta para siempre.
 *
 * Un required sigue siendo required: aqui no se afloja nada, se deja de mentir con la palabra
 * «opcional». Los `required` de cada schema se comprueban en `form-contract.spec.ts`, y ese mismo
 * fichero falla si un schema que parsea una ruta se queda sin su fila.
 */

/** `''` y `'   '` son «no hay valor»; lo demas pasa tal cual. */
function blankToNull(value: unknown): unknown {
  return typeof value === 'string' && !value.trim() ? null : value;
}

/** Cadena de formulario con techo de longitud. Sin minimo: vacio = sin valor. */
export function formText(max: number, label = 'campo') {
  return z.preprocess(
    blankToNull,
    z.string().trim().max(max, `${label}: maximo ${max} caracteres`).nullish()
  );
}

/** Cadena obligatoria de formulario: vacio NO es «sin valor», es un error que hay que decir. */
export function requiredText(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label}: hace falta escribir algo`)
    .max(max, `${label}: maximo ${max} caracteres`);
}

/** `HH:MM` en las 24 horas, con la hora en la que se queda el `<input type="time">` vacio. */
export function formTime(label = 'hora') {
  return z.preprocess(
    blankToNull,
    z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label}: usa HH:MM`).nullish()
  );
}

/** `AAAA-MM-DD`. Obligatorio cuando el evento tiene que estar en un día para existir. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export function formDate(label = 'fecha') {
  return z.string().trim().regex(DATE_PATTERN, `${label}: usa AAAA-MM-DD`);
}

/** Fecha de formulario: la puede decidir el servidor (hoy), asi que admite el hueco. */
export function optionalDate(label = 'fecha') {
  return z.preprocess(blankToNull, z.string().trim().regex(DATE_PATTERN, `${label}: usa AAAA-MM-DD`).nullish());
}

/** `#rrggbb`, y `null` para «el color de mi capa», que es el caso normal. */
export function formColor() {
  return z.preprocess(
    blankToNull,
    z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color: usa #rrggbb').nullish()
  );
}

/** URL, pero el campo puede estar vacio por contrato (un perfil sin foto, una base de URL heredada). */
export function formUrl(label = 'URL') {
  return z.preprocess(blankToNull, z.string().trim().url(`${label}: no parece una URL`).nullish());
}

/**
 * Número de `<input type="number">`: ngModel manda `null` al vaciarlo, y un text input mandaria
 * `'7'`. `z.coerce.number()` con `''` habia dado `0`, y `0` en calorias no es «sin valor»: es un
 * día de cero calorias, que es peor que un error.
 */
export function formNumber(input: { int?: boolean; positive?: boolean; min?: number; max?: number } = {}) {
  let inner: z.ZodNumber = z.coerce.number();
  if (input.int) inner = inner.int('Numero entero');
  if (input.positive) inner = inner.positive('Tiene que ser mayor que cero');
  if (input.min !== undefined) inner = inner.min(input.min);
  if (input.max !== undefined) inner = inner.max(input.max);
  return z.preprocess(blankToNull, inner.nullish());
}

/**
 * Convierte un schema de campo en campo de formulario SIN tocar sus reglas: lo único que añade es la
 * tolerancia a las formas del hueco (`undefined`, `null`, `''`, `'   '`) y la conversion de vacio en
 * `null`. Por eso existe: reescribir 200 campos a `formText(...)` es una reforma que no pide nadie
 * para conseguir la misma garantia, y además toca schemas que no tienen por que cambiar.
 *
 * Los `.default(x)` necesitan su propia funcion, `formDefault`, porque envolver un campo con defecto
 * en `nullish()` SE LO COME: ZodOptional corta antes de llamar al interior y el valor por defecto
 * deja de aplicarse —un bug peor que el que venimos a arreglar, y silencioso.
 */
export function formField<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess(blankToNull, inner.nullish());
}

/** Como `formField`, pero el hueco cae en el valor por defecto del campo. */
export function formDefault<T extends z.ZodTypeAny>(inner: T, fallback: unknown) {
  return z.preprocess(
    (value: unknown) =>
      value === undefined || value === null || (typeof value === 'string' && !value.trim()) ? fallback : value,
    inner
  );
}

/**
 * La forma normal de un PATCH de formulario: «todos los campos opcionales, y todos tolerantes con el
 * hueco». Sustituye a `create.partial()`, que hace lo primero pero no lo segundo —y lo segundo es
 * justamente poder QUITAR un valor: `recipeId: null` en una comida tiene que significar «quita la
 * receta», no un 400.
 */
export function formPartial<T extends z.ZodObject<z.ZodRawShape>>(object: T) {
  const shape = object.shape as Readonly<Record<string, z.ZodTypeAny>>;
  // `z.object` quiere un shape mutable, y `.shape` es readonly: el cast es del tipado de zod, no de
  // lo que hay dentro —cada valor se construye aqui.
  const next: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(shape)) next[key] = z.preprocess(blankToNull, shape[key].nullish());
  return z.object(next as z.ZodRawShape);
}

/**
 * Un booleano que llega de una casilla, de la URL como `'true'`/`'1'`, o de un cliente que habla en
 * 0/1 porque las columnas de SQLite son INTEGER. El `union` de antes con `z.coerce.number()` hacia
 * ese último caso a mano en cada schema; aqui se hace una vez, y `flag()` lo escribe en la columna.
 */
export function formBool() {
  return z.preprocess(
    (value: unknown) => {
      if (value === true || value === 1 || value === '1' || value === 'true') return true;
      if (value === false || value === 0 || value === '0' || value === 'false') return false;
      return blankToNull(value);
    },
    z.union([z.boolean(), z.null()]).nullish()
  );
}

/**
 * Lista de formulario que NO distingue «vacia» de «sin valor»: siempre sale un array. Para lo que
 * se guarda como JSON y se lee esperando una lista (los objetivos y sus restricciones), donde un
 * `null` persistido seria una bomba de relojeria en el primer `.map()` del frontend.
 */
export function formArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(blankToNull, z.array(item).nullish().transform((value) => value ?? []));
}

/**
 * Lista de formulario: `null` y ausencia valen «vacia», no «no tocar» —salvo en un PATCH, donde el
 * route mira `input.x !== undefined` antes de escribir, y aqui `undefined` se conserva tal cual.
 */
export function formList<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(blankToNull, z.array(item).nullable().optional());
}

/**
 * Los motivos de zod, en una frase para una persona. Sin esto el 400 decia «Invalid input» o el
 * primer mensaje en ingles del issue, y quien rellena el formulario no sabe a que campo volver.
 */
export function describeIssues(error: z.ZodError): { message: string; issues: { field: string; message: string }[] } {
  const issues = error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : '',
    // Los mensajes de los helpers de arriba ya estan en espanol; solo se traducen los que zod
    // pone por su cuenta (los de `.min()`/`.max()` sin mensaje propio y los de tipo).
    message: translate(issue.message)
  }));
  const first = issues[0];
  return {
    message: first ? (first.field ? `${first.field}: ${first.message}` : first.message) : 'Datos invalidos',
    issues
  };
}

const TRANSLATIONS: [RegExp, string][] = [
  [/Invalid input/, 'el valor no es del tipo esperado'],
  [/expected string, received null/i, 'esta vacio cuando no deberia estarlo'],
  [/expected string, received undefined/i, 'falta'],
  [/expected number, received NaN/, 'no es un numero'],
  [/Too small/, 'demasiado corto'],
  [/Too big/, 'demasiado largo'],
  [/Invalid email/, 'el correo no tiene formato valido'],
  [/unrecognized_keys/i, 'hay campos que no van aqui']
];

function translate(message: string): string {
  for (const [pattern, replacement] of TRANSLATIONS) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  return message;
}
