import { effect, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Convencion de la app: TODA pestaña que muestre contenido distinto queda
 *  reflejada en la URL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Regla: si al cambiar de pestaña cambia lo que se ve, la URL cambia con
 * ella (query param). Asi la vista es enlazable, sobrevive a recargas y al
 * boton "atras" del navegador, y se puede compartir.
 *
 * Como se usa (cualquier vista con pestañas, en toda la web):
 *
 * ```ts
 * const TABS = ['ingredients', 'utensils'] as const;
 *
 * constructor() {
 *   syncTabWithUrl({
 *     param: 'tab',
 *     values: TABS,
 *     fallback: 'ingredients',
 *     current: () => this.activeTab(),   // signal
 *     onChange: (tab) => this.activeTab.set(tab)
 *   });
 * }
 * ```
 *
 * - La pestaña por defecto (`fallback`) NO aparece en la URL: la URL limpia
 *   sigue siendo la vista por defecto.
 * - Un valor que no este en `values` se ignora (se limpia de la URL).
 * - Las navegaciones usan `replaceUrl` para no llenar el historial.
 */

export interface TabUrlOptions<T extends string> {
  /** Nombre del query param que representa la pestaña (ej. `tab`). */
  param: string;
  /** Valores admitidos; cualquiera otro presente en la URL se descarta. */
  values: readonly T[];
  /** Pestaña activa (normalmente una signal). */
  current: () => T;
  /** Aplica la pestaña leida desde la URL. */
  onChange: (value: T) => void;
  /** Pestaña por defecto: cuando esta activa, el param se elimina de la URL. */
  fallback: T;
}

/** Lee la pestaña inicial de la URL y la aplica (si el valor es valido). */
export function readTabParam<T extends string>(
  route: ActivatedRoute,
  param: string,
  values: readonly T[],
  fallback: T,
  onChange: (value: T) => void
): void {
  const raw = route.snapshot.queryParamMap.get(param);

  if (raw && (values as readonly string[]).includes(raw)) {
    onChange(raw as T);
    return;
  }

  // Valor desconocido o ausente: la vista se queda en la pestaña inicial.
  onChange(fallback);
}

/**
 * Escribe la pestaña activa en la URL. No hace nada si el param ya tiene
 * el valor correcto (evita navegaciones en bucle).
 */
export function writeTabParam<T extends string>(
  router: Router,
  route: ActivatedRoute,
  param: string,
  value: T,
  fallback: T
): void {
  const target = value === fallback ? null : value;
  const current = route.snapshot.queryParamMap.get(param) ?? null;
  if (current === target) return;

  router.navigate([], {
    relativeTo: route,
    queryParams: { [param]: target },
    queryParamsHandling: 'merge',
    replaceUrl: true
  });
}

/** Elimina el param de la URL (se usa al cerrar modales con pestañas). */
export function clearTabParam(router: Router, route: ActivatedRoute, param: string): void {
  if (!route.snapshot.queryParamMap.has(param)) return;

  router.navigate([], {
    relativeTo: route,
    queryParams: { [param]: null },
    queryParamsHandling: 'merge',
    replaceUrl: true
  });
}

/**
 * Mantiene una pestaña sincronizada con la URL en ambos sentidos:
 * url -> estado (al entrar) y estado -> url (cada vez que cambia).
 * Debe llamarse en contexto de inyeccion (constructor o inicializador).
 */
export function syncTabWithUrl<T extends string>(options: TabUrlOptions<T>): void {
  const router = inject(Router);
  const route = inject(ActivatedRoute);
  const { param, values, fallback, current, onChange } = options;

  readTabParam(route, param, values, fallback, onChange);

  effect(() => {
    writeTabParam(router, route, param, current(), fallback);
  });
}
