import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/services/i18n.service';
import { dateLocale, formatDateTime, setDateLocale } from '../../core/time';
import { formatMoney } from '../../shared/models/shopping.model';
import { PriceChartComponent } from './price-chart.component';
import type { SerieTienda } from './precio-chart.util';

describe('PriceChartComponent', () => {
  let fixture: ComponentFixture<PriceChartComponent>;
  let component: PriceChartComponent;
  let previousLocale: string;
  const i18n = {
    changeTick: signal(0),
    t: jasmine.createSpy('t').and.callFake((key: string) => {
      if (key === 'pantry.item_sin_tienda') return 'Sin tienda';
      if (key === 'pantry.item_grafica_aria') return 'Historial de precios';
      return key;
    })
  };

  const serie = (tienda: string | null, puntos: SerieTienda['puntos']): SerieTienda => ({
    tienda,
    color: tienda === 'Tienda B' ? '#5C6BC0' : '#4CAF50',
    puntos,
    ultimo: puntos.at(-1)?.minor ?? 0,
    media: puntos.length
      ? Math.round(puntos.reduce((sum, point) => sum + point.minor, 0) / puntos.length)
      : 0,
    observaciones: puntos.length
  });

  beforeEach(async () => {
    previousLocale = dateLocale();
    setDateLocale('es-ES');

    await TestBed.configureTestingModule({
      imports: [PriceChartComponent],
      providers: [{ provide: I18nService, useValue: i18n }]
    }).compileComponents();

    fixture = TestBed.createComponent(PriceChartComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => setDateLocale(previousLocale));

  it('deja el SVG vacío cuando no hay series y no intenta presentar fechas', () => {
    fixture.componentRef.setInput('series', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="precios-grafica"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    expect(component.geo()).toBeNull();
    expect(component.marcasXVisibles()).toEqual([]);
  });

  it('renderiza un único punto accesible, traduce la tienda ausente y no inventa una línea', () => {
    fixture.componentRef.setInput('series', [
      serie(null, [{ ms: Date.UTC(2026, 0, 3, 12), minor: 150 }])
    ]);
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-label')).toBe('Historial de precios');
    expect(fixture.nativeElement.querySelector('.grafica__nombre').textContent.trim()).toBe(
      'Sin tienda'
    );
    expect(fixture.nativeElement.querySelector('.grafica__precio').textContent.trim()).not.toBe('');
    expect(svg.querySelectorAll('circle')).toHaveSize(1);
    expect(svg.querySelector('path.grafica__linea')).toBeNull();
    expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('#4CAF50');
    expect(svg.querySelector('circle title')?.textContent).toContain('Sin tienda');
    expect(svg.querySelector('circle title')?.textContent).toContain(
      formatDateTime(Date.UTC(2026, 0, 3, 12))
    );
    expect(svg.querySelector('circle title')?.textContent).toContain(formatMoney(150));
    expect(i18n.t).toHaveBeenCalledWith('pantry.item_sin_tienda');
    expect(i18n.t).toHaveBeenCalledWith('pantry.item_grafica_aria', undefined);
  });

  it('pinta línea y series por tienda, con etiquetas X únicas y título por precio', () => {
    fixture.componentRef.setInput('series', [
      serie('Tienda A', [
        { ms: Date.UTC(2026, 0, 3, 12), minor: 120 },
        { ms: Date.UTC(2026, 0, 4, 12), minor: 135 }
      ]),
      serie('Tienda B', [{ ms: Date.UTC(2026, 0, 3, 12), minor: 99 }])
    ]);
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    const labels = Array.from(svg.querySelectorAll('.grafica__texto--x')).map((node) =>
      node.textContent?.trim()
    );
    expect(fixture.nativeElement.querySelectorAll('.grafica__clave')).toHaveSize(2);
    expect(svg.querySelectorAll('circle')).toHaveSize(3);
    expect(svg.querySelectorAll('path.grafica__linea')).toHaveSize(1);
    expect(svg.querySelector('path.grafica__linea')?.getAttribute('stroke')).toBe('#4CAF50');
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.length).toBeLessThan(4);
    expect(svg.querySelector('circle title')?.textContent).toContain('Tienda A');
    expect(component.nombreDe('Tienda A')).toBe('Tienda A');
    expect(component.dinero(120)).toContain('€');
  });
});
