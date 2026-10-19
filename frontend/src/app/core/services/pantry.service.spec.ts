import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { throwError } from 'rxjs';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { CaducidadRow } from '../../shared/models/caducidades.model';
import {
  Ingredient,
  PantryCategory,
  PantryProduct,
  Utensil
} from '../../shared/models/pantry.model';
import { PantryService } from './pantry.service';

const CADUCIDAD: CaducidadRow = {
  id: 'qa-expiry-1',
  name: 'Tomates de prueba',
  category: 'other',
  quantity: 2,
  unit: 'ud',
  expirationDate: '2026-10-04',
  estimatedDays: null,
  shelfSource: 'fecha',
  vence: '2026-10-04',
  daysLeft: 2,
  cadaDias: null,
  unidadesPorCompra: null,
  duraDias: null,
  lastBought: null
};

describe('PantryService expiry loading', () => {
  let service: PantryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PantryService]
    });
    service = TestBed.inject(PantryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('represents a successful empty response as empty, not as an error', () => {
    service.loadCaducidades();

    expect(service.cargandoCaducidades()).toBeTrue();
    expect(service.caducidadesError()).toBeFalse();
    http.expectOne('/api/pantry/expiry').flush({ data: [] });

    expect(service.cargandoCaducidades()).toBeFalse();
    expect(service.caducidadesError()).toBeFalse();
    expect(service.caducidades()).toEqual([]);
  });

  it('surfaces a failed expiry request and always exits loading', () => {
    service.loadCaducidades();
    const request = http.expectOne('/api/pantry/expiry');
    expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
    request.flush({}, { status: 503, statusText: 'Service Unavailable' });

    expect(service.cargandoCaducidades()).toBeFalse();
    expect(service.caducidadesError()).toBeTrue();
    expect(service.caducidades()).toEqual([]);
  });

  it('treats a malformed successful payload as a load error instead of an empty pantry', () => {
    service.loadCaducidades();
    http.expectOne('/api/pantry/expiry').flush({ data: null });

    expect(service.cargandoCaducidades()).toBeFalse();
    expect(service.caducidadesError()).toBeTrue();
    expect(service.caducidades()).toEqual([]);
  });

  it('clears the error and replaces rows when a retry succeeds', () => {
    service.loadCaducidades();
    http
      .expectOne('/api/pantry/expiry')
      .flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(service.caducidadesError()).toBeTrue();

    service.loadCaducidades();
    expect(service.cargandoCaducidades()).toBeTrue();
    expect(service.caducidadesError()).toBeFalse();
    http.expectOne('/api/pantry/expiry').flush({ data: [CADUCIDAD] });

    expect(service.cargandoCaducidades()).toBeFalse();
    expect(service.caducidadesError()).toBeFalse();
    expect(service.caducidades()).toEqual([CADUCIDAD]);
  });

  it('keeps a retryable error state when the retry also fails', () => {
    service.loadCaducidades();
    http
      .expectOne('/api/pantry/expiry')
      .flush({}, { status: 503, statusText: 'Service Unavailable' });

    service.loadCaducidades();
    http
      .expectOne('/api/pantry/expiry')
      .flush({}, { status: 503, statusText: 'Service Unavailable' });

    expect(service.cargandoCaducidades()).toBeFalse();
    expect(service.caducidadesError()).toBeTrue();
  });
});

const INGREDIENT: Ingredient = {
  id: 'qa-ingredient-1',
  name: 'Tomates QA',
  category: 'vegetables',
  quantity: 3,
  unit: 'unit',
  expirationDate: new Date('2026-10-04T00:00:00Z'),
  location: 'fridge',
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z')
};

const UTENSIL: Utensil = {
  id: 'qa-utensil-1',
  name: 'Horno QA',
  category: 'oven',
  available: true
};

const CATEGORY: PantryCategory = {
  id: 'qa-category-1',
  key: 'qa-verduras',
  name: 'Verduras QA',
  color: '#448855',
  description: null,
  parentKey: null,
  parentName: null,
  position: 1,
  counts: { products: 2, children: 0, descendantProducts: 2 },
  protected: false,
  canDelete: true
};

const PRODUCT: PantryProduct = {
  id: 'qa-product-1',
  name: 'Arroz QA',
  category: 'grains',
  categoryKey: 'grains',
  categoryName: 'Cereales',
  quantity: 0,
  unit: 'kg',
  inPantry: false,
  expirationDate: null,
  location: 'pantry',
  barcode: null,
  notes: null,
  aliases: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  impact: { listLines: 0, priceObservations: 0 }
};

