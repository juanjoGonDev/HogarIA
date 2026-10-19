import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PickerComponent,
  type PickerOption
} from '../../shared/components/ui/picker/picker.component';
import type { IconName } from '../../shared/components/ui/icon/icon-paths';
import { StorageService } from '../../core/services/storage.service';

export { UNIT_FAMILIES, canonicalUnit, familyOf, type UnitFamily } from './unit-families';

/**
 * El selector de unidad de la hoja de una linea.
 *
 * Antes habia DOS controles para la misma decision: una fila de chips (ud / kg / L / pack) y
 * debajo un desplegable con las demas. Dos controles, dos estados, y la persona que tocaba un
 * chip no veia que el desplegable seguia diciendo «Otra unidad…». Ahi se decide UNA cosa, asi
 * que hay UN control — y el disparador siempre dice lo que hay dentro.
 *
 * La lista no es un pelotón de 49 cadenas: va por familias, y elegir la familia ya vale
 * (coge su unidad por defecto). afinar dentro de la familia es una pulsacion mas, no una
 * obligacion. Y «bote de 400 g» sigue siendo un valor legitimo: el formato de la estanteria no
 * cabe en ninguna enumeracion, y quien lo escribe no puede perder lo que ha tecleado.
 */

/**
 * Las familias y la canonizacion viven en `unit-families.ts` para que se puedan probar sin
 * arrancar Angular — y porque el resto de la pantalla (la fila, el pegado, la hoja) necesita la
 * MISMA regla: dos criterios de «esto es un kg» son dos unidades guardadas para el mismo bote.
 */
import { canonicalUnit, familyOf, unitPickerOptions } from './unit-families';
import { I18nService } from '../../core/services/i18n.service';

const RECENT_UNITS_KEY = 'shopping.recent-units';
const MAX_RECENT_UNITS = 6;

@Component({
  selector: 'app-unit-picker',
  standalone: true,
  imports: [CommonModule, PickerComponent],
  template: `
    <div class="unit-picker">
      <app-picker
        [label]="labelText"
        [options]="options()"
        [value]="value"
        [placeholder]="placeholderText"
        [searchPlaceholder]="searchText"
        [allowCustom]="true"
        [filterFrom]="6"
        [leadingIcon]="familyIcon()"
        (valueChange)="pick($event)"
        data-test="unit-picker"
      />
    </div>
  `,
  styles: [
    `
      .unit-picker {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
    `
  ]
})
export class UnitPickerComponent {
  /* Los dos textos de fabrica viven en el diccionario y se resuelven al leer: un campo fijado al
     construir no se entera del idioma (12s-B). */
  get labelText(): string {
    return this.label ?? this.i18n.t('ui.unidad_o_formato');
  }

  get placeholderText(): string {
    return this.placeholder ?? this.i18n.t('ui.sin_unidad');
  }
  private readonly i18n = inject(I18nService);
  private readonly storage = inject(StorageService);

  /** La frase propia del picker de unidades, resuelta al pintar: un campo se congela (## 12v). */
  protected get searchText(): string {
    return this.i18n.t('shopping_lists.picker_buscar_unidad');
  }

  @Input() value: string | null = null;
  /**
   * Sin literal en la declaracion: un campo se fija al construir el componente y no se entera del idioma
   * (12s-B). El valor de fabrica vive en el diccionario y se resuelve al leer.
   */
  @Input() label?: string;
  @Input() placeholder?: string;
  @Output() valueChange = new EventEmitter<string | null>();

  private readonly recentUnits = signal(this.readRecentUnits());

  /**
   * Las unidades, agrupadas por titulo de familia. Ni descripcion por fila (en una columna
   * de movil se recortaba a dos letras: ruido con puntos suspensivos) ni familia elegible.
   */
  readonly options = computed<PickerOption[]>(() => {
    const recentUnits = this.recentUnits();
    const recentKeys = new Set(recentUnits.map((unit) => unit.toLowerCase()));
    const recentGroup = this.i18n.t('shopping_list_detail.unidades_recientes');
    return [
      ...recentUnits.map((unit) => ({ value: unit, label: unit, group: recentGroup })),
      ...unitPickerOptions()
        .filter((option) => !recentKeys.has(option.value.toLowerCase()))
        .map((option) => ({ ...option, group: this.i18n.t(option.groupKey) }))
    ];
  });

  /** El icono de la familia, en el disparador: «kg» se ve, «peso» se intuye. */
  readonly familyIcon = computed<IconName>(() => familyOf(this.value)?.icon ?? 'unfold_more');

  pick(value: string | null): void {
    const unit = canonicalUnit(value);
    if (unit) this.recordRecentUnit(unit);
    this.valueChange.emit(unit);
  }

  private recordRecentUnit(unit: string): void {
    const normalized = unit.toLowerCase();
    const recent = [
      unit,
      ...this.recentUnits().filter((existing) => existing.toLowerCase() !== normalized)
    ].slice(0, MAX_RECENT_UNITS);
    this.recentUnits.set(recent);
    this.storage.set(RECENT_UNITS_KEY, recent);
  }

  private readRecentUnits(): string[] {
    const stored = this.storage.get<unknown>(RECENT_UNITS_KEY);
    if (!Array.isArray(stored)) return [];

    const seen = new Set<string>();
    const recent: string[] = [];
    for (const value of stored) {
      if (typeof value !== 'string') continue;
      const unit = canonicalUnit(value);
      if (!unit) continue;
      const normalized = unit.toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      recent.push(unit);
      if (recent.length === MAX_RECENT_UNITS) break;
    }
    return recent;
  }
}
