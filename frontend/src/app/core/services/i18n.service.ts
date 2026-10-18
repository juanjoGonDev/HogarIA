import { Injectable, signal, effect } from '@angular/core';
import { STORAGE_KEYS } from './storage.service';
import { relativeTimeParts, setDateLocale, type TimeInput } from '../time';
import {
  DICTS,
  type TranslationBundleName,
  type TranslationKey,
  type TranslationParams
} from '../i18n';
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

type LocaleDictionaryPair = {
  es: Readonly<Record<string, string>>;
  en: Readonly<Record<string, string>>;
};

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly LANG_KEY = STORAGE_KEYS.language;
  private langSignal = signal<Language>(this.getStoredLang());
  private resolvedSignal = signal<ResolvedLanguage>(this.resolve(this.getStoredLang()));
  private readonly loadedDictionaries = new Set<TranslationBundleName>();
  private readonly dictionaryLoads = new Map<TranslationBundleName, Promise<void>>();
  private readonly dynamicTranslations: Record<ResolvedLanguage, Record<string, string>> = {
    es: {},
    en: {}
  };

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

  /** Load route dictionaries before rendering; cache both languages and coalesce concurrent requests. */
  loadTranslations(...bundles: TranslationBundleName[]): Promise<void> {
    return Promise.all([...new Set(bundles)].map((bundle) => this.loadDictionary(bundle))).then(
      () => undefined
    );
  }

  loadHouseholdTranslations(): Promise<void> {
    return this.loadTranslations('household');
  }

  loadRecipeTranslations(): Promise<void> {
    return this.loadTranslations('recipes');
  }

  /** Assistant copy plus cross-domain labels load only after the user opens the assistant. */
  loadAssistantTranslations(): Promise<void> {
    return this.loadTranslations(
      'aiActionAssistant',
      'calendar',
      'household',
      'pantry',
      'recipes',
      'shoppingLists',
      'shoppingListDetail',
      'taste'
    );
  }

  private loadDictionary(bundle: TranslationBundleName): Promise<void> {
    if (this.loadedDictionaries.has(bundle)) return Promise.resolve();
    const inFlight = this.dictionaryLoads.get(bundle);
    if (inFlight) return inFlight;

    const load = this.importDictionary(bundle)
      .then(({ es, en }) => {
        this.loadedDictionaries.add(bundle);
        Object.assign(this.dynamicTranslations.es, es);
        Object.assign(this.dynamicTranslations.en, en);
        this.changeTick.update((value) => value + 1);
      })
      .catch((error: unknown) => {
        this.dictionaryLoads.delete(bundle);
        throw error;
      });
    this.dictionaryLoads.set(bundle, load);
    return load;
  }

  private importDictionary(bundle: TranslationBundleName): Promise<LocaleDictionaryPair> {
    switch (bundle) {
      case 'homeProfilePicker':
        return import('../i18n/dict/home_profile_picker').then((d) => ({
          es: d.homeProfilePickerEs,
          en: d.homeProfilePickerEn
        }));
      case 'shoppingLists':
        return import('../i18n/dict/shopping_lists').then((d) => ({
          es: d.shoppingListsEs,
          en: d.shoppingListsEn
        }));
      case 'shoppingListDetail':
        return import('../i18n/dict/shopping_list_detail').then((d) => ({
          es: d.shoppingListDetailEs,
          en: d.shoppingListDetailEn
        }));
      case 'onboarding':
        return import('../i18n/dict/onboarding').then((d) => ({
          es: d.onboardingEs,
          en: d.onboardingEn
        }));
      case 'invite':
        return import('../i18n/dict/invite').then((d) => ({ es: d.inviteEs, en: d.inviteEn }));
      case 'aiConfig':
        return import('../i18n/dict/ai_config').then((d) => ({
          es: d.aiConfigEs,
          en: d.aiConfigEn
        }));
      case 'avatarEditor':
        return import('../i18n/dict/avatar_editor').then((d) => ({
          es: d.avatarEditorEs,
          en: d.avatarEditorEn
        }));
      case 'account':
        return import('../i18n/dict/account').then((d) => ({ es: d.accountEs, en: d.accountEn }));
      case 'auth':
        return import('../i18n/dict/auth').then((d) => ({ es: d.authEs, en: d.authEn }));
      case 'caducidades':
        return import('../i18n/dict/caducidades').then((d) => ({
          es: d.caducidadesEs,
          en: d.caducidadesEn
        }));
      case 'shoppingSuggested':
        return import('../i18n/dict/shopping_suggested').then((d) => ({
          es: d.shoppingSuggestedEs,
          en: d.shoppingSuggestedEn
        }));
      case 'calendar':
        return import('../i18n/dict/calendar').then((d) => ({
          es: d.calendarEs,
          en: d.calendarEn
        }));
      case 'dashboard':
        return import('../i18n/dict/dashboard').then((d) => ({
          es: d.dashboardEs,
          en: d.dashboardEn
        }));
      case 'logs':
        return import('../i18n/dict/logs').then((d) => ({ es: d.logsEs, en: d.logsEn }));
      case 'pantry':
        return import('../i18n/dict/pantry').then((d) => ({ es: d.pantryEs, en: d.pantryEn }));
      case 'preferences':
        return import('../i18n/dict/preferences').then((d) => ({
          es: d.preferencesEs,
          en: d.preferencesEn
        }));
      case 'profile':
        return import('../i18n/dict/profile').then((d) => ({ es: d.profileEs, en: d.profileEn }));
      case 'settings':
        return import('../i18n/dict/settings').then((d) => ({
          es: d.settingsEs,
          en: d.settingsEn
        }));
      case 'taste':
        return import('../i18n/dict/taste').then((d) => ({ es: d.tasteEs, en: d.tasteEn }));
      case 'aiParticipants':
        return import('../i18n/dict/ai_participants').then((d) => ({
          es: d.aiParticipantsEs,
          en: d.aiParticipantsEn
        }));
      case 'household':
        return import('../i18n/dict/household').then((d) => ({
          es: d.householdEs,
          en: d.householdEn
        }));
      case 'recipes':
        return import('../i18n/dict/recipes').then((d) => ({ es: d.recipesEs, en: d.recipesEn }));
      case 'aiActionAssistant':
        return import('../i18n/dict/ai_action_assistant').then((d) => ({
          es: d.aiActionAssistantEs,
          en: d.aiActionAssistantEn
        }));
      default:
        return Promise.reject(new Error(`Unknown translation bundle: ${bundle satisfies never}`));
    }
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
    const encontrada =
      activeDictionary[key] ??
      this.dynamicTranslations[language][key] ??
      spanishDictionary[key] ??
      this.dynamicTranslations.es[key];
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
