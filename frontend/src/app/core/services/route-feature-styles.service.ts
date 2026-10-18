import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

export type RouteFeatureStyleBundle = 'calendar' | 'household';

const BUNDLES: Record<RouteFeatureStyleBundle, { file: string; error: string }> = {
  calendar: {
    file: 'calendar-feature.css',
    error: 'No se pudieron cargar los estilos del calendario.'
  },
  household: {
    file: 'household-feature.css',
    error: 'No se pudieron cargar los estilos de Hogar.'
  }
};

interface BundleState {
  link: HTMLLinkElement | null;
  loadPromise: Promise<void> | null;
  loaded: boolean;
}

@Injectable({ providedIn: 'root' })
export class RouteFeatureStylesService {
  private readonly document = inject(DOCUMENT);
  private readonly states = new Map<RouteFeatureStyleBundle, BundleState>();

  loadStyles(bundleName: RouteFeatureStyleBundle): Promise<void> {
    const state = this.stateFor(bundleName);
    if (state.loaded) return Promise.resolve();
    if (state.loadPromise) return state.loadPromise;

    const bundle = BUNDLES[bundleName];
    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL(bundle.file, this.document.baseURI).toString();
    link.dataset['routeStyle'] = bundleName;

    const loadPromise = new Promise<void>((resolve, reject) => {
      link.addEventListener(
        'load',
        () => {
          state.loaded = true;
          state.loadPromise = null;
          resolve();
        },
        { once: true }
      );
      link.addEventListener(
        'error',
        () => {
          link.remove();
          state.link = null;
          state.loadPromise = null;
          reject(new Error(bundle.error));
        },
        { once: true }
      );
    });

    state.link = link;
    state.loadPromise = loadPromise;
    this.document.head.appendChild(link);
    return loadPromise;
  }

  releaseStyles(bundleName: RouteFeatureStyleBundle): void {
    const state = this.stateFor(bundleName);
    state.link?.remove();
    state.link = null;
    state.loadPromise = null;
    state.loaded = false;
  }

  private stateFor(bundleName: RouteFeatureStyleBundle): BundleState {
    let state = this.states.get(bundleName);
    if (!state) {
      state = { link: null, loadPromise: null, loaded: false };
      this.states.set(bundleName, state);
    }
    return state;
  }
}
