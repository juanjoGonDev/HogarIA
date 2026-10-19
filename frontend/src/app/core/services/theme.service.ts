import { Injectable, signal, effect } from '@angular/core';
import { STORAGE_KEYS } from './storage.service';

export type Theme = 'light' | 'dark' | 'system';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = STORAGE_KEYS.theme;
  private themeSignal = signal<Theme>(this.getStoredTheme());
  private isDarkSignal = signal<boolean>(false);

  readonly theme = this.themeSignal.asReadonly();
  readonly isDark = this.isDarkSignal.asReadonly();

  constructor() {
    // Initialize theme
    this.applyTheme(this.themeSignal());

    // Listen for system theme changes
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', () => {
        if (this.themeSignal() === 'system') {
          this.updateDarkMode();
        }
      });
    }

    // Effect to apply theme changes
    effect(() => {
      this.applyTheme(this.themeSignal());
    });
  }

  setTheme(theme: Theme): void {
    this.themeSignal.set(theme);
    localStorage.setItem(this.THEME_KEY, theme);
    this.applyTheme(theme);
  }

  toggleTheme(): void {
    const current = this.themeSignal();
    const next: Theme = current === 'light' ? 'dark' : 'light';
    this.setTheme(next);
  }

  private applyTheme(theme: Theme): void {
    const isDark = theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    this.isDarkSignal.set(isDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  private updateDarkMode(): void {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.isDarkSignal.set(isDark);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  private getStoredTheme(): Theme {
    const stored = localStorage.getItem(this.THEME_KEY);
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      return stored as Theme;
    }
    return 'system';
  }
}
