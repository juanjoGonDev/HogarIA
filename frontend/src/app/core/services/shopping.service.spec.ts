import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { HouseholdService } from './household.service';
import { I18nService } from '../../core/services/i18n.service';
import { SILENT_TOAST } from '../interceptors/error.interceptor';
import { ShoppingService } from './shopping.service';
import { ToastService } from './toast.service';
import type {
  ListDiscount,
  ListEstimate,
  ListEvent,
  PhotoAnalysis,
  PriceObservation,
  ShoppingCategory,
  ShoppingList,
  ShoppingListItem
} from '../../shared/models/shopping.model';

const API = '/api/shopping';
const LIST_ID = 'list-1';
const ITEM_ID = 'item-1';

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    id: LIST_ID,
    name: 'Compra semanal',
    store: null,
    status: 'active',
    version: 3,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    totalItems: 1,
    checkedItems: 0,
    pricedTotalMinor: 0,
    ...overrides
  };
}

function makeItem(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: ITEM_ID,
    list_id: LIST_ID,
    name: 'Leche',
    product_key: 'leche',
    quantity: 1,
    unit: null,
    category: null,
    price_minor: null,
    note: null,
    position: 0,
    checked: 0,
    deleted_at: null,
    promo_buy: null,
    promo_take: null,
    disc_kind: null,
    disc_value_minor: null,
    disc_percent_bps: null,
    disc_units: null,
    added_by: null,
    updated_by: null,
    ...overrides
  };
}

function makeEstimate(overrides: Partial<ListEstimate> = {}): ListEstimate {
  return {
    listId: LIST_ID,
    currency: 'EUR',
    totalMinor: 125,
    pricedLines: 1,
    unpriced: [],
    lines: [],
    ...overrides
  };
}

