import { Injectable, signal, effect } from '@angular/core';
import { STORAGE_KEYS } from './storage.service';
import { relativeTimeParts, setDateLocale, type TimeInput } from '../time';
import { DICTS, type TranslationKey, type TranslationParams } from '../i18n';
import { environment } from '../../../environments/environment';

/**
 * El idioma de la aplicacion, y donde se busca un texto.
 *
 * Lo que ha cambiado en la ronda 20: los diccionarios ya no viven aqui. Con 600 y pico cadenas en el mismo
 * fichero, el service era a la vez el registro de textos y el mecanismo, y cada pantalla nueva ponia su
 * literal en la plantilla porque anadir una clave costaba mas que escribirla a mano —asi se colaron 502
 * textos en espanol fijo. Ahora `core/i18n/dict/<dominio>.ts` es el sitio de cada pantalla, y el tipo
 * `TranslationKey` (la union de claves, en `core/i18n/index.ts`) hace que inventarse una clave no compile.
 *
 * El idioma por defecto es el del navegador, y eso tiene una consecuencia que no es obvia: los e2e
 * assertan texto en espanol, asi que `playwright.config.ts` ancla `locale: 'es-ES'`. Sin ese ancla, la
 * suite entera dependeria del idioma de la maquina que la ejecuta, que no es un test.
 */

export type Language = 'es' | 'en' | 'auto';
export type ResolvedLanguage = 'es' | 'en';

type HouseholdDictionary = {
  es: Readonly<Record<string, string>>;
  en: Readonly<Record<string, string>>;
};

