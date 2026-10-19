import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';

import { I18nService } from '../../core/services/i18n.service';
import { ShoppingService } from '../../core/services/shopping.service';
import { ToastService } from '../../core/services/toast.service';
import type { SugerenciaDeCompra, SugerenciaRow } from '../../shared/models/shopping.model';
import { ShoppingSuggestedComponent } from './shopping-suggested.component';

const fila = (overrides: Partial<SugerenciaRow> = {}): SugerenciaRow => ({
  name: 'Leche',
  unit: 'ud',
  category: 'dairy',
  quantity: 2,
  motivo: 'caduca',
  daysLeft: 1,
  cadaDias: null,
  mejorTienda: null,
  precioUnitarioMinor: null,
  precioEstimadoMinor: null,
  ...overrides
});

const listaAbierta = {
  id: 'lista-sintetica',
  name: 'Lista sugerida',
  version: 1,
  itemsPendientes: 3
};

describe('ShoppingSuggestedComponent', () => {
  let fixture: ComponentFixture<ShoppingSuggestedComponent>;
  let component: ShoppingSuggestedComponent;
  let shopping: {
    sugerencia: WritableSignal<SugerenciaDeCompra | null>;
    cargandoSugerencia: WritableSignal<boolean>;
    cargarSugerencia: jasmine.Spy;
    aplicarSugerida: jasmine.Spy;
  };
  let toast: { success: jasmine.Spy };
  let translate: jasmine.Spy;

  beforeEach(async () => {
    shopping = {
      sugerencia: signal<SugerenciaDeCompra | null>(null),
      cargandoSugerencia: signal(false),
      cargarSugerencia: jasmine.createSpy('cargarSugerencia'),
      aplicarSugerida: jasmine
        .createSpy('aplicarSugerida')
        .and.resolveTo({ id: 'lista-sintetica', creada: true, sugeridos: 2 })
    };
    toast = { success: jasmine.createSpy('success') };
    translate = jasmine
      .createSpy('t')
      .and.callFake((key: string, params?: Record<string, string | number>) => {
        const templates: Record<string, string> = {
          'shopping_suggested.lista_abierta': 'Pendientes: {n}',
          'shopping_suggested.mejor_en': 'mejor en {tienda}',
          'shopping_suggested.sin_precio': 'sin precio conocido',
          'shopping_suggested.total': '≈{total}'
        };
        return Object.entries(params ?? {}).reduce(
          (text, [name, value]) => text.replace(`{${name}}`, String(value)),
          templates[key] ?? key
        );
      });

    await TestBed.configureTestingModule({
      imports: [ShoppingSuggestedComponent],
      providers: [
        { provide: ShoppingService, useValue: shopping },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: { changeTick: signal(0), t: translate } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ShoppingSuggestedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('loads the preview on init and hides its trigger when there is nothing to apply', () => {
    expect(shopping.cargarSugerencia).toHaveBeenCalledTimes(1);
    expect(component.sePuedeAplicar()).toBeFalse();
    expect(fixture.nativeElement.querySelector('[data-test="sugerida-abrir"]')).toBeNull();
  });

  it('keeps the trigger for an open list with no new rows and offers an update', () => {
    shopping.sugerencia.set({ sugerencias: [], lista: listaAbierta });
    fixture.detectChanges();

    const trigger = fixture.nativeElement.querySelector('[data-test="sugerida-abrir"]');
    expect(trigger).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-test="sugerida-n"]')).toBeNull();
    trigger.querySelector('button')?.click();
    fixture.detectChanges();

    expect(shopping.cargarSugerencia).toHaveBeenCalledTimes(2);
    expect(component.abierto()).toBeTrue();
    expect(
      fixture.nativeElement.querySelector('[data-test="sugerida-abierta"]')?.textContent
    ).toContain('3');
    expect(fixture.nativeElement.querySelector('[data-test="sugerida-actualizar"]')).not.toBeNull();

    component.cerrar();
    fixture.detectChanges();
    expect(component.abierto()).toBeFalse();
  });

  it('renders each reason, optional store/price and a total of known estimates only', () => {
    shopping.sugerencia.set({
      sugerencias: [
        fila({
          name: 'Yogur',
          motivo: 'caduca',
          mejorTienda: 'Mercadona',
          precioEstimadoMinor: 250
        }),
        fila({ name: 'Pan', motivo: 'sin_stock', precioEstimadoMinor: null }),
        fila({ name: 'Arroz', motivo: 'se_acaba', precioEstimadoMinor: 175 }),
        fila({ name: 'Tomate', motivo: 'para_el_plan', precioEstimadoMinor: 0 })
      ],
      lista: null
    });
    component.abrir();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="sugerida-n"]')?.textContent).toContain(
      '4'
    );
    expect(fixture.nativeElement.querySelector('[data-test="sugerida-crear"]')).not.toBeNull();
    expect(component.totalMinor()).toBe(425);
    expect(component.euros(660)).toBe('6,60 €');

    const rows = Array.from(fixture.nativeElement.querySelectorAll('.sug__fila')) as HTMLElement[];
    expect(rows).toHaveSize(4);
    expect(rows.map((row) => row.querySelector('.badge')?.className)).toEqual([
      jasmine.stringMatching(/badge--error/),
      jasmine.stringMatching(/badge--warning/),
      jasmine.stringMatching(/badge--primary/),
      jasmine.stringMatching(/badge--neutral/)
    ]);
    expect(rows[0].textContent).toContain('mejor en Mercadona');
    expect(rows[0].textContent).toContain('≈2,50 €');
    expect(rows[1].textContent).toContain('sin precio conocido');
    expect(rows[1].querySelector('.sug__tienda')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-test="sugerida-total"]')?.textContent
    ).toContain('≈4,25 €');
  });

  it('shows the loading state instead of the preview rows', () => {
    shopping.sugerencia.set({ sugerencias: [fila()], lista: null });
    shopping.cargandoSugerencia.set(true);
    component.abrir();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="sugerida-cargando"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.sug__lista')).toBeNull();
  });

  it('creates a list, localizes the success toast, closes and emits once', async () => {
    const emitted = jasmine.createSpy('aplicada');
    component.aplicada.subscribe(emitted);
    component.abrir();
    fixture.detectChanges();

    await component.aplicar();
    fixture.detectChanges();

    expect(shopping.aplicarSugerida).toHaveBeenCalledTimes(1);
    expect(translate).toHaveBeenCalledWith('shopping_suggested.creada_ok');
    expect(translate).toHaveBeenCalledWith('shopping_suggested.n_lineas', { n: 2 });
    expect(toast.success).toHaveBeenCalledWith(
      'shopping_suggested.creada_ok',
      'shopping_suggested.n_lineas'
    );
    expect(component.trabajando()).toBeFalse();
    expect(component.abierto()).toBeFalse();
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('uses update feedback when the service updates an existing list', async () => {
    shopping.sugerencia.set({ sugerencias: [fila()], lista: listaAbierta });
    shopping.aplicarSugerida.and.resolveTo({
      id: 'lista-sintetica',
      creada: false,
      sugeridos: 1
    });
    const emitted = jasmine.createSpy('aplicada');
    component.aplicada.subscribe(emitted);
    component.abrir();

    await component.aplicar();

    expect(translate).toHaveBeenCalledWith('shopping_suggested.actualizada_ok');
    expect(toast.success).toHaveBeenCalledWith(
      'shopping_suggested.actualizada_ok',
      'shopping_suggested.n_lineas'
    );
    expect(emitted).toHaveBeenCalledTimes(1);
    expect(component.abierto()).toBeFalse();
  });

  it('keeps the modal open and gives no duplicate success feedback when applying fails', async () => {
    shopping.aplicarSugerida.and.resolveTo(null);
    const emitted = jasmine.createSpy('aplicada');
    component.aplicada.subscribe(emitted);
    component.abrir();

    await component.aplicar();

    expect(component.trabajando()).toBeFalse();
    expect(component.abierto()).toBeTrue();
    expect(toast.success).not.toHaveBeenCalled();
    expect(emitted).not.toHaveBeenCalled();
  });

  it('ignores a second apply call while the first request is pending', async () => {
    let resolve!: (value: { id: string; creada: boolean; sugeridos: number } | null) => void;
    shopping.aplicarSugerida.and.returnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    component.abrir();

    const first = component.aplicar();
    expect(component.trabajando()).toBeTrue();
    await component.aplicar();
    expect(shopping.aplicarSugerida).toHaveBeenCalledTimes(1);

    resolve(null);
    await first;
    expect(component.trabajando()).toBeFalse();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
