import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { StorageService } from '../../core/services/storage.service';
import { UnitPickerComponent } from './unit-picker.component';

describe('UnitPickerComponent — unidades recientes', () => {
  let fixture: ComponentFixture<UnitPickerComponent>;
  let component: UnitPickerComponent;
  let storage: StorageService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [UnitPickerComponent] }).compileComponents();
    await TestBed.inject(I18nService).loadTranslations('shoppingListDetail');
    storage = TestBed.inject(StorageService);
    createPicker();
  });

  afterEach(() => {
    fixture.destroy();
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('moves a canonical unit to the top, emits it, and avoids duplicate catalog options', () => {
    const emitted: (string | null)[] = [];
    component.valueChange.subscribe((value) => emitted.push(value));

    component.pick(' KG ');

    expect(emitted).toEqual(['kg']);
    expect(storage.get('shopping.recent-units')).toEqual(['kg']);
    expect(component.options()[0]).toEqual({
      value: 'kg',
      label: 'kg',
      group: 'Recientes'
    });
    expect(component.options().filter((option) => option.value.toLowerCase() === 'kg').length).toBe(
      1
    );
  });

  it('localizes the recent section and stays selectable when storage is full', () => {
    const emitted: (string | null)[] = [];
    component.valueChange.subscribe((value) => emitted.push(value));
    TestBed.inject(I18nService).setLang('en');
    TestBed.flushEffects();
    spyOn(Storage.prototype, 'setItem').and.throwError('quota exceeded');
    const log = spyOn(console, 'error');

    expect(() => component.pick('kg')).not.toThrow();
    expect(component.options()[0].group).toBe('Recent');
    expect(component.options()[0].value).toBe('kg');
    expect(emitted).toEqual(['kg']);
    expect(log).toHaveBeenCalled();
  });

  it('deduplicates repeated selections, keeps custom units, caps at six, and restores after recreation', () => {
    const sequence = ['kg', 'g', 'L', 'ml', 'ud', 'bote', 'lata', 'bote de 400 g', 'KG'];
    sequence.forEach((unit) => component.pick(unit));

    const expected = ['kg', 'bote de 400 g', 'lata', 'bote', 'ud', 'ml'];
    expect(
      component
        .options()
        .slice(0, 6)
        .map((option) => option.value)
    ).toEqual(expected);
    expect(
      component
        .options()
        .slice(0, 6)
        .every((option) => option.group === 'Recientes')
    ).toBeTrue();
    expect(new Set(component.options().map((option) => option.value.toLowerCase())).size).toBe(
      component.options().length
    );
    expect(storage.get('shopping.recent-units')).toEqual(expected);

    fixture.destroy();
    createPicker();
    expect(
      component
        .options()
        .slice(0, 6)
        .map((option) => option.value)
    ).toEqual(expected);
  });

  it('ignores malformed persisted JSON and keeps the catalog selectable', () => {
    fixture.destroy();
    localStorage.setItem('hogar:v1:shopping.recent-units', '{not-json');
    createPicker();

    expect(component.options().some((option) => option.value === 'kg')).toBeTrue();
    expect(component.options().some((option) => option.group === 'Recientes')).toBeFalse();
    expect(() => component.pick('g')).not.toThrow();
  });

  it('sanitizes corrupted list entries and deduplicates case-insensitively', () => {
    storage.set('shopping.recent-units', [' KG ', 'kg', 7, '', 'bote de 400 g']);
    fixture.destroy();
    createPicker();

    expect(
      component
        .options()
        .slice(0, 2)
        .map((option) => option.value)
    ).toEqual(['kg', 'bote de 400 g']);
  });

  function createPicker(): void {
    fixture = TestBed.createComponent(UnitPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }
});
