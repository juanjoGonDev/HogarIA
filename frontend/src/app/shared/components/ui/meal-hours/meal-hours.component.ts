import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MEAL_ORDER,
  MEAL_TIME_DEFAULTS,
  MealPlan,
  MealTimes,
  MealType
} from '../../../models/calendar.model';
import { TranslatePipe } from '../../../../core/pipes/translate.pipe';
import { MEAL_LABEL_KEYS } from '../../../../core/i18n/labels';
import type { TranslationKey } from '../../../../core/i18n';
import { CheckboxComponent } from '../checkbox/checkbox.component';

interface MealHourRow {
  type: MealType;
  /** `#meal-dinner`, `#ob-meal-dinner`: lo que buscan los e2e. */
  id: string;
  /**
   * La etiqueta viaja como CLAVE y se traduce en la plantilla. Resolviendo el texto aqui habria que meter
   * el idioma en la clave del cache (y cualquier lector del array, un `t()`); con la clave, el `| t`
   * impuro hace que cambiar de idioma se note al instante y el cache siga siendo estable.
   */
  labelKey: TranslationKey;
  hint?: string;
}

/**
 * Las cuatro horas de la casa, escritas una sola vez.
 *
 * Existian dos copias del mismo bloque —el paso del tour y Preferencias— y la segunda habia
 * «mejorado» a medias: el tour guardaba el cambio pero el boton de guardar no se enteraba. Un
 * componente en vez de dos hojas de estilos es lo que hace que «por defecto» signifique lo mismo en
 * las dos pantallas.
 *
 * **Escribe dentro del objeto del host.** No emite una copia: el host es dueno de `times` y lo compara
 * contra su snapshot para saber si hay cambios (Preferencias) o para decidir el parche que manda (el
 * tour). Si esto emitiera un objeto nuevo, el `savedSnapshot` de Preferencias seguiria siendo viejo y
 * «hay cambios» mentiria —que es justo el bug que habia.
 *
 * `idPrefix` no es decoracion: los ids acaban siendo `#meal-dinner` y `#ob-meal-dinner`, que son los
 * que buscan los e2e. Esos dos prefijos son el contrato entre «la misma pantalla en dos sitios» y «dos
 * controles distintos que se llaman igual».
 */
