import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { PantryItemComponent } from './pantry-item.component';
import { PantryService } from '../../core/services/pantry.service';
import { ShoppingService } from '../../core/services/shopping.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ToastService } from '../../core/services/toast.service';
import { dateLocale, setDateLocale } from '../../core/time';
import { I18nService } from '../../core/services/i18n.service';
import type { PantryProduct } from '../../shared/models/pantry.model';
import type { PriceObservation } from '../../shared/models/shopping.model';

const PRODUCT: PantryProduct = {
  id: 'synthetic-product',
  name: 'Tomate sintético',
  category: 'vegetables',
  categoryKey: 'vegetables',
  categoryName: 'Verduras',
  quantity: 2,
  unit: 'unit',
  inPantry: true,
  expirationDate: null,
  location: 'fridge',
  barcode: null,
  notes: null,
  aliases: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  impact: { listLines: 0, priceObservations: 0 }
};

const PRICE: PriceObservation = {
  id: 'synthetic-price',
  product_name: PRODUCT.name,
  product_key: 'tomate sintetico',
  store_name: 'Tienda sintética',
  price_minor: 275,
  quantity: 2,
  observed_at: '2026-01-03T12:00:00.000Z'
};

describe('PantryItemComponent', () => {
  let fixture: ComponentFixture<PantryItemComponent>;
  let component: PantryItemComponent;
  let pantry: jasmine.SpyObj<PantryService>;
  let shopping: jasmine.SpyObj<ShoppingService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let toast: jasmine.SpyObj<ToastService>;
  let previousLocale: string;

  beforeEach(async () => {
    previousLocale = dateLocale();
    setDateLocale('es-ES');
    const categories = [
      { key: 'vegetables', color: '#12AB34', name: 'Verduras' },
      { key: 'invalid-color', color: 'transparent', name: 'Personalizada' }
    ];
    pantry = jasmine.createSpyObj<PantryService>('PantryService', ['loadCategories', 'getProduct']);
    (pantry as any).categories = signal(categories as any[]);
    pantry.getProduct.and.resolveTo(PRODUCT);

    shopping = jasmine.createSpyObj<ShoppingService>('ShoppingService', [
      'preciosDeProducto',
      'deletePrice'
    ]);
    shopping.preciosDeProducto.and.resolveTo([PRICE]);
    shopping.deletePrice.and.resolveTo(undefined);
    confirm = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirm.confirm.and.resolveTo(true);
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    const router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [PantryItemComponent],
      providers: [
        { provide: PantryService, useValue: pantry },
        { provide: ShoppingService, useValue: shopping },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: PRODUCT.id }),
              queryParamMap: convertToParamMap({})
            }
          }
        },
        { provide: Router, useValue: router }
      ]
    })
      .overrideComponent(PantryItemComponent, { set: { template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(PantryItemComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => setDateLocale(previousLocale));

  it('loads categories and product, exposes image changes, and records a missing product', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(pantry.loadCategories).toHaveBeenCalled();
    expect(pantry.getProduct).toHaveBeenCalledWith(PRODUCT.id);
    expect(component.item()).toEqual(PRODUCT);
    component.actualizarImagen('/api/pantry-products/synthetic-product/image');
    expect(component.item()?.image).toBe('/api/pantry-products/synthetic-product/image');

    component.item.set(null);
    component.actualizarImagen('https://images.example.test/tomate.jpg');
    expect(component.item()).toBeNull();

    pantry.getProduct.and.resolveTo(null);
    await (component as any).cargar('missing-product');
    expect(component.fallo()).toBeTrue();
  });

  it('loads price history once when its URL-backed tab becomes active', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    component.tab.set('precios');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(shopping.preciosDeProducto).toHaveBeenCalledWith('tomate sintetico');
    expect(component.precios()).toEqual([PRICE]);
    expect(component.preciosCargando()).toBeFalse();
    component.tab.set('detalles');
    fixture.detectChanges();
    component.tab.set('precios');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(shopping.preciosDeProducto).toHaveBeenCalledTimes(1);

    component.item.set(null);
    await (component as any).cargarPrecios();
    expect(shopping.preciosDeProducto).toHaveBeenCalledTimes(1);
  });

  it('formats category, storage, price, date, and expiry values with safe fallbacks', () => {
    expect(component.colorDe(PRODUCT)).toBe('#12AB34');
    expect(component.colorDe({ ...PRODUCT, category: 'not-found' })).not.toBe('transparent');
    expect(component.etiquetaCategoria(PRODUCT)).toBe('Verduras');
    expect(component.etiquetaCategoria({ ...PRODUCT, categoryName: '' })).toBe('vegetables');
    expect(component.etiquetaUbicacion('fridge')).toBe('pantry.nevera');
    expect(component.etiquetaUbicacion('freezer')).toBe('pantry.congelador');
    expect(component.etiquetaUbicacion('counter')).toBe('pantry.encimera');
    expect(component.etiquetaUbicacion('unknown')).toBe('pantry.title');
    expect(component.etiquetaUbicacion(null)).toBe('pantry.title');
    expect(component.nombreTienda('Mercado sintético')).toBe('Mercado sintético');
    expect(component.nombreTienda(null)).toBe('pantry.item_sin_tienda');
    expect(component.cuando('2026-01-03T12:00:00.000Z')).toContain('3 ene');
    expect(component.dinero(275)).toContain('2,75');
    expect(component.porUnidad(PRICE)).toBe(138);
    expect(component.porUnidad({ ...PRICE, quantity: 0 })).toBe(275);

    expect(component.estado(PRODUCT)).toBeNull();
    expect(component.estado({ ...PRODUCT, expirationDate: 'not-a-day' as any })).toBeNull();
    expect(component.estado({ ...PRODUCT, expirationDate: '2000-01-01' as any })).toEqual({
      variant: 'error',
      label: 'pantry.caducado'
    });
    const today = new Date();
    const key = (days: number) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };
    expect(component.estado({ ...PRODUCT, expirationDate: key(0) as any })).toEqual({
      variant: 'warning',
      label: 'pantry.caduca_hoy'
    });
    expect(component.estado({ ...PRODUCT, expirationDate: key(2) as any })).toEqual({
      variant: 'warning',
      label: 'pantry.caduca_en_dias'
    });
    expect(component.estado({ ...PRODUCT, expirationDate: key(5) as any })).toBeNull();
  });

  it('requires confirmation before removing a price and removes only the selected row', async () => {
    component.precios.set([PRICE, { ...PRICE, id: 'another-price' }]);
    confirm.confirm.and.resolveTo(false);
    await component.quitarPrecio(PRICE);
    expect(shopping.deletePrice).not.toHaveBeenCalled();
    expect(component.precios()).toHaveSize(2);

    confirm.confirm.and.resolveTo(true);
    await component.quitarPrecio(PRICE);
    expect(confirm.confirm).toHaveBeenCalledWith(jasmine.objectContaining({ variant: 'danger' }));
    expect(shopping.deletePrice).toHaveBeenCalledWith(PRICE.id);
    expect(component.precios().map((price) => price.id)).toEqual(['another-price']);
    expect(toast.success).toHaveBeenCalledWith('pantry.item_precio_quitado');
  });
});