function makePrice(id: string, overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id,
    product_name: 'Leche',
    product_key: 'leche',
    store_name: 'Tienda',
    price_minor: 125,
    quantity: 1,
    observed_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function makeCategory(): ShoppingCategory {
  return { id: 'cat-1', name: 'Lácteos', color: '#abc123', position: 1, key: 'lacteos' };
}

function pricesPage(offset: number, count: number): PriceObservation[] {
  return Array.from({ length: count }, (_, index) => makePrice(`price-${offset + index}`));
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function settleTimers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('ShoppingService', () => {
  let service: ShoppingService;
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;
  let i18n: { t: jasmine.Spy };
  let auth: { getToken: jasmine.Spy };
  let restoreEventSource: (() => void) | null;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;
  let householdContextRevision: ReturnType<typeof signal<number>>;

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['warning', 'error']);
    i18n = { t: jasmine.createSpy('t').and.callFake((key: string) => key) };
    auth = { getToken: jasmine.createSpy('getToken').and.returnValue('fake token&value') };
    restoreEventSource = null;
    activeHouseholdId = signal<string | null>(null);
    householdContextRevision = signal(0);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: I18nService, useValue: i18n },
        { provide: ToastService, useValue: toast },
        {
          provide: HouseholdService,
          useValue: {
            activeHouseholdId,
            contextRevision: householdContextRevision,
            switchingHousehold: signal(false)
          }
        },
        { provide: AuthService, useValue: auth }
      ]
    });
    service = TestBed.inject(ShoppingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(async () => {
    await settleTimers();
    restoreEventSource?.();
    http.verify();
  });

  describe('lists and suggested shopping', () => {
    it('loads default list filters and updates data, metadata, and loading state', () => {
      service.loadLists();
      expect(service.loadingLists()).toBeTrue();

      const request = http.expectOne((req) => req.url === `${API}/lists`);
      expect(request.request.method).toBe('GET');
      expect(request.request.params.keys().sort()).toEqual(['limit', 'offset', 'status']);
      expect(request.request.params.get('status')).toBe('active');
      expect(request.request.params.get('limit')).toBe('25');
      expect(request.request.params.get('offset')).toBe('0');

      const list = makeList();
      const meta = { total: 8, limit: 25, offset: 0 };
      request.flush({ data: [list], meta });

      expect(service.lists()).toEqual([list]);
      expect(service.listsMeta()).toEqual(meta);
      expect(service.loadingLists()).toBeFalse();
    });

    it('serializes every truthy filter, accepts a status shorthand, and reloads the saved query', () => {
      const query = {
        status: 'all' as const,
        q: ' compra ',
        store: 'Mercado',
        minTotalMinor: 125,
        from: '2026-01-01',
        to: '2026-01-31',
        sort: 'total' as const,
        dir: 'desc' as const,
        limit: 10,
        offset: 20
      };

      service.loadLists(query);
      const first = http.expectOne((req) => req.url === `${API}/lists`);
      expect(first.request.params.get('status')).toBe('all');
      expect(first.request.params.get('q')).toBe(' compra ');
      expect(first.request.params.get('store')).toBe('Mercado');
      expect(first.request.params.get('minTotalMinor')).toBe('125');
      expect(first.request.params.get('from')).toBe('2026-01-01');
      expect(first.request.params.get('to')).toBe('2026-01-31');
      expect(first.request.params.get('sort')).toBe('total');
      expect(first.request.params.get('dir')).toBe('desc');
      expect(first.request.params.get('limit')).toBe('10');
      expect(first.request.params.get('offset')).toBe('20');
      first.flush({ data: [] });

      service.reloadLists();
      const reload = http.expectOne((req) => req.url === `${API}/lists`);
      expect(reload.request.params.get('q')).toBe(' compra ');
      expect(reload.request.params.get('minTotalMinor')).toBe('125');
      reload.flush({ data: [makeList()] });

      service.loadLists('done');
      const shorthand = http.expectOne((req) => req.url === `${API}/lists`);
      expect(shorthand.request.params.get('status')).toBe('done');
      shorthand.flush({ data: [] });
    });

    it('keeps the history query when reopening succeeds and avoids refreshing after a failed reopen', async () => {
      const historyQuery = { status: 'done' as const, q: 'ticket', limit: 10 };
      service.loadLists(historyQuery);
      http
        .expectOne((req) => req.url === `${API}/lists`)
        .flush({ data: [makeList({ status: 'done' })] });

      const reopen = service.setStatus(LIST_ID, 'active');
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: makeList({ status: 'active' }) });
      await reopen;

      const refreshedHistory = http.expectOne((req) => req.url === `${API}/lists`);
      expect(refreshedHistory.request.params.get('status')).toBe('done');
      expect(refreshedHistory.request.params.get('q')).toBe('ticket');
      refreshedHistory.flush({ data: [makeList({ status: 'done' })] });

      const failedReopen = service.setStatus(LIST_ID, 'active');
      http
        .expectOne(`${API}/lists/${LIST_ID}`)
        .flush(
          { message: 'synthetic unavailable' },
          { status: 503, statusText: 'Service Unavailable' }
        );
      await expectAsync(failedReopen).toBeResolvedTo(null);
      http.expectNone((req) => req.url === `${API}/lists`);

      service.reloadLists();
      const retryHistory = http.expectOne((req) => req.url === `${API}/lists`);
      expect(retryHistory.request.params.get('status')).toBe('done');
      expect(retryHistory.request.params.get('q')).toBe('ticket');
      retryHistory.flush({ data: [makeList({ status: 'done' })] });
    });

    it('omits nonpositive minimum totals, preserves old metadata when absent, and clears loading on error', () => {
      service.listsMeta.set({ total: 7, limit: 5, offset: 2 });
      service.loadLists({ minTotalMinor: 0, limit: 5, offset: 2 });
      const zero = http.expectOne((req) => req.url === `${API}/lists`);
      expect(zero.request.params.has('minTotalMinor')).toBeFalse();
      zero.flush({ data: [] });
      expect(service.listsMeta()).toEqual({ total: 7, limit: 5, offset: 2 });

      service.loadLists({ minTotalMinor: -1 });
      const negative = http.expectOne((req) => req.url === `${API}/lists`);
      expect(negative.request.params.has('minTotalMinor')).toBeFalse();
      negative.flush({ data: [makeList()] });

      service.loadLists();
      http
        .expectOne((req) => req.url === `${API}/lists`)
        .flush({ message: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
      expect(service.loadingLists()).toBeFalse();
      expect(service.lists()).toEqual([makeList()]);
    });

    it('loads and applies suggestions, then refreshes the suggestion and list tray', async () => {
      const suggestion = { sugerencias: [], lista: null };
      service.cargarSugerencia();
      expect(service.cargandoSugerencia()).toBeTrue();
      http.expectOne(`${API}/suggested`).flush({ data: suggestion });
      expect(service.sugerencia()).toEqual(suggestion);
      expect(service.cargandoSugerencia()).toBeFalse();

      service.loadLists({ status: 'archived', q: 'semana', offset: 3 });
      http.expectOne((req) => req.url === `${API}/lists`).flush({ data: [] });
      const apply = service.aplicarSugerida();
      const post = http.expectOne(`${API}/suggested`);
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ name: 'shopping_suggested.nombre_lista' });
      post.flush({ data: { id: LIST_ID, creada: false, sugeridos: 2 } });

      http.expectOne(`${API}/suggested`).flush({ data: suggestion });
      const lists = http.expectOne((req) => req.url === `${API}/lists`);
      expect(lists.request.params.get('status')).toBe('archived');
      expect(lists.request.params.get('q')).toBe('semana');
      expect(lists.request.params.get('offset')).toBe('3');
      lists.flush({ data: [] });
      await expectAsync(apply).toBeResolvedTo({ id: LIST_ID, creada: false, sugeridos: 2 });
    });

    it('clears suggestion loading after failure and returns null for failed application', async () => {
      service.cargarSugerencia();
      http
        .expectOne(`${API}/suggested`)
        .flush({ message: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
      expect(service.cargandoSugerencia()).toBeFalse();

      const apply = service.aplicarSugerida();
      http.expectOne(`${API}/suggested`).error(new ProgressEvent('error'));
      expect(await apply).toBeNull();
      expect(toast.warning).toHaveBeenCalledWith('ui.sin_conexion', 'ui.el_cambio_se_reintentara');
    });

    it('loads stores, categories, and events with fallback data and category caching', () => {
      service.loadStores();
      http.expectOne(`${API}/stores`).flush({ data: [{ store: 'Tienda', lists: 2 }] });
      expect(service.stores()).toEqual([{ store: 'Tienda', lists: 2 }]);

      service.loadStores();
      http
        .expectOne(`${API}/stores`)
        .flush({ message: 'offline' }, { status: 503, statusText: 'Unavailable' });
      expect(service.stores()).toEqual([]);

      service.loadCategories();
      http.expectOne(`${API}/categories`).flush({ data: [makeCategory()] });
      expect(service.categories()).toEqual([makeCategory()]);
      service.loadCategories();
      http.expectNone(`${API}/categories`);
      service.loadCategories(true);
      http
        .expectOne(`${API}/categories`)
        .flush({ message: 'offline' }, { status: 503, statusText: 'Unavailable' });
      expect(service.categories()).toEqual([]);
      service.loadCategories();
      http.expectNone(`${API}/categories`);

      service.loadEvents(LIST_ID, 12);
      const events = http.expectOne((req) => req.url === `${API}/lists/${LIST_ID}/events`);
      expect(events.request.params.get('limit')).toBe('12');
      events.flush({ message: 'offline' }, { status: 503, statusText: 'Unavailable' });
      expect(service.events()).toEqual([]);

      service.loadEvents(LIST_ID);
      const defaultLimit = http.expectOne((req) => req.url === `${API}/lists/${LIST_ID}/events`);
      expect(defaultLimit.request.params.get('limit')).toBe('60');
      defaultLimit.flush({ data: [] as ListEvent[] });
    });

    it('creates a category and forces a catalog refresh', async () => {
      const created = makeCategory();
      const result = service.createCategory('Lácteos');
      const post = http.expectOne(`${API}/categories`);
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ name: 'Lácteos', color: null });
      post.flush({ data: created });
      http.expectOne(`${API}/categories`).flush({ data: [created] });
      await expectAsync(result).toBeResolvedTo(created);
      expect(service.categories()).toEqual([created]);
    });

    it('opens a controlled stream, encodes the token, parses payloads, and closes it', () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource');
      const eventListeners = new Map<string, (event: { data: string }) => void>();
      const close = jasmine.createSpy('close');
      const source: {
        onopen: ((this: unknown, event: unknown) => void) | null;
        onerror: ((this: unknown, event: unknown) => void) | null;
        onmessage: ((this: unknown, event: { data: string }) => void) | null;
        addEventListener: (name: string, listener: (event: { data: string }) => void) => void;
        close: jasmine.Spy;
      } = {
        onopen: null,
        onerror: null,
        onmessage: null,
        addEventListener: (name: string, listener: (event: { data: string }) => void) =>
          eventListeners.set(name, listener),
        close
      };
      let openedUrl = '';
      Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: function (url: string) {
          openedUrl = url;
          return source;
        }
      });
      restoreEventSource = () => {
        if (original) Object.defineProperty(globalThis, 'EventSource', original);
        else Reflect.deleteProperty(globalThis, 'EventSource');
      };

      const onEvent = jasmine.createSpy('onEvent');
      const closeStream = service.openStream('lists/list-1', onEvent);
      expect(openedUrl).toBe(`${API}/stream/lists/list-1?access_token=fake%20token%26value`);
      source.onmessage?.({ data: '{"type":"message"}' });
      eventListeners.get('change')?.({ data: '{"type":"change"}' });
      eventListeners.get('ready')?.({ data: 'not-json' });
      expect(onEvent.calls.allArgs()).toEqual([
        [{ type: 'message' }],
        [{ type: 'change' }],
        [null]
      ]);
      closeStream();
      expect(close).toHaveBeenCalledTimes(1);

      auth.getToken.and.returnValue(null);
      const closeTray = service.openStream('tray', onEvent);
      expect(openedUrl).toBe(`${API}/stream/tray?access_token=`);
      closeTray();
      expect(close).toHaveBeenCalledTimes(2);
    });
  });

  describe('photo input and list mutations', () => {
    it('analyzes a photo without writing and returns inline error details', async () => {
      const analysis: PhotoAnalysis = {
        listId: LIST_ID,
        mode: 'auto',
        currency: 'EUR',
        warnings: [],
        lines: [],
        categories: []
      };
      const success = service.analyzePhoto(LIST_ID, 'synthetic-image');
      const request = http.expectOne(`${API}/lists/${LIST_ID}/photo/analyze`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        image: 'synthetic-image',
        mode: 'auto',
        note: undefined
      });
      expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
      request.flush({ data: analysis });
      await expectAsync(success).toBeResolvedTo({ ok: true, data: analysis });

      const failure = service.analyzePhoto(LIST_ID, 'synthetic-image', 'ticket', '  ');
      const failedRequest = http.expectOne(`${API}/lists/${LIST_ID}/photo/analyze`);
      expect(failedRequest.request.body).toEqual({
        image: 'synthetic-image',
        mode: 'ticket',
        note: undefined
      });
      failedRequest.flush(
        { message: 'AI_UNAVAILABLE', data: { retryable: true } },
        { status: 503, statusText: 'Unavailable' }
      );
      await expectAsync(failure).toBeResolvedTo({
        ok: false,
        status: 503,
        message: 'AI_UNAVAILABLE',
        data: { retryable: true }
      });

      const fallback = service.analyzePhoto(LIST_ID, 'synthetic-image', 'shelf', 'nota');
      const fallbackRequest = http.expectOne(`${API}/lists/${LIST_ID}/photo/analyze`);
      expect(fallbackRequest.request.body).toEqual({
        image: 'synthetic-image',
        mode: 'shelf',
        note: 'nota'
      });
      fallbackRequest.error(new ProgressEvent('error'));
      await expectAsync(fallback).toBeResolvedTo({
        ok: false,
        status: 0,
        message: 'AI_UNAVAILABLE',
        data: {}
      });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('applies photo lines and reloads detail, estimate, and forced categories', async () => {
      const lines = [{ name: 'Pan', quantity: 2 }];
      const result = service.applyPhotoLines(LIST_ID, lines);
      const apply = http.expectOne(`${API}/lists/${LIST_ID}/items/apply`);
      expect(apply.request.body).toEqual({ lines });
      apply.flush({ data: { added: 1, merged: [], createdCategories: [] } });

      http
        .expectOne(`${API}/lists/${LIST_ID}`)
        .flush({ data: { ...makeList(), items: [makeItem()] } });
      http.expectOne(`${API}/categories`).flush({ data: [makeCategory()] });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(result).toBeResolvedTo({ added: 1, merged: [], createdCategories: [] });
      expect(service.items()).toEqual([makeItem()]);
      expect(service.categories()).toEqual([makeCategory()]);
    });

    it('creates, renames, and deletes lists with the expected bodies and refreshes', async () => {
      const created = makeList({ name: 'Nueva' });
      const create = service.createList('Nueva', '  ');
      const post = http.expectOne(`${API}/lists`);
      expect(post.request.body).toEqual({ name: 'Nueva', store: null });
      post.flush({ data: created });
      http.expectOne((req) => req.url === `${API}/lists`).flush({ data: [created] });
      await expectAsync(create).toBeResolvedTo(created);

      service.list.set(makeList({ version: 9 }));
      const renamed = makeList({ name: 'Renombrada', version: 10 });
      const rename = service.renameList(LIST_ID, { name: 'Renombrada' });
      const patch = http.expectOne(`${API}/lists/${LIST_ID}`);
      expect(patch.request.method).toBe('PATCH');
      expect(patch.request.body).toEqual({ name: 'Renombrada', version: 9 });
      expect(patch.request.context.get(SILENT_TOAST)).toBeTrue();
      patch.flush({ data: renamed });
      await expectAsync(rename).toBeResolvedTo(renamed);
      expect(service.list()).toEqual(renamed);

      service.list.set(null);
      service.lists.set([makeList({ version: 12 })]);
      const renameFromTray = service.renameList(LIST_ID, { store: null });
      const trayPatch = http.expectOne(`${API}/lists/${LIST_ID}`);
      expect(trayPatch.request.body).toEqual({ store: null, version: 12 });
      trayPatch.flush({ data: renamed });
      await renameFromTray;
      expect(service.list()).toBeNull();

      const defaultVersion = service.renameList('other-list', { name: 'Otra' });
      const defaultPatch = http.expectOne(`${API}/lists/other-list`);
      expect(defaultPatch.request.body.version).toBe(1);
      defaultPatch.flush({ data: makeList({ id: 'other-list' }) });
      await defaultVersion;

      const explicitVersion = service.renameList('manual-version', { name: 'Manual' }, 21);
      const explicitPatch = http.expectOne(`${API}/lists/manual-version`);
      expect(explicitPatch.request.body.version).toBe(21);
      explicitPatch.flush({ data: makeList({ id: 'manual-version', name: 'Manual' }) });
      await explicitVersion;

      const failedRename = service.renameList(LIST_ID, { name: 'No guardada' }, 22);
      const failedPatch = http.expectOne(`${API}/lists/${LIST_ID}`);
      failedPatch.flush(
        { message: 'LIST_VERSION_CONFLICT' },
        { status: 409, statusText: 'Conflict' }
      );
      await expectAsync(failedRename).toBeResolvedTo(null);
      expect(toast.warning).toHaveBeenCalledOnceWith('ui.la_lista_cambio_en', undefined);
      expect(toast.error).not.toHaveBeenCalled();

      const deletion = service.deleteList(LIST_ID);
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({});
      http.expectOne((req) => req.url === `${API}/lists`).flush({ data: [] });
      await deletion;
    });

    it('reopens or archives via PATCH and completes through the dedicated endpoint', async () => {
      service.list.set(makeList({ version: 4 }));
      const reopen = service.setStatus(LIST_ID, 'archived');
      const patch = http.expectOne(`${API}/lists/${LIST_ID}`);
      expect(patch.request.body).toEqual({ status: 'archived', version: 4 });
      patch.flush({ data: makeList({ status: 'archived', version: 5 }) });
      await reopen;
      http.expectOne((req) => req.url === `${API}/lists`).flush({ data: [] });

      const complete = service.setStatus(LIST_ID, 'done');
      const request = http.expectOne(`${API}/lists/${LIST_ID}/complete`);
      expect(request.request.body).toEqual({});
      request.flush({
        data: {
          pricesRecorded: 1,
          items: 1,
          paidMinor: 125,
          store: null,
          pantryMoved: 0,
          pantryMerged: 0
        }
      });
      await flushMicrotasks();
      http
        .expectOne(`${API}/lists/${LIST_ID}`)
        .flush({ data: { ...makeList({ status: 'done' }), items: [] } });
      http.expectOne((req) => req.url === `${API}/lists`).flush({ data: [] });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(complete).toBeResolvedTo({
        ok: true,
        pricesRecorded: 1,
        items: 1,
        paidMinor: 125,
        store: null,
        pantryMoved: 0,
        pantryMerged: 0
      });

      const failedComplete = service.setStatus(LIST_ID, 'done');
      http
        .expectOne(`${API}/lists/${LIST_ID}/complete`)
        .flush(
          { message: 'synthetic unavailable' },
          { status: 503, statusText: 'Service Unavailable' }
        );
      await expectAsync(failedComplete).toBeResolvedTo({ ok: false, code: 'ERROR' });
    });

    it('localizes a 503 from reopening without exposing the server message', async () => {
      service.list.set(makeList({ status: 'done', version: 4 }));

      const reopen = service.setStatus(LIST_ID, 'active');
      const request = http.expectOne(`${API}/lists/${LIST_ID}`);
      expect(request.request.context.get(SILENT_TOAST)).toBeTrue();
      request.flush(
        { message: 'synthetic unavailable' },
        { status: 503, statusText: 'Service Unavailable' }
      );

      await expectAsync(reopen).toBeResolvedTo(null);
      expect(toast.error).toHaveBeenCalledOnceWith(
        'ui.no_se_ha_podido',
        'ui.servicio_no_disponible'
      );
    });

    it('maps complete business failures without global toasts and marks its request silent', async () => {
      const missing = [{ itemId: ITEM_ID, name: 'Leche', quantity: 1, unit: null }];
      const missingResult = service.complete(LIST_ID, { store: 'Tienda' });
      const missingRequest = http.expectOne(`${API}/lists/${LIST_ID}/complete`);
      expect(missingRequest.request.context.get(SILENT_TOAST)).toBeTrue();
      expect(missingRequest.request.body).toEqual({ store: 'Tienda' });
      missingRequest.flush(
        { message: 'PRICES_MISSING', data: { missing } },
        { status: 409, statusText: 'Conflict' }
      );
      await expectAsync(missingResult).toBeResolvedTo({
        ok: false,
        code: 'PRICES_MISSING',
        missing
      });

      const missingWithoutPayload = service.complete(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}/complete`)
        .flush({ message: 'PRICES_MISSING' }, { status: 409, statusText: 'Conflict' });
      await expectAsync(missingWithoutPayload).toBeResolvedTo({
        ok: false,
        code: 'PRICES_MISSING',
        missing: []
      });

      const noStore = service.complete(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}/complete`)
        .flush({ message: 'STORE_REQUIRED' }, { status: 409, statusText: 'Conflict' });
      await expectAsync(noStore).toBeResolvedTo({ ok: false, code: 'STORE_REQUIRED' });

      const stale = service.complete(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}/complete`)
        .flush({ message: 'STALE' }, { status: 400, statusText: 'Bad Request' });
      await expectAsync(stale).toBeResolvedTo({ ok: false, code: 'STALE_LIST' });

      const unknown = service.complete(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}/complete`)
        .flush({ message: 'unexpected' }, { status: 503, statusText: 'Unavailable' });
      await expectAsync(unknown).toBeResolvedTo({ ok: false, code: 'ERROR' });
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('warns from the tray when completion needs prices or a store', async () => {
      const missing = [{ itemId: ITEM_ID, name: 'Leche', quantity: 1, unit: null }];
      const oneMissing = service.setStatus(LIST_ID, 'done');
      http
        .expectOne(`${API}/lists/${LIST_ID}/complete`)
        .flush(
          { message: 'PRICES_MISSING', data: { missing } },
          { status: 409, statusText: 'Conflict' }
        );
      await oneMissing;
      expect(toast.warning).toHaveBeenCalledWith('ui.faltan_precios', 'ui.linea_sin_precio_uno');

      toast.warning.calls.reset();
      const twoMissing = service.setStatus(LIST_ID, 'done');
      http.expectOne(`${API}/lists/${LIST_ID}/complete`).flush(
        {
          message: 'PRICES_MISSING',
          data: { missing: [...missing, { ...missing[0], itemId: 'item-2' }] }
        },
        { status: 409, statusText: 'Conflict' }
      );
      await twoMissing;
      expect(toast.warning).toHaveBeenCalledWith('ui.faltan_precios', 'ui.linea_sin_precio_varios');

      toast.warning.calls.reset();
      const storeRequired = service.setStatus(LIST_ID, 'done');
      http
        .expectOne(`${API}/lists/${LIST_ID}/complete`)
        .flush({ message: 'STORE_REQUIRED' }, { status: 409, statusText: 'Conflict' });
      await storeRequired;
      expect(toast.warning).toHaveBeenCalledWith(
        'ui.falta_el_establecimiento',
        'ui.el_precio_se_guarda'
      );
    });

    it('loads known products with trimmed search and clears them on failure', async () => {
      const known = [
        {
          productKey: 'leche',
          name: 'Leche',
          lastObservedAt: '2026-01-01',
          observations: 1,
          variants: []
        }
      ];
      const search = service.loadKnownProducts('  leche  ');
      const request = http.expectOne((req) => req.url === `${API}/prices/products`);
      expect(request.request.params.get('limit')).toBe('60');
      expect(request.request.params.get('q')).toBe('leche');
      request.flush({ data: known });
      await expectAsync(search).toBeResolvedTo(known);
      expect(service.knownProducts()).toEqual(known);

      const emptySearch = service.loadKnownProducts('   ');
      const unfiltered = http.expectOne((req) => req.url === `${API}/prices/products`);
      expect(unfiltered.request.params.has('q')).toBeFalse();
      unfiltered.flush({ message: 'offline' }, { status: 503, statusText: 'Unavailable' });
      await expectAsync(emptySearch).toBeResolvedTo([]);
      expect(service.knownProducts()).toEqual([]);
    });
  });

  describe('items and estimates', () => {
    it('loads a list, splits nested items from the list, defaults absent items, and handles read failure', async () => {
      service.loadList(LIST_ID);
      expect(service.loadingList()).toBeTrue();
      http
        .expectOne(`${API}/lists/${LIST_ID}`)
        .flush({ data: { ...makeList(), items: [makeItem()] } });
      expect(service.list()).toEqual(makeList());
      expect(service.items()).toEqual([makeItem()]);
      expect(service.loadingList()).toBeFalse();
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      expect(service.estimate()).toEqual(makeEstimate());

      service.loadList('list-without-items');
      http
        .expectOne(`${API}/lists/list-without-items`)
        .flush({ data: makeList({ id: 'list-without-items' }) });
      expect(service.items()).toEqual([]);
      http.expectOne(`${API}/lists/list-without-items/estimate`).flush({ data: makeEstimate() });

      service.loadList(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}`)
        .flush({ message: 'offline' }, { status: 503, statusText: 'Unavailable' });
      expect(service.loadingList()).toBeFalse();
    });

    it('adds items with defaults and optional promotions, splits merged, and updates an existing item', async () => {
      const added = makeItem();
      const add = service.addItemWithFlag(LIST_ID, { name: 'Leche' });
      const post = http.expectOne(`${API}/lists/${LIST_ID}/items`);
      expect(post.request.body).toEqual({
        name: 'Leche',
        quantity: 1,
        unit: null,
        category: null,
        priceMinor: null,
        note: null
      });
      post.flush({ data: { ...added, merged: false } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(add).toBeResolvedTo({ item: added, merged: false });
      expect(service.items()).toEqual([added]);

      const patchedItem = makeItem({ quantity: 2, price_minor: 100 });
      const addMerged = service.addItemWithFlag(LIST_ID, {
        name: 'Leche',
        quantity: 2,
        priceMinor: 100,
        offer: { buy: 3, take: 2 },
        discount: { kind: 'percent', percentBps: 1000, units: 2 }
      });
      const mergedPost = http.expectOne(`${API}/lists/${LIST_ID}/items`);
      expect(mergedPost.request.body).toEqual({
        name: 'Leche',
        quantity: 2,
        unit: null,
        category: null,
        priceMinor: 100,
        note: null,
        offer: { buy: 3, take: 2 },
        discount: { kind: 'percent', percentBps: 1000, units: 2 }
      });
      mergedPost.flush({ data: { ...patchedItem, merged: true } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(addMerged).toBeResolvedTo({ item: patchedItem, merged: true });
      expect(service.items()).toEqual([patchedItem]);

      const simpleItem = makeItem({ id: 'item-2', name: 'Pan', product_key: 'pan' });
      const addSimple = service.addItem(LIST_ID, { name: 'Pan' });
      const simplePost = http.expectOne(`${API}/lists/${LIST_ID}/items`);
      simplePost.flush({ data: { ...simpleItem, merged: false } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(addSimple).toBeResolvedTo(simpleItem);
      expect(service.items().map((item) => item.id)).toEqual([ITEM_ID, 'item-2']);
    });

    it('adds bulk lines and reloads the list', async () => {
      const result = service.addLines(LIST_ID, 'Leche\nPan');
      const bulk = http.expectOne(`${API}/lists/${LIST_ID}/items/bulk`);
      expect(bulk.request.body).toEqual({ lines: 'Leche\nPan' });
      const data = { added: 1, merged: 1, skipped: [{ name: 'Pan', reason: 'duplicate' }] };
      bulk.flush({ data });
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: { ...makeList(), items: [] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(result).toBeResolvedTo(data);
    });

    it('updates synchronously optimistically, then reloads detail if the patch fails', async () => {
      service.items.set([makeItem()]);
      const patchResult = makeItem({ product_key: 'leche entera' });
      const success = service.updateItemSync(LIST_ID, makeItem(), { productKey: ' leche entera ' });
      expect(service.items()[0].product_key).toBe('leche entera');
      const patch = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      expect(patch.request.body).toEqual({ productKey: ' leche entera ' });
      patch.flush({ data: patchResult });
      await flushMicrotasks();
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(success).toBeResolvedTo(patchResult);
      expect(service.items()).toEqual([patchResult]);

      const failure = service.updateItemSync(LIST_ID, patchResult, { quantity: 4 });
      http
        .expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`)
        .flush({ message: 'conflict' }, { status: 409, statusText: 'Conflict' });
      await flushMicrotasks();
      http
        .expectOne(`${API}/lists/${LIST_ID}`)
        .flush({ data: { ...makeList(), items: [makeItem()] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(failure).toBeResolvedTo(null);
      expect(service.items()).toEqual([makeItem()]);
    });

    it('maps optimistic patches for quantity, fields, product links, offers, and both discount kinds', async () => {
      const original = makeItem();
      service.items.set([original]);

      service.updateItem(LIST_ID, original, {
        quantity: 2,
        unit: 'l',
        category: 'Lácteos',
        note: 'sin lactosa',
        priceMinor: 250,
        productKey: null,
        offer: null,
        discount: { kind: 'amount', valueMinor: 25, units: 1 }
      });
      expect(service.items()[0]).toEqual({
        ...original,
        quantity: 2,
        unit: 'l',
        category: 'Lácteos',
        note: 'sin lactosa',
        price_minor: 250,
        product_key: 'leche',
        promo_buy: null,
        promo_take: null,
        disc_kind: 'amount',
        disc_value_minor: 25,
        disc_percent_bps: null,
        disc_units: 1
      });
      const patch = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      expect(patch.request.body).toEqual(
        jasmine.objectContaining({ quantity: 2, productKey: null })
      );
      const serverItem = makeItem({ quantity: 2, disc_kind: 'amount', disc_value_minor: 25 });
      patch.flush({ data: serverItem });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await settleTimers();

      const percentItem = makeItem({ disc_kind: 'percent', disc_percent_bps: 500 });
      service.items.set([serverItem]);
      service.updateItem(LIST_ID, serverItem, {
        productKey: '   ',
        offer: { buy: 2, take: 1 },
        discount: { kind: 'percent', percentBps: 500 }
      });
      expect(service.items()[0].product_key).toBe('leche');
      expect(service.items()[0].promo_buy).toBe(2);
      expect(service.items()[0].promo_take).toBe(1);
      expect(service.items()[0].disc_value_minor).toBeNull();
      const percentPatch = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      percentPatch.flush({ data: percentItem });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await settleTimers();
    });

    it('toggles and bumps optimistically, sends boolean checked values, and refreshes bump estimates', async () => {
      const item = makeItem({ checked: 0 });
      service.items.set([item]);
      service.toggleItem(LIST_ID, item);
      expect(service.items()[0].checked).toBe(1);
      const toggle = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      expect(toggle.request.body).toEqual({ checked: true });
      toggle.flush({ data: makeItem({ checked: 1 }) });
      await flushMicrotasks();

      service.toggleItem(LIST_ID, makeItem({ checked: 1 }));
      const untoggle = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      expect(untoggle.request.body).toEqual({ checked: false });
      untoggle.flush({ data: makeItem({ checked: 0 }) });
      await flushMicrotasks();

      service.bumpItem(LIST_ID, makeItem({ quantity: 1 }));
      expect(service.items()[0].quantity).toBe(2);
      const bump = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      expect(bump.request.body).toEqual({ quantity: 2 });
      bump.flush({ data: makeItem({ quantity: 2 }) });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await settleTimers();
      expect(service.pendingWrites()).toBe(0);
      expect(service.saving()).toBeFalse();
    });

    it('bulk checks known items only and removes selected items optimistically', async () => {
      const first = makeItem({ id: 'item-1', checked: 0 });
      const second = makeItem({ id: 'item-2', checked: 1, position: 1 });
      service.items.set([first, second]);
      service.bulkCheck(LIST_ID, ['item-1', 'missing', 'item-2'], true);
      expect(service.items().map((item) => item.checked)).toEqual([1, 1]);
      const check1 = http.expectOne(`${API}/lists/${LIST_ID}/items/item-1`);
      expect(check1.request.body).toEqual({ checked: true });
      check1.flush({ data: makeItem({ id: 'item-1', checked: 1 }) });
      await flushMicrotasks();
      const check2 = http.expectOne(`${API}/lists/${LIST_ID}/items/item-2`);
      expect(check2.request.body).toEqual({ checked: true });
      check2.flush({ data: makeItem({ id: 'item-2', checked: 1 }) });
      await settleTimers();

      const removal = service.removeItem(LIST_ID, first);
      expect(service.items().map((item) => item.id)).toEqual(['item-2']);
      http.expectOne(`${API}/lists/${LIST_ID}/items/item-1`).flush({});
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      expect(await removal).toBeTrue();

      const failedRemoval = service.removeItem(LIST_ID, second);
      http
        .expectOne(`${API}/lists/${LIST_ID}/items/item-2`)
        .flush({ message: 'denied' }, { status: 403, statusText: 'Forbidden' });
      expect(await failedRemoval).toBeFalse();
      expect(service.items()).toEqual([]);
    });

    it('bulk removes existing ids and restores, clears, and reorders with version checks', async () => {
      service.items.set([makeItem({ id: 'item-1' }), makeItem({ id: 'item-2' })]);
      service.bulkRemove(LIST_ID, ['item-1', 'missing', 'item-2']);
      const remove1 = http.expectOne(`${API}/lists/${LIST_ID}/items/item-1`);
      const remove2 = http.expectOne(`${API}/lists/${LIST_ID}/items/item-2`);
      remove1.flush({});
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      remove2.flush({});
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });

      const restore = service.restoreItem(LIST_ID, ITEM_ID);
      http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}/restore`).flush({});
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: { ...makeList(), items: [] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await restore;

      const clear = service.clearChecked(LIST_ID);
      http.expectOne(`${API}/lists/${LIST_ID}/clear-checked`).flush({ data: { removed: 2 } });
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: { ...makeList(), items: [] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await clear;

      service.list.set(makeList({ version: 8 }));
      const reorder = service.reorder(LIST_ID, ['item-2', 'item-1']);
      const order = http.expectOne(`${API}/lists/${LIST_ID}/order`);
      expect(order.request.method).toBe('PUT');
      expect(order.request.body).toEqual({ itemIds: ['item-2', 'item-1'], version: 8 });
      order.flush({ data: {} });
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: { ...makeList(), items: [] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await reorder;

      service.list.set(null);
      const defaultOrder = service.reorder(LIST_ID, []);
      const defaultRequest = http.expectOne(`${API}/lists/${LIST_ID}/order`);
      expect(defaultRequest.request.body.version).toBe(1);
      defaultRequest.flush({ data: {} });
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: { ...makeList(), items: [] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await defaultOrder;
    });

    it('sets and clears list discounts, refreshing the estimate for either branch', async () => {
      const discount: ListDiscount = {
        kind: 'amount',
        valueMinor: 50,
        percentBps: null,
        scope: 'all',
        firstUnits: null,
        label: 'Oferta',
        description: '0,50 €'
      };
      const input = { kind: 'amount' as const, valueMinor: 50 };
      const set = service.setDiscount(LIST_ID, input);
      const put = http.expectOne(`${API}/lists/${LIST_ID}/discount`);
      expect(put.request.method).toBe('PUT');
      expect(put.request.body).toEqual(input);
      put.flush({ data: discount });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(set).toBeResolvedTo(discount);

      const remove = service.setDiscount(LIST_ID, null);
      const deletion = http.expectOne(`${API}/lists/${LIST_ID}/discount`);
      expect(deletion.request.method).toBe('DELETE');
      deletion.flush({ data: null });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await expectAsync(remove).toBeResolvedTo(null);
    });
  });

  describe('write queue and error handling', () => {
    it('clears cached detail data and ignores a late response when the household changes', async () => {
      const homeAListId = 'list-home-a';
      const homeAItem = makeItem({ list_id: homeAListId });
      activeHouseholdId.set('home-a');
      service.list.set(makeList({ id: homeAListId }));
      service.items.set([homeAItem]);
      service.estimate.set(makeEstimate({ listId: homeAListId }));

      service.loadList(homeAListId);
      const responseFromA = http.expectOne(`${API}/lists/${homeAListId}`);
      activeHouseholdId.set('home-b');
      householdContextRevision.set(1);
      await settleTimers();

      expect(service.list()).toBeNull();
      expect(service.items()).toEqual([]);
      expect(service.estimate()).toBeNull();
      responseFromA.flush({
        data: { ...makeList({ id: homeAListId }), items: [homeAItem] }
      });
      await settleTimers();

      expect(service.list()).toBeNull();
      expect(service.items()).toEqual([]);
      expect(service.estimate()).toBeNull();
    });

    it('does not let an older household list read replace the current household results', async () => {
      activeHouseholdId.set('home-a');
      service.loadLists();
      const responseFromA = http.expectOne(`${API}/lists?status=active&limit=25&offset=0`);

      activeHouseholdId.set('home-b');
      householdContextRevision.set(1);
      await settleTimers();
      service.loadLists();
      const responseFromB = http.expectOne(`${API}/lists?status=active&limit=25&offset=0`);
      const homeBList = makeList({ id: 'list-home-b', name: 'Compra de casa dos' });
      responseFromB.flush({ data: [homeBList] });
      responseFromA.flush({ data: [makeList({ id: 'list-home-a', name: 'Compra de casa uno' })] });
      await settleTimers();

      expect(service.lists()).toEqual([homeBList]);
    });

    it('keeps an offline write attached to its source household until that home is active again', async () => {
      const homeAListId = 'list-home-a';
      const item = makeItem({ list_id: homeAListId });
      activeHouseholdId.set('home-a');
      service.toggleItem(homeAListId, item);
      http
        .expectOne(`${API}/lists/${homeAListId}/items/${ITEM_ID}`)
        .error(new ProgressEvent('error'));
      await settleTimers();
      // Repeated intent for the same source item coalesces; a different A item stays after it.
      service.toggleItem(homeAListId, item);
      const homeASecondItem = makeItem({ id: 'item-home-a-second', list_id: homeAListId });
      service.toggleItem(homeAListId, homeASecondItem);
      http.expectNone(`${API}/lists/${homeAListId}/items/${homeASecondItem.id}`);

      activeHouseholdId.set('home-b');
      householdContextRevision.set(1);
      window.dispatchEvent(new Event('online'));
      await settleTimers();
      http.expectNone(`${API}/lists/${homeAListId}/items/${ITEM_ID}`);
      http.expectNone(`${API}/lists/${homeAListId}/items/${homeASecondItem.id}`);

      const homeBListId = 'list-home-b';
      const homeBItem = makeItem({ id: 'item-home-b', list_id: homeBListId, checked: 0 });
      service.toggleItem(homeBListId, homeBItem);
      const homeBWrite = http.expectOne(`${API}/lists/${homeBListId}/items/${homeBItem.id}`);
      expect(homeBWrite.request.body).toEqual({ checked: true });
      homeBWrite.flush({ data: makeItem({ ...homeBItem, checked: 1 }) });
      await settleTimers();
      http.expectNone(`${API}/lists/${homeAListId}/items/${ITEM_ID}`);
      http.expectNone(`${API}/lists/${homeAListId}/items/${homeASecondItem.id}`);

      activeHouseholdId.set('home-a');
      householdContextRevision.set(2);
      window.dispatchEvent(new Event('online'));
      const resumed = http.expectOne(`${API}/lists/${homeAListId}/items/${ITEM_ID}`);
      expect(resumed.request.body).toEqual({ checked: true });
      resumed.flush({ data: makeItem({ list_id: homeAListId, checked: 1 }) });
      await settleTimers();
      const resumedSecond = http.expectOne(
        `${API}/lists/${homeAListId}/items/${homeASecondItem.id}`
      );
      expect(resumedSecond.request.body).toEqual({ checked: true });
      resumedSecond.flush({ data: makeItem({ ...homeASecondItem, checked: 1 }) });
      await settleTimers();
      http.expectNone(`${API}/lists/${homeAListId}/items/${ITEM_ID}`);
      http.expectNone(`${API}/lists/${homeAListId}/items/${homeASecondItem.id}`);
      expect(service.pendingWrites()).toBe(0);
    });

    it('does not let a late response from one home replace another home’s visible item', async () => {
      const homeAListId = 'list-home-a';
      const homeBListId = 'list-home-b';
      const homeAItem = makeItem({ list_id: homeAListId, checked: 0 });
      const homeBItem = makeItem({ id: 'item-home-b', list_id: homeBListId, name: 'Arroz' });
      activeHouseholdId.set('home-a');
      service.items.set([homeAItem]);

      service.toggleItem(homeAListId, homeAItem);
      const homeAWrite = http.expectOne(`${API}/lists/${homeAListId}/items/${homeAItem.id}`);

      activeHouseholdId.set('home-b');
      householdContextRevision.set(1);
      await settleTimers();
      service.items.set([homeBItem]);
      homeAWrite.flush({ data: makeItem({ ...homeAItem, checked: 1 }) });
      await settleTimers();

      expect(service.items()).toEqual([homeBItem]);
      expect(service.pendingWrites()).toBe(0);
    });

    it('preserves one failed network write, pauses immediate draining, and resumes only online', async () => {
      const item = makeItem();
      service.items.set([item]);
      service.toggleItem(LIST_ID, item);
      expect(service.items()[0].checked).toBe(1);
      const first = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      first.error(new ProgressEvent('error'));

      await flushMicrotasks();
      const immediateRetries = http.match(
        (req) => req.url === `${API}/lists/${LIST_ID}/items/${ITEM_ID}` && req.method === 'PATCH'
      );
      // Cleanup is deliberately before the assertion: current code can emit an immediate
      // retry here. Satisfying it lets flush() finish rather than leaking a request or loop.
      for (const retry of immediateRetries) retry.flush({ data: makeItem({ checked: 1 }) });
      await settleTimers();

      if (immediateRetries.length === 0) {
        expect(service.pendingWrites()).toBe(0);
        expect(service.saving()).toBeFalse();
        const nextItem = makeItem({ id: 'item-2', name: 'Pan' });
        service.items.update((items) => [...items, nextItem]);
        service.toggleItem(LIST_ID, nextItem);
        await settleTimers();
        http.expectNone(`${API}/lists/${LIST_ID}/items/${nextItem.id}`);

        window.dispatchEvent(new Event('online'));
        const resumed = http.expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
        expect(resumed.request.body).toEqual({ checked: true });
        resumed.flush({ data: makeItem({ checked: 1 }) });
        await settleTimers();
        const resumedNext = http.expectOne(`${API}/lists/${LIST_ID}/items/${nextItem.id}`);
        expect(resumedNext.request.body).toEqual({ checked: true });
        resumedNext.flush({ data: makeItem({ id: nextItem.id, name: nextItem.name, checked: 1 }) });
        await settleTimers();
      }

      expect(immediateRetries.length).toBe(0);
      expect(service.items()[0].checked).toBe(1);
      expect(service.items()[1].checked).toBe(1);
      expect(service.pendingWrites()).toBe(0);
      expect(service.saving()).toBeFalse();
    });

    it('drops a business write on conflict, warns, and reloads the active list', async () => {
      const list = makeList();
      service.list.set(list);
      service.items.set([makeItem()]);
      service.toggleItem(LIST_ID, makeItem());
      http
        .expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`)
        .flush({ code: 'LIST_VERSION_CONFLICT' }, { status: 409, statusText: 'Conflict' });
      await flushMicrotasks();
      expect(toast.warning).toHaveBeenCalledWith('ui.la_lista_cambio_en', 'ui.se_han_vuelto_a');

      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: { ...list, items: [makeItem()] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await settleTimers();
      expect(service.items()).toEqual([makeItem()]);
      expect(service.pendingWrites()).toBe(0);
      http.expectNone(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
    });

    it('discards a non-conflict business write without retrying or warning', async () => {
      service.items.set([makeItem()]);
      service.toggleItem(LIST_ID, makeItem());
      http
        .expectOne(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`)
        .flush({ message: 'invalid item' }, { status: 422, statusText: 'Unprocessable Entity' });
      await settleTimers();

      http.expectNone(`${API}/lists/${LIST_ID}/items/${ITEM_ID}`);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(service.pendingWrites()).toBe(0);
      expect(service.saving()).toBeFalse();
    });

    it('handles request conflicts, network failures, business errors, and pending-write state', async () => {
      service.list.set(makeList());
      const conflict = service.loadEstimate(LIST_ID);
      const conflictRequest = http.expectOne(`${API}/lists/${LIST_ID}/estimate`);
      expect(service.pendingWrites()).toBe(1);
      expect(service.saving()).toBeTrue();
      conflictRequest.flush(
        { code: 'LIST_VERSION_CONFLICT' },
        { status: 400, statusText: 'Bad Request' }
      );
      await expectAsync(conflict).toBeResolvedTo(null);
      http.expectOne(`${API}/lists/${LIST_ID}`).flush({ data: { ...makeList(), items: [] } });
      http.expectOne(`${API}/lists/${LIST_ID}/estimate`).flush({ data: makeEstimate() });
      await settleTimers();
      expect(toast.warning).toHaveBeenCalledWith('ui.la_lista_cambio_en', 'ui.se_han_vuelto_a');
      expect(service.pendingWrites()).toBe(0);

      const network = service.loadEstimate(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}/estimate`)
        .flush({ message: 'gateway' }, { status: 502, statusText: 'Bad Gateway' });
      await expectAsync(network).toBeResolvedTo(null);
      expect(toast.warning).toHaveBeenCalledWith('ui.sin_conexion', 'ui.el_cambio_se_reintentara');

      const business = service.loadEstimate(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}/estimate`)
        .flush({ message: 'invalid data' }, { status: 422, statusText: 'Unprocessable Entity' });
      await expectAsync(business).toBeResolvedTo(null);
      expect(toast.error).toHaveBeenCalledWith('ui.no_se_ha_podido', 'invalid data');
      await settleTimers();
      expect(service.pendingWrites()).toBe(0);
      expect(service.saving()).toBeFalse();
    });

    it('uses an HTTP status fallback when an error has no server message', async () => {
      const requestPromise = service.loadEstimate(LIST_ID);
      http
        .expectOne(`${API}/lists/${LIST_ID}/estimate`)
        .flush({}, { status: 418, statusText: "I'm a teapot" });
      await expectAsync(requestPromise).toBeResolvedTo(null);
      expect(toast.error).toHaveBeenCalledWith('ui.no_se_ha_podido', 'Error 418');
    });
  });

  describe('prices', () => {
    it('loads prices, resets on read error, adds a price, and refreshes after deletion', async () => {
      const prices = [makePrice('price-1')];
      service.loadPrices();
      http.expectOne(`${API}/prices`).flush({ data: prices });
      expect(service.prices()).toEqual(prices);

      service.loadPrices();
      http
        .expectOne(`${API}/prices`)
        .flush({ message: 'offline' }, { status: 503, statusText: 'Unavailable' });
      expect(service.prices()).toEqual([]);

      const added = service.addPrice({ productName: 'Leche', priceMinor: 125 });
      const post = http.expectOne(`${API}/prices`);
      expect(post.request.body).toEqual({ productName: 'Leche', priceMinor: 125 });
      post.flush({ data: prices[0] });
      http.expectOne(`${API}/prices`).flush({ data: prices });
      await expectAsync(added).toBeResolvedTo(prices[0]);

      service.prices.set([prices[0], makePrice('price-2')]);
      const deletion = service.deletePrice('price-1');
      expect(service.prices()).toEqual([makePrice('price-2')]);
      http.expectOne(`${API}/prices/price-1`).flush({});
      http.expectOne(`${API}/prices`).flush({ data: [makePrice('price-2')] });
      await deletion;
      expect(service.prices()).toEqual([makePrice('price-2')]);
    });

    it('queries product prices with exact key and paginates until a short page', async () => {
      const result = service.preciosDeProducto('leche exacta');
      const first = http.expectOne((req) => req.url === `${API}/prices`);
      expect(first.request.params.get('productKey')).toBe('leche exacta');
      expect(first.request.params.get('limit')).toBe('200');
      expect(first.request.params.get('offset')).toBe('0');
      first.flush({ data: pricesPage(0, 200) });
      await flushMicrotasks();

      const second = http.expectOne((req) => req.url === `${API}/prices`);
      expect(second.request.params.get('offset')).toBe('200');
      const lastPage = [makePrice('price-200'), makePrice('price-201')];
      second.flush({ data: lastPage });
      await expectAsync(result).toBeResolvedTo([...pricesPage(0, 200), ...lastPage]);
    });

    it('treats a failed page as empty and caps product-price paging at ten full pages', async () => {
      const failed = service.preciosDeProducto('leche');
      http
        .expectOne((req) => req.url === `${API}/prices`)
        .flush({ message: 'offline' }, { status: 503, statusText: 'Unavailable' });
      await expectAsync(failed).toBeResolvedTo([]);

      const capped = service.preciosDeProducto('leche');
      const all: PriceObservation[] = [];
      for (let page = 0; page < 10; page += 1) {
        const request = http.expectOne((req) => req.url === `${API}/prices`);
        expect(request.request.params.get('offset')).toBe(String(page * 200));
        const batch = pricesPage(page * 200, 200);
        all.push(...batch);
        request.flush({ data: batch });
        await flushMicrotasks();
      }
      await expectAsync(capped).toBeResolvedTo(all);
      http.expectNone((req) => req.url === `${API}/prices`);
    });
  });
});
