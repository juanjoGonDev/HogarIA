/** Paths implemented by the server's live-shopping endpoints. */
export type ShoppingStreamPath = 'tray' | `lists/${string}`;

/** A missing list selects the shared tray; a concrete ID selects its detail stream. */
export function shoppingStreamPath(listId: string | null): ShoppingStreamPath {
  return listId === null ? 'tray' : `lists/${listId}`;
}
