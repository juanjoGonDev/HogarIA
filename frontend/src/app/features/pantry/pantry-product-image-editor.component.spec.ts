import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HouseholdService } from '../../core/services/household.service';
import { I18nService } from '../../core/services/i18n.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import type { ProductImageSearchView } from '../../shared/models/pantry.model';
import { PantryProductImageEditorComponent } from './pantry-product-image-editor.component';

const PRODUCT = { id: 'product-1', name: 'Tomate', image: null };
const COMPLETE: ProductImageSearchView = { status: 'complete', jobId: 'job-1', candidates: [], errorCode: null };
const CANDIDATE = {
  id: 'a'.repeat(24), altText: 'Tomate fresco', author: 'Fotógrafo de prueba',
  licenseName: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tomato.jpg', previewUrl: '/api/product-image-previews/photo'
};

describe('PantryProductImageEditorComponent', () => {
  let fixture: ComponentFixture<PantryProductImageEditorComponent>;
  let pantry: jasmine.SpyObj<PantryService>;
  let toast: jasmine.SpyObj<ToastService>;
  let household: { household: jasmine.Spy };

  beforeEach(async () => {
    pantry = jasmine.createSpyObj<PantryService>('PantryService', [
      'getProductImageSearch', 'retryProductImageSearch', 'cancelProductImageSearch',
      'selectProductImage', 'uploadProductImage'
    ]);
    pantry.getProductImageSearch.and.resolveTo(COMPLETE);
    pantry.retryProductImageSearch.and.resolveTo(COMPLETE);
    pantry.cancelProductImageSearch.and.resolveTo({ ...COMPLETE, status: 'cancelled' });
    pantry.selectProductImage.and.resolveTo({ image: '/api/recipe-images/selected' });
    pantry.uploadProductImage.and.resolveTo({ image: '/api/uploads/product-images/uploaded.png' });
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    household = { household: jasmine.createSpy('household').and.returnValue({ myPermissions: { pantry: { edit: true } } }) };

    await TestBed.configureTestingModule({
      imports: [PantryProductImageEditorComponent],
      providers: [
        { provide: PantryService, useValue: pantry },
        { provide: HouseholdService, useValue: household },
        { provide: ToastService, useValue: toast },
        { provide: I18nService, useValue: { t: (key: string) => key, changeTick: signal(0) } }
      ]
    }).overrideComponent(PantryProductImageEditorComponent, { set: { template: '' } }).compileComponents();

    fixture = TestBed.createComponent(PantryProductImageEditorComponent);
    fixture.componentRef.setInput('producto', PRODUCT);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('recupera el estado guardado y falla de forma inocua si la lectura inicial no está disponible', async () => {
    expect(pantry.getProductImageSearch).toHaveBeenCalledWith(PRODUCT.id);
    expect(fixture.componentInstance.estadoImagen()).toEqual(COMPLETE);

    pantry.getProductImageSearch.and.rejectWith(new Error('offline'));
    await (fixture.componentInstance as any).cargar(PRODUCT.id);
    expect(fixture.componentInstance.estadoImagen()).toEqual({ status: 'idle', jobId: null, candidates: [], errorCode: null });
  });

  it('evita retries duplicados y mantiene la UI disponible al completar o fallar', async () => {
    fixture.componentInstance.imagenOcupada.set(true);
    await fixture.componentInstance.buscarImagenes();
    expect(pantry.retryProductImageSearch).not.toHaveBeenCalled();

    fixture.componentInstance.imagenOcupada.set(false);
    await fixture.componentInstance.buscarImagenes();
    expect(pantry.retryProductImageSearch).toHaveBeenCalledOnceWith(PRODUCT.id);
    expect(fixture.componentInstance.imagenOcupada()).toBeFalse();
    expect(fixture.componentInstance.estadoImagen()).toEqual(COMPLETE);

    pantry.retryProductImageSearch.and.rejectWith(new Error('offline'));
    await fixture.componentInstance.buscarImagenes();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'pantry.item_image_failed');
    expect(fixture.componentInstance.imagenOcupada()).toBeFalse();
  });

  it('cancela búsquedas y trata errores sin propagar excepciones', async () => {
    await fixture.componentInstance.cancelarBusquedaImagen();
    expect(pantry.cancelProductImageSearch).toHaveBeenCalledOnceWith(PRODUCT.id);
    expect(fixture.componentInstance.estadoImagen().status).toBe('cancelled');

    pantry.cancelProductImageSearch.and.rejectWith(new Error('offline'));
    await fixture.componentInstance.cancelarBusquedaImagen();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'pantry.item_image_failed');
  });

  it('selecciona una imagen licenciada, actualiza al padre y muestra los dos resultados posibles', async () => {
    const selected: string[] = [];
    fixture.componentInstance.imageChange.subscribe((image) => selected.push(image));
    await fixture.componentInstance.seleccionarImagen(CANDIDATE.id);
    expect(pantry.selectProductImage).toHaveBeenCalledOnceWith(PRODUCT.id, CANDIDATE.id);
    expect(selected).toEqual(['/api/recipe-images/selected']);
    expect(toast.success).toHaveBeenCalledWith('pantry.item_image_title', 'pantry.item_image_saved');

    pantry.selectProductImage.and.rejectWith(new Error('offline'));
    await fixture.componentInstance.seleccionarImagen(CANDIDATE.id);
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'pantry.item_image_failed');
  });

  it('rechaza tipo/tamaño no permitidos, ignora la selección vacía y sube un fichero válido', async () => {
    const input = (file: File | null) => ({ files: file ? [file] : [], value: 'selected' }) as unknown as HTMLInputElement;
    const invalidInput = input(new File(['text'], 'not-image.txt', { type: 'text/plain' }));
    await fixture.componentInstance.subirImagen({ target: invalidInput } as unknown as Event);
    expect(invalidInput.value).toBe('');
    expect(pantry.uploadProductImage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('ui.error', 'pantry.item_image_invalid');

    const huge = input(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' }));
    await fixture.componentInstance.subirImagen({ target: huge } as unknown as Event);
    expect(pantry.uploadProductImage).not.toHaveBeenCalled();

    const empty = input(null);
    await fixture.componentInstance.subirImagen({ target: empty } as unknown as Event);
    expect(empty.value).toBe('');

    const selected: string[] = [];
    fixture.componentInstance.imageChange.subscribe((image) => selected.push(image));
    const valid = input(new File([new Uint8Array([1, 2, 3])], 'tomato.png', { type: 'image/png' }));
    await fixture.componentInstance.subirImagen({ target: valid } as unknown as Event);
    expect(pantry.uploadProductImage).toHaveBeenCalledOnceWith(PRODUCT.id, jasmine.stringMatching(/^data:image\/png;base64,/));
    expect(selected).toEqual(['/api/uploads/product-images/uploaded.png']);
  });

  it('no muestra permisos de edición a miembros con pantry.edit=false y conserva la selección si falla la carga', () => {
    household.household.and.returnValue({ myPermissions: { pantry: { edit: false } } });
    expect(fixture.componentInstance.puedeEditar()).toBeFalse();
  });
});
