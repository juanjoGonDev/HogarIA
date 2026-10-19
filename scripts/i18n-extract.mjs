#!/usr/bin/env node
// =============================================================================
// i18n-extract — pasa un literal de la plantilla al diccionario, en seco o en serio.
//
//   node scripts/i18n-extract.mjs <fichero.component.ts>... [--domain <dominio>] [--write]
//
// Que hace, por cada fichero:
//   1. localiza el bloque `template:`;
//   2. saca los literales que se ven en pantalla (nodos de texto y los atributos `placeholder`,
//      `aria-label`, `title`, `alt`, `label`, `heading`, `message`, `confirmText`, `cancelText`);
//   3. los sustituye por `{{ 'dom.clave' | t }}` / `[placeholder]="'dom.clave' | t"`, mete
//      `TranslatePipe` en los `imports` del componente y escribe la cadena en `core/i18n/dict/<dom>.ts`;
//   4. lo que no puede resolver solo (texto mezclado con `{{ }}`, o literales dentro de una expresion)
//      lo lista como MANUAL para hacerlo a mano — y la regla 14 de `check-ui.mjs` no deja olvidarlo.
//
// Por que una herramienta y no buscar-y-reemplazar a mano: son 502 literales en 29 ficheros, y el
// trabajo mecanico de dar claves, mover cadenas al diccionario y reescribir la plantilla es justo el
// que a esa escala un humano hace mal. Las traducciones las escribe una persona: el script deja el `en`
// vacio y `check-ui` lo canta, asi que una cadena sin traducir no llega a `main`.
//
// Idempotente: si el literal ya esta en el diccionario se reutiliza su clave (repetir "Guardar" treinta
// veces no anade treinta claves).
// =============================================================================

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const APP = join(ROOT, 'frontend/src/app');
const DICT_DIR = join(APP, 'core/i18n/dict');

const args = process.argv.slice(2);
const write = args.includes('--write');
const di = args.indexOf('--domain');
const forcedDomain = di >= 0 ? args[di + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && !(di >= 0 && i === di + 1));

if (files.length === 0) {
  console.error('uso: node scripts/i18n-extract.mjs <fichero.ts>... [--domain <dominio>] [--write]');
  process.exit(2);
}

// Atributos que se leen en pantalla. `aria-label` y `title` cuentan igual que lo visible: un lector de
// pantalla lo dice en voz alta y un tooltip se lee.
const ATTRS = [
  ['placeholder', 'binding'],
  ['label', 'binding'],
  ['alt', 'binding'],
  ['heading', 'binding'],
  ['message', 'binding'],
  ['confirmText', 'binding'],
  ['cancelText', 'binding'],
  ['app-tooltip', 'binding'],
  ['aria-label', 'attr'],
  ['title', 'attr'],
];

// Lo que no es texto de la interfaz aunque este en un nodo de texto: unidades y simbolos que son iguales
// en los dos idiomas. Anadir aqui es una decision de producto, no un truco para pasar el gate.
const SKIP = new Set(['g', 'kg', 'mg', 'lb', 'ml', 'l', 'cl', 'dl', 'ud', 'u', 'un', 'x', '%', '€', '—', '·', '•', '...']);

/** `ai-config` como nombre de fichero y `aiConfig` como identificador: los dos de un mismo dominio. */
const ident = (d) => d.replace(/[-_](\w)/g, (m, c) => c.toUpperCase());

const slugify = (s) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 4).join('_');

const domainOf = (file) =>
  forcedDomain ?? basename(file).replace(/\.(component\.)?ts$/, '').replace(/[^a-z0-9]+/g, '_');

/** El bloque `template: \`...\``. Un backtick dentro del template = no lo tocamos, se hace a mano. */
function templateBlock(src) {
  const open = src.indexOf('template: `');
  if (open < 0) return null;
  const start = open + 'template: `'.length;
  const close = src.indexOf('`', start);
  if (close < 0) return null;
  const inner = src.slice(start, close);
  if (inner.includes('`')) return { error: 'el template lleva backticks: extraccion a mano' };
  return { start, close, inner };
}

