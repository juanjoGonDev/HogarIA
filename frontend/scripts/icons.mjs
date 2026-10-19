#!/usr/bin/env node
/**
 * Regenera `src/app/shared/components/ui/icon/icon-paths.ts` desde `@material-icons/svg`
 * (variante baseline, rejilla 24x24).
 *
 * El script esta en el repo a proposito: la alternativa a "no hay forma de anadir un
 * icono" es que alguien eche mano de un emoji. Copiar los `d` dentro de un fichero TS,
 * en vez de una fuente web, es lo que hace que `name="chekc"` no compile y que la app
 * siga pintando iconos sin red (PWA).
 *
 *   node scripts/icons.mjs
 *   node scripts/icons.mjs --src /ruta/a/svg
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NAMES = [
  'account_circle', 'add', 'add_a_photo', 'add_circle', 'add_shopping_cart', 'arrow_drop_down',
  'calendar_today', 'calendar_view_month', 'camera_alt', 'check', 'check_circle', 'chevron_left',
  'chevron_right', 'cloud_off', 'close', 'content_copy', 'content_paste', 'delete', 'delete_sweep',
  'description', 'discount', 'done_all', 'drag_indicator', 'edit', 'error_outline', 'event_available',
  'event_busy', 'event_note', 'expand_less', 'expand_more', 'favorite', 'filter_list', 'flag',
  'group', 'help_outline', 'history', 'home', 'image', 'location_on', 'local_offer', 'menu', 'payments',
  'sell', 'euro_symbol', 'check_box', 'check_box_outline_blank', 'receipt_long', 'storefront', 'link', 'link_off', 'paid',
  'more_vert', 'notifications', 'percent', 'person', 'photo_camera', 'playlist_add', 'radio_button_unchecked',
  'refresh', 'remove', 'remove_circle', 'remove_shopping_cart', 'schedule', 'search', 'select_all',
  'send', 'settings', 'shopping_basket', 'shopping_cart', 'star', 'sync_problem', 'tune',
  'undo', 'unfold_more', 'visibility',
  // Familias de unidad del selector de la hoja de linea (§12h): un icono por familia para que
  // el panel se recorra de un vistazo con el pulgar.
  'scale', 'local_drink', 'numbers', 'inventory_2', 'kitchen',
  // El visor de logs: pausar/reanudar son botones con icono, no un glifo del sistema.
  'play_arrow', 'pause',
  // El layout: los navItems del sidebar y de la barra inferior eran emojis del sistema.
  'menu_book', 'smart_toy', 'logout'
];

const OUT = join(ROOT, 'src/app/shared/components/ui/icon/icon-paths.ts');
const HEADER = readFileSync(OUT, 'utf8').split('export const ICON_SHAPES')[0];
const FOOTER = "\nexport type IconName = keyof typeof ICON_SHAPES;\n\n/** `true` si el nombre existe. */\nexport function hasIcon(name: string): name is IconName {\n  return Object.prototype.hasOwnProperty.call(ICON_SHAPES, name);\n}\n";

const args = process.argv.slice(2);
const srcIdx = args.indexOf('--src');
const SRC = srcIdx >= 0 ? args[srcIdx + 1] : join(ROOT, 'node_modules/@material-icons/svg/svg');

const entries = [];
const missing = [];
for (const name of NAMES) {
  const file = join(SRC, name, 'baseline.svg');
  let svg = '';
  try {
    svg = readFileSync(file, 'utf8');
  } catch {
    missing.push(name);
    continue;
  }
  const viewBox = (svg.match(/viewBox="([^"]+)"/) ?? [])[1] ?? '0 0 24 24';
  const d = [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
  if (!d.length) {
    missing.push(`${name} (sin path)`);
    continue;
  }
  entries.push(
    d.length === 1
      ? `  "${name}": { viewBox: '${viewBox}', d: ['${d[0]}'] },`
      : `  "${name}": { viewBox: '${viewBox}', d: [\n${d.map((x) => `    '${x}'`).join(',\n')}\n  ] },`
  );
}

if (!entries.length) {
  // Escribir un fichero vacio "porque no estaba el paquete" es la peor manera de fallar:
  // borra 60 iconos y la app solo se rompe en produccion.
  throw new Error(`no hay SVG en ${SRC} — instala @material-icons/svg o pasa --src`);
}

writeFileSync(OUT, `${HEADER}export const ICON_SHAPES = {\n${entries.join('\n')}\n} as const;\n${FOOTER}`);
console.log(`${entries.length} iconos escritos en ${OUT}`);
if (missing.length) console.log(`AVISO, faltan: ${missing.join(', ')}`);
