import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SwitchComponent } from './switch.component';

@Component({
  standalone: true,
  imports: [SwitchComponent],
  template: `
    <app-switch
      [checked]="checked"
      [disabled]="disabled"
      [busy]="busy"
      ariaLabel="Ajustar a cuadrícula"
      labelledBy="switch-label"
      describedBy="switch-hint"
      (checkedChange)="checked = $event"
    >
      <span id="switch-label">Ajustar a cuadrícula</span>
    </app-switch>
    <span id="switch-hint">Ajusta los puntos al lienzo.</span>
  `
})
class SwitchHostComponent {
  checked = false;
  disabled = false;
  busy = false;
}

describe('SwitchComponent', () => {
  let fixture: ComponentFixture<SwitchHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SwitchHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(SwitchHostComponent);
    fixture.detectChanges();
  });

  const control = () => fixture.nativeElement.querySelector('app-switch') as HTMLElement;

  it('expone un switch con nombre, descripción y objetivo táctil consistente', () => {
    const switchElement = control();
    expect(switchElement.getAttribute('role')).toBe('switch');
    expect(switchElement.getAttribute('aria-checked')).toBe('false');
    expect(switchElement.getAttribute('aria-labelledby')).toBe('switch-label');
    expect(switchElement.getAttribute('aria-describedby')).toBe('switch-hint');
    expect(switchElement.getAttribute('tabindex')).toBe('0');
    expect(switchElement.querySelector('[data-switch-track]')).not.toBeNull();
    expect(switchElement.querySelector('[data-switch-thumb]')).not.toBeNull();

    const target = switchElement.getBoundingClientRect();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  });

  it('emite el estado siguiente con clics repetidos sin mutar una copia local', () => {
    const switchElement = control();
    switchElement.click();
    fixture.detectChanges();
    expect(switchElement.getAttribute('aria-checked')).toBe('true');
    expect(switchElement.getAttribute('data-checked')).toBe('true');

    switchElement.click();
    fixture.detectChanges();
    expect(switchElement.getAttribute('aria-checked')).toBe('false');
    expect(switchElement.getAttribute('data-checked')).toBe('false');
  });

  it('responde a Espacio y Enter una sola vez y conserva el foco', () => {
    const switchElement = control();
    switchElement.focus();
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    switchElement.dispatchEvent(space);
    fixture.detectChanges();
    expect(space.defaultPrevented).toBeTrue();
    expect(switchElement.getAttribute('aria-checked')).toBe('true');

    const repeatedEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      repeat: true
    });
    switchElement.dispatchEvent(repeatedEnter);
    fixture.detectChanges();
    expect(repeatedEnter.defaultPrevented).toBeTrue();
    expect(switchElement.getAttribute('aria-checked')).toBe('true');

    switchElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    fixture.detectChanges();
    expect(switchElement.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(switchElement);
  });

  it('no permite cambios mientras está ocupado sin sacar el control del orden de tabulación', () => {
    fixture.componentInstance.busy = true;
    fixture.detectChanges();
    const switchElement = control();
    switchElement.click();
    switchElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );
    fixture.detectChanges();

    expect(switchElement.getAttribute('aria-disabled')).toBe('true');
    expect(switchElement.getAttribute('tabindex')).toBe('0');
    expect(switchElement.getAttribute('aria-checked')).toBe('false');
  });

  it('deshabilitado no permite cambios y sale del orden de tabulación', () => {
    fixture.componentInstance.disabled = true;
    fixture.detectChanges();
    const switchElement = control();
    switchElement.click();
    switchElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    fixture.detectChanges();

    expect(switchElement.getAttribute('aria-disabled')).toBe('true');
    expect(switchElement.getAttribute('tabindex')).toBe('-1');
    expect(switchElement.getAttribute('aria-checked')).toBe('false');
  });
});