type RecipeDictionary = HouseholdDictionary;

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly LANG_KEY = STORAGE_KEYS.language;
  private langSignal = signal<Language>(this.getStoredLang());
  private resolvedSignal = signal<ResolvedLanguage>(this.resolve(this.getStoredLang()));
  private householdDictionary: HouseholdDictionary | null = null;
  private householdDictionaryLoad: Promise<void> | null = null;
  private recipeDictionary: RecipeDictionary | null = null;
  private recipeDictionaryLoad: Promise<void> | null = null;
  private assistantDictionary: HouseholdDictionary | null = null;
  private assistantDictionaryLoad: Promise<void> | null = null;

  readonly lang = this.langSignal.asReadonly();
  readonly resolved = this.resolvedSignal.asReadonly();
  // Expose as a signal to drive re-rendering in templates (use via t() fn)
  readonly changeTick = signal(0);

  constructor() {
    if (typeof window !== 'undefined') {
      // React to browser language changes when in 'auto' mode
      window.addEventListener('languagechange', () => {
        if (this.langSignal() === 'auto') {
          this.resolvedSignal.set(this.detectBrowserLang());
          this.changeTick.update((v) => v + 1);
          this.aplicaLocale();
        }
      });
    }

    effect(() => {
      this.langSignal();
      this.resolvedSignal.set(this.resolve(this.langSignal()));
      this.changeTick.update((v) => v + 1);
      document.documentElement.lang = this.resolvedSignal();
      this.aplicaLocale();
    });
  }

  /**
   * Las fechas y los numeros se escriben en el idioma de la app, no en el del sistema: es la unica
   * manera de que «4 de mayo de 2026» se convierta en «4 May 2026» al cambiar de idioma, y de que la
   * cifra de una caducidad no se quede en «12,5» con la app en ingles.
   */
  private aplicaLocale(): void {
    setDateLocale(this.resolvedSignal() === 'en' ? 'en-GB' : 'es-ES');
  }

  setLang(lang: Language): void {
    this.langSignal.set(lang);
    localStorage.setItem(this.LANG_KEY, lang);
  }

  /**
   * El diccionario grande de Hogar solo se descarga al entrar en esa sección. Lo espera su route resolver
   * antes de renderizar, y el cache incluye ambos idiomas para que un cambio de idioma no repita la carga.
   */
  loadHouseholdTranslations(): Promise<void> {
    if (this.householdDictionary) return Promise.resolve();
    if (!this.householdDictionaryLoad) {
      this.householdDictionaryLoad = import('../i18n/dict/household')
        .then(({ householdEs, householdEn }) => {
          this.householdDictionary = { es: householdEs, en: householdEn };
          this.changeTick.update((value) => value + 1);
        })
        .catch((error: unknown) => {
          this.householdDictionaryLoad = null;
          throw error;
        });
    }
    return this.householdDictionaryLoad;
  }

  /** La biblioteca de recetas carga ambos idiomas al entrar en su ruta, no en el bundle inicial. */
  loadRecipeTranslations(): Promise<void> {
    if (this.recipeDictionary) return Promise.resolve();
    if (!this.recipeDictionaryLoad) {
      this.recipeDictionaryLoad = import('../i18n/dict/recipes')
        .then(({ recipesEs, recipesEn }) => {
          this.recipeDictionary = { es: recipesEs, en: recipesEn };
          this.changeTick.update((value) => value + 1);
        })
        .catch((error: unknown) => {
          this.recipeDictionaryLoad = null;
          throw error;
        });
    }
    return this.recipeDictionaryLoad;
  }

  /** The global assistant's full bilingual copy loads only after the user opens the assistant. */
  loadAssistantTranslations(): Promise<void> {
    if (this.assistantDictionary) return Promise.resolve();
    if (!this.assistantDictionaryLoad) {
      this.assistantDictionaryLoad = import('../i18n/dict/ai_action_assistant')
        .then(({ aiActionAssistantEs, aiActionAssistantEn }) => {
          this.assistantDictionary = { es: aiActionAssistantEs, en: aiActionAssistantEn };
          this.changeTick.update((value) => value + 1);
        })
        .catch((error: unknown) => {
          this.assistantDictionaryLoad = null;
          throw error;
        });
    }
    return this.assistantDictionaryLoad;
  }

  /**
   * El texto de una clave, con sustitucion simple de {placeholder}.
   *
   * `key` es `TranslationKey`, no `string`: es lo que hace que un `t('shoping.title')` con una errata se
   * pare en el compilador en lugar de enseiar la clave en crudo en la pantalla. El fallback sigue siendo
   * el espanol y, si tampoco esta, la clave —por si el diccionario llega a medias de una rama larga.
   */
  /**
   * Un contador con sustantivo: en castellano la terminacion del sustantivo y en ingles la 's' final son la
   * misma decision, y ninguna de las dos se puede tomar pegando numero y palabra en la plantilla. Se eligen
   * dos claves y el numero entra por parametro, que es la unica forma de que «1 config» no salga «1 configs».
   */
  plural(
    count: number,
    oneKey: TranslationKey,
    manyKey: TranslationKey,
    params?: TranslationParams
  ): string {
    return this.t(count === 1 ? oneKey : manyKey, params);
  }

  /**
   * «hace 3 d», «en 22 h» y, cuando ya no es cercania, la fecha. Las partes las decide `relativeTimeParts`
   * (calendario, sin idioma); aqui se junta con la frase, que es lo que cambia entre idiomas.
   */
  relativeTime(value: TimeInput, now: Date = new Date()): string {
    const parts = relativeTimeParts(value, now);
    switch (parts.kind) {
      case 'none':
        return '';
      case 'now':
        return this.t('ui.ahora');
      case 'date':
        return parts.year
          ? this.t('ui.dia_y_ano', { day: parts.day, year: parts.year })
          : this.t('ui.el_dia', { day: parts.day });
      default: {
        const unidad = this.t(
          parts.unit === 'min'
            ? 'ui.unidad_min'
            : parts.unit === 'h'
              ? 'ui.unidad_h'
              : 'ui.unidad_d'
        );
        return this.t(parts.kind === 'in' ? 'ui.en_unidad' : 'ui.hace_unidad', {
          amount: parts.amount,
          unidad
        });
      }
    }
  }

  t(key: TranslationKey, params?: TranslationParams): string {
    const language = this.resolvedSignal();
    const activeDictionary = DICTS[language] as Record<string, string>;
    const spanishDictionary = DICTS.es as Record<string, string>;
    const householdDictionary = this.householdDictionary;
    const recipeDictionary = this.recipeDictionary;
    const assistantDictionary = this.assistantDictionary;
    const encontrada =
      activeDictionary[key] ??
      assistantDictionary?.[language][key] ??
      householdDictionary?.[language][key] ??
      recipeDictionary?.[language][key] ??
      spanishDictionary[key] ??
      assistantDictionary?.es[key] ??
      householdDictionary?.es[key] ??
      recipeDictionary?.es[key];
    let str: string = encontrada ?? key;
    if (encontrada === undefined && !environment.production) {
      // Un hueco de texto de Angular acepta cualquier `string`, asi que una clave que no existe NO falla: se
      // pinta `profile.cooking.none` en la pestana y el unico que se entera es el usuario (HOGARIA-SPEC ## 12v).
      // En desarrollo el diagnostico va a la consola, que es donde lo ve quien escribe; en produccion la
      // pantalla no se rinde a un log.
      console.warn(`[i18n] «${key}» no esta en el diccionario de ${language}: se pinta la clave`);
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v == null ? '' : String(v));
      }
    }
    return str;
  }

  private resolve(l: Language): ResolvedLanguage {
    if (l === 'auto') return this.detectBrowserLang();
    return l;
  }

  private detectBrowserLang(): ResolvedLanguage {
    if (typeof navigator === 'undefined') return 'es';
    const lang = (navigator.language || 'es').toLowerCase();
    return lang.startsWith('en') ? 'en' : 'es';
  }

  private getStoredLang(): Language {
    const stored = localStorage.getItem(this.LANG_KEY);
    if (stored && ['es', 'en', 'auto'].includes(stored)) return stored as Language;
    return 'auto';
  }
}
