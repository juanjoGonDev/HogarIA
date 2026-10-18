import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class HouseholdFeatureStylesService {
  private readonly document = inject(DOCUMENT);
  private link: HTMLLinkElement | null = null;
  private loadPromise: Promise<void> | null = null;
  private loaded = false;

  loadHouseholdStyles(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;

    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('household-feature.css', this.document.baseURI).toString();
    link.dataset['householdFeatureStyles'] = '';

    const loadPromise = new Promise<void>((resolve, reject) => {
      link.addEventListener(
        'load',
        () => {
          this.loaded = true;
          this.loadPromise = null;
          resolve();
        },
        { once: true }
      );
      link.addEventListener(
        'error',
        () => {
          link.remove();
          this.link = null;
          this.loadPromise = null;
          reject(new Error('No se pudieron cargar los estilos de Hogar.'));
        },
        { once: true }
      );
    });

    this.link = link;
    this.loadPromise = loadPromise;
    this.document.head.appendChild(link);
    return loadPromise;
  }

  releaseHouseholdStyles(): void {
    this.link?.remove();
    this.link = null;
    this.loadPromise = null;
    this.loaded = false;
  }
}
