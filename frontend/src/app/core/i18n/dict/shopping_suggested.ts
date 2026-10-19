// Diccionario del dominio `shopping_suggested`: la lista de la compra que se escribe sola con
// la estadistica de la casa (HOGARIA-SPEC ## 12al). Los motivos son las cuatro reglas del
// motor del server, y se ensenan tal cual: quien lee «caduca pronto» sabe que esa fila esta
// en la lista porque se le va a pasar la fecha, no porque un modelo lo sospeche.
export const shoppingSuggestedEs = {
  'shopping_suggested.titulo': 'Sugerencia de compra',
  'shopping_suggested.subtitulo':
    'Salida de tu ritmo de compra, el stock que queda, lo que caduca y el plan de la semana. Sin IA: solo tus datos.',
  'shopping_suggested.boton': 'Sugerida',
  'shopping_suggested.crear': 'Crear lista de la compra',
  'shopping_suggested.actualizar': 'Actualizar lista',
  'shopping_suggested.total': '≈{total}',
  'shopping_suggested.mejor_en': 'mejor en {tienda}',
  'shopping_suggested.sin_precio': 'sin precio conocido',
  'shopping_suggested.lista_abierta':
    'Ya tienes esta lista abierta ({n} pendientes): «Actualizar» la pone al día con lo último sin tocar lo que ya compraste o añadiste a mano.',
  'shopping_suggested.creada_ok': 'Lista sugerida creada',
  'shopping_suggested.actualizada_ok': 'Lista sugerida actualizada',
  'shopping_suggested.n_lineas': '{n} líneas a partir de tu actividad',
  'shopping_suggested.nombre_lista': 'Lista sugerida',
  'shopping_suggested.motivo.caduca': 'caduca pronto',
  'shopping_suggested.motivo.sin_stock': 'sin stock',
  'shopping_suggested.motivo.se_acaba': 'se acaba',
  'shopping_suggested.motivo.para_el_plan': 'para el plan'
} as const;

export const shoppingSuggestedEn: Record<keyof typeof shoppingSuggestedEs, string> = {
  'shopping_suggested.titulo': 'Shopping suggestion',
  'shopping_suggested.subtitulo':
    'Built from your buying rhythm, what is left, what expires and this week’s plan. No AI: just your data.',
  'shopping_suggested.boton': 'Suggested',
  'shopping_suggested.crear': 'Create shopping list',
  'shopping_suggested.actualizar': 'Update list',
  'shopping_suggested.total': '≈{total}',
  'shopping_suggested.mejor_en': 'best at {tienda}',
  'shopping_suggested.sin_precio': 'no known price',
  'shopping_suggested.lista_abierta':
    'This list is already open ({n} pending): “Update” brings it up to date without touching what you already bought or added by hand.',
  'shopping_suggested.creada_ok': 'Suggested list created',
  'shopping_suggested.actualizada_ok': 'Suggested list updated',
  'shopping_suggested.n_lineas': '{n} lines from your activity',
  'shopping_suggested.nombre_lista': 'Suggested list',
  'shopping_suggested.motivo.caduca': 'expires soon',
  'shopping_suggested.motivo.sin_stock': 'out of stock',
  'shopping_suggested.motivo.se_acaba': 'running out',
  'shopping_suggested.motivo.para_el_plan': 'for the plan'
};
