import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icon-paths';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';
import { I18nService } from '../../../../core/services/i18n.service';

export type PickerOption = {
  value: string;
  label: string;
  hint?: string;
  color?: string | null;
  disabled?: boolean;
  /**
   * Titulo de la seccion a la que pertenece la opcion. Un titulo NO se puede elegir: es
   * una etiqueta que agrupa, y meterla como opcion tiene dos efectos secundarios —un
   * clic que no es lo que la gente cree que esta eligiendo, y dos filas con el mismo
   * `value` (la familia y su unidad por defecto), con lo que el disparador enseña la
   * primera coincidencia y dice «Volumen» cuando dentro hay «1,5 L».
   */
  group?: string;
};

/** Una fila del panel: un titulo o una opcion. `index` es su sitio en `filtered()`. */
export type PickerRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'option'; key: string; option: PickerOption; index: number };

/**
 * Selector propio, en vez de `select` nativo (HOGARIA-SPEC §8f).
 *
 * El nativo no se puede pintar con el tema (en Android abre el dialogo del sistema con
 * sus colores, y en iOS una rueda), no admite color por opcion —que en una seccion de la
 * compra ES informacion— y no deja escribir un valor que no esta en la lista, que es
 * justo lo que hace falta con las unidades: «bote de 400 g» no cabe en un enum.
 *
 * Lo que si tiene, y por eso no es un capricho estetico:
 *  - filtro al escribir (una lista de 60 unidades se recorre con el pulgar),
 *  - teclado completo: flechas, Enter, Escape, y se cierra al hacer clic fuera,
 *  - `allowCustom`: la cadena tecleada es un valor valido, no se pierde,
 *  - y el disparador dice SIEMPRE lo que hay dentro, no un placeholder amable.
 */
