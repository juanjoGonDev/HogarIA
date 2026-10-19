import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `<app-button [disabled]="disabled" [loading]="loading">Guardar nombre</app-button>`
})
class ButtonStateHostComponent {
  disabled = false;
  loading = false;
}

describe('ButtonComponent', () => {
  let component: ButtonComponent;
  let fixture: ComponentFixture<ButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonComponent, ButtonStateHostComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should apply primary variant by default', () => {
    const button = fixture.nativeElement.querySelector('button');
    expect(button.className).toContain('btn--primary');
  });

  it('should apply specified variant', () => {
    component.variant = 'secondary';
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.className).toContain('btn--secondary');
  });

  it('should apply specified size', () => {
    component.size = 'lg';
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.className).toContain('btn--lg');
  });

  it('should expose a touch target class when requested', () => {
    component.touchTarget = true;
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.className).toContain('btn--touch-target');
  });

  it('should not add the touch target class by default', () => {
    const button = fixture.nativeElement.querySelector('button');

    expect(button.className).not.toContain('btn--touch-target');
  });

  it('should disable button when disabled is true', () => {
    component.disabled = true;
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.disabled).toBeTrue();
  });

  it('should disable button when loading', () => {
    component.loading = true;
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.disabled).toBeTrue();
  });

  it('should show spinner when loading', () => {
    component.loading = true;
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('.btn__spinner');
    expect(spinner).toBeTruthy();
  });

  it('preserves its rendered geometry and accessible label while loading', () => {
    const stateFixture = TestBed.createComponent(ButtonStateHostComponent);
    stateFixture.detectChanges();
    const button = stateFixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const geometry = () => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
        gap: style.gap,
        font: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight],
        border: [style.borderWidth, style.borderRadius]
      };
    };
    const normal = geometry();

    stateFixture.componentInstance.loading = true;
    stateFixture.detectChanges();
    const loading = geometry();

    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('Guardar nombre');
    expect(Math.abs(loading.x - normal.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(loading.y - normal.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(loading.width - normal.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(loading.height - normal.height)).toBeLessThanOrEqual(1);
    expect(loading.padding).toEqual(normal.padding);
    expect(loading.margin).toEqual(normal.margin);
    expect(loading.gap).toBe(normal.gap);
    expect(loading.font).toEqual(normal.font);
    expect(loading.border).toEqual(normal.border);

    stateFixture.componentInstance.loading = false;
    stateFixture.componentInstance.disabled = true;
    stateFixture.detectChanges();
    const disabled = geometry();
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(Math.abs(disabled.width - normal.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(disabled.height - normal.height)).toBeLessThanOrEqual(1);

    stateFixture.destroy();
  });

  it('should emit onClick when clicked', () => {
    spyOn(component.onClick, 'emit');

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(component.onClick.emit).toHaveBeenCalled();
  });

  it('should not emit onClick when disabled', () => {
    spyOn(component.onClick, 'emit');
    component.disabled = true;
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(component.onClick.emit).not.toHaveBeenCalled();
  });

  it('should apply full width class', () => {
    component.fullWidth = true;
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.className).toContain('btn--full-width');
  });

  it('should set button type', () => {
    component.type = 'submit';
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.type).toBe('submit');
  });

  describe('getClasses', () => {
    it('should return correct classes', () => {
      component.variant = 'outline';
      component.size = 'sm';

      expect(component.getClasses()).toContain('btn--outline');
      expect(component.getClasses()).toContain('btn--sm');
    });

    it('should include full-width class when fullWidth is true', () => {
      component.fullWidth = true;

      expect(component.getClasses()).toContain('btn--full-width');
    });
  });
});
