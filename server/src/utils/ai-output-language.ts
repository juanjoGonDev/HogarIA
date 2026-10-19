export type AiOutputLanguage = 'es' | 'en';

function fromAcceptLanguage(value: string | null | undefined): AiOutputLanguage | undefined {
  if (!value) return undefined;
  const firstPreferred = value
    .split(',')
    .map((part) => part.trim().split(';', 1)[0]?.toLowerCase() ?? '')
    .find((part) => part.length > 0);
  if (firstPreferred?.startsWith('en')) return 'en';
  if (firstPreferred?.startsWith('es')) return 'es';
  return undefined;
}

/**
 * The UI sends its already-resolved locale. For older/direct clients, use the saved explicit
 * preference, then Accept-Language; malformed values fail closed to the product default.
 */
export function resolveAiOutputLanguage(
  appLanguage: string | null | undefined,
  savedLanguage: string | null | undefined,
  acceptLanguage: string | null | undefined
): AiOutputLanguage {
  if (appLanguage === 'es' || appLanguage === 'en') return appLanguage;
  if (appLanguage === 'auto') return fromAcceptLanguage(acceptLanguage) ?? 'es';
  if (savedLanguage === 'es' || savedLanguage === 'en') return savedLanguage;
  return fromAcceptLanguage(acceptLanguage) ?? 'es';
}

/** High-priority instruction for natural-language values returned by a structured AI response. */
export function aiOutputLanguageInstruction(language: AiOutputLanguage): string {
  return language === 'es'
    ? 'Redacta todo el texto natural legible por la persona usuaria en español de España, con vocabulario y expresiones naturales de España. No cambies de idioma aunque las instrucciones o los datos de entrada estén en otro idioma. No traduzcas claves JSON, enums, identificadores, nombres propios, nombres de catálogo ni texto que debas transcribir literalmente de una imagen o ticket.'
    : 'Write all natural-language text shown to the user in English (United Kingdom), using natural British English. Do not switch languages even if the instructions or input data use another language. Do not translate JSON keys, enums, identifiers, proper names, catalogue names, or text that must be transcribed verbatim from an image or receipt.';
}

/** Field-limited variant for extraction tasks whose human-readable source data must stay verbatim. */
export function aiLocalizedFieldsInstruction(
  language: AiOutputLanguage,
  fields: readonly string[]
): string {
  const locale =
    language === 'es' ? 'Escribe en español de España.' : 'Write in English (United Kingdom).';
  const fieldList = fields.map((field) => `\`${field}\``).join(', ');
  return `${locale} Aplica esta regla solo al texto que redactes para los campos ${fieldList}. Mantén literalmente los nombres, marcas, importes, fechas y notas transcritos, y conserva exactamente las categorías del catálogo y las claves JSON. Do not translate literal text, catalogue values, or JSON keys.`;
}
