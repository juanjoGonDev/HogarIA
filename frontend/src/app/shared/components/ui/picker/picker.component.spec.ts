import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PickerComponent, type PickerOption } from './picker.component';

@Component({
  standalone: true,
  imports: [PickerComponent],
  template: `
    <div class="field">
      <span id="percentage-label">Percentage</span>
      <app-picker
        [label]="label"
        [options]="options"
        [value]="selected"
        [filterFrom]="filterFrom"
        [allowCustom]="allowCustom"
        [floatingPanel]="floatingPanel"
        (valueChange)="selected = $event"
      />
    </div>
  `
})
class PickerHostComponent {
  options: PickerOption[] = [
    { value: '10', label: '10 %', group: 'Percentajes' },
    { value: 'code-20', label: 'Twenty percent', group: 'Percentajes' },
    { value: 'disabled', label: 'Deshabilitado', disabled: true, group: 'Percentajes' },
    { value: 'fresh', label: 'Producto', hint: 'Fresco', group: 'Productos' }
  ];
  selected: string | null = null;
  label: string | undefined = 'Percentage';
  allowCustom = false;
  filterFrom = 99;
  floatingPanel = false;
}

describe('PickerComponent', () => {
  let fixture: ComponentFixture<PickerHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PickerHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(PickerHostComponent);
    fixture.detectChanges();
  });

  const trigger = () =>
    fixture.nativeElement.querySelector('.picker__trigger') as HTMLButtonElement;
  const panel = () => fixture.nativeElement.querySelector('.picker__panel') as HTMLElement | null;
  const component = () =>
    fixture.debugElement.query(By.directive(PickerComponent)).componentInstance as PickerComponent;
  const search = () =>
    fixture.nativeElement.querySelector('.picker__search input') as HTMLInputElement | null;

  async function open(): Promise<void> {
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setQuery(value: string): void {
    const input = search();
    if (!input) throw new Error('No se mostró el filtro del selector');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  it('da al trigger el nombre accesible pasado por el padre', () => {
    expect(trigger().getAttribute('aria-label')).toBe('Percentage');
  });

  it('incluye el valor actual en el nombre accesible, con label explícito y fallback', () => {
    fixture.componentInstance.selected = '10';
    fixture.detectChanges();
    expect(trigger().getAttribute('aria-label')).toContain('10 %');

    fixture.componentInstance.label = undefined;
    fixture.detectChanges();
    expect(trigger().getAttribute('aria-label')).toContain('10 %');
  });

  it('elige una opcion, comunica el valor y cierra el listbox', () => {
    trigger().click();
    fixture.detectChanges();
    expect(panel()).not.toBeNull();

    (fixture.nativeElement.querySelector('[role="option"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selected).toBe('10');
    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('omite opciones deshabilitadas y mantiene abierto el panel', () => {
    trigger().click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('[role="option"]')[2] as HTMLElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.selected).toBeNull();
    expect(panel()).not.toBeNull();
  });

  it('filtra por valor y pista, agrupa opciones y permite texto libre desde el teclado', async () => {
    fixture.componentInstance.filterFrom = 2;
    fixture.componentInstance.allowCustom = true;
    fixture.detectChanges();
    await open();

    expect(search()).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.picker__group').length).toBe(2);

    setQuery('Fresco');
    expect(
      component()
        .filtered()
        .map((option) => option.value)
    ).toEqual(['fresh']);
    setQuery('20');
    expect(
      component()
        .filtered()
        .map((option) => option.value)
    ).toEqual(['code-20']);

    setQuery('Anything else');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    search()!.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBeTrue();
    expect(fixture.componentInstance.selected).toBe('Anything else');
    expect(panel()).toBeNull();
  });

  it('actualiza filtro y grupos si cambian las opciones con el panel abierto', async () => {
    fixture.componentInstance.filterFrom = 2;
    fixture.detectChanges();
    await open();
    setQuery('fresh');
    expect(
      component()
        .filtered()
        .map((option) => option.value)
    ).toEqual(['fresh']);

    fixture.componentInstance.options = [
      { value: 'fresh-recipe', label: 'Fresh recipe', group: 'New group' },
      { value: 'stale', label: 'Old option', group: 'Old group' }
    ];
    fixture.detectChanges();

    expect(
      component()
        .filtered()
        .map((option) => option.value)
    ).toEqual(['fresh-recipe']);
    expect(
      component()
        .rows()
        .map((row) => (row.kind === 'header' ? row.label : row.option.label))
    ).toEqual(['New group', 'Fresh recipe']);
    expect(fixture.nativeElement.querySelectorAll('[role="option"]')[0].textContent).toContain(
      'Fresh recipe'
    );
  });

  it('una coincidencia exacta se confirma en el buscador y evita usarla como texto libre', async () => {
    fixture.componentInstance.filterFrom = 2;
    fixture.componentInstance.allowCustom = true;
    fixture.detectChanges();
    await open();
    setQuery('10 %');

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    search()!.dispatchEvent(event);
    fixture.detectChanges();

    expect(component().exactMatch).toBeTrue();
    expect(fixture.componentInstance.selected).toBe('10');
    expect(panel()).toBeNull();
  });

  it('confirma el resultado exacto aunque una opción anterior solo lo contenga', async () => {
    fixture.componentInstance.filterFrom = 1;
    fixture.componentInstance.allowCustom = true;
    fixture.componentInstance.options = [
      { value: 'kg', label: 'kg' },
      { value: 'g', label: 'g' },
      { value: '500 g', label: '500 g' }
    ];
    fixture.detectChanges();
    await open();
    setQuery('g');
    expect(component().active()).toBe(1);

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    search()!.dispatchEvent(event);
    fixture.detectChanges();

    expect(fixture.componentInstance.selected).toBe('g');
    expect(panel()).toBeNull();
  });

  it('ArrowDown desde la búsqueda confirma la opción filtrada activa, no texto custom', async () => {
    fixture.componentInstance.filterFrom = 1;
    fixture.componentInstance.allowCustom = true;
    fixture.componentInstance.options = [
      { value: '250 g', label: '250 g' },
      { value: '500 g', label: '500 g' },
      { value: 'kg', label: 'kg' }
    ];
    fixture.detectChanges();
    await open();
    setQuery('250');

    const press = (key: string) => {
      search()!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
      fixture.detectChanges();
    };
    const emit = spyOn(component().valueChange, 'emit').and.callThrough();
    press('ArrowDown');
    expect(component().active()).toBe(0);
    press('Enter');

    expect(fixture.componentInstance.selected).toBe('250 g');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it('no interpreta el espacio del campo de búsqueda como selección', async () => {
    fixture.componentInstance.filterFrom = 1;
    fixture.componentInstance.allowCustom = true;
    fixture.componentInstance.options = [
      { value: '250 g', label: '250 g' },
      { value: '500 g', label: '500 g' }
    ];
    fixture.detectChanges();
    await open();
    setQuery('250');

    search()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.selected).toBeNull();
    expect(panel()).not.toBeNull();
  });

  it('flechas, Enter, Home, End, Tab y Escape mantienen el contrato de teclado', async () => {
    const key = (target: HTMLElement, value: string) => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
      );
      fixture.detectChanges();
    };

    key(trigger(), 'ArrowDown');
    expect(panel()).not.toBeNull();
    expect(component().active()).toBe(0);
    key(trigger(), 'ArrowDown');
    expect(component().active()).toBe(1);
    key(trigger(), 'ArrowUp');
    expect(component().active()).toBe(0);
    key(trigger(), 'ArrowUp');
    expect(component().active()).toBe(3);
    key(trigger(), 'Home');
    expect(component().active()).toBe(0);
    key(trigger(), 'End');
    expect(component().active()).toBe(3);
    key(trigger(), 'Enter');
    expect(fixture.componentInstance.selected).toBe('fresh');
    expect(panel()).toBeNull();

    key(trigger(), 'Enter');
    expect(panel()).not.toBeNull();
    key(trigger(), 'Tab');
    expect(panel()).toBeNull();
    key(trigger(), ' ');
    expect(panel()).not.toBeNull();
    key(trigger(), 'Escape');
    expect(panel()).toBeNull();
  });

  it('Escape y clic exterior cierran el panel', () => {
    trigger().click();
    fixture.detectChanges();
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(panel()).toBeNull();

    trigger().click();
    fixture.detectChanges();
    document.body.click();
    fixture.detectChanges();
    expect(panel()).toBeNull();
  });

  it('coloca la lista hacia arriba cuando falta espacio y conserva el valor desconocido', async () => {
    fixture.componentInstance.selected = 'custom-value';
    fixture.detectChanges();
    expect(component().selectedLabel).toBe('custom-value');
    expect(component().selectedOption()).toBeUndefined();

    const root = fixture.nativeElement.querySelector('.picker') as HTMLElement;
    spyOn(root, 'getBoundingClientRect').and.returnValue({
      top: 50,
      bottom: window.innerHeight - 20,
      left: 0,
      right: 200,
      width: 200,
      height: 44,
      x: 0,
      y: 50,
      toJSON: () => ({})
    });
    await open();
    expect(component().flipped()).toBeTrue();
  });

  it('reposiciona el panel flotante en resize y scroll y elimina los listeners al destruir', async () => {
    const width = 160;
    const height = 44;
    const maxLeft = Math.max(8, window.innerWidth - 288);
    const initialLeft = Math.min(16, maxLeft);
    const resizedLeft = Math.max(initialLeft, Math.min(200, maxLeft));
    const makeRect = (left: number, top: number): DOMRect => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({})
    });

    fixture.componentInstance.floatingPanel = true;
    fixture.detectChanges();

    let bounds = makeRect(initialLeft, 100);
    const root = fixture.nativeElement.querySelector('.picker') as HTMLElement;
    spyOn(root, 'getBoundingClientRect').and.callFake(() => bounds);
    await open();

    const picker = component();
    const menu = panel()!;
    expect(menu.style.left).toBe(`${initialLeft}px`);

    bounds = makeRect(resizedLeft, 140);
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();

    expect(picker.floatingPosition().left).toBe(resizedLeft);
    expect(menu.style.left).toBe(`${resizedLeft}px`);

    bounds = makeRect(resizedLeft, window.innerHeight - 60);
    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    const beforeDestroy = picker.floatingPosition();
    expect(beforeDestroy.top).toBeNull();
    expect(beforeDestroy.bottom).toBe(64);

    fixture.destroy();
    bounds = makeRect(initialLeft, 100);
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));

    expect(picker.floatingPosition()).toEqual(beforeDestroy);
  });
});
