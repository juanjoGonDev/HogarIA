import { z } from 'zod';
import { formColor, formDefault, formField } from './form.js';

/**
 * Contrato de la lista de la compra y de los precios.
 *
 * El dinero es SIEMPRE enteros en centimos (`*_minor`): un float de 0.1 + 0.2
 * no vale para sumar una cesta. Las cantidades si son reales, porque medio kilo
 * es una cantidad legitima; lo que no se admite es que una cantidad o un precio
 * entren negativos o a cero — un precio 0 no es «gratis», es «sin dato», y para
 * eso existe `null`.
 */

export const LIST_STATUSES = ['active', 'archived', 'done'] as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** Cantidad: > 0 y con techo razonable (un pedido de 1e6 unidades es un bug). */
const quantity = z.coerce.number().positive().max(10000);

/** Precio en centimos. `null` explicito = «quiero borrar el precio de la linea». */
const priceMinor = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(0).max(100_000_000).nullable().optional()
);

/**
 * `z.coerce.boolean()` no vale aqui: convierte la cadena 'false' en true (cualquier
 * string no vacia es truthy), y el check de una linea llega por query/body como
 * string segun quien llame. Se listan las formas honestas y se traduce: booleano,
 * el 0/1 entero que la propia API devuelve al leer la fila, y las cadenas.
 *
 * El 0/1 entra a proposito: una app movil pinta lo que leyo, y si reenvia lo que
 * leyo debe poder marcar la casilla sin un translator en medio. Un 2, en cambio,
 * sigue siendo un error de datos, no un «true» generico.
 */
