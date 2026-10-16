import { TestBed } from '@angular/core/testing';
import { DICTS, type TranslationKey } from '../../core/i18n';
import { recipesEn, recipesEs } from '../../core/i18n/dict/recipes';
import { DifficultyPipe, difficultyLabel } from './difficulty.pipe';
import { I18nService } from '../../core/services/i18n.service';

/**
 * `t` se le pasa por parametro y el diccionario en espanol es el de verdad: el pipe no tiene logica propia,
 * y lo que puede romperse es el reparto de claves, el punto de color y el «esto no es una dificultad».
 */
const es = (key: TranslationKey) =>
  (({ ...DICTS.es, ...recipesEs }) as Record<string, string>)[key] ?? key;

describe('difficultyLabel', () => {
  it('traduce las tres', () => {
    expect(difficultyLabel('easy', es)).toBe('Fácil');
    expect(difficultyLabel('medium', es)).toBe('Medio');
    expect(difficultyLabel('hard', es)).toBe('Difícil');
  });

  it('la marca no la cambia el idioma', () => {
    const en = (key: TranslationKey) =>
      (({ ...DICTS.en, ...recipesEn }) as Record<string, string>)[key] ?? key;
    expect(difficultyLabel('easy', en)).toBe('Easy');
    expect(difficultyLabel('hard', en)).toBe('Hard');
  });

  it('ante una dificultad que no conoce, ensena el dato, no una clave', () => {
    expect(difficultyLabel('Experta en frituras', es)).toBe('Experta en frituras');
  });

  it('never adds a pictogram to a difficulty label', () => {
    expect(difficultyLabel('easy', es)).toBe('Fácil');
    expect(difficultyLabel('rara', es)).toBe('rara');
  });

  it('sin dato, nada', () => {
    expect(difficultyLabel(null, es)).toBe('');
    expect(difficultyLabel(undefined, es)).toBe('');
    expect(difficultyLabel('', es)).toBe('');
  });

  it('acepta la cadena como la escribio la IA, en lo que sea', () => {
    expect(difficultyLabel('HARD', es)).toBe('Difícil');
  });
});

describe('DifficultyPipe', () => {
  it('uses the active language without adding an icon', async () => {
    TestBed.configureTestingModule({ providers: [DifficultyPipe, I18nService] });
    const i18n = TestBed.inject(I18nService);
    await i18n.loadRecipeTranslations();
    const pipe = TestBed.inject(DifficultyPipe);
    const label = pipe.transform('medium');

    expect(label).toBe('Medio');
    expect(label).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
