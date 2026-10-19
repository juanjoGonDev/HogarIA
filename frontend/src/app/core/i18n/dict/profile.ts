/**
 * El vocabulario del perfil: cuanto cocinas y que secciones quieres encendidas.
 *
 * Vive aqui y no en cada pantalla porque las mismas cinco etiquetas de modulo se ensenan en tres sitios
 * (el picker del registro, el tour de bienvenida y Configuracion) y las cuatro de nivel de cocina, en
 * cuatro. Antes cada una las pintaba desde `COOKING_LEVEL_LABELS` o desde `MODULE_REGISTRY.label`, que
 * son cadenas en espanol escritas para el codigo, no para la persona: al cambiar de idioma seguian en
 * espanol porque nadie las pasaba por el diccionario.
 *
 * El dato (`value: 'meals'`, `value: 'beginner'`) sigue siendo la clave del modelo y viaja tal cual al
 * server; lo traduisible es la etiqueta, y por eso `labelKey`/`hintKey` sustituyen a `label`/`hint`.
 */
export const profileEs = {
  'profile.no_se_pudo_guardar': 'No se pudo guardar',
  'profile.la_ia_tendra_en': 'La IA tendrá en cuenta tus preferencias.',
  'profile.no_se_pudieron_cargar': 'No se pudieron cargar tus preferencias',
  'profile.cookingEffect.none': 'La IA escribirá pasos cortos y explicará cada término.',
  'profile.cookingEffect.beginner': 'La IA explicará cómo se hace cada paso, no solo qué poner.',
  'profile.cookingEffect.intermediate': 'La IA irá al grano y añadirá consejos cuando aporten.',
  'profile.cookingEffect.expert': 'La IA dará por supuesto lo básico: técnica, tiempos y temperaturas.',
  'profile.cooking.none': 'Apenas cocino',
  'profile.cookingHint.beginner': 'Explica el cómo, no solo el qué',
  'profile.cookingHint.expert': 'Al grano: técnica, tiempos y temperaturas',
  'profile.cookingHint.intermediate': 'Lo normal, con algún consejo suelto',
  'profile.cookingHint.none': 'Platos de cuatro pasos o menos, sin tecnicismos',
  'profile.module.meals': 'Comidas y recetas',
  'profile.module.pantry': 'Despensa y caducidades',
  'profile.module.receipts': 'Tickets con OCR',
  'profile.module.shopping': 'Lista de la compra y precios',
  'profile.module.tasks': 'Tareas del hogar',
  'profile.moduleHint.meals': 'Planificador semanal y recetas con IA',
  'profile.moduleHint.pantry': 'Qué queda, qué caduca, qué aprovechar',
  'profile.moduleHint.receipts': 'Foto al ticket → despensa con caducidad y precios',
  'profile.moduleHint.shopping': 'Cesta por tienda y cuánto costará',
  'profile.moduleHint.tasks': 'Reparto de tareas y calendario conjunto',
  'profile.registryHint.meals': 'Recetas, planificador de comidas y generador con IA. La agenda de la casa sigue visible',
  'profile.registryHint.pantry': 'Qué queda, qué caduca y el catálogo de utensilios',
  'profile.registryHint.receipts': 'Foto al ticket: líneas, precios y caducidades a la despensa',
  'profile.registryHint.shopping': 'Cesta por tienda, histórico de precios y coste estimado',
} as const;

export const profileEn: Record<keyof typeof profileEs, string> = {
  'profile.no_se_pudo_guardar': 'Could not save',
  'profile.la_ia_tendra_en': 'The AI will take your preferences into account.',
  'profile.no_se_pudieron_cargar': 'Could not load your preferences',
  'profile.cookingEffect.none': 'The AI will write short steps and explain every term.',
  'profile.cookingEffect.beginner': 'The AI will explain how each step is done, not only what to add.',
  'profile.cookingEffect.intermediate': 'The AI will get to the point and add tips when they help.',
  'profile.cookingEffect.expert': 'The AI will assume the basics: technique, timings and temperatures.',
  'profile.cooking.none': 'I barely cook',
  'profile.cookingHint.beginner': 'Explain the how, not just the what',
  'profile.cookingHint.expert': 'Straight to the point: technique, timing and temperatures',
  'profile.cookingHint.intermediate': 'The usual, with the odd tip',
  'profile.cookingHint.none': 'Four-step dishes or fewer, no jargon',
  'profile.module.meals': 'Meals and recipes',
  'profile.module.pantry': 'Pantry and expiry dates',
  'profile.module.receipts': 'Receipts with OCR',
  'profile.module.shopping': 'Shopping list and prices',
  'profile.module.tasks': 'Household chores',
  'profile.moduleHint.meals': 'Weekly planner and AI recipes',
  'profile.moduleHint.pantry': 'What\'s left, what expires, what to use up',
  'profile.moduleHint.receipts': 'Snap the receipt → pantry with expiry dates and prices',
  'profile.moduleHint.shopping': 'Basket by store and what it will cost',
  'profile.moduleHint.tasks': 'Splitting chores and a shared calendar',
  'profile.registryHint.meals': 'Recipes, meal planner and the AI generator. The household calendar stays visible',
  'profile.registryHint.pantry': 'What\'s left, what expires and the utensil catalogue',
  'profile.registryHint.receipts': 'Snap the receipt: lines, prices and expiry dates into the pantry',
  'profile.registryHint.shopping': 'Basket by store, price history and estimated cost',
};
