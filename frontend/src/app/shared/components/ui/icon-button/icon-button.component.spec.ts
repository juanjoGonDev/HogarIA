import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconButtonComponent } from './icon-button.component';

@Component({
  standalone: true,
  imports: [IconButtonComponent],
  template: `
    <app-icon-button
      icon="delete"
      [label]="label"
      [size]="size"
      [disabled]="disabled"
      [badge]="badge"
      (onClick)="clicks = clicks + 1"
    />
  `
})
class HostComponent {
  label = 'Borrar linea';
  size: 'sm' | 'md' = 'md';
  disabled = false;
  badge: string | null = null;
  clicks = 0;
}

describe('IconButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  it('es type=button: dentro de un formulario un icono de borrar no debe poder enviarlo', () => {
    expect(button().getAttribute('type')).toBe('button');
  });

  it('la etiqueta es aria-label Y title, que es lo que hace util un icono suelto', () => {
    expect(button().getAttribute('aria-label')).toBe('Borrar linea');
    expect(button().getAttribute('title')).toBe('Borrar linea');
  });

  it('emite el click y no con el boton inhabilitado', () => {
    button().click();
    expect(fixture.componentInstance.clicks).toBe(1);
    fixture.componentInstance.disabled = true;
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
    button().click();
    expect(fixture.componentInstance.clicks).toBe(1);
  });

  it('el tamano manda en el area util, no en el glifo', () => {
    expect(button().className).toContain('icon-btn--md');
    fixture.componentInstance.size = 'sm';
    fixture.detectChanges();
    expect(button().className).toContain('icon-btn--sm');
    expect(button().querySelector('svg')?.getAttribute('width')).toBe('18');
  });

  it('sin etiqueta se ve el hueco con el signo, para que no pase desapercibido', () => {
    fixture.componentInstance.label = '';
    fixture.detectChanges();
    expect(button().className).toContain('icon-btn--no-label');
    expect(button().getAttribute('aria-label')).toBeNull();
  });

  it('la insignia se pinta al lado del icono', () => {
    fixture.componentInstance.badge = '3';
    fixture.detectChanges();
    expect(button().querySelector('.icon-btn__badge')?.textContent).toBe('3');
  });
});
