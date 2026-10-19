/**
 * Quien puede ser invitado a un evento de la casa, y que se manda al guardar.
 *
 * Vive separado del componente por las dos cosas que tienen logica y por tanto se pueden probar sin
 * navegador: a quien se le ofrece la invitacion, y como se dice «no cambies la lista» sin decir «deja la
 * lista vacia». Confundirlas es borrarle a alguien sus invitados por abrir el dialogo demasiado pronto.
 */

/** Lo que hace falta para pintar la opcion: una cara, un nombre y a quien representa. */
export interface InviteCandidate {
  userId: string;
  name: string;
  avatar?: string;
}

/**
 * Los candidatos, en el orden en que se pintan.
 *
 * - Se cae **una misma**: el autor no es invitado de su evento (lo escribio, no se invito a si mismo),
 *   y el servidor tambien lo filtra —que la interfaz ofrezca lo que el servidor va a descartar es un
 *   boton que miente.
 * - Se ordena por nombre con `localeCompare('es')`: sin orden, el orden de los miembros es el que dio
 *   el `SELECT`, y dos aberturas del dialogo con la misma casa producen dos listas distintas. Las
 *   caras saltando de sitio hacen que se pulse a la vecina.
 * - Se deduplica por `userId`: un miembro con dos filas en la casa (un reintento de alta, una
 *   migracion a medias) no puede aparecer dos veces y seleccionarse a medias.
 */
export function inviteCandidates(
  members: readonly { userId?: string | null; name?: string | null; avatar?: string | null }[],
  myUserId: string | null | undefined
): InviteCandidate[] {
  const seen = new Set<string>();
  const list: InviteCandidate[] = [];
  for (const member of members ?? []) {
    const userId = member?.userId ?? '';
    if (!userId || userId === myUserId || seen.has(userId)) continue;
    seen.add(userId);
    list.push({ userId, name: member.name?.trim() || 'Sin nombre', avatar: member.avatar ?? undefined });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * El payload de invitados para un PATCH/POST.
 *
 * `shown` es si el picker estaba en pantalla para este borrador. Si no lo estaba —la casa no se habia
 * cargado aun, o el usuario no tiene casa— NO se manda la clave: `attendeeIds` ausente es «no tocar»,
 * y `attendeeIds: []` es «quedaros sin nadie». Mandar `[]` «por poner algo» desinvita a toda la casa en
 * un guardado que parecia inofensivo.
 */
export function attendeeIdsPayload(shown: boolean, selected: readonly string[]): { attendeeIds?: string[] } {
  return shown ? { attendeeIds: [...new Set(selected)] } : {};
}

/**
 * Que viene marcado al abrir el dialogo de edicion.
 *
 * Se prueba la lista explicita y, si no viene, se deduce de las caras: el listado de eventos del
 * calendario trae `attendees` y puede no traer `attendeeIds`, y sin esta segunda via el dialogo de
 * alguien que ya tenia a dos personas invitadas se abria con dos casillas vacias —guardar sin tocar nada
 * las habria borrado.
 */
export function selectedInvitees(
  event: { attendeeIds?: string[] | null; attendees?: { id: string }[] | null } | null | undefined
): string[] {
  if (event?.attendeeIds?.length) return [...event.attendeeIds];
  if (event?.attendeeIds) return [];
  return (event?.attendees ?? []).map((person) => person.id);
}