@Component({
  selector: 'app-meal-hours',
  standalone: true,
  imports: [TranslatePipe, CommonModule, FormsModule, CheckboxComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="meal-hours" role="group" [attr.aria-label]="groupLabel ?? ('ui.meal_hours' | t)">
      <div class="meal-hours__row" *ngFor="let row of rows; trackBy: trackRow">
        <label class="meal-hours__label" [attr.for]="row.id">{{ row.labelKey | t }}</label>
        <input
          type="time"
          class="meal-hours__input"
          [id]="row.id"
          [name]="row.id"
          [attr.data-test]="dataTest ? dataTest + '-' + row.type : null"
          [attr.aria-describedby]="row.hint ? row.id + '-hint' : null"
          [ngModel]="times[row.type]"
          (ngModelChange)="write(row.type, $event)"
        />
        <!-- Vaciar un input de hora no es una decision, asi que aqui no se explica: se pulsa el boton.
             El boton vive en la fila TOCADA (isNotDefault): donde la hora ya es la de siempre no hay nada
             que deshacer. (La condicion estuvo al reves desde el nacimiento del componente; lo delataba el
             registro nuevo con cuatro «Por defecto» en fila, HOGARIA-SPEC ## 12af.) -->
        <button
          *ngIf="isNotDefault(row.type)"
          type="button"
          class="meal-hours__reset"
          [attr.data-test]="dataTest ? dataTest + '-reset-' + row.type : null"
          (click)="reset(row.type)"
        >
          {{ 'ui.por_defecto' | t }}
        </button>
        <span class="meal-hours__state" *ngIf="!isDefault(row.type)">{{ defaults[row.type] }}</span>
        <!--
          «Que la IA la planifique» (12t-T). Se ofrece solo cuando el host trae permisos: el tour de
          bienvenida pregunta las cuatro horas y punto, ahi no hay bloqueo que marcar. La hora de una
          comida bloqueada sigue editandose: ese reloj manda en la rejilla y en el «+» manual, y
          bloquear es quitarle la tarea a la IA, no quitarle la comida a la casa.
        -->
        <app-checkbox
          *ngIf="plan"
          class="meal-hours__plan"
          [attr.data-test]="dataTest ? dataTest + '-plan-' + row.type : null"
          [checked]="plan[row.type]"
          [label]="'ui.que_la_ia_la_planifique' | t"
          (onChange)="writePlan(row.type, $event)"
        />
        <p class="meal-hours__hint" *ngIf="row.hint" [id]="row.id + '-hint'">
          {{ hints[row.type] }}
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .meal-hours {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      .meal-hours__row {
        display: grid;
        /* Cuatro huecos: nombre, hora, «por defecto»/valor y la casilla. Con el input plan a null la
           ultima columna no existe y el auto se encoge solo, asi que el tour se ve igual que antes. */
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        column-gap: var(--space-3);
        row-gap: var(--space-1);
      }

      .meal-hours__label {
        font-size: var(--text-sm);
        font-weight: var(--font-medium);
        color: var(--text-primary);
      }

      /* La misma receta que la de app-input: si el control se ve distinto, se comporta distinto en la
         cabeza de quien lo mira. Y dentro de un literal de plantilla no pueden aparecer backticks. */
      .meal-hours__input {
        /* Un input de hora sin dimension propia se encoje hasta el glifo del reloj del navegador (y en
           Safari, hasta cero): un campo que no se ve no se rellena. Los comentarios de dentro de styles
           no llevan acentos graves —cierran el literal—, y eso lo pilla antes la regla
           backtick-cierra-el-literal del check-ui que el compilador.*/
        min-width: 8.5rem;
        min-height: 40px;
        padding: var(--space-2) var(--space-3);
        font-family: var(--font-sans);
        font-size: var(--text-base);
        line-height: var(--leading-normal);
        color: var(--text-primary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-lg);
        transition: var(--transition-fast);
      }

      .meal-hours__input:hover {
        border-color: var(--border-strong);
      }

      .meal-hours__input:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--primary-subtle);
      }

      .meal-hours__reset {
        padding: var(--space-1) var(--space-2);
        font-size: var(--text-xs);
        font-weight: var(--font-medium);
        color: var(--text-secondary);
        background: transparent;
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        transition: var(--transition-fast);
      }

      .meal-hours__reset:hover {
        color: var(--primary-dark);
        background: var(--primary-subtle);
        border-color: var(--primary);
      }

      /* «20:30» a secas, sin verbo, cuando la hora ya es la de siempre: no es un boton, no pide nada. */
      .meal-hours__state {
        font-size: var(--text-xs);
        color: var(--text-tertiary);
        min-width: 5.5rem;
        text-align: right;
      }

      .meal-hours__hint {
        grid-column: 1 / -1;
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-secondary);
      }

      @media (max-width: 600px) {
        .meal-hours__row {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          column-gap: var(--space-2);
        }

        .meal-hours__label {
          min-width: 0;
        }

        .meal-hours__input {
          grid-column: 2;
          width: 100%;
          min-width: 8.5rem;
        }

        .meal-hours__reset {
          grid-column: 1;
          justify-self: start;
        }

        .meal-hours__state {
          grid-column: 2;
          min-width: 0;
          text-align: left;
        }

        .meal-hours__plan {
          grid-column: 1 / -1;
          min-width: 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .meal-hours__input,
        .meal-hours__reset {
          transition: none;
        }
      }
    `
  ]
})
export class MealHoursComponent {
  @Input({ required: true }) times!: MealTimes;
  /** Prefijo de los ids: `meal` en Preferencias, `ob-meal` en el tour. */
  @Input() idPrefix = 'meal';
  /** Un `data-test` por fila (`...-<tipo>`), para los e2e que ya existen. */
  @Input() dataTest: string | null = null;
  /** Tambien se resuelve al leer, no al construir: ver el comentario de `app-picker`. */
  @Input() groupLabel?: string;
  /**
   * Los permisos del planificador (12t-T), o `null` para no ofrecer la casilla.
   *
   * `null` no es «todo permitido» sino «esta pantalla no pinta de eso»: el tour pasa `null` y sus
   * seis preguntas siguen siendo seis. Como `times`, se escribe dentro del objeto del host: el
   * snapshot que decide si hay cambios es el suyo, no el de este componente.
   */
  @Input() plan: MealPlan | null = null;
  readonly defaults = MEAL_TIME_DEFAULTS;
  readonly hints: Partial<Record<MealType, string>> = {};

  /**
   * Las cuatro filas, y **la misma array** mientras `idPrefix` y `hints` no cambien.
   *
   * No puede ser un getter que construya: `*ngFor` compara identidad, y con un array nuevo en cada
   * ciclo de deteccion de cambios las cuatro filas se destruyen y se vuelven a crear —con su
   * `ngModel`, que al nacer escribe el valor otra vez en el modelo, lo que marca el arbol de nuevo,
   * lo que vuelve a construir el array. El bucle no se para nunca y la pantalla se congela: eso fue
   * exactamente lo que se vio al abrir «Horarios» en la tanda 19. Un getter con cache es la version
   * aburrida y correcta; `trackRow` es la red por si alguien vuelve a quitarla.
   */
  get rows(): MealHourRow[] {
    const key = `${this.idPrefix}|${MEAL_ORDER.map((type) => this.hints[type] ?? '').join('|')}`;
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rowsCache = MEAL_ORDER.map((type) => ({
        type,
        id: `${this.idPrefix}-${type}`,
        // `MEAL_TYPE_LABELS` es el dato que entiende la IA; lo que se ensena sale del diccionario.
        labelKey: MEAL_LABEL_KEYS[type],
        hint: this.hints[type]
      }));
    }
    return this.rowsCache;
  }

  private rowsKey = '';
  private rowsCache: MealHourRow[] = [];

  /** Estable por definicion: el id de la fila es su clave y no cambia nunca. */
  trackRow(_index: number, row: MealHourRow): string {
    return row.id;
  }

  /** `true` cuando la hora **no** es la de siempre: ahi es donde «Por defecto» tiene algo que hacer. */
  isNotDefault(type: MealType): boolean {
    const value = this.times?.[type];
    return !!value?.trim() && value !== MEAL_TIME_DEFAULTS[type];
  }

  /** El nombre del template sale al reves de la pregunta (evita el `!` en la plantilla). */
  isDefault(type: MealType): boolean {
    return !this.isNotDefault(type);
  }

  write(type: MealType, value: string): void {
    this.times[type] = value ?? '';
  }

  reset(type: MealType): void {
    this.times[type] = MEAL_TIME_DEFAULTS[type];
  }

  /** Idem con la casilla: el host es dueno del objeto, aqui solo se escribe en el. */
  writePlan(type: MealType, value: boolean): void {
    if (this.plan) this.plan[type] = value;
  }
}
