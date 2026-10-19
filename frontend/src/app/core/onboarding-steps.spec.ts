import {
  ONBOARDING_STEPS,
  STEP_TITLE_KEYS,
  isLastIndex,
  nextIndex,
  stepLabel,
  tourStatus
} from './onboarding-steps';

/**
 * La maquina del tour, sin Angular. Lo que se prueba es lo que el usuario no puede ver hasta que se
 * equivoca: que el contador se deriva de la lista (no de un numero escrito a mano por cada paso), que
 * saltar el ultimo paso no deja la pantalla en blanco y que saltarselo todo no queda registrado como
 * «ya configurado».
 */

describe('la lista de pasos', () => {
  it('pregunta los horarios justo despues del objetivo', () => {
    // No es un capricho de orden: las horas se contestan con la cabeza aun en «que objetivo tengo»,
    // y el ultimo paso (utensilios) manda a la despensa, asi que ir despues de romper el flujo.
    expect(ONBOARDING_STEPS.indexOf('meals')).toBe(ONBOARDING_STEPS.indexOf('goal') + 1);
    expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]).toBe('kitchen');
  });

  it('cada paso de la lista tiene su titulo', () => {
    // Si alguien anade un id a `ONBOARDING_STEPS` y se olvida del mapa, la cabecera cae al fallback y
    // el usuario ve «Paso» a secas: esto es lo que lo pilla.
    for (const step of ONBOARDING_STEPS) {
      expect(stepLabel(ONBOARDING_STEPS.indexOf(step)).tituloKey).toBe(STEP_TITLE_KEYS[step]);
      expect(STEP_TITLE_KEYS[step]).toContain('onboarding.'); // clave, no prosa: lo traduce la pantalla
    }
  });
});

describe('stepLabel', () => {
  it('numera desde uno y cuenta la lista entera', () => {
    expect(stepLabel(0)).toEqual({ numero: 1, total: 6, tituloKey: 'onboarding.paso_perfil', skipped: false });
    expect(stepLabel(4)).toEqual({ numero: 5, total: 6, tituloKey: 'onboarding.paso_horarios', skipped: false });
  });

  it('el numero se deriva de la lista: anadir un paso no obliga a tocar la plantilla', () => {
    const short = ['goal', 'meals', 'kitchen'] as const;

    expect(stepLabel(1, short)).toEqual({ numero: 2, total: 3, tituloKey: 'onboarding.paso_horarios', skipped: false });
  });

  it('un indice fuera de rango no pinta «Paso 7 de 6» ni «undefined»', () => {
    expect(stepLabel(99).numero).toBe(6);
    expect(stepLabel(99).tituloKey).toBe('onboarding.paso_cocina');
    expect(stepLabel(-3).numero).toBe(1);
    expect(stepLabel(-3).tituloKey).toBe('onboarding.paso_perfil');
  });

  it('un paso saltado lo dice en la cabecera', () => {
    expect(stepLabel(1, ONBOARDING_STEPS, true).skipped).toBe(true);
  });
});

describe('nextIndex e isLastIndex', () => {
  it('el ultimo paso se queda en el ultimo, no se sale de la lista', () => {
    expect(nextIndex(4, 6)).toBe(5);
    expect(nextIndex(5, 6)).toBe(5);
    expect(isLastIndex(5, 6)).toBe(true);
    expect(isLastIndex(4, 6)).toBe(false);
  });

  it('una lista de un solo paso es la ultima y la primera', () => {
    expect(nextIndex(0, 1)).toBe(0);
    expect(isLastIndex(0, 1)).toBe(true);
  });
});

describe('tourStatus', () => {
  it('sin saltar nada, el tour esta hecho', () => {
    expect(tourStatus([])).toBe('done');
  });

  it('saltar todos los pasos es saltarse el tour', () => {
    expect(tourStatus([...ONBOARDING_STEPS])).toBe('skipped');
  });

  it('saltar uno o dos sigue siendo un tour contestado', () => {
    expect(tourStatus(['allergies'])).toBe('done');
    expect(tourStatus(['goal', 'kitchen'])).toBe('done');
  });

  it('la basura y los duplicados no inventan un «skipped»', () => {
    const almost = ONBOARDING_STEPS.slice(0, -1);

    expect(tourStatus([...almost, ...almost, 'insectos'])).toBe('done');
  });
});
