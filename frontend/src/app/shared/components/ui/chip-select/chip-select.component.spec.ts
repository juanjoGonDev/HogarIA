import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../../../core/services/i18n.service';
import { ChipSelectComponent } from './chip-select.component';
import { COMMON_ALLERGENS } from '../../../models/taste-profile';

describe('ChipSelectComponent', () => {
  let fixture: ComponentFixture<ChipSelectComponent>;
  let component: ChipSelectComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChipSelectComponent] }).compileComponents();
    await TestBed.inject(I18nService).loadTranslations('taste');
    fixture = TestBed.createComponent(ChipSelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('keeps approved preference emojis visible but decorative in the accessible chip name', () => {
    component.options = [COMMON_ALLERGENS[0]];
    fixture.detectChanges();

    const chip: HTMLButtonElement = fixture.nativeElement.querySelector('.chip-select__chip');
    const icon = chip.querySelector<HTMLElement>('.chip-select__icon');
    expect(icon?.textContent?.trim()).toBe(COMMON_ALLERGENS[0].icon);
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(chip.textContent).toContain(COMMON_ALLERGENS[0].value);
  });

  it('uses the edit SVG for selected custom values without adding a glyph to the chip', () => {
    component.options = [COMMON_ALLERGENS[0]];
    component.value = ['Alergia personal'];
    fixture.detectChanges();

    const chips: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.chip-select__chip');
    const custom = Array.from(chips).find((chip) => chip.textContent?.includes('Alergia personal'));
    const icon = custom?.querySelector('app-icon svg');

    expect(custom?.getAttribute('aria-pressed')).toBe('true');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(custom?.textContent).toContain('Alergia personal');
    expect(custom?.querySelector('.chip-select__icon')?.textContent?.trim()).toBe('');
  });

  it('trims custom values, suppresses case-insensitive duplicates, and emits only new selections', () => {
    component.value = ['Alergia existente'];
    const emit = spyOn(component.valueChange, 'emit');

    component.customText = '  Semillas  ';
    component.addCustom();
    expect(component.value).toEqual(['Alergia existente', 'Semillas']);
    expect(component.customText).toBe('');
    expect(emit).toHaveBeenCalledWith(['Alergia existente', 'Semillas']);

    component.customText = '  alergia EXISTENTE ';
    component.addCustom();
    expect(component.value).toEqual(['Alergia existente', 'Semillas']);
    expect(component.customText).toBe('');
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('rejects blank input but accepts a one-character custom value', () => {
    const emit = spyOn(component.valueChange, 'emit');

    component.customText = '   ';
    component.addCustom();
    expect(component.value).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    expect(component.validationError).toBeNull();

    component.customText = ' X ';
    component.addCustom();
    expect(component.value).toEqual(['X']);
    expect(component.customText).toBe('');
    expect(emit).toHaveBeenCalledOnceWith(['X']);
  });

  it('accepts a trimmed 60-character custom value and rejects longer values without losing input', () => {
    const valid = 'A '.repeat(29) + 'A!';
    expect(valid.trim().length).toBe(60);
    const tooLong = 'B'.repeat(61);
    const emit = spyOn(component.valueChange, 'emit');

    component.customText = `  ${valid}  `;
    component.addCustom();
    expect(component.value).toEqual([valid.trim()]);
    expect(component.customText).toBe('');

    component.customText = tooLong;
    component.addCustom();
    fixture.detectChanges();

    expect(component.value).toEqual([valid.trim()]);
    expect(component.customText).toBe(tooLong);
    expect(emit).toHaveBeenCalledTimes(1);
    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    const input: HTMLInputElement = fixture.nativeElement.querySelector('.chip-select__input');
    expect(alert).not.toBeNull();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('caps a selection at 60 and still allows removing a selected option', () => {
    component.options = Array.from({ length: 61 }, (_, index) => ({ value: `Opción ${index}` }));
    component.value = component.options.slice(0, 60).map(({ value }) => value);
    fixture.detectChanges();
    const emit = spyOn(component.valueChange, 'emit');

    component.toggle(component.options[60].value);
    fixture.detectChanges();
    expect(component.value.length).toBe(60);
    expect(emit).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();

    component.toggle(component.options[0].value);
    expect(component.value.length).toBe(59);
    component.toggle(component.options[60].value);
    expect(component.value.length).toBe(60);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('blocks a custom value at the selection limit and preserves it until room is available', () => {
    component.value = Array.from({ length: 60 }, (_, index) => `Opción ${index}`);
    const emit = spyOn(component.valueChange, 'emit');

    component.customText = ' opción 0 ';
    component.addCustom();
    expect(component.value.length).toBe(60);
    expect(component.customText).toBe('');
    expect(component.validationError).toBeNull();
    expect(emit).not.toHaveBeenCalled();

    component.customText = 'Otra opción';

    component.addCustom();
    fixture.detectChanges();
    expect(component.value.length).toBe(60);
    expect(component.customText).toBe('Otra opción');
    expect(component.validationError).toBe('max_selected');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(emit).not.toHaveBeenCalled();

    component.toggle('Opción 0');
    component.addCustom();
    expect(component.value).toContain('Otra opción');
    expect(component.value.length).toBe(60);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('toggles values both ways and keeps a deduplicated choices list cached by input identity', () => {
    const option = COMMON_ALLERGENS[0];
    component.options = [option, option];
    component.value = ['Personalizado'];
    const emit = spyOn(component.valueChange, 'emit');

    const first = component.choices;
    expect(first.map(({ value }) => value)).toEqual([option.value, 'Personalizado']);
    expect(component.choices).toBe(first);

    component.toggle(option.value);
    expect(component.value).toEqual(['Personalizado', option.value]);
    component.toggle(option.value);
    expect(component.value).toEqual(['Personalizado']);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(component.choices).toBe(first);
  });
});
