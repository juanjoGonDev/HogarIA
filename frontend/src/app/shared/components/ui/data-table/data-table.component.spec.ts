import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { I18nService } from '../../../../core/services/i18n.service';
import { DataTableCellDirective, DataTableComponent } from './data-table.component';
import type { DataTableColumna } from './data-table.types';
import { SIN_VALOR } from './data-table.util';

interface TableRow {
  id: string;
  name: string;
  category: string | null;
  quantity: number | string | null;
  expiration: string | null;
  active: boolean;
}

const ROWS: TableRow[] = [
  {
    id: 'milk',
    name: 'Leche',
    category: 'dairy',
    quantity: 2,
    expiration: '2026-10-03T09:00:00.000Z',
    active: true
  },
  {
    id: 'tomato',
    name: 'Tomate',
    category: 'vegetables',
    quantity: '10',
    expiration: 'invalid-date',
    active: false
  },
  {
    id: 'apple',
    name: 'Manzana',
    category: null,
    quantity: null,
    expiration: null,
    active: false
  }
];

const COLUMNS: DataTableColumna[] = [
  { clave: 'name', etiqueta: 'Nombre' },
  {
    clave: 'category',
    etiqueta: 'Categoría',
    tipo: 'texto',
    etiquetaValor: (value) => ({ dairy: 'Lácteos', vegetables: 'Verduras' })[String(value)] ?? ''
  },
  { clave: 'quantity', etiqueta: 'Cantidad', tipo: 'numero' },
  { clave: 'expiration', etiqueta: 'Caducidad', tipo: 'fecha' },
  { clave: 'active', etiqueta: 'Activo', tipo: 'booleano' },
  {
    clave: 'actions',
    etiqueta: 'Acciones',
    celda: 'actions',
    ordenable: false,
    filtrable: false
  }
];

@Component({
  selector: 'app-data-table-test-host',
  standalone: true,
  imports: [DataTableComponent, DataTableCellDirective],
  template: `
    <app-data-table
      [filas]="rows"
      [columnas]="columns"
      [claveDeFila]="rowId"
      [etiquetaDeFila]="rowLabel"
      [claseFila]="rowClass"
      [seleccionable]="selectable"
      [tamanos]="sizes"
      [tamanoInicial]="initialSize"
      [claveVacia]="emptyKey"
      (seleccionChange)="onSelectionChange($event)"
      (resultadoChange)="results = $event"
    >
      <div data-tabla-buscar><input aria-label="Buscar en la tabla" /></div>
      <ng-template appDataTableCell="actions" let-fila>
        <button type="button" [attr.data-test]="'action-' + fila.id">Abrir {{ fila.name }}</button>
      </ng-template>
      <div data-tabla-lote><button type="button" data-test="batch-action">Lote</button></div>
    </app-data-table>
  `
})
class DataTableTestHostComponent {
  rows: readonly TableRow[] = ROWS;
  columns: readonly DataTableColumna[] = COLUMNS;
  sizes: readonly number[] = [10, 24, 50, 100];
  initialSize = 24;
  emptyKey: string | null = null;
  selectable = true;
  selected: readonly TableRow[] = [];
  selectionHistory: readonly (readonly TableRow[])[] = [];
  results: readonly TableRow[] = [];
  readonly rowId = (row: unknown) => String((row as TableRow).id);
  readonly rowLabel = (row: unknown) => (row as TableRow).name;
  readonly rowClass = (row: unknown) => ((row as TableRow).id === 'milk' ? 'milk-row' : null);

  onSelectionChange(rows: readonly TableRow[]): void {
    this.selected = rows;
    this.selectionHistory = [...this.selectionHistory, rows];
  }
}

