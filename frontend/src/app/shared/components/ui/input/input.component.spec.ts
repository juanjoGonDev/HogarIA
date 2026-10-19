import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { InputComponent } from './input.component';
import { I18nService } from '../../../../core/services/i18n.service';

describe('InputComponent', () => {
  let component: InputComponent;
  let fixture: ComponentFixture<InputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputComponent, FormsModule]
    }).compileComponents();

    fixture = TestBed.createComponent(InputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render input element', () => {
    const input = fixture.nativeElement.querySelector('input');
    expect(input).toBeTruthy();
  });

  it('should set input type', () => {
    component.type = 'email';
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input');
    expect(input.type).toBe('email');
  });

  it('should set placeholder', () => {
    component.placeholder = 'Enter email';
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input');
    expect(input.placeholder).toBe('Enter email');
  });

  it('sets an optional maximum length on the native input', () => {
    component.maxLength = 100;
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(input.maxLength).toBe(100);
  });

  it('does not impose a maximum length when one is not configured', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(input.hasAttribute('maxlength')).toBeFalse();
  });

  it('forwards optional numeric constraints to the native input', () => {
    component.type = 'number';
    component.min = 0;
    component.max = 8;
    component.step = 1;
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(input.getAttribute('min')).toBe('0');
    expect(input.getAttribute('max')).toBe('8');
    expect(input.getAttribute('step')).toBe('1');
  });

  it('does not impose numeric constraints when none are configured', () => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(input.hasAttribute('min')).toBeFalse();
    expect(input.hasAttribute('max')).toBeFalse();
    expect(input.hasAttribute('step')).toBeFalse();
  });

  it('associates an error message with the input and announces it', () => {
    component.id = 'email';
    component.error = 'Enter a valid email';
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    const error: HTMLElement = fixture.nativeElement.querySelector('#email-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('email-error');
    expect(error.textContent?.trim()).toBe('Enter a valid email');
    expect(error.getAttribute('role')).toBe('alert');
  });

  it('associates helper text when there is no error', () => {
    component.id = 'email';
    component.helper = 'Use your account email';
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    const helper: HTMLElement = fixture.nativeElement.querySelector('#email-helper');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('email-helper');
    expect(helper.textContent?.trim()).toBe('Use your account email');
  });

  it('does not point to a missing helper or error description', () => {
    component.id = 'email';
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('should disable input when disabled', () => {
    component.disabled = true;
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input');
    expect(input.disabled).toBeTrue();
  });

  it('should show label when provided', () => {
    component.label = 'Email';
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('.input__label');
    expect(label.textContent.trim()).toBe('Email');
  });

  it('should not show label when not provided', () => {
    component.label = '';
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('.input__label');
    expect(label).toBeFalsy();
  });

  it('should show required indicator', () => {
    component.label = 'Email';
    component.required = true;
    fixture.detectChanges();

    const required = fixture.nativeElement.querySelector('.input__required');
    expect(required).toBeTruthy();
  });

  it('should show error message', () => {
    component.error = 'Field is required';
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('.input__error');
    expect(error.textContent.trim()).toBe('Field is required');
  });

  it('should show helper text', () => {
    component.helper = 'Enter your email';
    fixture.detectChanges();

    const helper = fixture.nativeElement.querySelector('.input__helper');
    expect(helper.textContent.trim()).toBe('Enter your email');
  });

  it('should apply error class when error exists', () => {
    component.error = 'Error';
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input');
    expect(input.className).toContain('input--error');
  });

  it('propaga el cambio al modelo (ControlValueAccessor)', () => {
    const propagate = jasmine.createSpy('registerOnChange');
    component.registerOnChange(propagate);

    const input = fixture.nativeElement.querySelector('input');
    input.value = 'test';
    input.dispatchEvent(new Event('input'));

    expect(component.value).toBe('test');
    expect(propagate).toHaveBeenCalledWith('test');
  });

  it('toggles password visibility repeatedly without changing the configured input type', () => {
    component.type = 'password';
    component.showToggle = true;
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    let toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.input__toggle');
    expect(toggle).toBeTruthy();
    expect(input.type).toBe('password');

    toggle.click();
    fixture.detectChanges();

    expect(component.showPassword).toBeTrue();
    expect(component.type).toBe('password');
    expect(input.type).toBe('text');
    expect(fixture.nativeElement.querySelector('.input__toggle')).toBeTruthy();

    toggle = fixture.nativeElement.querySelector('.input__toggle');
    toggle.click();
    fixture.detectChanges();

    expect(component.showPassword).toBeFalse();
    expect(component.type).toBe('password');
    expect(input.type).toBe('password');
  });

  it('labels the password action in the selected language and hides its SVG from assistive technology', () => {
    component.type = 'password';
    const i18n = TestBed.inject(I18nService);
    try {
      i18n.setLang('es');
      fixture.detectChanges();

      let toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.input__toggle');
      expect(toggle.getAttribute('aria-label')).toBe('Mostrar contraseña');
      expect(toggle.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-label')).toBe('Ocultar contraseña');

      i18n.setLang('en');
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-label')).toBe('Hide password');
    } finally {
      // I18nService also changes the module-level number/date locale; don't leak English
      // formatting into later shopping-model unit tests in the shared Karma browser.
      i18n.setLang('es');
      fixture.detectChanges();
    }
  });

  it('keeps a disabled password hidden and reflects the visible state in the toggle', () => {
    component.type = 'password';
    component.disabled = true;
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    let toggle: HTMLButtonElement = fixture.nativeElement.querySelector('.input__toggle');
    expect(toggle.disabled).toBeTrue();
    toggle.click();
    fixture.detectChanges();
    expect(input.type).toBe('password');
    expect(component.showPassword).toBeFalse();
    component.togglePassword();
    expect(component.showPassword).toBeFalse();

    component.disabled = false;
    fixture.detectChanges();
    toggle = fixture.nativeElement.querySelector('.input__toggle');
    toggle.click();
    fixture.detectChanges();

    expect(input.type).toBe('text');
    expect(toggle.classList).toContain('input__toggle--visible');

    component.disabled = true;
    fixture.detectChanges();
    expect(toggle.disabled).toBeTrue();
    expect(input.type).toBe('password');
    expect(component.showPassword).toBeFalse();

    component.disabled = false;
    fixture.detectChanges();
    expect(input.type).toBe('password');

    toggle = fixture.nativeElement.querySelector('.input__toggle');
    toggle.click();
    fixture.detectChanges();
    expect(input.type).toBe('text');
    component.setDisabledState(true);
    fixture.detectChanges();
    expect(input.type).toBe('password');
    expect(component.showPassword).toBeFalse();
  });

  describe('ControlValueAccessor', () => {
    it('should write value', () => {
      component.writeValue('test value');
      expect(component.value).toBe('test value');
    });

    it('normalizes null and undefined model values to an empty string', () => {
      component.writeValue(null as never);
      expect(component.value).toBe('');

      component.writeValue(undefined as never);
      expect(component.value).toBe('');
    });

    it('should register onChange', () => {
      const fn = jasmine.createSpy('onChange');
      component.registerOnChange(fn);

      component.onInput({ target: { value: 'test' } } as any);
      expect(fn).toHaveBeenCalledWith('test');
    });

    it('should register onTouched', () => {
      const fn = jasmine.createSpy('onTouched');
      component.registerOnTouched(fn);

      component.handleBlur(new Event('blur'));
      expect(fn).toHaveBeenCalled();
    });

    it('propagates valid numeric input as a number without marking it touched', () => {
      const changed = jasmine.createSpy('registerOnChange');
      const touched = jasmine.createSpy('registerOnTouched');
      component.type = 'number';
      component.registerOnChange(changed);
      component.registerOnTouched(touched);

      component.onInput({ target: { value: '42' } } as unknown as Event);

      expect(changed).toHaveBeenCalledWith(42);
      expect(touched).not.toHaveBeenCalled();
    });

    it('keeps empty or non-numeric input as text without marking it touched while typing', () => {
      const changed = jasmine.createSpy('registerOnChange');
      const touched = jasmine.createSpy('registerOnTouched');
      component.type = 'number';
      component.registerOnChange(changed);
      component.registerOnTouched(touched);

      component.onInput({ target: { value: '' } } as unknown as Event);
      component.onInput({ target: { value: '12x' } } as unknown as Event);

      expect(changed.calls.argsFor(0)).toEqual(['']);
      expect(changed.calls.argsFor(1)).toEqual(['12x']);
      expect(touched).not.toHaveBeenCalled();
    });

    it('marks text and numeric controls touched on blur while preserving the blur output', () => {
      const touched = jasmine.createSpy('registerOnTouched');
      component.registerOnTouched(touched);
      const emitBlur = spyOn(component.onBlur, 'emit');
      const input: HTMLInputElement = fixture.nativeElement.querySelector('input');

      input.value = 'Ana';
      input.dispatchEvent(new Event('input'));
      expect(touched).not.toHaveBeenCalled();

      const textBlur = new Event('blur');
      input.dispatchEvent(textBlur);
      expect(touched).toHaveBeenCalledTimes(1);
      expect(emitBlur).toHaveBeenCalledWith(textBlur);

      component.type = 'number';
      fixture.detectChanges();
      input.value = '42';
      input.dispatchEvent(new Event('input'));
      expect(touched).toHaveBeenCalledTimes(1);

      input.dispatchEvent(new Event('blur'));
      expect(touched).toHaveBeenCalledTimes(2);
    });

    it('should set disabled state', () => {
      component.setDisabledState(true);
      expect(component.disabled).toBeTrue();
    });
  });

  describe('getClasses', () => {
    it('should return correct group classes', () => {
      component.fullWidth = true;
      expect(component.getGroupClasses()).toContain('input-group--full-width');
      component.fullWidth = false;
      expect(component.getGroupClasses()).not.toContain('input-group--full-width');
    });

    it('should return correct input classes', () => {
      component.size = 'lg';
      component.error = 'Error';

      const classes = component.getInputClasses();
      expect(classes).toContain('input--lg');
      expect(classes).toContain('input--error');

      component.prefixIcon = true;
      expect(component.getInputClasses()).toContain('input--has-prefix');

      component.type = 'password';
      component.showToggle = false;
      expect(component.getInputClasses()).not.toContain('input--has-suffix');
    });
  });
});
