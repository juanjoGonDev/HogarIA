import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DICTS, type TranslationKey } from '../../core/i18n';
import { I18nService } from '../../core/services/i18n.service';
import { PantryCategoryLabelPipe } from './pantry-category-label.pipe';

describe('PantryCategoryLabelPipe', () => {
  let pipe: PantryCategoryLabelPipe;
  let lang: 'es' | 'en';
  let changeTick: jasmine.Spy;
  let translate: jasmine.Spy;

  beforeEach(() => {
    lang = 'es';
    const tick = signal(0);
    changeTick = jasmine.createSpy('changeTick').and.callFake(() => tick());
    translate = jasmine
      .createSpy('t')
      .and.callFake((key: TranslationKey) => (DICTS[lang] as Record<string, string>)[key]);

    TestBed.configureTestingModule({
      providers: [
        PantryCategoryLabelPipe,
        { provide: I18nService, useValue: { changeTick, t: translate } }
      ]
    });

    pipe = TestBed.inject(PantryCategoryLabelPipe);
  });

  it('traduce la clave de fábrica según el idioma activo y lee changeTick en cada transformación', () => {
    expect(pipe.transform('vegetables')).toBe('Verduras');

    lang = 'en';
    expect(pipe.transform('vegetables')).toBe('Vegetables');

    expect(changeTick).toHaveBeenCalledTimes(2);
    expect(translate).toHaveBeenCalledWith('pantry.categoria_verduras');
  });

  it('traduce también el objeto que conserva el nombre de fábrica explícito', () => {
    lang = 'en';

    expect(pipe.transform({ key: 'fruits', name: 'Frutas' })).toBe('Fruits');
    expect(changeTick).toHaveBeenCalledTimes(1);
  });

  it('conserva el nombre personalizado sin sustituirlo por el diccionario', () => {
    expect(pipe.transform({ key: 'vegetables', name: 'Verduras de la huerta' })).toBe(
      'Verduras de la huerta'
    );
    expect(translate).not.toHaveBeenCalled();
    expect(changeTick).toHaveBeenCalledTimes(1);
  });

  it('conserva una clave de categoría desconocida', () => {
    expect(pipe.transform('despensa-vieja')).toBe('despensa-vieja');
    expect(translate).not.toHaveBeenCalled();
  });

  it('devuelve una etiqueta vacía para valores nulos o ausentes', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(changeTick).toHaveBeenCalledTimes(2);
    expect(translate).not.toHaveBeenCalled();
  });
});
