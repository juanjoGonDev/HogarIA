import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { CATALOG_LABEL_KEYS } from '../../core/i18n/labels';
import { CatalogLabelPipe } from './catalog-label.pipe';

describe('CatalogLabelPipe', () => {
  let pipe: CatalogLabelPipe;
  let changeTick: jasmine.Spy;
  let translate: jasmine.Spy;

  beforeEach(() => {
    changeTick = jasmine.createSpy('changeTick').and.returnValue(0);
    translate = jasmine.createSpy('t').and.callFake((key: string) => `trad:${key}`);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: I18nService,
          useValue: { changeTick, t: translate }
        },
        CatalogLabelPipe
      ]
    });

    pipe = TestBed.inject(CatalogLabelPipe);
  });

  it('traduce una etiqueta sembrada y lee el tick de idioma', () => {
    const key = CATALOG_LABEL_KEYS['Leche'];

    expect(pipe.transform('Leche')).toBe(`trad:${key}`);
    expect(changeTick).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledOnceWith(key);
  });

  it('conserva nombres ajenos y ausentes sin buscar traducción, leyendo cada tick', () => {
    expect(pipe.transform('Leche de avena sin lactosa')).toBe('Leche de avena sin lactosa');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');

    expect(changeTick).toHaveBeenCalledTimes(4);
    expect(translate).not.toHaveBeenCalled();
  });
});
