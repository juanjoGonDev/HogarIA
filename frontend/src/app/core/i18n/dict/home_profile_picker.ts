// Diccionario del dominio `home_profile_picker`: texto de la interfaz, lo que la app dice. No va aqui lo que se
// guarda ni lo que se envia a la IA (HOGARIA-SPEC §12s-A). El `en` lo escribe una persona.
export const homeProfilePickerEs = {
  'home_profile_picker.que_quieres_llevar': '¿Qué quieres llevar desde HogarIA?',
  'home_profile_picker.no_es_una_etiqueta': 'No es una etiqueta: decide cuánto te explica la IA cada receta y qué tan al grano va el planificador.',
  'home_profile_picker.marca_lo_que_vas_a_usar': 'Marca lo que vas a usar. Lo que no marques sigue existiendo, solo que no te lo recordamos.',
  'home_profile_picker.como_andas_de_cocina': '¿Cómo andas de cocina?',
  'home_profile_picker.lo_que_marques_con': 'Lo que marques con «pronto» está en el plan: se activará solo cuando exista.',
  'home_profile_picker.proonto': 'pronto',
} as const;

export const homeProfilePickerEn: Record<keyof typeof homeProfilePickerEs, string> = {
  'home_profile_picker.que_quieres_llevar': 'What do you want from HogarIA?',
  'home_profile_picker.no_es_una_etiqueta': 'It is not a label: it decides how much the AI explains in each recipe and how blunt the planner is.',
  'home_profile_picker.marca_lo_que_vas_a_usar': 'Tick what you will use. Whatever you leave out still exists, we just stop reminding you about it.',
  'home_profile_picker.como_andas_de_cocina': 'How much do you cook?',
  'home_profile_picker.lo_que_marques_con': 'Anything ticked as “soon” is already in the plan: it switches on by itself once it exists.',
  'home_profile_picker.proonto': 'soon',
};
