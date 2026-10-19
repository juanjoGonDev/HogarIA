import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';
import { ICON_SHAPES, hasIcon, type IconName } from './icon-paths';

@Component({
  standalone: true,
  imports: [IconComponent],
  template: `<app-icon [name]="name" [size]="size" [label]="label" />`
})
class HostComponent {
  name: IconName = 'check';
  size = 24;
  label: string | null = null;
}

describe('IconComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  const svg = () => fixture.nativeElement.querySelector('svg') as SVGSVGElement;

  it('pinta el path del material sin necesitar red', () => {
    expect(svg().querySelector('path')?.getAttribute('d')).toBe(ICON_SHAPES.check.d[0]);
    expect(svg().getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('decorativo: aria-hidden y sin role de imagen', () => {
    expect(svg().getAttribute('aria-hidden')).toBe('true');
    expect(svg().getAttribute('role')).toBe('presentation');
  });

  it('con etiqueta es una imagen accesible y ademas se ve como tooltip', () => {
    fixture.componentInstance.label = 'Marcar como comprado';
    fixture.detectChanges();
    expect(svg().getAttribute('aria-label')).toBe('Marcar como comprado');
    expect(svg().getAttribute('aria-hidden')).toBeNull();
    expect(svg().querySelector('title')?.textContent?.trim()).toBe('Marcar como comprado');
  });

  it('size 0 delega en el tamano de la fuente', () => {
    fixture.componentInstance.size = 0;
    fixture.detectChanges();
    expect(svg().hasAttribute('width')).toBe(false);
    expect(svg().getAttribute('class') ?? '').toContain('icon--em');
  });

  it('usa un SVG decorativo vacio para un nombre desconocido en runtime', () => {
    fixture.componentInstance.name = 'removed_icon' as IconName;

    expect(() => fixture.detectChanges()).not.toThrow();
    expect(svg().getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg().querySelectorAll('path').length).toBe(0);
    expect(svg().getAttribute('role')).toBe('presentation');
    expect(svg().getAttribute('aria-hidden')).toBe('true');
  });

  it('cada forma del set tiene viewBox y al menos un path', () => {
    for (const [name, shape] of Object.entries(ICON_SHAPES)) {
      expect(shape.viewBox).toMatch(/^\d+ \d+ \d+ \d+$/);
      expect(shape.d.length).toBeGreaterThan(0);
      expect(shape.d[0].startsWith('M')).toBe(true);
      expect(hasIcon(name)).toBe(true);
    }
  });

  it('el set tiene los iconos con los que la lista se maneja a pulgar', () => {
    for (const name of [
      'check',
      'close',
      'add_shopping_cart',
      'shopping_basket',
      'select_all',
      'delete',
      'edit',
      'percent',
      'local_offer',
      'add_a_photo',
      'history',
      'unfold_more',
      'group',
      'home',
      'content_copy',
      'refresh',
      'link',
      'logout',
      'inventory_2',
      'menu_book',
      'kitchen',
      'smart_toy',
      'calendar_today',
      'event_note',
      'star',
      'star_outline'
    ]) {
      expect(hasIcon(name)).withContext(name).toBe(true);
    }
  });
});
