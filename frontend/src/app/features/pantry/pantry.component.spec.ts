import { runInInjectionContext, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { ConfirmService } from '../../core/services/confirm.service';
import { I18nService } from '../../core/services/i18n.service';
import { PantryService } from '../../core/services/pantry.service';
import { ToastService } from '../../core/services/toast.service';
import { of, throwError } from 'rxjs';
import type { Ingredient, PantryCategory, Utensil } from '../../shared/models/pantry.model';
import { PantryComponent } from './pantry.component';

describe('PantryComponent', () => {
  let router: jasmine.SpyObj<Router>;
  let pantryService: jasmine.SpyObj<PantryService>;
  let toastService: jasmine.SpyObj<ToastService>;
  let confirmService: jasmine.SpyObj<ConfirmService>;
  let ingredients: WritableSignal<Ingredient[]>;
  let utensils: WritableSignal<Utensil[]>;
  let categories: WritableSignal<PantryCategory[]>;
  let queryParamMap: ReturnType<typeof convertToParamMap>;

  beforeEach(() => {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.resolveTo(true);
    ingredients = signal<Ingredient[]>([]);
    utensils = signal<Utensil[]>([]);
    categories = signal<PantryCategory[]>([]);
    pantryService = jasmine.createSpyObj<PantryService>(
      'PantryService',
      [
        'createIngredient',
        'updateIngredient',
        'deleteIngredient',
        'createUtensil',
        'updateUtensil',
        'deleteUtensil',
        'loadUtensils',
        'loadCategories',
        'cargarInventarioCompleto',
        'loadStats'
      ],
      {
        ingredients,
        utensils,
        categories,
        stats: signal(null),
        isLoading: signal(false),
        total: signal(0)
      }
    );
    pantryService.updateIngredient.and.returnValue(of(null));
    pantryService.deleteIngredient.and.returnValue(of(true));
    pantryService.createIngredient.and.returnValue(of(null));
    pantryService.createUtensil.and.returnValue(of({} as Utensil));
    pantryService.updateUtensil.and.returnValue(of({} as Utensil));
    pantryService.deleteUtensil.and.returnValue(of(true));
    pantryService.loadUtensils.and.returnValue(of([]));
    pantryService.cargarInventarioCompleto.and.resolveTo();
    queryParamMap = convertToParamMap({});
    toastService = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    confirmService = jasmine.createSpyObj<ConfirmService>('ConfirmService', ['confirm']);
    confirmService.confirm.and.resolveTo(false);

    TestBed.configureTestingModule({
      providers: [
        { provide: I18nService, useValue: { t: (key: string) => key, changeTick: signal(0) } },
        { provide: PantryService, useValue: pantryService },
        { provide: ToastService, useValue: toastService },
        { provide: ConfirmService, useValue: confirmService },
        { provide: Router, useValue: router },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { queryParamMap };
            }
          }
        }
      ]
    });
  });

  function createComponent(): PantryComponent {
    return TestBed.runInInjectionContext(() => new PantryComponent());
  }

  function ingredient(name: string, quantity: number, category: string): Ingredient {
    return {
      id: name.toLowerCase(),
      name,
      quantity,
      unit: 'unit',
      category,
      location: 'pantry',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z')
    };
  }

  function category(key: string, parentKey: string | null): PantryCategory {
    return {
      id: key,
      key,
      name: key,
      color: '#4CAF50',
      description: null,
      parentKey,
      parentName: parentKey,
      position: 0,
      counts: { products: 0, children: 0, descendantProducts: 0 },
      protected: false,
      canDelete: true
    };
  }

  function batchActions(component: PantryComponent): {
    loteVaciar(): Promise<void>;
    loteBorrar(): Promise<void>;
    loteUtensilios(available: boolean): Promise<void>;
  } {
    return component as unknown as {
      loteVaciar(): Promise<void>;
      loteBorrar(): Promise<void>;
      loteUtensilios(available: boolean): Promise<void>;
    };
  }

  function rowView(component: PantryComponent) {
    return component as unknown as {
      filaId(fila: unknown): string;
      hrefDeItem(fila: unknown): string;
      abrirItem(fila: unknown, event: Event): void;
      filaNombre(fila: unknown): string;
      filaCat(fila: unknown): string | undefined;
      filaIngrediente(fila: unknown): Ingredient;
      filaUtensil(fila: unknown): Utensil;
      filaCantidad(fila: unknown): string;
      filaDisponible(fila: unknown): boolean;
      filaCaducidad(fila: unknown): string;
      identificadorDeFila(fila: unknown): string;
      nombreDeFila(fila: unknown): string;
      claseFilaInv(): string;
      claseFilaUti(fila: unknown): string;
      elegirUbicacion(value: string | null): void;
      abrirGestor(destination: 'categories' | 'products' | 'catalogo'): void;
      abrirCatalogo(): void;
      irACaducidades(): void;
      colorDe(key: string | null | undefined): string;
    };
  }

  it('opens a clean ingredient form from the ingredients tab', () => {
    const component = createComponent();
    component.formData.name = 'stale value';
    component.isUtensilModalOpen.set(false);

    expect(component.addButtonLabel()).toBe('pantry.mas_agregar');
    component.openAddModal();

    expect(component.isIngredientModalOpen()).toBeTrue();
    expect(component.isUtensilModalOpen()).toBeFalse();
    expect(component.formData.name).toBe('');
  });

  it('opens the utensil form instead of the ingredient form from the utensils tab', () => {
    const component = createComponent();
    component.activeTab.set('utensils');

    expect(component.addButtonLabel()).toBe('pantry.mas_agregar_utensilio');
    component.openAddModal();

    expect(component.isUtensilModalOpen()).toBeTrue();
    expect(component.isIngredientModalOpen()).toBeFalse();
  });

  it('applies a suggested ingredient name when opening the prefilled form', () => {
    const component = createComponent();

    component.openAddModal({ name: 'harina' });

    expect(component.isIngredientModalOpen()).toBeTrue();
    expect(component.formData.name).toBe('harina');
  });

  it('opens the edit form with the ingredient amount and unit', () => {
    const component = createComponent();
    const ingredient = {
      id: 'ingredient-edit',
      name: 'Harina',
      quantity: 500,
      unit: 'g',
      category: 'grains',
      location: 'pantry',
      notes: 'Integral',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z')
    } as Ingredient;

    component.editIngredient(ingredient);

    expect(component.editingIngredient()).toBe(ingredient);
    expect(component.isIngredientModalOpen()).toBeTrue();
    expect(component.formData).toEqual({
      name: 'Harina',
      quantity: 500,
      unit: 'g',
      category: 'grains',
      location: 'pantry',
      expirationDate: '',
      notes: 'Integral'
    });

    component.editIngredient({ ...ingredient, notes: undefined });

    expect(component.formData.notes).toBe('');
  });

  it('keeps a failed inventory refresh recoverable without loading stale stats', async () => {
    const component = createComponent();
    pantryService.cargarInventarioCompleto.and.rejectWith(new Error('Synthetic 503'));

    await component.reintentarCargaInventario();

    expect(component.inventoryLoadError()).toBeTrue();
    expect(pantryService.loadStats).not.toHaveBeenCalled();
  });

  it('clears the inventory error and reloads stats after a successful retry', async () => {
    const component = createComponent();
    component.inventoryLoadError.set(true);

    await component.reintentarCargaInventario();

    expect(component.inventoryLoadError()).toBeFalse();
    expect(pantryService.loadStats).toHaveBeenCalledTimes(1);
  });

  it('keeps unused emoji metadata out of pantry category controls', () => {
    const component = createComponent();
    const categories = [
      ...component.ingredientCategoriesNoAll,
      ...component.utensilCategoryOptions
    ];

    expect(categories.every((category) => !Object.hasOwn(category, 'icon'))).toBeTrue();
  });

  it('does not decrement below zero and applies one-unit stock changes', () => {
    const component = createComponent();
    const ingredient = { id: 'ingredient-1', quantity: 0 } as Ingredient;

    component.quitarUnidad(ingredient);
    expect(pantryService.updateIngredient).not.toHaveBeenCalled();

    component.anadirUnidad(ingredient);
    expect(pantryService.updateIngredient).toHaveBeenCalledOnceWith('ingredient-1', {
      quantity: 1
    });

    component.anadirUnidad({ id: 'ingredient-2' } as Ingredient);
    expect(pantryService.updateIngredient).toHaveBeenCalledWith('ingredient-2', { quantity: 1 });
  });

  it('restores keyboard focus to the same stepper action after inventory reload', async () => {
    const component = createComponent();
    const beforeReload = document.createElement('button');
    beforeReload.dataset['test'] = 'pantry-stock-mas-ingredient-1';
    const afterReload = document.createElement('button');
    afterReload.dataset['test'] = 'pantry-stock-mas-ingredient-1';
    document.body.append(beforeReload);
    beforeReload.focus();
    pantryService.cargarInventarioCompleto.and.callFake(async () => {
      document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      beforeReload.remove();
      document.body.append(afterReload);
    });

    try {
      component.anadirUnidad(
        { id: 'ingredient-1', quantity: 1 } as Ingredient,
        {
          currentTarget: beforeReload
        } as unknown as Event
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));

      expect(document.activeElement).toBe(afterReload);
    } finally {
      beforeReload.remove();
      afterReload.remove();
    }
  });

  it('moves keyboard focus to the add action when reducing to zero removes the row', async () => {
    const component = createComponent();
    const beforeReload = document.createElement('button');
    beforeReload.dataset['test'] = 'pantry-stock-menos-ingredient-1';
    const addAction = document.createElement('app-button');
    addAction.dataset['test'] = 'pantry-agregar';
    const addButton = document.createElement('button');
    addAction.append(addButton);
    document.body.append(beforeReload, addAction);
    beforeReload.focus();
    pantryService.cargarInventarioCompleto.and.callFake(async () => {
      beforeReload.remove();
    });

    try {
      component.quitarUnidad(
        { id: 'ingredient-1', quantity: 1 } as Ingredient,
        { currentTarget: beforeReload } as unknown as Event
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));

      expect(document.activeElement).toBe(addButton);
    } finally {
      beforeReload.remove();
      addAction.remove();
    }
  });

  it('moves keyboard focus to another visible stepper when the current row disappears', async () => {
    const component = createComponent();
    const beforeReload = document.createElement('button');
    beforeReload.dataset['test'] = 'pantry-stock-menos-ingredient-1';
    const offscreenStepper = document.createElement('button');
    offscreenStepper.dataset['test'] = 'pantry-stock-menos-ingredient-2';
    Object.defineProperty(offscreenStepper, 'getBoundingClientRect', {
      value: () => new DOMRect(10, 900, 44, 44)
    });
    const nextRowStepper = document.createElement('button');
    nextRowStepper.dataset['test'] = 'pantry-stock-menos-ingredient-3';
    Object.defineProperty(nextRowStepper, 'getBoundingClientRect', {
      value: () => new DOMRect(10, 10, 44, 44)
    });
    document.body.append(beforeReload);
    beforeReload.focus();
    pantryService.cargarInventarioCompleto.and.callFake(async () => {
      beforeReload.remove();
      document.body.append(offscreenStepper, nextRowStepper);
    });

    try {
      component.quitarUnidad(
        { id: 'ingredient-1', quantity: 1 } as Ingredient,
        { currentTarget: beforeReload } as unknown as Event
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));

      expect(document.activeElement).toBe(nextRowStepper);
    } finally {
      beforeReload.remove();
      offscreenStepper.remove();
      nextRowStepper.remove();
    }
  });

  it('does not reclaim focus if the user moved it while the request was pending', async () => {
    const component = createComponent();
    const stepper = document.createElement('button');
    stepper.dataset['test'] = 'pantry-stock-mas-ingredient-1';
    const otherAction = document.createElement('button');
    document.body.append(stepper, otherAction);
    stepper.focus();

    let finishReload!: () => void;
    pantryService.cargarInventarioCompleto.and.callFake(
      () => new Promise<void>((resolve) => (finishReload = resolve))
    );

    try {
      component.anadirUnidad(
        { id: 'ingredient-1', quantity: 1 } as Ingredient,
        { currentTarget: stepper } as unknown as Event
      );
      otherAction.focus();
      finishReload();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));

      expect(document.activeElement).toBe(otherAction);
    } finally {
      stepper.remove();
      otherAction.remove();
    }
  });

  it('preserves another focused row action when the inventory refresh replaces the row', async () => {
    const component = createComponent();
    const stepper = document.createElement('button');
    stepper.dataset['test'] = 'pantry-stock-mas-ingredient-1';
    const editBeforeReload = document.createElement('button');
    editBeforeReload.dataset['test'] = 'pantry-editar-ingredient-1';
    const editAfterReload = document.createElement('button');
    editAfterReload.dataset['test'] = 'pantry-editar-ingredient-1';
    document.body.append(stepper, editBeforeReload);
    stepper.focus();

    let finishReload!: () => void;
    pantryService.cargarInventarioCompleto.and.callFake(
      () =>
        new Promise<void>((resolve) => {
          finishReload = () => {
            stepper.remove();
            editBeforeReload.remove();
            document.body.append(editAfterReload);
            resolve();
          };
        })
    );

    try {
      component.anadirUnidad(
        { id: 'ingredient-1', quantity: 1 } as Ingredient,
        { currentTarget: stepper } as unknown as Event
      );
      editBeforeReload.focus();
      finishReload();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));

      expect(document.activeElement).toBe(editAfterReload);
    } finally {
      stepper.remove();
      editBeforeReload.remove();
      editAfterReload.remove();
    }
  });

  it('does not restore stale focus after the pantry component is destroyed', async () => {
    const fixture = TestBed.createComponent(PantryComponent);
    const component = fixture.componentInstance;
    const removeListener = spyOn(document, 'removeEventListener').and.callThrough();
    const beforeReload = document.createElement('button');
    beforeReload.dataset['test'] = 'pantry-stock-mas-ingredient-1';
    const afterNavigation = document.createElement('button');
    afterNavigation.dataset['test'] = 'pantry-stock-mas-ingredient-1';
    document.body.append(beforeReload);
    beforeReload.focus();

    let finishReload!: () => void;
    pantryService.cargarInventarioCompleto.and.callFake(
      () => new Promise<void>((resolve) => (finishReload = resolve))
    );

    component.anadirUnidad(
      { id: 'ingredient-1', quantity: 1 } as Ingredient,
      { currentTarget: beforeReload } as unknown as Event
    );
    fixture.destroy();
    expect(removeListener).toHaveBeenCalledWith('focusin', jasmine.any(Function));
    beforeReload.remove();
    document.body.append(afterNavigation);
    finishReload();

    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
      expect(document.activeElement).not.toBe(afterNavigation);
    } finally {
      beforeReload.remove();
      afterNavigation.remove();
    }
  });

  it('separates stocked rows from suggestions and keeps household counts unfiltered', () => {
    const component = createComponent();
    ingredients.set([
      ingredient('Canela', 0, 'spices'),
      ingredient('Sal', -1, 'spices'),
      { ...ingredient('Nula', 0, 'spices'), quantity: null } as unknown as Ingredient,
      { ...ingredient('Ausente', 0, 'spices'), quantity: undefined } as unknown as Ingredient,
      ingredient('Manzana', 2, 'fruit'),
      ingredient('Pimiento', 4, 'vegetables'),
      ingredient('Leche', 1, 'dairy')
    ]);

    expect(component.filasInventario().map((item) => item.name)).toEqual([
      'Manzana',
      'Pimiento',
      'Leche'
    ]);
    expect(component.suggestions().map((item) => item.name)).toEqual([
      'Canela',
      'Sal',
      'Nula',
      'Ausente'
    ]);
    expect(component.hayInventario()).toBeTrue();
    expect(component.inPantryCount()).toBe(3);

    component.searchTerm.set('sin coincidencias');
    component.filtroCategoria.set('fruit');
    expect(component.filasInventario()).toEqual([]);
    expect(component.suggestions()).toEqual([]);
    expect(component.inPantryCount()).toBe(3);

    ingredients.set([]);
    expect(component.hayInventario()).toBeFalse();
    expect(component.inPantryCount()).toBe(0);
  });

  it('applies a parent category subtree and accent-insensitive search to rows and suggestions', () => {
    const component = createComponent();
    categories.set([
      category('food', null),
      category('fruit', 'food'),
      category('vegetables', 'food'),
      category('spices', 'food'),
      category('cleaning', null)
    ]);
    ingredients.set([
      ingredient('Pimiento rojo', 2, 'vegetables'),
      ingredient('Manzana', 3, 'fruit'),
      ingredient('Pimienta', 0, 'spices'),
      ingredient('Limpiador', 5, 'cleaning'),
      ingredient('Detergente', 0, 'cleaning')
    ]);
    component.filtroCategoria.set('food');
    component.searchTerm.set('  PÍM  ');

    expect(component.filasInventario().map((item) => item.name)).toEqual(['Pimiento rojo']);
    expect(component.suggestions().map((item) => item.name)).toEqual(['Pimienta']);

    component.searchTerm.set('no existe');
    expect(component.filasInventario()).toEqual([]);
    expect(component.suggestions()).toEqual([]);
    component.searchTerm.set('');
    expect(component.filasInventario().map((item) => item.name)).toEqual([
      'Pimiento rojo',
      'Manzana'
    ]);
    expect(component.suggestions().map((item) => item.name)).toEqual(['Pimienta']);
    component.filtroCategoria.set('missing-category');
    expect(component.filasInventario()).toEqual([]);
    expect(component.suggestions()).toEqual([]);
  });

  it('treats legacy rows without a category as the reserved other category', () => {
    const component = createComponent();
    categories.set([category('other', null)]);
    ingredients.set([
      { ...ingredient('Legacy null', 1, 'other'), category: null } as unknown as Ingredient,
      { ...ingredient('Legacy absent', 2, 'other'), category: undefined } as unknown as Ingredient,
      { ...ingredient('Unknown suggestion', 0, 'other'), category: null } as unknown as Ingredient
    ]);
    component.filtroCategoria.set('other');

    expect(component.filasInventario().map((item) => item.name)).toEqual([
      'Legacy null',
      'Legacy absent'
    ]);
    expect(component.suggestions().map((item) => item.name)).toEqual(['Unknown suggestion']);
  });

  it('normalizes utensil availability and filters names without case or accent sensitivity', () => {
    const component = createComponent();
    utensils.set([
      { id: 'ladle', name: 'Cucharón', category: 'tools', available: 1 } as unknown as Utensil,
      { id: 'pan', name: 'Sartén', category: 'cookware', available: 0 } as unknown as Utensil,
      { id: 'spoon', name: 'Cuchara', category: 'tools', available: true }
    ]);

    const normalized = component.utensiliosFiltrados();
    expect(normalized.map((item) => item.available)).toEqual([true, false, true]);

    utensils.set([
      { id: 'ladle', name: 'Cucharón', category: 'tools', available: true },
      { id: 'pan', name: 'Sartén', category: 'cookware', available: false }
    ]);
    const booleanRows = utensils();
    expect(component.utensiliosFiltrados()).toBe(booleanRows);

    component.utensiliosQ.set('  CUCHARON  ');
    expect(component.utensiliosFiltrados().map((item) => item.id)).toEqual(['ladle']);
    component.utensiliosQ.set('batidora');
    expect(component.utensiliosFiltrados()).toEqual([]);
  });

  it('does not write for an empty selection or a cancelled inventory batch', async () => {
    const component = createComponent();
    const actions = batchActions(component);

    await actions.loteVaciar();
    expect(confirmService.confirm).not.toHaveBeenCalled();
    expect(pantryService.updateIngredient).not.toHaveBeenCalled();

    component.inventarioSeleccion.set([ingredient('Manzana', 2, 'fruit')]);
    confirmService.confirm.and.resolveTo(false);
    await actions.loteVaciar();

    expect(confirmService.confirm).toHaveBeenCalledOnceWith({
      title: 'pantry.lote_titulo_vaciar',
      message: 'pantry.lote_pregunta_vaciar',
      confirmText: 'pantry.lote_vaciar'
    });
    expect(pantryService.updateIngredient).not.toHaveBeenCalled();
    expect(pantryService.cargarInventarioCompleto).not.toHaveBeenCalled();
    expect(toastService.success).not.toHaveBeenCalled();
  });

  it('empties valid selected IDs despite an individual update error and refreshes once', async () => {
    const component = createComponent();
    component.inventarioSeleccion.set([
      ingredient('Manzana', 2, 'fruit'),
      ingredient('Pera', 1, 'fruit'),
      { ...ingredient('Legacy without ID', 4, 'fruit'), id: '' }
    ]);
    confirmService.confirm.and.resolveTo(true);
    pantryService.updateIngredient.and.callFake((id) =>
      id === 'manzana' ? throwError(() => new Error('synthetic failure')) : of(null)
    );

    await batchActions(component).loteVaciar();

    expect(confirmService.confirm).toHaveBeenCalledOnceWith({
      title: 'pantry.lote_titulo_vaciar',
      message: 'pantry.lote_pregunta_vaciar',
      confirmText: 'pantry.lote_vaciar'
    });
    expect(pantryService.updateIngredient.calls.allArgs()).toEqual([
      ['manzana', { quantity: 0 }],
      ['pera', { quantity: 0 }]
    ]);
    expect(pantryService.cargarInventarioCompleto).toHaveBeenCalledTimes(1);
    expect(pantryService.loadStats).toHaveBeenCalledTimes(1);
    expect(toastService.success).toHaveBeenCalledOnceWith('pantry.lote_vaciados');
  });

  it('deletes valid selected rows despite a failed delete and reports one batch result', async () => {
    const component = createComponent();
    component.inventarioSeleccion.set([
      ingredient('Tomate', 2, 'vegetables'),
      { ...ingredient('Missing ID', 1, 'vegetables'), id: '' }
    ]);
    confirmService.confirm.and.resolveTo(true);
    pantryService.deleteIngredient.and.callFake((id) =>
      id === 'tomate' ? throwError(() => new Error('synthetic failure')) : of(true)
    );

    await batchActions(component).loteBorrar();

    expect(confirmService.confirm).toHaveBeenCalledOnceWith({
      title: 'pantry.lote_titulo_borrar',
      message: 'pantry.lote_pregunta_borrar',
      confirmText: 'pantry.lote_borrar'
    });
    expect(pantryService.deleteIngredient).toHaveBeenCalledOnceWith('tomate');
    expect(pantryService.cargarInventarioCompleto).toHaveBeenCalledTimes(1);
    expect(toastService.success).toHaveBeenCalledOnceWith('pantry.lote_borrados');
  });

  it('does not confirm an empty delete batch or write after its confirmation is cancelled', async () => {
    const component = createComponent();
    const actions = batchActions(component);

    await actions.loteBorrar();
    expect(confirmService.confirm).not.toHaveBeenCalled();
    expect(pantryService.deleteIngredient).not.toHaveBeenCalled();

    component.inventarioSeleccion.set([ingredient('Tomate', 2, 'vegetables')]);
    confirmService.confirm.and.resolveTo(false);
    await actions.loteBorrar();

    expect(confirmService.confirm).toHaveBeenCalledOnceWith({
      title: 'pantry.lote_titulo_borrar',
      message: 'pantry.lote_pregunta_borrar',
      confirmText: 'pantry.lote_borrar'
    });
    expect(pantryService.deleteIngredient).not.toHaveBeenCalled();
    expect(pantryService.cargarInventarioCompleto).not.toHaveBeenCalled();
    expect(toastService.success).not.toHaveBeenCalled();
  });

  it('updates selected utensils in either direction and continues after an item error', async () => {
    const component = createComponent();
    component.utensiliosSeleccion.set([
      { id: 'blender', name: 'Blender', available: false },
      { id: 'whisk', name: 'Whisk', available: false }
    ]);
    pantryService.updateUtensil.and.callFake((id) =>
      id === 'blender' ? throwError(() => new Error('synthetic failure')) : of({} as Utensil)
    );
    const actions = batchActions(component);

    await actions.loteUtensilios(true);
    await actions.loteUtensilios(false);

    expect(pantryService.updateUtensil.calls.allArgs()).toEqual([
      ['blender', { available: true }],
      ['whisk', { available: true }],
      ['blender', { available: false }],
      ['whisk', { available: false }]
    ]);
    expect(pantryService.loadUtensils).toHaveBeenCalledTimes(2);
    expect(toastService.success.calls.allArgs()).toEqual([
      ['pantry.lote_utensilios_actualizados'],
      ['pantry.lote_utensilios_actualizados']
    ]);
    expect(confirmService.confirm).not.toHaveBeenCalled();
  });

  it('does not refresh or notify when no utensils are selected', async () => {
    const component = createComponent();

    await batchActions(component).loteUtensilios(true);

    expect(pantryService.updateUtensil).not.toHaveBeenCalled();
    expect(pantryService.loadUtensils).not.toHaveBeenCalled();
    expect(toastService.success).not.toHaveBeenCalled();
  });

  it('labels inventory and utensil columns from the active catalogs with safe fallbacks', () => {
    const customCategory = { ...category('custom', null), name: 'Huerta', color: '#abcdef' };
    categories.set([customCategory]);
    const component = createComponent();

    const inventoryColumns = component.columnasInventario();
    const categoryLabel = inventoryColumns.find(
      (column) => column.clave === 'category'
    )?.etiquetaValor;
    const locationLabel = inventoryColumns.find(
      (column) => column.clave === 'location'
    )?.etiquetaValor;
    expect(categoryLabel?.('custom')).toBe('Huerta');
    expect(categoryLabel?.('removed-category')).toBe('removed-category');
    expect(locationLabel?.('fridge')).toBe('pantry.nevera');
    expect(locationLabel?.('unrecognized-location')).toBe('pantry.title');

    const utensilColumns = component.columnasUtensilios();
    const utensilCategoryLabel = utensilColumns.find(
      (column) => column.clave === 'category'
    )?.etiquetaValor;
    const availableLabel = utensilColumns.find(
      (column) => column.clave === 'available'
    )?.etiquetaValor;
    expect(utensilCategoryLabel?.('oven')).toBe('pantry.utensilio_horno');
    expect(utensilCategoryLabel?.('unknown-tool')).toBe('unknown-tool');
    expect(availableLabel?.('true')).toBe('pantry.disponible');
    expect(availableLabel?.('false')).toBe('pantry.no_disponible');
  });

  it('builds fallback and catalog-backed category options and location options', () => {
    const component = createComponent();
    const fallbackOptions = component.opcionesCategoria();
    expect(fallbackOptions.length).toBe(component.ingredientCategoriesNoAll.length);
    expect(fallbackOptions[0].label).toBe('pantry.categoria_verduras');

    const customCategory = {
      ...category('custom', null),
      name: 'Huerta',
      color: '#123456',
      parentName: 'Comida',
      counts: { products: 1, children: 0, descendantProducts: 4 }
    };
    categories.set([customCategory]);
    expect(component.opcionesCategoria()).toEqual([
      jasmine.objectContaining({
        value: 'custom',
        label: 'Huerta',
        color: '#123456',
        group: 'Comida',
        hint: 'pantry.cuenta_articulos'
      })
    ]);
    expect(component.opcionesFiltroCategoria()).toEqual([
      jasmine.objectContaining({ value: '', label: 'pantry.categoria_todos' }),
      jasmine.objectContaining({
        value: 'custom',
        label: 'Huerta · 4',
        color: '#123456',
        group: 'Comida'
      })
    ]);

    categories.set([]);
    expect(component.opcionesFiltroCategoria().length).toBe(
      component.ingredientCategoriesNoAll.length + 1
    );
    expect(component.opcionesUbicacion().map((option) => option.value)).toEqual([
      'fridge',
      'freezer',
      'pantry',
      'counter'
    ]);
    rowView(component).elegirUbicacion(null);
    expect(component.formData.location).toBe('pantry');
    rowView(component).elegirUbicacion('counter');
    expect(component.formData.location).toBe('counter');
  });

  it('maps projected rows, dates, category colors and pantry routes', () => {
    categories.set([{ ...category('custom', null), color: '#abcdef' }]);
    const component = createComponent();
    const view = rowView(component);
    const row = ingredient('Tomate', 3, 'custom');
    const utensil = { id: 'pan', name: 'Sartén', available: true } as Utensil;
    const event = { preventDefault: jasmine.createSpy('preventDefault') } as unknown as Event;

    expect(view.filaId({ id: 12 })).toBe('12');
    expect(view.hrefDeItem({ id: 'tomate' })).toBe('/pantry/inventario/tomate');
    view.abrirItem({ id: 'tomate' }, event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/pantry', 'inventario', 'tomate']);
    expect(view.filaNombre({ name: null })).toBe('');
    expect(view.filaCat({ category: 'custom' })).toBe('custom');
    expect(view.filaIngrediente(row)).toBe(row);
    expect(view.filaUtensil(utensil)).toBe(utensil);
    expect(view.filaCantidad({ quantity: 3, unit: 'ud' })).toBe('3 ud');
    expect(view.filaDisponible({ available: 1 })).toBeTrue();
    expect(view.filaDisponible({ available: 0 })).toBeFalse();
    expect(view.filaCaducidad({ expirationDate: '2026-11-23' })).toBe('23/11/2026');
    expect(view.filaCaducidad({ expirationDate: 'invalid' })).toBe('');
    expect(view.identificadorDeFila({ id: 'x' })).toBe('x');
    expect(view.identificadorDeFila({})).toBe('');
    expect(view.nombreDeFila({ name: 'Tomate' })).toBe('Tomate');
    expect(view.nombreDeFila({})).toBe('');
    expect(view.claseFilaInv()).toBe('ingredient-item');
    expect(view.claseFilaUti(utensil)).toBe('utensil-card utensil-card--owned');
    expect(view.claseFilaUti({ available: false })).toBe('utensil-card');
    expect(view.colorDe('custom')).toBe('#ABCDEF');
    expect(view.colorDe('missing')).toBe('#8A8F98');
    expect(view.colorDe(null)).toBe('#8A8F98');

    view.abrirGestor('categories');
    view.abrirGestor('products');
    view.abrirGestor('catalogo');
    view.abrirCatalogo();
    view.irACaducidades();
    expect(router.navigate.calls.allArgs()).toEqual([
      [['/pantry', 'inventario', 'tomate']],
      [['/pantry', 'categories']],
      [['/pantry', 'products']],
      [['/pantry', 'catalogo']],
      [['/pantry', 'catalogo']],
      [['/pantry', 'caducidades']]
    ]);
  });

  it('initializes linked pantry filters, loads catalogs and clears utensil loading after failure', async () => {
    queryParamMap = convertToParamMap({ tab: 'utensils', buscar: 'lima', category: 'custom' });
    pantryService.loadUtensils.and.returnValue(throwError(() => new Error('synthetic offline')));
    const component = createComponent();

    component.ngOnInit();
    await Promise.resolve();

    expect(component.activeTab()).toBe('utensils');
    expect(component.searchTerm()).toBe('lima');
    expect(component.filtroCategoria()).toBe('custom');
    expect(component.utensilsLoading()).toBeFalse();
    expect(pantryService.loadCategories).toHaveBeenCalledOnceWith();
    expect(pantryService.cargarInventarioCompleto).toHaveBeenCalledTimes(1);
  });

  it('writes only non-default URL state and skips navigation when the URL already matches', async () => {
    const component = createComponent();
    component.escribirBusqueda('');
    expect(router.navigate).not.toHaveBeenCalled();

    component.activeTab.set('utensils');
    component.searchTerm.set('  lima  ');
    component.filtroCategoria.set('custom');
    component.elegirCategoria(null);
    expect(router.navigate).toHaveBeenCalledOnceWith(['/pantry'], {
      queryParams: { tab: 'utensils', buscar: 'lima' },
      replaceUrl: true
    });

    queryParamMap = convertToParamMap({ tab: 'utensils', buscar: 'lima', category: 'custom' });
    component.filtroCategoria.set('custom');
    component.escribirBusqueda(' lima ');
    expect(router.navigate).toHaveBeenCalledTimes(1);

    component.switchTab('ingredients');
    component.alternarSugerencias();
    expect(component.activeTab()).toBe('ingredients');
    expect(component.sugerenciasAbiertas()).toBeTrue();
  });

  it('opens a suggestion with its stored category, unit and defaulted location', () => {
    const component = createComponent();
    const suggested = {
      ...ingredient('Lima', 0, 'fruit'),
      unit: 'piece',
      location: undefined
    } as unknown as Ingredient;

    component.quickAddSuggestion(suggested);

    expect(component.isIngredientModalOpen()).toBeTrue();
    expect(component.formData).toEqual({
      name: 'Lima',
      quantity: 0,
      unit: 'piece',
      category: 'fruit',
      location: 'pantry',
      expirationDate: '',
      notes: ''
    });
  });

  it('validates ingredient forms and creates or edits with the matching success feedback', async () => {
    const component = createComponent();
    component.openAddModal();
    component.saveIngredient();
    expect(component.formErrors.name()).toBe('pantry.el_nombre_es_requerido');
    expect(pantryService.createIngredient).not.toHaveBeenCalled();

    component.formData.name = 'Avena';
    component.saveIngredient();
    expect(component.formErrors.quantity()).toBe('pantry.la_cantidad_debe_ser');
    expect(pantryService.createIngredient).not.toHaveBeenCalled();

    component.formData.quantity = 2;
    component.saveIngredient();
    await Promise.resolve();
    expect(pantryService.createIngredient).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ name: 'Avena', quantity: 2, expirationDate: undefined })
    );
    expect(toastService.success).toHaveBeenCalledWith(
      'pantry.agregado',
      'pantry.ingrediente_agregado'
    );
    expect(component.isIngredientModalOpen()).toBeFalse();
    expect(component.isSaving()).toBeFalse();
    expect(pantryService.loadStats).toHaveBeenCalledTimes(1);

    const existing = ingredient('Harina', 1, 'grains');
    component.editIngredient(existing);
    component.formData.name = 'Harina integral';
    component.formData.quantity = 3;
    component.saveIngredient();
    await Promise.resolve();
    expect(pantryService.updateIngredient).toHaveBeenCalledOnceWith(
      'harina',
      jasmine.objectContaining({ name: 'Harina integral', quantity: 3 })
    );
    expect(toastService.success).toHaveBeenCalledWith(
      'ai_config.actualizado',
      'pantry.ingrediente_actualizado'
    );
    expect(component.editingIngredient()).toBeNull();
    expect(component.formData.name).toBe('');
    expect(component.isSaving()).toBeFalse();
  });

  it('keeps the ingredient modal open and reports failed create and update requests', () => {
    const component = createComponent();
    component.openAddModal();
    component.formData.name = 'Avena';
    component.formData.quantity = 1;
    pantryService.createIngredient.and.returnValue(throwError(() => new Error('synthetic 503')));
    component.saveIngredient();
    expect(component.isSaving()).toBeFalse();
    expect(component.isIngredientModalOpen()).toBeTrue();
    expect(toastService.error).toHaveBeenCalledOnceWith('ui.error', 'pantry.no_se_pudo_guardar');

    component.editIngredient(ingredient('Avena', 1, 'grains'));
    pantryService.updateIngredient.and.returnValue(throwError(() => new Error('synthetic 503')));
    component.saveIngredient();
    expect(component.isSaving()).toBeFalse();
    expect(component.isIngredientModalOpen()).toBeTrue();
    expect(toastService.error).toHaveBeenCalledTimes(2);
  });

  it('deletes an ingredient only after confirmation and handles a failed delete', async () => {
    const component = createComponent();
    const item = ingredient('Tomate', 2, 'vegetables');
    confirmService.confirm.and.resolveTo(false);
    await component.deleteIngredient(item);
    expect(pantryService.deleteIngredient).not.toHaveBeenCalled();

    confirmService.confirm.and.resolveTo(true);
    await component.deleteIngredient(item);
    expect(pantryService.deleteIngredient).toHaveBeenCalledOnceWith('tomate');
    expect(toastService.success).toHaveBeenCalledOnceWith(
      'pantry.eliminado',
      'pantry.nombre_eliminado'
    );
    expect(pantryService.cargarInventarioCompleto).toHaveBeenCalledTimes(1);

    pantryService.deleteIngredient.and.returnValue(throwError(() => new Error('synthetic 503')));
    await component.deleteIngredient(item);
    expect(toastService.error).toHaveBeenCalledOnceWith('ui.error', 'pantry.no_se_pudo_eliminar');
  });

  it('reports utensil availability changes and handles cancellation and delete errors', async () => {
    const component = createComponent();
    const utensil = { id: 'pan', name: 'Sartén', available: true } as Utensil;
    component.toggleUtensil(utensil);
    component.toggleUtensil({ ...utensil, available: false });
    expect(toastService.success.calls.allArgs()).toEqual([
      ['pantry.quitado', 'pantry.utensilio_quitado'],
      ['pantry.anadido', 'pantry.utensilio_anadido']
    ]);

    pantryService.updateUtensil.and.returnValue(throwError(() => new Error('synthetic 503')));
    component.toggleUtensil(utensil);
    expect(toastService.error).toHaveBeenCalledOnceWith(
      'ui.error',
      'household.no_se_pudo_actualizar'
    );

    confirmService.confirm.and.resolveTo(false);
    await component.deleteUtensil(utensil);
    expect(pantryService.deleteUtensil).not.toHaveBeenCalled();

    confirmService.confirm.and.resolveTo(true);
    await component.deleteUtensil(utensil);
    expect(pantryService.deleteUtensil).toHaveBeenCalledOnceWith('pan');
    expect(toastService.success).toHaveBeenCalledWith(
      'pantry.eliminado',
      'pantry.nombre_eliminado'
    );

    pantryService.deleteUtensil.and.returnValue(throwError(() => new Error('synthetic 503')));
    await component.deleteUtensil(utensil);
    expect(toastService.error).toHaveBeenCalledWith('ui.error', 'pantry.no_se_pudo_eliminar');
  });

  it('validates, creates and recovers from failed custom utensil creation', () => {
    utensils.set([{ id: 'whisk', name: ' Batidora ', category: 'tools', available: true }]);
    const component = createComponent();
    component.openUtensilModal();
    component.saveUtensil();
    expect(component.utensilFormError()).toBe('auth.el_nombre_es_requerido');
    expect(pantryService.createUtensil).not.toHaveBeenCalled();

    component.utensilForm.name = ' batidora ';
    component.saveUtensil();
    expect(component.utensilFormError()).toBe('pantry.ya_existe_un_utensilio');
    expect(pantryService.createUtensil).not.toHaveBeenCalled();

    component.utensilForm.name = '  Espátula  ';
    component.utensilForm.category = 'tools';
    component.utensilForm.available = false;
    component.saveUtensil();
    expect(pantryService.createUtensil).toHaveBeenCalledOnceWith({
      name: 'Espátula',
      category: 'tools',
      available: false
    });
    expect(component.isUtensilModalOpen()).toBeFalse();
    expect(component.isSavingUtensil()).toBeFalse();
    expect(component.utensiliosQ()).toBe('Espátula');
    expect(toastService.success).toHaveBeenCalledOnceWith(
      'pantry.anadido',
      'pantry.utensilio_anadido'
    );

    component.openUtensilModal();
    component.utensilForm.name = 'Colador';
    pantryService.createUtensil.and.returnValue(throwError(() => new Error('synthetic 503')));
    component.saveUtensil();
    expect(component.isSavingUtensil()).toBeFalse();
    expect(component.isUtensilModalOpen()).toBeTrue();
    expect(toastService.error).toHaveBeenCalledOnceWith('ui.error', 'pantry.no_se_pudo_anadir');
    component.closeUtensilModal();
    expect(component.utensilForm).toEqual({ name: '', category: 'tools', available: true });
    expect(component.utensilFormError()).toBe('');
  });

  it('selects localized expiration states by local calendar day', () => {
    const component = createComponent();
    const dateAtOffset = (offset: number): Date => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      return date;
    };

    expect(component.getExpirationStatus({} as Ingredient)).toBeNull();
    expect(
      component.getExpirationStatus({ expirationDate: new Date('invalid') } as Ingredient)
    ).toBeNull();
    expect(
      component.getExpirationStatus({ expirationDate: dateAtOffset(-1) } as Ingredient)
    ).toEqual({
      variant: 'error',
      label: 'pantry.caducado'
    });
    expect(
      component.getExpirationStatus({ expirationDate: dateAtOffset(0) } as Ingredient)
    ).toEqual({
      variant: 'warning',
      label: 'pantry.caduca_hoy'
    });
    expect(
      component.getExpirationStatus({ expirationDate: dateAtOffset(2) } as Ingredient)
    ).toEqual({
      variant: 'warning',
      label: 'pantry.caduca_en_dias'
    });
    expect(
      component.getExpirationStatus({ expirationDate: dateAtOffset(4) } as Ingredient)
    ).toBeNull();
    expect(component.trackById(0, ingredient('Tomate', 1, 'vegetables'))).toBe('tomate');
  });
});
