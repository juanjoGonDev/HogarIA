import { Injectable } from '@angular/core';

/**
 * Unico punto de acceso a localStorage.
 *
 * El producto se llamo RecipeApp / MiCocinAI; ahora es HogarIA. Todas las claves
 * viven bajo un namespace versionado (`hogar:v1:`) para que cambiar el nombre no
 * pueda colisionar con el de otra app del mismo origen, y para poder borrar o
 * migrar el estado sin tocar claves ajenas.
 *
 * `migrateLegacyStorage()` se ejecuta antes de arrancar la aplicacion: copia las
 * claves antiguas a las nuevas y no las borra, de modo que una version previa del
 * frontend sigue funcionando (rollback) y una migracion no desloguea a nadie. Un
 * logout explicito si elimina las credenciales antiguas de sesion para que el
 * siguiente arranque no las vuelva a importar; las preferencias se conservan.
 */
export const STORAGE_PREFIX = 'hogar:v1:';

/** Claves leidas directamente por servicios que guardan strings crudos (no JSON). */
export const STORAGE_KEYS = {
  authToken: `${STORAGE_PREFIX}auth_token`,
  refreshToken: `${STORAGE_PREFIX}refresh_token`,
  currentUser: `${STORAGE_PREFIX}current_user`,
  theme: `${STORAGE_PREFIX}theme`,
  language: `${STORAGE_PREFIX}language`,
  logs: `${STORAGE_PREFIX}logs`,
} as const;

/** Claves heredadas de RecipeApp/MiCocinAI -> su equivalente actual. */
const LEGACY_AUTH_KEY_MAP = {
  auth_token: STORAGE_KEYS.authToken,
  refresh_token: STORAGE_KEYS.refreshToken,
  current_user: STORAGE_KEYS.currentUser
} as const;

const LEGACY_KEY_MAP: Record<string, string> = {
  ...LEGACY_AUTH_KEY_MAP,
  theme: STORAGE_KEYS.theme,
  language: STORAGE_KEYS.language,
};

/** Prefijo heredado de `StorageService` (recipeapp_xxx -> hogar:v1:xxx). */
export const LEGACY_PREFIX = 'recipeapp_';

/** Credenciales que una versión anterior puede volver a importar en el arranque. */
export const LEGACY_AUTH_KEYS = [
  ...Object.keys(LEGACY_AUTH_KEY_MAP),
  ...Object.keys(LEGACY_AUTH_KEY_MAP).map((key) => `${LEGACY_PREFIX}${key}`)
];

export const APP_STORAGE_MIGRATED = `${STORAGE_PREFIX}migrated`;

/** Copia el estado antiguo al namespace HogarIA. Idempotente: nunca pisa un valor nuevo. */
export function migrateLegacyStorage(): void {
  if (typeof localStorage === 'undefined') return;

  for (const [legacy, current] of Object.entries(LEGACY_KEY_MAP)) {
    const value = localStorage.getItem(legacy);
    if (value !== null && localStorage.getItem(current) === null) {
      localStorage.setItem(current, value);
    }
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LEGACY_PREFIX)) continue;
    const target = STORAGE_PREFIX + key.slice(LEGACY_PREFIX.length);
    const value = localStorage.getItem(key);
    if (value !== null && localStorage.getItem(target) === null) {
      localStorage.setItem(target, value);
    }
  }

  try {
    localStorage.setItem(APP_STORAGE_MIGRATED, new Date().toISOString());
  } catch {
    // Cuota llena: la migracion es un extra, no debe tumbar el arranque.
  }
}

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  readonly prefix = STORAGE_PREFIX;

  get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(this.prefix + key);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  }

  /** String crudo, sin JSON.parse: para tokens y preferencias simples. */
  getRaw(key: string): string | null {
    return localStorage.getItem(this.prefix + key);
  }

  setRaw(key: string, value: string): void {
    try {
      localStorage.setItem(this.prefix + key, value);
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  }

  remove(key: string): void {
    localStorage.removeItem(this.prefix + key);
  }

  clear(): void {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(this.prefix)) {
        localStorage.removeItem(key);
      }
    });
  }

  has(key: string): boolean {
    return localStorage.getItem(this.prefix + key) !== null;
  }

  getKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) {
        keys.push(key.slice(this.prefix.length));
      }
    }
    return keys;
  }
}
