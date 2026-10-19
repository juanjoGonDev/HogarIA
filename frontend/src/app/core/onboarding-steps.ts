/**
 * La maquina del tour: los pasos, su numero y lo que significa haberlos saltado.
 *
 * Vive aqui y no dentro del componente porque es la parte que se puede equivocar sin que nadie lo vea
 * en un build: «Paso 3 de 5» con seis pasos, un paso que se salta y te deja en el mismo sitio, o un
 * tour saltado por completo que se registra como terminado son fallos de estado, no de pintura.
 *
 * Los pasos son una lista de ids, en el orden en que se preguntan. El numero que ve el usuario se
 * deriva de la posicion y el titulo de `STEP_TITLE_KEYS`: anadir una pregunta es una linea aqui y un
 * bloque en la plantilla, no renumerar media pantalla a mano (que es como se queda un «Paso 4 de 6»
 * en la ultima).
 */
import type { TranslationKey } from './i18n';

export const ONBOARDING_STEPS = ['profile', 'allergies', 'tastes', 'goal', 'meals', 'kitchen'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * El titulo de cada paso, en clave. Que no sea una cadena es el punto: «Horarios» escrito en un modulo
 * puro se pinta en castellano con la app en ingles, y ese modulo no puede traducir (HOGARIA-SPEC 12t-i18n).
 */
export const STEP_TITLE_KEYS: Record<OnboardingStep, TranslationKey> = {
  profile: 'onboarding.paso_perfil',
  allergies: 'onboarding.paso_alergias',
  tastes: 'onboarding.paso_gustos',
  goal: 'onboarding.paso_objetivo',
  meals: 'onboarding.paso_horarios',
  kitchen: 'onboarding.paso_cocina'
};

/** Lo que la cabecera necesita saber; la frase la arma la pantalla con el diccionario. */
export interface StepLabel {
  /** Numerado desde uno, con el indice ya recortado al rango. */
  numero: number;
  total: number;
  tituloKey: TranslationKey;
  skipped: boolean;
}

/** La cabecera de encima de la barra: numero derivado, titulo del paso y, si se ha saltado, eso mismo. */
export function stepLabel(
  index: number,
  steps: readonly OnboardingStep[] = ONBOARDING_STEPS,
  skipped = false
): StepLabel {
  const total = steps.length;
  const safe = Math.max(0, Math.min(total - 1, Math.trunc(index)));
  return {
    numero: safe + 1,
    total,
    // El indice fuera de rango no pinta «undefined»: cae en la clave suelta, que al menos se traduce.
    tituloKey: steps[safe] ? STEP_TITLE_KEYS[steps[safe]] : 'onboarding.paso_suelto',
    skipped
  };
}

/** Siguiente paso, sin pasarse del ultimo: `next()` en el ultimo no puede irse a undefined. */
export function nextIndex(index: number, total: number): number {
  return Math.max(0, Math.min(total - 1, Math.trunc(index) + 1));
}

export function isLastIndex(index: number, total: number): boolean {
  return Math.trunc(index) >= total - 1;
}

/**
 * Si el usuario ha acabado el tour o lo ha saltado.
 *
 * Saltar los pasos UNO A UNO tiene que valer lo mismo que pulsar «Saltar por ahora»: el estado solo
 * dice «done» cuando algo se ha contestado de verdad. Con todos los pasos saltados no hay perfil, y
 * registrarlo como hecho es la forma elegante de que nadie vuelva a preguntar por las alergias.
 */
export function tourStatus(
  skipped: readonly string[],
  all: readonly OnboardingStep[] = ONBOARDING_STEPS
): 'done' | 'skipped' {
  const seen = new Set(skipped);
  return all.every((step) => seen.has(step)) ? 'skipped' : 'done';
}
