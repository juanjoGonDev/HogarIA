import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShoppingLocationFlowComponent } from './shopping-location-flow.component';
import { ShoppingService } from '../../core/services/shopping.service';
import { I18nService } from '../../core/services/i18n.service';
import type { ShoppingLocationCandidate } from '../../shared/models/shopping.model';

const LIST_ID = 'list-location-test';
const ITEM_ID = 'item-location-test';
const candidate: ShoppingLocationCandidate = {
  id: 'store-1',
  name: 'Tienda cercana',
  address: 'Calle Mayor 2',
  latitude: 40.4,
  longitude: -3.7,
  distanceMeters: 25,
  attribution: null,
  attributionUrl: null,
  source: 'registered'
};

describe('ShoppingLocationFlowComponent', () => {
  let fixture: ComponentFixture<ShoppingLocationFlowComponent>;
  let shopping: jasmine.SpyObj<ShoppingService>;
  let geolocation: Geolocation;
  let restoreGeolocation: (() => void) | null;

  beforeEach(async () => {
    shopping = jasmine.createSpyObj<ShoppingService>('ShoppingService', [
      'searchNearbyStores',
      'saveItemLocations'
    ]);
    shopping.searchNearbyStores.and.resolveTo({ status: 'ok', candidates: [candidate] });
    shopping.saveItemLocations.and.resolveTo([]);
    const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    geolocation = {
      getCurrentPosition: jasmine.createSpy('getCurrentPosition'),
      watchPosition: jasmine.createSpy('watchPosition'),
      clearWatch: jasmine.createSpy('clearWatch')
    } as unknown as Geolocation;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocation
    });
    restoreGeolocation = () => {
      if (original) Object.defineProperty(navigator, 'geolocation', original);
      else Reflect.deleteProperty(navigator, 'geolocation');
    };

    await TestBed.configureTestingModule({
      imports: [ShoppingLocationFlowComponent],
      providers: [
        { provide: ShoppingService, useValue: shopping },
        { provide: I18nService, useValue: { changeTick: () => 0, t: (key: string) => key } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ShoppingLocationFlowComponent);
    fixture.componentRef.setInput('listId', LIST_ID);
    fixture.componentRef.setInput('itemIds', [ITEM_ID]);
    fixture.componentRef.setInput('isOpen', true);
  });

  afterEach(() => restoreGeolocation?.());

  function click(testId: string): void {
    const target = fixture.nativeElement.querySelector(`[data-test="${testId}"]`) as HTMLElement;
    const button = (
      target?.matches('button') ? target : target?.querySelector('button')
    ) as HTMLButtonElement;
    expect(button).withContext(testId).toBeTruthy();
    button.click();
    fixture.detectChanges();
  }

  it('does not request permission or search when the person skips the prompt', () => {
    const closed = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closed);
    fixture.detectChanges();

    click('location-skip');

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(shopping.searchNearbyStores).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('gets permission only after acceptance and saves the selected registered store', async () => {
    fixture.detectChanges();
    click('location-accept');
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    const success = (geolocation.getCurrentPosition as jasmine.Spy).calls.mostRecent()
      .args[0] as PositionCallback;
    success({ coords: { latitude: 40.4, longitude: -3.7 } } as GeolocationPosition);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shopping.searchNearbyStores).toHaveBeenCalledWith(LIST_ID, 40.4, -3.7, 500);
    click('location-candidate');
    await fixture.whenStable();
    expect(shopping.saveItemLocations).toHaveBeenCalledWith(LIST_ID, [ITEM_ID], {
      source: 'registered',
      id: 'store-1'
    });
  });

  it('falls back to manual entry after permission denial', async () => {
    fixture.detectChanges();
    click('location-accept');
    const error = (geolocation.getCurrentPosition as jasmine.Spy).calls.mostRecent()
      .args[1] as PositionErrorCallback;
    error({
      code: 1,
      message: 'denied',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const nameInput = fixture.nativeElement.querySelector(
      '[data-test="location-name"]'
    ) as HTMLInputElement;
    const addressInput = fixture.nativeElement.querySelector(
      '[data-test="location-address"]'
    ) as HTMLInputElement;
    nameInput.value = 'Tienda manual';
    nameInput.dispatchEvent(new Event('input'));
    addressInput.value = 'Calle Sol 8';
    addressInput.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.name).toBe('Tienda manual');
    expect(fixture.componentInstance.address).toBe('Calle Sol 8');
    click('location-save-manual');
    await fixture.whenStable();

    expect(shopping.searchNearbyStores).not.toHaveBeenCalled();
    expect(shopping.saveItemLocations).toHaveBeenCalledWith(LIST_ID, [ITEM_ID], {
      source: 'manual',
      name: 'Tienda manual',
      address: 'Calle Sol 8'
    });
  });

  it('offers manual entry when the geolocation API is unavailable', () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    fixture.detectChanges();
    click('location-accept');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-test="location-manual-form"]')).toBeTruthy();
    expect(shopping.searchNearbyStores).not.toHaveBeenCalled();
  });

  it('offers manual entry after a geolocation timeout', async () => {
    fixture.detectChanges();
    click('location-accept');
    const error = (geolocation.getCurrentPosition as jasmine.Spy).calls.mostRecent()
      .args[1] as PositionErrorCallback;
    error({
      code: 3,
      message: 'timeout',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-test="location-manual-form"]')).toBeTruthy();
    expect(shopping.searchNearbyStores).not.toHaveBeenCalled();
  });

  it('ignores a late geolocation result after the person cancels', async () => {
    fixture.detectChanges();
    click('location-accept');
    const success = (geolocation.getCurrentPosition as jasmine.Spy).calls.mostRecent()
      .args[0] as PositionCallback;

    fixture.componentInstance.close();
    success({ coords: { latitude: 40.4, longitude: -3.7 } } as GeolocationPosition);
    await fixture.whenStable();

    expect(shopping.searchNearbyStores).not.toHaveBeenCalled();
    expect(shopping.saveItemLocations).not.toHaveBeenCalled();
  });

  it('opens the same editor with the saved name and address for manual correction', async () => {
    fixture.componentRef.setInput('initialMode', 'edit');
    fixture.componentRef.setInput('currentName', 'Mercado');
    fixture.componentRef.setInput('currentAddress', 'Plaza Uno');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      (fixture.nativeElement.querySelector('[data-test="location-name"]') as HTMLInputElement).value
    ).toBe('Mercado');
    expect(
      (fixture.nativeElement.querySelector('[data-test="location-address"]') as HTMLInputElement)
        .value
    ).toBe('Plaza Uno');
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
