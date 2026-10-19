import { DICTS } from '../../../../core/i18n';
import { MealHoursComponent } from './meal-hours.component';

/**
 * El control de las horas de la casa, probado sin navegador.
 *
 * Se corre con el puente de vitest del server (`server/tmp-frontend.vitest.config.ts`) —en esta maquina no
 * hay Chrome y `ng test` no arranca—, y por eso aqui no se lee el fichero ni se monta el componente: las
 * aserciones sobre el template (los ids que buscan los e2e, la palabra «Por defecto») viven en la logica
 * que las alimenta y en `scripts/check-ui.mjs`, que es lo unico que las puede exigir siempre.
 */

function withTimes(times: Record<string, string>): MealHoursComponent {
  const component = new MealHoursComponent();
  component.times = times as never;
  return component;
}

describe('app-meal-hours', () => {
  it('pinta las cuatro comidas en el orden del dia, con su id prefijado', () => {
    const component = withTimes({});
    component.idPrefix = 'meal';
    expect(component.rows.map((row) => row.id)).toEqual([
      'meal-breakfast',
      'meal-lunch',
      'meal-snack',
      'meal-dinner'
    ]);
    expect(component.rows.map((row) => row.labelKey)).toEqual([
      'meal.breakfast',
      'meal.lunch',
      'meal.snack',
      'meal.dinner'
    ]);
    // Y las claves llevan a lo que se ensena, en los dos idiomas: si una se queda sin traduccion, la
    // fila sale en espanol para quien puso ingles.
    expect((DICTS.es as Record<string, string>)[component.rows[0].labelKey]).toBe('Desayuno');
    expect((DICTS.en as Record<string, string>)[component.rows[3].labelKey]).toBe('Dinner');
  });

  it('el prefijo del tour deja intactos los ids que buscan los e2e', () => {
    const component = withTimes({});
    component.idPrefix = 'ob-meal';
    expect(component.rows.map((row) => row.id)).toContain('ob-meal-dinner');
  });

  it('la hora de fabrica no ofrece «Por defecto»: no hay nada que deshacer', () => {
    expect(withTimes({ dinner: '20:30' }).isDefault('dinner')).toBeTrue();
    expect(withTimes({ dinner: '20:30' }).isNotDefault('dinner')).toBeFalse();
  });

  it('una hora distinta, si', () => {
    expect(withTimes({ dinner: '22:15' }).isNotDefault('dinner')).toBeTrue();
  });

  it('vaciar el campo cuenta como «por defecto», que es lo que hara la app con ese valor', () => {
    expect(withTimes({ dinner: '' }).isDefault('dinner')).toBeTrue();
    expect(withTimes({ dinner: '   ' }).isDefault('dinner')).toBeTrue();
  });

  it('reset escribe la hora de fabrica dentro del objeto del host, no una copia', () => {
    const times = { dinner: '22:15' };
    withTimes(times).reset('dinner');
    // Mutar en lugar de emitir es lo que hace que `hasUnsavedChanges()` de Preferencias se entere: si
    // esto devolviera un objeto nuevo, el snapshot guardado seguiria comparando contra el viejo y el
    // boton de guardar diria «no hay cambios» teniendolos. Es el bug que tenia la copia de Preferencias.
    expect(times['dinner']).toBe('20:30');
  });

  it('escribe en el modelo al teclear y guarda la cadena vacia tal cual', () => {
    const times: Record<string, string> = { dinner: '20:30' };
    const component = withTimes(times);
    component.write('dinner', '21:45');
    expect(times['dinner']).toBe('21:45');
    component.write('dinner', '');
    expect(times['dinner']).toBe('');
  });

  it('devuelve LA MISMA array mientras no cambian las entradas', () => {
    // Esta es la prueba que congelo la pantalla: `*ngFor` compara identidad, y un getter que
    // construye un array nuevo en cada ciclo destruye las filas, el ngModel reescribe el valor, el
    // arbol se marca de nuevo, y el bucle no acaba. `toBe` (identidad), no `toEqual`.
    const component = withTimes({ dinner: '20:30' });
    const first = component.rows;
    expect(component.rows).toBe(first);
    expect(component.rows).toBe(first);
    component.write('dinner', '22:15');
    expect(component.rows).toBe(first);
  });

  it('y si cambia el prefijo, cambia el id de la fila', () => {
    const component = withTimes({});
    const before = component.rows;
    component.idPrefix = 'ob-meal';
    expect(component.rows).not.toBe(before);
    expect(component.rows.map((row) => row.id)).toContain('ob-meal-lunch');
  });

  it('el boton solo existe donde hay algo que deshacer, y eso es lo que pinta la plantilla', () => {
    // El contrato con la pantalla es este par de funciones: `*ngIf="isNotDefault(...)"` decide si el boton
    // existe —solo en la fila que se ha tocado—. Si un refactor las juntaba en una sola, aqui se nota.
    const component = withTimes({ dinner: '22:15', lunch: '14:00' });
    expect(
      component.rows.filter((row) => component.isNotDefault(row.type)).map((row) => row.type)
    ).toEqual(['dinner']);
  });
});
