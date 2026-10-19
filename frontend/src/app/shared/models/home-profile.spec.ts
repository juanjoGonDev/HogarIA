import { profileEs, profileEn } from '../../core/i18n/dict/profile';
import { authEs, authEn } from '../../core/i18n/dict/auth';
import {
  COOKING_LEVEL_LABEL_KEYS,
  COOKING_LEVEL_OPTIONS,
  cookingLevelWord,
  DEFAULT_HOME_PROFILE,
  detailLevelHintKey,
  HOME_MODULES,
  HOME_MODULE_OPTIONS,
  isCookingLevel,
  isHomeModule,
  toHomeProfile,
  toggleHomeModule,
  HomeProfile
} from './home-profile';

/**
 * El modelo del perfil del hogar es el unico sitio donde se interpretan los
 * valores que llegan del backend o del almacenamiento local: aqui se prueba la
 * parte defensiva, que es la que evita pantallas en blanco con datos viejos.
 */
describe('home-profile model', () => {
  const es = { ...profileEs, ...authEs } as Record<string, string>;
  const en = { ...profileEn, ...authEn } as Record<string, string>;
  const dictionaries = { es, en };

  it('declara los cuatro niveles con su etiqueta y su explicacion', () => {
    expect(COOKING_LEVEL_OPTIONS.map((option) => option.value)).toEqual([
      'none',
      'beginner',
      'intermediate',
      'expert'
    ]);
    for (const option of COOKING_LEVEL_OPTIONS) {
      expect(option.labelKey).toBe(COOKING_LEVEL_LABEL_KEYS[option.value]);
      expect(es[option.hintKey].length).toBeGreaterThan(10);
      expect(en[option.hintKey]).toBeTruthy();
    }
  });

  it('dice a cada nivel cuanto explica la IA', () => {
    expect(es[detailLevelHintKey('none')]).toContain('pasos cortos');
    expect(es[detailLevelHintKey('beginner')]).toContain('cada paso');
    expect(es[detailLevelHintKey('intermediate')]).toContain('al grano');
    expect(es[detailLevelHintKey('expert')]).toContain('técnica');
  });

  it('lista las cinco secciones y deja pendiente solo Hogar', () => {
    expect(HOME_MODULE_OPTIONS.map((option) => option.value)).toEqual(HOME_MODULES);
    // «Lista», «Despensa» y «Tickets» ya están disponibles; solo quedan pendientes las tareas del hogar.
    expect(
      HOME_MODULE_OPTIONS.filter((option) => !option.available).map((option) => option.value)
    ).toEqual(['home']);
    for (const option of HOME_MODULE_OPTIONS) {
      expect(es[option.labelKey].length).toBeGreaterThan(3);
      expect(es[option.hintKey].length).toBeGreaterThan(3);
      expect(en[option.labelKey]).toBeTruthy();
    }
  });

  it('reconoce solo los valores suyos', () => {
    expect(isCookingLevel('none')).toBe(true);
    expect(isCookingLevel('expert')).toBe(true);
    expect(isCookingLevel('chefa')).toBe(false);
    expect(isCookingLevel(undefined)).toBe(false);
    expect(isHomeModule('receipts')).toBe(true);
    expect(isHomeModule('gatos')).toBe(false);
    expect(isHomeModule(null)).toBe(false);
  });

  it('arranca sin secciones marcadas y con el nivel por defecto del alta', () => {
    expect(DEFAULT_HOME_PROFILE).toEqual({ cookingLevel: 'beginner', modules: [] });
  });

  describe('toHomeProfile', () => {
    it('acepta lo bien formado', () => {
      expect(toHomeProfile({ cookingLevel: 'expert', modules: ['meals', 'pantry'] })).toEqual({
        cookingLevel: 'expert',
        modules: ['meals', 'pantry']
      });
    });

    it('sobrevive a un perfil ausente o roto', () => {
      const fallback: HomeProfile = { cookingLevel: 'beginner', modules: [] };
      expect(toHomeProfile(undefined)).toEqual(fallback);
      expect(toHomeProfile(null)).toEqual(fallback);
      expect(toHomeProfile('no es un objeto')).toEqual(fallback);
      expect(toHomeProfile(42)).toEqual(fallback);
    });

    it('descarta valores desconocidos y duplicados', () => {
      const result = toHomeProfile({
        cookingLevel: 'intermedio',
        modules: ['meals', 'meals', 'gatos', null, 7, 'pantry']
      });

      expect(result.cookingLevel).toBe('beginner');
      expect(result.modules).toEqual(['meals', 'pantry']);
    });

    it('ordena por el registro, no por lo que mando el cliente', () => {
      expect(toHomeProfile({ modules: ['pantry', 'meals'] }).modules).toEqual(['meals', 'pantry']);
    });

    it('ignora una lista de modulos que no es una lista', () => {
      expect(toHomeProfile({ modules: 'meals' }).modules).toEqual([]);
      expect(toHomeProfile({ modules: { 0: 'meals' } }).modules).toEqual([]);
    });
  });

  describe('toggleHomeModule', () => {
    it('añade si no estaba y quita si estaba', () => {
      expect(toggleHomeModule([], 'meals')).toEqual(['meals']);
      expect(toggleHomeModule(['meals'], 'pantry')).toEqual(['meals', 'pantry']);
      expect(toggleHomeModule(['meals', 'pantry'], 'meals')).toEqual(['pantry']);
    });

    it('es reversible y no muta la lista de entrada', () => {
      const before: ('meals' | 'pantry')[] = ['meals'];

      const once = toggleHomeModule(before, 'pantry');
      const twice = toggleHomeModule(once, 'pantry');

      expect(once).toEqual(['meals', 'pantry']);
      expect(twice).toEqual(['meals']);
      expect(before).toEqual(['meals']);
    });
  });

  /**
   * El espejo de la captura del usuario: la pestana de «Perfil» decia `profile.cooking.none` porque el
   * miembro que alimenta ese hueco devolvia la CLAVE. Un `{{ }}` de Angular no distingue una clave de una
   * palabra —ambas son `string`—, asi que esto es lo unico que lo distingue sin navegador.
   */
  it('convierte el nivel en palabra, no en clave del diccionario', () => {
    const t = (clave: string) => `[${clave}]`;
    // El caso de la captura: `none` es la clave `profile.cooking.none`, y la pestana la pintaba cruda.
    expect(cookingLevelWord('none', t)).toBe(`[${COOKING_LEVEL_LABEL_KEYS.none}]`);
    for (const level of ['none', 'beginner', 'intermediate', 'expert'] as const) {
      expect(cookingLevelWord(level, t)).toBe(`[${COOKING_LEVEL_LABEL_KEYS[level]}]`);
    }
    // Un valor que no es del catalogo no se inventa: se pinta el fallback, nunca una clave.
    expect(cookingLevelWord('quien-sabe-que', t)).toBe('—');
    expect(cookingLevelWord(undefined, t, 'Sin marcar')).toBe('Sin marcar');
  });

  it('los cuatro niveles tienen palabra en los dos idiomas', () => {
    for (const level of COOKING_LEVEL_OPTIONS.map((option) => option.value)) {
      for (const idioma of ['es', 'en'] as const) {
        const palabra = cookingLevelWord(level, (clave) => dictionaries[idioma][clave]);
        expect(palabra.length).toBeGreaterThan(2);
        expect(palabra).not.toContain('.'); // «profile.cooking.none» no es una respuesta, es un diagnostico
      }
    }
  });
});