@Component({
  selector: 'app-picker',
  standalone: true,
  imports: [TranslatePipe, CommonModule, FormsModule, IconComponent],
  template: `
    <div class="picker" #root [class.picker--up]="flipped() && !floatingPanel">
      <button
        type="button"
        class="picker__trigger"
        [class.picker__trigger--open]="open()"
        [class.picker__trigger--empty]="!selectedLabel"
        [attr.aria-label]="selectedLabel ? labelText + ': ' + selectedLabel : labelText"
        [attr.aria-expanded]="open()"
        [attr.aria-haspopup]="'listbox'"
        [attr.aria-controls]="open() ? listId() : null"
        [disabled]="disabled"
        (click)="toggle()"
        (keydown)="onListKeys($event, true)"
      >
        @if (leadingIcon) {
          <app-icon [name]="leadingIcon" [size]="18" [label]="null" />
        }
        <span class="picker__value">{{ selectedLabel || placeholderText }}</span>
        @if (selectedOption()?.color) {
          <span
            class="picker__dot"
            [style.background]="selectedOption()?.color"
            aria-hidden="true"
          ></span>
        }
        <app-icon class="picker__caret" name="expand_more" [size]="20" [label]="null" />
      </button>

      @if (open()) {
        <div
          class="picker__panel"
          [id]="listId()"
          [class.picker__panel--floating]="floatingPanel"
          [style.left.px]="floatingPanel ? floatingPosition().left : null"
          [style.width.px]="floatingPanel ? floatingPosition().width : null"
          [style.top.px]="floatingPanel ? floatingPosition().top : null"
          [style.bottom.px]="floatingPanel ? floatingPosition().bottom : null"
          [style.--picker-floating-list-max-height]="floatingPanel ? floatingPosition().listMaxHeight + 'px' : null"
          role="listbox"
          [attr.aria-label]="labelText"
          (keydown)="onListKeys($event, false)"
        >
          @if (options.length > filterFrom) {
            <div class="picker__search">
              <app-icon name="search" [size]="16" [label]="null" />
              <input
                #search
                type="text"
                name="pickerQuery"
                role="combobox"
                [ngModel]="query()"
                (ngModelChange)="setQuery($event)"
                [placeholder]="searchPlaceholderText"
                autocomplete="off"
                [attr.aria-expanded]="open()"
                [attr.aria-controls]="listId()"
                [attr.aria-activedescendant]="activeOptionId()"
                (keydown)="onSearchKeys($event)"
              />
            </div>
          }
          <ul class="picker__list">
            @if (customOptionVisible) {
              <li
                class="picker__option picker__option--custom"
                [class.picker__option--active]="active() === -1"
                role="option"
                [attr.id]="listId() + '-custom'"
                [attr.aria-selected]="active() === -1"
                (click)="useCustom()"
              >
                <app-icon name="add" [size]="18" [label]="null" />
                <span>{{ query().trim() }}</span>
                <span class="picker__tag">{{ 'ui.usar_este_texto' | t }}</span>
              </li>
            }
            @for (row of rows(); track row.key) {
              @if (row.kind === 'header') {
                <li class="picker__group" role="presentation">{{ row.label }}</li>
              }
              @if (row.kind === 'option') {
                <li
                  class="picker__option"
                  role="option"
                  [class.picker__option--active]="active() === row.index"
                  [attr.aria-selected]="isSelected(row.option)"
                  [attr.aria-disabled]="row.option.disabled || null"
                  [attr.id]="listId() + '-' + row.index"
                  (click)="choose(row.option)"
                  (mouseenter)="active.set(row.index)"
                >
                  @if (row.option.color) {
                    <span
                      class="picker__dot"
                      [style.background]="row.option.color"
                      aria-hidden="true"
                    ></span>
                  }
                  <span class="picker__label">{{ row.option.label }}</span>
                  @if (row.option.hint) {
                    <span class="picker__hint">{{ row.option.hint }}</span>
                  }
                  @if (isSelected(row.option)) {
                    <app-icon
                      class="picker__check"
                      name="check"
                      [size]="18"
                      [label]="'ui.selected_option' | t: { option: row.option.label }"
                    />
                  }
                </li>
              }
            }
          </ul>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
      .picker__trigger {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        min-height: 44px;
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-primary);
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-family: inherit;
        cursor: pointer;
        transition: var(--transition-fast);
      }
      .picker__trigger:hover:not(:disabled) {
        border-color: var(--border-strong);
      }
      .picker__trigger--open {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--primary-subtle);
      }
      .picker__trigger:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .picker__value {
        flex: 1 1 auto;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .picker__trigger--empty .picker__value {
        color: var(--text-tertiary);
      }
      .picker__caret {
        color: var(--text-tertiary);
        transition: transform var(--transition-fast);
      }
      .picker__trigger--open .picker__caret {
        transform: rotate(180deg);
      }
      .picker__dot {
        width: 10px;
        height: 10px;
        border-radius: var(--radius-full);
        flex: 0 0 auto;
      }
      .picker__panel {
        position: absolute;
        z-index: 30;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.14));
        padding: var(--space-1);
        animation: picker-in 0.14s ease-out;
      }
      .picker__panel--floating {
        position: fixed;
        z-index: 1100;
        right: auto;
        top: auto;
        bottom: auto;
        max-width: calc(100vw - 16px);
      }
      /* Y si no cabe debajo del dedo, se abre HACIA ARRIBA: dentro de una hoja con
         overflow-y auto, un panel que asoma por abajo queda recortado y la opcion mas
         baja de la lista es literalmente inalcanzable. */
      .picker--up .picker__panel {
        top: auto;
        bottom: calc(100% + 4px);
      }
      /* No hay scale/opacity de medio segundo: un menu que se abre tiene que estar
         debajo del dedo antes de que se levante. */
      @keyframes picker-in {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .picker__search {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2);
        border-bottom: 1px solid var(--border-default);
        color: var(--text-tertiary);
      }
      .picker__search input {
        flex: 1 1 auto;
        border: none;
        background: transparent;
        color: var(--text-primary);
        font-size: var(--text-sm);
        font-family: inherit;
        outline: none;
        min-height: 32px;
      }
      .picker__list {
        list-style: none;
        margin: 0;
        padding: var(--space-1) 0;
        max-height: 268px;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .picker__panel--floating .picker__list {
        max-height: var(--picker-floating-list-max-height, 320px);
      }
      .picker__group {
        padding: var(--space-2) var(--space-3) var(--space-1);
        font-size: var(--text-xs);
        font-weight: var(--font-semibold);
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--text-tertiary);
        cursor: default;
        user-select: none;
      }
      .picker__option {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        font-size: var(--text-sm);
        color: var(--text-primary);
        cursor: pointer;
        min-height: 40px;
      }
      .picker__option--active {
        background: var(--bg-tertiary);
      }
      .picker__option[aria-selected='true'] {
        font-weight: var(--font-semibold);
      }
      .picker__option--custom {
        border-top: 1px dashed var(--border-default);
        border-radius: 0;
        margin-top: var(--space-1);
        color: var(--primary);
      }
      .picker__option[aria-disabled='true'] {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .picker__label {
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .picker__hint,
      .picker__tag {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        font-weight: var(--font-normal);
      }
      .picker__check {
        color: var(--primary);
      }
      .picker__none {
        padding: var(--space-3);
        font-size: var(--text-sm);
        color: var(--text-tertiary);
        text-align: center;
      }
    `
  ]
})
export class PickerComponent implements OnInit, OnDestroy {
  private readonly i18n = inject(I18nService);

