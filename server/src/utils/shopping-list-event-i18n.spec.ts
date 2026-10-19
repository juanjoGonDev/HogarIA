/**
 * Espejo del historial de la lista de la compra (HOGARIA-SPEC ## 12w).
 *
 * `describeEvent` sabe escribir la frase en castellano, y el server la manda en `description` para que una
 * interfaz que aun no la entiende no se quede en blanco. El cliente, en cambio, compone la frase a partir de
 * `action`: pinta `list_event.<slug>` con el sujeto y el nombre como parametros. Si el server anade una accion y
 * el diccionario no la tiene, el historial de esa accion se queda para siempre en el idioma del servidor: por eso
 * la lista de acciones y las claves tienen que estar sincronizadas, y eso es lo que comprueba este fichero.
 *
 * Vive en `server/` y no en `frontend/` porque el contrato del que se nace es el del server, y ahi es donde
 * `pnpm test` lo pilla (el frente usa Karma con ChromeHeadless, y en CI no hay navegador).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_ACTIONS } from './shopping-events.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const DICT = join(REPO_ROOT, 'frontend/src/app/core/i18n/dict/shopping_lists.ts');
const LABEL_KEYS = join(REPO_ROOT, 'frontend/src/app/core/i18n/labels.ts');
const MODEL = join(REPO_ROOT, 'frontend/src/app/shared/models/shopping.model.ts');

const ENTRY_RE = /'([a-z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'/g;

/** Los dos idiomas del dominio, que viven en el mismo fichero (`shoppingListsEs` y `shoppingListsEn`). */
function dicts(): { es: Map<string, string>; en: Map<string, string> } {
  const source = readFileSync(DICT, 'utf8');
  const cut = source.indexOf('export const shoppingListsEn');
  if (cut < 0) throw new Error('shopping_lists.ts deberia tener un bloque `shoppingListsEn`');
  const parse = (block: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const match of block.matchAll(ENTRY_RE)) out.set(match[1], match[2]);
    return out;
  };
  return { es: parse(source.slice(0, cut)), en: parse(source.slice(cut)) };
}

/** Las claves que el cliente declara para cada accion. */
function labelKeys(): Map<string, string> {
  const source = readFileSync(LABEL_KEYS, 'utf8');
  const start = source.indexOf('LIST_EVENT_LABEL_KEYS');
  if (start < 0) throw new Error('falta LIST_EVENT_LABEL_KEYS en label-keys.ts');
  const block = source.slice(start, source.indexOf('};', start));
  const out = new Map<string, string>();
  for (const match of block.matchAll(/'([a-z._-]+)':\s*'(list_event\.[a-z0-9_]+)'/g)) {
    out.set(match[1], match[2]);
  }
  return out;
}

/** La union `ListEventAction` del cliente: la que obliga al compilador a cubrir todas las acciones. */
function clientActions(): string[] {
  const source = readFileSync(MODEL, 'utf8');
  const start = source.indexOf('export type ListEventAction =');
  const block = source.slice(start, source.indexOf(';', start));
  return [...block.matchAll(/'([a-z._-]+)'/g)].map((match) => match[1]);
}

/** El cuerpo de `describeEvent`, accion por accion: quien interpola el articulo y quien no. */
function plantillasServer(): Map<string, string> {
  const source = readFileSync(join(__dirname, 'shopping-events.ts'), 'utf8');
  const out = new Map<string, string>();
  for (const match of source.matchAll(/case '([a-z._-]+)':\s*\n?\s*return ([^;]+);/g)) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

describe('historial de la lista: contrato de acciones y diccionario (## 12w)', () => {
  const server = EVENT_ACTIONS as unknown as string[];

  it('cada accion del server tiene su clave, y no sobra ninguna', () => {
    const keys = labelKeys();
    expect(keys.size).toBe(server.length);
    for (const action of server) expect(keys.has(action)).toBe(true);
    for (const action of keys.keys()) expect(server).toContain(action);
  });

  it('la union del cliente dice exactamente las acciones del server', () => {
    expect([...new Set(clientActions())].sort()).toEqual([...server].sort());
  });

  it('cada clave existe en los dos idiomas y lleva el sujeto', () => {
    const { es, en } = dicts();
    for (const key of labelKeys().values()) {
      expect(es.has(key)).toBe(true);
      expect(en.has(key)).toBe(true);
      expect(es.get(key)!.includes('{who}')).toBe(true);
      expect(en.get(key)!.includes('{who}')).toBe(true);
    }
  });

  it('el nombre del articulo solo lo llevan las acciones que de verdad lo mandan', () => {
    const { es, en } = dicts();
    const conNombre = new Set([...plantillasServer()].filter(([, body]) => body.includes('${item}')).map(([a]) => a));
    expect(conNombre.size).toBeGreaterThan(0);
    for (const [action, key] of labelKeys()) {
      const espera = conNombre.has(action);
      expect(es.get(key)!.includes('{item}')).toBe(espera);
      expect(en.get(key)!.includes('{item}')).toBe(espera);
    }
  });

  it('el espanol es la frase que hoy pinta el server, palabra por palabra', () => {
    // La prueba de que esto no reescribe la historia de nadie: en castellano tiene que salir lo mismo de siempre.
    const { es } = dicts();
    for (const [action, key] of labelKeys()) {
      const plantilla = plantillasServer().get(action);
      if (!plantilla) continue;
      const esperado = plantilla
        .replace(/^`/, '')
        .replace(/`$/, '')
        .replace(/\$\{who\}/g, '{who}')
        .replace(/\$\{item\}/g, ' «{item}»')
        .replace(/\s+/g, ' ')
        .trim();
      expect(es.get(key)).toBe(esperado);
    }
  });
});