describe('DataTableComponent', () => {
  let fixture: ComponentFixture<DataTableTestHostComponent>;
  let host: DataTableTestHostComponent;
  let table: DataTableComponent;
  let internal: any;
  let root: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataTableTestHostComponent],
      providers: [
        {
          provide: I18nService,
          useValue: {
            changeTick: signal(0),
            t: (key: string, params?: Record<string, string | number>) =>
              Object.entries(params ?? {}).reduce(
                (text, [name, value]) => text.replace(`{${name}}`, String(value)),
                key === 'ui.tabla_rango' ? '{desde}-{hasta} de {total}' : key
              )
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DataTableTestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    table = fixture.debugElement.query(By.directive(DataTableComponent)).componentInstance;
    internal = table as unknown as Record<string, any>;
    root = fixture.nativeElement.querySelector('app-data-table');
  });

  function detect(): void {
    fixture.detectChanges();
  }

  function row(id: string): HTMLElement | null {
    return root.querySelector(`[data-test="tabla-fila-${id}"]`);
  }

  function click(selector: string, shiftKey = false): void {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing table control: ${selector}`);
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey }));
    detect();
  }

  function openFilter(column: string): void {
    click(`[data-test="tabla-filtro-${column}"]`);
  }

  it('renders projected slots, accessible row labels, classes and typed cell values', () => {
    expect(root.querySelector('[data-tabla-buscar] input')).not.toBeNull();
    expect(root.querySelector('[data-test="batch-action"]')).not.toBeNull();
    expect(row('milk')?.classList.contains('milk-row')).toBeTrue();
    expect(row('milk')?.querySelector('[data-test="action-milk"]')?.textContent).toContain(
      'Abrir Leche'
    );
    expect(row('milk')?.querySelector('[data-label="Categoría"]')?.textContent).toContain(
      'Lácteos'
    );
    expect(row('milk')?.querySelector('[data-label="Caducidad"]')?.textContent).toContain(
      '03/10/2026'
    );
    expect(row('tomato')?.querySelector('[data-label="Cantidad"]')?.textContent).toContain('10');
    expect(row('tomato')?.querySelector('[data-label="Caducidad"]')?.textContent).toContain(
      'invalid-da'
    );
    expect(row('milk')?.querySelector('[data-label="Activo"] app-icon')).not.toBeNull();
    expect(row('tomato')?.querySelector('[data-label="Activo"] .celda--guion')).not.toBeNull();
    expect(
      row('apple')?.querySelector('[data-label="Cantidad"]')?.classList.contains('tabla__td--vacia')
    ).toBeTrue();
    expect(
      root.querySelector('[data-test="tabla-marcar-milk"] button[aria-label="Leche"]')
    ).not.toBeNull();
  });

  it('distinguishes an empty input from no matching rows and can clear every filter', () => {
    host.rows = [];
    host.emptyKey = 'pantry.custom_empty';
    detect();
    expect(root.querySelector('.vacia__texto')?.textContent).toContain('pantry.custom_empty');
    expect(root.querySelector('[data-test="tabla-vacia-limpiar"]')).toBeNull();

    host.rows = ROWS;
    detect();
    openFilter('category');
    click('[data-test="tabla-menu-nada"]');
    expect(root.querySelector('.vacia__texto')?.textContent).toContain('ui.tabla_nada_coincide');
    expect(root.querySelector('[data-test="tabla-vacia-limpiar"]')).not.toBeNull();
    click('[data-test="tabla-vacia-limpiar"]');
    expect(root.querySelectorAll('tbody tr.tabla__fila')).toHaveSize(3);
    expect(host.results).toHaveSize(3);
  });

  it('sorts rows, isolates a plain click from a Shift multi-sort, and leaves non-sortable columns inert', () => {
    click('[data-test="tabla-orden-name"]');
    expect(
      root.querySelector('th[aria-sort="ascending"] [data-test="tabla-orden-name"]')
    ).not.toBeNull();
    expect(root.querySelector('tbody tr.tabla__fila')?.getAttribute('data-test')).toBe(
      'tabla-fila-milk'
    );

    click('[data-test="tabla-orden-quantity"]', true);
    expect(root.querySelector('[data-test="tabla-orden-name"] .th__ord')?.textContent).toBe('1');
    expect(root.querySelector('[data-test="tabla-orden-quantity"] .th__ord')?.textContent).toBe(
      '2'
    );
    click('[data-test="tabla-orden-name"]');
    expect(internal.orden()).toEqual([{ clave: 'name', dir: 'desc' }]);
    expect(
      root.querySelector('th[aria-sort="descending"] [data-test="tabla-orden-name"]')
    ).not.toBeNull();
    expect(root.querySelector('[data-test="tabla-orden-name"] .th__ord')).toBeNull();
    expect(
      root.querySelector('[data-test="tabla-orden-actions"]')?.hasAttribute('disabled')
    ).toBeTrue();
    click('[data-test="tabla-orden-actions"]');
    expect(internal.orden()).toHaveSize(1);
  });

  it('filters distinct values by localized search and supports none, all, recortar and clear', async () => {
    openFilter('category');
    expect(root.querySelector('.menu__lista')?.textContent).toContain('Lácteos');
    expect(root.querySelector('.menu__lista')?.textContent).toContain('Verduras');
    expect(root.querySelector('.menu__lista')?.textContent).toContain('—');
    expect(internal.valoresDe(COLUMNS[1])).toEqual([
      { valor: 'dairy', cuenta: 1 },
      { valor: 'vegetables', cuenta: 1 },
      { valor: SIN_VALOR, cuenta: 1 }
    ]);

    const search = root.querySelector<HTMLInputElement>('#tabla-menu-buscar-category');
    expect(search).not.toBeNull();
    search!.value = 'verd';
    search!.dispatchEvent(new Event('input', { bubbles: true }));
    detect();
    await fixture.whenStable();
    detect();
    expect(internal.busquedaMenu()).toBe('verd');
    expect(internal.menu()).toEqual({ col: 'category', sup: 'cabezal' });
    expect(internal.valoresMenu(COLUMNS[1])).toEqual([{ valor: 'vegetables', cuenta: 1 }]);
    expect(root.querySelectorAll('.menu__fila')).toHaveSize(1);
    expect(root.querySelector('.menu__fila')?.textContent).toContain('Verduras');

    click('[data-test="tabla-menu-nada"]');
    expect(root.querySelectorAll('tbody tr.tabla__fila')).toHaveSize(0);
    click('[data-test="tabla-menu-todo"]');
    expect(root.querySelectorAll('tbody tr.tabla__fila')).toHaveSize(3);

    openFilter('quantity');
    click('[data-test="tabla-modo-mayor"]');
    const quantity = root.querySelector<HTMLInputElement>('#tabla-extremo-a-quantity')!;
    quantity.value = '5';
    quantity.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    detect();

    openFilter('category');
    click('[data-test="tabla-menu-recortar"]');
    expect(internal.filtros().category).toEqual({ tipo: 'valores', activos: ['vegetables'] });
    expect(root.querySelectorAll('tbody tr.tabla__fila')).toHaveSize(1);
    expect(row('tomato')).not.toBeNull();
    click('[data-test="tabla-menu-limpiar"]');
    expect(internal.filtros().category).toBeUndefined();
  });

  it('applies numeric and date modes, treats blank endpoints safely, and resets the page on filtering', () => {
    const manyRows = Array.from({ length: 30 }, (_, index) => ({
      ...ROWS[index % ROWS.length],
      id: `row-${index}`,
      name: `Fila ${index}`,
      quantity: index,
      expiration: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`
    }));
    host.rows = manyRows;
    host.sizes = [10, 24];
    detect();
    internal.elegirTamano('10');
    detect();
    click('[data-test="tabla-pagina-3"]');
    openFilter('quantity');
    click('[data-test="tabla-modo-mayor"]');
    const quantityInput = root.querySelector<HTMLInputElement>('#tabla-extremo-a-quantity');
    expect(quantityInput?.type).toBe('number');
    quantityInput!.value = '25';
    quantityInput!.dispatchEvent(new Event('input', { bubbles: true }));
    detect();
    expect(internal.filtros().quantity).toEqual({ tipo: 'numero', modo: 'mayor', a: 25, b: null });
    expect(internal.pagina()).toBe(1);
    expect(host.results).toHaveSize(4);

    click('[data-test="tabla-filtro-expiration"]');
    click('[data-test="tabla-modo-entre"]');
    expect(root.querySelector<HTMLInputElement>('#tabla-extremo-a-expiration')?.type).toBe('date');
    expect(root.querySelector<HTMLInputElement>('#tabla-extremo-b-expiration')?.type).toBe('date');
    const from = root.querySelector<HTMLInputElement>('#tabla-extremo-a-expiration')!;
    from.value = '2026-10-05';
    from.dispatchEvent(new Event('input', { bubbles: true }));
    const until = root.querySelector<HTMLInputElement>('#tabla-extremo-b-expiration')!;
    until.value = '';
    until.dispatchEvent(new Event('input', { bubbles: true }));
    detect();
    expect(internal.filtros().expiration).toEqual({
      tipo: 'fecha',
      modo: 'entre',
      a: '2026-10-05',
      b: null
    });
  });

  it('keeps the row at the old page anchor when page size changes, and ignores invalid sizes', () => {
    const manyRows = Array.from({ length: 60 }, (_, index) => ({
      ...ROWS[index % ROWS.length],
      id: `row-${index + 1}`,
      name: `Fila ${index + 1}`,
      quantity: index + 1
    }));
    host.rows = manyRows;
    host.sizes = [10, 24, 50];
    detect();
    click('[data-test="tabla-pagina-3"]');
    expect(internal.paginaEnVista()).toBe(3);
    expect(root.querySelector('[data-test="tabla-rango"]')?.textContent).toContain('49-60 de 60');

    internal.elegirTamano('10');
    detect();
    expect(internal.paginaEnVista()).toBe(5);
    expect(root.querySelector('[data-test="tabla-rango"]')?.textContent).toContain('41-50 de 60');
    expect(root.querySelector('tbody tr.tabla__fila')?.getAttribute('data-test')).toBe(
      'tabla-fila-row-41'
    );
    expect(row('row-49')).not.toBeNull();

    internal.elegirTamano('0');
    internal.elegirTamano('not-a-size');
    detect();
    expect(internal.tamano()).toBe(10);
    expect(internal.paginaEnVista()).toBe(5);
  });

  it('honors bound initial size inputs after Angular applies the inputs', async () => {
    fixture.destroy();
    fixture = TestBed.createComponent(DataTableTestHostComponent);
    host = fixture.componentInstance;
    host.sizes = [5, 10];
    host.initialSize = 5;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    table = fixture.debugElement.query(By.directive(DataTableComponent)).componentInstance;
    internal = table as unknown as Record<string, any>;
    root = fixture.nativeElement.querySelector('app-data-table');
    expect(internal.tamano()).toBe(5);
    expect(internal.opcionesTamano().map((option: { value: string }) => option.value)).toEqual([
      '5',
      '10'
    ]);
    expect(root.querySelector('[data-test="tabla-rango"]')?.textContent).toContain('1-3 de 3');
  });

  it('selects all/mixed/none, supports Shift ranges, and prunes rows removed from inputs', () => {
    host.rows = Array.from({ length: 12 }, (_, index) => ({
      ...ROWS[index % ROWS.length],
      id: `row-${index + 1}`,
      name: `Fila ${index + 1}`
    }));
    host.sizes = [10];
    detect();

    click('[data-test="tabla-marcar-row-1"] button[role="checkbox"]');
    expect(
      root.querySelector('[data-test="tabla-seleccionar-pagina"]')?.getAttribute('aria-checked')
    ).toBe('mixed');
    click('[data-test="tabla-marcar-row-4"] button[role="checkbox"]', true);
    expect(host.selected.map((item) => item.id)).toEqual(['row-1', 'row-2', 'row-3', 'row-4']);
    expect(host.selectionHistory.map((rows) => rows.map((item) => item.id))).toEqual([
      ['row-1'],
      ['row-1', 'row-2', 'row-3', 'row-4']
    ]);
    click('[data-test="tabla-seleccionar-pagina"]');
    expect(
      root.querySelector('[data-test="tabla-seleccionar-pagina"]')?.getAttribute('aria-checked')
    ).toBe('all');
    click('[data-test="tabla-seleccionar-pagina"]');
    expect(
      root.querySelector('[data-test="tabla-seleccionar-pagina"]')?.getAttribute('aria-checked')
    ).toBe('none');

    click('[data-test="tabla-marcar-row-2"] button[role="checkbox"]');
    host.rows = host.rows.filter((item) => item.id !== 'row-2');
    detect();
    expect(host.selected).toEqual([]);
    expect(internal.seleccionadas()).toEqual([]);
    internal.limpiarSeleccion();
    expect(host.selected).toEqual([]);
  });

  it('emits only the final Shift+Space range and keeps Shift without an anchor as a normal toggle', async () => {
    host.rows = Array.from({ length: 4 }, (_, index) => ({
      ...ROWS[index % ROWS.length],
      id: `row-${index + 1}`,
      name: `Fila ${index + 1}`
    }));
    host.sizes = [10];
    detect();

    click('[data-test="tabla-marcar-row-1"] button[role="checkbox"]');
    const destino = root.querySelector<HTMLElement>(
      '[data-test="tabla-marcar-row-4"] button[role="checkbox"]'
    )!;
    destino.focus();
    destino.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: ' ', shiftKey: true })
    );
    destino.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    detect();

    expect(host.selected.map((item) => item.id)).toEqual(['row-1', 'row-2', 'row-3', 'row-4']);
    expect(host.selectionHistory.map((rows) => rows.map((item) => item.id))).toEqual([
      ['row-1'],
      ['row-1', 'row-2', 'row-3', 'row-4']
    ]);

    fixture.destroy();
    fixture = TestBed.createComponent(DataTableTestHostComponent);
    host = fixture.componentInstance;
    host.rows = [ROWS[0]];
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    root = fixture.nativeElement.querySelector('app-data-table');
    click('[data-test="tabla-marcar-milk"] button[role="checkbox"]', true);
    expect(host.selected.map((item) => item.id)).toEqual(['milk']);
    expect(host.selectionHistory.map((rows) => rows.map((item) => item.id))).toEqual([['milk']]);
  });

  it('opens the single mobile sheet/menu, supports back, overlay and Escape dismissal', () => {
    click('[data-test="tabla-hoja-abrir"]');
    expect(root.querySelector('[data-test="tabla-hoja"]')?.getAttribute('role')).toBe('dialog');
    click('[data-test="hoja-filtro-category"]');
    expect(root.querySelector('[data-test="tabla-hoja"] .menu')).not.toBeNull();
    expect(root.querySelector('[data-test="hoja-cerrar"]')).toBeNull();
    click('[data-test="hoja-volver"]');
    expect(root.querySelector('[data-test="hoja-cerrar"]')).not.toBeNull();
    click('[data-test="hoja-orden-name"]');
    expect(internal.dirDe('name')).toBe('asc');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    detect();
    expect(root.querySelector('[data-test="tabla-hoja"]')).toBeNull();

    click('[data-test="tabla-hoja-abrir"]');
    const veil = root.querySelector<HTMLElement>('[data-test="tabla-velo"]');
    expect(veil).not.toBeNull();
    veil!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    detect();
    expect(root.querySelector('[data-test="tabla-hoja"]')).toBeNull();
  });

  it('closes header filters on outside click, preserves inside clicks, and clamps popovers', () => {
    const button = root.querySelector<HTMLElement>('[data-test="tabla-filtro-category"]')!;
    const original = button.getBoundingClientRect;
    button.getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 20, right: 80, width: 60, height: 20 }) as DOMRect;
    openFilter('category');
    expect(internal.menuAncla()).toEqual({ top: 66, left: jasmine.any(Number) });
    expect(internal.menuAncla().left).toBeGreaterThanOrEqual(8);
    expect(internal.anclaAbajo()).toBeTrue();

    root.querySelector('.th__menu')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    detect();
    expect(internal.menu()).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    detect();
    expect(internal.menu()).toBeNull();

    button.getBoundingClientRect = () =>
      ({ top: 500, bottom: 520, left: 20, right: 80, width: 60, height: 20 }) as DOMRect;
    openFilter('category');
    expect(internal.anclaAbajo()).toBeFalse();
    expect(internal.menuAncla().top).toBe(494);
    button.getBoundingClientRect = original;
  });
});
