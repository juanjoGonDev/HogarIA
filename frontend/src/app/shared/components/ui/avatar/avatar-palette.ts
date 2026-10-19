/**
 * El color de un avatar, en puro y aparte del componente.
 *
 * Por que no vive dentro de `avatar.component.ts`: porque el componente es un `@Component` y un
 * spec que corre en node no puede importarlo (el JIT de `@angular/common` necesita el test
 * runner). Y aqui hay dos cosas que merecen un test: que la inicial SIEMPRE tenga detras un
 * circulo (falta de contraste que hizo invisible al avatar en toda la app), y que la eleccion
 * sea estable —la misma persona, el mismo color en la fila de la compra, en la auditoria y en
 * la agenda.
 */

/** Mismos ocho tonos de siempre: es la sena de identidad de cada nombre. */
export const AVATAR_COLORS = [
  '#F97316', '#22C55E', '#3B82F6', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F59E0B', '#EF4444'
] as const;

/** Tinte suave del color, para el fondo del circulo (el patron de Google: letra fuerte, disco claro). */
export const AVATAR_TINT = 0.84;

export type AvatarInk = { background: string; foreground: string };

function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

const toHex = (parts: number[]): string =>
  '#' + parts.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');

/** Mezcla con blanco (`amount` de `color`) o con negro (amount < 0). */
function mix(hex: string, target: [number, number, number], amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const k = Math.abs(amount);
  return toHex(rgb.map((c, i) => (amount >= 0 ? c + (target[i] - c) * k : c * (1 - k))));
}

/** Luminancia relativa (WCAG), para decidir de verdad que letra se ve sobre que fondo. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste entre dos colores, en el formato de WCAG (1..21). Sirve para poder exigir un minimo. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Tinta legible sobre `background`: la unica forma de que la inicial no dependa del azar. */
export function readableInkOn(background: string): string {
  // Se decide por contraste real, no por umbral de luminancia: sobre el naranja del marca el
  // blanco queda justo, y un `0.5` a ciegas habria elegido la peor de las dos tintas.
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#0B1220') ? '#FFFFFF' : '#0B1220';
}

/** El indice que le toca a un nombre: el mismo nombre, el mismo color, siempre. */
export function avatarColorIndex(name: string | null | undefined): number {
  const clean = String(name ?? '').trim();
  if (!clean) return 0;
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % AVATAR_COLORS.length;
}

/**
 * Fondo y letra del avatar. Con `explicit` (un color que pone la vista, p. ej. el de una tienda)
 * se respeta tal cual y solo se decide la tinta; sin el, el disco se tenia del color del nombre:
 * un circulo del color entero con letras blancas desaparece en cuanto el tema es claro.
 */
export function avatarInk(name: string | null | undefined, explicit?: string | null): AvatarInk {
  if (explicit) return { background: explicit, foreground: readableInkOn(explicit) };
  const base = AVATAR_COLORS[avatarColorIndex(name)];
  const background = mix(base, [255, 255, 255], AVATAR_TINT); // disco claro, como el chip de cuenta de Google
  const foreground = mix(base, [11, 18, 32], -0.62);
  // Y si aun asi la pareja no contrasta (un `color` exotico, un nombre raro), se corrige la
  // tinta: el contraste de la inicial no es algo que se pueda dejar al azar del tema.
  return { background, foreground: contrastRatio(background, foreground) >= 4.5 ? foreground : readableInkOn(background) };
}

/** Las iniciales: una o dos letras, y el `?` de quien no tiene nombre. */
export function initialsOf(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = [...parts[0]][0] ?? '?';
  if (parts.length === 1) return first.toUpperCase();
  return (first + [...parts[parts.length - 1]][0]).toUpperCase();
}
