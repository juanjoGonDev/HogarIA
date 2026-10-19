import { attendeeIdsPayload, inviteCandidates, selectedInvitees } from './event-invitations';

/**
 * Las reglas de la invitacion, sin Angular y sin red.
 *
 * Lo que se prueba aqui es lo que el usuario no puede distinguir desde fuera: a quien se le ofrece
 * entrar en un evento y que se manda cuando se guarda. El fallo real que trajo este fichero es que el
 * dialogo se abria sin la casa cargada, el picker no se pintaba, y al guardar se mandaba la lista
 * vacia —desinvitar a todos sin querer es un «no ha pasado nada» que si ha pasado algo.
 */

const member = (userId: string, name: string, avatar: string | null = null) => ({ userId, name, avatar });

describe('inviteCandidates', () => {
  it('quita a quien escribe el evento: uno no se invita a si mismo', () => {
    const candidates = inviteCandidates([member('ana', 'Ana'), member('bea', 'Bea')], 'ana');
    expect(candidates.map((c) => c.userId)).toEqual(['bea']);
  });

  it('con lista de una sola persona no hay a quien invitar, y eso se distingue de un error', () => {
    expect(inviteCandidates([member('ana', 'Ana')], 'ana')).toEqual([]);
    expect(inviteCandidates([], 'ana')).toEqual([]);
  });

  it('un nombre vacio no deja una opcion sin etiqueta', () => {
    const [only] = inviteCandidates([member('bea', '   ')], 'ana');
    expect(only.name).toBe('Sin nombre');
  });

  it('el orden es por nombre, no el que dio el SELECT', () => {
    const candidates = inviteCandidates(
      [member('u3', 'Zoe'), member('u1', 'Ana'), member('u2', 'Bea')],
      null
    );
    expect(candidates.map((c) => c.name)).toEqual(['Ana', 'Bea', 'Zoe']);
  });

  // No hay test de la «ñ» y su vecina: el orden de la ñ lo decide el ICU de Node, y en un runtime con
  // ICU recortado cae al orden de punto de codigo. Probar eso es probar el entorno, no esta funcion.

  it('dos filas del mismo usuario no producen dos casillas', () => {
    const candidates = inviteCandidates([member('bea', 'Bea'), member('bea', 'Beatriz')], 'ana');
    expect(candidates.length).toBe(1);
    // Gana la primera fila: es la que tiene el `SELECT`, y «la que gana» tiene que ser una regla escrita.
    expect(candidates[0].name).toBe('Bea');
  });

  it('una fila sin userId se ignora en vez de pintar una opcion que no se puede marcar', () => {
    const candidates = inviteCandidates([member('', 'Fantasma'), member('bea', 'Bea')], 'ana');
    expect(candidates.map((c) => c.userId)).toEqual(['bea']);
  });

  it('el avatar nulo se normaliza a undefined, que es lo que espera app-avatar', () => {
    const [bea] = inviteCandidates([member('bea', 'Bea', null)], 'ana');
    expect(bea.avatar).toBeUndefined();
  });
});

describe('attendeeIdsPayload', () => {
  it('si el picker no se mostro, la clave no va: «no tocar» no es «vaciar»', () => {
    expect(attendeeIdsPayload(false, ['bea'])).toEqual({});
    expect(attendeeIdsPayload(false, [])).toEqual({});
  });

  it('si se mostro, la lista vacia SI se manda: desinvitar es una decision tomada', () => {
    expect(attendeeIdsPayload(true, [])).toEqual({ attendeeIds: [] });
    expect(attendeeIdsPayload(true, ['bea', 'carla'])).toEqual({ attendeeIds: ['bea', 'carla'] });
  });

  it('repetidos se colapsan, para que el PATCH no escriba la misma fila dos veces', () => {
    expect(attendeeIdsPayload(true, ['bea', 'bea'])).toEqual({ attendeeIds: ['bea'] });
  });
});

describe('selectedInvitees', () => {
  it('la lista explicita manda sobre las caras', () => {
    expect(selectedInvitees({ attendeeIds: ['bea'], attendees: [{ id: 'carla' }] })).toEqual(['bea']);
  });

  it('una lista explicita vacia es vacia, no «deduce de las caras»', () => {
    expect(selectedInvitees({ attendeeIds: [], attendees: [{ id: 'carla' }] })).toEqual([]);
  });

  it('sin lista explicita se deduce de los attendees, que es lo que trae el listado', () => {
    expect(selectedInvitees({ attendees: [{ id: 'bea' }, { id: 'carla' }] })).toEqual(['bea', 'carla']);
  });

  it('un evento nuevo no tiene nadie marcado y no revienta por estar a undefined', () => {
    expect(selectedInvitees(undefined)).toEqual([]);
    expect(selectedInvitees(null)).toEqual([]);
    expect(selectedInvitees({})).toEqual([]);
  });
});