export const booleanish = z
  .union([
    z.boolean(),
    z.number().int().min(0).max(1),
    z.enum(['0', '1', 'true', 'false', 'on', 'off'])
  ])
  .transform(
    (value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on'
  );

const pageSize = z.coerce.number().int().min(1).max(200).catch(50);
const offset = z.coerce.number().int().min(0).max(100000).catch(0);

/**
 * Filtro de la bandeja. Se filtra AQUI y no en la pantalla porque una casa con
 * noventa listas archivadas no debe descargarse noventa listas para ocultar
 * ochenta y nueve, y porque la URL es el estado: compartir «las de Mercadona de
 * marzo con mas de 30 €» es compartir un enlace que funciona.
 *
 * Las fechas son `YYYY-MM-DD` y comparan contra `updated_at` (lo que se toco, no lo
 * que se fundo). `minTotalMinor` esta en centimos, como todo el dinero del contrato:
 * el euro con coma lo entiende el teclado, no la BD.
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Se espera una fecha AAAA-MM-DD');

export const listFilterSchema = z.object({
  // `all` es del filtro de la bandeja («ver todas»). No es un estado: si se tratara
  // como uno, la consulta pediria `status = 'all'` y la pantalla saldria vacia —que es
  // exactamente como se manifesto el bug.
  status: formField(z.enum([...LIST_STATUSES, 'all'] as const)),
  q: formField(z.string().trim().max(120)),
  store: formField(z.string().trim().max(80)),
  minTotalMinor: formField(z.coerce.number().int().min(0).max(100_000_000)),
  from: formField(isoDate),
  to: formField(isoDate),
  sort: formDefault(z.enum(['updated', 'name', 'total', 'lines']), 'updated'),
  dir: formDefault(z.enum(['asc', 'desc']), 'desc'),
  limit: pageSize,
  offset
});

/**
 * Una seccion es un nombre y un color. El color se valida aqui y no «se ve luego»:
 * un `color: 'rojo'` guardado tal cual pinta un texto en la hoja de estilos y la
 * fila sale sin color, que es un bug silencioso. `#rrggbb` o nada.
 */
export const createCategorySchema = z.object({
  name: trimmed(60),
  // `formColor()` en vez del regex a mano: una seccion puede quedarse sin color, y «sin color» es la
  // cadena vacia del selector, no un hexadecimal invalido.
  color: formColor()
});

/**
 * La oferta de una linea: «cada `buy`, pagas `take`» (3×2, 2×1, 6×5). `take >= buy`
 * no es una oferta — se pagaria todo —: la normalizacion (eso pasa a `null`) vive en
 * `utils/list-discount.ts`, no aqui, porque el schema tambien describe la entrada de
 * quien escribe una fila a mano y un `.transform()` volveria obligatoria la clave.
 */
export const offerInput = z
  .object({
    buy: z.coerce.number().int().min(2).max(1000),
    take: z.coerce.number().int().min(1).max(999)
  })
  .nullable()
  .optional();

/**
 * El descuento de UNA linea (§12h): porcentaje o importe, sobre todas las unidades pagadas o
 * sobre las N primeras. Se guarda en la fila y no en la lista porque el cartel del pasillo
 * habla del producto («segunda unidad a mitad de precio»), y porque dos lineas con descuentos
 * distintos dentro de la misma cesta es lo normal en una tienda real.
 */
export const lineDiscountInput = z
  .object({
    kind: z.enum(['amount', 'percent']),
    valueMinor: formField(z.coerce.number().int().min(1).max(100_000_000)),
    percentBps: formField(z.coerce.number().int().min(1).max(10_000)),
    units: formField(z.coerce.number().positive().max(100_000))
  })
  .refine(
    (value) =>
      value.kind === 'amount' ? (value.valueMinor ?? 0) > 0 : (value.percentBps ?? 0) > 0,
    {
      message: 'LineDiscountValueRequired'
    }
  )
  .nullable();

/**
 * El descuento de la lista. Dos unidades distintas a proposito: euros (centimos
 * enteros) o porcentaje en puntos porcentuales (12,5 % son 1250), porque un float
 * de porcentaje redondea sitios distintos que una resta de centimos. `scope` decide
 * si se aplica a toda la cesta o solo a las primeras N unidades pagadas — «2 € en
 * las 3 primeras cervezas» —, y ahi el minimo importa: si no llegan a N, no hay
 * descuento, que es lo que dice el cartel del pasillo.
 */
export const discountSchema = z
  .object({
    kind: z.enum(['amount', 'percent']),
    valueMinor: formField(z.coerce.number().int().min(0).max(100_000_000)),
    percentBps: formField(z.coerce.number().int().min(0).max(10_000)),
    scope: formDefault(z.enum(['all', 'firstUnits', 'product', 'category']), 'all'),
    firstUnits: formField(z.coerce.number().positive().max(100_000)),
    // A que producto o seccion se aplica. Se guarda tal cual (nombre legible) y se compara
    // normalizado: ver «Jamón Serrano» en la pantalla es mas util que ver una clave.
    target: formField(z.string().trim().max(80)),
    /**
     * Las demas dianas del mismo cartel. Un «-2 € en jamon, queso y pan» real son tres
     * lineas bajo UNA promocion, no tres descuentos: guardados aparte, el tercer producto
     * se comeria un recorte que la caja ya aplico dos veces.
     */
    targets: formField(z.array(z.string().trim().min(1).max(80)).max(50)),
    label: formField(z.string().trim().max(60))
  })
  .refine(
    (value) =>
      value.kind === 'amount' ? (value.valueMinor ?? 0) > 0 : (value.percentBps ?? 0) > 0,
    {
      message: 'DiscountValueRequired'
    }
  )
  .refine((value) => value.scope !== 'firstUnits' || (value.firstUnits ?? 0) > 0, {
    message: 'FirstUnitsRequired'
  })
  .refine(
    (value) =>
      value.scope !== 'product' && value.scope !== 'category'
        ? true
        : !!value.target?.trim() || (value.targets?.length ?? 0) > 0,
    { message: 'DiscountTargetRequired' }
  );

export const createListSchema = z.object({
  name: trimmed(80),
  store: formField(z.string().trim().max(80))
});

/**
 * La lista sugerida (## 12al) no es un formulario: el cuerpo es todo opcional y lo unico que
 * acepta es el nombre con el que la casa quiere verla (el frontend lo manda traducido). Sin
 * cuerpo tambien vale: el server pone «Lista sugerida».
 */
export const createSuggestedListSchema = z.object({
  name: formField(trimmed(80))
});

/**
 * `version` es el CAS: la app guarda en local y el movil puede estar horas sin
 * red, asi que la unica forma de no pisar lo que otra persona del hogar marco es
 * decir sobre que version se esta escribiendo. Los items no la exigen: marcar una
 * casilla es conmutativo y un conflicto ahi se resuelve solo (ver el comentario
 * en PATCH /lists/:id/items/:itemId).
 */
export const updateListSchema = z
  .object({
    name: formField(trimmed(80)),
    store: formField(z.string().trim().max(80)),
    status: formField(z.enum(LIST_STATUSES)),
    version: z.coerce.number().int().positive()
  })
  .refine(
    (value) => value.name !== undefined || value.store !== undefined || value.status !== undefined,
    {
      message: 'NothingToUpdate'
    }
  );

/** Narrow CAS contract for the reviewed global assistant; normal list editing stays unchanged. */
export const assistantUpdateListSchema = z
  .object({
    version: z.number().int().positive(),
    changes: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        store: z.string().trim().min(1).max(80).nullable().optional()
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0, {
        message: 'NothingToUpdate'
      }),
    assistantAction: z
      .object({
        operation: z.literal('update_list'),
        targetId: z.string().trim().min(1).max(128),
        before: z
          .object({
            name: z.string().min(1).max(80),
            store: z.string().max(80).nullable()
          })
          .strict()
      })
      .strict()
  })
  .strict();

