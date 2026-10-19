import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CalendarDayView,
  CalendarMeal,
  MealType,
  MEAL_ORDER
} from '../../shared/models/calendar.model';
import { formatNumber, labels } from './calendar.util';
import { CalendarHouseholdEventsComponent } from './calendar-household-events.component';
import { CalendarHouseholdTasksComponent } from './calendar-household-tasks.component';
import { HouseholdEvent } from '../../shared/models/calendar.model';
import { CalendarEventComponent } from './calendar-event.component';
import { TranslatePipe } from '../../core/pipes/translate.pipe';

/**
 * Vista de mes: la rejilla clásica de 7 columnas con filas justas (4–6).
 *
 * Cada celda saca tres comidas y «+N más» —es lo que cabe sin que se lea a
 * empujones—; el resto se ve al entrar en el día. Pinchar en el número lleva al
 * día; pinchar en el hueco añade la primera comida que falte ese día.
 */
@Component({
  selector: 'app-calendar-month',
  standalone: true,
  imports: [
    TranslatePipe,
    CommonModule,
    CalendarHouseholdEventsComponent,
    CalendarHouseholdTasksComponent,
    CalendarEventComponent
  ],
  template: `
    <div class="cal-month">
      <div class="cal-month__head" role="row">
        <span *ngFor="let label of weekLabels" class="cal-month__dow" role="columnheader">{{
          label
        }}</span>
      </div>

      <div class="cal-month__grid" role="rowgroup">
        <div *ngFor="let row of rows; trackBy: trackByRow" class="cal-month__row" role="row">
          <div
            *ngFor="let day of row; trackBy: trackByIso"
            class="cal-cell"
            role="gridcell"
            [class.is-outside]="!day.inCurrentMonth"
            [class.is-today]="day.isToday"
            [class.is-anchor]="day.iso === anchorIso"
            [class.has-plans]="day.planned > 0"
            (click)="onCellClick(day, $event)"
          >
            <div class="cal-cell__head">
              <button
                type="button"
                class="cal-cell__num"
                [attr.aria-label]="'calendar.view_day_of' | t: { day: dayLabel(day) }"
                (click)="$event.stopPropagation(); openDay.emit(day.iso)"
              >
                {{ day.date.getDate() }}
              </button>
              <span class="cal-cell__count" *ngIf="day.planned > 0">{{ day.planned }}</span>
              <span class="cal-cell__kcal" *ngIf="day.hasNutrition">{{ fmt(day.calories) }}</span>
            </div>

            <div class="cal-cell__events">
              <app-calendar-household-events
                [events]="day.events"
                [dense]="true"
                (edit)="editEvent.emit($event)"
              />
              <app-calendar-household-tasks [tasks]="day.tasks" [dense]="true" [maxVisible]="1" />

              <app-calendar-event
                *ngFor="let meal of visible(day)"
                mode="row"
                [meal]="meal"
                (open)="openMeal.emit(meal)"
              ></app-calendar-event>

              <button
                *ngIf="day.planned - maxVisible > 0"
                type="button"
                class="cal-cell__more"
                (click)="$event.stopPropagation(); openDay.emit(day.iso)"
              >
                {{ 'calendar.month_more' | t: { n: day.planned - maxVisible } }}
              </button>
            </div>

            <button
              *ngIf="kitchen"
              type="button"
              class="cal-cell__plus"
              [attr.aria-label]="'calendar.anadir_comida' | t"
              [attr.title]="'calendar.anadir_comida' | t"
              (click)="
                $event.stopPropagation();
                addMeal.emit({ date: day.iso, mealType: firstFreeMealType(day) })
              "
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cal-month {
        display: grid;
        grid-template-rows: auto 1fr;
        border-top: 1px solid var(--border-default);
      }

      .cal-month__head {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border-default);
      }

      .cal-month__dow {
        padding: 6px var(--space-2);
        font-size: 10px;
        font-weight: var(--font-semibold);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        text-align: center;
        color: var(--text-secondary);
        border-right: 1px solid var(--border-default);
      }

      .cal-month__dow:last-child {
        border-right: none;
      }

      .cal-month__grid {
        display: grid;
        grid-auto-rows: minmax(104px, 1fr);
      }

      .cal-month__row {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        border-bottom: 1px solid var(--border-default);
      }

      .cal-month__row:last-child {
        border-bottom: none;
      }

      /* ── Celda ── */
      .cal-cell {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        padding: 4px 5px 6px;
        border-right: 1px solid var(--border-default);
        background: var(--bg-secondary);
        cursor: pointer;
        transition: background var(--duration-150) var(--ease-out);
      }

      .cal-cell:last-child {
        border-right: none;
      }

      .cal-cell:hover {
        background: color-mix(in srgb, var(--bg-tertiary) 65%, var(--bg-secondary));
      }

      .cal-cell.is-outside {
        background: color-mix(in srgb, var(--bg-tertiary) 40%, var(--bg-secondary));
      }

      .cal-cell.is-outside .cal-cell__num,
      .cal-cell.is-outside .cal-cell__kcal {
        color: var(--text-tertiary);
      }

      .cal-cell__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
      }

      .cal-cell__num {
        display: grid;
        place-items: center;
        min-width: 22px;
        height: 22px;
        padding: 0 4px;
        font: inherit;
        font-size: var(--text-sm);
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
        background: none;
        border: none;
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: var(--transition-fast);
      }

      .cal-cell__num:hover {
        background: var(--bg-tertiary);
      }

      .cal-cell__num:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 1px;
      }

      .cal-cell.is-today .cal-cell__num {
        color: var(--text-inverse);
        background: var(--primary);
      }

      .cal-cell.is-anchor:not(.is-today) .cal-cell__num {
        box-shadow: inset 0 0 0 1px var(--primary);
      }

      .cal-cell__count {
        margin-left: auto;
        font-size: 9px;
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
      }

      .cal-cell__kcal {
        font-size: 9px;
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
      }

      .cal-cell__events {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-height: 0;
        overflow: hidden;
      }

      .cal-cell__more {
        align-self: flex-start;
        padding: 0 4px;
        font: inherit;
        font-size: 10px;
        color: var(--text-secondary);
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }

      .cal-cell__more:hover {
        color: var(--primary-dark);
        background: var(--bg-tertiary);
      }

      .cal-cell__plus {
        position: absolute;
        top: 4px;
        right: 5px;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        padding: 0;
        font-size: 13px;
        line-height: 1;
        color: var(--text-secondary);
        background: var(--bg-secondary);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-full);
        box-shadow: var(--shadow-xs);
        opacity: 0;
        cursor: pointer;
        transition: var(--transition-fast);
      }

      .cal-cell:hover .cal-cell__plus,
      .cal-cell__plus:focus-visible {
        opacity: 1;
      }

      .cal-cell__plus:hover {
        color: var(--primary-dark);
        border-color: var(--primary);
      }

      /* En móvil la rejilla de mes se apila por semana: celdas legibles sin zoom. */
      @media (max-width: 767px) {
        .cal-month__grid {
          grid-auto-rows: minmax(64px, auto);
        }
        .cal-cell__kcal,
        .cal-cell__count {
          display: none;
        }
        .cal-cell__plus {
          opacity: 1;
        }
      }
    `
  ]
})
export class CalendarMonthComponent {
  @Input({ required: true }) days!: CalendarDayView[];
  /**
   * `false` cuando la cuenta no tiene cocina: la casilla no anade comidas —no hay nada que
   * anadir— y pasa a hacer lo unico que quedaba por hacer aqui, abrir el dia.
   */
  @Input() kitchen = true;
  @Input() anchorIso = '';
  /** Comidas que se ven por celda antes de recurir a «+N más». */
  @Input() maxVisible = 3;