// Una cadena de la plantilla esta en el DOM, y ahi `&#10;` es un salto de linea; dentro del diccionario es
// el literal `&#10;` (una property binding no decodifica entidades). Se decodifican al copiar, si no la
// traduccion sale con la entidad a la vista. Los acentos que el proyecto escribe sin entidad NO se tocan:
// «conexion» se queda como esta, porque cambiar ortografia rompe los e2e que assertan ese texto.
const ENTITIES = {
  '&nbsp;': ' ',
  '&#10;': '\n',
  '&#13;': '',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"'
};
const decodeEntities = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, named) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    const direct = ENTITIES[whole.toLowerCase()];
    return direct === undefined ? whole : direct;
  });

const quote = (s) =>
  `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    // Una entidad decodificada puede traer un salto de linea (`&#10;` de un placeholder multilinea): dentro
    // del literal del diccionario tiene que quedar escapado, si no el fichero no compila.
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')}'`;

/**
 * Index global de texto -> clave, sobre TODOS los diccionarios. Sin esto, cada dominio acunaba su clave
 * para la misma frase («Guardar» en cuatro pantallas = cuatro claves = cuatro traducciones que se
 * separan manana). Reutilizar la existente es lo que mantiene el diccionario como un vocabulario y no
 * como un almacen. `scripts/i18n-merge-dupes.mjs` es la version de despues, para lo que ya estaba
 * duplicado cuando esto empezo.
 */
const globalIndex = () => {
  const map = new Map();
  if (!existsSync(DICT_DIR)) return map;
  for (const file of readdirSync(DICT_DIR)) {
    if (!file.endsWith('.ts') || file === 'types.ts') continue;
    const text = readFileSync(join(DICT_DIR, file), 'utf8');
    const es = text.match(/export const \w+Es[^{]*\{([\s\S]*?)\n\}/);
    if (!es) continue;
    for (const kv of es[1].matchAll(/'([^']+)':\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
      const value = (kv[2] ?? kv[3] ?? '').replace(/\\'/g, "'");
      if (value && !map.has(value)) map.set(value, kv[1]);
    }
  }
  return map;
};

function loadDict(domain) {
  const path = join(DICT_DIR, `${domain}.ts`);
  if (!existsSync(path)) {
    const seed =
      `// Diccionario del dominio \`${domain}\`: texto de la interfaz, lo que la app dice. No va aqui lo que se\n` +
      `// guarda ni lo que se envia a la IA (HOGARIA-SPEC §12s-A). El \`en\` lo escribe una persona.\n` +
      `export const ${ident(domain)}Es = {\n} as const;\n\n` +
      `export const ${ident(domain)}En: Record<keyof typeof ${ident(domain)}Es, string> = {\n};\n`;
    return { path, text: seed, es: new Map(), en: new Map(), fresh: true };
  }
  const text = readFileSync(path, 'utf8');
  const grab = (name) => {
    const m = text.match(new RegExp(`const ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`));
    const map = new Map();
    if (m) for (const kv of m[1].matchAll(/'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g)) map.set(kv[1], kv[2].replace(/\\'/g, "'"));
    return map;
  };
  return { path, text, es: grab(`${ident(domain)}Es`), en: grab(`${ident(domain)}En`), fresh: false };
}

const PIPE_IMPORT = (file) => {
  const rel = relative(dirname(join(ROOT, file)), join(APP, 'core/pipes/translate.pipe')).replace(/\\/g, '/');
  return `import { TranslatePipe } from '${rel.startsWith('.') ? rel : './' + rel}';`;
};

