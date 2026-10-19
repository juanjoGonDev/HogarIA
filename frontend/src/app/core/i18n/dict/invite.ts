// Diccionario del dominio `invite`: texto de la interfaz, lo que la app dice. No va aqui lo que se
// guarda ni lo que se envia a la IA (HOGARIA-SPEC §12s-A). El `en` lo escribe una persona.
export const inviteEs = {
  'invite.miembros': '{n} miembros',
  'invite.miembro_uno': '{n} miembro',
  'invite.invitacion_a': 'Invitación a {household}',
  'invite.comprobando_invitacion': 'Comprobando invitación...',
  'invite.inicia_sesion_o_crea':
    'Inicia sesión o crea una cuenta para unirte. Tras registrarte entrarás automáticamente en este hogar.',
  'invite.invitacion_no_valida': 'Invitación no válida',
  'invite.ir_a_mi_hogar': 'Ir a mi hogar',
  'invite.ir_al_inicio': 'Ir al inicio',
  'invite.te_han_invitado_a': 'Te han invitado a unirte al hogar',
  'invite.unirme_al_hogar': 'Unirme al hogar',
  'invite.ya_eres_miembro_de': 'Ya eres miembro de este hogar'
} as const;

export const inviteEn: Record<keyof typeof inviteEs, string> = {
  'invite.miembros': '{n} members',
  'invite.miembro_uno': '{n} member',
  'invite.invitacion_a': 'Invitation to {household}',
  'invite.comprobando_invitacion': 'Checking invitation...',
  'invite.inicia_sesion_o_crea':
    'Log in or create an account to join. After signing up you will land in this household automatically.',
  'invite.invitacion_no_valida': 'Invitation not valid',
  'invite.ir_a_mi_hogar': 'Go to my household',
  'invite.ir_al_inicio': 'Go to the start',
  'invite.te_han_invitado_a': 'You have been invited to join the household',
  'invite.unirme_al_hogar': 'Join the household',
  'invite.ya_eres_miembro_de': 'You are already a member of this household'
};