  private readonly optionsState = signal<PickerOption[]>([]);

  @Input({ required: true })
  set options(options: PickerOption[] | null | undefined) {
    this.optionsState.set(options ?? []);
  }

  get options(): PickerOption[] {
    return this.optionsState();
  }
  @Input() value: string | null = null;
  /**
   * Cuatro textos de fabrica que eran literales en la declaracion. Un campo del componente se evalua al
   * construirlo, asi que «Buscar» se quedaba en espanol para siempre aunque se cambiara de idioma; ahora
   * el valor por defecto se resuelve al leerlo y el idioma entra por la senal del servicio (12s-B).
   */
  @Input() placeholder?: string;
  @Input() label?: string;
  @Input() searchPlaceholder?: string;

  get placeholderText(): string {
    return this.placeholder ?? this.i18n.t('ui.choose');
  }

  get labelText(): string {
    return this.label ?? this.i18n.t('ui.options');
  }

  get searchPlaceholderText(): string {
    return this.searchPlaceholder ?? this.i18n.t('ui.buscar');
  }

  @Input() leadingIcon: IconName | null = null;
  @Input() allowCustom = false;
  @Input() disabled = false;
  /** Escape parent scroll clipping for short menus nested inside dialogs or sheets. */
  @Input() floatingPanel = false;
  /** Optional wider menu for long labels; clamped to viewport width by the positioning logic. */
  @Input() floatingPanelMinWidth = 280;
  /** Por debajo de este numero de opciones el buscador es ruido, no ayuda. */
  @Input() filterFrom = 8;
  @Input() id = `picker-${Math.random().toString(36).slice(2, 8)}`;

  @Output() valueChange = new EventEmitter<string | null>();
  @Output() openChange = new EventEmitter<boolean>();

  @ViewChild('root') rootRef?: ElementRef<HTMLElement>;
  @ViewChild('search') searchRef?: ElementRef<HTMLInputElement>;

  readonly open = signal(false);
  /** Hacia donde abre el panel; ver `flipForRoom`. */
  readonly flipped = signal(false);
  readonly active = signal(0);
  readonly query = signal('');
  readonly listId = computed(() => `${this.id}-list`);
  readonly floatingPosition = signal({ left: 8, top: 8 as number | null, bottom: null as number | null, width: 280, listMaxHeight: 268 });