let grandTotal = 0;
for (const file of files) {
  const abs = join(ROOT, file);
  let src = readFileSync(abs, 'utf8');
  const tpl = templateBlock(src);
  if (!tpl) {
    console.log(`— ${file}: sin \`template: \\\`\` (templateUrl o sin plantilla): a mano`);
    continue;
  }
  if (tpl.error) {
    console.log(`! ${file}: ${tpl.error}`);
    continue;
  }

  const domain = domainOf(file);
  const dict = loadDict(domain);
  const keyOfText = globalIndex();

  const added = [];
  const manual = [];
  const reuse = new Set();
  const lineAt = (i) => tpl.inner.slice(0, i).split('\n').length;
  let out = tpl.inner;

  const useKey = (text) => {
    let clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || SKIP.has(clean.toLowerCase())) return null;
    if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/.test(clean)) return null;
    // Un token tecnico en minusculas (una url, `sk-...`, el id de un modelo) se escribe igual en todos los
    // idiomas: es un ejemplo, no prosa. Si manana hay que traducirlo, se quita de aqui con un motivo.
    if (/^[a-z0-9][a-z0-9.+:/_-]*$/.test(clean)) return null;
    clean = decodeEntities(clean);
    let key = keyOfText.get(clean);
    if (!key) {
      const base = `${domain}.${slugify(clean) || 'text'}`;
      key = base;
      let n = 2;
      while (dict.es.has(key)) key = `${base}_${n++}`;
      dict.es.set(key, clean);
      dict.en.set(key, '');
      added.push([key, clean]);
      keyOfText.set(clean, key);
      reuse.add(key);
    }
    return key;
  };

  for (const [attr, mode] of ATTRS) {
    const re = new RegExp(`([\\s])${attr}="([^"{}]+)"`, 'g');
    out = out.replace(re, (whole, gap, value) => {
      const key = useKey(value);
      if (!key) return whole;
      const lhs = mode === 'binding' ? `[${attr}]` : `[attr.${attr}]`;
      return `${gap}${lhs}="'${key}' | t"`;
    });
  }

  out = out.replace(/>([^<>]+)</g, (whole, text, offset) => {
    // Un nodo con llaves, parentesis o comillas no es prosa limpia: o es solo una expresion (no hay nada
    // que traducir) o hay que reescribir la frase con {parametros}, y eso lo decide una persona. Aqui se
    // clasifica; lo que necesite mano sale como MANUAL y la regla 14 de check-ui no deja olvidarlo.
    const stripped = text.replace(/\{\{[\s\S]*?\}\}/g, ' ').replace(/\s+/g, ' ').trim();
    const esProsa = (stripped.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}(\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})+/g) || []).length > 0;
    // Linea de control de flujo (`@for (x of y; track x) {`, `} @else {`): estructura, no texto.
    if (/^\s*\}?\s*@/.test(text) || /;\s*track\s/.test(text)) return whole;
    // Con llaves o comillas hay que reescribir la frase ({param}, «»): se avisa y no se toca. Los
    // parentesis SI se permiten —"Quién viene (opcional)" es una frase entera y traducible—.
    if (/[{}"'`]/.test(text)) {
      if (esProsa) manual.push([lineAt(offset), text.replace(/\s+/g, ' ').trim()]);
      return whole;
    }
    const parts = text.split('\n');
    const joined = parts.map((p) => p.trim()).join(' ').replace(/\s+/g, ' ').trim();
    if (!joined) return whole;
    const key = useKey(joined);
    if (!key) return whole;
    if (parts.length === 1) return `>{{ '${key}' | t }}<`;
    const lead = text.match(/^\s*/)[0];
    const tail = text.match(/\s*$/)[0];
    // Los `>` y `<` van tambien en el caso multinea: son el borde del elemento, no parte del texto, y
    // perderlos deja `</button>` convertido en `/button>` (paso por alto en la primera pasada del script).
    return `>${lead}{{ '${key}' | t }}${tail}<`;
  });

  // La plantilla se escribe primero: tpl.start/tpl.close son offsets del `src` original, y meter la pipe
  // en `imports` antes de tiempo los descolocaria y el recorte se comeria trozos del componente. (Lesion
  // aprendida en la tanda 19 con un script que movia CSS dentro de un .component.ts: un script que
  // reescribe ficheros se comprueba con `tsc`, no con la vista.)
  let note = '';
  const withPipe = () => {
    if (/TranslatePipe/.test(src)) {
      note = ' (TranslatePipe ya estaba)';
      return;
    }
    const m = src.match(/imports:\s*\[/);
    if (!m) {
      note = ' (SIN imports[]: anade TranslatePipe a mano)';
      return;
    }
    src = src.slice(0, m.index + m[0].length) + `\n    TranslatePipe,\n    ` + src.slice(m.index + m[0].length);
    if (!src.includes('core/pipes/translate.pipe')) {
      // Detras del ultimo import, no delante del primero: el orden del fichero (framework, Angular, local)
      // es lo que hace legible un diff, y aqui no hay linter de importaciones que lo ordene por ti.
      const lasts = [...src.matchAll(/^import [\s\S]*?;$/gm)];
      const at = lasts[lasts.length - 1];
      src = src.slice(0, at.index + at[0].length) + '\n' + PIPE_IMPORT(file) + src.slice(at.index + at[0].length);
    }
    note = ' +TranslatePipe';
  };

  grandTotal += added.length;
  console.log(`${file} [${domain}] — ${added.length} claves nuevas${note}`);
  for (const [l, t] of manual) console.log(`   MANUAL linea ${l}: ${t}`);
  for (const [k, v] of added) console.log(`   ${k} = ${v}`);
  if (!write) continue;

  if (out !== tpl.inner) src = src.slice(0, tpl.start) + out + src.slice(tpl.close);
  if (added.length) withPipe();
  writeFileSync(abs, src);

  if (added.length) {
    let text = dict.fresh ? dict.text : readFileSync(dict.path, 'utf8');
    for (const [name, map] of [[`${ident(domain)}Es`, dict.es], [`${ident(domain)}En`, dict.en]]) {
      const re = new RegExp(`(const ${name}[^{]*\\{)([\\s\\S]*?)(\\n\\})`);
      const m = text.match(re);
      if (!m) {
        console.log(`   ! no encuentro ${name} en ${domain}.ts: escribe las claves a mano`);
        continue;
      }
      const lines = m[2].split('\n').filter((l) => /^\s*'/.test(l));
      for (const [k, v] of added) {
        const value = name.endsWith('En') ? "''" : quote(v);
        if (!lines.some((l) => l.trim().startsWith(`${quote(k)}:`))) lines.push(`  ${quote(k)}: ${value},`);
      }
      lines.sort((a, b) => a.localeCompare(b, 'en'));
      text = text.replace(m[0], `${m[1]}${lines.length ? '\n' + lines.join('\n') : ''}${m[3]}`);
    }
    writeFileSync(dict.path, text);

    const index = join(DICT_DIR, '..', 'index.ts');
    let idx = readFileSync(index, 'utf8');
    if (dict.fresh && !idx.includes(`'./dict/${domain}'`)) {
      const first = idx.match(/^import .*$/m);
      idx = idx.slice(0, first.index) + `import { ${ident(domain)}Es, ${ident(domain)}En } from './dict/${domain}';` + '\n' + idx.slice(first.index);
      idx = idx.replace(/(const es = \{\n)/, `$1  ...${ident(domain)}Es,\n`);
      idx = idx.replace(/(const en: Record<keyof typeof es, string> = \{\n)/, `$1  ...${ident(domain)}En,\n`);
      writeFileSync(index, idx);
      console.log(`   dominio nuevo: registrado en core/i18n/index.ts`);
    }
  }
}
console.log(write ? `\nescritas ${grandTotal} claves. Ahora falta el ingles: escribe los '' del diccionario (check-ui los canta).` : `\nsin escribir; --write para ello.`);