/** Narrow, optimistic-concurrency contract for an explicitly reviewed assistant item edit. */
export const assistantUpdateItemSchema = z
  .object({
    version: z.number().int().positive(),
    changes: z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        quantity: z.number().finite().positive().max(10000).optional(),
        unit: z
          .string()
          .trim()
          .max(48)
          .transform((value) => (value === '' ? null : value))
          .nullable()
          .optional(),
        category: z
          .string()
          .trim()
          .max(48)
          .transform((value) => (value === '' ? null : value))
          .nullable()
          .optional()
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0, {
        message: 'NothingToUpdate'
      }),
    assistantAction: z
      .object({
        operation: z.literal('update_item'),
        targetId: z.string().trim().min(1).max(128),
        listId: z.string().trim().min(1).max(128),
        before: z
          .object({
            listName: z.string().min(1).max(80),
            name: z.string().min(1).max(200),
            productKey: z.string().max(3000),
            quantity: z.number().finite().positive().max(10000),
            unit: z.string().max(48).nullable(),
            category: z.string().max(48).nullable(),
            checked: z.literal(false),
            deletedAt: z.null(),
            updatedAt: z.string().max(80).nullable()
          })
          .strict()
      })
      .strict()
  })
  .strict();

export const createItemSchema = z.object({
  name: z.string().trim().min(1),
  quantity: formField(quantity),
  unit: formField(z.string().trim()),
  category: formField(z.string().trim().max(48)),
  priceMinor: priceMinor,
  note: formField(z.string().trim()),
  offer: offerInput,
  discount: formField(lineDiscountInput)
});

export const updateItemSchema = z
  .object({
    name: formField(z.string().trim().min(1)),
    quantity: formField(quantity),
    unit: formField(z.string().trim()),
    category: formField(z.string().trim().max(48)),
    checked: formField(booleanish),
    priceMinor: priceMinor,
    note: formField(z.string().trim()),
    offer: offerInput,
    /** `null` quita el descuento de la linea (no «no tocar»). */
    discount: formField(lineDiscountInput),
    /**
     * Enlazar la linea con un producto que la casa ya conoce. Existe porque en la tienda
     * el mismo producto se llama de otra forma («Leche semi» en el carrito, «Leche
     * semidesnatada» en el ticket de hace dos semanas) y sin enlace esa busqueda de precio
     * no encuentra nada. `null` lo quita y la clave vuelve a ser la del nombre.
     */
    productKey: formField(z.string().trim().min(2).max(80))
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.quantity !== undefined ||
      value.unit !== undefined ||
      value.category !== undefined ||
      value.checked !== undefined ||
      value.priceMinor !== undefined ||
      value.note !== undefined ||
      value.offer !== undefined ||
      value.discount !== undefined ||
      value.productKey !== undefined,
    { message: 'NothingToUpdate' }
  );

/** Pegado desde otro sitio: `lines` es texto con una linea por producto. */
export const bulkItemsSchema = z
  .object({
    lines: z.string().max(20000),
    items: formField(z.array(createItemSchema).max(200))
  })
  .refine((value) => value.lines.trim().length > 0 || (value.items?.length ?? 0) > 0, {
    message: 'NothingToAdd'
  });

export const orderSchema = z.object({
  itemIds: z.array(z.string()).max(500),
  version: z.coerce.number().int().positive()
});

/**
 * Cerrar la compra. `prices` es OPCIONAL a proposito: si la pantalla ya tenia los
 * precios escritos, el cierre solo cierra; si no, escribe y cierra en la misma
 * transaccion, que es lo que impide el «marque comprado, se me fue el metro y la
 * lista quedo a medias». Un precio sin establecimiento no se acepta: `price_observations`
 * sin tienda no se puede volver a usar en la proxima lista de ese sitio.
 */
export const completeListSchema = z.object({
  store: formField(z.string().trim().max(80)),
  prices: formField(
    z
      .array(
        z
          .object({
            itemId: trimmed(40),
            /** Precio POR UNIDAD, la misma unidad que guarda la linea. */
            priceMinor: formField(z.coerce.number().int().min(0).max(100_000_000)),
            /**
             * Lo pagado en total, tal y como lo dice el ticket. Con esto no hay que hacer la
             * division a mano —y la division mal hecha es como una oferta 3x2 acaba enseñando
             * a la app un precio por unidad un 33 % mas barato del real.
             */
            totalPaidMinor: formField(z.coerce.number().int().min(1).max(100_000_000)),
            /** Unidades que realmente se llevaron (por defecto, las pagadas de la linea). */
            quantity: formField(z.coerce.number().positive().max(10000)),
            store: formField(z.string().trim().max(80)),
            /** Como se llamaba en esa tienda. Se anota en la observacion, no en la linea. */
            productName: formField(z.string().trim().max(120))
          })
          .refine((value) => value.priceMinor != null || value.totalPaidMinor != null, {
            message: 'PriceValueRequired'
          })
      )
      .max(500)
  )
});

export const priceFilterSchema = z.object({
  q: formField(z.string().trim().max(120)),
  /** Los precios de una tienda concreta («cuanto cuesta aqui la leche»). */
  store: formField(z.string().trim().max(80)),
  productKey: formField(z.string().trim().max(80)),
  limit: pageSize,
  offset
});

/** Indice de productos conocidos, para enlazar una linea y para el buscador de precios. */
export const productIndexSchema = z.object({
  q: formField(z.string().trim().max(120)),
  limit: formDefault(z.coerce.number().int().min(1).max(500), 200)
});

export const createPriceSchema = z.object({
  productName: trimmed(120),
  priceMinor: z.coerce.number().int().min(1).max(100_000_000),
  quantity: formField(quantity),
  unit: formField(z.string().trim().max(24)),
  store: formField(z.string().trim().max(80))
});

/**
 * Una linea pegada tipo `2 Leche semidesnatada` o `1,5 kg tomate de colgar`.
 * Se parsea aqui y no en la UI: el mismo texto puede llegar del portapapeles,
 * del asistente de voz o de un `POST /items/bulk`, y los tres tienen que
 * entenderse igual.
 */
export function parseItemLine(line: string): z.infer<typeof createItemSchema> | null {
  const clean = line
    .replace(/^\s*(?:[-*•]|\d+[).])\s+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;

  const match =
    /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|ud|uds|unidades?|pack|bote|botella)?\s+(.+)$/i.exec(clean);
  if (!match) return { name: clean.slice(0, 120) };

  const [, rawQuantity, rawUnit, rest] = match;
  const parsed = Number.parseFloat(rawQuantity.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed <= 0) return { name: clean.slice(0, 120) };

  return {
    name: rest.slice(0, 120),
    quantity: Math.min(parsed, 10000),
    unit: (rawUnit ?? null) as string | null
  };
}

