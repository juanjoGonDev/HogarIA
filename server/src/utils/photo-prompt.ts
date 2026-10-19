/**
 * El prompt de la entrada por foto (HOGARIA-SPEC §8f), aparte de la ruta por dos
 * razones: se puede leer entero sin buscarlo entre un `try` y un `INSERT`, y se puede
 * probar que menciona lo que tiene que mencionar (el catalogo, los centimos, el «no
 * inventes») sin montar un proveedor de IA.
 */

import { aiLocalizedFieldsInstruction, type AiOutputLanguage } from './ai-output-language.js';

export const EXPECTED_SHAPE = `{
  "lines": [
    {
      "name": "Leche semidesnatada 1,5L",
      "quantity": 2,
      "unit": "botella",
      "category": "Lacteos",
      "createCategory": false,
      "priceMinor": 95,
      "confidence": 0.9,
      "note": "etiqueta amarilla"
    }
  ],
  "currency": "EUR",
  "warnings": []
}`;

const MODE_INSTRUCTIONS: Record<string, string> = {
  auto: 'Puede ser un ticket, una estanteria o la lista escrita a mano. Decide que es y tratelo como tal.',
  ticket:
    'Es un TICKET de caja: el importe de cada linea es lo PAGADO por esa cantidad, no el precio por unidad. Divide y redondea a centimos. Si una linea lleva una oferta tipo «3x2», indicarla con offer {buy:3, take:2}.',
  shelf:
    'Es una FOTO DE ESTANTERIA con la etiqueta de precio a la vista: ese numero es el PRECIO POR UNIDAD. Si hay una promocion escrita en la etiqueta (3x2, 2x1, «llevando 6»), ponla en offer.'
};

export function buildPhotoPrompt(input: {
  categoriesJson: string;
  mode: 'auto' | 'ticket' | 'shelf';
  note?: string | null;
  language?: AiOutputLanguage;
}): { system: string; user: string } {
  const language = input.language ?? 'es';
  const newCategoryLanguage =
    language === 'es'
      ? 'Si createCategory es true, redacta el nombre de la categoría nueva en español de España; si reutilizas una existente, copia exactamente su nombre del catálogo.'
      : 'If createCategory is true, write the new category name in English (United Kingdom); if reusing an existing category, copy its catalogue name exactly.';
  const system = [
    'Eres el clasificador de la lista de la compra de una casa. Tu salida es UN objeto JSON y nada mas: sin markdown, sin prosa antes ni despues, sin comentarios.',
    'Reglas que no se pueden romper:',
    '1. El dinero va en CENTIMOS ENTEROS en `priceMinor` (1,95 EUR son 195). Nunca escribas un precio con coma ni con simbolo.',
    '2. NO inventes precios. Si el numero no esta en la imagen, `priceMinor` es null. Una estimacion tuya se propagaria a todas las cestas futuras como si fuera un dato real.',
    '3. `quantity` es cuantas unidades se llevan (1 o mas). `unit` es la unidad corta: kg, g, l, ml, ud, pack, botella, lata, caja.',
    '4. `category` es UNO de los nombres del catalogo. Si ninguna encaja y la seccion tiene sentido para la casa, usa un nombre nuevo con `createCategory: true`.',
    '5. `confidence` entre 0 y 1: lo que has leido claro vale 0.9, lo que has deducido de una letra borrosa vale 0.3. No redondees todo a 0.8.',
    '6. Si algo no se lee, no lo metas: es mejor una linea menos que un producto que nadie pidio.',
    aiLocalizedFieldsInstruction(language, ['warnings']),
    newCategoryLanguage
  ].join('\n');

  const user = [
    'Catalogo de secciones de esta casa (nombre y color, para que puedas reutilizar una existente):',
    input.categoriesJson,
    '',
    MODE_INSTRUCTIONS[input.mode] ?? MODE_INSTRUCTIONS.auto,
    input.note ? `Nota de quien hace la foto: ${input.note}` : '',
    '',
    'Contesta con este objeto exacto, con tantas lineas `lines` como productos veas:',
    EXPECTED_SHAPE
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { system, user };
}
