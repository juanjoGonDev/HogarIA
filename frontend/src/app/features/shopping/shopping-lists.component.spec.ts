import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { ShoppingService } from '../../core/services/shopping.service';
import { HouseholdService } from '../../core/services/household.service';
import { ConfirmService } from '../../core/services/confirm.service';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/services/i18n.service';
import type { ShoppingList } from '../../shared/models/shopping.model';
import { ShoppingListsComponent } from './shopping-lists.component';

describe('ShoppingListsComponent', () => {
  let fixture: ComponentFixture<ShoppingListsComponent>;
  let component: ShoppingListsComponent;
  let shopping: {
    lists: WritableSignal<ShoppingList[]>;
    loadingLists: WritableSignal<boolean>;
    saving: WritableSignal<boolean>;
    listsMeta: WritableSignal<{ total: number; limit: number; offset: number }>;
    stores: WritableSignal<{ store: string; lists: number }[]>;
    loadLists: jasmine.Spy;
    loadStores: jasmine.Spy;
    openStream: jasmine.Spy;
    createList: jasmine.Spy;
    renameList: jasmine.Spy;
    setStatus: jasmine.Spy;
    deleteList: jasmine.Spy;
  };
  let confirm: { confirm: jasmine.Spy };
  let toast: { show: jasmine.Spy; info: jasmine.Spy; error: jasmine.Spy };
  let router: { navigate: jasmine.Spy };
  let contextRevision: ReturnType<typeof signal<number>>;
  let activeHouseholdId: ReturnType<typeof signal<string | null>>;
  let switchingHousehold: ReturnType<typeof signal<boolean>>;
  let household: ReturnType<typeof signal<{ id: string } | null>>;

  const list = (overrides: Partial<ShoppingList> = {}): ShoppingList => ({
    id: 'list-a',
    name: 'Compra semanal',
    store: 'Mercado',
    status: 'active',
    version: 3,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-02T10:00:00.000Z',
    completed_at: null,
    totalItems: 4,
    checkedItems: 2,
    pricedTotalMinor: 1250,
    ...overrides
  });

  async function createFixture(): Promise<void> {
    fixture = TestBed.createComponent(ShoppingListsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    window.history.replaceState({}, '', '/shopping');
    contextRevision = signal(0);
    activeHouseholdId = signal<string | null>('home-a');
    switchingHousehold = signal(false);
    household = signal<{ id: string } | null>({ id: 'home-a' });
    shopping = {
      lists: signal<ShoppingList[]>([]),
      loadingLists: signal(false),
      saving: signal(false),
      listsMeta: signal({ total: 0, limit: 25, offset: 0 }),
      stores: signal([{ store: 'Mercado', lists: 2 }]),
      loadLists: jasmine.createSpy('loadLists'),
      loadStores: jasmine.createSpy('loadStores'),
      openStream: jasmine.createSpy('openStream').and.returnValue(jasmine.createSpy('closeStream')),
      createList: jasmine.createSpy('createList').and.resolveTo(list({ id: 'list-new' })),
      renameList: jasmine.createSpy('renameList').and.resolveTo(list()),
      setStatus: jasmine.createSpy('setStatus').and.resolveTo({ ok: true }),
      deleteList: jasmine.createSpy('deleteList').and.resolveTo({ success: true })
    };
    confirm = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
    toast = {
      show: jasmine.createSpy('show'),
      info: jasmine.createSpy('info'),
      error: jasmine.createSpy('error')
    };
    router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };

    await TestBed.configureTestingModule({
      imports: [ShoppingListsComponent],
      providers: [
        { provide: ShoppingService, useValue: shopping },
        {
          provide: HouseholdService,
          useValue: { contextRevision, activeHouseholdId, switchingHousehold, household }
        },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: router },
        {
          provide: I18nService,
          useValue: {
            t: (key: string, params?: Record<string, unknown>) =>
              `${key}${params ? JSON.stringify(params) : ''}`,
            relativeTime: (value: string) => `hace: ${value}`
          }
        }
      ]
    })
      .overrideComponent(ShoppingListsComponent, { set: { template: '' } })
      .compileComponents();

    await createFixture();
  });

  afterEach(() => fixture?.destroy());

  it('loads current lists and stores, derives options and reads URL state on construction', async () => {
    expect(shopping.loadLists).toHaveBeenCalledWith(jasmine.objectContaining({ status: 'active' }));
    expect(shopping.loadStores).toHaveBeenCalled();
    expect(shopping.openStream).toHaveBeenCalledWith('tray', jasmine.any(Function));
    expect(component.storeOptions()).toEqual([
      { value: 'Mercado', label: 'Mercado', hint: '2 listas' }
    ]);
    expect(component.pageSizes().map((option) => option.value)).toEqual(['10', '25', '50']);

    fixture.destroy();
    window.history.replaceState(
      {},
      '',
      '/shopping?status=done&q=%20leche%20&store=Mercado&min=2500&from=2026-10-01&to=2026-10-05&sort=name&dir=asc&page=2&size=10'
    );
    await createFixture();

    expect(component.status()).toBe('done');
    expect(component.search()).toBe(' leche ');
    expect(component.queryDraft).toBe(' leche ');
    expect(component.store()).toBe('Mercado');
    expect(component.minTotal()).toBe('2500');
    expect(component.from()).toBe('2026-10-01');
    expect(component.to()).toBe('2026-10-05');
    expect(component.sort()).toBe('name');
    expect(component.dir()).toBe('asc');
    expect(component.page()).toBe(2);
    expect(component.size()).toBe(10);
    expect(component.filtersOpen()).toBeTrue();
  });

  it('removes the legacy tab parameter when switching back to active lists', async () => {
    fixture.destroy();
    window.history.replaceState({}, '', '/shopping?tab=hechas');
    await createFixture();
    router.navigate.calls.reset();

    component.setStatus('active');

    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ status: null, tab: null }),
        queryParamsHandling: 'merge',
        replaceUrl: true
      })
    );
  });

  it('ignores invalid URL options and preserves only supported query values', async () => {
    fixture.destroy();
    window.history.replaceState(
      {},
      '',
      '/shopping?status=unknown&sort=store&dir=sideways&page=-4&size=15'
    );
    await createFixture();

    expect(component.status()).toBe('active');
    expect(component.sort()).toBe('updated');
    expect(component.dir()).toBe('desc');
    expect(component.page()).toBe(0);
    expect(component.size()).toBe(25);
    expect(component.filtersOpen()).toBeFalse();
    expect(component.statusLabel()).toBe('shopping_lists.estado_activas');
    expect(component.ariaSort('')).toBeNull();
    expect(component.ariaSort('total')).toBeNull();
    expect(component.ariaSort('updated')).toBe('descending');
  });

  it('applies and clears status, store, totals and date filters with a reset page', () => {
    component.page.set(3);
    component.setStatus('done');
    expect(component.status()).toBe('done');
    expect(component.page()).toBe(0);
    expect(component.statusLabel()).toBe('shopping_lists.estado_terminadas');
    const loadsAfterStatus = shopping.loadLists.calls.count();
    component.setStatus('done');
    expect(shopping.loadLists.calls.count()).toBe(loadsAfterStatus);

    component.setStore('Mercado');
    component.setMinTotal('2500');
    component.setFrom('2026-10-01');
    component.setTo('2026-10-31');
    expect(component.activeFilters()).toBe(4);
    expect(shopping.loadLists.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        store: 'Mercado',
        minTotalMinor: 2500,
        from: '2026-10-01',
        to: '2026-10-31'
      })
    );
    expect(router.navigate).toHaveBeenCalled();

    component.clearFilters();
    expect(component.activeFilters()).toBe(0);
    expect(component.page()).toBe(0);
    expect(component.search()).toBe('');
    expect(component.queryDraft).toBe('');
    expect(component.store()).toBeNull();
    expect(component.minTotal()).toBeNull();
    expect(component.from()).toBeNull();
    expect(component.to()).toBeNull();
  });

  it('debounces trimmed search changes and clears search immediately', async () => {
    component.queryDraft = '  leche  ';
    component.applySearch();
    await new Promise((resolve) => setTimeout(resolve, 275));
    expect(component.search()).toBe('leche');
    expect(component.page()).toBe(0);
    expect(shopping.loadLists.calls.mostRecent().args[0].q).toBe('leche');

    component.queryDraft = 'queso';
    component.applySearch();
    component.clearSearch();
    expect(component.search()).toBe('');
    expect(component.queryDraft).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 275));
    expect(shopping.loadLists.calls.mostRecent().args[0].q).toBeUndefined();
  });

  it('sorts columns, flips the active sort, paginates within bounds and changes page size', () => {
    component.page.set(2);
    component.sortBy('name');
    expect(component.sort()).toBe('name');
    expect(component.dir()).toBe('asc');
    expect(component.ariaSort('name')).toBe('ascending');
    component.sortBy('name');
    expect(component.dir()).toBe('desc');
    component.sortBy('total');
    expect(component.dir()).toBe('desc');
    component.sortBy('');

    shopping.listsMeta.set({ total: 60, limit: 25, offset: 0 });
    expect(component.canGoPrev()).toBeFalse();
    expect(component.canGoNext()).toBeTrue();
    component.go(-1);
    expect(component.page()).toBe(0);
    component.go(1);
    expect(component.page()).toBe(1);
    expect(component.canGoPrev()).toBeTrue();
    component.setSize('10');
    expect(component.size()).toBe(10);
    expect(component.page()).toBe(0);
    component.setSize('0');
    expect(component.size()).toBe(10);
    component.setSize('invalid');
    expect(component.size()).toBe(10);
    expect(component.pageSizeValue()).toBe('10');
  });

  it('describes ranges, empty states and progress for populated and empty lists', () => {
    shopping.listsMeta.set({ total: 40, limit: 25, offset: 25 });
    component.page.set(1);
    shopping.lists.set([list()]);
    expect(component.rangeLabel()).toBe('26-26');
    expect(component.progressOf(list())).toBe(50);
    expect(component.progressOf(list({ totalItems: 0, checkedItems: 0 }))).toBe(0);
    expect(component.since('2026-10-06')).toBe('hace: 2026-10-06');

    shopping.lists.set([]);
    expect(component.rangeLabel()).toBe('0');
    expect(component.emptyTitle()).toBe('shopping_lists.todavia_no_hay_listas');
    expect(component.emptyText()).toBe('shopping_lists.crea_la_primera_y');
    component.setStatus('done');
    expect(component.emptyTitle()).toBe('shopping_lists.nada_en_el_historial');
    expect(component.emptyText()).toBe('shopping_lists.las_listas_terminadas_se');
    component.setStatus('all');
    expect(component.emptyTitle()).toBe('shopping_lists.ni_activas_ni_terminadas');
    component.search.set('leche');
    expect(component.emptyTitle()).toBe('shopping_lists.ninguna_lista_encaja_con');
    expect(component.emptyText()).toBe('shopping_lists.prueba_a_quitar_la_busqueda');
  });

  it('returns to the last non-empty page if the server total shrinks below the current offset', async () => {
    component.page.set(1);
    shopping.lists.set([]);
    shopping.listsMeta.set({ total: 25, limit: 25, offset: 25 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.page()).toBe(0);
    expect(shopping.loadLists.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ limit: 25, offset: 0 })
    );
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: jasmine.objectContaining({ page: null }) })
    );
  });

  it('clears the refresh indicator after exactly 500 ms', fakeAsync(() => {
    component.refresh();

    expect(component.refreshing()).toBeTrue();
    tick(499);
    expect(component.refreshing()).toBeTrue();
    tick(1);
    expect(component.refreshing()).toBeFalse();
  }));

  it('refreshes and creates only valid trimmed lists, then navigates to the new detail', async () => {
    component.refresh();
    expect(component.refreshing()).toBeTrue();
    expect(shopping.loadStores).toHaveBeenCalledTimes(2);

    component.draftName = '   ';
    await component.create();
    expect(shopping.createList).not.toHaveBeenCalled();
    component.busy.set(true);
    component.draftName = 'No crear ocupada';
    await component.create();
    expect(shopping.createList).not.toHaveBeenCalled();

    component.busy.set(false);
    component.creating.set(true);
    component.draftName = '  Lista nueva  ';
    component.draftStore = ' Mercado ';
    await component.create();
    expect(shopping.createList).toHaveBeenCalledWith('Lista nueva', 'Mercado');
    expect(component.creating()).toBeFalse();
    expect(component.draftName).toBe('');
    expect(router.navigate).toHaveBeenCalledWith(['/shopping', 'list-new']);

    component.creating.set(true);
    component.draftName = 'descartar';
    component.draftStore = 'descartar también';
    component.cancelCreate();
    expect(component.creating()).toBeFalse();
    expect(component.draftName).toBe('');
    expect(component.draftStore).toBe('');
  });

  it('renames only the active row, handles failures and ignores cancel-on-blur', async () => {
    const first = list();
    component.startRename(first);
    expect(component.editingId()).toBe(first.id);
    expect(component.draftTitle).toBe(first.name);
    component.draftTitle = '  Otra compra  ';
    await component.commitRename(first);
    expect(shopping.renameList).toHaveBeenCalledWith(
      first.id,
      { name: 'Otra compra' },
      first.version
    );
    expect(component.editingId()).toBeNull();

    const calls = shopping.renameList.calls.count();
    component.startRename(first);
    component.draftTitle = '   ';
    await component.commitRename(first);
    expect(shopping.renameList.calls.count()).toBe(calls);
    component.startRename(first);
    component.draftTitle = first.name;
    await component.commitRename(first);
    expect(shopping.renameList.calls.count()).toBe(calls);
    component.startRename(first);
    await component.commitRename(list({ id: 'another' }));
    expect(shopping.renameList.calls.count()).toBe(calls);

    shopping.renameList.and.resolveTo(null);
    component.startRename(first);
    component.draftTitle = 'Conflicto';
    await component.commitRename(first);
    expect(toast.error).not.toHaveBeenCalled();

    shopping.renameList.and.resolveTo(list());
    component.startRename(first);
    component.cancelRename();
    component.onRenameBlur(first);
    expect(shopping.renameList.calls.count()).toBe(calls + 1);
  });

  it('navigates to a list while preserving a normal href and prevents default', () => {
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as unknown as Event;
    const target = list();
    expect(component.hrefOf(target)).toBe('/shopping/list-a');
    component.open(target, event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/shopping', 'list-a']);
  });

  it('archives/reopens with an undo action and requires confirmation before deletion', async () => {
    const active = list();
    await component.archive(active);
    expect(shopping.setStatus).toHaveBeenCalledWith(active.id, 'done');
    const undo = toast.show.calls.mostRecent().args[0].action.run as () => void;
    undo();
    expect(shopping.setStatus).toHaveBeenCalledWith(active.id, 'active');

    await component.archive(list({ status: 'done' }));
    expect(shopping.setStatus).toHaveBeenCalledWith(active.id, 'active');
    expect(toast.show.calls.mostRecent().args[0].title).toBe('ui.lista_reabierta');

    confirm.confirm.and.resolveTo(false);
    await component.remove(active);
    expect(shopping.deleteList).not.toHaveBeenCalled();
    expect(confirm.confirm).toHaveBeenCalledWith(
      jasmine.objectContaining({
        title: 'ui.borrar_esta_lista',
        message: `ui.se_borran_lista_y_lineas${JSON.stringify({ name: active.name, n: active.totalItems })}`,
        variant: 'danger'
      })
    );

    confirm.confirm.and.resolveTo(true);
    await component.remove(active);
    expect(shopping.deleteList).toHaveBeenCalledWith(active.id);
    expect(toast.info).toHaveBeenCalledWith('ui.lista_borrada', 'ui.el_historial_de_precios');
  });

  it('does not announce a failed status change or deletion as successful', async () => {
    const active = list();
    const done = list({ status: 'done' });
    shopping.setStatus.and.resolveTo(null);
    await component.archive(done);
    expect(toast.show).not.toHaveBeenCalled();

    shopping.setStatus.and.resolveTo({ ok: false, code: 'ERROR' });
    await component.archive(active);
    expect(toast.show).not.toHaveBeenCalled();

    shopping.deleteList.and.resolveTo(null);
    confirm.confirm.and.resolveTo(true);
    await component.remove(active);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
