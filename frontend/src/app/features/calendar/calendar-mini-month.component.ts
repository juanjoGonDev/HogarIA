import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../core/pipes/translate.pipe';
import { labels, monthGrid, toISODate } from './calendar.util';

@Component({
  selector: 'app-calendar-mini-month',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <section class="mini" [attr.aria-label]="'calendar.mini_month' | t">
      <header class="mini__head">
        <h2>{{ monthLabel() }}</h2>
        <div class="mini__nav">
          <button type="button" [attr.aria-label]="'calendar.periodo_anterior' | t" (click)="shiftMonth.emit(-1)">‹</button>
          <button type="button" [attr.aria-label]="'calendar.periodo_siguiente' | t" (click)="shiftMonth.emit(1)">›</button>
        </div>
      </header>
      <div class="mini__grid" role="grid">
        @for (weekday of weekdays; track weekday) {
          <span class="mini__weekday" role="columnheader">{{ weekday }}</span>
        }
        @for (date of dates(); track date.toISOString()) {
          <button
            type="button"
            class="mini__day"
            role="gridcell"
            [class.is-outside]="date.getMonth() !== anchorDate.getMonth()"
            [class.is-today]="isToday(date)"
            [class.is-selected]="toIso(date) === selectedDate"
            [attr.aria-current]="isToday(date) ? 'date' : null"
            [attr.aria-label]="'calendar.view_day_date' | t: { date: toIso(date) }"
            (click)="selectDate.emit(toIso(date))"
          >{{ date.getDate() }}</button>
        }
      </div>
      <button type="button" class="mini__today" (click)="goToday.emit()">{{ 'calendar.hoy' | t }}</button>
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .mini { display: grid; gap: 12px; padding: 16px; color: var(--text-primary); }
    .mini__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .mini__head h2 { margin: 0; font-size: var(--text-sm); font-weight: var(--font-semibold); }
    .mini__nav { display: flex; gap: 4px; }
    .mini__nav button, .mini__day, .mini__today {
      display: grid; place-items: center; border: 0; color: inherit; background: transparent;
      font: inherit; cursor: pointer; border-radius: var(--radius-full);
    }
    .mini__nav button { width: 30px; height: 30px; font-size: 22px; line-height: 1; }
    .mini__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
    .mini__weekday { display: grid; place-items: center; height: 22px; font-size: 10px; color: var(--text-tertiary); }
    .mini__day { min-width: 0; height: 30px; padding: 0; font-size: 11px; font-variant-numeric: tabular-nums; }
    .mini__day.is-outside { color: var(--text-tertiary); }
    .mini__day.is-today { box-shadow: inset 0 0 0 1px var(--primary); color: var(--primary); }
    .mini__day.is-selected { color: var(--text-inverse); background: var(--primary); }
    .mini__today { justify-self: start; min-height: 32px; padding: 0 12px; border: 1px solid var(--border-default); font-size: var(--text-xs); }
    .mini__nav button:hover, .mini__day:hover, .mini__today:hover { background: var(--bg-tertiary); }
    .mini__day.is-selected:hover { background: var(--primary-dark); }
    :is(button):focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    @media (max-width: 760px) { .mini { padding: 12px; } }
  `]
})
export class CalendarMiniMonthComponent {
  @Input({ required: true }) anchorDate!: Date;
  @Input({ required: true }) selectedDate!: string;
  @Output() selectDate = new EventEmitter<string>();
  @Output() shiftMonth = new EventEmitter<1 | -1>();
  @Output() goToday = new EventEmitter<void>();

  readonly weekdays = Array.from({ length: 7 }, (_, index) => labels.dayOfWeekShort(new Date(2024, 0, 1 + index)));
  readonly toIso = toISODate;

  dates(): Date[] { return monthGrid(this.anchorDate); }
  monthLabel(): string { return labels.month(this.anchorDate); }
  isToday(date: Date): boolean {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }
}
