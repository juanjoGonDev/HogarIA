/**
 * Hub en memoria de las actualizaciones en vivo (HOGARIA-SPEC §8f).
 *
 * Es un `Map` de oyentes por canal y nada mas: sin Redis, sin worker externo, sin
 * base de datos. HogarIA corre en ununica instancia en un Raspberry Pi, y ahi un
 * proceso ya sabe lo que acaban de escribir las demas personas de su casa. En el
 * momento en que hubiera dos instancias esto dejaria de ser suficiente — y se veria
 * (un navegador que no se entera de un cambio), no pasaria desapercibido: el estado
 * visible siempre es el de la ultima lectura, el stream solo avisa de que toca leer.
 *
 * Esa es la decision que hace que el fallo sea suave: nadie pinta lo que trae el
 * evento, se vuelve a pedir. Un evento perdido cuesta una fila desactualizada hasta
 * el siguiente toque, nunca una lista falsa.
 */

export type LiveEvent = {
  /** `items` = algo dentro de una lista; `list` = la lista en si (estado, nombre). */
  type: 'items' | 'list';
  listId: string | null;
  action: string;
  by: string | null;
  byName: string | null;
  itemName: string | null;
  at: string;
};

export type LiveListener = (event: LiveEvent) => void;

/**
 * Techo de oyentes por canal. Una conexion SSE que no se cierra bien (el movil se
 * duerme en el pasillo) no puede dejar el proceso colgando de un listener que nadie
 * va a quitar: si un canal se llena, se cae al mas viejo, que es el que lleva mas
 * tiempo sin consumir.
 */
const MAX_LISTENERS_PER_CHANNEL = 24;

const channels = new Map<string, Set<LiveListener>>();

export function channelForList(listId: string): string {
  return `lists:${listId}`;
}

export function channelsForTray(scope: { userId: string; householdId: string | null }): string[] {
  return scope.householdId ? [`tray:${scope.userId}`, `tray:${scope.householdId}`] : [`tray:${scope.userId}`];
}

/** Devuelve la funcion de baja; llamarla dos veces no cuenta como error. */
export function subscribe(channel: string, listener: LiveListener): () => void {
  let listeners = channels.get(channel);
  if (!listeners) {
    listeners = new Set();
    channels.set(channel, listeners);
  }
  while (listeners.size >= MAX_LISTENERS_PER_CHANNEL) {
    const oldest = listeners.values().next().value as LiveListener;
    listeners.delete(oldest);
  }
  listeners.add(listener);

  return () => {
    const current = channels.get(channel);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) channels.delete(channel);
  };
}

export function publish(channelsToHit: string[], event: LiveEvent): number {
  let delivered = 0;
  for (const channel of channelsToHit) {
    const listeners = channels.get(channel);
    if (!listeners || listeners.size === 0) continue;
    for (const listener of [...listeners]) {
      try {
        listener(event);
        delivered += 1;
      } catch {
        // Un oyente que revienta no puede cortar el reparto a los demas: la
        // pantalla de otra persona del hogar sigue teniendo que enterarse.
      }
    }
  }
  return delivered;
}

export function listenerCount(channel?: string): number {
  if (channel) return channels.get(channel)?.size ?? 0;
  let total = 0;
  for (const listeners of channels.values()) total += listeners.size;
  return total;
}

/** Solo para tests: deja el hub como estaba el proceso al arrancar. */
export function resetLiveHub(): void {
  channels.clear();
}