const STATS = {
  total: 8,
  expiringSoon: 2,
  expired: 1,
  byCategory: {},
  byLocation: {}
};

describe('PantryService inventory and catalog contracts', () => {
  let service: PantryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PantryService]
    });
    service = TestBed.inject(PantryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads, retries, cancels, selects and uploads inventory product images via scoped endpoints', async () => {
    const view = {
      status: 'complete' as const,
      jobId: 'image-job-1',
      candidates: [
        {
          id: 'a'.repeat(24),
          altText: 'Tomates frescos',
          author: 'Autora de prueba',
          licenseName: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tomates.jpg',
          previewUrl: '/api/product-image-previews/aaaaaaaaaaaaaaaaaaaaaaaa'
        }
      ],
      errorCode: null
    };

    const loaded = service.getProductImageSearch('item/1');
    http.expectOne('/api/pantry/ingredients/item%2F1/image-search').flush({ data: view });
    await expectAsync(loaded).toBeResolvedTo(view);

    const retried = service.retryProductImageSearch('item/1');
    const retryRequest = http.expectOne('/api/pantry/ingredients/item%2F1/image-search/retry');
    expect(retryRequest.request.method).toBe('POST');
    expect(retryRequest.request.body).toEqual({});
    retryRequest.flush({ data: { ...view, status: 'queued' } });
    await expectAsync(retried).toBeResolvedTo({ ...view, status: 'queued' });

    const cancelled = service.cancelProductImageSearch('item/1');
    http.expectOne('/api/pantry/ingredients/item%2F1/image-search/cancel').flush({
      data: { ...view, status: 'cancelled' }
    });
    await expectAsync(cancelled).toBeResolvedTo({ ...view, status: 'cancelled' });

    const selected = service.selectProductImage('item/1', 'a'.repeat(24));
    const selectRequest = http.expectOne('/api/pantry/ingredients/item%2F1/image-search/select');
    expect(selectRequest.request.body).toEqual({ photoId: 'a'.repeat(24) });
    selectRequest.flush({ data: { image: '/api/recipe-images/aaaaaaaaaaaaaaaaaaaaaaaa' } });
    await expectAsync(selected).toBeResolvedTo({
      image: '/api/recipe-images/aaaaaaaaaaaaaaaaaaaaaaaa'
    });

    const uploaded = service.uploadProductImage('item/1', 'data:image/png;base64,AAAA');
    const uploadRequest = http.expectOne('/api/pantry/ingredients/item%2F1/image');
    expect(uploadRequest.request.body).toEqual({ dataUrl: 'data:image/png;base64,AAAA' });
    uploadRequest.flush({ data: { image: '/api/uploads/product-images/item-1-abcd.png' } });
    await expectAsync(uploaded).toBeResolvedTo({
      image: '/api/uploads/product-images/item-1-abcd.png'
    });
  });

  it('projects the ingredient payload and returns null when a detail is absent or unavailable', () => {
    let ingredient: Ingredient | null | undefined;
    service.getIngredient('qa-ingredient-1').subscribe((value) => (ingredient = value));
    http.expectOne('/api/pantry/ingredients/qa-ingredient-1').flush({ data: INGREDIENT });
    expect(ingredient).toEqual(INGREDIENT);

    let missing: Ingredient | null | undefined;
    service.getIngredient('missing').subscribe((value) => (missing = value));
    http.expectOne('/api/pantry/ingredients/missing').flush({ data: null });
    expect(missing).toBeNull();

    let unavailable: Ingredient | null | undefined;
    service.getIngredient('offline').subscribe((value) => (unavailable = value));
    http
      .expectOne('/api/pantry/ingredients/offline')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(unavailable).toBeNull();
  });

  it('estimates expiry successfully and maps known and unknown backend error codes', async () => {
    const success = service.estimarCaducidades();
    const successRequest = http.expectOne('/api/pantry/expiry/estimate');
    expect(successRequest.request.method).toBe('POST');
    expect(successRequest.request.body).toEqual({});
    expect(successRequest.request.context.get(SILENT_TOAST)).toBeTrue();
    const estimate = { catalogo: 2, ia: 1, sinEstimar: 3, sinFecha: 4 };
    successRequest.flush({ data: estimate });
    await expectAsync(success).toBeResolvedTo(estimate);

    const mappedErrors: ReadonlyArray<[string, 'NO_CONFIG' | 'BAD_JSON' | 'ERROR']> = [
      ['NO_CONFIG', 'NO_CONFIG'],
      ['BAD_JSON', 'BAD_JSON'],
      ['OTHER', 'ERROR']
    ];
    for (const [code, expected] of mappedErrors) {
      const pending = service.estimarCaducidades();
      http
        .expectOne('/api/pantry/expiry/estimate')
        .flush({ error: code }, { status: 422, statusText: 'Unprocessable Entity' });
      await expectAsync(pending).toBeResolvedTo({ error: expected });
    }
  });

  it('projects created ingredient data, updates the signal and loads mapped stats', () => {
    const input = {
      name: INGREDIENT.name,
      category: INGREDIENT.category,
      quantity: 3,
      unit: 'unit' as const,
      location: 'fridge' as const
    };
    let emitted: Ingredient | null | undefined;
    service.createIngredient(input).subscribe((value) => (emitted = value));

    const create = http.expectOne('/api/pantry/ingredients');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(input);
    create.flush({ data: INGREDIENT });
    http.expectOne('/api/pantry/ingredients/stats').flush({ data: STATS });

    expect(emitted).toEqual(INGREDIENT);
    expect(service.ingredients()).toEqual([INGREDIENT]);
    expect(service.stats()?.totalItems).toBe(STATS.total);
  });

  it('projects updated ingredient data, replaces only the matching row and reloads stats', () => {
    service
      .createIngredient({
        name: INGREDIENT.name,
        category: INGREDIENT.category,
        quantity: 3,
        unit: 'unit',
        location: 'fridge'
      })
      .subscribe();
    http.expectOne('/api/pantry/ingredients').flush({ data: INGREDIENT });
    http.expectOne('/api/pantry/ingredients/stats').flush({ data: STATS });

    const updated = { ...INGREDIENT, quantity: 5 };
    let emitted: Ingredient | null | undefined;
    service
      .updateIngredient(INGREDIENT.id, { quantity: 5 })
      .subscribe((value) => (emitted = value));
    const patch = http.expectOne(`/api/pantry/ingredients/${INGREDIENT.id}`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ quantity: 5 });
    patch.flush({ data: updated });
    http.expectOne('/api/pantry/ingredients/stats').flush({ data: STATS });

    expect(emitted).toEqual(updated);
    expect(service.ingredients()).toEqual([updated]);
  });

  it('propagates ingredient mutation errors and returns false for a failed deletion', () => {
    let createError: unknown;
    service
      .createIngredient({
        name: INGREDIENT.name,
        category: INGREDIENT.category,
        quantity: 3,
        unit: 'unit',
        location: 'fridge'
      })
      .subscribe({ error: (error) => (createError = error) });
    http
      .expectOne('/api/pantry/ingredients')
      .flush({ error: 'INVALID' }, { status: 400, statusText: 'Bad Request' });
    expect(createError).toBeTruthy();
    expect(service.ingredients()).toEqual([]);

    let updateError: unknown;
    service
      .updateIngredient(INGREDIENT.id, { quantity: 4 })
      .subscribe({ error: (error) => (updateError = error) });
    http
      .expectOne(`/api/pantry/ingredients/${INGREDIENT.id}`)
      .flush({}, { status: 500, statusText: 'Failed' });
    expect(updateError).toBeTruthy();

    let deleted: boolean | undefined;
    service.deleteIngredient(INGREDIENT.id).subscribe((value) => (deleted = value));
    http
      .expectOne(`/api/pantry/ingredients/${INGREDIENT.id}`)
      .flush({}, { status: 500, statusText: 'Failed' });
    expect(deleted).toBeFalse();
  });

  it('deletes an ingredient only on success and refreshes stats after the mutation', () => {
    service
      .createIngredient({
        name: INGREDIENT.name,
        category: INGREDIENT.category,
        quantity: 3,
        unit: 'unit',
        location: 'fridge'
      })
      .subscribe();
    http.expectOne('/api/pantry/ingredients').flush({ data: INGREDIENT });
    http.expectOne('/api/pantry/ingredients/stats').flush({ data: STATS });

    let deleted: boolean | undefined;
    service.deleteIngredient(INGREDIENT.id).subscribe((value) => (deleted = value));
    http.expectOne(`/api/pantry/ingredients/${INGREDIENT.id}`).flush({
      success: true,
      message: 'Ingredient deleted'
    });
    http.expectOne('/api/pantry/ingredients/stats').flush({ data: STATS });
    expect(deleted).toBeTrue();
    expect(service.ingredients()).toEqual([]);
  });

  it('serializes all active ingredient filters and resets loading on success and failure', () => {
    service.loadIngredients({
      search: 'tomate',
      category: 'vegetables',
      location: 'fridge',
      expiringSoon: true,
      expired: true,
      page: 2,
      pageSize: 15
    });
    expect(service.isLoading()).toBeTrue();
    const request = http.expectOne((candidate) => candidate.url === '/api/pantry/ingredients');
    expect(request.request.params.get('search')).toBe('tomate');
    expect(request.request.params.get('category')).toBe('vegetables');
    expect(request.request.params.get('location')).toBe('fridge');
    expect(request.request.params.get('expiringSoon')).toBe('true');
    expect(request.request.params.get('expired')).toBe('true');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('pageSize')).toBe('15');
    request.flush({ data: { ingredients: [INGREDIENT], total: 12 } });
    expect(service.ingredients()).toEqual([INGREDIENT]);
    expect(service.total()).toBe(12);
    expect(service.isLoading()).toBeFalse();

    service.loadIngredients({ expiringSoon: false, expired: false, page: 0, pageSize: 0 });
    const failed = http.expectOne((candidate) => candidate.url === '/api/pantry/ingredients');
    expect(failed.request.params.keys()).toEqual([]);
    failed.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.isLoading()).toBeFalse();
    expect(service.ingredients()).toEqual([INGREDIENT]);

    service.loadIngredients();
    const unfiltered = http.expectOne('/api/pantry/ingredients');
    expect(unfiltered.request.params.keys()).toEqual([]);
    unfiltered.flush({ data: { ingredients: [], total: 0 } });
    expect(service.ingredients()).toEqual([]);
    expect(service.isLoading()).toBeFalse();
  });

  it('paginates the complete pantry and normalizes quantity and both expiration field spellings', async () => {
    const pending = service.cargarInventarioCompleto();
    expect(service.isLoading()).toBeTrue();
    const first = http.expectOne((candidate) => candidate.url === '/api/pantry/ingredients');
    expect(first.request.params.get('pageSize')).toBe('100');
    expect(first.request.params.get('page')).toBe('1');
    first.flush({
      data: { ingredients: [{ id: 'one', quantity: '2', expiration_date: '2026-10-04' }], total: 2 }
    });

    await Promise.resolve();
    const second = http.expectOne((candidate) => candidate.url === '/api/pantry/ingredients');
    expect(second.request.params.get('page')).toBe('2');
    second.flush({
      data: { ingredients: [{ id: 'two', quantity: null, expirationDate: '2026-10-05' }], total: 2 }
    });
    await pending;

    expect(service.ingredients().length).toBe(2);
    expect(service.ingredients()[0]).toEqual(
      jasmine.objectContaining({
        id: 'one',
        quantity: 2,
        expiration_date: '2026-10-04',
        expirationDate: '2026-10-04'
      })
    );
    expect(service.ingredients()[1]).toEqual(
      jasmine.objectContaining({
        id: 'two',
        quantity: 0,
        expirationDate: '2026-10-05'
      })
    );
    expect(service.total()).toBe(2);
    expect(service.isLoading()).toBeFalse();
  });

  it('stops a complete-inventory load on an empty page and clears loading after request failure', async () => {
    const emptyLoad = service.cargarInventarioCompleto();
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/ingredients')
      .flush({ data: { ingredients: [] } });
    await emptyLoad;
    expect(service.ingredients()).toEqual([]);
    expect(service.total()).toBe(0);
    expect(service.isLoading()).toBeFalse();

    const failedLoad = service.cargarInventarioCompleto();
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/ingredients')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await expectAsync(failedLoad).toBeRejected();
    expect(service.isLoading()).toBeFalse();
  });

  it('honors the 20-page inventory ceiling while retaining the server total', async () => {
    const pending = service.cargarInventarioCompleto();
    for (let page = 1; page <= 20; page += 1) {
      const request = http.expectOne(
        (candidate) =>
          candidate.url === '/api/pantry/ingredients' &&
          candidate.params.get('page') === String(page)
      );
      request.flush({ data: { ingredients: [{ id: `row-${page}`, quantity: 1 }], total: 2050 } });
      await Promise.resolve();
    }
    await pending;
    expect(service.ingredients().length).toBe(20);
    expect(service.total()).toBe(2050);
    expect(service.isLoading()).toBeFalse();
    http.expectNone((candidate) => candidate.url === '/api/pantry/ingredients');
  });

  it('returns a product detail or null for missing data and request failure', async () => {
    const found = service.getProduct('qa-product-1');
    http.expectOne('/api/pantry/products/qa-product-1').flush({ data: PRODUCT });
    await expectAsync(found).toBeResolvedTo(PRODUCT);

    const absent = service.getProduct('missing');
    http.expectOne('/api/pantry/products/missing').flush({ data: null });
    await expectAsync(absent).toBeResolvedTo(null);

    const unavailable = service.getProduct('offline');
    http
      .expectOne('/api/pantry/products/offline')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await expectAsync(unavailable).toBeResolvedTo(null);
  });

  it('loads, creates, updates and deletes utensils while exposing request errors', () => {
    let utensils: Utensil[] | undefined;
    service.loadUtensils().subscribe((value) => (utensils = value));
    http.expectOne('/api/pantry/utensils').flush({ data: [UTENSIL] });
    expect(utensils).toEqual([UTENSIL]);
    expect(service.utensils()).toEqual([UTENSIL]);

    let created: Utensil | undefined;
    service
      .createUtensil({ name: 'Licuadora QA', category: 'blender' })
      .subscribe((value) => (created = value));
    const create = http.expectOne('/api/pantry/utensils');
    expect(create.request.method).toBe('POST');
    create.flush({
      data: { ...UTENSIL, id: 'qa-utensil-2', name: 'Licuadora QA', category: 'blender' }
    });
    expect(created?.id).toBe('qa-utensil-2');
    expect(service.utensils().length).toBe(2);

    let updated: Utensil | undefined;
    service.updateUtensil(UTENSIL.id, { available: false }).subscribe((value) => (updated = value));
    http
      .expectOne(`/api/pantry/utensils/${UTENSIL.id}`)
      .flush({ data: { ...UTENSIL, available: false } });
    expect(updated?.available).toBeFalse();
    expect(service.utensils()[0].available).toBeFalse();

    let deleted: boolean | undefined;
    service.deleteUtensil(UTENSIL.id).subscribe((value) => (deleted = value));
    http.expectOne(`/api/pantry/utensils/${UTENSIL.id}`).flush(null);
    expect(deleted).toBeTrue();
    expect(service.utensils().map((row) => row.id)).toEqual(['qa-utensil-2']);

    let loadError: unknown;
    service.loadUtensils().subscribe({ error: (error) => (loadError = error) });
    http.expectOne('/api/pantry/utensils').flush({}, { status: 500, statusText: 'Failed' });
    expect(loadError).toBeTruthy();
  });

  it('maps ingredient stats and silently preserves them when refresh fails', () => {
    service.loadStats();
    http.expectOne('/api/pantry/ingredients/stats').flush({ data: STATS });
    expect(service.stats()?.totalItems).toBe(8);
    expect(service.stats()?.expiringSoon).toBe(2);

    service.loadStats();
    http
      .expectOne('/api/pantry/ingredients/stats')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    expect(service.stats()?.totalItems).toBe(8);
  });

  it('caches categories, supports force refresh and caches a failed load until forced', () => {
    service.loadCategories();
    http
      .expectOne(
        (request) =>
          request.url === '/api/pantry/categories' && request.params.get('limit') === '100'
      )
      .flush({ data: [CATEGORY] });
    expect(service.categories()).toEqual([CATEGORY]);

    service.loadCategories();
    http.expectNone((candidate) => candidate.url === '/api/pantry/categories');
    service.loadCategories(true);
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({ data: [{ ...CATEGORY, name: 'Refrescada' }] });
    expect(service.categories()[0].name).toBe('Refrescada');

    service.loadCategories(true);
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({}, { status: 500, statusText: 'Failed' });
    expect(service.categories()).toEqual([]);
    service.loadCategories();
    http.expectNone((candidate) => candidate.url === '/api/pantry/categories');
    service.loadCategories(true);
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({ data: [CATEGORY] });
    expect(service.categories()).toEqual([CATEGORY]);
  });

  it('lists categories with filters and returns null on request error', async () => {
    const pending = service.listCategories('with-children', 'verduras', 12, 4);
    const request = http.expectOne((candidate) => candidate.url === '/api/pantry/categories');
    expect(request.request.params.get('view')).toBe('with-children');
    expect(request.request.params.get('q')).toBe('verduras');
    expect(request.request.params.get('limit')).toBe('12');
    expect(request.request.params.get('offset')).toBe('4');
    request.flush({ data: [CATEGORY], meta: { total: 1, limit: 12, offset: 4 }, hasMore: true });
    await expectAsync(pending).toBeResolvedTo({
      data: [CATEGORY],
      meta: { total: 1, limit: 12, offset: 4 },
      hasMore: true
    });

    const failed = service.listCategories();
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await expectAsync(failed).toBeResolvedTo(null);
  });

  it('creates and updates categories, refreshing the category cache after each success', async () => {
    const created = service.createCategory({ name: CATEGORY.name, color: CATEGORY.color });
    const post = http.expectOne('/api/pantry/categories');
    expect(post.request.method).toBe('POST');
    post.flush({ data: CATEGORY });
    const createResult = await created;
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({ data: [CATEGORY] });
    expect(createResult).toEqual({ ok: true, data: CATEGORY });

    const updated = { ...CATEGORY, name: 'Renombrada' };
    const pending = service.updateCategory(CATEGORY.id, { name: updated.name, parentKey: null });
    const patch = http.expectOne(`/api/pantry/categories/${CATEGORY.id}`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ name: updated.name, parentKey: null });
    patch.flush({ data: updated });
    const updateResult = await pending;
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({ data: [updated] });
    expect(updateResult).toEqual({ ok: true, data: updated });
  });

  it('returns category impact and null when the impact endpoint fails', async () => {
    const impact = service.categoryImpact(CATEGORY.id);
    http.expectOne(`/api/pantry/categories/${CATEGORY.id}/delete-impact`).flush({
      data: {
        products: 3,
        children: 1,
        descendantCategories: 2,
        descendantProducts: 4,
        protected: false,
        canDelete: false
      }
    });
    await expectAsync(impact).toBeResolvedTo({
      products: 3,
      children: 1,
      descendantCategories: 2,
      descendantProducts: 4,
      protected: false,
      canDelete: false
    });

    const failed = service.categoryImpact('missing');
    http
      .expectOne('/api/pantry/categories/missing/delete-impact')
      .flush({}, { status: 404, statusText: 'Not Found' });
    await expectAsync(failed).toBeResolvedTo(null);
  });

  it('refreshes category cache after a failed delete and retains the HTTP error contract', async () => {
    const pending = service.deleteCategory(CATEGORY.id);
    http.expectOne(`/api/pantry/categories/${CATEGORY.id}`).flush(
      {
        error: 'CATEGORY_IN_USE',
        message: 'No se puede borrar',
        details: { products: 2 }
      },
      { status: 409, statusText: 'Conflict' }
    );
    const result = await pending;
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({ data: [CATEGORY] });
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'CATEGORY_IN_USE',
      message: 'No se puede borrar',
      details: { products: 2 }
    });
    expect(service.saving()).toBeFalse();
  });

  it('deletes a category on success and maps the empty response while refreshing cache', async () => {
    const pending = service.deleteCategory(CATEGORY.id);
    const deletion = http.expectOne(`/api/pantry/categories/${CATEGORY.id}`);
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null);
    await expectAsync(pending).toBeResolvedTo({ ok: true, data: null });
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({ data: [CATEGORY] });
  });

  it('does not refresh category cache after create/update failures and falls back on incomplete error bodies', async () => {
    const create = service.createCategory({ name: 'Error QA' });
    http.expectOne('/api/pantry/categories').flush({}, { status: 400, statusText: 'Bad Request' });
    const createResult = await create;
    expect(createResult).toEqual({
      ok: false,
      status: 400,
      error: 'UNKNOWN',
      message: 'Bad Request'
    });
    http.expectNone((candidate) => candidate.url === '/api/pantry/categories');

    const update = service.updateCategory(CATEGORY.id, { name: 'Error QA' });
    http.expectOne(`/api/pantry/categories/${CATEGORY.id}`).flush(
      { error: 'BAD_NAME' },
      {
        status: 422,
        statusText: 'Unprocessable Entity'
      }
    );
    const updateResult = await update;
    expect(updateResult).toEqual({
      ok: false,
      status: 422,
      error: 'BAD_NAME',
      message: 'Unprocessable Entity'
    });
    http.expectNone((candidate) => candidate.url === '/api/pantry/categories');
    expect(service.saving()).toBeFalse();
  });

  it('returns a product list with query params, defaults and normalized hasMore/data', async () => {
    const filtered = service.listProducts({
      q: 'arroz',
      category: 'grains',
      filter: 'staples',
      sort: 'recent',
      limit: 5,
      offset: 10
    });
    const request = http.expectOne((candidate) => candidate.url === '/api/pantry/products');
    expect(request.request.params.get('q')).toBe('arroz');
    expect(request.request.params.get('category')).toBe('grains');
    expect(request.request.params.get('filter')).toBe('staples');
    expect(request.request.params.get('sort')).toBe('recent');
    expect(request.request.params.get('limit')).toBe('5');
    expect(request.request.params.get('offset')).toBe('10');
    request.flush({ data: [PRODUCT], meta: { total: 1, limit: 5, offset: 10 }, hasMore: 1 });
    await expectAsync(filtered).toBeResolvedTo({
      data: [PRODUCT],
      meta: { total: 1, limit: 5, offset: 10 },
      hasMore: true
    });

    const defaults = service.listProducts();
    const defaultRequest = http.expectOne((candidate) => candidate.url === '/api/pantry/products');
    expect(defaultRequest.request.params.get('limit')).toBe('10');
    expect(defaultRequest.request.params.get('offset')).toBe('0');
    defaultRequest.flush({ meta: { total: 0, limit: 10, offset: 0 }, hasMore: 0 });
    await expectAsync(defaults).toBeResolvedTo({
      data: [],
      meta: { total: 0, limit: 10, offset: 0 },
      hasMore: false
    });

    const failed = service.listProducts();
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/products')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await expectAsync(failed).toBeResolvedTo(null);
  });

  it('creates and updates products and always clears saving on success', async () => {
    const created = service.createProduct({ name: PRODUCT.name, category: 'grains' });
    expect(service.saving()).toBeTrue();
    const post = http.expectOne('/api/pantry/products');
    expect(post.request.method).toBe('POST');
    post.flush({ data: PRODUCT });
    await expectAsync(created).toBeResolvedTo({ ok: true, data: PRODUCT });
    expect(service.saving()).toBeFalse();

    const updated = { ...PRODUCT, notes: 'nota QA' };
    const patchPromise = service.updateProduct(PRODUCT.id, { notes: 'nota QA' });
    const patch = http.expectOne(`/api/pantry/products/${PRODUCT.id}`);
    expect(patch.request.method).toBe('PATCH');
    patch.flush({ data: updated });
    await expectAsync(patchPromise).toBeResolvedTo({ ok: true, data: updated });
    expect(service.saving()).toBeFalse();
  });

  it('preserves HTTP details and maps malformed successful payloads to a network-style request failure', async () => {
    const conflict = service.createProduct({ name: PRODUCT.name });
    http.expectOne('/api/pantry/products').flush(
      { error: 'IN_USE', message: 'Bloqueado', details: { count: 4 } },
      {
        status: 409,
        statusText: 'Conflict'
      }
    );
    await expectAsync(conflict).toBeResolvedTo({
      ok: false,
      status: 409,
      error: 'IN_USE',
      message: 'Bloqueado',
      details: { count: 4 }
    });
    expect(service.saving()).toBeFalse();

    const malformed = service.createProduct({ name: PRODUCT.name });
    http.expectOne('/api/pantry/products').flush(null);
    const result = await malformed;
    expect(result.ok).toBeFalse();
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.error).toBe('NETWORK');
      expect(result.message).toContain('data');
    }
    expect(service.saving()).toBeFalse();
  });

  it('preserves the API error from an interceptor-wrapped product update failure', async () => {
    const payload = {
      error: 'PANTRY_PRODUCT_ALIAS_CLASH',
      message: 'Ese alias ya esta usado',
      details: { alias: 'Queso de cabra' }
    };
    const response = new HttpErrorResponse({
      error: payload,
      status: 409,
      statusText: 'Conflict'
    });
    spyOn(TestBed.inject(HttpClient), 'patch').and.returnValue(
      throwError(() => ({ status: 409, message: 'Conflicto con el recurso', original: response }))
    );

    const result = await service.updateProduct(PRODUCT.id, { aliases: ['Queso de cabra'] });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'PANTRY_PRODUCT_ALIAS_CLASH',
      message: 'Ese alias ya esta usado',
      details: { alias: 'Queso de cabra' }
    });
    expect(service.saving()).toBeFalse();
  });

  it('returns product impact, deletes a product and handles delete errors', async () => {
    const impact = service.productImpact(PRODUCT.id);
    http.expectOne(`/api/pantry/products/${PRODUCT.id}/delete-impact`).flush({
      data: {
        id: PRODUCT.id,
        name: PRODUCT.name,
        quantity: 0,
        listLines: 2,
        priceObservations: 1,
        canDelete: false
      }
    });
    await expectAsync(impact).toBeResolvedTo({
      id: PRODUCT.id,
      name: PRODUCT.name,
      quantity: 0,
      listLines: 2,
      priceObservations: 1,
      canDelete: false
    });

    const deleting = service.deleteProduct(PRODUCT.id);
    http.expectOne(`/api/pantry/products/${PRODUCT.id}`).flush(null);
    await expectAsync(deleting).toBeResolvedTo({ ok: true, data: null });

    const failed = service.deleteProduct('missing');
    http
      .expectOne('/api/pantry/products/missing')
      .flush({}, { status: 404, statusText: 'Not Found' });
    const failedResult = await failed;
    expect(failedResult.ok).toBeFalse();
    if (!failedResult.ok) expect(failedResult.status).toBe(404);
  });

  it('supports bulk impact and deletion and returns null when bulk impact fails', async () => {
    const impact = {
      requestedCount: 2,
      deletableIds: [PRODUCT.id],
      blocked: [
        {
          id: 'blocked',
          name: 'Atado',
          quantity: 2,
          listLines: 1,
          priceObservations: 0,
          canDelete: false
        }
      ],
      canDelete: false
    };
    const pendingImpact = service.bulkProductImpact([PRODUCT.id, 'blocked']);
    const impactRequest = http.expectOne('/api/pantry/products/bulk-delete-impact');
    expect(impactRequest.request.method).toBe('POST');
    expect(impactRequest.request.body).toEqual({ ids: [PRODUCT.id, 'blocked'] });
    impactRequest.flush({ data: impact });
    await expectAsync(pendingImpact).toBeResolvedTo(impact);

    const deletion = service.bulkDeleteProducts([PRODUCT.id]);
    http.expectOne('/api/pantry/products/bulk-delete').flush({ data: { deleted: 1 } });
    await expectAsync(deletion).toBeResolvedTo({ ok: true, data: { deleted: 1 } });

    const failed = service.bulkProductImpact([]);
    http
      .expectOne('/api/pantry/products/bulk-delete-impact')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await expectAsync(failed).toBeResolvedTo(null);
  });

  it('loads catalog categories and returns an empty list on catalog request failure', async () => {
    const rows = [
      { key: 'grains', name: 'Cereales', color: '#aabbcc', parent: null, productCount: 2 }
    ];
    const pending = service.listCatalogCategories();
    http.expectOne('/api/pantry/catalog/categories').flush({ data: rows });
    await expectAsync(pending).toBeResolvedTo(rows);

    const failed = service.listCatalogCategories();
    http
      .expectOne('/api/pantry/catalog/categories')
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await expectAsync(failed).toBeResolvedTo([]);
  });

  it('lists catalog products with optional filters/defaults and adds selected entries', async () => {
    const catalogProduct = {
      id: 'grains:1',
      name: 'Arroz QA',
      unit: 'kg' as const,
      category: 'grains',
      categoryLabel: 'Cereales',
      inHousehold: false
    };
    const filtered = service.listCatalog({ q: 'arroz', category: 'grains', limit: 6, offset: 3 });
    const request = http.expectOne((candidate) => candidate.url === '/api/pantry/catalog/products');
    expect(request.request.params.get('q')).toBe('arroz');
    expect(request.request.params.get('category')).toBe('grains');
    expect(request.request.params.get('limit')).toBe('6');
    expect(request.request.params.get('offset')).toBe('3');
    request.flush({
      data: [catalogProduct],
      meta: { total: 1, limit: 6, offset: 3 },
      hasMore: true
    });
    await expectAsync(filtered).toBeResolvedTo({
      data: [catalogProduct],
      meta: { total: 1, limit: 6, offset: 3 },
      hasMore: true
    });

    const defaults = service.listCatalog();
    const defaultRequest = http.expectOne(
      (candidate) => candidate.url === '/api/pantry/catalog/products'
    );
    expect(defaultRequest.request.params.get('limit')).toBe('24');
    expect(defaultRequest.request.params.get('offset')).toBe('0');
    defaultRequest.flush({ data: null, meta: { total: 0, limit: 24, offset: 0 }, hasMore: false });
    await expectAsync(defaults).toBeResolvedTo({
      data: [],
      meta: { total: 0, limit: 24, offset: 0 },
      hasMore: false
    });

    const adding = service.addFromCatalog([catalogProduct.id]);
    const addRequest = http.expectOne('/api/pantry/catalog/add');
    expect(addRequest.request.body).toEqual({ ids: [catalogProduct.id] });
    addRequest.flush({ data: { added: 1, skipped: 0, categoriesCreated: 0 } });
    await expectAsync(adding).toBeResolvedTo({
      ok: true,
      data: { added: 1, skipped: 0, categoriesCreated: 0 }
    });

    const failed = service.listCatalog();
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/catalog/products')
      .flush({}, { status: 500, statusText: 'Failed' });
    await expectAsync(failed).toBeResolvedTo(null);
  });

  it('looks up a category by key and safely handles absent keys', () => {
    expect(service.categoryByKey(null)).toBeUndefined();
    expect(service.categoryByKey(undefined)).toBeUndefined();
    expect(service.categoryByKey('')).toBeUndefined();

    service.loadCategories();
    http
      .expectOne((candidate) => candidate.url === '/api/pantry/categories')
      .flush({ data: [CATEGORY] });
    expect(service.categoryByKey(CATEGORY.key)).toEqual(CATEGORY);
    expect(service.categoryByKey('missing')).toBeUndefined();
  });
});