/**
 * Entrada por foto (§8f). Se separa en dos llamadas — analizar y aplicar — porque un
 * modelo que lee mal una estanteria no puede reescribir la cesta de la casa: lo que
 * sale del modelo se valida, se ensena, y solo se escribe lo que alguien confirmo.
 */
export const photoAnalyzeSchema = z.object({
  /** Data URL. Se acepta png/jpeg/webp, que es lo que produce una camara de movil. */
  image: z
    .string()
    .min(64, 'La imagen llega vacia')
    .max(8_000_000, 'La imagen es demasiado grande')
    .regex(
      /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/,
      'Se espera una imagen en dataURL (png, jpeg o webp)'
    ),
  mode: formDefault(z.enum(['auto', 'ticket', 'shelf']), 'auto'),
  note: formField(z.string().trim())
});

/** Lo que se le PIDE al modelo. Se valida su respuesta con esto y con nada mas. */
export const photoLinesSchema = z.object({
  lines: z
    .array(
      z
        .object({
          name: z.string().trim().min(1),
          quantity: formDefault(z.coerce.number().positive().max(10000), 1),
          unit: formField(z.string().trim()),
          category: formField(z.string().trim().max(48)),
          /** Se propone una seccion nueva: solo se crea si quien confirma lo pide. */
          createCategory: formField(z.boolean()),
          priceMinor: formField(z.coerce.number().int().min(0).max(100_000_000)),
          offer: offerInput,
          confidence: formDefault(z.coerce.number().min(0).max(1), 0.5),
          note: formField(z.string().trim())
        })
        // Un nombre vacio no es una linea: es el modelo rellenando huecos.
        .refine((line) => line.name.trim().length > 1, { message: 'NombreVacio' })
    )
    .max(200),
  currency: formField(z.enum(['EUR', 'eur'])),
  warnings: formField(z.array(z.string().trim()).max(20))
});

/** Lo que la persona confirmo, en la forma que escribe la BD. */
export const applyLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        quantity: formField(quantity),
        unit: formField(z.string().trim()),
        category: formField(z.string().trim().max(48)),
        createCategory: formField(z.boolean()),
        priceMinor: priceMinor,
        note: formField(z.string().trim()),
        offer: offerInput
      })
    )
    .min(1, 'No hay ninguna linea que anadir')
    .max(200)
});

export type PhotoAnalyzeInput = z.infer<typeof photoAnalyzeSchema>;
export type PhotoLines = z.infer<typeof photoLinesSchema>;
export type ApplyLinesInput = z.infer<typeof applyLinesSchema>;

export type ListFilter = z.infer<typeof listFilterSchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