  private onOutside = (event: MouseEvent) => this.closeOnOutside(event);
  private onViewportChange = () => this.positionFloatingPanel();

  get selectedLabel(): string {
    const found = this.options.find((option) => option.value === this.value);
    return found?.label ?? (this.value ? String(this.value) : '');
  }

  get exactMatch(): boolean {
    const wanted = this.query().trim().toLowerCase();
    return !!wanted && this.filtered().some((option) => option.label.toLowerCase() === wanted);
  }

  get customOptionVisible(): boolean {
    return this.allowCustom && !!this.query().trim() && !this.exactMatch;
  }

  readonly filtered = computed(() => {
    const wanted = this.query().trim().toLowerCase();
    if (!wanted) return this.options;
    return this.optionsState().filter(
      (option) =>
        option.label.toLowerCase().includes(wanted) ||
        option.value.toLowerCase().includes(wanted) ||
        (option.hint ?? '').toLowerCase().includes(wanted)
    );
  });

  /**
   * Lo que se pinta: `filtered()` con un titulo insertado antes del primer elemento de cada
   * grupo. La navegacion por teclado sigue contando SOLO opciones —un titulo al que se puede
   * llegar con las flechas y no se puede elegir es un tambor de vacio.
   */
  readonly rows = computed<PickerRow[]>(() => {
    const out: PickerRow[] = [];
    let current: string | null = null;
    this.filtered().forEach((option, index) => {
      const group = option.group ?? null;
      if (group && group !== current) {
        out.push({ kind: 'header', key: 'h:' + group, label: group });
        current = group;
      }
      out.push({ kind: 'option', key: 'o:' + option.value, option, index });
    });
    return out;
  });

  selectedOption(): PickerOption | undefined {
    return this.options.find((option) => option.value === this.value);
  }

  isSelected(option: PickerOption): boolean {
    return option.value === this.value;
  }

  activeOptionId(): string | null {
    if (this.customOptionVisible && this.active() === -1) return `${this.listId()}-custom`;
    const index = this.active();
    return index >= 0 && index < this.filtered().length ? `${this.listId()}-${index}` : null;
  }

  setQuery(value: string): void {
    this.query.set(value);
    const wanted = value.trim().toLowerCase();
    const filtered = this.filtered();
    if (!wanted) {
      const selected = filtered.findIndex((option) => option.value === this.value);
      this.active.set(selected >= 0 ? selected : 0);
      return;
    }

    const exact = filtered.findIndex((option) => option.label.toLowerCase() === wanted);
    if (exact >= 0) this.active.set(exact);
    else this.active.set(this.allowCustom ? -1 : 0);
  }

