/**
 * Route animations are progressive enhancement: the router's DOM update still
 * succeeds when the browser cannot produce a transition (for example, a mobile
 * viewport resize during prepaint). Skip only the failed animation so its
 * browser-owned transition layer cannot remain over the interactive page.
 */
export function skipUnavailableViewTransition(transition: {
  ready: Promise<unknown>;
  skipTransition: () => void;
}): void {
  void transition.ready.catch(() => transition.skipTransition());
}
