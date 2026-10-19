/**
 * Perfil del hogar: qué se cocina y qué se quiere llevar desde la app.
 *
 * Nace del renombre a HogarIA. Antes el registro preguntaba un «nivel de
 * cocina» que no alimentaba nada; ahora el nivel decide cuánto explica la IA
 * (ver `detailLevelForCookingLevel` en el server) y los módulos dicen qué
 * secciones importan. Se guarda en la cuenta (`users.cooking_level` y
 * `users.preferences.profile.modules`), no en el hogar: cada comensal tiene el suyo.
 */

import type { TranslationKey } from '../../core/i18n';

export type CookingLevel = 'none' | 'beginner' | 'intermediate' | 'expert';

/**
 * Como se ensena cada nivel en la interfaz. Son claves del diccionario, no texto: lo que se guarda y se
 * envia es `CookingLevel` (`'beginner'`), y el texto depende del idioma de quien mira la pantalla.
 * El tipo `TranslationKey` es el que impide escribir una clave que no exista.
 */
export const COOKING_LEVEL_LABEL_KEYS: Record<CookingLevel, TranslationKey> = {
  none: 'profile.cooking.none',
  beginner: 'auth.beginner',
  intermediate: 'auth.intermediate',
  expert: 'auth.expert'
};

export const COOKING_LEVEL_OPTIONS: {
  value: CookingLevel;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
}[] = [
  { value: 'none', labelKey: COOKING_LEVEL_LABEL_KEYS.none, hintKey: 'profile.cookingHint.none' },
  { value: 'beginner', labelKey: COOKING_LEVEL_LABEL_KEYS.beginner, hintKey: 'profile.cookingHint.beginner' },
  { value: 'intermediate', labelKey: COOKING_LEVEL_LABEL_KEYS.intermediate, hintKey: 'profile.cookingHint.intermediate' },
  { value: 'expert', labelKey: COOKING_LEVEL_LABEL_KEYS.expert, hintKey: 'profile.cookingHint.expert' }
];

/** Secciones de HogarIA. `available: false` es lo que aún está por construir. */
export type HomeModule = 'meals' | 'pantry' | 'shopping' | 'receipts' | 'home';

export interface HomeModuleOption {
  value: HomeModule;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  available: boolean;
}

export const HOME_MODULE_OPTIONS: HomeModuleOption[] = [
  { value: 'meals', labelKey: 'profile.module.meals', hintKey: 'profile.moduleHint.meals', available: true },
  { value: 'pantry', labelKey: 'profile.module.pantry', hintKey: 'profile.moduleHint.pantry', available: true },
  { value: 'shopping', labelKey: 'profile.module.shopping', hintKey: 'profile.moduleHint.shopping', available: true },
  { value: 'receipts', labelKey: 'profile.module.receipts', hintKey: 'profile.moduleHint.receipts', available: true },
  { value: 'home', labelKey: 'profile.module.tasks', hintKey: 'profile.moduleHint.tasks', available: false }
];

export const HOME_MODULES = HOME_MODULE_OPTIONS.map((option) => option.value);

export interface HomeProfile {
  cookingLevel: CookingLevel;
  modules: HomeModule[];
}

export const DEFAULT_HOME_PROFILE: HomeProfile = {
  cookingLevel: 'beginner',
  modules: []
};

const LEVELS: readonly string[] = ['none', 'beginner', 'intermediate', 'expert'];

export function isCookingLevel(value: unknown): value is CookingLevel {
  return typeof value === 'string' && LEVELS.includes(value);
}

export function isHomeModule(value: unknown): value is HomeModule {
  return typeof value === 'string' && (HOME_MODULES as readonly string[]).includes(value);
}

/**
 * Lo que venga del backend o del almacenamiento local pasa por aquí: valores
 * desconocidos fuera, duplicados dentro, y el orden de HOME_MODULES para que
 * dos dispositivos vean la misma lista.
 */
export function toHomeProfile(stored: unknown): HomeProfile {
  const raw = (stored ?? {}) as { modules?: unknown; cookingLevel?: unknown };
  const list = Array.isArray(raw['modules']) ? (raw['modules'] as unknown[]) : [];
  const modules = HOME_MODULE_OPTIONS.filter((option) => list.includes(option.value)).map(
    (option) => option.value
  );

  return {
    cookingLevel: isCookingLevel(raw['cookingLevel']) ? raw['cookingLevel'] : 'beginner',
    modules
  };
}

/**
 * El nivel de cocina en palabras. Tres pantallas lo resolvian cada una por su cuenta, y dos devolvian la
 * CLAVE (la pestana de «Perfil» llego a decir `profile.cooking.none`): un `{{ }}` de Angular acepta cualquier
 * `string`, asi que ni el compilador ni el diccionario se enteran. Aqui esta la unica version, con el
 * traductor dentro —como `difficultyLabel`— porque el idioma solo lo tiene la pantalla que llama.
 */
export function cookingLevelWord(
  level: string | undefined | null,
  t: (key: TranslationKey) => string,
  fallback = '—'
): string {
  const clave = level && isCookingLevel(level) ? COOKING_LEVEL_LABEL_KEYS[level] : undefined;
  return clave ? t(clave) : fallback;
}

export function toggleHomeModule(modules: HomeModule[], module: HomeModule): HomeModule[] {
  return modules.includes(module) ? modules.filter((m) => m !== module) : [...modules, module];
}

/**
 * Frase para «así te afecta», en el propio selector. Devuelve la CLAVE del diccionario: el texto se pide
 * en la plantilla, que es el unico sitio donde el idioma se re-evalua (12s-B).
 */
export function detailLevelHintKey(level: CookingLevel): TranslationKey {
  switch (level) {
    case 'none':
      return 'profile.cookingEffect.none';
    case 'beginner':
      return 'profile.cookingEffect.beginner';
    case 'intermediate':
      return 'profile.cookingEffect.intermediate';
    case 'expert':
      return 'profile.cookingEffect.expert';
  }
}
