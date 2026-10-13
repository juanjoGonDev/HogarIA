// Textos de hogar que se muestran fuera de la ruta Hogar; se mantienen en el diccionario inicial.
export const householdSharedEs = {
  'household.ahora_eres_miembro_del': 'Ahora eres miembro del hogar',
  'household.no_se_pudo_actualizar': 'No se pudo actualizar',
  'household.copiado': 'Copiado',
  'household.hogar_activo': 'Hogar activo',
  'household.selecciona_hogar': 'Selecciona un hogar',
  'household.cambiando_hogar': 'Cambiando de hogar…',
  'household.no_se_pudo_cambiar_hogar': 'No se pudo cambiar de hogar. Inténtalo de nuevo.'
} as const;

export const householdSharedEn: Record<keyof typeof householdSharedEs, string> = {
  'household.ahora_eres_miembro_del': 'You are now a member of the household',
  'household.no_se_pudo_actualizar': 'Could not update',
  'household.copiado': 'Copied',
  'household.hogar_activo': 'Active household',
  'household.selecciona_hogar': 'Select a household',
  'household.cambiando_hogar': 'Switching household…',
  'household.no_se_pudo_cambiar_hogar': 'Could not switch household. Please try again.'
};
