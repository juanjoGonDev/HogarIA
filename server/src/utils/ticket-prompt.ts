/**
 * El prompt de la lectura de tickets (HOGARIA-SPEC ## 12aj), aparte de la ruta por las mismas
 * razones que `photo-prompt.ts`: se puede leer entero sin buscarlo entre un `try` y un `INSERT`,
 * y se puede probar que menciona lo que tiene que mencionar (el fichero de inventario adjunto,
 * los centimos, la tienda, el «no inventes») sin montar un proveedor de IA.
 *
 * Cada llamada incluye una instantanea JSON generada desde la base actual del hogar con tiendas,
 * categorias de despensa y productos catalogados en un fichero independiente —asi usa la categoria
 * vigente y evita proponer como nuevos productos o categorias que ya estan registrados.
 */

import { aiLocalizedFieldsInstruction, type AiOutputLanguage } from './ai-output-language.js';

export const TICKET_SHAPE = `{
  "store": "Mercadona",
  "storeAddress": "Avenida de Ejemplo 10, 04007 Almería",
  "purchaseDate": "2024-05-10",
  "lines": [
    {
      "name": "Leche semidesnatada 1,5L",
      "quantity": 2,
      "unit": "ud",
      "category": "dairy",
      "createCategory": false,
      "priceMinor": 195,
      "offer": null,
      "discount": { "kind": "percent", "percentBps": 1000, "units": 1 },
      "confidence": 0.95,
      "note": ""
    }
  ],
  "currency": "EUR",
  "totalMinor": 390,
  "warnings": []
}`;

/** La forma del «inventario.json» que viaja con cada ticket. */
export interface InventarioParaPrompt {
  tiendas: string[];
  categorias: { clave: string; nombre: string; padre: string | null }[];
  productos: { categoria: string; nombre: string; unidad: string }[];
}

export function buildInventarioJson(inventario: InventarioParaPrompt): string {
  // El fichero se adjunta tal cual; no incluir existencias, precios ni historial de compra.
  return JSON.stringify(inventario);
}

export function buildTicketPrompt(input: { esPdf: boolean; language?: AiOutputLanguage }): {
  system: string;
  user: string;
} {
  const categoryLanguage =
    input.language === 'en'
      ? 'When proposing a new category, use a short, human-readable label in UK English, not a key or slug.'
      : 'Al proponer una categoria nueva, usa un nombre breve y legible en español de España, no una clave ni un slug.';
  const categoryExamples =
    input.language === 'en'
      ? 'Group hygiene, aloe gel, moisturiser and toothpaste under `Personal care`; detergent, bleach and fabric softener under `Household cleaning`; paper rolls, toilet paper, tissues and napkins under `Household paper and disposables`.'
      : 'higiene, aloe, crema, dentifrico y cuidado personal van juntos en `Cuidado personal`; detergente, lejia, suavizante y limpieza van en `Limpieza del hogar`; rollos de papel, papel higienico, pañuelos y servilletas van en `Papel y desechables`.';
  const system = [
    'Eres el lector de tickets de compra de una casa. Tu salida es UN objeto JSON y nada mas: sin markdown, sin prosa antes ni despues, sin comentarios.',
    'Reglas que no se pueden romper:',
    '1. El dinero va en CENTIMOS ENTEROS en `priceMinor` y `totalMinor` (1,95 EUR son 195). Nunca escribas un precio con coma ni con simbolo.',
    '2. El importe de cada linea del ticket es lo PAGADO por esa cantidad, no el precio por unidad: si la linea dice «2 x 1,10», son 2 unidades y priceMinor 220.',
    '3. NO inventes precios. Si el numero no se lee, `priceMinor` es null y lo dices en `warnings`. Una estimacion tuya acabaria en el historial de precios de la casa como si fuera un dato real.',
    '4. `store` es la tienda de la cabecera del ticket (el nombre del establecimiento, no su CIF ni su direccion). `storeAddress` es solo la direccion literal visible en el ticket; si no se distingue, ambos son null. No inventes coordenadas ni devuelvas latitud/longitud.',
    '5. `purchaseDate` es la fecha impresa de compra en formato `YYYY-MM-DD`. Si falta, no se lee o es ambigua, `purchaseDate` es null. Nunca uses la fecha de subida ni `created_at` como fecha de compra.',
    `6. Cada linea legible debe tener una \`category\` no vacia y \`createCategory\` booleano; nunca los devuelvas como null. Busca primero el producto registrado y usa su categoria vigente, con \`createCategory: false\`; si no hay producto, reutiliza la categoria mas adecuada del catalogo y devuelve su clave exacta, tambien con \`createCategory: false\`. No uses \`other\` como cajon para productos que si se pueden clasificar: ${categoryExamples} Si falta una categoria util para una familia reconocible y reutilizable, devuelve su nombre como \`category\` y \`createCategory: true\`; el servidor derivara la clave y creara/reutilizara la categoria. Usa \`other\` solo si el producto es realmente inclasificable.`,
    categoryLanguage,
    '7. `quantity` es cuantas unidades se llevan; `unit` la unidad corta (ud, kg, g, l, ml, pack, lata, botella, caja). Las ofertas tipo «3x2» van en `offer`. Un descuento directo legible va en `discount`: kind `amount` usa `valueMinor` como descuento TOTAL en centimos para `units` (no por unidad); kind `percent` usa `percentBps` (1000 = 10 %). Si no esta impreso claramente, discount es null. Nunca devuelvas `offer` y `discount` a la vez.',
    '8. `priceMinor` ya es lo pagado por toda la cantidad. Nunca vuelvas a restar una oferta o descuento a `priceMinor`; no deduzcas descuentos de la diferencia entre lineas y total.',
    '9. `confidence` entre 0 y 1: lo que se lee claro vale 0.95, lo deducido de una letra borrosa vale 0.3.',
    '10. `totalMinor` es el total final del ticket. Si no cuadra con la suma de tus lineas, dilo en `warnings` en vez de cuadrarlo tu.',
    '11. Si una linea no se lee, no la metas: es mejor una linea menos que un producto que nadie compro.',
    '12. Si las paginas son tramos contiguos o solapados de un unico ticket, cuenta cada linea impresa una sola vez aunque vuelva a verse en otra pagina. No elimines lineas impresas distintas solo porque sean el mismo producto.',
    aiLocalizedFieldsInstruction(input.language ?? 'es', ['warnings'])
  ].join('\n');

  const user = [
    'El fichero inventario.json esta adjunto al mismo mensaje. Abrelo y usa su contenido; no digas que falta ni busques otro archivo.',
    'Usa las tiendas conocidas, categorias y productos registrados en ese fichero para clasificar. Si el producto aparece en el catalogo, respeta su categoria vigente y no lo propongas como nuevo. Para categorias propuestas nuevas, crea solo familias estables que puedan agrupar varios productos, no una categoria por producto.',
    '',
    input.esPdf
      ? 'El ticket llega como PDF: lee sus lineas directamente del documento.'
      : 'El ticket llega como imagen: lee sus lineas directamente de la foto.',
    '',
    'Contesta con este objeto exacto, con tantas lineas `lines` como productos compre la persona:',
    TICKET_SHAPE
  ].join('\n');

  return { system, user };
}
