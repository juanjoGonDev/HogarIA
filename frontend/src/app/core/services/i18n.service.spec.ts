import { TestBed } from '@angular/core/testing';
import { DICTS, type TranslationKey } from '../i18n';
import { dateLocale, setDateLocale } from '../time';
import { environment } from '../../../environments/environment';
import { I18nService } from './i18n.service';
import { STORAGE_KEYS } from './storage.service';

describe('I18nService', () => {
  let service: I18nService | undefined;
  let previousLanguage: string | null;
  let previousDateLocale: string;
  let previousDocumentLanguage: string;
  let previousProduction: boolean;
  let previousNavigatorLanguage: PropertyDescriptor | undefined;

  beforeEach(() => {
    previousLanguage = localStorage.getItem(STORAGE_KEYS.language);
    previousDateLocale = dateLocale();
    previousDocumentLanguage = document.documentElement.lang;
    previousProduction = environment.production;
    previousNavigatorLanguage = Object.getOwnPropertyDescriptor(navigator, 'language');
    localStorage.removeItem(STORAGE_KEYS.language);
    TestBed.configureTestingModule({ providers: [I18nService] });
  });

  afterEach(() => {
    service?.setLang('es');
    TestBed.flushEffects();
    service = undefined;

    if (previousLanguage === null) localStorage.removeItem(STORAGE_KEYS.language);
    else localStorage.setItem(STORAGE_KEYS.language, previousLanguage);

    setDateLocale(previousDateLocale);
    document.documentElement.lang = previousDocumentLanguage;
    (environment as { production: boolean }).production = previousProduction;
    if (previousNavigatorLanguage) {
      Object.defineProperty(navigator, 'language', previousNavigatorLanguage);
    } else {
      delete (navigator as unknown as { language?: string }).language;
    }
  });

  function injectService(): I18nService {
    service = TestBed.inject(I18nService);
    TestBed.flushEffects();
    return service;
  }

  function setNavigatorLanguage(language: string): void {
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: language
    });
  }

  it('loads a persisted supported language', () => {
    localStorage.setItem(STORAGE_KEYS.language, 'en');
    setNavigatorLanguage('es-MX');

    const i18n = injectService();
    expect(i18n.lang()).toBe('en');
    expect(i18n.resolved()).toBe('en');
  });

  it('falls back to auto for an unsupported stored value and detects English', () => {
    localStorage.setItem(STORAGE_KEYS.language, 'fr');
    setNavigatorLanguage('en-AU');

    const i18n = injectService();
    expect(i18n.lang()).toBe('auto');
    expect(i18n.resolved()).toBe('en');
  });

  it('uses Spanish when the browser language is empty', () => {
    setNavigatorLanguage('');
    const i18n = injectService();
    expect(i18n.resolved()).toBe('es');
  });

  it('uses Spanish when navigator is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    try {
      const i18n = injectService();
      expect(i18n.lang()).toBe('auto');
      expect(i18n.resolved()).toBe('es');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  });

  it('persists explicit changes and synchronizes the document and date locale', () => {
    const i18n = injectService();

    i18n.setLang('en');
    TestBed.flushEffects();

    expect(localStorage.getItem(STORAGE_KEYS.language)).toBe('en');
    expect(i18n.resolved()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(dateLocale()).toBe('en-GB');

    i18n.setLang('es');
    TestBed.flushEffects();
    expect(document.documentElement.lang).toBe('es');
    expect(dateLocale()).toBe('es-ES');
  });

  it('reacts to browser languagechange only while the saved language is auto', () => {
    const i18n = injectService();
    i18n.setLang('auto');
    TestBed.flushEffects();
    setNavigatorLanguage('en-US');

    const beforeBrowserChange = i18n.changeTick();
    window.dispatchEvent(new Event('languagechange'));
    expect(i18n.resolved()).toBe('en');
    expect(i18n.changeTick()).toBe(beforeBrowserChange + 1);

    i18n.setLang('es');
    TestBed.flushEffects();
    const beforeExplicitChange = i18n.changeTick();
    setNavigatorLanguage('en-US');
    window.dispatchEvent(new Event('languagechange'));
    expect(i18n.resolved()).toBe('es');
    expect(i18n.changeTick()).toBe(beforeExplicitChange);
  });

  it('falls back to Spanish when the active dictionary lacks a key', () => {
    const i18n = injectService();
    const key: TranslationKey = 'ui.ahora';
    const english = DICTS.en as Record<string, string>;
    const spanish = DICTS.es as Record<string, string>;
    const translation = english[key];
    delete english[key];

    try {
      i18n.setLang('en');
      TestBed.flushEffects();
      expect(i18n.t(key)).toBe(spanish[key]);
    } finally {
      english[key] = translation;
    }
  });

  it('loads household translations once for both languages before the route renders', async () => {
    const i18n = injectService();
    const changeTickBeforeLoad = i18n.changeTick();

    await Promise.all([i18n.loadHouseholdTranslations(), i18n.loadHouseholdTranslations()]);

    expect(i18n.changeTick()).toBe(changeTickBeforeLoad + 1);
    expect(i18n.t('household.meal_shopping_approve')).toBe('Añadir selección a Compra');

    i18n.setLang('en');
    TestBed.flushEffects();
    expect(i18n.t('household.meal_shopping_approve')).toBe('Add selection to Shopping');

    const changeTickAfterLoad = i18n.changeTick();
    await i18n.loadHouseholdTranslations();
    expect(i18n.changeTick()).toBe(changeTickAfterLoad);
  });

  it('loads recipe translations lazily once for both languages', async () => {
    const i18n = injectService();
    const dictionaries = DICTS.es as Record<string, string>;
    const changeTickBeforeLoad = i18n.changeTick();

    expect(dictionaries['recipes.title']).toBeUndefined();
    await Promise.all([i18n.loadRecipeTranslations(), i18n.loadRecipeTranslations()]);

    expect(i18n.changeTick()).toBe(changeTickBeforeLoad + 1);
    expect(i18n.t('recipes.title')).toBe('Recetas');

    i18n.setLang('en');
    TestBed.flushEffects();
    expect(i18n.t('recipes.title')).toBe('Recipes');

    const changeTickAfterLoad = i18n.changeTick();
    await i18n.loadRecipeTranslations();
    expect(i18n.changeTick()).toBe(changeTickAfterLoad);
  });

  it('loads assistant translations lazily once for both languages', async () => {
    const i18n = injectService();
    const dictionaries = DICTS.es as Record<string, string>;
    const warning = spyOn(console, 'warn');
    const changeTickBeforeLoad = i18n.changeTick();

    expect(dictionaries['ai_assistant.title']).toBeUndefined();
    expect(i18n.t('ai_assistant.open')).toBe('Abrir asistente de acciones con IA');
    expect(i18n.t('ai_assistant.title')).toBe('ai_assistant.title');
    warning.calls.reset();

    await Promise.all([i18n.loadAssistantTranslations(), i18n.loadAssistantTranslations()]);

    expect(i18n.changeTick()).toBe(changeTickBeforeLoad + 1);
    expect(i18n.t('ai_assistant.title')).toBe('Asistente de acciones');

    i18n.setLang('en');
    TestBed.flushEffects();
    expect(i18n.t('ai_assistant.title')).toBe('Action assistant');

    const changeTickAfterLoad = i18n.changeTick();
    await i18n.loadAssistantTranslations();
    expect(i18n.changeTick()).toBe(changeTickAfterLoad);
    expect(warning).not.toHaveBeenCalled();
  });

  it('returns and warns with a missing key in development, but stays quiet in production', () => {
    const i18n = injectService();
    const missingKey = 'test.missing.translation' as TranslationKey;
    const warning = spyOn(console, 'warn');

    (environment as { production: boolean }).production = false;
    expect(i18n.t(missingKey)).toBe(missingKey);
    expect(warning).toHaveBeenCalledOnceWith(
      `[i18n] «${missingKey}» no esta en el diccionario de ${i18n.resolved()}: se pinta la clave`
    );

    warning.calls.reset();
    (environment as { production: boolean }).production = true;
    expect(i18n.t(missingKey)).toBe(missingKey);
    expect(warning).not.toHaveBeenCalled();
  });

  it('replaces every placeholder and turns nullish parameter values into empty text', () => {
    const i18n = injectService();
    expect(i18n.t('caducidades.de_n_en_n', { n: 2 })).toBe('de 2 en 2');
    expect(i18n.t('calendar.nothing_planned', { period: null })).toBe('Nada planificado en .');
    expect(i18n.t('calendar.replan_selection_count', { count: 3 })).toBe('Platos seleccionados: 3');
  });

  it('selects singular and plural translation keys', () => {
    const i18n = injectService();
    expect(
      i18n.plural(1, 'ai_config.n_configuraciones_uno', 'ai_config.n_configuraciones_varios', {
        count: 1
      })
    ).toBe('1 configuración');
    expect(
      i18n.plural(2, 'ai_config.n_configuraciones_uno', 'ai_config.n_configuraciones_varios', {
        count: 2
      })
    ).toBe('2 configuraciones');
  });

  it('formats absent, immediate, relative and dated timestamps in the active language', () => {
    const i18n = injectService();
    const now = new Date('2026-10-09T12:00:00Z');
    expect(i18n.relativeTime(null, now)).toBe('');
    expect(i18n.relativeTime(now, now)).toBe('ahora');
    expect(i18n.relativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe('hace 5 min');
    expect(i18n.relativeTime(new Date(now.getTime() + 5 * 60_000), now)).toBe('en 5 min');
    expect(i18n.relativeTime(new Date(now.getTime() - 2 * 60 * 60_000), now)).toBe('hace 2 h');
    expect(i18n.relativeTime(new Date(now.getTime() + 2 * 60 * 60_000), now)).toBe('en 2 h');
    expect(i18n.relativeTime(new Date(now.getTime() - 3 * 24 * 60 * 60_000), now)).toBe('hace 3 d');
    expect(i18n.relativeTime(new Date(now.getTime() + 3 * 24 * 60 * 60_000), now)).toBe('en 3 d');
    expect(i18n.relativeTime('2026-09-20T12:00:00Z', now)).toContain('el ');
    expect(i18n.relativeTime('2025-12-20T12:00:00Z', now)).toContain('25');
    expect(i18n.relativeTime(new Date())).toBe('ahora');

    i18n.setLang('en');
    TestBed.flushEffects();
    expect(i18n.relativeTime(now, now)).toBe('now');
    expect(i18n.relativeTime(new Date(now.getTime() - 5 * 60_000), now)).toBe('5 min ago');
  });
});
