// Diccionario del dominio `onboarding`: texto de la interfaz, lo que la app dice. No va aqui lo que se
// guarda ni lo que se envia a la IA (HOGARIA-SPEC §12s-A). El `en` lo escribe una persona.
export const onboardingEs = {
  'onboarding.no_se_pudo_guardar_progreso':
    'No se pudieron guardar tus respuestas. Inténtalo de nuevo.',
  'onboarding.preguntas_cortas':
    '{n} preguntas cortas. Con esto la IA te propone recetas que de verdad puedes comer y la app sabe qué quieres llevar desde aquí; podrás cambiarlo cuando quieras en Preferencias.',
  'onboarding.mas_sobre_el_objetivo': '¿Algo más sobre el objetivo? (opcional)',
  'onboarding.ej_sin_carne_los_lunes':
    'Ej: sin carne los lunes, cenas de una olla y algo de pasta dos veces por semana',
  'onboarding.ej_prioriza_proteina_en_la_cena': 'Ej: prioriza proteína en la cena y poco pan',
  'onboarding.a_que_hora_comeis': '¿A qué hora coméis en casa?',
  'onboarding.atras': '← Atrás',
  'onboarding.cada_hora_que_cambies':
    'Cada hora que cambies saca un botón «Por defecto» para volver a la de siempre. Si prefieres no pensar en esto ahora, Esc o «Saltar este paso»: se puede terminar el tour y venir mañana.',
  'onboarding.cargando_utensilios': 'Cargando utensilios...',
  'onboarding.con_que_cuentas_en': '¿Con qué cuentas en la cocina?',
  'onboarding.configura_tu_hogaria': 'Configura tu HogarIA',
  'onboarding.guardar_y_empezar': 'Guardar y empezar',
  'onboarding.hogaria_es_tu_dia_a_dia':
    'HogarIA es el día a día de tu casa: dinos cómo andas de cocina y qué quieres llevar desde la app.',
  'onboarding.utensilios_en_despensa':
    'La disponibilidad de los utensilios se configura en Despensa. Allí puedes marcar qué tienes y editarlo cuando quieras.',
  'onboarding.marca_el_plato_no':
    'Elige uno o varios objetivos; puedes combinarlos y añadir un objetivo personalizado.',
  'onboarding.gestionar_utensilios': 'Gestionar utensilios →',
  'onboarding.me_gusta': 'Me gusta 👍',
  'onboarding.mejor_no': 'Mejor no 👎',
  'onboarding.no_es_un_adorno':
    'No es un adorno: con estas cuatro horas el calendario sabe dónde sentar cada comida, el botón «añadir» te propone esa hora y la IA planifica el día a tu reloj. Cambiarlas más adelante es igual de fácil: Preferencias → Horarios.',
  'onboarding.revisar_la_despensa': 'Revisar el inventario →',
  'onboarding.saltar_este_paso': 'Saltar este paso',
  'onboarding.saltar_por_ahora': 'Saltar por ahora',
  'onboarding.se_guarda_en_tu':
    'Se guarda en tu cuenta, no en el hogar: cada comensal puede tener lo suyo. Con el teclado: Esc salta este paso, Enter pasa al siguiente.',
  'onboarding.siguiente': 'Siguiente →',
  'onboarding.y_lo_que_quieras': 'Y lo que quieras contarnos',
  'onboarding.paso_de': 'Paso {n} de {total} · {titulo}',
  'onboarding.sin_responder': ' · sin responder',
  'onboarding.paso_suelto': 'Paso',
  'onboarding.paso_perfil': 'Perfil',
  'onboarding.paso_alergias': 'Alergias',
  'onboarding.paso_gustos': 'Gustos',
  'onboarding.paso_objetivo': 'Objetivo',
  'onboarding.paso_horarios': 'Horarios',
  'onboarding.paso_cocina': 'Cocina',
  'onboarding.puedes_completarlo': 'Puedes completarlo cuando quieras en Preferencias.',
  'onboarding.te_lo_preguntamos':
    'Sin problema: te lo preguntamos cuando quieras desde Preferencias.',
  'onboarding.perfil_y_preferencias':
    'Tu perfil y tus preferencias ya están: la IA lo tendrá en cuenta.',
  'onboarding.listo': 'Listo',
  'onboarding.guardado': 'Guardado'
} as const;