  ngOnInit(): void {
    document.addEventListener('click', this.onOutside, true);
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('scroll', this.onViewportChange, true);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.onOutside, true);
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('scroll', this.onViewportChange, true);
  }

  toggle(): void {
    this.open.set(!this.open());
    if (this.open()) {
      const index = this.options.findIndex((option) => option.value === this.value);
      this.active.set(index >= 0 ? index : 0);
      this.query.set('');
      this.flipForRoom();
      setTimeout(() => {
        this.searchRef?.nativeElement.focus();
        this.flipForRoom();
        this.positionFloatingPanel();
      });
    }
    this.openChange.emit(this.open());
  }

  /**
   * Cabe el panel debajo? Se mide en dos momentos (al abrir y cuando el foco ya esta
   * puesto, que es cuando la hoja ha podido hacer scroll) porque la respuesta cambia si
   * el disparador esta pegado al borde inferior de una hoja con `overflow-y: auto`.
   */
  private flipForRoom(): void {
    const root = this.rootRef?.nativeElement;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const roomBelow = window.innerHeight - box.bottom;
    this.flipped.set(roomBelow < 200 && box.top > roomBelow);
  }

  /** Fixed placement keeps the menu visible when an ancestor (such as modal body) scrolls. */
  private positionFloatingPanel(): void {
    if (!this.floatingPanel || !this.open()) return;
    const root = this.rootRef?.nativeElement;
    if (!root) return;

    const box = root.getBoundingClientRect();
    const hasSearch = this.options.length > this.filterFrom;
    const estimatedHeight = Math.min(360, this.options.length * 40 + (hasSearch ? 60 : 16));
    const below = Math.max(0, window.innerHeight - box.bottom - 8);
    const above = Math.max(0, box.top - 8);
    const openBelow = below >= estimatedHeight || below >= above;
    const available = openBelow ? below : above;
    const listMaxHeight = Math.max(80, Math.min(320, available - (hasSearch ? 60 : 16)));
    const width = Math.min(Math.max(box.width, this.floatingPanelMinWidth, 280), window.innerWidth - 16);
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));

    this.floatingPosition.set({
      left,
      width,
      top: openBelow ? box.bottom + 4 : null,
      bottom: openBelow ? null : window.innerHeight - box.top + 4,
      listMaxHeight
    });
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.openChange.emit(false);
  }

  /**
   * El clic que reventaria el panel: el listener va en fase de captura y comprueba el
   * propio DOM, porque un `mousedown` en el boton ya habria cerrado y vuelto a abrir.
   */
  private closeOnOutside(event: MouseEvent): void {
    if (!this.open()) return;
    const root = this.rootRef?.nativeElement;
    if (root && event.target instanceof Node && !root.contains(event.target)) this.close();
  }

  choose(option: PickerOption): void {
    if (option.disabled) return;
    this.emit(option.value);
  }

  useCustom(): void {
    const text = this.query().trim();
    if (text) this.emit(text);
  }

  private emit(value: string | null): void {
    this.value = value;
    this.valueChange.emit(value);
    this.close();
  }

  onSearchKeys(event: KeyboardEvent): void {
    // El input vive dentro del listbox, que también escucha keydown. Parar aquí evita
    // confirmar dos veces la misma fila; espacio, en cambio, debe seguir siendo texto.
    const handledKeys = ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Escape', 'Tab', 'Home', 'End'];
    if (!handledKeys.includes(event.key)) return;
    event.stopPropagation();
    if (event.key === ' ') return;
    this.onListKeys(event, false);
  }

  onListKeys(event: KeyboardEvent, fromTrigger: boolean): void {
    const size = this.filtered().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.toggle();
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const custom = this.customOptionVisible;
        const total = size + (custom ? 1 : 0);
        if (!total) {
          this.active.set(0);
          return;
        }
        const current = custom ? (this.active() < 0 ? 0 : this.active() + 1) : this.active();
        const next = (current + step + total) % total;
        this.active.set(custom && next === 0 ? -1 : custom ? next - 1 : next);
        break;
      }
      case 'Enter':
      case ' ': {
        // Desde el gatillo: cerrado, Enter/espacio abren; ABIERTO, confirman la opcion activa. Sin esta
        // segunda pata, el teclado del picker no podia elegir nada cuando la lista no lleva buscador.
        if (fromTrigger && !this.open()) {
          event.preventDefault();
          this.toggle();
          return;
        }
        if (!fromTrigger && !this.open()) return;
        if (this.customOptionVisible && this.active() === -1) {
          event.preventDefault();
          this.useCustom();
          return;
        }
        const option = this.filtered()[this.active()];
        if (option) {
          event.preventDefault();
          this.choose(option);
        } else if (fromTrigger) {
          event.preventDefault();
          this.close();
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'Tab':
        this.close();
        break;
      case 'Home':
        if (this.open()) {
          event.preventDefault();
          this.active.set(this.customOptionVisible ? -1 : 0);
        }
        break;
      case 'End':
        if (this.open()) {
          event.preventDefault();
          this.active.set(size ? size - 1 : this.customOptionVisible ? -1 : 0);
        }
        break;
    }
  }
}