  @Output() addMeal = new EventEmitter<{ date: string; mealType: MealType }>();
  @Output() openMeal = new EventEmitter<CalendarMeal>();
  @Output() openDay = new EventEmitter<string>();
  /** Tocar un evento de la celda = editarlo (o verlo, si es de otra persona). */
  @Output() editEvent = new EventEmitter<HouseholdEvent>();

  private cachedSource: CalendarDayView[] | null = null;
  private cachedRows: CalendarDayView[][] = [];

  /** Cabecera en lunes, como el resto de la app. */
  readonly weekLabels = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

  get rows(): CalendarDayView[][] {
    if (this.cachedSource === this.days) return this.cachedRows;
    this.cachedSource = this.days;
    const rows: CalendarDayView[][] = [];
    for (let i = 0; i < this.days.length; i += 7) rows.push(this.days.slice(i, i + 7));
    this.cachedRows = rows;
    return rows;
  }

  visible(day: CalendarDayView): CalendarMeal[] {
    return day.meals.slice(0, this.maxVisible);
  }

  /** La primera franja libre del día: añadir desde el mes no debería imponer una. */
  onCellClick(day: CalendarDayView, event?: MouseEvent): void {
    if (
      event?.target instanceof Element &&
      event.target.closest('[data-test="calendar-household-task"]')
    ) {
      return;
    }
    if (!this.kitchen) {
      this.openDay.emit(day.iso);
      return;
    }
    this.addMeal.emit({ date: day.iso, mealType: this.firstFreeMealType(day) });
  }

  firstFreeMealType(day: CalendarDayView): MealType {
    return MEAL_ORDER.find((type) => day.slots[type].length === 0) ?? 'lunch';
  }

  fmt(value: number): string {
    return formatNumber(value);
  }

  dayLabel(day: CalendarDayView): string {
    return labels.fullDate(day.date);
  }

  trackByIso(_i: number, day: CalendarDayView): string {
    return day.iso;
  }

  trackByRow(i: number): number {
    return i;
  }
}
