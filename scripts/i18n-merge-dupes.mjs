#!/usr/bin/env node
// =============================================================================
// i18n-merge-dupes — una cadena, una clave.
//
//   node scripts/i18n-merge-dupes.mjs [--write]
//
// El extractor de esta tanda crea las claves a partir del texto, y lo hace por dominio: «Guardar» en la
// compra, «Guardar» en el calendario y «Guardar» en Preferencias salen con tres claves distintas, con un
// `common.save` que ya existia y nadie usa. Tres claves para la misma frase son tres traducciones que
// manana se pueden separar sin que nadie se entere, y un diccionario que nadie revisa.
//
// Este pase junta: por cada texto repetido elige una canonica (`common.*` > `ui.*` > `nav.*` > la mas
// corta), reescribe las referencias por todo el frontend y borra las demas del diccionario. Idempotente.
//
// Tambien avisa de las traducciones distintas de un mismo texto cuando alguien las una a mano: si dos
// claves `es` coinciden pero sus `en` difieren, fusionarlas cambia una de las dos pantallas en ingles,
// y eso lo tiene que ver una persona —por eso el informe los marca, no los calla.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP = join(ROOT, 'frontend/src/app');
const DICT_DIR = join(APP, 'core/i18n/dict');
const write = process.argv.includes('--write');

const KEY_LINE = /'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
const unescape = (s) => (s ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"');

const blocks = (text) => {
  const es = text.match(/export const \w+Es[^{]*\{([\s\S]*?)\n\}/);
  const en = text.match(/export const \w+En[^{]*\{([\s\S]*?)\n\}/);
  const read = (block) => {
    const out = new Map();
    if (block) for (const m of block[1].matchAll(KEY_LINE)) out.set(m[1], unescape(m[2] ?? m[3]));
    return out;
  };
  return { es: read(es), en: read(en) };
};

const dictFiles = readdirSync(DICT_DIR).filter((f) => f.endsWith('.ts') && f !== 'types.ts');
const byText = new Map();
const dictOf = new Map();
const englishOf = new Map();
for (const file of dictFiles) {
  const { es, en } = blocks(readFileSync(join(DICT_DIR, file), 'utf8'));
  for (const [key, value] of es) {
    dictOf.set(key, file);
    englishOf.set(key, en.get(key) ?? '');
    if (!value) continue;
    if (!byText.has(value)) byText.set(value, []);
    byText.get(value).push(key);
  }
}

const rank = (key) =>
  (key.startsWith('common.') ? 0 : key.startsWith('ui.') ? 1 : key.startsWith('nav.') ? 2 : 3) * 1000 + key.length;

const groups = [];
for (const [value, keys] of byText) {
  if (new Set(keys).size < 2) continue;
  const uniq = [...new Set(keys)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  groups.push({ value, canonical: uniq[0], obsolete: uniq.slice(1) });
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const sources = walk(APP, []).filter((path) => !path.startsWith(DICT_DIR));
let rewrites = 0;
const conflicts = [];

if (write) {
  const obsolete = new Map();
  for (const g of groups) for (const key of g.obsolete) obsolete.set(key, g.canonical);

  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    let next = text;
    for (const [key, canonical] of obsolete) {
      const re = new RegExp(`'${key.replace(/\./g, '\\.')}'`, 'g');
      const hits = next.match(re);
      if (!hits) continue;
      rewrites += hits.length;
      next = next.replace(re, `'${canonical}'`);
    }
    if (next !== text) writeFileSync(file, next);
  }

  for (const [key, canonical] of obsolete) {
    if (englishOf.get(key) && englishOf.get(key) !== englishOf.get(canonical)) {
      conflicts.push([canonical, key]);
    }
    const file = dictOf.get(key);
    if (!file) continue;
    const path = join(DICT_DIR, file);
    let text = readFileSync(path, 'utf8');
    const re = new RegExp(`\n *'${key.replace(/\./g, '\\.')}'\\s*:\\s*(?:'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"),`, 'g');
    const before = text;
    text = text.replace(re, '');
    if (text !== before) writeFileSync(path, text);
  }
}

for (const g of groups) {
  console.log(`${write ? 'unida  ' : 'dupdo  '} ${JSON.stringify(g.value).slice(0, 46)}  →  ${g.canonical}   (fuera: ${g.obsolete.join(', ')})`);
}
for (const [canonical, key] of conflicts) {
  console.log(`! ${key} se fusiona en ${canonical} pero el ingles era otro: revisa la pantalla que usaba la segunda.`);
}
console.log(`\n${groups.length} frases con mas de una clave, ${rewrites} referencias ${write ? 'reescritas' : 'que hay que reescribir (--write)'}.`);
