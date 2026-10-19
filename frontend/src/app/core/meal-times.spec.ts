import { MealType } from '../shared/models/calendar.model';
import { MEAL_ANCHOR_MINUTES } from './calendar-grid';
import {
  MEAL_TIME_DEFAULTS,
  mealAnchors,
  mealTimeOf,
  mealTimeToMinutes,
  mealTimesPatch,
  resolveMealTimes,
  selectedMealTypes
} from './meal-times';

/**
 * Las horas de la casa: lo que decide donde se sienta una comida en la rejilla y con que hora nace.
 * Se prueba aqui porque es aritmetica con un formato por delante, y un `NaN` en `topPx` no lo pinta
 * nadie: la rejilla simplemente deja de tener ese bloque.
 */

describe('resolveMealTimes', () => {
  it('sin nada guardado son las horas de la casa', () => {
    expect(resolveMealTimes(null)).toEqual(MEAL_TIME_DEFAULTS);
    expect(resolveMealTimes(undefined)).toEqual(MEAL_TIME_DEFAULTS);
    expect(resolveMealTimes({})).toEqual(MEAL_TIME_DEFAULTS);
  });

  it('lo guardado gana, y solo la comida que aparece', () => {
    expect(resolveMealTimes({ dinner: '22:15' })).toEqual({ ...MEAL_TIME_DEFAULTS, dinner: '22:15' });
  });

  it('una hora ilegible cae al defecto en vez de dar NaN', () => {
    const resolved = resolveMealTimes({ lunch: 'a comer', dinner: '25:70', breakfast: '9:5' });

    expect(resolved).toEqual(MEAL_TIME_DEFAULTS);
    // Un `NaN` colado aqui es un bloque que desaparece de la rejilla sin decir nada.
    expect(Object.values(mealAnchors(resolved)).every((value) => Number.isFinite(value))).toBe(true);
  });

  it('un json que no es un objeto no rompe la lectura', () => {
    expect(resolveMealTimes('desayuno')).toEqual(MEAL_TIME_DEFAULTS);
    expect(resolveMealTimes(7)).toEqual(MEAL_TIME_DEFAULTS);
  });
});

describe('mealAnchors', () => {
  it('traduce las horas a minutos del día', () => {
    expect(mealAnchors(resolveMealTimes(null))).toEqual({
      breakfast: 9 * 60,
      lunch: 14 * 60,
      snack: 17 * 60,
      dinner: 20 * 60 + 30
    });
  });

  it('respeta una casa que cena a las 22:15', () => {
    const anchors = mealAnchors(resolveMealTimes({ dinner: '22:15' }));

    expect(anchors.dinner).toBe(22 * 60 + 15);
    // Y el orden del dia sigue siendo el del dia: si alguien cena antes de merendar, la rejilla se
    // coloca con sus minutos, no con la costumbre de quien escribio el ancla.
    expect(anchors.lunch).toBeLessThan(anchors.dinner);
  });

  it('sin preferencia, la rejilla usa sus propias anclas', () => {
    expect(mealAnchors(null)).toEqual(MEAL_ANCHOR_MINUTES);
    expect(mealAnchors({ breakfast: undefined })).toEqual(MEAL_ANCHOR_MINUTES);
  });
});

describe('mealTimeOf', () => {
  it('prellena con la hora de la casa, también con el perfil a medio cargar', () => {
    expect(mealTimeOf(resolveMealTimes({ snack: '18:30' }), 'snack')).toBe('18:30');
    expect(mealTimeOf(null, 'breakfast')).toBe('09:00');
    expect(mealTimeOf({}, 'dinner')).toBe(MEAL_TIME_DEFAULTS.dinner);
  });
});

describe('selectedMealTypes', () => {
  it('no marcar ninguna es el día completo', () => {
    const all: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];

    expect(selectedMealTypes([])).toEqual(all);
    expect(selectedMealTypes(null)).toEqual(all);
    expect(selectedMealTypes(undefined)).toEqual(all);
  });

  it('devuelve el orden del día, sin duplicados y sin basura', () => {
    expect(selectedMealTypes(['dinner', 'lunch', 'dinner', 'postre'])).toEqual(['lunch', 'dinner']);
  });

  it('si no queda ninguna valida, se pide el día entero', () => {
    expect(selectedMealTypes(['postre', 'almuerzo'])).toEqual([
      'breakfast',
      'lunch',
      'snack',
      'dinner'
    ]);
  });
});

describe('mealTimeToMinutes', () => {
  it('lee HH:MM y no se traga lo demas', () => {
    expect(mealTimeToMinutes('20:30')).toBe(1230);
    expect(mealTimeToMinutes('9:30')).toBeNull();
    expect(mealTimeToMinutes('')).toBeNull();
  });
});

describe('mealTimesPatch', () => {
  /**
   * Lo que sale de un formulario de horas hacia el PATCH. Las tres reglas que importan son las que
   * evitan escribir de mas: no mandar nada si no se ha tocado nada (si no, «ver el defecto» se
   * convierte en «tener el defecto guardado» y un cambio futuro de la app ya no llega a esta casa),
   * mandar solo la comida editada, y mandar null al vaciar.
   */
  const saved = resolveMealTimes(null);

  it('no hay cambio, no hay payload', () => {
    expect(mealTimesPatch(saved, saved)).toBeUndefined();
    expect(mealTimesPatch({ ...saved, dinner: ' 20:30 ' }, saved)).toBeUndefined();
  });

  it('cambiar una comida manda esa comida', () => {
    expect(mealTimesPatch({ ...saved, dinner: '22:15' }, saved)).toEqual({ dinner: '22:15' });
  });

  it('vaciar manda null, que es «quita el horario»', () => {
    const stored = resolveMealTimes({ lunch: '13:00' });

    expect(mealTimesPatch({ ...stored, lunch: '' }, stored)).toEqual({ lunch: null });
  });

  it('las cuatro a la vez se mandan las cuatro', () => {
    const cleared = { breakfast: '', lunch: '', snack: '', dinner: '' };

    expect(mealTimesPatch(cleared, saved)).toEqual({
      breakfast: null,
      lunch: null,
      snack: null,
      dinner: null
    });
  });
});
