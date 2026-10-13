import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CalendarDayView } from '../../shared/models/calendar.model';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { addDays, labels, toISODate } from './calendar.util';

@Component({
  selector: 'app-calendar-year',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="year-grid" role="grid" [attr.aria-label]="yearLabel()">
      @for (month of months; track month) {
        <section class="year-month">
          <button
            class="year-month__title"
            type="button"
            (click)="openMonth.emit(monthStart(month))"
          >
            {{ monthLabel(month) }}
          </button>
          <div class="year-month__grid">
            @for (label of weekdayLabels; track label) {
              <span class="year-month__weekday">{{ label }}</span>
            }
            @for (cell of monthCells(month); track $index) {
              @if (cell) {
                <button
                  type="button"
                  class="year-month__day"
                  [class.has-items]="cell.events.length + cell.meals.length + cell.tasks.length > 0"
                  [class.is-today]="cell.isToday"
                  [attr.aria-label]="'calendar.view_day_date' | t: { date: cell.iso }"
                  (click)="openDay.emit(cell.iso)"
                >
                  {{ cell.date.getDate() }}
                </button>
              } @else {
                <span aria-hidden="true"></span>
              }
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .year-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 24px;
        padding: 20px;
      }
      .year-month {
        min-width: 0;
      }
      .year-month__title {
        margin: 0 0 8px;
        padding: 4px 0;
        border: 0;
        background: none;
        color: var(--text-primary);
        font: inherit;
        font-size: var(--text-sm);
        font-weight: var(--font-semibold);
        text-transform: capitalize;
        cursor: pointer;
      }
      .year-month__grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 2px;
      }
      .year-month__weekday,
      .year-month__day {
        display: grid;
        place-items: center;
        min-width: 0;
        aspect-ratio: 1;
        font-size: 10px;
      }
      .year-month__weekday {
        color: var(--text-tertiary);
      }
      .year-month__day {
        position: relative;
        border: 0;
        border-radius: var(--radius-full);
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
      }
      .year-month__day.has-items::after {
        content: '';
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: var(--primary);
        position: absolute;
        transform: translateY(9px);
      }
      .year-month__day.is-today {
        color: var(--text-inverse);
        background: var(--primary);
      }
      .year-month__day.is-today::after {
        background: currentColor;
      }
      .year-month__title:hover,
      .year-month__day:hover {
        background: var(--bg-tertiary);
      }
      .year-month__day.is-today:hover {
        background: var(--primary-dark);
      }
      :is(button):focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
      @media (max-width: 760px) {
        .year-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          padding: 12px;
        }
      }
      @media (max-width: 420px) {
        .year-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class CalendarYearComponent {
  @Input({ required: true }) days: CalendarDayView[] = [];
  @Input({ required: true }) year = new Date().getFullYear();
  @Output() openDay = new EventEmitter<string>();
  @Output() openMonth = new EventEmitter<string>();

  readonly months = Array.from({ length: 12 }, (_, index) => index);
  readonly weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    labels.dayOfWeekShort(new Date(2024, 0, 1 + index))
  );
  private readonly dayMap = () => new Map(this.days.map((day) => [day.iso, day]));

  yearLabel(): string {
    return String(this.year);
  }
  monthLabel(month: number): string {
    return labels.month(new Date(this.year, month, 1));
  }
  monthStart(month: number): string {
    return toISODate(new Date(this.year, month, 1));
  }
  monthCells(month: number): (CalendarDayView | null)[] {
    const first = new Date(this.year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const map = this.dayMap();
    const cells: (CalendarDayView | null)[] = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= new Date(this.year, month + 1, 0).getDate(); day++) {
      const iso = toISODate(addDays(first, day - 1));
      const result = map.get(iso);
      if (result) cells.push(result);
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }
}