export const onboardingEn: Record<keyof typeof onboardingEs, string> = {
  'onboarding.no_se_pudo_guardar_progreso': 'Your answers could not be saved. Please try again.',
  'onboarding.preguntas_cortas':
    '{n} short questions. With them the AI suggests recipes you can actually eat and the app knows what you want from it; you can change it whenever you like in Preferences.',
  'onboarding.mas_sobre_el_objetivo': 'Anything else about the goal? (optional)',
  'onboarding.ej_sin_carne_los_lunes':
    'E.g. no meat on Mondays, one-pot dinners and some pasta twice a week',
  'onboarding.ej_prioriza_proteina_en_la_cena':
    'E.g. prioritise protein at dinner and little bread',
  'onboarding.a_que_hora_comeis': 'What time do you eat at home?',
  'onboarding.atras': '← Back',
  'onboarding.cada_hora_que_cambies':
    'Every time you change a hour, a "Default" button appears to go back to the usual one. If you would rather not think about this now, Esc or "Skip this step": you can finish the tour tomorrow.',
  'onboarding.cargando_utensilios': 'Loading utensils...',
  'onboarding.con_que_cuentas_en': 'What have you got in the kitchen?',
  'onboarding.configura_tu_hogaria': 'Set up your HogarIA',
  'onboarding.guardar_y_empezar': 'Save and start',
  'onboarding.hogaria_es_tu_dia_a_dia':
    'HogarIA is your day to day: tell us how much you cook and what you want out of the app.',
  'onboarding.utensilios_en_despensa':
    'Utensil availability is managed in Pantry. Mark what you have there and update it whenever you need.',
  'onboarding.marca_el_plato_no': 'Choose one or more goals; you can combine them and add a custom objective.',
  'onboarding.gestionar_utensilios': 'Manage utensils →',
  'onboarding.me_gusta': 'I like it 👍',
  'onboarding.mejor_no': 'Better not 👎',
  'onboarding.no_es_un_adorno':
    'These times are not decoration: with them the calendar knows where to seat each meal, the "+" button suggests that time and the AI plans the day on your clock. Changing them later is just as easy: Preferences → Meal times.',
  'onboarding.revisar_la_despensa': 'Check the inventory →',
  'onboarding.saltar_este_paso': 'Skip this step',
  'onboarding.saltar_por_ahora': 'Skip for now',
  'onboarding.se_guarda_en_tu':
    'It is saved in your account, not in the household: every diner can have their own. On the keyboard: Esc skips this step, Enter moves to the next one.',
  'onboarding.siguiente': 'Next →',
  'onboarding.y_lo_que_quieras': 'And whatever you want to tell us',
  'onboarding.paso_de': 'Step {n} of {total} · {titulo}',
  'onboarding.sin_responder': ' · skipped',
  'onboarding.paso_suelto': 'Step',
  'onboarding.paso_perfil': 'Profile',
  'onboarding.paso_alergias': 'Allergies',
  'onboarding.paso_gustos': 'Tastes',
  'onboarding.paso_objetivo': 'Goal',
  'onboarding.paso_horarios': 'Meal times',
  'onboarding.paso_cocina': 'Kitchen',
  'onboarding.puedes_completarlo': 'You can complete it whenever you like in Preferences.',
  'onboarding.te_lo_preguntamos':
    'No problem: we will ask you again whenever you want, from Preferences.',
  'onboarding.perfil_y_preferencias':
    'Your profile and preferences are in: the AI will take them into account.',
  'onboarding.listo': 'Done',
  'onboarding.guardado': 'Saved'
};
