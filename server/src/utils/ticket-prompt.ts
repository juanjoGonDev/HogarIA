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
  "purchaseDate": "2024-05-10",
  "lines": [
    {
      "name": "Leche semidesnatada 1,5L",
      "quantity": 2,
      "unit": "ud",
      "category": "dairy",
      "createCategory": false,
      "priceMinor": 195,
      "offer": { "buy": 3, "take": 2 },
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
  categorias: { clave: string; nombre: string }[];
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
  const system = [
    'Eres el lector de tickets de compra de una casa. Tu salida es UN objeto JSON y nada mas: sin markdown, sin prosa antes ni despues, sin comentarios.',
    'Reglas que no se pueden romper:',
    '1. El dinero va en CENTIMOS ENTEROS en `priceMinor` y `totalMinor` (1,95 EUR son 195). Nunca escribas un precio con coma ni con simbolo.',
    '2. El importe de cada linea del ticket es lo PAGADO por esa cantidad, no el precio por unidad: si la linea dice «2 x 1,10», son 2 unidades y priceMinor 220.',
    '3. NO inventes precios. Si el numero no se lee, `priceMinor` es null y lo dices en `warnings`. Una estimacion tuya acabaria en el historial de precios de la casa como si fuera un dato real.',
    '4. `store` es la tienda de la cabecera del ticket (el nombre del establecimiento, no su CIF ni su direccion). Si no se distingue, null.',
    '5. `purchaseDate` es la fecha impresa de compra en formato `YYYY-MM-DD`. Si falta, no se lee o es ambigua, `purchaseDate` es null. Nunca uses la fecha de subida ni `created_at` como fecha de compra.',
    '6. Cada linea legible debe tener una `category` no vacia y `createCategory` booleano; nunca los devuelvas como null. Busca primero el producto registrado y usa su categoria vigente, con `createCategory: false`. Si no hay coincidencia, usa la categoria existente mas adecuada; usa `other` para lo que no encaje si esta registrada. Solo si no hay categoria util, propone una clave nueva (minusculas, sin espacios ni acentos) con `createCategory: true`.',
    '7. `quantity` es cuantas unidades se llevan; `unit` la unidad corta (ud, kg, g, l, ml, pack, lata, botella, caja). Las ofertas tipo «3x2» van en `offer`, no en el precio.',
    '8. `confidence` entre 0 y 1: lo que se lee claro vale 0.95, lo deducido de una letra borrosa vale 0.3.',
    '9. `totalMinor` es el total final del ticket. Si no cuadra con la suma de tus lineas, dilo en `warnings` en vez de cuadrarlo tu.',
    '10. Si una linea no se lee, no la metas: es mejor una linea menos que un producto que nadie compro.',
    '11. Si las paginas son tramos contiguos o solapados de un unico ticket, cuenta cada linea impresa una sola vez aunque vuelva a verse en otra pagina. No elimines lineas impresas distintas solo porque sean el mismo producto.',
    aiLocalizedFieldsInstruction(input.language ?? 'es', ['warnings'])
  ].join('\n');

  const user = [
    'El fichero inventario.json esta adjunto al mismo mensaje. Abrelo y usa su contenido; no digas que falta ni busques otro archivo.',
    'Usa las tiendas conocidas, categorias y productos registrados en ese fichero para clasificar. Si el producto aparece en el catalogo, respeta su categoria vigente y no lo propongas como nuevo.',
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
